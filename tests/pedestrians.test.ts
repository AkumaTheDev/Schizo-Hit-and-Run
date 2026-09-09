import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { assetJSON,worldFixture } from './world-fixture.ts';
import { carriagewayEdges,carriagewayGrid,clearFootway,footwayClear,footwayFloor,footwayPoint,onCarriageway,pavementSides,rightOf,PAVEMENT_RULES } from '../src/pedestrians.ts';
import { TrafficPath } from '../src/traffic-path.ts';
import type { RoadNavigation } from '../src/road-data.ts';

/**
 * A pedestrian walks the road graph and stands off to one side of it. What makes that
 * the PAVEMENT rather than the middle of the road is the offset being measured from the
 * edge of the tarmac, so these check the offset against the real level's own corners.
 */
const navigation=assetJSON('world/navigation1') as RoadNavigation;
/** The least a pedestrian is ever allowed to stand from the edge of the tarmac. */
const CLEARANCE=1;
const roads=(assetJSON('level1').roads as number[][][]).map(road=>road.map(p=>new THREE.Vector3(...p as [number,number,number])));

/**
 * Signed distance across the carriageway at a point `t` along the segment, from the
 * corner-0 edge toward the corner-3 one. Measured on the LOCAL cross-section: a segment
 * that tapers is a different width at each end, and comparing a midpoint against the
 * width at the start reads as a pedestrian in the road when it is standing on the kerb.
 */
function across(navigation:RoadNavigation,segment:number,point:THREE.Vector3,t=.5){
  const corners=navigation.segments[segment].corners.map(c=>new THREE.Vector3(...c).setY(0));
  const near=corners[0].clone().lerp(corners[1],t),far=corners[3].clone().lerp(corners[2],t);
  const axis=far.clone().sub(near),width=axis.length();
  return {at:point.clone().setY(0).sub(near).dot(axis)/width,width};
}

test('every segment puts both footways clear of the tarmac, on opposite sides', () => {
  for(let segment=0;segment<navigation.segments.length;segment++){
    const path=new TrafficPath(roads,segment,false,.5,navigation);
    const centre=new THREE.Vector3(),heading=path.sample(centre);
    const edges=carriagewayEdges(navigation,segment);
    const right=footwayPoint(centre,heading,edges,1),left=footwayPoint(centre,heading,edges,-1);
    const a=across(navigation,segment,right),b=across(navigation,segment,left);
    // Outside both edges of the road, by the pavement offset, on this segment's own width.
    // Clear of the tarmac on both sides. Not by the full offset everywhere: the offset is
    // measured square to the direction of travel, and a segment whose two ends are not
    // parallel has a cross-section that is not square to it, which costs a little of the
    // step. Measured over level 1, the worst case keeps 1.11m and the median keeps 1.70m.
    for(const {at,width} of [a,b])
      assert.ok(at<=-CLEARANCE||at>=width+CLEARANCE,
        `segment ${segment} stands a pedestrian ${at.toFixed(2)} across a ${width.toFixed(2)}m road`);
    assert.ok(Math.sign(a.at)!==Math.sign(b.at-b.width),`segment ${segment} puts both footways on one side`);
    assert.ok(right.distanceTo(left)>edges.nearSide+edges.farSide,`segment ${segment} has the two footways inside the road`);
  }
});

test('a multi-lane road measures the offset from the kerb, not from the lane', () => {
  // Lane 0 of a wide road is nowhere near its middle, so a fixed offset from the LINE
  // would put the far-side pedestrian in traffic. The two edges must differ by the
  // width the lane is off centre, and both footways still clear the tarmac.
  const wide=navigation.segments.findIndex(s=>s.lanes>1);
  if(wide<0)return;                       // level 1 may be single carriageway throughout
  const edges=carriagewayEdges(navigation,wide);
  assert.notEqual(edges.nearSide.toFixed(3),edges.farSide.toFixed(3));
  const path=new TrafficPath(roads,wide,false,.5,navigation);
  const centre=new THREE.Vector3(),heading=path.sample(centre);
  for(const side of [1,-1] as const){
    const {at,width}=across(navigation,wide,footwayPoint(centre,heading,edges,side));
    assert.ok(at<0||at>width,`lane ${wide} side ${side} stands in the road`);
  }
});

test('the right of a heading is the walker\'s own right', () => {
  // Facing +Z with Y up, your right hand points at -X.
  const right=rightOf(0);
  assert.ok(Math.abs(right.x+1)<1e-9&&Math.abs(right.z)<1e-9,`${right.x}, ${right.z}`);
  const east=rightOf(Math.PI/2);          // facing +X, right hand points at +Z
  assert.ok(Math.abs(east.x)<1e-9&&Math.abs(east.z-1)<1e-9,`${east.x}, ${east.z}`);
});

