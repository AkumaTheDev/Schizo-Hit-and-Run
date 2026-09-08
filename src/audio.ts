import { assetURL } from './assets';
export class Sound {
  enabled=false;cinematic=false;
  private engine=new Audio(assetURL('audio/engine.m4a'));
  private music=new Audio(assetURL('audio/sunday-drive.m4a'));
  private voice=new Audio(assetURL('audio/homer-start.m4a'));
  private siren=new Audio(assetURL('audio/siren.m4a'));private ticket=new Audio(assetURL('audio/busted.m4a'));
  constructor(){this.engine.loop=this.music.loop=this.siren.loop=true;this.engine.volume=0.12;this.music.volume=0.15;this.voice.volume=0.55;this.ticket.volume=.55;this.engine.preservesPitch=false;}
  async toggle(){this.enabled=!this.enabled;if(this.enabled) await this.resume();else this.pause();return this.enabled;}
  async resume(){if(this.enabled)await Promise.all([this.engine.play(),this.music.play()]).catch(()=>{this.enabled=false;});}
  start(){if(this.enabled)void this.resume();}
  update(speed:number,throttle:number){this.engine.playbackRate=0.6+Math.abs(speed)/28+throttle*0.25;this.engine.volume=this.cinematic?0:0.05+Math.min(Math.abs(speed)/100,0.17);this.music.volume=this.cinematic?0:.15;}
  pursuit(active:boolean,distance:number){
    if(this.enabled&&active&&!this.cinematic){this.siren.volume=.45*Math.max(0,1-distance/120);if(this.siren.paused)void this.siren.play().catch(()=>{});}else this.siren.pause();
  }
  busted(){if(this.enabled){this.siren.pause();this.ticket.currentTime=0;void this.ticket.play().catch(()=>{});}}
  pause(){for(const item of [this.engine,this.music,this.voice,this.siren,this.ticket])item.pause();}
  dispose(){this.pause();for(const item of [this.engine,this.music,this.voice,this.siren,this.ticket]){item.removeAttribute('src');item.load();}}
}
