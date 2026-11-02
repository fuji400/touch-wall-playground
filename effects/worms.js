/* Worms (genart lab, batch 2, 2026-10-22).
   After "worms" by Maksim Vasilyev, p5-experiments (https://github.com/vasilyev-maksim/p5-experiments), CC BY-NC 4.0; studio use, non-commercial.
   Our own port of the algorithm and the looks (no p5, none of his TypeScript): the wall is a grid; worms are laid out by his navigator on an
   occupancy grid (spawn at a random free cell, grow cell by cell by the pattern's rule: random, directional, snail, mirror, ring attractor)
   until every cell is taken, then drawn as thick round-capped lines (corner type, hollowness) that grow out of a dot and shrink back on his
   flat-sine clock, coloured from the look's dark colour to its bright one by length. The looks are his presets.
   Live: a hand is food. The worms around a fingertip re-grow toward it and gather there (two hands split the colony between them). Tap =
   every worm reverses (it stretches out, then slurps back into its far end and grows out again from there; the flip sweeps out from the tap).
   Hold = the worms around the hand coil into snails. Walk = a body is a wall: no worm is drawn across a person, and the worms around a
   person re-grow along the outline. Idle = his grow / shrink cycle, the maze re-laid at every dot phase (static looks re-grow a wandering
   patch instead). Canvas 2D, flat colours, no gradients. ASCII only. */
