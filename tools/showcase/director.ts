import * as THREE from 'three';
import {TrafficPath} from './traffic-path';
import type {World} from './world';
import type {CarState,Controls} from './physics';
export interface Shot{id:string;title:string;level:number;car:string;location?:number;destination?:number;seconds:number;mode:'drive'|'orbit'|'people'|'interior';light?:string;angle:[number,number];distance:[number,number];height:[number,number];focus?:[number,number,number];hud?:boolean;speed?:number}
const shots:Shot[]=[
 {id:'evergreen-drive',title:'Evergreen Terrace / tracking drive',level:1,car:'famil_v',location:0,destination:1,seconds:8,mode:'drive',light:'golden',angle:[-.65,-.3],distance:[13,10],height:[4.8,3.2],speed:15},
 {id:'homer-marge',title:'Homer and Marge / porch dolly',level:1,car:'famil_v',seconds:6,mode:'people',light:'golden',angle:[2.89,3.26],distance:[6.6,5.5],height:[1.2,1.5],focus:[220.5,4.65,177.0]},
 {id:'downtown',title:'Downtown / Bart tracking drive',level:2,car:'honor_v',location:0,destination:1,seconds:8,mode:'drive',light:'day',angle:[.6,.15],distance:[12,10],height:[4.5,3.4],speed:17,hud:true},
 {id:'waterfront',title:'Waterfront / Lisa tracking drive',level:3,car:'lisa_v',location:3,seconds:8,mode:'orbit',light:'day',angle:[4.35,4.65],distance:[18,15],height:[5.5,4.5],focus:[-510,-67,85]},
 {id:'kwik-e-mart',title:'Kwik-E-Mart / Homer and Apu',level:1,car:'famil_v',seconds:6,mode:'interior',angle:[-1.7,-1.3],distance:[5.4,4.8],height:[1.2,1.35],focus:[500.9,-18.7,300]},
 {id:'halloween',title:'Halloween / haunted Springfield',level:7,car:'homer_v',location:0,destination:1,seconds:8,mode:'drive',light:'night',angle:[-.55,-.2],distance:[12,9],height:[4.4,3.1],speed:13},
 {id:'springfield-hero',title:'Evergreen Terrace / final orbit',level:1,car:'famil_v',location:0,seconds:8,mode:'orbit',light:'golden',angle:[3.59,3.19],distance:[32,26],height:[13,10],focus:[216,5.8,180]},
];
interface Context{renderer:THREE.WebGLRenderer;camera:THREE.PerspectiveCamera;nativeHUD:{canvas:HTMLCanvasElement};ready:()=>boolean;world:()=>World;player:()=>CarState;setup:(shot:Shot)=>Promise<void>}
export function installDirector(context:Context){
 const panel=document.createElement('aside');panel.setAttribute('aria-label','Showcase director');panel.style.cssText='position:fixed;left:20px;bottom:20px;z-index:100;background:#111e;padding:16px;color:#fff;font:16px system-ui;display:flex;gap:12px;align-items:center';
 const batch=document.createElement('button');batch.textContent='Record all shots';
 const select=document.createElement('select');select.setAttribute('aria-label','Shot');for(const shot of shots)select.add(new Option(shot.title,shot.id));
 const preview=document.createElement('button'),record=document.createElement('button'),still=document.createElement('button'),status=document.createElement('output');preview.textContent='Prepare shot';record.textContent='Record shot';still.textContent='Save still';record.disabled=still.disabled=true;status.textContent='Choose a shot';panel.append(select,preview,record,still,batch,status);document.body.append(panel);
 const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d')!;
 let active=false,recording=false,waiting=false,shot=shots[0],frame=0,route:THREE.Vector3[]=[],routeIndex=0,startPose:{position:THREE.Vector3;heading:number}|undefined;
 let completed:(()=>void)|undefined,failed:((error:unknown)=>void)|undefined;
 const mix=(values:[number,number],t:number)=>THREE.MathUtils.lerp(values[0],values[1],t);
 async function save(index:number){
  ctx.drawImage(context.renderer.domElement,0,0,1920,1080);if(shot.hud)ctx.drawImage(context.nativeHUD.canvas,0,0,1920,1080);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Frame capture failed')),'image/jpeg',.96));
  const response=await fetch(`/__capture?shot=${shot.id}&frame=${String(index).padStart(4,'0')}`,{method:'POST',body:blob});if(!response.ok)throw new Error(await response.text());
 }
 preview.onclick=async()=>{
  if(!context.ready()){status.textContent='Wait for the level to load';return;}recording=false;active=false;record.disabled=still.disabled=true;preview.disabled=true;status.textContent='Preparing…';shot=shots.find(s=>s.id===select.value)!;
  try{await context.setup(shot);const player=context.player();if(shot.mode==='drive'){
   const roads=context.world().data.roads.map(r=>r.map(p=>new THREE.Vector3(...p as [number,number,number])));let best=Infinity,index=0,fraction=0;
   roads.forEach(([a,b],i)=>{const line=new THREE.Line3(a,b),t=line.closestPointToPointParameter(player.position,true),point=line.at(t,new THREE.Vector3()),d=point.distanceToSquared(player.position);if(d<best){best=d;index=i;fraction=t;}});
   const path=new TrafficPath(roads,index,false,fraction);route=[];const point=new THREE.Vector3();player.heading=path.sample(point);player.position.copy(point);const ground=context.world().terrain.ground(point.x,point.z,point.y,5);if(ground)player.position.y=ground.point.y+.06;
   route.push(player.position.clone());for(let i=0;i<240;i++){path.advance(2);path.sample(point);route.push(point.clone());}routeIndex=0;
  }
  startPose={position:player.position.clone(),heading:player.heading};player.speed=0;active=true;frame=0;record.disabled=still.disabled=false;status.textContent=`Ready · ${shot.seconds}s · 1920×1080 / 30 fps`;
  }catch(error){status.textContent=String(error);}finally{preview.disabled=false;}
 };
 record.onclick=()=>{if(!active||!startPose)return;const player=context.player();player.position.copy(startPose.position);player.heading=startPose.heading;player.speed=shot.mode==='drive'?(shot.speed??15):0;player.damage=0;routeIndex=0;frame=0;recording=true;record.disabled=preview.disabled=still.disabled=true;status.textContent='Recording…';};
 still.onclick=()=>{void save(9999).then(()=>{status.textContent='Still saved';}).catch(error=>{status.textContent=String(error);});};
 batch.onclick=async()=>{batch.disabled=true;try{for(const item of shots){select.value=item.id;await preview.onclick?.call(preview,new PointerEvent('click'));if(!active)throw new Error(status.textContent??'Shot preparation failed');await new Promise<void>((resolve,reject)=>{completed=resolve;failed=reject;record.onclick?.call(record,new PointerEvent('click'));});}status.textContent='All shots complete';}catch(error){status.textContent=String(error);}finally{batch.disabled=false;}};
 return {
  get active(){return active;},get recording(){return recording;},get waiting(){return waiting;},
  controls():Controls|null{
   if(!active)return null;const controls:Controls={steer:0,throttle:0,brake:0,handbrake:false};if(!recording||shot.mode!=='drive')return controls;
   const player=context.player();while(routeIndex<route.length-2&&player.position.distanceTo(route[routeIndex+1])<12)routeIndex++;
   let target=route[Math.min(routeIndex+1,route.length-1)];const line=new THREE.Line3(route[routeIndex],target),point=line.closestPointToPoint(player.position,true,new THREE.Vector3());
   const remaining=point.distanceTo(target);if(remaining>18)target=point.add(target.clone().sub(point).normalize().multiplyScalar(18));else if(routeIndex+2<route.length)target=target.clone().lerp(route[routeIndex+2],Math.min(.45,(18-remaining)/Math.max(1,target.distanceTo(route[routeIndex+2]))));
   const heading=Math.atan2(target.x-player.position.x,target.z-player.position.z),difference=Math.atan2(Math.sin(heading-player.heading),Math.cos(heading-player.heading));controls.steer=THREE.MathUtils.clamp(-difference*1.6,-1,1);controls.throttle=player.speed<(shot.speed??15)?1:0;controls.brake=player.speed>(shot.speed??15)+2?.12:0;return controls;
  },
  camera(){
   if(!active)return;const player=context.player(),u=THREE.MathUtils.clamp(frame/(shot.seconds*30),0,1),t=u*u*(3-2*u),focus=shot.focus?new THREE.Vector3(...shot.focus):player.position.clone().add(new THREE.Vector3(0,1,0));
   const angle=mix(shot.angle,t)+(shot.mode==='drive'?player.heading+Math.PI:0),distance=mix(shot.distance,t);
   context.camera.position.set(focus.x+Math.sin(angle)*distance,focus.y+mix(shot.height,t),focus.z+Math.cos(angle)*distance);context.camera.lookAt(focus);context.camera.fov=shot.mode==='interior'?52:shot.mode==='people'?43:48;context.camera.updateProjectionMatrix();
  },
  async afterFrame(){
   if(!recording||waiting)return;waiting=true;
   try{await save(frame);frame++;status.textContent=`Recording ${shot.id} · ${frame}/${shot.seconds*30}`;if(frame>=shot.seconds*30){recording=false;record.disabled=preview.disabled=still.disabled=false;status.textContent=`Complete · ${shot.id} · ${frame} frames`;completed?.();completed=undefined;failed=undefined;}}
   catch(error){recording=false;failed?.(error);failed=undefined;completed=undefined;status.textContent=String(error);record.disabled=preview.disabled=still.disabled=false;}
   finally{waiting=false;}
  }
 };
}
