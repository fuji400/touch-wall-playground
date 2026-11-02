/* Dalí · Melting Time (dalimelt), paintings round 2, 2026-10-08, built by Claude.
 * An original dreamscape in Dalí's language: a hyper-smooth golden dusk sky over a calm sea, craggy amber cliffs, a flat ochre plain
 * with very long shadows, a dead tree and a stone ledge, spindly elephants crossing the far plain, and soft pocket watches (Verlet
 * cloth) draped over the branch, the ledge and a boulder. Their faces show the real time.
 * Play: your body and hands are HEAT. Move and the landscape melts like warm wax right where you are: the horizon and cliffs sag and
 * long glossy drips run down, then slowly re-solidify over tens of seconds. Grab a watch and stretch it like taffy, fling it, watch it
 * drape. Near movement the watch hands whirl. Hold a hand still and a new soft watch forms under it, falls and drapes; the ants come.
 * Your shadow is a long Dalí shadow across the plain. Needs plugins/body.js (WallBody). WebGL 2, no assets, no audio, one depth client.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs (Billy: these are safe to change)
  var HEAT_TAU = 2.0;          // seconds a patch of heat lasts once you stop moving there
  var HEAT_RISE = 0.08;        // how fast heat rises above you (share of wall height per second): a child low melts the horizon above
  var MOTION_HEAT = 4.0;       // heat from a moving body (per second, per unit of movement)
  var PRESENCE_HEAT = 1.5;     // heat from the whole body (and a warm halo around it) of someone who is moving; a still person or object makes none
  var POOL_HEAT = 2.0;          // a moving person's feet melt the ground into a spreading pool (per second)
  var HAND_HEAT = 5.5;         // heat from a moving hand or fingertip (per second)
  var HAND_RADIUS = 0.085;      // size of a hand's heat (share of wall width)
  var MELT = 1.0;              // knob 'melt': how strongly heat melts the paint
  var HEAL_S = 20;             // knob 'heal': seconds for the melted landscape to re-solidify (time constant)
  var SOFT = 1.0;              // knob 'soft': how soft the watches are (higher = droopier, stretchier)
  var WARP = 1.0;              // knob 'warp': how wildly the watch hands whirl near movement
  var INSIDE = 0.35;           // knob 'inside': brightness of the picture inside a person (0.35 = their shadow, no glare on faces)
  var SHADOW = 0.75;           // darkness of your long shadow across the plain
  var ACT_ON = 0.06, ACT_OFF = 0.025;  // a person counts as moving when this share of them changed in 0.4 s, still below ACT_OFF (hysteresis)
  var GRAB_R = 72;             // a hand this close to a watch (px on a 1280-wide wall) picks it up
  var HOLD_TO_GROW_S = 1.0;    // hold a hand still this long on empty paint and a new watch forms under it
  var BODY_HOLD_S = 1.6;       // ...or, with no fingertips, stand still this long after moving (it forms at your outstretched hand)
  var KICK = 3600;             // how hard a moving body knocks the watches it sweeps through
  var HOME_IDLE_S = 28;        // a home watch left lying somewhere else melts away and re-forms in its place after this long
  var NEW_LIFE_S = 55;         // a new watch lasts this long (then melts away), at most 4 at once
  var NANTS = 44, ANT_SPEED = 230;   // the ants on the orange watch, and how fast they scurry (px per second)

  var ID = 'dalimelt';
  registerWallPlugin({id: ID, title: 'Dalí · Melting Time', author: 'Claude (paintings round 2)', create: create});

  // ---------------------------------------------------------------- the scene (reference pixels of a 1280 x 800 wall, y down)
  // World for the cloth: x right, y down (gravity), z toward you. On the wall: sx = x, sy = y + TILT * z (an oblique look from above).
  var SC = {HOR: 368, SEA1: 418, YG: 600, TILT: 0.3, LX0: 150, LX1: 540, LY0: 480, LZ0: -70, LZ1: 70, BCX: 930, BCY: 572, BCZ: 170, BR: 60};
  var SUN = norm3([-2.6, -1.0, 0.45]);   // toward the low sun (left, up, a little toward you): shadows run long to the right
  var TREE = [                           // [ax, ay, az, ar, bx, by, bz, br]: the dead tree (also a cloth collider)
    [290, 484, -40, 15, 294, 452, -38, 13.5], [294, 452, -38, 13.5, 289, 420, -34, 12], [289, 420, -34, 12, 282, 388, -30, 11],
    [282, 388, -30, 11, 287, 356, -24, 10], [287, 356, -24, 10, 301, 322, -14, 9],
    [301, 322, -14, 9, 345, 312, -8, 7.6], [345, 312, -8, 7.6, 405, 315, -4, 6.8], [405, 315, -4, 6.8, 470, 322, -2, 6],
    [470, 322, -2, 6, 540, 329, 0, 5.4], [540, 329, 0, 5.4, 610, 333, 0, 4.6], [610, 333, 0, 4.6, 670, 331, 0, 3.6], [670, 331, 0, 3.6, 742, 320, 0, 2.2],
    [301, 322, -14, 7, 287, 288, -14, 5.6], [287, 288, -14, 5.6, 266, 256, -14, 4], [266, 256, -14, 4, 252, 236, -14, 2.6],
    [470, 322, -2, 2.6, 486, 300, -2, 1.8], [486, 300, -2, 1.8, 494, 286, -2, 1.1], [420, 316, -4, 2.5, 447, 338, -4, 1.2]];
  var POSTS = [[655, -520, 46, 2.2], [1012, -470, 30, 1.6]];   // far poles on the plain: [x, z, height, radius]
  function norm3(v) { var l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; }
  function fl(v) { var s = String(+v.toFixed(5)); return /[.e]/.test(s) ? s : s + '.0'; }
  function defs() {
    var s = Object.keys(SC).map(function (k) { return '#define ' + k + ' ' + fl(SC[k]); }).join('\n') + '\n';
    s += '#define SUN vec3(' + SUN.map(fl).join(',') + ')\n';
    s += '#define NSEG ' + TREE.length + '\n';
    s += 'const vec4 SA[NSEG]=vec4[NSEG](' + TREE.map(function (t) { return 'vec4(' + [t[0], t[1], t[2], t[3]].map(fl).join(',') + ')'; }).join(',') + ');\n';
    s += 'const vec4 SB[NSEG]=vec4[NSEG](' + TREE.map(function (t) { return 'vec4(' + [t[4], t[5], t[6], t[7]].map(fl).join(',') + ')'; }).join(',') + ');\n';
    s += 'const vec4 POSTS[2]=vec4[2](' + POSTS.map(function (t) { return 'vec4(' + t.map(fl).join(',') + ')'; }).join(',') + ');\n';
    return s;
  }

  var MW = 320, MH = 200;          // the melt field (wax displacement, flow, gloss)
  var HW = 128, HH = 80;           // the heat field (10 x 10 reference pixels per cell)

  // ---------------------------------------------------------------- shaders
  var HEAD = '#version 300 es\nprecision highp float;\n';
  var VS_FULL = HEAD + 'out vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var NOISE = [
    'float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}',
    'float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*vn(p);p=p*2.03+vec2(17.1,9.3);a*=.5;}return s;}',
    'float n1(float x){return vn(vec2(x,.37));}',
    'float sqr(float v){return v*v;}',   // x*x, never pow(x,2.): pow is undefined for a negative base (the Van Gogh NaN class)
    'float sdSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}',
    'float sdEll(vec2 p,vec2 r){float k=length(p/r);return (k-1.)*min(r.x,r.y);}',
    'float sdBox(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,d.y),0.);}',
    ''].join('\n');

  // The painting's still parts, drawn once (and again on resize). Everything is computed: no images.
  var FS_BAKE = HEAD + '%DEFS%' + NOISE + [
    'in vec2 vUv; out vec4 o;',
    'vec2 h22(vec2 p){vec3 a=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));a+=dot(a,a.yzx+33.33);return fract((a.xx+a.yz)*a.zy);}',
    'vec4 cells(vec2 p){vec2 i=floor(p),f=fract(p);float d1=8.,d2=8.;vec2 r1=vec2(0.);',
    '  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 r=g+h22(i+g)*.8+.1-f;float d=dot(r,r);',
    '    if(d<d1){d2=d1;d1=d;r1=r;}else if(d<d2)d2=d;}',
    '  return vec4(sqrt(d1),sqrt(d2)-sqrt(d1),r1);}',
    'vec3 sky(vec2 P){',
    '  float t=clamp(P.y/HOR,0.,1.);',
    '  vec3 c=mix(vec3(.075,.15,.26),vec3(.17,.31,.45),smoothstep(0.,.40,t));',
    '  c=mix(c,vec3(.40,.52,.60),smoothstep(.28,.70,t));',
    '  c=mix(c,vec3(.72,.63,.47),smoothstep(.62,.91,t));',
    '  c=mix(c,vec3(.90,.72,.44),smoothstep(.88,1.,t));',
    '  c+=vec3(.13,.075,.0)*exp(-sqr((P.x-330.)/430.))*pow(t,3.);',
    '  return c;}',
    'float farTop(float x){return HOR-smoothstep(660.,930.,x)*(30.+12.*n1(x*.012)+5.*n1(x*.05))-smoothstep(330.,40.,x)*(17.+6.*n1(x*.03+7.));}',
    'float cliffY(float x){',
    '  float r=smoothstep(845.,1000.,x); if(r<=0.)return 1e4;',
    '  float b=mix(SEA1+3.,205.,r)+24.*sin(x*.0105+1.1)*r-40.*exp(-sqr((x-1135.)/75.))+26.*exp(-sqr((x-1238.)/40.));',
    '  float cr=abs(n1(x*.028)-.5)*2.*30.+abs(n1(x*.085+3.)-.5)*2.*13.+(n1(x*.35+9.)-.5)*5.;',
    '  return b+cr*r;}',
    'float rockH(vec2 P){ vec2 q=P*vec2(.0062,.0105); q+=vec2(fbm(q*1.3+3.1),fbm(q*1.3+7.7))*.9;',
    '  return fbm(q)+.35*(1.-abs(vn(P*vec2(.016,.006)+2.)*2.-1.));}',
    'vec3 cliff(vec2 P,float top){',   // Cap de Creus: big sunlit golden planes, warm brown shade, a few deep crevices
    '  float e=2.; float h0=rockH(P),hx=rockH(P+vec2(e,0.))-rockH(P-vec2(e,0.)),hy=rockH(P+vec2(0.,e))-rockH(P-vec2(0.,e));',
    '  vec3 n=normalize(vec3(-hx/(2.*e)*95.,-hy/(2.*e)*95.,1.));',
    '  float dif=max(dot(n,normalize(vec3(-.86,-.32,.40))),0.);',
    '  vec3 c=mix(vec3(.30,.13,.09),vec3(.64,.37,.17),smoothstep(.10,.50,dif));',
    '  c=mix(c,vec3(.95,.69,.36),smoothstep(.50,.95,dif));',
    '  float crev=1.-abs(vn(P*vec2(.022,.0075)+5.)*2.-1.); c*=1.-.45*smoothstep(.88,.98,crev);',
    '  c*=.92+.10*sin((P.y*.9+P.x*.22+30.*fbm(P*.008))*.13);',
    '  c*=mix(1.06,.80,smoothstep(top,SEA1,P.y));',
    '  c=mix(c,vec3(.17,.09,.11),.35*smoothstep(SEA1-40.,SEA1+3.,P.y));',
    '  c+=vec3(.36,.22,.07)*smoothstep(5.,0.,P.y-top)*smoothstep(845.,1000.,P.x);',
    '  c=mix(c,vec3(.55,.46,.48),.18*smoothstep(1000.,860.,P.x)+.10*smoothstep(330.,180.,P.y));',
    '  return c;}',
    'vec3 sea(vec2 P){',
    '  float s=clamp((P.y-HOR)/(SEA1-HOR),0.,1.);',
    '  vec3 c=mix(vec3(.70,.62,.47),vec3(.25,.37,.43),pow(s,.5));',
    '  c=mix(c,vec3(.17,.27,.33),smoothstep(.72,1.,s));',
    '  c*=1.+.05*sin(P.y*.9+3.*vn(vec2(P.x*.004,P.y*.08)));',
    '  c+=vec3(.20,.13,.04)*exp(-sqr((P.x-330.)/160.))*(1.-s);',
    '  float my=HOR-(P.y-HOR)*2.6; float ct=cliffY(P.x);',   // the cliffs reflected in the calm sea
    '  if(my>ct)c=mix(c,vec3(.36,.21,.13),.55*(1.-s*.5));',
    '  float ft=farTop(P.x); if(my>ft)c=mix(c,vec3(.42,.38,.40),.30*(1.-s));',
    '  c+=vec3(.22,.17,.08)*exp(-(P.y-HOR)*.8);',
    '  return c;}',
    'float raySeg(vec3 ro,vec3 rd,vec3 a,vec3 b){',
    '  vec3 ba=b-a,oa=ro-a; float baba=dot(ba,ba),bard=dot(ba,rd),baoa=dot(ba,oa),rdoa=dot(rd,oa);',
    '  float den=baba-bard*bard; float s=den>1e-5?clamp((baoa-bard*rdoa)/den,0.,1.):0.;',
    '  float t=max(0.,dot(rd,a+ba*s-ro)); s=clamp(dot(ro+rd*t-a,ba)/baba,0.,1.); t=max(0.,dot(rd,a+ba*s-ro));',
    '  return length(ro+rd*t-(a+ba*s));}',
    'float occl(vec3 G,vec3 L){',   // how much of the sun this ground point cannot see (0..1)
    '  float s=0.; vec3 inv=1./L; vec3 t0=(vec3(LX0,LY0,LZ0)-G)*inv,t1=(vec3(LX1,YG+1.,LZ1)-G)*inv;',
    '  vec3 a=min(t0,t1),b=max(t0,t1); float tn=max(max(a.x,a.y),a.z),tf=min(min(b.x,b.y),b.z);',
    '  if(tf>max(tn,0.))s=1.;',
    '  vec3 oc=G-vec3(BCX,BCY,BCZ); float bb=dot(oc,L); vec3 cp=oc-L*bb; if(bb<0.)s=max(s,smoothstep(BR+1.,BR-1.,length(cp)));',
    '  for(int i=0;i<NSEG;i++){ float d=raySeg(G,L,SA[i].xyz,SB[i].xyz); float r=mix(SA[i].w,SB[i].w,.5); s=max(s,1.-smoothstep(r*.8,r*1.2+1.,d)); }',
    '  for(int i=0;i<2;i++){ vec3 a=vec3(POSTS[i].x,YG,POSTS[i].y),b=a-vec3(0.,POSTS[i].z,0.); float d=raySeg(G,L,a,b); s=max(s,1.-smoothstep(POSTS[i].w*.6,POSTS[i].w*1.4+.8,d)); }',
    '  return s;}',
    'vec3 plain(vec2 P){',
    '  float d=clamp((P.y-SEA1)/(800.-SEA1),0.,1.);',
    '  vec3 c=mix(vec3(.84,.63,.34),vec3(.72,.50,.27),smoothstep(0.,.33,d));',
    '  c=mix(c,vec3(.58,.39,.21),smoothstep(.33,.82,d));',
    '  c=mix(c,vec3(.43,.27,.15),smoothstep(.82,1.,d));',
    '  float z=pow(d,.6);',
    '  c*=.935+.13*vn(vec2(P.x*.0028+3.,z*8.));',
    '  c*=1.+.022*sin(z*120.+vn(vec2(P.x*.008,z*20.))*4.);',
    '  c=mix(vec3(.82,.72,.52),c,smoothstep(0.,5.,P.y-SEA1));',
    '  vec3 G=vec3(P.x,YG,(P.y-YG)/TILT); float sh=0.;',   // long shadows: a soft low sun (twelve rays, turned per pixel)
    '  vec3 tg=normalize(cross(SUN,vec3(0.,1.,0.))), bt=cross(SUN,tg); float rot=h21(P*.731)*6.2832;',
    '  for(int k=0;k<12;k++){ float fk=float(k); float a=fk*2.39996+rot; vec3 L=normalize(SUN+(tg*cos(a)+bt*sin(a))*.036*sqrt((fk+.5)/12.)); sh+=occl(G,L); }',
    '  sh/=12.;',
    '  c=mix(c,c*vec3(.40,.33,.40),sh);',
    '  if(P.x>LX0-6.&&P.x<LX1+4.){ float yb=YG+TILT*LZ1; c*=1.-.22*exp(-max(0.,P.y-yb)/4.)*step(yb-1.,P.y); }',
    '  return c;}',
    'float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}',
    'vec4 tree(vec2 P){',   // the dead tree, drawn as a chain of capsules (screen = x, y + TILT z)
    '  if(P.x<200.||P.x>760.||P.y<200.||P.y>480.)return vec4(0.);',
    '  float best=1e4,dm=1e4; vec2 nn=vec2(0.); float along=0.;',
    '  for(int i=0;i<NSEG;i++){ vec2 a=SA[i].xy+vec2(0.,TILT*SA[i].z),b=SB[i].xy+vec2(0.,TILT*SB[i].z);',
    '    vec2 pa=P-a,ba=b-a; float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.); vec2 q=pa-ba*h;',
    '    float r=mix(SA[i].w,SB[i].w,h)*(1.+.16*(vn(P*.08+float(i)*7.)-.5)); float d=length(q)-r;',
    '    best=smin(best,d,2.5); if(d<dm){dm=d; nn=q/max(length(q),1e-3); along=h*length(ba)+float(i)*40.;} }',
    '  float cov=smoothstep(.8,-.8,best); if(cov<=0.)return vec4(0.);',
    '  vec3 c=vec3(.21,.14,.095)*(.82+.32*vn(vec2(along*.22,dot(nn,vec2(1.))*2.5)));',
    '  float rim=max(dot(nn,normalize(vec2(-.85,-.55))),0.); c+=vec3(.66,.42,.17)*pow(rim,2.4)*.8;',
    '  c*=.80+.20*smoothstep(-6.,0.,best);',
    '  return vec4(c,cov);}',
    'vec3 ledge(vec2 P,inout float cov){',   // the stone ledge (a low block, like a plinth in the desert)
    '  float yt0=LY0+TILT*LZ0, yt1=LY0+TILT*LZ1, yb=YG+TILT*LZ1;',
    '  float cx=smoothstep(LX0-.7,LX0+.7,P.x)*smoothstep(LX1+.7,LX1-.7,P.x);',
    '  float u=(P.x-LX0)/(LX1-LX0); vec3 c;',
    '  float st=fbm(P*vec2(.03,.05))*.6+fbm(P*.12)*.4;',
    '  if(P.y<yt1){ cov=cx*smoothstep(yt0-.7,yt0+.7,P.y);',
    '    c=vec3(.80,.60,.38)*(.88+.22*st)*mix(1.07,.88,u);',
    '    c+=vec3(.16,.11,.05)*smoothstep(yt1-4.,yt1,P.y);',
    '  } else { cov=cx*smoothstep(yb+.7,yb-.7,P.y);',
    '    float v=(P.y-yt1)/(yb-yt1);',
    '    c=vec3(.57,.37,.22)*(.82+.28*st)*mix(1.10,.78,u)*mix(1.,.74,smoothstep(.5,1.,v));',
    '    c*=1.-.25*smoothstep(.10,0.,v)*0.+.0; c+=vec3(.06,.035,.015)*smoothstep(.08,.0,v);',
    '    c+=vec3(.10,.06,.02)*smoothstep(.7,1.,v)*.6;',
    '    float crk=abs(P.x-(408.+14.*sin(P.y*.08)+6.*vn(vec2(P.y*.2,1.))))-.9;',
    '    c*=1.-.40*smoothstep(1.4,0.,crk)*step(yt1+6.,P.y)*step(P.y,yb-38.);',
    '  }',
    '  return c;}',
    'vec4 boulder(vec2 P){',
    '  float a=P.x-BCX,b=P.y-BCY; float A=1.+TILT*TILT,B=-2.*(b*TILT+BCZ),C=b*b+BCZ*BCZ-BR*BR+a*a; float D=B*B-4.*A*C;',
    '  if(D<=0.)return vec4(0.);',
    '  float z=(-B+sqrt(D))/(2.*A); vec3 W=vec3(P.x,P.y-TILT*z,z); if(W.y>YG)return vec4(0.);',
    '  vec3 n=(W-vec3(BCX,BCY,BCZ))/BR; float dif=max(dot(n,SUN),0.);',
    '  vec3 c=mix(vec3(.22,.11,.08),vec3(.58,.34,.17),smoothstep(0.,.35,dif)); c=mix(c,vec3(.92,.64,.33),smoothstep(.35,.9,dif));',
    '  c*=.9+.15*fbm(W.xz*.05+W.y*.03); c*=1.-.35*smoothstep(YG-22.,YG,W.y);',
    '  return vec4(c,smoothstep(0.,BR*6.,D/(4.*A)));}',
    'void main(){',
    '  vec2 P=vec2(vUv.x,1.-vUv.y)*vec2(1280.,800.);',
    '  vec3 c;',
    '  if(P.y<HOR+.5){ c=sky(P); float ft=farTop(P.x); float fc=smoothstep(ft-.8,ft+.8,P.y);',
    '    vec3 hz=mix(vec3(.52,.44,.46),vec3(.66,.55,.47),smoothstep(ft,HOR,P.y)); hz+=vec3(.14,.09,.03)*smoothstep(ft+3.,ft,P.y);',
    '    c=mix(c,hz,fc*.85); }',
    '  else if(P.y<SEA1) c=sea(P); else c=plain(P);',
    '  float ct=cliffY(P.x); if(ct<1e3){ float cc=smoothstep(ct-.8,ct+.8,P.y)*smoothstep(SEA1+4.,SEA1+1.,P.y); if(cc>0.)c=mix(c,cliff(P,ct),cc); }',
    '  for(int i=0;i<2;i++){ float sy=YG+TILT*POSTS[i].y; float d=sdSeg(P,vec2(POSTS[i].x,sy),vec2(POSTS[i].x,sy-POSTS[i].z))-POSTS[i].w;',
    '    c=mix(c,vec3(.18,.11,.08),smoothstep(.7,-.7,d)); }',
    '  vec4 tr=tree(P); c=mix(c,tr.rgb,tr.a);',
    '  float lc=0.; vec3 lcol=ledge(P,lc); c=mix(c,lcol,lc);',
    '  vec4 bo=boulder(P); c=mix(c,bo.rgb,bo.a);',
    '  float fg=max(max(tr.a,lc),bo.a);',   // alpha = foreground (the far elephants walk behind these)
    '  vec2 v=(P/vec2(1280.,800.)-.5)*vec2(1.,.82); c*=1.-.32*pow(clamp(length(v)*1.35,0.,1.),2.6);',
    '  c+=(h21(P*1.37)-.5)/255.;',
    '  o=vec4(c,fg);}'].join('\n');

  // One step of the melt: heat makes the paint flow down in drips; cool paint slowly pulls back into place.
  // r,g = displacement (window units: the paint seen here came from here minus this), b = flow speed (window heights / s), a = gloss
  var FS_MELT = HEAD + [
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uPrev,uHeat; uniform float uDt,uRelaxDt,uTime,uGain,uHeal;',
    'float h1(float x){return fract(sin(x*127.1)*43758.5453);}',
    'float n1(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(h1(i),h1(i+1.),f);}',
    'void main(){',
    '  float h=texture(uHeat,vec2(vUv.x,1.-vUv.y)).r*2.;',
    '  vec4 c=texture(uPrev,vUv);',
    '  float xp=vUv.x*1280.;',
    '  float n=n1(xp/72.+7.3+uTime*.004)*.72+n1(xp/31.+1.7)*.28;',   // bold drips, a hand-width apart
    '  float dn=pow(smoothstep(.40,.90,n),1.5);',             // 1 = a drip column (runs fast and far), 0 = the curtain between drips
    '  float gy=mix(.37,.25,smoothstep(.62,.78,vUv.x));',   // the open sky stays put: only the horizon band, the cliffs and the plain melt
    '  float hot=smoothstep(.22,1.25,h)*smoothstep(gy-.06,gy+.03,1.-vUv.y);',   // paint flows only where heat has built up (linger to melt)   // the high sky stays put: the horizon, cliffs and plain melt
    '  float cap=(.04+.17*dn)*hot, room=clamp(1.-c.y/max(cap,1e-4),0.,1.);',  // hotter paint sags further before it stops
    '  float src=uGain*.30*hot*(.16+2.7*dn)*room;',
    '  float Fo=max(c.z,src);',
    '  vec4 a=texture(uPrev,vUv+vec2(0.,Fo*uDt));',          // what was just above, carried down with the flow
    '  float F=max(src,a.z*exp(-uDt/1.1)*room);',
    '  vec2 D=a.xy+vec2(0.,F*uDt);',
    '  float cold=1.-smoothstep(.06,.35,h);',
    '  D*=exp(-uRelaxDt*cold/uHeal); D.y=max(0.,D.y-uRelaxDt*cold*.0009);',
    '  D.y=min(D.y,.34); D.x=0.;',
    '  float W=max(a.w*exp(-uDt/7.),smoothstep(.01,.12,F));',
    '  if(uDt<=0.){D=c.xy;F=c.z;W=c.w;}',
    '  o=vec4(D,F,W);}'].join('\n');

  // The painting seen through the melt, with its living details (clouds, the sea, the elephants), the wax and the heat shimmer.
  var FS_COMP = HEAD + '%DEFS%' + NOISE + [
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uPaint,uMelt,uHeat; uniform float uTime; uniform vec4 uEle[2];',
    'float eleph(vec2 q,float ph){',   // a spindly-legged elephant carrying an obelisk; q in px, feet on y=0, y up
    '  float bob=sin(ph*2.)*1.1; vec2 bc=vec2(0.,114.+bob); float d=sdEll(q-bc,vec2(25.,11.5));',
    '  d=min(d,length(q-bc-vec2(24.,3.))-8.); d=min(d,sdEll(q-bc-vec2(17.,3.),vec2(4.5,7.5)));',
    '  vec2 t0=bc+vec2(30.,-1.),t1=bc+vec2(35.+sin(ph)*1.5,-13.),t2=bc+vec2(41.+sin(ph+1.)*2.,-9.);',
    '  d=min(d,sdSeg(q,t0,t1)-2.1); d=min(d,sdSeg(q,t1,t2)-1.4); d=min(d,sdSeg(q,bc+vec2(29.,-3.),bc+vec2(36.,-5.))-.8);',
    '  d=min(d,sdBox(q-bc-vec2(-2.,12.),vec2(10.,2.2)));',
    '  vec2 ob=q-bc-vec2(-2.,14.); float oh=clamp(ob.y/52.,0.,1.); d=min(d,max(abs(ob.x)-mix(4.,.5,oh),abs(ob.y-26.)-26.));',
    '  for(int i=0;i<4;i++){ float fx=(i<2?15.:-15.)+((i==0||i==2)?2.:-2.); float sp=ph+((i==1||i==2)?3.1416:0.);',
    '    vec2 hip=bc+vec2(fx,-7.), foot=vec2(fx+sin(sp)*9.,max(0.,cos(sp))*2.5), knee=mix(hip,foot,.5)+vec2(sin(sp)*2.,0.);',
    '    d=min(d,sdSeg(q,hip,knee)-1.2); d=min(d,sdSeg(q,knee,foot)-.85); }',
    '  d=min(d,sdSeg(q,bc+vec2(-24.,2.),bc+vec2(-28.,-12.))-.7);',
    '  return d;}',
    'vec3 live(vec3 c,vec2 P,float fg){',
    '  if(P.y<HOR){ float band=exp(-sqr((P.y-128.)/26.))+.7*exp(-sqr((P.y-212.)/14.));',   // two slow, flat dusk clouds
    '    float n=fbm(vec2(P.x*.0042-uTime*.0021,P.y*.028)); float cl=band*smoothstep(.50,.78,n);',
    '    c=mix(c,mix(vec3(.50,.50,.56),vec3(.86,.66,.46),smoothstep(.0,1.,(P.y-110.)/120.)),cl*.40); }',
    '  else if(P.y<SEA1){ float s=(P.y-HOR)/(SEA1-HOR); float g=vn(vec2(P.x*.035+uTime*.11,P.y*.9))*vn(vec2(P.x*.012-uTime*.05,P.y*.45+uTime*.03));',
    '    c+=vec3(.30,.22,.10)*smoothstep(.55,.85,g)*(1.-s)*(.4+.6*exp(-sqr((P.x-330.)/240.))); }',
    '  for(int i=0;i<2;i++){ vec4 e=uEle[i]; float fy=452.-float(i)*7.; vec2 q=vec2((P.x-e.x)*e.w,fy-P.y)/e.z;',
    '    if(q.x>-60.&&q.x<70.&&q.y>-4.&&q.y<190.){ float d=eleph(q,e.y)*e.z; c=mix(c,vec3(.15,.085,.07),smoothstep(.7,-.7,d)*(1.-fg)); }',
    '    float gy=fy-P.y; if(P.y>SEA1&&gy>-3.&&gy<40.){ float fh=gy/.21; vec2 sq=vec2(((P.x-e.x)-fh*2.0*e.z)*e.w,fh)/e.z;',   // its long shadow
    '      if(sq.x>-60.&&sq.x<70.&&sq.y>-4.&&sq.y<190.){ float d=eleph(sq,e.y)*e.z; c*=1.-.40*smoothstep(2.5,-2.5,d)*(1.-fg); } } }',
    '  return c;}',
    'void main(){',
    '  vec2 w=vec2(vUv.x,1.-vUv.y);',
    '  vec4 m=texture(uMelt,vUv); float h=texture(uHeat,vec2(vUv.x,1.-vUv.y)).r*2.;',
    '  vec2 S=w-m.xy;',
    '  S=clamp(S,vec2(.0004),vec2(.9996));',
    '  vec4 pc=texture(uPaint,vec2(S.x,1.-S.y)); vec3 c=pc.rgb;',
    '  c=live(c,S*vec2(1280.,800.),pc.a);',
    '  vec2 ex=vec2(1./float(' + MW + '),0.),ey=vec2(0.,1./float(' + MH + '));',
    '  float dL=texture(uMelt,vUv-ex).y,dR=texture(uMelt,vUv+ex).y,dU=texture(uMelt,vUv+ey).y,dB=texture(uMelt,vUv-ey).y;',
    '  float sx=(dR-dL)*800./(2.*ex.x*1280.), sy=(dB-dU)/(2.*ey.y);',
    '  float gy=mix(.37,.25,smoothstep(.62,.78,w.x)); float hw=smoothstep(.08,.85,h)*smoothstep(gy-.06,gy+.03,w.y);',
    '  float melt=smoothstep(.003,.03,m.y);',   // only paint that has really moved turns to wax: hard edges, no haze
    '  vec3 n=normalize(vec3(-sx*1.0,-sy*.6,1.)); vec3 L=normalize(vec3(-.55,-.62,.56));',
    '  float dif=dot(n,L)-L.z; float sp=pow(max(dot(n,normalize(L+vec3(0.,0.,1.))),0.),22.);',
    '  vec3 wax=mix(c,vec3(.82,.52,.22),.24)*vec3(1.08,.98,.84)+vec3(.035,.018,0.);',   // melted paint turns to warm amber wax
    '  wax*=clamp(1.+1.25*dif,.58,1.32);',
    '  c=mix(c,wax,melt);',
    '  c+=vec3(1.,.84,.56)*sp*(.35+.85*m.w)*melt*.75;',   // glossy highlights on the moving wax
    '  c*=1.+.08*m.w*melt;',
    '  c*=mix(vec3(1.),vec3(1.07,.99,.88),hw*.6);',   // warmth near you: a gentle golden tint, never a fog
    '  o=vec4(c,1.);}'].join('\n');

  // Last: your shadow. Inside a person the picture dims (INSIDE); your long Dalí shadow lies across the plain (multiplied on top).
  var SHX = 0.36, SHY = 0.44;      // the long shadow: for each unit of your height it runs this far right and this far up the plain
  var FS_SHADE = HEAD + '%DEFS%' + [
    'in vec2 vUv; out vec4 o;',
    'uniform sampler2D uMask,uLabel; uniform mat3 uHinv; uniform float uInside,uShadow; uniform vec4 uPer[3];',
    'float maskAt(vec2 w,out float lab){ vec3 h=uHinv*vec3(w,1.); vec2 k=h.xy/max(h.z,1e-6);',
    '  float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.; k=clamp(k,0.,1.);',
    '  lab=floor(texture(uLabel,k).r*255.+.5); return texture(uMask,k).r*inK; }',
    'void main(){',
    '  vec2 w=vec2(vUv.x,1.-vUv.y); float lab; float m=maskAt(w,lab);',
    '  float f=mix(1.,uInside,smoothstep(.3,.7,m));',
    '  float sh=0.;',
    '  for(int i=0;i<3;i++){ vec4 p=uPer[i]; if(p.z<=0.)continue;',
    '    vec2 d=w-p.xy; float fh=-d.y/' + fl(SHY) + '; if(fh<=0.)continue;',
    '    vec2 q=p.xy+vec2(d.x-fh*' + fl(SHX) + ',-fh); float l2; float mm=maskAt(q,l2)*((abs(l2-p.w)<.5||l2<.5)?1.:0.);',
    '    sh=max(sh,mm*p.z*(1.-.5*smoothstep(0.,.9,fh))); }',
    '  sh*=smoothstep(SEA1/800.,SEA1/800.+.025,w.y)*uShadow;',
    '  o=vec4(f*mix(vec3(1.),vec3(.40,.34,.45),sh),1.);}'].join('\n');

  // ---------------------------------------------------------------- the soft watches (cloth) and the small things (ants, crowns, glints)
  var NR = 5, NS = 20, NP = 1 + NR * NS, MAXW = 8;     // a watch: a centre and 5 rings of 20 cloth points; at most 8 watches
  var VS_WATCH = HEAD + [
    'in vec3 aPos; in vec3 aNor; in vec3 aUv;',
    'uniform sampler2D uMelt; uniform float uFollow[' + MAXW + '];',
    'out vec2 vUv; out vec3 vNor; out vec2 vScr; flat out int vI;',
    'void main(){ int i=int(aUv.z+.5); vec2 w=aPos.xy/vec2(1280.,800.);',
    '  vec4 m=textureLod(uMelt,vec2(w.x,1.-w.y),0.); w+=m.xy*uFollow[i];',
    '  vUv=aUv.xy; vNor=aNor; vI=i; vScr=w;',
    '  gl_Position=vec4(w.x*2.-1.,1.-w.y*2.,clamp(-aPos.z/1400.,-.99,.99),1.); }'].join('\n');
  var FS_WATCH = HEAD + NOISE + [
    'in vec2 vUv; in vec3 vNor; in vec2 vScr; flat in int vI; out vec4 o;',
    'uniform vec4 uHandA[' + MAXW + ']; uniform vec4 uLook[' + MAXW + ']; uniform float uShadowPass;',
    'const int NUM[13]=int[13](0,1,5,21,85,2,6,22,86,13,3,7,23);',   // Roman numerals as glyph lists (I=1, V=2, X=3)
    'float glyph(vec2 q,int g,float gw,float gh){',
    '  if(g==1)return sdSeg(q,vec2(0.,-gh*.5),vec2(0.,gh*.5));',
    '  if(g==2)return min(sdSeg(q,vec2(-gw*.5,gh*.5),vec2(0.,-gh*.5)),sdSeg(q,vec2(gw*.5,gh*.5),vec2(0.,-gh*.5)));',
    '  return min(sdSeg(q,vec2(-gw*.5,gh*.5),vec2(gw*.5,-gh*.5)),sdSeg(q,vec2(gw*.5,gh*.5),vec2(-gw*.5,-gh*.5)));}',
    'float numeral(vec2 p,float th,float st){',   // the hour numeral nearest this point, upright along the radius
    '  float k=floor(th/.5236+.5); float tk=k*.5236; int hn=int(mod(k+12.,12.)); if(hn==0)hn=12;',
    '  vec2 rd=vec2(sin(tk),-cos(tk)); vec2 d0=p-rd*.66; vec2 q=vec2(d0.x,-d0.y/(1.+st));',   // upright numerals, easy to read
    '  int code=NUM[hn]; float wsum=0.; for(int i=0;i<4;i++){int g=(code>>(2*i))&3; if(g==0)break; wsum+=(g==1?.034:.074)+.014;}',
    '  float cur=-wsum*.5+.007, d=1e3;',
    '  for(int i=0;i<4;i++){int g=(code>>(2*i))&3; if(g==0)break; float gw=(g==1?.034:.074); d=min(d,glyph(q-vec2(cur+gw*.5,0.),g,gw,.115)); cur+=gw+.014;}',
    '  return d-.0115;}',
    'float hand(vec2 p,float a,float len,float w0,float tail){ vec2 dr=vec2(sin(a),-cos(a)); float t=clamp((dot(p,dr)+tail)/(len+tail),0.,1.);',
    '  float r=mix(w0,w0*.25,t)*(1.+.9*smoothstep(.0,.2,t)*smoothstep(.55,.2,t)); return length(p-dr*(t*(len+tail)-tail))-r; }',
    'void main(){',
    '  vec4 H=uHandA[vI], K=uLook[vI]; float rho=length(vUv);',
    '  float aa=fwidth(rho)*1.2+1e-4; float edge=smoothstep(.995,.995-aa,rho);',
    '  if(uShadowPass>.5){ o=vec4(.05,.02,.03,edge*K.y*clamp(vNor.x,0.,1.)); return; }',
    '  vec3 n=normalize(vNor); vec3 V=normalize(vec3(0.,-.3,1.)); bool back=dot(n,V)<0.; if(back)n=-n;',
    '  vec3 L=normalize(vec3(-.62,-.55,.56)); float dif=max(dot(n,L),0.); float sp=pow(max(dot(n,normalize(L+V)),0.),36.);',
    '  float lam=.40+.70*dif;',
    '  float th=atan(vUv.x,-vUv.y); vec3 c;',
    '  vec3 gold=vec3(.80,.57,.22), rimc=gold*(.45+.9*dif)+vec3(1.,.86,.55)*sp*.9;',
    '  rimc*=1.-.25*smoothstep(.02,0.,abs(rho-.915));',
    '  if(back){ c=vec3(.58,.42,.19)*lam*(.9+.1*sin(rho*90.))+vec3(1.,.85,.5)*sp*.6; c=mix(c,rimc,smoothstep(.86,.87,rho)); }',
    '  else if(K.x>.5){',   // the closed orange watch (its lid), the ants\' watch
    '    vec3 lid=vec3(.86,.42,.12)*(.92+.08*sin(rho*70.))*(1.-.18*smoothstep(.0,.25,abs(sin(th*24.+rho*9.)))*smoothstep(.75,.2,rho));',
    '    lid=lid*lam+vec3(1.,.8,.5)*sp*.5; lid*=1.-.35*smoothstep(.10,.08,abs(rho-.80))*0.;',
    '    lid=mix(lid,vec3(.30,.13,.04),smoothstep(.012,.0,abs(rho-.80)-.004)*.6);',
    '    lid=mix(lid,gold*lam*1.1+vec3(1.,.85,.5)*sp,smoothstep(.12,.10,rho));',
    '    c=mix(lid,rimc,smoothstep(.86,.875,rho));',
    '  } else {',   // an open watch: pale enamel, Roman numerals, real-time hands
    '    vec3 dial=vec3(.67,.69,.66)*(.94+.06*vn(vUv*6.))*mix(1.,.86,rho*rho);',
    '    float st=K.w;',
    '    float tick=abs(fract(th/.10472+.5)-.5)*.10472*rho; float trk=step(.79,rho)*step(rho,.845);',
    '    float tk5=abs(fract(th/.5236+.5)-.5)*.5236*rho;',
    '    float ink=smoothstep(.006,.0,tick-.0025)*trk;',
    '    ink=max(ink,smoothstep(.01,.0,tk5-.006)*step(.76-st*.35,rho)*step(rho,.85));',
    '    ink=max(ink,smoothstep(.006,0.,abs(rho-.845)-.003)); ink=max(ink,smoothstep(.006,0.,abs(rho-.79)-.002));',
    '    float nd=numeral(vUv,th,st); ink=max(ink,smoothstep(.008,-.004,nd)*step(rho,.78));',
    '    vec3 col=mix(dial,vec3(.08,.06,.05),ink);',
    '    float sm=K.z;',   // hands, smeared when time whirls
    '    for(int g=0;g<4;g++){ float fg=float(g); float wt=g==0?1.:.38*(1.-fg/4.)*step(.02,sm);',
    '      float dh=hand(vUv,H.x-fg*sm*.35,.44,.042,.06), dm=hand(vUv,H.y-fg*sm*.6,.66,.032,.08);',
    '      float sh=hand(vUv-vec2(.025,.035),H.x,.44,.042,.06); sh=min(sh,hand(vUv-vec2(.025,.035),H.y,.66,.032,.08));',
    '      if(g==0)col=mix(col,col*.72,smoothstep(.02,-.01,sh));',
    '      col=mix(col,vec3(.07,.05,.04),wt*smoothstep(.006,-.006,min(dh,dm))); }',
    '    float ds=hand(vUv,H.z,.74,.010,.16); col=mix(col,vec3(.55,.08,.05),smoothstep(.006,-.006,ds));',
    '    col=mix(col,gold*1.1,smoothstep(.006,-.006,rho-.045));',
    '    col=col*lam+vec3(1.,.93,.8)*sp*.35;',
    '    col+=vec3(.20,.18,.12)*smoothstep(.9,.0,length(vUv-vec2(-.35,-.4)))*.25*dif;',   // a soft glass glint
    '    c=mix(col,rimc,smoothstep(.855,.87,rho));',
    '    c*=1.-.35*smoothstep(.02,.0,abs(rho-.86));',
    '  }',
    '  o=vec4(c,edge*K.y);}'].join('\n');
  // projected shadows of the watches use the same mesh with a flat shader pass (uShadowPass), positions supplied separately
  var VS_SPRITE = HEAD + [
    'in vec4 aI0; in vec4 aI1;',   // x, y (px), angle, size | kind, alpha, phase, follow
    'uniform sampler2D uMelt; out vec2 vQ; flat out vec4 vK;',
    'const vec2 CO[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(1.,1.),vec2(-1.,-1.),vec2(1.,1.),vec2(-1.,1.));',
    'void main(){ vec2 c=CO[gl_VertexID]; float ca=cos(aI0.z),sa=sin(aI0.z);',
    '  vec2 s=aI0.xy+mat2(ca,sa,-sa,ca)*(c*aI0.w); vec2 w=s/vec2(1280.,800.);',
    '  vec4 m=textureLod(uMelt,vec2(w.x,1.-w.y),0.); w+=m.xy*aI1.w;',
    '  vQ=c; vK=aI1; gl_Position=vec4(w.x*2.-1.,1.-w.y*2.,0.,1.); }'].join('\n');
  var FS_SPRITE = HEAD + NOISE + [
    'in vec2 vQ; flat in vec4 vK; out vec4 o;',
    'void main(){ vec2 q=vQ; float k=vK.x, ph=vK.z; float d; vec3 c;',
    '  if(k<.5){',   // an ant: abdomen, waist, head, six legs walking, antennae
    '    d=sdEll(q-vec2(-.42,0.),vec2(.38,.25)); d=min(d,sdEll(q-vec2(.06,0.),vec2(.19,.12))); d=min(d,length(q-vec2(.42,0.))-.14);',
    '    for(int i=0;i<3;i++){ float fi=float(i)-1.; float sw=sin(ph+fi*2.1)*.16;',
    '      d=min(d,sdSeg(q,vec2(.06+fi*.08,0.),vec2(.06+fi*.32+sw,.62))-.035); d=min(d,sdSeg(q,vec2(.06+fi*.08,0.),vec2(.06+fi*.32-sw,-.62))-.035); }',
    '    d=min(d,sdSeg(q,vec2(.5,.06),vec2(.82,.34))-.025); d=min(d,sdSeg(q,vec2(.5,-.06),vec2(.82,-.34))-.025);',
    '    c=vec3(.05,.03,.02)+vec3(.25,.18,.12)*smoothstep(.12,0.,length(q-vec2(-.5,.1)));',
    '  } else if(k<1.5){',   // the crown of a watch
    '    d=sdBox(q-vec2(0.,-.15),vec2(.42,.38))-.12; d=min(d,abs(length(q-vec2(0.,.55))-.30)-.09);',
    '    c=vec3(.80,.57,.22)*(.7+.5*smoothstep(-.6,.6,-q.x-q.y))+vec3(.3,.25,.1)*step(.5,fract(q.x*4.))*step(q.y,.2);',
    '  } else {',   // a glint where a new watch is forming
    '    float r=length(q); float s=exp(-r*7.)+.6*exp(-abs(q.x)*22.)*exp(-abs(q.y)*2.5)+.6*exp(-abs(q.y)*22.)*exp(-abs(q.x)*2.5);',
    '    o=vec4(vec3(1.,.82,.45)*s*vK.y*1.4,s*vK.y); return; }',
    '  float a=smoothstep(fwidth(d),-fwidth(d),d);',
    '  o=vec4(c,a*vK.y);}'].join('\n');

  // ---------------------------------------------------------------- the piece
  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('dalimelt needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: true, depth: true, stencil: true, preserveDrawingBuffer: false});
    if (!gl) throw new Error('dalimelt needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('dalimelt needs EXT_color_buffer_float');
    var floatLin = !!gl.getExtension('OES_texture_float_linear');
    var made = [], sized = [], destroyed = false, t0 = performance.now();
    var settings = {melt: MELT, heal: HEAL_S, soft: SOFT, warp: WARP, inside: INSIDE};
    var RANGES = {melt: [0.2, 2.5], heal: [6, 90], soft: [0.3, 1.8], warp: [0, 2.5], inside: [0, 1]};

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    function program(vsSrc, fsSrc) {
      var p = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, vsSrc.replace('%DEFS%', defs())), fs = shader(gl.FRAGMENT_SHADER, fsSrc.replace('%DEFS%', defs()));
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(e); }
      made.push(['Program', p]);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    function texture(w, h, ifmt, fmt, type, filter, list, data) {
      var t = gl.createTexture(); list.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function target(t, list) {
      var f = gl.createFramebuffer(); list.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('dalimelt: framebuffer incomplete');
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    }

    var P = {bake: program(VS_FULL, FS_BAKE), melt: program(VS_FULL, FS_MELT), comp: program(VS_FULL, FS_COMP), shade: program(VS_FULL, FS_SHADE)};
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    // melt field (ping-pong). 32-bit floats when they filter (a slow re-solidify needs the precision), else 16-bit with batched relaxing
    var MF = floatLin ? gl.RGBA32F : gl.RGBA16F, MT = floatLin ? gl.FLOAT : gl.HALF_FLOAT;
    var mTex = [texture(MW, MH, MF, gl.RGBA, MT, gl.LINEAR, made), texture(MW, MH, MF, gl.RGBA, MT, gl.LINEAR, made)];
    var mFb = [target(mTex[0], made), target(mTex[1], made)], mCur = 0, relaxEvery = floatLin ? 1 : 8, relaxAcc = 0;
    // heat (CPU, uploaded each frame), body mask and labels (Kinect space)
    var heat = new Float32Array(HW * HH), heatTmp = new Float32Array(HW * HH), heat8 = new Uint8Array(HW * HH);
    var heatTex = texture(HW, HH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, made, heat8);
    var BW = WallBody.w, BH = WallBody.h, BN = BW * BH, body = WallBody.create(kit, {});
    var mask8 = new Uint8Array(BN), lab8 = new Uint8Array(BN);
    var maskTex = texture(BW, BH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, made, mask8);
    var labTex = texture(BW, BH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.NEAREST, made, lab8);

    // the painting (sized with the canvas)
    var W = 0, H = 0, paintTex = null, paintFb = null;
    function alloc(w, h) {
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      W = Math.max(2, w); H = Math.max(2, h);
      paintTex = texture(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, sized); paintFb = target(paintTex, sized);
      gl.bindFramebuffer(gl.FRAMEBUFFER, paintFb); gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(P.bake.p); gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    alloc(canvas.width, canvas.height);

    // ---- registration tables: heat cell -> Kinect cell, Kinect cell -> window point (rebuilt every 2 s)
    var s2k = new Int32Array(HW * HH).fill(-1), k2s = new Float32Array(BN * 2).fill(NaN), regAt = -1e9, regOk = false;
    function buildReg(now) {
      if (now - regAt < (regOk ? 2000 : 500)) return;
      regAt = now;
      if (!kit.fromScreen(0.5, 0.5) || !kit.toScreen(256, 212)) { regOk = false; return; }
      for (var y = 0; y < HH; y++) for (var x = 0; x < HW; x++) {
        var k = kit.fromScreen((x + 0.5) / HW, (y + 0.5) / HH), c = y * HW + x;
        s2k[c] = (k && k[0] >= 0 && k[0] < 512 && k[1] >= 0 && k[1] < 424) ? ((k[1] / 4) | 0) * BW + ((k[0] / 4) | 0) : -1;
      }
      for (var j = 0; j < BN; j++) { var s = kit.toScreen((j % BW) * 4 + 2, ((j / BW) | 0) * 4 + 2); k2s[2 * j] = s ? s[0] : NaN; k2s[2 * j + 1] = s ? s[1] : NaN; }
      regOk = true;
    }

    // ---- people: my own tracking on top of body.people, with hysteresis on 'moving' (real Kinect stillness wobbles)
    var tracked = [], nextTrack = 1, actOfLabel = new Uint8Array(16), anyActive = false, pstat = [];
    // activity = NET change: the share of a person's cells that are clearly different from ~0.4 s ago. Kinect flicker comes back to
    // where it was (no net change); a waving arm or a step does not. Someone already standing there when the piece starts must move first.
    var HIST = 24, hist = [], histT = new Float64Array(HIST).fill(-1e9), histHead = -1, NET_LAG_MS = 400;
    for (var hq = 0; hq < HIST; hq++) hist.push(new Uint8Array(BN));
    function pushHist(tMs) { histHead = (histHead + 1) % HIST; var hb = hist[histHead], mk = body.mask; for (var i = 0; i < BN; i++) hb[i] = mk[i] >= 1 ? 255 : (mk[i] * 255) | 0; histT[histHead] = tMs; }
    function lagged(tMs) {   // the newest snapshot at least NET_LAG_MS old (else null: not enough history yet)
      var best = -1, bt = -1e9; for (var i = 0; i < HIST; i++) if (tMs - histT[i] >= NET_LAG_MS && histT[i] > bt) { bt = histT[i]; best = i; }
      return best < 0 ? null : hist[best];
    }
    function netMove(p, old) {
      if (!old) return 0;
      var x0 = Math.max(0, Math.floor(p.left * BW) - 3), x1 = Math.min(BW - 1, Math.ceil(p.right * BW) + 3), y0 = Math.max(0, Math.floor(p.top * BH) - 3), y1 = Math.min(BH - 1, Math.ceil(p.bottom * BH) + 3);
      var mk = body.mask, ch = 0;
      for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) { var c = y * BW + x, v = mk[c] >= 1 ? 255 : (mk[c] * 255) | 0; if (Math.abs(v - old[c]) > 127) ch++; }
      return ch / Math.max(30, p.area);
    }
    for (var pi = 0; pi < 8; pi++) pstat.push({n: 0, sx: 0, sy: 0, maxY: 0, minY: 1, rx: 0, ry: 0, rs: -1});
    function folkStats() {
      var ppl = body.people, lab = body.label, n = Math.min(ppl.length, 8), i, c, l;
      for (i = 0; i < n; i++) { var s = pstat[i]; s.n = 0; s.sx = 0; s.sy = 0; s.maxY = 0; s.minY = 1; s.rs = -1; s.minX = 1; s.maxX = 0; }
      for (c = 0; c < BN; c++) { l = lab[c]; if (l < 0 || l >= n) continue; var x = k2s[2 * c], y = k2s[2 * c + 1]; if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) continue;
        var st = pstat[l]; st.n++; st.sx += x; st.sy += y; if (y > st.maxY) st.maxY = y; if (y < st.minY) st.minY = y; if (x < st.minX) st.minX = x; if (x > st.maxX) st.maxX = x; }
      for (i = 0; i < n; i++) if (pstat[i].n) { pstat[i].sx /= pstat[i].n; pstat[i].sy /= pstat[i].n; }
      for (c = 0; c < BN; c++) { l = lab[c]; if (l < 0 || l >= n || !pstat[l].n) continue; var x2 = k2s[2 * c], y2 = k2s[2 * c + 1]; if (!(x2 >= 0 && x2 <= 1 && y2 >= 0 && y2 <= 1)) continue;
        var s2 = pstat[l], sc = Math.abs(x2 - s2.sx) * 1.6 + Math.max(0, s2.sy - y2);   // the reach: an arm out, or a hand up
        if (sc > s2.rs) { s2.rs = sc; s2.rx = x2; s2.ry = y2; } }
      return n;
    }
    function trackPeople(dtS, now, fresh) {
      var i, t;
      if (fresh) pushHist(body.frameMs);
      if (fresh && regOk) {
        var n = folkStats(), used = {}, old = lagged(body.frameMs);
        for (i = 0; i < 16; i++) actOfLabel[i] = 0;
        for (i = 0; i < n; i++) {
          var st = pstat[i]; if (st.n < 40) continue;   // fewer than 40 cells on the wall: noise, or someone off the picture
          var best = null, bd = 0.2;
          for (var q = 0; q < tracked.length; q++) { t = tracked[q]; if (used[t.key]) continue; var d = Math.hypot((t.cx - st.sx) * 1.6, t.cy - st.sy); if (d < bd) { bd = d; best = t; } }
          if (!best) { best = {key: nextTrack++, act: 0, active: false, movT: 0, stillT: 0, lastActive: -1e9, spawned: false, born: now}; tracked.push(best); }
          used[best.key] = true;
          best.cx = st.sx; best.cy = st.sy; best.top = st.minY; best.bottom = Math.min(1, st.maxY); best.left = st.minX; best.right = st.maxX; best.rx = st.rx; best.ry = st.ry; best.idx = i; best.lastSeen = now;
          var mv = netMove(body.people[i], old); best.net = mv;
          best.act += (mv - best.act) * (1 - Math.exp(-Math.max(0.001, dtS) / 0.2));
          if (best.act > ACT_ON) { best.movT += dtS; best.stillT = 0; if (best.movT > 0.15) { best.active = true; best.lastActive = now; best.spawned = false; } }
          else if (best.act < ACT_OFF) { best.movT = 0; best.stillT += dtS; if (best.stillT > 0.7) best.active = false; }
          else best.movT = Math.max(0, best.movT - dtS);
          if (best.ax === undefined || Math.abs(best.cx - best.ax) > 0.09) { best.ax = best.cx; best.actT = 0; }   // dwell: time spent moving in one place
          if (best.active) { best.lastActive = now; best.actT = Math.min(4, (best.actT || 0) + dtS); } else best.actT = Math.max(0, (best.actT || 0) - dtS * 0.5);
          actOfLabel[i] = best.active ? 1 : 0;
        }
        for (i = tracked.length - 1; i >= 0; i--) if (!used[tracked[i].key]) { tracked[i].idx = -1; if (now - tracked[i].lastSeen > 700) tracked.splice(i, 1); }
      } else if (!body.fresh) {
        for (i = 0; i < tracked.length; i++) { t = tracked[i]; t.idx = -1; t.act *= Math.exp(-dtS / 0.15); if (now - t.lastSeen > 300) t.active = false; }
        for (i = tracked.length - 1; i >= 0; i--) if (now - tracked[i].lastSeen > 700) tracked.splice(i, 1);
        for (i = 0; i < 16; i++) actOfLabel[i] = 0;
      }
      anyActive = false; for (i = 0; i < tracked.length; i++) if (tracked[i].active) anyActive = true;
    }

    // ---- hands: fingertips (kit.fingers), touches and wakes, matched frame to frame by distance (array order is not identity)
    var hands = [], touches = [], wakes = [], nextHand = 1;
    function handPoints() {
      var pts = [], f = kit.fingers, tn = Date.now(), i;
      if (f && Array.isArray(f.pts) && tn - f.t <= 150) for (i = 0; i < f.pts.length && i < 10; i++) { var p = f.pts[i]; if (p && isFinite(p[0]) && isFinite(p[1])) pts.push([p[0], p[1]]); }
      for (i = touches.length - 1; i >= 0; i--) { if (tn - touches[i].t > 250) { touches.splice(i, 1); continue; } addPt(pts, touches[i].x, touches[i].y); }
      for (i = wakes.length - 1; i >= 0; i--) { if (tn - wakes[i].t > 350) { wakes.splice(i, 1); continue; } addPt(pts, wakes[i].x, wakes[i].y); }
      return pts;
    }
    function addPt(pts, x, y) { for (var i = 0; i < pts.length; i++) if (Math.hypot((pts[i][0] - x) * 1.6, pts[i][1] - y) < 0.05) return; pts.push([x, y]); }
    function trackHands(dt, now) {
      var pts = handPoints(), used = [], i, j, h;
      for (i = 0; i < hands.length; i++) hands[i].hit = false;
      for (j = 0; j < pts.length; j++) {
        var best = null, bd = 0.12;
        for (i = 0; i < hands.length; i++) { h = hands[i]; if (h.hit) continue; var d = Math.hypot((h.x - pts[j][0]) * 1.6, h.y - pts[j][1]); if (d < bd) { bd = d; best = h; } }
        if (!best) { best = {id: nextHand++, x: pts[j][0], y: pts[j][1], sx: pts[j][0], sy: pts[j][1], vx: 0, vy: 0, t0: now, stillT: 0, ax: pts[j][0], ay: pts[j][1], grab: null, spawned: false}; hands.push(best); }
        best.x = pts[j][0]; best.y = pts[j][1]; best.hit = true; best.last = now;
      }
      for (i = hands.length - 1; i >= 0; i--) {
        h = hands[i];
        if (now - h.last > 280) { hands.splice(i, 1); continue; }
        var k = dt > 0 ? 1 - Math.exp(-dt / 0.05) : 0, ox = h.sx, oy = h.sy;
        h.sx += (h.x - h.sx) * k; h.sy += (h.y - h.sy) * k;
        if (dt > 0) { var vx = (h.sx - ox) / dt, vy = (h.sy - oy) / dt; h.vx += (vx - h.vx) * Math.min(1, dt / 0.08); h.vy += (vy - h.vy) * Math.min(1, dt / 0.08); }
        var sp = Math.hypot(h.vx * 1280, h.vy * 800);
        if (sp > 130 || Math.hypot((h.sx - h.ax) * 1280, (h.sy - h.ay) * 800) > 55) { h.stillT = 0; h.ax = h.sx; h.ay = h.sy; if (sp > 130) { h.spawned = false; h.noGrab = false; } }
        else if (sp < 70) h.stillT += dt;
      }
    }

    // ---- heat: bodies and hands write it, it rises and fades
    function splat(x, y, r, amt) {     // a soft round dab of heat (window coords, r in window widths)
      if (!(isFinite(x) && isFinite(y) && isFinite(r) && isFinite(amt))) return;   // a NaN here would stay in the heat field for good
      var cx = x * HW, cy = y * HH, rc = r * HW, r2 = rc * rc, R = Math.ceil(rc * 2.4);
      var x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(HW - 1, Math.ceil(cx + R)), y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(HH - 1, Math.ceil(cy + R));
      for (var yy = y0; yy <= y1; yy++) for (var xx = x0; xx <= x1; xx++) {
        var dx = xx + 0.5 - cx, dy = yy + 0.5 - cy, g = Math.exp(-(dx * dx + dy * dy) / (2 * r2 * 0.5));
        var c = yy * HW + xx; heat[c] = Math.min(2, heat[c] + amt * g);
      }
    }
    function splatE(x, y, rx, ry, amt) {   // a flat, wide dab (a pool on the ground)
      if (!(isFinite(x) && isFinite(y) && isFinite(rx) && isFinite(ry) && isFinite(amt))) return;
      var cx = x * HW, cy = y * HH, ax = rx * HW, ay = ry * HW, X0 = Math.max(0, Math.floor(cx - ax * 1.6)), X1 = Math.min(HW - 1, Math.ceil(cx + ax * 1.6)), Y0 = Math.max(0, Math.floor(cy - ay * 1.6)), Y1 = Math.min(HH - 1, Math.ceil(cy + ay * 1.6));
      for (var yy = Y0; yy <= Y1; yy++) for (var xx = X0; xx <= X1; xx++) { var dx = (xx + 0.5 - cx) / ax, dy = (yy + 0.5 - cy) / ay, g = Math.exp(-(dx * dx + dy * dy) * 1.2), c = yy * HW + xx; heat[c] = Math.min(2, heat[c] + amt * g); }
    }
    var heatSum = 0, heatMax = 0;
    var roomHeat={motion:0};
    function stepHeat(dt) {
      var i, x, y, c;
      if (dt > 0) {
        var dec = Math.exp(-dt / HEAT_TAU), rise = HEAT_RISE * dt * HH;
        for (y = 0; y < HH; y++) { var yy = y + rise, y0 = Math.min(HH - 1, Math.floor(yy)), y1 = Math.min(HH - 1, y0 + 1), f = yy - Math.floor(yy);
          for (x = 0; x < HW; x++) heatTmp[y * HW + x] = (heat[y0 * HW + x] * (1 - f) + heat[y1 * HW + x] * f) * dec; }
        for (y = 0; y < HH; y++) { var b = Math.min(0.48, dt * (8 + 26 * (1 - y / HH)));   // the plume spreads as it rises
          for (x = 0; x < HW; x++) { c = y * HW + x;
          var l = x > 0 ? heatTmp[c - 1] : heatTmp[c], r = x < HW - 1 ? heatTmp[c + 1] : heatTmp[c];
          heat[c] = heatTmp[c] * (1 - b) + (l + r) * 0.5 * b; } }
        // bodies: only moving people bring heat (a still person or a still object near the wall brings none)
        if (regOk && body.people.length) {
          var mo = body.motion, mk = body.mask, lb = body.label, sd = body.sdf, gate = anyActive ? 1 : 0;
          for (c = 0; c < HW * HH; c++) { var k = s2k[c]; if (k < 0) continue;
            var s = 0, mv = mo[k], l2 = lb[k];
            if (gate && mv > 0.1) s += (mv - 0.1) * MOTION_HEAT;
            if (l2 >= 0 && l2 < 16 && actOfLabel[l2]) s += mk[k] * PRESENCE_HEAT;
            else if (gate && sd[k] < 12) s += (1 - sd[k] / 12) * PRESENCE_HEAT * 0.6;   // the warm halo just outside a moving body
            if (s > 0) heat[c] = Math.min(2, heat[c] + s * dt); }
        }
        for (i = 0; i < tracked.length; i++) { var tp = tracked[i]; if (!tp.active || tp.idx < 0) continue;
          var prx = 0.07 + 0.13 * Math.min(1, (tp.actT || 0) / 2.5); splatE(tp.cx, Math.min(0.98, tp.bottom), prx, prx * 0.42, POOL_HEAT * dt); }
        for (i = 0; i < hands.length; i++) { var h = hands[i], sp = Math.hypot(h.vx * 1280, h.vy * 800);
          splat(h.sx, h.sy, HAND_RADIUS, HAND_HEAT * dt * (0.45 + 0.55 * Math.min(1, sp / 250))); }
      }
      heatSum = 0; heatMax = 0;
      for (c = 0; c < HW * HH; c++) { var v = heat[c];
        if(roomHeat.motion>0){v=Math.min(2,v+roomHeat.motion*dt*.55);heat[c]=v;}
        heatSum += v; if (v > heatMax) heatMax = v; heat8[c] = v >= 2 ? 255 : (v * 127.5) | 0; }
      gl.bindTexture(gl.TEXTURE_2D, heatTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HW, HH, gl.RED, gl.UNSIGNED_BYTE, heat8);
    }
    function heatAt(x, y) { var cx = Math.max(0, Math.min(HW - 1, (x * HW) | 0)), cy = Math.max(0, Math.min(HH - 1, (y * HH) | 0)); return heat[cy * HW + cx]; }

    // ---- melt simulation (fixed 60 Hz steps on the GPU)
    var simAcc = 0, simSteps = 0, elapsed = 0, frames = 0;
    function stepMelt() {
      var src = mCur, dst = 1 - mCur;
      relaxAcc++; var relax = relaxAcc >= relaxEvery; if (relax) relaxAcc = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, mFb[dst]); gl.viewport(0, 0, MW, MH);
      gl.useProgram(P.melt.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mTex[src]); gl.uniform1i(P.melt.u.uPrev, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, heatTex); gl.uniform1i(P.melt.u.uHeat, 1);
      gl.uniform1f(P.melt.u.uDt, 1 / 60); gl.uniform1f(P.melt.u.uRelaxDt, relax ? relaxEvery / 60 : 0); gl.uniform1f(P.melt.u.uTime, elapsed);
      gl.uniform1f(P.melt.u.uGain, settings.melt); gl.uniform1f(P.melt.u.uHeal, settings.heal);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      mCur = dst; simSteps++;
    }

    // ---- the elephants: two slow walkers on the far plain
    var ele = new Float32Array(8);
    function elephants() {
      var t = elapsed + 37;
      var x1 = ((t * 7.5 + 300) % 1700) - 200, x2 = 1500 - ((t * 5.2 + 900) % 1800);
      ele.set([x1, x1 * 0.16, 1.12, 1, x2, -x2 * 0.2, 0.9, -1]);
    }

    // ================================================================ the soft watches: Verlet cloth on a polar grid
    var GRAV = 900, ITERS = 3, TH = 3, FORM_S = 0.9, FADE_S = 2.4;   // cloth: gravity (px/s2), solver passes, thickness; forming and fading times
    function pidx(k, j) { return k === 0 ? 0 : 1 + (k - 1) * NS + ((j % NS) + NS) % NS; }
    var UVS = new Float32Array(NP * 2), ca = [], cb = [], ct = [];
    for (var k0 = 0; k0 <= NR; k0++) for (var j0 = 0; j0 < (k0 ? NS : 1); j0++) {
      var th0 = j0 * 2 * Math.PI / NS, rr0 = k0 / NR, id0 = pidx(k0, j0);
      UVS[id0 * 2] = rr0 * Math.sin(th0); UVS[id0 * 2 + 1] = -rr0 * Math.cos(th0);
    }
    function con(a, b, t) { ca.push(a); cb.push(b); ct.push(t); }
    for (var j1 = 0; j1 < NS; j1++) {
      con(0, pidx(1, j1), 0); con(0, pidx(2, j1), 2); con(pidx(1, j1), pidx(1, j1 + NS / 2), 2);
      for (var k1 = 1; k1 <= NR; k1++) {
        con(pidx(k1, j1), pidx(k1, j1 + 1), 0);
        if (k1 < NR) { con(pidx(k1, j1), pidx(k1 + 1, j1), 0); con(pidx(k1, j1), pidx(k1 + 1, j1 + 1), 1); con(pidx(k1, j1 + 1), pidx(k1 + 1, j1), 1); }
        if (k1 < NR - 1) con(pidx(k1, j1), pidx(k1 + 2, j1), 2);
        if (k1 >= 2) con(pidx(k1, j1), pidx(k1, j1 + 2), 2);
      }
    }
    var NC = ca.length, CA = new Int32Array(ca), CB = new Int32Array(cb), CT = new Uint8Array(ct), CL = new Float32Array(NC);
    for (var c0 = 0; c0 < NC; c0++) CL[c0] = Math.hypot(UVS[CA[c0] * 2] - UVS[CB[c0] * 2], UVS[CA[c0] * 2 + 1] - UVS[CB[c0] * 2 + 1]);
    var tris = [];
    for (var j2 = 0; j2 < NS; j2++) {
      tris.push(0, pidx(1, j2), pidx(1, j2 + 1));
      for (var k2 = 1; k2 < NR; k2++) { var a2 = pidx(k2, j2), b2 = pidx(k2 + 1, j2), c2 = pidx(k2 + 1, j2 + 1), d2 = pidx(k2, j2 + 1); tris.push(a2, b2, c2, a2, c2, d2); }
    }
    var NT = tris.length / 3;
    // colliders in world space (x right, y down, z toward you): the tree as capsules
    var CAPS = TREE.map(function (t) {
      return {ax: t[0], ay: t[1], az: t[2], bx: t[4], by: t[5], bz: t[6], ra: Math.max(t[3], 5) + 5, rb: Math.max(t[7], 5) + 5, dx: t[4] - t[0], dy: t[5] - t[1], dz: t[6] - t[2],
        l2: (t[4] - t[0]) * (t[4] - t[0]) + (t[5] - t[1]) * (t[5] - t[1]) + (t[6] - t[2]) * (t[6] - t[2]),
        x0: Math.min(t[0], t[4]) - t[3], x1: Math.max(t[0], t[4]) + t[3], y0: Math.min(t[1], t[5]) - t[3], y1: Math.max(t[1], t[5]) + t[3], z0: Math.min(t[2], t[6]) - t[3], z1: Math.max(t[2], t[6]) + t[3]};
    });

    // GL: one dynamic vertex buffer for the watches, one for their shadows, a static one for dial coordinates, one index buffer
    var wv = new Float32Array(MAXW * NP * 6), sv = new Float32Array(MAXW * NP * 6), ws = new Float32Array(MAXW * NP * 3), wi = new Uint16Array(MAXW * NT * 3);
    for (var s0 = 0; s0 < MAXW; s0++) {
      for (var p0 = 0; p0 < NP; p0++) { ws[(s0 * NP + p0) * 3] = UVS[p0 * 2]; ws[(s0 * NP + p0) * 3 + 1] = UVS[p0 * 2 + 1]; ws[(s0 * NP + p0) * 3 + 2] = s0; }
      for (var t0i = 0; t0i < NT * 3; t0i++) wi[s0 * NT * 3 + t0i] = s0 * NP + tris[t0i];
    }
    var PW = program(VS_WATCH, FS_WATCH), PS = program(VS_SPRITE, FS_SPRITE);
    function vbuf(data, usage) { var b = gl.createBuffer(); made.push(['Buffer', b]); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, usage); return b; }
    var bufW = vbuf(wv, gl.DYNAMIC_DRAW), bufS = vbuf(sv, gl.DYNAMIC_DRAW), bufUv = vbuf(ws, gl.STATIC_DRAW);
    var bufI = gl.createBuffer(); made.push(['Buffer', bufI]);
    function watchVao(posBuf) {
      var v = gl.createVertexArray(); made.push(['VertexArray', v]); gl.bindVertexArray(v);
      var lp = gl.getAttribLocation(PW.p, 'aPos'), ln = gl.getAttribLocation(PW.p, 'aNor'), lu = gl.getAttribLocation(PW.p, 'aUv');
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(lp); gl.vertexAttribPointer(lp, 3, gl.FLOAT, false, 24, 0);
      if (ln >= 0) { gl.enableVertexAttribArray(ln); gl.vertexAttribPointer(ln, 3, gl.FLOAT, false, 24, 12); }
      gl.bindBuffer(gl.ARRAY_BUFFER, bufUv); gl.enableVertexAttribArray(lu); gl.vertexAttribPointer(lu, 3, gl.FLOAT, false, 12, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufI);
      gl.bindVertexArray(null); return v;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufI); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wi, gl.STATIC_DRAW);
    var vaoW = watchVao(bufW), vaoS = watchVao(bufS);
    var MAXS = 80, spr = new Float32Array(MAXS * 8), nSpr = 0, bufSp = vbuf(spr, gl.DYNAMIC_DRAW);
    var vaoSp = gl.createVertexArray(); made.push(['VertexArray', vaoSp]); gl.bindVertexArray(vaoSp);
    [['aI0', 0], ['aI1', 16]].forEach(function (a) { var l = gl.getAttribLocation(PS.p, a[0]); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 4, gl.FLOAT, false, 32, a[1]); gl.vertexAttribDivisor(l, 1); });
    gl.bindVertexArray(null);
    var uHandA = new Float32Array(MAXW * 4), uLook = new Float32Array(MAXW * 4), uFollow = new Float32Array(MAXW);

    // ---- a watch
    var slots = [], clothSteps = 0, clothMs = 0, spawned = 0, kicks = 0;
    for (var s1 = 0; s1 < MAXW; s1++) slots.push(null);
    function frameAxes(kind) {
      return kind === 'flat' ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 0.6, 0.8]];   // flat: face up, 6 o'clock toward you; tilted: facing you, leaning back
    }
    function newWatch(slot, kind, R, cx, cy, cz, axes, home) {
      var w = {slot: slot, kind: kind, R: R, pos: new Float32Array(NP * 3), prev: new Float32Array(NP * 3), inv: new Float32Array(NP).fill(1),
        rest: new Float32Array(NC), home: home, homePos: null, state: 'live', t: 0, alpha: 1, lastTouch: performance.now(), born: 0,
        grabbed: 0, warp: 0, hOff: 0, mOff: 0, sOff: 0, follow: 1, cx: cx, cy: cy, cz: cz, axes: axes, scale: 1, bad: 0, contact: new Uint8Array(NP),
        sx: 0, sy: 0, speed: 0, hot: 0};
      for (var c = 0; c < NC; c++) w.rest[c] = CL[c] * R;
      placeDisc(w, 1);
      slots[slot] = w; return w;
    }
    function placeDisc(w, scale) {
      var ex = w.axes[0], ey = w.axes[1];
      for (var j = 0; j < NP; j++) {
        var u = UVS[j * 2] * w.R * scale, v = UVS[j * 2 + 1] * w.R * scale, o = j * 3;
        w.pos[o] = w.cx + u * ex[0] + v * ey[0]; w.pos[o + 1] = w.cy + u * ex[1] + v * ey[1]; w.pos[o + 2] = w.cz + u * ex[2] + v * ey[2];
        w.prev[o] = w.pos[o]; w.prev[o + 1] = w.pos[o + 1]; w.prev[o + 2] = w.pos[o + 2];
      }
    }
    var gx0, gx1, gy0, gy1, gz0, gz1, act = [];
    function collideAll(w) {
      var p = w.pos, j, o, x, y, z;
      gx0 = 1e9; gx1 = -1e9; gy0 = 1e9; gy1 = -1e9; gz0 = 1e9; gz1 = -1e9;
      for (j = 0; j < NP; j++) { o = j * 3; x = p[o]; y = p[o + 1]; z = p[o + 2];
        if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (y < gy0) gy0 = y; if (y > gy1) gy1 = y; if (z < gz0) gz0 = z; if (z > gz1) gz1 = z; }
      act.length = 0;
      for (var c = 0; c < CAPS.length; c++) { var cp = CAPS[c]; if (cp.x1 + 8 < gx0 || cp.x0 - 8 > gx1 || cp.y1 + 8 < gy0 || cp.y0 - 8 > gy1 || cp.z1 + 8 < gz0 || cp.z0 - 8 > gz1) continue; act.push(cp); }
      var nearBox = gx1 > SC.LX0 - 30 && gx0 < SC.LX1 + 30 && gy1 > SC.LY0 - 40;
      var nearBall = Math.abs((gx0 + gx1) / 2 - SC.BCX) < (gx1 - gx0) / 2 + SC.BR + 10 && gy1 > SC.BCY - SC.BR - 10;
      var qv = w.prev, MU = 0.55;
      for (j = 0; j < NP; j++) {
        o = j * 3; x = p[o]; y = p[o + 1]; z = p[o + 2]; var hit = 0, nx = 0, ny = 0, nz = 0;
        if (y > SC.YG - TH) { y = SC.YG - TH; hit = 1; ny = -1; }
        if (nearBox && x > SC.LX0 - 30 && x < SC.LX1 + 30) {
          if (y > SC.LY0 - 40 && z < SC.LZ0 + 12 && z > SC.LZ0 - 260) z = SC.LZ0 + 12;    // nothing hides behind the ledge
          if (x > SC.LX0 - TH && x < SC.LX1 + TH && y > SC.LY0 - TH && z > SC.LZ0 - TH && z < SC.LZ1 + TH) {
            var dT = y - (SC.LY0 - TH), dL = x - (SC.LX0 - TH), dR = (SC.LX1 + TH) - x, dF = (SC.LZ1 + TH) - z, m = Math.min(dT, dL, dR, dF);
            if (m === dT) { y = SC.LY0 - TH; ny = -1; } else if (m === dF) { z = SC.LZ1 + TH; nz = 1; } else if (m === dL) { x = SC.LX0 - TH; nx = -1; } else { x = SC.LX1 + TH; nx = 1; }
            hit = 1;
          }
        }
        if (nearBall) { var bx = x - SC.BCX, by = y - SC.BCY, bz = z - SC.BCZ, b2 = bx * bx + by * by + bz * bz, br = SC.BR + TH;
          if (b2 < br * br && b2 > 1e-6) { var bl = Math.sqrt(b2), bs = br / bl; x = SC.BCX + bx * bs; y = SC.BCY + by * bs; z = SC.BCZ + bz * bs; hit = 1; nx = bx / bl; ny = by / bl; nz = bz / bl; } }
        for (var q = 0; q < act.length; q++) { var cp2 = act[q];
          var t = ((x - cp2.ax) * cp2.dx + (y - cp2.ay) * cp2.dy + (z - cp2.az) * cp2.dz) / cp2.l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          var qx = x - cp2.ax - cp2.dx * t, qy = y - cp2.ay - cp2.dy * t, qz = z - cp2.az - cp2.dz * t, r = cp2.ra + (cp2.rb - cp2.ra) * t + TH, d2 = qx * qx + qy * qy + qz * qz;
          if (d2 < r * r && d2 > 1e-6) { var dd = Math.sqrt(d2), sc2 = r / dd; x = x - qx + qx * sc2; y = y - qy + qy * sc2; z = z - qz + qz * sc2; hit = 1; nx = qx / dd; ny = qy / dd; nz = qz / dd; } }
        if (x < 12) x = 12; else if (x > 1268) x = 1268;
        if (z < -260) z = -260; else if (z > 640) z = 640;
        if (y < -500) y = -500;
        if (hit) {   // friction: undo most of the sliding along the surface since the last step
          w.contact[j] = 1;
          var mx = x - qv[o], my = y - qv[o + 1], mz = z - qv[o + 2], mn = mx * nx + my * ny + mz * nz;
          x -= (mx - mn * nx) * MU; y -= (my - mn * ny) * MU; z -= (mz - mn * nz) * MU;
        }
        p[o] = x; p[o + 1] = y; p[o + 2] = z;
      }
    }
    function solve(w, kS, kH, kB) {
      var p = w.pos, rest = w.rest, inv = w.inv;
      for (var c = 0; c < NC; c++) {
        var a = CA[c], b = CB[c], wa = inv[a], wb = inv[b], wsum = wa + wb; if (wsum === 0) continue;
        var ia = a * 3, ib = b * 3, dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-6) continue;
        var t = CT[c], k = t === 0 ? kS : t === 1 ? kH : kB, f = (d - rest[c]) / d * k / wsum;
        p[ia] += dx * f * wa; p[ia + 1] += dy * f * wa; p[ia + 2] += dz * f * wa;
        p[ib] -= dx * f * wb; p[ib + 1] -= dy * f * wb; p[ib + 2] -= dz * f * wb;
      }
    }
    var grabT = [];   // per step: [watch, particle, tx, ty, tz, vx, vy]
    function stepWatch(w, dt, simT) {
      var p = w.pos, q = w.prev, j, o, g = GRAV * dt * dt;
      if (w.state === 'forming') {   // a new watch grows under the hand, held in place
        w.t += dt; var sc = 0.15 + 0.85 * Math.min(1, w.t / FORM_S); placeDisc(w, sc);
        for (var c3 = 0; c3 < NC; c3++) w.rest[c3] = CL[c3] * w.R * sc;
        if (w.t >= FORM_S) { w.state = 'live'; w.born = simT; }
        return;
      }
      var soft = settings.soft, hot = Math.min(1, w.hot), dying = w.state === 'dying';
      var damp = dying ? 0.96 : 0.993, windA = (dying ? 0 : 4) * dt * dt;
      for (j = 0; j < NP; j++) {
        o = j * 3; if (w.inv[j] === 0) continue;
        var vx = (p[o] - q[o]) * damp, vy = (p[o + 1] - q[o + 1]) * damp, vz = (p[o + 2] - q[o + 2]) * damp;
        var sp2 = vx * vx + vy * vy + vz * vz, lim = 22;   // never faster than 22 px per step (1300 px/s)
        if (sp2 > lim * lim) { var s3 = lim / Math.sqrt(sp2); vx *= s3; vy *= s3; vz *= s3; }
        q[o] = p[o]; q[o + 1] = p[o + 1]; q[o + 2] = p[o + 2];
        p[o] += vx + windA * Math.sin(simT * 0.7 + j * 0.13 + w.slot); p[o + 1] += vy + g * (dying ? 0.4 : 1); p[o + 2] += vz + windA * 0.6 * Math.sin(simT * 0.53 + j * 0.07);
        w.contact[j] = 0;
      }
      var kS = Math.max(0.35, Math.min(0.96, 0.92 - 0.22 * (soft - 1) - 0.35 * hot - (w.grabbed ? 0.25 : 0)));
      var kH = kS * 0.7, kB = Math.max(0.01, 0.10 / soft * (1 - 0.6 * hot)) * (dying ? 0.2 : 1);
      for (var it = 0; it < ITERS; it++) {
        solve(w, kS, kH, kB);
        for (var gi = 0; gi < grabT.length; gi++) { var gr = grabT[gi]; if (gr[0] !== w) continue; o = gr[1] * 3;
          p[o] += (gr[2] - p[o]) * 0.75; p[o + 1] += (gr[3] - p[o + 1]) * 0.75; p[o + 2] += (gr[4] - p[o + 2]) * 0.75; }
        if (w.snagOn && w.snag && !dying) for (var si = 0; si < w.snag.length; si++) { o = w.snag[si] * 3;
          p[o] += (w.homePos[o] - p[o]) * 0.2; p[o + 1] += (w.homePos[o + 1] - p[o + 1]) * 0.2; p[o + 2] += (w.homePos[o + 2] - p[o + 2]) * 0.2; }
        collideAll(w);
      }
      for (gi = 0; gi < grabT.length; gi++) { gr = grabT[gi]; if (gr[0] !== w) continue; o = gr[1] * 3;   // the held point carries the hand's speed (a fling)
        q[o] = p[o] - gr[5] * dt; q[o + 1] = p[o + 1] - gr[6] * dt; q[o + 2] = p[o + 2]; }
      for (j = 0; j < NP; j++) if (w.contact[j]) { o = j * 3;   // contact friction: drapes stay draped
        q[o] = p[o] - (p[o] - q[o]) * 0.35; q[o + 1] = p[o + 1] - (p[o + 1] - q[o + 1]) * 0.6; q[o + 2] = p[o + 2] - (p[o + 2] - q[o + 2]) * 0.35; }
      // taffy: pulled hard (held or hot), the cloth keeps some of the stretch, then slowly shrinks back
      var plastic = (w.grabbed || hot > 0.3) && !dying, rec = dt / 9;
      for (var c = 0; c < NC; c++) { if (CT[c] === 2) continue;
        var r0 = CL[c] * w.R;
        if (plastic) { var a = CA[c] * 3, b = CB[c] * 3, ddx = p[b] - p[a], ddy = p[b + 1] - p[a + 1], ddz = p[b + 2] - p[a + 2], dl = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
          if (dl > w.rest[c] * 1.25) w.rest[c] = Math.min(r0 * 2.6, w.rest[c] + (dl / 1.25 - w.rest[c]) * 0.06); }
        if (w.rest[c] !== r0) w.rest[c] += (r0 - w.rest[c]) * rec;
      }
      if (w.snagOn && w.snag) { if (w.grabbed) w.snagOn = false; else for (var sj = 0; sj < w.snag.length; sj++) { o = w.snag[sj] * 3;
        if (Math.abs(p[o] - w.homePos[o]) + Math.abs(p[o + 1] - w.homePos[o + 1]) + Math.abs(p[o + 2] - w.homePos[o + 2]) > 40) { w.snagOn = false; break; } } }
      var bad = false; for (j = 0; j < NP * 3; j++) if (!(p[j] === p[j])) { bad = true; break; }
      if (bad) { w.bad++; resetWatch(w); }
    }
    function resetWatch(w) {
      if (w.home && !w.homePos) { placeDisc(w, 1); return; }
      if (w.home && w.homePos) { w.pos.set(w.homePos); w.prev.set(w.homePos); for (var c = 0; c < NC; c++) w.rest[c] = CL[c] * w.R; w.snagOn = true; }
      else slots[w.slot] = null;
    }
    // the four watches that live here, settled once at startup (a deterministic resting picture to return to)
    var HOMES = [
      {kind: 0, R: 84, c: [598, 306, 4], axes: 'flat'},                        // over the branch
      {kind: 0, R: 88, c: [432, SC.LY0 - 10, SC.LZ1 - 16], axes: 'flat'},      // over the front edge of the ledge
      {kind: 1, R: 58, c: [222, SC.LY0 - 8, SC.LZ1 - 18], axes: 'flat'},       // the closed orange watch (the ants live on it)
      {kind: 0, R: 80, c: [SC.BCX + 6, SC.BCY - SC.BR - 18, SC.BCZ + 22], axes: 'flat'}];   // over the boulder
    HOMES.forEach(function (h, i) { newWatch(i, h.kind, h.R, h.c[0], h.c[1], h.c[2], frameAxes(h.axes), true); });
    (function settle() {
      for (var st = 0; st < 420; st++) for (var i = 0; i < HOMES.length; i++) stepWatch(slots[i], 1 / 60, st / 60);
      for (var k = 0; k < HOMES.length; k++) { var w = slots[k]; w.homePos = new Float32Array(w.pos); w.prev.set(w.pos);
        w.snag = []; for (var j = 0; j < NP; j++) if (w.contact[j]) w.snag.push(j); w.snagOn = true; }
    })();
    var antWatch = slots[2];

    function spawnWatch(sx, sy, now) {   // a new soft watch forms under a still hand (window coords)
      var free = -1, oldest = null;
      for (var i = HOMES.length; i < MAXW; i++) { if (!slots[i]) { free = i; break; } if (!oldest || slots[i].born < oldest.born) oldest = slots[i]; }
      if (free < 0) { if (oldest && oldest.state !== 'dying') { oldest.state = 'dying'; oldest.t = 0; } return false; }
      var X = sx * 1280, Y = Math.min(760, sy * 800 + 40), R = 64 + Math.random() * 12, z;
      if (X > SC.LX0 + 20 && X < SC.LX1 - 20 && Y < SC.LY0 + SC.TILT * SC.LZ1) z = 20;
      else if (X > 480 && X < 730 && Y < 335) z = 8;
      else if (Y > SC.YG) z = Math.max(90, Math.min(560, (Y + R * 0.4 - SC.YG) / SC.TILT));
      else z = 150;
      var w = newWatch(free, 0, R, X, Y - SC.TILT * z, z, frameAxes('tilt'), false);
      w.state = 'forming'; w.t = 0; w.born = elapsed; w.lastTouch = now; spawned++;
      return true;
    }
    function watchScreen(w) {   // centre of a watch on the wall (reference px)
      var o = 0; return [w.pos[o], w.pos[o + 1] + SC.TILT * w.pos[o + 2]];
    }

    // ---- hands meet watches: grab, drag, fling; a still hand grows a new watch
    function handsAndWatches(now) {
      grabT.length = 0;
      for (var i = 0; i < hands.length; i++) {
        var h = hands[i], hx = h.sx * 1280, hy = h.sy * 800;
        if (h.grab && (!slots[h.grab.w.slot] || slots[h.grab.w.slot] !== h.grab.w || h.grab.w.state !== 'live')) h.grab = null;
        if (!h.grab && !h.noGrab) {
          var best = null, bd = GRAB_R * GRAB_R;
          for (var s = 0; s < MAXW; s++) { var w = slots[s]; if (!w || w.state !== 'live') continue;
            for (var j = 0; j < NP; j++) { var o = j * 3, dx = w.pos[o] - hx, dy = w.pos[o + 1] + SC.TILT * w.pos[o + 2] - hy, d2 = dx * dx + dy * dy;
              if (d2 < bd) { bd = d2; best = {w: w, j: j}; } } }
          if (best) { h.grab = best; h.stillT = 0; }
          else if (h.stillT > 0.15) h.noGrab = true;   // a hand that settled on empty paint stays a heat source (and may grow a watch)
        }
        if (h.grab) {
          var gw = h.grab.w, z = gw.pos[h.grab.j * 3 + 2]; z += (Math.max(z, 40) - z) * 0.05;
          grabT.push([gw, h.grab.j, hx, hy - SC.TILT * z, z, h.vx * 1280, h.vy * 800]);
          gw.lastTouch = now;
        } else if (h.stillT > HOLD_TO_GROW_S && !h.spawned) { h.spawned = true; spawnWatch(h.sx, h.sy, now); }
      }
      for (var s2 = 0; s2 < MAXW; s2++) if (slots[s2]) slots[s2].grabbed = 0;
      for (i = 0; i < grabT.length; i++) grabT[i][0].grabbed++;
      for (var q = 0; q < tracked.length; q++) { var tp = tracked[q];   // a body alone: someone who moved, then holds still, grows one at their outstretched hand
        if (tp.idx < 0 || tp.active || tp.spawned || tp.stillT < BODY_HOLD_S || now - tp.lastActive > 10000 || !(tp.rx >= 0)) continue;
        tp.spawned = true; spawnWatch(tp.rx, Math.max(0.05, tp.ry - 0.02), now); }
    }
    // ---- moving bodies kick the watches they sweep through
    function bodyKick(w, dt) {
      if (!regOk || !body.people.length || !anyActive) return;
      var p = w.pos, mo = body.motion, mk = body.mask, lb = body.label, any = false;
      for (var j = 0; j < NP; j += 2) {
        var o = j * 3, X = p[o], Y = p[o + 1] + SC.TILT * p[o + 2];
        var cx = Math.max(0, Math.min(HW - 1, (X / 10) | 0)), cy = Math.max(0, Math.min(HH - 1, (Y / 10) | 0)), k = s2k[cy * HW + cx];
        if (k < 0 || mk[k] < 0.5 || mo[k] < 0.2) continue;
        var l = lb[k]; if (l < 0 || l > 15 || !actOfLabel[l]) continue;
        var tr = null; for (var q = 0; q < tracked.length; q++) if (tracked[q].idx === l) tr = tracked[q];
        if (!tr) continue;
        var dx = X / 1280 - tr.cx, dy = Y / 800 - tr.cy, dl = Math.hypot(dx * 1.6, dy) + 1e-3, a = KICK * mo[k] * dt * dt;
        p[o] += dx * 1.6 / dl * a; p[o + 1] += (dy / dl - 0.7) * a; p[o + 2] += a * 0.3; any = true;
      }
      if (any) { kicks++; w.lastTouch = performance.now(); }
    }
    // ---- time: real local time, whirled near movement
    function clockAngles(w, dt) {
      var d = new Date(), s = d.getSeconds(), ms = d.getMilliseconds() / 1000, m = d.getMinutes() + (s + ms) / 60, h = (d.getHours() % 12) + m / 60;
      var el = ms < 0.35 ? 1 - Math.exp(-ms * 18) * Math.cos(ms * 38) * (1 + w.warp * 2.5) : 1;   // the soft second hand overshoots each tick
      var spin = settings.warp * w.warp; if (spin < 0.15) spin = 0;
      w.mOff += dt * spin * 2 * Math.PI * 1.4; w.hOff += dt * spin * 2 * Math.PI * 0.35; w.sOff += dt * spin * 2 * Math.PI * 3.2;
      var k = 1 - Math.exp(-dt / 0.9);   // once the whirl dies down, each hand glides back to the real time
      if (spin === 0) ['mOff', 'hOff', 'sOff'].forEach(function (n) { var tgt = Math.round(w[n] / (2 * Math.PI)) * 2 * Math.PI; w[n] += (tgt - w[n]) * k; });
      return [h / 12 * 2 * Math.PI + w.hOff, m / 60 * 2 * Math.PI + w.mOff, (s + el) / 60 * 2 * Math.PI + w.sOff];
    }
    function motionNear(X, Y, R) {   // the most movement of a moving person within R px of a point
      if (!regOk || !body.people.length) return 0;
      var mx = 0, mo = body.motion;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var cx = Math.max(0, Math.min(HW - 1, ((X + dx * R) / 10) | 0)), cy = Math.max(0, Math.min(HH - 1, ((Y + dy * R) / 10) | 0)), k = s2k[cy * HW + cx];
        if (k >= 0 && mo[k] > mx) mx = mo[k];
      }
      return anyActive ? mx : 0;
    }
    // ---- one cloth tick for every watch (fixed 60 Hz), then the life cycle
    var clothAcc = 0, simTime = 0;
    function stepCloth(dt, now) {
      var t0c = performance.now();
      handsAndWatches(now);
      clothAcc += dt; var n = 0;
      while (clothAcc >= 1 / 60 && n < 3) {
        clothAcc -= 1 / 60; n++; simTime += 1 / 60;
        for (var s = 0; s < MAXW; s++) { var w = slots[s]; if (!w) continue; if (w.state !== 'forming') bodyKick(w, 1 / 60); stepWatch(w, 1 / 60, simTime); }
        clothSteps++;
      }
      if (n === 3) clothAcc = 0;
      for (var s2 = 0; s2 < MAXW; s2++) {
        var w2 = slots[s2]; if (!w2) continue;
        var cs = watchScreen(w2); w2.sx = cs[0]; w2.sy = cs[1];
        var o = 0, sp = Math.hypot(w2.pos[o] - w2.prev[o], w2.pos[o + 1] - w2.prev[o + 1], w2.pos[o + 2] - w2.prev[o + 2]) * 60;
        w2.speed += (sp - w2.speed) * Math.min(1, dt * 4);
        w2.hot = heatAt(cs[0] / 1280, cs[1] / 800);
        var wt = Math.min(1, Math.max(0, w2.hot - 0.6) * 0.5 + motionNear(cs[0], cs[1], w2.R * 1.3) * 2.4);   // movement nearby whirls time (strong heat a little)
        w2.warp += (wt - w2.warp) * (1 - Math.exp(-dt / (wt > w2.warp ? 0.25 : 2.0)));
        var ft = (w2.grabbed || w2.speed > 60) ? 0 : 1; w2.follow += (ft - w2.follow) * Math.min(1, dt * 2);
        if (w2.state === 'live') {
          var idleS = (now - w2.lastTouch) / 1000;
          if (w2.home) {
            var hp = w2.homePos, away = Math.hypot(w2.pos[0] - hp[0], w2.pos[1] - hp[1], w2.pos[2] - hp[2]);
            var str = 0; for (var c = 0; c < NC; c += 7) str = Math.max(str, w2.rest[c] / (CL[c] * w2.R));
            if ((away > 40 || str > 1.15) && idleS > HOME_IDLE_S && !w2.grabbed) { w2.state = 'dying'; w2.t = 0; }
          } else if (elapsed - w2.born > NEW_LIFE_S && !w2.grabbed && idleS > 8) { w2.state = 'dying'; w2.t = 0; }
          w2.alpha = Math.min(1, w2.alpha + dt / 1.2);
        } else if (w2.state === 'dying') {   // melts away into the ground
          w2.t += dt; w2.alpha = Math.max(0, 1 - w2.t / FADE_S);
          if (w2.t >= FADE_S) { if (w2.home) { resetWatch(w2); w2.state = 'live'; w2.alpha = 0; w2.lastTouch = now; w2.hOff = w2.mOff = w2.sOff = 0; } else slots[s2] = null; }
        } else if (w2.state === 'forming') w2.alpha = Math.min(1, w2.t / 0.3);
      }
      clothMs = performance.now() - t0c;
    }

    // ---- ants: a small black swarm that lives on the orange watch and scurries to a hand held still
    var ants = [], antTarget = null, antTargetT = -1e9;
    for (var ai = 0; ai < NANTS; ai++) ants.push({mode: 0, r: 0.2 + Math.random() * 0.6, th: Math.random() * 6.283, dr: 0, dth: (Math.random() - 0.5) * 0.8, x: 0, y: 0, hx: 1, hy: 0, ph: Math.random() * 6, delay: ai * 0.07, orb: Math.random() * 6.283, orR: 14 + Math.random() * 34, sp: 0.8 + Math.random() * 0.4});
    var proj = new Float32Array(MAXW * NP * 2);
    function clothPoint(w, r, th) {   // a point on the (projected) cloth at dial polar coordinates
      var fr = Math.min(NR - 0.001, Math.max(0, r * NR)), k = Math.floor(fr), t = fr - k, fj = ((th / (2 * Math.PI)) % 1 + 1) % 1 * NS, j = Math.floor(fj), s = fj - j, base = w.slot * NP;
      var a = pidx(k, j), b = pidx(k, j + 1), c = pidx(k + 1, j), d = pidx(k + 1, j + 1);
      var ax = proj[(base + a) * 2] * (1 - s) + proj[(base + b) * 2] * s, ay = proj[(base + a) * 2 + 1] * (1 - s) + proj[(base + b) * 2 + 1] * s;
      var cx = proj[(base + c) * 2] * (1 - s) + proj[(base + d) * 2] * s, cy = proj[(base + c) * 2 + 1] * (1 - s) + proj[(base + d) * 2 + 1] * s;
      return [ax * (1 - t) + cx * t, ay * (1 - t) + cy * t];
    }
    function stepAnts(dt, now) {
      // the target: the hand held still the longest, else a still person's outstretched hand (only someone who moved first)
      var tgt = null, best = 0.6;
      for (var i = 0; i < hands.length; i++) if (hands[i].stillT > best && !hands[i].grab) { best = hands[i].stillT; tgt = [hands[i].sx * 1280, hands[i].sy * 800]; }
      if (!tgt) for (i = 0; i < tracked.length; i++) { var t = tracked[i]; if (t.idx >= 0 && !t.active && t.stillT > 1.0 && now - t.lastActive < 20000) { tgt = [t.rx * 1280, t.ry * 800]; break; } }
      if (tgt) { antTarget = tgt; antTargetT = now; }
      var called = antTarget && now - antTargetT < 1200, aw = antWatch && slots[antWatch.slot] === antWatch ? antWatch : null;
      for (i = 0; i < NANTS; i++) {
        var a = ants[i], spd = ANT_SPEED * a.sp;
        a.ph += dt * 26;
        if (a.mode === 0) {
          if (called) { a.delay -= dt; if (a.delay <= 0) { a.mode = 1; a.delay = i * 0.07; } }
          a.dth += (Math.random() - 0.5) * dt * 6; a.dth = Math.max(-1.2, Math.min(1.2, a.dth)); a.th += a.dth * dt;
          a.dr += (Math.random() - 0.5) * dt * 3; a.dr = Math.max(-0.4, Math.min(0.4, a.dr)); a.r += a.dr * dt;
          if (a.r < 0.12 || a.r > 0.84) { a.dr = -a.dr; a.r = Math.max(0.12, Math.min(0.84, a.r)); }
          if (aw) { var cp = clothPoint(aw, a.r, a.th); var mx = cp[0] - a.x, my = cp[1] - a.y, ml = Math.hypot(mx, my); if (ml > 0.05) { a.hx = mx / ml; a.hy = my / ml; } a.x = cp[0]; a.y = cp[1]; }
        } else {
          var goal;
          if (a.mode === 3 || !called) { a.mode = 3; goal = aw ? clothPoint(aw, a.r, a.th) : [222, 470]; }
          else { a.orb += dt * (1.2 + (i % 5) * 0.2) * (i % 2 ? 1 : -1); goal = a.mode === 2 ? [antTarget[0] + Math.cos(a.orb) * a.orR, antTarget[1] + Math.sin(a.orb) * a.orR * 0.7] : antTarget; }
          var gx = goal[0] - a.x, gy = goal[1] - a.y, gl2 = Math.hypot(gx, gy);
          if (a.mode === 1 && gl2 < 40) a.mode = 2;
          if (a.mode === 3 && gl2 < 8) { a.mode = 0; a.delay = i * 0.07; continue; }
          var wig = Math.sin(a.ph * 0.23 + i) * 0.6, ux = gx / (gl2 + 1e-3), uy = gy / (gl2 + 1e-3), hx = ux * Math.cos(wig) - uy * Math.sin(wig), hy = ux * Math.sin(wig) + uy * Math.cos(wig);
          a.hx += (hx - a.hx) * Math.min(1, dt * 10); a.hy += (hy - a.hy) * Math.min(1, dt * 10);
          var hl = Math.hypot(a.hx, a.hy) || 1, step = Math.min(gl2, spd * (a.mode === 2 ? 0.45 : 1) * dt);
          a.x += a.hx / hl * step; a.y += a.hy / hl * step;
        }
      }
    }
    function antCounts() { var c = [0, 0, 0, 0]; ants.forEach(function (a) { c[a.mode]++; }); return {home: c[0], going: c[1], swarm: c[2], back: c[3]}; }

    // ---- build the vertex data: projected positions, normals, projected shadows; the sprites
    var V3 = [0, -SC.TILT, 1];
    function shadowPoint(x, y, z, out, o) {   // where the low sun throws this point: the ledge top, its front face, or the ground
      var lx = -SUN[0], ly = -SUN[1], lz = -SUN[2], t, X, Y, Z, best = 1e9, bx = x, by = SC.YG, bz = z;
      if (y < SC.LY0) { t = (SC.LY0 - y) / ly; X = x + lx * t; Z = z + lz * t; if (X > SC.LX0 && X < SC.LX1 && Z > SC.LZ0 && Z < SC.LZ1 && t < best) { best = t; bx = X; by = SC.LY0; bz = Z; } }
      if (z > SC.LZ1 && lz < 0) { t = (SC.LZ1 - z) / lz; X = x + lx * t; Y = y + ly * t; if (X > SC.LX0 && X < SC.LX1 && Y > SC.LY0 && Y < SC.YG && t < best) { best = t; bx = X; by = Y; bz = SC.LZ1; } }
      if (best === 1e9) { t = Math.max(0, (SC.YG - y) / ly); bx = x + lx * t; by = SC.YG; bz = z + lz * t; }
      var px = x, py = y + SC.TILT * z, dx = bx - px, dy = by + SC.TILT * bz - py, dl = Math.hypot(dx, dy), cl = Math.min(1, 24 / (dl + 1e-6));
      out[o] = px + dx * cl; out[o + 1] = py + dy * cl; out[o + 2] = 0; out[o + 3] = dl < 6 ? 1 : Math.max(0, 1 - (dl - 6) / 46);
    }
    function buildMeshes() {
      nSpr = 0;
      for (var s = 0; s < MAXW; s++) {
        var w = slots[s]; if (!w) continue;
        var p = w.pos, base = s * NP;
        for (var j = 0; j < NP; j++) {
          var o = j * 3, vo = (base + j) * 6, x = p[o], y = p[o + 1], z = p[o + 2];
          wv[vo] = x; wv[vo + 1] = y + SC.TILT * z; wv[vo + 2] = z;
          proj[(base + j) * 2] = wv[vo]; proj[(base + j) * 2 + 1] = wv[vo + 1];
          shadowPoint(x, y, z, sv, vo);
        }
        for (j = 0; j < NP; j++) {   // normals from the grid neighbours
          var k = j === 0 ? 0 : 1 + ((j - 1) / NS | 0), jj = j === 0 ? 0 : (j - 1) % NS, ra, rb, ta, tb;
          if (k === 0) { ra = pidx(1, NS / 2); rb = pidx(1, 0); ta = pidx(1, 3 * NS / 4); tb = pidx(1, NS / 4); }
          else { ra = k === 1 ? 0 : pidx(k - 1, jj); rb = k === NR ? j : pidx(k + 1, jj); if (k === NR) ra = pidx(k - 1, jj); ta = pidx(k, jj - 1); tb = pidx(k, jj + 1); }
          var Rx = p[rb * 3] - p[ra * 3], Ry = p[rb * 3 + 1] - p[ra * 3 + 1], Rz = p[rb * 3 + 2] - p[ra * 3 + 2];
          var Tx = p[tb * 3] - p[ta * 3], Ty = p[tb * 3 + 1] - p[ta * 3 + 1], Tz = p[tb * 3 + 2] - p[ta * 3 + 2];
          var nx = Ry * Tz - Rz * Ty, ny = Rz * Tx - Rx * Tz, nz = Rx * Ty - Ry * Tx, nl = Math.hypot(nx, ny, nz) || 1, vo2 = (base + j) * 6;
          wv[vo2 + 3] = nx / nl; wv[vo2 + 4] = ny / nl; wv[vo2 + 5] = nz / nl;
        }
        var an = clockAngles(w, lastDt);
        uHandA[s * 4] = an[0]; uHandA[s * 4 + 1] = an[1]; uHandA[s * 4 + 2] = an[2]; uHandA[s * 4 + 3] = w.warp;
        uLook[s * 4] = w.kind; uLook[s * 4 + 1] = w.alpha; uLook[s * 4 + 2] = Math.min(1, w.warp * settings.warp); uLook[s * 4 + 3] = w.warp * settings.warp * 0.9;
        uFollow[s] = w.follow;
        // the crown at twelve o'clock
        var rim = pidx(NR, 0), in1 = pidx(NR - 1, 0), dx = proj[(base + rim) * 2] - proj[(base + in1) * 2], dy = proj[(base + rim) * 2 + 1] - proj[(base + in1) * 2 + 1], dl = Math.hypot(dx, dy) || 1;
        if (nSpr < MAXS) { var so = nSpr * 8; spr[so] = proj[(base + rim) * 2] + dx / dl * 6; spr[so + 1] = proj[(base + rim) * 2 + 1] + dy / dl * 6; spr[so + 2] = Math.atan2(dy, dx) - Math.PI / 2; spr[so + 3] = 7;
          spr[so + 4] = 1; spr[so + 5] = w.alpha; spr[so + 6] = 0; spr[so + 7] = w.follow; nSpr++; }
        if (w.state === 'forming' && nSpr < MAXS) { so = nSpr * 8; spr[so] = proj[base * 2]; spr[so + 1] = proj[base * 2 + 1]; spr[so + 2] = elapsed * 0.6; spr[so + 3] = 30 + 50 * Math.min(1, w.t / FORM_S);
          spr[so + 4] = 2; spr[so + 5] = 1 - 0.6 * Math.min(1, w.t / FORM_S); spr[so + 6] = 0; spr[so + 7] = 0; nSpr++; }
      }
      for (var i = 0; i < NANTS && nSpr < MAXS; i++) { var a = ants[i], o2 = nSpr * 8;
        spr[o2] = a.x; spr[o2 + 1] = a.y; spr[o2 + 2] = Math.atan2(a.hy, a.hx); spr[o2 + 3] = 7.5; spr[o2 + 4] = 0; spr[o2 + 5] = 1; spr[o2 + 6] = a.ph; spr[o2 + 7] = a.mode === 0 && antWatch ? antWatch.follow : 0; nSpr++; }
    }
    var lastDt = 0;
    function drawWatches() {
      gl.bindBuffer(gl.ARRAY_BUFFER, bufW); gl.bufferSubData(gl.ARRAY_BUFFER, 0, wv);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufS); gl.bufferSubData(gl.ARRAY_BUFFER, 0, sv);
      gl.useProgram(PW.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, mTex[mCur]); gl.uniform1i(PW.u.uMelt, 0);
      gl.uniform4fv(PW.u.uHandA, uHandA); gl.uniform4fv(PW.u.uLook, uLook); gl.uniform1fv(PW.u.uFollow, uFollow);
      // shadows first: each shadow pixel darkened once (stencil), only on the ground and the ledge
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.STENCIL_TEST); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      gl.uniform1f(PW.u.uShadowPass, 1); gl.bindVertexArray(vaoS);
      var sh = new Float32Array(MAXW * 4);
      for (var s = 0; s < MAXW; s++) { var w = slots[s]; if (!w) continue; sh[s * 4] = w.kind; sh[s * 4 + 1] = w.alpha * 0.42; }
      gl.uniform4fv(PW.u.uLook, sh);
      for (s = 0; s < MAXW; s++) if (slots[s]) gl.drawElements(gl.TRIANGLES, NT * 3, gl.UNSIGNED_SHORT, s * NT * 3 * 2);
      gl.disable(gl.STENCIL_TEST);
      // the watches, nearest in front
      gl.uniform4fv(PW.u.uLook, uLook); gl.uniform1f(PW.u.uShadowPass, 0);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true);
      gl.bindVertexArray(vaoW);
      for (s = 0; s < MAXW; s++) if (slots[s]) gl.drawElements(gl.TRIANGLES, NT * 3, gl.UNSIGNED_SHORT, s * NT * 3 * 2);
      gl.disable(gl.DEPTH_TEST);
      // ants, crowns, glints
      gl.bindBuffer(gl.ARRAY_BUFFER, bufSp); gl.bufferSubData(gl.ARRAY_BUFFER, 0, spr, 0, nSpr * 8);
      gl.useProgram(PS.p); gl.uniform1i(PS.u.uMelt, 0); gl.bindVertexArray(vaoSp);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, nSpr);
      gl.disable(gl.BLEND); gl.bindVertexArray(null);
    }

    // ---- per-frame
    var perU = new Float32Array(12), lastFoldMs = performance.now();
    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); elapsed += dt; frames++;
      roomHeat=kit.room?kit.room(dt):{motion:0};
      buildReg(now);
      var fresh = body.update(dt, now);
      var foldDt = fresh ? Math.max(0.01, Math.min(0.25, (body.frameMs - lastFoldMs) / 1000)) : dt; if (fresh) lastFoldMs = body.frameMs;   // real time between depth frames
      trackPeople(foldDt, now, fresh);
      trackHands(dt, now);
      if (fresh || !body.fresh) {
        var mk = body.mask, lb = body.label;
        for (var i = 0; i < BN; i++) { var v = mk[i]; mask8[i] = v >= 1 ? 255 : (v * 255) | 0; lab8[i] = lb[i] + 1; }
        gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, mask8);
        gl.bindTexture(gl.TEXTURE_2D, labTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, lab8);
      }
      stepHeat(dt);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(vao);
      simAcc += dt; var n = 0;
      while (simAcc >= 1 / 60 && n < 4) { stepMelt(); simAcc -= 1 / 60; n++; }
      if (n === 4) simAcc = 0;
      elephants();
      // the painting through the melt
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(P.comp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, paintTex); gl.uniform1i(P.comp.u.uPaint, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mTex[mCur]); gl.uniform1i(P.comp.u.uMelt, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, heatTex); gl.uniform1i(P.comp.u.uHeat, 2);
      gl.uniform1f(P.comp.u.uTime, elapsed); gl.uniform4fv(P.comp.u.uEle, ele);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // the soft watches, their shadows, the ants
      lastDt = dt; stepCloth(dt, now); stepAnts(dt, now); buildMeshes(); drawWatches();
      gl.bindVertexArray(vao);
      // shadows and the dim inside a person
      perU.fill(0);
      var np = 0;
      for (var q = 0; q < tracked.length && np < 3; q++) { var t = tracked[q]; if (t.idx < 0 || t.idx > 14 || !isFinite(t.cx) || !isFinite(t.bottom)) continue;
        perU[np * 4] = t.cx; perU[np * 4 + 1] = t.bottom; perU[np * 4 + 2] = 1; perU[np * 4 + 3] = t.idx + 1; np++; }
      gl.enable(gl.BLEND); gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.useProgram(P.shade.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(P.shade.u.uMask, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, labTex); gl.uniform1i(P.shade.u.uLabel, 1);
      gl.uniformMatrix3fv(P.shade.u.uHinv, false, body.hinv());
      gl.uniform1f(P.shade.u.uInside, settings.inside); gl.uniform1f(P.shade.u.uShadow, SHADOW); gl.uniform4fv(P.shade.u.uPer, perU);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    }

    function touch(t) {
      if (destroyed || !t || !isFinite(t.x) || !isFinite(t.y)) return;
      touches.push({x: t.x, y: t.y, t: Date.now()}); if (touches.length > 12) touches.shift();
      if (t.first) splat(t.x, t.y, HAND_RADIUS * 0.9, 0.7);
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      var r = Number.isFinite(radius) && radius > 0 ? Math.max(0.03, Math.min(0.3, radius)) : 0.09;
      var s = Number.isFinite(strength) && strength > 0 ? Math.max(0.2, Math.min(3, strength)) : 1;
      splat(sx, sy, r, 1.3 * s);
      wakes.push({x: sx, y: sy, t: Date.now()}); if (wakes.length > 8) wakes.shift();
    }
    function set(v) {
      if (v && typeof v === 'object') Object.keys(RANGES).forEach(function (k) { var n = Number(v[k]); if (v[k] !== undefined && v[k] !== null && Number.isFinite(n)) settings[k] = Math.max(RANGES[k][0], Math.min(RANGES[k][1], n)); });
      return Object.assign({}, settings);
    }
    function resize(w, h) { if (!destroyed) alloc(w, h); }
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.DalimeltSet === set) delete window.DalimeltSet;
      if (window.DalimeltWake === wake) delete window.DalimeltWake;
      if (window.__dalimeltDebug) { try { delete window.__dalimeltDebug; } catch (e) { window.__dalimeltDebug = undefined; } }
      kit.wantDepth(false);
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
    }

    kit.wantDepth(true);
    set(window._dalimeltFx);
    window.DalimeltSet = set;
    window.DalimeltWake = wake;
    var startMs = performance.now() - t0;
    if (window.WallTest) window.__dalimeltDebug = function () {
      var px = new Float32Array(MW * MH * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, mFb[mCur]); gl.readPixels(0, 0, MW, MH, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      var sd = 0, mx = 0, area = 0, fl2 = 0, wet = 0;
      for (var i = 0; i < MW * MH; i++) { var d = px[i * 4 + 1]; sd += d; if (d > mx) mx = d; if (d > 0.01) area++; fl2 += px[i * 4 + 2]; wet += px[i * 4 + 3]; }
      return {frames: frames, simSteps: simSteps, startMs: Math.round(startMs), floatLin: floatLin,
        energy: +(heatSum / (HW * HH)).toFixed(4), heatMax: +heatMax.toFixed(3),
        field: +(sd / (MW * MH) * 1000).toFixed(3), meltMax: +mx.toFixed(4), meltArea: +(area / (MW * MH)).toFixed(4), flow: +(fl2 / (MW * MH)).toFixed(4), wet: +(wet / (MW * MH)).toFixed(4),
        people: body.people.length, tracked: tracked.map(function (t) { return {key: t.key, cx: +(t.cx || 0).toFixed(3), cy: +(t.cy || 0).toFixed(3), bottom: +(t.bottom || 0).toFixed(3), box: [t.left, t.top, t.right, t.bottom].map(function (v) { return +(v || 0).toFixed(3); }), act: +t.act.toFixed(3), net: +(t.net || 0).toFixed(3), active: t.active, stillT: +t.stillT.toFixed(2), idx: t.idx}; }),
        hands: hands.map(function (h) { return {x: +h.sx.toFixed(3), y: +h.sy.toFixed(3), stillT: +h.stillT.toFixed(2)}; }),
        watches: slots.filter(Boolean).map(function (w) { return {slot: w.slot, kind: w.kind, home: w.home, state: w.state, alpha: +w.alpha.toFixed(2), sx: Math.round(w.sx), sy: Math.round(w.sy),
          away: w.homePos ? Math.round(Math.hypot(w.pos[0] - w.homePos[0], w.pos[1] - w.homePos[1], w.pos[2] - w.homePos[2])) : null, grabbed: w.grabbed, warp: +w.warp.toFixed(3), hot: +w.hot.toFixed(3), bad: w.bad, turns: +(w.mOff / (2 * Math.PI)).toFixed(2)}; }),
        watchesAway: slots.filter(function (w) { return w && (!w.home || Math.hypot(w.pos[0] - w.homePos[0], w.pos[1] - w.homePos[1], w.pos[2] - w.homePos[2]) > 30); }).length,
        spawned: spawned, kicks: kicks, clothSteps: clothSteps, clothMs: +clothMs.toFixed(3), ants: antCounts(),
        hands0: [0, 1, 2].map(function (i) { return +(((uHandA[i] * 180 / Math.PI) % 360 + 360) % 360).toFixed(2); }),
        heatGrid: (function () { var g = []; for (var by = 0; by < 8; by++) { var row = []; for (var bx = 0; bx < 8; bx++) { var sm = 0; for (var yy = by * 10; yy < by * 10 + 10; yy++) for (var xx = bx * 16; xx < bx * 16 + 16; xx++) sm += heat[yy * HW + xx]; row.push(+(sm / 160).toFixed(2)); } g.push(row.join(' ')); } return g; })(),
        maskPeak: +body.mask.reduce(function (a, b) { return b > a ? b : a; }, 0).toFixed(3),
        fresh: body.fresh, regOk: regOk, bodyReg: body.regOk, foldMs: +body.foldMs.toFixed(2), settings: set(), glError: gl.getError()};
    };
    return {frame: frame, touch: touch, resize: resize, destroy: destroy};
  }
})();
