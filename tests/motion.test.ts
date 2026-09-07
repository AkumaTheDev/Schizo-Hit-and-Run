import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Motion } from '../src/motion.ts';
test('120 Hz rendering has equal motion between 60 Hz physics steps',()=>{
  const pose={position:new THREE.Vector3(),heading:0},motion=new Motion();motion.reset(pose);
  let accumulator=0;const samples:number[]=[];
  for(let frame=0;frame<120;frame++){
    accumulator+=1/120;
    while(accumulator>=1/60){motion.capture(pose);pose.position.z+=20/60;accumulator-=1/60;}
    samples.push(motion.sample(pose,accumulator*60).position.z);
  }
  for(let i=2;i<samples.length;i++)assert(Math.abs(samples[i]-samples[i-1]-20/120)<1e-10);
});
test('heading interpolates across wrap and reset never slides through a teleport',()=>{
  const pose={position:new THREE.Vector3(),heading:Math.PI-.1},motion=new Motion();motion.reset(pose);motion.capture(pose);
  pose.heading=-Math.PI+.1;assert(Math.abs(motion.sample(pose,.5).heading-Math.PI)<1e-10);
  pose.position.set(100,4,90);motion.reset(pose);assert(motion.sample(pose,0).position.equals(pose.position));
});
