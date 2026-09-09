import { devTools } from './dev-tools';
import { type CampaignAssets,type Chapter,type Vec3 } from './campaign/types';
import { Net,peerColour,type Sample } from './net';
import { RemotePlayers } from './remote-players';
import { pursuitSettings } from './hit-and-run';
import { Pursuit } from './pursuit';
import { DEFAULT_FOOTPRINT,type VehicleFootprint } from './vehicle-collision';
import { Motion } from './motion';
import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, CAR_NAMES, LEVEL_NAMES } from './world';
import { json, type Catalog } from './assets';
import { Input,LOOK_SENSITIVITY } from './input';
import { drive, type CarState } from './physics';
import { cameraRelative,PlayerMovement } from './player-movement';
import { renderVehicleWheels,simulateVehicle,vehicleProfile,DEFAULT_VEHICLE,resetVehicle,type VehicleProfile } from './vehicle-physics';
import { HUD, element } from './hud';
import { Challenge } from './challenge';
import { Traffic,type TrafficCar } from './traffic';
import { Pedestrians,type Recruit } from './pedestrians';
import { Sound } from './audio';
import { Character } from './character';
import { DEFAULT_VRM,isVrmSkin,VRM_MODELS,VrmAvatar,type AnimationSource,type Avatar } from './vrm-avatar';
import { Coins } from './coins';
import { FrameMetrics } from './performance';
import { originalArt,OriginalMenu,OriginalHUD,FrontendRoom } from './original-ui';

const controller=new AbortController(), options={signal:controller.signal};
const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.2,900);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;renderer.info.autoReset=false;
renderer.domElement.setAttribute('aria-label','Springfield 3D driving scene');renderer.domElement.tabIndex=0;
element('game').append(renderer.domElement);
const composer=new EffectComposer(renderer);
composer.renderTarget1.samples=4;composer.renderTarget2.samples=4;
const bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),0.035,0.25,1.5);
composer.addPass(new RenderPass(scene,camera));composer.addPass(bloom);composer.addPass(new OutputPass());
const input=new Input(),hud=new HUD(),challenge=new Challenge(scene),sound=new Sound(),metrics=new FrameMetrics();let metricText='',metricTime=0;
const state:CarState={position:new THREE.Vector3(220,3.5,172),heading:Math.PI/2,speed:0,verticalSpeed:0,steer:0,distance:0,damage:0};
const motion=new Motion();motion.reset(state);
const walking=new PlayerMovement();
let nativeMenu:OriginalMenu|undefined,menuRoom:FrontendRoom|undefined;const nativeHUD=new OriginalHUD();
let coins:Coins|undefined;let campaignAssets:CampaignAssets;let kickUntil=0;let police:Pursuit|undefined,freeMoney=0;
// Multiplayer. The net object only ever reads the local state and writes remote avatars —
// it is never allowed to move `state`, so a bad connection cannot touch your own driving.
const net=new Net();let remotes:RemotePlayers|undefined;let pedestrians:Pedestrians|undefined;let playerName=localStorage.getItem('hit-and-run:name')??'';let playerSkin=localStorage.getItem('hit-and-run:skin')??DEFAULT_VRM;
// Where a VRM's motion comes from. The cast's own converted clips by default, so a VRM
// moves exactly like Homer does; Mixamo is opt-in, and covers what the game never had.
// The menu's ANIMATIONS choice, verbatim: 'game' (this level's character), 'cast:<id>'
// for one particular member of the cast, or the Mixamo settings.
let animationChoice=localStorage.getItem('hit-and-run:animations')??'game';
const animationSource=()=>(animationChoice.startsWith('cast:')?'game':animationChoice) as AnimationSource;
/** Which cast member's clips a VRM moves with — the level's own unless one was picked. */
const animationCast=()=>animationChoice.startsWith('cast:')?animationChoice.slice(5):CHARACTER_IDS[level-1];
/** A VRM the player loaded off their own device. It cannot be networked — peers cannot fetch it. */
let customVrm:{name:string;url:string}|undefined;
const sample:Sample=[0,0,0,0,0,0,1,0,0,0,0,'hom_loco_idle_rest','famil_v'];
let world:World, traffic:Traffic|undefined, car:THREE.Group|undefined,carOffset=0.65,footprint:VehicleFootprint=DEFAULT_FOOTPRINT;
let chassis:VehicleProfile=DEFAULT_VEHICLE;
let catalog:Catalog, loading=true,paused=true,highQuality=true,cameraMode=0,debug=false;
let onFoot=false,cruise=false,character:Avatar|undefined,footHeading=0;const parkedPosition=new THREE.Vector3();let parkedHeading=0;
let level=1, carId='famil_v',carModels=new Map<string,THREE.Group>();
let last=performance.now(),accumulator=0,time=0,frame=0,fps=60,lastFPS=last,photo=false;
// Orbit camera. `camYaw` is the direction the camera looks, so the car sits between it
// and the lens; the right thumb drives both angles and driving eases the yaw back home.
let camYaw=Math.PI/2,camPitch=.12,lastLook=-99;
const previous=new THREE.Vector3(),desiredCamera=new THREE.Vector3(),look=new THREE.Vector3(),smoothLook=new THREE.Vector3(),sunOffset=new THREE.Vector3();
const forward=new THREE.Vector3(),right=new THREE.Vector3(),normal=new THREE.Vector3(),rotationMatrix=new THREE.Matrix4(),rotation=new THREE.Quaternion();
const cameraRay=new THREE.Raycaster();cameraRay.firstHitOnly=true;
const CHARACTER_IDS=['homer','bart','lisa','marge','apu','bart','homer'];
/** How each level's character is tagged in the converted dialogue. */
const VOICE_ACTORS=['hom','brt','lis','mrg','apu','brt','hom'];
const CHARACTER_NAMES=['HOMER SIMPSON','BART SIMPSON','LISA SIMPSON','MARGE SIMPSON','APU','BART SIMPSON','HOMER SIMPSON'];
const levelSelect=element<HTMLSelectElement>('level'),carSelect=element<HTMLSelectElement>('car'),locationSelect=element<HTMLSelectElement>('location'),lighting=element<HTMLSelectElement>('lighting');
const play=element<HTMLButtonElement>('play'),run=element<HTMLButtonElement>('challenge');

