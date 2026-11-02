/* Suminagashi -- floating-ink marbling on a dark bath (2026-10-22, genart build-out, Builder B; from suminagashi.go).
 * Every pixel walks the operation list backwards (newest first) to find where its ink came from, with the exact closed-form,
 * area-preserving maps of the Go engine: an ink drop pushes everything outside it outward (p' = c + (p - c) sqrt(1 + r^2/|p - c|^2),
 * inverted as sqrt(1 - r^2/|p - c|^2)), a tine rake shears the bath along a stroke line with an exponential falloff, a swirl twists
 * it by an angle with a Gaussian falloff. The newest 48 operations live in uniform arrays; older ones are baked into a ping-pong
 * texture (premultiplied pigment over an abstract ground) and leave the list, so it never grows.
 *   tap  = a concentric ring set (3..7 ink rings, colours cycle) blooms at the finger
 *   drag = a tine rake along the path: the whole bath combs with the hand
 *   hold = a slow swirl grows under the still hand
 *   walk = a body presses the ink aside (body.sdf gradient, a live meniscus with a gold rim) and drags a broad soft rake behind it
 *   idle = a gentle rake every ~6 s, a new drop now and then, so the bath keeps drifting
 * Palette: UkiyoE blended toward Dunhuang (Oklab, 16 stops, every 4th deep sumi), kintsugi gold rims, on sumi ink (the "paper" knob
 * lifts the ground toward xuan cream, the Go look). Needs plugins/body.js (WallBody). WebGL 2, no assets, no audio, no network.
 * Looks (2026-11-01): the baked texture keeps the ORIGINAL pigments, so a look is a colour map applied at the wall pass to every
 * pixel of ink (baked or live alike): an affine map (duotone / saturation / gain / lift) on the premultiplied pigment, plus the
 * ground's dark end and three knobs (paper, drop size, swirl). Picking one eases the map, ground and paper over ~0.8 s and the
 * drop / swirl sizes over ~1.5 s; a moved knob overrides the look's value until the next look. Look 0 (ukiyoe) is the identity
 * map on the original ground: the original picture.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning
  var NOPS = 48;                    // operations evaluated live per pixel (the shader's uniform arrays)
  var BAKE_AT = 40, KEEP = 16;      // past BAKE_AT live ops, bake the oldest settled ones down to KEEP
  var MX = 160, MY = 100;           // baked region margin around the 1280 x 800 design space (px)
  var BAKE_SCALE = 1.25;            // baked texture resolution relative to the canvas (softens resampling)
  var PUSH_PX = 46;                 // how far a body presses the ink aside at its outline (px)
  var IDLE_AFTER_S = 3;             // no contact for this long = idle
  var IDLE_RAKE_S = 6, IDLE_DROP_S = 9, IDLE_SWIRL_S = 31;
  var SUMI = [18, 26, 38], CREAM = [246, 239, 225];
  // Looks: the ink colour map {s: duotone amount, A -> B: the duotone from dark to light pigment, sat, gain, lift (0..255)}, the
  // ground's dark end (the paper knob lifts it toward CREAM) and three knobs. Look 0 is the identity map: the original picture.
  var LOOKS = [
    {name: 'ukiyoe', paper: 0,   ink: 50, swirl: 50, ground: SUMI,            map: {}},
    {name: 'xuan',   paper: 100, ink: 65, swirl: 40, ground: SUMI,            map: {s: 1, A: [12, 14, 24], B: [150, 160, 178]}},
    {name: 'ember',  paper: 0,   ink: 40, swirl: 75, ground: [14, 6, 4],      map: {s: 0.85, A: [30, 4, 0], B: [255, 196, 100], sat: 1.2}},
    {name: 'ice',    paper: 0,   ink: 60, swirl: 30, ground: [6, 12, 26],     map: {s: 0.85, A: [6, 18, 42], B: [214, 240, 255]}},
    {name: 'neon',   paper: 0,   ink: 35, swirl: 70, ground: [4, 2, 10],      map: {s: 0.9, A: [150, 0, 170], B: [30, 255, 230], gain: 1.2}},
    {name: 'pastel', paper: 60,  ink: 55, swirl: 50, ground: [150, 170, 190], map: {sat: 0.55, gain: 1.1, lift: [40, 36, 44]}}
  ];
  var LUMA = [0.2126, 0.7152, 0.0722], GOLD_C = [238, 196, 104], PAL_TAU = 0.25, SHAPE_TAU = 0.5;
  function lookMap(L, m, t) {          // the map as a column-major mat3 m (out = m * pigment + t * alpha), t in 0..1
    var s = L.s || 0, sat = L.sat == null ? 1 : L.sat, gain = L.gain == null ? 1 : L.gain, A = L.A || [0, 0, 0], B = L.B || [0, 0, 0], lift = L.lift || [0, 0, 0];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) m[c * 3 + r] = (1 - s) * gain * (sat * (r === c ? 1 : 0) + (1 - sat) * LUMA[c]) + s * (B[r] - A[r]) / 255 * LUMA[c];
      t[r] = s * A[r] / 255 + lift[r] / 255;
    }
  }
  var UKIYOE = [[0x1B, 0x36, 0x44], [0x2C, 0x5E, 0x7A], [0x78, 0x9D, 0xA6], [0xE8, 0xDF, 0xCA], [0xD9, 0x8A, 0x54], [0xB8, 0x40, 0x30]];
  var DUNHUANG = [[0x8C, 0x2D, 0x19], [0xD9, 0x79, 0x25], [0xE8, 0xC5, 0x87], [0x3A, 0x7D, 0x70], [0x1E, 0x47, 0x59], [0x4A, 0x6B, 0x4E]];

  registerWallPlugin({id: 'suminagashi', title: 'Suminagashi', author: 'Claude Opus 5.5 (genart build-out, Builder B)', create: create});

  // ---------------------------------------------------------------- shared helpers (copied from the refresh family)
  function refreshContacts(kit, graceMs) {
    var wakes = [], last = [], lastSeen = 0, lastStamp = -Infinity, state = 'empty';
    function valid(p) { return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1; }
    function clean(raw) { var out = []; (Array.isArray(raw) ? raw : []).slice(0, 32).forEach(function (p) { if (valid(p) && out.length < 8 && !out.some(function (q) { return Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.015; })) out.push([p[0], p[1]]); }); return out; }
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
    function wake(x, y) { if (!valid([x, y]) || kit.fingers) return; var now = Date.now(), old = wakes.find(function (p) { return Math.hypot(p.x - x, p.y - y) < 0.025; }); if (old) { old.x = x; old.y = y; old.t = now; } else { if (wakes.length >= 8) wakes.shift(); wakes.push({x: x, y: y, t: now}); } }
    return {read: read, wake: wake, clear: function () { wakes = []; last = []; }, size: function () { return wakes.length; }, get state() { return state; }};
  }
  function refreshHue(initial) {
    var value = Number.isFinite(initial) ? initial : 0;
    return {get value() { return value; }, snap: function (v) { value = v; }, step: function (target, dt) { var d = ((target - value + 540) % 360) - 180; if (Math.abs(d) < 0.001) { value = target % 360; return; } value = (value + d * (1 - Math.exp(-Math.max(0, Math.min(0.1, dt)) / 0.18)) + 360) % 360; }};
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------------------------------------------------------------- palette (Oklab, as render.LerpOklab / NewMultiStopGradient)
  function s2l(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function l2s(c) { c = clamp(c, 0, 1); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function toLab(c) {
    var r = s2l(c[0]), g = s2l(c[1]), b = s2l(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function fromLab(L) {                // -> sRGB 0..1
    var l = L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2], m = L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2], s = L[0] - 0.0894841775 * L[1] - 1.2914855480 * L[2];
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), l2s(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
  }
  function mixLab(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function gradLab(stops, t) {
    var labs = stops.map(toLab), x = clamp(t, 0, 1) * (labs.length - 1), i = Math.min(labs.length - 2, Math.floor(x));
    return mixLab(labs[i], labs[i + 1], x - i);
  }
  function pigments() {                // the Go pigmentTable: UkiyoE blended 24% toward reversed Dunhuang, every 4th stop deep sumi
    var out = new Float32Array(48), sumi = toLab(SUMI);
    for (var i = 0; i < 16; i++) {
      var t = i / 15, col = mixLab(gradLab(UKIYOE, t), gradLab(DUNHUANG, 1 - t), 0.24);
      if (i % 4 === 0) col = mixLab(col, sumi, 0.72);
      var rgb = fromLab(col); out[i * 3] = rgb[0]; out[i * 3 + 1] = rgb[1]; out[i * 3 + 2] = rgb[2];
    }
    return out;
  }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------------------------------------------------------------- shaders
  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uBase, uBody; uniform mat3 uHinv;',
    'uniform int uN, uMode, uUseBase;',                                  // uMode 0 = bake into the region texture, 1 = the wall
    'uniform vec4 uA[48], uB[48], uC[48]; uniform vec3 uPal[16];',
    'uniform vec4 uRegion; uniform vec3 uGround; uniform float uHue, uPx, uPush, uBodyOn, uSeed;',
    'uniform mat3 uLookM; uniform vec3 uLookT, uRim;',                    // the look: colour map on the premultiplied ink, rim colour
    'in vec2 vUv; out vec4 o;',
    'const vec3 SUMI=vec3(18.,26.,38.)/255., GOLD=vec3(238.,196.,104.)/255., VEIN=vec3(44.,94.,122.)/255.;',
    'const float PI=3.14159265;',
    // the undeformed bath (Go step D): faint blue veins and gold ripple rings, as pigment over the ground
    'vec4 bath(vec2 p){ vec2 r=(p-vec2(640.,400.))/800.; float rad=length(r);',
    '  float wave=.5+.5*sin(rad*28.*PI+3.*atan(r.y,r.x)); float a=.16*pow(wave,8.); vec4 c=vec4(VEIN*a,a);',
    '  float kw=abs(sin(rad*14.*PI-1.5)); float gw=(1.-smoothstep(0.,.07,kw))*.24; return c*(1.-gw)+vec4(GOLD*gw,gw); }',
    // one ring band of drop i: even = pigment with a sumi meniscus at its edges, odd = clear water with a faint pigment halo
    'vec4 band(int i,float idx,float fr){ vec3 pig=uPal[int(mod(uB[i].y+floor(idx*.5),16.)+.5)]; float ed=min(fr,1.-fr)*2.;',
    '  if(mod(idx,2.)<.5) return vec4(mix(mix(pig,SUMI,.65),pig,smoothstep(0.,.65,ed)),1.);',
    '  float a=.22-.18*smoothstep(0.,.5,ed); return vec4(pig*a,a); }',
    'vec2 bodyAt(vec2 w){ vec3 h=uHinv*vec3(w,1.); vec2 k=h.xy/max(h.z,1e-6);',
    '  if(h.z<=0.||k.x<0.||k.x>1.||k.y<0.||k.y>1.) return vec2(0.,24.);',
    '  vec2 t=textureLod(uBody,k,0.).rg; return vec2(t.r,t.g*32.-8.); }',
    'vec3 hueRot(vec3 c,float a){ const vec3 k=vec3(.57735); float ca=cos(a); return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca); }',
    'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
    'void main(){',
    '  vec2 p=uMode==0?uRegion.xy+vUv*uRegion.zw:vec2(vUv.x*1280.,(1.-vUv.y)*800.);',
    '  vec2 q=p, b0=vec2(0.,24.);',
    '  if(uMode==1){',                                                  // the body presses the ink aside along the outline normal
    '    vec2 w=p/vec2(1280.,800.); b0=bodyAt(w);',
    '    vec2 g=vec2(bodyAt(w+vec2(.012,0.)).y-bodyAt(w-vec2(.012,0.)).y, bodyAt(w+vec2(0.,.02)).y-bodyAt(w-vec2(0.,.02)).y);',
    '    float gl=length(g); vec2 n=gl>1e-4?g/gl:vec2(0.);',
    '    q=p-n*uPush*uBodyOn*exp(-max(b0.y,0.)/5.)*step(0.,b0.y); }',
    '  int hit=-1; float hu=0., hth=0.;',
    '  for(int i=47;i>=0;i--){ if(i>=uN) continue; vec4 A=uA[i];',     // newest first: where did this ink come from?
    '    if(A.x<1.5){ vec2 d=q-A.yz; float d2=dot(d,d), r2=A.w*A.w;',
    '      if(d2<r2){ hit=i; hu=sqrt(d2)/max(A.w,1e-3); hth=atan(d.y,d.x); break; }',
    '      q=A.yz+d*sqrt(max(0.,1.-r2/max(d2,1e-6))); }',
    '    else if(A.x<2.5){ vec4 B=uB[i], C=uC[i]; float n=dot(q-A.yz,vec2(-B.y,B.x));',
    '      float prof=mix(sin(B.w*n+C.x),.5+.5*cos(B.w*n),C.y), an=abs(n);',
    '      q-=B.xy*(A.w*((1.-C.w)*exp(-an*C.z)+C.w*exp(-an*B.z)*prof)); }',
    '    else { float ix=uB[i].x; vec2 r=q-A.yz; float r2=dot(r,r);',
    '      if(r2*ix<9.){ float an=-A.w*exp(-r2*ix); float s=sin(an), c=cos(an); q=A.yz+vec2(r.x*c-r.y*s,r.x*s+r.y*c); } } }',
    '  float rp=0., nb=1., uM=0.;',
    '  if(hit>=0){ vec4 B=uB[hit]; nb=B.x; uM=clamp(hu+.035*sin(6.*hth+B.w)*(1.-hu)*hu,0.,1.); rp=nb*mix(uM,uM*uM,.4); }',
    '  float fw=max(fwidth(rp),1e-4);',
    '  vec4 c;',
    '  if(hit>=0){',
    '    float idx=min(floor(rp),nb-1.), fr=rp-idx;',
    '    float wl=idx>.5?.5*clamp(1.-fr/fw,0.,1.):0., wu=idx<nb-1.5?.5*clamp(1.-(1.-fr)/fw,0.,1.):0.;',
    '    c=band(hit,idx,fr)*(1.-wl-wu);',
    '    if(wl>0.) c+=band(hit,idx-1.,1.)*wl;',
    '    if(wu>0.) c+=band(hit,idx+1.,0.)*wu;',
    '    c=mix(c,.5*(band(hit,idx,.5)+band(hit,idx+1.,.5)),smoothstep(.6,1.6,fw));',   // bands finer than a pixel: their average
    '    if(uB[hit].z>.5){ float g1=1.-clamp(abs(uM-.965)/.022,0.,1.), g2=(idx>1.5&&idx<2.5)?1.-clamp(abs(fr-.5)/.045,0.,1.):0.;',
    '      float gw=max(g1,g2); gw=gw*gw*(3.-2.*gw); c=c*(1.-gw)+vec4(GOLD*1.08,1.)*gw; }',
    '  } else {',
    '    vec2 bu=(q-uRegion.xy)/uRegion.zw;',
    '    if(uUseBase==1&&bu.x>=0.&&bu.x<=1.&&bu.y>=0.&&bu.y<=1.) c=textureLod(uBase,bu,0.); else c=bath(q);',
    '  }',
    '  if(uMode==0){ o=c; return; }',
    '  c.rgb=uLookM*c.rgb+uLookT*c.a;',                                    // the look recolours baked and live ink alike
    '  vec3 col=uGround*(1.-c.a)+c.rgb;',
    '  float m=b0.x, d=abs(m-.5)/max(fwidth(m),1e-4), lw=1.5*uPx;',
    '  col*=1.-.78*smoothstep(.4,.85,m)*uBodyOn;',                         // a dim hollow where the person stands
    '  col+=uRim*exp(-d*d/(lw*lw))*.8*uBodyOn;',                           // the kintsugi rim of the meniscus
    '  col=hueRot(col,uHue);',
    '  vec2 v=vUv-.5; col*=1.-.2*smoothstep(.2,.75,length(v*vec2(1.,.8))*1.25);',
    '  col+=(hash(floor(p*uPx)+uSeed)-.5)*.022;',                          // paper grain
    '  o=vec4(clamp(col,0.,1.),1.);',
    '}'
  ].join('\n') + '\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Suminagashi needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Suminagashi needs WebGL 2');
    var made = [], dead = false;
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
    ['uBase', 'uBody', 'uHinv', 'uN', 'uMode', 'uUseBase', 'uA', 'uB', 'uC', 'uPal', 'uRegion', 'uGround', 'uHue', 'uPx', 'uPush', 'uBodyOn', 'uSeed', 'uLookM', 'uLookT', 'uRim']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    // baked region textures (ping-pong) in design space with a margin
    var maxT = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
    var bs = clamp(canvas.width / 1280, 0.5, 2) * BAKE_SCALE;
    var TW = Math.min(maxT, Math.round((1280 + 2 * MX) * bs)), TH = Math.min(maxT, Math.round((800 + 2 * MY) * bs));
    var tex = [], fbo = [], cur = 0;
    for (var t = 0; t < 2; t++) {
      var tx = gl.createTexture(); made.push(['Texture', tx]);
      gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TW, TH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fb = gl.createFramebuffer(); made.push(['Framebuffer', fb]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
      tex.push(tx); fbo.push(fb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // body: R = mask, G = sdf mapped from -8..24 cells
    var BW = WallBody.w, BH = WallBody.h, body = WallBody.create(kit, {}), bodyU8 = new Uint8Array(BW * BH * 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var btex = gl.createTexture(); made.push(['Texture', btex]);
    gl.bindTexture(gl.TEXTURE_2D, btex);
    for (var bi = 0; bi < BW * BH; bi++) { bodyU8[bi * 2] = 0; bodyU8[bi * 2 + 1] = 255; }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, BW, BH, 0, gl.RG, gl.UNSIGNED_BYTE, bodyU8);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var PAL = pigments(), UA = new Float32Array(NOPS * 4), UB = new Float32Array(NOPS * 4), UC = new Float32Array(NOPS * 4);
    var settings = {look: 0, ink: 50, comb: 50, swirl: 50, paper: 0, hue: 0};
    var LK = LOOKS[0], over = {ink: false, swirl: false, paper: false}, looks = 0, ek = {ink: LK.ink, swirl: LK.swirl};
    var lmNow = new Float32Array(9), ltNow = new Float32Array(3), lmGo = new Float32Array(9), ltGo = new Float32Array(3);
    var rimNow = new Float32Array(3), rimGo = new Float32Array(3), groundNow = SUMI.slice();
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    function lookTargets() {
      lookMap(LK.map, lmGo, ltGo);
      for (var r = 0; r < 3; r++) { var v = ltGo[r]; for (var c = 0; c < 3; c++) v += lmGo[c * 3 + r] * GOLD_C[c] / 255; rimGo[r] = v; }   // the rim: gold through the map
    }
    function applyLook(i) { LK = LOOKS[i]; over.ink = over.swirl = over.paper = false; lookTargets(); looks++; }
    function stepLook(dt) {
      var ks = 1 - Math.exp(-dt / SHAPE_TAU), kp = 1 - Math.exp(-dt / PAL_TAU), i;
      ek.ink += (want('ink') - ek.ink) * ks; ek.swirl += (want('swirl') - ek.swirl) * ks;
      for (i = 0; i < 9; i++) lmNow[i] += (lmGo[i] - lmNow[i]) * kp;
      for (i = 0; i < 3; i++) { ltNow[i] += (ltGo[i] - ltNow[i]) * kp; rimNow[i] += (rimGo[i] - rimNow[i]) * kp; groundNow[i] += (LK.ground[i] - groundNow[i]) * kp; }
    }
    function snapLook() { lookTargets(); lmNow.set(lmGo); ltNow.set(ltGo); rimNow.set(rimGo); groundNow = LK.ground.slice(); ek.ink = want('ink'); ek.swirl = want('swirl'); paperNow = want('paper'); }
    var hueFlow = refreshHue(0), paperNow = 0, input = refreshContacts(kit, 120);
    var ops = [], tracks = [], people = {}, nextTrack = 1, rand = rng(202605);
    var out = null, lastNote = 0, time = 0, frames = 0, frameMs = 0, lastContact = -1e9, idleRakeAt = 2.5, idleDropAt = 8, idleSwirlAt = 20;
    var stats = {drops: 0, rakes: 0, swirls: 0, bakes: 0, baked: 0, bodyRakes: 0, forced: 0}, dropCount = 0, holdSign = 1, holdCount = 0, contactsNow = 0, bodyCount = 0;

    // ---------------------------------------------------------------- operations
    function addDrop(x, y, r, rings, tau) {
      var o = {type: 1, x: x, y: y, v: 0, target: r, tau: tau, open: false, nb: 2 * rings - 1, ci: (dropCount * 3) % 16, gold: dropCount % 3 === 0 ? 1 : 0, phase: rand() * 6.283};
      dropCount++; stats.drops++; ops.push(o); return o;
    }
    // a rake: shift along the stroke = v * ((1 - mix) * stylus(n) + mix * comb(n)), n = distance across the stroke line
    function addRake(x, y, dx, dy, width, spacing, bias, phase, tau, stylusW, mix) {
      var l = Math.hypot(dx, dy) || 1;
      var o = {type: 2, x: x, y: y, v: 0, target: 0, tau: tau, open: true, dx: dx / l, dy: dy / l, invW: 1 / Math.max(1, width), freq: 6.2832 / Math.max(8, spacing), phase: phase, bias: bias,
               invS: stylusW ? 1 / Math.max(1, stylusW) : 0, mix: mix === undefined ? 1 : clamp(mix, 0, 1)};
      stats.rakes++; ops.push(o); return o;
    }
    function addSwirl(x, y, rv, tau) {
      var o = {type: 3, x: x, y: y, v: 0, target: 0, tau: tau, open: true, invR2: 1 / (rv * rv)};
      stats.swirls++; ops.push(o); return o;
    }
    function eps(o) { return o.type === 3 ? 0.002 : 0.3; }               // close enough that snapping moves the ink by under ~0.3 px
    function settled(o) { return !o.open && Math.abs(o.target - o.v) <= eps(o); }
    function stepOps(dt) {
      for (var i = 0; i < ops.length; i++) {
        var o = ops[i]; o.v += (o.target - o.v) * (1 - Math.exp(-dt / Math.max(0.02, o.tau)));
        if (!o.open && Math.abs(o.target - o.v) <= eps(o)) o.v = o.target;
      }
    }
    function pack(from, count) {
      UA.fill(0); UB.fill(0); UC.fill(0);
      for (var i = 0; i < count && i < NOPS; i++) {
        var o = ops[from + i], j = i * 4;
        if (!o) continue;
        UA[j] = o.type; UA[j + 1] = o.x; UA[j + 2] = o.y; UA[j + 3] = Number.isFinite(o.v) ? o.v : 0;
        if (o.type === 1) { UB[j] = o.nb; UB[j + 1] = o.ci; UB[j + 2] = o.gold; UB[j + 3] = o.phase; }
        else if (o.type === 2) { UB[j] = o.dx; UB[j + 1] = o.dy; UB[j + 2] = o.invW; UB[j + 3] = o.freq; UC[j] = o.phase; UC[j + 1] = o.bias; UC[j + 2] = o.invS; UC[j + 3] = o.mix; }
        else { UB[j] = o.invR2; }
      }
      gl.uniform4fv(U.uA, UA); gl.uniform4fv(U.uB, UB); gl.uniform4fv(U.uC, UC);
      gl.uniform1i(U.uN, Math.min(count, NOPS));
    }
    function common() {
      gl.useProgram(prog); gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.uniform3fv(U.uPal, PAL); gl.uniform4f(U.uRegion, -MX, -MY, 1280 + 2 * MX, 800 + 2 * MY);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex[cur]); gl.uniform1i(U.uBase, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, btex); gl.uniform1i(U.uBody, 1);
      gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
    }
    function bake(count, useBase) {   // render base + ops[0..count) into the other texture, then forget those ops
      count = Math.min(count, ops.length, NOPS);
      common();
      gl.uniform1i(U.uMode, 0); gl.uniform1i(U.uUseBase, useBase ? 1 : 0);
      pack(0, count);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1 - cur]); gl.viewport(0, 0, TW, TH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      cur = 1 - cur;
      for (var i = 0; i < count; i++) ops[i].baked = true;
      ops.splice(0, count); stats.bakes++; stats.baked += count;
    }
    function maybeBake() {
      if (ops.length <= BAKE_AT) return;
      var k = 0;
      while (k < ops.length - KEEP && settled(ops[k])) k++;
      var need = ops.length >= NOPS ? ops.length - (NOPS - 8) : 0;      // full: the newest ops must never fall off the uniform arrays
      if (k < need) {                                                   // freeze the oldest still-moving ops (a long hold or drag continues in a fresh op)
        for (var i = k; i < need; i++) { ops[i].target = ops[i].v; ops[i].open = false; }
        k = need; stats.forced++;
      }
      if (k > 0) bake(k, true);
    }

    // the opening bath: a phyllotaxis of ring sets like the Go engine, combed twice and twisted once
    (function opening() {
      var N = 22, golden = Math.PI * (3 - Math.sqrt(5));
      for (var k = 0; k < N; k++) {
        var u = (k + 0.5) / N, rf = 0.44 * Math.sqrt(u), th = k * golden + (rand() - 0.5) * 0.45;
        var cx = 1280 * (0.5 + rf * Math.cos(th) + (rand() - 0.5) * 0.12), cy = 800 * (0.5 + rf * Math.sin(th) + (rand() - 0.5) * 0.12);
        var r = 800 * (0.14 + 0.12 * rand()) * (1 - 0.52 * Math.pow(u, 0.85));
        var d = addDrop(cx, cy, r, 3 + (k * 3) % 5, 0.2); d.v = d.target;
      }
      for (var i = 0; i < 2; i++) {
        var ang = 0.22 * Math.PI + (i % 2) * 0.48 * Math.PI + (rand() - 0.5) * 0.38, tt = i;
        var rk = addRake(1280 * (0.18 + 0.64 * tt), 800 * (0.18 + 0.64 * (1 - tt)), Math.cos(ang), Math.sin(ang), 800 * (0.45 + 0.18 * rand()), 360 + 60 * i, 0, i * 1.15 + rand() * 3.14, 1);
        rk.target = rk.v = 22 + 8 * i; rk.open = false;
      }
      var sw = addSwirl(640 + 220, 400 - 90, 800 * 0.24, 1); sw.target = sw.v = 1.2; sw.open = false;
      bake(ops.length, false);
      stats.drops = stats.rakes = stats.swirls = stats.bakes = stats.baked = 0;
    })();

    // ---------------------------------------------------------------- hands
    function inkR() { return 70 + ek.ink * 2.0; }                 // drop radius (px): 70..270, 170 at the default
    function combGain() { return settings.comb / 50 * 0.8; }             // how much of the finger's travel the tines carry
    function rakeFrom(tr, dx, dy) {
      tr.rake = addRake(tr.x, tr.y, dx, dy, 240 + settings.comb * 1.2, 120, 1, 0, 0.12, 60, 0.25 + settings.comb * 0.004);
    }
    function updateTracks(pts, dt) {
      tracks.forEach(function (t) { t.seen = false; });
      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0] * 1280, y = pts[i][1] * 800, best = null, bd = 110;
        for (var j = 0; j < tracks.length; j++) { var t = tracks[j]; if (t.seen) continue; var d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } }
        if (!best) {                                                   // a new fingertip: a ring set blooms here (tap)
          best = {id: nextTrack++, x: x, y: y, ax: x, ay: y, vx: 0, vy: 0, still: 0, rake: null, swirl: null, age: 0};
          tracks.push(best);
          addDrop(x, y, inkR() * (0.85 + 0.3 * rand()), 3 + (dropCount % 5), 0.22);
        }
        best.seen = true; best.nx = x; best.ny = y;
      }
      for (var k = tracks.length - 1; k >= 0; k--) {
        var tr = tracks[k];
        if (!tr.seen) { if (tr.rake) tr.rake.open = false; if (tr.swirl) tr.swirl.open = false; tracks.splice(k, 1); continue; }
        if (tr.rake && tr.rake.baked) tr.rake = null;
        if (tr.swirl && tr.swirl.baked) tr.swirl = null;
        var ddx = tr.nx - tr.x, ddy = tr.ny - tr.y; tr.x = tr.nx; tr.y = tr.ny; tr.age += dt;
        var kv = 1 - Math.exp(-dt / 0.08); tr.vx += (ddx / Math.max(dt, 1e-3) - tr.vx) * kv; tr.vy += (ddy / Math.max(dt, 1e-3) - tr.vy) * kv;
        // hold: a still finger grows a swirl under it
        if (Math.hypot(tr.x - tr.ax, tr.y - tr.ay) < 16) tr.still += dt; else { tr.still = 0; tr.ax = tr.x; tr.ay = tr.y; if (tr.swirl) { tr.swirl.open = false; tr.swirl = null; } }
        if (tr.still > 0.7) {
          if (!tr.swirl || Math.abs(tr.swirl.target) > 9.5) {             // a very long hold continues in a fresh swirl op
            var sign = tr.swirl ? tr.swirl.sign : holdSign;
            if (tr.swirl) tr.swirl.open = false; else holdSign = -holdSign;
            var oa = holdCount++ * 2.39996, off = 0.45 * inkR();           // off-centre: a swirl about a drop's own centre would leave its rings unchanged
            tr.swirl = addSwirl(tr.ax + Math.cos(oa) * off, tr.ay + Math.sin(oa) * off, 120 + ek.swirl * 1.2, 0.3); tr.swirl.sign = sign;
          }
          tr.swirl.target += tr.swirl.sign * (0.6 + ek.swirl * 0.04) * dt;   // 2.6 rad/s at the default
        }
        // drag: a tine rake that follows the finger; a turn or a sideways drift starts a new stroke
        var sp = Math.hypot(tr.vx, tr.vy), step = Math.hypot(ddx, ddy);
        if (step > 0.3 && sp > 40) {
          var ux = tr.vx / sp, uy = tr.vy / sp;
          if (!tr.rake) { if (Math.hypot(tr.x - tr.ax, tr.y - tr.ay) > 6 || sp > 120) rakeFrom(tr, ux, uy); }
          else {
            var o = tr.rake, perp = Math.abs((tr.x - o.x) * -o.dy + (tr.y - o.y) * o.dx), cosA = ux * o.dx + uy * o.dy;
            if (perp > 26 || cosA < 0.86) { o.open = false; rakeFrom(tr, ux, uy); }
            else o.target += Math.max(0, ddx * o.dx + ddy * o.dy) * combGain();
          }
        }
        if (tr.rake && sp < 15) { tr.rake.open = false; tr.rake = null; }
      }
    }

    // ---------------------------------------------------------------- bodies
    function updateBodies(dt) {
      var seen = {}, list = body.fresh ? body.people : [];
      bodyCount = list.length;
      for (var i = 0; i < list.length && i < 4; i++) {
        var p = list[i]; if (!p || !Number.isFinite(p.cx) || !Number.isFinite(p.cy)) continue;
        var s = kit.toScreen(p.cx * 512, p.cy * 424), x = s ? s[0] * 1280 : p.cx * 1280, y = s ? s[1] * 800 : p.cy * 800;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        var b = people[p.id];
        if (!b) b = people[p.id] = {x: x, y: y, vx: 0, vy: 0, rake: null};
        seen[p.id] = true;
        var k = 1 - Math.exp(-dt / 0.15), ox = b.x, oy = b.y;
        b.x += (x - b.x) * k; b.y += (y - b.y) * k;
        var mx = b.x - ox, my = b.y - oy, kv = 1 - Math.exp(-dt / 0.2);
        b.vx += (mx / Math.max(dt, 1e-3) - b.vx) * kv; b.vy += (my / Math.max(dt, 1e-3) - b.vy) * kv;
        if (b.rake && b.rake.baked) b.rake = null;
        var sp = Math.hypot(b.vx, b.vy), hpx = clamp((p.bottom - p.top) * 800 * 0.35, 120, 300);
        if (sp > 45) {
          var ux = b.vx / sp, uy = b.vy / sp;
          if (b.rake) {
            var o = b.rake, perp = Math.abs((b.x - o.x) * -o.dy + (b.y - o.y) * o.dx);
            if (perp > 60 || ux * o.dx + uy * o.dy < 0.77) { o.open = false; b.rake = null; }
          }
          if (!b.rake) { b.rake = addRake(b.x, b.y, ux, uy, hpx * 2, hpx * 1.2, 1, 0, 0.3, hpx, 0.4); stats.bodyRakes++; }
          b.rake.target += Math.max(0, mx * b.rake.dx + my * b.rake.dy) * 0.5 * settings.comb / 50;
        } else if (b.rake && sp < 20) { b.rake.open = false; b.rake = null; }
      }
      Object.keys(people).forEach(function (id) { if (!seen[id]) { if (people[id].rake) people[id].rake.open = false; delete people[id]; } });
    }

    // ---------------------------------------------------------------- idle: the bath keeps drifting
    function idle() {
      if (time - lastContact < IDLE_AFTER_S) return;
      if (time >= idleRakeAt) {
        idleRakeAt = time + IDLE_RAKE_S * (0.8 + 0.4 * rand());
        var a = rand() * Math.PI * 2, o = addRake(200 + rand() * 880, 150 + rand() * 500, Math.cos(a), Math.sin(a), 320, 260 + rand() * 160, 0.25, rand() * 6.28, 2.2);
        o.target = 18 + rand() * 14; o.open = false;
      }
      if (time >= idleDropAt) {
        idleDropAt = time + IDLE_DROP_S * (0.8 + 0.4 * rand());
        addDrop(180 + rand() * 920, 130 + rand() * 540, 80 + rand() * 90, 3 + (dropCount % 5), 1.4);
      }
      if (time >= idleSwirlAt) {
        idleSwirlAt = time + IDLE_SWIRL_S * (0.8 + 0.4 * rand());
        var sw = addSwirl(240 + rand() * 800, 160 + rand() * 480, 170 + rand() * 80, 3.5); sw.target = (rand() < 0.5 ? -1 : 1) * (0.9 + rand() * 0.6); sw.open = false;
      }
    }

    function frame(dt, now) {
      if (dead) return;
      var at = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      hueFlow.step(settings.hue, dt);
      stepLook(dt);
      paperNow += (want('paper') - paperNow) * (1 - Math.exp(-dt / 0.25));
      var fresh = body.update(dt, now);
      var pts = input.read(); contactsNow = pts.length;
      if (pts.length) lastContact = time;
      updateTracks(pts, dt);
      updateBodies(dt);
      idle();
      stepOps(dt);
      maybeBake();
      if (fresh || !body.fresh) {
        var mask = body.mask, sdf = body.sdf;
        for (var i = 0; i < BW * BH; i++) {
          var m = mask[i], s = sdf[i];
          bodyU8[i * 2] = (Number.isFinite(m) ? clamp(m, 0, 1) : 0) * 255;
          bodyU8[i * 2 + 1] = (Number.isFinite(s) ? clamp((s + 8) / 32, 0, 1) : 1) * 255;
        }
        gl.bindTexture(gl.TEXTURE_2D, btex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RG, gl.UNSIGNED_BYTE, bodyU8);
      }
      // the wall
      common();
      var pf = clamp(paperNow / 100, 0, 1) * 0.92;
      var G0 = groundNow;                                                 // the look's dark end (SUMI in the original)
      gl.uniform3f(U.uGround, (G0[0] + (CREAM[0] - G0[0]) * pf) / 255, (G0[1] + (CREAM[1] - G0[1]) * pf) / 255, (G0[2] + (CREAM[2] - G0[2]) * pf) / 255);
      gl.uniformMatrix3fv(U.uLookM, false, lmNow); gl.uniform3fv(U.uLookT, ltNow); gl.uniform3fv(U.uRim, rimNow);
      gl.uniform1i(U.uMode, 1); gl.uniform1i(U.uUseBase, 1);
      gl.uniform1f(U.uHue, hueFlow.value * Math.PI / 180); gl.uniform1f(U.uPx, canvas.width / 1280);
      gl.uniform1f(U.uPush, PUSH_PX); gl.uniform1f(U.uBodyOn, 1); gl.uniform1f(U.uSeed, (frames % 64) * 7.31);
      pack(0, ops.length);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
      frameMs = performance.now() - at;
      if (window.WallTest && out && out.debug && time - lastNote >= 2) {   // sandbox only: the interaction numbers land in the smoke run's JSON
        lastNote = time; try { console.warn('suminagashi debug ' + JSON.stringify(out.debug())); } catch (e) {}
      }
    }

    function set(opts) {
      if (opts && !dead) {
        var lk = opts.look;                                               // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, 0, LOOKS.length - 1)); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['ink', 'comb', 'swirl', 'paper', 'hue'].forEach(function (k) {
          var v = opts[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
          v = k === 'hue' ? clamp(v, 0, 360) : clamp(v, 0, 100);
          if (k in over) { if (v !== settings[k]) { settings[k] = v; over[k] = true; } }   // a knob that MOVED overrides the look until the next look
          else settings[k] = v;
        });
      }
      return Object.assign({}, settings);
    }
    function wake(x, y) { if (!dead) input.wake(x, y); }
    function destroy() {
      if (dead) return; dead = true;
      kit.wantDepth(false);
      if (window.SuminagashiSet === set) delete window.SuminagashiSet;
      if (window.SuminagashiWake === wake) delete window.SuminagashiWake;
      input.clear(); ops = []; tracks = []; people = {};
      try { gl.bindFramebuffer(gl.FRAMEBUFFER, null); } catch (e) {}
      made.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); made = [];
    }

    kit.wantDepth(true);
    window.SuminagashiSet = set; window.SuminagashiWake = wake;
    if (window._suminagashiFx) set(window._suminagashiFx);
    LK = LOOKS[settings.look]; snapLook(); hueFlow.snap(settings.hue);     // start on the stored look and knobs without easing in
    out = {frame: frame, touch: function (t) { if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) wake(t.x, t.y); }, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      var held = 0; tracks.forEach(function (t) { if (t.swirl) held = Math.max(held, Math.abs(t.swirl.target)); });
      return {frames: frames, ops: ops.length, contacts: contactsNow, tracks: tracks.length, bodies: bodyCount, bodyTracks: Object.keys(people).length,
              drops: stats.drops, rakes: stats.rakes, swirls: stats.swirls, bodyRakes: stats.bodyRakes, bakes: stats.bakes, baked: stats.baked, forced: stats.forced,
              holdSwirl: +held.toFixed(3), frameMs: +frameMs.toFixed(2), texture: [TW, TH], displayHue: +hueFlow.value.toFixed(2),
              look: LK.name, looks: looks, overrides: Object.assign({}, over), eased: {ink: +ek.ink.toFixed(2), swirl: +ek.swirl.toFixed(2), paper: +paperNow.toFixed(2)},
              settings: set(), glError: gl.getError()};
    };
    return out;
  }
})();