test('walking the streets the way the game walks them never steps into the road', () => {
  // The shipped loop, without the bodies: follow the path, take the side that has a
  // footway, cross over where it runs out, and check every step against every carriageway.
  const sides=pavementSides(navigation);
  const grid=carriagewayGrid(navigation);
  const centre=new THREE.Vector3();
  let steps=0,crossings=0,moved=0,held=0;
  const target=new THREE.Vector3();
  for(let start=0;start<navigation.segments.length;start+=11){
    let side:1|-1=sides[start*2]?1:-1;
    if(!sides[start*2+(side>0?0:1)])continue;
    const path=new TrafficPath(roads,start,false,0,navigation);
    for(let step=0;step<400;step++){
      const heading=path.sample(centre);
      let offset=sides[path.segment*2+(side>0?0:1)];
      if(!offset){
        const other=-side as 1|-1;
        offset=sides[path.segment*2+(other>0?0:1)];
        if(!offset)break;                      // the game reseats them here
        side=other;crossings++;
      }
      // Only the carriageway test is meaningful here. Between segments the path is a curve
      // through the junction, so the walker is nowhere near the cross-section of the
      // segment it is leaving, and measuring across THAT reads as metres into a road that
      // is not underneath it. The per-segment tests above cover the cross-section.
      const spot=clearFootway(grid,centre,heading,carriagewayEdges(navigation,path.segment),side,offset);
      if(spot){
        assert.ok(!onCarriageway(grid,new THREE.Vector2(spot.x,spot.z),centre.y,-1),
          `step ${step} from segment ${start} stands in the road on segment ${path.segment}`);
        target.copy(spot);moved++;
      }else held++;                            // nothing clear: they stand at the kerb
      steps++;path.advance(PAVEMENT_RULES.speed);
    }
  }
  assert.ok(steps>2000,`only ${steps} steps walked`);
  assert.ok(crossings>0,'never had to change sides, so that path is untested');
  // Standing at a kerb is allowed, but it has to be the exception, not the walk.
  assert.ok(moved>held*12,`held still on ${held} of ${steps} steps`);
  assert.ok(target.lengthSq()>0,'never found a single pavement to walk on');
});

test('a footway over a wall or a drop is refused, and the rest of the street is not', () => {
  const {data,terrain}=worldFixture();
  const navigation=data.navigation!;
  const roads=data.roads.map(road=>road.map(p=>new THREE.Vector3(...p as [number,number,number])));
  let standable=0,refused=0;
  for(let segment=0;segment<navigation.segments.length;segment+=3){
    const path=new TrafficPath(roads,segment,false,.5,navigation);
    const centre=new THREE.Vector3(),heading=path.sample(centre);
    const edges=carriagewayEdges(navigation,segment);
    for(const side of [1,-1] as const){
      const floor=footwayFloor(terrain,footwayPoint(centre,heading,edges,side),centre.y);
      if(floor===undefined){refused++;continue;}
      standable++;
      assert.ok(Math.abs(floor-centre.y)<=PAVEMENT_RULES.kerb,'a standable footway is near its own road');
    }
  }
  // Almost all of the street is walkable; the handful that are not is the point of the check.
  assert.ok(standable>refused*40,`only ${standable} of ${standable+refused} footway points can be stood on`);
  assert.ok(refused>0,'nothing was refused, so the check is not doing anything');
  terrain.dispose();
});

/**
 * The one that matters. Springfield lays each direction of a street down as its own strip
 * of carriageway, so "outside the strip I am following" is the middle of the road nearly
 * two times in five. A footway has to be outside EVERY strip.
 */
test('a chosen footway is off every carriageway, not just its own', () => {
  const sides=pavementSides(navigation);
  const grid=carriagewayGrid(navigation);
  let footways=0,strips=0;
  for(let segment=0;segment<navigation.segments.length;segment++){
    const data=navigation.segments[segment];
    const corners=data.corners.map(c=>new THREE.Vector3(...c));
    const fraction=.5/data.lanes;
    const a=corners[0].clone().lerp(corners[3],fraction),b=corners[1].clone().lerp(corners[2],fraction);
    const heading=Math.atan2(b.x-a.x,b.z-a.z),edges=carriagewayEdges(navigation,segment);
    let usable=false;
    for(const side of [1,-1] as const){
      const offset=sides[segment*2+(side>0?0:1)];
      if(!offset)continue;
      usable=true;footways++;
      // The whole line, not samples along it. Two strips can overlap in a band narrower
      // than any sample spacing, and that band is where a junction's strips cross.
      const start=footwayPoint(a,heading,edges,side,offset),end=footwayPoint(b,heading,edges,side,offset);
      assert.ok(footwayClear(grid,new THREE.Vector2(start.x,start.z),new THREE.Vector2(end.x,end.z),a.y,b.y,-1),
        `segment ${segment} side ${side} runs its footway across a carriageway`);
      // And spot-check the point test agrees, so the two cannot drift apart.
      for(let t=0;t<=1;t+=1/8){
        const centre=a.clone().lerp(b,t),spot=footwayPoint(centre,heading,edges,side,offset);
        assert.ok(!onCarriageway(grid,new THREE.Vector2(spot.x,spot.z),centre.y,-1),
          `segment ${segment} side ${side} stands a pedestrian on the road at ${t.toFixed(2)} along`);
      }
    }
    if(usable)strips++;
  }
  assert.ok(strips>navigation.segments.length*.9,`only ${strips} of ${navigation.segments.length} strips have a footway`);
  assert.ok(footways>strips,'no street has a footway on both sides');
});

test('a side with no footway is refused rather than pushed across the street', () => {
  const sides=pavementSides(navigation);
  for(let i=0;i<sides.length;i++)
    assert.ok(sides[i]===0||(sides[i]>=PAVEMENT_RULES.offset&&sides[i]<=PAVEMENT_RULES.offset+PAVEMENT_RULES.budget+1e-5),
      `offset ${sides[i]} is neither refused nor within the budget`);
});
