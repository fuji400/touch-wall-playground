/* Truchet Weave (truchetweave) -- genart build-out 2026-10-22, Builder D. Port of jdxyw/generativeart truchetflow.go.
 * A multi-scale quadtree of Smith / winged Truchet tiles: every leaf cell carries two quarter-circle ribbons (plus an under-weaving
 * counter arc on coarse cells) or a straight over-under cross, each ribbon five concentric bands with a 2.5D under-shadow, centre
 * and edge-port pins, paper grain and a vignette, on the Go's indigo-parchment ground.
 * Live: the quadtree refines where hands are (cells within ~200 px of a fingertip split to the max depth, then heal back over ~3 s);
 * a tap sends a ring outward that turns every tile it passes a quarter turn (the whole weave re-routes); a still hand spins the
 * ribbons around it through the four orientations; a body behind the wall is woven in finer and warmer. Idle: a wandering
 * subdivision focus and a single tile flipping now and then.
 * WebGL2, one full-screen fragment pass: each pixel walks the quadtree itself (the split test is evaluated at cell centres, so every
 * pixel of a cell agrees), exact arcs by distance. Small CPU field (80 x 50 texels over the 1280 x 800 design space) carries hand,
 * body and focus detail plus baked tile orientations. No audio, no network, no assets. ASCII only.
 * Looks (2026-11-01): named presets of the two six-stop ribbon gradients, seven ground / shadow / light colours and two shape knobs
 * (depth, ribbon width; no look exceeds the default depth 3, so none costs more; not the grid: a grid zoom moves cell centres across baked tile turns and would flip tiles). A change eases
 * every colour uniform over ~0.8 s (tau 0.25 s) and depth / ribbon through the existing eased display values (tau 0.4 s); the
 * quadtree's own split cross-fade covers a depth change. A moved knob overrides the look's value until the next look.
 */
