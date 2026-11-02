/* Sandfall — sand pours down the wall and piles on you (2026-10-05; concept #2 of the fx-research report, built by Claude (fx-batch)).
 * Fine sand pours in thin streams from the top of the wall and sifts down everywhere. It settles into layered dunes along the
 * floor, a new colour of sand every LAYER_S seconds, so the dunes keep a record of the session. Stand in it and the sand
 * lands on your head, shoulders and outstretched arms and piles up there (on your outline: nothing is projected inside you).
 * The sand near you catches a warm light that goes where you go. Tilt and the pile slides off; step away and it collapses
 * onto the dunes, still glowing for a moment, and the grains that were on you stay a little paler in the dunes. Swing an arm
 * or walk into a dune and you throw a bright spray. Touch the wall and sand pours from your fingertip. When the dunes fill
 * FILL_DRAIN of the wall, the floor opens and they sink away like the top of an hourglass, and the pour starts again.
 *
 * How: a falling-sand cellular automaton on the GPU (Margolus 2 x 2 blocks, one grain per GRAIN_PX cell) for sand at rest and
 * sliding, plus a pool of free grains with real velocity for everything in the air (streams, drops, sprays); a free grain
 * lands back into the grid (one grain per cell per step, chosen by a depth test; the others land on top a step later, so
 * no grain is ever lost). One pool slot per grid cell, so the grid and the pool agree without any readback. Bodies come
 * from plugins/body.js (WallBody): a person is solid sand-wise (with hold-on / let-go hysteresis on the mask), and noise
 * blobs smaller than a person are ignored. WebGL 2, no assets, no audio, one depth client (via the host).
 * Tuning knobs: the named constants just below.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  var GRAIN_PX = 2;              // one grain of sand, in pixels on a 1280-wide picture (the sand grid is 640 x 400 at 16:10)
  var SIM_HZ = 240;              // sand steps per second (fixed, so the sand runs the same at any frame rate)
  var MAX_STEPS = 8;             // at most this many steps in one animation frame (a very slow frame runs the sand slower instead)
  var GRAVITY = 700;             // how fast falling sand speeds up (grains per second, per second)
  var MAX_FALL = 340;            // the fastest a grain falls (grains per second: ~1.5 s from the top of the wall to the floor)
  var STREAMS = 5;               // thin streams pouring from the top of the wall
  var STREAM_RATE = 110;         // grains per second in one stream at full flow (each one swells and thins slowly on its own)
  var RAIN_RATE = 100;           // a fine sifting of sand over the whole width (grains per second, all of it)
  var PERSON_RATE = 120;         // extra sand sifting down onto each person (grains per second), so everyone catches some at once
  var FINGER_RATE = 260;         // a fingertip on the wall opens a spout right there (grains per second)
  var FINGER_LINGER_S = 3;       // that spout keeps pouring this long after the finger leaves, drying up
  var FINGER_BURST_S = 0.15;     // ...and gushes 4x for this long when the finger first lands (an instant answer to a touch)
  var SLIDE = 0.75;              // how readily grains slide down a slope (1 = always; lower = rougher, steeper piles)
  var STEEP_DEG = 47;            // a body slope steeper than this (degrees from flat) cannot hold sand: it slides off
  var THROW_MIN = 0.22;          // how suddenly a body must arrive to throw the sand it hits (0..1; lower = more spray)
  var THROW_SPEED = 380;         // how hard that sand is thrown (grains per second)
  var THROW_UP = 90;             // thrown sand also goes up this much (grains per second)
  var BODY_LIGHT = 1.3;          // the warm light a person casts on the sand right at their outline
  var LIGHT_REACH = 4.5;         // how far that light reaches (depth cells; one is about 10 px on the wall)
  var SIDE_LIGHT = 0.4;          // ...beside or under a person it is this much of the light on top (shoulders and arms shine most)
  var HEAT_S = 1.4;              // sand that was on someone (or thrown) keeps glowing this long after it leaves them
  var HEAT_GLOW = 1.0;           // how bright that glow is
  var IDLE = 0.17;               // brightness of the resting dunes and the falling sand when nobody is near...
  var IDLE_AIR = 0.30;           // ...(a falling grain)...
  var IDLE_CAP = 0.135;          // ...and the most the empty wall ever shines anywhere (0..1): the brightest light belongs to people
  var LAYER_S = 25;              // seconds of pouring per colour layer in the dunes
  var FILL_DRAIN = 0.30;         // when this share of the wall is sand, the floor opens and the dunes drain away...
  var FILL_RESTART = 0.06;       // ...until only this share is left; then it fills again
  var DRAIN_ROWS_S = 10;         // how fast the dunes sink while draining (rows of grains per second)
  var DRAIN_POUR = 0.35;         // the streams pour at this share while the dunes drain
  var MASK_ON = 0.6, MASK_OFF = 0.4;  // a sand cell becomes body (solid) above ON and lets go below OFF (steadies a flickery edge)
  var DARK_INSIDE = 1.0;         // no light inside a person (1 = none, 0 = off)
  var BLOOM = 0.55;              // the soft glow around bright sand
  var STREAK = 0.022;            // falling grains smear along their path for this long (s): streams read as threads, not dots

  var BAND_ROWS = 16;            // (plumbing) pool slots in the top rows that new grains are poured into
  var HEAT_SDF = 2.5, TOUCH_SDF = 1.2;  // (plumbing) depth cells from an outline within which sand warms up / is marked as touched
  var ESCAPE = 60;               // (plumbing) a grain a body moves onto is put just outside it, leaving at about this speed (grains/s)
  var SLIDE_OFF_SPEED = 70;      // (plumbing) how fast a grain starts sliding off a steep part of a body (grains per second)
  var CREEP = 0.6;               // (plumbing) how readily sand next to a steep part of a body steps sideways downhill (0..1)

  registerWallPlugin({id: 'sandfall', title: 'Sandfall', author: 'Claude (fx-batch), fx-research concept #2', create: create});

  // ---------------------------------------------------------------- shaders
  var VS_TRI = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var HEAD = '#version 300 es\nprecision highp float; precision highp int; precision highp sampler2D;\n';
  // grid cell = (x, y) with y UP (row 0 is the floor). Body texture = WallBody's 128 x 106 cells: r mask, g outline distance
  // (cells, + outside, - inside), b how suddenly a body arrived here (0..1).
  var COMMON =
    'uniform vec2 uG; uniform mat3 uHinv; uniform sampler2D uBody;\n' +
    'uint hsh(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;}\n' +
    'float u01(uint x){return float(hsh(x)>>8)*(1.0/16777216.0);}\n' +
    'vec4 bodyAt(vec2 g){vec3 h=uHinv*vec3(g.x/uG.x,1.0-g.y/uG.y,1.0);\n' +
    '  if(h.z<=0.0)return vec4(0.,40.,0.,0.); vec2 k=h.xy/h.z;\n' +
    '  if(k.x<0.0||k.y<0.0||k.x>1.0||k.y>1.0)return vec4(0.,40.,0.,0.); return texture(uBody,k);}\n' +
    'vec2 outward(vec2 g){float e=5.0;vec2 n=vec2(bodyAt(g+vec2(e,0.)).g-bodyAt(g-vec2(e,0.)).g,bodyAt(g+vec2(0.,e)).g-bodyAt(g-vec2(0.,e)).g);\n' +
    '  float l=length(n);return l>1e-4?n/l:vec2(0.,1.);}\n' +
    'bool inG(ivec2 q){return q.x>=0&&q.y>=0&&q.x<int(uG.x)&&q.y<int(uG.y);}\n' +
    // grain encoding (grid: r sand, g tint, b tone byte (bit 7 = touched someone), a heat)
    'bool touchedOf(float b){return b*255.0>=127.5;}\n' +
    'float toneOf(float b){float v=b*255.0;return (v>=127.5?v-128.0:v)/127.0;}\n' +
    'float setTouched(float b){return b*255.0>=127.5?b:b+128.0/255.0;}\n' +
    'vec3 pal(float t){t=fract(t)*6.0;int i=int(floor(t));float f=smoothstep(0.0,1.0,fract(t));\n' +
    '  vec3 c[6]=vec3[6](vec3(1.0,0.74,0.36),vec3(1.0,0.56,0.40),vec3(1.0,0.84,0.56),vec3(0.90,0.50,0.22),vec3(1.0,0.66,0.46),vec3(0.96,0.70,0.32));\n' +
    '  return mix(c[i],c[(i+1)%6],f);}\n' +
    'vec3 albedo(float tint,float tb){vec3 a=pal(tint)*(0.78+0.42*toneOf(tb));return touchedOf(tb)?mix(a,vec3(1.0,0.92,0.74),0.5)*1.12:a;}\n';

  // 1. prep: a grain leaves the grid for its pool slot when the slot is free and: a body arrived suddenly where it is (thrown),
  //    a body now covers it (pushed out), it rests on a body slope too steep to hold sand (slides off), or it has a real drop
  //    under it (3 free cells). r: 1 sand, 0.6 thrown, 0.5 pushed out, 0.4 dropped, 0.33 sliding off, 0 empty.
  var FS_PREP = HEAD + COMMON +
    'uniform sampler2D uGrid,uPB,uSolid; uniform float uThrowMin,uSteep;\nout vec4 o;\n' +
    'bool freeC(ivec2 q){return inG(q)&&texelFetch(uGrid,q,0).r<0.25&&texelFetch(uSolid,q,0).r<0.5;}\n' +
    'bool solidC(ivec2 q){return inG(q)&&texelFetch(uSolid,q,0).r>0.5;}\n' +
    'void main(){ivec2 c=ivec2(gl_FragCoord.xy);vec4 g=texelFetch(uGrid,c,0);o=g;\n' +
    '  if(g.r>0.75&&texelFetch(uPB,c,0).a<0.25){bool eng=solidC(c);vec4 b=bodyAt(vec2(c)+0.5);\n' +
    '    if(b.b>uThrowMin&&(eng||b.g<1.5))o.r=0.6;\n' +
    '    else if(eng)o.r=0.5;\n' +
    '    else if(b.g<2.0&&!freeC(c+ivec2(0,-1))){vec2 n=outward(vec2(c)+0.5);int sx=n.x>=0.0?1:-1;\n' +
    '      if(n.y<uSteep&&freeC(c+ivec2(sx,-1))&&(n.y>0.2||freeC(c+ivec2(sx,-2))))o.r=0.33;}\n' +
    '    else if(freeC(c+ivec2(0,-1))&&freeC(c+ivec2(0,-2))&&freeC(c+ivec2(0,-3)))o.r=0.4;}\n' +
    '}\n';

  // 2. the pool: free grains fly (gravity, terminal speed), land back on sand / bodies / the floor, are born from the grid
  //    (thrown, dropped) or poured in from the spouts. A: x, y, vx, vy (grid cells, per s). B: tint, tone byte, heat, state
  //    (0 free, 0.5 flying, 1 landed this step).
  var FS_PART = HEAD + COMMON +
    'uniform sampler2D uPA,uPB,uPrep,uSolid,uState,uDep;\n' +
    'uniform float uDt,uGrav,uVmax,uThrowMin,uThrowSpeed,uThrowUp,uEscape,uSlideV,uDropV,uHeatS,uRateSum,uBand,uTint,uDrainPour;\n' +
    'uniform vec4 uSp[16]; uniform float uSpHeat[16]; uniform int uSpN; uniform uint uStep;\n' +
    'layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;\n' +
    'bool solidAt(ivec2 q){return inG(q)&&texelFetch(uSolid,q,0).r>0.5;}\n' +
    'bool blockedAt(vec2 p,bool drain){ivec2 q=ivec2(floor(p));if(q.y<0)return !drain;if(!inG(q))return false;\n' +
    '  return texelFetch(uPrep,q,0).r>0.75||texelFetch(uSolid,q,0).r>0.5;}\n' +
    'bool freeAt(ivec2 q){return inG(q)&&texelFetch(uPrep,q,0).r<0.75&&texelFetch(uSolid,q,0).r<0.5;}\n' +
    'void main(){ivec2 s=ivec2(gl_FragCoord.xy);vec4 A=texelFetch(uPA,s,0),B=texelFetch(uPB,s,0);\n' +
    '  bool drain=texelFetch(uState,ivec2(0),0).r>0.5;\n' +
    '  uint seed=hsh(uint(s.x)+uint(s.y)*4099u)^(uStep*0x9E3779B9u);\n' +
    '  if(B.a>0.75){vec4 D=texelFetch(uDep,ivec2(floor(A.xy)),0);\n' +   // landed last step: done if its grain won the cell, else back in the air to land on top
    '    if(abs(D.r-float(s.y*int(uG.x)+s.x+1))<0.5){oA=vec4(0.);oB=vec4(0.);return;}\n' +
    '    oA=vec4(A.xy,0.,0.);oB=vec4(B.rgb,0.5);return;}\n' +
    '  if(B.a>0.25){vec2 p=A.xy,v=A.zw;float heat=max(0.0,B.b-uDt/uHeatS);\n' +
    '    if(solidAt(ivec2(floor(p)))){vec4 bd=bodyAt(p);vec2 n=outward(p);\n' +   // caught inside a body: stepped straight out along the outline normal
    '      if(!drain&&p.y<6.0&&n.y<0.2){n=normalize(vec2(abs(n.x)>0.05?sign(n.x):(u01(seed^17u)<0.5?-1.0:1.0),0.2));}\n' +   // never out through the floor
    '      float k=clamp((bd.b-uThrowMin)/(1.0-uThrowMin),0.0,1.0);vec2 q=p;\n' +
    '      for(int i=1;i<=24;i++){q=p+n*float(i);if(!solidAt(ivec2(floor(q))))break;}\n' +
    '      p=q+n*u01(seed^19u)*5.0+vec2(-n.y,n.x)*(u01(seed^20u)-0.5)*4.0;if(!drain)p.y=max(p.y,0.5);\n' +   // scattered, so a row of grains never leaves as one clump
    '      v=n*(uEscape+uThrowSpeed*k)*(0.5+u01(seed^21u))+(vec2(u01(seed^15u),u01(seed^16u))-0.5)*30.0;if(k>0.0)heat=1.0;\n' +
    '    }else if(texelFetch(uPrep,ivec2(floor(p)),0).r>0.75&&inG(ivec2(floor(p)))){\n' +   // pushed into sand: it comes up on top of that sand (the dune bulges)
    '      ivec2 q=ivec2(floor(p))+ivec2(int(floor(u01(seed^18u)*5.0))-2,0);q.x=clamp(q.x,0,int(uG.x)-1);bool ok=false;\n' +
    '      for(int k=0;k<64;k++){if(freeAt(q)&&freeAt(q+ivec2(0,1))){ok=true;break;}q.y+=1;if(q.y>=int(uG.y)-1)break;}\n' +
    '      if(ok){oA=vec4(vec2(q)+0.5,0.,0.);oB=vec4(B.r,B.g,heat,1.0);return;}\n' +
    '      p.y+=1.0;v=vec2(0.);\n' +
    '    }else{v.y-=uGrav*uDt;float sp=length(v);if(sp>uVmax)v*=uVmax/sp;\n' +
    '      vec2 p1=p+v*uDt*0.5,p2=p+v*uDt;bool b1=blockedAt(p1,drain),b2=!b1&&blockedAt(p2,drain);\n' +
    '      if(b1||b2){ivec2 q=ivec2(floor(b1?p:p1));bool ok=false;\n' +
    '        for(int k=0;k<4;k++){if(freeAt(q)&&freeAt(q+ivec2(0,1))){ok=true;break;}q.y+=1;}\n' +
    '        if(ok){oA=vec4(vec2(q)+0.5,0.,0.);oB=vec4(B.r,B.g,heat,1.0);return;}\n' +
    '        p.y+=1.0;p.x+=u01(seed^13u)-0.5;v=vec2(0.);\n' +
    '      }else p=p2;}\n' +
    '    if(p.x<0.5){p.x=0.5;v.x=abs(v.x)*0.2;}else if(p.x>uG.x-0.5){p.x=uG.x-0.5;v.x=-abs(v.x)*0.2;}\n' +   // the sides of the wall are glass: sand thrown at them slides down
    '    if(p.y>uG.y+200.0||p.y<-2.0){oA=vec4(0.);oB=vec4(0.);return;}\n' +
    '    oA=vec4(p,v);oB=vec4(B.r,B.g,heat,0.5);return;}\n' +
    '  vec4 P=texelFetch(uPrep,s,0);\n' +
    '  if(P.r>0.25&&P.r<0.75){vec2 p=vec2(s)+0.5,v;\n' +
    '    if(P.r<0.37){vec2 n=outward(p);vec2 t=vec2(n.y,-n.x)*(n.x>=0.0?1.0:-1.0);v=t*uSlideV*(0.7+0.6*u01(seed^12u))+n*6.0;oB=vec4(P.g,P.b,P.a,0.5);}\n' +
    '    else if(P.r>0.45&&P.r<0.55){vec2 n=outward(p);v=n*uEscape*(0.7+0.6*u01(seed^12u))+vec2(0.,8.);oB=vec4(P.g,P.b,P.a,0.5);}\n' +
    '    else if(P.r>0.5){vec4 bd=bodyAt(p);vec2 n=outward(p);float k=clamp((bd.b-uThrowMin)/(1.0-uThrowMin),0.0,1.0);\n' +
    '      v=n*uThrowSpeed*(0.35+0.65*k)*(0.6+0.8*u01(seed^1u))+vec2((u01(seed^2u)-0.5)*90.0,uThrowUp*(0.4+u01(seed^3u)));\n' +
    '      oB=vec4(P.g,setTouched(P.b),1.0,0.5);\n' +
    '    }else{v=vec2((u01(seed^4u)-0.5)*8.0,-uDropV);oB=vec4(P.g,P.b,P.a,0.5);}\n' +
    '    oA=vec4(p,v);return;}\n' +
    '  if(float(s.y)>=uG.y-uBand&&uRateSum>0.0){\n' +
    '    float pr=uRateSum*uDt/(uBand*uG.x)*(drain?uDrainPour:1.0);\n' +
    '    if(u01(seed^5u)<pr){float u=u01(seed^6u)*uRateSum,acc=0.0,sh=0.0;vec4 sp=uSp[0];\n' +
    '      for(int i=0;i<16;i++){if(i>=uSpN)break;sp=uSp[i];sh=uSpHeat[i];acc+=sp.w;if(u<acc)break;}\n' +
    '      float j=sp.z<0.0?(u01(seed^7u)*2.0-1.0)*-sp.z:(u01(seed^7u)+u01(seed^8u)-1.0)*sp.z;\n' +
    '      oA=vec4(sp.x+j,sp.y,(u01(seed^9u)-0.5)*6.0,-20.0);\n' +
    '      oB=vec4(fract(uTint+(u01(seed^10u)-0.5)*0.012),(floor(u01(seed^11u)*127.99)+(sh>0.0?128.0:0.0))/255.0,sh,0.5);return;}}\n' +
    '  oA=vec4(0.);oB=vec4(0.);}\n';

  // 3. landings: the grains that landed this step, one per cell (the lowest slot number wins; the others land on top next step).
  //    r = winning slot + 1, g tint, b tone byte, a heat
  var VS_DEP = HEAD +
    'uniform sampler2D uPA,uPB; uniform vec2 uG; out vec4 vC;\n' +
    'void main(){int i=gl_VertexID;ivec2 s=ivec2(i%int(uG.x),i/int(uG.x));vec4 B=texelFetch(uPB,s,0);gl_PointSize=1.0;\n' +
    '  if(B.a<0.75){gl_Position=vec4(2.,2.,2.,1.);vC=vec4(0.);return;}\n' +
    '  vec4 A=texelFetch(uPA,s,0);gl_Position=vec4(A.x/uG.x*2.0-1.0,A.y/uG.y*2.0-1.0,(float(i)+0.5)/(uG.x*uG.y)*2.0-1.0,1.);\n' +
    '  vC=vec4(float(i+1),B.r,B.g,B.b);}\n';
  var FS_DEP = HEAD + 'in vec4 vC; out vec4 o; void main(){o=vC;}\n';

  // 4. the sand grid, one Margolus step: landings join, grains caught in a body get out, grains fall and slide; the floor drains
  var FS_MARG = HEAD + COMMON +
    'uniform sampler2D uPrep,uDep,uSolid,uState; uniform ivec2 uPar; uniform uint uStep;\n' +
    'uniform float uSlide,uDrainP,uHeatDec,uHeatSdf,uTouchSdf,uSteep,uCreep;\nout vec4 o;\n' +
    'vec4 cell(ivec2 q,out bool oc,out bool so,out bool mk){\n' +
    '  mk=false;if(!inG(q)){oc=false;so=true;return vec4(0.);}\n' +
    '  so=texelFetch(uSolid,q,0).r>0.5;vec4 P=texelFetch(uPrep,q,0);mk=P.r>0.37&&P.r<0.45;\n' +
    '  if(P.r>0.75){oc=true;return P;}\n' +
    '  vec4 D=texelFetch(uDep,q,0);if(D.r>0.5){oc=true;return vec4(1.0,D.gba);}\n' +
    '  oc=false;return vec4(0.);}\n' +
    'void main(){ivec2 c=ivec2(gl_FragCoord.xy);ivec2 b0=((c+uPar)/2)*2-uPar;ivec2 bi=c-b0;\n' +
    '  uint seed=hsh(uint(b0.x+2)+uint(b0.y+2)*8191u)^(uStep*0x2545F491u);bool mir=(hsh(seed^77u)&1u)==1u;\n' +
    '  vec4 d[4];bool oc[4];bool so[4];bool ex[4];bool mk[4];\n' +   // logical block: 0 bottom-left, 1 bottom-right, 2 top-left, 3 top-right (left/right mirrored at random); ex = off the wall
    '  for(int k=0;k<4;k++){int lx=k&1,ly=k>>1;int rx=mir?1-lx:lx;bool a,b,m;ivec2 q=b0+ivec2(rx,ly);d[k]=cell(q,a,b,m);oc[k]=a;so[k]=b;mk[k]=m;ex[k]=!inG(q);}\n' +
    '  for(int k=0;k<4;k++){if(!(oc[k]&&so[k]))continue;\n' +      // caught inside a body: step outward (along the outline normal), else up, else sideways
    '    int lx=k&1,ly=k>>1;int rx=mir?1-lx:lx;vec2 n=outward(vec2(b0+ivec2(rx,ly))+0.5);\n' +
    '    ivec2 cand[3];cand[0]=ivec2(abs(n.x)>0.38?int(sign(n.x)):0,abs(n.y)>0.38?int(sign(n.y)):0);cand[1]=ivec2(0,1);cand[2]=ivec2(n.x>=0.0?1:-1,0);\n' +
    '    for(int j=0;j<3;j++){ivec2 t=ivec2(rx,ly)+cand[j];if(cand[j]==ivec2(0)||t.x<0||t.y<0||t.x>1||t.y>1)continue;\n' +
    '      int kk=t.y*2+(mir?1-t.x:t.x);if(oc[kk]||ex[kk])continue;d[kk]=d[k];oc[kk]=true;oc[k]=false;break;}}\n' +
    '  if(oc[2]&&!so[2]&&!oc[0]&&!so[0]&&!mk[0]){d[0]=d[2];oc[0]=true;oc[2]=false;}\n' +   // fall (not into a cell a grain just left by air: then it follows by air too)
    '  if(oc[3]&&!so[3]&&!oc[1]&&!so[1]&&!mk[1]){d[1]=d[3];oc[1]=true;oc[3]=false;}\n' +
    '  if(oc[2]&&!so[2]&&(oc[0]||so[0])&&!oc[1]&&!so[1]&&!oc[3]&&!so[3]&&u01(seed^3u)<clamp(uSlide*(0.5+toneOf(d[2].b)),0.05,1.0)){d[1]=d[2];oc[1]=true;oc[2]=false;}\n' +
    '  else if(oc[3]&&!so[3]&&(oc[1]||so[1])&&!oc[0]&&!so[0]&&!oc[2]&&!so[2]&&u01(seed^4u)<clamp(uSlide*(0.5+toneOf(d[3].b)),0.05,1.0)){d[0]=d[3];oc[0]=true;oc[3]=false;}\n' +
    '  for(int k=2;k<4;k++){if(!oc[k]||so[k])continue;int lx=k&1;int rx=mir?1-lx:lx;int sk=k^1;\n' +   // near a steep part of a body the sand cannot hold: it creeps sideways downhill, then falls
    '    if(oc[sk]||so[sk]||ex[sk]||!(oc[k-2]||so[k-2]))continue;vec2 gp=vec2(b0+ivec2(rx,1))+0.5;vec4 bk=bodyAt(gp);if(bk.g>2.0)continue;\n' +
    '    vec2 n=outward(gp);int dir=(mir?1-(sk&1):(sk&1))-rx;if(n.y<uSteep&&float(dir)*n.x>0.0&&u01(seed^uint(31+k))<uCreep){d[sk]=d[k];oc[sk]=true;oc[k]=false;}}\n' +
    '  int me=bi.y*2+(mir?1-bi.x:bi.x);\n' +
    '  if(!oc[me]){o=vec4(0.);return;}\n' +
    '  vec4 r=d[me];uint s2=hsh(seed^uint(me*7+11));\n' +
    '  float heat=r.a-uHeatDec+(u01(s2)-0.5)/255.0;vec4 bd=bodyAt(vec2(c)+0.5);\n' +
    '  if(bd.g<uHeatSdf)heat=max(heat,1.0-max(bd.g,0.0)/uHeatSdf);\n' +
    '  if(bd.g<uTouchSdf)r.b=setTouched(r.b);\n' +
    '  r.a=clamp(heat,0.,1.);r.r=1.0;\n' +
    '  if(c.y==0&&texelFetch(uState,ivec2(0),0).r>0.5&&u01(s2^99u)<uDrainP)r=vec4(0.);\n' +
    '  o=r;}\n';

  // a sand cell is body while the mask stays over MASK_OFF once it went over MASK_ON (a flickery edge does not shake the sand)
  var FS_SOLID = HEAD + COMMON +
    'uniform sampler2D uPrev; uniform float uOn,uOff; out vec4 o;\n' +
    'void main(){ivec2 c=ivec2(gl_FragCoord.xy);float m=bodyAt(vec2(c)+0.5).r,p=texelFetch(uPrev,c,0).r;\n' +
    '  o=vec4(m>uOn?1.0:(m<uOff?0.0:p),0.,0.,1.);}\n';

  // the hourglass: how full the wall is (a 64 x 40 sample of the grid), and whether the floor is open
  var FS_STATE = HEAD +
    'uniform sampler2D uGrid,uPrev; uniform vec2 uG; uniform float uHi,uLo; out vec4 o;\n' +
    'void main(){float s=0.0;for(int j=0;j<40;j++)for(int i=0;i<64;i++){ivec2 q=ivec2(vec2((float(i)+0.5)/64.0,(float(j)+0.5)/40.0)*uG);\n' +
    '    s+=texelFetch(uGrid,q,0).r>0.75?1.0:0.0;}\n' +
    '  float f=s/2560.0,d=texelFetch(uPrev,ivec2(0),0).r;\n' +
    '  o=vec4(d>0.5?(f>uLo?1.0:0.0):(f>uHi?1.0:0.0),f,0.,1.);}\n';

  // light on the sand: dim dunes under a low sun from the upper left (marched through the sand), deeper sand darker;
  // the warm light of a nearby person; the glow of sand that was just on someone
  var FS_LIT = HEAD + COMMON +
    'uniform sampler2D uGrid; uniform float uIdle,uBodyLight,uReach,uHeatGlow,uSideLight;\n' +
    'layout(location=0) out vec4 o; layout(location=1) out vec4 oHot;\n' +
    'bool sandAt(ivec2 q){return inG(q)&&texelFetch(uGrid,q,0).r>0.75;}\n' +
    'void main(){ivec2 c=ivec2(gl_FragCoord.xy);vec4 g=texelFetch(uGrid,c,0);oHot=vec4(0.);if(g.r<0.75){o=vec4(0.);return;}\n' +
    '  vec3 alb=albedo(g.g,g.b);\n' +
    '  float occ=0.0;for(int k=1;k<=8;k++){if(sandAt(c+ivec2(round(vec2(-0.6,1.0)*float(k)*1.5))))occ+=1.0;}\n' +
    '  float sun=exp(-occ*0.8);\n' +
    '  float cover=0.0;for(int k=1;k<=6;k++){if(sandAt(c+ivec2(0,k*3)))cover+=1.0;}\n' +
    '  o=vec4(alb*uIdle*(0.8+0.2*sun)*mix(1.0,0.82,cover/6.0),1.0);\n' +
    '  vec4 bd=bodyAt(vec2(c)+0.5);float bl=bd.g>=-0.25?uBodyLight*exp(-max(bd.g,0.0)/uReach):0.0;\n' +
    '  if(bl>0.01)bl*=mix(uSideLight,1.0,smoothstep(-0.1,0.7,outward(vec2(c)+0.5).y));\n' +   // brightest on what rests on top of you
    '  oHot=vec4((alb*vec3(1.0,0.9,0.74)*bl+alb*vec3(1.0,0.72,0.45)*g.a*uHeatGlow)*(0.45+0.55*sun)*mix(1.0,0.7,cover/6.0),1.0);}\n';


  // grains in the air: a dot with a short streak along its path, lit like the sand (and by any person near it)
  var VS_AIR = HEAD + COMMON +
    'uniform sampler2D uPA,uPB; uniform float uStreak,uIdleAir,uBodyLight,uReach,uHeatGlow,uPxCell; uniform vec2 uNudge; out vec3 vIdle; out vec3 vHot;\n' +
    'void main(){int i=gl_VertexID>>1,e=gl_VertexID&1;ivec2 s=ivec2(i%int(uG.x),i/int(uG.x));vec4 B=texelFetch(uPB,s,0);\n' +
    '  if(B.a<0.25||B.a>0.75){gl_Position=vec4(2.,2.,2.,1.);vIdle=vec3(0.);vHot=vec3(0.);return;}\n' +
    '  vec4 A=texelFetch(uPA,s,0);vec2 p=A.xy-(e==1?A.zw*uStreak:vec2(0.));\n' +
    '  gl_Position=vec4(p.x/uG.x*2.0-1.0+uNudge.x,p.y/uG.y*2.0-1.0,0.,1.);\n' +
    '  vec4 bd=bodyAt(A.xy);float bl=bd.g>=-0.25?uBodyLight*exp(-max(bd.g,0.0)/uReach):0.0;\n' +
    '  vec3 alb=albedo(B.r,B.g);float len=max(1.0,length(A.zw*uStreak)*uPxCell);\n' +
    '  float k=clamp(sqrt(3.0/len),0.45,1.0);vIdle=mix(alb,vec3(1.0,0.82,0.52),0.35)*uIdleAir;\n' +
    '  vHot=(alb*bl*vec3(1.0,0.9,0.74)+alb*vec3(1.0,0.72,0.45)*B.b*uHeatGlow)*k;}\n';
  var FS_AIR = HEAD + 'in vec3 vIdle; in vec3 vHot; layout(location=0) out vec4 o; layout(location=1) out vec4 oHot; void main(){o=vec4(vIdle,1.0);oHot=vec4(vHot,1.0);}\n';

  var FS_DOWN = HEAD + 'uniform sampler2D uSrc,uLitHot; uniform vec2 uTexel; in vec2 vUv; out vec4 o;\n' +
    'vec3 at(vec2 q){return texture(uSrc,q).rgb+texture(uLitHot,q).rgb;}\n' +
    'void main(){vec3 c=at(vUv+uTexel*vec2(-1.,-1.))+at(vUv+uTexel*vec2(1.,-1.))+at(vUv+uTexel*vec2(-1.,1.))+at(vUv+uTexel*vec2(1.,1.));o=vec4(c*0.25,1.0);}\n';
  var FS_BLUR = HEAD + 'uniform sampler2D uSrc; uniform vec2 uDir; in vec2 vUv; out vec4 o;\n' +
    'void main(){vec3 c=texture(uSrc,vUv).rgb*0.2270270270;\n' +
    '  c+=(texture(uSrc,vUv+uDir*1.3846153846).rgb+texture(uSrc,vUv-uDir*1.3846153846).rgb)*0.3162162162;\n' +
    '  c+=(texture(uSrc,vUv+uDir*3.2307692308).rgb+texture(uSrc,vUv-uDir*3.2307692308).rgb)*0.0702702703;o=vec4(c,1.0);}\n';
  var FS_COMP = HEAD +
    'uniform sampler2D uLitIdle,uLitHot,uAirIdle,uAirHot,uGlow,uBody; uniform mat3 uHinv; uniform float uBloom,uDark,uCap; in vec2 vUv; out vec4 o;\n' +
    'void main(){vec3 idle=texture(uLitIdle,vUv).rgb+texture(uAirIdle,vUv).rgb;\n' +
    '  float L=dot(idle,vec3(0.2126,0.7152,0.0722));idle*=1.0/pow(1.0+pow(L/uCap,4.0),0.25);\n' +   // the empty wall never outshines a person
    '  vec3 col=idle+texture(uLitHot,vUv).rgb+texture(uAirHot,vUv).rgb+texture(uGlow,vUv).rgb*uBloom;\n' +
    '  vec3 h=uHinv*vec3(vUv.x,1.0-vUv.y,1.0);float m=0.0;\n' +
    '  if(h.z>0.0){vec2 k=h.xy/h.z;if(k.x>=0.0&&k.y>=0.0&&k.x<=1.0&&k.y<=1.0)m=texture(uBody,k).r;}\n' +
    '  col*=1.0-uDark*smoothstep(0.62,0.85,m);\n' +   // nothing projected inside a person
    '  o=vec4(1.0-exp(-col*1.1),1.0);}\n';

  // the 2 x 2 blocks shift through all four offsets in turn (two diagonal offsets alone let half the grains slide only one way)
  var PARITY = [[0, 0], [1, 1], [1, 0], [0, 1]];

  // ---------------------------------------------------------------- the piece
  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Sandfall needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
                                          preserveDrawingBuffer: false, powerPreference: 'high-performance'});
    if (!gl) throw new Error('Sandfall needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Sandfall needs EXT_color_buffer_float');
    var wallK = 2.0;               // 'Empty wall' knob (1 = the 2026-10-05 picture): scales the resting-dune and falling-grain light and lifts IDLE_CAP with it; people's light is untouched
    var destroyed = false, made = {tex: [], fb: [], prog: [], vao: [], rb: []};

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var m = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + m); }
      return s;
    }
    function program(vs, fs) {
      var p = gl.createProgram(), a = shader(gl.VERTEX_SHADER, vs), b = shader(gl.FRAGMENT_SHADER, fs);
      gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p); gl.deleteShader(a); gl.deleteShader(b);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var m = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error('link: ' + m); }
      made.prog.push(p);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    function tex(w, h, ifmt, fmt, type, filter, data) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      made.tex.push(t); return t;
    }
    function fbo(list, depthRb) {
      var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      if (depthRb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);
      var bufs = [];
      for (var i = 0; i < list.length; i++) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, list[i], 0); bufs.push(gl.COLOR_ATTACHMENT0 + i); }
      gl.drawBuffers(bufs);
      var st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Sandfall: framebuffer incomplete (' + st + ')');
      made.fb.push(f); return f;
    }
    function drop(list, x, del) { var i = list.indexOf(x); if (i >= 0) list.splice(i, 1); del(x); }

    var vao = gl.createVertexArray(); made.vao.push(vao); gl.bindVertexArray(vao);
    var P = {
      prep: program(VS_TRI, FS_PREP), part: program(VS_TRI, FS_PART), dep: program(VS_DEP, FS_DEP), marg: program(VS_TRI, FS_MARG),
      solid: program(VS_TRI, FS_SOLID), state: program(VS_TRI, FS_STATE), lit: program(VS_TRI, FS_LIT),
      air: program(VS_AIR, FS_AIR), down: program(VS_TRI, FS_DOWN), blur: program(VS_TRI, FS_BLUR), comp: program(VS_TRI, FS_COMP)
    };

    // ------------------------------------------------------------ the body (WallBody + a person-only field of our own)
    var BW = WallBody.w, BH = WallBody.h, BN = BW * BH, body = WallBody.create(kit, {});
    var fMask = new Float32Array(BN), arrive = new Float32Array(BN), dO = new Float32Array(BN), dI = new Float32Array(BN), upl = new Float32Array(BN * 4);
    var bodyTex = tex(BW, BH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, null), bodyLive = false, lastFold = -1;
    function chamfer(d) {
      var x, y, i, R2 = 1.4142;
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; if (!d[i]) continue; var v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) { v = Math.min(v, d[i - BW] + 1); if (x > 0) v = Math.min(v, d[i - BW - 1] + R2); if (x < BW - 1) v = Math.min(v, d[i - BW + 1] + R2); }
        d[i] = v; }
      for (y = BH - 1; y >= 0; y--) for (x = BW - 1; x >= 0; x--) { i = y * BW + x; if (!d[i]) continue; var u = d[i];
        if (x < BW - 1) u = Math.min(u, d[i + 1] + 1);
        if (y < BH - 1) { u = Math.min(u, d[i + BW] + 1); if (x < BW - 1) u = Math.min(u, d[i + BW + 1] + R2); if (x > 0) u = Math.min(u, d[i + BW - 1] + R2); }
        d[i] = u; }
    }
    // only real people count (blobs WallBody keeps as people); noise specks never become solid or lit
    function bodyFields(dtS) {
      var lab = body.label, mk = body.mask, i, any = false, k = Math.exp(-Math.max(0, dtS) / 0.25);
      for (i = 0; i < BN; i++) { var on = lab[i] >= 0; dO[i] = on ? 0 : 1e6; dI[i] = on ? 1e6 : 0; if (on) any = true; }
      if (any) { chamfer(dO); chamfer(dI); }
      var live = false;
      for (i = 0; i < BN; i++) {
        var keep = any ? Math.max(0, Math.min(1, 1.5 - 0.5 * dO[i])) : 0, m = mk[i] * keep;
        arrive[i] = Math.max(arrive[i] * k, m - fMask[i]); fMask[i] = m;
        if (arrive[i] < 0.004) arrive[i] = 0;
        if (m > 0.004 || arrive[i] > 0) live = true;
        upl[i * 4] = m; upl[i * 4 + 1] = any ? Math.max(-40, Math.min(40, lab[i] >= 0 ? -dI[i] : dO[i])) : 40; upl[i * 4 + 2] = arrive[i]; upl[i * 4 + 3] = 1;
      }
      gl.bindTexture(gl.TEXTURE_2D, bodyTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.FLOAT, upl);
      bodyLive = live;
    }
    bodyFields(0);

    // ------------------------------------------------------------ the sand grid and the pool
    var GW = 0, GH = 0, W = 0, H = 0;
    var grid = [null, null], gridFb = [null, null], prepTex, prepFb, solid = [null, null], solidFb = [null, null];
    var pA = [null, null], pB = [null, null], pFb = [null, null], depTex, depFb, depRb, litIdle, litHot, litFb, state = [null, null], stateFb = [null, null];
    var airIdle = null, airHot = null, airFb = null, glow = [null, null], glowFb = [null, null], GLW = 0, GLH = 0;
    var cur = 0, scur = 0, stcur = 0, step = 0;

    function dunes(fill) {                    // a settled landscape of layered dunes, about `fill` of the wall deep on average
      var d = new Uint8Array(GW * GH * 4), ph = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
      var hs = new Float32Array(GW), mean = 0, x, y;
      for (x = 0; x < GW; x++) {
        var u = x / GW;
        hs[x] = 1 + 0.45 * Math.sin(u * 6.283 * 1.3 + ph[0]) + 0.25 * Math.sin(u * 6.283 * 3.1 + ph[1]) + 0.12 * Math.sin(u * 6.283 * 7.3 + ph[2]);
        mean += hs[x];
      }
      mean /= GW;
      var layers = 5, top = fill * GH;
      for (x = 0; x < GW; x++) {
        var h = Math.max(1, Math.round(hs[x] / mean * top));
        for (y = 0; y < Math.min(GH, h); y++) {
          var i = (y * GW + x) * 4, lay = (y - 0.5 * (h - top)) / Math.max(4, top) * layers;
          var tint = ((Math.floor(lay) - layers + 60) % 6 + 6) % 6 / 6 + (Math.random() - 0.5) * 0.012;
          d[i] = 255; d[i + 1] = Math.round((tint - Math.floor(tint)) * 255); d[i + 2] = Math.floor(Math.random() * 128); d[i + 3] = 0;
        }
      }
      return d;
    }
    function buildGrid() {
      var j;
      if (grid[0]) {                          // rebuilt for a new shape of wall
        for (j = 0; j < 2; j++) { drop(made.fb, gridFb[j], gl.deleteFramebuffer.bind(gl)); drop(made.tex, grid[j], gl.deleteTexture.bind(gl));
          drop(made.fb, solidFb[j], gl.deleteFramebuffer.bind(gl)); drop(made.tex, solid[j], gl.deleteTexture.bind(gl));
          drop(made.fb, pFb[j], gl.deleteFramebuffer.bind(gl)); drop(made.tex, pA[j], gl.deleteTexture.bind(gl)); drop(made.tex, pB[j], gl.deleteTexture.bind(gl));
          drop(made.fb, stateFb[j], gl.deleteFramebuffer.bind(gl)); drop(made.tex, state[j], gl.deleteTexture.bind(gl)); }
        [prepFb, depFb, litFb].forEach(function (f) { drop(made.fb, f, gl.deleteFramebuffer.bind(gl)); });
        drop(made.rb, depRb, gl.deleteRenderbuffer.bind(gl));
        [prepTex, depTex, litIdle, litHot].forEach(function (t) { drop(made.tex, t, gl.deleteTexture.bind(gl)); });
      }
      var init = dunes(0.075);
      for (j = 0; j < 2; j++) {
        grid[j] = tex(GW, GH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, init); gridFb[j] = fbo([grid[j]]);
        solid[j] = tex(GW, GH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST, null); solidFb[j] = fbo([solid[j]]);
        pA[j] = tex(GW, GH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, null);
        pB[j] = tex(GW, GH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, null);
        pFb[j] = fbo([pA[j], pB[j]]);
        state[j] = tex(1, 1, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.NEAREST, null); stateFb[j] = fbo([state[j]]);
      }
      prepTex = tex(GW, GH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, null); prepFb = fbo([prepTex]);
      depTex = tex(GW, GH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, null);
      depRb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depRb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, GW, GH);
      made.rb.push(depRb); depFb = fbo([depTex], depRb);
      litIdle = tex(GW, GH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.NEAREST, null); litHot = tex(GW, GH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, null);
      litFb = fbo([litIdle, litHot]);
      for (j = 0; j < 2; j++) { gl.bindFramebuffer(gl.FRAMEBUFFER, pFb[j]); gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, solidFb[j]); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, stateFb[j]); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      cur = 0; scur = 0; stcur = 0;
    }
    function sizeAll(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      var cell = GRAIN_PX * w / 1280, gw = Math.max(64, Math.round(w / cell / 2) * 2), gh = Math.max(40, Math.round(h / cell / 2) * 2);
      if (gw !== GW || gh !== GH) { GW = gw; GH = gh; buildGrid(); }
      if (w === W && h === H) return;
      W = w; H = h;
      if (airFb) { drop(made.fb, airFb, gl.deleteFramebuffer.bind(gl)); drop(made.tex, airIdle, gl.deleteTexture.bind(gl)); drop(made.tex, airHot, gl.deleteTexture.bind(gl));
        for (var j = 0; j < 2; j++) { drop(made.fb, glowFb[j], gl.deleteFramebuffer.bind(gl)); drop(made.tex, glow[j], gl.deleteTexture.bind(gl)); } }
      airIdle = tex(W, H, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.NEAREST, null); airHot = tex(W, H, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, null);
      airFb = fbo([airIdle, airHot]);
      GLW = Math.max(1, Math.round(W / 4)); GLH = Math.max(1, Math.round(H / 4));
      for (var k = 0; k < 2; k++) { glow[k] = tex(GLW, GLH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, null); glowFb[k] = fbo([glow[k]]); }
    }
    sizeAll(canvas.width, canvas.height);

    // ------------------------------------------------------------ where the sand comes from
    var t0 = performance.now(), simT = 0, acc = 0, frames = 0, steps = 0, foldMs = 0;
    var streams = [], spU = new Float32Array(64), spH = new Float32Array(16), spN = 0, rateSum = 0;
    for (var si = 0; si < STREAMS; si++) streams.push({x: (si + 0.5) / STREAMS + (Math.random() - 0.5) * 0.08, w1: 0.03 + Math.random() * 0.03, w2: 0.02 + Math.random() * 0.03, p1: Math.random() * 6.28, p2: Math.random() * 6.28});
    var personSp = {}, fingerSp = [];          // person spouts by person id; finger spouts {x, y, last}
    var pourOn = true;                         // (tests only) false = no new sand
    function addSpout(x, y, hw, rate, heat) { if (spN >= 16 || !(rate > 0) || !pourOn) return; spU.set([x, y, hw, rate], spN * 4); spH[spN] = heat || 0; spN++; rateSum += rate; }
    function fingerAt(x, y, nowMs) {
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
      var best = null, bd = 0.06;
      for (var i = 0; i < fingerSp.length; i++) { var d = Math.hypot(fingerSp[i].x - x, fingerSp[i].y - y); if (d < bd) { bd = d; best = fingerSp[i]; } }
      if (best) { best.x = x; best.y = y; best.last = nowMs; }
      else { if (fingerSp.length >= 6) fingerSp.sort(function (a, b) { return b.last - a.last; }).pop(); fingerSp.push({x: x, y: y, last: nowMs, born: nowMs}); }
    }
    function spouts(dt, nowMs) {
      spN = 0; rateSum = 0;
      var t = simT, i;
      var m = kit.music ? kit.music() : null, e = m && m.enabled && m.fresh ? m.amount : 0, bass = e ? e * m.bands[0] : 0, mid = e ? e * m.bands[1] : 0, high = e ? e * m.bands[2] : 0, beat = e ? e * m.pulse : 0;
      var mFlow = 1 + Math.min(1, bass * 1.8);          // music: bass raises the flow up to 2x, each beat gushes extra sand from the same streams
      for (i = 0; i < streams.length; i++) {          // the streams wander slowly and swell and thin on their own
        var s = streams[i], x = Math.max(0.02, Math.min(0.98, s.x + 0.05 * Math.sin(t * s.w1 + s.p1)));
        addSpout(x * GW, GH - 0.5, 1.2, STREAM_RATE * mFlow * (0.6 + 0.4 * Math.sin(t * s.w2 + s.p2)));
        if (beat > .02) addSpout(x * GW, GH - 0.5, 6, STREAM_RATE * 36 * beat);
      }
      addSpout(GW / 2, GH - 0.5, -GW / 2, RAIN_RATE);  // the fine sifting everywhere (negative width = even spread)
      var seen = {}, people = body.people || [], a = 1 - Math.exp(-dt / 0.6);
      for (i = 0; i < people.length && i < 4; i++) {
        var p = people[i], c = kit.toScreen(p.cx * 512, p.top * 424), l = kit.toScreen(p.left * 512, p.cy * 424), r = kit.toScreen(p.right * 512, p.cy * 424);
        if (!c || !l || !r) continue;
        var sp = personSp[p.id] || (personSp[p.id] = {x: c[0], w: Math.abs(r[0] - l[0]) / 2, ramp: 0});
        sp.x += (c[0] - sp.x) * a; sp.w += (Math.abs(r[0] - l[0]) / 2 - sp.w) * a; sp.ramp = Math.min(1, sp.ramp + dt / 0.5); sp.seen = true; seen[p.id] = true;
      }
      Object.keys(personSp).forEach(function (id) {
        var sp = personSp[id];
        if (!seen[id]) { sp.ramp -= dt / 0.5; if (sp.ramp <= 0) { delete personSp[id]; return; } }
        addSpout(Math.max(0, Math.min(1, sp.x)) * GW, GH - 0.5, Math.max(4, Math.min(0.18, sp.w * 0.8) * GW), PERSON_RATE * Math.max(0, sp.ramp));
      });
      var f = kit.fingers;                             // fingertips on the wall: a spout at each, lingering after it lifts
      if (f && Array.isArray(f.pts) && Date.now() - f.t <= 160) for (i = 0; i < f.pts.length; i++) if (f.pts[i]) fingerAt(f.pts[i][0], f.pts[i][1], nowMs);
      for (i = fingerSp.length - 1; i >= 0; i--) {
        var fs = fingerSp[i], age = (nowMs - fs.last) / 1000;
        if (age > FINGER_LINGER_S) { fingerSp.splice(i, 1); continue; }
        var burst = (nowMs - fs.born) / 1000 < FINGER_BURST_S ? 4 : 1;   // a gush the moment the finger lands, so it shows at once
        addSpout(fs.x * GW, (1 - fs.y) * GH, 0.8, burst * FINGER_RATE * (age < 0.2 ? 1 : 1 - (age - 0.2) / (FINGER_LINGER_S - 0.2)), 1);   // sand from a fingertip is warm
      }
    }
    function tintNow() {
      var l = simT / LAYER_S, f = l - Math.floor(l);
      return ((Math.floor(l) + 1 + (f > 0.88 ? (f - 0.88) / 0.12 : 0)) % 6) / 6;
    }

    // ------------------------------------------------------------ one sand step
    function bindT(unit, t, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }
    function common(pr) { gl.uniform2f(pr.u.uG, GW, GH); if (pr.u.uHinv) gl.uniformMatrix3fv(pr.u.uHinv, false, body.hinv()); if (pr.u.uBody) bindT(7, bodyTex, pr.u.uBody); }
    function simStep(dts) {
      var u;
      gl.viewport(0, 0, GW, GH); gl.disable(gl.BLEND);
      // prep
      gl.useProgram(P.prep.p); u = P.prep.u; common(P.prep);
      bindT(0, grid[cur], u.uGrid); bindT(1, pB[cur], u.uPB); bindT(2, solid[scur], u.uSolid); gl.uniform1f(u.uThrowMin, THROW_MIN);
      gl.uniform1f(u.uSteep, Math.cos(STEEP_DEG * Math.PI / 180));
      gl.bindFramebuffer(gl.FRAMEBUFFER, prepFb); gl.drawArrays(gl.TRIANGLES, 0, 3);
      // pool
      gl.useProgram(P.part.p); u = P.part.u; common(P.part);
      bindT(0, pA[cur], u.uPA); bindT(1, pB[cur], u.uPB); bindT(2, prepTex, u.uPrep); bindT(3, solid[scur], u.uSolid); bindT(4, state[stcur], u.uState); bindT(5, depTex, u.uDep);
      gl.uniform1f(u.uDt, dts); gl.uniform1f(u.uGrav, GRAVITY); gl.uniform1f(u.uVmax, MAX_FALL); gl.uniform1f(u.uThrowMin, THROW_MIN);
      gl.uniform1f(u.uThrowSpeed, THROW_SPEED); gl.uniform1f(u.uThrowUp, THROW_UP); gl.uniform1f(u.uEscape, ESCAPE); gl.uniform1f(u.uSlideV, SLIDE_OFF_SPEED); gl.uniform1f(u.uDropV, 40);
      gl.uniform1f(u.uHeatS, HEAT_S); gl.uniform1f(u.uRateSum, rateSum); gl.uniform1f(u.uBand, BAND_ROWS); gl.uniform1f(u.uTint, tintNow());
      gl.uniform1f(u.uDrainPour, DRAIN_POUR); gl.uniform4fv(u.uSp, spU); gl.uniform1fv(u.uSpHeat, spH); gl.uniform1i(u.uSpN, spN); gl.uniform1ui(u.uStep, step >>> 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pFb[1 - cur]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      // landings
      gl.bindFramebuffer(gl.FRAMEBUFFER, depFb); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS);
      gl.useProgram(P.dep.p); u = P.dep.u; gl.uniform2f(u.uG, GW, GH);
      bindT(0, pA[1 - cur], u.uPA); bindT(1, pB[1 - cur], u.uPB);
      gl.drawArrays(gl.POINTS, 0, GW * GH);
      gl.disable(gl.DEPTH_TEST);
      // grid
      gl.useProgram(P.marg.p); u = P.marg.u; common(P.marg);
      bindT(0, prepTex, u.uPrep); bindT(1, depTex, u.uDep); bindT(2, solid[scur], u.uSolid); bindT(3, state[stcur], u.uState);
      var par = PARITY[step & 3]; gl.uniform2i(u.uPar, par[0], par[1]); gl.uniform1ui(u.uStep, step >>> 0); gl.uniform1f(u.uSlide, SLIDE);
      gl.uniform1f(u.uSteep, Math.cos(STEEP_DEG * Math.PI / 180)); gl.uniform1f(u.uCreep, CREEP);
      gl.uniform1f(u.uDrainP, DRAIN_ROWS_S / SIM_HZ); gl.uniform1f(u.uHeatDec, dts / HEAT_S); gl.uniform1f(u.uHeatSdf, HEAT_SDF); gl.uniform1f(u.uTouchSdf, TOUCH_SDF);
      gl.bindFramebuffer(gl.FRAMEBUFFER, gridFb[1 - cur]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = 1 - cur; step++; steps++;
      for (var k = 0; k < 8; k++) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
    }
    function solidPass() {
      gl.viewport(0, 0, GW, GH); gl.disable(gl.BLEND);
      gl.useProgram(P.solid.p); var u = P.solid.u; common(P.solid);
      bindT(0, solid[scur], u.uPrev); gl.uniform1f(u.uOn, MASK_ON); gl.uniform1f(u.uOff, MASK_OFF);
      gl.bindFramebuffer(gl.FRAMEBUFFER, solidFb[1 - scur]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      scur = 1 - scur;
    }
    function statePass() {
      gl.viewport(0, 0, 1, 1); gl.disable(gl.BLEND);
      gl.useProgram(P.state.p); var u = P.state.u;
      bindT(0, grid[cur], u.uGrid); bindT(1, state[stcur], u.uPrev); gl.uniform2f(u.uG, GW, GH);
      gl.uniform1f(u.uHi, FILL_DRAIN); gl.uniform1f(u.uLo, FILL_RESTART);
      gl.bindFramebuffer(gl.FRAMEBUFFER, stateFb[1 - stcur]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      stcur = 1 - stcur;
    }

    // ------------------------------------------------------------ to the wall
    function render() {
      var u;
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, GW, GH);
      gl.useProgram(P.lit.p); u = P.lit.u; common(P.lit);
      bindT(0, grid[cur], u.uGrid); gl.uniform1f(u.uIdle, IDLE * wallK); gl.uniform1f(u.uSideLight, SIDE_LIGHT); gl.uniform1f(u.uBodyLight, BODY_LIGHT); gl.uniform1f(u.uReach, LIGHT_REACH); gl.uniform1f(u.uHeatGlow, HEAT_GLOW);
      gl.bindFramebuffer(gl.FRAMEBUFFER, litFb); gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.viewport(0, 0, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, airFb); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.air.p); u = P.air.u; common(P.air);
      bindT(0, pA[cur], u.uPA); bindT(1, pB[cur], u.uPB);
      gl.uniform1f(u.uStreak, STREAK); gl.uniform1f(u.uIdleAir, IDLE_AIR * wallK); gl.uniform1f(u.uBodyLight, BODY_LIGHT); gl.uniform1f(u.uReach, LIGHT_REACH);
      gl.uniform1f(u.uHeatGlow, HEAT_GLOW); gl.uniform1f(u.uPxCell, W / GW);
      gl.uniform2f(u.uNudge, 0, 0); gl.drawArrays(gl.LINES, 0, GW * GH * 2);
      gl.uniform2f(u.uNudge, 2 / W, 0); gl.drawArrays(gl.LINES, 0, GW * GH * 2);   // twice, a pixel apart: grains two pixels wide
      gl.disable(gl.BLEND);

      gl.useProgram(P.down.p); bindT(0, airHot, P.down.u.uSrc); bindT(1, litHot, P.down.u.uLitHot); gl.uniform2f(P.down.u.uTexel, 1 / W, 1 / H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[0]); gl.viewport(0, 0, GLW, GLH); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(P.blur.p);
      for (var pass = 0; pass < 2; pass++) {
        gl.uniform2f(P.blur.u.uDir, (1 + pass) / GLW, 0); bindT(0, glow[0], P.blur.u.uSrc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[1]); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.uniform2f(P.blur.u.uDir, 0, (1 + pass) / GLH); bindT(0, glow[1], P.blur.u.uSrc);
        gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[0]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(P.comp.p); u = P.comp.u;
      bindT(0, litIdle, u.uLitIdle); bindT(1, litHot, u.uLitHot); bindT(2, airIdle, u.uAirIdle); bindT(3, airHot, u.uAirHot);
      bindT(4, glow[0], u.uGlow); bindT(5, bodyTex, u.uBody);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv()); gl.uniform1f(u.uBloom, BLOOM); gl.uniform1f(u.uDark, DARK_INSIDE); gl.uniform1f(u.uCap, IDLE_CAP * wallK);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (var k = 0; k < 8; k++) { gl.activeTexture(gl.TEXTURE0 + k); gl.bindTexture(gl.TEXTURE_2D, null); }
      gl.activeTexture(gl.TEXTURE0);
    }

    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); frames++;
      gl.bindVertexArray(vao);
      var fresh = body.update(dt, now);
      if (fresh) { var tf = performance.now(); bodyFields(lastFold > 0 ? (body.frameMs - lastFold) / 1000 : 0); lastFold = body.frameMs; foldMs = performance.now() - tf; }
      else if (!body.fresh && bodyLive) bodyFields(dt);   // the Kinect went quiet: let the last body go (light off, sand falls)
      acc += dt * SIM_HZ;
      var n = Math.min(MAX_STEPS, Math.floor(acc)); acc -= n; if (acc > 1) acc = 0;
      if (n > 0) {
        spouts(dt, now);
        solidPass();
        for (var i = 0; i < n; i++) { simT += 1 / SIM_HZ; simStep(1 / SIM_HZ); }
        if (frames % 8 === 0) statePass();
      }
      render();
      gl.bindVertexArray(null);
    }

    function touch(t) { if (t && !destroyed) fingerAt(t.x, t.y, performance.now()); }

    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.SandfallSet === set) delete window.SandfallSet;
      if (window.SandfallWake === wake) delete window.SandfallWake;
      kit.wantDepth(false);
      try {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        made.fb.forEach(function (f) { gl.deleteFramebuffer(f); });
        made.tex.forEach(function (t) { gl.deleteTexture(t); });
        made.prog.forEach(function (p) { gl.deleteProgram(p); });
        made.vao.forEach(function (v) { gl.deleteVertexArray(v); });
        made.rb.forEach(function (r) { gl.deleteRenderbuffer(r); });
      } catch (e) {}
      made = {tex: [], fb: [], prog: [], vao: [], rb: []};
      if (window.__sandfallDebug) try { delete window.__sandfallDebug; } catch (e) { window.__sandfallDebug = undefined; }
    }

    kit.wantDepth(true);

    if (window.WallTest) {                     // sandbox only (the live wall has no WallTest): readbacks for the tests
      var readFb = function (fb, w, h, att, type) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.readBuffer(gl.COLOR_ATTACHMENT0 + (att || 0));
        var px = type === 'f' ? new Float32Array(w * h * 4) : new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, type === 'f' ? gl.FLOAT : gl.UNSIGNED_BYTE, px);
        gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return px;
      };
      // box (optional) = [x0, y0, x1, y1] in window coordinates (y down): count only there
      window.__sandfallDebug = function (box) {
        var g = readFb(gridFb[cur], GW, GH), so = readFb(solidFb[scur], GW, GH), a = readFb(pFb[cur], GW, GH, 0, 'f'), b = readFb(pFb[cur], GW, GH, 1);
        var st = readFb(stateFb[stcur], 1, 1, 0, 'f');
        var X0 = 0, X1 = GW, Y0 = 0, Y1 = GH;
        if (box) { X0 = Math.floor(box[0] * GW); X1 = Math.ceil(box[2] * GW); Y0 = Math.floor((1 - box[3]) * GH); Y1 = Math.ceil((1 - box[1]) * GH); }
        var sand = 0, onBody = 0, solidN = 0, engulfed = 0, hot = 0, touched = 0, air = 0, up = 0, airBox = 0, airHot = 0, x, y, i;
        for (y = 0; y < GH; y++) for (x = 0; x < GW; x++) {
          i = y * GW + x;
          var inBox = x >= X0 && x < X1 && y >= Y0 && y < Y1, isS = g[i * 4] > 191, isB = so[i * 4] > 127;
          if (inBox) {
            if (isB) solidN++;
            if (isS) { sand++; if (isB) engulfed++; if (g[i * 4 + 3] > 64) hot++; if (g[i * 4 + 2] >= 128) touched++;
              for (var k = 1; k <= 12; k++) { var yy = y - k; if (yy < 0) break; var j = yy * GW + x; if (so[j * 4] > 127) { onBody++; break; } if (g[j * 4] < 191) break; } }
          }
          var fl = b[i * 4 + 3];
          if (fl > 64 && fl < 191) { air++; if (a[i * 4 + 3] > 60) up++; if (b[i * 4 + 2] > 64) airHot++;
            var px = a[i * 4], py = a[i * 4 + 1]; if (px >= X0 && px < X1 && py >= Y0 && py < Y1) airBox++; }
        }
        var amax = 0, an = 0; for (i = 0; i < BN; i++) { if (arrive[i] > amax) amax = arrive[i]; if (arrive[i] > THROW_MIN) an++; }
        return {arriveMax: +amax.toFixed(3), arriveN: an, grid: [GW, GH], sand: sand, onBody: onBody, solid: solidN, engulfed: engulfed, hot: hot, touched: touched, air: air, airUp: up, airBox: airBox, airHot: airHot,
                drain: st[0] > 0.5, fill: +st[1].toFixed(4), frames: frames, steps: steps, simT: +simT.toFixed(2), wallT: +((performance.now() - t0) / 1000).toFixed(2),
                spouts: spN, rate: Math.round(rateSum), fingers: fingerSp.length, people: (body.people || []).length, foldMs: +foldMs.toFixed(2), bodyFold: +body.foldMs.toFixed(2),
                glError: gl.getError()};
      };
      window.__sandfallDebug.pour = function (on) { pourOn = !!on; return pourOn; };   // (tests) stop / restart the pour
      window.__sandfallDebug.fill = function (frac) {   // lay down settled dunes `frac` deep (tests the hourglass at a full wall)
        var d = dunes(frac);
        gl.bindTexture(gl.TEXTURE_2D, grid[cur]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GW, GH, gl.RGBA, gl.UNSIGNED_BYTE, d);
        gl.bindTexture(gl.TEXTURE_2D, null); return true;
      };
    }

    function set(opts) {
      if (!opts || destroyed) return {gravity: GRAVITY, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.gravity)) GRAVITY = Math.max(200, Math.min(1500, opts.gravity));
      return {gravity: GRAVITY, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      try { if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true}); } catch (e) {}
    }
    window.SandfallSet = set;
    window.SandfallWake = wake;
    if (window._sandfallFx) set(window._sandfallFx);

    return {frame: frame, touch: touch, resize: function (w, h) { sizeAll(w, h); }, destroy: destroy};
  }
})();
