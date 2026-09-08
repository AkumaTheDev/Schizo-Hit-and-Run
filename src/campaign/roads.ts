import * as THREE from 'three';
import type { Vec3 } from './types';
/** Rounded corners with distance-based sampling keep scripted vehicles moving continuously. */
export class MissionRoute {
  private curve=new THREE.CurvePath<THREE.Vector3>();private travelled=0;readonly length:number;
  constructor(points:THREE.Vector3[]){
    let previous=points[0].clone();
    for(let i=1;i<points.length-1;i++){
      const point=points[i],incoming=point.clone().sub(points[i-1]),outgoing=points[i+1].clone().sub(point);
      const radius=Math.min(6,incoming.length()*.35,outgoing.length()*.35);incoming.normalize();outgoing.normalize();
      const start=point.clone().addScaledVector(incoming,-radius),end=point.clone().addScaledVector(outgoing,radius);
      if(previous.distanceTo(start)>.001)this.curve.add(new THREE.LineCurve3(previous,start));
      if(start.distanceTo(end)>.001)this.curve.add(new THREE.QuadraticBezierCurve3(start,point,end));previous=end;
    }
    const end=points.at(-1)!;if(previous.distanceTo(end)>.001)this.curve.add(new THREE.LineCurve3(previous,end));
    if(!this.curve.curves.length)this.curve.add(new THREE.LineCurve3(previous,previous.clone().add(new THREE.Vector3(0,0,.001))));
    this.length=this.curve.getLength();
  }
  get finished(){return this.travelled>=this.length;}
  advance(metres:number,position:THREE.Vector3){this.travelled=Math.min(this.length,this.travelled+metres);const t=this.travelled/this.length;this.curve.getPoint(t,position);const tangent=this.curve.getTangent(t);return Math.atan2(tangent.x,tangent.z);}
}
/** Routes scripted AI waypoints over the roads extracted from the level. */
export class RoadNetwork {
  private nodes:THREE.Vector3[]=[];private edges:{to:number;cost:number}[][]=[];
  private segments:[number,number][]=[];
  constructor(roads:number[][][]){
    const node=(p:number[])=>{const point=new THREE.Vector3(...p as Vec3);let id=this.nodes.findIndex(n=>n.distanceTo(point)<1.5);if(id<0){id=this.nodes.length;this.nodes.push(point);this.edges.push([]);}return id;};
    const connect=(a:number,b:number)=>{const cost=this.nodes[a].distanceTo(this.nodes[b]);this.edges[a].push({to:b,cost});this.edges[b].push({to:a,cost});};
    for(const [a,b] of roads){const start=node(a),end=node(b);connect(start,end);this.segments.push([start,end]);}
    // Road segments end at the edges of junctions in the Pure3D road network.
    for(let a=0;a<this.nodes.length;a++)for(let b=a+1;b<this.nodes.length;b++)if(this.nodes[a].distanceTo(this.nodes[b])<13)connect(a,b);
  }
  route(from:THREE.Vector3,to:THREE.Vector3){
    if(!this.segments.length)return [from.clone(),to.clone()];
    const nearest=(point:THREE.Vector3)=>{
      let best=Infinity,result={edge:this.segments[0],point:this.nodes[this.segments[0][0]].clone()};const projected=new THREE.Vector3();
      for(const edge of this.segments){new THREE.Line3(this.nodes[edge[0]],this.nodes[edge[1]]).closestPointToPoint(point,true,projected);const distance=projected.distanceToSquared(point);if(distance<best){best=distance;result={edge,point:projected.clone()};}}
      return result;
    };
    // Attach cars to their positions along roads. Choosing only the nearest
    // endpoint made an approaching car reverse to the end of a long straight.
    const origin=nearest(from),destination=nearest(to),nodes=[...this.nodes,origin.point,destination.point],start=nodes.length-2,end=nodes.length-1;
    const extra=new Map<number,{to:number;cost:number}[]>();
    const attach=(a:number,b:number)=>{const cost=nodes[a].distanceTo(nodes[b]);extra.set(a,[...(extra.get(a)??[]),{to:b,cost}]);extra.set(b,[...(extra.get(b)??[]),{to:a,cost}]);};
    for(const id of origin.edge)attach(start,id);for(const id of destination.edge)attach(end,id);
    if(origin.edge===destination.edge)attach(start,end);
    const cost=new Float64Array(nodes.length).fill(Infinity),previous=new Int32Array(nodes.length).fill(-1),open=new Set([start]);cost[start]=0;
    while(open.size){
      let at=-1,best=Infinity;for(const id of open){const score=cost[id]+nodes[id].distanceTo(destination.point);if(score<best){at=id;best=score;}}
      if(at===end)break;open.delete(at);
      for(const edge of [...(this.edges[at]??[]),...(extra.get(at)??[])])if(cost[at]+edge.cost<cost[edge.to]){cost[edge.to]=cost[at]+edge.cost;previous[edge.to]=at;open.add(edge.to);}
    }
    if(!Number.isFinite(cost[end]))return [from.clone(),to.clone()];
    const indices:number[]=[];for(let at=end;at>=0;at=previous[at]){indices.push(at);if(at===start)break;}
    const result=[from.clone(),...indices.reverse().map(i=>nodes[i].clone()),to.clone()];
    return result.filter((p,i)=>i===0||p.distanceTo(result[i-1])>.1);
  }
}
