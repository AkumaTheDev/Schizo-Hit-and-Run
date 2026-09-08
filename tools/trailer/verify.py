"""Check the trailer's streams and render a contact sheet around every cut."""
from pathlib import Path
from PIL import Image,ImageDraw
import json,subprocess,hashlib
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/media';WORK=ROOT/'artifacts/showcase-v2/review';WORK.mkdir(exist_ok=True)
video=OUT/'trailer.mp4';report=json.loads((OUT/'trailer.json').read_text());probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-show_format','-of','json',video]));streams=probe['streams'];v=next(s for s in streams if s['codec_type']=='video');a=next(s for s in streams if s['codec_type']=='audio')
expected=round(report['durationSeconds']*60);assert v['width']==1920 and v['height']==1080;assert v['r_frame_rate']=='60/1';assert int(v['nb_read_frames'])==expected;(WORK/'probe.json').write_text(json.dumps(probe,indent=2))
assert abs(float(v['duration'])-float(a['duration']))<.05;assert v['color_transfer']=='bt709' and v['color_range']=='tv'
frames=[];labels=[]
for row in report['shots']:
 for position in [.08,.5*row['duration'],row['duration']-.08]:
  n=round((row['start']+position)*60);frames.append(n);labels.append(f"{n/60:.2f}s {row['shot']}")
frames+= [expected-1];labels+=['Last frame'];mapping=dict(zip(frames,labels));frames=sorted(mapping)
select='+'.join(f'eq(n,{n})' for n in frames)
subprocess.run(['ffmpeg','-v','error','-y','-i',str(video),'-vf',f"select='{select}',scale=384:216",'-fps_mode','vfr',str(WORK/'cut-%03d.jpg')],check=True)
images=sorted(WORK.glob('cut-*.jpg'));assert len(images)==len(frames)
for page in range((len(images)+11)//12):
 sheet=Image.new('RGB',(1536,720),(20,20,20));draw=ImageDraw.Draw(sheet)
 for j,image in enumerate(images[page*12:page*12+12]):
  i=page*12+j;x=(j%4)*384;y=(j//4)*240;sheet.paste(Image.open(image),(x,y));draw.text((x+6,y+220),mapping[frames[i]],fill='white')
 sheet.save(WORK/f'cuts-{page+1}.jpg',quality=94)
report['verification']={'videoFrames':int(v['nb_read_frames']),'videoDurationSeconds':float(v['duration']),'audioDurationSeconds':float(a['duration']),'fps':v['r_frame_rate'],'colour':'BT.709 limited range','bytes':video.stat().st_size,'sha256':hashlib.sha256(video.read_bytes()).hexdigest()};(OUT/'trailer.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report['verification']),flush=True)
