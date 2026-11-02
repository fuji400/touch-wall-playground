'use strict';
const stage=document.getElementById('stage'), cursor=document.getElementById('cursor'), touch=document.getElementById('touch');
const mobile=matchMedia('(pointer:coarse)').matches;
document.body.classList.toggle('mobile',mobile);
const pieces={fable:['Willow','Presence displaces strands. Contact applies an impulse.'],liquid:['Liquid Paint','Hold contact and drag to inject colour into the fluid.'],haiku:['Starwell','Contact attracts particles. Release restores free motion.']};
let current='fable', moveId=null, pressId=null, keyPress=false, mousePress=false, started=false;
if(mobile){document.getElementById('welcome').textContent='Drag to position the simulated hand. Hold Touch with a second finger to activate contact.';document.getElementById('hint').textContent='Drag = position · hold Touch = contact';}
function drawCursor(){const i=WallKit.input;cursor.style.display=i.present?'block':'none';cursor.style.transform=`translate(${i.x*innerWidth}px,${i.y*innerHeight}px)`;cursor.classList.toggle('pressing',i.pressed);touch.setAttribute('aria-pressed',String(i.pressed));}
function update(){WallKit.input.pressed=mousePress||keyPress||pressId!==null;drawCursor();}
function position(e){Object.assign(WallKit.input,{x:Math.max(0,Math.min(1,e.clientX/innerWidth)),y:Math.max(0,Math.min(1,e.clientY/innerHeight)),present:true});drawCursor();}
function clear(){moveId=null;pressId=null;keyPress=false;mousePress=false;Object.assign(WallKit.input,{pressed:false,present:false});drawCursor();}
function begin(){started=true;document.getElementById('intro').hidden=true;stage.focus({preventScroll:true});}
document.getElementById('start').addEventListener('click',begin);
stage.addEventListener('pointerdown',e=>{if(!started)begin();if(moveId!==null)return;if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();moveId=e.pointerId;stage.setPointerCapture(e.pointerId);position(e);mousePress=e.pointerType==='mouse'||e.pointerType==='pen';update();});
stage.addEventListener('pointermove',e=>{if(!started)return;if(e.pointerType==='mouse'||e.pointerId===moveId)position(e);});
function endMove(e){if(e.pointerId!==moveId)return;moveId=null;mousePress=false;update();}
stage.addEventListener('pointerup',endMove);stage.addEventListener('pointercancel',clear);stage.addEventListener('lostpointercapture',endMove);
stage.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&moveId===null){WallKit.input.present=false;drawCursor();}});
stage.addEventListener('contextmenu',e=>e.preventDefault());
touch.addEventListener('pointerdown',e=>{e.preventDefault();if(pressId!==null)return;pressId=e.pointerId;touch.setPointerCapture(e.pointerId);WallKit.input.present=true;update();});
function endPress(e){if(e.pointerId===pressId){pressId=null;update();}}
touch.addEventListener('pointerup',endPress);touch.addEventListener('pointercancel',endPress);touch.addEventListener('lostpointercapture',endPress);
window.addEventListener('keydown',e=>{if(e.code!=='Space'||!started)return;if(![stage,touch,document.body].includes(document.activeElement))return;e.preventDefault();keyPress=true;WallKit.input.present=true;update();});
window.addEventListener('keyup',e=>{if(e.code==='Space'){keyPress=false;update();}});
window.addEventListener('blur',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
window.addEventListener('resize',drawCursor);
function select(id){clear();current=id;WallKit.start(id);document.getElementById('piece-name').textContent=pieces[id][0];document.getElementById('piece-help').textContent=pieces[id][1];document.querySelectorAll('[data-piece]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.piece===id)));}
document.querySelectorAll('[data-piece]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.piece)));
document.getElementById('reset').addEventListener('click',()=>select(current));
select(current);
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
