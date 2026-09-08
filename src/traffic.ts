import * as THREE from 'three';
import type { World } from './world';
import type { CarState } from './physics';
import { Motion } from './motion';
import { TrafficPath } from './traffic-path';
import { key,type Command } from './campaign/types';
import { vehicleContact,vehicleTravelDistance,DEFAULT_FOOTPRINT,type VehicleFootprint } from './vehicle-collision';
export const TRAFFIC_RULES={poolSize:5,speedKmh:60,cameraLead:40,spawnRadius:65,removeRadius:75,initialRadius:100,initialSeconds:3,scanSeconds:.2};
export function trafficGroup(commands:Command[]){
  let group=-1;const definitions:{id:string;amount:number;noPark:boolean}[]=[];
  for(const command of commands){
    if(command.op==='CreateTrafficGroup')group=Number(command.args[0]);
    if(command.op==='CloseTrafficGroup')group=-1;
    if(command.op==='AddTrafficModel'&&group===0)definitions.push({id:key(command.args[0]),amount:Number(command.args[1]),noPark:Number(command.args[2])===1});
  }
  if(!definitions.length)throw new Error('Level has no original traffic group');
  if(definitions.some(d=>!Number.isInteger(d.amount)||d.amount<0)||definitions.reduce((n,d)=>n+d.amount,0)!==TRAFFIC_RULES.poolSize)throw new Error('Original traffic groups require five vehicle slots');
  return definitions;
}
export const trafficModels=(commands:Command[])=>trafficGroup(commands).flatMap(d=>Array.from({length:d.amount},()=>d.id));
/** Host braking control for the native traffic pool; preserves space ahead. */
type TrafficObstacle=THREE.Vector3|{position:THREE.Vector3;heading:number;footprint?:VehicleFootprint};
export function trafficDesiredSpeed(position:THREE.Vector3,heading:number,obstacles:TrafficObstacle[],footprint=DEFAULT_FOOTPRINT){
  let speed=TRAFFIC_RULES.speedKmh/3.6;
  for(const item of obstacles){
    const other=item instanceof THREE.Vector3?{position:item,heading}:item;
    const distance=vehicleTravelDistance({position,heading},other,footprint,'footprint' in other?other.footprint:undefined);
    speed=Math.min(speed,Math.sqrt(16*Math.max(0,distance-1)));
  }
  return speed;
}
export function trafficSpawnCandidates(roads:THREE.Vector3[][],center:THREE.Vector3,radius:number,playerVelocity=new THREE.Vector3()){
  const candidates:{segment:number;reverse:boolean;fraction:number;position:THREE.Vector3}[]=[];
  roads.forEach((road,segment)=>{for(const reverse of [false,true]){
    const a=road[reverse?1:0],b=road[reverse?0:1],delta=b.clone().sub(a),length=delta.length();if(length<.001)continue;
    const lane=new THREE.Vector3(delta.z/length*1.4,0,-delta.x/length*1.4),start=a.clone().add(lane),offset=start.clone().sub(center),aa=delta.lengthSq(),bb=2*offset.dot(delta),cc=offset.lengthSq()-radius*radius,disc=bb*bb-4*aa*cc;
    if(disc<0)continue;
    for(const fraction of [(-bb-Math.sqrt(disc))/(2*aa),(-bb+Math.sqrt(disc))/(2*aa)])if(fraction>=0&&fraction<=1){
      const position=start.clone().addScaledVector(delta,fraction);
      const futureCar=position.clone().addScaledVector(delta,TRAFFIC_RULES.speedKmh/3.6*1.5/length),futureCenter=center.clone().addScaledVector(playerVelocity,1.5);
      if(futureCar.distanceToSquared(futureCenter)<TRAFFIC_RULES.removeRadius**2)candidates.push({segment,reverse,fraction,position});
    }
  }});
  return candidates;
}
interface TrafficCar {id:string;noPark:boolean;active:boolean;radius:number;footprint:VehicleFootprint;mesh:THREE.Group;path:TrafficPath;position:THREE.Vector3;heading:number;motion:Motion;speed:number;yOffset:number;stopped:number;hitCooldown:number;wheels:THREE.Object3D[]}
export class Traffic {
  group=new THREE.Group();cars:TrafficCar[]=[];limit=TRAFFIC_RULES.poolSize;
  private routes:THREE.Vector3[][];
  private scan=0;private initial=TRAFFIC_RULES.initialSeconds;private cursor=0;
  constructor(private world:World,private commands:Command[]){this.routes=world.data.roads.map(r=>r.map(p=>new THREE.Vector3(...p as [number,number,number])));world.scene.add(this.group);}
  async load(){
    const definitions=trafficGroup(this.commands),fleet=trafficModels(this.commands),ids=[...new Set(fleet)],loaded=await Promise.all(ids.map(id=>this.world.assets.load(`car-${id}`,true))),models=new Map(ids.map((id,i)=>[id,loaded[i]]));
    for(let i=0;i<fleet.length;i++){
      const mesh=models.get(fleet[i])!.root.clone(true);mesh.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true;});this.group.add(mesh);
      const box=new THREE.Box3().setFromObject(mesh),position=new THREE.Vector3(),path=new TrafficPath(this.routes,0),heading=path.sample(position),motion=new Motion();
      motion.reset({position,heading});mesh.position.copy(position);mesh.position.y-=box.min.y;mesh.rotation.y=heading+Math.PI;
      const size=box.getSize(new THREE.Vector3());mesh.visible=false;this.cars.push({id:fleet[i],noPark:definitions.find(d=>d.id===fleet[i])!.noPark,active:false,radius:box.getBoundingSphere(new THREE.Sphere()).radius,footprint:{halfWidth:size.x/2,halfLength:size.z/2},mesh,path,position,heading,motion,speed:TRAFFIC_RULES.speedKmh/3.6,yOffset:-box.min.y,stopped:0,hitCooldown:0,wheels:mesh.children.filter(o=>/^w[0-3]$/.test(o.name)).flatMap(o=>o.children)});
    }
  }
  private stream(dt:number,player:CarState,inCar:boolean,direction:THREE.Vector3,blocked:THREE.Vector3[]){
    this.initial=Math.max(0,this.initial-dt);this.scan-=dt;if(this.scan>0)return;this.scan=TRAFFIC_RULES.scanSeconds;
    const center=player.position.clone();if(this.initial===0)center.addScaledVector(direction,TRAFFIC_RULES.cameraLead);
    if(this.initial===0)for(const car of this.cars)if(car.active&&car.position.distanceTo(center)>=TRAFFIC_RULES.removeRadius){car.active=false;car.mesh.visible=false;}
    const maximum=this.limit<=0?0:inCar?Math.min(this.limit,TRAFFIC_RULES.poolSize):TRAFFIC_RULES.poolSize;
    if(maximum===0){for(const car of this.cars){car.active=false;car.mesh.visible=false;}return;}
    let active=this.cars.filter(c=>c.active).length;
    if(active>=maximum)return;
    const velocity=new THREE.Vector3(Math.sin(player.heading)*player.speed,0,Math.cos(player.heading)*player.speed);
    const candidates=trafficSpawnCandidates(this.routes,center,this.initial>0?TRAFFIC_RULES.initialRadius:TRAFFIC_RULES.spawnRadius,velocity);
    for(let offset=0;offset<this.cars.length&&active<maximum;offset++){
      const index=(this.cursor+offset)%this.cars.length,car=this.cars[index];if(car.active)continue;
      const candidate=candidates.find(c=>c.position.distanceTo(player.position)>car.radius+8&&blocked.every(p=>c.position.distanceTo(p)>car.radius+8)&&this.cars.every(other=>!other.active||c.position.distanceTo(other.position)>car.radius+other.radius+5)&&this.world.terrain.ground(c.position.x,c.position.z,c.position.y,4));
      if(!candidate)break;
      car.path=new TrafficPath(this.routes,candidate.segment,candidate.reverse,candidate.fraction);car.heading=car.path.sample(car.position);car.stopped=0;car.hitCooldown=0;car.active=true;car.motion.reset(car);active++;
    }
    this.cursor=(this.cursor+1)%this.cars.length;
  }
  update(dt:number,player:CarState,collisions=true,direction=new THREE.Vector3(Math.sin(player.heading),0,Math.cos(player.heading)),blocked:THREE.Vector3[]=[],playerFootprint=DEFAULT_FOOTPRINT){
    this.stream(dt,player,collisions,direction,blocked);
    let impact=false;
    for(let index=0;index<this.cars.length;index++){
      const car=this.cars[index];if(!car.active)continue;car.motion.capture(car);car.stopped=Math.max(0,car.stopped-dt);car.hitCooldown=Math.max(0,car.hitCooldown-dt);
      const obstacles=[{position:player.position,heading:player.heading,footprint:playerFootprint},...blocked.map(position=>({position,heading:car.heading,footprint:DEFAULT_FOOTPRINT})),...this.cars.filter(other=>other.active&&other!==car)];
      const desired=car.stopped?0:trafficDesiredSpeed(car.position,car.heading,obstacles,car.footprint);car.speed=THREE.MathUtils.clamp(desired,Math.max(0,car.speed-8*dt),car.speed+4*dt);
      const projected=car.path.peek(dt*car.speed);
      if(obstacles.some(other=>vehicleContact(projected,other,car.footprint,other.footprint)))car.speed=0;
      if(!car.stopped)car.path.advance(dt*car.speed);car.heading=car.path.sample(car.position);
      const near=car.position.distanceToSquared(player.position)<180**2;
      if(near){const hit=this.world.terrain.ground(car.position.x,car.position.z,car.position.y,4);if(hit)car.position.y=hit.point.y;}
      if(!collisions||!near||Math.abs(car.position.y-player.position.y)>2)continue;
      const contact=vehicleContact(player,car,playerFootprint,car.footprint);if(!contact)continue;const nx=contact.normal.x,nz=contact.normal.z;
      const into=player.speed*(Math.sin(player.heading)*nx+Math.cos(player.heading)*nz);
      const relative=into-(car.stopped?0:car.speed)*(Math.sin(car.heading)*nx+Math.cos(car.heading)*nz);
      player.position.addScaledVector(contact.normal,contact.depth);car.stopped=.65;
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
      car.mesh.visible=car.active;
      if(!car.stopped)for(const wheel of car.wheels)wheel.rotation.x+=car.speed*dt/.38;
    }
  }
  resetInterpolation(){for(const car of this.cars)car.motion.reset(car);}
  dispose(){this.group.removeFromParent();}
}
