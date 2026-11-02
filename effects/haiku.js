/* Starwell — a reference-led study of Kinetic Vortex.
 * A persistent silver star field gathers at wall contact into a small geometric
 * core. No body/presence attractor and no extra Kinect subscription. The existing
 * haiku id retains the Kinetic Vortex slot. The same source runs in the isolated
 * study and the projector trial. Controls: pull, orbit, release (seconds).
 */
(function () {
  'use strict';
  var COUNT = 16000, MAX_WELLS = 6, FRESH_MS = 180, GAP_MS = 160;
  var defaults = {pull: 1.3, orbit: 0.45, release: 1.6};
  registerWallPlugin({id: 'haiku', title: 'Starwell', author: 'Codex · Billy’s references', create: create});

  var VS = `#version 300 es
    precision highp float;
    in vec2 aPos; in vec2 aVel; in vec4 aStar;
    uniform vec2 uSize; uniform float uTime, uBright, uTwk;
    out vec2 vQ; out vec3 vColor; out float vLight;
    void main(){
      vec2 q=vec2((gl_VertexID==1||gl_VertexID==4||gl_VertexID==5)?1.:-1.,
                  (gl_VertexID==2||gl_VertexID==3||gl_VertexID==5)?1.:-1.);
      float speed=length(aVel), scale=uSize.y/800.;
      float width=(.75+1.05*aStar.x)*scale;
      float stretch=min(16.*scale,speed*uSize.y*.035);
      vec2 axis=speed>1e-5?aVel/speed:vec2(1.,0.);
      vec2 delta=axis*(q.x*(width+stretch)-stretch*.65)+vec2(-axis.y,axis.x)*q.y*width;
      vec2 p=aPos+delta/uSize.y;
      gl_Position=vec4(p.x/(uSize.x/uSize.y)*2.-1.,1.-p.y*2.,0.,1.);
      vQ=q;
      vColor=mix(vec3(.72,.81,1.),vec3(1.,.92,.78),aStar.y*.12);
      vLight=(.14+aStar.y*.42)*aStar.w*(.86+.14*sin(uTime*.7+aStar.z*60.))*uBright*(1.+uTwk*sin(uTime*23.+aStar.z*911.));
    }`;
  var FS = `#version 300 es
    precision highp float;
    in vec2 vQ; in vec3 vColor; in float vLight; out vec4 o;
    void main(){
      float edge=1.-smoothstep(.65,1.,abs(vQ.x));
      float light=exp(-vQ.y*vQ.y*5.)*edge;
      o=vec4(vColor,light*vLight);
    }`;
  var CORE_VS = `#version 300 es
    precision highp float; in vec2 aPos; in float aLight; uniform float uAspect;
    out float vLight;
    void main(){gl_Position=vec4(aPos.x/uAspect*2.-1.,1.-aPos.y*2.,0.,1.);vLight=aLight;}`;
  var CORE_FS = `#version 300 es
    precision highp float; in float vLight; out vec4 o;
    void main(){o=vec4(.89,.93,1.,vLight);}`;

  function create(canvas, kit) {
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false});
    if (!gl) throw new Error('Starwell needs WebGL 2');
    var made = [], destroyed = false, wells = [], nextId = 1, seenFingers = false;
    var settings = Object.assign({}, defaults), particles = new Float32Array(COUNT * 8);
    var homes = new Float32Array(COUNT * 2), absorbed = new Float32Array(COUNT), arrivalFade = new Float32Array(COUNT).fill(1);
    var elapsed = 0, frames = 0, aspect = canvas.width / Math.max(1, canvas.height);
    var seed = 712061, fallback = [], lastMs = 0;
    function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
    function resource(kind, obj) { made.push([kind, obj]); return obj; }
    function shader(type, src) {
      var s = resource('Shader', gl.createShader(type)); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    }
    function program(vs, fs) {
      var p = resource('Program', gl.createProgram());
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    }
    var stars, core;
    try { stars = program(VS, FS); core = program(CORE_VS, CORE_FS); }
    catch (e) { dispose(); throw e; }
    var starVao = resource('VertexArray', gl.createVertexArray()), starBuffer = resource('Buffer', gl.createBuffer());
    gl.bindVertexArray(starVao); gl.bindBuffer(gl.ARRAY_BUFFER, starBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particles.byteLength, gl.DYNAMIC_DRAW);
    [['aPos', 2, 0], ['aVel', 2, 8], ['aStar', 4, 16]].forEach(function (a) {
      var loc = gl.getAttribLocation(stars, a[0]); gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, a[1], gl.FLOAT, false, 32, a[2]); gl.vertexAttribDivisor(loc, 1);
    });
    var coreVao = resource('VertexArray', gl.createVertexArray()), coreBuffer = resource('Buffer', gl.createBuffer());
    var coreData = new Float32Array(MAX_WELLS * 30 * 2 * 3);
    gl.bindVertexArray(coreVao); gl.bindBuffer(gl.ARRAY_BUFFER, coreBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, coreData.byteLength, gl.DYNAMIC_DRAW);
    [['aPos', 2, 0], ['aLight', 1, 8]].forEach(function (a) {
      var loc = gl.getAttribLocation(core, a[0]); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, a[1], gl.FLOAT, false, 12, a[2]);
    });
    gl.bindVertexArray(null);
    var sizeU = gl.getUniformLocation(stars, 'uSize'), timeU = gl.getUniformLocation(stars, 'uTime'), brightU = gl.getUniformLocation(stars, 'uBright'), twkU = gl.getUniformLocation(stars, 'uTwk');
    var mBright = 1, mTwk = 0;
    var aspectU = gl.getUniformLocation(core, 'uAspect');
    var phi = (1 + Math.sqrt(5)) / 2, vertices = [], edges = [];
    [-1, 1].forEach(function (a) { [-1, 1].forEach(function (b) { vertices.push([0, a, b * phi], [a, b * phi, 0], [b * phi, 0, a]); }); });
    for (var i = 0; i < vertices.length; i++) for (var j = i + 1; j < vertices.length; j++) {
      if (Math.abs(Math.hypot(vertices[i][0] - vertices[j][0], vertices[i][1] - vertices[j][1], vertices[i][2] - vertices[j][2]) - 2) < .001) edges.push([i, j]);
    }
    vertices.forEach(function (v) { var n = Math.hypot(v[0], v[1], v[2]); for (var k = 0; k < 3; k++) v[k] /= n; });
    for (i = 0; i < COUNT; i++) {
      var p = i * 8, h = i * 2;
      homes[h] = random(); homes[h + 1] = random();
      particles[p] = homes[h] * aspect; particles[p + 1] = homes[h + 1];
      particles[p + 4] = .2 + random() * .8; particles[p + 5] = Math.pow(random(), 2);
      particles[p + 6] = random();
    }

    function valid(p) { return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1; }
    function input(now) {
      var f = kit.fingers;
      if (f) seenFingers = true;
      if (seenFingers) return f && Number.isFinite(f.t) && now - f.t >= 0 && now - f.t <= FRESH_MS && Array.isArray(f.pts) ? f.pts.filter(valid).slice(0, MAX_WELLS) : [];
      fallback = fallback.filter(function (t) { return now - t.t <= FRESH_MS; });
      return fallback.map(function (t) { return [t.x, t.y]; });
    }
    function track(dt, now) {
      var pts = input(now), pairs = [], usedP = [], usedW = [];
      for (var w = 0; w < wells.length; w++) {
        var well = wells[w]; well.held = false;
        for (var p = 0; p < pts.length; p++) {
          var d = Math.hypot((pts[p][0] - well.tx) * aspect, pts[p][1] - well.ty);
          var gate = .1 + Math.min(.14, Math.max(0, now - well.last) * .0007);
          if (d <= gate && now - well.last < 1000) pairs.push([d, w, p]);
        }
      }
      pairs.sort(function (a, b) { return a[0] - b[0]; });
      pairs.forEach(function (pair) {
        var w = pair[1], p = pair[2]; if (usedW[w] || usedP[p]) return;
        usedW[w] = true; usedP[p] = true;
        wells[w].tx = pts[p][0]; wells[w].ty = pts[p][1]; wells[w].last = now; wells[w].held = true;
      });
      for (p = 0; p < pts.length; p++) if (!usedP[p]) {
        if (wells.length >= MAX_WELLS) {
          var discard = -1, min = Infinity;
          for (w = 0; w < wells.length; w++) if (!wells[w].held && wells[w].energy < min) { min = wells[w].energy; discard = w; }
          if (discard >= 0) wells.splice(discard, 1); else continue;
        }
        wells.push({id: nextId++, x: pts[p][0], y: pts[p][1], tx: pts[p][0], ty: pts[p][1], last: now, held: true, energy: 0});
      }
      for (w = wells.length - 1; w >= 0; w--) {
        well = wells[w]; var held = well.held || now - well.last <= GAP_MS;
        well.energy += ((held ? 1 : 0) - well.energy) * (1 - Math.exp(-dt / (held ? .55 : settings.release * .32)));
        var follow = 1 - Math.exp(-dt / .07);
        well.x += (well.tx - well.x) * follow; well.y += (well.ty - well.y) * follow;
        if (!held && well.energy < .004) wells.splice(w, 1);
      }
    }
    function update(dt) {
      var room=kit.room?kit.room(dt):{motion:0};
      var m = kit.music ? kit.music() : null, e = m && m.enabled && m.fresh ? m.amount : 0, bass = e ? e * m.bands[0] : 0, mid = e ? e * m.bands[1] : 0, high = e ? e * m.bands[2] : 0, beat = e ? e * m.pulse : 0;
      var feed = Math.max(room.motion, bass * 0.8); mBright = Math.min(1.8, 1 + 0.8 * beat + 0.2 * bass); mTwk = Math.min(.5, high * .7);   // music: bass deepens the well, beat brightens the stars, high twinkles
      var drag = Math.exp(-dt * 3.4), returnRate = 7 / settings.release;
      for (var i = 0; i < COUNT; i++) {
        var o = i * 8, hi = i * 2, x = particles[o], y = particles[o + 1], depth = particles[o + 4];
        var ax = 0, ay = 0, influence = 0, total = 0, absorption = 0;
        for (var k = 0; k < wells.length; k++) {
          var well = wells[k], dx = well.x * aspect - x, dy = well.y - y, d = Math.hypot(dx, dy);
          if (d < .18) {
            var r = d * 10, r2 = r * r;
            absorption = Math.max(absorption, well.energy * Math.exp(-r2 * r2 * r2));
          }
          var radius = .72, fall = Math.max(0, 1 - d / radius), f = fall * fall * well.energy;
          if (f < .001) continue;
          var safe = Math.max(d, .0001), nx = dx / safe, ny = dy / safe;
          var shell = .026 + depth * .017;
          var radial = Math.tanh((d - shell) * 25) * settings.pull * 1.65 * f;
          var spin = Math.min(2.3,settings.orbit+feed*.8) * .5 * f;
          ax += nx * radial - ny * spin; ay += ny * radial + nx * spin;
          influence = Math.max(influence, Math.pow(f, .35)); total += f;
        }
        var balance = Math.max(1, total); ax /= balance; ay /= balance;
        var drift = .003 * Math.sin(elapsed * .12 + particles[o + 6] * 25);
        var hx = homes[hi] * aspect + drift * depth, hy = homes[hi + 1] + drift * depth * .5;
        var spring = returnRate * Math.pow(1 - influence, 8);
        ax += (hx - x) * spring; ay += (hy - y) * spring;
        particles[o + 2] = (particles[o + 2] + ax * dt) * drag;
        particles[o + 3] = (particles[o + 3] + ay * dt) * drag;
        particles[o] += particles[o + 2] * dt; particles[o + 1] += particles[o + 3] * dt;
        // Stars disappear into the core as they arrive; their positions remain
        // in the simulation so releasing the touch restores the same field.
        arrivalFade[i] = Math.min(1, arrivalFade[i] + dt * 3);
        absorbed[i] = absorption > .9 ? absorbed[i] + dt : 0;
        if (absorbed[i] > .65 + particles[o + 6] * 1.5) {
          // Recycle only after disappearing into the well. The same stars fade
          // back in at their home positions, sustaining a long hold without
          // visible teleports or an increasing particle count.
          particles[o] = homes[hi] * aspect; particles[o + 1] = homes[hi + 1];
          particles[o + 2] = 0; particles[o + 3] = 0; absorbed[i] = 0; arrivalFade[i] = 0;
        }
        particles[o + 7] = (1 - absorption) * arrivalFade[i];
      }
    }
    function coreLines() {
      var n = 0;
      wells.forEach(function (well) {
        if (well.energy < .025) return;
        var a = elapsed * .22 + well.id, b = elapsed * .31, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
        var radius = .037 * (.6 + well.energy * .4);
        var rotated = vertices.map(function (v) {
          var x = v[0] * ca + v[2] * sa, z = v[2] * ca - v[0] * sa, y = v[1] * cb - z * sb;
          z = v[1] * sb + z * cb;
          return [well.x * aspect + x * radius, well.y + y * radius, (.35 + (z + 1) * .35) * well.energy * well.energy];
        });
        edges.forEach(function (edge) { edge.forEach(function (v) { coreData[n++] = rotated[v][0]; coreData[n++] = rotated[v][1]; coreData[n++] = rotated[v][2]; }); });
      });
      return n;
    }
    function render() {
      gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.useProgram(stars); gl.bindVertexArray(starVao); gl.bindBuffer(gl.ARRAY_BUFFER, starBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles); gl.uniform2f(sizeU, canvas.width, canvas.height); gl.uniform1f(timeU, elapsed); gl.uniform1f(brightU, mBright); gl.uniform1f(twkU, mTwk);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, COUNT);
      var n = coreLines();
      if (n) {
        gl.useProgram(core); gl.bindVertexArray(coreVao); gl.bindBuffer(gl.ARRAY_BUFFER, coreBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, coreData.subarray(0, n)); gl.uniform1f(aspectU, aspect); gl.drawArrays(gl.LINES, 0, n / 3);
      }
      gl.bindVertexArray(null);
    }
    function frame(dt) {
      if (destroyed) return;
      var start = performance.now(); dt = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
      elapsed += dt; track(dt, Date.now());
      var steps = Math.max(1, Math.ceil(dt / .025)); for (var i = 0; i < steps; i++) update(dt / steps);
      render(); frames++; lastMs = performance.now() - start;
    }
    function touch(t) {
      if (destroyed || seenFingers || !valid([t.x, t.y])) return;
      var old = fallback.find(function (p) { return p.id === t.id; });
      if (old) { old.x = t.x; old.y = t.y; old.t = Date.now(); }
      else fallback.push({id: t.id, x: t.x, y: t.y, t: Date.now()});
    }
    function resize(w, h) {
      // Hidden/minimized canvases may briefly have no drawable size. Keep the
      // last valid aspect so restoring them cannot turn 0 * Infinity into NaN.
      if (destroyed || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
      var next = w / h, ratio = next / aspect;
      if (!Number.isFinite(next) || next <= 0 || !Number.isFinite(ratio) || ratio <= 0) return;
      for (var i = 0; i < COUNT; i++) { particles[i * 8] *= ratio; particles[i * 8 + 2] *= ratio; }
      aspect = next;
    }
    function set(opts) {
      if (!opts || destroyed) return Object.assign({}, settings);
      [['pull', .3, 2.5], ['orbit', 0, 1.5], ['release', .6, 4]].forEach(function (item) {
        var v = opts[item[0]]; if (Number.isFinite(v)) settings[item[0]] = Math.max(item[1], Math.min(item[2], v));
      });
      return Object.assign({}, settings);
    }
    function dispose() { made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = []; }
    function destroy() {
      if (destroyed) return; destroyed = true; dispose(); wells = []; fallback = [];
      if (window.StarwellSet === set) delete window.StarwellSet;
      if (window.StarwellWake === wake) delete window.StarwellWake;
    }
    kit.wantDepth(false);
        function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      try { if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true}); } catch (e) {}
    }
    window.StarwellWake = wake;
    window.StarwellSet = set;
    // Namespaced floats (fx_schema.py / main.js FX_FLOAT_NS): window._starwellFx is kept
    // across destroy; apply on create because StarwellSet is deleted and may not fire again.
    if (window._starwellFx) set(window._starwellFx);
    var instance = {frame: frame, touch: touch, resize: resize, destroy: destroy};
    if (window.WallTest) instance.debug = function () {
      var finite = true, displacement = 0;
      for (var i = 0; i < COUNT; i++) {
        for (var j = 0; j < 8; j++) if (!Number.isFinite(particles[i * 8 + j])) finite = false;
        displacement += Math.hypot(particles[i * 8] - homes[i * 2] * aspect, particles[i * 8 + 1] - homes[i * 2 + 1]);
      }
      return {frames: frames, particles: COUNT, finite: finite, displacement: displacement / COUNT, frameMs: lastMs,
        wells: wells.map(function (w) { return {id: w.id, x: w.x, y: w.y, energy: w.energy, held: w.held}; }),
        glError: gl.getError(), resources: made.length, destroyed: destroyed, settings: Object.assign({}, settings)};
    };
    return instance;
  }
})();
