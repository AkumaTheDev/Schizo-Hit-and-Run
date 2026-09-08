"""Replace the bus's tiny alpha-text quads with lettering geometry in Blender."""
import bpy,bmesh,hashlib,json,math
from pathlib import Path
from mathutils import Matrix,Vector
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets/remaster';CONVERT=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
scene=bpy.context.scene;scene.name='School bus lettering'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(OUT/'car-schoolbu.glb'))
roots=[o for o in scene.objects if o.parent is None]
if len(roots)!=1 or not roots[0].name.startswith('car-schoolbu'):raise ValueError('Expected one school-bus root')
root=roots[0];root['sourceUVOrigin']='top-left';root['letteringVersion']=1
for obj in list(scene.objects):
    if obj.name.startswith('School bus '):
        bpy.data.objects.remove(obj,do_unlink=True);continue
    if obj.type!='MESH':continue
    slots={i for i,m in enumerate(obj.data.materials) if m and 'schoolbusGlow_m' in m.name}
    if slots:
        bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.material_index in slots],context='FACES');bm.to_mesh(obj.data);bm.free();obj.data.update()
black=bpy.data.materials.new('Bus lettering black');black.diffuse_color=(.008,.009,.01,1);black.use_nodes=True;shader=black.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.008,.009,.01,1);shader.inputs['Roughness'].default_value=.8
font=bpy.data.fonts.load('/System/Library/Fonts/Supplemental/Arial Narrow Bold.ttf')
labels=[
    ('front',(.0135,2.1034,-.334),(-1,0,0),(0,1,0),1.35,.26),
    ('rear',(.0135,2.1825,3.347),(1,0,0),(0,.9824,-.187),1.39,.23),
    ('left',(-1.485,.464,1.605),(0,0,1),(0,1,0),1.84,.3),
    ('right',(1.495,.464,1.609),(0,0,-1),(0,1,0),1.84,.3),
]
for name,center,right,up,width,height in labels:
    curve=bpy.data.curves.new('School bus '+name,'FONT');curve.body='SCHOOL BUS';curve.font=font;curve.align_x='CENTER';curve.align_y='CENTER';curve.extrude=.001;curve.resolution_u=8
    text=bpy.data.objects.new('School bus '+name,curve);scene.collection.objects.link(text);text.parent=root;text.data.materials.append(black)
    r=CONVERT@Vector(right);u=(CONVERT@Vector(up)).normalized();normal=r.cross(u).normalized();text.matrix_local=Matrix((r,u,normal)).transposed().to_4x4();text.location=CONVERT@Vector(center)
    bpy.context.view_layer.update();local=curve.copy();temporary=bpy.data.objects.new('measure',local);scene.collection.objects.link(temporary);bpy.context.view_layer.update();scale=min(width/max(temporary.dimensions.x,.001),height/max(temporary.dimensions.y,.001));bpy.data.objects.remove(temporary,do_unlink=True);bpy.data.curves.remove(local);text.scale=(scale,scale,scale)
collection=bpy.data.collections.new('School bus export');scene.collection.children.link(collection)
for obj in list(scene.objects):
    for owner in list(obj.users_collection):owner.objects.unlink(obj)
    collection.objects.link(obj)
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=str(OUT/'car-schoolbu.glb'),export_format='GLB',collection=collection.name,use_active_scene=True,export_apply=True,export_animations=False,export_extras=True)
manifest=json.loads((OUT/'uv-repair.json').read_text());row=next(r for r in manifest['vehicles'] if r['car']=='car-schoolbu');row['after']=hashlib.sha256((OUT/'car-schoolbu.glb').read_bytes()).hexdigest();row['lettering']='Four vector labels in the original label positions';(OUT/'uv-repair.json').write_text(json.dumps(manifest,indent=2)+'\n')
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=1600;scene.render.resolution_y=1100;scene.render.resolution_percentage=100
world=bpy.data.worlds.new('Bus studio');world.use_nodes=True;world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.15,.18,.23,1);world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.45;scene.world=world
low=min((obj.matrix_world@Vector(corner)).z for obj in collection.objects if obj.type=='MESH' for corner in obj.bound_box)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,low-.02));floor=bpy.context.object;floor.name='Studio floor';material=bpy.data.materials.new('Studio floor');material.diffuse_color=(.07,.08,.1,1);floor.data.materials.append(material)
for name,pos,power,size in [('Key',(5,6,9),1700,6),('Fill',(-5,3,6),1200,5),('Rim',(1,-6,7),2000,5)]:
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.shape='DISK';light.size=size;obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=pos;obj.rotation_euler=(Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()
camera_data=bpy.data.cameras.new('School bus camera');camera=bpy.data.objects.new('School bus camera',camera_data);scene.collection.objects.link(camera);camera.location=(8,11,5);camera.rotation_euler=(Vector((0,-.4,.9))-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.lens=53;scene.camera=camera
scene.render.filepath=str(ROOT/'artifacts/schoolbus-lettering-review.png');bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/vehicle-texture-repair.blend'));bpy.ops.render.render(write_still=True)
print(json.dumps({'vehicle':'schoolbu','labels':4,'review':scene.render.filepath,'errors':[]}),flush=True)
