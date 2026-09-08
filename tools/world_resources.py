"""Restore source road topology, omitted instances, and interactive world objects."""
from pathlib import Path
import hashlib,json,struct
import numpy as np
from p3d import read,walk,string
from convert import Converter,GAME,OUT,I,mat,floats
from interiors import leaves,VOLUME

MIRROR=np.diag([1,1,-1,1])

def instances(entity):
    result=[]
    def visit(chunk,matrix=I,label=''):
        if chunk.id==0x120103:
            label,p=string(chunk.data);matrix=mat(chunk.data,p+4)@matrix
        if chunk.id==0x120107:
            display,p=string(chunk.data);drawable,_=string(chunk.data,p)
            result.append(dict(name=label or display,drawable=drawable,matrix=matrix))
        for child in chunk.children:visit(child,matrix,label)
    for child in entity.children:
        if child.id==0x3000008:visit(child)
    # The instance list can include several drawable/shadow leaves at the same
    # placement. Native physics instantiates the owning entity once per transform.
    unique={}
    for row in result:unique.setdefault(tuple(np.round(row['matrix'].flatten(),5)),row)
    return list(unique.values())

def navigation(path,legacy):
    root=read(path);definitions={string(c.data)[0]:c for c in root.children if c.id==0x3000009}
    junctions={};variants=[]
    for c in root.children:
        if c.id!=0x3000004:continue
        name,p=string(c.data);x,y,z,radius,behavior=struct.unpack_from('<4fI',c.data,p)
        row=dict(name=name,position=[x,y,-z],radius=radius,behavior=behavior)
        if name in junctions:
            if np.linalg.norm(np.array(junctions[name]['position'])-row['position'])>.5:raise ValueError(f'{path}: conflicting junction location {name}')
            if junctions[name]!=row:variants.append(row)
        else:junctions[name]=row
    roads=[];segments=[]
    for road in root.children:
        if road.id!=0x3000003:continue
        name,p=string(road.data);kind,=struct.unpack_from('<I',road.data,p);start,p=string(road.data,p+4);end,p=string(road.data,p)
        max_cars,speed,intelligence,shortcut=struct.unpack_from('<IBBB',road.data,p)
        if start not in junctions or end not in junctions:raise ValueError(f'{name}: missing junction')
        ids=[]
        for c in road.children:
            if c.id!=0x3000002:continue
            label,p=string(c.data);definition,p=string(c.data,p);d=definitions[definition];_,q=string(d.data)
            kind,lanes,shoulder=struct.unpack_from('<III',d.data,q)
            points=np.concatenate([np.zeros((1,3)),floats(d.data,9,q+12).reshape(3,3)])
            points=np.c_[points,np.ones(4)]@mat(c.data,p+64)@mat(c.data,p);points[:,2]*=-1;points=points[:,:3]
            a=(points[0]+points[3])/2;b=(points[1]+points[2])/2;index=len(segments)
            if not np.allclose([a,b],legacy[index],atol=.001):raise ValueError(f'{name}: legacy segment order changed')
            if not 1<=lanes<=8:raise ValueError(f'{name}: invalid lane count {lanes}')
            segments.append(dict(name=label,road=len(roads),lanes=lanes,shoulder=bool(shoulder),corners=points.tolist(),next=-1));ids.append(index)
        ordered=[];remaining=set(ids);point=np.array(junctions[start]['position'])
        while remaining:
            index=min(remaining,key=lambda n:np.linalg.norm(np.array(legacy[n][0])-point));remaining.remove(index);ordered.append(index);point=np.array(legacy[index][1])
        for a,b in zip(ordered,ordered[1:]):
            if np.linalg.norm(np.array(legacy[a][1])-np.array(legacy[b][0]))>1:raise ValueError(f'{name}: disconnected ordered segments')
            segments[a]['next']=b
        roads.append(dict(name=name,start=start,end=end,maxCars=max_cars,speedKmh=speed,intelligence=intelligence,shortcut=bool(shortcut),segments=ordered))
    if len(segments)!=len(legacy):raise ValueError(f'{path}: missing road segments')
    return dict(source=str(path.relative_to(GAME)),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),roads=roads,segments=segments,junctions=list(junctions.values()),duplicateJunctionVariants=variants)

def joint_matrices(entity):
    skeleton=next((c for c in walk(entity) if c.id==0x4500),None);joints=[]
    if skeleton:
        for c in skeleton.children:
            if c.id!=0x4501:continue
            _,p=string(c.data);parent,=struct.unpack_from('<I',c.data,p);local=mat(c.data,p+24);joints.append(local@joints[parent] if joints and parent<len(joints) else local)
    return joints

def physics_shapes(entity,name):
    joints=joint_matrices(entity);result=[]
    def visit(volume):
        children=[c for c in volume.children if c.id==VOLUME]
        if children:
            for child in children:visit(child)
        else:
            owner,=struct.unpack_from('<I',volume.data);matrix=joints[owner] if owner<len(joints) else I
            result.extend((shape,matrix) for shape in leaves(volume,name))
    for collision in walk(entity):
        if collision.id==0x7010000:
            for volume in collision.children:
                if volume.id==VOLUME:visit(volume)
    return result

