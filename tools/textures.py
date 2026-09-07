"""Decode Pure3D PS2 P3DI indexed textures into PNGs."""
import struct
import io
import numpy as np
from PIL import Image

def decode_image(b):
    if b[:4]==b'\x89PNG':return Image.open(io.BytesIO(b)).convert('RGBA')
    if b[:4]!=b'P3DI':raise ValueError(f'Unsupported image {b[:4]!r}')
    fmt,w,h,bpp,palette_size,pixel_size=struct.unpack_from('<6I',b,4)
    palette=b[28:28+palette_size];pixels=b[28+palette_size:28+palette_size+pixel_size]
    if bpp in (4,8):
        colors=np.frombuffer(palette,dtype=np.uint8).reshape(-1,4).copy()
        colors[:,3]=np.minimum(colors[:,3].astype(np.uint16)*255//128,255)
        if bpp==8:
            order=np.arange(256);order=(order&~24)|((order&8)<<1)|((order&16)>>1)
            colors=colors[order]
        indices=np.frombuffer(pixels,dtype=np.uint8)
        if bpp==4:indices=np.stack([indices&15,indices>>4],axis=1).flatten()
        rgba=colors[indices[:w*h]].reshape(h,w,4)
    elif bpp==32:
        rgba=np.frombuffer(pixels,dtype=np.uint8).reshape(h,w,4).copy()
        rgba[:,:,3]=np.minimum(rgba[:,:,3].astype(np.uint16)*255//128,255)
    else:raise ValueError(f'Unsupported pixel depth {bpp}')
    return Image.fromarray(rgba,'RGBA')
