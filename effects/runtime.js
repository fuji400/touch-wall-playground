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
  if(uKind<.5 && aGroup>0.){
   vec2 d=home-vec2(625.,283.),d2=home-vec2(865.,398.);
   vec2 axis=normalize(vec2(1.,.25*cos(home.x/180.))+normalize(vec2(-d.y,d.x)+.001)*exp(-dot(d,d)/65000.)*3.+normalize(vec2(d2.y,-d2.x)+.001)*exp(-dot(d2,d2)/20000.)*3.);
   float phase=uTime*.65+aSeed*6.283;
   vec2 offset=(axis*sin(phase)*(aGroup>1.5?2.:12.)+vec2(-axis.y,axis.x)*cos(phase)*3.)*uFlow;
   float stir=0.;
   for(int i=0;i<6;i++){
    vec2 h=home-uHands[i].xy*vec2(1280.,800.);float r=length(h);
    float k=exp(-r*r/pow(uReach*1280.,2.))*uHands[i].z*uWake;
    // Material brushstrokes roll and fan around a hand; each stroke keeps its pigment.
    offset+=(normalize(vec2(-h.y,h.x)+.001)*64.+normalize(h+.001)*sin(uTime*2.-r*.016)*20.)*k;stir+=k;
   }
   for(int i=0;i<2;i++){
    vec2 h=home-uBodies[i].xy*vec2(1280.,800.);float r=length(h);
    float k=exp(-r*r/250000.)*uBodies[i].z;
    offset+=(vec2(45.*uBodies[i].w,-14.)+normalize(vec2(-h.y,h.x)+.001)*35.)*k;stir+=k;
   }
   // Curved marks are independent rigid paint forms, not deforming an image plane.
   p=home+offset+turn(aPos-home,stir*.24*sin(uTime+aSeed*9.));
   vLight=aGroup>1.5?(sin(uTime*1.35+aSeed)*.09*uFlow+stir*uGlow):0.;
  }else if(uKind>.5){
   int g=int(aGroup+.1);vec4 m=uPose[g];p=uPivot[g]+turn((p-uPivot[g])*m.w,m.z)+m.xy;
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
  var ns=kind?'threemusicians':'starrynight',setter=kind?'ThreeMusiciansSet':'StarryNightSet';
  var settings=kind?{unfold:1,reach:.44,settle:1.5}:{flow:1,reach:.32,wake:1.25,glow:.28,body:1};
  var ranges=kind?{unfold:[.25,1.5],reach:[.2,.7],settle:[.7,3]}:{flow:[0,1.6],reach:[.15,.55],wake:[.3,2],glow:[0,.5],body:[0,1.5]};
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
      slots.forEach(function(s,i){s.x+=(s.tx-s.x)*a;s.y+=(s.ty-s.y)*a;s.e=s.active?1-(1-s.e)*Math.exp(-dt/.08):s.e*Math.exp(-dt/(kind?.18:.14));if(s.e<.003)s.e=0;hands[i*4]=s.x;hands[i*4+1]=s.y;hands[i*4+2]=s.e;energy=Math.max(energy,s.e);});
      slots=slots.filter(function(s){return s.active||s.e>0;});return fresh?points.length:0;
    }
    function bodyInput(dt,now){
      if(!body)return;var folded=body.update(dt,now);if(folded)bodyFrames++;
      bodyCount=body.fresh&&body.regOk?Math.min(2,body.people.length):0;
      for(var i=0;i<2;i++){
        var b=i<bodyCount?body.people[i]:null,p=b?kit.toScreen(b.cx*512,b.cy*424):null;
        var target=b&&p?Math.min(1,b.moving*4)*(kind?1:settings.body):0;
        var k=1-Math.exp(-dt/(target? .06:.13));
        if(p){bodyHands[i*4]+=(p[0]-bodyHands[i*4])*k;bodyHands[i*4+1]+=(p[1]-bodyHands[i*4+1])*k;}
        bodyHands[i*4+2]+=(target-bodyHands[i*4+2])*k;if(bodyHands[i*4+2]<.003)bodyHands[i*4+2]=0;
        bodyHands[i*4+3]=b&&b.cx>.5?-1:1;
      }
    }

  function articulation(dt){
   if(!kind)return;
   scene.groups.forEach((g,i)=>{
    var m=motions[i];if(i<3)return;var px=g.pivot[0]/1280,py=g.pivot[1]/800,drive=0,dx=0,dy=0;
    slots.forEach(s=>{var d=Math.hypot(s.x-px,(s.y-py)*.625),k=Math.exp(-d*d/(settings.reach*settings.reach))*s.e;drive=Math.max(drive,k);dx+=(s.x-px)*k;dy+=(s.y-py)*k;});
    for(var j=0;j<2;j++){var d=Math.hypot(bodyHands[j*4]-px,(bodyHands[j*4+1]-py)*.625),k=Math.exp(-d*d/.22)*bodyHands[j*4+2]*.8;drive=Math.max(drive,k);dx+=bodyHands[j*4+3]*k*.14;}
    var child=g.parent>0,sign=i%2?1:-1;
    var idle=Math.sin(clock*.65+i*.43)*(child?.006:.0035);
    var angle=idle+sign*drive*(child?.19:.08)*settings.unfold;
    var targetX=Math.max(-38,Math.min(38,(dx*90+sign*drive*22)*settings.unfold))*(child?.22:1);
    var targetY=(dy*28-sign*drive*12)*settings.unfold*(child?.3:1);
    var a=1-Math.exp(-dt/(drive>.04?.12:settings.settle/5.5));m.x+=(targetX-m.x)*a;m.y+=(targetY-m.y)*a;m.r+=(angle-m.r)*a;m.drive=drive;
    var parent=world[g.parent],pp=scene.groups[g.parent].pivot;
    var vx=g.pivot[0]-pp[0],vy=g.pivot[1]-pp[1],c=Math.cos(parent.r),s=Math.sin(parent.r);
    world[i]={x:parent.x+c*vx-s*vy-vx+m.x,y:parent.y+s*vx+c*vy-vy+m.y,r:parent.r+m.r,s:1};
    var w=world[i];
    // Fit authored form bounds after composing its parent's hinge, preserving motifs.
    if(g.bounds){var xs=[],ys=[],cc=Math.cos(w.r),ss=Math.sin(w.r);[g.bounds[0],g.bounds[2]].forEach(x=>[g.bounds[1],g.bounds[3]].forEach(y=>{var vx=x-g.pivot[0],vy=y-g.pivot[1];xs.push(g.pivot[0]+cc*vx-ss*vy);ys.push(g.pivot[1]+ss*vx+cc*vy)}));w.x=Math.max(10-Math.min(...xs),Math.min(1270-Math.max(...xs),w.x));w.y=Math.max(10-Math.min(...ys),Math.min(790-Math.max(...ys),w.y));}
    pose.set([w.x,w.y,w.r,w.s],i*4);
   });
  }
  function frame(dt,now){if(disposed)return;if(error)throw error;gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.055,.08,.12,1);gl.clear(gl.COLOR_BUFFER_BIT);if(!ready)return;
   dt=Math.min(.1,Math.max(0,dt));clock+=dt;activeCount=input(dt,Date.now());bodyInput(dt,now);articulation(dt);frames++;
   gl.useProgram(prog);gl.bindVertexArray(vao);gl.uniform2fv(u.Size,size);gl.uniform1f(u.Time,clock);gl.uniform1f(u.Kind,kind);gl.uniform1f(u.Flow,settings.flow||0);gl.uniform1f(u.Reach,settings.reach);gl.uniform1f(u.Wake,settings.wake||0);gl.uniform1f(u.Glow,settings.glow||0);gl.uniform4fv(u['Hands[0]'],hands);gl.uniform4fv(u['Bodies[0]'],bodyHands);gl.uniform4fv(u['Pose[0]'],pose);gl.uniform2fv(u['Pivot[0]'],pivots);gl.disable(gl.BLEND);gl.drawArrays(gl.TRIANGLES,0,vertexCount);
  }
  return {frame,resize,destroy:dispose,debug:()=>({ready,error:error&&String(error),construction:'authored-mesh',textures:0,vertices:vertexCount,brushstrokes:scene&&scene.counts.ribbons,frames,settings:{...settings},contacts:activeCount,energy,rect:Array.from(rect),source:sourceSize,living:true,resources:resources.length,body:{fresh:body.fresh,regOk:body.regOk,people:bodyCount,frames:bodyFrames,foldMs:body.foldMs,wakes:Array.from(bodyHands)},slots:slots.map(s=>({x:s.x,y:s.y,e:s.e,active:s.active})),layers:scene?scene.groups.map((g,i)=>({...g,motion:motions[i],display:world[i]})):[],idleRestored:energy===0&&bodyHands[2]===0&&bodyHands[6]===0&&motions.every(m=>m.drive<.005)})};
 }
 window.LivingPaintings={create};
})();
