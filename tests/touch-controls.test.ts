import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraRelative } from '../src/player-movement.ts';

/**
 * `PlayerMovement.update` turns its controls into a world heading exactly this way,
 * so reading the pair back through it is what proves the stick points where it looks.
 */
const heading=(x:number,z:number,body:number)=>Math.atan2(Math.sin(body-Math.atan2(x,z)),Math.cos(body-Math.atan2(x,z)));
/** The world direction a heading walks in, in this game's (sin, cos) convention. */
const forward=(direction:number)=>({x:Math.sin(direction),z:Math.cos(direction)});
const close=(a:number,b:number,label:string)=>assert.ok(Math.abs(a-b)<1e-9,`${label}: ${a} vs ${b}`);

test('pushing the stick away from you runs along the camera heading, whatever the body faces', () => {
  for(const body of [0,1.1,-2.4,Math.PI]) for(const cam of [0,0.7,-1.9,3]){
    const walk=cameraRelative(0,1,body,cam);
    close(heading(walk.x,walk.z,body),Math.atan2(Math.sin(cam),Math.cos(cam)),`body ${body} cam ${cam}`);
  }
});

test('pushing the stick right runs toward the camera right, not its mirror', () => {
  // The camera looks along `cam` with +Y up, so its right in world space is cam - 90°.
  const cam=0.4,walk=cameraRelative(1,0,-1.3,cam);
  const world=forward(heading(walk.x,walk.z,-1.3)),right=forward(cam-Math.PI/2);
  close(world.x,right.x,'right x');close(world.z,right.z,'right z');
});

test('a diagonal push splits the difference and keeps full speed', () => {
  const cam=0,walk=cameraRelative(1,1,0,cam);
  const world=heading(walk.x,walk.z,0);
  close(world,-Math.PI/4,'forward-right is 45 degrees off the camera heading');
  close(Math.hypot(walk.x,walk.z),1,'a diagonal is still a full push');
});

test('a stick beyond the unit circle cannot outrun a straight push', () => {
  assert.ok(Math.hypot(...Object.values(cameraRelative(0.9,0.9,0,0)) as [number,number])<=1+1e-9);
});

test('a centred stick asks for no movement at all', () => {
  const walk=cameraRelative(0,0,1.2,-0.6);
  close(walk.x,0,'x');close(walk.z,0,'z');
});
