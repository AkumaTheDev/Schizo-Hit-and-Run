import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import '../src/assets.ts';
import { Terrain,type CarState } from '../src/physics.ts';
import { staticCollisionGeometry } from '../src/collision.ts';
import { PlayerMovement,PLAYER_RULES,rulesFor } from '../src/player-movement.ts';
import { BUILDS,FIGHTERS,NEUTRAL,REFERENCE,fighterFor,fighterFrom } from '../src/fighters.ts';

const idle={x:0,z:0,run:false,jump:false};
const state=():CarState=>({position:new THREE.Vector3(0,.06,0),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0,grounded:true});
function floor(){
  const plane=new THREE.PlaneGeometry(100,100).rotateX(-Math.PI/2).toNonIndexed();plane.deleteAttribute('uv');plane.deleteAttribute('normal');
  // A body has to exist for the walker's capsule sweep, so park a slab well out of reach.
  const bodies=staticCollisionGeometry({version:1,source:'test',sha256:'',shapes:[{kind:'box',name:'far',center:[0,-40,0],axes:[[1,0,0],[0,1,0],[0,0,1]],halfExtents:[1,1,1]}]});
  const terrain=new Terrain([plane],{fences:[]} as never,bodies);plane.dispose();bodies.dispose();return terrain;
}

test('the reference body fights exactly as the game always did',()=>{
  const reference=fighterFor('SchizoAxe.vrm');
  assert.equal(reference.weight,100);
  assert.equal(reference.jumps,2);
  for(const field of ['speed','gravity','jump','traction'] as const)
    assert.equal(reference[field],1,`${field} is ${reference[field]}`);
  const rules=rulesFor(reference);
  for(const [name,value] of Object.entries(PLAYER_RULES))
    assert.equal(rules[name as keyof typeof rules],value,`${name} moved`);
});

test('a lighter body is faster, floatier and gets a third jump',()=>{
  const feather=fighterFor('JIGGAZ0.vrm'),heavy=fighterFor('BROLY.vrm');
  assert(feather.weight<60,`feather weighs ${feather.weight}`);
  assert(heavy.weight>110,`heavy weighs ${heavy.weight}`);
  assert(feather.speed>heavy.speed);
  assert(feather.gravity<heavy.gravity);
  assert(feather.traction<heavy.traction);
  assert.equal(feather.jumps,3);
  assert.equal(heavy.jumps,2);
});

test('every shipped body is a fighter, and nobody is a clone of the whole roster',()=>{
  assert.equal(FIGHTERS.length,Object.keys(BUILDS).length);
  assert(new Set(FIGHTERS.map(f=>f.weight)).size>4,'the roster barely differs');
  for(const fighter of FIGHTERS){
    assert(fighter.weight>=30&&fighter.weight<=150,`${fighter.name} weighs ${fighter.weight}`);
    assert(fighter.speed>=0.85&&fighter.speed<=1.25,`${fighter.name} runs ${fighter.speed}`);
  }
});

test('an unmeasured body, such as the cartoon cast, fights as the reference does',()=>{
  const cast=fighterFor('homer');
  assert.equal(cast.weight,NEUTRAL.weight);
  assert.equal(cast.jumps,NEUTRAL.jumps);
  assert.equal(cast.name,'homer');
  assert.deepEqual(fighterFrom('x','x',REFERENCE).speed,1);
});

test('a featherweight really does get the third jump in the air',()=>{
  const world=floor(),player=state(),movement=new PlayerMovement();
  movement.setFighter(fighterFor('JIGGAZ0.vrm'));
  let third=false;
  for(let frame=0;frame<200;frame++){
    const request=frame===0||frame===20||frame===40;
    movement.update(player,{...idle,jump:request},1/60,world);
    if(frame===40)third=movement.jumps===3;
  }
  assert(third,'the third jump never happened');
  const reference=new PlayerMovement();reference.setFighter(fighterFor('SchizoAxe.vrm'));
  const other=state();let capped=0;
  for(let frame=0;frame<200;frame++){
    reference.update(other,{...idle,jump:frame===0||frame===20||frame===40},1/60,world);
    capped=Math.max(capped,reference.jumps);
  }
  assert.equal(capped,2,'the reference took a third jump');
  world.dispose();
});
