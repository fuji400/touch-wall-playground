/* Spiral (genart lab, p5-experiments batch, 2026-10-22). lab/plugins/spiralgon.js
   After "spiral" by Maksim Vasilyev, p5-experiments (https://github.com/vasilyev-maksim/p5-experiments), CC BY-NC 4.0; studio use, non-commercial.
   A coiled tube of 500 polygons receding into a spiral, exactly the author's construction: node i sits i*step from the centre at the
   angle i*coil*sin(t/coilSpeed) + t*rotation (degrees), its profile is a regular polygon of radius (distance / thickness) with fixed
   orientation (line, triangle ... 10-gon, circle), filled on the author's two-colour lerp sin(t*colourSpeed + i/500*1440) (clamped, so
   half the tube is the first colour) with a one-pixel border, drawn centre outwards so the outer, bigger polygons overlap the inner.
   Live: the spiral's centre sits on the nearest person's chest (glides there), and how fast that person moves sets how fast it turns;
   with nobody it drifts. A hand: x is the rotation speed (left of centre turns it back, the middle stops it, right turns it forward),
   moving it up and down winds and unwinds the coil (relative to where it landed, so a touch never jumps the picture). Tap: the next
   profile shape runs out along the tube as a wave (triangle .. 10-gon, circle, triangle ...). Hold: the view zooms in on the hand's point of the spiral, back out on release.
   Two hands: two spirals, one per half of the wall, each hand driving its own. A person's own polygons turn photographic negative.
   Knobs: look (the author's presets), sides (0 = the look's own, 2..10, 11 = circle), zoom (% of the look's), speed (% of the author's
   clock: rotation, coil oscillation and colour cycling), hue. Canvas 2D: one path per polygon (painter's order matters), fill strings quantised and cached, off-screen and sub-pixel
   polygons culled. ASCII only. */
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

registerWallPlugin({id: 'spiralgon', title: 'Spiral', author: 'Builder H (genart, p5-experiments batch)', create: create});

var DEG = Math.PI / 180, NODES = 500, CIRCLE = 11, Q = 48, LW = 1.25;
// the author's colours (controls.ts): FILL_COLORS pairs and BORDER_COLOR
var FILLS = [[[0x67, 0x03, 0x74], [0x2d, 0x01, 0x93]], [[0x34, 0x09, 0x98], [0xea, 0x72, 0xf7]], [[0xff, 0x4b, 0x4b], [0xf0, 0xf6, 0x89]],
             [[0x13, 0x00, 0x5f], [0xa3, 0xff, 0x9a]], [[0, 0, 0], [255, 255, 255]], [[0x67, 0x03, 0x74], [0x67, 0x03, 0x74]]];
