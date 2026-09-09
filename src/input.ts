/** Radians of camera rotation per pixel of thumb travel. Matches the feel of the sibling project. */
export const LOOK_SENSITIVITY=0.005;
/** Below this the stick is treated as centred, so a resting thumb never steers. */
const STICK_DEADZONE=0.12;
/** Past this fraction of full deflection the player is running rather than walking. */
const RUN_AT=0.92;
/** Run survives a direction flip for this long, so cornering at full tilt does not drop to a walk. */
const RUN_LATCH=350;

export interface Stick {x:number;y:number;magnitude:number;active:boolean;run:boolean}

const deadzone=(value:number)=>{const size=Math.abs(value);return size<=STICK_DEADZONE?0:Math.sign(value)*(size-STICK_DEADZONE)/(1-STICK_DEADZONE);};

export class Input {
  keys=new Set<string>(); pressed=new Set<string>(); touch=new Set<string>();
  /** Left thumb. `y` is negative when the stick is pushed up the screen, as on a gamepad. */
  readonly stick:Stick={x:0,y:0,magnitude:0,active:false,run:false};
  private controller=new AbortController();
  private lookX=0;private lookY=0;
  private stickPointer=-1;private lookPointer=-1;private lookLastX=0;private lookLastY=0;
  private stickOriginX=0;private stickOriginY=0;private stickRadius=64;
  private runLatch=0;
  private base=document.getElementById('touch-stick');
  private thumb=document.getElementById('touch-stick-thumb');

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
    document.querySelectorAll<HTMLElement>('[data-key]').forEach(button=>{
      // The key is read at PRESS time, not bound here: the face buttons keep their
      // glyphs and change what they do with the context — driving, on foot, armed.
      let held='';
      const release=()=>{if(held)this.touch.delete(held);held='';button.classList.remove('active');};
      button.addEventListener('pointerdown',event=>{
        event.preventDefault();button.setPointerCapture(event.pointerId);
        held=button.dataset.key??'';
        if(held){this.touch.add(held);this.pressed.add(held);}
        // preventDefault kills :active on a phone, so the glow is driven by a class.
        button.classList.add('active');
      },options);
      for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,release,options);
      button.addEventListener('contextmenu',event=>event.preventDefault(),options);
    });

    // The stick anchors wherever the thumb lands rather than at the pad's centre, so
    // a tap is zero deflection and the car only moves once the thumb actually travels.
    this.base?.addEventListener('pointerdown',event=>{
      event.preventDefault();
      this.stickPointer=event.pointerId;this.base!.setPointerCapture(event.pointerId);
      const box=this.base!.getBoundingClientRect();
      this.stickRadius=Math.max(24,box.width*0.42);
      this.stickOriginX=event.clientX;this.stickOriginY=event.clientY;
      this.base!.classList.add('active');this.moveStick(event.clientX,event.clientY);
    },options);
    this.base?.addEventListener('pointermove',event=>{
      if(event.pointerId!==this.stickPointer)return;
      event.preventDefault();this.moveStick(event.clientX,event.clientY);
    },options);
    for(const event of ['pointerup','pointercancel','lostpointercapture'])
      this.base?.addEventListener(event,e=>{if((e as PointerEvent).pointerId===this.stickPointer)this.releaseStick();},options);

    // Right thumb orbits the camera. Anything that is already a control keeps its own
    // touch, and on a phone the left half is left alone so the stick is never stolen.
    window.addEventListener('pointerdown',event=>{
      if(this.lookPointer>=0||event.pointerId===this.stickPointer)return;
      const target=event.target as Element|null;
      if(target?.closest('#touch-controls,#touch-stick,#menu,#loading,button,select,input'))return;
      if(event.pointerType!=='mouse'&&event.clientX<innerWidth*0.45)return;
      this.lookPointer=event.pointerId;this.lookLastX=event.clientX;this.lookLastY=event.clientY;
    },options);
    window.addEventListener('pointermove',event=>{
      if(event.pointerId!==this.lookPointer)return;
      // Measured rather than read from movementX, which is 0 for touch pointers in Safari.
      this.lookX+=event.clientX-this.lookLastX;this.lookY+=event.clientY-this.lookLastY;
      this.lookLastX=event.clientX;this.lookLastY=event.clientY;
    },options);
    for(const event of ['pointerup','pointercancel'])
      window.addEventListener(event,e=>{if((e as PointerEvent).pointerId===this.lookPointer)this.lookPointer=-1;},options);
  }

  private moveStick(clientX:number,clientY:number){
    let dx=clientX-this.stickOriginX,dy=clientY-this.stickOriginY;
    const distance=Math.hypot(dx,dy),radius=this.stickRadius;
    if(distance>radius&&distance>1e-6){dx*=radius/distance;dy*=radius/distance;}
    if(this.thumb){this.thumb.style.transform=`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`;}
    this.stick.x=deadzone(dx/radius);this.stick.y=deadzone(dy/radius);
    this.stick.magnitude=Math.min(1,Math.hypot(dx,dy)/radius);
    this.stick.active=true;
    if(this.stick.magnitude>RUN_AT)this.runLatch=performance.now()+RUN_LATCH;
    this.stick.run=this.stick.magnitude>RUN_AT||performance.now()<this.runLatch;
  }
  private releaseStick(){
    this.stickPointer=-1;this.runLatch=0;
    this.base?.classList.remove('active');
    if(this.thumb)this.thumb.style.removeProperty('transform');
    this.stick.x=0;this.stick.y=0;this.stick.magnitude=0;this.stick.active=false;this.stick.run=false;
  }

  /** Camera drag accumulated since the last frame, in pixels. Reading it clears it. */
  takeLook(){
    const pad=Array.from(navigator.getGamepads?.()??[]).find(Boolean);
    let x=this.lookX,y=this.lookY;
    if(pad){
      const rx=pad.axes[2]??0,ry=pad.axes[3]??0;
      if(Math.abs(rx)>0.15)x+=rx*11;
      if(Math.abs(ry)>0.15)y+=ry*8;
    }
    this.lookX=0;this.lookY=0;
    return {x,y};
  }

  down(...codes:string[]) {return codes.some(c=>this.keys.has(c)||this.touch.has(c));}
  consume(code:string) {const result=this.pressed.has(code);this.pressed.delete(code);return result;}
  /** Movement intent in camera space: `x` is right, `z` is away from the camera. */
  get move(){
    const pad=Array.from(navigator.getGamepads?.()??[]).find(Boolean);
    let x=(this.down('KeyD','ArrowRight')?1:0)-(this.down('KeyA','ArrowLeft')?1:0);
    let z=(this.down('KeyW','ArrowUp')?1:0)-(this.down('KeyS','ArrowDown')?1:0);
    let run=this.down('ShiftLeft','ShiftRight');
    if(this.stick.active){x=this.stick.x;z=-this.stick.y;run=run||this.stick.run;}
    else if(pad){
      const px=pad.axes[0]??0,pz=pad.axes[1]??0;
      if(Math.abs(px)>0.15)x=px;
      if(Math.abs(pz)>0.15)z=-pz;
      run=run||Math.hypot(px,pz)>RUN_AT;
    }
    return {x,z,run};
  }
  get controls() {
    const pad=Array.from(navigator.getGamepads?.()??[]).find(Boolean);
    const steer=(this.down('KeyD','ArrowRight')?1:0)-(this.down('KeyA','ArrowLeft')?1:0);
    // Behind the wheel the stick steers and does nothing else. Pushing it up the screen
    // used to open the throttle as well, so every turn was also an accelerator pedal;
    // the gas and brake live on their own buttons where a thumb can hold them.
    const stickSteer=this.stick.active?this.stick.x:0;
    return {steer:steer||stickSteer||(pad && Math.abs(pad.axes[0])>0.12 ? pad.axes[0] :0),
      throttle:Math.max(this.down('KeyW','ArrowUp')?1:0,pad?.buttons[7]?.value??0),
      brake:Math.max(this.down('KeyS','ArrowDown')?1:0,pad?.buttons[6]?.value??0),
      handbrake:this.down('Space')||!!pad?.buttons[0]?.pressed};
  }
  clear(){this.keys.clear();this.pressed.clear();this.touch.clear();this.releaseStick();this.lookX=0;this.lookY=0;this.lookPointer=-1;}
  dispose(){this.controller.abort();this.clear();}
}
