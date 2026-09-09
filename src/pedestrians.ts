/**
 * The rest of the cast, out walking Springfield.
 *
 * Every VRM in the roster except the one the player is wearing gets a body on the
 * pavement. They are pure scenery: no physics runs for them, nothing they do can push
 * the player or a car around, and losing one costs nothing.
 *
 * They walk the ROAD GRAPH rather than a hand-drawn footpath, because the road graph is
 * the only description of the street layout this game has. `TrafficPath` already turns
 * that graph into a driveable line and rounds every junction, and it is the line the
 * traffic is proven on, so a pedestrian follows the same line and simply stands off to
 * one side of it — past the edge of the carriageway, on the footway.
 */
import * as THREE from 'three';
import { TrafficPath } from './traffic-path';
import { FOOT_CLEARANCE,type Terrain } from './physics';
import { VRM_MODELS,VrmAvatar,type AnimationSource,type Avatar } from './vrm-avatar';
import type { RoadNavigation } from './road-data';
import type { World } from './world';

export const PAVEMENT_RULES={
  /** Metres from the edge of the carriageway out to where a pedestrian walks. */
  offset:1.7,
  /** An unhurried walk, in metres per second. Matches the walk clip's own pace closely enough not to skate. */
  speed:1.15,
  /** Reseated once they are further away than this, so the cast is always somewhere near you. */
  removeRadius:150,
  /** Reseated no closer than this, so nobody pops into view in front of you. */
  nearRadius:35,
  /** ...and no further than this, or they arrive already out of sight. */
  farRadius:95,
  /** Past this they stop being drawn and stop animating; a skinned body is not cheap. */
  drawDistance:110,
  /** How long they stand still when the player is in the way. */
  waitSeconds:1.2,
  /** A footway more than this above or below its road is not the footway: a wall, a roof, a ditch. */
  kerb:1.5,
  /** How much further than the offset a footway may be nudged to clear the opposing carriageway. */
  budget:1,
  /** How far out to search for a way round a junction, where the path curves across the road. */
  cornerReach:7,
  /** The fastest the ground under a walking pedestrian may rise or fall, in metres per second. */
  climb:4,
};

/** The right-hand vector for a heading, in this game's (sin, cos) convention. */
export function rightOf(heading:number,out=new THREE.Vector3()){return out.set(-Math.cos(heading),0,Math.sin(heading));}

/**
 * How far the two carriageway edges sit either side of the line a path draws on a segment.
 *
 * A segment's four corners run start-left, end-left, end-right, start-right, and
 * `TrafficPath` puts lane `n` of `lanes` at the fraction `(n + .5) / lanes` across that
 * width. So the edges are not symmetric about the line unless the road is single lane,
 * and a pedestrian offset by a fixed amount from the CENTRE would stand in the road on
 * anything wider.
 */
export function carriagewayEdges(navigation:RoadNavigation,segment:number,lane=0){
  const data=navigation.segments[segment];
  const corners=data.corners.map(corner=>new THREE.Vector3(...corner));
  // The WIDEST cross-section, not the average: a segment that tapers is a different width
  // at each end, and an average leaves the pedestrian inside the tarmac at the wide end.
  const width=Math.max(corners[3].distanceTo(corners[0]),corners[2].distanceTo(corners[1]));
  const fraction=(Math.min(lane,data.lanes-1)+.5)/data.lanes;
  return {
    /** Distance from the line out to the corner-0 side, and out to the corner-3 side. */
    nearSide:fraction*width,farSide:(1-fraction)*width,
    /** Which way the corner-3 side lies, so it can be told from the corner-0 side. */
    across:corners[3].clone().sub(corners[0]).setY(0).normalize(),
  };
}

/**
 * Step off the road onto the footway.
 *
 * `side` is which shoulder of the walker the road is over: +1 puts them to the right of
 * the line they are following, -1 to the left. Whichever they take, the offset is
 * measured from the edge of the tarmac on THAT side, not from the middle of the road.
 */
