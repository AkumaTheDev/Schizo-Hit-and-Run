"""Read VIF UNPACK payloads from Pure3D PS2 primitive packets."""
import struct

def unpack(data):
    p=12
    while p<len(data):
        code,=struct.unpack_from('<I',data,p);p+=4
        cmd=(code>>24)&127;n=(code>>16)&255;imm=code&65535
        if cmd>=0x60:
            vn=((cmd>>2)&3)+1;bits=(32,16,8,5)[cmd&3];count=n or 256
            size=(count*vn*bits+7)//8;size=(size+3)&~3
            if p+size>len(data): raise ValueError('Truncated VIF unpack')
            yield cmd,count,vn,bits,imm,data[p:p+size]
            p+=size
        else:
            p+={0x20:4,0x30:16,0x31:16}.get(cmd,0)
            if cmd in (0x50,0x51):p+=imm*16
            if cmd==0x4a:p+=(n or 256)*8
            if cmd not in (0,1,2,3,4,5,6,7,0x10,0x11,0x13,0x14,0x15,0x17,0x20,0x30,0x31,0x4a,0x50,0x51):
                raise ValueError(f'Unknown VIF command {cmd:x} at {p-4:x}')
