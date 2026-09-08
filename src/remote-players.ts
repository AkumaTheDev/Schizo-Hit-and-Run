/**
 * Everything the other players look like on your screen.
 *
 * These avatars are pure playback: they are driven only by samples read out of
 * the jitter buffers at the delayed clock in `Net`. No physics runs for a remote
 * player, so a peer with a bad connection can never disturb your own driving.
 */
import * as THREE from 'three';
import { Character } from './character';
import { isVrmSkin,VrmAvatar,type Avatar as Body } from './vrm-avatar';
import { buildRifle,disposeRifle } from './rifle';
import { peerColour,type Net,type PeerInfo,type Sample } from './net';
import { renderVehicleWheels,vehicleProfile,type VehicleMotion,type VehicleProfile } from './vehicle-physics';
import type { World } from './world';
import type { CampaignAssets } from './campaign/types';

const Y=new THREE.Vector3(0,1,0);
const FLIP=new THREE.Quaternion().setFromAxisAngle(Y,Math.PI);

interface Avatar {
  peer:PeerInfo;
  group:THREE.Group;
  car?:THREE.Group;
  profile?:VehicleProfile;
  offset:number;
  character?:Body;
  /** A peer carrying the rifle gets one drawn in their hand; it is not networked separately. */
  rifle?:THREE.Group;
  tag:THREE.Sprite;
  motion:VehicleMotion;
  /** Set while the model for this peer is still downloading, so we only ask once. */
  loadingCar:string;
  loadingSkin:string;
  onFoot:boolean;
  visible:boolean;
  position:THREE.Vector3;
  distance:number;
}

/** A remote avatar carries no suspension state, so wheels get a minimal motion record to render from. */
function blankMotion():VehicleMotion{
  return {velocity:new THREE.Vector3(),angularVelocity:new THREE.Vector3(),orientation:new THREE.Quaternion(),
    compression:[0,0,0,0],wheelSpin:[0,0,0,0],slip:0,lastSpeed:0,lastHeading:0,lastPosition:new THREE.Vector3(),
    wheelAngle:0,hadContact:true,tractionRecovery:0};
}

function nameTag(text:string,colour:string){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
  const c=canvas.getContext('2d')!;
  c.font='bold 68px system-ui, sans-serif';c.textAlign='center';c.textBaseline='middle';
  c.lineWidth=12;c.strokeStyle='rgba(0,0,0,.85)';c.strokeText(text,256,64);
  c.fillStyle=colour;c.fillText(text,256,64);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true}));
  sprite.scale.set(4,1,1);sprite.renderOrder=999;
  return sprite;
}

export class RemotePlayers {
  private avatars=new Map<string,Avatar>();
  private root=new THREE.Group();
  /** Peers past this are hidden entirely; Springfield is big and the models are not cheap. */
  private static readonly DRAW_DISTANCE=320;
  private from=new THREE.Quaternion();private to=new THREE.Quaternion();
  private position=new THREE.Vector3();private orientation=new THREE.Quaternion();

  constructor(private scene:THREE.Scene,private world:World,private assets:CampaignAssets){
    this.root.name='remote-players';scene.add(this.root);
  }

  /** Drop every avatar — used when the level changes or the connection goes away. */
  clear(){
    for(const avatar of this.avatars.values())this.destroy(avatar);
    this.avatars.clear();
  }
  remove(id:string){const avatar=this.avatars.get(id);if(avatar){this.destroy(avatar);this.avatars.delete(id);}}

  /** Give a peer the rifle, or take it away, matching what their animation says. */
  private setRifle(avatar:Avatar,armed:boolean){
    if(armed===!!avatar.rifle)return;
    if(!armed){if(avatar.rifle)disposeRifle(avatar.rifle);avatar.rifle=undefined;avatar.character?.holdPose(false);return;}
    const hand=avatar.character?.hand();
    if(!hand)return;
    const rifle=buildRifle();
    // The same carry the local player uses; see `Rifle.mount`.
    rifle.position.set(0.02,-0.03,-0.06);rifle.rotation.set(Math.PI/2,Math.PI/2,0);
    hand.add(rifle);avatar.rifle=rifle;avatar.character?.holdPose(true);
  }

