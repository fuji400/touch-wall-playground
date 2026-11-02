/* Canopy (genart lab piece, Builder C, 2026-10-22). Port of jdxyw/generativeart spacecolonization.go: Runions' space colonization.
 * Attractors (motes of light) pull the nearest node within influenceDist; each node with pulls grows one step along the mean
 * direction (plus the Go's small curl perturbation); an attractor closer than killDist to a node is consumed. Thickness follows
 * Murray's law with the brief's cube rule (a parent's radius cubed = the sum of its children's), kept incrementally up the parent
 * chain. Bark runs from bgBottom-tinted moss on the trunks to jade twigs, with whiteCore on new growth; tips carry glowing buds.
 * Live: motes rain from the top, hands are light (a fingertip spawns ~40 motes plus a trail from the nearest twig, so the nearest
 * tree reaches it in a second or two), a held hand unfolds jade leaves and pollen-gold blossoms on the tips around it, a short tap
 * on empty wall drops a seed that roots a sapling (max 7 trees, the oldest crumbles), bodies cast shade (motes inside a person die,
 * branches under a person stop and darken), a person standing still gets a tree climbing their outline, old wood thins and falls.
 * Canvas 2D, typed arrays, a counting-sort node grid, no audio, no network, ASCII only. Colour shift = a CSS hue-rotate on the canvas.
 * Looks (2026-11-01): named presets of the seven palette colours and the three knobs (growth, reach, leaves). Picking one eases
 * the palette over ~0.8 s (wood styles and glow sprites are re-derived each frame of the change, the baked background crossfades
 * from the old bake to the new) and the knobs over ~1.5 s; a moved knob overrides the look's value until the next look.
 */
