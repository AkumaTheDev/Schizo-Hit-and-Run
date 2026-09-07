import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {CampaignEngine,newProgress} from '../src/campaign/engine.ts';
import {all,arg,key,type Chapter,type Mission,type Snapshot,type Vec3} from '../src/campaign/types.ts';
const root=resolve('public/assets'),json=(name:string)=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
for(let level=1;level<=7;level++)test(`campaign ${level}: original stages can complete with valid objective events`,()=>{
  const data=json(`campaign/level${level}.json`) as Chapter;
  for(const mission of data.missions)for(const phase of [mission.intro,mission])if(phase)for(const stage of phase.stages){
    const isolated={...mission,optional:false,intro:null,stages:[stage],setup:phase.setup} as Mission;
    const progress=newProgress();progress.money=10000;const engine=new CampaignEngine({...data,missions:[isolated]},progress);engine.start(mission.id);engine.drain();engine.ready();engine.countdown=0;engine.cargo='bombbarrel';
    const snapshot:Snapshot={position:[0,0,0],onFoot:false,vehicle:'famil_v',health:1,interior:null,entities:{},interact:true,dialogueDone:true,movieDone:true,bossHit:true};
    for(const command of [...phase.setup,...phase.stages.flatMap(s=>s.commands)])if(['AddStageVehicle','AddNPC'].includes(command.op)){
      const id=key(command.args[0]),position=data.locators[key(command.args[1])]?.position??[0,0,0];snapshot.entities[id]={id,position:[...position] as Vec3,health:1,finished:false,waypoint:0};
    }
    if(engine.target&&!snapshot.entities[engine.target])snapshot.entities[engine.target]={id:engine.target,position:[0,0,0],health:1};
    let inherited:number|null=null;for(const earlier of phase.stages.slice(0,stage.index+1)){const time=arg(earlier.commands,'SetStageTime');if(time.length)inherited=Number(time[0]);const addition=arg(earlier.commands,'AddStageTime');if(addition.length)inherited=(inherited??0)+Number(addition[0]);}if(inherited!==null&&!stage.commands.some(c=>c.op==='UseElapsedTime'))engine.remaining=inherited;
    const type=stage.objective.type;
    if(['talkto','interior','gooutside'].includes(type))snapshot.onFoot=true;
    if(type==='interior')snapshot.interior=String(arg(stage.commands,'SetDestination')[0]);
    if(type==='getin')snapshot.vehicle=['default','current',''].includes(engine.target)?'famil_v':engine.target;
    if(type==='buycar')progress.cars.push(key(stage.objective.mode));if(type==='buyskin')progress.skins.push(key(stage.objective.mode));
    if(type==='destroy')snapshot.entities[engine.target].health=0;if(type==='follow')snapshot.entities[engine.target].finished=true;
    if(type==='losetail')snapshot.entities[engine.target].position=[1000,0,0];
    if(type==='dump'){
      const target=snapshot.entities[engine.target];target.waypoint=1000;target.position=[0,0,0];snapshot.position=[0,0,0];
      for(let i=0;i<engine.items.length&&engine.status==='running';i++){snapshot.hitVehicle=engine.target;engine.tick(1.6,snapshot);}
    }else if(['race','delivery'].includes(type)){
      for(let i=0;i<engine.items.length;i++){const position=engine.locator(engine.items[i][0]);assert(position,`${level}:${mission.id}:${stage.index} has no collectible location`);snapshot.position=position;snapshot.brokenCollectibles=[i];engine.tick(.01,snapshot);}
    }else{
      const position=engine.navTarget(snapshot);if(['goto','talkto','pickupitem'].includes(type))assert(position,`${level}:${mission.id}:${stage.index} ${type} has no target`);
      if(position)snapshot.position=[...position] as Vec3;
      if(type==='losetail')snapshot.position=[0,0,0];
      engine.tick(type==='timer'?Number(arg(stage.commands,'SetDurationTime',[1])[0])+.01:type==='losetail'?2.1:.01,snapshot);
    }
    assert.equal(engine.status,'between-stages',`${level}:${mission.id}:${stage.index} ${type}: ${engine.failure}`);
  }
});
test('campaign resource references resolve to shipped assets',()=>{
  const assets=json('campaign/assets.json');
  for(const type of ['characters','cars','props'])for(const name of new Set<string>(Object.values(assets[type]))){assert(existsSync(resolve(root,`${name}.json`)),`${type}: ${name}`);assert(existsSync(resolve(root,`${name}.bin`)),`${type}: ${name} buffer`);}
  for(const clips of Object.values(assets.dialogue) as any[][])for(const clip of clips)assert(existsSync(resolve(root,clip.file)),clip.file);
  for(const path of Object.values(assets.presentations) as string[])assert(existsSync(resolve(root,path)),path);
  for(let level=1;level<=7;level++)for(const mission of (json(`campaign/level${level}.json`) as Chapter).missions)for(const phase of [mission.intro,mission])if(phase)for(const stage of phase.stages){
    const info=arg(stage.commands,'SetDialogueInfo');if(info.length){const clips=assets.dialogue[`${level}:${key(info[2])}`]??[];assert(clips.some((c:any)=>!c.mission||c.mission===mission.id),`${level}:${mission.id}:${info[2]} has no dialogue`);}
  }
});
test('all remastered scenes preserve collision bytes and valid geometry spans',()=>{
  const scenery=json('remaster/scenery.json');assert.equal(scenery.scenes.length,100);
  for(const scene of scenery.scenes){
    const source=json(`${scene}.json`),meta=json(`remaster/scenes/${scene}.json`),before=readFileSync(resolve(root,`${scene}.bin`)),after=readFileSync(resolve(root,`remaster/scenes/${scene}.bin`));
    if(source.collision){const [offset,n]=source.collision,[newOffset,newN]=meta.collision;assert.equal(n,newN);assert(before.subarray(offset,offset+n*4).equals(after.subarray(newOffset,newOffset+newN*4)),`${scene} collision changed`);}
    for(const parts of Object.values(meta.meshes) as any[][])for(const part of parts)for(const [offset,n] of Object.values(part.attributes) as [number,number][]){assert(offset%4===0&&offset+n*4<=after.length,`${scene} invalid geometry buffer`);}
  }
  const powerboxes=json('remaster/scenes/l1z6.json').objects.filter((o:any)=>/^powerbox[1-9]$/.test(o.name));assert.equal(powerboxes.length,9);
});
