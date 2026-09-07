import {all,arg,distance,key,type Chapter,type Effect,type Mission,type ObjectiveType,type PrepareReason,type Progress,type Reward,type Snapshot,type Stage,type Vec3} from './types';
export const OBJECTIVES:ObjectiveType[]=['goto','getin','talkto','dialogue','interior','gooutside','race','follow','losetail','delivery','dump','destroy','pickupitem','destroyboss','timer','fmv','buycar','buyskin','coins'];
export const CONDITIONS=['timeout','outofvehicle','damage','position','race','followdistance','keepbarrel'];
export function newProgress():Progress{return {version:2,level:1,mission:'m0',phase:'intro',stage:0,checkpoint:{phase:'intro',stage:0},completed:[],money:0,cars:['famil_v'],skins:['homer'],equippedSkin:null,coins:{},finished:false};}
export function validateProgress(value:unknown):value is Progress{
  if(!value||typeof value!=='object')return false;const p=value as Progress;
  return p.version===2&&Number.isInteger(p.level)&&p.level>=1&&p.level<=7&&typeof p.mission==='string'&&['intro','main'].includes(p.phase)&&Number.isInteger(p.stage)&&p.stage>=0&&Number.isFinite(p.money)&&p.money>=0&&Array.isArray(p.completed)&&p.completed.every(x=>typeof x==='string')&&Array.isArray(p.cars)&&p.cars.every(x=>typeof x==='string')&&Array.isArray(p.skins)&&p.skins.every(x=>typeof x==='string')&&!!p.coins&&typeof p.coins==='object'&&Object.values(p.coins).every(v=>Array.isArray(v)&&v.every(n=>Number.isInteger(n)&&n>=0))&&!!p.checkpoint&&['intro','main'].includes(p.checkpoint.phase)&&Number.isInteger(p.checkpoint.stage)&&p.checkpoint.stage>=0;
}
export class CampaignEngine {
  status:'idle'|'loading'|'running'|'between-stages'|'mission-complete'|'failed'|'complete'='idle';
  mission!:Mission;stage!:Stage;effects:Effect[]=[];elapsed=0;remaining:number|null=null;countdown=0;collected=new Set<number>();released=new Map<number,Vec3>();failure='';cargo:string|null=null;lastTalkTarget='';
  private delay=0;private outTime=0;private followTime=0;private escapeTime=0;private hitCooldown=0;private targetValue='';private expectedDrops:number[]=[];
  constructor(public chapter:Chapter,public progress:Progress,public rewards:Reward[]=[]){
    for(const mission of chapter.missions)for(const part of [mission.intro,mission])if(part)for(const stage of part.stages){
      if(!OBJECTIVES.includes(stage.objective.type))throw new Error(`Unsupported objective ${stage.objective.type}`);
      for(const c of stage.conditions)if(!CONDITIONS.includes(c.type))throw new Error(`Unsupported condition ${c.type}`);
    }
  }
  get phase(){return this.progress.phase==='intro'&&this.mission.intro?this.mission.intro:this.mission;}
  get missionKey(){return `${this.chapter.id}:${this.mission?.id}`;}
  get objective(){return this.stage?.objective.type;}
  get items(){const items=all(this.stage.commands,'AddCollectible'),laps=this.objective==='race'?Math.max(1,Number(arg(this.stage.commands,'SetRaceLaps',[1])[0])):1;return Array.from({length:laps},()=>items).flat();}
  get target(){return this.targetValue;}
  locator(name:unknown):Vec3|undefined{return this.chapter.locators[key(name)]?.position;}
  start(id:string,reason:PrepareReason='new',restore=false){
    const mission=this.chapter.missions.find(m=>m.id===id);if(!mission)throw new Error(`Unknown mission ${this.chapter.id}:${id}`);
    if(mission.optional&&this.mission&&!this.mission.optional)this.progress.story={mission:this.mission.id,checkpoint:structuredClone(this.progress.checkpoint)};
    this.mission=mission;this.progress.level=this.chapter.id;this.progress.mission=id;this.remaining=null;this.cargo=null;this.failure='';
    if(!restore){this.progress.phase=mission.intro?.stages.length?'intro':'main';this.progress.stage=0;this.progress.checkpoint={phase:this.progress.phase,stage:0};}
    else{this.progress.phase=this.progress.checkpoint.phase;this.progress.stage=this.progress.checkpoint.stage;}
    if(!this.phase.stages[this.progress.stage]){this.progress.stage=0;this.progress.phase=mission.intro?.stages.length?'intro':'main';}
    this.enter(reason);
  }
  private enter(reason:PrepareReason){
    this.stage=this.phase.stages[this.progress.stage];if(!this.stage)throw new Error('Mission stage is absent');
    this.status='loading';this.elapsed=0;this.outTime=0;this.followTime=0;this.escapeTime=0;this.hitCooldown=0;this.collected.clear();this.released.clear();
    this.expectedDrops=all(this.stage.commands,'BindCollectibleTo').map(a=>Number(a[1]));
    this.countdown=all(this.stage.commands,'AddToCountdownSequence').reduce((sum,a)=>sum+Number(a[1]??0)/1000,0);
    const setting=arg(this.stage.commands,'SetStageTime');if(setting.length)this.remaining=Math.max(0,Number(setting[0]));
    if(this.stage.commands.some(c=>c.op==='UseElapsedTime'))this.remaining=Number(arg(this.stage.commands,'SetParTime',[120])[0]);
    const addition=arg(this.stage.commands,'AddStageTime');if(addition.length)this.remaining=(this.remaining??0)+Number(addition[0]);
    this.targetValue=key(arg(this.stage.commands,'SetObjTargetVehicle',arg(this.stage.commands,'SetTalkToTarget',arg(this.stage.commands,'SetPickupTarget',arg(this.stage.commands,'SetObjTargetBoss'))))[0]);
    if(reason==='load'||reason==='checkpoint'){this.remaining=this.progress.checkpoint.remaining??this.remaining;this.cargo=this.progress.checkpoint.cargo??null;}
    if(this.stage.checkpoint&&reason!=='load'&&reason!=='checkpoint')this.progress.checkpoint={phase:this.progress.phase,stage:this.progress.stage,remaining:this.remaining,cargo:this.cargo};
    const replay=(reason==='load'||reason==='checkpoint')?this.phase.stages.slice(0,this.progress.stage).flatMap(s=>s.commands):[];
    this.effects.push({type:'prepare',reason,setup:this.phase.setup,commands:this.stage.commands,replay});
  }
  ready(){if(this.status==='loading')this.status='running';}
  drain(){const effects=this.effects;this.effects=[];return effects;}
  targetEntity(snapshot:Snapshot,name=this.targetValue){return name==='current'||name==='default'||!name?{id:snapshot.vehicle,health:snapshot.health,position:snapshot.onFoot?(snapshot.parkedPosition??snapshot.position):snapshot.position}:snapshot.entities[key(name)]??(key(snapshot.vehicle)===key(name)?{id:snapshot.vehicle,health:snapshot.health,position:snapshot.position}:undefined);}
  navTarget(snapshot:Snapshot):Vec3|undefined{
    const type=this.objective;
    if(type==='getin')return this.targetEntity(snapshot)?.position;
    if(type==='goto')return this.locator(arg(this.stage.commands,'SetDestination')[0]);
    if(type==='interior'){
      const dest=key(arg(this.stage.commands,'SetDestination')[0]);return Object.values(this.chapter.locators).find(l=>key(l.interior)===dest)?.position;
    }
    if(type==='gooutside')return this.chapter.interiors.find(i=>key(i.name)===key(snapshot.interior))?.exit?.position;
    if(type==='talkto')return snapshot.entities[this.targetValue]?.position;
    if(type==='buycar'||type==='buyskin')return snapshot.entities[this.lastTalkTarget]?.position;
    if(['follow','losetail','destroy'].includes(type))return this.targetEntity(snapshot)?.position;
    if(type==='pickupitem'){const definitions=all([...this.mission.setup,...this.stage.commands],'AddCollectibleStateProp');return this.locator(definitions.find(a=>key(a[0])===this.targetValue)?.[1]);}
    if(type==='destroyboss')return Object.values(this.chapter.locators).find(l=>l.name.toLowerCase().includes('ufo')&&l.kind===2)?.position??this.locator('m2_playground');
    const index=this.items.findIndex((_,i)=>!this.collected.has(i));
    if(index>=0)return this.released.get(index)??snapshot.collectibles?.[index]??this.locator(this.items[index][0]);
    return undefined;
  }
  fail(message:string){if(this.status!=='running')return;this.failure=message;this.status='failed';this.effects.push({type:'failed',message});}
  retry(fromStart=false){
    if(fromStart){this.progress.phase=this.mission.intro?.stages.length?'intro':'main';this.progress.stage=0;this.progress.checkpoint={phase:this.progress.phase,stage:0};}
    else{this.progress.phase=this.progress.checkpoint.phase;this.progress.stage=this.progress.checkpoint.stage;}
    this.remaining=null;this.cargo=null;this.failure='';this.enter('checkpoint');
  }
  private completeStage(){
    this.status='between-stages';this.delay=this.stage.commands.some(c=>c.op==='ShowStageComplete')?.8:.2;
    this.effects.push({type:'stage-complete',title:this.stage.message??''});
  }
  private advance(){
    if(this.progress.stage+1<this.phase.stages.length){this.progress.stage++;this.enter('advance');return;}
    if(this.progress.phase==='intro'){this.progress.phase='main';this.progress.stage=0;this.progress.checkpoint={phase:'main',stage:0};this.enter('main');return;}
    if(!this.progress.completed.includes(this.missionKey))this.progress.completed.push(this.missionKey);
    if(this.mission.optional){
      const quest=this.mission.id==='bm1'?'bonusmission':this.mission.id.startsWith('sr')&&['sr1','sr2','sr3'].every(id=>this.progress.completed.includes(`${this.chapter.id}:${id}`))?'streetrace':'';
      for(const reward of this.rewards.filter(r=>r.level===this.chapter.id&&r.quest===quest)){const owned=reward.type==='car'?this.progress.cars:this.progress.skins;if(!owned.includes(reward.id))owned.push(reward.id);}
      if(this.mission.id==='gr1')this.earn(Number(arg(this.stage.commands,'SetRaceEnteryFee',[20])[0])*2);
    }
    this.status='mission-complete';this.delay=this.mission.transition?.2:3;this.effects.push({type:'mission-complete',title:this.mission.title});
  }
  private nextMission(){
    if(this.mission.optional){const story=this.progress.story;this.progress.story=undefined;if(story){this.progress.checkpoint=story.checkpoint;this.start(story.mission,'load',true);}else this.start(this.chapter.missions.find(m=>!m.optional)!.id,'new');return;}
    const missions=this.chapter.missions.filter(m=>!m.optional),index=missions.indexOf(this.mission);
    if(index+1<missions.length){this.start(missions[index+1].id,'advance');return;}
    if(this.chapter.id===7){this.progress.finished=true;this.status='complete';this.effects.push({type:'campaign-complete'});}
    else{this.status='loading';this.effects.push({type:'chapter-complete',nextLevel:this.chapter.id+1});}
  }
  earn(amount:number){if(Number.isFinite(amount)&&amount>0)this.progress.money+=Math.floor(amount);}
  purchase(id:string){
    const reward=this.rewards.find(r=>r.id===key(id)&&r.level===this.chapter.id&&r.quest==='forsale');
    if(!reward)return false;
    const owned=reward.type==='car'?this.progress.cars:this.progress.skins;if(owned.includes(reward.id))return true;if(reward.cost>this.progress.money)return false;
    this.progress.money-=reward.cost;owned.push(reward.id);if(reward.type==='skin')this.progress.equippedSkin=reward.id;this.effects.push({type:'purchase',reward});return true;
  }
  tick(dt:number,snapshot:Snapshot){
    if(this.status==='between-stages'){this.delay-=dt;if(this.delay<=0)this.advance();return;}
    if(this.status==='mission-complete'){this.delay-=dt;if(this.delay<=0)this.nextMission();return;}
    if(this.status!=='running')return;
    if(this.countdown>0){this.countdown=Math.max(0,this.countdown-dt);return;}
    this.elapsed+=dt;this.hitCooldown=Math.max(0,this.hitCooldown-dt);
    const type=this.objective,presentation=type==='dialogue'||type==='fmv';
    if(this.remaining!==null&&!presentation)this.remaining-=dt;
    if(snapshot.cargoLost)this.cargo=null;
    for(const condition of this.stage.conditions){
      const targetName=key(arg(condition.commands,'SetCondTargetVehicle')[0]);const entity=this.targetEntity(snapshot,targetName);
      if(condition.type==='timeout'&&this.remaining!==null&&this.remaining<=0){this.fail('TIME IS UP');return;}
      if(condition.type==='outofvehicle'){
        this.outTime=snapshot.onFoot?this.outTime+dt:0;
        if(this.outTime>=Number(arg(condition.commands,'SetCondTime',[10000])[0])/1000){this.fail('RETURN TO YOUR VEHICLE');return;}
      }
      if(condition.type==='damage'&&(targetName||arg(condition.commands,'SetCondMinHealth').length)&&entity&&entity.health<=Number(arg(condition.commands,'SetCondMinHealth',[0])[0])){this.fail('VEHICLE DESTROYED');return;}
      if(condition.type==='followdistance'&&entity){
        const bounds=arg(condition.commands,'SetFollowDistances',[0,150]),d=distance(snapshot.position,entity.position);
        this.followTime=d>Number(bounds[1])?this.followTime+dt:0;
        if(this.followTime>2){this.fail('YOU LOST YOUR TARGET');return;}
      }
      if(condition.type==='keepbarrel'&&!this.cargo&&type!=='pickupitem'&&!snapshot.bossHit){this.fail('YOU LOST THE NUCLEAR WASTE');return;}
      if(condition.type==='race'&&entity?.finished&&['race','dump','delivery','goto'].includes(type)){this.fail('YOUR TARGET GOT AWAY');return;}
      if(condition.type==='position'&&type==='race'){
        const limit=Number(arg(condition.commands,'SetConditionPosition',[1])[0]);const ahead=Object.values(snapshot.entities).filter(e=>e.finished).length;if(ahead>=limit){this.fail('YOU LOST THE RACE');return;}
      }
    }
    let complete=false;
    switch(type){
      case 'goto':{
        const target=this.navTarget(snapshot);const needsAction=this.stage.commands.some(c=>c.op==='MustActionTrigger');complete=!!target&&distance(snapshot.position,target)<(snapshot.onFoot?2.6:6.5)&&(!needsAction||!!snapshot.interact);break;
      }
      case 'coins':{const fee=Number(arg(this.stage.commands,'SetCoinFee',[0])[0]);if(snapshot.interact&&this.progress.money>=fee){this.progress.money-=fee;complete=true;}break;}
      case 'getin':complete=!snapshot.onFoot&&(!this.targetValue||this.targetValue==='current'||this.targetValue==='default'||key(snapshot.vehicle)===this.targetValue);break;
      case 'talkto':{
        const target=snapshot.entities[this.targetValue];const args=arg(this.stage.commands,'SetTalkToTarget');const radius=Number(args[3]??3.5);
        complete=!!snapshot.interact&&snapshot.onFoot&&!!target&&distance(snapshot.position,target.position)<radius+1;
        if(complete)this.lastTalkTarget=this.targetValue;break;
      }
      case 'dialogue':complete=!!snapshot.dialogueDone;break;
      case 'fmv':complete=!!snapshot.movieDone;break;
      case 'timer':complete=this.elapsed>=Number(arg(this.stage.commands,'SetDurationTime',[1])[0]);break;
      case 'interior':complete=key(snapshot.interior)===key(arg(this.stage.commands,'SetDestination')[0]);break;
      case 'gooutside':complete=snapshot.interior===null;break;
      case 'follow':{
        const entity=this.targetEntity(snapshot);complete=!!entity?.finished&&distance(snapshot.position,entity.position)<Number(arg(this.stage.commands,'SetObjDistance',[70])[0]);break;
      }
      case 'losetail':{
        const entity=this.targetEntity(snapshot),range=Number(arg(this.stage.commands,'SetObjDistance',[150])[0]);this.escapeTime=entity&&distance(snapshot.position,entity.position)>range?this.escapeTime+dt:0;complete=this.escapeTime>=2;break;
      }
      case 'destroy':{
        const entity=this.targetEntity(snapshot);complete=!!entity&&entity.health<=0;break;
      }
      case 'pickupitem':{
        const target=this.navTarget(snapshot);complete=!snapshot.onFoot&&!!target&&distance(snapshot.position,target)<5;if(complete)this.cargo=this.targetValue;break;
      }
      case 'destroyboss':complete=!!snapshot.bossHit;if(complete)this.cargo=null;break;
      case 'buycar':case 'buyskin':{
        const id=key(this.stage.objective.mode);complete=(type==='buycar'?this.progress.cars:this.progress.skins).includes(id);break;
      }
      case 'race':case 'delivery':case 'dump':{
        const bindings=all(this.stage.commands,'BindCollectibleTo');
        if(type==='dump'&&bindings.length){
          const entity=this.targetEntity(snapshot);
          if(entity&&distance(snapshot.position,entity.position)>200){this.fail('YOU LOST YOUR TARGET');return;}
          for(const [item,waypoint] of bindings){const index=Number(item);if(entity&&(entity.waypoint??0)>Number(waypoint)&&!this.released.has(index)){const position=[...entity.position] as Vec3;this.released.set(index,position);this.effects.push({type:'drop',index,position});}}
        }
        if(type==='dump'&&!bindings.length&&snapshot.hitVehicle&&key(snapshot.hitVehicle)===this.targetValue&&this.hitCooldown<=0){
          const index=this.items.findIndex((_,i)=>!this.released.has(i)&&!this.collected.has(i));const entity=this.targetEntity(snapshot);
          if(index>=0&&entity){const position:[number,number,number]=[entity.position[0],entity.position[1],entity.position[2]];this.released.set(index,position);this.effects.push({type:'drop',index,position});this.hitCooldown=1.5;}
        }
        for(let i=0;i<this.items.length;i++){
          if(this.collected.has(i))continue;
          if(type==='race'&&i!==this.collected.size)continue;
          if(type==='dump'&&!this.released.has(i))continue;
          if(type==='delivery'&&this.items[i].length===1&&!snapshot.brokenCollectibles?.includes(i))continue;
          const position=this.released.get(i)??snapshot.collectibles?.[i]??this.locator(this.items[i][0]);
          if(position&&distance(snapshot.position,position)<(snapshot.onFoot?2.6:5.5)){this.collected.add(i);this.effects.push({type:'collect',index:i});}
        }
        complete=this.items.length>0&&this.collected.size===this.items.length;break;
      }
    }
    if(complete)this.completeStage();
  }
}
