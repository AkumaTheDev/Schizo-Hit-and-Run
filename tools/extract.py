"""Extract the local PS2 disc and Radcore 1.2 archives; never modifies the ISO."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, struct, subprocess

ROOT = Path(__file__).resolve().parents[1]

def extract_rcf(path, destination):
    blob = path.read_bytes()
    if not blob.startswith(b'RADCORE CEMENT LIBRARY\0'):
        raise ValueError(f'Unsupported archive: {path}')
    table, = struct.unpack_from('<I', blob, 0x24)
    count, names = struct.unpack_from('<II', blob, table)
    entries = sorted((struct.unpack_from('<III', blob, table + 16 + i * 12) for i in range(count)), key=lambda v: v[1])
    cursor = names + 8
    manifest = []
    for crc, offset, size in entries:
        length, = struct.unpack_from('<I', blob, cursor)
        cursor += 4
        name = blob[cursor:cursor+length].rstrip(b'\0').decode('ascii').replace('\\', '/')
        cursor += length + 4
        relative = PurePosixPath(name.lower())
        if relative.is_absolute() or '..' in relative.parts or ':' in name or offset+size > len(blob):
            raise ValueError(f'Invalid RCF entry: {name}')
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = blob[offset:offset+size]
        if target.exists() and target.read_bytes() != payload:
            raise ValueError(f'Conflicting archive entry: {name}')
        target.write_bytes(payload)
        manifest.append(dict(path=str(relative), bytes=size, archive=path.name, offset=offset, sha256=hashlib.sha256(payload).hexdigest()))
    return manifest

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--iso', type=Path, default=ROOT.parent/'Hit and Run.iso')
    args=parser.parse_args()
    disc=ROOT/'source/disc'
    if not (disc/'SYSTEM.CNF').exists():
        subprocess.run(['7zz','x',str(args.iso),'-o'+str(disc),'-y','-bsp0'],check=True)
    manifest=[]
    for archive in sorted(disc.glob('*.RCF')):
        destination = ROOT/'source/game' if archive.stem not in ('DIALOGF','DIALOGG','DIALOGS') else ROOT/'source/languages'/archive.stem.lower()
        result=extract_rcf(archive, destination)
        manifest.extend(result)
        print(f'{archive.name}: {len(result)} files', flush=True)
    (ROOT/'source/manifest.json').write_text(json.dumps(manifest,indent=2))
    print(f'Extracted {len(manifest)} entries; {sum(v["bytes"] for v in manifest):,} bytes')
if __name__=='__main__': main()
