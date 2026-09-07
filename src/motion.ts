import * as THREE from 'three';
export interface Pose {position:THREE.Vector3;heading:number}
/** Render one physics step behind, interpolating every display frame. */
export class Motion {
  readonly position=new THREE.Vector3();heading=0;
  private previous=new THREE.Vector3();private previousHeading=0;
  reset(pose:Pose){this.previous.copy(pose.position);this.position.copy(pose.position);this.previousHeading=this.heading=pose.heading;}
  capture(pose:Pose){this.previous.copy(pose.position);this.previousHeading=pose.heading;}
  sample(pose:Pose,alpha:number){
    const t=THREE.MathUtils.clamp(alpha,0,1);
    this.position.lerpVectors(this.previous,pose.position,t);
    const turn=THREE.MathUtils.euclideanModulo(pose.heading-this.previousHeading+Math.PI,Math.PI*2)-Math.PI;
    this.heading=this.previousHeading+turn*t;return this;
  }
}
