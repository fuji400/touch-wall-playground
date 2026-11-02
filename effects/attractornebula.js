/* Attractor Nebula -- a Clifford strange attractor as a glowing nebula whose four parameters are your hands (2026-10-22, genart
 * build-out, builder E; after jdxyw/generativeart cliffordnebula.go: its map, velocity-phase colour, log HDR tone map and gold cores).
 *
 *   x' = sin(a y) + c cos(a x),   y' = sin(b x) + d cos(b y)
 * Up to half a million points live in a float texture and are iterated once per frame on the GPU (a ping-pong pass), then splatted
 * as single pixels with additive blending into a per-frame HDR target, which is folded into a decaying accumulation (the trail).
 * Each point is coloured by its velocity and direction (core gold through a sunset ramp to deep violet at the fastest points); the
 * picture is log tone-mapped against the screen's own mean density (so the points and trail knobs never change the brightness),
 * dense cores blend to core gold, and a soft bloom comes from the accumulation's mip chain.
 *   hands: hand 1 (x, y) -> (a, b), hand 2 (x, y) -> (c, d); move a hand and the whole cloud re-forms at once. Most of the [-2, 2]
 *          square collapses to a few points (a fixed point or a short cycle), so hand 1 is mapped onto the chaotic corners (|a|, |b|
 *          1.2..2: each quarter of the wall is one corner) and a CPU probe (1500 iterations) pulls any collapsed choice back toward the
 *          current preset until it is a real attractor again. A jump (crossing the middle) cross-fades instead of morphing.
 *   tap  : the next preset, cross-faded over 1 s.     hold : the parameters freeze and the cloud slowly turns.
 *   walk : the nebula hangs on the nearest person (centred on them, bigger the closer they stand to the wall); the cloud dims inside a
 *          silhouette and a faint gold rim marks it.
 *   idle : the cloud breathes around one known-beautiful set for ~20 s, then dissolves into the next (four presets, cycling).
 * Two param slots (half the points each) make the cross-fades: the incoming slot is warmed up with extra iterations so it lands on its
 * attractor in the same frame. Knobs: points (thousands), glow, trail, hue. WebGL 2 + EXT_color_buffer_float; no assets, no audio.
 * Looks (2026-11-01): named presets of the seven-stop colour ramp, the ground tint and two knobs (glow, trail). Picking one eases
 * the ramp and ground over ~0.8 s (the trail holds colour for only a few frames, so the old colours fade with it) and glow/trail
 * over ~1.2 s; a moved knob overrides the look's value until the next look. Look 0 (sunset) is the original picture.
 */
