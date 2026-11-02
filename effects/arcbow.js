/* Arc Bow (genart lab, batch 2, 2026-10-22).
   After "arcs" by Maksim Vasilyev, p5-experiments (https://github.com/vasilyev-maksim/p5-experiments), CC BY-NC 4.0; studio use, non-commercial.
   The sixth pattern (the zigzag joiner) is after his "zigzags" sketch from the same repository, same licence.
   Our own code on the plugins.js host (no p5): the algorithm and the looks, not his TypeScript.

   Points are spaced along a frame inset from the wall's border; the pattern type decides which border point joins which, and every joint
   is drawn as a half-ellipse arc whose curvature oscillates in time (the author's dynamic / inverted / static curvature, oscillateBetween).
   Stroke colour follows the author: flat arcs take one colour of the look's pair, deep arcs the other (a near-black end is lifted for the projector).
   Hero: a hand bends the arcs. Every arc's apex is pulled toward the nearest fingertip (strength by distance), so the bundle pinches through
   the hand and a sweep drags the whole figure; two hands split the bundle between them. Tap (a short touch, on release) = the next pattern
   (#1..#5, then the zigzag joiner) with a 0.6 s morph: the joints slide along the border to their new partners. Hold = rings of inverted
   colour grow out of the hand. Walk = the silhouette repels curvature: an arc that would cross a person is dented around them along its
   own normal (out to a margin), border points under a person slide along the border to free wall, and the silhouette itself is filled
   with the ground, so each person stands in a clear eye. Idle = the author's oscillation.
   Geometry: each arc is the unit half-circle under one affine map (chord + sheared apex), built with setTransform and stroked untransformed,
   batched one path per colour bucket; a dented arc is a 64-point polyline. Bodies: a 64 x 40 screen grid of the silhouette with a chamfer
   distance field (sphere-traced for the dents, marching squares for the eye). ASCII only. */
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

registerWallPlugin({id: 'arcbow', title: 'Arc Bow', author: 'Builder G (genart p5)', create: create});

var PI = Math.PI, DEG = PI / 180;
// the author's colour pairs (controls.ts COLOR): [dark-end colour, light-end colour] before the invert flag
var PAIRS = [[[0, 0, 255], [234, 114, 247]], [[252, 255, 57], [192, 74, 255]], [[24, 0, 95], [90, 255, 74]], [[255, 255, 255], [0, 0, 0]]];
// the author's presets (presets.ts): resolution, max curvature, max negative curvature, padding %, colour pair, invert, pattern, curvature type, time delta, start time
var LOOKS = [
  {name: 'touch',      r: 60, mc: 1,     mn: 0,     pad: 10, col: 0, inv: 0, pat: 0, ct: 0, td: 1,   t0: 236},
  {name: 'khachapuri', r: 18, mc: 1,     mn: 0,     pad: 40, col: 0, inv: 0, pat: 1, ct: 0, td: 1,   t0: 0},
  {name: 'croissant',  r: 6,  mc: 2,     mn: 0.6,   pad: 40, col: 0, inv: 0, pat: 0, ct: 0, td: 1,   t0: 0},
  {name: 'torus',      r: 60, mc: 0.8,   mn: 0,     pad: 30, col: 0, inv: 0, pat: 3, ct: 1, td: 1.5, t0: 0},
  {name: 'springs',    r: 20, mc: 0.1,   mn: 3,     pad: 45, col: 3, inv: 1, pat: 2, ct: 0, td: 1,   t0: 0},
  {name: 'flower',     r: 60, mc: 1.2,   mn: 0,     pad: 10, col: 1, inv: 0, pat: 2, ct: 0, td: 1.5, t0: 0},
  {name: 'cube',       r: 60, mc: 0.5,   mn: 1.5,   pad: 31, col: 0, inv: 0, pat: 2, ct: 2, td: 1,   t0: 0},
  {name: 'demogorgon', r: 30, mc: 0.9,   mn: 0.5,   pad: 45, col: 0, inv: 0, pat: 2, ct: 2, td: 1.2, t0: 0},
  {name: 'scars',      r: 6,  mc: 0.025, mn: 0.025, pad: 45, col: 2, inv: 0, pat: 1, ct: 2, td: 1,   t0: 0},
  {name: 'cotton',     r: 60, mc: 0.5,   mn: 0.5,   pad: 45, col: 1, inv: 0, pat: 4, ct: 2, td: 0.8, t0: 0},
  {name: 'jungle',     r: 24, mc: 0.7,   mn: 0.5,   pad: 45, col: 2, inv: 0, pat: 4, ct: 1, td: 1.2, t0: 0}
];
var NPAT = 6, ZIG = 5, MAXA = 640, NB = 10, K = 64;   // patterns #1..#5 + zigzag; arc cap; colour buckets; polyline points of a dented arc
var GW = 64, GH = 40, CELL = 20, MARGIN = 34;          // body grid (screen, 20 px cells) and the clear margin around a person (px)
var SIG = 300, PULL = 0.94;                            // hand reach (px) and how far an arc's apex goes to the finger

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }
function rgb(c) { return 'rgb(' + Math.round(clamp(c[0], 0, 255)) + ',' + Math.round(clamp(c[1], 0, 255)) + ',' + Math.round(clamp(c[2], 0, 255)) + ')'; }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
function hueRot(c, deg) {                                // the CSS hue-rotate matrix
  if (!deg) return c.slice();
  var a = Math.cos(deg * DEG), b = Math.sin(deg * DEG), r = c[0], g = c[1], bl = c[2];
  return [clamp((0.213 + 0.787 * a - 0.213 * b) * r + (0.715 - 0.715 * a - 0.715 * b) * g + (0.072 - 0.072 * a + 0.928 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a + 0.143 * b) * r + (0.715 + 0.285 * a + 0.140 * b) * g + (0.072 - 0.072 * a - 0.283 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a - 0.787 * b) * r + (0.715 - 0.715 * a + 0.715 * b) * g + (0.072 + 0.928 * a + 0.072 * b) * bl, 0, 255)];
}
function hslRgb(h) {                                     // fully saturated hue at 50 % lightness
  h = ((h % 360) + 360) % 360 / 60;
  var x = 1 - Math.abs(h % 2 - 1), r = 0, g = 0, b = 0;
  if (h < 1) { r = 1; g = x; } else if (h < 2) { r = x; g = 1; } else if (h < 3) { g = 1; b = x; } else if (h < 4) { g = x; b = 1; } else if (h < 5) { r = x; b = 1; } else { r = 1; b = x; }
  return [r * 255, g * 255, b * 255];
}
function shade(c, H) {                                   // colour shift: hue-rotate; achromatic colours (the white/black pair) are tinted instead
  var o = hueRot(c, H), mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  var achro = clamp(1 - (mx - mn) / 40, 0, 1), t = achro * 0.6 * (1 - Math.cos(H * DEG)) / 2;
  if (t > 0.001) { var tc = hslRgb(H), l = mx / 255; o = mix(o, [tc[0] * l, tc[1] * l, tc[2] * l], t); }
  return o;
}

