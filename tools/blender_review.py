"""Create a studio review scene without changing the exported game assets."""
import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
review=bpy.data.scenes.new('Family Sedan - remaster review')
if bpy.context.window:bpy.context.window.scene=review
review.collection.children.link(bpy.data.collections['Remastered famil_v'])
world=bpy.data.worlds.new('Review world');world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.18,.21,.27,1);world.node_tree.nodes['Background'].inputs[1].default_value=.4;review.world=world
mesh=bpy.data.meshes.new('Review ground');mesh.from_pydata([(-100,-100,-.6),(100,-100,-.6),(100,100,-.6),(-100,100,-.6)],[],[(0,1,2,3)])
plane=bpy.data.objects.new('Review ground',mesh);review.collection.objects.link(plane)
mat=bpy.data.materials.new('Review concrete');mat.use_nodes=True;mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.25,.27,.3,1);mat.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.75;plane.data.materials.append(mat)
for name,location,power,color,size in [('Key',(3,4,7),1300,(1,.87,.74),5),('Fill',(-4,2,4),850,(.65,.78,1),4),('Rim',(1,-5,6),1700,(1,1,1),3)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size;obj=bpy.data.objects.new(name,data);review.collection.objects.link(obj);obj.location=location;obj.rotation_euler=(Vector((0,0,.4))-obj.location).to_track_quat('-Z','Y').to_euler()
camera_data=bpy.data.cameras.new('Vehicle review camera');camera=bpy.data.objects.new('Vehicle review camera',camera_data);review.collection.objects.link(camera);camera.location=(6,7,4);camera.rotation_euler=(Vector((0,0,.45))-camera.location).to_track_quat('-Z','Y').to_euler();camera_data.lens=52;review.camera=camera
review.render.engine='BLENDER_EEVEE';review.render.resolution_x=1200;review.render.resolution_y=900;review.render.resolution_percentage=100;review.render.filepath=str(ROOT/'blender/family-sedan-proof.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/hit-and-run-remaster.blend'))
bpy.ops.render.render(scene=review.name,write_still=True)
