/* Echo — your shadow, spread across time (2026-10-05; concept #3 of the fx-research report, built by Claude Opus 5.5).
 * Your outline glows on the wall as a thin line, and behind it trail ghosts of where you were a moment ago, each a little older
 * and cooler: a wave of the arm leaves a fan of arms, a jump leaves a ladder. Come closer to the wall and the ghosts reach
 * further back in time. Tap the wall and time holds: the ghosts stay hanging for FREEZE_S while you step out and look.
 * Nothing is projected inside a person. With nobody there, faint contour lines drift slowly.
 * Needs plugins/body.js (WallBody, the shared body stage). WebGL 2, no assets, no audio, one depth client (via the host).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  var ECHOES = 10;                 // ghosts behind you
  var SPACING_NEAR_S = 0.24;       // time between ghosts when you stand close to the wall (s)...
  var SPACING_FAR_S = 0.09;        // ...and when you stand far back
  var NEAR_MM = 350, FAR_MM = 1600;  // what counts as close / far (in front of the wall)
  var DIAL_S = 0.6;                // how softly the time dial follows you (time constant, s)
  var LINE_PX = 1.6;               // half-width of a line (px on a 1280-wide picture)
  var GLOW = 0.30;                 // the soft glow around every line
  var GHOST_FADE = 1.3;            // how quickly older ghosts dim (higher = only the recent ones show)
  var LIVE = 1.0;                  // brightness of your own outline, now
  var DARK_INSIDE = 1.0;           // no light inside a person (1 = none, 0 = off)
  var FREEZE_S = 5;                // a tap (a hand landing on an empty wall) holds the ghosts this long
  var TOPO = 0.35;                 // brightness of the resting contour lines when nobody is there (half while someone is)
  var HISTORY = 96;                // frames kept (~3.2 s at 30 fps); ECHOES * SPACING_NEAR_S must fit

  registerWallPlugin({id: 'echo', title: 'Echo', author: 'Claude Opus 5.5 (fx-research concept #3)', create: create});

  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  // Every texture read and derivative below runs for every pixel (no per-pixel branches), so fwidth() stays well defined.
  var FS = '#version 300 es\n' +
    'precision highp float; precision highp sampler2DArray;\n' +
    'uniform sampler2DArray uHist; uniform sampler2D uLive; uniform mat3 uHinv;\n' +
    'uniform int uN; uniform float uLayer[12]; uniform float uAlpha[12]; uniform float uAge[12];\n' +
    'uniform float uLineW, uGlow, uLiveB, uDark, uTopo, uTime, uFrozen, uAspect, uPx, uLift; uniform vec4 uRing, uRing2;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'vec3 agecol(float a){vec3 c0=vec3(1.,.84,.52),c1=vec3(1.,.34,.50),c2=vec3(.56,.30,1.),c3=vec3(.10,.32,.90);\n' +
    '  return a<.33?mix(c0,c1,a/.33):a<.66?mix(c1,c2,(a-.33)/.33):mix(c2,c3,(a-.66)/.34);}\n' +
    'float edge(float m,float w){float d=abs(m-.5)/max(fwidth(m),1e-4);return exp(-d*d/(w*w));}\n' +
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' +
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}\n' +
    'void main(){\n' +
    '  vec3 h=uHinv*vec3(vUv.x,1.-vUv.y,1.); vec2 k=h.xy/max(h.z,1e-6);\n' +
    '  float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.; k=clamp(k,0.,1.);\n' +
    '  float w=uLineW*uPx; vec3 col=vec3(0.);\n' +
    '  for(int i=0;i<12;i++){ if(i>=uN) break;\n' +                // uN and uAlpha are uniforms: the loop is the same for every pixel
    '    float m=texture(uHist,vec3(k,uLayer[i])).r;\n' +
    '    col+=agecol(uAge[i])*(edge(m,w)+edge(m,w*5.)*uGlow)*uAlpha[i]*(1.+.3*uFrozen)*inK; }\n' +
    '  float m0=texture(uLive,k).r;\n' +
    '  col+=vec3(.92,.97,1.)*(edge(m0,w*1.15)+edge(m0,w*5.)*uGlow)*uLiveB*inK;\n' +
    '  vec2 q=vec2(vUv.x*uAspect,vUv.y);\n' +                       // resting contour lines: slow, dim, deep blue
    '  float n=noise(q*2.3+vec2(uTime*.013,-uTime*.009))*.65+noise(q*5.1-vec2(uTime*.02,uTime*.011))*.35;\n' +
    '  float f=fract(n*7.); float tl=exp(-pow(min(f,1.-f)/max(fwidth(n*7.),1e-4)/(w*.9),2.));\n' +
    '  col+=vec3(.16,.30,.75)*tl*uTopo;\n' +
    '  vec2 rp=vec2((vUv.x-uRing.x)*uAspect,(1.-vUv.y)-uRing.y); float rr=(length(rp)-uRing.z)/max(fwidth(length(rp)),1e-4);\n' +
    '  col+=vec3(.75,.95,1.)*exp(-rr*rr/(w*w*2.))*uRing.w;\n' +    // the ring that says time is holding
    '  vec2 rq=vec2((vUv.x-uRing2.x)*uAspect,(1.-vUv.y)-uRing2.y); float rr2=(length(rq)-uRing2.z)/max(fwidth(length(rq)),1e-4);\n' +
    '  col+=vec3(.75,.95,1.)*(exp(-rr2*rr2/(w*w*40.))+.35*exp(-rr2*rr2/(w*w*400.)))*uRing2.w;\n' +    // music: a ring per beat
    '  col*=uLift;\n' +                                                // music: bass brightens every line (1 = unchanged)
    '  col*=1.-uDark*smoothstep(.55,.8,m0)*inK;\n' +             // nothing projected inside a person
    '  col=1.-exp(-col*1.35);\n' +
    '  o=vec4(col,1.);\n' +
    '}\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Echo needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false});
    if (!gl) throw new Error('Echo needs WebGL 2');
    var made = [], destroyed = false;
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
    ['uHist', 'uLive', 'uHinv', 'uN', 'uLayer', 'uAlpha', 'uAge', 'uLineW', 'uGlow', 'uLiveB', 'uDark', 'uTopo', 'uTime', 'uFrozen', 'uAspect', 'uPx', 'uRing', 'uRing2', 'uLift']
      .forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    var BW = WallBody.w, BH = WallBody.h, body = WallBody.create(kit, {});
    var u8 = new Uint8Array(BW * BH);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var hist = gl.createTexture(); made.push(['Texture', hist]);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, hist);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, BW, BH, HISTORY, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(BW * BH * HISTORY));
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.LINEAR); });
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.CLAMP_TO_EDGE); });
    var live = gl.createTexture(); made.push(['Texture', live]);
    gl.bindTexture(gl.TEXTURE_2D, live);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, BW, BH, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR); });
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE); });

    var wallK = 2.0;                 // 'Empty wall' knob (1 = the 2026-10-05 picture): scales ONLY the resting contour lines, never the outline or ghosts
    var times = new Float64Array(HISTORY).fill(-Infinity), head = -1, recorded = 0, lastRec = -1e9;
    var spacing = SPACING_FAR_S, elapsed = 0, frames = 0;
    var frozenUntil = -1e9, freezeAt = 0, wasFrozen = false, resumedAt = -1e9, ring = {x: 0, y: 0, t0: -1e9}, touching = false, freezes = 0;
    var lastP = null, mRing = {x: .5, y: .5, t0: -1e9, s: 0}, musPrev = 0;
    var layerU = new Float32Array(12), alphaU = new Float32Array(12), ageU = new Float32Array(12);

    function pack(mask) { for (var i = 0; i < u8.length; i++) u8[i] = Math.round(Math.min(1, Math.max(0, mask[i])) * 255); }
    function record(now) {
      head = (head + 1) % HISTORY; times[head] = now; recorded++; lastRec = now;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, hist);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, head, BW, BH, 1, gl.RED, gl.UNSIGNED_BYTE, u8);
    }
    function nearest(t) {                    // the one recorded frame closest in time (never a blend: a blend of two masks has no edge)
      var best = -1, bd = 80;               // ms: further than this from any frame = nothing there
      for (var i = 0; i < HISTORY; i++) { var d = Math.abs(times[i] - t); if (d < bd) { bd = d; best = i; } }
      return best;
    }
    function freeze(x, y, now) { frozenUntil = now + FREEZE_S * 1000; if (!wasFrozen) freezeAt = now; ring = {x: x, y: y, t0: now}; freezes++; }
    function touchFrame(now) {               // a hand landing on an empty wall holds time; a hand left there does not keep it held
      var f = kit.fingers, pts = (f && Date.now() - f.t <= 250 && Array.isArray(f.pts) && f.pts.length) ? f.pts : [];
      if (!pts.length) { var tt = kit.touches || [], tnow = Date.now(); pts = []; for (var ti = 0; ti < tt.length; ti++) if (tnow - tt[ti].t < 250) pts.push([tt[ti].x, tt[ti].y]); }
      var p = null;
      for (var i = 0; i < pts.length; i++) if (pts[i] && pts[i][0] >= 0 && pts[i][0] <= 1 && pts[i][1] >= 0 && pts[i][1] <= 1) { p = pts[i]; break; }
      if (p) { lastP = {x: p[0], y: p[1], t: now}; }
      if (p && !touching) freeze(p[0], p[1], now);
      touching = !!p;
    }

    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); elapsed += dt; frames++;
      var fresh = body.update(dt, now);
      touchFrame(now);
      var frozen = now < frozenUntil;
      if (wasFrozen && !frozen) {            // time moves on: forget the frames before the hold, so no ghost reaches across it
        times.fill(-Infinity); head = -1; resumedAt = now;
      }
      wasFrozen = frozen;
      if (fresh || !body.fresh) { pack(body.mask); gl.bindTexture(gl.TEXTURE_2D, live); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, u8); }
      if (!frozen && (fresh || (!body.fresh && now - lastRec > 33))) record(fresh ? body.frameMs : now);   // stale: keep recording the fade, so ghosts walk off
      if (body.present && body.meanGap === body.meanGap) {
        var close = Math.max(0, Math.min(1, (FAR_MM - body.meanGap) / (FAR_MM - NEAR_MM)));
        spacing += (SPACING_FAR_S + (SPACING_NEAR_S - SPACING_FAR_S) * close - spacing) * (1 - Math.exp(-dt / DIAL_S));
      }
      var base = frozen ? freezeAt : now, n = 0;
      for (var k = 1; k <= ECHOES && n < 12; k++) {
        var li = nearest(base - k * spacing * 1000);
        if (li < 0) continue;
        layerU[n] = li; ageU[n] = (k - 1) / Math.max(1, ECHOES - 1); alphaU[n] = Math.pow(1 - (k - 1) / ECHOES, GHOST_FADE); n++;
      }
      var W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      gl.useProgram(prog); gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, hist); gl.uniform1i(U.uHist, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, live); gl.uniform1i(U.uLive, 1);
      gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
      gl.uniform1i(U.uN, n); gl.uniform1fv(U.uLayer, layerU); gl.uniform1fv(U.uAlpha, alphaU); gl.uniform1fv(U.uAge, ageU);
      gl.uniform1f(U.uLineW, LINE_PX); gl.uniform1f(U.uGlow, GLOW); gl.uniform1f(U.uLiveB, LIVE); gl.uniform1f(U.uDark, DARK_INSIDE);
      gl.uniform1f(U.uTopo, TOPO * wallK * (body.present ? 0.5 : 1)); gl.uniform1f(U.uTime, elapsed); gl.uniform1f(U.uFrozen, frozen ? 1 : 0);
      gl.uniform1f(U.uAspect, W / Math.max(1, H)); gl.uniform1f(U.uPx, W / 1280);
      var ra = (now - ring.t0) / 1000;
      gl.uniform4f(U.uRing, ring.x, ring.y, ra * 0.45, ra < 1.6 ? 0.9 * Math.exp(-ra * 2.2) : 0);
      var m = kit.music ? kit.music() : null, e = m && m.enabled && m.fresh ? m.amount : 0, bass = e ? e * m.bands[0] : 0, mid = e ? e * m.bands[1] : 0, high = e ? e * m.bands[2] : 0, beat = e ? e * m.pulse : 0;
      if (e && m.pulse > .95 && musPrev <= .95) {   // music: each beat emits a ring from the last touch (within 4 s) or a slowly drifting point
        var fromTouch = lastP && now - lastP.t < 4000;
        mRing = {x: fromTouch ? lastP.x : .5 + .25 * Math.sin(elapsed * .2), y: fromTouch ? lastP.y : .5 + .15 * Math.sin(elapsed * .13), t0: now, s: Math.min(1, beat * 1.4)};
      }
      musPrev = m ? m.pulse : 0;
      var ma = (now - mRing.t0) / 1000;
      gl.uniform4f(U.uRing2, mRing.x, mRing.y, 0.06 + ma * 0.55, ma < 1.4 ? 0.95 * mRing.s * Math.exp(-ma * 2.0) : 0);
      gl.uniform1f(U.uLift, 1 + 1.0 * bass);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    }
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.EchoSet === set) delete window.EchoSet;
      if (window.EchoWake === wake) delete window.EchoWake; kit.wantDepth(false);
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
      if (window.__echoDebug) try { delete window.__echoDebug; } catch (e) { window.__echoDebug = undefined; }
    }
    kit.wantDepth(true);
    if (window.WallTest) window.__echoDebug = function () {   // sandbox only (the live wall has no WallTest)
      var filled = 0, oldest = Infinity; for (var i = 0; i < HISTORY; i++) if (times[i] > -Infinity) { filled++; oldest = Math.min(oldest, times[i]); }
      return {frames: frames, recorded: recorded, filled: filled, spacing: +spacing.toFixed(3), present: body.present,
              meanGap: body.meanGap === body.meanGap ? Math.round(body.meanGap) : null, fresh: body.fresh, regOk: body.regOk,
              frozen: performance.now() < frozenUntil, freezes: freezes, oldestAfterResume: resumedAt > 0 && filled ? Math.round(oldest - resumedAt) : null, foldMs: +body.foldMs.toFixed(2), glError: gl.getError()};
    };
    function set(opts) {
      if (!opts || destroyed) return {echoes: ECHOES, near: SPACING_NEAR_S, far: SPACING_FAR_S, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.echoes)) ECHOES = Math.max(3, Math.min(12, opts.echoes));   // 12 = the shader's ghost slots (uLayer[12])
      if (Number.isFinite(opts.near)) SPACING_NEAR_S = Math.max(0.08, Math.min(0.6, opts.near));
      if (Number.isFinite(opts.far)) SPACING_FAR_S = Math.max(0.03, Math.min(0.3, opts.far));
      return {echoes: ECHOES, near: SPACING_NEAR_S, far: SPACING_FAR_S, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      var tips = kit.touches || [];
      tips.push({id: 'wake', x: sx, y: sy, t: Date.now()});
      if (tips.length > 8) tips.shift();
      kit.touches = tips;
      var pts = (kit.fingers && Array.isArray(kit.fingers.pts)) ? kit.fingers.pts.slice() : [];
      pts.push([sx, sy]);
      kit.fingers = {pts: pts, t: Date.now()};
      try { if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true}); } catch (e) {}
    }
    window.EchoSet = set;
    window.EchoWake = wake;
    if (window._echoFx) set(window._echoFx);

    return {frame: frame, destroy: destroy};
  }
})();
