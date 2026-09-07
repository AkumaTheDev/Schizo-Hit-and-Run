import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrafficPath } from '../src/traffic-path.ts';
import { Motion } from '../src/motion.ts';
const v=(x:number,z:number)=>new THREE.Vector3(x,0,z);
test('traffic crosses a gap and a right-angle junction without a position jump',()=>{
  const path=new TrafficPath([[v(0,0),v(0,30)],[v(0,38),v(35,38)],[v(40,38),v(90,38)]],0,false,.9),position=v(0,0);path.sample(position);let previous=position.clone();
  for(let i=0;i<360;i++){
    path.advance(10/60);path.sample(position);
    assert(position.distanceTo(previous)<.19,`traffic jumped ${position.distanceTo(previous)}m on step ${i}`);previous.copy(position);
  }
  assert(position.x>35,'vehicle should have driven through the junction');
});
test('traffic interpolation renders smooth motion between simulation steps',()=>{
  const path=new TrafficPath([[v(0,0),v(0,1000)]],0),pose={position:v(0,0),heading:0},motion=new Motion();pose.heading=path.sample(pose.position);motion.reset(pose);
  let accumulator=0,lastZ:number|undefined;
  for(let frame=0;frame<240;frame++){
    accumulator+=1/120;
    while(accumulator>=1/60){motion.capture(pose);path.advance(8/60);pose.heading=path.sample(pose.position);accumulator-=1/60;}
    const z=motion.sample(pose,accumulator*60).position.z;
    if(frame>1)assert(Math.abs(z-lastZ!-8/120)<.00001);lastZ=z;
  }
});
test('dead-end traffic makes a continuous turn instead of changing lanes instantly',()=>{
  const path=new TrafficPath([[v(0,0),v(0,20)]],0,false,.99),position=v(0,0);path.sample(position);let previous=position.clone();
  for(let i=0;i<120;i++){path.advance(7/60);path.sample(position);assert(position.distanceTo(previous)<.15);previous.copy(position);}
});

test('mission cars follow rounded corners at a steady distance per frame',async()=>{
  const {MissionRoute}=await import('../src/campaign/roads.ts');const route=new MissionRoute([new THREE.Vector3(),new THREE.Vector3(0,0,20),new THREE.Vector3(20,0,20)]),position=new THREE.Vector3();let previous=position.clone(),heading=0;
  while(!route.finished){const next=route.advance(.1,position);const movement=position.distanceTo(previous);assert(movement<=.105);if(!route.finished)assert(movement>=.095);assert(Math.abs(next-heading)<.1);previous.copy(position);heading=next;}
  assert(position.distanceTo(new THREE.Vector3(20,0,20))<.001);
});
