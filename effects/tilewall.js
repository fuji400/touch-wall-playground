/* Tiles (tilewall) -- p5-experiments build-out 2026-10-22 (batch 2), Builder I.
 * After "tiles" by Maksim Vasilyev, p5-experiments (https://github.com/vasilyev-maksim/p5-experiments), CC BY-NC 4.0; studio use, non-commercial.
 * The wall is tiled by random rectangles exactly the way the sketch's Tiler + OccupancyGrid do it (a random free start cell, then the
 * largest free rectangle that passes the evaluator: area under the look's max, aspect <= 2, <= 1.5 above 16 cells), drawn flat in the
 * sketch's own looks (tiles, wes, anderson, bricks, frames, frames 2, mosaic, epicenter, heat, coals, forest fire): solid, hollow or
 * zebra fills, the look's two colours (or four) on black. The sketch's radial animation runs as rings from an epicentre: each tile
 * shrinks a little, rounds its corners and thickens its stripes as a ring passes. Our own code, no p5.
 * Live: the epicentre is your hand (two hands = two epicentres whose rings interfere); a tap re-tiles the whole wall with a new seed in
 * a wave running out from the finger; a still hand (~0.8 s) merges the tiles under it into one large tile (the occupancy grid re-packs
 * locally) that splits again after you let go; a body splits the tiles behind it into a fine mosaic. Idle: the rings run from a slowly
 * wandering epicentre (or from the nearest person), and the wall re-tiles itself in a slow wave about every 45 s.
 * WebGL2, one full-screen pass: each pixel finds its cell, the cell's tile (id texture) and the tile's rectangle and colour (data
 * texture), then draws the rounded rectangle by distance. Two tilings (old and new) cross over at a wave front, so a re-tile never jumps.
 * No audio, no network, no assets. ASCII only.
 */
