"""Blender authoring pipeline: rebuilt wheels, bevelled vehicle parts, HD surfaces.
Run through Blender MCP. The untouched source game stays in source/game.
"""
import bpy, json, math, numpy as np
from pathlib import Path
from mathutils import Matrix
ROOT=Path(__file__).resolve().parents[1] if '__file__' in globals() else Path.cwd();ASSETS=ROOT/'public/assets';OUTPUT=ASSETS/'remaster'
CONVERT=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))

def scene_get():
    scene=bpy.data.scenes.get('Hit & Run Remaster')
    if scene is None:scene=bpy.data.scenes.new('Hit & Run Remaster')
    bpy.context.window.scene=scene
    scene.unit_settings.system='METRIC'
    return scene

def material(name,source):
    key='HR_'+name
    m=bpy.data.materials.get(key)
    if m:return m
    m=bpy.data.materials.new(key);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value=.38;p.inputs['Metallic'].default_value=.18
    p.inputs['Coat Weight'].default_value=.65;p.inputs['Coat Roughness'].default_value=.19
    url=source.get('textureUrl')
    if url:
        image=bpy.data.images.load(str(ASSETS/url),check_existing=True)
        tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image;tex.interpolation='Closest'
        m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
        if source.get('blend')==1:
            m.node_tree.links.new(tex.outputs['Alpha'],p.inputs['Alpha']);m.surface_render_method='DITHERED';p.inputs['Roughness'].default_value=.14
    return m

def solid(name,color,metal=0,rough=.5):
    m=bpy.data.materials.get(name)
    if not m:
        m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m

def operator_object(parent,collection):
    obj=bpy.context.object
    for c in list(obj.users_collection):c.objects.unlink(obj)
    collection.objects.link(obj);obj.parent=parent
    return obj

