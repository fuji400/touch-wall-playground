/*
 * LIQUID PAINT  (id: liquid)  -  moving-touch paint, with an opt-in blue/white near-wall plume.
 * MODE 'paint' remains the default. MODE 'plume' continuously emits smoke and heat from fresh confirmed depth hands or touch tips;
 * closer hands emit more, stopped/missing input stops emission, and buoyancy carries the remaining smoke upward through open edges.
 * Plume uses the existing depth hand heuristic: occlusion and false hand candidates still need physical validation.
 * The plume palette and lift are independent of paint's saved palette/flow. Brush, swirl and fade controls apply in either mode.
 * Both mode transitions clear the fluid field because RGB paint and smoke/heat channels have different meanings.
 *
 * Idea: every hand the Kinect sees reaching toward the wall becomes a brush. Each person keeps one colour from a curated palette for as long
 * as they are tracked (both their hands share it); the colour swirls and fades on black. A still hand only shows a faint halo so people can
 * see where they are; it paints when it moves. When the Kinect loses a hand (or stops sending frames) that hand stops painting at once.
 *
 * How it reads the Kinect (Kinect v2 through libfreenect2: depth only, no skeleton): depth minus the empty-wall measurement gives how far
 * each pixel is in front of the wall. A connected region 4-150 cm in front of the wall is a person (or an object); the part of it nearest
 * the wall (within TIP_MM of its closest point, and within HAND_ZONE_MM of the wall) is a hand; up to two separate such patches per person.
 * The person (and so the colour) is the torso: the part of the region well back from the wall. When two people touch or cross arms they
 * become one region; each hand then belongs to the torso it reaches through the body, but that is a guess, so the hand keeps the colour it
 * had until the two separate (then it follows its own person again within CONFIRM frames). Crossed arms can swap two colours meanwhile.
 * The Kinect sits behind the people: a hand in front of its own body (seen from the Kinect) is hidden and does not paint.
 * With the bridge's every-frame fingertip stream (kit.fingers), every fingertip ON the wall is a brush and the depth tracking only says
 * whose it is (colour); body parts never paint. Without the stream (older bridge, previews): the bridge's fingertip moves a hand's brush
 * onto the finger, and with TOUCH_ONLY only such hands paint.
 * Hands are matched frame to frame, smoothed with a One Euro filter, and mapped onto the picture through the touch registration. That is a
 * WALL-PLANE mapping: paint lands where the Kinect sees the hand against the wall, not on the hand itself. Projecting onto bodies would need
 * a depth-aware (3D) projector calibration, which this rig does not have yet.
 * Without depth frames (Kinect off), fingertip touches from the bridge paint instead.
 *
 * Knobs (window.LiquidPaint, live; also the preview page keys): BRUSH (brush size), FORCE (how hard hand speed pushes), TURBULENCE (swirl),
 * FADE_S (seconds for the colour to fade), PUSH (1 = paint shoots ahead of the hand, -1 = it streams back behind it), PALETTE ('ember' | 'tide' | 'aurora' | 'neon' | 'mono'), BLOOM (glow, 0 = off), HALO (hand marker
 * brightness, 0 = off), STILL_SPEED (a hand slower than this, in screen widths per second, does not paint), and the hand-finding distances.
 *
 * ---------------------------------------------------------------------------------------------------------------------------------------
 * The fluid simulation and display shaders below are ported from WebGL-Fluid-Simulation by Pavel Dobryakov
 * (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation, commit a2d2929), used under the MIT License:
 *
 * MIT License
 *
 * Copyright (c) 2017 Pavel Dobryakov
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * ---------------------------------------------------------------------------------------------------------------------------------------
 * Changes from upstream: one canvas inside the wall plug-in host (plugins.js) instead of a page; no sunrays, GUI, screenshots, input
 * handlers or own animation loop; opaque black background; restrained bloom; procedural dither instead of the noise texture; a hand-halo
 * pass in the display shader; splats driven by Kinect hand tracks. The One Euro filter follows Casiez, Roussel and Vogel, "1 Euro Filter:
 * A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems", CHI 2012 (written from the paper).
 */
