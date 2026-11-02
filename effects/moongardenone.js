/*
 * Moon Garden 1 — the FIRST Moon Garden (kinect-live 54bf576, 2026-10-04 12:42), brought back next to the current Moon Garden
 * (Moon Garden 2, plugins/moongarden.js) so Billy can tune both (2026-10-06). Only its id, title and test hook name changed.
 *
 * Moon Garden — a living field of silver leaves and pale night flowers.
 * Created by Codex, using the touch/body interaction engine from Opus 5.5's
 * Chladni (plugins/opus.js). That original piece is kept intact.
 *
 * Touch: an opening wave travels from the finger and the foliage finds a new
 * arrangement through that point. Drag: the living branches bend after you.
 * Two fingers: the arrangement passes through both. Stand close: leaves part
 * around the depth silhouette and gradually repopulate after you step away.
 * Idle: slow changes in the garden, with a soft opening wave every ~25 s.
 *
 * Same contact handling, two-point constraint solve, body thresholds, fingertip
 * protection, settling and recovery as Chladni. Rendering uses 7,680 individual
 * leaf/flower sprites, visible veins, field-aligned leaves and mint/silver light.
 * No audio, external images, network requests or extra live depth connection.
 * The host supplies the existing depth stream and calibration through kit.
 */
(function() {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  var GRAINS_W = 96, GRAINS_H = 80;     // grain count = W x H (7,680 leaves and flowers)
  var GRAIN_PX = 17.0;                     // leaf sprite diameter at a 1280-wide picture
  var PULL = 5.0;                         // how hard the sand is drawn onto the still lines
  var SHAKE = 1.4;                        // how hard the singing parts of the plate throw the sand about
  var THERMAL = 0.10;                     // a little jitter everywhere: the softness and shimmer of the lines
  var RESPONSE = 9.0;                     // how quickly grains pick up the plate's pull (1/s); lower = more flowing, lazier
  var RING_SPEED = 1.1;                   // how fast a new figure spreads from a touch (plate heights per second)
  var RING_KICK = 2.6;                    // how high the sand leaps as that ripple passes
  var RING_GLOW = 0.10;                   // brightness of the faint ripple of light that carries a new figure (0 = none)
  var RING_LIFT = 1.6;                    // how much brighter the sand shines as the ripple lifts it
  var MORPH_SPEED = 0.045;                // how fast the figure drifts on its own (radians per second of the mode mix)
  var MORPH_RANGE = 0.40;                 // how far it drifts from the balanced mix (the classic figures); big = visits plain grids too
  var IDLE_AFTER_S = 12;                  // after this long without a touch the plate plays by itself...
  var IDLE_NEW_S = 25;                    // ...striking a new figure about this often
  var MIN_CHANGE_S = 1.6;                 // a new figure needs this long to settle; touches sooner just glide the still point over
  var GLIDE_S = 0.15;                     // how softly the still point follows a moving finger (time constant, s)
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
  var EXPOSURE = 0.90;                    // brightness of the sand
  var BLOOM = 0.18;                       // the glow around the lines
  var WARMTH = 0.0;                       // 1 = brass and candlelight; 0 = moonlit silver

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
    'uniform float uDt, uAspect, uPull, uShake, uThermal, uResp, uKick, uRingW, uBodyOn, uBodyPush, uBodyShake, uHeal, uDensLod, uTopLod;\n' +
    'uniform uint uFrame;\n' +
    'uniform vec4 uN0, uM0, uC0, uN1, uM1, uC1;\n' +
    'uniform float uK0, uK1;\n' +
    'uniform vec3 uRing;\n' +
    'uniform mat3 uHinv;\n' +
    'uniform vec4 uTips; uniform float uTipN, uTipGuard;\n' +
    'out vec4 o;\n' +
    'const float PI = 3.14159265;\n' + GLSL_HASH +
    'vec3 field(vec2 P, vec4 N, vec4 M, vec4 C) {\n' +
    '  vec4 ax = PI * N * P.x, ay = PI * M * P.y, cx = cos(ax), sx = sin(ax), cy = cos(ay), sy = sin(ay);\n' +
    '  return vec3(dot(C, cx * cy), -PI * dot(C * N, sx * cy), -PI * dot(C * M, cx * sy));\n' +
    '}\n' +
    'float prox(vec2 q) { vec3 h = uHinv * vec3(q, 1.0); return h.z > 0.0 ? texture(uProx, h.xy / h.z).r : 0.0; }\n' +
    'void main() {\n' +
    '  ivec2 ij = ivec2(gl_FragCoord.xy);\n' +
    '  vec4 s = texelFetch(uState, ij, 0);\n' +
    '  vec2 q = s.xy, v = s.zw;\n' +
    '  vec2 P = vec2(0.5 + (q.x - 0.5) * uAspect, q.y);\n' +
    '  vec3 f = field(P, uN1, uM1, uC1); float k = uK1, band = 0.0;\n' +
    '  if (uRing.z < 50.0) {\n' +
    '    vec3 f0 = field(P, uN0, uM0, uC0);\n' +
    '    float d = distance(P, uRing.xy), w = smoothstep(uRing.z + uRingW, uRing.z - uRingW, d);\n' +
    '    f = mix(f0, f, w); k = mix(uK0, uK1, w);\n' +
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
    '  float sigma = (uShake * abs(f.x) + uThermal + uKick * band) / k + uBodyShake * smoothstep(0.0, 0.3, Q) * 0.02;\n' +
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
  var VS_DRAW = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uState;
uniform float uPt, uSpeedK, uAspect, uRingW, uLift, uTime;
uniform vec3 uRing;
uniform vec4 uN, uM, uC;
out vec2 vC, vRot;
out float vSeed;
uint hsh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float u01(uint x) { return float(hsh(x) >> 8) * (1.0 / 16777216.0); }
void main() {
  int i = gl_VertexID;
  vec4 s = texelFetch(uState, ivec2(i % ${GRAINS_W}, i / ${GRAINS_W}), 0);
  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0);
  float h = u01(uint(i) * 2654435761u);
  vec2 P = vec2(0.5 + (s.x - 0.5) * uAspect, s.y);
  vec4 ax = 3.14159265 * uN * P.x, ay = 3.14159265 * uM * P.y;
  vec2 g = vec2(-dot(uC * uN, sin(ax) * cos(ay)), -dot(uC * uM, cos(ax) * sin(ay)));
  float angle = atan(g.y, g.x + 0.00001) + (h - 0.5) * 1.3 + 0.10 * sin(uTime * 1.1 + h * 40.0);
  vRot = vec2(cos(angle), sin(angle));
  vSeed = h;
  gl_PointSize = max(2.0, uPt * (0.55 + 0.8 * h * h));
  float x = (distance(P, uRing.xy) - uRing.z) / uRingW;
  vC = vec2((0.65 + 0.6 * h) * (1.0 + uLift * exp(-x * x)), clamp(length(s.zw) * uSpeedK, 0.0, 1.0));
}
`;

  var FS_DRAW = `#version 300 es
precision highp float;
in vec2 vC, vRot;
in float vSeed;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p = vec2(dot(p, vRot), dot(p, vec2(-vRot.y, vRot.x)));
  float aa = max(fwidth(p.x), fwidth(p.y));
  float edge = abs(p.x) - 0.40 * max(0.0, 1.0 - p.y * p.y);
  float mask = (1.0 - smoothstep(-aa, aa, edge)) * (1.0 - smoothstep(0.92, 1.0, abs(p.y)));
  float midrib = exp(-abs(p.x) * 42.0);
  float ribs = pow(max(0.0, cos(34.0 * p.y - 19.0 * abs(p.x))), 18.0) * 0.27;
  float vein = clamp(midrib * 0.55 + ribs, 0.0, 1.0);
  if (vSeed > 0.965) {
    float a = atan(p.y, p.x), radius = 0.53 + 0.22 * cos(a * 5.0 + vSeed * 6.28);
    mask = 1.0 - smoothstep(radius - aa, radius + aa, length(p));
    vein = 0.82 + 0.18 * exp(-dot(p,p) * 35.0);
  }
  if (mask < 0.002) discard;
  float light = mask * vC.x * (0.55 + 0.45 * vein);
  o = vec4(light, light * vC.y, light * vSeed, light * vein);
}
`;

  var GLSL_PAL = `uniform float uExposure, uWarm;