(function(){
'use strict';

// --- contacts and hue easing (copied from the lab refresh common code, prismpathsflow.js)
function refreshContacts(kit, graceMs) {
  var wakes=[], last=[], lastSeen=0, lastStamp=-Infinity, state='empty';
  function valid(p){return Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1;}
  function clean(raw){var out=[];(Array.isArray(raw)?raw:[]).slice(0,32).forEach(function(p){if(valid(p)&&out.length<8&&!out.some(function(q){return Math.hypot(q[0]-p[0],q[1]-p[1])<.015;}))out.push([p[0],p[1]]);});return out;}
  function read(){
    var now=Date.now(),f=kit.fingers;
    wakes=wakes.filter(function(p){return now>=p.t&&now-p.t<=240;});
    if(f){
      wakes=[];
      if(!Number.isFinite(f.t)||now-f.t>250||f.t-now>50){last=[];state='stale';return [];}
      if(f.t<lastStamp){state='stale';return [];}
      lastStamp=f.t;
      var pts=clean(f.pts);
      if(pts.length){last=pts;lastSeen=f.t;state='fresh';return pts;}
      if(last.length&&now-lastSeen<graceMs){state='recovering';return last.map(function(p){return p.slice();});}
      last=[];state='empty';return [];
    }
    var sparse=wakes.map(function(p){return[p.x,p.y];});
    (kit.touches||[]).forEach(function(p){if(p&&Number.isFinite(p.t)&&now-p.t>=0&&now-p.t<=240)sparse.push([p.x,p.y]);});
    state=sparse.length?'sparse':'empty';return clean(sparse);
  }
  function wake(x,y){if(!valid([x,y])||kit.fingers)return;var now=Date.now(),old=wakes.find(function(p){return Math.hypot(p.x-x,p.y-y)<.025;});if(old){old.x=x;old.y=y;old.t=now;}else{if(wakes.length>=8)wakes.shift();wakes.push({x:x,y:y,t:now});}}
  return {read:read,wake:wake,clear:function(){wakes=[];last=[];},size:function(){return wakes.length;},get state(){return state;}};
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

function refreshHue(initial){
  var value=Number.isFinite(initial)?initial:0;
  return {get value(){return value;},snap:function(v){value=v;},step:function(target,dt){var d=((target-value+540)%360)-180;if(Math.abs(d)<.001){value=target%360;return;}value=(value+d*(1-Math.exp(-Math.max(0,Math.min(.1,dt))/.18))+360)%360;}};
}

registerWallPlugin({id: 'worms', title: 'Worms', author: 'Builder J (genart, after Maksim Vasilyev)', create: create});

var W = 1280, H = 800, DEG = Math.PI / 180, TAU = Math.PI * 2, KW = 128, KH = 106, SBW = 128, SBH = 80, SBS = 10;
var MAXR = 64, MAXC = 102, MAXCELLS = MAXR * MAXC, POOLC = MAXCELLS * 6, MAXW = MAXCELLS * 3;
var TG = 0.4, TD = 0.35, DOTOUT = 0.2, NB = 12;
// his directions (getAbsVecFromDir): up, right, down, left = (0,+1), (-1,0), (0,-1), (+1,0); his "up" is down the screen
var DX = [0, -1, 0, 1], DY = [1, 0, -1, 0], UP = 0, LEFT = 3;
// his colour pairs (controls.ts COLOR, [first, second]); white toned to a warm ivory for the projector
var IVORY = [228, 224, 214];
var PAIRS = [[[255, 0, 0], [255, 0, 0]], [[255, 0, 0], [71, 0, 0]], [IVORY, IVORY], [IVORY, [37, 37, 37]], [[90, 255, 74], [3, 36, 0]],
             [[234, 114, 247], [0, 0, 255]], [[253, 255, 121], [192, 74, 255]]];
// his presets (presets.ts): pat = PATTERN_TYPE (0 random, 1 directional, 2 snail, 3 mirror, 4 ring), res, len, th = THICKNESS,
// inner = INNER_THICKNESS (a fraction of th), corners 0 square / 1 round / 2 cut, anim 0 static / 1 forward / 2 backward / 3 both, inv = INVERT_COLORS
var LOOKS = [
  {name: 'worms',        pat: 0, res: 50, len: 7,   th: 0.45, inner: 0.35, corners: 1, anim: 1, col: 1, inv: true,  td: 1,   seed: 490, start: 0},
  {name: 'snakes',       pat: 0, res: 50, len: 100, th: 0.8,  inner: 0,    corners: 1, anim: 0, col: 2, inv: true,  td: 0.6, seed: 455, start: 0},
  {name: 'sea weed',     pat: 1, res: 50, len: 69,  th: 0.4,  inner: 0.4,  corners: 2, anim: 1, col: 4, inv: true,  td: 1.5, seed: 219, start: 0},
  {name: 'snails',       pat: 2, res: 50, len: 16,  th: 0.55, inner: 0.4,  corners: 0, anim: 3, col: 3, inv: true,  td: 1,   seed: 775, start: 172},
  {name: 'symmetry',     pat: 3, res: 24, len: 10,  th: 0.85, inner: 0.9,  corners: 0, anim: 1, col: 0, inv: true,  td: 1,   seed: 29,  start: 0},
  {name: 'guts',         pat: 1, res: 50, len: 100, th: 0.7,  inner: 0,    corners: 0, anim: 1, col: 5, inv: true,  td: 0.8, seed: 326, start: 0},
  {name: 'graffiti',     pat: 0, res: 9,  len: 21,  th: 0.9,  inner: 0,    corners: 0, anim: 0, col: 6, inv: false, td: 1,   seed: 571, start: 0},
  {name: 'lick & stare', pat: 0, res: 27, len: 23,  th: 0.9,  inner: 0.1,  corners: 0, anim: 0, col: 2, inv: true,  td: 1,   seed: 10,  start: 0},
  {name: 'eye of the universe', pat: 4, res: 50, len: 100, th: 0.45, inner: 0.3, corners: 1, anim: 3, col: 1, inv: true, td: 2, seed: 278, start: 150}
];
var DEF_LOOK = 0;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }
function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function hueRot(c, deg) {                                // the CSS hue-rotate matrix (black and white stay put)
  if (!deg) return [c[0], c[1], c[2]];
  var a = Math.cos(deg * DEG), b = Math.sin(deg * DEG), r = c[0], g = c[1], bl = c[2];
  return [clamp((0.213 + 0.787 * a - 0.213 * b) * r + (0.715 - 0.715 * a - 0.715 * b) * g + (0.072 - 0.072 * a + 0.928 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a + 0.143 * b) * r + (0.715 + 0.285 * a + 0.140 * b) * g + (0.072 - 0.072 * a - 0.283 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a - 0.787 * b) * r + (0.715 - 0.715 * a + 0.715 * b) * g + (0.072 + 0.928 * a + 0.072 * b) * bl, 0, 255)];
}
function mulberry(seed) { var s = seed >>> 0; return function() { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// his flatSin (core/utils.ts): a sine with flat plateaus, period 2
function flatSin(x, outer, middle, inner) {
  var r = ((x + 1) % 2 + 2) % 2 - 1, H2 = Math.PI / 2;
  function m(a, b) { return (r - a) / (b - a) * 2 - 1; }
  if (r <= outer - 1) return -1;
  if (r >= 1 - outer) return -1;
  if (r >= -inner && r <= inner) return 1;
  if (middle === 0) return r < 0 ? Math.sin(m(outer - 1, -inner) * H2) : -Math.sin(m(inner, 1 - outer) * H2);
  if (r < 0) {
    if (r <= -0.5 - middle) return Math.sin(m(outer - 1, -0.5 - middle) * H2) / 2 - 0.5;
    if (r < -0.5 + middle) return 0;
    return Math.sin(m(-0.5 + middle, -inner) * H2) / 2 + 0.5;
  }
  if (r <= 0.5 - middle) return -Math.sin(m(inner, 0.5 - middle) * H2) / 2 + 0.5;
  if (r < 0.5 + middle) return 0;
  return -Math.sin(m(0.5 + middle, 1 - outer) * H2) / 2 - 0.5;
}
// his animation types on that clock: progress -1 = a dot at the tail end, 0 = the whole worm, +1 = a dot at the head end
function progressAt(x, anim) {
  if (anim === 1) return (flatSin(x, 0.1, 0, 0.25) - 1) / 2;
  if (anim === 2) return (1 - flatSin(x, 0.1, 0, 0.25)) / 2;
  if (anim === 3) return flatSin(x / 2, 0.05, 0.125, 0.05);
  return 0;
}

function create(canvas, kit) {
  var ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Worms needs Canvas 2D');
  var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0), dead = false;
  var settings = {look: DEF_LOOK, grid: 100, length: 100, speed: 100, hue: 0};
  var size = [canvas.width || W, canvas.height || H], time = 0, frames = 0, frameMs = 0;

  // --- the worm pool (typed arrays; a worm = a run of domain cells, tail first)
  var WC = new Int32Array(POOLC), WS = new Int32Array(MAXW), WN = new Int32Array(MAXW), WB = new Float32Array(MAXW), WD = new Float32Array(MAXW);
  var WRV = new Float32Array(MAXW), WFP = new Uint8Array(MAXW), WREV = new Uint8Array(MAXW), WG = new Uint8Array(MAXW), WLR = new Float32Array(MAXW), WSN = new Uint8Array(MAXW);
  var nW = 0, nC = 0, LIVE = 1e9;
  // --- the current grid (domain = what the navigator walks; images = where its cells land on the wall: 1, or 8 for the mirror look)
  var GEO = [null, null, null, null], geoCur = -1, geoNext = 0, g0 = null;
  var OCC = new Int32Array(MAXCELLS), PBLK = new Uint8Array(MAXCELLS), BBLK = new Uint8Array(MAXCELLS), BPREV = new Uint8Array(MAXCELLS), REG = new Uint8Array(MAXCELLS), ORDER = new Int32Array(MAXCELLS);
  var refLongest = 1, curLen = 7, rngSeed = 1;

  function makeGeo(L, rows) {
    var R = rows, C = Math.max(2, Math.min(MAXC, Math.round(W * R / H))), g = {R: R, C: C, cw: W / (C + 1), ch: H / (R + 1), look: L, mirror: L.pat === 3};
    if (g.mirror) { g.qw = Math.ceil(C / 2); g.qh = Math.ceil(R / 2); g.dw = g.qw; g.dh = g.qh; g.k = g.qw / g.qh; g.nImg = 8; }
    else { g.dw = C; g.dh = R; g.nImg = 1; }
    var cs = (g.cw + g.ch) / 2, dn = g.dw * g.dh, d, x, y;
    g.th = L.th * cs; g.inner = L.inner * L.th * cs; g.join = ['miter', 'round', 'bevel'][L.corners] || 'round';
    g.IMG = new Int32Array(dn * g.nImg); g.PX = new Float32Array(C * R); g.PY = new Float32Array(C * R);
    for (y = 0; y < R; y++) for (x = 0; x < C; x++) { g.PX[y * C + x] = (x + 1) * g.cw; g.PY[y * C + x] = (y + 1) * g.ch; }
    for (d = 0; d < dn; d++) {
      x = d % g.dw; y = (d - x) / g.dw;
      if (!g.mirror) { g.IMG[d] = y * C + x; continue; }
      var bx = [x, g.qw - 1 - x], by = [y, g.qh - 1 - y], o = d * 8;
      for (var h = 0; h < 2; h++) {
        var a = bx[h], b = by[h];
        g.IMG[o++] = b * C + a; g.IMG[o++] = b * C + (C - 1 - a); g.IMG[o++] = (R - 1 - b) * C + (C - 1 - a); g.IMG[o++] = (R - 1 - b) * C + a;
      }
    }
    return g;
  }
  function patternBlock(g) {
    var dn = g.dw * g.dh, x, y, d;
    PBLK.fill(0, 0, dn);
    if (g.mirror) { for (d = 0; d < dn; d++) { x = d % g.dw; y = (d - x) / g.dw; if (x > g.k * y) PBLK[d] = 1; } }
    else if (g.look.pat === 4) {                                    // his ring (inner 0.2, outer 0.7 of half the height, around the centre)
      var cx = Math.floor(g.dw / 2), cy = Math.floor(g.dh / 2), R = g.dh / 2;
      for (d = 0; d < dn; d++) { x = d % g.dw; y = (d - x) / g.dw; var dd = Math.hypot(cx - x, cy - y); if (dd > R * 0.7 || dd < R * 0.2) PBLK[d] = 1; }
    }
  }
  function foldFull(g, fx, fy) {                                     // a wall cell -> the domain cell whose image it is
    fx = clamp(Math.round(fx), 0, g.C - 1); fy = clamp(Math.round(fy), 0, g.R - 1);
    if (!g.mirror) return [fx, fy];
    var x = fx < g.qw ? fx : g.C - 1 - fx, y = fy < g.qh ? fy : g.R - 1 - fy;
    x = clamp(x, 0, g.qw - 1); y = clamp(y, 0, g.qh - 1);
    if (x > g.k * y) { x = g.qw - 1 - x; y = g.qh - 1 - y; }
    return [x, y];
  }
  function pxToDomain(g, px, py) { return foldFull(g, px / g.cw - 1, py / g.ch - 1); }
  function domPx(g, d) { var f = g.IMG[d * g.nImg]; return [g.PX[f], g.PY[f]]; }

  // --- bodies: a screen-space block map (10 px bins) from the depth silhouette; the domain block map is taken from it at each re-grow
  var KB = new Int16Array(KW * KH * 4).fill(-1), kbAt = -1e9, SB = new Uint8Array(SBW * SBH), SBT = new Uint8Array(SBW * SBH), sbOn = false, bodyCount = 0, sbCount = 0;
  function buildKB(nowMs) {
    if (nowMs - kbAt < 2000) return;
    kbAt = nowMs;
    for (var y = 0; y < KH; y++) for (var x = 0; x < KW; x++) {
      var k = (y * KW + x) * 4, p0 = kit.toScreen(x * 4, y * 4), p1 = kit.toScreen((x + 1) * 4, (y + 1) * 4);
      if (!p0 || !p1 || !Number.isFinite(p0[0]) || !Number.isFinite(p0[1]) || !Number.isFinite(p1[0]) || !Number.isFinite(p1[1])) { p0 = [x * 4 / 512, y * 4 / 424]; p1 = [(x + 1) * 4 / 512, (y + 1) * 4 / 424]; }
      var x0 = Math.floor(Math.min(p0[0], p1[0]) * SBW), x1 = Math.floor(Math.max(p0[0], p1[0]) * SBW), y0 = Math.floor(Math.min(p0[1], p1[1]) * SBH), y1 = Math.floor(Math.max(p0[1], p1[1]) * SBH);
      if (x1 < 0 || y1 < 0 || x0 >= SBW || y0 >= SBH || x1 - x0 > 12 || y1 - y0 > 12) { KB[k] = -1; continue; }
      KB[k] = Math.max(0, x0); KB[k + 1] = Math.min(SBW - 1, x1); KB[k + 2] = Math.max(0, y0); KB[k + 3] = Math.min(SBH - 1, y1);
    }
  }
  function updateSB(nowMs) {
    var live = body.fresh && body.people.length > 0, i, x, y;
    if (!live) { if (sbOn) { SB.fill(0); sbOn = false; sbCount = 0; } return; }
    buildKB(nowMs);
    SBT.fill(0);
    var mask = body.mask;
    for (i = 0; i < KW * KH; i++) {
      if (mask[i] <= 0.5) continue;
      var k = i * 4; if (KB[k] < 0) continue;
      for (y = KB[k + 2]; y <= KB[k + 3]; y++) for (x = KB[k]; x <= KB[k + 1]; x++) SBT[y * SBW + x] = 1;
    }
    SB.fill(0); sbCount = 0;                                          // one bin of margin around the person
    for (y = 0; y < SBH; y++) for (x = 0; x < SBW; x++) {
      if (!SBT[y * SBW + x]) continue;
      for (var yy = Math.max(0, y - 1); yy <= Math.min(SBH - 1, y + 1); yy++) for (var xx = Math.max(0, x - 1); xx <= Math.min(SBW - 1, x + 1); xx++) SB[yy * SBW + xx] = 1;
    }
    for (i = 0; i < SBW * SBH; i++) sbCount += SB[i];
    sbOn = true;
  }
  function sbAt(px, py) { var x = Math.floor(px / SBS), y = Math.floor(py / SBS); return x >= 0 && y >= 0 && x < SBW && y < SBH ? SB[y * SBW + x] : 0; }
  function domainBodyBlock(g, out) {                                 // the navigator's wall: domain cells under a person (not for the mirror look)
    var dn = g.dw * g.dh, n = 0;
    out.fill(0, 0, dn);
    if (!sbOn || g.mirror) return 0;
    for (var d = 0; d < dn; d++) { var f = g.IMG[d]; if (sbAt(g.PX[f], g.PY[f])) { out[d] = 1; n++; } }
    return n;
  }

  // --- the navigator (his WormNavigator on our occupancy grid)
  var rng = mulberry(1);
  function freeCell(g, x, y) { if (x < 0 || y < 0 || x >= g.dw || y >= g.dh) return -1; var d = y * g.dw + x; return OCC[d] || PBLK[d] || BBLK[d] ? -1 : d; }
  function nearBody(g, d) {
    var x = d % g.dw, y = (d - x) / g.dw;
    for (var i = 0; i < 4; i++) { var nx = x + DX[i], ny = y + DY[i]; if (nx >= 0 && ny >= 0 && nx < g.dw && ny < g.dh && BBLK[ny * g.dw + nx]) return true; }
    return false;
  }
  var hugBody = false;
  function pickMove(g, cur, rule, ax, ay) {                         // returns the direction index or -1 (his goUsingWeights / goRandom / goToAttractor)
    var x = cur % g.dw, y = (cur - x) / g.dw, best = -1, bw = -1e9, curD = rule >= 2 ? Math.hypot(ax - x, ay - y) : 0;
    for (var i = 0; i < 4; i++) {
      var d = freeCell(g, x + DX[i], y + DY[i]);
      if (d < 0) continue;
      var w;
      if (rule === 0) w = rng();                                    // random
      else if (rule === 1) w = [0.85, 0.5, 0.15, 0.5][i];           // directional (directionX 0.5, directionY 0.15)
      else { w = curD - Math.hypot(ax - (x + DX[i]), ay - (y + DY[i])); if (w <= 0) continue; }   // attractor: only cells closer to it
      if (hugBody && nearBody(g, d)) w += rule >= 2 ? 0.25 : 0.7;   // worms that meet a person crawl along the outline
      if (w > bw) { bw = w; best = i; }
    }
    return best;
  }
  function push(w, d) { WC[nC++] = d; WN[w]++; OCC[d] = w + 1; }
  // grow one worm from cell c0. rule: 0 random, 1 directional, 2 attractor (ax, ay), 3 snail (side)
  function growWorm(g, c0, rule, maxLen, ax, ay, side) {
    var w = nW++;
    WS[w] = nC; WN[w] = 0; WD[w] = LIVE; WRV[w] = -1e9; WFP[w] = 0; WREV[w] = 0; WG[w] = geoCur; WSN[w] = rule === 3 ? 1 : 0;
    push(w, c0);
    var cur = c0, dir = UP, i;
    if (rule === 3) {                                               // his snailPattern: one random step, then straight on, a left turn every `side` steps or when blocked
      var m = pickMove(g, cur, 0, 0, 0);
      if (m < 0) return w;
      cur += DX[m] + DY[m] * g.dw; push(w, cur); dir = m;
      i = 1;
      while (WN[w] < maxLen) {
        var turn = i % side === 0, nd = turn ? (LEFT + dir) % 4 : (UP + dir) % 4, nx = cur % g.dw + DX[nd], ny = (cur - cur % g.dw) / g.dw + DY[nd], c = freeCell(g, nx, ny);
        if (c < 0 && !turn) { nd = (LEFT + dir) % 4; nx = cur % g.dw + DX[nd]; ny = (cur - cur % g.dw) / g.dw + DY[nd]; c = freeCell(g, nx, ny); if (c >= 0) i = 0; }
        if (c < 0) break;
        cur = c; dir = nd; push(w, cur); i++;
      }
      return w;
    }
    while (WN[w] < maxLen) {
      var mv = pickMove(g, cur, rule, ax, ay);
      if (mv < 0) break;
      cur += DX[mv] + DY[mv] * g.dw; push(w, cur);
    }
    return w;
  }
  function lookRule(g) { var p = g.look.pat; return p === 1 ? 1 : p === 2 ? 3 : p === 4 ? 2 : 0; }
  // spawn and grow worms on every free cell (of the region, when given), in a shuffled order (his getRandomFreeCell)
  // opts: {region, foods: [[dx, dy, px, py]], foodLen, snail: [[dx, dy, r]], center: [px, py] or null, delay0, speed}
  function generate(opts) {
    var g = GEO[geoCur], dn = g.dw * g.dh, n = 0, c, i, made = 0, longest = 0, first = nW;
    for (c = 0; c < dn; c++) if ((!opts.region || REG[c]) && !OCC[c] && !PBLK[c] && !BBLK[c]) ORDER[n++] = c;
    for (i = n - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)), t = ORDER[i]; ORDER[i] = ORDER[j]; ORDER[j] = t; }
    var baseRule = lookRule(g), side = Math.max(2, curLen), ringA = [Math.floor(g.dw * 0.5), Math.floor(g.dh * 0.5)];
    hugBody = sbOn && !g.mirror;
    for (i = 0; i < n; i++) {
      c = ORDER[i];
      if (OCC[c] || PBLK[c] || BBLK[c]) continue;
      var cap = baseRule === 3 ? 400 : curLen, rule = baseRule, ax = ringA[0], ay = ringA[1], sd = side;
      var x = c % g.dw, y = (c - x) / g.dw, k;
      if (opts.snail) for (k = 0; k < opts.snail.length; k++) { var sn = opts.snail[k]; if (Math.hypot(sn[0] - x, sn[1] - y) <= sn[2]) { rule = 3; sd = 3; cap = 36; break; } }
      if (rule !== 3 && opts.foods && opts.foods.length) {
        var bf = null, bd = 1e9;
        for (k = 0; k < opts.foods.length; k++) { var fd = Math.hypot(opts.foods[k][0] - x, opts.foods[k][1] - y); if (fd < bd) { bd = fd; bf = opts.foods[k]; } }
        if (bf) { rule = 2; ax = bf[0]; ay = bf[1]; cap = Math.max(curLen, opts.foodLen || 0); }
      }
      if (nW >= MAXW - 1 || nC + cap + 2 > POOLC) break;
      var w = growWorm(g, c, rule, cap, ax, ay, sd);
      if (WN[w] > longest) longest = WN[w];
      var p = domPx(g, c), dl = 0;
      if (opts.center) dl = Math.hypot(p[0] - opts.center[0], p[1] - opts.center[1]) / (opts.speed || 900);
      if (opts.foods && opts.foods.length) { var bdp = 1e9; for (k = 0; k < opts.foods.length; k++) bdp = Math.min(bdp, Math.hypot(p[0] - opts.foods[k][2], p[1] - opts.foods[k][3])); dl = bdp / (opts.speed || 900); }
      WB[w] = time + (opts.delay0 || 0) + dl + (opts.jitter ? rng() * opts.jitter : 0);
      made++;
    }
    if (!opts.region) refLongest = Math.max(1, longest);
    for (i = first; i < nW; i++) WLR[i] = Math.min(1, WN[i] / Math.max(refLongest, opts.region ? Math.min(curLen, refLongest) : 1));
    return made;
  }
  // retire the live worms of the current grid that touch the region (or all): they shrink away while the new ones grow
  function retire(region, center, speed, delay0) {
    var n = 0;
    for (var w = 0; w < nW; w++) {
      if (WD[w] < LIVE || WG[w] !== geoCur) continue;
      var s = WS[w], m = WN[w], hit = !region, i;
      if (region) for (i = 0; i < m; i++) if (REG[WC[s + i]]) { hit = true; break; }
      if (!hit) continue;
      var dl = 0;
      if (center) { var p = domPx(GEO[geoCur], WC[s]); dl = Math.hypot(p[0] - center[0], p[1] - center[1]) / (speed || 900); }
      WD[w] = time + dl + (delay0 || 0) + 0.05; n++;
      for (i = 0; i < m; i++) { var cc = WC[s + i]; if (OCC[cc] === w + 1) OCC[cc] = 0; if (region) REG[cc] = 1; }   // everything it frees is re-seeded
    }
    return n;
  }
  function retireOld() { for (var w = 0; w < nW; w++) if (WG[w] !== geoCur && WD[w] >= LIVE) WD[w] = time + rng() * 0.3; }
  function rebuildOcc() {
    var g = GEO[geoCur]; OCC.fill(0, 0, g.dw * g.dh);
    for (var w = 0; w < nW; w++) if (WD[w] >= LIVE && WG[w] === geoCur) for (var i = 0; i < WN[w]; i++) OCC[WC[WS[w] + i]] = w + 1;
  }
  function compact() {
    var nw = 0, nc = 0;
    for (var w = 0; w < nW; w++) {
      if (WD[w] < LIVE && time > WD[w] + TD + DOTOUT + 0.05) continue;
      var s = WS[w], n = WN[w];
      if (nc !== s) WC.copyWithin(nc, s, s + n);
      WS[nw] = nc; WN[nw] = n; WB[nw] = WB[w]; WD[nw] = WD[w]; WRV[nw] = WRV[w]; WFP[nw] = WFP[w]; WREV[nw] = WREV[w]; WG[nw] = WG[w]; WLR[nw] = WLR[w]; WSN[nw] = WSN[w];
      nc += n; nw++;
    }
    nW = nw; nC = nc;
    rebuildOcc();
    var used = {}; for (w = 0; w < nW; w++) used[WG[w]] = 1;
    for (var k = 0; k < 4; k++) if (k !== geoCur && !used[k]) GEO[k] = null;
  }
  function room(cells) { if (nC + cells > POOLC * 0.7 || nW > MAXW * 0.7) compact(); return nC + cells < POOLC * 0.92 && nW < MAXW * 0.92; }

  // --- re-grows
  var regens = 0, foodReplans = 0, holdReplans = 0, bodyReplans = 0, wanderReplans = 0, taps = 0, lastLook = -1, lastRows = -1, lastLen = -1, pendingGlobal = false, lastGlobal = -1e9;
  function rowsFor() { var L = LOOKS[settings.look]; return clamp(Math.round(L.res * settings.grid / 100), 3, MAXR); }
  function lenFor() { var L = LOOKS[settings.look]; return clamp(Math.round(L.len * settings.length / 100), 1, 300); }
  function globalRegen(center, newGrid) {
    var L = LOOKS[settings.look], rows = rowsFor();
    if (!room(MAXCELLS * 1.2)) return false;
    if (settings.look !== lastLook) { clockX = L.start * 0.005; inDot = false; }   // his presets carry their start time: a new look opens grown
    rngSeed++; rng = mulberry(L.seed * 7919 + rngSeed * 104729);
    if (newGrid || geoCur < 0) {
      var slot = -1;
      for (var k = 0; k < 4; k++) if (!GEO[k]) { slot = k; break; }
      if (slot < 0) { compact(); for (k = 0; k < 4; k++) if (!GEO[k]) { slot = k; break; } }
      if (slot < 0) return false;
      GEO[slot] = makeGeo(L, rows); geoCur = slot; g0 = GEO[slot];
      retireOld();
      OCC.fill(0, 0, g0.dw * g0.dh); patternBlock(g0);
    } else retire(null, center, 1400);
    curLen = lenFor();
    bprevAny = domainBodyBlock(g0, BBLK) > 0; BPREV.set(BBLK.subarray(0, g0.dw * g0.dh));
    generate({center: center, speed: 1400, delay0: center ? 0.15 : 0.08, jitter: center ? 0 : 0.25});
    lastLook = settings.look; lastRows = rows; lastLen = curLen; lastGlobal = time; regens++;
    return true;
  }
  function discRegion(g, pts, r) {                                   // REG = domain cells within r cells of the given domain points
    var dn = g.dw * g.dh; REG.fill(0, 0, dn);
    for (var k = 0; k < pts.length; k++) {
      var cx = pts[k][0], cy = pts[k][1], rr = Math.ceil(r);
      for (var y = Math.max(0, cy - rr); y <= Math.min(g.dh - 1, cy + rr); y++) for (var x = Math.max(0, cx - rr); x <= Math.min(g.dw - 1, cx + rr); x++)
        if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) REG[y * g.dw + x] = 1;
    }
  }
  function localRegen(region, opts) {
    if (!room(region * 2 + 64)) return false;
    var g = g0;
    retire(REG, opts.center, opts.speed, opts.delay0);
    domainBodyBlock(g, BBLK);
    generate(opts);
    return true;
  }

  // --- hands: tracks (stillness from the finger feed), food, taps, holds
  var tracks = [], nextTid = 1, planned = [], lastFood = -1e9, foodHold = 0, holdsAlive = 0, lastPlanned = null, foodGoneAt = 0;
  function foodRadius() { return clamp(300 / g0.cw, 3, 24); }
  var tapInput = tapGesture(kit, input, 350);
  function updateHands(pts, dt) {
    var i, t;
    for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
    pts.forEach(function(p) {
      var best = null, bd = 0.12;
      tracks.forEach(function(q) { if (!q.seen) { var d = Math.hypot(q.x - p[0], q.y - p[1]); if (d < bd) { bd = d; best = q; } } });
      if (!best) { best = {id: nextTid++, x: p[0], y: p[1], ax: p[0], ay: p[1], still: 0, age: 0, held: false, v: 0}; tracks.push(best); }
      var sp = dt > 0 ? Math.hypot((p[0] - best.x) * W, (p[1] - best.y) * H) / dt : 0;
      best.v += (Math.min(3000, sp) - best.v) * ease(dt, 0.15);
      best.seen = true; best.x = p[0]; best.y = p[1]; tapInput.observe(best, p[0], p[1]);
      if (Math.hypot(p[0] - best.ax, p[1] - best.ay) > 0.02) { best.ax = p[0]; best.ay = p[1]; best.still = 0; } else best.still += dt;
    });
    for (i = tracks.length - 1; i >= 0; i--) if (!tracks[i].seen) { if (tapInput.release(tracks[i])) tap(tracks[i].x * W, tracks[i].y * H); tracks.splice(i, 1); }
    tracks.forEach(function(q) { q.age += dt; });
    var foods = tracks.filter(function(q) { return q.age >= 0.25; });
    foodHold += ((foods.length ? 1 : 0) - foodHold) * ease(dt, foods.length ? 0.3 : 1.0);
    // food: re-grow around the hands when one arrives or moves 2.5 cells, at most every 0.4 s
    // (at once when a hand arrives or settles; every 1.2 s at most while it drags, so each re-grow can finish)
    if (foods.length && time - lastFood >= 0.4) {
      var arrived = foods.length !== planned.length, moved = false, settled = true;
      foods.forEach(function(q) { var md = 1e9; planned.forEach(function(p) { md = Math.min(md, Math.hypot(p[0] - q.x * W, p[1] - q.y * H)); }); if (md > 2.5 * g0.cw) moved = true; if (q.v > 120) settled = false; });
      if (arrived || (moved && (settled || time - lastFood >= 1.2))) {
        var r = foodRadius(), dpts = [], fl = [];
        foods.forEach(function(q) { var d = pxToDomain(g0, q.x * W, q.y * H); dpts.push(d); fl.push([d[0], d[1], q.x * W, q.y * H]); });
        discRegion(g0, dpts, r);
        planned.forEach(function(p) { var d = pxToDomain(g0, p[0], p[1]), rr = r * 0.7, R2 = Math.ceil(rr);
          for (var yy = Math.max(0, d[1] - R2); yy <= Math.min(g0.dh - 1, d[1] + R2); yy++) for (var xx = Math.max(0, d[0] - R2); xx <= Math.min(g0.dw - 1, d[0] + R2); xx++)
            if ((xx - d[0]) * (xx - d[0]) + (yy - d[1]) * (yy - d[1]) <= rr * rr) REG[yy * g0.dw + xx] = 1; });
        var cnt = 0; for (i = 0; i < g0.dw * g0.dh; i++) cnt += REG[i];
        if (localRegen(cnt, {region: true, foods: fl, foodLen: Math.ceil(r * 1.3), speed: 1300, delay0: 0.05, center: [fl[0][2], fl[0][3]]})) {
          planned = foods.map(function(q) { return [q.x * W, q.y * H]; }); lastFood = time; foodReplans++;
        }
      }
    }
    if (!foods.length && planned.length && time - lastFood > 0.6) { lastPlanned = planned; foodGoneAt = time; planned = []; }
    if (lastPlanned && !foods.length && time - foodGoneAt > 2.5) {        // static looks never re-lay their maze: the colony disperses back to the look
      if (LOOKS[settings.look].anim === 0) {
        var rr = foodRadius(), dps = lastPlanned.map(function(p) { return pxToDomain(g0, p[0], p[1]); });
        discRegion(g0, dps, rr);
        var cn = 0; for (i = 0; i < g0.dw * g0.dh; i++) cn += REG[i];
        localRegen(cn, {region: true, center: lastPlanned[0], speed: 700, delay0: 0.05});
      }
      lastPlanned = null;
    }
    // hold: the worms around a still hand coil into snails (once per hold)
    holdsAlive = 0;
    tracks.forEach(function(q) {
      if (q.still >= 0.9 && !q.held) {
        q.held = true;
        var d = pxToDomain(g0, q.x * W, q.y * H), r = clamp(110 / g0.cw, 2.5, 9);
        discRegion(g0, [d], r);
        var cnt = 0; for (var k = 0; k < g0.dw * g0.dh; k++) cnt += REG[k];
        if (localRegen(cnt, {region: true, snail: [[d[0], d[1], r]], center: [q.x * W, q.y * H], speed: 500, delay0: 0.05})) holdReplans++;
      }
      if (q.still < 0.9) q.held = false;
      if (q.held) holdsAlive++;
    });
  }
  function tap(px, py) {                                             // every worm reverses, in a wave from the tap
    taps++;
    for (var w = 0; w < nW; w++) {
      if (WD[w] < LIVE) continue;
      var g = GEO[WG[w]]; if (!g) continue;
      var p = domPx(g, WC[WS[w]]);
      WRV[w] = time + Math.hypot(p[0] - px, p[1] - py) / 1100; WFP[w] = 1;
    }
  }

  // --- the clock (his getTime * 0.005 per frame at 60 fps)
  var clockX = 0, prog = 0, Fg = 1, inDot = false, wanderAt = 0;
  function stepClock(dt) {
    var L = LOOKS[settings.look];
    clockX += dt * 0.3 * L.td * settings.speed / 100 * (1 - foodHold);   // feeding holds the cycle; it resumes where it left off
    if (clockX > 4000) clockX -= 4000;
    prog = progressAt(clockX, L.anim);
    Fg = 1 - Math.abs(prog);
    var dot = Math.abs(prog) > 0.995;
    if (dot && !inDot && L.anim !== 0 && foodHold < 0.05 && !holdsAlive && time - lastGlobal > 1) globalRegen(null, false);   // a new maze at every dot phase
    inDot = dot;
    if (L.anim === 0 && foodHold < 0.05 && !holdsAlive && time >= wanderAt) {   // static looks: a wandering patch re-grows instead
      wanderAt = time + 2.8 / Math.max(0.2, L.td * settings.speed / 100);
      var px = W * (0.5 + 0.38 * Math.sin(time * 0.23)), py = H * (0.5 + 0.34 * Math.sin(time * 0.31 + 1.3)), d = pxToDomain(g0, px, py), r = clamp(130 / g0.cw, 2, 8);
      discRegion(g0, [d], r);
      var cnt = 0; for (var k = 0; k < g0.dw * g0.dh; k++) cnt += REG[k];
      if (localRegen(cnt, {region: true, center: [px, py], speed: 400, delay0: 0.05})) wanderReplans++;
    }
  }

  // --- bodies: re-grow the worms around a person (with the outline bonus) when the silhouette changed, at most every 1.3 s
  var lastBody = -1e9, bodyCheckAt = -1e9, bprevAny = false;
  function bodyReplan() {
    var edge = sbOn !== bprevAny;                                     // someone arrived or everyone left: re-grow at once, else at most every 1.3 s
    if (g0.mirror || time - lastBody < (edge ? 0.3 : 1.3) || time - bodyCheckAt < 0.25) return;
    bodyCheckAt = time;
    var dn = g0.dw * g0.dh, changed = 0, total = 0, d, x, y, sx = 0, sy = 0;
    domainBodyBlock(g0, REG);
    for (d = 0; d < dn; d++) { if (REG[d] !== BPREV[d]) changed++; total += REG[d] | BPREV[d]; }
    if (!total || changed < Math.max(6, total * 0.04)) return;
    // region: within 3 cells of the body now or before
    ORDER.fill(0, 0, dn);
    for (d = 0; d < dn; d++) ORDER[d] = REG[d] | BPREV[d];
    BPREV.set(REG.subarray(0, dn));
    bprevAny = false; for (d = 0; d < dn; d++) if (BPREV[d]) { bprevAny = true; break; }
    REG.fill(0, 0, dn);
    var n = 0;
    for (d = 0; d < dn; d++) {
      if (!ORDER[d]) continue;
      x = d % g0.dw; y = (d - x) / g0.dw; sx += x; sy += y; n++;
      for (var yy = Math.max(0, y - 3); yy <= Math.min(g0.dh - 1, y + 3); yy++) for (var xx = Math.max(0, x - 3); xx <= Math.min(g0.dw - 1, x + 3); xx++) REG[yy * g0.dw + xx] = 1;
    }
    var cnt = 0; for (d = 0; d < dn; d++) cnt += REG[d];
    var c = domPx(g0, Math.round(sy / n) * g0.dw + Math.round(sx / n));
    if (localRegen(cnt, {region: true, center: c, speed: 700, delay0: 0.05})) { bodyReplans++; lastBody = time; }
  }

  // --- colours
  var COLS = new Array(NB), colKey = '', colA = [0, 0, 0], colB = [0, 0, 0], colInit = false;
  function stepColours(dt, Hd) {
    var L = LOOKS[settings.look], pr = PAIRS[L.col], a = L.inv ? pr[1] : pr[0], b = L.inv ? pr[0] : pr[1], k = colInit ? ease(dt, 0.35) : 1, i;
    colInit = true;
    for (i = 0; i < 3; i++) { colA[i] += (a[i] - colA[i]) * k; colB[i] += (b[i] - colB[i]) * k; }
    var A = hueRot(colA, Hd), B = hueRot(colB, Hd), key = A.map(Math.round).join(',') + ':' + B.map(Math.round).join(',');
    if (key === colKey) return;
    colKey = key;
    for (i = 0; i < NB; i++) { var t = i / (NB - 1); COLS[i] = 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * t) + ',' + Math.round(A[1] + (B[1] - A[1]) * t) + ',' + Math.round(A[2] + (B[2] - A[2]) * t) + ')'; }
  }

  // --- drawing: one Path2D per (grid, colour step) for the worms, one per grid for the dots; strokes, then the hollow cores in black
  var PATHS = new Array(4 * NB), DOTS = new Array(4 * NB), DOTIN = new Array(4), drawn = 0, cut = 0, dotsN = 0;
  function render() {
    var sx = size[0] / W, sy = size[1] / H, w, i, k, m;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size[0], size[1]);
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    for (i = 0; i < PATHS.length; i++) { PATHS[i] = null; DOTS[i] = null; }
    for (i = 0; i < 4; i++) DOTIN[i] = null;
    drawn = 0; cut = 0; dotsN = 0;
    var Fe = Fg + (1 - Fg) * foodHold, sgn = prog > 0 ? 1 : 0;
    for (w = 0; w < nW; w++) {
      var tb = time - WB[w];
      if (tb < 0) continue;
      var dying = WD[w] < LIVE, td = time - WD[w];
      if (dying && td > TD + DOTOUT) continue;
      var g = GEO[WG[w]]; if (!g) continue;
      var Fw = Fe, rv = time - WRV[w];
      if (rv >= 0 && rv < 1.25) {                                   // the tap beat: stretch out, flip ends at full length, slurp back, grow out
        if (rv < 0.25) Fw = Fe + (1 - Fe) * smooth(0, 0.25, rv);
        else { if (WFP[w]) { WREV[w] ^= 1; WFP[w] = 0; } var u = (rv - 0.25) / 1.0; Fw = (1 - 0.85 * Math.sin(Math.PI * u)) * (1 - smooth(0, 1, u)) + Fe * smooth(0, 1, u); }
      } else if (rv >= 1.25 && WFP[w]) { WREV[w] ^= 1; WFP[w] = 0; }
      var f = Math.min(Fw, smooth(0, TG, tb));
      if (dying) f = Math.min(f, 1 - smooth(0, TD, td));
      var ds = Math.min(smooth(0, 0.18, tb), dying ? 1 - smooth(TD, TD + DOTOUT, td) : 1);
      var n = WN[w], s = WS[w], vis = f * (n - 1), kmax = Math.floor(vis), frac = vis - kmax, head = (sgn ^ WREV[w]) === 1;
      var b = Math.round(clamp(WLR[w] * f, 0, 1) * (NB - 1)), slot = WG[w] * NB + b, path = PATHS[slot];
      for (m = 0; m < g.nImg; m++) {
        var c0 = WC[s + (head ? n - 1 : 0)], f0 = g.IMG[c0 * g.nImg + m], x0 = g.PX[f0], y0 = g.PY[f0];
        if (sbOn && sbAt(x0, y0)) { cut++; continue; }
        var segs = 0, lx = x0, ly = y0;
        for (k = 1; k <= kmax && k < n; k++) {
          var fc = g.IMG[WC[s + (head ? n - 1 - k : k)] * g.nImg + m], px = g.PX[fc], py = g.PY[fc];
          if (sbOn && sbAt(px, py)) { cut++; break; }
          if (!segs) { if (!path) path = PATHS[slot] = new Path2D(); path.moveTo(x0, y0); }
          path.lineTo(px, py); segs++; lx = px; ly = py;
        }
        if (k > kmax && frac > 0.002 && kmax + 1 < n) {             // the growing tip, part way into the next cell
          var fn = g.IMG[WC[s + (head ? n - 2 - kmax : kmax + 1)] * g.nImg + m], qx = lx + (g.PX[fn] - lx) * frac, qy = ly + (g.PY[fn] - ly) * frac;
          if (!(sbOn && sbAt(qx, qy))) { if (!segs) { if (!path) path = PATHS[slot] = new Path2D(); path.moveTo(x0, y0); } path.lineTo(qx, qy); segs++; }
        }
        if (segs) drawn++;
        else if (ds > 0.02) {                                       // a dot (his p.point with a round cap), ringed when hollow
          var dp = DOTS[slot] || (DOTS[slot] = new Path2D()), r = g.th * 0.5 * ds;
          dp.moveTo(x0 + r, y0); dp.arc(x0, y0, r, 0, TAU); dotsN++;
          if (g.inner > 0.3) { var di = DOTIN[WG[w]] || (DOTIN[WG[w]] = new Path2D()), ri = g.inner * 0.5 * ds; di.moveTo(x0 + ri, y0); di.arc(x0, y0, ri, 0, TAU); }
        }
      }
    }
    ctx.lineCap = 'round';
    for (var gi = 0; gi < 4; gi++) {
      var G = GEO[gi]; if (!G) continue;
      ctx.lineJoin = G.join; ctx.lineWidth = G.th;
      for (b = 0; b < NB; b++) { if (PATHS[gi * NB + b]) { ctx.strokeStyle = COLS[b]; ctx.stroke(PATHS[gi * NB + b]); } if (DOTS[gi * NB + b]) { ctx.fillStyle = COLS[b]; ctx.fill(DOTS[gi * NB + b]); } }
      if (G.inner > 0.3) {
        ctx.lineWidth = G.inner; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000';
        for (b = 0; b < NB; b++) if (PATHS[gi * NB + b]) ctx.stroke(PATHS[gi * NB + b]);
        if (DOTIN[gi]) ctx.fill(DOTIN[gi]);
      }
    }
  }

  function frame(dt, now) {
    if (dead) return;
    var t0 = performance.now(), nowMs = Number.isFinite(now) ? now : performance.now();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
    hueFlow.step(settings.hue, dt);
    stepColours(dt, hueFlow.value);
    var rows = rowsFor(), len = lenFor();
    if ((settings.look !== lastLook || rows !== lastRows || len !== lastLen) && time - lastGlobal > 0.35) globalRegen([W / 2, H / 2], settings.look !== lastLook || rows !== lastRows);
    body.update(dt, nowMs);
    bodyCount = body.fresh ? body.people.length : 0;
    updateSB(nowMs);
    if (sbOn || bprevAny) bodyReplan();
    updateHands(input.read(), dt);
    stepClock(dt);
    if (frames % 90 === 0 && (nC > POOLC * 0.5 || nW > MAXW * 0.5)) compact();
    render();
    frameMs = performance.now() - t0;
  }
  function resize(w, h) { if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return; size = [w, h]; }
  var LIM = {look: [0, LOOKS.length - 1], grid: [30, 200], length: [10, 300], speed: [0, 300], hue: [0, 360]};
  function set(o) {
    if (o && typeof o === 'object') Object.keys(LIM).forEach(function(key) {
      var v = o[key];
      if (typeof v === 'number' && Number.isFinite(v)) settings[key] = key === 'look' ? Math.round(clamp(v, LIM[key][0], LIM[key][1])) : clamp(v, LIM[key][0], LIM[key][1]);
    });
    return Object.assign({}, settings);
  }
  function destroy() {
    if (dead) return; dead = true;
    tracks = []; planned = []; input.clear(); kit.wantDepth(false);
    GEO = [null, null, null, null]; nW = 0; nC = 0;
    if (window.WormsSet === set) delete window.WormsSet;
  }
  resize(canvas.width, canvas.height);
  kit.wantDepth(true);
  window.WormsSet = set; if (window._wormsFx) set(window._wormsFx);
  hueFlow.snap(settings.hue);
  clockX = LOOKS[settings.look].start * 0.005;
  globalRegen(null, true);
  var out = {frame: frame, touch: function(t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
  if (window.WallTest) out.debug = function() {
    var live = 0, snails = 0, rev = 0, dyingN = 0;
    for (var w = 0; w < nW; w++) { if (WD[w] >= LIVE) { live++; snails += WSN[w]; rev += WREV[w]; } else dyingN++; }
    var g = GEO[geoCur], near = null;
    if (tracks[0] && g) {                                            // how many live worm heads end within 3 cells of the first hand
      var hx = tracks[0].x * W, hy = tracks[0].y * H, cnt = 0;
      for (w = 0; w < nW; w++) if (WD[w] >= LIVE && WG[w] === geoCur && WN[w] > 1) { var p = domPx(g, WC[WS[w] + WN[w] - 1]); if (Math.hypot(p[0] - hx, p[1] - hy) < 3 * g.cw) cnt++; }
      near = cnt;
    }
    return {frames: frames, frameMs: frameMs, look: LOOKS[settings.look].name, rows: g ? g.R : 0, cols: g ? g.C : 0, len: curLen, worms: live, dying: dyingN, poolCells: nC,
      drawn: drawn, dots: dotsN, cut: cut, F: Fg, foodHold: foodHold, contacts: tracks.length, headsAtHand: near, held: holdsAlive, snails: snails, reversed: rev, taps: taps,
      regens: regens, foodReplans: foodReplans, holdReplans: holdReplans, bodyReplans: bodyReplans, wanderReplans: wanderReplans, bodyCount: bodyCount, bodyBins: sbCount,
      displayHue: hueFlow.value, settings: set(), destroyed: dead};
  };
  return out;
}
})();
