"""Build a separate recording copy of the committed game, with visible film controls."""
from pathlib import Path
import io,json,shutil,subprocess,tarfile
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'artifacts/showcase-v2';DEST=BASE/'capture';DEST.mkdir(parents=True,exist_ok=True)
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
archive=subprocess.check_output(['git','archive',revision,'src','index.html','package.json','package-lock.json','tsconfig.json'],cwd=ROOT)
with tarfile.open(fileobj=io.BytesIO(archive)) as data:data.extractall(DEST,filter='data')
for name in ['node_modules','public']:
 if not (DEST/name).exists():(DEST/name).symlink_to(ROOT/name,target_is_directory=True)
(DEST/'src/trailer-director.ts').write_text((ROOT/'tools/trailer/director.ts').read_text().replace('__SOURCE_REVISION__',revision))
s=(DEST/'src/main.ts').read_text();s="import { installDirector } from './trailer-director';\n"+s
s=s.replace('antialias:true,powerPreference:', 'antialias:true,preserveDrawingBuffer:true,powerPreference:')
s=s.replace('function updateCamera(dt:number,snap=false){', 'let director:ReturnType<typeof installDirector>|undefined;\nfunction updateCamera(dt:number,snap=false){')
s=s.replace('function animate(now:number){','function animate(now:number){\n  if(director?.waiting)return;\n  director?.input();')
s=s.replace('dt=Math.min(frameMs/1000,0.08)','dt=director?.active?(director.recording?1/60:0):Math.min(frameMs/1000,0.08)')
s=s.replace('const controls=input.controls;', 'const controls=director?.controls()??input.controls;')
s=s.replace("addEventListener('resize',()=>{", "addEventListener('resize',()=>{if(director?.active)return;")
s=s.replace('renderer.info.reset();','director?.camera();\n  renderer.info.reset();')
s=s.replace('}else if(highQuality)composer.render();else renderer.render(scene,camera);','}else if(highQuality)composer.render();else renderer.render(scene,camera);\n  void director?.afterFrame();')
s+='''
director=installDirector({renderer,camera,nativeHUD,input,ready:()=>!loading,world:()=>world,player:()=>state,
 tuning:()=>campaignAssets.tuning[carId],info:()=>({position:state.position.toArray(),orientation:state.vehicleMotion?.orientation.toArray(),offset:carOffset,speed:state.speed,grounded:state.grounded,condition:100-state.damage,coins:campaign?.progress.money??freeMoney,heat:police?.meter.heat??0,cops:police?.cars.map(c=>c.position.toArray())??[],mission:campaign?.hud.message??'',phase:campaign?.engine.status??'free',rivals:campaign?.vehicleBodies.map(c=>({id:c.id,position:c.position.toArray(),mode:c.mode,speed:c.speed}))??[]}),
 async setup(shot){
  const p=newProgress();p.level=shot.level;p.mission=shot.mission??(shot.level===1?'m0':'m1');p.phase=shot.phase??'main';p.stage=shot.stage??0;p.checkpoint={phase:p.phase,stage:p.stage};await startCampaign(p);
  campaign!.presentation.stop();await setCar(shot.car);if(shot.location!==undefined)respawn(shot.location);
  if(shot.position)placePlayer(shot.position,shot.heading??0,!!shot.foot);else if(shot.foot)placePlayer(state.position.toArray() as Vec3,state.heading,true);
  if(shot.objective){const target=campaign!.hud.target;if(target)placePlayer([target[0],target[1],target[2]-1.6],0,true);}
  if(shot.free){campaign?.dispose();campaign=undefined;nativeHUD.campaign=null;freeMoney=0;}
  state.damage=0;world.objects.reset();coins?.reset();police?.reset();input.clear();pause(false);
  world.setLighting(shot.light??(shot.level===7?'night':'day'));renderer.toneMappingExposure=shot.level===7?1.35:1.12;
  element('hud').hidden=true;nativeHUD.canvas.style.opacity='0';renderer.setPixelRatio(1);renderer.setSize(1920,1080);composer.setSize(1920,1080);camera.aspect=16/9;camera.updateProjectionMatrix();renderer.domElement.style.width='100%';renderer.domElement.style.height='auto';
  for(let i=0;i<90;i++)world.update(state.position);
 },
 finish(){nativeHUD.canvas.style.opacity='1';element('hud').hidden=false;},
 start(shot){state.speed=shot.speed??0;resetVehicle(state);motion.reset(state);input.clear();
  if(['skinner-race','bart-escape','smithers-smash'].includes(shot.id)){for(const [i,c] of (campaign?.vehicleBodies??[]).entries()){c.position.copy(state.position).add(new THREE.Vector3(-Math.sin(state.heading)*((shot.id==='smithers-smash'?-8:8)+i*7)+Math.cos(state.heading)*(shot.id==='smithers-smash'?.4:2.5),0,-Math.cos(state.heading)*((shot.id==='smithers-smash'?-8:8)+i*7)-Math.sin(state.heading)*(shot.id==='smithers-smash'?.4:2.5)));const floor=world.terrain.ground(c.position.x,c.position.z,c.position.y,5);if(floor)c.position.y=floor.point.y+.06;c.heading=state.heading;c.speed=shot.id==='smithers-smash'?7:state.speed+1;c.route=undefined;c.repath=0;resetVehicle(c);c.motion.reset(c);}}
  if(shot.pursuit){police!.command({op:'SetHitAndRunMeter',args:[100],line:0});police!.update(1/60,{state,onFoot,vehicle:carId,parkedPosition,parkedHeading,footprint},false);for(const [i,c] of police!.cars.entries()){c.position.copy(state.position).add(new THREE.Vector3(-Math.sin(state.heading)*(17+i*8),0,-Math.cos(state.heading)*(17+i*8)));const floor=world.terrain.ground(c.position.x,c.position.z,c.position.y,5);if(floor)c.position.y=floor.point.y+.06;c.heading=state.heading;c.speed=(shot.speed??14)+2;resetVehicle(c);c.motion.reset(c);}}
 }
});
'''
(DEST/'src/main.ts').write_text(s)
ui=DEST/'src/original-ui.ts';ui.write_text(ui.read_text().replace('width=innerWidth,height=innerHeight','width=1920,height=1080'))
config=r'''import {defineConfig} from 'vite';
import {mkdir,writeFile,rm} from 'node:fs/promises';import path from 'node:path';
const output=OUTPUT;
export default defineConfig({server:{host:'127.0.0.1',port:5184,strictPort:true,fs:{allow:[ROOT]}},plugins:[{name:'trailer-capture',configureServer(server){server.middlewares.use('/__capture',async(req,res)=>{try{if(req.method!=='POST'){res.statusCode=405;res.end();return;}const url=new URL(req.url,'http://127.0.0.1:5184'),shot=url.searchParams.get('shot'),frame=url.searchParams.get('frame');if(!/^[a-z0-9_-]+$/.test(shot??'')||!(/^[0-9]{4}$/.test(frame??'')||['reset','telemetry'].includes(frame??'')))throw new Error('Invalid capture name');const target=path.join(output,shot);if(frame==='reset'){await rm(target,{recursive:true,force:true});await mkdir(target,{recursive:true});res.end('OK');return;}const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>20000000)throw new Error('Frame too large');chunks.push(chunk);}await mkdir(target,{recursive:true});await writeFile(path.join(target,frame+(frame==='telemetry'?'.json':'.jpg')),Buffer.concat(chunks));res.end('OK');}catch(error){res.statusCode=500;res.end(String(error));}});}}]});
'''.replace('OUTPUT',json.dumps(str(BASE/'raw'))).replace('ROOT',json.dumps(str(ROOT)))

if not (DEST/'vite.config.ts').exists() or (DEST/'vite.config.ts').read_text()!=config:(DEST/'vite.config.ts').write_text(config)
(BASE/'source.json').write_text(json.dumps({'revision':revision,'fps':60,'capture':'Current game simulation with staged starting positions, inputs and cameras. Traffic, mission logic, police and collisions run during capture.'},indent=2))
print(DEST)
