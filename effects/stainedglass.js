/* Stained Glass — your shadow shatters the window into jewels (2026-10-05; fx-research concept #12, built by Claude (fx-batch)).
 * The wall is a leaded stained-glass window with daylight behind it: a field of big blue panes, a jewelled border and three
 * rose medallions (a ruby-and-gold ring, curved petals, a gold boss), the light drifting softly as clouds pass outside.
 * Step in front of it and the glass around your outline shatters at once into small jewel splinters; light streams through
 * the fresh cracks and the splinters glint and jostle. Move, and the glass along your moving arm shatters again. Stand still
 * and the cracks turn into lead and the splinters re-fuse into mid-size shards hugging you, lit from behind. Walk away and
 * your shape stays in the glass as finer leading (dim: the light left with you) that heals back into big panes in ~30 s.
 * Where two people's shattered glass meets, the cracks between them turn gold (a seam that stays until the glass heals).
 * Tap a pane with a fingertip and it lights up from behind with a ring running across it, and its colour spills down the wall.
 * Nothing is projected inside a person. Needs plugins/body.js (WallBody). WebGL 2, no assets, no audio, one depth client.
 * Computed here beyond the stage: a people-only distance map with the nearest person per cell, a dilated motion-shatter map,
 * person tracks keyed by position (stillness hysteresis), and per-cell owners for the seams (CPU, 128 x 106 Kinect cells).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  var PANE_PX = 150;           // size of a big pane of glass (px on a 1280 x 800 picture)
  var SPLIT = 2.5;             // each shatter step makes the pieces this many times smaller (panes -> shards -> splinters)
  var BAND_PX = 115;           // how far out from your outline the glass shatters (it eases off towards this distance)
  var LIGHT_PX = 55;           // how far the light around your outline reaches
  var ARRIVE = 1.0;            // how hard the glass shatters when you arrive or move (1 = into the smallest splinters)
  var STILL_LEVEL = 0.52;      // what it settles back to around you while you stand still (about 0.5 = mid-size shards)
  var CALM_S = 4;              // seconds of standing still to settle fully
  var HEAL_NEAR_S = 2.5;       // how fast the glass re-fuses around someone standing still (time constant, s)
  var HEAL_S = 20;             // how fast glass that nobody is near re-fuses into big panes (time constant, s)
  var FRESH_S = 1.2;           // new cracks shine about this long before they turn into dark lead (time constant, s)
  var TUMBLE = 1.0;            // how much fresh shards jostle before they settle (0 = not at all)
  var SPARKLE = 1.0;           // glints off the shards near a person
  var REST = 1.0;              // brightness of the resting window
  var REST_CAP = 37;           // the brightest any resting glass may get (luminance out of 255): keeps the empty wall calm
  var GLOW = 1.0;              // brightness of the glass around a person
  var RIM = 1.0;               // the warm light right at your outline
  var TAP_S = 2.6;             // a tapped pane glows about this long (s)
  var SPILL = 1.0;             // how much a tapped pane's colour spills down the wall
  var SEAM = 1.0;              // the gold seam where two people's shards meet
  var SEAM_AREA = 80;          // only blobs this big (Kinect cells; a small child is ~120) that have stayed 0.7 s make seams, not specks
  var MOVE_HI = 0.12;          // a person counts as moving above this much change per frame...
  var MOVE_LO = 0.06;          // ...and as still again only after staying under this for STILL_AFTER_S (real depth wobbles)
  var STILL_AFTER_S = 0.4;
  var GHOST_S = 45;            // after this long perfectly still (a chair, a bag), the light around it dims to GHOST_DIM
  var GHOST_DIM = 0.35;
  var HOLD_MS = 700;           // short depth stalls: hold everything this long before letting go
  var JUMP = 0.12;             // glass shatters at once only for a real change (arriving, moving); smaller rises (depth jitter) creep
  var DARK_INSIDE = 1.0;       // no light inside a person (1 = none, 0 = off)

  registerWallPlugin({id: 'stainedglass', title: 'Stained Glass', author: 'Claude (fx-batch), fx-research concept #12', create: create});

  var SC0 = 800 / PANE_PX;     // big panes per unit of wall height
  // the window's design (in wall heights): border width and segment length, medallion outer / inner / centre radius
  var BW = 0.06, BL = 0.085, MR = 0.21, MR2 = 0.145, RB = 0.04, MGAP = 0.035;

  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS = [
    '#version 300 es',
    'precision highp float; precision highp int;',
    'uniform sampler2D uField, uBody; uniform mat3 uHinv;',
    'uniform float uAspect, uTime, uPx, uSc0, uSplit, uRest, uCap, uGlow, uRim, uSpark, uTumble, uSeam, uDark, uSpill, uTapS, uWall;',
    'uniform vec4 uTap[6]; uniform ivec4 uTapId[6];',
    'in vec2 vUv; out vec4 o;',
    'const float BW=' + BW + ', BL=' + BL + ', MR=' + MR + ', MR2=' + MR2 + ', RB=' + RB + ', MGAP=' + MGAP + ', PI=3.14159265;',
    'const vec3 LUM=vec3(.2126,.7152,.0722);',
    // integer hash (pcg2d): the same numbers in JS, so a fingertip can name the pane it touched
    'uvec2 pcg(uvec2 v){v=v*1664525u+1013904223u;v.x+=v.y*1664525u;v.y+=v.x*1664525u;v^=v>>16u;v.x+=v.y*1664525u;v.y+=v.x*1664525u;v^=v>>16u;return v;}',
    'vec2 rnd2(ivec2 c, uint s){uvec2 h=pcg(uvec2(c+8192)+uvec2(s*7919u,s*104729u));return vec2(h>>8u)*(1./16777216.);}',
    'float vh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(vh(i),vh(i+vec2(1,0)),f.x),mix(vh(i+vec2(0,1)),vh(i+vec2(1,1)),f.x),f.y);}',
    'vec2 kin(vec2 p){vec3 h=uHinv*vec3(p.x/uAspect,p.y,1.);return clamp(h.xy/max(h.z,1e-6),0.,1.);}',
    'vec4 fld(vec2 p){return texture(uField,kin(p));}',
    'float ownerAt(vec2 p){ivec2 c=ivec2(kin(p)*vec2(128.,106.));return texelFetch(uBody,clamp(c,ivec2(0),ivec2(127,105)),0).b;}',
    // the design: a jewelled border of short segments, three rose medallions (16-piece ring, 8 curved petals, a gold boss) on a blue field
    'vec2 mcen(int i){float a=BW+MGAP+MR;return vec2(i==0?a:i==1?uAspect*.5:uAspect-a,.5);}',
    'float spoke(float th, float n, float tw, float u, float r, float slope, out float k){',
    '  float a=(th+tw*sin(PI*u))/(2.*PI/n); k=floor(a); float f=a-k; f=min(f,1.-f); return f*(2.*PI/n)*r/sqrt(1.+slope*slope);}',
    'int design(vec2 p, out ivec2 id, out float be){',
    '  float ex=min(p.x,uAspect-p.x), ey=min(p.y,1.-p.y), de=min(ex,ey);',
    '  if(de<BW){',
    '    if(ex<BW&&ey<BW){id=ivec2(-60,(p.x<uAspect*.5?0:1)+(p.y<.5?0:2));be=min(BW-ex,BW-ey);return 5;}',
    '    bool hz=ey<BW; float len=hz?uAspect-2.*BW:1.-2.*BW, s=(hz?p.x:p.y)-BW;',
    '    float n=max(1.,floor(len/BL+.5)), sl=len/n, a=s/sl, k=floor(a), f=a-k;',
    '    int side=hz?(p.y<.5?0:1):(p.x<uAspect*.5?2:3);',
    '    id=ivec2(-50-side,int(k)); be=min(BW-de,min(f,1.-f)*sl); return 1;}',
    '  float best=9.; int mi=0; for(int i=0;i<3;i++){float d=length(p-mcen(i)); if(d<best){best=d;mi=i;}}',
    '  if(best<MR){',
    '    vec2 v=p-mcen(mi); float r=best, th=atan(v.y,v.x)+PI, k;',
    '    if(r<RB){id=ivec2(-10-mi,0);be=RB-r;return 4;}',
    '    if(r<MR2){float u=(r-RB)/(MR2-RB), tw=.6, slope=r*tw*PI*cos(PI*u)/(MR2-RB);',
    '      float ds=spoke(th,8.,tw,u,r,slope,k); id=ivec2(-10-mi,1+int(mod(k,8.))); be=min(min(r-RB,MR2-r),ds); return 3;}',
    '    float ds=spoke(th,16.,0.,0.,r,0.,k); id=ivec2(-10-mi,20+int(mod(k,16.))); be=min(min(r-MR2,MR-r),ds); return 2;}',
    '  id=ivec2(0); be=min(de-BW,best-MR); return 0;}',
    // jewels: 0 sapphire, 1 deep blue, 2 ruby, 3 gold, 4 emerald, 5 violet, 6 azure, 7 rose, 8 silver
    'const vec3 J[9]=vec3[9](vec3(.10,.25,1.),vec3(.16,.12,.92),vec3(1.,.05,.11),vec3(1.,.62,.12),vec3(.05,.80,.40),vec3(.58,.14,.98),vec3(.30,.66,1.),vec3(1.,.26,.50),vec3(.70,.84,1.));',
    'const ivec4 MS[3]=ivec4[3](ivec4(0,4,2,3),ivec4(5,6,2,3),ivec4(4,0,2,3));',   // petals A/B, ring A/B for each medallion
    'int pickField(float h){return h<.44?0:h<.64?1:h<.78?5:h<.87?6:h<.95?2:h<.985?4:3;}',
    'int paneIdx(int reg, ivec2 id){',
    '  if(reg==0) return pickField(rnd2(id,3u).x);',
    '  if(reg==1){int k=id.y%4; return k==1?3:k==3?4:2;}',
    '  if(reg==5) return 0;',
    '  if(reg==4) return 3;',
    '  ivec4 m=MS[clamp(-10-id.x,0,2)];',
    '  if(reg==3) return (id.y-1)%2==0?m.x:m.y;',
    '  return (id.y-20)%2==0?m.z:m.w;}',
    'vec3 paneCol(int reg, ivec2 id){return J[paneIdx(reg,id)];}',
    'float voro(vec2 q, uint s, float jit, out ivec2 mc){',
    '  ivec2 ci=ivec2(floor(q)); vec2 f=q-vec2(ci), mr=vec2(0.); float md=9.; mc=ci;',
    '  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ivec2 c=ci+ivec2(i,j);vec2 r=vec2(i,j)+.5+jit*(rnd2(c,s)-.5)-f;float d=dot(r,r);if(d<md){md=d;mr=r;mc=c;}}',
    '  float e=9.;',
    '  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){if(i==0&&j==0)continue;ivec2 c=mc+ivec2(i,j);vec2 r=vec2(c-ci)+.5+jit*(rnd2(c,s)-.5)-f;vec2 dd=r-mr;float l2=dot(dd,dd);if(l2>1e-6)e=min(e,dot(.5*(mr+r),dd*inversesqrt(l2)));}',
    '  return e;}',
    // one shatter level: a piece shows (its own leading) when the shatter field at its seed passes its threshold;
    // fresh shards jostle (their seeds wobble while the cracks are new)
    'vec2 seedAt(ivec2 c, uint s, float sc, out vec4 fs, out vec2 h, out vec2 b){h=rnd2(c,s);b=vec2(c)+.5+.8*(h-.5);fs=fld(b/sc);',
    '  return b+uTumble*.17*fs.g*vec2(sin(uTime*(5.+3.*h.x)+6.28*h.y),cos(uTime*(4.+3.*h.y)+6.28*h.x));}',
    'float actOf(vec4 fs, vec2 h, float thr){float t=thr+.2*fract(h.x*7.13+h.y*3.7);return smoothstep(t,t+.07,fs.r);}',
    // ...and where the pieces on two sides of a crack were shattered by two different people, that crack is a seam
    'float shards(vec2 p, float sc, uint s, float thr, float wPx, out ivec2 mc, out float line, out float glow, out vec2 sr, out float sline){',
    '  vec2 q=p*sc; ivec2 ci=ivec2(floor(q)); vec2 mr=vec2(0.),h,b,mb=vec2(0.); vec4 fs; float md=9.,ma=0.; mc=ci;',
    '  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ivec2 c=ci+ivec2(i,j);vec2 r=seedAt(c,s,sc,fs,h,b)-q;float d=dot(r,r);',
    '    if(d<md){md=d;mr=r;mc=c;mb=b;ma=actOf(fs,h,thr);}}',
    '  float pxq=uPx*800./sc, oo=ownerAt(mb/sc); line=0.; glow=0.; sline=0.; sr=mr*pxq;',
    '  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){if(i==0&&j==0)continue;ivec2 c=mc+ivec2(i,j);vec2 r=seedAt(c,s,sc,fs,h,b)-q;vec2 dd=r-mr;float l2=dot(dd,dd);',
    '    if(l2<1e-6)continue;float e=dot(.5*(mr+r),dd*inversesqrt(l2))*pxq;float a=max(ma,actOf(fs,h,thr));',
    '    float on=ownerAt(b/sc), df=(oo>0.&&on>0.&&abs(on-oo)>.002)?1.:0.;',
    '    line=max(line,a*(1.-smoothstep(wPx*.5-.6,wPx*.5+.6,e)));glow=max(glow,a*exp(-e/(wPx*2.2)));',
    '    sline=max(sline,a*df*(1.-smoothstep(wPx*1.1-.6,wPx*1.1+.6,e))+a*df*.6*exp(-e/(wPx*3.)));}',
    '  return ma;}',
    'float core(float e, float w){return 1.-smoothstep(w*.5-.7,w*.5+.7,e);}',
    'void main(){',
    '  vec2 p=vec2(vUv.x*uAspect,1.-vUv.y);',
    '  vec4 F0=fld(p); vec3 B0=texture(uBody,kin(p)).rgb;',
    '  float fresh=F0.g, G=F0.b, px=uPx*800.;',
    '  ivec2 id; float eD; int reg=design(p,id,eD); eD*=px;',
    '  float e0=1e3; if(reg==0){ivec2 c0; e0=voro(p*uSc0,0u,.85,c0)*px/uSc0; id=c0;}',
    '  vec3 base=paneCol(reg,id); vec2 ph=rnd2(id,5u);',
    '  float dens=reg==0?.5+.6*ph.x:.66+.4*ph.x;',
    // shards (only computed near shattered glass)
    '  ivec2 c1=ivec2(0),c2=ivec2(0); float a1=0.,a2=0.,l1=0.,l2=0.,g1=0.,g2=0.,q1=0.,q2=0.; vec2 s1=vec2(9.),s2=vec2(9.);',
    '  if(F0.a>.15){a1=shards(p,uSc0*uSplit,1u,.2,3.*uPx,c1,l1,g1,s1,q1);',
    '    if(F0.a>.5) a2=shards(p,uSc0*uSplit*uSplit,2u,.58,2.*uPx,c2,l2,g2,s2,q2);}',
    '  vec2 h1=rnd2(c1,7u), h2=rnd2(c2,8u);',
    '  vec3 col=base;',
    '  col=mix(col,J[reg==0?pickField(h1.y):paneIdx(reg,id+ivec2(0,1))],a1*step(.75,h1.x)*.5);',   // a few shards catch a neighbouring colour
    '  float sj=mix(1.,.62+.75*h1.x,a1)*mix(1.,.62+.75*h2.x,a2);',
    // the glass: streaky cathedral glass, a little mottle, glowing in the middle and darker where the lead holds it,
    // daylight drifting behind it as clouds pass
    '  float ang=ph.y*PI; vec2 dir=vec2(cos(ang),sin(ang));',
    '  float streak=vn(vec2(dot(p,dir)*80.,dot(p,vec2(-dir.y,dir.x))*6.)+ph*50.);',
    '  float tex=.78+.40*streak+.16*(vn(p*42.)-.5)+.10*(vn(p*9.+ph*20.)-.5);',
    '  float eMin=min(e0,eD), thick=mix(.45,1.15,smoothstep(0.,40.*uPx,eMin));',
    '  float day=.72+.34*(1.-p.y)+.46*(vn(p*1.2+vec2(uTime*.010,uTime*.004))-.5)+.20*(vn(p*2.9-vec2(uTime*.016,0.))-.5);',
    '  vec3 glass=col*dens*sj*tex;',
    // the leading: the design and the big panes always; shard cracks are bright while fresh, then turn into lead
    '  float lead0=max(core(e0,5.*uPx),core(eD,6.5*uPx)), crk=max(l1,l2), cglow=max(g1,g2);',
    '  float lead=max(lead0,crk*(1.-fresh)*(1.-max(q1,q2)*smoothstep(.15,.5,B0.g)));',
    '  float strip=smoothstep(.15,.5,B0.g), seam=max(q1,q2)*strip*uSeam;',
    '  float pk=clamp(max(((crk+.5*cglow)*fresh+seam)*3.,G*2.),0.,1.), wk=mix(uWall,1.,pk);',   // wk: the empty-wall factor, back to 1 wherever people light or cracked the glass
    '  vec3 rest=glass*thick*max(day,.2)*.25*uRest*wk*(1.-lead);',
    '  rest+=vec3(1.,.9,.7)*(crk+.5*cglow)*fresh*.10;',
    '  rest+=vec3(1.,.72,.25)*seam*.30;',
    '  float L=dot(rest,LUM); rest*=min(1.,uCap*wk/max(L,1e-5));',
    // the light around people: the glass near you lit up, a warm rim along your outline, bright fresh cracks, glints
    '  float shine=1.+.9*max(a1,a2), m=B0.r;',
    '  vec3 hot=glass*mix(.75,1.1,thick)*shine*G*1.3*uGlow*(1.-lead);',
    '  float rim=smoothstep(.03,.40,m)*(1.-smoothstep(.42,.70,m));',
    '  hot+=mix(vec3(1.,.88,.66),glass*2.,.25)*rim*.6*uRim*(1.-.6*lead);',
    '  hot+=vec3(1.,.88,.64)*(crk+.45*cglow)*fresh*(.5+G)*1.6;',
    '  hot+=vec3(1.,.74,.26)*(seam*3.2+smoothstep(.3,.85,B0.g)*uSeam*.3)*G;',
    '  float tilt=6.2832*fract(h2.y*5.3+h1.y)+uTumble*fresh*uTime*3.;',
    '  float gl=pow(max(0.,cos(tilt-uTime*.5)),28.)*max(a2,a1*.5)*(.35+fresh);',
    '  hot+=vec3(1.,.97,.9)*gl*G*1.4*uSpark*(1.-lead);',
    '  float st=exp(-dot(s2,s2)/5.)+.6*(exp(-abs(s2.x)/1.1)*exp(-abs(s2.y)/6.)+exp(-abs(s2.y)/1.1)*exp(-abs(s2.x)/6.));',
    '  float tw=pow(.5+.5*sin(uTime*(2.+4.*h2.x)+6.28*h2.y),14.)*a2*(.25+.75*fresh);',
    '  hot+=vec3(1.,.97,.92)*st*tw*G*2.*uSpark;',
    // a tapped pane: lit from behind, a ring runs across it, and its colour spills down the wall
    '  for(int i=0;i<6;i++){vec4 T=uTap[i]; if(T.w<=0.) continue; float age=T.z;',
    '    float env=smoothstep(0.,.08,age)*exp(-age/(uTapS*.45))*T.w;',
    '    if(uTapId[i].x==id.x&&uTapId[i].y==id.y&&uTapId[i].z==reg){',
    '      hot+=col*dens*tex*env*3.2*(1.-lead);',
    '      float rr=length(p-T.xy)-age*.3; hot+=vec3(1.,.95,.85)*exp(-rr*rr/.00015)*env*1.6*(1.-lead);}',
    '    vec3 tc=paneCol(uTapId[i].z,uTapId[i].xy); float dx=(p.x-T.x)/(.03+.025*age), dy=p.y-T.y;',
    '    float fall=dy>0.?exp(-dy/(.06+.32*age)):exp(-dy*dy/.0006);',
    '    hot+=tc*exp(-dx*dx)*fall*uSpill*1.1*exp(-age/uTapS)*smoothstep(0.,.25,age)*T.w;}',
    '  vec3 c=rest+(1.-exp(-hot*1.15));',
    '  c*=1.-uDark*smoothstep(.5,.78,m);',               // nothing projected inside a person
    '  o=vec4(c,1.);',
    '}'
  ].join('\n');

  // the same integer hash and design as the shader (so the CPU can name the pane under a fingertip)
  function pcg(x, y) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0; y = (Math.imul(y, 1664525) + 1013904223) >>> 0;
    x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
    x = (x + Math.imul(y, 1664525)) >>> 0; y = (y + Math.imul(x, 1664525)) >>> 0;
    x = (x ^ (x >>> 16)) >>> 0; y = (y ^ (y >>> 16)) >>> 0;
    return [x, y];
  }
  function rnd2(cx, cy, s) { var h = pcg((cx + 8192 + Math.imul(s, 7919)) >>> 0, (cy + 8192 + Math.imul(s, 104729)) >>> 0); return [(h[0] >>> 8) / 16777216, (h[1] >>> 8) / 16777216]; }
  function mod(a, n) { return ((a % n) + n) % n; }
  function design(px, py, aspect) {        // [id x, id y, region] of a designed piece, or null on the field of big panes
    var ex = Math.min(px, aspect - px), ey = Math.min(py, 1 - py), de = Math.min(ex, ey);
    if (de < BW) {
      if (ex < BW && ey < BW) return [-60, (px < aspect * 0.5 ? 0 : 1) + (py < 0.5 ? 0 : 2), 5];
      var hz = ey < BW, len = hz ? aspect - 2 * BW : 1 - 2 * BW, s = (hz ? px : py) - BW, n = Math.max(1, Math.floor(len / BL + 0.5));
      return [-50 - (hz ? (py < 0.5 ? 0 : 1) : (px < aspect * 0.5 ? 2 : 3)), Math.floor(s / (len / n)), 1];
    }
    var best = 9, mi = 0;
    var mc = function (i) { var a = BW + MGAP + MR; return i === 0 ? a : i === 1 ? aspect * 0.5 : aspect - a; };
    for (var i = 0; i < 3; i++) { var d = Math.hypot(px - mc(i), py - 0.5); if (d < best) { best = d; mi = i; } }
    if (best >= MR) return null;
    var r = best, th = Math.atan2(py - 0.5, px - mc(mi)) + Math.PI;
    if (r < RB) return [-10 - mi, 0, 4];
    if (r < MR2) return [-10 - mi, 1 + mod(Math.floor((th + 0.6 * Math.sin(Math.PI * (r - RB) / (MR2 - RB))) / (Math.PI / 4)), 8), 3];
    return [-10 - mi, 20 + mod(Math.floor(th / (Math.PI / 8)), 16), 2];
  }
  function paneAt(x, y, aspect) {          // window (0..1, y down) -> [id x, id y, region] of the pane there
    var px = x * aspect, dz = design(px, y, aspect);
    if (dz) return dz;
    var qx = px * SC0, qy = y * SC0, ix = Math.floor(qx), iy = Math.floor(qy), md = 9, mx = ix, my = iy;
    for (var j = -1; j <= 1; j++) for (var i = -1; i <= 1; i++) {
      var h = rnd2(ix + i, iy + j, 0), rx = i + 0.5 + 0.85 * (h[0] - 0.5) - (qx - ix), ry = j + 0.5 + 0.85 * (h[1] - 0.5) - (qy - iy), d = rx * rx + ry * ry;
      if (d < md) { md = d; mx = ix + i; my = iy + j; }
    }
    return [mx, my, 0];
  }

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Stained Glass needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Stained Glass needs WebGL 2');
    var wallK = 2.0;                 // 'Empty wall' knob (1 = the 2026-10-05 picture): scales the resting window's light and lifts REST_CAP with it, except near people / fresh cracks / seams
    var made = [], destroyed = false;
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    var prog = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { var le = gl.getProgramInfoLog(prog); gl.deleteProgram(prog); throw new Error(le); }
    made.push(['Program', prog]);
    var U = {};
    ['uField', 'uBody', 'uHinv', 'uAspect', 'uTime', 'uPx', 'uSc0', 'uSplit', 'uRest', 'uCap', 'uWall', 'uGlow', 'uRim', 'uSpark', 'uTumble', 'uSeam',
     'uDark', 'uSpill', 'uTapS', 'uTap', 'uTapId'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    var body = WallBody.create(kit, {}), W = WallBody.w, H = WallBody.h, N = W * H;
    function tex(fmt, ifmt, ch) {
      var t = gl.createTexture(); made.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, W, H, 0, fmt, gl.UNSIGNED_BYTE, new Uint8Array(N * ch));
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR); });
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });
      return t;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var fieldTex = tex(gl.RGBA, gl.RGBA8, 4), bodyTex = tex(gl.RGBA, gl.RGBA8, 4);
    var fieldU8 = new Uint8Array(N * 4), bodyU8 = new Uint8Array(N * 4);

    // ---- the state, in Kinect cells (128 x 106)
    var S = new Float32Array(N);        // how shattered the glass is here (0 = big panes, 1 = splinters); it remembers
    var Fr = new Float32Array(N);       // how fresh the cracks are (1 = just cracked, bright; 0 = leaded)
    var Gl = new Float32Array(N);       // the light around people right now
    var Gt = new Float32Array(N);       // ...its target
    var drive = new Float32Array(N);    // how shattered people want the glass here right now
    var nearD = new Float32Array(N);    // distance in cells to the nearest person
    var nearI = new Int32Array(N);      // which person (index into body.people) is nearest
    var owner = new Uint8Array(N);      // whose shatter this is (a person key), for the seams
    var seam = new Float32Array(N), pm = new Float32Array(N), tmp = new Float32Array(N), Sd = new Float32Array(N), lvl = new Uint8Array(N);
    var md = new Float32Array(N), mdD = new Float32Array(N), lastDir = new Int8Array(N), lastFlip = new Float64Array(N), shimmer = 0;   // where a moving part of someone wants fresh splinters (and dilated)
    var tracks = [], nextKey = 1, elapsed = 0, frames = 0, depthFrames = 0, flips = 0, lastFresh = -1e9, cellPx = 10, scaleAt = -1e9;
    var taps = [], prevPts = [], tapCount = 0, tapTimes = [];
    var tapU = new Float32Array(24), tapIdU = new Int32Array(24);

    function cellScale(now) {                 // how many px (on a 1280-wide picture) one Kinect cell covers on the wall
      if (now - scaleAt < 2000) return; scaleAt = now;
      var m = body.hinv(), map = function (x, y) { var X = m[0] * x + m[3] * y + m[6], Y = m[1] * x + m[4] * y + m[7], Z = m[2] * x + m[5] * y + m[8]; return [X / Z * W, Y / Z * H]; };
      var a = map(0.4, 0.5), b = map(0.6, 0.5), c = map(0.5, 0.4), d = map(0.5, 0.6);
      var cx = Math.hypot(b[0] - a[0], b[1] - a[1]), cy = Math.hypot(d[0] - c[0], d[1] - c[1]);
      if (cx > 0.5 && cy > 0.5) cellPx = 0.5 * (0.2 * 1280 / cx + 0.2 * 800 / cy);
    }
    function chamferNear(d, nr) {             // in place: distance (cells) to the nearest person cell, and which person
      var x, y, i, R2 = 1.4142;
      function take(i, j, w) { if (d[j] + w < d[i]) { d[i] = d[j] + w; nr[i] = nr[j]; } }
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { i = y * W + x; if (!d[i]) continue;
        if (x > 0) take(i, i - 1, 1);
        if (y > 0) { take(i, i - W, 1); if (x > 0) take(i, i - W - 1, R2); if (x < W - 1) take(i, i - W + 1, R2); } }
      for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) { i = y * W + x; if (!d[i]) continue;
        if (x < W - 1) take(i, i + 1, 1);
        if (y < H - 1) { take(i, i + W, 1); if (x < W - 1) take(i, i + W + 1, R2); if (x > 0) take(i, i + W - 1, R2); } }
    }
    function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

    // people -> tracks (a key that survives id swaps and short gaps), each with its own calm (hysteresis on stillness)
    function follow(now, dtS) {
      var ppl = body.people, used = {}, out = [];
      for (var k = 0; k < ppl.length; k++) {
        var p = ppl[k], best = null, bd = 0.15;
        for (var q = 0; q < tracks.length; q++) { var t = tracks[q]; if (used[t.key] || now - t.seen > 1500) continue;
          var dd = Math.hypot(t.cx - p.cx, t.cy - p.cy); if (dd < bd) { bd = dd; best = t; } }
        if (!best) { best = {key: nextKey, cx: p.cx, cy: p.cy, seen: now, born: now, moving: true, under: 0, calm: 0, stillT: 0};
          nextKey = nextKey % 250 + 1; tracks.push(best); }
        used[best.key] = true; best.cx = p.cx; best.cy = p.cy; best.seen = now; best.mv = p.moving; best.area = p.area;
        if (p.moving > MOVE_HI) { best.moving = true; best.under = 0; }
        else if (p.moving < MOVE_LO) { best.under += dtS; if (best.under > STILL_AFTER_S) best.moving = false; }
        if (best.moving) { best.calm *= Math.exp(-dtS / 0.25); best.stillT = 0; }
        else { best.calm = Math.min(1, best.calm + dtS / CALM_S); best.stillT += dtS; }
        best.level = ARRIVE + (STILL_LEVEL - ARRIVE) * smooth(best.calm);
        best.light = 1 + (GHOST_DIM - 1) * smooth((best.stillT - GHOST_S) / 10);
        out.push(best);
      }
      tracks = tracks.filter(function (t) { return now - t.seen <= 1500; });
      return out;
    }

    // a new depth frame: where people are, how far every cell is from them, what they want the glass to do
    function fold(now) {
      var lab = body.label, mo = body.motion, mask = body.mask, dtS = Math.min(0.2, Math.max(0, (now - lastFresh) / 1000));
      if (lastFresh < 0 || dtS <= 0) dtS = 1 / 30;
      lastFresh = now; depthFrames++;
      var own = follow(now, dtS), bandC = BAND_PX / cellPx, lightC = LIGHT_PX / cellPx, i;
      for (i = 0; i < N; i++) { var on = lab[i] >= 0; nearD[i] = on ? 0 : 1e6; nearI[i] = on ? lab[i] : -1; }
      chamferNear(nearD, nearI);
      for (i = 0; i < N; i++) {                                          // local motion, near people only (a 3x3 mean)
        var x = i % W, y = (i / W) | 0, s = 0, n = 0;
        if (nearD[i] > bandC) { tmp[i] = 0; continue; }
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue; s += mo[yy * W + xx]; n++; }
        tmp[i] = s / n;
      }
      for (i = 0; i < N; i++) {                                          // a sweeping arm shatters its path (coherent motion only)
        var tm = nearI[i] >= 0 ? own[nearI[i]] : null;
        md[i] = tm && nearD[i] <= bandC ? smooth((tmp[i] - 0.15) / 0.35) * (tm.moving || tmp[i] > 0.4 ? 1 : 0) : 0;
      }
      dilate(md, mdD, 2);                                                // ...and a little band around it
      for (i = 0; i < N; i++) {
        var d = nearD[i], t = nearI[i] >= 0 ? own[nearI[i]] : null;
        if (!t || d > bandC + 1) { drive[i] = 0; Gt[i] = 0; pm[i] = 0; continue; }
        var w = 1 - smooth((d - 1) / Math.max(1, bandC - 1));            // 1 at the outline, easing to 0 at the band's edge
        var m = mdD[i];
        drive[i] = Math.max(t.level * w, ARRIVE * m);
        Gt[i] = t.light * Math.max(Math.exp(-d / Math.max(0.5, lightC)) * (0.85 + 0.15 * (t.moving ? 1 : 0)), 0.9 * m);
        pm[i] = d <= 2.5 ? mask[i] : 0;
        if (drive[i] > 0.2) owner[i] = t.key;
      }
    }
    function computeSeam() {                  // where the shattered glass of two people who are here together meets
      var here = {}; tracks.forEach(function (t) { if (lastFresh - t.seen < 200 && t.area >= SEAM_AREA && lastFresh - t.born > 700) here[t.key] = true; });
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var i = y * W + x, o = owner[i], v = 0;
        if (S[i] <= 0.22) { seam[i] = 0; continue; }
        if (o && here[o]) for (var dy = -1; dy <= 1 && !v; dy++) for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          var j = yy * W + xx; if (owner[j] && owner[j] !== o && here[owner[j]] && S[j] > 0.22) { v = 1; break; }
        }
        if (v) seam[i] = 1;                    // a seam stays as long as its glass stays shattered
      }
    }
    function dilate(src, dst, r) {            // max filter (2r+1) square, separable
      var x, y, i, k, m;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { m = 0; for (k = -r; k <= r; k++) { var xx = x + k; if (xx >= 0 && xx < W && src[y * W + xx] > m) m = src[y * W + xx]; } tmp[y * W + x] = m; }
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { m = 0; for (k = -r; k <= r; k++) { var yy = y + k; if (yy >= 0 && yy < H && tmp[yy * W + x] > m) m = tmp[yy * W + x]; } dst[y * W + x] = m; }
    }

    function evolve(dt, now) {                // every animation frame: shatter, heal, cool the cracks, follow the light
      var live = body.fresh || now - body.frameMs < HOLD_MS, i;
      if (!live) { for (i = 0; i < N; i++) { drive[i] = 0; Gt[i] = 0; } }
      if (dt <= 0) return;
      if (body.fresh === false && live) return;                         // a short stall: hold everything as it is
      var kF = Math.exp(-dt / FRESH_S), kN = Math.exp(-dt / HEAL_NEAR_S), kH = Math.exp(-dt / HEAL_S), kC = Math.exp(-dt / 0.6);
      var kUp = 1 - Math.exp(-dt / 0.03), kDn = 1 - Math.exp(-dt / 0.35), kM = Math.exp(-dt / 0.12);
      for (i = 0; i < N; i++) {
        var s = S[i], dv = drive[i];
        if (dv > s + JUMP) { Fr[i] = Math.max(Fr[i] * kF, Math.min(1, (dv - s) * 4 + (s < 0.2 ? 0.6 : 0))); S[i] = dv; }   // it shatters
        else if (dv > s) { Fr[i] *= kF; S[i] = dv + (s - dv) * kC; }       // a small rise (depth jitter at the edges) only creeps
        else { Fr[i] *= kF; S[i] = dv + (s - dv) * (dv > 0.02 ? kN : kH); }
        var g = Gl[i], gt = Gt[i]; Gl[i] = g + (gt - g) * (gt > g ? kUp : kDn);
        if (!live) pm[i] *= kM;
        var L0 = lvl[i], L = L0, sv = S[i];                   // a visible level change needs a clear crossing (+-0.03)
        if (L0 < 2 && sv > 0.65) L = 2; else if (L0 < 1 && sv > 0.28) L = 1; else if (L0 > 0 && sv < 0.22) L = 0; else if (L0 > 1 && sv < 0.59) L = 1;
        if (L !== lvl[i]) {                    // test stats: level changes, and reversals within 1.5 s (= shimmer)
          var dir = L > lvl[i] ? 1 : -1; flips++;
          if (lastDir[i] === -dir && now - lastFlip[i] < 1500) shimmer++;
          lastDir[i] = dir; lastFlip[i] = now; lvl[i] = L; }
      }
    }

    function upload() {
      dilate(S, Sd, 4);
      for (var i = 0; i < N; i++) {
        var j = i * 4;
        fieldU8[j] = Math.round(S[i] * 255); fieldU8[j + 1] = Math.round(Math.min(1, Fr[i]) * 255);
        fieldU8[j + 2] = Math.round(Math.min(1, Gl[i]) * 255); fieldU8[j + 3] = Math.round(Sd[i] * 255);
        bodyU8[j] = Math.round(Math.min(1, pm[i]) * 255); bodyU8[j + 1] = Math.round(seam[i] * 255); bodyU8[j + 2] = S[i] > 0.22 ? owner[i] : 0;
      }
      gl.bindTexture(gl.TEXTURE_2D, fieldTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, fieldU8);
      gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, bodyU8);
    }

    // fingertips: a fingertip that just landed taps the pane under it
    function tap(x, y, now) {
      if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return;
      var aspect = canvas.width / Math.max(1, canvas.height), id = paneAt(x, y, aspect);
      for (var i = 0; i < taps.length; i++) if (taps[i].id[0] === id[0] && taps[i].id[1] === id[1] && taps[i].id[2] === id[2] && now - taps[i].t0 < 400) return;
      tapTimes = tapTimes.filter(function (q) { return now - q < 1000; });
      if (tapTimes.length >= 6) return;                                // at most 6 new taps a second, whatever happens
      tapTimes.push(now); tapCount++;
      taps.push({x: x * aspect, y: y, t0: now, id: id});
      if (taps.length > 6) taps.shift();
    }
    function fingers(now) {
      var f = kit.fingers, pts = (f && Date.now() - f.t <= 160 && Array.isArray(f.pts)) ? f.pts : [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; if (!p) continue;
        var seen = false;
        for (var k = 0; k < prevPts.length; k++) if (Math.hypot(prevPts[k][0] - p[0], prevPts[k][1] - p[1]) < 0.05) { seen = true; break; }
        if (!seen) tap(p[0], p[1], now);
      }
      prevPts = pts.filter(function (p) { return p; }).map(function (p) { return [p[0], p[1]]; });
    }

    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); elapsed += dt; frames++;
      var fresh = body.update(dt, now);
      cellScale(now);
      if (fresh) { fold(now); }
      evolve(dt, now);
      if (fresh) computeSeam();
      fingers(now);
      if (fresh || frames % 2 === 0 || dt === 0) upload();              // the state changes slowly: ~30 uploads a second is plenty
      taps = taps.filter(function (t) { return now - t.t0 < TAP_S * 3000; });
      for (var i = 0; i < 6; i++) {
        var t = taps[i];
        if (t) { tapU.set([t.x, t.y, (now - t.t0) / 1000, 1], i * 4); tapIdU.set([t.id[0], t.id[1], t.id[2], 1], i * 4); }
        else { tapU.set([0, 0, 0, 0], i * 4); tapIdU.set([0, 0, -1, 0], i * 4); }
      }
      var CW = canvas.width, CH = canvas.height;
      gl.viewport(0, 0, CW, CH); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fieldTex); gl.uniform1i(U.uField, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(U.uBody, 1);
      gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
      gl.uniform1f(U.uAspect, CW / Math.max(1, CH)); gl.uniform1f(U.uTime, elapsed); gl.uniform1f(U.uPx, CH / 800);
      gl.uniform1f(U.uSc0, SC0); gl.uniform1f(U.uSplit, SPLIT); gl.uniform1f(U.uRest, REST); gl.uniform1f(U.uCap, REST_CAP / 255); gl.uniform1f(U.uWall, wallK);
      gl.uniform1f(U.uGlow, GLOW); gl.uniform1f(U.uRim, RIM); gl.uniform1f(U.uSpark, SPARKLE); gl.uniform1f(U.uTumble, TUMBLE);
      gl.uniform1f(U.uSeam, SEAM); gl.uniform1f(U.uDark, DARK_INSIDE); gl.uniform1f(U.uSpill, SPILL); gl.uniform1f(U.uTapS, TAP_S);
      gl.uniform4fv(U.uTap, tapU); gl.uniform4iv(U.uTapId, tapIdU);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    }
    function touch(t) { if (t && t.first) tap(t.x, t.y, performance.now()); }   // fallback when no kit.fingers
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.StainedglassSet === set) delete window.StainedglassSet;
      if (window.StainedglassWake === wake) delete window.StainedglassWake; kit.wantDepth(false);
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
      if (window.__stainedglassDebug) try { delete window.__stainedglassDebug; } catch (e) { window.__stainedglassDebug = undefined; }
    }
    kit.wantDepth(true);
    if (window.WallTest) window.__stainedglassDebug = function (box) {   // sandbox only (the live wall has no WallTest)
      var out = {frames: frames, depthFrames: depthFrames, flips: flips, shimmer: shimmer, taps: tapCount, cellPx: +cellPx.toFixed(2), fresh: body.fresh,
                 people: tracks.map(function (t) { return {key: t.key, moving: t.moving, calm: +t.calm.toFixed(2), level: +(t.level || 0).toFixed(2), stillT: +t.stillT.toFixed(1), mv: +(t.mv || 0).toFixed(3)}; }),
                 foldMs: +body.foldMs.toFixed(2), glError: gl.getError()};
      if (box) {                               // stats of the state inside a window box [x0, y0, x1, y1]
        var m = body.hinv(), n = 0, s = 0, f = 0, g = 0, sh = 0, fine = 0, sm = 0, owners = {};
        for (var a = 0; a < 24; a++) for (var b = 0; b < 24; b++) {
          var x = box[0] + (box[2] - box[0]) * (a + 0.5) / 24, y = box[1] + (box[3] - box[1]) * (b + 0.5) / 24;
          var X = m[0] * x + m[3] * y + m[6], Y = m[1] * x + m[4] * y + m[7], Z = m[2] * x + m[5] * y + m[8];
          var cx = Math.max(0, Math.min(W - 1, Math.floor(X / Z * W))), cy = Math.max(0, Math.min(H - 1, Math.floor(Y / Z * H))), i = cy * W + cx;
          n++; s += S[i]; f += Fr[i]; g += Gl[i]; sm += seam[i]; if (S[i] > 0.25) sh++; if (S[i] > 0.62) fine++;
          if (owner[i] && S[i] > 0.22) owners[owner[i]] = (owners[owner[i]] || 0) + 1;
        }
        out.box = {S: +(s / n).toFixed(3), fresh: +(f / n).toFixed(3), light: +(g / n).toFixed(3), shattered: +(sh / n).toFixed(3), fine: +(fine / n).toFixed(3), seam: +(sm / n).toFixed(3), owners: owners};
      }
      var tot = 0, sh2 = 0, by = {}; for (var k = 0; k < N; k++) { tot += S[k]; if (S[k] > 0.25) { sh2++; if (owner[k]) by[owner[k]] = (by[owner[k]] || 0) + 1; } }
      out.meanS = +(tot / N).toFixed(4); out.shatteredCells = sh2; out.shatteredBy = by;
      return out;
    };
    if (window.WallTest) window.__stainedglassDebug.pane = function (x, y) {   // the pane under a window point, and its middle
      var aspect = canvas.width / Math.max(1, canvas.height), id = paneAt(x, y, aspect), sx = null, sy = null;
      if (id[2] === 0) { var h = rnd2(id[0], id[1], 0); sx = (id[0] + 0.5 + 0.85 * (h[0] - 0.5)) / SC0 / aspect; sy = (id[1] + 0.5 + 0.85 * (h[1] - 0.5)) / SC0; }
      return {id: id, seed: sx === null ? null : [+sx.toFixed(4), +sy.toFixed(4)]};
    };
    function set(opts) {
      if (!opts || destroyed) return {band: BAND_PX, light: LIGHT_PX, split: SPLIT, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.band)) BAND_PX = Math.max(40, Math.min(250, opts.band));
      if (Number.isFinite(opts.light)) LIGHT_PX = Math.max(20, Math.min(120, opts.light));
      if (Number.isFinite(opts.split)) SPLIT = Math.max(1.5, Math.min(4, opts.split));
      return {band: BAND_PX, light: LIGHT_PX, split: SPLIT, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      var force = true;
      try {
        if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
      } catch (e) {}
    }
    window.StainedglassSet = set;
    window.StainedglassWake = wake;
    if (window._stainedglassFx) set(window._stainedglassFx);

    return {frame: frame, touch: touch, destroy: destroy};
  }
})();