def main():
    (OUT/'world').mkdir(exist_ok=True);converter=Converter();report=[]
    for level in range(1,8):
        data=json.loads((OUT/f'level{level}.json').read_text());nav=navigation(GAME/f'art/l{level}_terra.p3d',data['roads'])
        (OUT/f'world/navigation{level}.json').write_text(json.dumps(nav,separators=(',',':'))+'\n')
        extras=[];props=[];sources=[];terrain_types={}
        for scene in data['scenes']:
            path=GAME/f'art/{scene}.p3d';root=read(path);sources.append(dict(source=str(path.relative_to(GAME)),sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
            kinds=[]
            for intersect in walk(root):
                if intersect.id!=0x3f00003:continue
                count,=struct.unpack_from('<I',intersect.data);count//=3;types=next((c for c in intersect.children if c.id==0x300000e),None)
                if types:
                    length,=struct.unpack_from('<I',types.data,4)
                    if length!=count:raise ValueError(f'{scene}: terrain material count {length} != {count}')
                    kinds.extend(types.data[8:8+length])
                else:kinds.extend([0]*count)
            terrain_types[scene]=kinds
            if any(c.id in [0x3f0000a,0x3f00009] and instances(c) for c in root.children):
                output=f'world/{scene}-extra';converter.export(path,output,instance_types={0x3f0000a,0x3f00009})
                extra=json.loads((OUT/f'{output}.json').read_text());existing=json.loads((OUT/f'{scene}.json').read_text())
                extra['objects']=[o for o in extra['objects'] if not any(old['mesh']==o['mesh'] and np.allclose(old['matrix'],o['matrix'],atol=.0001) for old in existing['objects'])]
                (OUT/f'{output}.json').write_text(json.dumps(extra,separators=(',',':'))+'\n')
                if extra['objects']:extras.append(output)
            documents=[]
            for filename in [OUT/f'{scene}.json',OUT/f'remaster/scenes/{scene}.json',OUT/f'world/{scene}-extra.json']:
                if filename.exists():
                    doc=json.loads(filename.read_text())
                    for obj in doc['objects']:obj.pop('interactiveId',None);obj.pop('movable',None)
                    documents.append((filename,doc))
            for entity in root.children:
                if entity.id not in [0x3f00002,0x3f0000a,0x3f0000e]:continue
                effect=next((c for c in entity.children if c.id==0x3000600),None)
                cls,material=struct.unpack_from('<II',effect.data) if effect else (2,0)
                sound=string(effect.data,8)[0] if effect else ''
                name=string(entity.data)[0]
                if 'powerbox' in name.lower():continue
                shapes=physics_shapes(entity,name)
                if not shapes:continue
                for instance in instances(entity):
                    matrix=(MIRROR@instance['matrix']@MIRROR).flatten().tolist();identity=f'{scene}:{instance["name"]}:{hashlib.sha256(name.encode()+np.asarray(matrix,dtype="<f4").tobytes()).hexdigest()[:12]}'
                    position=matrix[12:15];assigned=0;render_matrices=[(MIRROR@joint@instance['matrix']@MIRROR).flatten() for joint in [I,*joint_matrices(entity)]]
                    for filename,doc in documents:
                        for obj in doc['objects']:
                            composite=entity.id==0x3f0000e and obj['name']==instance['name'] and any(np.allclose(obj['matrix'],m,atol=.0001) for m in render_matrices)
                            if composite or (obj['mesh'] in [instance['drawable'],name] and np.allclose(obj['matrix'],matrix,atol=.0001)):obj['interactiveId']=identity;obj['movable']=cls!=2;assigned+=1
                    if not assigned:raise ValueError(f'{identity}: no rendered object for collision instance')
                    transformed=[dict(shape,transform=(MIRROR@joint@instance['matrix']@MIRROR).flatten().tolist()) for shape,joint in shapes]
                    props.append(dict(id=identity,scene=scene,name=instance['name'],model=name,position=position,matrix=matrix,shapes=transformed,kind=cls,material=material,sound=sound))
            for filename,doc in documents:filename.write_text(json.dumps(doc,separators=(',',':'))+'\n')
        coin=f'world/coin{level}';converter.export(GAME/f'art/missions/level0{level}/level.p3d',coin,mesh_name='coinShape_000')
        (OUT/f'world/objects{level}.json').write_text(json.dumps(dict(sources=sources,extras=extras,props=props,coin=coin,terrainTypes=terrain_types),separators=(',',':'))+'\n')
        row=dict(level=level,roads=len(nav['roads']),segments=len(nav['segments']),junctions=len(nav['junctions']),props=len(props),extraScenes=len(extras));report.append(row);print(row,flush=True)
    (OUT/'world/manifest.json').write_text(json.dumps(dict(levels=report,errors=[]),indent=2)+'\n')
    if converter.texture_errors:raise ValueError(converter.texture_errors)

if __name__=='__main__':main()
