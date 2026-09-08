import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Assets, json, type Catalog, type LevelData,type SceneryMaterial } from './assets';
import { Terrain } from './physics';
import { Grass } from './grass';
import { staticCollisionGeometry,type InteriorCollision } from './collision';
import { WorldObjects,type WorldObjectsData } from './world-objects';
import type { RoadNavigation } from './road-data';
/**
 * Let the browser draw. A microtask is not enough — the frame has to be committed —
 * so this waits for the next animation frame and then for the task queue behind it.
 */
const paint=()=>new Promise<void>(resolve=>{
  if(typeof requestAnimationFrame!=='function'){resolve();return;}   // headless tests
  requestAnimationFrame(()=>setTimeout(resolve,0));
});

export const LEVEL_NAMES=['Evergreen Terrace','Downtown','Seaside','Evergreen at dusk','Downtown at dusk','Seaside at dusk','Halloween'];
export const CAR_NAMES:Record<string,string>={famil_v:'Family Sedan',plowk_v:'Plow King',homer_v:'The Homer',cletu_v:"Cletus' Pickup",cpolice:'Police Cruiser',pickupa:'Pickup Truck',minivana:'Minivan',schoolbu:'School Bus',sportsa:'Sports Car',snake_v:"Snake's Bandit",bart_v:'Honor Roller',lisa_v:'Malibu Stacy Car'};