export function footwayPoint(centre:THREE.Vector3,heading:number,edges:ReturnType<typeof carriagewayEdges>,side:1|-1,offset=PAVEMENT_RULES.offset,out=new THREE.Vector3()){
  const right=rightOf(heading);
  const farIsRight=edges.across.dot(right)>=0;
  const distance=(side>0?(farIsRight?edges.farSide:edges.nearSide):(farIsRight?edges.nearSide:edges.farSide))+offset;
  return out.copy(centre).addScaledVector(right,side*distance);
}

/**
 * The height to stand at, or nothing if this is not somewhere to stand.
 *
 * A footway point is derived from the road, not from the ground, so a few of them land
 * against a wall or over a drop. Measured on level 1, one point in a hundred is more than
 * a couple of metres off its own road; those are the ones this refuses, and they are why
 * a pedestrian is never reseated purely on "the raycast hit something".
 */
export function footwayFloor(terrain:Terrain,spot:THREE.Vector3,roadY:number,tolerance=PAVEMENT_RULES.kerb){
  const floor=terrain.ground(spot.x,spot.z,spot.y,4);
  if(!floor||Math.abs(floor.point.y-roadY)>tolerance)return undefined;
  return floor.point.y;
}

/** Every carriageway strip as a flat quad, bucketed 20m square so a point test is cheap. */
export function carriagewayGrid(navigation:RoadNavigation){
  const quads=navigation.segments.map(segment=>{
    const corners=segment.corners.map(corner=>new THREE.Vector2(corner[0],corner[2]));
    return {corners,box:new THREE.Box2().setFromPoints(corners),y:segment.corners[0][1]};
  });
  const cells=new Map<string,number[]>();
  quads.forEach((quad,index)=>{
    for(let x=Math.floor(quad.box.min.x/20);x<=Math.floor(quad.box.max.x/20);x++)
      for(let z=Math.floor(quad.box.min.y/20);z<=Math.floor(quad.box.max.y/20);z++){
        const key=`${x},${z}`,bucket=cells.get(key)??[];bucket.push(index);cells.set(key,bucket);
      }
  });
  return {quads,cells};
}
/** Whether a point is inside a convex quad given in corner order. */
function withinQuad(point:THREE.Vector2,corners:THREE.Vector2[]){
  let sign=0;
  for(let i=0;i<4;i++){
    const a=corners[i],b=corners[(i+1)%4];
    const cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);
    if(Math.abs(cross)<1e-9)continue;
    if(sign===0)sign=Math.sign(cross);else if(Math.sign(cross)!==sign)return false;
  }
  return true;
}
/** Do two flat line segments cross? */
function segmentsCross(a:THREE.Vector2,b:THREE.Vector2,c:THREE.Vector2,d:THREE.Vector2){
  const side=(p:THREE.Vector2,q:THREE.Vector2,r:THREE.Vector2)=>Math.sign((q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x));
  const s1=side(a,b,c),s2=side(a,b,d),s3=side(c,d,a),s4=side(c,d,b);
  return s1!==s2&&s3!==s4;
}
/**
 * Whether a whole stretch of footway stays off the tarmac.
 *
 * Sampling points along it is not enough: two strips can overlap in a band narrower than
 * the sample spacing, and that band is exactly where a junction's strips lie across one
 * another. This tests the line itself, so nothing can hide between two samples.
 */
export function footwayClear(grid:ReturnType<typeof carriagewayGrid>,from:THREE.Vector2,to:THREE.Vector2,fromY:number,toY=fromY,skip=-1){
  // A strip can fall several metres end to end, so the height it is compared against is a
  // RANGE. Using one end's height alone lets a road at the other end's level slip through.
  const low=Math.min(fromY,toY),high=Math.max(fromY,toY);
  const box=new THREE.Box2().setFromPoints([from,to]);
  for(let x=Math.floor(box.min.x/20);x<=Math.floor(box.max.x/20);x++)
    for(let z=Math.floor(box.min.y/20);z<=Math.floor(box.max.y/20);z++)
      for(const index of grid.cells.get(`${x},${z}`)??[]){
        if(index===skip)continue;
        const quad=grid.quads[index];
        if(quad.y<low-3||quad.y>high+3||!quad.box.intersectsBox(box))continue;
        if(withinQuad(from,quad.corners)||withinQuad(to,quad.corners))return false;
        for(let i=0;i<4;i++)if(segmentsCross(from,to,quad.corners[i],quad.corners[(i+1)%4]))return false;
      }
  return true;
}
/**
 * A footway point that is genuinely off the road, searching outward if the obvious one is not.
 *
 * Between segments the path is a curve THROUGH the junction, and a fixed step off a curve
 * that crosses the road is a step into it. Rather than let that happen, this walks outward
 * until it is clear of every carriageway — around the outside of the corner, which is where
 * a pavement goes — and gives up rather than compromise if nothing out there is clear.
 */