// border-point pairs for the five pattern types (factory.ts), as [startFrom, startTo, endFrom, endTo, sign]
function intervals(pat, r) {
  var r2 = 2 * r, r3 = 3 * r, r4 = 4 * r;
  if (pat === 0 || pat === ZIG) return [[0, r, r2, r, 1], [r4, r3, r2, r3, -1]];
  if (pat === 1) return [[0, r2, r2, 0, 1], [r2, r4, r4, r2, 1]];
  if (pat === 2) return [[0, r, r, r2, 1], [r3, r4, r2, r3, -1], [r, r2, r2, r3, 1], [0, r, r3, r4, -1]];
  if (pat === 3) return [[0, r / 2, r2 + r * 3 / 4, r2 + r / 4, 1], [r, r / 2, r2 + r / 4, r2 + r * 3 / 4, -1], [r3, r2 + r / 2, r / 4, r - r / 4, -1], [r2, r2 + r / 2, r - r / 4, r / 4, 1]];
  return [[0, r / 2, r, r - r / 2, 1], [r, r / 2, r, r + r / 2, 1], [r, r + r / 2, r2, r2 - r / 2, 1], [r2, r + r / 2, r2, r2 + r / 2, 1],
          [r2, r2 + r / 2, r3, r3 - r / 2, 1], [r3, r2 + r / 2, r3, r3 + r / 2, 1], [r3, r3 + r / 2, 0, -r / 2, 1], [r4, r3 + r / 2, r4, r4 + r / 2, 1]];
}
function cyclic(start, end, len) {                       // the author's cyclicSubset (negative indexes wrap)
  var out = [], step = start < end ? 1 : -1, stop = Math.floor(end) + step;
  for (var i = Math.floor(start), guard = 0; i !== stop && guard < 4 * len + 8; i += step, guard++) out.push(((i % len) + len) % len);
  return out;
}
// joints of one pattern: qa / qb = border position as a fraction of the perimeter, sf = signed curvature factor (i/n, 1-i/n or 1)
function buildJoints(pat, r, ct) {
  var len = 4 * r, qa = [], qb = [], sf = [];
  intervals(pat, r).forEach(function(iv) {
    var st = cyclic(iv[0], iv[1], len), en = cyclic(iv[2], iv[3], len), n = st.length || 1;
    for (var i = 0; i < st.length; i++) {
      if (en[i] === undefined || st[i] === en[i]) continue;
      var f = ct === 0 ? i / n : ct === 1 ? 1 - i / n : 1;
      qa.push(st[i] / len); qb.push(en[i] / len); sf.push(f * iv[4]);
    }
  });
  return {n: Math.min(qa.length, MAXA), qa: qa, qb: qb, sf: sf};
}

