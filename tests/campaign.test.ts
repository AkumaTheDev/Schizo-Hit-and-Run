import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CampaignEngine,newProgress,validateProgress} from '../src/campaign/engine.ts';
import type {Chapter,Command,Mission,Snapshot,Stage,Reward} from '../src/campaign/types.ts';
const command=(op:string,...args:(string|number)[]):Command=>({op,args,line:1});
const stage=(type:Stage['objective']['type'],commands:Command[]=[],extra:Partial<Stage>={}):Stage=>({index:0,args:[],commands,objective:{type,mode:''},conditions:[],checkpoint:false,...extra});
const mission=(stages:Stage[]):Mission=>({id:'m0',level:1,title:'Test mission',setup:[],stages:stages.map((s,i)=>({...s,index:i})),intro:null,load:[],introLoad:[],transition:false,source:'synthetic'});
const chapter=(stages:Stage[]):Chapter=>({id:1,initial:[],schedule:[],missions:[mission(stages)],locators:{a:{name:'a',position:[0,0,10],kind:0,source:'synthetic'},b:{name:'b',position:[0,0,20],kind:0,source:'synthetic'}},interiors:[]});
const snapshot=(partial:Partial<Snapshot>={}):Snapshot=>({position:[0,0,0],onFoot:false,vehicle:'famil_v',health:1,interior:null,entities:{},...partial});
function run(stages:Stage[],rewards:Reward[]=[]){const engine=new CampaignEngine(chapter(stages),newProgress(),rewards);engine.start('m0');engine.drain();engine.ready();return engine;}
test('talk requires an on-foot interaction near the original target',()=>{
  const engine=run([stage('talkto',[command('SetTalkToTarget','marge',0,0,3)])]),base={entities:{marge:{id:'marge',position:[0,0,2] as [number,number,number],health:1}}};
  engine.tick(.1,snapshot({...base,interact:true}));assert.equal(engine.status,'running');
  engine.tick(.1,snapshot({...base,onFoot:true}));assert.equal(engine.status,'running');
  engine.tick(.1,snapshot({...base,onFoot:true,interact:true}));assert.equal(engine.status,'between-stages');
});
test('dialogue and FMV stages wait for playback completion',()=>{
  for(const type of ['dialogue','fmv'] as const){const engine=run([stage(type)]);engine.tick(200,snapshot());assert.equal(engine.status,'running');engine.tick(.1,snapshot(type==='fmv'?{movieDone:true}:{dialogueDone:true}));assert.equal(engine.status,'between-stages');}
});
test('race checkpoints must be collected in order',()=>{
  const engine=run([stage('race',[command('AddCollectible','a','carsphere'),command('AddCollectible','b','carsphere')])]);
  engine.tick(.1,snapshot({position:[0,0,20]}));assert.equal(engine.collected.size,0);
  engine.tick(.1,snapshot({position:[0,0,10]}));assert.equal(engine.collected.size,1);
  engine.tick(.1,snapshot({position:[0,0,20]}));assert.equal(engine.status,'between-stages');
});
test('a timed stage fails and retries its checkpoint',()=>{
  const engine=run([stage('goto',[command('SetDestination','a'),command('SetStageTime',2)],{checkpoint:true,conditions:[{type:'timeout',args:[],commands:[]}]})]);
  engine.tick(2.1,snapshot());assert.equal(engine.status,'failed');assert.equal(engine.failure,'TIME IS UP');
  engine.retry();assert.equal(engine.status,'loading');assert.equal(engine.remaining,2);engine.ready();engine.tick(.1,snapshot({position:[0,0,10]}));assert.equal(engine.status,'between-stages');
});
test('a ram drops one collectible and cannot release another during cooldown',()=>{
  const engine=run([stage('dump',[command('SetObjTargetVehicle','van'),command('AddCollectible','a','cola'),command('AddCollectible','b','cola')])]);
  const state=snapshot({hitVehicle:'van',entities:{van:{id:'van',position:[0,0,50],health:1}}});engine.tick(.1,state);assert.equal(engine.released.size,1);engine.tick(.1,state);assert.equal(engine.released.size,1);
});
test('bound dump items drop at waypoints and do not respond to ramming',()=>{
  const engine=run([stage('dump',[command('SetObjTargetVehicle','van'),command('AddCollectible','a','cola'),command('BindCollectibleTo',0,1)])]);
  const state=snapshot({hitVehicle:'van',entities:{van:{id:'van',position:[0,0,50],health:1,waypoint:0}}});engine.tick(.1,state);assert.equal(engine.released.size,0);
  state.entities.van.waypoint=2;engine.tick(.1,state);assert.equal(engine.released.size,1);assert.deepEqual(engine.released.get(0),[0,0,50]);
});
test('destructible mission targets need a hit event instead of proximity alone',()=>{
  const engine=run([stage('delivery',[command('AddCollectible','a')])]);engine.tick(.1,snapshot({position:[0,0,10]}));assert.equal(engine.collected.size,0);
  engine.tick(.1,snapshot({position:[0,0,10],brokenCollectibles:[0]}));assert.equal(engine.status,'between-stages');
});
test('purchases use original reward costs and cannot charge twice',()=>{
  const rewards:Reward[]=[{id:'l_cool',path:'',type:'skin',quest:'forsale',level:1,cost:250,seller:''}];const engine=run([stage('buyskin',[],{objective:{type:'buyskin',mode:'l_cool'}})],rewards);
  assert.equal(engine.purchase('l_cool'),false);engine.earn(300);assert.equal(engine.purchase('l_cool'),true);assert.equal(engine.progress.money,50);
  assert.equal(engine.purchase('l_cool'),true);assert.equal(engine.progress.money,50);engine.tick(.1,snapshot());assert.equal(engine.status,'between-stages');
});
test('an intro advances into the mission without resetting the player',()=>{
  const data=chapter([stage('getin',[command('SetObjTargetVehicle','current')])]);data.missions[0].intro=mission([stage('dialogue')]);const engine=new CampaignEngine(data,newProgress());engine.start('m0');engine.drain();engine.ready();engine.tick(.1,snapshot({dialogueDone:true}));engine.drain();engine.tick(.3,snapshot());
  assert.equal(engine.progress.phase,'main');const prepare=engine.drain().find(e=>e.type==='prepare');assert.equal(prepare?.type,'prepare');if(prepare?.type==='prepare')assert.equal(prepare.reason,'main');
});
test('malformed saves and unknown objective types fail closed',()=>{
  assert(validateProgress(newProgress()));assert(!validateProgress({...newProgress(),money:-1}));assert(!validateProgress({...newProgress(),level:8}));assert(!validateProgress({...newProgress(),coins:{1:[-1]}}));
  const data=chapter([stage('goto')]);data.missions[0].stages[0].objective.type='unknown' as any;assert.throws(()=>new CampaignEngine(data,newProgress()),/Unsupported objective/);
});
test('the final mission advances to the next chapter only after completion',()=>{
  const engine=run([stage('timer',[command('SetDurationTime',.1)])]);engine.tick(.2,snapshot());engine.tick(.3,snapshot());assert.equal(engine.status,'mission-complete');assert(engine.progress.completed.includes('1:m0'));engine.tick(3.1,snapshot());assert(engine.drain().some(e=>e.type==='chapter-complete'&&e.nextLevel===2));
});
test('getting back into the current vehicle uses its parked location for navigation',()=>{
  const engine=run([stage('getin',[command('SetObjTargetVehicle','current')])]);const state=snapshot({onFoot:true,position:[0,0,0],parkedPosition:[10,0,10]});assert.deepEqual(engine.navTarget(state),[10,0,10]);engine.tick(.1,state);assert.equal(engine.status,'running');state.onFoot=false;engine.tick(.1,state);assert.equal(engine.status,'between-stages');
});

