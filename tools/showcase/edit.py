"""Assemble the directed renderer captures into a short, shareable H.264 film."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageFilter
import subprocess,json
ROOT=Path(__file__).resolve().parents[2];RAW=ROOT/'artifacts/showcase/raw';OUT=ROOT/'docs/media';WORK=ROOT/'artifacts/showcase/edit';WORK.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
FONT='/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf'
SMALL='/System/Library/Fonts/Supplemental/Arial.ttf'
shots=[('evergreen-drive',225),('homer-marge',150),('downtown',195),('waterfront',210),('kwik-e-mart',150),('halloween',210),('springfield-hero',210)]
def run(args):subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y',*map(str,args)],check=True)
def text(layer,words,xy,size,font=FONT,fill='white',center=False):
 draw=ImageDraw.Draw(layer);f=ImageFont.truetype(font,size)
 if center:xy=(xy[0]-draw.textbbox((0,0),words,font=f)[2]/2,xy[1])
 draw.text((xy[0]+2,xy[1]+3),words,font=f,fill=(0,0,0,160),stroke_width=3,stroke_fill=(0,0,0,80));draw.text(xy,words,font=f,fill=fill)
intro=Image.new('RGBA',(1920,1080));text(intro,'THE SIMPSONS: HIT & RUN',(78,800),34,fill='#ffe045');text(intro,'Rebuilt for the browser',(76,847),64);intro.save(WORK/'intro.png')
for name,frames in shots:
 if not (RAW/name/f'{frames-1:04d}.jpg').exists():raise RuntimeError(f'Missing frames: {name}')
 args=['-framerate','30','-i',RAW/name/'%04d.jpg']
 if name=='evergreen-drive':
  args+=['-i',WORK/'intro.png','-filter_complex',"[0:v][1:v]overlay=enable='between(t,0.6,4.8)',fade=t=in:d=0.25,format=yuv420p[v]",'-map','[v]']
 else:args+=['-vf',('eq=gamma=1.25:brightness=0.012,' if name=='halloween' else '')+'format=yuv420p']
 args+=['-frames:v',frames,'-an','-c:v','libx264','-preset','slow','-crf','19','-threads','4','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',WORK/f'{name}.mp4']
 run(args);print('Encoded',name,flush=True)
hero=Image.open(RAW/'springfield-hero'/'0150.jpg').convert('RGB')
end=Image.new('RGBA',(1920,1080),(0,0,0,255))
logo=Image.open(ROOT/'public/assets/ui/gamelogo.png').convert('RGBA');logo.thumbnail((800,390),Image.Resampling.LANCZOS)
# Scale the original artwork proportionally rather than regenerating the logo.
ratio=min(800/logo.width,390/logo.height);logo=logo.resize((round(logo.width*ratio),round(logo.height*ratio)),Image.Resampling.LANCZOS);end.alpha_composite(logo,((1920-logo.width)//2,150))
text(end,'PLAY THE WEB BUILD',(960,605),48,center=True);text(end,'vheissu.github.io/hit-and-run-web',(960,686),39,font=SMALL,center=True);text(end,'An unofficial Three.js reconstruction · Work in progress',(960,842),27,font=SMALL,fill='#cbd5db',center=True);end.convert('RGB').save(WORK/'end.jpg',quality=98)
run(['-loop','1','-framerate','30','-i',WORK/'end.jpg','-t','5','-vf','fade=t=in:d=0.3,fade=t=out:st=4.5:d=0.5,format=yuv420p','-an','-c:v','libx264','-preset','slow','-crf','19','-threads','4','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709',WORK/'end.mp4'])
concat=WORK/'sequence.txt';concat.write_text(''.join(f"file '{name}.mp4'\n" for name,_ in shots)+"file 'end.mp4'\n")
run(['-f','concat','-safe','0','-i',concat,'-i',ROOT/'public/assets/audio/sunday-drive.m4a','-map','0:v:0','-map','1:a:0','-c:v','copy','-af','atrim=duration=50,asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=47:d=3,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000','-c:a','aac','-b:a','192k','-t','50','-movflags','+faststart',WORK/'master.mp4'])
run(['-i',WORK/'master.mp4','-vf','scale=in_range=full:out_range=limited,format=yuv420p,sidedata=mode=delete:type=ICC_PROFILE,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','libx264','-preset','medium','-crf','20','-maxrate','7500k','-bufsize','15000k','-profile:v','high','-level:v','4.1','-threads','4','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-bsf:v','h264_metadata=video_full_range_flag=0:colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1','-c:a','copy','-movflags','+faststart',OUT/'showcase.mp4'])
for shot,file,frame in [('homer-marge','homer-and-marge',90),('downtown','downtown',90),('waterfront','waterfront',90),('kwik-e-mart','kwik-e-mart',90),('halloween','halloween',90),('springfield-hero','springfield',120)]:
 image=Image.open(RAW/shot/f'{frame:04d}.jpg').convert('RGB');image.save(OUT/f'{file}.jpg',quality=94,optimize=True)
poster=hero.convert('RGBA');shade=Image.new('RGBA',poster.size);d=ImageDraw.Draw(shade)
for y in range(600,1080):d.line((0,y,1920,y),fill=(0,0,0,round((y-600)/480*180)))
poster.alpha_composite(shade);text(poster,'HIT & RUN IN THE BROWSER',(80,847),65);text(poster,'Watch the 50-second showcase',(82,938),31,font=SMALL,fill='#ffe045');poster.convert('RGB').save(OUT/'showcase-poster.jpg',quality=94,optimize=True)
(OUT/'showcase.json').write_text(json.dumps({'durationSeconds':50,'resolution':[1920,1080],'fps':30,'sourceRevision':json.loads((ROOT/'artifacts/showcase/source.json').read_text())['revision'],'capture':'Direct browser renderer; staged cameras and driving inputs. Traffic was cleared for the driving takes.','soundtrack':'Converted original Sunday Drive music','shots':[{'name':n,'frames':f,'seconds':f/30} for n,f in shots]},indent=2))
print(OUT/'showcase.mp4')
