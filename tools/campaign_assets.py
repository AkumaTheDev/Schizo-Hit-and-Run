"""Export the original resources referenced by the compiled campaign."""
import json,re,subprocess,struct,hashlib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from convert import Converter,GAME,OUT
from characters import convert_homer
from p3d import read,walk,string
from campaign import bible

def resource_audit(chapters):
    models={}
    for path in sorted((GAME/'art/chars').glob('*_m.p3d')):
        skeleton=next((c for c in read(path).children if c.id==0x4500),None)
        if skeleton:models[string(skeleton.data)[0].lower()]=str(path.relative_to(GAME))
    calls=[]
    for chapter in chapters:
        calls+=chapter['initial']
        for mission in chapter['missions']:
            for phase in [mission.get('intro'),mission]:
                if phase:calls+=phase['setup']+[c for stage in phase['stages'] for c in stage['commands']]
    npcs=set();cars=set();conversations=set()
    for chapter in chapters:
        for mission in chapter['missions']:
            for phase in [mission.get('intro'),mission]:
                if not phase:continue
                for c in phase['setup']+[c for stage in phase['stages'] for c in stage['commands']]:
                    if c['op']=='SetDialogueInfo':conversations.add((chapter['id'],str(c['args'][2]).lower()))
                    if c['op']=='SetCompletionDialog':conversations.add((chapter['id'],str(c['args'][0]).lower()))
    for c in calls:
        op,a=c['op'],c['args']
        if op in ['AddNPC','AddAmbientCharacter','AddNPCCharacterBonusMission'] and a:npcs.add(str(a[0]).lower())
        if op=='AddPurchaseCarReward':npcs.add(str(a[1]).lower())
        if op in ['AddStageVehicle','InitLevelPlayerVehicle']:cars.add(str(a[0]).lower())
    props=[str(p.relative_to(GAME)) for p in sorted((GAME/'art/missions').rglob('*.p3d'))]
    return {'models':models,'npcs':sorted(npcs),'skins':[],'cars':sorted(cars),'props':props,'conversations':sorted(conversations)}

