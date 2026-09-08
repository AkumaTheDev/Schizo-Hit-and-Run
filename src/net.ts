/**
 * Multiplayer transport.
 *
 * The server is a HUB, never a simulator. Every client runs the full driving
 * simulation locally at 60 Hz, so your own car answers the wheel with zero
 * network latency; the wire only ever carries a thin pose sample per player.
 * Nothing here is allowed to move the local car — see `apply` in main.ts.
 *
 * Remote cars are reconstructed from those samples by `RemoteBuffer`, which
 * plays them back on a delayed clock so packet jitter never reaches the screen.
 */

/** One pose sample, as it crosses the wire. Kept as a flat array to stay small at 20 Hz. */
export type Sample=[
  x:number,y:number,z:number,
  qx:number,qy:number,qz:number,qw:number,
  heading:number,speed:number,steer:number,
  onFoot:0|1,anim:string,car:string,
];

export interface PeerInfo {id:string;name:string;level:number;car:string;skin:string}

/** How far behind the newest sample remote players are rendered. One or two packets of slack. */
const INTERPOLATION_DELAY=110;
/** Past this the buffer is stale and the peer is frozen rather than flung across the map. */
const MAX_EXTRAPOLATION=260;
/** Samples older than this are dropped from the buffer. */
const HISTORY=2000;

interface Timed {t:number;s:Sample}

/**
 * A jitter buffer for one remote player.
 *
 * Samples arrive unevenly. Rather than snapping to whatever arrived last (which
 * reads as stutter) the buffer keeps a short history and reads it at a delayed
 * clock, interpolating between the two samples that bracket that time.
 */
export class RemoteBuffer {
  private samples:Timed[]=[];
  push(t:number,s:Sample){
    // Out-of-order and duplicate packets are discarded rather than sorted back in:
    // at 20 Hz a late packet is already behind the render clock and would only cause a hitch.
    const last=this.samples[this.samples.length-1];
    if(last&&t<=last.t)return;
    this.samples.push({t,s});
    while(this.samples.length>2&&this.samples[0].t<t-HISTORY)this.samples.shift();
  }
  get newest(){return this.samples[this.samples.length-1]?.t??0;}
  get empty(){return this.samples.length===0;}
  /**
   * Read the pose at `time`, blending between the bracketing samples.
   * Returns the two samples and the blend factor; the caller does the lerp/slerp
   * so it can keep its own reusable vectors and quaternions.
   */
  at(time:number):{from:Sample;to:Sample;alpha:number}|null{
    const list=this.samples;if(!list.length)return null;
    if(list.length===1||time<=list[0].t)return {from:list[0].s,to:list[0].s,alpha:0};
    const newest=list[list.length-1];
    if(time>=newest.t){
      // Ran off the end of the buffer. Hold the last pose; a short coast is done by the
      // caller from the sample's own speed, and beyond MAX_EXTRAPOLATION we simply stop.
      const previous=list[list.length-2];
      const over=Math.min(time-newest.t,MAX_EXTRAPOLATION),span=newest.t-previous.t;
      return {from:previous.s,to:newest.s,alpha:span>0?1+over/span:1};
    }
    for(let i=list.length-1;i>0;i--){
      if(time>=list[i-1].t&&time<=list[i].t){
        const span=list[i].t-list[i-1].t;
        return {from:list[i-1].s,to:list[i].s,alpha:span>0?(time-list[i-1].t)/span:0};
      }
    }
    return {from:list[0].s,to:list[0].s,alpha:0};
  }
  clear(){this.samples.length=0;}
}

export interface NetEvents {
  join:(peer:PeerInfo)=>void;
  leave:(id:string)=>void;
  info:(peer:PeerInfo)=>void;
  status:(text:string,connected:boolean)=>void;
}

/**
 * The client half of the hub. Owns the socket, the peer roster, one RemoteBuffer
 * per peer, and the delayed clock those buffers are read at.
 */
export class Net {
  id='';
  connected=false;
  status='OFFLINE';
  name='';
  readonly peers=new Map<string,PeerInfo>();
  readonly buffers=new Map<string,RemoteBuffer>();
  private socket:WebSocket|undefined;
  private events:Partial<NetEvents>={};
  /** The delayed playback clock, in server milliseconds. */
  private clock=0;
  private newest=0;
  private started=false;
  private sendTimer=0;
  private wanted=false;
  private retry=0;
  private retryTimer:ReturnType<typeof setTimeout>|undefined;
  private level=1;

  on<K extends keyof NetEvents>(event:K,handler:NetEvents[K]){this.events[event]=handler;}
  private say(text:string){this.status=text;this.events.status?.(text,this.connected);}

  /** Where the hub lives. Same origin in production; VITE_SERVER_URL when the game and hub are split. */
  static url(){
    const configured=import.meta.env.VITE_SERVER_URL;
    if(configured)return String(configured);
    const protocol=location.protocol==='https:'?'wss:':'ws:';
    // `npm run dev` serves the client on Vite's port while the hub runs on 8787.
    const host=import.meta.env.DEV?`${location.hostname}:8787`:location.host;
    return `${protocol}//${host}`;
  }

  join(name:string,level:number,car:string,skin:string){
    this.name=name||`PLAYER${Math.floor(Math.random()*900+100)}`;
    this.level=level;this.wanted=true;this.retry=0;
    this.open(car,skin);
  }

