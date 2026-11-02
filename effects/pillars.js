/* Pillars (genart lab, batch 2, 2026-10-22).
   After "pillars" by Maksim Vasilyev, p5-experiments (https://github.com/vasilyev-maksim/p5-experiments), CC BY-NC 4.0; studio use, non-commercial.
   Our own port of the algorithm and the looks (no p5, none of his TypeScript): a row of rounded pillars across the wall, split by a random
   width partition (dispersion), each column cut by a black gap whose height rides a sine wave (amplitude, period), every pill a flat colour
   lerped between the look's two colours by its length, on black. The looks are his presets.
   Live: bodies part the pillars like a crowd (the columns squeeze aside, a clear lane opens where a person stands, the pillars nearest
   lean away, and they close in behind as the person walks). A fingertip catches the gap of the pillars under it and holds it at the hand's
   height; the hand's x sets the wave period (the wave pivots about the hand). Tap = a pulse runs out across every pillar from the tap.
   Hold = the pillar under the hand grows to the top and the wave stops behind it (the lee side goes calm). Two hands = a wave runs
   between them like a skipping rope. Idle = his wave.
   Canvas 2D, flat fills, no gradients. ASCII only. */
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
function refreshHue(initial){
  var value=Number.isFinite(initial)?initial:0;
  return {get value(){return value;},snap:function(v){value=v;},step:function(target,dt){var d=((target-value+540)%360)-180;if(Math.abs(d)<.001){value=target%360;return;}value=(value+d*(1-Math.exp(-Math.max(0,Math.min(.1,dt))/.18))+360)%360;}};
}

registerWallPlugin({id: 'pillars', title: 'Pillars', author: 'Builder J (genart, after Maksim Vasilyev)', create: create});

var W = 1280, H = 800, MAXN = 64, NB = 128, BW = W / NB, KW = 128, KH = 106, DEG = Math.PI / 180, TAU = Math.PI * 2;
// his colour pairs (controls.ts COLOR); the white of pair 3 is toned to a warm ivory for the projector
var PAIRS = [[[0x34, 0x09, 0x98], [0xea, 0x72, 0xf7]], [[0xff, 0x4b, 0x4b], [0xf0, 0xf6, 0x89]], [[0x13, 0x00, 0x5f], [0xa3, 0xff, 0x9a]], [[0, 0, 0], [222, 218, 208]]];
// his presets (presets.ts): n = RESOLUTION, amp = AMPLITUDE 0..10, period = PERIOD, gx = GAP_X, gy = GAP_Y, disp = W_DISPERSION, td = timeDelta
var LOOKS = [
  {name: 'piano',        n: 6,  amp: 10, period: 3, gx: 10, gy: 12,  disp: 0,   col: 3, td: 1},
  {name: 'rush hour',    n: 30, amp: 10, period: 4, gx: 13, gy: 25,  disp: 0,   col: 0, td: 0.3},
  {name: 'lava lamp',    n: 5,  amp: 7,  period: 1, gx: 25, gy: 25,  disp: 0.3, col: 0, td: 0.3},
  {name: 'dragon',       n: 25, amp: 1,  period: 2, gx: 1,  gy: 200, disp: 0,   col: 1, td: 3},
  {name: 'wave',         n: 25, amp: 10, period: 1, gx: 8,  gy: 8,   disp: 0,   col: 2, td: 3},
  {name: 'scoliosis',    n: 25, amp: 1,  period: 1, gx: 10, gy: 35,  disp: 0,   col: 1, td: 0.8},
  {name: 'looks uneven', n: 15, amp: 6,  period: 1, gx: 6,  gy: 6,   disp: 0.5, col: 0, td: 1}
];
var DEF_LOOK = 1;

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
// his getRandomPartition: n parts summing to 1, each within (1 +- dispersion) / n
function partition(n, disp, seed, out) {
  var rnd = mulberry(seed), lo = (1 - disp) / n, hi = (1 + disp) / n, rem = 1, i;
  for (i = 0; i < n; i++) {
    var left = n - i;
    if (left <= 1) { out[i] = rem; break; }
    var mx = Math.max(lo, Math.min(hi, rem - lo * (left - 1)));
    var v = lo + rnd() * (mx - lo); out[i] = v; rem -= v;
  }
}

