/* Girih (girih) -- genart build-out 2026-10-22, Builder D. Port of jdxyw/generativeart islamicstar.go.
 * Hankin's polygons-in-contact over the 4.8.8 octagon-square tiling: from the midpoint of every polygon edge two rays leave at the
 * contact angle and run until they meet the rays of the neighbouring edges; the strapwork they make is drawn as gold straps with an
 * ivory centre line and a dark casing, truly interlaced (over at every star crossing, under at every edge crossing, which alternates
 * along every strand), over dim cloisonne enamel with gold medallions and pearls at the star centres.
 * Live: the contact angle is the hero. A hand's x sets it (30..75 degrees: fat rosettes at the left, thin spindles at the right) for
 * every star on the wall at once, its height sets the strap width; with two hands the angle runs across the wall from the left
 * hand's value to the right hand's. A tap sends a gold pulse outward along the straps; a still hand floods the stars around it with
 * a slow cloisonne colour wash; a body lights the tiles behind it ivory and thickens their straps. Idle: the angle breathes around
 * the knob value with a slow wave crossing the wall.
 * WebGL2, one full-screen fragment pass: each pixel finds its octagon or square, folds itself into the polygon's symmetry wedge and
 * measures exact distances to the Hankin rays (angle evaluated at the polygon centre). No audio, no network, no assets. ASCII only.
 * Looks (2026-11-01): named presets of the eleven palette colours, the enamel brightness and three shape values (stars across,
 * star angle, strap width). Picking one eases the palette over ~0.8 s and the shape over ~1.2 s (the grid zooms, the stars morph);
 * a moved knob overrides the look's own value until the next look. Look 0 (lapis) is the original picture.
 */
