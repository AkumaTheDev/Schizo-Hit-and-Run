import * as THREE from 'three';

/**
 * The rifle, ported part for part from the sibling project's AKM.
 *
 * Every pivot, dimension and colour below is that model's, kept to the millimetre so
 * the gun in your hands is the same gun: 880 mm overall with the barrel 415 of it, the
 * muzzle at z −0.47, the grip socket at +0.14, the support hand on the magwell at
 * −0.02, the butt at +0.42, the barrel axis at y 0.03 and the sight line at ~0.095.
 *
 * It is built in the WEAPON FRAME — muzzle along −z, up +y, right +x — which is the
 * frame the hold offsets and the muzzle position below are expressed in.
 *
 * The parts a box would lie about are extruded outlines rather than boxes: a silhouette
 * is made of edges, and a box has one. The stock drops to its toe, the grip rakes, the
 * magazine curves, the trigger guard is a loop, the muzzle brake is cut on the slant.
 */
const STEEL=0x9aa1a8,STEEL_DARK=0x565e66,BLACK=0x22262b,BLACK_DEEP=0x17191c;
/** The furniture: the reddish laminate an AKM wears, and the bakelite of mag and grip. */
const WOOD=0x7a4a2c,BAKELITE=0x8f4f2a;

/** Where the round leaves, in the weapon frame. */
export const MUZZLE=new THREE.Vector3(0,0.04,-0.47);
/** Where the firing hand grips, and where the support hand meets the magwell. */
export const GRIP=new THREE.Vector3(0,-0.03,0.14),SUPPORT=new THREE.Vector3(0,-0.04,-0.02);

type Part={geom:THREE.BufferGeometry;at:[number,number,number];rot?:THREE.Quaternion;colour:number};
const box=(w:number,h:number,d:number)=>new THREE.BoxGeometry(w,h,d);
const cylinder=(length:number,radius:number)=>new THREE.CylinderGeometry(radius,radius,length,12);
const axis=(x:number,y:number,z:number,angle:number)=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(x,y,z),angle);
/**
 * A side outline extruded to its thickness: the points are (z, y) in the weapon frame
 * and the extrusion runs across the gun in x, centred on the bore line.
 */
function profile(points:[number,number][],thickness:number){
  const shape=new THREE.Shape();
  points.forEach(([u,v],i)=>i===0?shape.moveTo(u,v):shape.lineTo(u,v));
  shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:thickness,bevelEnabled:false,curveSegments:4});
  geometry.translate(0,0,-thickness/2);geometry.rotateY(-Math.PI/2);geometry.computeVertexNormals();
  return geometry;
}
const spin=Math.PI/2;

