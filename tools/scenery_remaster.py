"""Blender scenery pass: all regions, material detail, edge radii, UV/color preservation.
Run with Blender --background --python tools/scenery_remaster.py.
The untouched converted collision stream remains the gameplay collision source.
"""
import bpy,bmesh,json,math,re,numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];ASSETS=ROOT/'public/assets';OUT=ASSETS/'remaster';SCENES=OUT/'scenes';SCENES.mkdir(parents=True,exist_ok=True)
KINDS={
 'asphalt':dict(roughness=.94,metalness=0,bump=.022,scale=12),
 'grass':dict(roughness=.98,metalness=0,bump=.035,scale=9),
 'concrete':dict(roughness=.9,metalness=0,bump=.015,scale=10),
 'brick':dict(roughness=.88,metalness=0,bump=.025,scale=5),
 'wood':dict(roughness=.8,metalness=0,bump=.018,scale=4),
 'roof':dict(roughness=.88,metalness=0,bump=.018,scale=7),
 'metal':dict(roughness=.48,metalness=.52,bump=.004,scale=6),
 'glass':dict(roughness=.21,metalness=.12,bump=0,scale=1),
 'foliage':dict(roughness=.96,metalness=0,bump=.008,scale=6),
 'paint':dict(roughness=.81,metalness=0,bump=.006,scale=8),
 'art':dict(roughness=.86,metalness=0,bump=.003,scale=8),
}
def kind_for(names):
 n=' '.join(names).lower()
 for kind,pattern in [('art',r'sign|logo|billboard|poster|swatch|shadow|skid|stngls'),('glass',r'glass|window|_win'),('foliage',r'leaf|leaves|oak[ls]_|treeline|shrub|bush|pine|hedge'),('grass',r'grass'),('asphalt',r'asphalt|road|rd[12]_|crosswalk'),('concrete',r'concrete|s[di]?[ed]?[ew]*w[al]*lk|driveway|pavement|cement|curb'),('brick',r'brick|chim_|stone|found'),('wood',r'wood|cedar|trunk|fence|plank|timber'),('roof',r'roof|shingle'),('metal',r'metal|lamp|hydrant|mailbox|ladder|pipe|rail|dumpster'),('paint',r'stucco|house|mansion|grn_|pnk|pink|purple|yellow|blue|opt_')]:
  if re.search(pattern,n):return kind
 return 'art'
def write_image(name,array):
 h,w=array.shape[:2];image=bpy.data.images.new(name,width=w,height=h,alpha=True)
 image.pixels.foreach_set(array.astype(np.float32).ravel());image.filepath_raw=str(OUT/(name+'.png'));image.file_format='PNG';image.save();bpy.data.images.remove(image)
 return 'remaster/'+name+'.png'
def author_materials():
 scene=bpy.data.scenes.get('Scenery material library') or bpy.data.scenes.new('Scenery material library');result={}
 rng=np.random.default_rng(2003);size=512;yy,xx=np.mgrid[:size,:size];grain=rng.normal(0,1,(size,size))
 for kind,params in KINDS.items():
  height=grain*.08
  if kind=='wood':height+=np.sin(xx*.2+np.sin(yy*.025)*2)*.19
  if kind=='roof':height+=((yy%64)<4)*-.2
  if kind=='grass':height+=np.sin(xx*.75+yy*.07)*np.sin(yy*.24)*.18
  if kind=='brick':height+=np.sin(xx*.04)*np.sin(yy*.05)*.08
  bump=write_image('detail-'+kind,np.dstack([height*.5+.5]*3+[np.ones_like(height)]).clip(0,1))
  mat=bpy.data.materials.get('Scenery / '+kind) or bpy.data.materials.new('Scenery / '+kind);mat.use_nodes=True;p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=params['roughness'];p.inputs['Metallic'].default_value=params['metalness']
  tex=mat.node_tree.nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=params['scale']*8
  node=mat.node_tree.nodes.new('ShaderNodeBump');node.inputs['Strength'].default_value=.2;node.inputs['Distance'].default_value=params['bump'];mat.node_tree.links.new(tex.outputs['Fac'],node.inputs['Height']);mat.node_tree.links.new(node.outputs['Normal'],p.inputs['Normal'])
  result[kind]={**params,'detail':bump}
 (OUT/'material-library.json').write_text(json.dumps(result,indent=2));return result

