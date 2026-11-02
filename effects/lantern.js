/* Lantern — your body is the only light in a dark forest (2026-10-05; fx-research concept #8, built by Claude (fx-batch)).
 *
 * The wall is a night forest: tall trunks with deep bark, ferns, leaf litter, shelf fungi and clusters of mushrooms, almost
 * invisible in the dark. Step in front of it and your outline glows like a paper lantern: warm light spills from your edges
 * across the wall, falls off with distance and throws long soft shadows of the trunks and branches away from you. The bark
 * catches the light on the side that faces you. Mushrooms and moss your light touches drink it in and keep glowing teal for
 * a while after you leave, so the forest remembers where you walked. Fireflies drift over to you, circle you, and when you
 * stand still they fall into blinking together. Two people's light adds up where it overlaps, and only there, in light
 * from two sides, dew-covered spider webs strung between the trunks glisten (a hidden layer). Touch the wall to hang a small
 * paper lantern that burns for a minute; it lights and shadows the forest too.
 * The empty wall: faint moonlight on the trunks' edges, softly breathing mushrooms, a few fireflies drifting and blinking.
 * Nothing is projected inside a person (DARK_INSIDE): the light lands on the wall around you.
 *
 * How (cheap on the GPU; the live wall shares it):
 *  - Once at start (and on a resize) one pass bakes the forest into textures: albedo, relief normals, glow material,
 *    moonlight, webs (full resolution), plus a signed distance field of the trunks and branches (quarter resolution).
 *  - Per depth frame: the people (the stage's labelled blobs only, never noise specks) go into a window-space mask at a
 *    quarter of the picture's resolution, and a jump flood (8 passes) finds, for every pixel, the nearest outline point and
 *    the nearest one belonging to a different person. Each person also gets three light points (the middle of the upper
 *    body and the farthest reach on either side: a raised hand, the head), smoothed between depth frames.
 *  - Per animation frame, one light pass at quarter resolution: the nearest person's light and the next nearest person's
 *    each fall off with the distance to their outline (so two people's light adds up), times a soft shadow: a short
 *    sphere-traced march (area-light penumbra) from the pixel toward each nearby light point through the trunk field,
 *    weighted by closeness. The trunk a pixel lies on, and a trunk a light point stands in front of, never shadow it.
 *    Light from more than one source (two people, or a person and a hung lantern) is what reveals the webs. Touch lanterns
 *    are point lights with their own march. Fireflies add small unshadowed pools. The same pass charges the glow material
 *    (afterglow, ping-pong).
 *  - One full-resolution display pass shades the baked forest with that light (relief from the light's direction), adds
 *    the afterglow, the lantern rim and haze at the outline, the hung lanterns, the moon, drifting mist; the lit forest is
 *    capped below the lights themselves (the rim is always the brightest thing). Fireflies are tiny additive points.
 *  Radiance cascades (the research's suggestion) were not used: many more passes and ringing at cascade borders, while a
 *  quarter-res soft-shadow march gives the long soft shadows this piece needs at a fraction of the cost (~0.6-0.8 ms GPU).
 * Body: plugins/body.js (WallBody), unmodified. Computed here beyond the stage: a people-only mask (labelled blobs grown two
 * cells), a held copy that survives depth stalls up to STALE_HOLD_S, person tracks keyed by position (stillness hysteresis,
 * arrival flare, ghost dimming), and a people-only distance grid for the fireflies.
 * WebGL 2 + EXT_color_buffer_float, no assets, no audio, one depth client (via the host).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  // (px = pixels on a 1280-wide picture)
  var LIGHT = 1.0;           // brightness of a person's light
  var LIGHT_R = 110;         // px: how far from your outline the light has dropped to half
  var LIGHT_REACH = 480;     // px: beyond this distance from your outline your light is gone
  var SHADOWS = 1.0;         // how dark the trunks' shadows are (0 = no shadows)
  var SOFTNESS = 90;         // px: size of the light for shadows (bigger = softer, wider shadow edges)
  var RELIEF = 0.85;         // how strongly the bark's relief catches the light from your side (0 = flat)
  var RIM = 1.3;             // the paper-lantern glow right at your outline
  var HAZE = 0.25;           // the soft warm haze in the air around you
  var FOG = 1.0;             // drifting mist that your light shows up (and the trunks' shadows cut through)
  var WEBS = 1.0;            // hidden layer: spider webs that glisten only where two lights cross (0 = off)
  var GLOW = 1.0;            // afterglow of mushrooms, shelf fungi and moss your light charged
  var GLOW_S = 9;            // seconds for that afterglow to fade (time constant)
  var CHARGE_S = 0.8;        // seconds of your light to charge them fully
  var IDLE_GLOW = 0.22;      // their faint breathing glow when nobody has been near
  var MOON = 1.0;            // the faint moonlight on the empty forest
  var FIREFLIES = 40;        // fireflies in the forest
  var FF_IDLE = 7;           // ...of which this many drift and blink when nobody is there
  var FF_LIGHT = 1.0;        // how much a firefly lights the forest around it
  var FF_SYNC = 2.2;         // how strongly fireflies around a still person fall into blinking together
  var FF_REACH = 300;        // px: fireflies this close to someone come over
  var LAMP_S = 60;           // seconds a hung lantern (a fingertip on the wall) burns
  var LAMP_LIGHT = 1.0;      // a hung lantern's brightness (a person's light is 1)
  var MAX_LAMPS = 6;         // at most this many hung lanterns (the oldest goes out)
  var ARRIVE_FLARE = 0.6;    // someone stepping in flares this much brighter for a moment
  var MOVE_HI = 0.12;        // a person moving more than this counts as moving...
  var MOVE_LO = 0.06;        // ...and only below this does stillness build up (hysteresis for real Kinect wobble)
  var GHOST_S = 40;          // after this many seconds perfectly still (a chair?) the light burns low...
  var GHOST_DIM = 0.35;      // ...to this share; any movement rekindles it
  var ACT_HI = 0.3;          // hands or head moving faster than this (wall widths per second) count as moving too (an arm wave)...
  var ACT_LO = 0.15;         // ...and stillness only builds below this
  var PARK_DRIFT = 0.012;    // a flickering object whose middle stays within this (share of the Kinect image, ~1.5 cells) counts as still too
  var CROWD = 1.0;           // how much a crowd dims everyone's light a little (0 = never)
  var STALE_HOLD_S = 0.7;    // the Kinect may stall this long without anything being forgotten
  var SEED = 0;              // 0 = a new forest every time the piece starts; any other number = always that forest
  var DARK_INSIDE = 1.0;     // no light inside a person (1 = none, 0 = off)

  registerWallPlugin({id: 'lantern', title: 'Lantern', author: 'Claude (fx-batch), fx-research concept #8', create: create});

  var MAXQ = 12, MAXT = 10, MAXB = 22, MAXS = 24, MAXM = 48, MAXF = 12, MAXW = 4, MAXH = 18, MAXP = 8, MAXFF = 64;
  var JFA_STEPS = [64, 32, 16, 8, 4, 2, 1, 1];

  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var NOISE = 'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}\n' +
    'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}\n' +
    'float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vnoise(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s;}\n';
  var BODY_K = 'vec2 kin(vec2 w, out float inK){vec3 hh=uHinv*vec3(w,1.);vec2 k=hh.xy/max(hh.z,1e-6);' +
    'inK=(hh.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;return clamp(k,0.,1.);}\n';

  // ---- the forest, baked once. Mode 0: albedo + glow material / normal + moon + webs (full res). Mode 1: trunk SDF (ref px).
  var BAKE_FS = '#version 300 es\nprecision highp float;\n' + NOISE +
    'uniform vec2 uRes, uRef; uniform float uSeed; uniform int uMode;\n' +
    'uniform int uNT; uniform vec4 uT[' + MAXT + ']; uniform vec4 uT2[' + MAXT + '];\n' +
    'uniform int uNB; uniform vec4 uB[' + MAXB + ']; uniform vec4 uB2[' + MAXB + '];\n' +
    'uniform int uNS; uniform vec4 uS[' + MAXS + ']; uniform int uNM; uniform vec4 uM[' + MAXM + '];\n' +
    'uniform int uNF; uniform vec4 uF[' + MAXF + ']; uniform int uNW; uniform vec4 uW[' + MAXW + ']; uniform int uNH; uniform vec4 uH[' + MAXH + '];\n' +
    'layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;\n' +
    'float groundY(float x){return uRef.y*.885+11.*sin(x/170.+uSeed)+6.*sin(x/61.+uSeed*2.3)+3.*sin(x/23.+uSeed*5.1);}\n' +
    'vec2 trunkAt(int i,float y){vec4 a=uT[i],b=uT2[i];float gy=groundY(a.x);\n' +
    '  float cx=a.x+a.z*(gy-y)+a.w*(sin(y/230.+b.x)-sin(gy/230.+b.x));\n' +
    '  float w=a.y*(.7+.3*clamp(y/gy,0.,1.));\n' +
    '  float up=max(gy-y,0.); w+=a.y*(.75*exp(-up/14.)+.22*exp(-up/45.));\n' +   // root flare
    '  return vec2(cx,w);}\n' +
    'float capsule(vec2 p,vec2 a,vec2 b,float ra,float rb,out float t){vec2 pa=p-a,ba=b-a;t=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*t)-mix(ra,rb,t);}\n' +
    'vec2 occ(vec2 p){vec2 d=vec2(1e4,-1.);\n' +   // signed distance to the nearest trunk or branch, and which trunk it is
    '  for(int i=0;i<' + MAXT + ';i++){if(i>=uNT)break; float gy=groundY(uT[i].x); vec2 cw=trunkAt(i,p.y); float e=max((abs(p.x-cw.x)-cw.y)*.9,p.y-(gy+2.)); if(e<d.x)d=vec2(e,float(i));}\n' +
    '  for(int i=0;i<' + MAXB + ';i++){if(i>=uNB)break; float t; float e=capsule(p,uB[i].xy,uB[i].zw,uB2[i].x,uB2[i].y,t); if(e<d.x)d=vec2(e,uB2[i].z);}\n' +
    '  return d;}\n' +
    // bark at a point across a trunk or branch: u = -1..1 across, along = distance along it, sd = per-trunk seed, z = depth
    'void bark(float u,float across,float along,float sd,float z,float tone,float mossy,inout vec3 alb,inout float h,inout float glow){\n' +
    '  float cyl=sqrt(max(0.,1.-u*u));\n' +
    '  float r1=vnoise(vec2(across/3.2+sd,along/64.)), r2=vnoise(vec2(across/1.6+sd*2.,along/19.));\n' +
    '  float ridge=r1*.65+r2*.35, plates=smoothstep(.32,.78,ridge);\n' +
    '  float crack=smoothstep(.06,.0,abs(r1-.5))*.8;\n' +
    '  h=cyl*9.+plates*3.2-crack*2.;\n' +
    '  vec3 c=mix(vec3(.20,.16,.12),vec3(.34,.30,.25),tone)*(.55+.6*plates)*(1.-crack*.5);\n' +
    '  float lich=smoothstep(.80,.9,vnoise(vec2(across/7.+sd*3.,along/11.)))*.35;\n' +
    '  c=mix(c,vec3(.42,.46,.38),lich);\n' +
    '  float moss=smoothstep(.52,.70,fbm(vec2(across/12.+sd,along/34.))+mossy*.35-.28+.18*u);\n' +
    '  c=mix(c,vec3(.17,.30,.10)*(.7+.6*vnoise(vec2(across,along)/2.5)),moss*.9);\n' +
    '  glow=max(glow,moss*.3*mossy);\n' +
    '  c=mix(c,vec3(.06,.075,.10),z*.55);\n' +
    '  alb=c;}\n' +
    'void scene(vec2 p,bool full,out vec3 alb,out float h,out float glow,out float isT,out float web){\n' +
    '  float Y=p.y/uRef.y; h=0.; glow=0.; isT=0.; web=0.;\n' +
    '  float mist=smoothstep(.35,.86,Y)*(.55+.45*fbm(p/vec2(210.,46.)+vec2(uSeed,0.)));\n' +   // the deep forest behind: dark, a band of ground mist
    '  alb=vec3(.035,.045,.06)+vec3(.10,.12,.14)*mist;\n' +
    '  for(int dk=-1;dk<=1;dk++){ float k=floor(p.x/58.)+float(dk); float hs=hash(vec2(k,uSeed));\n' +   // far trunks: silhouettes against the mist
    '    float xs=(k+.2+.6*hs)*58.+(p.y-uRef.y)*(hash(vec2(k,uSeed+5.))-.5)*.05; float ws=2.5+7.*hash(vec2(k,uSeed+3.));\n' +
    '    float u=(p.x-xs)/ws; if(abs(u)<1.&&hs>.2){ float cyl=sqrt(1.-u*u); float fade=hash(vec2(k,uSeed+8.));\n' +
    '      alb=mix(vec3(.025,.03,.035)*(.6+.4*cyl),alb,.25+.45*fade); h=cyl*2.; } }\n' +
    '  float gy=groundY(p.x);\n' +                                                            // the forest floor: soil, fallen leaves, twigs
    '  if(p.y>gy-3.){ float k2=smoothstep(gy-3.,gy+3.,p.y); float dep=clamp((p.y-gy)/max(1.,uRef.y-gy),0.,1.);\n' +
    '    vec2 fp=vec2(p.x,(p.y-gy)*(1.6-.8*dep)); vec3 soil=vec3(.075,.055,.04)*(.7+.6*vnoise(fp/5.)); float fh=vnoise(fp/4.)*1.5;\n' +
    '    vec2 q=fp/vec2(15.,15.); vec2 ci=floor(q); float top=-1.; vec3 lc=soil; float lh=fh;\n' +
    '    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){ vec2 g=ci+vec2(i,j); float r1=hash(g+.17),r2=hash(g+3.9),r3=hash(g+7.1),r4=hash(g+11.3);\n' +
    '      if(r4<.18)continue; vec2 c=(g+vec2(r1,r2))*15.; float a=r3*6.2832; vec2 d=fp-c; d=vec2(cos(a)*d.x+sin(a)*d.y,-sin(a)*d.x+cos(a)*d.y);\n' +
    '      float L=7.+7.*r1, wl=L*(.32+.18*r2); float x=d.x/L; if(abs(x)>1.)continue; float half_=wl*(1.-x*x);\n' +
    '      if(abs(d.y)<half_&&r4>top){ top=r4; float rib=smoothstep(.9,.0,abs(d.y))*.25;\n' +
    '        lc=mix(vec3(.30,.15,.06),vec3(.50,.34,.13),r2)*(.55+.45*r3)*(.85+.3*(1.-abs(d.y)/half_))*(1.-rib); lc=mix(lc,vec3(.16,.20,.08),step(.86,r3));\n' +
    '        lh=2.+(1.-abs(d.y)/half_)*1.6+r4*2.; } }\n' +
    '    float tw=abs(fract((fp.x*.8+fp.y*.6)/37.+vnoise(fp/30.)*1.5)-.5)*37.; if(tw<.9&&vnoise(fp/19.+4.)>.62){ lc=vec3(.10,.07,.05); lh=5.; }\n' +
    '    alb=mix(alb,lc*(.75+.25*dep),k2); h=mix(h,lh,k2); }\n' +
    '  for(int i=0;i<' + MAXF + ';i++){ if(i>=uNF)break; vec4 f=uF[i]; vec2 b=f.xy; float L=f.z;\n' +   // ferns
    '    if(abs(p.x-b.x)>L*1.25||p.y>b.y+4.||p.y<b.y-L*1.1)continue;\n' +
    '    for(int k=0;k<7;k++){ float a=mix(-1.2,1.2,(float(k)+.5)/7.)+(hash(vec2(f.w,float(k)))-.5)*.3; float len=L*(.55+.45*(1.-abs(a)/1.3));\n' +
    '      vec2 dir=vec2(sin(a),-cos(a)), pr=vec2(cos(a),sin(a)); float t=dot(p-b,dir)/len; if(t<.03||t>1.)continue;\n' +
    '      float cv=.35*sign(a)*abs(a); vec2 q=b+dir*len*t+pr*len*cv*t*t; float off=dot(p-q,pr);\n' +
    '      float wl=len*.16*pow(sin(3.1416*min(t*1.08,1.)),.7); float lp=fract(t*15.+off/(len*.08)*.5);\n' +
    '      float shape=wl*(1.-pow(abs(lp*2.-1.),1.5)*.85);\n' +
    '      if(abs(off)<shape){ alb=vec3(.10,.20,.07)*(.7+.7*t)*(.75+.35*(1.-abs(lp*2.-1.))); h=2.+(1.-abs(off)/max(shape,.1))*2.; isT=0.; }\n' +
    '      if(abs(off)<.7&&t<.95){ alb=vec3(.12,.17,.06); } } }\n' +
    '  for(int i=0;i<' + MAXT + ';i++){ if(i>=uNT)break; vec4 a=uT[i], b2=uT2[i]; float gy2=groundY(a.x);\n' +   // near trunks, far ones first
    '    if(p.y<=gy2+5.){ vec2 cw=trunkAt(i,p.y); float u=(p.x-cw.x)/cw.y;\n' +
    '      if(abs(u)<=1.){ float ga=0.; bark(u,p.x-cw.x,p.y,b2.z*91.7,b2.y,fract(b2.z*7.3),b2.w,alb,h,ga); glow=ga; isT=1.;\n' +
    '        float base=smoothstep(gy2-14.,gy2+4.,p.y); alb*=1.-base*.5; } }\n' +
    '    for(int j=0;j<' + MAXB + ';j++){ if(j>=uNB)break; if(int(uB2[j].z+.5)!=i)continue;\n' +   // ...each with its branches
    '      float t; float d=capsule(p,uB[j].xy,uB[j].zw,uB2[j].x,uB2[j].y,t); if(d>0.)continue;\n' +
    '      float r=mix(uB2[j].x,uB2[j].y,t); vec2 ab=normalize(uB[j].zw-uB[j].xy); float across=dot(p-uB[j].xy,vec2(-ab.y,ab.x));\n' +
    '      float ga=0.; bark(clamp(across/max(r,.5),-1.,1.),across,t*length(uB[j].zw-uB[j].xy)*2.,uB2[j].w*13.,b2.y,.5,.3,alb,h,ga); glow=max(glow,ga); isT=1.; } }\n' +
    '  for(int i=0;i<' + MAXS + ';i++){ if(i>=uNS)break; vec4 s=uS[i]; vec2 q=(p-s.xy)/vec2(s.z*1.3,s.z*.5); float rr=dot(q,q);\n' +   // shelf fungi
    '    if(rr<1.&&q.y<.45&&s.w*q.x>-.3){ float r=sqrt(rr); float bands=.82+.18*sin(r*26.+s.x); float edge=smoothstep(.72,.95,r);\n' +
    '      alb=mix(vec3(.46,.40,.30),vec3(.80,.86,.72),edge)*bands*(.8+.2*(1.-q.y)); if(q.y>.25) alb*=.55; h=6.+sqrt(1.-rr)*5.; glow=.35+.6*edge; isT=1.; } }\n' +
    '  for(int i=0;i<' + MAXH + ';i++){ if(i>=uNH)break; vec4 s=uH[i]; float dy=p.y-s.y; if(dy<0.||dy>s.z)continue;\n' +   // hanging moss: thin grey-green beards
    '    for(int q=0;q<3;q++){ float fq=float(q); float len=s.z*(.55+.45*hash(vec2(s.w,fq))); if(dy>len)continue; float k=dy/len;\n' +
    '      float xc=s.x+(fq-1.)*3.5*(1.+k)+3.*k*sin(dy/21.+s.w*6.+fq*2.)+1.2*sin(dy/6.+fq); float wd=(.55+.9*vnoise(vec2(s.w*9.+fq*4.,dy/5.)))*(1.-k*.5);\n' +
    '      if(abs(p.x-xc)<wd){ alb=vec3(.23,.26,.19)*(.75+.4*vnoise(vec2(p.x,p.y)/1.7)); h=6.+fq; glow=max(glow,.12); } } }\n' +
    '  for(int i=0;i<' + MAXM + ';i++){ if(i>=uNM)break; vec4 m=uM[i]; float r=m.z; vec2 b=m.xy;\n' +   // mushrooms
    '    if(abs(p.x-b.x)>r*1.6||p.y>b.y+2.||p.y<b.y-r*3.5)continue;\n' +
    '    float hs=r*(1.3+1.1*fract(m.w*7.)); float lean=(fract(m.w*3.)-.5)*r*.8; float k=clamp((b.y-p.y)/hs,0.,1.);\n' +
    '    float sx=b.x+lean*k*k, sw=r*(.16+.05*(1.-k));\n' +
    '    if(abs(p.x-sx)<sw&&p.y<b.y+1.&&p.y>b.y-hs){ alb=vec3(.55,.62,.55)*(.8+.3*(1.-k)); h=5.; glow=.55; isT=0.; }\n' +
    '    vec2 cc=vec2(b.x+lean,b.y-hs); vec2 q=(p-cc)/vec2(r,r*(.55+.25*fract(m.w*11.)));\n' +
    '    if(dot(q,q)<1.&&q.y<.22){ float under=smoothstep(.0,.22,q.y); float spot=step(.8,vnoise(q*4.+m.w*20.));\n' +
    '      alb=mix(vec3(.45,.86,.80)*(.8+.3*(-q.y)),vec3(.24,.42,.40)*(.8+.2*sin(q.x*40.)),under); alb=mix(alb,vec3(.8,.95,.9),spot*(1.-under)*.6);\n' +
    '      h=7.+sqrt(max(0.,1.-dot(q,q)))*r*.5; glow=1.-under*.4; isT=0.; } }\n' +
    '  if(full){ for(int i=0;i<' + MAXW + ';i++){ if(i>=uNW)break; vec4 w=uW[i]; vec2 d=p-w.xy; float rr=length(d); if(rr>w.z)continue;\n' +   // webs (the hidden layer)
    '    float th=atan(d.y,d.x), n=11., sec=6.2832/n; float ang=th+w.w*3.; float ki=floor(ang/sec+.5); float ra=ang-ki*sec+(hash(vec2(ki,w.w))-.5)*.25;\n' +
    '    float radial=abs(rr*sin(ra)); float wob=1.+.06*sin(ki*2.7+w.w);\n' +
    '    float sp=(rr*cos(ra)/(w.z*wob)-.12)/.075; float ring=abs(fract(sp+(ra/sec)*.5)-.5)*.075*w.z;\n' +   // a spiral (each turn steps out a little per sector)
    '    float lines=max(smoothstep(.9,.2,radial)*step(rr,w.z*wob),smoothstep(.8,.15,ring)*step(.12,rr/w.z)*step(rr,w.z*.92*wob));\n' +
    '    float dew=step(.86,hash(floor(p/2.3)+w.w))*lines; web=max(web,lines*.55+dew*.45)*smoothstep(w.z,w.z*.8,rr); } }\n' +
    '}\n' +
    'void main(){\n' +
    '  vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uRes*uRef;\n' +
    '  if(uMode==1){ o0=vec4(occ(p),0.,1.); o1=vec4(0.); return; }\n' +
    '  float e=uRef.x/uRes.x; vec3 alb,a2; float h,glow,isT,web,hx,hy,g2,t2,w2;\n' +
    '  scene(p,true,alb,h,glow,isT,web); scene(p+vec2(e,0.),false,a2,hx,g2,t2,w2); scene(p+vec2(0.,e),false,a2,hy,g2,t2,w2);\n' +
    '  vec3 N=normalize(vec3(-(hx-h)/e,-(hy-h)/e,1.));\n' +
    '  vec3 md=normalize(vec3(-.62,-.45,.55)); float rim=pow(max(0.,dot(N,md)),3.)*1.5*isT;\n' +   // the moon, high on the left
    '  float gy=groundY(p.x), Y=p.y/uRef.y, onFloor=smoothstep(gy-2.,gy+6.,p.y);\n' +
    '  float pool=smoothstep(.5,.78,fbm(p/150.+uSeed*3.))*.55*(.6+.4*max(0.,dot(N,normalize(vec3(-.4,-.3,.85)))));\n' +
    '  float shaft=smoothstep(.6,.92,vnoise(vec2((p.x+p.y*.55)/42.,uSeed)))*smoothstep(.95,.15,Y)*.22;\n' +
    '  float moon=clamp(isT>.5?rim+.05:mix(.2+shaft,pool+.04,onFloor),0.,1.);\n' +
    '  o0=vec4(alb,glow); o1=vec4(N.xy*.5+.5,moon,web); }\n';

  // ---- jump flood: seeds = the people-only mask in window space (light-map resolution)
  var SEED_FS = '#version 300 es\nprecision highp float;\nuniform sampler2D uBody; uniform mat3 uHinv; uniform vec2 uLRes;\n' +
    'layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;\n' + BODY_K +
    'void main(){ vec2 lp=gl_FragCoord.xy; float inK; vec2 k=kin(vec2(lp.x/uLRes.x,1.-lp.y/uLRes.y),inK);\n' +
    '  float g=texture(uBody,k).g*inK; ivec2 bs=textureSize(uBody,0); float lab=texelFetch(uBody,min(ivec2(k*vec2(bs)),bs-1),0).b*255.-1.;\n' +
    '  oA=(g>.5&&lab>=0.)?vec4(floor(lp),lab,1.):vec4(-1.,-1.,-1.,1.); oB=vec4(-1.,-1.,-1.,1.); }\n';
  // jump flood keeping, per pixel, the nearest outline point and the nearest one belonging to a different person
  var JUMP_FS = '#version 300 es\nprecision highp float;\nuniform sampler2D uSrcA, uSrcB; uniform float uStep; uniform vec2 uLRes;\n' +
    'layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;\n' +
    'void main(){ vec2 lp=floor(gl_FragCoord.xy); vec3 b1=vec3(-1.), b2=vec3(-1.); float d1=1e12, d2=1e12; ivec2 mx=ivec2(uLRes)-1;\n' +
    '  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){ ivec2 q=ivec2(lp+vec2(i,j)*uStep); if(q.x<0||q.y<0||q.x>mx.x||q.y>mx.y)continue;\n' +
    '    for(int c=0;c<2;c++){ vec3 s=c==0?texelFetch(uSrcA,q,0).xyz:texelFetch(uSrcB,q,0).xyz; if(s.x<0.)continue; vec2 d=s.xy-lp; float dd=dot(d,d);\n' +
    '      if(dd<d1){ if(s.z!=b1.z&&b1.x>=0.){ b2=b1; d2=d1; } b1=s; d1=dd; }\n' +
    '      else if(s.z!=b1.z&&dd<d2){ b2=s; d2=dd; } } }\n' +
    '  if(b2.x>=0.&&b2.z==b1.z){ b2=vec3(-1.); }\n' +
    '  oA=vec4(b1,1.); oB=vec4(b2,1.); }\n';

  // ---- the light (quarter resolution): out0 = warm light, firefly light, overlap of two sources, -; out1 = light direction
  //      (intensity-weighted, ref px, y down), nearest person's brightness, distance to the nearest outline (ref px); out2 = charge
  var LIGHT_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uJfa, uJfb, uOcc, uBody, uCharge; uniform mat3 uHinv; uniform vec2 uLRes, uRef; uniform float uE[8];\n' +
    'uniform float uReach, uR, uSoft, uShadow, uLight, uDt, uFade, uChargeK, uLampR, uLampSoft, uFFR, uFF, uSeed;\n' +
    'uniform int uNQ; uniform vec4 uQ[' + MAXQ + ']; uniform int uNL; uniform vec4 uL[6]; uniform int uNF; uniform vec4 uF[' + MAXFF + '];\n' +
    'layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;\n' + BODY_K +
    'vec2 occ(vec2 p){ return texture(uOcc,vec2(p.x/uRef.x,1.-p.y/uRef.y)).rg; }\n' +
    'float groundY(float x){return uRef.y*.885+11.*sin(x/170.+uSeed)+6.*sin(x/61.+uSeed*2.3)+3.*sin(x/23.+uSeed*5.1);}\n' +
    // soft shadow from a light at s seen from p: march from p toward s through the trunk field (an area light of radius sz).
    // The trunk p lies on and the trunk the light stands in front of are skipped (in the picture they are behind the light / lit by it).
    'float shadow(vec2 p,vec2 s,float sz){ if(p.y>groundY(p.x)+2.)return 1.; vec2 dv=s-p; float D=length(dv); if(D<2.)return 1.; vec2 dir=dv/D;\n' +
    '  vec2 op=occ(p), os=occ(s); float idP=op.x<1.?op.y:-9., idS=os.x<1.?os.y:-9.;\n' +
    '  float t=1.5, res=1., tEnd=D-3.;\n' +
    '  for(int i=0;i<26;i++){ if(t>=tEnd)break; vec2 o=occ(p+dir*t); float h=o.x;\n' +
    '    if(abs(o.y-idP)<.5||abs(o.y-idS)<.5){ t+=max(-h,8.); continue; }\n' +
    '    res=min(res,h/(sz*t/D+8.)); if(res<-1.)break; t+=clamp(h*.85,2.5,90.); }\n' +
    '  res=clamp(.5+.5*res,0.,1.); return res*res*(3.-2.*res); }\n' +
    'float fall(float d){ return 1./(1.+(d/uR)*(d/uR))*(1.-smoothstep(uReach*.5,uReach,d)); }\n' +
    'void main(){ vec2 lp=gl_FragCoord.xy; vec2 p=vec2(lp.x/uLRes.x,1.-lp.y/uLRes.y)*uRef; vec2 cell=uRef/uLRes;\n' +
    '  vec4 jA=texelFetch(uJfa,ivec2(lp),0), jB=texelFetch(uJfb,ivec2(lp),0); float Ib=0., I2=0., dOut=1e4, eN=0.; vec2 ds=vec2(0.);\n' +
    '  if(jA.x>=0.){ vec2 s=vec2(jA.x+.5,uLRes.y-jA.y-.5)*cell; float d=length(s-p); dOut=d; float e=uE[int(clamp(jA.z,0.,7.))]; eN=e;\n' +
    '    float f=fall(d), f2=0., e2=0.;\n' +                       // the nearest person's light, and the next nearest person's: they add up
    '    if(jB.x>=0.){ vec2 s2=vec2(jB.x+.5,uLRes.y-jB.y-.5)*cell; e2=uE[int(clamp(jB.z,0.,7.))]; f2=fall(length(s2-p)); }\n' +
    '    float sh1=1., sh2=1.; vec2 dl=d>.5?(s-p)/d:vec2(0.);\n' +
    '    if(f*e+f2*e2>.004){ float ws1=0., vs1=0., ws2=0., vs2=0.; vec2 dq=vec2(0.);\n' +   // shadows, per person: how much of their light points is hidden from here
    '      for(int i=0;i<' + MAXQ + ';i++){ if(i>=uNQ)break; bool g1=abs(uQ[i].w-jA.z)<.5, g2=jB.x>=0.&&abs(uQ[i].w-jB.z)<.5; if(!g1&&!g2)continue;\n' +
    '        vec2 c=uQ[i].xy; float dd=length(c-p); float w=uQ[i].z/(1.+(dd/uR)*(dd/uR)); if(w<.004)continue;\n' +
    '        float v=uShadow>0.?shadow(p,c,uSoft):1.; if(g1){ ws1+=w; vs1+=w*v; } else { ws2+=w; vs2+=w*v; } dq+=(c-p)/max(dd,1.)*w*v; }\n' +
    '      float nf=uShadow*smoothstep(16.,70.,d); if(ws1>0.) sh1=mix(1.,vs1/ws1,nf); if(ws2>0.) sh2=mix(1.,vs2/ws2,uShadow);\n' +
    '      if(length(dq)>1e-6) dl=normalize(mix(normalize(dq),dl,exp(-d/50.))+1e-6); }\n' +
    '    Ib=uLight*e*f*sh1; I2=uLight*e2*f2*sh2; ds+=dl*(Ib+I2); }\n' +
    '  float Il=0., lm=0.;\n' +                                      // hung lanterns: small point lights with their own shadows
    '  for(int i=0;i<6;i++){ if(i>=uNL)break; vec2 c=uL[i].xy; float dd=length(c-p);\n' +
    '    float f=uL[i].z/(1.+(dd/uLampR)*(dd/uLampR))*(1.-smoothstep(uLampR*2.2,uLampR*4.,dd));\n' +
    '    if(f>.003) f*=mix(1.,shadow(p,c,uLampSoft),uShadow); Il+=f; lm=max(lm,f); ds+=(c-p)/max(dd,1.)*f; }\n' +
    '  float If=0.;\n' +                                             // fireflies: tiny unshadowed pools of green light
    '  for(int i=0;i<' + MAXFF + ';i++){ if(i>=uNF)break; vec2 c=uF[i].xy; vec2 q=(c-p)/uFFR; If+=uF[i].z*exp(-dot(q,q)); }\n' +
    '  If*=uFF;\n' +
    '  float tot=Ib+I2+Il; float ov=max(0.,tot-max(max(Ib,I2),lm));\n' +      // light from more than one source: where two lights cross
    '  float C=texelFetch(uCharge,ivec2(lp),0).r;\n' +
    '  C=C*uFade+(1.-C)*(1.-exp(-uDt*uChargeK*(tot*1.6+If*.8)));\n' +
    '  o0=vec4(tot,If,ov,0.); o1=vec4(ds,eN*.5,dOut); o2=vec4(C,0.,0.,1.); }\n';

  var AMB_BARK = '0.14', AMB_FOG = '0.12';   // how strong the \'Empty wall\' ambient is (bark relief, mist) per unit of wall above 1
  var DISP_FS = '#version 300 es\nprecision highp float;\n' + NOISE +
    'uniform sampler2D uA, uN, uL0, uL1, uC, uBody; uniform mat3 uHinv; uniform vec2 uRef;\n' +
    'uniform float uTime, uDark, uRelief, uMoon, uGlow, uIdle, uWeb, uRim, uHaze, uExpo, uFog, uWallK; uniform int uView;\n' +
    'uniform int uNL; uniform vec4 uL[6]; in vec2 vUv; out vec4 o;\n' + BODY_K +
    'void main(){ vec2 w=vec2(vUv.x,1.-vUv.y); vec2 p=w*uRef;\n' +
    '  vec4 A=texture(uA,vUv), Nn=texture(uN,vUv), L0=texture(uL0,vUv), L1=texture(uL1,vUv); float C=texture(uC,vUv).r;\n' +
    '  float inK; vec2 k=kin(w,inK); float m=texture(uBody,k).r*inK;\n' +
    '  vec2 nx=Nn.xy*2.-1.; vec3 N=vec3(nx,sqrt(max(0.,1.-dot(nx,nx))));\n' +
    '  float dl=length(L1.xy); vec2 dir=dl>1e-5?L1.xy/dl:vec2(0.); vec3 Ld=normalize(vec3(dir,.55));\n' +
    '  float lam=clamp(dot(N,Ld)/Ld.z,0.,2.2); float shade=mix(1.,lam,uRelief);\n' +
    '  float Iw=L0.r*uExpo, If=L0.g, ov=L0.b, e=L1.z*2., d=L1.w;\n' +
    '  vec3 warm=vec3(1.,.64,.32), ff=vec3(.62,1.,.34), moonC=vec3(.30,.44,.80), glowC=vec3(.20,1.,.80);\n' +
    '  float breath=.82+.18*sin(uTime*.21+fbm(p/300.)*4.);\n' +
    '  vec3 col=A.rgb*(warm*Iw*shade*2.5+ff*If*.8+moonC*Nn.b*uMoon*breath*1.7);\n' +
    '  float fogd=(.03+.13*smoothstep(.3,.8,fbm(p/vec2(170.,70.)+vec2(uTime*.025,uTime*.006))))*(.55+.6*smoothstep(.35,.95,w.y));\n' +
    '  col+=warm*Iw*fogd*uFog;\n' +                                     // mist in the air, lit (and shadowed) by your light
    '  float amb=max(uWallK-1.,0.);\n' +                                 // 'Empty wall' above 1: a faint moonlit ambient (bark relief + mist) so the empty forest reads; 0 at wall 1 = the 2026-10-05 picture
    '  vec3 La=normalize(vec3(-.45,.55,.55)); float lamA=clamp(dot(N,La)/La.z,0.,2.2);\n' +
    '  col+=moonC*(A.rgb*(.25+.75*lamA)*' + AMB_BARK + '+fogd*' + AMB_FOG + ')*amb;\n' +
    '  float pulse=.75+.25*sin(uTime*.6+vnoise(p/45.)*9.);\n' +
    '  col+=glowC*A.a*(uIdle*pulse*.3+C*uGlow*.62);\n' +                          // bioluminescence: idle breathing + afterglow
    '  float tw=.55+.45*sin(uTime*3.+hash(floor(p/2.3))*30.);\n' +
    '  col+=vec3(.80,.88,1.)*Nn.a*smoothstep(.012,.07,ov)*(.45+Iw*1.1)*tw*uWeb;\n' +   // webs: only where two lights cross
    '  float band=smoothstep(.16,.5,m)*(1.-smoothstep(.55,.8,m));\n' +       // the lantern rim follows the smooth body edge...
    '  vec3 src=warm*(uRim*(.6*band+.4*exp(-max(0.,d-2.)/7.))+uHaze*exp(-d/55.))*e*uExpo;\n' +   // ...and the haze in the air around you
    '  for(int i=0;i<6;i++){ if(i>=uNL)break; vec2 q=p-uL[i].xy; float le=uL[i].z;\n' +   // hung paper lanterns
    '    vec2 qe=q/vec2(8.,10.5); float r=length(qe); float bodyL=smoothstep(1.,.82,r)*(.78+.22*cos(q.y*1.25))*(1.-.35*smoothstep(.3,1.,abs(qe.x)));\n' +
    '    float thread=smoothstep(.9,.3,abs(q.x))*step(q.y,-10.)*smoothstep(-95.,-12.,q.y);\n' +
    '    src+=vec3(1.,.70,.36)*bodyL*le*2.2+warm*le*.30*exp(-length(q)/24.); col+=vec3(.45,.32,.2)*thread*.5*min(1.,le*3.); }\n' +
    '  vec3 wld=.78*(1.-exp(-col*1.7)), lit=1.-exp(-src*1.5);\n' +            // the lit forest never outshines the lights themselves
    '  col=(wld+(1.-wld)*lit)*(1.-uDark*smoothstep(.5,.75,m));\n' +           // nothing projected inside a person

    '  if(uView==1) col=vec3(1.-exp(-L0.r*2.));\n' +
    '  o=vec4(col,1.); }\n';

  // ---- fireflies: tiny additive points
  var FF_VS = '#version 300 es\nin vec4 aP; uniform vec2 uRes; uniform float uPx; out float vB; out vec2 vW;\n' +
    'void main(){ gl_Position=vec4(aP.x*2.-1.,1.-aP.y*2.,0.,1.); gl_PointSize=aP.z*uPx; vB=aP.w; vW=aP.xy; }\n';
  var FF_FS = '#version 300 es\nprecision highp float;\nuniform sampler2D uBody; uniform mat3 uHinv; uniform float uDark; in float vB; in vec2 vW; out vec4 o;\n' + BODY_K +
    'void main(){ vec2 c=gl_PointCoord*2.-1.; float r2=dot(c,c); if(r2>1.)discard;\n' +
    '  float inK; vec2 k=kin(vW,inK); float m=texture(uBody,k).r*inK;\n' +
    '  float hide=1.-uDark*smoothstep(.4,.7,m), a=vB*(exp(-r2*10.)*.8+exp(-r2*3.)*.25)*hide;\n' +
    '  o=vec4(vec3(.80,1.,.42)*a+vec3(.25,.25,.15)*exp(-r2*40.)*vB*hide,1.); }\n';

  function rng(seed) {                     // mulberry32
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // the forest's layout (ref px: 1280 wide, y down), drawn by the bake shader
  function makeForest(seed, refH) {
    var R = rng(seed), F = {seed: seed, refH: refH, trunks: [], branches: [], shelves: [], mush: [], ferns: [], webs: [], hang: []};
    var sd = R() * 6.28;
    F.sd = sd;
    function gY(x) { return refH * 0.885 + 11 * Math.sin(x / 170 + sd) + 6 * Math.sin(x / 61 + sd * 2.3) + 3 * Math.sin(x / 23 + sd * 5.1); }
    F.gY = gY;
    var n = 7 + (R() < 0.5 ? 1 : 0), slot = 1280 / n, bigA = Math.floor(R() * n), bigB = (bigA + 2 + Math.floor(R() * (n - 3))) % n, two = R() < 0.65;
    for (var i = 0; i < n; i++) {
      var big = i === bigA || (two && i === bigB);   // one or two old giants, never side by side
      var w = big ? 34 + R() * 16 : 11 + Math.pow(R(), 1.4) * 19;
      F.trunks.push({x: (i + 0.5 + (R() - 0.5) * 0.62) * slot, w: w, lean: (R() - 0.5) * 0.07, bend: (R() - 0.5) * 26, ph: R() * 6.28,
                     z: big ? R() * 0.15 : 0.15 + R() * 0.55, s: R(), moss: R()});
    }
    F.trunks.sort(function (a, b) { return b.z - a.z; });      // far ones first (nearer trunks are drawn over them)
    function at(t, y) {                                         // centre x and half width (the shader's trunkAt, without the flare)
      var gy = gY(t.x);
      return [t.x + t.lean * (gy - y) + t.bend * (Math.sin(y / 230 + t.ph) - Math.sin(gy / 230 + t.ph)), t.w * (0.7 + 0.3 * Math.max(0, Math.min(1, y / gy)))];
    }
    F.at = at;
    F.trunks.forEach(function (t, ti) {
      if (t.z < 0.62) {
        var nb = R() < 0.75 ? 1 + (R() < 0.4 ? 1 : 0) : 0;
        for (var k = 0; k < nb && F.branches.length < MAXB; k++) {
          var y = refH * (0.03 + R() * 0.32), c = at(t, y), side = R() < 0.5 ? -1 : 1, ang = (0.35 + R() * 0.55), len = 80 + R() * 170;
          var x0 = c[0] + side * c[1] * 0.55, x1 = x0 + side * Math.cos(ang) * len, y1 = y - Math.sin(ang) * len * 0.8;
          var r0 = Math.min(10, c[1] * 0.32);
          F.branches.push({a: [x0, y], b: [x1, y1], r0: r0, r1: 1.3, owner: ti, s: R()});
          if (F.branches.length < MAXB) { var tt0 = 0.45 + R() * 0.3, tx = x0 + (x1 - x0) * tt0, ty = y + (y1 - y) * tt0, ta = ang + 0.5 + R() * 0.5, tl = len * (0.3 + R() * 0.25);
            F.branches.push({a: [tx, ty], b: [tx + side * Math.cos(ta) * tl, ty - Math.sin(ta) * tl], r0: r0 * (1 - tt0) * 0.8 + 1, r1: 0.9, owner: ti, s: R()}); }
          var nh = 1 + Math.floor(R() * 3);
          for (var h = 0; h < nh && F.hang.length < MAXH; h++) { var tt = 0.3 + R() * 0.65; F.hang.push({x: x0 + (x1 - x0) * tt, y: y + (y1 - y) * tt, len: 40 + R() * 120, s: R()}); }
        }
      }
      var ns = Math.floor(R() * 3.2);
      for (var s = 0; s < ns && F.shelves.length < MAXS; s++) {
        var ys = refH * (0.22 + R() * 0.6), cs = at(t, ys), sideS = R() < 0.5 ? -1 : 1, sz = 7 + R() * 8;
        for (var q = 0; q < 1 + Math.floor(R() * 2) && F.shelves.length < MAXS; q++)
          F.shelves.push({x: cs[0] + sideS * (cs[1] - 2), y: ys + q * sz * 1.1, r: sz * (1 - q * 0.3), side: sideS});
      }
    });
    function cluster(x, nm) {
      for (var k = 0; k < nm && F.mush.length < MAXM; k++) {
        var xm = x + (R() - 0.5) * 46, r = 4 + Math.pow(R(), 1.6) * 11;
        F.mush.push({x: xm, y: gY(xm) + 3 + R() * 6, r: r, s: R()});
      }
    }
    var bases = F.trunks.slice().sort(function () { return R() - 0.5; });
    for (var b = 0; b < Math.min(4, bases.length); b++) { var tb = bases[b]; cluster(tb.x + (R() < 0.5 ? -1 : 1) * (tb.w * 1.6 + 14), 3 + Math.floor(R() * 4)); }
    for (var c2 = 0; c2 < 3; c2++) cluster(60 + R() * 1160, 2 + Math.floor(R() * 4));
    var xs = F.trunks.map(function (t) { return t.x; }).sort(function (a, b) { return a - b; });
    for (var f = 0; f < 9 && F.ferns.length < MAXF; f++) {
      var xf = 40 + R() * 1200, ok = true;
      for (var k2 = 0; k2 < xs.length; k2++) if (Math.abs(xs[k2] - xf) < 30) ok = false;
      if (ok) F.ferns.push({x: xf, y: gY(xf) + 2, L: 45 + R() * 70, s: R() * 10});
    }
    var gaps = [];
    for (var g = 0; g < xs.length - 1; g++) { var gp = xs[g + 1] - xs[g]; if (gp > 150 && gp < 420) gaps.push([xs[g], xs[g + 1]]); }
    gaps.sort(function () { return R() - 0.5; });
    for (var wv = 0; wv < Math.min(MAXW - 1, gaps.length); wv++) {
      var gg = gaps[wv]; F.webs.push({x: (gg[0] + gg[1]) / 2 + (R() - 0.5) * 20, y: refH * (0.2 + R() * 0.42), r: Math.min((gg[1] - gg[0]) * 0.4, 120), s: R() * 10});
    }
    return F;
  }

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Lantern needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Lantern needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Lantern needs EXT_color_buffer_float');
    var wallK = 2.0;           // 'Empty wall' knob (1 = the 2026-10-05 picture): scales the moonlight and the idle mushroom breathing, and above 1 adds a faint ambient (bark relief + mist); a person's light, rim, haze, lamps, afterglow and fireflies are untouched
    var made = [], sized = [], destroyed = false;

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    function program(fsSrc, vsSrc) {
      var p = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, vsSrc || VS), fs = shader(gl.FRAGMENT_SHADER, fsSrc);
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
    function target(texs, list) {
      var f = gl.createFramebuffer(); list.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      var bufs = [];
      for (var i = 0; i < texs.length; i++) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texs[i], 0); bufs.push(gl.COLOR_ATTACHMENT0 + i); }
      gl.drawBuffers(bufs);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Lantern: framebuffer incomplete');
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    }

    var P = {bake: program(BAKE_FS), seed: program(SEED_FS), jump: program(JUMP_FS), light: program(LIGHT_FS), disp: program(DISP_FS), ff: program(FF_FS, FF_VS)};
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);
    var ffVao = gl.createVertexArray(); made.push(['VertexArray', ffVao]);
    var ffBuf = gl.createBuffer(); made.push(['Buffer', ffBuf]);
    var ffData = new Float32Array(MAXFF * 4);
    gl.bindVertexArray(ffVao); gl.bindBuffer(gl.ARRAY_BUFFER, ffBuf); gl.bufferData(gl.ARRAY_BUFFER, ffData.byteLength, gl.DYNAMIC_DRAW);
    var aP = gl.getAttribLocation(P.ff.p, 'aP'); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // ---- the body, folded into what this piece needs (Kinect cells, 128 x 106)
    var BW = WallBody.w, BH = WallBody.h, BN = BW * BH, body = WallBody.create(kit, {});
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var bodyTex = texture(BW, BH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, made), bodyBytes = new Uint8Array(BN * 4);
    var held = new Float32Array(BN), gate = new Int16Array(BN), gate2 = new Int16Array(BN), pdist = new Float32Array(BN);
    var lastFold = -1e9, folds = 0, fadeK = 1, haveBody = false, jfaDirty = true, frames = 0, realFrames = 0, elapsed = 0;
    var tracks = [], nextTrack = 1, cellPx = 10;

    // ---- everything sized by the canvas
    var W = 0, H = 0, LW = 0, LH = 0, refH = 800, pxS = 1, cur = 0, bakeMs = 0, forest = null, seedUsed = 0;
    var sceneA, sceneN, sceneFb, occTex, occFb, jfa = [null, null], jfb = [null, null], jfaFb = [null, null], jfaOut = 0, L0, L1, ch = [null, null], lightFb = [null, null];
    function alloc(w, h) {
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      W = w; H = h; pxS = w / 1280; refH = 1280 * h / Math.max(1, w);
      LW = Math.max(32, Math.min(320, Math.round(w / 4))); LH = Math.max(20, Math.round(LW * h / Math.max(1, w)));   // the light map stays 320 wide on a bigger canvas (same look, same cost)
      sceneA = texture(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, sized);
      sceneN = texture(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, sized);
      sceneFb = target([sceneA, sceneN], sized);
      occTex = texture(LW, LH, gl.RG16F, gl.RG, gl.HALF_FLOAT, gl.LINEAR, sized); occFb = target([occTex], sized);
      for (var k = 0; k < 2; k++) { jfa[k] = texture(LW, LH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST, sized); jfb[k] = texture(LW, LH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST, sized); jfaFb[k] = target([jfa[k], jfb[k]], sized); }
      L0 = texture(LW, LH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, sized);
      L1 = texture(LW, LH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, sized);
      for (k = 0; k < 2; k++) ch[k] = texture(LW, LH, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.LINEAR, sized);
      lightFb[0] = target([L0, L1, ch[1]], sized); lightFb[1] = target([L0, L1, ch[0]], sized);   // reads ch[cur], writes the other
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); cur = 0; jfaDirty = true;
      bake();
    }
    function bake() {
      var t0 = performance.now();
      if (!forest || Math.abs(forest.refH - refH) > 0.5) {
        seedUsed = SEED || ((Math.random() * 1e9) | 0);
        forest = makeForest(seedUsed, refH);
      }
      var F = forest, B = P.bake, u = B.u, k;
      gl.useProgram(B.p); gl.bindVertexArray(vao); gl.disable(gl.BLEND);
      var T = new Float32Array(MAXT * 4), T2 = new Float32Array(MAXT * 4);
      F.trunks.forEach(function (t, i) { T.set([t.x, t.w, t.lean, t.bend], i * 4); T2.set([t.ph, t.z, t.s, t.moss], i * 4); });
      var Bv = new Float32Array(MAXB * 4), B2 = new Float32Array(MAXB * 4);
      F.branches.forEach(function (b, i) { Bv.set([b.a[0], b.a[1], b.b[0], b.b[1]], i * 4); B2.set([b.r0, b.r1, b.owner, b.s], i * 4); });
      var S = new Float32Array(MAXS * 4); F.shelves.forEach(function (s, i) { S.set([s.x, s.y, s.r, s.side], i * 4); });
      var M = new Float32Array(MAXM * 4); F.mush.forEach(function (m, i) { M.set([m.x, m.y, m.r, m.s], i * 4); });
      var Fe = new Float32Array(MAXF * 4); F.ferns.forEach(function (f, i) { Fe.set([f.x, f.y, f.L, f.s], i * 4); });
      var Wb = new Float32Array(MAXW * 4); F.webs.forEach(function (w, i) { Wb.set([w.x, w.y, w.r, w.s], i * 4); });
      var Hg = new Float32Array(MAXH * 4); F.hang.forEach(function (h, i) { Hg.set([h.x, h.y, h.len, h.s], i * 4); });
      gl.uniform2f(u.uRef, 1280, refH); gl.uniform1f(u.uSeed, F.sd);
      gl.uniform1i(u.uNT, F.trunks.length); gl.uniform4fv(u.uT, T); gl.uniform4fv(u.uT2, T2);
      gl.uniform1i(u.uNB, F.branches.length); gl.uniform4fv(u.uB, Bv); gl.uniform4fv(u.uB2, B2);
      gl.uniform1i(u.uNS, F.shelves.length); gl.uniform4fv(u.uS, S); gl.uniform1i(u.uNM, F.mush.length); gl.uniform4fv(u.uM, M);
      gl.uniform1i(u.uNF, F.ferns.length); gl.uniform4fv(u.uF, Fe); gl.uniform1i(u.uNW, F.webs.length); gl.uniform4fv(u.uW, Wb);
      gl.uniform1i(u.uNH, F.hang.length); gl.uniform4fv(u.uH, Hg);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFb); gl.viewport(0, 0, W, H); gl.uniform2f(u.uRes, W, H); gl.uniform1i(u.uMode, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, occFb); gl.viewport(0, 0, LW, LH); gl.uniform2f(u.uRes, LW, LH); gl.uniform1i(u.uMode, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      bakeMs = performance.now() - t0;
    }

    // ---- registration helpers (CPU)
    function toKin(x, y) {                  // window 0..1 -> Kinect cell index (or -1)
      var m = body.hinv(), hz = m[2] * x + m[5] * y + m[8]; if (!(hz > 1e-6)) return -1;
      var u = (m[0] * x + m[3] * y + m[6]) / hz, v = (m[1] * x + m[4] * y + m[7]) / hz;
      if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) return -1;
      return Math.min(BH - 1, (v * BH) | 0) * BW + Math.min(BW - 1, (u * BW) | 0);
    }
    function distAt(x, y) { var i = toKin(x, y); return i < 0 ? 1e3 : pdist[i]; }   // cells to the nearest person (0 inside)
    function screenOf(u, v) { var s = kit.toScreen(u * 512, v * 424); return s && isFinite(s[0]) && isFinite(s[1]) ? s : null; }
    function measureCell() { var a = screenOf(0.5, 0.5), b = screenOf(0.5 + 4 / 512, 0.5); if (a && b) cellPx = Math.max(3, Math.hypot((b[0] - a[0]) * 1280, (b[1] - a[1]) * refH)); }

    // ---- per fresh depth frame: people-only mask (labelled blobs grown two cells), tracks, distance grid
    function dilateGate(src, dst) {
      for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) {
        var i = y * BW + x, v = src[i];
        if (v < 0) { for (var dy = -1; dy <= 1 && v < 0; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= BW || yy >= BH) continue; var w = src[yy * BW + xx]; if (w >= 0) { v = w; break; } } }
        dst[i] = v;
      }
    }
    function chamfer(d) {
      var x, y, i, R2 = 1.4142;
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; if (!d[i]) continue; var v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) { v = Math.min(v, d[i - BW] + 1); if (x > 0) v = Math.min(v, d[i - BW - 1] + R2); if (x < BW - 1) v = Math.min(v, d[i - BW + 1] + R2); }
        d[i] = v; }
      for (y = BH - 1; y >= 0; y--) for (x = BW - 1; x >= 0; x--) { i = y * BW + x; if (!d[i]) continue; var w = d[i];
        if (x < BW - 1) w = Math.min(w, d[i + 1] + 1);
        if (y < BH - 1) { w = Math.min(w, d[i + BW] + 1); if (x < BW - 1) w = Math.min(w, d[i + BW + 1] + R2); if (x > 0) w = Math.min(w, d[i + BW - 1] + R2); }
        d[i] = w; }
    }
    function fold(now) {
      var m = body.mask, lab = body.label, people = body.people, i;
      lastFold = now; folds++; fadeK = 1;
      foldLog.push([folds, realFrames, body.people.length]); if (foldLog.length > 12) foldLog.shift();
      // match the stage's people to my tracks by position (survives depth stalls and the stage's id changes)
      var used = {}, map = [];
      people.forEach(function (p, idx) {
        var best = null, bd = 0.15;
        for (var q = 0; q < tracks.length; q++) { var t = tracks[q]; if (used[t.id]) continue; var d = Math.hypot(t.x - p.cx, t.y - p.cy); if (d < bd) { bd = d; best = t; } }
        if (!best) {
          best = {id: nextTrack++, x: p.cx, y: p.cy, still: 0, flare: ARRIVE_FLARE, e: 1 + ARRIVE_FLARE, born: now, moving: 1, calm: 0}; tracks.push(best);
          for (var gi = 0; gi < graves.length; gi++) { var gr = graves[gi];          // someone (or something) that only just dropped out here: no new flare, keep its clocks
            if (now - gr.t < 2000 && Math.hypot(gr.x - p.cx, gr.y - p.cy) < 0.1) { best.flare = 0; best.e = gr.e; best.still = gr.still; best.parked = gr.parked; best.ax = gr.ax; best.ay = gr.ay; best.act = gr.act; graves.splice(gi, 1); break; } }
        }
        used[best.id] = true;
        best.x = p.cx; best.y = p.cy; best.top = p.top; best.bottom = p.bottom; best.left = p.left; best.right = p.right; best.area = p.area;
        if (best.ax === undefined || Math.hypot(p.cx - best.ax, p.cy - best.ay) > PARK_DRIFT) { best.ax = p.cx; best.ay = p.cy; best.parked = 0; }   // it went somewhere: the ghost clock restarts
        best.moving = p.moving; best.seen = now; best.label = idx; map[idx] = best;
      });
      for (var q = tracks.length - 1; q >= 0; q--) if (!used[tracks[q].id] && now - tracks[q].seen > STALE_HOLD_S * 1000) {
        var dead = tracks.splice(q, 1)[0]; graves.push({x: dead.x, y: dead.y, t: now, e: dead.e, still: dead.still, parked: dead.parked, ax: dead.ax, ay: dead.ay, act: dead.act}); if (graves.length > 12) graves.shift(); }
      for (i = 0; i < BN; i++) { held[i] = m[i]; gate[i] = lab[i]; }
      dilateGate(gate, gate2); dilateGate(gate2, gate);
      for (i = 0; i < BN; i++) { var g = gate[i]; pdist[i] = g >= 0 && m[i] > 0.5 ? 0 : 1e6; }
      chamfer(pdist);
      trackMap = map; haveBody = true; jfaDirty = true;
      lightPoints(map, now);
      if (folds % 30 === 1) measureCell();
    }
    var trackMap = [], graves = [];
    // each person's light points (window 0..1): the heart (middle of the upper body) and the farthest reach on either side
    // (a raised hand, an elbow); shadows are cast from these, so moving an arm swings the trunks' shadows
    var acc = [];
    function lightPoints(map, now) {
      var lab = body.label, people = body.people, np = people.length, i, x, y, a;
      for (i = 0; i < np; i++) { a = acc[i] || (acc[i] = {}); a.sx = 0; a.sy = 0; a.n = 0; a.t = people[i].top * BH; a.b = people[i].bottom * BH; a.ld = -1; a.rd = -1; }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { var l = lab[y * BW + x]; if (l < 0) continue; a = acc[l]; if (y < a.t + 0.6 * (a.b - a.t)) { a.sx += x; a.sy += y; a.n++; } }
      for (i = 0; i < np; i++) { a = acc[i]; a.hx = a.n ? a.sx / a.n : people[i].cx * BW; a.hy = a.n ? a.sy / a.n : people[i].cy * BH; }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { var l2 = lab[y * BW + x]; if (l2 < 0) continue; a = acc[l2]; if (y > a.t + 0.55 * (a.b - a.t)) continue;   // hands and arms, head and shoulders (not the legs)
        var d = (x - a.hx) * (x - a.hx) + (y - a.hy) * (y - a.hy);
        if (x < a.hx) { if (d > a.ld) { a.ld = d; a.lx = x; a.ly = y; } } else if (d > a.rd) { a.rd = d; a.rx = x; a.ry = y; } }
      for (i = 0; i < np; i++) {
        a = acc[i]; var t = map[i]; if (!t) continue;
        var pts = [[a.hx, a.hy], a.ld >= 0 ? [a.hx + (a.lx - a.hx) * 0.92, a.hy + (a.ly - a.hy) * 0.92] : null, a.rd >= 0 ? [a.hx + (a.rx - a.hx) * 0.92, a.hy + (a.ry - a.hy) * 0.92] : null];
        var q = pts.map(function (c) { return c ? screenOf((c[0] + 0.5) / BW, (c[1] + 0.5) / BH) : null; });
        var moved = 0, dtF = Math.max(0.01, Math.min(0.3, (now - (t.qAt || now - 33)) / 1000)); t.qAt = now;
        if (!t.q) t.q = q;
        else for (var k = 0; k < 3; k++) { if (!q[k]) continue; if (!t.q[k]) { t.q[k] = q[k]; continue; }
          var nx = t.q[k][0] + (q[k][0] - t.q[k][0]) * 0.6, ny = t.q[k][1] + (q[k][1] - t.q[k][1]) * 0.6; moved = Math.max(moved, Math.hypot(nx - t.q[k][0], ny - t.q[k][1])); t.q[k] = [nx, ny]; }
        t.act = (t.act || 0) + (moved / dtF - (t.act || 0)) * (1 - Math.exp(-dtF / 0.5));   // how fast its hands and head move (wall widths per second)
      }
    }
    function tracksStep(dt) {
      var any = false;
      tracks.forEach(function (t) {
        var act = t.act || 0;
        if (t.moving > MOVE_HI || act > ACT_HI) t.still = 0; else if (t.moving < MOVE_LO && act < ACT_LO) t.still += dt;
        if (act > ACT_HI) t.parked = 0; else t.parked = (t.parked || 0) + dt;
        t.flare *= Math.exp(-dt / 0.45);
        var ghost = Math.max(0, Math.min(1, (Math.max(t.still, t.parked) - GHOST_S) / 6)); ghost = ghost * ghost * (3 - 2 * ghost);
        var target = (1 + t.flare) * (1 - ghost * (1 - GHOST_DIM));
        t.e += (target - t.e) * (1 - Math.exp(-dt / (target > t.e ? 0.25 : 1.5)));
        t.calm += ((t.still > 0.6 ? 1 : 0) - t.calm) * (1 - Math.exp(-dt / 1.5));
        any = true;
      });
      return any;
    }
    function upload() {                     // r = held mask (darkness), g = people-only mask (emitters), b = which person (1..8, 0 = nobody)
      var lab = gate, k = fadeK;
      for (var i = 0; i < BN; i++) {
        var o = i * 4, t = lab[i] >= 0 ? trackMap[lab[i]] : null, hm = held[i] * k;
        bodyBytes[o] = Math.round(Math.max(0, Math.min(1, hm)) * 255);
        bodyBytes[o + 1] = t ? Math.round(Math.max(0, Math.min(1, held[i])) * 255) : 0;
        bodyBytes[o + 2] = t ? Math.min(8, lab[i] + 1) : 0;
        bodyBytes[o + 3] = 255;
      }
      gl.bindTexture(gl.TEXTURE_2D, bodyTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, bodyBytes);
    }
    function staleStep(now) {               // the Kinect went quiet: hold everything for STALE_HOLD_S, then let the people go
      var s = (now - lastFold) / 1000;
      if (!haveBody || s < STALE_HOLD_S) return;
      fadeK = Math.exp(-(s - STALE_HOLD_S) / 0.3);
      if (fadeK < 0.01) { held.fill(0); gate.fill(-1); pdist.fill(1e6); tracks = []; trackMap = []; haveBody = false; fadeK = 1; jfaDirty = true; }
    }

    // ---- hung lanterns (fingertips)
    var lamps = [], fPrev = [], touchMode = false, landings = 0, LP = new Float32Array(24);
    function land(x, y) {
      landings++;
      for (var i = 0; i < lamps.length; i++) if (Math.hypot(lamps[i].x - x, (lamps[i].y - y) * refH / 1280) < 0.035) { lamps[i].age = Math.min(lamps[i].age, 0.3); return lamps[i]; }
      if (lamps.length >= MAX_LAMPS) lamps.shift();
      var l = {x: x, y: y, age: 0, ph: Math.random() * 6.28}; lamps.push(l); return l;
    }
    function fingers() {
      var f = kit.fingers;
      if (f) touchMode = false;
      var pts = (f && Array.isArray(f.pts) && Date.now() - f.t <= 160) ? f.pts : [], nowPts = [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var best = -1, bd = 0.08;
        for (var j = 0; j < fPrev.length; j++) { var d = Math.hypot(fPrev[j][0] - p[0], fPrev[j][1] - p[1]); if (d < bd) { bd = d; best = j; } }
        var lamp = best < 0 ? land(p[0], p[1]) : fPrev[best][2];
        if (lamp && lamps.indexOf(lamp) >= 0) { lamp.x = p[0]; lamp.y = p[1]; }      // a held fingertip carries its lantern
        nowPts.push([p[0], p[1], lamp]);
      }
      fPrev = nowPts;
    }
    function lampLevel(l) {
      var ign = Math.min(1, 0.45 + l.age / 0.12), left = LAMP_S - l.age, gut = Math.max(0, Math.min(1, left / 8));
      var fl = 1 + 0.05 * Math.sin(elapsed * 9 + l.ph) + 0.04 * Math.sin(elapsed * 23 + l.ph * 2) + (1 - gut) * 0.25 * Math.sin(elapsed * 17 + l.ph);
      return LAMP_LIGHT * ign * gut * fl;
    }

    // ---- fireflies (ref px)
    var ff = [], R0 = rng(((Math.random() * 1e9) | 0) ^ 0x51ab);
    for (var fi = 0; fi < Math.min(MAXFF, FIREFLIES); fi++)
      ff.push({x: 40 + R0() * 1200, y: 800 * (0.2 + R0() * 0.7), vx: 0, vy: 0, hd: R0() * 6.28, th: R0() * 6.28, w: 6.283 * 0.32 * (0.75 + 0.5 * R0()),
               fl: 0, awake: fi < FF_IDLE ? 1 : 0, band: 20 + R0() * 55, nearB: 0, side: R0() < 0.5 ? -1 : 1, near: 0, track: null});
    var FFU = new Float32Array(MAXFF * 4), syncR = 0, nearCount = 0;
    function fireflies(dt) {
      var present = tracks.length > 0 && haveBody, i, f, refY = refH / 800;
      // the rhythm of the fireflies around each person (Kuramoto order parameter)
      var ord = {};
      for (i = 0; i < ff.length; i++) { f = ff[i]; if (f.track && f.near > 0) { var o = ord[f.track.id] || (ord[f.track.id] = [0, 0, 0]); o[0] += f.near * Math.cos(f.th); o[1] += f.near * Math.sin(f.th); o[2] += f.near; } }
      nearCount = 0; var rs = 0, rn = 0;
      for (var key in ord) { var oo = ord[key]; if (oo[2] > 0.5) { rs += Math.hypot(oo[0], oo[1]) / oo[2] * oo[2]; rn += oo[2]; } }
      syncR = rn ? rs / rn : 0;
      for (i = 0; i < ff.length; i++) {
        f = ff[i];
        var wantAwake = present ? 1 : (i < FF_IDLE ? 1 : 0);
        f.awake += (wantAwake - f.awake) * (1 - Math.exp(-dt / (wantAwake ? 0.8 : 2.5)));
        f.hd += dt * (Math.sin(elapsed * 0.7 + i * 1.7) * 1.1 + Math.sin(elapsed * 0.23 + i) * 0.6);
        var sp = 22 + 10 * Math.sin(i * 3.1), dx = Math.cos(f.hd) * sp, dy = Math.sin(f.hd) * sp * 0.7;
        dy += (800 * refY * 0.55 - f.y) * 0.04; dx += (640 - f.x) * 0.006;           // stay in the forest, a little low
        if (f.x < 30) dx += 40; if (f.x > 1250) dx -= 40; if (f.y < 120 * refY) dy += 40; if (f.y > 760 * refY) dy -= 40;
        // someone near: come over, hover in a band outside their outline, circle; scatter from fast movement
        var wx = f.x / 1280, wy = f.y / refH, d = present ? distAt(wx, wy) * cellPx : 1e9;
        f.near = 0; f.nearB = 0; f.track = null;
        if (d < FF_REACH) {
          var e1 = 3 / 1280, gx = (distAt(wx + e1, wy) - distAt(wx - e1, wy)), gy = (distAt(wx, wy + e1 * 1280 / refH) - distAt(wx, wy - e1 * 1280 / refH)), gl2 = Math.hypot(gx, gy);
          if (gl2 > 1e-6 && gl2 < 50) { gx /= gl2; gy /= gl2; } else { gx = 0; gy = -1; }
          var wN = 1 - d / FF_REACH; f.near = wN; f.nearB = Math.max(0, Math.min(1, (140 - d) / 80));   // brightest right around you
          var tr = nearestTrack(wx, wy); f.track = tr;
          var rad = -(d - f.band) * 1.4, tang = 38 * f.side;
          dx = dx * (1 - wN) + (gx * rad - gy * tang) * wN; dy = dy * (1 - wN) + (gy * rad + gx * tang) * wN;
          if (tr && tr.moving > MOVE_HI) { dx += gx * 90 * wN; dy += gy * 90 * wN; }
          if (d < 2) { dx += gx * 260; dy += gy * 260; }
          nearCount++;
        }
        var k = 1 - Math.exp(-dt * 2.4);
        f.vx += (dx - f.vx) * k; f.vy += (dy - f.vy) * k;
        f.x += f.vx * dt; f.y += f.vy * dt;
        // blink: phase oscillators, coupled around a still person
        var dth = f.w;
        if (f.track && ord[f.track.id] && ord[f.track.id][2] > 0.5) {
          var oo2 = ord[f.track.id], r = Math.hypot(oo2[0], oo2[1]) / oo2[2], psi = Math.atan2(oo2[1], oo2[0]);
          dth += FF_SYNC * f.track.calm * f.near * Math.max(0.3, r) * Math.sin(psi - f.th) * 2;
        }
        var before = f.th; f.th += dth * dt;
        if (Math.floor(f.th / 6.2832) !== Math.floor(before / 6.2832)) f.fl = 1;
        f.fl *= Math.exp(-dt / 0.2);
      }
    }
    function nearestTrack(wx, wy) {
      var best = null, bd = 1e9;
      for (var q = 0; q < tracks.length; q++) { var t = tracks[q], s = screenOf(t.x, t.y); if (!s) continue; var d = Math.hypot(s[0] - wx, s[1] - wy); if (d < bd) { bd = d; best = t; } }
      return best;
    }
    function ffBright(f) { return f.awake * (0.1 + f.fl * (0.35 + 0.65 * f.nearB)); }

    // ---- passes
    function runJfa() {
      gl.bindVertexArray(vao); gl.disable(gl.BLEND);
      var S = P.seed;
      gl.useProgram(S.p); gl.bindFramebuffer(gl.FRAMEBUFFER, jfaFb[0]); gl.viewport(0, 0, LW, LH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(S.u.uBody, 0);
      gl.uniformMatrix3fv(S.u.uHinv, false, body.hinv()); gl.uniform2f(S.u.uLRes, LW, LH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      var J = P.jump, src = 0;
      gl.useProgram(J.p); gl.uniform1i(J.u.uSrcA, 0); gl.uniform1i(J.u.uSrcB, 1); gl.uniform2f(J.u.uLRes, LW, LH);
      for (var s = 0; s < JFA_STEPS.length; s++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, jfaFb[1 - src]);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, jfa[src]); gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, jfb[src]);
        gl.uniform1f(J.u.uStep, JFA_STEPS[s]); gl.drawArrays(gl.TRIANGLES, 0, 3); src = 1 - src;
      }
      gl.activeTexture(gl.TEXTURE0);
      jfaOut = src; jfaDirty = false;
    }
    var dbgShadow = 1, dbgView = 0, dbgFF = 1, dbgWeb = 1, foldLog = [], QQ = new Float32Array(MAXQ * 4), EE = new Float32Array(8), LL = new Float32Array(24);
    function lightPass(dt) {
      var Lp = P.light, u = Lp.u, i;
      gl.bindVertexArray(vao); gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lightFb[cur]); gl.viewport(0, 0, LW, LH); gl.useProgram(Lp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, jfa[jfaOut]); gl.uniform1i(u.uJfa, 0);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, jfb[jfaOut]); gl.uniform1i(u.uJfb, 4);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, occTex); gl.uniform1i(u.uOcc, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, ch[cur]); gl.uniform1i(u.uCharge, 3);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv()); gl.uniform2f(u.uLRes, LW, LH); gl.uniform2f(u.uRef, 1280, refH);
      var crowd = 0; tracks.forEach(function (t) { crowd += Math.min(1, t.e) * Math.min(1, (t.area || 150) / 150); });   // a burnt-low chair or a speck counts for little
      var expo = 1 / (1 + CROWD * 0.18 * Math.max(0, crowd - 2));
      gl.uniform1f(u.uReach, LIGHT_REACH); gl.uniform1f(u.uR, LIGHT_R); gl.uniform1f(u.uSoft, SOFTNESS); gl.uniform1f(u.uShadow, SHADOWS * dbgShadow);
      gl.uniform1f(u.uLight, LIGHT); gl.uniform1f(u.uSeed, forest.sd);
      for (i = 0; i < 8; i++) { var tm = trackMap[i]; EE[i] = (tm ? tm.e : 1) * fadeK; }
      gl.uniform1fv(u.uE, EE);
      gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uFade, Math.exp(-dt / GLOW_S)); gl.uniform1f(u.uChargeK, 1 / CHARGE_S);
      gl.uniform1f(u.uLampR, 125); gl.uniform1f(u.uLampSoft, 18); gl.uniform1f(u.uFFR, 34); gl.uniform1f(u.uFF, FF_LIGHT);
      var nq = 0, per = tracks.length > 4 ? 1 : 3;
      for (i = 0; i < tracks.length; i++) { var tq = tracks[i]; if (!tq.q) continue;
        if (tq.label === undefined || trackMap[tq.label] !== tq) continue;      // only people in the current depth frame (their light points carry their label)
        for (var k = 0; k < per && nq < MAXQ; k++) { var qq = tq.q[k]; if (!qq) continue; QQ.set([qq[0] * 1280, qq[1] * refH, tq.e * fadeK * (k ? 0.7 : 1), Math.min(7, tq.label)], nq * 4); nq++; } }
      gl.uniform1i(u.uNQ, nq); gl.uniform4fv(u.uQ, QQ);
      for (i = 0; i < lamps.length; i++) LL.set([lamps[i].x * 1280, lamps[i].y * refH, lampLevel(lamps[i]), 0], i * 4);
      gl.uniform1i(u.uNL, lamps.length); gl.uniform4fv(u.uL, LL);
      var nf = 0;
      for (i = 0; i < ff.length; i++) { var b = ffBright(ff[i]); if (b < 0.01) continue; FFU.set([ff[i].x, ff[i].y, b, 0], nf * 4); nf++; }
      gl.uniform1i(u.uNF, nf); gl.uniform4fv(u.uF, FFU);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = 1 - cur;
      lastExpo = expo;
    }
    var lastExpo = 1;
    function display() {
      var D = P.disp, u = D.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(D.p); gl.bindVertexArray(vao); gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneA); gl.uniform1i(u.uA, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sceneN); gl.uniform1i(u.uN, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, L0); gl.uniform1i(u.uL0, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, L1); gl.uniform1i(u.uL1, 3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, ch[cur]); gl.uniform1i(u.uC, 4);
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 5);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv()); gl.uniform2f(u.uRef, 1280, refH);
      gl.uniform1f(u.uTime, elapsed); gl.uniform1f(u.uDark, DARK_INSIDE); gl.uniform1f(u.uRelief, RELIEF); gl.uniform1f(u.uMoon, MOON * wallK); gl.uniform1f(u.uWallK, wallK);
      gl.uniform1f(u.uGlow, GLOW); gl.uniform1f(u.uIdle, IDLE_GLOW * wallK); gl.uniform1f(u.uWeb, WEBS * dbgWeb); gl.uniform1f(u.uRim, RIM); gl.uniform1f(u.uHaze, HAZE); gl.uniform1f(u.uFog, FOG); gl.uniform1i(u.uView, dbgView);
      gl.uniform1f(u.uExpo, lastExpo);
      for (var i = 0; i < lamps.length; i++) LP.set([lamps[i].x * 1280, lamps[i].y * refH, lampLevel(lamps[i]), 0], i * 4);
      gl.uniform1i(u.uNL, lamps.length); gl.uniform4fv(u.uL, LP);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // fireflies
      var n = 0;
      for (i = 0; i < ff.length; i++) { var b = ffBright(ff[i]); if (b < 0.01) continue; ffData.set([ff[i].x / 1280, ff[i].y / refH, 12 + 10 * ff[i].fl, Math.min(1.1, b * 1.1)], n * 4); n++; }
      if (n && dbgFF) {
        var Fp = P.ff;
        gl.useProgram(Fp.p); gl.bindVertexArray(ffVao); gl.bindBuffer(gl.ARRAY_BUFFER, ffBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, ffData.subarray(0, n * 4));
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(Fp.u.uBody, 0);
        gl.uniformMatrix3fv(Fp.u.uHinv, false, body.hinv()); gl.uniform1f(Fp.u.uDark, DARK_INSIDE); gl.uniform1f(Fp.u.uPx, pxS);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, n);
        gl.disable(gl.BLEND); gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    }

    var cpuMs = 0;
    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); frames++;
      if (canvas.width !== W || canvas.height !== H) alloc(canvas.width, canvas.height);
      var c0 = performance.now();
      if (dt > 0) {
        realFrames++; elapsed += dt;
        if (body.update(dt, now)) fold(now); else if (!body.fresh) staleStep(now);
        tracksStep(dt);
        touchMode = false; fingers();      // the host's fingertip stream is read every frame; a sparse touch() no longer switches it off for the piece's whole life
        for (var i = lamps.length - 1; i >= 0; i--) { lamps[i].age += dt; if (lamps[i].age > LAMP_S) lamps.splice(i, 1); }
        fireflies(dt);
        upload();
      }
      cpuMs = performance.now() - c0;
      if (jfaDirty) runJfa();
      lightPass(dt);
      display();
    }
    function touch(t) {                      // fallback only: sparse touches when the host never sends fingertips
      if ((!t) || (t && !t._wake && kit.fingers && Date.now() - kit.fingers.t <= 160 && kit.fingers.pts && kit.fingers.pts.length)) return;
      touchMode = true;
      if (t.first) land(t.x, t.y);
    }
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.LanternSet === set) delete window.LanternSet;
      if (window.LanternWake === wake) delete window.LanternWake; kit.wantDepth(false);
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
      if (window.__lanternDebug) try { delete window.__lanternDebug; } catch (e) { window.__lanternDebug = undefined; }
    }
    kit.wantDepth(true);
    if (window.WallTest) window.__lanternDebug = function (o) {   // sandbox only (the live wall has no WallTest)
      o = o || {};
      if (o.shadows !== undefined) dbgShadow = o.shadows ? 1 : 0;
      if (o.view !== undefined) dbgView = o.view;
      if (o.ff !== undefined) dbgFF = o.ff ? 1 : 0;
      if (o.webs !== undefined) dbgWeb = o.webs ? 1 : 0;
      if (o.stillAdd) tracks.forEach(function (t) { t.still += o.stillAdd; });
      if (o.ageLamps) lamps.forEach(function (l) { l.age += o.ageLamps; });
      if (o.seed) { forest = makeForest(o.seed, refH); seedUsed = o.seed; bake(); }
      var out = {frames: frames, realFrames: realFrames, folds: folds, foldLog: foldLog.slice(), bakeMs: +bakeMs.toFixed(1), cpuMs: +cpuMs.toFixed(3), seed: seedUsed, light: [LW, LH], cellPx: +cellPx.toFixed(2),
        fresh: body.fresh, regOk: body.regOk, fadeK: +fadeK.toFixed(3), births: nextTrack - 1, graves: graves.length,
        tracks: tracks.map(function (t) { return {id: t.id, e: +t.e.toFixed(3), still: +t.still.toFixed(2), parked: +(t.parked || 0).toFixed(2), act: +(t.act || 0).toFixed(3), area: t.area, moving: +(t.moving || 0).toFixed(3), calm: +t.calm.toFixed(2),
          q: (t.q || []).map(function (q) { return q ? [+q[0].toFixed(3), +q[1].toFixed(3)] : null; })}; }),
        lamps: lamps.map(function (l) { return {x: +l.x.toFixed(3), y: +l.y.toFixed(3), age: +l.age.toFixed(2), level: +lampLevel(l).toFixed(3)}; }), landings: landings,
        fireflies: {n: ff.length, near: nearCount, sync: +syncR.toFixed(3), lit: ff.filter(function (f) { return ffBright(f) > 0.2; }).length},
        glError: gl.getError()};
      if (o.forest) out.forest = {trunks: forest.trunks.map(function (t) { return {x: t.x / 1280, w: t.w / 1280, z: t.z, at: [0.2, 0.4, 0.6, 0.8].map(function (y) { var c = forest.at(t, y * refH); return [+(c[0] / 1280).toFixed(4), +(c[1] / 1280).toFixed(4)]; })}; }),
        webs: forest.webs.map(function (w) { return {x: w.x / 1280, y: w.y / refH, r: w.r / 1280}; }), mush: forest.mush.map(function (m) { return {x: m.x / 1280, y: m.y / refH, r: m.r}; }),
        shelves: forest.shelves.map(function (s) { return {x: s.x / 1280, y: s.y / refH, r: s.r}; }),
        branches: forest.branches.map(function (b) { return [Math.round(b.a[0]), Math.round(b.a[1]), Math.round(b.b[0]), Math.round(b.b[1]), +b.r0.toFixed(1), b.owner]; })};
      if (o.pts || o.box) {                   // the light buffer read back at window points / over a box (sandbox only)
        var px = new Float32Array(LW * LH * 4), px1 = new Float32Array(LW * LH * 4), pc = new Float32Array(LW * LH * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, lightFb[1 - cur]);
        gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, LW, LH, gl.RGBA, gl.FLOAT, px);
        gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, LW, LH, gl.RGBA, gl.FLOAT, px1);
        gl.readBuffer(gl.COLOR_ATTACHMENT2); gl.readPixels(0, 0, LW, LH, gl.RGBA, gl.FLOAT, pc);
        gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        var idx = function (x, y) { return (Math.min(LH - 1, Math.max(0, Math.floor((1 - y) * LH))) * LW + Math.min(LW - 1, Math.max(0, Math.floor(x * LW)))) * 4; };
        if (o.pts) out.pts = o.pts.map(function (p) { var i = idx(p[0], p[1]); return {light: +px[i].toFixed(4), ff: +px[i + 1].toFixed(4), overlap: +px[i + 2].toFixed(4), dist: +px1[i + 3].toFixed(1), charge: +pc[i].toFixed(4)}; });
        if (o.box) {
          var b = o.box, x0 = Math.floor(b[0] * LW), x1 = Math.ceil(b[2] * LW), y0 = Math.floor((1 - b[3]) * LH), y1 = Math.ceil((1 - b[1]) * LH), s = 0, mx = 0, so = 0, sc = 0, mc = 0, n = 0;
          for (var y = Math.max(0, y0); y < Math.min(LH, y1); y++) for (var x = Math.max(0, x0); x < Math.min(LW, x1); x++) { var j = (y * LW + x) * 4; s += px[j]; mx = Math.max(mx, px[j]); so += px[j + 2]; sc += pc[j]; mc = Math.max(mc, pc[j]); n++; }
          out.box = {light: +(s / Math.max(1, n)).toFixed(4), lightMax: +mx.toFixed(4), overlap: +(so / Math.max(1, n)).toFixed(4), charge: +(sc / Math.max(1, n)).toFixed(4), chargeMax: +mc.toFixed(4)};
        }
      }
      return out;
    };
    function set(opts) {
      if (!opts || destroyed) return {light: LIGHT, radius: LIGHT_R, reach: LIGHT_REACH, shadows: SHADOWS, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.light)) LIGHT = Math.max(0.3, Math.min(2, opts.light));
      if (Number.isFinite(opts.radius)) LIGHT_R = Math.max(40, Math.min(250, opts.radius));
      if (Number.isFinite(opts.reach)) LIGHT_REACH = Math.max(150, Math.min(800, opts.reach));
      if (Number.isFinite(opts.shadows)) SHADOWS = Math.max(0, Math.min(1.5, opts.shadows));
      return {light: LIGHT, radius: LIGHT_R, reach: LIGHT_REACH, shadows: SHADOWS, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      try { if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true}); } catch (e) {}
    }
    window.LanternSet = set;
    window.LanternWake = wake;
    if (window._lanternFx) set(window._lanternFx);

    return {frame: frame, touch: touch, destroy: destroy};
  }
})();
