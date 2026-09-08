/**
 * Look at a VRM avatar without a browser.
 *
 * There is no GPU or DOM on the build box, so this parses a real avatar and the real
 * clips through the SAME loaders and the same `retargetMixamoClip` the game ships, then
 * MEASURES the result: which way the rig faces (its toes must point +Z, the direction a
 * heading of 0 walks in), how tall it stands, that EVERY clip retargets to tracks that
 * actually move a bone — an unmapped rig retargets to nothing and plays as a silent
 * no-op, which is what a missing animation looks like in game — and that each blend
 * really does carry both halves of the body.
 *
 * RUN  node --import tsx tools/vrm_check.mjs [avatar.vrm]
 */
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
globalThis.self={URL:{createObjectURL:()=>'data:application/octet-stream;base64,AA==',revokeObjectURL(){}}};
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { retargetMixamoClip, CLIPS, BLEND_PARTS, LOWER, VRM_BONES } from '../src/vrm-avatar.ts';

const HOST='https://axeassets.schizod.io/assets';
const grab=async u=>new Uint8Array(await (await fetch(u)).arrayBuffer()).buffer;
const gltf=new GLTFLoader();gltf.register(p=>new VRMLoaderPlugin(p));
const fbx=new FBXLoader();

const file=process.argv[2]??'SchizoAxe.vrm';
const vrmBytes=await grab(`${HOST}/characters/${file}`);
const asset=await new Promise((ok,no)=>gltf.parse(vrmBytes,'',ok,no));
const vrm=asset.userData.vrm;
console.log(`${file} · VRM ${vrm.meta?.metaVersion}`);
if(vrm.meta?.metaVersion!=='1')VRMUtils.rotateVRM0(vrm);
const root=new THREE.Group();root.add(vrm.scene);root.updateMatrixWorld(true);
const bone=n=>vrm.humanoid.getNormalizedBoneNode(n);
const world=n=>bone(n)?.getWorldPosition(new THREE.Vector3());
const facing=world('leftToes').clone().sub(world('leftFoot')).setY(0).normalize();
console.log(`facing ${facing.toArray().map(v=>v.toFixed(2)).join(',')} → ${facing.z>0.7?'+Z (matches heading 0)':'WRONG WAY'} · head ${world('head').y.toFixed(2)}m · hips ${world('hips').y.toFixed(2)}m`);

const nodeToBone=new Map();
for(const b of VRM_BONES){const n=bone(b);if(n)nodeToBone.set(n.name,b);}
const mixer=new THREE.AnimationMixer(vrm.scene);
const clips={};
let failures=0;
for(const [slot,spec] of Object.entries(CLIPS)){
  try{
    const bytes=await grab(`${HOST}/animations/${encodeURIComponent(spec.file)}`);
    let source,scene;
    if(/\.glb$/i.test(spec.file)){
      const g=await new Promise((ok,no)=>gltf.parse(bytes,'',ok,no));
      source=g.animations[0];scene=g.scene;
    }else{scene=fbx.parse(bytes,'');source=scene.animations[0];}
    scene.updateMatrixWorld(true);
    const clip=retargetMixamoClip(source,scene,vrm);
    clips[slot]=clip;
    // A clip with tracks can still be a no-op. Measure the widest swing ANY bone makes
    // across the whole clip: a walk swings a knee through a radian, while a breathing
    // idle or a held rifle aim moves only a little — but never nothing at all.
    let range=0;
    for(const track of clip.tracks){
      if(!(track instanceof THREE.QuaternionKeyframeTrack))continue;
      const first=new THREE.Quaternion(track.values[0],track.values[1],track.values[2],track.values[3]);
      const other=new THREE.Quaternion();
      for(let i=4;i<track.values.length;i+=4){
        other.set(track.values[i],track.values[i+1],track.values[i+2],track.values[i+3]);
        range=Math.max(range,first.angleTo(other));
      }
    }
    const ok=clip.tracks.length>0&&range>0.02;
    if(!ok)failures++;
    console.log(`  ${ok?'ok  ':'FAIL'} ${slot.padEnd(13)} ${String(clip.tracks.length).padStart(3)} tracks · ${clip.duration.toFixed(2)}s · moves ${range.toFixed(2)} rad · ${spec.file}`);
  }catch(error){failures++;console.log(`  FAIL ${slot.padEnd(13)} ${error.message}`);}
}
for(const [blend,parts] of Object.entries(BLEND_PARTS)){
  const top=clips[parts.upper],bottom=clips[parts.lower];
  if(!top||!bottom){failures++;console.log(`  FAIL ${blend} (missing ${!top?parts.upper:parts.lower})`);continue;}
  const half=(clip,bones)=>clip.tracks.filter(t=>bones.has(nodeToBone.get(t.name.slice(0,t.name.lastIndexOf('.')))??'')).length;
  const legs=half(bottom,LOWER),body=half(top,parts.bones);
  const ok=legs>0&&body>0;
  if(!ok)failures++;
  console.log(`  ${ok?'ok  ':'FAIL'} ${blend.padEnd(13)} ${body} upper tracks from ${parts.upper} + ${legs} lower from ${parts.lower}`);
}
console.log(failures?`${failures} FAILED`:'all clips and blends retarget and move the rig');
process.exit(failures?1:0);
