from p3d import *
from pathlib import Path
r=read(Path('source/game/art/cars/famil_v.p3d'))
b=next(c.data for c in walk(r) if c.id==0x10012)
p=12
while p<len(b):
 code,=struct.unpack_from('<I',b,p);at=p;p+=4;cmd=(code>>24)&127;n=(code>>16)&255;imm=code&65535
 if cmd>=0x60:
  vn=((cmd>>2)&3)+1; bits=(32,16,8,5)[cmd&3]; count=n or 256
  size=(count*vn*bits+7)//8; size=(size+3)&~3
  print(hex(at),'UNPACK',hex(cmd),count,vn,bits,hex(imm), 'data',repr(b[p:p+min(32,size)]))
  if bits==32: print(' ',struct.unpack_from('<'+str(min(8,size//4))+'f',b,p))
  p+=size
 else:
  print(hex(at),hex(cmd),n,hex(imm))
  p+= {0x20:4,0x30:16,0x31:16}.get(cmd,0)
  if cmd in (0x50,0x51):p+=imm*16
  if cmd==0x4a:p+=(n or 256)*8
