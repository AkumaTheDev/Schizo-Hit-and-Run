import * as THREE from 'three';
import type { CarState,Terrain } from './physics';
import { NEUTRAL,type Fighter } from './fighters';

// PAL CharacterManager 0x26e9f0, WalkerLocomotionAction 0x121438,
// JumpAction 0x1248f0 / 0x125b38, and jump dispatch 0x107f60.
export const PLAYER_RULES={walkSpeed:4,runSpeed:8,acceleration:20,deceleration:10,gravity:25,jumpHeight:1.9,doubleJumpHeight:1,doubleJumpUpSpeed:2,doubleJumpFallSpeed:12,airSpeed:4,airAcceleration:Math.fround(.078)*60,stompGravityScale:Math.fround(3.22)};
export interface WalkingControls {x:number;z:number;run:boolean;jump:boolean}

/**
 * The shared rules, bent to one fighter's build.
 *
 * Everybody runs this same code; what separates them is the multipliers their body was
 * measured into. The reference build multiplies by one throughout, so a neutral fighter
 * walks out of here with PLAYER_RULES untouched.
 */
export function rulesFor(fighter:Fighter){
  return {
    ...PLAYER_RULES,
    walkSpeed:PLAYER_RULES.walkSpeed*fighter.speed,
    runSpeed:PLAYER_RULES.runSpeed*fighter.speed,
    airSpeed:PLAYER_RULES.airSpeed*fighter.speed,
    gravity:PLAYER_RULES.gravity*fighter.gravity,
    deceleration:PLAYER_RULES.deceleration*fighter.traction,
    jumpHeight:PLAYER_RULES.jumpHeight*fighter.jump,
    doubleJumpHeight:PLAYER_RULES.doubleJumpHeight*fighter.jump,
    jumps:fighter.jumps,
  };
}

/**
 * Convert a stick push read in CAMERA space into the body-relative pair `update` wants.
 *
 * `update` turns its input back into a world heading as `heading - atan2(x, z)`, so the
 * conversion is that identity solved for x and z: push the stick away from you and the
 * character runs along the camera's own heading, whichever way its body happens to face.
 */
export function cameraRelative(x:number,z:number,heading:number,camYaw:number){
  const magnitude=Math.min(1,Math.hypot(x,z));
  const local=heading-camYaw+Math.atan2(x,z);
  return {x:magnitude*Math.sin(local),z:magnitude*Math.cos(local)};
}
export class PlayerMovement {
  readonly velocity=new THREE.Vector3();heading=0;jumps=0;stomping=false;
  private wasGrounded=false;
  /** Whose body these rules were bent to. Changing character changes how you move. */
  rules=rulesFor(NEUTRAL);
  setFighter(fighter:Fighter){this.rules=rulesFor(fighter);}
  reset(heading=0){this.velocity.set(0,0,0);this.heading=heading;this.jumps=0;this.stomping=false;this.wasGrounded=false;}
  kick(){if(this.jumps>=this.rules.jumps)this.stomping=true;}
  update(state:CarState,controls:WalkingControls,dt:number,terrain:Terrain){
    const rules=this.rules;
    terrain.carry(state);
    const previous=state.position.clone();
    if(state.grounded){this.jumps=0;this.stomping=false;}
    if(controls.jump){
      // Every jump after the first is the same jump, so a third one costs a number
      // rather than a branch: the featherweights simply have one more of them.
      const again=this.jumps>=1&&this.jumps<rules.jumps&&state.verticalSpeed<=rules.doubleJumpUpSpeed&&state.verticalSpeed>=-rules.doubleJumpFallSpeed;
      if(state.grounded||again){
        state.verticalSpeed=Math.sqrt(2*rules.gravity*(again?rules.doubleJumpHeight:rules.jumpHeight));
        this.jumps=again?this.jumps+1:1;state.grounded=false;
      }
    }
    const magnitude=Math.min(1,Math.hypot(controls.x,controls.z));
    const speed=magnitude*(state.grounded?(controls.run?rules.runSpeed:rules.walkSpeed):rules.airSpeed);
    const direction=state.heading-Math.atan2(controls.x,controls.z);
    const desired=new THREE.Vector3(Math.sin(direction)*speed,0,Math.cos(direction)*speed);
    const delta=desired.sub(this.velocity),rate=state.grounded?(speed>this.velocity.length()?rules.acceleration:rules.deceleration):rules.airAcceleration;
    if(delta.length()>rate*dt)delta.setLength(rate*dt);this.velocity.add(delta);
    if(!state.grounded&&this.velocity.length()>rules.airSpeed)this.velocity.setLength(rules.airSpeed);
    if(this.stomping)this.velocity.set(0,0,0);
    if(magnitude)this.heading=direction;
    state.position.addScaledVector(this.velocity,dt);
    terrain.resolve(state,previous,dt,.35,true,rules.gravity*(this.stomping?rules.stompGravityScale:1));
    const travelled=state.position.clone().sub(previous);travelled.y=0;state.speed=travelled.length()/dt;state.distance+=travelled.length();
    if(state.grounded&&!this.wasGrounded){this.jumps=0;this.stomping=false;}
    this.wasGrounded=!!state.grounded;
    return this.stomping?'hom_jump_kick':!state.grounded?(this.jumps===2?'hom_jump_dash_in_air':'hom_jump_idle_in_air'):state.speed>4.1?'hom_loco_run':state.speed>.1?'hom_loco_walk':'hom_loco_idle_rest';
  }
}