def main():
    chapters=[json.loads((OUT/f'campaign/level{n}.json').read_text()) for n in range(1,8)]
    rewards=json.loads((OUT/'campaign/rewards.json').read_text());audit=resource_audit(chapters);(GAME.parent/'campaign-resources.json').write_text(json.dumps(audit,indent=2))
    catalog=json.loads((OUT/'catalog.json').read_text());converter=Converter();manifest={'characters':{},'props':{},'cars':{},'dialogue':{},'tuning':{},'missionTuning':{},'presentations':{}}
    models=audit['models'];characters=set(audit['npcs'])|set(audit['skins'])|{r['id'] for r in rewards if r['type']=='skin'}
    for name in sorted(characters):
        model=models.get(name)
        if not model:raise RuntimeError(f'Missing character {name}')
        animation=next((p for p in [GAME/model.replace('_m.p3d','_a.p3d'),GAME/f'art/chars/{name[0] if "_" in name else name}_a.p3d'] if p.exists()),None)
        if animation is None:
            base={'h':'homer','b':'bart','l':'lisa','m':'marge','a':'apu'}.get(name.partition('_')[0]);animation=GAME/f'art/chars/{base}_a.p3d' if base else GAME/'art/chars/npd_a.p3d'
        output=name if name in ['homer','bart','lisa','marge','apu'] else 'npc-'+name
        if not (OUT/(output+'.json')).exists() or not any('_dialogue_' in a['name'] for a in json.loads((OUT/(output+'.json')).read_text())['animations']):convert_homer(model,str(animation.relative_to(GAME)),output)
        manifest['characters'][name]=output
    cars=sorted(set(catalog['cars'])|set(audit['cars'])|{r['id'] for r in rewards if r['type']=='car'})
    for car in cars:
        if not (OUT/f'car-{car}.json').exists():converter.export(GAME/f'art/cars/{car}.p3d','car-'+car,vehicle=True)
        manifest['cars'][car]='car-'+car
        con=GAME/f'scripts/cars/{car}.con'
        if con.exists():manifest['tuning'][car]={n:float(v) for n,v in re.findall(r'(\w+)\s*\(\s*([\d.-]+)\s*\)',con.read_text())}
    for chapter in chapters:
        for interior in chapter['interiors']:
            if not (OUT/(interior['scene']+'.json')).exists():converter.export(GAME/f"art/{interior['scene']}.p3d",interior['scene'])
    for path in audit['props']:
        output='prop-'+Path(path).stem+'-'+hashlib.sha1(path.encode()).hexdigest()[:6]
        root=converter.export(GAME/path,output,vehicle=True)
        meta=json.loads((OUT/(output+'.json')).read_text())
        for alias in [Path(path).stem,*meta['meshes'],*(o['name'] for o in meta['objects']),*(string(c.data)[0] for c in root.children if c.id==0x4512)]:
            if not meta['objects']:continue
            level_match=re.search(r'/level0(\d)/',path)
            if level_match:manifest['props'][level_match[1]+':'+alias.lower()]=output
            manifest['props'].setdefault(alias.lower(),output)
    for con in (GAME/'scripts/cars').rglob('*.con'):
        manifest['missionTuning'][str(con.relative_to(GAME/'scripts/cars')).lower()]={n:float(v) for n,v in re.findall(r'(\w+)\s*\(\s*([\d.-]+)\s*\)',con.read_text())}
    for chapter in chapters:
        for mission in chapter['missions']:
            for phase in [mission.get('intro'),mission]:
                if not phase:continue
                for stage in phase['stages']:
                    for c in stage['commands']:
                        if c['op']!='SetPresentationBitmap':continue
                        path=str(c['args'][0]).replace('\\','/').lower();root=read(GAME/path);converter.resources(root)
                        texture=next((string(t.data)[0].lower() for t in walk(root) if t.id==0x19000),None)
                        if texture:manifest['presentations'][path]=converter.textures[texture]
    # Match original conversation IDs and line ordering. Prefer mission-specific
    # recordings at runtime; a level-only recording is the original fallback.
    wanted={(n,name) for n,name in audit['conversations']};dest=OUT/'campaign/dialogue';dest.mkdir(exist_ok=True)
    clips=[]
    for source in sorted((GAME/'conversations').glob('c_*.rsd')):
        match=re.fullmatch(r'c_(.+)_(\d+)_(.+)_([^_]+)_l(\d)([mrbg]\d+)?\.rsd',source.name,re.I)
        if not match:continue
        name,line,kind,actor,level,mission=match.groups();level=int(level)
        if mission and mission.startswith('r'):mission='s'+mission
        if mission and mission.startswith('b'):mission='bm'+mission[1:]
        if mission and mission.startswith('g'):mission='gr'+mission[1:]
        if (level,name) not in wanted:continue
        out=dest/(source.stem+'.m4a');clip={'line':int(line),'actor':actor,'kind':kind,'file':str(out.relative_to(OUT)),'mission':mission or ''}
        manifest['dialogue'].setdefault(f'{level}:{name}',[]).append(clip);clips.append((source,out))
    def convert(pair):
        source,out=pair
        if not out.exists():subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-i',str(source),'-c:a','aac','-b:a','96k',str(out)],check=True)
    with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(convert,clips))
    for entries in manifest['dialogue'].values():entries.sort(key=lambda c:c['line'])
    get,_=bible();manifest['names']={name:get(name.upper()) or name for name in set(models)|set(cars)}
    catalog['carNames']={name:manifest['names'][name] for name in cars};catalog['cars']=cars;catalog['textures'].update(converter.textures)
    (OUT/'catalog.json').write_text(json.dumps(catalog,indent=2));(OUT/'campaign/assets.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps({'characters':len(characters),'cars':len(cars),'propAliases':len(manifest['props']),'dialogueClips':len(clips),'textureErrors':converter.texture_errors}))
if __name__=='__main__':main()