var BORDERS = [[255, 0, 0], [0xaa, 0, 255], [0, 0xa6, 255], [0, 255, 0x4c], [255, 255, 255], [0, 0, 0]];
// the author's presets (presets.ts): n = POLYGON_N, th = THICKNESS, coil = COIL_FACTOR, cs = COIL_SPEED, zoom, rot = ROTATION_SPEED,
// ccs = COLOR_CHANGE_SPEED, fill / border = colour indices, rate = timeDelta, start = startTime
var LOOKS = [
  {name: 'spiral',      n: 5,  th: 18, coil: 2,   cs: 10, zoom: 2,   rot: 1.5, ccs: 10, fill: 0, border: 0, rate: 1,   start: 1002},
  {name: 'whirlpool',   n: 10, th: 17, coil: 25,  cs: 7,  zoom: 1.5, rot: 7,   ccs: 0,  fill: 4, border: 4, rate: 1,   start: 940},
  {name: 'glimmer',     n: 3,  th: 2,  coil: 28,  cs: 1,  zoom: 2,   rot: 10,  ccs: 10, fill: 4, border: 5, rate: 1,   start: -256},
  {name: 'carousel',    n: 6,  th: 9,  coil: 52,  cs: 2,  zoom: 5,   rot: 8,   ccs: -7, fill: 2, border: 5, rate: 1,   start: 450},
  {name: 'mandala',     n: 11, th: 11, coil: 65,  cs: 1,  zoom: 2,   rot: 6,   ccs: 10, fill: 0, border: 4, rate: 1,   start: 1082},
  {name: 'hexornado',   n: 6,  th: 20, coil: 100, cs: 10, zoom: 20,  rot: 10,  ccs: 10, fill: 1, border: 5, rate: 0.1, start: 940},
  {name: 'subatomic',   n: 7,  th: 2,  coil: 62,  cs: 10, zoom: 2,   rot: 10,  ccs: 10, fill: 1, border: 5, rate: 1,   start: 0},
  {name: 'phase space', n: 2,  th: 2,  coil: 42,  cs: 1,  zoom: 2,   rot: 10,  ccs: 1,  fill: 0, border: 0, rate: 1,   start: 858}
];
// unit polygons with the author's fixed orientation (vertex k at k*360/n degrees)
var POLY = [];
for (var pn = 2; pn <= 10; pn++) { var pv = []; for (var pk = 0; pk < pn; pk++) pv.push(Math.cos(pk * 2 * Math.PI / pn), Math.sin(pk * 2 * Math.PI / pn)); POLY[pn] = pv; }

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }
function hueRot(c, deg) {                        // the CSS hue-rotate matrix
  if (!deg) return c;
  var a = Math.cos(deg * DEG), b = Math.sin(deg * DEG), r = c[0], g = c[1], bl = c[2];
  return [clamp((0.213 + 0.787 * a - 0.213 * b) * r + (0.715 - 0.715 * a - 0.715 * b) * g + (0.072 - 0.072 * a + 0.928 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a + 0.143 * b) * r + (0.715 + 0.285 * a + 0.140 * b) * g + (0.072 - 0.072 * a - 0.283 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a - 0.787 * b) * r + (0.715 - 0.715 * a + 0.715 * b) * g + (0.072 + 0.928 * a + 0.072 * b) * bl, 0, 255)];
}
function css(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }

function create(canvas, kit) {
  var ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Spiral needs Canvas 2D');
  if (!window.WallBody) throw new Error('Spiral needs plugins/body.js');
  var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0), dead = false;
  var settings = {look: 4, sides: 0, zoom: 100, speed: 50, hue: 0};
  var size = [canvas.width || 1280, canvas.height || 800], time = 0, frames = 0, frameMs = 0, drawn = 0, bodyCount = 0;
  // eased look values shared by both spirals
  var E = {th: 0, zoom: 1, rate: 1, ccs: 0, spinK: 0.5};
  var colA = [0, 0, 0], colB = [0, 0, 0], colBd = [0, 0, 0], fillStr = new Array(Q), negStr = new Array(Q), borderStr = '#000', borderNeg = '#fff', strKey = '';
  var shapeNow = 5, shapeFrom = 5, shapeT0 = -1e9, tapShape = 0, lastLook = -1, lastSides = -1, steps = 0;

  // the body: a 64 x 40 screen grid -> mask cell (rebuilt every 2 s), and the chest of the person the spiral follows
  var GW = 64, GH = 40, gridIdx = new Int32Array(GW * GH).fill(-1), gridAt = -1e9, personId = null;
  var pSm = null, pSpeed = 0, insideN = 0;

  function lookOf() { return LOOKS[clamp(Math.round(settings.look), 0, LOOKS.length - 1)]; }
  function wantShape() { var L = lookOf(), s = Math.round(settings.sides); return tapShape || (s >= 2 ? s : L.n); }
  function spiral(x) {
    return {cx: x, cy: 400, tx: x, ty: 400, rotPhase: 0, rotRate: 0, C: 0, os: 0, colArg: 0, zv: 1, ax: 640, ay: 400, grow: 1,
            drive: null, c0: 0, y0: 0, prevTarget: null, held: false};
  }
  var SP = [spiral(640), spiral(960)]; SP[1].grow = 0;
  var tracks = [], nextTid = 1, kind = 'one', kindT = 0, seam = 1280, taps = 0, holds = 0;

  function snapLook() {
    var L = lookOf(), F = FILLS[L.fill];
    E.th = L.th; E.zoom = L.zoom * settings.zoom / 100; E.rate = L.rate; E.ccs = L.ccs; E.spinK = settings.speed / 100;
    colA = F[0].slice(); colB = F[1].slice(); colBd = BORDERS[L.border].slice();
    SP.forEach(function(s) {
      var ce = L.cs ? 12 - L.cs : 0;
      s.os = ce ? L.start / ce : 0; s.rotPhase = (L.start * L.rot) % 360; s.colArg = (L.start * L.ccs) % 360;
      s.C = ce ? L.coil * Math.sin(s.os * DEG) : L.coil; s.rotRate = L.rot * E.spinK * L.rate;
    });
    shapeNow = shapeFrom = wantShape(); lastLook = Math.round(settings.look); lastSides = Math.round(settings.sides);
  }

  function screenOf(u, v) { var s = kit.toScreen(u, v); return s && Number.isFinite(s[0]) && Number.isFinite(s[1]) ? s : [u / 512, v / 424]; }
  function buildGrid(nowMs) {
    if (nowMs - gridAt < 2000) return;
    gridAt = nowMs;
    for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) {
      var x = (gx + 0.5) / GW, y = (gy + 0.5) / GH, p = kit.fromScreen(x, y);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) p = [x * 512, y * 424];
      var cx = Math.floor(p[0] / 4), cy = Math.floor(p[1] / 4);
      gridIdx[gy * GW + gx] = cx >= 0 && cx < body.w && cy >= 0 && cy < body.h ? cy * body.w + cx : -1;
    }
  }
  function inBody(x, y) {                          // design px -> is a person here
    var gx = (x / 20) | 0, gy = (y / 20) | 0;
    if (x < 0 || y < 0 || gx >= GW || gy >= GH) return false;
    var j = gridIdx[gy * GW + gx];
    return j >= 0 && body.mask[j] > 0.5;
  }
  function person(dt) {                            // the person the spiral follows (kept by id), their chest and how fast they move
    if (!body.fresh || !body.people.length) { personId = null; pSm = null; pSpeed *= Math.exp(-dt / 0.6); return null; }
    var p = null, i;
    for (i = 0; i < body.people.length; i++) if (body.people[i].id === personId) p = body.people[i];
    if (!p) { p = body.people[0]; personId = p.id; pSm = null; }
    var s = screenOf(p.cx * 512, (p.top + 0.3 * (p.bottom - p.top)) * 424), x = clamp(s[0], 0.12, 0.88) * 1280, y = clamp(s[1], 0.22, 0.78) * 800;
    if (!pSm) pSm = [x, y, x, y];
    var k = ease(dt, 0.25), ox = pSm[0], oy = pSm[1];
    pSm[0] += (x - pSm[0]) * k; pSm[1] += (y - pSm[1]) * k;
    var v = dt > 0 ? Math.hypot(pSm[0] - ox, pSm[1] - oy) / dt / 1280 : 0;       // window widths per second
    pSpeed += (v - pSpeed) * ease(dt, 0.6);
    return {x: pSm[0], y: pSm[1]};
  }

  var tapInput = tapGesture(kit, input, 350);
  function updateTracks(pts, dt) {
    var i;
    for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
    pts.forEach(function(p) {
      var best = null, bd = 0.12;
      tracks.forEach(function(q) { if (!q.seen) { var d = Math.hypot(q.x - p[0], q.y - p[1]); if (d < bd) { bd = d; best = q; } } });
      if (!best) { best = {id: nextTid++, x: p[0], y: p[1], ax: p[0], ay: p[1], still: 0, held: false}; tracks.push(best); }
      best.seen = true; best.x = p[0]; best.y = p[1]; tapInput.observe(best, p[0], p[1]);
      if (Math.hypot(p[0] - best.ax, p[1] - best.ay) > 0.02) { best.ax = p[0]; best.ay = p[1]; best.still = 0; } else best.still += dt;
    });
    for (i = tracks.length - 1; i >= 0; i--) if (!tracks[i].seen) { if (tapInput.release(tracks[i])) stepShape(); tracks.splice(i, 1); }
    tracks.forEach(function(q) { var was = q.held; q.held = q.still >= 0.9; if (q.held && !was) holds++; });
  }
  function stepShape() {                           // a tap: the next profile, 3..10 then circle then back to a triangle (the line is
    var cur = shapeNow; tapShape = cur >= CIRCLE ? 3 : cur + 1; steps++; taps++;     // a look of its own, phase space, and the Profile knob)
  }

  function steer(dt) {
    var L = lookOf(), n = tracks.length, A = SP[0], B = SP[1], k35 = ease(dt, 0.35);
    var want = n >= 2 ? 'two' : 'one';
    if (want === kind) kindT = 0; else { kindT += dt; if (kindT >= 0.4) { kind = want; kindT = 0; } }
    var sorted = tracks.slice().sort(function(a, b) { return a.x - b.x; });
    var drv = kind === 'two' ? [sorted[0] || null, n >= 2 ? sorted[n - 1] : null] : [sorted[0] || null, null];
    if (kind === 'two' && n === 1) drv = sorted[0].x < 0.5 ? [sorted[0], null] : [null, sorted[0]];
    seam += ((kind === 'two' ? 640 : 1280) - seam) * ease(dt, 0.45);
    var ps = person(dt), ce = L.cs ? 12 - L.cs : 0, adv = dt * 60 * E.rate * E.spinK;      // the author's clock, at the speed knob's tempo
    for (var r = 0; r < 2; r++) {
      var s = SP[r], t = drv[r];
      if (kind === 'two') { s.tx = r ? 960 : 320; s.ty = 400; }
      else if (r === 0) { if (ps) { s.tx = ps.x; s.ty = ps.y; } else { s.tx = 640 + 70 * Math.sin(time * 0.07); s.ty = 400 + 45 * Math.sin(time * 0.053 + 1); } }
      else { s.tx = 960; s.ty = 400; }
      s.grow += ((r === 0 || kind === 'two' ? 1 : 0) - s.grow) * ease(dt, 0.35);
      if (r === 1 && s.grow < 0.02) { s.cx = s.tx; s.cy = s.ty; }
      s.cx += (s.tx - s.cx) * ease(dt, 0.6); s.cy += (s.ty - s.cy) * ease(dt, 0.6);
      // coil: the author's oscillation; a hand winds it relative to where it landed; on release the oscillation picks up from there
      s.os = (s.os + (ce ? adv / ce : 0)) % 360;
      var target = ce ? L.coil * Math.sin(s.os * DEG) : L.coil;
      if (t && s.drive !== t.id) { s.drive = t.id; s.c0 = s.C; s.y0 = t.y; }
      if (!t && s.drive !== null) {
        s.drive = null;
        if (ce && L.coil > 0 && Math.abs(s.C) <= L.coil) {              // pick the oscillation phase that matches where the hand left it
          var a0 = Math.asin(clamp(s.C / L.coil, -1, 1)) / DEG, c1 = Math.cos(s.os * DEG) >= 0;
          s.os = c1 ? a0 : 180 - a0; target = L.coil * Math.sin(s.os * DEG);
        }
        s.prevTarget = null;
      }
      if (t) target = s.c0 + (s.y0 - t.y) * 32;
      // follow a moving target without lag, but glide over its jumps
      var dT = s.prevTarget === null ? 0 : target - s.prevTarget; s.prevTarget = target;
      if (Math.abs(dT) > 2) dT = 0;
      s.C += dT; s.C += (target - s.C) * k35;
      // rotation: the hand's x (in its half), else the person's speed, else the author's speed
      var rotT = L.rot * E.spinK * E.rate;
      if (t) {
        var z0 = kind === 'two' ? (r ? 0.5 : 0) : 0, z1 = kind === 'two' ? (r ? 1 : 0.5) : 1, xn = clamp((t.x - z0) / (z1 - z0), 0, 1) * 2 - 1;
        if (Math.abs(xn) < 0.08) xn = 0; else xn = (xn - (xn > 0 ? 0.08 : -0.08)) / 0.92;
        rotT = xn * 10 * Math.max(E.spinK, 0.25) * 2;
      } else if (ps && r === 0 && kind === 'one') rotT = L.rot * E.spinK * (0.4 + 2.6 * clamp(pSpeed / 0.35, 0, 1));
      s.rotRate += (rotT - s.rotRate) * k35;
      s.rotPhase = (s.rotPhase + s.rotRate * dt * 60) % 360;
      s.colArg = (s.colArg + E.ccs * adv) % 360;
      // hold: zoom in on the hand's point
      s.held = !!(t && t.held);
      if (s.held) { s.ax = t.x * 1280; s.ay = t.y * 800; }
      s.zv += ((s.held ? 2.6 : 1) - s.zv) * ease(dt, s.held ? 0.6 : 0.45);
    }
  }

  function refreshColours() {
    var H = hueFlow.value, A = hueRot(colA, H), B = hueRot(colB, H), D = hueRot(colBd, H);
    var key = Math.round(A[0]) + ',' + Math.round(A[1]) + ',' + Math.round(A[2]) + '|' + Math.round(B[0]) + ',' + Math.round(B[1]) + ',' + Math.round(B[2]) + '|' + css(D);
    if (key === strKey) return;
    strKey = key;
    for (var q = 0; q < Q; q++) {
      var t = q / (Q - 1), c = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
      fillStr[q] = css(c); negStr[q] = css([255 - c[0], 255 - c[1], 255 - c[2]]);     // a person's own polygons: the photographic negative
    }
    borderStr = css(D); borderNeg = css([255 - D[0], 255 - D[1], 255 - D[2]]);
  }

  function drawSpiral(s, x0, x1, sx, sy) {
    var g = s.grow; if (g < 0.02) return;
    var step = E.zoom * 1280 / 1158 * g, T = Math.max(1, 22 - E.th), zv = s.zv, ax = s.ax, ay = s.ay, cx = s.cx, cy = s.cy;
    // the view: scale zv about the anchor; work out the visible rect in spiral space for culling
    var vx0 = ax + (x0 - ax) / zv, vx1 = ax + (x1 - ax) / zv, vy0 = ay + (0 - ay) / zv, vy1 = ay + (800 - ay) / zv;
    var far = Math.max(Math.hypot(vx0 - cx, vy0 - cy), Math.hypot(vx1 - cx, vy0 - cy), Math.hypot(vx0 - cx, vy1 - cy), Math.hypot(vx1 - cx, vy1 - cy));
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, 800); ctx.clip();
    ctx.setTransform(sx * zv, 0, 0, sy * zv, sx * (ax - ax * zv), sy * (ay - ay * zv));
    ctx.lineWidth = LW / zv; ctx.strokeStyle = borderStr; ctx.lineJoin = 'miter';
    var front = (time - shapeT0) / 0.7 * (NODES + 40), C = s.C, rp = s.rotPhase, ca = s.colArg, lastQ = -1, useBody = bodyCount > 0, neg = false;
    for (var i = 0; i < NODES; i++) {
      var d = i * step, rad = d / T;
      if (d - rad > far) break;                    // every later node is further out still
      var bump = 0, shp = shapeNow;
      if (front < NODES + 40) { shp = i < front ? shapeNow : shapeFrom; var q0 = (i - front) / 22; bump = Math.exp(-q0 * q0); }
      rad *= 1 + 0.55 * bump;
      if (rad * zv < 0.35) continue;               // sub-pixel
      var ang = (i * C + rp) * DEG, x = cx + d * Math.cos(ang), y = cy + d * Math.sin(ang);
      if (x + rad < vx0 || x - rad > vx1 || y + rad < vy0 || y - rad > vy1) continue;
      var tt = Math.sin((ca + i / NODES * 1440) * DEG); if (tt < 0) tt = 0;
      var qi = (tt * (Q - 1) + 0.5) | 0;
      var inside = useBody && inBody(ax + (x - ax) * zv, ay + (y - ay) * zv);
      if (inside) { insideN++; qi += Q; }
      if (inside !== neg) { neg = inside; ctx.strokeStyle = neg ? borderNeg : borderStr; }
      if (qi !== lastQ) { ctx.fillStyle = qi >= Q ? negStr[qi - Q] : fillStr[qi]; lastQ = qi; }
      ctx.beginPath();
      if (shp >= CIRCLE) { ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      else {
        var P = POLY[shp] || POLY[2], m = P.length;
        ctx.moveTo(x + P[0] * rad, y + P[1] * rad);
        for (var k = 2; k < m; k += 2) ctx.lineTo(x + P[k] * rad, y + P[k + 1] * rad);
        ctx.closePath();
        if (m > 4) ctx.fill();
        ctx.stroke();
      }
      drawn++;
    }
    ctx.restore();
  }

  function render() {
    var sx = size[0] / 1280, sy = size[1] / 800;
    ctx.setTransform(sx, 0, 0, sy, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1280, 800);
    drawn = 0; insideN = 0;
    // two spirals: the left one ends at the seam; going back to one, the main spiral runs full width again and the right one fades off it
    var sm = Math.round(seam), two = kind === 'two', B = SP[1];
    drawSpiral(SP[0], 0, two ? sm : 1280, sx, sy);
    if (sm < 1279 && B.grow > 0.02) {
      ctx.globalAlpha = two ? 1 : clamp(B.grow, 0, 1); ctx.fillStyle = '#000'; ctx.fillRect(sm, 0, 1280 - sm, 800); ctx.globalAlpha = 1;
      drawSpiral(B, sm, 1280, sx, sy);
    }
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
  }

  function frame(dt, now) {
    if (dead) return;
    var t0 = performance.now();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
    hueFlow.step(settings.hue, dt);
    var L = lookOf(), F = FILLS[L.fill], k = ease(dt, 0.35), c;
    E.th += (L.th - E.th) * k; E.zoom += (L.zoom * settings.zoom / 100 - E.zoom) * k; E.rate += (L.rate - E.rate) * k;
    E.ccs += (L.ccs - E.ccs) * k; E.spinK += (settings.speed / 100 - E.spinK) * k;
    for (c = 0; c < 3; c++) { colA[c] += (F[0][c] - colA[c]) * k; colB[c] += (F[1][c] - colB[c]) * k; colBd[c] += (BORDERS[L.border][c] - colBd[c]) * k; }
    // a knob or look change takes over from a tapped shape
    var lk = Math.round(settings.look), sd = Math.round(settings.sides);
    if (lk !== lastLook || sd !== lastSides) { lastLook = lk; lastSides = sd; tapShape = 0; }
    var ws = wantShape();
    if (ws !== shapeNow) {
      var front = (time - shapeT0) / 0.7 * (NODES + 40);
      shapeFrom = front < NODES * 0.5 ? shapeFrom : shapeNow;   // a quick second tap keeps the wave going from the same start shape
      shapeNow = ws; if (front >= NODES * 0.5) shapeT0 = time;
    }
    refreshColours();
    body.update(dt, now);
    bodyCount = body.fresh ? body.people.length : 0;
    buildGrid(now);
    updateTracks(input.read(), dt);
    steer(dt);
    render();
    frameMs = performance.now() - t0;
  }
  function resize(w, h) { if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return; size = [w, h]; }
  var LIM = {look: [0, LOOKS.length - 1], sides: [0, CIRCLE], zoom: [25, 300], speed: [0, 200], hue: [0, 360]};
  function set(o) {
    if (o && typeof o === 'object') Object.keys(LIM).forEach(function(k) {
      var v = o[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        v = clamp(v, LIM[k][0], LIM[k][1]);
        if (k === 'look' || k === 'sides') { v = Math.round(v); if (k === 'sides' && v === 1) v = 0; }
        settings[k] = v;
      }
    });
    return Object.assign({}, settings);
  }
  function destroy() {
    if (dead) return; dead = true;
    tracks = []; input.clear(); kit.wantDepth(false);
    if (window.SpiralgonSet === set) delete window.SpiralgonSet;
  }
  resize(canvas.width, canvas.height);
  kit.wantDepth(true);
  window.SpiralgonSet = set; if (window._spiralgonFx) set(window._spiralgonFx);
  hueFlow.snap(settings.hue); snapLook(); refreshColours();
  var out = {frame: frame, touch: function(t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
  if (window.WallTest) out.debug = function() {
    return {frames: frames, frameMs: frameMs, drawn: drawn, look: lookOf().name, shape: shapeNow, steps: steps, taps: taps, holds: holds, contacts: tracks.length,
      kind: kind, seam: seam, bodyCount: bodyCount, personSpeed: pSpeed, inside: insideN, displayHue: hueFlow.value,
      spirals: SP.map(function(s) { return {cx: s.cx, cy: s.cy, C: s.C, rotRate: s.rotRate, zv: s.zv, grow: s.grow, held: s.held}; }), settings: set(), destroyed: dead};
  };
  return out;
}
})();