function create(canvas, kit) {
  var ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Arc Bow needs Canvas 2D');
  var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0), dead = false;
  var settings = {look: 0, points: 60, bend: 100, hue: 0}, pointsOverride = false;
  var size = [canvas.width || 1280, canvas.height || 800], time = 0, frames = 0, frameMs = 0;
  var LK = LOOKS[0];
  // eased look parameters (the author animates his controls over ~25 frames; ours ease with tau 0.35 s)
  var P = {pad: LK.pad, mc: LK.mc, mn: LK.mn, td: LK.td, bend: 1}, phase = LK.t0 * 0.02, zt = LK.t0, zw = 0;
  var colA = [0, 0, 0], colB = [0, 0, 0], colT = null;
  var pat = LK.pat, res = LK.r, ctype = LK.ct;

  // --- joints: the shown set, and the morph between two sets (0.6 s)
  var cur = {n: 0, qa: new Float32Array(MAXA), qb: new Float32Array(MAXA), sf: new Float32Array(MAXA)};
  var from = {n: 0, qa: new Float32Array(MAXA), qb: new Float32Array(MAXA), sf: new Float32Array(MAXA)};
  var to = {n: 0, qa: new Float32Array(MAXA), qb: new Float32Array(MAXA), sf: new Float32Array(MAXA)};
  var morphT = 1, morphN = 0, morphs = 0;
  function loadTo() {
    var j = buildJoints(pat, res, ctype);
    to.n = j.n; for (var i = 0; i < j.n; i++) { to.qa[i] = j.qa[i]; to.qb[i] = j.qb[i]; to.sf[i] = j.sf[i]; }
  }
  function startMorph() {
    for (var i = 0; i < cur.n; i++) { from.qa[i] = cur.qa[i]; from.qb[i] = cur.qb[i]; from.sf[i] = cur.sf[i]; }
    from.n = cur.n; loadTo(); morphT = 0; morphs++;
    if (!from.n) morphT = 1;
  }
  function wrapq(q) { q = q % 1; return q < 0 ? q + 1 : q; }
  function stepMorph(dt) {
    var i;
    if (morphT >= 1) { cur.n = to.n; for (i = 0; i < to.n; i++) { cur.qa[i] = to.qa[i]; cur.qb[i] = to.qb[i]; cur.sf[i] = to.sf[i]; } return; }
    morphT = Math.min(1, morphT + dt / 0.6);
    var e = morphT < 0.5 ? 2 * morphT * morphT : 1 - Math.pow(-2 * morphT + 2, 2) / 2, N = Math.min(MAXA, Math.max(from.n, to.n));
    for (var k = 0; k < N; k++) {
      var a = Math.min(from.n - 1, Math.floor(k * from.n / N)), b = Math.min(to.n - 1, Math.floor(k * to.n / N));
      if (a < 0 || b < 0) continue;
      var da = ((to.qa[b] - from.qa[a] + 1.5) % 1) - 0.5, db = ((to.qb[b] - from.qb[a] + 1.5) % 1) - 0.5;
      cur.qa[k] = wrapq(from.qa[a] + da * e); cur.qb[k] = wrapq(from.qb[a] + db * e); cur.sf[k] = from.sf[a] + (to.sf[b] - from.sf[a]) * e;
    }
    cur.n = N; morphN = N;
  }

  // --- the frame (wall border inset by the look's padding) and a border position -> point
  var FX0 = 0, FY0 = 0, FW = 1280, FH = 800, DIAG = 1500, pt = [0, 0];
  function framePt(q) {
    var p = wrapq(q) * 4, side = Math.floor(p), f = p - side;
    if (side === 0) { pt[0] = FX0 + f * FW; pt[1] = FY0; }
    else if (side === 1) { pt[0] = FX0 + FW; pt[1] = FY0 + f * FH; }
    else if (side === 2) { pt[0] = FX0 + FW - f * FW; pt[1] = FY0 + FH; }
    else { pt[0] = FX0; pt[1] = FY0 + FH - f * FH; }
    return pt;
  }

  // --- bodies: screen grid of the silhouette and its signed distance (px; + outside, - inside)
  var MAPG = new Int32Array(GW * GH).fill(-1), mapAt = -1e9, OCC = new Uint8Array(GW * GH), DO = new Float32Array(GW * GH), DI = new Float32Array(GW * GH);
  var SDF = new Float32Array(GW * GH).fill(1e4), bodyOn = false, bodySeen = -1e9, bodyCount = 0, bodyArcs = 0;
  function buildMapG(nowMs) {
    if (nowMs - mapAt < 2000) return;
    mapAt = nowMs;
    for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) {
      var x = (gx + 0.5) / GW, y = (gy + 0.5) / GH, p = kit.fromScreen(x, y);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) p = [x * 512, y * 424];
      var cx = Math.floor(p[0] / 4), cy = Math.floor(p[1] / 4);
      MAPG[gy * GW + gx] = cx >= 0 && cx < body.w && cy >= 0 && cy < body.h ? cy * body.w + cx : -1;
    }
  }
  function chamfer(d) {
    var x, y, i, R2 = 1.4142, v;
    for (y = 0; y < GH; y++) for (x = 0; x < GW; x++) { i = y * GW + x; if (!d[i]) continue; v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) { v = Math.min(v, d[i - GW] + 1); if (x > 0) v = Math.min(v, d[i - GW - 1] + R2); if (x < GW - 1) v = Math.min(v, d[i - GW + 1] + R2); }
      d[i] = v; }
    for (y = GH - 1; y >= 0; y--) for (x = GW - 1; x >= 0; x--) { i = y * GW + x; if (!d[i]) continue; v = d[i];
      if (x < GW - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < GH - 1) { v = Math.min(v, d[i + GW] + 1); if (x < GW - 1) v = Math.min(v, d[i + GW + 1] + R2); if (x > 0) v = Math.min(v, d[i + GW - 1] + R2); }
      d[i] = v; }
  }
  function updateBodyGrid(nowMs) {
    var live = body.present || body.people.length > 0;
    if (live) bodySeen = time;
    bodyOn = time - bodySeen < 0.6;
    if (!bodyOn) return;
    buildMapG(nowMs);
    var mask = body.mask, any = false, i;
    for (i = 0; i < GW * GH; i++) { var c = MAPG[i], on = c >= 0 && mask[c] > 0.5 ? 1 : 0; OCC[i] = on; if (on) any = true; DO[i] = on ? 0 : 1e6; DI[i] = on ? 1e6 : 0; }
    if (!any) { SDF.fill(1e4); bodyOn = false; return; }
    chamfer(DO); chamfer(DI);
    for (i = 0; i < GW * GH; i++) SDF[i] = OCC[i] ? -(DI[i] - 0.5) * CELL : (DO[i] - 0.5) * CELL;
  }
  function sdfAt(x, y) {                                 // bilinear, design px in, px out; off the wall = free
    if (x < 0 || x > 1280 || y < 0 || y > 800) return 1e4;
    var gx = x / CELL - 0.5, gy = y / CELL - 0.5;
    if (gx < 0) gx = 0; if (gy < 0) gy = 0; if (gx > GW - 1.001) gx = GW - 1.001; if (gy > GH - 1.001) gy = GH - 1.001;
    var ix = gx | 0, iy = gy | 0, fx = gx - ix, fy = gy - iy, o = iy * GW + ix;
    var a = SDF[o], b = SDF[o + 1], c = SDF[o + GW], d = SDF[o + GW + 1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  var MW = GW + 2, FV = new Float32Array(MW * (GH + 2)), ISO = MARGIN * 0.45, EQX = new Float32Array(4), EQY = new Float32Array(4), EQV = new Float32Array(4);
  function eyePath() {                                    // the clear eye: the silhouette (+ a little) as one crisp marching-squares fill
    var i, j, any = false;
    for (j = 0; j < GH + 2; j++) for (i = 0; i < MW; i++) {
      var gx = clamp(i - 1, 0, GW - 1), gy = clamp(j - 1, 0, GH - 1), v = SDF[gy * GW + gx] - ISO, x = (i - 0.5) * CELL, y = (j - 0.5) * CELL;
      if (v < 0) { any = true; for (var f = 0; f < nF; f++) { var dx = x - FXS[f], dy = y - FYS[f]; if (dx * dx + dy * dy < 8100) { v = 1; break; } } }
      FV[j * MW + i] = v;
    }
    if (!any) return false;
    ctx.beginPath();
    for (j = 0; j < GH + 1; j++) for (i = 0; i < MW - 1; i++) {
      var a = FV[j * MW + i], b = FV[j * MW + i + 1], c = FV[(j + 1) * MW + i + 1], d = FV[(j + 1) * MW + i];
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) continue;
      var x0 = (i - 0.5) * CELL, y0 = (j - 0.5) * CELL, x1 = x0 + CELL, y1 = y0 + CELL;
      if (a < 0 && b < 0 && c < 0 && d < 0) { ctx.rect(x0, y0, CELL, CELL); continue; }
      var cx = EQX, cy = EQY, cv = EQV, first = true;
      cx[0] = x0; cx[1] = x1; cx[2] = x1; cx[3] = x0; cy[0] = y0; cy[1] = y0; cy[2] = y1; cy[3] = y1; cv[0] = a; cv[1] = b; cv[2] = c; cv[3] = d;
      for (var k = 0; k < 4; k++) {
        var n = (k + 1) & 3, va = cv[k], vb = cv[n];
        if (va < 0) { if (first) { ctx.moveTo(cx[k], cy[k]); first = false; } else ctx.lineTo(cx[k], cy[k]); }
        if ((va < 0) !== (vb < 0)) { var t = va / (va - vb), px = cx[k] + (cx[n] - cx[k]) * t, py = cy[k] + (cy[n] - cy[k]) * t;
          if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py); }
      }
      ctx.closePath();
    }
    return true;
  }

  // --- hands: tracks, taps (short touches, fired on release), holds (rings of inverted colour)
  var tracks = [], fades = [], rings = [], nextTid = 1, taps = 0, lastTap = -9, live = [];
  var tapInput = tapGesture(kit, input, 350);
  function updateTracks(pts, dt) {
    var i, t;
    var st = input.state, stamp = st === 'fresh' && kit.fingers && Number.isFinite(kit.fingers.t) ? kit.fingers.t : st === 'sparse' ? -1 : -3;
    for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], best = null, bd = 0.12;
      for (var j = 0; j < tracks.length; j++) { var q = tracks[j]; if (q.seen) continue; var d = Math.hypot(q.wx - p[0], q.wy - p[1]); if (d < bd) { bd = d; best = q; } }
      if (!best) { best = {id: nextTid++, wx: p[0], wy: p[1], x: p[0] * 1280, y: p[1] * 800, e: 0, born: time, bx: p[0], by: p[1], travel: 0, ax: p[0], ay: p[1], still: 0, held: false, ringAt: 0, reports: 0, stamp: -2}; tracks.push(best); }
      best.seen = true; best.wx = p[0]; best.wy = p[1]; tapInput.observe(best, p[0], p[1]);
      if (stamp === -1 || (stamp >= 0 && stamp !== best.stamp)) { best.reports++; best.stamp = stamp; }   // distinct Kinect reports: one is a hover flicker, not a tap
      best.travel = Math.max(best.travel, Math.hypot(p[0] - best.bx, p[1] - best.by));
      if (Math.hypot(p[0] - best.ax, p[1] - best.ay) > 0.02) { best.ax = p[0]; best.ay = p[1]; best.still = 0; } else best.still += dt;
    }
    for (i = tracks.length - 1; i >= 0; i--) {
      t = tracks[i];
      if (t.seen) continue;
      if (tapInput.release(t)) { lastTap = time; taps++; pat = (pat + 1) % NPAT; startMorph(); }
      fades.push({x: t.x, y: t.y, e: t.e}); if (fades.length > 8) fades.shift();
      tracks.splice(i, 1);
    }
    var kp = ease(dt, 0.05), ke = ease(dt, 0.12);
    tracks.forEach(function(q) {
      q.x += (q.wx * 1280 - q.x) * kp; q.y += (q.wy * 800 - q.y) * kp; q.e += (1 - q.e) * ke;
      var was = q.held; q.held = q.still >= 0.9;
      if (q.held && (!was || time - q.ringAt > 2.6)) { q.ringAt = time; rings.push({x: q.x, y: q.y, r: 6, w: 46, alive: true}); if (rings.length > 6) rings.shift(); }
    });
    for (i = fades.length - 1; i >= 0; i--) { fades[i].e *= Math.exp(-dt / 0.45); if (fades[i].e < 0.02) fades.splice(i, 1); }
    for (i = rings.length - 1; i >= 0; i--) { var g = rings[i]; g.r += dt * 210; if (g.r - g.w > 1550) rings.splice(i, 1); }
    live = tracks.concat(fades);
  }

  // --- per-arc geometry (design px): chord midpoint, unit chord direction, half-length, apex shear and bulge, colour bucket
  var MX = new Float32Array(MAXA), MY = new Float32Array(MAXA), UX = new Float32Array(MAXA), UY = new Float32Array(MAXA), HL = new Float32Array(MAXA);
  var SS = new Float32Array(MAXA), HH = new Float32Array(MAXA), BK = new Uint8Array(MAXA), maxPull = 0, nArcs = 0;
  var AX = new Float32Array(MAXA), AY = new Float32Array(MAXA), BX = new Float32Array(MAXA), BY = new Float32Array(MAXA);
  // bodies dent the arcs: an arc that would cross a silhouette is drawn as a K-point polyline pushed along its normal, out to the margin
  var PX = new Float32Array(MAXA * K), PY = new Float32Array(MAXA * K), NX = new Float32Array(MAXA * K), NY = new Float32Array(MAXA * K);   // samples + local normals
  var DEN = new Float32Array(MAXA * K), POLY = new Uint8Array(MAXA), SIDE = new Int8Array(MAXA);
  var RP = new Float32Array(K), RM = new Float32Array(K), SM = new Float32Array(K), CT = new Float32Array(K), ST = new Float32Array(K);
  for (var k0 = 0; k0 < K; k0++) { var t0 = PI * (1 - k0 / (K - 1)); CT[k0] = Math.cos(t0); ST[k0] = Math.sin(t0); }
  var FXS = new Float32Array(16), FYS = new Float32Array(16), nF = 0;   // fingers keep a free zone: a hand on the wall still gathers its arcs
  function nearFinger(x, y) { for (var f = 0; f < nF; f++) { var dx = x - FXS[f], dy = y - FYS[f]; if (dx * dx + dy * dy < 12100) return true; } return false; }
  function clearance(x, y, dx, dy) {                      // how far along (dx, dy) until the point is MARGIN clear of every body (sphere tracing)
    var t = 0;
    for (var i = 0; i < 48; i++) {
      var sd = sdfAt(x + dx * t, y + dy * t);
      if (sd >= MARGIN) return t;
      t += Math.max(5, sd < 0 ? -sd : MARGIN - sd);
      if (t > 640) return 640;
    }
    return 640;
  }
  function dent(k, kd) {
    var o = k * K, need = false, cp = 0, cm = 0, j, x, y;
    for (j = 0; j < K; j++) { RP[j] = 0; RM[j] = 0; }
    if (bodyOn) for (j = 1; j < K - 1; j++) {
      x = PX[o + j]; y = PY[o + j];
      if (sdfAt(x, y) >= MARGIN || nearFinger(x, y)) continue;
      need = true;
      RP[j] = clearance(x, y, NX[o + j], NY[o + j]); RM[j] = clearance(x, y, -NX[o + j], -NY[o + j]);
      if (RP[j] > cp) cp = RP[j]; if (RM[j] > cm) cm = RM[j];
    }
    var side = SIDE[k];
    if (need) { side = side > 0 ? (cp <= cm * 1.35 ? 1 : -1) : side < 0 ? (cm <= cp * 1.35 ? -1 : 1) : (cp <= cm ? 1 : -1); SIDE[k] = side; }
    var R = side > 0 ? RP : RM, sgn = side || 1, any = false, dmax = 0;
    for (j = 0; j < K; j++) SM[j] = need ? R[j] : 0;
    for (j = 1; j < K; j++) if (SM[j - 1] * 0.82 > SM[j]) SM[j] = SM[j - 1] * 0.82;             // soft shoulders both ways
    for (j = K - 2; j >= 0; j--) if (SM[j + 1] * 0.82 > SM[j]) SM[j] = SM[j + 1] * 0.82;
    for (var pass = 0; pass < 2; pass++) { var prev = SM[0]; for (j = 1; j < K - 1; j++) { var c = SM[j]; SM[j] = (prev + 2 * c + SM[j + 1]) / 4; prev = c; } }
    SM[0] = 0; SM[K - 1] = 0;
    if (need) for (j = 1; j < K - 1; j++) if (SM[j] < R[j]) SM[j] = R[j];   // never less than the sample's own clearance
    for (j = 0; j < K; j++) {
      var tg = sgn * SM[j], v = DEN[o + j] + (tg - DEN[o + j]) * kd;
      if (need && SM[j] > 0.5 && v !== tg) {             // eased, but never left lagging inside a body: then it goes straight to the target
        var ex = PX[o + j] + NX[o + j] * v, ey = PY[o + j] + NY[o + j] * v;
        if (sdfAt(ex, ey) < MARGIN * 0.5 && !nearFinger(ex, ey)) v = tg;
      }
      if (Math.abs(v) < 0.2 && Math.abs(tg) < 0.2) v = 0;
      DEN[o + j] = v; if (v) any = true; if (Math.abs(v) > dmax) dmax = Math.abs(v);
    }
    POLY[k] = any ? 1 : 0;
    if (!any && !need) SIDE[k] = 0;
    return dmax;
  }
  function slideQ(q) {
    var p = framePt(q);
    if (sdfAt(p[0], p[1]) >= MARGIN + 6) return q;
    for (var i = 1; i <= 160; i++) {
      p = framePt(q + i * 0.002); if (sdfAt(p[0], p[1]) >= MARGIN + 6) return wrapq(q + i * 0.002);
      p = framePt(q - i * 0.002); if (sdfAt(p[0], p[1]) >= MARGIN + 6) return wrapq(q - i * 0.002);
    }
    return q;
  }
  function geometry(dt) {
    var osc = (Math.sin(phase) + 1) / 2, mc = P.mc * P.bend, mn = P.mn * P.bend, kd = ease(dt, 0.07), pushed = 0, mp = 0, n = cur.n, k, f, j;
    nF = 0;
    for (f = 0; f < tracks.length && nF < 16; f++) if (tracks[f].e > 0.3) { FXS[nF] = tracks[f].x; FYS[nF] = tracks[f].y; nF++; }
    for (k = 0; k < n; k++) {
      var qa = cur.qa[k], qb = cur.qb[k];
      if (bodyOn) { qa = slideQ(qa); qb = slideQ(qb); }   // a border point under a person slides along the border to free wall
      var a = framePt(qa), ax = a[0], ay = a[1], b = framePt(qb), bx = b[0], by = b[1];
      AX[k] = ax; AY[k] = ay; BX[k] = bx; BY[k] = by;
      var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
      if (len < 0.5) { HL[k] = 0; POLY[k] = 0; continue; }
      var ux = dx / len, uy = dy / len, mx = (ax + bx) / 2, my = (ay + by) / 2, L = len / 2;
      MX[k] = mx; MY[k] = my; UX[k] = ux; UY[k] = uy; HL[k] = L;
      var dtd = cur.sf[k] * DIAG; if (!dtd) dtd = 1;
      var h = dtd * (osc * (mc + mn) - mn) / 2, s = 0;   // the author's curvature is the ellipse's full height: the bulge is half of it
      // hands: pull the apex toward the nearest fingertip (strength by distance); two hands split the bundle
      if (live.length) {
        var apx = mx - uy * h, apy = my + ux * h, sw = 0, tx = 0, ty = 0, wmax = 0, lw = clamp(L / 120, 0, 1);
        for (f = 0; f < live.length; f++) {
          var q = live[f], d1 = Math.hypot(q.x - apx, q.y - apy), d2 = Math.hypot(q.x - mx, q.y - my), d = Math.min(d1, d2);
          var w = q.e * lw * lw * (3 - 2 * lw) * Math.exp(-(d * d) / (SIG * SIG));
          if (w < 0.002) continue;
          var w4 = w * w * w * w; sw += w4; tx += q.x * w4; ty += q.y * w4; if (w > wmax) wmax = w;
        }
        if (sw > 1e-12) {
          tx /= sw; ty /= sw;
          var ts = (tx - mx) * ux + (ty - my) * uy, th = -(tx - mx) * uy + (ty - my) * ux, wp = wmax * PULL;
          ts = clamp(ts, -1.3 * L, 1.3 * L);
          s += (ts - s) * wp; h += (th - h) * wp;
          if (wmax > mp) mp = wmax;
        }
      }
      if (Math.abs(h) < 0.5) h = h < 0 ? -0.5 : 0.5;     // a non-invertible transform would drop the arc
      SS[k] = s; HH[k] = h;
      var deep = Math.abs(2 * h);
      if (bodyOn || POLY[k]) {                            // bodies: sample the arc, dent it around any silhouette it would cross
        var o = k * K;
        for (j = 0; j < K; j++) {
          var ca = L * CT[j] + s * ST[j], cb = h * ST[j], ta = -L * ST[j] + s * CT[j], tb = h * CT[j];
          var tx2 = ux * ta - uy * tb, ty2 = uy * ta + ux * tb, tl = Math.hypot(tx2, ty2);
          PX[o + j] = mx + ux * ca - uy * cb; PY[o + j] = my + uy * ca + ux * cb;
          if (tl > 1e-6) { NX[o + j] = -ty2 / tl; NY[o + j] = tx2 / tl; } else { NX[o + j] = -uy; NY[o + j] = ux; }
        }
        var dm = dent(k, kd);
        if (POLY[k]) { pushed++; deep += dm; }
      }
      BK[k] = Math.round(clamp(1 - deep / DIAG, 0, 1) * (NB - 1));
    }
    for (k = n; k < MAXA; k++) POLY[k] = 0;
    nArcs = n; bodyArcs = pushed; maxPull = mp;
  }

  // --- look, knobs and colours
  function applyLook(i, initial) {
    LK = LOOKS[i]; pat = LK.pat; ctype = LK.ct; pointsOverride = false; res = LK.r;
    if (initial) { P.pad = LK.pad; P.mc = LK.mc; P.mn = LK.mn; P.td = LK.td; phase = LK.t0 * 0.02; zt = LK.t0; zw = pat === ZIG ? 1 : 0; }
  }
  function targetColours() {
    var pr = PAIRS[LK.col];
    return LK.inv ? [pr[1], pr[0]] : [pr[0], pr[1]];      // [deep-arc colour, flat-arc colour]
  }
  function stepLook(dt) {
    var k = ease(dt, 0.35);
    P.pad += (LK.pad - P.pad) * k; P.mc += (LK.mc - P.mc) * k; P.mn += (LK.mn - P.mn) * k; P.td += (LK.td - P.td) * k;
    P.bend += (settings.bend / 100 - P.bend) * k;
    var tc = targetColours();
    if (!colT) { colA = tc[0].slice(); colB = tc[1].slice(); colT = true; }
    colA = mix(colA, tc[0], k); colB = mix(colB, tc[1], k);
    zw += ((pat === ZIG ? 1 : 0) - zw) * ease(dt, 0.2);
    var pad = clamp(P.pad, 0, 50) / 100 * 0.7;            // the author's padding, a little tighter so the small looks still fill the wall
    FW = 1280 * (1 - pad); FH = 800 * (1 - pad); FX0 = (1280 - FW) / 2; FY0 = (800 - FH) / 2; DIAG = Math.hypot(FW, FH);
    phase += dt * 1.2 * P.td; if (phase > 1e5) phase -= 2 * PI * 15000;
    zt += dt * 60 * P.td; if (zt > 1e6) zt -= 120 * 8000;
  }
  var palette = {deep: [0, 0, 0], flat: [0, 0, 0], ground: '', ink: '', accent: '', buckets: []};
  function colours() {
    var H = hueFlow.value, A = shade(colA, H), B = shade(colB, H), la = lum(A), lb = lum(B);
    var dark = la < lb ? A : B, light = la < lb ? B : A, ld = lum(dark), ll = lum(light);
    var lift = ld < 0.22 && ll > ld ? clamp((0.22 - ld) / (ll - ld), 0, 0.6) : 0;   // a near-black stroke end stays readable on the projector
    if (la < lb) A = mix(A, B, lift); else B = mix(B, A, lift);
    palette.deep = A; palette.flat = B;
    for (var b = 0; b < NB; b++) palette.buckets[b] = rgb(mix(A, B, b / (NB - 1)));
    var g = shade(mix([0, 0, 0], la < lb ? colA : colB, 0.05), H);      // near-black, tinted by the pair's dark colour
    palette.ground = rgb([2 + g[0], 2 + g[1], 4 + g[2]]);
    palette.accent = rgb(lum(B) >= lum(A) ? B : A);
    palette.ink = palette.ground;
  }

  // --- drawing
  function emitArcs() {                                   // every arc into the current path (ring pass)
    for (var k = 0; k < nArcs; k++) emitArc(k);
  }
  var sxG = 1, syG = 1;
  function emitArc(k) {
    var L = HL[k]; if (!(L > 0)) return;
    var ux = UX[k], uy = UY[k], s = SS[k], h = HH[k];
    if (POLY[k]) {                                         // dented around a body: the sampled polyline, in design px
      var o = k * K;
      ctx.setTransform(sxG, 0, 0, syG, 0, 0); ctx.moveTo(PX[o] + NX[o] * DEN[o], PY[o] + NY[o] * DEN[o]);
      for (var j = 1; j < K; j++) ctx.lineTo(PX[o + j] + NX[o + j] * DEN[o + j], PY[o + j] + NY[o + j] * DEN[o + j]);
      return;
    }
    ctx.setTransform(sxG * ux * L, syG * uy * L, sxG * (ux * s - uy * h), syG * (uy * s + ux * h), sxG * MX[k], syG * MY[k]);
    ctx.moveTo(1, 0); ctx.arc(0, 0, 1, 0, PI, false);
  }
  var ZV = new Float32Array(2 * 96);
  function emitZigzags() {                                // the zigzag joiner: a staircase between the two joint points (zigzags.ts)
    var steps = Math.max(2, res / 3), n = Math.ceil(steps), drops = steps - 1, stepLen = 1 / steps, dropH = 1 / drops, tri = Math.abs((zt % 120) - 60) / 60;
    for (var k = 0; k < nArcs; k++) {
      if (!(HL[k] > 0)) continue;
      var ax = AX[k], ay = AY[k], dx = BX[k] - ax, dy = BY[k] - ay;
      var a0 = PI / 2 + Math.atan(Math.abs(dx) / Math.max(1e-6, Math.abs(dy))), ang = a0 + (PI / 4 - a0) * tri, tn = Math.tan(ang);
      if (Math.abs(tn) < 0.05) tn = tn < 0 ? -0.05 : 0.05;
      var shift = dropH / tn / 2, m = 0;
      for (var i = 0; i < n && m < 190; i++) {
        ZV[m++] = i * stepLen - (i === 0 ? 0 : shift); ZV[m++] = i * dropH;
        ZV[m++] = (i + 1) * stepLen + (i === n - 1 ? 0 : shift); ZV[m++] = i * dropH;
      }
      for (var v = 0; v < m; v += 2) {
        var x = ax + ZV[v] * dx, y = ay + ZV[v + 1] * dy, f, ox = 0, oy = 0;
        for (f = 0; f < live.length; f++) {               // a hand pulls the stairs toward it
          var q = live[f], ddx = q.x - x, ddy = q.y - y, w = q.e * Math.exp(-(ddx * ddx + ddy * ddy) / 52900) * 0.85 * P.bend;
          ox += ddx * w; oy += ddy * w;
        }
        x += ox; y += oy;
        if (bodyOn) {                                      // and a body pushes them out of its outline
          var sd = sdfAt(x, y);
          if (sd < MARGIN) { var gx = sdfAt(x + 8, y) - sdfAt(x - 8, y), gy = sdfAt(x, y + 8) - sdfAt(x, y - 8), gl = Math.hypot(gx, gy);
            if (gl > 1e-3) { x += gx / gl * (MARGIN - sd); y += gy / gl * (MARGIN - sd); } }
        }
        if (v) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
    }
  }
  function render() {
    var w = size[0], h = size[1], k, b;
    sxG = w / 1280; syG = h / 800;
    colours();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = palette.ground; ctx.fillRect(0, 0, w, h);
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.miterLimit = 4;
    var lw = 2.4;
    if (zw < 0.995) {                                      // arcs, one path per colour bucket
      ctx.globalAlpha = 1 - zw;
      for (b = 0; b < NB; b++) {
        var any = false;
        ctx.beginPath();
        for (k = 0; k < nArcs; k++) if (BK[k] === b) { emitArc(k); any = true; }
        if (!any) continue;
        ctx.setTransform(sxG, 0, 0, syG, 0, 0); ctx.lineWidth = lw; ctx.strokeStyle = palette.buckets[b]; ctx.stroke();
      }
    }
    if (zw > 0.005) {
      ctx.globalAlpha = zw; ctx.setTransform(sxG, 0, 0, syG, 0, 0); ctx.beginPath(); emitZigzags();
      ctx.lineWidth = lw; ctx.strokeStyle = palette.buckets[NB - 1]; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (bodyOn) { ctx.setTransform(sxG, 0, 0, syG, 0, 0); if (eyePath()) { ctx.fillStyle = palette.ground; ctx.fill(); } }
    for (var i = 0; i < rings.length; i++) {               // hold: rings of inverted colour (accent ground, dark lines)
      var g = rings[i], ro = g.r + g.w / 2, ri = Math.max(0, g.r - g.w / 2);
      ctx.save();
      ctx.setTransform(sxG, 0, 0, syG, 0, 0); ctx.beginPath(); ctx.arc(g.x, g.y, ro, 0, 2 * PI, false);
      if (ri > 0.5) { ctx.moveTo(g.x + ri, g.y); ctx.arc(g.x, g.y, ri, 0, 2 * PI, true); }
      ctx.clip();
      ctx.fillStyle = palette.accent; ctx.fillRect(0, 0, 1280, 800);
      ctx.strokeStyle = palette.ink; ctx.lineWidth = lw * 1.25;
      if (zw < 0.995) { ctx.globalAlpha = 1 - zw; ctx.beginPath(); emitArcs(); ctx.setTransform(sxG, 0, 0, syG, 0, 0); ctx.stroke(); }
      if (zw > 0.005) { ctx.globalAlpha = zw; ctx.setTransform(sxG, 0, 0, syG, 0, 0); ctx.beginPath(); emitZigzags(); ctx.stroke(); }
      ctx.restore();
    }
    ctx.setTransform(sxG, 0, 0, syG, 0, 0); ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.accent; ctx.lineWidth = 2;   // fingertips: a small ring; a still finger draws its hold arc
    for (k = 0; k < tracks.length; k++) {
      var t = tracks[k], prog = t.held ? 1 : clamp((t.still - 0.25) / 0.65, 0, 1);
      ctx.globalAlpha = t.e; ctx.fillStyle = palette.ground; ctx.beginPath(); ctx.arc(t.x, t.y, 9, 0, 2 * PI); ctx.fill(); ctx.stroke();
      if (prog > 0 && !t.held) { ctx.beginPath(); ctx.arc(t.x, t.y, 17, -PI / 2, -PI / 2 + 2 * PI * prog); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }

  function frame(dt, now) {
    if (dead) return;
    var t0 = performance.now();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
    hueFlow.step(settings.hue, dt);
    stepLook(dt);
    body.update(dt, now);
    bodyCount = body.fresh ? body.people.length : 0;
    updateBodyGrid(now);
    updateTracks(input.read(), dt);
    stepMorph(dt);
    geometry(dt);
    render();
    frameMs = performance.now() - t0;
  }
  function resize(w, h) { if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return; size = [w, h]; }
  var LIM = {look: [0, LOOKS.length - 1], points: [4, 60], bend: [0, 200], hue: [0, 360]};
  function set(o) {
    if (o && typeof o === 'object') {
      var lk = o.look, pts = o.points;
      if (typeof lk === 'number' && Number.isFinite(lk)) {
        var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1]));
        if (li !== settings.look) { settings.look = li; applyLook(li, false); startMorph(); }
      }
      if (typeof pts === 'number' && Number.isFinite(pts)) {
        var pv = Math.round(clamp(pts, LIM.points[0], LIM.points[1]));
        if (pv !== settings.points) { settings.points = pv; pointsOverride = true; }
      }
      var want = pointsOverride ? settings.points : LK.r;
      if (want !== res) { res = want; startMorph(); }
      ['bend', 'hue'].forEach(function(k) { var v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) settings[k] = clamp(v, LIM[k][0], LIM[k][1]); });
    }
    return Object.assign({}, settings);
  }
  function destroy() {
    if (dead) return; dead = true;
    tracks = []; fades = []; rings = []; live = []; input.clear(); kit.wantDepth(false);
    if (window.ArcbowSet === set) delete window.ArcbowSet;
  }
  resize(canvas.width, canvas.height);
  kit.wantDepth(true);
  applyLook(0, true); loadTo(); morphT = 1; stepMorph(0);
  window.ArcbowSet = set; if (window._arcbowFx) set(window._arcbowFx);
  var ov = pointsOverride; applyLook(settings.look, true); pointsOverride = ov;   // start on the stored look without a morph
  res = ov ? settings.points : LK.r; loadTo(); morphT = 1; stepMorph(0);
  P.bend = settings.bend / 100; hueFlow.snap(settings.hue); colT = null;
  var out = {frame: frame, touch: function(t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
  function leaks() {                                     // test only: dented-arc points still inside a body (outside finger zones)
    var out = [], k, j;
    if (!bodyOn) return out;
    for (k = 0; k < nArcs; k++) {
      var o = k * K, bad = 0, first = -1, pl = POLY[k];
      for (j = 1; j < K - 1; j++) {
        var x, y;
        if (pl) { x = PX[o + j] + NX[o + j] * DEN[o + j]; y = PY[o + j] + NY[o + j] * DEN[o + j]; } else { var ca = HL[k] * CT[j] + SS[k] * ST[j], cb = HH[k] * ST[j]; x = MX[k] + UX[k] * ca - UY[k] * cb; y = MY[k] + UY[k] * ca + UX[k] * cb; }
        if (sdfAt(x, y) < -6 && !nearFinger(x, y)) { bad++; if (first < 0) first = j; }
      }
      if (bad) out.push([k, pl, bad, first, SIDE[k], Math.round(Math.max.apply(null, Array.prototype.slice.call(DEN, o, o + K).map(Math.abs)))]);
    }
    return out.slice(0, 20);
  }
  if (window.WallTest) out.debug = function() {
    return {frames: frames, frameMs: frameMs, look: LOOKS[settings.look].name, pattern: pat + 1, res: res, pointsOverride: pointsOverride, arcs: nArcs,
      morph: morphT, morphs: morphs, taps: taps, contacts: tracks.length, held: tracks.filter(function(t) { return t.held; }).length, rings: rings.length,
      maxPull: maxPull, bodyCount: bodyCount, bodyOn: bodyOn, bodyArcs: bodyArcs, zigzag: zw, phase: phase, displayHue: hueFlow.value,
      finite: Array.prototype.every.call(HH.subarray(0, nArcs), Number.isFinite), leaks: leaks(), settings: set(), destroyed: dead};
  };
  return out;
}
})();
