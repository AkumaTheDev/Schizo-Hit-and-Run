import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { VRMLoaderPlugin,VRMUtils,type VRM } from '@pixiv/three-vrm';
import { json } from './assets';

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
} as const;
type Slot=keyof typeof CLIPS|Blend;
/**
 * Clips this game builds for itself by splitting two others at the waist, because no
 * single recording covers them: the jump's upper body over a running stride.
 */
type Blend='jumpRun';
const BLEND_NAMES:Record<Blend,string[]>={
  jumpRun:['hom_jump_run'],
};
const SLOT_FOR=new Map<string,Slot>();
for(const [slot,clip] of Object.entries(CLIPS))for(const name of clip.names)SLOT_FOR.set(name,slot as Slot);
for(const [blend,names] of Object.entries(BLEND_NAMES))for(const name of names)SLOT_FOR.set(name,blend as Slot);

/** The humanoid bones, and the split the blends are cut along. */
export const VRM_BONES=['hips','spine','chest','upperChest','neck','head','leftShoulder','leftUpperArm','leftLowerArm','leftHand','rightShoulder','rightUpperArm','rightLowerArm','rightHand','leftUpperLeg','leftLowerLeg','leftFoot','leftToes','rightUpperLeg','rightLowerLeg','rightFoot','rightToes','leftEye','rightEye','jaw'];
/** Everything the legs do: the half a locomotion clip keeps in a blend. */
export const LOWER=new Set(['hips','leftUpperLeg','leftLowerLeg','leftFoot','leftToes','rightUpperLeg','rightLowerLeg','rightFoot','rightToes']);
const UPPER=new Set(VRM_BONES.filter(bone=>!LOWER.has(bone)));

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
 * The GAME'S own rig, mapped onto the humanoid.
 *
 * The converted PS2 character carries 23 clips — everything the game actually plays,
 * from the walk and run to the jump chain, the kick and the seated idle — and no rig
 * has a better claim to being this game's animation. There is no clavicle in it: the
 * chain is Spine_2 → Shoulder → Elbow → Wrist, so `Shoulder_L` IS the upper arm.
 * `Motion_Root`, `Balance_Root`, `Character_Root` and `Ass_Joint` are trajectory and
 * helper nodes with no humanoid equivalent, and are skipped the same way UE's `root` is.
 */
const GAME_TO_VRM:Record<string,string>={
  Pelvis:'hips',Spine_1:'spine',Spine_2:'chest',Neck:'neck',Head:'head',Jaw:'jaw',
  Shoulder_L:'leftUpperArm',Elbow_L:'leftLowerArm',Wrist_L:'leftHand',
  Shoulder_R:'rightUpperArm',Elbow_R:'rightLowerArm',Wrist_R:'rightHand',
  Hip_L:'leftUpperLeg',Knee_L:'leftLowerLeg',Ankle_L:'leftFoot',Ball_L:'leftToes',
  Hip_R:'rightUpperLeg',Knee_R:'rightLowerLeg',Ankle_R:'rightFoot',Ball_R:'rightToes',
  Middle_Base_L:'leftMiddleProximal',Middle_L:'leftMiddleIntermediate',
  Thumb_Base_L:'leftThumbProximal',Thumb_L:'leftThumbDistal',
  Middle_Base_R:'rightMiddleProximal',Middle_R:'rightMiddleIntermediate',
  Thumb_Base_R:'rightThumbProximal',Thumb_R:'rightThumbDistal',
};

/** Where a VRM's motion comes from. The game's own set is the default. */
export type AnimationSource='game'|'mixamo'|'all';

interface RigData {bones:{name:string;parent:number;matrix:number[]}[];animations:{name:string;duration:number;tracks:{bone:string;kind:string;times:number[];values:number[]}[]}[]}
const rigCache=new Map<string,Promise<{scene:THREE.Object3D;clips:Map<string,THREE.AnimationClip>}>>();
/**
 * Rebuild one of the game's characters as a bare skeleton plus its clips.
 *
 * The retargeter needs the source rig's REST POSE to divide out — the same thing the
 * FBX scene provides for a Mixamo clip — so the bones are assembled from the converted
 * matrices exactly as the game's own character does it, and nothing else is loaded.
 */
