import * as THREE from 'three';
import type { CarState,Controls,Terrain } from './physics';
import { vehicleContact,DEFAULT_FOOTPRINT,type VehicleFootprint } from './vehicle-collision';

export interface WheelProfile {position:THREE.Vector3;radius:number;front:boolean}
export interface VehicleProfile {half:THREE.Vector3;center:THREE.Vector3;wheels:WheelProfile[];offset:number}
export interface VehicleMotion {velocity:THREE.Vector3;angularVelocity:THREE.Vector3;orientation:THREE.Quaternion;compression:number[];wheelSpin:number[];slip:0|1|2;lastSpeed:number;lastHeading:number;lastPosition:THREE.Vector3;wheelAngle:number;hadContact:boolean;tractionRecovery:number}
const Y=new THREE.Vector3(0,1,0),Z=new THREE.Vector3(0,0,1),X=new THREE.Vector3(1,0,0);
const profiles=new WeakMap<THREE.Group,VehicleProfile>();
export const VEHICLE_RULES={gravity:9.81,reverseSpeed:50/3.6,maximumStep:1/120,restitution:.12};
export const DEFAULT_VEHICLE:VehicleProfile={half:new THREE.Vector3(.9,.65,2.2),center:new THREE.Vector3(0,.9,0),offset:.65,wheels:[-1,1].flatMap(z=>[-1,1].map(x=>({position:new THREE.Vector3(x*.78,.32,z*1.4),radius:.38,front:z>0})))};

