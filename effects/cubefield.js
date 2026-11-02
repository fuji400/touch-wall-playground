/* Cube Field (cubefield) -- p5-experiments build-out 2026-10-22 (batch 2), Builder I.
 * After "cubes" by Maksim Vasilyev, p5-experiments (https://github.com/vasilyev-maksim/p5-experiments), CC BY-NC 4.0; studio use, non-commercial.
 * A round field of cubes standing on a floor, seen isometric (orthographic) from a camera that slowly circles it, with the sketch's look:
 * white edges on black, flat faces lit by a cyan key light from the camera side and a violet point light (here it sits on the field's
 * focus: the centre, or the hand). Our own code, no p5.
 * Live: a hand drags the camera (sideways turns the field, up / down zooms); two hands split the roles by x order (the left hand tilts,
 * the right hand zooms); a tap sends a wave of cube size out across the field; a still hand (~0.8 s) raises the cubes under it into a
 * tower that settles on release; people in front of the wall clear the cubes inside their silhouette (they shrink and sink, the rim
 * lifts), so you walk a clearing through the field. Idle: the sketch's slow camera rotation and a soft swell from the centre now and then.
 * The cubes knob is the field's radius and grows / shrinks it ring by ring from the centre outward, as the sketch's resolution does.
 * WebGL2, one instanced draw with a depth buffer (exact occlusion in place of a painter's sort); the edges are drawn inside each face by
 * pixel distance, half width where two visible faces meet, so every edge reads the same width. No audio, no network, no assets. ASCII only.
 * Looks (2026-11-01): named presets of the lights and colours (key light, point light, ambient, edge, floor) and three knobs
 * (field size, cube size, gap). A new look eases the colours over ~0.8 s and the knobs as they always have (rings grow ring by
 * ring); a moved knob overrides the look's value until the next look. Look 0 (sketch) is the original picture.
 */