(function () {
  'use strict';
  registerWallPlugin({id: 'truchetweave', title: 'Truchet Weave', author: 'Claude Opus 5.5 (genart builder D)', create: create});

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

  var FW = 80, FH = 50, TX = 16;                 // field texels over the 1280 x 800 design space (16 px each)
  var MAXRIP = 8, MAXSPIN = 2;
  var RIP_SPEED = 620, RIP_W = 150;              // tap ring speed (px/s) and the width of its turning front (px)
  var HEAL_S = 3.0;                              // refined detail heals back over this long
  var HAND_R0 = 110, HAND_R1 = 380;              // detail falls from full at R0 to none at R1 (px): max depth to ~200 px, then a graded halo
  var HOLD_S = 0.9, HOLD_R = 200, SPIN_RATE = 0.62;   // a still finger this long spins tiles within HOLD_R, quarter turns per second
  // palettes: the Go's explicit constants (bgDark, shadowCol, spine ivory); UkiyoE / Dunhuang stops reconstructed (not in goref)
  var UKI = [[31, 59, 92], [47, 111, 143], [143, 184, 176], [239, 225, 193], [226, 160, 74], [200, 72, 58]];
  var DUN = [[46, 107, 94], [63, 127, 166], [232, 217, 181], [217, 168, 78], [181, 69, 47], [107, 58, 42]];
  // Looks: uki / dun = the two ribbon gradients, pal = [ground, shadow, cream spine, tile frame light, pin light, body warmth, spin ring]
  // (0..255), and the two shape knobs. Look 0 is the original (the Go's constants and the shader's old literals, the knob defaults).
  var LOOKS = [
    {name: 'ukiyoe', depth: 3, ribbon: 100, uki: UKI, dun: DUN,
     pal: [[20, 28, 38], [8, 11, 16], [250, 242, 222], [220, 210, 190], [255, 244.8, 224.4], [70, 32, 14], [242.25, 219.3, 168.3]]},
    {name: 'indigo', depth: 2, ribbon: 130,
     uki: [[10, 20, 50], [20, 45, 100], [60, 100, 170], [230, 236, 245], [150, 180, 220], [40, 70, 140]],
     dun: [[20, 40, 90], [50, 90, 160], [235, 240, 250], [120, 150, 200], [30, 60, 130], [15, 25, 60]],
     pal: [[6, 12, 30], [2, 4, 12], [255, 255, 255], [200, 215, 240], [240, 246, 255], [20, 40, 90], [200, 220, 255]]},
    {name: 'paper', depth: 3, ribbon: 90,
     uki: [[214, 204, 184], [60, 56, 60], [24, 22, 26], [128, 42, 30], [70, 66, 70], [30, 28, 32]],
     dun: [[90, 84, 80], [40, 38, 40], [236, 228, 208], [160, 150, 140], [196, 68, 48], [30, 28, 30]],
     pal: [[226, 218, 198], [120, 112, 100], [250, 246, 236], [140, 130, 115], [250, 244, 230], [180, 70, 40], [180, 60, 40]]},
    {name: 'ember', depth: 3, ribbon: 80,
     uki: [[40, 8, 4], [120, 24, 8], [220, 90, 20], [255, 200, 110], [255, 140, 40], [180, 30, 10]],
     dun: [[90, 20, 8], [200, 60, 16], [255, 220, 150], [240, 140, 40], [160, 30, 10], [60, 10, 4]],
     pal: [[16, 5, 3], [6, 2, 1], [255, 236, 200], [255, 170, 90], [255, 230, 180], [90, 30, 8], [255, 180, 90]]},
    {name: 'neon', depth: 2, ribbon: 65,
     uki: [[10, 0, 40], [255, 0, 160], [0, 220, 255], [240, 255, 255], [255, 230, 0], [120, 0, 255]],
     dun: [[0, 255, 200], [255, 40, 120], [230, 240, 255], [0, 160, 255], [200, 0, 255], [20, 0, 60]],
     pal: [[3, 0, 10], [0, 0, 0], [255, 255, 255], [120, 60, 255], [255, 255, 255], [60, 0, 80], [255, 120, 255]]},
    {name: 'jade', depth: 1, ribbon: 120,
     uki: [[8, 30, 26], [30, 90, 74], [120, 190, 160], [230, 244, 226], [200, 170, 90], [60, 140, 110]],
     dun: [[40, 110, 90], [90, 170, 140], [236, 240, 220], [170, 210, 180], [30, 80, 64], [10, 40, 32]],
     pal: [[4, 18, 16], [1, 6, 5], [245, 255, 240], [160, 220, 190], [235, 255, 240], [30, 80, 50], [180, 255, 210]]}
  ];
  var NCOL = 6 + 6 + 7, PAL_TAU = 0.25;

  var VS = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS = [
    '#version 300 es',
    'precision highp float; precision highp int;',
    'uniform vec2 uRes; uniform float uPx, uTime, uGrid, uRib, uHue, uFlow;',
    'uniform sampler2D uLevel; uniform sampler2D uWarm; uniform sampler2D uOrient;',
    'uniform vec4 uRip[8]; uniform int uNRip; uniform float uRipW;',
    'uniform vec4 uSpin[2]; uniform int uNSpin;',
    'uniform vec3 uUki[6]; uniform vec3 uDun[6];',
    'uniform vec3 uPal[7];',                           // the look's ground / shadow / light colours (eased in JS)
    'out vec4 o;',
    'const vec2 CEN = vec2(640., 400.);',
    '#define BG uPal[0]',
    '#define SHADOW uPal[1]',
    '#define CREAM uPal[2]',
    '#define FRAMEL uPal[3]',
    '#define DOTL uPal[4]',
    '#define WARMG uPal[5]',
    '#define SPINC uPal[6]',
    'const float MINCELL = 18.;',
    'float h21(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }',
    'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);',
    '  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }',
    'float fbm(vec2 p){ return .5 * vn(p) + .3 * vn(p * 2.03 + 7.1) + .2 * vn(p * 4.01 - 3.3); }',
    'vec3 uki(float t){ t = clamp(t, 0., 1.) * 5.; int i = min(int(t), 4); return mix(uUki[i], uUki[i + 1], t - float(i)); }',
    'vec3 dun(float t){ t = clamp(t, 0., 1.) * 5.; int i = min(int(t), 4); return mix(uDun[i], uDun[i + 1], t - float(i)); }',
    'vec3 hueRot(vec3 c, float a){ vec3 k = vec3(.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca); }',
    // how many quadtree levels a cell of size S centred at c wants: the ground FBM level at its centre (as the Go splits), or the
    // most any texel under the cell wants from hands, bodies and the focus (the CPU keeps that max-dilated by 1, 2, 4 and 8 texels
    // in r, g, b, a). Both are eased per texel toward whole numbers, so a split is a quick cross-fade, never a resting double image.
    'float detailAt(vec2 c, float S){ ivec2 t = clamp(ivec2(floor(c / 16.)), ivec2(0), ivec2(79, 49)); vec4 m = texelFetch(uLevel, t, 0);',
    '  float h = S * .5; return 4. * max(texelFetch(uWarm, t, 0).g, h <= 16. ? m.r : h <= 32. ? m.g : h <= 64. ? m.b : m.a); }',
    // band colour, symmetric across the ribbon so a ribbon keeps its colours where it runs on into the next tile
    'vec3 bandColor(float bandU, float baseT, float warm, float spine){',
    '  float symU = 1. - abs(2. * bandU - 1.);',
    '  float t = mix(clamp(baseT * .7 + (1. - symU) * .3, 0., 1.), .78 + .14 * (1. - symU), .85 * warm);',
    '  vec3 c = mix(uki(t), dun(1. - t), .28 * symU);',
    '  c = mix(c, CREAM, .3 * step(abs(bandU - .5), .01) * spine);',
    '  return c * (1. + .22 * warm); }',
    // one 5-band ribbon; s = signed offset from its centre line in tile units
    'void ribbon(inout vec3 col, float s, float on, float baseT, float warm, float pxT, float S){',
    '  if (on <= 0.) return;',
    '  float sp = .064 * uRib, sw = max(.75 / S, sp * .64), span = 4. * sp + sw, a = abs(s);',
    '  float sh1 = 1. - smoothstep(span * .5 + sw * .4, span * .5 + sw * 1.8 + 2. * pxT, a);',
    '  col *= 1. - .55 * sh1 * on;',
    '  col = mix(col, SHADOW, .72 * clamp((span * .5 + sw * .55 - a) / pxT + .5, 0., 1.) * on);',
    '  float bi = clamp(floor(s / sp + 2.5), 0., 4.), bd = abs(s - (bi - 2.) * sp);',
    '  float cov = clamp((sw * .5 - bd) / pxT + .5, 0., 1.);',
    '  vec3 bc = bandColor(bi * .25, baseT, warm, 1.);',
    '  float fine = smoothstep(1.3, 2.8, sp / pxT);',
    '  vec3 mc = (bandColor(.25, baseT, warm, 0.) + bandColor(0., baseT, warm, 0.)) * .5;',
    '  float solid = clamp((span * .5 - a) / pxT + .5, 0., 1.) * .9;',
    '  vec3 sc = mix(mc * .78, mix(mc, CREAM, .45), exp(-a * a / (pxT * pxT * .8)));',
    '  col = mix(col, mix(sc, bc, fine), mix(solid, cov * .94, fine) * on); }',
    'float disk(vec2 u, vec2 c, float r, float pxT){ return clamp((r - length(u - c)) / pxT + .5, 0., 1.); }',
    'vec3 tile(vec2 p, vec2 org, float S, float d, vec3 col, float warm, float baseT){',
    '  vec2 cc = org + .5 * S;',
    '  vec2 cid = floor((org - CEN) / S + .5);',
    '  float hA = h21(cid + vec2(d * 17.13, d * 3.1) + .37), hB = h21(cid * 1.731 + vec2(9.2 + d, 4.4)), hC = h21(cid * 2.37 + vec2(-3.7 * d, 1.9));',
    '  ivec2 tx = clamp(ivec2(floor(cc / 16.)), ivec2(0), ivec2(79, 49));',
    '  vec2 tc = (vec2(tx) + .5) * 16.;',
    '  float rot = floor(hA * 4.) + floor(texelFetch(uOrient, tx, 0).r * 255. + .5);',
    '  for (int i = 0; i < 8; i++) { if (i >= uNRip) break; vec4 r = uRip[i]; float dd = length(tc - r.xy); if (dd < r.w) rot += smoothstep(0., 1., (r.z - dd) / uRipW); }',
    '  for (int i = 0; i < 2; i++) { if (i >= uNSpin) break; vec4 q = uSpin[i]; if (length(tc - q.xy) < q.z) rot += q.w; }',
    '  float an = rot * 1.5707963, cs = cos(an), sn = sin(an);',
    '  vec2 u = (p - cc) / S; u = vec2(cs * u.x + sn * u.y, -sn * u.x + cs * u.y) + .5;',
    '  float pxT = uPx / S;',
    '  float tn = fbm(cc * .005 + 3.1);',
    '  col = mix(col, mix(BG, uki(tn), .14), .42);',
    '  vec2 lp = (p - org) / S; float ed = min(min(lp.x, 1. - lp.x), min(lp.y, 1. - lp.y)) / pxT;',
    '  vec3 frameC = mix(uki(.5), FRAMEL, .4);',
    '  col = mix(col, frameC, .16 * clamp(1.3 - ed, 0., 1.));',
    '  float inT = step(max(abs(u.x - .5), abs(u.y - .5)), .5);',
    '  float tw = warm;',
    '  if (hB < .84) {',
    '    if (d <= 2. && hC < .65) ribbon(col, length(u - vec2(1., 0.)) - .5, inT, baseT, tw, pxT, S);',
    '    ribbon(col, length(u) - .5, inT, baseT, tw, pxT, S);',
    '    ribbon(col, length(u - vec2(1.)) - .5, inT, baseT, tw, pxT, S);',
    '  } else if (hC < .5) {',
    '    ribbon(col, u.y - .5, inT, baseT, tw, pxT, S); ribbon(col, u.x - .5, inT, baseT, tw, pxT, S);',
    '  } else {',
    '    ribbon(col, u.x - .5, inT, baseT, tw, pxT, S); ribbon(col, u.y - .5, inT, baseT, tw, pxT, S);',
    '  }',
    '  vec3 dotO = uki(clamp(tn + .18, 0., 1.)), dotI = mix(dun(.35), DOTL, .45);',
    '  inT *= smoothstep(30., 60., S);',
    '  float r = max(1.4 / S, .068);',
    '  col = mix(col, SHADOW, .55 * disk(u, vec2(.5), r * 1.35, pxT * 2.) * inT);',
    '  col = mix(col, dotO, .9 * disk(u, vec2(.5), r, pxT) * inT);',
    '  col = mix(col, dotI, .95 * disk(u, vec2(.5), r * .46, pxT) * inT);',
    '  float ring = abs(length(u - .5) - r * 1.45); col = mix(col, dotI, .5 * clamp((max(.7 / S, .015) * .5 - ring) / pxT + .5, 0., 1.) * inT);',
    '  float pr = max(1. / S, .036);',
    '  for (int k = 0; k < 4; k++) { vec2 ep = k == 0 ? vec2(.5, 0.) : k == 1 ? vec2(1., .5) : k == 2 ? vec2(.5, 1.) : vec2(0., .5);',
    '    col = mix(col, SHADOW, .45 * disk(u, ep, pr * 1.2, pxT * 1.5) * inT); col = mix(col, dotI, .82 * disk(u, ep, pr * .75, pxT) * inT); }',
    '  return col; }',
    'void main(){',
    '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) * vec2(1280., 800.) / uRes;',
    '  float radT = clamp(length(p - CEN) / 754.7, 0., 1.);',
    '  float nb = fbm(p * .0042 + 1.7);',
    '  vec3 bgMid = mix(BG, uki(.12), .35);',
    '  vec3 col = mix(bgMid, BG, .65 * radT + .35 * (1. - nb));',
    '  float warm = texture(uWarm, p / vec2(1280., 800.)).r;',
    '  col = mix(col, WARMG, .7 * warm);',
    '  float baseT = fbm(p * .0017 + vec2(uFlow, -uFlow * .6));',
    '  float S0 = 1280. / uGrid;',
    '  vec2 org = CEN + floor((p - CEN) / S0) * S0;',
    '  float S = S0, d = 0., D = 0.;',
    '  for (int k = 0; k < 4; k++) {',
    '    D = detailAt(org + .5 * S, S);',
    '    if (D >= d + .999 && S * .5 >= MINCELL) { S *= .5; org += step(org + S, p) * S; d += 1.; } else break;',
    '  }',
    '  float f = (S * .5 >= MINCELL) ? smoothstep(0., 1., D - d) : 0.;',
    '  vec3 c1 = tile(p, org, S, d, col, warm, baseT);',
    '  if (f > .002) { vec2 o2 = org + step(org + S * .5, p) * S * .5; c1 = mix(c1, tile(p, o2, S * .5, d + 1., col, warm, baseT), f); }',
    '  col = c1;',
    '  float glow = 0.;',
    '  for (int i = 0; i < 8; i++) { if (i >= uNRip) break; vec4 r = uRip[i]; if (r.w < 100.) continue; float e = (length(p - r.xy) - r.z) / 46.; glow += exp(-e * e) * clamp(1. - r.z / r.w, 0., 1.); }',
    '  col *= 1. + .45 * min(glow, 1.5);',
    '  for (int i = 0; i < 2; i++) { if (i >= uNSpin) break; vec4 q = uSpin[i]; float l = length(p - q.xy), e = (l - q.z) / 2.2;',
    '    col += SPINC * (.26 * exp(-e * e) + .05 * smoothstep(q.z, 0., l)); }',
    '  col *= .955 + .09 * h21(floor(p * 1.5));',
    '  col *= 1. - .22 * smoothstep(.25, 1., radT * radT);',
    '  col = hueRot(col, uHue);',
    '  o = vec4(clamp(col, 0., 1.), 1.);',
    '}'
  ].join('\n');

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  function create(canvas, kit) {
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false});
    if (!gl) throw new Error('Truchet Weave needs WebGL2');
    var dead = false;
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { var log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('Truchet Weave shader: ' + log); }
      return s;
    }
    var vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS), prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Truchet Weave link: ' + gl.getProgramInfoLog(prog));
    var vao = gl.createVertexArray();
    var U = {};
    ['uRes', 'uPx', 'uTime', 'uGrid', 'uRib', 'uHue', 'uFlow', 'uLevel', 'uWarm', 'uOrient', 'uRip', 'uNRip', 'uRipW', 'uSpin', 'uNSpin', 'uUki', 'uDun', 'uPal']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    gl.useProgram(prog);
    // the look's colours: target (palGo) and on screen (palNow, eased), packed uki | dun | pal as 0..1 floats
    var palGo = new Float32Array(NCOL * 3), palNow = new Float32Array(NCOL * 3), palUki = palNow.subarray(0, 18), palDun = palNow.subarray(18, 36), palRest = palNow.subarray(36);
    function lookTargets(L) { var all = L.uki.concat(L.dun, L.pal); for (var i = 0; i < NCOL; i++) for (var j = 0; j < 3; j++) palGo[i * 3 + j] = all[i][j] / 255; }
    lookTargets(LOOKS[0]); palNow.set(palGo);
    gl.uniform1i(U.uLevel, 0); gl.uniform1i(U.uOrient, 1); gl.uniform1i(U.uWarm, 2);

    var N = FW * FH;
    var detail = new Float32Array(N), level = new Float32Array(N), lbase = new Float32Array(N), warm = new Float32Array(N), orient = new Uint8Array(N);
    var levelBytes = new Uint8Array(N * 4), warmBytes = new Uint8Array(N * 2);
    var dil1 = new Float32Array(N), dil2 = new Float32Array(N), dil4 = new Float32Array(N), dil8 = new Float32Array(N), dtA = new Float32Array(N), dtB = new Float32Array(N);
    var LAT = 32, lat = new Float32Array(LAT * LAT);            // value-noise lattice for the slow ground detail (CPU side)
    for (var li = 0; li < lat.length; li++) lat[li] = Math.random();
    var maskIdx = new Int32Array(N).fill(-1), maskAt = -1e9;
    function tex(filter, ifmt, fmt, data) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, FW, FH, 0, fmt, gl.UNSIGNED_BYTE, data);
      return t;
    }
    var levelTex = tex(gl.NEAREST, gl.RGBA8, gl.RGBA, levelBytes), warmTex = tex(gl.LINEAR, gl.RG8, gl.RG, warmBytes), orientTex = tex(gl.NEAREST, gl.R8, gl.RED, orient), orientDirty = false;
    var ripBuf = new Float32Array(MAXRIP * 4), spinBuf = new Float32Array(MAXSPIN * 4);

    var body = WallBody.create(kit), input = refreshContacts(kit, 120), hueFlow = refreshHue(0);
    var settings = {look: 0, grid: 6, depth: 3, ribbon: 100, hue: 0};
    var disp = {grid: 6, depth: 3, ribbon: 100};
    var LK = LOOKS[0], over = {depth: false, ribbon: false}, looks = 0;   // a moved knob overrides the look's value until the next look
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    function applyLook(i) { LK = LOOKS[i]; over.depth = over.ribbon = false; lookTargets(LK); looks++; }
    var time = 0, flow = 0, frames = 0, frameMs = 0, size = [canvas.width, canvas.height];
    var tracks = [], ripples = [], spins = [], nextFlip = 1.2, taps = 0, holds = 0, baked = 0, contactsN = 0, bodyCount = 0;
    var seed = 1;
    function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
    seed = 1 + Math.floor(Math.random() * 2147483640);

    function bake(x, y, r, n) {                       // turn every field texel whose centre is within r of (x, y) by n quarter turns
      n = ((n % 4) + 4) % 4; if (!n) return;
      for (var ty = 0; ty < FH; ty++) for (var tx = 0; tx < FW; tx++) {
        var cx = (tx + 0.5) * TX - x, cy = (ty + 0.5) * TX - y;
        if (cx * cx + cy * cy < r * r) { var i = ty * FW + tx; orient[i] = (orient[i] + n) & 3; }
      }
      orientDirty = true; baked++;
    }
    function addRipple(x, y, maxR, speed) {
      if (ripples.length >= MAXRIP) return false;
      ripples.push({x: x, y: y, r: 0, maxR: maxR, speed: speed}); return true;
    }
    function tap(x, y) {                              // design px
      for (var i = 0; i < ripples.length; i++) if (ripples[i].maxR > 100 && ripples[i].r < 120 && Math.hypot(ripples[i].x - x, ripples[i].y - y) < 90) return;
      var far = 0; [[0, 0], [1280, 0], [0, 800], [1280, 800]].forEach(function (c) { far = Math.max(far, Math.hypot(c[0] - x, c[1] - y)); });
      if (addRipple(x, y, far + 24, RIP_SPEED)) taps++;
    }
    function remapMask(now) {                         // field texel -> body cell (through the registration; a straight stretch without one)
      if (now - maskAt < 2000) return; maskAt = now;
      for (var ty = 0; ty < FH; ty++) for (var tx = 0; tx < FW; tx++) {
        var sx = (tx + 0.5) / FW, sy = (ty + 0.5) / FH, k = kit.fromScreen(sx, sy), u, v;
        if (k && Number.isFinite(k[0]) && Number.isFinite(k[1])) { u = k[0]; v = k[1]; } else { u = sx * 512; v = sy * 424; }
        var cx = Math.floor(u / 4), cy = Math.floor(v / 4);
        maskIdx[ty * FW + tx] = cx >= 0 && cx < body.w && cy >= 0 && cy < body.h ? cy * body.w + cx : -1;
      }
    }

    function updateTracks(pts, dt) {
      tracks.forEach(function (t) { t.seen = false; });
      for (var i = 0; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1], best = null, bd = 0.08;
        for (var j = 0; j < tracks.length; j++) { var tr = tracks[j]; if (tr.seen) continue; var d = Math.hypot(tr.x - x, tr.y - y); if (d < bd) { bd = d; best = tr; } }
        if (!best) { best = {x: x, y: y, ax: x, ay: y, still: 0, spin: null}; tracks.push(best); tap(x * 1280, y * 800); }
        best.x = x; best.y = y; best.seen = true;
        if (Math.hypot(x - best.ax, y - best.ay) > 0.014) { best.ax = x; best.ay = y; best.still = 0; if (best.spin) { best.spin.release = true; best.spin = null; } }
        else best.still += dt;
        if (best.still >= HOLD_S && !best.spin && spins.length < MAXSPIN) { best.spin = {x: best.ax * 1280, y: best.ay * 800, r: HOLD_R, phase: 0, release: false}; spins.push(best.spin); holds++; }
      }
      for (var k = tracks.length - 1; k >= 0; k--) if (!tracks[k].seen) { if (tracks[k].spin) tracks[k].spin.release = true; tracks.splice(k, 1); }
    }
    function spinShow(ph) { var n = Math.floor(ph); return n + sstep(0.12, 0.62, ph - n); }

    function vnoise(x, y) {
      var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, m = LAT - 1;
      var x0 = ix & m, y0 = iy & m, x1 = (ix + 1) & m, y1 = (iy + 1) & m;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var a = lat[y0 * LAT + x0], b = lat[y0 * LAT + x1], c = lat[y1 * LAT + x0], d = lat[y1 * LAT + x1];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    function fbm(x, y) { return 0.5 * vnoise(x, y) + 0.3 * vnoise(x * 2.03 + 7.1, y * 2.03 + 7.1) + 0.2 * vnoise(x * 4.01 - 3.3, y * 4.01 - 3.3); }

    // Per texel: a wanted quadtree depth (ground FBM + hands + body + the wandering focus), rounded to a whole level; the shown
    // level then walks toward it at a fixed pace, so every split or merge is a quick cross-fade and nothing rests half-way.
    function updateField(pts, dt) {
      var kUp = 1 - Math.exp(-dt / 0.12), down = dt / HEAL_S, kw = 1 - Math.exp(-dt / 0.25), kwd = 1 - Math.exp(-dt / 0.9);
      var fx = 640 + 470 * Math.sin(time * 0.067 + 1.3) + 90 * Math.sin(time * 0.23), fy = 400 + 250 * Math.sin(time * 0.049 + 0.4) + 60 * Math.cos(time * 0.19);
      var mask = body.mask, hx = [], hy = [];
      for (var i = 0; i < pts.length; i++) { hx.push(pts[i][0] * 1280); hy.push(pts[i][1] * 800); }
      var fr0 = 60, fr1 = 260, fs = pts.length ? 0.35 : 0.62;
      var cap = disp.depth + 0.125, mul = disp.depth + 0.35, upStep = dt * 6, dnStep = dt * 4.5, nt = time * 0.011;
      for (var ty = 0; ty < FH; ty++) for (var tx = 0; tx < FW; tx++) {
        var idx = ty * FW + tx, cx = (tx + 0.5) * TX, cy = (ty + 0.5) * TX, tgt = 0;
        var df = Math.hypot(cx - fx, cy - fy); if (df < fr1) tgt = fs * sstep(fr1, fr0, df);
        for (var h = 0; h < hx.length; h++) { var dh = Math.hypot(cx - hx[h], cy - hy[h]); if (dh < HAND_R1) tgt = Math.max(tgt, sstep(HAND_R1, HAND_R0, dh)); }
        var m = 0, mi = maskIdx[idx]; if (mi >= 0) m = mask[mi] || 0;
        if (m > 0.04) tgt = Math.max(tgt, Math.min(1, m * 1.25));
        var v = detail[idx]; v = tgt > v ? v + (tgt - v) * kUp : Math.max(tgt, v - down); detail[idx] = v;
        var want = Math.floor(Math.min(cap, v * mul) + 0.5), L = level[idx];
        if (want > L) L = Math.min(want, L + upStep); else if (want < L) L = Math.max(want, L - dnStep);
        level[idx] = L;
        var bw = Math.floor(Math.min(cap, sstep(0.45, 0.75, fbm(cx * 0.0021 + nt, cy * 0.0021 - nt * 0.7)) * 2.2) + 0.5), B = lbase[idx];
        if (bw > B) B = Math.min(bw, B + upStep); else if (bw < B) B = Math.max(bw, B - dnStep);
        lbase[idx] = B;
        var w = warm[idx]; w += (m - w) * (m > w ? kw : kwd); warm[idx] = w;
        warmBytes[idx * 2] = Math.round(clamp(w, 0, 1) * 255); warmBytes[idx * 2 + 1] = Math.round(clamp(B, 0, 4) * 63.75);
      }
      dilate(level, dil1); dilate(dil1, dil2); dilate(dil2, dtB); dilate(dtB, dil4);
      dilate(dil4, dtB); dilate(dtB, dil8); dilate(dil8, dtB); dilate(dtB, dil8); dilate(dil8, dtB); dilate(dtB, dil8);
      for (var q = 0; q < N; q++) {
        levelBytes[q * 4] = Math.round(dil1[q] * 63.75); levelBytes[q * 4 + 1] = Math.round(dil2[q] * 63.75);
        levelBytes[q * 4 + 2] = Math.round(dil4[q] * 63.75); levelBytes[q * 4 + 3] = Math.round(dil8[q] * 63.75);
      }
    }
    function dilate(src, dst) {                       // 3 x 3 max, separable; dst may not be src
      var x, y, i, a, b, c;
      for (y = 0; y < FH; y++) for (x = 0; x < FW; x++) { i = y * FW + x; a = x > 0 ? src[i - 1] : src[i]; b = src[i]; c = x < FW - 1 ? src[i + 1] : src[i]; dtA[i] = a > b ? (a > c ? a : c) : (b > c ? b : c); }
      for (y = 0; y < FH; y++) for (x = 0; x < FW; x++) { i = y * FW + x; a = y > 0 ? dtA[i - FW] : dtA[i]; b = dtA[i]; c = y < FH - 1 ? dtA[i + FW] : dtA[i]; dst[i] = a > b ? (a > c ? a : c) : (b > c ? b : c); }
    }

    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      hueFlow.step(settings.hue, dt);
      var ke = 1 - Math.exp(-dt / 0.4);
      disp.grid += (settings.grid - disp.grid) * ke; disp.depth += (want('depth') - disp.depth) * ke; disp.ribbon += (want('ribbon') - disp.ribbon) * ke;
      var kp = 1 - Math.exp(-dt / PAL_TAU);
      for (var pi = 0; pi < NCOL * 3; pi++) palNow[pi] += (palGo[pi] - palNow[pi]) * kp;
      body.update(dt, now); remapMask(now);
      bodyCount = body.fresh ? body.people.length : 0;
      var pts = input.read(); contactsN = pts.length;
      updateTracks(pts, dt);
      updateField(pts, dt);
      flow += dt * (0.012 + 0.02 * Math.min(1, pts.length));
      // ripples: grow, and when a ring has passed everything it covers, bake its quarter turn into the orientation field
      for (var i = ripples.length - 1; i >= 0; i--) {
        var r = ripples[i]; r.r += r.speed * dt;
        if (r.r >= r.maxR + RIP_W) { bake(r.x, r.y, r.maxR, 1); ripples.splice(i, 1); }
      }
      nextFlip -= dt;
      if (nextFlip <= 0) {                            // idle: one tile turns a quarter now and then
        nextFlip = 1.1 + rnd() * 1.8;
        var tx = Math.floor(rnd() * FW), ty = Math.floor(rnd() * FH);
        addRipple((tx + 0.5) * TX, (ty + 0.5) * TX, 7, 300);
      }
      for (var s = spins.length - 1; s >= 0; s--) {
        var sp = spins[s];
        if (!sp.release) sp.phase += dt * SPIN_RATE;
        else { var target = Math.ceil(sp.phase - 1e-6); sp.phase = Math.min(target, sp.phase + dt * SPIN_RATE * 1.6);
          if (sp.phase >= target - 1e-6) { bake(sp.x, sp.y, sp.r, Math.round(target)); spins.splice(s, 1); } }
      }
      draw();
      frameMs = performance.now() - t0;
    }

    function draw() {
      var w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, levelTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FW, FH, gl.RGBA, gl.UNSIGNED_BYTE, levelBytes);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, warmTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FW, FH, gl.RG, gl.UNSIGNED_BYTE, warmBytes);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, orientTex);
      if (orientDirty) { gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FW, FH, gl.RED, gl.UNSIGNED_BYTE, orient); orientDirty = false; }
      ripBuf.fill(0); spinBuf.fill(0);
      for (var i = 0; i < ripples.length && i < MAXRIP; i++) { var r = ripples[i]; ripBuf[i * 4] = r.x; ripBuf[i * 4 + 1] = r.y; ripBuf[i * 4 + 2] = r.r; ripBuf[i * 4 + 3] = r.maxR; }
      for (var j = 0; j < spins.length && j < MAXSPIN; j++) { var s = spins[j]; spinBuf[j * 4] = s.x; spinBuf[j * 4 + 1] = s.y; spinBuf[j * 4 + 2] = s.r; spinBuf[j * 4 + 3] = spinShow(s.phase); }
      gl.uniform2f(U.uRes, w, h); gl.uniform1f(U.uPx, 1280 / Math.max(1, w));
      gl.uniform1f(U.uTime, time); gl.uniform1f(U.uFlow, flow);
      gl.uniform1f(U.uGrid, disp.grid);
      gl.uniform1f(U.uRib, disp.ribbon / 100);
      gl.uniform1f(U.uHue, hueFlow.value * Math.PI / 180);
      gl.uniform3fv(U.uUki, palUki); gl.uniform3fv(U.uDun, palDun); gl.uniform3fv(U.uPal, palRest);
      gl.uniform4fv(U.uRip, ripBuf); gl.uniform1i(U.uNRip, Math.min(ripples.length, MAXRIP)); gl.uniform1f(U.uRipW, RIP_W);
      gl.uniform4fv(U.uSpin, spinBuf); gl.uniform1i(U.uNSpin, Math.min(spins.length, MAXSPIN));
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    var LIM = {look: [0, LOOKS.length - 1], grid: [4, 10], depth: [1, 4], ribbon: [50, 150], hue: [0, 360]};
    function set(o) {
      if (o && typeof o === 'object') {
        var lk = o.look;                                // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['depth', 'ribbon'].forEach(function (k) {       // a knob that MOVED overrides the look's value until the next look
          var v = o[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
          v = clamp(v, LIM[k][0], LIM[k][1]); if (v !== settings[k]) { settings[k] = v; over[k] = true; }
        });
        ['grid', 'hue'].forEach(function (k) { var v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) settings[k] = clamp(v, LIM[k][0], LIM[k][1]); });
      }
      return {look: settings.look, grid: settings.grid, depth: settings.depth, ribbon: settings.ribbon, hue: settings.hue};
    }
    function resize(w, h) { if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) size = [w, h]; }
    function destroy() {
      if (dead) return; dead = true;
      tracks = []; ripples = []; spins = []; input.clear();
      try { gl.deleteTexture(levelTex); gl.deleteTexture(warmTex); gl.deleteTexture(orientTex); gl.deleteVertexArray(vao); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); } catch (e) {}
      kit.wantDepth(false);
      if (window.TruchetweaveSet === set) delete window.TruchetweaveSet;
    }

    kit.wantDepth(true);
    window.TruchetweaveSet = set; if (window._truchetweaveFx) set(window._truchetweaveFx);
    LK = LOOKS[settings.look]; lookTargets(LK); palNow.set(palGo);   // start on the stored look and knobs without easing in
    disp.grid = settings.grid; disp.depth = want('depth'); disp.ribbon = want('ribbon'); hueFlow.snap(settings.hue);
    var out = {frame: frame, touch: function (t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      var dmax = 0, wmax = 0, lmax = 0; for (var i = 0; i < N; i++) { if (detail[i] > dmax) dmax = detail[i]; if (warm[i] > wmax) wmax = warm[i]; if (Math.max(level[i], lbase[i]) > lmax) lmax = Math.max(level[i], lbase[i]); }
      return {frames: frames, frameMs: frameMs, contacts: contactsN, tracks: tracks.length, taps: taps, holds: holds, ripples: ripples.length,
        spins: spins.map(function (s) { return {x: s.x, y: s.y, phase: s.phase, release: s.release}; }), baked: baked, bodyCount: bodyCount,
        detailMax: dmax, levelMax: lmax, warmMax: wmax, look: LK.name, looks: looks, overrides: Object.assign({}, over), palette: Array.prototype.slice.call(palNow, 36, 42), settings: set(), disp: {grid: disp.grid, depth: disp.depth, ribbon: disp.ribbon}, displayHue: hueFlow.value, size: size, destroyed: dead};
    };
    return out;
  }
})();
