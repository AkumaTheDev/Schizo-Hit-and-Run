import { assetURL } from './assets';
export class Sound {
  enabled=false;
  private engine=new Audio(assetURL('audio/engine.m4a'));
  private music=new Audio(assetURL('audio/sunday-drive.m4a'));
  private voice=new Audio(assetURL('audio/homer-start.m4a'));
  constructor(){this.engine.loop=this.music.loop=true;this.engine.volume=0.12;this.music.volume=0.15;this.voice.volume=0.55;this.engine.preservesPitch=false;}
  async toggle(){this.enabled=!this.enabled;if(this.enabled) await this.resume();else this.pause();return this.enabled;}
  async resume(){if(this.enabled)await Promise.all([this.engine.play(),this.music.play()]).catch(()=>{this.enabled=false;});}
  start(){if(this.enabled){this.resume();this.voice.currentTime=0;void this.voice.play().catch(()=>{});}}
  update(speed:number,throttle:number){this.engine.playbackRate=0.6+Math.abs(speed)/28+throttle*0.25;this.engine.volume=0.05+Math.min(Math.abs(speed)/100,0.17);}
  pause(){this.engine.pause();this.music.pause();this.voice.pause();}
  dispose(){this.pause();for(const item of [this.engine,this.music,this.voice]){item.removeAttribute('src');item.load();}}
}
