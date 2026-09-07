import * as THREE from 'three';
import type { LevelData } from './assets';
import type { CarState } from './physics';
import type { Challenge } from './challenge';
import type { Traffic } from './traffic';
export function element<T extends HTMLElement=HTMLElement>(id:string):T{return document.getElementById(id) as T;}
const speed=element('speed'),gear=element('gear'),condition=element('condition'),speedbar=element('speed-progress'),healthbar=element('condition-progress');
export class HUD {
  private canvas=element<HTMLCanvasElement>('minimap');
  private context=this.canvas.getContext('2d')!;
  private timer=0;private toastTimer=0;
  bigMap=false;
  toast(message:string){element('toast').textContent=message;element('toast').classList.add('visible');this.toastTimer=4;}
  update(dt:number,state:CarState,data:LevelData,challenge:Challenge,traffic:Traffic|undefined){
    this.toastTimer-=dt;if(this.toastTimer<=0)element('toast').classList.remove('visible');
    this.timer+=dt;if(this.timer<0.08)return;this.timer=0;
    const kmh=Math.abs(state.speed)*3.6;speed.textContent=Math.round(kmh).toString();gear.textContent=state.speed<-.2?'R':state.speed<.2?'N':Math.min(5,Math.floor(kmh/30)+1).toString();
    condition.textContent=`${Math.round(100-state.damage)}%`;healthbar.style.width=`${100-state.damage}%`;speedbar.style.width=`${Math.min(100,kmh/155*100)}%`;
    let nearest=data.locations[0],distance=Infinity;
    for(const place of data.locations){const [x,,z]=place.position,d=Math.hypot(state.position.x-x,state.position.z-z);if(d<distance){nearest=place;distance=d;}}
    if(nearest){element('place-name').textContent=nearest.name;element('map-caption').textContent=nearest.name.toUpperCase();}
    element('challenge-hud').hidden=!challenge.active;
    if(challenge.active){
      element('objective').textContent=`Next stop: ${challenge.route[challenge.index].name}`;
      element('checkpoint').textContent=`${String(challenge.index+1).padStart(2,'0')} / ${String(challenge.route.length).padStart(2,'0')}`;
      const t=Math.max(0,Math.ceil(challenge.remaining));element('timer').textContent=`${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`;
      element('challenge-progress').style.width=`${challenge.index/challenge.route.length*100}%`;
    }
    // The original HUD owns radar rendering.
  }
  private drawMap(state:CarState,data:LevelData,challenge:Challenge,traffic:Traffic|undefined){
    const c=this.context,size=this.canvas.width,center=size/2,scale=this.bigMap?0.3:1.18;
    c.clearRect(0,0,size,size);c.fillStyle='#183136';c.fillRect(0,0,size,size);
    c.save();c.translate(center,center);c.scale(scale,scale);c.translate(-state.position.x,-state.position.z);
    c.lineCap='round';c.lineJoin='round';
    for(const [color,width] of [['#456168',12],['#718080',7]] as const){
      c.strokeStyle=color;c.lineWidth=width;c.beginPath();
      for(const [a,b] of data.roads){c.moveTo(a[0],a[2]);c.lineTo(b[0],b[2]);}c.stroke();
    }
    c.fillStyle='#c4cdc699';
    for(const car of traffic?.cars??[]){c.beginPath();c.arc(car.mesh.position.x,car.mesh.position.z,2.2/scale,0,Math.PI*2);c.fill();}
    if(challenge.active){const p=challenge.route[challenge.index].position;c.fillStyle='#f6d44c';c.beginPath();c.arc(p[0],p[2],6/scale,0,Math.PI*2);c.fill();}
    c.restore();c.save();c.translate(center,center);c.rotate(Math.PI-state.heading);
    c.fillStyle='#f5d34f';c.strokeStyle='#0c2024';c.lineWidth=3;c.beginPath();c.moveTo(0,-12);c.lineTo(8,9);c.lineTo(0,5);c.lineTo(-8,9);c.closePath();c.stroke();c.fill();c.restore();
  }
}
