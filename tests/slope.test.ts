import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/assets.ts';
import { Terrain,type CarState } from '../src/physics.ts';
import { staticCollisionGeometry } from '../src/collision.ts';
import { PlayerMovement } from '../src/player-movement.ts';
import type { LevelData } from '../src/assets.ts';

/** A hillside falling away at `grade` (rise over run) in +z, as a walkable collision mesh. */
function hill(grade:number){
  const size=120,step=4,positions:number[]=[];
  for(let x=-size/2;x<size/2;x+=step)for(let z=-size/2;z<size/2;z+=step){
    const y=(w:number)=>-grade*w;
    const corners=[[x,y(z),z],[x+step,y(z),z],[x+step,y(z+step),z+step],[x,y(z+step),z+step]];
    for(const i of [0,1,2,0,2,3])positions.push(...corners[i]);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(positions),3));
  // One far-off solid, purely so the capsule solver (which needs a body tree) is the
  // path under test — the same one the game walks on.
  const bodies=staticCollisionGeometry({version:1,source:'test',sha256:'',shapes:[{kind:'box',name:'far',center:[400,0,400],axes:[[1,0,0],[0,1,0],[0,0,1]],halfExtents:[1,1,1]}]});
  const terrain=new Terrain([geometry],{fences:[]} as unknown as LevelData,bodies);
  geometry.dispose();bodies.dispose();return terrain;
}

test('running downhill keeps the player on the ground instead of playing the jump',()=>{
  for(const grade of [0.18,0.3,0.45]){
    const world=hill(grade),movement=new PlayerMovement();
    // Standing ON the hillside, not under it: the surface at z is -grade*z.
    const player:CarState={position:new THREE.Vector3(0,grade*40+0.06,-40),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0,grounded:true};
    let airborne=0,frames=0;
    for(let frame=0;frame<240;frame++){
      const animation=movement.update(player,{x:0,z:1,run:true,jump:false},1/60,world);
      if(frame<12)continue;
      frames++;
      if(!player.grounded||animation.startsWith('hom_jump'))airborne++;
    }
    console.log(`grade ${grade}: travelled ${(player.position.z+40).toFixed(1)}m, airborne ${(100*airborne/frames).toFixed(0)}% of frames`);
    assert.ok(airborne/frames<0.05,`grade ${grade}: airborne on ${(100*airborne/frames).toFixed(0)}% of frames while running downhill`);
    // Airborne means air speed, so a player who keeps leaving the slope also runs at half pace.
    assert.ok(player.position.z>-10,`grade ${grade}: only travelled ${(player.position.z+40).toFixed(1)}m in 4s`);
    world.dispose();
  }
});

test('the downhill re-seat never glues a player to a real drop',()=>{
  // A hillside that ends in a cliff: walking off it has to be a fall, not a step down.
  const world=hill(0.2),movement=new PlayerMovement();
  const player:CarState={position:new THREE.Vector3(0,0.2*40+0.06,-40),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0,grounded:true};
  for(let frame=0;frame<200;frame++)movement.update(player,{x:0,z:1,run:true,jump:false},1/60,world);
  const edge=player.position.clone();
  // Off the end of the mesh entirely — there is no floor at all beyond it.
  player.position.set(0,edge.y,70);player.grounded=true;movement.reset();
  for(let frame=0;frame<60;frame++)movement.update(player,{x:0,z:1,run:true,jump:false},1/60,world);
  assert.ok(player.position.y<edge.y-3,`stayed at ${player.position.y.toFixed(1)} instead of falling from ${edge.y.toFixed(1)}`);
  assert.equal(player.grounded,false);
  world.dispose();
});

test('a jump still leaves the ground, and lands',()=>{
  const world=hill(0.15),movement=new PlayerMovement();
  const player:CarState={position:new THREE.Vector3(0,0.15*40+0.06,-40),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0,grounded:true};
  let highest=-Infinity,left=false;
  for(let frame=0;frame<120;frame++){
    movement.update(player,{x:0,z:0,run:false,jump:frame===0},1/60,world);
    const floor=world.support(player.position.x,player.position.z,player.position.y,.06,6);
    if(floor)highest=Math.max(highest,player.position.y-floor.point.y);
    if(!player.grounded)left=true;
  }
  assert.ok(left,'the jump never left the ground');
  assert.ok(highest>1.6,`only reached ${highest.toFixed(2)}m above the slope`);
  assert.ok(player.grounded,'never landed again');
  world.dispose();
});