(function () {
  'use strict';

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

  // --- palette: the Go's named constants (bgTop, bgBottom, whiteCore) + the brief's jade and pollen gold, a moss bark between
  var BG_TOP = [5, 9, 18], BG_BOTTOM = [10, 18, 28], WHITE_CORE = [252, 255, 248], MOSS = [38, 84, 70], JADE = [62, 184, 142], MINT = [160, 234, 200], POLLEN = [242, 200, 92];
  var W = 1280, H = 800, FLOOR = 797, SCALE = 1.35;                              // the Go's 600 px crown ~ one of our trees
  var KILL = 6 * SCALE, STEP = 4.2 * SCALE, NMAX = 7000, AMAX = 3200, CELL = 60, GXN = 22, GYN = 14, OG = 20, OGX = 64, OGY = 40;
  var MAX_TREES = 7, OLD_S = 45, HAND_MOTES = 40;
  // Looks: palette [bgTop, bgBottom, whiteCore, moss bark, jade, mint, pollen] (0..255) and the three shape knobs. Look 0 is the original.
  var LOOKS = [
    {name: 'jade',      growth: 50, reach: 80,  leaf: 60, pal: [BG_TOP, BG_BOTTOM, WHITE_CORE, MOSS, JADE, MINT, POLLEN]},
    {name: 'sakura',    growth: 40, reach: 70,  leaf: 95, pal: [[8, 6, 22], [22, 12, 32], [255, 246, 250], [74, 46, 62], [222, 116, 158], [255, 196, 218], [255, 232, 242]]},
    {name: 'autumn',    growth: 55, reach: 120, leaf: 85, pal: [[14, 6, 4], [28, 13, 6], [255, 240, 210], [96, 50, 22], [214, 104, 34], [250, 190, 90], [232, 52, 30]]},
    {name: 'frost',     growth: 30, reach: 55,  leaf: 15, pal: [[3, 7, 20], [9, 19, 40], [255, 255, 255], [40, 72, 112], [118, 190, 242], [210, 240, 255], [190, 226, 255]]},
    {name: 'neon',      growth: 75, reach: 150, leaf: 45, pal: [[2, 0, 9], [7, 0, 18], [255, 255, 255], [62, 20, 112], [255, 44, 200], [64, 240, 255], [255, 238, 60]]},
    {name: 'moonlight', growth: 50, reach: 100, leaf: 35, pal: [[3, 3, 5], [10, 10, 14], [255, 255, 255], [62, 64, 72], [168, 174, 190], [220, 224, 236], [250, 250, 255]]}
  ];
  var PAL_TAU = 0.25, SHAPE_TAU = 0.5;
  var LIM = {look: [0, LOOKS.length - 1], growth: [0, 100], reach: [40, 200], leaf: [0, 100], hue: [0, 360]};

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }
  function css(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : Math.round(clamp(a, 0, 1) * 1000) / 1000) + ')'; }
  function gauss() { return (Math.random() + Math.random() + Math.random() - 1.5) * 1.41; }
  function hash(i) { var x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

  registerWallPlugin({id: 'canopy', title: 'Canopy', author: 'genart builder C', create: create});

  function create(canvas, kit) {
    var ctx = canvas.getContext('2d', {alpha: false});
    if (!ctx) throw new Error('Canopy needs Canvas 2D');
    var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), dead = false;
    var settings = {look: 0, growth: 50, reach: 80, leaf: 60, hue: 0}, hueFlow = refreshHue(0), hueShown = -1;
    // the look: target palette, the palette on screen (eased), the shape knobs as eased; the names below shadow the module's originals
    var LK = LOOKS[0], over = {growth: false, reach: false, leaf: false}, looks = 0, xf = 1, palMoving = false;
    var cur = {growth: LK.growth, reach: LK.reach, leaf: LK.leaf};
    var palNow = LK.pal.map(function (c) { return c.slice(); }), palGo = LK.pal;
    var BG_TOP, BG_BOTTOM, WHITE_CORE, MOSS, JADE, MINT, POLLEN;
    function usePal(p) { BG_TOP = p[0]; BG_BOTTOM = p[1]; WHITE_CORE = p[2]; MOSS = p[3]; JADE = p[4]; MINT = p[5]; POLLEN = p[6]; }
    function roundPal(p) { return p.map(function (c) { return [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]; }); }
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    usePal(LK.pal);
    var dw = 1280, dh = 800, bg = document.createElement('canvas'), bgOld = document.createElement('canvas'), glowBuf = document.createElement('canvas'), gctx = glowBuf.getContext('2d');
    var time = 0, frames = 0, stepAcc = 0, rainAcc = 0, thinCursor = 0, nextTreeId = 1;
    // nodes
    var nx = new Float32Array(NMAX), ny = new Float32Array(NMAX), npar = new Int32Array(NMAX).fill(-1), nfirst = new Int32Array(NMAX).fill(-1), nnext = new Int32Array(NMAX).fill(-1);
    var ntree = new Int32Array(NMAX), ndepth = new Uint16Array(NMAX), nw = new Float32Array(NMAX), nborn = new Float32Array(NMAX), nbloom = new Float32Array(NMAX);
    var nshade = new Float32Array(NMAX), nalive = new Uint8Array(NMAX), nkids = new Uint16Array(NMAX), accx = new Float32Array(NMAX), accy = new Float32Array(NMAX), accn = new Uint16Array(NMAX);
    var nfree = new Int32Array(NMAX), nfreeTop = 0, nAlive = 0, touched = new Int32Array(NMAX), keyOf = new Int16Array(NMAX);
    for (var fi = NMAX - 1; fi >= 0; fi--) nfree[nfreeTop++] = fi;
    // attractors (motes): kind 0 rain, 1 hand, 2 outline, 3 canopy seed field
    var ax = new Float32Array(AMAX), ay = new Float32Array(AMAX), avy = new Float32Array(AMAX), aact = new Float32Array(AMAX), akind = new Uint8Array(AMAX), aborn = new Float32Array(AMAX), aalive = new Uint8Array(AMAX);
    var afree = new Int32Array(AMAX), afreeTop = 0, aAlive = 0;
    for (var fa = AMAX - 1; fa >= 0; fa--) afree[afreeTop++] = fa;
    // node grid (counting sort, rebuilt per growth step) and the body occupancy grid (screen, rebuilt per depth frame)
    var cellCount = new Int32Array(GXN * GYN), cellStart = new Int32Array(GXN * GYN + 1), cellItems = new Int32Array(NMAX);
    var occ = new Float32Array(OGX * OGY), edgeOut = new Float32Array(2 * 2500), edgeOutN = 0, rimXY = new Float32Array(2 * 2500), rimN = 0, bodyOk = false, bodyCount = 0, persons = [];
    var trees = [], contacts = [], seeds = [], debris = [], ripples = [], plantedFor = {};
    var stats = {steps: 0, grown: 0, killed: 0, handMotes: 0, seeds: 0, plants: 0, thinned: 0, crumbled: 0, taps: 0, holdBloom: 0, shadedNodes: 0, frameMs: 0, peakMs: 0, growMs: 0, preMs: 0};
    var sprites = {gold: sprite(POLLEN), jade: sprite(JADE), white: sprite(WHITE_CORE), mint: sprite(MINT)};

    function sprite(c, s) {                                                         // s: repaint an existing sprite (a look change)
      if (!s) { s = document.createElement('canvas'); s.width = s.height = 64; }
      var g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.clearRect(0, 0, 64, 64);
      gr.addColorStop(0, css(c, 1)); gr.addColorStop(0.25, css(c, 0.45)); gr.addColorStop(0.6, css(c, 0.1)); gr.addColorStop(1, css(c, 0));
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return s;
    }
    function refreshSprites() { sprite(POLLEN, sprites.gold); sprite(JADE, sprites.jade); sprite(WHITE_CORE, sprites.white); sprite(MINT, sprites.mint); }
    function puff(g, spr, x, y, r, a) { if (!(a > 0.003) || !(r > 0)) return; g.globalAlpha = Math.min(1, a); g.drawImage(spr, x - r, y - r, 2 * r, 2 * r); }
    function infl() { return cur.reach; }

    // --- wood
    function addNode(p, x, y, tree) {
      if (!nfreeTop) return -1;
      var i = nfree[--nfreeTop];
      nx[i] = x; ny[i] = y; npar[i] = p; nfirst[i] = -1; nnext[i] = -1; ntree[i] = tree; nw[i] = 1; nborn[i] = time; nbloom[i] = 0; nshade[i] = 0; nkids[i] = 0;
      accx[i] = accy[i] = 0; accn[i] = 0; nalive[i] = 1; nAlive++;
      if (p >= 0) {
        ndepth[i] = ndepth[p] + 1; nnext[i] = nfirst[p]; nfirst[p] = i; nkids[p]++;
        if (nkids[p] >= 2) for (var q = p; q >= 0; q = npar[q]) nw[q] += 1;      // Murray (cubed): a new tip adds its r^3 = 1 to every ancestor
        nshade[i] = nshade[p];
      } else ndepth[i] = 0;
      return i;
    }
    function removeTip(i) {
      if (!nalive[i] || nkids[i]) return false;
      var p = npar[i];
      if (p >= 0) {
        if (nfirst[p] === i) nfirst[p] = nnext[i];
        else for (var c = nfirst[p]; c >= 0; c = nnext[c]) if (nnext[c] === i) { nnext[c] = nnext[i]; break; }
        nkids[p]--;
        if (nkids[p] >= 1) for (var q = p; q >= 0; q = npar[q]) nw[q] = Math.max(1, nw[q] - 1);
      }
      nalive[i] = 0; nAlive--; nfree[nfreeTop++] = i; npar[i] = -1;
      return true;
    }
    function width(i) { return 0.8 + 1.15 * (Math.cbrt(nw[i]) - 1); }
    function treeOf(id) { for (var k = 0; k < trees.length; k++) if (trees[k].id === id) return trees[k]; return null; }
    function plant(x, columnMotes) {
      x = clamp(x, 50, W - 50);
      var live = trees.filter(function (t) { return !t.dying; });
      if (live.length >= MAX_TREES) { live.sort(function (a, b) { return a.born - b.born; }); live[0].dying = true; }
      var t = {id: nextTreeId++, x: x, born: time, dying: false, root: -1};
      var r = addNode(-1, x, FLOOR + 3, t.id);
      if (r < 0) return null;
      t.root = r;
      var a = addNode(r, x + (Math.random() - 0.5) * 2, FLOOR + 3 - STEP, t.id);
      if (a >= 0) addNode(a, x + (Math.random() - 0.5) * 3, FLOOR + 3 - 2 * STEP, t.id);
      trees.push(t); stats.plants++;
      for (var k = 0; columnMotes && k < columnMotes; k++) spawnMote(x + gauss() * (10 + k * 1.2), FLOOR - 30 - k * (230 / columnMotes), 3, 0);
      return t;
    }

    // --- motes
    function spawnMote(x, y, kind, vy) {
      if (!afreeTop || !(x > 4 && x < W - 4 && y > -30 && y < FLOOR - 6)) return -1;
      var i = afree[--afreeTop];
      ax[i] = x; ay[i] = y; avy[i] = vy || 0; akind[i] = kind; aborn[i] = time; aalive[i] = 1; aAlive++;
      aact[i] = kind === 0 ? 95 + Math.random() * 340 : -1e9;                       // rain is only light once it has drifted down into the crowns
      return i;
    }
    function killMote(i) { if (!aalive[i]) return; aalive[i] = 0; aAlive--; afree[afreeTop++] = i; }

    // --- growth: one Runions step
    function rebuildGrid() {
      cellCount.fill(0);
      var i, c;
      for (i = 0; i < NMAX; i++) if (nalive[i]) { c = clamp((ny[i] / CELL) | 0, 0, GYN - 1) * GXN + clamp((nx[i] / CELL) | 0, 0, GXN - 1); keyOf[i] = c; cellCount[c]++; }
      cellStart[0] = 0; for (c = 0; c < GXN * GYN; c++) cellStart[c + 1] = cellStart[c] + cellCount[c];
      cellCount.fill(0);
      for (i = 0; i < NMAX; i++) if (nalive[i]) { c = keyOf[i]; cellItems[cellStart[c] + cellCount[c]++] = i; }
    }
    var qBest = -1, qD2 = 0;
    function nearest(x, y, r) {
      var r2 = r * r, best = -1, bd = r2, x0 = clamp(((x - r) / CELL) | 0, 0, GXN - 1), x1 = clamp(((x + r) / CELL) | 0, 0, GXN - 1), y0 = clamp(((y - r) / CELL) | 0, 0, GYN - 1), y1 = clamp(((y + r) / CELL) | 0, 0, GYN - 1);
      for (var cy = y0; cy <= y1; cy++) for (var cx = x0; cx <= x1; cx++) {
        var c = cy * GXN + cx, e = cellStart[c + 1];
        for (var k = cellStart[c]; k < e; k++) { var j = cellItems[k], dx = nx[j] - x, dy = ny[j] - y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = j; } }
      }
      qBest = best; qD2 = bd; return best;
    }
    function growStep(crowded) {
      rebuildGrid(); stats.steps++;
      var R = infl(), K2 = KILL * KILL, tc = 0, i;
      for (i = 0; i < AMAX; i++) {
        if (!aalive[i] || ay[i] < aact[i]) continue;
        var j = nearest(ax[i], ay[i], R);
        if (j < 0) continue;
        if (akind[i] === 0 && aact[i] > -1e8) {                                     // rain lights up only in a gap, so new growth makes real branches
          if (qD2 < 30 * 30 && (i % 5) < 3) { aact[i] = ay[i] + 30; continue; }        // 3 in 5 wait for a gap, the rest bud new twigs
          aact[i] = -1e9;
        }
        if (qD2 < K2) { if (akind[i] === 1) nbloom[j] = Math.max(nbloom[j], 0.2); killMote(i); stats.killed++; continue; }
        if (nshade[j] > 0.5 || crowded) continue;                                   // shade: a branch under a person does not grow
        var dx = ax[i] - nx[j], dy = ay[i] - ny[j], l = Math.sqrt(qD2) || 1;
        accx[j] += dx / l; accy[j] += dy / l;
        if (accn[j]++ === 0) touched[tc++] = j;
      }
      var minSep2 = (STEP * 0.55) * (STEP * 0.55);
      for (var k = 0; k < tc; k++) {
        var p = touched[k], gx = accx[p], gy = accy[p], gl = Math.hypot(gx, gy);
        accx[p] = accy[p] = 0;
        var n = accn[p]; accn[p] = 0;
        if (gl < 0.15 * n || gl < 1e-6) continue;
        gx /= gl; gy /= gl;
        gx += Math.sin(ny[p] * 0.011 + time * 0.31) * 0.18; gy += Math.cos(nx[p] * 0.011 - time * 0.23) * 0.18;          // the Go's curl nudge
        gl = Math.hypot(gx, gy) || 1;
        var cx = nx[p] + gx / gl * STEP, cy = ny[p] + gy / gl * STEP, close = false;
        if (cx < 8 || cx > W - 8 || cy < 46 || cy > FLOOR + 4) continue;
        for (var c = nfirst[p]; c >= 0; c = nnext[c]) { var ex = nx[c] - cx, ey = ny[c] - cy; if (ex * ex + ey * ey < minSep2) { close = true; break; } }
        if (close) continue;
        var t = treeOf(ntree[p]);
        if (t && t.dying) continue;
        if (addNode(p, cx, cy, ntree[p]) >= 0) stats.grown++;
      }
    }

    // --- bodies: occupancy (screen grid), outline points just outside a person (for climbing), rim points (for the faint outline)
    function bodyGrids() {
      edgeOutN = 0; rimN = 0; persons = [];
      var c0 = kit.toScreen(256, 212);
      bodyOk = !!c0;
      if (!bodyOk || !body.fresh || !body.people.length) { occ.fill(0); return; }
      var m = body.mask, sd = body.sdf, x, y, i;
      for (y = 0; y < OGY; y++) for (x = 0; x < OGX; x++) {
        var k = kit.fromScreen((x + 0.5) * OG / W, (y + 0.5) * OG / H), v = 0;
        if (k && k[0] >= 0 && k[0] < 512 && k[1] >= 0 && k[1] < 424) v = m[((k[1] / 4) | 0) * 128 + ((k[0] / 4) | 0)] || 0;
        occ[y * OGX + x] = v;
      }
      for (y = 0; y < 106; y++) for (x = 0; x < 128; x++) {
        i = y * 128 + x;
        var s = sd[i], p;
        if (s >= 1.5 && s <= 2.6 && edgeOutN < 2500 && (x + y) % 2 === 0) { p = kit.toScreen((x + 0.5) * 4, (y + 0.5) * 4); if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) { edgeOut[2 * edgeOutN] = p[0] * W; edgeOut[2 * edgeOutN + 1] = p[1] * H; edgeOutN++; } }
        if (m[i] > 0.5 && s >= -1.5 && rimN < 2500) {
          var gx = (x < 127 ? m[i + 1] : m[i]) - (x > 0 ? m[i - 1] : m[i]), gy = (y < 105 ? m[i + 128] : m[i]) - (y > 0 ? m[i - 128] : m[i]), gl = Math.hypot(gx, gy) * 0.5, t = gl > 0.02 ? clamp((0.5 - m[i]) / gl, -1, 0) : 0;
          p = kit.toScreen((x + 0.5 + (gl > 0.02 ? gx / (2 * gl) * t : 0)) * 4, (y + 0.5 + (gl > 0.02 ? gy / (2 * gl) * t : 0)) * 4);
          if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) { rimXY[2 * rimN] = p[0] * W; rimXY[2 * rimN + 1] = p[1] * H; rimN++; }
        }
      }
      body.people.forEach(function (q) {
        var a = kit.toScreen(q.left * 512, q.top * 424), b = kit.toScreen(q.right * 512, q.bottom * 424);
        if (a && b && [a[0], a[1], b[0], b[1]].every(Number.isFinite)) persons.push({id: q.id, l: Math.min(a[0], b[0]) * W, r: Math.max(a[0], b[0]) * W, t: Math.min(a[1], b[1]) * H, b: Math.max(a[1], b[1]) * H, still: q.still || 0});
      });
    }
    function occAt(x, y) { var gx = (x / OG) | 0, gy = (y / OG) | 0; if (gx < 0 || gy < 0 || gx >= OGX || gy >= OGY) return 0; return occ[gy * OGX + gx]; }

    // --- hands
    function trailTo(x, y) {                                                        // a mote trail from the nearest twig to the hand
      rebuildGrid();
      var j = nearest(x, y, 2000);
      if (j < 0) return;
      var d = Math.sqrt(qD2), R = infl();
      if (d < R * 0.9) return;
      var n = Math.min(14, Math.ceil(d / (R * 0.55)));
      for (var k = 1; k < n; k++) { var f = k / n; for (var m = 0; m < 2; m++) spawnMote(nx[j] + (x - nx[j]) * f + gauss() * 20, ny[j] + (y - ny[j]) * f + gauss() * 20, 1, 0); }
    }
    var tapInput = tapGesture(kit, input, 0);
    function track(dt) {
      var pts = input.read(), i, j;
      for (i = 0; i < contacts.length; i++) contacts[i].hit = false;
      for (j = 0; j < pts.length; j++) {
        var px = pts[j][0] * W, py = pts[j][1] * H, best = null, bd = 90;
        for (i = 0; i < contacts.length; i++) { var c = contacts[i], d = Math.hypot(c.x - px, c.y - py); if (!c.hit && d < bd) { bd = d; best = c; } }
        if (best) {
          var k = 1 - Math.exp(-dt * 20), ox = best.x, oy = best.y;
          best.x += (px - best.x) * k; best.y += (py - best.y) * k; best.hit = true;
          best.speed += (Math.hypot(best.x - ox, best.y - oy) / Math.max(1e-3, dt) - best.speed) * (1 - Math.exp(-dt / 0.25));
        } else if (contacts.length < 8) {
          var nc = {x: px, y: py, age: 0, hit: true, speed: 0, still: 0, top: 0, trail: 0.9};
          contacts.push(nc); best = nc;
          for (var m = 0; m < HAND_MOTES; m++) spawnMote(px + gauss() * 46, py + gauss() * 46, 1, 0);   // hands are light
          stats.handMotes += HAND_MOTES; trailTo(px, py);
          ripples.push({x: px, y: py, t: 0}); if (ripples.length > 3) ripples.shift();   // a ring of light runs through every tree
        }
        if (best) tapInput.observe(best, px / W, py / H);
      }
      for (i = contacts.length - 1; i >= 0; i--) {
        var q = contacts[i];
        if (!q.hit) {
          contacts.splice(i, 1);
          if (tapInput.release(q)) {                                                       // a true short tap: a seed if the wall is empty here
            stats.taps++;
            rebuildGrid();
            if (nearest(q.x, q.y, 45) < 0) { seeds.push({x: q.x, y: q.y, vy: 0, vx: (Math.random() - 0.5) * 20, t: 0}); stats.seeds++; }
          }
          continue;
        }
        q.age += dt;
        q.still = q.speed < 70 ? q.still + dt : 0;
        q.top += dt; q.trail -= dt;
        if (q.top > 0.1) {                                                          // keep the light topped up under a hand (limited rate)
          q.top = 0;
          var near = 0;
          for (var a = 0; a < AMAX; a++) if (aalive[a] && akind[a] === 1 && Math.abs(ax[a] - q.x) < 70 && Math.abs(ay[a] - q.y) < 70) near++;
          for (var b = near; b < 24 && b < near + 4; b++) { spawnMote(q.x + gauss() * 34, q.y + gauss() * 34, 1, 0); stats.handMotes++; }
        }
        if (q.trail <= 0) { q.trail = 1.0; trailTo(q.x, q.y); }
        if (q.still > 0.6) {                                                        // hold: leaves and blossoms unfold on the tips around the hand
          var R2 = 175 * 175, rate = dt * 1.1;
          for (var n = 0; n < NMAX; n++) {
            if (!nalive[n] || nkids[n] > 1) continue;
            var ex = nx[n] - q.x, ey = ny[n] - q.y;
            if (ex * ex + ey * ey < R2) { nbloom[n] = Math.min(1, nbloom[n] + rate * (1 - Math.sqrt(ex * ex + ey * ey) / 175 * 0.6)); stats.holdBloom++; }
          }
        }
      }
    }

    // --- frame
    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now(), i;
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      hueFlow.step(settings.hue, dt);
      var hv = Math.round(hueFlow.value * 10) / 10;
      if (hv !== hueShown) { hueShown = hv; canvas.style.filter = hv > 0.05 && hv < 359.95 ? 'hue-rotate(' + hv + 'deg)' : ''; }
      stepLook(dt);
      if (body.update(dt, now) || (!body.fresh && (rimN || edgeOutN))) bodyGrids();
      bodyCount = body.fresh && bodyOk ? body.people.length : 0;
      track(dt);
      // rain of light from the top
      rainAcc += dt * (contacts.length ? 8 : 13);
      while (rainAcc >= 1) { rainAcc -= 1; spawnMote(40 + Math.random() * (W - 80), -6 - Math.random() * 20, 0, 12 + Math.random() * 16); }
      kindN[0] = kindN[1] = kindN[2] = kindN[3] = 0;
      for (i = 0; i < AMAX; i++) {
        if (!aalive[i]) continue;
        kindN[akind[i]]++;
        if (akind[i] === 0) { ay[i] += avy[i] * dt; ax[i] += Math.sin(time * 0.6 + i * 1.7) * 6 * dt; if (ay[i] > 520 || time - aborn[i] > 70) { killMote(i); continue; } }
        else if (time - aborn[i] > (akind[i] === 1 ? 14 : akind[i] === 2 ? 9 : 40)) { killMote(i); continue; }
        if (bodyCount && akind[i] !== 2 && occAt(ax[i], ay[i]) > 0.5) killMote(i);   // shade: motes inside a person die
      }
      // a still person: motes gather on the outline and a sapling at their side climbs it
      if (bodyCount && edgeOutN) persons.forEach(function (p) {
        if (p.still < 1.0 || kindN[2] > 160) return;
        for (var s = 0; s < 3; s++) {
          var e = (Math.random() * edgeOutN) | 0, x = edgeOut[2 * e], y = edgeOut[2 * e + 1];
          if (x > p.l - 40 && x < p.r + 40 && y > p.t - 40 && y < p.b + 40 && Math.random() < dt * 12) spawnMote(x, y, 2, 0);
        }
        if (!plantedFor[p.id]) {
          rebuildGrid();
          var R = infl(), left = nearest(p.l - 10, Math.min(FLOOR - 40, p.b - 20), R * 1.6) >= 0, right = nearest(p.r + 10, Math.min(FLOOR - 40, p.b - 20), R * 1.6) >= 0;
          plantedFor[p.id] = true;
          if (!left && !right) plant(p.l - 24 > 60 ? p.l - 24 : p.r + 24, 10);
        }
      });
      // shade per node, eased
      var ks = 1 - Math.exp(-dt / 0.35), shaded = 0;
      for (i = 0; i < NMAX; i++) { if (!nalive[i]) continue; var o = bodyCount ? (occAt(nx[i], ny[i]) > 0.5 ? 1 : 0) : 0; nshade[i] += (o - nshade[i]) * ks; if (nshade[i] > 0.5) shaded++; }
      stats.shadedNodes = shaded;
      // growth
      var g0 = performance.now(), rate = (3 + cur.growth * 0.34) * (contacts.length ? 1.7 : 1), crowded = nAlive > NMAX - 800;
      stepAcc += dt * rate; var steps = 0;
      while (stepAcc >= 1 && steps < 2) { stepAcc -= 1; growStep(crowded); steps++; }
      if (stepAcc > 2) stepAcc = 2;
      stats.growMs = performance.now() - g0;
      thin(dt, crowded);
      // blooms relax toward small idle buds; seeds fall and root; debris falls
      var leafK = cur.leaf / 100, kb = 1 - Math.exp(-dt / 22);
      for (i = 0; i < NMAX; i++) if (nalive[i]) { var target = nkids[i] === 0 && time - nborn[i] > 4 ? 0.22 : 0; nbloom[i] += (target - nbloom[i]) * kb; }
      for (i = seeds.length - 1; i >= 0; i--) {
        var sd = seeds[i]; sd.t += dt; sd.vy += 520 * dt; sd.y += sd.vy * dt; sd.x += sd.vx * dt;
        if (sd.y >= FLOOR - 2) { seeds.splice(i, 1); plant(sd.x, 14); }
      }
      for (i = ripples.length - 1; i >= 0; i--) { ripples[i].t += dt; if (ripples[i].t > 1.9) ripples.splice(i, 1); }
      for (i = debris.length - 1; i >= 0; i--) { var d = debris[i]; d.t += dt; d.vy += 60 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.va * dt; if (d.t > d.life || d.y > H + 20) debris.splice(i, 1); }
      render(leafK);
      stats.frameMs = performance.now() - t0; if (stats.frameMs > stats.peakMs) stats.peakMs = stats.frameMs;
    }
    function shed(i, chance) {                                                      // a twig drops off: a falling stick
      var p = npar[i];
      if (p >= 0 && debris.length < 160 && Math.random() < chance) debris.push({x: nx[i], y: ny[i], dx: nx[p] - nx[i], dy: ny[p] - ny[i], vx: (Math.random() - 0.5) * 20, vy: 10 + Math.random() * 20, a: 0, va: (Math.random() - 0.5) * 3, t: 0, life: 2 + Math.random() * 1.5, b: nbloom[i]});
    }
    function thin(dt, crowded) {
      var old = crowded ? 12 : OLD_S, n = 700, i, k, floorK = clamp((nAlive - 2600) / 1200, 0, 1);   // never thins below ~2600 nodes
      for (k = 0; k < n; k++) {                                                     // old wood thins from the tips inward
        i = thinCursor; thinCursor = (thinCursor + 1) % NMAX;
        if (!nalive[i] || nkids[i] || ndepth[i] < 7 || time - nborn[i] < old) continue;
        if (Math.random() < (crowded ? 0.05 : 0.012 * floorK)) { shed(i, 0.35); removeTip(i); stats.thinned++; }
      }
      for (k = trees.length - 1; k >= 0; k--) {                                    // a replaced tree crumbles away
        var t = trees[k], left = 0, cut = 0;
        if (!t.dying) continue;
        for (i = 0; i < NMAX; i++) {
          if (!nalive[i] || ntree[i] !== t.id) continue;
          left++;
          if (!nkids[i] && cut < 22) { shed(i, 0.25); removeTip(i); cut++; stats.crumbled++; }
        }
        if (!left) trees.splice(k, 1);
      }
    }

    // --- drawing
    var TONE_NEW = 0, TONE_YOUNG = 1, TONE_OLD = 2, TONE_SHADE = 3, NCLS = 10;
    var woodStyle = [];
    function buildWood() {
      woodStyle.length = 0;
      for (var tone = 0; tone < 4; tone++) for (var c = 0; c < NCLS; c++) {
        var f = c / (NCLS - 1), col, a;
        if (tone === TONE_NEW) { col = mix(MINT, WHITE_CORE, 0.75); a = 0.95; }
        else if (tone === TONE_YOUNG) { col = mix(JADE, MINT, 0.55 - 0.3 * f); a = 0.92; }
        else if (tone === TONE_OLD) { col = mix(mix(BG_BOTTOM, MOSS, 0.85), JADE, 0.78 * Math.pow(1 - f, 1.6)); a = 0.95; }
        else { col = mix(BG_BOTTOM, MOSS, 0.42); a = 0.75; }
        woodStyle.push({w: 0.8 + 1.15 * c * 0.9, css: css(col, a), aura: tone === TONE_SHADE ? null : css(tone === TONE_OLD ? JADE : MINT, tone === TONE_NEW ? 0.4 : tone === TONE_YOUNG ? 0.26 : 0.1)});
      }
    }
    buildWood();
    // --- looks: the palette eases every frame of a change; the baked background crossfades from the old bake (bgOld) to the new (bg)
    function bakeWith(target, pal) { var keep = [BG_TOP, BG_BOTTOM, WHITE_CORE, MOSS, JADE, MINT, POLLEN]; usePal(pal); bakeBg(target); usePal(keep); }
    function applyLook(i) {
      LK = LOOKS[i]; over.growth = over.reach = over.leaf = false; looks++;
      if (palMoving) bakeWith(bgOld, roundPal(palNow));                             // what is on screen now becomes the fading layer
      else { var t = bgOld; bgOld = bg; bg = t; }                                   // (settled: that is the current bake itself)
      palGo = LK.pal; bakeWith(bg, palGo);
      xf = 0; palMoving = true;
    }
    function stepLook(dt) {
      var ks = 1 - Math.exp(-dt / SHAPE_TAU), kp = 1 - Math.exp(-dt / PAL_TAU);
      cur.growth += (want('growth') - cur.growth) * ks; cur.reach += (want('reach') - cur.reach) * ks; cur.leaf += (want('leaf') - cur.leaf) * ks;
      if (!palMoving) return;
      var done = true;
      for (var i = 0; i < palNow.length; i++) for (var c = 0; c < 3; c++) { palNow[i][c] += (palGo[i][c] - palNow[i][c]) * kp; if (Math.abs(palGo[i][c] - palNow[i][c]) > 0.4) done = false; }
      xf += (1 - xf) * kp;
      if (done) { palNow = palGo.map(function (c) { return c.slice(); }); xf = 1; palMoving = false; usePal(palGo); }
      else usePal(roundPal(palNow));
      buildWood(); refreshSprites();
    }
    function snapLook() {                                                           // start on the stored look without easing in
      palGo = LK.pal; palNow = palGo.map(function (c) { return c.slice(); }); usePal(palGo); xf = 1; palMoving = false;
      cur.growth = want('growth'); cur.reach = want('reach'); cur.leaf = want('leaf');
      buildWood(); refreshSprites(); bakeBg();
    }
    function bakeBg(target) {
      target = target || bg;
      target.width = dw; target.height = dh;
      var g = target.getContext('2d');
      g.setTransform(dw / W, 0, 0, dh / H, 0, 0);
      var acc = mix(BG_BOTTOM, MOSS, 0.14), lg = g.createLinearGradient(0, 0, 0, H);
      lg.addColorStop(0, css(BG_TOP)); lg.addColorStop(1, css(acc));
      g.fillStyle = lg; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';                                       // the Go's soft nebula glow behind the canopy, kept dim
      [[640, 380, 620, MOSS, 0.16], [330, 330, 360, JADE, 0.05], [950, 330, 360, mix(JADE, POLLEN, 0.4), 0.045], [640, 760, 420, MOSS, 0.12]].forEach(function (s) {
        var r = g.createRadialGradient(s[0], s[1], 0, s[0], s[1], s[2]); r.addColorStop(0, css(s[3], s[4])); r.addColorStop(1, css(s[3], 0)); g.fillStyle = r; g.fillRect(0, 0, W, H);
      });
      for (var i = 0; i < 380; i++) {                                               // fine spore dust
        var x = hash(i * 3 + 1) * W, y = hash(i * 3 + 2) * H * 0.92, a = 0.05 + 0.12 * hash(i * 3 + 3);
        g.fillStyle = css(mix(MINT, POLLEN, hash(i + 77)), a); g.fillRect(x, y, 1.3, 1.3);
      }
      g.globalCompositeOperation = 'source-over';
      var fl = g.createLinearGradient(0, FLOOR - 26, 0, H);                         // the soil line the trees stand on
      fl.addColorStop(0, css(MOSS, 0)); fl.addColorStop(0.75, css(MOSS, 0.18)); fl.addColorStop(1, css(mix(MOSS, JADE, 0.3), 0.3));
      g.fillStyle = fl; g.fillRect(0, FLOOR - 26, W, H - FLOOR + 26);
      var vg = g.createRadialGradient(640, 420, 380, 640, 420, 900);                 // the Go's vignette
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }
    var paths = new Array(4 * NCLS), tipList = new Int32Array(NMAX), kindN = [0, 0, 0, 0], sx = new Float32Array(NMAX), sy = new Float32Array(NMAX);
    function render(leafK) {
      var i, p;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(bg, 0, 0, dw, dh);
      if (xf < 1) { ctx.globalAlpha = 1 - xf; ctx.drawImage(bgOld, 0, 0, dw, dh); ctx.globalAlpha = 1; }   // a look change: the old background fades out
      gctx.setTransform(1, 0, 0, 1, 0, 0); gctx.globalCompositeOperation = 'source-over'; gctx.globalAlpha = 1; gctx.clearRect(0, 0, glowBuf.width, glowBuf.height);
      gctx.setTransform(glowBuf.width / W, 0, 0, glowBuf.height / H, 0, 0); gctx.globalCompositeOperation = 'lighter'; gctx.lineCap = 'round';
      ctx.setTransform(dw / W, 0, 0, dh / H, 0, 0); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      // wood, bucketed by Murray width class and tone
      for (i = 0; i < paths.length; i++) paths[i] = null;
      var gust = 0.7 + 0.3 * Math.sin(time * 0.13);
      for (i = 0; i < NMAX; i++) {                                                  // idle: the canopy sways in a slow wind, more at the top
        if (!nalive[i]) continue;
        var hh = clamp((FLOOR - ny[i]) / 700, 0, 1), dx = 7 * gust * hh * hh * Math.sin(time * 0.55 + nx[i] * 0.0045 + hh * 1.3);
        sx[i] = nx[i] + dx; sy[i] = ny[i] + Math.abs(dx) * 0.08;
      }
      var nt = 0;
      for (i = 0; i < NMAX; i++) {
        if (!nalive[i]) continue;
        p = npar[i];
        if (!nkids[i]) tipList[nt++] = i;
        if (p < 0) continue;
        var age = time - nborn[i], tone = nshade[i] > 0.5 ? TONE_SHADE : age < 1.4 ? TONE_NEW : age < 6 ? TONE_YOUNG : TONE_OLD;
        for (var rp = 0; rp < ripples.length && tone > TONE_NEW; rp++) { var rr = ripples[rp], rd = Math.hypot(nx[i] - rr.x, ny[i] - rr.y) - rr.t * 820; if (rd < 0 && rd > -70 * (1 - rr.t / 1.9) - 8) tone = tone === TONE_SHADE ? TONE_SHADE : TONE_YOUNG - (rd > -30 ? 1 : 0); }
        var c = Math.min(NCLS - 1, Math.round((Math.cbrt(nw[i]) - 1) * 1.6)), key = tone * NCLS + c, P = paths[key] || (paths[key] = new Path2D());
        P.moveTo(sx[p], sy[p]); P.lineTo(sx[i], sy[i]);
      }
      for (var key2 = paths.length - 1; key2 >= 0; key2--) {                        // thick first, then thin over them
        var P2 = paths[key2]; if (!P2) continue;
        var st = woodStyle[key2];
        ctx.strokeStyle = st.css; ctx.lineWidth = st.w; ctx.stroke(P2);
        if (st.aura) { gctx.strokeStyle = st.aura; gctx.lineWidth = st.w * 2.2 + 3; gctx.stroke(P2); }
      }
      // inner filament on new growth (the Go's bright highlight pass)
      for (var c2 = 0; c2 < NCLS; c2++) { var Pn = paths[TONE_NEW * NCLS + c2]; if (Pn) { ctx.strokeStyle = css(WHITE_CORE, 0.9); ctx.lineWidth = Math.max(0.6, woodStyle[c2].w * 0.38); ctx.stroke(Pn); } }
      // tips: buds, and the leaves / blossoms a held hand unfolded
      var leaves = new Path2D(), blossoms = new Path2D(), cores = new Path2D(), buds = new Path2D(), rings = new Path2D(), nl = 0;
      for (var t = 0; t < nt; t++) {
        i = tipList[t];
        var b = nbloom[i], x = sx[i], y = sy[i], ag = time - nborn[i];
        if (nshade[i] > 0.5) continue;
        if (ag < 1.6) puff(gctx, sprites.white, x, y, 9, 0.5 * (1 - ag / 1.6));
        if (b * leafK < 0.04) { buds.moveTo(x + 1.3, y); buds.arc(x, y, 1.3, 0, 6.283); continue; }
        var r = (1.4 + 7.5 * b) * (0.25 + 0.95 * leafK), h = hash(i);
        if (h < 0.62) { var la = h * 40 + ny[i] * 0.01, lx = Math.cos(la) * r * 0.5, ly = Math.sin(la) * r * 0.5; leaves.moveTo(x + lx + r, y + ly); leaves.ellipse(x + lx, y + ly, r, r * 0.5, la, 0, 6.283); }
        else {
          blossoms.moveTo(x + r * 0.75, y); blossoms.arc(x, y, r * 0.75, 0, 6.283);
          if (b > 0.45) { cores.moveTo(x + r * 0.26, y); cores.arc(x, y, r * 0.26, 0, 6.283); if (h > 0.86) { rings.moveTo(x + r * 1.5, y); rings.arc(x, y, r * 1.5, 0, 6.283); } if (nl < 260) { puff(gctx, sprites.gold, x, y, r * 2.6, 0.55 * b * leafK); nl++; } }
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = css(MINT, 0.7); ctx.fill(buds);
      ctx.fillStyle = css(JADE, 0.78); ctx.fill(leaves);
      ctx.fillStyle = css(POLLEN, 0.85); ctx.fill(blossoms);
      ctx.fillStyle = css(WHITE_CORE, 0.9); ctx.fill(cores);
      ctx.strokeStyle = css(POLLEN, 0.4); ctx.lineWidth = 0.9; ctx.stroke(rings);
      // motes of light: the rain, a hand's cloud, the outline of a still person
      var rain = new Path2D(), dim = new Path2D(), warm = new Path2D(), nh = 0;
      for (i = 0; i < AMAX; i++) {
        if (!aalive[i]) continue;
        var tw = 0.6 + 0.4 * Math.sin(time * 2.3 + i * 2.1);
        if (ay[i] < aact[i]) { dim.rect(ax[i] - 0.7, ay[i] - 0.7, 1.4, 1.4); continue; }
        if (akind[i] === 0 || akind[i] === 3) { rain.rect(ax[i] - 0.9, ay[i] - 0.9, 1.8, 1.8); if ((i & 3) === 0) puff(gctx, sprites.mint, ax[i], ay[i], 8, 0.3 * tw); }
        else { warm.rect(ax[i] - 1.1, ay[i] - 1.1, 2.2, 2.2); if (nh < 160) { puff(gctx, sprites.gold, ax[i], ay[i], 10, 0.4 * tw); nh++; } }
      }
      ctx.fillStyle = css(MINT, 0.35); ctx.fill(dim);
      ctx.fillStyle = css(mix(MINT, WHITE_CORE, 0.5), 0.8); ctx.fill(rain);
      ctx.fillStyle = css(mix(POLLEN, WHITE_CORE, 0.35), 0.95); ctx.fill(warm);
      for (i = 0; i < ripples.length; i++) {                                        // the touch-down ring of light, faint, across the whole wall
        var rpl = ripples[i], rr2 = rpl.t * 820 - 20;
        if (rr2 > 4) { gctx.globalAlpha = 0.075 * (1 - rpl.t / 1.9); gctx.strokeStyle = css(MINT); gctx.lineWidth = 64; gctx.beginPath(); gctx.arc(rpl.x, rpl.y, rr2, 0, 6.283); gctx.stroke(); }
      }
      gctx.globalAlpha = 1;
      // hands: a soft pool of light where the light comes from
      for (i = 0; i < contacts.length; i++) { var q = contacts[i]; puff(gctx, sprites.gold, q.x, q.y, 70 + 30 * Math.min(1, q.still), 0.35); puff(gctx, sprites.white, q.x, q.y, 16, 0.5); }
      // seeds falling
      for (i = 0; i < seeds.length; i++) { var sd = seeds[i]; puff(gctx, sprites.gold, sd.x, sd.y, 22, 0.8); ctx.fillStyle = css(WHITE_CORE, 0.95); ctx.beginPath(); ctx.arc(sd.x, sd.y, 2.6, 0, 6.283); ctx.fill(); }
      // falling twigs
      if (debris.length) {
        ctx.beginPath();
        for (i = 0; i < debris.length; i++) { var d = debris[i], ca = Math.cos(d.a), sa = Math.sin(d.a); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.dx * ca - d.dy * sa, d.y + d.dx * sa + d.dy * ca); }
        ctx.strokeStyle = css(mix(MOSS, JADE, 0.5), 0.6); ctx.lineWidth = 1.1; ctx.stroke();
      }
      // a faint jade rim on every person: you see yourself as the shade in the canopy
      if (rimN && body.fresh) {
        gctx.beginPath();
        for (i = 0; i < rimN; i++) { var ex = rimXY[2 * i], ey = rimXY[2 * i + 1]; gctx.moveTo(ex + 6, ey); gctx.arc(ex, ey, 6, 0, 6.283); }
        gctx.globalAlpha = 0.08; gctx.fillStyle = css(JADE); gctx.fill();
      }
      gctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowBuf, 0, 0, dw, dh);
      ctx.globalCompositeOperation = 'source-over';
    }

    function resize(w, h) {
      if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
      dw = w; dh = h;
      glowBuf.width = Math.max(1, Math.round(w / 4)); glowBuf.height = Math.max(1, Math.round(h / 4));
      if (palMoving) { bakeWith(bgOld, roundPal(palNow)); bakeWith(bg, palGo); } else bakeBg();
    }
    function set(o) {
      if (o && typeof o === 'object') {
        var lk = o.look;                                                            // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['growth', 'reach', 'leaf'].forEach(function (k) {                          // a knob that MOVED overrides the look's value until the next look
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
      trees = []; contacts = []; seeds = []; debris = []; ripples = [];
      bg.width = 1; bg.height = 1; bgOld.width = 1; bgOld.height = 1; glowBuf.width = 1; glowBuf.height = 1;
      try { canvas.style.filter = ''; } catch (e) {}
      if (window.CanopySet === set) delete window.CanopySet;
    }

    kit.wantDepth(true);
    resize(canvas.width, canvas.height);
    if (bg.width <= 1) { dw = 1280; dh = 800; glowBuf.width = 320; glowBuf.height = 200; bakeBg(); }
    window.CanopySet = set;
    if (window._canopyFx) set(window._canopyFx);
    snapLook(); hueFlow.snap(settings.hue);
    // a grown canopy from the first frame: four trees, a canopy field of motes (the Go's trunk corridors + a lobed crown band), pre-grown
    (function pregrow() {
      var p0 = performance.now(), xs = [170, 480, 810, 1110];
      time = -26;                                                                   // pre-grown wood is old wood
      xs.forEach(function (x) { plant(x + (Math.random() - 0.5) * 60, 0); });
      trees.forEach(function (t) {
        var x0 = t.x, k, u;
        for (k = 0; k < 70; k++) { u = k / 69; spawnMote(x0 + gauss() * (6 + 46 * Math.pow(u, 1.35)) + Math.sin(u * 8.2 + k % 3 * 2.094) * 22 * u, FLOOR - 16 - u * 300, 3, 0); }   // braided trunk corridor
        var cyc = 330 + (Math.random() - 0.5) * 60, rx = 225 + Math.random() * 45, ry = 150 + Math.random() * 25;
        for (k = 0, u = 0; k < 3400 && u < 620; k++) {                             // the Go's lobed crown with spiral-arm density
          var ang = Math.random() * 6.283, rad = Math.sqrt(Math.random()), env = (0.82 + 0.22 * Math.cos(2 * (ang - Math.PI / 2)) - 0.1 * Math.sin(ang)) * (1 + 0.14 * Math.cos(5 * ang + rad * 2.8));
          var px = x0 + rad * env * rx * Math.cos(ang), py = cyc + rad * env * ry * Math.sin(ang), dens = (0.55 + 0.45 * Math.cos(3 * ang + 4.8 * rad)) * (0.5 + 0.5 * Math.sin(px * 0.021 + py * 0.017));
          if (Math.random() < (0.35 + 0.65 * dens) && spawnMote(px, py, 3, 0) >= 0) u++;
        }
      });
      for (var s = 0; s < 260 && performance.now() - p0 < 150; s++) { growStep(false); time += 0.08; }
      time = 0;
      trees.forEach(function (t) { t.born = -26; });
      for (var i = 0; i < NMAX; i++) if (nalive[i]) nbloom[i] = nkids[i] ? 0 : 0.22;
      stats.preMs = performance.now() - p0;
    })();
    var out = {frame: frame, touch: function (t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
    if (window.WallTest) out.test = {plant: function (x) { return !!plant(+x || 640, 14); }, gap: function (x, y) { rebuildGrid(); return nearest(x * W, y * H, 2000) < 0 ? 9999 : Math.sqrt(qD2); }};
    if (window.WallTest) out.debug = function () {
      var kinds = [0, 0, 0, 0], bloomed = 0, i;
      for (i = 0; i < AMAX; i++) if (aalive[i]) kinds[akind[i]]++;
      for (i = 0; i < NMAX; i++) if (nalive[i] && nbloom[i] > 0.6) bloomed++;
      var o = Object.assign({}, stats); stats.peakMs = 0;
      rebuildGrid();
      var reach = contacts.map(function (c) { var j = nearest(c.x, c.y, 2000); return j < 0 ? -1 : Math.round(Math.sqrt(qD2)); });
      return {frames: frames, nodes: nAlive, trees: trees.map(function (t) { return {id: t.id, x: Math.round(t.x), dying: t.dying}; }), motes: aAlive, kinds: kinds, bloomed: bloomed,
              contacts: contacts.map(function (c) { return {x: Math.round(c.x), y: Math.round(c.y), age: Math.round(c.age * 100) / 100, still: Math.round(c.still * 100) / 100}; }),
              seeds: seeds.length, debris: debris.length, ripples: ripples.length, reach: reach, live: trees.filter(function (t) { return !t.dying; }).length, bodyCount: bodyCount, bodyOk: bodyOk, persons: persons.length, rimN: rimN, stats: o,
              look: LK.name, looks: looks, overrides: Object.assign({}, over), crossfade: xf, eased: {growth: cur.growth, reach: cur.reach, leaf: cur.leaf},
              displayHue: hueFlow.value, filter: canvas.style.filter, settings: set(), destroyed: dead};
    };
    return out;
  }
})();
