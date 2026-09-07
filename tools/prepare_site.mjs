import { readFile,readdir,rm,stat } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist/assets');
const {scenes}=JSON.parse(await readFile(path.join(root,'remaster/scenery.json'),'utf8'));
let bytes=0;
// Keep all converted assets in Git. The site loads the remastered scene buffers,
// so the duplicate source geometry does not need a second copy in the deployment.
for(const scene of scenes){
  if(!/^l[1-7][a-z0-9_]+$/.test(scene))throw new Error(`Unexpected scene ${scene}`);
  for(const ext of ['json','bin']){const file=path.join(root,`${scene}.${ext}`);try{bytes+=(await stat(file)).size;await rm(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
console.log(`Site prepared: omitted ${bytes.toLocaleString()} bytes of duplicate source geometry.`);
// The browser prefers the WebP twin of each texture, so the PNG originals stay in Git only.
let pngBytes=0,pngCount=0;
for(const folder of ['textures','remaster']){
  for(const file of await readdir(path.join(root,folder))){
    if(!file.endsWith('.webp'))continue;
    const png=path.join(root,folder,file.replace(/\.webp$/,'.png'));
    try{pngBytes+=(await stat(png)).size;await rm(png);pngCount++;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
console.log(`Site prepared: omitted ${pngCount} PNG textures (${pngBytes.toLocaleString()} bytes) that have WebP twins.`);
