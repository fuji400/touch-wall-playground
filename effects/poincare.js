/* Poincare Disk -- an exact hyperbolic {p,q} tiling you can slide with your hand (2026-10-22, genart build-out, Builder B;
 * from poincaredisk.go). The disk is as tall as the wall, gold and ivory strokes on #080b16 inside a dark casing with a gold bezel.
 * Fragment shader: each pixel is pulled back through the current view (a Mobius disk automorphism) and folded into the fundamental
 * triangle by iterated reflections in three geodesics (two lines through the centre at 0 and pi/p, one circle orthogonal to the rim);
 * the reflection count gives the chequer, replaying the folds backwards on the origin gives the tile's own centre (its colour, its
 * jewel glow, its body light), and edge strokes come from exact hyperbolic distances scaled by the Poincare metric.
 *   drag = a hyperbolic translation (z0 -> z1 Mobius) slides the tiling under the hand; release and it glides to a stop
 *   tap  = the next {p,q}: (7,3) (5,4) (8,3) (6,4) (4,5), a 0.6 s crossfade
 *   hold = the tiling turns about the hand (an elliptic Mobius around the touch point)
 *   walk = the disk follows the nearest person sideways, and tiles along a body outline light ivory
 *   idle = a slow hyperbolic drift that turns its heading over about a minute
 * The view is re-centred by a tiling symmetry whenever it wanders, so float precision never runs out (invisible: same picture).
 * Needs plugins/body.js (WallBody). WebGL 2, no assets, no audio, no network.
 * Looks (2026-11-01): palette and line style only (the {p,q} Tiling stays its own knob): the two Oklab gradients, the gold, ivory
 * and casing colours, plus Line width and Chequer. A new look eases the gradients and colours over ~0.8 s and the line width and
 * chequer over ~1.2 s; a moved knob overrides the look's value until the next look. Look 0 (dunhuang) is the original picture.
 */
