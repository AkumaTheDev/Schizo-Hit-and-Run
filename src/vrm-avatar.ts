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
  /** The bone a weapon hangs from, once the body has loaded. */
  hand():THREE.Object3D|undefined;
  /** Ask for the two-hand carry. Bodies with firing clips answer with those instead. */
  holdPose(active:boolean):void;
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
export const CLIPS={
  idle:{file:'Breathing Idle.fbx',names:['hom_loco_idle_rest','hom_in_car_idle','PTRN_Motion_Root']},
  walk:{file:'Walking.fbx',names:['hom_loco_walk']},
  run:{file:'Drunk Run Forward (2).fbx',names:['hom_loco_run']},
  jump:{file:'Jump.fbx',names:['hom_jump_idle_in_air','hom_jump_dash_in_air']},
  kick:{file:'Strike Foward Jog.fbx',names:['hom_jump_kick']},
  punch:{file:'Standing Melee Punch.fbx',names:['hom_punch']},
  // NOT a Mixamo rig: an Unreal mannequin (pelvis/spine_01/thigh_l). Without the UE
  // half of the bone map it retargets to nothing and plays as a silent no-op.
  backflip:{file:'BackFlip.glb',names:['hom_backflip']},
  gunIdle:{file:'Breathing Idle.fbx',names:['hom_gun_idle']},
  gunShoot:{file:'Firing Rifle.fbx',names:['hom_gun_fire']},
  gunShootWalk:{file:'Shoot Rifle.fbx',names:['hom_gun_fire_walk']},
} as const;
type Slot=keyof typeof CLIPS|Blend;
/**
 * Clips this game builds for itself by splitting two others at the waist, because no
 * single recording covers them: holding a gun while your legs walk or run, and the
 * jump's upper body over a running stride.
 */
type Blend='gunWalk'|'gunRun'|'jumpRun';
const BLEND_NAMES:Record<Blend,string[]>={
  gunWalk:['hom_gun_walk'],gunRun:['hom_gun_run'],jumpRun:['hom_jump_run'],
};
const SLOT_FOR=new Map<string,Slot>();
for(const [slot,clip] of Object.entries(CLIPS))for(const name of clip.names)SLOT_FOR.set(name,slot as Slot);
for(const [blend,names] of Object.entries(BLEND_NAMES))for(const name of names)SLOT_FOR.set(name,blend as Slot);

/** The humanoid bones, and the split the blends are cut along. */
export const VRM_BONES=['hips','spine','chest','upperChest','neck','head','leftShoulder','leftUpperArm','leftLowerArm','leftHand','rightShoulder','rightUpperArm','rightLowerArm','rightHand','leftUpperLeg','leftLowerLeg','leftFoot','leftToes','rightUpperLeg','rightLowerLeg','rightFoot','rightToes','leftEye','rightEye','jaw'];
/** Everything the legs do: the half a locomotion clip keeps in a blend. */
export const LOWER=new Set(['hips','leftUpperLeg','leftLowerLeg','leftFoot','leftToes','rightUpperLeg','rightLowerLeg','rightFoot','rightToes']);
const UPPER=new Set(VRM_BONES.filter(bone=>!LOWER.has(bone)));
/** Running with the gun keeps the LEFT arm swinging on the run cycle; it holds nothing. */
const LEFT_ARM=new Set(VRM_BONES.filter(bone=>bone.startsWith('left')&&!LOWER.has(bone)&&bone!=='leftEye'));
const UPPER_NO_LEFT_ARM=new Set([...UPPER].filter(bone=>!LEFT_ARM.has(bone)));

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

