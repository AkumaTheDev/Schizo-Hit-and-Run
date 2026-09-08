import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,readdirSync,readFileSync } from 'node:fs';
import type { VoiceClip } from '../src/campaign/types.ts';

const assets=JSON.parse(readFileSync('public/assets/campaign/assets.json','utf8')) as {dialogue:Record<string,VoiceClip[]>};
const source=readFileSync('src/audio.ts','utf8');
/** Every level's character, as the converted dialogue tags them. */
const ACTORS=['hom','brt','lis','mrg','apu'];

test('every clip the audio system names is actually shipped', () => {
  const named=[...source.matchAll(/assetURL\('(audio\/[^']+)'\)/g)].map(match=>match[1]);
  const templated=[...source.matchAll(/assetURL\(`(audio\/[^$]*)\$\{[^}]+\}([^`]*)`\)/g)]
    .flatMap(([,before,after])=>[1,2,3].map(n=>`${before}${n}${after}`));
  const files=[...named,...templated];
  assert.ok(files.length>=8,`expected the shipped clips, found ${files.length}`);
  for(const file of files)assert.ok(existsSync(`public/assets/${file}`),`missing ${file}`);
});

test('every voice line in the manifest exists on disk', () => {
  const missing:string[]=[];
  let count=0;
  for(const conversation of Object.values(assets.dialogue)){
    for(const clip of conversation){count++;if(!existsSync(`public/assets/${clip.file}`))missing.push(clip.file);}
  }
  assert.ok(count>400,`expected the converted dialogue, counted ${count}`);
  assert.deepEqual(missing,[],`${missing.length} voice lines are missing`);
});

test('every playable character has lines to speak', () => {
  const spoken=new Map<string,number>();
  for(const conversation of Object.values(assets.dialogue))
    for(const clip of conversation)spoken.set(clip.actor,(spoken.get(clip.actor)??0)+1);
  for(const actor of ACTORS)assert.ok((spoken.get(actor)??0)>20,`${actor} has only ${spoken.get(actor)??0} lines`);
});

test('no shipped audio file is left unreachable by the game', () => {
  // Anything under assets/audio must be named by the audio system, and anything under
  // dialogue must be in the manifest — otherwise it is a file nothing can ever play.
  const referenced=new Set(assets.dialogue?Object.values(assets.dialogue).flat().map(clip=>clip.file.split('/').pop()):[]);
  for(const file of readdirSync('public/assets/campaign/dialogue'))
    assert.ok(referenced.has(file),`${file} is shipped but no manifest entry points at it`);
  for(const file of readdirSync('public/assets/audio'))
    assert.ok(source.includes(file.replace(/[123]\.m4a$/,'')),`assets/audio/${file} is never played`);
});