(function () {
  'use strict';

  var SHAPES = [[7, 3], [5, 4], [8, 3], [6, 4], [4, 5]];
  var DISK_R = 370;                 // design px: with the bezel (1.082 R) the disk spans the 800 px wall height
  var MORPH_S = 0.6;                // tap crossfade
  var GLIDE_TAU = 0.9;              // release glide decay (s)
  var HOLD_S = 0.6, HOLD_W = 0.7;   // a still finger turns the tiling after HOLD_S at up to HOLD_W rad/s
  var IDLE_AFTER_S = 3, IDLE_SPEED = 0.05, IDLE_TURN_S = 70;
  var DUNHUANG = [[0x8C, 0x2D, 0x19], [0xD9, 0x79, 0x25], [0xE8, 0xC5, 0x87], [0x3A, 0x7D, 0x70], [0x1E, 0x47, 0x59], [0x4A, 0x6B, 0x4E]];
  var INFERNO = [[0x00, 0x00, 0x04], [0x28, 0x0B, 0x53], [0x65, 0x15, 0x6E], [0x9F, 0x2A, 0x63], [0xD4, 0x48, 0x42], [0xF5, 0x7D, 0x15], [0xFA, 0xC2, 0x28], [0xFC, 0xFF, 0xA4]];
  // Looks: tile gradient (dun), glow gradient (inf), gold strokes, ivory cores, casing (0..255); lines (%) and chequer. Look 0 = the original.
  var LOOKS = [
    {name: 'dunhuang', lines: 100, chequer: 50, dun: DUNHUANG, inf: INFERNO, gold: [244, 206, 132], ivory: [255, 246, 224], cas: [10, 13, 24]},
    {name: 'woodcut', lines: 80, chequer: 100,
     dun: [[0x2A, 0x2A, 0x2A], [0x9A, 0x9A, 0x9A], [0xF2, 0xF2, 0xF2], [0x60, 0x60, 0x60], [0x14, 0x14, 0x14], [0xC8, 0xC8, 0xC8]],
     inf: [[0x00, 0x00, 0x00], [0x30, 0x30, 0x30], [0x70, 0x70, 0x70], [0xB0, 0xB0, 0xB0], [0xFF, 0xFF, 0xFF]], gold: [236, 236, 232], ivory: [255, 255, 255], cas: [0, 0, 0]},
    {name: 'neon', lines: 170, chequer: 20,
     dun: [[0x2A, 0x06, 0x5E], [0xD0, 0x1C, 0xC8], [0x40, 0xF0, 0xFF], [0x18, 0x40, 0xF0], [0x0A, 0x04, 0x30], [0x8A, 0x20, 0xF0]],
     inf: [[0x00, 0x00, 0x08], [0x10, 0x10, 0x60], [0x20, 0x60, 0xE0], [0x30, 0xE0, 0xFF], [0xE8, 0xFF, 0xFF]], gold: [40, 240, 255], ivory: [255, 255, 255], cas: [2, 2, 8]},
    {name: 'azulejo', lines: 140, chequer: 30,
     dun: [[0xF4, 0xF1, 0xE8], [0xC8, 0xD6, 0xEA], [0x6A, 0x8F, 0xC8], [0x24, 0x4A, 0x9A], [0x14, 0x2A, 0x66], [0xE8, 0xEE, 0xF6]],
     inf: [[0x08, 0x10, 0x30], [0x20, 0x40, 0x90], [0x60, 0x90, 0xD8], [0xC0, 0xD8, 0xF4], [0xFF, 0xFF, 0xFF]], gold: [40, 76, 170], ivory: [255, 255, 255], cas: [12, 22, 52]},
    {name: 'ember', lines: 120, chequer: 70,
     dun: [[0x30, 0x06, 0x02], [0x90, 0x20, 0x08], [0xE0, 0x60, 0x10], [0xFF, 0xA0, 0x30], [0x60, 0x10, 0x04], [0xB0, 0x30, 0x08]],
     inf: [[0x00, 0x00, 0x00], [0x40, 0x08, 0x02], [0x90, 0x20, 0x04], [0xE0, 0x60, 0x10], [0xFF, 0xC0, 0x40], [0xFF, 0xF0, 0xC0]], gold: [255, 150, 50], ivory: [255, 230, 170], cas: [14, 4, 2]},
    {name: 'malachite', lines: 60, chequer: 60,
     dun: [[0x0E, 0x3B, 0x2E], [0x1F, 0x7A, 0x5A], [0x7F, 0xD1, 0xA8], [0x2C, 0x5E, 0x4A], [0x0A, 0x26, 0x20], [0x4F, 0x9E, 0x7A]],
     inf: [[0x00, 0x00, 0x00], [0x06, 0x20, 0x18], [0x10, 0x50, 0x3A], [0x30, 0x90, 0x70], [0x80, 0xD0, 0xB0], [0xE0, 0xFF, 0xF0]], gold: [206, 222, 214], ivory: [240, 255, 245], cas: [4, 12, 10]}
  ];
  var PAL_TAU = 0.25, SHAPE_TAU = 0.4;

  registerWallPlugin({id: 'poincare', title: 'Poincare Disk', author: 'Claude Opus 5.5 (genart build-out, Builder B)', create: create});

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
  // A tap is a short, still, confirmed contact followed by release. A lost feed is cancellation.
  // Kept local so each Lab plugin remains a standalone file (same contract in the eight reviewed pieces).
  function tapGesture(kit, input, cooldownMs) {
    var lastTapAt = -Infinity;
    return {
      observe: function (track, x, y) {
        if (input.state !== 'fresh' && input.state !== 'sparse') return;
        var stamp = kit.fingers ? kit.fingers.t : Date.now();
        var t = track.tapEvidence;
        if (!t) t = track.tapEvidence = {x: x, y: y, born: stamp, last: stamp, stamp: -Infinity, reports: 0, travel: 0};
        if (stamp !== t.stamp) { t.reports++; t.stamp = stamp; t.last = stamp; }
        t.travel = Math.max(t.travel, Math.hypot((x - t.x) * 1280, (y - t.y) * 800));
      },
      release: function (track) {
        var t = track.tapEvidence, now = Date.now();
        if (!t || input.state === 'stale' || input.state === 'recovering' || now - t.last > 350 ||
            t.last - t.born > 350 || t.travel > 30 || (kit.fingers && t.reports < 2) || now - lastTapAt < cooldownMs) return false;
        lastTapAt = now;
        return true;
      }
    };
  }

  function refreshHue(initial) {
    var value = Number.isFinite(initial) ? initial : 0;
    return {get value() { return value; }, snap: function (v) { value = v; }, step: function (target, dt) { var d = ((target - value + 540) % 360) - 180; if (Math.abs(d) < 0.001) { value = target % 360; return; } value = (value + d * (1 - Math.exp(-Math.max(0, Math.min(0.1, dt)) / 0.18)) + 360) % 360; }};
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---------------------------------------------------------------- Oklab gradients (render.NewMultiStopGradient(...).SampleOklab)
  function s2l(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function l2s(c) { c = clamp(c, 0, 1); return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function toLab(c) {
    var r = s2l(c[0]), g = s2l(c[1]), b = s2l(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function fromLab(L) {
    var l = L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2], m = L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2], s = L[0] - 0.0894841775 * L[1] - 1.2914855480 * L[2];
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), l2s(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
  }
  function lut(stops, n) {
    var labs = stops.map(toLab), out = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * (labs.length - 1), k = Math.min(labs.length - 2, Math.floor(x)), f = x - k, a = labs[k], b = labs[k + 1];
      var rgb = fromLab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
      out[i * 3] = rgb[0]; out[i * 3 + 1] = rgb[1]; out[i * 3 + 2] = rgb[2];
    }
    return out;
  }

  // ---------------------------------------------------------------- complex numbers and disk automorphisms (JS side)
  // A view is {a: [re, im], b: [re, im]}: T(w) = (a w + b) / (conj(b) w + conj(a)), |a|^2 - |b|^2 = 1.
  function cm(x, y) { return [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]]; }
  function ca(x, y) { return [x[0] + y[0], x[1] + y[1]]; }
  function cs(x, y) { return [x[0] - y[0], x[1] - y[1]]; }
  function cc(x) { return [x[0], -x[1]]; }
  function cd(x, y) { var d = y[0] * y[0] + y[1] * y[1] || 1e-30; return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d]; }
  function cabs2(x) { return x[0] * x[0] + x[1] * x[1]; }
  function cexp(t) { return [Math.cos(t), Math.sin(t)]; }
  function csqrt(x) { var r = Math.sqrt(Math.hypot(x[0], x[1])), t = Math.atan2(x[1], x[0]) / 2; return [r * Math.cos(t), r * Math.sin(t)]; }
  function vNorm(v) {
    var n = cabs2(v.a) - cabs2(v.b);
    if (!(n > 1e-12) || !Number.isFinite(n)) return {a: [1, 0], b: [0, 0]};
    n = Math.sqrt(n); return {a: [v.a[0] / n, v.a[1] / n], b: [v.b[0] / n, v.b[1] / n]};
  }
  function vCompose(M, T) {   // M after T
    return vNorm({a: ca(cm(M.a, T.a), cm(M.b, cc(T.b))), b: ca(cm(M.a, T.b), cm(M.b, cc(T.a)))});
  }
  function vTrans(c) { var k = 1 - cabs2(c); if (!(k > 1e-9)) { var s = Math.sqrt(0.999 / Math.max(cabs2(c), 1e-12)); c = [c[0] * s, c[1] * s]; k = 1 - cabs2(c); } k = 1 / Math.sqrt(k); return {a: [k, 0], b: [c[0] * k, c[1] * k]}; }
  function vRot(t) { return {a: cexp(t / 2), b: [0, 0]}; }
  function vApply(T, w) { return cd(ca(cm(T.a, w), T.b), ca(cm(cc(T.b), w), cc(T.a))); }
  function vInvApply(T, z) { return cd(cs(cm(cc(T.a), z), T.b), ca(cm([-T.b[0], T.b[1]], z), T.a)); }
  function shapeParams(i) {
    var s = SHAPES[clamp(Math.round(i), 0, SHAPES.length - 1)], p = s[0], q = s[1];
    var cq = Math.cos(Math.PI / q), sp = Math.sin(Math.PI / p), d = cq / Math.sqrt(cq * cq - sp * sp);
    return {p: p, q: q, d: d, r: Math.sqrt(d * d - 1)};
  }
  // Re-centre: fold the tiling point under the disk centre into the fundamental triangle with the same reflections the shader uses,
  // collecting them as one (anti-)Mobius map G; make it even (one more mirror in the real axis), then view' = view o G^-1.
  function recentre(T, sh) {
    var w0 = vInvApply(T, [0, 0]);
    if (cabs2(w0) < 0.09) return null;
    var ang = Math.PI / sh.p, wedge = 2 * ang, C = sh.d, r2 = sh.r * sh.r, f = w0.slice();
    var G = [[1, 0], [0, 0], [0, 0], [1, 0]], k = 0, n = 0;
    function left(M, conjFirst) {   // G <- M . (conj G if conjFirst), then scale
      var g = conjFirst ? G.map(cc) : G;
      G = [ca(cm(M[0], g[0]), cm(M[1], g[2])), ca(cm(M[0], g[1]), cm(M[1], g[3])), ca(cm(M[2], g[0]), cm(M[3], g[2])), ca(cm(M[2], g[1]), cm(M[3], g[3]))];
      var big = Math.max.apply(null, G.map(function (x) { return Math.hypot(x[0], x[1]); })) || 1;
      G = G.map(function (x) { return [x[0] / big, x[1] / big]; });
    }
    for (var it = 0; it < 64; it++) {
      if (cabs2(f) < 1e-14) break;
      var a = Math.atan2(f[1], f[0]), kk = Math.floor(a / wedge), th = -kk * wedge;
      f = cm(cexp(th), f); left([cexp(th), [0, 0], [0, 0], [1, 0]], false);
      if (a - kk * wedge > ang) { f = cm(cexp(wedge), cc(f)); left([cexp(wedge), [0, 0], [0, 0], [1, 0]], true); k++; }
      var dx = f[0] - C, dy = f[1], d2 = dx * dx + dy * dy;
      if (d2 < r2) { f = [C + dx * r2 / d2, dy * r2 / d2]; left([[C, 0], [r2 - C * C, 0], [1, 0], [-C, 0]], true); k++; n++; } else break;
    }
    if (k % 2) { f = cc(f); G = G.map(cc); k++; }
    // view' = T . adj(G), normalised back to the SU(1,1) form
    var Tm = [T.a, T.b, cc(T.b), cc(T.a)], A = [G[3], [-G[1][0], -G[1][1]], [-G[2][0], -G[2][1]], G[0]];
    var P = [ca(cm(Tm[0], A[0]), cm(Tm[1], A[2])), ca(cm(Tm[0], A[1]), cm(Tm[1], A[3])), ca(cm(Tm[2], A[0]), cm(Tm[3], A[2])), ca(cm(Tm[2], A[1]), cm(Tm[3], A[3]))];
    var det = cs(cm(P[0], P[3]), cm(P[1], P[2])), sq = csqrt(det);
    if (!(cabs2(sq) > 1e-20)) return null;
    P = P.map(function (x) { return cd(x, sq); });
    var out = vNorm({a: [(P[0][0] + P[3][0]) / 2, (P[0][1] - P[3][1]) / 2], b: [(P[1][0] + P[2][0]) / 2, (P[1][1] - P[2][1]) / 2]});
    if (!Number.isFinite(out.a[0] + out.a[1] + out.b[0] + out.b[1])) return null;
    var check = vInvApply(out, [0, 0]);
    if (!(cabs2(check) < cabs2(w0))) return null;          // must have moved the centre inward, or keep the old view
    return {view: out, inversions: n};
  }

  // ---------------------------------------------------------------- shaders
  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec4 uT; uniform vec3 uDisk; uniform vec4 uSA, uSB; uniform float uMorph, uLine, uCheq, uHue, uPx, uBodyOn, uPN;',
    'uniform vec3 uDun[24]; uniform vec3 uInf[12]; uniform vec4 uTouch[4]; uniform sampler2D uBody; uniform mat3 uHinv;',
    'in vec2 vUv; out vec4 o;',
    'const float PI=3.14159265;',
    'uniform vec3 uGold, uIvory, uCase;',                                // the look's stroke, core and casing colours (eased in JS)
    '#define GOLD uGold',
    '#define IVORY uIvory',
    '#define CASE uCase',
    'vec2 cmul(vec2 a,vec2 b){ return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x); }',
    'vec2 cdiv(vec2 a,vec2 b){ return vec2(a.x*b.x+a.y*b.y,a.y*b.x-a.x*b.y)/max(dot(b,b),1e-12); }',
    'vec2 cj(vec2 a){ return vec2(a.x,-a.y); }',
    'vec3 dun(float t){ float x=clamp(t,0.,1.)*23.; int i=int(min(floor(x),22.)); return mix(uDun[i],uDun[i+1],x-float(i)); }',
    'vec3 inf(float t){ float x=clamp(t,0.,1.)*11.; int i=int(min(floor(x),10.)); return mix(uInf[i],uInf[i+1],x-float(i)); }',
    'float atanh1(float x){ x=min(x,.99999); return .5*log((1.+x)/(1.-x)); }',
    'float asinh1(float x){ return log(x+sqrt(x*x+1.)); }',
    'float cover(float d,float hw){ return clamp(hw+.5-d,0.,1.); }',      // box-filtered line coverage, d and hw in px
    'vec2 bodyAt(vec2 p){ vec3 h=uHinv*vec3(p/vec2(1280.,800.),1.); vec2 k=h.xy/max(h.z,1e-6);',
    '  if(h.z<=0.||k.x<0.||k.x>1.||k.y<0.||k.y>1.) return vec2(0.,24.);',
    '  vec2 t=textureLod(uBody,k,0.).rg; return vec2(t.r,t.g*32.-8.); }',
    'vec3 hueRot(vec3 c,float a){ const vec3 k=vec3(.57735); float ca=cos(a); return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.-ca); }',
    // one {p,q} tiling at tiling point w (screen disk point z, sPx = screen px per hyperbolic unit there, lw = line scale in px)
    'vec3 tiling(vec2 w,vec4 S,float sPx,float lw){',
    '  float ang=PI/S.x, wedge=2.*ang, C=S.z, r2=S.w*S.w; vec2 f=w; float par=0.; int n=0; float ops[40];',
    '  for(int i=0;i<40;i++){',
    '    if(dot(f,f)<1e-14) break;',
    '    float a=atan(f.y,f.x), k=floor(a/wedge); a-=k*wedge; float rf=0., iv=0.;',
    '    if(a>ang){ a=wedge-a; rf=1.; }',
    '    f=length(f)*vec2(cos(a),sin(a));',
    '    vec2 d=f-vec2(C,0.); float d2=dot(d,d);',
    '    if(d2<r2){ f=vec2(C,0.)+d*(r2/d2); iv=1.; }',
    '    par+=rf+iv; ops[i]=(k+64.)*4.+rf*2.+iv; n=i+1;',
    '    if(iv<.5) break; }',
    '  vec2 c=vec2(0.);',                                                // replay backwards on the origin: this tile\'s own centre
    '  for(int i=39;i>=0;i--){ if(i>=n) continue; float e=ops[i], k=floor(e/4.), rem=e-k*4.; k-=64.;',
    '    if(mod(rem,2.)>.5){ vec2 d=c-vec2(C,0.); c=vec2(C,0.)+d*(r2/max(dot(d,d),1e-12)); }',
    '    if(rem>1.5) c=cmul(vec2(cos(wedge),sin(wedge)),cj(c));',
    '    float th=k*wedge; c=cmul(vec2(cos(th),sin(th)),c); }',
    '  vec2 sz=cdiv(cmul(uT.xy,c)+uT.zw,cmul(cj(uT.zw),c)+cj(uT.xy));',  // tile centre on the screen disk
    '  float fl2=dot(f,f), den=max(1.-fl2,1e-6); vec2 dc=f-vec2(C,0.);',
    '  float dE=asinh1(abs(dot(dc,dc)-r2)/(S.w*den)), dC=2.*atanh1(sqrt(fl2)), dS=asinh1(2.*abs(f.y)/den);',
    '  float rho=dC/max(dC+dE,1e-5), sl=length(sz), hd=2.*atanh1(sl), hn=clamp(hd/5.2,0.,1.), pa=(atan(sz.y,sz.x)+PI)/(2.*PI);',
    '  float t=clamp(.52*hn+.12*sin(pa*S.x*2.*PI)+.2,0.,1.);',
    '  vec3 tc=dun(t), rim=tc*.42, jewel=mix(min(tc*1.25,vec3(1.)),inf(.85-.55*hn),.3);',
    '  vec3 col=mix(mix(jewel,tc*.8,smoothstep(.37,.41,rho)),rim,smoothstep(.68,.72,rho))*.5;',
    '  col*=1.+uCheq*(mod(par,2.)>.5?-.5:.25);',                          // the triangle chequer
    '  vec2 bc=bodyAt(uDisk.xy+sz*uDisk.z); col=mix(col,IVORY*.92,smoothstep(4.,.5,abs(bc.y))*.8*uBodyOn);',   // tiles on a body outline light ivory
    '  float size=sPx*min(dC+dE,1.2), fade=smoothstep(3.,10.,size*.35);',   // sub-pixel tiles at the rim fade to their mean
    '  col=mix((rim+tc*.8)*.5*.5,col,fade);',
    '  float sw=.55*lw;',
    '  col=mix(col,GOLD,.42*fade*cover(dS*sPx,sw)*step(rho,.999));',           // spokes to the edge midpoints
    '  col=mix(col,GOLD,.34*fade*cover(abs(rho-.7)*(dC+dE)*sPx,sw));',         // the inner polygon
    '  col+=jewel*.22*(1.-.5*hn)*exp(-dC*dC/.09)*fade;',                       // jewel glow at the tile centre
    '  col+=IVORY*.55*exp(-pow(dC*sPx/(3.*uPx),2.))*smoothstep(2.4,1.6,hd)*fade;',
    '  float ep=dE*sPx, ef=smoothstep(.5,2.5,size*.25);',
    '  col=mix(col,CASE,.85*cover(ep,1.5*lw)*ef);',                            // the tile boundary: dark casing, gold, ivory core
    '  col=mix(col,GOLD,.9*cover(ep,.8*lw)*ef);',
    '  col=mix(col,IVORY,.72*cover(ep,.3*lw)*smoothstep(10.,16.,size)*ef);',
    '  return col; }',
    'void main(){',
    '  vec2 p=vec2(vUv.x*1280.,(1.-vUv.y)*800.), z=(p-uDisk.xy)/uDisk.z; float l=length(z), R=uDisk.z, px=1./R;',
    '  vec3 col; vec2 bm=bodyAt(p); float be=abs(bm.x-.5)/max(fwidth(bm.x),1e-4);',   // body outline distance (px), in uniform control flow
    '  if(l<1.){',
    '    vec2 w=cdiv(cmul(cj(uT.xy),z)-uT.zw,cmul(vec2(-uT.z,uT.w),z)+uT.xy); w*=min(1.,.9995/max(length(w),1e-6));',
    '    float sPx=R*(1.-l*l)*.5, lw=uLine*uPx*clamp(sPx/110.,.3,1.);',
    '    col=tiling(w,uSA,sPx,lw);',
    '    if(uMorph>.001) col=mix(col,tiling(w,uSB,sPx,lw),uMorph);',
    '    col+=dun(.22)*.07*smoothstep(.6,1.,l);',
    '    for(int i=0;i<4;i++){ vec4 tq=uTouch[i]; if(tq.w<=0.||dot(tq.xy,tq.xy)>.9409) continue;',     // a halo and a geodesic ring under each finger
    '      vec2 dz=cdiv(z-tq.xy,vec2(1.,0.)-cmul(cj(tq.xy),z)); float dh=2.*atanh1(length(dz));',
    '      float hs=R*(1.-l*l)*.5/(1.5*uPx);',
    '      col+=mix(GOLD,IVORY,.5)*(.28*exp(-dh*dh/.06)+.55*exp(-pow((dh-.42)*hs,2.))+.6*exp(-pow((dh-tq.z*1.4)*hs,2.))*exp(-tq.z*2.2))*tq.w; }',
    '    col*=1.-.5*smoothstep(.4,.85,bm.x)*uBodyOn;',
    '    col+=GOLD*(.9*exp(-be*be/(2.6*uPx*uPx))+.16*exp(-max(bm.y,0.)/1.2)*step(0.,bm.y)*step(bm.y,23.))*uBodyOn;',
    '  } else {',                                                          // the casing: aura, bezel rings, ticks, compass jewels
    '    col=CASE+dun(.22)*.10*exp(-(l-1.)*7.)+inf(.55)*.05*exp(-(l-1.)*12.);',
    '    float dr=(l-1.)*R, th=atan(z.y,z.x);',
    '    col=mix(col,GOLD,.48*cover(abs(l-1.022)*R,.6*uPx)); col=mix(col,dun(.75),.42*cover(abs(l-1.064)*R,.8*uPx)); col=mix(col,GOLD,.32*cover(abs(l-1.082)*R,.45*uPx));',
    '    float tt=th/(2.*PI)*144., ti=floor(tt+.5), ta=abs(tt-ti)*2.*PI*l*R/144., m12=mod(ti,12.), m4=mod(ti,4.), m2=mod(ti,2.);',
    '    float r0=1.022, r1=1.022+.042*.52; if(m12<.5){ r0=1.; r1=1.082; } else if(m4<.5){ r0=1.0066; r1=1.064; } else if(m2<.5){ r1=1.022+.042*.78; }',
    '    col=mix(col,GOLD,.55*cover(ta,.45*uPx)*step(r0,l)*step(l,r1));',
    '    float jn=2.*uPN, ja=floor(th/(2.*PI)*jn+.5)*2.*PI/jn; vec2 jp=1.064*vec2(cos(ja),sin(ja));',
    '    float jd=length(z-jp)*R; col+=IVORY*.68*exp(-jd*jd/(9.*uPx*uPx));',
    '    col=col*(1.-.35*smoothstep(.4,.85,bm.x)*uBodyOn)+GOLD*.5*exp(-be*be/(2.6*uPx*uPx))*uBodyOn;',
    '    for(int i=0;i<4;i++){ vec4 tq=uTouch[i]; if(tq.w<=0.||dot(tq.xy,tq.xy)<=.9409) continue;',   // a finger on the casing: a plain gold halo
    '      float d=length(z-tq.xy)*R/uPx; col+=mix(GOLD,IVORY,.5)*(.22*exp(-d*d/900.)+.5*exp(-pow((d-26.)/1.6,2.)))*tq.w; }',   // people beside the disk still see their outline
    '  }',
    '  float rd=abs(l-1.)*R;',                                               // the gold rim of the disk
    '  col=mix(col,CASE,.95*cover(rd,1.8*uPx)); col=mix(col,GOLD,.95*cover(rd,.9*uPx)); col=mix(col,IVORY,.85*cover(rd,.35*uPx));',
    '  col+=GOLD*.25*exp(-rd*rd/(16.*uPx*uPx));',
    '  col=hueRot(col,uHue);',
    '  vec2 v=vUv-.5; col*=1.-.3*smoothstep(.25,.8,length(v*vec2(1.,.75))*1.3);',
    '  o=vec4(clamp(col,0.,1.),1.);',
    '}'
  ].join('\n') + '\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Poincare Disk needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false});
    if (!gl) throw new Error('Poincare Disk needs WebGL 2');
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
    ['uT', 'uDisk', 'uSA', 'uSB', 'uMorph', 'uLine', 'uCheq', 'uHue', 'uPx', 'uBodyOn', 'uPN', 'uDun', 'uInf', 'uTouch', 'uBody', 'uHinv', 'uGold', 'uIvory', 'uCase']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    var BW = WallBody.w, BH = WallBody.h, body = WallBody.create(kit, {}), bodyU8 = new Uint8Array(BW * BH * 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var btex = gl.createTexture(); made.push(['Texture', btex]);
    gl.bindTexture(gl.TEXTURE_2D, btex);
    for (var bi = 0; bi < BW * BH; bi++) { bodyU8[bi * 2] = 0; bodyU8[bi * 2 + 1] = 255; }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, BW, BH, 0, gl.RG, gl.UNSIGNED_BYTE, bodyU8);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var DUN = lut(DUNHUANG, 24), INF = lut(INFERNO, 12), TOUCH = new Float32Array(16);
    var settings = {look: 0, shape: 0, lines: 100, chequer: 50, hue: 0};
    // the look: target gradients and colours (Go) and the ones on screen (DUN, INF, COL: gold, ivory, casing), eased every frame
    var LK = LOOKS[0], over = {lines: false, chequer: false}, looks = 0, disp = {lines: LK.lines, chequer: LK.chequer};
    var DUN_GO = DUN, INF_GO = INF, COL = new Float32Array(9), COL_GO = new Float32Array(9), palMoving = false;
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    function lookTargets() {
      DUN_GO = lut(LK.dun, 24); INF_GO = lut(LK.inf, 12);
      [LK.gold, LK.ivory, LK.cas].forEach(function (c, i) { COL_GO[i * 3] = c[0] / 255; COL_GO[i * 3 + 1] = c[1] / 255; COL_GO[i * 3 + 2] = c[2] / 255; });
    }
    function applyLook(i) { LK = LOOKS[i]; over.lines = over.chequer = false; lookTargets(); palMoving = true; looks++; }
    function snapLook() { lookTargets(); DUN = new Float32Array(DUN_GO); INF = new Float32Array(INF_GO); COL.set(COL_GO); palMoving = false; disp.lines = want('lines'); disp.chequer = want('chequer'); }
    function easeArr(a, b, k) { var far = false; for (var i = 0; i < a.length; i++) { a[i] += (b[i] - a[i]) * k; if (Math.abs(b[i] - a[i]) > 1e-4) far = true; } return far; }
    function stepLook(dt) {
      var ks = 1 - Math.exp(-dt / SHAPE_TAU), kp = 1 - Math.exp(-dt / PAL_TAU);
      disp.lines += (want('lines') - disp.lines) * ks; disp.chequer += (want('chequer') - disp.chequer) * ks;
      if (!palMoving) return;
      var a = easeArr(DUN, DUN_GO, kp), b = easeArr(INF, INF_GO, kp), c = easeArr(COL, COL_GO, kp);
      if (!(a || b || c)) { DUN.set(DUN_GO); INF.set(INF_GO); COL.set(COL_GO); palMoving = false; }
    }
    var hueFlow = refreshHue(0), input = refreshContacts(kit, 120);
    var view = vNorm({a: [1, 0], b: [0, 0]}), shapeA = 0, shapeB = 0, morph = 0, morphing = false;
    var glide = [0, 0], idleW = 0, idleHead = 0.7, diskX = 640, tracks = [], nextTrack = 1, holdDir = 1;
    var out = null, lastNote = 0, time = 0, frames = 0, frameMs = 0, lastContact = -1e9, bodyCount = 0, contactsNow = 0;
    var stats = {taps: 0, drags: 0, holds: 0, recentres: 0, morphs: 0};

    function toDisk(x, y) { return [(x - diskX) / DISK_R, (y - 400) / DISK_R]; }
    function inside(z) { return cabs2(z) < 0.97 * 0.97; }
    function moveTo(z0, z1) { view = vCompose(vCompose(vTrans(z1), vTrans([-z0[0], -z0[1]])), view); }
    function centreVel(z, dz) {   // the centre translation c whose first-order move at z equals dz (tau_c(w) ~ w + c - conj(c) w^2)
      var s = cm(z, z), det = 1 - cabs2(s);
      if (det < 0.05) return [0, 0];
      return [(dz[0] * (1 + s[0]) + s[1] * dz[1]) / det, (dz[1] * (1 - s[0]) + s[1] * dz[0]) / det];
    }
    function setShape(i) {
      i = clamp(Math.round(i), 0, SHAPES.length - 1);
      settings.shape = i;
      var current = morphing ? shapeB : shapeA;
      if (i === current) return;
      if (morphing) { if (morph > 0.5) shapeA = shapeB; }
      shapeB = i; morph = 0; morphing = true; stats.morphs++;
    }

    var tapInput = tapGesture(kit, input, 350);
    function updateTracks(pts, dt) {
      tracks.forEach(function (t) { t.seen = false; });
      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0] * 1280, y = pts[i][1] * 800, best = null, bd = 110;
        for (var j = 0; j < tracks.length; j++) { var t = tracks[j]; if (t.seen) continue; var d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } }
        if (!best) { best = {id: nextTrack++, x: x, y: y, x0: x, y0: y, ax: x, ay: y, age: 0, travel: 0, still: 0, vel: [0, 0], spin: 0, dragging: false, glow: 0}; tracks.push(best); }
        best.seen = true; best.nx = x; best.ny = y; tapInput.observe(best, x / 1280, y / 800);
      }
      for (var k = tracks.length - 1; k >= 0; k--) {
        var tr = tracks[k];
        if (!tr.seen) {                                                  // released: a tap cycles the shape, a drag glides on
          if (tapInput.release(tr)) { setShape(((morphing ? shapeB : shapeA) + 1) % SHAPES.length); stats.taps++; }
          else if (tr.dragging && input.state !== 'stale') glide = tr.vel.slice();
          tracks.splice(k, 1); continue;
        }
        tr.age += dt;
        var z0 = toDisk(tr.x, tr.y), z1 = toDisk(tr.nx, tr.ny), step = Math.hypot(tr.nx - tr.x, tr.ny - tr.y);
        tr.travel = Math.max(tr.travel, Math.hypot(tr.nx - tr.x0, tr.ny - tr.y0));
        if (Math.hypot(tr.nx - tr.ax, tr.ny - tr.ay) < 14) tr.still += dt; else { tr.still = 0; tr.ax = tr.nx; tr.ay = tr.ny; }
        if (step > 0.2 && tr.travel > 6) {
          var c, iv = 1 / Math.max(dt, 1e-3), kv = 1 - Math.exp(-dt / 0.08);
          if (inside(z0) && inside(z1)) {                                 // on the disk the tiling slides with the hand: z0 -> z1 exactly
            moveTo(z0, z1); c = centreVel(z1, [(z1[0] - z0[0]) * iv, (z1[1] - z0[1]) * iv]);
          } else {                                                       // on the casing a drag pushes the whole tiling the same way
            c = [(z1[0] - z0[0]) * 0.5, (z1[1] - z0[1]) * 0.5]; view = vCompose(vTrans(c), view); c = [c[0] * iv, c[1] * iv];
          }
          if (!tr.dragging) stats.drags++;
          tr.dragging = true; glide = [0, 0];
          tr.vel = [tr.vel[0] + (c[0] - tr.vel[0]) * kv, tr.vel[1] + (c[1] - tr.vel[1]) * kv];
        } else if (step <= 0.2) { var kd = Math.exp(-dt / 0.1); tr.vel = [tr.vel[0] * kd, tr.vel[1] * kd]; }
        if (tr.still > HOLD_S) {                                          // hold: turn the tiling about the hand (on the casing: about the nearest rim point)
          if (tr.spin === 0) { tr.spinDir = holdDir; holdDir = -holdDir; stats.holds++; }
          tr.spin = Math.min(1, tr.spin + dt / 0.8);
          var w = tr.spinDir * HOLD_W * tr.spin * tr.spin * (3 - 2 * tr.spin) * dt, zl = Math.hypot(z1[0], z1[1]), hc = inside(z1) ? z1 : [z1[0] * 0.9 / zl, z1[1] * 0.9 / zl];
          view = vCompose(vCompose(vTrans(hc), vCompose(vRot(w), vTrans([-hc[0], -hc[1]]))), view);
        } else tr.spin = 0;
        tr.x = tr.nx; tr.y = tr.ny;
      }
    }

    function frame(dt, now) {
      if (dead) return;
      var at = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      hueFlow.step(settings.hue, dt);
      stepLook(dt);
      var fresh = body.update(dt, now);
      var pts = input.read(); contactsNow = pts.length;
      if (pts.length) lastContact = time;
      // walk: the disk slides sideways to the nearest person
      var ppl = body.fresh ? body.people : [], tx = 640;
      bodyCount = ppl.length;
      if (ppl.length && Number.isFinite(ppl[0].cx)) { var s = kit.toScreen(ppl[0].cx * 512, ppl[0].cy * 424); tx = clamp((s ? s[0] : ppl[0].cx) * 1280, 640 - 240, 640 + 240); }
      diskX += (tx - diskX) * (1 - Math.exp(-dt / (ppl.length ? 1.2 : 4)));
      if (!Number.isFinite(diskX)) diskX = 640;
      updateTracks(pts, dt);                                             // finger moves are measured on the wall, so the disk sliding is not a drag
      // glide after a release, and the idle drift when nobody touches
      var gk = Math.exp(-dt / GLIDE_TAU); glide = [glide[0] * gk, glide[1] * gk];
      if (cabs2(glide) > 1e-8) view = vCompose(vTrans([glide[0] * dt, glide[1] * dt]), view); else glide = [0, 0];
      var idle = time - lastContact > IDLE_AFTER_S && cabs2(glide) < 1e-4;
      idleW += ((idle ? 1 : 0) - idleW) * (1 - Math.exp(-dt / 1.5));
      idleHead += dt * 2 * Math.PI / IDLE_TURN_S;
      if (idleW > 1e-3) view = vCompose(vCompose(vTrans([Math.cos(idleHead) * IDLE_SPEED * idleW * dt, Math.sin(idleHead) * IDLE_SPEED * idleW * dt]), vRot(0.012 * idleW * dt)), view);
      // the tap crossfade
      if (morphing) { morph += dt / MORPH_S; if (morph >= 1) { morph = 0; morphing = false; shapeA = shapeB; } }
      if (!morphing) { var rc = recentre(view, shapeParams(shapeA)); if (rc) { view = rc.view; stats.recentres++; } }
      // body texture
      if (fresh || !body.fresh) {
        var mask = body.mask, sdf = body.sdf;
        for (var i = 0; i < BW * BH; i++) {
          var m = mask[i], sd = sdf[i];
          bodyU8[i * 2] = (Number.isFinite(m) ? clamp(m, 0, 1) : 0) * 255;
          bodyU8[i * 2 + 1] = (Number.isFinite(sd) ? clamp((sd + 8) / 32, 0, 1) : 1) * 255;
        }
        gl.bindTexture(gl.TEXTURE_2D, btex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RG, gl.UNSIGNED_BYTE, bodyU8);
      }
      // finger halos (disk coords, age, strength)
      TOUCH.fill(0);
      for (var ti = 0, n = 0; ti < tracks.length && n < 4; ti++) {
        var tr = tracks[ti], z = toDisk(tr.x, tr.y); if (cabs2(z) > 9) continue;
        TOUCH[n * 4] = z[0]; TOUCH[n * 4 + 1] = z[1]; TOUCH[n * 4 + 2] = tr.age; TOUCH[n * 4 + 3] = 1; n++;
      }
      // draw
      var sa = shapeParams(shapeA), sb = shapeParams(shapeB), mo = morphing ? morph * morph * (3 - 2 * morph) : 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, btex); gl.uniform1i(U.uBody, 0);
      gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
      gl.uniform4f(U.uT, view.a[0], view.a[1], view.b[0], view.b[1]);
      gl.uniform3f(U.uDisk, diskX, 400, DISK_R);
      gl.uniform4f(U.uSA, sa.p, sa.q, sa.d, sa.r); gl.uniform4f(U.uSB, sb.p, sb.q, sb.d, sb.r); gl.uniform1f(U.uMorph, mo);
      gl.uniform1f(U.uPN, sa.p + (sb.p - sa.p) * (mo > 0.5 ? 1 : 0));
      gl.uniform1f(U.uLine, disp.lines / 100); gl.uniform1f(U.uCheq, disp.chequer / 100);
      gl.uniform3f(U.uGold, COL[0], COL[1], COL[2]); gl.uniform3f(U.uIvory, COL[3], COL[4], COL[5]); gl.uniform3f(U.uCase, COL[6], COL[7], COL[8]);
      gl.uniform1f(U.uHue, hueFlow.value * Math.PI / 180); gl.uniform1f(U.uPx, canvas.width / 1280); gl.uniform1f(U.uBodyOn, 1);
      gl.uniform3fv(U.uDun, DUN); gl.uniform3fv(U.uInf, INF); gl.uniform4fv(U.uTouch, TOUCH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      frameMs = performance.now() - at;
      if (window.WallTest && out && out.debug && time - lastNote >= 2) {   // sandbox only: the interaction numbers land in the smoke run's JSON
        lastNote = time; try { console.warn('poincare debug ' + JSON.stringify(out.debug())); } catch (e) {}
      }
    }

    function set(opts) {
      if (opts && !dead) {
        if (typeof opts.look === 'number' && Number.isFinite(opts.look)) {      // the look first: it clears the line / chequer overrides
          var li = clamp(Math.round(opts.look), 0, LOOKS.length - 1);
          if (li !== settings.look) { settings.look = li; applyLook(li); }
        }
        if (typeof opts.shape === 'number' && Number.isFinite(opts.shape)) { settings.shape = clamp(Math.round(opts.shape), 0, SHAPES.length - 1); setShape(settings.shape); }
        // a knob that MOVED overrides the look's value until the next look
        if (typeof opts.lines === 'number' && Number.isFinite(opts.lines)) { var lv = clamp(opts.lines, 20, 300); if (lv !== settings.lines) { settings.lines = lv; over.lines = true; } }
        if (typeof opts.chequer === 'number' && Number.isFinite(opts.chequer)) { var cv = clamp(opts.chequer, 0, 100); if (cv !== settings.chequer) { settings.chequer = cv; over.chequer = true; } }
        if (typeof opts.hue === 'number' && Number.isFinite(opts.hue)) settings.hue = clamp(opts.hue, 0, 360);
      }
      return Object.assign({}, settings);
    }
    function wake(x, y) { if (!dead) input.wake(x, y); }
    function destroy() {
      if (dead) return; dead = true;
      kit.wantDepth(false);
      if (window.PoincareSet === set) delete window.PoincareSet;
      if (window.PoincareWake === wake) delete window.PoincareWake;
      input.clear(); tracks = [];
      made.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); made = [];
    }

    kit.wantDepth(true);
    window.PoincareSet = set; window.PoincareWake = wake;
    if (window._poincareFx) { set(window._poincareFx); shapeA = shapeB; morphing = false; morph = 0; stats.morphs = 0; }   // the saved shape shows at once
    LK = LOOKS[settings.look]; snapLook(); hueFlow.snap(settings.hue);   // start on the stored look and knobs without easing in
    out = {frame: frame, touch: function (t) { if (t && Number.isFinite(t.x) && Number.isFinite(t.y)) wake(t.x, t.y); }, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      var w0 = vInvApply(view, [0, 0]);
      return {frames: frames, contacts: contactsNow, tracks: tracks.length, bodies: bodyCount, diskX: +diskX.toFixed(1), shape: SHAPES[shapeA].join(','), target: SHAPES[shapeB].join(','),
              morph: +morph.toFixed(2), taps: stats.taps, drags: stats.drags, holds: stats.holds, recentres: stats.recentres, morphs: stats.morphs,
              centre: [+w0[0].toFixed(3), +w0[1].toFixed(3)], glide: +Math.hypot(glide[0], glide[1]).toFixed(4), idleW: +idleW.toFixed(2),
              look: LK.name, looks: looks, overrides: Object.assign({}, over), lines: +disp.lines.toFixed(1), chequer: +disp.chequer.toFixed(1), palMoving: palMoving,
              frameMs: +frameMs.toFixed(2), displayHue: +hueFlow.value.toFixed(2), settings: set(), glError: gl.getError()};
    };
    return out;
  }
})();
