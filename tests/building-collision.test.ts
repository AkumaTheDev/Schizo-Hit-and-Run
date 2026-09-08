import { after,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import '../src/assets.ts';
import type { LevelData } from '../src/assets.ts';
import { Terrain,type CarState } from '../src/physics.ts';
import { staticCollisionGeometry } from '../src/collision.ts';
const json=(name:string)=>JSON.parse(readFileSync(`public/assets/${name}.json`,'utf8'));
const terrains=new Map<number,Terrain>();
function exterior(level:number){
  if(terrains.has(level))return terrains.get(level)!;
  const data=json(`level${level}`) as LevelData,geometries:THREE.BufferGeometry[]=[];
  for(const scene of data.scenes){const meta=json(scene);if(!meta.collision)continue;
    const bytes=readFileSync(`public/assets/${scene}.bin`),[offset,length]=meta.collision;
    geometries.push(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(bytes.buffer,bytes.byteOffset+offset,length).slice(),3)));
  }
  const bodies=staticCollisionGeometry(json(`collision/world-level${level}`)),terrain=new Terrain(geometries,data,bodies);
  bodies.dispose();geometries.forEach(g=>g.dispose());terrains.set(level,terrain);return terrain;
}
function state(position:THREE.Vector3):CarState{return {position,heading:0,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0};}
function walk(terrain:Terrain,player:CarState,direction:THREE.Vector3,seconds:number,speed=3.4){
  for(let frame=0;frame<seconds*60;frame++){
    const previous=player.position.clone();player.position.addScaledVector(direction,speed/60);terrain.resolve(player,previous,1/60,.35,true);
  }
}
for(const level of [1,4,7])test(`level ${level}: walking into the outside of Kwik-E-Mart cannot leave the world`,()=>{
  const terrain=exterior(level),player=state(new THREE.Vector3(213.9,5.06,300.7));
  walk(terrain,player,new THREE.Vector3(0,0,1),4);
  assert(player.position.z<303,`Crossed the outside wall: ${player.position.toArray()}`);
  assert(player.position.y>4.5,`Fell below the entrance: ${player.position.toArray()}`);
  player.verticalSpeed=7;player.position.y+=.22;walk(terrain,player,new THREE.Vector3(0,0,1),3,7.5);
  assert(player.position.z<303);assert(player.position.y>4.5);
});
for(let level=1;level<=7;level++)test(`level ${level}: exterior door approaches keep the player above their original floor`,()=>{
  const terrain=exterior(level),chapter=json(`campaign/level${level}`);
  const doors=Object.values(chapter.locators).filter((l:any)=>l.kind===7&&l.interior&&l.position[1]>-10) as any[];
  assert(doors.length>0);
  for(const door of doors){let tested=0;
    for(let side=0;side<8;side++){
      const angle=side*Math.PI/4,direction=new THREE.Vector3(Math.sin(angle),0,Math.cos(angle));
      const start=new THREE.Vector3(...door.position).addScaledVector(direction,-4),ground=terrain.ground(start.x,start.z,start.y,2);
      // Some entrance triggers (Bart's room) are above standing height.
      if(!ground||ground.point.y>start.y+.75||start.y-ground.point.y>4)continue;
      start.y=ground.point.y+.06;const player=state(start);walk(terrain,player,direction,2.5);
      assert(player.position.y>=ground.point.y-.6,`${door.name}, approach ${side}: ${player.position.toArray()}`);tested++;
    }
    assert(tested>0,`${door.name}: no supported approach was tested`);
  }
  terrain.dispose();terrains.delete(level);
});
after(()=>{for(const terrain of terrains.values())terrain.dispose();});
