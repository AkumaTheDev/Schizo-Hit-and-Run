import * as THREE from 'three';
import type { Vec3 } from './types';
/** Routes scripted AI waypoints over the roads extracted from the level. */
export class RoadNetwork {
  private nodes:THREE.Vector3[]=[];private edges:{to:number;cost:number}[][]=[];
  constructor(roads:number[][][]){
    const node=(p:number[])=>{const point=new THREE.Vector3(...p as Vec3);let id=this.nodes.findIndex(n=>n.distanceTo(point)<1.5);if(id<0){id=this.nodes.length;this.nodes.push(point);this.edges.push([]);}return id;};
    const connect=(a:number,b:number)=>{const cost=this.nodes[a].distanceTo(this.nodes[b]);this.edges[a].push({to:b,cost});this.edges[b].push({to:a,cost});};
    for(const [a,b] of roads)connect(node(a),node(b));
    // Road segments end at the edges of junctions in the Pure3D road network.
    for(let a=0;a<this.nodes.length;a++)for(let b=a+1;b<this.nodes.length;b++)if(this.nodes[a].distanceTo(this.nodes[b])<13)connect(a,b);
  }
  route(from:THREE.Vector3,to:THREE.Vector3){
    if(!this.nodes.length)return [from.clone(),to.clone()];
    const nearest=(point:THREE.Vector3)=>this.nodes.reduce((best,p,i)=>p.distanceToSquared(point)<this.nodes[best].distanceToSquared(point)?i:best,0);
    const start=nearest(from),end=nearest(to),cost=new Float64Array(this.nodes.length).fill(Infinity),previous=new Int32Array(this.nodes.length).fill(-1),open=new Set([start]);cost[start]=0;
    while(open.size){
      let at=-1,best=Infinity;for(const id of open){const score=cost[id]+this.nodes[id].distanceTo(to);if(score<best){at=id;best=score;}}
      if(at===end)break;open.delete(at);
      for(const edge of this.edges[at])if(cost[at]+edge.cost<cost[edge.to]){cost[edge.to]=cost[at]+edge.cost;previous[edge.to]=at;open.add(edge.to);}
    }
    if(!Number.isFinite(cost[end]))return [from.clone(),to.clone()];
    const indices:number[]=[];for(let at=end;at>=0;at=previous[at]){indices.push(at);if(at===start)break;}
    const result=[from.clone(),...indices.reverse().map(i=>this.nodes[i].clone()),to.clone()];
    // Avoid a U-turn to the nearest road endpoint when the car already faces its destination.
    if(result.length>3&&result[1].clone().sub(from).dot(result[2].clone().sub(from))<0)result.splice(1,1);
    return result.filter((p,i)=>i===0||p.distanceTo(result[i-1])>.1);
  }
}