/**
 * What the loading screen says. It is not a progress report: the bar already is one,
 * so the line under it just cycles these while the level builds.
 */
const LOAD_MESSAGES=[
  'This game is Ai vibe coded slop',
  'This game is for experimental purposes only',
  'This game is a port of a game',
  'This game is a game',
  'Hey honey I shrunk my dick',
];
let loadLine=0,loadTicker=0;
function progress(value:number){element('load-progress').style.width=`${value*100}%`;}
function sayLoading(){element('load-message').textContent=LOAD_MESSAGES[loadLine++%LOAD_MESSAGES.length];}
function startLoadMessages(){if(loadTicker)return;sayLoading();loadTicker=window.setInterval(sayLoading,2600);}
function stopLoadMessages(){clearInterval(loadTicker);loadTicker=0;}
/** A real failure is the one thing worth reading, so it stops the cycle and stands. */
function loadFailed(message:string){stopLoadMessages();progress(0);element('load-message').textContent=message;}
function lock(value:boolean){loading=value;for(const node of document.querySelectorAll<HTMLButtonElement|HTMLSelectElement>('#menu button,#menu select'))node.disabled=value;}
function pause(value:boolean){
  if(loading)return;paused=value;input.clear();accumulator=0;motion.reset(state);traffic?.resetInterpolation();police?.resetInterpolation();element('menu').hidden=!value;element('hud').hidden=value||photo;
  if(value){nativeMenu?.show('pause');cruise=false;play.querySelector('span')!.textContent='Back to Springfield';sound.pause();play.focus();}
  else{metrics.reset();sound.start();renderer.domElement.focus();smoothLook.copy(state.position);}
}
function toast(message:string){hud.toast(message);}
function nearestRoad(position:THREE.Vector3){
  let point=position.clone(),heading=state.heading,distance=Infinity;
  for(const [av,bv] of world.data.roads){
    const a=new THREE.Vector3(...av as [number,number,number]),b=new THREE.Vector3(...bv as [number,number,number]);
    const line=new THREE.Line3(a,b);const p=line.closestPointToPoint(position,true,new THREE.Vector3());
    const d=p.distanceTo(position);if(d<distance){distance=d;point=p;heading=Math.atan2(b.x-a.x,b.z-a.z);}
  }
  return {point,heading};
}
function respawn(location?:number){
  if(!world?.terrain)return;
  const place=location===undefined?state.position.clone():new THREE.Vector3(...world.data.locations[location].position);
  const road=nearestRoad(place);state.position.copy(road.point);state.heading=road.heading;
  const ground=world.terrain.ground(state.position.x,state.position.z,state.position.y,10);
  if(ground)state.position.y=ground.point.y+0.06;
  state.speed=0;state.verticalSpeed=0;state.damage=0;state.steer=0;state.grounded=true;walking.reset(state.heading);resetVehicle(state);cruise=false;smoothLook.copy(state.position);camYaw=state.heading;camPitch=.12;lastLook=-99;motion.reset(state);
  if(car)car.position.copy(state.position).add(new THREE.Vector3(0,carOffset,0));
  updateCamera(1,true);
}
/**
 * Build the body a skin names: a VRM from the shared host, or one of the game's own
 * characters. A VRM that will not load falls back to the level's cartoon character
 * rather than leaving the player invisible.
 */
async function makeAvatar(skin:string):Promise<Avatar>{
  if(isVrmSkin(skin)){
    const cast=animationCast();
    try{return await new VrmAvatar().load(skin,{
      animations:animationSource(),
      cast:campaignAssets.characters[cast]??cast,
      ...(customVrm&&customVrm.name===skin?{url:customVrm.url}:{}),
    });}
    catch(error){console.warn(`${skin} did not load; falling back to the cast`,error);}
  }
  const character=new Character();
  await character.load(world.assets,campaignAssets.characters[skin]??(isVrmSkin(skin)?CHARACTER_IDS[level-1]:skin));
  return character;
}
/**
 * Who walks Springfield, in the order they arrive.
 *
 * Springfield's own residents come FIRST — every character the game ships, costume
 * variants and all — because they are already on this device: the level's own models,
 * loaded from the same place the player's body is, so they are out on the pavement almost
 * immediately. The VRM roster follows, each of those a multi-megabyte download from the
 * asset host, so they join the crowd as they arrive rather than holding up the town.
 *
 * Whoever the player is wearing is left out: you cannot pass yourself in the street.
 */
