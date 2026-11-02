/* Coil Rings (genart lab, p5-experiments batch, 2026-10-22). lab/plugins/coilrings.js
   After "circles" by Maksim Vasilyev, p5-experiments (https://github.com/vasilyev-maksim/p5-experiments), CC BY-NC 4.0; studio use, non-commercial.
   A hex grid of ring sets, each one the author's sketch in small: N flat discs, largest first, each disc orbiting a pivot pushed
   r*gap*i to the left or right of the set's centre, neighbouring discs counter-rotating, every disc's angle offset by coil*(i+1)*osc
   (osc = 0.5 when the coil speed is 0, as the author has it), fill stepped from the accent (centre) to the ground (rim).
   Hand: sets near a fingertip spin faster and coil tighter, and the grid swirls round the hand, so a sweep drags a vortex of rings
   along; two hands counter-rotate (left hand one way, right hand the other). Tap: a ring pulse runs out over the grid (sets swell and
   twist as the front passes). Hold: the set under the hand grows over its neighbours and comes to the hand. Walk: inside a person's
   outline the two colours swap (accent ground, dark rings), so the person is a negative, cut crisp per pixel.
   Idle: the author's rotation and coil oscillation. Knobs: look (the author's presets), rings, coil (% of the look's own), speed
   (% of the author's clock: rotation and coil oscillation), hue.
   WebGL 2: every disc is one instance of a 96-segment disc mesh (MSAA smooths the edges). Discs draw front to back with a depth test,
   depth = ring index, so the smallest ring wins at every pixel: inside a set that is the author's painter's order, between sets the
   seams meet like ripples. The negative is per pixel in the fragment shader (WallBody mask through hinv). ASCII only. */
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

registerWallPlugin({id: 'coilrings', title: 'Coil Rings', author: 'Builder H (genart, p5-experiments batch)', create: create});

var DEG = Math.PI / 180, SEG = 96, NMAX = 60;
// the author's presets (controls.ts ranges): rot = ROTATION_SPEED 0..100 (deg per frame / 10), coil = COIL_FACTOR, cs = COIL_SPEED,
// gap = GAP 1..100, col = COLOR pair, res = RESOLUTION (ring count when one set fills the screen), rate = timeDelta, start = startTime
var LOOKS = [
  {name: 'heart',          rot: 29, coil: 12,  cs: 0,   gap: 14,  col: 0, res: 30, rate: 1,   start: 85},
  {name: 'drill',          rot: 30, coil: 176, cs: 0,   gap: 35,  col: 3, res: 45, rate: 1,   start: 0},
  {name: 'cats',           rot: 15, coil: 346, cs: 0,   gap: 35,  col: 5, res: 45, rate: 1,   start: 0},
  {name: 'nuclear fusion', rot: 12, coil: 180, cs: 0,   gap: 100, col: 4, res: 45, rate: 1,   start: 0},
  {name: 'signal',         rot: 74, coil: 400, cs: 0,   gap: 1,   col: 2, res: 48, rate: 0.5, start: 0},
  {name: 'nature',         rot: 20, coil: 228, cs: 0.3, gap: 26,  col: 1, res: 49, rate: 1,   start: 900},
  {name: 'glare',          rot: 4,  coil: 180, cs: 0,   gap: 100, col: 4, res: 7,  rate: 1,   start: 0},
  {name: 'turbulence',     rot: 18, coil: 274, cs: 0.2, gap: 40,  col: 6, res: 60, rate: 1,   start: 325}
];
// the author's COLOR pairs: [ground, accent]
var PAIRS = [[[47, 0, 78], [234, 114, 247]], [[0, 37, 14], [242, 255, 0]], [[19, 0, 95], [97, 255, 83]], [[0, 0, 0], [255, 255, 255]],
             [[74, 0, 186], [108, 255, 255]], [[58, 24, 0], [255, 172, 100]], [[3, 0, 201], [231, 255, 47]]];
