import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import '../src/assets.ts';
import { Terrain } from '../src/physics.ts';
import { staticCollisionGeometry } from '../src/collision.ts';
import type { WorldObjectsData } from '../src/world-objects.ts';
import type { LevelData } from '../src/assets.ts';
export const assetJSON=(name:string)=>JSON.parse(readFileSync(`public/assets/${name}.json`,'utf8'));
export function worldFixture(level=1){
  const data=assetJSON(`level${level}`) as LevelData;data.navigation=assetJSON(`world/navigation${level}`);const objects=assetJSON(`world/objects${level}`) as WorldObjectsData;
  const geometries=data.scenes.flatMap(scene=>{const meta=assetJSON(scene);if(!meta.collision)return [];const b=readFileSync(`public/assets/${scene}.bin`),[offset,length]=meta.collision;return [new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(b.buffer,b.byteOffset+offset,length).slice(),3))];});
  const physics=assetJSON(`collision/world-level${level}`),bodies=staticCollisionGeometry({...physics,shapes:[...physics.shapes,...objects.props.filter(p=>p.kind===2).flatMap(p=>p.shapes)]});
  const terrain=new Terrain(geometries,data,bodies,data.scenes.flatMap(scene=>objects.terrainTypes[scene]));bodies.dispose();geometries.forEach(g=>g.dispose());
  for(const p of objects.props)if(p.kind!==2)terrain.addSolid(p.id,staticCollisionGeometry({version:1,source:p.id,sha256:'',shapes:p.shapes}));
  return {data,objects,terrain};
}
/** Load exported transforms/geometry without needing a browser image decoder. */
export function carFixture(id:string){
  const bytes=readFileSync(`public/assets/remaster/car-${id}.glb`),length=bytes.readUInt32LE(12),g=JSON.parse(bytes.toString('utf8',20,20+length)),binary=bytes.subarray(28+length);
  const objects=g.nodes.map((node:any)=>{
    const group=new THREE.Group();group.name=node.extras?.p3dName??node.name??'';
    if(node.matrix)group.applyMatrix4(new THREE.Matrix4().fromArray(node.matrix));else{if(node.translation)group.position.fromArray(node.translation);if(node.rotation)group.quaternion.fromArray(node.rotation);if(node.scale)group.scale.fromArray(node.scale);}
    if(node.mesh!==undefined)for(const p of g.meshes[node.mesh].primitives){
      const a=g.accessors[p.attributes.POSITION],v=g.bufferViews[a.bufferView],position=new Float32Array(a.count*3),offset=v.byteOffset+(a.byteOffset??0);
      for(let i=0;i<a.count;i++)for(let c=0;c<3;c++)position[i*3+c]=binary.readFloatLE(offset+i*(v.byteStride??12)+c*4);
      const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(position,3));group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));
    }
    return group;
  });
  g.nodes.forEach((node:any,i:number)=>node.children?.forEach((child:number)=>objects[i].add(objects[child])));const root=objects[g.scenes[g.scene??0].nodes[0]];root.updateMatrixWorld(true);return root as THREE.Group;
}
