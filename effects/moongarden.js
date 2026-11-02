/*
 * Moon Garden — an untamed nocturnal garden, by Codex.
 * Touch opens a flower. A sweep grows a curling stem and sends leaves spinning.
 * Each hand tends its own patch; the garden slowly releases it after you leave.
 * Ambient foliage follows an evolving, non-periodic curl field. There are no
 * standing-wave modes, nodal-line constraints or repeating plate figures.
 *
 * Input: kit.fingers (fresh every-frame contact) with kit.touch fallback for
 * mouse/test hosts; stale and empty reports release the hand forces. Bounded
 * flowers, strokes and hands keep memory/work constant during long sessions.
 * Body-field extraction and WebGL plumbing adapted from Opus 5.5's Chladni;
 * the flow, planting, stems, flowers, palette and gesture behavior are original.
 * No audio, external assets or network requests of its own.
 */
(function() {
  'use strict';
  var GRAINS_W = 64, GRAINS_H = 48, GRAIN_PX = 12;
  var EXPOSURE = 1.25, BLOOM = .32, WARMTH = 0;
  var MAX_HANDS = 8, MAX_FLOWERS = 32, MAX_STROKES = 24;
  var FRESH_MS = 400, FLOWER_LIFE = 15, STROKE_LIFE = 9;
  var PW = 128, PH = 106, BODY_DEPTH_CELLS = 20;
  var BODY_MIN_MM = 110, BODY_NEAR_MM = 700, BODY_FAR_MM = 1700, BODY_FAR_WEIGHT = .35, BODY_STALE_MS = 1500;
  var VS_TRI = `#version 300 es
out vec2 vUv;
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0,1);}`;
  var HASH = `
uint hsh(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;}
float u01(uint x){return float(hsh(x)>>8)*(1./16777216.);}
`;
  var FS_STEP = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uState, uProx;
uniform float uDt,uAspect,uTime,uBodyOn;
uniform uint uFrame;
uniform int uHandN;
uniform vec4 uHands[8],uGestures[8];
uniform mat3 uHinv;
out vec4 o;
${HASH}
float hash21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
// Value and analytic gradient of smooth lattice noise, composed at rotated scales.
vec3 noiseG(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);
  float a=hash21(i),b=hash21(i+vec2(1,0)),c=hash21(i+vec2(0,1)),d=hash21(i+vec2(1));
  return vec3(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),du.x*mix(b-a,d-c,u.y),du.y*mix(c-a,d-b,u.x));
}
float prox(vec2 q){vec3 h=uHinv*vec3(q,1);return h.z>0.?texture(uProx,h.xy/h.z).r:0.;}
void main(){
  ivec2 ij=ivec2(gl_FragCoord.xy);vec4 s=texelFetch(uState,ij,0);
  vec2 q=s.xy,v=s.zw,P=vec2(q.x*uAspect,q.y);
  vec2 drift=vec2(uTime*.021,-uTime*.014);
  vec3 n=noiseG(P*2.35+drift+vec2(8.2,17.3));
  mat2 rot=mat2(.8,.6,-.6,.8);
  vec3 m=noiseG(rot*P*5.3-drift*.6+vec2(31.7,4.6));
  vec2 grad=n.yz*2.35+transpose(rot)*m.yz*1.6;
  // Free currents: no attraction to a contour or a global standing pattern.
  vec2 target=vec2(.014,-.009)+vec2(grad.y,-grad.x)*.029;
  float guard=1.;
  for(int j=0;j<8;j++){
    if(j>=uHandN)break;
    vec2 D=P-uHands[j].xy;float d=length(D);vec2 R=D/max(d,.008);
    float influence=exp(-d*d/.026);
    float orbit=uGestures[j].z;
    target+=(vec2(-R.y,R.x)*orbit*.29+R*(.065-d)*1.8+uGestures[j].xy*.60)*influence;
    float age=uTime-uHands[j].z;
    float pulse=exp(-pow((d-age*.42)/.035,2.))*exp(-age*1.7);
    target+=R*pulse*.40;
    guard*=smoothstep(.025,.080,d);
  }
  if(uBodyOn>.5){
    const float e=.006;float Q=prox(q)*guard;
    vec2 g=vec2((prox(q+vec2(e,0))-prox(q-vec2(e,0)))/uAspect,prox(q+vec2(0,e))-prox(q-vec2(0,e)))/(2.*e);
    target=target*(1.-smoothstep(.02,.3,Q))-g/max(length(g),1.)*.8*smoothstep(0.,.08,Q)*guard;
  }
  target*=min(1.,.7/max(length(target),.001));
  v=mix(v,target,1.-exp(-uDt*10.));
  uint seed=hsh(uint(ij.x)+uint(ij.y)*4096u)^(uFrame*0x9e3779b9u);
  vec2 flutter=vec2(u01(seed),u01(seed^0x68bc21ebu))-.5;
  vec2 dP=v*uDt+flutter*.014*sqrt(uDt);
  q+=vec2(dP.x/uAspect,dP.y);
  if(any(lessThan(q,vec2(-.02)))||any(greaterThan(q,vec2(1.02)))||any(isnan(v))||any(isinf(v))||u01(seed^0x85ebca6bu)<uDt*.035){
    vec2 next=vec2(u01(seed^0x1b873593u),u01(seed^0xcc9e2d51u));
    if(uBodyOn<.5||prox(next)<.02){q=next;v=vec2(0);}
  }
  o=vec4(clamp(q,vec2(-.02),vec2(1.02)),v);
}`;
  var VS_DRAW = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
uniform sampler2D uState;
uniform float uPt,uTime;
out vec2 vRot,vScreen;out float vSeed,vSpeed;
${HASH}
void main(){
  int i=gl_VertexID;vec4 s=texelFetch(uState,ivec2(i%${GRAINS_W},i/${GRAINS_W}),0);
  gl_Position=vec4(s.x*2.-1.,1.-s.y*2.,0,1);vScreen=s.xy;
  float h=u01(uint(i)*2654435761u),angle=atan(s.w,s.z+.00001)+.35*sin(uTime*1.2+h*40.);
  vRot=vec2(cos(angle),sin(angle));vSeed=h;vSpeed=clamp(length(s.zw)*3.,0.,1.);
  gl_PointSize=max(2.,uPt*(.5+.85*h*h));
}`;
  var FS_DRAW = `#version 300 es
precision highp float;
uniform sampler2D uProx;uniform mat3 uHinv;uniform float uBodyOn,uAspect;
uniform int uHandN;uniform vec4 uHands[8];
in vec2 vRot,vScreen;in float vSeed,vSpeed;out vec4 o;
void main(){
  vec2 p=gl_PointCoord*2.-1.;p=vec2(dot(p,vRot),dot(p,vec2(-vRot.y,vRot.x)));
  float aa=max(fwidth(p.x),fwidth(p.y));
  float mask=(1.-smoothstep(-aa,aa,abs(p.y)-.36*max(0.,1.-p.x*p.x)))*(1.-smoothstep(.90,1.,abs(p.x)));
  if(mask<.002)discard;
  float vein=exp(-abs(p.y)*45.)*.5+pow(max(0.,cos(31.*p.x-21.*abs(p.y))),18.)*.2;
  vec3 leaf=mix(vec3(.012,.12,.065),vec3(.11,.50,.32),vSeed);
  leaf=mix(leaf,vec3(.55,.93,.70),vein*.65+vSpeed*.35);
  float cover=1.;
  if(uBodyOn>.5){
    vec3 h=uHinv*vec3(vScreen,1);float guard=1.;vec2 P=vec2(vScreen.x*uAspect,vScreen.y);
    for(int j=0;j<8;j++){if(j>=uHandN)break;guard*=smoothstep(.025,.080,distance(P,uHands[j].xy));}
    if(h.z>0.)cover=1.-smoothstep(.03,.20,texture(uProx,h.xy/h.z).r*guard);
  }
  o=vec4(leaf*mask*(.65+.55*vSeed)*cover,0);
}`;
  var VS_FLOWER = `#version 300 es
precision highp float;
uniform vec4 uFlowers[32],uFlowerInfo[32];
uniform float uHeight;
out vec4 vInfo;out vec2 vScreen;
void main(){
 vec4 f=uFlowers[gl_VertexID];vInfo=vec4(uFlowerInfo[gl_VertexID].xyz,f.w);vScreen=f.xy;
 gl_Position=vec4(f.x*2.-1.,1.-f.y*2.,0,1);gl_PointSize=max(1.,f.z*2.*uHeight);
}`;
  var FS_FLOWER = `#version 300 es
precision highp float;
uniform sampler2D uProx;uniform mat3 uHinv;uniform float uBodyOn;
in vec4 vInfo;in vec2 vScreen;out vec4 o;
void main(){
 vec2 p=gl_PointCoord*2.-1.;float r=length(p),a=atan(p.y,p.x)+vInfo.x*6.283;
 float n=5.+floor(vInfo.x*4.);
 float outer=.48+.34*pow(.5+.5*cos(a*n+r*.8),.72);
 float inner=.23+.24*pow(.5+.5*cos(a*(n+2.)-r*1.2+.9),.8);
 float aa=max(fwidth(r),.005);
 float petal=1.-smoothstep(outer-aa,outer+aa,r),inside=1.-smoothstep(inner-aa,inner+aa,r);
 if(petal<.001)discard;
 float veins=pow(max(0.,cos(a*n+r*9.)),14.)*.2;
 vec3 tint=mix(vec3(.28,.70,.45),vec3(.84,.30,.47),smoothstep(.5,.95,vInfo.x));
 vec3 col=mix(tint,vec3(.92,.96,.69),inside*.76+veins);
 col*=.34+.7*smoothstep(0.,outer,r);
 col+=vec3(1.,.69,.21)*exp(-r*r*130.)*1.7;
 col+=vec3(.6,.94,.71)*exp(-pow((r-outer+.025)/.018,2.))*.28;
 float cover=1.;
 if(uBodyOn>.5&&vInfo.z<.5){vec3 h=uHinv*vec3(vScreen,1);if(h.z>0.)cover=1.-smoothstep(.04,.22,texture(uProx,h.xy/h.z).r);}
 o=vec4(col*petal*vInfo.w*cover,0);
}`;
  var VS_STEM = `#version 300 es
precision highp float;
layout(location=0)in vec3 aPos;
out float vAlpha;out vec2 vScreen;
void main(){vAlpha=aPos.z;vScreen=aPos.xy;gl_Position=vec4(aPos.x*2.-1.,1.-aPos.y*2.,0,1);}`;
  var FS_STEM = `#version 300 es
precision highp float;
uniform sampler2D uProx;uniform mat3 uHinv;uniform float uBodyOn;
in float vAlpha;in vec2 vScreen;out vec4 o;
void main(){float cover=1.;if(uBodyOn>.5){vec3 h=uHinv*vec3(vScreen,1);if(h.z>0.)cover=1.-smoothstep(.04,.25,texture(uProx,h.xy/h.z).r);}
o=vec4(vec3(.045,.34,.19)*vAlpha*cover,0);}`;
  var GLSL_PAL=`uniform float uExposure,uWarm;
vec3 leafColor(vec4 a){return vec3(1.)-exp(-max(a.rgb,vec3(0.))*uExposure);}`;
  var FS_DOWN=`#version 300 es
precision highp float;uniform sampler2D uSrc;uniform vec2 uTexel;in vec2 vUv;out vec4 o;
${GLSL_PAL}
void main(){vec4 a=texture(uSrc,vUv+uTexel)+texture(uSrc,vUv-uTexel)+texture(uSrc,vUv+vec2(uTexel.x,-uTexel.y))+texture(uSrc,vUv+vec2(-uTexel.x,uTexel.y));o=vec4(leafColor(a*.25),1);}`;
  var FS_BLUR=`#version 300 es
precision highp float;uniform sampler2D uSrc;uniform vec2 uDir;in vec2 vUv;out vec4 o;
void main(){vec3 c=texture(uSrc,vUv).rgb*.227027;
c+=(texture(uSrc,vUv+uDir*1.384615).rgb+texture(uSrc,vUv-uDir*1.384615).rgb)*.316216;
c+=(texture(uSrc,vUv+uDir*3.230769).rgb+texture(uSrc,vUv-uDir*3.230769).rgb)*.07027;o=vec4(c,1);}`;
  var FS_COMP=`#version 300 es
precision highp float;uniform sampler2D uAccum,uGlow;uniform float uGlowAmt;in vec2 vUv;out vec4 o;
${GLSL_PAL}
void main(){vec3 c=leafColor(texture(uAccum,vUv))+texture(uGlow,vUv).rgb*uGlowAmt;
o=vec4(c+vec3(.001,.003,.004)*(1.-length(vUv-.5)),1);}`;
  function rnd(a,b){return a+Math.random()*(b-a);}
  registerWallPlugin({
    id:'moongarden',title:'Moon Garden',author:'Codex',
    create:function(canvas,kit){
      var gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'high-performance'});
      if(!gl)throw Error('Moon Garden needs WebGL2');
      if(!gl.getExtension('EXT_color_buffer_float'))throw Error('Moon Garden needs float framebuffers');
      // ------------------------------------------------------------ GL plumbing
      var made = {tex: [], fb: [], prog: []};
      function shader(type, src) {
        var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var m = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + m); }
        return s;
      }
      function program(vs, fs) {
        var p = gl.createProgram(), a = shader(gl.VERTEX_SHADER, vs), b = shader(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
        gl.deleteShader(a); gl.deleteShader(b);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
        made.prog.push(p);
        var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
        return {p: p, u: u};
      }
      function texture(w, h, ifmt, fmt, type, filter, data) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        made.tex.push(t);
        return t;
      }
      function target(tex) {
        var f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
        made.fb.push(f);
        return f;
      }
      function forget(list, kind, x) { var i = list.indexOf(x); if (i >= 0) list.splice(i, 1); if (kind === 't') gl.deleteTexture(x); else gl.deleteFramebuffer(x); }

      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      var pStep = program(VS_TRI, FS_STEP), pDraw = program(VS_DRAW, FS_DRAW), pDown = program(VS_TRI, FS_DOWN),
          pBlur = program(VS_TRI, FS_BLUR), pComp = program(VS_TRI, FS_COMP), pFlower = program(VS_FLOWER, FS_FLOWER), pStem = program(VS_STEM, FS_STEM);

      // GPU leaves: normalized position and velocity in wall heights per second
      var N = GRAINS_W * GRAINS_H, init = new Float32Array(N * 4);
      for (var i = 0; i < N; i++) { init[i * 4] = Math.random(); init[i * 4 + 1] = Math.random(); }
      var stTex = [texture(GRAINS_W, GRAINS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init),
                   texture(GRAINS_W, GRAINS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init)];
      init = null;
      var stFb = [target(stTex[0]), target(stTex[1])], cur = 0;

      // the body field (Kinect space), refilled from each depth frame
      var proxTex = texture(PW, PH, gl.R16F, gl.RED, gl.FLOAT, gl.LINEAR, new Float32Array(PW * PH));
      var proxRaw = new Float32Array(PW * PH), proxTmp = new Float32Array(PW * PH), proxSm = new Float32Array(PW * PH);
      var proxW = new Float32Array(PW * PH);
      var proxLive = false, lastSeq = -1, lastSeqAt = 0, proxPeak = 0, bodyMs = 0;

      // screen-sized buffers
      var W = 0, H = 0, aspect = 1.6, accTex = null, accFb = null, glow = [null, null], glowFb = [null, null], GW = 0, GH = 0;
      function sizeBuffers(w, h) {
        w = Math.max(1, w | 0); h = Math.max(1, h | 0);
        if (w === W && h === H) return;
        if (accTex) { forget(made.fb, 'f', accFb); forget(made.tex, 't', accTex); for (var j = 0; j < 2; j++) { forget(made.fb, 'f', glowFb[j]); forget(made.tex, 't', glow[j]); } }
        W = w; H = h; aspect = W / H;
        GW = Math.max(1, Math.round(W / 4)); GH = Math.max(1, Math.round(H / 4));
        accTex = texture(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); accFb = target(accTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);   // filtered leaf light for the glow
        gl.generateMipmap(gl.TEXTURE_2D);
        for (var j2 = 0; j2 < 2; j2++) { glow[j2] = texture(GW, GH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); glowFb[j2] = target(glow[j2]); }
      }
      sizeBuffers(canvas.width, canvas.height);

      // Each contact grows a small place in the garden. Nothing solves a global figure.
      var tNow=0, hands=[], flowers=[], strokes=[], fallback=[], born=0, nextHand=0;
      var lastInput=-100, nextIdle=3;
      var handData=new Float32Array(MAX_HANDS*4), gestureData=new Float32Array(MAX_HANDS*4);
      var flowerData=new Float32Array(MAX_FLOWERS*4), flowerInfo=new Float32Array(MAX_FLOWERS*4);
      var stemBuffer=gl.createBuffer(), stemData=new Float32Array(120000), stemN=0;
      function plant(x,y,idle){
        var f={x:x,y:y,t0:tNow,end:tNow+(idle?12:FLOWER_LIFE),r:rnd(idle?.027:.052,idle?.045:.077),seed:Math.random(),held:false};
        if(flowers.length>=MAX_FLOWERS){
          var drop=flowers.findIndex(function(b){return !hands.some(function(h){return h.flower===b;});});
          flowers.splice(Math.max(0,drop),1);
        }
        flowers.push(f);born++;return f;
      }
      function valid(p){return Array.isArray(p)&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1;}
      function onTouch(t){
        if(!t||!valid([t.x,t.y]))return;
        var now=Date.now(),f=kit.fingers;
        // The every-frame report owns contact/release whenever it exists.
        if(f&&now-f.t<FRESH_MS)return;
        fallback=fallback.filter(function(h){return now-h.t<650;});
        var found=null,d=.13;
        fallback.forEach(function(h){var q=Math.hypot(h.x-t.x,h.y-t.y);if(q<d){d=q;found=h;}});
        if(found){found.x=t.x;found.y=t.y;found.t=now;}
        else{if(fallback.length>=MAX_HANDS)fallback.shift();fallback.push({x:t.x,y:t.y,t:now});}
      }
      function updateHands(dt){
        var now=Date.now(),f=kit.fingers,points=[];
        if(f){
          if(now-f.t<FRESH_MS&&Array.isArray(f.pts))points=f.pts.filter(valid).slice(0,MAX_HANDS);
          fallback=[]; // a real empty/stale stream must never resurrect a thinned touch
        }else points=fallback.filter(function(h){return now-h.t<650;}).map(function(h){return[h.x,h.y];});
        var edges=[],usedH={},usedP={},next=[];
        for(var i=0;i<hands.length;i++)for(var j=0;j<points.length;j++){
          var d=Math.hypot((hands[i].x-points[j][0])*aspect,hands[i].y-points[j][1]);
          if(d<.22)edges.push({h:i,p:j,d:d});
        }
        edges.sort(function(a,b){return a.d-b.d;});
        var matches={};edges.forEach(function(e){if(!usedH[e.h]&&!usedP[e.p]){usedH[e.h]=usedP[e.p]=true;matches[e.p]=hands[e.h];}});
        flowers.forEach(function(b){b.held=false;});
        points.forEach(function(p,j){
          var h=matches[j];
          if(!h){
            var stroke={pts:[],last:tNow};
            if(strokes.length>=MAX_STROKES){var drop=strokes.findIndex(function(s){return !hands.some(function(h){return h.stroke===s;});});strokes.splice(Math.max(0,drop),1);}
            strokes.push(stroke);
            h={id:nextHand++,x:p[0],y:p[1],vx:0,vy:0,start:tNow,sign:nextHand%2?1:-1,stroke:stroke,flower:plant(p[0],p[1],false),planted:tNow};
          }
          // Follow reports immediately; smooth only velocity so a drag never flings the garden across the wall.
          var vx=(p[0]-h.x)*aspect/Math.max(dt,.008),vy=(p[1]-h.y)/Math.max(dt,.008),speed=Math.hypot(vx,vy),scale=Math.min(1,.75/Math.max(speed,.001));
          h.vx+=(vx*scale-h.vx)*(1-Math.exp(-dt*14));h.vy+=(vy*scale-h.vy)*(1-Math.exp(-dt*14));h.x=p[0];h.y=p[1];
          var last=h.stroke.pts[h.stroke.pts.length-1];
          if(!last||Math.hypot((p[0]-last.x)*aspect,p[1]-last.y)>.006){
            h.stroke.pts.push({x:p[0],y:p[1],t:tNow});if(h.stroke.pts.length>128)h.stroke.pts.shift();
          }
          h.stroke.last=tNow;
          if(Math.hypot((h.x-h.flower.x)*aspect,h.y-h.flower.y)>.12&&tNow-h.planted>.25){h.flower=plant(h.x,h.y,false);h.planted=tNow;}
          h.flower.end=tNow+FLOWER_LIFE;h.flower.held=true;
          next.push(h);
        });
        hands=next;if(hands.length)lastInput=tNow;
        flowers=flowers.filter(function(b){return b.end>tNow;});
        strokes=strokes.filter(function(s){return tNow-s.last<STROKE_LIFE;});
        if(!hands.length&&tNow-lastInput>7&&tNow>nextIdle){plant(rnd(.08,.92),rnd(.1,.9),true);nextIdle=tNow+rnd(3,5);}
        handData.fill(0);gestureData.fill(0);
        hands.forEach(function(h,i){handData.set([h.x*aspect,h.y,h.start,1],i*4);gestureData.set([h.vx,h.vy,h.sign,0],i*4);});
      }
      function segment(a,b,alpha,width){
        if(alpha<.002||stemN+18>stemData.length)return;
        var dx=(b.x-a.x)*aspect,dy=b.y-a.y,l=Math.hypot(dx,dy);if(l<.00001)return;
        var nx=-dy/l*width/aspect,ny=dx/l*width;
        stemData.set([a.x+nx,a.y+ny,alpha,a.x-nx,a.y-ny,alpha,b.x+nx,b.y+ny,alpha,b.x+nx,b.y+ny,alpha,a.x-nx,a.y-ny,alpha,b.x-nx,b.y-ny,alpha],stemN);stemN+=18;
      }
      function growStems(){
        stemN=0;
        strokes.forEach(function(s){for(var j=1;j<s.pts.length;j++){var p=s.pts[j],life=Math.max(0,1-(tNow-p.t)/STROKE_LIFE);segment(s.pts[j-1],p,life*.6,.0011);}});
        flowers.forEach(function(f,i){
          var age=tNow-f.t0,alpha=Math.min(1,(f.end-tNow)/4),grow=Math.min(1,age/3.5);
          var radius=f.r*(1-Math.exp(-age*3.5))*(1+.035*Math.sin(tNow*1.9+f.seed*30));
          flowerData.set([f.x,f.y,radius,Math.max(0,alpha)],i*4);flowerInfo.set([f.seed,age,f.held?1:0,0],i*4);
          for(var arm=0;arm<3;arm++){
            var angle=f.seed*6.283+arm*2.1,prev={x:f.x,y:f.y};
            for(var k=1;k<=24;k++){
              var u=k/24*grow,r=.012+u*f.r*2.5,turn=angle+u*2.5+Math.sin(u*5+f.seed*12)*.35;
              var p={x:f.x+Math.cos(turn)*r/aspect,y:f.y+Math.sin(turn)*r};
              segment(prev,p,alpha*(1-u)*.55,.0008);prev=p;
            }
          }
        });
      }
      for(var seedFlower=0;seedFlower<5;seedFlower++){var f=plant(rnd(.12,.88),rnd(.12,.88),true);f.t0=-rnd(.4,3);}
      // ------------------------------------------------------------ depth -> body field
      var Hinv = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), regOk = false, regCheckAt = 0;
      function updateRegistration() {
        // screen (0..1) -> Kinect (0..1) as a 3x3, rebuilt from four corners of kit.fromScreen (Heckbert's square-to-quad)
        var c0 = kit.fromScreen(0, 0), c1 = kit.fromScreen(1, 0), c2 = kit.fromScreen(1, 1), c3 = kit.fromScreen(0, 1);
        if (!c0 || !c1 || !c2 || !c3 || !c0.concat(c1, c2, c3).every(Number.isFinite)) { Hinv.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); regOk = false; return; }
        var x0 = c0[0] / 512, y0 = c0[1] / 424, x1 = c1[0] / 512, y1 = c1[1] / 424, x2 = c2[0] / 512, y2 = c2[1] / 424, x3 = c3[0] / 512, y3 = c3[1] / 424;
        var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
        var g = 0, h = 0, den = dx1 * dy2 - dx2 * dy1;
        if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { if (Math.abs(den) < 1e-12) return; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
        var a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
        Hinv.set([a, d, g, b, e, h, c, f, 1]);       // column-major
        regOk = true;
      }
      function blurPass(src, dst, horiz, r) {        // box blur, radius r cells
        var w = PW, hgt = PH, x, y, k, acc, n = 2 * r + 1;
        if (horiz) {
          for (y = 0; y < hgt; y++) {
            var row = y * w; acc = 0;
            for (k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
            for (x = 0; x < w; x++) { dst[row + x] = acc / n; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
          }
        } else {
          for (x = 0; x < w; x++) {
            acc = 0;
            for (k = -r; k <= r; k++) acc += src[Math.min(hgt - 1, Math.max(0, k)) * w + x];
            for (y = 0; y < hgt; y++) { dst[y * w + x] = acc / n; acc += src[Math.min(hgt - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x]; }
          }
        }
      }
      function updateBody(nowMs, dt) {
        var dep = kit.depth();
        if (dep && dep.wall && nowMs - dep.time < 250 && dep.seq !== lastSeq) {
          var tb = performance.now();
          lastSeq = dep.seq; lastSeqAt = nowMs;
          var data = dep.data, wall = dep.wall, span = BODY_FAR_MM - BODY_NEAR_MM;
          for (var cy = 0; cy < PH; cy++) for (var cx = 0; cx < PW; cx++) {
            var sum = 0, cnt = 0;
            for (var yy = 0; yy < 4; yy++) {
              var base = (cy * 4 + yy) * 512 + cx * 4;
              for (var xx = 0; xx < 4; xx++) {
                var z = data[base + xx], wz = wall[base + xx];
                if (z > 0 && wz === wz) {
                  var dd = wz - z;
                  if (dd > BODY_MIN_MM) {
                    var wgt = Math.min(1, (dd - BODY_MIN_MM) / 80);
                    if (dd > BODY_NEAR_MM) wgt *= 1 - (1 - BODY_FAR_WEIGHT) * Math.min(1, (dd - BODY_NEAR_MM) / span);
                    sum += wgt; cnt++;
                  }
                }
              }
            }
            var ci = cy * PW + cx;
            proxW[ci] = cnt >= 6 ? sum / cnt : 0;       // a cell has to be mostly body (6 of 16 pixels): lone noisy pixels never count
            proxRaw[ci] = cnt >= 6 ? 1e6 : 0;
          }
          // how deep inside the silhouette each cell is (chamfer distance to the nearest non-body cell; off the image = outside)
          var x, y, i, dd2;
          for (y = 0; y < PH; y++) for (x = 0; x < PW; x++) {
            i = y * PW + x; if (!proxRaw[i]) continue;
            dd2 = Math.min(proxRaw[i], (x > 0 ? proxRaw[i - 1] : 0) + 1, (y > 0 ? proxRaw[i - PW] : 0) + 1,
                           (x > 0 && y > 0 ? proxRaw[i - PW - 1] : 0) + 1.414, (x < PW - 1 && y > 0 ? proxRaw[i - PW + 1] : 0) + 1.414);
            proxRaw[i] = dd2;
          }
          for (y = PH - 1; y >= 0; y--) for (x = PW - 1; x >= 0; x--) {
            i = y * PW + x; if (!proxRaw[i]) continue;
            dd2 = Math.min(proxRaw[i], (x < PW - 1 ? proxRaw[i + 1] : 0) + 1, (y < PH - 1 ? proxRaw[i + PW] : 0) + 1,
                           (x < PW - 1 && y < PH - 1 ? proxRaw[i + PW + 1] : 0) + 1.414, (x > 0 && y < PH - 1 ? proxRaw[i + PW - 1] : 0) + 1.414);
            proxRaw[i] = dd2;
          }
          for (i = 0; i < PW * PH; i++) proxRaw[i] = Math.min(1, proxRaw[i] / BODY_DEPTH_CELLS) * proxW[i];
          blurPass(proxRaw, proxTmp, true, 1); blurPass(proxTmp, proxRaw, false, 1);
          blurPass(proxRaw, proxTmp, true, 1); blurPass(proxTmp, proxRaw, false, 1);
          var peak = 0;
          for (var i2 = 0; i2 < PW * PH; i2++) {
            var cxx = i2 % PW, cyy = (i2 / PW) | 0;
            var val = (cxx === 0 || cyy === 0 || cxx === PW - 1 || cyy === PH - 1) ? 0 : proxRaw[i2];
            proxSm[i2] += (val - proxSm[i2]) * 0.6;
            if (proxSm[i2] > peak) peak = proxSm[i2];
          }
          proxPeak = peak; proxLive = peak > 0.01;
          gl.bindTexture(gl.TEXTURE_2D, proxTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RED, gl.FLOAT, proxSm);
          bodyMs = performance.now() - tb;
        } else if (proxLive && nowMs - lastSeqAt > BODY_STALE_MS) {   // the depth stream went quiet: let go of the last body
          var pk = 0;
          for (var i3 = 0; i3 < PW * PH; i3++) { proxSm[i3] *= Math.exp(-5 * dt); if (proxSm[i3] > pk) pk = proxSm[i3]; }
          proxPeak = pk; proxLive = pk > 0.01;
          gl.bindTexture(gl.TEXTURE_2D, proxTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RED, gl.FLOAT, proxSm);
        }
      }

      kit.wantDepth(true);
      var frameNo=0,dead=false;
      function bodyUniforms(p){
        gl.uniform1f(p.u.uBodyOn,proxLive&&regOk?1:0);gl.uniformMatrix3fv(p.u.uHinv,false,Hinv);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,proxTex);gl.uniform1i(p.u.uProx,1);
      }
      function draw(dt,nowMs){
        if(dead)return;dt=Math.min(.05,Math.max(0,dt));tNow+=dt;frameNo++;
        if(nowMs-regCheckAt>2000||(!regOk&&nowMs-regCheckAt>250)){regCheckAt=nowMs;updateRegistration();}
        updateBody(nowMs,dt);updateHands(dt);growStems();
        gl.bindVertexArray(vao);gl.disable(gl.BLEND);
        gl.useProgram(pStep.p);var u=pStep.u;
        gl.uniform1f(u.uDt,dt);gl.uniform1f(u.uAspect,aspect);gl.uniform1f(u.uTime,tNow);gl.uniform1ui(u.uFrame,frameNo>>>0);
        gl.uniform1i(u.uHandN,hands.length);gl.uniform4fv(u.uHands,handData);gl.uniform4fv(u.uGestures,gestureData);bodyUniforms(pStep);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,stTex[cur]);gl.uniform1i(u.uState,0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,stFb[1-cur]);gl.viewport(0,0,GRAINS_W,GRAINS_H);gl.drawArrays(gl.TRIANGLES,0,3);cur=1-cur;

        gl.bindFramebuffer(gl.FRAMEBUFFER,accFb);gl.viewport(0,0,W,H);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
        gl.useProgram(pStem.p);bodyUniforms(pStem);
        gl.bindBuffer(gl.ARRAY_BUFFER,stemBuffer);gl.bufferData(gl.ARRAY_BUFFER,stemData.subarray(0,stemN),gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.drawArrays(gl.TRIANGLES,0,stemN/3);gl.disableVertexAttribArray(0);
        gl.bindBuffer(gl.ARRAY_BUFFER,null);

        gl.useProgram(pDraw.p);bodyUniforms(pDraw);gl.uniform1f(pDraw.u.uAspect,aspect);gl.uniform1i(pDraw.u.uHandN,hands.length);gl.uniform4fv(pDraw.u.uHands,handData);
        gl.uniform1f(pDraw.u.uPt,GRAIN_PX*W/1280);gl.uniform1f(pDraw.u.uTime,tNow);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,stTex[cur]);gl.uniform1i(pDraw.u.uState,0);gl.drawArrays(gl.POINTS,0,N);
        gl.useProgram(pFlower.p);bodyUniforms(pFlower);gl.uniform1f(pFlower.u.uHeight,H);
        gl.uniform4fv(pFlower.u.uFlowers,flowerData);gl.uniform4fv(pFlower.u.uFlowerInfo,flowerInfo);gl.drawArrays(gl.POINTS,0,flowers.length);
        gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,accTex);gl.generateMipmap(gl.TEXTURE_2D);

        gl.useProgram(pDown.p);gl.uniform1f(pDown.u.uExposure,EXPOSURE);gl.uniform2f(pDown.u.uTexel,1/W,1/H);gl.uniform1i(pDown.u.uSrc,0);
        gl.bindFramebuffer(gl.FRAMEBUFFER,glowFb[0]);gl.viewport(0,0,GW,GH);gl.drawArrays(gl.TRIANGLES,0,3);
        gl.useProgram(pBlur.p);gl.uniform1i(pBlur.u.uSrc,0);
        for(var pass=0;pass<2;pass++){
          gl.uniform2f(pBlur.u.uDir,(1+pass)/GW,0);gl.bindTexture(gl.TEXTURE_2D,glow[0]);gl.bindFramebuffer(gl.FRAMEBUFFER,glowFb[1]);gl.drawArrays(gl.TRIANGLES,0,3);
          gl.uniform2f(pBlur.u.uDir,0,(1+pass)/GH);gl.bindTexture(gl.TEXTURE_2D,glow[1]);gl.bindFramebuffer(gl.FRAMEBUFFER,glowFb[0]);gl.drawArrays(gl.TRIANGLES,0,3);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,W,H);gl.useProgram(pComp.p);
        gl.uniform1f(pComp.u.uExposure,EXPOSURE);gl.uniform1f(pComp.u.uGlowAmt,BLOOM);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,accTex);gl.uniform1i(pComp.u.uAccum,0);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,glow[0]);gl.uniform1i(pComp.u.uGlow,1);gl.drawArrays(gl.TRIANGLES,0,3);gl.activeTexture(gl.TEXTURE0);
      }
      if(window.WallTest)window.__moonGardenDebug=function(){return{
        version:2,time:tNow,hands:hands.map(function(h){return{id:h.id,x:h.x,y:h.y,vx:h.vx,vy:h.vy};}),
        flowers:flowers.map(function(f){return{x:f.x,y:f.y,held:f.held,age:tNow-f.t0};}),born:born,strokes:strokes.length,stemVertices:stemN/3,
        body:proxLive,bodyPeak:proxPeak,bodyMs:bodyMs,registered:regOk,glError:gl.getError(),
        limits:{hands:MAX_HANDS,flowers:MAX_FLOWERS,strokes:MAX_STROKES},resources:{textures:made.tex.length,framebuffers:made.fb.length,programs:made.prog.length}};};
    function set(opts) {
      if (!opts || dead) return {exposure: EXPOSURE, bloom: BLOOM};
      if (Number.isFinite(opts.exposure)) EXPOSURE = Math.max(0.5, Math.min(2.5, opts.exposure));
      if (Number.isFinite(opts.bloom)) BLOOM = Math.max(0.05, Math.min(0.8, opts.bloom));
      return {exposure: EXPOSURE, bloom: BLOOM};
    }
    function wake(sx, sy, radius, strength) {
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
      try {
        if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
        else if (typeof onTouch === 'function') onTouch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
      } catch (e) {}
    }
    window.MoongardenSet = set;
    window.MoongardenWake = wake;
    if (window._moongardenFx) set(window._moongardenFx);

      return {
        frame:draw,touch:onTouch,resize:sizeBuffers,
        destroy:function(){
          if(dead)return;dead=true;if(window.MoongardenSet===set)delete window.MoongardenSet;
          if(window.MoongardenWake===wake)delete window.MoongardenWake;
          kit.wantDepth(false);
          gl.bindFramebuffer(gl.FRAMEBUFFER,null);made.fb.forEach(function(f){gl.deleteFramebuffer(f);});made.tex.forEach(function(t){gl.deleteTexture(t);});made.prog.forEach(function(p){gl.deleteProgram(p);});
          gl.deleteBuffer(stemBuffer);gl.deleteVertexArray(vao);hands=[];flowers=[];strokes=[];fallback=[];proxRaw=proxTmp=proxSm=proxW=null;
          if(window.__moonGardenDebug)delete window.__moonGardenDebug;
        }
      };
    }
  });
})();
