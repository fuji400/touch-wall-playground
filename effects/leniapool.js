/* Lenia Pool — soft living creatures follow still people (2026-10-05; fx-research concept #13, built by Claude (fx-batch)).
 *
 * A dark pool where a few soft, glowing, jelly-like creatures swim, like plankton under a darkfield microscope. They are real
 * Lenia creatures (a continuous cellular automaton): each is a living pattern that holds itself together and glides.
 * Stand still and golden food glints along your outline; creatures nearby turn toward you, swim over and circle your
 * outline in a slow procession, feeding: they swell, glow gold and pulse. Move and they lose interest, turn away and drift off
 * (a moving arm passes through a creature; only a still body sitting on one dissolves it). A fingertip buds a new creature.
 * A creature that fed on someone keeps an amber heart for a long time after. Two creatures that swim into each other become
 * one. Each creature has its own hue in a cool sea range. Nothing is projected inside a person (DARK_INSIDE).
 *
 * How: Lenia (Bert Chan; the Orbium regime: ring kernel R = 13, mu 0.15, sigma 0.015) on a 237 x 160 float grid with a hidden
 * margin; it wraps like a torus, so creatures leave one edge and come back on the other. The pool is stepped STEPS_PER_S
 * times a second (fixed steps, interpolated for display). A creature is moved two ways, both gentle enough that it survives:
 * the water carries it (semi-Lagrangian, Catmull-Rom: bilinear smears creatures to death), and a small vortex turns it
 * (rotation <= 0.02 rad per step). A creature keeps swimming the way it faces, so turning it is how it chooses where to go:
 * to a still person, around their outline, away from movement, away from other creatures, or a slow meander.
 * Every 0.2 s the pool is summed into 4 x 4 blocks on the GPU and read back without stalling (pixel buffer + fence): mass,
 * centre and a second moment (the dense core sits at the front, so it gives the heading). The piece tracks creatures from
 * that, decides where each wants to go and sets its vortex; the same readback is the watchdog: too few creatures and a new one
 * swims in from the hidden edge; two that merged (mass running away) dissolve and one re-forms; too much mass and the pool
 * starves a little. Only a calm body pushes creatures out of itself and dissolves one left inside; a moving body passes through.
 * Body: plugins/body.js (WallBody), unmodified. This piece computes from it, per fresh depth frame (CPU, 128 x 106): its own
 * people tracks with stillness hysteresis (the stage's 'still' resets on Kinect wobble), a distance-to-nearest-person field
 * that carries which person is nearest, local fright where a body cell changed a lot at once, and a hold through depth stalls.
 * The one creature pattern was settled on this exact grid from the published Orbium (Chakazul/Lenia, MIT).
 * WebGL 2 + EXT_color_buffer_float, no assets, no audio, one depth client (via the host).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  // the pool
  var VISIBLE_ROWS = 128;     // simulation cells from the top of the picture to the bottom (square cells, ~6 px on a 1280x800 wall)
  var MARGIN_CELLS = 16;      // hidden water around the picture: a creature swims out of view and comes back on the far side
  var STEPS_PER_S = 24;       // simulation steps per wall second: creature speed (one step moves a creature ~1/3 cell)
  var MAX_STEPS = 3;          // most steps in one picture frame (a slow frame never makes a burst)
  var CREATURES = 7;          // creatures the empty pool keeps (a new one swims in from the edge when it drops below)
  var RESEED_S = 3;           // ...at most one new creature this often (seconds)
  var MAX_MASS = 14;          // living mass (in creatures) above which the whole pool starves a little (stops explosions)
  var WANDER = 0.12;          // free creatures meander: their slow, ever-changing turn (radians per second)
  var TURN = 0.45;            // how fast a creature can turn to swim where it wants (radians per second; above ~0.5 they fall apart)
  // people
  var STILL_MOVE = 0.06;      // a person whose movement (0..1, the stage's 'moving') stays under this counts as still...
  var MOVED_MOVE = 0.12;      // ...and over this as moving (in between drains the stillness slowly; real Kinect wobble is 0.01-0.08)
  var CALM_START_S = 0.4;     // still this long and creatures start to come...
  var CALM_FULL_S = 1.4;      // ...and this long for the full pull
  var REACH = 50;             // how far away a still person is noticed (Kinect cells, ~10 px each)
  var SETTLE = 8;             // creatures circle this far outside the outline (Kinect cells; a creature is ~12 across)
  var PULL = 0.12;            // the water also drifts toward a still person (cells per step; the water never runs over 0.22)
  var FOOD = 0.14;            // nutrient on a still outline: creatures touching it swell, turn amber and pulse
  var SCARE = 0.06;           // a gentle push away from a moving person (cells per step; at 0.24+ the push tore creatures apart)
  var SCARE_REACH = 14;       // ...how far the fright reaches (Kinect cells)
  var SCARE_FADE_S = 0.8;     // ...and how long it lasts after you stop
  var FRIGHT_S = 2.5;         // a frightened creature keeps swimming away this long
  var SWEEP = 0.75;           // a body cell that changed this much at once (a real arm sweep; noise is ~0.3-0.5) frightens creatures right there
  var BIG = 1.6;              // a blob heavier than this many creatures whose mass then runs away (dying or boiling over) is two
                              // that merged: it dissolves and one creature re-forms (two healthy neighbours hold steady and are left alone)
  var PER_PERSON = 3;         // most creatures one person can hold (the rest of the pool stays free)
  var BORED_S = 35;           // something perfectly still for this long (a chair) slowly loses its creatures...
  var BORED_FADE_S = 10;      // ...over about this long; any movement re-arms it
  var HOLD_S = 0.7;           // the Kinect may stall this long without anything being forgotten
  // fingertips
  var TIP_REPEAT_S = 1.2;     // a fingertip held or dragged on the wall buds another creature at most this often
  // look
  var IDLE_LIGHT = 1.0;       // brightness of a free creature...
  var IDLE_CAP = 57;          // ...and the ceiling it never passes (0-255, a soft knee; the participants' light is far brighter)
  var FED_GLOW = 3.5;         // extra light of a feeding creature (x its idle light)
  var WARM_MEMORY_S = 40;     // how long a creature keeps the amber heart of someone it fed on (seconds, time constant)
  var RIM = 1.0;              // the thin line along a person's outline (cool while moving, warm when still)
  var NUTRIENT = 1.0;         // the golden food glinting around a still outline
  var WATER = 1.0;            // the faint drifting motes in the water
  var DARK_INSIDE = 1.0;      // no light inside a person (1 = none, 0 = off)

  registerWallPlugin({id: 'leniapool', title: 'Lenia Pool', author: 'Claude (fx-batch), fx-research concept #13', create: create});

  // Lenia rule (Orbium regime). Do not change without re-settling the creature below.
  var RADIUS = 13, MU = 0.15, SIGMA = 0.015, LENIA_DT = 0.05, RR = RADIUS;
  var FAR = 60, MAX_VORT = 16, AVOID = 64, BLK = 4, BLK_MIN = 0.6;   // BLK x BLK cell blocks; one with less living mass than BLK_MIN does not join creatures
  // one creature (Orbium), settled on this grid at dt 0.05: 32 x 32 cells, rows bottom-up, 0..1 in 1/255 steps (hex)
  var ORB_HEX = '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010100000000000000000000000000000000000000000000000000000007161f23221c1207000000000000000000000000000000000000000000000320323b4449494336251000000000000000000000000000000000000000000633383642596c6f6759473014000000000000000000000000000000000000003f361f2242789894887b664c300e000000000000000000000000000000000035450900084ba9bca29a99825e442702000000000000000000000000000000007b0700000070e7c799a0b5945d4438110000000000000000000000000000003c5300000000a5ffc093b4d89646313924000000000000000000000000000000c1000000000dd3ffc2aeebf16f1e152e33000000000000000000000000000000c30000000034d2e4bedbffc2270000233e00000000000000000000000000004b5f000000005fb8aaa5e1e55a0000001f4700000000000000000000000000009b35090000007a9d7990c39b000000002c47000000000000000000000000000051281e000000626956899829000000005d1e000000000000000000000000002200142a1602194c323c72640000000000ab00000000000000000000000000001600001e2b1e454113304b00000000004d6a0000000000000000000000000000000000031e2c6e472647330000000016d50000000000000000000000000000000000000000486f46526b25120f14273f7900000000000000000000000000000000000000002e36295c652b2b2a28227e0000000000000000000000000000000000000000001200093f2b0d100d0200580000000000000000000000000000000000000000000000000f00000000000000000000000000000000000000000000000000000000000000000000000000190000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
  var ORB_MASS = 70.5, ORB_HEADING = -1.1858, ORB_SPEED = 0.3289;   // its mass, the way it swims (radians, y up), cells per step

  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var HEAD = '#version 300 es\nprecision highp float; precision highp int; precision highp sampler2D;\n';
  var NOISE = 'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' +
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}\n';
  // body texture (Kinect space): r = person (labelled people only), g = signed distance to the nearest person's outline (Kinect
  // cells, - inside), b = that person's calm (+ while they still want creatures, - when they have enough), a = fright (0..1)
  var BODY = 'uniform sampler2D uB; uniform mat3 uHinv; uniform float uFar;\n' +
    'vec4 bodyAt(vec2 w){ vec3 h=uHinv*vec3(w,1.); vec2 k=h.xy/max(h.z,1e-6);\n' +
    '  if(h.z<=0.||k.x<0.||k.x>1.||k.y<0.||k.y>1.) return vec4(0.,uFar,0.,0.); return texture(uB,k); }\n';

  // the water, once per picture frame (sim cells): r,g = how it carries creatures (cells per step), b = food, a = harm
  var ENV_FS = HEAD + NOISE + BODY +
    'uniform vec2 uSim; uniform vec4 uMap; uniform float uPull, uReach, uSettle, uScare, uFood, uMaxV;\n' +
    'uniform int uNV, uNS; uniform vec4 uVo[' + MAX_VORT + '], uSv[6]; out vec4 o;\n' +
    'vec2 winOf(vec2 fc){ return vec2((fc.x/uSim.x-uMap.x)/uMap.z, 1.-(fc.y/uSim.y-uMap.y)/uMap.w); }\n' +
    'void main(){ vec2 fc=gl_FragCoord.xy;\n' +
    '  vec4 b=bodyAt(winOf(fc)), bx1=bodyAt(winOf(fc+vec2(2.,0.))), bx0=bodyAt(winOf(fc-vec2(2.,0.))), by1=bodyAt(winOf(fc+vec2(0.,2.))), by0=bodyAt(winOf(fc-vec2(0.,2.)));\n' +
    '  vec2 gd=vec2(bx1.g-bx0.g,by1.g-by0.g); float gn=length(gd); vec2 n=gn>1e-4?gd/gn:vec2(0.);\n' +   // n: away from the nearest person
    '  float d=b.g, att=max(b.b,0.), calm=abs(b.b);\n' +
    '  float prof=clamp((d-uSettle)/3.,-1.,1.)*(1.-smoothstep(uReach*.6,uReach,d));\n' +
    '  float still=smoothstep(.3,.8,abs(b.b));\n' +   // only a calm (still) body pushes and harms: a moving arm passes through a creature
    '  vec2 v=-n*uPull*att*prof + n*uPull*2.*smoothstep(.3,.7,b.r)*still;\n' +           // toward a still person; out of a still body
    '  for(int i=0;i<' + MAX_VORT + ';i++){ if(i>=uNV) break; vec2 dd=fc-uVo[i].xy; dd-=uSim*floor(dd/uSim+.5);\n' +   // each creature turns where it wants to go
    '    v+=uVo[i].z*vec2(-dd.y,dd.x)*(1.-smoothstep(uVo[i].w,uVo[i].w*1.6,length(dd))); }\n' +
    '  v+=n*uScare*smoothstep(.02,.25,b.a);\n' +   // a gentle flinch away from movement (they flee mostly by turning and swimming)
    '  float sp=length(v); if(sp>uMaxV) v*=uMaxV/sp;\n' +
    '  float st=0.; for(int i=0;i<6;i++){   ' +   // two creatures that merged: dissolve the mass (one re-forms)
    ' if(i>=uNS) break; vec2 dd=fc-uSv[i].xy; dd-=uSim*floor(dd/uSim+.5); st+=uSv[i].z*(1.-smoothstep(uSv[i].w,uSv[i].w+6.,length(dd))); }\n' +
    '  float fr=exp(-pow((d-uSettle*.55)/(uSettle*.5),2.))*smoothstep(-.5,1.,d);\n' +
    '  o=vec4(v, uFood*calm*fr*(1.-smoothstep(.3,.6,b.r)), smoothstep(.35,.7,b.r)*still+st); }\n';   // harm: inside a still person (and a merge dissolving)

  // carry creatures and their memory along the water. A: Catmull-Rom (bilinear blurs the creatures to death); memory: bilinear
  var ADV_FS = HEAD + 'uniform sampler2D uA, uM, uE; uniform vec2 uSim; layout(location=0) out float oA; layout(location=1) out vec4 oM;\n' +
    'vec4 crw(float t){ float t2=t*t, t3=t2*t; return vec4(-.5*t3+t2-.5*t, 1.5*t3-2.5*t2+1., -1.5*t3+2.*t2+.5*t, .5*t3-.5*t2); }\n' +
    'void main(){ vec2 fc=gl_FragCoord.xy; vec2 v=texelFetch(uE,ivec2(fc),0).rg, p=fc-v; oM=texture(uM,p/uSim);\n' +
    '  if(dot(v,v)<1e-8){ oA=texelFetch(uA,ivec2(fc),0).r; return; }\n' +
    '  vec2 b=floor(p-.5), f=p-.5-b; vec4 wx=crw(f.x), wy=crw(f.y); float a=0., lo=1., hi=0.;\n' +
    '  for(int j=0;j<4;j++){ float r=0.; for(int i=0;i<4;i++){ float s=texture(uA,(b+vec2(float(i)-.5,float(j)-.5))/uSim).r; r+=wx[i]*s;\n' +
    '    if((i==1||i==2)&&(j==1||j==2)){ lo=min(lo,s); hi=max(hi,s); } } a+=wy[j]*r; }\n' +
    '  oA=clamp(a,lo,hi); }\n';

  // one Lenia step. uT: the ring kernel as taps (x offset, y offset, weight); with linear filtering two neighbours share a tap.
  // memory (M): r = warmth (long), g = fed (short), b = age (0 = newborn .. 1), a = its own hue; shared over a creature's body each step
  var STEP_FS = HEAD + 'uniform sampler2D uA, uM, uE, uT; uniform vec2 uSim; uniform int uNT;\n' +
    'uniform float uMu, uSig, uDt, uBias, uKill, uFedUp, uFedFade, uWarmUp, uWarmFade, uAgeUp;\n' +
    'layout(location=0) out float oA; layout(location=1) out vec4 oM;\n' +
    'void main(){ vec2 fc=gl_FragCoord.xy, inv=1./uSim; float U=0.;\n' +
    '  for(int i=0;i<uNT;i++){ vec4 t=texelFetch(uT,ivec2(i,0),0); U+=t.z*texture(uA,(fc+t.xy)*inv).r; }\n' +
    '  float a0=texelFetch(uA,ivec2(fc),0).r; vec4 e=texelFetch(uE,ivec2(fc),0);\n' +
    '  float G=2.*exp(-(U-uMu)*(U-uMu)/(2.*uSig*uSig))-1.+e.b*smoothstep(.01,.08,U)-uKill*e.a+uBias;\n' +
    '  float A=clamp(a0+uDt*G,0.,1.);\n' +
    '  vec4 m=vec4(0.); float ms=0.;\n' +
    '  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){ vec2 q=(fc+vec2(x,y))*inv; float a=texture(uA,q).r+1e-3; m+=a*texture(uM,q); ms+=a; }\n' +
    '  m/=ms; if(a0<.01) m.rg*=.95;\n' +
    '  float eat=min(1.,e.b*12.*smoothstep(.05,.3,a0));\n' +
    '  float fed=m.g; fed+=(1.-fed)*eat*uFedUp; fed*=uFedFade;\n' +
    '  float warm=m.r; warm+=(1.-warm)*fed*uWarmUp; warm*=uWarmFade;\n' +
    '  oA=A; oM=vec4(warm,fed,min(1.,m.b+uAgeUp),m.a); }\n';

  // new creatures: up to 4 per pass. uSd[i] = (centre x, y in sim cells, turn, -), uSe[i] = (scale, -, amp, -), uSm[i] = its memory
  var SEED_FS = HEAD +
    'uniform sampler2D uA, uM, uPat; uniform vec2 uSim, uPatN; uniform int uN; uniform vec4 uSd[4], uSe[4], uSm[4];\n' +
    'layout(location=0) out float oA; layout(location=1) out vec4 oM;\n' +
    'void main(){ vec2 fc=gl_FragCoord.xy; float a=texelFetch(uA,ivec2(fc),0).r; vec4 m=texelFetch(uM,ivec2(fc),0);\n' +
    '  for(int i=0;i<4;i++){ if(i>=uN) break; vec2 d=fc-uSd[i].xy; d-=uSim*floor(d/uSim+.5);\n' +
    '    float c=cos(uSd[i].z), sn=sin(uSd[i].z); vec2 q=vec2(c*d.x+sn*d.y,-sn*d.x+c*d.y)/uSe[i].x; float val=0.;\n' +
    '    vec2 pu=q/uPatN+.5; if(pu.x>0.&&pu.x<1.&&pu.y>0.&&pu.y<1.) val=texture(uPat,pu).r*uSe[i].z;\n' +
    '    if(val>.01){ if(a<.05) m=uSm[i]; a=max(a,val); } }\n' +
    '  oA=a; oM=m; }\n';

  // copy the pool into a newly sized one (window-aligned)
  var COPY_FS = HEAD + 'uniform sampler2D uA, uM; uniform vec2 uSimN; uniform vec4 uMapN, uMapO; layout(location=0) out float oA; layout(location=1) out vec4 oM;\n' +
    'void main(){ vec2 w=(gl_FragCoord.xy/uSimN-uMapN.xy)/uMapN.zw, so=uMapO.xy+w*uMapO.zw; oA=texture(uA,so).r; oM=texture(uM,so); }\n';

  // block sums for the watchdog and steering (BLK x BLK cells): (A, A x, A y, A warm), (A^2, A^2 x, A^2 y, A fed); x, y within the block
  var REDUCE_FS = HEAD + 'uniform sampler2D uA, uM; uniform ivec2 uSimI; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;\n' +
    'void main(){ ivec2 b=ivec2(gl_FragCoord.xy)*' + BLK + '; vec4 s0=vec4(0.), s1=vec4(0.);\n' +
    '  for(int y=0;y<' + BLK + ';y++) for(int x=0;x<' + BLK + ';x++){ ivec2 p=b+ivec2(x,y); if(p.x<uSimI.x&&p.y<uSimI.y){ float a=texelFetch(uA,p,0).r; if(a>0.){ vec4 m=texelFetch(uM,p,0); vec2 q=vec2(x,y)+.5;\n' +
    '    s0+=vec4(a,a*q,a*m.r); s1+=vec4(a*a,a*a*q,a*m.g); } } }\n' +
    '  o0=s0; o1=s1; }\n';

  // the soft halo around creatures: a separable blur of (A, A x fed) at sim resolution (pass 0 reads the pool, pass 1 the first blur)
  var GLOW_FS = HEAD + 'uniform sampler2D uA, uM, uS; uniform vec2 uSim, uDir; uniform int uPass; out vec4 o;\n' +
    'void main(){ vec2 fc=gl_FragCoord.xy; vec2 acc=vec2(0.); float ws=0.;\n' +
    '  for(int i=-6;i<=6;i++){ float w=exp(-float(i*i)/14.); vec2 q=(fc+uDir*float(i))/uSim; vec2 v;\n' +
    '    if(uPass==0){ float a=texture(uA,q).r; v=vec2(a,a*texture(uM,q).g); } else v=texture(uS,q).rg; acc+=w*v; ws+=w; }\n' +
    '  o=vec4(acc/ws,0.,1.); }\n';

  var DISP_FS = HEAD + NOISE + BODY +
    'uniform sampler2D uA0, uA1, uM, uG; uniform vec2 uSim, uRes; uniform vec4 uMap; uniform float uF, uTime, uDark, uPx;\n' +
    'uniform float uIdle, uCap, uFedK, uRim, uNutr, uWater, uSettle, uWallK; uniform vec4 uRing[4]; in vec2 vUv; out vec4 o;\n' +
    'float cubic(sampler2D t, vec2 uv){ vec2 p=uv*uSim-.5, i=floor(p), f=p-i, f2=f*f, f3=f2*f;\n' +
    '  vec2 w0=(1.-3.*f+3.*f2-f3)/6., w1=(4.-6.*f2+3.*f3)/6., w2=(1.+3.*f+3.*f2-3.*f3)/6., w3=f3/6., g0=w0+w1, g1=w2+w3;\n' +
    '  vec2 h0=(i-1.+w1/g0+.5)/uSim, h1=(i+1.+w3/g1+.5)/uSim;\n' +
    '  return g0.y*(g0.x*texture(t,h0).r+g1.x*texture(t,vec2(h1.x,h0.y)).r)+g1.y*(g0.x*texture(t,vec2(h0.x,h1.y)).r+g1.x*texture(t,h1).r); }\n' +
    'float line(float v, float l, float fw, float w){ return exp(-pow((v-l)/(fw*w),2.)); }\n' +
    'vec3 hash3(vec2 p){ vec3 q=vec3(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)),dot(p,vec2(419.2,371.9))); return fract(sin(q)*43758.5453); }\n' +
    // motes on a jittered grid: one per cell, each with its own phase; lit where k > its threshold
    'float motes(vec2 p, float cell, float rad, float k){ vec2 g=p/cell, ci=floor(g); vec3 r=hash3(ci); vec2 d=(fract(g)-.15-.7*r.xy)*cell;\n' +
    '  return exp(-dot(d,d)/(rad*rad))*smoothstep(r.z,r.z+.25,k)*(.6+.4*sin(uTime*(1.3+r.x*2.)+r.y*30.)); }\n' +
    'void main(){ vec2 w=vec2(vUv.x,1.-vUv.y), su=vec2(uMap.x+vUv.x*uMap.z,uMap.y+vUv.y*uMap.w), px=w*uRes/uPx;\n' +
    '  float A=max(mix(cubic(uA0,su),cubic(uA1,su),uF),0.); vec4 m=texture(uM,su); vec2 hl=texture(uG,su).rg; vec4 b=bodyAt(w);\n' +
    '  float warm=clamp(m.r,0.,1.), born=smoothstep(0.,1.,m.b), calm=abs(b.b);\n' +
    // a creature: a translucent glowing jelly in its own sea hue. Body light rises softly with density, a fine bright membrane on
    // its outside edge (none around its inner pockets), a soft halo in the water. Feeding: gold, brighter, a slow pulse running
    // through it. Having fed: an amber heart (its dense core) that fades over WARM_MEMORY_S.
    '  float g=hl.r, gf=hl.g, fw=max(fwidth(A),1e-3);\n' +
    '  float outer=1.-smoothstep(.10,.19,g);\n' +                                   // only the creature's outside edge gets a membrane
    '  float memb=line(A,.06,fw,1.5)*smoothstep(.0,.02,A)*outer, fill=pow(smoothstep(.02,.95,A*.65+g*.6),.8), core=smoothstep(.6,1.,A);\n' +
    '  float halo=smoothstep(.0,.05,g)*(1.-smoothstep(.02,.2,A));\n' +
    '  float fedNow=clamp(gf/max(g,1e-3),0.,1.), pulse=.6+.4*sin(uTime*3.4-g*14.), feed=1.+uFedK*fedNow*pulse, swim=.9+.1*sin(uTime*2.3-g*11.);\n' +
    '  float gold=max(fedNow,warm*.25), hue=clamp(m.a,0.,1.);\n' +
    '  vec3 sea=hue<.5?mix(vec3(.10,.60,.42),vec3(.08,.55,.66),hue*2.):mix(vec3(.08,.55,.66),vec3(.16,.40,.86),hue*2.-1.);\n' +
    '  vec3 foam=hue<.5?mix(vec3(.72,1.,.84),vec3(.66,1.,.96),hue*2.):mix(vec3(.66,1.,.96),vec3(.72,.86,1.),hue*2.-1.);\n' +
    '  float wkc=mix(uWallK,1.,clamp(max(fedNow,smoothstep(.04,.4,warm)),0.,1.));\n' +   // \'Empty wall\': free creatures scale; a creature feeding on someone, or with an amber heart from having fed, stays as it was
    '  vec3 deep=mix(sea,vec3(.95,.52,.14),gold), pale=mix(foam,vec3(1.,.88,.62),gold), heart=mix(foam,vec3(1.,.56,.14),smoothstep(.04,.4,warm));\n' +
    '  vec3 cr=(deep*fill*.21+heart*core*(.055+.09*smoothstep(.04,.4,warm))+pale*memb*.145+deep*halo*.09)*swim*uIdle*wkc;\n' +
    '  float li=dot(cr,vec3(.2126,.7152,.0722))/(uCap*wkc); cr/=pow(1.+li*li*li*li,.25);\n' +   // a soft ceiling (IDLE_CAP): free creatures peak ~50-55/255
    '  cr*=feed; cr+=vec3(1.,.62,.2)*fedNow*smoothstep(.0,.06,g)*.10*pulse*uFedK/3.5;\n' +
    '  vec3 col=cr*born;\n' +
    // the water: near black, a few motes drifting
    '  float mo=motes(px+vec2(uTime*7.,uTime*3.),46.,1.3,.12);\n' +
    '  col+=(vec3(.002,.005,.010)+vec3(.06,.12,.14)*mo*uWater)*uWallK;\n' +
    // a person: a thin line along the outline (cool while moving, warm when still); golden food motes just outside it when still
    '  float bm=b.r, bw=max(fwidth(bm),1e-3), edge=line(bm,.5,bw,1.6);\n' +
    '  col+=mix(vec3(.45,.65,1.),vec3(1.,.74,.38),smoothstep(.1,.9,calm))*edge*uRim*.8;\n' +
    '  float dd=b.g, band=exp(-pow((dd-2.6)/2.4,2.))*smoothstep(-.5,1.,dd);\n' +
    '  col+=vec3(1.,.66,.25)*(motes(px+vec2(0.,uTime*9.),11.,1.1,band*calm*.8)*.6+band*calm*.02)*uNutr;\n' +
    // a fingertip's ring
    '  for(int i=0;i<4;i++){ vec4 r=uRing[i]; if(r.w<=0.) continue; float dr=abs(length((w-r.xy)*vec2(uRes.x/uRes.y,1.))-r.z)*uRes.y/uPx;\n' +
    '    col+=vec3(.5,.9,1.)*exp(-dr*dr/18.)*r.w*.5; }\n' +
    '  col*=1.-uDark*smoothstep(.55,.8,bm);\n' +   // nothing projected inside a person
    '  col=1.-exp(-col*1.6); o=vec4(col,1.); }\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Lenia Pool needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Lenia Pool needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Lenia Pool needs EXT_color_buffer_float');
    var floatLin = !!gl.getExtension('OES_texture_float_linear');
    var wallK = 2.0;           // 'Empty wall' knob (1 = the 2026-10-05 picture): scales free creatures' light and lifts IDLE_CAP with it, plus the water's motes; feeding creatures, amber hearts, rim, food and rings are untouched
    var made = [], sized = [], destroyed = false;

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    function program(fsSrc) {
      var p = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, fsSrc);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(e); }
      made.push(['Program', p]);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    function texture(w, h, ifmt, fmt, type, filter, wrap, list, data) {
      var t = gl.createTexture(); list.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return t;
    }
    function target(texs, list) {
      var f = gl.createFramebuffer(); list.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.drawBuffers(texs.map(function (t, i) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0); return gl.COLOR_ATTACHMENT0 + i; }));
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Lenia Pool: framebuffer incomplete');
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    }

    var P = {env: program(ENV_FS), adv: program(ADV_FS), step: program(STEP_FS), seed: program(SEED_FS), copy: program(COPY_FS),
             reduce: program(REDUCE_FS), glow: program(GLOW_FS), disp: program(DISP_FS)};
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    // the ring kernel (Lenia's exponential shell), normalised to sum 1, as taps; with linear filtering two neighbours in a row share one
    var taps = [], ksum = 0, ky, kx;
    function kern(x, y) { var r = Math.hypot(x, y) / RADIUS; return (r > 0 && r < 1) ? Math.exp(4 - 1 / (r * (1 - r))) : 0; }
    for (ky = -RR; ky <= RR; ky++) for (kx = -RR; kx <= RR; kx++) ksum += kern(kx, ky);
    for (ky = -RR; ky <= RR; ky++) {
      var hw = Math.floor(Math.sqrt(RR * RR - ky * ky));
      for (kx = -hw; kx <= hw; kx += floatLin ? 2 : 1) {
        var w1 = kern(kx, ky) / ksum, w2 = (floatLin && kx + 1 <= hw) ? kern(kx + 1, ky) / ksum : 0, ws = w1 + w2;
        if (ws > 1e-9) taps.push(kx + w2 / ws, ky, ws, 0);
      }
    }
    var NT = taps.length / 4, tapTex = texture(NT, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, made, new Float32Array(taps));
    // the creature pattern, and where its dense core sits relative to its centre (that offset turns into its heading)
    var PATN = 32, pat = new Float32Array(PATN * PATN), pm = [0, 0, 0, 0, 0, 0];
    for (var pi = 0; pi < pat.length; pi++) {
      var pv = parseInt(ORB_HEX.substr(pi * 2, 2), 16) / 255, px_ = pi % PATN + 0.5, py_ = Math.floor(pi / PATN) + 0.5; pat[pi] = pv;
      pm[0] += pv; pm[1] += pv * px_; pm[2] += pv * py_; pm[3] += pv * pv; pm[4] += pv * pv * px_; pm[5] += pv * pv * py_;
    }
    var HEAD_OFF = ORB_HEADING - Math.atan2(pm[5] / pm[3] - pm[2] / pm[0], pm[4] / pm[3] - pm[1] / pm[0]);
    var patTex = texture(PATN, PATN, gl.R32F, gl.RED, gl.FLOAT, floatLin ? gl.LINEAR : gl.NEAREST, gl.CLAMP_TO_EDGE, made, pat);

    // ---- the body, folded into what this piece needs (Kinect cells, 128 x 106)
    var BW = WallBody.w, BH = WallBody.h, BN = BW * BH, body = WallBody.create(kit, {});
    var fieldF = new Float32Array(BN * 4), fieldUp = new Float32Array(BN * 4), dist = new Float32Array(BN), near = new Int16Array(BN);
    var nearT = new Int32Array(BN).fill(-1), loc = new Float32Array(BN), tmp = new Float32Array(BN);
    function clearField() { for (var i = 0; i < BN; i++) { fieldF[i * 4] = 0; fieldF[i * 4 + 1] = FAR; fieldF[i * 4 + 2] = 0; fieldF[i * 4 + 3] = 0; nearT[i] = -1; } }
    clearField(); fieldUp.set(fieldF);
    var bodyTex = texture(BW, BH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, gl.CLAMP_TO_EDGE, made, fieldUp);
    function upload(src) { gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.FLOAT, src); }
    var tracks = [], nextTrack = 1, lastFoldAt = -1e9, graceUntil = -1e9, folds = 0, releasing = false;

    function chamfer() {                      // distance to the nearest labelled cell, carrying which label it is
      var x, y, i, R2 = 1.4142, v, n;
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; v = dist[i]; if (v === 0) continue; n = near[i];
        if (x > 0 && dist[i - 1] + 1 < v) { v = dist[i - 1] + 1; n = near[i - 1]; }
        if (y > 0) {
          if (dist[i - BW] + 1 < v) { v = dist[i - BW] + 1; n = near[i - BW]; }
          if (x > 0 && dist[i - BW - 1] + R2 < v) { v = dist[i - BW - 1] + R2; n = near[i - BW - 1]; }
          if (x < BW - 1 && dist[i - BW + 1] + R2 < v) { v = dist[i - BW + 1] + R2; n = near[i - BW + 1]; }
        }
        dist[i] = v; near[i] = n; }
      for (y = BH - 1; y >= 0; y--) for (x = BW - 1; x >= 0; x--) { i = y * BW + x; v = dist[i]; if (v === 0) continue; n = near[i];
        if (x < BW - 1 && dist[i + 1] + 1 < v) { v = dist[i + 1] + 1; n = near[i + 1]; }
        if (y < BH - 1) {
          if (dist[i + BW] + 1 < v) { v = dist[i + BW] + 1; n = near[i + BW]; }
          if (x < BW - 1 && dist[i + BW + 1] + R2 < v) { v = dist[i + BW + 1] + R2; n = near[i + BW + 1]; }
          if (x > 0 && dist[i + BW - 1] + R2 < v) { v = dist[i + BW - 1] + R2; n = near[i + BW - 1]; }
        }
        dist[i] = v; near[i] = n; }
    }
    function boxBlur(a, t, r) {               // separable box blur, radius r, in place (t = scratch)
      var x, y, k, s;
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { s = 0; for (k = -r; k <= r; k++) s += a[y * BW + Math.min(BW - 1, Math.max(0, x + k))]; t[y * BW + x] = s / (2 * r + 1); }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { s = 0; for (k = -r; k <= r; k++) s += t[Math.min(BH - 1, Math.max(0, y + k)) * BW + x]; a[y * BW + x] = s / (2 * r + 1); }
    }
    // ---- per fresh depth frame: people tracks with stillness hysteresis, and the field the GPU and the steering read
    function fold(now) {
      folds++; releasing = false;
      var gapS = (now - lastFoldAt) / 1000, dtS = Math.min(0.2, Math.max(0, gapS)), i, j;
      lastFoldAt = now;
      if (gapS > 0.25 && gapS < 30) graceUntil = now + 450;      // after a stall the returning outline reads as a big move: ignore it
      var people = body.people, lab = body.label, mask = body.mask, mo = body.motion, sdf = body.sdf, map = [], used = {};
      for (i = 0; i < people.length; i++) {
        var p = people[i], best = null, bd = 0.15;
        for (j = 0; j < tracks.length; j++) { var tr = tracks[j]; if (used[tr.id]) continue; var dd = Math.hypot(tr.cx - p.cx, tr.cy - p.cy); if (dd < bd) { bd = dd; best = tr; } }
        if (!best) { best = {id: nextTrack++, clock: 0, calm: 0, scare: 0, full: false, mv: 0}; tracks.push(best); }
        used[best.id] = true; map[i] = best;
        best.cx = p.cx; best.cy = p.cy; best.seen = now; best.mv = p.moving;
        if (now < graceUntil) { /* hold */ }
        else if (p.moving < STILL_MOVE) best.clock += dtS;
        else if (p.moving > MOVED_MOVE) { best.scare = Math.max(best.scare, Math.min(1, 0.45 + (p.moving - MOVED_MOVE) * 3)); best.clock = 0; }
        else best.clock = Math.max(0, best.clock - dtS * 0.2);   // in between (Kinect wobble): drains slowly, never resets
      }
      for (j = tracks.length - 1; j >= 0; j--) {
        var t = tracks[j];
        if (now - t.seen > HOLD_S * 1000) { tracks.splice(j, 1); continue; }
        t.scare *= Math.exp(-dtS / SCARE_FADE_S);
        var ramp = Math.min(1, Math.max(0, (t.clock - CALM_START_S) / (CALM_FULL_S - CALM_START_S)));
        t.calm = ramp * ramp * (3 - 2 * ramp) * (t.clock > BORED_S ? Math.exp(-(t.clock - BORED_S) / BORED_FADE_S) : 1);
      }
      for (i = 0; i < BN; i++) { if (lab[i] >= 0) { dist[i] = 0; near[i] = lab[i]; } else { dist[i] = 1e6; near[i] = -1; } }
      chamfer();
      for (i = 0; i < BN; i++) loc[i] = (dist[i] <= 2 && mo[i] > SWEEP) ? (mo[i] - SWEEP) / (1 - SWEEP) : 0;
      boxBlur(loc, tmp, 3); boxBlur(loc, tmp, 3);
      for (i = 0; i < BN; i++) {
        var li = lab[i], tk = li >= 0 ? map[li] : (near[i] >= 0 ? map[near[i]] : null);
        var d = !tk ? FAR : li >= 0 ? Math.min(-0.5, sdf[i] + 0.5) : Math.min(FAR, dist[i] - 0.5);
        var calm = tk ? tk.calm : 0, sc = tk ? tk.scare * Math.exp(-Math.max(0, d) / SCARE_REACH) : 0;
        fieldF[i * 4] = d < 3 ? mask[i] : 0; fieldF[i * 4 + 1] = d; fieldF[i * 4 + 2] = tk && tk.full ? -calm : calm;
        fieldF[i * 4 + 3] = Math.min(1, Math.max(sc, loc[i] * 2.5)); nearT[i] = tk ? tk.id : -1;
      }
      upload(fieldF);
    }
    function bodyFrame(dt, now) {             // stalls: hold everything for HOLD_S, then let go over 0.3 s
      if (body.update(dt, now)) { fold(now); return; }
      if (body.fresh || !tracks.length && !releasing) return;
      var since = (now - lastFoldAt) / 1000 - HOLD_S;
      if (since <= 0) return;
      var k = 1 - since / 0.3;
      if (k <= 0) { tracks = []; clearField(); upload(fieldF); releasing = false; return; }
      releasing = true;
      for (var i = 0; i < BN * 4; i += 4) { fieldUp[i] = fieldF[i] * k; fieldUp[i + 1] = fieldF[i + 1]; fieldUp[i + 2] = fieldF[i + 2] * k; fieldUp[i + 3] = fieldF[i + 3] * k; }
      upload(fieldUp);
    }
    // the field at a sim position (CPU, for the steering): through the registration, nearest Kinect cell
    function fieldAt(sx, sy) {
      var x = (sx / SW - mapU[0]) / mapU[2], y = 1 - (sy / SH - mapU[1]) / mapU[3], m = body.hinv();
      var hz = m[2] * x + m[5] * y + m[8]; if (!(hz > 1e-6)) return null;
      var u = (m[0] * x + m[3] * y + m[6]) / hz, v = (m[1] * x + m[4] * y + m[7]) / hz;
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
      var i = Math.min(BH - 1, (v * BH) | 0) * BW + Math.min(BW - 1, (u * BW) | 0);
      return {m: fieldF[i * 4], d: fieldF[i * 4 + 1], att: fieldF[i * 4 + 2], scare: fieldF[i * 4 + 3], track: nearT[i]};
    }

    // ---- everything sized by the canvas
    var W = 0, H = 0, SW = 0, SH = 0, VW = 0, cur = 0, RW = 0, RH = 0;
    var gT = [null, null], gFb = [null, null], tA = [null, null], tM = [null, null], fb = [null, null], envT = null, envFb = null, red0 = null, red1 = null, redFb = null, mapU = [0, 0, 1, 1];
    var pbo = null, fence = null, grid = null, readAt = -1e9, readPending = 0;
    function alloc(w, h) {
      if (fence) { gl.deleteSync(fence); fence = null; }
      var old = sized, oldA = tA[cur], oldM = tM[cur], oldMap = mapU.slice(), had = SW > 0;
      sized = [];
      W = w; H = h; var cell = h / VISIBLE_ROWS; VW = w / cell;
      var nSW = Math.round(VW) + 2 * MARGIN_CELLS, nSH = VISIBLE_ROWS + 2 * MARGIN_CELLS;
      var nMap = [MARGIN_CELLS / nSW, MARGIN_CELLS / nSH, VW / nSW, VISIBLE_ROWS / nSH];
      var lin = floatLin ? gl.LINEAR : gl.NEAREST;
      for (var k = 0; k < 2; k++) {
        tA[k] = texture(nSW, nSH, gl.R32F, gl.RED, gl.FLOAT, lin, gl.REPEAT, sized);
        tM[k] = texture(nSW, nSH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, gl.REPEAT, sized);
        fb[k] = target([tA[k], tM[k]], sized);
      }
      if (had) {                               // keep the creatures through a resize
        var u = P.copy.u; gl.bindVertexArray(vao); draw(P.copy, fb[0], nSW, nSH);
        bindTex(0, oldA, u.uA); bindTex(1, oldM, u.uM); gl.uniform2f(u.uSimN, nSW, nSH);
        gl.uniform4fv(u.uMapN, nMap); gl.uniform4fv(u.uMapO, oldMap); gl.drawArrays(gl.TRIANGLES, 0, 3);
        draw(P.copy, fb[1], nSW, nSH); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
      }
      old.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); });
      SW = nSW; SH = nSH; mapU = nMap; cur = 0;
      envT = texture(SW, SH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, sized); envFb = target([envT], sized);
      for (var gk = 0; gk < 2; gk++) { gT[gk] = texture(SW, SH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, gl.REPEAT, sized); gFb[gk] = target([gT[gk]], sized); }
      RW = Math.ceil(SW / BLK); RH = Math.ceil(SH / BLK);
      red0 = texture(RW, RH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, sized);
      red1 = texture(RW, RH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.CLAMP_TO_EDGE, sized); redFb = target([red0, red1], sized);
      pbo = gl.createBuffer(); sized.push(['Buffer', pbo]);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, RW * RH * 32, gl.STREAM_READ); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      grid = new Float32Array(RW * RH * 8); crs = [];
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    var X = {avoid: AVOID, creatures: CREATURES, dying: 1, cap: IDLE_CAP, wander: WANDER, pull: PULL, food: FOOD, steps: STEPS_PER_S, turn: TURN, steer: 1, watch: 1};   // live copies (the test may change them)
    var elapsed = 0, frames = 0, steps = 0, simAcc = 0, bias = 0, paused = false;
    var mPull = 1, mFood = 1, mWander = 1, mGlow = 1, musPrev = 0;
    var seeds = [], SD = new Float32Array(16), SE = new Float32Array(16), SM = new Float32Array(16), VO = new Float32Array(MAX_VORT * 4), nVo = 0, SV = new Float32Array(24), nSv = 0, merges = [], mergeCount = 0;
    var crs = [], nextCr = 1, pop = {creatures: 0, mass: 0, free: 0, comps: 0, at: -1e9}, lastAuto = -1e9, autoSeeds = 0, tipSeeds = 0, born = 0;
    var evlog = [], rings = [], RING = new Float32Array(16), tipPrev = [], touchMode = false, lastTouch = {};

    function draw(prog, f, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.viewport(0, 0, w, h); gl.useProgram(prog.p); }
    function bindTex(unit, tex, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(loc, unit); }
    function hinvU(u) { gl.uniformMatrix3fv(u.uHinv, false, body.hinv()); gl.uniform1f(u.uFar, FAR); }
    function envPass(now) {
      nVo = 0;
      for (var i = 0; i < crs.length && nVo < MAX_VORT; i++) {          // each creature's turn, centred where it is now (predicted)
        var c = crs[i]; if (!c.w) continue;
        var ag = (now - c.t) / 1000;
        VO[nVo * 4] = c.x + c.vx * ag; VO[nVo * 4 + 1] = c.y + c.vy * ag; VO[nVo * 4 + 2] = c.w * X.steer; VO[nVo * 4 + 3] = 11; nVo++;
      }
      var u = P.env.u; draw(P.env, envFb, SW, SH);
      bindTex(0, bodyTex, u.uB); hinvU(u);
      gl.uniform2f(u.uSim, SW, SH); gl.uniform4fv(u.uMap, mapU);
      gl.uniform1f(u.uPull, X.pull * mPull); gl.uniform1f(u.uReach, REACH); gl.uniform1f(u.uSettle, SETTLE);
      gl.uniform1f(u.uScare, SCARE); gl.uniform1f(u.uFood, X.food * mFood); gl.uniform1f(u.uMaxV, 0.22);
      gl.uniform1i(u.uNV, nVo); gl.uniform4fv(u.uVo, VO); gl.uniform1i(u.uNS, nSv); gl.uniform4fv(u.uSv, SV);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function stepOnce() {
      var dtS = 1 / X.steps, u = P.adv.u, nxt = 1 - cur;
      draw(P.adv, fb[nxt], SW, SH);
      bindTex(0, tA[cur], u.uA); bindTex(1, tM[cur], u.uM); bindTex(2, envT, u.uE); gl.uniform2f(u.uSim, SW, SH);
      gl.drawArrays(gl.TRIANGLES, 0, 3); cur = nxt; nxt = 1 - cur;
      u = P.step.u; draw(P.step, fb[nxt], SW, SH);
      bindTex(0, tA[cur], u.uA); bindTex(1, tM[cur], u.uM); bindTex(2, envT, u.uE); bindTex(3, tapTex, u.uT);
      gl.uniform2f(u.uSim, SW, SH); gl.uniform1i(u.uNT, NT);
      gl.uniform1f(u.uMu, MU); gl.uniform1f(u.uSig, SIGMA); gl.uniform1f(u.uDt, LENIA_DT); gl.uniform1f(u.uBias, bias); gl.uniform1f(u.uKill, 4);
      gl.uniform1f(u.uFedUp, 1 - Math.exp(-dtS / 0.25)); gl.uniform1f(u.uFedFade, Math.exp(-dtS / 1.0));
      gl.uniform1f(u.uWarmUp, 1 - Math.exp(-dtS / 1.2)); gl.uniform1f(u.uWarmFade, Math.exp(-dtS / WARM_MEMORY_S)); gl.uniform1f(u.uAgeUp, dtS / 1.2);
      gl.drawArrays(gl.TRIANGLES, 0, 3); cur = nxt; steps++;
    }
    function applySeeds() {
      if (!seeds.length) return;
      var n = Math.min(4, seeds.length), nxt = 1 - cur, u = P.seed.u;
      for (var i = 0; i < n; i++) { var s = seeds[i]; SD.set([s.x, s.y, s.a, 0], i * 4); SE.set([s.scale || 1, 0, s.amp || 1, 0], i * 4); SM.set(s.mem || [0, 0, 0, 0], i * 4); }
      seeds.splice(0, n);
      draw(P.seed, fb[nxt], SW, SH);
      bindTex(0, tA[cur], u.uA); bindTex(1, tM[cur], u.uM); bindTex(2, patTex, u.uPat);
      gl.uniform2f(u.uSim, SW, SH); gl.uniform2f(u.uPatN, PATN, PATN); gl.uniform1i(u.uN, n); gl.uniform4fv(u.uSd, SD); gl.uniform4fv(u.uSe, SE); gl.uniform4fv(u.uSm, SM);
      gl.drawArrays(gl.TRIANGLES, 0, 3); cur = nxt;
    }
    function hatch(sx, sy, heading, mem) {     // a new creature at a sim position, swimming toward heading (radians, y up)
      seeds.push({x: ((sx % SW) + SW) % SW, y: ((sy % SH) + SH) % SH, a: heading - ORB_HEADING, scale: 1, amp: 1, mem: mem || [0, 0, 0, Math.random()]}); born++;
      if (window.WallTest) evlog.push(['hatch', Math.round(performance.now()), Math.round(sx), Math.round(sy)]);
      crs.push({id: nextCr++, n: 1, x: sx, y: sy, vx: Math.cos(heading) * ORB_SPEED * X.steps, vy: Math.sin(heading) * ORB_SPEED * X.steps, h: heading, m: ORB_MASS, t: performance.now(), w: 0, orbit: 0, fresh: true});
    }
    function winToSim(x, y) { return [(mapU[0] + x * mapU[2]) * SW, (mapU[1] + (1 - y) * mapU[3]) * SH]; }
    function clearAt(sx, sy, r) { for (var i = 0; i < crs.length; i++) { var dx = crs[i].x - sx, dy = crs[i].y - sy; dx -= SW * Math.round(dx / SW); dy -= SH * Math.round(dy / SH); if (Math.hypot(dx, dy) < r) return false; } return true; }

    // ---- the watchdog and the steering, from the block sums read back every 0.2 s
    function requestRead(now) {
      if (fence || now - readAt < 200) return;
      var u = P.reduce.u; draw(P.reduce, redFb, RW, RH);
      bindTex(0, tA[cur], u.uA); bindTex(1, tM[cur], u.uM); gl.uniform2i(u.uSimI, SW, SH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.FLOAT, 0);
      gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, RW, RH, gl.RGBA, gl.FLOAT, RW * RH * 16);
      gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); readAt = now; readPending = steps;
    }
    function pollRead(now) {
      if (!fence || gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return;
      gl.deleteSync(fence); fence = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, grid); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      analyse(readAt);
    }
    var blk = null, stack = [];
    function analyse(tRead) {
      var N = RW * RH, off = N * 4, i, k, comps = [];
      if (!blk || blk.length !== N) blk = new Int32Array(N);
      blk.fill(-1);
      for (i = 0; i < N; i++) {
        if (blk[i] >= 0 || grid[i * 4] < BLK_MIN) continue;
        var c = {m: 0, sx: 0, sy: 0, m2: 0, sx2: 0, sy2: 0, warm: 0, fed: 0, x0: -1, y0: -1, nb: 0, bl: []};
        blk[i] = comps.length; stack.length = 0; stack.push(i);
        while (stack.length) {
          var j = stack.pop(), bx = j % RW, by = (j / RW) | 0, a = grid[j * 4], a2 = grid[off + j * 4];
          var px_ = bx * BLK + grid[j * 4 + 1] / a, py_ = by * BLK + grid[j * 4 + 2] / a;     // this block's own centre of mass
          if (c.x0 < 0) { c.x0 = px_; c.y0 = py_; }
          var ux = px_ - c.x0, uy = py_ - c.y0, sx_ = SW * Math.round(ux / SW), sy_ = SH * Math.round(uy / SH);   // unwrap the torus
          c.nb++; c.bl.push(px_ - sx_, py_ - sy_, a); c.m += a; c.sx += a * (px_ - sx_); c.sy += a * (py_ - sy_); c.warm += grid[j * 4 + 3]; c.fed += grid[off + j * 4 + 3];
          if (a2 > 0) { c.m2 += a2; c.sx2 += a2 * (bx * BLK + grid[off + j * 4 + 1] / a2 - sx_); c.sy2 += a2 * (by * BLK + grid[off + j * 4 + 2] / a2 - sy_); }
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
            var q = ((by + oy + RH) % RH) * RW + (bx + ox + RW) % RW;
            if (blk[q] < 0 && grid[q * 4] >= BLK_MIN) { blk[q] = comps.length; stack.push(q); }
          }
        }
        if (c.m < 0.25 * ORB_MASS) { comps.push(null); continue; }
        var cx = c.sx / c.m, cy = c.sy / c.m, vv = 0;
        for (k = 0; k < c.bl.length; k += 3) vv += c.bl[k + 2] * ((c.bl[k] - cx) * (c.bl[k] - cx) + (c.bl[k + 1] - cy) * (c.bl[k + 1] - cy));
        comps.push({x: ((cx % SW) + SW) % SW, y: ((cy % SH) + SH) % SH, m: c.m, h: Math.atan2(c.sy2 / c.m2 - cy, c.sx2 / c.m2 - cx) + HEAD_OFF,
                    n: Math.max(1, Math.round(c.m / ORB_MASS)), warm: c.warm / c.m, fed: c.fed / c.m, r: Math.sqrt(c.nb * BLK * BLK / Math.PI), spread: Math.sqrt(vv / c.m)});
      }
      comps = comps.filter(function (q) { return q; });
      // follow creatures from one reading to the next (nearest predicted position)
      var dtR = Math.max(0.05, (tRead - pop.at) / 1000), next = [], used = {};
      comps.forEach(function (q) {
        var best = null, bd = 12;
        for (var j = 0; j < crs.length; j++) { var p = crs[j]; if (used[p.id]) continue; var ag = (tRead - p.t) / 1000;
          var dx = q.x - (p.x + p.vx * ag), dy = q.y - (p.y + p.vy * ag); dx -= SW * Math.round(dx / SW); dy -= SH * Math.round(dy / SH);
          var dd = Math.hypot(dx, dy); if (dd < bd) { bd = dd; best = p; } }
        var cr = best || {id: nextCr++, w: 0, orbit: 0, vx: 0, vy: 0};
        if (best) { used[best.id] = true;
          var mx = q.x - best.x, my = q.y - best.y; mx -= SW * Math.round(mx / SW); my -= SH * Math.round(my / SH); var ag2 = Math.max(0.05, (tRead - best.t) / 1000);
          cr.vx = best.fresh ? mx / ag2 : cr.vx * 0.5 + 0.5 * mx / ag2; cr.vy = best.fresh ? my / ag2 : cr.vy * 0.5 + 0.5 * my / ag2; }
        else { cr.vx = Math.cos(q.h) * ORB_SPEED * X.steps; cr.vy = Math.sin(q.h) * ORB_SPEED * X.steps; }
        cr.x = q.x; cr.y = q.y; cr.m = q.m; cr.r = q.r; cr.spread = q.spread;
        if (q.m > BIG * ORB_MASS) { if (!cr.bigAt) { cr.bigAt = tRead; cr.bigM = q.m; } cr.dying = false; }   // heavy: two neighbours, or a merge?
        else if (cr.bigAt && q.m > 1.1 * ORB_MASS && q.m < 0.88 * cr.bigM) cr.dying = true;   // a merge collapsing (a pair that parts leaves ~1-creature pieces)
        else { cr.bigAt = 0; cr.dying = false; }
        cr.h = q.h; cr.n = q.n; cr.warm = q.warm; cr.fed = q.fed; cr.t = tRead; cr.fresh = false;
        next.push(cr);
      });
      crs.forEach(function (p) { if (!used[p.id] && p.fresh && tRead - p.t < 600) next.push(p); });   // just hatched, not summed yet
      if (window.WallTest) crs.forEach(function (p) { if (!used[p.id] && !p.fresh) evlog.push(['lost', Math.round(tRead), Math.round(p.x), Math.round(p.y), Math.round(p.m || 0), +((p.w || 0) * X.steps).toFixed(2), p.goal, +(p.spread || 0).toFixed(1)]); });
      crs = next;
      steer();
      crs.forEach(function (p) {               // two creatures that merged (dying or boiling over): the mass dissolves, one creature re-forms
        var unstable = p.bigAt && ((p.dying && X.dying) || p.m > 2.6 * ORB_MASS || (tRead - p.bigAt > 600 && Math.abs(p.m / p.bigM - 1) > 0.12));   // two neighbours hold steady
        if (unstable && !p.dissolving && merges.length < 6) {
          var sp = Math.hypot(p.vx, p.vy), hd = sp > 2 ? Math.atan2(p.vy, p.vx) : p.h;
          p.dissolving = true; merges.push({x: p.x, y: p.y, r: Math.min(30, (p.spread || 8) * 1.6 + 6), h: hd, warm: p.warm || 0, at: tRead + 380}); mergeCount++;
          if (window.WallTest) evlog.push(['merge', Math.round(tRead), Math.round(p.x), Math.round(p.y), Math.round(p.m), Math.round(p.bigM), Math.round(p.r)]);
        }
      });
      // the watchdog
      var n = 0, mass = 0, free = 0;
      crs.forEach(function (p) { if (!p.fresh) { n += p.n; mass += p.m; if (!p.near) free += p.n; } });
      pop = {creatures: n, mass: Math.round(mass), free: free, comps: comps.length, at: tRead};
      bias = mass > MAX_MASS * ORB_MASS ? -Math.min(0.12, (mass / (MAX_MASS * ORB_MASS) - 1) * 0.6) : 0;
      if (X.watch && tRead - lastAuto > RESEED_S * (n <= X.creatures - 2 ? 400 : 1000) && (n < X.creatures || (free < 2 && n < X.creatures + 3))) {
        for (var tries = 0; tries < 8; tries++) {    // a new creature swims in from the hidden edge (where the torus joins)
          var side = Math.random() < 0.62, sx = side ? 0 : MARGIN_CELLS + Math.random() * (SW - 2 * MARGIN_CELLS), sy = side ? MARGIN_CELLS + 8 + Math.random() * (SH - 2 * MARGIN_CELLS - 16) : 0;
          if (!clearAt(sx, sy, 40)) continue;
          var inward = side ? (Math.random() < 0.5 ? 0 : Math.PI) : (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
          hatch(sx, sy, inward + (Math.random() - 0.5) * 1.1); lastAuto = tRead; autoSeeds++; break;
        }
      }
    }
    function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
    function steer() {                         // each creature decides where to swim; a small vortex turns it that way
      var held = {}, tById = {};
      tracks.forEach(function (t) { tById[t.id] = t; });
      crs.forEach(function (p) {
        p.near = false; p.goal = 'free';
        var hx = Math.cos(p.h), hy = Math.sin(p.h), rx = 0, ry = 0, want = null;
        crs.forEach(function (q) {             // keep clear of creatures ahead (two that touch merge, and the merge starves)
          if (q === p) return;
          var dx = q.x - p.x, dy = q.y - p.y; dx -= SW * Math.round(dx / SW); dy -= SH * Math.round(dy / SH);
          var dd = Math.hypot(dx, dy); if (dd > X.avoid || dd < 1e-3) return;      // creatures feel each other ~25 cells apart
          var ahead = (dx * hx + dy * hy) / dd; if (ahead < -0.5 && dd > X.avoid * 0.6) return;
          var k = (1 - dd / X.avoid) * (1 + ahead) * 1.6, cr_ = (hx * dy - hy * dx) / dd, side = Math.abs(cr_) < 0.15 ? 1 : (cr_ > 0 ? 1 : -1);
          rx += (side * hy - 0.4 * dx / dd) * k; ry += (-side * hx - 0.4 * dy / dd) * k;   // veer sideways (head-on: both to their right)
        });
        var f = fieldAt(p.x, p.y), gx = 0, gy = 0, wx = null, wy = null;
        if (f && f.d < FAR) {
          var fx1 = fieldAt(p.x + 3, p.y), fx0 = fieldAt(p.x - 3, p.y), fy1 = fieldAt(p.x, p.y + 3), fy0 = fieldAt(p.x, p.y - 3);
          gx = (fx1 && fx0) ? fx1.d - fx0.d : 0; gy = (fy1 && fy0) ? fy1.d - fy0.d : 0; var gn = Math.hypot(gx, gy);
          if (gn > 1e-3) {
            gx /= gn; gy /= gn;                // away from the nearest person
            var calm = Math.abs(f.att), t = tById[f.track];
            if (f.scare > 0.1) p.fright = performance.now() + FRIGHT_S * 1000;
            if (p.fright > performance.now()) {    // flee: any heading within ~70 degrees of straight away (a small turn, not a U-turn)
              var aw = Math.atan2(gy, gx), off = Math.max(-1.2, Math.min(1.2, wrapA(p.h - aw)));
              wx = Math.cos(aw + off); wy = Math.sin(aw + off); p.goal = 'flee'; }
            else if (calm > 0.3 && f.d < REACH && t) {
              p.near = f.d < SETTLE + 14;
              if (p.near) held[t.id] = (held[t.id] || 0) + (p.n || 1);
              if (f.att > 0 || p.near) {
                if (f.d > SETTLE + 10) { wx = -gx; wy = -gy; p.goal = 'approach'; }
                else {                         // circle the outline, every creature the same way round (a procession), held at SETTLE
                  if (!t.orbit) t.orbit = (-gy * hx + gx * hy) >= 0 ? 1 : -1;
                  var rad = Math.max(-1, Math.min(1, (f.d - SETTLE) / 4));
                  wx = -gy * t.orbit - gx * rad * 1.2; wy = gx * t.orbit - gy * rad * 1.2; p.goal = 'circle';
                }
              }
            }
          }
        }
        if (wx === null) {                     // free: meander (a slow turn that changes with time), and keep clear of others
          var wa = p.h + X.wander * mWander * Math.sin(elapsed * 0.11 + p.id * 2.39) * 0.8;
          wx = Math.cos(wa); wy = Math.sin(wa);
        }
        var wn = Math.hypot(wx, wy) || 1, av = p.goal === 'approach' || p.goal === 'circle' ? 0.6 : 1.4;   // heading for someone: crowd in a little
        want = Math.atan2(wy / wn + av * ry, wx / wn + av * rx);
        var turn = Math.max(-X.turn, Math.min(X.turn, wrapA(want - p.h) * 1.2));   // radians per second
        p.w = turn / X.steps;
      });
      tracks.forEach(function (t) { t.held = held[t.id] || 0; t.full = t.held >= PER_PERSON; });
    }

    // ---- fingertips: a landing buds a creature there (not inside a person, not on top of another creature)
    function tryHatch(x, y, now) {
      var s = winToSim(x, y), f = fieldAt(s[0], s[1]);
      rings.push({x: x, y: y, t0: now}); if (rings.length > 4) rings.shift();
      if (f && f.m > 0.3) return false;
      if (!clearAt(s[0], s[1], 16) || pop.creatures + seeds.length >= CREATURES + 4) return false;
      var hd = Math.random() * Math.PI * 2;
      if (f && f.d < 20) { var fx1 = fieldAt(s[0] + 3, s[1]), fx0 = fieldAt(s[0] - 3, s[1]), fy1 = fieldAt(s[0], s[1] + 3), fy0 = fieldAt(s[0], s[1] - 3);
        if (fx1 && fx0 && fy1 && fy0) hd = Math.atan2(fy1.d - fy0.d, fx1.d - fx0.d) + (Math.random() - 0.5) * 1.2; }   // newborns swim away from the body first
      hatch(s[0], s[1], hd); tipSeeds++;
      return true;
    }
    function fingers(now) {
      var f = kit.fingers;
      if (f) touchMode = false;
      var pts = (f && Array.isArray(f.pts) && Date.now() - f.t <= 160) ? f.pts : [], cur_ = [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var best = null, bd = 0.08;
        for (var j = 0; j < tipPrev.length; j++) { var d = Math.hypot(tipPrev[j].x - p[0], tipPrev[j].y - p[1]); if (d < bd) { bd = d; best = tipPrev[j]; } }
        var tp = {x: p[0], y: p[1], lastAt: best ? best.lastAt : -1e9, lx: best ? best.lx : -9, ly: best ? best.ly : -9};
        if (!best || (now - tp.lastAt > TIP_REPEAT_S * 1000 && Math.hypot(tp.x - tp.lx, tp.y - tp.ly) > 0.1)) {
          if (tryHatch(p[0], p[1], now) || !best) { tp.lastAt = now; tp.lx = p[0]; tp.ly = p[1]; }
        }
        cur_.push(tp);
      }
      tipPrev = cur_;
    }

    var tq = window.WallTest ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null, tqs = [], gpuMs = [];
    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); elapsed += dt; frames++;
      if (canvas.width !== W || canvas.height !== H) alloc(canvas.width, canvas.height);
      var q = null; if (tq && tqs.length < 4) { q = gl.createQuery(); gl.beginQuery(tq.TIME_ELAPSED_EXT, q); }
      bodyFrame(dt, now);
      fingers(now);
      var m = kit.music ? kit.music() : null, e = m && m.enabled && m.fresh ? m.amount : 0, bass = e ? e * m.bands[0] : 0, mid = e ? e * m.bands[1] : 0, high = e ? e * m.bands[2] : 0, beat = e ? e * m.pulse : 0;
      mPull = 1 + Math.min(.8, bass * 1.6); mWander = 1 + Math.min(.5, mid); mFood = 1 + 2.5 * beat; mGlow = 1 + 2.4 * beat + .6 * bass;   // music: multipliers at use time, settings untouched
      if (e && m.pulse > .95 && musPrev <= .95) { rings.push({x: .5 + .35 * Math.sin(elapsed * .23), y: .5 + .2 * Math.sin(elapsed * .15), t0: now}); if (rings.length > 4) rings.shift(); }   // music: a food pulse ring per beat
      musPrev = m ? m.pulse : 0;
      gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      if (frames === 1 && !crs.length) for (var s0 = 0; s0 < CREATURES; s0++) {   // a few creatures to begin with, spread out
        for (var tr = 0; tr < 12; tr++) { var sx = MARGIN_CELLS + 12 + Math.random() * (SW - 2 * MARGIN_CELLS - 24), sy = MARGIN_CELLS + 12 + Math.random() * (SH - 2 * MARGIN_CELLS - 24);
          if (clearAt(sx, sy, 34)) { hatch(sx, sy, Math.random() * Math.PI * 2); break; } }
      }
      pollRead(now);
      nSv = 0;
      for (var mi = merges.length - 1; mi >= 0; mi--) {
        var mg = merges[mi];
        if (now >= mg.at) { merges.splice(mi, 1); hatch(mg.x, mg.y, mg.h, [mg.warm, 0, 0.55, Math.random()]); continue; }
        SV.set([mg.x, mg.y, 0.8, mg.r], nSv * 4); nSv++;
      }
      applySeeds();
      if (!paused) {
        simAcc = Math.min(simAcc + dt * X.steps, MAX_STEPS);
        if (simAcc >= 1) envPass(now);
        while (simAcc >= 1) { stepOnce(); simAcc -= 1; }
        requestRead(now);
      }
      for (var ri = 0; ri < 4; ri++) {
        var r = rings[ri], a = r ? (now - r.t0) / 1000 : 9;
        RING.set(a < 1.2 ? [r.x, r.y, 0.012 + a * 0.06, Math.exp(-a * 2.6)] : [0, 0, 0, 0], ri * 4);
      }
      var gu = P.glow.u;                       // the halo: blur the pool (cheap, sim resolution)
      draw(P.glow, gFb[0], SW, SH); bindTex(0, tA[cur], gu.uA); bindTex(1, tM[cur], gu.uM); bindTex(2, gT[1], gu.uS);
      gl.uniform2f(gu.uSim, SW, SH); gl.uniform2f(gu.uDir, 1, 0); gl.uniform1i(gu.uPass, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      draw(P.glow, gFb[1], SW, SH); bindTex(2, gT[0], gu.uS); gl.uniform2f(gu.uDir, 0, 1); gl.uniform1i(gu.uPass, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      var u = P.disp.u;
      draw(P.disp, null, W, H);
      bindTex(0, tA[1 - cur], u.uA0); bindTex(1, tA[cur], u.uA1); bindTex(2, tM[cur], u.uM); bindTex(3, bodyTex, u.uB); bindTex(4, gT[1], u.uG); hinvU(u);
      gl.uniform2f(u.uSim, SW, SH); gl.uniform2f(u.uRes, W, H); gl.uniform4fv(u.uMap, mapU); gl.uniform1f(u.uF, paused ? 1 : Math.min(1, simAcc));
      gl.uniform1f(u.uTime, elapsed); gl.uniform1f(u.uDark, DARK_INSIDE); gl.uniform1f(u.uPx, W / 1280);
      gl.uniform1f(u.uIdle, IDLE_LIGHT * mGlow); gl.uniform1f(u.uCap, -Math.log(1 - X.cap / 255) / 1.6 * mGlow); gl.uniform1f(u.uFedK, FED_GLOW); gl.uniform1f(u.uRim, RIM); gl.uniform1f(u.uNutr, NUTRIENT); gl.uniform1f(u.uWater, WATER); gl.uniform1f(u.uWallK, wallK);
      gl.uniform1f(u.uSettle, SETTLE); gl.uniform4fv(u.uRing, RING);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
      if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); tqs.push(q); }
      for (var qi = tqs.length - 1; qi >= 0; qi--) if (gl.getQueryParameter(tqs[qi], gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) { gpuMs.push(gl.getQueryParameter(tqs[qi], gl.QUERY_RESULT) / 1e6); if (gpuMs.length > 240) gpuMs.shift(); }
        gl.deleteQuery(tqs[qi]); tqs.splice(qi, 1);
      }
    }
    function touch(t) {                        // sparse touch reports: only while kit.fingers is silent
      if ((!t) || (t && !t._wake && kit.fingers && Date.now() - kit.fingers.t <= 160 && kit.fingers.pts && kit.fingers.pts.length)) return;
      var now = performance.now(), prev = lastTouch[t.id];
      if (!prev || now - prev.at > TIP_REPEAT_S * 1000) { tryHatch(t.x, t.y, now); lastTouch[t.id] = {at: now}; }
    }

    function readState() {                    // debug only: the whole pool (synchronous)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb[cur]); gl.readBuffer(gl.COLOR_ATTACHMENT0);
      var px = new Float32Array(SW * SH * 4); gl.readPixels(0, 0, SW, SH, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); return px;
    }

    alloc(canvas.width, canvas.height);
    kit.wantDepth(true);
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.LeniapoolSet === set) delete window.LeniapoolSet;
      if (window.LeniapoolWake === wake) delete window.LeniapoolWake; kit.wantDepth(false);
      if (fence) { gl.deleteSync(fence); fence = null; }
      tqs.forEach(function (q) { gl.deleteQuery(q); }); tqs = [];
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
      if (window.__leniapoolDebug) try { delete window.__leniapoolDebug; } catch (e) { window.__leniapoolDebug = undefined; }
    }
    if (window.WallTest) window.__leniapoolDebug = function (o) {   // sandbox only (the live wall has no WallTest)
      o = o || {};
      gl.bindVertexArray(vao);
      if (o.clear) { for (var k = 0; k < 2; k++) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb[k]); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } crs = []; }
      if (o.set) Object.assign(X, o.set);
      if (o.pause !== undefined) paused = !!o.pause;
      if (o.hatch) o.hatch.forEach(function (h) { var s = winToSim(h[0], h[1]); hatch(s[0], s[1], h[2]); });
      if (o.steps) { applySeeds(); for (var i = 0; i < o.steps; i++) { envPass(performance.now()); stepOnce(); } }
      if (o.prof) {                            // throughput of each pass (synchronous; debug only)
        var sync = function () { gl.bindFramebuffer(gl.FRAMEBUFFER, fb[cur]); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array(4)); gl.bindFramebuffer(gl.FRAMEBUFFER, envFb); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array(4)); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); };
        var tm = function (fn) { sync(); var t0 = performance.now(); for (var i = 0; i < o.prof; i++) fn(); sync(); return +((performance.now() - t0) / o.prof).toFixed(3); };
        var pr = {env: tm(function () { envPass(performance.now()); }), step: tm(stepOnce), disp: tm(function () { frame(0, performance.now()); }),
          reduce: tm(function () { var u = P.reduce.u; draw(P.reduce, redFb, RW, RH); bindTex(0, tA[cur], u.uA); bindTex(1, tM[cur], u.uM); gl.uniform2i(u.uSimI, SW, SH); gl.drawArrays(gl.TRIANGLES, 0, 3); })};
        gl.bindVertexArray(null); return pr;
      }
      gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      var g = gpuMs.slice().sort(function (a, b) { return a - b; });
      var res = {frames: frames, steps: steps, simT: +(steps / X.steps).toFixed(2), wallT: +elapsed.toFixed(2), grid: [SW, SH], taps: NT,
        pop: pop, merges: mergeCount, bias: +bias.toFixed(3), autoSeeds: autoSeeds, tipSeeds: tipSeeds, born: born, folds: folds, fresh: body.fresh, regOk: body.regOk,
        gpu: g.length ? {n: g.length, p50: +g[g.length >> 1].toFixed(3), p95: +g[Math.floor(g.length * 0.95)].toFixed(3)} : null,
        tracks: tracks.map(function (t) { return {id: t.id, cx: +t.cx.toFixed(3), cy: +t.cy.toFixed(3), clock: +t.clock.toFixed(2), calm: +t.calm.toFixed(2), scare: +t.scare.toFixed(2), mv: +t.mv.toFixed(3), held: t.held || 0, full: !!t.full}; }),
        crs: crs.map(function (p) { var wx = (p.x / SW - mapU[0]) / mapU[2], wy = 1 - (p.y / SH - mapU[1]) / mapU[3];
          var fd = fieldAt(p.x, p.y);
          return {id: p.id, sp: +(p.spread || 0).toFixed(1), d: fd && fd.d < FAR ? +fd.d.toFixed(1) : null, x: +wx.toFixed(3), y: +wy.toFixed(3), h: +p.h.toFixed(2), m: Math.round(p.m || 0), n: p.n || 0, goal: p.goal, w: +((p.w || 0) * X.steps).toFixed(2), warm: +(p.warm || 0).toFixed(2), fed: +(p.fed || 0).toFixed(2)}; }),
        glError: gl.getError()};
      if (o.log) { res.log = evlog.slice(-o.log); }
      if (o.env) { gl.bindFramebuffer(gl.FRAMEBUFFER, envFb); var ev = new Float32Array(4);
        res.env = crs.map(function (p) { gl.readPixels(Math.floor(((p.x % SW) + SW) % SW), Math.floor(((p.y % SH) + SH) % SH), 1, 1, gl.RGBA, gl.FLOAT, ev); var f = fieldAt(p.x, p.y);
          return {id: p.id, goal: p.goal, m: Math.round(p.m || 0), harm: +ev[3].toFixed(2), food: +ev[2].toFixed(3), v: [+ev[0].toFixed(3), +ev[1].toFixed(3)], d: f ? +f.d.toFixed(1) : null, fright: f ? +f.scare.toFixed(2) : null, w: +((p.w || 0) * X.steps).toFixed(2)}; });
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
      if (o.mass) { var px = readState(), ms = 0; for (var qq = 0; qq < SW * SH; qq++) ms += px[qq * 4]; res.mass = +ms.toFixed(1); }
      return res;
    };
    function set(opts) {   // pull / food / wander are MULTIPLIERS of the tuned values (PULL, FOOD, WANDER): 1.0 = the tuned build (the file's notes warn a push of 0.24+ tears creatures apart)
      if (!opts || destroyed) return {steps: X.steps, pull: X.pull / PULL, food: X.food / FOOD, wander: X.wander / WANDER, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.steps)) X.steps = Math.max(8, Math.min(48, opts.steps));
      if (Number.isFinite(opts.pull)) X.pull = PULL * Math.max(0.2, Math.min(3, opts.pull));
      if (Number.isFinite(opts.food)) X.food = FOOD * Math.max(0.2, Math.min(3, opts.food));
      if (Number.isFinite(opts.wander)) X.wander = WANDER * Math.max(0.2, Math.min(3, opts.wander));
      return {steps: X.steps, pull: X.pull / PULL, food: X.food / FOOD, wander: X.wander / WANDER, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      try { if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true}); } catch (e) {}
    }
    window.LeniapoolSet = set;
    window.LeniapoolWake = wake;
    if (window._leniapoolFx) set(window._leniapoolFx);

    return {frame: frame, touch: touch, destroy: destroy};
  }
})();
