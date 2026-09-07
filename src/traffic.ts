import * as THREE from 'three';
import type { World } from './world';
import type { CarState } from './physics';
import { Motion } from './motion';
import { TrafficPath } from './traffic-path';
interface TrafficCar {mesh:THREE.Group;path:TrafficPath;position:THREE.Vector3;heading:number;motion:Motion;speed:number;yOffset:number;stopped:number;hitCooldown:number;wheels:THREE.Object3D[]}
export class Traffic {
  group=new THREE.Group();cars:TrafficCar[]=[];limit=22;
  private routes:THREE.Vector3[][];
  constructor(private world:World){this.routes=world.data.roads.map(r=>r.map(p=>new THREE.Vector3(...p as [number,number,number])));world.scene.add(this.group);}
  async load(){
    const ids=['pickupa','minivana','sportsa','cpolice'];const models=await Promise.all(ids.map(id=>this.world.assets.load(`car-${id}`,true)));
    for(let i=0;i<22;i++){
      const mesh=models[i%models.length].root.clone(true);mesh.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true;});this.group.add(mesh);
      const box=new THREE.Box3().setFromObject(mesh),position=new THREE.Vector3(),path=new TrafficPath(this.routes,Math.floor((i/22)*this.routes.length),false,(i*.37)%1),heading=path.sample(position),motion=new Motion();
      motion.reset({position,heading});mesh.position.copy(position);mesh.position.y-=box.min.y;mesh.rotation.y=heading+Math.PI;
      this.cars.push({mesh,path,position,heading,motion,speed:7+(i%4)*1.4,yOffset:-box.min.y,stopped:0,hitCooldown:0,wheels:mesh.children.filter(o=>/^w[0-3]$/.test(o.name)).flatMap(o=>o.children)});
    }
  }
  update(dt:number,player:CarState,collisions=true){
    let impact=false;
    for(let index=0;index<this.cars.length;index++){
      const car=this.cars[index];car.motion.capture(car);car.stopped=Math.max(0,car.stopped-dt);car.hitCooldown=Math.max(0,car.hitCooldown-dt);
      if(!car.stopped)car.path.advance(dt*car.speed);car.heading=car.path.sample(car.position);
      const near=car.position.distanceToSquared(player.position)<180**2;
      if(near){const hit=this.world.terrain.ground(car.position.x,car.position.z,car.position.y,4);if(hit)car.position.y=hit.point.y;}
      if(!collisions||index>=this.limit||!near||Math.abs(car.position.y-player.position.y)>2)continue;
      let nx=player.position.x-car.position.x,nz=player.position.z-car.position.z;const distance=Math.hypot(nx,nz),radius=3.1;
      if(distance>=radius)continue;
      if(distance<.001){nx=-Math.sin(car.heading);nz=-Math.cos(car.heading);}else{nx/=distance;nz/=distance;}
      const into=player.speed*(Math.sin(player.heading)*nx+Math.cos(player.heading)*nz);
      const relative=into-(car.stopped?0:car.speed)*(Math.sin(car.heading)*nx+Math.cos(car.heading)*nz);
      player.position.x+=nx*(radius-distance);player.position.z+=nz*(radius-distance);car.stopped=.65;
      if(relative<-.5&&car.hitCooldown===0){
        if(into<-.5)player.speed*=-.18;
        player.damage=Math.min(100,player.damage+Math.min(15,-relative*.45));car.hitCooldown=1.2;impact=true;
      }
    }
    return impact;
  }
  render(dt:number,alpha:number,player:THREE.Vector3){
    for(let i=0;i<this.cars.length;i++){
      const car=this.cars[i],pose=car.motion.sample(car,alpha);car.mesh.position.copy(pose.position);car.mesh.position.y+=car.yOffset;car.mesh.rotation.y=pose.heading+Math.PI;
      // Fog conceals the far boundary; proximity to the player no longer pops
      // cars into view at the old 150-metre cutoff.
      car.mesh.visible=i<this.limit&&car.position.distanceToSquared(player)<460**2;
      if(!car.stopped)for(const wheel of car.wheels)wheel.rotation.x+=car.speed*dt/.38;
    }
  }
  resetInterpolation(){for(const car of this.cars)car.motion.reset(car);}
  dispose(){this.group.removeFromParent();}
}
