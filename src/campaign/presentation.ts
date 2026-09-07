import { assetURL } from '../assets';
import { originalArt } from '../original-ui';
export interface VoiceClip {line:number;actor:string;kind:string;file:string;mission:string}
export class Presentation {
  active=false;done=false;private root=document.createElement('section');private audio=new Audio();private video=document.createElement('video');private skip=document.createElement('button');private resumeButton=document.createElement('button');private token=0;private movie=false;private paused=false;
  constructor(){
    this.root.id='campaign-presentation';this.root.hidden=true;this.root.setAttribute('aria-label','Mission presentation');this.skip.className='campaign-skip';this.resumeButton.className='campaign-play';this.resumeButton.hidden=true;
    originalArt.label(this.skip,'SKIP',18,120,38);originalArt.label(this.resumeButton,'PLAY',24,220,48);this.video.playsInline=true;this.video.preload='auto';this.root.append(this.video,this.skip,this.resumeButton);document.body.append(this.root);
    this.skip.onclick=()=>this.finish();this.resumeButton.onclick=()=>{this.resumeButton.hidden=true;void (this.movie?this.video:this.audio).play().catch(()=>{this.resumeButton.hidden=false;});};
  }
  private finish(){this.token++;this.audio.pause();this.video.pause();this.active=false;this.done=true;this.root.hidden=true;this.video.removeAttribute('src');this.video.load();}
  private begin(movie:boolean){this.stop();this.active=true;this.done=false;this.movie=movie;this.root.hidden=false;this.root.classList.toggle('movie',movie);this.video.hidden=!movie;return this.token;}
  async dialogue(clips:VoiceClip[]){
    const token=this.begin(false);
    if(!clips.length){this.root.setAttribute('aria-label','Dialogue recording unavailable');originalArt.label(this.skip,'CONTINUE',18,120,38);return;}
    originalArt.label(this.skip,'SKIP',18,120,38);
    for(const clip of clips){
      if(token!==this.token)return;this.root.setAttribute('aria-label',`${clip.actor.toUpperCase()} speaking. Original recorded dialogue.`);this.audio.src=assetURL(clip.file);
      await new Promise<void>(resolve=>{this.audio.onended=()=>resolve();this.audio.onerror=()=>resolve();this.audio.onpause=()=>{if(token!==this.token)resolve();};void this.audio.play().catch(()=>{this.resumeButton.hidden=false;});});
    }
    if(token===this.token)this.finish();
  }
  async playMovie(file:string){
    const token=this.begin(true);this.video.src=assetURL(file);this.video.onended=()=>{if(token===this.token)this.finish();};this.video.onerror=()=>{this.root.setAttribute('aria-label','Movie could not be loaded');this.resumeButton.hidden=false;};
    try{await this.video.play();}catch{this.resumeButton.hidden=false;}
  }
  setPaused(paused:boolean){if(paused===this.paused)return;this.paused=paused;if(!this.active)return;const media=this.movie?this.video:this.audio;if(paused)media.pause();else void media.play().catch(()=>{this.resumeButton.hidden=false;});}
  stop(){this.token++;this.audio.pause();this.video.pause();this.active=false;this.done=false;this.root.hidden=true;this.resumeButton.hidden=true;}
  dispose(){this.stop();this.audio.removeAttribute('src');this.video.removeAttribute('src');this.video.load();this.root.remove();}
}
