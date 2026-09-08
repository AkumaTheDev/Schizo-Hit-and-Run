import { arg, key, type Command } from './campaign/types';

// PAL SLES_518.97: constructor 0x250d68, events 0x251328, update 0x251c78.
export const HIT_RUN_RULES = {
  maxHeat: 100, releaseHeat: 5, warningHeat: Math.fround(.78)*100, warningResetHeat: 60,
  decay: 1, chaseDecay: 6, interiorDecay: 10,
  decayDelay: 3, chaseDecayDelay: 0, vehicleHitCooldown: 1.5,
  catchRadius: 10, catchSpeedKmh: 30, catchSeconds: .75,
  onFootCatchSeconds: 1.5, bustedCoins: 50, bustedSeconds: 1.5,
  spawnRadius: 100, removeRadius: 110, poolSize: 5,
} as const;

export const OFFENSE_HEAT = {
  vehicleHit: 5, vehicleDestroyed: 25, propDestroyed: 7.5,
  pedestrianHit: 10, pedestrianKicked: 13,
} as const;
export type Offense = keyof typeof OFFENSE_HEAT;
export type HitRunEvent = {type:'warning'|'started'|'escaped'} | {type:'busted';coins:number};
export interface PursuitSettings {vehicle:string;tuning:string;cars:number;decay:number}
export function pursuitSettings(commands:Command[]):PursuitSettings{
  const manager=arg(commands,'CreateChaseManager',['cpolice','pursuit/l1cop.con']);
  return {vehicle:key(manager[0]),tuning:key(manager[1]).replaceAll('\\','/'),cars:Number(arg(commands,'SetNumChaseCars',[1])[0]),decay:Number(arg(commands,'SetHitAndRunDecay',[HIT_RUN_RULES.decay])[0])};
}
export interface PursuitSnapshot {
  onFoot:boolean;speedKmh:number;interior:boolean;chasers:number;nearestChaser:number;
}

/** Native meter, pursuit latch and catch rules; vehicle navigation is separate. */
export class HitAndRun {
  heat=0;enabled=true;latched=false;active=false;bustedRemaining=0;
  catchTime=0;decay:number;chaseCars:number;
  private delay=0;private warningArmed=true;private enteredVehicle:string|null=null;
  private events:HitRunEvent[]=[];
  constructor(settings:PursuitSettings){this.decay=settings.decay;this.chaseCars=settings.cars;}
  get requested(){return this.enabled&&this.latched&&this.bustedRemaining===0;}
  get catching(){return this.catchTime>0;}
  reset(){
    this.heat=0;this.enabled=true;this.latched=false;this.active=false;
    this.bustedRemaining=0;this.catchTime=0;this.delay=0;this.warningArmed=true;this.events=[];
  }
  setHeat(value:number){if(Number.isFinite(value))this.heat=Math.max(0,Math.min(HIT_RUN_RULES.maxHeat,value));}
  offense(type:Offense,interior=false){
    if(!this.enabled||interior||this.bustedRemaining>0)return false;
    // Native event 0x60 is throttled against half the quiet-period delay. During
    // a pursuit that delay is zero; contact systems still emit discrete impacts.
    if(type==='vehicleHit'&&this.delay>(this.latched?0:HIT_RUN_RULES.vehicleHitCooldown))return false;
    this.delay=this.latched?HIT_RUN_RULES.chaseDecayDelay:HIT_RUN_RULES.decayDelay;
    this.setHeat(this.heat+OFFENSE_HEAT[type]);return true;
  }
  enterVehicle(identity:string){
    if(this.enteredVehicle===identity)return;
    this.enteredVehicle=identity;
    if(this.enabled&&this.bustedRemaining===0){this.setHeat(this.heat-100);this.delay=this.latched?0:HIT_RUN_RULES.decayDelay;}
  }
  command(command:Command){
    const value=Number(command.args[0]);
    switch(command.op){
      case 'ResetHitAndRun':case 'EnableHitAndRun':this.reset();return true;
      case 'DisableHitAndRun':this.reset();this.enabled=false;return true;
      case 'SetHitAndRunMeter':this.setHeat(value);return true;
      case 'SetHitAndRunDecay':if(Number.isFinite(value))this.decay=Math.max(0,value);return true;
      case 'SetNumChaseCars':if(Number.isFinite(value))this.chaseCars=Math.max(0,Math.min(HIT_RUN_RULES.poolSize,Math.floor(value)));return true;
      default:return false;
    }
  }
  update(dt:number,snapshot:PursuitSnapshot){
    if(!this.enabled)return;
    this.bustedRemaining=Math.max(0,this.bustedRemaining-dt);
    if(this.heat<HIT_RUN_RULES.releaseHeat)this.latched=false;
    if(this.heat<HIT_RUN_RULES.warningResetHeat)this.warningArmed=true;
    else if(this.warningArmed&&this.heat>HIT_RUN_RULES.warningHeat){this.warningArmed=false;this.events.push({type:'warning'});}
    if(!this.latched&&this.heat>=HIT_RUN_RULES.maxHeat){this.latched=true;this.events.push({type:'started'});}
    if(snapshot.chasers>0)this.active=true;
    if(this.active&&snapshot.chasers===0&&!this.latched){this.active=false;this.events.push({type:'escaped'});}
    const canCatch=this.active&&snapshot.chasers>0&&!snapshot.interior&&this.bustedRemaining===0&&
      snapshot.nearestChaser<HIT_RUN_RULES.catchRadius&&(snapshot.onFoot||snapshot.speedKmh<HIT_RUN_RULES.catchSpeedKmh);
    this.catchTime=canCatch?this.catchTime+dt:0;
    if(this.catchTime+1e-9>=(snapshot.onFoot?HIT_RUN_RULES.onFootCatchSeconds:HIT_RUN_RULES.catchSeconds)){
      this.heat=0;this.latched=false;this.active=false;this.catchTime=0;this.delay=0;
      this.bustedRemaining=HIT_RUN_RULES.bustedSeconds;this.events.push({type:'busted',coins:HIT_RUN_RULES.bustedCoins});
    }
    if(this.delay>0)this.delay=Math.max(0,this.delay-dt);
    else if(this.heat>0){
      const rate=snapshot.interior?HIT_RUN_RULES.interiorDecay:this.latched?HIT_RUN_RULES.chaseDecay:this.decay;
      this.heat=Math.max(0,this.heat-rate*dt);
    }
  }
  drain(){const result=this.events;this.events=[];return result;}
}
