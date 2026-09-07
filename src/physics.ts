import * as THREE from 'three';
import type { LevelData } from './assets';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface Controls {steer:number;throttle:number;brake:number;handbrake:boolean}
export interface CarState {position:THREE.Vector3;heading:number;speed:number;verticalSpeed:number;steer:number;distance:number;damage:number}
const up=new THREE.Vector3(0,1,0), down=new THREE.Vector3(0,-1,0);

export function drive(state:CarState,control:Controls,dt:number) {
  const acceleration=control.throttle*13 - control.brake*(state.speed>1?24:7);
  state.speed+=acceleration*dt;
  const drag=control.handbrake?4.5:(control.throttle||control.brake?0.14:0.7);
  state.speed*=Math.exp(-drag*dt);
  state.speed=THREE.MathUtils.clamp(state.speed,-12,43);
  if (Math.abs(state.speed)<0.03) state.speed=0;
  state.steer=THREE.MathUtils.damp(state.steer,control.steer,8,dt);
  const turning=state.steer*Math.min(Math.abs(state.speed)/6,1)*Math.sign(state.speed)*(control.handbrake?1.9:1.25)/(1+Math.abs(state.speed)*0.012);
  state.heading-=turning*dt;
  state.position.x+=Math.sin(state.heading)*state.speed*dt;
  state.position.z+=Math.cos(state.heading)*state.speed*dt;
  state.distance+=Math.abs(state.speed)*dt;
}

export class Terrain {
  mesh:THREE.Mesh;
  private ray=new THREE.Raycaster();
  private origin=new THREE.Vector3();
  private fences:LevelData['fences'];
  private grid=new Map<string,number[]>();
  constructor(geometries:THREE.BufferGeometry[],data:LevelData) {
    const geometry=mergeGeometries(geometries);
    if(!geometry)throw new Error('No terrain collision data was converted.');
    geometry.computeBoundsTree();
    this.mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    this.mesh.updateMatrixWorld();
    this.ray.firstHitOnly=true;
    this.fences=data.fences;
    for(let i=0;i<this.fences.length;i++){
      const [a,b]=this.fences[i];
      for(let x=Math.floor(Math.min(a[0],b[0])/20);x<=Math.floor(Math.max(a[0],b[0])/20);x++)
        for(let z=Math.floor(Math.min(a[2],b[2])/20);z<=Math.floor(Math.max(a[2],b[2])/20);z++){
          const key=`${x},${z}`,bucket=this.grid.get(key)??[];bucket.push(i);this.grid.set(key,bucket);
        }
    }
  }
  ground(x:number,z:number,nearY:number,range=5):THREE.Intersection | undefined {
    this.origin.set(x,nearY+range,z);this.ray.set(this.origin,down);this.ray.far=range+20;
    return this.ray.intersectObject(this.mesh,false)[0];
  }
  resolve(state:CarState,previous:THREE.Vector3,dt:number) {
    let impact=false;
    const candidates=new Set<number>();
    const gx=Math.floor(state.position.x/20),gz=Math.floor(state.position.z/20);
    for(let x=gx-1;x<=gx+1;x++)for(let z=gz-1;z<=gz+1;z++)this.grid.get(`${x},${z}`)?.forEach(n=>candidates.add(n));
    const radius=1.2;
    for(const id of candidates){
      const [a,b]=this.fences[id];const dx=b[0]-a[0],dz=b[2]-a[2],len=dx*dx+dz*dz;
      if(len<0.001)continue;
      const t=THREE.MathUtils.clamp(((state.position.x-a[0])*dx+(state.position.z-a[2])*dz)/len,0,1);
      const x=a[0]+dx*t,z=a[2]+dz*t;let nx=state.position.x-x,nz=state.position.z-z;
      const distance=Math.hypot(nx,nz);
      // Exported fences are vertical world barriers; terrain handles height separately.
      if(distance<radius){
        if(distance<0.001){nx=previous.x-x;nz=previous.z-z;}
        const norm=Math.hypot(nx,nz)||1;
        // Correct penetration every step; bounce only while moving into the barrier.
        // Reversing an already separating car caused alternating forward/backward kicks.
        const approach=(state.position.x-previous.x)*nx/norm+(state.position.z-previous.z)*nz/norm;
        state.position.x=x+nx/norm*radius;state.position.z=z+nz/norm*radius;
        if(approach < -0.0001)impact=true;
      }
    }
    if(impact){state.damage=Math.min(100,state.damage+Math.abs(state.speed)*0.55);state.speed*=-0.25;}
    const ground=this.ground(state.position.x,state.position.z,previous.y,2.4);
    if(ground){
      const target=ground.point.y+0.06;
      if(state.position.y<target+0.2){state.position.y=target;state.verticalSpeed=0;}
      else {state.verticalSpeed-=18*dt;state.position.y=Math.max(target,state.position.y+state.verticalSpeed*dt);}
    }else {state.verticalSpeed-=18*dt;state.position.y+=state.verticalSpeed*dt;}
    return impact;
  }
  normal(x:number,z:number,y:number){
    const hit=this.ground(x,z,y,2.4);
    if(!hit?.face)return up;
    return hit.face.normal.y<0?hit.face.normal.clone().negate():hit.face.normal;
  }
  dispose(){this.mesh.geometry.disposeBoundsTree();this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}
}
