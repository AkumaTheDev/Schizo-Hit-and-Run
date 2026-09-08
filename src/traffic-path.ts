import * as THREE from 'three';
import type { RoadNavigation } from './road-data';
/** A distance-based path that includes the space between road segments. */
export class TrafficPath {
  private curve:THREE.Curve<THREE.Vector3>;private length:number;private distance:number;private junction=false;private nextSegment=0;private nextReverse=false;
  private scratch=new THREE.Vector3();
  constructor(private roads:THREE.Vector3[][],public segment:number,public reverse=false,fraction=0,private navigation?:RoadNavigation,public lane=0){
    this.curve=this.line(segment,reverse);this.length=this.curve.getLength();this.distance=fraction*this.length;
  }
  private line(segment:number,reverse:boolean){
    if(this.navigation){const data=this.navigation.segments[segment],p=data.corners.map(p=>new THREE.Vector3(...p)),f=(Math.min(this.lane,data.lanes-1)+.5)/data.lanes;return new THREE.LineCurve3(p[0].lerp(p[3],f),p[1].lerp(p[2],f));}
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
      const native=this.navigation?.segments[this.segment];
      if(native&&native.next>=0){this.segment=native.next;this.reverse=false;this.curve=this.line(this.segment,false);this.length=Math.max(.001,this.curve.getLength());return;}
      const outgoing=native?this.navigation!.roads.filter(road=>road.start===this.navigation!.roads[native.road].end&&!road.shortcut&&road.maxCars>0).map(road=>road.segments[0]):this.roads.map((_,i)=>i);
      for(const i of outgoing){
        if(i===this.segment)continue;const road=this.roads[i],flipped=b.distanceTo(road[1])<b.distanceTo(road[0]),start=road[flipped?1:0],finish=road[flipped?0:1];
        if(!native&&(b.distanceTo(start)>13||Math.abs(b.y-start.y)>3))continue;
        const tangent=native?this.line(i,false).getTangent(0):finish.clone().sub(start).normalize();
        const score=tangent.dot(direction)-b.distanceTo(start)*.012;
        if(score>best){best=score;segment=i;reverse=native?false:flipped;}
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
  track(position:THREE.Vector3){
    let best=Infinity,at=0;const points=this.curve.getSpacedPoints(24),p=new THREE.Vector3();
    for(let i=0;i<24;i++){const line=new THREE.Line3(points[i],points[i+1]),t=line.closestPointToPointParameter(position,true);line.at(t,p);const d=p.distanceToSquared(position);if(d<best){best=d;at=(i+t)/24;}}
    this.distance=at*this.length;if(at>.97&&position.distanceTo(points[24])<1.2){this.distance=0;this.transition();}
  }
  peek(metres:number){
    const copy=Object.assign(Object.create(TrafficPath.prototype),this) as TrafficPath;copy.scratch=new THREE.Vector3();copy.advance(metres);
    const position=new THREE.Vector3(),heading=copy.sample(position);return {position,heading};
  }
  sample(position:THREE.Vector3){
    const u=THREE.MathUtils.clamp(this.distance/this.length,0,1);this.curve.getPointAt(u,position);this.curve.getTangentAt(u,this.scratch);
    return Math.atan2(this.scratch.x,this.scratch.z);
  }
}
