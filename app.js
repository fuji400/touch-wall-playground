'use strict';
const $=id=>document.getElementById(id),stage=$('stage'),cursor=$('cursor'),touch=$('touch');
const mobile=matchMedia('(pointer:coarse)').matches;
document.body.classList.toggle('mobile',mobile);
const effects=WallCatalog.effects,byId=Object.fromEntries(effects.map(e=>[e.id,e]));
const groups={favourites:'Favourites',paintings:'Living paintings',generative:'Generative',light:'Light + sound',new:'Body + touch',lab:'Lab',living:'Living',recycle:'Particles'};
const STORE='touch-wall-beta-v2';let saved={};try{saved=JSON.parse(localStorage.getItem(STORE)||'{}');if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};}catch{}
let current='fable',moveId=null,pressId=null,keyPress=false,mousePress=false,started=false,loadToken=0,opener=null;
const loaded=new Map(),state={};
const persist=()=>{try{localStorage.setItem(STORE,JSON.stringify({effects:state}));}catch{}};
function cleanValue(knob,value){let n=Number(value);if(!Number.isFinite(n))n=knob.def;n=Math.max(knob.min,Math.min(knob.max,n));if(knob.choices&&!knob.choices.some(c=>c[0]===n))n=knob.def;return n;}
for(const effect of effects){
  const stored=saved.effects?.[effect.id]||{};
  state[effect.id]={values:Object.fromEntries(Object.entries(effect.knobs).map(([key,knob])=>[key,cleanValue(knob,stored.values?.[key]??knob.def)])),music:stored.music!==false,amount:Math.max(0,Math.min(100,Number.isFinite(stored.amount)?stored.amount:60))};
}
if(mobile){$('welcome').textContent='Drag to position the simulated hand. Hold Touch with a second finger to activate contact.';$('hint').textContent='Drag = position · hold Touch = contact';}
function drawCursor(){const i=WallKit.input;cursor.style.display=i.present?'block':'none';cursor.style.transform=`translate(${i.x*innerWidth}px,${i.y*innerHeight}px)`;cursor.classList.toggle('pressing',i.pressed);touch.setAttribute('aria-pressed',String(i.pressed));}
function update(){WallKit.input.pressed=mousePress||keyPress||pressId!==null;drawCursor();}
function position(e){Object.assign(WallKit.input,{x:Math.max(0,Math.min(1,e.clientX/innerWidth)),y:Math.max(0,Math.min(1,e.clientY/innerHeight)),present:true});drawCursor();}
function clear(){moveId=null;pressId=null;keyPress=false;mousePress=false;Object.assign(WallKit.input,{pressed:false,present:false});drawCursor();}
function begin(){started=true;WallWake.setStarted(true);$('intro').hidden=true;stage.focus({preventScroll:true});}
$('start').addEventListener('click',begin);
stage.addEventListener('pointerdown',e=>{if(!started)begin();if(moveId!==null)return;if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();moveId=e.pointerId;stage.setPointerCapture(e.pointerId);position(e);mousePress=e.pointerType==='mouse'||e.pointerType==='pen';update();});
stage.addEventListener('pointermove',e=>{if(!started)return;if(e.pointerType==='mouse'||e.pointerId===moveId)position(e);});
function endMove(e){if(e.pointerId!==moveId)return;moveId=null;mousePress=false;update();}
stage.addEventListener('pointerup',endMove);stage.addEventListener('pointercancel',clear);stage.addEventListener('lostpointercapture',endMove);
stage.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&moveId===null){WallKit.input.present=false;drawCursor();}});
stage.addEventListener('contextmenu',e=>e.preventDefault());
touch.addEventListener('pointerdown',e=>{e.preventDefault();if(pressId!==null)return;pressId=e.pointerId;touch.setPointerCapture(e.pointerId);WallKit.input.present=true;update();});
function endPress(e){if(e.pointerId===pressId){pressId=null;update();}}
touch.addEventListener('pointerup',endPress);touch.addEventListener('pointercancel',endPress);touch.addEventListener('lostpointercapture',endPress);
window.addEventListener('keydown',e=>{if(e.code!=='Space'||!started||!$('panel').hidden)return;if(![stage,touch,document.body].includes(document.activeElement))return;e.preventDefault();keyPress=true;WallKit.input.present=true;update();});
window.addEventListener('keyup',e=>{if(e.code==='Space'){keyPress=false;update();}});
window.addEventListener('blur',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});window.addEventListener('resize',drawCursor);
function script(path){
  if(!loaded.has(path))loaded.set(path,new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=path;s.onload=resolve;s.onerror=()=>{loaded.delete(path);s.remove();reject(Error('Could not load this effect. Check your connection and try again.'));};document.head.append(s);}));
  return loaded.get(path);
}
function mapInternal(value,spec){
  if(spec.pts){const pts=spec.pts;if(value<=pts[0][0])return pts[0][1];for(let i=1;i<pts.length;i++)if(value<=pts[i][0]){const [a,b]=[pts[i-1],pts[i]];return a[1]+(value-a[0])/(b[0]-a[0])*(b[1]-a[1]);}return pts.at(-1)[1];}
  if(spec.inv!==undefined)return spec.inv/value;
  return value*(spec.mul??1);
}
function applyParameters(effect){
  const params={};for(const [key,knob] of Object.entries(effect.knobs)){const value=state[effect.id].values[key];if(knob.internal)for(const [raw,spec] of Object.entries(knob.internal))params[raw]=mapInternal(value,spec);else params[key]=value;}
  window['_'+effect.ns+'Fx']=params;
  const setter=({greatwave:'GreatWaveSet',starrynight:'StarryNightSet',threemusicians:'ThreeMusiciansSet'})[effect.ns]||effect.ns[0].toUpperCase()+effect.ns.slice(1)+'Set';
  window[setter]?.(params);WallKit.setMusic(state[effect.id].music,state[effect.id].amount/100);
}
async function select(id){
  const effect=byId[id];if(!effect)return false;const token=++loadToken;clear();WallKit.stop();current=id;
  $('load-status').textContent='Loading '+effect.name+(effect.downloadMB?' · '+effect.downloadMB+' MB scene':'')+'…';$('load-status').hidden=false;$('error').hidden=true;
  $('piece-name').textContent=effect.name;$('piece-category').textContent=groups[effect.group]||effect.group;
  $('piece-help').textContent=effect.nativeMusic?'Presence + contact input · native music response':'Presence + contact input · music modulates motion + brightness';
  renderParameters();renderLibrary();
  try{
    for(const path of effect.scripts){await script(path);if(token!==loadToken)return false;}
    applyParameters(effect);const ok=WallKit.start(id);if(ok)applyParameters(effect);return ok;
  }catch(error){if(token===loadToken){$('error').textContent=error.message;$('error').hidden=false;}return false;}
  finally{if(token===loadToken)$('load-status').hidden=true;}
}
function format(value){return Number(value.toFixed(3)).toString();}
function renderParameters(){
  const effect=byId[current],st=state[current],target=$('parameters');target.replaceChildren();$('controls-name').textContent=effect.name+' parameters';$('effect-description').textContent=effect.description;
  for(const [key,knob] of Object.entries(effect.knobs)){
    const field=document.createElement('div');field.className='parameter';const label=document.createElement('label');label.className='slider-label';label.htmlFor='param-'+key;const name=document.createElement('span');name.textContent=knob.label;label.append(name);
    const control=document.createElement(knob.choices?'select':'input');control.id='param-'+key;control.dataset.param=key;
    const output=document.createElement('output');output.htmlFor=control.id;output.textContent=format(st.values[key]);
    if(knob.choices){for(const [value,text] of knob.choices){const opt=document.createElement('option');opt.value=value;opt.textContent=text;control.append(opt);}}
    else{control.type='range';control.min=knob.min;control.max=knob.max;control.step=knob.step;label.append(output);}
    control.value=st.values[key];control.addEventListener('input',()=>{st.values[key]=cleanValue(knob,control.value);output.textContent=format(st.values[key]);applyParameters(effect);persist();});field.append(label,control);target.append(field);
  }
  if(!target.children.length)target.textContent='This effect uses its default visual settings.';
  $('music-enabled').checked=st.music;$('music-amount').value=st.amount;$('music-amount-value').value=st.amount+'%';
  $('music-mode').textContent=effect.nativeMusic?'Native response: frequency bands and beats drive this effect’s own visual parameters.':'Shared response: audio modulates rendering brightness and motion. Touch input stays independent.';
}
$('defaults').addEventListener('click',()=>{for(const [key,k] of Object.entries(byId[current].knobs))state[current].values[key]=k.def;applyParameters(byId[current]);persist();renderParameters();});
$('music-enabled').addEventListener('change',()=>{state[current].music=$('music-enabled').checked;applyParameters(byId[current]);persist();});
$('music-amount').addEventListener('input',()=>{state[current].amount=Number($('music-amount').value);$('music-amount-value').value=state[current].amount+'%';applyParameters(byId[current]);persist();});
const categories=[...new Set(effects.map(e=>e.group))];for(const g of categories){const o=document.createElement('option');o.value=g;o.textContent=groups[g]||g;$('category').append(o);}
$('effect-count').textContent=effects.length;
function renderLibrary(){
  const q=$('search').value.trim().toLowerCase(),group=$('category').value;
  const matches=effects.filter(e=>(group==='all'||e.group===group)&&(e.name+' '+e.family+' '+e.description).toLowerCase().includes(q));
  $('library-count').textContent=matches.length+' effects';const list=$('effect-list');list.replaceChildren();
  for(const e of matches){const b=document.createElement('button');b.className='effect-card';b.dataset.piece=e.id;b.setAttribute('aria-pressed',String(e.id===current));const name=document.createElement('strong');name.textContent=e.name;const meta=document.createElement('span');meta.textContent=(groups[e.group]||e.group)+(e.downloadMB?' · '+e.downloadMB+' MB':'');b.append(name,meta);b.addEventListener('click',()=>{begin();closePanel();select(e.id);});list.append(b);}
  if(!matches.length)list.textContent='No matching effects. Try another name or category.';
}
$('search').addEventListener('input',renderLibrary);$('category').addEventListener('change',renderLibrary);
function panelView(view){const library=view==='library';$('library-view').hidden=!library;$('controls-view').hidden=library;$('library-tab').setAttribute('aria-selected',String(library));$('controls-tab').setAttribute('aria-selected',String(!library));$('panel-title').textContent=library?'Effect library':'Parameters + audio';}
function openPanel(view,button){clear();opener=button;$('panel').hidden=false;$('panel-shade').hidden=false;stage.inert=true;document.querySelector('footer').inert=true;document.querySelector('header').inert=true;$('intro').inert=true;$('open-'+(view==='library'?'library':'controls')).setAttribute('aria-expanded','true');panelView(view);$('close-panel').focus();}
function closePanel(){clear();$('panel').hidden=true;$('panel-shade').hidden=true;stage.inert=false;document.querySelector('footer').inert=false;document.querySelector('header').inert=false;$('intro').inert=false;for(const id of ['open-library','open-controls'])$(id).setAttribute('aria-expanded','false');opener?.focus();}
$('open-library').addEventListener('click',e=>openPanel('library',e.currentTarget));$('open-controls').addEventListener('click',e=>openPanel('controls',e.currentTarget));$('close-panel').addEventListener('click',closePanel);$('panel-shade').addEventListener('click',closePanel);
$('library-tab').addEventListener('click',()=>panelView('library'));$('controls-tab').addEventListener('click',()=>panelView('controls'));
$('panel').addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();closePanel();}if(e.key==='Tab'){const all=[...$('panel').querySelectorAll('button,input,select,a,audio')].filter(el=>!el.disabled&&el.getClientRects().length);const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
$('reset').addEventListener('click',()=>select(current));
function advance(direction){const i=effects.findIndex(e=>e.id===current);select(effects[(i+direction+effects.length)%effects.length].id);}
$('previous').addEventListener('click',()=>advance(-1));$('next').addEventListener('click',()=>advance(1));
$('mic').addEventListener('click',()=>WallAudio.microphone());$('audio-file').addEventListener('change',e=>{WallAudio.file(e.target.files[0]);e.target.value='';});$('stop-audio').addEventListener('click',()=>WallAudio.stop());$('resume-audio').addEventListener('click',()=>WallAudio.resume());
$('sensitivity').addEventListener('input',e=>{WallAudio.setSensitivity(e.target.value);$('sensitivity-value').value=format(Number(e.target.value))+'×';});
function audioUI(){const a=WallAudio.status();$('audio-status').textContent=a.message;$('stop-audio').disabled=a.mode==='off';$('resume-audio').hidden=a.mode==='off'||a.active||a.pending;$('audio-indicator').textContent=a.active?(a.mode==='mic'?'MIC ACTIVE':'AUDIO FILE'):a.pending?'MIC PERMISSION':a.mode==='off'?'AUDIO OFF':'AUDIO PAUSED';$('audio-indicator').classList.toggle('live',a.active);for(const [i,key]of ['bass','mid','high'].entries())$(key).value=a.bands[i];}
window.addEventListener('wall-audio',audioUI);window.addEventListener('wall-frame',audioUI);
function wakeUI(){const s=WallWake.status();$('keep-awake').checked=s.enabled;$('wake-status').textContent=s.message;$('retry-wake').hidden=!s.enabled||!s.running||!s.started||!['denied','released'].includes(s.state);}
$('keep-awake').addEventListener('change',e=>WallWake.setEnabled(e.target.checked));$('retry-wake').addEventListener('click',()=>WallWake.retry());window.addEventListener('wall-wake',wakeUI);wakeUI();

// Stable public API also permits deterministic offline smoke tests without live wall services.
window.TouchWallDemo={select,current:()=>current,state,applyParameters,ready:select('fable')};renderLibrary();audioUI();
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
