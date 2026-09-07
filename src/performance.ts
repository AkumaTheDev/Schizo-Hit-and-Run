export class FrameMetrics {
  private count=0;private frameTimes=new Float32Array(600);private grassTimes=new Float32Array(600);private index=0;
  reset(){this.count=0;this.index=0;}
  record(frame:number,grass:number){this.frameTimes[this.index]=frame;this.grassTimes[this.index]=grass;this.index=(this.index+1)%600;this.count=Math.min(this.count+1,600);}
  summary(){
    const frames=Array.from(this.frameTimes.slice(0,this.count)).sort((a,b)=>a-b),grass=Array.from(this.grassTimes.slice(0,this.count)).sort((a,b)=>a-b);
    const percentile=(a:number[],q:number)=>a[Math.max(0,Math.ceil(a.length*q)-1)]??0;
    return `frame p95 ${percentile(frames,.95).toFixed(1)} ms · max ${percentile(frames,1).toFixed(1)} ms · grass max ${percentile(grass,1).toFixed(1)} ms`;
  }
}
