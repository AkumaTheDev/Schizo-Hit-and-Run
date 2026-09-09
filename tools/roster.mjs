/**
 * Measure the roster without a browser.
 *
 * The fighter numbers in `src/fighters.ts` are read off the models themselves, so this
 * is where they come from: every shipped VRM is loaded through the same loaders the
 * game uses, stood in its own rest pose, and measured. Print the table, paste the rows
 * into BUILDS, and a new model is a new fighter.
 *
 * RUN  node --import tsx tools/roster.mjs
 */
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
globalThis.ProgressEvent=class{constructor(type,detail={}){Object.assign(this,detail);this.type=type;}};
globalThis.self={URL:{createObjectURL:()=>'data:application/octet-stream;base64,AA==',revokeObjectURL(){}}};
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { VRM_MODELS, characterURL } from '../src/vrm-avatar.ts';
import { fighterFrom, fighterLine } from '../src/fighters.ts';

const gltf=new GLTFLoader();gltf.register(parser=>new VRMLoaderPlugin(parser));
const pad=(text,width)=>String(text).padEnd(width);

for(const file of VRM_MODELS){
  const bytes=await (await fetch(characterURL(file))).arrayBuffer();
  const asset=await new Promise((ok,no)=>gltf.parse(bytes,'',ok,no));
  const vrm=asset.userData.vrm;
  if(vrm.meta?.metaVersion!=='1')VRMUtils.rotateVRM0(vrm);
  const root=new THREE.Group();root.add(vrm.scene);
  // The rest pose, explicitly: a model left in whatever pose it loaded in measures wrong.
  vrm.humanoid.resetNormalizedPose();vrm.humanoid.update();root.updateMatrixWorld(true);
  const size=new THREE.Box3().setFromObject(vrm.scene).getSize(new THREE.Vector3());
  const at=bone=>vrm.humanoid.getNormalizedBoneNode(bone)?.getWorldPosition(new THREE.Vector3());
  const hips=at('hips'),foot=at('leftFoot');
  const build={height:+size.y.toFixed(3),leg:+((hips&&foot?hips.y-foot.y:0)).toFixed(3),
    // The box is measured in a T-pose, so it is arm span by height by depth: a crude
    // stand-in for mass, but the same crude one for everybody.
    bulk:+(size.x*size.y*size.z).toFixed(3)};
  const fighter=fighterFrom(file,file.replace(/\.vrm$/i,''),build);
  console.log(`${pad(`'${file}':`,24)}{height:${build.height},leg:${build.leg},bulk:${build.bulk}},`);
  console.log(`${pad('',24)}// ${fighterLine(fighter)} · speed ${fighter.speed.toFixed(2)} · gravity ${fighter.gravity.toFixed(2)} · jump ${fighter.jump.toFixed(2)}`);
}