def rebuild_car(car):
    scene=scene_get();name='car-'+car;collection=bpy.data.collections.new('Remastered '+car);scene.collection.children.link(collection)
    data=json.loads((ASSETS/(name+'.json')).read_text());blob=(ASSETS/(name+'.bin')).read_bytes()
    root=bpy.data.objects.new(name,None);collection.objects.link(root)
    totals={'sourceTriangles':0,'newWheelTriangles':0,'bevelledParts':0}
    def array(span,kind='<f4',width=3):return np.frombuffer(blob,dtype=kind,count=span[1],offset=span[0]).reshape(-1,width)
    for instance in data['objects']:
        group=bpy.data.objects.new(instance['name'],None);group['p3dName']=instance['name'];collection.objects.link(group);group.parent=root
        raw=Matrix(np.array(instance['matrix']).reshape(4,4).T.tolist());group.matrix_local=CONVERT@raw@CONVERT.inverted()
        if instance['name'] in ['w0','w1','w2','w3']:
            # Replace flat texture wheels with rounded rubber, a machined rim and lug nuts.
            bpy.ops.mesh.primitive_torus_add(major_radius=.285,minor_radius=.092,major_segments=64,minor_segments=16,rotation=(0,math.pi/2,0))
            tire=operator_object(group,collection);tire.name='Rounded tire';tire.data.materials.append(solid('HR_Rubber',(.025,.029,.034),0,.86))
            for p in tire.data.polygons:p.use_smooth=True
            bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=.227,depth=.17,rotation=(0,math.pi/2,0))
            rim=operator_object(group,collection);rim.name='Alloy rim';rim.data.materials.append(solid('HR_Alloy',(.5,.55,.59),.9,.23))
            modifier=rim.modifiers.new('Rim edge radius','BEVEL');modifier.width=.009;modifier.segments=3
            for side in [-1,1]:
                bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.148,depth=.012,location=(side*.094,0,0),rotation=(0,math.pi/2,0))
                inset=operator_object(group,collection);inset.name='Rim recess';inset.data.materials.append(solid('HR_RimInset',(.045,.05,.055),.65,.36))
                for i in range(5):
                    theta=i*math.tau/5
                    bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,radius=.018,location=(side*.108,math.sin(theta)*.10,math.cos(theta)*.10))
                    bolt=operator_object(group,collection);bolt.name='Lug nut';bolt.data.materials.append(solid('HR_Alloy',(.5,.55,.59),.9,.23))
            points=[]
            for source_part in data['meshes'][instance['mesh']]:points.append(array(source_part['attributes']['position']))
            wheel_points=np.concatenate(points);radius=float(np.max(np.sqrt(wheel_points[:,1]**2+wheel_points[:,2]**2)));width=float(np.ptp(wheel_points[:,0]))
            group.scale=(max(.6,width/.184),radius/.377,radius/.377)
            totals['newWheelTriangles']+=64*16*2+64*4+5*12*6*2
            continue
        for part in data['meshes'][instance['mesh']]:
            attrs=part['attributes'];pos=array(attrs['position']);positions=np.stack([pos[:,0],-pos[:,2],pos[:,1]],axis=1)
            indices=array(attrs['indices'],'<u4',3);uv=array(attrs['uv'],width=2)
            mesh=bpy.data.meshes.new(instance['mesh']);mesh.from_pydata(positions.tolist(),[],indices.tolist());mesh.update()
            layer=mesh.uv_layers.new(name='UVMap');loops=np.array([loop.vertex_index for loop in mesh.loops]);layer.data.foreach_set('uv',uv[loops].flatten())
            obj=bpy.data.objects.new(instance['mesh'],mesh);collection.objects.link(obj);obj.parent=group;obj.data.materials.append(material(car+'_'+part['shader'],data['materials'][part['shader']]))
            # Weld packet duplication without losing UV loops, then round actual hard edges.
            import bmesh
            bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00002);bm.to_mesh(mesh);bm.free();mesh.update()
            for face in mesh.polygons:face.use_smooth=True
            bm=bmesh.new();bm.from_mesh(mesh)
            for edge in bm.edges:
                if len(edge.link_faces)==2:edge.smooth=edge.calc_face_angle()<.61
            bm.to_mesh(mesh);bm.free();mesh.update()
            bevel=obj.modifiers.new('Body panel edge radii','BEVEL');bevel.width=.011;bevel.segments=3;bevel.limit_method='ANGLE';bevel.angle_limit=math.radians(35)
            normal=obj.modifiers.new('Weighted surface normals','WEIGHTED_NORMAL');normal.keep_sharp=True;normal.weight=40
            totals['sourceTriangles']+=len(indices);totals['bevelledParts']+=1
    bpy.context.view_layer.update()
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT/(name+'.glb')),export_format='GLB',collection=collection.name,use_active_scene=True,export_apply=True,export_animations=False,export_extras=True)
    return dict(car=car,collection=collection.name,**totals,bytes=(OUTPUT/(name+'.glb')).stat().st_size)

