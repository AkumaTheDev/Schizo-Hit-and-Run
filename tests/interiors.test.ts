import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import '../src/assets.ts';
import type { LevelData } from '../src/assets.ts';
import { Terrain, type CarState } from '../src/physics.ts';
import { staticCollisionGeometry, type InteriorCollision } from '../src/collision.ts';

const json=(path:string)=>JSON.parse(readFileSync(`public/assets/${path}.json`,'utf8'));
const stateAt=(position:number[]):CarState=>({position:new THREE.Vector3(...position as [number,number,number]),heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0});
function roomTerrain(scene:string){
  const meta=json(scene),bytes=readFileSync(`public/assets/${scene}.bin`);
  const [offset,length]=meta.collision;
  const floor=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(bytes.buffer,bytes.byteOffset+offset,length).slice(),3));
  const shapes=json(`collision/${scene}`) as InteriorCollision;
  const bodies=staticCollisionGeometry(shapes);
  const terrain=new Terrain([floor],{fences:[]} as unknown as LevelData,bodies);
  floor.dispose();bodies.dispose();return terrain;
}
function walk(terrain:Terrain,state:CarState,dx:number,dz:number,seconds:number,dt=1/60){
  for(let t=0;t<seconds;t+=dt){
    const previous=state.position.clone();state.position.x+=dx*dt;state.position.z+=dz*dt;
    terrain.resolve(state,previous,dt,.35,true);
    assert(Number.isFinite(state.position.y));
  }
}

for(let level=1;level<=7;level++)for(const room of json(`campaign/level${level}`).interiors){
  test(`${room.scene}: original entry and exit remain on a floor with solid room boundaries`,()=>{
    const terrain=roomTerrain(room.scene);
    try{
      const entry=stateAt(room.start.position);walk(terrain,entry,0,0,2);
      assert(Math.abs(entry.position.y-room.start.position[1])<.3,`${room.name}: unsupported entry at ${entry.position.toArray()}`);
      // Exit locators are trigger centers, sometimes behind a door's solid face.
      // Approach them from inside rather than spawning inside the wall itself.
      const towardExit=new THREE.Vector3(...room.exit.position).sub(entry.position).setY(0).normalize().multiplyScalar(3.4);
      walk(terrain,entry,towardExit.x,towardExit.z,1);
      assert(entry.position.distanceTo(new THREE.Vector3(...room.exit.position))<3,`${room.name}: exit trigger cannot be reached`);
      assert(entry.position.y>=room.start.position[1]-.3,`${room.name}: fell approaching the exit`);
      // Probe eight directions from each real entry; this reproduces leaving a
      // finite floor through an omitted wall without relying on invented bounds.
      for(let direction=0;direction<8;direction++){
        const state=stateAt(room.start.position),angle=direction*Math.PI/4;
        walk(terrain,state,7.5*Math.sin(angle),7.5*Math.cos(angle),4);
        assert(state.position.y>=room.start.position[1]-.4,`${room.name}: fell in direction ${direction}: ${state.position.toArray()}`);
      }
    }finally{terrain.dispose();}
  });
}

test('Kwik-E-Mart back wall stops the reported fall while leaving the exit reachable',()=>{
  const terrain=roomTerrain('l1i01');
  try{
    const room=json('campaign/level1').interiors.find((r:any)=>r.scene==='l1i01');
    for(const dt of [1/60,1/15]){
      const state=stateAt(room.start.position);walk(terrain,state,0,7.5,4,dt);
      assert(state.position.z>305&&state.position.z<305.5,`${state.position.toArray()}`);
      assert(Math.abs(state.position.y+19.94)<.02);
      assert(state.position.distanceTo(new THREE.Vector3(...room.exit.position))<3);
      state.verticalSpeed=7;state.position.y+=.22;walk(terrain,state,0,7.5,2,dt);
      assert(state.position.z<305.5,'Jump must not pass through the wall');
      assert(Math.abs(state.position.y+19.94)<.02,'Jump must return to the source floor');
    }
  }finally{terrain.dispose();}
});

test('interior collision export covers every scene and retains a source hash',()=>{
  const manifest=json('collision/interiors');assert.equal(manifest.scenes.length,19);assert.deepEqual(manifest.errors,[]);
  const counts:Record<string,number>={};
  for(const {scene,shapes,sha256} of manifest.scenes){
    const data=json(`collision/${scene}`) as InteriorCollision;assert.match(sha256,/^[a-f0-9]{64}$/);assert.equal(data.sha256,sha256);assert.equal(data.shapes.length,shapes);
    for(const shape of data.shapes){counts[shape.kind]=(counts[shape.kind]??0)+1;assert(shape.center.every(Number.isFinite));}
  }
  assert.deepEqual(counts,{box:427,cylinder:43,sphere:17});
});
