"""Cut current gameplay and original movie excerpts into an action trailer."""
from pathlib import Path
import json,subprocess,sys
ROOT=Path(__file__).resolve().parents[2];BASE=ROOT/'artifacts/showcase-v2';RAW=BASE/'raw';WORK=BASE/'edit';WORK.mkdir(exist_ok=True);OUT=ROOT/'docs/media';OUT.mkdir(exist_ok=True)
# Time ranges are revised after inspecting the captured takes.
SHOTS=[
 ('ramp',.1,.9),('ramp-reverse',2.4,4.2),('pursuit',4,7.5),('movie:intro',41.7,44.7),('skinner-race',.5,4),
 ('smithers-smash',.4,3.9),('crate',0,3.25),('power-coupling',0,1.3),('bart-escape',2.8,7.8),
 ('waterfront-drive',.3,4.8),('movie:fmv7',.7,4.7),('haunted-pursuit',3,7.5),('ramp-reverse',2.4,4.4),('ramp',3,4.3)
]
def run(args):subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*map(str,args)],check=True)
sequence=[];offset=0;rows=[]
for i,(name,start,end) in enumerate(SHOTS):
 duration=end-start;frames=round(duration*60);filename=f'{i:02d}.mp4';path=WORK/filename
 if name.startswith('movie:'):
  source=ROOT/'public/assets/campaign/movies'/f'{name[6:]}.mp4';args=['-ss',start,'-i',source];vf='scale=1920:1440:flags=lanczos,setsar=1,crop=1920:1080:0:180,fps=60'
 else:
  source=RAW/name;last=round(start*60)+frames-1
  if not (source/f'{last:04d}.jpg').exists():raise ValueError(f'Missing frames: {name}/{last}')
  args=['-framerate',60,'-start_number',round(start*60),'-i',source/'%04d.jpg'];vf='scale=in_range=full:out_range=limited'
  if name=='haunted-pursuit':vf+=',eq=gamma=1.18:brightness=0.012'
 vf+=',format=yuv420p,sidedata=mode=delete:type=ICC_PROFILE,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709'
 if i==0:vf+=',fade=t=in:d=0.08'
 if i==len(SHOTS)-1:vf+=f',fade=t=out:st={duration-.2}:d=0.2'
 if '--reuse-clips' not in sys.argv or not path.exists() or path.stat().st_size==0:run([*args,'-vf',vf,'-frames:v',frames,'-an','-c:v','libx264','-preset','medium','-crf','19','-maxrate','11000k','-bufsize','22000k','-threads','4','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-bsf:v','h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1',path])
 revision=None
 if not name.startswith('movie:'):
  captured=json.loads((RAW/name/'telemetry.json').read_text());known=json.loads((BASE/'revisions.json').read_text()) if (BASE/'revisions.json').exists() else {};revision=captured.get('sourceRevision') or known.get(name) or json.loads((BASE/'source.json').read_text())['revision']
 rows.append(dict(shot=name,start=round(offset,3),duration=round(duration,3),sourceIn=start,sourceOut=end,sourceRevision=revision));offset+=duration;sequence.append(f"file '{filename}'\n");print('Encoded',name,frames,flush=True)
(WORK/'sequence.txt').write_text(''.join(sequence));run(['-f','concat','-safe','0','-i',WORK/'sequence.txt','-c','copy',WORK/'picture.mp4'])
# Dialogue and impact sounds are aligned to the edited action. Music ducks under voices.
inputs=['-i',WORK/'picture.mp4','-i',BASE/'chase-music.m4a'];ducks=[f'between(t,{r["start"]},{r["start"]+r["duration"]})' for r in rows if r['shot'].startswith('movie:')];ducks.append('between(t,0.5,2.3)');duck='+'.join(ducks);filters=[f"[1:a]atrim=duration={offset},asetpts=PTS-STARTPTS,volume='if(gt({duck},0),0.14,0.45)':eval=frame,afade=t=in:d=0.1,afade=t=out:st={offset-1}:d=1[music]"];mix=['music'];next_input=2
cues=[]
for row in rows:
 n=row['shot'];at=row['start'];length=row['duration'];source_in=row['sourceIn']
 if n.startswith('movie:'):
  cues.append((ROOT/'public/assets/campaign/movies'/f'{n[6:]}.mp4',at,length,source_in,.9,'movie'))
 elif n!='power-coupling':
  cues.append((ROOT/'public/assets/audio/engine.m4a',at,length,0,.16,'loop'))
 if n in ['pursuit','haunted-pursuit']:cues.append((ROOT/'public/assets/audio/siren.m4a',at,length,0,.27,'loop'))
 if n=='ramp' and at==0:cues.append((BASE/'sound/air.wav',at+.5,1.71,0,.85,'once'))
 if n=='smithers-smash':cues.append((BASE/'sound/land.wav',at+.15,.85,0,.8,'once'))
 if n=='crate':
  cues.append((BASE/'sound/smash.wav',at+.28,.93,0,.75,'once'))
  for t in [1.65,1.92,2.2]:cues.append((ROOT/'public/assets/audio/coin1.m4a',at+t,.23,0,.35,'once'))
 if n=='power-coupling':cues.append((BASE/'sound/coupling.wav',at+.15,.93,0,.65,'once'))
 if n=='ramp-reverse' and at>30:cues.append((BASE/'sound/whee.wav',at,1.348,0,.75,'once'))
for file,at,length,start,volume,kind in cues:
 if kind=='loop':inputs+=['-stream_loop','-1']
 inputs+=['-i',file];label=f'a{next_input}';resample='aresample=48000,asetrate=60000,aresample=48000,' if file.name=='engine.m4a' else '';chain=f'[{next_input}:a]{resample}atrim=start={start}:duration={length},asetpts=PTS-STARTPTS,aresample=48000,volume={volume},afade=t=in:d=0.012,afade=t=out:st={max(0,length-.03)}:d=0.03,adelay={round(at*1000)}:all=1[{label}]';filters.append(chain);mix.append(label);next_input+=1
filters.append(''.join(f'[{x}]' for x in mix)+f'amix=inputs={len(mix)}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,volume=-0.6dB,aresample=48000,afade=t=out:st={offset-.3}:d=0.3[audio]')
(WORK/'audio-filter.txt').write_text(';\n'.join(filters));target=OUT/'trailer.mp4'
run([*inputs,'-filter_complex_script',WORK/'audio-filter.txt','-map','0:v:0','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-t',offset,'-movflags','+faststart',target])
report={'sourceRevisions':sorted({r['sourceRevision'] for r in rows if r['sourceRevision']}),'resolution':[1920,1080],'fps':60,'durationSeconds':round(offset,3),'shots':rows,'capture':'Current game simulation, with staged starts, timed inputs and directed cameras. Original in-game movies are cut in directly.','audio':'Original Hit & Run chase score, movie audio, character voice and effects mixed in post-production.','addedText':False}
(OUT/'trailer.json').write_text(json.dumps(report,indent=2)+'\n');print(target,flush=True)
