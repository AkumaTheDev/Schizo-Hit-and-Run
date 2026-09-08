import * as THREE from 'three';
import type { Assets,LevelData } from './assets';
import { COIN_RULES,CoinSimulation } from './coin-simulation';
export class Coins {
  mesh:THREE.InstancedMesh;total:number;collected=0;
  readonly simulation:CoinSimulation;private transform=new THREE.Object3D();private key:string;
  constructor(scene:THREE.Scene,data:LevelData){
    const unique=new Map<string,THREE.Vector3>();
    for(const locator of data.locators){
      if(locator.kind!==14)continue;
      const p=new THREE.Vector3(...locator.position);unique.set(p.toArray().map(v=>v.toFixed(2)).join(','),p);
    }
    const positions=[...unique.values()];this.total=positions.length;this.key=`hit-and-run:coins:level-${data.id}`;this.simulation=new CoinSimulation(positions);
    try{const saved=JSON.parse(localStorage.getItem(this.key)??'[]');this.simulation.reset(Array.isArray(saved)?saved:[]);}catch{this.simulation.reset();}
    this.collected=this.simulation.found.size;
    const geometry=new THREE.CylinderGeometry(.32,.32,.08,20).rotateX(Math.PI/2);
    const material=new THREE.MeshStandardMaterial({color:0xf7c935,metalness:.55,roughness:.24,emissive:0xa45704,emissiveIntensity:.3});
    this.mesh=new THREE.InstancedMesh(geometry,material,this.simulation.coins.length);this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.mesh.frustumCulled=false;scene.add(this.mesh);this.update(0,new THREE.Vector3(Infinity,Infinity,Infinity),false);
  }
  get entries(){return [...this.simulation.found];}
  async load(assets:Assets,name:string){
    const asset=await assets.load(name);let source:THREE.Mesh|undefined;asset.root.traverse(o=>{if(o instanceof THREE.Mesh)source=o;});
    if(!source)throw new Error(`Missing original coin drawable ${name}`);
    this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry=source.geometry.clone();this.mesh.material=(source.material as THREE.Material).clone();
  }
  reset(entries:number[]=[]){this.simulation.reset(entries);this.collected=this.simulation.found.size;}
  drop(amount:number,position:THREE.Vector3,floor:number,autoCollect=false){return this.simulation.drop(amount,position,floor,autoCollect);}
  update(dt:number,position:THREE.Vector3,collect=true,inCar=false){
    const gained=this.simulation.update(dt,position,inCar,collect);this.collected=this.simulation.found.size;
    this.simulation.coins.forEach((coin,i)=>{
      const visible=coin.active&&coin.position.distanceToSquared(position)<COIN_RULES.drawDistance**2;
      const fade=coin.trail<0?1-Math.max(0,coin.age-COIN_RULES.fadeSeconds)/(COIN_RULES.lifetime-COIN_RULES.fadeSeconds):1;
      this.transform.position.copy(coin.position);this.transform.rotation.set(0,coin.spin,0);this.transform.scale.setScalar(visible?Math.max(0,fade):0);this.transform.updateMatrix();this.mesh.setMatrixAt(i,this.transform.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate=true;
    if(gained)try{localStorage.setItem(this.key,JSON.stringify(this.entries));}catch{/* Collection still works when browser storage is disabled. */}
    return gained;
  }
  dispose(){this.mesh.removeFromParent();this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}
}
