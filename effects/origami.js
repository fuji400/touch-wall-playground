/* Origami -- genart build-out, Builder A (2026-10-22), ported from jdxyw/generativeart arts.NewOrigamiTessellation (origamitessellation.go).
 * A Miura-ori folded-paper sheet fills the wall: a chevron (herringbone) vertex lattice, every cell folded into four facets around a raised
 * (mountain) or recessed (valley) apex, flat facets with analytic normals, Lambert + Blinn-Phong from a warm key light and a cool fill,
 * valley ambient occlusion, gilded mountain creases, indigo valley creases and the Go's paper grain hatching.
 * Live (every modulation moves VERTICES, so facets stay planar):
 *   people : the fold depth follows how close people stand (body.meanGap: far = nearly flat, close = deep), and the paper creases
 *            deepest right in front of a person (body.mask sampled at each vertex); walking across drags a travelling fold wave.
 *   tap    : a starburst of extra diamond folds radiates from the fingertip (eight ridges + a ring of inverted apexes) and relaxes in ~2 s.
 *   hold   : the crease under a still hand is pinned deep and the key light swings slowly around the hand.
 *   idle   : the sheet breathes (fold 0.3..0.5, 8 s) and the light drifts.
 * One full-screen WebGL2 fragment pass (each pixel tests the 3 x 3 nearby cells x 4 facets). Needs plugins/body.js (WallBody).
 * Looks (2026-11-01): named presets of the eight paper colours and the three knobs (columns, rows, fold depth). Picking one eases
 * the palette over ~0.8 s and the sheet over ~1.2 s (it re-pleats and deepens through the knobs' own easing); a moved knob overrides
 * the look's value until the next look. Look 0 (miura) is the original picture.
 * No audio, no network, no assets.
 */