export function clearFootway(grid:ReturnType<typeof carriagewayGrid>,centre:THREE.Vector3,heading:number,edges:ReturnType<typeof carriagewayEdges>,side:1|-1,offset:number,reach=PAVEMENT_RULES.cornerReach,out=new THREE.Vector3()){
  const flat=new THREE.Vector2();
  for(let step=0;step<=reach;step+=.25){
    footwayPoint(centre,heading,edges,side,offset+step,out);
    flat.set(out.x,out.z);
    if(!onCarriageway(grid,flat,centre.y))return out;
  }
  return undefined;
}
/** Is this spot tarmac? `y` keeps a road on a bridge from claiming the ground under it. */
export function onCarriageway(grid:ReturnType<typeof carriagewayGrid>,point:THREE.Vector2,y:number,skip=-1){
  for(const index of grid.cells.get(`${Math.floor(point.x/20)},${Math.floor(point.y/20)}`)??[]){
    if(index===skip)continue;
    const quad=grid.quads[index];
    if(Math.abs(quad.y-y)>3||!quad.box.containsPoint(point))continue;
    if(withinQuad(point,quad.corners))return true;
  }
  return false;
}
/**
 * Which side of each carriageway strip has a footway, and how far out it sits.
 *
 * Springfield is not described as one road per street. Each direction is its own strip of
 * carriageway laid alongside the other, so stepping off the edge of the strip you are
 * following lands you in the opposing one about two times in five. The answer is not to
 * push further out until it is clear — that walks a pedestrian across the whole street and
 * into the gardens on the far side — but to use the OUTER side of each strip and leave the
 * inner one alone. On level 1 that leaves 934 of 966 strips with a footway.
 *
 * A side with no footway is stored as zero. Measured once, at load: the roads do not move.
 */
export function pavementSides(navigation:RoadNavigation,offset=PAVEMENT_RULES.offset,budget=PAVEMENT_RULES.budget){
  const grid=carriagewayGrid(navigation);
  const table=new Float32Array(navigation.segments.length*2);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),from=new THREE.Vector2(),to=new THREE.Vector2();
  for(let segment=0;segment<navigation.segments.length;segment++){
    const data=navigation.segments[segment];
    const corners=data.corners.map(corner=>new THREE.Vector3(...corner));
    const fraction=.5/data.lanes;
    a.copy(corners[0]).lerp(corners[3],fraction);b.copy(corners[1]).lerp(corners[2],fraction);
    const heading=Math.atan2(b.x-a.x,b.z-a.z);
    const edges=carriagewayEdges(navigation,segment);
    for(const side of [1,-1] as const){
      let chosen=0;
      for(let step=0;step<=budget;step+=.25){
        const start=footwayPoint(a,heading,edges,side,offset+step),end=footwayPoint(b,heading,edges,side,offset+step);
        from.set(start.x,start.z);to.set(end.x,end.z);
        if(footwayClear(grid,from,to,a.y,b.y,segment)){chosen=offset+step;break;}
      }
      table[segment*2+(side>0?0:1)]=chosen;
    }
  }
  return table;
}

interface Person {
  skin:string;
  avatar:Avatar;
  path:TrafficPath;
  side:1|-1;
  position:THREE.Vector3;
  /** Where they are walking to: the last footway point that was actually on a pavement. */
  target:THREE.Vector3;
  heading:number;
  /** Counts down while they stand still: something is in the way, or they just arrived. */
  wait:number;
  placed:boolean;
}

