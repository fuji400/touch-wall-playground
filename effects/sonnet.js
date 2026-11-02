/*
 * AURORA LAKE  (id: sonnet, by Sonnet 5.5)
 *
 * The idea: a still northern-lights night over a black pine ridge, with the whole sky doubled in a dark lake below.
 * The curtains of light drift slowly on their own. The wall is the sky: when you touch it or move near it, you disturb
 * the aurora itself. Light pools where a finger lands, the curtain folds and sways as a wave travels through it, rays
 * stretch taller and shift toward cyan-white, and the lake below carries the ripple. Mostly black, so the room stays dark.
 *
 * Interaction:
 *   touch - a fingertip stamps a flare and a travelling ripple; dragging paints a glowing, rippling trail; a still finger
 *           keeps a soft light burning under it. Touch the lake for rings and glints, the sky for flares in the curtain.
 *   body  - with the Kinect depth stream on, anything nearer than the wall glows like a lit patch of aurora, and
 *           movement (arms sweeping, stepping in or out) pushes waves through the light. Hovering hands work too.
 *
 * Tuning knobs (named constants below): GRID_W/GRID_H sim size, WAVE_K wave speed, WAVE_DAMP ripple lifetime,
 * GLOW_DECAY glow fade rate, TOUCH_AMP/TOUCH_RADIUS touch strength/size, BODY_GLOW/BODY_PUSH body response,
 * NEAR_MM depth threshold, HORIZON lake line, BRIGHT overall brightness, DRIFT idle speed.
 */