  private destroy(avatar:Avatar){
    if(avatar.rifle)disposeRifle(avatar.rifle);
    avatar.character?.dispose();
    avatar.car?.removeFromParent();
    avatar.tag.material.map?.dispose();avatar.tag.material.dispose();
    avatar.group.removeFromParent();
  }

  private avatar(peer:PeerInfo){
    let avatar=this.avatars.get(peer.id);
    if(avatar){avatar.peer=peer;return avatar;}
    const group=new THREE.Group();group.name=`peer:${peer.id}`;this.root.add(group);
    const tag=nameTag(peer.name.toUpperCase(),peerColour(peer.id));this.root.add(tag);
    avatar={peer,group,tag,offset:.65,motion:blankMotion(),loadingCar:'',loadingSkin:'',
      onFoot:false,visible:true,position:new THREE.Vector3(),distance:0};
    this.avatars.set(peer.id,avatar);
    return avatar;
  }

  /** Load (or swap) the car model for a peer. Vehicles are cloned so several peers can drive the same one. */
  private async ensureCar(avatar:Avatar,id:string){
    if(avatar.loadingCar===id)return;
    avatar.loadingCar=id;
    try{
      const asset=await this.world.assets.load(`car-${id}`,true);
      if(avatar.loadingCar!==id||!this.avatars.has(avatar.peer.id))return;
      // vehicleProfile measures the source model; the clone shares its geometry and layout.
      const profile=vehicleProfile(asset.root);
      const car=asset.root.clone(true);
      car.traverse(object=>{if(object instanceof THREE.Mesh){object.castShadow=true;object.receiveShadow=true;}});
      avatar.car?.removeFromParent();
      avatar.car=car;avatar.profile=profile;avatar.offset=profile.offset;
      avatar.group.add(car);
      if(avatar.character&&!avatar.onFoot)avatar.character.drive(car);
    }catch{avatar.loadingCar='';}
  }

  private async ensureCharacter(avatar:Avatar,skin:string){
    if(avatar.loadingSkin===skin)return;
    avatar.loadingSkin=skin;
    try{
      // A peer's skin names either a VRM on the shared host or one of the game's own
      // characters; either way the avatar that comes back is driven identically.
      let character:Body;
      if(isVrmSkin(skin))character=await new VrmAvatar().load(skin);
      else{const cast=new Character();await cast.load(this.world.assets,this.assets.characters[skin]??skin);character=cast;}
      if(avatar.loadingSkin!==skin||!this.avatars.has(avatar.peer.id)){character.dispose();return;}
      avatar.character?.dispose();
      avatar.character=character;
      if(avatar.onFoot||!avatar.car)this.scene.add(character.group);
      else character.drive(avatar.car);
    }catch{avatar.loadingSkin='';}
  }

  /**
   * Rebuild every remote avatar for this frame.
   *
   * `net.renderTime` is deliberately behind the newest packet: reading the buffers
   * there is what turns 20 Hz of jittery samples into continuous 60 fps motion.
   */
  update(dt:number,net:Net,level:number,viewer:THREE.Vector3){
    const seen=new Set<string>();
    for(const peer of net.peers.values()){
      // Players in another level share no world, so they are not drawn at all.
      if(peer.level!==level)continue;
      const buffer=net.buffers.get(peer.id);
      if(!buffer||buffer.empty)continue;
      const frame=buffer.at(net.renderTime);
      if(!frame)continue;
      seen.add(peer.id);
      const avatar=this.avatar(peer);
      this.place(dt,avatar,frame.from,frame.to,frame.alpha,viewer);
    }
    for(const [id,avatar] of this.avatars){
      if(seen.has(id))continue;
      this.destroy(avatar);this.avatars.delete(id);
    }
  }

