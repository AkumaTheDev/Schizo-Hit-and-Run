import type { Input } from './input';
/** Visible development controls for repeatable input and mission regression checks. */
export function devTools(input:Input,callbacks:{resume:()=>void;objective:()=>void;retry:()=>void;scenario:(value:string)=>Promise<void>;state:()=>string}){
  if(!import.meta.env.DEV||!new URLSearchParams(location.search).has('replay'))return ()=>{};
  const panel=document.createElement('aside');panel.id='development-replay';panel.setAttribute('aria-label','Development replay');
  panel.style.cssText='position:fixed;left:8px;top:135px;z-index:60;padding:9px;background:#182233ef;color:white;font:12px monospace;width:240px;border:1px solid #8695ab';
  panel.innerHTML='<strong>Development replay</strong><label style="display:block">Input sequence<input aria-label="Input sequence" value="W 1000" style="width:220px"></label><button>Run input</button><button>Move near objective</button><button>Retry mission</button><output style="display:block" aria-live="polite">Ready</output>';
  document.body.append(panel);const field=panel.querySelector('input')!,output=panel.querySelector('output')!,buttons=panel.querySelectorAll('button');let timer=0,disposed=false;
  const label=document.createElement('label'),scenario=document.createElement('input'),start=document.createElement('button'),state=document.createElement('output');label.textContent='Mission scenario';scenario.setAttribute('aria-label','Mission scenario');scenario.value='1:m0:intro:0';label.append(scenario);start.textContent='Load scenario';panel.append(label,start,state);start.onclick=()=>{void callbacks.scenario(scenario.value).catch(error=>{output.textContent=String(error);});};const diagnostics=window.setInterval(()=>{state.textContent=callbacks.state();},500);
  const codes:Record<string,string>={W:'KeyW',A:'KeyA',S:'KeyS',D:'KeyD',E:'KeyE',F:'KeyF',SPACE:'Space',SHIFT:'ShiftLeft',H:'KeyH'};
  buttons[0].onclick=()=>{
    clearTimeout(timer);input.clear();const sequence=field.value.split(';').map(part=>part.trim().split(/\s+/)).map(([keys,ms])=>({keys:keys.toUpperCase().split('+').map(k=>codes[k]),ms:Math.min(10000,Math.max(16,Number(ms)||100))}));
    if(sequence.some(s=>s.keys.some(k=>!k))){output.textContent='Unknown key';return;}callbacks.resume();
    const next=()=>{input.clear();if(disposed)return;const step=sequence.shift();if(!step){output.textContent='Finished';return;}for(const key of step.keys){input.keys.add(key);input.pressed.add(key);}output.textContent=`Holding ${step.keys.join('+')} for ${step.ms} ms`;timer=window.setTimeout(next,step.ms);};next();
  };
  buttons[1].onclick=()=>{callbacks.objective();callbacks.resume();};buttons[2].onclick=()=>{callbacks.retry();callbacks.resume();};
  return ()=>{disposed=true;clearTimeout(timer);clearInterval(diagnostics);input.clear();panel.remove();};
}
