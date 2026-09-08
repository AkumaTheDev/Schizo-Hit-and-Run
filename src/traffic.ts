import * as THREE from 'three';
import type { World } from './world';
import type { CarState } from './physics';
import { Motion } from './motion';
import { TrafficPath } from './traffic-path';
import { key,type Command } from './campaign/types';
import { vehicleContact,vehicleTravelDistance,DEFAULT_FOOTPRINT,type VehicleFootprint } from './vehicle-collision';
import { renderVehicleWheels,simulateVehicle,vehicleProfile,resetVehicle,collideVehicles,type VehicleProfile } from './vehicle-physics';
import { SteeringDriver,AI_RULES } from './steering';
import type { RoadNavigation } from './road-data';
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
export function trafficSpawnCandidates(roads:THREE.Vector3[][],center:THREE.Vector3,radius:number,playerVelocity=new THREE.Vector3(),navigation?:RoadNavigation){
  const candidates:{segment:number;reverse:boolean;fraction:number;position:THREE.Vector3;lane:number}[]=[];
  roads.forEach((road,segment)=>{const native=navigation?.segments[segment],owner=native?navigation!.roads[native.road]:undefined;if(owner&&(owner.shortcut||owner.maxCars<=0))return;
    for(let laneIndex=0;laneIndex<(native?.lanes??1);laneIndex++)for(const reverse of native?[false]:[false,true]){
    let a=road[reverse?1:0],b=road[reverse?0:1];
    if(native){const p=native.corners.map(p=>new THREE.Vector3(...p)),f=(laneIndex+.5)/native.lanes;a=p[0].lerp(p[3],f);b=p[1].lerp(p[2],f);}
    const delta=b.clone().sub(a),length=delta.length();if(length<.001)continue;
    const lane=native?new THREE.Vector3():new THREE.Vector3(delta.z/length*1.4,0,-delta.x/length*1.4),start=a.clone().add(lane),offset=start.clone().sub(center),aa=delta.lengthSq(),bb=2*offset.dot(delta),cc=offset.lengthSq()-radius*radius,disc=bb*bb-4*aa*cc;
    if(disc<0)continue;
    for(const fraction of [(-bb-Math.sqrt(disc))/(2*aa),(-bb+Math.sqrt(disc))/(2*aa)])if(fraction>=0&&fraction<=1){
      const position=start.clone().addScaledVector(delta,fraction);
      const futureCar=position.clone().addScaledVector(delta,TRAFFIC_RULES.speedKmh/3.6*1.5/length),futureCenter=center.clone().addScaledVector(playerVelocity,1.5);
      if(futureCar.distanceToSquared(futureCenter)<TRAFFIC_RULES.removeRadius**2)candidates.push({segment,reverse,fraction,position,lane:laneIndex});
    }
  }});
  return candidates;
}
export interface TrafficCar extends CarState {id:string;noPark:boolean;active:boolean;radius:number;footprint:VehicleFootprint;profile:VehicleProfile;driver:SteeringDriver;mesh:THREE.Group;path:TrafficPath;motion:Motion;yOffset:number;stopped:number;hitCooldown:number;wheels:THREE.Object3D[];reverseFor?:number;blockedTime?:number}
export class Traffic {
  group=new THREE.Group();cars:TrafficCar[]=[];limit=TRAFFIC_RULES.poolSize;
  private routes:THREE.Vector3[][];
  private scan=0;private initial=TRAFFIC_RULES.initialSeconds;private cursor=0;
  constructor(private world:World,private commands:Command[],private tuning:Record<string,Record<string,number>>={}){this.routes=world.data.roads.map(r=>r.map(p=>new THREE.Vector3(...p as [number,number,number])));world.scene.add(this.group);}
  async load(){
    const definitions=trafficGroup(this.commands),fleet=trafficModels(this.commands),ids=[...new Set(fleet)],loaded=await Promise.all(ids.map(id=>this.world.assets.load(`car-${id}`,true))),models=new Map(ids.map((id,i)=>[id,loaded[i]]));
    for(let i=0;i<fleet.length;i++){
      const mesh=models.get(fleet[i])!.root.clone(true);mesh.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=true;});this.group.add(mesh);
      const box=new THREE.Box3().setFromObject(mesh),profile=vehicleProfile(mesh),position=new THREE.Vector3(),path=new TrafficPath(this.routes,0,false,0,this.world.data.navigation),heading=path.sample(position),motion=new Motion();
      motion.reset({position,heading});mesh.position.copy(position);mesh.position.y-=box.min.y;mesh.rotation.y=heading+Math.PI;
      const size=box.getSize(new THREE.Vector3());mesh.visible=false;this.cars.push({id:fleet[i],noPark:definitions.find(d=>d.id===fleet[i])!.noPark,active:false,radius:box.getBoundingSphere(new THREE.Sphere()).radius,footprint:{halfWidth:size.x/2,halfLength:size.z/2},profile,driver:new SteeringDriver(),mesh,path,position,heading,motion,speed:TRAFFIC_RULES.speedKmh/3.6,verticalSpeed:0,steer:0,distance:0,damage:0,yOffset:-box.min.y,stopped:0,hitCooldown:0,wheels:mesh.children.filter(o=>/^w[0-3]$/.test(o.name)).flatMap(o=>o.children)});
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
    const candidates=trafficSpawnCandidates(this.routes,center,this.initial>0?TRAFFIC_RULES.initialRadius:TRAFFIC_RULES.spawnRadius,velocity,this.world.data.navigation);
    for(let offset=0;offset<this.cars.length&&active<maximum;offset++){
      const index=(this.cursor+offset)%this.cars.length,car=this.cars[index];if(car.active)continue;
      const candidate=candidates.find(c=>c.position.distanceTo(player.position)>car.radius+8&&blocked.every(p=>c.position.distanceTo(p)>car.radius+8)&&this.cars.every(other=>!other.active||c.position.distanceTo(other.position)>car.radius+other.radius+5)&&this.world.terrain.ground(c.position.x,c.position.z,c.position.y,4));
      if(!candidate)break;
      car.path=new TrafficPath(this.routes,candidate.segment,candidate.reverse,candidate.fraction,this.world.data.navigation,candidate.lane);car.heading=car.path.sample(car.position);car.position.y+=.06;car.speed=TRAFFIC_RULES.speedKmh/3.6;car.verticalSpeed=car.damage=car.steer=0;car.stopped=0;car.hitCooldown=0;car.active=true;car.driver.reset();resetVehicle(car);car.motion.reset(car);active++;
    }
    this.cursor=(this.cursor+1)%this.cars.length;
  }
  update(dt:number,player:CarState,collisions=true,direction=new THREE.Vector3(Math.sin(player.heading),0,Math.cos(player.heading)),blocked:THREE.Vector3[]=[],playerFootprint=DEFAULT_FOOTPRINT,playerMass=1500){
    this.stream(dt,player,collisions,direction,blocked);
    let impact=false;
    for(let index=0;index<this.cars.length;index++){
      const car=this.cars[index];if(!car.active)continue;car.motion.capture(car);car.stopped=Math.max(0,car.stopped-dt);car.hitCooldown=Math.max(0,car.hitCooldown-dt);
      const pedestrianAbove=!collisions&&player.position.y>car.position.y+car.profile.center.y+car.profile.half.y-.1;
      const obstacles=[...(pedestrianAbove?[]:[{position:player.position,heading:player.heading,footprint:collisions?playerFootprint:{halfWidth:.35,halfLength:.35}}]),...blocked.map(position=>({position,heading:car.heading,footprint:DEFAULT_FOOTPRINT})),...this.cars.filter(other=>other.active&&other!==car)];
      const desired=car.stopped?0:trafficDesiredSpeed(car.position,car.heading,obstacles,car.footprint);
      car.path.track(car.position);const target=car.path.peek(Math.max(AI_RULES.minimumLookahead,Math.abs(car.speed)*AI_RULES.lookaheadSeconds)).position;
      const controls=car.driver.controls(car,target,desired,dt,this.tuning[car.id]??{},obstacles,car.footprint,false);
      car.blockedTime=desired<1&&Math.abs(car.speed)<.5?(car.blockedTime??0)+dt:0;
      if(car.blockedTime>2&&this.cars.slice(0,index).some(other=>other.active&&other.position.distanceTo(car.position)<10)){car.reverseFor=.8;car.blockedTime=0;}
      if((car.reverseFor??0)>0){
        const rearClear=obstacles.every(other=>vehicleTravelDistance({position:car.position,heading:car.heading+Math.PI},other,car.footprint,other.footprint)>3);
        if(rearClear){controls.steer=-controls.steer;controls.throttle=0;controls.brake=car.speed>-3?.5:0;}
        car.reverseFor=Math.max(0,(car.reverseFor??0)-dt);
      }
      simulateVehicle(car,controls,dt,this.tuning[car.id],car.profile,this.world.terrain,false);
      const near=car.position.distanceToSquared(player.position)<180**2;
      if(!collisions||!near||Math.abs(car.position.y-player.position.y)>2)continue;
      const contact=collideVehicles(player,car,playerMass,this.tuning[car.id]?.SetMass??1500,playerFootprint,car.footprint);if(!contact)continue;car.stopped=.65;
      if(contact.closing>.5&&car.hitCooldown===0){
        player.damage=Math.min(100,player.damage+Math.min(15,contact.closing*.45));car.hitCooldown=1.2;impact=true;
      }
    }
    for(let a=0;a<this.cars.length;a++)for(let b=a+1;b<this.cars.length;b++){
      const first=this.cars[a],second=this.cars[b];if(!first.active||!second.active)continue;
      const contact=collideVehicles(first,second,this.tuning[first.id]?.SetMass??1500,this.tuning[second.id]?.SetMass??1500,first.footprint,second.footprint);
      if(contact){first.stopped=Math.max(first.stopped,.25);second.reverseFor=Math.max(second.reverseFor??0,.8);}
    }
    return impact;
  }
  render(dt:number,alpha:number,player:THREE.Vector3){
    for(let i=0;i<this.cars.length;i++){
      const car=this.cars[i],pose=car.motion.sample(car,alpha);car.mesh.position.copy(pose.position);car.mesh.position.y+=car.yOffset;car.mesh.rotation.y=pose.heading+Math.PI;
      if(car.vehicleMotion){car.mesh.position.copy(pose.position).add(new THREE.Vector3(0,car.yOffset,0).applyQuaternion(car.vehicleMotion.orientation));car.mesh.quaternion.copy(car.vehicleMotion.orientation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));}
      car.mesh.visible=car.active;
      renderVehicleWheels(car.mesh,car.vehicleMotion,car.profile,this.tuning[car.id]);
    }
  }
  resetInterpolation(){for(const car of this.cars)car.motion.reset(car);}
  dispose(){this.group.removeFromParent();}
}
