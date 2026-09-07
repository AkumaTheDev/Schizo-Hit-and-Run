import { assetURL } from '../assets';
import { originalArt } from '../original-ui';
export interface VoiceClip {line:number;actor:string;kind:string;file:string;mission:string}
export class Presentation {
  private pendingBriefing:{image:string;title:string}|undefined;
  active=false;done=false;line=0;briefing=false;private root=document.createElement('section');private audio=new Audio();private video=document.createElement('video');private skip=document.createElement('button');private resumeButton=document.createElement('button');private board=document.createElement('div');private token=0;private movie=false;private paused=false;
  constructor(){
    this.root.id='campaign-presentation';this.root.hidden=true;this.root.setAttribute('aria-label','Mission presentation');this.skip.className='campaign-skip';this.resumeButton.className='campaign-play';this.resumeButton.hidden=true;this.board.className='campaign-briefing';this.board.hidden=true;
    originalArt.label(this.skip,'SKIP',18,120,38);originalArt.label(this.resumeButton,'PLAY',24,220,48);this.video.playsInline=true;this.video.preload='auto';this.root.append(this.video,this.board,this.skip,this.resumeButton);document.body.append(this.root);
    this.skip.onclick=()=>{if(this.pendingBriefing&&!this.briefing){this.token++;this.audio.pause();this.showBriefing(this.pendingBriefing);}else this.finish();};this.resumeButton.onclick=()=>{this.resumeButton.hidden=true;void (this.movie?this.video:this.audio).play().catch(()=>{this.resumeButton.hidden=false;});};
  }
  private finish(){this.token++;this.audio.pause();this.video.pause();this.active=false;this.done=true;this.briefing=false;this.root.hidden=true;this.video.removeAttribute('src');this.video.load();}
  private begin(movie:boolean){this.stop();this.active=true;this.done=false;this.movie=movie;this.root.hidden=false;this.root.classList.toggle('movie',movie);this.video.hidden=!movie;originalArt.label(this.skip,'SKIP',18,120,38);return this.token;}
  private showBriefing(briefing:{image:string;title:string}){
    this.briefing=true;this.board.replaceChildren();this.board.hidden=false;this.root.classList.add('movie');const title=document.createElement('div'),image=document.createElement('img');originalArt.label(title,briefing.title,26,540,48);image.src=assetURL(briefing.image);image.alt=briefing.title;const start=document.createElement('button');originalArt.label(start,'START MISSION',22,280,48);start.onclick=()=>this.finish();this.board.append(title,image,start);this.skip.hidden=true;start.focus();
  }
  missionBriefing(briefing:{image:string;title:string}){this.begin(false);this.showBriefing(briefing);}
  async dialogue(clips:VoiceClip[],briefing?:{image:string;title:string}){
    const token=this.begin(false);this.pendingBriefing=briefing;
    if(!clips.length){this.root.setAttribute('aria-label','Dialogue recording unavailable');originalArt.label(this.skip,'CONTINUE',18,120,38);return;}
    for(const clip of clips){
      if(token!==this.token)return;this.line=clip.line;this.root.setAttribute('aria-label',`${clip.actor.toUpperCase()} speaking. Original recorded dialogue.`);this.audio.src=assetURL(clip.file);
      await new Promise<void>(resolve=>{this.audio.onended=()=>resolve();this.audio.onerror=()=>resolve();this.audio.onpause=()=>{if(token!==this.token)resolve();};void this.audio.play().catch(()=>{this.resumeButton.hidden=false;});});
    }
    if(token===this.token){if(briefing)this.showBriefing(briefing);else this.finish();}
  }
  async playMovie(file:string){
    const token=this.begin(true);this.video.src=assetURL(file);this.video.onended=()=>{if(token===this.token)this.finish();};this.video.onerror=()=>{this.root.setAttribute('aria-label','Movie could not be loaded');this.resumeButton.hidden=false;};
    try{await this.video.play();}catch{this.resumeButton.hidden=false;}
  }
  setPaused(paused:boolean){if(paused===this.paused)return;this.paused=paused;if(!this.active)return;this.root.hidden=paused;const media=this.movie?this.video:this.audio;if(paused)media.pause();else if(!this.briefing)void media.play().catch(()=>{this.resumeButton.hidden=false;});}
  stop(){this.token++;this.audio.pause();this.video.pause();this.active=false;this.done=false;this.briefing=false;this.pendingBriefing=undefined;this.root.hidden=true;this.board.hidden=true;this.skip.hidden=false;this.resumeButton.hidden=true;}
  dispose(){this.stop();this.audio.removeAttribute('src');this.video.removeAttribute('src');this.video.load();this.root.remove();}
}
