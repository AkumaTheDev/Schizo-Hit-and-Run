import * as THREE from 'three';
/** A distance-based path that includes the space between road segments. */
export class TrafficPath {
  private curve:THREE.Curve<THREE.Vector3>;private length:number;private distance:number;private junction=false;private nextSegment=0;private nextReverse=false;
  private scratch=new THREE.Vector3();
  constructor(private roads:THREE.Vector3[][],public segment:number,public reverse=false,fraction=0){
    this.curve=this.line(segment,reverse);this.length=this.curve.getLength();this.distance=fraction*this.length;
  }
  private line(segment:number,reverse:boolean){
    let [a,b]=this.roads[segment];if(reverse)[a,b]=[b,a];const direction=b.clone().sub(a).normalize(),offset=new THREE.Vector3(direction.z*1.4,0,-direction.x*1.4);
    return new THREE.LineCurve3(a.clone().add(offset),b.clone().add(offset));
  }
  private transition(){
    if(this.junction){
      this.segment=this.nextSegment;this.reverse=this.nextReverse;this.curve=this.line(this.segment,this.reverse);this.junction=false;
    }else{
      const end=this.curve.getPoint(1),direction=this.curve.getTangent(1).normalize();
      let [a,b]=this.roads[this.segment];if(this.reverse)[a,b]=[b,a];
      let best=-Infinity,segment=this.segment,reverse=!this.reverse;
      for(let i=0;i<this.roads.length;i++){
        if(i===this.segment)continue;const road=this.roads[i],flipped=b.distanceTo(road[1])<b.distanceTo(road[0]),start=road[flipped?1:0],finish=road[flipped?0:1];
        if(b.distanceTo(start)>13||Math.abs(b.y-start.y)>3)continue;
        const score=finish.clone().sub(start).normalize().dot(direction)-b.distanceTo(start)*.012;
        if(score>best){best=score;segment=i;reverse=flipped;}
      }
      const next=this.line(segment,reverse),start=next.getPoint(0),nextDirection=next.getTangent(0).normalize();
      const reach=THREE.MathUtils.clamp(end.distanceTo(start)*.55,2,8);
      this.curve=new THREE.CubicBezierCurve3(end,end.clone().addScaledVector(direction,reach),start.clone().addScaledVector(nextDirection,-reach),start);
      this.nextSegment=segment;this.nextReverse=reverse;this.junction=true;
    }
    this.length=Math.max(.001,this.curve.getLength());
  }
  advance(metres:number){
    this.distance+=metres;
    for(let guard=0;this.distance>=this.length&&guard<32;guard++){this.distance-=this.length;this.transition();}
  }
  sample(position:THREE.Vector3){
    const u=THREE.MathUtils.clamp(this.distance/this.length,0,1);this.curve.getPointAt(u,position);this.curve.getTangentAt(u,this.scratch);
    return Math.atan2(this.scratch.x,this.scratch.z);
  }
}
