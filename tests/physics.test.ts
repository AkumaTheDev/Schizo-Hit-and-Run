import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/assets.ts';
import { drive,Terrain,type CarState } from '../src/physics.ts';
import { resetVehicle,VEHICLE_RULES } from '../src/vehicle-physics.ts';
import type { LevelData } from '../src/assets.ts';
const car=():CarState=>({position:new THREE.Vector3(),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0});
const neutral={throttle:0,brake:0,steer:0,handbrake:false};
test('car accelerates, brakes, reverses and respects its speed limits',()=>{
  const state=car();for(let i=0;i<600;i++)drive(state,{...neutral,throttle:1},1/60);
  assert(state.speed>40&&state.speed<=43);assert(state.position.z>250);
  for(let i=0;i<150;i++)drive(state,{...neutral,brake:1},1/60);
  assert(state.speed<1,'braking must stop a car at full speed within 2.5 seconds');
  for(let i=0;i<300;i++)drive(state,{...neutral,brake:1},1/60);
  assert(state.speed<0&&state.speed>=-VEHICLE_RULES.reverseSpeed-.001);
});
test('steering is stationary at rest and reverses direction in reverse',()=>{
  const state=car();drive(state,{...neutral,steer:1},1);assert.equal(state.heading,0);
  state.speed=10;drive(state,{...neutral,steer:1},.1);assert(state.heading<0);
  state.speed=-10;resetVehicle(state);const before=state.heading;drive(state,{...neutral,steer:1},.1);assert(state.heading>before);
});
test('handbrake slows the car faster than coasting',()=>{
  const a=car(),b=car();a.speed=b.speed=30;
  for(let i=0;i<60;i++){drive(a,neutral,1/60);drive(b,{...neutral,handbrake:true},1/60);}
  assert(b.speed<a.speed-4,'the rear-wheel brake adds its native force without instantly deleting momentum');
});
test('terrain catches falling vehicles and a fence prevents crossing',()=>{
  const geometry=new THREE.PlaneGeometry(40,40).rotateX(-Math.PI/2).toNonIndexed();
  geometry.deleteAttribute('normal');geometry.deleteAttribute('uv');
  const data={fences:[[[2,0,-10],[2,0,10],[1,0,0]]]} as unknown as LevelData;
  const terrain=new Terrain([geometry],data);const state=car();state.position.set(1.5,0,0);state.speed=10;
  const hit=terrain.resolve(state,new THREE.Vector3(0,0,0),1/60);
  assert(hit);assert(state.position.x<=.801);assert(state.speed<0);assert(state.damage>0);assert(state.position.y>=0);
  state.position.set(-5,3,0);state.speed=0;
  for(let i=0;i<120;i++)terrain.resolve(state,state.position.clone(),1/60);
  assert(Math.abs(state.position.y-.06)<.01);terrain.dispose();geometry.dispose();
});
test('a car separating from a fence is corrected without another bounce or damage',()=>{
  const geometry=new THREE.PlaneGeometry(40,40).rotateX(-Math.PI/2).toNonIndexed();geometry.deleteAttribute('normal');geometry.deleteAttribute('uv');
  const terrain=new Terrain([geometry],{fences:[[[2,0,-10],[2,0,10],[1,0,0]]]} as unknown as LevelData);
  const state=car();state.position.set(1,.06,0);state.speed=-5;state.damage=7;
  assert.equal(terrain.resolve(state,new THREE.Vector3(1.1,.06,0),1/60),false);
  assert.equal(state.speed,-5);assert.equal(state.damage,7);assert(state.position.x<=.801);
  terrain.dispose();geometry.dispose();
});