  private place(dt:number,avatar:Avatar,from:Sample,to:Sample,alpha:number,viewer:THREE.Vector3){
    const position=this.position.set(
      from[0]+(to[0]-from[0])*alpha,
      from[1]+(to[1]-from[1])*alpha,
      from[2]+(to[2]-from[2])*alpha);
    this.from.set(from[3],from[4],from[5],from[6]);
    this.to.set(to[3],to[4],to[5],to[6]);
    const orientation=this.orientation.copy(this.from).slerp(this.to,Math.min(alpha,1));
    // Headings wrap at ±π; interpolate the short way round or the car spins on the seam.
    const turn=THREE.MathUtils.euclideanModulo(to[7]-from[7]+Math.PI,Math.PI*2)-Math.PI;
    const heading=from[7]+turn*alpha;
    const speed=from[8]+(to[8]-from[8])*alpha;
    const steer=from[9]+(to[9]-from[9])*alpha;
    const onFoot=to[10]===1;

    avatar.position.copy(position);
    avatar.distance=position.distanceTo(viewer);
    const visible=avatar.distance<RemotePlayers.DRAW_DISTANCE;
    if(visible!==avatar.visible){avatar.visible=visible;avatar.group.visible=visible;avatar.tag.visible=visible;if(avatar.character)avatar.character.group.visible=visible;}

    if(to[12]&&to[12]!==avatar.loadingCar)void this.ensureCar(avatar,to[12]);
    if(!avatar.loadingSkin)void this.ensureCharacter(avatar,avatar.peer.skin);

    if(onFoot!==avatar.onFoot){
      avatar.onFoot=onFoot;
      if(avatar.character){
        if(onFoot)this.scene.add(avatar.character.group);
        else if(avatar.car)avatar.character.drive(avatar.car);
      }
    }

    if(!visible){
      // Off-screen peers still need their animation clock advanced or they pop mid-stride on return.
      avatar.character?.update(dt);
      return;
    }

    if(onFoot){
      avatar.group.visible=false;
      const character=avatar.character;
      if(character){
        character.group.position.copy(position);
        character.group.rotation.y+=THREE.MathUtils.euclideanModulo(heading-character.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;
        const animation=to[11]||'hom_loco_idle_rest';
        character.play(animation);
        // The animation name already says whether they are holding the gun, so the rifle
        // needs no wire format of its own: any gun clip means one is in their hands.
        this.setRifle(avatar,animation.startsWith('hom_gun'));
      }
      avatar.tag.position.set(position.x,position.y+2.5,position.z);
    }else{
      avatar.group.visible=true;
      const car=avatar.car;
      if(car){
        // Matches how the local car is placed: ride height is applied along the body's own up axis.
        car.position.copy(position).add(new THREE.Vector3(0,avatar.offset,0).applyQuaternion(orientation));
        car.quaternion.copy(orientation).multiply(FLIP);
        // Wheels are not networked. Spinning them from the interpolated speed costs nothing
        // and is indistinguishable from the real thing at any distance you can see them.
        const motion=avatar.motion;
        motion.orientation.copy(orientation);
        motion.wheelAngle=steer;
        if(avatar.profile){
          for(let i=0;i<4;i++)motion.wheelSpin[i]+=dt*speed/Math.max(.2,avatar.profile.wheels[i].radius);
          renderVehicleWheels(car,motion,avatar.profile,this.assets.tuning[avatar.peer.car]);
        }
      }
      avatar.tag.position.set(position.x,position.y+2.2,position.z);
    }
    avatar.character?.update(dt);
  }

  /** Radar blips and the on-screen roster, nearest first. */
  roster(viewer:THREE.Vector3){
    return [...this.avatars.values()]
      .map(avatar=>({name:avatar.peer.name.toUpperCase(),position:avatar.position.toArray() as [number,number,number],
        colour:peerColour(avatar.peer.id),distance:avatar.position.distanceTo(viewer)}))
      .sort((a,b)=>a.distance-b.distance);
  }

  dispose(){this.clear();this.root.removeFromParent();}
}
