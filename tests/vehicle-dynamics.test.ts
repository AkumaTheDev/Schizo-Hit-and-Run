import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/assets.ts';
import { Terrain,type CarState } from '../src/physics.ts';
import { staticCollisionGeometry } from '../src/collision.ts';
import { simulateVehicle,DEFAULT_VEHICLE } from '../src/vehicle-physics.ts';
import type { LevelData } from '../src/assets.ts';
const car=():CarState=>({position:new THREE.Vector3(0,.06,0),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0});
const neutral={throttle:0,brake:0,steer:0,handbrake:false};
function world(wall=false){
  const floor=new THREE.PlaneGeometry(500,500).rotateX(-Math.PI/2).toNonIndexed();floor.deleteAttribute('normal');floor.deleteAttribute('uv');
  const bodies=staticCollisionGeometry({version:1,sha256:'',source:'test',shapes:[{kind:'box',name:'wall',center:[0,2,wall?12:200],halfExtents:[8,2,.15],axes:[[1,0,0],[0,1,0],[0,0,1]]}]});
  const terrain=new Terrain([floor],{fences:[]} as unknown as LevelData,bodies);floor.dispose();bodies.dispose();return terrain;
}
test('four suspension contacts settle a stationary chassis without falling through the world',()=>{
  const terrain=world(),state=car();for(let i=0;i<300;i++)simulateVehicle(state,neutral,1/60,{},DEFAULT_VEHICLE,terrain);
  assert(state.grounded);assert(state.position.y>-.15&&state.position.y<.4,`${state.position.toArray()}`);assert(state.vehicleMotion!.velocity.length()<.1);assert(Math.abs(state.vehicleMotion!.orientation.x)<.05);terrain.dispose();
});
test('a driven chassis collides with a thin building wall and remains above ground',()=>{
  const terrain=world(true),state=car();for(let i=0;i<240;i++)simulateVehicle(state,{...neutral,throttle:1},1/60,{},DEFAULT_VEHICLE,terrain);
  assert(state.position.z<10,`${state.position.toArray()}`);assert(state.position.y>-.2);assert(state.damage>0);assert(Number.isFinite(state.speed));terrain.dispose();
});
test('steering produces yaw and lateral momentum rather than directly rotating the velocity',()=>{
  const state=car();state.speed=18;
  for(let i=0;i<45;i++)simulateVehicle(state,{...neutral,throttle:.5,steer:1,handbrake:i<20},1/60);
  const forward=new THREE.Vector3(Math.sin(state.heading),0,Math.cos(state.heading));
  assert(state.heading<-.1);assert(state.vehicleMotion!.velocity.clone().cross(forward).length()>.1);assert(state.vehicleMotion!.velocity.length()>5);assert(state.vehicleMotion!.orientation.toArray().every(Number.isFinite));
});
test('airborne throttle and steering cannot redirect the car without tyre contact',()=>{
  const terrain=world(),a=car(),b=car();a.position.y=b.position.y=20;a.speed=b.speed=20;
  for(let i=0;i<15;i++){simulateVehicle(a,{...neutral,throttle:1,steer:1},1/60,{},DEFAULT_VEHICLE,terrain);simulateVehicle(b,neutral,1/60,{},DEFAULT_VEHICLE,terrain);}
  assert(!a.grounded);assert(Math.abs(a.position.x-b.position.x)<.001);assert(Math.abs(a.position.z-b.position.z)<.001);assert(a.position.y<20);terrain.dispose();
});
test('a car resting on its side recovers instead of hanging in place',()=>{
  const terrain=world(),state=car(),body=simulateVehicle(state,neutral,1/60);
  body.orientation.setFromAxisAngle(new THREE.Vector3(0,0,1),Math.PI/2);body.lastHeading=state.heading=0;
  for(let i=0;i<360;i++)simulateVehicle(state,{...neutral,steer:-1},1/60,{},DEFAULT_VEHICLE,terrain);
  const up=new THREE.Vector3(0,1,0).applyQuaternion(body.orientation);
  assert(up.y>.9,`still rolled: ${up.toArray()}`);assert(state.position.y>-.2&&state.position.y<1);assert(state.grounded);terrain.dispose();
});
test('a fast corner preserves control and settles upright',()=>{
  const terrain=world(),state=car();state.speed=28;let lowest=1;
  for(let i=0;i<300;i++){
    simulateVehicle(state,{...neutral,throttle:i<120?.5:0,steer:i<100?.8:0},1/60,{},DEFAULT_VEHICLE,terrain);
    lowest=Math.min(lowest,new THREE.Vector3(0,1,0).applyQuaternion(state.vehicleMotion!.orientation).y);
  }
  assert(lowest>.5,`excessive roll ${lowest}`);assert(new THREE.Vector3(0,1,0).applyQuaternion(state.vehicleMotion!.orientation).y>.95);terrain.dispose();
});
test('a ramp launches the car and it returns to driving after landing',()=>{
  const floor=new THREE.PlaneGeometry(300,300).rotateX(-Math.PI/2).toNonIndexed();floor.deleteAttribute('normal');floor.deleteAttribute('uv');
  const ramp=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([-5,0,10,-5,3,20,5,0,10,5,0,10,-5,3,20,5,3,20],3));
  const terrain=new Terrain([floor,ramp],{fences:[]} as unknown as LevelData),player=car();player.speed=20;let airborne=false,highest=0;
  for(let i=0;i<360;i++){
    simulateVehicle(player,{...neutral,throttle:i<180?.7:0,handbrake:i>=180},1/60,{},DEFAULT_VEHICLE,terrain);
    if(player.position.z>20&&!player.grounded)airborne=true;highest=Math.max(highest,player.position.y);
  }
  assert(airborne,'ramp must produce a real airborne phase');assert(highest>2&&highest<12,`unstable launch height ${highest}`);assert(player.grounded,'car did not land');assert(player.position.z>30,'car remained stuck on the ramp');assert(new THREE.Vector3(0,1,0).applyQuaternion(player.vehicleMotion!.orientation).y>.9);terrain.dispose();floor.dispose();ramp.dispose();
});