/** Dimensions and axle positions come from the actual loaded car model. */
export function vehicleProfile(root:THREE.Group):VehicleProfile{
  const cached=profiles.get(root);if(cached)return cached;
  root.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(root),offset=-bounds.min.y+.04,wheels:WheelProfile[]=[];
  for(const object of root.children.filter(o=>/^w[0-3]$/.test(o.name)).sort((a,b)=>a.name.localeCompare(b.name))){
    const box=new THREE.Box3().setFromObject(object),position=object.getWorldPosition(new THREE.Vector3());
    position.set(-position.x,position.y+offset,-position.z);
    wheels.push({position,radius:Math.max(.12,(box.max.y-box.min.y)/2),front:Number(object.name.slice(1))>=2});
  }
  if(wheels.length!==4)throw new Error(`Vehicle ${root.name} has ${wheels.length} wheel assemblies`);
  const half=bounds.getSize(new THREE.Vector3()).multiplyScalar(.5),center=bounds.getCenter(new THREE.Vector3());
  // Wheels and beacons belong to the render bounds; the chassis sits between them.
  half.y=Math.max(.3,half.y-.16);half.x*=.94;half.z*=.98;center.set(-center.x,center.y+offset,-center.z);
  const profile={half,center,wheels,offset};profiles.set(root,profile);return profile;
}
/** Render the same wheel travel, steering and spin used by the force solver. */
export function renderVehicleWheels(root:THREE.Group,body:VehicleMotion|undefined,profile:VehicleProfile,tuning:Record<string,number>={}){
  if(!body)return;
  for(const object of root.children.filter(o=>/^w[0-3]$/.test(o.name))){
    const i=Number(object.name.slice(1)),wheel=profile.wheels[i];
    object.userData.restPosition??=object.position.clone();object.userData.restRotation??=object.quaternion.clone();
    const limit=Math.max(.03,wheel.radius*(tuning.SetSuspensionLimit??.7)),equilibrium=(Math.sqrt(1+5*limit/(tuning.SetSpringK??.3))-1)/10;
    object.position.copy(object.userData.restPosition);object.position.y+=wheel.radius-equilibrium-.06+body.compression[i]-wheel.position.y;
    // Blender's tyre meshes have their own rotated axes. Spin the entire wheel
    // around the car-space axle so rims, tread and offset lug nuts stay together.
    // Models face -Z, so positive forward travel needs negative local-X spin.
    object.quaternion.setFromAxisAngle(Y,wheel.front?body.wheelAngle:0)
      .multiply(new THREE.Quaternion().setFromAxisAngle(X,-body.wheelSpin[i]))
      .multiply(object.userData.restRotation);
  }
}
export function resetVehicle(state:CarState){delete state.vehicleMotion;}
export function vehicleVelocity(state:CarState){return state.vehicleMotion?.velocity??new THREE.Vector3(Math.sin(state.heading)*state.speed,state.verticalSpeed,Math.cos(state.heading)*state.speed);}
export function collideVehicles(a:CarState,b:CarState,aMass=1500,bMass=1500,as:VehicleFootprint=DEFAULT_FOOTPRINT,bs:VehicleFootprint=DEFAULT_FOOTPRINT){
  const contact=vehicleContact(a,b,as,bs);if(!contact)return undefined;
  const inverseA=1/aMass,inverseB=1/bMass,total=inverseA+inverseB;
  a.position.addScaledVector(contact.normal,(contact.depth+.002)*inverseA/total);b.position.addScaledVector(contact.normal,-(contact.depth+.002)*inverseB/total);
  const av=vehicleVelocity(a),bv=vehicleVelocity(b),closing=av.clone().sub(bv).dot(contact.normal);
  if(closing<0){
    const impulse=-closing*(1+VEHICLE_RULES.restitution)/total;av.addScaledVector(contact.normal,impulse*inverseA);bv.addScaledVector(contact.normal,-impulse*inverseB);
    a.speed=av.dot(new THREE.Vector3(Math.sin(a.heading),0,Math.cos(a.heading)));b.speed=bv.dot(new THREE.Vector3(Math.sin(b.heading),0,Math.cos(b.heading)));
    for(const state of [a,b])if(state.vehicleMotion){state.vehicleMotion.lastSpeed=state.speed;state.vehicleMotion.lastPosition.copy(state.position);}
  }
  return {closing:Math.max(0,-closing),normal:contact.normal,depth:contact.depth};
}
function motion(state:CarState){
  let body=state.vehicleMotion;
  if(!body){body={velocity:new THREE.Vector3(Math.sin(state.heading)*state.speed,state.verticalSpeed,Math.cos(state.heading)*state.speed),angularVelocity:new THREE.Vector3(),orientation:new THREE.Quaternion().setFromAxisAngle(Y,state.heading),compression:[0,0,0,0],wheelSpin:[0,0,0,0],slip:0,lastSpeed:state.speed,lastHeading:state.heading,lastPosition:state.position.clone(),wheelAngle:0,hadContact:false,tractionRecovery:0};state.vehicleMotion=body;}
  // Teleports and legacy mission impacts are explicit changes to the public pose.
  if(body.lastPosition.distanceToSquared(state.position)>4||Math.abs(body.lastHeading-state.heading)>.5){resetVehicle(state);return motion(state);}
  if(Math.abs(body.lastSpeed-state.speed)>.01){const forward=Z.clone().applyQuaternion(body.orientation);body.velocity.addScaledVector(forward,state.speed-body.velocity.dot(forward));}
  return body;
}
/** Four suspension contacts and force-at-wheel integration. Native force rules
 * are kept separate from the host rigid-body integrator and collision solver. */
