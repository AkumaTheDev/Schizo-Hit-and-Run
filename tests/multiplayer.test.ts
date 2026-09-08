import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteBuffer, Net, peerColour, type Sample } from '../src/net.ts';

/** A pose sample for a car driving straight along +x at `speed` metres per second. */
const at = (x: number): Sample => [x, 3.5, 60, 0, 0, 0, 1, Math.PI / 2, 14, 0, 0, 'hom_loco_run', 'famil_v'];
const lerp = (from: Sample, to: Sample, alpha: number) => from[0] + (to[0] - from[0]) * alpha;

test('the buffer interpolates between the samples that bracket the read time', () => {
  const buffer = new RemoteBuffer();
  buffer.push(1000, at(0));
  buffer.push(1050, at(10));
  const frame = buffer.at(1025)!;
  assert.equal(lerp(frame.from, frame.to, frame.alpha), 5, 'halfway between two samples is the midpoint');
});

test('reading before the first sample holds the first pose rather than guessing', () => {
  const buffer = new RemoteBuffer();
  buffer.push(1000, at(7));
  const frame = buffer.at(500)!;
  assert.equal(lerp(frame.from, frame.to, frame.alpha), 7);
});

test('a starved buffer coasts forward, then stops rather than flying away', () => {
  const buffer = new RemoteBuffer();
  buffer.push(1000, at(0));
  buffer.push(1050, at(10));
  const coasting = buffer.at(1075)!;
  assert.ok(lerp(coasting.from, coasting.to, coasting.alpha) > 10, 'a short gap keeps the car moving');
  const far = buffer.at(9000)!;
  const stopped = buffer.at(99000)!;
  assert.equal(lerp(far.from, far.to, far.alpha), lerp(stopped.from, stopped.to, stopped.alpha),
    'extrapolation is capped, so a dead peer parks instead of leaving Springfield');
});

test('late and duplicate packets are discarded instead of rewinding the car', () => {
  const buffer = new RemoteBuffer();
  buffer.push(1000, at(0));
  buffer.push(1050, at(10));
  buffer.push(1025, at(999));   // arrived late
  buffer.push(1050, at(999));   // duplicate timestamp
  const frame = buffer.at(1050)!;
  assert.equal(lerp(frame.from, frame.to, frame.alpha), 10);
});

test('the buffer does not grow without bound while a peer streams', () => {
  const buffer = new RemoteBuffer();
  for (let i = 0; i < 2000; i++) buffer.push(1000 + i * 50, at(i));
  const frame = buffer.at(1000 + 1999 * 50)!;
  assert.equal(lerp(frame.from, frame.to, frame.alpha), 1999, 'the newest pose still reads correctly');
});

test('playback stays smooth when packets arrive with jitter', () => {
  // 20 Hz of samples, but delivered with the uneven timing of a real connection.
  const buffer = new RemoteBuffer();
  const net = new Net();
  const jitter = [0, 18, -9, 41, 5, -14, 30, 0, 22, -6];
  let newest = 0;
  const deliver = (index: number) => {
    const stamp = 1000 + index * 50;
    newest = stamp;
    buffer.push(stamp, at(index * 0.7));   // 14 m/s at 20 Hz
    (net as unknown as { newest: number }).newest = newest;
  };
  deliver(0); deliver(1);
  (net as unknown as { started: boolean; clock: number }).started = true;
  (net as unknown as { clock: number }).clock = newest - 110;

  // Render at 60 fps, feeding packets in on their jittered schedule.
  const steps: number[] = [];
  let packet = 2;
  let elapsed = 0;
  for (let frame = 0; frame < 240; frame++) {
    elapsed += 1000 / 60;
    while (packet < 60 && elapsed >= packet * 50 + jitter[packet % jitter.length]) deliver(packet++);
    net.advance(1 / 60);
    const read = buffer.at(net.renderTime);
    if (read) steps.push(lerp(read.from, read.to, read.alpha));
  }

  assert.ok(steps.length > 200, 'produced a pose every frame');
  let backwards = 0;
  let worst = 0;
  for (let i = 1; i < steps.length; i++) {
    const step = steps[i] - steps[i - 1];
    if (step < -1e-9) backwards++;
    worst = Math.max(worst, Math.abs(step));
  }
  assert.equal(backwards, 0, 'a car driving forwards never appears to reverse');
  // At 14 m/s a 60 fps frame covers ~0.23 m. Anything far above that is a visible jolt.
  assert.ok(worst < 0.6, `no jolts between frames (worst step was ${worst.toFixed(3)} m)`);
});

test('the playback clock chases the newest packet without snapping', () => {
  const net = new Net();
  const internals = net as unknown as { started: boolean; clock: number; newest: number };
  internals.started = true;
  internals.newest = 10_000;
  internals.clock = 10_000 - 110;
  const before = net.renderTime;
  net.advance(1 / 60);
  const step = net.renderTime - before;
  // Time dilation: the clock may run fast or slow to correct, but never leaps.
  assert.ok(step > 0 && step < 1000 / 60 * 1.2, `clock advanced smoothly (${step.toFixed(2)} ms)`);

  // A huge gap (a tab left in the background) is the one case that hard-syncs.
  internals.newest = 60_000;
  net.advance(1 / 60);
  assert.equal(net.renderTime, 60_000 - 110, 'a hopeless drift resyncs rather than crawling for minutes');
});

test('peer colours are stable per player and not all the same', () => {
  assert.equal(peerColour('7'), peerColour('7'));
  const colours = new Set(['1', '2', '3', '4', '5'].map(peerColour));
  assert.ok(colours.size >= 4, 'nearby players are told apart by colour');
});
