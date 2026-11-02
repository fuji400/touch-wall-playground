/* Ridgeline (genart lab, 2026-10-22; ported from jdxyw/generativeart joydivision.go, the CP 1919 pulsar plot).
   Sixty stacked ridgelines, drawn back (top) to front (bottom); each line's dark-violet fill occludes the lines behind it.
   Bodies ARE the mountains: every line samples the depth silhouette along the Kinect row it maps to (body.mask, body.sdf and
   body.gap), so a person raises a mountain range of their own shape across the stack: highest along the middle of the body,
   taller when they stand closer to the wall, with the pulsar noise riding on top. Hands push peaks: a fingertip raises a sharp
   spike that rolls down the stack. Tap = a pulsar burst runs through every line, top to bottom. Hold = the peak stays and the
   ridges below drip down. Idle = pure pulsar noise rolling slowly, the classic plot.
   Canvas 2D. The pulsar field (the Go's ridged + fbm + carrier noise under the multi-modal envelope) is computed once per field
   row into a ring cache and rolled by interpolation; one crest gradient in base-relative space colours every line by elevation.
   ASCII only.
   Looks (2026-11-01): named presets of the eleven named colours and the three knobs (lines, height, roll speed; no look has more
   lines than the default, so none costs more). A change eases every live colour (fills, crest gradient, pulse, drips, stars) over
   ~0.8 s and crossfades the baked background from the old bake to the new one; lines, height and speed ease (tau 0.4 / 0.25 / 0.5 s).
   A moved knob overrides the look's value until the next look. */
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

registerWallPlugin({id: 'ridgeline', title: 'Ridgeline', author: 'Builder F (genart)', create: create});

var DEG = Math.PI / 180;
// palette: joydivision.go's named colours (bgBase, darkVioletTint, peakWhite) plus a restrained cyberpunk ramp for the crests
var COL0 = {
  ground: [5, 6, 16], violetFill: [13, 9, 28], ivory: [250, 248, 255],
  dusk: [104, 92, 184], lilac: [136, 140, 232], ice: [150, 206, 255], pale: [222, 232, 255], pulse: [255, 92, 176], star: [190, 215, 255],
  flank: [168, 162, 214], mist: [198, 204, 246]
};
// Looks: the named colours (crest gradient flank -> mist -> pale -> ivory by height; fills = ground toward violetFill down the stack;
// dusk / lilac = the radio column; pulse = a tap's burst; ice = drips) and the three shape knobs. Look 0 is the original.
var LOOKS = [
  {name: 'pulsar', lines: 60, height: 100, speed: 100, pal: COL0},
  {name: 'ink', lines: 45, height: 120, speed: 70, pal: {
    ground: [236, 230, 214], violetFill: [232, 224, 204], ivory: [10, 10, 14], dusk: [200, 190, 170], lilac: [214, 206, 188], ice: [30, 62, 140],
    pale: [22, 20, 26], pulse: [200, 32, 22], star: [12, 12, 12], flank: [70, 64, 66], mist: [40, 36, 40]}},
  {name: 'ember', lines: 50, height: 140, speed: 60, pal: {
    ground: [10, 3, 2], violetFill: [28, 7, 4], ivory: [255, 240, 200], dusk: [180, 60, 20], lilac: [230, 110, 40], ice: [255, 200, 120],
    pale: [255, 190, 110], pulse: [255, 244, 180], star: [255, 180, 120], flank: [200, 60, 20], mist: [240, 122, 40]}},
  {name: 'neon', lines: 40, height: 160, speed: 140, pal: {
    ground: [2, 0, 8], violetFill: [12, 0, 24], ivory: [255, 255, 255], dusk: [255, 0, 170], lilac: [0, 220, 255], ice: [0, 255, 200],
    pale: [0, 224, 255], pulse: [255, 240, 0], star: [200, 120, 255], flank: [255, 0, 164], mist: [182, 62, 255]}},
  {name: 'abyss', lines: 60, height: 80, speed: 50, pal: {
    ground: [2, 10, 20], violetFill: [0, 62, 82], ivory: [220, 255, 250], dusk: [0, 90, 140], lilac: [0, 160, 180], ice: [120, 255, 230],
    pale: [140, 240, 255], pulse: [255, 122, 80], star: [160, 230, 255], flank: [0, 120, 150], mist: [60, 200, 220]}}
];
var PAL_KEYS = Object.keys(COL0);
var S = 192, X0 = 40, X1 = 1240, Y0 = 128, Y1 = 704, FIELD = 59, CACHE = 128, MAXL = 90, DROP = 7, PEAK = 92 * 800 / 600;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }
function smooth(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (+a).toFixed(3) + ')'; }
function mixc(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }
function hueRot(c, deg) {                                // the CSS hue-rotate matrix
  if (!deg) return c;
  var a = Math.cos(deg * DEG), b = Math.sin(deg * DEG), r = c[0], g = c[1], bl = c[2];
  return [Math.round(clamp((0.213 + 0.787 * a - 0.213 * b) * r + (0.715 - 0.715 * a - 0.715 * b) * g + (0.072 - 0.072 * a + 0.928 * b) * bl, 0, 255)),
          Math.round(clamp((0.213 - 0.213 * a + 0.143 * b) * r + (0.715 + 0.285 * a + 0.140 * b) * g + (0.072 - 0.072 * a - 0.283 * b) * bl, 0, 255)),
          Math.round(clamp((0.213 - 0.213 * a - 0.787 * b) * r + (0.715 - 0.715 * a + 0.715 * b) * g + (0.072 + 0.928 * a + 0.072 * b) * bl, 0, 255))];
}