function streetCast():Recruit[]{
  const springfield=Object.keys(campaignAssets.characters).filter(id=>id!==playerSkin).map(id=>({id,load:async()=>{
    const character=new Character();
    await character.load(world.assets,campaignAssets.characters[id]);
    // Not every entry in the cast is a person. At least one is a bare rig that carries the
    // shared animations and no geometry at all, and putting that on the pavement is an
    // invisible pedestrian holding a place in the crowd. Anything bodiless is turned away.
    let bodied=false;character.group.traverse(node=>{if((node as THREE.SkinnedMesh).isSkinnedMesh)bodied=true;});
    if(!bodied){character.dispose();throw new Error(`${id} has no body`);}
    return character as Avatar;
  }}));
  const roster=VRM_MODELS.filter(skin=>skin!==playerSkin).map(skin=>({id:skin,load:()=>makeAvatar(skin)}));
  return [...springfield,...roster];
}
async function setCar(id:string){
  if(onFoot){onFoot=false;state.position.copy(parkedPosition);state.heading=parkedHeading;}
  character?.group.removeFromParent();car?.removeFromParent();
  if(!carModels.has(id)){const asset=await world.assets.load(`car-${id}`,true);carModels.set(id,asset.root);}
  car=carModels.get(id)!;carId=id;carSelect.value=id;
  police?.enterVehicle(id);
  car.rotation.set(0,0,0);car.position.set(0,0,0);
  const box=new THREE.Box3().setFromObject(car),size=box.getSize(new THREE.Vector3());carOffset=-box.min.y+0.04;footprint={halfWidth:size.x/2,halfLength:size.z/2};
  chassis=vehicleProfile(car);carOffset=chassis.offset;resetVehicle(state);
  car.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  scene.add(car);character?.drive(car);element('car-label').textContent=(CAR_NAMES[id]??id).toUpperCase();
  element('scene-info').textContent=`${CAR_NAMES[id]??id} · ${LEVEL_NAMES[level-1]}`;
}
async function loadLevel(nextLevel:number){
  lock(true);paused=true;element('loading').hidden=false;startLoadMessages();element('hud').hidden=true;challenge.stop();
  remotes?.dispose();remotes=undefined;pedestrians?.dispose();pedestrians=undefined;police?.dispose();police=undefined;traffic?.dispose();coins?.dispose();character?.dispose();character=undefined;onFoot=false;cruise=false;car?.removeFromParent();world?.dispose();carModels.clear();
  level=nextLevel;levelSelect.value=String(nextLevel);lighting.value=level===7?'night':level>=4?'golden':'day';world=new World(scene,catalog);
  try{
    const chapterPromise=json<Chapter>(`campaign/level${level}.json`);await world.load(level,progress);coins=new Coins(scene,world.data);freeMoney=coins.collected;progress(0.9);
    locationSelect.replaceChildren(...world.data.locations.map((place,i)=>new Option(place.name,String(i))));
    const chapter=await chapterPromise;traffic=new Traffic(world,chapter.initial,campaignAssets.tuning);
    police=new Pursuit(world,pursuitSettings(chapter.initial),campaignAssets,{toast,fine:amount=>{const paid=Math.min(amount,freeMoney);freeMoney-=paid;saveGame();return paid;},busted:()=>sound.busted()});
    const [driver]=await Promise.all([makeAvatar(playerSkin),setCar(carId),traffic.load(),police.load(),coins.load(world.assets,world.objectData.coin)]);
    character=driver;character.drive(car!);
    remotes=new RemotePlayers(scene,world,campaignAssets);net.describe(level,carId,playerSkin);
    // The cast walks in behind the loading bar rather than through it: seventy-odd bodies
    // is tens of megabytes, and none of it is needed before the world is playable.
    pedestrians=new Pedestrians(world,scene);
    void pedestrians.populate(state.position,streetCast());
    sound.setCharacter(VOICE_ACTORS[level-1],campaignAssets.dialogue);
        element('district').textContent=`SPRINGFIELD · LEVEL ${String(level).padStart(2,'0')}`;
    element('menu-place').textContent=level===1?'742 Evergreen Terrace':LEVEL_NAMES[level-1];
    world.setLighting(lighting.value);respawn(0);renderer.compile(scene,camera);
    progress(1);stopLoadMessages();lock(false);element('loading').hidden=true;element('menu').hidden=false;
    nativeMenu?.show(nativeMenu.mode);
  }catch(error){
    loadFailed(`${error instanceof Error?error.message:String(error)} · Check the console, then reload to retry.`);console.error(error);
  }
}
function startChallenge(){police?.reset();world.leaveInterior();if(onFoot){onFoot=false;character?.drive(car!);}challenge.start(world.data);respawn(0);pause(false);element('mode-badge').textContent='SPRINGFIELD RUN';toast('Five stops. Five minutes. Make it home.');}
/**
 * Right thumb (or mouse drag, or a pad's right stick) orbits the camera.
 *
 * On foot the camera stays exactly where it is put, which is what makes the stick's
 * camera-relative steering predictable. Behind the wheel it eases back behind the car
 * a beat after the thumb lifts — a chase camera left pointing sideways at 90 km/h is
 * unusable, and the ease is slow enough to feel like the camera settling, not a snap.
 */
function orbit(dt:number){
  const look=input.takeLook();
  if(look.x||look.y){
    camYaw-=look.x*LOOK_SENSITIVITY;
    camPitch=THREE.MathUtils.clamp(camPitch+look.y*LOOK_SENSITIVITY,-.5,1.1);
    lastLook=time;
  }
  if(!onFoot&&time-lastLook>1.1&&Math.abs(state.speed)>2.5){
    const error=THREE.MathUtils.euclideanModulo(motion.heading-camYaw+Math.PI,Math.PI*2)-Math.PI;
    camYaw+=error*Math.min(1,dt*2.4);camPitch+=(.12-camPitch)*Math.min(1,dt*1.6);
  }
}
/**
 * What the four face buttons do right now.
 *
 * The glyphs never change — a button that relabels itself is a button you have to read
 * every time — so only the key behind each one moves, and it follows the original
 * console layout: triangle gets in and out, cross is the accelerator on the road and
 * the jump on foot, circle is the handbrake and the trigger, square is the brake and
 * the magazine change.
 */