def surfaces(files,library):
 sources={}
 for name in files:
  data=json.loads((ASSETS/(name+'.json')).read_text())
  for shader,mat in data['materials'].items():
   if mat.get('textureUrl'):sources.setdefault(mat['textureUrl'],[]).extend([shader,mat.get('texture','')])
 mapping={};counts={}
 for i,(url,names) in enumerate(sources.items()):
  kind=kind_for(names);counts[kind]=counts.get(kind,0)+1;original=bpy.data.images.load(str(ASSETS/url),check_existing=False);w,h=original.size
  # Preserve illustration, lettering, color and cutout alpha. Surface detail is
  # separate, so painted graphics do not become fabricated high-frequency art.
  factor=min(4,1024/max(w,h));tw,th=max(16,round(w*factor)),max(16,round(h*factor));original.scale(tw,th)
  original.filepath_raw=str(OUT/('scenery-'+Path(url).stem+'.png'));original.file_format='PNG';original.save();bpy.data.images.remove(original)
  mapping[url]={'albedo':'remaster/scenery-'+Path(url).stem+'.png','kind':kind,**library[kind],'sourceSize':[w,h],'size':[tw,th]}
  if i%100==0:print(f'Surfaces {i}/{len(sources)}',flush=True)
 (OUT/'scenery-materials.json').write_text(json.dumps(mapping,indent=2));return counts

def remesh(name):
 data=json.loads((ASSETS/(name+'.json')).read_text());source=(ASSETS/(name+'.bin')).read_bytes();blob=bytearray();before=after=bevelled=0
 def read(span,kind='<f4',width=3):return np.frombuffer(source,dtype=kind,offset=span[0],count=span[1]).reshape(-1,width)
 def put(array,kind='<f4'):
  a=np.ascontiguousarray(array,dtype=kind);span=[len(blob),a.size];blob.extend(a.tobytes());return span
 if data['collision']:data['collision']=put(read(data['collision']))
 for meshname,parts in data['meshes'].items():
  for part in parts:
   a=part['attributes'];pos=read(a['position']);idx=read(a['indices'],'<u4');before+=len(idx)
   mesh=bpy.data.meshes.new('scenery-pass');mesh.from_pydata(pos.tolist(),[],idx.tolist());mesh.update()
   loops=np.array([l.vertex_index for l in mesh.loops]);uv=mesh.uv_layers.new(name='UVMap');uv.data.foreach_set('uv',read(a['uv'],width=2)[loops].ravel())
   if 'color' in a:
    layer=mesh.color_attributes.new(name='Original lighting',type='FLOAT_COLOR',domain='CORNER');colors=read(a['color']);rgba=np.c_[colors,np.ones(len(colors))];layer.data.foreach_set('color',rgba[loops].ravel())
   bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
   kind=kind_for([part['shader'],meshname]);did=False
   if kind in ['wood','metal','brick','paint'] and len(idx)<2500:
    edges=[e for e in bm.edges if len(e.link_faces)==2 and e.calc_face_angle()>math.radians(45)]
    if edges:
     bmesh.ops.bevel(bm,geom=edges,offset=.008,segments=2,affect='EDGES',clamp_overlap=True);did=True;bevelled+=1
   for f in bm.faces:f.smooth=False
   bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update();mesh.calc_loop_triangles()
   # Export per-corner attributes to preserve UV and baked-color seams through bevels.
   loopids=np.array([i for t in mesh.loop_triangles for i in t.loops]);vertexids=np.array([mesh.loops[int(i)].vertex_index for i in loopids]);vertices=np.array([v.co[:] for v in mesh.vertices]);normals=np.array([n.vector[:] for n in mesh.corner_normals]);uvs=np.array([u.uv[:] for u in mesh.uv_layers.active.data])
   attrs={'position':put(vertices[vertexids]),'normal':put(normals[loopids]),'uv':put(uvs[loopids]),'indices':put(np.arange(len(loopids)),'<u4')}
   if 'color' in a:attrs['color']=put(np.array([c.color[:3] for c in mesh.color_attributes['Original lighting'].data])[loopids])
   part['attributes']=attrs;after+=len(loopids)//3;bpy.data.meshes.remove(mesh)
 data['remaster']={'sourceTriangles':before,'triangles':after,'bevelledParts':bevelled,'collisionPreserved':True}
 (SCENES/(name+'.json')).write_text(json.dumps(data,separators=(',',':')));(SCENES/(name+'.bin')).write_bytes(blob)
 print(name,data['remaster'],flush=True);return data['remaster']

def main():
 files=[]
 for level in range(1,8):
  files+=json.loads((ASSETS/f'level{level}.json').read_text())['scenes']
  files+=[i['scene'] for i in json.loads((ASSETS/f'campaign/level{level}.json').read_text())['interiors']]
 files=list(dict.fromkeys(files));library=author_materials();counts=surfaces(files,library);report={}
 for name in files:report[name]=remesh(name)
 (OUT/'scenery.json').write_text(json.dumps({'scenes':files,'materials':counts,'geometry':report},indent=2))
 bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/scenery-remaster.blend'))
 print('SCENERY COMPLETE',len(files),sum(counts.values()),flush=True)
if __name__=='__main__':main()
