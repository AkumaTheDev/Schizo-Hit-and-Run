/**
 * Look at a VRM avatar without a browser.
 *
 * There is no GPU or DOM on the build box, so this parses a real avatar and a real
 * Mixamo clip through the SAME loaders and the same `retargetMixamoClip` the game
 * ships, then MEASURES the result: which way the rig faces (its toes must point +Z,
 * the direction a heading of 0 walks in), how tall it stands, and whether the clip
 * actually swings a knee rather than retargeting to a silent no-op.
 *
 * RUN  node --import tsx tools/vrm_check.mjs [avatar.vrm] [clip.fbx]
 */
// Node has no image decoder; the skeleton is all this check needs, so textures are
// short-circuited to a stub and every blob URL becomes a tiny data URL fetch can read.
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
globalThis.self={URL:{createObjectURL:()=>'data:application/octet-stream;base64,AA==',revokeObjectURL(){}}};
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { retargetMixamoClip } from '../src/vrm-avatar.ts';

const HOST='https://axeassets.schizod.io/assets';
const grab=async u=>new Uint8Array(await (await fetch(u)).arrayBuffer()).buffer;

const gltf=new GLTFLoader();gltf.register(p=>new VRMLoaderPlugin(p));
const vrmBytes=await grab(`${HOST}/characters/${process.argv[2]??'SchizoAxe.vrm'}`);
const asset=await new Promise((ok,no)=>gltf.parse(vrmBytes,'',ok,no));
const vrm=asset.userData.vrm;
console.log('VRM meta version:',JSON.stringify(vrm.meta?.metaVersion));
if(vrm.meta?.metaVersion!=='1')VRMUtils.rotateVRM0(vrm);

const root=new THREE.Group();root.add(vrm.scene);root.updateMatrixWorld(true);
const bone=n=>vrm.humanoid.getNormalizedBoneNode(n);
const world=n=>bone(n)?.getWorldPosition(new THREE.Vector3());
const foot=world('leftFoot'),toes=world('leftToes'),hips=world('hips'),head=world('head');
const facing=toes.clone().sub(foot).setY(0).normalize();
console.log('height hips/head:',hips.y.toFixed(2),head.y.toFixed(2));
console.log('facing (toes-foot):',facing.toArray().map(v=>v.toFixed(2)).join(','), '→', facing.z>0.7?'+Z (matches heading 0)':facing.z<-0.7?'-Z (BACKWARDS)':'sideways?');
console.log('left hand x:',world('leftHand').x.toFixed(2));

const fbx=new FBXLoader();
const fbxBytes=await grab(`${HOST}/animations/${process.argv[3]??'Walking.fbx'}`);
const clipScene=fbx.parse(fbxBytes,'');
clipScene.updateMatrixWorld(true);
const source=clipScene.animations[0];
console.log('source clip:',source.name,source.duration.toFixed(2)+'s',source.tracks.length,'tracks');
const clip=retargetMixamoClip(source,clipScene,vrm);
console.log('retargeted tracks:',clip.tracks.length);

const mixer=new THREE.AnimationMixer(vrm.scene);
mixer.clipAction(clip).play();
const knee=bone('leftLowerLeg'),samples=[];
for(const t of [0,.2,.4,.6]){mixer.setTime(t);vrm.humanoid.update();samples.push(knee.rotation.x);}
console.log('left knee x over the walk cycle:',samples.map(v=>v.toFixed(3)).join(' '));
const range=Math.max(...samples)-Math.min(...samples);
console.log(range>0.15?`PASS: the clip drives the rig (range ${range.toFixed(2)} rad)`:`FAIL: rig barely moves (range ${range.toFixed(3)})`);
