import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const mac='/Applications/Blender.app/Contents/MacOS/Blender';
const blender=process.env.BLENDER_PATH||(existsSync(mac)?mac:'blender');
const child=spawn(blender,['--background','--factory-startup','--python','tools/blender_remaster.py'],{stdio:'inherit'});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
