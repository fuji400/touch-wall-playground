/* Device-local Web Audio analysis. No uploads, recording, studio socket or microphone monitoring. */
'use strict';
var WallAudio=(()=>{
  let context=null,analyser=null,source=null,stream=null,url=null,mode='off',generation=0;
  let message='Audio off',bins=null,wave=null,bands=[0,0,0],raw=[0,0,0],pulse=0,slow=0,fast=0,armed=true,beatAt=-Infinity,packets=0,sensitivity=1;
  const player=document.getElementById('audio-player');
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const announce=()=>window.dispatchEvent(new Event('wall-audio'));
  function zero(){bands=[0,0,0];raw=[0,0,0];pulse=slow=fast=0;armed=true;}
  function status(){return {mode,message,active:!!context&&context.state==='running'&&(mode==='mic'&&!!stream?.active||mode==='file'&&!player.paused&&!player.ended),pending:mode==='mic'&&!stream,bands:[...bands],pulse,sensitivity,packets,tracks:stream?stream.getTracks().filter(t=>t.readyState==='live').length:0};}
  function stop(note='Audio off'){
    generation++;source?.disconnect();source=null;analyser=null;stream?.getTracks().forEach(t=>t.stop());stream=null;
    player.pause();player.removeAttribute('src');player.load();player.hidden=true;
    if(url)URL.revokeObjectURL(url);url=null;
    const old=context;context=null;if(old)old.close().catch(()=>{});
    mode='off';message=note;zero();announce();
  }
  function prepare(nextMode){
    stop();const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw Error('Web Audio is unavailable in this browser.');
    context=new Audio();analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.45;
    analyser.minDecibels=-85;analyser.maxDecibels=-20;
    bins=new Uint8Array(analyser.frequencyBinCount);wave=new Float32Array(analyser.fftSize);mode=nextMode;
    const thisContext=context;context.onstatechange=()=>{if(context===thisContext&&context.state!=='running'){zero();message='Audio paused — tap Resume audio.';announce();}};
    return {token:generation,ctx:context};
  }
  function errorMessage(e){
    if(e?.name==='NotAllowedError'||e?.name==='SecurityError')return 'Microphone access was blocked. Allow it in the browser or choose an audio file.';
    if(e?.name==='NotFoundError')return 'No microphone found. Choose an audio file instead.';
    if(e?.name==='NotReadableError')return 'The microphone is busy or unavailable. Try an audio file.';
    return e?.message||'Audio could not start. Try another file or browser.';
  }
  async function microphone(){
    let ticket;
    try{
      ticket=prepare('mic');message='Waiting for microphone permission…';announce();
      // Start/resume on the initiating gesture, before the permission promise resolves (Safari).
      const resumed=ticket.ctx.resume();
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone requires HTTPS and a browser with audio capture.');
      const captured=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if(ticket.token!==generation){captured.getTracks().forEach(t=>t.stop());return;}
      stream=captured;source=context.createMediaStreamSource(stream);source.connect(analyser);await resumed;
      stream.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(ticket.token===generation)stop('Microphone disconnected.');}));
      message='Microphone active · local analysis';announce();
    }catch(e){if(!ticket||ticket.token===generation)stop(errorMessage(e));}
  }
  async function file(file){
    if(!file)return;
    let ticket;
    try{
      ticket=prepare('file');url=URL.createObjectURL(file);player.src=url;player.hidden=false;
      source=context.createMediaElementSource(player);source.connect(analyser);analyser.connect(context.destination);
      const resumed=ticket.ctx.resume();await player.play();await resumed;
      if(ticket.token!==generation)return;message='Playing: '+file.name;announce();
    }catch(e){
      if(ticket&&ticket.token!==generation)return;
      if(e?.name==='NotAllowedError'&&context){message='Audio file ready — tap Resume audio to play.';announce();}
      else stop(e?.name==='NotSupportedError'?'This audio file format is unsupported. Try MP3, M4A or WAV.':errorMessage(e));
    }
  }
  async function resume(){
    if(!context)return;
    try{await context.resume();if(mode==='file')await player.play();message=mode==='mic'?'Microphone active · local analysis':'Audio file playing';announce();}catch(e){message=errorMessage(e);announce();}
  }
  function step(dt){
    if(!status().active||document.hidden){zero();return;}
    analyser.getByteFrequencyData(bins);analyser.getFloatTimeDomainData(wave);
    const rms=Math.sqrt(wave.reduce((s,x)=>s+x*x,0)/wave.length),sum=[0,0,0],count=[0,0,0];
    for(let i=1;i<bins.length;i++){
      const hz=i*context.sampleRate/analyser.fftSize;if(hz<20||hz>16000)continue;
      const b=hz<250?0:hz<2000?1:2;sum[b]+=(bins[i]/255)**2;count[b]++;
    }
    raw=sum.map((s,i)=>rms<.002?0:clamp(Math.sqrt(s/Math.max(1,count[i]))*sensitivity,0,1));
    const target=raw.map(x=>clamp(x*2.2,0,1));
    dt=clamp(dt,0,.1);packets++;
    bands=bands.map((x,i)=>x+(target[i]-x)*(1-Math.exp(-dt/(target[i]>x?.035:.22))));
    fast+=(target[0]-fast)*(1-Math.exp(-dt/.035));slow+=(target[0]-slow)*(1-Math.exp(-dt/.65));pulse*=Math.exp(-dt/.2);
    const onset=fast-slow,now=performance.now();if(onset<.035)armed=true;
    if(armed&&onset>.10&&now-beatAt>260){armed=false;pulse=1;beatAt=now;}
  }
  function read(enabled=true,amount=.6){
    const live=enabled&&status().active&&!document.hidden;
    return {enabled:live,fresh:live,connected:status().active,source:mode,amount:clamp(amount,0,1),raw:live?[...raw]:[0,0,0],bands:live?[...bands]:[0,0,0],pulse:live?pulse:0,packets,state:!live?'off':Math.max(...raw)>.02?'live':'quiet'};
  }
  player.addEventListener('pause',()=>{zero();announce();});
  player.addEventListener('play',()=>{context?.resume().catch(()=>{});announce();});
  player.addEventListener('ended',()=>{zero();message='Audio ended — replay or choose another file.';announce();});
  player.addEventListener('error',()=>{if(mode==='file')stop('This audio file could not be decoded. Try MP3, M4A or WAV.');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&context){if(mode==='mic')stop('Microphone stopped while the page was hidden.');else{player.pause();context.suspend().catch(()=>{});zero();message='Audio paused — tap Resume audio.';announce();}}});
  window.addEventListener('pagehide',()=>stop());
  return {microphone,file,resume,stop,step,read,status,setSensitivity:n=>{sensitivity=clamp(Number(n)||1,.25,4);}};
})();
// The original Resonance plugins use this marker to select their host-supplied audio path.
var WallMusic={read:()=>WallAudio.read()};
