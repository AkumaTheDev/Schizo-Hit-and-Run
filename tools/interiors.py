"""Export static interior physics volumes, separately from terrain intersections.

CollisionVolume parents bound their descendants for broad-phase queries. Only
leaves represent solid geometry; treating the enclosing box as solid fills rooms.
"""
from collections import Counter
from pathlib import Path
import hashlib
import json
import math
import struct
from p3d import read, walk, string

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / 'source/game'
OUT = ROOT / 'public/assets/collision'
VOLUME, VECTOR = 0x7010001, 0x7010007


def vector(chunk):
    x, y, z = struct.unpack('<3f', chunk.data)
    return [x, y, -z]


def leaves(volume, name):
    children = [c for c in volume.children if c.id == VOLUME]
    _, _, count = struct.unpack('<IiI', volume.data)
    if count != len(children):
        raise ValueError(f'{name}: declared {count} child volumes, found {len(children)}')
    if children:
        for child in children:
            yield from leaves(child, name)
        return
    shapes = [c for c in volume.children if c.id in (0x7010002, 0x7010003, 0x7010004)]
    if len(shapes) != 1:
        raise ValueError(f'{name}: unsupported leaf {[hex(c.id) for c in volume.children]}')
    shape = shapes[0]
    vectors = [vector(c) for c in shape.children if c.id == VECTOR]
    if shape.id == 0x7010004:
        if len(vectors) != 4:
            raise ValueError(f'{name}: box requires center and three axes')
        result = dict(kind='box', halfExtents=list(struct.unpack('<3f', shape.data)), axes=vectors[1:])
    elif shape.id == 0x7010003:
        if len(vectors) != 2:
            raise ValueError(f'{name}: cylinder requires center and axis')
        radius, length, flat = struct.unpack('<ffH', shape.data)
        result = dict(kind='cylinder', radius=radius, length=length, flatEnds=bool(flat), axis=vectors[1])
    else:
        if len(vectors) != 1:
            raise ValueError(f'{name}: sphere requires center')
        result = dict(kind='sphere', radius=struct.unpack('<f', shape.data)[0])
    result.update(name=name, center=vectors[0])
    dimensions = result.get('halfExtents', [result.get('radius'), result.get('length', 1)])
    if not all(math.isfinite(v) and v > 0 for v in dimensions):
        raise ValueError(f'{name}: invalid shape dimensions')
    if not all(math.isfinite(v) for row in vectors for v in row):
        raise ValueError(f'{name}: invalid shape vectors')
    yield result


def convert(path):
    shapes = []
    for entity in walk(read(path)):
        if entity.id != 0x3f00001:  # StaticPhys; dynamic prop transforms differ.
            continue
        name = string(entity.data)[0]
        for obj in entity.children:
            if obj.id == 0x7010000:
                for volume in obj.children:
                    if volume.id == VOLUME:
                        shapes.extend(leaves(volume, name))
    if not shapes:
        raise ValueError(f'{path}: no static interior physics shapes')
    return dict(version=1, source=str(path.relative_to(GAME)),
                sha256=hashlib.sha256(path.read_bytes()).hexdigest(), shapes=shapes)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    scenes, counts = [], Counter()
    for path in sorted((GAME / 'art').glob('l[1-7]i[0-9][0-9].p3d')):
        result = convert(path)
        (OUT / f'{path.stem}.json').write_text(json.dumps(result, separators=(',', ':')) + '\n')
        counts.update(s['kind'] for s in result['shapes'])
        scenes.append(dict(scene=path.stem, shapes=len(result['shapes']), sha256=result['sha256']))
    manifest = dict(version=1, scenes=scenes, counts=dict(counts), errors=[])
    (OUT / 'interiors.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Interior collision: {len(scenes)} scenes, {sum(counts.values())} shapes, {dict(counts)}, 0 errors')
