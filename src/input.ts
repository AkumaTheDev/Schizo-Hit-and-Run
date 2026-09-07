export class Input {
  keys=new Set<string>(); pressed=new Set<string>(); touch=new Set<string>();
  private controller=new AbortController();
  constructor() {
    const options={signal:this.controller.signal};
    window.addEventListener('keydown',e=>{
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    },options);
    window.addEventListener('keyup',e=>this.keys.delete(e.code),options);
    window.addEventListener('blur',()=>this.clear(),options);
    document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(button=>{
      const key=button.dataset.key!;
      button.addEventListener('pointerdown',e=>{e.preventDefault();button.setPointerCapture(e.pointerId);this.touch.add(key);this.pressed.add(key);},options);
      for(const event of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(event,()=>this.touch.delete(key),options);
    });
  }
  down(...codes:string[]) {return codes.some(c=>this.keys.has(c)||this.touch.has(c));}
  consume(code:string) {const result=this.pressed.has(code);this.pressed.delete(code);return result;}
  get controls() {
    const pad=Array.from(navigator.getGamepads?.()??[]).find(Boolean);
    const steer=(this.down('KeyD','ArrowRight')?1:0)-(this.down('KeyA','ArrowLeft')?1:0);
    return {steer:steer || (pad && Math.abs(pad.axes[0])>0.12 ? pad.axes[0] :0),
      throttle:this.down('KeyW','ArrowUp')?1:(pad?.buttons[7]?.value??0),
      brake:this.down('KeyS','ArrowDown')?1:(pad?.buttons[6]?.value??0),
      handbrake:this.down('Space')||!!pad?.buttons[0]?.pressed};
  }
  clear(){this.keys.clear();this.pressed.clear();this.touch.clear();}
  dispose(){this.controller.abort();this.clear();}
}
