import test from 'node:test';
import assert from 'node:assert/strict';
import { falloff,RIFLE } from '../src/weapon.ts';

/**
 * The rifle is a port, so the numbers are the contract: these are the sibling project's
 * own constants, and a change here is a change to how the gun feels, not a refactor.
 */
test('the ballistics are the ones they were ported from',()=>{
  assert.equal(RIFLE.range,160);
  assert.equal(RIFLE.damage,18);
  assert.equal(RIFLE.impulse,7);
  assert.equal(RIFLE.mag,30);
  // Their tick is 60 Hz: a 6-tick cooldown is ten rounds a second.
  assert.ok(Math.abs(1/RIFLE.cooldown-10)<1e-9,`${1/RIFLE.cooldown} rounds per second`);
  assert.ok(Math.abs(RIFLE.reload-1.5)<1e-9);
  assert.ok(Math.abs(RIFLE.reloadEmpty-2)<1e-9);
  assert.equal(RIFLE.recoilKick,0.16);
  assert.equal(RIFLE.recoilMax,1.1);
  assert.equal(RIFLE.recoilDecay,0.88);
  assert.equal(RIFLE.hipSpread,0.028);
  assert.equal(RIFLE.aimSpread,0.004);
  assert.equal(RIFLE.moveBloom,0.004);
});

test('damage is full up close, floors far out, and only falls between',()=>{
  assert.equal(falloff(0),1);
  assert.equal(falloff(RIFLE.falloffNear),1);
  assert.equal(falloff(RIFLE.falloffFar),RIFLE.falloffFloor);
  assert.equal(falloff(RIFLE.range),RIFLE.falloffFloor);
  const mid=falloff((RIFLE.falloffNear+RIFLE.falloffFar)/2);
  assert.ok(Math.abs(mid-(1+RIFLE.falloffFloor)/2)<1e-9,`halfway is ${mid}`);
  let previous=1;
  for(let d=0;d<=RIFLE.range;d+=5){const value=falloff(d);assert.ok(value<=previous+1e-9,`rose at ${d}m`);previous=value;}
});

test('a held trigger climbs to the ceiling and no further, then bleeds off',()=>{
  let recoil=0;
  for(let shot=0;shot<40;shot++)recoil=Math.min(RIFLE.recoilMax,recoil+RIFLE.recoilKick);
  assert.equal(recoil,RIFLE.recoilMax);
  // The decay is per 60 Hz tick, so a second of holding fire recovers most of it.
  const afterASecond=recoil*Math.pow(RIFLE.recoilDecay,60);
  assert.ok(afterASecond<0.001,`still ${afterASecond} after a second`);
  // Three rounds is a burst, not a hose: it should stay well inside the ceiling.
  let burst=0;
  for(let shot=0;shot<3;shot++)burst=Math.min(RIFLE.recoilMax,burst+RIFLE.recoilKick)*Math.pow(RIFLE.recoilDecay,RIFLE.cooldown*60);
  assert.ok(burst<RIFLE.recoilMax*0.5,`burst reached ${burst}`);
});
