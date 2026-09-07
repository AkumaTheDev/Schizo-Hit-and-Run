"""Convert the selected original PS2 audio to browser-supported AAC."""
from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'public/assets/audio';OUTPUT.mkdir(parents=True,exist_ok=True)
TRACKS={'sunday-drive':'sound/music/sunday_drive.rsd','engine':'sound/carsound/homer_car.rsd','homer-start':'homer/w_mstart_hom_02.rsd'}
for name,source in TRACKS.items():
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(ROOT/'source/game'/source),'-c:a','aac','-b:a','112k',str(OUTPUT/(name+'.m4a'))],check=True)
    print(f'{name}.m4a')