export function simulateVehicle(state:CarState,control:Controls,dt:number,tuning:Record<string,number>={},profile=DEFAULT_VEHICLE,terrain?:Terrain,playerImpact=true){
  const steps=Math.max(1,Math.ceil(dt/VEHICLE_RULES.maximumStep)),step=dt/steps,body=motion(state);
  for(let n=0;n<steps;n++)integrate(state,body,control,step,tuning,profile,terrain,playerImpact);
  body.lastPosition.copy(state.position);body.lastSpeed=state.speed;body.lastHeading=state.heading;
  return body;
}
function integrate(state:CarState,body:VehicleMotion,control:Controls,dt:number,t:Record<string,number>,profile:VehicleProfile,terrain:Terrain|undefined,playerImpact:boolean){
  const mass=t.SetMass??1500,g=VEHICLE_RULES.gravity,gas=t.SetGasScale??4.5,top=(t.SetTopSpeedKmh??154.8)/3.6;
  const up=Y.clone().applyQuaternion(body.orientation),forward=Z.clone().applyQuaternion(body.orientation),right=X.clone().applyQuaternion(body.orientation);
  const speed=body.velocity.length(),along=body.velocity.dot(forward),ratio=Math.min(1,speed/top),flat=!terrain;
  state.steer=THREE.MathUtils.damp(state.steer,control.steer,10,dt);
  body.wheelAngle=-state.steer*THREE.MathUtils.degToRad(t.SetMaxWheelTurnAngle??30)*(1-(t.SetHighSpeedSteeringDrop??.27)*ratio);
  const com=profile.center.clone().add(new THREE.Vector3(t.SetCMOffsetX??0,t.SetCMOffsetY??-.1,t.SetCMOffsetZ??.35));
  if(up.y<.7)com.y+=t.SetWeebleOffset??-.85;
  const centerOfMass=com.clone().applyQuaternion(body.orientation).add(state.position);
  const force=new THREE.Vector3(0,flat?0:-mass*g,0),torque=new THREE.Vector3(),supportNormal=new THREE.Vector3();let grounded=0,drivenGrounded=0,maxTyreForce=0;
  const apply=(f:THREE.Vector3,lever:THREE.Vector3)=>{force.add(f);torque.add(lever.clone().cross(f));};
  for(let i=0;i<4;i++){
    const wheel=profile.wheels[i],limit=Math.max(.03,wheel.radius*(t.SetSuspensionLimit??.7)),k=mass*g/limit*(t.SetSpringK??.3),damper=2*Math.sqrt(k*mass)*(t.SetDamperC??.15);
    const equilibrium=(Math.sqrt(1+20*mass*g/(4*k))-1)/10,mount=wheel.position.clone();mount.y=wheel.radius+limit-equilibrium-.06;
    const lever=mount.clone().sub(com).applyQuaternion(body.orientation),world=mount.clone().applyQuaternion(body.orientation).add(state.position);
    const velocity=body.velocity.clone().add(body.angularVelocity.clone().cross(lever));
    const hit=terrain?.support(world.x,world.z,world.y,.1,limit+wheel.radius+.5),extension=hit?world.y-hit.point.y-wheel.radius:limit+1;
    const contact=flat||!!hit&&extension<=limit&&up.y>.4226;
    body.compression[i]=contact?Math.max(-limit,Math.min(limit,limit-extension)):0;
    if(!contact){body.wheelSpin[i]+=along*dt/wheel.radius;continue;}grounded++;if(!wheel.front)drivenGrounded++;
    const normal=hit?.face?.normal.clone()??Y.clone();if(normal.y<0)normal.negate();normal.normalize();
    supportNormal.add(normal);
    const spring=flat?mass*g/4:Math.max(0,k*body.compression[i]+5*k*body.compression[i]**2-damper*velocity.dot(normal));
    if(!flat)apply(normal.clone().multiplyScalar(Math.min(spring,mass*g*4)),lever);
    const wheelForward=forward.clone().addScaledVector(normal,-forward.dot(normal)).normalize(),wheelRight=new THREE.Vector3().crossVectors(normal,wheelForward).normalize();
    const steeringSide=wheelRight.clone().multiplyScalar(Math.cos(wheel.front?body.wheelAngle:0)).addScaledVector(wheelForward,-Math.sin(wheel.front?body.wheelAngle:0));
    const wheelSpeed=Math.max(.01,velocity.length()),lateral=velocity.dot(steeringSide)/wheelSpeed;
    let stiffness=body.slip===0?(t.SetNormalSteering??95):body.slip===2?(t.SetSlipSteering??55):(t.SetSlipSteeringNoEBrake??50);
    if(body.slip===1)stiffness*=wheel.front?1+(t.SetSlipEffectNoEBrake??.15):1-(t.SetSlipEffectNoEBrake??.15);
    if(control.handbrake&&ratio>.02)stiffness*=wheel.front?1+(t.SetEBrakeEffect??.4):1-(t.SetEBrakeEffect??.4);
    const kind=hit?terrain!.surfaceKind(hit):0,surface=kind===1?.7:[2,3,4,7].includes(kind)?.6:1;
    let lateralForce=-mass*.25*lateral*stiffness*Math.min(1,ratio/.15)*surface;
    const grip=(t.SetTireGrip??2.48)*Math.max(mass*g/4,Math.min(spring,mass*g));
    lateralForce=THREE.MathUtils.clamp(lateralForce,-grip,grip);const wheelForce=wheelRight.multiplyScalar(lateralForce);
    if(!wheel.front){
      const burnout=ratio<(t.SetBurnoutRange??.09)&&control.throttle>.99;
      let acceleration=(body.slip?(t.SetSlipGasScale??gas):gas)*control.throttle*(burnout?.75:1);
      if(control.brake)acceleration-=control.brake*(along>.15?(t.SetBrakeScale??8)+3:gas);
      if(control.handbrake&&speed>.5)acceleration-=Math.sign(along)*3;
      wheelForce.addScaledVector(wheelForward,acceleration*mass);
      if(burnout&&Math.abs(state.steer)>.6)torque.addScaledVector(up,-state.steer*(t.SetDonutTorque??2)*mass*(1-ratio)*.5);
      body.wheelSpin[i]+=control.handbrake&&!control.throttle?0:(burnout?Math.max(8,along):along)*dt/wheel.radius;
    }else body.wheelSpin[i]+=along*dt/wheel.radius;
    maxTyreForce=Math.max(maxTyreForce,wheelForce.length());apply(wheelForce,lever);
  }
  // Arcade recovery for a chassis resting on a fence/kerb with its driven
  // wheels hanging clear. Apply horizontal drive only during body contact;
  // ordinary airborne cars still cannot accelerate or steer without traction.
  const stranded=!flat&&body.hadContact&&drivenGrounded<2&&speed<4&&up.y>.7;
  body.tractionRecovery=stranded?Math.min(1,body.tractionRecovery+dt):Math.max(0,body.tractionRecovery-dt*2);
  if(stranded&&body.tractionRecovery>.35){
    const acceleration=gas*control.throttle-control.brake*(along>.15?(t.SetBrakeScale??8)+3:gas);
    const direction=forward.clone();direction.y=0;direction.normalize();force.addScaledVector(direction,acceleration*mass*(2-drivenGrounded));
  }
  state.grounded=grounded>0;
  // PAL 0x2801e8 supplies upright torque and angular damping; 0x280388
  // additionally lets steering roll a nearly stationary overturned car upright.
  const targetUp=grounded>=2?supportNormal.normalize():Y,tilt=up.dot(targetUp);
  if(!flat&&(grounded>=2||body.hadContact)&&tilt<.9848){
    const axis=up.clone().cross(targetUp);if(axis.lengthSq()<1e-6)axis.copy(forward);axis.normalize();
    torque.addScaledVector(axis,mass*(1-tilt)*200);
    torque.addScaledVector(body.angularVelocity.clone().addScaledVector(Y,-body.angularVelocity.y),-mass*7);
    if(speed<1&&up.y<.2&&control.steer*right.y<0)torque.addScaledVector(forward,control.steer*mass*130);
  }
  if(control.handbrake&&ratio>.05)body.slip=2;
  else if(body.slip===0&&maxTyreForce>(t.SetTireGrip??2.48)*mass*g/4)body.slip=1;
  else if(speed<1||!control.throttle||forward.dot(body.velocity.clone().normalize())>.9659&&Math.abs(control.steer)<.1)body.slip=0;
  // SetTopSpeedKmh determines the drag equilibrium, rather than clamping every
  // frame. Downhill momentum and impacts can exceed the engine's level-road speed.
  if(speed>.01){
    const drag=2*gas*mass/(top*top)*speed*speed;
    force.addScaledVector(body.velocity,-drag/speed);
    if(!control.throttle&&grounded>1)force.addScaledVector(body.velocity,-Math.min(mass*1.2,mass*speed/dt)/speed);
  }
  const previous=state.position.clone();body.velocity.addScaledVector(force,dt/mass);
  if(control.brake&&along>.15&&body.velocity.dot(forward)<0)body.velocity.addScaledVector(forward,-body.velocity.dot(forward));
  const reverse=body.velocity.dot(forward);if(reverse<-VEHICLE_RULES.reverseSpeed)body.velocity.addScaledVector(forward,-VEHICLE_RULES.reverseSpeed-reverse);
  if(speed<.12&&!control.throttle&&(!control.brake||control.handbrake)&&grounded>1){body.velocity.x=body.velocity.z=0;}
  const half=profile.half,inertia=new THREE.Vector3(mass*(half.y**2+half.z**2)/3,mass*(half.x**2+half.z**2)/3,mass*(half.x**2+half.y**2)/3);
  const localTorque=torque.applyQuaternion(body.orientation.clone().invert()).divide(inertia).applyQuaternion(body.orientation);
  body.angularVelocity.addScaledVector(localTorque,dt).multiplyScalar(Math.exp(-dt*.8));
  if(flat){body.velocity.y=0;body.angularVelocity.x=body.angularVelocity.z=0;}
  if(body.angularVelocity.length()>12)body.angularVelocity.setLength(12);
  const angularSpeed=body.angularVelocity.length();if(angularSpeed>0)body.orientation.premultiply(new THREE.Quaternion().setFromAxisAngle(body.angularVelocity.clone().divideScalar(angularSpeed),angularSpeed*dt)).normalize();
  // Integrate the centre of mass. Rotating around the car's floor origin made
  // landings lift the body into walls and left overturned cars hanging there.
  state.position.copy(centerOfMass.addScaledVector(body.velocity,dt).sub(com.clone().applyQuaternion(body.orientation)));
  body.hadContact=false;
  if(terrain){
    for(let iteration=0;iteration<3;iteration++){
      const center=profile.center.clone().applyQuaternion(body.orientation).add(state.position),contact=terrain.boxContact(center,profile.half,body.orientation);if(!contact||contact.depth<1e-5)break;
      if(playerImpact&&contact.id&&terrain.onVehicleImpact?.(contact.id,Math.max(0,-body.velocity.dot(contact.normal)),center)){body.velocity.multiplyScalar(.92);continue;}
      state.position.addScaledVector(contact.normal,contact.depth+.001);
      body.hadContact=true;
      const lever=contact.point.clone().sub(com.clone().applyQuaternion(body.orientation).add(state.position));
      const inverseInertia=(v:THREE.Vector3)=>v.applyQuaternion(body.orientation.clone().invert()).divide(inertia).applyQuaternion(body.orientation);
      const pointVelocity=body.velocity.clone().add(body.angularVelocity.clone().cross(lever)),closing=pointVelocity.dot(contact.normal);
      if(closing<0){
        const angular=inverseInertia(lever.clone().cross(contact.normal)),denominator=1/mass+contact.normal.dot(angular.clone().cross(lever));
        const impulse=-closing*(1+(-closing>1?VEHICLE_RULES.restitution:0))/Math.max(1e-8,denominator);
        body.velocity.addScaledVector(contact.normal,impulse/mass);body.angularVelocity.addScaledVector(angular,impulse);
        const tangent=pointVelocity.clone().addScaledVector(contact.normal,-closing),tangentSpeed=tangent.length();
        if(tangentSpeed>.01){tangent.divideScalar(tangentSpeed);const spin=inverseInertia(lever.clone().cross(tangent));const friction=Math.min(impulse*.55,tangentSpeed/(1/mass+tangent.dot(spin.clone().cross(lever))));body.velocity.addScaledVector(tangent,-friction/mass);body.angularVelocity.addScaledVector(spin,-friction);}
        if(-closing>(contact.normal.y>.5?8:2))state.damage=Math.min(100,state.damage+(-closing-2)*.85/((t.SetHitPoints??3)/3));}
      if(contact.normal.y>.5)state.grounded=true;
    }
  }
  const facing=Z.clone().applyQuaternion(body.orientation);state.heading=Math.atan2(facing.x,facing.z);state.speed=body.velocity.dot(facing);state.verticalSpeed=body.velocity.y;state.distance+=state.position.distanceTo(previous);
}