function mapFaceButtons(){
  const set=(id:string,key:string)=>{const node=document.getElementById(id);if(node)node.dataset.key=key;};
  // ON FOOT: square is the kick, circle sprints, triangle gets in the car, cross jumps.
  // DRIVING: the console layout — cross accelerates, square brakes, circle is the
  // handbrake, triangle gets you out again.
  set('btn-triangle','KeyE');
  set('btn-cross',onFoot?'Space':'KeyW');
  set('btn-square',onFoot?'KeyF':'KeyS');
  set('btn-circle',onFoot?'ShiftLeft':'Space');
}
function updateCamera(dt:number,snap=false){
  const position=motion.position;
  if(!paused)orbit(dt);
  if(paused&&nativeMenu?.mode==='pause'&&!snap)return;
  if(paused){
    const angle=motion.heading+0.6+Math.sin(time*0.07)*0.13;
    desiredCamera.set(position.x-Math.sin(angle)*9,position.y+4,position.z-Math.cos(angle)*9);
    look.copy(position).add(new THREE.Vector3(-2.2,1,0));
  }else{
    const backwards=input.down('KeyB'),heading=camYaw+(backwards?Math.PI:0);
    const distance=onFoot?4.3:cameraMode===1?12.5:cameraMode===2?0.2:8.1;
    // Pitch swings the lens up and over on an arc of that same radius, so the framing
    // holds its distance whether you are looking along the road or down at the roof.
    const reach=distance*Math.cos(camPitch);
    desiredCamera.set(position.x-Math.sin(heading)*reach,position.y+(onFoot?2.7:cameraMode===1?6.5:cameraMode===2?1.55:3.55)+Math.sin(camPitch)*distance,position.z-Math.cos(heading)*reach);
    look.set(position.x+Math.sin(heading)*5,position.y+1.2-Math.sin(camPitch)*4.5,position.z+Math.cos(heading)*5);
    if(world?.terrain&&cameraMode!==2){
      const anchor=position.clone().add(new THREE.Vector3(0,1.6,0));const direction=desiredCamera.clone().sub(anchor);const distance=direction.length();
      cameraRay.set(anchor,direction.normalize());cameraRay.far=distance;
      const hit=world.terrain.raycast(anchor,direction,distance);
      if(hit)desiredCamera.copy(hit.point).addScaledVector(direction,-0.35);
      const ground=world.terrain.ground(desiredCamera.x,desiredCamera.z,position.y,4);
      if(ground)desiredCamera.y=Math.max(desiredCamera.y,ground.point.y+1);
    }
  }
  camera.position.lerp(desiredCamera,snap?1:1-Math.exp(-dt*5.5));
  smoothLook.lerp(look,snap?1:1-Math.exp(-dt*9));camera.lookAt(smoothLook);
  camera.fov=THREE.MathUtils.damp(camera.fov,paused?49:55+Math.min(Math.abs(state.speed)*0.16,6),4,dt);camera.updateProjectionMatrix();
}
function animate(now:number){
  const frameMs=now-last,dt=Math.min(frameMs/1000,0.08);last=now;time+=dt;frame++;
  if(now-lastFPS>750){fps=Math.round(frame*1000/(now-lastFPS));frame=0;lastFPS=now;}
  if(!loading){
    if(input.consume('Escape')){if(!paused)pause(true);else if(nativeMenu?.mode==='pause')pause(false);else if(nativeMenu&&nativeMenu.mode!=='main'&&nativeMenu.mode!=='splash')nativeMenu.back();}
    if(input.consume('F3')){debug=!debug;element('debug').hidden=!debug;}
    if(!paused){
      if(input.consume('KeyF')&&onFoot&&!police?.frozen){world.objects.kick(state.position,footHeading);walking.kick();character?.play('hom_jump_kick');kickUntil=time+.45;sound.bark(20);}
      if(input.consume('KeyR')&&!police?.frozen){if(onFoot){onFoot=false;character?.drive(car!);}respawn();toast('Back on the road.');}
      if(input.consume('KeyH')&&!onFoot){cruise=!cruise;toast(cruise?'Cruise control · 50 km/h. Brake to cancel.':'Cruise control off.');}
      if(input.consume('KeyE')&&character&&car&&!police?.frozen){
        if(onFoot){
          // Your own car first if you are standing at it, otherwise anything on the street.
          const street=state.position.distanceTo(parkedPosition)<6?undefined:traffic?.nearest(state.position,JACK_REACH);
          if(state.position.distanceTo(parkedPosition)<6){onFoot=false;state.position.copy(parkedPosition);state.heading=parkedHeading;state.speed=0;character.drive(car);sound.ignite();sound.bark();element('car-label').textContent=(CAR_NAMES[carId]??carId).toUpperCase();element('drive-hints').innerHTML=DRIVE_HINTS;toast('Back behind the wheel.');}
          else if(street)void jack(street);
          else toast('Get closer to a car.');
        }else if(Math.abs(state.speed)<2){
          onFoot=true;car.visible=true;cruise=false;parkedPosition.copy(state.position);parkedHeading=state.heading;footHeading=state.heading;
          state.position.add(new THREE.Vector3(Math.cos(state.heading)*2,0,-Math.sin(state.heading)*2));state.speed=0;
          walking.reset(state.heading);
          character.walk(scene,state.position,state.heading);sound.bark();element('car-label').textContent=CHARACTER_NAMES[level-1];element('drive-hints').innerHTML='<span><kbd>W A S D</kbd> Walk</span><span><kbd>SHIFT</kbd> Run</span><span><kbd>SPACE</kbd> Jump</span><span><kbd>E</kbd> Get in</span>'; toast('WASD to walk · Shift to run · Space to jump · E to get in.');
        }else toast('Stop the car before getting out.');
        if(!onFoot)police?.enterVehicle(carId);resetVehicle(state);motion.reset(state);
      }
      if(input.consume('KeyC')){cameraMode=(cameraMode+1)%3;toast(['Chase camera','Wide camera','Hood camera'][cameraMode]);}
      if(input.consume('KeyM'))hud.bigMap=!hud.bigMap;
      if(input.consume('KeyP')){photo=!photo;element('hud').hidden=photo;}
      accumulator+=dt;
      while(accumulator>=1/60){
        const fixed=1/60;motion.capture(state);previous.copy(state.position);const controls=input.controls;
        if(!police?.frozen){
        if(onFoot){
          world.terrain.setVehiclePlatforms([{id:'player',position:parkedPosition,heading:parkedHeading,half:chassis.half,center:chassis.center},...(traffic?.cars.filter(c=>c.active)??[]).map((c,i)=>({id:`traffic:${c.mesh.uuid}`,position:c.position,heading:c.heading,orientation:c.vehicleMotion?.orientation,half:c.profile.half,center:c.profile.center})),...(police?.cars??[]).map((c,i)=>({id:`police:${c.mesh.uuid}`,position:c.position,heading:c.heading,orientation:c.vehicleMotion?.orientation,half:c.profile.half,center:c.profile.center}))]);
          // The stick is read in camera space — push away from yourself and you run away
          // from the camera, whichever way the character happens to be facing — and is
          // converted here into the body-relative pair PlayerMovement expects.
          const move=input.move,walk=cameraRelative(move.x,move.z,state.heading,camYaw);
          const animation=walking.update(state,{...walk,run:move.run,jump:input.consume('Space')},fixed,world.terrain);footHeading=walking.heading;
          if(time>kickUntil)character?.play(animation);
        }else{
          world.terrain.setVehiclePlatforms([]);
          if(controls.brake||controls.handbrake)cruise=false;
          if(cruise)controls.throttle=state.speed<13.9?1:0;
          simulateVehicle(state,controls,fixed,campaignAssets.tuning[carId],chassis,world.terrain);
        }
        for(const reward of world.objects.drain()){
          const floor=world.terrain.support(reward.position.x,reward.position.z,reward.position.y,1)?.point.y??reward.position.y;
          const overflow=coins?.drop(reward.coins,reward.position,floor+.5,reward.inCar)??reward.coins;
          if(overflow)freeMoney+=overflow;
          if(reward.heat)police?.offense('propDestroyed',false);
          saveGame();
        }
        if(traffic?.update(fixed,state,!onFoot,camera.getWorldDirection(new THREE.Vector3()),[...(onFoot?[parkedPosition]:[]),...(police?.cars.map(c=>c.position)??[])],footprint,campaignAssets.tuning[carId]?.SetMass??1500)){police?.offense('vehicleHit',false);sound.bark(14);}
        const result=challenge.update(fixed,state.position);
        if(result==='checkpoint'){toast(`Stop ${challenge.index} reached. Keep moving.`);sound.bark(4);}
        if(result==='complete'){sound.bark(0);toast(`Home in ${Math.floor(challenge.elapsed/60)}:${String(Math.floor(challenge.elapsed%60)).padStart(2,'0')}. Nice driving.`);element('mode-badge').textContent='FREE DRIVE';}
        if(result==='failed'){sound.bark(0);toast('Time’s up. Try the Springfield Run again from the menu.');element('mode-badge').textContent='FREE DRIVE';}
        if(state.position.y<world.terrain.bottom-15||state.damage>=100){respawn();toast('A fresh start.');}
        }
        police?.update(fixed,{state,onFoot,vehicle:carId,parkedPosition,parkedHeading,footprint},false,traffic?.cars.filter(c=>c.active).map(c=>c.position));
        accumulator-=fixed;
      }
      sound.update(state.speed,input.controls.throttle,!onFoot);
      sound.pursuit(!!police?.hud.active,police?.audibleDistance??Infinity);
    }else{accumulator=0;motion.reset(state);}
    mapFaceButtons();
    const frozen=paused||police?.frozen,alpha=frozen?1:accumulator*60;motion.sample(state,alpha);traffic?.render(frozen?0:dt,alpha,state.position);police?.render(frozen?0:dt,alpha);nativeHUD.pursuit=police?.hud;
    network(frozen?0:dt);
    if(car&&!onFoot){
      car.position.copy(motion.position);car.position.add(new THREE.Vector3(0,carOffset,0).applyQuaternion(state.vehicleMotion?.orientation??new THREE.Quaternion()));
      normal.copy(world.terrain.normal(state.position.x,state.position.z,state.position.y));
      normal.lerp(new THREE.Vector3(0,1,0),0.3).normalize();
      forward.set(-Math.sin(motion.heading),0,-Math.cos(motion.heading));right.crossVectors(normal,forward).normalize();forward.crossVectors(right,normal).normalize();
      rotationMatrix.makeBasis(right,normal,forward);rotation.setFromRotationMatrix(rotationMatrix);
      if(state.vehicleMotion)rotation.copy(state.vehicleMotion.orientation).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI));
      car.quaternion.slerp(rotation,1-Math.exp(-dt*12));
      renderVehicleWheels(car,state.vehicleMotion,chassis,campaignAssets.tuning[carId]);
      car.visible=paused||cameraMode!==2;
    }
    if(onFoot&&character){character.group.position.copy(motion.position);character.group.rotation.y+=THREE.MathUtils.euclideanModulo(footHeading-character.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;}
    character?.update(paused?dt*0.35:dt);
    if(coins){const gained=coins.update(frozen?0:dt,state.position,!frozen,!onFoot);if(gained){freeMoney+=gained;sound.coin();saveGame();toast(`+${gained} coin${gained===1?'':'s'}`);}element('coin-count').textContent=String(freeMoney);}
    pedestrians?.update(frozen?0:dt,state.position);
    const worldStart=performance.now();world.update(state.position);const worldMs=performance.now()-worldStart;metrics.record(frameMs,worldMs);updateCamera(dt);
    if(now-metricTime>500){metricText=metrics.summary();metricTime=now;}
    hud.update(dt,state,world.data,challenge,traffic);nativeHUD.draw(dt,state,world.data,challenge,traffic,hud.bigMap,onFoot);
    if(debug)element('debug').textContent=`${fps} FPS · ${renderer.info.render.calls} draws · ${renderer.info.render.triangles.toLocaleString()} triangles\nposition ${state.position.x.toFixed(1)}, ${state.position.y.toFixed(1)}, ${state.position.z.toFixed(1)} · speed ${state.speed.toFixed(2)}\nlevel ${level} · ${carId} · ${paused?'paused':'driving'} · ${renderer.info.memory.geometries} geometries · ${renderer.info.memory.textures} textures\n${metricText}`;
  }
  renderer.info.reset();
  if(paused&&!loading&&nativeMenu?.mode==='splash'){
    // The splash screen is the full-frame logo; nothing should show around its edges.
    renderer.setScissorTest(false);renderer.setClearColor(0x000000);renderer.clear();
  }else if(paused&&!loading&&menuRoom&&nativeMenu?.mode!=='pause'){
    const width=Math.min(innerWidth,innerHeight*4/3),height=width*.75;
    renderer.setScissorTest(false);renderer.setClearColor(0x000000);renderer.clear();renderer.setViewport((innerWidth-width)/2,(innerHeight-height)/2,width,height);renderer.setScissor((innerWidth-width)/2,(innerHeight-height)/2,width,height);renderer.setScissorTest(true);
    menuRoom.actor?.update(dt);renderer.render(menuRoom.scene,menuRoom.camera);renderer.setScissorTest(false);renderer.setViewport(0,0,innerWidth,innerHeight);
  }else if(highQuality)composer.render();else renderer.render(scene,camera);
}
/**
 * The whole multiplayer frame: publish where we are, then draw where everyone else is.
 *
 * Deliberately one-way. Nothing read off the wire is allowed to write `state`,
 * `car` or the camera, so however badly the connection behaves the local car keeps
 * answering the wheel on this frame's own simulation.
 */
