"""Convert resources used by original traffic groups and Hit & Run encounters."""
import hashlib
import json
import subprocess
from pathlib import Path
from campaign import bible
from campaign_assets import resource_audit
from characters import convert_homer
from convert import Converter, GAME, OUT
from vehicle_tuning import read_tuning


def main():
    chapters=[json.loads((OUT/f'campaign/level{n}.json').read_text()) for n in range(1,8)]
    catalog=json.loads((OUT/'catalog.json').read_text())
    assets=json.loads((OUT/'campaign/assets.json').read_text())
    converter=Converter();get,_=bible();vehicles=[]
    traffic={str(c['args'][0]).lower() for chapter in chapters for c in chapter['initial'] if c['op']=='AddTrafficModel'}
    pursuit={str(c['args'][0]).lower() for chapter in chapters for c in chapter['initial'] if c['op']=='CreateChaseManager'}
    required=traffic|pursuit
    for car in sorted(required):
        if not (OUT/f'car-{car}.json').exists():
            converter.export(GAME/f'art/cars/{car}.p3d','car-'+car,vehicle=True);vehicles.append(car)
        assets['cars'][car]='car-'+car
        con=GAME/f'scripts/cars/{car}.con'
        if con.exists():assets['tuning'][car]=read_tuning(con)
        catalog['carNames'][car]=get(car.upper()) or car
    catalog['cars']=sorted(set(catalog['cars'])|required)
    catalog['textures'].update(converter.textures)
    models=resource_audit(chapters)['models'];characters=[]
    for name,output in assets['characters'].items():
        meta=json.loads((OUT/f'{output}.json').read_text())
        if all(any(a['name'].endswith(suffix) for a in meta['animations']) for suffix in ['_flail','_get_up']):continue
        model=models[name]
        animation=next((p for p in [GAME/model.replace('_m.p3d','_a.p3d'),GAME/f'art/chars/{name[0] if "_" in name else name}_a.p3d'] if p.exists()),None)
        if animation is None:
            base={'h':'homer','b':'bart','l':'lisa','m':'marge','a':'apu'}.get(name.partition('_')[0])
            animation=GAME/f'art/chars/{base}_a.p3d' if base else GAME/'art/chars/npd_a.p3d'
        convert_homer(model,str(animation.relative_to(GAME)),output);characters.append(name)
    audio=[]
    for name,path in [('siren','sound/carsound/siren.rsd'),('busted','sound/soundfx/gameplay/busted_03.rsd')]:
        source=GAME/path;out=OUT/f'audio/{name}.m4a'
        subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-i',str(source),'-c:a','aac','-b:a','96k',str(out)],check=True)
        audio.append(dict(name=name,source=path,sha256=hashlib.sha256(source.read_bytes()).hexdigest(),output=str(out.relative_to(OUT))))
    (OUT/'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
    (OUT/'campaign/assets.json').write_text(json.dumps(assets,indent=2)+'\n')
    report=dict(trafficModels=len(traffic),pursuitModels=len(pursuit),newVehicles=vehicles,reactionCharacters=characters,audio=audio,errors=converter.texture_errors)
    (OUT/'campaign/pursuit-resources.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__=='__main__':main()