(function () {
  'use strict';
  registerWallPlugin({id: 'girih', title: 'Girih', author: 'Claude Opus 5.5 (genart builder D)', create: create});

  // contacts and hue easing: the refresh idiom from lab/plugins/prismpathsflow.js (a 120 ms dropout is not a release)
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

  var MAXPULSE = 6, MAXHOLD = 2;
  var PULSE_SPEED = 400, PULSE_LIFE = 3.6;       // tap pulse: px/s along the wall, seconds to fade
  var HOLD_S = 0.8, WASH_R0 = 90, WASH_R1 = 380, WASH_GROW = 3.5, WASH_FADE = 3.0;
  var A_MIN = 30, A_MAX = 75;                    // contact angle range a hand sweeps (degrees)

  // Looks: palette [casing, strap, core, filigree, ground, malachite, azurite, cinnabar, ochre, body light, tap glow] (0..255),
  // enamel brightness (dim), and the three shape knobs. Look 0 is the original picture (the shader's old constants, the knob defaults).
  var LOOKS = [
    {name: 'lapis', dim: 0.30, grid: 7, angle: 60, strap: 6,
     pal: [[12, 15, 24], [238, 204, 136], [252, 243, 220], [218, 172, 92], [14, 24, 42], [46, 107, 94], [63, 127, 166], [181, 69, 47], [217, 168, 78], [219.3, 204, 168.3], [255, 247.35, 219.3]]},
    {name: 'zellige', dim: 0.34, grid: 9, angle: 67, strap: 4.5,
     pal: [[6, 20, 18], [236, 240, 230], [40, 90, 190], [60, 120, 108], [5, 30, 27], [22, 128, 84], [34, 84, 178], [196, 86, 44], [232, 184, 64], [196, 232, 214], [255, 252, 236]]},
    {name: 'ink', dim: 1.0, grid: 6, angle: 45, strap: 8,
     pal: [[196, 186, 166], [24, 22, 30], [244, 236, 218], [168, 158, 138], [226, 216, 194], [176, 190, 178], [150, 164, 186], [206, 128, 106], [216, 196, 150], [74, 84, 128], [206, 44, 30]]},
    {name: 'ember', dim: 0.30, grid: 7, angle: 52, strap: 7,
     pal: [[10, 4, 2], [255, 122, 40], [255, 222, 140], [124, 42, 12], [18, 5, 4], [122, 22, 12], [92, 30, 18], [204, 52, 20], [232, 132, 30], [255, 170, 90], [255, 242, 200]]},
    {name: 'neon', dim: 0.28, grid: 8, angle: 72, strap: 3,
     pal: [[0, 0, 0], [40, 240, 255], [255, 255, 255], [64, 22, 124], [3, 2, 10], [124, 32, 206], [22, 62, 224], [255, 30, 140], [255, 204, 40], [200, 120, 255], [255, 255, 255]]},
    {name: 'moonlit', dim: 0.30, grid: 10, angle: 38, strap: 5,
     pal: [[4, 6, 12], [200, 210, 226], [250, 252, 255], [70, 80, 100], [6, 8, 16], [60, 70, 92], [92, 106, 132], [122, 132, 152], [152, 162, 182], [210, 220, 240], [240, 245, 255]]}
  ];
  var NPAL = 11, PAL_TAU = 0.25, SHAPE_TAU = 0.4;   // palette settles in ~0.8 s, shape in ~1.2 s

  var VS = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS = [
    '#version 300 es',
    'precision highp float; precision highp int;',
    'uniform vec2 uRes; uniform float uPx, uTime, uGrid, uStrap, uHue, uA0, uHW;',
    'uniform vec4 uHL;',                               // hand angle field: left x (px), left angle, right x, right angle
    'uniform vec4 uPulse[6]; uniform int uNP;',        // x, y, radius, strength
    'uniform vec4 uHold[2]; uniform int uNH;',         // x, y, radius, strength
    'uniform vec4 uTouch[4]; uniform int uNT;',        // live contacts: x, y, -, strength
    'uniform sampler2D uMask; uniform mat3 uHinv; uniform float uBody;',
    'out vec4 o;',
    'const vec2 CEN = vec2(640., 400.);',
    'const float PI4 = .78539816, PI8 = .39269908, PI2 = 1.5707963, TAU = 6.2831853, R2 = .70710678;',
    'uniform vec3 uPal[11]; uniform float uDim;',     // the look's palette (eased in JS) and enamel brightness
    '#define CASING uPal[0]',
    '#define GOLD uPal[1]',
    '#define IVORY uPal[2]',
    '#define FILI uPal[3]',
    '#define LAPIS uPal[4]',
    '#define MAL uPal[5]',
    '#define AZU uPal[6]',
    '#define CIN uPal[7]',
    '#define OCH uPal[8]',
    '#define BODYC uPal[9]',
    '#define GLOWC uPal[10]',
    'float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }',
    'float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }',
    'float side(vec2 p, vec2 a, vec2 b){ vec2 d = b - a; return d.x * (p.y - a.y) - d.y * (p.x - a.x); }',
    'float cov(float d, float hw){ return clamp((hw - d) / uPx + .5, 0., 1.); }',
    'vec3 hueRot(vec3 c, float a){ vec3 k = vec3(.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca); }',
    'float maskAt(vec2 p){ vec3 h = uHinv * vec3(p / vec2(1280., 800.), 1.); vec2 k = h.xy / max(h.z, 1e-6);',
    '  float inK = (h.z > 0. && k.x >= 0. && k.x <= 1. && k.y >= 0. && k.y <= 1.) ? 1. : 0.; return texture(uMask, clamp(k, 0., 1.)).r * inK * uBody; }',
    // the contact angle (degrees) at a polygon centre: idle breathing, or the hands' field across the wall
    'float angleAt(vec2 c){',
    '  float idle = uA0 + 6. * sin(uTime * .29) + 5. * sin(c.x * .0042 + c.y * .0021 - uTime * .23);',
    '  float hand = mix(uHL.y, uHL.w, clamp((c.x - uHL.x) / max(uHL.z - uHL.x, 1.), 0., 1.));',
    '  return clamp(mix(idle, hand, uHW), 32., 78.); }',
    'void strap(inout vec3 col, float d, float sw, vec3 gold, float core){',
    '  col = mix(col, CASING, .92 * cov(d, .86 * sw));',
    '  col = mix(col, gold, .96 * cov(d, .52 * sw));',
    '  col = mix(col, IVORY, .72 * cov(d, core * sw)); }',
    'void main(){',
    '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * vec2(1280., 800.) / uRes;',
    '  float S = 1280. / uGrid, a = S * .5;',
    '  vec2 q = p - CEN, ij = floor(q / S + .5), l = q - ij * S;',
    '  bool oct = abs(l.x) + abs(l.y) <= a * 1.41421356;',
    '  vec2 sg = vec2(l.x >= 0. ? 1. : -1., l.y >= 0. ? 1. : -1.);',
    '  vec2 pc = oct ? CEN + ij * S : CEN + (ij + .5 * sg) * S;',   // this polygon's centre
    '  if (!oct) l -= sg * a;',
    '  float alpha = radians(angleAt(pc)), psi = max(PI2 - alpha, .14);',
    '  float mB = maskAt(pc), mP = maskAt(p);',
    '  float sw = min(max(1.6, uStrap * S / 183.), S * .085) * (1. + .75 * mP), core = .15 + .12 * mP, ext = sw * 2.;',
    '  float dP, dM, ord, fillT, kIdx, dIn = 1e5, dMed = 1e5, dBound;',
    '  vec2 hv;',
    '  if (oct) {',
    '    float th = atan(l.y, l.x); if (th < 0.) th += TAU;',
    '    float k = floor(th / PI4); vec2 v = rot(l, -k * PI4);',
    '    float r1 = a * sin(psi) / sin(PI8 + psi), r2 = a * sin(psi) / sin(PI4 + psi);',
    '    vec2 M0 = vec2(a, 0.), M1 = a * vec2(R2), P0 = r1 * vec2(cos(PI8), sin(PI8)), Q0 = r2 * vec2(R2), Qm = vec2(r2, 0.);',
    '    vec2 A0 = M0 + normalize(M0 - Q0) * ext, B0 = M1 + normalize(M1 - Qm) * ext;',
    '    vec2 vp = rot(v, -PI4), vm = rot(v, PI4);',
    '    dP = min(sdSeg(v, A0, Q0), min(sdSeg(vp, A0, Q0), sdSeg(vm, A0, Q0)));',
    '    dM = min(sdSeg(v, B0, Qm), min(sdSeg(vp, B0, Qm), sdSeg(vm, B0, Qm)));',
    '    float cP = length(v - P0), cM = min(length(v - M0), length(v - M1)), cQ = min(length(v - Q0), length(v - Qm));',
    '    ord = cP < min(cM, cQ) ? 0. : (cM < cQ ? 1. : 2.);',
    '    bool refl = v.y * .92387953 > v.x * .38268343;',
    '    hv = refl ? R2 * vec2(v.x + v.y, v.x - v.y) : v;',
    '    bool corner = side(hv, M0, P0) * side(vec2(0.), M0, P0) < 0.;',
    '    bool star = side(hv, Qm, P0) * side(vec2(0.), Qm, P0) > 0.;',
    '    fillT = corner ? 2. : (star ? 0. : 1.);',
    '    kIdx = k + (refl ? 1. : 0.);',
    '    if (star) { vec2 t1 = vec2(.88 * r2, 0.), t2 = .46 * r2 * vec2(cos(PI8), sin(PI8));',
    '      dIn = sdSeg(hv, t1, t2);',
    '      dMed = sdSeg(hv, t1 * .52, t2 * .52) * (side(hv, t1 * .52, t2 * .52) * side(vec2(0.), t1 * .52, t2 * .52) > 0. ? -1. : 1.); }',
    '    dBound = a - max(max(abs(l.x), abs(l.y)), (abs(l.x) + abs(l.y)) * R2);',
    '  } else {',
    '    float as = a * (1.41421356 - 1.);',
    '    float th = atan(l.y, l.x) - PI4; th = mod(th, TAU);',
    '    float k = floor(th / PI2); vec2 v = rot(l, -(PI4 + k * PI2));',
    '    float r1 = as * sin(psi) / sin(PI4 + psi);',
    '    vec2 M0 = vec2(as, 0.), M1 = vec2(0., as), P0 = r1 * vec2(R2);',
    '    vec2 A0 = M0 + normalize(M0 - P0) * ext, B0 = M1 + normalize(M1 - P0) * ext;',
    '    vec2 vp = rot(v, -PI2), vm = rot(v, PI2);',
    '    dP = min(sdSeg(v, A0, P0), min(sdSeg(vp, A0, P0), sdSeg(vm, A0, P0)));',
    '    dM = min(sdSeg(v, B0, P0), min(sdSeg(vp, B0, P0), sdSeg(vm, B0, P0)));',
    '    float cP = length(v - P0), cM = min(length(v - M0), length(v - M1));',
    '    ord = cM < cP ? 1. : 2.;',
    '    hv = v.y > v.x ? v.yx : v;',
    '    bool star = side(hv, M0, P0) * side(vec2(0.), M0, P0) > 0.;',
    '    fillT = star ? 3. : 4.;',
    '    kIdx = k;',
    '    if (star) dMed = sdSeg(hv, M0 * .54, P0 * .54) * (side(hv, M0 * .54, P0 * .54) * side(vec2(0.), M0 * .54, P0 * .54) > 0. ? -1. : 1.);',
    '    dBound = as * 1.41421356 * R2 - (abs(l.x) + abs(l.y)) * R2;',
    '  }',
    // enamel: dim by default, a hold floods it with colour, a body lights it ivory
    '  float hp = h21(floor(pc / S * 2. + .5) + 3.7);',
    '  vec3 jewel = fillT == 0. ? (hp < .34 ? AZU : hp < .67 ? MAL : CIN) :',
    '               fillT == 1. ? (mod(kIdx, 2.) < .5 ? OCH : mix(AZU, MAL, .35)) :',
    '               fillT == 2. ? mix(AZU, LAPIS, .45) :',
    '               fillT == 3. ? (hp < .5 ? CIN : OCH) : mix(MAL, LAPIS, .4);',
    '  float wash = 0.;',
    '  for (int i = 0; i < 2; i++) { if (i >= uNH) break; vec4 h = uHold[i]; wash = max(wash, h.w * smoothstep(h.z, h.z * .62, length(pc - h.xy))); }',
    '  float dE = min(dP, dM) - .86 * sw;',
    '  float shade = smoothstep(0., 16., dE);',
    '  vec3 deep = jewel * .55, lum = mix(jewel * 1.12, IVORY, .18);',
    '  vec3 enamel = mix(deep, lum, shade);',
    '  vec3 col = mix(LAPIS + jewel * .07, enamel * mix(uDim, 1., wash), mix(.55, 1., wash));',
    '  col = mix(col, mix(col, BODYC, .55), .62 * mB);',
    // construction lines, inner filigree star, gold medallion, pearl
    '  col = mix(col, FILI, .28 * cov(abs(dBound), .45));',
    '  col = mix(col, IVORY, .5 * cov(dIn, .55));',
    '  col = mix(col, GOLD * (.8 + .4 * wash), .85 * cov(dMed, 0.));',
    '  float pr = length(p - pc);',
    '  col += GOLD * .30 * exp(-pr * pr / (S * S * .0009)) + IVORY * .7 * cov(pr, S * .014);',
    // straps, interlaced: plus over at star crossings, minus over at edge crossings, one joined strap at the turns
    '  float glow = 0.;',
    '  for (int i = 0; i < 6; i++) { if (i >= uNP) break; vec4 u = uPulse[i]; float e = (length(p - u.xy) - u.z) / 46.; glow += u.w * exp(-e * e); }',
    '  for (int i = 0; i < 4; i++) { if (i >= uNT) break; vec4 u = uTouch[i]; float e = length(p - u.xy) / 150.; glow += .55 * u.w * exp(-e * e); }',
    '  glow = min(glow, 1.4);',
    '  vec3 gold = mix(GOLD, GLOWC, min(glow, 1.)) * (1. + .35 * glow);',
    '  col += GOLD * .07 * glow;',
    '  if (ord < .5) { strap(col, dM, sw, gold, core); strap(col, dP, sw, gold, core); }',
    '  else if (ord < 1.5) { strap(col, dP, sw, gold, core); strap(col, dM, sw, gold, core); }',
    '  else strap(col, min(dP, dM), sw, gold, core);',
    '  col *= .96 + .07 * h21(floor(p * 1.5));',
    '  float rv = length((p - CEN) / vec2(640., 400.));',
    '  col *= 1. - .25 * smoothstep(.5, 1.45, rv);',
    '  o = vec4(clamp(hueRot(col, uHue), 0., 1.), 1.);',
    '}'
  ].join('\n');

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function create(canvas, kit) {
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false});
    if (!gl) throw new Error('Girih needs WebGL2');
    var dead = false;
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { var log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('Girih shader: ' + log); }
      return s;
    }
    var vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS), prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Girih link: ' + gl.getProgramInfoLog(prog));
    var vao = gl.createVertexArray(), U = {};
    ['uRes', 'uPx', 'uTime', 'uGrid', 'uStrap', 'uHue', 'uA0', 'uHW', 'uHL', 'uPulse', 'uNP', 'uHold', 'uNH', 'uTouch', 'uNT', 'uMask', 'uHinv', 'uBody', 'uPal', 'uDim']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.useProgram(prog); gl.uniform1i(U.uMask, 0);

    var body = WallBody.create(kit), BW = body.w, BH = body.h, maskBytes = new Uint8Array(BW * BH);
    var maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, BW, BH, 0, gl.RED, gl.UNSIGNED_BYTE, maskBytes);
    var pulseBuf = new Float32Array(MAXPULSE * 4), holdBuf = new Float32Array(MAXHOLD * 4), hlBuf = new Float32Array(4), touchBuf = new Float32Array(16);

    var input = refreshContacts(kit, 120), hueFlow = refreshHue(0);
    var settings = {look: 0, grid: 7, angle: 60, strap: 6, hue: 0};
    var disp = {grid: 7, angle: 60, strap: 6};
    var LK = LOOKS[0], over = {grid: false, angle: false, strap: false}, looks = 0;   // a moved knob overrides the look until the next look
    var palNow = new Float32Array(NPAL * 3), palGo = new Float32Array(NPAL * 3), dimNow = LK.dim;
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    function lookTargets() { for (var i = 0; i < NPAL; i++) for (var c = 0; c < 3; c++) palGo[i * 3 + c] = LK.pal[i][c] / 255; }
    function applyLook(i) { LK = LOOKS[i]; over.grid = over.angle = over.strap = false; lookTargets(); looks++; }
    function snapLook() { lookTargets(); palNow.set(palGo); dimNow = LK.dim; disp.grid = want('grid'); disp.angle = want('angle'); disp.strap = want('strap'); }
    var time = 0, frames = 0, frameMs = 0, size = [canvas.width, canvas.height];
    var tracks = [], pulses = [], holds = [], taps = 0, holdCount = 0, contactsN = 0, bodyCount = 0, bodyAmt = 0;
    var quiet = 0, nextIdle = 2.5, hand = {w: 0, xL: 640, aL: 60, xR: 640, aR: 60, k: 1, sinceSeen: 99}, strapK = 1;

    function tap(x, y, amp) {
      for (var i = 0; i < pulses.length; i++) if (pulses[i].age < 0.25 && Math.hypot(pulses[i].x - x, pulses[i].y - y) < 80) return;
      if (pulses.length >= MAXPULSE) pulses.shift();
      pulses.push({x: x, y: y, age: 0, amp: amp || 1}); if (!amp) taps++;
    }
    function updateTracks(pts, dt) {
      tracks.forEach(function (t) { t.seen = false; });
      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1], best = null, bd = 0.08;
        for (var j = 0; j < tracks.length; j++) { var tr = tracks[j]; if (tr.seen) continue; var d = Math.hypot(tr.x - x, tr.y - y); if (d < bd) { bd = d; best = tr; } }
        if (!best) { best = {x: x, y: y, ax: x, ay: y, still: 0, hold: null}; tracks.push(best); tap(x * 1280, y * 800); }
        best.x = x; best.y = y; best.seen = true;
        if (Math.hypot(x - best.ax, y - best.ay) > 0.016) { best.ax = x; best.ay = y; best.still = 0; if (best.hold) { best.hold.release = true; best.hold = null; } }
        else best.still += dt;
        if (best.hold) { best.hold.x = best.ax * 1280; best.hold.y = best.ay * 800; }
        if (best.still >= HOLD_S && !best.hold) {
          if (holds.length >= MAXHOLD) { var old = holds.filter(function (h) { return h.release; })[0]; if (old) holds.splice(holds.indexOf(old), 1); }
          if (holds.length < MAXHOLD) { best.hold = {x: best.ax * 1280, y: best.ay * 800, r: WASH_R0, amp: 0, release: false}; holds.push(best.hold); holdCount++; }
        }
      }
      for (var k = tracks.length - 1; k >= 0; k--) if (!tracks[k].seen) { if (tracks[k].hold) tracks[k].hold.release = true; tracks.splice(k, 1); }
    }
    function angleOf(x) { return A_MIN + (A_MAX - A_MIN) * clamp(x, 0, 1); }
    function updateHands(pts, dt) {
      var ke = 1 - Math.exp(-dt / 0.12);
      if (pts.length) {
        var sorted = pts.slice().sort(function (a, b) { return a[0] - b[0]; }), L = sorted[0], R = sorted[sorted.length - 1];
        var xL = L[0] * 1280, xR = R[0] * 1280, aL = angleOf(L[0]), aR = angleOf(R[0]), my = 0;
        for (var i = 0; i < pts.length; i++) my += pts[i][1]; my /= pts.length;
        if (hand.w < 0.02) { hand.xL = xL; hand.xR = xR; hand.aL = aL; hand.aR = aR; }
        hand.xL += (xL - hand.xL) * ke; hand.xR += (xR - hand.xR) * ke; hand.aL += (aL - hand.aL) * ke; hand.aR += (aR - hand.aR) * ke;
        hand.k += ((1.75 - 1.15 * clamp(my, 0, 1)) - hand.k) * ke;
        hand.w += (1 - hand.w) * (1 - Math.exp(-dt / 0.18)); hand.sinceSeen = 0;
      } else {
        hand.sinceSeen += dt;
        if (hand.sinceSeen > 1.5) { hand.w *= Math.exp(-dt / 1.1); hand.k += (1 - hand.k) * (1 - Math.exp(-dt / 1.1)); }
      }
    }

    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      hueFlow.step(settings.hue, dt);
      var ke = 1 - Math.exp(-dt / SHAPE_TAU), kp = 1 - Math.exp(-dt / PAL_TAU);
      disp.grid += (want('grid') - disp.grid) * ke; disp.angle += (want('angle') - disp.angle) * ke; disp.strap += (want('strap') - disp.strap) * ke;
      for (var pi = 0; pi < NPAL * 3; pi++) palNow[pi] += (palGo[pi] - palNow[pi]) * kp;
      dimNow += (LK.dim - dimNow) * kp;
      if (body.update(dt, now) || !body.fresh) { var m = body.mask; for (var i = 0; i < maskBytes.length; i++) maskBytes[i] = Math.round(clamp(m[i], 0, 1) * 255); }
      bodyCount = body.fresh ? body.people.length : 0;
      bodyAmt += ((body.fresh ? 1 : 0) - bodyAmt) * (1 - Math.exp(-dt / 0.3));
      var pts = input.read(); contactsN = pts.length;
      updateTracks(pts, dt); updateHands(pts, dt);
      quiet = pts.length || bodyCount ? 0 : quiet + dt; nextIdle -= dt;
      if (nextIdle <= 0) {                            // idle: now and then a faint pulse leaves a random star
        nextIdle = 6 + Math.random() * 4;
        if (quiet > 3) { var S = 1280 / disp.grid; tap(640 + Math.round((Math.random() - 0.5) * 1280 / S) * S, 400 + Math.round((Math.random() - 0.5) * 800 / S) * S, 0.4); }
      }
      for (var p = pulses.length - 1; p >= 0; p--) { pulses[p].age += dt; if (pulses[p].age > PULSE_LIFE) pulses.splice(p, 1); }
      for (var h = holds.length - 1; h >= 0; h--) {
        var ho = holds[h];
        if (!ho.release) { ho.amp += (1 - ho.amp) * (1 - Math.exp(-dt / 0.5)); ho.r = Math.min(WASH_R1, ho.r + (WASH_R1 - WASH_R0) / WASH_GROW * dt); }
        else { ho.amp -= dt / WASH_FADE; if (ho.amp <= 0) holds.splice(h, 1); }
      }
      strapK = hand.k;
      draw();
      frameMs = performance.now() - t0;
    }

    function draw() {
      var w = canvas.width, hgt = canvas.height;
      gl.viewport(0, 0, w, hgt);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, maskBytes);
      pulseBuf.fill(0); holdBuf.fill(0);
      for (var i = 0; i < pulses.length && i < MAXPULSE; i++) { var u = pulses[i], f = 1 - u.age / PULSE_LIFE;
        pulseBuf[i * 4] = u.x; pulseBuf[i * 4 + 1] = u.y; pulseBuf[i * 4 + 2] = 20 + PULSE_SPEED * u.age; pulseBuf[i * 4 + 3] = u.amp * f * Math.min(1, u.age / 0.08); }
      for (var j = 0; j < holds.length && j < MAXHOLD; j++) { var hh = holds[j]; holdBuf[j * 4] = hh.x; holdBuf[j * 4 + 1] = hh.y; holdBuf[j * 4 + 2] = hh.r; holdBuf[j * 4 + 3] = clamp(hh.amp, 0, 1); }
      touchBuf.fill(0);
      for (var t = 0; t < tracks.length && t < 4; t++) { touchBuf[t * 4] = tracks[t].x * 1280; touchBuf[t * 4 + 1] = tracks[t].y * 800; touchBuf[t * 4 + 3] = 1; }
      gl.uniform4fv(U.uTouch, touchBuf); gl.uniform1i(U.uNT, Math.min(tracks.length, 4));
      hlBuf[0] = hand.xL; hlBuf[1] = hand.aL; hlBuf[2] = hand.xR; hlBuf[3] = hand.aR;
      gl.uniform2f(U.uRes, w, hgt); gl.uniform1f(U.uPx, 1280 / Math.max(1, w));
      gl.uniform1f(U.uTime, time); gl.uniform1f(U.uGrid, disp.grid);
      gl.uniform1f(U.uStrap, disp.strap * strapK); gl.uniform1f(U.uHue, hueFlow.value * Math.PI / 180);
      gl.uniform1f(U.uA0, disp.angle); gl.uniform1f(U.uHW, hand.w); gl.uniform4fv(U.uHL, hlBuf);
      gl.uniform4fv(U.uPulse, pulseBuf); gl.uniform1i(U.uNP, Math.min(pulses.length, MAXPULSE));
      gl.uniform4fv(U.uHold, holdBuf); gl.uniform1i(U.uNH, Math.min(holds.length, MAXHOLD));
      gl.uniformMatrix3fv(U.uHinv, false, body.hinv()); gl.uniform1f(U.uBody, bodyAmt);
      gl.uniform3fv(U.uPal, palNow); gl.uniform1f(U.uDim, dimNow);
      gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    }

    var LIM = {look: [0, LOOKS.length - 1], grid: [4, 12], angle: [30, 75], strap: [2, 12], hue: [0, 360]};
    function set(o) {
      if (o && typeof o === 'object') {
        var lk = o.look;                                // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['grid', 'angle', 'strap'].forEach(function (k) {   // a knob that MOVED overrides the look's own value until the next look
          var v = o[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
          v = clamp(v, LIM[k][0], LIM[k][1]); if (v !== settings[k]) { settings[k] = v; over[k] = true; }
        });
        var hv = o.hue; if (typeof hv === 'number' && Number.isFinite(hv)) settings.hue = clamp(hv, LIM.hue[0], LIM.hue[1]);
      }
      return {look: settings.look, grid: settings.grid, angle: settings.angle, strap: settings.strap, hue: settings.hue};
    }
    function resize(w, h) { if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) size = [w, h]; }
    function destroy() {
      if (dead) return; dead = true;
      tracks = []; pulses = []; holds = []; input.clear();
      try { gl.deleteTexture(maskTex); gl.deleteVertexArray(vao); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); } catch (e) {}
      kit.wantDepth(false);
      if (window.GirihSet === set) delete window.GirihSet;
    }

    kit.wantDepth(true);
    window.GirihSet = set; if (window._girihFx) set(window._girihFx);
    LK = LOOKS[settings.look]; snapLook(); hueFlow.snap(settings.hue);   // start on the stored look and knobs without easing in
    var out = {frame: frame, touch: function (t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      return {frames: frames, frameMs: frameMs, contacts: contactsN, tracks: tracks.length, taps: taps, holds: holdCount, pulses: pulses.length,
        washes: holds.map(function (h) { return {x: h.x, y: h.y, r: h.r, amp: h.amp, release: h.release}; }),
        hand: {w: hand.w, xL: hand.xL, aL: hand.aL, xR: hand.xR, aR: hand.aR, strapK: hand.k}, bodyCount: bodyCount, bodyAmt: bodyAmt,
        look: LK.name, looks: looks, overrides: Object.assign({}, over), palette: Array.prototype.slice.call(palNow, 0, 6), dim: dimNow,
        settings: set(), disp: {grid: disp.grid, angle: disp.angle, strap: disp.strap}, displayHue: hueFlow.value, size: size, destroyed: dead};
    };
    return out;
  }
})();
