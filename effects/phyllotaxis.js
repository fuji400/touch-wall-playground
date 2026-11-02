/* Phyllotaxis (genart lab, 2026-10-22; ported from jdxyw/generativeart phyllotaxis.go).
   A sculptural Vogel-spiral rosette: seed k sits at radius c*sqrt(k), angle k*theta, drawn outer to inner as shaded lotus petals
   (the Go petal: belly profile, five concentric colour layers, midrib, rims, tip pearl, an outward ambient-occlusion shadow).
   The divergence angle theta is the hero: a hand's x sets it (130..145 deg, the golden 137.508 at the centre), hand y sets petal size.
   Two hands = two rosettes side by side, each hand mapped within its own half. Tap = a bloom wave runs outward from the finger.
   Hold = the angle locks (and stays a while after release) and the rosette slowly turns. Walk = with nobody touching, the rosette
   rests on the nearest person's chest, bigger when they stand closer to the wall; petals inside the person blush rose and their outline
   glows; two people (no hands) get a flower each. Mode changes (one / two flowers) must hold 0.4 s, so touching blobs never flicker.
   Idle = the angle breathes around golden (+-0.3 deg, 10 s) and a soft bloom ring leaves the heart now and then.
   Canvas 2D: every petal is one drawImage from a pre-rendered sprite atlas (three mip sizes); a colour shift is one filtered blit of
   the atlas, never a per-petal filter. ASCII only.
   Looks (2026-11-01): named presets of the nine named colours (+ the ground's edge) and the three knobs (seeds, petal size, bloom
   speed; no look has more seeds than the default, so none costs more). A change builds the new look's atlas once, then the coloured
   atlas the petals are drawn from crossfades old -> new over ~0.8 s (three mip blits per frame, only during the change) while the
   live colours (ground, halo, stamen, rings) ease the same way and the knobs ease as they always did (tau 0.3-0.35 s).
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

registerWallPlugin({id: 'phyllotaxis', title: 'Phyllotaxis', author: 'Builder F (genart)', create: create});

var GOLD = 137.50776405, DEG = Math.PI / 180, TAU = Math.PI * 2, MAXN = 2000;
// the named colours of phyllotaxis.go (Botanical and Sunset gradients are not in the reference: built from these, see notes)
var COL0 = {
  ground: [11, 22, 19], shadow: [6, 10, 12], ivory: [255, 250, 238], pollen: [255, 218, 132],
  forest: [12, 44, 38], jade: [34, 118, 102], sage: [106, 178, 128], rose: [218, 48, 84], coral: [248, 152, 58]
};
var COL = COL0;                                           // the palette the atlas is built from (the current look's)
// Looks: the nine named colours + the ground gradient's edge, and the three knobs. Look 0 is the original (COL0, the knob defaults).
var LOOKS = [
  {name: 'lotus', seeds: 1500, petal: 100, bloom: 100, edge: [3, 6, 6], pal: COL0},
  {name: 'sunflower', seeds: 1200, petal: 115, bloom: 100, edge: [5, 3, 1], pal: {
    ground: [20, 12, 4], shadow: [8, 4, 2], ivory: [255, 248, 220], pollen: [255, 204, 44],
    forest: [70, 40, 10], jade: [150, 90, 20], sage: [232, 172, 40], rose: [204, 92, 12], coral: [255, 190, 34]}},
  {name: 'porcelain', seeds: 1000, petal: 120, bloom: 80, edge: [2, 3, 8], pal: {
    ground: [8, 14, 30], shadow: [2, 4, 10], ivory: [255, 255, 255], pollen: [222, 236, 255],
    forest: [20, 40, 112], jade: [40, 82, 182], sage: [192, 212, 242], rose: [30, 62, 172], coral: [236, 242, 255]}},
  {name: 'ember', seeds: 1500, petal: 90, bloom: 150, edge: [4, 1, 1], pal: {
    ground: [18, 6, 3], shadow: [6, 2, 1], ivory: [255, 240, 210], pollen: [255, 200, 80],
    forest: [62, 10, 6], jade: [142, 30, 10], sage: [222, 82, 20], rose: [255, 60, 22], coral: [255, 150, 40]}},
  {name: 'neon', seeds: 800, petal: 135, bloom: 170, edge: [1, 0, 4], pal: {
    ground: [6, 2, 14], shadow: [2, 0, 6], ivory: [255, 255, 255], pollen: [255, 255, 120],
    forest: [22, 0, 62], jade: [0, 180, 222], sage: [80, 255, 220], rose: [255, 0, 170], coral: [182, 62, 255]}},
  {name: 'moonflower', seeds: 1300, petal: 100, bloom: 60, edge: [2, 2, 3], pal: {
    ground: [10, 10, 14], shadow: [2, 2, 4], ivory: [255, 255, 255], pollen: [236, 236, 246],
    forest: [30, 32, 40], jade: [80, 84, 96], sage: [172, 176, 192], rose: [122, 126, 142], coral: [212, 216, 228]}}
];
var LIVE_KEYS = ['ground', 'pollen', 'ivory', 'jade', 'forest'];   // the colours render() draws live (the rest live in the atlas)

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }
// Oklab mixing, as the Go does (render.LerpOklab)
function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function unlin(c) { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055; return Math.round(clamp(c, 0, 1) * 255); }
function toLab(rgb) {
  var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
  var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
      s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function fromLab(L) {
  var l = L[0] + 0.3963377774 * L[1] + 0.2158037573 * L[2], m = L[0] - 0.1055613458 * L[1] - 0.0638541728 * L[2], s = L[0] - 0.0894841775 * L[1] - 1.2914855480 * L[2];
  l = l * l * l; m = m * m * m; s = s * s * s;
  return [unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), unlin(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
function mix(a, b, t) { var A = toLab(a), B = toLab(b); t = clamp(t, 0, 1); return fromLab([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); }
function ramp(stops, t) { t = clamp(t, 0, 1) * (stops.length - 1); var i = Math.min(stops.length - 2, Math.floor(t)); return mix(stops[i], stops[i + 1], t - i); }
function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (+a).toFixed(3) + ')'; }
// the CSS hue-rotate matrix, so colours drawn live match the filtered atlas
function hueRot(c, deg) {
  if (!deg) return c;
  var a = Math.cos(deg * DEG), b = Math.sin(deg * DEG), r = c[0], g = c[1], bl = c[2];
  return [Math.round(clamp((0.213 + 0.787 * a - 0.213 * b) * r + (0.715 - 0.715 * a - 0.715 * b) * g + (0.072 - 0.072 * a + 0.928 * b) * bl, 0, 255)),
          Math.round(clamp((0.213 - 0.213 * a + 0.143 * b) * r + (0.715 + 0.285 * a + 0.140 * b) * g + (0.072 - 0.072 * a - 0.283 * b) * bl, 0, 255)),
          Math.round(clamp((0.213 - 0.213 * a - 0.787 * b) * r + (0.715 - 0.715 * a + 0.715 * b) * g + (0.072 + 0.928 * a + 0.072 * b) * bl, 0, 255))];
}

// --- the petal sprite atlas (petal pointing +x, base at (OX, SH/2))
var NB = 16, NBODY = 4, L = 128, HWR = 0.28, SW = 168, SH = 136, OX = 12, COLS = 6, ROWS = 4, GLOW = NB, BODY0 = NB + 1, MIPS = [1, 0.5, 0.25];

function petalGeom(len, hw, scaleW, tipPull) {          // buildLotusPetalGeometry with curl 0: left rim, right rim, spine
  var l = [], r = [], s = [];
  for (var i = 0; i <= 16; i++) {
    var u = i / 16, ue = tipPull + (1 - tipPull) * u, x = ue * len, w = 0;
    if (u < 0.999) w = (Math.sin(Math.PI * Math.pow(u, 0.72)) * (1 + 0.24 * Math.sin(Math.PI * u) * Math.sin(0.5 * Math.PI * u)) + 0.16 * (1 - u) * (1 - u)) * scaleW;
    s.push([x, 0]); l.push([x, -hw * w]); r.push([x, hw * w]);
  }
  return {l: l, r: r, s: s};
}
function pathGeom(g, G, dx, dy) {
  g.beginPath(); g.moveTo(G.l[0][0] + dx, G.l[0][1] + dy);
  for (var i = 1; i < G.l.length; i++) g.lineTo(G.l[i][0] + dx, G.l[i][1] + dy);
  for (var j = G.r.length - 2; j >= 0; j--) g.lineTo(G.r[j][0] + dx, G.r[j][1] + dy);
  g.closePath();
}
function taper(g, pts, w0, w1) {                         // a filled polyline whose width runs w0 -> w1
  var n = pts.length, left = [], right = [];
  for (var i = 0; i < n; i++) {
    var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
    var w = (w0 + (w1 - w0) * i / (n - 1)) * 0.5, nx = -dy / d * w, ny = dx / d * w;
    left.push([pts[i][0] + nx, pts[i][1] + ny]); right.push([pts[i][0] - nx, pts[i][1] - ny]);
  }
  g.beginPath(); g.moveTo(left[0][0], left[0][1]);
  for (var k = 1; k < n; k++) g.lineTo(left[k][0], left[k][1]);
  for (var m = n - 1; m >= 0; m--) g.lineTo(right[m][0], right[m][1]);
  g.closePath(); g.fill();
}
function grad(g, x0, x1, stops) { var gr = g.createLinearGradient(x0, 0, x1, 0); stops.forEach(function(s) { gr.addColorStop(s[0], s[1]); }); return gr; }

function bodyColours(u) {                                 // where a person stands the petals blush: crimson rose body, coral and pollen tips
  var mid = mix(COL.rose, COL.coral, 0.25 + 0.3 * (1 - u)), base = mix(COL.forest, COL.rose, 0.55), tip = mix(COL.coral, COL.pollen, 0.45);
  return {base: base, mid: mid, tip: tip, vein: mix(mid, COL.pollen, 0.5), rim: mix(tip, COL.ivory, 0.35), pearl: mix(tip, COL.pollen, 0.6)};
}
function petalColours(u) {                               // Generative() step 2, per radial position u (0 heart .. 1 rim)
  var warm = Math.pow(1 - u, 2.1);
  var belly = mix(COL.jade, COL.sage, clamp(1 - 0.75 * u, 0, 1));
  var botan = ramp([COL.forest, COL.jade, COL.sage, COL.pollen], 0.18 + 0.42 * (1 - u));
  var mid = mix(mix(belly, botan, 0.35), COL.coral, warm * 0.72);
  var base = mix(COL.forest, mid, 0.28 + 0.25 * warm);
  var sunset = ramp([COL.rose, COL.coral, COL.pollen], 0.42 + 0.52 * (1 - u));
  var tip = mix(COL.rose, sunset, 0.38 + 0.32 * warm);
  return {base: base, mid: mid, tip: tip, vein: mix(mid, COL.pollen, 0.42), rim: mix(tip, COL.ivory, 0.28), pearl: mix(tip, COL.pollen, 0.42 + 0.35 * (1 - u))};
}
function drawPetal(g, u, c) {
  var hw = L * HWR, G = petalGeom(L, hw, 1, 0), cs = L / 70;
  // 1. ambient-occlusion drop shadow, cast outward (+x)
  var sh = (0.05 + 0.04 * u) * L;
  g.filter = 'blur(4px)';
  pathGeom(g, G, sh * 1.35, 0); g.fillStyle = rgba(COL.shadow, 0.5); g.fill();
  pathGeom(g, G, sh * 0.75, 0); g.fillStyle = rgba(COL.shadow, 0.62); g.fill();
  g.filter = 'none';
  // 2-3. body and five concentric layers
  pathGeom(g, G, 0, 0); g.fillStyle = rgba(c.base, 0.96); g.fill();
  for (var l = 1; l <= 5; l++) {
    var lt = l / 5, sw, tp, col;
    if (l <= 3) { var bt = l / 3; sw = 1 - 0.28 * bt; tp = 0.18 * bt; col = mix(c.base, c.mid, bt); }
    else if (l === 4) { sw = 0.5; tp = 0.7; col = mix(c.mid, c.tip, 0.45); }
    else { sw = 0.34; tp = 0.8; col = c.tip; }
    pathGeom(g, petalGeom(L * (1 - 0.01 * lt), hw, sw, tp), 0, 0); g.fillStyle = rgba(col, 0.86); g.fill();
  }
  // 4. midrib and two pairs of lateral veins
  g.fillStyle = grad(g, 0, L, [[0, rgba(c.base, 0.48)], [0.85, rgba(c.vein, 0.48)], [1, rgba(c.vein, 0.4)]]);
  taper(g, G.s, 1.45 * cs * (0.55 + 0.45 * u) * 1.6, 0.3);
  g.fillStyle = grad(g, 0, L, [[0, rgba(c.mid, 0.3)], [1, rgba(c.vein, 0.3)]]);
  [[4, 10], [7, 13]].forEach(function(va) {
    var s0 = va[0], s1 = va[1], md = (s0 + s1) >> 1;
    [G.l, G.r].forEach(function(edge) {
      var p0 = G.s[s0], p1 = [G.s[md][0] + (edge[md][0] - G.s[md][0]) * 0.52, G.s[md][1] + (edge[md][1] - G.s[md][1]) * 0.52],
          p2 = [G.s[s1][0] + (edge[s1][0] - G.s[s1][0]) * 0.85, G.s[s1][1] + (edge[s1][1] - G.s[s1][1]) * 0.85];
      taper(g, [p0, p1, p2], 0.78 * cs * 1.4, 0.2);
    });
  });
  // 5. rim highlights (left = lit side) and the tip pearl
  var rw = (0.95 + 0.85 * u) * cs * 1.3;
  g.fillStyle = grad(g, 0, L, [[0, rgba(c.mid, 0)], [0.35, rgba(mix(c.mid, c.rim, 0.55), 0.6)], [1, rgba(c.rim, 0.8)]]);
  taper(g, G.l.slice(1, 16), rw * 0.6, rw * 0.5); taper(g, G.l.slice(3, 16).map(function(p) { return [p[0], p[1] + rw * 0.2]; }), rw, rw * 0.3);
  g.fillStyle = grad(g, 0, L, [[0, rgba(c.base, 0)], [0.4, rgba(mix(c.base, c.rim, 0.5), 0.5)], [1, rgba(c.rim, 0.66)]]);
  taper(g, G.r.slice(3, 16).map(function(p) { return [p[0], p[1] - rw * 0.2]; }), rw * 0.85, rw * 0.25);
  var tip = G.s[16], sub = [G.s[15][0] + (tip[0] - G.s[15][0]) * 0.55, 0], pr = (1.4 + 1.4 * (1 - 0.45 * u)) * cs * 1.3;
  g.globalCompositeOperation = 'lighter';
  var rg = g.createRadialGradient(sub[0], 0, 0, sub[0], 0, pr * 1.35 * 2);
  rg.addColorStop(0, rgba(c.pearl, 0.3)); rg.addColorStop(1, rgba(c.pearl, 0)); g.fillStyle = rg;
  g.beginPath(); g.arc(sub[0], 0, pr * 2.7, 0, TAU); g.fill();
  rg = g.createRadialGradient(tip[0] - pr * 0.5, 0, 0, tip[0] - pr * 0.5, 0, pr);
  rg.addColorStop(0, rgba(COL.ivory, 0.5)); rg.addColorStop(1, rgba(COL.ivory, 0)); g.fillStyle = rg;
  g.beginPath(); g.arc(tip[0] - pr * 0.5, 0, pr, 0, TAU); g.fill();
  g.globalCompositeOperation = 'source-over';
}
function drawGlow(g) {                                    // the bloom glow: the petal's shape in pollen gold to ivory, blurred
  var G = petalGeom(L * 1.04, L * HWR * 1.05, 1, 0);
  g.filter = 'blur(5px)';
  pathGeom(g, G, 0, 0);
  g.fillStyle = grad(g, 0, L, [[0, rgba(COL.coral, 0)], [0.4, rgba(COL.coral, 0.35)], [0.8, rgba(COL.pollen, 0.75)], [1, rgba(COL.pollen, 0.3)]]);
  g.fill(); g.filter = 'none';
}
function buildAtlas(cv) {                                // the hue-0 atlas at full size; smaller mips are made from it (cv: rebuild in place)
  if (!cv) { cv = document.createElement('canvas'); cv.width = SW * COLS; cv.height = SH * ROWS; }
  var g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, cv.width, cv.height);
  for (var i = 0; i < BODY0 + NBODY; i++) {
    g.save(); g.translate((i % COLS) * SW + OX, Math.floor(i / COLS) * SH + SH / 2);
    g.beginPath(); g.rect(-OX, -SH / 2, SW, SH); g.clip();
    if (i < NB) drawPetal(g, (i + 0.5) / NB, petalColours((i + 0.5) / NB));
    else if (i === GLOW) drawGlow(g);
    else { var ub = (i - BODY0 + 0.5) / NBODY; drawPetal(g, ub, bodyColours(ub)); }
    g.restore();
  }
  return cv;
}

function create(canvas, kit) {
  var ctx = canvas.getContext('2d', {alpha: false});
  if (!ctx) throw new Error('Phyllotaxis needs Canvas 2D');
  var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0), dead = false;
  var settings = {look: 0, seeds: 1500, petal: 100, bloom: 100, hue: 0}, petalK = 1, bloomK = 1;   // the knobs as eased (a change never jumps)
  var LK = LOOKS[0], over = {seeds: false, petal: false, bloom: false}, looks = 0, ready = false, xf = 1, baseO = null, rebuildMs = 0;
  var PC = {}, PCR = {}, edgeC = LK.edge.slice();                                       // live colours as eased, and rounded for css
  LIVE_KEYS.forEach(function(k) { PC[k] = LK.pal[k].slice(); PCR[k] = LK.pal[k].slice(); });
  function lookVal(k) { return over[k] ? settings[k] : LK[k]; }   // (steer() has its own local `want`)
  COL = COL0;                                                                            // a new instance starts on the original palette
  var size = [canvas.width || 1280, canvas.height || 800], time = 0, frames = 0, frameMs = 0, drawn = 0;
  var SQ = new Float32Array(MAXN), JIT = new Float32Array(MAXN), WOB = new Float32Array(MAXN);
  for (var k = 0; k < MAXN; k++) { SQ[k] = Math.sqrt(k); var h = Math.sin(k * 12.9898 + 78.233) * 43758.5453; h -= Math.floor(h); JIT[k] = (h - 0.5) * 0.07; WOB[k] = (((h * 7.31) % 1) - 0.5) * 0.1; }
  // atlases: base (hue 0) per mip, and the coloured copies the petals are drawn from
  var base0 = buildAtlas(), baseM = [], colM = [], builtHue = null, hasFilter = typeof ctx.filter === 'string';
  MIPS.forEach(function(s) {
    var b = s === 1 ? base0 : document.createElement('canvas');
    if (s !== 1) { b.width = Math.round(base0.width * s); b.height = Math.round(base0.height * s); var bg = b.getContext('2d'); bg.imageSmoothingQuality = 'high'; bg.drawImage(base0, 0, 0, b.width, b.height); }
    baseM.push(b);
    var c = document.createElement('canvas'); c.width = b.width; c.height = b.height; colM.push(c);
  });
  function tint(deg) {
    for (var i = 0; i < MIPS.length; i++) {
      var g = colM[i].getContext('2d'); g.clearRect(0, 0, colM[i].width, colM[i].height);
      if (hasFilter && Math.abs(deg) > 0.01) g.filter = 'hue-rotate(' + deg.toFixed(1) + 'deg)';
      if (xf < 1 && baseO) { g.drawImage(baseO[i], 0, 0); g.globalAlpha = xf; }        // a look change: old atlas, the new one over it at xf
      g.drawImage(baseM[i], 0, 0); g.filter = 'none'; g.globalAlpha = 1;
    }
    builtHue = deg;
  }
  tint(0);
  // --- looks: a new atlas is built once per change; tint() crossfades the old atlas into it while xf runs 0 -> 1
  function makeMips(set) {                                 // the two smaller mips from set[0], as at start-up
    for (var i = 1; i < set.length; i++) { var g = set[i].getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.clearRect(0, 0, set[i].width, set[i].height); g.imageSmoothingQuality = 'high'; g.drawImage(set[0], 0, 0, set[i].width, set[i].height); }
  }
  function applyLook(i) {
    LK = LOOKS[i]; over.seeds = over.petal = over.bloom = false; looks++;
    if (!ready) return;                                    // create(): snapLook() builds the stored look without a fade
    var t0 = performance.now(), k;
    if (!baseO) baseO = baseM.map(function(b) { var c = document.createElement('canvas'); c.width = b.width; c.height = b.height; return c; });
    if (xf < 1) {                                          // mid-change: what is on screen (old at 1-xf, new at xf) becomes the old atlas
      for (k = 0; k < baseO.length; k++) { var g = baseO[k].getContext('2d'); g.globalAlpha = xf; g.drawImage(baseM[k], 0, 0); g.globalAlpha = 1; }
    } else { var t = baseO; baseO = baseM; baseM = t; }      // settled: the current atlas is the old one
    COL = LK.pal; buildAtlas(baseM[0]); makeMips(baseM);
    xf = 0; rebuildMs = performance.now() - t0;
  }
  function stepLook(dt) {                                  // live colours and the atlas crossfade; true while the atlas must be re-tinted
    var kp = ease(dt, 0.25), pal = LK.pal, moving = xf < 1;
    for (var n = 0; n < LIVE_KEYS.length; n++) {
      var key = LIVE_KEYS[n], c = PC[key], t = pal[key];
      for (var j = 0; j < 3; j++) { c[j] += (t[j] - c[j]) * kp; if (Math.abs(t[j] - c[j]) < 0.4) c[j] = t[j]; PCR[key][j] = Math.round(c[j]); }
    }
    for (var e2 = 0; e2 < 3; e2++) { edgeC[e2] += (LK.edge[e2] - edgeC[e2]) * kp; if (Math.abs(LK.edge[e2] - edgeC[e2]) < 0.4) edgeC[e2] = LK.edge[e2]; }
    if (moving) { xf += (1 - xf) * kp; if (xf > 0.996) xf = 1; }
    return moving;
  }

  // rosettes: [0] is the main one, [1] grows in beside it for a second hand
  function rosette(x) { return {cx: x, cy: 400, R: 390, grow: 1, theta: GOLD, thetaT: GOLD, rot: 0, spin: 0.025, petal: 1, n: 1500, frac: 1, held: false, sticky: -1, stickyTheta: GOLD}; }
  var ros = [rosette(640), rosette(930)]; ros[1].grow = 0;
  var tracks = [], nextTid = 1, blooms = [], lastIdleBloom = 0, personId = null, bodyCount = 0, mode = 1, holdCue = 0, kind = 'one', kindT = 0, kindFlips = 0;
  // the body halo, on a 64 x 40 screen grid (20 px cells): petals near a person's outline unfurl and glow
  var GW = 64, GH = 40, gridIdx = new Int32Array(GW * GH).fill(-1), gridVal = new Float32Array(GW * GH), gridIn = new Float32Array(GW * GH), gridAt = -1e9, haloMax = 0, inMax = 0;
  var GLOWBUF = new Float32Array(MAXN * 2 * 6), glowN = 0;

  function screenOf(u, v) {                              // Kinect pixel -> window 0..1; stretched over the window without a registration
    var s = kit.toScreen(u, v);
    if (s && Number.isFinite(s[0]) && Number.isFinite(s[1])) return s;
    return [u / 512, v / 424];
  }
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
  function updateGrid(dt) {
    var k = ease(dt, 0.12), sdf = body.sdf, mask = body.mask, live = body.people.length > 0, mx = 0, mi = 0;
    for (var i = 0; i < GW * GH; i++) {
      var t = 0, m = 0, j = gridIdx[i];
      if (live && j >= 0) { var d = sdf[j] - 1; t = Math.exp(-d * d / 6) * 0.9; m = mask[j]; }
      gridVal[i] += (t - gridVal[i]) * k; gridIn[i] += (m - gridIn[i]) * k;
      if (gridVal[i] > mx) mx = gridVal[i];
      if (gridIn[i] > mi) mi = gridIn[i];
    }
    haloMax = mx; inMax = mi;
  }
  function sampleGrid(G, x, y) {                          // bilinear, design px
    var fx = x / 20 - 0.5, fy = y / 20 - 0.5;
    if (fx < 0 || fy < 0 || fx >= GW - 1 || fy >= GH - 1) return 0;
    var ix = fx | 0, iy = fy | 0, ax = fx - ix, ay = fy - iy, i = iy * GW + ix;
    return (G[i] * (1 - ax) + G[i + 1] * ax) * (1 - ay) + (G[i + GW] * (1 - ax) + G[i + GW + 1] * ax) * ay;
  }
  function bloomAt(x, y) {
    var sum = 0, v = 520 * bloomK;
    for (var i = 0; i < blooms.length; i++) {
      var e = blooms[i], age = time - e.t0, dx = x - e.x, dy = y - e.y, d = Math.sqrt(dx * dx + dy * dy), w = 55 + 45 * age, q = (d - v * age) / w;
      sum += e.amp * (Math.exp(-q * q) * Math.exp(-age / 2.2) + 0.45 * Math.exp(-d / 110 - age / 0.7));
    }
    return sum > 1.4 ? 1.4 : sum;
  }
  function addBloom(x, y, amp) { blooms.push({x: x, y: y, t0: time, amp: amp}); if (blooms.length > 8) blooms.shift(); }

  function angleFor(xn) {                                  // hand x in its zone (0..1) -> divergence angle: flat near golden, 130 / 145 at the ends
    var d = clamp(xn, 0, 1) * 2 - 1, f = 0.35 * d + 0.65 * d * d * d;
    return GOLD + f * (f < 0 ? GOLD - 130 : 145 - GOLD);
  }

  function updateTracks(pts, dt) {
    var i, t;
    for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
    pts.forEach(function(p) {
      var best = null, bd = 0.12;
      tracks.forEach(function(q) { if (!q.seen) { var d = Math.hypot(q.x - p[0], q.y - p[1]); if (d < bd) { bd = d; best = q; } } });
      if (!best) {
        best = {id: nextTid++, x: p[0], y: p[1], ax: p[0], ay: p[1], still: 0, held: false, holdTheta: GOLD, ro: 0};
        tracks.push(best); addBloom(p[0] * 1280, p[1] * 800, 1);
      }
      best.seen = true; best.x = p[0]; best.y = p[1];
      if (Math.hypot(p[0] - best.ax, p[1] - best.ay) > 0.02) { best.ax = p[0]; best.ay = p[1]; best.still = 0; } else best.still += dt;
    });
    for (i = tracks.length - 1; i >= 0; i--) {
      t = tracks[i];
      if (!t.seen) {                                       // released: a held angle stays for a while
        if (t.held && ros[t.ro]) { ros[t.ro].sticky = time + 8; ros[t.ro].stickyTheta = t.holdTheta; }
        tracks.splice(i, 1);
      }
    }
    tracks.forEach(function(q) {
      var was = q.held; q.held = q.still >= 0.9;
      if (q.held && !was) { q.holdTheta = ros[q.ro] ? ros[q.ro].thetaT : GOLD; addBloom(q.x * 1280, q.y * 800, 0.6); }
    });
  }

  function pickPerson() {
    if (!body.fresh || !body.people.length) { personId = null; return null; }
    var p = null;
    for (var i = 0; i < body.people.length; i++) if (body.people[i].id === personId) p = body.people[i];
    if (!p) { p = body.people[0]; personId = p.id; }
    return p;
  }

  function chestOf(p, x0, x1) {                          // a person's chest on the wall (design px) and the size their distance asks for
    var ky = p.top + 0.3 * (p.bottom - p.top), s = screenOf(p.cx * 512, ky * 424);
    return {x: clamp(s[0], x0, x1) * 1280, y: clamp(s[1], 0.32, 0.68) * 800, k: clamp(1.35 - (p.gap - 300) / 1200 * 0.5, 0.85, 1.35)};
  }
  function steer(dt) {
    var person = pickPerson(), A = ros[0], B = ros[1], n = tracks.length, pair = null, two = body.fresh && body.people.length >= 2;
    // one flower, two for two hands, two for two people: a change must hold for 0.4 s (touching blobs merge and split at depth rate)
    var want = n >= 2 ? 'hands' : !n && two ? 'people' : 'one';
    if (want === kind) kindT = 0; else { kindT += dt; if (kindT >= 0.4) { kind = want; kindT = 0; kindFlips++; } }
    mode = kind === 'one' ? 1 : 2;
    if (kind === 'people' && two) pair = body.people.slice(0, 2).sort(function(a, b) { return a.cx - b.cx; });
    var sorted = tracks.slice().sort(function(a, b) { return a.x - b.x; });
    var drive = [null, null];
    if (mode === 2) { if (n >= 2) { drive[0] = sorted[0]; drive[1] = sorted[n - 1]; } else if (n === 1) drive[sorted[0].x < 0.5 ? 0 : 1] = sorted[0]; }
    if (mode === 1) {
      var ch = person ? chestOf(person, 0.24, 0.76) : null;
      drive[0] = sorted[0] || null;
      A.tx = ch ? ch.x : 640 + 14 * Math.sin(time * 0.11); A.ty = ch ? ch.y : 400 + 10 * Math.sin(time * 0.083);
      A.tR = 390 * (ch ? ch.k : 1); A.tGrow = 1; A.frac = 1; B.tGrow = 0; B.tx = 930; B.ty = 400; B.tR = 290;
    } else if (kind === 'people') {                        // two people, no hands: a flower on each of them (kept in place if they merge)
      if (pair) {
        var c0 = chestOf(pair[0], 0.16, 0.46), c1 = chestOf(pair[1], 0.54, 0.84);
        A.tx = c0.x; A.ty = c0.y; A.tR = Math.min(305, 272 * c0.k); A.tGrow = 1; A.frac = 0.62;
        B.tx = c1.x; B.ty = c1.y; B.tR = Math.min(305, 272 * c1.k); B.tGrow = 1; B.frac = 0.62;
      }
    } else {
      A.tx = 340; A.ty = 400; A.tR = 272; A.tGrow = 1; A.frac = 0.62;
      B.tx = 940; B.ty = 400; B.tR = 272; B.tGrow = 1; B.frac = 0.62;
    }
    tracks.forEach(function(t) { t.ro = t === drive[1] ? 1 : 0; });
    holdCue = 0;
    for (var r = 0; r < 2; r++) {
      var ro = ros[r], t = drive[r], spinT = 0.025, petalT = 1;
      if (t) {
        var z0 = mode === 2 ? (r ? 0.5 : 0) : 0, z1 = mode === 2 ? (r ? 1 : 0.5) : 1;
        ro.thetaT = t.held ? t.holdTheta : angleFor((t.x - z0) / (z1 - z0));
        petalT = 1.3 - 0.55 * clamp(t.y, 0, 1);
        if (t.held) { spinT = 0.3; ro.sticky = -1; holdCue = Math.max(holdCue, 1); }
        else if (t.still > 0.25) holdCue = Math.max(holdCue, (t.still - 0.25) / 0.65);
      } else if (ro.sticky > time) ro.thetaT = ro.stickyTheta;
      else ro.thetaT = GOLD + 0.3 * Math.sin(time * TAU / 10 + r * 2.4);
      if (ro.grow < 0.03 && r === 1) ro.theta = ro.thetaT;
      ro.theta += (ro.thetaT - ro.theta) * ease(dt, 0.3);
      ro.spin += (spinT - ro.spin) * ease(dt, 0.8);
      ro.rot = (ro.rot + ro.spin * dt) % TAU;
      ro.petal += (petalT - ro.petal) * ease(dt, 0.35);
      ro.cx += (ro.tx - ro.cx) * ease(dt, 0.6); ro.cy += (ro.ty - ro.cy) * ease(dt, 0.6);
      ro.R += (ro.tR - ro.R) * ease(dt, 0.5);
      ro.grow += (ro.tGrow - ro.grow) * ease(dt, 0.35);
      var seedsT = lookVal('seeds'); ro.n += (seedsT * ro.frac - ro.n) * ease(dt, 0.35); if (Math.abs(ro.n - seedsT * ro.frac) < 0.02) ro.n = Math.round(seedsT * ro.frac);
    }
    if (!n && !blooms.length && time - lastIdleBloom > 9) { lastIdleBloom = time; addBloom(A.cx, A.cy, 0.4); }
    if (n) lastIdleBloom = time;
    blooms = blooms.filter(function(e) { return time - e.t0 < 4.5; });
  }

  function drawRosette(ro, sx, sy, atl) {
    var R = ro.R * ro.grow; if (R < 6) return;
    var n = Math.max(2, Math.min(MAXN, ro.n)), N = Math.ceil(n), sqN = Math.sqrt(n), c = R / (0.84 * sqN + 6.17);
    var th = ro.theta * DEG, rot = ro.rot, ps = ro.petal * petalK * (1 + 0.04 * Math.sin(time * 0.63)), mn = Math.min(sx, sy);
    var cx = ro.cx, cy = ro.cy, lastLv = -1, src = null, s = 1, useBody = haloMax > 0.01 || inMax > 0.01;
    for (var k = N - 1; k >= 0; k--) {
      var sk = SQ[k], u = sk / sqN, bin = Math.floor((u + JIT[k]) * NB); if (bin < 0) bin = 0; else if (bin >= NB) bin = NB - 1;
      var ang = k * th + rot, ca = Math.cos(ang), sa = Math.sin(ang), rr = c * sk * 0.84, px = cx + ca * rr, py = cy + sa * rr;
      var b = bloomAt(px, py);
      if (useBody) {                                       // a person in front: petals inside them take the warm heart colours, the outline glows
        var m = sampleGrid(gridIn, px, py); if (m > 0.3 + 0.4 * (JIT[k] / 0.07 + 0.5)) bin = BODY0 + Math.min(NBODY - 1, (u * NBODY) | 0);
        b += 0.85 * sampleGrid(gridVal, px, py) + 0.2 * m;
      }
      if (b > 1.2) b = 1.2;
      // petal length as the Go's 420-seed rosette has it (10.5 + 2.95 sqrt(i)), normalised so any seed count keeps its proportions
      var len = c * (0.913 + 5.26 * u) * ps * (1 + 0.3 * b) * (0.6 + 0.4 * ro.grow);
      var pa = ang + WOB[k], pc = Math.cos(pa), pn = Math.sin(pa), q = len / L, lenPx = len * mn;
      var lv = lenPx > 72 ? 0 : lenPx > 34 ? 1 : 2;
      if (lv !== lastLv) { lastLv = lv; src = atl[lv]; s = MIPS[lv]; }
      ctx.setTransform(sx * pc * q, sy * pn * q, -sx * pn * q, sy * pc * q, sx * px, sy * py);
      if (k === N - 1 && n < N) ctx.globalAlpha = n - (N - 1);
      ctx.drawImage(src, (bin % COLS) * SW * s, Math.floor(bin / COLS) * SH * s, SW * s, SH * s, -OX, -SH / 2, SW, SH);
      if (k === N - 1) ctx.globalAlpha = 1;
      drawn++;
      if (b > 0.04 && glowN < MAXN * 2) { var o = glowN * 6; GLOWBUF[o] = px; GLOWBUF[o + 1] = py; GLOWBUF[o + 2] = pc; GLOWBUF[o + 3] = pn; GLOWBUF[o + 4] = q; GLOWBUF[o + 5] = b; glowN++; }
    }
  }

  function render() {
    var w = size[0], h = size[1], sx = w / 1280, sy = h / 800, H = hueFlow.value, i, ro;
    ctx.setTransform(sx, 0, 0, sy, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // ground: deep botanical forest-moss pond
    var gc = hueRot(PCR.ground, H), A = ros[0];
    var bg = ctx.createRadialGradient(A.cx, A.cy, 30, A.cx, A.cy, 900);
    bg.addColorStop(0, rgba(gc, 1)); bg.addColorStop(0.55, rgba([gc[0] * 0.55 | 0, gc[1] * 0.55 | 0, gc[2] * 0.55 | 0], 1)); bg.addColorStop(1, 'rgb(' + Math.round(edgeC[0]) + ',' + Math.round(edgeC[1]) + ',' + Math.round(edgeC[2]) + ')');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1280, 800);
    // soft pond halo behind each rosette
    var halo = hueRot(mix(PCR.jade, PCR.forest, 0.4), H);
    for (i = 0; i < 2; i++) {
      ro = ros[i]; var R = ro.R * ro.grow; if (R < 6) continue;
      var hg = ctx.createRadialGradient(ro.cx, ro.cy, 0, ro.cx, ro.cy, R * 1.12);
      hg.addColorStop(0, rgba(halo, 0.22)); hg.addColorStop(0.7, rgba(halo, 0.09)); hg.addColorStop(1, rgba(halo, 0));
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(ro.cx, ro.cy, R * 1.12, 0, TAU); ctx.fill();
    }
    drawn = 0; glowN = 0;
    for (i = 0; i < 2; i++) drawRosette(ros[i], sx, sy, colM);
    // bloom glow pass (additive, one composite switch for all of it)
    if (glowN) {
      ctx.globalCompositeOperation = 'lighter';
      var src = colM[1], s = MIPS[1], gx0 = (GLOW % COLS) * SW * s, gy0 = Math.floor(GLOW / COLS) * SH * s;
      for (i = 0; i < glowN; i++) {
        var o = i * 6, q = GLOWBUF[o + 4], pc = GLOWBUF[o + 2], pn = GLOWBUF[o + 3];
        ctx.globalAlpha = Math.min(1, GLOWBUF[o + 5]) * 0.3;
        ctx.setTransform(sx * pc * q, sy * pn * q, -sx * pn * q, sy * pc * q, sx * GLOWBUF[o], sy * GLOWBUF[o + 1]);
        ctx.drawImage(src, gx0, gy0, SW * s, SH * s, -OX, -SH / 2, SW, SH);
      }
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    // the luminous stamen core of each rosette (and the hold cue: it charges brighter)
    ctx.globalCompositeOperation = 'lighter';
    var pg = hueRot(PCR.pollen, H), iv = hueRot(PCR.ivory, H);
    for (i = 0; i < 2; i++) {
      ro = ros[i]; var g = ro.grow * ro.R / 390; if (g < 0.05) continue;
      var boost = 1 + 0.8 * (ro.spin - 0.025) / 0.275, cr = 46 * g * (1 + 0.25 * boost);
      var cg = ctx.createRadialGradient(ro.cx, ro.cy, 0, ro.cx, ro.cy, cr);
      cg.addColorStop(0, rgba(iv, Math.min(1, 0.7 * boost))); cg.addColorStop(0.18, rgba(pg, 0.42 * boost)); cg.addColorStop(1, rgba(pg, 0));
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(ro.cx, ro.cy, cr, 0, TAU); ctx.fill();
    }
    // fingertips: a faint pollen ring; a still finger charges an arc, a hold closes it and breathes
    tracks.forEach(function(t) {
      var x = t.x * 1280, y = t.y * 800, prog = t.held ? 1 : clamp((t.still - 0.25) / 0.65, 0, 1);
      ctx.strokeStyle = rgba(pg, 0.32); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 16, 0, TAU); ctx.stroke();
      if (prog > 0) {
        ctx.strokeStyle = rgba(iv, 0.55 + 0.25 * (t.held ? Math.sin(time * 4) : 0)); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, y, 24 + (t.held ? 3 * Math.sin(time * 2.5) : 0), -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
      }
    });
    ctx.globalCompositeOperation = 'source-over';
    // light from the upper left: the far side of the dome sinks, and a vignette
    var lx = A.cx - 0.55 * A.R * 0.6, ly = A.cy - 0.83 * A.R * 0.6, lg = ctx.createRadialGradient(lx, ly, A.R * 0.2, lx, ly, A.R * 2.1);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.45, 'rgba(0,0,0,0.06)'); lg.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, 1280, 800);
    var vg = ctx.createRadialGradient(640, 400, 300, 640, 400, 820);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, 1280, 800);
  }

  function frame(dt, now) {
    if (dead) return;
    var t0 = performance.now();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
    hueFlow.step(settings.hue, dt);
    petalK += (lookVal('petal') / 100 - petalK) * ease(dt, 0.3); bloomK += (lookVal('bloom') / 100 - bloomK) * ease(dt, 0.3);
    var fading = stepLook(dt);
    var H = hueFlow.value, dh = builtHue === null ? 999 : Math.abs(((H - builtHue + 540) % 360) - 180);
    if (fading || dh > 1 || (dh > 0.01 && Math.abs(((settings.hue - H + 540) % 360) - 180) < 0.01)) tint(H);
    body.update(dt, now);
    bodyCount = body.fresh ? body.people.length : 0;
    buildGrid(now); updateGrid(dt);
    updateTracks(input.read(), dt);
    steer(dt);
    render();
    frameMs = performance.now() - t0;
  }
  function resize(w, h) { if (dead || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return; size = [w, h]; }
  var LIM = {look: [0, LOOKS.length - 1], seeds: [400, 2000], petal: [50, 150], bloom: [20, 200], hue: [0, 360]};
  function set(o) {
    if (o && typeof o === 'object') {
      var lk = o.look;                                    // the look first: it clears the knob overrides
      if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
      ['seeds', 'petal', 'bloom'].forEach(function(k) {   // a knob that MOVED overrides the look's value until the next look
        var v = o[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
        v = clamp(v, LIM[k][0], LIM[k][1]); if (v !== settings[k]) { settings[k] = v; over[k] = true; }
      });
      var hv = o.hue; if (typeof hv === 'number' && Number.isFinite(hv)) settings.hue = clamp(hv, LIM.hue[0], LIM.hue[1]);
    }
    return Object.assign({}, settings);
  }
  function destroy() {
    if (dead) return; dead = true;
    tracks = []; blooms = []; input.clear(); kit.wantDepth(false);
    colM.forEach(function(c) { c.width = 1; c.height = 1; }); baseM.forEach(function(c) { c.width = 1; c.height = 1; });
    if (baseO) baseO.forEach(function(c) { c.width = 1; c.height = 1; });
    COL = COL0;
    if (window.PhyllotaxisSet === set) delete window.PhyllotaxisSet;
  }
  resize(canvas.width, canvas.height);
  kit.wantDepth(true);
  window.PhyllotaxisSet = set; if (window._phyllotaxisFx) set(window._phyllotaxisFx);
  (function snapLook() {                                  // start on the stored look and knobs without easing in
    LK = LOOKS[settings.look];
    if (LK !== LOOKS[0]) { COL = LK.pal; buildAtlas(baseM[0]); makeMips(baseM); }
    LIVE_KEYS.forEach(function(k) { PC[k] = LK.pal[k].slice(); PCR[k] = LK.pal[k].slice(); }); edgeC = LK.edge.slice(); xf = 1;
    builtHue = null; ready = true;
  })();
  hueFlow.snap(settings.hue); petalK = lookVal('petal') / 100; bloomK = lookVal('bloom') / 100; ros.forEach(function(r) { r.n = lookVal('seeds') * r.frac; });
  var out = {frame: frame, touch: function(t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
  if (window.WallTest) out.atlas = function(i) { return colM[i | 0].toDataURL(); };
  if (window.WallTest) out.debug = function() {
    return {frames: frames, frameMs: frameMs, drawn: drawn, glow: glowN, mode: mode, kind: kind, kindFlips: kindFlips, contacts: tracks.length, held: tracks.filter(function(t) { return t.held; }).length,
      holdCue: holdCue, blooms: blooms.length, bodyCount: bodyCount, personId: personId, haloMax: haloMax, inMax: inMax, displayHue: hueFlow.value, builtHue: builtHue,
      rosettes: ros.map(function(r) { return {cx: r.cx, cy: r.cy, R: r.R, grow: r.grow, theta: r.theta, thetaT: r.thetaT, spin: r.spin, petal: r.petal, n: r.n}; }),
      look: LK.name, looks: looks, overrides: Object.assign({}, over), fade: xf, rebuildMs: rebuildMs, eased: {petal: petalK, bloom: bloomK},
      settings: set(), destroyed: dead};
  };
  return out;
}
})();
