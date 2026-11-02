/* Hokusai · Summon the Wave (paintings round 2, 2026-10-08, built by Claude).
 *
 * An original woodblock seascape in Hokusai's language: aged cream paper with a dark bokashi sky, a small snow-capped Fuji, mist
 * bands, a title cartouche, and a sea of Prussian-blue bands with dark indigo keylines, long boats of crouching rowers riding it.
 * The sea always swells. Move in front of it and you SUMMON A GREAT WAVE: walking across the lower wall, dancing or sweeping an
 * arm raises a towering wave right behind you; the more you move, the taller it grows (a running child makes a monster). When you
 * stop (or after a few seconds) it steepens, curls over into the hooked lip with claw-like foam fingers, crashes, throws spray
 * that falls like snow, then rolls on across the wall the way you were moving and spends itself, leaving foam and churned water
 * that settle over the next minute. Boats ride the real water and get tossed. A fingertip anywhere splashes spray; low on the
 * wall (the sea) it summons a wave too, and dragging it makes that wave bigger and sends it the way you dragged.
 * Inside a person's silhouette the print is dimmed to INSIDE (a shadow), so the projector light stays off faces.
 *
 * How: the idle sea is a pure function of time (slow cusped swells with foam caps, four layers far to near, two small curling
 * breakers that come and go). Everything people cause lives on top: a 1D wave equation per layer (CPU, 120 Hz fixed steps),
 * a churn level per column, a foam field on the front water (CPU, x by depth below the surface, fades over about a minute
 * times LINGER), up to MAX_WAVES great waves (objects: rise -> curl -> crash -> roll), and spray particles. A person's drive
 * is their body-wide movement (minus the echo of their own arrival), or a sharp arm sweep, plus walking speed in their own
 * heights per second; it builds a charge that summons their wave and then feeds it (how much and how hard set its height). Each frame the CPU writes every layer's surface height per
 * column into a small float texture (so boats ride exactly the water that is drawn). The fragment shader draws the print in two
 * passes: the fills plus a keyline mask, then the keylines a pixel off register, paper grain and the people's shadows. A great
 * wave's overhang comes from a twirl of space around a point just ahead of its crest (the curl), and its claws from fractal
 * spikes on the crest that the twirl hooks forward.
 * Body: plugins/body.js (WallBody), unmodified; one depth client (via the host). WebGL 2, no assets, no audio, no network.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  // The five live knobs (window.HokusaiSet / window._hokusaiFx): height, summon, linger, spray, inside.
  var HEIGHT = 1.0;          // how tall summoned waves grow (1 = a full-speed run raises one about two-thirds of the wall)
  var SUMMON = 1.0;          // how easily movement summons a wave (2 = half the movement is enough, 0.5 = twice as much)
  var LINGER = 1.0;          // how long foam and churned water stay after a wave (1 = they fade over about a minute)
  var SPRAY = 1.0;           // how much spray ("snow") a wave throws
  var INSIDE = 0.3;          // brightness of the print inside a person's silhouette (0 = black shadow, 1 = not dimmed)
  // movement -> waves
  var MOVE_FLOOR = 0.05;     // body movement under this is standing still (a held arm on the real Kinect wobbles 0.013-0.08)
  var MOVE_FULL = 0.25;      // ...and this much is a full-on dance
  var SWEEP_FLOOR = 0.0008;  // sharp movement (body cells that changed a lot, per body height squared) under this is Kinect noise...
  var SWEEP_FULL = 0.005;    // ...and this much is a big arm sweep (an arm barely moves the body-wide average, so it counts on its own)
  var SPEED_FLOOR = 0.15;    // walking slower than this (your own heights per second) does not count
  var SPEED_FULL = 1.2;      // ...and this fast is a full run
  var SUMMON_AT = 0.12;      // built-up movement that summons a wave
  var CHARGE_FADE_S = 1.0;   // built-up movement fades this fast when you stop (s)
  var COOL_S = 1.5;          // after your wave starts to curl, you can summon the next one this much later (s)
  var RISE_S = 0.42;         // how quickly a wave rises toward its height (time constant, s)
  var RISE_MAX_S = 2.8;      // the longest a wave keeps rising while you keep moving (s)
  var LET_GO_S = 0.9;        // a wave starts to curl this long after you stop feeding it (s; arm sweeps pause at each turn)
  var BEHIND = 0.05;         // a wave rises this far behind you (wall widths), so it chases you the way you move
  var CURL_S = 1.3;          // how long the crest takes to curl over and crash (s)
  var ROLL_SPEED = 0.045;    // after the crash a wave rolls on this fast (wall widths per second, bigger waves faster)
  var SPEND_S = 3.2;         // ...and spends itself over about this long (time constant, s)
  var MAX_WAVES = 3;         // great waves at once (a crowd cannot fill the whole wall)
  var TOUCH_E = 1.0;         // a fingertip low on the wall summons a wave this big (1 = medium; dragging adds)
  var LOW_Y = 0.45;          // fingertips lower than this (share of the wall from the top) summon a great wave
  var WAKE_UNIT = 0.012;     // the bridge's usual Wake strength (SPAWN_STRENGTH): that much counts as a normal touch
  var FOAM_S = 24;           // foam fades over about this long (time constant, s; times LINGER)
  var CHURN_S = 20;          // churned water calms over about this long (time constant, s; times LINGER)
  var RIPPLE_S = 9;          // ripples people make on the water die down over about this long (s)
  var STIR = 0.55;           // how hard a moving body stirs the water it stands in
  var TWIST = 3.8;           // how far a crest curls over at the crash (radians of twirl at its centre)
  var REG_PX = [1.7, -1.2];  // the keyline block printed slightly off register (px on a 1280-wide picture)
  // the curl's geometry (share of the wave's height A or half-width w): where space twirls, how far, how softly
  var CURL = {r: 0.72, cy: 0.78, cyc: 0.08, cx0: 0.2, cx1: 0.32, fall: 1.3, claw: 0.14, sw: 0.8, sp: 1.1, f1: 8, f2: 19, o2: 0.5, f3: 43, o3: 0.3, band: 0.055, w0: -0.1, w1: 0.8};

  registerWallPlugin({id: 'hokusai', title: 'Hokusai · Summon the Wave', author: 'Claude (paintings round 2)', create: create});

  // sea layers, far to near: where each calm surface sits (share of the wall from the top), and its swells
  var LAYER_Y = [0.592, 0.636, 0.700, 0.778];
  var SW = [[0.0035, 9.0, 0.050, 0.10, 17.0, 0.030, 1.3],      // [height, crests per wall, crest speed, phase, ripples per wall, speed, phase]
            [0.0060, 7.0, 0.060, 0.70, 13.0, 0.040, 2.1],
            [0.0100, 5.5, 0.070, 0.30, 11.0, 0.050, 0.4],
            [0.0160, 3.6, 0.060, 0.55, 8.5, 0.045, 4.0]];
  var Y3 = 1 - LAYER_Y[3];
  var NC = 768, NS = 192, FX = 176, FD = 44, FOAM_D = 0.2, MAXE = 6, MAXP = 1400, STEP = 1 / 120, MAX_STEPS = 10;
  var C_LAYER = [0.10, 0.13, 0.16, 0.20];                  // ripple speed per layer (wall widths per second)
  var SIM_LIM = [0.003, 0.006, 0.014, 0.032];              // the most a ripple can lift or drop each layer (share of the wall height)
  var VISC = 0.12;                                         // ripples stay smooth (no sharp fronts)

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function swell(x, L, t) {
    var s = SW[L], a = s[0];
    if (L === 3) a *= 0.8 + 0.2 * Math.sin(t * 0.11 + x * 2.0);
    var sn = Math.sin(Math.PI * (x * s[1] - t * s[2] + s[3]));                // a cusped swell: pointed crests (slightly rounded), round troughs
    return a * (0.62 * (1 - 2 * Math.sqrt(sn * sn + 0.0025)) + 0.38 * Math.sin(6.2832 * (x * s[4] + t * s[5]) + s[6]));
  }

  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var LIB = [
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'vec2 hash2(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return fract(sin(p)*43758.5453);}',
    'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}',
    'float sdSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-9),0.,1.);return length(pa-ba*h);}',
    ''].join('\n');

  // pass 1: the print's colour fills (rgb) and its keyline mask (a)
  var FS1 = ['#version 300 es', 'precision highp float;', LIB,
    'uniform sampler2D uProf, uFoam; uniform vec2 uRes; uniform float uT, uAsp, uPx, uCaused, uNC;',
    'uniform float uFall, uClaw; uniform vec4 uSpk; uniform vec4 uSpk2; uniform vec2 uWin; uniform int uNE; uniform vec4 uE0[' + MAXE + ']; uniform vec4 uE1[' + MAXE + ']; uniform vec4 uE2[' + MAXE + '];',
    'uniform vec4 uB0[3]; uniform vec4 uB1[3];',
    'in vec2 vUv; out vec4 o;',
    'const vec3 DEEP=vec3(.09,.20,.37), MID=vec3(.16,.33,.56), LIGHT=vec3(.34,.54,.74), FLOW=vec3(.45,.63,.79), FOAMC=vec3(.94,.91,.82);',
    // a layer's surface height at x (Y up), from the CPU profile (texelFetch + lerp: float textures need not be filterable)
    'float prof(float x,int row){ float f=clamp((x+.1)/1.2*uNC-.5,0.,uNC-1.001); int i=int(f); float t=f-float(i);',
    '  return mix(texelFetch(uProf,ivec2(i,row),0).r,texelFetch(uProf,ivec2(i+1,row),0).r,t); }',
    'float spike(float u){ return pow(max(0.,1.-abs(fract(u)-.5)*2./uSpk.x),uSpk.y); }',
    // the front water at x: surface with claws, crest-foam thickness
    'void front(float x,out float S,out float claws,out float crest,out float churn){',
    '  S=prof(x,3); churn=prof(x,4)*uCaused; crest=0.; claws=0.;',
    '  float ph=x*' + SW[3][1].toFixed(2) + '-uT*' + SW[3][2].toFixed(3) + '+' + SW[3][3].toFixed(2) + ', fd=abs(fract(ph+.5)-.5);',   // foam caps on some swell crests
    '  float cap=smoothstep(.35,.6,vnoise(vec2(floor(ph+.5)*3.7+.5,1.3)))*exp(-fd*fd/.003)*.011*(.8+.2*sin(uT*.11+x*2.));',
    '  crest+=cap; claws+=cap*.9*spike(x*uAsp*48.);',
    '  for(int i=0;i<' + MAXE + ';i++){ if(i>=uNE) break;',
    '    vec4 a=uE0[i], b=uE2[i]; float u=(x-a.x)/a.z*a.w;',
    '    float sc=max(a.y,.1), xs=x*uAsp/sc*a.w;',
    '    float win=smoothstep(uWin.x,uWin.x+.3,u)*(1.-smoothstep(uWin.y-.35,uWin.y,u));',
    '    float cl=spike(xs*uSpk.z+b.w)+uSpk2.y*spike(xs*uSpk.w+b.w*1.7)+uSpk2.w*spike(xs*uSpk2.z+b.w*2.9);',
    '    float claw=b.x*a.y*uClaw*win*cl;',
    '    float win2=smoothstep(-1.,-.25,u)*(1.-smoothstep(.15,.6,u));',
    '    float lobes=spike(xs*5.5+b.w*.7);',
    '    claws+=claw; crest+=win2*a.y*b.y*(uSpk2.x+.06*lobes); } }',
    'vec3 sky(float X,float Y,inout float key){',
    '  float y=1.-Y; vec3 c=mix(vec3(.79,.73,.59),vec3(.75,.68,.54),smoothstep(.12,.58,y));',
    '  float bk=1.-smoothstep(0.,.33,y); c=mix(c,vec3(.25,.29,.36),bk*bk*.93);',
    '  c*=.985+.03*vnoise(vec2(X*5.,y*150.+3.*vnoise(vec2(X*3.,y*9.))));',          // wood grain in the paper
    // Fuji
    '  float xf=.655,hb=.165,Hf=.128,Yh=1.-.585; float dx=abs(X-xf)/hb;',
    '  float pr=Yh+Hf*min(pow(max(0.,1.-dx),1.55),.93); float em=Y-pr, fwm=max(fwidth(em),1e-5), am=clamp(.5-em/fwm,0.,1.);',
    '  float tri=abs(fract(X*58.)-.5)*2.; float snowY=Yh+Hf*(.56+.16*tri*(.4+.6*vnoise(vec2(X*80.,2.))));',
    '  float es=snowY-Y, as=clamp(.5-es/fwm,0.,1.);',
    '  vec3 mc=mix(vec3(.31,.37,.47),vec3(.42,.48,.58),smoothstep(Yh,Yh+Hf*.6,Y));',
    '  mc*=.92+.08*smoothstep(.35,.7,vnoise(vec2(X*130.,Y*5.)));',
    '  mc=mix(mc,vec3(.88,.85,.77),as); c=mix(c,mc,am);',
    '  key=max(key,1.-smoothstep(.5,1.5,abs(em)/fwm)); key=max(key,am*(1.-smoothstep(.2,1.,abs(es)/fwm))*.85);',
    // mist bands (kasumi), drifting very slowly
    '  for(int k=0;k<3;k++){ float fk=float(k); float cy=k==0?.47:k==1?.53:.36; float hl=k==0?.26:k==1?.17:.13;',
    '    float cx=fract(.31+fk*.37+uT*(k==1?-.0021:.0027))*1.9-.45; float ux=(X-cx)/hl;',
    '    float tap=sqrt(max(0.,1.-pow(abs(ux),4.))); float th=(k==2?.011:.015)*tap;',
    '    float top=(1.-cy)+th*(.35+.65*pow(abs(sin(ux*(k==1?7.:9.)+fk)),.55)), bot=(1.-cy)-th*.55;',
    '    float ek=max(max(Y-top,bot-Y),(abs(ux)-1.)*hl*.25); float fk2=max(fwidth(ek),1e-5); float ak=clamp(.5-ek/fk2,0.,1.);',
    '    c=mix(c,mix(vec3(.86,.80,.69),vec3(.80,.72,.62),smoothstep(bot,top,Y)),ak*.85);',
    '    key=max(key,(1.-smoothstep(.3,1.,abs(Y-top)/fk2))*step(bot,Y)*smoothstep(.05,.2,tap)*.45); }',
    // title cartouche and seal (abstract strokes, not text), in 800-high pixel units
    '  vec2 px=vec2(X*uRes.x,(1.-Y)*uRes.y)/(uRes.y/800.);',
    '  vec2 bd=abs(px-vec2(70.,136.))-vec2(29.,100.); float eb=max(bd.x,bd.y);',
    '  float inB=clamp(.5-eb,0.,1.); c=mix(c,vec3(.80,.70,.47),inB);',
    '  key=max(key,1.-smoothstep(.5,1.4,abs(eb))); key=max(key,(1.-smoothstep(.4,1.,abs(eb+4.5)))*.8);',
    '  vec2 gc=(px-vec2(48.,44.))/vec2(44.,30.); float row=floor(gc.y); vec2 g=fract(gc);',
    '  float gl=0.; if(gc.x>0.&&gc.x<1.&&row>=0.&&row<6.){ for(int s=0;s<4;s++){ vec2 h=hash2(vec2(row*7.1+3.,float(s)*3.3+1.));',
    '    vec2 a=.18+.64*h; vec2 b2=a+(fract(h.x*9.7)>.5?vec2(.42,0.):vec2(0.,.48))*(fract(h.y*13.1)>.5?1.:-1.); b2=clamp(b2,.12,.88);',
    '    gl=max(gl,1.-smoothstep(1.1,2.,sdSeg(g*vec2(44.,30.),a*vec2(44.,30.),b2*vec2(44.,30.)))); } }',
    '  key=max(key,gl*.9*inB);',
    '  vec2 sg=(px-vec2(106.,46.))/vec2(14.,22.); float srow=floor(sg.y); float sl=0.;',
    '  if(sg.x>0.&&sg.x<1.&&srow>=0.&&srow<5.){ vec2 h=hash2(vec2(srow+40.,7.)); vec2 g2=fract(sg)*vec2(14.,22.);',
    '    sl=max(1.-smoothstep(.8,1.6,sdSeg(g2,vec2(3.+8.*h.x,3.),vec2(11.-6.*h.y,19.))),1.-smoothstep(.8,1.6,sdSeg(g2,vec2(2.,6.+10.*h.y),vec2(12.,8.+9.*h.x)))); }',
    '  key=max(key,sl*.75);',
    '  vec2 sd=abs(px-vec2(113.,174.))-vec2(7.,8.); float es2=max(sd.x,sd.y); float inS=clamp(.5-es2,0.,1.);',
    '  float sm=1.-smoothstep(.6,1.3,abs(max(abs(px.x-113.),abs(px.y-174.))-4.));',
    '  c=mix(c,mix(vec3(.66,.19,.14),vec3(.83,.62,.50),sm),inS);',
    '  return c; }',
    // a long boat with crouched rowers (no derivatives in here: it is behind a branch; the pixel size is known instead)
    'void boat(int b,vec2 p,inout vec3 col,inout float key){',
    '  vec4 B=uB0[b]; if(B.w<=0.) return;',
    '  vec2 d=p-vec2(B.x*uAsp,B.y); float cs=cos(B.z), sn=sin(B.z);',
    '  vec2 l=vec2(cs*d.x+sn*d.y,-sn*d.x+cs*d.y)/B.w; if(abs(l.x)>1.3||l.y<-.25||l.y>.4) return;',
    '  l.x*=uB1[b].z; float aa=uPx/B.w;',
    '  for(int k=0;k<6;k++){ float fx=-.56+float(k)*.2; float gk=.035+.11*pow(max(0.,(fx-.5)/.5),2.);',
    '    float ang=-1.05+.32*sin(uB1[b].y+float(k)*.5); vec2 oa=vec2(fx-.03,gk+.03), ob=oa+vec2(cos(ang),sin(ang))*.24;',
    '    float eo=sdSeg(l,oa,ob)-.007; float ao=clamp(.5-eo/aa,0.,1.); col=mix(col,vec3(.42,.32,.2),ao); key=max(key,(1.-smoothstep(.4,1.2,abs(eo)/aa))*.7); }',
    '  float lx=l.x, ly=l.y; float rise=.11*pow(max(0.,(lx-.5)/.5),2.)+.045*pow(max(0.,(-lx-.62)/.38),2.);',
    '  float gun=.035+rise, th=.085*sqrt(max(0.,1.-lx*lx))+.006;',
    '  float dh=max(max(ly-gun,(gun-th)-ly),(abs(lx)-1.)*.25); float ca=clamp(.5-dh/aa,0.,1.);',
    '  vec3 hc=mix(vec3(.50,.38,.22),vec3(.76,.62,.38),smoothstep(gun-th,gun-th*.3,ly));',
    '  hc=mix(hc,vec3(.30,.22,.13),(1.-smoothstep(.5,1.3,abs(ly-(gun-.013))/aa))*.8);',
    '  col=mix(col,hc,ca); key=max(key,1.-smoothstep(.5,1.4,abs(dh)/aa));',
    '  for(int k=0;k<6;k++){ float fx=-.56+float(k)*.2; float gk=.035+.11*pow(max(0.,(fx-.5)/.5),2.);',
    '    vec2 hp=(l-vec2(fx,gk))/vec2(.075,.06); float eb=(length(hp)-1.)*.06; eb=max(eb,gk-l.y);',
    '    float ab=clamp(.5-eb/aa,0.,1.); col=mix(col,mix(vec3(.17,.29,.49),vec3(.26,.41,.62),smoothstep(gk,gk+.05,l.y)),ab);',
    '    key=max(key,(1.-smoothstep(.4,1.2,abs(eb)/aa))*step(gk-.002,l.y));',
    '    float eh=length(l-vec2(fx+.055,gk+.045))-.02; float ah=clamp(.5-eh/aa,0.,1.);',
    '    col=mix(col,vec3(.86,.78,.62),ah); key=max(key,(1.-smoothstep(.4,1.1,abs(eh)/aa))*.9); } }',
    'void main(){',
    '  float X=vUv.x, Y=vUv.y; vec2 p=vec2(X*uAsp,Y); float key=0.;',
    '  vec3 col=sky(X,Y,key);',
    '  for(int L=0;L<3;L++){',
    '    if(L==2) boat(0,p,col,key);',
    '    float S=prof(X,L), e=Y-S, fw=max(fwidth(e),1e-5), a=clamp(.5-e/fw,0.,1.), d=max(-e,0.);',
    '    vec3 lc=L==0?vec3(.50,.60,.69):L==1?vec3(.35,.49,.64):vec3(.22,.38,.58);',
    '    vec3 tc=L==0?vec3(.62,.70,.76):L==1?vec3(.49,.62,.74):vec3(.38,.55,.72);',
    '    float tb=L==0?.0035:L==1?.006:.009;',
    '    lc=mix(lc,tc,clamp(.5+(tb-d)/fw,0.,1.)); lc*=1.-.12*smoothstep(0.,.07,d);',
    '    if(L==2){ float fl=1.-smoothstep(.4,1.2,abs(d-.024)/fw); lc=mix(lc,tc,fl*.8);',
    '      float ph=X*' + SW[2][1].toFixed(2) + '-uT*' + SW[2][2].toFixed(3) + '+' + SW[2][3].toFixed(2) + ', fd=abs(fract(ph+.5)-.5);',
    '      float cap=smoothstep(.4,.65,vnoise(vec2(floor(ph+.5)*5.1+.5,2.7)))*exp(-fd*fd/.002)*.0045;',
    '      lc=mix(lc,vec3(.86,.85,.78),clamp(.5+(cap-d)/fw,0.,1.)*step(.0006,cap)); }',
    '    col=mix(col,lc,a); float kw=L==0?.8:L==1?1.1:1.4;',
    '    key=max(key*(1.-a),1.-smoothstep(kw-.5,kw+.6,abs(e)/fw)); }',
    '  boat(1,p,col,key); boat(2,p,col,key);',
    // the front water: twirl space around each wave's curl centre, then read the surface there
    '  vec2 q=p;',
    '  for(int i=0;i<' + MAXE + ';i++){ if(i>=uNE) break; vec4 c=uE1[i]; vec2 C=vec2(c.x*uAsp,c.y), dd=q-C;',
    '    float k=clamp(1.-length(dd)/c.z,0.,1.); float an=c.w*pow(k,uFall); float cs=cos(an), sn=sin(an);',
    '    q=C+vec2(cs*dd.x-sn*dd.y,sn*dd.x+cs*dd.y); }',
    '  float qx=q.x/uAsp, S, claws, crest, churn; front(qx,S,claws,crest,churn);',
    '  float es=q.y-S, fwe=max(fwidth(es),1e-5), e=es-claws, fwo=max(fwidth(e),1e-5), a=clamp(.5-e/fwo,0.,1.), d=max(-es,0.);',
    '  float fw=fwe;',
    '  float hl=max(0.,S-.24);',                                                           // how high the water stands here (a great wave)
    '  float mb=.06+.03*churn+.30*hl, lb=.012+.014*churn+.10*hl;',
    '  vec3 c=mix(DEEP,MID,clamp(.5+(mb-d)/fw,0.,1.));',
    '  c=mix(c,LIGHT,clamp(.5+(lb-d)/fw,0.,1.));',
    '  float sp=.026, spx=sp/fw, ld=abs(fract(d/sp+.5)-.5)*spx;',                       // flow lines that follow the surface (faded where they crowd)
    '  float fl=(1.-smoothstep(.5,1.4,ld))*step(.02,d)*smoothstep(.22,.5,vnoise(vec2(qx*7.,d*5.)))*(.55+.35*min(churn,1.)+1.5*hl)*smoothstep(3.,7.,spx);',
    '  c=mix(c,FLOW,clamp(fl,0.,1.));',
    '  float sw=.0085, swx=sw/fw, ls=abs(fract(d/sw+.5)-.5)*swx;',                       // white striations in the light band of a great wave
    '  float st=(1.-smoothstep(.35,1.1,ls))*step(.004,d)*(1.-smoothstep(lb*.8,lb,d))*smoothstep(.03,.12,hl)*smoothstep(3.,6.,swx)*smoothstep(.25,.55,vnoise(vec2(qx*22.,d*40.)));',
    '  c=mix(c,vec3(.80,.84,.84),st*.85);',
    '  float wl=1.-smoothstep(.4,1.2,abs(d-.0165-.008*churn)/fw); c=mix(c,vec3(.72,.79,.82),wl*.7*(1.-smoothstep(.02,.08,hl)));',
    '  float Fv=uCaused*texture(uFoam,vec2((qx+.05)/1.1,clamp(d/' + FOAM_D.toFixed(3) + ',0.,1.))).r*(1.-smoothstep(' + (FOAM_D * 0.85).toFixed(3) + ',' + FOAM_D.toFixed(3) + ',d));',
    // foam: cream lace (merging bubbles) that grows with the foam level, with fine keylines
    '  vec2 lp=vec2(qx*uAsp,q.y)*36.+vec2(uT*.05,0.); vec2 n=floor(lp), f=fract(lp); float md=8.;',
    '  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 h=hash2(n+g); h=.5+.42*sin(uT*.35+6.2831*h); vec2 r=g+h-f; md=min(md,dot(r,r)); }',
    '  float fe=sqrt(md)-(.04+.56*clamp(Fv,0.,1.)); float fwf=max(fwidth(fe),1e-4); float on=step(.035,Fv);',
    '  float fa=clamp(.5-fe/fwf,0.,1.)*on;',
    '  c=mix(c,FOAMC,fa);',
    '  float ce=(S-q.y)-crest, ca=clamp(.5-ce/fw,0.,1.)*step(.0008,crest+claws);',              // crest foam with fingered underside and claws
    '  c=mix(c,FOAMC,ca);',
    '  col=mix(col,c,a);',
    '  float fk=(1.-smoothstep(.3,1.,abs(fe)/fwf))*on*.75*smoothstep(.1,.28,Fv)+(1.-smoothstep(.4,1.2,abs(ce)/fw))*step(.0008,crest)*step(0.,S-q.y);',
    '  key=max(key*(1.-a),max(1.-smoothstep(1.2,2.4,abs(e)/fwo),fk*a));',
    '  o=vec4(col,clamp(key,0.,1.)); }'].join('\n');

  // pass 2: keylines off register, paper, people as shadows
  var FS2 = ['#version 300 es', 'precision highp float;', LIB,
    'uniform sampler2D uA, uBody; uniform mat3 uHinv; uniform vec2 uRes, uReg; uniform float uInside, uBodyOn, uPxS;',
    'in vec2 vUv; out vec4 o;',
    'void main(){',
    '  vec4 A=texture(uA,vUv); float key=texture(uA,vUv+uReg).a; vec3 col=A.rgb;',
    '  vec2 px=vUv*uRes/uPxS;',
    '  float tooth=vnoise(px*.8)*.5+vnoise(px*2.1)*.3+hash(floor(px))*.2;',
    '  float fib=vnoise(vec2(px.x*.04,px.y*.7))*.6+vnoise(vec2(px.x*.11,px.y*1.9))*.4;',
    '  col*=.955+.06*tooth+.03*fib;',
    '  float ink=.80+.20*vnoise(px*.31);',
    '  col=mix(col,vec3(.085,.10,.18),key*ink);',
    '  vec2 w=vec2(vUv.x,1.-vUv.y); float vig=smoothstep(0.,.05,min(min(w.x,1.-w.x),min(w.y,1.-w.y))*1.6); col*=.9+.1*vig;',
    '  vec3 hh=uHinv*vec3(w,1.); vec2 k=hh.xy/max(hh.z,1e-6); float inK=(hh.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;',
    '  float m=texture(uBody,clamp(k,0.,1.)).r*inK*uBodyOn; float sh=smoothstep(.4,.6,m);',
    '  col*=mix(1.,uInside,sh);',
    '  float ed=abs(m-.5)/max(fwidth(m),1e-4); col=mix(col,vec3(.07,.09,.16),exp(-ed*ed/2.2)*step(.02,uBodyOn*m)*.85);',
    '  o=vec4(col,1.); }'].join('\n');

  // spray: cream dots and six-armed flakes that fall like snow
  var VSP = ['#version 300 es', 'precision highp float;',
    'layout(location=0) in vec4 aP; uniform sampler2D uBody; uniform mat3 uHinv; uniform float uInside, uBodyOn, uPxS;',
    'out float vA; out float vK; out float vS;',
    'void main(){ vec2 w=aP.xy; gl_Position=vec4(w.x*2.-1.,1.-w.y*2.,0.,1.); gl_PointSize=abs(aP.z)*uPxS; vS=gl_PointSize;',
    '  vec3 hh=uHinv*vec3(w,1.); vec2 k=hh.xy/max(hh.z,1e-6); float inK=(hh.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;',
    '  float m=textureLod(uBody,clamp(k,0.,1.),0.).r*inK*uBodyOn; vA=aP.w*mix(1.,uInside,smoothstep(.4,.6,m)); vK=aP.z<0.?1.:0.; }'].join('\n');
  var FSP = ['#version 300 es', 'precision highp float;', 'in float vA; in float vK; in float vS; out vec4 o;',
    'void main(){ vec2 c=gl_PointCoord*2.-1.; float r=length(c);',
    '  float a=atan(c.y,c.x); float star=r-(.45+.55*pow(abs(cos(a*3.)),6.));',
    '  float sh=mix(r-.92,star,vK); float cov=clamp(.5-sh*vS*.5,0.,1.);',
    '  float ring=vK>.5?0.:smoothstep(.55,.8,r);',
    '  vec3 col=mix(vec3(.95,.92,.84),vec3(.12,.16,.28),ring*.85);',
    '  float al=cov*vA; o=vec4(col*al,al); }'].join('\n');

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Hokusai needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Hokusai needs WebGL 2');
    var made = [], sized = [], destroyed = false, t0 = performance.now();

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    function program(vsSrc, fsSrc) {
      var p = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, vsSrc), fs = shader(gl.FRAGMENT_SHADER, fsSrc);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(e); }
      made.push(['Program', p]);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    function texture(w, h, ifmt, fmt, type, filter, list) {
      var t = gl.createTexture(); list.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function target(t, list) {
      var f = gl.createFramebuffer(); list.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Hokusai: framebuffer incomplete');
      return f;
    }

    var P1 = program(VS, FS1), P2 = program(VS, FS2), PS = program(VSP, FSP);
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);
    var sprayVao = gl.createVertexArray(); made.push(['VertexArray', sprayVao]);
    var sprayBuf = gl.createBuffer(); made.push(['Buffer', sprayBuf]);
    var sprayData = new Float32Array(MAXP * 4);
    gl.bindVertexArray(sprayVao); gl.bindBuffer(gl.ARRAY_BUFFER, sprayBuf); gl.bufferData(gl.ARRAY_BUFFER, sprayData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var profTex = texture(NC, 5, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, made), profIdleTex = texture(NC, 5, gl.R32F, gl.RED, gl.FLOAT, gl.NEAREST, made);
    var foamTex = texture(FX, FD, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, made);
    var BW = WallBody.w, BH = WallBody.h, BN = BW * BH, body = WallBody.create(kit, {});
    var bodyTex = texture(BW, BH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, made), bodyBytes = new Uint8Array(BN), bodyShown = false;

    // ---- state
    var prof = new Float32Array(NC * 5), profIdle = new Float32Array(NC * 5);
    var simH = [], simV = [];
    for (var L = 0; L < 4; L++) { simH.push(new Float32Array(NS)); simV.push(new Float32Array(NS)); }
    var churn = new Float32Array(NS), stirAcc = new Float32Array(NS), tmpV = new Float32Array(NS), sponge = new Float32Array(NS);
    for (var si = 0; si < NS; si++) { var sx = -0.1 + 1.2 * (si + 0.5) / NS; sponge[si] = sx < -0.04 ? (-0.04 - sx) / 0.06 : sx > 1.04 ? (sx - 1.04) / 0.06 : 0; sponge[si] = clamp(sponge[si], 0, 1); }
    var foam = new Float32Array(FX * FD), foam2 = new Float32Array(FX * FD), foamBytes = new Uint8Array(FX * FD), foamAcc = 0;
    var events = [], idleEv = [mkIdle(0), mkIdle(1)], evId = 0, summons = 0, crashes = 0, maxPeak = 0, lastCrash = null;
    var E0 = new Float32Array(MAXE * 4), E1 = new Float32Array(MAXE * 4), E2 = new Float32Array(MAXE * 4), nAll = 0, nIdle = 0;
    var sp = {n: 0, x: new Float32Array(MAXP), y: new Float32Array(MAXP), vx: new Float32Array(MAXP), vy: new Float32Array(MAXP),
      age: new Float32Array(MAXP), life: new Float32Array(MAXP), size: new Float32Array(MAXP), seed: new Float32Array(MAXP)};
    var boats = [{L: 2, home: 0.43, s: 0.1, face: 1, ph: 0.3}, {L: 3, home: 0.16, s: 0.16, face: -1, ph: 1.9}, {L: 3, home: 0.85, s: 0.15, face: 1, ph: 4.1}];
    var bState = boats.map(function (b) { return {x: b.home, Y: 0, ang: 0, va: 0, vx: 0, init: false}; });
    var bIdle = boats.map(function (b) { return {x: b.home, Y: 0, ang: 0, va: 0, vx: 0, init: false}; });
    var B0 = new Float32Array(12), B1 = new Float32Array(12);
    var tracks = {}, trackList = [], contacts = [], cellX = new Float32Array(BN), cellY = new Float32Array(BN), cellAt = -1e9;
    var mxs = new Float32Array(64), mws = new Float32Array(64), sharp = new Float32Array(64);
    var rekeys = 0, firstFrameMs = null, elapsed = 0, frames = 0, simAcc = 0, steps = 0, folds = 0, lastFold = -1e9, landings = 0, drags = 0, wakes = 0, touchesN = 0;
    var W = 0, H = 0, pxS = 1, aTex = null, aFb = null, dbgTex = null, dbgFb = null, hold = false;

    function alloc(w, h) {
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = []; dbgTex = dbgFb = null;
      W = w; H = h; pxS = w / 1280;
      aTex = texture(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, sized); aFb = target(aTex, sized);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---- the idle sea's two small curling breakers (a pure function of time, so the idle painting is always the same)
    function mkIdle(k) { return {idle: true, k: k, x: 0, dir: k ? -1 : 1, A: 0, curl: 0.55, seed: 3.1 + k * 5.3}; }
    function idleFrame(t) {
      for (var k = 0; k < 2; k++) {
        var ev = idleEv[k], P = 34 + k * 9, ph = (t / P + k * 0.47) % 1, env = Math.sin(Math.PI * ph);
        ev.dir = k ? -1 : 1;
        ev.x = k ? 0.9 - 0.32 * ph : 0.12 + 0.3 * ph;
        ev.A = 0.065 * env * env * (k ? 0.85 : 1);
        ev.curl = 0.35 + 0.35 * env;
        prep(ev);
      }
    }

    // ---- a great wave: derived shape parameters (shared by the CPU surface and the shader)
    function prep(ev) {
      var A = clamp(ev.A, 0, 0.85), cu = Math.max(0, ev.curl), c1 = Math.min(1, cu);
      ev.w = 0.05 + 0.27 * A;
      ev.wf = 0.62 - 0.3 * c1;
      ev.Cx = ev.x + ev.dir * ev.w * (CURL.cx0 + CURL.cx1 * c1);
      ev.CY = Y3 + A * (CURL.cy - CURL.cyc * c1);
      ev.R = Math.max(0.003, A * CURL.r);
      ev.ang = ev.dir * cu * TWIST;
      ev.clawK = clamp((cu - 0.05) / 0.5, 0.25, 1) * (ev.idle ? 0.45 : 1);
      ev.foamK = (ev.idle ? 0.5 : 0.55) + 0.45 * c1 + (ev.boost || 0);
    }
    function mound(ev, x) {
      var u = (x - ev.x) / ev.w * ev.dir; if (u < -3.2 || u > 3.2) return 0;
      var m = u < 0 ? Math.exp(-u * u) : Math.exp(-u * u / (ev.wf * ev.wf));
      return ev.A * (m - 0.16 * Math.exp(-(u - 1.5) * (u - 1.5) / 0.35));
    }

    // ---- the CPU profile: each layer's surface height per column (Y up), plus churn
    function simAt(arr, x) { var f = clamp((x + 0.1) / 1.2 * NS - 0.5, 0, NS - 1.001), i = f | 0, t = f - i; return arr[i] + (arr[i + 1] - arr[i]) * t; }
    function buildProfile(out, caused, t) {
      for (var L = 0; L < 4; L++) {
        var base = 1 - LAYER_Y[L], o = L * NC, sh = simH[L];
        for (var i = 0; i < NC; i++) {
          var x = -0.1 + 1.2 * (i + 0.5) / NC, v = base + swell(x, L, t);
          if (caused) v += simAt(sh, x);
          out[o + i] = v;
        }
      }
      var o3 = 3 * NC;
      for (var k = 0; k < 2; k++) addMound(out, o3, idleEv[k]);
      if (caused) for (var e = 0; e < events.length; e++) addMound(out, o3, events[e]);
      var o4 = 4 * NC;
      for (var j = 0; j < NC; j++) out[o4 + j] = caused ? simAt(churn, -0.1 + 1.2 * (j + 0.5) / NC) : 0;
    }
    function addMound(out, o, ev) {
      if (ev.A < 1e-4) return;
      var span = ev.w * 3.2, i0 = Math.max(0, Math.floor(((ev.x - span) + 0.1) / 1.2 * NC)), i1 = Math.min(NC - 1, Math.ceil(((ev.x + span) + 0.1) / 1.2 * NC));
      for (var i = i0; i <= i1; i++) out[o + i] += mound(ev, -0.1 + 1.2 * (i + 0.5) / NC);
    }
    function surfY(x, L, P) {                 // a layer's surface (Y up) at x, read from a built profile: exactly what is drawn
      P = P || prof;
      var f = clamp((x + 0.1) / 1.2 * NC - 0.5, 0, NC - 1.001), i = f | 0, t = f - i, o = L * NC;
      return P[o + i] + (P[o + i + 1] - P[o + i]) * t;
    }
    function colOf(x) { return clamp(Math.round((x + 0.1) / 1.2 * NS - 0.5), 0, NS - 1); }

    // ---- the water people stir: a 1D wave equation per layer, fixed steps
    function simStep(h) {
      var lin = LINGER;
      for (var L = 0; L < 4; L++) {
        var Hh = simH[L], V = simV[L], dx = 1.2 / NS, c = C_LAYER[L], k2 = c * c / (dx * dx) * h, dv = Math.exp(-h / (RIPPLE_S * lin)), dh = Math.exp(-h / (RIPPLE_S * lin * 3));
        var lim = SIM_LIM[L];
        for (var i = 0; i < NS; i++) {
          var l = i > 0 ? Hh[i - 1] : Hh[i], r = i < NS - 1 ? Hh[i + 1] : Hh[i];
          var vl = i > 0 ? V[i - 1] : V[i], vr = i < NS - 1 ? V[i + 1] : V[i];
          tmpV[i] = (V[i] + k2 * (l + r - 2 * Hh[i]) + VISC * (vl + vr - 2 * V[i])) * dv * (1 - 0.08 * sponge[i]);
        }
        for (var j = 0; j < NS; j++) { V[j] = Number.isFinite(tmpV[j]) ? clamp(tmpV[j], -2, 2) : 0; var hn = (Hh[j] + V[j] * h) * dh * (1 - 0.04 * sponge[j]); Hh[j] = lim * Math.tanh(hn / lim); }
      }
      var kc = Math.exp(-h / (CHURN_S * lin));
      var ct = 0.002 * h / lin; for (var m = 0; m < NS; m++) churn[m] = Math.max(0, churn[m] * kc - ct);
      steps++;
    }
    function kick(L, x, width, dv) {           // push the water of layer L down (dv > 0) or up around x
      var V = simV[L], i0 = colOf(x - width * 2.5), i1 = colOf(x + width * 2.5);
      for (var i = i0; i <= i1; i++) { var xx = -0.1 + 1.2 * (i + 0.5) / NS, g = Math.exp(-(xx - x) * (xx - x) / (width * width)); V[i] -= dv * g; }
    }
    function churnAdd(x, width, amt) {
      var i0 = colOf(x - width * 2.5), i1 = colOf(x + width * 2.5);
      for (var i = i0; i <= i1; i++) { var xx = -0.1 + 1.2 * (i + 0.5) / NS, g = Math.exp(-(xx - x) * (xx - x) / (width * width)); churn[i] = Math.min(1.5, churn[i] + amt * g); }
    }

    // ---- foam on the front water: x by depth below the surface
    function foamAdd(x, d0, d1, xr, amt) {
      if (!(amt > 0)) return;
      var i0 = Math.max(0, Math.floor((x - xr + 0.05) / 1.1 * FX)), i1 = Math.min(FX - 1, Math.ceil((x + xr + 0.05) / 1.1 * FX));
      var j0 = Math.max(0, Math.floor(d0 / FOAM_D * FD)), j1 = Math.min(FD - 1, Math.ceil(d1 / FOAM_D * FD));
      for (var i = i0; i <= i1; i++) {
        var xx = (i + 0.5) / FX * 1.1 - 0.05, g = 1 - Math.abs(xx - x) / Math.max(xr, 1e-3); if (g <= 0) continue; g = g * g * (3 - 2 * g);
        for (var j = j0; j <= j1; j++) { var q = i + j * FX, dj = (j1 > j0) ? 1 - 0.55 * (j - j0) / (j1 - j0) : 1; foam[q] = Math.min(1.25, foam[q] + amt * g * dj); }
      }
    }
    function foamStep(dt) {
      var k = Math.exp(-dt / (FOAM_S * LINGER)), tail = 0.004 * dt / LINGER;   // the last faint foam goes, not just fades
      // currents: water near a rolling wave moves with it (foam is carried along), elsewhere it drifts very slowly
      for (var i = 0; i < FX; i++) {
        var x = (i + 0.5) / FX * 1.1 - 0.05, u = 0.004 * Math.sin(elapsed * 0.05 + x * 3);
        for (var e = 0; e < events.length; e++) { var ev = events[e]; if (ev.phase < 2) continue; var du = (x - ev.x) / (ev.w * 1.6); u += ev.dir * ev.spd * 0.6 * Math.exp(-du * du); }
        var src = i - u * dt / (1.1 / FX), s0 = Math.floor(src), tt = src - s0, a0 = clamp(s0, 0, FX - 1), a1 = clamp(s0 + 1, 0, FX - 1);
        for (var j = 0; j < FD; j++) {
          var up = j > 0 ? j - 1 : 0, dn = j < FD - 1 ? j + 1 : j;
          var v = foam[a0 + j * FX] * (1 - tt) + foam[a1 + j * FX] * tt;
          var vs = (foam[i + up * FX] + foam[i + dn * FX]) * 0.5;
          foam2[i + j * FX] = Math.max(0, (v * 0.94 + vs * 0.06) * k - tail);
        }
      }
      var tmp = foam; foam = foam2; foam2 = tmp;
    }

    // ---- spray particles (window 0..1, y down)
    function emit(x, y, vx, vy, n, s0, s1) {
      for (var k = 0; k < n; k++) {
        if (sp.n >= MAXP) return;
        var i = sp.n++, a = Math.random(), b = Math.random();
        sp.x[i] = x + (Math.random() - 0.5) * 0.012; sp.y[i] = y + (Math.random() - 0.5) * 0.012;
        sp.vx[i] = vx[0] + (vx[1] - vx[0]) * a; sp.vy[i] = vy[0] + (vy[1] - vy[0]) * b;
        sp.age[i] = 0; sp.life[i] = 2.6 + Math.random() * 3.2; sp.size[i] = (s0 + (s1 - s0) * Math.random() * Math.random()) * (Math.random() < 0.18 ? -1.35 : 1); sp.seed[i] = Math.random() * 6.28;
      }
    }
    function sprayStep(dt) {
      var n = sp.n, i = 0;
      while (i < n) {
        sp.age[i] += dt;
        var big = Math.abs(sp.size[i]) / 10, drag = Math.exp(-dt * (1.1 + 1.6 / (0.3 + big)));
        sp.vy[i] = (sp.vy[i] + 0.6 * dt) * drag; sp.vx[i] *= drag;
        sp.vy[i] = Math.max(sp.vy[i], -1.5);
        sp.x[i] += (sp.vx[i] + 0.02 * Math.sin(sp.age[i] * 2.1 + sp.seed[i])) * dt; sp.y[i] += (sp.vy[i] + 0.035) * dt;
        var gone = sp.age[i] > sp.life[i] || sp.y[i] > 1.04 || sp.x[i] < -0.04 || sp.x[i] > 1.04;
        if (!gone && sp.vy[i] > -0.02 && sp.age[i] > 0.25) {
          var ys = 1 - surfY(sp.x[i], 3);
          if (sp.y[i] > ys + 0.006) { foamAdd(sp.x[i], 0, 0.012, 0.012, 0.05); gone = true; }
        }
        if (gone) { n--; sp.x[i] = sp.x[n]; sp.y[i] = sp.y[n]; sp.vx[i] = sp.vx[n]; sp.vy[i] = sp.vy[n]; sp.age[i] = sp.age[n]; sp.life[i] = sp.life[n]; sp.size[i] = sp.size[n]; sp.seed[i] = sp.seed[n]; }
        else i++;
      }
      sp.n = n;
    }

    // ---- great waves
    function maxA() { return Math.min(0.85, 0.72 * Math.max(1, HEIGHT)); }
    function liveWaves() { var n = 0; for (var i = 0; i < events.length; i++) if (events[i].A > 0.03 || events[i].phase < 2) n++; return n; }
    function summon(x, dir, E, owner, small) {
      x = clamp(x, 0.02, 0.98);
      for (var i = 0; i < events.length; i++) {           // feed a rising wave nearby rather than start another
        var e0 = events[i];
        if (e0.phase === 0 && Math.abs(e0.x - x) < 0.16) { e0.E += E; e0.fed = 0; if (!small) e0.small = false; if (owner && !e0.owner) e0.owner = owner; return e0; }
      }
      for (var j = 0; j < events.length; j++) if (events[j].phase === 1 && Math.abs(events[j].x - x) < 0.1) return null;   // that one is curling
      if (liveWaves() >= MAX_WAVES) {
        var weakest = -1, wa = 1e9;
        for (var k = 0; k < events.length; k++) if (events[k].phase === 2 && events[k].A < wa) { wa = events[k].A; weakest = k; }
        if (weakest < 0 || wa > 0.12) return null;
        events[weakest].fade = true;
      }
      var ev = {id: ++evId, x: x, dir: dir || (x < 0.5 ? 1 : -1), E: E, I: owner ? 0.3 : 1.2, A: 0.015, curl: 0, phase: 0, age: 0, fed: 0, owner: owner || 0,
        small: !!small, peak: 0, t2: 0, spd: 0, seed: Math.random() * 7, boost: 0, fade: false, idle: false};
      prep(ev); events.push(ev); summons++;
      return ev;
    }
    function lipPoints(ev, out) {              // where the crest's tip is drawn (window coords), forward-mapped through the twirl
      var asp = W / Math.max(1, H), n = 0;
      for (var s = -0.15; s <= 0.4; s += 0.11) {
        var x = ev.x + ev.dir * ev.w * s, Y = surfY(x, 3) + ev.A * 0.06;
        var px = x * asp - ev.Cx * asp, py = Y - ev.CY, r = Math.hypot(px, py), k = clamp(1 - r / ev.R, 0, 1), an = -ev.ang * Math.pow(k, CURL.fall);
        var cs = Math.cos(an), sn = Math.sin(an), fx = ev.Cx + (cs * px - sn * py) / asp, fy = ev.CY + sn * px + cs * py;
        out[n++] = [fx, 1 - fy];
      }
      return n;
    }
    var lipBuf = [];
    function crash(ev) {
      crashes++; ev.phase = 2; ev.peak = ev.A; ev.t2 = 0; ev.boost = 0.6; maxPeak = Math.max(maxPeak, ev.A);
      ev.spd = (ROLL_SPEED + 0.08 * ev.A) * (ev.small ? 0.6 : 1);
      var A = ev.A, n = lipPoints(ev, lipBuf), k = SPRAY * (ev.small ? 0.35 : 1);
      lastCrash = {x: +ev.x.toFixed(3), A: +A.toFixed(3), dir: ev.dir, t: +elapsed.toFixed(2)};
      for (var i = 0; i < n; i++) {
        var p = lipBuf[i];
        emit(p[0], p[1], [ev.dir * 0.05, ev.dir * (0.18 + 0.5 * A)], [-0.25 - 0.9 * A, 0.05], Math.round((14 + 80 * A) * k), 5, 12 + 10 * A);
      }
      var land = ev.x + ev.dir * ev.w * 0.9, ys = 1 - surfY(land, 3);       // the lip slams down: an explosion of spray and foam
      emit(land, ys, [ev.dir * 0.02, ev.dir * (0.25 + 0.4 * A)], [-0.35 - 1.3 * A, -0.1], Math.round((30 + 190 * A) * k), 5, 13 + 12 * A);
      foamAdd(ev.x + ev.dir * ev.w * 0.6, 0, 0.05 + 0.25 * A, ev.w * 1.3, 1.2);
      kick(3, land, ev.w * 0.7, 0.16 * A); kick(2, land, ev.w * 0.9, 0.05 * A); kick(1, land, ev.w, 0.012 * A);
      churnAdd(ev.x + ev.dir * ev.w * 0.5, ev.w * 1.1, 0.7 + 1.2 * A);
      for (var b = 0; b < boats.length; b++) {             // boats nearby are tossed
        var dx = bState[b].x - land; if (Math.abs(dx) < 0.3) { bState[b].va += (Math.random() < 0.5 ? -1 : 1) * (1 + 3 * A) * (1 - Math.abs(dx) / 0.3); bState[b].vx += ev.dir * A * 0.3; }
      }
    }
    function waveFrame(dt) {
      for (var i = events.length - 1; i >= 0; i--) {
        var ev = events[i], tr = ev.owner ? tracks[ev.owner] : null;
        ev.age += dt;
        if (ev.phase === 0) {
          var T = HEIGHT * (ev.small ? 0.055 + 0.04 * Math.min(ev.E, 1) : 0.16 + 0.58 * (1 - Math.exp(-ev.E / 1.1)) * (0.7 + 0.3 * Math.min(1, ev.I / 1.5)));   // how much you moved, and how hard
          ev.A += (Math.min(maxA(), T) - ev.A) * (1 - Math.exp(-dt / RISE_S));
          ev.curl += (0.16 - ev.curl) * (1 - Math.exp(-dt / 0.7));
          if (!body.fresh && tr) { /* a depth gap: hold, the person is probably still there */ }
          else if (tr && tr.drive > 0.06) {
            ev.fed = 0; ev.E += tr.drive * dt; ev.I = Math.max(ev.I * Math.exp(-dt / 2), tr.drive);
            if (Math.abs(tr.vs) > 0.07) ev.dir = tr.vs > 0 ? 1 : -1;
            var tx = tr.x - ev.dir * (BEHIND + 0.08 * ev.A) * clamp(Math.abs(tr.vs) / 0.12, 0, 1);
            ev.x += (tx - ev.x) * (1 - Math.exp(-dt / 0.35));
          } else ev.fed += dt;
          if (!ev.small && ev.A > 0.18 && Math.random() < dt * (10 + 40 * ev.A) * SPRAY) {      // spindrift blowing off the rising crest
            var cxp = ev.x + ev.dir * ev.w * 0.12, cyp = 1 - surfY(cxp, 3) - 0.01;
            emit(cxp, cyp, [ev.dir * 0.08, ev.dir * 0.3], [-0.28, -0.05], 2, 3, 8);
          }
          if (ev.fed > (ev.small ? 0.12 : LET_GO_S) || ev.age > (ev.small ? 0.6 : RISE_MAX_S)) {
            ev.phase = 1; ev.T = T;
            if (tr) { tr.cool = COOL_S; tr.ev = null; }
          }
        } else if (ev.phase === 1) {
          ev.curl += dt / (CURL_S * (ev.small ? 0.55 : 1));
          var T1 = ev.T || ev.A;
          ev.A += (Math.min(maxA(), T1 * 1.04) - ev.A) * (1 - Math.exp(-dt / 0.6));
          ev.x += ev.dir * (0.01 + 0.04 * ev.A) * dt * (0.4 + ev.curl);
          if (!ev.small && ev.curl > 0.45 && Math.random() < dt * (12 + 50 * ev.A) * SPRAY) {    // spray streaming off the curling lip
            var nl = lipPoints(ev, lipBuf), lp = lipBuf[nl - 1 - ((Math.random() * 2) | 0)];
            emit(lp[0], lp[1], [ev.dir * 0.1, ev.dir * 0.35], [-0.3, 0.05], 2, 4, 9);
          }
          if (ev.curl >= 1) crash(ev);
        } else {
          ev.t2 += dt;
          ev.curl = ev.t2 < 0.8 ? 1 + 0.35 * Math.sin(Math.min(1, ev.t2 / 0.8) * Math.PI * 0.5) : 1.35 - 0.5 * (1 - Math.exp(-(ev.t2 - 0.8) / 2.5));
          if (ev.t2 < 1.0) ev.A += (ev.peak * 0.5 - ev.A) * (1 - Math.exp(-dt / 0.4));
          else ev.A *= Math.exp(-dt / (SPEND_S * (ev.fade ? 0.25 : 1)));
          ev.boost = 0.6 * Math.exp(-ev.t2 / 1.5);
          ev.x += ev.dir * ev.spd * dt;
          var front = ev.x + ev.dir * ev.w * 0.45;            // the breaking front leaves foam and churn behind it
          foamAdd(front, 0, 0.02 + 0.28 * ev.A, ev.w * 0.5, (1.2 + 1.6 * ev.A) * dt * (ev.small ? 0.5 : 1));
          churnAdd(ev.x, ev.w * 0.8, (0.5 + 1.5 * ev.A) * dt);
          if (Math.random() < dt * (6 + 30 * ev.A) * SPRAY) { var ys = 1 - surfY(front, 3); emit(front, ys - ev.A * 0.15, [ev.dir * 0.05, ev.dir * 0.3], [-0.3 - 0.6 * ev.A, 0], 2, 3, 7); }
          kick(3, front, 0.04, 0.25 * ev.A * dt);
          if (ev.A < 0.008 || ev.x < -0.4 || ev.x > 1.4) { events.splice(i, 1); continue; }
        }
        prep(ev);
      }
    }

    // ---- people: each tracked by its body.js id; built-up movement summons and feeds that person's wave
    function refreshCells(now) {
      if (now - cellAt < 4000) return; cellAt = now;
      for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) {
        var s = kit.toScreen((x + 0.5) * 4, (y + 0.5) * 4), i = y * BW + x;
        if (s) { cellX[i] = s[0]; cellY[i] = s[1]; } else { cellX[i] = NaN; cellY[i] = NaN; }
      }
    }
    function fold(now) {
      folds++;
      var dtS = clamp((now - lastFold) / 1000, 0.001, 0.25); lastFold = now;
      refreshCells(now);
      var ppl = body.people, n = Math.min(ppl.length, 64), k, i, l, m, lab = body.label, mo = body.motion;
      for (k = 0; k < n; k++) { mxs[k] = 0; mws[k] = 0; sharp[k] = 0; }
      for (i = 0; i < BN; i++) {                // per person: where the movement is (an arm sweep's side) and how sharp it is
        l = lab[i]; if (l < 0 || l >= n) continue;
        m = mo[i]; if (m < 0.3) continue;
        if (m > 0.5) sharp[l] += (m - 0.5) / 0.5;
        if (cellX[i] === cellX[i]) { mxs[l] += m * cellX[i]; mws[l] += m; }
      }
      var here = {}; for (k = 0; k < n; k++) here[ppl[k].id] = true;
      for (k = 0; k < n; k++) {
        var p = ppl[k], s = kit.toScreen(p.cx * 512, p.cy * 424); if (!s) continue;
        var a = kit.toScreen(p.cx * 512, p.top * 424), b = kit.toScreen(p.cx * 512, p.bottom * 424), hh = a && b ? Math.max(0.15, b[1] - a[1]) : 0.6;
        var tr = tracks[p.id];
        if (!tr) {                              // the same person back after a short depth gap gets a new body.js id: keep their track
          var best = null, bd = 0.12;
          for (var q = 0; q < trackList.length; q++) { var o = trackList[q]; if (here[o.id] || now - o.seen > 700) continue; var od = Math.abs(o.x - s[0]); if (od < bd) { bd = od; best = o; } }
          if (best) {
            delete tracks[best.id];
            for (var e3 = 0; e3 < events.length; e3++) if (events[e3].owner === best.id) events[e3].owner = p.id;
            best.id = p.id; best.born = now; best.n = 0; best.drive = 0; tracks[p.id] = tr = best; rekeys++;
          }
        }
        if (!tr) { tr = tracks[p.id] = {id: p.id, x: s[0], y: s[1], h: hh, vx: 0, born: now, seen: now, charge: 0, drive: 0, act: 0, cool: 0, ev: null, mdx: 0, vs: 0, n: 0}; trackList.push(tr); }
        var raw = tr.n ? clamp((s[0] - tr.x) / dtS, -3, 3) : 0;
        tr.vx += (raw - tr.vx) * (1 - Math.exp(-dtS / 0.25));
        tr.vs += (raw - tr.vs) * (1 - Math.exp(-dtS / 0.8));                               // sustained travel (a sway averages out)
        tr.x = s[0]; tr.y = s[1]; tr.h += (hh - tr.h) * 0.3; tr.seen = now; tr.n++; tr.k = k;
        var age = (now - tr.born) / 1000, eff = p.moving - 0.95 * Math.exp(-age / 0.3);      // minus the fading echo of the arrival
        var actM = age < 0.3 ? 0 : clamp((eff - MOVE_FLOOR) / (MOVE_FULL - MOVE_FLOOR), 0, 1.5);
        var hc = Math.max(8, (p.bottom - p.top) * BH);
        var actS = age < 0.35 ? 0 : clamp((sharp[k] / (hc * hc) - SWEEP_FLOOR) / (SWEEP_FULL - SWEEP_FLOOR), 0, 1.5);
        var act = Math.max(actM, actS) + 0.25 * Math.min(actM, actS);
        var bh = Math.abs(tr.vx) * (W / Math.max(1, H)) / Math.max(0.15, tr.h);            // your own heights per second
        var spd = age < 0.3 ? 0 : clamp((bh - SPEED_FLOOR) / (SPEED_FULL - SPEED_FLOOR), 0, 1.5);
        tr.act = act; tr.drive = (act + spd) * SUMMON;
        tr.charge = tr.charge * Math.exp(-dtS / CHARGE_FADE_S) + tr.drive * dtS;
        if (mws[k] > 0.5) tr.mdx += ((mxs[k] / mws[k] - tr.x) - tr.mdx) * 0.3;
      }
      // the water a moving body stands in gets stirred (and a little foam)
      stirAcc.fill(0);
      for (i = 0; i < BN; i++) {
        l = lab[i]; if (l < 0 || l >= n) continue;
        m = mo[i]; if (m < 0.3) continue;
        var wx = cellX[i], wy = cellY[i]; if (wx !== wx) continue;
        var trk = tracks[ppl[l].id]; if (!trk || trk.act <= 0) continue;
        var ys = 1 - surfY(wx, 3);
        if (wy > ys - 0.05) {
          var w8 = m * Math.min(1, trk.act * 1.5);
          stirAcc[colOf(wx)] += w8;
          if (wy > ys - 0.01) foamAdd(wx, Math.max(0, wy - ys) * 0.6, Math.max(0, wy - ys) * 0.6 + 0.02, 0.01, w8 * 0.025);
        }
      }
      for (var c = 1; c < NS - 1; c++) {
        var st = (stirAcc[c - 1] + 2 * stirAcc[c] + stirAcc[c + 1]) * 0.25; if (!st) continue;
        simV[3][c] -= Math.min(0.02, STIR * 0.0012 * st); simV[2][c] -= Math.min(0.006, STIR * 0.0003 * st);
        churn[c] = Math.min(1.5, churn[c] + 0.0015 * st);
      }
    }
    function peopleFrame(dt, now) {
      for (var i = trackList.length - 1; i >= 0; i--) {
        var tr = trackList[i];
        if (now - tr.seen > 700) { if (tr.ev && tr.ev.owner === tr.id) tr.ev.owner = 0; delete tracks[tr.id]; trackList.splice(i, 1); continue; }   // gone (gaps under 0.7 s keep everything)
        tr.cool = Math.max(0, tr.cool - dt);
        if (!body.fresh) continue;
        if (tr.ev && (tr.ev.phase !== 0 || events.indexOf(tr.ev) < 0)) tr.ev = null;
        if (!tr.ev && tr.cool <= 0 && tr.charge >= SUMMON_AT && tr.drive > 0.1) {
          var dir = Math.abs(tr.vs) > 0.05 ? (tr.vs > 0 ? 1 : -1) : Math.abs(tr.mdx) > 0.03 ? (tr.mdx > 0 ? 1 : -1) : (tr.x < 0.5 ? 1 : -1);
          var ev = summon(tr.x - dir * BEHIND * clamp(Math.abs(tr.vs) / 0.12, 0, 1), dir, tr.charge, tr.id, false);
          if (ev) { tr.ev = ev; tr.charge = 0; }
        }
      }
    }

    // ---- fingertips: kit.fingers, kit.touches, touch() and Wake all arrive here
    function contact(x, y, now, st, src) {
      if (!(x >= -0.02 && x <= 1.02 && y >= -0.02 && y <= 1.02)) return;
      x = clamp(x, 0, 1); y = clamp(y, 0, 1);
      var best = null, bd = 0.085, win = src === 'wake' ? 450 : 280;
      for (var i = 0; i < contacts.length; i++) { var c = contacts[i]; if (now - c.t > win) continue; var d = Math.hypot((c.x - x) * 1.6, c.y - y) / 1.6; if (d < bd) { bd = d; best = c; } }
      if (best) drag(best, x, y, now, st); else { land(x, y, now, st); contacts.push({x: x, y: y, t: now, t0: now, ev: lastLand}); if (contacts.length > 24) contacts.shift(); }
    }
    var lastLand = null;
    function land(x, y, now, st) {
      landings++; st = Number.isFinite(st) ? clamp(st, 0.3, 2) : 1;
      var ys = 1 - surfY(x, 3), k = SPRAY;
      lastLand = null;
      if (y >= LOW_Y) lastLand = summon(x, x < 0.5 ? 1 : -1, TOUCH_E * st, 0, false);          // low on the wall: a great wave
      else summon(x, x < 0.5 ? 1 : -1, 0.6, 0, true);                                         // high: a small breaker below
      var sy = y < ys ? y : ys;
      emit(x, sy, [-0.12, 0.12], [-0.55 * st, -0.15], Math.round(26 * k * st), 4, 10);
      kick(3, x, 0.025, 0.06 * st); foamAdd(x, 0, 0.03, 0.025, 0.6 * st); churnAdd(x, 0.03, 0.4);
    }
    function drag(c, x, y, now, st) {
      var dtS = Math.max(0.016, (now - c.t) / 1000), dx = x - c.x, dist = Math.hypot(dx * 1.6, y - c.y) / 1.6, speed = dist / dtS;
      c.x = x; c.y = y; c.t = now;
      if (speed < 0.06) return;
      drags++;
      var ys = 1 - surfY(x, 3);
      if (Math.random() < 0.6) emit(x, Math.min(y, ys), [dx > 0 ? 0 : -0.15, dx > 0 ? 0.15 : 0], [-0.35, -0.05], Math.round(3 * SPRAY), 3, 8);
      kick(3, x, 0.025, Math.min(0.03, speed * 0.015)); foamAdd(x, 0, 0.02, 0.02, Math.min(0.3, speed * 0.1));
      var ev = c.ev && events.indexOf(c.ev) >= 0 && c.ev.phase === 0 ? c.ev : null;
      if (!ev && y >= LOW_Y) { for (var i = 0; i < events.length; i++) if (events[i].phase === 0 && Math.abs(events[i].x - x) < 0.18) ev = events[i]; }
      if (ev) { ev.E += Math.min(0.8, dist * 6) * (st || 1); ev.I = Math.max(ev.I, Math.min(2.5, speed * 2)); ev.fed = 0; if (Math.abs(dx) > 0.004) ev.dir = dx > 0 ? 1 : -1; ev.x += (x - ev.x) * 0.25; c.ev = ev; }
    }
    function fingersFrame(now) {
      var f = kit.fingers, pts = (f && Array.isArray(f.pts) && Date.now() - f.t <= 160) ? f.pts : null, n = 0, i;
      if (pts) for (i = 0; i < pts.length && n < 10; i++) { var p = pts[i]; if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) { contact(p[0], p[1], now, 1, 'finger'); n++; } }
      var tips = kit.touches || [], tn = Date.now();
      for (i = 0; i < tips.length; i++) if (tn - tips[i].t < 200) contact(tips[i].x, tips[i].y, now, 1, 'tip');
      for (i = contacts.length - 1; i >= 0; i--) if (now - contacts[i].t > 1200) contacts.splice(i, 1);
    }

    // ---- boats ride the drawn surface and get tossed
    function boatFrame(states, P, caused, dt) {
      var asp = W / Math.max(1, H);
      for (var b = 0; b < boats.length; b++) {
        var bt = boats[b], s = states[b], hx = bt.home + 0.03 * Math.sin(elapsed * 0.027 + bt.ph);
        if (caused) for (var e = 0; e < events.length; e++) { var ev = events[e]; if (ev.phase < 1) continue; var u = (s.x - ev.x) / ev.w * ev.dir; if (u > -1.2 && u < 0.8) s.vx += ev.dir * ev.A * 0.35 * dt; }
        s.vx *= Math.exp(-dt / 1.4); s.x += s.vx * dt + (hx - s.x) * (1 - Math.exp(-dt / 6)); s.x = clamp(s.x, 0.06, 0.94);
        var base = 1 - LAYER_Y[bt.L], Y = surfY(s.x, bt.L, P), dx = 0.012, sl = (surfY(s.x + dx, bt.L, P) - surfY(s.x - dx, bt.L, P)) / (2 * dx) / asp;
        Y = Math.min(Y, base + 0.28) + bt.s * asp * 0.012;
        var ta = clamp(Math.atan(sl) * 0.85, -0.6, 0.6);
        if (!s.init) { s.Y = Y; s.ang = ta; s.init = true; }
        s.va += ((ta - s.ang) * 55 - s.va * 6.5) * dt; s.ang = clamp(s.ang + s.va * dt, -0.75, 0.75); if (Math.abs(s.ang) >= 0.75) s.va *= -0.3;
        s.Y += (Y - s.Y) * (1 - Math.exp(-dt / 0.04));
      }
    }
    function packBoats(states) {
      for (var b = 0; b < boats.length; b++) {
        var s = states[b], bt = boats[b];
        B0[b * 4] = s.x; B0[b * 4 + 1] = s.Y; B0[b * 4 + 2] = s.ang; B0[b * 4 + 3] = bt.s * (W / Math.max(1, H));
        B1[b * 4] = bt.L; B1[b * 4 + 1] = elapsed * 1.25 + bt.ph; B1[b * 4 + 2] = bt.face; B1[b * 4 + 3] = 0;
      }
    }
    function packEvents() {
      var n = 0;
      function put(ev) { if (n >= MAXE) return; var o = n * 4;
        E0[o] = ev.x; E0[o + 1] = ev.A; E0[o + 2] = ev.w; E0[o + 3] = ev.dir;
        E1[o] = ev.Cx; E1[o + 1] = ev.CY; E1[o + 2] = ev.R * (W / Math.max(1, H)) / (W / Math.max(1, H)); E1[o + 3] = ev.ang;
        E2[o] = ev.clawK; E2[o + 1] = ev.foamK; E2[o + 2] = ev.wf; E2[o + 3] = ev.seed; n++; }
      put(idleEv[0]); put(idleEv[1]); nIdle = n;
      for (var i = 0; i < events.length; i++) put(events[i]);
      nAll = n;
    }

    function uploadBody() {
      var m = body.mask, any = false;
      for (var i = 0; i < BN; i++) { var v = m[i] > 0 ? Math.round(Math.min(1, m[i]) * 255) : 0; bodyBytes[i] = v; if (v) any = true; }
      gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, bodyBytes);
      bodyShown = any;
    }
    function uploadFoam() {
      for (var i = 0; i < foam.length; i++) foamBytes[i] = Math.min(255, Math.round(foam[i] * 200));
      gl.bindTexture(gl.TEXTURE_2D, foamTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FX, FD, gl.RED, gl.UNSIGNED_BYTE, foamBytes);
    }

    // ---- drawing
    function draw(fb, caused) {
      var asp = W / Math.max(1, H);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, aFb); gl.viewport(0, 0, W, H);
      var u = P1.u; gl.useProgram(P1.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, caused ? profTex : profIdleTex); gl.uniform1i(u.uProf, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, foamTex); gl.uniform1i(u.uFoam, 1);
      gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uT, elapsed); gl.uniform1f(u.uAsp, asp); gl.uniform1f(u.uPx, 1 / Math.max(1, H));
      gl.uniform1f(u.uCaused, caused ? 1 : 0); gl.uniform1f(u.uNC, NC); gl.uniform1f(u.uFall, CURL.fall); gl.uniform1f(u.uClaw, CURL.claw); gl.uniform4f(u.uSpk, CURL.sw, CURL.sp, CURL.f1, CURL.f2); gl.uniform4f(u.uSpk2, CURL.band, CURL.o2, CURL.f3, CURL.o3); gl.uniform2f(u.uWin, CURL.w0, CURL.w1);
      gl.uniform1i(u.uNE, caused ? nAll : nIdle); gl.uniform4fv(u.uE0, E0); gl.uniform4fv(u.uE1, E1); gl.uniform4fv(u.uE2, E2);
      packBoats(caused ? bState : bIdle); gl.uniform4fv(u.uB0, B0); gl.uniform4fv(u.uB1, B1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, W, H);
      u = P2.u; gl.useProgram(P2.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, aTex); gl.uniform1i(u.uA, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 1);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv()); gl.uniform2f(u.uRes, W, H);
      gl.uniform2f(u.uReg, REG_PX[0] * pxS / W, -REG_PX[1] * pxS / H);
      gl.uniform1f(u.uInside, INSIDE); gl.uniform1f(u.uBodyOn, caused && bodyShown && body.regOk ? 1 : 0); gl.uniform1f(u.uPxS, pxS);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (caused && sp.n) {
        var n = sp.n;
        for (var i = 0; i < n; i++) {
          var o = i * 4, a = sp.age[i], lf = sp.life[i];
          sprayData[o] = sp.x[i]; sprayData[o + 1] = sp.y[i]; sprayData[o + 2] = sp.size[i];
          sprayData[o + 3] = Math.min(1, a / 0.08) * Math.min(1, (lf - a) / 0.6);
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, sprayBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sprayData, 0, n * 4); gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        u = PS.u; gl.useProgram(PS.p); gl.bindVertexArray(sprayVao);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 1);
        gl.uniformMatrix3fv(u.uHinv, false, body.hinv()); gl.uniform1f(u.uInside, INSIDE); gl.uniform1f(u.uBodyOn, bodyShown && body.regOk ? 1 : 0); gl.uniform1f(u.uPxS, pxS);
        gl.drawArrays(gl.POINTS, 0, n);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    }

    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); frames++;
      if (canvas.width !== W || canvas.height !== H) alloc(canvas.width, canvas.height);
      if (dt > 0 && !hold) {
        elapsed += dt;
        if (body.update(dt, now)) { fold(now); uploadBody(); }
        else if (!body.fresh && bodyShown) uploadBody();
        fingersFrame(now);
        peopleFrame(dt, now);
        idleFrame(elapsed);
        waveFrame(dt);
        simAcc = Math.min(simAcc + dt, STEP * MAX_STEPS);
        while (simAcc >= STEP) { simStep(STEP); simAcc -= STEP; }
        foamAcc += dt; if (foamAcc >= 1 / 30) { foamStep(foamAcc); foamAcc = 0; uploadFoam(); }
        buildProfile(prof, true, elapsed);
        sprayStep(dt);
        boatFrame(bState, prof, true, dt);
        buildProfile(profIdle, false, elapsed);
        boatFrame(bIdle, profIdle, false, dt);
        packEvents();
        gl.bindTexture(gl.TEXTURE_2D, profTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NC, 5, gl.RED, gl.FLOAT, prof);
        gl.bindTexture(gl.TEXTURE_2D, profIdleTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NC, 5, gl.RED, gl.FLOAT, profIdle);
      } else if (!frames || nAll === 0) {
        idleFrame(elapsed); buildProfile(prof, true, elapsed); buildProfile(profIdle, false, elapsed); packEvents();
        boatFrame(bState, prof, true, 0); boatFrame(bIdle, profIdle, false, 0);
        gl.bindTexture(gl.TEXTURE_2D, profTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NC, 5, gl.RED, gl.FLOAT, prof);
        gl.bindTexture(gl.TEXTURE_2D, profIdleTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NC, 5, gl.RED, gl.FLOAT, profIdle);
      }
      draw(null, true);
      if (firstFrameMs === null) firstFrameMs = Math.round(performance.now() - t0);
    }

    function touch(t) { if (!t || destroyed) return; touchesN++; contact(t.x, t.y, performance.now(), 1, 'touch'); }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      wakes++;
      var st = Number.isFinite(strength) && strength > 0 ? clamp(strength <= 0.2 ? strength / WAKE_UNIT : strength, 0.4, 2) : 1;
      contact(sx, sy, performance.now(), st, 'wake');
    }
    var KNOBS = {height: [0.4, 1.6, function (v) { HEIGHT = v; }, function () { return HEIGHT; }],
      summon: [0.3, 3, function (v) { SUMMON = v; }, function () { return SUMMON; }],
      linger: [0.3, 2.5, function (v) { LINGER = v; }, function () { return LINGER; }],
      spray: [0, 2, function (v) { SPRAY = v; }, function () { return SPRAY; }],
      inside: [0, 1, function (v) { INSIDE = v; }, function () { return INSIDE; }]};
    function settings() { var o = {}; Object.keys(KNOBS).forEach(function (k) { o[k] = KNOBS[k][3](); }); return o; }
    function set(v) {
      if (v && typeof v === 'object' && !destroyed) Object.keys(KNOBS).forEach(function (k) { var x = Number(v[k]); if (v[k] !== undefined && v[k] !== null && Number.isFinite(x)) KNOBS[k][2](clamp(x, KNOBS[k][0], KNOBS[k][1])); });
      return settings();
    }

    function energy() {
      var se = 0, fo = 0, fm = 0, ch = 0, i, L;
      for (L = 0; L < 4; L++) { var Hh = simH[L], V = simV[L], c = C_LAYER[L]; for (i = 0; i < NS; i++) se += Hh[i] * Hh[i] + V[i] * V[i] / (c * c * 400); }
      for (i = 0; i < foam.length; i++) { fo += foam[i]; if (foam[i] > fm) fm = foam[i]; }
      for (i = 0; i < NS; i++) ch += churn[i];
      var wa = 0; for (i = 0; i < events.length; i++) wa += events[i].A;
      se = se / (4 * NS) * 1e4; fo /= foam.length; ch /= NS;
      return {total: +(se + fo * 20 + ch * 2 + wa * 10 + sp.n / 200).toFixed(4), sim: +se.toFixed(4), foam: +fo.toFixed(4), foamMax: +fm.toFixed(3), churn: +ch.toFixed(4), waves: +wa.toFixed(3), spray: sp.n};
    }
    function readDiff(box) {                   // sandbox only: this frame against the idle painting at the same instant
      if (!dbgFb) { dbgTex = texture(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, sized); dbgFb = target(dbgTex, sized); }
      var a = new Uint8Array(W * H * 4), b = new Uint8Array(W * H * 4);
      draw(dbgFb, true); gl.bindFramebuffer(gl.FRAMEBUFFER, dbgFb); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a);
      draw(dbgFb, false); gl.bindFramebuffer(gl.FRAMEBUFFER, dbgFb); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      var bx = box || [0, 0, 1, 1], x0 = Math.floor(bx[0] * W), x1 = Math.ceil(bx[2] * W), y0 = Math.floor(bx[1] * H), y1 = Math.ceil(bx[3] * H);
      var nb = 0, n25 = 0, n15 = 0, sx = 0, sy = 0, sw = 0, all25 = 0, la = 0, lb = 0;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var i = ((H - 1 - y) * W + x) * 4;
        var A = a[i] * 0.2126 + a[i + 1] * 0.7152 + a[i + 2] * 0.0722, B = b[i] * 0.2126 + b[i + 1] * 0.7152 + b[i + 2] * 0.0722;
        var d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        la += A; lb += B;
        if (d > 25) { all25++; sx += x * d; sy += y * d; sw += d; }
        if (x >= x0 && x < x1 && y >= y0 && y < y1) { nb++; if (d > 25) n25++; if (d > 15) n15++; }
      }
      return {frac25: +(n25 / Math.max(1, nb)).toFixed(4), frac15: +(n15 / Math.max(1, nb)).toFixed(4), n25all: all25,
        cx: sw ? +(sx / sw / W).toFixed(3) : null, cy: sw ? +(sy / sw / H).toFixed(3) : null, lumCaused: +(la / (W * H)).toFixed(1), lumIdle: +(lb / (W * H)).toFixed(1)};
    }
    if (window.WallTest) window.__hokusaiDebug = function (o) {
      o = o || {};
      if (o.hold !== undefined) hold = !!o.hold;
      if (o.tune) { Object.keys(o.tune).forEach(function (k) { if (k === 'twist') TWIST = o.tune[k]; else CURL[k] = o.tune[k]; }); events.forEach(prep); }
      if (o.spawn) { var ev = summon(o.spawn.x, o.spawn.dir, o.spawn.E || 1, 0, !!o.spawn.small); if (ev && o.spawn.A !== undefined) { ev.A = o.spawn.A; ev.curl = o.spawn.curl || 0; ev.phase = o.spawn.phase || 0; ev.E = 50; prep(ev); } }
      if (o.setEv) { var e2 = events[o.setEv.i || 0]; if (e2) { if (o.setEv.A !== undefined) e2.A = o.setEv.A; if (o.setEv.curl !== undefined) e2.curl = o.setEv.curl; if (o.setEv.x !== undefined) e2.x = o.setEv.x; prep(e2); buildProfile(prof, true, elapsed); packEvents(); gl.bindTexture(gl.TEXTURE_2D, profTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NC, 5, gl.RED, gl.FLOAT, prof); } }
      var out = {frames: frames, elapsed: +elapsed.toFixed(2), steps: steps, folds: folds, fresh: body.fresh, regOk: body.regOk, present: body.present,
        energy: energy(), summons: summons, crashes: crashes, maxPeak: +maxPeak.toFixed(3), lastCrash: lastCrash,
        waves: events.map(function (e) { return {id: e.id, x: +e.x.toFixed(3), A: +e.A.toFixed(3), curl: +e.curl.toFixed(2), phase: e.phase, dir: e.dir, E: +e.E.toFixed(2), small: e.small, owner: e.owner}; }),
        people: trackList.map(function (t) { return {id: t.id, x: +t.x.toFixed(3), vx: +t.vx.toFixed(3), vs: +t.vs.toFixed(3), h: +t.h.toFixed(2), act: +t.act.toFixed(2), drive: +t.drive.toFixed(2), charge: +t.charge.toFixed(2), cool: +t.cool.toFixed(2)}; }),
        boats: bState.map(function (s, b) { return {x: +s.x.toFixed(3), y: +(1 - s.Y).toFixed(4), surf: +(1 - surfY(s.x, boats[b].L)).toFixed(4), ang: +s.ang.toFixed(2)}; }),
        landings: landings, drags: drags, wakes: wakes, touches: touchesN, settings: settings(), glError: gl.getError(), startupMs: startupMs, firstFrameMs: firstFrameMs, rekeys: rekeys};
      if (o.diff) out.diff = readDiff(o.diff === true ? null : o.diff);
      return out;
    };
    function destroy() {
      if (destroyed) return; destroyed = true; kit.wantDepth(false);
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
      if (window.HokusaiSet === set) delete window.HokusaiSet;
      if (window.HokusaiWake === wake) delete window.HokusaiWake;
      if (window.__hokusaiDebug) try { delete window.__hokusaiDebug; } catch (e) { window.__hokusaiDebug = undefined; }
    }

    kit.wantDepth(true);
    window.HokusaiSet = set;
    window.HokusaiWake = wake;
    if (window._hokusaiFx) set(window._hokusaiFx);
    alloc(canvas.width, canvas.height);
    idleFrame(0); buildProfile(prof, true, 0); buildProfile(profIdle, false, 0); packEvents();
    var startupMs = Math.round(performance.now() - t0);
    return {frame: frame, touch: touch, resize: function (w, h) { if (w !== W || h !== H) alloc(w, h); }, destroy: destroy};
  }
})();