(function () {
  'use strict';
  registerWallPlugin({id: 'tilewall', title: 'Tiles', author: 'Claude Opus 5.5 (p5 builder I)', create: create});

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
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mulberry(seed) { var s = seed >>> 0; return function () { s = (s + 0x6d2b79f5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hex(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

  var WH = 0.86;                                   // the sketch's white, toned down a little for the projector (no large flat white)
  var PAL = [[[WH, WH, WH], hex('#ff0000')], [hex('#434343'), hex('#ff0000')], [hex('#9f5cfe'), hex('#17ffef')],
             [[WH, WH, WH], hex('#ff0000'), hex('#008080'), hex('#800080')]];
  // the sketch's presets: colour set (+ invert), fill (0 solid, 1 hollow, 2 zebra), stripe and border size (0..100 = 0..1 cell),
  // corner radius (cells), max tile area (% of the grid), seed, and the colour order (0 linear along a direction, 1 radial from a point)
  var LOOKS = [
    {name: 'tiles', col: 2, inv: true, fill: 2, stripe: 10, border: 100, radius: 0, area: 0.5, seed: 448, ord: [0, 0.5, 1]},
    {name: 'wes', col: 3, inv: false, fill: 2, stripe: 16, border: 100, radius: 0.4, area: 9, seed: 486, ord: [0, 0.22, 0.22]},
    {name: 'anderson', col: 3, inv: false, fill: 2, stripe: 10, border: 100, radius: 0, area: 5, seed: 433, ord: [0, 1, 0.5]},
    {name: 'bricks', col: 2, inv: true, fill: 1, stripe: 67, border: 57, radius: 0.1, area: 0.5, seed: 469, ord: [0, 0, 0]},
    {name: 'frames', col: 2, inv: true, fill: 1, stripe: 37, border: 51, radius: 0.2, area: 11, seed: 327, ord: [0, 0, 1]},
    {name: 'frames 2', col: 0, inv: false, fill: 1, stripe: 13, border: 70, radius: 0.3, area: 15, seed: 582, ord: [0, 1, 0]},
    {name: 'mosaic', col: 0, inv: false, fill: 2, stripe: 28, border: 100, radius: 0.1, area: 0.5, seed: 613, ord: [0, 1, 0]},
    {name: 'epicenter', col: 0, inv: false, fill: 2, stripe: 10, border: 100, radius: 0, area: 0.5, seed: 448, ord: [1, 0.5, 0.5]},
    {name: 'heat', col: 1, inv: true, fill: 1, stripe: 81, border: 10, radius: 0.65, area: 1, seed: 575, ord: [1, 0, 0.504]},
    {name: 'coals', col: 1, inv: true, fill: 1, stripe: 74, border: 59, radius: 0.4, area: 1.5, seed: 374, ord: [0, 0.509, 0]},
    {name: 'forest fire', col: 1, inv: true, fill: 2, stripe: 17, border: 56, radius: 1.4, area: 0.5, seed: 578, ord: [0, 0.496, 0]}
  ];
  var FW = 80, FH = 50;                            // body field texels over the 1280 x 800 design space (16 px each)
  var HOLD_S = 0.8, MOVE_R = 0.018, SPLIT_DELAY = 0.5;
  var HAND_WAVE = [380, 1.5, 0.75], IDLE_WAVE = [200, 6.2, 2.0];   // ring speed (px/s), period (s), pulse length (s): the sketch's 120 + 250 frames idle
  var IDLE_RETILE_S = 45;
  var LIM = {look: [0, LOOKS.length - 1], tiles: [2, 40], gap: [1, 20], hue: [0, 360]};

  var VS = '#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS = [
    '#version 300 es',
    'precision highp float; precision highp int;',
    'uniform sampler2D uIdA, uDatA, uIdB, uDatB, uBody;',
    'uniform vec4 uGridA, uGridB;',               // cols, rows, unit x, unit y (design px)
    'uniform vec4 uStyA, uStyB;',                 // fill (0 solid, 1 hollow, 2 zebra), stripe (cells), border (cells), radius (cells)
    'uniform float uHasB;',                       // 1 while a re-tile wave runs
    'uniform vec4 uFront;',                       // wave origin x, y (design px), radius, softness (px)
    'uniform float uGap, uTime, uPx, uHue;',
    'uniform vec4 uEpi[3]; uniform vec4 uEpiW[3];', // epicentre x, y, strength, start time; ring speed, period, pulse length
    'uniform vec2 uRes;',
    'out vec4 o;',
    'vec3 hueRot(vec3 c, float a){ vec3 k = vec3(.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca); }',
    'vec4 dat(sampler2D t, int i, int row){ return texelFetch(t, ivec2(i % 64, (i / 64) * 2 + row), 0); }',
    // the sketch's tile animation: a 0 -> 1 -> 0 bump for `pulse length` once every `period`, delayed by the distance to the epicentre
    'float pulse(vec2 c){ float d = 0.; for (int k = 0; k < 3; k++){ vec4 e = uEpi[k]; if (e.z <= .001) continue; vec4 w = uEpiW[k];',
    '  float rel = uTime - e.w - distance(c, e.xy) / w.x; if (rel < 0.) continue; rel = mod(rel, w.y);',
    '  if (rel < w.z) d += e.z * (.5 - .5 * cos(6.2831853 * rel / w.z)); } return min(d, 1.6); }',
    'float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }',
    'vec4 layer(sampler2D idT, sampler2D dT, vec4 grid, vec4 sty, vec2 p, float isB){',
    '  vec2 u = grid.zw, cf = p / u - .5; ivec2 c = ivec2(floor(cf));',
    '  if (c.x < 0 || c.y < 0 || c.x >= int(grid.x + .5) || c.y >= int(grid.y + .5)) return vec4(0.);',
    '  int id = int(texelFetch(idT, c, 0).r + .5); if (id < 0) return vec4(0.);',
    '  vec4 R = dat(dT, id, 0), I = dat(dT, id, 1);',
    '  vec2 ctr = (vec2(R.x + R.z, R.y + R.w) * .5 + 1.) * u;',
    '  float s = 1.;',
    '  if (uHasB > .5 && I.a < .5) { float df = distance(ctr, uFront.xy);',   // I.a = 1: the tile is the same in both tilings, no swap
    '    s = isB > .5 ? smoothstep(0., uFront.w, uFront.z - df) : smoothstep(0., uFront.w, df - uFront.z); }',
    '  if (s <= .002) return vec4(0.);',
    '  float dl = pulse(ctr), um = min(u.x, u.y);',
    '  float m = texture(uBody, (vec2(c) + 1.) * u / vec2(1280., 800.)).r;',
    '  if (m > .5) {',                            // a body: this cell splits into a fine mosaic of small solid squares
    '    float k = max(2., floor(um / 11.)); vec2 f = fract(cf) * k, sc = (floor(f) + .5) / k;',
    '    vec2 lp = (fract(cf) - sc) * u;',
    '    float hs = .5 / k * um * (.58 + .16 * smoothstep(.5, .95, m)) * s * (1. - .25 * min(dl, 1.));',
    '    float sdm = sdBox(lp, vec2(hs), hs * .5 * min(dl, 1.));',
    '    return vec4(I.rgb, clamp(.5 - sdm / uPx, 0., 1.)); }',
    '  vec2 hb = max((vec2(R.z - R.x, R.w - R.y) + 1.) * .5 - uGap - .2 * dl, vec2(0.)) * s * u;',   // the sketch: half size - gap, -0.2 at the bump
    '  float mn = min(hb.x, hb.y); if (mn <= .05) return vec4(0.);',
    '  float rp = clamp((sty.w + 2. * dl) * um * s, 0., mn);',              // corners round as the ring passes (+2 cells at the bump)
    '  float sd = sdBox(p - ctr, hb, rp), a = clamp(.5 - sd / uPx, 0., 1.);',
    '  if (a <= 0.) return vec4(0.);',
    '  if (sty.x > 1.5) {',                       // zebra: rings of colour and ground from the edge inward, stripes thicken at the bump
    '    float w = max((sty.y + .1 * dl) * um, 3.), t = -sd, sm = mod(t, 2. * w);',
    '    float band = max(clamp((w * .5 - abs(sm - w * .5)) / uPx + .5, 0., 1.), clamp((w * .5 - abs(sm - 2.5 * w)) / uPx + .5, 0., 1.));',
    '    if (t < w * .5) band = 1.;',
    '    a *= band;',
    '  } else if (sty.x > .5) {',                 // hollow: a frame of the border width
    '    float b = max(sty.z * um * s, 2.); a *= clamp(.5 + (sd + b) / uPx, 0., 1.); }',
    '  return vec4(I.rgb, a); }',
    'void main(){',
    '  vec2 p = vec2(gl_FragCoord.x / uRes.x * 1280., (1. - gl_FragCoord.y / uRes.y) * 800.);',
    '  vec3 col = vec3(0.);',
    '  vec4 a = layer(uIdA, uDatA, uGridA, uStyA, p, 0.);',
    '  col = mix(col, hueRot(a.rgb, uHue), a.a);',
    '  if (uHasB > .5) { vec4 b = layer(uIdB, uDatB, uGridB, uStyB, p, 1.); col = mix(col, hueRot(b.rgb, uHue), b.a); }',
    '  o = vec4(clamp(col, 0., 1.), 1.);',
    '}'
  ].join('\n');

  // ---- the Tiler (after Tiler.ts + OccupancyGrid: out of bounds counts as occupied). cells: candidate start cells (shuffled here);
  // occ: Uint8Array, 1 = taken. The end search is bounded by maxA, so even the first tile on an empty 64 x 40 grid is cheap.
  function fillRegion(cols, rows, occ, cells, maxA, rng) {
    var i, j, made = [], DX = [1, -1, 1, -1], DY = [1, 1, -1, -1];
    for (i = cells.length - 1; i > 0; i--) { j = Math.floor(rng() * (i + 1)); var tmp = cells[i]; cells[i] = cells[j]; cells[j] = tmp; }
    for (var s = 0; s < cells.length; s++) {
      var st = cells[s]; if (occ[st]) continue;
      var sx = st % cols, sy = (st / cols) | 0, bx = sx, by = sy, bestA = 0;
      for (var d = 0; d < 4; d++) {
        var dx = DX[d], dy = DY[d], mx = 0, my = 0, xx, yy;
        while (mx + 1 < maxA) { xx = sx + (mx + 1) * dx; if (xx < 0 || xx >= cols || occ[sy * cols + xx]) break; mx++; }
        while (my + 1 < maxA) { yy = sy + (my + 1) * dy; if (yy < 0 || yy >= rows || occ[yy * cols + sx]) break; my++; }
        for (var ex = 0; ex <= mx; ex++) {
          var x = sx + ex * dx;
          for (var ey = 0; ey <= my; ey++) {
            var w = ex + 1, h = ey + 1, area = w * h;
            if (area > maxA) break;                           // taller only grows the area; later columns are shorter still
            var y = sy + ey * dy;
            if (occ[y * cols + x]) { my = ey - 1; break; }
            var asp = w > h ? w / h : h / w;
            if (asp > 2 || (area > 16 && asp > 1.5)) continue;
            if (area > bestA) { bestA = area; bx = x; by = y; }
          }
        }
      }
      var x0 = Math.min(sx, bx), x1 = Math.max(sx, bx), y0 = Math.min(sy, by), y1 = Math.max(sy, by);
      for (var y2 = y0; y2 <= y1; y2++) for (var x2 = x0; x2 <= x1; x2++) occ[y2 * cols + x2] = 1;
      made.push({x0: x0, y0: y0, x1: x1, y1: y1, same: 0});
    }
    return made;
  }

  function create(canvas, kit) {
    var gl = canvas.getContext('webgl2', {antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Tiles needs WebGL2');
    var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0);
    var dead = false, time = 0, frames = 0, frameMs = 0, size = [canvas.width, canvas.height];
    var settings = {look: 0, tiles: 24, gap: 10, hue: 0}, gapDisp = 10;
    var seedRng = mulberry(0x5eed1e5), applied = {look: 0, tiles: 24}, knobAt = -1, idleRetile = IDLE_RETILE_S;
    var tracks = [], ghosts = [], pending = [], trans = null, taps = 0, retiles = 0, merges = 0, splits = 0, bodyCount = 0, contactsN = 0, bodyCells = 0, tileMs = 0;
    var wand = {x: 640, y: 400, str: 1};
    var bodyF = new Float32Array(FW * FH), bodyB = new Uint8Array(FW * FH), maskIdx = new Int32Array(FW * FH).fill(-1), maskAt = -1e9;

    function lookOf(v) { return LOOKS[clamp(Math.round(v), 0, LOOKS.length - 1)]; }
    function colourTiles(T, list) {               // the sketch's colouring: a 2-colour ramp along the look's order, or white -> one of three
      var L = T.look, P = PAL[L.col], i;
      for (i = 0; i < list.length; i++) {
        var t = list[i], c;
        if (P.length === 2) {
          var A = L.inv ? P[1] : P[0], B = L.inv ? P[0] : P[1], v = T.norm.span > 1e-6 ? clamp((proj(T, t) - T.norm.min) / T.norm.span, 0, 1) : 0.5, f = 0.1 + 0.8 * v;
          c = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
        } else {
          var k = T.spawn % 3, g = 0.2 + 0.55 * clamp(T.spawn / Math.max(1, T.n0 - 1), 0, 1), Q = P[1 + k];
          c = [P[0][0] + (Q[0] - P[0][0]) * g, P[0][1] + (Q[1] - P[0][1]) * g, P[0][2] + (Q[2] - P[0][2]) * g];
          T.spawn++;
        }
        t.r = c[0]; t.g = c[1]; t.b = c[2];
      }
    }
    function proj(T, t) {                         // where a tile sits along the look's colour order (cells)
      var cx = (t.x0 + t.x1) * 0.5, cy = (t.y0 + t.y1) * 0.5, o = T.look.ord;
      if (o[0] === 1) return Math.hypot(cx - o[1] * T.cols, cy - o[2] * T.rows);
      var vx = o[1] - 0.5, vy = o[2] - 0.5, hd = vx || vy ? Math.atan2(vy, vx) : 0;
      return cx * Math.cos(hd) + cy * Math.sin(hd);
    }
    function idMap(T) {
      var id = new Int32Array(T.cols * T.rows).fill(-1);
      for (var i = 0; i < T.tiles.length; i++) { var t = T.tiles[i]; for (var y = t.y0; y <= t.y1; y++) for (var x = t.x0; x <= t.x1; x++) id[y * T.cols + x] = i; }
      T.id = id;
    }
    function newTiling(lookV, rows, seed) {       // a whole new random tiling (the sketch's randomTiling)
      var t0 = performance.now(), L = lookOf(lookV), R = clamp(Math.round(rows), 2, 40), C = Math.max(2, Math.round(1280 * R / 800));
      var T = {cols: C, rows: R, ux: 1280 / (C + 1), uy: 800 / (R + 1), look: L, lookV: Math.round(clamp(lookV, 0, LOOKS.length - 1)), spawn: 0, n0: 1, norm: {min: 0, span: 0}};
      var occ = new Uint8Array(C * R), cells = [];
      for (var i = 0; i < C * R; i++) cells.push(i);
      T.maxA = Math.max(1, L.area / 100 * C * R);
      T.tiles = fillRegion(C, R, occ, cells, T.maxA, mulberry(seed));
      var mn = Infinity, mx = -Infinity;
      T.tiles.forEach(function (t) { var v = proj(T, t); if (v < mn) mn = v; if (v > mx) mx = v; });
      T.norm = {min: mn, span: mx - mn}; T.n0 = T.tiles.length;
      colourTiles(T, T.tiles); idMap(T);
      tileMs = performance.now() - t0;
      return T;
    }
    // a local re-pack: drop the tiles `drop` says, place the `add` rectangles, re-tile the freed cells; unchanged tiles are marked same
    function derive(A, drop, add, rng) {
      var t0 = performance.now(), C = A.cols, R = A.rows, occ = new Uint8Array(C * R), freed = [], B = {cols: C, rows: R, ux: A.ux, uy: A.uy, look: A.look, lookV: A.lookV, spawn: A.spawn, n0: A.n0, norm: A.norm, maxA: A.maxA, tiles: []};
      var changed = [], i, x, y;
      for (i = 0; i < A.tiles.length; i++) {
        var t = A.tiles[i];
        if (drop(t)) { t.same = 0; changed.push(t); for (y = t.y0; y <= t.y1; y++) for (x = t.x0; x <= t.x1; x++) freed.push(y * C + x); }
        else { t.same = 1; B.tiles.push({x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1, r: t.r, g: t.g, b: t.b, same: 1}); for (y = t.y0; y <= t.y1; y++) for (x = t.x0; x <= t.x1; x++) occ[y * C + x] = 1; }
      }
      var fresh = [];
      add.forEach(function (r) { for (var yy = r.y0; yy <= r.y1; yy++) for (var xx = r.x0; xx <= r.x1; xx++) occ[yy * C + xx] = 1; fresh.push({x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1, same: 0}); });
      fresh = fresh.concat(fillRegion(C, R, occ, freed, A.maxA, rng));
      colourTiles(B, fresh); B.tiles = B.tiles.concat(fresh); idMap(B);
      tileMs = performance.now() - t0;
      return {B: B, changed: changed.concat(fresh)};
    }

    // ---- GL
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Tiles shader: ' + gl.getShaderInfoLog(s)); return s; }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS), prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Tiles link: ' + gl.getProgramInfoLog(prog));
    var U = {};
    ['uIdA', 'uDatA', 'uIdB', 'uDatB', 'uBody', 'uGridA', 'uGridB', 'uStyA', 'uStyB', 'uHasB', 'uFront', 'uGap', 'uTime', 'uPx', 'uHue', 'uEpi', 'uEpiW', 'uRes'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray();
    function tex(internal, filter) {
      var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    var sets = [{id: tex(gl.R32F, gl.NEAREST), dat: tex(gl.RGBA32F, gl.NEAREST)}, {id: tex(gl.R32F, gl.NEAREST), dat: tex(gl.RGBA32F, gl.NEAREST)}], aSet = 0;
    var bodyTex = tex(gl.R8, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, FW, FH, 0, gl.RED, gl.UNSIGNED_BYTE, bodyB);
    function upload(set, T) {
      var n = T.tiles.length, idf = new Float32Array(T.cols * T.rows), i;
      for (i = 0; i < idf.length; i++) idf[i] = T.id[i];
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.bindTexture(gl.TEXTURE_2D, set.id); gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, T.cols, T.rows, 0, gl.RED, gl.FLOAT, idf);
      var hgt = Math.max(1, Math.ceil(n / 64)) * 2, d = new Float32Array(64 * hgt * 4);
      for (i = 0; i < n; i++) {
        var t = T.tiles[i], o = ((Math.floor(i / 64) * 2) * 64 + (i % 64)) * 4, o2 = o + 64 * 4;
        d[o] = t.x0; d[o + 1] = t.y0; d[o + 2] = t.x1; d[o + 3] = t.y1; d[o2] = t.r; d[o2 + 1] = t.g; d[o2 + 2] = t.b; d[o2 + 3] = t.same ? 1 : 0;
      }
      gl.bindTexture(gl.TEXTURE_2D, set.dat); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, hgt, 0, gl.RGBA, gl.FLOAT, d);
    }

    var A = newTiling(settings.look, settings.tiles, LOOKS[0].seed), B = null;
    upload(sets[aSet], A);

    // ---- transitions: one at a time; anything asked for meanwhile waits in `pending`
    function startTrans(Bn, changed, x, y, speed) {
      var far = 0, i;
      if (changed) { for (i = 0; i < changed.length; i++) { var t = changed[i], cx = ((t.x0 + t.x1) * 0.5 + 1) * Bn.ux, cy = ((t.y0 + t.y1) * 0.5 + 1) * Bn.uy; far = Math.max(far, Math.hypot(cx - x, cy - y)); } }
      else [[0, 0], [1280, 0], [0, 800], [1280, 800]].forEach(function (c) { far = Math.max(far, Math.hypot(c[0] - x, c[1] - y)); });
      if (!changed) A.tiles.forEach(function (t) { t.same = 0; });
      upload(sets[aSet], A); upload(sets[1 - aSet], Bn);
      B = Bn; trans = {x: x, y: y, r: 0, speed: speed, maxR: far + 30, soft: 80};
    }
    function finishTrans() { if (!trans) return; A = B; B = null; aSet = 1 - aSet; trans = null; A.tiles.forEach(function (t) { t.same = 0; }); }
    function request(op) {
      if (op.type === 'retile') { for (var i = pending.length - 1; i >= 0; i--) if (pending[i].type === 'retile') pending.splice(i, 1); }
      if (pending.length >= 6) pending.shift();
      pending.push(op);
    }
    function runPending() {
      while (!trans && pending.length) {
        var op = pending.shift(), r;
        if (op.type === 'retile') {
          var seed = Math.floor(seedRng() * 1e9);
          var Bn = newTiling(op.look, op.tiles, seed); retiles++;
          startTrans(Bn, null, op.x, op.y, op.speed);
        } else if (op.type === 'merge') {
          var tr = op.track; if (!tr || tr.dead || tr.merge !== op) continue;
          var hx = clamp(Math.floor(tr.ax * 1280 / A.ux - 0.5), 0, A.cols - 1), hy = clamp(Math.floor(tr.ay * 800 / A.uy - 0.5), 0, A.rows - 1);
          var ex = Math.max(1, Math.round(125 / A.ux)), ey = Math.max(1, Math.round(95 / A.uy));
          var rect = {x0: Math.max(0, hx - ex), y0: Math.max(0, hy - ey), x1: Math.min(A.cols - 1, hx + ex), y1: Math.min(A.rows - 1, hy + ey)};
          r = derive(A, function (t) { return !(t.x1 < rect.x0 || t.x0 > rect.x1 || t.y1 < rect.y0 || t.y0 > rect.y1); }, [rect], mulberry(Math.floor(seedRng() * 1e9)));
          op.rect = rect; op.done = true; merges++;
          startTrans(r.B, r.changed, tr.ax * 1280, tr.ay * 800, 700);
        } else if (op.type === 'split') {
          var R0 = op.rect, has = A.tiles.some(function (t) { return t.x0 === R0.x0 && t.y0 === R0.y0 && t.x1 === R0.x1 && t.y1 === R0.y1; });
          if (!has) continue;
          r = derive(A, function (t) { return t.x0 === R0.x0 && t.y0 === R0.y0 && t.x1 === R0.x1 && t.y1 === R0.y1; }, [], mulberry(Math.floor(seedRng() * 1e9)));
          splits++;
          startTrans(r.B, r.changed, ((R0.x0 + R0.x1) * 0.5 + 1) * A.ux, ((R0.y0 + R0.y1) * 0.5 + 1) * A.uy, 600);
        }
      }
    }

    function remapMask(now) {                     // screen texel -> body cell (through the registration; a straight stretch without one)
      if (now - maskAt < 2000) return; maskAt = now;
      for (var ty = 0; ty < FH; ty++) for (var tx = 0; tx < FW; tx++) {
        var sx = (tx + 0.5) / FW, sy = (ty + 0.5) / FH, k = kit.fromScreen(sx, sy), u, v;
        if (k && Number.isFinite(k[0]) && Number.isFinite(k[1])) { u = k[0]; v = k[1]; } else { u = sx * 512; v = sy * 424; }
        var cx = Math.floor(u / 4), cy = Math.floor(v / 4);
        maskIdx[ty * FW + tx] = cx >= 0 && cx < body.w && cy >= 0 && cy < body.h ? cy * body.w + cx : -1;
      }
    }
    function updateBody(dt) {
      var kin = 1 - Math.exp(-dt / 0.12), kout = 1 - Math.exp(-dt / 0.4), mask = body.mask, n = 0;
      for (var i = 0; i < FW * FH; i++) {
        var mi = maskIdx[i], tg = mi >= 0 ? clamp(((mask[mi] || 0) - 0.3) / 0.4, 0, 1) : 0, v = bodyF[i];
        v += (tg - v) * (tg > v ? kin : kout); bodyF[i] = v; bodyB[i] = Math.round(v * 255); if (v > 0.5) n++;
      }
      bodyCells = n;
    }

    var tapInput = tapGesture(kit, input, 350);
    function updateTracks(pts, dt) {
      var i, j, t;
      for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
      for (i = 0; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1], best = null, bd = 0.08;
        for (j = 0; j < tracks.length; j++) { t = tracks[j]; if (t.seen) continue; var d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } }
        if (!best) {
          best = {x: x, y: y, ax: x, ay: y, still: 0, str: 0, t0: time, merge: null, dead: false}; tracks.push(best);
        }
        best.x = x; best.y = y; best.seen = true; tapInput.observe(best, x, y);
        if (Math.hypot(x - best.ax, y - best.ay) > MOVE_R) { best.ax = x; best.ay = y; best.still = 0; releaseMerge(best); }
        else best.still += dt;
        if (best.still >= HOLD_S && !best.merge) { best.merge = {type: 'merge', track: best}; request(best.merge); }
      }
      for (i = tracks.length - 1; i >= 0; i--) if (!tracks[i].seen) {
        t = tracks[i];
        if (tapInput.release(t) && !trans && !pending.some(function (op) { return op.type === 'retile'; })) {
          taps++; request({type: 'retile', look: settings.look, tiles: applied.tiles, x: t.x * 1280, y: t.y * 800, speed: 1300});
        }
        t.dead = true; releaseMerge(t); tracks.splice(i, 1); if (t.str > 0.02) ghosts.push(t);
      }
    }
    function releaseMerge(t) {
      var m = t.merge; t.merge = null;
      if (!m) return;
      if (m.done && m.rect) { var rect = m.rect; m.splitAt = time + SPLIT_DELAY; splitQ.push({at: time + SPLIT_DELAY, rect: rect}); }
    }
    var splitQ = [];

    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now(), i;
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      hueFlow.step(settings.hue, dt);
      gapDisp += (settings.gap - gapDisp) * (1 - Math.exp(-dt / 0.35));
      body.update(dt, now); remapMask(now); updateBody(dt);
      bodyCount = body.fresh ? body.people.length : 0;
      var pts = input.read(); contactsN = pts.length;
      updateTracks(pts, dt);
      // knobs that change the tiling re-tile from the centre once they have settled for a moment (a slider drag is one wave, not twenty)
      var wantLook = Math.round(clamp(settings.look, 0, LOOKS.length - 1)), wantRows = Math.round(clamp(settings.tiles, 2, 40));
      if (wantLook !== applied.look || wantRows !== applied.tiles) {
        if (knobAt < 0) knobAt = time;
        if (time - knobAt > 0.25) { applied.look = wantLook; applied.tiles = wantRows; knobAt = -1; request({type: 'retile', look: wantLook, tiles: wantRows, x: 640, y: 400, speed: 1100}); }
      } else knobAt = -1;
      for (i = splitQ.length - 1; i >= 0; i--) if (time >= splitQ[i].at) { request({type: 'split', rect: splitQ[i].rect}); splitQ.splice(i, 1); }
      if (!tracks.length && !trans && !pending.length) { idleRetile -= dt; if (idleRetile <= 0) { idleRetile = IDLE_RETILE_S; request({type: 'retile', look: applied.look, tiles: applied.tiles, x: wand.x, y: wand.y, speed: 520}); } }
      else idleRetile = IDLE_RETILE_S;
      if (trans) { trans.r += trans.speed * dt; if (trans.r > trans.maxR + trans.soft) finishTrans(); }
      runPending();

      // epicentres: every hand (eased in and out), and the wanderer (or the nearest person) when no hand is on the wall
      var hands = 0;
      for (i = 0; i < tracks.length; i++) { var t = tracks[i]; t.str += (1 - t.str) * (1 - Math.exp(-dt / 0.2)); hands += t.str; }
      for (i = ghosts.length - 1; i >= 0; i--) { ghosts[i].str *= Math.exp(-dt / 0.5); if (ghosts[i].str < 0.02) ghosts.splice(i, 1); }
      var wx = 640 + 430 * Math.sin(time * 0.071 + 1.1) + 60 * Math.sin(time * 0.23), wy = 400 + 230 * Math.sin(time * 0.053 + 0.3) + 40 * Math.cos(time * 0.19);
      if (body.fresh && body.people.length) {
        var pp = body.people[0], sp = kit.toScreen(pp.cx * 512, (pp.top * 0.6 + pp.cy * 0.4) * 424);
        if (sp && Number.isFinite(sp[0]) && Number.isFinite(sp[1])) { wx = clamp(sp[0], 0, 1) * 1280; wy = clamp(sp[1], 0, 1) * 800; }
      }
      var kw = 1 - Math.exp(-dt / 1.2); wand.x += (wx - wand.x) * kw; wand.y += (wy - wand.y) * kw;
      wand.str += (Math.max(0, 1 - hands) - wand.str) * (1 - Math.exp(-dt / 0.4));
      draw();
      frameMs = performance.now() - t0;
    }

    var epi = new Float32Array(12), epiW = new Float32Array(12);
    function draw() {
      var w = canvas.width, h = canvas.height, i;
      var list = tracks.concat(ghosts).sort(function (a, b) { return b.str - a.str; });
      epi.fill(0); epiW.fill(1);
      for (i = 0; i < 2 && i < list.length; i++) { var t = list[i]; epi[i * 4] = t.x * 1280; epi[i * 4 + 1] = t.y * 800; epi[i * 4 + 2] = t.str; epi[i * 4 + 3] = t.t0; epiW[i * 4] = HAND_WAVE[0]; epiW[i * 4 + 1] = HAND_WAVE[1]; epiW[i * 4 + 2] = HAND_WAVE[2]; }
      epi[8] = wand.x; epi[9] = wand.y; epi[10] = wand.str; epi[11] = 0; epiW[8] = IDLE_WAVE[0]; epiW[9] = IDLE_WAVE[1]; epiW[10] = IDLE_WAVE[2];
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(prog);
      var SA = sets[aSet], SB = B ? sets[1 - aSet] : sets[aSet];
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, SA.id);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, SA.dat);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, SB.id);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, SB.dat);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, bodyTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FW, FH, gl.RED, gl.UNSIGNED_BYTE, bodyB);
      gl.uniform1i(U.uIdA, 0); gl.uniform1i(U.uDatA, 1); gl.uniform1i(U.uIdB, 2); gl.uniform1i(U.uDatB, 3); gl.uniform1i(U.uBody, 4);
      var TB = B || A, LA = A.look, LB = TB.look;
      gl.uniform4f(U.uGridA, A.cols, A.rows, A.ux, A.uy); gl.uniform4f(U.uGridB, TB.cols, TB.rows, TB.ux, TB.uy);
      gl.uniform4f(U.uStyA, LA.fill, LA.stripe / 100, LA.border / 100, LA.radius); gl.uniform4f(U.uStyB, LB.fill, LB.stripe / 100, LB.border / 100, LB.radius);
      gl.uniform1f(U.uHasB, trans ? 1 : 0);
      gl.uniform4f(U.uFront, trans ? trans.x : 0, trans ? trans.y : 0, trans ? trans.r : 0, trans ? trans.soft : 1);
      gl.uniform1f(U.uGap, 0.005 + (gapDisp - 1) / 19 * 0.245);   // the sketch: gap 1..20 -> 0.005..0.25 cell
      gl.uniform1f(U.uTime, time); gl.uniform1f(U.uPx, 1280 / Math.max(1, w)); gl.uniform1f(U.uHue, hueFlow.value * Math.PI / 180);
      gl.uniform4fv(U.uEpi, epi); gl.uniform4fv(U.uEpiW, epiW); gl.uniform2f(U.uRes, w, h);
      gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    }

    function set(o) {
      if (o && typeof o === 'object') Object.keys(LIM).forEach(function (k) { var v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) settings[k] = clamp(v, LIM[k][0], LIM[k][1]); });
      return {look: settings.look, tiles: settings.tiles, gap: settings.gap, hue: settings.hue};
    }
    function resize(w, h) { if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) size = [w, h]; }
    function destroy() {
      if (dead) return; dead = true;
      tracks = []; ghosts = []; pending = []; splitQ = []; trans = null; input.clear();
      try { sets.forEach(function (s) { gl.deleteTexture(s.id); gl.deleteTexture(s.dat); }); gl.deleteTexture(bodyTex); gl.deleteVertexArray(vao); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); } catch (e) {}
      kit.wantDepth(false);
      if (window.TilewallSet === set) delete window.TilewallSet;
    }

    kit.wantDepth(true);
    window.TilewallSet = set; if (window._tilewallFx) set(window._tilewallFx);
    gapDisp = settings.gap; hueFlow.snap(settings.hue);
    applied.look = Math.round(settings.look); applied.tiles = Math.round(settings.tiles);
    if (applied.look !== 0 || applied.tiles !== 24) { A = newTiling(applied.look, applied.tiles, LOOKS[applied.look].seed); upload(sets[aSet], A); }   // saved knobs apply on entry, no wave
    var out = {frame: frame, touch: function (t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      return {frames: frames, frameMs: frameMs, tileMs: tileMs, contacts: contactsN, tracks: tracks.length, ghosts: ghosts.length, taps: taps, retiles: retiles, merges: merges, splits: splits,
        trans: trans ? {r: trans.r, maxR: trans.maxR, x: trans.x, y: trans.y} : null, pending: pending.map(function (p) { return p.type; }), tilesA: A.tiles.length, tilesB: B ? B.tiles.length : 0,
        grid: [A.cols, A.rows], look: A.look.name, bodyCount: bodyCount, bodyCells: bodyCells, wander: {x: wand.x, y: wand.y, str: wand.str},
        hands: tracks.map(function (t) { return {x: t.x, y: t.y, str: t.str, still: t.still, merge: !!t.merge}; }),
        biggest: A.tiles.reduce(function (m, t) { return Math.max(m, (t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1)); }, 0),
        settings: set(), gap: gapDisp, displayHue: hueFlow.value, size: size, destroyed: dead};
    };
    return out;
  }
})();
