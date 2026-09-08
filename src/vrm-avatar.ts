import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VRMLoaderPlugin,VRMUtils,type VRM } from '@pixiv/three-vrm';

/**
 * VRM player avatars, sharing the sibling project's models and animation set.
 *
 * The game's own character is a bespoke skinned rig with clips baked into the
 * converted assets. A VRM has a standard humanoid skeleton and no clips at all,
 * so the motion comes from the same Mixamo FBX files the other game loads and is
 * retargeted onto whichever humanoid the player is wearing. Everything is fetched
 * from the shared asset host, which serves `access-control-allow-origin: *`.
 *
 * `VrmAvatar` deliberately mirrors `Character`'s surface — same `play` names, same
 * `drive`/`walk`/`update`/`dispose` — so the game, the network sample and the remote
 * avatars never need to know which kind of body they are moving.
 */
/** What the game needs of a body, whichever kind it is: `Character` satisfies this too. */
export interface Avatar {
  readonly group:THREE.Group;
  readonly playing:string;
  duration(name:string):number;
  play(name:string,once?:boolean):void;
  drive(car:THREE.Group):void;
  walk(scene:THREE.Scene,position:THREE.Vector3,heading:number):void;
  update(dt:number):void;
  dispose():void;
}
/** A VRM avatar is named by its file; anything else is one of the game's own characters. */
export const isVrmSkin=(skin:string)=>/\.vrm$/i.test(skin);

export const AVATAR_ORIGIN='https://axeassets.schizod.io/assets';
export const characterURL=(file:string)=>`${AVATAR_ORIGIN}/characters/${encodeURIComponent(file)}`;
const animationURL=(file:string)=>`${AVATAR_ORIGIN}/animations/${encodeURIComponent(file)}`;
export const DEFAULT_VRM='SchizoAxe.vrm';

/** The models the sibling project ships, in its own order. */
export const VRM_MODELS=['SchizoAxe.vrm','sch1z0br0000.vrm','Schizotron.vrm','BROLY.vrm','JIGGAZ0.vrm','JIGGAZ1.vrm','JIGGAZ2.vrm','brother67.vrm','brotherKuma.vrm','sch1z0br0000_red.vrm','sch1z0br0004.vrm','0xDn.vrm'];

/**
 * The clips, and which of this game's animation names each one answers to.
 * Naming stays in the game's vocabulary so `play('hom_loco_run')` works on either body.
 */
const CLIPS={
  idle:{file:'Breathing Idle.fbx',names:['hom_loco_idle_rest','hom_in_car_idle','PTRN_Motion_Root']},
  walk:{file:'Walking.fbx',names:['hom_loco_walk']},
  run:{file:'Drunk Run Forward (2).fbx',names:['hom_loco_run']},
  jump:{file:'Jump.fbx',names:['hom_jump_idle_in_air','hom_jump_dash_in_air']},
  kick:{file:'Strike Foward Jog.fbx',names:['hom_jump_kick']},
} as const;
type Slot=keyof typeof CLIPS;
const SLOT_FOR=new Map<string,Slot>();
for(const [slot,clip] of Object.entries(CLIPS))for(const name of clip.names)SLOT_FOR.set(name,slot as Slot);