test('exported wheels spin around their axles without wobbling or leaving lug nuts behind',async()=>{
  const {carFixture}=await import('./world-fixture.ts');const {vehicleProfile,renderVehicleWheels}=await import('../src/vehicle-physics.ts');
  for(const id of ['famil_v','cpolice','honor_v','chears','schoolbu']){
    const root=carFixture(id),profile=vehicleProfile(root),state=car(),body=simulateVehicle(state,neutral,0,{},profile),wheel=root.children.find(o=>o.name==='w0')!;
    renderVehicleWheels(root,body,profile);root.updateMatrixWorld(true);const width=new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3()).x;
    const childPoses=wheel.children.map(child=>({child,position:child.position.clone(),rotation:child.quaternion.clone()}));
    body.wheelSpin.fill(Math.PI/2);renderVehicleWheels(root,body,profile);root.updateMatrixWorld(true);
    assert(Math.abs(new THREE.Box3().setFromObject(wheel).getSize(new THREE.Vector3()).x-width)<.00001,`${id}: tyre tilted away from its axle`);
    for(const pose of childPoses){assert(pose.child.position.equals(pose.position));assert(pose.child.quaternion.equals(pose.rotation));}
    const top=new THREE.Vector3(0,1,0).applyQuaternion(wheel.quaternion);assert(top.z<-.99,`${id}: wheel rolls backwards`);
    body.wheelAngle=.35;renderVehicleWheels(root,body,profile);const front=root.children.find(o=>o.name==='w2')!,axle=new THREE.Vector3(1,0,0).applyQuaternion(front.quaternion);
    assert(Math.abs(axle.x-Math.cos(.35))<.00001);assert(Math.abs(axle.z+Math.sin(.35))<.00001);
    root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});
  }
});
