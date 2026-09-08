"""Repair the V origin of existing Blender exports without rebuilding their geometry."""
import hashlib,json,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];ASSETS=ROOT/'public/assets'

def repair(path):
    source=path.read_bytes();length=struct.unpack_from('<I',source,12)[0];gltf=json.loads(source[20:20+length]);blob=bytearray(source[28+length:])
    if gltf.get('asset',{}).get('extras',{}).get('sourceUVOrigin')=='top-left' or any(n.get('extras',{}).get('sourceUVOrigin')=='top-left' for n in gltf.get('nodes',[])):return dict(car=path.stem,status='already-correct')
    accessors=set()
    for mesh in gltf['meshes']:
        for primitive in mesh['primitives']:
            material=gltf['materials'][primitive.get('material',0)];texture=material.get('pbrMetallicRoughness',{}).get('baseColorTexture')
            if texture is not None:
                if material.get('normalTexture'):raise ValueError(f'{path}: textured normal map requires a tangent review')
                accessors.add(primitive['attributes'][f'TEXCOORD_{texture.get("texCoord",0)}'])
    for index in accessors:
        accessor=gltf['accessors'][index];view=gltf['bufferViews'][accessor['bufferView']]
        if accessor['componentType']!=5126 or accessor['type']!='VEC2':raise ValueError(f'{path}: unsupported UV accessor')
        offset=view.get('byteOffset',0)+accessor.get('byteOffset',0);stride=view.get('byteStride',8)
        for i in range(accessor['count']):v=struct.unpack_from('<f',blob,offset+i*stride+4)[0];struct.pack_into('<f',blob,offset+i*stride+4,1-v)
        if 'min' in accessor and 'max' in accessor:accessor['min'][1],accessor['max'][1]=1-accessor['max'][1],1-accessor['min'][1]
    gltf['asset'].setdefault('extras',{})['sourceUVOrigin']='top-left'
    header=json.dumps(gltf,separators=(',',':')).encode();header+=b' '*(-len(header)%4)
    result=struct.pack('<III',0x46546c67,2,28+len(header)+len(blob))+struct.pack('<II',len(header),0x4e4f534a)+header+struct.pack('<II',len(blob),0x004e4942)+blob
    temp=path.with_suffix('.tmp');temp.write_bytes(result);temp.replace(path)
    return dict(car=path.stem,status='corrected',accessors=len(accessors),before=hashlib.sha256(source).hexdigest(),after=hashlib.sha256(result).hexdigest())

def main():
    rows=[repair(ASSETS/f'remaster/car-{car}.glb') for car in json.loads((ASSETS/'catalog.json').read_text())['cars']]
    (ASSETS/'remaster/uv-repair.json').write_text(json.dumps(dict(vehicles=rows,errors=[]),indent=2)+'\n');print(json.dumps(dict(vehicles=len(rows),corrected=sum(r['status']=='corrected' for r in rows),errors=[])))

if __name__=='__main__':main()