(function () {
  'use strict';

  var PW = 1024, PH = 512;                     // position texture: up to 524288 points
  var PRESETS = [[-1.4, 1.6, 1.0, 0.7], [1.7, 1.7, 0.6, 1.2], [-1.7, 1.3, -0.1, -1.2], [-1.7, 1.8, -1.9, -0.4]];
  var DWELL_S = 20, IDLE_FADE_S = 3.2, TAP_FADE_S = 1.0, JUMP_FADE_S = 0.35;
  var FOLLOW_S = 0.12;                         // how fast the cloud follows a moving hand (time constant)
  var HOLD_MS = 800, MOVE_PX = 16, TAP_MS = 450;
  var TURN = 0.3;                              // rad/s while a hand holds
  var GUARD_MIN = 120;                         // cells (of 48 x 48) a real attractor covers in 1500 iterations (the presets: 500-680)
  // the Sunset ramp of the Go engine's colour schema, from core gold (slow points) to deep violet (the fastest)
  var PAL = [[255, 248, 224], [255, 198, 92], [247, 138, 60], [226, 82, 94], [178, 50, 126], [108, 42, 140], [46, 26, 96]];
  // Looks: the ramp (core -> fastest), the ground tint added under the picture (0..1) and the glow / trail knobs. Look 0 is the original.
  var LOOKS = [
    {name: 'sunset', glow: 50, trail: 50, ground: [0.012, 0.008, 0.03], pal: PAL},
    {name: 'ice',    glow: 40, trail: 80, ground: [0.004, 0.010, 0.030],
     pal: [[240, 250, 255], [176, 224, 255], [112, 182, 250], [70, 132, 232], [48, 88, 204], [30, 50, 150], [12, 20, 72]]},
    {name: 'ember',  glow: 70, trail: 60, ground: [0.022, 0.006, 0.003],
     pal: [[255, 240, 200], [255, 182, 64], [242, 112, 32], [204, 52, 20], [144, 26, 12], [84, 12, 8], [32, 4, 4]]},
    {name: 'neon',   glow: 90, trail: 25, ground: [0.006, 0.0, 0.018],
     pal: [[255, 255, 255], [80, 255, 236], [40, 196, 255], [196, 64, 255], [255, 40, 196], [160, 20, 176], [44, 0, 84]]},
    {name: 'silver', glow: 30, trail: 90, ground: [0.010, 0.010, 0.012],
     pal: [[255, 255, 255], [222, 224, 230], [184, 188, 198], [144, 148, 160], [104, 108, 122], [66, 70, 84], [28, 30, 40]]},
    {name: 'aurora', glow: 60, trail: 95, ground: [0.003, 0.012, 0.018],
     pal: [[232, 255, 222], [144, 255, 152], [60, 222, 142], [40, 172, 172], [60, 102, 204], [92, 52, 172], [30, 16, 72]]}
  ];
  var PAL_TAU = 0.25, SHAPE_TAU = 0.4;

  registerWallPlugin({id: 'attractornebula', title: 'Attractor Nebula', author: 'Claude Opus 5.5 (genart builder E)', create: create});

  // ---------------------------------------------------------------- contacts (the refreshContacts pattern from prismpathsflow)
  function refreshContacts(kit, graceMs) {
    var wakes = [], last = [], lastSeen = 0, lastStamp = -Infinity, state = 'empty';
    function valid(p) { return Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1; }
    function clean(raw) {
      var out = [];
      (Array.isArray(raw) ? raw : []).slice(0, 32).forEach(function (p) {
        if (valid(p) && out.length < 8 && !out.some(function (q) { return Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.015; })) out.push([p[0], p[1]]);
      });
      return out;
    }
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
    function wake(x, y) {
      if (!valid([x, y]) || kit.fingers) return;
      var now = Date.now(), old = wakes.find(function (p) { return Math.hypot(p.x - x, p.y - y) < 0.025; });
      if (old) { old.x = x; old.y = y; old.t = now; } else { if (wakes.length >= 8) wakes.shift(); wakes.push({x: x, y: y, t: now}); }
    }
    return {read: read, wake: wake, clear: function () { wakes = []; last = []; }, get state() { return state; }};
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

  function refreshHue(initial) {
    var value = Number.isFinite(initial) ? initial : 0;
    return {get value() { return value; }, snap: function (v) { value = v; },
      step: function (target, dt) { var d = ((target - value + 540) % 360) - 180; if (Math.abs(d) < 0.001) { value = target % 360; return; }
        value = (value + d * (1 - Math.exp(-Math.max(0, Math.min(0.1, dt)) / 0.18)) + 360) % 360; }};
  }
  function hueTurn(c, deg, out, o) {          // rotate an RGB colour about the grey axis (keeps its brightness), into out[o..o+2]
    var a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), k = 0.57735, r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, d = k * (r + g + b) * (1 - ca);
    out[o] = Math.max(0, r * ca + k * (g - b) * sa + k * d); out[o + 1] = Math.max(0, g * ca + k * (b - r) * sa + k * d); out[o + 2] = Math.max(0, b * ca + k * (r - g) * sa + k * d);
  }
  // CPU probe: how many cells of a 48 x 48 grid over the attractor's bounds 1500 iterations visit (a collapse visits a handful)
  var probeCells = new Uint8Array(48 * 48);
  function coverage(p) {
    var a = p[0], b = p[1], c = p[2], d = p[3], ex = 1 + Math.abs(c), ey = 1 + Math.abs(d), x = 0.1, y = 0.1, n = 0;
    probeCells.fill(0);
    for (var i = 0; i < 1560; i++) {
      var nx = Math.sin(a * y) + c * Math.cos(a * x), ny = Math.sin(b * x) + d * Math.cos(b * y); x = nx; y = ny;
      if (i < 60) continue;
      var gx = Math.floor((x / ex * 0.5 + 0.5) * 47), gy = Math.floor((y / ey * 0.5 + 0.5) * 47);
      if (gx < 0 || gy < 0 || gx > 47 || gy > 47) continue;
      var k = gy * 48 + gx; if (!probeCells[k]) { probeCells[k] = 1; n++; }
    }
    return n;
  }

  // ---------------------------------------------------------------- shaders
  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var INIT_FS = '#version 300 es\nprecision highp float;\nout vec4 o;\n' +
    'float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }\n' +
    'void main(){ vec2 p=gl_FragCoord.xy; o=vec4(h(p)*2.-1.,h(p+vec2(17.3,9.1))*2.-1.,.5,1.); }\n';
  // one Clifford step per point; colour index = 0.65 * speed + 0.35 * direction, as in the Go
  var ITER_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform highp sampler2D uPos; uniform vec4 uP0, uP1; uniform float uSplit, uSeed;\nout vec4 o;\n' +
    'float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }\n' +
    'void main(){ ivec2 t=ivec2(gl_FragCoord.xy); vec4 s=texelFetch(uPos,t,0); vec4 P=float(t.y)<uSplit?uP0:uP1;\n' +
    '  float x=s.x, y=s.y, nx=sin(P.x*y)+P.z*cos(P.x*x), ny=sin(P.y*x)+P.w*cos(P.y*y), dx=nx-x, dy=ny-y;\n' +
    // a whisper of noise (well under a pixel) so points that a collapse has merged come apart again
    '  vec2 j=vec2(h(gl_FragCoord.xy+uSeed),h(gl_FragCoord.yx-uSeed))-.5; nx+=j.x*4e-4; ny+=j.y*4e-4;\n' +
    '  float ph=(atan(dy,dx)+3.14159265)/6.2831853, ci=clamp(.65*clamp(length(vec2(dx,dy))/4.2,0.,1.)+.35*ph,0.,1.);\n' +
    '  o=vec4(nx,ny,ci,1.); }\n';
  var PT_VS = '#version 300 es\nprecision highp float;\n' +
    'uniform highp sampler2D uPos; uniform vec4 uXf; uniform vec2 uRot; uniform float uSplit, uW0, uW1; uniform vec3 uPal[7];\nout vec4 vC;\n' +
    'vec3 pal(float t){ t=clamp(t,0.,1.)*6.; int i=int(min(floor(t),5.)); return mix(uPal[i],uPal[i+1],t-float(i)); }\n' +
    'void main(){ int id=gl_VertexID; ivec2 t=ivec2(id&1023,id>>10); vec4 s=texelFetch(uPos,t,0);\n' +
    '  vec2 q=vec2(s.x*uRot.x-s.y*uRot.y,s.x*uRot.y+s.y*uRot.x);\n' +
    '  gl_Position=vec4(uXf.xy+q*uXf.zw,0.,1.); gl_PointSize=1.;\n' +
    '  float w=float(t.y)<uSplit?uW0:uW1; vC=vec4(pal(s.z)*w,w); }\n';
  var PT_FS = '#version 300 es\nprecision highp float;\nin vec4 vC; out vec4 o;\nvoid main(){ o=vC; }\n';
  // this frame's splats into the trail: accum = accum * decay + frame (the blend does the decay); capped so a collapse cannot overflow
  var COMP_FS = '#version 300 es\nprecision highp float;\nuniform highp sampler2D uF;\nout vec4 o;\n' +
    'void main(){ o=min(texelFetch(uF,ivec2(gl_FragCoord.xy),0),vec4(1500.)); }\n';
  var DISP_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform highp sampler2D uA; uniform sampler2D uMask; uniform mat3 uHinv; uniform float uLvl, uGlow, uRef, uBody, uExpo;\n' +
    'uniform vec3 uCore, uDeep, uGround; uniform vec4 uHalo[4]; uniform int uNH; uniform vec2 uRes;\nin vec2 vUv; out vec4 o;\n' +
    'float dmap(float d,float m){ return clamp(log(1.+45.*d/m)/log(1.+45.*uRef),0.,1.); }\n' +
    'float line(float f,float iso,float w){ float d=abs(f-iso)/max(fwidth(f),1e-4); return exp(-d*d/(w*w)); }\n' +
    'void main(){ float mean=max(textureLod(uA,vec2(.5),uLvl).a,1e-5);\n' +
    '  vec4 A=texture(uA,vUv); float dn=dmap(A.a,mean), m=pow(dn,.72);\n' +
    '  vec3 avg=A.rgb/max(A.a,1e-6);\n' +
    '  vec3 col=mix(avg,uDeep,(1.-m)*.45);\n' +                                       // faint wisps lean violet...
    '  col=mix(col,uCore,smoothstep(.68,1.,m)*.75);\n' +                              // ...dense cores turn core gold
    '  col*=m*(1.+1.45*pow(m,2.2))*uExpo;\n' +
    '  vec2 tx=8./uRes; vec4 G1=textureLod(uA,vUv,2.5);\n' +
    '  vec4 G2=.25*(textureLod(uA,vUv+tx*vec2(1.,1.),4.)+textureLod(uA,vUv+tx*vec2(-1.,1.),4.)+textureLod(uA,vUv+tx*vec2(1.,-1.),4.)+textureLod(uA,vUv-tx,4.));\n' +
    '  float g1=G1.a/mean, g2=G2.a/mean;\n' +
    '  col+=(G1.rgb/max(G1.a,1e-6))*(g1/(g1+3.))*.35*uGlow+(G2.rgb/max(G2.a,1e-6))*(g2/(g2+4.))*.30*uGlow;\n' +
    '  vec2 c=vUv-.5; col*=1.-.3*dot(c,c)*2.;\n' +
    '  vec3 h=uHinv*vec3(vUv.x,1.-vUv.y,1.); vec2 k=h.xy/max(h.z,1e-6);\n' +
    '  float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0., mk=texture(uMask,clamp(k,0.,1.)).r*inK*uBody;\n' +
    '  col*=1.-.6*smoothstep(.35,.75,mk); col+=uCore*(line(mk,.5,1.3)*.22+line(mk,.5,6.)*.05);\n' +
    '  vec2 px=vec2(vUv.x,1.-vUv.y)*uRes;\n' +
    '  for(int j=0;j<4;j++){ if(j>=uNH) break; float d=length(px-uHalo[j].xy), r=uHalo[j].z;\n' +
    '    col+=uCore*exp(-pow((d-r)/(1.6*uRes.x/1280.),2.))*uHalo[j].w*.5; }\n' +
    '  col+=uGround;\n' +
    '  o=vec4(1.-exp(-max(col,0.)*1.15),1.); }\n';

  function create(canvas, kit) {
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Attractor Nebula needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Attractor Nebula needs EXT_color_buffer_float');
    var made = [], sized = [], dead = false;

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    function program(vsSrc, fsSrc) {
      var p = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, vsSrc), fs = shader(gl.FRAGMENT_SHADER, fsSrc);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(e); }
      made.push(['Program', p]);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    function texture(w, h, ifmt, fmt, type, minF, magF, list) {
      var t = gl.createTexture(); list.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minF); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magF);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function target(t, list) {
      var f = gl.createFramebuffer(); list.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Attractor Nebula: framebuffer incomplete');
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    }

    var P = {init: program(VS, INIT_FS), iter: program(VS, ITER_FS), pts: program(PT_VS, PT_FS), comp: program(VS, COMP_FS), disp: program(VS, DISP_FS)};
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);
    var pos = [], posFb = [], cur = 0;
    for (var k = 0; k < 2; k++) { pos[k] = texture(PW, PH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, gl.NEAREST, made); posFb[k] = target(pos[k], made); }
    gl.bindVertexArray(vao); gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, posFb[cur]); gl.viewport(0, 0, PW, PH); gl.useProgram(P.init.p); gl.drawArrays(gl.TRIANGLES, 0, 3);

    var W = 0, H = 0, frameTex, frameFb, accTex, accFb, topLvl = 0;
    function alloc(w, h) {
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      W = Math.max(1, w); H = Math.max(1, h);
      frameTex = texture(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST, gl.NEAREST, sized); frameFb = target(frameTex, sized);
      accTex = texture(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR, sized); accFb = target(accTex, sized);
      gl.bindTexture(gl.TEXTURE_2D, accTex); gl.generateMipmap(gl.TEXTURE_2D);
      topLvl = Math.floor(Math.log2(Math.max(W, H)));
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    alloc(canvas.width, canvas.height);

    var BW = 128, BH = 106, body = window.WallBody ? WallBody.create(kit, {}) : null, maskBytes = new Uint8Array(BW * BH);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var maskTex = texture(BW, BH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, gl.LINEAR, made);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, maskBytes);
    var identity = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    var settings = {look: 0, points: 250, glow: 50, trail: 50, hue: 0};
    var LK = LOOKS[0], over = {glow: false, trail: false}, looks = 0, ek = {glow: LK.glow, trail: LK.trail};   // a moved knob overrides the look
    var palNow = LK.pal.map(function (c) { return c.slice(); }), groundNow = new Float32Array(LK.ground);
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    function applyLook(i) { LK = LOOKS[i]; over.glow = over.trail = false; looks++; }
    function stepLook(dt) {
      var ks = 1 - Math.exp(-dt / SHAPE_TAU), kp = 1 - Math.exp(-dt / PAL_TAU);
      ek.glow += (want('glow') - ek.glow) * ks; ek.trail += (want('trail') - ek.trail) * ks;
      for (var i = 0; i < 7; i++) for (var c = 0; c < 3; c++) palNow[i][c] += (LK.pal[i][c] - palNow[i][c]) * kp;
      for (var g = 0; g < 3; g++) groundNow[g] += (LK.ground[g] - groundNow[g]) * kp;
    }
    function snapLook() {
      palNow = LK.pal.map(function (c) { return c.slice(); }); groundNow.set(LK.ground);
      ek.glow = want('glow'); ek.trail = want('trail');
    }
    var hueFlow = refreshHue(0), input = refreshContacts(kit, 120);
    var time = 0, frames = 0, frameMs = 0, warm = 0;
    // parameters: slot 0 and slot 1 (half the points each); a cross-fade moves the picture from slot 0 to slot 1
    var preset = 0, idleT = 0, cur4 = PRESETS[0].slice(), p0 = PRESETS[0].slice(), p1 = PRESETS[0].slice(), fade = null;
    var goal = PRESETS[0].slice(), lastGoal = PRESETS[0].slice(), guardSteps = 0, guardCache = {key: '', out: null}, cov = 0;
    var idleSafe = true, tracks = [], nextTrack = 1, holdOn = false, angle = 0, counts = {taps: 0, holds: 0, fades: 0, jumps: 0, guarded: 0};
    var place = {x: 0.5, y: 0.5, k: 1, s: 0}, bodyCount = 0, bodyOn = false, lastPts = 0;
    var p0U = new Float32Array(4), p1U = new Float32Array(4), palU = new Float32Array(21), haloU = new Float32Array(16), xfU = new Float32Array(4);
    var core = new Float32Array(3), deep = new Float32Array(3);

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function nPoints() { return Math.round(clamp(settings.points, 50, 500)) * 1024; }
    function rows() { return Math.min(PH, Math.ceil(nPoints() / PW)); }
    function maxDiff(a, b) { var m = 0; for (var i = 0; i < 4; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; }

    function startFade(to, dur) {               // slot 1 takes the new parameters (warmed this frame), the picture cross-fades to it
      if (fade && fade.f > 0.5) p0 = p1.slice();  // mid-fade: the slot that is showing more stays as the outgoing one
      p1 = to.slice(); cur4 = to.slice(); fade = {f: 0, dur: Math.max(0.05, dur)}; warm = 8; counts.fades++;
    }
    function guard(t) {                         // a collapsed choice is pushed outward (bigger |a|..|d|), then toward the preset, until it is an attractor
      var key = t[0].toFixed(2) + ',' + t[1].toFixed(2) + ',' + t[2].toFixed(2) + ',' + t[3].toFixed(2);
      if (guardCache.key === key) return guardCache.out;
      var out = t, anchor = PRESETS[preset];
      cov = coverage(t); guardSteps = 0;
      if (cov < GUARD_MIN) {
        counts.guarded++;
        for (var s = 1; s <= 6; s++) {
          var q = [0, 0, 0, 0];
          for (var i = 0; i < 4; i++) q[i] = s <= 3 ? (t[i] < 0 ? -1 : 1) * Math.min(2, Math.abs(t[i]) + 0.15 * s) : t[i] + (anchor[i] - t[i]) * (s - 3) / 3;
          guardSteps = s; out = q;
          if (s === 6 || coverage(q) >= GUARD_MIN) break;
        }
      }
      guardCache = {key: key, out: out};
      return out;
    }
    function corner(u, lo) { return (u < 0 ? -1 : 1) * (lo + (2 - lo) * Math.min(1, Math.abs(u))); }
    // each quarter of the wall is one corner of the parameter square: most of the middle collapses to a few points (CPU sweep 2026-10-22:
    // a literal [-2, 2] map is 70-80 % collapsed; these corners 6 %, and the guard catches those)
    function handToAB(x, y) { return [corner(2 * x - 1, 1.35), corner(1 - 2 * y, 1.35)]; }
    function handToCD(x, y) { return [corner(2 * x - 1, 0.9), corner(1 - 2 * y, 0.9)]; }

    var tapInput = tapGesture(kit, input, 350);
    function updateTracks(pts, now) {
      for (var i = 0; i < tracks.length; i++) tracks[i].used = false;
      for (var j = 0; j < pts.length; j++) {
        var p = pts[j], best = null, bd = 0.09;
        for (var q = 0; q < tracks.length; q++) {
          var t = tracks[q]; if (t.used) continue;
          var d = Math.hypot(t.x - p[0], (t.y - p[1]) * 0.625); if (d < bd) { bd = d; best = t; }
        }
        if (!best) { best = {id: nextTrack++, x: p[0], y: p[1], ax: p[0], ay: p[1], x0: p[0], y0: p[1], t0: now, lastMove: now, moved: false, hold: false, live: true}; tracks.push(best); }
        best.used = true; best.x = p[0]; best.y = p[1]; tapInput.observe(best, p[0], p[1]);
      }
      for (var m = tracks.length - 1; m >= 0; m--) {
        var tr = tracks[m];
        if (!tr.used) {                          // released: a short still contact was a tap
          if (tapInput.release(tr)) { counts.taps++; preset = (preset + 1) % PRESETS.length; idleT = 0; startFade(PRESETS[preset], TAP_FADE_S); goal = PRESETS[preset].slice(); lastGoal = goal.slice(); }
          tracks.splice(m, 1); continue;
        }
        if (Math.hypot((tr.x - tr.ax) * 1280, (tr.y - tr.ay) * 800) > MOVE_PX) { tr.ax = tr.x; tr.ay = tr.y; tr.lastMove = now; tr.moved = true; }
        var was = tr.hold; tr.hold = now - tr.lastMove > HOLD_MS;
        if (tr.hold && !was) counts.holds++;
      }
      tracks.sort(function (a, b) { return a.id - b.id; });
    }

    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      if (!Number.isFinite(now)) now = performance.now();
      if (canvas.width !== W || canvas.height !== H) alloc(canvas.width, canvas.height);
      hueFlow.step(settings.hue, dt);
      stepLook(dt);

      // ---- bodies: the nearest person carries the nebula
      bodyOn = false; bodyCount = 0;
      if (body) {
        var fresh = body.update(dt, now);
        if (fresh || !body.fresh) {
          var mk = body.mask; for (var i = 0; i < maskBytes.length; i++) { var mv = mk[i]; maskBytes[i] = mv > 0 ? Math.round(Math.min(1, mv) * 255) : 0; }
          gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, maskBytes);
        }
        bodyCount = body.fresh ? body.people.length : 0;
        var pp = bodyCount ? body.people[0] : null, sp = pp ? kit.toScreen(pp.cx * 512, pp.cy * 424) : null;
        if (pp && sp && Number.isFinite(sp[0]) && Number.isFinite(sp[1])) {
          bodyOn = true;
          var near = clamp((pp.gap - 300) / 1200, 0, 1);
          var tx = clamp(sp[0], 0.15, 0.85), ty = clamp(sp[1] - 0.06, 0.2, 0.8), tk = 1.15 - 0.45 * near, kf = 1 - Math.exp(-dt / 0.6);
          place.x += (tx - place.x) * kf; place.y += (ty - place.y) * kf; place.k += (tk - place.k) * kf;
        }
      }
      if (!bodyOn) { var kb = 1 - Math.exp(-dt / 1.2); place.x += (0.5 - place.x) * kb; place.y += (0.5 - place.y) * kb; place.k += (1 - place.k) * kb; }

      // ---- hands
      updateTracks(input.read(), now);
      lastPts = tracks.length;
      holdOn = tracks.some(function (t) { return t.hold; });
      var ctl = tracks.filter(function (t) { return t.moved && !t.hold; });
      if (holdOn) angle += TURN * dt;
      if (!holdOn && ctl.length) {               // hand 1 -> (a, b), hand 2 -> (c, d)
        idleT = 0;
        var g = goal.slice(), ab = handToAB(ctl[0].x, ctl[0].y); g[0] = ab[0]; g[1] = ab[1];
        if (ctl.length > 1) { var cd = handToCD(ctl[1].x, ctl[1].y); g[2] = cd[0]; g[3] = cd[1]; }
        goal = guard(g);
      } else if (!holdOn && !tracks.length) {    // idle: breathe round the preset, then dissolve into the next one
        idleT += dt;
        if (idleT > DWELL_S) { idleT = 0; preset = (preset + 1) % PRESETS.length; startFade(PRESETS[preset], IDLE_FADE_S); goal = PRESETS[preset].slice(); lastGoal = goal.slice(); }
        else {
          var base = PRESETS[preset], br = 0.05 * Math.min(1, idleT / 4);
          var wig = [base[0] + br * Math.sin(time * 0.31), base[1] + br * Math.sin(time * 0.23 + 1), base[2] + br * Math.sin(time * 0.17 + 2), base[3] + br * Math.sin(time * 0.13 + 3)];
          if ((frames & 7) === 0) idleSafe = coverage(wig) >= GUARD_MIN;   // a breath that would collapse the cloud holds at the preset instead
          goal = idleSafe ? wig : base.slice();
        }
      }
      if (!holdOn) {
        if (maxDiff(goal, lastGoal) > 0.5) { counts.jumps++; startFade(goal, JUMP_FADE_S); }
        else {
          var kf2 = 1 - Math.exp(-dt / FOLLOW_S);
          for (var q = 0; q < 4; q++) cur4[q] += (goal[q] - cur4[q]) * kf2;
          if (fade) p1 = cur4.slice(); else { p0 = cur4.slice(); p1 = cur4.slice(); }
        }
        lastGoal = goal.slice();
      }
      var w0 = 1, w1 = 1;
      if (fade) {
        fade.f = Math.min(1, fade.f + dt / fade.dur);
        var e = fade.f * fade.f * (3 - 2 * fade.f); w0 = 2 * (1 - e); w1 = 2 * e;
        if (fade.f >= 1) { p0 = p1.slice(); fade = null; w0 = 1; w1 = 1; warm = Math.max(warm, 8); }
      }

      // ---- GPU: iterate, splat, fold into the trail, picture
      var nr = rows(), split = Math.floor(nr / 2), np = Math.min(nPoints(), nr * PW);
      gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(P.iter.p);
      p0U.set(p0); p1U.set(p1);
      gl.uniform4fv(P.iter.u.uP0, p0U); gl.uniform4fv(P.iter.u.uP1, p1U); gl.uniform1f(P.iter.u.uSplit, split);
      gl.viewport(0, 0, PW, nr);
      for (var it = 0; it < 1 + warm; it++) {
        gl.uniform1f(P.iter.u.uSeed, (frames * 7 + it) % 997);
        gl.bindFramebuffer(gl.FRAMEBUFFER, posFb[1 - cur]);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pos[cur]); gl.uniform1i(P.iter.u.uPos, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3); cur = 1 - cur;
      }
      warm = 0;

      for (var c = 0; c < 7; c++) hueTurn(palNow[c], hueFlow.value, palU, c * 3);
      core.set(palU.subarray(0, 3)); deep.set(palU.subarray(15, 18));
      var ex = Math.max(1 + Math.abs(p0[2]), 1 + Math.abs(p1[2])), ey = Math.max(1 + Math.abs(p0[3]), 1 + Math.abs(p1[3]));
      var sTarget = Math.min(0.46 * W / ex, 0.44 * H / ey) * place.k;
      place.s = place.s > 0 ? place.s + (sTarget - place.s) * (1 - Math.exp(-dt / 0.5)) : sTarget;
      xfU[0] = place.x * 2 - 1; xfU[1] = 1 - place.y * 2; xfU[2] = place.s * 2 / W; xfU[3] = place.s * 2 / H;

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameFb); gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(P.pts.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pos[cur]); gl.uniform1i(P.pts.u.uPos, 0);
      gl.uniform4fv(P.pts.u.uXf, xfU); gl.uniform2f(P.pts.u.uRot, Math.cos(angle), Math.sin(angle));
      gl.uniform1f(P.pts.u.uSplit, split); gl.uniform1f(P.pts.u.uW0, w0); gl.uniform1f(P.pts.u.uW1, w1); gl.uniform3fv(P.pts.u.uPal, palU);
      gl.drawArrays(gl.POINTS, 0, np);

      var decay = 0.72 + 0.25 * clamp(ek.trail, 0, 100) / 100;
      gl.bindFramebuffer(gl.FRAMEBUFFER, accFb);
      gl.blendColor(0, 0, 0, decay); gl.blendFunc(gl.ONE, gl.CONSTANT_ALPHA);
      gl.useProgram(P.comp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, frameTex); gl.uniform1i(P.comp.u.uF, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, accTex); gl.generateMipmap(gl.TEXTURE_2D);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(P.disp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(P.disp.u.uA, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(P.disp.u.uMask, 1);
      gl.uniformMatrix3fv(P.disp.u.uHinv, false, body ? body.hinv() : identity);
      gl.uniform1f(P.disp.u.uLvl, topLvl); gl.uniform1f(P.disp.u.uGlow, 0.2 + 1.6 * ek.glow / 100);
      gl.uniform1f(P.disp.u.uRef, 30 - 12 * ek.glow / 100); gl.uniform1f(P.disp.u.uExpo, 0.6 + 0.5 * ek.glow / 100); gl.uniform1f(P.disp.u.uBody, body ? 1 : 0);
      gl.uniform3fv(P.disp.u.uCore, core); gl.uniform3fv(P.disp.u.uDeep, deep); gl.uniform3fv(P.disp.u.uGround, groundNow); gl.uniform2f(P.disp.u.uRes, W, H);
      var nh = 0; haloU.fill(0);
      for (var h = 0; h < tracks.length && nh < 4; h++) {
        var tr = tracks[h], age = (now - tr.t0) / 1000, hk = W / 1280;
        haloU.set([tr.x * W, tr.y * H, (tr.hold ? 26 + 4 * Math.sin(time * 3) : 20 + 30 * Math.exp(-age * 5)) * hk, tr.hold ? 0.8 : 0.45 + 0.5 * Math.exp(-age * 4)], nh * 4); nh++;
      }
      gl.uniform4fv(P.disp.u.uHalo, haloU); gl.uniform1i(P.disp.u.uNH, nh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0); gl.bindVertexArray(null);
      frameMs = performance.now() - t0;
    }

    var lastPointsSetting = settings.points;
    function set(o) {
      if (o && !dead) {
        var lim = {look: [0, LOOKS.length - 1], points: [50, 500], glow: [0, 100], trail: [0, 100], hue: [0, 360]};
        var lk = o.look;                         // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, lim.look[0], lim.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['glow', 'trail'].forEach(function (key) {   // a knob that MOVED overrides the look's own value until the next look
          var v = o[key]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
          v = clamp(v, lim[key][0], lim[key][1]); if (v !== settings[key]) { settings[key] = v; over[key] = true; }
        });
        ['points', 'hue'].forEach(function (key) { var v = o[key]; if (typeof v === 'number' && Number.isFinite(v)) settings[key] = clamp(v, lim[key][0], lim[key][1]); });
        if (settings.points > lastPointsSetting) warm = Math.max(warm, 8);   // fresh rows land on the attractor before they are drawn
        lastPointsSetting = settings.points;
      }
      return {look: settings.look, points: settings.points, glow: settings.glow, trail: settings.trail, hue: settings.hue};
    }
    function destroy() {
      if (dead) return; dead = true;
      if (window.AttractornebulaSet === set) delete window.AttractornebulaSet;
      kit.wantDepth(false); input.clear(); tracks = [];
      sized.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); sized = [];
      made.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); made = [];
    }

    if (body) kit.wantDepth(true);
    var out = {frame: frame, touch: function (t) { if (t && !dead) input.wake(t.x, t.y); }, destroy: destroy};
    if (window.WallTest) out.debug = function (probe) {
      var r = {frames: frames, frameMs: +frameMs.toFixed(2), points: nPoints(), contacts: tracks.length,
        tracks: tracks.map(function (t) { return {id: t.id, x: +t.x.toFixed(3), y: +t.y.toFixed(3), moved: t.moved, hold: t.hold}; }),
        params: cur4.map(function (v) { return +v.toFixed(3); }), slot0: p0.map(function (v) { return +v.toFixed(3); }), slot1: p1.map(function (v) { return +v.toFixed(3); }),
        goal: goal.map(function (v) { return +v.toFixed(3); }), fading: fade ? +fade.f.toFixed(2) : null, preset: preset, holdOn: holdOn, angle: +angle.toFixed(3),
        coverage: cov, guardSteps: guardSteps, counts: Object.assign({}, counts), bodyCount: bodyCount, bodyOn: bodyOn,
        place: {x: +place.x.toFixed(3), y: +place.y.toFixed(3), k: +place.k.toFixed(3), s: +place.s.toFixed(1)},
        look: LK.name, looks: looks, overrides: Object.assign({}, over), eased: {glow: +ek.glow.toFixed(2), trail: +ek.trail.toFixed(2)},
        displayHue: +hueFlow.value.toFixed(2), settings: set(), destroyed: dead, input: input.state};
      if (probe && !dead) {
        r.coverageNow = coverage(cur4);
        var px = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, posFb[cur]); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        r.samplePoint = Array.from(px).map(function (v) { return +v.toFixed(3); }); r.glError = gl.getError();
      }
      return r;
    };
    window.AttractornebulaSet = set;
    if (window._attractornebulaFx) set(window._attractornebulaFx);
    LK = LOOKS[settings.look]; snapLook(); hueFlow.snap(settings.hue);   // start on the stored look and knobs without easing in
    return out;
  }
})();
