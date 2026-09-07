import bpy,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_remaster import rebuild_car,ROOT,OUTPUT
cars=json.loads((ROOT/'public/assets/catalog.json').read_text())['cars'];report=[]
for car in cars:
 if not (OUTPUT/('car-'+car+'.glb')).exists():
  result=rebuild_car(car);report.append(result);print(result,flush=True)
(ROOT/'blender/campaign-vehicles.json').write_text(json.dumps(report,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'blender/campaign-vehicles.blend'))
print('CAMPAIGN VEHICLES COMPLETE',len(report),flush=True)
