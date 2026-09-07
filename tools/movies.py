"""Convert the supplied PAL RMV PS2 movies to browser H.264/AAC."""
from pathlib import Path
import concurrent.futures,json,struct,subprocess,tempfile,platform
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'public/assets/campaign/movies'

def convert(path):
    data=path.read_bytes()
    if data[:8]!=b'rmvps212':raise ValueError(f'Unsupported RMV {path.name}')
    width,height,frames,size,start,languages=struct.unpack_from('<HHIIII',data,8)
    if size!=len(data) or not 0<languages<=16:raise ValueError(f'Invalid RMV header {path.name}')
    offsets=struct.unpack_from('<'+str(languages)+'I',data,28);sizes=struct.unpack_from('<'+str(languages)+'I',data,96)
    video=data[start:min(offsets)];ending=video.rfind(b'\0\0\1\xb0');video=video[:ending+4]
    if video.count(b'\0\0\1\xb0')!=frames:raise ValueError(f'Frame count mismatch {path.name}')
    target=OUT/(path.stem+'.mp4')
    with tempfile.TemporaryDirectory(prefix='hit-run-movie-') as tmp:
        tmp=Path(tmp);ipu=tmp/'video.ipu';audio=tmp/'audio.rsd'
        ipu.write_bytes(b'ipum'+struct.pack('<IHHI',len(video)+16,width,height,frames)+video)
        audio.write_bytes(data[offsets[0]:offsets[0]+sizes[0]])
        encoder=['-c:v','h264_videotoolbox','-b:v','3000k','-allow_sw','1'] if platform.system()=='Darwin' else ['-c:v','libx264','-preset','fast','-crf','21']
        result=subprocess.run(['ffmpeg','-y','-v','error','-i',str(ipu),'-i',str(audio),'-map','0:v:0','-map','1:a:0','-vf',f'setsar={4*height}/{3*width}',*encoder,'-c:a','aac','-b:a','128k','-movflags','+faststart','-shortest',str(target)],capture_output=True,text=True)
        if result.returncode:raise ValueError(result.stderr)
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(target)]))
    duration=float(info['format']['duration']);expected=frames/25
    if abs(duration-expected)>.2:raise ValueError(f'Duration mismatch {path.name}: {duration} vs {expected}')
    return dict(source=path.name,file='campaign/movies/'+target.name,width=width,height=height,frames=frames,fps=25,duration=duration,audioLanguageIndex=0,bytes=target.stat().st_size)

def main():
    OUT.mkdir(parents=True,exist_ok=True);paths=sorted((ROOT/'source/game/movies').glob('*.rmv'));report=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for item in pool.map(convert,paths):report.append(item);print(item['source'],item['frames'],'frames',item['duration'],'seconds',flush=True)
    (OUT/'manifest.json').write_text(json.dumps(report,indent=2));print(f'Converted {len(report)} original movies')
if __name__=='__main__':main()
