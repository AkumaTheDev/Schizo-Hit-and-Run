import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const json=(file:string)=>JSON.parse(readFileSync(`public/assets/${file}`,'utf8'));
test('all original UI sprites and page descriptions are present',()=>{
  const sprites=json('ui/catalog.json'),layouts=json('ui/layouts.json'),fonts=json('ui/fonts.json');
  assert.equal(Object.keys(sprites).length,329);assert.equal(Object.keys(layouts).length,111);
  for(const sprite of Object.values(sprites) as any[])assert(existsSync(`public/assets/ui/${sprite.file}`));
  for(const c of 'NEW GAMEOPTIONS0123456789')assert(fonts.boulder_24.glyphs[c],`Missing original glyph ${c}`);
  assert(layouts['ingame/Hud.pag'].some((row:any)=>row.name==='HnRMeterFrame'&&row.images[0]==='radartop'));
});
test('all catalogued Blender vehicle exports contain valid geometry and original part names',()=>{
  for(const car of json('catalog.json').cars){
    const b=readFileSync(`public/assets/remaster/car-${car}.glb`);assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(8),b.length);
    const length=b.readUInt32LE(12),gltf=JSON.parse(b.toString('utf8',20,20+length));
    assert(gltf.meshes.length>0,`${car}: no geometry`);
    assert.equal(gltf.scenes[gltf.scene??0].nodes.length,1,`${car}: unrelated scene roots would replace the vehicle in the loader`);
    const names=new Set(gltf.nodes.map((node:any)=>node.extras?.p3dName));
    for(const object of json(`car-${car}.json`).objects)assert(names.has(object.name),`${car}: missing original part ${object.name}`);
    for(const mesh of gltf.meshes)for(const primitive of mesh.primitives){assert(gltf.accessors[primitive.attributes.POSITION].count>0);if(primitive.indices!==undefined)assert(gltf.accessors[primitive.indices].count%3===0);}
    for(const accessor of gltf.accessors){if(accessor.min)assert(accessor.min.every(Number.isFinite));if(accessor.max)assert(accessor.max.every(Number.isFinite));}
  }
});
test('pursuit vehicles retain working beacon tags and the exported tyre normal map',()=>{
  for(const car of ['cpolice','chears']){
    const b=readFileSync(`public/assets/remaster/car-${car}.glb`),gltf=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
    assert.equal(gltf.nodes.filter((node:any)=>node.extras?.pursuitBeacon).length,2);
    assert(gltf.materials.some((material:any)=>material.name==='Pursuit tyre rubber'&&material.normalTexture));
  }
});
test('vehicle texture origins are corrected and the bus lettering is real geometry',()=>{
  for(const car of json('catalog.json').cars){
    const b=readFileSync(`public/assets/remaster/car-${car}.glb`),g=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
    assert(g.asset.extras?.sourceUVOrigin==='top-left'||g.nodes.some((n:any)=>n.extras?.sourceUVOrigin==='top-left'),`${car}: missing UV correction`);
    if(car==='schoolbu')for(const side of ['front','rear','left','right']){const node=g.nodes.find((n:any)=>n.name===`School bus ${side}`);assert(node?.mesh!==undefined,`Missing ${side} lettering geometry`);assert(g.meshes[node.mesh].primitives.length>0);}
  }
});
test('Blender surface replacements resolve to 1024 pixel PNGs',()=>{
  const overrides=json('remaster/surfaces.json');assert(Object.keys(overrides).length>=50);
  for(const path of Object.values(overrides) as string[]){const image=readFileSync(`public/assets/${path}`);assert.equal(image.readUInt32BE(16),1024);assert.equal(image.readUInt32BE(20),1024);}
});
