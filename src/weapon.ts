import * as THREE from 'three';
import { buildRifle,disposeRifle,GRIP,MUZZLE } from './rifle';
import type { Avatar } from './vrm-avatar';

/**
 * The rifle's behaviour, carried over from the sibling project with its numbers intact.
 *
 * Ten rounds a second felt through VOLUME of fire rather than per-round violence: a
 * small kick that COMPOUNDS toward a ceiling so a held trigger climbs and bursts pay,
 * a thirty-round magazine, and a hip cone that blooms while you move and tightens when
 * you stand still. Damage falls off with distance to a floor rather than to nothing.
 *
 * Their tick is 60 Hz, so their tick counts are seconds here: a 6-tick cooldown is the
 * 0.1 s that makes 10 rounds a second, and a 90-tick reload is 1.5 s.
 */
export const RIFLE={
  range:160,damage:18,impulse:7,
  cooldown:6/60,
  mag:30,reload:90/60,reloadEmpty:120/60,
  /** Per round — small, but it compounds toward `recoilMax` while the trigger is held. */
  recoilKick:0.16,recoilMax:1.1,
  /** Slower recovery than a pistol's: bursts, not hoses. Per 60 Hz tick. */
  recoilDecay:0.88,
  hipSpread:0.028,aimSpread:0.004,moveBloom:0.004,
  falloffNear:35,falloffFar:120,falloffFloor:0.65,
} as const;

/** How the gun sits in the hand: the grip socket meets the palm, muzzle down the arm. */
const HOLD_POSITION=new THREE.Vector3(0.02,-0.03,-0.06);
const HOLD_ROTATION=new THREE.Euler(Math.PI/2,Math.PI/2,0);

export interface Shot {from:THREE.Vector3;to:THREE.Vector3;hit:boolean}
/** What the world does with a bullet: report what it struck, if anything. */
export interface Ballistics {trace(from:THREE.Vector3,direction:THREE.Vector3,range:number,damage:number):THREE.Vector3|undefined}

/** Damage at a distance: full inside `falloffNear`, easing to a floor by `falloffFar`. */
export function falloff(distance:number){
  if(distance<=RIFLE.falloffNear)return 1;
  if(distance>=RIFLE.falloffFar)return RIFLE.falloffFloor;
  const t=(distance-RIFLE.falloffNear)/(RIFLE.falloffFar-RIFLE.falloffNear);
  return 1-(1-RIFLE.falloffFloor)*t;
}

export class Rifle {
  readonly group=buildRifle();
  /** Rounds in the magazine, and the reload's remaining seconds while one is running. */
  ammo=RIFLE.mag;reloading=0;
  /** The climb, in radians. Written by firing, bled off every frame. */
  recoil=0;
  private cooldown=0;private cycle=0;private held=false;
  private flash:THREE.PointLight;private flashSprite:THREE.Sprite;
  private tracers:{line:THREE.Line;life:number}[]=[];
  private tracerRoot=new THREE.Group();

