import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,existsSync } from 'node:fs';
const json=(name:string)=>JSON.parse(readFileSync(`public/assets/${name}.json`,'utf8'));
for(let level=1;level<=7;level++)test(`level ${level} retains source lanes, world objects and terrain materials`,()=>{
  const data=json(`level${level}`),nav=json(`world/navigation${level}`),world=json(`world/objects${level}`),junctions=new Set(nav.junctions.map((j:any)=>j.name));
  const remastered=new Set(json('remaster/scenery').scenes),rendered=new Set<string>();
  for(const scene of [...data.scenes,...world.extras])for(const object of json(remastered.has(scene)?`remaster/scenes/${scene}`:scene).objects)if(object.movable)rendered.add(object.interactiveId);
  assert.equal(nav.segments.length,data.roads.length);assert(world.props.length>300);assert.equal(new Set(world.props.map((p:any)=>p.id)).size,world.props.length);
  for(const road of nav.roads){assert(junctions.has(road.start));assert(junctions.has(road.end));assert(road.segments.length>0);for(const i of road.segments)assert(nav.segments[i]);}
  for(const segment of nav.segments){assert(segment.lanes>0);assert.equal(segment.corners.length,4);assert(segment.corners.flat().every(Number.isFinite));}
  for(const p of world.props){assert(p.id.includes(p.scene));assert.equal(p.matrix.length,16);assert(p.shapes.length);if(p.kind!==2)assert(rendered.has(p.id),`Missing rendered world object ${p.id}`);for(const shape of p.shapes){assert.equal(shape.transform.length,16);assert(shape.transform.every(Number.isFinite));}}
  assert(world.props.some((p:any)=>/crate/i.test(p.model)));for(const extra of world.extras)assert(json(extra).objects.length>0);
  for(const scene of data.scenes){const meta=json(scene);assert.equal(world.terrainTypes[scene].length,(meta.collision?.[1]??0)/9);}
  assert(existsSync(`public/assets/${world.coin}.bin`));
});
test('the bus body UVs agree with the source atlas instead of its vertical mirror',()=>{
  const raw=json('car-schoolbu'),source=readFileSync('public/assets/car-schoolbu.bin'),keys=new Set<string>(),flipped=new Set<string>(),key=(u:number,v:number)=>`${Math.round(u*1e4)},${Math.round(v*1e4)}`;
  for(const parts of Object.values(raw.meshes) as any[])for(const p of parts)if(p.shader==='schoolbus_m'){
    const [offset,length]=p.attributes.uv;for(let i=0;i<length;i+=2){const u=source.readFloatLE(offset+i*4),v=source.readFloatLE(offset+(i+1)*4);keys.add(key(u,v));flipped.add(key(u,1-v));}
  }
  const b=readFileSync('public/assets/remaster/car-schoolbu.glb'),length=b.readUInt32LE(12),g=JSON.parse(b.toString('utf8',20,20+length)),binary=b.subarray(28+length);let correct=0,wrong=0;
  for(const mesh of g.meshes)for(const p of mesh.primitives)if(g.materials[p.material]?.name==='HR_schoolbu_schoolbus_m'){
    const a=g.accessors[p.attributes.TEXCOORD_0],v=g.bufferViews[a.bufferView],offset=(v.byteOffset??0)+(a.byteOffset??0);
    for(let i=0;i<a.count;i++){const at=offset+i*(v.byteStride??8),k=key(binary.readFloatLE(at),binary.readFloatLE(at+4));correct+=Number(keys.has(k));wrong+=Number(flipped.has(k));}
  }
  assert(correct>500&&correct>wrong*2,`source ${correct}, mirrored ${wrong}`);
});