function create(canvas, kit) {
  var ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Pillars needs Canvas 2D');
  var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0), dead = false;
  var settings = {look: DEF_LOOK, pillars: 100, wave: 100, speed: 100, hue: 0};
  var size = [canvas.width || W, canvas.height || H], time = 0, frames = 0, frameMs = 0;

  // eased look state (his createAnimatedValue: ~25 frames; ours: time constant 0.35 s)
  var L0 = LOOKS[DEF_LOOK];
  var cur = {amp: 0, period: L0.period, gx: 0, gy: 0, td: L0.td}, colA = PAIRS[L0.col][0].slice(), colB = PAIRS[L0.col][1].slice();
  var FW = new Float32Array(MAXN), TW = new Float32Array(MAXN), PU = new Float32Array(MAXN), TPU = new Float32Array(MAXN), PART = new Float32Array(MAXN);
  var GAP = new Float32Array(MAXN).fill(H / 2), TGT = new Float32Array(MAXN), GHC = new Float32Array(MAXN), CALM = new Float32Array(MAXN), PENV = new Float32Array(MAXN);
  var LX = new Float32Array(MAXN), LWD = new Float32Array(MAXN), XC = new Float32Array(MAXN), XS = new Float32Array(MAXN), LEAN = new Float32Array(MAXN);
  var nCols = 0, partKey = '', firstLayout = true;
  var phi = 0, pivot = 0, P = L0.period;

  function targets() {
    var L = LOOKS[settings.look];
    return {amp: L.amp / 10 * (H / 2) * settings.wave / 100, period: L.period, gx: L.gx * W / 1158, gy: L.gy * H / 811, td: L.td * settings.speed / 100,
            n: clamp(Math.round(L.n * settings.pillars / 100), 1, 60), disp: L.disp, col: L.col};
  }
  function relayout(T) {
    var key = settings.look + ':' + T.n;
    if (key === partKey) return;
    partKey = key;
    partition(T.n, T.disp, 144 + settings.look * 7919 + T.n * 31, PART);
    for (var i = 0; i < MAXN; i++) { TW[i] = i < T.n ? PART[i] : 0; TPU[i] = i < T.n ? i / T.n : 1; }
    nCols = T.n;
    if (firstLayout) { FW.set(TW); PU.set(TPU); firstLayout = false; }
  }

  // --- bodies: per screen-x bin, how much of a person is there (Kinect cell -> screen bin span, rebuilt every 2 s)
  var CB0 = new Int16Array(KW * KH).fill(-1), CB1 = new Int16Array(KW * KH), mapAt = -1e9;
  var CNT = new Float32Array(NB), RAW = new Float32Array(NB), TMP = new Float32Array(NB), OCC = new Float32Array(NB), DCDF = new Float32Array(NB + 1);
  var occMax = 0, gapOpen = 0, bodyCount = 0, leanMax = 0, cMean = 1;
  function buildMap(nowMs) {
    if (nowMs - mapAt < 2000) return;
    mapAt = nowMs;
    for (var y = 0; y < KH; y++) for (var x = 0; x < KW; x++) {
      var k = y * KW + x, v = (y + 0.5) * 4, p0 = kit.toScreen(x * 4, v), p1 = kit.toScreen((x + 1) * 4, v);
      if (!p0 || !p1 || !Number.isFinite(p0[0]) || !Number.isFinite(p1[0]) || !Number.isFinite(p0[1])) { p0 = [x * 4 / 512, v / 424]; p1 = [(x + 1) * 4 / 512, v / 424]; }
      var yy = (p0[1] + p1[1]) * 0.5, a = Math.floor(Math.min(p0[0], p1[0]) * NB), b = Math.floor(Math.max(p0[0], p1[0]) * NB);
      if (!(yy >= 0 && yy <= 1) || b < 0 || a > NB - 1 || b - a > 24) { CB0[k] = -1; continue; }
      CB0[k] = Math.max(0, a); CB1[k] = Math.min(NB - 1, b);
    }
  }
  function updateOcc(dt, nowMs) {
    var b, i, k;
    if (body.fresh && body.people.length) {
      buildMap(nowMs);
      CNT.fill(0);
      var mask = body.mask;
      for (k = 0; k < KW * KH; k++) { if (mask[k] > 0.5 && CB0[k] >= 0) { for (b = CB0[k]; b <= CB1[k]; b++) CNT[b] += 1; } }
      for (b = 0; b < NB; b++) RAW[b] = smooth(3, 12, CNT[b]);
      for (b = 0; b < NB; b++) { var m = 0; for (i = Math.max(0, b - 3); i <= Math.min(NB - 1, b + 3); i++) if (RAW[i] > m) m = RAW[i]; TMP[b] = m; }   // a 30 px margin
      for (var pass = 0; pass < 2; pass++) {
        for (b = 0; b < NB; b++) RAW[b] = (TMP[b > 0 ? b - 1 : 0] + 2 * TMP[b] + TMP[b < NB - 1 ? b + 1 : NB - 1]) * 0.25;
        TMP.set(RAW);
      }
    } else TMP.fill(0);
    var e = ease(dt, 0.15), run = 0, best = 0;
    occMax = 0;
    for (b = 0; b < NB; b++) {
      OCC[b] += (TMP[b] - OCC[b]) * e;
      if (OCC[b] > occMax) occMax = OCC[b];
      if (OCC[b] > 0.5) { run++; if (run > best) best = run; } else run = 0;
    }
    gapOpen = best * BW;
    DCDF[0] = 0;
    for (b = 0; b < NB; b++) DCDF[b + 1] = DCDF[b] + (1 - 0.98 * OCC[b]) * BW;
    cMean = DCDF[NB] / W;
  }
  function densityAt(x) { var b = clamp(Math.floor(x / BW), 0, NB - 1); return 1 - 0.98 * OCC[b]; }

  // --- hands: tracks (stillness from the 28/s finger feed), tap pulses, holds
  var tracks = [], nextTid = 1, pulses = [], holds = [], ropes = 0, taps = 0;
  function updateTracks(pts, dt) {
    var i, t;
    for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
    pts.forEach(function(p) {
      var best = null, bd = 0.12;
      tracks.forEach(function(q) { if (!q.seen) { var d = Math.hypot(q.x - p[0], q.y - p[1]); if (d < bd) { bd = d; best = q; } } });
      if (!best) {
        best = {id: nextTid++, x: p[0], y: p[1], ax: p[0], ay: p[1], still: 0, hold: null}; tracks.push(best);
        pulses.push({x: p[0] * W, sign: p[1] * H < H * 0.5 ? -1 : 1, age: 0}); taps++;
        if (pulses.length > 6) pulses.shift();
      }
      best.seen = true; best.x = p[0]; best.y = p[1];
      if (Math.hypot(p[0] - best.ax, p[1] - best.ay) > 0.02) { best.ax = p[0]; best.ay = p[1]; best.still = 0; } else best.still += dt;
    });
    for (i = tracks.length - 1; i >= 0; i--) { t = tracks[i]; if (!t.seen) { if (t.hold) t.hold.alive = false; tracks.splice(i, 1); } }
    tracks.forEach(function(q) {
      if (q.still >= 0.9 && !q.hold) { q.hold = {x: q.x * W, s: 0, alive: true}; holds.push(q.hold); if (holds.length > 4) holds.shift().alive = false; }
      if (q.still < 0.9 && q.hold) { q.hold.alive = false; q.hold = null; }
      if (q.hold) q.hold.x = q.x * W;
    });
    for (i = holds.length - 1; i >= 0; i--) {
      var h = holds[i];
      if (h.alive) h.s += (1 - h.s) * ease(dt, 0.35); else { h.s *= Math.exp(-dt / 0.45); if (h.s < 0.01) holds.splice(i, 1); }
    }
    for (i = pulses.length - 1; i >= 0; i--) { pulses[i].age += dt; if (pulses[i].age > 2.6) pulses.splice(i, 1); }
  }

  // --- colours: 33 flat steps from A (short pill) to B (long pill), rebuilt when the colours or the hue move
  var COLS = new Array(33), colKey = '';
  function buildCols(Hd) {
    var a = hueRot(colA, Hd), b = hueRot(colB, Hd), key = a.map(Math.round).join(',') + ':' + b.map(Math.round).join(',');
    if (key === colKey) return;
    colKey = key;
    for (var i = 0; i <= 32; i++) { var t = i / 32; COLS[i] = 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' + Math.round(a[2] + (b[2] - a[2]) * t) + ')'; }
  }

  function step(dt, nowMs) {
    var T = targets(), k = ease(dt, 0.35), i;
    cur.amp += (T.amp - cur.amp) * k; cur.gx += (T.gx - cur.gx) * k; cur.gy += (T.gy - cur.gy) * k; cur.td += (T.td - cur.td) * k;
    var ca = PAIRS[T.col][0], cb = PAIRS[T.col][1];
    for (i = 0; i < 3; i++) { colA[i] += (ca[i] - colA[i]) * k; colB[i] += (cb[i] - colB[i]) * k; }
    relayout(T);
    for (i = 0; i < MAXN; i++) { FW[i] += (TW[i] - FW[i]) * k; PU[i] += (TPU[i] - PU[i]) * k; }

    // layout coordinates (his: start at GAP_X, width = part * (W - GAP_X), drawn width = width - GAP_X)
    var span = W - cur.gx, start = cur.gx;
    for (i = 0; i < MAXN; i++) { var wd = FW[i] * span; LWD[i] = Math.max(0, wd - cur.gx); LX[i] = start + LWD[i] * 0.5; start += wd; }

    body.update(dt, nowMs);
    bodyCount = body.fresh ? body.people.length : 0;
    updateOcc(dt, nowMs);
    var pts = input.read();
    updateTracks(pts, dt);

    // the crowd: column centres pushed out of the occupied bins by the density warp (monotone, so pillars never cross)
    var b = 0, ex = ease(dt, 0.12);
    leanMax = 0;
    for (i = 0; i < MAXN; i++) {
      var v = LX[i] * cMean;
      while (b < NB - 1 && DCDF[b + 1] < v) b++;
      var d = 1 - 0.98 * OCC[b], tx = (b + clamp((v - DCDF[b]) / Math.max(1e-6, d * BW), 0, 1)) * BW;
      if (!Number.isFinite(tx)) tx = LX[i];
      XC[i] = firstFrame ? tx : XC[i] + (tx - XC[i]) * ex;
      XS[i] = LWD[i] * cMean * densityAt(XC[i]);
      LEAN[i] = clamp((XC[i] - LX[i]) * 0.22, -55, 55);
      if (Math.abs(LEAN[i]) > leanMax) leanMax = Math.abs(LEAN[i]);
    }
    firstFrame = false;

    // the wave: his gapY = H/2 + amp * sin(2 pi period i/n + t); the period follows a hand's x and pivots about the hand
    var hx = 0, nh = tracks.length;
    for (i = 0; i < nh; i++) hx += tracks[i].x;
    var Pt = nh ? 0.5 + 3.5 * clamp((hx / nh - 0.08) / 0.84, 0, 1) : LOOKS[settings.look].period;
    if (nh) {
      var cx = hx / nh * W, bi = 0, bd = 1e9;
      for (i = 0; i < nCols; i++) { var dd = Math.abs(XC[i] - cx); if (dd < bd) { bd = dd; bi = i; } }
      var np = PU[bi];
      phi += TAU * P * (np - pivot); pivot = np;
    }
    P += (Pt - P) * k;
    phi = (phi + dt * 0.9 * cur.td) % (TAU * 1000);

    // calm water in the lee of a held pillar (the wave travels right to left)
    CALM.fill(1);
    var holdCol = [];
    holds.forEach(function(h) {
      var hc = 0, hd = 1e9;
      for (var j = 0; j < nCols; j++) { var dj = Math.abs(XC[j] - h.x); if (dj < hd) { hd = dj; hc = j; } }
      holdCol.push(hc);
      for (j = 0; j < MAXN; j++) { var dl = (XC[hc] - XC[j]) / 650; if (dl > 0.001) CALM[j] *= 1 - h.s * Math.exp(-dl * dl); }
    });

    // ropes between neighbouring hands (sorted by x)
    var sorted = tracks.slice().sort(function(a, c) { return a.x - c.x; });
    ropes = 0;
    var pitch = W / Math.max(1, nCols), R = Math.max(55, 0.8 * pitch);
    for (i = 0; i < MAXN; i++) {
      var base = H / 2 + cur.amp * CALM[i] * Math.sin(TAU * P * (PU[i] - pivot) + phi), tg = base, x = XC[i];
      for (var r = 0; r + 1 < sorted.length; r++) {
        var a = sorted[r], c = sorted[r + 1], xa = a.x * W, xb = c.x * W;
        if (xb - xa < 90) continue;
        if (i === 0) ropes++;
        if (x > xa && x < xb) {
          var s = (x - xa) / (xb - xa), Ar = clamp(0.22 * (xb - xa), 40, 170);
          tg = a.y * H + (c.y - a.y) * H * s + Ar * Math.sin(Math.PI * s) * Math.sin(TAU * (s - 0.8 * time));
        }
      }
      var wh = 0, hy = 0;
      for (r = 0; r < tracks.length; r++) { var dx = (x - tracks[r].x * W) / R, w = Math.exp(-dx * dx); if (w > wh) { wh = w; hy = tracks[r].y * H; } }
      tg += (hy - tg) * wh;
      var gh = cur.gy, push = 0, pe = 0;
      for (r = 0; r < pulses.length; r++) {
        var pu = pulses[r], front = Math.abs(x - pu.x) - 620 * pu.age, env = Math.exp(-front * front / 6400) * Math.exp(-pu.age / 1.6);
        push += pu.sign * 230 * env; gh += 170 * env; pe += env;
      }
      PENV[i] = Math.min(1, pe * 1.3);
      tg += push * (1 - wh);
      TGT[i] = tg; GHC[i] = gh;
    }
    holds.forEach(function(h, j) { var hc = holdCol[j]; TGT[hc] += (-GHC[hc] * 0.5 - 24 - TGT[hc]) * h.s; });
    var eg = ease(dt, 0.08);
    for (i = 0; i < MAXN; i++) GAP[i] += (TGT[i] - GAP[i]) * eg;
  }
  var firstFrame = true;

  function pillPath(x0, w, yA, yB, roundBottom) {   // a flat pill from yA down to yB with one round end
    var r = w * 0.5, xc = x0 + r;
    ctx.beginPath();
    if (roundBottom) {
      var cyb = yB - r, top = Math.min(yA, cyb);
      ctx.moveTo(x0, top); ctx.lineTo(x0 + w, top); ctx.lineTo(x0 + w, cyb); ctx.arc(xc, cyb, r, 0, Math.PI, false); ctx.closePath();
    } else {
      var cyt = yA + r, bot = Math.max(yB, cyt);
      ctx.moveTo(x0 + w, bot); ctx.lineTo(x0, bot); ctx.lineTo(x0, cyt); ctx.arc(xc, cyt, r, Math.PI, TAU, false); ctx.closePath();
    }
    ctx.fill();
  }
  function render() {
    var sx = size[0] / W, sy = size[1] / H, i;
    buildCols(hueFlow.value);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size[0], size[1]);
    for (i = 0; i < MAXN; i++) {
      var w = XS[i];
      if (!(w > 2.5)) continue;
      var lean = LEAN[i], x0 = XC[i] - w * 0.5, g = GAP[i], gd = GHC[i] * 0.5;
      ctx.setTransform(sx, 0, -lean * sx / H, sy, lean * sx, 0);
      var l1 = g - gd, l2 = H - (g + gd);
      var fl = PENV[i], a1 = clamp(l1 / H, 0, 1), a2 = clamp(l2 / H, 0, 1);   // a passing tap pulse flips each pill to the other colour of the pair
      a1 += (1 - 2 * a1) * fl; a2 += (1 - 2 * a2) * fl;
      if (l1 > 0.5) { ctx.fillStyle = COLS[Math.round(a1 * 32)]; pillPath(x0, w, -12, l1, true); }
      if (l2 > 0.5) { ctx.fillStyle = COLS[Math.round(a2 * 32)]; pillPath(x0, w, g + gd, H + 12, false); }
    }
  }

  function frame(dt, now) {
    if (dead) return;
    var t0 = performance.now();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
    hueFlow.step(settings.hue, dt);
    step(dt, Number.isFinite(now) ? now : performance.now());
    render();
    frameMs = performance.now() - t0;
  }
  function resize(w, h) { if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return; size = [w, h]; }
  var LIM = {look: [0, LOOKS.length - 1], pillars: [25, 200], wave: [0, 200], speed: [0, 300], hue: [0, 360]};
  function set(o) {
    if (o && typeof o === 'object') Object.keys(LIM).forEach(function(key) {
      var v = o[key];
      if (typeof v === 'number' && Number.isFinite(v)) settings[key] = key === 'look' ? Math.round(clamp(v, LIM[key][0], LIM[key][1])) : clamp(v, LIM[key][0], LIM[key][1]);
    });
    return Object.assign({}, settings);
  }
  function destroy() {
    if (dead) return; dead = true;
    tracks = []; pulses = []; holds = []; input.clear(); kit.wantDepth(false);
    if (window.PillarsSet === set) delete window.PillarsSet;
  }
  resize(canvas.width, canvas.height);
  kit.wantDepth(true);
  window.PillarsSet = set; if (window._pillarsFx) set(window._pillarsFx);
  (function() { var T = targets(), L = LOOKS[settings.look]; hueFlow.snap(settings.hue); cur.amp = T.amp; cur.gx = T.gx; cur.gy = T.gy; cur.td = T.td; P = L.period;
    colA = PAIRS[L.col][0].slice(); colB = PAIRS[L.col][1].slice(); relayout(T); })();
  var out = {frame: frame, touch: function(t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
  if (window.WallTest) out.debug = function() {
    var first = tracks[0], gapAtHand = null;
    if (first) { var bi = 0, bd = 1e9; for (var i = 0; i < nCols; i++) { var d = Math.abs(XC[i] - first.x * W); if (d < bd) { bd = d; bi = i; } } gapAtHand = {gap: GAP[bi], hand: first.y * H, col: bi}; }
    return {frames: frames, frameMs: frameMs, look: LOOKS[settings.look].name, cols: nCols, period: P, amp: cur.amp, contacts: tracks.length,
      held: holds.filter(function(h) { return h.alive; }).length, holdStrength: holds.map(function(h) { return h.s; }), pulses: pulses.length, taps: taps, ropes: ropes,
      gapAtHand: gapAtHand, bodyCount: bodyCount, occMax: occMax, gapOpenPx: gapOpen, cMean: cMean, leanMax: leanMax, displayHue: hueFlow.value, settings: set(), destroyed: dead};
  };
  return out;
}
})();
