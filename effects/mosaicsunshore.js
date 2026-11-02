/* Mosaic Sun Shore -- foreground mosaic, sunset and tile-inlaid stars, 2026-10-28.
 * The person is a foreground mosaic silhouette in front of the sun and water.
 * The sun follows a smooth sky arc, sets behind the sea, and gives way to a moon and stars.
 * Bright, coloured mosaic tiles replace contour-driven body remeshing;
 * slow mint ripples brighten nearby water without displacing tiles or tracking the head.
 * Existing tap / hold / trail gestures remain. The host supplies optional music.
 * Based on Mosaic Sun's jdxyw/generativeart port; one WebGL2 pass, shared WallBody input.
 */
(function () {
  'use strict';
  registerWallPlugin({id: 'mosaicsunshore', title: 'Mosaic Sun Shore', author: 'Claude Opus 5.5 (genart build-out, Builder A)', create: create});

  // ---- shared input helpers (copied from lab/plugins/prismpathsflow.js; never mutate the host kit)
  function refreshContacts(kit, graceMs) {
    var wakes = [], last = [], lastSeen = 0, lastStamp = -Infinity, state = 'empty';
    function valid(p) { return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1; }
    function clean(raw) { var out = []; (Array.isArray(raw) ? raw : []).slice(0, 32).forEach(function (p) { if (valid(p) && out.length < 8 && !out.some(function (q) { return Math.hypot(q[0] - p[0], q[1] - p[1]) < .015; })) out.push([p[0], p[1]]); }); return out; }
    function read() {
      var now = Date.now(), f = kit.fingers;
      wakes = wakes.filter(function (p) { return now >= p.t && now - p.t <= 240; });
      if (f) {
        wakes = [];
        if (!Number.isFinite(f.t) || now - f.t > 250 || f.t - now > 50) { last = []; state = 'stale'; return []; }
        if (f.t < lastStamp) { state = 'stale'; return []; }
        lastStamp = f.t;
        var pts = clean(f.pts);
        if (pts.length) { last = pts; lastSeen = f.t; state = 'fresh'; return pts; }
        if (last.length && now - lastSeen < graceMs) { state = 'recovering'; return last.map(function (p) { return p.slice(); }); }
        last = []; state = 'empty'; return [];
      }
      var sparse = wakes.map(function (p) { return [p.x, p.y]; });
      (kit.touches || []).forEach(function (p) { if (p && Number.isFinite(p.t) && now - p.t >= 0 && now - p.t <= 240) sparse.push([p.x, p.y]); });
      state = sparse.length ? 'sparse' : 'empty'; return clean(sparse);
    }
    function wake(x, y) { if (!valid([x, y]) || kit.fingers) return; var now = Date.now(), old = wakes.find(function (p) { return Math.hypot(p.x - x, p.y - y) < .025; }); if (old) { old.x = x; old.y = y; old.t = now; } else { if (wakes.length >= 8) wakes.shift(); wakes.push({x: x, y: y, t: now}); } }
    return {read: read, wake: wake, clear: function () { wakes = []; last = []; }, size: function () { return wakes.length; }, get state() { return state; }};
  }
  function refreshHue(initial) {
    var value = Number.isFinite(initial) ? initial : 0;
    return {get value() { return value; }, snap: function (v) { value = v; }, step: function (target, dt) { var d = ((target - value + 540) % 360) - 180; if (Math.abs(d) < .001) { value = target % 360; return; } value = (value + d * (1 - Math.exp(-Math.max(0, Math.min(.1, dt)) / .18)) + 360) % 360; }};
  }

  // ---- tuning
  var SUN_R = 216;            // sun radius, design px (1280 x 800 space): the Go's 0.27 of the frame height (its loop GIF is square), was 182
  var SKY_CYCLE_S = 90, MOON_R = 108; // one continuous day/night cycle, independent of bodies and wave speed
  var RIPPLE_SPEED = 560;     // px/s of a tap's wave course
  var RIPPLE_GAP_S = 0.3;     // at most one new wave course per this many seconds
  var HOLD_R = 250;           // px: the hold's reach
  var HOLD_STILL_S = 0.95;    // a contact this still (within HOLD_MOVE px) for this long is a hold
  var HOLD_MOVE = 22;
  var SPIN_S = 24;            // the ring field makes one full turn around the sun in this many seconds at wave speed 100 %
                              // (Billy, 2026-10-22: "it should move like a whirlpool not back and forth"); the sun facets no longer wobble
  var LOOP_S = 1.12;          // one phase loop (the Go engine's 360-degree loop) at wave speed 100 %: the library's mosaicsun_loop.gif is
                              // 16 frames at 70 ms = 1.12 s per loop (Billy, 2026-10-22: "mosaic sun should have these movements"); it was 24 s
  var NRIP = 8, NHOLD = 3, NPPL = 3, NTRAIL = 12;   // shader slots: ripples, holds, glint trail; people read per depth frame

  var VS = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uBody; uniform mat3 uHinv;',
    'uniform vec2 uRes; uniform float uS, uDW;',
    'uniform vec3 uSun; uniform float uCellPx, uGeo, uCol, uSeed, uScale, uGrout, uHue, uLight, uBodyOn, uSpin, uShore, uShorePhase, uNight, uMoon;',
    'uniform vec4 uRip[8]; uniform float uRipG[8]; uniform vec4 uHold[3]; uniform vec4 uTrail[12];',
    'out vec4 o;',
    'const float PI=3.14159265, TAU=6.28318531, AS=1.4, JUMP=2.1;',
    'const vec3 C_ORANGE=vec3(232.,126.,44.)/255., C_AMBER=vec3(238.,174.,52.)/255., C_SUN=vec3(248.,210.,82.)/255.,',
    '  C_TERRA=vec3(188.,66.,38.)/255., C_ESP=vec3(48.,30.,32.)/255., C_MINT=vec3(154.,212.,188.)/255., C_ICE=vec3(214.,240.,226.)/255.,',
    '  C_SEA=vec3(88.,172.,168.)/255., C_NAVY=vec3(22.,26.,48.)/255., C_COBALT=vec3(42.,112.,168.)/255., C_INDIGO=vec3(28.,38.,82.)/255.,',
    '  C_MAG=vec3(212.,28.,118.)/255., C_PLUM=vec3(118.,22.,74.)/255.;',
    'float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}',
    'vec2 kin(vec2 P){vec3 h=uHinv*vec3(P.x/uDW,P.y/800.,1.);return h.xy/max(h.z,1e-6);}',
    // ripples: x = how many wave courses have passed this point, y = the glow of a front passing now
    'vec2 ripAt(vec2 c){float n=0.,g=0.;for(int i=0;i<8;i++){vec4 R=uRip[i];float dd=R.z-length(c-R.xy);',
    '  if(R.z>=0.&&dd>0.){n+=1.;g=max(g,smoothstep(0.,8.,dd)*(1.-smoothstep(34.,80.,dd))*uRipG[i]+.3*(1.-smoothstep(0.,260.,dd))*uRipG[i]);}}return vec2(n,g);}',
    'float trailAt(vec2 c){float g=0.;for(int i=0;i<12;i++){vec4 T=uTrail[i];if(T.w>0.)g=max(g,T.w*(1.-smoothstep(T.z*.25,T.z,length(c-T.xy))));}return g*.75;}',
    'float holdAt(vec2 c){float w=0.;for(int i=0;i<3;i++){vec4 H=uHold[i];if(H.w>0.)w=max(w,H.w*(1.-smoothstep(H.z*.35,H.z,length(c-H.xy))));}return w;}',
    // ---- the Go colour samplers
    'vec3 skyCol(vec2 c,float j,float ph){vec2 d=c-vec2(uDW*.5,400.);float r=length(d),ang=atan(d.y,d.x);',
    '  float u=(r-216.)/(2.04*216.),diag=(d.x*.65-d.y*.76)/216.;',
    '  float sw=sin(u*14.-ang*2.-ph+.6*sin(diag*2.2+ph)),bw=cos(ang*5.+u*6.5-ph);',
    '  if(u<.42&&bw>.48+.35*u)return j>.55?C_AMBER:C_ORANGE;',
    '  if(j<.085||(sw<-.72&&j<.35))return C_NAVY;',
    '  if(j>.93&&u<.65)return C_AMBER;',
    '  float v=sw+(j-.5)*.45;return v>.62?C_ICE:v>.08?C_MINT:v>-.42?C_SEA:C_COBALT;}',
    'vec3 waveCol(vec2 c,float bf,float j,float ph){float nx=c.x/uDW,ny=(c.y-464.)/336.;',
    '  float mm=(1.-clamp(nx*1.55,0.,1.))*clamp(ny*1.35,0.,1.);',
    '  float wp=sin(nx*9.5+bf*11.-ph+.8*cos(nx*4.2+ph));',
    '  if(mm>.32&&(wp>-.15||j<mm*.75))return j<.18?C_PLUM:j>.86?C_ORANGE:C_MAG;',
    '  if(j<.12)return C_NAVY;',
    '  return wp>.45?C_MINT:wp>.02?C_SEA:wp>-.48?C_COBALT:C_INDIGO;}',
    'vec3 sunCol(vec2 c,float idx){vec2 d=(c-uSun.xy)/uSun.z;float rn=length(d),ang=atan(d.y,d.x);',
    '  if(uMoon>.5){float cr=h21(vec2(idx,17.));return mix(vec3(.38,.57,.68),C_ICE,clamp(.78-d.x*.2-d.y*.12-(cr>.76?.28:0.),.25,1.));}',
    '  if(rn>.54&&ang>-.25&&ang<1.85)return(rn>.68||mod(idx,3.)<.5)?C_ESP:C_TERRA;',
    '  float db=d.x*.72+d.y*.68;',
    '  if(rn<.34&&db<.12)return C_SUN;',
    '  if(db<-.22)return mod(idx,2.)<.5?C_AMBER:C_SUN;',
    '  if(db<.18)return mod(idx,3.)<.5?C_AMBER:C_ORANGE;',
    '  if(db<.52)return mod(idx,2.)<.5?C_ORANGE:C_TERRA;',
    '  return C_TERRA;}',
    // ---- geometry helpers
    'float crest(float x,float wb){float nx=x/uDW,bf=clamp(wb/33.,0.,1.);',
    '  return 28.*AS*sin(nx*TAU*1.35+wb*.1-uGeo)+16.*AS*cos(nx*TAU*2.4-wb*.12+.8+uGeo)-22.*AS*exp(-pow((nx-.24)/.22,2.))*sin(bf*PI);}',
    'float horizon(float x){return 480.+24.*AS*sin(x/(.18*uDW)+.4-uGeo)-18.*AS*cos(x/(.31*uDW)+uGeo);}',
    'vec2 skyCentre(vec2 cc,float N,float ring,float thick){float thF=ring*.37+cc.x/N*TAU;float th=thF-uSpin;',
    '  float r=216.+cc.y*thick;r+=8.5*AS*sin(3.*thF+cc.y*.32-uGeo);return vec2(uDW*.5,400.)+r*vec2(cos(th),sin(th));}',
    'float cr(vec2 a,vec2 b){return a.x*b.y-a.y*b.x;}',
    'bool inTri(vec2 p,vec2 a,vec2 b,vec2 c){float d1=cr(b-a,p-a),d2=cr(c-b,p-b),d3=cr(a-c,p-c);',
    '  return !((d1<0.||d2<0.||d3<0.)&&(d1>0.||d2>0.||d3>0.));}',
    'float segD(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.,1.);return length(pa-ba*h);}',
    'vec2 sunVert(float iu,float iv,vec2 ua,vec2 va){vec2 S=uSun.xy;float rS=uSun.z;float uN=iu/7.*2.-1.,vN=iv/7.*2.-1.;vec2 j=vec2(0.);',
    '  if(iu>.5&&iu<6.5&&iv>.5&&iv<6.5){float sd=mod(uSeed+ripAt(S+(uN*ua+vN*va)*rS).x,64.);',
    '    j=(vec2(h21(vec2(iu,iv)+sd*9.13),h21(vec2(iv+11.,iu)+sd*5.71))-.5)*.24*rS;}',
    '  vec2 p=S+((uN+.22*sin(vN*PI*.8))*ua+vN*va)*rS*1.02+j;vec2 dp=p-S;float L=length(dp);',
    '  if(L>rS*.985)p=S+dp/L*rS*.985;return p;}',
    'void main(){',
    '  vec2 P=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uS;',
    '  vec2 k0=kin(P);',
    '  float inK=(k0.x>=0.&&k0.x<=1.&&k0.y>=0.&&k0.y<=1.)?1.:0.;',
    '  vec2 bs=texture(uBody,clamp(k0,0.,1.)).rg;',
    '  float m=clamp(bs.r,0.,1.)*inK;',
    '  float fw=max(fwidth(m),.02),bodyAlpha=smoothstep(.35,.65,m)*uBodyOn;',
    '  float rim=exp(-pow((m-.5)/(fw*1.4),2.))*uBodyOn*inK;',
    '  vec2 S=uSun.xy;float rS=uSun.z;vec2 d=P-S;float rr=length(d);',
    '  vec3 col=C_NAVY,gcol=C_NAVY;float e=99.,glow=0.,shade=1.,split=0.;bool isSun=false;',
    '  bool sea=P.y>horizon(P.x);',                        // the sea rolls IN FRONT of the sun (Billy, 2026-10-22: "the sun should be behind the wave")
    '  if(rr<rS*1.01&&!sea){',                             // ---- the low-poly sun core (only above the waterline)
    '    isSun=true;gcol=mix(C_ESP,C_NAVY,uMoon);col=gcol;',
    '    float a0=-.56;vec2 ua=vec2(cos(a0),sin(a0)),va=vec2(-ua.y,ua.x);float R=rS*1.02;',
    '    float A=dot(d,ua)/R,B=dot(d,va)/R;float uN=A-.22*sin(B*PI*.8),vN=B;',
    '    float iu0=floor((uN+1.)*3.5),iv0=floor((vN+1.)*3.5);',
    '    vec2 V[16];',
    '    for(int a=0;a<4;a++)for(int b=0;b<4;b++)V[a*4+b]=sunVert(clamp(iu0-1.+float(a),0.,7.),clamp(iv0-1.+float(b),0.,7.),ua,va);',
    '    for(int a=0;a<3;a++)for(int b=0;b<3;b++){',
    '      float iu=iu0-1.+float(a),iv=iv0-1.+float(b);if(iu<0.||iu>6.||iv<0.||iv>6.)continue;',
    '      vec2 p00=V[a*4+b],p10=V[(a+1)*4+b],p11=V[(a+1)*4+b+1],p01=V[a*4+b+1];',
    '      vec2 cen=(p00+p10+p11+p01)*.25;if(length(cen-S)>rS*.97)continue;',
    '      bool even=mod(iu+iv,2.)<.5;bool in1=inTri(P,p00,p10,p11),in2=inTri(P,p00,p11,p01);',
    '      float idx=(iu*7.+iv)*2.;vec2 fc=vec2(0.);float ed=99.;bool hit=false;',
    '      if(even&&(in1||in2)){hit=true;fc=cen;ed=min(min(segD(P,p00,p10),segD(P,p10,p11)),min(segD(P,p11,p01),segD(P,p01,p00)));}',
    '      else if(!even&&in1){hit=true;fc=(p00+p10+p11)/3.;ed=min(min(segD(P,p00,p10),segD(P,p10,p11)),segD(P,p11,p00));}',
    '      else if(!even&&in2){hit=true;idx+=1.;fc=(p00+p11+p01)/3.;ed=min(min(segD(P,p00,p11),segD(P,p11,p01)),segD(P,p01,p00));}',
    '      if(hit){',
    '        float ws=holdAt(fc);',
    '        if(ws>h21(vec2(idx,9.7))*.92+.04){',             // a hold splits the facet into four (edge midpoints)
    '          vec2 ta=p00,tb=in1?p10:p11,tc=in1?p11:p01;vec2 ab=(ta+tb)*.5,bc=(tb+tc)*.5,ca=(tc+ta)*.5;float sb=3.;',
    '          if(inTri(P,ta,ab,ca)){tb=ab;tc=ca;sb=0.;}else if(inTri(P,ab,tb,bc)){ta=ab;tc=bc;sb=1.;}',
    '          else if(inTri(P,ca,bc,tc)){ta=ca;tb=bc;sb=2.;}else{ta=ab;tb=bc;tc=ca;}',
    '          fc=(ta+tb+tc)/3.;idx=idx*8.+sb+(in1?0.:4.);ed=min(min(segD(P,ta,tb),segD(P,tb,tc)),segD(P,tc,ta));split=1.;}',
    '        col=sunCol(fc,idx);e=ed;vec2 rp=ripAt(fc);glow=max(rp.y,trailAt(fc));shade=.94+.1*h21(vec2(idx,mod(uSeed+rp.x,64.)));break;}',
    '    }',
    '  } else {',
    '    float thick=9.5*uScale;',
    '    vec2 cen=P;vec2 f=vec2(.5);vec2 tsz=vec2(thick);vec2 id=vec2(0.);float kind=0.;',
    '    vec2 cc=vec2(0.);float N=1.,ring=0.,sh=0.,band=0.;',
    '      float hz=horizon(P.x);',
    '      if(P.y>hz){',                                    // ---- the sea: rolling wave bands
    '        float sp=thick*.9,wb0=(P.y-464.)/sp,bF=(P.y-464.-crest(P.x,wb0))/sp;',
    '        band=floor(bF);f.y=bF-band;float bl=(22.+6.*sin(band*.6))*uScale;float par=mod(band,2.);',
    '        float xo=-30.*AS+par*bl*.45;sh=par<.5?.38:-.28;',
    '        float sU=(P.x-xo)/bl-sh*(f.y-.5)*sp/bl;float kk=floor(sU);f.x=sU-kk;',
    '        cc=vec2(kk+.5,band+.5);id=vec2(kk,band)+vec2(0.,2000.);tsz=vec2(bl,sp);kind=1.;N=bl;ring=xo;',
    '        float xc=xo+cc.x*bl;cen=vec2(xc,464.+cc.y*sp+crest(xc,cc.y));',
    '      } else {',                                       // ---- the sky: rings stay anchored while the sun travels
    '        vec2 skyD=P-vec2(uDW*.5,400.);float skyR=length(skyD);',
    '        float th=atan(skyD.y,skyD.x)+uSpin;float ringEst=(skyR-216.)/thick;',   // spin about the fixed field centre
    '        float rF=(skyR-216.-8.5*AS*sin(3.*th+ringEst*.32-uGeo))/thick;',
    '        ring=floor(rF);f.y=rF-ring;float rB=max(thick,216.+(ring+.5)*thick);',
    '        float bl=clamp((21.+4.5*sin(ring*.7))*uScale,16.*uScale,34.*uScale);',
    '        N=max(18.,floor(TAU*rB/bl+.5));float lenU=TAU*rB/N;sh=.32*cos(th*2.+ring*.25);',
    '        float sU=fract((th-ring*.37)/TAU)*N-sh*(f.y-.5)*thick/lenU;float kk=floor(sU);f.x=sU-kk;kk=mod(kk,N);',
    '        cc=vec2(kk+.5,ring+.5);id=vec2(kk,ring);tsz=vec2(lenU,thick);kind=0.;',
    '        cen=skyCentre(cc,N,ring,thick);',
    '      }',
    '      e=abs(P.y-hz)*.92;',                             // the waterline is a grout seam
    // Pick star tesserae by the parent tile: the light travels with the sky and survives a hold split.
    '    float starSeed=h21(id+vec2(19.,83.));',
    // the hold: a brick splits 2x2 when the hold weight at its centre beats its own coin
    '    float w=holdAt(cen);',
    '    if(w>h21(id+vec2(7.13,3.31))*.92+.04){',
    '      vec2 sub=floor(f*2.);f=fract(f*2.);cc=floor(cc)+(sub+.5)*.5;id=id*2.+sub+vec2(517.,0.);tsz*=.5;split=1.;',
    '      if(kind<.5)cen=skyCentre(cc,N,ring,thick);',
    '      else if(kind<1.5){float xc=ring+cc.x*N;cen=vec2(xc,464.+cc.y*thick*.9+crest(xc,cc.y));}',
    '    }',
    '    vec2 rp=ripAt(cen);float sd=mod(uSeed+rp.x,64.);float ph=uCol+rp.x*JUMP;',
    '    float j=h21(id+sd*vec2(17.17,3.71));',
    '    if(kind<.5)col=skyCol(cen,j,ph);',
    '    else if(kind<1.5)col=waveCol(cen,clamp(cc.y/33.,0.,1.),j,ph);',
    // Night colours are still individual tesserae; preserve grout and the sea geometry.
    '    vec3 nightCol=kind<.5?mix(vec3(.055,.075,.18),vec3(.18,.32,.43),j):mix(vec3(.035,.08,.19),vec3(.14,.34,.40),j);',
    '    col=mix(col,nightCol,uNight);',
    '    float dusk=4.*uNight*(1.-uNight)*exp(-abs(cen.y-440.)/130.);',
    '    col=mix(col,mix(C_TERRA,C_AMBER,j),dusk*.6);',
    '    float above=1.-smoothstep(470.,790.,uSun.y);',
    '    float refl=exp(-pow((cen.x-uSun.x+24.*sin(cen.y*.045+uGeo))/(30.+max(cen.y-480.,0.)*.23),2.));',
    '    if(kind>.5)col=mix(col,mix(C_AMBER,C_ICE,uMoon),refl*above*(.18+.22*j));',
    // Stars are the tile material, before bevel/shading/grout, never screen-space points.
    '    if(kind<.5){',
    '      float tw=1.18+.12*sin(uShorePhase*.45+starSeed*41.);',
    '      col=mix(col,C_ICE*tw,step(.98,starSeed)*uNight);',
    '    }',
    '    glow=max(rp.y,trailAt(cen));',
    '    vec2 ef=min(f,1.-f)*tsz;ef.x/=sqrt(1.+sh*sh);e=min(e,min(ef.x,ef.y));',
    '    float dome=max(abs(f.x-.5),abs(f.y-.5))*2.;shade=(.92+.1*h21(id+sd+5.3))*(1.-.12*dome*dome*dome);',
    '  }',
    '  col*=shade*(1.+.1*split);',
    '  float gw=uGrout*.5*uS;float a=smoothstep(gw-.6,gw+.6,e*uS);',
    '  col=mix(gcol*(isSun?1.:.9),col,a);',
    '  vec3 lamp=mix(C_SUN,C_ICE,uNight);',
    '  col=mix(col,lamp*1.12,min(glow,1.)*.72)+glow*.07;',
    '  if(!isSun){',
    '    float above=1.-smoothstep(470.,790.,uSun.y);',
    '    float lit=mix(uLight,.8,uNight)+(1.-mix(uLight,.8,uNight))*exp(-max(rr-rS,0.)/520.)*above;',   // the sun lights the mosaic: far corners fall toward the ground
    '    col*=lit;',
    '    col+=(lamp*.16*exp(-max(rr-rS,0.)/48.)+mix(C_ORANGE,C_COBALT,uMoon)*.07*exp(-max(rr-rS,0.)/180.))*above;',
    '  }',
    // Foreground is composited after sun + water + lighting. Body tiles use fixed wall coordinates:
    // no gradient-angle quantisation, head-following, or displacement of the surrounding field.
    '  float sd=max(bs.g*uCellPx,0.);',
    '  float wake=pow(.5+.5*cos(sd*.075-uShorePhase),12.)*exp(-sd/58.)*smoothstep(0.,10.,sd)*(1.-smoothstep(95.,145.,sd));',
    '  wake*=smoothstep(450.,540.,P.y)*uShore*inK*uBodyOn*(1.-bodyAlpha);',
    '  col=mix(col,C_MINT,wake*.32);',
    // Keep the coloured tesserae inside the person: fixed rows prevent contour jitter,
    // while stagger, shear, varied lengths and clear grout retain the mosaic character.
    '  float bh=11.*uScale,row=floor(P.y/bh),fy=fract(P.y/bh);',
    '  float bw=(24.+4.*sin(row*1.3))*uScale,sh=.35*cos(row*1.7);',
    '  float bx=P.x/bw+row*.37-sh*(fy-.5)*bh/bw;',
    '  vec2 bid=vec2(floor(bx),row),bf=vec2(fract(bx),fy);',
    '  vec2 be=min(bf,1.-bf)*vec2(bw,bh);be.x/=sqrt(1.+sh*sh);',
    '  float ba=smoothstep(uGrout*.5-.5,uGrout*.5+.5,min(be.x,be.y));',
    '  float j=h21(bid+vec2(91.,37.)),ph=.6;',
    '  float wp=sin(row*.95-ph*2.+bid.x*.21+.8*cos(bid.x*.13+ph))+(j-.5)*.4;',
    '  vec3 mosaic=j<.1?C_NAVY:wp>.62?C_MINT:wp>.08?C_MAG:wp>-.45?C_COBALT:mix(C_PLUM,C_ICE,.22);',
    '  vec3 silhouette=mix(C_NAVY*.48,mosaic*(1.04+.10*j),ba);',
    '  col=mix(col,silhouette,bodyAlpha);',
    '  col=mix(col,C_AMBER*.88,rim*.8);',
    '  vec3 kx=vec3(.57735);float ch=cos(uHue),sn=sin(uHue);col=col*ch+cross(kx,col)*sn+kx*dot(kx,col)*(1.-ch);',
    '  o=vec4(clamp(col,0.,1.),1.);',
    '}'
  ].join('\n');

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Mosaic Sun needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false});
    if (!gl) throw new Error('Mosaic Sun needs WebGL 2');
    var made = [], dead = false;
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('Mosaic Sun shader: ' + e); }
      return s;
    }
    var prog = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { var le = gl.getProgramInfoLog(prog); gl.deleteProgram(prog); throw new Error('Mosaic Sun link: ' + le); }
    made.push(['Program', prog]);
    var U = {};
    ['uBody', 'uHinv', 'uRes', 'uS', 'uDW', 'uSun', 'uCellPx', 'uGeo', 'uSpin', 'uCol', 'uSeed', 'uScale', 'uGrout', 'uHue', 'uLight', 'uBodyOn', 'uShore', 'uShorePhase', 'uNight', 'uMoon', 'uRip', 'uRipG', 'uHold', 'uTrail']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    var BW = WallBody.w, BH = WallBody.h, body = WallBody.create(kit, {});
    var bodyBuf = new Float32Array(BW * BH * 2), sdA = new Float32Array(BW * BH), sdB = new Float32Array(BW * BH), cellPx = 8.8;
    var tex = gl.createTexture(); made.push(['Texture', tex]);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (var i0 = 0; i0 < BW * BH; i0++) { bodyBuf[i0 * 2] = 0; bodyBuf[i0 * 2 + 1] = 40; sdB[i0] = 40; }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, BW, BH, 0, gl.RG, gl.FLOAT, bodyBuf);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR); });
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });

    var LIM = {brick: [50, 200], waves: [10, 300], grout: [0, 100], hue: [0, 360], shore: [0, 100], cycle: [0, 200]};
    var settings = {brick: 100, waves: 100, grout: 40, hue: 0, shore: 55, cycle: 100};
    var hueFlow = refreshHue(0), input = refreshContacts(kit, 120);
    var eBrick = 1, eGrout = 1.8;                         // eased knob values (a knob change never jumps)
    var skyAngle = Math.PI * .5, night = 0, moon = 0;
    var time = 0, frames = 0, geo = 0, spin = 0, colBase = 0, seedBase = 0, frameMs = 0;
    var rips = [], tracks = [], nextTrack = 1, lastRip = -1e9, tapsFired = 0, tapsDropped = 0, holdsFired = 0, maxRips = 0;
    var ripU = new Float32Array(NRIP * 4), ripG = new Float32Array(NRIP), holdU = new Float32Array(NHOLD * 4), trailU = new Float32Array(NTRAIL * 4), trail = [];
    var sun = {x: 640, y: 400, r: SUN_R, tx: 640, ty: 400, follow: 0}, people = [], bodyOn = 0, fading = false, contacts = [];
    var size = [canvas.width, canvas.height];

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function designW() { return size[1] > 0 ? size[0] * 800 / size[1] : 1280; }
    function kToScreen(u, v) {                              // Kinect pixel -> window 0..1 (identity when not registered: matches WallBody's hinv)
      var p = kit.toScreen(u, v);
      return (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) ? p : [u / 512, v / 424];
    }
    function blur121(src, dst, horiz) {
      for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) {
        var i = y * BW + x, a, b;
        if (horiz) { a = x > 0 ? src[i - 1] : src[i]; b = x < BW - 1 ? src[i + 1] : src[i]; }
        else { a = y > 0 ? src[i - BW] : src[i]; b = y < BH - 1 ? src[i + BW] : src[i]; }
        dst[i] = (a + 2 * src[i] + b) * 0.25;
      }
    }
    function packBody(smooth) {
      var mk = body.mask, n = BW * BH, peak = 0;
      if (smooth) { blur121(body.sdf, sdA, true); blur121(sdA, sdB, false); blur121(sdB, sdA, true); blur121(sdA, sdB, false); }   // calmer rows and mitres
      for (var i = 0; i < n; i++) { var mv = mk[i]; bodyBuf[i * 2] = mv; bodyBuf[i * 2 + 1] = sdB[i]; if (mv > peak) peak = mv; }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RG, gl.FLOAT, bodyBuf);
      return peak;
    }
    function readPeople() {                                 // after a new depth frame: centres, the head of people[0], px per body cell
      var dW = designW(), list = body.people || [], out = [];
      var a = kToScreen(256, 212), bx = kToScreen(260, 212), by = kToScreen(256, 216);
      var cp = 0.5 * (Math.hypot((bx[0] - a[0]) * dW, (bx[1] - a[1]) * 800) + Math.hypot((by[0] - a[0]) * dW, (by[1] - a[1]) * 800));
      if (Number.isFinite(cp) && cp > 1 && cp < 60) cellPx = cp;
      for (var q = 0; q < list.length && q < NPPL; q++) {
        var p = list[q]; if (!p || !Number.isFinite(p.cx) || !Number.isFinite(p.cy)) continue;
        var c = kToScreen(p.cx * 512, p.cy * 424);
        out.push({x: c[0] * dW, y: c[1] * 800, gap: p.gap, top: p.top});
      }
      if (out.length) {                                     // head: the mean column of the person's top rows (raised arms do not pull it)
        var p0 = list[0], r0 = clamp(Math.floor(p0.top * BH), 0, BH - 1), sx = 0, n = 0;
        for (var y = r0; y < Math.min(BH, r0 + 8); y++) for (var x = 0; x < BW; x++) if (body.label[y * BW + x] === 0) { sx += x + 0.5; n++; }
        var hxk = n ? sx / n / BW : p0.cx, hs = kToScreen(hxk * 512, Math.min(1, p0.top + 0.07) * 424);
        out[0].hx = hs[0] * dW; out[0].hy = hs[1] * 800;
      }
      people = out;
    }
    function spawnRipple(x, y) {
      var dW = designW(), far = Math.max(Math.hypot(x, y), Math.hypot(dW - x, y), Math.hypot(x, 800 - y), Math.hypot(dW - x, 800 - y));
      if (rips.length >= NRIP) { tapsDropped++; return; }   // all slots busy: drop the tap (an early bake would re-quantize bricks in one frame)
      rips.push({x: x, y: y, r: 0, far: far + 40, age: 0});
      lastRip = time; tapsFired++; maxRips = Math.max(maxRips, rips.length);
    }
    function bake(r) { colBase = (colBase + 2.1) % (Math.PI * 2); seedBase = (seedBase + 1) % 64; }   // a passed wave course becomes the ground
    function contactsStep(dt) {
      var dW = designW(), pts = input.read();
      contacts = pts;
      tracks.forEach(function (t) { t.seen = false; });
      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0] * dW, y = pts[i][1] * 800, best = null, bd = 110;
        for (var k = 0; k < tracks.length; k++) { var t = tracks[k]; if (t.seen || t.gone > 0.25) continue; var dd = Math.hypot(t.x - x, t.y - y); if (dd < bd) { bd = dd; best = t; } }
        if (!best) {
          best = {id: nextTrack++, x: x, y: y, ax: x, ay: y, still: 0, w: 0, gone: 0, held: false};
          tracks.push(best);
          if (time - lastRip >= RIPPLE_GAP_S) spawnRipple(x, y);   // tap: a new contact sends a new wave course
        }
        best.seen = true; best.gone = 0; best.x = x; best.y = y;
        if (!best.lx || Math.hypot(x - best.lx, y - best.ly) > 34) {   // a moving hand leaves a trail of glinting tesserae
          best.lx = x; best.ly = y; trail.push({x: x, y: y, age: 0}); if (trail.length > NTRAIL) trail.shift();
        }
        if (Math.hypot(x - best.ax, y - best.ay) > HOLD_MOVE) { best.ax = x; best.ay = y; best.still = 0; } else best.still += dt;
      }
      for (var j = tracks.length - 1; j >= 0; j--) {
        var tr = tracks[j];
        if (!tr.seen) tr.gone += dt;
        var target = tr.seen ? (tr.still >= HOLD_STILL_S ? 1 : 0.18) : 0;
        if (tr.seen && tr.still >= HOLD_STILL_S && !tr.held) { tr.held = true; holdsFired++; }
        tr.w += (target - tr.w) * (1 - Math.exp(-dt / (target > tr.w ? 0.3 : 0.8)));
        if (!tr.seen && tr.gone > 0.3 && tr.w < 0.01) tracks.splice(j, 1);
      }
      if (tracks.length > 12) tracks.splice(0, tracks.length - 12);
    }
    function sunStep(dt) {
      // Constant angular travel, independent of body tracking; swap discs only below the waves.
      skyAngle = (skyAngle + dt * (settings.cycle / 100) * Math.PI * 2 / SKY_CYCLE_S) % (Math.PI * 2);
      moon = skyAngle >= Math.PI ? 1 : 0;
      var arc = skyAngle - moon * Math.PI, dusk = clamp((.35 - Math.sin(skyAngle)) / .6, 0, 1);
      night = dusk * dusk * (3 - 2 * dusk);
      sun.x = sun.tx = designW() * (.5 - .28 * Math.cos(arc));
      sun.y = sun.ty = 790 - 560 * Math.sin(arc);
      sun.r = moon ? MOON_R : SUN_R; sun.follow = 0;
    }
    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      size = [canvas.width, canvas.height];
      hueFlow.step(settings.hue, dt);
      var ke = 1 - Math.exp(-dt / 0.35);
      eBrick += (settings.brick / 100 - eBrick) * ke;
      eGrout += ((0.3 + settings.grout * 0.04) - eGrout) * ke;
      var fresh = body.update(dt, now);
      if (fresh) { packBody(true); fading = true; readPeople(); }
      else if (!body.fresh && fading) { if (packBody(false) < 0.004) fading = false; people = []; }
      bodyOn += ((body.fresh || fading ? 1 : 0) - bodyOn) * (1 - Math.exp(-dt / 0.15));
      contactsStep(dt);
      sunStep(dt);
      geo = (geo + dt * (settings.waves / 100) * Math.PI * 2 / LOOP_S) % (Math.PI * 2);
      spin = (spin + dt * (settings.waves / 100) * Math.PI * 2 / SPIN_S) % (Math.PI * 2);
      for (var ti = trail.length - 1; ti >= 0; ti--) { trail[ti].age += dt; if (trail[ti].age > 2.5) trail.splice(ti, 1); }
      for (ti = 0; ti < NTRAIL; ti++) {
        var tp = trail[ti];
        trailU[ti * 4] = tp ? tp.x : 0; trailU[ti * 4 + 1] = tp ? tp.y : 0; trailU[ti * 4 + 2] = 95; trailU[ti * 4 + 3] = tp ? Math.exp(-tp.age / 0.7) : 0;
      }
      for (var i = rips.length - 1; i >= 0; i--) { var r = rips[i]; r.age += dt; r.r += RIPPLE_SPEED * dt; if (r.r > r.far) { bake(r); rips.splice(i, 1); } }
      // uniforms
      for (i = 0; i < NRIP; i++) {
        var rr = rips[i];
        if (rr) { ripU[i * 4] = rr.x; ripU[i * 4 + 1] = rr.y; ripU[i * 4 + 2] = rr.r; ripU[i * 4 + 3] = 0; ripG[i] = Math.exp(-rr.age * 0.3); }
        else { ripU[i * 4] = 0; ripU[i * 4 + 1] = 0; ripU[i * 4 + 2] = -1; ripU[i * 4 + 3] = 0; ripG[i] = 0; }
      }
      var hs = tracks.slice().sort(function (a, b) { return b.w - a.w; });
      for (i = 0; i < NHOLD; i++) {
        var h = hs[i];
        holdU[i * 4] = h ? h.x : 0; holdU[i * 4 + 1] = h ? h.y : 0; holdU[i * 4 + 2] = HOLD_R; holdU[i * 4 + 3] = h ? h.w : 0;
      }
      var W = size[0], H = size[1], s = H / 800;
      gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uBody, 0);
      gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
      gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uS, s); gl.uniform1f(U.uDW, W / s);
      gl.uniform3f(U.uSun, sun.x, sun.y, sun.r); gl.uniform1f(U.uCellPx, cellPx);
      gl.uniform1f(U.uGeo, geo); gl.uniform1f(U.uSpin, spin); gl.uniform1f(U.uCol, (geo + colBase) % (Math.PI * 2)); gl.uniform1f(U.uSeed, seedBase);
      gl.uniform1f(U.uScale, 1.4 * eBrick); gl.uniform1f(U.uGrout, eGrout); gl.uniform1f(U.uHue, hueFlow.value * Math.PI / 180);
      gl.uniform1f(U.uNight, night); gl.uniform1f(U.uMoon, moon);
      gl.uniform1f(U.uLight, 0.36); gl.uniform1f(U.uBodyOn, bodyOn);
      gl.uniform1f(U.uShore, settings.shore / 100); gl.uniform1f(U.uShorePhase, (time * 1.65) % (Math.PI * 2));
      gl.uniform4fv(U.uRip, ripU); gl.uniform1fv(U.uRipG, ripG); gl.uniform4fv(U.uHold, holdU); gl.uniform4fv(U.uTrail, trailU);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      frameMs = performance.now() - t0;
    }
    function resize(w, h) { if (!dead && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) size = [w, h]; }
    function set(o) {
      if (o && typeof o === 'object' && !dead) Object.keys(LIM).forEach(function (k) { var v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) settings[k] = clamp(v, LIM[k][0], LIM[k][1]); });
      return {brick: settings.brick, waves: settings.waves, grout: settings.grout, hue: settings.hue, shore: settings.shore, cycle: settings.cycle};
    }
    function touch(t) { if (!dead && t && Number.isFinite(t.x) && Number.isFinite(t.y)) input.wake(t.x, t.y); }
    function destroy() {
      if (dead) return; dead = true;
      if (window.MosaicsunshoreSet === set) delete window.MosaicsunshoreSet;
      kit.wantDepth(false); input.clear(); tracks = []; rips = []; people = []; trail = [];
      made.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); made = [];
    }
    kit.wantDepth(true);
    window.MosaicsunshoreSet = set;
    if (window._mosaicsunshoreFx) set(window._mosaicsunshoreFx);
    sunStep(0);
    hueFlow.snap(settings.hue); eBrick = settings.brick / 100; eGrout = 0.3 + settings.grout * 0.04;
    var out = {frame: frame, touch: touch, resize: resize, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      return {frames: frames, frameMs: +frameMs.toFixed(2), contacts: contacts.length, inputState: input.state, tapsFired: tapsFired, tapsDropped: tapsDropped, maxSlots: maxRips, holdsFired: holdsFired,
              tracks: tracks.map(function (t) { return {id: t.id, x: Math.round(t.x), y: Math.round(t.y), still: +t.still.toFixed(2), w: +t.w.toFixed(3), seen: t.seen}; }),
              ripples: rips.map(function (r) { return {x: Math.round(r.x), y: Math.round(r.y), r: Math.round(r.r)}; }), seedBase: seedBase, colBase: +colBase.toFixed(3),
              sun: {x: Math.round(sun.x), y: Math.round(sun.y), r: Math.round(sun.r), tx: Math.round(sun.tx), ty: Math.round(sun.ty), follow: +sun.follow.toFixed(2)},
              people: people.map(function (p) { return {x: Math.round(p.x), y: Math.round(p.y), hx: p.hx && Math.round(p.hx), hy: p.hy && Math.round(p.hy)}; }),
              sky: {angle: skyAngle, night: night, moon: moon, cycleSeconds: SKY_CYCLE_S},
              bodyStyle: 'foreground-stable-tiles', bodyFresh: body.fresh, bodyOn: +bodyOn.toFixed(2), regOk: body.regOk, displayHue: hueFlow.value, settings: set(), glError: gl.getError(), destroyed: dead};
    };
    return out;
  }
})();