const MIXAMO_TO_VRM:Record<string,string>={
  'mixamorigHips': 'hips',
  'mixamorigSpine': 'spine',
  'mixamorigSpine1': 'chest',
  'mixamorigSpine2': 'upperChest',
  'mixamorigNeck': 'neck',
  'mixamorigHead': 'head',
  'mixamorigLeftShoulder': 'leftShoulder',
  'mixamorigLeftArm': 'leftUpperArm',
  'mixamorigLeftForeArm': 'leftLowerArm',
  'mixamorigLeftHand': 'leftHand',
  'mixamorigLeftHandThumb1': 'leftThumbMetacarpal',
  'mixamorigLeftHandThumb2': 'leftThumbProximal',
  'mixamorigLeftHandThumb3': 'leftThumbDistal',
  'mixamorigLeftHandIndex1': 'leftIndexProximal',
  'mixamorigLeftHandIndex2': 'leftIndexIntermediate',
  'mixamorigLeftHandIndex3': 'leftIndexDistal',
  'mixamorigLeftHandMiddle1': 'leftMiddleProximal',
  'mixamorigLeftHandMiddle2': 'leftMiddleIntermediate',
  'mixamorigLeftHandMiddle3': 'leftMiddleDistal',
  'mixamorigLeftHandRing1': 'leftRingProximal',
  'mixamorigLeftHandRing2': 'leftRingIntermediate',
  'mixamorigLeftHandRing3': 'leftRingDistal',
  'mixamorigLeftHandPinky1': 'leftLittleProximal',
  'mixamorigLeftHandPinky2': 'leftLittleIntermediate',
  'mixamorigLeftHandPinky3': 'leftLittleDistal',
  'mixamorigRightShoulder': 'rightShoulder',
  'mixamorigRightArm': 'rightUpperArm',
  'mixamorigRightForeArm': 'rightLowerArm',
  'mixamorigRightHand': 'rightHand',
  'mixamorigRightHandThumb1': 'rightThumbMetacarpal',
  'mixamorigRightHandThumb2': 'rightThumbProximal',
  'mixamorigRightHandThumb3': 'rightThumbDistal',
  'mixamorigRightHandIndex1': 'rightIndexProximal',
  'mixamorigRightHandIndex2': 'rightIndexIntermediate',
  'mixamorigRightHandIndex3': 'rightIndexDistal',
  'mixamorigRightHandMiddle1': 'rightMiddleProximal',
  'mixamorigRightHandMiddle2': 'rightMiddleIntermediate',
  'mixamorigRightHandMiddle3': 'rightMiddleDistal',
  'mixamorigRightHandRing1': 'rightRingProximal',
  'mixamorigRightHandRing2': 'rightRingIntermediate',
  'mixamorigRightHandRing3': 'rightRingDistal',
  'mixamorigRightHandPinky1': 'rightLittleProximal',
  'mixamorigRightHandPinky2': 'rightLittleIntermediate',
  'mixamorigRightHandPinky3': 'rightLittleDistal',
  'mixamorigLeftUpLeg': 'leftUpperLeg',
  'mixamorigLeftLeg': 'leftLowerLeg',
  'mixamorigLeftFoot': 'leftFoot',
  'mixamorigLeftToeBase': 'leftToes',
  'mixamorigRightUpLeg': 'rightUpperLeg',
  'mixamorigRightLeg': 'rightLowerLeg',
  'mixamorigRightFoot': 'rightFoot',
  'mixamorigRightToeBase': 'rightToes',
  'mixamorigLeftEye': 'leftEye',
  'mixamorigRightEye': 'rightEye',
  'mixamorigJaw': 'jaw',
};

/**
 * Retarget one Mixamo clip onto a VRM humanoid.
 *
 * Ported from the sibling project, which follows three-vrm's own recipe: rebuild
 * each rotation as `parentRestWorld * key * restInverse`, so the FBX's pre-rotations
 * and hierarchy are divided out and only the motion survives. The hips translation
 * is rescaled by the ratio of hip heights, which is what lets one clip drive avatars
 * of different builds without the short ones hovering.
 */
