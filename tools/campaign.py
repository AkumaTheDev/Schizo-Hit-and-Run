"""Compile the original MFK campaign scripts, locators and text bible."""
from pathlib import Path
from collections import Counter
import argparse,json,re,struct,hashlib
from p3d import read,walk,string
ROOT=Path(__file__).resolve().parents[1];GAME=ROOT/'source/game';OUT=ROOT/'public/assets/campaign'

def strip_comments(source):
    out=[];i=0;quote=False
    while i<len(source):
        ch=source[i]
        if quote:
            out.append(ch)
            if ch=='\\' and i+1<len(source):i+=1;out.append(source[i])
            elif ch=='"':quote=False
            i+=1;continue
        if ch=='"':quote=True;out.append(ch);i+=1;continue
        if source[i:i+2]=='//':
            while i<len(source) and source[i]!='\n':out.append(' ');i+=1
        elif source[i:i+2]=='/*':
            out.extend('  ');i+=2
            while i<len(source) and source[i:i+2]!='*/':out.append('\n' if source[i]=='\n' else ' ');i+=1
            if i==len(source):raise ValueError('Unterminated block comment')
            out.extend('  ');i+=2
        else:out.append(ch);i+=1
    return ''.join(out)

def parse(source):
    clean=strip_comments(source);calls=[];i=0
    while i<len(clean):
        match=re.search(r'([A-Za-z_]\w*)\s*\(',clean[i:])
        if not match:break
        start=i+match.start();p=i+match.end();args=[];part='';quoted=False;was_quoted=False
        while p<len(clean):
            ch=clean[p]
            if quoted:
                if ch=='\\' and p+1<len(clean) and clean[p+1] in ['"','\\']:p+=1;part+=clean[p]
                elif ch=='"':quoted=False
                else:part+=ch
            elif ch=='"':quoted=True;was_quoted=True
            elif ch in ',)':
                value=part.strip()
                if value or was_quoted:
                    if not was_quoted and re.fullmatch(r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)',value):value=float(value) if '.' in value else int(value)
                    args.append(value)
                part='';was_quoted=False
                if ch==')':break
            else:part+=ch
            p+=1
        if p==len(clean) or quoted:raise ValueError(f'Unterminated {match.group(1)} on line {clean[:start].count(chr(10))+1}')
        calls.append(dict(op=match.group(1),args=args,line=clean[:start].count('\n')+1));i=p+1
    return calls

def bible():
    root=read(GAME/'art/frontend/scrooby/resource/txtbible/srr2.p3d')
    c=next(c for c in walk(root) if c.id==0x1800e and c.data[string(c.data)[1]:string(c.data)[1]+1]==b'E')
    _,p=string(c.data);n,mod,size=struct.unpack_from('<III',c.data,p+1);p+=13
    hashes=struct.unpack_from('<'+str(n)+'I',c.data,p);offsets=struct.unpack_from('<'+str(n)+'I',c.data,p+4*n);buffer=c.data[p+8*n:]
    values={h:buffer[o:].decode('utf-16-le',errors='replace').split('\0')[0] for h,o in zip(hashes,offsets)}
    def get(key):
        h=0
        for c in key.encode():h=(c+(h<<6))%mod
        return values.get(h)
    return get,values

def locators(path):
    path=Path(path).resolve();result=[]
    for c in walk(read(path)):
        if c.id!=0x3000005:continue
        name,p=string(c.data);kind,length=struct.unpack_from('<II',c.data,p);payload=c.data[p+8:p+8+length*4];position=list(struct.unpack_from('<3f',c.data,p+8+length*4));position[2]*=-1
        item=dict(name=name,kind=kind,position=position,source=str(path.relative_to(GAME)))
        if kind==3 and len(payload)>=4:item['heading']=-struct.unpack_from('<f',payload)[0]
        if kind==7:item['interior']=payload.split(b'\0')[0].decode('latin1')
        if kind==9:item['actionData']=payload.hex()
        result.append(item)
    return result

def compile_mission(path,level,get):
    calls=parse(path.read_text());mission=dict(id=path.stem[:-1],level=level,source=str(path.relative_to(GAME)),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),setup=[],stages=[])
    stage=None;condition=None
    for call in calls:
        op,args=call['op'],call['args']
        if op=='SelectMission':mission['id']=str(args[0])
        elif op=='AddStage':
            stage=dict(index=len(mission['stages']),args=args,commands=[],objective=None,conditions=[],checkpoint=False);mission['stages'].append(stage);condition=None
        elif op=='CloseStage':stage=None;condition=None
        elif op=='CloseMission':continue
        elif stage is None:mission['setup'].append(call)
        else:
            stage['commands'].append(call)
            if op=='AddObjective':
                if stage['objective'] is not None:raise ValueError(f'{path}: multiple objectives in one stage')
                stage['objective']=dict(type=str(args[0]).lower(),mode=str(args[1]) if len(args)>1 else '',commands=[])
            elif op=='RESET_TO_HERE':stage['checkpoint']=True
            elif op=='SetStageMessageIndex' and args:
                stage['messageIndex']=int(args[0]);stage['message']=get(f'MISSION_OBJECTIVE_{int(args[0]):02d}') or ''
            elif op=='SetHUDIcon':stage['icon']=str(args[0])
            elif op=='AddCondition':
                condition=dict(type=str(args[0]).lower(),args=args[1:],commands=[]);stage['conditions'].append(condition)
            elif op=='CloseCondition':condition=None
            if condition and op not in ['AddCondition','CloseCondition']:condition['commands'].append(call)
    for stage in mission['stages']:
        if stage['objective'] is None:raise ValueError(f'{path}: stage has no objective')
    return mission