function network(dt:number){
  if(!net.connected){nativeHUD.multiplayer=null;return;}
  const orientation=state.vehicleMotion?.orientation;
  sample[0]=motion.position.x;sample[1]=motion.position.y;sample[2]=motion.position.z;
  if(orientation){sample[3]=orientation.x;sample[4]=orientation.y;sample[5]=orientation.z;sample[6]=orientation.w;}
  else{rotation.setFromAxisAngle(new THREE.Vector3(0,1,0),motion.heading);sample[3]=rotation.x;sample[4]=rotation.y;sample[5]=rotation.z;sample[6]=rotation.w;}
  sample[7]=onFoot?footHeading:motion.heading;sample[8]=state.speed;sample[9]=state.vehicleMotion?.wheelAngle??state.steer;
  sample[10]=onFoot?1:0;sample[11]=character?.playing??'hom_loco_idle_rest';sample[12]=carId;
  net.send(dt,sample,level,carId,playerSkin);
  // Remote avatars are played back on a clock held behind the newest packet, which is
  // what turns 20 Hz of samples into motion that reads as smoothly as the local car.
  net.advance(dt);
  remotes?.update(dt,net,level,state.position);
  const peers=remotes?.roster(state.position)??[];
  nativeHUD.multiplayer={status:net.status,connected:net.connected,peers};
}
function placePlayer(position:Vec3,heading:number,foot:boolean,parked?:Vec3){
  state.position.fromArray(position);state.heading=heading;state.speed=0;state.verticalSpeed=0;state.steer=0;state.grounded=false;walking.reset(heading);resetVehicle(state);cruise=false;onFoot=foot;footHeading=heading;
  if(parked)parkedPosition.fromArray(parked);else if(!foot)parkedPosition.copy(state.position);parkedHeading=heading;
  if(car){car.position.copy(foot?parkedPosition:state.position);car.position.y+=carOffset;car.rotation.y=heading+Math.PI;car.visible=true;}
  if(character&&car){if(foot)character.walk(scene,state.position,heading);else character.drive(car);}
  camYaw=heading;camPitch=.12;lastLook=-99;motion.reset(state);smoothLook.copy(state.position);updateCamera(1,true);
}
const DRIVE_HINTS='<span><kbd>W A S D</kbd> Drive</span><span><kbd>SPACE</kbd> Drift</span><span><kbd>E</kbd> Get out</span><span><kbd>H</kbd> Cruise</span><span><kbd>C</kbd> Camera</span>';
/** How close a pedestrian has to be to open somebody else's door. */
const JACK_REACH=5;
let jacking=false;
/**
 * Take a car off the street.
 *
 * The traffic pool is fixed, so the car is not destroyed: it leaves the world here and is
 * free to stream back in somewhere else with a fresh driver, while the player's own
 * vehicle becomes that model, standing exactly where it stood. Whatever was being driven
 * before is left behind — the one you are holding the keys to is the one you are in.
 *
 * The model has to load before any of that can happen, so this is asynchronous and holds
 * a latch: pressing the button again mid-load must not take two cars.
 */
