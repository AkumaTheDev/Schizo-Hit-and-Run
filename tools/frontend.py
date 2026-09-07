"""Extract and reassemble the original Scrooby UI sprites and layout metadata."""
from pathlib import Path
from PIL import Image
import json,struct
from p3d import read,walk,string
from textures import decode_image
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets/ui';OUT.mkdir(parents=True,exist_ok=True)

def sprite(chunk):
    name,p=string(chunk.data);nativew,nativeh=struct.unpack_from('<II',chunk.data,p);_,p=string(chunk.data,p+8);w,h,count,border=struct.unpack_from('<4I',chunk.data,p)
    out=Image.new('RGBA',(w,h));x=y=0;rowheight=0
    for image in chunk.children:
        if image.id!=0x19001:continue
        raw=next(c for c in image.children if c.id==0x19002).data[4:];tile=decode_image(raw)
        # Pure3D's blit-border tiles reserve one texel on each side.
        tw,th=tile.size
        if border:
            tile=tile.crop((1,1,tw-1,th-1));tw-=2;th-=2
        if x>=w:x=0;y+=rowheight;rowheight=0
        out.paste(tile,(x,y));x+=tw;rowheight=max(rowheight,th)
    out.save(OUT/name.lower());return dict(width=w,height=h,nativeWidth=nativew,nativeHeight=nativeh,file=name.lower())

def layout(chunk):
    name,p=string(chunk.data);version,x,y,w,h,jx,jy,b,g,r,a,alpha,rotation=struct.unpack_from('<IiiIIIIBBBBIf',chunk.data,p);p+=40
    result=dict(name=name,x=x,y=y,width=w,height=h,justify=[jx,jy],color=[r,g,b,a],rotation=rotation)
    if chunk.id==0x18006:
        count,=struct.unpack_from('<I',chunk.data,p);p+=4;names=[]
        for i in range(count):value,p=string(chunk.data,p);names.append(value)
        result.update(kind='sprite',images=names)
    else:
        style,p=string(chunk.data,p);result.update(kind='text',font=style,strings=[])
        for c in chunk.children:
            if c.id==0x1800b:
                _,p=string(c.data);value,p=string(c.data,p);result['strings'].append(value)
    return result

def main():
    catalog={};pages={};fonts={}
    for file in ['frontend','ingame','ingamel1','ingamel2','ingamel3','ingamel4','ingamel5','ingamel6','ingamel7']:
        root=read(ROOT/f'source/game/art/frontend/scrooby/{file}.p3d')
        for c in root.children:
            if c.id==0x19005:catalog[string(c.data)[0].lower()]=sprite(c)
            if c.id==0x22000:
                name,p=string(c.data,4);_,p=string(c.data,p);size,width,height,baseline=struct.unpack_from('<4f',c.data,p)
                texture=next(t for t in c.children if t.id==0x19000);img=texture.children[0].children[0].data[4:];image=decode_image(img);font_file='font-'+name.lower()+'.png';image.save(OUT/font_file)
                glyphchunk=next(t for t in c.children if t.id==0x22001);count,=struct.unpack_from('<I',glyphchunk.data);glyphs={}
                for i in range(count):
                    tex,u0,v0,u1,v1,left,right,w,advance,code=struct.unpack_from('<I8fI',glyphchunk.data,4+i*40)
                    glyphs[chr(code)]=dict(x=u0*image.width,y=(1-v1)*image.height,width=(u1-u0)*image.width,height=(v1-v0)*image.height,advance=advance,left=left)
                fonts[name]=dict(file=font_file,size=size,height=height,baseline=baseline,glyphs=glyphs)
        for c in walk(root):
            if c.id==0x18002:pages[file+'/'+string(c.data)[0]]=[layout(s) for s in walk(c) if s.id in (0x18006,0x18007)]
    (OUT/'fonts.json').write_text(json.dumps(fonts,indent=2))
    (OUT/'catalog.json').write_text(json.dumps(catalog,indent=2));(OUT/'layouts.json').write_text(json.dumps(pages,indent=2))
    print(f'{len(catalog)} original UI sprites; {len(pages)} Scrooby pages')
if __name__=='__main__':main()