export class World {
  assets:Assets;
  group=new THREE.Group();
  terrain!:Terrain;
  data!:LevelData;
  objects!:WorldObjects;objectData!:WorldObjectsData;
  private exteriorTerrain!:Terrain;private interiors=new Map<string,{root:THREE.Group;terrain:Terrain}>();private activeInterior:string|null=null;private lightingMode='golden';
  private sky=new Sky();private grass=new Grass();
  sun=new THREE.DirectionalLight(0xffd9a6,2.2);
  hemisphere=new THREE.HemisphereLight(0xb5dafa,0x8a6844,2.1);
  shadowGround:THREE.Mesh | null=null;
  constructor(public scene:THREE.Scene,catalog:Catalog){
    this.assets=new Assets(catalog);
    this.sky.scale.setScalar(45000);
    scene.add(this.sky,this.group,this.sun,this.sun.target,this.hemisphere);
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);
    Object.assign(this.sun.shadow.camera,{left:-35,right:35,top:35,bottom:-35,near:1,far:160});
    this.sun.shadow.bias=-0.0005;this.sun.shadow.normalBias=0.05;
    this.setLighting('golden');
  }
  async load(level:number,progress:(value:number,message:string)=>void){
    this.data=await json<LevelData>(`level${level}.json`);
    const [surfaces,scenery,ground,physics,objects,navigation]=await Promise.all([json<Record<string,SceneryMaterial>>('remaster/scenery-materials.json'),json<{scenes:string[]}>('remaster/scenery.json'),json<Record<string,string>>('remaster/surfaces.json'),json<InteriorCollision>(`collision/world-level${level}.json`),json<WorldObjectsData>(`world/objects${level}.json`),json<RoadNavigation>(`world/navigation${level}.json`)]);
    this.data.navigation=navigation;this.objectData=objects;
    for(const [source,albedo] of Object.entries(ground))if(surfaces[source])surfaces[source].albedo=albedo;
    this.assets.sceneryMaterials=surfaces;this.assets.sceneryScenes=new Set(scenery.scenes);
    // Every region downloads at once; the progress bar advances as each one is built.
    const scenes=[...this.data.scenes,...objects.extras];let built=0;const total=scenes.length;progress(0,`Building ${LEVEL_NAMES[level-1]} · 0/${total}`);
    const results=await Promise.all(scenes.map(async name=>{
      const result=await this.assets.load(name);built++;progress(built/(total+3),`Building ${LEVEL_NAMES[level-1]} · ${built}/${total}`);return result;
    }));
    const collision:THREE.BufferGeometry[]=[];
    for(const result of results){this.group.add(result.root);if(result.collision)collision.push(result.collision);}
    const shapes=[...physics.shapes,...objects.props.filter(p=>p.kind===2).flatMap(p=>p.shapes)];
    // What follows is one long synchronous block: merging the collision meshes and
    // building the tree the on-foot solver walks against takes about ten seconds on a
    // desktop and considerably longer on a phone, and nothing can repaint while it runs.
    // Naming the phase and handing the browser a frame to paint it FIRST is what stops a
    // slow build reading as a hang — the counter would otherwise sit at its last scene
    // for the whole of it, which is exactly what it looked like.
    progress((total+1)/(total+3),`Building ${LEVEL_NAMES[level-1]} · collision`);await paint();
    const bodies=staticCollisionGeometry({...physics,shapes});this.terrain=new Terrain(collision,this.data,bodies,this.data.scenes.flatMap(scene=>objects.terrainTypes[scene]));bodies.dispose();this.exteriorTerrain=this.terrain;
    progress((total+2)/(total+3),`Building ${LEVEL_NAMES[level-1]} · props`);await paint();
    this.objects=new WorldObjects(this.terrain,this.group,objects);
    // A separate receiver preserves the original baked environmental art.
    this.shadowGround=new THREE.Mesh(this.terrain.mesh.geometry,new THREE.ShadowMaterial({opacity:0.05}));
    this.shadowGround.receiveShadow=true;this.shadowGround.position.y=0.025;this.group.add(this.shadowGround);
    progress((total+2.5)/(total+3),`Building ${LEVEL_NAMES[level-1]} · gardens`);await paint();
    await this.grass.load(this.group);
  }
  setLighting(mode:string){
    this.lightingMode=mode;
    const u=this.sky.material.uniforms;
    u.turbidity.value=mode==='golden'?6:3;u.rayleigh.value=mode==='night'?1.2:1.6;u.mieCoefficient.value=0.006;u.mieDirectionalG.value=0.82;
    const elevation=mode==='golden'?12:mode==='night'?1:45;
    const sun=new THREE.Vector3().setFromSphericalCoords(1,THREE.MathUtils.degToRad(90-elevation),THREE.MathUtils.degToRad(230));
    u.sunPosition.value.copy(sun);
    this.sun.color.set(mode==='night'?0x87b5ff:mode==='golden'?0xffc996:0xfff1d8);
    this.sun.intensity=mode==='night'?0.5:mode==='golden'?1.5:2;
    this.hemisphere.intensity=mode==='night'?1.2:2.3;
    this.scene.fog=new THREE.Fog(mode==='night'?0x506575:mode==='golden'?0xd1b8a1:0xb4d3dd,90,480);
    const tint=new THREE.Color(mode==='night'?0x8998b4:mode==='golden'?0xffecd3:0xffffff);
    this.group.traverse(o=>{if(o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial&&o.material.map)o.material.color.copy(tint);});
  }
  async enterInterior(name:string){
    if(!this.interiors.has(name)){
      const [asset,physics]=await Promise.all([this.assets.load(name),json<InteriorCollision>(`collision/${name}.json`)]);if(!asset.collision)throw new Error(`Interior ${name} has no collision mesh`);
      const bodies=staticCollisionGeometry(physics);
      const terrain=new Terrain([asset.collision],{...this.data,fences:[]},bodies);bodies.dispose();this.interiors.set(name,{root:asset.root,terrain});this.scene.add(asset.root);
    }
    for(const [id,room] of this.interiors)room.root.visible=id===name;
    this.activeInterior=name;this.terrain=this.interiors.get(name)!.terrain;this.group.visible=false;this.sky.visible=false;this.scene.background=new THREE.Color(0x332a2b);this.scene.fog=null;
  }
  leaveInterior(){this.activeInterior=null;for(const room of this.interiors.values())room.root.visible=false;this.terrain=this.exteriorTerrain;this.group.visible=true;this.sky.visible=true;this.scene.background=null;this.setLighting(this.lightingMode);}
  update(position:THREE.Vector3){if(!this.activeInterior){this.grass.update(position);this.objects?.update(position);}this.sky.position.copy(position);this.sun.target.position.copy(position);this.sun.position.copy(position).add(new THREE.Vector3(-45,60,-35));}
  dispose(){
    this.grass.dispose();this.group.removeFromParent();this.sky.removeFromParent();this.sun.removeFromParent();this.sun.target.removeFromParent();this.hemisphere.removeFromParent();
    this.sky.geometry.dispose();this.sky.material.dispose();this.sun.shadow.dispose();
    (this.shadowGround?.material as THREE.Material|undefined)?.dispose();this.exteriorTerrain?.dispose();for(const room of this.interiors.values()){room.root.removeFromParent();room.terrain.dispose();}this.assets.dispose();
  }
}
