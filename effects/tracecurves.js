/* Trace (genart lab, batch 2, 2026-10-22).
   After "curve" by Maksim Vasilyev, p5-experiments (https://github.com/vasilyev-maksim/p5-experiments), CC BY-NC 4.0; studio use, non-commercial.
   Our own code on the plugins.js host (no p5): the algorithm and the looks, not his TypeScript.

   A stack of chaotic curves: one spline through a row of control points whose heights ride Perlin noise in time (chaos = how fast the
   noise runs, dispersion = how far the points may stray), copied up and down the wall at a fixed gap, the middle curve bright and its
   twins faint, with optional joint marks (square, circle, plus, cross) on the control points. The canvas is never cleared: a translucent
   black rect fades it every frame (the trace factor), so motion leaves tails. Our fade adds a 1/255 'difference' pass every second frame:
   an 8-bit alpha fade alone stalls at about 0.5/alpha (10 % grey at full trace), and those ghosts would silt up the wall.
   Hero: fingertips are joints. The curve nearest a fingertip routes through it, its neighbours pinch in after it with a lag that grows
   with their distance, the whole bundle shifts to meet the hand, and a drag paints. Tap (a short touch, on release) = a chaos burst that
   relaxes over 2 s (the points also fly wider for a moment). Hold = the trace lengthens in a disc that grows under the hand (local persistence); release and that disc clears.
   Walk = the curves rise over a body like hills: everything below the silhouette's top is folded into a band just above it.
   Idle = the author's slow noise drift. ASCII only. */
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

registerWallPlugin({id: 'tracecurves', title: 'Trace', author: 'Builder G (genart p5)', create: create});

var PI = Math.PI, DEG = PI / 180, W = 1280, H = 800, GS = 1280 / 1158;   // the author sizes gap and stroke for a 1158 px canvas
var COLS = [[255, 0, 0], [0, 251, 255], [54, 255, 31], [255, 255, 255]];
// the author's presets (presets.ts): resolution, curves, gap, colour, trace, dispersion, chaos, joint (0 none, 1 square, 2 circle, 3 plus, 4 cross), start time
var LOOKS = [
  {name: 'originality',  res: 23,  n: 37, gap: 22, col: 0, trace: 80,  disp: 0.2,  chaos: 3,   joint: 0, t0: 0},
  {name: 'isolines',     res: 10,  n: 49, gap: 50, col: 3, trace: 0,   disp: 1,    chaos: 0,   joint: 3, t0: 0},
  {name: 'ice plazma',   res: 5,   n: 49, gap: 10, col: 1, trace: 100, disp: 0.5,  chaos: 100, joint: 0, t0: 0},
  {name: 'hills',        res: 6,   n: 1,  gap: 10, col: 2, trace: 100, disp: 1,    chaos: 10,  joint: 0, t0: 476},
  {name: 'DnB',          res: 15,  n: 49, gap: 50, col: 0, trace: 82,  disp: 0.5,  chaos: 69,  joint: 0, t0: 0},
  {name: 'graphite',     res: 25,  n: 43, gap: 11, col: 3, trace: 37,  disp: 0.2,  chaos: 18,  joint: 1, t0: 0},
  {name: 'sunrise',      res: 5,   n: 1,  gap: 38, col: 0, trace: 100, disp: 0.45, chaos: 1,   joint: 0, t0: 100},
  {name: 'fluctuations', res: 100, n: 1,  gap: 24, col: 0, trace: 100, disp: 0.05, chaos: 75,  joint: 0, t0: 0},
  {name: 'deep network', res: 20,  n: 5,  gap: 30, col: 1, trace: 85,  disp: 0.5,  chaos: 55,  joint: 1, t0: 0}
];
var MID = 24, NC = 2 * MID + 1, DX = 6, NS = Math.ceil((W + 2 * DX) / DX) + 1, X0S = -DX;   // curve slots; the sample grid along x
var GW = 64, GH = 40, CELL = 20, MAXT = 6, SIGX = 170, RP = 150;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }
function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function hueRot(c, deg) {                                // the CSS hue-rotate matrix
  if (!deg) return c.slice();
  var a = Math.cos(deg * DEG), b = Math.sin(deg * DEG), r = c[0], g = c[1], bl = c[2];
  return [clamp((0.213 + 0.787 * a - 0.213 * b) * r + (0.715 - 0.715 * a - 0.715 * b) * g + (0.072 - 0.072 * a + 0.928 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a + 0.143 * b) * r + (0.715 + 0.285 * a + 0.140 * b) * g + (0.072 - 0.072 * a - 0.283 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a - 0.787 * b) * r + (0.715 - 0.715 * a + 0.715 * b) * g + (0.072 + 0.928 * a + 0.072 * b) * bl, 0, 255)];
}
function hslRgb(h) {
  h = ((h % 360) + 360) % 360 / 60;
  var x = 1 - Math.abs(h % 2 - 1), r = 0, g = 0, b = 0;
  if (h < 1) { r = 1; g = x; } else if (h < 2) { r = x; g = 1; } else if (h < 3) { g = 1; b = x; } else if (h < 4) { g = x; b = 1; } else if (h < 5) { r = x; b = 1; } else { r = 1; b = x; }
  return [r * 255, g * 255, b * 255];
}
function shade(c, Hd) {                                  // colour shift: hue-rotate; white is tinted instead (it has no hue to rotate)
  var o = hueRot(c, Hd), mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  var t = clamp(1 - (mx - mn) / 40, 0, 1) * 0.6 * (1 - Math.cos(Hd * DEG)) / 2;
  if (t > 0.001) { var tc = hslRgb(Hd), l = mx / 255; o = mix(o, [tc[0] * l, tc[1] * l, tc[2] * l], t); }
  return o;
}