(function () {
  'use strict';
  registerWallPlugin({id: 'origami', title: 'Origami', author: 'Claude Opus 5.5 (genart build-out, Builder A)', create: create});

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
  var NEAR_MM = 350, FAR_MM = 1600;   // closeness to the wall (Echo's convention)
  var LOOP_S = 20;                    // the Go phase loop (chevron sway, dome wave) at this period
  var BREATH_S = 8;                   // idle breath: fold 0.3..0.5
  var TAP_LIFE_S = 3.5, TAP_GAP_S = 0.15;   // a tap is dropped at envelope < 0.01, so nothing pops
  var HOLD_STILL_S = 0.95, HOLD_MOVE = 22, LIGHT_SPIN = 0.55;   // rad/s the key light swings around a held hand
  var FOLD_GAIN = 2.6;                // fold 1.0 at the 100 % knob = 2.6 x the Go engine's default depth
  // Looks: palette [indigo, valley, slate, jade, coral, amber, ivory, gold] (0..255) and the three shape knobs. Look 0 is the original.
  var LOOKS = [
    {name: 'miura', cols: 16, rows: 10, fold: 60,
     pal: [[12, 18, 38], [20, 44, 92], [34, 138, 158], [72, 198, 184], [224, 68, 46], [248, 176, 44], [255, 244, 208], [255, 226, 124]]},
    {name: 'washi', cols: 12, rows: 8, fold: 75,
     pal: [[46, 44, 52], [112, 110, 120], [168, 168, 178], [232, 228, 218], [242, 234, 222], [250, 246, 236], [255, 255, 250], [255, 250, 236]]},
    {name: 'ember', cols: 20, rows: 12, fold: 50,
     pal: [[10, 3, 2], [62, 12, 6], [124, 32, 10], [204, 72, 20], [255, 60, 22], [255, 152, 40], [255, 230, 180], [255, 210, 100]]},
    {name: 'ice', cols: 24, rows: 14, fold: 40,
     pal: [[4, 10, 24], [20, 50, 100], [70, 130, 190], [150, 210, 240], [188, 220, 255], [222, 240, 255], [245, 252, 255], [200, 240, 255]]},
    {name: 'neon', cols: 10, rows: 6, fold: 85,
     pal: [[2, 0, 8], [30, 0, 62], [90, 0, 140], [0, 228, 255], [255, 0, 160], [180, 60, 255], [255, 255, 255], [0, 255, 200]]},
    {name: 'graphite', cols: 16, rows: 10, fold: 95,
     pal: [[8, 8, 10], [40, 42, 48], [90, 94, 104], [150, 154, 162], [112, 114, 122], [190, 192, 198], [240, 240, 244], [255, 255, 255]]}
  ];
  var NPAL = 8, PAL_TAU = 0.25, SHAPE_TAU = 0.4;
  var NTAP = 6, NWALK = 3;

  var VS = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uBody; uniform mat3 uHinv; uniform float uBodyOn;',
    'uniform vec2 uRes, uCells, uCs, uC0; uniform float uS, uDW, uZs, uPh, uFold, uFoldIn, uHue, uExpo;',
    'uniform vec3 uKey; uniform vec4 uHoldL; uniform vec4 uTap[6]; uniform vec4 uWalk[3];',
    'out vec4 o;',
    'const float PI=3.14159265, TAU=6.28318531;',
    'uniform vec3 uPal[8];',                                  // the look's paper colours (eased in JS)
    '#define C_INDIGO uPal[0]',
    '#define C_VALLEY uPal[1]',
    '#define C_SLATE uPal[2]',
    '#define C_JADE uPal[3]',
    '#define C_CORAL uPal[4]',
    '#define C_AMBER uPal[5]',
    '#define C_IVORY uPal[6]',
    '#define C_GOLD uPal[7]',
    'const vec3 FILL=vec3(.6476,.548,.5181);',
    'float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}',
    'float maskAt(vec2 b){vec3 h=uHinv*vec3(b.x/uDW,b.y/800.,1.);vec2 k=h.xy/max(h.z,1e-6);',
    '  if(h.z<=0.||k.x<0.||k.x>1.||k.y<0.||k.y>1.)return 0.;return textureLod(uBody,k,0.).r*uBodyOn;}',
    'float foldAt(vec2 b){float f=mix(uFold,uFoldIn,maskAt(b));',
    '  if(uHoldL.z>0.)f=mix(f,max(f,1.25),uHoldL.z*(1.-smoothstep(70.,260.,length(b-uHoldL.xy))));',   // a held hand pins its crease deep
    '  return min(f,2.2);}',
    'float extraZ(vec2 b){float z=0.;',
    '  for(int i=0;i<6;i++){vec4 T=uTap[i];if(T.w>0.){float r=length(b-T.xy);',
    '    z-=T.w*34.*exp(-r*r/16200.);}}',                      // the fingertip presses the paper in
    '  for(int i=0;i<3;i++){vec4 Wv=uWalk[i];if(Wv.y>0.){float dx=b.x-Wv.x;z+=Wv.y*26.*exp(-abs(dx)/380.)*sin(dx*.018-Wv.z);}}',
    '  return z;}',
    'vec3 vert(float ix,float iy){vec2 b=uC0+(vec2(ix,iy)-uCells*.5)*uCs;',
    '  float uF=b.x/uDW,vF=b.y/800.,rD=length(vec2(uF-.5,vF-.5));',
    '  float zy=mod(iy,2.)<.5?1.:-1.,zx=mod(ix,2.)<.5?1.:-1.;',
    '  float cx=zy*uCs.x*.24*(1.+.25*cos(rD*PI*3.-uPh)),cy=zx*uCs.y*.14*sin((uF+vF)*PI*2.+uPh);',
    '  float pz=(zx*.55+zy*.45)*24.*uZs*foldAt(b)*(1.+.22*sin(uPh-rD*PI*2.5));',
    '  float wz=17.*uZs*cos(rD*PI*3.2-uPh);',
    '  return vec3(b.x+cx,b.y+cy-wz*.22,pz+wz+extraZ(b)*uZs);}',
    'vec3 apex(float ix,float iy,vec3 c){vec2 b=uC0+(vec2(ix,iy)+.5-uCells*.5)*uCs;',
    '  float rD=length(vec2(b.x/uDW-.5,b.y/800.-.5));bool up=mod(ix+iy,2.)<.5;',
    '  float s=1.;for(int i=0;i<6;i++){vec4 T=uTap[i];if(T.w>0.){float q=(length(b-T.xy)-T.z*.62)/95.;s-=2.*T.w*exp(-q*q);}}',
    '  float az=(up?22.:-18.)*uZs*foldAt(b)*(1.+.25*sin(uPh-rD*PI*3.))*clamp(s,-1.,1.);',
    '  return vec3(c.x-az*.12,c.y-az*.18,c.z+az);}',
    'float cr(vec2 a,vec2 b){return a.x*b.y-a.y*b.x;}',
    'bool inTri(vec2 p,vec2 a,vec2 b,vec2 c){float d1=cr(b-a,p-a),d2=cr(c-b,p-b),d3=cr(a-c,p-c);',
    '  return !((d1<0.||d2<0.||d3<0.)&&(d1>0.||d2>0.||d3>0.));}',
    'float segD(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.,1.);return length(pa-ba*h);}',
    'void main(){',
    '  vec2 P=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y)/uS;',
    '  float mP=maskAt(P),mw=max(fwidth(mP),1e-3),rim=exp(-pow((mP-.5)/mw/(1.5*uS),2.));',   // a gilded crease along a person's outline
    '  float ix0=floor((P.x-uC0.x)/uCs.x+uCells.x*.5),iy0=floor((P.y-uC0.y)/uCs.y+uCells.y*.5);',
    '  vec3 V[16];',
    '  for(int a=0;a<4;a++)for(int b=0;b<4;b++)V[a*4+b]=vert(ix0-1.+float(a),iy0-1.+float(b));',
    '  vec3 A=vec3(0.),B=vec3(0.),C=vec3(0.);float cix=0.,ciy=0.,tI=-1.;',
    '  for(int a=0;a<3;a++){for(int b=0;b<3;b++){',
    '    vec3 v00=V[a*4+b],v10=V[(a+1)*4+b],v11=V[(a+1)*4+b+1],v01=V[a*4+b+1];',
    '    float ix=ix0-1.+float(a),iy=iy0-1.+float(b);',
    '    vec3 c=apex(ix,iy,(v00+v10+v11+v01)*.25);',
    '    if(inTri(P,v00.xy,v10.xy,c.xy)){A=v00;B=v10;tI=0.;}',
    '    else if(inTri(P,v10.xy,v11.xy,c.xy)){A=v10;B=v11;tI=1.;}',
    '    else if(inTri(P,v11.xy,v01.xy,c.xy)){A=v11;B=v01;tI=2.;}',
    '    else if(inTri(P,v01.xy,v00.xy,c.xy)){A=v01;B=v00;tI=3.;}',
    '    if(tI>=0.){C=c;cix=ix;ciy=iy;break;}',
    '  }if(tI>=0.)break;}',
    '  vec3 col=C_INDIGO;',
    '  if(tI>=0.){',
    '    bool up=mod(cix+ciy,2.)<.5;bool valley=!up&&(tI>.5&&tI<2.5);',
    // tap starburst: facets near a tap fold again around a lifted centroid (eight rays, a ring running outward)
    '    vec3 G=(A+B+C)/3.;float tb=0.,ring=0.;',
    '    for(int i=0;i<6;i++){vec4 T=uTap[i];if(T.w>0.){vec2 d=G.xy-T.xy;float r=length(d),th=atan(d.y,d.x);',
    '      float q=(r-T.z)/120.;float rg=exp(-q*q);ring=max(ring,rg*T.w);',
    '      tb+=T.w*(rg*(.35+.65*pow(.5+.5*cos(8.*th),3.))+.9*pow(.5+.5*cos(8.*th),6.)*(1.-smoothstep(0.,T.z,r)));}}',
    '    float mG=maskAt(G.xy);tb+=mG*.8;',                    // in front of a person every facet folds again
    '    float sub=-1.;',
    '    if(tb>.03){float hz=min(tb,1.3)*38.*uZs*(mod(cix+ciy+tI,2.)<.5?1.:-1.);vec3 Gp=vec3(G.xy,G.z+hz);',
    '      if(inTri(P,A.xy,B.xy,Gp.xy)){C=Gp;sub=0.;}else if(inTri(P,B.xy,C.xy,Gp.xy)){A=B;B=C;C=Gp;sub=1.;}else{B=A;A=C;C=Gp;sub=2.;}}',
    '    vec3 n=normalize(cross(B-A,C-A));if(n.z<0.)n=-n;',
    '    vec3 key=uKey;',
    '    if(uHoldL.z>0.){float la=uHoldL.w;vec3 Lp=vec3(uHoldL.xy+235.*vec2(cos(la),sin(la)),250.);',
    '      vec3 fp=vec3(P,(A.z+B.z+C.z)/3.);key=normalize(mix(key,normalize(Lp-fp),uHoldL.z*(1.-smoothstep(160.,700.,length(P-uHoldL.xy)))));}',
    '    float pool=0.;if(uHoldL.z>0.){float la=uHoldL.w;vec2 Lq=uHoldL.xy+235.*vec2(cos(la),sin(la));pool=uHoldL.z*exp(-dot(P-Lq,P-Lq)/(2.*170.*170.));}',
    '    vec3 hv=normalize(key+vec3(0.,0.,1.));',
    '    float nl=clamp(dot(n,key),0.,1.),nf=clamp(dot(n,FILL),0.,1.),sp=pow(clamp(dot(n,hv),0.,1.),16.);',
    '    vec2 cm=uC0+(vec2(cix,ciy)+.5-uCells*.5)*uCs;float uM=cm.x/uDW,vM=cm.y/800.;',
    '    float dT=clamp(uM*.58+(1.-vM)*.42+.15*sin((uM-vM)*PI*2.),0.,1.);',
    '    vec3 base=dT<.5?mix(C_JADE,C_AMBER,dT*2.):mix(C_AMBER,C_CORAL,(dT-.5)*2.);',
    '    base=mix(base,mix(C_AMBER,C_CORAL,.45),mG*.45);',
    '    vec3 lit=mix(base,C_IVORY,.2),cool=mix(C_VALLEY,C_SLATE,clamp(nf*.7,0.,1.));',
    '    float lc=clamp((nl-.12)/.78,0.,1.);lc=lc*lc*(3.-2.*lc);',
    '    col=mix(cool,lit,lc);',
    '    if(valley)col=mix(col,C_INDIGO,.48);',
    '    if(sp>.04)col=mix(col,C_GOLD,clamp(sp*.82,0.,1.));',
    '    col*=1.-.22*uHoldL.z;col+=C_GOLD*pool*(.12+.5*nl);',         // a held hand: the key light becomes a lamp circling the hand
    '    col=mix(col,C_GOLD,ring*.32*nl);',
    // the Go paper grain: five hatch lines per facet, parallel to its base, toward the apex
    '    float hgt=abs(cr(B.xy-A.xy,C.xy-A.xy))/max(length(B.xy-A.xy),1e-3);',
    '    float lam=clamp(abs(cr(B.xy-A.xy,P-A.xy))/max(length(B.xy-A.xy),1e-3)/max(hgt,1e-3),0.,1.);',
    '    float gl=lam/.92*5.-.5;float gd=abs(gl-floor(gl+.5))*hgt*.92/5.;',
    '    float ga=(lam<.92?1.:0.)*(1.-smoothstep(.35,.35+1./uS,gd))*.45;',
    '    col=mix(col,valley?mix(col,C_INDIGO,.2):mix(col,C_IVORY,.16),ga);',
    // creases: spokes are mountain (gold) on raised cells and valley (indigo) on recessed ones; cell edges alternate as in the Go
    '    float dS=min(segD(P,A.xy,C.xy),segD(P,B.xy,C.xy)),dB=segD(P,A.xy,B.xy);',
    '    bool baseGold=(up&&tI<1.5)||(!up&&tI>1.5);',
    '    float aa=.7/uS,wv=1.1,wg=.7;',
    '    float vA=up?0.:(1.-smoothstep(wv-aa,wv+aa,dS));',
    '    float gA=up?(1.-smoothstep(wg-aa,wg+aa,dS)):0.;',
    '    if(baseGold)gA=max(gA,1.-smoothstep(wg-aa,wg+aa,dB));else vA=max(vA,(1.-smoothstep(.55-aa,.55+aa,dB))*.6);',
    '    if(sub>=0.){float dn=min(segD(P,A.xy,C.xy),segD(P,B.xy,C.xy));gA=max(gA,(1.-smoothstep(.55-aa,.55+aa,dn))*min(tb,1.));}',
    '    col=mix(col,C_INDIGO,vA*.8);col=mix(col,C_GOLD,gA*(.3+.6*nl));',
    '  }',
    '  col=mix(col,mix(C_GOLD,C_AMBER,.35),rim*.7);',
    '  col*=1.+(h21(floor(P*uS/1.5))-.5)*.06;',            // paper texture
    '  col*=uExpo;',
    '  vec3 kx=vec3(.57735);float ch=cos(uHue),sn=sin(uHue);col=col*ch+cross(kx,col)*sn+kx*dot(kx,col)*(1.-ch);',
    '  o=vec4(clamp(col,0.,1.),1.);',
    '}'
  ].join('\n');

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Origami needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false});
    if (!gl) throw new Error('Origami needs WebGL 2');
    var made = [], dead = false;
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('Origami shader: ' + e); }
      return s;
    }
    var prog = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { var le = gl.getProgramInfoLog(prog); gl.deleteProgram(prog); throw new Error('Origami link: ' + le); }
    made.push(['Program', prog]);
    var U = {};
    ['uBody', 'uHinv', 'uBodyOn', 'uRes', 'uCells', 'uCs', 'uC0', 'uS', 'uDW', 'uZs', 'uPh', 'uFold', 'uFoldIn', 'uHue', 'uExpo', 'uKey', 'uHoldL', 'uTap', 'uWalk', 'uPal']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    var BW = WallBody.w, BH = WallBody.h, body = WallBody.create(kit, {});
    var maskU8 = new Uint8Array(BW * BH);
    var tex = gl.createTexture(); made.push(['Texture', tex]);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, BW, BH, 0, gl.RED, gl.UNSIGNED_BYTE, maskU8);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR); });
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });

    var LIM = {look: [0, LOOKS.length - 1], cols: [6, 30], rows: [4, 20], fold: [0, 100], hue: [0, 360]};
    var settings = {look: 0, cols: 16, rows: 10, fold: 60, hue: 0};
    var LK = LOOKS[0], over = {cols: false, rows: false, fold: false}, looks = 0;   // a moved knob overrides the look until the next look
    var palNow = new Float32Array(NPAL * 3), palGo = new Float32Array(NPAL * 3);
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    function lookTargets() { for (var i = 0; i < NPAL; i++) for (var c = 0; c < 3; c++) palGo[i * 3 + c] = LK.pal[i][c] / 255; }
    function applyLook(i) { LK = LOOKS[i]; over.cols = over.rows = over.fold = false; lookTargets(); looks++; }
    lookTargets(); palNow.set(palGo);
    var hueFlow = refreshHue(0), input = refreshContacts(kit, 120);
    var eCols = 16, eRows = 10, eFoldMax = 0.6;           // eased knob values (a knob change zooms / deepens, never jumps)
    var time = 0, frames = 0, ph = 0, frameMs = 0, fold = 0.4, foldTarget = 0.4, closeness = 0, foldIn = 0.9, bodyOn = 0, fading = false;
    var taps = [], tracks = [], nextTrack = 1, lastTap = -1e9, tapsFired = 0, tapsDropped = 0, maxTaps = 0, holdsFired = 0, contacts = [];
    var light = {az: 0, hold: 0, hx: 0, hy: 0, angle: 0};
    var walkers = {}, walkU = new Float32Array(NWALK * 4), tapU = new Float32Array(NTAP * 4), keyV = new Float32Array(3);
    var size = [canvas.width, canvas.height];

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function designW() { return size[1] > 0 ? size[0] * 800 / size[1] : 1280; }
    function kToScreen(u, v) {
      var p = kit.toScreen(u, v);
      return (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) ? p : [u / 512, v / 424];
    }
    function packBody() {
      var mk = body.mask, peak = 0;
      for (var i = 0; i < mk.length; i++) { var v = mk[i]; if (v > peak) peak = v; maskU8[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255); }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, maskU8);
      return peak;
    }
    function walkStep(dt, freshFrame) {                      // a person moving across drags a travelling fold wave
      var dW = designW(), seen = {};
      if (body.fresh) (body.people || []).slice(0, NWALK).forEach(function (p) {
        if (!p || !Number.isFinite(p.cx) || !Number.isFinite(p.cy)) return;
        var s = kToScreen(p.cx * 512, p.cy * 424), x = s[0] * dW, w = walkers[p.id];
        if (!w) w = walkers[p.id] = {x: x, vx: 0, amp: 0, phase: 0, dir: 1};
        seen[p.id] = true;
        if (freshFrame && dt > 0) { var v = (x - w.x) / Math.max(dt, 1 / 60); w.vx += (clamp(v, -900, 900) - w.vx) * (1 - Math.exp(-dt / 0.25)); }
        w.x = x;
      });
      Object.keys(walkers).forEach(function (id) {
        var w = walkers[id], on = !!seen[id];
        var target = on ? clamp((Math.abs(w.vx) - 25) / 180, 0, 1) : 0;
        w.amp += (target - w.amp) * (1 - Math.exp(-dt / (target > w.amp ? 0.35 : 1.2)));
        if (Math.abs(w.vx) > 20) w.dir = w.vx > 0 ? 1 : -1;
        w.phase = (w.phase + dt * 4.2 * w.dir) % (Math.PI * 2);
        if (!on) w.vx *= Math.exp(-dt / 0.5);
        if (!on && w.amp < 0.005) delete walkers[id];
      });
    }
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
          if (time - lastTap >= TAP_GAP_S) {                 // tap: a new contact presses a starburst of folds
            if (taps.length >= NTAP && Math.exp(-taps[0].age / 0.75) < 0.02) taps.shift();   // evict only a tap that has relaxed
            if (taps.length < NTAP) { taps.push({x: x, y: y, age: 0}); lastTap = time; tapsFired++; maxTaps = Math.max(maxTaps, taps.length); }
            else tapsDropped++;
          }
        }
        best.seen = true; best.gone = 0; best.x = x; best.y = y;
        if (Math.hypot(x - best.ax, y - best.ay) > HOLD_MOVE) { best.ax = x; best.ay = y; best.still = 0; } else best.still += dt;
      }
      var top = null;
      for (var j = tracks.length - 1; j >= 0; j--) {
        var tr = tracks[j];
        if (!tr.seen) tr.gone += dt;
        var target = tr.seen && tr.still >= HOLD_STILL_S ? 1 : 0;
        if (target && !tr.held) { tr.held = true; holdsFired++; }
        tr.w += (target - tr.w) * (1 - Math.exp(-dt / (target > tr.w ? 0.35 : 0.9)));
        if (!tr.seen && tr.gone > 0.3 && tr.w < 0.01) { tracks.splice(j, 1); continue; }
        if (!top || tr.w > top.w) top = tr;
      }
      if (tracks.length > 12) tracks.splice(0, tracks.length - 12);
      if (top && top.w > 0.002) {                              // the strongest hold steers the light
        if (light.hold < 0.01) light.angle = Math.atan2(-1, -1);
        light.hx = top.x; light.hy = top.y; light.angle += dt * LIGHT_SPIN * top.w;
      }
      light.hold = top ? top.w : 0;
    }
    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      size = [canvas.width, canvas.height];
      hueFlow.step(settings.hue, dt);
      var ke = 1 - Math.exp(-dt / SHAPE_TAU), kp = 1 - Math.exp(-dt / PAL_TAU);
      eCols += (want('cols') - eCols) * ke; eRows += (want('rows') - eRows) * ke; eFoldMax += (want('fold') / 100 - eFoldMax) * ke;
      for (var pi = 0; pi < NPAL * 3; pi++) palNow[pi] += (palGo[pi] - palNow[pi]) * kp;
      var fresh = body.update(dt, now);
      if (fresh) { packBody(); fading = true; }
      else if (!body.fresh && fading) { if (packBody() < 0.004) fading = false; }
      bodyOn += ((body.fresh || fading ? 1 : 0) - bodyOn) * (1 - Math.exp(-dt / 0.15));
      walkStep(dt, fresh);
      // fold depth: idle breath, or how close people stand
      var someone = body.fresh && body.present && body.meanGap === body.meanGap;
      if (someone) { closeness = clamp((FAR_MM - body.meanGap) / (FAR_MM - NEAR_MM), 0, 1); foldTarget = 0.12 + 0.43 * closeness; }
      else foldTarget = 0.4 + 0.1 * Math.sin(time * Math.PI * 2 / BREATH_S);
      fold += (foldTarget - fold) * (1 - Math.exp(-dt / (someone ? 0.6 : 1.2)));
      foldIn += ((0.75 + 0.6 * closeness) - foldIn) * (1 - Math.exp(-dt / 0.4));   // in front of a person the paper creases deepest
      contactsStep(dt);
      ph = (ph + dt * Math.PI * 2 / LOOP_S) % (Math.PI * 2);
      light.az = Math.atan2(-0.62, -0.58) + 0.35 * Math.sin(time * Math.PI * 2 / 40);
      var el = 0.52, hz = Math.sqrt(1 - el * el);
      keyV[0] = Math.cos(light.az) * hz; keyV[1] = Math.sin(light.az) * hz; keyV[2] = el;
      for (var i = taps.length - 1; i >= 0; i--) { taps[i].age += dt; if (taps[i].age > TAP_LIFE_S) taps.splice(i, 1); }
      for (i = 0; i < NTAP; i++) {
        var tp = taps[i];
        if (tp) {
          var a = tp.age, env = Math.exp(-a / 0.75) * Math.min(1, a / 0.12);
          tapU[i * 4] = tp.x; tapU[i * 4 + 1] = tp.y; tapU[i * 4 + 2] = 150 + 560 * Math.min(a, 1.2); tapU[i * 4 + 3] = env;
        } else { tapU[i * 4] = 0; tapU[i * 4 + 1] = 0; tapU[i * 4 + 2] = 1; tapU[i * 4 + 3] = 0; }
      }
      var wk = Object.keys(walkers).map(function (k) { return walkers[k]; }).sort(function (p, q) { return q.amp - p.amp; });
      for (i = 0; i < NWALK; i++) {
        var w = wk[i];
        walkU[i * 4] = w ? w.x : 0; walkU[i * 4 + 1] = w ? w.amp : 0; walkU[i * 4 + 2] = w ? w.phase : 0; walkU[i * 4 + 3] = 0;
      }
      var W = size[0], H = size[1], s = H / 800, dW = W / s;
      var cs = [(dW + 112) / eCols, 912 / eRows], zs = Math.min(cs[0], cs[1]) / 46.9;
      gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uBody, 0);
      gl.uniformMatrix3fv(U.uHinv, false, body.hinv()); gl.uniform1f(U.uBodyOn, bodyOn);
      gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uS, s); gl.uniform1f(U.uDW, dW);
      gl.uniform2f(U.uCells, eCols, eRows); gl.uniform2f(U.uCs, cs[0], cs[1]); gl.uniform2f(U.uC0, dW / 2, 400); gl.uniform1f(U.uZs, zs);
      gl.uniform1f(U.uPh, ph); gl.uniform1f(U.uFold, fold * eFoldMax * FOLD_GAIN); gl.uniform1f(U.uFoldIn, foldIn * eFoldMax * FOLD_GAIN); gl.uniform1f(U.uExpo, 0.9);
      gl.uniform1f(U.uHue, hueFlow.value * Math.PI / 180); gl.uniform3fv(U.uPal, palNow);
      gl.uniform3fv(U.uKey, keyV); gl.uniform4f(U.uHoldL, light.hx, light.hy, light.hold, light.angle);
      gl.uniform4fv(U.uTap, tapU); gl.uniform4fv(U.uWalk, walkU);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      frameMs = performance.now() - t0;
    }
    function resize(w, h) { if (!dead && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) size = [w, h]; }
    function set(o) {
      if (o && typeof o === 'object' && !dead) {
        var lk = o.look;                                      // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['cols', 'rows', 'fold'].forEach(function (k) {       // a knob that MOVED overrides the look's own value until the next look
          var v = o[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
          v = clamp(k === 'cols' || k === 'rows' ? Math.round(v) : v, LIM[k][0], LIM[k][1]); if (v !== settings[k]) { settings[k] = v; over[k] = true; }
        });
        var hv = o.hue; if (typeof hv === 'number' && Number.isFinite(hv)) settings.hue = clamp(hv, LIM.hue[0], LIM.hue[1]);
      }
      return {look: settings.look, cols: settings.cols, rows: settings.rows, fold: settings.fold, hue: settings.hue};
    }
    function touch(t) { if (!dead && t && Number.isFinite(t.x) && Number.isFinite(t.y)) input.wake(t.x, t.y); }
    function destroy() {
      if (dead) return; dead = true;
      if (window.OrigamiSet === set) delete window.OrigamiSet;
      kit.wantDepth(false); input.clear(); tracks = []; taps = []; walkers = {};
      made.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); made = [];
    }
    kit.wantDepth(true);
    window.OrigamiSet = set;
    if (window._origamiFx) set(window._origamiFx);
    LK = LOOKS[settings.look]; lookTargets(); palNow.set(palGo);                       // start on the stored look and knobs without easing in
    hueFlow.snap(settings.hue); eCols = want('cols'); eRows = want('rows'); eFoldMax = want('fold') / 100;
    var out = {frame: frame, touch: touch, resize: resize, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      return {frames: frames, frameMs: +frameMs.toFixed(2), contacts: contacts.length, inputState: input.state, tapsFired: tapsFired, tapsDropped: tapsDropped, maxSlots: maxTaps, holdsFired: holdsFired,
              tracks: tracks.map(function (t) { return {id: t.id, x: Math.round(t.x), y: Math.round(t.y), still: +t.still.toFixed(2), w: +t.w.toFixed(3), seen: t.seen}; }),
              taps: taps.map(function (t) { return {x: Math.round(t.x), y: Math.round(t.y), age: +t.age.toFixed(2)}; }),
              fold: +fold.toFixed(3), foldTarget: +foldTarget.toFixed(3), closeness: +closeness.toFixed(3), foldIn: +foldIn.toFixed(3), meanGap: body.meanGap === body.meanGap ? Math.round(body.meanGap) : null,
              light: {az: +light.az.toFixed(3), hold: +light.hold.toFixed(3), angle: +light.angle.toFixed(3), hx: Math.round(light.hx), hy: Math.round(light.hy)},
              walkers: Object.keys(walkers).map(function (k) { var w = walkers[k]; return {x: Math.round(w.x), vx: Math.round(w.vx), amp: +w.amp.toFixed(3)}; }),
              people: (body.people || []).length, bodyFresh: body.fresh, bodyOn: +bodyOn.toFixed(2), regOk: body.regOk, displayHue: hueFlow.value,
              look: LK.name, looks: looks, overrides: Object.assign({}, over), eased: {cols: +eCols.toFixed(2), rows: +eRows.toFixed(2), fold: +eFoldMax.toFixed(3)},
              settings: set(), glError: gl.getError(), destroyed: dead};
    };
    return out;
  }
})();
