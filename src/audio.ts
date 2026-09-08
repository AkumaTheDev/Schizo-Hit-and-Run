import { assetURL } from './assets';
import type { VoiceClip } from './campaign/types';

/**
 * Game audio, all of it from the original recordings this project converted.
 *
 * Everything is decoded once and played through WebAudio rather than through media
 * elements. That is not tidiness: a looping <audio> element restarts its decoder at
 * the loop point, which on a phone is an audible gap every time the engine loop comes
 * round, and writing `playbackRate` sixty times a second on one makes it crackle. A
 * decoded buffer loops seamlessly, takes a smoothly ramped playback rate, and starts a
 * one-shot with no network request at the moment it is heard.
 *
 * Two kinds of sound ship with the game: the loops and one-shots below — engine, radio,
 * siren, ticket, coins, and Homer starting the car — and 549 converted voice lines under
 * campaign/dialogue, pooled per character and used as barks.
 */
const ENGINE='audio/engine.m4a',MUSIC='audio/sunday-drive.m4a',IGNITION='audio/homer-start.m4a';
const SIREN='audio/siren.m4a',TICKET='audio/busted.m4a';
const COINS=[1,2,3].map(n=>`audio/coin${n}.m4a`);
/** How many voice lines are decoded and held ready, so a bark never waits on the network. */
const VOICE_POOL=6;

interface Loop {source:AudioBufferSourceNode;gain:GainNode}

export class Sound {
  /** On by default. The browser holds everything silent until a gesture regardless. */
  enabled=true;cinematic=false;
  private context?:AudioContext;private master?:GainNode;
  private buffers=new Map<string,AudioBuffer>();private pending=new Map<string,Promise<AudioBuffer|undefined>>();
  private loops=new Map<string,Loop>();
  private nextCoin=0;
  /** The current character's lines: all of them, and the decoded few ready to play. */
  private lines:string[]=[];private ready:string[]=[];private lastBark=0;
  private speaking?:AudioBufferSourceNode;

  /** Bring up the context. Every caller is inside a user gesture, which is what browsers require. */
  private wake(){
    if(!this.context){
      try{this.context=new AudioContext();}catch{return undefined;}
      this.master=this.context.createGain();this.master.gain.value=1;this.master.connect(this.context.destination);
    }
    if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
    return this.context;
  }

  /** Fetch and decode once, however many callers ask for the same clip at the same time. */
  private buffer(path:string){
    const cached=this.buffers.get(path);
    if(cached)return Promise.resolve<AudioBuffer|undefined>(cached);
    let pending=this.pending.get(path);
    if(!pending){
      pending=(async()=>{
        const context=this.wake();if(!context)return undefined;
        try{
          const response=await fetch(assetURL(path));
          if(!response.ok)throw new Error(`${path} (${response.status})`);
          const decoded=await context.decodeAudioData(await response.arrayBuffer());
          this.buffers.set(path,decoded);return decoded;
        }catch(error){console.warn('Could not decode',path,error);return undefined;}
        finally{this.pending.delete(path);}
      })();
      this.pending.set(path,pending);
    }
    return pending;
  }

  private play(path:string,volume:number,rate=1){
    const context=this.wake(),buffer=this.buffers.get(path);
    if(!context||!this.master||context.state!=='running')return undefined;
    // Not decoded yet: start it, so the next time this fires it is instant.
    if(!buffer){void this.buffer(path);return undefined;}
    const source=context.createBufferSource(),gain=context.createGain();
    source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=volume;
    source.connect(gain).connect(this.master);source.start();
    return {source,gain};
  }

  /** Start a looping clip, or leave the running one alone. Loops are gapless by construction. */
  private async startLoop(path:string,volume:number){
    if(this.loops.has(path))return;
    const buffer=await this.buffer(path);const context=this.wake();
    if(!buffer||!context||!this.master||this.loops.has(path))return;
    const source=context.createBufferSource(),gain=context.createGain();
    source.buffer=buffer;source.loop=true;gain.gain.value=volume;
    source.connect(gain).connect(this.master);source.start();
    this.loops.set(path,{source,gain});
  }
  private stopLoop(path:string){
    const loop=this.loops.get(path);if(!loop)return;
    this.loops.delete(path);
    try{loop.gain.gain.setTargetAtTime(0,this.context!.currentTime,.05);loop.source.stop(this.context!.currentTime+.25);}catch{}
  }
  /** Ramp rather than jump: a stepped gain or rate is exactly what reads as crackle. */
  private ease(param:AudioParam|undefined,value:number,seconds=.08){
    if(!param||!this.context)return;
    if(!Number.isFinite(value))return;
    param.setTargetAtTime(value,this.context.currentTime,seconds);
  }