  constructor(private scene:THREE.Scene){
    this.flash=new THREE.PointLight(0xffd9a0,0,7,2);this.flash.position.copy(MUZZLE);
    this.group.add(this.flash);
    const texture=muzzleTexture();
    this.flashSprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:0}));
    this.flashSprite.scale.setScalar(.38);this.flashSprite.position.copy(MUZZLE);
    this.group.add(this.flashSprite);
    scene.add(this.tracerRoot);
  }

  /** Hang the rifle off a body's hand, in the two-hand carry. */
  mount(avatar:Avatar){
    const hand=avatar.hand();
    if(!hand)return false;
    hand.add(this.group);
    this.group.position.copy(HOLD_POSITION).sub(GRIP.clone().multiplyScalar(0));
    this.group.rotation.copy(HOLD_ROTATION);
    this.group.scale.setScalar(1);
    avatar.holdPose(true);
    return true;
  }
  unmount(avatar?:Avatar){avatar?.holdPose(false);this.group.removeFromParent();}

  get empty(){return this.ammo<=0;}
  get busy(){return this.reloading>0;}

  /** Start a reload. Coming up from empty takes longer, as it does in the other game. */
  startReload(){
    if(this.reloading>0||this.ammo>=RIFLE.mag)return false;
    this.reloading=this.ammo<=0?RIFLE.reloadEmpty:RIFLE.reload;
    return true;
  }

  /**
   * Pull the trigger. Returns the shot if one left the barrel.
   *
   * `aim` is the direction the player is looking; the cone applied to it is the hip
   * spread, tightened by standing still and opened by movement and by the climb.
   */
  fire(aim:THREE.Vector3,muzzleWorld:THREE.Vector3,moving:boolean,world:Ballistics):Shot|undefined{
    this.held=true;
    if(this.cooldown>0||this.reloading>0)return undefined;
    if(this.ammo<=0){this.startReload();return undefined;}
    this.ammo--;this.cooldown=RIFLE.cooldown;this.cycle=1;
    this.recoil=Math.min(RIFLE.recoilMax,this.recoil+RIFLE.recoilKick);
    const spread=RIFLE.hipSpread+(moving?RIFLE.moveBloom:0)+this.recoil*0.02;
    const direction=aim.clone().normalize();
    // A cone, not a square: an angle around the aim and a random roll about it.
    const angle=spread*Math.sqrt(Math.random()),roll=Math.random()*Math.PI*2;
    const side=new THREE.Vector3().crossVectors(direction,new THREE.Vector3(0,1,0));
    if(side.lengthSq()<1e-6)side.set(1,0,0);
    side.normalize();
    const up=new THREE.Vector3().crossVectors(side,direction).normalize();
    direction.addScaledVector(side,Math.cos(roll)*angle).addScaledVector(up,Math.sin(roll)*angle).normalize();
    const hit=world.trace(muzzleWorld,direction,RIFLE.range,RIFLE.damage);
    const to=hit??muzzleWorld.clone().addScaledVector(direction,RIFLE.range);
    this.spawnTracer(muzzleWorld,to);
    this.flash.intensity=9;this.flashSprite.material.opacity=1;
    this.flashSprite.material.rotation=Math.random()*Math.PI;
    if(this.ammo<=0)this.startReload();
    return {from:muzzleWorld.clone(),to,hit:!!hit};
  }
  release(){this.held=false;}

  private spawnTracer(from:THREE.Vector3,to:THREE.Vector3){
    const geometry=new THREE.BufferGeometry().setFromPoints([from.clone(),to.clone()]);
    const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0xffe08a,transparent:true,opacity:.85}));
    this.tracerRoot.add(line);this.tracers.push({line,life:.06});
  }

  update(dt:number){
    this.cooldown=Math.max(0,this.cooldown-dt);
    // The climb decays per 60 Hz tick in the other game; matched here whatever the frame rate.
    this.recoil*=Math.pow(RIFLE.recoilDecay,dt*60);
    if(this.recoil<1e-3)this.recoil=0;
    if(this.reloading>0){
      this.reloading=Math.max(0,this.reloading-dt);
      if(this.reloading===0)this.ammo=RIFLE.mag;
    }
    this.flash.intensity=Math.max(0,this.flash.intensity-dt*90);
    this.flashSprite.material.opacity=Math.max(0,this.flashSprite.material.opacity-dt*14);
    // The charging handle rides the bolt on every round, and the magazine leaves the
    // well while a reload runs — both are what makes the gun read as working.
    this.cycle=Math.max(0,this.cycle-dt/0.06);
    const handle=this.group.getObjectByName('handle'),knob=this.group.getObjectByName('handleKnob');
    for(const part of [handle,knob])if(part)part.position.z=(part.userData.home??=part.position.z)+this.cycle*0.05;
    const mag=this.group.getObjectByName('mag');
    if(mag){
      const out=this.reloading>0?Math.sin(Math.min(1,this.reloading/RIFLE.reload)*Math.PI):0;
      mag.position.y=(mag.userData.home??=mag.position.y)-out*0.14;
    }
    for(const tracer of [...this.tracers]){
      tracer.life-=dt;
      (tracer.line.material as THREE.LineBasicMaterial).opacity=Math.max(0,tracer.life/.06)*.85;
      if(tracer.life<=0){tracer.line.geometry.dispose();(tracer.line.material as THREE.Material).dispose();tracer.line.removeFromParent();this.tracers.splice(this.tracers.indexOf(tracer),1);}
    }
    // The rifle rides its own recoil: the muzzle climbs, then settles.
    this.group.rotation.x=HOLD_ROTATION.x-this.recoil*0.30;
  }
  /** Where the round leaves, in world space. */
  muzzleWorld(target=new THREE.Vector3()){return this.group.localToWorld(target.copy(MUZZLE));}
  get firing(){return this.held;}

  dispose(){
    for(const tracer of this.tracers){tracer.line.geometry.dispose();(tracer.line.material as THREE.Material).dispose();}
    this.tracers.length=0;this.tracerRoot.removeFromParent();
    this.flashSprite.material.map?.dispose();this.flashSprite.material.dispose();
    disposeRifle(this.group);
  }
}

/** A soft additive blob for the muzzle flash — drawn, not downloaded. */
function muzzleTexture(){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  const c=canvas.getContext('2d')!;
  const gradient=c.createRadialGradient(32,32,0,32,32,32);
  gradient.addColorStop(0,'rgba(255,246,214,1)');
  gradient.addColorStop(.35,'rgba(255,196,92,.75)');
  gradient.addColorStop(1,'rgba(255,140,20,0)');
  c.fillStyle=gradient;c.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}