export class Pedestrians {
  private people:Person[]=[];
  private scratch=new THREE.Vector3();private step=new THREE.Vector3();
  private routes:THREE.Vector3[][];
  /** How far out the footway sits, per segment and side, measured once at construction. */
  private offsets:Float32Array;
  /** Set once the level is going away, so a model still downloading is dropped on arrival. */
  private gone=false;
  private grid:ReturnType<typeof carriagewayGrid>|undefined;
  constructor(private world:World,private scene:THREE.Scene){
    this.routes=world.data.roads.map(road=>road.map(point=>new THREE.Vector3(...point as [number,number,number])));
    this.offsets=world.data.navigation?pavementSides(world.data.navigation):new Float32Array();
    this.grid=world.data.navigation?carriagewayGrid(world.data.navigation):undefined;
  }
  /** The footway offset on this side of this strip, or 0 where that side has no footway. */
  private offsetFor(segment:number,side:1|-1){return this.offsets[segment*2+(side>0?0:1)]??0;}
  /** The cast currently on the street, for the tests and the debug read-out. */
  get skins(){return this.people.filter(person=>person.placed).map(person=>person.skin);}

  /**
   * Bring the cast in one at a time, in the background.
   *
   * The models are a few megabytes each and there are eleven of them, so downloading them
   * as part of the level would put minutes on the loading bar. They arrive after the world
   * does instead, one after another rather than all at once, and each one starts walking
   * the moment it lands. A model that will not load is simply a member of the cast who
   * stayed at home.
   */
  async populate(near:THREE.Vector3,options:{exclude?:string;animations?:AnimationSource;cast?:string}={}){
    for(const skin of VRM_MODELS){
      if(this.gone)return;
      if(skin===options.exclude)continue;
      try{
        const avatar=await new VrmAvatar().load(skin,{animations:options.animations,cast:options.cast});
        if(this.gone){avatar.dispose();return;}
        const person:Person={skin,avatar,path:new TrafficPath(this.routes,0,false,0,this.world.data.navigation),side:1,position:new THREE.Vector3(),target:new THREE.Vector3(),heading:0,wait:0,placed:false};
        avatar.walk(this.scene,person.position,0);
        avatar.group.visible=false;
        this.people.push(person);
        this.reseat(person,near);
      }catch(error){console.warn(`${skin} is not out today`,error);}
    }
  }

  /**
   * The player just became one of the cast, so that face cannot also be out walking.
   * The body is dropped rather than re-dressed: a VRM is its model, and swapping one for
   * another is the same download all over again.
   */
  exclude(skin:string){
    for(const person of this.people.filter(person=>person.skin===skin))person.avatar.dispose();
    this.people=this.people.filter(person=>person.skin!==skin);
  }

  /** Put somebody on a stretch of footway near the player, out of sight, facing along it. */
  private reseat(person:Person,near:THREE.Vector3){
    const navigation=this.world.data.navigation;
    if(!navigation||!this.routes.length)return;
    for(let attempt=0;attempt<48;attempt++){
      const segment=Math.floor(Math.random()*navigation.segments.length);
      const owner=navigation.roads[navigation.segments[segment].road];
      if(owner?.shortcut)continue;
      const first:1|-1=Math.random()<.5?1:-1;
      const side=this.offsetFor(segment,first)?first:this.offsetFor(segment,-first as 1|-1)?-first as 1|-1:0;
      if(!side)continue;                                   // this strip's kerbs are both other people's roads
      const path=new TrafficPath(this.routes,segment,false,Math.random(),navigation);
      const heading=path.sample(this.scratch);
      const spot=footwayPoint(this.scratch,heading,carriagewayEdges(navigation,segment),side,this.offsetFor(segment,side));
      const away=spot.distanceTo(near);
      if(away<PAVEMENT_RULES.nearRadius||away>PAVEMENT_RULES.farRadius)continue;
      const floor=footwayFloor(this.world.terrain,spot,this.scratch.y);
      if(floor===undefined)continue;
      person.path=path;person.side=side;person.heading=heading;
      person.position.copy(spot);person.position.y=floor+FOOT_CLEARANCE;person.target.copy(person.position);
      person.wait=Math.random()*PAVEMENT_RULES.waitSeconds;person.placed=true;
      person.avatar.group.position.copy(person.position);person.avatar.group.rotation.set(0,heading,0);
      return;
    }
  }