  private open(car:string,skin:string){
    this.close(false);
    this.say('CONNECTING…');
    let socket:WebSocket;
    try{socket=new WebSocket(Net.url());}
    catch{this.say('NO SERVER');return;}
    this.socket=socket;
    socket.onopen=()=>{
      this.retry=0;
      socket.send(JSON.stringify({t:'hi',name:this.name,level:this.level,car,skin}));
    };
    socket.onmessage=event=>{
      let message:any;try{message=JSON.parse(String(event.data));}catch{return;}
      this.receive(message);
    };
    socket.onerror=()=>{if(!this.connected)this.say('NO SERVER');};
    socket.onclose=()=>{
      const wasConnected=this.connected;
      this.connected=false;this.socket=undefined;this.peers.clear();this.buffers.clear();this.started=false;
      if(!this.wanted){this.say('OFFLINE');return;}
      // Reconnect with a backoff so a restarting hub does not get hammered.
      this.retry=Math.min(this.retry+1,6);
      const wait=Math.min(500*2**(this.retry-1),8000);
      this.say(wasConnected?`RECONNECTING IN ${Math.round(wait/1000)}s…`:'NO SERVER · RETRYING…');
      this.retryTimer=setTimeout(()=>{if(this.wanted)this.open(car,skin);},wait);
    };
  }

  private receive(message:any){
    if(message.t==='welcome'){
      this.id=String(message.id);this.connected=true;
      this.peers.clear();this.buffers.clear();
      for(const peer of message.players??[])if(peer.id!==this.id)this.addPeer(peer);
      this.clock=Number(message.now)-INTERPOLATION_DELAY;this.newest=Number(message.now);this.started=true;
      this.say(`ONLINE · ${this.peers.size+1} PLAYING`);
    }else if(message.t==='join'){
      if(message.id===this.id)return;
      this.addPeer(message);this.events.join?.(this.peers.get(String(message.id))!);
      this.say(`ONLINE · ${this.peers.size+1} PLAYING`);
    }else if(message.t==='info'){
      const peer=this.peers.get(String(message.id));
      if(peer){Object.assign(peer,{name:message.name??peer.name,level:message.level??peer.level,car:message.car??peer.car,skin:message.skin??peer.skin});this.events.info?.(peer);}
    }else if(message.t==='bye'){
      const id=String(message.id);
      this.peers.delete(id);this.buffers.delete(id);this.events.leave?.(id);
      this.say(`ONLINE · ${this.peers.size+1} PLAYING`);
    }else if(message.t==='f'){
      const now=Number(message.now);
      if(now>this.newest)this.newest=now;
      for(const entry of message.s??[]){
        const id=String(entry[0]);if(id===this.id)continue;
        let buffer=this.buffers.get(id);
        if(!buffer){buffer=new RemoteBuffer();this.buffers.set(id,buffer);}
        buffer.push(now,entry.slice(1) as Sample);
      }
    }
  }

  private addPeer(raw:any){
    const peer:PeerInfo={id:String(raw.id),name:String(raw.name??'PLAYER'),level:Number(raw.level??1),car:String(raw.car??'famil_v'),skin:String(raw.skin??'homer')};
    this.peers.set(peer.id,peer);
    if(!this.buffers.has(peer.id))this.buffers.set(peer.id,new RemoteBuffer());
  }

  /**
   * Advance the playback clock.
   *
   * The clock chases `newest - INTERPOLATION_DELAY`. Correcting by snapping would
   * show as a jolt on every peer at once, so instead the clock runs slightly fast
   * or slow — time dilation — and only hard-syncs when it is hopelessly adrift.
   */
  advance(dt:number){
    if(!this.started)return;
    const target=this.newest-INTERPOLATION_DELAY,error=target-this.clock;
    if(Math.abs(error)>1000){this.clock=target;return;}
    const rate=Math.max(.85,Math.min(1.15,1+error/400));
    this.clock+=dt*1000*rate;
  }
  get renderTime(){return this.clock;}

  /** Push the local pose to the hub at a fixed rate, independent of frame rate. */
  send(dt:number,sample:Sample,level:number,car:string,skin:string){
    if(!this.connected||this.socket?.readyState!==WebSocket.OPEN)return;
    if(level!==this.level){this.level=level;this.socket.send(JSON.stringify({t:'lv',level,car,skin}));}
    this.sendTimer-=dt;
    if(this.sendTimer>0)return;
    this.sendTimer=1/20;
    this.socket.send(JSON.stringify({t:'s',d:sample}));
  }

  /** Tell the hub about a car or skin change straight away rather than waiting for a pose. */
  describe(level:number,car:string,skin:string){
    if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({t:'lv',level,car,skin}));
    this.level=level;
  }

  close(intentional=true){
    if(intentional)this.wanted=false;
    clearTimeout(this.retryTimer);
    const socket=this.socket;this.socket=undefined;
    if(socket){socket.onclose=null;socket.onerror=null;socket.onmessage=null;socket.close();}
    this.connected=false;this.started=false;this.peers.clear();this.buffers.clear();
    if(intentional)this.say('OFFLINE');
  }
}

/** A stable, readable colour per player id, for radar blips and name tags. */
export function peerColour(id:string){
  let hash=0;for(let i=0;i<id.length;i++)hash=(hash*31+id.charCodeAt(i))|0;
  return `hsl(${Math.abs(hash)%360} 85% 62%)`;
}
