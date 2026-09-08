"""Prepare the original score and effects used by the trailer's sound edit."""
from pathlib import Path
import hashlib,json,subprocess
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'artifacts/showcase-v2';SOURCE=ROOT/'source/game'
tracks={'chase-music.m4a':'sound/music/hit_run_main.rsd','sound/air.wav':'homer/w_air_hom_04.rsd','sound/whee.wav':'homer/w_fall_hom_whee.rsd','sound/smash.wav':'sound/soundfx/collisions/crate_smash_02.rsd','sound/land.wav':'sound/soundfx/collisions/homer_car_land_01.rsd','sound/coupling.wav':'sound/soundfx/collisions/power_coupling_smash.rsd'}
rows=[]
for name,relative in tracks.items():
 source=SOURCE/relative;target=BASE/name
 if not source.exists():raise FileNotFoundError(f'Extract the original disc audio first: {source}')
 target.parent.mkdir(parents=True,exist_ok=True);codec=['-c:a','aac','-b:a','192k'] if target.suffix=='.m4a' else []
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-ar','48000',*codec,str(target)],check=True)
 rows.append({'source':relative,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'output':name})
(BASE/'audio-sources.json').write_text(json.dumps(rows,indent=2)+'\n');print(f'Prepared {len(rows)} original audio sources')