// --- seeded 2D simplex noise with the Go engine's helpers (Simplex2D, FBM2D, Ridged2D)
function makeNoise(seed) {
  var p = new Uint8Array(256), perm = new Uint8Array(512), s = seed >>> 0, i;
  function rnd() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }
  for (i = 0; i < 256; i++) p[i] = i;
  for (i = 255; i > 0; i--) { var j = Math.floor(rnd() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
  for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  var G = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1], F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  function simplex(xin, yin) {
    var sk = (xin + yin) * F2, ii = Math.floor(xin + sk), jj = Math.floor(yin + sk), t = (ii + jj) * G2;
    var x0 = xin - (ii - t), y0 = yin - (jj - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    var x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2, a = ii & 255, b = jj & 255, n = 0, g;
    var t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 > 0) { g = (perm[a + perm[b]] & 7) * 2; t0 *= t0; n += t0 * t0 * (G[g] * x0 + G[g + 1] * y0); }
    var t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 > 0) { g = (perm[a + i1 + perm[b + j1]] & 7) * 2; t1 *= t1; n += t1 * t1 * (G[g] * x1 + G[g + 1] * y1); }
    var t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 > 0) { g = (perm[a + 1 + perm[b + 1]] & 7) * 2; t2 *= t2; n += t2 * t2 * (G[g] * x2 + G[g + 1] * y2); }
    return 70 * n;
  }
  function fbm(x, y, oct, lac, gain) { var sum = 0, amp = 1, f = 1, norm = 0; for (var o = 0; o < oct; o++) { sum += amp * simplex(x * f, y * f); norm += amp; amp *= gain; f *= lac; } return sum / norm; }
  function ridged(x, y, oct, lac, gain) { var sum = 0, amp = 1, f = 1, norm = 0; for (var o = 0; o < oct; o++) { var r = 1 - Math.abs(simplex(x * f, y * f)); sum += amp * r * r; norm += amp; amp *= gain; f *= lac; } return sum / norm; }
  return {simplex: simplex, fbm: fbm, ridged: ridged};
}

