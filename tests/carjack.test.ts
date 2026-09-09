import { after,test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { worldFixture,carFixture,assetJSON } from './world-fixture.ts';
import { Traffic } from '../src/traffic.ts';
import type { CarState } from '../src/physics.ts';
import type { World } from '../src/world.ts';

/**
 * Taking a car off the street. The pool is fixed, so a jacked car is never destroyed: it
 * leaves the world and is free to stream back in somewhere else with a fresh driver.
 */
let fixture:ReturnType<typeof worldFixture>|undefined;
const world=()=>fixture??=worldFixture();
const player=(x:number,y:number,z:number):CarState=>({position:new THREE.Vector3(x,y,z),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0});

async function streetTraffic(){
  const {terrain,data}=world(),assets=assetJSON('campaign/assets'),chapter=assetJSON('campaign/level1');
  const fake={terrain,data,scene:new THREE.Scene(),assets:{load:async(name:string)=>({root:carFixture(name.replace('car-',''))})}} as unknown as World;
  const traffic=new Traffic(fake,chapter.initial,assets.tuning);await traffic.load();
  const driver=player(298.6,4.2,158.9);
  for(let i=0;i<240;i++)traffic.update(1/60,driver,true,new THREE.Vector3(1,0,0));
  return {traffic,driver};
}

test('a pedestrian finds the nearest car on the street and nothing beyond reach',async()=>{
  const {traffic}=await streetTraffic();
  const active=traffic.cars.filter(c=>c.active);
  assert(active.length>1,'no traffic to take');
  const target=active[0];
  const beside=target.position.clone().add(new THREE.Vector3(1.5,0,0));
  assert.equal(traffic.nearest(beside,5),target,'stood next to a car and found a different one');
  // Every car it can return really is the closest one within the radius.
  const found=traffic.nearest(beside,5)!;
  for(const car of active)assert(car.position.distanceTo(beside)>=found.position.distanceTo(beside)-1e-6);
  // Out of reach is nobody's car.
  const away=target.position.clone().add(new THREE.Vector3(400,0,400));
  assert.equal(traffic.nearest(away,5),undefined);
  traffic.dispose();
});

test('a car handed over leaves the street and can come back with a fresh driver',async()=>{
  const {traffic,driver}=await streetTraffic();
  const target=traffic.cars.find(c=>c.active)!;
  target.stopped=1;target.blockedTime=3;target.reverseFor=.5;
  traffic.release(target);
  assert.equal(target.active,false,'still driving itself');
  assert.equal(target.mesh.visible,false,'still on screen');
  assert.equal(target.stopped,0);assert.equal(target.blockedTime,0);assert.equal(target.reverseFor,0);
  // The pool is not short of a car: it streams back in rather than being destroyed.
  const before=traffic.cars.filter(c=>c.active).length;
  for(let i=0;i<600;i++)traffic.update(1/60,driver,true,new THREE.Vector3(1,0,0));
  assert(traffic.cars.filter(c=>c.active).length>=before,'the street lost a car for good');
  traffic.dispose();
});

after(()=>fixture?.terrain.dispose());
