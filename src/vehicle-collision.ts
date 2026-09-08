import * as THREE from 'three';
export interface VehicleFootprint {halfWidth:number;halfLength:number}
export const DEFAULT_FOOTPRINT:VehicleFootprint={halfWidth:.9,halfLength:2.2};
interface Pose {position:THREE.Vector3;heading:number}
/** Separating-axis contact between a chassis box and one original world triangle. */
export function boxTriangleContact(center:THREE.Vector3,half:THREE.Vector3,orientation:THREE.Quaternion,triangle:THREE.Triangle){
  const inverse=orientation.clone().invert(),points=[triangle.a,triangle.b,triangle.c].map(p=>p.clone().sub(center).applyQuaternion(inverse));
  const edges=[points[1].clone().sub(points[0]),points[2].clone().sub(points[1]),points[0].clone().sub(points[2])];
  const basis=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)],axes=[...basis,edges[0].clone().cross(edges[1])];
  for(const edge of edges)for(const axis of basis)axes.push(edge.clone().cross(axis));
  let depth=Infinity,normal=new THREE.Vector3();
  for(const axis of axes){if(axis.lengthSq()<1e-10)continue;axis.normalize();
    const projections=points.map(p=>p.dot(axis)),lo=Math.min(...projections),hi=Math.max(...projections),radius=half.x*Math.abs(axis.x)+half.y*Math.abs(axis.y)+half.z*Math.abs(axis.z);
    if(lo>=radius||hi<=-radius)return undefined;
    const positive=hi+radius,negative=radius-lo,overlap=Math.min(positive,negative);
    if(overlap<depth){depth=overlap;normal.copy(axis).multiplyScalar(positive<negative?1:-1);}
  }
  if(!Number.isFinite(depth))return undefined;
  const support=new THREE.Vector3(-Math.sign(normal.x)*half.x,-Math.sign(normal.y)*half.y,-Math.sign(normal.z)*half.z).applyQuaternion(orientation).add(center);
  return {depth,normal:normal.applyQuaternion(orientation),point:triangle.closestPointToPoint(support,new THREE.Vector3())};
}
export function vehicleTravelDistance(a:Pose,b:Pose,as=DEFAULT_FOOTPRINT,bs=DEFAULT_FOOTPRINT){
  if(Math.abs(a.position.y-b.position.y)>2)return Infinity;
  const af=new THREE.Vector2(Math.sin(a.heading),Math.cos(a.heading)),bf=new THREE.Vector2(Math.sin(b.heading),Math.cos(b.heading));
  const ar=new THREE.Vector2(af.y,-af.x),br=new THREE.Vector2(bf.y,-bf.x),delta=new THREE.Vector2(a.position.x-b.position.x,a.position.z-b.position.z);let enter=0,leave=Infinity;
  for(const axis of [ar,af,br,bf]){
    const extent=as.halfWidth*Math.abs(ar.dot(axis))+as.halfLength*Math.abs(af.dot(axis))+bs.halfWidth*Math.abs(br.dot(axis))+bs.halfLength*Math.abs(bf.dot(axis));
    const offset=delta.dot(axis),rate=af.dot(axis);
    if(Math.abs(rate)<1e-8){if(Math.abs(offset)>=extent)return Infinity;continue;}
    const a=(-extent-offset)/rate,b=(extent-offset)/rate;enter=Math.max(enter,Math.min(a,b));leave=Math.min(leave,Math.max(a,b));if(enter>=leave)return Infinity;
  }
  return enter;
}
/** Horizontal separating-axis contact avoids circular bounds hitting adjacent lanes. */
export function vehicleContact(a:Pose,b:Pose,as=DEFAULT_FOOTPRINT,bs=DEFAULT_FOOTPRINT){
  if(Math.abs(a.position.y-b.position.y)>2)return undefined;
  const forward=(heading:number)=>new THREE.Vector2(Math.sin(heading),Math.cos(heading));
  const af=forward(a.heading),bf=forward(b.heading),ar=new THREE.Vector2(af.y,-af.x),br=new THREE.Vector2(bf.y,-bf.x);
  const delta=new THREE.Vector2(a.position.x-b.position.x,a.position.z-b.position.z);let depth=Infinity,normal=new THREE.Vector2();
  for(const axis of [ar,af,br,bf]){
    const extentA=as.halfWidth*Math.abs(ar.dot(axis))+as.halfLength*Math.abs(af.dot(axis));
    const extentB=bs.halfWidth*Math.abs(br.dot(axis))+bs.halfLength*Math.abs(bf.dot(axis));
    const offset=delta.dot(axis),overlap=extentA+extentB-Math.abs(offset);if(overlap<=0)return undefined;
    if(overlap<depth){depth=overlap;normal.copy(axis).multiplyScalar(offset<0?-1:1);}
  }
  return {depth,normal:new THREE.Vector3(normal.x,0,normal.y)};
}