registerWallPlugin({
  id: 'sonnet',
  title: 'Aurora Lake',
  author: 'Sonnet 5.5',
  create: function(canvas, kit) {
    var GRID_W = 128, GRID_H = 80;
    var WAVE_K = 0.2, WAVE_DAMP = 0.985, GLOW_DECAY = 0.9;
    var TOUCH_AMP = 0.12, TOUCH_RADIUS = 5.5;
    var BODY_GLOW = 0.7, BODY_PUSH = 0.04, NEAR_MM = 60;
    var HORIZON = 0.3, BRIGHT = 1.0, DRIFT = 1.0;

    var gl = canvas.getContext('webgl2', {antialias: false, alpha: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('webgl2 needed');

    var VS = '#version 300 es\nin vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }';
    var FS = [
      '#version 300 es', 'precision highp float;',
      'uniform vec2 res; uniform float t; uniform sampler2D F; uniform float hz; uniform float bright;',
      'out vec4 o;',
      'float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
      'float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);',
      '  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }',
      'float ridge(float x){ float s = abs(fract(x*52.)-.5)*2.; return hz + .008 + .035*vn(vec2(x*6.,1.)) + .02*vn(vec2(x*17.,3.)) + .014*s*step(.35, vn(vec2(x*9.,7.))); }',
      // field: r = glow, g/b = gradient, a = height
      'vec3 sky(vec2 uv, vec4 f, float tt){',
      '  float asp = res.x / res.y; vec3 col = vec3(0.);',
      '  float gl = f.r; vec2 gr = (f.gb - .5) * 2.;',
      '  float x = uv.x * asp;',
      // stars
      '  vec2 sc = uv * res / 7.; vec2 si = floor(sc); float hs = hash(si);',
      '  float star = step(.985, hs) * smoothstep(.45, 0., length(fract(sc) - .5 - (vec2(hash(si+3.), hash(si+7.)) - .5)*.5));',
      '  star *= .5 + .5*sin(tt*(1.+hs*3.) + hs*50.); col += vec3(.7,.8,1.) * star * .7 * smoothstep(hz, .8, uv.y);',
      '  for (int i = 0; i < 4; i++) {',
      '    float fi = float(i);',
      '    float xs = x + gr.x * (.32 + fi*.09) + (f.a-.5) * .0;',
      '    float fold = .12*sin(xs*(1.2+fi*.5) + tt*(.11+fi*.045) + fi*2.1) + .06*sin(xs*3.3 - tt*.17 + fi*1.7) + .03*sin(xs*7.1 + tt*.31 + fi);',
      '    float base = .39 + fi*.05 + fold + gl*.03 + (f.a-.5)*.5;',
      '    float dy = uv.y - base;',
      '    float k = (6.5 - fi*.8) / (1. + gl*.8);',
      '    float vert = smoothstep(-.012, .0, dy) * exp(-max(dy, 0.) * k) + exp(-abs(dy)*70.) * .5;',
      '    float rays = vn(vec2(xs*46. + fi*13., tt*.12*fi + dy*2.2));',
      '    rays = .25 + 1.1 * rays * rays * (.6 + .6*vn(vec2(xs*9. - tt*.15, fi*5.)));',
      '    float pulse = .65 + .35*sin(tt*(.27 + fi*.11) + xs*1.7 + fi*3.);',
      '    vec3 lo = mix(vec3(.05, 1., .42), vec3(.1, .9, .85), gl);',
      '    vec3 hi = mix(vec3(.9, .2, .8), vec3(.4, .5, 1.), fi*.25 + gl);',
      '    vec3 c = mix(lo, hi, smoothstep(.0, .3 + gl*.15, dy));',
      '    c = mix(c, vec3(1.), clamp(gl * .55, 0., .6));',
      '    float amp = (.42 + .05*fi) * (1. + gl * 1.6);',
      '    col += c * vert * rays * pulse * amp;',
      '  }',
      // soft pools of light under fingers / bodies
      '  col += vec3(.2, .9, .8) * gl * gl * .35 * exp(-abs(uv.y-.5)*1.5);',
      '  return col;',
      '}',
      'void main(){',
      '  vec2 uv = gl_FragCoord.xy / res; float tt = t * .6;',
      '  vec3 col;',
      '  vec4 f = texture(F, uv);',
      '  if (uv.y >= hz) {',
      '    col = sky(uv, f, tt);',
      '    float xr = uv.x * res.x / res.y;',
      '    if (uv.y < ridge(xr)) col = vec3(.0, .004, .006) + col * .02;',
      '  } else {',
      // the lake: mirror the sky, bent by the ripple gradient
      '    vec2 g = (f.gb - .5) * 2.;',
      '    float wob = .003*sin(uv.y*220. + tt*1.3 + uv.x*30.) * (1. + f.r*3.);',
      '    vec2 m = vec2(uv.x + g.x*.1 + wob, hz + (hz - uv.y) * .8 + g.y*.08);',
      '    vec4 fm = texture(F, vec2(m.x, min(m.y, .999)));',
      '    col = sky(m, fm, tt) * mix(.8, .3, smoothstep(0., hz, hz - uv.y));',
      '    float xr = m.x * res.x / res.y;',
      '    if (m.y < ridge(xr)) col = vec3(0.) + col * .02;',
      '    float depthf = (hz - uv.y) / hz;',
      '    float glint = pow(clamp(length(g) * 6., 0., 1.), 1.6);',
      '    col += vec3(.45, .85, .9) * glint * .5 * (1. - depthf*.5) + vec3(.1, .6, .6) * f.r * f.r * .12;',
      '    col *= .85 + .15 * vn(vec2(uv.x*40., uv.y*300. + tt*.2));',
      '  }',
      '  col *= bright;',
      '  col = 1. - exp(-col * 1.6);',
      '  col = pow(col, vec3(.9));',
      '  col += (hash(gl_FragCoord.xy + t) - .5) / 255.;',
      '  o = vec4(col, 1.);',
      '}'
    ].join('\n');

    function sh(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    var prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    var U = {};
    ['res', 't', 'F', 'hz', 'bright'].forEach(function(n) { U[n] = gl.getUniformLocation(prog, n); });
    var vao = gl.createVertexArray(), buf = gl.createBuffer();
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GRID_W, GRID_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // --- simulation on a coarse grid (row 0 = bottom of the picture)
    var N = GRID_W * GRID_H;
    var h = new Float32Array(N), v = new Float32Array(N), g = new Float32Array(N), target = new Float32Array(N);
    var pix = new Uint8Array(N * 4);
    var mask = new Float32Array(N), newMask = new Float32Array(N);

    function splat(x, y, amp, rad, glow) {                       // x, y in 0..1 of the window, y down
      var cx = x * (GRID_W - 1), cy = (1 - y) * (GRID_H - 1), r = Math.ceil(rad * 2.2);
      for (var j = Math.max(1, Math.floor(cy - r)); j <= Math.min(GRID_H - 2, Math.ceil(cy + r)); j++) {
        for (var i = Math.max(1, Math.floor(cx - r)); i <= Math.min(GRID_W - 2, Math.ceil(cx + r)); i++) {
          var d2 = (i - cx) * (i - cx) + (j - cy) * (j - cy) * 1.0, w = Math.exp(-d2 / (rad * rad));
          var k = j * GRID_W + i;
          v[k] -= amp * w; g[k] = Math.min(1.6, g[k] + glow * w);
        }
      }
    }
    var last = {};                                              // fingertip id -> last stamped position
    function touch(t) {
      var p = last[t.id];
      if (p && !t.first) {
        var dx = t.x - p.x, dy = t.y - p.y, n = Math.min(24, Math.max(1, Math.ceil(Math.hypot(dx * GRID_W, dy * GRID_H) / 2)));
        for (var i = 1; i <= n; i++) splat(p.x + dx * i / n, p.y + dy * i / n, TOUCH_AMP * 0.3, TOUCH_RADIUS * 0.8, 0.28);
      } else splat(t.x, t.y, TOUCH_AMP * 1.6, TOUCH_RADIUS, 0.9);
      last[t.id] = {x: t.x, y: t.y};
    }

    // --- depth: Kinect pixel -> grid cell, sampled every 4th pixel
    var DW = 128, DH = 106, cellMap = new Int32Array(DW * DH), mapAge = 1e9, lastSeq = -1, haveReg = false;
    function buildMap() {
      var reg = !!kit.toScreen(256, 212); haveReg = reg;
      for (var y = 0; y < DH; y++) for (var x = 0; x < DW; x++) {
        var u = x * 4, vv = y * 4, s = reg ? kit.toScreen(u, vv) : null, sx, sy;
        if (s) { sx = s[0]; sy = s[1]; } else { sx = 0.12 + (u / 512) * 0.76; sy = vv / 424; }
        var gx = Math.round(sx * (GRID_W - 1)), gy = Math.round((1 - sy) * (GRID_H - 1));
        cellMap[y * DW + x] = (gx < 1 || gx > GRID_W - 2 || gy < 1 || gy > GRID_H - 2) ? -1 : gy * GRID_W + gx;
      }
      mapAge = 0;
    }
    function useDepth(d) {
      if (!d.wall) return;
      if (mapAge > 90 || (!haveReg && mapAge > 20)) buildMap();
      newMask.fill(0);
      var data = d.data, wall = d.wall;
      for (var y = 0; y < DH; y++) {
        var row = y * 4 * 512;
        for (var x = 0; x < DW; x++) {
          var c = cellMap[y * DW + x]; if (c < 0) continue;
          var i = row + x * 4, z = data[i], wz = wall[i];
          if (z > 0 && wz === wz && wz - z > NEAR_MM) newMask[c] = Math.min(1, newMask[c] + 0.5);
        }
      }
      for (var k = 0; k < N; k++) {
        var nm = newMask[k], dm = nm - mask[k];
        if (nm > 0.01 && (dm > 0.3 || dm < -0.3)) v[k] -= dm * BODY_PUSH;
        mask[k] += dm * 0.35;
        if (mask[k] > 0.05) target[k] = Math.max(target[k], mask[k] * BODY_GLOW);
      }
    }

    var wakeTips = [];
    function step(dt) {
      var d = kit.depth();
      if (d && d.seq !== lastSeq) { lastSeq = d.seq; useDepth(d); }
      mapAge++;
      // a still finger keeps a faint light burning
      // (kit.touches is empty under the Kinect: contacts arrive through wake(), which keeps its own short list)
      var now = Date.now();
      for (var wq = wakeTips.length - 1; wq >= 0; wq--) if (now - wakeTips[wq].t > 900) wakeTips.splice(wq, 1);
      for (var li = 0; li < 2; li++) {
        var tl = li ? wakeTips : kit.touches;
        for (var q = 0; q < tl.length; q++) {
          var tp = tl[q], age = now - tp.t, a = Math.max(0, 1 - age / 900);
          if (a > 0) splat(tp.x, tp.y, 0, TOUCH_RADIUS * 0.7, 0.03 * a);
        }
      }
      var decay = Math.exp(-dt * GLOW_DECAY);
      for (var s = 0; s < 2; s++) {
        for (var j = 1; j < GRID_H - 1; j++) {
          for (var i = 1; i < GRID_W - 1; i++) {
            var k = j * GRID_W + i;
            v[k] = (v[k] + (h[k - 1] + h[k + 1] + h[k - GRID_W] + h[k + GRID_W] - 4 * h[k]) * WAVE_K) * WAVE_DAMP;
          }
        }
        for (var k2 = 0; k2 < N; k2++) h[k2] += v[k2];
      }
      for (var k3 = 0; k3 < N; k3++) {
        var gg = g[k3] * decay;
        if (target[k3] > gg) gg = gg + (target[k3] - gg) * 0.5;
        g[k3] = gg; target[k3] = 0;
      }
      // pack: r glow, g/b height gradient, a height
      for (var j2 = 0; j2 < GRID_H; j2++) {
        for (var i2 = 0; i2 < GRID_W; i2++) {
          var m = j2 * GRID_W + i2, o = m * 4;
          var hl = i2 > 0 ? h[m - 1] : h[m], hr = i2 < GRID_W - 1 ? h[m + 1] : h[m];
          var hd = j2 > 0 ? h[m - GRID_W] : h[m], hu = j2 < GRID_H - 1 ? h[m + GRID_W] : h[m];
          pix[o] = Math.min(255, g[m] * 160);
          pix[o + 1] = Math.max(0, Math.min(255, 128 + (hr - hl) * 500));
          pix[o + 2] = Math.max(0, Math.min(255, 128 + (hu - hd) * 500));
          pix[o + 3] = Math.max(0, Math.min(255, 128 + h[m] * 150));
        }
      }
    }

    kit.wantDepth(true);
    var time = Math.random() * 100;
    function set(opts) {
      if (!opts) return {amp: TOUCH_AMP, glow: BODY_GLOW, push: BODY_PUSH, damp: WAVE_DAMP};
      if (Number.isFinite(opts.amp)) TOUCH_AMP = Math.max(0.03, Math.min(0.4, opts.amp));
      if (Number.isFinite(opts.glow)) BODY_GLOW = Math.max(0.2, Math.min(1.5, opts.glow));
      if (Number.isFinite(opts.push)) BODY_PUSH = Math.max(0.01, Math.min(0.15, opts.push));
      if (Number.isFinite(opts.damp)) WAVE_DAMP = Math.max(0.95, Math.min(0.999, opts.damp));
      return {amp: TOUCH_AMP, glow: BODY_GLOW, push: BODY_PUSH, damp: WAVE_DAMP};
    }
    function wake(sx, sy, radius, strength) {
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
      wakeTips.push({x: sx, y: sy, t: Date.now()}); if (wakeTips.length > 6) wakeTips.shift();
      try {
        if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
        else if (typeof onTouch === 'function') onTouch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
      } catch (e) {}
    }
    window.SonnetSet = set;
    window.SonnetWake = wake;
    if (window._sonnetFx) set(window._sonnetFx);

    return {
      touch: touch,
      frame: function(dt, now) {
        time += dt * DRIFT;
        step(dt);
        var w = canvas.width, hh = canvas.height;
        gl.viewport(0, 0, w, hh);
        gl.useProgram(prog); gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_W, GRID_H, gl.RGBA, gl.UNSIGNED_BYTE, pix);
        gl.uniform1i(U.F, 0); gl.uniform2f(U.res, w, hh); gl.uniform1f(U.t, time); gl.uniform1f(U.hz, HORIZON); gl.uniform1f(U.bright, BRIGHT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      destroy: function() {
        if (window.SonnetSet === set) delete window.SonnetSet;
        if (window.SonnetWake === wake) delete window.SonnetWake;
        kit.wantDepth(false);
        gl.deleteTexture(tex); gl.deleteBuffer(buf); gl.deleteVertexArray(vao); gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs);
      }
    };
  }
});