export function retargetMixamoClip(clip:THREE.AnimationClip,fbx:THREE.Object3D,vrm:VRM){
  const quaternion=new THREE.Quaternion(),vector=new THREE.Vector3();
  const hips=fbx.getObjectByName('mixamorigHips');
  // Mixamo hangs the hips straight off an identity root, so the local offset is the height.
  // Guard the degenerate export: hips at y=0 would make the scale infinite.
  const motionHipsHeight=Math.max(Math.abs(hips?.position.y??100),1);
  const vrmHips=vrm.humanoid.getNormalizedBoneNode('hips');
  const vrmHipsY=vrmHips?vrmHips.getWorldPosition(vector).y:1;
  const vrmRootY=vrm.scene.getWorldPosition(new THREE.Vector3()).y;
  const hipsPositionScale=Math.max(Math.abs(vrmHipsY-vrmRootY),0.01)/motionHipsHeight;
  const isVRM0=vrm.meta?.metaVersion==='0';
  const tracks:THREE.KeyframeTrack[]=[];

  for(const track of clip.tracks){
    const split=track.name.lastIndexOf('.');if(split<0)continue;
    const property=track.name.slice(split+1),path=track.name.slice(0,split);
    const sourceName=path.slice(path.lastIndexOf('/')+1);
    const vrmBoneName=MIXAMO_TO_VRM[sourceName];if(!vrmBoneName)continue;
    const node=vrm.humanoid.getNormalizedBoneNode(vrmBoneName as never);if(!node)continue;
    const sourceNode=fbx.getObjectByName(sourceName);if(!sourceNode?.parent)continue;
    const restInverse=sourceNode.getWorldQuaternion(new THREE.Quaternion()).invert();
    const parentRest=sourceNode.parent.getWorldQuaternion(new THREE.Quaternion());

    if(property==='quaternion'){
      const values=new Float32Array(track.values.length);
      for(let i=0;i<track.values.length;i+=4){
        quaternion.set(track.values[i],track.values[i+1],track.values[i+2],track.values[i+3])
          .premultiply(parentRest).multiply(restInverse);
        // VRM 0.0 faces the other way down the Z axis, which mirrors x and z.
        const parts=[isVRM0?-quaternion.x:quaternion.x,quaternion.y,isVRM0?-quaternion.z:quaternion.z,quaternion.w];
        // Bad FBX data reaching a Float32Array here would crash the renderer, not just look wrong.
        for(let k=0;k<4;k++)values[i+k]=Number.isFinite(parts[k])?parts[k]:(k===3?1:0);
      }
      // Keep consecutive keys in one hemisphere so slerp takes the short way round;
      // otherwise a direction change spins the whole bone through 360 degrees.
      for(let i=4;i<values.length;i+=4){
        const dot=values[i]*values[i-4]+values[i+1]*values[i-3]+values[i+2]*values[i-2]+values[i+3]*values[i-1];
        if(dot<0)for(let k=0;k<4;k++)values[i+k]=-values[i+k];
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`,track.times.slice() as never,values as never));
    }else if(property==='position'&&vrmBoneName==='hips'){
      const values=new Float32Array(track.values.length);
      for(let i=0;i<track.values.length;i+=3){
        const parts=[(isVRM0?-track.values[i]:track.values[i])*hipsPositionScale,track.values[i+1]*hipsPositionScale,(isVRM0?-track.values[i+2]:track.values[i+2])*hipsPositionScale];
        for(let k=0;k<3;k++)values[i+k]=Number.isFinite(parts[k])?parts[k]:0;
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.position`,track.times.slice() as never,values as never));
    }
  }
  return new THREE.AnimationClip(clip.name||'retargeted',clip.duration,tracks);
}

/** One shared loader set, and one download per clip however many avatars are wearing it. */
const gltf=new GLTFLoader();gltf.register(parser=>new VRMLoaderPlugin(parser));
const fbx=new FBXLoader();
const clipCache=new Map<Slot,Promise<{clip:THREE.AnimationClip;scene:THREE.Object3D}>>();
function sourceClip(slot:Slot){
  let pending=clipCache.get(slot);
  if(!pending){
    pending=fbx.loadAsync(animationURL(CLIPS[slot].file)).then(scene=>{
      const clip=scene.animations[0];
      if(!clip)throw new Error(`${CLIPS[slot].file} carries no animation`);
      scene.updateMatrixWorld(true);
      return {clip,scene};
    });
    clipCache.set(slot,pending);
  }
  return pending;
}

/** The seated pose, copied bone for bone from the sibling project's driving pose. */
const DRIVING_POSE:Record<string,{x?:number;y?:number;z?:number}>={
  hips:{x:-0.28},spine:{x:0.16},chest:{x:0.1},
  leftUpperLeg:{x:-1.28,z:0.08},rightUpperLeg:{x:-1.28,z:-0.08},
  leftLowerLeg:{x:1.46},rightLowerLeg:{x:1.46},
  leftUpperArm:{x:-0.42,z:0.65},rightUpperArm:{x:-0.42,z:-0.65},
  leftLowerArm:{x:-1.22},rightLowerArm:{x:-1.22},
  leftHand:{y:0.2},rightHand:{y:-0.2},head:{x:0},
};

export class VrmAvatar {
  /** The node the game moves. The VRM hangs inside it so the game never touches VRM internals. */
  group=new THREE.Group();
  private vrm?:VRM;
  private mixer?:THREE.AnimationMixer;
  private actions=new Map<Slot,THREE.AnimationAction>();
  private active='';
  private seated=false;
  /** This avatar's hip height in metres, measured from its own rest pose — see `drive`. */
  private hipsHeight=0.618;
  get playing(){return this.active;}
  get loaded(){return !!this.vrm;}