function create(canvas, kit) {
  var ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Ridgeline needs Canvas 2D');
  var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0), dead = false;
  var settings = {look: 0, lines: 60, height: 100, speed: 100, hue: 0};
  // the look: COL (shadowing the module's palette) = the colours on screen, eased; palFrom = what the old background was baked with
  var LK = LOOKS[0], over = {lines: false, height: false, speed: false}, looks = 0, ready = false, xf = 1, spd = 1;
  var COL = {}, palF = {}, palFrom = null, bgOld = document.createElement('canvas');
  function copyPal(P) { var o = {}; PAL_KEYS.forEach(function(k) { o[k] = P[k].slice(); }); return o; }
  function want(k) { return over[k] ? settings[k] : LK[k]; }
  COL = copyPal(LK.pal); palF = copyPal(LK.pal);
  var size = [canvas.width || 1280, canvas.height || 800], time = 0, frames = 0, frameMs = 0;
  var noise = makeNoise(1919);
  var XS = new Float32Array(S), TT = new Float32Array(S), EDGE = new Float32Array(S), BEDGE = new Float32Array(S);
  for (var s0 = 0; s0 < S; s0++) { var t0 = s0 / (S - 1); TT[s0] = t0; XS[s0] = X0 + (X1 - X0) * t0; EDGE[s0] = smooth(0, 0.12, t0) * smooth(0, 0.12, 1 - t0); BEDGE[s0] = smooth(0, 0.03, t0) * smooth(0, 0.03, 1 - t0); }

  // the pulsar field: one Go profile per integer field row, cached in a ring; TEX keeps the ridged noise as texture for bodies and bursts
  var FLD = new Float32Array(CACHE * S), TEX = new Float32Array(CACHE * S), TAG = new Int32Array(CACHE).fill(-2147483647), rowsBuilt = 0;
  function fieldRow(r) {
    var slot = ((r % CACHE) + CACHE) % CACHE, o = slot * S;
    if (TAG[slot] === r) return o;
    TAG[slot] = r; rowsBuilt++;
    var seedY = r * 0.31, q = r / FIELD;
    var sub1 = 0.28 + 0.09 * noise.simplex(q * 3.2, 1.7), sub2 = -0.32 + 0.09 * noise.simplex(q * 3.2, 8.4);
    var burst = 0.72 + 0.42 * (noise.simplex(q * 5.5, 3.9) * 0.5 + 0.5);
    for (var s = 0; s < S; s++) {
      var u = TT[s] * 2 - 1, d1 = u - sub1, d2 = u - sub2;
      var env = Math.exp(-4.5 * u * u) + 0.45 * Math.exp(-12 * d1 * d1) + 0.4 * Math.exp(-14 * d2 * d2);
      var nx = u * 3.6, rid = noise.ridged(nx + 1.9, seedY, 4, 2.15, 0.52);
      var fb = 0.5 * (noise.fbm(nx * 1.6 - 2.4, seedY * 1.2 + 4.1, 4, 2, 0.5) + 1);
      var car = 0.5 + 0.5 * Math.cos((u * 18 + noise.simplex(nx * 2, seedY) * 1.8) * Math.PI);
      var center = (0.58 * Math.pow(rid, 1.25) + 0.27 * fb + 0.15 * car * rid) * env * burst;
      var flank = (0.018 * noise.simplex(u * 7.5, seedY * 1.5) + 0.012 * rid) * EDGE[s];
      var e = center * EDGE[s] + flank;
      FLD[o + s] = e < 0 ? e * 0.25 : e; TEX[o + s] = rid;
    }
    return o;
  }

  // body: which Kinect cell each (line, sample) maps to, and the eased mountain height there (design px)
  var MAP = new Int32Array(MAXL * S).fill(-1), BODY = new Float32Array(MAXL * S), mapAt = -1e9, mapLf = -1, bodyMax = 0;
  var ELEV = new Float32Array(S), FLASH = new Float32Array(MAXL), TGT = new Float32Array(S);
  var lf = want('lines'), roll = 0, hh = 1;
  function lineY(i) { return Y0 + i * (Y1 - Y0) / Math.max(1, lf - 1); }
  function buildMap(nowMs) {
    if (nowMs - mapAt < 2000 && Math.abs(lf - mapLf) < 0.01) return;
    mapAt = nowMs; mapLf = lf;
    var n = Math.min(MAXL, Math.ceil(lf - 1e-6));
    for (var i = 0; i < n; i++) {
      var y = lineY(i) / 800;
      for (var s = 0; s < S; s++) {
        var x = XS[s] / 1280, p = kit.fromScreen(x, y);
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) p = [x * 512, y * 424];
        var cx = Math.floor(p[0] / 4), cy = Math.floor(p[1] / 4);
        MAP[i * S + s] = cx >= 0 && cx < body.w && cy >= 0 && cy < body.h ? cy * body.w + cx : -1;
      }
    }
  }
  function updateBody(dt, peak) {
    var n = Math.min(MAXL, Math.ceil(lf - 1e-6)), k = ease(dt, 0.08), live = body.people.length > 0, mask = body.mask, sdf = body.sdf, gap = body.gap, mx = 0, H = 1.4 * peak, s;
    for (var i = 0; i < n; i++) {
      for (s = 0; s < S; s++) {                            // terrain: the outline is the foothill, the middle of the body the ridge
        var c = MAP[i * S + s], t = 0;
        if (live && c >= 0) {
          var m = mask[c];
          if (m > 0.02) {
            var inner = clamp((1 - sdf[c]) / 10, 0, 1), g = gap[c], close = g > 0 ? clamp(1 - (g - 250) / 1500, 0.35, 1) : 0.6;
            t = (0.2 * m + 0.8 * inner * (2 - inner)) * close * H;
          }
        }
        TGT[s] = t;
      }
      for (s = 0; s < S; s++) {                            // a 5-tap blur along the line turns cliffs into slopes
        var a = TGT[s > 1 ? s - 2 : 0], b = TGT[s > 0 ? s - 1 : 0], d = TGT[s < S - 1 ? s + 1 : S - 1], e = TGT[s < S - 2 ? s + 2 : S - 1];
        var j = i * S + s, tv = (a + 4 * b + 6 * TGT[s] + 4 * d + e) / 16 * BEDGE[s];
        BODY[j] += (tv - BODY[j]) * k;
        if (BODY[j] > mx) mx = BODY[j];
      }
    }
    bodyMax = mx;
  }

  // hands: rolling spikes, tap bursts, held peaks with drips
  var tracks = [], nextTid = 1, spikes = [], pulses = [], holds = [], bodyCount = 0, maxElev = 0;
  function vOf(y) { return clamp((y * 800 - Y0) / (Y1 - Y0) * FIELD, 0, FIELD); }   // a window y -> screen row (0 top .. FIELD bottom)
  function addPulse(x) {
    var env = new Float32Array(S);
    for (var s = 0; s < S; s++) { var d = XS[s] - x, a = d - 95, b = d + 105; env[s] = (Math.exp(-d * d / 28900) + 0.45 * Math.exp(-a * a / 3600) + 0.4 * Math.exp(-b * b / 3025)) * BEDGE[s]; }
    pulses.push({x: x, v: -4, env: env}); if (pulses.length > 4) pulses.shift();
  }
  function updateTracks(pts, dt) {
    var i, t;
    for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
    pts.forEach(function(p) {
      var best = null, bd = 0.12;
      tracks.forEach(function(q) { if (!q.seen) { var d = Math.hypot(q.x - p[0], q.y - p[1]); if (d < bd) { bd = d; best = q; } } });
      if (!best) { best = {id: nextTid++, x: p[0], y: p[1], ax: p[0], ay: p[1], still: 0, held: false, emit: 0, hold: null}; tracks.push(best); addPulse(p[0] * 1280); }
      best.seen = true; best.x = p[0]; best.y = p[1];
      if (Math.hypot(p[0] - best.ax, p[1] - best.ay) > 0.02) { best.ax = p[0]; best.ay = p[1]; best.still = 0; } else best.still += dt;
    });
    for (i = tracks.length - 1; i >= 0; i--) {
      t = tracks[i];
      if (!t.seen) { if (t.hold) { t.hold.alive = false; spikes.push({x: t.hold.x, v: t.hold.v, amp: t.hold.amp, age: 0}); } tracks.splice(i, 1); }
    }
    tracks.forEach(function(q) {
      q.held = q.still >= 0.9;
      if (q.held && !q.hold) { q.hold = {x: q.x * 1280, v: vOf(q.y), amp: 0.6, D: 0, len: 4, alive: true}; holds.push(q.hold); if (holds.length > 6) holds.shift(); }
      if (!q.held && q.hold) { q.hold.alive = false; spikes.push({x: q.hold.x, v: q.hold.v, amp: q.hold.amp, age: 0}); q.hold = null; }
      if (!q.held) { q.emit -= dt; if (q.emit <= 0) { q.emit = 0.07; spikes.push({x: q.x * 1280, v: vOf(q.y), amp: 1, age: 0}); } }
    });
    if (spikes.length > 90) spikes.splice(0, spikes.length - 90);
  }
  function updateEvents(dt) {
    var sp = spd, i;
    for (i = spikes.length - 1; i >= 0; i--) { var k = spikes[i]; k.v += 7 * (0.4 + 0.6 * sp) * dt; k.age += dt; k.amp *= Math.exp(-dt / 2.2); if (k.v > FIELD + 2 || k.amp < 0.03) spikes.splice(i, 1); }
    for (i = pulses.length - 1; i >= 0; i--) { pulses[i].v += 40 * dt; if (pulses[i].v > FIELD + 6) pulses.splice(i, 1); }
    for (i = holds.length - 1; i >= 0; i--) {
      var h = holds[i];
      if (h.alive) { h.amp += (1 - h.amp) * ease(dt, 0.5); h.D += (68 - h.D) * ease(dt, 1.3); h.len = Math.min(26, h.len + dt * 8); }
      else { h.amp *= Math.exp(-dt / 0.25); h.D *= Math.exp(-dt / 0.7); if (h.D < 0.5 && h.amp < 0.02) holds.splice(i, 1); }
    }
  }

  // --- background (ground, the pulsar's radio column, stars), rebuilt on resize and colour shift
  var bgc = document.createElement('canvas'), bgHue = null, stars = [], crest = null, crestKey = '', fills = [], pulseCol = '', runCol = '', builtFor = '';
  (function() { var r = 0x2b1919; function rnd() { r = (Math.imul(r, 1103515245) + 12345) >>> 0; return r / 4294967296; }
    for (var i = 0; i < 180; i++) { var x = rnd() * 1280, y = Math.pow(rnd(), 1.6) * 800 * 0.42, a = (0.18 + 0.42 * rnd()) * (1 - clamp(y / 336, 0, 1) * 0.65); stars.push({x: x, y: y, a: a, big: i % 14 === 0, r: 1.1 + 1.3 * rnd(), ph: rnd() * 6.28, m: rnd() * 0.35}); } })();
  function bakeInto(cv, H, P) {                          // the background picture for palette P (the current look, or the old one)
    var w = size[0], h = size[1], sx = w / 1280, sy = h / 800;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var g = cv.getContext('2d'), gr = hueRot(P.ground, H), tint = mixc(gr, hueRot(P.dusk, H), 0.14);
    var lo = document.createElement('canvas'); lo.width = 128; lo.height = 80;
    var lg = lo.getContext('2d'), img = lg.createImageData(128, 80);
    for (var y = 0; y < 80; y++) for (var x = 0; x < 128; x++) {
      var ux = x / 127 * 2 - 1, vy = y / 79, k = Math.exp(-5.5 * ux * ux) * Math.sin(vy * Math.PI) * 0.75, o = (y * 128 + x) * 4;
      img.data[o] = gr[0] + (tint[0] - gr[0]) * k; img.data[o + 1] = gr[1] + (tint[1] - gr[1]) * k; img.data[o + 2] = gr[2] + (tint[2] - gr[2]) * k; img.data[o + 3] = 255;
    }
    lg.putImageData(img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(lo, 0, 0, w, h);
    g.setTransform(sx, 0, 0, sy, 0, 0);
    g.globalCompositeOperation = 'lighter';
    for (var k2 = 0; k2 < 14; k2++) {                       // the soft vertical radio-beam column
      var kt = k2 / 13, gy = 0.14 * 800 + kt * 0.72 * 800, bc = hueRot(mixc(P.dusk, P.lilac, Math.sin(kt * Math.PI)), H);
      var rg = g.createRadialGradient(640, gy, 0, 640, gy, 72); rg.addColorStop(0, rgba(bc, 0.05)); rg.addColorStop(1, rgba(bc, 0));
      g.fillStyle = rg; g.fillRect(568, gy - 72, 144, 144);
    }
    stars.forEach(function(st) {
      var c = hueRot(mixc(P.star, P.lilac, st.m), H);
      if (st.big) { var sg = g.createRadialGradient(st.x, st.y, 0, st.x, st.y, st.r * 2.6); sg.addColorStop(0, rgba(c, 0.5 * st.a / 0.6)); sg.addColorStop(1, rgba(c, 0)); g.fillStyle = sg; g.fillRect(st.x - st.r * 3, st.y - st.r * 3, st.r * 6, st.r * 6); }
      else { g.fillStyle = rgba(c, st.a); g.fillRect(st.x - 0.6, st.y - 0.6, 1.2, 1.2); }
    });
    g.globalCompositeOperation = 'source-over';
  }
  function buildCols(H) {                                 // the line fills and the event colours, from the colours on screen (cheap)
    var gr = hueRot(COL.ground, H);
    fills = [];
    for (var f = 0; f < 32; f++) fills.push(rgba(mixc(gr, hueRot(COL.violetFill, H), 0.18 + 0.22 * f / 31 + 0.25), 0.985));
    pulseCol = rgba(hueRot(COL.pulse, H), 1); runCol = rgba(hueRot(COL.ice, H), 1);
    crestKey = '';
  }
  function buildBg(H) {
    bakeInto(bgc, H, LK.pal);
    if (xf < 1 && palFrom) bakeInto(bgOld, H, palFrom);
    bgHue = H; builtFor = size[0] + 'x' + size[1];
    buildCols(H);
  }
  // --- looks
  function applyLook(i) {
    LK = LOOKS[i]; over.lines = over.height = over.speed = false; looks++;
    if (!ready) return;                                   // create(): the snap below starts on the stored look without a fade
    palFrom = copyPal(COL); xf = 0;                       // what is on screen now is the old background
    buildBg(bgHue === null ? hueFlow.value : bgHue);
  }
  function stepLook(dt) {
    spd += (want('speed') / 100 - spd) * ease(dt, 0.5);
    if (xf >= 1) return;
    var kp = ease(dt, 0.25), done = true;
    PAL_KEYS.forEach(function(k) {
      var c = palF[k], t = LK.pal[k], r = COL[k];
      for (var j = 0; j < 3; j++) { c[j] += (t[j] - c[j]) * kp; if (Math.abs(t[j] - c[j]) > 0.4) done = false; r[j] = Math.round(c[j]); }
    });
    xf += (1 - xf) * kp;
    if (done && xf > 0.996) { xf = 1; palF = copyPal(LK.pal); COL = copyPal(LK.pal); palFrom = null; }
    buildCols(hueFlow.value);
  }
  function crestGrad(H, peak) {                           // elevation colour, in base-relative space (y up = negative)
    var key = Math.round(H * 2) + ':' + Math.round(peak * 4);
    if (key === crestKey && crest) return crest;
    var g = ctx.createLinearGradient(0, 0, 0, -0.85 * peak);
    g.addColorStop(0, rgba(hueRot(COL.flank, H), 0.82)); g.addColorStop(0.3, rgba(hueRot(COL.mist, H), 0.92)); g.addColorStop(0.62, rgba(hueRot(COL.pale, H), 1));
    g.addColorStop(1, rgba(hueRot(COL.ivory, H), 1));
    crest = g; crestKey = key; return g;
  }

  function render() {
    var w = size[0], h = size[1], sx = w / 1280, sy = h / 800, H = hueFlow.value, peak = PEAK * hh, i, s;
    var dh = bgHue === null ? 999 : Math.abs(((H - bgHue + 540) % 360) - 180);
    if (builtFor !== w + 'x' + h || dh > 1 || (dh > 0.01 && Math.abs(((settings.hue - H + 540) % 360) - 180) < 0.01)) buildBg(H);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(bgc, 0, 0);
    if (xf < 1 && palFrom) { ctx.globalAlpha = 1 - xf; ctx.drawImage(bgOld, 0, 0); ctx.globalAlpha = 1; }   // a look change: the old background fades out
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    var sc = rgba(hueRot(COL.pale, H), 1); ctx.fillStyle = sc;   // a few stars breathe
    for (i = 0; i < stars.length; i += 9) { var st = stars[i]; ctx.globalAlpha = st.a * 0.9 * Math.max(0, Math.sin(time * 0.7 + st.ph)); ctx.fillRect(st.x - 0.9, st.y - 0.9, 1.8, 1.8); }
    ctx.globalAlpha = 1;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    var cg = crestGrad(H, peak), n = Math.min(MAXL, Math.ceil(lf - 1e-6)), span = Y1 - Y0, mx = 0, lw = clamp(Math.sqrt(60 / lf), 0.8, 1.2);
    for (i = 0; i < n; i++) {
      var yb = lineY(i), vS = (yb - Y0) / span * FIELD, rowFrac = clamp((yb - Y0) / span, 0, 1), fv = vS - roll, r0 = Math.floor(fv), fr = fv - r0;
      var oa = fieldRow(r0), ob = fieldRow(r0 + 1), bo = i * S, sag = 0, flash = 0, runW = 0, runA = 0, runB = 0, k;
      for (s = 0; s < S; s++) {
        var fa = FLD[oa + s], fb = FLD[ob + s], tex = TEX[oa + s] + (TEX[ob + s] - TEX[oa + s]) * fr;
        ELEV[s] = (fa + (fb - fa) * fr) * peak + BODY[bo + s] * (0.7 + 0.6 * tex);
      }
      for (k = 0; k < spikes.length; k++) {               // fingertip spikes sit on the one or two lines they are between
        var sk = spikes[k], dv = Math.abs(vS - sk.v); if (dv >= 1) continue;
        var a1 = (1 - dv) * sk.amp * 1.25 * peak, s1 = Math.max(0, Math.floor((sk.x - 44 - X0) / (X1 - X0) * (S - 1))), s2 = Math.min(S - 1, Math.ceil((sk.x + 44 - X0) / (X1 - X0) * (S - 1)));
        for (s = s1; s <= s2; s++) { var dx = (XS[s] - sk.x) / 11; ELEV[s] += a1 * Math.exp(-dx * dx); }
      }
      for (k = 0; k < pulses.length; k++) {               // a tap's pulsar burst running down the stack
        var pu = pulses[k], d2 = (vS - pu.v) / 1.6; if (d2 * d2 > 9) continue;
        var wq = Math.exp(-d2 * d2); flash += wq;
        for (s = 0; s < S; s++) if (pu.env[s] > 0.01) ELEV[s] += wq * pu.env[s] * (0.55 + 0.75 * TEX[ob + (s + 61) % S]) * 1.15 * peak;
      }
      for (k = 0; k < holds.length; k++) {                // a held peak, and the ridges below it dripping
        var ho = holds[k], dvh = vS - ho.v, sa1, sa2;
        if (Math.abs(dvh) < 1) {
          var ah = (1 - Math.abs(dvh)) * ho.amp * 1.35 * peak; sa1 = Math.max(0, Math.floor((ho.x - 52 - X0) / (X1 - X0) * (S - 1))); sa2 = Math.min(S - 1, Math.ceil((ho.x + 52 - X0) / (X1 - X0) * (S - 1)));
          for (s = sa1; s <= sa2; s++) { var dxh = (XS[s] - ho.x) / 13; ELEV[s] += ah * Math.exp(-dxh * dxh); }
        }
        if (dvh > 0 && ho.D > 0.3) {                       // the run: lines below sag together and the paint smooths the pulsar noise away
          var Wn = smooth(0, 1.5, dvh) * Math.exp(-dvh / ho.len), Wd = Wn * ho.D, sig = 30 * (1 - 0.35 * Math.min(1, dvh / ho.len));
          if (Wd > 0.3) { sa1 = Math.max(0, Math.floor((ho.x - 3 * sig - X0) / (X1 - X0) * (S - 1))); sa2 = Math.min(S - 1, Math.ceil((ho.x + 3 * sig - X0) / (X1 - X0) * (S - 1)));
            var flat = Math.min(0.85, ho.D / 68 * 0.85 * Math.min(1, Wn * 1.6));
            for (s = sa1; s <= sa2; s++) { var dxd = (XS[s] - ho.x) / sig, gd = Math.exp(-dxd * dxd); ELEV[s] = ELEV[s] * (1 - flat * gd) - Wd * gd; }
            if (Wd > sag) sag = Wd;
            if (Wd > runW) { runW = Wd; runA = sa1; runB = sa2; } }
        }
      }
      var emax = yb - 14, knee = 0.72 * emax, room = emax - knee;   // a soft ceiling: peaks bend under the top of the wall instead of leaving it
      for (s = 0; s < S; s++) { var ev = ELEV[s]; if (ev > knee) ELEV[s] = knee + room * (1 - Math.exp(-(ev - knee) / room)); }
      FLASH[i] = flash;
      var alpha = i === n - 1 && lf < n ? clamp(lf - (n - 1), 0, 1) : 1;
      ctx.setTransform(sx, 0, 0, sy, 0, sy * yb);
      ctx.globalAlpha = alpha;
      // horizon occlusion: the ridge closed down below the base, filled with the violet-tinted ground
      ctx.beginPath(); ctx.moveTo(XS[0], -ELEV[0]);
      for (s = 1; s < S; s++) { ctx.lineTo(XS[s], -ELEV[s]); if (ELEV[s] > mx) mx = ELEV[s]; }
      ctx.lineTo(X1, DROP + sag); ctx.lineTo(X0, DROP + sag); ctx.closePath();
      ctx.fillStyle = fills[Math.round(rowFrac * 31)]; ctx.fill();
      // the crest: a soft glow under a crisp line, both coloured by height
      ctx.beginPath(); ctx.moveTo(XS[0], -ELEV[0]);
      for (s = 1; s < S; s++) ctx.lineTo(XS[s], -ELEV[s]);
      ctx.strokeStyle = cg;
      ctx.globalAlpha = alpha * Math.min(0.6, 0.2 + 0.1 * rowFrac + 0.3 * flash); ctx.lineWidth = 4.6 * lw; ctx.stroke();
      ctx.globalAlpha = alpha * 0.94; ctx.lineWidth = (1.45 + 0.45 * rowFrac) * 1.333 * lw; ctx.stroke();
      if (flash > 0.05) { ctx.strokeStyle = pulseCol; ctx.globalAlpha = alpha * Math.min(0.85, flash * 0.75); ctx.lineWidth = 2.2; ctx.stroke(); }
      if (runW > 2) {                                      // the dripping part of the line, in ice
        ctx.beginPath(); ctx.moveTo(XS[runA], -ELEV[runA]); for (s = runA + 1; s <= runB; s++) ctx.lineTo(XS[s], -ELEV[s]);
        ctx.strokeStyle = runCol; ctx.globalAlpha = alpha * Math.min(0.75, runW / 50); ctx.lineWidth = 2.4; ctx.stroke();
      }
    }
    maxElev = mx;
    ctx.globalAlpha = 1; ctx.setTransform(sx, 0, 0, sy, 0, 0);
    var vg = ctx.createRadialGradient(640, 400, 280, 640, 400, 830); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, 1280, 800);
    // fingertips: a faint ring; a still finger charges an arc
    var rc = hueRot(COL.ice, H), ic = hueRot(COL.ivory, H);
    tracks.forEach(function(t) {
      var x = t.x * 1280, y = t.y * 800, prog = t.held ? 1 : clamp((t.still - 0.25) / 0.65, 0, 1);
      ctx.strokeStyle = rgba(rc, 0.35); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI * 2); ctx.stroke();
      if (prog > 0) { ctx.strokeStyle = rgba(ic, 0.6); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog); ctx.stroke(); }
    });
  }

  function frame(dt, now) {
    if (dead) return;
    var t0 = performance.now();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
    hueFlow.step(settings.hue, dt);
    stepLook(dt);
    var linesT = want('lines');
    lf += (linesT - lf) * ease(dt, 0.4); if (Math.abs(lf - linesT) < 0.002) lf = linesT;
    hh += (want('height') / 100 - hh) * ease(dt, 0.25);
    roll += dt * 0.9 * spd;
    if (roll > 1e6) roll -= 1e6;
    body.update(dt, now);
    bodyCount = body.fresh ? body.people.length : 0;
    buildMap(now); updateBody(dt, PEAK * hh);
    updateTracks(input.read(), dt);
    updateEvents(dt);
    render();
    frameMs = performance.now() - t0;
  }
  function resize(w, h) { if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return; size = [w, h]; }
  var LIM = {look: [0, LOOKS.length - 1], lines: [30, 90], height: [30, 200], speed: [0, 300], hue: [0, 360]};
  function set(o) {
    if (o && typeof o === 'object') {
      var lk = o.look;                                    // the look first: it clears the knob overrides
      if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
      ['lines', 'height', 'speed'].forEach(function(k) {  // a knob that MOVED overrides the look's value until the next look
        var v = o[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
        v = clamp(v, LIM[k][0], LIM[k][1]); if (v !== settings[k]) { settings[k] = v; over[k] = true; }
      });
      var hv = o.hue; if (typeof hv === 'number' && Number.isFinite(hv)) settings.hue = clamp(hv, LIM.hue[0], LIM.hue[1]);
    }
    return Object.assign({}, settings);
  }
  function destroy() {
    if (dead) return; dead = true;
    tracks = []; spikes = []; pulses = []; holds = []; input.clear(); kit.wantDepth(false);
    bgc.width = 1; bgc.height = 1; bgOld.width = 1; bgOld.height = 1;
    if (window.RidgelineSet === set) delete window.RidgelineSet;
  }
  resize(canvas.width, canvas.height);
  kit.wantDepth(true);
  window.RidgelineSet = set; if (window._ridgelineFx) set(window._ridgelineFx);
  LK = LOOKS[settings.look]; COL = copyPal(LK.pal); palF = copyPal(LK.pal); palFrom = null; xf = 1; bgHue = null; ready = true;   // start on the stored look without easing in
  hueFlow.snap(settings.hue); lf = want('lines'); hh = want('height') / 100; spd = want('speed') / 100;
  var out = {frame: frame, touch: function(t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
  if (window.WallTest) out.debug = function() {
    return {frames: frames, frameMs: frameMs, lines: lf, roll: roll, rowsBuilt: rowsBuilt, contacts: tracks.length, held: tracks.filter(function(t) { return t.held; }).length,
      spikes: spikes.length, pulses: pulses.length, holds: holds.map(function(h) { return {x: h.x, v: h.v, amp: h.amp, D: h.D, len: h.len, alive: h.alive}; }),
      bodyCount: bodyCount, bodyMax: bodyMax, maxElev: maxElev, displayHue: hueFlow.value,
      look: LK.name, looks: looks, overrides: Object.assign({}, over), fade: xf, eased: {lines: lf, height: hh, speed: spd}, settings: set(), destroyed: dead};
  };
  return out;
}
})();
