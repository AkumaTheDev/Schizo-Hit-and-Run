import * as THREE from 'three';
import type { LevelData } from './assets';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Octree } from 'three/addons/math/Octree.js';
import { Capsule } from 'three/addons/math/Capsule.js';

export interface Controls {steer:number;throttle:number;brake:number;handbrake:boolean}
export interface CarState {position:THREE.Vector3;heading:number;speed:number;verticalSpeed:number;steer:number;distance:number;damage:number}
const up=new THREE.Vector3(0,1,0), down=new THREE.Vector3(0,-1,0);

export function drive(state:CarState,control:Controls,dt:number,tuning?:Record<string,number>) {
  const gas=(tuning?.SetGasScale??4.5)/4.5,brakes=(tuning?.SetBrakeScale??8)/8,topSpeed=(tuning?.SetTopSpeedKmh??154.8)/3.6;
  const acceleration=control.throttle*13*gas - control.brake*(state.speed>1?24:7)*brakes;
  state.speed+=acceleration*dt;
  const drag=control.handbrake?4.5:(control.throttle||control.brake?0.14:0.7);
  state.speed*=Math.exp(-drag*dt);
  state.speed=THREE.MathUtils.clamp(state.speed,-12,topSpeed);
  if (Math.abs(state.speed)<0.03) state.speed=0;
  state.steer=THREE.MathUtils.damp(state.steer,control.steer,8,dt);
  const steering=(tuning?.SetMaxWheelTurnAngle??30)/30;
  const turning=state.steer*steering*Math.min(Math.abs(state.speed)/6,1)*Math.sign(state.speed)*(control.handbrake?1.9:1.25)/(1+Math.abs(state.speed)*0.012);
  state.heading-=turning*dt;
  state.position.x+=Math.sin(state.heading)*state.speed*dt;
  state.position.z+=Math.cos(state.heading)*state.speed*dt;
  state.distance+=Math.abs(state.speed)*dt;
}

export class Terrain {
  mesh:THREE.Mesh;readonly bottom:number;
  private ray=new THREE.Raycaster();
  private origin=new THREE.Vector3();
  private fences:LevelData['fences'];
  private grid=new Map<string,number[]>();
  private bodyTree?:Octree;
  constructor(geometries:THREE.BufferGeometry[],data:LevelData,staticBodies?:THREE.BufferGeometry) {
    const geometry=mergeGeometries(geometries);
    if(!geometry)throw new Error('No terrain collision data was converted.');
    geometry.computeBoundsTree();geometry.computeBoundingBox();this.bottom=geometry.boundingBox!.min.y;
    this.mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
    this.mesh.updateMatrixWorld();
    if(staticBodies){
      this.bodyTree=new Octree();
      for(const source of [geometry,staticBodies]){
        const positions=source.getAttribute('position'),indices=source.index;
        for(let i=0;i<(indices?.count??positions.count);i+=3){
          const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,indices?indices.getX(i+j):i+j));
          const triangle=new THREE.Triangle(points[0],points[1],points[2]);
          if(triangle.getArea()<1e-8)continue;
          // Intersect surfaces were exported for double-sided ground rays. The
          // capsule solver needs upward floor winding; static solids face outward.
          if(source===geometry&&triangle.getNormal(new THREE.Vector3()).y<0){triangle.a=points[2];triangle.c=points[0];}
          this.bodyTree.addTriangle(triangle);
        }
      }
      this.bodyTree.build();
    }
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
  resolve(state:CarState,previous:THREE.Vector3,dt:number,radius=1.2,collideMesh=false) {
    const bodyCollision=collideMesh&&!!this.bodyTree;
    let impact=false;
    const candidates=new Set<number>();
    const gx=Math.floor(state.position.x/20),gz=Math.floor(state.position.z/20);
    for(let x=gx-1;x<=gx+1;x++)for(let z=gz-1;z<=gz+1;z++)this.grid.get(`${x},${z}`)?.forEach(n=>candidates.add(n));
    if(collideMesh&&!bodyCollision){
      const direction=state.position.clone().sub(previous);direction.y=0;const travel=direction.length();
      if(travel>0){this.ray.set(previous.clone().add(new THREE.Vector3(0,.8,0)),direction.normalize());this.ray.far=travel+radius;const wall=this.ray.intersectObject(this.mesh,false)[0];if(wall&&wall.face&&Math.abs(wall.face.normal.y)<.5){state.position.x=previous.x+direction.x*Math.max(0,wall.distance-radius);state.position.z=previous.z+direction.z*Math.max(0,wall.distance-radius);}}
    }
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
    if(impact){if(radius>=1){state.damage=Math.min(100,state.damage+Math.abs(state.speed)*0.55);state.speed*=-0.25;}else state.speed=0;}
    if(bodyCollision)return this.resolveBody(state,previous,dt,radius)||impact;
    const ground=this.ground(state.position.x,state.position.z,previous.y,2.4);
    if(ground){
      const target=ground.point.y+0.06;
      if(state.position.y<target+0.2){state.position.y=target;state.verticalSpeed=0;}
      else {state.verticalSpeed-=18*dt;state.position.y=Math.max(target,state.position.y+state.verticalSpeed*dt);}
    }else {state.verticalSpeed-=18*dt;state.position.y+=state.verticalSpeed*dt;}
    return impact;
  }
  private resolveBody(state:CarState,previous:THREE.Vector3,dt:number,radius:number){
    const clearance=.06,height=1.8;
    state.verticalSpeed-=18*dt;
    const movement=state.position.clone().sub(previous);movement.y+=state.verticalSpeed*dt;
    // Bound each sweep so sprinting, jumping and long frames cannot cross a thin
    // native wall between overlap tests. Preserve tangential motion for sliding.
    const steps=Math.max(1,Math.ceil(movement.length()/(radius*.5)));
    movement.divideScalar(steps);
    const capsule=new Capsule(previous.clone().add(new THREE.Vector3(0,radius-clearance,0)),previous.clone().add(new THREE.Vector3(0,height-radius-clearance,0)),radius);
    let impact=false;
    for(let step=0;step<steps;step++){
      capsule.translate(movement);
      for(let iteration=0;iteration<4;iteration++){
        const hit=this.bodyTree!.capsuleIntersect(capsule);
        if(!hit||hit.depth<1e-7)break;
        capsule.translate(hit.normal.clone().multiplyScalar(hit.depth+1e-6));
        if(Math.abs(hit.normal.y)<.5)impact=true;
        if((hit.normal.y>.5&&state.verticalSpeed<0)||(hit.normal.y<-.5&&state.verticalSpeed>0)){
          state.verticalSpeed=0;movement.y=0;
        }
      }
    }
    state.position.copy(capsule.start).add(new THREE.Vector3(0,clearance-radius,0));
    return impact;
  }
  normal(x:number,z:number,y:number){
    const hit=this.ground(x,z,y,2.4);
    if(!hit?.face)return up;
    return hit.face.normal.y<0?hit.face.normal.clone().negate():hit.face.normal;
  }
  dispose(){this.bodyTree?.clear();this.mesh.geometry.disposeBoundsTree();this.mesh.geometry.dispose();(this.mesh.material as THREE.Material).dispose();}
}