  update(dt:number,player:THREE.Vector3){
    const navigation=this.world.data.navigation;
    if(!navigation)return;
    for(const person of this.people){
      if(!person.placed){this.reseat(person,player);continue;}
      const distance=person.position.distanceTo(player);
      if(distance>PAVEMENT_RULES.removeRadius){this.reseat(person,player);continue;}
      const visible=distance<=PAVEMENT_RULES.drawDistance;
      person.avatar.group.visible=visible;
      // Out of sight they hold their place rather than walking on unseen, which keeps the
      // cast spread along the street you are actually looking at.
      if(!visible)continue;
      // Nobody walks through the player. They stop while you are in front of them and set
      // off again once you move, which is cheaper and reads better than steering around.
      const ahead=this.scratch.set(Math.sin(person.heading),0,Math.cos(person.heading));
      const toPlayer=player.clone().sub(person.position).setY(0);
      const blocked=toPlayer.length()<1.4&&toPlayer.normalize().dot(ahead)>.2;
      if(blocked)person.wait=PAVEMENT_RULES.waitSeconds;
      person.wait=Math.max(0,person.wait-dt);
      if(person.wait>0){person.avatar.play('hom_loco_idle_rest');person.avatar.update(dt);continue;}
      person.path.advance(PAVEMENT_RULES.speed*dt);
      const along=person.path.sample(this.scratch);
      // The footway can change sides at a corner, because the strip they turned onto has
      // its own outer edge. Cross over where it does, and start again where it runs out.
      if(!this.offsetFor(person.path.segment,person.side)){
        const other=-person.side as 1|-1;
        if(!this.offsetFor(person.path.segment,other)){this.reseat(person,player);continue;}
        person.side=other;
      }
      // The target only moves onto pavement. Where the path swings across a junction there
      // may be nothing clear at all for a moment; the target simply stays where it was, and
      // they stand at the kerb until the corner opens up, the way anyone would.
      const spot=this.grid?clearFootway(this.grid,this.scratch,along,carriagewayEdges(navigation,person.path.segment),person.side,this.offsetFor(person.path.segment,person.side))
        :footwayPoint(this.scratch,along,carriagewayEdges(navigation,person.path.segment),person.side,this.offsetFor(person.path.segment,person.side));
      if(spot)person.target.copy(spot);
      // They WALK to the target rather than being placed on it, so a corner that moves the
      // footway sideways is a step across, never a jump.
      const toTarget=this.step.copy(person.target).sub(person.position).setY(0);
      const travel=Math.min(toTarget.length(),PAVEMENT_RULES.speed*dt);
      const moving=travel>1e-4;
      if(moving){
        person.position.addScaledVector(toTarget.normalize(),travel);
        person.heading=Math.atan2(toTarget.x,toTarget.z);
      }
      // Follow the ground, but only as far as a stride can carry them. Without the clamp a
      // footway that passes a doorway or a drop hands back a floor metres away and the walk
      // becomes a jump up the wall or down the hole.
      const feet=person.position.y-FOOT_CLEARANCE;
      const floor=this.world.terrain.ground(person.position.x,person.position.z,person.position.y,4);
      const climb=PAVEMENT_RULES.climb*dt;
      person.position.y=(floor?THREE.MathUtils.clamp(floor.point.y,feet-climb,feet+climb):feet)+FOOT_CLEARANCE;
      person.avatar.group.position.copy(person.position);
      person.avatar.group.rotation.y=person.heading;
      person.avatar.play(moving?'hom_loco_walk':'hom_loco_idle_rest');
      person.avatar.update(dt);
    }
  }

  dispose(){
    this.gone=true;
    for(const person of this.people)person.avatar.dispose();
    this.people=[];
  }
}
