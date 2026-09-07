from pathlib import Path
import time,sys
root=Path(__file__).resolve().parents[2]/'artifacts/showcase/raw'/sys.argv[1]
last=root/f'{int(sys.argv[2])-1:04d}.jpg';first=root/'0000.jpg';deadline=time.monotonic()+60
while time.monotonic()<deadline:
 if first.exists() and last.exists() and last.stat().st_mtime>=first.stat().st_mtime:
  print(f'{sys.argv[1]}: {sys.argv[2]} frames ready');break
 time.sleep(.5)
else:raise SystemExit('Capture has not completed')