function gameRig(asset:string){
  let pending=rigCache.get(asset);
  if(!pending){
    pending=(async()=>{
      const data=await json<RigData>(`${asset}.json`);
      const bones=data.bones.map(source=>{
        const bone=new THREE.Bone();bone.name=source.name;
        bone.applyMatrix4(new THREE.Matrix4().fromArray(source.matrix));
        return bone;
      });
      const scene=new THREE.Group();
      data.bones.forEach((source,i)=>{if(i===0)scene.add(bones[i]);else bones[source.parent].add(bones[i]);});
      scene.updateMatrixWorld(true);
      const clips=new Map<string,THREE.AnimationClip>();
      for(const source of data.animations){
        const tracks=source.tracks.map(track=>track.kind==='quaternion'
          ? new THREE.QuaternionKeyframeTrack(`${track.bone}.quaternion`,track.times,track.values)
          : new THREE.VectorKeyframeTrack(`${track.bone}.position`,track.times,track.values));
        const clip=new THREE.AnimationClip(source.name,source.duration,tracks);
        clips.set(source.name,clip);
        // The cast share one vocabulary: bart's `bar_loco_walk` answers to `hom_loco_walk`
        // too, which is the name the game asks every body for.
        clips.set(source.name.replace(/^[^_]+_/,'hom_'),clip);
      }
      return {scene,clips};
    })();
    rigCache.set(asset,pending);
  }
  return pending;
}

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
Object.assign(MIXAMO_TO_VRM,GAME_TO_VRM);

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
  let motionHipsHeight:number;
  const mixamoHips=fbx.getObjectByName('mixamorigHips');
  if(mixamoHips){
    // Mixamo hangs the hips straight off an identity root, so the local offset IS the
    // height. Guard the degenerate export: hips at y=0 would make the scale infinite.
    motionHipsHeight=Math.max(Math.abs(mixamoHips.position.y),1);
  }else{
    // Any other rig, found by whichever name it uses for the hips. Here the local offset
    // is NOT the height — this game's Pelvis hangs off three nested root nodes, and an
    // Unreal pelvis sits 0.05 from an already-rotated parent while standing 0.92 m off
    // the floor. Measure the real world height instead, then divide out the accumulated
    // parent scale to land back in the units the tracks are written in.
    let sourceHips:THREE.Object3D|undefined;
    for(const [name,bone] of Object.entries(MIXAMO_TO_VRM)){
      if(bone!=='hips'||name==='mixamorigHips')continue;
      sourceHips=fbx.getObjectByName(name)??undefined;
      if(sourceHips)break;
    }
    if(sourceHips){
      fbx.updateMatrixWorld(true);
      const world=sourceHips.getWorldPosition(new THREE.Vector3());
      const parentScale=sourceHips.parent?sourceHips.parent.getWorldScale(new THREE.Vector3()):new THREE.Vector3(1,1,1);
      const scale=Math.abs(parentScale.y)>1e-6?Math.abs(parentScale.y):1;
      motionHipsHeight=Math.max(Math.abs(world.y)/scale,0.01);
    }else motionHipsHeight=100;   // nothing to measure — the legacy fallback
  }
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
  jumpRun:{upper:'jump',lower:'run',bones:UPPER},
};

/**
 * Put the retargeted feet back where the source rig's feet are.
 *
 * Retargeting preserves each bone's rotation relative to its own rest pose, which is
 * faithful and still lands the foot at a different ANGLE TO THE WORLD when the two
 * skeletons' legs are built differently — measurably 19° flatter on one avatar and 25°
 * on another through the whole run cycle, which reads as running on your heels.
 *
 * So each foot key is corrected by the error at that key: play both rigs at that time,
 * measure the angle of the ankle→toe line in each, and rotate the foot about its own
 * pitch axis by the difference. Three passes because the correction moves the toes it
 * is measured from; it converges to zero.
 */
