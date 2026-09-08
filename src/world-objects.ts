import * as THREE from 'three';
import { staticCollisionGeometry,type StaticShape } from './collision';
import type { DynamicSolid,Terrain } from './physics';
export interface WorldObjectData {id:string;scene:string;name:string;model:string;position:[number,number,number];matrix:number[];shapes:StaticShape[];kind:number;material:number;sound:string}
export interface WorldObjectsData {extras:string[];props:WorldObjectData[];coin:string;sources:{source:string;sha256:string}[];terrainTypes:Record<string,number[]>}
export interface WorldReward {coins:number;position:THREE.Vector3;heat:boolean;inCar:boolean;crate:boolean}
interface Prop {data:WorldObjectData;solid:DynamicSolid;mesh?:THREE.Object3D;rewarded:boolean}
export class WorldObjects {
  private props=new Map<string,Prop>();private rewards:WorldReward[]=[];
  constructor(private terrain:Terrain,root:THREE.Group,data:WorldObjectsData){
    for(const source of data.props){if(source.kind===2)continue;
      const geometry=staticCollisionGeometry({version:1,source:source.id,sha256:'',shapes:source.shapes});
      const mesh=root.getObjectByName(source.id);if(!mesh)throw new Error(`Missing interactive world model ${source.id}`);
      this.props.set(source.id,{data:source,solid:terrain.addSolid(source.id,geometry),mesh,rewarded:false});
    }
    terrain.onVehicleImpact=(id,speed)=>this.hit(id,speed,true);
  }
  get entries(){return [...this.props.values()].filter(p=>p.rewarded).map(p=>p.data.id);}
  reset(entries:string[]=[]){
    const saved=new Set(entries);this.rewards=[];
    for(const prop of this.props.values()){prop.rewarded=saved.has(prop.data.id);prop.solid.active=!prop.rewarded||prop.data.kind===3;if(prop.mesh)prop.mesh.visible=prop.solid.active;}
  }
  private hit(id:string,speed:number,inCar:boolean){
    const prop=this.props.get(id);if(!prop||prop.rewarded||speed<(inCar?2:.5))return false;
    prop.rewarded=true;const crate=/crate/i.test(prop.data.model);
    if(prop.data.kind!==3){prop.solid.active=false;if(prop.mesh)prop.mesh.visible=false;}
    this.rewards.push({coins:crate?10:1,position:new THREE.Vector3(...prop.data.position).add(new THREE.Vector3(0,.8,0)),heat:!crate,inCar,crate});
    return !prop.solid.active;
  }
  kick(position:THREE.Vector3,heading:number){
    const direction=new THREE.Vector3(Math.sin(heading),0,Math.cos(heading));
    const target=this.terrain.nearbySolids(position).filter(solid=>{
      if(!this.props.has(solid.id)||this.props.get(solid.id)!.rewarded)return false;
      const nearest=solid.bounds.clampPoint(position.clone().add(new THREE.Vector3(0,.8,0)),new THREE.Vector3()),delta=nearest.sub(position);return delta.length()<2.3&&delta.dot(direction)>-.2;
    }).sort((a,b)=>a.bounds.distanceToPoint(position)-b.bounds.distanceToPoint(position))[0];
    if(!target)return false;this.hit(target.id,3,false);return true;
  }
  update(position:THREE.Vector3){for(const prop of this.props.values())if(prop.mesh)prop.mesh.visible=prop.solid.active&&prop.solid.bounds.distanceToPoint(position)<150;}
  drain(){return this.rewards.splice(0);}
}
