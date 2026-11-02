/* Lichtenberg (genart lab piece, Builder C, 2026-10-22). Port of jdxyw/generativeart lichtenbergtree.go: a high-voltage dielectric
 * breakdown figure caught in a bevelled obsidian-sapphire acrylic block. Go palette (abyss acrylic, sapphire block, violet corona,
 * electric cyan, plasma gold, incandescent white) and Go tree: buildBranch's primary leader + lateral fork + 48% tertiary twig with
 * alternating sign, midpoint-displaced chords (3 passes, roughness), Strahler-ordered widths and the Go's three stroke passes
 * (violet corona sheath, cyan->gold channel, white core). Built breadth-first and capped at discharge time, revealed along its path
 * length (stepped leader, ~0.6 s), then a return stroke flashes the block and the trace cools to a faint permanent burn.
 * Input: a held finger charges a humming corona; release or a full charge discharges a tree (re-fires while held); touch-down sparks
 * and makes every old trace flare; two charged fingers grow toward each other and bridge with an arc; bodies are conductors
 * (trees steer onto the body.sdf outline and light it cyan; a person near old traces gets struck now and then).
 * Canvas 2D, offscreen baked layers, no audio, no network, ASCII only. Colour shift = a CSS hue-rotate on the piece's own canvas.
 * Looks (2026-11-01): named presets of the six palette colours (+ the acrylic reflection tint) and the four knobs (branches,
 * roughness, glow, cooling; no look branches more than the default 9, so no discharge costs more). The colours are baked into the block and every trace layer, so a look change snapshots the frame on
 * screen, re-bakes the block, sprites and traces in the new palette at once and fades the snapshot out over ~0.8 s; glow and
 * cooling ease (tau 0.45 s), branches and roughness apply to the next discharge (one fires ~1 s after the change when idle).
 * A moved knob overrides the look's value until the next look.
 */
