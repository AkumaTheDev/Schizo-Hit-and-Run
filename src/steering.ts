import * as THREE from 'three';
import type { CarState,Controls } from './physics';
import { DEFAULT_FOOTPRINT,vehicleTravelDistance,type VehicleFootprint } from './vehicle-collision';
export interface SteeringObstacle {position:THREE.Vector3;heading:number;footprint?:VehicleFootprint}
export const AI_RULES={minimumLookahead:5,lookaheadSeconds:.8,minimumBrakeLookahead:10,avoidanceRange:50,avoidanceOffset:3};
/** VehicleAI 0x12b8e8 chooses a speed-dependent target; 0x12e608 divides
 * its signed angle by the vehicle's maximum wheel angle. */
export function targetSteering(state:CarState,target:THREE.Vector3,maximumWheelDegrees=30){
  const delta=target.clone().sub(state.position);delta.y=0;if(delta.lengthSq()<.001)return 0;
  const heading=Math.atan2(delta.x,delta.z),angle=Math.atan2(Math.sin(heading-state.heading),Math.cos(heading-state.heading));
  return THREE.MathUtils.clamp(-angle/THREE.MathUtils.degToRad(maximumWheelDegrees),-1,1);
}
export class SteeringDriver {
  private stuck=0;private reversing=0;
  reset(){this.stuck=this.reversing=0;}
  controls(state:CarState,target:THREE.Vector3,targetSpeed:number,dt:number,tuning:Record<string,number>,obstacles:SteeringObstacle[]=[],footprint=DEFAULT_FOOTPRINT,avoid=true):Controls{
    const aim=target.clone(),forward=new THREE.Vector3(Math.sin(state.heading),0,Math.cos(state.heading)),right=new THREE.Vector3(Math.cos(state.heading),0,-Math.sin(state.heading));
    let clearance=Infinity;
    for(const other of obstacles){if(other.position.distanceToSquared(state.position)>AI_RULES.avoidanceRange**2)continue;
      const distance=vehicleTravelDistance(state,other,footprint,other.footprint);clearance=Math.min(clearance,distance);
      if(avoid&&distance<Math.max(8,Math.abs(state.speed)*.8)&&distance>3){const side=other.position.clone().sub(state.position).dot(right);aim.addScaledVector(right,side>=0?-AI_RULES.avoidanceOffset:AI_RULES.avoidanceOffset);}
    }
    const steer=targetSteering(state,aim,tuning.SetMaxWheelTurnAngle??30);
    const facing=aim.clone().sub(state.position).normalize().dot(forward);
    let desired=Math.min(targetSpeed,Math.max(5,targetSpeed*(1-.65*Math.abs(steer))));
    desired=Math.min(desired,Math.sqrt(2*((tuning.SetBrakeScale??8)+3)*Math.max(0,clearance-1.5)));
    if(Math.abs(state.speed)<.6&&targetSpeed>2&&clearance>3)this.stuck+=dt;else this.stuck=0;
    if(this.stuck>1.5||facing<-.5&&Math.abs(state.speed)<2){this.reversing=.7;this.stuck=0;}
    if(this.reversing>0){this.reversing-=dt;return {steer:-steer,throttle:0,brake:state.speed>-4?.6:0,handbrake:false};}
    const feedForward=desired>1?(Math.max(0,state.speed)/((tuning.SetTopSpeedKmh??120)/3.6))**2:0;
    return {steer,throttle:THREE.MathUtils.clamp(feedForward+(desired-state.speed)*.35,0,1),brake:THREE.MathUtils.clamp((state.speed-desired)*.2,0,1),handbrake:false};
  }
}