test('race checkpoints without model names do not require a destruction event',()=>{
  const engine=run([stage('race',[command('AddCollectible','a')])]);engine.tick(.1,snapshot({position:[0,0,10]}));assert.equal(engine.status,'between-stages');
});
test('loading resumes the saved checkpoint and its inherited timer',()=>{
  const data=chapter([stage('getin'),stage('goto',[command('SetDestination','a')]),stage('goto',[command('SetDestination','b')])]);
  const progress=newProgress();progress.phase='main';progress.stage=2;progress.checkpoint={phase:'main',stage:1,remaining:37};
  const engine=new CampaignEngine(data,progress);engine.start('m0','load',true);assert.equal(engine.progress.stage,1);assert.equal(engine.remaining,37);engine.ready();engine.tick(38,snapshot());engine.retry();assert.equal(engine.remaining,37);
});

test('a circuit requires every lap and only charges a wager entry once',()=>{
  const race=run([stage('race',[command('SetRaceLaps',2),command('AddCollectible','a'),command('AddCollectible','b')])]);
  race.tick(.1,snapshot({position:[0,0,10]}));race.tick(.1,snapshot({position:[0,0,20]}));assert.equal(race.status,'running');
  race.tick(.1,snapshot({position:[0,0,10]}));race.tick(.1,snapshot({position:[0,0,20]}));assert.equal(race.status,'between-stages');
  const wager=run([stage('coins',[command('SetCoinFee',20)])]);wager.earn(25);wager.tick(.1,snapshot());assert.equal(wager.progress.money,25);wager.tick(.1,snapshot({interact:true}));wager.tick(.1,snapshot({interact:true}));assert.equal(wager.progress.money,5);
});
test('bonus completion restores the story checkpoint and grants its original reward',()=>{
  const data=chapter([stage('goto',[command('SetDestination','a')])]);data.missions.push({...mission([stage('timer',[command('SetDurationTime',.1)])]),id:'bm1',optional:true});
  const rewards:Reward[]=[{id:'cletu_v',path:'',type:'car',quest:'bonusmission',level:1,cost:0,seller:''}],progress=newProgress(),engine=new CampaignEngine(data,progress,rewards);
  engine.start('m0');engine.drain();engine.ready();engine.start('bm1');engine.drain();engine.ready();engine.tick(.2,snapshot());engine.tick(.3,snapshot());assert(progress.cars.includes('cletu_v'));engine.tick(3.1,snapshot());assert.equal(progress.mission,'m0');assert.equal(progress.stage,0);assert.equal(progress.story,undefined);
});
