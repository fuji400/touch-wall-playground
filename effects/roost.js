/* Roost — stand still and birds land on your shadow (2026-10-05; concept #1 of the fx-research report, built by Claude (fx-batch)).
 * A small flock of pale birds wheels across a dim dusk wall; some rest along the bottom edge of the picture, pecking.
 * Step in and the top of your outline lights up with a thin rim, cool at first. Hold still and it warms to gold, and birds come
 * down out of the flock one by one to perch along it: on your head, your shoulders, an arm held out like a branch. Perched birds
 * glow warm, preen, peck and look around. Move and the birds right where you moved burst off, startling their neighbours, and
 * fly back into the flock, still glowing for a moment, shaking a few feathers loose. A big move sends them all.
 * Whoever is stillest gets the birds first; a whole family standing still gets covered, but the flock always keeps some birds in
 * the sky. A fingertip on the wall offers seed (a few golden grains): two or three birds come and hover over it, pecking.
 * Nothing is projected inside a person (DARK_INSIDE). Needs plugins/body.js (WallBody). WebGL 2, no assets, no audio.
 * How: birds are simulated on the CPU (a few hundred, flocking on a grid), drawn as one instanced pass of hand-drawn sprites
 * (twelve poses drawn once into a texture at start); the body stage's outline is resampled onto a wall grid, where "the top of
 * your outline" is every place the person map starts going downwards, so up is always up on the wall.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs (sizes in px on a 1280-wide picture)
  var BIRDS = 190;               // birds in the flock
  var PERCH_PX = 42;             // size of a perched bird
  var FLY_PX = 46;               // size of a flying bird (about its wingspan)
  var SPEED = 150;               // flock cruising speed (px per second)
  var CALM_MOVE = 0.06;          // a person whose outline changes less than this counts as still (the body stage's own
                                 // stillness clock resets at 0.035, too strict for a fidgety child)
  var LAND_AFTER_S = 0.5;        // stillness needed before the first bird sets off towards you (s)
  var LAND_RATE = 2.6;           // birds per second sent to someone standing fully still
  var FIDGET_EASE = 0.1;         // the stillest person present gets birds fastest; someone moving more gets them more slowly.
                                 // Lower = the stillest wins more clearly (it compares people with each other, not with a fixed
                                 // number, so a noisy Kinect that makes everyone look a bit restless treats them all alike)
  var PER_PERSON = 24;           // most birds on one person
  var RESERVE = 0.3;             // share of the flock that always stays in the sky, so the next still person gets birds too
  var GAP_PX = 27;               // room each perched bird keeps to itself along your outline
  var STARTLE = 0.35;            // movement right under a perched bird that makes it fly (0..1; raise it if a real Kinect's
                                 // edge noise keeps birds from settling)
  var SCATTER_MOVE = 0.14;       // a whole-person move this big sends every bird on that person off at once
  var CONTAGION = 0.7;           // chance a takeoff startles the bird next to it (the ripple when birds scatter)
  var LEDGE = 0.35;              // share of the flock that likes to rest along the bottom edge of the picture when nobody is near
  var RIM = 1.0;                 // brightness of the line along the top of your outline
  var HALO = 0.42;               // brightness of the warm glow just above your outline
  var HALO_CELLS = 2.2;          // how tightly that glow hugs the outline (higher = tighter)
  var FLOCK_GLOW = 1.0;          // brightness of the wheeling flock (keep it dim: the strongest light belongs to people)
  var LIT_FADE_S = 0.7;          // how long a scattered bird keeps glowing as it flies back to the flock (time constant, s)
  var FEATHERS = 0.5;            // feathers shaken loose per bird that scatters off a person
  var SEED_BIRDS = 3;            // birds that come to a fingertip's seed
  var SEED_LINGER_S = 2.5;       // the seed stays this long after the fingertip leaves
  var DARK_INSIDE = 1.0;         // no light inside a person (1 = none, 0 = off)

  registerWallPlugin({id: 'roost', title: 'Roost', author: 'Claude (fx-batch), fx-research concept #1', create: create});

  // ---------------------------------------------------------------- colours (linear-ish 0..1)
  var COOL = [0.115, 0.13, 0.178];     // the flock: pale slate, about 33/255 luma
  var WARM = [1.0, 0.89, 0.70];        // a bird on a person: warm ivory
  var GOLD = [1.0, 0.74, 0.30];        // seed

  // ---------------------------------------------------------------- sprite atlas: 12 hand-drawn poses, 4 x 4 cells of 128 px
  var F_UP = 0, F_MID = 1, F_GLIDE = 2, F_DOWN = 3, L_FLARE = 4, H_DOWN = 5, P_SIT = 6, P_PECK = 7, P_LOOK = 8, P_FLICK = 9, FEATHER = 10, SEED = 11;
  var atlasCache = null;
  function wing(c, r0x, r0y, r1x, r1y, tx, ty, lx, ly, kx, ky) { c.moveTo(r0x, r0y); c.quadraticCurveTo(lx, ly, tx, ty); c.quadraticCurveTo(kx, ky, r1x, r1y); c.closePath(); }
  function flyBody(c) {
    c.moveTo(117, 62); c.lineTo(104, 57); c.quadraticCurveTo(99, 50, 91, 52);
    c.bezierCurveTo(80, 54, 60, 55, 46, 59); c.lineTo(12, 50); c.lineTo(28, 64); c.lineTo(12, 79); c.lineTo(46, 69);
    c.bezierCurveTo(60, 75, 82, 75, 94, 69); c.quadraticCurveTo(102, 67, 104, 65); c.closePath();
  }
  function sitBody(c) {
    c.moveTo(111, 52); c.lineTo(98, 46); c.bezierCurveTo(95, 35, 84, 31, 76, 35); c.bezierCurveTo(68, 39, 63, 47, 56, 55);
    c.bezierCurveTo(48, 63, 40, 73, 32, 81); c.lineTo(7, 105); c.lineTo(14, 112); c.lineTo(38, 96);
    c.bezierCurveTo(46, 104, 62, 108, 74, 104); c.bezierCurveTo(90, 98, 99, 82, 97, 66); c.lineTo(98, 57); c.closePath();
  }
  function legs(c) { c.moveTo(60, 102); c.lineTo(58, 118); c.moveTo(52, 118); c.lineTo(64, 118); c.moveTo(71, 102); c.lineTo(73, 118); c.moveTo(67, 118); c.lineTo(79, 118); }
  var POSES = [
    function (c, P) { P(flyBody); P(function (c) { wing(c, 86, 58, 70, 59, 82, 9, 94, 34, 72, 38); }); P(function (c) { wing(c, 80, 61, 56, 61, 50, 5, 78, 22, 52, 40); }); },     // wings up
    function (c, P) { P(flyBody); P(function (c) { wing(c, 84, 59, 68, 60, 58, 22, 82, 32, 66, 50); }); P(function (c) { wing(c, 80, 61, 56, 62, 28, 25, 66, 28, 46, 54); }); },   // wings half up
    function (c, P) { P(flyBody); P(function (c) { wing(c, 82, 60, 56, 63, 16, 40, 56, 40, 40, 62); }); },                                                                        // glide
    function (c, P) { P(flyBody); P(function (c) { wing(c, 86, 64, 70, 64, 74, 114, 92, 92, 72, 84); }); P(function (c) { wing(c, 80, 64, 56, 64, 46, 120, 80, 100, 52, 84); }); }, // wings down
    function (c, P) {                                                                                                               // landing flare
      P(function (c) { c.save(); c.translate(62, 72); c.rotate(-0.62); c.translate(-64, -64); flyBody(c); c.restore(); });
      P(function (c) { wing(c, 76, 52, 66, 60, 96, 6, 98, 30, 80, 42); }); P(function (c) { wing(c, 74, 54, 60, 62, 56, 4, 82, 20, 54, 36); });
      P(function (c) { c.moveTo(62, 80); c.lineTo(76, 104); c.moveTo(70, 104); c.lineTo(82, 104); c.moveTo(68, 78); c.lineTo(84, 100); }, true);
    },
    function (c, P) {                                                                                                               // hover, wings down
      P(function (c) { c.save(); c.translate(62, 66); c.rotate(-0.55); c.translate(-64, -64); flyBody(c); c.restore(); });
      P(function (c) { wing(c, 76, 50, 64, 58, 82, 112, 94, 88, 74, 74); }); P(function (c) { wing(c, 72, 52, 58, 60, 44, 110, 76, 92, 50, 74); });
      P(function (c) { c.moveTo(60, 76); c.lineTo(70, 98); c.moveTo(66, 74); c.lineTo(78, 94); }, true);
    },
    function (c, P) { P(sitBody); P(legs, true); },                                                                                  // perched
    function (c, P) {                                                                                                               // pecking
      P(function (c) { c.moveTo(117, 101); c.lineTo(104, 88); c.bezierCurveTo(104, 76, 96, 66, 86, 66); c.bezierCurveTo(74, 64, 62, 62, 50, 66);
        c.bezierCurveTo(42, 68, 34, 70, 26, 72); c.lineTo(4, 61); c.lineTo(6, 70); c.lineTo(30, 87); c.bezierCurveTo(44, 101, 62, 108, 76, 104);
        c.bezierCurveTo(86, 102, 94, 100, 98, 96); c.lineTo(104, 99); c.closePath(); });
      P(legs, true);
    },
    function (c, P) {                                                                                                               // looking back
      P(function (c) { c.moveTo(53, 40); c.lineTo(68, 35); c.bezierCurveTo(71, 27, 84, 26, 90, 34); c.bezierCurveTo(96, 42, 97, 52, 95, 62);
        c.bezierCurveTo(99, 82, 90, 98, 74, 104); c.bezierCurveTo(62, 108, 46, 104, 38, 96); c.lineTo(14, 112); c.lineTo(7, 105); c.lineTo(32, 81);
        c.bezierCurveTo(40, 73, 50, 61, 61, 52); c.lineTo(68, 46); c.closePath(); });
      P(legs, true);
    },
    function (c, P) { P(sitBody); P(function (c) { wing(c, 72, 56, 46, 72, 22, 26, 52, 32, 32, 60); }); P(legs, true); },             // wing flick
    function (c, P) {                                                                                                               // feather
      P(function (c) { c.moveTo(38, 98); c.bezierCurveTo(28, 68, 56, 32, 98, 18); c.bezierCurveTo(86, 52, 66, 84, 38, 98); c.closePath(); });
      P(function (c) { c.moveTo(28, 110); c.lineTo(44, 92); }, true);
    },
    function (c, P) { P(function (c) { c.ellipse(64, 64, 40, 26, -0.4, 0, Math.PI * 2); }); }                                       // seed
  ];
  function buildAtlas() {
    if (atlasCache) return atlasCache;
    var S = 128, cv = document.createElement('canvas'); cv.width = cv.height = 512;
    var c = cv.getContext('2d');
    function pass(outline) {
      c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#000'; c.fillRect(0, 0, 512, 512);
      c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.lineCap = 'round';
      POSES.forEach(function (draw, idx) {
        c.save(); c.translate((idx % 4) * S, Math.floor(idx / 4) * S); c.beginPath(); c.rect(2, 2, S - 4, S - 4); c.clip();
        draw(c, function (path, line) {
          c.beginPath(); path(c);
          if (line) { c.lineWidth = outline ? 15 : 5; c.stroke(); } else { c.fill(); if (outline) { c.lineWidth = 10; c.stroke(); } }
        });
        c.restore();
      });
      return c.getImageData(0, 0, 512, 512).data;
    }
    var a = pass(false), b = pass(true), out = new Uint8Array(512 * 512 * 4);
    for (var i = 0; i < 512 * 512; i++) { out[i * 4] = a[i * 4]; out[i * 4 + 1] = b[i * 4]; out[i * 4 + 3] = 255; }
    atlasCache = {data: out, canvas: cv};
    return atlasCache;
  }
  // where a pose's anchor sits in its cell (cell units from the centre; y down): perched birds stand on their feet
  var ANCHOR_Y = [0, 0, 0, 0, 0.30, 0.22, 0.42, 0.42, 0.42, 0.42, 0, 0];

  // ---------------------------------------------------------------- shaders
  var VS_FULL = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var FS_SKY = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uBody; uniform mat3 uHinv; uniform float uTime, uAspect, uPx, uRim, uHalo, uHaloCells, uDark, uWall; uniform vec2 uStep;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'vec4 at(vec2 w){vec3 h=uHinv*vec3(w,1.); vec2 k=h.xy/max(h.z,1e-6); float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.; return texture(uBody,clamp(k,0.,1.))*inK;}\n' +
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' +
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}\n' +
    'void main(){\n' +
    '  vec2 w=vec2(vUv.x,1.-vUv.y);\n' +                                     // window coordinates, y down
    '  vec4 b=at(w); float m=b.r, soft=b.g, pres=b.b, warm=b.a;\n' +
    // the dusk wall: deep blue overhead, a little plum low down, slow faint cloud banks
    '  vec2 q=vec2(w.x*uAspect,w.y);\n' +
    '  float cl=noise(q*vec2(1.4,4.5)+vec2(uTime*.007,0.))*.6+noise(q*vec2(3.1,10.)-vec2(uTime*.011,0.))*.4;\n' +
    '  vec3 col=mix(vec3(.011,.012,.030),vec3(.044,.026,.050),smoothstep(.1,1.,w.y))*(.78+.5*cl)*uWall;\n' +
    // the top of the outline: where the softened person map grows downwards on the wall (a wide difference, so the
    // Kinect's 4-pixel staircase on a near-vertical edge never reads as a little ledge)
    '  vec2 g=vec2(at(w+vec2(uStep.x,0.)).g-at(w-vec2(uStep.x,0.)).g, at(w+vec2(0.,uStep.y)).g-at(w-vec2(0.,uStep.y)).g);\n' +
    '  float top=clamp(g.y/max(length(g),.03),0.,1.); top=smoothstep(.35,.95,top);\n' +
    '  float d=abs(m-.5)/max(fwidth(m),1e-4), lw=1.25*uPx; float line=exp(-d*d/(lw*lw))*smoothstep(.02,.15,pres);\n' +
    '  float halo=pow(clamp(soft*2.,0.,1.),uHaloCells)*(1.-smoothstep(.45,.6,m))*smoothstep(.02,.2,pres);\n' +
    '  vec3 rc=mix(vec3(.30,.38,.66),vec3(1.,.60,.24),warm)*(.62+.38*warm);\n' +
    '  col+=rc*(line*(.14+.86*top)*uRim+halo*(.06+.94*top)*uHalo*(.45+.55*warm));\n' +
    '  col*=1.-uDark*smoothstep(.55,.8,m);\n' +                            // nothing projected inside a person
    '  o=vec4(col,1.);\n' +
    '}\n';
  var VS_BIRD = '#version 300 es\n' +
    'layout(location=0) in vec2 aC; layout(location=1) in vec4 aA; layout(location=2) in vec4 aB;\n' +
    'uniform vec2 uWorld;\n' +
    'out vec2 vUv; out vec2 vW; out float vLit; out float vShade;\n' +
    'void main(){\n' +
    '  vec2 l=vec2(aC.x*aB.y,aC.y)*aA.z; float s=sin(aA.w), c=cos(aA.w);\n' +
    '  vec2 p=aA.xy+vec2(c*l.x-s*l.y,s*l.x+c*l.y);\n' +                   // world px, y down
    '  vW=p/uWorld; gl_Position=vec4(vW.x*2.-1.,1.-vW.y*2.,0.,1.);\n' +
    '  vec2 cell=vec2(mod(aB.x,4.),floor(aB.x/4.)); vUv=(cell+aC+.5)/4.;\n' +
    '  vLit=aB.z; vShade=aB.w;\n' +
    '}\n';
  var FS_BIRD = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uAtlas, uBody; uniform mat3 uHinv; uniform vec3 uCool, uWarm, uGold; uniform float uDark, uOutline;\n' +
    'in vec2 vUv; in vec2 vW; in float vLit; in float vShade; out vec4 o;\n' +
    'void main(){\n' +
    '  vec2 t=texture(uAtlas,vUv).rg;\n' +
    '  vec3 h=uHinv*vec3(vW,1.); vec2 k=h.xy/max(h.z,1e-6);\n' +
    '  float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;\n' +
    '  float m=texture(uBody,clamp(k,0.,1.)).r*inK, keep=1.-uDark*smoothstep(.55,.8,m);\n' +
    '  vec3 col=vLit>1.5?uGold:mix(uCool,uWarm,vLit);\n' +
    '  float a=max(t.r,t.g*uOutline)*min(1.,vShade*3.);\n' +
    '  o=vec4(col*t.r*vShade*keep,a);\n' +                                 // premultiplied: a dark rim keeps every bird distinct
    '}\n';

  // ---------------------------------------------------------------- bird states
  var FLY = 0, APPROACH = 1, LAND = 2, PERCH = 3, TAKEOFF = 4, SEEDING = 5;
  var BW = 128, BH = 106;

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Roost needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false});
    if (!gl) throw new Error('Roost needs WebGL 2');
    var made = [], destroyed = false;
    var wallK = 2.0;               // 'Empty wall' knob (1 = the 2026-10-05 picture): scales the dusk wall, the wheeling flock and the ledge birds only; rim, halo and perched/lit birds are untouched
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    function program(vsrc, fsrc, names) {
      var p = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, vsrc), fs = shader(gl.FRAGMENT_SHADER, fsrc);
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var le = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(le); }
      made.push(['Program', p]);
      var U = {}; names.forEach(function (n) { U[n] = gl.getUniformLocation(p, n); }); return {p: p, U: U};
    }
    var sky = program(VS_FULL, FS_SKY, ['uBody', 'uHinv', 'uTime', 'uAspect', 'uPx', 'uRim', 'uHalo', 'uHaloCells', 'uDark', 'uStep', 'uWall']);
    var bird = program(VS_BIRD, FS_BIRD, ['uWorld', 'uAtlas', 'uBody', 'uHinv', 'uCool', 'uWarm', 'uGold', 'uDark', 'uOutline']);
    var emptyVao = gl.createVertexArray(); made.push(['VertexArray', emptyVao]);

    // textures: the sprite atlas, and the body (R = person map, G = outline distance, B = near a person, A = how still they are)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    var atlas = gl.createTexture(); made.push(['Texture', atlas]);
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildAtlas().data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 4);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var bodyTex = gl.createTexture(); made.push(['Texture', bodyTex]);
    var bodyPx = new Uint8Array(BW * BH * 4);
    gl.bindTexture(gl.TEXTURE_2D, bodyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, BW, BH, 0, gl.RGBA, gl.UNSIGNED_BYTE, bodyPx);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // instanced sprites: one quad, 8 floats per sprite (x, y, size, angle | pose, flip, lit, shade)
    // the Birds knob: read the store BEFORE anything is sized from BIRDS (set() runs at the end of create, after the buffers exist, so it never took effect)
    if (window._roostFx && Number.isFinite(window._roostFx.birds)) BIRDS = Math.round(Math.max(50, Math.min(400, window._roostFx.birds)));
    var MAXF = 48, MAXS = 4, GRAINS = 7, MAXI = BIRDS + MAXF + MAXS * GRAINS;
    var inst = new Float32Array(MAXI * 8), nInst = 0;
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);
    var quad = gl.createBuffer(); made.push(['Buffer', quad]);
    var ibuf = gl.createBuffer(); made.push(['Buffer', ibuf]);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ibuf); gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // ---------------------------------------------------------------- the body, resampled onto a wall grid (10 px cells)
    var body = WallBody.create(kit, {});
    var WX = 1280, WY = 800, GW = 128, GH = 80, CW = 10;
    var gIdx, gFx, gFy, gOk, gm, gmo, glab, gnear, gfear, gtmp, hinvSeen = new Float32Array(9).fill(NaN);
    var crY = new Float32Array(GW * 4), crL = new Int16Array(GW * 4), crOpen = new Uint8Array(GW * 4), crN = new Uint8Array(GW);
    var colTop = new Float32Array(GW).fill(1e9), colFloor = new Float32Array(GW).fill(1e9);   // the flock flies over people like over hills
    var keepA = new Float32Array(BW * BH), keepB = new Float32Array(BW * BH), fm = new Float32Array(BW * BH);
    var soft = new Float32Array(BW * BH), pres = new Float32Array(BW * BH), warmC = new Float32Array(BW * BH), btmp = new Float32Array(BW * BH);
    var people = [], idOfLabel = [], actSum = new Float32Array(64), lastFoldMs = -1, gridLive = false;
    var pstate = {}, canon = {}, lastFreshAt = -1e9, wasStale = true, graceUntil = 0;
    // a Kinect hiccup (no depth for a moment) makes the body stage forget everyone and hand out new ids, and the returning
    // outline reads as a big movement: so birds hold their perch for HOLD_S, a person keeps their id (and birds) when they come
    // back where they were, and movement is ignored for a moment after the gap
    var HOLD_S = 0.7, GRACE_S = 0.45, gaps = 0, maxGap = 0;
    function newCanon(p, taken) {            // a new body-stage id: the same person back after a gap, if we knew someone right here
      var best = -1, bd = 0.12;
      for (var key in pstate) { var s = pstate[key]; if (taken[key] || elapsed - s.seen > 1.0) continue; var d = Math.hypot(s.cx - p.cx, s.cy - p.cy); if (d < bd) { bd = d; best = +key; } }
      var c = best >= 0 ? best : p.id; while (taken[c]) c += 100000; canon[p.id] = c; return c;
    }
    function sizeWorld() {
      var w = Math.max(1, canvas.width), h = Math.max(1, canvas.height);
      WX = 1280; WY = 1280 * h / w; CW = WX / GW; GH = Math.max(8, Math.ceil(WY / CW));
      var n = GW * GH;
      gIdx = new Int32Array(n); gFx = new Float32Array(n); gFy = new Float32Array(n); gOk = new Uint8Array(n);
      gm = new Float32Array(n); gmo = new Float32Array(n); glab = new Int16Array(n).fill(-1); gnear = new Float32Array(n); gfear = new Float32Array(n); gtmp = new Float32Array(n);
      hinvSeen.fill(NaN);
    }
    var sizedW = -1, sizedH = -1;
    function checkSize() { if (canvas.width !== sizedW || canvas.height !== sizedH) { sizedW = canvas.width; sizedH = canvas.height; sizeWorld(); clampBirds(); } }
    function buildMap() {                    // wall cell -> Kinect cell (bilinear), from the body stage's window -> Kinect matrix
      var M = body.hinv(), same = true;
      for (var q = 0; q < 9; q++) if (M[q] !== hinvSeen[q]) { same = false; break; }
      if (same) return;
      hinvSeen.set(M);
      for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) {
        var x = (gx + 0.5) / GW, y = Math.min(1, (gy + 0.5) * CW / WY), i = gy * GW + gx;
        var kx = M[0] * x + M[3] * y + M[6], ky = M[1] * x + M[4] * y + M[7], kz = M[2] * x + M[5] * y + M[8];
        var u = kx / kz, v = ky / kz;
        gOk[i] = (kz > 0 && u >= 0 && u <= 1 && v >= 0 && v <= 1) ? 1 : 0;
        var fx = Math.max(0, Math.min(BW - 1.001, u * BW - 0.5)), fy = Math.max(0, Math.min(BH - 1.001, v * BH - 0.5));
        var x0 = Math.min(BW - 2, Math.floor(fx)), y0 = Math.min(BH - 2, Math.floor(fy));
        gIdx[i] = y0 * BW + x0; gFx[i] = fx - x0; gFy[i] = fy - y0;
      }
    }
    function boxBlur(a, t, w, h, r) {        // separable running-sum box blur, in place (a), t = scratch
      var x, y, s, n = 2 * r + 1;
      for (y = 0; y < h; y++) { var row = y * w; s = 0;
        for (x = -r; x <= r; x++) s += a[row + Math.max(0, Math.min(w - 1, x))];
        for (x = 0; x < w; x++) { t[row + x] = s / n; s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; } }
      for (x = 0; x < w; x++) { s = 0;
        for (y = -r; y <= r; y++) s += t[Math.max(0, Math.min(h - 1, y)) * w + x];
        for (y = 0; y < h; y++) { a[y * w + x] = s / n; s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
    }
    function fold(dtS) {                     // a new depth frame: who is where, how still, and the tops of their outlines
      people = body.people; idOfLabel.length = 0;
      var i, x, y, mask = body.mask, lab = body.label, mo = body.motion;
      var taken = {};
      for (i = 0; i < people.length; i++) { actSum[i] = 0; idOfLabel[i] = -1; var c0 = canon[people[i].id]; if (c0 !== undefined && !taken[c0]) { idOfLabel[i] = c0; taken[c0] = 1; } }
      for (i = 0; i < people.length; i++) if (idOfLabel[i] < 0) { idOfLabel[i] = newCanon(people[i], taken); taken[idOfLabel[i]] = 1; }
      for (i = 0; i < BW * BH; i++) if (lab[i] >= 0 && lab[i] < actSum.length) actSum[lab[i]] += mo[i];
      updatePeople(dtS);
      // only real people count: cells of a labelled person, grown by two cells (noise blobs under the stage's minArea get nothing)
      for (i = 0; i < BW * BH; i++) keepA[i] = lab[i] >= 0 ? 1 : 0;
      for (var pass = 0; pass < 2; pass++) {
        for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; var v = keepA[i];
          if (x > 0 && keepA[i - 1] > v) v = keepA[i - 1]; if (x < BW - 1 && keepA[i + 1] > v) v = keepA[i + 1];
          if (y > 0 && keepA[i - BW] > v) v = keepA[i - BW]; if (y < BH - 1 && keepA[i + BW] > v) v = keepA[i + BW]; keepB[i] = v; }
        keepA.set(keepB);
      }
      for (i = 0; i < BW * BH; i++) {
        fm[i] = soft[i] = mask[i] * keepA[i]; pres[i] = lab[i] >= 0 ? 1 : 0;
        warmC[i] = lab[i] >= 0 ? (pstate[idOfLabel[lab[i]]] ? pstate[idOfLabel[lab[i]]].warm : 0) : 0;
      }
      boxBlur(soft, btmp, BW, BH, 2); boxBlur(soft, btmp, BW, BH, 1); boxBlur(pres, btmp, BW, BH, 2); boxBlur(pres, btmp, BW, BH, 2); boxBlur(warmC, btmp, BW, BH, 2); boxBlur(warmC, btmp, BW, BH, 2);
      for (i = 0; i < BW * BH; i++) {
        var j4 = i * 4, p = pres[i];
        bodyPx[j4] = Math.round(Math.min(1, fm[i]) * 255);
        bodyPx[j4 + 1] = Math.round(Math.min(1, soft[i]) * 255);
        bodyPx[j4 + 2] = Math.round(Math.min(1, p * 2) * 255);
        bodyPx[j4 + 3] = Math.round(Math.max(0, Math.min(1, p > 0.01 ? warmC[i] / p : 0)) * 255);
      }
      uploadBody();
      // the wall grid
      buildMap();
      var n = GW * GH;
      for (i = 0; i < n; i++) {
        if (!gOk[i]) { gm[i] = 0; gmo[i] = 0; glab[i] = -1; continue; }
        var b = gIdx[i], fx = gFx[i], fy = gFy[i];
        gm[i] = (fm[b] * (1 - fx) + fm[b + 1] * fx) * (1 - fy) + (fm[b + BW] * (1 - fx) + fm[b + BW + 1] * fx) * fy;
        gmo[i] = ((mo[b] * (1 - fx) + mo[b + 1] * fx) * (1 - fy) + (mo[b + BW] * (1 - fx) + mo[b + BW + 1] * fx) * fy) * Math.min(1, keepA[b] + keepA[b + BW + 1]);
        glab[i] = lab[b + (fx > 0.5 ? 1 : 0) + (fy > 0.5 ? BW : 0)];
      }
      for (i = 0; i < n; i++) { gnear[i] = gm[i]; gfear[i] = gmo[i]; }
      boxBlur(gnear, gtmp, GW, GH, 3); boxBlur(gfear, gtmp, GW, GH, 4); boxBlur(gfear, gtmp, GW, GH, 3);
      crossings();
      gridLive = true;
    }
    function fadeBody(dt) {                  // the Kinect went quiet: the rim fades out with the stage's own mask
      if (!gridLive) return;
      var k = Math.exp(-dt / 0.12), any = false;
      for (var i = 0; i < BW * BH; i++) { var j4 = i * 4; bodyPx[j4] = Math.floor(bodyPx[j4] * k); bodyPx[j4 + 1] = Math.floor(bodyPx[j4 + 1] * k); bodyPx[j4 + 2] = Math.floor(bodyPx[j4 + 2] * k); if (bodyPx[j4] || bodyPx[j4 + 1] || bodyPx[j4 + 2]) any = true; }
      uploadBody();
      if (elapsed - lastFreshAt < HOLD_S) return;                       // a short gap: birds hold on
      people = []; idOfLabel.length = 0; crN.fill(0); colTop.fill(1e9); colFloor.fill(1e9); gm.fill(0); gmo.fill(0); gnear.fill(0); gfear.fill(0); glab.fill(-1);
      if (!any) gridLive = false;
    }
    function uploadBody() { gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, bodyPx); }
    function crossings() {                   // per wall column: every place the person map starts (going down) = a top surface
      for (var gx = 0; gx < GW; gx++) {
        var n = 0;
        for (var gy = 1; gy < GH && n < 4; gy++) {
          var a = gm[(gy - 1) * GW + gx], b = gm[gy * GW + gx];
          if (a < 0.5 && b >= 0.5) {
            var l = glab[gy * GW + gx]; if (l < 0 && gy + 1 < GH) l = glab[(gy + 1) * GW + gx];
            if (l < 0) continue;
            var y = (gy - 1 + (0.5 - a) / Math.max(1e-4, b - a) + 0.5) * CW, k = gx * 4 + n;
            crY[k] = y; crL[k] = l; crOpen[k] = (gy >= 4 && gm[(gy - 4) * GW + gx] < 0.3) ? 1 : 0; n++;
          }
        }
        crN[gx] = n; colTop[gx] = n ? crY[gx * 4] : 1e9;
      }
      for (var g2 = 0; g2 < GW; g2++) { var mn = 1e9; for (var o = -9; o <= 9; o++) { var q2 = g2 + o; if (q2 >= 0 && q2 < GW && colTop[q2] < mn) mn = colTop[q2]; } colFloor[g2] = mn; }
    }
    function colAt(gx, yNear, l, tol) {
      if (gx < 0 || gx >= GW) return NaN;
      var best = NaN, bd = tol;
      for (var k = 0; k < crN[gx]; k++) { var q = gx * 4 + k; if (crL[q] !== l) continue; var d = Math.abs(crY[q] - yNear); if (d < bd) { bd = d; best = crY[q]; } }
      return best;
    }
    function surfaceAt(x, yNear, l, tol) {   // the top of person l's outline under x, near yNear (NaN = none)
      var fx = x / CW - 0.5, g0 = Math.floor(fx), f = fx - g0, a = colAt(g0, yNear, l, tol), b = colAt(g0 + 1, yNear, l, tol);
      if (a === a && b === b) return a + (b - a) * f;
      return a === a ? a : b;
    }
    function sampleGrid(arr, x, y) {
      var fx = Math.max(0, Math.min(GW - 1.001, x / CW - 0.5)), fy = Math.max(0, Math.min(GH - 1.001, y / CW - 0.5));
      var x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0, i = y0 * GW + x0;
      var x1 = x0 < GW - 1 ? 1 : 0, y1 = y0 < GH - 1 ? GW : 0;
      return (arr[i] * (1 - ax) + arr[i + x1] * ax) * (1 - ay) + (arr[i + y1] * (1 - ax) + arr[i + y1 + x1] * ax) * ay;
    }
    function labelOf(pid) { for (var q = 0; q < idOfLabel.length; q++) if (idOfLabel[q] === pid) return q; return -1; }

    // ---------------------------------------------------------------- people: calm (own clock, forgiving), warmth, landing credit
    function updatePeople(dtS) {
      var seen = {};
      var grace = elapsed < graceUntil;
      for (var q = 0; q < people.length; q++) {
        var p = people[q], cid = idOfLabel[q], s = pstate[cid];
        if (!s) s = pstate[cid] = {calm: 0, warm: 0, credit: 0.9, born: elapsed};
        seen[cid] = 1; s.seen = elapsed; s.cx = p.cx; s.cy = p.cy;
        if (grace) continue;
        var act = q < actSum.length ? actSum[q] / Math.sqrt(Math.max(1, p.area)) : 0;     // movement summed over the person, per unit of outline
        s.act = s.act === undefined ? act : s.act + (act - s.act) * (1 - Math.exp(-dtS / 0.5));
        if (p.moving < CALM_MOVE) s.calm += dtS;
        else if (p.moving < SCATTER_MOVE) s.calm = Math.max(0, s.calm - dtS * 1.5);
        else { if (s.calm > 0.2 || s.credit < 0.9) scatterPerson(cid); s.calm = 0; s.credit = 0.9; }
        s.calm = Math.max(s.calm, p.still);
        var target = Math.max(0, Math.min(1, (s.calm - LAND_AFTER_S * 0.4) / 2.5));
        s.warm += (target - s.warm) * (1 - Math.exp(-dtS / (target > s.warm ? 0.5 : 0.15)));
      }
      for (var id in pstate) if (!seen[id] && elapsed - pstate[id].seen > 1.0) delete pstate[id];
      for (var k in canon) if (!pstate[canon[k]] && !people.some(function (pp) { return pp.id === +k; })) delete canon[k];
    }

    // ---------------------------------------------------------------- birds
    var N = BIRDS;
    var bx = new Float32Array(N), by = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
    var st = new Uint8Array(N), tid = new Int32Array(N), tx = new Float32Array(N), ty = new Float32Array(N), sx0 = new Float32Array(N), sy0 = new Float32Array(N);
    var svx = new Float32Array(N), svy = new Float32Array(N), tState = new Float32Array(N), tDur = new Float32Array(N);
    var phase = new Float32Array(N), flapOn = new Uint8Array(N), flapT = new Float32Array(N), face = new Float32Array(N), lit = new Float32Array(N);
    var excite = new Float32Array(N), ang = new Float32Array(N), sizeK = new Float32Array(N), shade = new Float32Array(N);
    var pose = new Uint8Array(N), poseT = new Float32Array(N), hop = new Float32Array(N), hopFrom = new Float32Array(N), hopT = new Float32Array(N);
    var goAt = new Float32Array(N), rest = new Float32Array(N), seedOf = new Int8Array(N), seedSlot = new Int8Array(N), ledge = new Uint8Array(N);
    var G = 90, gridW = 0, gridH = 0, head = new Int32Array(1), nxt = new Int32Array(N);
    var elapsed = 0, frames = 0, simMs = 0, roost = [640, 260], takeoffs = 0, landings = 0, reasons = {};
    function rnd(a, b) { return a + Math.random() * (b - a); }
    for (var i0 = 0; i0 < N; i0++) {
      var r = 140 * Math.sqrt(Math.random()), a0 = Math.random() * 6.283;
      bx[i0] = 640 + r * Math.cos(a0) * 1.6; by[i0] = 280 + r * Math.sin(a0) * 0.7;
      vx[i0] = SPEED * rnd(0.8, 1.1); vy[i0] = rnd(-20, 20); st[i0] = FLY; tid[i0] = -9; face[i0] = 1;
      sizeK[i0] = rnd(0.86, 1.08); shade[i0] = rnd(0.72, 1.0); phase[i0] = Math.random(); flapT[i0] = rnd(0, 1); rest[i0] = rnd(1, 14); seedOf[i0] = -1;
    }
    function clampBirds() { for (var i = 0; i < N; i++) { bx[i] = Math.max(-40, Math.min(WX + 40, bx[i])); by[i] = Math.max(-40, Math.min(WY + 40, by[i])); } }

    function takeoff(i, why) {
      var wasPerson = (st[i] === PERCH || st[i] === LAND) && tid[i] >= 0;
      st[i] = TAKEOFF; tState[i] = 0; goAt[i] = 0; seedOf[i] = -1; takeoffs++; reasons[why] = (reasons[why] || 0) + 1;
      var dir = face[i] * (Math.random() < 0.75 ? 1 : -1);
      vx[i] = dir * SPEED * rnd(0.5, 1.0); vy[i] = -SPEED * rnd(0.9, 1.5); excite[i] = 1; flapOn[i] = 1; face[i] = dir;
      if (ledge[i]) rest[i] = rnd(8, 24);
      if (wasPerson && Math.random() < FEATHERS) feather(bx[i], by[i] - 10);
      // the ripple: the birds next to this one go too, a moment later
      for (var j = 0; j < N; j++) {
        if (j === i || st[j] !== PERCH || goAt[j] > 0 || tid[j] !== tid[i]) continue;
        var dx = bx[j] - bx[i], dy = by[j] - by[i];
        if (dx * dx + dy * dy < 75 * 75 && Math.random() < (tid[i] < 0 ? CONTAGION * 0.5 : CONTAGION)) goAt[j] = elapsed + rnd(0.05, 0.22);
      }
      tid[i] = -9; ledge[i] = 0;
    }
    function scatterPerson(pid) {
      for (var i = 0; i < N; i++) {
        if (tid[i] !== pid) continue;
        if (st[i] === PERCH || st[i] === LAND) { if (!(goAt[i] > 0)) goAt[i] = elapsed + rnd(0, 0.12); }
        else if (st[i] === APPROACH) { st[i] = FLY; tid[i] = -9; excite[i] = 0.6; }
      }
    }
    function freeSpot(pid, x, y, gap) {
      for (var j = 0; j < N; j++) {
        if (tid[j] !== pid || !(st[j] === APPROACH || st[j] === LAND || st[j] === PERCH)) continue;
        if (Math.abs(tx[j] - x) < gap && Math.abs(ty[j] - y) < 34) return false;
      }
      return true;
    }
    var cand = new Int32Array(GW * 4);
    function pickPerch(l, pid) {             // a free, fairly level, open spot along the top of person l
      var nc = 0, gx, k;
      for (gx = 0; gx < GW; gx++) for (k = 0; k < crN[gx]; k++) { var q = gx * 4 + k; if (crL[q] === l && crOpen[q]) cand[nc++] = q; }
      if (!nc) return null;
      var top = 1e9, bot = -1e9, best = null, bs = -1e9;
      for (var c0 = 0; c0 < nc; c0++) { var yc = crY[cand[c0]]; if (yc < top) top = yc; if (yc > bot) bot = yc; }
      for (var tries = 0; tries < 18; tries++) {
        var q2 = cand[(Math.random() * nc) | 0], g = (q2 / 4) | 0, x = (g + 0.5) * CW + rnd(-0.45, 0.45) * CW, y = surfaceAt(x, crY[q2], l, 20);
        if (!(y === y)) continue;
        var yl = colAt(g - 1, y, l, 24), yr = colAt(g + 1, y, l, 24);
        var slope = (yl === yl && yr === yr) ? Math.abs(yr - yl) / (2 * CW) : yl === yl ? Math.abs(y - yl) / CW : yr === yr ? Math.abs(yr - y) / CW : 9;
        if (slope > 1.25) continue;
        if (!freeSpot(pid, x, y, GAP_PX)) continue;
        var score = Math.random() + 0.35 * (1 - (y - top) / Math.max(60, bot - top));     // a slight preference for high places
        if (score > bs) { bs = score; best = [x, y]; }
      }
      return best;
    }
    function nearestFree(x, y) {             // a bird from the flock (or resting on the ledge) to send
      var best = -1, bd = 1e18;
      for (var t = 0; t < 40; t++) {
        var j = (Math.random() * N) | 0;
        if (!((st[j] === FLY && excite[j] < 0.5) || (st[j] === PERCH && ledge[j]))) continue;
        var d = (bx[j] - x) * (bx[j] - x) + (by[j] - y) * (by[j] - y);
        if (d < bd) { bd = d; best = j; }
      }
      return best;
    }
    var counts = [0, 0, 0, 0, 0, 0], perPid = {};
    function census() {
      counts.fill(0); perPid = {};
      for (var i = 0; i < N; i++) { counts[st[i]]++; if (tid[i] >= 0 && st[i] !== FLY && st[i] !== TAKEOFF) perPid[tid[i]] = (perPid[tid[i]] || 0) + 1; }
    }
    function available() { var n = 0; for (var i = 0; i < N; i++) if ((st[i] === FLY && excite[i] < 0.5) || (st[i] === PERCH && ledge[i])) n++; return n; }
    function dispatch(dt) {                  // still people call birds down; the stillest first; the flock keeps a reserve
      if (!people.length || !body.fresh) return;
      var minAct = 1e9, l0, s0;
      for (l0 = 0; l0 < people.length; l0++) { s0 = pstate[idOfLabel[l0]]; if (s0 && s0.calm >= LAND_AFTER_S) minAct = Math.min(minAct, s0.act || 0); }
      if (minAct === 1e9) return;
      for (l0 = 0; l0 < people.length; l0++) { s0 = pstate[idOfLabel[l0]]; if (s0) s0.share = Math.max(0.15, Math.min(1, (minAct + FIDGET_EASE) / ((s0.act || 0) + FIDGET_EASE))); }
      var order = people.map(function (p, l) { return l; }).sort(function (a, b) { var sa = pstate[idOfLabel[a]] || {calm: 0, share: 0}, sb = pstate[idOfLabel[b]] || {calm: 0, share: 0}; return sb.calm * sb.share - sa.calm * sa.share; });
      var avail = available();
      for (var o = 0; o < order.length; o++) {
        var l = order[o], pid = idOfLabel[l], s = pstate[pid];
        if (!s || s.calm < LAND_AFTER_S) continue;
        s.credit = Math.min(2, s.credit + dt * LAND_RATE * s.share * Math.min(1, 0.35 + (s.calm - LAND_AFTER_S) / 2.5));
        while (s.credit >= 1) {
          s.credit -= 1;
          if ((perPid[pid] || 0) >= PER_PERSON || avail <= RESERVE * N) break;
          var spot = pickPerch(l, pid); if (!spot) break;
          var j = nearestFree(spot[0], spot[1]); if (j < 0) break;
          if (st[j] === PERCH) takeoff(j, 'called');
          st[j] = APPROACH; tid[j] = pid; tx[j] = spot[0]; ty[j] = spot[1]; tState[j] = 0; ledge[j] = 0; excite[j] = 0;
          perPid[pid] = (perPid[pid] || 0) + 1; avail--;
        }
      }
    }

    // feathers and seed
    var fx_ = new Float32Array(MAXF), fy_ = new Float32Array(MAXF), fvx = new Float32Array(MAXF), fvy = new Float32Array(MAXF), fr = new Float32Array(MAXF), fvr = new Float32Array(MAXF), fage = new Float32Array(MAXF).fill(99), flife = new Float32Array(MAXF), fph = new Float32Array(MAXF), nextF = 0;
    function feather(x, y) {
      var k = nextF; nextF = (nextF + 1) % MAXF;
      fx_[k] = x + rnd(-6, 6); fy_[k] = y; fvx[k] = rnd(-40, 40); fvy[k] = rnd(-50, -10); fr[k] = rnd(0, 6.28); fvr[k] = rnd(-3, 3); fage[k] = 0; flife[k] = rnd(2.4, 3.2); fph[k] = rnd(0, 6.28);
    }
    var seeds = [];                          // {x, y, last, grains}
    var touchPts = [], fingersSeen = false;
    function fingers() {
      var f = kit.fingers, now = Date.now(), pts = null;
      if (f) { fingersSeen = true; pts = (now - f.t <= 160 && Array.isArray(f.pts)) ? f.pts : []; }
      else { pts = []; for (var q = touchPts.length - 1; q >= 0; q--) { if (now - touchPts[q].t > 700) touchPts.splice(q, 1); else pts.push([touchPts[q].x, touchPts[q].y]); } }
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var x = p[0] * WX, y = p[1] * WY, best = null, bd = 70;
        for (var s = 0; s < seeds.length; s++) { var d = Math.hypot(seeds[s].x - x, seeds[s].y - y); if (d < bd) { bd = d; best = seeds[s]; } }
        if (best) { best.x += (x - best.x) * 0.5; best.y += (y - best.y) * 0.5; best.last = elapsed; }
        else if (seeds.length < MAXS) {
          var gr = new Float32Array(GRAINS * 3); for (var g = 0; g < GRAINS; g++) { gr[g * 3] = rnd(-16, 16); gr[g * 3 + 1] = rnd(-9, 9); gr[g * 3 + 2] = rnd(0, 6.28); }
          seeds.push({x: x, y: y, last: elapsed, born: elapsed, grains: gr, id: Math.random()});
        }
      }
      for (var s2 = seeds.length - 1; s2 >= 0; s2--) if (elapsed - seeds[s2].last > SEED_LINGER_S) {
        for (var b = 0; b < N; b++) if (st[b] === SEEDING && seedOf[b] === s2) { st[b] = TAKEOFF; tState[b] = 0; vy[b] = -SPEED; excite[b] = 0.6; seedOf[b] = -1; tid[b] = -9; }
        for (var b2 = 0; b2 < N; b2++) if (seedOf[b2] > s2) seedOf[b2]--;
        seeds.splice(s2, 1);
      }
      for (var s3 = 0; s3 < seeds.length; s3++) {       // two or three birds come to each seed
        var have = 0, used = 0;
        for (var b3 = 0; b3 < N; b3++) if (st[b3] === SEEDING && seedOf[b3] === s3) { have++; used |= 1 << seedSlot[b3]; }
        if (have < SEED_BIRDS && Math.random() < 0.25) {
          var j = nearestFree(seeds[s3].x, seeds[s3].y);
          if (j >= 0) { if (st[j] === PERCH) takeoff(j, 'seed'); st[j] = SEEDING; seedOf[j] = s3; tid[j] = -2; ledge[j] = 0; for (var sl = 0; sl < 3; sl++) if (!(used & (1 << sl))) { seedSlot[j] = sl; break; } tState[j] = 0; }
        }
      }
    }
    var SEED_OFF = [[-48, -24], [50, -30], [2, -68]];

    // ---------------------------------------------------------------- the simulation step
    function steer(dt) {
      var i, j;
      gridW = Math.ceil((WX + 200) / G); gridH = Math.ceil((WY + 200) / G);
      if (head.length < gridW * gridH) head = new Int32Array(gridW * gridH);
      head.fill(-1);
      for (i = 0; i < N; i++) if (st[i] === FLY || st[i] === TAKEOFF) {
        var c = Math.max(0, Math.min(gridW - 1, Math.floor((bx[i] + 100) / G))) + Math.max(0, Math.min(gridH - 1, Math.floor((by[i] + 100) / G))) * gridW;
        nxt[i] = head[c]; head[c] = i;
      }
      var t = elapsed;
      roost[0] = WX * (0.5 + 0.3 * Math.sin(t * 0.083) + 0.06 * Math.sin(t * 0.31)); roost[1] = WY * (0.34 + 0.12 * Math.sin(t * 0.121 + 1.2));
      var rf = colFloor[Math.max(0, Math.min(GW - 1, Math.floor(roost[0] / CW)))];
      if (rf < 1e9) roost[1] = Math.max(85, Math.min(roost[1], rf - 120));              // with people there, the flock wheels above their heads
      var ledgeN = 0; for (i = 0; i < N; i++) if (ledge[i] && st[i] !== FLY) ledgeN++;
      for (i = 0; i < N; i++) {
        var s = st[i];
        excite[i] *= Math.exp(-dt / 1.1);
        if (s === FLY || s === TAKEOFF) {
          var ax = 0, ay = 0, n = 0, cx = 0, cy = 0, avx = 0, avy = 0, sepx = 0, sepy = 0;
          var gx0 = Math.floor((bx[i] + 100) / G), gy0 = Math.floor((by[i] + 100) / G);
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
            var gx = gx0 + ox, gy = gy0 + oy; if (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH) continue;
            for (j = head[gy * gridW + gx]; j >= 0; j = nxt[j]) {
              if (j === i) continue;
              var dx = bx[j] - bx[i], dy = by[j] - by[i], d2 = dx * dx + dy * dy;
              if (d2 > 85 * 85) continue;
              n++; cx += dx; cy += dy; avx += vx[j]; avy += vy[j];
              if (d2 < 44 * 44) { var inv = 1 / Math.max(d2, 30); sepx -= dx * inv; sepy -= dy * inv; }
            }
          }
          if (n) { ax += (avx / n - vx[i]) * 1.2 + cx / n * 0.4; ay += (avy / n - vy[i]) * 1.2 + cy / n * 0.4; }
          ax += sepx * 3600; ay += sepy * 3600;
          var rx = roost[0] - bx[i], ry = roost[1] - by[i];
          ax += rx * 0.13 - ry * 0.06; ay += ry * 0.13 + rx * 0.06;              // a weak pull to a roaming point, and a wheel around it
          if (bx[i] < 70) ax += (70 - bx[i]) * 5; if (bx[i] > WX - 70) ax -= (bx[i] - WX + 70) * 5;
          if (by[i] < 60) ay += (60 - by[i]) * 5; if (by[i] > WY * 0.74) ay -= (by[i] - WY * 0.74) * 4;
          // people: the flock rises over them like over hills (looking a moment ahead), and shies away from movement
          var fl = colFloor[Math.max(0, Math.min(GW - 1, Math.floor((bx[i] + vx[i] * 0.4) / CW)))] - 45;
          if (by[i] > fl) ay -= Math.min(900, (by[i] - fl) * 7);
          if (sampleGrid(gnear, bx[i], by[i]) > 0.3) ay -= 300;
          var fe = sampleGrid(gfear, bx[i], by[i]);
          if (fe > 0.01) { var gxf = sampleGrid(gfear, bx[i] + CW, by[i]) - sampleGrid(gfear, bx[i] - CW, by[i]), gyf = sampleGrid(gfear, bx[i], by[i] + CW) - sampleGrid(gfear, bx[i], by[i] - CW);
            ax -= gxf * 9000; ay -= gyf * 9000 + fe * 300; excite[i] = Math.max(excite[i], Math.min(1, fe * 6)); }
          ax += rnd(-70, 70); ay += rnd(-70, 70);
          if (s === TAKEOFF) { tState[i] += dt; ay -= 160 * Math.max(0, 1 - tState[i] / 0.5); if (tState[i] > 0.6) st[i] = FLY; }
          vx[i] += ax * dt; vy[i] += ay * dt;
          var sp = Math.hypot(vx[i], vy[i]), want = SPEED * (0.92 + 0.16 * sizeK[i]) * (1 + 0.9 * excite[i]);
          var ns = sp + (want - sp) * (1 - Math.exp(-dt * 1.6)); if (sp > 1e-3) { vx[i] *= ns / sp; vy[i] *= ns / sp; }
          bx[i] += vx[i] * dt; by[i] += vy[i] * dt;
          // now and then a bird drops down to rest on the bottom edge (when nobody is moving there)
          if (s === FLY) { rest[i] -= dt;
            if (rest[i] < 0) { rest[i] = rnd(6, 20);
              if (ledgeN < LEDGE * N && excite[i] < 0.2) { var lx = Math.max(40, Math.min(WX - 40, bx[i] + rnd(-220, 220))), ly = WY - 1.5;
                if (sampleGrid(gnear, lx, ly - 30) < 0.05 && freeSpot(-1, lx, ly, GAP_PX * 0.9)) { st[i] = APPROACH; tid[i] = -1; tx[i] = lx; ty[i] = ly; tState[i] = 0; ledge[i] = 1; ledgeN++; } } } }
        } else if (s === APPROACH) {
          if (tid[i] >= 0) {                  // follow the outline if the person sways; give up if the spot is gone
            var l = labelOf(tid[i]), sy = l >= 0 ? surfaceAt(tx[i], ty[i], l, 26) : NaN;
            if (!(sy === sy)) { st[i] = FLY; tid[i] = -9; excite[i] = 0.4; continue; }
            ty[i] = sy;
          }
          var ex = tx[i] - bx[i], ey = ty[i] - by[i], dist = Math.hypot(ex, ey);
          var aimY = ty[i] - (dist > 110 ? 55 : 14), axx = tx[i] - bx[i], ayy = aimY - by[i], ad = Math.max(1, Math.hypot(axx, ayy));
          var spd = Math.min(SPEED * 1.4, ad * 2.4 + 60);
          vx[i] += (axx / ad * spd - vx[i]) * (1 - Math.exp(-dt * 4.5)); vy[i] += (ayy / ad * spd - vy[i]) * (1 - Math.exp(-dt * 4.5));
          bx[i] += vx[i] * dt; by[i] += vy[i] * dt; tState[i] += dt;
          if (dist < 58) { st[i] = LAND; tState[i] = 0; tDur[i] = Math.max(0.32, Math.min(0.62, dist / 150)); sx0[i] = bx[i]; sy0[i] = by[i]; svx[i] = vx[i]; svy[i] = vy[i]; face[i] = ex >= 0 ? 1 : -1; }
          if (tState[i] > 9) { st[i] = FLY; tid[i] = -9; ledge[i] = 0; }
        } else if (s === LAND) {
          if (tid[i] >= 0) { var l2 = labelOf(tid[i]), sy2 = l2 >= 0 ? surfaceAt(tx[i], ty[i], l2, 30) : NaN; if (!(sy2 === sy2)) { takeoff(i, 'lost'); continue; } ty[i] = sy2; }
          tState[i] += dt; var u = Math.min(1, tState[i] / tDur[i]), e = 1 - (1 - u) * (1 - u), D = tDur[i];
          var p1x = sx0[i] + svx[i] * D * 0.4, p1y = sy0[i] + svy[i] * D * 0.4;
          var nxp = (1 - e) * (1 - e) * sx0[i] + 2 * (1 - e) * e * p1x + e * e * tx[i], nyp = (1 - e) * (1 - e) * sy0[i] + 2 * (1 - e) * e * p1y + e * e * ty[i];
          if (dt > 0) { vx[i] = (nxp - bx[i]) / dt; vy[i] = (nyp - by[i]) / dt; }
          bx[i] = nxp; by[i] = nyp;
          if (u >= 1) { st[i] = PERCH; vx[i] = 0; vy[i] = 0; pose[i] = P_SIT; poseT[i] = rnd(0.5, 2); hopT[i] = 0; landings++; if (goAt[i] > 0 && goAt[i] < elapsed) goAt[i] = elapsed + 0.05; }
          else if (goAt[i] > 0 && elapsed >= goAt[i]) takeoff(i, 'startle');
        } else if (s === PERCH) {
          if (goAt[i] > 0 && elapsed >= goAt[i]) { takeoff(i, 'ripple'); continue; }
          if (tid[i] >= 0) {
            var l3 = labelOf(tid[i]), sy3 = l3 >= 0 ? surfaceAt(bx[i], ty[i], l3, 30) : NaN;
            if (!(sy3 === sy3)) { takeoff(i, 'lost'); continue; }
            ty[i] += (sy3 - ty[i]) * (1 - Math.exp(-dt / 0.12));
            if (elapsed > graceUntil && sampleGrid(gmo, bx[i], ty[i] + 6) > STARTLE) { takeoff(i, 'startle'); continue; }
            var ps0 = pstate[tid[i]];                // on someone clearly more restless than the stillest person here: now and then leave
            if (ps0 && ps0.share < 0.6 && Math.random() < dt * 0.3 * (0.6 - ps0.share) / 0.6) { takeoff(i, 'restless'); continue; }
          } else {                            // on the ledge: leave when rested, or when someone comes close or moves nearby
            rest[i] -= dt;
            if (rest[i] < 0 || sampleGrid(gfear, bx[i], WY - 20) > 0.04 || sampleGrid(gnear, bx[i], WY - 30) > 0.12) { takeoff(i, 'ledge'); continue; }
          }
          // little lives: preen, peck, look round, turn, hop
          poseT[i] -= dt;
          if (poseT[i] < 0) {
            var r = Math.random();
            if (pose[i] !== P_SIT) { pose[i] = P_SIT; poseT[i] = rnd(0.8, 2.6); }
            else if (r < 0.32) { pose[i] = P_PECK; poseT[i] = rnd(0.25, 0.5); }
            else if (r < 0.52) { pose[i] = P_LOOK; poseT[i] = rnd(0.6, 1.4); }
            else if (r < 0.62) { pose[i] = P_FLICK; poseT[i] = 0.22; }
            else if (r < 0.80) { face[i] = -face[i]; poseT[i] = rnd(0.8, 2); }
            else { var hx = bx[i] + face[i] * GAP_PX * 0.55; if (tid[i] >= 0 ? (freeSpot2(i, hx) && surfaceAt(hx, ty[i], labelOf(tid[i]), 16) === surfaceAt(hx, ty[i], labelOf(tid[i]), 16)) : (hx > 30 && hx < WX - 30 && freeSpot2(i, hx))) { hopFrom[i] = bx[i]; hop[i] = hx; hopT[i] = 0.001; } poseT[i] = rnd(0.8, 2); }
          }
          if (hopT[i] > 0) { hopT[i] += dt; var hu = Math.min(1, hopT[i] / 0.22); bx[i] = hopFrom[i] + (hop[i] - hopFrom[i]) * hu; tx[i] = bx[i]; if (hu >= 1) hopT[i] = 0; }
          by[i] = ty[i] - (hopT[i] > 0 ? 7 * Math.sin(Math.PI * Math.min(1, hopT[i] / 0.22)) : 0);
        } else if (s === SEEDING) {
          var sd = seeds[seedOf[i]];
          if (!sd) { st[i] = FLY; seedOf[i] = -1; tid[i] = -9; continue; }
          tState[i] += dt;
          var off = SEED_OFF[seedSlot[i]] || SEED_OFF[0], peck = Math.sin(tState[i] * 2.3 + i) > 0.82 ? 1 : 0;
          var hx2 = sd.x + off[0] * (1 - 0.6 * peck) + 6 * Math.sin(tState[i] * 3.1 + i), hy2 = sd.y + off[1] * (1 - 0.7 * peck) + 5 * Math.sin(tState[i] * 4.3 + i * 2);
          var ddx = hx2 - bx[i], ddy = hy2 - by[i], dd = Math.hypot(ddx, ddy), sp2 = Math.min(SPEED * 1.5, dd * 3 + 20);
          vx[i] += (ddx / Math.max(1, dd) * sp2 - vx[i]) * (1 - Math.exp(-dt * 5)); vy[i] += (ddy / Math.max(1, dd) * sp2 - vy[i]) * (1 - Math.exp(-dt * 5));
          bx[i] += vx[i] * dt; by[i] += vy[i] * dt;
          face[i] = dd > 60 ? (vx[i] >= 0 ? 1 : -1) : (sd.x >= bx[i] ? 1 : -1);
        }
      }
      // lit = warmed by a person: on them, landing on them, close to their spot, or at a seed; otherwise it cools
      for (i = 0; i < N; i++) {
        var want2 = 0, s2 = st[i];
        if (tid[i] >= 0 && (s2 === PERCH || s2 === LAND)) want2 = 1;
        else if (tid[i] >= 0 && s2 === APPROACH) want2 = smoothstep(80, 25, Math.hypot(tx[i] - bx[i], ty[i] - by[i]));
        else if (s2 === SEEDING && seeds[seedOf[i]]) want2 = smoothstep(110, 50, Math.hypot(seeds[seedOf[i]].x - bx[i], seeds[seedOf[i]].y - by[i]));
        lit[i] = want2 > lit[i] ? lit[i] + (want2 - lit[i]) * (1 - Math.exp(-dt / 0.12)) : lit[i] * Math.exp(-dt / (lit[i] > 0.08 ? LIT_FADE_S : 0.2));
        if (lit[i] < 0.003) lit[i] = 0;
      }
      for (var f = 0; f < MAXF; f++) if (fage[f] < flife[f]) {
        fage[f] += dt; fvx[f] *= Math.exp(-dt * 2.2); fvy[f] += (32 - fvy[f]) * (1 - Math.exp(-dt * 2));
        fx_[f] += (fvx[f] + 26 * Math.sin(fage[f] * 2.6 + fph[f])) * dt; fy_[f] += fvy[f] * dt; fr[f] += fvr[f] * dt + 0.9 * Math.cos(fage[f] * 2.6 + fph[f]) * dt;
      }
    }
    function freeSpot2(i, x) { for (var j = 0; j < N; j++) if (j !== i && st[j] === PERCH && tid[j] === tid[i] && Math.abs(bx[j] - x) < GAP_PX * 0.8 && Math.abs(by[j] - by[i]) < 30) return false; return true; }
    function smoothstep(a, b, x) { var t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

    // ---------------------------------------------------------------- sprites for this frame
    function put(x, y, size, angle, frame, flip, l, sh) {
      if (nInst >= MAXI) return; var o = nInst * 8;
      inst[o] = x; inst[o + 1] = y; inst[o + 2] = size; inst[o + 3] = angle; inst[o + 4] = frame; inst[o + 5] = flip; inst[o + 6] = l; inst[o + 7] = sh; nInst++;
    }
    function animate(dt) {
      for (var i = 0; i < N; i++) {
        var s = st[i];
        if (s === PERCH) continue;
        // flap in bursts like a small bird; always flap when climbing, landing, startled or hovering
        flapT[i] -= dt;
        if (flapT[i] < 0) { flapOn[i] = flapOn[i] ? 0 : 1; flapT[i] = flapOn[i] ? rnd(0.5, 1.2) : rnd(0.25, 0.7); }
        var flapping = flapOn[i] || s !== FLY || excite[i] > 0.25 || vy[i] < -45;
        var rate = s === SEEDING || s === LAND ? 11 : 7.5 + 5 * excite[i] + (s === APPROACH ? 2 : 0);
        if (flapping) phase[i] = (phase[i] + dt * rate) % 1;
        var want = 0;
        if (s !== LAND && s !== SEEDING) { var h = Math.abs(vx[i]) > 1 ? vx[i] : face[i]; face[i] = h >= 0 ? 1 : -1; want = Math.max(-0.65, Math.min(0.65, Math.atan2(vy[i], Math.abs(vx[i]) + 1e-3))) * face[i]; }
        ang[i] += (want - ang[i]) * (1 - Math.exp(-dt * 8));
        pose[i] = flapping ? [F_UP, F_MID, F_DOWN, F_MID][Math.floor(phase[i] * 4) % 4] : F_GLIDE;
        if (s === LAND) pose[i] = tState[i] / tDur[i] < 0.55 ? (phase[i] < 0.5 ? L_FLARE : F_DOWN) : L_FLARE;
        if (s === SEEDING) pose[i] = phase[i] < 0.5 ? L_FLARE : H_DOWN;
      }
    }
    function buildSprites() {
      nInst = 0;
      var k = FLOCK_GLOW;
      for (var pass = 0; pass < 2; pass++) for (var i = 0; i < N; i++) {
        var s = st[i], onPerson = (s === PERCH || s === LAND || s === APPROACH || s === SEEDING) && tid[i] !== -1 && tid[i] !== -9;
        if ((pass === 0) === onPerson) continue;             // flock and ledge first, then the birds on people on top
        var sh = (lit[i] > 0.02 ? 1 : shade[i] * k * (onPerson ? 1 : wallK)), sz, a = 0, yy = by[i];
        if (s === PERCH) { sz = PERCH_PX * sizeK[i]; yy = by[i] + 2 - ANCHOR_Y[pose[i]] * sz; }
        else if (s === LAND) { sz = FLY_PX * sizeK[i]; yy = by[i] - ANCHOR_Y[L_FLARE] * sz * Math.min(1, tState[i] / tDur[i]); }
        else if (s === SEEDING) sz = FLY_PX * sizeK[i];
        else { sz = FLY_PX * sizeK[i]; a = ang[i]; }
        put(bx[i], yy, sz, a, pose[i], face[i], Math.min(1, lit[i]), (lit[i] > 0.02 || onPerson) ? Math.min(1, sh + lit[i]) : Math.min(3, sh));   // the flock/ledge (empty-wall light) may rise above 1; lit and perched birds keep the old cap
      }
      for (var f = 0; f < MAXF; f++) if (fage[f] < flife[f]) { var u = fage[f] / flife[f]; put(fx_[f], fy_[f], 34, fr[f], FEATHER, 1, 0.75, 0.62 * (1 - u) * (1 - u)); }
      for (var q = 0; q < seeds.length; q++) {
        var sd = seeds[q], fade = Math.max(0, Math.min(1, (SEED_LINGER_S - (elapsed - sd.last)) / 0.8));
        for (var g = 0; g < GRAINS; g++) put(sd.x + sd.grains[g * 3], sd.y + sd.grains[g * 3 + 1] + 4, 13, sd.grains[g * 3 + 2], SEED, 1, 2, fade * (0.85 + 0.15 * Math.sin(elapsed * 5 + g * 1.7)));
      }
    }

    // ---------------------------------------------------------------- frame
    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); elapsed += dt; frames++;
      var t0 = performance.now();
      checkSize();
      var folded = body.update(dt, now);
      if (body.fresh) { if (wasStale) { graceUntil = elapsed + GRACE_S; if (people.length) { gaps++; maxGap = Math.max(maxGap, elapsed - lastFreshAt); } } wasStale = false; lastFreshAt = elapsed; } else wasStale = true;
      if (folded) { var dtS = lastFoldMs > 0 ? Math.min(0.2, (body.frameMs - lastFoldMs) / 1000) : 0; lastFoldMs = body.frameMs; fold(Math.max(0, dtS)); }
      else if (!body.fresh) fadeBody(dt);
      fingers();
      if (dt > 0) {
        census(); dispatch(dt);
        var steps = Math.max(1, Math.ceil(dt / (1 / 50))), h = dt / steps;
        for (var k = 0; k < steps; k++) steer(h);
        animate(dt);
      }
      buildSprites();
      simMs = performance.now() - t0;
      draw();
    }
    function draw() {
      var W = canvas.width, H = canvas.height, hinv = body.hinv();
      gl.viewport(0, 0, W, H); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(sky.p); gl.bindVertexArray(emptyVao);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(sky.U.uBody, 0);
      gl.uniformMatrix3fv(sky.U.uHinv, false, hinv);
      gl.uniform1f(sky.U.uTime, elapsed); gl.uniform1f(sky.U.uAspect, W / Math.max(1, H)); gl.uniform1f(sky.U.uPx, W / 1280);
      gl.uniform2f(sky.U.uStep, 7 / 1280, 7 / 1280 * W / Math.max(1, H)); gl.uniform1f(sky.U.uRim, RIM); gl.uniform1f(sky.U.uHalo, HALO); gl.uniform1f(sky.U.uHaloCells, HALO_CELLS); gl.uniform1f(sky.U.uDark, DARK_INSIDE); gl.uniform1f(sky.U.uWall, wallK);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (nInst) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(bird.p); gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, ibuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, nInst * 8);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(bird.U.uAtlas, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(bird.U.uBody, 1);
        gl.uniformMatrix3fv(bird.U.uHinv, false, hinv); gl.uniform2f(bird.U.uWorld, WX, WY);
        gl.uniform3fv(bird.U.uCool, COOL); gl.uniform3fv(bird.U.uWarm, WARM); gl.uniform3fv(bird.U.uGold, GOLD);
        gl.uniform1f(bird.U.uDark, DARK_INSIDE); gl.uniform1f(bird.U.uOutline, 0.85);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nInst);
        gl.disable(gl.BLEND); gl.bindBuffer(gl.ARRAY_BUFFER, null);
      }
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    }
    function touch(t) { if (t && t.x >= 0 && t.x <= 1 && t.y >= 0 && t.y <= 1) touchPts.push({x: t.x, y: t.y, t: Date.now()}); if (touchPts.length > 8) touchPts.shift(); }
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.RoostSet === set) delete window.RoostSet;
      if (window.RoostWake === wake) delete window.RoostWake; kit.wantDepth(false);
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
      if (window.__roostDebug) try { delete window.__roostDebug; } catch (e) { window.__roostDebug = undefined; }
    }
    kit.wantDepth(true);
    checkSize();
    if (window.WallTest) window.__roostDebug = function (opt) {   // sandbox only (the live wall has no WallTest)
      census();
      var names = ['fly', 'approach', 'land', 'perch', 'takeoff', 'seed'], c = {}, perched = [], M = body.hinv();
      names.forEach(function (n, k) { c[n] = counts[k]; });
      var ledgeN = 0, litN = 0, flyMove = 0, nf = 0;
      function maskAt(x, y) {                // independent of the piece's own grids: the stage's raw mask through hinv
        var wx = x / WX, wy = y / WY, kx = M[0] * wx + M[3] * wy + M[6], ky = M[1] * wx + M[4] * wy + M[7], kz = M[2] * wx + M[5] * wy + M[8];
        var u = kx / kz * BW - 0.5, v = ky / kz * BH - 0.5; if (!(kz > 0) || u < 0 || v < 0 || u > BW - 1 || v > BH - 1) return 0;
        var x0 = Math.floor(u), y0 = Math.floor(v), ax = u - x0, ay = v - y0, i = y0 * BW + x0, x1 = x0 < BW - 1 ? 1 : 0, y1 = y0 < BH - 1 ? BW : 0, m = body.mask;
        return (m[i] * (1 - ax) + m[i + x1] * ax) * (1 - ay) + (m[i + y1] * (1 - ax) + m[i + y1 + x1] * ax) * ay;
      }
      for (var i = 0; i < N; i++) {
        if (st[i] === PERCH && ledge[i]) ledgeN++;
        if (lit[i] > 0.3) litN++;
        if (st[i] === FLY) { flyMove += Math.hypot(vx[i], vy[i]); nf++; }
        if (st[i] === PERCH && tid[i] >= 0) perched.push({pid: tid[i], x: +(bx[i] / WX).toFixed(4), y: +(by[i] / WY).toFixed(4), below: +maskAt(bx[i], by[i] + 8).toFixed(2), above: +maskAt(bx[i], by[i] - 22).toFixed(2)});
      }
      var ps = people.map(function (p, q) { var s = pstate[idOfLabel[q]] || {}; return {id: idOfLabel[q], act: +(s.act || 0).toFixed(3), share: +(s.share || 0).toFixed(2), area: p.area, cx: +p.cx.toFixed(3), calm: +(s.calm || 0).toFixed(2), warm: +(s.warm || 0).toFixed(2), moving: +p.moving.toFixed(3), still: +p.still.toFixed(2), birds: perPid[idOfLabel[q]] || 0}; });
      var out = {frames: frames, states: c, ledge: ledgeN, lit: litN, flySpeed: nf ? Math.round(flyMove / nf) : 0, people: ps, perched: perched, seeds: seeds.map(function (s) { return [+(s.x / WX).toFixed(3), +(s.y / WY).toFixed(3)]; }),
        seedBirds: (function () { var r = []; for (var i = 0; i < N; i++) if (st[i] === SEEDING) r.push([+(bx[i] / WX).toFixed(3), +(by[i] / WY).toFixed(3)]); return r; })(),
        feathers: (function () { var n = 0; for (var f = 0; f < MAXF; f++) if (fage[f] < flife[f]) n++; return n; })(),
        takeoffs: takeoffs, reasons: reasons, depthGaps: gaps, maxGapS: +maxGap.toFixed(2), landings: landings, simMs: +simMs.toFixed(2), foldMs: +body.foldMs.toFixed(2), regOk: body.regOk, fresh: body.fresh, world: [WX, +WY.toFixed(1)], glError: gl.getError(),
        nan: (function () { for (var i = 0; i < N; i++) if (!(bx[i] === bx[i] && by[i] === by[i])) return true; return false; })()};
      if (opt === 'atlas') out.atlas = buildAtlas().canvas.toDataURL('image/png');
      return out;
    };
    function set(opts) {
      if (!opts || destroyed) return {speed: SPEED, birds: BIRDS, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.speed)) SPEED = Math.max(50, Math.min(350, opts.speed));
      if (Number.isFinite(opts.birds)) BIRDS = Math.max(50, Math.min(400, opts.birds));
      return {speed: SPEED, birds: BIRDS, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      var force = true;
      try {
        if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
      } catch (e) {}
    }
    window.RoostSet = set;
    window.RoostWake = wake;
    if (window._roostFx) set(window._roostFx);

    return {frame: frame, touch: touch, destroy: destroy};
  }
})();