vec3 leafColor(vec4 a) {
  float L = 1.0 - exp(-a.r * uExposure);
  float moving = clamp(a.g / (a.r + 0.0001), 0.0, 1.0);
  float seed = clamp(a.b / (a.r + 0.0001), 0.0, 1.0);
  float vein = clamp(a.a / (a.r + 0.0001), 0.0, 1.0);
  vec3 emerald = mix(vec3(0.07, 0.38, 0.27), vec3(0.51, 0.77, 0.67), seed);
  vec3 moon = mix(vec3(0.75, 0.93, 0.94), vec3(0.93, 0.88, 1.0), seed);
  vec3 colour = mix(emerald, moon, clamp(vein * 0.75 + moving * 0.7, 0.0, 1.0));
  return mix(colour, vec3(0.95,0.84,0.65), uWarm) * L;
}
`;

  // quarter-size copy of the lit sand for the glow
  var FS_DOWN =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uSrc; uniform vec2 uTexel;\n' +
    'in vec2 vUv; out vec4 o;\n' + GLSL_PAL +
    'void main() {\n' +
    '  vec4 a = textureLod(uSrc, vUv + uTexel * vec2(-1.0, -1.0), 0.0) + textureLod(uSrc, vUv + uTexel * vec2(1.0, -1.0), 0.0)\n' +
    '         + textureLod(uSrc, vUv + uTexel * vec2(-1.0, 1.0), 0.0) + textureLod(uSrc, vUv + uTexel * vec2(1.0, 1.0), 0.0);\n' +
    '  o = vec4(leafColor(a * 0.25), 1.0);\n' +
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
    'in vec2 vUv; out vec4 o;\n' + GLSL_PAL +
    'void main() {\n' +
    '  vec3 col = leafColor(textureLod(uAccum, vUv, 0.0)) + texture(uGlow, vUv).rgb * uGlowAmt;\n' +
    '  if (uRingVis.w > 0.002) {\n' +
    '    vec2 P = vec2(0.5 + (vUv.x - 0.5) * uAspect, 1.0 - vUv.y);\n' +
    '    float x = (distance(P, uRingVis.xy) - uRingVis.z) / 0.014;\n' +
    '    col += mix(vec3(0.55, 0.7, 1.0), vec3(1.0, 0.78, 0.48), uWarm) * exp(-x * x) * uRingVis.w;\n' +
    '  }\n' +
    '  o = vec4(col, 1.0);\n' +
    '}\n';

  function rnd(a, b) { return a + Math.random() * (b - a); }

  registerWallPlugin({
    id: 'moongardenone',
    title: 'Moon Garden 1',
    author: 'Codex; interaction engine by Opus 5.5',
    create: function(canvas, kit) {
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
          pBlur = program(VS_TRI, FS_BLUR), pComp = program(VS_TRI, FS_COMP);

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
      function pick(need3, avoid) {
        var ok = [];
        for (var j = 0; j < FAMILIES.length; j++) if ((!need3 || FAMILIES[j].length >= 3) && avoid.indexOf(j) < 0) ok.push(j);
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

      function strike(x, y, need3, gentle) {
        fam0 = fam1; mix0 = mix1.slice();
        fam1 = pick(need3, recent);
        recent.push(fam1.idx); if (recent.length > 4) recent.shift();
        ring = {x: 0.5 + (x - 0.5) * aspect, y: y, t0: tNow, speed: RING_SPEED * (gentle ? 0.6 : 1), kick: gentle ? 0.5 : 1, glow: gentle ? 0.5 : 1, done: false};
        lastChange = tNow; strikes++;
      }

      function onTouch(t) {
        lastTouch = tNow;
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
          bodyMs = performance.now() - tb;
        } else if (proxLive && nowMs - lastSeqAt > BODY_STALE_MS) {   // the depth stream went quiet: let go of the last body
          var pk = 0;
          for (var i3 = 0; i3 < PW * PH; i3++) { proxSm[i3] *= 0.92; if (proxSm[i3] > pk) pk = proxSm[i3]; }
          proxPeak = pk; proxLive = pk > 0.01;
          gl.bindTexture(gl.TEXTURE_2D, proxTex);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RED, gl.FLOAT, proxSm);
        }
      }

      kit.wantDepth(true);
      var frameNo = 0;

      function draw(dt, nowMs) {
        tNow += dt;
        frameNo++;
        if (nowMs - regCheckAt > 2000 || (!regOk && nowMs - regCheckAt > 250)) { regCheckAt = nowMs; updateRegistration(); }
        updateBody(nowMs);

        // the still points glide after their fingers; fingers gone quiet leave their points where they were
        var a = 1 - Math.exp(-dt / GLIDE_S);
        for (var j = 0; j < held.length; j++) { held[j].x += (held[j].tx - held[j].x) * a; held[j].y += (held[j].ty - held[j].y) * a; }

        // nobody touching for a while: the plate plays by itself
        if (tNow - lastTouch > IDLE_AFTER_S && tNow - lastChange > IDLE_NEW_S) {
          held = [];
          strike(rnd(0.2, 0.8), rnd(0.2, 0.8), false, true);
        }

        mix1 = mixFor(fam1, held, tNow);
        var age = tNow - ring.t0, R = age * ring.speed;
        var far = Math.max(Math.hypot(ring.x + 0.5 * (aspect - 1), ring.y), Math.hypot(ring.x - 0.5 - 0.5 * aspect, ring.y),
                           Math.hypot(ring.x + 0.5 * (aspect - 1), ring.y - 1), Math.hypot(ring.x - 0.5 - 0.5 * aspect, ring.y - 1));
        var RW = 0.07;
        if (!ring.done && R > far + 2 * RW) { ring.done = true; fam0 = fam1; }

        var nm1 = packNM(fam1), nm0 = packNM(fam0);
        gl.bindVertexArray(vao);
        gl.disable(gl.BLEND);

        // 1. step the sand
        gl.useProgram(pStep.p);
        var u = pStep.u;
        gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uAspect, aspect);
        gl.uniform1f(u.uPull, PULL); gl.uniform1f(u.uShake, SHAKE); gl.uniform1f(u.uThermal, THERMAL); gl.uniform1f(u.uResp, RESPONSE);
        gl.uniform1f(u.uKick, ring.done ? 0 : RING_KICK * ring.kick); gl.uniform1f(u.uRingW, RW);
        gl.uniform1f(u.uBodyOn, proxLive ? 1 : 0); gl.uniform1f(u.uBodyPush, BODY_PUSH); gl.uniform1f(u.uBodyShake, BODY_SHAKE);
        gl.uniform1f(u.uHeal, frameNo > 30 ? HEAL : 0); gl.uniform1f(u.uDensLod, densLod); gl.uniform1f(u.uTopLod, topLod);
        gl.uniform1ui(u.uFrame, frameNo >>> 0);
        gl.uniform4fv(u.uN0, nm0[0]); gl.uniform4fv(u.uM0, nm0[1]); gl.uniform4fv(u.uC0, mix0);
        gl.uniform4fv(u.uN1, nm1[0]); gl.uniform4fv(u.uM1, nm1[1]); gl.uniform4fv(u.uC1, mix1);
        gl.uniform1f(u.uK0, fam0.k); gl.uniform1f(u.uK1, fam1.k);
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
        cur = 1 - cur;

        // 2. lay the grains down as light
        gl.bindFramebuffer(gl.FRAMEBUFFER, accFb);
        gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pDraw.p);
        gl.uniform4fv(pDraw.u.uN, nm1[0]); gl.uniform4fv(pDraw.u.uM, nm1[1]); gl.uniform4fv(pDraw.u.uC, mix1);
        gl.uniform1f(pDraw.u.uTime, tNow);
        gl.uniform1f(pDraw.u.uPt, GRAIN_PX * W / 1280); gl.uniform1f(pDraw.u.uSpeedK, 7.0);
        gl.uniform1f(pDraw.u.uAspect, aspect); gl.uniform1f(pDraw.u.uRingW, RW * 1.3);
        gl.uniform3f(pDraw.u.uRing, ring.x, ring.y, ring.done ? 1e3 : R);
        gl.uniform1f(pDraw.u.uLift, ring.done ? 0 : RING_LIFT * ring.kick * Math.exp(-age * 0.7));
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stTex[cur]); gl.uniform1i(pDraw.u.uState, 0);
        gl.drawArrays(gl.POINTS, 0, N);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.generateMipmap(gl.TEXTURE_2D);

        // 3. glow: quarter size, blurred twice
        gl.useProgram(pDown.p);
        gl.uniform1f(pDown.u.uExposure, EXPOSURE); gl.uniform1f(pDown.u.uWarm, WARMTH);
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
        gl.uniform1f(pComp.u.uExposure, EXPOSURE); gl.uniform1f(pComp.u.uWarm, WARMTH);
        gl.uniform1f(pComp.u.uGlowAmt, BLOOM); gl.uniform1f(pComp.u.uAspect, aspect);
        gl.uniform4f(pComp.u.uRingVis, ring.x, ring.y, R, ring.done ? 0 : RING_GLOW * ring.glow * Math.exp(-age * 1.4));
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(pComp.u.uAccum, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, glow[0]); gl.uniform1i(pComp.u.uGlow, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.activeTexture(gl.TEXTURE0);
      }

      if (window.WallTest) window.__moonGardenOneDebug = function() {     // sandbox only (the live wall has no WallTest)
        return {family: fam1.terms, mix: mix1.map(function(x) { return +x.toFixed(3); }), held: held.length, tips: tips.length, ring: !ring.done,
                body: proxLive, bodyPeak: +proxPeak.toFixed(3), reg: regOk, t: +tNow.toFixed(1), strikes: strikes, bodyMs: +bodyMs.toFixed(2),
                phiAtHeld: held.map(function(p) { return +dot(terms(fam1, p.x, p.y), mix1.slice(0, fam1.terms.length)).toFixed(4); }),
                phiRandom: +dot(terms(fam1, Math.random(), Math.random()), mix1.slice(0, fam1.terms.length)).toFixed(4),
                regCheck: [[0.3, 0.7], [0.8, 0.2], [0.05, 0.95]].map(function(p) {
                  var h = [Hinv[0] * p[0] + Hinv[3] * p[1] + Hinv[6], Hinv[1] * p[0] + Hinv[4] * p[1] + Hinv[7], Hinv[2] * p[0] + Hinv[5] * p[1] + Hinv[8]];
                  var k = kit.fromScreen(p[0], p[1]);
                  return k ? [+(h[0] / h[2] * 512 - k[0]).toFixed(3), +(h[1] / h[2] * 424 - k[1]).toFixed(3)] : null;
                })};
      };

    function set(opts) {
      if (!opts) return {pull: PULL, shake: SHAKE};
      if (Number.isFinite(opts.pull)) PULL = Math.max(1, Math.min(12, opts.pull));
      if (Number.isFinite(opts.shake)) SHAKE = Math.max(0.3, Math.min(4, opts.shake));
      return {pull: PULL, shake: SHAKE};
    }
    function wake(sx, sy, radius, strength) {
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
      try {
        if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
        else if (typeof onTouch === 'function') onTouch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
      } catch (e) {}
    }
    window.MoongardenoneSet = set;
    window.MoongardenoneWake = wake;
    if (window._moongardenoneFx) set(window._moongardenoneFx);

      return {
        frame: function(dt, now) { draw(dt, now); },
        touch: function(t) { onTouch(t); },
        resize: function(w, h) { sizeBuffers(w, h); },
        destroy: function() {
          if (window.MoongardenoneSet === set) delete window.MoongardenoneSet;
          if (window.MoongardenoneWake === wake) delete window.MoongardenoneWake;
          kit.wantDepth(false);
          try {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            made.fb.forEach(function(f) { gl.deleteFramebuffer(f); });
            made.tex.forEach(function(t) { gl.deleteTexture(t); });
            made.prog.forEach(function(p) { gl.deleteProgram(p); });
            gl.deleteVertexArray(vao);
          } catch (e) {}
          made = {tex: [], fb: [], prog: []};
          proxRaw = proxTmp = proxSm = proxW = null; tips = []; held = [];
          if (window.__moonGardenOneDebug) try { delete window.__moonGardenOneDebug; } catch (e) { window.__moonGardenOneDebug = undefined; }
        }
      };
    }
  });
})();
