import type { Input } from './input';
/** Visible development controls for repeatable input and driving regression checks. */
export function devTools(input:Input,callbacks:{resume:()=>void;place:(value:string)=>void;state:()=>string;pursuit:()=>void;clearPursuit:()=>void;testCoins:()=>void}){
  if(!import.meta.env.DEV||!new URLSearchParams(location.search).has('replay'))return ()=>{};
  const panel=document.createElement('aside');panel.id='development-replay';panel.setAttribute('aria-label','Development replay');
  panel.style.cssText='position:fixed;left:8px;top:135px;z-index:60;padding:9px;background:#182233ef;color:white;font:12px monospace;width:240px;border:1px solid #8695ab';
  panel.innerHTML='<strong>Development replay</strong><label style="display:block">Input sequence<input aria-label="Input sequence" value="W 1000" style="width:220px"></label><button>Run input</button><output style="display:block" aria-live="polite">Ready</output>';
  document.body.append(panel);const field=panel.querySelector('input')!,output=panel.querySelector('output')!,buttons=panel.querySelectorAll('button');let timer=0,disposed=false;
  const state=document.createElement('output');state.style.display='block';panel.append(state);const diagnostics=window.setInterval(()=>{state.textContent=callbacks.state();},500);
  for(const [name,action] of [['Start pursuit',callbacks.pursuit],['Clear pursuit',callbacks.clearPursuit],['Add 75 test coins',callbacks.testCoins]] as const){const button=document.createElement('button');button.textContent=name;button.onclick=()=>{action();callbacks.resume();};panel.append(button);}
  const positionLabel=document.createElement('label'),position=document.createElement('input'),place=document.createElement('button');positionLabel.textContent='World position (x y z heading° foot/car)';position.setAttribute('aria-label','World position');position.value='220 3.5 161 90 car';position.style.width='220px';positionLabel.append(position);place.textContent='Place player';place.onclick=()=>{try{callbacks.place(position.value);callbacks.resume();}catch(error){output.textContent=String(error);}};panel.append(positionLabel,place);panel.style.maxHeight='75vh';panel.style.overflow='auto';
  const codes:Record<string,string>={W:'KeyW',A:'KeyA',S:'KeyS',D:'KeyD',E:'KeyE',F:'KeyF',B:'KeyB',C:'KeyC',SPACE:'Space',SHIFT:'ShiftLeft',H:'KeyH',WAIT:'',F3:'F3'};
  buttons[0].onclick=()=>{
    clearTimeout(timer);input.clear();const sequence=field.value.split(';').map(part=>part.trim().split(/\s+/)).map(([keys,ms])=>({keys:keys.toUpperCase().split('+').map(k=>codes[k]),ms:Math.min(10000,Math.max(16,Number(ms)||100))}));
    if(sequence.some(s=>s.keys.some(k=>k===undefined))){output.textContent='Unknown key';return;}callbacks.resume();
    const next=()=>{input.clear();if(disposed)return;const step=sequence.shift();if(!step){output.textContent='Finished';return;}for(const key of step.keys)if(key){input.keys.add(key);input.pressed.add(key);}output.textContent=`Holding ${step.keys.join('+')} for ${step.ms} ms`;timer=window.setTimeout(next,step.ms);};next();
  };
  return ()=>{disposed=true;clearTimeout(timer);clearInterval(diagnostics);input.clear();panel.remove();};
}
