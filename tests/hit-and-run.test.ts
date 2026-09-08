import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HitAndRun,HIT_RUN_RULES,pursuitSettings,type PursuitSnapshot } from '../src/hit-and-run.ts';
import type { Command } from '../src/campaign/types.ts';
const cmd=(op:string,...args:(number|string)[]):Command=>({op,args,line:0});
const settings=pursuitSettings([cmd('SetHitAndRunDecay',3),cmd('SetNumChaseCars','1')]);
const clear:PursuitSnapshot={onFoot:false,speedKmh:40,interior:false,chasers:0,nearestChaser:Infinity};
function advance(model:HitAndRun,seconds:number,snapshot=clear){for(let i=0;i<Math.round(seconds*60);i++)model.update(1/60,snapshot);}

test('native crime amounts, quiet period and collision throttle are independent of damage',()=>{
  const model=new HitAndRun(settings);
  assert(model.offense('vehicleHit'));assert.equal(model.heat,5);
  assert(!model.offense('vehicleHit'));advance(model,1.6);assert.equal(model.heat,5);
  assert(model.offense('vehicleHit'));assert.equal(model.heat,10);
  advance(model,3.1);assert(model.heat<10&&model.heat>9.5);
  const before=model.heat;model.offense('pedestrianKicked');assert.equal(model.heat,before+13);
  assert.equal(model.offense('propDestroyed',true),false);
});
test('pursuit starts at 100 and stays latched until heat drops below 5',()=>{
  const model=new HitAndRun(settings);model.setHeat(78);model.update(0,clear);assert(model.drain().some(e=>e.type==='warning'));
  model.setHeat(99);model.update(0,clear);assert(!model.requested);
  model.setHeat(100);model.update(0,clear);assert(model.requested);assert(model.drain().some(e=>e.type==='started'));
  model.setHeat(5);model.update(0,clear);assert(model.requested);
  model.setHeat(4.9);model.update(0,clear);assert(!model.requested);
});
test('normal, pursuit and interior decay use distinct native rates',()=>{
  const model=new HitAndRun(settings);model.setHeat(50);advance(model,1);assert(Math.abs(model.heat-47)<1e-6);
  model.setHeat(100);advance(model,1);assert(Math.abs(model.heat-94)<1e-6);
  advance(model,1,{...clear,interior:true});assert(Math.abs(model.heat-84)<1e-6);
});
test('busting requires continuous proximity below 30 km/h and uses a longer on-foot timer',()=>{
  for(const onFoot of [false,true]){
    const model=new HitAndRun(settings),near={...clear,onFoot,speedKmh:0,chasers:1,nearestChaser:5};
    model.setHeat(100);advance(model,.5,near);assert(model.catching);
    model.update(1/60,{...near,nearestChaser:11});assert.equal(model.catchTime,0);
    const duration=onFoot?1.5:.75;advance(model,duration-1/60,near);assert(!model.drain().some(e=>e.type==='busted'));
    model.update(1/60,near);assert.deepEqual(model.drain(),[{type:'busted',coins:50}]);assert.equal(model.heat,0);assert(!model.latched);
  }
  const fast=new HitAndRun(settings);fast.setHeat(100);advance(fast,3,{...clear,chasers:1,nearestChaser:5,speedKmh:30});assert(!fast.drain().some(e=>e.type==='busted'));
});
test('interiors block capture and pursuit clears after its remaining cars leave',()=>{
  const model=new HitAndRun(settings);model.setHeat(100);advance(model,3,{...clear,chasers:1,nearestChaser:1,interior:true});
  assert(!model.drain().some(e=>e.type==='busted'));assert.equal(model.catchTime,0);
  model.setHeat(0);model.update(0,{...clear,chasers:1});assert(model.active);
  model.update(0,clear);assert.deepEqual(model.drain(),[{type:'escaped'}]);
});
test('switching vehicles clears heat once; scripted disabling resets and blocks offenses',()=>{
  const model=new HitAndRun(settings);model.enterVehicle('family-1');model.setHeat(70);model.enterVehicle('family-1');assert.equal(model.heat,70);
  model.enterVehicle('police-1');assert.equal(model.heat,0);
  model.setHeat(100);model.command(cmd('DisableHitAndRun'));assert.equal(model.heat,0);assert(!model.offense('vehicleHit'));
  model.command(cmd('EnableHitAndRun'));assert(model.offense('vehicleHit'));
  model.command(cmd('SetNumChaseCars',99));assert.equal(model.chaseCars,HIT_RUN_RULES.poolSize);
});
test('level scripts select the original police population and Halloween hearse',()=>{
  assert.deepEqual(pursuitSettings([cmd('CreateChaseManager','cHears','Pursuit\\L7cop.con',1),cmd('SetHitAndRunDecay',1),cmd('SetNumChaseCars','2')]),{vehicle:'chears',tuning:'pursuit/l7cop.con',decay:1,cars:2});
});