export function alignFeet(clip:THREE.AnimationClip,source:THREE.AnimationClip,rig:THREE.Object3D,vrm:VRM){
  const forward=new THREE.Vector3(0,0,1),a=new THREE.Vector3(),b=new THREE.Vector3();
  // Signed against the rig's own forward, so a foot pointing straight down does not fold
  // the way atan2(dy, |horizontal|) does.
  const sole=(ankle:THREE.Object3D,toe:THREE.Object3D)=>{
    const delta=toe.getWorldPosition(b).sub(ankle.getWorldPosition(a));
    return Math.atan2(delta.y,delta.dot(forward));
  };
  const sides=([['leftFoot','leftToes','Ankle_L','Ball_L'],['rightFoot','rightToes','Ankle_R','Ball_R']] as const).flatMap(([foot,toes,sourceAnkle,sourceBall])=>{
    const node=vrm.humanoid.getNormalizedBoneNode(foot),raw=vrm.humanoid.getRawBoneNode(foot);
    const rawToes=vrm.humanoid.getRawBoneNode(toes);
    const ankle=rig.getObjectByName(sourceAnkle),ball=rig.getObjectByName(sourceBall);
    const track=node&&clip.tracks.find(t=>t.name===`${node.name}.quaternion`) as THREE.QuaternionKeyframeTrack|undefined;
    return raw&&rawToes&&ankle&&ball&&track?[{raw,rawToes,ankle,ball,track}]:[];
  });
  if(!sides.length)return clip;
  const rigMixer=new THREE.AnimationMixer(rig);rigMixer.clipAction(source).play();
  const vrmMixer=new THREE.AnimationMixer(vrm.scene);
  const pitch=new THREE.Quaternion(),key=new THREE.Quaternion(),X=new THREE.Vector3(1,0,0);
  for(let pass=0;pass<3;pass++){
    vrmMixer.stopAllAction();vrmMixer.uncacheClip(clip);vrmMixer.clipAction(clip).play();
    for(const side of sides){
      for(let i=0;i<side.track.times.length;i++){
        const time=side.track.times[i];
        rigMixer.setTime(time);rig.updateMatrixWorld(true);
        vrmMixer.setTime(time);vrm.humanoid.update();vrm.scene.updateMatrixWorld(true);
        const error=sole(side.ankle,side.ball)-sole(side.raw,side.rawToes);
        if(!Number.isFinite(error))continue;
        key.set(side.track.values[i*4],side.track.values[i*4+1],side.track.values[i*4+2],side.track.values[i*4+3]);
        key.multiply(pitch.setFromAxisAngle(X,error));
        side.track.values[i*4]=key.x;side.track.values[i*4+1]=key.y;side.track.values[i*4+2]=key.z;side.track.values[i*4+3]=key.w;
      }
    }
  }
  rigMixer.stopAllAction();vrmMixer.stopAllAction();
  // Hand the rig back AT REST. Measuring a pose it was left in is how the grounding
  // below first read a mid-stride foot as the standing one.
  vrm.humanoid.resetNormalizedPose();vrm.humanoid.update();
  return clip;
}

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

/**
 * What a Mixamo-only state falls back to when the cast's own set is the only one
 * loaded — those clips have no equivalent in the conversion, so they stand on the
 * locomotion underneath them rather than leaving the body with nothing to play.
 */
