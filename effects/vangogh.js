/* Van Gogh · Paint the Sky (2026-10-08, paintings round 2, built by Claude for Billy's Kinect wall).
 * The whole wall is a night sky painted in thick impasto: every pixel belongs to a brushstroke laid along the flow of the sky.
 * The sky is a real fluid. Authored currents (a great double spiral, a whirlpool around every star and the moon) turn it forever;
 * the strokes follow them, so the halos are painted in rings and the spiral in long curving dashes.
 *   Stir   : moving hands and arms push the paint and drag long comet streams of yellow and white starlight that curl into spirals.
 *   Gust   : a body walking past bends the whole local sky (strokes and colours) along with the walker; it heals over ~30 s.
 *   Star   : hold a hand, or your whole body, still for ~1.5 s and a NEW STAR is born above it: a growing whirlpool with pulsing
 *            yellow halos that keeps turning for a minute after you leave.
 *   Village: touch (or move a body) anywhere in the lower part of the wall: the windows light up and a ribbon of starlight spirals
 *            up out of the village into the sky, where it becomes a new star. Kid height on purpose.
 *   Cypress: the dark flame on the left leans toward people and flickers when they move near it.
 * Idle: a slowly breathing painting (currents, halos, cypress) with nothing anyone caused. Everything people cause lives in
 * separate fields (push, smear, paint, new stars, ribbons) that settle back to zero, so the idle picture always comes back.
 * Needs plugins/body.js (WallBody). WebGL 2 + EXT_color_buffer_float. No assets, no audio, no network; one depth client (the host).
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ tuning (the five live knobs first)
  var SWIRL = 1.0;          // knob 'swirl': how fast the painted sky turns (the double spiral and the star whirlpools)
  var PAINT = 1.0;          // knob 'paint': how much yellow / white starlight a moving hand or body drags through the sky
  var STROKE = 1.0;         // knob 'stroke': brushstroke size (1 = about 12 px wide on a 1280 x 800 wall)
  var MEMORY_S = 30;        // knob 'memory': how long (s) a disturbance lingers: paint fades and the bent sky straightens over this
  var INSIDE = 0.4;         // knob 'inside': brightness of the painting ON a person (0 = a dark shadow, 1 = unchanged)

  var STROKE_PX = 12;       // brushstroke width at 1280 px across (scaled by 'stroke')
  var STROKE_LONG = 4.2;    // brushstroke length, in stroke widths
  var RELIEF = 1.0;         // how strongly the ridges of paint catch the light
  var BLOOM = 0.55;         // soft glow around the brightest paint (stars, lit windows, starlight)
  var GUST = 0.75;          // a walking body drags the sky at this share of its own speed
  var EDGE_PUSH = 0.9;      // a moving outline (arm, hand, leg) pushes the paint at this share of its speed
  var CURRENT_S = 3.5;      // a push keeps the sky moving this long (s) before the authored currents take over again
  var STAR_HOLD_S = 1.5;    // hold still this long to plant a new star
  var STILL_ENTER = 0.06;   // a person counts as still below this 'moving' (share of their outline changing; a held arm wobbles 0.01-0.08)
  var STILL_EXIT = 0.12;    // ...and is moving again above this (the gap between the two is the hysteresis)
  var STAR_LIFE_S = 60;     // a new star keeps turning this long, then fades away
  var MAX_STARS = 6;        // new stars at once (the oldest fades first)
  var LOW_Y = 0.6;          // the village zone starts this far down the wall (0 = top, 1 = bottom)
  var RIBBON_S = 1.5;       // a ribbon of starlight takes this long to spiral up into the sky, then it BLOOMS
  var MAX_RIBBONS = 3;      // ribbons in the air at once
  var BLOOM_S = 2.6;        // the bloom: a great whirlpool star that owns the middle of the sky this long, then settles
  var BLOOM_R = 0.12;       // ...radius of the settled bloom star's halo (wall heights; the moon's disc is 0.072)
  var BLOOM_PEAK_R = 0.24;  // ...and of its halo at the peak
  var SHOCK_R = 0.46;       // its shock ring throws the brushstrokes outward to this radius (wall heights)
  var LOW_HOLD_S = 0.8;     // a body must keep moving in the village zone this long to send a ribbon
  var LOW_COOLDOWN_S = 4.0; // one person, or one touched spot, sends a ribbon at most this often (no strobe)
  var LOW_MOTION = 14;      // how much moving outline in the village zone sends a ribbon (cells moving faster than ~0.2 m/s)
  var FURNITURE_S = 6;      // something that stays in the same cells this long (a chair, a twitchy ghost) stops pushing and painting
  var LOW_SPOT_S = 4;       // ...and the same spot (within ~1/8 of the wall) at most this often, so a twitchy object near the wall cannot repeat it
  var LIGHT_S = 22;         // lit village windows dim back over this long (s)
  var INK_CAP = 0.05;       // starlight paint budget: once about this much is out (roughly a fifth of the sky well covered), new paint thins out,
                            // so one visitor (or a crowd) adds gold accents to a blue sky instead of gilding the whole wall
  var STEP_S = 1 / 60;      // simulation step (s); 1-3 steps a frame, so any frame rate gives the same motion

  registerWallPlugin({id: 'vangogh', title: 'Van Gogh · Paint the Sky', author: 'Claude (paintings round 2)', create: create});

  // ------------------------------------------------------------------ the painted world (screen units: x 0..1 across, y 0..1 down)
  var BIG = [   // the great double spiral: x, y, radius (wall heights), spin (+ = anticlockwise)
    [0.40, 0.31, 0.175, 0.95], [0.615, 0.385, 0.145, -1.05]];
  var MOON = [0.862, 0.165, 0.072];               // x, y, radius
  var STARS = [ // x, y, halo radius, core radius, spin
    [0.258, 0.115, 0.080, 0.0150, -1.5], [0.522, 0.080, 0.064, 0.0125, 1.4], [0.712, 0.135, 0.068, 0.0130, -1.5],
    [0.238, 0.375, 0.060, 0.0115, 1.5], [0.800, 0.375, 0.070, 0.0130, 1.4], [0.958, 0.440, 0.052, 0.0105, -1.4],
    [0.405, 0.560, 0.048, 0.0095, 1.3], [0.935, 0.270, 0.044, 0.0090, -1.3], [0.700, 0.565, 0.044, 0.0090, -1.3]];
  var WIND = [-0.024, 0.032, 4.2, 0.0];          // drift speed (- = to the right), wave height, wave number, wave speed
  // the village: centre x, base y, half width (x units), wall height (y units), roof height, roof style, windows
  var HOUSES = [
    [0.362, 0.880, 0.025, 0.060, 0.036, 0, 1], [0.414, 0.868, 0.031, 0.070, 0.041, 1, 2], [0.466, 0.884, 0.023, 0.055, 0.034, 0, 1],
    [0.516, 0.864, 0.032, 0.075, 0.041, 1, 2], [0.566, 0.878, 0.024, 0.058, 0.036, 0, 1], [0.622, 0.852, 0.028, 0.100, 0.048, 2, 2],
    [0.680, 0.872, 0.030, 0.068, 0.039, 1, 2], [0.731, 0.886, 0.023, 0.053, 0.033, 0, 1], [0.779, 0.868, 0.031, 0.072, 0.040, 1, 2],
    [0.830, 0.884, 0.024, 0.056, 0.034, 0, 1], [0.878, 0.872, 0.028, 0.065, 0.037, 1, 2], [0.312, 0.892, 0.020, 0.047, 0.030, 0, 1]];
  var CYPRESS_X = 0.125;
  var CHURCH = HOUSES.findIndex(function (h) { return h[5] === 2; });

  // ------------------------------------------------------------------ shaders
  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var HEAD = '#version 300 es\nprecision highp float; precision highp sampler2D;\nin vec2 vUv; out vec4 o;\n';

  // the cypress, shared by the direction field and the painter (s = screen coordinates, y down)
  var CYP = [
    'uniform vec4 uCyp;  // x at the base, lean (+ = right), flicker, time',
    'float cypU(float y){return clamp((y-0.035)/0.965,0.,1.);}',
    'float cypX(float y){float k=1.-cypU(y); return uCyp.x+uCyp.y*0.05*k*k+(0.011*sin(uCyp.w*0.55+y*5.)*k*k+0.0045*sin(uCyp.w*1.6+y*17.)*k)*uCyp.z;}',
    'float cypW(float y){float u=cypU(y); float w=0.090*pow(u,0.62)*(1.-0.32*smoothstep(0.80,1.,u));',
    '  w*=1.+0.17*sin(y*43.+1.7+uCyp.w*0.25*uCyp.z)+0.08*sin(y*101.+0.3); return y<0.035?-1.:w;}',
    'float cypD(vec2 s,float asp){return abs(s.x-cypX(s.y))*asp-cypW(s.y);}',
    ''].join('\n');

  // the analytic base flow: wind + vortices, as velocity (cells/s, y up) and stream function (for the colour bands)
  var BASE_FS = HEAD + [
    'uniform vec4 uV[26]; uniform int uNV; uniform vec4 uWind; uniform float uAspect, uT, uPsiK;',
    'void main(){',
    '  vec2 q=vec2(vUv.x*uAspect,vUv.y);',
    '  float ph=uWind.z*q.x-uWind.w*uT;',
    '  float psi=-uWind.x*(q.y+uWind.y*sin(ph));',
    '  vec2 v=vec2(-uWind.x,uWind.x*uWind.y*uWind.z*cos(ph));',
    '  for(int i=0;i<26;i++){ if(i>=uNV) break; vec4 c=uV[i]; vec2 d=q-c.xy; float e=exp(-dot(d,d)/(c.z*c.z));',
    '    psi+=0.5*c.w*c.z*c.z*e; v+=c.w*e*vec2(-d.y,d.x); }',
    '  o=vec4(v*100.,psi*uPsiK,1.);',
    '}'].join('\n');

  // people's push on the perturbation velocity: moving outlines, walking bodies, hands, ribbons
  var FORCE_FS = HEAD + [
    'uniform sampler2D uUp, uBody; uniform float uAspect, uRelax, uFlowGain, uDecay, uDt; uniform vec4 uVS[24]; uniform vec4 uVV[24]; uniform int uNS;',
    'void main(){',
    '  vec2 up=texture(uUp,vUv).xy; vec4 b=texture(uBody,vUv);',
    '  float fl=length(b.yz);',
    '  up+=(b.yz*uFlowGain-up)*uRelax*smoothstep(1.5,8.,fl);',
    '  for(int i=0;i<24;i++){ if(i>=uNS) break; vec4 a=uVS[i]; vec4 c=uVV[i];',
    '    vec2 d=vec2((vUv.x-a.x)*uAspect,vUv.y-a.y); float g=exp(-dot(d,d)/(a.z*a.z));',
    '    vec2 tg=c.xy+c.z*vec2(-d.y,d.x)/a.z;',
    '    if(a.w<0.5) up+=tg*g*c.w; else up+=(tg-up)*min(1.,g*c.w); }',
    '  up*=uDecay; float m=length(up); up*=max(0.,m-0.8*uDt)/max(m,1e-6); m=max(0.,m-0.8*uDt); if(m>170.) up*=170./m;',
    '  o=vec4(up,0.,1.);',
    '}'].join('\n');
  var CURL_FS = HEAD + 'uniform sampler2D uV; uniform vec2 uTx;\nvoid main(){float L=texture(uV,vUv-vec2(uTx.x,0.)).y,R=texture(uV,vUv+vec2(uTx.x,0.)).y,T=texture(uV,vUv+vec2(0.,uTx.y)).x,B=texture(uV,vUv-vec2(0.,uTx.y)).x;o=vec4(0.5*(R-L-T+B),0.,0.,1.);}';
  var VORT_FS = HEAD + [
    'uniform sampler2D uV, uC; uniform vec2 uTx; uniform float uCurl, uDt;',
    'void main(){float L=texture(uC,vUv-vec2(uTx.x,0.)).x,R=texture(uC,vUv+vec2(uTx.x,0.)).x,T=texture(uC,vUv+vec2(0.,uTx.y)).x,B=texture(uC,vUv-vec2(0.,uTx.y)).x,C=texture(uC,vUv).x;',
    '  vec2 f=0.5*vec2(abs(T)-abs(B),abs(R)-abs(L)); f/=length(f)+1e-4; f*=uCurl*C; f.y*=-1.;',
    '  o=vec4(texture(uV,vUv).xy+f*uDt,0.,1.);}'].join('\n');
  var DIV_FS = HEAD + [
    'uniform sampler2D uV; uniform vec2 uTx;',
    'void main(){float L=texture(uV,vUv-vec2(uTx.x,0.)).x,R=texture(uV,vUv+vec2(uTx.x,0.)).x,T=texture(uV,vUv+vec2(0.,uTx.y)).y,B=texture(uV,vUv-vec2(0.,uTx.y)).y; vec2 C=texture(uV,vUv).xy;',
    '  if(vUv.x-uTx.x<0.) L=-C.x; if(vUv.x+uTx.x>1.) R=-C.x; if(vUv.y+uTx.y>1.) T=-C.y; if(vUv.y-uTx.y<0.) B=-C.y;',
    '  o=vec4(0.5*(R-L+T-B),0.,0.,1.);}'].join('\n');
  var PRESS_FS = HEAD + 'uniform sampler2D uP, uD; uniform vec2 uTx;\nvoid main(){float L=texture(uP,vUv-vec2(uTx.x,0.)).x,R=texture(uP,vUv+vec2(uTx.x,0.)).x,T=texture(uP,vUv+vec2(0.,uTx.y)).x,B=texture(uP,vUv-vec2(0.,uTx.y)).x;o=vec4((L+R+B+T-texture(uD,vUv).x)*0.25,0.,0.,1.);}';
  var GRAD_FS = HEAD + 'uniform sampler2D uP, uV; uniform vec2 uTx;\nvoid main(){float L=texture(uP,vUv-vec2(uTx.x,0.)).x,R=texture(uP,vUv+vec2(uTx.x,0.)).x,T=texture(uP,vUv+vec2(0.,uTx.y)).x,B=texture(uP,vUv-vec2(0.,uTx.y)).x;o=vec4(texture(uV,vUv).xy-vec2(R-L,T-B),0.,1.);}';
  var SCALE_FS = HEAD + 'uniform sampler2D uS; uniform float uK;\nvoid main(){o=texture(uS,vUv)*uK;}';
  // advection by the whole flow (base + push); mode 0 = carry a field, 1 = the smear (displacement) that also grows with the push
  var ADV_FS = HEAD + [
    'uniform sampler2D uBase, uUp, uS; uniform vec2 uSimTx; uniform float uDt, uDecay, uMode, uMaxD, uAspect; uniform vec4 uShock[3];',
    'void main(){ vec2 up=texture(uUp,vUv).xy; vec2 v=texture(uBase,vUv).xy+up;',
    '  vec4 r=texture(uS,vUv-uDt*v*uSimTx);',
    '  if(uMode>0.5){ vec2 q=vec2(vUv.x*uAspect,vUv.y), push=vec2(0.);',
    '    for(int i=0;i<3;i++){ vec4 k=uShock[i]; if(k.w<=0.) continue; vec2 d=q-k.xy; float rr=length(d); float z=(rr-k.z)/0.06; push+=d/max(rr,1e-4)*exp(-z*z)*k.w*0.16; }',
    '    r.xy+=vec2(push.x/uAspect,push.y)*uDt*4.;',
    '    r.xy=(r.xy+up*smoothstep(1.5,5.,length(up))*uDt*uSimTx)*uDecay; float m=length(r.xy); if(m>uMaxD) r.xy*=uMaxD/m; if(m<1e-4) r.xy=vec2(0.); r.zw=vec2(0.,1.); }',
    '  else r*=uDecay;',
    '  o=r; }'].join('\n');
  // starlight paint (premultiplied rgb, amount): carried by the flow, laid by moving outlines, hands, ribbons and new stars
  var PAINT_FS = HEAD + [
    'uniform sampler2D uBase, uUp, uS, uBody; uniform vec2 uSimTx; uniform float uDt, uDecay, uBodyPaint, uAspect, uLowY; uniform vec3 uBodyCol;',
    'uniform vec4 uPS[24]; uniform vec4 uPC[24]; uniform int uNP;',
    'void main(){ vec2 v=texture(uBase,vUv).xy+texture(uUp,vUv).xy;',
    '  vec4 L=texture(uS,vUv-uDt*v*uSimTx)*uDecay;',
    '  L.rgb+=(vec3(0.98,0.60,0.10)*L.a-L.rgb)*min(1.,uDt/7.);',      // starlight ages like a comet tail: lemon-white, then chrome, then orange
    '  vec4 b=texture(uBody,vUv); float ys=1.-vUv.y;',
    '  float amt=uBodyPaint*smoothstep(14.,46.,length(b.yz))*(1.-smoothstep(0.45,0.85,b.r))*mix(1.,0.5,smoothstep(uLowY,uLowY+0.1,ys));',
    '  L+=vec4(uBodyCol,1.)*amt;',
    '  for(int i=0;i<24;i++){ if(i>=uNP) break; vec4 a=uPS[i]; vec2 d=vec2((vUv.x-a.x)*uAspect,vUv.y-a.y); float g=exp(-dot(d,d)/(a.z*a.z)); L+=vec4(uPC[i].rgb,1.)*g*a.w; }',
    '  L=min(L,vec4(1.2)); if(L.a<0.004) L=vec4(0.);',
    '  o=L; }'].join('\n');

  // the static foreground (made once): region code, house index, stroke direction
  var FG_FS = HEAD + [
    'uniform vec4 uH[12]; uniform vec4 uH2[12]; uniform int uNH; uniform float uAspect; uniform vec2 uRes;',
    'float H1(float x){return 0.655+0.030*sin(6.2832*(1.1*x+0.12))+0.016*sin(6.2832*(2.7*x+0.55))-0.022*x;}',
    'float H2(float x){return 0.838+0.022*sin(6.2832*(1.5*x+0.30))+0.010*sin(6.2832*(3.4*x+0.8));}',
    'void main(){',
    '  vec2 s=vec2(vUv.x,1.-vUv.y); float code=0., hi=0.; vec2 dir=vec2(1.,0.);',  // dir: screen units (x right, y down), isotropic
    '  float e=0.002; float h1=H1(s.x), h2=H2(s.x); float d1=(H1(s.x+e)-H1(s.x-e))/(2.*e), d2=(H2(s.x+e)-H2(s.x-e))/(2.*e);',
    '  if(s.y>h1){ code=1.; float t=clamp((s.y-h1)/max(h2-h1,0.01),0.,1.); float sl=mix(d1,d2,t);',
    '    if(s.y>h2){ code=2.; sl=d2*(1.-clamp((s.y-h2)/0.15,0.,1.))+0.18*sin(s.x*21.+s.y*9.); }',
    '    sl+=0.12*sin(s.x*37.+s.y*61.); dir=vec2(1.,sl/uAspect); }',
    '  for(int i=0;i<12;i++){ if(i>=uNH) break; vec4 h=uH[i]; vec4 g=uH2[i];',
    '    float dx=(s.x-h.x)*uAspect, hw=h.z*uAspect, top=h.y-h.w;',
    '    if(abs(dx)<hw && s.y<h.y && s.y>top){ code=3.; hi=float(i); dir=vec2(0.,1.);',
    '      float nw=g.z; for(int k=0;k<2;k++){ if(float(k)>=nw) break; float wx=nw<1.5?0.:(float(k)-0.5)*hw*0.95;',
    '        float wy=top+h.w*(g.y>1.5?0.32:0.45); vec2 ws=g.y>1.5?vec2(0.0058,0.018):vec2(0.0068,0.0105);',
    '        if(abs(dx-wx)<ws.x*1.4 && abs(s.y-wy)<ws.y*1.2){ code=5.; dir=vec2(1.,0.); } } }',
    '    float rt=top-g.x; float rw=hw*1.12*clamp((s.y-rt)/max(g.x,1e-3),0.,1.);',
    '    if(g.y>1.5){ rt=top-0.30; rw=hw*0.42*clamp((s.y-rt)/0.30,0.,1.); }',   // the church spire
    '    if(s.y<=top && s.y>rt && abs(dx)<rw){ code=4.; hi=float(i); dir=normalize(vec2(sign(dx)*max(hw,0.01),max(g.x,0.01))); if(g.y>1.5) dir=vec2(0.,1.); }',
    '  }',
    '  vec2 dg=normalize(vec2(dir.x,-dir.y));',   // GL orientation (y up)
    '  o=vec4(code/255.,hi/255.,dg*0.5+0.5);',
    '}'].join('\n');

  // per frame: the stroke direction field (unit, isotropic, y up); z = region*4 + brush size; w = stroke length factor
  var DIR_FS = HEAD + CYP + [
    'uniform sampler2D uBase, uUp, uFg; uniform float uAspect; uniform vec4 uHalo[24]; uniform int uNHalo; uniform vec4 uMoon; uniform vec4 uShock[3];',
    'void main(){',
    '  vec2 s=vec2(vUv.x,1.-vUv.y); vec2 q=vec2(vUv.x*uAspect,vUv.y); vec2 up=texture(uUp,vUv).xy; up*=smoothstep(1.5,5.,length(up)); vec2 v=texture(uBase,vUv).xy+up;',
    '  vec4 fg=texture(uFg,vUv); float code=floor(fg.r*255.+0.5); float reg=0., cs=1., lk=1.;',
    '  if(code>0.5){ vec2 fd=normalize(fg.ba*2.-1.); v=fd*24.+up*0.55; reg=code>2.5?2.:1.; cs=code>2.5?0.62:1.05; lk=code>2.5?0.42:1.; }',
    '  if(cypD(s,uAspect)<0.004){ float dx=(s.x-cypX(s.y))*uAspect; float w=max(cypW(s.y),0.01);',
    '    float wig=0.55*sin(s.y*24.-uCyp.w*0.8+dx*28.)+0.65*dx/w+0.4*uCyp.y*(1.-cypU(s.y));',
    '    v=normalize(vec2(wig,1.))*24.+up*0.45; reg=3.; cs=1.12; lk=1.; }',
    '  if(reg<0.5){ float cd=cypD(s,uAspect); if(cd<0.06){ float k=smoothstep(0.06,0.0,cd); v=normalize(mix(v/max(length(v),1e-4),vec2(0.,1.),k*0.85))*max(length(v),6.); }',
    '    float fine=0.;',      // short, finer strokes inside the halos, so the rings read as rings
    '    for(int i=0;i<24;i++){ if(i>=uNHalo) break; float x=length(q-uHalo[i].xy)/uHalo[i].z; fine=max(fine,smoothstep(1.45,0.9,x)); }',
    '    float xm=length(q-uMoon.xy)/uMoon.z; fine=max(fine,smoothstep(2.6,1.8,xm));',
    '    cs=fine>0.5?0.72:1.; lk=1.-0.42*fine; }',
    '  float sp=length(v); lk*=0.85+0.45*smoothstep(12.,70.,sp); if(reg<0.5) lk*=mix(0.28,1.,smoothstep(0.35,2.2,sp));',   // slow, stagnant sky: short dabs
    '  if(reg<1.5) for(int i=0;i<3;i++){ vec4 k=uShock[i]; if(k.w<=0.) continue; vec2 d=q-k.xy; float r=length(d); float zz=(r-k.z)/0.07; float w=exp(-zz*zz)*k.w;',
    '    if(w>0.01){ vec2 vn=v/max(sp,1e-4); vn=normalize(mix(vn,d/max(r,1e-4),w*0.92)); v=vn*max(sp,8.); sp=length(v); lk*=1.+0.9*w; } }',   // the shock ring throws the strokes outward
    '  o=vec4(sp>1e-4?v/sp:vec2(1.,0.),reg*4.+cs,lk);',
    '}'].join('\n');

  // per frame, full resolution: every pixel finds the brushstroke that covers it (a dab upstream, swept along the flow)
  var STROKE_FS = HEAD + CYP + [
    'uniform sampler2D uDir, uBase, uDisp, uPaint, uFg, uRand;',
    'uniform vec2 uRes, uDirRes; uniform float uCell, uLenK, uAspect, uT, uBandK, uIdleLight;',
    'uniform vec4 uShock[3]; uniform int uChurch; uniform vec4 uBig[2]; uniform vec4 uMoon; uniform vec4 uHalo[24]; uniform vec4 uHaloB[24]; uniform int uNHalo; uniform float uLight[12];',
    'vec3 pick4(vec3 a,vec3 b,vec3 c,vec3 d,float t){return t<0.25?a:t<0.5?b:t<0.75?c:d;}',
    'float H1(float x){return 0.655+0.030*sin(6.2832*(1.1*x+0.12))+0.016*sin(6.2832*(2.7*x+0.55))-0.022*x;}',
    'float H1b(float x){return 0.742+0.026*sin(6.2832*(1.35*x+0.62))+0.012*sin(6.2832*(3.1*x+0.2));}',
    'float lum(vec3 c){return dot(c,vec3(0.2126,0.7152,0.0722));}',
    'vec3 skyPaint(vec2 uv, vec4 h){',
    '  vec2 u2=uv-texture(uDisp,uv).xy; vec4 bs=texture(uBase,u2); float psi=bs.z;',
    '  vec2 s=vec2(u2.x,1.-u2.y); vec2 q=vec2(u2.x*uAspect,u2.y);',
    '  vec3 c=mix(vec3(0.11,0.19,0.46),vec3(0.17,0.33,0.64),smoothstep(0.0,0.42,s.y));',
    '  c=mix(c,vec3(0.32,0.52,0.70),smoothstep(0.40,0.68,s.y));',
    '  float b=sin(psi*uBandK+0.6*sin(q.x*2.3+q.y*3.1)); float b2=sin(psi*uBandK*2.6+1.7+q.x*1.3);',
    '  c=mix(c,vec3(0.46,0.65,0.82),smoothstep(0.30,0.95,b)*0.62);',
    '  c=mix(c,vec3(0.08,0.13,0.40),smoothstep(-0.30,-0.95,b)*0.55);',
    '  c=mix(c,vec3(0.30,0.57,0.60),smoothstep(0.55,1.0,b2)*0.40);',
    '  for(int i=0;i<2;i++){ vec4 v=uBig[i]; vec2 d=q-v.xy; float r=length(d); float th=atan(d.y,d.x);',
    '    float w=exp(-r*r/(v.z*v.z*1.5)); float arm=sin(2.*th*sign(v.w)+11.*log(r+0.02)-uT*0.06*sign(v.w));',
    '    c=mix(c,vec3(0.66,0.79,0.86),smoothstep(0.35,1.0,arm)*w*0.62);',
    '    c=mix(c,vec3(0.10,0.16,0.45),smoothstep(-0.4,-1.0,arm)*w*0.35); }',
    '  { vec2 d=q-uMoon.xy; float r=length(d); float R=uMoon.z; float x=r/R;',   // the moon: an ochre disc, a lemon crescent, halo rings
    '    float fall=smoothstep(2.7,1.0,x); float band=0.5+0.5*cos(6.2832*(x*1.35-uT*0.015));',
    '    c=mix(c,mix(vec3(0.66,0.70,0.48),vec3(0.92,0.70,0.24),smoothstep(0.25,0.75,band)),fall*0.80);',
    '    if(x<1.){ float bite=length(d-vec2(-0.40,0.32)*R)/(R*0.86); c=bite>1.?vec3(1.0,0.86,0.32):vec3(0.84,0.50,0.12); } }',
    '  for(int i=0;i<24;i++){ if(i>=uNHalo) break; vec4 hl=uHalo[i]; vec4 hb=uHaloB[i]; vec2 d=q-hl.xy; float r=length(d); float x=r/hl.z;',
    '    if(x<1.6){ float pul=hb.y; float fall=smoothstep(1.5,0.35,x)*hb.x; float band=x*2.3-pul*0.035;',
    '      vec3 wgt=max(vec3(0.),0.5+0.5*cos(6.2832*(band-vec3(0.,0.333,0.667)))); wgt*=wgt; wgt/=wgt.x+wgt.y+wgt.z+1e-4;',    // three ring colours, blended smoothly
    '      vec3 rc=wgt.x*vec3(0.98,0.84,0.34)+wgt.y*vec3(0.78,0.87,0.80)+wgt.z*vec3(0.55,0.70,0.66);',
    '      if(hb.z>0.5) rc=mix(rc,vec3(1.0,0.92,0.58),0.45);',
    '      if(hb.w>0.) rc=mix(rc,wgt.x*vec3(1.0,0.78,0.20)+wgt.y*vec3(1.0,0.92,0.60)+wgt.z*vec3(0.36,0.58,0.86),hb.w*0.7);',   // a blooming star: saturated gold, white and blue rings
    '      c=mix(c,rc,fall*(0.82+0.14*hb.w));',
    '      float id0=mix(0.46,0.24,hb.w), id1=mix(0.20,0.10,hb.w);',    // a blooming star keeps a small hot heart, the rest is rings
    '      c=mix(c,hb.z>0.5?vec3(1.0,0.84,0.34):vec3(0.96,0.78,0.26),smoothstep(id0,id1,x)*min(1.,hb.x*1.2)); } }',
    '  if(h.y<0.33) c=mix(c,vec3(0.26,0.55,0.62),0.16); else if(h.y>0.8) c=mix(c,vec3(0.13,0.17,0.52),0.20);',   // a little hue per stroke
    '  return c; }',
    'vec3 paintAt(vec2 uv, vec4 h, out float wet, float wp){',
    '  vec2 s=vec2(uv.x,1.-uv.y); vec3 c; wet=0.;',
    '  if(cypD(s,uAspect)<0.){ float side=(s.x-cypX(s.y))*uAspect/max(cypW(s.y),0.01);',
    '    c=pick4(vec3(0.028,0.055,0.040),vec3(0.055,0.13,0.075),vec3(0.14,0.16,0.065),vec3(0.035,0.08,0.10),h.x);',
    '    if(h.y>0.88) c=vec3(0.16,0.095,0.05); if(side>0.3&&h.z>0.6) c=mix(c,vec3(0.19,0.31,0.19),0.75);',
    '  } else { vec4 fg=texture(uFg,uv); float code=floor(fg.r*255.+0.5); int hi=int(fg.g*255.+0.5);',
    '    if(code<0.5) c=skyPaint(uv,h);',
    '    else if(code<1.5){ float dh=s.y-H1(s.x), db=s.y-H1b(s.x);',
    '      if(db<0.){ c=pick4(vec3(0.10,0.13,0.33),vec3(0.16,0.22,0.45),vec3(0.07,0.09,0.25),vec3(0.13,0.21,0.33),h.x); c=mix(c,vec3(0.32,0.45,0.70),0.8*smoothstep(0.026,0.008,dh)); }',
    '      else { c=pick4(vec3(0.06,0.09,0.20),vec3(0.10,0.16,0.27),vec3(0.05,0.07,0.16),vec3(0.10,0.17,0.19),h.x); c=mix(c,vec3(0.22,0.33,0.52),0.75*smoothstep(0.022,0.006,db)); } }',
    '    else if(code<2.5) c=pick4(vec3(0.06,0.09,0.15),vec3(0.085,0.135,0.13),vec3(0.11,0.12,0.22),vec3(0.14,0.16,0.09),h.x);',
    '    else if(code<3.5) c=pick4(vec3(0.40,0.45,0.55),vec3(0.46,0.47,0.51),vec3(0.35,0.42,0.53),vec3(0.38,0.46,0.49),h.x);',
    '    else if(code<4.5){ c=pick4(vec3(0.47,0.26,0.13),vec3(0.20,0.21,0.35),vec3(0.56,0.35,0.15),vec3(0.16,0.18,0.32),h.x);',
    '      if(hi==uChurch) c=pick4(vec3(0.07,0.09,0.20),vec3(0.12,0.15,0.28),vec3(0.05,0.07,0.15),vec3(0.18,0.22,0.36),h.x); }',
    '    else { float li=uLight[hi]; c=mix(vec3(0.46,0.33,0.10),vec3(1.0,0.88,0.42),li); wet=li; } }',
    '  vec4 L=texture(uPaint,uv); if(wp>0.5&&L.a>0.004){ vec3 pc=L.rgb/L.a; float pl=lum(pc); pc=max(mix(vec3(pl),pc,1.35),0.);',
    '    pc*=min(1.,0.66/max(lum(pc),1e-3));',     // gold, never flat cream: a capped value keeps the ridge light and the valleys on gilded strokes
    '    float cov=(1.-exp(-L.a*1.7))*(cypD(s,uAspect)<0.?0.35:s.y>0.64?0.8:1.); c=mix(c,pc*(0.80+0.36*h.z),cov); wet=max(wet,cov); }',
    '  vec2 q=vec2(uv.x*uAspect,uv.y);',
    '  for(int i=0;i<3;i++){ vec4 k=uShock[i]; if(k.w<=0.) continue; float r=length(q-k.xy);',      // the shock ring, painted: a gold double ring racing outward
    '    float z1=(r-k.z)/0.022, z2=(r-k.z*0.78)/0.016; float b=exp(-z1*z1)+0.55*exp(-z2*z2); c=mix(c,mix(vec3(1.0,0.78,0.20),vec3(1.0,0.95,0.70),h.z),clamp(b*k.w,0.,1.)*0.9); }',
    '  return c; }',
    'vec2 dirAt(vec2 p){return texture(uDir,p/uRes).xy;}',
    'void main(){',
    '  vec2 px=gl_FragCoord.xy; vec4 d0=texelFetch(uDir,ivec2(px/uRes*uDirRes),0); float reg=floor(d0.z*0.25+0.01);',
    '  float cs=uCell*(d0.z-reg*4.);',
    '  float L=cs*uLenK*d0.w;',
    '  float ds=L/14.;',
    '  vec2 a=px; a+=dirAt(a)*ds; a+=dirAt(a)*ds; float sa=-2.*ds;',
    '  float bestP=-1., bestX=1., bestS=0., bestLat=0.; vec2 bestC=px; vec4 bestH=vec4(0.5);',
    '  for(int k=0;k<16;k++){',
    '    vec4 dA=texture(uDir,a/uRes); if(abs(dA.z-d0.z)>1.5) break;',     // a stroke ends at the edge of a form (no funnelling into the spire)
    '    vec2 b=a-dA.xy*ds; vec2 ab=b-a; float ab2=max(dot(ab,ab),1e-6);',
    '    vec2 base=floor(0.5*(a+b)/cs-0.5);',
    '    for(int j=0;j<4;j++){',
    '      vec2 cell=base+vec2(float(j&1),float(j>>1));',
    '      vec4 h=texelFetch(uRand,ivec2(mod(cell,256.)),0);',
    '      vec2 c=(cell+0.5+(h.xy-0.5)*0.5)*cs; float rho=(0.30+0.18*h.z)*cs;',
    '      float t=clamp(dot(c-a,ab)/ab2,0.,1.); vec2 dc=c-(a+ab*t); float dist=length(dc); float s=sa+t*ds;',
    '      float w=s<0.?1.:1.-0.52*(s/L)*(s/L); float rr=rho*w;',
    '      if(dist<rr){ float sc=h.w+0.03*(1.-dist/rr);',
    '        if(sc>bestP){ bestP=sc; bestC=c; bestX=dist/rr; bestS=s/L; bestLat=(dc.x*ab.y-dc.y*ab.x)>0.?bestX:-bestX; bestH=h; } } }',
    '    a=b; sa+=ds; }',
    '  vec3 col; float hgt, wet;',
    '  if(bestP<0.){ col=mix(paintAt(px/uRes,vec4(0.5),wet,0.)*0.62,vec3(0.07,0.12,0.27),0.5); hgt=0.14; }   // between strokes: a Prussian-blue contour (paint never fills it)',
    '  else { col=paintAt(bestC/uRes,bestH,wet,1.); col*=0.84+0.32*bestH.x;',
    '    float prof=sqrt(max(0.,1.-bestX*bestX));',
    '    hgt=(0.30+0.70*prof)*(0.70+0.30*bestH.z)*(1.-0.35*clamp(bestS,0.,1.));',
    '    hgt+=0.09*sin(bestLat*9.+bestH.y*30.)*prof; }',
    '  { vec2 uvp=px/uRes; vec2 u2=uvp-texture(uDisp,uvp).xy; vec2 qp=vec2(u2.x*uAspect,u2.y); float jit=(texelFetch(uRand,ivec2(mod(px,256.)),0).x-0.5)*0.35;',
    '    for(int i=0;i<24;i++){ if(i>=uNHalo) break; vec4 hl=uHalo[i]; float r=length(qp-hl.xy)/hl.w+jit; float k=smoothstep(1.05,0.75,r)*min(1.,uHaloB[i].x*1.4);',
    '      if(k>0.){ col=mix(col,uHaloB[i].z>0.5?vec3(1.0,0.98,0.88):vec3(1.0,0.95,0.70),k); hgt=max(hgt,0.45+0.4*k); } } }',
    '  vec4 fgp=texture(uFg,px/uRes); if(floor(fgp.r*255.+0.5)==5. && cypD(vec2(px.x/uRes.x,1.-px.y/uRes.y),uAspect)>0.){',   // windows: always a crisp dab
    '    float li=uLight[int(fgp.g*255.+0.5)]; col=mix(vec3(0.46,0.33,0.10),vec3(1.0,0.88,0.42),li); hgt=0.55; }',
    '  o=vec4(clamp(col,0.,1.),clamp(hgt,0.,1.));',
    '}'].join('\n');

  var BRIGHT_FS = HEAD + 'uniform sampler2D uS; uniform vec2 uTx;\nvoid main(){vec3 c=0.25*(texture(uS,vUv+uTx*vec2(-.5,-.5)).rgb+texture(uS,vUv+uTx*vec2(.5,-.5)).rgb+texture(uS,vUv+uTx*vec2(-.5,.5)).rgb+texture(uS,vUv+uTx*vec2(.5,.5)).rgb);\nfloat l=dot(c,vec3(.2126,.7152,.0722)); o=vec4(c*smoothstep(0.50,0.86,l),1.);}';
  var BLUR_FS = HEAD + 'uniform sampler2D uS; uniform vec2 uD;\nvoid main(){vec3 c=texture(uS,vUv).rgb*0.227; c+=(texture(uS,vUv+uD*1.385).rgb+texture(uS,vUv-uD*1.385).rgb)*0.316; c+=(texture(uS,vUv+uD*3.231).rgb+texture(uS,vUv-uD*3.231).rgb)*0.070; o=vec4(c,1.);}';

  // the picture: relief lighting of the paint ridges, glow, and the person's shadow
  var COMP_FS = HEAD + [
    'uniform sampler2D uS, uB1, uB2, uBody; uniform vec2 uPx; uniform float uRelief, uInside, uBloom;',
    'void main(){',
    '  vec4 s=texture(uS,vUv);',
    '  float hl=texture(uS,vUv-vec2(uPx.x,0.)).a, hr=texture(uS,vUv+vec2(uPx.x,0.)).a, hb=texture(uS,vUv-vec2(0.,uPx.y)).a, ht=texture(uS,vUv+vec2(0.,uPx.y)).a;',
    '  vec3 n=normalize(vec3((hl-hr)*uRelief*2.6,(hb-ht)*uRelief*2.6,1.));',
    '  vec3 ld=normalize(vec3(-0.50,0.62,0.60));',
    '  float shade=1.+0.95*(dot(n,ld)-ld.z);',
    '  float ao=mix(0.50,1.0,smoothstep(0.0,0.42,s.a));',
    '  float spec=pow(max(0.,dot(reflect(-ld,n),vec3(0.,0.,1.))),18.)*0.20*smoothstep(0.25,0.8,s.a)*uRelief;',
    '  vec3 c=s.rgb*shade*ao+vec3(1.,0.96,0.86)*spec;',
    '  c+=(texture(uB1,vUv).rgb*0.55+texture(uB2,vUv).rgb*0.75)*uBloom;',
    '  float m=texture(uBody,vUv).r; c*=mix(1.,uInside,smoothstep(0.30,0.70,m));',
    '  o=vec4(c,1.);',
    '}'].join('\n');

  // on demand (tests only): how much people-made state is left, per coarse cell
  var STATS_FS = HEAD + [
    'uniform sampler2D uUp, uDisp, uPaint;',
    'void main(){ vec3 acc=vec3(0.); for(int j=0;j<4;j++) for(int i=0;i<4;i++){ vec2 uv=vUv+(vec2(float(i),float(j))-1.5)/vec2(160.,100.);',
    '  acc+=vec3(length(texture(uUp,uv).xy),length(texture(uDisp,uv).xy),texture(uPaint,uv).a); } o=vec4(acc/16.,1.); }'].join('\n');

  // ------------------------------------------------------------------ the piece
  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('vangogh needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false});
    if (!gl) throw new Error('vangogh needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('vangogh needs EXT_color_buffer_float');
    var destroyed = false, progs = [], texs = [], fbs = [], fullRes = [];
    var vao = gl.createVertexArray();
    var t0create = performance.now();

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('vangogh shader: ' + e); }
      return s;
    }
    var vs = shader(gl.VERTEX_SHADER, VS);
    function program(fsSrc) {
      var p = gl.createProgram(), fs = shader(gl.FRAGMENT_SHADER, fsSrc);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error('vangogh link: ' + e); }
      progs.push(p); var cache = {};
      return {p: p, u: function (n) { if (!(n in cache)) cache[n] = gl.getUniformLocation(p, n); return cache[n]; }};
    }
    var P = {
      base: program(BASE_FS), force: program(FORCE_FS), curl: program(CURL_FS), vort: program(VORT_FS), div: program(DIV_FS),
      press: program(PRESS_FS), grad: program(GRAD_FS), scale: program(SCALE_FS), adv: program(ADV_FS), paint: program(PAINT_FS),
      fg: program(FG_FS), dir: program(DIR_FS), stroke: program(STROKE_FS), bright: program(BRIGHT_FS), blur: program(BLUR_FS),
      comp: program(COMP_FS), stats: program(STATS_FS)
    };
    gl.deleteShader(vs);

    function texture(w, h, ifmt, fmt, type, filter, data) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
      texs.push(t); return t;
    }
    function target(w, h, ifmt, fmt, type, filter, list) {
      var t = texture(w, h, ifmt, fmt, type, filter), f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('vangogh: framebuffer incomplete');
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      fbs.push(f); var o = {t: t, f: f, w: w, h: h};
      if (list) list.push(o);
      return o;
    }
    function half(w, h, filter) { return target(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, filter || gl.LINEAR); }
    function dbl(w, h, filter) {
      var a = half(w, h, filter), b = half(w, h, filter);
      return {get r() { return a; }, get w() { return b; }, swap: function () { var t = a; a = b; b = t; }, clear: function () {
        [a, b].forEach(function (x) { gl.bindFramebuffer(gl.FRAMEBUFFER, x.f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }); }};
    }
    function freeTarget(o) {
      var i = texs.indexOf(o.t); if (i >= 0) texs.splice(i, 1); gl.deleteTexture(o.t);
      var j = fbs.indexOf(o.f); if (j >= 0) fbs.splice(j, 1); gl.deleteFramebuffer(o.f);
    }

    // ---- sizes: the sim grid has square cells, 100 rows
    var W = canvas.width || 1280, H = canvas.height || 800, aspect = W / Math.max(1, H);
    var SH = 100, SW = Math.max(40, Math.round(100 * aspect)), N = SW * SH;
    var base = half(SW, SH), refBase = half(SW, SH), up = dbl(SW, SH), curl = half(SW, SH, gl.NEAREST), divT = half(SW, SH, gl.NEAREST), pr = dbl(SW, SH, gl.NEAREST);
    var disp = dbl(SW * 2, SH * 2), paint = dbl(SW * 4, SH * 4), dirT = half(SW * 2, SH * 2);
    var b1 = half(SW * 2, SH * 2), b1b = half(SW * 2, SH * 2), b2 = half(SW, SH), b2b = half(SW, SH);
    var statsT = half(40, 25, gl.NEAREST);
    var fg = target(SW * 4, SH * 4, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    var zero = texture(1, 1, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST, new Uint16Array(4));
    var strokeT = null;
    function makeFull() { fullRes.forEach(freeTarget); fullRes = []; strokeT = target(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, fullRes); }
    makeFull();
    // per-cell random numbers for the brush dabs (fixed seed: the same strokes every start)
    var rnd = new Uint8Array(256 * 256 * 4), seed = 0x9e3779b9;
    for (var ri = 0; ri < rnd.length; ri++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; rnd[ri] = (seed >>> 0) & 255; }
    var randT = texture(256, 256, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST, rnd);
    // the body, resampled into the sim grid (rows bottom-up): silhouette, outline flow (cells/s), motion
    var bodyData = new Float32Array(N * 4), bodyT = texture(SW, SH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, bodyData);

    var unit = 0;
    function bind(Pr, name, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(Pr.u(name), unit); unit++; }
    function draw(Pr, tgt, setup) {
      gl.useProgram(Pr.p); unit = 0;
      if (tgt) { gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.f); gl.viewport(0, 0, tgt.w, tgt.h); }
      else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); }
      if (setup) setup(Pr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(vao);

    // ---- the static foreground, made once
    (function () {
      var hA = new Float32Array(48), hB = new Float32Array(48);
      HOUSES.forEach(function (h, i) { hA.set([h[0], h[1], h[2], h[3]], i * 4); hB.set([h[4], h[5], h[6], 0], i * 4); });
      draw(P.fg, fg, function (p) { gl.uniform4fv(p.u('uH'), hA); gl.uniform4fv(p.u('uH2'), hB); gl.uniform1i(p.u('uNH'), HOUSES.length); gl.uniform1f(p.u('uAspect'), aspect); });
    })();

    // ---- state
    var settings = {swirl: SWIRL, paint: PAINT, stroke: STROKE, memory: MEMORY_S, inside: INSIDE};
    var simT = 0, acc = 0, steps = 0, frames = 0, elapsed = 0;
    var velQ = [], paintQ = [];          // splats waiting for the next sim step: {x, y (screen), r, vx, vy (cells/s, screen y down), spin, mode, amt} / {x, y, r, col, amt}
    var stars = [], ribbons = [], nextStar = 1, shocks = [], touchSpots = [];
    var lights = new Float32Array(12).fill(0.2), lightTarget = new Float32Array(12).fill(0), lightDelay = new Float32Array(12).fill(-1);
    var cyp = {lean: 0, flick: 0.5};
    var counters = {blooms: 0, stars: 0, starsBody: 0, starsFinger: 0, starsRibbon: 0, ribbons: 0, ribbonsBody: 0, ribbonsTouch: 0, ribbonsFinger: 0, ribbonsWake: 0, impulses: 0};
    var last = null;
    var body = WallBody.create(kit, {}), BW = WallBody.w, BH = WallBody.h;

    function pushVel(x, y, r, vx, vy, spin, mode, amt) { if (!Number.isFinite(x + y + r + vx + vy + spin + amt)) return; if (velQ.length >= 24) velQ.shift(); velQ.push({x: x, y: y, r: r, vx: vx, vy: vy, spin: spin, mode: mode, amt: amt}); }
    var ink = 0;                                                 // CPU estimate of the starlight paint out in the sky (amount x area, share of the wall)
    function inkK() { return clamp(1.15 - ink / INK_CAP * 0.6, 0.18, 1); }
    function pushPaint(x, y, r, col, amt, full) {                 // full = the big moments (ribbons, taps) are thinned at most to 55%
      if (!Number.isFinite(x + y + r + amt + col[0] + col[1] + col[2])) return;
      amt *= full ? Math.max(0.55, inkK()) : inkK(); ink += amt * Math.PI * r * r / aspect;
      if (paintQ.length >= 24) paintQ.shift(); paintQ.push({x: x, y: y, r: r, col: col, amt: amt});
    }
    var GOLD = [1.0, 0.76, 0.16], LEMON = [1.0, 0.92, 0.42], WHITE = [1.0, 0.97, 0.80];
    function starlight(t) { var k = 0.5 + 0.5 * Math.sin(t); return k < 0.75 ? mix3(GOLD, LEMON, k / 0.75) : mix3(LEMON, WHITE, (k - 0.75) * 4); }
    function mix3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    // ---- new stars and ribbons
    function plantStar(x, y, src, bloom) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      x = clamp(x, 0.04, 0.96); y = clamp(y, 0.07, 0.52);
      if (bloom) { shocks.push({x: x, y: y, t0: simT}); if (shocks.length > 3) shocks.shift(); counters.blooms++; bloomSpin(x, y); }
      for (var i = 0; i < stars.length; i++) {             // planting on a living star feeds it instead (a bloom takes it over)
        var s = stars[i]; if (!s.fading && Math.hypot((s.x - x) * aspect, s.y - y) < (bloom ? 0.12 : 0.09)) {
          s.born = Math.min(s.born, simT - 2.5); s.renew = simT; if (bloom) { s.bloom = simT; s.R = BLOOM_R; s.x = x; s.y = y; } return s; }
      }
      var live = stars.filter(function (s) { return !s.fading; });
      if (live.length >= MAX_STARS) { live.sort(function (a, b) { return a.renew - b.renew; }); live[0].fading = simT; }
      if (stars.length > MAX_STARS + 2) stars.shift();
      var st = {id: nextStar++, x: x, y: y, born: bloom ? simT - 2.15 : simT, renew: simT, fading: 0, spin: (x < 0.5 ? 1 : -1) * (Math.random() < 0.25 ? -1 : 1),
                R: bloom ? BLOOM_R : 0.095 + Math.random() * 0.025, bloom: bloom ? simT : 0, src: src, armT: 0, armA: Math.random() * 6.28};
      stars.push(st); counters.stars++;
      if (src === 'body') counters.starsBody++; else if (src === 'finger') counters.starsFinger++; else if (src === 'ribbon') counters.starsRibbon++;
      pushPaint(x, y, 0.035, WHITE, 0.9, true);
      return st;
    }
    function starLife(s) {                                     // 0..1: grows in ~2.5 s, turns for a minute, fades
      var age = simT - s.renew, grow = clamp((simT - s.born) / 2.5, 0, 1); grow = grow * grow * (3 - 2 * grow);   // (a bloom is born nearly grown)
      var fade = 1 - clamp((age - (STAR_LIFE_S - 18)) / 18, 0, 1);
      if (s.fading) fade = Math.min(fade, 1 - clamp((simT - s.fading) / 3, 0, 1));
      return grow * fade;
    }
    function bloomPeak(a) { var up = clamp(a / 0.3, 0, 1), down = clamp((a - (BLOOM_S - 1.0)) / 1.6, 0, 1); return up * up * (3 - 2 * up) * (1 - down * down * (3 - 2 * down)); }
    function bloomSpin(x, y) {                                   // the bloom sets the sky turning and throws a ring of gold
      pushVel(x, y, 0.26, 0, 0, (x < 0.5 ? 1 : -1) * 70, 0, 1);
      for (var j = 0; j < 14; j++) { var a = j / 14 * 6.283; pushPaint(x + Math.cos(a) * 0.075 / aspect, y + Math.sin(a) * 0.075, 0.022, j & 1 ? GOLD : LEMON, 0.8, true); }
      pushPaint(x, y, 0.04, LEMON, 0.7, true);
    }
    function launchRibbon(x, y, src) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      for (var i = 0; i < ribbons.length; i++) if (simT - ribbons[i].t0 < 0.5 && Math.abs(ribbons[i].x0 - x) < 0.1) return null;
      if (ribbons.length >= MAX_RIBBONS) return null;
      if (src !== 'body' && touchSpots.some(function (sp) { return simT - sp.t < LOW_COOLDOWN_S && Math.abs(sp.x - x) < 0.12; })) return null;   // no strobe from one spot
      if (src !== 'body') { touchSpots.push({x: x, t: simT}); if (touchSpots.length > 8) touchSpots.shift(); }
      var xe = clamp(x + (Math.random() - 0.5) * 0.3, 0.26, 0.88);
      var rb = {x0: x, y0: clamp(y, LOW_Y - 0.05, 0.98), xe: xe, ye: 0.24 + Math.random() * 0.12, t0: simT, age: 0, turns: 1.3 + Math.random() * 0.5,
                amp: 0.05 + Math.random() * 0.03, ph: Math.random() * 6.28, side: Math.random() < 0.5 ? -1 : 1, px: x, py: y, src: src};
      ribbons.push(rb); counters.ribbons++;
      if (src === 'body') counters.ribbonsBody++; else if (src === 'touch') counters.ribbonsTouch++; else if (src === 'finger') counters.ribbonsFinger++; else if (src === 'wake') counters.ribbonsWake++;
      HOUSES.forEach(function (h, k) { var d = Math.abs(h[0] - x); lightDelay[k] = d * 0.9; lightTarget[k] = 1; });   // the whole village flashes on, in a wave
      for (var j = 0; j < 6; j++) { var a = j / 6 * 6.283; pushPaint(x + Math.cos(a) * 0.03 / aspect, y + Math.sin(a) * 0.03, 0.016, starlight(j), 0.7, true); }
      pushVel(x, y, 0.06, 0, -30, 25 * rb.side, 0, 1);
      return rb;
    }
    function ribbonPos(rb, u) {
      var e = 1 - (1 - u) * (1 - u), amp = rb.amp * (0.25 + 0.75 * u);   // shoots up, slows into the apex
      return [rb.x0 + (rb.xe - rb.x0) * e + amp * Math.sin(6.283 * rb.turns * u + rb.ph) * rb.side / aspect, rb.y0 + (rb.ye - rb.y0) * e + amp * 0.35 * Math.cos(6.283 * rb.turns * u + rb.ph)];
    }
    function updateRibbons(dt) {
      for (var i = ribbons.length - 1; i >= 0; i--) {
        var rb = ribbons[i]; rb.age += dt; var u = clamp(rb.age / RIBBON_S, 0, 1), p = ribbonPos(rb, u);
        var vx = (p[0] - rb.px) / Math.max(dt, 1e-3), vy = (p[1] - rb.py) / Math.max(dt, 1e-3);
        var segL = Math.hypot((p[0] - rb.px) * aspect, p[1] - rb.py), sub = Math.max(1, Math.min(4, Math.ceil(segL / 0.008)));
        for (var k = 1; k <= sub; k++) {
          var x = rb.px + (p[0] - rb.px) * k / sub, y = rb.py + (p[1] - rb.py) * k / sub;
          pushPaint(x, y, 0.022 + 0.008 * u, starlight(rb.age * 7 + i * 1.7 + k * 0.2), Math.min(0.5, 0.26 + 30 * segL) * settings.paint / sub * Math.min(1, sub * 0.7), true);
        }
        pushVel(p[0], p[1], 0.04, vx * SW * 0.15, vy * SH * 0.15, 9 * rb.side, 0, 3 * dt);
        rb.px = p[0]; rb.py = p[1];
        if (u >= 1) { ribbons.splice(i, 1); plantStar(p[0], p[1], 'ribbon', true); }
      }
    }
    function updateStars(dt) {
      shocks = shocks.filter(function (k) { return simT - k.t0 < 1.8; });
      for (var i = stars.length - 1; i >= 0; i--) {
        var s = stars[i], life = starLife(s);
        if (life <= 0.001 && simT - s.born > 3) { stars.splice(i, 1); continue; }
        s.armT += dt;
        if (s.armT > 0.55 && life > 0.2) {                     // pulses of starlight on the rim, wound into spiral arms by the whirlpool
          s.armT = 0; s.armA += 2.1;
          for (var k = 0; k < 3; k++) { var a = s.armA + k * 2.094, r = s.R * (0.55 + 0.25 * Math.random());
            pushPaint(s.x + Math.cos(a) * r / aspect, s.y + Math.sin(a) * r, 0.012, k === 1 ? WHITE : GOLD, 0.30 * life * settings.paint); }
        }
      }
    }
    function updateLights(dt) {
      var k = 1 - Math.exp(-dt / LIGHT_S);
      for (var i = 0; i < 12; i++) {
        if (lightDelay[i] >= 0) { lightDelay[i] -= dt; if (lightDelay[i] < 0) { lights[i] = Math.max(lights[i], lightTarget[i]); lightDelay[i] = -1; } }
        lights[i] += (0.2 - lights[i]) * k;
      }
    }

    // ---- one impulse for every kind of tap (Wake, touch(), a new fingertip)
    function impulse(x, y, src, strength, radius) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      x = clamp(x, 0, 1); y = clamp(y, 0, 1);
      var k = clamp(Number.isFinite(strength) ? strength : 1, 0.2, 2), r = clamp(Number.isFinite(radius) && radius > 0 ? radius : 0.06, 0.03, 0.2);
      counters.impulses++; last = {x: +x.toFixed(3), y: +y.toFixed(3), src: src, t: Math.round(simT * 100) / 100};
      var spin = (x < 0.5 ? 1 : -1) * 34 * k;
      pushVel(x, y, r * 1.3, 0, 0, spin, 0, 1);
      pushPaint(x, y, r * 0.45, LEMON, 0.55 * k, true);
      for (var j = 0; j < 5; j++) { var a = j / 5 * 6.283; pushPaint(x + Math.cos(a) * r * 0.8 / aspect, y + Math.sin(a) * r * 0.8, r * 0.25, j & 1 ? GOLD : LEMON, 0.45 * k, true); }
      if (y >= LOW_Y) launchRibbon(x, y, src);
    }

    // ---- the body: resampled into the sim grid, outline flow, people with ids, stillness, low motion
    var look = new Int32Array(N).fill(-1), lfx = new Float32Array(N), lfy = new Float32Array(N), lookAt = -1e9, lookOk = false;
    var ms = new Float32Array(N), prevMs = new Float32Array(N), bg = new Float32Array(N), mo = new Float32Array(N), flx = new Float32Array(N), fly = new Float32Array(N), tmpA = new Float32Array(N), tmpB = new Float32Array(N);
    var ls = new Int16Array(N).fill(-1), validK = new Float32Array(BW * BH), vtmp = new Float32Array(BW * BH), mk = new Float32Array(BW * BH);
    var lastFold = -1, tracks = [], nextTrack = 1, bodyLive = false, bodyAt = -1e9, lowSpots = [], gapped = false;
    function buildLookup(nowMs) {
      lookAt = nowMs; var ok = false;
      for (var gy = 0; gy < SH; gy++) for (var gx = 0; gx < SW; gx++) {
        var i = gy * SW + gx, k = kit.fromScreen((gx + 0.5) / SW, 1 - (gy + 0.5) / SH);
        if (!k || !Number.isFinite(k[0]) || !Number.isFinite(k[1])) { look[i] = -1; continue; }
        var cu = k[0] / 4 - 0.5, cv = k[1] / 4 - 0.5;
        if (!(cu >= 0 && cu <= BW - 1 && cv >= 0 && cv <= BH - 1)) { look[i] = -1; continue; }
        var iu = Math.min(BW - 2, Math.floor(cu)), iv = Math.min(BH - 2, Math.floor(cv));
        look[i] = iv * BW + iu; lfx[i] = cu - iu; lfy[i] = cv - iv; ok = true;
      }
      lookOk = ok;
    }
    function resample(src, dst) {
      for (var i = 0; i < N; i++) { var j = look[i]; if (j < 0) { dst[i] = 0; continue; }
        var fx = lfx[i], fy = lfy[i];
        dst[i] = (src[j] * (1 - fx) + src[j + 1] * fx) * (1 - fy) + (src[j + BW] * (1 - fx) + src[j + BW + 1] * fx) * fy; }
    }
    function blur3(a, t) {                                       // 1-2-1 both ways, in place (t = scratch)
      for (var y = 0; y < SH; y++) for (var x = 0; x < SW; x++) { var i = y * SW + x; t[i] = (a[x > 0 ? i - 1 : i] + 2 * a[i] + a[x < SW - 1 ? i + 1 : i]) * 0.25; }
      for (var y2 = 0; y2 < SH; y2++) for (var x2 = 0; x2 < SW; x2++) { var k = y2 * SW + x2; a[k] = (t[y2 > 0 ? k - SW : k] + 2 * t[k] + t[y2 < SH - 1 ? k + SW : k]) * 0.25; }
    }
    function foldBody(nowMs) {                                  // a new depth frame: people first (ids, confirmation), then the fields
      var dtS = lastFold > 0 ? clamp((body.frameMs - lastFold) / 1000, 0.015, 0.25) : 0.033; lastFold = body.frameMs;
      var resumed = gapped; gapped = false;                      // back after a depth gap: the silhouette reappearing is not movement
      var ppl = body.people, conf = new Uint8Array(Math.max(1, ppl.length)), dets = [];
      ppl.forEach(function (p, idx) {
        var s = kit.toScreen(p.cx * 512, p.cy * 424);
        if (s && Number.isFinite(s[0]) && Number.isFinite(s[1])) dets.push({idx: idx, x: s[0], y: s[1], moving: p.moving, area: p.area});
      });
      // match to my own tracks (body.js forgets ids over a depth gap; mine survive ~0.8 s)
      var used = {}, pairs = [];
      dets.forEach(function (d, di) { tracks.forEach(function (t, ti) { var dd = Math.hypot((d.x - t.x) * aspect, d.y - t.y); if (dd < 0.3) pairs.push([dd, di, ti]); }); });
      pairs.sort(function (a, b) { return a[0] - b[0]; });
      var dUsed = {}, tUsed = {};
      pairs.forEach(function (pr) { if (dUsed[pr[1]] || tUsed[pr[2]]) return; dUsed[pr[1]] = 1; tUsed[pr[2]] = 1; dets[pr[1]].track = tracks[pr[2]]; });
      dets.forEach(function (d) {
        var t = d.track;
        if (!t) { t = {id: nextTrack++, x: d.x, y: d.y, vx: 0, vy: 0, born: nowMs, seen: nowMs, stillT: 0, armed: true, mv: 0.2, lowCool: 0, everMoved: false, box: [d.x, d.y, d.x, d.y], top: [d.x, d.y], lowMo: 0, lowX: d.x, lowY: d.y}; tracks.push(t); d.track = t; }
        var a = 1 - Math.exp(-dtS / 0.15);
        if (resumed) { t.holdMv = nowMs + 450; if (t.ext) t.ext = null; }   // body.js reports a burst of 'moving' for ~0.3 s after a gap
        else { t.vx += ((d.x - t.x) / dtS - t.vx) * a; t.vy += ((d.y - t.y) / dtS - t.vy) * a; }
        t.x = d.x; t.y = d.y; t.seen = nowMs; t.idx = d.idx;
        if (!(nowMs < (t.holdMv || 0))) t.mv += (d.moving - t.mv) * (1 - Math.exp(-dtS / 0.2));
        if (nowMs - t.born > 120) conf[d.idx] = 1;
      });
      tracks.forEach(function (t) { if (t.seen !== nowMs) t.idx = -1; });
      // the silhouette of confirmed people only (speckle and single noisy blobs inject nothing)
      var lab = body.label, mask = body.mask;
      for (var i = 0; i < BW * BH; i++) { var l = lab[i]; validK[i] = (l >= 0 && conf[l]) ? 1 : 0; }
      for (var pass = 0; pass < 2; pass++) {                    // grow by 2 cells (the soft edge of the mask is outside the labels)
        for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) { var j = y * BW + x, m = validK[j];
          if (x > 0) m = Math.max(m, validK[j - 1]); if (x < BW - 1) m = Math.max(m, validK[j + 1]); vtmp[j] = m; }
        for (var y2 = 0; y2 < BH; y2++) for (var x2 = 0; x2 < BW; x2++) { var j2 = y2 * BW + x2, m2 = vtmp[j2];
          if (y2 > 0) m2 = Math.max(m2, vtmp[j2 - BW]); if (y2 < BH - 1) m2 = Math.max(m2, vtmp[j2 + BW]); validK[j2] = m2; }
      }
      for (var q = 0; q < BW * BH; q++) mk[q] = mask[q] * validK[q];
      resample(mk, ms);
      if (resumed) prevMs.set(ms);
      for (var c = 0; c < N; c++) { var jj = look[c]; ls[c] = jj < 0 ? -1 : lab[jj + (lfx[c] > 0.5 ? 1 : 0) + (lfy[c] > 0.5 ? BW : 0)]; }
      // outline flow: where the silhouette edge moved, v = -(dm/dt) grad m / |grad m|^2 (cells/s, rows up)
      var kmo = Math.exp(-dtS / 0.35), kbg = 1 - Math.exp(-dtS / FURNITURE_S);
      for (var b0 = 0; b0 < N; b0++) bg[b0] += (ms[b0] - bg[b0]) * kbg;
      for (var gy = 0; gy < SH; gy++) for (var gx = 0; gx < SW; gx++) {
        var i2 = gy * SW + gx, dm = ms[i2] - prevMs[i2];
        var gxv = (ms[gx < SW - 1 ? i2 + 1 : i2] - ms[gx > 0 ? i2 - 1 : i2]) * 0.5, gyv = (ms[gy < SH - 1 ? i2 + SW : i2] - ms[gy > 0 ? i2 - SW : i2]) * 0.5;
        var g2 = gxv * gxv + gyv * gyv, f = g2 > 0.0016 ? -(dm / dtS) / (g2 + 0.012) : 0;
        f = clamp(f, -900, 900) * (1 - clamp((bg[i2] - 0.5) / 0.35, 0, 1)); var fx = f * gxv, fy = f * gyv, fm = Math.hypot(fx, fy);
        if (fm > 120) { fx *= 120 / fm; fy *= 120 / fm; }
        flx[i2] = flx[i2] * 0.45 + fx * 0.55; fly[i2] = fly[i2] * 0.45 + fy * 0.55;
        mo[i2] = Math.max(mo[i2] * kmo, Math.min(1, Math.abs(dm) * 3.2));
      }
      blur3(flx, tmpA); blur3(fly, tmpA);
      var bodyInk = 0;
      for (var c4 = 0; c4 < N; c4++) { var fm4 = Math.hypot(flx[c4], fly[c4]) * EDGE_PUSH; if (fm4 > 14 && ms[c4] < 0.85) bodyInk += clamp((fm4 - 14) / 32, 0, 1); }
      ink += bodyInk / N * 1.7 * settings.paint * inkK() * dtS * 0.8;
      prevMs.set(ms);
      // per person on screen: box, top, motion in the village zone
      var stats = {};
      for (var c2 = 0; c2 < N; c2++) { var li = ls[c2]; if (li < 0 || ms[c2] < 0.5) continue;
        var st = stats[li] || (stats[li] = {n: 0, l: 1, r: 0, t: 1, b: 0, tx: 0, ly: 0, ry: 0});
        var sx = ((c2 % SW) + 0.5) / SW, sy = 1 - (Math.floor(c2 / SW) + 0.5) / SH;
        st.n++; if (sx < st.l) { st.l = sx; st.ly = sy; } if (sx > st.r) { st.r = sx; st.ry = sy; } if (sy < st.t) { st.t = sy; st.tx = sx; } if (sy > st.b) st.b = sy; }
      tracks.forEach(function (t) { var st = t.idx >= 0 ? stats[t.idx] : null; if (st && st.n > 8) { t.box = [st.l, st.t, st.r, st.b]; t.top = [st.tx, st.t]; t.lowMo = 0; t.lx = 0; t.ly = 0;
        handComets(t, [[st.l, st.ly], [st.r, st.ry], [st.tx, st.t]], dtS); } });
      for (var c3 = 0; c3 < N; c3++) { var fm3 = Math.hypot(flx[c3], fly[c3]); if (fm3 < 6) continue; var w3 = Math.min(1, (fm3 - 6) / 24);
        var sx3 = ((c3 % SW) + 0.5) / SW, sy3 = 1 - (Math.floor(c3 / SW) + 0.5) / SH; if (sy3 < LOW_Y) continue;
        for (var ti = 0; ti < tracks.length; ti++) { var tr = tracks[ti]; if (tr.idx < 0 || !tr.box) continue;
          if (sx3 > tr.box[0] - 0.05 && sx3 < tr.box[2] + 0.05 && sy3 > tr.box[1] - 0.05 && sy3 < tr.box[3] + 0.05) { tr.lowMo += w3; tr.lx += sx3 * w3; tr.ly += sy3 * w3; break; } } }
      // decisions per person: a new star when held still, a ribbon when moving low
      tracks.forEach(function (t) {
        if (t.idx < 0 || nowMs - t.born < 120) return;
        if (t.mv > STILL_EXIT) { t.everMoved = true; t.armed = true; t.stillT = 0; }
        else if (t.mv < STILL_ENTER) t.stillT += dtS;               // in between (real Kinect wobble): hold the count
        if (t.armed && t.everMoved && t.stillT >= STAR_HOLD_S) { plantStar(t.top[0], t.top[1] - 0.07, 'body'); t.armed = false; }
        t.lowCool -= dtS;
        var lowNow = t.lowMo > LOW_MOTION && simT - (t.lowHandAt || -9) < 0.6;   // real limbs moving low, not a twitchy blob
        t.lowT = lowNow ? (t.lowT || 0) + dtS : Math.max(0, (t.lowT || 0) - dtS * 0.5);
        if (t.lowT >= LOW_HOLD_S && t.lowCool <= 0 && simT > 0.5 && t.lowMo > 0) {   // lowMo 0 = no low motion this frame: no place to send it from (was 0/0 -> NaN -> black sky, 10-08)
          var lx = t.lx / t.lowMo, ly = t.ly / t.lowMo, bodyRibbons = ribbons.filter(function (r) { return r.src === 'body'; }).length;
          var hot = lowSpots.some(function (sp) { return simT - sp.t < LOW_SPOT_S && Math.abs(sp.x - lx) < 0.12; });
          if (!hot && bodyRibbons < 2) { var rb = launchRibbon(lx, ly, 'body'); if (rb) { t.lowCool = LOW_COOLDOWN_S; t.lowT = 0; lowSpots.push({x: lx, t: simT}); if (lowSpots.length > 8) lowSpots.shift(); } }
        }
      });
      bodyLive = true; bodyAt = nowMs;
    }
    // the hands: a person's outermost points (left, right, top). Fast ones drag a comet of starlight and push the sky.
    function handComets(t, pts, dtS) {
      if (!t.ext) t.ext = pts.map(function (p) { return {x: p[0], y: p[1], vx: 0, vy: 0}; });
      pts.forEach(function (p, k) {
        var e = t.ext[k], dx = p[0] - e.x, dy = p[1] - e.y, jump = Math.hypot(dx * aspect, dy);
        if (jump > 0.09) { e.x = p[0]; e.y = p[1]; e.vx = 0; e.vy = 0; return; }   // the extreme point moved to another limb: no comet
        var a = 1 - Math.exp(-dtS / 0.09);
        e.vx += (dx / dtS - e.vx) * a; e.vy += (dy / dtS - e.vy) * a;
        var sp = Math.hypot(e.vx * aspect, e.vy), k2 = clamp((sp - 0.35) / 0.9, 0, 1);
        if (sp > 0.3 && p[1] > LOW_Y - 0.04) t.lowHandAt = simT;      // a quick hand (or foot) down in the village zone (~0.45 m/s)
        if (k2 > 0 && nowCount(t) ) {
          var n = Math.max(1, Math.min(3, Math.ceil(jump / 0.015)));
          for (var j = 1; j <= n; j++) pushPaint(e.x + dx * j / n, e.y + dy * j / n, 0.017 + 0.008 * k2, starlight(simT * 3 + k * 2 + j * 0.3), (0.10 + 0.32 * k2) * settings.paint * dtS * 30 / n);
          pushVel(p[0], p[1], 0.05, e.vx * SW * 0.9, e.vy * SH * 0.9, 0, 1, 0.45 * k2);
        }
        e.x = p[0]; e.y = p[1];
      });
    }
    function nowCount(t) { return t.idx >= 0; }
    function bodyFrame(dt, nowMs) {
      if (nowMs - lookAt > 2000 || (!lookOk && nowMs - lookAt > 250)) buildLookup(nowMs);
      var fresh = body.update(dt, nowMs);
      if (fresh && lookOk) foldBody(nowMs);
      else if (!body.fresh || nowMs - bodyAt > 90) {           // stale: the silhouette fades with body.js, nothing pushes any more
        if (!body.fresh) gapped = true;
        if (bodyLive) {
          for (var q = 0; q < BW * BH; q++) mk[q] = body.mask[q] * validK[q];
          resample(mk, ms); flx.fill(0); fly.fill(0);
          var k = Math.exp(-dt / 0.08), peak = 0; for (var i = 0; i < N; i++) { mo[i] *= k; if (ms[i] > peak) peak = ms[i]; if (mo[i] > peak) peak = mo[i]; }
          for (var b1 = 0; b1 < N; b1++) bg[b1] *= Math.exp(-dt / FURNITURE_S);
          if (peak < 0.12) { ms.fill(0); mo.fill(0); prevMs.fill(0); bodyLive = false; }
        }
      }
      tracks = tracks.filter(function (t) { return nowMs - t.seen < 800; });
      for (var c = 0; c < N; c++) { var o4 = c * 4; bodyData[o4] = ms[c]; bodyData[o4 + 1] = flx[c] * EDGE_PUSH; bodyData[o4 + 2] = fly[c] * EDGE_PUSH; bodyData[o4 + 3] = mo[c]; }
      gl.bindTexture(gl.TEXTURE_2D, bodyT); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SW, SH, gl.RGBA, gl.FLOAT, bodyData);
      // gusts: a walking person drags the sky around them (target velocity, so it never runs away)
      tracks.forEach(function (t) {
        if (t.idx < 0 || !t.box) return;
        var sp = Math.hypot(t.vx * aspect, t.vy), w = clamp((sp - 0.02) / 0.10, 0, 1);
        if (w <= 0) return;
        var bw = Math.max(0.08, t.box[2] - t.box[0]) * aspect, bh = Math.max(0.15, t.box[3] - t.box[1]);
        pushVel((t.box[0] + t.box[2]) / 2, (t.box[1] + t.box[3]) / 2, Math.max(bw * 1.15, bh * 0.62), t.vx * SW * GUST, t.vy * SH * GUST, 0, 1, w * (1 - Math.exp(-dt * 3.5)));
      });
    }

    // ---- fingertips (kit.fingers: every Kinect frame) and touch() (thinned reports)
    var tips = [], lastFingerT = 0, touchRecs = {};
    function fingersFrame(nowMs) {
      var f = kit.fingers, wnow = Date.now();
      var pts = (f && Array.isArray(f.pts) && wnow - f.t <= 150) ? f.pts : null;
      if (pts && f.t !== lastFingerT) {
        var dtR = lastFingerT ? clamp((f.t - lastFingerT) / 1000, 0.01, 0.2) : 0.033; lastFingerT = f.t;
        var used = {};
        pts.forEach(function (p) {
          if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || p[0] < -0.05 || p[0] > 1.05 || p[1] < -0.05 || p[1] > 1.05) return;
          var best = null, bd = 0.1;
          tips.forEach(function (t, i) { if (used[i]) return; var d = Math.hypot((t.x - p[0]) * aspect, t.y - p[1]); if (d < bd) { bd = d; best = i; } });
          var t;
          if (best === null) { t = {x: p[0], y: p[1], vx: 0, vy: 0, seen: nowMs, stillT: 0, armed: true}; tips.push(t); used[tips.length - 1] = 1; impulse(p[0], p[1], 'finger', 0.9); return; }
          used[best] = 1; t = tips[best];
          var vx = (p[0] - t.x) / dtR, vy = (p[1] - t.y) / dtR, a = 1 - Math.exp(-dtR / 0.08);
          t.vx += (vx - t.vx) * a; t.vy += (vy - t.vy) * a;
          var sp = Math.hypot(t.vx * aspect, t.vy);
          if (sp > 0.05) {                                   // stirring: drag the sky and a comet of starlight along the stroke
            pushVel(p[0], p[1], 0.045, t.vx * SW * 0.9, t.vy * SH * 0.9, (t.vx * t.vy >= 0 ? 1 : -1) * 6, 1, 0.22);
            var nn = Math.max(1, Math.min(3, Math.ceil(Math.hypot((p[0] - t.x) * aspect, p[1] - t.y) / 0.012)));
            for (var q = 1; q <= nn; q++) pushPaint(t.x + (p[0] - t.x) * q / nn, t.y + (p[1] - t.y) * q / nn, 0.021, starlight(nowMs / 300 + q * 0.2), clamp(0.3 + sp, 0, 1.6) * 0.75 * dtR * 30 * settings.paint / nn);
          }
          if (sp < 0.04) t.stillT += dtR; else if (sp > 0.12) { t.stillT = 0; t.armed = true; }
          if (t.armed && t.stillT >= STAR_HOLD_S) {
            if (p[1] < LOW_Y) { plantStar(p[0], p[1], 'finger'); t.armed = false; }
            else { launchRibbon(p[0], p[1], 'finger'); t.stillT = -1; }
          }
          t.x = p[0]; t.y = p[1]; t.seen = nowMs;
        });
      }
      tips = tips.filter(function (t) { return nowMs - t.seen < 250; });
    }
    function touch(t) {
      if (destroyed || !t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return;
      var f = kit.fingers; if (f && Array.isArray(f.pts) && f.pts.length && Date.now() - f.t < 300) return;   // the fingertip stream has it already
      var now = performance.now(), rec = touchRecs[t.id];
      if (t.first || !rec || now - rec.t > 1500) impulse(t.x, t.y, 'touch', 1);
      else { var dts = Math.max(0.03, (now - rec.t) / 1000), vx = (t.x - rec.x) / dts, vy = (t.y - rec.y) / dts;
        pushVel(t.x, t.y, 0.05, clamp(vx, -2, 2) * SW, clamp(vy, -2, 2) * SH, 0, 1, 0.5); pushPaint(t.x, t.y, 0.018, starlight(now / 400), 0.25 * settings.paint); }
      touchRecs[t.id] = {x: t.x, y: t.y, t: now};
      var ids = Object.keys(touchRecs); if (ids.length > 16) delete touchRecs[ids[0]];
    }
    function wake(sx, sy, radius, strength) { if (destroyed) return; impulse(sx, sy, 'wake', strength, radius); }

    // ---- uniforms for the analytic flow and the painted motifs
    var shockA = new Float32Array(12), vortA = new Float32Array(26 * 4), haloA = new Float32Array(24 * 4), haloB = new Float32Array(24 * 4), bigA = new Float32Array(8);
    function sceneUniforms(withPeople) {
      var nv = 0, nh = 0, sw = settings.swirl, t = simT;
      function vort(x, y, R, g) { if (nv < 26) { vortA.set([x * aspect, 1 - y, R, g * sw], nv * 4); nv++; } }
      BIG.forEach(function (b, i) { var wx = 0, wy = 0; vort(b[0] + wx, b[1] + wy, b[2], b[3]);
        bigA.set([(b[0] + wx) * aspect, 1 - (b[1] + wy), b[2], b[3]], i * 4); });
      vort(MOON[0], MOON[1], MOON[2] * 1.9, 0.85);
      STARS.forEach(function (s, i) {
        vort(s[0], s[1], s[2] * 0.95, s[4]);
        haloA.set([s[0] * aspect, 1 - s[1], s[2], s[3]], nh * 4);
        haloB.set([0.9 + 0.1 * Math.sin(t * (0.6 + 0.09 * i) + i * 1.7), t * (0.55 + 0.05 * i) * Math.sign(s[4]), 0, 0], nh * 4); nh++;
      });
      if (withPeople) stars.forEach(function (s) {
        var life = starLife(s); if (life <= 0.001 || nh >= 24) return;
        var pk = s.bloom ? bloomPeak(simT - s.bloom) : 0, R = s.R * (0.5 + 0.5 * life);
        if (s.bloom) R = BLOOM_R * (0.6 + 0.4 * life) + (BLOOM_PEAK_R - BLOOM_R) * pk;
        vort(s.x, s.y, R * (s.bloom ? 1.15 : 1.0), (s.bloom ? 2.6 + 2.6 * pk : 2.4) * s.spin * life);
        haloA.set([s.x * aspect, 1 - s.y, R, s.bloom ? 0.026 + 0.008 * pk : 0.019 * (0.6 + 0.4 * life)], nh * 4);
        haloB.set([Math.min(1, life * (0.88 + 0.12 * Math.sin((simT - s.born) * 2.4)) + 0.1 * pk), (simT - s.born) * 2.2 * s.spin, 1, pk], nh * 4); nh++;
      });
      if (withPeople) ribbons.forEach(function (rb) {        // the comet head of a ribbon of starlight
        if (nh >= 24) return; var k = clamp(rb.age / 0.25, 0, 1);
        haloA.set([rb.px * aspect, 1 - rb.py, 0.045, 0.016], nh * 4); haloB.set([k, rb.age * 9, 1, 0], nh * 4); nh++;
      });
      shockA.fill(0); var ns = 0;
      if (withPeople) shocks.forEach(function (k) {            // the bloom's shock ring: fast out, fading by ~1.6 s
        var a = simT - k.t0; if (a > 1.7 || ns >= 3) return; var e = clamp(a / 1.1, 0, 1);
        shockA.set([k.x * aspect, 1 - k.y, SHOCK_R * (1 - Math.pow(1 - e, 2.2)), 1 - clamp((a - 0.25) / 1.35, 0, 1)], ns * 4); ns++;
      });
      return {nv: nv, nh: nh, ns: ns};
    }
    function baseUniforms(p, sc) {
      gl.uniform4fv(p.u('uV'), vortA); gl.uniform1i(p.u('uNV'), sc.nv);
      gl.uniform4f(p.u('uWind'), WIND[0] * settings.swirl, WIND[1], WIND[2], WIND[3]);
      gl.uniform1f(p.u('uAspect'), aspect); gl.uniform1f(p.u('uT'), simT); gl.uniform1f(p.u('uPsiK'), 1 / Math.max(0.2, settings.swirl));
    }
    var vsA = new Float32Array(96), vvA = new Float32Array(96), psA = new Float32Array(96), pcA = new Float32Array(96);

    // ---- one simulation step
    function simStep(h, first) {
      simT += h; steps++;
      var sc = sceneUniforms(true), memory = Math.max(5, settings.memory);
      draw(P.base, base, function (p) { baseUniforms(p, sc); });
      var nvs = 0;
      if (first) { velQ.forEach(function (s, i) { vsA.set([s.x, 1 - s.y, s.r, s.mode], i * 4); vvA.set([s.vx, -s.vy, s.spin, s.amt], i * 4); }); nvs = velQ.length; velQ = []; }
      draw(P.force, up.w, function (p) {
        bind(p, 'uUp', up.r.t); bind(p, 'uBody', bodyT);
        gl.uniform1f(p.u('uAspect'), aspect); gl.uniform1f(p.u('uRelax'), 1 - Math.exp(-h * 9)); gl.uniform1f(p.u('uFlowGain'), 1);
        gl.uniform1f(p.u('uDecay'), Math.exp(-h / CURRENT_S)); gl.uniform1f(p.u('uDt'), h); gl.uniform4fv(p.u('uVS'), vsA); gl.uniform4fv(p.u('uVV'), vvA); gl.uniform1i(p.u('uNS'), nvs);
      }); up.swap();
      var tx = [1 / SW, 1 / SH];
      draw(P.curl, curl, function (p) { bind(p, 'uV', up.r.t); gl.uniform2fv(p.u('uTx'), tx); });
      draw(P.vort, up.w, function (p) { bind(p, 'uV', up.r.t); bind(p, 'uC', curl.t); gl.uniform2fv(p.u('uTx'), tx); gl.uniform1f(p.u('uCurl'), 4); gl.uniform1f(p.u('uDt'), h); }); up.swap();
      draw(P.div, divT, function (p) { bind(p, 'uV', up.r.t); gl.uniform2fv(p.u('uTx'), tx); });
      draw(P.scale, pr.w, function (p) { bind(p, 'uS', pr.r.t); gl.uniform1f(p.u('uK'), 0.8); }); pr.swap();
      for (var i = 0; i < 18; i++) { draw(P.press, pr.w, function (p) { bind(p, 'uP', pr.r.t); bind(p, 'uD', divT.t); gl.uniform2fv(p.u('uTx'), tx); }); pr.swap(); }
      draw(P.grad, up.w, function (p) { bind(p, 'uP', pr.r.t); bind(p, 'uV', up.r.t); gl.uniform2fv(p.u('uTx'), tx); }); up.swap();
      draw(P.adv, up.w, function (p) { bind(p, 'uBase', base.t); bind(p, 'uUp', up.r.t); bind(p, 'uS', up.r.t); gl.uniform2fv(p.u('uSimTx'), tx); gl.uniform4fv(p.u('uShock'), shockA);
        gl.uniform1f(p.u('uDt'), h); gl.uniform1f(p.u('uDecay'), 1); gl.uniform1f(p.u('uMode'), 0); gl.uniform1f(p.u('uMaxD'), 0); }); up.swap();
      draw(P.adv, disp.w, function (p) { bind(p, 'uBase', base.t); bind(p, 'uUp', up.r.t); bind(p, 'uS', disp.r.t); gl.uniform2fv(p.u('uSimTx'), tx);
        gl.uniform1f(p.u('uAspect'), aspect); gl.uniform4fv(p.u('uShock'), shockA);
        gl.uniform1f(p.u('uDt'), h); gl.uniform1f(p.u('uDecay'), Math.exp(-h / (memory * 0.8))); gl.uniform1f(p.u('uMode'), 1); gl.uniform1f(p.u('uMaxD'), 0.14); }); disp.swap();
      var nps = 0;
      if (first) { paintQ.forEach(function (s, i) { psA.set([s.x, 1 - s.y, s.r, s.amt], i * 4); pcA.set([s.col[0], s.col[1], s.col[2], 0], i * 4); }); nps = paintQ.length; paintQ = []; }
      var bc = starlight(simT * 2.1);
      draw(P.paint, paint.w, function (p) { bind(p, 'uBase', base.t); bind(p, 'uUp', up.r.t); bind(p, 'uS', paint.r.t); bind(p, 'uBody', bodyT);
        gl.uniform2fv(p.u('uSimTx'), tx); gl.uniform1f(p.u('uDt'), h); gl.uniform1f(p.u('uDecay'), Math.exp(-h / (memory * 0.75)));
        gl.uniform1f(p.u('uBodyPaint'), 1.7 * h * settings.paint * inkK()); gl.uniform1f(p.u('uAspect'), aspect); gl.uniform1f(p.u('uLowY'), LOW_Y);
        gl.uniform3f(p.u('uBodyCol'), bc[0], bc[1], bc[2]); gl.uniform4fv(p.u('uPS'), psA); gl.uniform4fv(p.u('uPC'), pcA); gl.uniform1i(p.u('uNP'), nps); }); paint.swap();
    }

    // ---- the picture (ref = the idle painting at the same moment, with nothing anyone caused; tests only)
    var lightU = new Float32Array(12);
    function render(ref) {
      var sc = sceneUniforms(!ref), baseTex = base.t;
      if (ref) { draw(P.base, refBase, function (p) { baseUniforms(p, sc); }); baseTex = refBase.t; }
      var upT = ref ? zero : up.r.t, dispT = ref ? zero : disp.r.t, paintT = ref ? zero : paint.r.t;
      var cypU = [CYPRESS_X, ref ? 0 : cyp.lean, ref ? 0.5 : cyp.flick, simT];
      var moonU = [MOON[0] * aspect, 1 - MOON[1], MOON[2], 0];
      draw(P.dir, dirT, function (p) { bind(p, 'uBase', baseTex); bind(p, 'uUp', upT); bind(p, 'uFg', fg.t); gl.uniform1f(p.u('uAspect'), aspect); gl.uniform4fv(p.u('uCyp'), cypU);
        gl.uniform4fv(p.u('uHalo'), haloA); gl.uniform1i(p.u('uNHalo'), sc.nh); gl.uniform4fv(p.u('uMoon'), moonU); gl.uniform4fv(p.u('uShock'), shockA); });
      for (var i = 0; i < 12; i++) lightU[i] = ref ? 0.2 : lights[i] * (lights[i] > 0.3 ? 0.93 + 0.07 * Math.sin(simT * 7.3 + i * 2.1) : 1);
      var cell = STROKE_PX * settings.stroke * (W / 1280) / 0.78;
      draw(P.stroke, strokeT, function (p) {
        bind(p, 'uDir', dirT.t); bind(p, 'uBase', baseTex); bind(p, 'uDisp', dispT); bind(p, 'uPaint', paintT); bind(p, 'uFg', fg.t); bind(p, 'uRand', randT);
        gl.uniform2f(p.u('uRes'), W, H); gl.uniform2f(p.u('uDirRes'), dirT.w, dirT.h); gl.uniform1f(p.u('uCell'), cell); gl.uniform1f(p.u('uLenK'), STROKE_LONG * 0.78); gl.uniform1f(p.u('uAspect'), aspect);
        gl.uniform1f(p.u('uT'), simT); gl.uniform1f(p.u('uBandK'), 2600); gl.uniform4fv(p.u('uCyp'), cypU);
        gl.uniform4fv(p.u('uBig'), bigA); gl.uniform4fv(p.u('uMoon'), moonU);
        gl.uniform4fv(p.u('uHalo'), haloA); gl.uniform4fv(p.u('uHaloB'), haloB); gl.uniform1i(p.u('uNHalo'), sc.nh); gl.uniform1fv(p.u('uLight'), lightU); gl.uniform1i(p.u('uChurch'), CHURCH);
        gl.uniform4fv(p.u('uShock'), shockA);
      });
      draw(P.bright, b1, function (p) { bind(p, 'uS', strokeT.t); gl.uniform2f(p.u('uTx'), 1 / W, 1 / H); });
      draw(P.blur, b1b, function (p) { bind(p, 'uS', b1.t); gl.uniform2f(p.u('uD'), 1 / b1.w, 0); });
      draw(P.blur, b1, function (p) { bind(p, 'uS', b1b.t); gl.uniform2f(p.u('uD'), 0, 1 / b1.h); });
      draw(P.blur, b2b, function (p) { bind(p, 'uS', b1.t); gl.uniform2f(p.u('uD'), 1 / b2.w, 0); });
      draw(P.blur, b2, function (p) { bind(p, 'uS', b2b.t); gl.uniform2f(p.u('uD'), 0, 1 / b2.h); });
      draw(P.comp, null, function (p) {
        bind(p, 'uS', strokeT.t); bind(p, 'uB1', b1.t); bind(p, 'uB2', b2.t); bind(p, 'uBody', ref ? zero : bodyT);
        gl.uniform2f(p.u('uPx'), 1 / W, 1 / H); gl.uniform1f(p.u('uRelief'), RELIEF); gl.uniform1f(p.u('uInside'), settings.inside); gl.uniform1f(p.u('uBloom'), BLOOM);
      });
    }

    function cypressFrame(dt) {
      var lean = 0, near = 0;
      tracks.forEach(function (t) { if (t.idx < 0) return; var d = Math.max(0, t.x - CYPRESS_X); lean += Math.exp(-d / 0.28); near += Math.exp(-d / 0.2) * clamp(t.mv * 4, 0, 1); });
      tips.forEach(function (t) { var d = Math.max(0, t.x - CYPRESS_X); lean += 0.6 * Math.exp(-d / 0.2); });
      var k = 1 - Math.exp(-dt / 1.2);
      cyp.lean += (clamp(lean, 0, 1) - cyp.lean) * k; cyp.flick += (0.5 + 2.4 * clamp(near, 0, 1) - cyp.flick) * k;
    }

    var roomToken=null, roomStarArmed=false, roomStarAt=-100;
    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); frames++; elapsed += dt;
      if (dt > 0) {
        ink *= Math.exp(-dt / (Math.max(5, settings.memory) * 0.75));
        bodyFrame(dt, now); fingersFrame(now); cypressFrame(dt);
        var room=kit.room?kit.room(dt):null;
        if(room){
          if(room.token!==roomToken){roomToken=room.token;roomStarArmed=false;}
          if(room.motion>.08 && room.positioned)roomStarArmed=true;
          if(room.motion>.002)pushVel(.5+room.x*.30,.55,.20,room.x*SW*room.motion*1.4,SH*room.motion*.25,0,1,dt*30);
          if(room.fresh && room.positioned && roomStarArmed && room.still_s>=2.5 && elapsed-roomStarAt>=8){
            plantStar(.5+room.x*.32,.27,'room',false);roomStarAt=elapsed;roomStarArmed=false;
          }
        }
        updateRibbons(dt); updateStars(dt); updateLights(dt);
        acc += dt; var n = 0;
        while (acc >= STEP_S && n < 3) { simStep(STEP_S, n === 0); acc -= STEP_S; n++; }
        if (n === 3) acc = 0;
      }
      render(false);
    }

    function resize(w, h) {
      if (destroyed || !w || !h) return;
      W = w; H = h; makeFull();
    }

    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.VangoghSet === set) delete window.VangoghSet;
      if (window.VangoghWake === wake) delete window.VangoghWake;
      if (window.__vangoghDebug) try { delete window.__vangoghDebug; } catch (e) { window.__vangoghDebug = undefined; }
      kit.wantDepth(false);
      fbs.forEach(function (f) { gl.deleteFramebuffer(f); }); texs.forEach(function (t) { gl.deleteTexture(t); }); progs.forEach(function (p) { gl.deleteProgram(p); });
      gl.deleteVertexArray(vao); fbs = []; texs = []; progs = [];
    }

    function set(v) {
      if (v && typeof v === 'object' && !destroyed) {
        if (Number.isFinite(v.swirl)) settings.swirl = clamp(v.swirl, 0.2, 3);
        if (Number.isFinite(v.paint)) settings.paint = clamp(v.paint, 0, 3);
        if (Number.isFinite(v.stroke)) settings.stroke = clamp(v.stroke, 0.5, 1.6);
        if (Number.isFinite(v.memory)) settings.memory = clamp(v.memory, 8, 120);
        if (Number.isFinite(v.inside)) settings.inside = clamp(v.inside, 0, 1);
      }
      return {swirl: settings.swirl, paint: settings.paint, stroke: settings.stroke, memory: settings.memory, inside: settings.inside};
    }

    // tests only (the live wall has no WallTest): state, people-made energy, and an exact idle reference to diff against
    if (window.WallTest) {
      var dbg = function () {
        var e = readStats();
        return {frames: frames, steps: steps, simT: +simT.toFixed(2), energy: e.energy, smear: e.smear, paint: e.paint, field: e.field,
                stars: stars.map(function (s) { return {id: s.id, x: +s.x.toFixed(3), y: +s.y.toFixed(3), life: +starLife(s).toFixed(2), src: s.src, bloomAge: s.bloom ? +(simT - s.bloom).toFixed(2) : null}; }),
                ribbons: ribbons.map(function (r) { return {x0: +r.x0.toFixed(3), y0: +r.y0.toFixed(3), age: +r.age.toFixed(2), src: r.src}; }),
                people: tracks.map(function (t) { return {id: t.id, x: +t.x.toFixed(3), y: +t.y.toFixed(3), mv: +t.mv.toFixed(3), still: +t.stillT.toFixed(2), armed: t.armed, live: t.idx >= 0, box: t.box ? t.box.map(function (v) { return +v.toFixed(3); }) : null, lowMo: +(t.lowMo || 0).toFixed(1), lowHand: t.lowHandAt ? +(simT - t.lowHandAt).toFixed(2) : null}; }),
                tips: tips.length, ink: +ink.toFixed(4), inkK: +inkK().toFixed(2), counters: JSON.parse(JSON.stringify(counters)), last: last, lights: Array.prototype.map.call(lights, function (l) { return +l.toFixed(2); }),
                cypress: {lean: +cyp.lean.toFixed(2), flick: +cyp.flick.toFixed(2)}, present: body.present, fresh: body.fresh, regOk: body.regOk, bodyLive: bodyLive,
                queued: [velQ.length, paintQ.length], settings: set(), startupMs: startupMs, glError: gl.getError(), bodyStats: bodyStats(), gl: {tex: texs.length, fb: fbs.length, prog: progs.length}};
      };
      dbg.diff = function (box, thrs) { return diffStats(box, thrs); };
      dbg.shotIdle = function () { render(true); return true; };   // draw the idle reference into the canvas (for a still)
      dbg.plant = function (x, y) { return !!plantStar(x, y, 'test'); };
      window.__vangoghDebug = dbg;
    }
    function bodyStats() {
      var fm = 0, f30 = 0, f60 = 0, mm = 0, sm = 0, area = 0;
      for (var i = 0; i < N; i++) { var f = Math.hypot(flx[i], fly[i]); if (f > fm) fm = f; if (f > 30) f30++; if (f > 60) f60++; if (mo[i] > mm) mm = mo[i]; if (ms[i] > 0.5) area++; }
      return {flowMax: Math.round(fm), over30: f30, over60: f60, moMax: +mm.toFixed(2), area: area, lowMo: tracks.map(function (t) { return +(t.lowMo || 0).toFixed(1); })};
    }
    var statsBuf = new Float32Array(40 * 25 * 4);
    function readStats() {
      draw(P.stats, statsT, function (p) { bind(p, 'uUp', up.r.t); bind(p, 'uDisp', disp.r.t); bind(p, 'uPaint', paint.r.t); });
      gl.readPixels(0, 0, 40, 25, gl.RGBA, gl.FLOAT, statsBuf);
      var e = 0, s = 0, pa = 0, n = 40 * 25;
      for (var i = 0; i < n; i++) { e += statsBuf[i * 4]; s += statsBuf[i * 4 + 1]; pa += statsBuf[i * 4 + 2]; }
      e /= n; s /= n; pa /= n;
      var live = stars.reduce(function (a, st) { return a + starLife(st); }, 0);
      return {energy: +e.toFixed(4), smear: +(s * 1000).toFixed(3), paint: +pa.toFixed(4), field: +(e / 10 + s * 50 + pa * 4 + live * 0.05 + ribbons.length * 0.1).toFixed(4)};
    }
    function diffStats(box, thrs) {                               // |frame - idle| at the same moment: share of pixels over each threshold, centroid
      thrs = thrs || [15, 25];
      var a = new Uint8Array(W * H * 4), b = new Uint8Array(W * H * 4);
      render(true); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
      render(false); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, a);
      var x0 = 0, y0 = 0, x1 = W, y1 = H;
      if (box) { x0 = Math.max(0, Math.floor(box[0] * W)); y0 = Math.max(0, Math.floor(box[1] * H)); x1 = Math.min(W, Math.ceil(box[2] * W)); y1 = Math.min(H, Math.ceil(box[3] * H)); }
      var cnt = thrs.map(function () { return 0; }), n = 0, sw = 0, sx = 0, sy = 0, sum = 0, cntAll = 0;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var i = ((H - 1 - y) * W + x) * 4;
        var d = Math.abs((a[i] - b[i]) * 0.2126 + (a[i + 1] - b[i + 1]) * 0.7152 + (a[i + 2] - b[i + 2]) * 0.0722);
        if (d > 15) { sw += d; sx += d * x; sy += d * y; cntAll++; }
        if (x >= x0 && x < x1 && y >= y0 && y < y1) { n++; sum += d; for (var k = 0; k < thrs.length; k++) if (d > thrs[k]) cnt[k]++; }
      }
      var out = {n: n, mean: +(sum / Math.max(1, n)).toFixed(2), centroid: sw > 0 ? [+(sx / sw / W).toFixed(3), +(sy / sw / H).toFixed(3)] : null, changedFrame: +(cntAll / (W * H)).toFixed(4)};
      thrs.forEach(function (t, k) { out['over' + t] = +(cnt[k] / Math.max(1, n)).toFixed(4); });
      return out;
    }

    window.VangoghSet = set;
    window.VangoghWake = wake;
    if (window._vangoghFx) set(window._vangoghFx);
    kit.wantDepth(true);
    simStep(STEP_S, true); render(false);
    var startupMs = Math.round(performance.now() - t0create);

    return {frame: frame, touch: touch, resize: resize, destroy: destroy};
  }
})();
