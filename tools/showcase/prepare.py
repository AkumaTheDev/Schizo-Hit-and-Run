"""Create an isolated, instrumented capture copy without editing the game checkout."""
from pathlib import Path
import subprocess,tarfile,io,shutil,json
ROOT=Path(__file__).resolve().parents[2]
DEST=ROOT/'artifacts/showcase/capture'
DEST.mkdir(parents=True,exist_ok=True)
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
archive=subprocess.check_output(['git','archive',revision,'src','index.html','package.json','package-lock.json','tsconfig.json'],cwd=ROOT)
with tarfile.open(fileobj=io.BytesIO(archive)) as data:data.extractall(DEST,filter='data')
for name in ['node_modules','public']:
 link=DEST/name
 if not link.exists():link.symlink_to(ROOT/name,target_is_directory=True)
shutil.copyfile(ROOT/'tools/showcase/director.ts',DEST/'src/showcase-director.ts')
source=(DEST/'src/main.ts').read_text()
source="import { installDirector } from './showcase-director';\n"+source
source=source.replace("antialias:true,powerPreference:","antialias:true,preserveDrawingBuffer:true,powerPreference:")
source=source.replace('function updateCamera(dt:number,snap=false){', 'let director:ReturnType<typeof installDirector>|undefined;\nfunction updateCamera(dt:number,snap=false){')
source=source.replace('function animate(now:number){','function animate(now:number){\n  if(director?.waiting)return;')
source=source.replace('dt=Math.min(frameMs/1000,0.08)', 'dt=director?.recording?1/30:Math.min(frameMs/1000,0.08)')
source=source.replace('const controls=input.controls;', 'const controls=director?.controls()??input.controls;')
source=source.replace('if(time>kickUntil)character?.play(', 'if(!director?.active&&time>kickUntil)character?.play(')
source=source.replace('campaign?.update(fixed);','if(!director?.active)campaign?.update(fixed);')
source=source.replace('renderer.info.reset();','director?.camera();\n  renderer.info.reset();')
source=source.replace('}else if(highQuality)composer.render();else renderer.render(scene,camera);','}else if(highQuality)composer.render();else renderer.render(scene,camera);\n  void director?.afterFrame();')
source+='''
director=installDirector({
  renderer,camera,nativeHUD,ready:()=>!loading,world:()=>world,player:()=>state,
  async setup(shot){
    campaign?.dispose();campaign=undefined;nativeHUD.campaign=null;
    if(level!==shot.level)await loadLevel(shot.level);else world.leaveInterior();
    await setCar(shot.car);state.damage=0;respawn(shot.location??0);if(shot.id==='springfield-hero')placePlayer([215.1,3.45,172.8],Math.PI,false);
    world.setLighting(shot.light??(shot.level===7?'night':'golden'));renderer.toneMappingExposure=shot.level===7?1.5:1.13;
    if(shot.mode==='people'||shot.mode==='interior'){
      const p=newProgress();p.mission=shot.mode==='people'?'m1':'m0';p.phase=shot.mode==='people'?'intro':'main';p.stage=shot.mode==='people'?2:3;p.checkpoint={phase:p.phase,stage:p.stage};await startCampaign(p);campaign!.presentation.stop();
      if(shot.mode==='interior'){await world.enterInterior('l1i01');campaign!.interior='KwikEMart';placePlayer([499.4,-19.94,300.0],Math.PI/2,true);}
      else placePlayer([221.83,3.48,177.0],-Math.PI/2,true);
      character?.play('hom_loco_idle_rest');
    }
    if(traffic)traffic.limit=0;input.clear();pause(false);element('hud').hidden=true;nativeHUD.canvas.style.opacity='0';
    renderer.setPixelRatio(1);renderer.setSize(1920,1080);composer.setSize(1920,1080);camera.aspect=16/9;camera.updateProjectionMatrix();
  }
});
'''
(DEST/'src/main.ts').write_text(source)
ui=DEST/'src/original-ui.ts'
ui.write_text(ui.read_text().replace('width=innerWidth,height=innerHeight','width=1920,height=1080'))
config='''import {defineConfig} from 'vite';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const output=OUTPUT;
export default defineConfig({server:{host:'127.0.0.1',port:5177,strictPort:true,fs:{allow:[ROOT]}},plugins:[{name:'showcase-capture',configureServer(server){server.middlewares.use('/__capture',async(req,res)=>{try{if(req.method!=='POST'){res.statusCode=405;res.end();return;}const url=new URL(req.url,'http://127.0.0.1:5177'),shot=url.searchParams.get('shot'),frame=url.searchParams.get('frame');if(!/^[a-z0-9_-]+$/.test(shot??'')||!/^\\d{4}$/.test(frame??''))throw new Error('Invalid capture name');const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>20000000)throw new Error('Frame too large');chunks.push(chunk);}await mkdir(path.join(output,shot),{recursive:true});await writeFile(path.join(output,shot,frame+'.jpg'),Buffer.concat(chunks));res.end('OK');}catch(error){res.statusCode=500;res.end(String(error));}});}}]});
'''.replace('OUTPUT',json.dumps(str(ROOT/'artifacts/showcase/raw'))).replace('ROOT',json.dumps(str(ROOT)))
(DEST/'vite.config.ts').write_text(config)
(ROOT/'artifacts/showcase/source.json').write_text(json.dumps({'revision':revision,'capture':'Direct web-renderer frames; staged cameras; gameplay driving physics.'},indent=2))
print(DEST)
