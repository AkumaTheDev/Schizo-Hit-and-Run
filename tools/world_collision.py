"""Restore world-space static physics for exterior buildings and scenery."""
import hashlib
import json
from collections import Counter
from interiors import convert, GAME, OUT


def main():
    OUT.mkdir(parents=True,exist_ok=True);levels=[];totals=Counter()
    for level in range(1,8):
        data=json.loads((OUT.parent/f'level{level}.json').read_text());shapes=[];sources=[]
        for scene in data['scenes']:
            path=GAME/f'art/{scene}.p3d'
            result=convert(path,allow_empty=True)
            shapes.extend(result['shapes'])
            sources.append(dict(source=result['source'],sha256=result['sha256'],shapes=len(result['shapes'])))
        digest=hashlib.sha256(json.dumps(sources,sort_keys=True).encode()).hexdigest()
        output=dict(version=1,source=f'level{level} static physics',sha256=digest,sources=sources,shapes=shapes)
        (OUT/f'world-level{level}.json').write_text(json.dumps(output,separators=(',',':'))+'\n')
        counts=Counter(shape['kind'] for shape in shapes);totals.update(counts)
        levels.append(dict(level=level,shapes=len(shapes),counts=dict(counts),sha256=digest))
    report=dict(levels=levels,counts=dict(totals),errors=[])
    (OUT/'world.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__=='__main__':main()
