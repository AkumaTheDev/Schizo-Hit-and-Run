import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree=computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree=disposeBoundsTree;
THREE.Mesh.prototype.raycast=acceleratedRaycast;
const { staticCollisionGeometry }=await import('./src/collision.ts');
const json=n=>JSON.parse(readFileSync(`public/assets/${n}.json`,'utf8'));
const data=json('level1'),objects=json('world/objects1');
const scenery=new Set(json('remaster/scenery').scenes);
const geometries=[];
for(const name of [...data.scenes,...objects.extras]){
  const path=scenery.has(name)?`remaster/scenes/${name}`:name;
  const meta=json(path);if(!meta.collision)continue;
  const bytes=readFileSync(`public/assets/${path}.bin`);const [offset,length]=meta.collision;
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(bytes.buffer,bytes.byteOffset+offset,length),3));
  geometries.push(g);
}
const physics=json('collision/world-level1');
const shapes=[...physics.shapes,...objects.props.filter(p=>p.kind===2).flatMap(p=>p.shapes)];
const bodies=staticCollisionGeometry({...physics,shapes});
const geometry=mergeGeometries(geometries);
const triangles=[];
for(const source of [geometry,bodies]){
  const positions=source.getAttribute('position'),indices=source.index;
  for(let i=0;i<(indices?.count??positions.count);i+=3){
    const p=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(i+j):i+j));
    const tri=new THREE.Triangle(p[0],p[1],p[2]);
    if(tri.getArea()<1e-8)continue;
    if(source===geometry&&tri.getNormal(new THREE.Vector3()).y<0){tri.a=p[2];tri.c=p[0];}
    triangles.push(tri);
  }
}
const TILE=Number(process.argv[2]||25);
let t=Date.now();
const tiles=new Map();const box=new THREE.Box3();
for(const tri of triangles){
  box.makeEmpty().expandByPoint(tri.a).expandByPoint(tri.b).expandByPoint(tri.c);
  for(let x=Math.floor(box.min.x/TILE);x<=Math.floor(box.max.x/TILE);x++)
    for(let z=Math.floor(box.min.z/TILE);z<=Math.floor(box.max.z/TILE);z++){
      const key=x+','+z;let tree=tiles.get(key);
      if(!tree){tree=new Octree();tiles.set(key,tree);}
      tree.addTriangle(tri);
    }
}
for(const tree of tiles.values())tree.build();
console.log(`tile ${TILE}m: build ${Date.now()-t} ms · ${tiles.size} trees`);
t=Date.now();
const whole=new Octree();for(const tri of triangles)whole.addTriangle(tri);whole.build();
console.log('whole build',Date.now()-t,'ms');
const spots=[...data.locations,...data.locators].map(l=>l.position);
let same=0,differ=0,worst=0,hits=0;
for(let i=0;i<2000;i++){
  const p=spots[i%spots.length];
  const c=new THREE.Vector3(p[0]+(Math.random()-.5)*30,p[1]+.9,p[2]+(Math.random()-.5)*30);
  const make=()=>new Capsule(c.clone().setY(c.y-.55),c.clone().setY(c.y+.55),.35);
  const a=whole.capsuleIntersect(make());
  let b=false;
  for(let x=Math.floor((c.x-.35)/TILE);x<=Math.floor((c.x+.35)/TILE);x++)
    for(let z=Math.floor((c.z-.35)/TILE);z<=Math.floor((c.z+.35)/TILE);z++){
      const tree=tiles.get(x+','+z);if(!tree)continue;
      const next=tree.capsuleIntersect(make());
      if(next&&(!b||next.depth>b.depth))b=next;
    }
  if(!!a!==!!b){differ++;continue;}
  if(!a){same++;continue;}
  hits++;
  const d=Math.abs(a.depth-b.depth)+a.normal.distanceTo(b.normal);
  if(d<1e-6)same++;else{differ++;worst=Math.max(worst,d);}
}
console.log(`probes: same ${same} differ ${differ} (hits ${hits}, worst delta ${worst.toFixed(4)})`);