var REF_RES = 45;            // a look's ring count is rings * res / 45 (heart and glare are sparser, turbulence denser, as the author has them)
var SP = 340, RSET = 150;    // grid spacing and the radius of one ring set at rest (design px, 1280 x 800): the dark ground shows between sets
var SETS = (function() {     // hex rows (the middle row runs off both edges)
  var a = [];
  [[106, 130, 4], [400, -40, 5], [694, 130, 4]].forEach(function(r) { for (var k = 0; k < r[2]; k++) a.push([r[1] + k * SP, r[0]]); });
  return a;
})();
var NS = SETS.length, STRIDE = 5;
// each set starts a little further round than its left / upper neighbour, so a slow phase wave rolls over the grid instead of lockstep
var PH0 = SETS.map(function(c) { return (c[0] / 1280 * 150 + c[1] / 800 * 90) % 360; });

var VS = '#version 300 es\n' +
  'layout(location=0) in vec2 aP;\n' +          // unit disc vertex (0,0 = centre)
  'layout(location=1) in vec4 aI;\n' +          // centre x, y (design px), radius, depth 0..1
  'layout(location=2) in float aT;\n' +         // colour position: 0 accent .. 1 ground
  'out float vT;\n' +
  'void main(){vec2 p=aI.xy+aP*aI.z;vT=aT;gl_Position=vec4(p.x/640.-1.,1.-p.y/400.,aI.w*2.-1.,1.);}\n';
var FS = '#version 300 es\n' +
  'precision highp float;\n' +
  'uniform sampler2D uMask; uniform mat3 uHinv; uniform vec2 uRes; uniform vec3 uA, uB; uniform float uBody;\n' +
  'in float vT; out vec4 o;\n' +
  'void main(){\n' +
  '  vec2 w=vec2(gl_FragCoord.x/uRes.x,1.-gl_FragCoord.y/uRes.y);\n' +
  '  vec3 h=uHinv*vec3(w,1.); vec2 k=h.xy/max(h.z,1e-6);\n' +
  '  float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;\n' +
  '  float m=texture(uMask,clamp(k,0.,1.)).r;\n' +
  '  float neg=clamp((m-.5)/max(fwidth(m),1e-3)+.5,0.,1.)*inK*uBody;\n' +   // the outline, one pixel soft
  '  vec3 c=mix(mix(uA,uB,vT),mix(uB,uA,vT),neg);\n' +
  '  o=vec4(c,1.);\n' +
  '}\n';

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(dt, tau) { return 1 - Math.exp(-dt / tau); }
function hueRot(c, deg) {                        // the CSS hue-rotate matrix
  if (!deg) return c;
  var a = Math.cos(deg * DEG), b = Math.sin(deg * DEG), r = c[0], g = c[1], bl = c[2];
  return [clamp((0.213 + 0.787 * a - 0.213 * b) * r + (0.715 - 0.715 * a - 0.715 * b) * g + (0.072 - 0.072 * a + 0.928 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a + 0.143 * b) * r + (0.715 + 0.285 * a + 0.140 * b) * g + (0.072 - 0.072 * a - 0.283 * b) * bl, 0, 255),
          clamp((0.213 - 0.213 * a - 0.787 * b) * r + (0.715 - 0.715 * a + 0.715 * b) * g + (0.072 + 0.928 * a + 0.072 * b) * bl, 0, 255)];
}