// Not every clip is a Mixamo rig. The Unreal mannequin names its bones pelvis,
// spine_01, thigh_l, clavicle_r; the retargeter itself is rig-agnostic — it looks each
// source bone up in this map — but an unmapped clip does not error. It retargets to
// zero tracks and plays as a silent no-op, which is exactly what a missing animation
// looks like in game. `root` is deliberately absent: it is UE's root-motion node and
// the game's own physics owns the trajectory.
for(const [side,full] of [['l','left'],['r','right']] as const){
  Object.assign(MIXAMO_TO_VRM,{
    [`clavicle_${side}`]:`${full}Shoulder`,[`upperarm_${side}`]:`${full}UpperArm`,
    [`lowerarm_${side}`]:`${full}LowerArm`,[`hand_${side}`]:`${full}Hand`,
    [`thigh_${side}`]:`${full}UpperLeg`,[`calf_${side}`]:`${full}LowerLeg`,
    [`foot_${side}`]:`${full}Foot`,[`ball_${side}`]:`${full}Toes`,
    // UE numbers a finger 01/02/03 from the knuckle out; VRM calls those
    // Proximal/Intermediate/Distal. The thumb is the exception in both rigs — its
    // first joint is the metacarpal — and VRM calls UE's "pinky" the little finger.
    [`thumb_01_${side}`]:`${full}ThumbMetacarpal`,[`thumb_02_${side}`]:`${full}ThumbProximal`,[`thumb_03_${side}`]:`${full}ThumbDistal`,
    ...Object.fromEntries(([['index','Index'],['middle','Middle'],['ring','Ring'],['pinky','Little']] as const).flatMap(([ue,vrm])=>[
      [`${ue}_01_${side}`,`${full}${vrm}Proximal`],[`${ue}_02_${side}`,`${full}${vrm}Intermediate`],[`${ue}_03_${side}`,`${full}${vrm}Distal`],
    ])),
  });
}
Object.assign(MIXAMO_TO_VRM,{pelvis:'hips',spine_01:'spine',spine_02:'chest',spine_03:'upperChest',neck_01:'neck',Head:'head'});

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

/**
 * Keep only the tracks that drive `bones`, so two clips can be cut at the waist and
 * sewn together. Track names are node names on THIS avatar's rig, so the map back to
 * humanoid bones has to be built per avatar.
 */
function filterToBones(clip:THREE.AnimationClip,bones:Set<string>,nodeToBone:Map<string,string>){
  const tracks=clip.tracks.filter(track=>{
    const node=track.name.slice(0,track.name.lastIndexOf('.'));
    const bone=nodeToBone.get(node);
    return !!bone&&bones.has(bone);
  }).map(track=>track.clone());
  return new THREE.AnimationClip(`${clip.name}_part`,clip.duration,tracks);
}
/**
 * Repeat a clip's keys until it fills `duration`.
 *
 * Without this the shorter half of a blend freezes on its last frame and then snaps
 * when the merged clip loops — a visible hitch every stride while holding the trigger.
 */
function tileClip(clip:THREE.AnimationClip,duration:number){
  if(clip.duration<=1e-3||clip.duration>=duration-1e-3)return clip;
  const repeats=Math.ceil(duration/clip.duration);
  const tracks=clip.tracks.map(track=>{
    const stride=track.getValueSize(),times:number[]=[],values:number[]=[];
    for(let repeat=0;repeat<repeats;repeat++){
      const offset=repeat*clip.duration;
      for(let i=0;i<track.times.length;i++){
        const at=track.times[i]+offset;
        if(at>duration+1e-4)break;
        if(repeat>0&&i===0)continue;   // drop the duplicated seam key
        times.push(at);
        for(let v=0;v<stride;v++)values.push(track.values[i*stride+v]);
      }
    }
    return new (track.constructor as new(name:string,times:number[],values:number[])=>THREE.KeyframeTrack)(track.name,times,values);
  });
  return new THREE.AnimationClip(`${clip.name}_tiled`,duration,tracks);
}

/** Which two clips each blend is cut from, and which half each one contributes. */
export const BLEND_PARTS:Record<Blend,{upper:keyof typeof CLIPS;lower:keyof typeof CLIPS;bones:Set<string>}>={
  // The gun is held in the same pose whether standing or moving, so the legs come
  // from the locomotion clip and everything above the hips from the gun pose.
  gunWalk:{upper:'gunShootWalk',lower:'walk',bones:UPPER},
  // Sprinting keeps the left arm on the run cycle: it is not holding anything.
  gunRun:{upper:'gunShootWalk',lower:'run',bones:UPPER_NO_LEFT_ARM},
  jumpRun:{upper:'jump',lower:'run',bones:UPPER},
};

