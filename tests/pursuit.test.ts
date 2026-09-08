import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import '../src/assets.ts';
import { Terrain } from '../src/physics.ts';
import type { LevelData } from '../src/assets.ts';
import { Pursuit,pursuitSpawns } from '../src/pursuit.ts';
import { pursuitSettings } from '../src/hit-and-run.ts';
import { trafficModels,trafficGroup,trafficSpawnCandidates,trafficDesiredSpeed,TRAFFIC_RULES } from '../src/traffic.ts';
import { RoadNetwork } from '../src/campaign/roads.ts';
import { vehicleContact,vehicleTravelDistance } from '../src/vehicle-collision.ts';
import type { World } from '../src/world.ts';
import type { CampaignAssets } from '../src/campaign/types.ts';
import type { Player } from '../src/campaign/player.ts';
import { simulateVehicle,DEFAULT_VEHICLE } from '../src/vehicle-physics.ts';
const straight=[[[0,0,-200],[0,0,200]]];
test('vehicle footprints allow adjacent lanes and detect contact after rotation',()=>{
  const a={position:new THREE.Vector3(),heading:0},b={position:new THREE.Vector3(2.8,0,0),heading:Math.PI};
  assert.equal(vehicleContact(a,b),undefined,'Passing in another lane must not cause damage');
  b.position.set(0,0,4);const rear=vehicleContact(a,b);assert(rear&&rear.depth>.39&&rear.depth<.41);assert(rear.normal.z<0);
  b.position.set(2.5,0,0);b.heading=Math.PI/2;assert(vehicleContact(a,b),'A perpendicular car extends across the lane');
  b.position.y=5;assert.equal(vehicleContact(a,b),undefined,'Separate road elevations must not collide');
  a.position.z=-20;b.position.set(2.5,0,0);assert(vehicleTravelDistance(a,b)<20,'Braking must account for the full rotated vehicle');
});
test('police spawns lie on source roads at the native 100-metre radius',()=>{
  const points=pursuitSpawns(straight,new THREE.Vector3());assert.equal(points.length,2);
  for(const point of points){assert.equal(point.x,0);assert(Math.abs(point.length()-100)<1e-6);}
});
test('a car already on a road approaches its target without reversing to an endpoint',()=>{
  const road=new RoadNetwork(straight),path=road.route(new THREE.Vector3(0,0,-100),new THREE.Vector3());
  assert.equal(path.length,2);assert.deepEqual(path.map(p=>p.z),[-100,0]);
  const turn=new RoadNetwork([[[0,0,0],[0,0,100]],[[0,0,100],[100,0,100]]]);
  const corner=turn.route(new THREE.Vector3(0,0,40),new THREE.Vector3(60,0,100));
  assert.deepEqual(corner.map(p=>p.toArray()),[[0,0,40],[0,0,100],[60,0,100]]);
});
for(let level=1;level<=7;level++)test(`level ${level} traffic uses its original vehicle group`,()=>{
  const chapter=JSON.parse(readFileSync(`public/assets/campaign/level${level}.json`,'utf8'));
  const models=trafficModels(chapter.initial),defs=chapter.initial.filter((c:any)=>c.op==='AddTrafficModel');
  assert.equal(models.length,5);assert(!models.includes('cpolice'));assert(!models.includes('chears'));
  assert(models.every(id=>defs.some((c:any)=>c.args[0].toLowerCase()===id)));
  for(const def of defs){assert.equal(models.filter(id=>id===def.args[0].toLowerCase()).length,Number(def.args[1]));assert.equal(trafficGroup(chapter.initial).find(d=>d.id===def.args[0].toLowerCase())!.noPark,Number(def.args[2])===1);}
});
test('traffic enters its native camera-centred bubble along an inward lane',()=>{
  const center=new THREE.Vector3(0,0,TRAFFIC_RULES.cameraLead),roads=straight.map(r=>r.map(p=>new THREE.Vector3(...p as [number,number,number])));
  const points=trafficSpawnCandidates(roads,center,TRAFFIC_RULES.spawnRadius);assert.equal(points.length,2);
  for(const p of points){assert(Math.abs(p.position.distanceTo(center)-65)<1e-6);assert.equal(p.reverse,p.position.z>center.z);}
});
test('ordinary traffic brakes before a stopped car and does not block the opposite lane',()=>{
  const position=new THREE.Vector3(0,0,-40),obstacle=new THREE.Vector3();let speed=60/3.6;
  for(let i=0;i<600;i++){const desired=trafficDesiredSpeed(position,0,[obstacle]);speed=THREE.MathUtils.clamp(desired,Math.max(0,speed-8/60),speed+4/60);position.z+=speed/60;}
  assert(position.z<-5,'Traffic must stop before reaching the player collider');assert(speed<.01);
  assert.equal(trafficDesiredSpeed(new THREE.Vector3(),0,[new THREE.Vector3(3,0,10)]),60/3.6);
});
test('police drive from a spawn to a stopped player and deduct a single bounded fine',async()=>{
  const scene=new THREE.Scene(),model=new THREE.Group();model.add(new THREE.Mesh(new THREE.BoxGeometry(1.7,1.4,4),new THREE.MeshStandardMaterial()));
  for(let i=0;i<4;i++){const wheel=new THREE.Group();wheel.name=`w${i}`;wheel.position.set(i%2?.7:-.7,-.35,i<2?1.3:-1.3);wheel.add(new THREE.Mesh(new THREE.SphereGeometry(.35,8,6)));model.add(wheel);}
  const floor=new THREE.PlaneGeometry(500,500).rotateX(-Math.PI/2).toNonIndexed();floor.deleteAttribute('normal');floor.deleteAttribute('uv');const terrain=new Terrain([floor],{fences:[]} as unknown as LevelData);
  const world={scene,data:{roads:straight},assets:{load:async()=>({root:model})},terrain} as unknown as World;
  const settings=pursuitSettings([]),assets={missionTuning:{'pursuit/l1cop.con':{SetTopSpeedKmh:140,SetGasScale:10,SetMass:1750,SetHitPoints:.5}},tuning:{famil_v:{SetMass:1500}}} as unknown as CampaignAssets;
  const player:Player={state:{position:new THREE.Vector3(0,.06,0),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0},onFoot:false,vehicle:'famil_v',parkedPosition:new THREE.Vector3(),parkedHeading:0};
  let money=75,busts=0;const pursuit=new Pursuit(world,settings,assets,{toast:()=>{},fine:amount=>{const paid=Math.min(money,amount);money-=paid;return paid;},busted:()=>{busts++;}});
  await pursuit.load();pursuit.meter.setHeat(100);let closest=Infinity;
  for(let i=0;i<600;i++){if(!pursuit.frozen)simulateVehicle(player.state,{steer:0,throttle:0,brake:0,handbrake:false},1/60,assets.tuning.famil_v,DEFAULT_VEHICLE,terrain);pursuit.update(1/60,player,false);for(const car of pursuit.cars)closest=Math.min(closest,car.position.distanceTo(player.state.position));}
  assert(closest<10,'The car must actually reach catch distance');assert.equal(busts,1);assert.equal(money,25);assert.equal(pursuit.meter.heat,0);assert.equal(pursuit.cars.length,0);
  pursuit.dispose();terrain.dispose();floor.dispose();
});