def first(calls,op,default=None):
    return next((c['args'] for c in calls if c['op']==op),default)

def main():
    OUT.mkdir(parents=True,exist_ok=True);get,strings=bible();levels=[];mission_count=stage_count=0;types=Counter();conditions=Counter();ops=Counter();all_missions=[];missing=[]
    for level in range(1,8):
        root=GAME/f'scripts/missions/level0{level}';schedule=parse((root/'level.mfk').read_text());initial=parse((root/'leveli.mfk').read_text());names=[str(c['args'][0]) for c in schedule if c['op']=='AddMission']
        data=dict(id=level,initial=initial,schedule=schedule,missions=[],locators={},duplicateLocators=[],interiors=[])
        paths=[GAME/f'art/l{level}_terra.p3d',*sorted((GAME/'art').glob(f'l{level}[rz]*.p3d')),*sorted((GAME/'art').glob(f'l{level}i*.p3d')),*sorted((GAME/f'art/missions/level0{level}').glob('*.p3d')),*sorted((GAME/'art/missions/generic').glob('*.p3d'))]
        for file in paths:
            file_locators=locators(file)
            if re.fullmatch(r'l[1-7]i\d+',file.stem):
                index=int(file.stem[-2:]);interior_name={0:'SpringfieldElementary',1:'KwikEMart',2:'SimpsonsHouse',3:'DMV',4:'Moes',5:'AndroidsDungeon',6:'Observatory',7:'BartRoom'}[index]
                start=next((l for l in file_locators if l['name']=='InteriorEntryEnd'),None)
                exit=next((l for l in file_locators if l['name'].endswith('_exit')),None)
                data['interiors'].append(dict(name=interior_name,scene=file.stem,locators={l['name'].casefold():l for l in file_locators},start=start,exit=exit))
            for locator in file_locators:
                key=locator['name'].casefold()
                if key in data['locators']:data['duplicateLocators'].append(locator['name'])
                data['locators'][key]=locator
        for name in names:
            mission=compile_mission(root/f'{name}i.mfk',level,get);mission['load']=parse((root/f'{name}l.mfk').read_text())
            mission['intro']=compile_mission(root/f'{name}sdi.mfk',level,get) if (root/f'{name}sdi.mfk').exists() else None
            mission['introLoad']=parse((root/f'{name}sdl.mfk').read_text()) if (root/f'{name}sdl.mfk').exists() else []
            for key in [f'MISSION_TITLE_L{level}_{name.upper()}',f'MISSION_TITLE_L{level}{name.upper()}',f'MISSION_TITLE_{level}_{name[1:]}',f'MISSION_TITLE_{level:02d}_{int(name[1:]):02d}',f'MISSION_NAME_L{level}{name.upper()}',f'MISSION_NAME_{level}_{name[1:]}']:
                title=get(key)
                if title:mission['title']=title;break
            mission.setdefault('title','Tutorial' if name=='m0' else 'Level transition' if name=='m8' else f'Level {level} · Mission {name[1:]}')
            mission['transition']=len(mission['stages'])==1 and mission['stages'][0]['objective']['type']=='timer' and name=='m8'
            data['missions'].append(mission);all_missions.append(mission);mission_count+=1;stage_count+=len(mission['stages'])+len(mission['intro']['stages'] if mission['intro'] else [])
            for stage in [*(mission['intro']['stages'] if mission['intro'] else []),*mission['stages']]:
                types[stage['objective']['type']]+=1;conditions.update(c['type'] for c in stage['conditions']);ops.update(c['op'] for c in stage['commands'])
                for c in stage['commands']:
                    if c['op'] in ['SetDestination','AddCollectible','AddStageWaypoint','AddObjectiveNPCWaypoint','AddStageVehicle','AddNPC','AddCollectibleStateProp']:
                        index=1 if c['op'] in ['AddStageVehicle','AddNPC','AddCollectibleStateProp','AddObjectiveNPCWaypoint'] else 0
                        if len(c['args'])<=index:continue
                        value=str(c['args'][index]);key=value.casefold()
                        if key not in data['locators'] and stage['objective']['type'] not in ['interior','gooutside']:missing.append(dict(level=level,mission=name,stage=stage['index'],command=c['op'],locator=value))
        (OUT/f'level{level}.json').write_text(json.dumps(data,separators=(',',':')));levels.append(dict(id=level,missions=[dict(id=m['id'],title=m['title'],transition=m['transition'],stages=len(m['stages'])) for m in data['missions']]))
    rewards=[dict(id=str(c['args'][0]).lower(),path=str(c['args'][1]).replace('\\','/').lower(),type=c['args'][2],quest=c['args'][3],level=int(c['args'][4]),cost=int(c['args'][5]) if len(c['args'])>5 else 0,seller=str(c['args'][6]) if len(c['args'])>6 else '') for c in parse((GAME/'scripts/missions/rewards.mfk').read_text()) if c['op']=='BindReward']
    (OUT/'rewards.json').write_text(json.dumps(rewards,indent=2))
    catalog=dict(levels=levels,missionCount=mission_count,stageCount=stage_count,objectiveTypes=dict(types),conditionTypes=dict(conditions),commandCounts=dict(ops),missingLocators=missing)
    (OUT/'catalog.json').write_text(json.dumps(catalog,indent=2));(OUT/'strings.json').write_text(json.dumps({str(i):get(f'MISSION_OBJECTIVE_{i:02d}') for i in range(400) if get(f'MISSION_OBJECTIVE_{i:02d}')},indent=2))
    print(json.dumps({k:v for k,v in catalog.items() if k not in ['levels','commandCounts','missingLocators']},indent=2));print('Missing locator references:',len(missing));print(json.dumps(missing[:15],indent=2))
if __name__=='__main__':main()
