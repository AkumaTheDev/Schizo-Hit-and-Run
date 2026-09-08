import { assetURL } from './assets';
import type { VoiceClip } from './campaign/types';

/**
 * Game audio, all of it from the original recordings this project converted.
 *
 * Two kinds of sound ship with the game: the handful of loops and one-shots below —
 * engine, radio, siren, ticket, coins, and Homer starting the car — and 549 converted
 * voice lines under campaign/dialogue. The voice lines were left unplayed when the
 * campaign came out, which is most of the game's audio sitting on disk in silence, so
 * they are pooled per character here and used as barks: the level's own character
 * speaks, in their own voice, at the moments the player is doing something.
 */
export class Sound {
  /** On by default. The browser will not let anything sound before a gesture regardless. */
  enabled=true;cinematic=false;
  private engine=new Audio(assetURL('audio/engine.m4a'));
  private music=new Audio(assetURL('audio/sunday-drive.m4a'));
  private ignition=new Audio(assetURL('audio/homer-start.m4a'));
  private siren=new Audio(assetURL('audio/siren.m4a'));private ticket=new Audio(assetURL('audio/busted.m4a'));
  private coins=[1,2,3].map(n=>new Audio(assetURL(`audio/coin${n}.m4a`)));private nextCoin=0;
  /** The current character's lines, and the one that is speaking right now. */
  private lines:string[]=[];private speaking?:HTMLAudioElement;private nextBark=0;
  constructor(){
    this.engine.loop=this.music.loop=this.siren.loop=true;
    this.engine.volume=0.12;this.music.volume=0.15;this.ignition.volume=0.55;this.ticket.volume=.55;
    this.engine.preservesPitch=false;
  }
  async toggle(){this.enabled=!this.enabled;if(this.enabled) await this.resume();else this.pause();return this.enabled;}
  async resume(){if(this.enabled)await Promise.all([this.engine.play(),this.music.play()]).catch(()=>{this.enabled=false;});}
  start(){if(this.enabled)void this.resume();}
  update(speed:number,throttle:number){this.engine.playbackRate=0.6+Math.abs(speed)/28+throttle*0.25;this.engine.volume=this.cinematic?0:0.05+Math.min(Math.abs(speed)/100,0.17);this.music.volume=this.cinematic?0:.15;}
  pursuit(active:boolean,distance:number){
    if(this.enabled&&active&&!this.cinematic){this.siren.volume=.45*Math.max(0,1-distance/120);if(this.siren.paused)void this.siren.play().catch(()=>{});}else this.siren.pause();
  }
  busted(){if(this.enabled){this.siren.pause();this.ticket.currentTime=0;void this.ticket.play().catch(()=>{});}}
  coin(){if(this.enabled&&!this.cinematic){const clip=this.coins[this.nextCoin++%this.coins.length];clip.volume=.35;clip.currentTime=0;void clip.play().catch(()=>{});}}
  /** Homer turning the key — the clip the conversion pulled for exactly this moment. */
  ignite(){if(this.enabled&&!this.cinematic){this.ignition.currentTime=0;void this.ignition.play().catch(()=>{});}}

  /**
   * Pool the level character's own lines.
   *
   * Every clip is tagged with the actor who recorded it, so a level's pool is simply
   * every line spoken by that character across the whole game's conversations.
   */
  setCharacter(actor:string,dialogue:Record<string,VoiceClip[]>){
    this.stopBark();
    const lines=new Set<string>();
    for(const conversation of Object.values(dialogue??{}))
      for(const clip of conversation)if(clip.actor===actor)lines.add(clip.file);
    this.lines=[...lines];
  }
  /**
   * Say something, at most one line at a time and never twice in quick succession —
   * these are conversation lines, and a character muttering over themselves at every
   * kerb would wear out in a minute.
   */
  bark(gap=9){
    if(!this.enabled||this.cinematic||!this.lines.length)return;
    const now=performance.now();
    if(now<this.nextBark||(this.speaking&&!this.speaking.ended&&!this.speaking.paused))return;
    this.nextBark=now+gap*1000;
    const clip=new Audio(assetURL(this.lines[Math.floor(Math.random()*this.lines.length)]));
    clip.volume=.85;this.speaking=clip;
    void clip.play().catch(()=>{});
  }
  private stopBark(){if(this.speaking){this.speaking.pause();this.speaking.removeAttribute('src');this.speaking=undefined;}}

  pause(){this.stopBark();for(const item of [this.engine,this.music,this.ignition,this.siren,this.ticket,...this.coins])item.pause();}
  dispose(){this.pause();for(const item of [this.engine,this.music,this.ignition,this.siren,this.ticket,...this.coins]){item.removeAttribute('src');item.load();}}
}