(function() {
  'use strict';

  var K = window.LiquidPaint = window.LiquidPaint || {
    MODE: 'paint',          // paint = original moving touches; plume = continuous near-wall blue smoke
    BRUSH: 0.2,             // Pavel SPLAT_RADIUS (percent of the screen, squared falloff)
    FORCE: 0.1,             // x Pavel SPLAT_FORCE, for a hand moving one screen width per second (more makes a jet that rolls all the paint ahead)
    PUSH: -1,               // 1 = the paint is pushed the way the hand moves (shoots ahead); -1 = it streams back behind the hand (Billy, 10-02)
    TURBULENCE: 22,         // Pavel CURL (vorticity confinement)
    FADE_S: 3.0,            // colour fades to ~37% in this many seconds (Pavel DENSITY_DISSIPATION = 1 / FADE_S)
    VELOCITY_FADE: 0.8,     // Pavel VELOCITY_DISSIPATION (Pavel 0.2: higher keeps paint near where it was laid)
    PALETTE: 'ember',
    HUE: 0,                 // "Colour shift" (fx liquid_hue, degrees 0-360): rotates the paint palette AND the plume's blue on top of the swatch; 0 = as designed
    INTENSITY: 0.07,        // dye per frame of a moving hand (Pavel's mouse adds 0.15 a frame: too much on a projector)
    BLOOM: 0.25,            // Pavel BLOOM_INTENSITY was 0.8: too hot for a dark room
    BLOOM_THRESHOLD: 0.7,
    HALO: 0.35,
    STILL_SPEED: 0.06,      // screen widths per second, measured as how far the hand really travelled over MOTION_WINDOW_S (jitter goes nowhere)
    MOTION_WINDOW_S: 0.25,
    GLIDE: 22,              // per second: how quickly the brush catches up with the 30 Hz hand positions (60 Hz strokes, no beads)
    NEAR_MM: 40,            // closer to the wall than this is wall noise
    BODY_ZONE_MM: 1500,     // a person or object is within this distance of the wall
    HAND_ZONE_MM: 350,      // a hand is within this distance of the wall...
    TIP_MM: 80,             // ...and within this of its body's nearest point
    TORSO_REL_MM: 200,      // a person's torso = the part of the body at least this much further from the wall than its nearest point
    MIN_TORSO_PX: 120,
    MIN_BODY_PX: 150,       // at half resolution (256 x 212)
    BORDER_PX: 24,          // the Kinect image's outer border is noisy (same as the bridge's touch finder): ignored
    MIN_HAND_PX: 20,
    MAX_BAND: 0.6,          // more than this share of the wall "in front of the wall" = the wall reference is stale: no hands
    CONFIRM: 3,             // frames a new hand must be seen before it may paint
    GATE_PX: 60,            // Kinect pixels a hand may move between frames and stay the same hand
    REACQUIRE_S: 0.8,       // a lost hand / person found again within this keeps its id and colour
    FRESH_MS: 150,          // a depth frame older than this is ignored (the Kinect has stopped)
    SNAP: 0.16,             // screen widths: a bridge fingertip this close to a hand is that hand's finger on the wall
    TIP_FRESH_MS: 400,      // ...if it was reported this recently
    FINGER_GATE: 0.12,      // screen widths a fingertip may move between two bridge reports (~36 ms apart) and stay the same brush
    FINGER_HOLD_MS: 600,    // a fingertip missing from the reports this long has left the wall: its brush ends (live 10-02: the bridge loses a
                            // second hand for 0.2-0.6 s at a time; shorter holds broke the stroke and restarted the brush)
    FINGER_REACH: 0.8,      // screen widths per second a missing fingertip may have moved and still be the same brush when it comes back
    TIP_LEARN_SPEED: 0.25,  // screen widths per second: the fingertip offset is only updated while the hand is slower than this
    TIP_HOLD_MS: 600,       // the brush keeps the fingertip offset this long after the last report, then eases back to the hand
    TOUCH_ONLY: true,       // paint (and show a halo) only while the bridge sees that hand's fingertip ON the wall. Our own finder also
                            // picks up hips, elbows and other body parts near the wall (live 10-02: 2+ "hands" in 44% of frames for one
                            // real hand); the bridge's touch finder rejects those. false = any hand near the wall paints (hover painting)
    MINCUTOFF: 1.2, BETA: 4.0, DCUTOFF: 1.0   // One Euro filter (screen units)
  };

  // Plume has its own tuning; switching back never overwrites the saved paint knobs.
  var P = {BUOYANCY: 75, SMOKE_LIFT: 8, COOL: 1.1, FADE: 0.3, VELOCITY_FADE: 0.45,
           INK: 0.16, HEAT: 0.3, JET: 1.3, BLOOM: 0.45};

  // control-page settings (fx keys from the bridge) -> knobs; unknown or missing words leave a knob as it is
  window.LiquidPaintSet = function(fx) {
    var m = {liquidmode: ['MODE', {paint: 'paint', plume: 'plume'}], brush: ['BRUSH', {small: 0.12, medium: 0.2, large: 0.35}], swirl: ['TURBULENCE', {calm: 8, medium: 22, wild: 40}],
             fade: ['FADE_S', {quick: 1.5, medium: 3, long: 6}], flow: ['PUSH', {behind: -1, ahead: 1}]};
    for (var key in m) if (fx && fx[key] in m[key][1]) K[m[key][0]] = m[key][1][fx[key]];
    if (fx && fx.palette && PALETTES[fx.palette]) K.PALETTE = fx.palette;
  };
  var PALETTES = {
    ember:  [[1.0, 0.38, 0.08], [0.95, 0.12, 0.32], [1.0, 0.72, 0.18], [0.72, 0.22, 0.95], [0.25, 0.75, 1.0]],
    tide:   [[0.1, 0.75, 1.0], [0.0, 0.95, 0.7], [0.35, 0.4, 1.0], [0.8, 0.95, 1.0], [0.0, 0.5, 0.9]],
    aurora: [[0.15, 1.0, 0.55], [0.7, 0.3, 1.0], [0.1, 0.8, 0.95], [1.0, 0.3, 0.7], [0.6, 1.0, 0.3]],
    neon:   [[1.0, 0.1, 0.6], [0.1, 1.0, 0.9], [1.0, 0.9, 0.1], [0.5, 0.2, 1.0], [0.2, 1.0, 0.2]],
    mono:   [[0.95, 0.92, 0.85], [0.7, 0.8, 1.0], [1.0, 0.85, 0.7], [0.85, 0.85, 0.95], [0.9, 0.95, 0.9]]
  };

  // hue rotation for the "Colour shift" knob. Paint colours: rotate the HSV hue (saturation and value kept). Plume: the shader gets the same
  // turn as a matrix about the grey axis (greys and the white core stay put). deg = 0 is the identity, so nothing changes until the knob moves.
  function hueShift(c, deg) {
    var r = c[0], g = c[1], b = c[2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!(d > 1e-6) || !(deg % 360)) return [r, g, b];
    var h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (((h * 60 + deg) % 360) + 360) % 360 / 60;
    var x = d * (1 - Math.abs(h % 2 - 1)), o = mn, i = Math.floor(h) % 6;
    return i === 0 ? [mx, x + o, o] : i === 1 ? [x + o, mx, o] : i === 2 ? [o, mx, x + o] : i === 3 ? [o, x + o, mx] : i === 4 ? [x + o, o, mx] : [mx, o, x + o];
  }
  var hueM = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), hueMAt = 0;
  function hueMatrix(deg) {   // column-major mat3 for gl.uniformMatrix3fv: rotation by deg about (1,1,1)
    deg = ((deg % 360) + 360) % 360;                                        // 360 = 0 = the identity, exactly
    if (deg === hueMAt) return hueM;
    var a = deg * Math.PI / 180, c = Math.cos(a), k = (1 - c) / 3, s = Math.sin(a) / Math.sqrt(3);
    hueM.set([c + k, k + s, k - s, k - s, c + k, k + s, k + s, k - s, c + k]);
    hueMAt = deg; return hueM;
  }

  // ------------------------------------------------------------------------------------------------- One Euro filter (Casiez et al. 2012)
  function OneEuro() { this.x = null; this.dx = 0; this.t = 0; }
  function alpha(cutoff, dt) { var tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  OneEuro.prototype.filter = function(x, t) {             // t in seconds
    if (this.x === null) { this.x = x; this.dx = 0; this.t = t; return x; }
    var dt = Math.max(1e-3, t - this.t); this.t = t;
    var dx = (x - this.x) / dt;
    this.dx += alpha(K.DCUTOFF, dt) * (dx - this.dx);
    var cutoff = K.MINCUTOFF + K.BETA * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (x - this.x);
    return this.x;
  };

  // ------------------------------------------------------------------------------------------------- hand finding (depth only)
  var DW = 512, DH = 424, S = 2, W = DW / S, H = DH / S, N = W * H;
  var dmap = new Float32Array(N), lab = new Int32Array(N), lab2 = new Int32Array(N), queue = new Int32Array(N), tipM = new Uint8Array(N);
  var lab3 = new Int32Array(N), owner = new Int32Array(N);
  var MAXC = 4096, cMin = new Float32Array(MAXC), cSum = new Float64Array(MAXC * 3), cCount = new Int32Array(MAXC);

  function bfs(k0, id, labels, inside) {                  // 4-connected flood fill from k0; returns pixel count, sums into cSum
    var head = 0, tail = 0, n = 0, su = 0, sv = 0, dm = 1e9;
    queue[tail++] = k0; labels[k0] = id;
    while (head < tail) {
      var k = queue[head++], x = k % W, y = (k - x) / W; n++; su += x; sv += y; if (dmap[k] < dm) dm = dmap[k];
      if (x > 0 && !labels[k - 1] && inside(k - 1)) { labels[k - 1] = id; queue[tail++] = k - 1; }
      if (x < W - 1 && !labels[k + 1] && inside(k + 1)) { labels[k + 1] = id; queue[tail++] = k + 1; }
      if (y > 0 && !labels[k - W] && inside(k - W)) { labels[k - W] = id; queue[tail++] = k - W; }
      if (y < H - 1 && !labels[k + W] && inside(k + W)) { labels[k + W] = id; queue[tail++] = k + W; }
    }
    cSum[id * 3] = su; cSum[id * 3 + 1] = sv; cCount[id] = n; cMin[id] = dm;
    return n;
  }

  // -> {stale, bodies: [{id, u, v, px}], hands: [{u, v, px, dmin, body}]}; u, v in full-resolution Kinect pixels
  function findHands(depth) {
    var data = depth.data, wall = depth.wall, valid = 0, band = 0, k, x, y, b0 = Math.round(K.BORDER_PX / S);
    for (y = 0, k = 0; y < H; y++) for (x = 0; x < W; x++, k++) {
      var i = y * S * DW + x * S, z = data[i], w = wall[i], d = (z > 0 && w > 0) ? w - z : NaN;
      if (x < b0 || y < b0 || x >= W - b0 || y >= H - b0) d = NaN;
      dmap[k] = d; lab[k] = 0; lab2[k] = 0;
      if (d === d) { valid++; if (d > K.NEAR_MM && d < K.BODY_ZONE_MM) band++; }
    }
    var out = {stale: false, bodies: [], hands: [], valid: valid, band: band};
    if (valid < N * 0.2) { out.stale = true; return out; }
    if (band > valid * K.MAX_BAND) { out.stale = true; return out; }
    var inBody = function(j) { var d = dmap[j]; return d > K.NEAR_MM && d < K.BODY_ZONE_MM; };
    var nb = 0, bodyIds = [];
    for (k = 0; k < N && nb < MAXC / 4 - 1; k++) {        // id ranges: bodies < MAXC/4 <= torsos < MAXC/2 <= hand patches
      if (lab[k] || !inBody(k)) continue;
      var id = ++nb, n = bfs(k, id, lab, inBody);
      if (n >= K.MIN_BODY_PX) bodyIds.push(id);
    }
    var tipOf = {};
    for (var b = 0; b < bodyIds.length; b++) {
      var bid = bodyIds[b];
      out.bodies.push({id: bid, u: cSum[bid * 3] / cCount[bid] * S, v: cSum[bid * 3 + 1] / cCount[bid] * S, px: cCount[bid], dmin: cMin[bid]});
      tipOf[bid] = Math.min(K.HAND_ZONE_MM, cMin[bid] + K.TIP_MM);
    }
    if (!bodyIds.length) return out;
    // people = torsos: the part of each body well back from the wall. When two people's arms cross they join into one body region, but
    // their torsos stay apart; every hand then belongs to the torso it reaches by the shortest path through the body (multi-source BFS).
    var torsoOf = {}, nt = 0, torsoIds = [], torsosIn = {};
    for (b = 0; b < bodyIds.length; b++) torsoOf[bodyIds[b]] = cMin[bodyIds[b]] + K.TORSO_REL_MM;
    var inTorso = function(j) { var bb = lab[j]; return bb > 0 && torsoOf[bb] !== undefined && dmap[j] >= torsoOf[bb]; };
    for (k = 0; k < N; k++) { lab3[k] = 0; owner[k] = 0; }
    var tbase = MAXC / 4;
    for (k = 0; k < N && nt < tbase - 1; k++) {
      if (lab3[k] || !inTorso(k)) continue;
      var tid = tbase + (++nt), tn = bfs(k, tid, lab3, inTorso);
      if (tn >= K.MIN_TORSO_PX) { torsoIds.push(tid); torsosIn[lab[k]] = (torsosIn[lab[k]] || 0) + 1; out.torsos = out.torsos || []; out.torsos.push({id: tid, u: cSum[tid * 3] / tn * S, v: cSum[tid * 3 + 1] / tn * S, px: tn, body: lab[k]}); }
    }
    // a body with no part that far back (standing with its hands down, or hovering close to the wall) is a person as a whole
    out.torsos = out.torsos || [];
    out.bodies.forEach(function(bo) { if (!torsosIn[bo.id]) out.torsos.push({id: bo.id, u: bo.u, v: bo.v, px: bo.px, body: bo.id}); });
    var head = 0, tail = 0;
    for (k = 0; k < N; k++) if (lab3[k] && torsoIds.indexOf(lab3[k]) >= 0) { owner[k] = lab3[k]; queue[tail++] = k; }
    while (head < tail) {
      var q0 = queue[head++], qx = q0 % W, own = owner[q0];
      if (qx > 0 && !owner[q0 - 1] && lab[q0 - 1] > 0) { owner[q0 - 1] = own; queue[tail++] = q0 - 1; }
      if (qx < W - 1 && !owner[q0 + 1] && lab[q0 + 1] > 0) { owner[q0 + 1] = own; queue[tail++] = q0 + 1; }
      if (q0 >= W && !owner[q0 - W] && lab[q0 - W] > 0) { owner[q0 - W] = own; queue[tail++] = q0 - W; }
      if (q0 < N - W && !owner[q0 + W] && lab[q0 + W] > 0) { owner[q0 + W] = own; queue[tail++] = q0 + W; }
    }
    var nh = 0, perBody = {};
    // the near-wall patch of each body, ERODED once: the Kinect reports in-between depths along every silhouette ("flying pixels"),
    // a 1-2 px fringe that is "near the wall" everywhere around a body; a real hand is many pixels wide and survives
    for (k = 0; k < N; k++) { var bk = lab[k]; tipM[k] = (bk > 0 && tipOf[bk] !== undefined && dmap[k] <= tipOf[bk]) ? 1 : 0; }
    for (y = 1; y < H - 1; y++) for (x = 1, k = y * W + 1; x < W - 1; x++, k++)
      if (tipM[k] === 1 && !(tipM[k - 1] && tipM[k + 1] && tipM[k - W] && tipM[k + W])) tipM[k] = 2;   // 2 = eroded away
    var inTip = function(j) { return tipM[j] === 1; };
    var base = MAXC / 2;                                    // tip patches use the upper half of the accumulator slots
    for (k = 0; k < N && nh < base - 1; k++) {
      if (lab2[k] || !inTip(k)) continue;
      var hid = base + (++nh), hb = lab[k], hn = bfs(k, hid, lab2, inTip);
      if (hn < K.MIN_HAND_PX) continue;
      var hu = cSum[hid * 3] / hn, hv = cSum[hid * 3 + 1] / hn, ho = owner[Math.round(hv) * W + Math.round(hu)] || owner[k] || 0;
      // shared = this body region holds more than one torso (people touching or arms crossed): which person owns the hand is a guess
      (perBody[ho || hb] = perBody[ho || hb] || []).push({u: hu * S, v: hv * S, px: hn, dmin: cMin[hid], body: hb, torso: ho, shared: (torsosIn[hb] || 0) > 1});
    }
    for (var key in perBody) {                             // at most two hands per person: the two biggest tip patches
      var list = perBody[key].sort(function(a, c) { return c.px - a.px; }).slice(0, 2);
      for (var q = 0; q < list.length; q++) out.hands.push(list[q]);
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------- the piece
  registerWallPlugin({
    id: 'liquid',
    title: 'Liquid Paint',
    author: 'Opus 5.5 (main session), fluid after Pavel Dobryakov (MIT)',
    create: function(canvas, kit) {
      var params = {alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false};
      var gl = canvas.getContext('webgl2', params), isWebGL2 = !!gl;
      if (!gl) gl = canvas.getContext('webgl', params);
      if (!gl) throw new Error('liquid: no WebGL');
      var halfFloat, linear;
      if (isWebGL2) { gl.getExtension('EXT_color_buffer_float'); linear = gl.getExtension('OES_texture_float_linear'); }
      else { halfFloat = gl.getExtension('OES_texture_half_float'); linear = gl.getExtension('OES_texture_half_float_linear'); }
      var texType = isWebGL2 ? gl.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES;
      if (!texType) throw new Error('liquid: no half-float textures');

      function supportRT(internalFormat, format) {
        var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, texType, null);
        var f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t);
        return ok;
      }
      function fmt(internalFormat, format) {
        if (supportRT(internalFormat, format)) return {internalFormat: internalFormat, format: format};
        if (isWebGL2 && internalFormat === gl.R16F) return fmt(gl.RG16F, gl.RG);
        if (isWebGL2 && internalFormat === gl.RG16F) return fmt(gl.RGBA16F, gl.RGBA);
        return null;
      }
      var rgba = isWebGL2 ? fmt(gl.RGBA16F, gl.RGBA) : fmt(gl.RGBA, gl.RGBA);
      var rg = isWebGL2 ? fmt(gl.RG16F, gl.RG) : rgba, r1 = isWebGL2 ? fmt(gl.R16F, gl.RED) : rgba;
      if (!rgba || !rg || !r1) throw new Error('liquid: cannot render to half-float textures');

      var shaders = [], programs = [];
      function compile(type, src, keywords) {
        var s = gl.createShader(type);
        gl.shaderSource(s, (keywords || []).map(function(k) { return '#define ' + k + '\n'; }).join('') + src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('liquid shader: ' + gl.getShaderInfoLog(s));
        shaders.push(s); return s;
      }
      function program(vs, fs) {
        var p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, 'aPosition'); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('liquid link: ' + gl.getProgramInfoLog(p));
        var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) { var name = gl.getActiveUniform(p, i).name; u[name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, name); }
        programs.push(p); return {p: p, u: u, bind: function() { gl.useProgram(p); }};
      }

      // Compile the original paint shaders unchanged: even a disabled uniform branch can
      // change GPU rounding. Select a separate program only for the opt-in plume mode.
      function paintOrPlume(paint, plume) {
        ['plume', 'uDye', 'buoyancy', 'plumeField', 'cooling', 'uHueM'].forEach(function(key) {
          if (!(key in paint.u)) paint.u[key] = null;
        });
        var selected = paint;
        return {get u() { return selected.u; }, bind: function() {
          selected = K.MODE === 'plume' ? plume : paint; selected.bind();
        }};
      }

      // ---- shaders (Pavel Dobryakov, MIT; see the header) ----
      var baseVS = compile(gl.VERTEX_SHADER, `
        precision highp float;
        attribute vec2 aPosition;
        varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
        uniform vec2 texelSize;
        void main () {
          vUv = aPosition * 0.5 + 0.5;
          vL = vUv - vec2(texelSize.x, 0.0); vR = vUv + vec2(texelSize.x, 0.0);
          vT = vUv + vec2(0.0, texelSize.y); vB = vUv - vec2(0.0, texelSize.y);
          gl_Position = vec4(aPosition, 0.0, 1.0);
        }`);
      var clearP = program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value;
        void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`));
      var splatP = program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision highp float; precision highp sampler2D;
        varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius;
        void main () {
          vec2 p = vUv - point.xy; p.x *= aspectRatio;
          vec3 splat = exp(-dot(p, p) / radius) * color;
          vec3 base = texture2D(uTarget, vUv).xyz;
          gl_FragColor = vec4(base + splat, 1.0);
        }`));
      var advectP = paintOrPlume(program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision highp float; precision highp sampler2D;
        varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform vec2 dyeTexelSize;
        uniform float dt; uniform float dissipation;
        vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
          vec2 st = uv / tsize - 0.5; vec2 iuv = floor(st); vec2 fuv = fract(st);
          vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize); vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
          vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize); vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
          return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
        }
        void main () {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coord);
        #endif
          float decay = 1.0 + dissipation * dt;
          gl_FragColor = result / decay;
        }`, linear ? null : ['MANUAL_FILTERING'])), program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision highp float; precision highp sampler2D;
        varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform vec2 dyeTexelSize;
        uniform float dt; uniform float dissipation; uniform float plumeField; uniform float cooling;
        vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
          vec2 st = uv / tsize - 0.5; vec2 iuv = floor(st); vec2 fuv = fract(st);
          vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize); vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
          vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize); vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
          return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
        }
        void main () {
        #ifdef MANUAL_FILTERING
          vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
          vec4 result = bilerp(uSource, coord, dyeTexelSize);
        #else
          vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
          vec4 result = texture2D(uSource, coord);
        #endif
          float decay = 1.0 + dissipation * dt;
          if (plumeField > 0.5) {
            // Open inflow brings clean air, never a clamped copy of edge smoke.
            if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0) result = vec4(0.0);
            result.r /= decay;
            result.g /= 1.0 + cooling * dt;
            result.rg *= exp(-dt * 5.0 * smoothstep(0.87, 1.0, vUv.y));
            gl_FragColor = vec4(result.rg, 0.0, 1.0);
          } else gl_FragColor = result / decay;
        }`, linear ? null : ['MANUAL_FILTERING'])));
      var divergenceP = paintOrPlume(program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
        uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x;
          float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y;
          vec2 C = texture2D(uVelocity, vUv).xy;
          if (vL.x < 0.0) { L = -C.x; } if (vR.x > 1.0) { R = -C.x; } if (vT.y > 1.0) { T = -C.y; } if (vB.y < 0.0) { B = -C.y; }
          float div = 0.5 * (R - L + T - B);
          gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }`)), program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
        uniform sampler2D uVelocity; uniform float plume;
        void main () {
          float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x;
          float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y;
          vec2 C = texture2D(uVelocity, vUv).xy;
          if (plume < 0.5) {
            if (vL.x < 0.0) { L = -C.x; } if (vR.x > 1.0) { R = -C.x; } if (vT.y > 1.0) { T = -C.y; } if (vB.y < 0.0) { B = -C.y; }
          } // Plume: all edges open, like fire.js; air can enter below and leave above.
          float div = 0.5 * (R - L + T - B);
          gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
        }`)));
      var curlP = program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
        uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uVelocity, vL).y; float R = texture2D(uVelocity, vR).y;
          float T = texture2D(uVelocity, vT).x; float B = texture2D(uVelocity, vB).x;
          float vorticity = R - L - T + B;
          gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
        }`));
      var vorticityP = paintOrPlume(program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision highp float; precision highp sampler2D;
        varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
        uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;
        void main () {
          float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x; float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x;
          float C = texture2D(uCurl, vUv).x;
          vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
          force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity += force * dt;
          velocity = min(max(velocity, -1000.0), 1000.0);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }`)), program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision highp float; precision highp sampler2D;
        varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
        uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform sampler2D uDye;
        uniform float curl; uniform float dt; uniform float plume; uniform vec2 buoyancy;
        void main () {
          float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x; float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x;
          float C = texture2D(uCurl, vUv).x;
          vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
          force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          if (plume > 0.5) {
            vec2 gas = texture2D(uDye, vUv).rg; // R = smoke, G = heat (only in plume mode)
            force.y += buoyancy.x * gas.g + buoyancy.y * gas.r;
          }
          velocity += force * dt;
          velocity = min(max(velocity, -1000.0), 1000.0);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }`)));
      var pressureP = paintOrPlume(program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
        uniform sampler2D uPressure; uniform sampler2D uDivergence;
        void main () {
          float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;
          float divergence = texture2D(uDivergence, vUv).x;
          float pressure = (L + R + B + T - divergence) * 0.25;
          gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
        }`)), program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
        uniform sampler2D uPressure; uniform sampler2D uDivergence; uniform float plume;
        void main () {
          float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;
          if (plume > 0.5) { // Zero pressure outside every open edge.
            if (vL.x < 0.0) L = 0.0; if (vR.x > 1.0) R = 0.0;
            if (vT.y > 1.0) T = 0.0; if (vB.y < 0.0) B = 0.0;
          }
          float divergence = texture2D(uDivergence, vUv).x;
          float pressure = (L + R + B + T - divergence) * 0.25;
          gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
        }`)));
      var gradientP = paintOrPlume(program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
        uniform sampler2D uPressure; uniform sampler2D uVelocity;
        void main () {
          float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity.xy -= vec2(R - L, T - B);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }`)), program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying highp vec2 vUv; varying highp vec2 vL; varying highp vec2 vR; varying highp vec2 vT; varying highp vec2 vB;
        uniform sampler2D uPressure; uniform sampler2D uVelocity; uniform float plume;
        void main () {
          float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;
          float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;
          if (plume > 0.5) { // Zero pressure outside every open edge.
            if (vL.x < 0.0) L = 0.0; if (vR.x > 1.0) R = 0.0;
            if (vT.y > 1.0) T = 0.0; if (vB.y < 0.0) B = 0.0;
          }
          vec2 velocity = texture2D(uVelocity, vUv).xy;
          velocity.xy -= vec2(R - L, T - B);
          gl_FragColor = vec4(velocity, 0.0, 1.0);
        }`)));
      // Shared colour mapping keeps smoke and its glow in the same blue/white palette.
      var plumeRamp = `
        uniform mat3 uHueM; // "Colour shift" (liquid_hue): a turn about the grey axis; the identity until the knob moves
        vec3 plumeColor(vec2 gas) {
          float smoke = max(gas.r, 0.0), heat = max(gas.g, 0.0);
          vec3 blue = vec3(0.018, 0.045, 0.42) * (1.0 - exp(-smoke * 2.0));
          blue += vec3(0.04, 0.16, 0.8) * min(smoke * 0.28, 0.65);
          vec3 core = mix(vec3(0.03, 0.18, 1.5), vec3(2.0), smoothstep(0.25, 1.0, heat)) * heat;
          return max(uHueM * (vec3(1.0) - exp(-(blue + core))), vec3(0.0));
        }`;
      var plumeSplatP = program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision highp float; precision highp sampler2D;
        varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio;
        uniform vec2 point; uniform float radius; uniform vec3 amount; uniform float gas;
        void main() {
          vec2 p = vUv - point; p.x *= aspectRatio;
          float d = exp(-dot(p, p) / radius);
          vec3 add = amount * d;
          if (gas > 0.5) add.g *= d * d; // Hot core is smaller than the smoke source.
          vec3 value = texture2D(uTarget, vUv).xyz + add;
          if (gas > 0.5) value = min(value, vec3(6.0));
          gl_FragColor = vec4(value, 1.0);
        }`));
      var plumeDisplayP = program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision highp float; precision highp sampler2D;
        varying vec2 vUv; uniform sampler2D uTexture; uniform sampler2D uBloom;
        uniform vec4 sources[8]; uniform float aspect;
        ` + plumeRamp + `
        void main() {
          vec3 c = plumeColor(texture2D(uTexture, vUv).rg);
          c += texture2D(uBloom, vUv).rgb;
          for (int i = 0; i < 8; i++) {
            vec4 s = sources[i];
            if (s.w > 0.0) {
              vec2 d = vUv - s.xy; d.x *= aspect;
              float r = dot(d, d) / (s.z * s.z);
              c += s.w * (vec3(1.35) * exp(-r * 1.0) + (uHueM * vec3(0.025, 0.08, 0.65)) * exp(-r * 0.65));
            }
          }
          gl_FragColor = vec4(c, 1.0);
        }`));
      var bloomPreP = paintOrPlume(program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying vec2 vUv; uniform sampler2D uTexture; uniform vec3 curve; uniform float threshold;
        void main () {
          vec3 c = texture2D(uTexture, vUv).rgb;
          float br = max(c.r, max(c.g, c.b));
          float rq = clamp(br - curve.x, 0.0, curve.y); rq = curve.z * rq * rq;
          c *= max(rq, br - threshold) / max(br, 0.0001);
          gl_FragColor = vec4(c, 0.0);
        }`)), program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying vec2 vUv; uniform sampler2D uTexture; uniform vec3 curve; uniform float threshold; uniform float plume;
        ` + plumeRamp + `
        void main () {
          vec3 c = texture2D(uTexture, vUv).rgb;
          if (plume > 0.5) c = plumeColor(c.rg);
          float br = max(c.r, max(c.g, c.b));
          float rq = clamp(br - curve.x, 0.0, curve.y); rq = curve.z * rq * rq;
          c *= max(rq, br - threshold) / max(br, 0.0001);
          gl_FragColor = vec4(c, 0.0);
        }`)));
      var bloomBlurP = program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uTexture;
        void main () {
          vec4 sum = texture2D(uTexture, vL) + texture2D(uTexture, vR) + texture2D(uTexture, vT) + texture2D(uTexture, vB);
          gl_FragColor = sum * 0.25;
        }`));
      var bloomFinalP = program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision mediump float; precision mediump sampler2D;
        varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB; uniform sampler2D uTexture; uniform float intensity;
        void main () {
          vec4 sum = texture2D(uTexture, vL) + texture2D(uTexture, vR) + texture2D(uTexture, vT) + texture2D(uTexture, vB);
          gl_FragColor = sum * 0.25 * intensity;
        }`));
      // display: Pavel's shading + bloom on black, a procedural dither, and the hand halos (ours)
      var displayP = program(baseVS, compile(gl.FRAGMENT_SHADER, `
        precision highp float; precision highp sampler2D;
        varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
        uniform sampler2D uTexture; uniform sampler2D uBloom; uniform vec2 texelSize; uniform float bloomOn;
        uniform float aspect; uniform vec4 hands[8]; uniform vec3 handCol[8];
        vec3 linearToGamma (vec3 color) { color = max(color, vec3(0)); return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0)); }
        float hash (vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main () {
          vec3 c = texture2D(uTexture, vUv).rgb;
          vec3 lc = texture2D(uTexture, vL).rgb; vec3 rc = texture2D(uTexture, vR).rgb;
          vec3 tc = texture2D(uTexture, vT).rgb; vec3 bc = texture2D(uTexture, vB).rgb;
          float dx = length(rc) - length(lc); float dy = length(tc) - length(bc);
          vec3 n = normalize(vec3(dx, dy, length(texelSize)));
          float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
          c *= diffuse;
          if (bloomOn > 0.5) {
            vec3 bloom = texture2D(uBloom, vUv).rgb;
            bloom += (hash(gl_FragCoord.xy) * 2.0 - 1.0) / 255.0;
            c += linearToGamma(bloom);
          }
          for (int i = 0; i < 8; i++) {
            vec4 h = hands[i];
            if (h.w > 0.0) {
              vec2 d = vUv - h.xy; d.x *= aspect;
              float r = length(d);
              c += handCol[i] * h.w * (0.55 * exp(-pow((r - h.z) / (0.18 * h.z), 2.0)) + 0.25 * exp(-r * r / (h.z * h.z)));
            }
          }
          gl_FragColor = vec4(c, 1.0);
        }`));

      // ---- geometry: one full-screen quad on attribute 0 (Pavel's blit) ----
      var vbuf = gl.createBuffer(), ibuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);
      function blit(target) {
        if (!target) { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
        else { gl.viewport(0, 0, target.width, target.height); gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
      }

      // ---- framebuffers (Pavel) ----
      var fbos = [];
      function createFBO(w, h, f, param) {
        gl.activeTexture(gl.TEXTURE0);
        var texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, f.internalFormat, w, h, 0, f.format, texType, null);
        var fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        var o = {texture: texture, fbo: fbo, width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
                 attach: function(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; }};
        fbos.push(o); return o;
      }
      function createDoubleFBO(w, h, f, param) {
        var a = createFBO(w, h, f, param), b = createFBO(w, h, f, param);
        return {width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h, get read() { return a; }, get write() { return b; },
                swap: function() { var t = a; a = b; b = t; }};
      }
      function getResolution(res) {
        var ar = gl.drawingBufferWidth / gl.drawingBufferHeight; if (ar < 1) ar = 1 / ar;
        var mn = Math.round(res), mx = Math.round(res * ar);
        return gl.drawingBufferWidth > gl.drawingBufferHeight ? {width: mx, height: mn} : {width: mn, height: mx};
      }
      var dye, velocity, divergence, curl, pressure, bloom, bloomFBOs = [];
      function freeFBOs() { fbos.forEach(function(o) { gl.deleteTexture(o.texture); gl.deleteFramebuffer(o.fbo); }); fbos = []; bloomFBOs = []; }
      function initFramebuffers() {
        freeFBOs();
        var sim = getResolution(128), dyeRes = getResolution(1024), filt = linear ? gl.LINEAR : gl.NEAREST;
        dye = createDoubleFBO(dyeRes.width, dyeRes.height, rgba, filt);
        velocity = createDoubleFBO(sim.width, sim.height, rg, filt);
        divergence = createFBO(sim.width, sim.height, r1, gl.NEAREST);
        curl = createFBO(sim.width, sim.height, r1, gl.NEAREST);
        pressure = createDoubleFBO(sim.width, sim.height, r1, gl.NEAREST);
        var br = getResolution(256);
        bloom = createFBO(br.width, br.height, rgba, filt);
        for (var i = 0; i < 8; i++) { var w = br.width >> (i + 1), h = br.height >> (i + 1); if (w < 2 || h < 2) break; bloomFBOs.push(createFBO(w, h, rgba, filt)); }
      }
      initFramebuffers();

      function splat(x, y, dx, dy, color) {           // x, y: Pavel texcoords (y up)
        splatP.bind();
        gl.uniform1i(splatP.u.uTarget, velocity.read.attach(0));
        gl.uniform1f(splatP.u.aspectRatio, canvas.width / canvas.height);
        gl.uniform2f(splatP.u.point, x, y);
        gl.uniform3f(splatP.u.color, dx, dy, 0.0);
        var ar = canvas.width / canvas.height, radius = K.BRUSH / 100 * (ar > 1 ? ar : 1);
        gl.uniform1f(splatP.u.radius, radius);
        blit(velocity.write); velocity.swap();
        gl.uniform1i(splatP.u.uTarget, dye.read.attach(0));
        gl.uniform3f(splatP.u.color, color[0], color[1], color[2]);
        blit(dye.write); dye.swap();
      }

      var roomForceFrames = 0;
      function roomForce(dt) {
        var r = kit.room ? kit.room(dt) : null;
        if (!r || !r.enabled || isPlume() || r.motion < .001) return;
        roomForceFrames++;
        splatP.bind();
        gl.uniform1f(splatP.u.aspectRatio, canvas.width / canvas.height);
        gl.uniform1f(splatP.u.radius, .12);
        for (var ri = 0; ri < 3; ri++) {
          gl.uniform2f(splatP.u.point, .2 + ri*.3 + r.x*.08, .5);
          gl.uniform3f(splatP.u.color, r.motion*(r.x*25 + Math.sin(ri*2.1)*12)*dt*30,
                       r.motion*Math.cos(ri*2.1)*12*dt*30, 0);
          gl.uniform1i(splatP.u.uTarget, velocity.read.attach(0));
          blit(velocity.write); velocity.swap();
        }
      }
      function musicForce(dt) {   // music: bass sways the existing paint sideways, each beat bursts outward from a drifting point (velocity only, no dye)
        var m = kit.music ? kit.music() : null, e = m && m.enabled && m.fresh ? m.amount : 0, bass = e ? e * m.bands[0] : 0, mid = e ? e * m.bands[1] : 0, high = e ? e * m.bands[2] : 0, beat = e ? e * m.pulse : 0;
        if (!e || isPlume() || (bass < .003 && beat < .003)) return;
        var k = dt * 30, t = performance.now() / 1000, ar = canvas.width / canvas.height;
        splatP.bind();
        gl.uniform1f(splatP.u.aspectRatio, ar);
        gl.uniform1f(splatP.u.radius, .12);
        for (var i = 0; i < 4; i++) {   // four points, alternating direction, so the sway has no net drift
          gl.uniform2f(splatP.u.point, .125 + i * .25, .5 + .12 * Math.sin(t * .4 + i * 2));
          gl.uniform3f(splatP.u.color, (i % 2 ? -1 : 1) * Math.sin(t * 2.2) * bass * MUS_SWAY * k, 0, 0);
          gl.uniform1i(splatP.u.uTarget, velocity.read.attach(0));
          blit(velocity.write); velocity.swap();
        }
        if (beat > .003) {
          var cx = .5 + .3 * Math.sin(t * .17), cy = .5 + .2 * Math.sin(t * .11 + 1);
          for (var j = 0; j < 6; j++) {
            var a = j * Math.PI / 3 + t;
            gl.uniform2f(splatP.u.point, cx + Math.cos(a) * .05 / ar * 1.0, cy + Math.sin(a) * .05);
            gl.uniform3f(splatP.u.color, Math.cos(a) * beat * MUS_BURST * k, Math.sin(a) * beat * MUS_BURST * k, 0);
            gl.uniform1i(splatP.u.uTarget, velocity.read.attach(0));
            blit(velocity.write); velocity.swap();
          }
        }
      }
      var MUS_SWAY = 18, MUS_BURST = 45;
      var lastMode = K.MODE || 'paint', plumeEmitters = [];
      function isPlume() { return K.MODE === 'plume'; }
      function syncMode() {
        var mode = K.MODE || 'paint';
        if (mode === lastMode) return;
        lastMode = mode;
        // RGB paint and smoke/heat have different meanings: clear on either transition.
        gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 1);
        fbos.forEach(function(f) { gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo); gl.clear(gl.COLOR_BUFFER_BIT); });
        fingers = []; lastFg = null; touchTips = {}; plumeEmitters = [];
        hands.forEach(function(h) { h.cx = null; });
      }
      function plumeDab(x, y, vx, vy, strength, dt) {
        var scale = Math.min(dt, 1 / 30) * 60 * strength, ar = canvas.width / canvas.height;
        plumeSplatP.bind();
        gl.uniform1f(plumeSplatP.u.aspectRatio, ar);
        gl.uniform2f(plumeSplatP.u.point, x, 1 - y);
        gl.uniform1f(plumeSplatP.u.radius, K.BRUSH / 100 * (ar > 1 ? ar : 1) * 0.6);
        gl.uniform1f(plumeSplatP.u.gas, 0);
        gl.uniform3f(plumeSplatP.u.amount, Math.max(-2, Math.min(2, vx)) * scale,
                     (P.JET - Math.max(-2, Math.min(2, vy))) * scale, 0);
        gl.uniform1i(plumeSplatP.u.uTarget, velocity.read.attach(0)); blit(velocity.write); velocity.swap();
        gl.uniform1f(plumeSplatP.u.gas, 1);
        gl.uniform3f(plumeSplatP.u.amount, P.INK * scale, P.HEAT * scale, 0);
        gl.uniform1i(plumeSplatP.u.uTarget, dye.read.attach(0)); blit(dye.write); dye.swap();
        stats.emitted++;
      }

      function step(dt) {
        gl.disable(gl.BLEND);
        curlP.bind(); gl.uniform2f(curlP.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(curlP.u.uVelocity, velocity.read.attach(0)); blit(curl);
        vorticityP.bind(); gl.uniform2f(vorticityP.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(vorticityP.u.uVelocity, velocity.read.attach(0)); gl.uniform1i(vorticityP.u.uCurl, curl.attach(1));
        gl.uniform1i(vorticityP.u.uDye, dye.read.attach(2)); gl.uniform1f(vorticityP.u.plume, isPlume() ? 1 : 0);
        gl.uniform2f(vorticityP.u.buoyancy, P.BUOYANCY, P.SMOKE_LIFT);
        gl.uniform1f(vorticityP.u.curl, isPlume() ? K.TURBULENCE * 0.5 : K.TURBULENCE); gl.uniform1f(vorticityP.u.dt, dt); blit(velocity.write); velocity.swap();
        divergenceP.bind(); gl.uniform2f(divergenceP.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1f(divergenceP.u.plume, isPlume() ? 1 : 0);
        gl.uniform1i(divergenceP.u.uVelocity, velocity.read.attach(0)); blit(divergence);
        clearP.bind(); gl.uniform1i(clearP.u.uTexture, pressure.read.attach(0)); gl.uniform1f(clearP.u.value, 0.8); blit(pressure.write); pressure.swap();
        pressureP.bind(); gl.uniform2f(pressureP.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1f(pressureP.u.plume, isPlume() ? 1 : 0);
        gl.uniform1i(pressureP.u.uDivergence, divergence.attach(0));
        for (var i = 0; i < 20; i++) { gl.uniform1i(pressureP.u.uPressure, pressure.read.attach(1)); blit(pressure.write); pressure.swap(); }
        gradientP.bind(); gl.uniform2f(gradientP.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1f(gradientP.u.plume, isPlume() ? 1 : 0);
        gl.uniform1i(gradientP.u.uPressure, pressure.read.attach(0)); gl.uniform1i(gradientP.u.uVelocity, velocity.read.attach(1));
        blit(velocity.write); velocity.swap();
        advectP.bind(); gl.uniform2f(advectP.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        if (!linear) gl.uniform2f(advectP.u.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
        var vid = velocity.read.attach(0);
        gl.uniform1i(advectP.u.uVelocity, vid); gl.uniform1i(advectP.u.uSource, vid);
        gl.uniform1f(advectP.u.plumeField, 0);
        gl.uniform1f(advectP.u.dt, dt); gl.uniform1f(advectP.u.dissipation, isPlume() ? P.VELOCITY_FADE : K.VELOCITY_FADE);
        blit(velocity.write); velocity.swap();
        if (!linear) gl.uniform2f(advectP.u.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
        gl.uniform1i(advectP.u.uVelocity, velocity.read.attach(0)); gl.uniform1i(advectP.u.uSource, dye.read.attach(1));
        gl.uniform1f(advectP.u.plumeField, isPlume() ? 1 : 0); gl.uniform1f(advectP.u.cooling, P.COOL);
        gl.uniform1f(advectP.u.dissipation, isPlume() ? P.FADE * 3 / Math.max(0.2, K.FADE_S) : 1 / Math.max(0.2, K.FADE_S));
        blit(dye.write); dye.swap();
      }

      function applyBloom() {
        if (bloomFBOs.length < 2) return;
        var last = bloom, knee = K.BLOOM_THRESHOLD * 0.7 + 0.0001;
        gl.disable(gl.BLEND);
        bloomPreP.bind(); gl.uniform1f(bloomPreP.u.plume, isPlume() ? 1 : 0);
        if (isPlume()) gl.uniformMatrix3fv(bloomPreP.u.uHueM, false, hueMatrix(+K.HUE || 0));
        gl.uniform3f(bloomPreP.u.curve, K.BLOOM_THRESHOLD - knee, knee * 2, 0.25 / knee);
        gl.uniform1f(bloomPreP.u.threshold, K.BLOOM_THRESHOLD);
        gl.uniform1i(bloomPreP.u.uTexture, dye.read.attach(0)); blit(last);
        bloomBlurP.bind();
        for (var i = 0; i < bloomFBOs.length; i++) {
          gl.uniform2f(bloomBlurP.u.texelSize, last.texelSizeX, last.texelSizeY); gl.uniform1i(bloomBlurP.u.uTexture, last.attach(0));
          blit(bloomFBOs[i]); last = bloomFBOs[i];
        }
        gl.blendFunc(gl.ONE, gl.ONE); gl.enable(gl.BLEND);
        for (var j = bloomFBOs.length - 2; j >= 0; j--) {
          gl.uniform2f(bloomBlurP.u.texelSize, last.texelSizeX, last.texelSizeY); gl.uniform1i(bloomBlurP.u.uTexture, last.attach(0));
          blit(bloomFBOs[j]); last = bloomFBOs[j];
        }
        gl.disable(gl.BLEND);
        bloomFinalP.bind();
        gl.uniform2f(bloomFinalP.u.texelSize, last.texelSizeX, last.texelSizeY); gl.uniform1i(bloomFinalP.u.uTexture, last.attach(0));
        gl.uniform1f(bloomFinalP.u.intensity, isPlume() ? P.BLOOM : K.BLOOM); blit(bloom);
      }

      var handBuf = new Float32Array(32), colBuf = new Float32Array(24);
      function render(halos) {
        var bloomOn = isPlume() || K.BLOOM > 0;
        if (bloomOn) applyBloom();
        gl.disable(gl.BLEND);
        if (isPlume()) {
          plumeDisplayP.bind();
          gl.uniformMatrix3fv(plumeDisplayP.u.uHueM, false, hueMatrix(+K.HUE || 0));
          gl.uniform1i(plumeDisplayP.u.uTexture, dye.read.attach(0));
          gl.uniform1i(plumeDisplayP.u.uBloom, bloom.attach(1));
          handBuf.fill(0);
          for (var j = 0; j < plumeEmitters.length && j < 8; j++) {
            var source = plumeEmitters[j];
            handBuf.set([source.x, 1 - source.y, Math.sqrt(K.BRUSH / 100), source.strength], j * 4);
          }
          gl.uniform4fv(plumeDisplayP.u.sources, handBuf);
          gl.uniform1f(plumeDisplayP.u.aspect, canvas.width / canvas.height);
          blit(null); return;
        }
        displayP.bind();
        gl.uniform2f(displayP.u.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
        gl.uniform1i(displayP.u.uTexture, dye.read.attach(0));
        gl.uniform1i(displayP.u.uBloom, bloom.attach(1));
        gl.uniform1f(displayP.u.bloomOn, bloomOn ? 1 : 0);
        gl.uniform1f(displayP.u.aspect, canvas.width / canvas.height);
        handBuf.fill(0); colBuf.fill(0);
        for (var i = 0; i < halos.length && i < 8; i++) {
          var h = halos[i]; handBuf.set([h.x, 1 - h.y, 0.035, h.a * K.HALO], i * 4); colBuf.set(h.col, i * 3);
        }
        gl.uniform4fv(displayP.u.hands, handBuf); gl.uniform3fv(displayP.u.handCol, colBuf);
        blit(null);
      }

      // ---- tracking ----
      var people = [], hands = [], lostPeople = [], lostHands = [], nextPerson = 1, nextHand = 1, colourNext = 0, lastSeq = -1;
      var touchTips = {}, lastFrameSeen = 0, stats = {frames: 0, emitted: 0, lastHands: 0, stale: 0};
      kit.wantDepth(true);

      function toScreen(u, v) {
        var s = kit.toScreen(u, v);
        if (s && isFinite(s[0]) && isFinite(s[1])) return s;
        return [1 - u / DW, v / DH];                          // no registration yet: the Kinect faces the wall, so the image is mirrored
      }
      var shifted = {key: '', pal: null};
      function palette() {
        var base = PALETTES[K.PALETTE] || PALETTES.ember, deg = +K.HUE || 0;
        if (!deg) return base;                                   // 0 = the palette exactly as designed
        var key = K.PALETTE + ':' + deg;
        if (shifted.key !== key) shifted = {key: key, pal: base.map(function(c) { return hueShift(c, deg); })};
        return shifted.pal;
      }
      // where a track should be now: its last position carried on at its recent velocity (lost tracks too, for up to REACQUIRE_S),
      // so two hands that pass through each other keep their own ids instead of swapping
      function predict(t, nowS) {
        var dt = Math.min(0.25, Math.max(0, nowS - (t.lastT || nowS)));   // a hand that vanishes has usually stopped: carry it on 0.25 s at most
        return [t.u + (t.vu || 0) * dt, t.v + (t.vv || 0) * dt];
      }
      function matchOrNew(list, lost, items, gate, make) {    // greedy nearest matching to predicted positions, in Kinect pixels
        var used = {}, res = new Array(items.length), pairs = [], nowS0 = performance.now() / 1000;
        for (var i = 0; i < items.length; i++) for (var j = 0; j < list.length; j++) {
          var pr = predict(list[j], nowS0), d = Math.hypot(items[i].u - pr[0], items[i].v - pr[1]);
          if (d < gate) pairs.push([d, i, j]);
        }
        pairs.sort(function(a, b) { return a[0] - b[0]; });
        var takenT = {};
        for (var p = 0; p < pairs.length; p++) { var pi = pairs[p][1], pj = pairs[p][2]; if (used[pi] || takenT[pj]) continue; used[pi] = 1; takenT[pj] = 1; res[pi] = list[pj]; }
        var now = performance.now() / 1000;
        for (i = 0; i < items.length; i++) {
          if (res[i]) continue;
          var best = -1, bd = gate * 2;                          // a recently lost track nearby comes back with its id and colour
          for (j = 0; j < lost.length; j++) { var pl = predict(lost[j], now), dd = Math.hypot(items[i].u - pl[0], items[i].v - pl[1]); if (now - lost[j].lostAt < K.REACQUIRE_S && dd < bd) { bd = dd; best = j; } }
          res[i] = best >= 0 ? lost.splice(best, 1)[0] : make(items[i]);
          if (best >= 0) res[i].reacquired = (res[i].reacquired || 0) + 1;
        }
        return res;
      }

      function onDepth(depth) {
        var nowS = performance.now() / 1000, found = findHands(depth);
        stats.frames++; stats.lastHands = found.hands.length; if (found.stale) stats.stale++;
        // people
        var pItems = (found.torsos && found.torsos.length) ? found.torsos : found.bodies;
        var pTracks = matchOrNew(people, lostPeople, pItems, K.GATE_PX * 2, function(b) {
          return {id: nextPerson++, colour: colourNext++ % palette().length};
        });
        var alive = [];
        pItems.forEach(function(b, i) { var t = pTracks[i]; t.u = b.u; t.v = b.v; t.seq = depth.seq; alive.push(t); b.track = t; });
        people.forEach(function(t) { if (alive.indexOf(t) < 0) { t.lostAt = nowS; lostPeople.push(t); } });
        people = alive;
        lostPeople = lostPeople.filter(function(t) { return nowS - t.lostAt < K.REACQUIRE_S; });
        var personOf = {}; pItems.forEach(function(b) { personOf[b.id] = b.track; });
        // hands
        var hTracks = matchOrNew(hands, lostHands, found.hands, K.GATE_PX, function(h) {
          return {id: nextHand++, fx: new OneEuro(), fy: new OneEuro(), seen: 0, cx: null, cy: null};
        });
        var aliveH = [];
        found.hands.forEach(function(h, i) {
          var t = hTracks[i], s = toScreen(h.u, h.v);
          if (t.lastT !== undefined && t.seq !== undefined) {                 // Kinect-space velocity for the prediction (smoothed)
            var dtv = Math.max(1e-3, nowS - t.lastT); t.vu = 0.5 * (t.vu || 0) + 0.5 * (h.u - t.u) / dtv; t.vv = 0.5 * (t.vv || 0) + 0.5 * (h.v - t.v) / dtv;
          }
          t.lastT = nowS;
          t.u = h.u; t.v = h.v; t.dmin = h.dmin; t.seq = depth.seq; t.seen++;
          // a hand takes its person's colour. While its body region is shared with someone else (arms crossed, people touching) the owner
          // is a guess, so the hand keeps the colour it had; once it is on its own body again for CONFIRM frames it follows its person.
          var who = personOf[h.torso] || personOf[h.body] || null; t.shared = h.shared;
          if (!h.shared && who) { t.alone = (t.alone || 0) + 1; if (t.alone >= K.CONFIRM || !t.person) t.person = who; }
          else { t.alone = 0; if (!t.person) t.person = who; }
          if (t.seen >= K.CONFIRM && t.person && (t.colour === undefined || t.alone >= K.CONFIRM)) t.colour = t.person.colour;
          else if (t.colour === undefined && t.seen >= K.CONFIRM) t.colour = colourNext++ % palette().length;
          t.rawX = s[0]; t.rawY = s[1];
          t.x = t.fx.filter(s[0], nowS); t.y = t.fy.filter(s[1], nowS);
          (t.hist = t.hist || []).push({t: nowS, x: t.x, y: t.y});            // recent path, for the stillness test
          while (t.hist.length > 2 && nowS - t.hist[1].t > K.MOTION_WINDOW_S) t.hist.shift();
          var h0 = t.hist[0], span = Math.max(1e-3, nowS - h0.t);
          t.travel = span >= K.MOTION_WINDOW_S * 0.5 ? Math.hypot((t.x - h0.x) * canvas.width / canvas.height, t.y - h0.y) / (canvas.width / canvas.height) / span : 0;
          aliveH.push(t);
        });
        hands.forEach(function(t) { if (aliveH.indexOf(t) < 0) { t.lostAt = nowS; t.cx = null; lostHands.push(t); } });
        hands = aliveH;
        lostHands = lostHands.filter(function(t) { return nowS - t.lostAt < K.REACQUIRE_S; });
      }

      // The touch bridge's fingertips (kit.touches: screen 0..1, Date.now() ms) say where a finger pressed on the wall really is. Our own
      // finder only sees the part of a hand at least NEAR_MM off the wall, so a pressed hand reads 10-20 cm back toward the body (measured
      // 10-02: median 107 px). Each new fingertip report near a hand sets that hand's offset (fingertip minus where the hand was when the
      // report came); the brush follows hand + offset, and the offset eases back to zero once the finger has left the wall.
      function followTips(dt) {
        var wall = Date.now(), perfAt = function(ms) { return (performance.now() - (wall - ms)) / 1000; }, tips = kit.touches || [];
        var fg = kit.fingers;                      // the bridge's every-frame fingertip stream, when it has one (thinned touches otherwise)
        if (fg && wall - fg.t < 1000) tips = fg.pts.map(function(p) { return {x: p[0], y: p[1], t: fg.t}; });
        for (var j = 0; j < tips.length; j++) {
          var tc = tips[j]; if (wall - tc.t > K.TIP_FRESH_MS) continue;
          var best = null, bd = K.SNAP;
          for (var i = 0; i < hands.length; i++) {
            var h = hands[i]; if (h.seq !== lastSeq || h.x == null) continue;
            var d = Math.hypot(tc.x - h.x, (tc.y - h.y) * 0.625);          // in screen widths (the wall is 1280 x 800)
            if (d < bd) { bd = d; best = h; }
          }
          if (!best || best.tipT === tc.t) continue;                        // nothing near, or this report was used already
          var at = perfAt(tc.t), hx = best.x, hy = best.y, hist = best.hist || [], dd = 1e9;
          for (var q = 0; q < hist.length; q++) if (Math.abs(hist[q].t - at) < dd) { dd = Math.abs(hist[q].t - at); hx = hist[q].x; hy = hist[q].y; }
          var tx = tc.x - hx, ty = tc.y - hy, fresh = best.tipSeen === undefined || wall - best.tipSeen > K.TIP_HOLD_MS;
          // a report is a moment old; while the hand moves fast that lag would drag the brush back along the stroke, so the offset
          // (hand-to-fingertip, a matter of hand shape) is learned only while the hand is nearly still; a fast hand keeps the one it has
          var slow = Math.hypot(best.fx.dx || 0, best.fy.dx || 0) < K.TIP_LEARN_SPEED;
          if (fresh) { best.ox = tx; best.oy = ty; }
          else if (slow) { best.ox += (tx - best.ox) * 0.5; best.oy += (ty - best.oy) * 0.5; }
          best.tipT = tc.t; best.tipSeen = wall;
        }
        var ease = Math.exp(-dt / 0.3);
        for (var n = 0; n < hands.length; n++) {
          var g = hands[n];
          if (g.tipSeen !== undefined && wall - g.tipSeen > K.TIP_HOLD_MS) { g.ox = (g.ox || 0) * ease; g.oy = (g.oy || 0) * ease; }
        }
      }
      // ---- fingertip brushes (when the bridge sends its every-frame 'fingers' stream; the hand + offset path above is the fallback) ----
      // Every reported fingertip is its own brush: matched one to one within movement gates, retaining as many brushes as possible.
      // Positions use One Euro smoothing; colour follows the nearest depth hand or person.
      // Matching cannot establish physical identity through ambiguous crossings or correct false detections upstream.
      var fingers = [], nextFinger = 1, lastFg = null, lastReportMs = 0;
      function onFingers(pts) {
        var nowMs = performance.now(), nowS = nowMs / 1000, pairs = [], usedP = {}, usedF = {}, i, j;
        lastReportMs = nowMs;
        for (i = 0; i < pts.length; i++) for (j = 0; j < fingers.length; j++) {
          var d = Math.hypot(pts[i][0] - fingers[j].rx, (pts[i][1] - fingers[j].ry) * 0.625);
          if (d < K.FINGER_GATE + K.FINGER_REACH * (nowMs - fingers[j].lastMs) / 1000) pairs.push([d, i, j]);
        }
        pairs.sort(function(a, b) { return a[0] - b[0]; });
        var match = {}, owner = {};
        for (var p = 0; p < pairs.length; p++) { var pi = pairs[p][1], pj = pairs[p][2]; if (usedP[pi] || usedF[pj]) continue; usedP[pi] = usedF[pj] = 1; match[pi] = fingers[pj]; owner[pj] = pi; }
        // usedP/usedF are greedy-only; after augmentation use match/owner for final assignments.
        // A nearest pair can strand another point even when both old brushes fit.
        // Keep the greedy result unless an unmatched point can reach a free brush
        // through reassignment, using only the same movement-gated pairs above.
        function extendMatch(point, visited) {
          for (var q = 0; q < pairs.length; q++) {
            if (pairs[q][1] !== point) continue;
            var brush = pairs[q][2];
            if (visited[brush]) continue;
            visited[brush] = true;
            if (owner[brush] === undefined || extendMatch(owner[brush], visited)) {
              owner[brush] = point; match[point] = fingers[brush]; return true;
            }
          }
          return false;
        }
        for (i = 0; i < pts.length; i++) if (!match[i]) extendMatch(i, {});
        for (i = 0; i < pts.length; i++) {
          var t = match[i];
          if (!t) { t = {id: nextFinger++, fx: new OneEuro(), fy: new OneEuro(), seen: 0, cx: null, cy: null}; fingers.push(t); }
          t.rx = pts[i][0]; t.ry = pts[i][1]; t.lastMs = nowMs; t.seen++;
          t.x = t.fx.filter(t.rx, nowS); t.y = t.fy.filter(t.ry, nowS);
          (t.hist = t.hist || []).push({t: nowS, x: t.x, y: t.y});
          while (t.hist.length > 2 && nowS - t.hist[1].t > K.MOTION_WINDOW_S) t.hist.shift();
          var h0 = t.hist[0], span = Math.max(1e-3, nowS - h0.t), asp = canvas.width / canvas.height;
          t.travel = span >= K.MOTION_WINDOW_S * 0.5 ? Math.hypot((t.x - h0.x) * asp, t.y - h0.y) / asp / span : 0;
          if (t.colour === undefined && t.seen >= K.CONFIRM) t.colour = colourForFinger(t);
        }
      }
      function colourForFinger(t) {
        var best = null, bd = K.SNAP;
        for (var i = 0; i < hands.length; i++) {
          var h = hands[i]; if (h.seq !== lastSeq || h.x == null) continue;
          var d = Math.hypot(t.x - h.x, (t.y - h.y) * 0.625); if (d < bd) { bd = d; best = h; }
        }
        if (best && (best.colour !== undefined || best.person)) return best.colour !== undefined ? best.colour : best.person.colour;
        var bp = null; bd = 0.3;
        for (var j = 0; j < people.length; j++) {
          var s = toScreen(people[j].u, people[j].v), dp = Math.hypot(t.x - s[0], (t.y - s[1]) * 0.625); if (dp < bd) { bd = dp; bp = people[j]; }
        }
        return bp ? bp.colour : colourNext++ % palette().length;
      }
      function paintFingers(dt, halos) {
        var nowMs = performance.now();
        fingers = fingers.filter(function(t) { return nowMs - t.lastMs < K.FINGER_HOLD_MS; });      // gone from the wall: brush ends
        for (var i = 0; i < fingers.length; i++) {
          var t = fingers[i], col = colourOf(t);
          if (t.lastMs !== lastReportMs) { t.cx = null; continue; }   // not in the latest report: kept briefly (a missed frame), not painting
          halos.push({x: t.x, y: t.y, a: Math.min(1, t.seen / K.CONFIRM), col: col});
          if (t.seen < K.CONFIRM) continue;
          if (t.cx === null) { t.cx = t.x; t.cy = t.y; continue; }
          var k = Math.min(1, dt * K.GLIDE), nx = t.cx + (t.x - t.cx) * k, ny = t.cy + (t.y - t.cy) * k;
          var vx = t.fx.dx, vy = t.fy.dx, sp = Math.max(1e-6, Math.hypot(vx, vy)), travel = t.travel || 0;
          if (travel > K.STILL_SPEED) {
            var amount = K.INTENSITY * Math.min(1, (travel - K.STILL_SPEED) / (2 * K.STILL_SPEED));
            var f = Math.min(1.5, sp) / sp * 100 * K.FORCE * K.PUSH;
            stroke(t.cx, t.cy, nx, ny, vx * f, vy * f, col, amount);
          }
          t.cx = nx; t.cy = ny;
        }
      }
      function paintPlume(dt, fresh) {
        var now = performance.now(), tips = [], emitters = [];
        function add(x, y, vx, vy, strength, source) {
          if (emitters.length >= 8) return; // Match the display's source slots and bound GPU splat work.
          if (!isFinite(x) || !isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1 || !(strength > 0)) return;
          emitters.push({x: x, y: y, strength: strength, source: source});
          plumeDab(x, y, vx || 0, vy || 0, strength, dt);
        }
        // Contact coordinates win when available. A stopped stream never holds an emitter on.
        if (kit.fingers && now - lastReportMs < K.FRESH_MS) fingers.forEach(function(t) {
          if (t.lastMs !== lastReportMs || t.seen < K.CONFIRM) return;
          tips.push(t); add(t.x, t.y, t.fx.dx, t.fy.dx, 1, 'touch');
        });
        if (fresh) hands.forEach(function(t) {
          if (t.seq !== lastSeq || t.seen < K.CONFIRM || !(t.dmin < K.HAND_ZONE_MM)) return;
          if (tips.some(function(f) { return Math.hypot(f.x - t.x, (f.y - t.y) * canvas.height / canvas.width) < K.SNAP; })) return;
          var strength = Math.max(0, Math.min(1, (K.HAND_ZONE_MM - t.dmin) / (K.HAND_ZONE_MM - 80)));
          add(t.x, t.y, t.fx.dx, t.fy.dx, strength, 'hover');
        });
        if (!fresh && !kit.fingers) Object.keys(touchTips).forEach(function(id) {
          var t = touchTips[id];
          if (now / 1000 - t.t < K.FRESH_MS / 1000) add(t.x, t.y, 0, 0, 1, 'pointer');
          else delete touchTips[id];
        });
        plumeEmitters = emitters;
      }
      function colourOf(t) { var pal = palette(), c = t.colour !== undefined ? t.colour : (t.person ? t.person.colour : t.id); return pal[c % pal.length]; }

      // dabs along the brush path, a dab every ~third of a brush radius
      function stroke(x0, y0, x1, y1, vx, vy, col, amount) {
        var r = Math.sqrt(K.BRUSH / 100), len = Math.hypot((x1 - x0) * canvas.width / canvas.height, y1 - y0);
        var n = Math.max(1, Math.min(24, Math.ceil(len / (r * 0.35))));
        for (var i = 1; i <= n; i++) {
          var f = i / n;
          splat(x0 + (x1 - x0) * f, 1 - (y0 + (y1 - y0) * f), vx / n, -vy / n, [col[0] * amount / n, col[1] * amount / n, col[2] * amount / n]);   // a frame's dabs add up to one Pavel splat
        }
        stats.emitted += n;
      }

      // the "Colour shift" knob (fx liquid_hue → window._liquidFx, main.js FX_FLOAT_NS): live while this piece runs, re-applied on every create
      function liquidSet(v) { if (v && Number.isFinite(+v.hue)) K.HUE = Math.max(0, Math.min(360, +v.hue)); return {hue: K.HUE || 0}; }
      window.LiquidSet = liquidSet;
      if (window._liquidFx) liquidSet(window._liquidFx);

      return {
        touch: function(t) {                                 // a fingertip on the wall: paints only when no depth is arriving
          syncMode();
          if (isPlume()) {
            touchTips[t.id] = {x: t.x, y: t.y, t: performance.now() / 1000};
            return;
          }
          var d = kit.depth();
          if (d && performance.now() - d.time < 1000) return;
          var prev = touchTips[t.id], now = performance.now() / 1000, pal = palette(), col = pal[t.id % pal.length];
          if (prev && now - prev.t < 0.7) {
            var dt = Math.max(0.03, now - prev.t), vx = (t.x - prev.x) / dt, vy = (t.y - prev.y) / dt;
            var f = Math.min(1.5, Math.hypot(vx, vy)) * 100 * K.FORCE * K.PUSH / Math.max(1e-6, Math.hypot(vx, vy));
            stroke(prev.x, prev.y, t.x, t.y, vx * f, vy * f, col, K.INTENSITY * 3);
          } else stroke(t.x, t.y, t.x, t.y, 0, 0, col, K.INTENSITY * 3);
          touchTips[t.id] = {x: t.x, y: t.y, t: now};
        },
        frame: function(dt) {
          dt = Math.min(dt, 1 / 30);
          syncMode();
          roomForce(dt);
          musicForce(dt);
          var depth = kit.depth(), now = performance.now(), fresh = depth && depth.wall && now - depth.time < K.FRESH_MS;
          if (fresh && depth.seq !== lastSeq) { lastSeq = depth.seq; onDepth(depth); lastFrameSeen = now; }
          var halos = [];
          if (isPlume()) {
            if (kit.fingers && kit.fingers !== lastFg) { lastFg = kit.fingers; onFingers(lastFg.pts || []); }
            paintPlume(dt, fresh); step(dt); render(halos); return;
          }
          if (kit.fingers) {                                 // the bridge has the fingertip stream: fingertips are the brushes
            if (kit.fingers !== lastFg) { lastFg = kit.fingers; onFingers(lastFg.pts || []); }
            paintFingers(dt, halos);
            step(dt);
            render(halos);
            return;
          }
          followTips(dt);
          for (var i = 0; i < hands.length; i++) {
            var t = hands[i], col = colourOf(t), current = fresh && t.seq === lastSeq;
            if (!current) { t.cx = null; continue; }             // lost or stale: this hand paints nothing
            var px = t.x + (t.ox || 0), py = t.y + (t.oy || 0);     // the hand, moved onto its fingertip while the finger is on the wall
            var onWall = t.tipSeen !== undefined && Date.now() - t.tipSeen < K.TIP_HOLD_MS;
            if (K.TOUCH_ONLY && !onWall) { t.cx = null; continue; }      // not a confirmed finger on the wall: no paint, no halo
            halos.push({x: px, y: py, a: Math.min(1, t.seen / K.CONFIRM), col: col});
            if (t.seen < K.CONFIRM) continue;                  // not confirmed yet
            if (t.cx === null) { t.cx = px; t.cy = py; continue; }
            var k = Math.min(1, dt * K.GLIDE), nx = t.cx + (px - t.cx) * k, ny = t.cy + (py - t.cy) * k;
            var vx = t.fx.dx, vy = t.fy.dx, sp = Math.max(1e-6, Math.hypot(vx, vy)), travel = t.travel || 0;
            if (travel > K.STILL_SPEED) {                      // really moving (not jitter, not a still hand, not a static object)
              var amount = K.INTENSITY * Math.min(1, (travel - K.STILL_SPEED) / (2 * K.STILL_SPEED));
              var f = Math.min(1.5, sp) / sp * 100 * K.FORCE * K.PUSH;   // force from the filtered velocity, capped at 1.5 screen widths per second
              stroke(t.cx, t.cy, nx, ny, vx * f, vy * f, col, amount);
            }
            t.cx = nx; t.cy = ny;
          }
          if (!fresh) { hands.forEach(function(h) { h.cx = null; }); }
          step(dt);
          render(halos);
        },
        resize: function() { initFramebuffers(); },
        destroy: function() {
          if (window.LiquidSet === liquidSet) delete window.LiquidSet;
          kit.wantDepth(false);
          freeFBOs();
          programs.forEach(function(p) { gl.deleteProgram(p); });
          shaders.forEach(function(s) { gl.deleteShader(s); });
          gl.deleteBuffer(vbuf); gl.deleteBuffer(ibuf);
        },
        // for tests and the preview page (read-only views of the tracker)
        debug: function() {
          return {roomForceFrames:roomForceFrames, mode: K.MODE || 'paint', plumeEmitters: plumeEmitters.slice(), stats: stats, hands: hands.map(function(t) { return {id: t.id, person: t.person && t.person.id, colour: t.colour, seen: t.seen, shared: !!t.shared, alone: t.alone || 0, ox: t.ox || 0, oy: t.oy || 0,
                  x: t.x, y: t.y, rawX: t.rawX, rawY: t.rawY, vx: t.fx.dx, vy: t.fy.dx, travel: t.travel || 0, current: t.seq === lastSeq, reacquired: t.reacquired || 0}; }),
                  people: people.map(function(p) { return {id: p.id, colour: p.colour}; }),
                  fingers: fingers.map(function(t) { return {id: t.id, colour: t.colour, seen: t.seen, x: t.x, y: t.y, travel: t.travel || 0}; })};
        },
        detect: findHands
      };
    }
  });
})();
