/* Entirely authored mesh paintings. Static pigment/geometry buffers; vertex motion only.
 * No art images, samplers, UV warps, per-frame pixel work or new sensor tracking.
 * Existing finger interpolation and WallBody from the prior integration are reused.
 */
(function(){'use strict';
 var MAX=6,FRESH=150;
 var VS=`#version 300 es
 precision highp float;
 in vec2 aPos,aHome;in vec3 aColor;in float aGroup,aSeed;
 uniform vec2 uSize;uniform float uTime,uKind,uFlow,uReach,uWake,uGlow;
 uniform vec4 uHands[6],uBodies[2],uPose[24];uniform vec2 uPivot[24];
 out vec3 vColor;out vec2 vGrain;out float vLight;
 vec2 turn(vec2 p,float a){return mat2(cos(a),sin(a),-sin(a),cos(a))*p;}
 void main(){
  vec2 p=aPos,home=aHome;vLight=0.;
  if(aGroup>0.){
   float cycle=sin(uTime*.8);float curl=cos(uTime*.8);
   float crown=exp(-dot((p-vec2(465.,230.))/vec2(360.,290.),(p-vec2(465.,230.))/vec2(360.,290.)));
   vec2 offset=vec2(18.*curl*crown,-30.*cycle*crown)*uFlow;
   offset+=vec2(3.*sin(uTime*.8+p.y*.006),9.*sin(uTime*.8-p.x*.004))*uFlow*(1.-crown*.6);
   float raise=0.;vec2 stir=vec2(0.);
   for(int i=0;i<6;i++){
    vec2 h=p-uHands[i].xy*vec2(1280.,800.);float k=exp(-dot(h,h)/pow(uReach*1280.,2.))*uHands[i].z*uWake;
    offset+=vec2(24.*sin(uTime*1.1-length(h)*.012),-65.)*k;
    stir+=normalize(vec2(-h.y,h.x)+.001)*18.*k;raise+=k;
   }
   for(int i=0;i<2;i++){
    vec2 h=p-uBodies[i].xy*vec2(1280.,800.);float k=exp(-dot(h,h)/260000.)*uBodies[i].z;
    offset+=vec2(uBodies[i].w*76.,-36.*cos(h.x*.006-uTime))*k;
   }
   float fuji=exp(-dot(p-vec2(775.,555.),p-vec2(775.,555.))/50000.);
   offset*=1.-fuji;stir*=1.-fuji;offset=clamp(offset,vec2(-110.,-100.),vec2(110.,70.));
   offset.y*=smoothstep(10.,200.,p.y)*(1.-smoothstep(650.,850.,p.y));stir.y*=smoothstep(10.,200.,p.y)*(1.-smoothstep(650.,850.,p.y));
   if(aGroup<3.5){p+=offset+stir;
    if(aGroup>2.5){p+=vec2(7.*sin(uTime*.8+aPos.x*.017),-13.*sin(uTime*.8+aPos.y*.019))*uFlow;}
   }else{p+=vec2(offset.x*.035,clamp(offset.y*.07,-8.,8.));}
  }
  // Contain moving sky strokes; anchored foreground is drawn over them.
  p=clamp(p,vec2(-20.),vec2(1300.,820.));
  vec2 scale=vec2(min(uSize.x/1280.,uSize.y/800.));
  vec2 px=(uSize-vec2(1280.,800.)*scale)*.5+p*scale;
  gl_Position=vec4(px.x/uSize.x*2.-1.,1.-px.y/uSize.y*2.,0.,1.);
  vColor=aColor;vGrain=aPos;
 }`;
 var FS=`#version 300 es
 precision highp float;in vec3 vColor;in vec2 vGrain;in float vLight;out vec4 o;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 void main(){float tooth=hash(floor(vGrain*1.7))-.5;
 float bristle=sin(vGrain.x*2.4+sin(vGrain.y*.35)*2.)*.012;
 o=vec4(vColor*(1.+tooth*.11+bristle+vLight),1.);}`;
 function create(canvas,kit,kind){
  var gl=canvas.getContext('webgl2',{alpha:false,antialias:true,depth:false});if(!gl)throw Error('Authored paintings need WebGL2');
  var resources=[],disposed=false,error=null,ready=false,frames=0,slots=[],lastReport=0,clock=0,energy=0,activeCount=0;
  var ns='greatwave',setter='GreatWaveSet';
  var settings={flow:1,reach:.32,wake:1.2,body:1,settle:1.5};
  var ranges={flow:[.25,1.6],reach:[.15,.55],wake:[.3,2],body:[0,1.5],settle:[.7,3]};
  function set(v){if(!v)return;Object.keys(settings).forEach(k=>{var n=Number(v[k]);if(Number.isFinite(n))settings[k]=Math.max(ranges[k][0],Math.min(ranges[k][1],n));});}
  set(window['_'+ns+'Fx']);
  var body=WallBody.create(kit,{staleMs:FRESH}),bodyHands=new Float32Array(8),bodyFrames=0,bodyCount=0;kit.wantDepth(true);window[setter]=set;
  var rect=new Float32Array([0,0,1280,800]),size=new Float32Array([canvas.width,canvas.height]),hands=new Float32Array(24),sourceSize=[1280,800];
  var scene=null,motions=[],world=[],pose=new Float32Array(96),pivots=new Float32Array(48),vertexCount=0;
  for(var i=0;i<24;i++)pose[i*4+3]=1;
  function own(type,obj){resources.push([type,obj]);return obj;}
  function dispose(){if(disposed)return;disposed=true;if(window[setter]===set)delete window[setter];kit.wantDepth(false);resources.forEach(r=>gl['delete'+r[0]](r[1]));resources.length=0;slots.length=0;}
  function shader(type,src){var s=own('Shader',gl.createShader(type));gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  var prog,vao,u={};try{
   prog=own('Program',gl.createProgram());gl.attachShader(prog,shader(gl.VERTEX_SHADER,VS));gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,FS));gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(prog));
   vao=own('VertexArray',gl.createVertexArray());
   ['Size','Time','Kind','Flow','Reach','Wake','Glow','Hands[0]','Bodies[0]','Pose[0]','Pivot[0]'].forEach(k=>u[k]=gl.getUniformLocation(prog,'u'+k));
  }catch(e){dispose();throw e;}
  var root='assets/paintings/'+ns+'-scene';
  Promise.all([fetch(root+'.json').then(r=>{if(!r.ok)throw Error('Scene manifest missing');return r.json()}),fetch(root+'.bin').then(r=>{if(!r.ok)throw Error('Scene mesh missing');return r.arrayBuffer()})]).then(([meta,data])=>{
   if(disposed)return;if(data.byteLength!==meta.vertices*36||meta.stride!==9)throw Error('Invalid authored mesh');
   scene=meta;vertexCount=meta.vertices;var vertices=new Float32Array(data);
   gl.bindVertexArray(vao);var b=own('Buffer',gl.createBuffer());gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);
   [['aPos',2,0],['aColor',3,2],['aHome',2,5],['aGroup',1,7],['aSeed',1,8]].forEach(([name,n,off])=>{var l=gl.getAttribLocation(prog,name);if(l>=0){gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,n,gl.FLOAT,false,36,off*4)}});
   meta.groups.forEach((g,i)=>{pivots[i*2]=g.pivot[0];pivots[i*2+1]=g.pivot[1];motions.push({x:0,y:0,r:0,s:1,drive:0});world.push({x:0,y:0,r:0,s:1});});ready=true;resize();
  }).catch(e=>{if(!disposed)error=e});
  function resize(){size[0]=canvas.width;size[1]=canvas.height;var scale=Math.min(size[0]/1280,size[1]/800);rect[2]=1280*scale;rect[3]=800*scale;rect[0]=(size[0]-rect[2])/2;rect[1]=(size[1]-rect[3])/2;}
  function artPoint(p){if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1]))return null;var x=(p[0]*size[0]-rect[0])/rect[2],y=(p[1]*size[1]-rect[1])/rect[3];return x>=0&&x<=1&&y>=0&&y<=1?[x,y]:null;}
    // Match reported coordinates only to render interpolation slots. No depth tracking.
    function input(dt,now){
      var f=kit.fingers,fresh=!!(f&&Number.isFinite(f.t)&&now>=f.t&&now-f.t<=FRESH&&Array.isArray(f.pts));
      var points=fresh?f.pts.map(artPoint).filter(Boolean).slice(0,MAX):[];
      slots.forEach(function(s){s.active=false;});
      if(fresh&&f.t!==lastReport){lastReport=f.t;var pairs=[],usedS=[],usedP=[];
        slots.forEach(function(s,i){points.forEach(function(p,j){var d=Math.hypot(p[0]-s.tx,(p[1]-s.ty)/sourceSize[0]*sourceSize[1]);if(d<.24)pairs.push([d,i,j]);});});
        pairs.sort(function(a,b){return a[0]-b[0];});
        pairs.forEach(function(v){if(usedS[v[1]]||usedP[v[2]])return;var s=slots[v[1]],p=points[v[2]];s.tx=p[0];s.ty=p[1];s.seen=f.t;s.active=true;usedS[v[1]]=usedP[v[2]]=true;});
        points.forEach(function(p,j){if(!usedP[j]&&slots.length<MAX)slots.push({x:p[0],y:p[1],tx:p[0],ty:p[1],seen:f.t,active:true,e:0});});
      }else if(fresh){slots.forEach(function(s){s.active=s.seen===f.t&&points.length>0;});}
      var a=1-Math.exp(-dt/.06);hands.fill(0);energy=0;
      slots.forEach(function(s,i){s.x+=(s.tx-s.x)*a;s.y+=(s.ty-s.y)*a;s.e=s.active?1-(1-s.e)*Math.exp(-dt/.08):s.e*Math.exp(-dt/(settings.settle/6));if(s.e<.003)s.e=0;hands[i*4]=s.x;hands[i*4+1]=s.y;hands[i*4+2]=s.e;energy=Math.max(energy,s.e);});
      slots=slots.filter(function(s){return s.active||s.e>0;});return fresh?points.length:0;
    }
    function bodyInput(dt,now){
      if(!body)return;var folded=body.update(dt,now);if(folded)bodyFrames++;
      bodyCount=body.fresh&&body.regOk?Math.min(2,body.people.length):0;
      for(var i=0;i<2;i++){
        var b=i<bodyCount?body.people[i]:null,p=b?kit.toScreen(b.cx*512,b.cy*424):null;
        var target=b&&p?Math.min(1,b.moving*4)*settings.body:0;
        var k=1-Math.exp(-dt/(target? .06:.13));
        if(p){var prev=bodyHands[i*4];bodyHands[i*4]+=(p[0]-bodyHands[i*4])*k;bodyHands[i*4+1]+=(p[1]-bodyHands[i*4+1])*k;}
        bodyHands[i*4+2]+=(target-bodyHands[i*4+2])*k;if(bodyHands[i*4+2]<.003)bodyHands[i*4+2]=0;
        if(p&&Math.abs(p[0]-prev)>.001)bodyHands[i*4+3]=p[0]>prev?1:-1;
      }
    }

  function frame(dt,now){if(disposed)return;if(error)throw error;gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.055,.08,.12,1);gl.clear(gl.COLOR_BUFFER_BIT);if(!ready)return;
   dt=Math.min(.1,Math.max(0,dt));clock+=dt;activeCount=input(dt,Date.now());bodyInput(dt,now);frames++;
   gl.useProgram(prog);gl.bindVertexArray(vao);gl.uniform2fv(u.Size,size);gl.uniform1f(u.Time,clock);gl.uniform1f(u.Kind,kind);gl.uniform1f(u.Flow,settings.flow||0);gl.uniform1f(u.Reach,settings.reach);gl.uniform1f(u.Wake,settings.wake||0);gl.uniform1f(u.Glow,settings.glow||0);gl.uniform4fv(u['Hands[0]'],hands);gl.uniform4fv(u['Bodies[0]'],bodyHands);gl.uniform4fv(u['Pose[0]'],pose);gl.uniform2fv(u['Pivot[0]'],pivots);gl.disable(gl.BLEND);gl.drawArrays(gl.TRIANGLES,0,vertexCount);
  }
  return {frame,resize,destroy:dispose,debug:()=>({ready,error:error&&String(error),construction:'authored-mesh',textures:0,vertices:vertexCount,brushstrokes:scene&&scene.counts.ribbons,frames,settings:{...settings},contacts:activeCount,energy,rect:Array.from(rect),source:sourceSize,living:true,resources:resources.length,body:{fresh:body.fresh,regOk:body.regOk,people:bodyCount,frames:bodyFrames,foldMs:body.foldMs,wakes:Array.from(bodyHands)},slots:slots.map(s=>({x:s.x,y:s.y,e:s.e,active:s.active})),layers:scene?scene.groups.map((g,i)=>({...g,motion:motions[i],display:world[i]})):[],idleRestored:energy===0&&bodyHands[2]===0&&bodyHands[6]===0&&motions.every(m=>m.drive<.005)})};
 }
 window.GreatWavePainting={create};
})();
