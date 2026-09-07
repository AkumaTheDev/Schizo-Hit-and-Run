import { assetURL } from './assets';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export class Grass {
  private mesh!:THREE.InstancedMesh;private surfaces:THREE.Mesh[]=[];private ray=new THREE.Raycaster();private last=new THREE.Vector3(Infinity,Infinity,Infinity);private transform=new THREE.Object3D();
  private slots=Array<string>(1600).fill('');private pending:{gx:number;gz:number;y:number}[]=[];
  private origin=new THREE.Vector3();private down=new THREE.Vector3(0,-1,0);
  async load(group:THREE.Group){
    group.traverse(object=>{if(object instanceof THREE.Mesh&&/grass/i.test((object.material as THREE.Material).name)){object.geometry.computeBoundsTree();this.surfaces.push(object);}});
    const gltf=await new GLTFLoader().loadAsync(assetURL('remaster/grass.glb'));let source:THREE.Mesh|undefined;
    gltf.scene.traverse(object=>{if(object instanceof THREE.Mesh)source=object;});if(!source)return;
    const geometry=source.geometry.clone();const material=(source.material as THREE.MeshStandardMaterial).clone();material.side=THREE.DoubleSide;material.color.set(0x8fbb4a);
    this.mesh=new THREE.InstancedMesh(geometry,material,1600);this.mesh.frustumCulled=false;this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.transform.scale.setScalar(0);this.transform.updateMatrix();for(let i=0;i<1600;i++)this.mesh.setMatrixAt(i,this.transform.matrix);
    group.add(this.mesh);group.updateMatrixWorld(true);this.ray.firstHitOnly=true;
  }
  update(position:THREE.Vector3){
    if(!this.mesh)return;
    if(this.last.distanceToSquared(position)>=64){
      if(Math.abs(this.last.y-position.y)>12)this.slots.fill('');
      this.last.copy(position);this.pending=[];const px=Math.floor(position.x/2),pz=Math.floor(position.z/2);
      for(let dx=-20;dx<20;dx++)for(let dz=-20;dz<20;dz++){
        const gx=px+dx,gz=pz+dz,slot=THREE.MathUtils.euclideanModulo(gx,40)*40+THREE.MathUtils.euclideanModulo(gz,40);
        if(this.slots[slot]!==`${gx},${gz}`)this.pending.push({gx,gz,y:position.y});
      }
      // Establish the nearest patches first. Existing overlapping cells stay in place.
      this.pending.sort((a,b)=>(b.gx-px)**2+(b.gz-pz)**2-((a.gx-px)**2+(a.gz-pz)**2));
    }
    const start=performance.now();let changed=false;
    for(let work=0;work<24&&this.pending.length&&performance.now()-start<1;work++){
      const {gx,gz,y}=this.pending.pop()!,slot=THREE.MathUtils.euclideanModulo(gx,40)*40+THREE.MathUtils.euclideanModulo(gz,40);
      const seed=Math.sin(gx*12.9898+gz*78.233)*43758.5453,jitter=seed-Math.floor(seed),x=gx*2+jitter*1.7,z=gz*2+(1-jitter)*1.7;
      this.origin.set(x,y+15,z);this.ray.set(this.origin,this.down);this.ray.far=35;
      const hit=this.ray.intersectObjects(this.surfaces,false)[0];this.transform.position.set(x,hit?hit.point.y+.015:-100,z);this.transform.rotation.set(0,jitter*6.28,0);this.transform.scale.setScalar(hit?.face&&Math.abs(hit.face.normal.y)>.6?.8+jitter*.7:0);this.transform.updateMatrix();this.mesh.setMatrixAt(slot,this.transform.matrix);
      this.slots[slot]=`${gx},${gz}`;changed=true;
    }
    if(changed)this.mesh.instanceMatrix.needsUpdate=true;
  }
  dispose(){if(this.mesh){this.mesh.removeFromParent();this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}}
}
