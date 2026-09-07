import * as THREE from 'three';
import type { LevelData } from './assets';
export class Coins {
  mesh:THREE.InstancedMesh;total:number;collected=0;
  private positions:THREE.Vector3[];private found:Set<number>;private transform=new THREE.Object3D();private time=0;private key:string;
  constructor(scene:THREE.Scene,data:LevelData){
    const unique=new Map<string,THREE.Vector3>();
    for(const locator of data.locators){
      if(!/coin/i.test(locator.name))continue;
      const p=new THREE.Vector3(...locator.position);unique.set(p.toArray().map(v=>v.toFixed(2)).join(','),p);
    }
    this.positions=[...unique.values()];this.total=this.positions.length;this.key=`hit-and-run:coins:level-${data.id}`;
    try{const saved=JSON.parse(localStorage.getItem(this.key)??'[]');this.found=new Set(Array.isArray(saved)?saved.filter((n:unknown)=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<this.total):[]);}catch{this.found=new Set();}
    this.collected=this.found.size;
    const geometry=new THREE.CylinderGeometry(.32,.32,.08,20).rotateX(Math.PI/2);
    const material=new THREE.MeshStandardMaterial({color:0xf7c935,metalness:.55,roughness:.24,emissive:0xa45704,emissiveIntensity:.3});
    this.mesh=new THREE.InstancedMesh(geometry,material,this.total);this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.mesh.frustumCulled=false;scene.add(this.mesh);this.update(0,new THREE.Vector3(Infinity,Infinity,Infinity),false);
  }
  update(dt:number,position:THREE.Vector3,collect=true){
    this.time+=dt;let gained=0;
    this.positions.forEach((point,i)=>{
      if(collect&&!this.found.has(i)&&point.distanceTo(position)<2.9){this.found.add(i);this.collected++;gained++;}
      this.transform.position.copy(point);this.transform.position.y+=.7+Math.sin(this.time*2.8+i)*.12;this.transform.rotation.set(0,this.time*1.4+i*.35,0);this.transform.scale.setScalar(this.found.has(i)?0:1);this.transform.updateMatrix();this.mesh.setMatrixAt(i,this.transform.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate=true;
    if(gained)try{localStorage.setItem(this.key,JSON.stringify([...this.found]));}catch{/* Collection still works when browser storage is disabled. */}
    return gained;
  }
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}
}
