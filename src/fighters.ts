/**
 * The roster.
 *
 * A platform fighter is its cast: everyone runs the same code and still plays
 * differently, because the numbers under each body differ. So the numbers here are not
 * invented. Every shipped VRM was loaded head-on, stood in its own rest pose and
 * measured — how tall it is, how much leg it has under the hips, and how much room its
 * body fills — and that build is what decides the fighter.
 *
 * SchizoAxe is the reference, so it comes out exactly neutral and the game plays as it
 * always did until you pick somebody else.
 *
 * MEASURE A NEW ONE  node --import tsx tools/roster.mjs
 */

/** What a model's body actually is, in metres, from its rest pose. */
export interface Build {height:number;leg:number;bulk:number}

/** Measured 2026-09-09 off the models on the shared host. */
export const BUILDS:Record<string,Build>={
  'SchizoAxe.vrm':        {height:1.574,leg:0.435,bulk:1.576},
  'sch1z0br0000.vrm':     {height:1.555,leg:0.435,bulk:1.624},
  'Schizotron.vrm':       {height:1.975,leg:0.902,bulk:2.149},
  'BROLY.vrm':            {height:1.799,leg:0.435,bulk:2.227},
  'JIGGAZ0.vrm':          {height:0.824,leg:0.112,bulk:0.244},
  'JIGGAZ1.vrm':          {height:0.824,leg:0.112,bulk:0.244},
  'JIGGAZ2.vrm':          {height:0.824,leg:0.112,bulk:0.244},
  'brother67.vrm':        {height:1.550,leg:0.435,bulk:1.095},
  'brotherKuma.vrm':      {height:1.659,leg:0.435,bulk:1.865},
  'sch1z0br0000_red.vrm': {height:1.555,leg:0.435,bulk:1.624},
  'sch1z0br0004.vrm':     {height:1.584,leg:0.435,bulk:1.567},
  '0xDn.vrm':             {height:1.897,leg:0.667,bulk:1.801},
};

/** The body every other body is scored against. */
export const REFERENCE:Build=BUILDS['SchizoAxe.vrm'];

export interface Fighter {
  id:string;
  name:string;
  /** How hard they are to launch. 100 is the reference; stage two reads this. */
  weight:number;
  /** Multipliers on the shared walking rules. */
  speed:number;gravity:number;jump:number;traction:number;
  /** Jumps before the feet have to touch something again. */
  jumps:number;
}

const clamp=(value:number,low:number,high:number)=>Math.min(high,Math.max(low,value));
/** Read a fighter out of a body. */
export function fighterFrom(id:string,name:string,build:Build):Fighter{
  // Bulk spans nine to one across the roster, which no fighting game would survive, so
  // weight is its square root: a range of about 40 to 120 around the reference's 100.
  const weight=Math.round(100*Math.sqrt(build.bulk/REFERENCE.bulk));
  const heaviness=weight/100;
  return {
    id,name,weight,
    // Light and small gets away from you; heavy commits to everything it starts.
    speed:clamp(Math.pow(1/heaviness,0.3),0.85,1.25),
    gravity:clamp(Math.pow(heaviness,0.4),0.8,1.3),
    // Leg length, not weight: it is the legs that do the jumping.
    jump:clamp(Math.pow(build.leg/REFERENCE.leg,0.25),0.85,1.2),
    traction:clamp(Math.pow(heaviness,0.5),0.85,1.2),
    // The featherweights float, so they get a third one.
    jumps:weight<60?3:2,
  };
}

/** Anybody with no measured body — the cartoon cast — fights as the reference does. */
export const NEUTRAL:Fighter=fighterFrom('','',REFERENCE);

const roster=new Map<string,Fighter>();
for(const [file,build] of Object.entries(BUILDS))
  roster.set(file,fighterFrom(file,file.replace(/\.vrm$/i,''),build));

/** The whole roster, heaviest last, for a character select to list. */
export const FIGHTERS=[...roster.values()].sort((a,b)=>a.weight-b.weight);

export function fighterFor(skin:string):Fighter{
  return roster.get(skin)??{...NEUTRAL,id:skin,name:skin};
}

/** One line of stats, the way a select screen says it. */
export const fighterLine=(fighter:Fighter)=>
  `${fighter.name.toUpperCase()} · ${fighter.weight} WEIGHT · ${fighter.jumps} JUMPS`;
