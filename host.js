/* Standalone plugin host: no sensor, network, calibration, or live rig routes. */
'use strict';
var WallPlugins = {};
function registerWallPlugin(plugin) { WallPlugins[plugin.id] = plugin; }
var WallKit = (() => {
  let active = null, frames = 0, nextId = 0;
  const input = {x:.5,y:.42,present:false,pressed:false};
  const wall = new Float32Array(512*424).fill(2225);
  const depth = {data:null,wall,w:512,h:424,seq:0,time:0};
  let depthWanted = false, lastDepth = 0, contact = null;
  function stop() {
    const a = active; active = null; contact = null; depthWanted = false;
    if (!a) return;
    cancelAnimationFrame(a.raf);
    try { a.inst?.destroy?.(); } finally {
      const gl = a.gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      a.canvas.remove();
    }
  }
  function fail(error) {
    console.error(error); stop();
    const box = document.getElementById('error');
    box.hidden = false;
    box.textContent = 'This effect could not run on this device. Try another effect or reload in a browser with WebGL enabled.';
  }
  function resize(a) {
    const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(1200000 / (innerWidth * innerHeight)));
    const w = Math.round(innerWidth*ratio), h = Math.round(innerHeight*ratio);
    if (a.canvas.width === w && a.canvas.height === h) return;
    a.canvas.width=w; a.canvas.height=h; a.inst?.resize?.(w,h);
  }
  function feed(now) {
    const pressed = input.pressed && input.present;
    const wallTime = Date.now();
    active.kit.fingers = {pts:pressed ? [[input.x,input.y]] : [], t:wallTime};
    if (pressed) {
      const first = !contact;
      if (first) contact = {id:++nextId,t0:wallTime};
      Object.assign(contact,{x:input.x,y:input.y,t:wallTime});
      active.kit.touches = [{...contact}];
      if (first || now-(contact.reportAt||0)>90) {
        active.inst.touch?.({...contact,first}); contact.reportAt=now;
      }
    } else { contact=null; active.kit.touches=[]; }
    if (depthWanted && now-lastDepth>=50) {
      const u=input.x*512, v=input.y*424;
      let bx=u+(u<256 ? 100 : -100); bx=Math.max(50,Math.min(462,bx));
      depth.data=SynthDepth.frame({wallMM:2225,noise:0,people:input.present ? [{bx,bodyMM:650,hands:[{u,v,mm:pressed?25:140}]}] : []});
      depth.seq++; depth.time=now; lastDepth=now;
    }
  }
  function loop(now) {
    const a=active; if (!a) return;
    try {
      resize(a);
      if (!document.hidden) { feed(now); a.inst.frame?.(Math.min(.05,(now-a.last)/1000),now); frames++; }
      a.last=now; a.raf=requestAnimationFrame(loop);
    } catch(error) { fail(error); }
  }
  function start(id) {
    stop(); document.getElementById('error').hidden=true;
    input.pressed=false; input.present=false; depth.data=null; lastDepth=0;
    const canvas=document.createElement('canvas');
    const a={id,canvas,inst:null,gl:null,raf:0,last:performance.now()};
    const getContext=canvas.getContext.bind(canvas);
    canvas.getContext=(kind,...args)=>{const ctx=getContext(kind,...args); if (kind.includes('webgl')) a.gl=ctx; return ctx;};
    a.kit={touches:[],fingers:{pts:[],t:Date.now()},wantDepth:on=>{depthWanted=!!on;},depth:()=>depth.data?depth:null,
      toScreen:(u,v)=>[u/512,v/424],fromScreen:(x,y)=>[x*512,y*424],size:()=>[canvas.width,canvas.height],
      room:()=>({enabled:false,fresh:false,present:false,motion:0}),music:()=>({enabled:false,fresh:false,amount:0}),log:()=>{}};
    active=a; document.getElementById('stage').append(canvas); resize(a);
    try { a.inst=WallPlugins[id].create(canvas,a.kit); a.raf=requestAnimationFrame(loop); return true; }
    catch(error) { fail(error); return false; }
  }
  return {start,stop,input,activeId:()=>active?.id,instance:()=>active?.inst,
    inspect:()=>({id:active?.id,frames,depthFrames:depth.seq,input:{...input},fingers:active?.kit.fingers?.pts||[],canvasCount:document.querySelectorAll('canvas').length})};
})();
