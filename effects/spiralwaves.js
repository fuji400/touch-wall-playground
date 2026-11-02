/* Spiral Waves -- Belousov-Zhabotinsky spirals in an excitable medium (2026-10-22, genart build-out, builder E; after jdxyw/generativeart
 * cyclicautomata.go: its palette, its Blinn-Phong relief and its iso-phase contour rings).
 *
 * The wall is a dish of BZ reagent. Waves of excitation roll out of spinning cores; where two wave trains meet they annihilate.
 * The medium is a Barkley excitable-medium model (u = activator, v = recovery) on a 640 x 400 ping-pong float texture, stepped on the
 * GPU several times per frame; the picture is the phase field shaded as a 3D relief (Blinn-Phong, ivory highlights), coloured abyss
 * trough -> cobalt wake -> turquoise crest -> mint foam, with the wave fronts drawn as thin amber contour lines (coral on the trailing
 * edge) and the spiral cores glowing magenta. It starts from the Go engine's own phasor field (charge +-1 spiral sources), so the wall
 * is full of arms from the first frame, and the real dynamics take over from there.
 *   tap  : a spiral is born under the finger (a calm pool, then a broken wavefront that curls; on an empty dish it curls at both
 *          ends into a pair), and a pulse of light sweeps out across the whole wall.
 *   drag : paints a wavefront along the path where the medium has recovered; its loose ends curl into spirals (stirring the dish).
 *   hold : a pacemaker under the still hand: target rings leave it every beat and are driven out to ~300 px whatever they meet, so a
 *          held hand clears a patch of concentric rings and pushes the spirals back; let go and the spirals flood back in.
 *   walk : people are refractory obstacles: waves cannot cross a silhouette, they diffract round it and spirals pin to its edge;
 *          step away and the waves flood the gap. A thin rim lights each outline; nothing bright is projected on a person.
 *   idle : the starting spirals keep turning; the dish spreads very slowly from a wandering spring, so old cores drift off the edges
 *          over a minute or two; untouched, every ~20 s a new spiral is born near the spring or a pacemaker beats for a while.
 * Knobs: speed (sim steps per frame), excite (excitability = Barkley threshold b), relief (shading depth), hue (colour shift).
 * Looks (2026-11-01): named presets of the seven colours, the trough ground and the three knobs. The medium stores no colour, so a
 * look recolours the whole dish at once: the palette eases over ~0.8 s, speed / excitability / relief over ~1.5 s (the waves re-tune
 * as they run); a moved knob overrides the look's value until the next look. Look 0 (reagent) is the original picture.
 * WebGL 2 + EXT_color_buffer_float, no assets, no audio, one depth client (via the host, WallBody).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning
  var SIM_W = 640, SIM_H = 400;            // the medium (fixed; the wall is 16:10)
  var BA = 0.75, EPS = 0.02;               // Barkley a and epsilon (b comes from the excite knob)
  var HS = 0.2;                            // model units per sim cell (sets the wavelength on the wall)
  var DT = 0.006;                          // model time per step (9-point Laplacian is stable below ~0.37 * HS^2)
  var WAVE_K = 0.072;                      // phase gradient of the starting field (rad per sim cell) ~ the medium's own wavelength
  var SEED_R = 56, SEED_W1 = 5, SEED_W2 = 15;   // tap: calm pool radius, excited strip width, refractory strip width (sim cells)
  var STROKE_W = 5;                        // drag: painted wavefront half-width (sim cells)
  var PACE_T = 3.0;                        // hold: a target ring leaves the hand this often (model time; a spiral turns in ~3.5)
  var PACE_REACH = 150;                    // ...and is driven out to this radius (sim cells) whatever it meets, then runs free. A pacemaker in a
                                           // spiral-filled dish is normally out-paced (the spirals set the fastest rhythm); driving its rings out
                                           // to a radius is what lets a held hand clear a patch of concentric rings and push the spirals back
  var IDLE_PACE_T = 3.4, IDLE_REACH = 105, IDLE_PACE_S = 12;   // the idle pacemaker: period, reach, how long one episode lasts
  var FLOW = 0.008;                        // the dish spreads very slowly from a wandering spring (per model time): spiral cores are carried
                                           // outward and leave at the edges after a minute or two, so the wall never clogs
  var HOLD_MS = 850, MOVE_PX = 14, DRAG_PX = 26;   // a contact still this long holds; moves beyond MOVE_PX count as moving; drags paint after DRAG_PX
  var IDLE_EVENT_S = 20;                   // untouched: every this many seconds a fresh spiral near the spring, or a pacemaker episode (alternating)
  var HOMES = [[0.30, 0.34, 1], [0.72, 0.30, -1], [0.62, 0.72, 1]];   // starting spiral sources (window x, y, chirality)

  // cyclicautomata.go's named colours (abyssTrough stays the ground; the rest turn with the hue knob)
  var PAL = [[26, 78, 152], [42, 176, 178], [164, 238, 214], [248, 186, 58], [226, 72, 54], [168, 32, 98], [255, 248, 224]];   // cobalt wave, turquoise crest, mint foam, amber front, coral pulse, magenta core, ivory specular
  // Looks: the seven colours above (they turn with the hue knob), the trough ground (0..1, does not turn) and the three knobs. Look 0 is the original.
  var LOOKS = [
    {name: 'reagent',   speed: 5, excite: 70, relief: 50,  aby: [0.039, 0.063, 0.133], pal: PAL},
    {name: 'ember',     speed: 4, excite: 60, relief: 75,  aby: [0.060, 0.014, 0.008],
     pal: [[120, 30, 10], [232, 92, 22], [255, 204, 96], [255, 242, 186], [255, 64, 30], [255, 128, 40], [255, 238, 208]]},
    {name: 'ice',       speed: 3, excite: 82, relief: 80,  aby: [0.012, 0.028, 0.072],
     pal: [[40, 92, 164], [150, 210, 255], [236, 250, 255], [178, 228, 255], [92, 140, 255], [200, 222, 255], [255, 255, 255]]},
    {name: 'neon',      speed: 7, excite: 86, relief: 20,  aby: [0.010, 0.0, 0.030],
     pal: [[64, 0, 124], [255, 0, 170], [255, 124, 232], [0, 255, 232], [255, 240, 0], [0, 200, 255], [255, 255, 255]]},
    {name: 'graphite',  speed: 5, excite: 55, relief: 100, aby: [0.022, 0.022, 0.024],
     pal: [[72, 72, 76], [142, 142, 148], [232, 232, 236], [255, 255, 255], [162, 162, 168], [204, 204, 210], [255, 255, 255]]},
    {name: 'malachite', speed: 4, excite: 76, relief: 62,  aby: [0.008, 0.055, 0.040],
     pal: [[10, 82, 52], [30, 172, 92], [192, 242, 152], [255, 212, 60], [255, 160, 30], [255, 230, 120], [255, 250, 222]]}
  ];
  var PAL_TAU = 0.25, SHAPE_TAU = 0.5;
  function hueTurn(c, deg, out, o) {          // rotate an RGB colour about the grey axis (keeps its brightness), into out[o..o+2]
    var a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), k = 0.57735, r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, d = k * (r + g + b) * (1 - ca);
    out[o] = Math.max(0, r * ca + k * (g - b) * sa + k * d); out[o + 1] = Math.max(0, g * ca + k * (b - r) * sa + k * d); out[o + 2] = Math.max(0, b * ca + k * (r - g) * sa + k * d);
  }

  registerWallPlugin({id: 'spiralwaves', title: 'Spiral Waves', author: 'Claude Opus 5.5 (genart builder E)', create: create});

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
  function refreshHue(initial) {
    var value = Number.isFinite(initial) ? initial : 0;
    return {get value() { return value; }, snap: function (v) { value = v; },
      step: function (target, dt) { var d = ((target - value + 540) % 360) - 180; if (Math.abs(d) < 0.001) { value = target % 360; return; }
        value = (value + d * (1 - Math.exp(-Math.max(0, Math.min(0.1, dt)) / 0.18)) + 360) % 360; }};
  }

  // ---------------------------------------------------------------- shaders
  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';

  // the Go engine's field: a weighted sum of spiral phasors (integer charge, no branch cut), mapped onto the medium's own cycle
  var INIT_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform vec4 uSrc[6]; uniform int uN; uniform float uK, uEnv, uCore;\nout vec4 o;\n' +
    'vec2 cyc(float s){ if(s<.03) return vec2(s/.03,0.); if(s<.45) return vec2(1.,.7*(s-.03)/.42);\n' +
    '  if(s<.48) return vec2(1.-(s-.45)/.03,.7); return vec2(0.,.7*exp(-(s-.48)/.52*3.)); }\n' +
    'void main(){ vec2 p=gl_FragCoord.xy; float sc=0., ss=0.;\n' +
    '  for(int i=0;i<6;i++){ if(i>=uN) break; vec2 d=p-uSrc[i].xy; float r=length(d), a=atan(d.y,d.x);\n' +
    '    float ph=uSrc[i].z*a-uK*r+uSrc[i].w, w=exp(-r*r/(uEnv*uEnv))*r/sqrt(r*r+uCore*uCore);\n' +
    '    sc+=w*cos(ph); ss+=w*sin(ph); }\n' +
    '  float s=fract(atan(ss,sc)/6.2831853+1.);\n' +
    '  o=vec4(cyc(s),0.,0.); }\n';

  // once per frame: the bodies (obstacle mask into .b) and this frame's taps and drags
  var STAMP_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform highp sampler2D uS; uniform sampler2D uMask; uniform mat3 uHinv; uniform vec2 uRes; uniform float uBody;\n' +
    'uniform vec4 uSeed[6]; uniform vec4 uSeedB[6]; uniform int uNS; uniform vec4 uSeg[12]; uniform int uNG; uniform float uSegW;\n' +
    'uniform vec4 uPace[8]; uniform int uNP;\nout vec4 o;\n' +
    'void main(){ vec2 p=gl_FragCoord.xy; vec4 st=texelFetch(uS,ivec2(p),0);\n' +
    '  vec3 h=uHinv*vec3(p.x/uRes.x,1.-p.y/uRes.y,1.); vec2 k=h.xy/max(h.z,1e-6);\n' +
    '  float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;\n' +
    '  st.b=smoothstep(.38,.62,texture(uMask,clamp(k,0.,1.)).r*inK)*uBody;\n' +
    '  for(int i=0;i<6;i++){ if(i>=uNS) break; vec2 d=p-uSeed[i].xy; float r=length(d), R=uSeedB[i].x;\n' +
    '    st.rg=mix(st.rg,vec2(0.),1.-smoothstep(R*.8,R,r));\n' +
    '    vec2 dir=vec2(cos(uSeed[i].z),sin(uSeed[i].z)), nr=vec2(-dir.y,dir.x)*uSeed[i].w; float t=dot(d,dir), n=dot(d,nr);\n' +
    '    float along=uSeedB[i].w*smoothstep(-1.,1.,t)*(1.-smoothstep(R*1.05,R*1.15,t));\n' +
    '    st.rg=mix(st.rg,vec2(1.,0.),along*smoothstep(-1.,0.,n)*(1.-smoothstep(uSeedB[i].y-1.,uSeedB[i].y,n)));\n' +
    '    st.rg=mix(st.rg,vec2(0.,.95),along*(1.-smoothstep(-1.,0.,n))*smoothstep(-uSeedB[i].z,1.-uSeedB[i].z,n)); }\n' +
    '  for(int j=0;j<12;j++){ if(j>=uNG) break; vec2 a=uSeg[j].xy, ab=uSeg[j].zw-a; float tt=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-4),0.,1.);\n' +
    '    float kk=1.-smoothstep(uSegW*.5,uSegW,length(p-a-ab*tt)); st.r=mix(st.r,1.,kk); st.g=mix(st.g,0.,kk*.9); }\n' +
    '  for(int k=0;k<8;k++){ if(k>=uNP) break; float kk=(1.-smoothstep(.8,2.2,abs(distance(p,uPace[k].xy)-uPace[k].z)))*uPace[k].w*step(st.r,.5); st.r=max(st.r,kk); }\n' +
    '  st.rg*=1.-st.b; o=st; }\n';

  // one Barkley step: du/dt = u(1-u)(u-(v+b)/a)/eps + lap(u), dv/dt = u - v; no flux into a body (Neumann at every outline).
  // u is kept a hair under 1: in float32 the excited state would otherwise round to exactly 1, a fixed point it never leaves.
  var SIM_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform highp sampler2D uS; uniform vec2 uRes; uniform vec3 uFlow; uniform float uDt, uA, uB, uIEps, uIH2, uCoreK;\nout vec4 o;\n' +
    'ivec2 M;\n' +
    'float nb(ivec2 q,float c){ vec4 s=texelFetch(uS,clamp(q,ivec2(0),M),0); return (1.-s.b)*(s.r-c); }\n' +
    'vec4 up(vec2 q){ q=clamp(q,vec2(0.),uRes-1.); ivec2 i=ivec2(floor(q)); vec2 f=q-floor(q);\n' +
    '  return mix(mix(texelFetch(uS,i,0),texelFetch(uS,min(i+ivec2(1,0),M),0),f.x),mix(texelFetch(uS,min(i+ivec2(0,1),M),0),texelFetch(uS,min(i+ivec2(1,1),M),0),f.x),f.y); }\n' +
    'void main(){ ivec2 p=ivec2(gl_FragCoord.xy); M=ivec2(uRes)-1; vec4 c=up(vec2(p)-(vec2(p)-uFlow.xy)*uFlow.z); c.b=texelFetch(uS,p,0).b; float u=c.r, v=c.g;\n' +
    '  float lo=nb(p+ivec2(1,0),u)+nb(p+ivec2(-1,0),u)+nb(p+ivec2(0,1),u)+nb(p+ivec2(0,-1),u);\n' +
    '  float ld=nb(p+ivec2(1,1),u)+nb(p+ivec2(-1,1),u)+nb(p+ivec2(1,-1),u)+nb(p+ivec2(-1,-1),u);\n' +
    '  float lap=(4.*lo+ld)*uIH2/6.;\n' +
    '  float du=uIEps*u*(1.-u)*(u-(v+uB)/uA)+lap;\n' +
    '  u=clamp(u+uDt*du,0.,.9999); v=clamp(v+uDt*(c.r-v),0.,1.);\n' +
    '  u*=1.-c.b; v*=1.-c.b;\n' +
    '  float core=exp(-pow((u-.5)/.26,2.))*exp(-pow((v-.36)/.12,2.));\n' +
    '  o=vec4(u,v,c.b,max(c.a*uCoreK,core)); }\n';

  // the picture: relief, palette, contour fronts, cores, bodies, tap pulses, hand marks
  var DISP_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform highp sampler2D uS; uniform vec2 uRes; uniform float uRelief; uniform vec3 uPal[7];\n' +
    'uniform vec4 uRing[4]; uniform vec4 uMark[6]; uniform int uNM;\nin vec2 vUv; out vec4 o;\n' +
    'uniform vec3 uAby;\n#define ABY uAby\n' +
    'vec4 bil(vec2 q){ ivec2 M=ivec2(uRes)-1; q=clamp(q,vec2(0.),uRes-1.); ivec2 i=ivec2(floor(q)); vec2 f=q-floor(q);\n' +
    '  vec4 a=texelFetch(uS,i,0), b=texelFetch(uS,min(i+ivec2(1,0),M),0), c=texelFetch(uS,min(i+ivec2(0,1),M),0), d=texelFetch(uS,min(i+ivec2(1,1),M),0);\n' +
    '  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }\n' +
    'float hgt(vec4 s){ return .42*s.r+.62*s.g; }\n' +
    'float line(float f,float iso,float w){ float d=abs(f-iso)/max(fwidth(f),1e-4); return exp(-d*d/(w*w)); }\n' +
    'void main(){ vec3 COB=uPal[0], TURQ=uPal[1], MINT=uPal[2], AMB=uPal[3], COR=uPal[4], MAG=uPal[5], IVO=uPal[6]; vec2 q=vUv*uRes-.5;\n' +
    '  vec4 s=bil(q); float hx=hgt(bil(q+vec2(1.,0.)))-hgt(bil(q-vec2(1.,0.))), hy=hgt(bil(q+vec2(0.,1.)))-hgt(bil(q-vec2(0.,1.)));\n' +
    '  float u=s.r, v=s.g, ob=s.b, h0=hgt(s);\n' +
    '  vec3 n=normalize(vec3(-.5*uRelief*vec2(hx,hy),1.)), L=normalize(vec3(-.55,.60,.58));\n' +
    '  float ndl=clamp(dot(n,L),0.,1.), spec=pow(ndl,14.);\n' +
    '  float exc=smoothstep(.2,.8,u), tail=smoothstep(.03,.65,v);\n' +
    '  vec3 col=mix(ABY,COB*.62,tail*(1.-exc));\n' +
    '  col=mix(col,mix(MINT*.8,TURQ*.38,smoothstep(.0,.6,v)),exc);\n' +
    '  col*=.34+.9*ndl;\n' +
    '  col=mix(col,IVO,clamp(spec*.75,0.,1.)*step(.08,spec));\n' +
    '  float lf=line(u,.5,1.15), front=lf*(1.-smoothstep(.2,.45,v)), back=lf*smoothstep(.35,.6,v);\n' +
    '  float hair=line(h0,.2,.8);\n' +
    '  vec2 px=vec2(vUv.x*1280.,(1.-vUv.y)*800.); float pulse=0.;\n' +
    '  for(int i=0;i<4;i++){ float d=length(px-uRing[i].xy)-uRing[i].z; pulse+=exp(-d*d/3200.)*uRing[i].w; }\n' +
    '  col+=AMB*front*(.85+1.6*pulse)+COR*back*(.42+1.2*pulse)+IVO*hair*(.09+.5*pulse);\n' +
    '  col*=1.+.8*pulse; col+=COR*.13*pulse;\n' +
    '  col+=MAG*smoothstep(.12,.9,s.a)*.85;\n' +
    '  float rim=line(ob,.5,1.4)+.3*line(ob,.5,7.);\n' +
    '  col*=1.-.9*smoothstep(.3,.75,ob); col+=TURQ*rim*.6;\n' +
    '  for(int j=0;j<6;j++){ if(j>=uNM) break; float d=length(px-uMark[j].xy), rr=15.+5.*uMark[j].w;\n' +
    '    col+=COR*exp(-pow((d-rr)/2.2,2.))*uMark[j].z*.75+AMB*exp(-d*d/60.)*uMark[j].z*.35; }\n' +
    '  col=max(col,0.);\n' +
    '  o=vec4(1.-exp(-col*1.2),1.); }\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Spiral Waves needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Spiral Waves needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Spiral Waves needs EXT_color_buffer_float');
    var made = [], dead = false;

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    function program(fsSrc) {
      var p = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, fsSrc);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(e); }
      made.push(['Program', p]);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    function texture(w, h, ifmt, fmt, type, filter) {
      var t = gl.createTexture(); made.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function target(t) {
      var f = gl.createFramebuffer(); made.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Spiral Waves: framebuffer incomplete');
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    }

    var P = {init: program(INIT_FS), stamp: program(STAMP_FS), sim: program(SIM_FS), disp: program(DISP_FS)};
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);
    var SW = SIM_W, SH = SIM_H, st = [], fb = [], cur = 0;
    for (var k = 0; k < 2; k++) { st[k] = texture(SW, SH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST); fb[k] = target(st[k]); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    var BW = WallBody.w, BH = WallBody.h, body = WallBody.create(kit, {}), maskBytes = new Uint8Array(BW * BH);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var maskTex = texture(BW, BH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, maskBytes);

    var settings = {look: 0, speed: 5, excite: 70, relief: 50, hue: 0};
    var LK = LOOKS[0], over = {speed: false, excite: false, relief: false}, looks = 0;   // a moved knob overrides the look until the next look
    var ek = {speed: LK.speed, excite: LK.excite, relief: LK.relief};
    var palNow = LK.pal.map(function (c) { return c.slice(); }), abyNow = new Float32Array(LK.aby);
    function want(k) { return over[k] ? settings[k] : LK[k]; }
    function applyLook(i) { LK = LOOKS[i]; over.speed = over.excite = over.relief = false; looks++; }
    function stepLook(dt) {
      var ks = 1 - Math.exp(-dt / SHAPE_TAU), kp = 1 - Math.exp(-dt / PAL_TAU);
      ek.speed += (want('speed') - ek.speed) * ks; ek.excite += (want('excite') - ek.excite) * ks; ek.relief += (want('relief') - ek.relief) * ks;
      for (var i = 0; i < 7; i++) for (var c = 0; c < 3; c++) palNow[i][c] += (LK.pal[i][c] - palNow[i][c]) * kp;
      for (var g = 0; g < 3; g++) abyNow[g] += (LK.aby[g] - abyNow[g]) * kp;
    }
    function snapLook() {
      palNow = LK.pal.map(function (c) { return c.slice(); }); abyNow.set(LK.aby);
      ek.speed = want('speed'); ek.excite = want('excite'); ek.relief = want('relief');
    }
    var hueFlow = refreshHue(0), input = refreshContacts(kit, 120);
    var time = 0, frames = 0, stepAcc = 0, stepsTotal = 0, lastSteps = 0, frameMs = 0;
    var tracks = [], nextTrack = 1, rings = [], chir = 1, lastInput = -1e9, idleAt = 0, idleN = 0, idlePace = null;
    var seeds = [], segs = [], pacing = [], marks = [], counts = {taps: 0, seeds: 0, strokes: 0, holds: 0, beats: 0, reseeds: 0, idlePaces: 0};
    var seedU = new Float32Array(24), seedBU = new Float32Array(24), segU = new Float32Array(48), paceU = new Float32Array(32);
    var ringU = new Float32Array(16), markU = new Float32Array(24), srcU = new Float32Array(24), palU = new Float32Array(21);
    var bodyCount = 0, bodyCells = 0, spring = [0.5, 0.5], pacer = [0.5, 0.5];

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function simX(x) { return x * SW; }
    function simY(y) { return (1 - y) * SH; }
    function barkleyB() { return 0.1 - 0.0008 * ek.excite; }
    function modelT() { return stepsTotal * DT; }

    function seedField() {                     // the Go engine's phasor field as the starting condition
      var n = HOMES.length;
      for (var i = 0; i < n; i++) { srcU[i * 4] = simX(HOMES[i][0]); srcU[i * 4 + 1] = simY(HOMES[i][1]); srcU[i * 4 + 2] = HOMES[i][2]; srcU[i * 4 + 3] = i * 1.7; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb[cur]); gl.viewport(0, 0, SW, SH);
      gl.useProgram(P.init.p); gl.bindVertexArray(vao);
      gl.uniform4fv(P.init.u.uSrc, srcU); gl.uniform1i(P.init.u.uN, n);
      gl.uniform1f(P.init.u.uK, WAVE_K); gl.uniform1f(P.init.u.uEnv, 150); gl.uniform1f(P.init.u.uCore, 5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    seedField();

    function seedSpiral(x, y, angle, c) {      // a calm pool with a broken wavefront whose free end sits at (x, y)
      if (seeds.length >= 6) return;
      seeds.push([simX(x), simY(y), angle, c, SEED_R, SEED_W1, SEED_W2, 1]); counts.seeds++;
    }
    function ringSpeed() {                     // sim cells per model time: the medium's own front speed, a touch faster (it scales with excitability)
      var b = barkleyB(); return 21 * (0.5 - b / BA) / (0.5 - 0.047 / BA);
    }
    function beat(x, y, reach) {               // a pacemaker beat: a ring driven out from (x, y) to reach (sim cells), then free
      if (pacing.length >= 8) pacing.shift();
      pacing.push({x: simX(x), y: simY(y), t0: modelT(), reach: reach}); counts.beats++;
    }
    var lastTapAt = -Infinity;
    function tap(x, y, now) {
      if (now - lastTapAt < 300) return;
      lastTapAt = now;
      counts.taps++; lastInput = now;
      var ang = Math.atan2(simY(y) - SH * 0.5, simX(x) - SW * 0.5) + Math.PI * 0.5 * chir;   // the front runs roughly round the wall centre
      seedSpiral(x, y, ang, chir); chir = -chir;
      rings.push({x: x * 1280, y: y * 800, t0: now}); if (rings.length > 4) rings.shift();
    }

    function updateTracks(pts, now) {
      for (var i = 0; i < tracks.length; i++) tracks[i].used = false;
      for (var j = 0; j < pts.length; j++) {
        var p = pts[j], best = null, bd = 0.09;
        for (var q = 0; q < tracks.length; q++) {
          var t = tracks[q]; if (t.used) continue;
          var d = Math.hypot(t.x - p[0], (t.y - p[1]) * 0.625); if (d < bd) { bd = d; best = t; }
        }
        if (!best) {
          best = {id: nextTrack++, x: p[0], y: p[1], ax: p[0], ay: p[1], x0: p[0], y0: p[1], t0: now, lastMove: now, lx: -1, ly: -1, drag: false, hold: false, beatAt: -1e9};
          tracks.push(best); tap(p[0], p[1], now);
        }
        best.used = true; best.x = p[0]; best.y = p[1];
      }
      tracks = tracks.filter(function (t) { return t.used; });
      var mt = modelT();
      for (var m = 0; m < tracks.length; m++) {
        var tr = tracks[m], mx = (tr.x - tr.ax) * 1280, my = (tr.y - tr.ay) * 800;
        if (Math.hypot(mx, my) > MOVE_PX) { tr.ax = tr.x; tr.ay = tr.y; tr.lastMove = now; }
        if (!tr.drag && Math.hypot((tr.x - tr.x0) * 1280, (tr.y - tr.y0) * 800) > DRAG_PX) { tr.drag = true; tr.lx = tr.x; tr.ly = tr.y; }
        var still = now - tr.lastMove;
        var wasHold = tr.hold; tr.hold = still > HOLD_MS;
        if (tr.hold && !wasHold) { counts.holds++; tr.beatAt = -1e9; }
        if (tr.hold || still > 300) lastInput = now;
        if (tr.drag && !tr.hold && segs.length < 12) {
          var sx = (tr.x - tr.lx) * 1280, sy = (tr.y - tr.ly) * 800;
          if (Math.hypot(sx, sy) > 3) { segs.push([simX(tr.lx), simY(tr.ly), simX(tr.x), simY(tr.y)]); tr.lx = tr.x; tr.ly = tr.y; counts.strokes++; lastInput = now; }
        }
        if (tr.hold && mt - tr.beatAt >= PACE_T) { tr.beatAt = mt; beat(tr.x, tr.y, PACE_REACH); }
        if (marks.length < 6) marks.push([tr.x * 1280, tr.y * 800, clamp((still - 250) / (HOLD_MS - 250), 0, 1), tr.hold ? Math.exp(-(mt - tr.beatAt) * 2) : 0]);
      }
    }

    function idle(now) {
      // the spring: the dish spreads slowly from here (see FLOW). Untouched, every IDLE_EVENT_S either a fresh spiral is born a little
      // way from the spring (it is carried off and leaves at an edge a minute or two later), or a pacemaker beats for IDLE_PACE_S at a
      // wandering spot: a few spirals and one pacemaker keep the wall going for hours without clogging it
      spring[0] = 0.5 + 0.17 * Math.sin(time * 0.021); spring[1] = 0.5 + 0.13 * Math.sin(time * 0.017 + 1);
      if (idlePace && time > idlePace.until) idlePace = null;
      if (now - lastInput > IDLE_EVENT_S * 1000 && time - idleAt > IDLE_EVENT_S) {
        idleAt = time; idleN++;
        var ga = idleN * 2.39996;
        if (idleN % 2) { counts.reseeds++; seedSpiral(clamp(spring[0] + 0.16 * Math.cos(ga), 0.1, 0.9), clamp(spring[1] + 0.2 * Math.sin(ga), 0.12, 0.88), ga * 1.7, idleN % 4 === 1 ? 1 : -1); }
        else { counts.idlePaces++; idlePace = {x: 0.5 + 0.33 * Math.sin(time * 0.013 + 2), y: 0.5 + 0.27 * Math.sin(time * 0.0095 + 0.5), until: time + IDLE_PACE_S, at: -1e9}; }
      }
      var mt = modelT();
      if (idlePace && mt - idlePace.at >= IDLE_PACE_T) { idlePace.at = mt; beat(idlePace.x, idlePace.y, IDLE_REACH); }
    }

    function pass(prog, src) {                 // src texture -> the other buffer, then swap
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb[1 - cur]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st[cur]); gl.uniform1i(prog.u.uS, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = 1 - cur;
    }

    function frame(dt, now) {
      if (dead) return;
      var t0 = performance.now();
      dt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1); time += dt; frames++;
      if (!Number.isFinite(now)) now = performance.now();
      hueFlow.step(settings.hue, dt);
      stepLook(dt);
      var fresh = body.update(dt, now);
      if (fresh || !body.fresh) {
        var mk = body.mask; bodyCells = 0;
        for (var i = 0; i < maskBytes.length; i++) { var mv = mk[i]; maskBytes[i] = mv > 0 ? Math.round(Math.min(1, mv) * 255) : 0; if (mv > 0.5) bodyCells++; }
        gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, maskBytes);
      }
      bodyCount = body.fresh ? body.people.length : 0;
      seeds.length = 0; segs.length = 0; marks.length = 0;
      updateTracks(input.read(), now);
      idle(now);
      rings = rings.filter(function (r) { return now - r.t0 < 2600; });

      // ---- GPU: stamp, steps, picture
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(vao);
      gl.viewport(0, 0, SW, SH);
      var ns = Math.min(6, seeds.length), ng = Math.min(12, segs.length), np = 0, a, mtNow = modelT(), vr = ringSpeed();
      for (a = 0; a < ns; a++) { seedU.set(seeds[a].slice(0, 4), a * 4); seedBU.set(seeds[a].slice(4, 8), a * 4); }
      for (a = 0; a < ng; a++) segU.set(segs[a], a * 4);
      pacing = pacing.filter(function (pr) { return vr * (mtNow - pr.t0) <= pr.reach; });
      for (a = 0; a < pacing.length && np < 8; a++) {
        var pr = pacing[a], rr = vr * (mtNow - pacing[a].t0);
        paceU.set([pr.x, pr.y, rr, clamp((pr.reach - rr) / 12, 0, 1)], np * 4); np++;
      }
      gl.useProgram(P.stamp.p);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(P.stamp.u.uMask, 1);
      gl.uniformMatrix3fv(P.stamp.u.uHinv, false, body.hinv()); gl.uniform2f(P.stamp.u.uRes, SW, SH); gl.uniform1f(P.stamp.u.uBody, 1);
      gl.uniform4fv(P.stamp.u.uSeed, seedU); gl.uniform4fv(P.stamp.u.uSeedB, seedBU); gl.uniform1i(P.stamp.u.uNS, ns);
      gl.uniform4fv(P.stamp.u.uSeg, segU); gl.uniform1i(P.stamp.u.uNG, ng); gl.uniform1f(P.stamp.u.uSegW, STROKE_W);
      gl.uniform4fv(P.stamp.u.uPace, paceU); gl.uniform1i(P.stamp.u.uNP, np);
      pass(P.stamp);

      stepAcc += ek.speed * dt * 60;
      var n = Math.min(Math.floor(stepAcc), Math.round(ek.speed) * 2 + 2); stepAcc = Math.min(stepAcc - n, 2);
      gl.useProgram(P.sim.p);
      gl.uniform2f(P.sim.u.uRes, SW, SH); gl.uniform1f(P.sim.u.uDt, DT); gl.uniform1f(P.sim.u.uA, BA); gl.uniform1f(P.sim.u.uB, barkleyB());
      gl.uniform1f(P.sim.u.uIEps, 1 / EPS); gl.uniform1f(P.sim.u.uIH2, 1 / (HS * HS));
      gl.uniform1f(P.sim.u.uCoreK, Math.exp(-dt / Math.max(1, n) / 0.45));
      gl.uniform3f(P.sim.u.uFlow, simX(spring[0]), simY(spring[1]), FLOW * DT);
      for (var s = 0; s < n; s++) pass(P.sim);
      lastSteps = n; stepsTotal += n;

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(P.disp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st[cur]); gl.uniform1i(P.disp.u.uS, 0);
      gl.uniform2f(P.disp.u.uRes, SW, SH); gl.uniform1f(P.disp.u.uRelief, 4 + ek.relief * 0.32);
      for (a = 0; a < 7; a++) hueTurn(palNow[a], hueFlow.value, palU, a * 3);
      gl.uniform3fv(P.disp.u.uPal, palU); gl.uniform3fv(P.disp.u.uAby, abyNow);
      ringU.fill(0);
      for (a = 0; a < rings.length && a < 4; a++) { var age = (now - rings[a].t0) / 1000; ringU.set([rings[a].x, rings[a].y, age * 760, 0.9 * Math.exp(-age * 1.25)], a * 4); }
      gl.uniform4fv(P.disp.u.uRing, ringU);
      var nm = Math.min(6, marks.length); for (a = 0; a < nm; a++) markU.set(marks[a], a * 4);
      gl.uniform4fv(P.disp.u.uMark, markU); gl.uniform1i(P.disp.u.uNM, nm);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      frameMs = performance.now() - t0;
    }

    function set(o) {
      if (o && !dead) {
        var lim = {look: [0, LOOKS.length - 1], speed: [1, 12], excite: [0, 100], relief: [0, 100], hue: [0, 360]};
        var lk = o.look;                         // the look first: it clears the knob overrides
        if (typeof lk === 'number' && Number.isFinite(lk)) { var li = Math.round(clamp(lk, lim.look[0], lim.look[1])); if (li !== settings.look) { settings.look = li; applyLook(li); } }
        ['speed', 'excite', 'relief'].forEach(function (key) {   // a knob that MOVED overrides the look's own value until the next look
          var v = o[key]; if (typeof v !== 'number' || !Number.isFinite(v)) return;
          v = clamp(v, lim[key][0], lim[key][1]); if (v !== settings[key]) { settings[key] = v; over[key] = true; }
        });
        var hv = o.hue; if (typeof hv === 'number' && Number.isFinite(hv)) settings.hue = clamp(hv, lim.hue[0], lim.hue[1]);
      }
      return {look: settings.look, speed: settings.speed, excite: settings.excite, relief: settings.relief, hue: settings.hue};
    }
    function destroy() {
      if (dead) return; dead = true;
      if (window.SpiralwavesSet === set) delete window.SpiralwavesSet;
      kit.wantDepth(false); input.clear(); tracks = []; rings = [];
      made.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); made = [];
    }

    kit.wantDepth(true);
    var out = {frame: frame, touch: function (t) { if (t && !dead) input.wake(t.x, t.y); }, destroy: destroy};
    if (window.WallTest) out.debug = function (probe) {
      var r = {frames: frames, steps: lastSteps, stepsTotal: stepsTotal, frameMs: +frameMs.toFixed(2), contacts: tracks.length,
        tracks: tracks.map(function (t) { return {id: t.id, x: +t.x.toFixed(3), y: +t.y.toFixed(3), drag: t.drag, hold: t.hold}; }),
        counts: Object.assign({}, counts), bodyCount: bodyCount, bodyCells: bodyCells, b: +barkleyB().toFixed(4), displayHue: +hueFlow.value.toFixed(2),
        look: LK.name, looks: looks, overrides: Object.assign({}, over), eased: {speed: +ek.speed.toFixed(2), excite: +ek.excite.toFixed(2), relief: +ek.relief.toFixed(2)},
        settings: set(), destroyed: dead, input: input.state};
      if (probe && probe.at && !dead) {        // test only: one cell of the medium (window x, y)
        var one = new Float32Array(4), px = clamp(Math.floor(simX(probe.at[0])), 0, SW - 1), py = clamp(Math.floor(simY(probe.at[1])), 0, SH - 1);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb[cur]); gl.readPixels(px, py, 1, 1, gl.RGBA, gl.FLOAT, one); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        r.at = [one[0], one[1]]; r.modelT = stepsTotal * DT; return r;
      }
      if (probe && !dead) {                    // test only: read the medium back (a GPU stall; never called by the wall)
        var buf = new Float32Array(SW * SH * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb[cur]); gl.readPixels(0, 0, SW, SH, gl.RGBA, gl.FLOAT, buf); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        var exc = 0, obs = 0, rest = 0, nan = 0, cores = 0, G = 16, gx, gy, cells = {};
        for (var y = 0; y < SH; y++) for (var x = 0; x < SW; x++) {
          var i4 = (y * SW + x) * 4, u = buf[i4], v = buf[i4 + 1];
          if (!(u === u) || !(v === v)) { nan++; continue; }
          if (u > 0.5) exc++; if (buf[i4 + 2] > 0.5) obs++; if (u < 0.1 && v < 0.1) rest++;
          if (buf[i4 + 3] > 0.6) { gx = (x / G) | 0; gy = (y / G) | 0; cells[gx + ',' + gy] = 1; }
        }
        cores = Object.keys(cells).length;
        r.medium = {excited: +(exc / (SW * SH)).toFixed(3), obstacle: +(obs / (SW * SH)).toFixed(3), rest: +(rest / (SW * SH)).toFixed(3), coreCells: cores, nan: nan};
        r.glError = gl.getError();
      }
      return r;
    };
    if (window.WallTest) out.test = {calm: function () {   // test only: a resting dish (no waves), to watch one gesture alone
      for (var q = 0; q < 2; q++) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb[q]); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); pacing = []; idlePace = null;
    }, idleOff: function () { lastInput = 1e15; idlePace = null; }};
    window.SpiralwavesSet = set;
    if (window._spiralwavesFx) set(window._spiralwavesFx);
    LK = LOOKS[settings.look]; snapLook(); hueFlow.snap(settings.hue);   // start on the stored look and knobs without easing in
    return out;
  }
})();
