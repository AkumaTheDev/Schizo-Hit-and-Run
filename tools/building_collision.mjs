/**
 * Give every reachable building a collider.
 *
 * The exported world collision covers most of the city, but not all of it: a number of
 * building-sized objects have no shape at all behind them, and a car drives straight
 * through those. This finds them and writes their OWN geometry out as collision, which
 * is the accurate answer — a box around a wide, flat storefront could wall off the road
 * running past it.
 *
 * An object qualifies only if it is building-sized, close enough to a road for a car to
 * reach, and returns NO contact anywhere in its footprint from the collision the game
 * already has. So this only ever adds collision where there is none.
 *
 * RUN   node --import tsx tools/building_collision.mjs
 * OUT   public/assets/collision/buildings-level{1..7}.json + .bin
 */
import { readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import '../src/assets.ts';
// The one headless build of the real world, shared with the test suite.
import { worldFixture } from '../tests/world-fixture.ts';

const A='public/assets';
const HALF=new THREE.Vector3(1.0,0.7,2.3);          // roughly a family sedan
const UPRIGHT=new THREE.Quaternion();
/** Landscape shells and track dressing are scenery, and are not meant to stop a car. */
const SCENERY=/gens|track|fenceline|valley|cliff|horizon|cloud|terra|sky|water|road/i;

for(const level of [1,2,3,4,5,6,7]){
  // Detect against the world WITHOUT this tool's own output, or a second run would
  // find nothing and overwrite the file with an empty one.
  const {terrain,data}=worldFixture(level,{buildings:false});
  const roadDistance=(x,z)=>{
    let best=Infinity;
    for(const [a,b] of data.roads){
      const ax=a[0],az=a[2],dx=b[0]-ax,dz=b[2]-az,len=dx*dx+dz*dz;
      const t=len>1e-6?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/len)):0;
      best=Math.min(best,Math.hypot(x-(ax+dx*t),z-(az+dz*t)));
    }
    return best;
  };
  const lvl=JSON.parse(readFileSync(`${A}/level${level}.json`,'utf8'));
  const positions=[];const found=[];
  for(const scene of lvl.scenes){
    const meta=JSON.parse(readFileSync(`${A}/${scene}.json`,'utf8'));
    const bin=readFileSync(`${A}/${scene}.bin`);
    const read=range=>new Float32Array(bin.buffer,bin.byteOffset+range[0],range[1]);
    /** Every triangle of one exported mesh, in its own space. */
    const trianglesOf=name=>{
      const out=[];
      for(const primitive of meta.meshes[name]??[]){
        const vertex=primitive.attributes?.position;if(!vertex)continue;
        const points=read(vertex);
        const range=primitive.attributes.indices;
        if(range){
          const index=new Uint32Array(bin.buffer,bin.byteOffset+range[0],range[1]);
          for(const i of index)out.push(points[i*3],points[i*3+1],points[i*3+2]);
        }else for(let i=0;i<points.length;i++)out.push(points[i]);
      }
      return out;
    };
    const boxes=new Map();
    for(const name of Object.keys(meta.meshes)){
      const box=new THREE.Box3(),point=new THREE.Vector3();
      for(const primitive of meta.meshes[name]){
        const vertex=primitive.attributes?.position;if(!vertex)continue;
        const points=read(vertex);
        for(let i=0;i<points.length;i+=3)box.expandByPoint(point.set(points[i],points[i+1],points[i+2]));
      }
      boxes.set(name,box);
    }
    for(const object of meta.objects){
      const local=boxes.get(object.mesh);
      if(!local||local.isEmpty()||SCENERY.test(object.mesh))continue;
      const matrix=new THREE.Matrix4().fromArray(object.matrix);
      const box=local.clone().applyMatrix4(matrix);
      const size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());
      if(size.y<4||Math.min(size.x,size.z)<6||size.x>120||size.z>120)continue;
      if(roadDistance(centre.x,centre.z)>45)continue;
      // The same question the car asks, across the footprint at bumper height. The height
      // has to come from the GROUND under each sample: these meshes reach a long way
      // below the street, and probing from a mesh's lowest vertex asks underground.
      let covered=false,standable=0,probe=null;
      for(let ix=-1;ix<=1&&!covered;ix++)for(let iz=-1;iz<=1&&!covered;iz++){
        const x=centre.x+ix*size.x*0.3,z=centre.z+iz*size.z*0.3;
        const floor=terrain.ground(x,z,box.max.y,box.max.y-box.min.y+8);
        if(!floor)continue;
        standable++;
        if(!probe)probe=[+x.toFixed(2),+(floor.point.y+0.9).toFixed(2),+z.toFixed(2)];
        for(const height of [0.9,2.0]){
          const contact=terrain.boxContact(new THREE.Vector3(x,floor.point.y+height,z),HALF,UPRIGHT);
          if(contact&&contact.depth>1e-4){covered=true;break;}
        }
      }
      // Nothing to stand on anywhere in the footprint means it is not on the map a car drives.
      if(covered||!standable)continue;
      const local3=trianglesOf(object.mesh);
      if(local3.length<9)continue;
      const point=new THREE.Vector3();
      const world=[];
      for(let i=0;i<local3.length;i+=3){
        point.set(local3[i],local3[i+1],local3[i+2]).applyMatrix4(matrix);
        world.push(point.x,point.y,point.z);positions.push(point.x,point.y,point.z);
      }
      // Record a point ON the building, near bumper height, so the check afterwards asks
      // about the surface a car would actually meet rather than the middle of a footprint
      // an irregular building may not even occupy.
      const wanted=(probe?probe[1]:box.min.y)+0.2;
      let best=Infinity,at=probe;
      for(let i=0;i<world.length;i+=9){
        const cx=(world[i]+world[i+3]+world[i+6])/3,cy=(world[i+1]+world[i+4]+world[i+7])/3,cz=(world[i+2]+world[i+5]+world[i+8])/3;
        const away=Math.abs(cy-wanted);
        if(away<best){best=away;at=[+cx.toFixed(2),+cy.toFixed(2),+cz.toFixed(2)];}
      }
      found.push({scene,mesh:object.mesh,triangles:local3.length/9,probe:at});
    }
  }
  const buffer=Float32Array.from(positions);
  writeFileSync(`${A}/collision/buildings-level${level}.bin`,Buffer.from(buffer.buffer));
  writeFileSync(`${A}/collision/buildings-level${level}.json`,JSON.stringify({
    version:1,level,source:`level${level}`,objects:found,positions:[0,buffer.length],
  },null,1));
  const triangles=found.reduce((n,f)=>n+f.triangles,0);
  console.log(`level ${level}: ${found.length} buildings had no collider · ${triangles} triangles · ${(buffer.byteLength/1024).toFixed(0)} kB`);
  terrain.dispose();
}