/** One shared loader set, and one download per clip however many avatars are wearing it. */
const gltf=new GLTFLoader();gltf.register(parser=>new VRMLoaderPlugin(parser));
const fbx=new FBXLoader();
type Downloaded=keyof typeof CLIPS;
const clipCache=new Map<Downloaded,Promise<{clip:THREE.AnimationClip;scene:THREE.Object3D}>>();
function sourceClip(slot:Downloaded){
  let pending=clipCache.get(slot);
  if(!pending){
    const file=CLIPS[slot].file;
    // Clips ship as Mixamo FBX or as glTF; the retargeter only cares about bone names.
    pending=(/\.glb$/i.test(file)
      ? gltf.loadAsync(animationURL(file)).then(asset=>({animations:asset.animations,scene:asset.scene as THREE.Object3D}))
      : fbx.loadAsync(animationURL(file)).then(scene=>({animations:scene.animations,scene:scene as THREE.Object3D}))
    ).then(({animations,scene})=>{
      const clip=animations[0];
      if(!clip)throw new Error(`${file} carries no animation`);
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

    // Track names are node names on this particular rig, so the way back to humanoid
    // bones has to be built per avatar — the blends are cut along it.
    for(const bone of VRM_BONES){
      const node=vrm.humanoid.getNormalizedBoneNode(bone as never);
      if(node)this.nodeToBone.set(node.name,bone);
    }
    // Idle first so the avatar is never a T-pose on screen; the rest, and the blends
    // cut from them, follow in the background.
    await this.slot('idle');
    this.play('hom_loco_idle_rest');
    void (async()=>{
      const slots=(Object.keys(CLIPS) as Downloaded[]).filter(slot=>slot!=='idle');
      await Promise.all(slots.map(slot=>this.slot(slot).catch(error=>console.warn(`${slot} unavailable`,error))));
      // Blends need both halves retargeted first, so they are built once those land.
      await Promise.all((Object.keys(BLEND_PARTS) as Blend[]).map(blend=>this.slot(blend).catch(error=>console.warn(`${blend} unavailable`,error))));
    })();
    return this;
  }

  /** Every clip retargeted onto THIS rig, kept so blends can be cut from them later. */
  private clips=new Map<Downloaded,THREE.AnimationClip>();
  /** This avatar's node names, mapped back to humanoid bones — what a blend is cut along. */
  private nodeToBone=new Map<string,string>();

  private async retargeted(slot:Downloaded){
    const existing=this.clips.get(slot);
    if(existing)return existing;
    const {clip,scene}=await sourceClip(slot);
    if(!this.vrm)throw new Error('avatar disposed while loading');
    const retargeted=retargetMixamoClip(clip,scene,this.vrm);
    if(!retargeted.tracks.length)throw new Error(`${CLIPS[slot].file} retargeted to nothing`);
    this.clips.set(slot,retargeted);
    return retargeted;
  }

  private async slot(slot:Slot){
    if(this.actions.has(slot))return this.actions.get(slot)!;
    if(!this.vrm||!this.mixer)throw new Error('avatar disposed while loading');
    let clip:THREE.AnimationClip;
    if(slot in BLEND_PARTS){
      const {upper,lower,bones}=BLEND_PARTS[slot as Blend];
      const [top,bottom]=await Promise.all([this.retargeted(upper),this.retargeted(lower)]);
      // Loop at the LOCOMOTION length so the legs step exactly as they normally do;
      // the upper half is tiled up to fill it.
      const legs=filterToBones(bottom,LOWER,this.nodeToBone);
      const body=tileClip(filterToBones(top,bones,this.nodeToBone),legs.duration);
      if(!legs.tracks.length||!body.tracks.length)throw new Error(`${slot} has nothing to blend`);
      clip=new THREE.AnimationClip(slot,legs.duration,[...body.tracks.map(t=>t.clone()),...legs.tracks.map(t=>t.clone())]);
    }else clip=await this.retargeted(slot as Downloaded);
    if(!this.mixer)throw new Error('avatar disposed while loading');
    const action=this.mixer.clipAction(clip);
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

  /** The bone a weapon hangs from: the RAW node, so it follows the skinned rig. */
  hand(){return this.vrm?.humanoid.getRawBoneNode('rightHand')??undefined;}
  /** A VRM holds the gun through its own clips, so there is no pose to write here. */
  holdPose(_active:boolean){}

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
    this.vrm=undefined;this.mixer=undefined;this.actions.clear();this.clips.clear();this.nodeToBone.clear();
  }
}