async function jack(target:TrafficCar){
  if(jacking||!character)return;
  jacking=true;
  const id=target.id,position=target.position.clone(),heading=target.heading;
  traffic?.release(target);
  try{
    await setCar(id);
    placePlayer(position.toArray() as Vec3,heading,false,position.toArray() as Vec3);
    police?.enterVehicle(id);net.describe(level,id,playerSkin);
    sound.ignite();sound.bark();
    element('car-label').textContent=(CAR_NAMES[id]??id).toUpperCase();
    element('drive-hints').innerHTML=DRIVE_HINTS;
    toast(`${(CAR_NAMES[id]??id).toUpperCase()} — out you get.`);
    saveGame();
  }catch(error){console.warn(`could not take ${id}`,error);toast('That one would not start.');}
  finally{jacking=false;}
}
async function changeSkin(id:string){
  playerSkin=id;try{localStorage.setItem('hit-and-run:skin',id);}catch{}
  // You cannot pass yourself in the street, so that face leaves the crowd.
  pedestrians?.exclude(id);
  const next=await makeAvatar(id);character?.dispose();character=next;
  if(onFoot)character.walk(scene,state.position,state.heading);else character.drive(car!);
  net.describe(level,carId,playerSkin);
}
function saveGame(){
  try{localStorage.setItem('hit-and-run:save',JSON.stringify({version:3,level,car:carId,position:state.position.toArray(),heading:state.heading,onFoot,parkedPosition:parkedPosition.toArray(),parkedHeading,money:freeMoney}));
  }catch{toast('Could not save in this browser.');}
}
async function loadGame(){
  let saved;try{saved=JSON.parse(localStorage.getItem('hit-and-run:save')??'null');}catch{}
  const vector=(p:unknown):p is Vec3=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
  if(!saved){nativeMenu?.notice('NO SAVED GAME');return;}
  if(!catalog.levels.includes(saved.level)||!catalog.cars.includes(saved.car)||!vector(saved.position)||!Number.isFinite(saved.heading)){nativeMenu?.notice('THIS SAVE IS NOT VALID');return;}
  carId=saved.car;await loadLevel(saved.level);
  if(Number.isFinite(saved.money)&&saved.money>=0)freeMoney=saved.money;
  placePlayer(saved.position,saved.heading,false,vector(saved.parkedPosition)?saved.parkedPosition:undefined);pause(false);
}
play.addEventListener('click',()=>pause(false),options);
run.addEventListener('click',startChallenge,options);
element('pause').addEventListener('click',()=>pause(true),options);
levelSelect.addEventListener('change',()=>void loadLevel(Number(levelSelect.value)),options);
carSelect.addEventListener('change',async()=>{lock(true);try{await setCar(carSelect.value);respawn(Number(locationSelect.value));}catch(error){console.error(error);toast('That car could not be loaded.');}finally{lock(false);}},options);
const skinSelect=element<HTMLSelectElement>('skin');
skinSelect.replaceChildren(...VRM_MODELS.map(file=>new Option(file.replace(/\.vrm$/i,''),file)));
skinSelect.value=playerSkin;
// A saved cartoon character is not in the VRM list, so fall back to the cast entry.
if(!skinSelect.value)skinSelect.value='cast';
const animationSelect=element<HTMLSelectElement>('animations');
animationSelect.value=animationChoice;
animationSelect.addEventListener('change',()=>{
  animationChoice=animationSelect.value;
  try{localStorage.setItem('hit-and-run:animations',animationChoice);}catch{}
  // The choice is baked into the avatar when it is built, so rebuild the one on screen.
  void changeSkin(playerSkin).catch(()=>toast('That character would not load.'));
},options);

