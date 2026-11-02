/* Resonance Steady: Lab music variant of Chladni Classic.
 * Independent fork of plugins/sigils.js (Opus 5.5); original source remains unchanged.
 * Music input: the existing read-only Studio Lightshow /api/stream, melbank_2.
 * Bass moves sand, mids morph the plate, highs shimmer. Hands constrain the nodal figure;
 * the original shared depth path sweeps sand and darkens people. No audio output, microphone,
 * playback commands, lamp writes or extra Kinect connection. Offline input settles to quiet.
 * Built from source sha256: 3cc5a8c1ccb66fb402b3ccad5fee7bdd189471a0660de6e820cf0bac115c5a91 .
 */
(function() {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  var GRAINS_W = 640, GRAINS_H = 480;     // grain count = W x H (307,200 grains of sand)
  var GRAIN_PX = 1.6;                     // grain size in pixels on a 1280-wide picture
  var PULL = 5.0;                         // how hard the sand is drawn onto the still lines
  var SHAKE = 1.4;                        // how hard the singing parts of the plate throw the sand about
  var THERMAL = 0.10;                     // a little jitter everywhere: the softness and shimmer of the lines
  var RESPONSE = 9.0;                     // how quickly grains pick up the plate's pull (1/s); lower = more flowing, lazier
  var RING_SPEED = 1.1;                   // how fast a new figure spreads from a touch (plate heights per second)
  var RING_KICK = 2.6;                    // how high the sand leaps as that ripple passes
  var RING_GLOW = 0.10;                   // brightness of the faint ripple of light that carries a new figure (0 = none)
  var RING_LIFT = 1.6;                    // how much brighter the sand shines as the ripple lifts it
  var MORPH_SPEED = 0.35;                // how fast the figure drifts on its own (radians per second of the mode mix)
  var MORPH_RANGE = 0.55;                 // how far it drifts from the balanced mix (the classic figures); big = visits plain grids too
  var IDLE_AFTER_S = 12;                  // after this long without a touch the plate plays by itself...
  var IDLE_NEW_S = 25;                    // ...striking a new figure about this often
  var MIN_CHANGE_S = 1.6;                 // a new figure needs this long to settle; touches sooner just glide the still point over
  // BEGIN RESONANCE_STEADY_TRACKER
  // Pure replay API: update({t: epochMilliseconds, pts:[[0..1,0..1],...]}, nowMs, dtSeconds).
  // Extract this block in Node; no DOM, clocks, sockets, or globals are required.
  function createResonanceSteadyTracker(options) {
    options = options || {};
    var width = Number.isFinite(options.width) && options.width > 0 ? options.width : 1280;
    var height = Number.isFinite(options.height) && options.height > 0 ? options.height : 800;
    var tracks = [], nextId = 1, established = false, state = 'never';
    var lastStamp = -Infinity, lastPacket = null, lastSignature = null;
    var started = [], reacquired = [];
    var STALE_MS = 300, GRACE_MS = 90, REST_S = 0.09, MOVE_S = 0.014;
    function distance(a, b) {
      return Math.hypot((a[0] - b[0]) * width, (a[1] - b[1]) * height);
    }
    function copy(track) {
      return {id:track.id, x:track.x, y:track.y, raw:track.raw.slice(), active:track.active,
        tau:track.tau, lostAt:track.lostAt};
    }
    function snapshot() {
      return {established:established, state:state, active:tracks.filter(function(t){return t.active;}).map(copy),
        retained:tracks.map(copy)};
    }
    function result() {
      var out = snapshot(); out.started = started.slice(); out.reacquired = reacquired.slice(); return out;
    }
    function clear(reason) { tracks = []; state = reason; }
    function expire(now) {
      tracks = tracks.filter(function(t){return t.active || now - t.lostAt <= GRACE_MS;});
      if (Number.isFinite(lastStamp) && now - lastStamp >= STALE_MS) clear('stale');
    }
    function motion(track, point, now) {
      track.history.push({p:point.slice(), t:now});
      while (track.history.length > 1 && now - track.history[0].t > 110) track.history.shift();
      var h = track.history, path = 0;
      for (var i = 1; i < h.length; i++) path += distance(h[i-1].p, h[i].p);
      var net = distance(h[0].p, point), span = now - h[0].t;
      // Velocity evidence chooses the single position filter; it does not filter positions twice.
      // Require several consistent measurements so alternating stationary noise stays at rest gain.
      if (h.length >= 3 && span >= 55 && net >= 2 && path > 0 && net / path >= 0.75) track.movingUntil = now + 80;
    }
    function ingest(points, now) {
      var pool = tracks.slice(), best = null;
      function visit(i, used, assignment, matches, cost) {
        if (i === points.length) {
          if (!best || matches > best.matches || (matches === best.matches && cost < best.cost))
            best = {assignment:assignment.slice(), matches:matches, cost:cost};
          return;
        }
        visit(i+1, used, assignment.concat([-1]), matches, cost);
        for (var j=0;j<pool.length;j++) {
          if (used.indexOf(j) >= 0) continue;
          var tr = pool[j], d = distance(points[i], tr.raw);
          var gate = tr.active ? Math.min(96, height * 0.12) : Math.min(20, height * 0.025);
          if (d > gate || (!tr.active && now - tr.lostAt > GRACE_MS)) continue;
          visit(i+1, used.concat([j]), assignment.concat([j]), matches+1, cost+d*d);
        }
      }
      visit(0, [], [], 0, 0);
      var active = [], used = [];
      for (var i=0;i<points.length;i++) {
        var p = points[i], index = best.assignment[i], tr;
        if (index >= 0) {
          tr = pool[index]; used.push(index);
          if (!tr.active) { reacquired.push(tr.id); tr.history = []; }
          tr.active = true; tr.lostAt = null;
          motion(tr,p,now); tr.raw = p.slice();
        } else {
          tr = {id:nextId++, x:p[0], y:p[1], raw:p.slice(), active:true, lostAt:null,
            history:[{p:p.slice(),t:now}], movingUntil:-Infinity, tau:REST_S};
          started.push(tr.id);
        }
        active.push(tr);
      }
      var dormant = [];
      for (var j=0;j<pool.length;j++) if (used.indexOf(j) < 0) {
        var old = pool[j];
        if (old.active) { old.active = false; old.lostAt = now; }
        if (now - old.lostAt <= GRACE_MS) dormant.push(old);
      }
      // At most two live tracks and two total records; old influence is never carried across loss.
      tracks = active.concat(dormant).slice(0,2);
      state = active.length ? 'active' : 'empty';
    }
    function update(packet, now, dt) {
      started = []; reacquired = [];
      if (!Number.isFinite(now)) { clear('invalid-clock'); return result(); }
      dt = Number.isFinite(dt) ? Math.max(0,Math.min(0.05,dt)) : 0;
      expire(now);
      if (packet !== null && packet !== undefined) {
        established = true;
        if (typeof packet !== 'object' || !Number.isFinite(packet.t) || packet.t - now > 100) {
          clear('invalid'); lastPacket = packet;
        } else if (packet.t >= lastStamp && now - packet.t < STALE_MS) {
          var valid = Array.isArray(packet.pts) && packet.pts.every(function(p){
            return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
              p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;
          });
          if (!valid) { clear('invalid'); lastStamp = packet.t; lastPacket = packet; lastSignature = null; }
          else {
            var points = packet.pts.slice(0,2).map(function(p){return [p[0],p[1]];});
            var signature = JSON.stringify(points);
            // Host timestamps are milliseconds: two distinct packets can share t.
            if (packet !== lastPacket && (packet.t > lastStamp || signature !== lastSignature)) {
              lastStamp = packet.t; lastPacket = packet; lastSignature = signature; ingest(points,now);
            }
          }
        } else if (packet.t >= lastStamp) { clear('stale'); lastStamp = packet.t; lastPacket = packet; }
        // Older packets are ignored; expiry above still prevents a late replay extending influence.
      } else if (established) { clear('missing'); }
      expire(now);
      for (var i=0;i<tracks.length;i++) if (tracks[i].active) {
        var tr = tracks[i]; tr.tau = now <= tr.movingUntil ? MOVE_S : REST_S;
        var gain = 1-Math.exp(-dt/tr.tau);
        tr.x += (tr.raw[0]-tr.x)*gain; tr.y += (tr.raw[1]-tr.y)*gain;
      }
      return result();
    }
    function reset() {
      tracks=[]; established=false; state='never'; lastStamp=-Infinity; lastPacket=null; lastSignature=null;
      started=[]; reacquired=[];
    }
    return {update:update,snapshot:snapshot,reset:reset};
  }
  // END RESONANCE_STEADY_TRACKER
  var PAIR_WINDOW_S = 1.5;                // a second finger (or tap) within this long of the first makes a figure still under both
  var SAME_TIP = 0.1;                     // a report this close (0..1 of the window) to a recent fingertip is the same finger...
  var SAME_TIP_GROW = 0.6, SAME_TIP_MAX = 0.22; // ...for a moving (or just-landed) finger, growing this much per second since its
                                          // last report (a moving finger reports only a few times a second); a still one stays at SAME_TIP
  var TIP_GUARD = 0.07;                   // the hand never sweeps away the figure within this distance of a fingertip (wall heights)
  var BODY_PUSH = 0.8;                    // how fast a body near the wall sweeps the sand out of its silhouette (plate heights / s)
  var BODY_SHAKE = 1.0;                   // how much the sand under a body boils
  var BODY_DEPTH_CELLS = 20;              // the push ramps up over this many cells (~10 px each) in from the silhouette's edge
  var BODY_MIN_MM = 110;                  // depth: closer than the wall by more than this counts as a body (noise stays under ~90)
  var BODY_NEAR_MM = 700, BODY_FAR_MM = 1700, BODY_FAR_WEIGHT = 0.35;  // full strength up to NEAR, fading to FAR_WEIGHT at FAR
  var HEAL = 0.5;                         // how readily sand is re-sprinkled into bare patches (a body's old place); 0 = never
  var BODY_STALE_MS = 1500;               // no new depth frame for this long: the body field fades away
  var EXPOSURE = 0.24;                    // brightness of the sand
  var BLOOM = 0.55;                       // the glow around the lines
  var WARMTH = 1.0;                       // (Chladni's knob; here the colour is TINT below, 'original' = this brass)

  // ---------------------------------------------------------------- Sigils knobs
  var SIGIL_GAP = 0.35;                   // the two hands must be at least this far apart (0..1 of the wall's width): arms out
  var SIGIL_PAIR_MS = 300;                // both hands land within this of each other (a lone finger resting longer is not a tap)
  var SIGIL_TAP_MS = 700;                 // a tap: both hands on the wall for less than this
  var SIGIL_DOUBLE_MS = 1100;             // the second tap lands within this of the first
  var SIGIL_SAME = 0.15;                  // ...with each hand within this of where it tapped the first time (0..1 of the window)
  var SIGIL_HOLD_S = 30;                  // a symbol holds this long, then the plate sings its own figures again
  var SIGIL_SIZE = 0.92;                  // a symbol's height, as a share of the wall's height
  var SIGIL_SHARP = 26;                   // how tightly the sand gathers onto a symbol's strokes (like the plate's pitch; higher = finer)
  var SIGIL_FLOW = 1.0;                   // how fast the sand flows onto the symbol (times PULL)
  var SIGIL_SHAKE_MAX = 1.2;              // cap on how hard sand far from any stroke is thrown about
  var SIGIL_GRAIN = 0.25;                 // a little extra shimmer on the strokes, so they read as sand lines, not wires
  var SIGIL_REACH = 0.09;                 // a symbol gathers sand from this close to its strokes (plate heights); farther sand rests as dust
  var SIGIL_SCATTER_S = 3.0;              // after a symbol strikes, the far sand is shaken into dust for about this long, then lies still
  var SIGIL_DUST = 0.14;                  // how bright the resting dust beyond a symbol's reach is drawn (1 = like the strokes)
  var SIGIL_HEAL = 0.25;                  // while a symbol shows, how readily bare patches are re-dusted, so a swept symbol heals after a body leaves
  var SIGIL_DRAW_S = 4.0;                 // how long the pen takes to draw a whole symbol (s); the sand rushes in behind it
  var SIGIL_DRAW_DELAY = 0.45;            // the plate goes dark from the hands outward for this long before the pen starts
  var SIGIL_PEN_SPEED = 0.85;             // how fast one stroke is drawn (plate heights per second; each stroke takes 0.3-1.1 s)
  var SIGIL_PEN_GLOW = 1.0;               // brightness of the pen's spark of light
  var SIGIL_PEN_SPARK = 1.6;              // how hard the sand dances right at the pen
  var SIGIL_FLASH = 1.0;                  // a band of light that sweeps down through the finished symbol (0 = none)
  var SIGIL_FLASH_SPEED = 1.1;            // how fast that band sweeps (plate heights per second)
  var IDLE_SIGIL_EVERY = 0;               // with nobody there, every Nth self-struck figure is the next symbol (0 = only by gesture)
  var SIGIL_TAP_CLEARS = true;            // a one-hand tap (one fingertip on and off the wall within SIGIL_TAP_MS) dissolves a symbol
  var SIGIL_CLEAR_AFTER_S = 1.0;          // ...but not in this first part of a symbol (the tail of the double tap that struck it)
  var BODY_BLACKOUT = 1.0;                // no light on people: the picture goes this dark wherever the Kinect sees someone (0 = off)
  var BLACKOUT_GROW = {small: 1, medium: 3, large: 6};   // ...grown this many cells (~10 px each) past their outline, for the
                                          // Kinect/projector offset (console Tune: Shadow margin)
  var BLACKOUT_SOFT = 2;                  // ...with an edge this many cells soft
  var TINT = 'original';                  // colour when the page has not said (fx key 'tint')
  var HUE = 0;                            // "Colour shift" knob (fx opus_hue, degrees 0-360): turns the sand's colour on top of the swatch; 0 = the swatch as designed

  var hueM = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), hueMAt = 0;
  function hueMatrix(deg) {   // column-major mat3 for gl.uniformMatrix3fv: the colour turned by deg about (1,1,1), like a hue rotation
    deg = ((deg % 360) + 360) % 360;                                          // 360 = 0 = the identity, exactly
    if (deg === hueMAt) return hueM;
    var a = deg * Math.PI / 180, c = Math.cos(a), k = (1 - c) / 3, s = Math.sin(a) / Math.sqrt(3);
    hueM.set([c + k, k + s, k - s, k - s, c + k, k + s, k + s, k - s, c + k]);
    hueMAt = deg; return hueM;
  }

  // colours: the sand's light L (0..1) per channel = gain * L^exp. 'original' is exactly Chladni's brass.
  var TINTS = {
    original: [[0.85, 1.7, 3.4], [1.0, 0.93, 0.82]],
    silver:   [[1.5, 1.2, 0.9], [0.85, 0.92, 1.0]],
    gold:     [[0.8, 1.15, 2.8], [1.0, 0.86, 0.5]],
    rose:     [[0.8, 2.1, 1.5], [1.0, 0.68, 0.84]],
    jade:     [[2.2, 0.85, 1.6], [0.62, 1.0, 0.78]],
    azure:    [[2.6, 1.35, 0.8], [0.55, 0.82, 1.0]],
    violet:   [[1.25, 2.6, 0.85], [0.86, 0.6, 1.0]],
    ember:    [[0.75, 2.3, 4.2], [1.0, 0.72, 0.55]],
    white:    [[1.0, 1.0, 1.0], [0.95, 0.95, 0.95]]
  };
  var curTint = TINT, curPeople = 'dark', curTap = 'jolts', curMargin = 'medium';
  var curMode = 'classic', curPlaylist = null, nextPlay = 0;
  function applyPlaylist(raw) { curPlaylist = window.SigilsCatalog.parsePlaylist(raw); nextPlay = 0; }

  // ---------------------------------------------------------------- the symbols (plugins/sigils-symbols.js)
  var CAT = window.SigilsCatalog;
  if (!CAT || !CAT.SYMBOLS || !CAT.SYMBOLS.length) throw new Error('sigils: load sigils-symbols.js before sigils.js');
  var SYMBOLS = CAT.SYMBOLS;
  curPlaylist = CAT.DEFAULT_PLAYLIST.slice();
  var MAX_STROKES = 128;

  // ---------------------------------------------------------------- the plate's figures (degenerate sets of (n, m))
  var FAMILIES = [
    [[2, 3], [3, 2]],
    [[1, 4], [4, 1]],
    [[3, 4], [4, 3], [0, 5], [5, 0]],
    [[2, 5], [5, 2]],
    [[3, 5], [5, 3]],
    [[1, 6], [6, 1]],
    [[4, 5], [5, 4]],
    [[1, 7], [7, 1], [5, 5]],
    [[2, 7], [7, 2]],
    [[3, 7], [7, 3]],
    [[1, 8], [8, 1], [4, 7], [7, 4]],
    [[2, 9], [9, 2], [6, 7], [7, 6]],
    [[5, 8], [8, 5]],
    [[0, 10], [10, 0], [6, 8], [8, 6]],
    [[2, 11], [11, 2], [5, 10], [10, 5]],
    [[3, 11], [11, 3], [7, 9], [9, 7]],
    [[1, 12], [12, 1], [8, 9], [9, 8]]
  ];

  var PW = 128, PH = 106;                 // the body field: the 512 x 424 depth image in 4 x 4 cells

  var GLSL_HASH =
    'uint hsh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }\n' +
    'float u01(uint x) { return float(hsh(x) >> 8) * (1.0 / 16777216.0); }\n';

  var VS_TRI =
    '#version 300 es\n' +
    'out vec2 vUv;\n' +
    'void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }\n';

  // one step of every grain: pulled onto the still lines, thrown about where the plate moves, pushed out from under bodies
  var FS_STEP =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uState, uProx, uDens;\n' +
    'uniform float uDt, uAspect, uPull, uShake, uThermal, uResp, uKick, uRingW, uBodyOn, uBodyPush, uBodyShake, uHeal, uDensLod, uTopLod, uMusicKick;\n' +
    'uniform uint uFrame;\n' +
    'uniform vec4 uN0, uM0, uC0, uN1, uM1, uC1;\n' +
    'uniform float uK0, uK1;\n' +
    'uniform sampler2D uSigT0, uSigT1; uniform float uSig0, uSig1, uKS, uSigF, uSigX0, uSigXW, uSigShakeMax, uSigGrain, uSigReach, uSigFar;\n' +
    'uniform vec3 uPen[6]; uniform float uPenSpark;\n' +
    'uniform vec3 uRing;\n' +
    'uniform mat3 uHinv;\n' +
    'uniform vec4 uTips; uniform float uTipN, uTipGuard;\n' +
    'out vec4 o;\n' +
    'const float PI = 3.14159265;\n' + GLSL_HASH +
    'vec3 field(vec2 P, vec4 N, vec4 M, vec4 C) {\n' +
    '  vec4 ax = PI * N * P.x, ay = PI * M * P.y, cx = cos(ax), sx = sin(ax), cy = cos(ay), sy = sin(ay);\n' +
    '  return vec3(dot(C, cx * cy), -PI * dot(C * N, sx * cy), -PI * dot(C * M, cx * sy));\n' +
    '}\n' +
    'vec4 sig(sampler2D T, vec2 P) {\n' +   // a symbol: the distance to its strokes, so the sand flows down it onto them
    '  vec2 uv = vec2((P.x - uSigX0) / uSigXW, P.y); const float eu = 1.0 / 512.0, ev = 1.0 / 320.0;\n' +
    '  float d = texture(T, uv).r;\n' +
    '  vec2 g = vec2((texture(T, uv + vec2(eu, 0.0)).r - texture(T, uv - vec2(eu, 0.0)).r) / (2.0 * eu * uSigXW),\n' +
    '                (texture(T, uv + vec2(0.0, ev)).r - texture(T, uv - vec2(0.0, ev)).r) / (2.0 * ev));\n' +
    '  float inR = step(d, uSigReach), A = uSigF * uKS * min(d, uSigReach);\n' +   // no pull beyond the reach
    '  float near = min(A, uSigShakeMax) + uSigGrain, far = uSigShakeMax * uSigFar + 0.02;\n' +
    '  return vec4(A, uSigF * uKS * g * inR, mix(near, far, smoothstep(0.75 * uSigReach, uSigReach, d)));\n' +
    '}\n' +
    'vec4 fig(int slot, vec2 P) {\n' +     // (field, its gradient, how hard the sand there is shaken)
    '  if (slot == 1) { if (uSig1 > 0.5) return sig(uSigT1, P); vec3 f = field(P, uN1, uM1, uC1); return vec4(f, abs(f.x)); }\n' +
    '  if (uSig0 > 0.5) return sig(uSigT0, P); vec3 f = field(P, uN0, uM0, uC0); return vec4(f, abs(f.x));\n' +
    '}\n' +
    'float prox(vec2 q) { vec3 h = uHinv * vec3(q, 1.0); return h.z > 0.0 ? texture(uProx, h.xy / h.z).r : 0.0; }\n' +
    'void main() {\n' +
    '  ivec2 ij = ivec2(gl_FragCoord.xy);\n' +
    '  vec4 s = texelFetch(uState, ij, 0);\n' +
    '  vec2 q = s.xy, v = s.zw;\n' +
    '  vec2 P = vec2(0.5 + (q.x - 0.5) * uAspect, q.y);\n' +
    '  vec4 f = fig(1, P); float k = uSig1 > 0.5 ? uKS : uK1, band = 0.0;\n' +
    '  if (uRing.z < 50.0) {\n' +
    '    vec4 f0 = fig(0, P);\n' +
    '    float d = distance(P, uRing.xy), w = smoothstep(uRing.z + uRingW, uRing.z - uRingW, d);\n' +
    '    f = mix(f0, f, w); k = mix(uSig0 > 0.5 ? uKS : uK0, uSig1 > 0.5 ? uKS : uK1, w);\n' +
    '    float x = (d - uRing.z) / uRingW; band = exp(-x * x);\n' +
    '  }\n' +
    '  float Q = 0.0; vec2 gQ = vec2(0.0);\n' +
    '  if (uBodyOn > 0.5) {\n' +
    '    const float e = 0.006;\n' +
    '    Q = prox(q);\n' +
    '    gQ = vec2((prox(q + vec2(e, 0.0)) - prox(q - vec2(e, 0.0))) / uAspect, prox(q + vec2(0.0, e)) - prox(q - vec2(0.0, e))) / (2.0 * e);\n' +
    '    float keep = 1.0;\n' +   // the hand never sweeps away the figure right around a fingertip
    '    if (uTipN > 0.5) keep *= smoothstep(uTipGuard * 0.6, uTipGuard * 1.3, distance(P, uTips.xy));\n' +
    '    if (uTipN > 1.5) keep *= smoothstep(uTipGuard * 0.6, uTipGuard * 1.3, distance(P, uTips.zw));\n' +
    '    Q *= keep; gQ *= keep;\n' +
    '  }\n' +
    '  uint seed = hsh(uint(ij.x) + uint(ij.y) * 4096u) ^ (uFrame * 0x9E3779B9u);\n' +
    '  float r1 = max(u01(seed), 1e-7), r2 = u01(seed ^ 0x68bc21ebu);\n' +
    '  vec2 gauss = sqrt(-2.0 * log(r1)) * vec2(cos(2.0 * PI * r2), sin(2.0 * PI * r2));\n' +
    '  float hold = 1.0 - smoothstep(0.0, 0.1, Q);\n' +
    '  vec2 push = -uBodyPush * gQ / max(length(gQ), 1.0) * smoothstep(0.0, 0.08, Q);\n' +
    '  vec2 target = -uPull * f.x * f.yz / (k * k) * hold + push;\n' +
    '  v = mix(v, target, 1.0 - exp(-uDt * uResp));\n' +
    '  float spark = 0.0;\n' +
    '  for (int i = 0; i < 6; i++) { if (uPen[i].z <= 0.0) continue; vec2 dd = P - uPen[i].xy; spark += uPen[i].z * exp(-dot(dd, dd) / 0.0009); }\n' +
    '  float sigma = (uShake * f.w + uThermal + uKick * band + uPenSpark * spark + uMusicKick) / k + uBodyShake * smoothstep(0.0, 0.3, Q) * 0.02;\n' +
    '  vec2 dP = v * uDt + gauss * sigma * sqrt(uDt);\n' +
    '  q += vec2(dP.x / uAspect, dP.y);\n' +
    '  if (!(q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) || any(isnan(v)) || any(isinf(v))) {\n' +   // off the picture (or broken): sprinkled back in
    '    q = vec2(u01(seed ^ 0x1b873593u), u01(seed ^ 0xcc9e2d51u)); v = vec2(0.0);\n' +
    '  } else if (u01(seed ^ 0x85ebca6bu) < uHeal * uDt) {\n' +   // healing: a grain from a well-dusted place to a bare one
    '    vec2 t = vec2(u01(seed ^ 0x27d4eb2fu), u01(seed ^ 0x165667b1u));\n' +
    '    float mean = textureLod(uDens, vec2(0.5), uTopLod).r;\n' +
    '    float dT = textureLod(uDens, vec2(t.x, 1.0 - t.y), uDensLod).r, dH = textureLod(uDens, vec2(q.x, 1.0 - q.y), uDensLod).r;\n' +
    '    if (dT < 0.4 * mean && dH > mean && (uBodyOn < 0.5 || prox(t) < 0.01)) { q = t; v = vec2(0.0); }\n' +
    '  }\n' +
    '  o = vec4(clamp(q, 0.0, 1.0), v);\n' +
    '}\n';

  // every grain as a point of light, added up: r = how much sand, g = how much of it is on the move
  var VS_DRAW =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uState;\n' +
    'uniform float uPt, uSpeedK, uAspect, uRingW, uLift, uMusicLift, uMusicSize;\n' +
    'uniform vec3 uRing;\n' +
    'uniform sampler2D uSigT0, uSigT1; uniform float uSig0, uSig1, uSigX0, uSigXW, uSigReach, uDust;\n' +
    'out vec2 vC;\n' + GLSL_HASH +
    'void main() {\n' +
    '  int i = gl_VertexID;\n' +
    '  vec4 s = texelFetch(uState, ivec2(i % ' + GRAINS_W + ', i / ' + GRAINS_W + '), 0);\n' +
    '  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);\n' +
    '  float h = u01(uint(i) * 2654435761u);\n' +
    '  gl_PointSize = uPt * (0.75 + 0.75 * h * h) * uMusicSize;\n' +
    '  float x = (distance(vec2(0.5 + (s.x - 0.5) * uAspect, s.y), uRing.xy) - uRing.z) / uRingW;\n' +
    '  vC = vec2((0.55 + 0.9 * h) * (1.0 + uLift * exp(-x * x)) * (1.0 + uMusicLift), clamp(length(s.zw) * uSpeedK, 0.0, 1.0));\n' +
    '  vec2 P = vec2(0.5 + (s.x - 0.5) * uAspect, s.y);\n' +   // a symbol is showing here: sand resting beyond its reach is dust in shadow
    '  bool inside = distance(P, uRing.xy) < uRing.z; vec2 sv = vec2((P.x - uSigX0) / uSigXW, P.y);\n' +   // inside the ripple the new figure, outside the old
    '  if (inside ? uSig1 > 0.5 : uSig0 > 0.5) {\n' +
    '    float d = inside ? textureLod(uSigT1, sv, 0.0).r : textureLod(uSigT0, sv, 0.0).r;\n' +
    '    vC.x *= mix(1.0, uDust, smoothstep(0.8 * uSigReach, 1.2 * uSigReach, d));\n' +
    '  }\n' +
    '}\n';
  var FS_DRAW =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec2 vC; out vec4 o;\n' +
    'void main() { o = vec4(vC.x, vC.x * vC.y, 0.0, 0.0); }\n';

  var GLSL_PAL =
    'uniform float uExposure; uniform vec3 uTE, uTG; uniform mat3 uHueM;\n' +   // uHueM: the Colour shift as a turn about the grey axis (the identity at 0)
    'vec3 pal(float L) { return max(uHueM * (uTG * pow(vec3(L), uTE)), vec3(0.0)); }\n' +
    'vec3 sandColor(vec4 a) {\n' +
    '  float L = 1.0 - exp(-a.r * uExposure);\n' +
    '  float mv = a.g / (a.r + 1e-4);\n' +
    '  return mix(pal(L), max(uHueM * vec3(0.78, 0.9, 1.0), vec3(0.0)) * L, mv * 0.5);\n' +
    '}\n';

  // quarter-size copy of the lit sand for the glow
  var FS_DOWN =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uSrc; uniform vec2 uTexel;\n' +
    'in vec2 vUv; out vec4 o;\n' + GLSL_PAL +
    'void main() {\n' +
    '  vec4 a = textureLod(uSrc, vUv + uTexel * vec2(-1.0, -1.0), 0.0) + textureLod(uSrc, vUv + uTexel * vec2(1.0, -1.0), 0.0)\n' +
    '         + textureLod(uSrc, vUv + uTexel * vec2(-1.0, 1.0), 0.0) + textureLod(uSrc, vUv + uTexel * vec2(1.0, 1.0), 0.0);\n' +
    '  o = vec4(sandColor(a * 0.25), 1.0);\n' +
    '}\n';
  var FS_BLUR =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uSrc; uniform vec2 uDir;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'void main() {\n' +
    '  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;\n' +
    '  c += (texture(uSrc, vUv + uDir * 1.3846153846).rgb + texture(uSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;\n' +
    '  c += (texture(uSrc, vUv + uDir * 3.2307692308).rgb + texture(uSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;\n' +
    '  o = vec4(c, 1.0);\n' +
    '}\n';
  var FS_COMP =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uAccum, uGlow; uniform float uGlowAmt, uAspect; uniform vec4 uRingVis;\n' +
    'uniform vec3 uPen[6]; uniform float uPenGlow, uSigX0, uSigXW; uniform vec3 uFlash; uniform sampler2D uSigT;\n' +
    'uniform sampler2D uMask; uniform mat3 uHinv; uniform float uBlackout;\n' +
    'in vec2 vUv; out vec4 o;\n' + GLSL_PAL +
    'void main() {\n' +
    '  vec3 col = sandColor(textureLod(uAccum, vUv, 0.0)) + texture(uGlow, vUv).rgb * uGlowAmt;\n' +
    '  if (uRingVis.w > 0.002) {\n' +
    '    vec2 P = vec2(0.5 + (vUv.x - 0.5) * uAspect, 1.0 - vUv.y);\n' +
    '    float x = (distance(P, uRingVis.xy) - uRingVis.z) / 0.014;\n' +
    '    vec3 rc = pal(0.85); rc /= max(max(rc.r, rc.g), max(rc.b, 1e-3));\n' +
    '    col += rc * exp(-x * x) * uRingVis.w;\n' +
    '  }\n' +
    '  vec2 Q = vec2(0.5 + (vUv.x - 0.5) * uAspect, 1.0 - vUv.y);\n' +   // the pens drawing the symbol: a white-hot spark in a halo
    '  vec3 tc = pal(0.9); tc /= max(max(tc.r, tc.g), max(tc.b, 1e-3));\n' +
    '  for (int i = 0; i < 6; i++) { if (uPen[i].z <= 0.0) continue; float r2 = dot(Q - uPen[i].xy, Q - uPen[i].xy);\n' +
    '    col += (vec3(1.0) * exp(-r2 / 0.00003) + tc * 0.55 * exp(-r2 / 0.0012)) * uPen[i].z * uPenGlow; }\n' +
    '  if (uFlash.x + uFlash.z > 0.003) {\n' +   // the finished symbol: a band of light sweeps down its strokes, then a fading afterglow
    '    float d = texture(uSigT, vec2((Q.x - uSigX0) / uSigXW, Q.y)).r, by = (Q.y - uFlash.y) / 0.07;\n' +
    '    float amt = uFlash.x * exp(-by * by) + uFlash.z;\n' +
    '    col += mix(tc, vec3(1.0), 0.35 * uFlash.x * exp(-by * by)) * amt * (exp(-d * d / 0.000025) * 0.9 + exp(-d * d / 0.0006) * 0.35);\n' +
    '  }\n' +
    '  if (uBlackout > 0.0) {\n' +   // people: where the Kinect sees someone, no light (so none lands on them)
    '    vec3 h = uHinv * vec3(vUv.x, 1.0 - vUv.y, 1.0); vec2 k = h.xy / max(h.z, 1e-6);\n' +
    '    float m = (h.z > 0.0 && k.x >= 0.0 && k.x <= 1.0 && k.y >= 0.0 && k.y <= 1.0) ? texture(uMask, k).r : 0.0;\n' +
    '    col *= 1.0 - uBlackout * smoothstep(0.12, 0.88, m);\n' +
    '  }\n' +
    '  o = vec4(col, 1.0);\n' +
    '}\n';

  // a symbol's distance field, in plate units, over the whole plate (512 x 320 texels)
  var FS_SDF =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform vec4 uS[' + MAX_STROKES + ']; uniform int uNC, uNL; uniform float uX0, uXW;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'void main() {\n' +
    '  vec2 P = vec2(uX0 + vUv.x * uXW, vUv.y); float d = 1e3;\n' +
    '  for (int i = 0; i < ' + MAX_STROKES + '; i++) {\n' +
    '    if (i >= uNC + uNL) break;\n' +
    '    vec4 s = uS[i];\n' +
    '    if (i < uNC) {\n' +   // a circle drawn clockwise from its top; s.w = how much of it so far (1 = all)
    '      vec2 v = P - s.xy; float a = atan(v.x, -v.y); if (a < 0.0) a += 6.2831853;\n' +
    '      float sw = s.w * 6.2831853;\n' +
    '      if (s.w >= 0.999 || a <= sw) d = min(d, abs(length(v) - s.z));\n' +
    '      else d = min(d, min(distance(P, s.xy + s.z * vec2(0.0, -1.0)), distance(P, s.xy + s.z * vec2(sin(sw), -cos(sw)))));\n' +
    '    }\n' +
    '    else { vec2 pa = P - s.xy, ba = s.zw - s.xy; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0); d = min(d, length(pa - ba * h)); }\n' +
    '  }\n' +
    '  o = vec4(d, 0.0, 0.0, 1.0);\n' +
    '}\n';

  function rnd(a, b) { return a + Math.random() * (b - a); }

  registerWallPlugin({
    id: 'resonancesteady',
    title: 'Resonance Steady',
    author: 'Codex; independent music variant of Chladni by Opus 5.5',
    create: function(canvas, kit) {
      PULL = 5; SHAKE = 1.4; THERMAL = 0.10; HUE = 0;
      curMode = 'classic'; curTint = 'original'; curPeople = 'dark';

      var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
                                            preserveDrawingBuffer: false, powerPreference: 'high-performance'});
      if (!gl) throw new Error('WebGL2 is not available');
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');

      // ------------------------------------------------------------ GL plumbing
      var made = {tex: [], fb: [], prog: []};
      function shader(type, src) {
        var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var m = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + m); }
        return s;
      }
      function program(vs, fs) {
        var p = gl.createProgram(), a = shader(gl.VERTEX_SHADER, vs), b = shader(gl.FRAGMENT_SHADER, fs);
        gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
        gl.deleteShader(a); gl.deleteShader(b);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
        made.prog.push(p);
        var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
        return {p: p, u: u};
      }
      function texture(w, h, ifmt, fmt, type, filter, data) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        made.tex.push(t);
        return t;
      }
      function target(tex) {
        var f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
        made.fb.push(f);
        return f;
      }
      function forget(list, kind, x) { var i = list.indexOf(x); if (i >= 0) list.splice(i, 1); if (kind === 't') gl.deleteTexture(x); else gl.deleteFramebuffer(x); }

      var vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      var pStep = program(VS_TRI, FS_STEP), pDraw = program(VS_DRAW, FS_DRAW), pDown = program(VS_TRI, FS_DOWN),
          pBlur = program(VS_TRI, FS_BLUR), pComp = program(VS_TRI, FS_COMP), pSdf = program(VS_TRI, FS_SDF);
      var SDF_W = 512, SDF_H = 320;                 // two symbol fields: the one showing and the one the ripple is replacing
      var sigTex = [texture(SDF_W, SDF_H, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.LINEAR), texture(SDF_W, SDF_H, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.LINEAR)];
      var sigFb = [target(sigTex[0]), target(sigTex[1])];

      // grains: rgba32f = position (0..1 of the window, y down), velocity (plate units / s)
      var N = GRAINS_W * GRAINS_H, init = new Float32Array(N * 4);
      for (var i = 0; i < N; i++) { init[i * 4] = Math.random(); init[i * 4 + 1] = Math.random(); }
      var stTex = [texture(GRAINS_W, GRAINS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init),
                   texture(GRAINS_W, GRAINS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init)];
      init = null;
      var stFb = [target(stTex[0]), target(stTex[1])], cur = 0;

      // the body field (Kinect space), refilled from each depth frame
      var proxTex = texture(PW, PH, gl.R16F, gl.RED, gl.FLOAT, gl.LINEAR, new Float32Array(PW * PH));
      var proxRaw = new Float32Array(PW * PH), proxTmp = new Float32Array(PW * PH), proxSm = new Float32Array(PW * PH);
      var proxW = new Float32Array(PW * PH);
      var maskTex = texture(PW, PH, gl.R16F, gl.RED, gl.FLOAT, gl.LINEAR, new Float32Array(PW * PH));
      var maskRaw = new Float32Array(PW * PH), maskTmp = new Float32Array(PW * PH), maskSm = new Float32Array(PW * PH), maskPeak = 0;
      var proxLive = false, lastSeq = -1, lastSeqAt = 0, proxPeak = 0, bodyMs = 0;

      // screen-sized buffers
      var topLod = 0, densLod = 0;
      var W = 0, H = 0, aspect = 1.6, accTex = null, accFb = null, glow = [null, null], glowFb = [null, null], GW = 0, GH = 0;
      function sizeBuffers(w, h) {
        w = Math.max(1, w | 0); h = Math.max(1, h | 0);
        if (w === W && h === H) return;
        if (accTex) { forget(made.fb, 'f', accFb); forget(made.tex, 't', accTex); for (var j = 0; j < 2; j++) { forget(made.fb, 'f', glowFb[j]); forget(made.tex, 't', glow[j]); } }
        W = w; H = h; aspect = W / H;
        GW = Math.max(1, Math.round(W / 4)); GH = Math.max(1, Math.round(H / 4));
        accTex = texture(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); accFb = target(accTex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);   // its mips are the sand's density map
        gl.generateMipmap(gl.TEXTURE_2D);
        topLod = Math.floor(Math.log2(Math.max(W, H)));
        densLod = Math.min(topLod, Math.max(0, Math.round(Math.log2(H / 6))));         // cells about 1/6 of the picture's height
        for (var j2 = 0; j2 < 2; j2++) { glow[j2] = texture(GW, GH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); glowFb[j2] = target(glow[j2]); }
      }
      sizeBuffers(canvas.width, canvas.height);

      // ------------------------------------------------------------ the plate: which figure, mixed how, still where
      function family(idx) {
        var terms = FAMILIES[idx], ph = [], base = [];
        for (var j = 0; j < terms.length; j++) { ph.push(rnd(0, 6.2832)); base.push((Math.random() < 0.5 ? -1 : 1) / Math.sqrt(terms.length)); }
        return {idx: idx, terms: terms, k: Math.PI * Math.hypot(terms[0][0], terms[0][1]), phase: ph, base: base};
      }
      // Four terms preserve at least two morph dimensions under two independent hand constraints.
      function pick(need3, avoid) {
        var ok = [];
        for (var j = 0; j < FAMILIES.length; j++) if (FAMILIES[j].length >= 4 && avoid.indexOf(j) < 0) ok.push(j);
        return family(ok[Math.floor(Math.random() * ok.length)]);
      }
      function terms(fam, x, y) {
        var X = 0.5 + (x - 0.5) * aspect, out = [];
        for (var j = 0; j < fam.terms.length; j++) out.push(Math.cos(Math.PI * fam.terms[j][0] * X) * Math.cos(Math.PI * fam.terms[j][1] * y));
        return out;
      }
      function dot(a, b) { var s = 0; for (var j = 0; j < a.length; j++) s += a[j] * b[j]; return s; }
      // the mix of the family's modes: drifting slowly with time, made still at every held point (Gram-Schmidt)
      function mixFor(fam, pts, t) {
        var K = fam.terms.length, basis = [], j, b;
        for (j = 0; j < pts.length && basis.length < K - 1; j++) {
          var v = terms(fam, pts[j].x, pts[j].y);
          for (b = 0; b < basis.length; b++) { var d = dot(v, basis[b]); for (var c = 0; c < K; c++) v[c] -= d * basis[b][c]; }
          var n = Math.sqrt(dot(v, v));
          if (n > 0.05) basis.push(v.map(function(x) { return x / n; }));
        }
        function project(r) { for (var bb = 0; bb < basis.length; bb++) { var dd = dot(r, basis[bb]); for (var cc = 0; cc < K; cc++) r[cc] -= dd * basis[bb][cc]; } return r; }
        var r = [];
        for (j = 0; j < K; j++) r.push(fam.base[j] + MORPH_RANGE * Math.cos(MORPH_SPEED * (1 + 0.41 * j) * t + fam.phase[j]));
        r = project(r);
        var rn = Math.sqrt(dot(r, r));
        if (rn < 0.08) {                            // the drift lines up with a held point: take the freest direction instead
          var best = null, bn = 0;
          for (j = 0; j < K; j++) { var e = []; for (b = 0; b < K; b++) e.push(b === j ? 1 : 0); e = project(e); var en = Math.sqrt(dot(e, e)); if (en > bn) { bn = en; best = e; } }
          if (bn > 1e-4) { r = best; rn = bn; }
        }
        var out = [0, 0, 0, 0];
        for (j = 0; j < K; j++) out[j] = rn > 1e-6 ? r[j] / rn : (j === 0 ? 1 : 0);
        return out;
      }
      function packNM(fam) {
        var n = [0, 0, 0, 0], m = [0, 0, 0, 0];
        for (var j = 0; j < fam.terms.length; j++) { n[j] = fam.terms[j][0]; m[j] = fam.terms[j][1]; }
        return [n, m];
      }

      var tNow = 0;                                 // seconds since the piece started
      var fam1 = family(10), mix1 = [1, 0, 0, 0];   // the figure now (starts from the (1,8)/(4,7) family)
      var fam0 = fam1, mix0 = mix1;                 // the figure the ripple is replacing
      var ring = {x: 0.5, y: 0.5, t0: -1e9, speed: RING_SPEED, kick: 0, glow: 0, done: true};
      var held = [];                                // the still points: [{x, y, tx, ty, t}] (smoothed, target, last report)
      var tips = [];                                // recent fingertips by position (the host re-ids a still finger every second)
      var lastTouch = -1e9, lastChange = 0, recent = [10], strikes = 0;
      var sig0 = null, sig1 = null;                 // a symbol in the old / new figure's place: {tex, idx, cx, cy, t0} (plate units), or null
      var sigils = 0, idleStrikes = 0;

      function strike(x, y, need3, gentle) {
        fam0 = fam1; mix0 = mix1.slice(); sig0 = sig1; sig1 = null;
        fam1 = pick(need3, recent);
        recent.push(fam1.idx); if (recent.length > 4) recent.shift();
        ring = {x: 0.5 + (x - 0.5) * aspect, y: y, t0: tNow, speed: RING_SPEED * (gentle ? 0.6 : 1), kick: gentle ? 0.5 : 1, glow: gentle ? 0.5 : 1, done: false};
        lastChange = tNow; strikes++;
      }

      // ------------------------------------------------------------ symbols
      var PEN_BUF = new Float32Array(18);           // up to 6 pens: (x, y in plate units, brightness)
      function plan(idx) {                          // when each stroke is drawn: in the symbol's own order, staggered, each at pen speed
        var st = SYMBOLS[idx].make(), n = Math.min(st.length, MAX_STROKES), list = [], tEnd = 0, lens = [], total = 0, cum = 0, top = 1e9, bot = -1e9, i;
        for (i = 0; i < n; i++) {
          var k0 = st[i]; lens.push(SIGIL_SIZE * (k0[0] === 'c' ? 2 * Math.PI * k0[3] : Math.hypot(k0[3] - k0[1], k0[4] - k0[2]))); total += lens[i];
          var ys = k0[0] === 'c' ? [k0[2] - k0[3], k0[2] + k0[3]] : [k0[2], k0[4]];
          top = Math.min(top, ys[0], ys[1]); bot = Math.max(bot, ys[0], ys[1]);
        }
        for (i = 0; i < n; i++) {                   // a stroke starts when the strokes before it have had their share of the time (by length)
          var start = SIGIL_DRAW_DELAY + (total > 0 ? cum / total : 0) * SIGIL_DRAW_S * 0.75, dur = Math.max(0.3, Math.min(1.1, lens[i] / SIGIL_PEN_SPEED));
          list.push({k: st[i], start: start, dur: dur}); tEnd = Math.max(tEnd, start + dur); cum += lens[i];
        }
        return {list: list, tEnd: tEnd, top: SIGIL_SIZE * top, bot: SIGIL_SIZE * bot};
      }
      function drawSymbol(texIdx, sg, t) {           // the symbol's distance field as drawn by time t (s since the strike), at (sg.cx, sg.cy)
        var circ = [], lin = [], pens = [], cx = sg.cx, cy = sg.cy, S = SIGIL_SIZE;
        sg.plan.list.forEach(function(e) {
          var u = Math.max(0, Math.min(1, (t - e.start) / e.dur)), q = u * u * (3 - 2 * u), k = e.k;
          if (q <= 0) return;
          if (k[0] === 'c') {
            circ.push([cx + S * k[1], cy + S * k[2], S * k[3], q]);
            if (u < 1) pens.push([cx + S * (k[1] + k[3] * Math.sin(2 * Math.PI * q)), cy + S * (k[2] - k[3] * Math.cos(2 * Math.PI * q)), Math.sqrt(Math.sin(Math.PI * u)), e.start]);
          } else {
            var x1 = k[1] + (k[3] - k[1]) * q, y1 = k[2] + (k[4] - k[2]) * q;
            lin.push([cx + S * k[1], cy + S * k[2], cx + S * x1, cy + S * y1]);
            if (u < 1) pens.push([cx + S * x1, cy + S * y1, Math.sqrt(Math.sin(Math.PI * u)), e.start]);
          }
        });
        var buf = new Float32Array(MAX_STROKES * 4), n = 0;
        circ.concat(lin).forEach(function(v) { buf.set(v, n * 4); n++; });
        pens.sort(function(p1, p2) { return p2[3] - p1[3]; });
        PEN_BUF.fill(0);
        for (var j = 0; j < Math.min(6, pens.length); j++) PEN_BUF.set([pens[j][0], pens[j][1], pens[j][2]], j * 3);
        gl.bindVertexArray(vao); gl.disable(gl.BLEND);
        gl.useProgram(pSdf.p);
        gl.uniform4fv(pSdf.u.uS, buf); gl.uniform1i(pSdf.u.uNC, circ.length); gl.uniform1i(pSdf.u.uNL, lin.length);
        gl.uniform1f(pSdf.u.uX0, 0.5 - 0.5 * aspect); gl.uniform1f(pSdf.u.uXW, aspect);
        gl.bindFramebuffer(gl.FRAMEBUFFER, sigFb[texIdx]); gl.viewport(0, 0, SDF_W, SDF_H);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      function strikeSigil(xWin, yWin, idx) {        // the plate rings from (xWin, yWin) and the sand settles into a symbol
        if (curMode !== 'symbols') return;
        if (idx == null) {
          var pl = (curPlaylist && curPlaylist.length) ? curPlaylist : CAT.DEFAULT_PLAYLIST;
          var sid = pl[nextPlay % pl.length];
          nextPlay = (nextPlay + 1) % Math.max(1, pl.length);
          idx = -1;
          for (var si = 0; si < SYMBOLS.length; si++) if (SYMBOLS[si].id === sid) { idx = si; break; }
          if (idx < 0) idx = 0;
        }
        var tex = sig1 ? 1 - sig1.tex : (sig0 ? 1 - sig0.tex : 0);
        var ext = 0, st = SYMBOLS[idx].make();
        st.forEach(function(k) { ext = Math.max(ext, k[0] === 'c' ? Math.abs(k[1]) + k[3] : Math.max(Math.abs(k[1]), Math.abs(k[3]))); });
        var half = SIGIL_SIZE * ext + 0.02, x0 = 0.5 - 0.5 * aspect, cx = 0.5 + (xWin - 0.5) * aspect;
        cx = Math.max(x0 + half, Math.min(x0 + aspect - half, cx));
        fam0 = fam1; mix0 = mix1.slice(); sig0 = sig1;
        sig1 = {tex: tex, idx: idx, cx: cx, cy: 0.5, t0: tNow, plan: plan(idx), drawn: false};
        drawSymbol(tex, sig1, 0);
        ring = {x: 0.5 + (xWin - 0.5) * aspect, y: yWin, t0: tNow, speed: RING_SPEED, kick: 1, glow: 1, done: false};
        held = []; lastChange = tNow; strikes++; sigils++;
        kit.log('sigil: ' + SYMBOLS[idx].name);
      }
      function jolt(x, y) {                          // a tap while a symbol shows: the sand jumps, the symbol stays
        fam0 = fam1; mix0 = mix1.slice(); sig0 = sig1;
        ring = {x: 0.5 + (x - 0.5) * aspect, y: y, t0: tNow, speed: RING_SPEED, kick: 0.6, glow: 0.5, done: false};
      }
      // arms out, double tap: read from the every-frame fingertip stream (kit.fingers); thinned touches are the fallback
      var gs = {wide: false, lastEmpty: -1e9, tap1: null, fb: [], pairs: []};
      var one = {down: -1, most: 0, at: null}, cleared = 0;   // one contact: from the first fingertip down to the wall empty again
      function clearSigil(x, y) {                    // a one-hand tap: the symbol dissolves into a new figure, still under that finger
        held = [{x: x, y: y, tx: x, ty: y, t: tNow}]; lastTouch = tNow;
        strike(x, y, false, false); cleared++;
        kit.log('sigil dissolved by a one-hand tap');
      }
      window.__resonancesteadyClearSymbol = function () { if (sig1) clearSigil(0.5, 0.5); };
      function near(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]) < SIGIL_SAME; }
      function gestureFrame(nowMs) {
        if (curMode !== 'symbols') return;
        var fg = kit.fingers;
        if (!fg) return;
        var pts = (Date.now() - fg.t < 250 && fg.pts) ? fg.pts : [], L = null, R = null;
        if (!pts.length) gs.lastEmpty = nowMs;
        if (pts.length) { if (one.down < 0) { one.down = nowMs; one.most = 0; one.at = pts[0].slice(); } one.most = Math.max(one.most, pts.length); }
        else if (one.down >= 0) {
          if (SIGIL_TAP_CLEARS && curTap === 'clears' && sig1 && one.most === 1 && nowMs - one.down <= SIGIL_TAP_MS && tNow - sig1.t0 > SIGIL_CLEAR_AFTER_S) clearSigil(one.at[0], one.at[1]);
          one.down = -1;
        }
        for (var i = 0; i < pts.length; i++) { if (!L || pts[i][0] < L[0]) L = pts[i]; if (!R || pts[i][0] > R[0]) R = pts[i]; }
        var wide = pts.length >= 2 && R[0] - L[0] >= SIGIL_GAP;
        if (wide && !gs.wide) {                      // a wide pair just landed: both hands came down together?
          var together = nowMs - gs.lastEmpty <= SIGIL_PAIR_MS;
          if (together && gs.tap1 && gs.tap1.up && nowMs - gs.tap1.t <= SIGIL_DOUBLE_MS && near(L, gs.tap1.L) && near(R, gs.tap1.R)) {
            strikeSigil((L[0] + R[0]) / 2, (L[1] + R[1]) / 2); gs.tap1 = null;
          } else gs.tap1 = together ? {t: nowMs, L: L.slice(), R: R.slice(), up: false} : null;
        } else if (!wide && gs.wide && gs.tap1 && !gs.tap1.up) {   // the pair lifted: a tap if it was short
          if (nowMs - gs.tap1.t <= SIGIL_TAP_MS) gs.tap1.up = true; else gs.tap1 = null;
        }
        if (gs.tap1 && nowMs - gs.tap1.t > SIGIL_DOUBLE_MS) gs.tap1 = null;
        gs.wide = wide;
      }
      function gestureTouch(t) {                     // fallback without the fingertip stream: two wide reports together, twice
        if (curMode !== 'symbols') return false;
        if (kit.fingers) return false;
        var now = performance.now(), j;
        gs.fb.push({t: now, x: t.x, y: t.y});
        for (j = gs.fb.length - 1; j >= 0; j--) if (now - gs.fb[j].t > SIGIL_DOUBLE_MS) gs.fb.splice(j, 1);
        for (j = 0; j < gs.fb.length - 1; j++) {
          var o = gs.fb[j];
          if (now - o.t <= SIGIL_PAIR_MS && Math.abs(o.x - t.x) >= SIGIL_GAP) {
            var last = gs.pairs.length ? gs.pairs[gs.pairs.length - 1] : null;
            if (last && now - last.t < 200) return false;          // the same pair, reported again
            gs.pairs.push({t: now});
            if (gs.pairs.length >= 2 && now - gs.pairs[gs.pairs.length - 2].t <= SIGIL_DOUBLE_MS) {
              gs.pairs = []; gs.fb = []; strikeSigil((o.x + t.x) / 2, (o.y + t.y) / 2); return true;
            }
            return false;
          }
        }
        return false;
      }

      function onTouch(t) {
        lastTouch = tNow;
        if (gestureTouch(t)) return;
        if (sig1) {                                  // a symbol is showing: taps only make the sand jump
          var fresh = true;
          for (var q = 0; q < tips.length; q++) if (tNow - tips[q].t < 0.7 && Math.hypot(tips[q].x - t.x, tips[q].y - t.y) < SAME_TIP) { fresh = false; tips[q].t = tNow; }
          if (fresh) { tips.push({x: t.x, y: t.y, t: tNow, t0: tNow, moved: false, held: null}); if (tNow - ring.t0 > 0.5) jolt(t.x, t.y); }
          return;
        }
        var j, tip = null, bd = 1e9;
        for (j = tips.length - 1; j >= 0; j--) {
          var age = tNow - tips[j].t;
          if (age > PAIR_WINDOW_S) { tips.splice(j, 1); continue; }
          var d = Math.hypot(tips[j].x - t.x, tips[j].y - t.y);
          var reach = (tips[j].moved || tNow - tips[j].t0 < 0.6) ? Math.min(SAME_TIP_MAX, SAME_TIP + SAME_TIP_GROW * age) : SAME_TIP;
          if (d < reach && d < bd) { bd = d; tip = tips[j]; }
        }
        if (tip) {                                   // the same finger, still there or moving: its still point follows it
          if (bd > 0.02) tip.moved = true;
          tip.x = t.x; tip.y = t.y; tip.t = tNow;
          if (tip.held) { tip.held.tx = t.x; tip.held.ty = t.y; tip.held.t = tNow; }
          return;
        }
        tip = {x: t.x, y: t.y, t: tNow, t0: tNow, moved: false, held: {x: t.x, y: t.y, tx: t.x, ty: t.y, t: tNow}};
        var other = null, last = held.length ? held[held.length - 1] : null;
        for (j = 0; j < tips.length; j++) if (tips[j].held && tNow - tips[j].t < PAIR_WINDOW_S) other = tips[j];
        tips.push(tip);
        var canStrike = tNow - lastChange >= MIN_CHANGE_S;
        if (other) {                                 // a second finger: a figure that is still under both
          held = [other.held, tip.held];
          if (canStrike || fam1.terms.length < 3) strike(t.x, t.y, true, false);  // (a two-mode figure can't be still under two points)
          else { tip.held.x = other.held.x; tip.held.y = other.held.y; }   // the figure is still settling: it flows to meet the new finger
        } else {
          if (canStrike) strike(t.x, t.y, false, false);
          else if (last) { tip.held.x = last.x; tip.held.y = last.y; }     // too soon for a new note: the still point glides over
          held = [tip.held];
        }
      }

      // ------------------------------------------------------------ depth -> body field
      var Hinv = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), regOk = false, regCheckAt = 0;
      function updateRegistration() {
        // screen (0..1) -> Kinect (0..1) as a 3x3, rebuilt from four corners of kit.fromScreen (Heckbert's square-to-quad)
        var c0 = kit.fromScreen(0, 0), c1 = kit.fromScreen(1, 0), c2 = kit.fromScreen(1, 1), c3 = kit.fromScreen(0, 1);
        if (!c0 || !c1 || !c2 || !c3) { Hinv.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); regOk = false; return; }
        var x0 = c0[0] / 512, y0 = c0[1] / 424, x1 = c1[0] / 512, y1 = c1[1] / 424, x2 = c2[0] / 512, y2 = c2[1] / 424, x3 = c3[0] / 512, y3 = c3[1] / 424;
        var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
        var g = 0, h = 0, den = dx1 * dy2 - dx2 * dy1;
        if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { if (Math.abs(den) < 1e-12) return; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
        var a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
        Hinv.set([a, d, g, b, e, h, c, f, 1]);       // column-major
        regOk = true;
      }
      function blurPass(src, dst, horiz, r) {        // box blur, radius r cells
        var w = PW, hgt = PH, x, y, k, acc, n = 2 * r + 1;
        if (horiz) {
          for (y = 0; y < hgt; y++) {
            var row = y * w; acc = 0;
            for (k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))];
            for (x = 0; x < w; x++) { dst[row + x] = acc / n; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
          }
        } else {
          for (x = 0; x < w; x++) {
            acc = 0;
            for (k = -r; k <= r; k++) acc += src[Math.min(hgt - 1, Math.max(0, k)) * w + x];
            for (y = 0; y < hgt; y++) { dst[y * w + x] = acc / n; acc += src[Math.min(hgt - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x]; }
          }
        }
      }
      function growPass(src, dst, horiz) {           // grow by one cell (max of each cell and its two neighbours)
        var w = PW, hgt = PH, x, y, i;
        for (y = 0; y < hgt; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          dst[i] = horiz ? Math.max(src[i], x > 0 ? src[i - 1] : 0, x < w - 1 ? src[i + 1] : 0)
                         : Math.max(src[i], y > 0 ? src[i - w] : 0, y < hgt - 1 ? src[i + w] : 0);
        }
      }
      function updateBody(nowMs) {
        var dep = kit.depth();
        if (dep && dep.wall && dep.seq !== lastSeq) {
          var tb = performance.now();
          lastSeq = dep.seq; lastSeqAt = nowMs;
          var data = dep.data, wall = dep.wall, span = BODY_FAR_MM - BODY_NEAR_MM;
          for (var cy = 0; cy < PH; cy++) for (var cx = 0; cx < PW; cx++) {
            var sum = 0, cnt = 0;
            for (var yy = 0; yy < 4; yy++) {
              var base = (cy * 4 + yy) * 512 + cx * 4;
              for (var xx = 0; xx < 4; xx++) {
                var z = data[base + xx], wz = wall[base + xx];
                if (z > 0 && wz === wz) {
                  var dd = wz - z;
                  if (dd > BODY_MIN_MM) {
                    var wgt = Math.min(1, (dd - BODY_MIN_MM) / 80);
                    if (dd > BODY_NEAR_MM) wgt *= 1 - (1 - BODY_FAR_WEIGHT) * Math.min(1, (dd - BODY_NEAR_MM) / span);
                    sum += wgt; cnt++;
                  }
                }
              }
            }
            var ci = cy * PW + cx;
            proxW[ci] = cnt >= 6 ? sum / cnt : 0;       // a cell has to be mostly body (6 of 16 pixels): lone noisy pixels never count
            proxRaw[ci] = cnt >= 6 ? 1e6 : 0;
            maskRaw[ci] = cnt >= 6 ? 1 : 0;             // the blackout: anyone, at any distance from the wall
          }
          // how deep inside the silhouette each cell is (chamfer distance to the nearest non-body cell; off the image = outside)
          var x, y, i, dd2;
          for (y = 0; y < PH; y++) for (x = 0; x < PW; x++) {
            i = y * PW + x; if (!proxRaw[i]) continue;
            dd2 = Math.min(proxRaw[i], (x > 0 ? proxRaw[i - 1] : 0) + 1, (y > 0 ? proxRaw[i - PW] : 0) + 1,
                           (x > 0 && y > 0 ? proxRaw[i - PW - 1] : 0) + 1.414, (x < PW - 1 && y > 0 ? proxRaw[i - PW + 1] : 0) + 1.414);
            proxRaw[i] = dd2;
          }
          for (y = PH - 1; y >= 0; y--) for (x = PW - 1; x >= 0; x--) {
            i = y * PW + x; if (!proxRaw[i]) continue;
            dd2 = Math.min(proxRaw[i], (x < PW - 1 ? proxRaw[i + 1] : 0) + 1, (y < PH - 1 ? proxRaw[i + PW] : 0) + 1,
                           (x < PW - 1 && y < PH - 1 ? proxRaw[i + PW + 1] : 0) + 1.414, (x > 0 && y < PH - 1 ? proxRaw[i + PW - 1] : 0) + 1.414);
            proxRaw[i] = dd2;
          }
          for (i = 0; i < PW * PH; i++) proxRaw[i] = Math.min(1, proxRaw[i] / BODY_DEPTH_CELLS) * proxW[i];
          blurPass(proxRaw, proxTmp, true, 1); blurPass(proxTmp, proxRaw, false, 1);
          blurPass(proxRaw, proxTmp, true, 1); blurPass(proxTmp, proxRaw, false, 1);
          var peak = 0;
          for (var i2 = 0; i2 < PW * PH; i2++) {
            var cxx = i2 % PW, cyy = (i2 / PW) | 0;
            var val = (cxx === 0 || cyy === 0 || cxx === PW - 1 || cyy === PH - 1) ? 0 : proxRaw[i2];
            proxSm[i2] += (val - proxSm[i2]) * 0.6;
            if (proxSm[i2] > peak) peak = proxSm[i2];
          }
          proxPeak = peak; proxLive = peak > 0.01;
          gl.bindTexture(gl.TEXTURE_2D, proxTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RED, gl.FLOAT, proxSm);
          if (BODY_BLACKOUT > 0) {
            for (var g2 = 0; g2 < BLACKOUT_GROW[curMargin]; g2++) { growPass(maskRaw, maskTmp, true); growPass(maskTmp, maskRaw, false); }
            for (var s2 = 0; s2 < BLACKOUT_SOFT; s2++) { blurPass(maskRaw, maskTmp, true, 1); blurPass(maskTmp, maskRaw, false, 1); }
            var mp = 0;
            for (var i4 = 0; i4 < PW * PH; i4++) {      // dark at once when someone arrives, light back over ~0.1 s when they go
              maskSm[i4] = maskRaw[i4] > maskSm[i4] ? maskRaw[i4] : maskSm[i4] + (maskRaw[i4] - maskSm[i4]) * 0.35;
              if (maskSm[i4] > mp) mp = maskSm[i4];
            }
            maskPeak = mp;
            gl.bindTexture(gl.TEXTURE_2D, maskTex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RED, gl.FLOAT, maskSm);
          }
          bodyMs = performance.now() - tb;
        } else if ((proxLive || maskPeak > 0) && nowMs - lastSeqAt > BODY_STALE_MS) {   // the depth stream went quiet: let go of the last body
          var pk = 0;
          for (var i3 = 0; i3 < PW * PH; i3++) { proxSm[i3] *= 0.92; if (proxSm[i3] > pk) pk = proxSm[i3]; }
          proxPeak = pk; proxLive = pk > 0.01;
          gl.bindTexture(gl.TEXTURE_2D, proxTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RED, gl.FLOAT, proxSm);
          var mk = 0;
          for (var i5 = 0; i5 < PW * PH; i5++) { maskSm[i5] *= 0.85; if (maskSm[i5] > mk) mk = maskSm[i5]; }
          maskPeak = mk < 0.01 ? 0 : mk;
          if (!maskPeak) maskSm.fill(0);
          gl.bindTexture(gl.TEXTURE_2D, maskTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RED, gl.FLOAT, maskSm);
        }
      }

      kit.wantDepth(true);
      var frameNo = 0;


      var settings = {sensitivity: 1, bass: 1, morph: 1, shimmer: 1, hue: 0};
      var music = {raw: [0,0,0], smooth: [0,0,0], last: -1e9, packets: 0, pulse: 0,
        slowBass: 0, fastBass: 0, lastBeat: -1e9, beats: 0, armed: true, morphClock: 0, phrase: 0,
        connected: false, reconnects: 0, source: 'music', state: 'connecting', fresh:false};
      var socket = null, reconnect = null, connectTimer = null, disposed = false;
      var steadyTracker = createResonanceSteadyTracker({width:canvas.width,height:canvas.height});
      var steadyFrame = steadyTracker.snapshot();
      var fingerPresent = false;
      var hud = document.createElement('div');
      hud.setAttribute('data-resonancesteady-status', '');
      hud.style.cssText = 'position:fixed;left:24px;bottom:18px;z-index:31;pointer-events:none;color:#b6a98d;font:12px system-ui,sans-serif;letter-spacing:0.08em;opacity:0.7';
      document.body.appendChild(hud);
      var hudText = '', hudAt = -1e9;
      function bound(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      function ingest(data, now, source) {
        if (disposed || !data || data.event_type !== 'graph_update' || data.graph_id !== 'melbank_2') return false;
        var values = data.melbank, frequencies = data.frequencies;
        if (!Array.isArray(values) || !Array.isArray(frequencies) || values.length !== frequencies.length || values.length < 3 || values.length > 512) return false;
        var sums = [0,0,0], counts = [0,0,0];
        for (var i=0;i<values.length;i++) {
          var value=values[i], frequency=frequencies[i];
          if (!Number.isFinite(value) || !Number.isFinite(frequency) || frequency < 20 || frequency > 20000) continue;
          var band=frequency<250?0:frequency<2000?1:2;
          value=bound(value,0,1); sums[band]+=value*value; counts[band]++;
        }
        if (counts.some(function(n){return n===0;})) return false;
        for (var j=0;j<3;j++) music.raw[j]=Math.sqrt(sums[j]/counts[j]);
        music.last=now; music.packets++; music.source=source||'music';
        return true;
      }
      function connectMusic() {}
      function scheduleReconnect() {}
      function fingerStep(dt){
        steadyFrame = steadyTracker.update(kit.fingers,Date.now(),dt);
        if (!steadyFrame.established) return; // host callbacks are the fallback only before this stream exists
        fingerPresent = steadyFrame.active.length > 0;
        held = steadyFrame.active.map(function(p){return {x:p.x,y:p.y,tx:p.raw[0],ty:p.raw[1],t:tNow,id:p.id};});
        tips = steadyFrame.active.map(function(p){return {x:p.x,y:p.y,t:tNow,id:p.id};});
        if (fingerPresent) lastTouch = tNow;
        if (steadyFrame.started.length) {
          var point = steadyFrame.active.find(function(p){return steadyFrame.started.indexOf(p.id) >= 0;});
          if (point && (tNow-lastChange >= MIN_CHANGE_S || (held.length > 1 && fam1.terms.length < 3)))
            strike(point.x,point.y,held.length>1,false);
        }
      }
      // A bounded visual envelope reaches the existing sand passes before the unchanged people mask.
      // The kick is independent of the zero-valued nodal field, so settled bright lines answer bass too.
      function musicVisual(){
        var bassDrive=bound(settings.bass*(0.75*music.smooth[0]+0.50*music.pulse),0,1.8);
        var highDrive=bound(settings.shimmer*music.smooth[2],0,2);
        return {
          shake:Math.min(5.6,0.14+settings.bass*(music.smooth[0]*2.8+music.pulse*1.6)),
          thermal:0.025+highDrive*0.18,
          brightness:1+Math.min(0.9,0.70*bassDrive+0.18*highDrive),
          grainLift:Math.min(0.8,0.55*bassDrive+0.10*highDrive),
          grainScale:1+Math.min(0.14,0.08*bassDrive+0.025*highDrive),
          kick:Math.min(0.45,settings.bass*(0.10*music.smooth[0]+0.22*music.pulse)),
          phaseRate:music.fresh&&music.smooth[1]>0.02?settings.morph*(0.60+music.smooth[1]):0
        };
      }
      function musicStep(dt,now){
        if (window.WallMusic) {
          var shared = kit.music();
          music.raw = shared.raw.map(function(v){return shared.enabled ? v * shared.amount : 0;});
          music.last = shared.enabled && shared.fresh ? performance.now() : -1e9;
          music.connected = shared.connected;
          music.source = shared.source;
          music.packets = shared.packets;
        }
        // rAF timestamps can precede a packet received during this frame. Use the receiving clock.
        var fresh=Math.max(0,performance.now()-music.last)<600;
        music.fresh=fresh;
        // The observed room feed has lower bass/high magnitudes than mids. Smooth compression
        // preserves louder differences instead of clipping them at the first strong beat.
        var bandGain=[5,2,6];
        var targets=music.raw.map(function(v,i){return fresh?1-Math.exp(-Math.max(0,v-0.015)*settings.sensitivity*bandGain[i]):0;});
        for(var i=0;i<3;i++){
          var rate=targets[i]>music.smooth[i]?0.025:0.18;
          music.smooth[i]+=(targets[i]-music.smooth[i])*(1-Math.exp(-dt/rate));
        }
        music.fastBass+=(targets[0]-music.fastBass)*(1-Math.exp(-dt/0.025));
        music.slowBass+=(targets[0]-music.slowBass)*(1-Math.exp(-dt/0.65));
        music.pulse*=Math.exp(-dt/0.20);
        var onset=music.fastBass-music.slowBass;
        if(onset<0.045)music.armed=true;
        if(fresh&&music.armed&&onset>0.12&&tNow-music.lastBeat>0.26){
          music.armed=false;music.lastBeat=tNow;music.beats++;music.pulse=1;
        }
        var visual=musicVisual();
        // MORPH_SPEED converts this clock to radians. The default base cycle is about 4-10 s;
        // wrap at a common period of all (1+0.41*j) harmonics to keep long sessions finite.
        music.morphClock=(music.morphClock+dt*visual.phaseRate/MORPH_SPEED)%(200*Math.PI/MORPH_SPEED);
        music.phrase+=fresh?dt*music.smooth[1]:0;
        if(fresh&&settings.morph>0&&music.phrase>6.5/Math.max(0.25,settings.morph)&&music.pulse>0.7&&tNow-lastTouch>1.5&&ring.done){
          held=[];strike(0.5,0.5,false,true);music.phrase=0;
        }
        var energy=Math.max.apply(Math,music.smooth);
        music.state=fresh?(energy>0.035?'live':'quiet'):(music.connected?'waiting':music.packets>0||music.reconnects?'unavailable':'connecting');
        if(now-hudAt>200){
          hudAt=now;
          var label=music.source==='test'?'Preview signal':music.state==='live'?'Listening to music':music.state==='quiet'?'Music quiet':music.state==='connecting'?'Connecting to music':music.state==='waiting'?'Waiting for music':'Music connection lost';
          if(label!==hudText){hudText=label;hud.textContent='RESONANCE STEADY  /  '+label;}
        }
      }
      function musicDestroy(){
        disposed=true;clearTimeout(reconnect);clearTimeout(connectTimer);reconnect=null;connectTimer=null;
        if(socket){var old=socket;socket=null;old.onopen=old.onclose=old.onmessage=old.onerror=null;try{old.close();}catch(e){}}
        music.connected=false;
        if(hud.parentNode)hud.parentNode.removeChild(hud);
      }
      function debug(){
        return {grains:N,frames:frameNo,settings:Object.assign({},settings),held:held.length,tips:tips.length,body:proxLive,
          mode:curMode,family:fam1.idx,familyTerms:fam1.terms.length,mix:mix1.slice(),ring:!ring.done,strikes:strikes,tracking:steadyTracker.snapshot(),
          effective:musicVisual(),
          music:{state:music.state,connected:music.connected,source:music.source,packets:music.packets,ageMs:Math.round(performance.now()-music.last),
            bands:music.raw.slice(),smooth:music.smooth.slice(),pulse:music.pulse,beats:music.beats,morphClock:music.morphClock,reconnects:music.reconnects},
          socketOpen:!!socket,disposed:disposed};
      }
      // The harness is opt-in and exists only in private test pages. It never opens the room feed by default.
      var test=window.WallTest?{
        createTracker:createResonanceSteadyTracker,
        inject:function(data){return ingest(data,performance.now(),'test');},
        expire:function(){music.last=performance.now()-1000;},
        disconnect:function(){if(socket)socket.close();},
        startMusic:connectMusic,
        grainSample:function(){var values=new Float32Array(64*4);gl.bindFramebuffer(gl.FRAMEBUFFER,stFb[cur]);gl.readPixels(0,0,64,1,gl.RGBA,gl.FLOAT,values);gl.bindFramebuffer(gl.FRAMEBUFFER,null);return Array.from(values);}
      }:null;
      if(!window.WallTest)connectMusic();

      function draw(dt, nowMs) {
        dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.05, dt)) : 0;
        tNow += dt;
        frameNo++;
        musicStep(dt, nowMs);
        fingerStep(dt);
        if (nowMs - regCheckAt > 2000 || (!regOk && nowMs - regCheckAt > 250)) { regCheckAt = nowMs; updateRegistration(); }
        updateBody(nowMs);

        // The continuous tracker already applied its one adaptive render filter.
        // Before any continuous stream, legacy direct touch input keeps a light fallback glide.
        if (!steadyFrame.established) {
          var a = 1 - Math.exp(-dt / 0.09);
          for (var j = 0; j < held.length; j++) { held[j].x += (held[j].tx - held[j].x) * a; held[j].y += (held[j].ty - held[j].y) * a; }
        }

        gestureFrame(nowMs);
        if (sig1 && !sig1.drawn) {                    // the pen is still drawing the symbol
          var tt = tNow - sig1.t0;
          drawSymbol(sig1.tex, sig1, tt);
          if (tt > sig1.plan.tEnd) { sig1.drawn = true; PEN_BUF.fill(0); }
        } else PEN_BUF.fill(0);
        if (sig1 && tNow - sig1.t0 > SIGIL_HOLD_S) {   // the symbol has held long enough: the plate sings its own figures again
          held = []; lastTouch = Math.min(lastTouch, tNow - IDLE_AFTER_S + 4);
          strike(0.5 + (sig1.cx - 0.5) / aspect, sig1.cy, false, true);
        }
        // nobody touching for a while: the plate plays by itself
        if (false) {
          held = []; idleStrikes++;
          if (IDLE_SIGIL_EVERY > 0 && idleStrikes % IDLE_SIGIL_EVERY === 0) strikeSigil(0.5, 0.5);
          else strike(rnd(0.2, 0.8), rnd(0.2, 0.8), false, true);
        }

        mix1 = mixFor(fam1, held, music.morphClock);
        var age = tNow - ring.t0, R = age * ring.speed;
        var far = Math.max(Math.hypot(ring.x + 0.5 * (aspect - 1), ring.y), Math.hypot(ring.x - 0.5 - 0.5 * aspect, ring.y),
                           Math.hypot(ring.x + 0.5 * (aspect - 1), ring.y - 1), Math.hypot(ring.x - 0.5 - 0.5 * aspect, ring.y - 1));
        var RW = 0.07;
        if (!ring.done && R > far + 2 * RW) { ring.done = true; fam0 = fam1; sig0 = sig1; }

        var nm1 = packNM(fam1), nm0 = packNM(fam0);
        gl.bindVertexArray(vao);
        gl.disable(gl.BLEND);

        var musical=musicVisual();

        // 1. step the sand
        gl.useProgram(pStep.p);
        var u = pStep.u;
        gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uAspect, aspect);
        var room=kit.room?kit.room(dt):{motion:0};
        gl.uniform1f(u.uPull, PULL);
        gl.uniform1f(u.uShake, Math.min(5.6, musical.shake + room.motion * 1.6));
        gl.uniform1f(u.uThermal, musical.thermal); gl.uniform1f(u.uMusicKick, musical.kick);
        gl.uniform1f(u.uResp, RESPONSE);
        gl.uniform1f(u.uKick, ring.done ? 0 : RING_KICK * ring.kick); gl.uniform1f(u.uRingW, RW);
        gl.uniform1f(u.uBodyOn, proxLive ? 1 : 0); gl.uniform1f(u.uBodyPush, BODY_PUSH); gl.uniform1f(u.uBodyShake, BODY_SHAKE);
        gl.uniform1f(u.uHeal, frameNo > 30 ? (sig1 && ring.done ? SIGIL_HEAL : HEAL) : 0); gl.uniform1f(u.uDensLod, densLod); gl.uniform1f(u.uTopLod, topLod);
        gl.uniform1ui(u.uFrame, frameNo >>> 0);
        gl.uniform4fv(u.uN0, nm0[0]); gl.uniform4fv(u.uM0, nm0[1]); gl.uniform4fv(u.uC0, mix0);
        gl.uniform4fv(u.uN1, nm1[0]); gl.uniform4fv(u.uM1, nm1[1]); gl.uniform4fv(u.uC1, mix1);
        gl.uniform1f(u.uK0, fam0.k); gl.uniform1f(u.uK1, fam1.k);
        gl.uniform1f(u.uSig0, sig0 ? 1 : 0); gl.uniform1f(u.uSig1, sig1 ? 1 : 0); gl.uniform1f(u.uKS, SIGIL_SHARP);
        gl.uniform1f(u.uSigF, Math.sqrt(SIGIL_FLOW)); gl.uniform1f(u.uSigX0, 0.5 - 0.5 * aspect); gl.uniform1f(u.uSigXW, aspect);
        gl.uniform1f(u.uSigShakeMax, SIGIL_SHAKE_MAX); gl.uniform1f(u.uSigGrain, SIGIL_GRAIN); gl.uniform1f(u.uSigReach, SIGIL_REACH);
        gl.uniform3fv(u.uPen, PEN_BUF); gl.uniform1f(u.uPenSpark, SIGIL_PEN_SPARK);
        gl.uniform1f(u.uSigFar, sig1 ? Math.max(0.05, 1 - (tNow - sig1.t0) / SIGIL_SCATTER_S) : 1);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, sigTex[sig0 ? sig0.tex : 0]); gl.uniform1i(u.uSigT0, 3);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, sigTex[sig1 ? sig1.tex : 1]); gl.uniform1i(u.uSigT1, 4);
        gl.uniform3f(u.uRing, ring.x, ring.y, ring.done ? 1e3 : R);
        gl.uniformMatrix3fv(u.uHinv, false, Hinv);
        var tv = [0, 0, 0, 0], tn = 0;
        for (var ti = tips.length - 1; ti >= 0 && tn < 2; ti--) if (tNow - tips[ti].t < 2.0) { tv[tn * 2] = 0.5 + (tips[ti].x - 0.5) * aspect; tv[tn * 2 + 1] = tips[ti].y; tn++; }
        gl.uniform4fv(u.uTips, tv); gl.uniform1f(u.uTipN, tn); gl.uniform1f(u.uTipGuard, TIP_GUARD);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stTex[cur]); gl.uniform1i(u.uState, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, proxTex); gl.uniform1i(u.uProx, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(u.uDens, 2);
        gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[1 - cur]);
        gl.viewport(0, 0, GRAINS_W, GRAINS_H);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, null);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, null);
        cur = 1 - cur;

        // 2. lay the grains down as light
        gl.bindFramebuffer(gl.FRAMEBUFFER, accFb);
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pDraw.p);
        gl.uniform1f(pDraw.u.uPt, GRAIN_PX * W / 1280); gl.uniform1f(pDraw.u.uSpeedK, 7.0);
        gl.uniform1f(pDraw.u.uMusicLift, musical.grainLift); gl.uniform1f(pDraw.u.uMusicSize, musical.grainScale);
        gl.uniform1f(pDraw.u.uAspect, aspect); gl.uniform1f(pDraw.u.uRingW, RW * 1.3);
        gl.uniform3f(pDraw.u.uRing, ring.x, ring.y, ring.done ? 1e3 : R);
        gl.uniform1f(pDraw.u.uLift, ring.done ? 0 : RING_LIFT * ring.kick * Math.exp(-age * 0.7));
        gl.uniform1f(pDraw.u.uSig1, sig1 ? 1 : 0); gl.uniform1f(pDraw.u.uSigX0, 0.5 - 0.5 * aspect); gl.uniform1f(pDraw.u.uSigXW, aspect);
        gl.uniform1f(pDraw.u.uSigReach, SIGIL_REACH); gl.uniform1f(pDraw.u.uDust, SIGIL_DUST);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, sigTex[sig1 ? sig1.tex : 1]); gl.uniform1i(pDraw.u.uSigT1, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sigTex[sig0 ? sig0.tex : 0]); gl.uniform1i(pDraw.u.uSigT0, 2);
        gl.uniform1f(pDraw.u.uSig0, sig0 ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stTex[cur]); gl.uniform1i(pDraw.u.uState, 0);
        gl.drawArrays(gl.POINTS, 0, N);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.generateMipmap(gl.TEXTURE_2D);

        // 3. glow: quarter size, blurred twice
        gl.useProgram(pDown.p);
        var tint = TINTS[curTint] || TINTS.original;
        var hm = hueMatrix(HUE);
        gl.uniform1f(pDown.u.uExposure, EXPOSURE*musical.brightness); gl.uniform3fv(pDown.u.uTE, tint[0]); gl.uniform3fv(pDown.u.uTG, tint[1]); gl.uniformMatrix3fv(pDown.u.uHueM, false, hm);
        gl.uniform2f(pDown.u.uTexel, 1 / W, 1 / H);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(pDown.u.uSrc, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[0]); gl.viewport(0, 0, GW, GH);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.useProgram(pBlur.p); gl.uniform1i(pBlur.u.uSrc, 0);
        for (var pass = 0; pass < 2; pass++) {
          gl.uniform2f(pBlur.u.uDir, (1 + pass) / GW, 0);
          gl.bindTexture(gl.TEXTURE_2D, glow[0]); gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[1]); gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.uniform2f(pBlur.u.uDir, 0, (1 + pass) / GH);
          gl.bindTexture(gl.TEXTURE_2D, glow[1]); gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[0]); gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        // 4. to the wall
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, W, H);
        gl.useProgram(pComp.p);
        gl.uniform1f(pComp.u.uExposure, EXPOSURE*musical.brightness); gl.uniform3fv(pComp.u.uTE, tint[0]); gl.uniform3fv(pComp.u.uTG, tint[1]); gl.uniformMatrix3fv(pComp.u.uHueM, false, hm);
        gl.uniform1f(pComp.u.uGlowAmt, BLOOM * (0.65 + settings.shimmer * music.smooth[2] * 1.5)); gl.uniform1f(pComp.u.uAspect, aspect);
        var since = sig1 && sig1.drawn ? tNow - sig1.t0 - sig1.plan.tEnd : -1;
        var fy = 0, band = 0, after = 0;
        if (since >= 0 && since < 4) {
          var y0 = sig1.cy + sig1.plan.top - 0.12, y1 = sig1.cy + sig1.plan.bot + 0.12;
          fy = y0 + since * SIGIL_FLASH_SPEED; band = fy < y1 ? SIGIL_FLASH : 0;
          after = SIGIL_FLASH * 0.35 * Math.min(1, since / 0.3) * Math.exp(-since * 1.2);
        }
        gl.uniform3fv(pComp.u.uPen, PEN_BUF); gl.uniform1f(pComp.u.uPenGlow, SIGIL_PEN_GLOW); gl.uniform3f(pComp.u.uFlash, band, fy, after);
        gl.uniform1f(pComp.u.uSigX0, 0.5 - 0.5 * aspect); gl.uniform1f(pComp.u.uSigXW, aspect);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, sigTex[sig1 ? sig1.tex : 0]); gl.uniform1i(pComp.u.uSigT, 2);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(pComp.u.uMask, 3);
        gl.uniformMatrix3fv(pComp.u.uHinv, false, Hinv); gl.uniform1f(pComp.u.uBlackout, maskPeak > 0 && regOk && curPeople === 'dark' ? BODY_BLACKOUT : 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform4f(pComp.u.uRingVis, ring.x, ring.y, R, ring.done ? 0 : RING_GLOW * ring.glow * Math.exp(-age * 1.4));
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(pComp.u.uAccum, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, glow[0]); gl.uniform1i(pComp.u.uGlow, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
      }

      function set(opts) {
        if(opts&&typeof opts==='object'){
          var ranges={sensitivity:[0.25,3],bass:[0,2],morph:[0,2],shimmer:[0,2],hue:[0,360]};
          Object.keys(ranges).forEach(function(k){if(Number.isFinite(opts[k]))settings[k]=bound(opts[k],ranges[k][0],ranges[k][1]);});
          HUE=settings.hue;
        }
        return Object.assign({},settings);
      }
      window.ResonancesteadySet=set;
      if(window._resonancesteadyFx)set(window._resonancesteadyFx);

      return {
        frame: function(dt, now) { draw(dt, now); },
        debug: debug,
        test: test,
        touch: function(t) {
          // The host has no mouse/Kinect provenance at this boundary. Once its continuous
          // stream exists it owns input, including empty/stale: sparse callbacks cannot resurrect it.
          if (kit.fingers !== null && kit.fingers !== undefined || steadyTracker.snapshot().established) return;
          if(t && Number.isFinite(t.x) && Number.isFinite(t.y) && t.x>=0 && t.x<=1 && t.y>=0 && t.y<=1) onTouch(t);
        },
        resize: function(w, h) { sizeBuffers(w, h); },
        destroy: function() {
          musicDestroy();
          steadyTracker.reset();
          if(window.ResonancesteadySet===set)delete window.ResonancesteadySet;
          try { delete window.__resonancesteadyClearSymbol; } catch (e) { window.__resonancesteadyClearSymbol = undefined; }
          kit.wantDepth(false);
          try {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            made.fb.forEach(function(f) { gl.deleteFramebuffer(f); });
            made.tex.forEach(function(t) { gl.deleteTexture(t); });
            made.prog.forEach(function(p) { gl.deleteProgram(p); });
            gl.deleteVertexArray(vao);
          } catch (e) {}
          made = {tex: [], fb: [], prog: []};
          proxRaw = proxTmp = proxSm = proxW = maskRaw = maskTmp = maskSm = null; tips = []; held = [];
          ['__resonancesteadyDebug', '__resonancesteadyPlateDebug', '__resonancesteadyShow'].forEach(function(k) { if (window[k]) try { delete window[k]; } catch (e) { window[k] = undefined; } });
        }
      };
    }
  });
})();
