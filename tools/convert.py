"""Convert local Pure3D PS2 assets to browser geometry, textures and world data."""
from pathlib import Path
from collections import Counter
import argparse, hashlib, json, re, struct
import numpy as np
from p3d import read, walk, string
from vif import unpack
from textures import decode_image

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT/'source/game';OUT=ROOT/'public/assets';OUT.mkdir(parents=True,exist_ok=True)
TEX=OUT/'textures';TEX.mkdir(exist_ok=True)
I=np.eye(4,dtype=np.float32)

def floats(b,n,p=0):return np.frombuffer(b,dtype='<f4',count=n,offset=p).copy()
def mat(b,p):return floats(b,16,p).reshape(4,4)
def sname(c):return string(c.data)[0]

def geometry(pg):
    shader,p=string(pg.data,4)
    primitive,flags,nvertices,nindices,nmat=struct.unpack_from('<5I',pg.data,p)
    parts=[];current={}
    native=next((c for c in pg.children if c.id==0x10012),None)
    if native:
        for cmd,n,v,b,imm,data in unpack(native.data):
            addr=imm&0x3ff
            if addr==0:
                if 'position' in current:parts.append(current)
                current={}
            elif addr==2 and v==2 and b==32:current['uv']=floats(data,n*2).reshape(-1,2)
            elif addr==4 and v==3 and b==32:current['position']=floats(data,n*3).reshape(-1,3)
            elif addr==3 and v==4 and b==8:
                current['color']=np.minimum(np.frombuffer(data,dtype=np.uint8).reshape(-1,4)[:,:3].astype(np.float32)/128,1)
            elif addr==5 and v==4 and b==8:
                palette_chunk=next((c for c in pg.children if c.id==0x1000d),None)
                palette=np.frombuffer(palette_chunk.data,dtype='<u4',offset=4) if palette_chunk else np.array([0])
                packed=np.frombuffer(data,dtype=np.uint8).reshape(-1,4)
                skin=np.zeros((n,4),dtype=np.float32)
                skin[:,:3]=palette[np.minimum(packed[:,:3]//4,len(palette)-1)]
                current['skinIndex']=skin
            elif addr==6 and v==4 and b==16:
                weights=np.frombuffer(data,dtype='<i2').reshape(-1,4).astype(np.float32)/32767
                weights[:,3]=0;weights=np.maximum(weights,0);weights/=np.maximum(weights.sum(axis=1,keepdims=True),1e-6)
                current['skinWeight']=weights
            elif addr==3 and v==3:
                current['normal']=(floats(data,n*3) if b==32 else np.frombuffer(data,dtype='<i2',count=n*3).astype(np.float32)/32767).reshape(-1,3)
        if 'position' in current:parts.append(current)
    else:
        data={c.id:c.data for c in pg.children}
        if 0x10005 not in data:return shader,[]
        n=struct.unpack_from('<I',data[0x10005])[0]
        current={'position':floats(data[0x10005],n*3,4).reshape(-1,3)}
        if 0x10007 in data:current['uv']=floats(data[0x10007],n*2,8).reshape(-1,2)
        if 0x10008 in data:
            bgra=np.frombuffer(data[0x10008],np.uint8,offset=4).reshape(-1,4)
            current['color']=bgra[:,[2,1,0]].astype(np.float32)/255
        if 0x10006 in data:current['normal']=floats(data[0x10006],n*3,4).reshape(-1,3)
        if 0x1000a in data:current['indices']=np.frombuffer(data[0x1000a],dtype='<u4',offset=4).copy()
        if 0x1000b in data:
            palette=np.frombuffer(data[0x1000d],dtype='<u4',offset=4) if 0x1000d in data else np.array([0])
            indices=np.frombuffer(data[0x1000b],dtype=np.uint8,offset=4).reshape(-1,4)
            current['skinIndex']=palette[np.minimum(indices,len(palette)-1)].astype(np.float32)
            current['skinWeight']=np.zeros((n,4),dtype=np.float32);current['skinWeight'][:,0]=1
        if 0x1000c in data:
            weights=floats(data[0x1000c],n*3,4).reshape(-1,3)
            current['skinWeight']=np.concatenate([weights,np.zeros((n,1))],axis=1).astype(np.float32)
            current['skinWeight']/=np.maximum(current['skinWeight'].sum(axis=1,keepdims=True),1e-6)

        parts.append(current)
    results=[]
    for part in parts:
        n=len(part['position']);indices=part.pop('indices',np.arange(n,dtype=np.uint32))
        if primitive==1:
            triangles=np.stack([indices[:-2],indices[1:-1],indices[2:]],axis=1)
            triangles[1::2]=triangles[1::2][:,[1,0,2]]
        elif primitive==0:triangles=indices[:len(indices)//3*3].reshape(-1,3)
        else:continue
        pos=part['position'];v0=pos[triangles[:,0]];v1=pos[triangles[:,1]];v2=pos[triangles[:,2]]
        valid=np.linalg.norm(np.cross(v1-v0,v2-v0),axis=1)>1e-8
        triangles=triangles[valid]
        # Mirror the game's left-handed Z axis to Three.js coordinates.
        part['position'][:,2]*=-1
        if 'normal' in part:part['normal'][:,2]*=-1
        part['indices']=triangles[:,[0,2,1]].flatten().astype(np.uint32)
        if len(part['indices']):results.append(part)
    return shader,results

class Converter:
    def __init__(self):self.textures={};self.shaders={};self.texture_errors=[];self.stats=Counter()
    def resources(self,root):
        for c in walk(root):
            if c.id==0x19000:
                name=sname(c)
                try:
                    image=next(v for v in c.children if v.id==0x19001)
                    raw=next(v for v in image.children if v.id==0x19002).data[4:]
                    digest=hashlib.sha256(raw).hexdigest()[:20]
                    path=TEX/(digest+'.png')
                    if not path.exists():decode_image(raw).save(path)
                    self.textures[name.lower()]='textures/'+path.name
                except (ValueError,StopIteration) as e:self.texture_errors.append(f'{name}: {e}')
            elif c.id==0x11000:
                name,p=string(c.data);version,=struct.unpack_from('<I',c.data,p);kind,p=string(c.data,p+4)
                translucent,=struct.unpack_from('<I',c.data,p)
                props={}
                for prop in c.children:
                    key=prop.data[:4].rstrip(b'\0').decode('ascii')
                    if prop.id==0x11002:props[key]=string(prop.data,4)[0]
                    elif prop.id==0x11003:props[key]=struct.unpack_from('<I',prop.data,4)[0]
                self.shaders[name]=dict(texture=props.get('TEX','').lower(),alpha=bool(props.get('ATST',0)),blend=props.get('BLMD',0),lit=bool(props.get('LIT',0)),translucent=bool(translucent))
    def export(self,path,outname,vehicle=False):
        root=read(path);self.resources(root)
        meshes={sname(c):c for c in walk(root) if c.id==0x10000}
        placements=[]
        composites={}
        skeletons={sname(c):c for c in walk(root) if c.id==0x4500}
        for composite in (c for c in walk(root) if c.id==0x4512):
            name,p=string(composite.data);skeleton_name,_=string(composite.data,p)
            skeleton=skeletons.get(skeleton_name)
            if skeleton is None:continue
            joints=[]
            for c in skeleton.children:
                if c.id!=0x4501:continue
                _,p=string(c.data);parent,=struct.unpack_from('<I',c.data,p);matrix=mat(c.data,p+24)
                joints.append(matrix@joints[parent] if joints and parent<len(joints) else matrix)
            parts=[]
            for c in walk(composite):
                if c.id!=0x4516:continue
                drawable,p=string(c.data);_,joint=struct.unpack_from('<II',c.data,p)
                if drawable in meshes and joint<len(joints):parts.append((drawable,joints[joint]))
            composites[name]=parts
        for c in walk(root):
            if c.id not in (0x3f0000e,0x3f00010,0x3f0000c):continue
            compound=next((x for x in walk(c) if x.id==0x4512),None)
            if compound is not None:composites[sname(c)]=composites.get(sname(compound),[])
        if vehicle:
            composite=next((c for c in root.children if c.id==0x4512),None)
            if composite:
                _,p=string(composite.data);skeleton_name,_=string(composite.data,p)
                skeleton=next(c for c in root.children if c.id==0x4500 and sname(c)==skeleton_name)
                joints=[];jointnames=[]
                for c in skeleton.children:
                    if c.id!=0x4501:continue
                    name,p=string(c.data);parent,=struct.unpack_from('<I',c.data,p);matrix=mat(c.data,p+24)
                    joints.append(matrix@joints[parent] if len(joints)>0 and parent<len(joints) else matrix)
                    jointnames.append(name)
                for c in walk(composite):
                    if c.id==0x4516:
                        name,p=string(c.data);_,joint=struct.unpack_from('<II',c.data,p)
                        if name in meshes:placements.append((name,joints[joint],jointnames[joint]))
            else:placements=[(n,I,n) for n in meshes]
        else:
            def instances(c,matrix=I,instance_name=''):
                if c.id==0x120103:
                    instance_name,p=string(c.data);matrix=mat(c.data,p+4)@matrix
                if c.id==0x120107:
                    label,p=string(c.data);name,_=string(c.data,p)
                    if name in meshes:placements.append((name,matrix,label))
                    elif name in composites:
                        for drawable,local in composites[name]:placements.append((drawable,local@matrix,instance_name or label))
                for sub in c.children:instances(sub,matrix,instance_name)
            for c in root.children:
                if c.id==0x3f00000:
                    for mesh in c.children:
                        if mesh.id==0x10000:placements.append((sname(mesh),I,sname(mesh)))
                elif c.id==0x120100:instances(c)
                elif c.id in (0x3f00002,0x3f0000e,0x3000008):
                    for sub in walk(c):
                        if sub.id==0x3000008:instances(sub)
        blob=bytearray();exports=[];cache={}
        def buffer(a):
            offset=len(blob);raw=np.ascontiguousarray(a).tobytes();blob.extend(raw)
            while len(blob)%4:blob.append(0)
            return [offset,len(a.flatten())]
        mirror=np.diag([1,1,-1,1])
        for name,matrix,label in placements:
            if name not in cache:
                primitives=[]
                for pg in meshes[name].children:
                    if pg.id!=0x10002:continue
                    shader,parts=geometry(pg)
                    # Joining the VIF batches keeps one draw per primitive, without bridging strips.
                    if not parts:continue
                    count=0;indices=[]
                    for part in parts:indices.append(part['indices']+count);count+=len(part['position'])
                    attrs={key:buffer(np.concatenate([part.get(key,np.ones((len(part['position']),width),dtype=np.float32) if key=='color' else np.zeros((len(part['position']),width),dtype=np.float32)) for part in parts]).astype('<f4')) for key,width in [('position',3),('uv',2),('color',3)]}
                    if all('normal' in part for part in parts):attrs['normal']=buffer(np.concatenate([part['normal'] for part in parts]).astype('<f4'))
                    attrs['indices']=buffer(np.concatenate(indices).astype('<u4'))
                    primitives.append(dict(shader=shader,attributes=attrs))
                    self.stats['vertices']+=count;self.stats['triangles']+=sum(len(v) for v in indices)//3
                cache[name]=primitives
            exports.append(dict(name=label,mesh=name,matrix=(mirror@matrix@mirror).flatten().tolist()))
        collision_parts=[]
        for chunk in walk(root):
            if chunk.id==0x3f00003:
                ni,=struct.unpack_from('<I',chunk.data);idx=np.frombuffer(chunk.data,dtype='<u4',count=ni,offset=4)
                p=4+ni*4;nv,=struct.unpack_from('<I',chunk.data,p);positions=floats(chunk.data,nv*3,p+4).reshape(-1,3)
                positions[:,2]*=-1
                collision_parts.append(positions[idx].reshape(-1,3))
        collision=buffer(np.concatenate(collision_parts).astype('<f4')) if collision_parts else None
        used={p['shader'] for parts in cache.values() for p in parts}
        metadata=dict(collision=collision,source=str(path.relative_to(GAME)),objects=exports,meshes=cache,materials={key:dict(self.shaders.get(key,dict(texture='',alpha=False,blend=0,lit=False,translucent=False,fallback=True)),textureUrl=self.textures.get(self.shaders.get(key,dict(texture='',alpha=False,blend=0,lit=False,translucent=False,fallback=True)).get('texture',''))) for key in used})
        (OUT/(outname+'.bin')).write_bytes(blob)
        (OUT/(outname+'.json')).write_text(json.dumps(metadata,separators=(',',':')))
        self.stats['objects']+=len(exports);self.stats['files']+=1
        print(f'{outname}: {len(exports)} objects, {len(blob):,} geometry bytes',flush=True)
        return root

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--levels',default='1');args=parser.parse_args()
    converter=Converter();levels=[]
    for level in [int(n) for n in args.levels.split(',')]:
        files=[GAME/f'art/l{level}_terra.p3d']+sorted((GAME/'art').glob(f'l{level}r*.p3d'))+sorted((GAME/'art').glob(f'l{level}z*.p3d'))
        scenes=[];locators=[]
        for path in files:
            root=converter.export(path,path.stem);scenes.append(path.stem)
            for c in walk(root):
                if c.id==0x3000005:
                    name,p=string(c.data);kind,length=struct.unpack_from('<II',c.data,p);pos=floats(c.data,3,p+8+length*4).tolist();pos[2]*=-1
                    locators.append(dict(name=name,kind=kind,position=pos))
        script=(GAME/f'scripts/missions/level0{level}/level.mfk').read_text()
        locations=[]
        for name,x,y,z in re.findall(r'AddTeleportDest\("([^"]+)",\s*([\d.-]+),\s*([\d.-]+),\s*([\d.-]+)',script):
            locations.append(dict(name=name,position=[float(x),float(y),-float(z)]))
        terra=read(files[0]);road_defs={sname(c):c for c in terra.children if c.id==0x3000009}
        roads=[];fences=[]
        for c in walk(terra):
            if c.id==0x3000002:
                name,p=string(c.data);data_name,p=string(c.data,p);transform=mat(c.data,p);scale=mat(c.data,p+64)
                definition=road_defs[data_name];_,p=string(definition.data)
                points=np.concatenate([np.zeros((1,3),np.float32),floats(definition.data,9,p+12).reshape(3,3)])
                points=np.concatenate([points,np.ones((4,1))],axis=1)@scale@transform
                points[:,2]*=-1
                a=(points[0,:3]+points[3,:3])/2;b=(points[1,:3]+points[2,:3])/2
                roads.append([a.tolist(),b.tolist()])
            if c.id==0x3000000:
                data=floats(c.data,9).reshape(3,3);data[:,2]*=-1;fences.append(data.tolist())
        leveldata=dict(id=level,scenes=scenes,locations=locations,locators=locators,roads=roads,fences=fences)
        (OUT/f'level{level}.json').write_text(json.dumps(leveldata,separators=(',',':')));levels.append(level)
    cars=['famil_v','plowk_v','homer_v','cletu_v','cPolice','pickupA','minivanA','schoolbu','sportsA','snake_v','bart_v','lisa_v']
    available=[]
    for car in cars:
        path=GAME/f'art/cars/{car.lower()}.p3d'
        if path.exists():converter.export(path,'car-'+car.lower(),vehicle=True);available.append(car.lower())
    converter.export(GAME/'art/frontend/scrooby/resource/pure3d/camset.p3d','frontend-room')
    (OUT/'catalog.json').write_text(json.dumps(dict(levels=levels,cars=available,textures=converter.textures,stats=dict(converter.stats),textureErrors=converter.texture_errors),indent=2))
    print(dict(converter.stats));print(f'Textures: {len(converter.textures)}; errors: {len(converter.texture_errors)}')
    if converter.texture_errors:print('\n'.join(converter.texture_errors))
if __name__=='__main__':main()
