"""Blender pursuit vehicle pass: source proportions, lens geometry and tyre detail."""
import bpy
import json
import math
import numpy as np
from pathlib import Path
from mathutils import Vector
import blender_remaster as base

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/assets/remaster'
CARS=['cpolice','chears','burnsarm','fishtruc','glastruc','hallo','sportsb','suva','witchcar']


def tyre_material():
    material=bpy.data.materials.get('Pursuit tyre rubber')
    if material:return material
    material=base.solid('Pursuit tyre rubber',(.018,.022,.028),0,.88)
    size=512;v,u=np.mgrid[0:size,0:size].astype(np.float32)/size
    shoulder=np.maximum(0,np.cos(v*math.tau))**2
    blocks=(.5+.5*np.cos(math.tau*(u*38+v*3)))**8
    height=.45*blocks*shoulder
    dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*4
    dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*4
    normal=np.stack([-dx,-dy,np.ones_like(dx)],axis=2)
    normal/=np.linalg.norm(normal,axis=2,keepdims=True)
    rgba=np.concatenate([normal*.5+.5,np.ones((size,size,1),np.float32)],axis=2)
    image=bpy.data.images.new('Pursuit tyre tread normal',width=size,height=size,alpha=True)
    image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(rgba.astype(np.float32).ravel())
    image.filepath_raw=str(OUT/'pursuit-tyre-normal.png');image.file_format='PNG';image.save()
    texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image
    mapped=material.node_tree.nodes.new('ShaderNodeNormalMap');mapped.inputs['Strength'].default_value=.8
    material.node_tree.links.new(texture.outputs['Color'],mapped.inputs['Color'])
    material.node_tree.links.new(mapped.outputs['Normal'],material.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
    return material


def join_meshes(objects,name):
    if not objects:return None
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    obj=bpy.context.view_layer.objects.active;obj.name=name
    return obj


def rounded_box(name,center,dimensions,material,parent,collection,bevel=.018):
    bpy.ops.mesh.primitive_cube_add(size=1,location=center)
    obj=bpy.context.object;obj.name=name;obj.dimensions=dimensions
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for owner in list(obj.users_collection):owner.objects.unlink(obj)
    collection.objects.link(obj)
    world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_world=world
    obj.data.materials.append(material)
    modifier=obj.modifiers.new('Rounded lens edge','BEVEL');modifier.width=bevel;modifier.segments=4
    normal=obj.modifiers.new('Lens normals','WEIGHTED_NORMAL');normal.keep_sharp=True
    return obj


def replace_beacon(obj,car,collection):
    points=[obj.matrix_world@Vector(c) for c in obj.bound_box]
    low=Vector([min(p[i] for p in points) for i in range(3)]);high=Vector([max(p[i] for p in points) for i in range(3)])
    size=high-low;middle=(low+high)/2;parent=obj.parent
    # Keep the decoded bar as a reference in the blend, outside exported collections.
    reference=bpy.data.collections.get('Pursuit source lenses')
    if reference is None:
        reference=bpy.data.collections.new('Pursuit source lenses')
        source_scene=bpy.data.scenes.new('Pursuit source references');source_scene.collection.children.link(reference)
    for owner in list(obj.users_collection):owner.objects.unlink(obj)
    reference.objects.link(obj)
    base_material=base.solid('Pursuit beacon housing',(.025,.031,.037),.65,.25)
    rounded_box(car+' beacon housing',(middle.x,middle.y,low.z+size.z*.1),(size.x,size.y,size.z*.2),base_material,parent,collection,.008)
    # Colours follow the source UV samples: red/blue cruiser and green/amber hearse.
    palette=[(199,20,68),(4,52,177)] if car=='cpolice' else [(0,163,96),(255,123,0)]
    for side,color in zip([-1,1],palette):
        linear=tuple((c/255)**2.2 for c in color)
        material=base.solid(f'Pursuit {car} lens {side}',linear,.05,.16)
        shader=material.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Coat Weight'].default_value=.8;shader.inputs['Coat Roughness'].default_value=.12
        shader.inputs['Emission Color'].default_value=(*linear,1);shader.inputs['Emission Strength'].default_value=.65
        width=size.x*.46;center=(middle.x+side*size.x*.255,middle.y,low.z+size.z*.59)
        lens=rounded_box(f'{car} beacon lens {side}',center,(width,size.y*.96,size.z*.78),material,parent,collection,min(.026,size.z*.15))
        parts=[lens]
        for rib in range(9):
            x=center[0]+width*(rib/8-.5)*.9
            parts.append(rounded_box('Lens rib',(x,center[1],center[2]),(width*.016,size.y*.982,size.z*.81),material,parent,collection,.002))
        joined=join_meshes(parts,f'{car} beacon {side}');joined['pursuitBeacon']=True
    return {'car':car,'sourceBounds':[list(low),list(high)],'palette':palette}


def upgrade(scene):
    rubber=tyre_material();lights=[];reports=[]
    for collection in scene.collection.children:
        car=collection.get('pursuitCar') or next((name for name in CARS if collection.name=='Remastered '+name),None)
        if not car:continue
        collection['pursuitCar']=car
        if collection.get('pursuitUpgrade')!=1:
            for obj in list(collection.objects):
                if obj.type!='MESH':continue
                for index,material in enumerate(obj.data.materials):
                    if material.name=='HR_Rubber':obj.data.materials[index]=rubber;continue
                    if material.name.startswith('HR_'+car+'_'):
                        shader=material.node_tree.nodes.get('Principled BSDF')
                        for node in material.node_tree.nodes:
                            if node.type=='TEX_IMAGE':node.interpolation='Linear'
                        if 'windsheild' in material.name.lower():
                            shader.inputs['Metallic'].default_value=.08;shader.inputs['Roughness'].default_value=.09
                            shader.inputs['Coat Weight'].default_value=.9
                        elif 'bottom' in material.name.lower():
                            shader.inputs['Metallic'].default_value=.05;shader.inputs['Roughness'].default_value=.85;shader.inputs['Coat Weight'].default_value=0
                        elif 'char_swatches' in material.name.lower():
                            shader.inputs['Metallic'].default_value=0;shader.inputs['Roughness'].default_value=.85;shader.inputs['Coat Weight'].default_value=0
                        else:
                            shader.inputs['Metallic'].default_value=.22;shader.inputs['Roughness'].default_value=.3
                            shader.inputs['Coat Weight'].default_value=.58;shader.inputs['Coat Roughness'].default_value=.15
            for obj in list(collection.objects):
                if obj.type=='MESH' and any(m.name in ['HR_cpolice_cPoliceLights_m','HR_chears_cHears_lights_m'] for m in obj.data.materials):collection['pursuitSourceLight']=json.dumps(replace_beacon(obj,car,collection))
            for wheel in [o for o in collection.objects if o.get('p3dName') in ['w0','w1','w2','w3']]:
                join_meshes([o for o in wheel.children if o.type=='MESH'],car+' wheel assembly')
            collection['pursuitUpgrade']=1
        if collection.get('pursuitSourceLight'):lights.append(json.loads(collection['pursuitSourceLight']))
        bpy.context.view_layer.update()
        path=OUT/f'car-{car}.glb'
        bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',collection=collection.name,use_active_scene=True,export_apply=True,export_animations=False,export_extras=True)
        dependency=bpy.context.evaluated_depsgraph_get();triangles=0
        for obj in collection.objects:
            if obj.type=='MESH':triangles+=sum(len(face.vertices)-2 for face in obj.evaluated_get(dependency).data.polygons)
        reports.append({'car':car,'triangles':triangles,'meshObjects':sum(o.type=='MESH' for o in collection.objects),'beacons':sum(bool(o.get('pursuitBeacon')) for o in collection.objects),'bytes':path.stat().st_size})
    manifest={'cars':reports,'sourceLights':lights,'tyreNormal':'pursuit-tyre-normal.png','errors':[]}
    (OUT/'pursuit-vehicles.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest


def review_scene(source):
    scene=bpy.data.scenes.new('Pursuit vehicle review');scene.render.engine='BLENDER_EEVEE'
    scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
    world=bpy.data.worlds.new('Pursuit studio');world.use_nodes=True;world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.12,.15,.21,1);world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.35;scene.world=world
    for car,x in [('cpolice',-2.25),('chears',2.25)]:
        collection=next(c for c in source.collection.children if c.get('pursuitCar')==car or c.name=='Remastered '+car)
        low=min((part.matrix_world@Vector(corner)).z for part in collection.objects if part.type=='MESH' for corner in part.bound_box)
        instance=bpy.data.objects.new(car+' display',None);instance.instance_type='COLLECTION';instance.instance_collection=collection;instance.location=(x,0,-low+.012);scene.collection.objects.link(instance)
    ground_mesh=bpy.data.meshes.new('Studio ground');ground_mesh.from_pydata([(-100,-100,0),(100,-100,0),(100,100,0),(-100,100,0)],[],[(0,1,2,3)]);ground_mesh.update()
    floor=bpy.data.objects.new('Studio ground',ground_mesh);scene.collection.objects.link(floor);floor.data.materials.append(base.solid('Studio asphalt',(.045,.052,.064),0,.76))
    for name,position,power,color,area in [('Key',(3,-5,8),1400,(1,.9,.78),6),('Fill',(-6,-2,4),1100,(.64,.79,1),5),('Rim',(2,5,6),1800,(1,1,1),5)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=area
        light=bpy.data.objects.new(name,data);scene.collection.objects.link(light);light.location=position;light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
    data=bpy.data.cameras.new('Pursuit camera');camera=bpy.data.objects.new('Pursuit camera',data);scene.collection.objects.link(camera);camera.location=(9,-12,7);camera.rotation_euler=(Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler();data.lens=52;scene.camera=camera
    return scene


def build():
    scene=bpy.data.scenes.new('Hit & Run Pursuit');scene.unit_settings.system='METRIC'
    window=bpy.context.window_manager.windows[0];window.scene=scene;previous=base.scene_get;base.scene_get=lambda:scene
    try:
        with bpy.context.temp_override(window=window,scene=scene,view_layer=scene.view_layers[0]):
            for car in CARS:
                created=base.rebuild_car(car);bpy.data.collections[created['collection']]['pursuitCar']=car
            result=upgrade(scene);review_scene(scene)
            bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/pursuit-modernisation.blend'))
    finally:base.scene_get=previous
    return result


if __name__=='__main__':print(json.dumps(build()),flush=True)
