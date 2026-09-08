import { after,test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { worldFixture,carFixture,assetJSON } from './world-fixture.ts';
import { simulateVehicle,vehicleProfile } from '../src/vehicle-physics.ts';
import { Traffic } from '../src/traffic.ts';
import { vehicleContact } from '../src/vehicle-collision.ts';
import type { CarState } from '../src/physics.ts';
import type { World } from '../src/world.ts';
let fixture:ReturnType<typeof worldFixture>|undefined;
const world=()=>fixture??=worldFixture();
const state=(x:number,y:number,z:number,heading=0):CarState=>({position:new THREE.Vector3(x,y,z),heading,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0});
test('the reported residential traffic junction does not leave NPC cars interpenetrating',async()=>{
  const {terrain,data}=world(),assets=assetJSON('campaign/assets'),chapter=assetJSON('campaign/level1');
  const fake={terrain,data,scene:new THREE.Scene(),assets:{load:async(name:string)=>({root:carFixture(name.replace('car-',''))})}} as unknown as World;
  const traffic=new Traffic(fake,chapter.initial,assets.tuning);await traffic.load();const player=state(298.6,4.2,158.9,Math.PI/2);let movingFrames=0;const stalledPairs=new Map<string,number>();
  for(let i=0;i<900;i++){
    traffic.update(1/60,player,true,new THREE.Vector3(1,0,0));if(traffic.cars.some(c=>c.active&&Math.abs(c.speed)>2))movingFrames++;
    for(let a=0;a<traffic.cars.length;a++)for(let b=a+1;b<traffic.cars.length;b++){
      const first=traffic.cars[a],second=traffic.cars[b];if(!first.active||!second.active)continue;
      const pair=`${a}:${b}`,crossing=Math.cos(first.heading-second.heading)<.75,near=first.position.distanceTo(second.position)<first.footprint.halfLength+second.footprint.halfLength+3;
      const stalled=crossing&&near&&Math.abs(first.speed)<.5&&Math.abs(second.speed)<.5?(stalledPairs.get(pair)??0)+1:0;stalledPairs.set(pair,stalled);assert(stalled<240,`${first.id}/${second.id} remained blocked for four seconds`);
      const overlap=vehicleContact(first,second,first.footprint,second.footprint);assert(!overlap||overlap.depth<.03,`${first.id}/${second.id}: ${overlap?.depth}`);
    }
  }
  assert(movingFrames>600,`traffic stopped for ${900-movingFrames} frames`);traffic.dispose();
});
test('an overturned family sedan at the reported wall can recover',()=>{
  const {terrain}=world(),car=carFixture('famil_v'),profile=vehicleProfile(car),player=state(401.8,4.8,-49.6),tuning=assetJSON('campaign/assets').tuning.famil_v;
  const body=simulateVehicle(player,{steer:0,throttle:0,brake:0,handbrake:false},0,tuning,profile);
  body.orientation.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI*.48);
  for(let i=0;i<480;i++)simulateVehicle(player,{steer:-1,throttle:0,brake:0,handbrake:false},1/60,tuning,profile,terrain);
  assert(new THREE.Vector3(0,1,0).applyQuaternion(body.orientation).y>.8,`still tipped at ${player.position.toArray()}`);assert(player.position.y>0);assert(player.position.toArray().every(Number.isFinite));
});
after(()=>fixture?.terrain.dispose());
