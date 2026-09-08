"""Convert Homer's skin, bind skeleton and original animation clips."""
import json,struct
import numpy as np
from convert import Converter,geometry,ROOT,GAME,OUT,mat
from p3d import read,walk,string

def convert_homer(model='art/chars/homer_m.p3d',animation_file='art/chars/homer_a.p3d',output='homer'):
    converter=Converter();converter.resources(read(GAME/'art/chars/global.p3d'))
    root=read(GAME/model);converter.resources(root)
    blob=bytearray();primitives=[]
    def buffer(a):
        offset=len(blob);blob.extend(np.ascontiguousarray(a,dtype='<f4').tobytes());return [offset,a.size]
    for skin in [c for c in walk(root) if c.id==0x10001]:
        for pg in skin.children:
            if pg.id!=0x10002:continue
            shader,parts=geometry(pg);count=0;idx=[]
            for part in parts:idx.append(part['indices']+count);count+=len(part['position'])
            attrs={}
            for key,width in [('position',3),('uv',2),('normal',3),('skinIndex',4),('skinWeight',4)]:
                arrays=[]
                for part in parts:
                    fallback=np.zeros((len(part['position']),width),dtype=np.float32)
                    if key=='skinWeight':fallback[:,0]=1
                    arrays.append(part.get(key,fallback))
                attrs[key]=buffer(np.concatenate(arrays))
            indices=np.concatenate(idx).astype('<u4');attrs['indices']=[len(blob),len(indices)];blob.extend(indices.tobytes())
            primitives.append(dict(shader=shader,attributes=attrs))
    bones=[];mirror=np.diag([1,1,-1,1])
    for c in walk(root):
        if c.id!=0x4501:continue
        name,p=string(c.data);parent,=struct.unpack_from('<I',c.data,p)
        bones.append(dict(name=name,parent=parent,matrix=(mirror@mat(c.data,p+24)@mirror).flatten().tolist()))
    animations=[]
    chosen=['hom_in_car_idle','hom_loco_idle_rest','hom_loco_walk','hom_loco_run','hom_loco_dash','hom_jump_idle_in_air','hom_jump_kick','hom_victory_small','hom_flail','hom_get_up']
    for animation in walk(read(GAME/animation_file)):
        if animation.id!=0x121000:continue
        name,p=string(animation.data,4)
        if output!='menu-homer' and '_dialogue_' not in name and name.partition('_')[2] not in [item.partition('_')[2] for item in chosen]:continue
        frames,fps,cyclic=struct.unpack_from('<ffI',animation.data,p+4);tracks=[]
        for group in walk(animation):
            if group.id!=0x121001:continue
            bone,_=string(group.data,4)
            if bone not in [b['name'] for b in bones]:continue
            for channel in group.children:
                b=channel.data
                if channel.id in (0x121111,0x121104):
                    count,=struct.unpack_from('<I',b,8);times=np.frombuffer(b,dtype='<u2',count=count,offset=12)/fps;p=12+count*2
                    if channel.id==0x121111:
                        values=np.frombuffer(b,dtype='<i2',offset=p,count=count*4).reshape(-1,4).astype(np.float64)/32767
                        values=values[:,[1,2,3,0]];values[:,:2]*=-1;kind='quaternion'
                    else:
                        if bone=='Motion_Root':continue
                        values=np.frombuffer(b,dtype='<f4',offset=p,count=count*3).reshape(-1,3).copy();values[:,2]*=-1;kind='position'
                    tracks.append(dict(bone=bone,kind=kind,times=times.tolist(),values=values.flatten().tolist()))
                elif channel.id in (0x121102,0x121103):
                    mapping,=struct.unpack_from('<H',b,8);const=np.frombuffer(b,dtype='<f4',offset=10,count=3).copy();count,=struct.unpack_from('<I',b,22)
                    times=np.frombuffer(b,dtype='<u2',count=count,offset=26)/fps
                    dof=1 if channel.id==0x121102 else 2
                    vals=np.frombuffer(b,dtype='<f4',count=count*dof,offset=26+count*2).reshape(count,dof);values=np.tile(const,(count,1))
                    axes=[mapping] if dof==1 else [axis for axis in range(3) if axis!=mapping]
                    values[:,axes]=vals;values[:,2]*=-1
                    if bone!='Motion_Root':tracks.append(dict(bone=bone,kind='position',times=times.tolist(),values=values.flatten().tolist()))
        animations.append(dict(name=name,duration=(frames-1)/fps,tracks=tracks))
    used={p['shader'] for p in primitives}
    materials={};remaps=[]
    for key in used:
        shader=converter.shaders[key];texture=shader['texture'];url=converter.textures.get(texture)
        # Native character setup (PAL 0x270830) supplies shared swatch palettes
        # separately from the model. These three source meshes retain placeholder
        # names; the browser's lit skin material uses the shared lit palette.
        if not url and shader['lit'] and texture in ['char_swatches.bmp','char_swatches_lit.bmp1']:
            url=converter.textures.get('char_swatches_lit.bmp')
            remaps.append(dict(shader=key,source=texture,resolved='char_swatches_lit.bmp'))
        if texture and not url:raise ValueError(f'{model}: unresolved texture {texture} for {key}')
        materials[key]=dict(shader,textureUrl=url)
    data=dict(primitives=primitives,bones=bones,animations=animations,materials=materials)
    if remaps:data['textureRemaps']=remaps
    if output=='menu-homer':
        node=next(c for c in walk(root) if c.id==0x120103 and string(c.data)[0]=='Maya_Root');_,p=string(node.data)
        data['placement']=(mirror@mat(node.data,p+4)@mirror).flatten().tolist()
    (OUT/(output+'.bin')).write_bytes(blob);(OUT/(output+'.json')).write_text(json.dumps(data,separators=(',',':')))
    print(f'{output}: {len(bones)} bones, {len(animations)} clips, {len(blob):,} geometry bytes')
if __name__=='__main__':
    convert_homer()
    for character in ['bart','lisa','marge','apu']:
        convert_homer(f'art/chars/{character}_m.p3d',f'art/chars/{character}_a.p3d',character)
    convert_homer('art/frontend/scrooby/resource/pure3d/homer.p3d','art/frontend/scrooby/resource/pure3d/homer.p3d','menu-homer')