function create(canvas, kit) {
  if (!window.WallBody) throw new Error('Coil Rings needs plugins/body.js');
  var gl = canvas.getContext('webgl2', {alpha: false, antialias: true, depth: true, stencil: false, preserveDrawingBuffer: false});
  if (!gl) throw new Error('Coil Rings needs WebGL 2');
  var made = [], dead = false;
  function shader(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
    return s;
  }
  var prog = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { var le = gl.getProgramInfoLog(prog); gl.deleteProgram(prog); throw new Error(le); }
  made.push(['Program', prog]);
  var U = {};
  ['uMask', 'uHinv', 'uRes', 'uA', 'uB', 'uBody'].forEach(function(n) { U[n] = gl.getUniformLocation(prog, n); });

  // the disc mesh (a fan: centre + SEG+1 rim points) and the per-disc instance buffer
  var disc = new Float32Array((SEG + 2) * 2);
  for (var j = 0; j <= SEG; j++) { disc[2 + j * 2] = Math.cos(j / SEG * Math.PI * 2); disc[3 + j * 2] = Math.sin(j / SEG * Math.PI * 2); }
  var MAXI = NS * NMAX + 1, inst = new Float32Array(MAXI * STRIDE);
  var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);
  gl.bindVertexArray(vao);
  var vb = gl.createBuffer(); made.push(['Buffer', vb]);
  gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, disc, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  var ib = gl.createBuffer(); made.push(['Buffer', ib]);
  gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE * 4, 0); gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, STRIDE * 4, 16); gl.vertexAttribDivisor(2, 1);
  gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);

  // the body mask (128 x 106, R8)
  var body = WallBody.create(kit, {}), BW = body.w, BH = body.h, u8 = new Uint8Array(BW * BH), maskMax = 0, maskUp = false;
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  var maskTex = gl.createTexture(); made.push(['Texture', maskTex]);
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, BW, BH, 0, gl.RED, gl.UNSIGNED_BYTE, u8);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  var input = refreshContacts(kit, 120), hueFlow = refreshHue(0);
  var settings = {look: 0, rings: 20, coil: 100, speed: 50, hue: 0};
  var time = 0, frames = 0, frameMs = 0, drawnI = 0, bodyCount = 0;
  // eased look parameters (a look or knob change glides, ~0.35 s, like the author's animated values)
  var P = {rot: 0, coil: 0, cs: 0, gap: 0, rate: 1, nEff: 20, oscAmp: 0, spinK: 0.5, coilK: 1};
  var colA = [0, 0, 0], colB = [0, 0, 0], psi = 0;
  // per set: rotation phase (deg), eased hand weight (signed / absolute), vortex displacement, hold zoom and hold offset
  var phi = new Float64Array(NS), wSig = new Float32Array(NS), wAbs = new Float32Array(NS), dX = new Float32Array(NS), dY = new Float32Array(NS);
  var zH = new Float32Array(NS).fill(1), oX = new Float32Array(NS), oY = new Float32Array(NS), rank = new Int32Array(NS);
  var cx = new Float32Array(NS), cy = new Float32Array(NS), zz = new Float32Array(NS), kick = new Float32Array(NS), rate = new Float32Array(NS);
  var tracks = [], nextTid = 1, pulses = [], taps = 0, holds = 0, heldN = 0, wMax = 0, zMax = 1;

  function lookOf() { return LOOKS[clamp(Math.round(settings.look), 0, LOOKS.length - 1)]; }
  function targets() {
    var L = lookOf();
    var g = 0.1 + (L.gap - 1) / 99 * 2.9;            // the author's map (GAP 1..100 -> 0.1..3), softened for a grid: 3 -> 1.7, 1 -> 0.8, 0.5 -> 0.45
    return {rot: L.rot / 10, coil: L.coil, cs: L.cs, gap: g / (1 + 0.25 * g), rate: L.rate,
            nEff: clamp(settings.rings * L.res / REF_RES, 2, NMAX), oscAmp: L.cs > 0 ? 1 : 0, spinK: settings.speed / 100, coilK: settings.coil / 100};
  }
  function snapLook() {                           // at create: start where the author's preview starts (startTime), no glide
    var T = targets(), L = lookOf(), pr = PAIRS[L.col];
    Object.keys(T).forEach(function(k) { P[k] = T[k]; });
    colB = pr[0].slice(); colA = pr[1].slice();
    psi = L.cs * L.start;
    for (var s = 0; s < NS; s++) phi[s] = (L.start * P.rot + PH0[s]) % 360;
  }

  function updateTracks(pts, dt) {
    var i, t;
    for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
    pts.forEach(function(p) {
      var best = null, bd = 0.12;
      tracks.forEach(function(q) { if (!q.seen) { var d = Math.hypot(q.x - p[0], q.y - p[1]); if (d < bd) { bd = d; best = q; } } });
      if (!best) {                                  // a new fingertip: that is a tap, a ring pulse leaves it
        best = {id: nextTid++, x: p[0], y: p[1], ax: p[0], ay: p[1], still: 0, held: false, set: -1};
        tracks.push(best); pulses.push({x: p[0] * 1280, y: p[1] * 800, t0: time}); if (pulses.length > 6) pulses.shift(); taps++;
      }
      best.seen = true; best.x = p[0]; best.y = p[1];
      if (Math.hypot(p[0] - best.ax, p[1] - best.ay) > 0.02) { best.ax = p[0]; best.ay = p[1]; best.still = 0; } else best.still += dt;
    });
    for (i = tracks.length - 1; i >= 0; i--) if (!tracks[i].seen) tracks.splice(i, 1);
    heldN = 0;
    tracks.forEach(function(q) {
      var was = q.held; q.held = q.still >= 0.9;
      if (q.held && !was) {                         // the set nearest the hand (where it is drawn now) is the one that grows
        var hx = q.x * 1280, hy = q.y * 800, bs = -1, bd2 = 1e12;
        for (var s = 0; s < NS; s++) { var dx = cx[s] - hx, dy = cy[s] - hy, d2 = dx * dx + dy * dy; if (d2 < bd2) { bd2 = d2; bs = s; } }
        q.set = bs; holds++;
      }
      if (!q.held) q.set = -1; else heldN++;
    });
  }

  function step(dt) {
    var T = targets(), k = ease(dt, 0.35), L = lookOf(), pr = PAIRS[L.col], s, h;
    Object.keys(T).forEach(function(n) { P[n] += (T[n] - P[n]) * k; });
    for (var c = 0; c < 3; c++) { colB[c] += (pr[0][c] - colB[c]) * k; colA[c] += (pr[1][c] - colA[c]) * k; }
    var advH = dt * 60 * P.rate, adv = advH * P.spinK;   // the author's clock (frames x timeDelta), and at the speed knob's tempo
    psi = (psi + P.cs * adv) % 360;
    // hands: sorted left to right; with two or more the rightmost one turns its sets the other way
    var hands = tracks.slice().sort(function(a, b) { return a.x - b.x; }), nh = hands.length, SIG2 = 2 * 250 * 250;
    var kw = ease(dt, 0.35), kh = ease(dt, 0.5);
    wMax = 0; zMax = 1;
    pulses = pulses.filter(function(p) { return time - p.t0 < 3.2; });
    for (s = 0; s < NS; s++) {
      var bx = SETS[s][0], by = SETS[s][1], tSig = 0, tAbs = 0, tdx = 0, tdy = 0, tz = 1, tox = 0, toy = 0;
      for (h = 0; h < nh; h++) {
        var H = hands[h], hx = H.x * 1280, hy = H.y * 800, ex = bx - hx, ey = by - hy, w = Math.exp(-(ex * ex + ey * ey) / SIG2);
        var sg = nh >= 2 && h === nh - 1 ? -1 : 1, th = sg * 0.55 * w, ca = Math.cos(th), sa = Math.sin(th);
        tSig += sg * w; tAbs += w;
        tdx += hx + ex * ca - ey * sa - bx; tdy += hy + ex * sa + ey * ca - by;          // the grid swirls round the hand
        if (H.held && H.set === s) { tz = 3.1; tox = (hx - bx) * 0.85; toy = (hy - by) * 0.85; }
      }
      if (tAbs > 1) { tSig /= tAbs; tAbs = 1; }
      // a held set's neighbours give way a little
      for (h = 0; h < nh; h++) if (hands[h].held && hands[h].set >= 0 && hands[h].set !== s) {
        var o = hands[h].set, ddx = SETS[o][0] - bx, ddy = SETS[o][1] - by;
        if (ddx * ddx + ddy * ddy < SP * SP * 1.6) tz = Math.min(tz, 0.75);
      }
      wSig[s] += (tSig - wSig[s]) * kw; wAbs[s] += (tAbs - wAbs[s]) * kw;
      dX[s] += (tdx - dX[s]) * kw; dY[s] += (tdy - dY[s]) * kw;
      zH[s] += (tz - zH[s]) * kh; oX[s] += (tox - oX[s]) * kh; oY[s] += (toy - oY[s]) * kh;
      // the tap pulse: a front at 650 px/s, ~90 px wide, fading over ~1.8 s
      var bump = 0;
      for (var p = 0; p < pulses.length; p++) {
        var P0 = pulses[p], age = time - P0.t0, dd = Math.hypot(bx - P0.x, by - P0.y), q = (dd - 650 * age) / 110;
        bump += Math.exp(-q * q) * Math.exp(-age / 1.8);
      }
      if (bump > 1.5) bump = 1.5;
      kick[s] = bump;
      // spin: the author's speed (x spin knob), faster near a hand; the left / right hand sign makes two hands counter-rotate
      // (the idle rotation runs on the speed knob's clock; hands and pulses keep working even at speed 0)
      var boost = Math.max(Math.abs(P.rot * P.spinK), 0.6) * 4;
      rate[s] = P.rot * P.spinK + (boost * wSig[s] + 6 * bump);
      phi[s] = (phi[s] + P.rot * adv + (boost * wSig[s] + 6 * bump) * advH) % 360;
      cx[s] = bx + dX[s] + oX[s]; cy[s] = by + dY[s] + oY[s];
      zz[s] = zH[s] * (1 + 0.32 * bump);
      if (Math.abs(wSig[s]) > wMax) wMax = Math.abs(wSig[s]);
      if (zz[s] > zMax) zMax = zz[s];
    }
    // depth priority among sets with the same ring index: a held set first, then the bigger ones
    var order = [];
    for (s = 0; s < NS; s++) order.push(s);
    order.sort(function(a, b) { return zz[b] - zz[a] || a - b; });
    for (s = 0; s < NS; s++) rank[order[s]] = s;
  }

  function build() {
    var nEff = clamp(P.nEff, 2, NMAX), n = Math.min(NMAX, Math.ceil(nEff - 1e-6)), g = P.gap, osc = 0.5 + 0.5 * Math.sin(psi * DEG) * P.oscAmp;
    var coil0 = P.coil * P.coilK, o = 0, DZ = 1 / (NMAX * 32 + 64);
    for (var i = 0; i < n; i++) {
      var dir = i % 2 === 0 ? 1 : -1, sgn = i % 2 === 1 ? 1 : -1, rad = Math.min(i + 1, nEff), tcol = i / nEff;
      for (var s = 0; s < NS; s++) {
        var r = RSET * zz[s] / nEff, shift = r * g * i;
        var coil = coil0 * (1 + 1.5 * wAbs[s]) + 90 * wAbs[s] + 140 * kick[s];
        var ang = (phi[s] - coil * (i + 1) * osc) * sgn * DEG;
        inst[o] = cx[s] + shift * dir * (1 - Math.cos(ang));
        inst[o + 1] = cy[s] - shift * dir * Math.sin(ang);
        inst[o + 2] = r * rad;
        inst[o + 3] = (i * 32 + rank[s] + 1) * DZ;
        inst[o + 4] = tcol;
        o += STRIDE;
      }
    }
    // the ground: one huge disc at the back (so even the ground turns accent inside a person)
    inst[o] = 640; inst[o + 1] = 400; inst[o + 2] = 2400; inst[o + 3] = 0.999; inst[o + 4] = 1; o += STRIDE;
    return o / STRIDE;
  }

  function uploadMask(updated) {
    if (!updated && !(maskMax > 0)) { if (maskUp) return; }
    var m = body.mask, mx = 0;
    for (var i = 0; i < u8.length; i++) { var v = m[i]; v = v > 1 ? 1 : v > 0 ? v : 0; if (v > mx) mx = v; u8[i] = (v * 255 + 0.5) | 0; }
    maskMax = mx; maskUp = true;
    gl.bindTexture(gl.TEXTURE_2D, maskTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, u8);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function render(count) {
    var W = canvas.width, H = canvas.height, hue = hueFlow.value, A = hueRot(colA, hue), B = hueRot(colB, hue);
    gl.viewport(0, 0, W, H);
    gl.clearColor(B[0] / 255, B[1] / 255, B[2] / 255, 1); gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, count * STRIDE); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(U.uMask, 0);
    gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
    gl.uniform2f(U.uRes, W, H);
    gl.uniform3f(U.uA, A[0] / 255, A[1] / 255, A[2] / 255); gl.uniform3f(U.uB, B[0] / 255, B[1] / 255, B[2] / 255);
    gl.uniform1f(U.uBody, 1);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, SEG + 2, count);
    gl.bindVertexArray(null); gl.bindTexture(gl.TEXTURE_2D, null);
    gl.disable(gl.DEPTH_TEST);
  }

  function frame(dt, now) {
    if (dead) return;
    var t0 = performance.now();
    dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
    hueFlow.step(settings.hue, dt);
    var updated = body.update(dt, now);
    bodyCount = body.fresh ? body.people.length : 0;
    uploadMask(updated);
    updateTracks(input.read(), dt);
    step(dt);
    drawnI = build();
    render(drawnI);
    frameMs = performance.now() - t0;
  }
  function resize(w, h) { /* the viewport follows canvas.width / height every frame */ }
  var LIM = {look: [0, LOOKS.length - 1], rings: [2, NMAX], coil: [0, 400], speed: [0, 200], hue: [0, 360]};
  function set(o) {
    if (o && typeof o === 'object') Object.keys(LIM).forEach(function(k) {
      var v = o[k];
      if (typeof v === 'number' && Number.isFinite(v)) { v = clamp(v, LIM[k][0], LIM[k][1]); settings[k] = k === 'look' ? Math.round(v) : v; }
    });
    return Object.assign({}, settings);
  }
  function destroy() {
    if (dead) return; dead = true;
    tracks = []; pulses = []; input.clear(); kit.wantDepth(false);
    if (window.CoilringsSet === set) delete window.CoilringsSet;
    try { made.reverse().forEach(function(r) { gl['delete' + r[0]](r[1]); }); } catch (e) {}
    made = [];
  }
  kit.wantDepth(true);
  window.CoilringsSet = set; if (window._coilringsFx) set(window._coilringsFx);
  hueFlow.snap(settings.hue); snapLook();
  var out = {frame: frame, touch: function(t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
  if (window.WallTest) out.debug = function() {
    return {frames: frames, frameMs: frameMs, instances: drawnI, look: lookOf().name, nEff: P.nEff, contacts: tracks.length, held: heldN, taps: taps, holds: holds,
      pulses: pulses.length, wMax: wMax, zMax: zMax, bodyCount: bodyCount, maskMax: maskMax, displayHue: hueFlow.value, idleRate: P.rot * P.spinK,
      rates: Array.prototype.map.call(rate, function(v) { return Math.round(v * 100) / 100; }), glError: gl.getError(), settings: set(), destroyed: dead};
  };
  return out;
}
})();
