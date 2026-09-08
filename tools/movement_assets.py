"""Rebuild the world interaction, jump animation and coin-sound resources."""
import hashlib,json,subprocess
from pathlib import Path
from world_resources import main as world_resources
from characters import convert_homer
from campaign_assets import resource_audit
from convert import GAME,OUT

def main():
    world_resources();chapters=[json.loads((OUT/f'campaign/level{n}.json').read_text()) for n in range(1,8)]
    models=resource_audit(chapters)['models'];assets=json.loads((OUT/'campaign/assets.json').read_text())
    for base in ['homer','bart','lisa','marge','apu']:convert_homer(f'art/chars/{base}_m.p3d',f'art/chars/{base}_a.p3d',base)
    for name,output in assets['characters'].items():
        base={'h':'homer','b':'bart','l':'lisa','m':'marge','a':'apu'}.get(name.partition('_')[0])
        if base and '_' in name:convert_homer(models[name],f'art/chars/{base}_a.p3d',output)
    audio=[]
    for n in [1,2,3]:
        source=GAME/f'sound/soundfx/gameplay/coin_collect_0{n}.rsd';target=OUT/f'audio/coin{n}.m4a'
        subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-i',str(source),'-c:a','aac','-b:a','96k',str(target)],check=True)
        audio.append(dict(source=str(source.relative_to(GAME)),sha256=hashlib.sha256(source.read_bytes()).hexdigest(),output=str(target.relative_to(OUT))))
    (OUT/'world/audio.json').write_text(json.dumps(dict(files=audio,errors=[]),indent=2)+'\n')

if __name__=='__main__':main()