def build_surfaces():
    scene=scene_get();catalog=json.loads((ASSETS/'catalog.json').read_text());mapping={};rng=np.random.default_rng(1989);size=1024
    yy,xx=np.mgrid[0:size,0:size];grain=rng.normal(0,1,(size,size)).astype(np.float32)
    details=[];seen=set()
    sources=list(catalog['textures'].items())
    for file in ASSETS.glob('l*.json'):
        sources.extend((m.get('texture',''),m['textureUrl']) for m in json.loads(file.read_text()).get('materials',{}).values() if m.get('textureUrl'))
    for name,url in sources:
        kind='grass' if any(s in name for s in ['grass','grassy']) else 'road' if any(s in name for s in ['rd1','rd2','road','asphalt']) else 'concrete' if any(s in name for s in ['sidew','driveway','concrete']) else None
        if kind is None or url in seen:continue
        seen.add(url);original=bpy.data.images.load(str(ASSETS/url),check_existing=True)
        w,h=original.size;pixels=np.array(original.pixels[:],dtype=np.float32).reshape(h,w,4)
        if np.mean(pixels[:,:,3])<.95:continue
        u=np.minimum((xx*w/size).astype(int),w-1);v=np.minimum((yy*h/size).astype(int),h-1);sample=pixels[v,u]
        if kind=='road':
            base=np.ones((size,size,3),np.float32)*[.35,.365,.395];noise=grain*.016+(np.sin(xx*.075)*np.sin(yy*.084))[:,:,None].squeeze()*.001
            base+=noise[:,:,None]
            # Preserve painted line placement from the disc, with a sharper paint threshold.
            yellow=(sample[:,:,0]>.38)&(sample[:,:,1]>.25)&(sample[:,:,2]<sample[:,:,1]*.73)
            white=(sample[:,:,:3].mean(axis=2)>.59)&(np.ptp(sample[:,:,:3],axis=2)<.13)
            base[yellow]=np.array([.84,.66,.12])+grain[yellow,None]*.009;base[white]=np.array([.68,.69,.67])+grain[white,None]*.006
        elif kind=='grass':
            base=np.ones((size,size,3),np.float32)*[.34,.465,.14]
            fibers=np.sin(xx*.92+np.sin(yy*.03)*5)*np.sin(yy*.22+xx*.04)
            base+=(grain*.022+fibers*.025)[:,:,None]*[.8,1,.45]
        else:
            base=np.ones((size,size,3),np.float32)*[.62,.615,.56];base+=grain[:,:,None]*.012
            # Keep expansion joints in their original UV locations.
            joints=sample[:,:,:3].mean(axis=2)<.21;base[joints]*=.58
        rgba=np.concatenate([np.clip(base,0,1),np.ones((size,size,1),np.float32)],axis=2)
        image=bpy.data.images.new('HD '+name,width=size,height=size,alpha=True);image.pixels.foreach_set(rgba.astype(np.float32).flatten());image.filepath_raw=str(OUTPUT/('surface-'+Path(url).stem+'.png'));image.file_format='PNG';image.save()
        m=solid('HR_Surface_'+name,tuple(np.mean(base,axis=(0,1))),0,.96);node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;m.node_tree.links.new(node.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
        noise=m.node_tree.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=180;bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.015;m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],m.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
        mapping[url]='remaster/'+Path(image.filepath_raw).name;details.append(dict(name=name,kind=kind,original=[w,h],output=[size,size]))
    (OUTPUT/'surfaces.json').write_text(json.dumps(mapping,indent=2));(ROOT/'blender/surface-manifest.json').write_text(json.dumps(details,indent=2))
    return dict(surfaces=len(mapping),resolution=size,details=details)

def save():
    scene_get();path=ROOT/'blender/hit-and-run-remaster.blend';bpy.ops.wm.save_as_mainfile(filepath=str(path));return str(path)


def build_grass():
    scene=scene_get();collection=bpy.data.collections.new('Remastered grass');scene.collection.children.link(collection)
    vertices=[];faces=[]
    for blade in range(6):
        angle=blade*math.tau/6+.3;dx,dy=math.cos(angle),math.sin(angle);height=.19+.018*(blade%3);base=len(vertices)
        for step in range(4):
            t=step/3;width=.022*(1-t)+.001;bend=.085*t*t
            vertices.extend([(dx*bend-dy*width,dy*bend+dx*width,height*t),(dx*bend+dy*width,dy*bend-dx*width,height*t)])
            if step:faces.extend([(base+(step-1)*2,base+step*2,base+(step-1)*2+1),(base+(step-1)*2+1,base+step*2,base+step*2+1)])
    mesh=bpy.data.meshes.new('Grass blades');mesh.from_pydata(vertices,[],faces);mesh.update();obj=bpy.data.objects.new('grass-clump',mesh);collection.objects.link(obj);obj.data.materials.append(solid('Grass blade pigment',(.28,.42,.085),0,.9))
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT/'grass.glb'),export_format='GLB',collection=collection.name,use_active_scene=True,export_animations=False)
    return dict(triangles=len(faces))

if __name__=='__main__':
    OUTPUT.mkdir(parents=True,exist_ok=True)
    report={'cars':[rebuild_car(car) for car in json.loads((ASSETS/'catalog.json').read_text())['cars']],'surfaces':build_surfaces(),'grass':build_grass()}
    (ROOT/'blender/remaster-report.json').write_text(json.dumps(report,indent=2))
    save()
    exec((ROOT/'tools/blender_review.py').read_text())