const CAST_FALLBACK:Record<string,string>={
  hom_jump_run:'hom_loco_run',
};

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
  /** Keyed by the NAME the game asks for, whichever set the clip behind it came from. */
  private actions=new Map<string,THREE.AnimationAction>();
  private active='';
  private seated=false;
  /** This avatar's hip height in metres, measured from its own rest pose — see `drive`. */
  private hipsHeight=0.618;

  get playing(){return this.active;}
  get loaded(){return !!this.vrm;}

  /** Where this avatar's motion comes from, and which of the cast's clips to use. */
  private source:AnimationSource='game';
  private cast='homer';

  /**
   * Wear an avatar.
   *
   * `url` is for a file the player chose on this device only. A NAME goes through the
   * shared host, which is what keeps a peer's chosen skin from becoming an arbitrary
   * URL this browser then fetches.
   */
  async load(file=DEFAULT_VRM,options:{animations?:AnimationSource;cast?:string;url?:string}={}){
    this.source=options.animations??'game';
    this.cast=options.cast??'homer';
    // Only ever a filename on the shared host: a peer names its own avatar, and that
    // name must never be able to become an arbitrary URL this browser then fetches.
    const url=options.url??characterURL(file.split(/[\\/]/).pop()||DEFAULT_VRM);
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
    const origin=this.group.getWorldPosition(new THREE.Vector3()).y;
    const hips=vrm.humanoid.getNormalizedBoneNode('hips');
    if(hips)this.hipsHeight=Math.abs(hips.getWorldPosition(new THREE.Vector3()).y-origin);

    this.mixer=new THREE.AnimationMixer(vrm.scene);

    // Track names are node names on this particular rig, so the way back to humanoid
    // bones has to be built per avatar — the blends are cut along it.
    for(const bone of VRM_BONES){
      const node=vrm.humanoid.getNormalizedBoneNode(bone as never);
      if(node)this.nodeToBone.set(node.name,bone);
    }
    // The game's own clips arrive in one fetch, so in game mode the avatar is animated
    // by the time it is on screen rather than after a round of downloads.
    if(this.source!=='mixamo')await this.loadGameClips();
    await this.ensure('hom_loco_idle_rest').catch(()=>{});
    this.play('hom_loco_idle_rest');
    this.ground();
    // Whatever else the mode allows follows in the background: the Mixamo set, and the
    // blends cut from it. Nothing here is waited on.
    if(this.source!=='game')void (async()=>{
      const slots=(Object.keys(CLIPS) as Downloaded[]).filter(slot=>slot!=='idle');
      await Promise.all(slots.map(slot=>this.mixamoAction(slot).catch(error=>console.warn(`${slot} unavailable`,error))));
      await Promise.all((Object.keys(BLEND_PARTS) as Blend[]).map(blend=>this.mixamoAction(blend).catch(error=>console.warn(`${blend} unavailable`,error))));
    })();
    return this;
  }

  /** Every clip retargeted onto THIS rig, kept so blends can be cut from them later. */
  private clips=new Map<Downloaded,THREE.AnimationClip>();
  /** This avatar's node names, mapped back to humanoid bones — what a blend is cut along. */
  private nodeToBone=new Map<string,string>();

  /** Every one of the cast's clips, retargeted onto this humanoid and ready to play. */
  private async loadGameClips(){
    if(!this.vrm||!this.mixer)return;
    const {scene,clips}=await gameRig(this.cast);
    if(!this.vrm||!this.mixer)return;
    const aligned=new Map<THREE.AnimationClip,THREE.AnimationClip>();
    for(const [name,clip] of clips){
      if(this.actions.has(name))continue;
      // The cast share clips under two names, so each is retargeted and aligned once.
      let retargeted=aligned.get(clip);
      if(!retargeted){
        retargeted=alignFeet(retargetMixamoClip(clip,scene,this.vrm),clip,scene,this.vrm);
        aligned.set(clip,retargeted);
      }
      if(!retargeted.tracks.length)continue;
      const action=this.mixer.clipAction(retargeted);
      action.setLoop(THREE.LoopRepeat,Infinity);
      this.actions.set(name,action);
    }
  }

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

  private async mixamoAction(slot:Slot){
    const names=slot in BLEND_PARTS?BLEND_NAMES[slot as Blend]:[...CLIPS[slot as Downloaded].names];
    const ready=names.map(name=>this.actions.get(name)).find(Boolean);
    if(ready)return ready;
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
    // A Mixamo clip answers to every game name it stands in for, so `play` finds it
    // under the name the game actually asks for.
    for(const name of names)if(!this.actions.has(name))this.actions.set(name,action);
    // A clip that arrives after the state it answers to was asked for still needs to start.
    if(names.includes(this.active)&&!this.seated)action.reset().fadeIn(.15).play();
    return action;
  }

  /**
   * Find the action for a name under the current source.
   *
   * The game's own clips answer first — they are this game's animation, and the cast
   * and the VRMs then move alike. Mixamo covers what the conversion never had (the
   * backflip) and, on its own setting, everything.
   */
  private async ensure(name:string){
    const existing=this.actions.get(name);
    if(existing)return existing;
    if(this.source!=='mixamo'){
      await this.loadGameClips();
      const fromGame=this.actions.get(name);
      if(fromGame)return fromGame;
    }
    if(this.source==='game'){
      const fallback=CAST_FALLBACK[name];
      const stand=fallback?this.actions.get(fallback):undefined;
      // Share the locomotion action under the missing clip's name.
      if(stand){this.actions.set(name,stand);return stand;}
      throw new Error(`${name} is not in the cast's animation set`);
    }
    const slot=SLOT_FOR.get(name);
    if(!slot)throw new Error(`${name} has no clip`);
    return this.mixamoAction(slot);
  }

  /**
   * Stand the avatar on the floor.
   *
   * A retargeted clip does not put the feet where the source put them: the same joint
   * angles on different leg proportions leave the body riding higher. Measured on the
   * standing clip, that is ~5 cm of hover on both avatars tested — which is the float.
   * The cast's own rig has none of this (its feet reach the floor as authored), so the
   * correction belongs HERE, on the VRM inside its own group, and never on the shared
   * placement the game does for every body.
   */
  private ground(){
    const vrm=this.vrm,idle=this.actions.get('hom_loco_idle_rest');
    if(!vrm||!this.mixer)return;
    const feet=['leftToes','rightToes','leftFoot','rightFoot']
      .map(bone=>vrm.humanoid.getRawBoneNode(bone as never)).filter(Boolean) as THREE.Object3D[];
    if(!feet.length)return;
    const lowest=()=>{vrm.scene.updateMatrixWorld(true);
      return Math.min(...feet.map(node=>node.getWorldPosition(new THREE.Vector3()).y));};
    vrm.scene.position.y=0;
    // The rest pose, explicitly — not whatever pose the rig happens to be left in.
    vrm.humanoid.resetNormalizedPose();vrm.humanoid.update();
    const rest=lowest();
    if(!idle){this.footOffset=0;return;}
    // Sample the standing clip: the foot that stays down is the one to stand on.
    let standing=Infinity;
    const previous=this.mixer.time;
    for(let i=0;i<=12;i++){
      this.mixer.setTime(idle.getClip().duration*i/12);vrm.humanoid.update();
      standing=Math.min(standing,lowest());
    }
    this.mixer.setTime(previous);vrm.humanoid.update();
    this.footOffset=Number.isFinite(standing)?rest-standing:0;
    vrm.scene.position.y=this.footOffset;
  }
  private footOffset=0;

  duration(name:string){return this.actions.get(name)?.getClip().duration??0;}

  play(name:string,once=false){
    if(name===this.active)return;
    const from=this.actions.get(this.active),to=this.actions.get(name)??this.actions.get(CAST_FALLBACK[name]??'');
    this.active=name;
    if(!to){
      // Nothing to play yet. Leave whatever is running alone rather than fading the body
      // into a frozen pose, and start the clip for next time.
      void this.ensure(name).catch(()=>{});
      return;
    }
    // Two names sharing one clip (a stand-in) must not fade themselves out.
    if(from&&from!==to)from.fadeOut(.15);
    to.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);
    to.clampWhenFinished=once;
    if(from!==to)to.reset().fadeIn(.15).play();
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
    this.vrm=undefined;this.mixer=undefined;this.actions.clear();this.clips.clear();this.nodeToBone.clear();
  }
}