// p5's noise(): 4 octaves of cosine-interpolated value noise over a 4096-entry table (seeded LCG here; the sketch uses seed 44)
function makeNoise(seed) {
  var P = new Float32Array(4096), s = seed >>> 0;
  for (var i = 0; i < 4096; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; P[i] = s / 4294967296; }
  function sc(v) { return 0.5 * (1 - Math.cos(v * PI)); }
  return function(x, y) {
    if (x < 0) x = -x; if (y < 0) y = -y;
    var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, r = 0, amp = 0.5;
    for (var o = 0; o < 4; o++) {
      var of = xi + (yi << 4), rx = sc(xf), ry = sc(yf);
      var n1 = P[of & 4095]; n1 += rx * (P[(of + 1) & 4095] - n1);
      var n2 = P[(of + 16) & 4095]; n2 += rx * (P[(of + 17) & 4095] - n2);
      n1 += ry * (n2 - n1);
      r += n1 * amp; amp *= 0.5;
      xi <<= 1; xf *= 2; yi <<= 1; yf *= 2;
      if (xf >= 1) { xi++; xf--; }
      if (yf >= 1) { yi++; yf--; }
    }
    return r;
  };
}

function create(canvas, kit) {
  var ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Trace needs Canvas 2D');
  var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0), dead = false, noise = makeNoise(44);
  var settings = {look: 8, curves: 5, trace: 85, chaos: 55, hue: 0}, over = {curves: false, trace: false, chaos: false};
  var size = [canvas.width || 1280, canvas.height || 800], time = 0, frames = 0, frameMs = 0, needClear = true;
  var LK = LOOKS[8];
  var P = {gap: LK.gap, disp: LK.disp, trace: LK.trace, chaos: LK.chaos, col: COLS[LK.col].slice()}, nt = 0, burst = 0, lookFade = 0;
  var VIS = new Float32Array(NC), res = LK.res, resFrom = LK.res, resT = 1, joint = LK.joint, jointFrom = 0, jointT = 1;

  // --- the base curve on a fixed x grid: Catmull-Rom through the noise control points (and a 0.6 s morph when the resolution changes)
  var XS = new Float32Array(NS), BASE = new Float32Array(NS), CP = new Float32Array(128), CPX = new Float32Array(128);
  for (var s0 = 0; s0 < NS; s0++) XS[s0] = X0S + s0 * DX;
  function controls(r, out, outx) {                      // control point heights for resolution r (r + 2 points, x from -1 step to r steps)
    var dsp = Math.min(1, P.disp + (0.9 - P.disp) * burst * 0.7);   // a tap's burst also throws the points wider for a moment
    var lo = H / 2 * (1 - dsp), hi = H / 2 * (1 + dsp), n = r + 2;
    for (var i = 0; i < n; i++) { out[i] = lo + (hi - lo) * noise(i, nt); outx[i] = W * (i - 1) / (r - 1); }
    return n;
  }
  function splineAt(x, r, cp) {                          // uniform Catmull-Rom through cp at x spacing W/(r-1), first point at x = -W/(r-1)
    var step = W / (r - 1), f = x / step + 1, i = Math.floor(f), n = r + 2;
    if (i < 0) { i = 0; f = 0; } if (i > n - 2) { i = n - 2; f = n - 1; }
    var u = f - i, p0 = cp[i > 0 ? i - 1 : 0], p1 = cp[i], p2 = cp[i + 1], p3 = cp[i + 2 < n ? i + 2 : n - 1];
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  }
  var CP2 = new Float32Array(128), CPX2 = new Float32Array(128), nCP = 0;
  function buildBase(dt) {
    var s;
    nCP = controls(res, CP, CPX);
    if (resT < 1) {
      resT = Math.min(1, resT + dt / 0.6);
      var e = resT < 0.5 ? 2 * resT * resT : 1 - Math.pow(-2 * resT + 2, 2) / 2;
      controls(resFrom, CP2, CPX2);
      for (s = 0; s < NS; s++) BASE[s] = splineAt(XS[s], resFrom, CP2) + (splineAt(XS[s], res, CP) - splineAt(XS[s], resFrom, CP2)) * e;
    } else for (s = 0; s < NS; s++) BASE[s] = splineAt(XS[s], res, CP);
  }
  function baseAt(x) { var f = (x - X0S) / DX, i = clamp(Math.floor(f), 0, NS - 2), u = clamp(f - i, 0, 1); return BASE[i] + (BASE[i + 1] - BASE[i]) * u; }

  // --- bodies: per screen column, how high the silhouette reaches (px from the floor), blurred into hills and eased
  var MAPG = new Int32Array(GW * GH).fill(-1), mapAt = -1e9, HG = new Float32Array(GW), HB = new Float32Array(GW), HE = new Float32Array(GW + 1);
  var bodyOn = false, bodySeen = -1e9, bodyCount = 0, hillMax = 0;
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
  function updateHills(dt, nowMs) {
    var live = body.present || body.people.length > 0, gx, gy, k = ease(dt, 0.15), mx = 0;
    if (live) bodySeen = time;
    var on = time - bodySeen < 1.5;
    if (on) {
      buildMapG(nowMs);
      for (gx = 0; gx < GW; gx++) {
        HG[gx] = 0;
        for (gy = 0; gy < GH; gy++) { var c = MAPG[gy * GW + gx]; if (c >= 0 && body.mask[c] > 0.5) { HG[gx] = H - gy * CELL; break; } }
      }
      for (gx = 0; gx < GW; gx++) HB[gx] = Math.max(HG[gx], gx > 0 ? HG[gx - 1] : 0, gx < GW - 1 ? HG[gx + 1] : 0);   // a little wider
      for (var pass = 0; pass < 3; pass++) { var prev = HB[0]; for (gx = 0; gx < GW; gx++) { var cur = HB[gx], nx = gx < GW - 1 ? HB[gx + 1] : cur; HB[gx] = (prev + 2 * cur + nx) / 4; prev = cur; } }
    } else HB.fill(0);
    for (gx = 0; gx < GW; gx++) { HE[gx] += (HB[gx] - HE[gx]) * k; if (HE[gx] < 0.5 && HB[gx] === 0) HE[gx] = 0; if (HE[gx] > mx) mx = HE[gx]; }
    HE[GW] = HE[GW - 1];
    bodyOn = mx > 0.5; hillMax = mx;
  }
  var HS = new Float32Array(NS);                         // hill strength per sample (fingers keep a free zone so a hand on a body still catches a curve)
  function hillY(x, y, hs) {                             // fold everything below the silhouette's top into a band just above it
    if (hs < 0.01) return y;
    var f = clamp(x / CELL - 0.5, 0, GW - 1), i = Math.floor(f), u = f - i, h = HE[i] + (HE[i + 1] - HE[i]) * u;
    if (h < 1) return y;
    var tm = H - h - 36, B = 90, ts = tm - B;
    if (y <= ts) return y;
    return y + (ts + B * (1 - Math.exp(-(y - ts) / B)) - y) * hs * clamp(h / 60, 0, 1);
  }

  // --- hands: every fingertip a joint; taps (short touches, on release) burst the chaos; holds keep the trace
  var tracks = [], nextTid = 1, taps = 0, lastTap = -9, discs = [];
  function newTrack(p) { return {id: nextTid++, wx: p[0], wy: p[1], x: p[0] * W, y: p[1] * H, e: 0, born: time, bx: p[0], by: p[1], travel: 0, ax: p[0], ay: p[1], still: 0, held: false, alive: true, A: new Float32Array(NC), tn: MID, disc: null, reports: 0, stamp: -2}; }
  var tapInput = tapGesture(kit, input, 350);
  function updateTracks(pts, dt) {
    var i, t;
    var st = input.state, stamp = st === 'fresh' && kit.fingers && Number.isFinite(kit.fingers.t) ? kit.fingers.t : st === 'sparse' ? -1 : -3;
    for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], best = null, bd = 0.12;
      for (var j = 0; j < tracks.length; j++) { var q = tracks[j]; if (q.seen || !q.alive) continue; var d = Math.hypot(q.wx - p[0], q.wy - p[1]); if (d < bd) { bd = d; best = q; } }
      if (!best) { if (tracks.length >= MAXT) { var old = -1; for (j = 0; j < tracks.length; j++) if (!tracks[j].alive) { old = j; break; } if (old < 0) continue; tracks.splice(old, 1); } best = newTrack(p); tracks.push(best); }
      best.seen = true; best.wx = p[0]; best.wy = p[1]; tapInput.observe(best, p[0], p[1]);
      if (stamp === -1 || (stamp >= 0 && stamp !== best.stamp)) { best.reports++; best.stamp = stamp; }   // distinct Kinect reports: one is a hover flicker, not a tap
      best.travel = Math.max(best.travel, Math.hypot(p[0] - best.bx, p[1] - best.by));
      if (Math.hypot(p[0] - best.ax, p[1] - best.ay) > 0.02) { best.ax = p[0]; best.ay = p[1]; best.still = 0; } else best.still += dt;
    }
    var kp = ease(dt, 0.05);
    for (i = tracks.length - 1; i >= 0; i--) {
      t = tracks[i];
      if (t.alive && !t.seen) {                          // released: a short still touch is a tap; a held disc turns into a clearing
        t.alive = false;
        if (tapInput.release(t)) { lastTap = time; taps++; burst = 1; }
        if (t.disc) { t.disc.held = false; t.disc.clear = 0.45; t.disc = null; }
      }
      if (t.alive) {
        t.x += (t.wx * W - t.x) * kp; t.y += (t.wy * H - t.y) * kp; t.e += (1 - t.e) * ease(dt, 0.1);
        t.held = t.still >= 0.9;
        if (!t.held && t.disc) { t.disc.held = false; t.disc.clear = 0.45; t.disc = null; }   // the hand moved on: that disc clears too
        if (t.held && !t.disc) { t.disc = {x: t.x, y: t.y, r: 40, held: true, clear: 0}; discs.push(t.disc); if (discs.length > 6) discs.shift(); }
        if (t.disc) { t.disc.x = t.x; t.disc.y = t.y; t.disc.r = Math.min(340, t.disc.r + dt * 95); }
      } else {
        t.e *= Math.exp(-dt / 0.5);
        if (t.e < 0.02) tracks.splice(i, 1);
      }
    }
    for (i = discs.length - 1; i >= 0; i--) { var dc = discs[i]; if (!dc.held) { dc.clear -= dt; if (dc.clear <= 0) discs.splice(i, 1); } }
  }
  var YN = new Float32Array(NC), BUMP = new Float32Array(MAXT * NS), attachedMax = 0;
  function bumpAt(k, x) { var d = (x - tracks[k].x) / SIGX; return Math.exp(-d * d); }
  function updateJoints(dt) {                            // each fingertip pulls its nearest curve through it; the neighbours pinch in with a lag
    var k, t, j, s, gap = P.gap * GS, am = 0;
    for (k = 0; k < tracks.length; k++) for (s = 0; s < NS; s++) { var d = (XS[s] - tracks[k].x) / SIGX; BUMP[k * NS + s] = Math.exp(-d * d); }
    for (k = 0; k < tracks.length; k++) {
      var tr = tracks[k], A = tr.A;
      if (!tr.alive) { var kr = ease(dt, 0.45); for (t = 0; t < NC; t++) A[t] -= A[t] * kr; continue; }
      var bx = baseAt(tr.x), best = -1, bd = 1e9;
      for (t = 0; t < NC; t++) {                        // where each curve would cross the finger's column without this finger
        var y = bx + (t - MID) * gap;
        for (j = 0; j < tracks.length; j++) if (j !== k) y += tracks[j].A[t] * bumpAt(j, tr.x);
        YN[t] = y;
        if (VIS[t] > 0.5 && Math.abs(y - tr.y) < bd) { bd = Math.abs(y - tr.y); best = t; }
      }
      if (best < 0) best = MID;
      tr.tn = best;
      var yn = YN[best], shift = tr.y - yn;
      for (t = 0; t < NC; t++) {
        var dy = YN[t] - yn, pinch = Math.exp(-(dy * dy) / (RP * RP)), target = shift - dy * pinch * 0.9;
        if (t === best) target = shift;
        A[t] += (target - A[t]) * ease(dt, 0.03 + 0.035 * Math.abs(t - best));
        if (Math.abs(A[t]) > am) am = Math.abs(A[t]);
      }
    }
    attachedMax = am;
    for (s = 0; s < NS; s++) {                            // the hills give way around fingertips
      var hs = 1;
      for (k = 0; k < tracks.length; k++) { if (tracks[k].e < 0.2) continue; var dx = (XS[s] - tracks[k].x) / 140; hs *= 1 - tracks[k].e * Math.exp(-dx * dx); }
      HS[s] = hs;
    }
  }

  // --- look, knobs and colour
  function stepLook(dt) {
    var k = ease(dt, 0.35), tc = COLS[LK.col], n = over.curves ? settings.curves : LK.n, mid = (n - 1) / 2;
    P.gap += (LK.gap - P.gap) * k; P.disp += (LK.disp - P.disp) * k;
    P.trace += ((over.trace ? settings.trace : LK.trace) - P.trace) * k;
    P.chaos += ((over.chaos ? settings.chaos : LK.chaos) - P.chaos) * k;
    P.col = mix(P.col, tc, k);
    for (var t = 0; t < NC; t++) VIS[t] += ((Math.abs(t - MID) <= mid + 0.01 ? 1 : 0) - VIS[t]) * k;
    burst *= Math.exp(-dt / 0.7);
    lookFade = Math.max(0, lookFade - dt);
    if (jointT < 1) jointT = Math.min(1, jointT + dt / 0.6);
    var chaos = P.chaos + (100 - P.chaos) * burst;
    nt += dt * 60 * (0.001 + (0.05 - 0.001) * chaos / 100);   // the author's noiseDelta per frame, at 60 fps
    if (nt > 2e5) nt -= 2e5;
    return mid;
  }
  function applyLook(i) {
    LK = LOOKS[i];
    over.curves = over.trace = over.chaos = false;
    if (LK.res !== res) { resFrom = res; res = LK.res; resT = 0; }
    if (LK.joint !== joint) { jointFrom = joint; joint = LK.joint; jointT = 0; }
    lookFade = 0.6;
  }

  // --- drawing
  var curMid = 0, fadeA = 0.1, frameParity = 0;
  function holesPath() {                                 // the whole wall minus the held discs (they keep their trace)
    ctx.beginPath(); ctx.rect(0, 0, W, H);
    for (var i = 0; i < discs.length; i++) if (discs[i].held) { var d = discs[i]; ctx.moveTo(d.x + d.r, d.y); ctx.arc(d.x, d.y, d.r, 0, 2 * PI, true); }
  }
  function fade(dt) {
    var a = (100 - 95 * clamp(P.trace, 0, 100) / 100) / 255, i, d;
    if (lookFade > 0) a = Math.max(a, 0.08);
    fadeA = a;
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(0,0,0,' + a.toFixed(4) + ')';
    holesPath(); ctx.fill('evenodd');
    for (i = 0; i < discs.length; i++) {
      d = discs[i];
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 2 * PI);
      ctx.fillStyle = 'rgba(0,0,0,' + (d.held ? a * 0.12 : Math.max(a, 0.3)).toFixed(4) + ')'; ctx.fill();
    }
    frameParity ^= 1;
    if (frameParity) { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = 'rgb(1,1,1)'; holesPath(); ctx.fill('evenodd'); ctx.globalCompositeOperation = 'source-over'; }
  }
  function curveY(t, s, x) {                             // a curve's height at sample s (x = XS[s]) with fingers and hills
    var y = BASE[s] + (t - MID) * P.gap * GS;
    for (var k = 0; k < tracks.length; k++) y += tracks[k].A[t] * BUMP[k * NS + s];
    return hillY(x, y, HS[s]);
  }
  function curveYAt(t, x) {                              // the same at any x (joint marks), interpolated
    var f = (x - X0S) / DX, i = clamp(Math.floor(f), 0, NS - 2), u = clamp(f - i, 0, 1);
    return curveY(t, i, XS[i]) * (1 - u) + curveY(t, i + 1, XS[i + 1]) * u;
  }
  function mark(type, x, y, j2) {
    if (type === 1) ctx.rect(x - j2, y - j2, 2 * j2, 2 * j2);
    else if (type === 2) { ctx.moveTo(x + j2, y); ctx.arc(x, y, j2, 0, 2 * PI); }
    else if (type === 3) { ctx.moveTo(x, y - j2); ctx.lineTo(x, y + j2); ctx.moveTo(x - j2, y); ctx.lineTo(x + j2, y); }
    else if (type === 4) { ctx.moveTo(x - j2, y - j2); ctx.lineTo(x + j2, y + j2); ctx.moveTo(x - j2, y + j2); ctx.lineTo(x + j2, y - j2); }
  }
  function emitCurve(t, jt) {
    ctx.moveTo(XS[0], curveY(t, 0, XS[0]));
    for (var s = 1; s < NS; s++) ctx.lineTo(XS[s], curveY(t, s, XS[s]));
    if (jt) for (var i = 0; i < nCP; i++) { var x = CPX[i]; if (x < -6 || x > W + 6) continue; var y = curveYAt(t, x); ctx.moveTo(x, y); mark(jt, x, y, 5); }
  }
  function render(dt, mid) {
    var w = size[0], h = size[1], col = shade(P.col, hueFlow.value), cs = Math.round(col[0]) + ',' + Math.round(col[1]) + ',' + Math.round(col[2]);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    if (needClear) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); needClear = false; }
    ctx.setTransform(w / W, 0, 0, h / H, 0, 0);
    fade(dt);
    ctx.lineWidth = 2 * GS; ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    var jt = jointT < 1 ? (jointT < 0.5 ? jointFrom : joint) : joint, m1 = Math.max(1, mid + 1);
    for (var d = MID; d >= 0; d--) {                      // twins (faint) first, the middle curve last; one path per pair
      var v = VIS[MID + d]; if (v < 0.004) continue;
      var a = d === 0 ? 1 : clamp((20 / 255) * (1 - d / m1), 0, 1);
      a *= v; if (a < 0.002) continue;
      ctx.beginPath(); emitCurve(MID + d, jt); if (d) emitCurve(MID - d, jt);
      ctx.strokeStyle = 'rgba(' + cs + ',' + a.toFixed(4) + ')'; ctx.stroke();
    }
    ctx.strokeStyle = 'rgb(' + cs + ')'; ctx.lineWidth = 2.2 * GS;   // fingertips are joints: a mark on the curve each hand holds
    for (var k = 0; k < tracks.length; k++) {
      var tr = tracks[k]; if (!tr.alive || tr.e < 0.3) continue;
      var y = curveYAt(tr.tn, tr.x), j2 = 7 + (tr.held ? 3 : 0);
      ctx.beginPath(); mark(joint || 1, tr.x, y, j2); ctx.stroke();
      var prog = tr.held ? 0 : clamp((tr.still - 0.25) / 0.65, 0, 1);
      if (prog > 0) { ctx.beginPath(); ctx.arc(tr.x, y, 16, -PI / 2, -PI / 2 + 2 * PI * prog); ctx.stroke(); }
    }
  }

  function frame(dt, now) {
    if (dead) return;
    var t0 = performance.now();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
    hueFlow.step(settings.hue, dt);
    var mid = stepLook(dt); curMid = mid;
    body.update(dt, now);
    bodyCount = body.fresh ? body.people.length : 0;
    updateHills(dt, now);
    buildBase(dt);
    updateTracks(input.read(), dt);
    updateJoints(dt);
    render(dt, mid);
    frameMs = performance.now() - t0;
  }
  function resize(w, h) { if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return; size = [w, h]; needClear = true; }
  var LIM = {look: [0, LOOKS.length - 1], curves: [1, 49], trace: [0, 100], chaos: [0, 100], hue: [0, 360]};
  function set(o) {
    if (o && typeof o === 'object') {
      var lk = o.look;
      if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, 0, LOOKS.length - 1)); if (li !== settings.look) { settings.look = li; applyLook(li); } }
      ['curves', 'trace', 'chaos'].forEach(function(key) {       // moving one of these overrides the look's own value until the next look
        var v = o[key]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
        v = clamp(v, LIM[key][0], LIM[key][1]); if (key === 'curves') v = 2 * Math.round((v - 1) / 2) + 1;
        if (v !== settings[key]) { settings[key] = v; over[key] = true; }
      });
      var hv = o.hue; if (typeof hv === 'number' && Number.isFinite(hv)) settings.hue = clamp(hv, 0, 360);
    }
    return Object.assign({}, settings);
  }
  function destroy() {
    if (dead) return; dead = true;
    tracks = []; discs = []; input.clear(); kit.wantDepth(false);
    if (window.TracecurvesSet === set) delete window.TracecurvesSet;
  }
  resize(canvas.width, canvas.height);
  kit.wantDepth(true);
  window.TracecurvesSet = set; if (window._tracecurvesFx) set(window._tracecurvesFx);
  (function snap() {                                     // start on the stored look and knobs without easing in
    var ov = {curves: over.curves, trace: over.trace, chaos: over.chaos};
    LK = LOOKS[settings.look]; res = resFrom = LK.res; resT = 1; joint = LK.joint; jointT = 1; lookFade = 0;
    P.gap = LK.gap; P.disp = LK.disp; P.col = COLS[LK.col].slice();
    P.trace = ov.trace ? settings.trace : LK.trace; P.chaos = ov.chaos ? settings.chaos : LK.chaos;
    var n = ov.curves ? settings.curves : LK.n; for (var t = 0; t < NC; t++) VIS[t] = Math.abs(t - MID) <= (n - 1) / 2 ? 1 : 0;
    nt = LK.t0 * (0.001 + 0.049 * P.chaos / 100);
    hueFlow.snap(settings.hue);
  })();
  var out = {frame: frame, touch: function(t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
  if (window.WallTest) out.debug = function() {
    return {frames: frames, frameMs: frameMs, look: LK.name, curves: 2 * curMid + 1, res: res, overrides: Object.assign({}, over), chaos: P.chaos + (100 - P.chaos) * burst,
      burst: burst, trace: P.trace, fadeAlpha: fadeA, taps: taps, contacts: tracks.filter(function(t) { return t.alive; }).length,
      held: tracks.filter(function(t) { return t.alive && t.held; }).length, discs: discs.map(function(d) { return {r: Math.round(d.r), held: d.held}; }),
      attached: tracks.map(function(t) { return {tn: t.tn - MID, x: Math.round(t.x), y: Math.round(t.y), curveY: Math.round(curveYAt(t.tn, t.x))}; }), attachedMax: attachedMax,
      bodyCount: bodyCount, bodyOn: bodyOn, hillMax: hillMax, displayHue: hueFlow.value, finite: Array.prototype.every.call(BASE, Number.isFinite), settings: set(), destroyed: dead};
  };
  return out;
}
})();