  async load(file=DEFAULT_VRM){
    // Only ever a filename on the shared host: a peer names its own avatar, and that
    // name must never be able to become an arbitrary URL this browser then fetches.
    const url=characterURL(file.split(/[\\/]/).pop()||DEFAULT_VRM);
    const asset=await gltf.loadAsync(url);
    const vrm=asset.userData.vrm as VRM|undefined;
    if(!vrm)throw new Error(`${file} is not a VRM`);
    // VRM 0.0 models are authored facing -Z; this turns them to +Z, which is the
    // direction a heading of 0 walks in here, so no per-model yaw offset is needed.
    if(vrm.meta?.metaVersion!=='1')VRMUtils.rotateVRM0(vrm);
    VRMUtils.removeUnnecessaryJoints(vrm.scene);
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    vrm.scene.traverse(node=>{if((node as THREE.Mesh).isMesh){node.castShadow=true;node.receiveShadow=true;node.frustumCulled=false;}});
    this.vrm=vrm;this.group.add(vrm.scene);
    this.group.updateMatrixWorld(true);
    const hips=vrm.humanoid.getNormalizedBoneNode('hips');
    if(hips)this.hipsHeight=Math.abs(hips.getWorldPosition(new THREE.Vector3()).y-this.group.getWorldPosition(new THREE.Vector3()).y);
    this.mixer=new THREE.AnimationMixer(vrm.scene);

    // Idle first so the avatar is never a T-pose on screen, then the rest in the background.
    await this.slot('idle');
    this.play('hom_loco_idle_rest');
    void Promise.all((Object.keys(CLIPS) as Slot[]).filter(slot=>slot!=='idle').map(slot=>this.slot(slot).catch(()=>{})));
    return this;
  }

  private async slot(slot:Slot){
    if(this.actions.has(slot))return this.actions.get(slot)!;
    const {clip,scene}=await sourceClip(slot);
    if(!this.vrm||!this.mixer)throw new Error('avatar disposed while loading');
    const action=this.mixer.clipAction(retargetMixamoClip(clip,scene,this.vrm));
    action.setLoop(THREE.LoopRepeat,Infinity);
    this.actions.set(slot,action);
    // A clip that arrives after the state it answers to was asked for still needs to start.
    if(SLOT_FOR.get(this.active)===slot&&!this.seated){action.reset().fadeIn(.15).play();}
    return action;
  }

  duration(name:string){const slot=SLOT_FOR.get(name);return slot?this.actions.get(slot)?.getClip().duration??0:0;}

  play(name:string,once=false){
    if(name===this.active)return;
    const from=SLOT_FOR.get(this.active),to=SLOT_FOR.get(name);
    this.active=name;
    if(from===to)return;
    if(from)this.actions.get(from)?.fadeOut(.15);
    const next=to&&this.actions.get(to);
    if(next){
      next.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);
      next.clampWhenFinished=once;next.reset().fadeIn(.15).play();
    }else if(to)void this.slot(to).catch(()=>{});
  }

  drive(car:THREE.Group){
    car.add(this.group);
    // Seat by the HIPS, not by the feet. The game's own driver is placed at
    // (-0.48, -0.32, -0.15) in car space and carries its pelvis 0.618 above its own
    // origin (measured off homer.json's rest rig), so the driving seat is 0.298 above
    // the car's origin. Dropping any avatar's measured hips onto that same height is
    // what lets a short VRM and a tall one both sit in the seat instead of hovering
    // over it or sinking through the floor.
    this.group.position.set(-0.48,0.298-this.hipsHeight,-0.15);
    this.group.rotation.set(0,Math.PI,0);this.group.scale.setScalar(1);
    this.seated=true;this.mixer?.stopAllAction();this.active='hom_in_car_idle';
  }
  walk(scene:THREE.Scene,position:THREE.Vector3,heading:number){
    scene.add(this.group);this.group.position.copy(position);this.group.rotation.set(0,heading,0);
    this.seated=false;this.active='';this.play('hom_loco_idle_rest');
  }

  update(dt:number){
    if(!this.vrm)return;
    this.mixer?.update(dt);
    // The seated pose is written straight onto the humanoid, so it goes on after the
    // mixer and before `vrm.update`, which is what pushes normalized bones onto the rig.
    if(this.seated)for(const [bone,angles] of Object.entries(DRIVING_POSE)){
      const node=this.vrm.humanoid.getNormalizedBoneNode(bone as never);
      if(!node)continue;
      node.rotation.set(angles.x??0,angles.y??0,angles.z??0);
    }
    this.vrm.update(dt);
  }

  dispose(){
    this.mixer?.stopAllAction();
    if(this.vrm){this.mixer?.uncacheRoot(this.vrm.scene);VRMUtils.deepDispose(this.vrm.scene);}
    this.group.removeFromParent();this.group.clear();
    this.vrm=undefined;this.mixer=undefined;this.actions.clear();
  }
}
