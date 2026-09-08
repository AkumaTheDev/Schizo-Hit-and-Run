import * as THREE from 'three';
import { assetURL,json, type Assets } from './assets';
import { GUN_FALLBACK } from './vrm-avatar';
interface CharacterData {placement?:number[];bones:{name:string;parent:number;matrix:number[]}[];primitives:{shader:string;attributes:Record<string,[number,number]>}[];materials:Record<string,{textureUrl:string}>;animations:{name:string;duration:number;tracks:{bone:string;kind:string;times:number[];values:number[]}[]}[]}
export class Character {
  group=new THREE.Group();private mixer=new THREE.AnimationMixer(this.group);private actions=new Map<string,THREE.AnimationAction>();private active='';
  /** The clip currently playing — networked so remote avatars mirror the local animation choice. */
  get playing(){return this.active;}
  private bones:THREE.Bone[]=[];private skeleton!:THREE.Skeleton;
  private meshes:THREE.SkinnedMesh[]=[];
  async load(assets:Assets,asset="homer"){
    const [data,response]=await Promise.all([json<CharacterData>(`${asset}.json`),fetch(assetURL(`${asset}.bin`))]);
    if(!response.ok)throw new Error('Homer geometry is missing');const binary=await response.arrayBuffer();
    this.bones=data.bones.map(source=>{const bone=new THREE.Bone();bone.name=source.name;bone.applyMatrix4(new THREE.Matrix4().fromArray(source.matrix));return bone;});
    data.bones.forEach((source,i)=>{if(i===0)this.group.add(this.bones[i]);else this.bones[source.parent].add(this.bones[i]);});
    this.group.updateMatrixWorld(true);this.skeleton=new THREE.Skeleton(this.bones);
    for(const primitive of data.primitives){
      const source=data.materials[primitive.shader];if(!source?.textureUrl)throw new Error(`Missing character texture: ${asset}/${primitive.shader}`);
      const textureKey=`character:${source.textureUrl}`;let texture=assets.textures.get(textureKey);
      if(!texture){texture=await assets.texture(source.textureUrl,t=>{t.colorSpace=THREE.SRGBColorSpace;t.flipY=true;t.wrapS=t.wrapT=THREE.RepeatWrapping;},textureKey);}
      const geometry=new THREE.BufferGeometry();
      for(const [name,[offset,length]] of Object.entries(primitive.attributes)){
        if(name==='indices')geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(binary,offset,length),1));
        else geometry.setAttribute(name,new THREE.BufferAttribute(new Float32Array(binary,offset,length),name==='uv'?2:name.startsWith('skin')?4:3));
      }
      const material=new THREE.MeshLambertMaterial({map:texture,side:THREE.DoubleSide});assets.materials.set(`${asset}-${primitive.shader}-${material.uuid}`,material);assets.geometries.add(geometry);
      const mesh=new THREE.SkinnedMesh(geometry,material);mesh.name=`homer-${primitive.shader}`;mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;
      this.group.add(mesh);mesh.bind(this.skeleton);mesh.normalizeSkinWeights();this.meshes.push(mesh);
    }
    for(const source of data.animations){
      const tracks=source.tracks.map(track=>track.kind==='quaternion'?new THREE.QuaternionKeyframeTrack(`${track.bone}.quaternion`,track.times,track.values):new THREE.VectorKeyframeTrack(`${track.bone}.position`,track.times,track.values));
      const clip=new THREE.AnimationClip(source.name,source.duration,tracks);const action=this.mixer.clipAction(clip);this.actions.set(source.name,action);if(asset!=='menu-homer')this.actions.set(source.name.replace(/^[^_]+_/,'hom_'),action);
    }
    if(data.placement)this.group.applyMatrix4(new THREE.Matrix4().fromArray(data.placement));
    this.play(asset==='menu-homer'?'PTRN_Motion_Root':'hom_loco_idle_rest');
  }
  duration(name:string){return this.actions.get(name)?.getClip().duration??0;}
  play(name:string,once=false){
    if(name===this.active)return;
    // The conversion made no firing clips, so a gun state falls back to the locomotion
    // it stands on and the arms are posed by `holdPose`. Anything still unknown leaves
    // the body animating rather than fading it out into a frozen pose — asking for a
    // clip that does not exist is what stopped the cast dead while carrying the rifle.
    const next=this.actions.get(name)??this.actions.get(GUN_FALLBACK[name]??'');
    if(!next){this.active=name;return;}
    const current=this.actions.get(this.active);
    if(current&&current!==next)current.fadeOut(.15);
    next.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);
    next.clampWhenFinished=once;
    if(current!==next)next.reset().fadeIn(.15).play();
    this.active=name;
  }
  /** The cast's head bone sits at 1.33 m in the converted rest pose — measured, not guessed. */
  height(){return this.bones.find(bone=>bone.name==='Head')?.getWorldPosition(new THREE.Vector3()).y??1.33;}
  /** The bone a weapon hangs from. The converted rig names the right wrist `Wrist_R`. */
  hand(){return this.bones.find(bone=>bone.name==='Wrist_R');}
  /**
   * Hold a long gun.
   *
   * The cartoon rig has no firing clips — the conversion never produced any — so the
   * arms are posed straight onto the bones after the mixer runs, the way the seated
   * pose works. The angles put the right hand on the grip and the left out on the
   * magwell, which is the same two-hand carry the sibling project's rifle uses.
   */
  holdPose(active:boolean){this.holding=active;}
  private holding=false;
  private applyHold(){
    if(!this.holding)return;
    const bone=(name:string)=>this.bones.find(b=>b.name===name);
    const set=(name:string,x:number,y:number,z:number)=>{const b=bone(name);if(b)b.rotation.set(x,y,z);};
    set('Shoulder_R',-0.55,0.15,-0.35);set('Elbow_R',-1.15,0.2,0);
    set('Shoulder_L',-0.75,-0.5,0.3);set('Elbow_L',-1.35,-0.15,0);
  }

  drive(car:THREE.Group){
    car.add(this.group);this.group.position.set(-0.48,-0.32,-0.15);this.group.rotation.set(0,Math.PI,0);this.group.scale.setScalar(1);
    this.play('hom_in_car_idle');
  }
  walk(scene:THREE.Scene,position:THREE.Vector3,heading:number){scene.add(this.group);this.group.position.copy(position);this.group.rotation.set(0,heading,0);this.play('hom_loco_idle_rest');}
  update(dt:number){this.mixer.update(dt);this.applyHold();}
  dispose(){this.mixer.stopAllAction();this.mixer.uncacheRoot(this.group);this.group.removeFromParent();this.skeleton?.dispose();}
}
