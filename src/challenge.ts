import * as THREE from 'three';
import type { Place,LevelData } from './assets';
export class Challenge {
  active=false;elapsed=0;remaining=300;index=0;route:Place[]=[];
  group=new THREE.Group();
  private ring:THREE.Mesh;
  private beacon:THREE.Mesh;
  constructor(scene:THREE.Scene){
    this.ring=new THREE.Mesh(new THREE.TorusGeometry(5.5,0.13,8,64),new THREE.MeshBasicMaterial({color:0xffd94e,toneMapped:false}));
    this.ring.rotation.x=Math.PI/2;
    this.beacon=new THREE.Mesh(new THREE.CylinderGeometry(4,4,35,32,1,true),new THREE.MeshBasicMaterial({color:0xffd94e,transparent:true,opacity:0.08,depthWrite:false,side:THREE.DoubleSide,toneMapped:false}));
    this.beacon.position.y=17;this.group.add(this.ring,this.beacon);this.group.visible=false;scene.add(this.group);
  }
  start(data:LevelData){
    const order=[1,3,4,7,0];
    this.route=order.filter(i=>data.locations[i]).map(i=>data.locations[i]);
    if(this.route.length<2)this.route=data.locations.slice(0,5);
    this.index=0;this.elapsed=0;this.remaining=300;this.active=this.route.length>0;this.place();
  }
  private place(){const target=this.route[this.index];this.group.visible=this.active&&!!target;if(target)this.group.position.set(...target.position).add(new THREE.Vector3(0,0.25,0));}
  stop(){this.active=false;this.group.visible=false;}
  update(dt:number,position:THREE.Vector3):'checkpoint'|'complete'|'failed'|null{
    if(!this.active)return null;
    this.elapsed+=dt;this.remaining-=dt;this.ring.scale.setScalar(1+Math.sin(this.elapsed*3)*0.025);
    if(this.remaining<=0){this.stop();return 'failed';}
    if(position.distanceTo(this.group.position)<9){
      this.index++;if(this.index>=this.route.length){this.stop();return 'complete';}
      this.place();return 'checkpoint';
    }
    return null;
  }
  dispose(){this.group.removeFromParent();for(const mesh of [this.ring,this.beacon]){mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}}
}