  async toggle(){this.enabled=!this.enabled;if(this.enabled)await this.resume();else this.pause();return this.enabled;}
  async resume(){
    if(!this.enabled)return;
    if(!this.wake())return;
    await Promise.all([this.startLoop(ENGINE,.12),this.startLoop(MUSIC,.15)]);
    // Decode the one-shots up front so the first coin and the first crash are not late.
    void Promise.all([...COINS,TICKET,IGNITION,SIREN].map(path=>this.buffer(path)));
  }
  start(){if(this.enabled)void this.resume();}

  update(speed:number,throttle:number){
    const engine=this.loops.get(ENGINE);
    this.ease(engine?.source.playbackRate,0.6+Math.abs(speed)/28+throttle*0.25,.06);
    this.ease(engine?.gain.gain,this.cinematic?0:0.05+Math.min(Math.abs(speed)/100,0.17));
    this.ease(this.loops.get(MUSIC)?.gain.gain,this.cinematic?0:.15);
  }
  pursuit(active:boolean,distance:number){
    if(this.enabled&&active&&!this.cinematic){
      void this.startLoop(SIREN,0);
      this.ease(this.loops.get(SIREN)?.gain.gain,.45*Math.max(0,1-distance/120),.2);
    }else this.stopLoop(SIREN);
  }
  busted(){this.stopLoop(SIREN);this.play(TICKET,.55);}
  coin(){if(!this.cinematic)this.play(COINS[this.nextCoin++%COINS.length],.35);}
  /** Homer turning the key — the clip the conversion pulled for exactly this moment. */
  ignite(){if(!this.cinematic)this.play(IGNITION,.55);}

  /**
   * Pool the level character's own lines.
   *
   * Every clip is tagged with the actor who recorded it, so a level's pool is every line
   * that character speaks anywhere in the game. A handful are decoded straight away and
   * the pool is topped up after each one is used, so a bark is always ready to play.
   */
  setCharacter(actor:string,dialogue:Record<string,VoiceClip[]>){
    this.stopBark();
    const lines=new Set<string>();
    for(const conversation of Object.values(dialogue??{}))
      for(const clip of conversation)if(clip.actor===actor)lines.add(clip.file);
    this.lines=[...lines];this.ready=[];
    for(let i=0;i<VOICE_POOL;i++)this.stock();
  }
  /** Decode one more random line into the ready pool, in the background. */
  private stock(){
    if(!this.lines.length)return;
    const line=this.lines[Math.floor(Math.random()*this.lines.length)];
    if(this.ready.includes(line))return;
    void this.buffer(line).then(buffer=>{if(buffer&&!this.ready.includes(line))this.ready.push(line);});
  }
  /**
   * Say something: one line at a time, never twice inside `gap` seconds. These are
   * conversation lines, and a character muttering at every kerb wears out in a minute.
   */
  bark(gap=9){
    if(!this.enabled||this.cinematic||!this.ready.length)return;
    const now=performance.now();
    if(now-this.lastBark<gap*1000)return;
    const line=this.ready.shift()!;
    const playing=this.play(line,.85);
    if(!playing){this.ready.push(line);return;}
    this.lastBark=now;this.speaking=playing.source;
    playing.source.onended=()=>{if(this.speaking===playing.source)this.speaking=undefined;};
    this.stock();
  }
  private stopBark(){if(this.speaking){try{this.speaking.stop();}catch{}this.speaking=undefined;}}

  pause(){this.stopBark();for(const path of [...this.loops.keys()])this.stopLoop(path);}
  dispose(){this.pause();void this.context?.close().catch(()=>{});this.context=undefined;this.buffers.clear();this.loops.clear();}
}
