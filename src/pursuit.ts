import * as THREE from 'three';
import type { World } from './world';
import type { CarState } from './physics';
import type { CampaignAssets,Player } from './campaign/runtime';
import { MissionRoute,RoadNetwork } from './campaign/roads';
import type { Command } from './campaign/types';
import { Motion } from './motion';
import { vehicleContact,DEFAULT_FOOTPRINT,type VehicleFootprint } from './vehicle-collision';
import { HIT_RUN_RULES,HitAndRun,type Offense,type PursuitSettings } from './hit-and-run';

/** Native ChaseManager intersects roads with a 100-metre sphere around the player. */
export function pursuitSpawns(roads:number[][][],center:THREE.Vector3,radius=HIT_RUN_RULES.spawnRadius){
  const points:THREE.Vector3[]=[];
  for(const [av,bv] of roads){
    const a=new THREE.Vector3(...av as [number,number,number]),b=new THREE.Vector3(...bv as [number,number,number]);
    const delta=b.sub(a),offset=a.clone().sub(center),aa=delta.lengthSq();if(aa<.001)continue;
    const bb=2*offset.dot(delta),cc=offset.lengthSq()-radius*radius,disc=bb*bb-4*aa*cc;if(disc<0)continue;
    for(const t of [(-bb-Math.sqrt(disc))/(2*aa),(-bb+Math.sqrt(disc))/(2*aa)])if(t>=0&&t<=1){
      const point=a.clone().addScaledVector(delta,t);if(!points.some(p=>p.distanceToSquared(point)<16))points.push(point);
    }
  }
  return points;
}
interface PoliceCar {
  mesh:THREE.Group;position:THREE.Vector3;heading:number;speed:number;motion:Motion;
  offset:number;health:number;repath:number;hitCooldown:number;route?:MissionRoute;
  retiring:boolean;retireTime:number;beacons:THREE.MeshStandardMaterial[];wheels:THREE.Object3D[];
}
export interface PursuitHUD {heat:number;active:boolean;catching:number;busted:number;fine:number;cars:THREE.Vector3[]}
export class Pursuit {
  readonly meter:HitAndRun;readonly group=new THREE.Group();readonly cars:PoliceCar[]=[];
  private road:RoadNetwork;private template?:THREE.Group;private offset=0;private time=0;private spawnDelay=0;private footprint=DEFAULT_FOOTPRINT;
  private lastFine=0;private stopped=false;private nearest=Infinity;
  constructor(private world:World,readonly settings:PursuitSettings,private assets:CampaignAssets,
    private callbacks:{toast:(text:string)=>void;fine:(amount:number)=>number;busted:()=>void}){
    this.meter=new HitAndRun(settings);this.road=new RoadNetwork(world.data.roads);world.scene.add(this.group);
  }
  async load(){
    const {root}=await this.world.assets.load(`car-${this.settings.vehicle}`,true);
    this.template=root;const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3());this.offset=-box.min.y+.04;this.footprint={halfWidth:size.x/2,halfLength:size.z/2};
  }
  get frozen(){return this.meter.bustedRemaining>0;}
  get audibleDistance(){return this.nearest;}
  get hud():PursuitHUD{return {heat:this.meter.heat,active:this.meter.latched||this.meter.active,catching:this.meter.catchTime,busted:this.meter.bustedRemaining,fine:this.lastFine,cars:this.cars.filter(c=>!c.retiring).map(c=>c.position)};}
  offense(type:Offense,interior=false){return this.meter.offense(type,interior);}
  enterVehicle(identity:string){this.meter.enterVehicle(identity);}
  reset(){this.clearCars();this.meter.reset();this.stopped=false;this.spawnDelay=0;}
  command(command:Command){
    if(command.op==='KillAllChaseAI'){this.stopped=true;return true;}
    const handled=this.meter.command(command);
    if(handled&&['ResetHitAndRun','EnableHitAndRun','DisableHitAndRun'].includes(command.op)){this.clearCars();this.stopped=false;}
    return handled;
  }
  private clearCars(){
    for(const car of this.cars){car.mesh.removeFromParent();car.beacons.forEach(m=>m.dispose());}
    this.cars.length=0;this.nearest=Infinity;
  }
  private spawn(player:Player,occupied:THREE.Vector3[]){
    if(!this.template)return;
    const backwards=new THREE.Vector3(-Math.sin(player.state.heading),0,-Math.cos(player.state.heading));
    const candidates=pursuitSpawns(this.world.data.roads,player.state.position).sort((a,b)=>b.clone().sub(player.state.position).dot(backwards)-a.clone().sub(player.state.position).dot(backwards));
    const point=candidates.find(p=>occupied.every(o=>p.distanceToSquared(o)>64)&&this.cars.every(c=>p.distanceToSquared(c.position)>144)&&this.world.terrain.ground(p.x,p.z,p.y,4));
    if(!point)return;
    const ground=this.world.terrain.ground(point.x,point.z,point.y,4)!;point.y=ground.point.y+.06;
    const mesh=this.template.clone(true),beacons:THREE.MeshStandardMaterial[]=[];
    mesh.traverse(o=>{
      if(!(o instanceof THREE.Mesh))return;o.castShadow=true;
      if(o.userData.pursuitBeacon&&o.material instanceof THREE.MeshStandardMaterial){o.material=o.material.clone();beacons.push(o.material);}
    });
    const heading=Math.atan2(player.state.position.x-point.x,player.state.position.z-point.z),motion=new Motion();motion.reset({position:point,heading});
    const car:PoliceCar={mesh,position:point,heading,speed:0,motion,offset:this.offset,health:1,repath:0,hitCooldown:0,retiring:false,retireTime:0,beacons,wheels:mesh.children.filter(o=>/^w[0-3]$/.test(o.name)).flatMap(o=>o.children)};
    this.cars.push(car);this.group.add(mesh);
  }
  update(dt:number,player:Player,interior:boolean,occupied:THREE.Vector3[]=[]){
    this.time+=dt;this.group.visible=!interior;
    this.nearest=interior?Infinity:this.cars.filter(c=>c.health>0).reduce((d,c)=>Math.min(d,c.position.distanceTo(player.state.position)),Infinity);
    this.meter.update(dt,{onFoot:player.onFoot,speedKmh:Math.abs(player.state.speed)*3.6,interior,chasers:this.cars.length,nearestChaser:this.nearest});
    for(const event of this.meter.drain()){
      if(event.type==='started'){this.stopped=false;this.callbacks.toast('HIT & RUN!');}
      if(event.type==='warning')this.callbacks.toast('WATCH IT!');
      if(event.type==='escaped')this.callbacks.toast('ESCAPED!');
      if(event.type==='busted'){
        this.lastFine=this.callbacks.fine(event.coins);player.state.speed=0;
        this.clearCars();this.callbacks.busted();
      }
    }
    if(!this.meter.enabled||this.frozen)return;
    const tuning=this.assets.missionTuning[this.settings.tuning]??this.assets.tuning[this.settings.vehicle];
    const topSpeed=(tuning.SetTopSpeedKmh??140)/3.6,acceleration=13*(tuning.SetGasScale??10)/4.5;
    this.spawnDelay-=dt;
    if(this.meter.requested&&!interior&&this.cars.filter(c=>!c.retiring).length<this.meter.chaseCars&&this.cars.length<HIT_RUN_RULES.poolSize&&this.spawnDelay<=0){this.spawn(player,occupied);this.spawnDelay=.5;}
    for(const car of this.cars){
      car.motion.capture(car);car.repath-=dt;car.hitCooldown=Math.max(0,car.hitCooldown-dt);
      if(!this.meter.latched||interior||car.health<=0)car.retiring=true;
      if(car.retiring){car.retireTime+=dt;continue;}
      if(this.stopped)continue;
      const distance=car.position.distanceTo(player.state.position);
      if(car.repath<=0){car.route=new MissionRoute(this.road.route(car.position,player.state.position));car.repath=.75;}
      const desired=distance>12?topSpeed:Math.max(0,Math.min(topSpeed,(distance-3)*2));
      car.speed=THREE.MathUtils.clamp(desired,car.speed-24*dt,car.speed+acceleration*dt);
      if(car.route){
        const heading=car.route.advance(car.speed*dt,car.position),turn=Math.atan2(Math.sin(heading-car.heading),Math.cos(heading-car.heading));car.heading+=turn*(1-Math.exp(-12*dt));
        const ground=this.world.terrain.ground(car.position.x,car.position.z,car.position.y,3);if(ground)car.position.y=ground.point.y+.06;
      }
      if(!player.onFoot)this.collide(car,player.state,tuning,this.assets.tuning[player.vehicle]?.SetMass??1500,player.footprint);
      if(car.position.distanceTo(player.state.position)>HIT_RUN_RULES.removeRadius)car.retiring=true;
    }
    for(let i=this.cars.length-1;i>=0;i--){const car=this.cars[i];if(car.retiring&&(interior||car.position.distanceTo(player.state.position)>HIT_RUN_RULES.removeRadius||car.retireTime>5)){
      car.mesh.removeFromParent();car.beacons.forEach(m=>m.dispose());this.cars.splice(i,1);
    }}
  }
  private collide(car:PoliceCar,player:CarState,tuning:Record<string,number>,playerMass:number,footprint?:VehicleFootprint){
    const contact=vehicleContact(player,car,footprint,this.footprint);if(!contact)return;const separation=contact.normal;
    const mass=tuning.SetMass??1750,ratio=mass/(mass+playerMass);
    player.position.addScaledVector(separation,contact.depth*ratio);car.position.addScaledVector(separation,-contact.depth*(1-ratio));
    const closing=-(player.speed*(Math.sin(player.heading)*separation.x+Math.cos(player.heading)*separation.z)-car.speed*(Math.sin(car.heading)*separation.x+Math.cos(car.heading)*separation.z));
    if(closing>.5&&car.hitCooldown===0){
      player.damage=Math.min(100,player.damage+Math.min(15,closing*.3));player.speed*=.55;car.speed*=.6;car.hitCooldown=1;
      car.health=Math.max(0,car.health-closing*.012/(tuning.SetHitPoints??1));
    }
  }
  render(dt:number,alpha:number){
    for(const car of this.cars){const pose=car.motion.sample(car,alpha);car.mesh.position.copy(pose.position);car.mesh.position.y+=car.offset;car.mesh.rotation.y=pose.heading+Math.PI;
      for(const wheel of car.wheels)wheel.rotation.x+=car.speed*dt/.38;
      car.beacons.forEach((m,i)=>{m.emissiveIntensity=car.retiring?.2:(Math.sin(this.time*14+i*Math.PI)>0?3:.25);});
    }
  }
  resetInterpolation(){for(const car of this.cars)car.motion.reset(car);}
  dispose(){this.clearCars();this.group.removeFromParent();}
}