/**
 * Load a VRM off this device.
 *
 * It stays on this device: the file becomes an object URL that only this browser can
 * read, so other players see the avatar you last chose from the shared list instead.
 */
const vrmFile=element<HTMLInputElement>('vrm-file');
vrmFile.addEventListener('change',()=>{
  const file=vrmFile.files?.[0];
  vrmFile.value='';
  if(!file)return;
  if(customVrm)URL.revokeObjectURL(customVrm.url);
  const name=/\.vrm$/i.test(file.name)?file.name:`${file.name}.vrm`;
  customVrm={name,url:URL.createObjectURL(file)};
  if(!skinSelect.querySelector(`option[value="${CSS.escape(name)}"]`))skinSelect.append(new Option(name.replace(/\.vrm$/i,''),name));
  skinSelect.value=name;
  void changeSkin(name).then(()=>toast('Your own avatar. Other players will see your last pick from the list.'))
    .catch(()=>toast('That file is not a VRM this browser can read.'));
},options);
skinSelect.addEventListener('change',()=>{
  if(skinSelect.value==='custom'){skinSelect.value=playerSkin;vrmFile.click();return;}
  void changeSkin(skinSelect.value).catch(()=>toast('That character would not load.'));
},options);
locationSelect.addEventListener('change',()=>{if(onFoot){onFoot=false;character?.drive(car!);}challenge.stop();respawn(Number(locationSelect.value));element('menu-place').textContent=world.data.locations[Number(locationSelect.value)].name;},options);
lighting.addEventListener('change',()=>world.setLighting(lighting.value),options);
const soundButton=element('sound');
const showSound=(on:boolean)=>{soundButton.textContent=on?'SOUND ON':'SOUND OFF';soundButton.setAttribute('aria-pressed',String(on));};
showSound(sound.enabled);
soundButton.addEventListener('click',async()=>{showSound(await sound.toggle());},options);
element('quality').addEventListener('click',()=>{highQuality=!highQuality;renderer.shadowMap.enabled=highQuality;renderer.setPixelRatio(Math.min(devicePixelRatio,highQuality?2:1));composer.setPixelRatio(renderer.getPixelRatio());element('quality').textContent=highQuality?'HIGH QUALITY':'PERFORMANCE';},options);
/**
 * Springfield is a landscape game, and on a phone that means real fullscreen — the
 * browser will not rotate a page that still has its address bar.
 *
 * Two rules decide whether the request is honoured, both learned the hard way in the
 * sibling project: it must be fired SYNCHRONOUSLY inside the gesture's call stack (so
 * nothing may be awaited first), and on Android only a RELEASE gesture counts — a
 * pointerdown is silently ignored, which is why asking on first touch did nothing.
 * So the request is re-fired on every tap until a real fullscreenchange confirms it,
 * and only then is the orientation locked. Nothing is shown while this happens.
 */
