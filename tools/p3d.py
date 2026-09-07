"""Bounds-checked reader for little-endian Pure3D and Radical LZR blocks."""
import struct
from dataclasses import dataclass

def decompress(b):
    if b[:4] != b'P3DZ': return b
    total,=struct.unpack_from('<I',b,4); p=8; result=bytearray()
    while len(result)<total:
        compressed,size=struct.unpack_from('<II',b,p);p+=8; end=p+compressed;out=bytearray()
        while len(out)<size:
            code=b[p];p+=1
            length=code&15
            if length==0:
                length=15
                while b[p]==0: length+=255;p+=1
                length+=b[p];p+=1
            if code>15:
                offset=(code>>4)|(b[p]<<4);p+=1
                if offset==0 or offset>len(out): raise ValueError('Invalid LZR back reference')
                for _ in range(length): out.append(out[-offset])
            else:
                out.extend(b[p:p+length]);p+=length
        if len(out)!=size or p>end: raise ValueError('LZR size mismatch')
        result.extend(out);p=end
    if len(result)!=total: raise ValueError('LZR total mismatch')
    return bytes(result)

@dataclass
class Chunk:
    id:int
    data:bytes
    children:list

def chunks(b,start=0,end=None):
    end=len(b) if end is None else end
    out=[]
    while start<end:
        if start+12>end: raise ValueError('Truncated P3D header')
        id,head,size=struct.unpack_from('<III',b,start)
        if head<12 or size<head or start+size>end: raise ValueError(f'Invalid P3D chunk {id:x} at {start:x}: {head}/{size}')
        out.append(Chunk(id,b[start+12:start+head],chunks(b,start+head,start+size)))
        start+=size
    return out

def read(path): return chunks(decompress(path.read_bytes()))[0]
def walk(c):
    yield c
    for sub in c.children: yield from walk(sub)
def string(b,p=0):
    n=b[p];return b[p+1:p+1+n].rstrip(b'\0').decode('latin1'),p+1+n