(function () {
  'use strict';

  // --- contacts: the prismpathsflow refreshContacts pattern (a 120 ms dropout is not a release; a stale frame never revives a hand)
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
    return {read: read, wake: wake, clear: function () { wakes = []; last = []; }, get state() { return state; }};
  }
  function refreshHue(initial) {
    var value = Number.isFinite(initial) ? initial : 0;
    return {get value() { return value; }, snap: function (v) { value = v; }, step: function (target, dt) { var d = ((target - value + 540) % 360) - 180; if (Math.abs(d) < 0.001) { value = target % 360; return; } value = (value + d * (1 - Math.exp(-Math.max(0, Math.min(0.1, dt)) / 0.18)) + 360) % 360; }};
  }

  // --- the Go palette (named color.RGBA constants in lichtenbergtree.go)
  var ABYSS = [6, 8, 18], SAPPHIRE = [12, 22, 48], VIOLET = [96, 38, 196], CYAN = [48, 212, 255], GOLD = [255, 196, 78], WHITE = [255, 250, 238];
  var W = 1280, H = 800, MARGIN = 32, BEVEL = 22, RAD = 18;                   // the Go's 24*scale margin, scale = 800/600
  var BX0 = MARGIN * 1.3, BX1 = W - MARGIN * 1.3, BY0 = MARGIN * 1.3, BY1 = H - MARGIN * 1.3;
  var CHARGE_S = 1.2, REFIRE_S = 0.6, MAX_TRACES = 6, SEG_CAP = 2400, GW = 64, GH = 40, GC = 20;
  // Looks: palette [abyss, sapphire block, corona, channel, plasma, core white] + the acrylic reflection pair (0..255), and the four knobs.
  // Look 0 is the original (the Go constants, the knob defaults).
  var LOOKS = [
    {name: 'sapphire', branches: 9,  rough: 1,   glow: 60, cool: 4, pal: [ABYSS, SAPPHIRE, VIOLET, CYAN, GOLD, WHITE], refl: [[120, 190, 255], [170, 225, 255]]},
    {name: 'ember',    branches: 9,  rough: 1.4, glow: 75, cool: 6, pal: [[10, 4, 2], [42, 14, 6], [204, 42, 10], [255, 138, 30], [255, 228, 120], [255, 250, 230]], refl: [[255, 150, 80], [255, 200, 140]]},
    {name: 'acid',     branches: 9,  rough: 0.7, glow: 55, cool: 3, pal: [[2, 8, 4], [6, 30, 14], [22, 124, 60], [120, 255, 64], [232, 255, 120], [246, 255, 236]], refl: [[120, 255, 140], [190, 255, 190]]},
    {name: 'frost',    branches: 9,  rough: 0.6, glow: 40, cool: 8, pal: [[4, 6, 10], [20, 26, 36], [92, 112, 142], [202, 226, 255], [236, 244, 255], [255, 255, 255]], refl: [[200, 220, 255], [230, 240, 255]]},
    {name: 'orchid',   branches: 7,  rough: 1.6, glow: 85, cool: 4, pal: [[8, 2, 14], [34, 8, 48], [255, 40, 140], [214, 90, 255], [255, 170, 230], [255, 240, 250]], refl: [[240, 140, 255], [255, 190, 250]]}
  ];
  var PAL_TAU = 0.25, SHAPE_TAU = 0.45;
  var LIM = {look: [0, LOOKS.length - 1], branches: [6, 11], rough: [0.4, 2], glow: [0, 100], cool: [1, 12], hue: [0, 360]};

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function wrapA(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function unlin(c) { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055; return Math.round(clamp(c, 0, 1) * 255); }
  function toOk(c) {
    var r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromOk(o) {
    var l = o[0] + 0.3963377774 * o[1] + 0.2158037573 * o[2], m = o[0] - 0.1055613458 * o[1] - 0.0638541728 * o[2], s = o[0] - 0.0894841775 * o[1] - 1.291485548 * o[2];
    l = l * l * l; m = m * m * m; s = s * s * s;
    return [unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  function mixOk(a, b, t) { var A = toOk(a), B = toOk(b); return fromOk([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
  function css(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : Math.round(clamp(a, 0, 1) * 1000) / 1000) + ')'; }
  function rngOf(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r); g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r); g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r); g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r); g.closePath(); }

  // midpoint displacement (the Go jaggedPath): perpendicular offset proportional to the sub-chord, `passes` doublings
  var JA = new Float64Array(2 * 140), JB = new Float64Array(2 * 140);
  function jag(x0, y0, x1, y1, passes, amp, rng) {
    var a = JA, b = JB, n = 2, t;
    a[0] = x0; a[1] = y0; a[2] = x1; a[3] = y1;
    for (var p = 0; p < passes; p++) {
      var m = 0;
      for (var i = 0; i < n - 1; i++) {
        var ax = a[2 * i], ay = a[2 * i + 1], bx = a[2 * i + 2], by = a[2 * i + 3], d = (rng() - 0.5) * amp;
        b[2 * m] = ax; b[2 * m + 1] = ay; m++;
        b[2 * m] = (ax + bx) * 0.5 - (by - ay) * d; b[2 * m + 1] = (ay + by) * 0.5 + (bx - ax) * d; m++;
      }
      b[2 * m] = a[2 * n - 2]; b[2 * m + 1] = a[2 * n - 1]; m++;
      t = a; a = b; b = t; n = m;
    }
    JOUT = a; return n;
  }
  var JOUT = JA;

  registerWallPlugin({id: 'lichtenberg', title: 'Lichtenberg', author: 'genart builder C', create: create});

  function create(canvas, kit) {
    var ctx = canvas.getContext('2d', {alpha: false});
    if (!ctx) throw new Error('Lichtenberg needs Canvas 2D');
    var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), dead = false;
    var settings = {look: 0, branches: 9, rough: 1, glow: 60, cool: 4, hue: 0}, hueFlow = refreshHue(0), hueShown = -1;
    // the look: these names shadow the module's original palette; cur = glow and cooling as eased; xf = the old frame's fade-out
    var LK = LOOKS[0], over = {branches: false, rough: false, glow: false, cool: false}, looks = 0, ready = false, xf = 1, xfc = null, rebakeMs = 0;
    var cur = {glow: LK.glow, cool: LK.cool};
    var ABYSS, SAPPHIRE, VIOLET, CYAN, GOLD, WHITE, REFL_A, REFL_B;
    function usePal(L) { var p = L.pal; ABYSS = p[0]; SAPPHIRE = p[1]; VIOLET = p[2]; CYAN = p[3]; GOLD = p[4]; WHITE = p[5]; REFL_A = L.refl[0]; REFL_B = L.refl[1]; }
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    usePal(LK);
    var dw = 1280, dh = 800, block = null, glowBuf = document.createElement('canvas'), gctx = glowBuf.getContext('2d');
    var traces = [], sparks = [], micro = [], contacts = [], time = 0, frames = 0, nextId = 1, seedCounter = (Math.random() * 1e9) | 0;
    var flash = {a: 0, x: 640, y: 400}, bodyCharge = 0, bodyOk = false, bodyCount = 0, peopleXY = [];
    var sdfGrid = new Float32Array(GW * GH).fill(999), edgeXY = new Float32Array(2 * 3000), edgeN = 0;
    var ambientT = 0.25, seekT = 0.9, microT = 0, pool = {core: [], glow: [], burn: []};
    var stats = {discharges: 0, bridges: 0, taps: 0, seeks: 0, ambient: 0, releases: 0, onBodyLast: 0, segsLast: 0, struckBody: 0, frameMs: 0, buildMs: 0, peakMs: 0};
    var sprites = {violet: sprite(VIOLET), gold: sprite(GOLD), cyan: sprite(CYAN), white: sprite(WHITE)};

    function sprite(c, s) {                                                         // s: repaint an existing sprite (a look change)
      if (!s) { s = document.createElement('canvas'); s.width = s.height = 64; }
      var g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.clearRect(0, 0, 64, 64);
      gr.addColorStop(0, css(c, 1)); gr.addColorStop(0.22, css(c, 0.5)); gr.addColorStop(0.55, css(c, 0.13)); gr.addColorStop(1, css(c, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return s;
    }
    function puff(g, spr, x, y, r, a) { if (!(a > 0.003) || !(r > 0)) return; g.globalAlpha = Math.min(1, a); g.drawImage(spr, x - r, y - r, 2 * r, 2 * r); }

    // --- offscreen layers: core (full res, crisp channels), glow (1/4 res, corona sheath), burn (1/2 res, the permanent trace)
    function layerSize(kind) { var d = kind === 'core' ? 1 : kind === 'glow' ? 4 : 2; return [Math.max(1, Math.round(dw / d)), Math.max(1, Math.round(dh / d))]; }
    function getLayer(kind) {
      var s = layerSize(kind), c = pool[kind].pop() || document.createElement('canvas');
      if (c.width !== s[0] || c.height !== s[1]) { c.width = s[0]; c.height = s[1]; }
      var g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, c.width, c.height);
      g.setTransform(c.width / W, 0, 0, c.height / H, 0, 0); g.lineCap = 'round'; g.lineJoin = 'round';
      return {c: c, g: g, kind: kind};
    }
    function putLayer(L) { if (L && pool[L.kind].length < 5) pool[L.kind].push(L.c); else if (L) { L.c.width = 1; L.c.height = 1; } }

    function bakeBlock() {
      block = block || document.createElement('canvas');
      block.width = dw; block.height = dh;
      var g = block.getContext('2d');
      g.setTransform(dw / W, 0, 0, dh / H, 0, 0);
      g.fillStyle = css(ABYSS); g.fillRect(0, 0, W, H);
      var x0 = MARGIN, y0 = MARGIN, x1 = W - MARGIN, y1 = H - MARGIN, i0 = x0 + BEVEL, j0 = y0 + BEVEL, i1 = x1 - BEVEL, j1 = y1 - BEVEL;
      g.save(); rr(g, x0, y0, x1 - x0, y1 - y0, RAD); g.clip();
      function facet(p, c) { g.fillStyle = css(c); g.beginPath(); g.moveTo(p[0], p[1]); for (var i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.closePath(); g.fill(); }
      facet([x0, y0, x1, y0, i1, j0, i0, j0], mixOk(SAPPHIRE, CYAN, 0.15));      // light from the top-left, as the Go bevel (-0.65, -0.75)
      facet([x0, y0, i0, j0, i0, j1, x0, y1], mixOk(SAPPHIRE, CYAN, 0.08));
      facet([x1, y0, x1, y1, i1, j1, i1, j0], mixOk(ABYSS, SAPPHIRE, 0.55));
      facet([x0, y1, i0, j1, i1, j1, x1, y1], mixOk(ABYSS, SAPPHIRE, 0.2));
      var fg = g.createRadialGradient(600, 340, 30, 640, 400, 760);
      fg.addColorStop(0, css(mixOk(SAPPHIRE, ABYSS, 0.08))); fg.addColorStop(1, css(mixOk(SAPPHIRE, ABYSS, 0.62)));
      g.fillStyle = fg; rr(g, i0, j0, i1 - i0, j1 - j0, 8); g.fill();
      var sg = g.createLinearGradient(260, 0, 760, 800);                       // one faint diagonal reflection in the acrylic
      sg.addColorStop(0, css(REFL_A, 0)); sg.addColorStop(0.42, css(REFL_A, 0.022)); sg.addColorStop(0.5, css(REFL_B, 0.04));
      sg.addColorStop(0.58, css(REFL_A, 0.022)); sg.addColorStop(1, css(REFL_A, 0));
      g.fillStyle = sg; g.fillRect(i0, j0, i1 - i0, j1 - j0);
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;                     // facet creases
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(i0, j0); g.moveTo(x1, y0); g.lineTo(i1, j0); g.moveTo(x1, y1); g.lineTo(i1, j1); g.moveTo(x0, y1); g.lineTo(i0, j1); g.stroke();
      var hg = g.createLinearGradient(i0, j0, i1, j1);
      hg.addColorStop(0, css(CYAN, 0.6)); hg.addColorStop(0.45, css(CYAN, 0.14)); hg.addColorStop(1, css(CYAN, 0.03));
      g.strokeStyle = hg; g.lineWidth = 1.3; rr(g, i0, j0, i1 - i0, j1 - j0, 8); g.stroke();
      g.restore();
      g.strokeStyle = css(CYAN, 0.55); g.lineWidth = 1.8; rr(g, x0, y0, x1 - x0, y1 - y0, RAD); g.stroke();      // the Go's pinstripe border
      g.strokeStyle = css(CYAN, 0.12); g.lineWidth = 1; rr(g, x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12, RAD + 5); g.stroke();
    }

    // --- bodies: a screen-space sdf grid (px, + outside) and the outline cells, rebuilt only on a new depth frame
    function bodyGrids() {
      edgeN = 0; peopleXY = [];
      var c = kit.toScreen(256, 212), c2 = kit.toScreen(260, 212);
      bodyOk = !!(c && c2);
      if (!bodyOk || !body.fresh || !body.people.length) { sdfGrid.fill(999); return; }
      var ppc = Math.hypot((c2[0] - c[0]) * W, (c2[1] - c[1]) * H);
      if (!(ppc > 0.5 && ppc < 80)) ppc = 10;
      for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) {
        var k = kit.fromScreen((gx + 0.5) * GC / W, (gy + 0.5) * GC / H), v = 999;
        if (k && k[0] >= 0 && k[0] < 512 && k[1] >= 0 && k[1] < 424) { var ci = ((k[1] / 4) | 0) * 128 + ((k[0] / 4) | 0), s = body.sdf[ci]; if (s === s) v = s * ppc; }
        sdfGrid[gy * GW + gx] = v;
      }
      var m = body.mask, sd = body.sdf;
      for (var y = 0; y < 106; y++) for (var x = 0; x < 128; x++) {
        var i = y * 128 + x;
        if (m[i] > 0.5 && sd[i] >= -1.5 && edgeN < 3000) {
          var gx = (x < 127 ? m[i + 1] : m[i]) - (x > 0 ? m[i - 1] : m[i]), gy = (y < 105 ? m[i + 128] : m[i]) - (y > 0 ? m[i - 128] : m[i]), gl = Math.hypot(gx, gy) * 0.5, t = 0;
          if (gl > 0.02) t = clamp((0.5 - m[i]) / gl, -1, 0);                       // slide to the 0.5 iso-line of the soft mask
          var ox = gl > 0.02 ? gx / (2 * gl) * t : 0, oy = gl > 0.02 ? gy / (2 * gl) * t : 0;
          var p = kit.toScreen((x + 0.5 + ox) * 4, (y + 0.5 + oy) * 4);
          if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) { edgeXY[2 * edgeN] = p[0] * W; edgeXY[2 * edgeN + 1] = p[1] * H; edgeN++; }
        }
      }
      body.people.forEach(function (q) { var p = kit.toScreen(q.cx * 512, q.cy * 424); if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) peopleXY.push([p[0] * W, p[1] * H, q.id]); });
    }
    function sdfAt(x, y) {
      var fx = clamp(x / GC - 0.5, 0, GW - 1.001), fy = clamp(y / GC - 0.5, 0, GH - 1.001), ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, i = iy * GW + ix;
      var a = sdfGrid[i], b = sdfGrid[i + 1], c = sdfGrid[i + GW], d = sdfGrid[i + GW + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }

    // --- one discharge tree. o = {x, y, leaders: [[angle, len, depth0, main]], depth, steer, gate0, gate1, target, cap, v, wscale, spark}
    function buildTree(o) {
      var t0ms = performance.now(), rng = rngOf(o.seed || (seedCounter = (seedCounter * 1103515245 + 12345) >>> 0)), rough = want('rough');
      var depth = o.depth, maxD = Math.floor(depth), frac = depth - maxD, cap = Math.min(SEG_CAP, o.cap || SEG_CAP);
      var Q = 3 * cap + 16, qx = new Float32Array(Q), qy = new Float32Array(Q), qa = new Float32Array(Q), ql = new Float32Array(Q), qd = new Uint8Array(Q), qp = new Int32Array(Q), qs = new Float32Array(Q), qm = new Uint8Array(Q);
      var X0 = new Float32Array(cap), Y0 = new Float32Array(cap), X1 = new Float32Array(cap), Y1 = new Float32Array(cap), PAR = new Int32Array(cap), D0 = new Float32Array(cap), ONB = new Uint8Array(cap);
      var head = 0, tail = 0, n = 0, steer = !!(o.steer && bodyOk && bodyCount > 0), tg = o.target, tgStop = tg ? Math.hypot(tg[0] - o.x, tg[1] - o.y) * 0.5 : 0;
      function push(x, y, a, l, d, p, s, m) { if (tail >= Q) return; qx[tail] = x; qy[tail] = y; qa[tail] = a; ql[tail] = l; qd[tail] = d; qp[tail] = p; qs[tail] = s; qm[tail] = m; tail++; }
      o.leaders.forEach(function (L) { push(o.x, o.y, L[0], L[1], L[2], -1, 0, L[3] ? 1 : 0); });
      while (head < tail && n < cap) {
        var x = qx[head], y = qy[head], a = qa[head], len = ql[head], d = qd[head], par = qp[head], dist = qs[head], main = qm[head]; head++;
        if (d > maxD + 1 || (d === maxD + 1 && rng() >= frac) || len < 4.5) continue;
        var on = 0;
        if (steer) {                                                               // bodies are conductors: bend to the outline, then run along it
          var gate = o.gate1 > 0 ? smooth(o.gate0, o.gate1, dist) : 1;
          if (gate > 0.01) {
            var pr = Math.min(len, 50), px = x + Math.cos(a) * pr, py = y + Math.sin(a) * pr, sd = sdfAt(px, py);
            if (sd < 130) {
              var gx = sdfAt(px + 8, py) - sdfAt(px - 8, py), gy = sdfAt(px, py + 8) - sdfAt(px, py - 8), gl = Math.hypot(gx, gy);
              if (gl > 1e-3) {
                gx /= gl; gy /= gl;
                if (sd > 24) { a += wrapA(Math.atan2(-gy, -gx) - a) * gate * 0.5 * (1 - (sd - 24) / 106); }
                else {
                  var ta = Math.atan2(gx, -gy); if (Math.abs(wrapA(ta - a)) > Math.PI / 2) ta += Math.PI;
                  var w = clamp(sd / 26, -1.2, 1.2), dx = Math.cos(ta) - gx * w, dy = Math.sin(ta) - gy * w;
                  a += wrapA(Math.atan2(dy, dx) - a) * gate * 0.85; on = gate > 0.5 ? 1 : 0;
                }
              }
            }
          }
        }
        if (main && tg) {                                                          // a bridge: the main leader heads for the other hand
          var td = Math.hypot(tg[0] - x, tg[1] - y);
          if (td < tgStop) main = 0; else a += wrapA(Math.atan2(tg[1] - y, tg[0] - x) - a) * 0.45;
        }
        var ex = x + len * Math.cos(a), ey = y + len * Math.sin(a);
        if (ex < BX0 || ex > BX1 || ey < BY0 || ey > BY1) continue;              // stays inside the acrylic block (the Go's margin*1.3)
        X0[n] = x; Y0[n] = y; X1[n] = ex; Y1[n] = ey; PAR[n] = par; D0[n] = dist; ONB[n] = on;
        var me = n++, spread = (0.34 + 0.16 * rng()) * rough, la = on ? 0.94 : 0.76 + 0.08 * rng(), lb = 0.64 + 0.12 * rng(), sg = d % 2 === 1 ? -1 : 1;
        push(ex, ey, a - sg * spread * 0.42, len * la, d + 1, me, dist + len, main);
        push(ex, ey, a + sg * spread * 0.95, len * lb, d + 1, me, dist + len, 0);
        if (d >= 2 && d <= maxD - 2 && rng() < 0.48) push(ex, ey, a - sg * spread * 1.25, len * 0.52, d + 2, me, dist + len, 0);
      }
      var extra = o.arc ? 1 : 0, N = n + extra;
      // Strahler order, post-order over the BFS list (children always come after their parent)
      var ord = new Uint8Array(N), mx = new Uint8Array(N), mc = new Uint8Array(N), maxS = 1, i;
      for (i = n - 1; i >= 0; i--) {
        var oi = mx[i] === 0 ? 1 : (mc[i] >= 2 ? mx[i] + 1 : mx[i]); ord[i] = Math.min(15, oi); if (oi > maxS) maxS = oi;
        var p = PAR[i];
        if (p >= 0) { if (oi > mx[p]) { mx[p] = oi; mc[p] = 1; } else if (oi === mx[p]) mc[p]++; }
      }
      maxS = Math.min(15, maxS);
      // jagged channels, reveal times along the path (stepped leader), the arc last
      var off = new Int32Array(N), cnt = new Uint16Array(N), tA = new Float32Array(N), tB = new Float32Array(N), buf = [], maxDist = 1;
      for (i = 0; i < n; i++) maxDist = Math.max(maxDist, D0[i] + Math.hypot(X1[i] - X0[i], Y1[i] - Y0[i]));
      var v = Math.max(o.v || 900, maxDist / 0.6), total = 0;
      for (i = 0; i < n; i++) {
        var L = Math.hypot(X1[i] - X0[i], Y1[i] - Y0[i]), passes = L > 36 ? 3 : L > 14 ? 2 : 1, c = jag(X0[i], Y0[i], X1[i], Y1[i], passes, 0.28 * rough, rng);
        off[i] = total; cnt[i] = c; for (var k = 0; k < 2 * c; k++) buf.push(JOUT[k]); total += c;
        tA[i] = D0[i] / v * (0.94 + 0.12 * rng()); tB[i] = tA[i] + L / v;
      }
      var growEnd = 0; for (i = 0; i < n; i++) growEnd = Math.max(growEnd, tB[i]);
      if (extra) {
        var c2 = jag(o.x, o.y, o.arc[0], o.arc[1], 6, 0.2 * rough, rng);
        off[n] = total; cnt[n] = c2; for (var k2 = 0; k2 < 2 * c2; k2++) buf.push(JOUT[k2]); total += c2;
        PAR[n] = -1; ord[n] = maxS; tA[n] = growEnd; tB[n] = growEnd;
      }
      var rev = new Int32Array(N); for (i = 0; i < N; i++) rev[i] = i;
      var revA = Array.prototype.slice.call(rev).sort(function (a2, b2) { return tB[a2] - tB[b2]; }); for (i = 0; i < N; i++) rev[i] = revA[i];
      var onb = new Uint8Array(N), onN = 0; for (i = 0; i < n; i++) { onb[i] = ONB[i]; onN += ONB[i]; }
      var par2 = new Int32Array(N); for (i = 0; i < n; i++) par2[i] = PAR[i]; if (extra) par2[n] = -1;
      stats.buildMs = performance.now() - t0ms;
      return {id: nextId++, x: o.x, y: o.y, n: N, pts: new Float32Array(buf), off: off, cnt: cnt, par: par2, ord: ord, onb: onb, t0: tA, t1: tB, rev: rev,
              baked: 0, growEnd: growEnd, maxS: maxS, wscale: o.wscale || 1, styles: {}, age: 0, heat: 1, struck: false, strikeT: 0,
              core: null, glowL: null, burn: null, evict: 0, pulseAt: -1e9, breath: rng() * 6.283, onN: onN, spark: !!o.spark, arc: !!extra};
    }
    function styleOf(tr, b) {
      var st = tr.styles[b]; if (st) return st;
      var ordv = b & 15, onb = b >= 32, fn = tr.maxS > 1 ? (ordv - 1) / (tr.maxS - 1) : 1, k = tr.wscale, coreW = (0.55 + 6.2 * Math.pow(fn, 1.35)) * k;
      var mid = onb ? mixOk(CYAN, WHITE, 0.18) : mixOk(CYAN, GOLD, Math.pow(fn, 0.75));
      st = tr.styles[b] = {coreW: coreW, mid: css(mid, 0.55 + 0.4 * fn), white: fn < 0.2 && !onb ? null : css(WHITE, 0.3 + 0.55 * fn), corona: css(onb ? CYAN : mixOk(VIOLET, GOLD, 0.75 * Math.pow(fn, 1.5)), 0.17 + 0.17 * fn),
                           coronaW: coreW * 2.8 * 1.4, burn: css(mixOk(VIOLET, CYAN, onb ? 0.85 : 0.5), 0.2 + 0.5 * fn), burnW: Math.max(0.9, coreW * 0.55)};
      return st;
    }
    function addPoly(P, tr, s) { var o = tr.off[s] * 2, c = tr.cnt[s], p = tr.pts; P.moveTo(p[o], p[o + 1]); for (var k = 1; k < c; k++) P.lineTo(p[o + 2 * k], p[o + 2 * k + 1]); }
    function bake(tr, upTo, all) {
      var k = tr.baked, paths = null, P, b;
      while (k < tr.n && (all || tr.t1[tr.rev[k]] <= upTo)) {
        var s = tr.rev[k++]; b = tr.ord[s] + (tr.onb[s] ? 32 : 0);
        if (tr.onb[s]) { bodyCharge = 1; stats.struckBody++; }
        paths = paths || {}; P = paths[b] || (paths[b] = new Path2D()); addPoly(P, tr, s);
      }
      tr.baked = k;
      if (!paths) return;
      Object.keys(paths).forEach(function (key) {
        var st = styleOf(tr, +key), Q = paths[key], g;
        if (tr.glowL) { g = tr.glowL.g; g.strokeStyle = st.corona; g.lineWidth = st.coronaW; g.stroke(Q); }
        if (tr.core) { g = tr.core.g; g.strokeStyle = st.mid; g.lineWidth = st.coreW * 1.35; g.stroke(Q); if (st.white) { g.strokeStyle = st.white; g.lineWidth = st.coreW * 0.34; g.stroke(Q); } }
        if (tr.burn) { g = tr.burn.g; g.strokeStyle = st.burn; g.lineWidth = st.burnW; g.stroke(Q); }
      });
    }
    function rootMark(tr) {                                                         // the Go's cathode impact flash, baked at the root
      if (tr.glowL) { puff(tr.glowL.g, sprites.gold, tr.x, tr.y, 46, 0.8); tr.glowL.g.globalAlpha = 1; }
      if (tr.core) { puff(tr.core.g, sprites.white, tr.x, tr.y, 13, 0.95); tr.core.g.globalAlpha = 1; }
      if (tr.burn) { puff(tr.burn.g, sprites.cyan, tr.x, tr.y, 9, 0.6); tr.burn.g.globalAlpha = 1; }
    }
    function adopt(tr, cold) {
      if (tr.spark) { sparks.push(tr); if (sparks.length > 14) sparks.shift(); return tr; }
      tr.burn = getLayer('burn');
      if (cold) { tr.heat = 0; tr.struck = true; tr.age = tr.growEnd + 99; bake(tr, 0, true); rootMark(tr); }
      else { tr.core = getLayer('core'); tr.glowL = getLayer('glow'); }
      traces.push(tr);
      var live = traces.filter(function (t) { return !t.evict; });
      while (live.length > MAX_TRACES) { live[0].evict = 1e-4; live.shift(); }
      stats.segsLast = tr.n; stats.onBodyLast = tr.onN;
      return tr;
    }
    function leadersAt(x, y, aim, L0, spreadAll) {
      var out = [[aim, L0, 1, 1], [aim - 0.62 - 0.3 * Math.random(), L0 * 0.68, 2, 0], [aim + 0.62 + 0.3 * Math.random(), L0 * 0.68, 2, 0]];
      if (spreadAll) out.push([aim + Math.PI + (Math.random() - 0.5) * 0.8, L0 * 0.5, 2, 0]);
      return out;
    }
    function aimFrom(x, y) {                                                        // toward the larger stretch of empty block
      var a = Math.atan2(400 - y, 640 - x), far = Math.hypot(640 - x, 400 - y) < 160;
      return far ? Math.random() * 6.283 : a + (Math.random() - 0.5) * 1.0;
    }
    function discharge(x, y, charge, target, arcTo) {
      var c = clamp(charge, 0.25, 1), L0 = 150 * (0.55 + 0.45 * c), aim = target ? Math.atan2(target[1] - y, target[0] - x) : aimFrom(x, y);
      var tr = buildTree({x: x, y: y, leaders: leadersAt(x, y, aim, L0, !target), depth: clamp(want('branches') - (1 - c) * 2.5, 4, 11),
                          steer: true, gate0: 110, gate1: 210, target: target, arc: arcTo, v: 900});
      stats.discharges++;
      return adopt(tr, false);
    }
    function sparkBurst(x, y) {
      var n = 3 + (Math.random() < 0.5 ? 1 : 0), lead = [];
      for (var i = 0; i < n; i++) lead.push([Math.random() * 6.283, 34 + Math.random() * 30, 2, 0]);
      adopt(buildTree({x: x, y: y, leaders: lead, depth: 4.5, cap: 60, v: 1300, wscale: 0.55, spark: true}), false);
      stats.taps++;
      traces.forEach(function (t) { if (!t.evict) { t.pulseAt = time + Math.hypot(t.x - x, t.y - y) / 1400; for (var j = 0; j < 2; j++) spawnMicro(t, time + Math.hypot(t.x - x, t.y - y) / 1400); } });
      flash.a = Math.max(flash.a, 0.22); flash.x = x; flash.y = y;
    }
    function ambient() {                                                            // nobody here: the cathode at the foot of the block fires now and then
      var side = Math.random(), x, y, a;
      if (side < 0.55) { x = 380 + Math.random() * 520; y = BY1 - 3; a = -Math.PI / 2 + (Math.random() - 0.5) * 0.3; }
      else if (side < 0.78) { x = BX0 + 3; y = 220 + Math.random() * 360; a = (Math.random() - 0.5) * 0.6; }
      else { x = BX1 - 3; y = 220 + Math.random() * 360; a = Math.PI + (Math.random() - 0.5) * 0.6; }
      adopt(buildTree({x: x, y: y, leaders: [[a, 150, 1, 1], [a - 0.52, 102, 2, 0], [a + 0.52, 102, 2, 0]], depth: want('branches'), steer: false, v: 900}), false);
      stats.ambient++;
    }
    function seek() {                                                               // a person standing near old traces gets struck
      if (!peopleXY.length) return;
      var who = peopleXY[(Math.random() * peopleXY.length) | 0], best = null, bd = 1e9;
      traces.forEach(function (t) {
        if (t.evict) return;
        for (var k = 0; k < t.pts.length; k += 14) { var px = t.pts[k], py = t.pts[k + 1], dd = Math.hypot(px - who[0], py - who[1]); if (dd < bd && dd > 140 && sdfAt(px, py) > 70) { bd = dd; best = [px, py]; } }
      });
      if (!best || bd > 700) {                                                      // no trace near: from the nearest block edge
        var cands = [[who[0], BY1 - 3], [BX0 + 3, who[1]], [BX1 - 3, who[1]], [who[0], BY0 + 3]];
        cands.sort(function (p, q) { return (sdfAt(q[0], q[1]) > 60) - (sdfAt(p[0], p[1]) > 60) || Math.hypot(p[0] - who[0], p[1] - who[1]) - Math.hypot(q[0] - who[0], q[1] - who[1]); });
        best = cands[0];
      }
      var aim = Math.atan2(who[1] - best[1], who[0] - best[0]);
      adopt(buildTree({x: best[0], y: best[1], leaders: leadersAt(best[0], best[1], aim, 125, false), depth: clamp(want('branches') - 1, 5, 10), steer: true, gate0: 0, gate1: 0, v: 900}), false);
      stats.seeks++;
    }
    function spawnMicro(t, at) {
      if (micro.length >= 18 || !t || !t.n) return;
      var s = (Math.random() * t.n) | 0;
      for (var tries = 0; tries < 6 && t.ord[s] !== 1; tries++) s = (Math.random() * t.n) | 0;
      micro.push({t: t, s: s, k: t.cnt[s] - 2, acc: 0, at: at || time, life: 0, tr: new Float32Array(16), tn: 0, sp: 0.5 + Math.random() * 0.5});
    }

    // --- hands
    function track(dt) {
      var pts = input.read(), i, j;
      for (i = 0; i < contacts.length; i++) contacts[i].hit = false;
      for (j = 0; j < pts.length; j++) {
        var px = pts[j][0] * W, py = pts[j][1] * H, best = null, bd = 90;
        for (i = 0; i < contacts.length; i++) { var c = contacts[i], d = Math.hypot(c.x - px, c.y - py); if (!c.hit && d < bd) { bd = d; best = c; } }
        if (best) { var k = 1 - Math.exp(-dt * 22); best.x += (px - best.x) * k; best.y += (py - best.y) * k; best.hit = true; }
        else if (contacts.length < 8) { var nc = {id: nextId++, x: px, y: py, ax: px, ay: py, age: 0, charge: 0, ref: 0, hit: true, fired: 0}; contacts.push(nc); sparkBurst(px, py); }
      }
      for (i = contacts.length - 1; i >= 0; i--) {
        var q = contacts[i];
        if (!q.hit) {                                                               // release: a charged corona discharges
          contacts.splice(i, 1);
          if (q.charge >= 0.25 && input.state !== 'stale') { discharge(q.x, q.y, q.charge, null, null); stats.releases++; }
          continue;
        }
        q.age += dt;
        if (Math.hypot(q.x - q.ax, q.y - q.ay) > 24) { q.ax = q.x; q.ay = q.y; q.charge = 0; }
        if (q.ref > 0) q.ref -= dt;
        else if (input.state !== 'recovering' && (!kit.fingers || Date.now() - kit.fingers.t <= 80)) q.charge = Math.min(1, q.charge + dt / CHARGE_S);
      }
      for (i = 0; i < contacts.length; i++) {
        var a = contacts[i];
        if (a.charge < 1) continue;
        var partner = null, pd = 1e9;
        for (j = 0; j < contacts.length; j++) { var b = contacts[j]; if (b === a || b.charge < 0.4) continue; var dd = Math.hypot(b.x - a.x, b.y - a.y); if (dd > 120 && dd < pd) { pd = dd; partner = b; } }
        if (partner) {                                                              // two charged hands: grow toward each other, bridge with an arc
          discharge(a.x, a.y, 1, [partner.x, partner.y], [partner.x, partner.y]);
          discharge(partner.x, partner.y, Math.max(0.6, partner.charge), [a.x, a.y], null);
          partner.charge = 0; partner.ref = REFIRE_S; partner.fired++; stats.bridges++;
        } else discharge(a.x, a.y, 1, null, null);
        a.charge = 0; a.ref = REFIRE_S; a.fired++;
      }
    }

    // --- frame
    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      hueFlow.step(settings.hue, dt);
      var hv = Math.round(hueFlow.value * 10) / 10;
      if (hv !== hueShown) { hueShown = hv; canvas.style.filter = hv > 0.05 && hv < 359.95 ? 'hue-rotate(' + hv + 'deg)' : ''; }
      stepLook(dt);
      if (body.update(dt, now) || (!body.fresh && edgeN)) bodyGrids();
      bodyCount = body.fresh && bodyOk ? body.people.length : 0;
      track(dt);
      if (!contacts.length && !bodyCount) { ambientT -= dt; if (ambientT <= 0) { ambient(); ambientT = 7 + Math.random() * 4; } } else ambientT = Math.max(ambientT, 4);
      if (bodyCount && !contacts.length) { seekT -= dt; if (seekT <= 0) { seek(); seekT = 2.2 + Math.random() * 1.4; } } else if (!bodyCount) seekT = 0.9;
      microT -= dt;
      if (microT <= 0) { microT = 0.22 + Math.random() * 0.2; var cold = traces.filter(function (t) { return !t.evict && t.heat < 0.5; }); if (cold.length) spawnMicro(cold[(Math.random() * cold.length) | 0]); }
      bodyCharge *= Math.exp(-dt / 1.4); flash.a *= Math.exp(-dt / 0.2);
      var cool = cur.cool, i;
      for (i = traces.length - 1; i >= 0; i--) {
        var tr = traces[i];
        tr.age += dt;
        if (!tr.struck) {
          bake(tr, tr.age, false);
          if (tr.age >= tr.growEnd) { bake(tr, 0, true); tr.struck = true; rootMark(tr); flash.a = Math.max(flash.a, tr.arc ? 0.9 : 0.6); flash.x = tr.x; flash.y = tr.y; }
        } else { tr.strikeT += dt; tr.heat = Math.max(0, tr.heat - dt / cool); }
        if (tr.heat <= 0 && tr.core) { putLayer(tr.core); putLayer(tr.glowL); tr.core = tr.glowL = null; }
        if (tr.evict) { tr.evict += dt / 1.6; if (tr.evict >= 1) { putLayer(tr.core); putLayer(tr.glowL); putLayer(tr.burn); traces.splice(i, 1); } }
      }
      for (i = sparks.length - 1; i >= 0; i--) { var sp = sparks[i]; sp.age += dt; if (sp.age > sp.growEnd) sp.heat -= dt / 0.55; if (sp.heat <= 0) sparks.splice(i, 1); }
      stepMicro(dt);
      render();
      stats.frameMs = performance.now() - t0; if (stats.frameMs > stats.peakMs) stats.peakMs = stats.frameMs;
    }
    function stepMicro(dt) {
      for (var i = micro.length - 1; i >= 0; i--) {
        var m = micro[i];
        if (time < m.at) continue;
        m.life += dt;
        if (m.t.evict >= 1 || m.life > 2.2) { micro.splice(i, 1); continue; }
        m.acc += dt * 60 * m.sp;
        while (m.acc >= 1) {
          m.acc -= 1; m.k--;
          if (m.k < 0) { var p = m.t.par[m.s]; if (p < 0) { m.k = -99; break; } m.s = p; m.k = m.t.cnt[p] - 2; }
        }
        if (m.k === -99 || m.k < 0) { micro.splice(i, 1); continue; }
        var o = (m.t.off[m.s] + m.k) * 2, q = o + 2, pts = m.t.pts, f = 1 - m.acc;
        var x = pts[q] + (pts[o] - pts[q]) * (1 - f), y = pts[q + 1] + (pts[o + 1] - pts[q + 1]) * (1 - f);
        if (m.tn < 8) m.tn++; else m.tr.copyWithin(0, 2, 16);
        m.tr[2 * (m.tn - 1)] = x; m.tr[2 * (m.tn - 1) + 1] = y;
      }
    }

    function render() {
      var glowK = cur.glow / 60, i, tr, a;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(block, 0, 0, dw, dh);
      // glow buffer (1/4 res): tree sheaths, coronas, flash, leader heads, the body outline
      gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalCompositeOperation = 'source-over'; gctx.globalAlpha = 1; gctx.clearRect(0, 0, glowBuf.width, glowBuf.height);
      gctx.globalCompositeOperation = 'lighter';
      gctx.setTransform(glowBuf.width / W, 0, 0, glowBuf.height / H, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < traces.length; i++) {                                         // permanent burns: faint, breathing, flaring on a tap
        tr = traces[i];
        var pulse = time >= tr.pulseAt ? Math.exp(-(time - tr.pulseAt) / 0.45) : 0, fade = tr.evict ? 1 - clamp(tr.evict, 0, 1) : 1;
        a = (0.36 + 0.06 * Math.sin(time * 0.7 + tr.breath) + 0.9 * pulse) * fade * Math.min(1, tr.age * 3);
        if (tr.burn && a > 0.003) { ctx.globalAlpha = Math.min(1, a); ctx.drawImage(tr.burn.c, 0, 0, dw, dh); }
        if (tr.burn && pulse > 0.02) { gctx.globalAlpha = Math.min(1, pulse * 0.8 * glowK); gctx.drawImage(tr.burn.c, 0, 0, W, H); }
      }
      for (i = 0; i < traces.length; i++) {                                         // hot channels: leader dim, return stroke bright, then cooling
        tr = traces[i];
        if (!tr.core) continue;
        var fade2 = tr.evict ? 1 - clamp(tr.evict, 0, 1) : 1, ca, ga;
        if (!tr.struck) { ca = 0.55; ga = 0.45; }
        else {
          var st = tr.strikeT, re = 1 + 0.5 * Math.exp(-st / 0.07) + (st > 0.09 && st < 0.13 ? 0.35 : 0) + (st > 0.21 && st < 0.25 ? 0.25 : 0);
          ca = Math.pow(tr.heat, 1.5) * re; ga = tr.heat * (0.7 + 0.3 * re);
        }
        ca *= fade2; ga *= fade2 * glowK;
        if (ca > 0.003) { ctx.globalAlpha = Math.min(1, ca); ctx.drawImage(tr.core.c, 0, 0, dw, dh); if (ca > 1) { ctx.globalAlpha = Math.min(1, ca - 1); ctx.drawImage(tr.core.c, 0, 0, dw, dh); } }
        if (ga > 0.003) { gctx.globalAlpha = Math.min(1, ga); gctx.drawImage(tr.glowL.c, 0, 0, W, H); if (ga > 1) { gctx.globalAlpha = Math.min(1, ga - 1); gctx.drawImage(tr.glowL.c, 0, 0, W, H); } }
      }
      ctx.setTransform(dw / W, 0, 0, dh / H, 0, 0); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // growing leader tips (partial segments) drawn live
      ctx.beginPath(); var heads = 0;
      for (i = 0; i < traces.length; i++) {
        tr = traces[i];
        if (tr.struck) continue;
        for (var k = tr.baked; k < tr.n; k++) {
          var s = tr.rev[k];
          if (tr.t1[s] > tr.age + 0.3) break;
          if (tr.t0[s] > tr.age) continue;
          var f = clamp((tr.age - tr.t0[s]) / Math.max(1e-4, tr.t1[s] - tr.t0[s]), 0, 1), c = tr.cnt[s], o = tr.off[s] * 2, pf = f * (c - 1), pi = Math.floor(pf), P = tr.pts;
          ctx.moveTo(P[o], P[o + 1]);
          for (var q = 1; q <= pi; q++) ctx.lineTo(P[o + 2 * q], P[o + 2 * q + 1]);
          var hx = P[o + 2 * pi], hy = P[o + 2 * pi + 1];
          if (pi < c - 1) { var fr = pf - pi; hx += (P[o + 2 * pi + 2] - hx) * fr; hy += (P[o + 2 * pi + 3] - hy) * fr; ctx.lineTo(hx, hy); }
          if (heads < 60 && tr.ord[s] > 1) { puff(gctx, sprites.white, hx, hy, 10 + 3 * tr.ord[s], 0.5 * glowK); heads++; }
        }
      }
      ctx.globalAlpha = 0.85; ctx.strokeStyle = css(GOLD, 0.8); ctx.lineWidth = 2.2; ctx.stroke(); ctx.strokeStyle = css(WHITE, 1); ctx.lineWidth = 0.9; ctx.stroke();
      // tap sparks, live
      for (i = 0; i < sparks.length; i++) {
        var sp = sparks[i], ha = clamp(sp.heat, 0, 1);
        if (ha <= 0.01) continue;
        ctx.beginPath();
        for (var k2 = 0; k2 < sp.n; k2++) { var s2 = sp.rev[k2]; if (sp.t1[s2] > sp.age) break; addPoly(ctx, sp, s2); }
        ctx.globalAlpha = ha; ctx.strokeStyle = css(mixOk(CYAN, GOLD, 0.4), 0.85); ctx.lineWidth = 1.7; ctx.stroke(); ctx.strokeStyle = css(WHITE, 0.95); ctx.lineWidth = 0.7; ctx.stroke();
        puff(gctx, sprites.cyan, sp.x, sp.y, 40, 0.5 * ha * glowK);
      }
      // coronas under charging fingers: a violet hum that grows, flickering micro-twigs, a hot electrode
      for (i = 0; i < contacts.length; i++) {
        var cn = contacts[i], ch = cn.charge, fl = 0.8 + 0.2 * Math.random();
        puff(gctx, sprites.violet, cn.x, cn.y, 30 + 95 * ch, (0.35 + 0.6 * ch) * fl * glowK);
        puff(gctx, sprites.gold, cn.x, cn.y, 12 + 16 * ch, (0.3 + 0.5 * ch) * fl * glowK);
        ctx.beginPath();
        var tw = 2 + Math.floor(5 * ch);
        for (var j = 0; j < tw; j++) {
          var ang = Math.random() * 6.283, ln = (10 + 46 * ch) * (0.4 + 0.6 * Math.random()), m2 = jag(cn.x, cn.y, cn.x + Math.cos(ang) * ln, cn.y + Math.sin(ang) * ln, 2, 0.5, Math.random);
          ctx.moveTo(JOUT[0], JOUT[1]); for (var z = 1; z < m2; z++) ctx.lineTo(JOUT[2 * z], JOUT[2 * z + 1]);
        }
        ctx.globalAlpha = 0.35 + 0.6 * ch; ctx.strokeStyle = css(mixOk(VIOLET, WHITE, 0.55)); ctx.lineWidth = 0.9; ctx.stroke();
        ctx.globalAlpha = 0.9; ctx.fillStyle = css(WHITE); ctx.beginPath(); ctx.arc(cn.x, cn.y, 2.2 + 2 * ch, 0, 6.283); ctx.fill();
      }
      // micro-sparks crawling home along old traces
      ctx.beginPath();
      for (i = 0; i < micro.length; i++) {
        var mm = micro[i];
        if (mm.tn < 2) continue;
        ctx.moveTo(mm.tr[0], mm.tr[1]); for (var u = 1; u < mm.tn; u++) ctx.lineTo(mm.tr[2 * u], mm.tr[2 * u + 1]);
        puff(gctx, sprites.cyan, mm.tr[2 * mm.tn - 2], mm.tr[2 * mm.tn - 1], 16, 0.55 * glowK);
      }
      ctx.globalAlpha = 0.8; ctx.strokeStyle = css(mixOk(CYAN, WHITE, 0.5)); ctx.lineWidth = 1.2; ctx.stroke();
      // bodies: a faint conductor outline always, bright cyan when struck
      if (edgeN && body.fresh) {
        gctx.beginPath();
        for (i = 0; i < edgeN; i++) { var ex = edgeXY[2 * i], ey = edgeXY[2 * i + 1]; gctx.moveTo(ex + 6.5, ey); gctx.arc(ex, ey, 6.5, 0, 6.283); }
        gctx.globalAlpha = Math.min(1, (0.09 + 0.4 * bodyCharge) * Math.max(0.5, glowK)); gctx.fillStyle = css(CYAN); gctx.fill();
        if (bodyCharge > 0.03) {                                                    // struck: the outline glitters
          ctx.beginPath();
          for (i = 0; i < edgeN; i += 2) { var fx = edgeXY[2 * i], fy = edgeXY[2 * i + 1]; ctx.rect(fx - 0.7, fy - 0.7, 1.4, 1.4); }
          ctx.globalAlpha = 0.55 * bodyCharge; ctx.fillStyle = css(mixOk(CYAN, WHITE, 0.4)); ctx.fill();
        }
      }
      if (flash.a > 0.01) {                                                         // the return stroke lights the whole block
        puff(gctx, sprites.violet, flash.x, flash.y, 900, flash.a * 0.55 * Math.max(0.4, glowK));
        puff(gctx, sprites.white, flash.x, flash.y, 120, flash.a * 0.5 * glowK);
      }
      gctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      ctx.drawImage(glowBuf, 0, 0, dw, dh);
      ctx.globalCompositeOperation = 'source-over';
      if (xf < 1 && xfc) { ctx.globalAlpha = 1 - xf; ctx.drawImage(xfc, 0, 0, dw, dh); ctx.globalAlpha = 1; }   // a look change: the old frame fades out
    }

    // --- looks: the palette is baked (block, sprites, every trace layer), so a change re-bakes everything under a fading snapshot
    function rebakeTraces() {
      var bc = bodyCharge, sb = stats.struckBody;
      traces.forEach(function (t) {
        putLayer(t.burn); t.burn = getLayer('burn');
        if (t.core) { putLayer(t.core); putLayer(t.glowL); t.core = getLayer('core'); t.glowL = getLayer('glow'); }
        t.styles = {};
        var was = t.baked; t.baked = 0; if (was) { bake(t, 0, false); while (t.baked < was) { var s = t.rev[t.baked]; bake(t, t.t1[s], false); } }
        if (t.struck) rootMark(t);
      });
      bodyCharge = bc; stats.struckBody = sb;
    }
    function recolour() {
      var t0 = performance.now();
      usePal(LK); bakeBlock();
      sprite(VIOLET, sprites.violet); sprite(GOLD, sprites.gold); sprite(CYAN, sprites.cyan); sprite(WHITE, sprites.white);
      rebakeTraces(); sparks.forEach(function (s) { s.styles = {}; });
      rebakeMs = performance.now() - t0;
    }
    function applyLook(i) {
      LK = LOOKS[i]; over.branches = over.rough = over.glow = over.cool = false; looks++;
      if (!ready) return;                                                           // create(): snapLook() does the rest without a fade
      if (!xfc) xfc = document.createElement('canvas');
      if (xfc.width !== canvas.width || xfc.height !== canvas.height) { xfc.width = canvas.width; xfc.height = canvas.height; }
      var g = xfc.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'copy'; g.drawImage(canvas, 0, 0);
      g.globalCompositeOperation = 'source-over';
      xf = 0; recolour();
      if (!contacts.length && !bodyCount) ambientT = Math.min(ambientT, 0.9);          // idle: a discharge in the new look follows shortly
    }
    function stepLook(dt) {
      var ks = 1 - Math.exp(-dt / SHAPE_TAU);
      cur.glow += (want('glow') - cur.glow) * ks; cur.cool += (want('cool') - cur.cool) * ks;
      if (xf < 1) { xf += (1 - xf) * (1 - Math.exp(-dt / PAL_TAU)); if (xf > 0.996) xf = 1; }
    }

    function resize(w, h) {
      if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
      dw = w; dh = h;
      glowBuf.width = Math.max(1, Math.round(w / 4)); glowBuf.height = Math.max(1, Math.round(h / 4));
      pool = {core: [], glow: [], burn: []};
      xf = 1;                                                                       // a resize drops any look fade (the snapshot is the old size)
      bakeBlock();
      traces.forEach(function (t) {                                                 // re-bake every trace at the new size
        t.burn = getLayer('burn'); if (t.core) { t.core = getLayer('core'); t.glowL = getLayer('glow'); }
        var was = t.baked; t.baked = 0; if (was) { var bc = bodyCharge; bake(t, 0, false); while (t.baked < was) { var s = t.rev[t.baked]; bake(t, t.t1[s], false); } bodyCharge = bc; }
        if (t.struck) rootMark(t);
      });
    }
    function set(o) {
      if (o && typeof o === 'object') {
        var lk = o.look;                                                            // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['branches', 'rough', 'glow', 'cool'].forEach(function (k) {                // a knob that MOVED overrides the look's value until the next look
          var v = o[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
          v = clamp(v, LIM[k][0], LIM[k][1]); if (v !== settings[k]) { settings[k] = v; over[k] = true; }
        });
        var hv = o.hue; if (typeof hv === 'number' && Number.isFinite(hv)) settings.hue = clamp(hv, LIM.hue[0], LIM.hue[1]);
      }
      return Object.assign({}, settings);
    }
    function destroy() {
      if (dead) return;
      dead = true; kit.wantDepth(false); input.clear();
      traces.forEach(function (t) { putLayer(t.core); putLayer(t.glowL); putLayer(t.burn); });
      traces = []; sparks = []; micro = []; contacts = [];
      ['core', 'glow', 'burn'].forEach(function (k) { pool[k].forEach(function (c) { c.width = 1; c.height = 1; }); pool[k] = []; });
      if (block) { block.width = 1; block.height = 1; }
      if (xfc) { xfc.width = 1; xfc.height = 1; }
      glowBuf.width = 1; glowBuf.height = 1;
      try { canvas.style.filter = ''; } catch (e) {}
      if (window.LichtenbergSet === set) delete window.LichtenbergSet;
    }

    kit.wantDepth(true);
    resize(canvas.width, canvas.height);
    if (!block) { dw = 1280; dh = 800; glowBuf.width = 320; glowBuf.height = 200; bakeBlock(); }
    window.LichtenbergSet = set;
    if (window._lichtenbergFx) set(window._lichtenbergFx);
    (function snapLook() {                                                          // start on the stored look and knobs without easing in
      LK = LOOKS[settings.look]; cur.glow = want('glow'); cur.cool = want('cool');
      if (LK !== LOOKS[0]) { usePal(LK); bakeBlock(); sprite(VIOLET, sprites.violet); sprite(GOLD, sprites.gold); sprite(CYAN, sprites.cyan); sprite(WHITE, sprites.white); }
      ready = true;
    })();
    hueFlow.snap(settings.hue);
    // the block is never empty: two old burns already in the acrylic, and the cathode fires a moment after the piece starts
    adopt(buildTree({x: BX0 + 3, y: 250, leaders: [[0.28, 150, 1, 1], [-0.25, 100, 2, 0], [0.8, 100, 2, 0]], depth: clamp(want('branches') - 0.5, 6, 11), seed: 9101}), true);
    adopt(buildTree({x: BX1 - 3, y: 540, leaders: [[Math.PI + 0.25, 150, 1, 1], [Math.PI - 0.3, 100, 2, 0], [Math.PI + 0.8, 100, 2, 0]], depth: clamp(want('branches') - 0.5, 6, 11), seed: 202623}), true);
    var out = {frame: frame, touch: function (t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      return {frames: frames, contacts: contacts.map(function (c) { return {x: Math.round(c.x), y: Math.round(c.y), charge: Math.round(c.charge * 100) / 100, fired: c.fired}; }),
              traces: traces.length, hot: traces.filter(function (t) { return t.heat > 0; }).length, sparks: sparks.length, micro: micro.length,
              bodyCount: bodyCount, bodyOk: bodyOk, edgeN: edgeN, bodyCharge: Math.round(bodyCharge * 100) / 100, stats: (function () { var o = Object.assign({}, stats); stats.peakMs = 0; return o; })(),
              look: LK.name, looks: looks, overrides: Object.assign({}, over), fade: xf, rebakeMs: rebakeMs, eased: {glow: cur.glow, cool: cur.cool},
              displayHue: hueFlow.value, filter: canvas.style.filter, settings: set(), destroyed: dead};
    };
    return out;
  }
})();