type Fullscreenable=HTMLElement&{webkitRequestFullscreen?:()=>Promise<void>|void};
type Fullscreened=Document&{webkitFullscreenElement?:Element|null;webkitExitFullscreen?:()=>Promise<void>|void};
const isFullscreen=()=>!!(document.fullscreenElement||(document as Fullscreened).webkitFullscreenElement);
function requestFullscreenNow(){
  if(isFullscreen())return;
  const root=document.documentElement as Fullscreenable;
  const request=root.requestFullscreen??root.webkitRequestFullscreen;
  if(!request)return;
  // The options form throws outright on some older WebKit builds; the bare call still works.
  try{void Promise.resolve(request.call(root,{navigationUI:'hide'})).catch(()=>{});}
  catch{try{void Promise.resolve(request.call(root)).catch(()=>{});}catch{}}
}
const lockLandscape=()=>{try{void (screen.orientation as {lock?:(to:string)=>Promise<void>})?.lock?.('landscape')?.catch(()=>{});}catch{}};
let fullscreenArmed=false;
function armFullscreen(){
  if(fullscreenArmed||!matchMedia('(pointer:coarse)').matches)return;
  fullscreenArmed=true;
  const attempt=()=>requestFullscreenNow();
  const settled=()=>{if(isFullscreen()){lockLandscape();stop();}};
  const stop=()=>{
    fullscreenArmed=false;clearTimeout(timer);
    document.removeEventListener('touchend',attempt,true);document.removeEventListener('click',attempt,true);
    document.removeEventListener('fullscreenchange',settled);document.removeEventListener('webkitfullscreenchange',settled);
  };
  document.addEventListener('touchend',attempt,true);document.addEventListener('click',attempt,true);
  document.addEventListener('fullscreenchange',settled);document.addEventListener('webkitfullscreenchange',settled);
  // Never leave listeners armed forever on a browser that will simply never allow it.
  const timer=setTimeout(stop,60000);
}
armFullscreen();
// Anything that takes the tab away — a share sheet, a notification — drops fullscreen,
// and Android follows it back in portrait. Coming back re-arms the same tap retry.
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&!isFullscreen())armFullscreen();},options);
document.addEventListener('fullscreenchange',()=>{if(isFullscreen())lockLandscape();else armFullscreen();},options);
element('fullscreen').addEventListener('click',()=>{
  if(isFullscreen()){void ((document as Fullscreened).exitFullscreen??(document as Fullscreened).webkitExitFullscreen)?.call(document);return;}
  requestFullscreenNow();lockLandscape();armFullscreen();
},options);
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);},options);
window.addEventListener('blur',()=>{if(!paused&&!loading)pause(true);},options);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!paused&&!loading)pause(true);},options);
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();pause(true);element('loading').hidden=false;loadFailed('The graphics context was interrupted. Reload to reconnect.');},options);
renderer.setAnimationLoop(animate);
async function init(){
  startLoadMessages();
  try{
    // The menu art, catalogue and campaign index have no dependencies, so they download together.
    const artReady=originalArt.load();const catalogReady=Promise.all([json<Catalog>('catalog.json'),json<CampaignAssets>('campaign/assets.json')]);
    await artReady;
    const nativeOptions=document.createElement('section');nativeOptions.id='native-options';nativeOptions.hidden=true;
    const settings=document.querySelector('.settings-grid')!,footer=document.querySelector('.menu-footer')!;
    nativeOptions.append(settings,footer);(settings as HTMLElement).hidden=false;(footer as HTMLElement).hidden=false;element('menu').append(nativeOptions);
    for(const label of settings.querySelectorAll('label')){
      const text=[...label.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);const span=document.createElement('span');span.className='native-label';span.dataset.text=text?.textContent?.trim()??'';text?.remove();label.prepend(span);label.querySelector('select')?.setAttribute('aria-label',span.dataset.text);
    }
    nativeMenu=new OriginalMenu({start:()=>pause(false),run:startChallenge,main:()=>{},
      save:()=>{saveGame();nativeMenu?.notice('GAME SAVED');},
      load:()=>void loadGame(),
      lobby:()=>({connected:net.connected,status:net.status,name:playerName,peers:[...net.peers.values()].map(p=>`${p.name} · LVL ${p.level}`)}),
      join:name=>{playerName=name;try{localStorage.setItem('hit-and-run:name',name);}catch{}net.join(name,level,carId,playerSkin);},
      leave:()=>{net.close();remotes?.clear();}
    });nativeMenu.show('splash');
    net.on('status',()=>{if(nativeMenu?.mode==='lobby')nativeMenu.show('lobby');});
    net.on('join',peer=>toast(`${peer.name} joined.`));
    net.on('leave',id=>{const name=net.peers.get(id)?.name;remotes?.remove(id);if(name)toast(`${name} left.`);});
    [catalog,campaignAssets]=await catalogReady;Object.assign(CAR_NAMES,catalog.carNames??{});carSelect.replaceChildren(...catalog.cars.map(id=>new Option(CAR_NAMES[id]??id,id)));
    // Every converted character is playable, and every one of them carries its own 23
    // clips — so the cast fills both menus: the body you wear, and whose movement drives
    // it. Any of them can animate any body, a VRM included.
    const cast=Object.keys(campaignAssets.characters).sort();
    const castName=(id:string)=>campaignAssets.names[id]??id.replace(/_/g,' ');
    skinSelect.replaceChildren(
      ...VRM_MODELS.map(file=>new Option(file.replace(/\.vrm$/i,''),file)),
      new Option('Your own VRM…','custom'),
      ...cast.map(id=>new Option(castName(id),id)));
    skinSelect.value=playerSkin;
    if(!skinSelect.value)skinSelect.value=CHARACTER_IDS[level-1];
    animationSelect.replaceChildren(
      new Option("This level's cast",'game'),
      new Option('Mixamo','mixamo'),new Option('Both','all'),
      ...cast.map(id=>new Option(castName(id),`cast:${id}`)));
    animationSelect.value=animationChoice;
    if(!animationSelect.value){animationChoice='game';animationSelect.value='game';}
    // The menu room and the first level share no state, so they load side by side.
    const room=new FrontendRoom(catalog);await Promise.all([room.load().then(()=>{menuRoom=room;}),loadLevel(1)]);}
  catch(error){console.error(error);loadFailed('Game assets are missing. Run npm run extract and npm run convert, then reload.');}
}
void init();
const removeDevTools=devTools(input,{place:value=>{const parts=value.trim().split(/\s+/),numbers=parts.slice(0,4).map(Number);if(numbers.length!==4||numbers.some(n=>!Number.isFinite(n))||!['foot','car'].includes(parts[4]))throw new Error('Use x y z heading-degrees foot/car');placePlayer(numbers.slice(0,3) as Vec3,THREE.MathUtils.degToRad(numbers[3]),parts[4]==='foot',parkedPosition.toArray());},state:()=>`${onFoot?'foot':'car'} ${state.speed.toFixed(1)} m/s ${state.grounded?'ground':'air'} · jumps ${walking.jumps} · coins ${freeMoney} · heat ${police?.meter.heat.toFixed(1)??0} · police ${police?.cars.length??0} · net ${net.status} ${net.peers.size} peers`,resume:()=>pause(false),pursuit:()=>police?.command({op:'SetHitAndRunMeter',args:[100],line:0}),clearPursuit:()=>police?.reset(),testCoins:()=>{freeMoney+=75;}});
function dispose(){stopLoadMessages();removeDevTools();net.close();remotes?.dispose();pedestrians?.dispose();controller.abort();renderer.setAnimationLoop(null);input.dispose();sound.dispose();nativeMenu?.dispose();nativeHUD.canvas.remove();menuRoom?.dispose();coins?.dispose();character?.dispose();challenge.dispose();police?.dispose();traffic?.dispose();world?.dispose();composer.passes.forEach(pass=>pass.dispose());composer.dispose();renderer.dispose();renderer.domElement.remove();}
window.addEventListener('pagehide',dispose,{once:true});
if(import.meta.hot)import.meta.hot.dispose(dispose);