(function () {
  'use strict';
  registerWallPlugin({id: 'cubefield', title: 'Cube Field', author: 'Claude Opus 5.5 (p5 builder I)', create: create});

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
  function refreshHue(initial) {
    var value = Number.isFinite(initial) ? initial : 0;
    return {get value() { return value; }, snap: function (v) { value = v; }, step: function (target, dt) { var d = ((target - value + 540) % 360) - 180; if (Math.abs(d) < 0.001) { value = target % 360; return; } value = (value + d * (1 - Math.exp(-Math.max(0, Math.min(0.1, dt)) / 0.18)) + 360) % 360; }};
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function sstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function hueRot(c, deg) {                       // rotate an RGB colour about the grey axis (the shader idiom, on the CPU)
    var a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), k = 0.57735027, dk = k * (c[0] + c[1] + c[2]) * (1 - ca);
    return [clamp(c[0] * ca + k * (c[2] - c[1]) * sa + k * dk, 0, 1), clamp(c[1] * ca + k * (c[0] - c[2]) * sa + k * dk, 0, 1), clamp(c[2] * ca + k * (c[1] - c[0]) * sa + k * dk, 0, 1)];
  }

  var MAXR = 40;                                  // the field's largest radius in cells (the cubes knob's top)
  var FW = 80, FH = 50;                           // body lookup texels over the 1280 x 800 design space (16 px each)
  var TILT0 = 0.733, TILT_MIN = 0.36, TILT_MAX = 1.36;   // camera elevation: 42 degrees, and the range two hands can tilt through
  var ZMIN = Math.log(0.45), ZMAX = Math.log(2.6);
  var LOOKY = 0.35;                               // the camera looks at this height over the field centre (cells)
  var HOLD_S = 0.8, MOVE_R = 0.018;               // a finger that stays within MOVE_R (window units) this long is a hold
  var WAVE_PX = 560, WAVE_W = 1.2;                // tap wave speed (design px / s) and front width (cells)
  var MAXRIP = 6, MAXHOLD = 3;
  // the sketch's lights: cyan point light at the camera, violet point light at the origin, ambient 15
  var CYAN = [26 / 255, 255 / 255, 240 / 255], VIOLET = [160 / 255, 92 / 255, 255 / 255], AMB = 15 / 255;
  var KEY_GAIN = 0.6, VIO_GAIN = 0.62, VIO_Y = 0.45, EDGE = [0.93, 0.95, 0.97];
  // Looks: key light, point light, ambient, edge and floor colours (0..1; the gains above still apply to the two lights) and the
  // three shape knobs. Look 0 is the original (the constants above, the knob defaults). No look has a larger field or smaller cubes
  // than look 0, so none draws more cubes (instances on the wall) than today.
  var LOOKS = [
    {name: 'sketch', cubes: 20, size: 48, gap: 60, key: CYAN, vio: VIOLET, amb: [AMB, AMB, AMB], edge: EDGE, bg: [0, 0, 0]},
    {name: 'blueprint', cubes: 20, size: 56, gap: 100, key: [0.47, 0.67, 1], vio: [0.24, 0.35, 0.78], amb: [0.05, 0.14, 0.33], edge: [0.95, 0.97, 1], bg: [0.055, 0.16, 0.36]},
    {name: 'paper', cubes: 20, size: 48, gap: 30, key: [0.59, 0.57, 0.53], vio: [0.16, 0.12, 0.08], amb: [0.67, 0.65, 0.6], edge: [0.08, 0.08, 0.1], bg: [0.925, 0.9, 0.847]},
    {name: 'ember', cubes: 16, size: 60, gap: 80, key: [1, 0.47, 0.08], vio: [0.86, 0.12, 0.04], amb: [0.04, 0.02, 0.01], edge: [1, 0.85, 0.6], bg: [0.02, 0.005, 0]},
    {name: 'mono', cubes: 18, size: 64, gap: 40, key: [1, 1, 1], vio: [0.35, 0.35, 0.35], amb: [0.28, 0.28, 0.28], edge: [0, 0, 0], bg: [0, 0, 0]},
    {name: 'pastel', cubes: 20, size: 52, gap: 50, key: [1, 0.7, 0.78], vio: [0.55, 0.75, 1], amb: [0.47, 0.45, 0.51], edge: [0.35, 0.22, 0.42], bg: [0.965, 0.933, 0.91]}
  ];
  var NPAL = 15, PAL_TAU = 0.25;
  var LIM = {look: [0, LOOKS.length - 1], cubes: [4, 40], size: [24, 96], gap: [0, 150], spin: [0, 100], hue: [0, 360]};

  // one cube: five faces (the floor is never seen), x and z in -0.5..0.5, y in 0..1; per vertex (x, y, z, face id, u, v).
  // Faces: 0 top (u = +x, v = +z), 1 +x and 2 -x (u = +z, v = +y), 3 +z and 4 -z (u = +x, v = +y); each wound CCW seen from outside.
  function cubeMesh() {
    var NRM = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]], out = [];
    function corner(f, u, v) { return f === 0 ? [u - 0.5, 1, v - 0.5] : f === 1 ? [0.5, v, u - 0.5] : f === 2 ? [-0.5, v, u - 0.5] : f === 3 ? [u - 0.5, v, 0.5] : [u - 0.5, v, -0.5]; }
    for (var f = 0; f < 5; f++) {
      var q = [[0, 0], [1, 0], [1, 1], [0, 1]], p = q.map(function (c) { return corner(f, c[0], c[1]); }), n = NRM[f];
      var e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      var cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      var order = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
      for (var j = 0; j < 6; j++) { var k = order[j]; out.push(p[k][0], p[k][1], p[k][2], f, q[k][0], q[k][1]); }
    }
    return new Float32Array(out);
  }

  var VS = [
    '#version 300 es',
    'layout(location = 0) in vec3 aPos;',
    'layout(location = 1) in vec3 aFace;',
    'layout(location = 2) in vec4 aInst;',      // cube: x, z (cells), footprint, height (cells)
    'uniform vec2 uCS, uTS;',                   // cos / sin of the camera yaw and tilt
    'uniform float uP, uLookY, uLine, uDev;',   // px per cell (design), look-at height, edge width (device px), device px per design px
    'uniform vec3 uKey, uKeyCol, uVio, uVioCol, uToCam, uLamp, uLampCol, uAmb;',   // uAmb: the look's ambient colour
    'out vec2 vUv; flat out vec3 vCol; flat out vec4 vW; flat out vec2 vStack;',
    'vec3 nrm(int f){ return f == 0 ? vec3(0., 1., 0.) : f == 1 ? vec3(1., 0., 0.) : f == 2 ? vec3(-1., 0., 0.) : f == 3 ? vec3(0., 0., 1.) : vec3(0., 0., -1.); }',
    'float vis(vec3 n){ return dot(n, uToCam) > .002 ? 1. : 0.; }',
    'void main(){',
    '  int f = int(aFace.x + .5);',
    '  vec3 sz = vec3(aInst.z, aInst.w, aInst.z);',
    '  vec3 wp = vec3(aInst.x, 0., aInst.y) + aPos * sz;',
    '  float xr = wp.x * uCS.x - wp.z * uCS.y, zr = wp.x * uCS.y + wp.z * uCS.x;',
    '  float U = wp.y * uTS.x - zr * uTS.y, T = zr * uTS.x + wp.y * uTS.y;',
    '  gl_Position = vec4(xr * uP / 640., (U - uLookY * uTS.x) * uP / 400., -T / 160., 1.);',
    '  vUv = aFace.yz;',
    '  vec3 n = nrm(f);',
    '  vec3 fc = vec3(aInst.x, .5 * aInst.w, aInst.y) + n * sz * .5;',  // face centre: one colour per face (flat, no gradients)
    '  float kd = max(dot(n, uKey), 0.), vd = max(dot(n, normalize(uVio - fc)), 0.);',
    '  vec3 lp = uLamp - fc; float ld = max(dot(n, normalize(lp)), 0.) / (1. + dot(lp.xz, lp.xz) / 14.);',   // the hold lamp: over the held hand, falls off
    '  vCol = vec3(uAmb) + uKeyCol * kd + uVioCol * vd + uLampCol * ld;',
    // the faces across this face's edges u = 0, u = 1, v = 0, v = 1: a crease shared with another visible face draws half width
    '  vec3 a, b, c, d;',
    '  if (f == 0) { a = vec3(-1., 0., 0.); b = vec3(1., 0., 0.); c = vec3(0., 0., -1.); d = vec3(0., 0., 1.); }',
    '  else if (f <= 2) { a = vec3(0., 0., -1.); b = vec3(0., 0., 1.); c = vec3(0., -1., 0.); d = vec3(0., 1., 0.); }',
    '  else { a = vec3(-1., 0., 0.); b = vec3(1., 0., 0.); c = vec3(0., -1., 0.); d = vec3(0., 1., 0.); }',
    '  float W = uLine * clamp(aInst.z * uP / 18., .35, 1.);',
    '  vW = W * (1. - .5 * vec4(vis(a), vis(b), vis(c), vis(d)));',
    '  vStack = vec2(f == 0 ? 0. : aInst.w / max(aInst.z, 1e-4), W);',
    '}'
  ].join('\n');
  var FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec2 vUv; flat in vec3 vCol; flat in vec4 vW; flat in vec2 vStack;',
    'uniform vec3 uEdge;',
    'out vec4 o;',
    'void main(){',
    '  float pu = max(length(vec2(dFdx(vUv.x), dFdy(vUv.x))), 1e-6), pv = max(length(vec2(dFdx(vUv.y), dFdy(vUv.y))), 1e-6);',
    '  vec4 dd = vec4(vUv.x / pu, (1. - vUv.x) / pu, vUv.y / pv, (1. - vUv.y) / pv);',
    '  vec4 cv = clamp(vW - dd + .5, 0., 1.);',
    '  float c = max(max(cv.x, cv.y), max(cv.z, cv.w));',
    // a tower reads as a stack of cubes: a seam every cube height on its sides
    '  if (vStack.x > 1.25) { float s = vUv.y * vStack.x; if (s > .5 && s < vStack.x - .5) { float ds = abs(fract(s + .5) - .5) / (vStack.x * pv); c = max(c, clamp(vStack.y * .5 - ds + .5, 0., 1.)); } }',
    '  o = vec4(mix(vCol, uEdge, c), 1.);',
    '}'
  ].join('\n');

  function create(canvas, kit) {
    var gl = canvas.getContext('webgl2', {antialias: true, alpha: false, depth: true, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance'});
    if (!gl) throw new Error('Cube Field needs WebGL2');
    var body = WallBody.create(kit, {}), input = refreshContacts(kit, 120), hueFlow = refreshHue(0);
    var dead = false, time = 0, frames = 0, frameMs = 0, size = [canvas.width, canvas.height];
    var settings = {look: 0, cubes: 20, size: 48, gap: 60, spin: 40, hue: 0};
    var disp = {cubes: 20, size: 48, gap: 60, spin: 40};
    // the look: palette [key, point light, ambient, edge, floor] eased every frame; a moved knob overrides the look until the next look
    var LK = LOOKS[0], over = {cubes: false, size: false, gap: false}, looks = 0;
    var palNow = new Float32Array(NPAL), palGo = new Float32Array(NPAL);
    function want(k) { return (k === 'spin' || over[k]) ? settings[k] : LK[k]; }
    function lookTargets() { [LK.key, LK.vio, LK.amb, LK.edge, LK.bg].forEach(function (c, i) { palGo[i * 3] = c[0]; palGo[i * 3 + 1] = c[1]; palGo[i * 3 + 2] = c[2]; }); }
    function applyLook(i) { LK = LOOKS[i]; over.cubes = over.size = over.gap = false; lookTargets(); looks++; }
    function snapLook() { lookTargets(); palNow.set(palGo); disp.cubes = want('cubes'); disp.size = want('size'); disp.gap = want('gap'); disp.spin = want('spin'); }
    function pc(i) { return [palNow[i * 3], palNow[i * 3 + 1], palNow[i * 3 + 2]]; }
    var seed = 0x9e3779b9 >>> 0;
    function rnd() { seed = (seed + 0x6d2b79f5) >>> 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }

    // every grid cell within MAXR + 1 of the centre, nearest first (so the per-frame loop stops at the field's edge)
    var cellList = [];
    for (var gz = -MAXR - 1; gz <= MAXR + 1; gz++) for (var gx = -MAXR - 1; gx <= MAXR + 1; gx++) { var dc = Math.hypot(gx, gz); if (dc <= MAXR + 1) cellList.push([gx, gz, dc]); }
    cellList.sort(function (a, b) { return a[2] - b[2]; });
    var N = cellList.length, CX = new Float32Array(N), CZ = new Float32Array(N), CD = new Float32Array(N);
    for (var ci = 0; ci < N; ci++) { CX[ci] = cellList[ci][0]; CZ[ci] = cellList[ci][1]; CD[ci] = cellList[ci][2]; }
    cellList = null;
    var bodyE = new Float32Array(N), rimE = new Float32Array(N), inst = new Float32Array(N * 4), instN = 0;
    var maskIdx = new Int32Array(FW * FH).fill(-1), maskAt = -1e9;

    var cam = {yaw: 0.62, yawT: 0.62, tilt: TILT0, tiltT: TILT0, zl: 0, zlT: 0, gate: 1};
    var vio = {x: 0, y: VIO_Y, z: 0}, lamp = {x: 0, z: 0, a: 0};
    var tracks = [], ripples = [], holds = [], taps = 0, holdCount = 0, bodyCount = 0, contactsN = 0, nextSwell = 2.5, maxRise = 0, bodyCubes = 0;
    var cy = 1, sy = 0, ct = 1, st = 0, P = 44;
    function camSet() { cy = Math.cos(cam.yaw); sy = Math.sin(cam.yaw); ct = Math.cos(cam.tilt); st = Math.sin(cam.tilt); P = disp.size * Math.exp(cam.zl); }
    var gtmp = [0, 0];
    function ground(sxp, syp, y0, out) {           // design px -> the point of the plane y = y0 under it (cells): the 2 x 2 inverse of the iso view
      var R = (sxp - 640) / P, U = LOOKY * ct + (400 - syp) / P, zr = (y0 * ct - U) / Math.max(0.05, st);
      out[0] = R * cy + zr * sy; out[1] = -R * sy + zr * cy; return out;
    }

    // --- GL
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Cube Field shader: ' + gl.getShaderInfoLog(s)); return s; }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS), prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Cube Field link: ' + gl.getProgramInfoLog(prog));
    var U = {};
    ['uCS', 'uTS', 'uP', 'uLookY', 'uLine', 'uDev', 'uKey', 'uKeyCol', 'uVio', 'uVioCol', 'uToCam', 'uAmb', 'uEdge', 'uLamp', 'uLampCol'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    var meshBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, meshBuf); gl.bufferData(gl.ARRAY_BUFFER, cubeMesh(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    var instBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);

    function remapMask(now) {                       // screen texel -> body cell (through the registration; a straight stretch without one)
      if (now - maskAt < 2000) return; maskAt = now;
      for (var ty = 0; ty < FH; ty++) for (var tx = 0; tx < FW; tx++) {
        var sx = (tx + 0.5) / FW, syy = (ty + 0.5) / FH, k = kit.fromScreen(sx, syy), u, v;
        if (k && Number.isFinite(k[0]) && Number.isFinite(k[1])) { u = k[0]; v = k[1]; } else { u = sx * 512; v = syy * 424; }
        var cx = Math.floor(u / 4), cyy = Math.floor(v / 4);
        maskIdx[ty * FW + tx] = cx >= 0 && cx < body.w && cyy >= 0 && cyy < body.h ? cyy * body.w + cx : -1;
      }
    }

    function addRipple(x, z, amp, pxs) {
      if (ripples.length >= MAXRIP) ripples.shift();
      ripples.push({x: x, z: z, r: -1.5, amp: amp, pxs: pxs, maxR: Math.hypot(x, z) + MAXR + 4});
    }
    function tap(wx, wy) {                          // window 0..1
      ground(wx * 1280, wy * 800, 0.4, gtmp);
      if (!Number.isFinite(gtmp[0]) || !Number.isFinite(gtmp[1])) return;
      addRipple(gtmp[0], gtmp[1], 1, WAVE_PX); taps++;
    }

    function updateTracks(pts, dt) {
      var i, j, t;
      for (i = 0; i < tracks.length; i++) tracks[i].seen = false;
      for (i = 0; i < pts.length; i++) {
        var x = pts[i][0], y = pts[i][1], best = null, bd = 0.08;
        for (j = 0; j < tracks.length; j++) { t = tracks[j]; if (t.seen) continue; var d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } }
        if (!best) { best = {x: x, y: y, sx: x, sy: y, ax: x, ay: y, dx: 0, dy: 0, still: 0, drag: false, hold: null}; tracks.push(best); tap(x, y); }
        best.x = x; best.y = y; best.seen = true;
        if (Math.hypot(x - best.ax, y - best.ay) > MOVE_R) {
          best.ax = x; best.ay = y; best.still = 0; best.drag = true;
          if (best.hold) { best.hold.release = true; best.hold = null; }
        } else { best.still += dt; if (best.still > 0.35) best.drag = false; }
        if (best.still >= HOLD_S && !best.hold && holds.length < MAXHOLD) {
          ground(best.ax * 1280, best.ay * 800, 0.4, gtmp);
          if (Number.isFinite(gtmp[0]) && Number.isFinite(gtmp[1])) { best.hold = {x: gtmp[0], z: gtmp[1], amt: 0, t: 0, release: false}; holds.push(best.hold); holdCount++; }
        }
      }
      for (i = tracks.length - 1; i >= 0; i--) if (!tracks[i].seen) { if (tracks[i].hold) tracks[i].hold.release = true; tracks.splice(i, 1); }
      var k = 1 - Math.exp(-dt / 0.06);
      for (i = 0; i < tracks.length; i++) { t = tracks[i]; var nx = t.sx + (t.x - t.sx) * k, ny = t.sy + (t.y - t.sy) * k; t.dx = nx - t.sx; t.dy = ny - t.sy; t.sx = nx; t.sy = ny; }
      // the hand drives the camera: one hand turns (x) and zooms (y); two hands by x order: the left one tilts, the right one zooms
      if (tracks.length === 1) {
        t = tracks[0];
        if (t.drag && !t.hold) { cam.yawT += t.dx * Math.PI; cam.zlT -= t.dy * 1.5; }
      } else if (tracks.length >= 2) {
        var L = tracks[0], R = tracks[0], sum = 0, n = 0;
        for (i = 0; i < tracks.length; i++) { t = tracks[i]; if (t.sx < L.sx) L = t; if (t.sx > R.sx) R = t; if (t.drag && !t.hold) { sum += t.dx; n++; } }
        if (n) cam.yawT += sum / n * Math.PI;
        if (L.drag && !L.hold) cam.tiltT -= L.dy * 1.7;
        if (R.drag && !R.hold) cam.zlT -= R.dy * 1.5;
      }
    }

    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now(), i, j;
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      hueFlow.step(settings.hue, dt);
      var ke = 1 - Math.exp(-dt / 0.35), kp = 1 - Math.exp(-dt / PAL_TAU);
      for (var pi = 0; pi < NPAL; pi++) palNow[pi] += (palGo[pi] - palNow[pi]) * kp;
      disp.size += (want('size') - disp.size) * ke; disp.gap += (want('gap') - disp.gap) * ke; disp.spin += (settings.spin - disp.spin) * ke;
      var dr = want('cubes') - disp.cubes;          // rings grow / shrink outward at a steady pace with an eased finish (no jump)
      disp.cubes += Math.abs(dr) < 1e-4 ? dr : Math.sign(dr) * Math.min(Math.abs(dr), Math.max(Math.abs(dr) * ke, dt * 14));
      body.update(dt, now); remapMask(now);
      bodyCount = body.fresh ? body.people.length : 0;
      var pts = input.read(); contactsN = pts.length;
      camSet();
      updateTracks(pts, dt);
      var touching = tracks.length > 0;
      cam.gate += ((touching ? 0 : 1) - cam.gate) * (1 - Math.exp(-dt / (touching ? 0.35 : 1.6)));
      // the sketch: 0.005 rad per frame at 60 fps = 0.3 rad/s at full spin. Ours lingers on the diagonal views and hurries through the
      // four views where the grid lines up with the camera (an orthographic grid seen square-on reads as stripes, not cubes)
      cam.yawT += disp.spin / 100 * 0.3 * cam.gate * dt * (1 + 0.6 * Math.cos(4 * cam.yaw));
      if (!touching) { cam.zlT *= Math.exp(-dt / 6); cam.tiltT += (TILT0 - cam.tiltT) * (1 - Math.exp(-dt / 6)); }
      cam.zlT = clamp(cam.zlT, ZMIN, ZMAX); cam.tiltT = clamp(cam.tiltT, TILT_MIN, TILT_MAX);
      cam.yaw += (cam.yawT - cam.yaw) * (1 - Math.exp(-dt / 0.2));
      cam.tilt += (cam.tiltT - cam.tilt) * ke; cam.zl += (cam.zlT - cam.zl) * ke;
      if (Math.abs(cam.yaw) > 1e4) { var wrap = Math.floor(cam.yaw / (2 * Math.PI)) * 2 * Math.PI; cam.yaw -= wrap; cam.yawT -= wrap; }
      camSet();

      // the violet light sits on the focus: the first hand's floor point, else the centre
      var fx = 0, fz = 0;
      if (tracks.length) { ground(tracks[0].sx * 1280, tracks[0].sy * 800, 0.4, gtmp); if (Number.isFinite(gtmp[0]) && Number.isFinite(gtmp[1])) { fx = clamp(gtmp[0], -60, 60); fz = clamp(gtmp[1], -60, 60); } }
      var kv = 1 - Math.exp(-dt / 0.3); vio.x += (fx - vio.x) * kv; vio.z += (fz - vio.z) * kv;
      lamp.a = 0; for (i = 0; i < holds.length; i++) if (holds[i].amt > lamp.a) { lamp.a = holds[i].amt; lamp.x = holds[i].x; lamp.z = holds[i].z; }   // a held hand hangs a lamp over its tower

      // waves and holds
      for (i = ripples.length - 1; i >= 0; i--) { var rp = ripples[i]; rp.r += rp.pxs / P * dt; if (rp.r - 4 > rp.maxR) ripples.splice(i, 1); }
      if (!touching && !body.present) { nextSwell -= dt; if (nextSwell <= 0) { nextSwell = 8 + rnd() * 5; addRipple(0, 0, 0.42, 300); } }
      var holdRad = Math.max(1.6, 150 / P);
      for (i = holds.length - 1; i >= 0; i--) {
        var hd = holds[i];
        if (!hd.release) { hd.t += dt; hd.amt += (1 - hd.amt) * (1 - Math.exp(-dt / 0.4)); }
        else { hd.amt *= Math.exp(-dt / 0.5); if (hd.amt < 0.01) holds.splice(i, 1); }
        hd.top = 4 + 4 * Math.min(1, hd.t / 2.5);   // cube heights at the tower's centre: ~5 after a second, 8 after two and a half
      }

      // per cube: field extent (rings), body clearing, tap waves, hold towers
      var gapF = 1 / (1 + disp.gap / 100), rings = disp.cubes, kin = 1 - Math.exp(-dt / 0.12), kout = 1 - Math.exp(-dt / 0.45);
      var mask = body.mask, sdf = body.sdf, nRip = ripples.length, nHold = holds.length, n = 0, botM = P * 8;
      bodyCubes = 0; maxRise = 0;
      for (i = 0; i < N; i++) {
        var d = CD[i];
        if (d > rings + 1) break;
        var e = sstep(0, 1, rings + 0.5 - d);
        if (e < 0.18) { bodyE[i] = 0; rimE[i] = 0; continue; }              // no specks at the rim: a ring appears from a small cube
        var x = CX[i], z = CZ[i], xr = x * cy - z * sy, zr = x * sy + z * cy;
        var sx = 640 + xr * P, syp = 400 - (0.4 * ct - zr * st - LOOKY * ct) * P;
        if (sx < -2 * P || sx > 1280 + 2 * P || syp < -2 * P || syp > 800 + botM) { bodyE[i] = 0; rimE[i] = 0; continue; }   // off the wall
        var bt = 0, rt = 0;
        if (sx >= 0 && sx < 1280 && syp >= 0 && syp < 800) {
          var mi = maskIdx[(syp >> 4) * FW + (sx >> 4)];
          if (mi >= 0) { bt = sstep(0.25, 0.75, mask[mi] || 0); var sd = sdf[mi]; if (sd > 0 && sd < 6) rt = 1 - sd / 6; }
        }
        var b = bodyE[i]; b += (bt - b) * (bt > b ? kin : kout); bodyE[i] = b;
        var rm = rimE[i]; rm += (rt - rm) * (rt > rm ? kin : kout); rimE[i] = rm;
        if (b > 0.5) bodyCubes++;
        var wv = 0;
        for (j = 0; j < nRip; j++) {
          var r = ripples[j], q = Math.hypot(x - r.x, z - r.z) - r.r;
          if (q > -4 && q < 2) { var q2 = q + 2.6; wv += r.amp * (Math.exp(-q * q / (WAVE_W * WAVE_W)) - 0.35 * Math.exp(-q2 * q2 / (WAVE_W * WAVE_W))); }
        }
        var rise = 0;
        for (j = 0; j < nHold; j++) {
          var h = holds[j], dh = Math.hypot(x - h.x, z - h.z) / holdRad;
          if (dh < 1) { var f1 = 1 - dh * dh; rise = Math.max(rise, h.amt * h.top * f1 * f1); }
        }
        if (rise > maxRise) maxRise = rise;
        var w0 = gapF * e;
        var w = w0 * (1 - 0.84 * b) * Math.max(0.3, 1 + 0.34 * wv);
        var hgt = w0 * (1 - 0.8 * b) * Math.max(0.25, 1 + 1.1 * wv) + rise * w0 * (1 - 0.8 * b) + rm * 0.6 * w0 * (1 - b);
        if (w < 0.004 || hgt < 0.004) continue;
        var o = n * 4; inst[o] = x; inst[o + 1] = z; inst[o + 2] = w; inst[o + 3] = hgt; n++;
      }
      instN = n;
      draw();
      frameMs = performance.now() - t0;
    }

    function draw() {
      var w = canvas.width, h = canvas.height, dev = w / 1280;
      gl.viewport(0, 0, w, h);
      var hue = hueFlow.value, bgc = hueRot(pc(4), hue);
      gl.clearColor(bgc[0], bgc[1], bgc[2], 1); gl.clearDepth(1);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); gl.disable(gl.BLEND);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!instN) return;
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, instN * 4); gl.bindBuffer(gl.ARRAY_BUFFER, null);
      var tcx = ct * sy, tcy = st, tcz = ct * cy;                    // toward the camera (world)
      var kx = tcx + 0.6 * cy, kyy = tcy + 0.9, kz = tcz - 0.6 * sy, kl = Math.hypot(kx, kyy, kz) || 1;   // key light: camera side, up and right (tops bright, right side mid, left side dark)
      var kc = hueRot(pc(0), hue), vc = hueRot(pc(1), hue), ac = hueRot(pc(2), hue), ec = hueRot(pc(3), hue);
      gl.uniform2f(U.uCS, cy, sy); gl.uniform2f(U.uTS, ct, st);
      gl.uniform1f(U.uP, P); gl.uniform1f(U.uLookY, LOOKY); gl.uniform1f(U.uLine, 1.3 * dev); gl.uniform1f(U.uDev, dev);
      gl.uniform3f(U.uKey, kx / kl, kyy / kl, kz / kl); gl.uniform3f(U.uKeyCol, kc[0] * KEY_GAIN, kc[1] * KEY_GAIN, kc[2] * KEY_GAIN);
      gl.uniform3f(U.uLamp, lamp.x, 5.5, lamp.z); gl.uniform3f(U.uLampCol, vc[0] * lamp.a * 1.1, vc[1] * lamp.a * 1.1, vc[2] * lamp.a * 1.1);
      gl.uniform3f(U.uVio, vio.x, vio.y, vio.z); gl.uniform3f(U.uVioCol, vc[0] * VIO_GAIN, vc[1] * VIO_GAIN, vc[2] * VIO_GAIN);
      gl.uniform3f(U.uToCam, tcx, tcy, tcz); gl.uniform3f(U.uAmb, ac[0], ac[1], ac[2]); gl.uniform3f(U.uEdge, ec[0], ec[1], ec[2]);
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, instN);
      gl.bindVertexArray(null);
    }

    function set(o) {
      if (o && typeof o === 'object') {
        var lk = o.look;                              // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, LIM.look[0], LIM.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['cubes', 'size', 'gap'].forEach(function (k) {   // a knob that MOVED overrides the look's value until the next look
          var v = o[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
          v = clamp(v, LIM[k][0], LIM[k][1]); if (v !== settings[k]) { settings[k] = v; over[k] = true; }
        });
        ['spin', 'hue'].forEach(function (k) { var v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) settings[k] = clamp(v, LIM[k][0], LIM[k][1]); });
      }
      return {look: settings.look, cubes: settings.cubes, size: settings.size, gap: settings.gap, spin: settings.spin, hue: settings.hue};
    }
    function resize(w, h) { if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) size = [w, h]; }
    function destroy() {
      if (dead) return; dead = true;
      tracks = []; ripples = []; holds = []; input.clear();
      try { gl.deleteBuffer(meshBuf); gl.deleteBuffer(instBuf); gl.deleteVertexArray(vao); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); } catch (e) {}
      kit.wantDepth(false);
      if (window.CubefieldSet === set) delete window.CubefieldSet;
    }

    kit.wantDepth(true);
    window.CubefieldSet = set; if (window._cubefieldFx) set(window._cubefieldFx);
    LK = LOOKS[settings.look]; snapLook(); hueFlow.snap(settings.hue);   // start on the stored look and knobs without easing in
    var out = {frame: frame, touch: function (t) { if (!dead && t) input.wake(t.x, t.y); }, resize: resize, destroy: destroy};
    if (window.WallTest) out.debug = function () {
      return {frames: frames, frameMs: frameMs, contacts: contactsN, tracks: tracks.length, taps: taps, holds: holdCount, holdsActive: holds.length,
        ripples: ripples.length, maxRise: maxRise, bodyCount: bodyCount, bodyCubes: bodyCubes, instances: instN,
        cam: {yaw: cam.yaw, tilt: cam.tilt, zoom: Math.exp(cam.zl), gate: cam.gate}, settings: set(),
        disp: {cubes: disp.cubes, size: disp.size, gap: disp.gap, spin: disp.spin}, look: LK.name, looks: looks, overrides: Object.assign({}, over),
        displayHue: hueFlow.value, size: size, destroyed: dead};
    };
    return out;
  }
})();
