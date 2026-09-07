import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import '../src/assets.ts';
import type { LevelData } from '../src/assets.ts';
import { Terrain } from '../src/physics.ts';
const root=resolve('public/assets');
const json=(name:string)=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
for(let level=1;level<=7;level++)test(`level ${level}: every converted buffer and spawn is valid`,()=>{
  const data=json(`level${level}.json`) as LevelData;
  const collisions:THREE.BufferGeometry[]=[];
  for(const file of data.scenes){
    const meta=json(`${file}.json`),bytes=readFileSync(resolve(root,`${file}.bin`));
    for(const primitives of Object.values(meta.meshes) as any[][])for(const primitive of primitives){
      for(const [offset,length] of Object.values(primitive.attributes) as [number,number][]){assert(offset%4===0);assert(offset+length*4<=bytes.length);}
      const material=meta.materials[primitive.shader];assert(material,`material ${primitive.shader}`);
      assert(!material.texture||material.textureUrl&&existsSync(resolve(root,material.textureUrl)),`${file}: missing texture ${primitive.shader} (${material.texture})`);
    }
    if(meta.collision){const [offset,length]=meta.collision;const array=new Float32Array(bytes.buffer,bytes.byteOffset+offset,length).slice();assert([...array].every(Number.isFinite));const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(array,3));collisions.push(g);}
  }
  const terrain=new Terrain(collisions,data);
  for(const place of data.locations){
    const original=new THREE.Vector3(...place.position);let closest=original,dist=Infinity;
    for(const [a,b] of data.roads){const point=new THREE.Line3(new THREE.Vector3(...a as [number,number,number]),new THREE.Vector3(...b as [number,number,number])).closestPointToPoint(original,true,new THREE.Vector3());const d=point.distanceTo(original);if(d<dist){dist=d;closest=point;}}
    assert(terrain.ground(closest.x,closest.z,closest.y,10),`${place.name}: road spawn has no ground`);
  }
  terrain.dispose();collisions.forEach(g=>g.dispose());
});
for(const character of ['homer','bart','lisa','marge','apu'])test(`${character} has normalized skin weights and matching animation bones`,()=>{
  const meta=json(`${character}.json`),bytes=readFileSync(resolve(root,`${character}.bin`));const names=new Set(meta.bones.map((b:any)=>b.name));
  for(const primitive of meta.primitives){
    const [offset,length]=primitive.attributes.skinWeight;const weights=new Float32Array(bytes.buffer,bytes.byteOffset+offset,length);
    for(let i=0;i<weights.length;i+=4)assert(Math.abs(weights[i]+weights[i+1]+weights[i+2]+weights[i+3]-1)<.001);
    const [io,il]=primitive.attributes.skinIndex;const indices=new Float32Array(bytes.buffer,bytes.byteOffset+io,il);assert([...indices].every(i=>i>=0&&i<meta.bones.length));
  }
  assert.equal(meta.animations.length,8);for(const animation of meta.animations)for(const track of animation.tracks)assert(names.has(track.bone));
});
