import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { worldFixture,assetJSON } from './world-fixture.ts';

/**
 * The world export left a number of reachable buildings with no collision shape behind
 * them, and a car drove through those. tools/building_collision.mjs writes each one's own
 * geometry out as collision; this asks the same question the car's contact test asks, at
 * the point in each footprint the tool recorded as previously empty.
 *
 * One level at a time, disposed as it goes: seven worlds alive together exhausts the heap.
 */
const CAR=new THREE.Vector3(1.0,0.7,2.3),UPRIGHT=new THREE.Quaternion();
interface Listed {scene:string;mesh:string;triangles:number;probe:[number,number,number]}

for(const level of [1,2,3,4,5,6,7]){
  test(`level ${level}: every building the export missed is solid now`,()=>{
    const listed=assetJSON(`collision/buildings-level${level}`).objects as Listed[];
    assert(listed.length>0,'nothing was generated for this level');
    const {terrain}=worldFixture(level);
    try{
      for(const building of listed){
        // Sweep a car-sized box across the footprint: it has to touch the building.
        let touched=false;
        for(let step=-2;step<=2&&!touched;step++){
          const at=new THREE.Vector3(building.probe[0]+step*0.8,building.probe[1],building.probe[2]);
          const contact=terrain.boxContact(at,CAR,UPRIGHT);
          if(contact&&contact.depth>1e-4)touched=true;
        }
        assert(touched,`${building.scene}/${building.mesh} still lets a car through at ${building.probe.join(',')}`);
      }
    }finally{terrain.dispose();}
  });
}

test('the colliders are the buildings own geometry, not boxes around them',()=>{
  // A box would be twelve triangles every time, and would risk walling off the street a
  // wide flat storefront stands on.
  const listed=assetJSON('collision/buildings-level5').objects as Listed[];
  assert(new Set(listed.map(b=>b.triangles)).size>2,'every collider has the same triangle count');
  assert(listed.some(b=>b.triangles>12),'no collider carries more detail than a box');
});