const PARTS:Record<string,Part>={
  // --- The barrel group, muzzle back. The bore is the bullet's exit, not an ornament,
  // and the brake is the AK's slant compensator — a short block cut on the diagonal.
  barrel:{geom:cylinder(0.4,0.011),at:[0,0.03,-0.26],rot:axis(1,0,0,spin),colour:STEEL_DARK},
  brake:{geom:profile([[-0.476,0.052],[-0.438,0.052],[-0.438,0.008],[-0.458,0.008]],0.024),at:[0,0,0],colour:STEEL_DARK},
  bore:{geom:cylinder(0.006,0.006),at:[0,0.03,-0.477],rot:axis(1,0,0,spin),colour:BLACK_DEEP},
  // The front sight: a post between two ears, at the muzzle end where an AK carries it.
  sightBlock:{geom:box(0.024,0.032,0.03),at:[0,0.032,-0.41],colour:BLACK},
  sightF:{geom:box(0.005,0.05,0.005),at:[0,0.07,-0.41],colour:BLACK_DEEP},
  earL:{geom:box(0.005,0.046,0.018),at:[-0.012,0.07,-0.41],colour:BLACK},
  earR:{geom:box(0.005,0.046,0.018),at:[0.012,0.07,-0.41],colour:BLACK},
  // Gas block and the tube it feeds back over the barrel — the line that makes an AK.
  gasBlock:{geom:box(0.026,0.044,0.03),at:[0,0.05,-0.3],colour:BLACK},
  gasTube:{geom:cylinder(0.17,0.011),at:[0,0.068,-0.2],rot:axis(1,0,0,spin),colour:STEEL_DARK},
  handguardUp:{geom:box(0.036,0.026,0.13),at:[0,0.068,-0.19],colour:WOOD},
  handguard:{geom:box(0.046,0.05,0.17),at:[0,0.008,-0.2],colour:WOOD},
  rod:{geom:cylinder(0.3,0.004),at:[0,-0.008,-0.31],rot:axis(1,0,0,spin),colour:STEEL},
  // --- The receiver: a stamped box under a rounded dust cover, the tangent rear sight
  // forward on it, the ejection port and charging handle on the right, selector below.
  receiver:{geom:box(0.05,0.062,0.23),at:[0,0.012,0],colour:BLACK},
  cover:{geom:cylinder(0.2,0.025),at:[0,0.04,-0.005],rot:axis(1,0,0,spin),colour:BLACK},
  sightBase:{geom:box(0.034,0.028,0.04),at:[0,0.068,-0.1],colour:BLACK},
  sightR:{geom:box(0.012,0.03,0.028),at:[0,0.088,-0.1],colour:BLACK_DEEP},
  port:{geom:box(0.004,0.02,0.05),at:[0.026,0.034,-0.02],colour:BLACK_DEEP},
  handle:{geom:cylinder(0.04,0.007),at:[0.045,0.045,0.005],rot:axis(0,0,1,spin),colour:STEEL},
  handleKnob:{geom:box(0.018,0.016,0.02),at:[0.062,0.045,0.005],colour:STEEL_DARK},
  selector:{geom:box(0.004,0.011,0.09),at:[0.027,0.004,0.035],rot:axis(1,0,0,-0.12),colour:STEEL_DARK},
  // --- The magazine: the banana, a bakelite curve hanging from the well and sweeping
  // forward, rooted a few millimetres up into the receiver, its catch behind it.
  mag:{geom:profile([[0.018,-0.012],[-0.058,-0.012],[-0.074,-0.085],[-0.104,-0.16],[-0.124,-0.195],[-0.088,-0.21],[-0.052,-0.14],[-0.024,-0.06]],0.03),at:[0,0,0],colour:BAKELITE},
  magRelease:{geom:box(0.014,0.024,0.014),at:[0,-0.03,0.032],colour:STEEL_DARK},
  // --- The trigger group: a guard that is a LOOP, the trigger inside it, and the
  // bakelite grip raking back under the receiver's tail.
  guard:{geom:profile([[0.022,-0.017],[0.022,-0.056],[0.118,-0.056],[0.118,-0.017],[0.11,-0.017],[0.11,-0.048],[0.03,-0.048],[0.03,-0.017]],0.012),at:[0,0,0],colour:BLACK},
  trigger:{geom:box(0.008,0.03,0.008),at:[0,-0.033,0.068],rot:axis(1,0,0,-0.3),colour:STEEL_DARK},
  grip:{geom:profile([[0.1,-0.014],[0.152,-0.014],[0.18,-0.108],[0.136,-0.112],[0.108,-0.045]],0.034),at:[0,0,0],colour:BAKELITE},
  // --- The stock: the wooden butt seated into the receiver's tail, its lower line
  // dropping away to the toe, a steel plate at the point that sits in the shoulder.
  stock:{geom:profile([[0.104,0.032],[0.42,0.03],[0.424,-0.072],[0.17,-0.05],[0.104,-0.034]],0.04),at:[0,0,0],colour:WOOD},
  buttPlate:{geom:box(0.044,0.104,0.008),at:[0,-0.021,0.425],rot:axis(1,0,0,0.04),colour:BLACK_DEEP},
  // The torch slung under the handguard's nose, seated up into the wood.
  torch:{geom:cylinder(0.08,0.014),at:[0,-0.036,-0.31],rot:axis(1,0,0,spin),colour:BLACK_DEEP},
  torchLens:{geom:cylinder(0.008,0.011),at:[0,-0.036,-0.355],rot:axis(1,0,0,spin),colour:BLACK_DEEP},
};

/**
 * Build the rifle. The returned group is in the weapon frame and keeps the parts that
 * move — the charging handle rides the bolt on every round, the magazine leaves the
 * well on a reload — as named children, so the firing code can work them.
 */
export function buildRifle(){
  const rifle=new THREE.Group();rifle.name='rifle';
  const materials=new Map<number,THREE.Material>();
  for(const [name,part] of Object.entries(PARTS)){
    const metal=part.colour===STEEL||part.colour===STEEL_DARK;
    let material=materials.get(part.colour);
    if(!material){
      material=new THREE.MeshStandardMaterial({color:part.colour,roughness:metal?0.42:0.78,metalness:metal?0.75:0.05});
      materials.set(part.colour,material);
    }
    const mesh=new THREE.Mesh(part.geom,material);
    mesh.name=name;mesh.position.set(...part.at);
    if(part.rot)mesh.quaternion.copy(part.rot);
    mesh.castShadow=true;mesh.receiveShadow=true;
    rifle.add(mesh);
  }
  return rifle;
}
/** Free what a built rifle owns. The geometries are shared, so only its materials go. */
export function disposeRifle(rifle:THREE.Group){
  const seen=new Set<THREE.Material>();
  rifle.traverse(node=>{if(node instanceof THREE.Mesh)seen.add(node.material as THREE.Material);});
  for(const material of seen)material.dispose();
  rifle.removeFromParent();
}
