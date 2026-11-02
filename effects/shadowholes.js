/* Shadow Holes — make a hole with your body and it falls out as a shape (2026-10-05; fx-research concept #6, built by Claude (fx-batch)).
 *
 * Your outline glows warm on the wall. Make a hole with your body (hands on hips, arms in a ring over your head, a hand on your
 * head, two people joined at hands and feet) and the hole lights up at its rim, then fills with glowing wax from the edge
 * inward. Hold it about a second and the wax sets: the exact shape of your hole drops out, falls, tumbles, bounces and comes to
 * rest in a pile of soft wax shapes along the bottom of the wall, cooling from white-gold to a deep ember glow. Keep the hole
 * open and an eye opens in it, looks around and blinks. Walk through the pile and the shapes get shoved aside; the pile warms
 * up near you; poke a shape with a fingertip and it hops. Old shapes melt back into the wax pool after a minute; the newest
 * few always stay, so the empty wall is the softly glowing pile of the last visitors' shapes.
 * Nothing is projected inside a person (DARK_INSIDE): the wax in a hole is light passing THROUGH your ring onto the wall.
 *
 * How: a hole = empty cells of WallBody's 128 x 106 grid that the picture's border cannot reach (a 4-connected flood fill, the
 * partner of the stage's 8-connected people), bordered by a real person, at least HOLE_MIN cells, and showing the wall itself
 * in the raw depth (a no-reading patch on dark clothes is not a hole). Holes are tracked by overlap; each drops ONE shape and
 * re-arms only after it has been closed for REARM_S. A shape is the hole's outline (the body mask's 0.5 crossing) resampled
 * into wall space (64 x 64 texels through the registration) and turned into a signed distance field. All shapes are splatted
 * additively into one half-resolution field, so touching shapes fuse like wax (Lava Lamp's metaball look; its normal shading
 * done here with field differences). Physics: rigid bodies at a fixed 120 Hz (impulses at boundary points) against the floor,
 * the picture's sides, every other shape (through its own signed distance field), and people (WallBody's sdf, people only).
 * Computed inside this piece (body.js untouched): the holes, a people-only mask, each hole's depth map for the fill front.
 * WebGL 2 (+ EXT_color_buffer_float when available), no assets, no audio, one depth client (via the host).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  // (px = pixels on the 1280 x 800 picture; cells = Kinect body cells, about 11 px on this wall)
  var HOLE_MIN = 9;           // smallest hole that counts (cells, ~11 px square each); an adult hands-on-hips triangle is about 40, a small child's about 10
  var HOLE_MAX = 1500;        // biggest hole that counts (cells); bigger enclosed areas are ignored
  var WALL_SEEN = 0.45;       // share of a hole's pixels that must show the wall itself (not a no-reading patch on dark clothes)
  var FILL_S = 0.9;           // seconds a steady hole takes to fill with wax and drop its shape
  var GRACE_S = 0.25;         // a hole that blinks shut for less than this is the same hole (keeps its fill)
  var REARM_S = 0.6;          // a hole that has dropped its shape must stay closed this long before it can drop another
  var EYE_AFTER_S = 1.2;      // a hole still held this long after its shape dropped opens an eye
  var BLINK_EVERY_S = 3.2;    // average seconds between blinks
  var OBJECT_S = 40;          // a 'person' that has not moved at all for this long is furniture: its holes go quiet
  var SPAWN_GAP_S = 0.8;      // one person drops at most one shape per this many seconds
  var MAX_FALLING = 10;       // most shapes in the air at once (a full hole waits its turn)
  var GRAVITY = 1500;         // how fast shapes fall (px per second per second)
  var TOP_SPEED = 1000;       // the fastest any shape moves (px per second): wax falls as if through thick air
  var BOUNCE = 0.3;           // how lively a landing is (0 = thud, 1 = superball)
  var FRICTION = 0.8;         // how much shapes grip each other and the floor
  var ROLL_STOP = 3;          // how quickly a shape stops rolling once it touches something (higher = settles sooner)
  var SPIN = 1.6;             // the random tumble a dropped shape gets (radians per second)
  var KICK = 0.8;             // how hard a moving body shoves shapes it sweeps into (1 = at the body's own speed)
  var KICK_MAX = 650;         // the fastest a shoved shape may fly (px per second)
  var KICK_WARM = 0.3;        // a shoved shape warms up this much (0..1 heat)
  var POKE = 520;             // a fingertip on a shape makes it hop at this speed (px per second)
  var ROUND_PX = 7;           // how soft a shape's edge is; touching shapes fuse within about this distance, like wax
  var DOME_PX = 24;           // how thick (domed) a shape looks
  var COOL_S = 6;             // seconds a dropped shape takes to cool from white-gold to its resting glow
  var REST_GLOW = 0.2;        // heat of a resting shape (0..1): sets its colour (deep ember) and brightness
  var IDLE_CAP = 0.19;        // the brightest any resting wax or the pool may get (0.19 = 48 of 255, ~55 with its glow); brighter light is the participants'
  var WARM_CAP = 0.3;         // the brightest wax warmed by a shove or a nearby person may get (0.3 = 77 of 255): under any outline
  var BREATHE = 0.15;         // how much resting shapes slowly breathe in brightness
  var NEAR_GLOW = 0.2;        // resting shapes near a person warm up by this much heat
  var KEEP = 8;               // the newest this many shapes never melt (the wall remembers its last visitors)
  var LIFE_S = 60;            // shapes beyond the newest KEEP melt this many seconds after they land
  var MAX_SHAPES = 36;        // the pile never holds more shapes than this; the oldest melt early
  var PILE_MAX = 0.4;         // ...nor rises higher than this share of the wall's height
  var MELT_S = 5;             // seconds a melting shape takes to sink into the pool
  var POOL_PX = 14;           // depth of the wax pool along the bottom (px)
  var OUTLINE = 0.62;         // brightness of your outline
  var HALO = 0.2;             // the soft glow just outside your outline
  var MEMBRANE = 0.9;         // brightness of the wax filling a hole
  var EYE = 1.0;              // brightness of the eye in a held hole
  var GLINT = 0.4;            // the small warm glow under a fingertip
  var BLOOM = 0.3;            // soft glow around hot (fresh) shapes
  var DARK_INSIDE = 1.0;      // no light inside a person (1 = none, 0 = off)

  registerWallPlugin({id: 'shadowholes', title: 'Shadow Holes', author: 'Claude (fx-batch), fx-research concept #6', create: create});

  var SLOT = 64, SROW = 8, NSLOTS = 64, ATLAS = SLOT * SROW, NHOLES = 8, NEYES = 4, NTIPS = 4;
  var STEP = 1 / 120, MAX_STEPS = 6, STALE_HOLD_S = 0.7, WH = 800, MAXC = 96;

  var VS_FULL = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var VS_SPLAT = '#version 300 es\n' +
    'layout(location=0) in vec2 aC; layout(location=1) in vec4 aA; layout(location=2) in vec4 aB; layout(location=3) in vec4 aD;\n' +
    // aA: centroid x, y (wall px), angle, slot half size (px); aB: centroid in the slot (px from its centre), slot, weight;
    // aD: heat, melt, lowest y (px), -
    'uniform vec2 uWall; out vec2 vT; out vec3 vWH;\n' +
    'void main(){ vec2 r=aC*aA.w-aB.xy; float c=cos(aA.z), s=sin(aA.z);\n' +
    '  vec2 w=aA.xy+vec2(c*r.x-s*r.y, s*r.x+c*r.y);\n' +
    '  w.y=mix(w.y,aD.z,.6*aD.y); w.x=aA.x+(w.x-aA.x)*(1.+.35*aD.y);\n' +         // a melting shape sags into the pool
    '  vec2 so=vec2(mod(aB.z,8.),floor(aB.z/8.+1e-3)); vT=(so+aC*.5+.5)/8.; vWH=vec3(aB.w,aD.x,aD.w);\n' +
    '  gl_Position=vec4(w.x/uWall.x*2.-1., 1.-w.y/uWall.y*2., 0., 1.); }\n';
  var FS_SPLAT = '#version 300 es\nprecision highp float;\nuniform sampler2D uAtlas; in vec2 vT; in vec3 vWH; out vec4 o;\n' +
    'void main(){ vec2 a=texture(uAtlas,vT).rg; float f=a.r*vWH.x; o=vec4(f, f*vWH.y, a.g*vWH.x, f*vWH.z); }\n';
  // Every texture read and derivative below runs for every pixel (loops over uniforms only), so fwidth() stays well defined.
  var FS_COMP = '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uField, uMask, uHole; uniform mat3 uHinv;\n' +
    'uniform vec2 uWall, uFT; uniform float uTime, uPx, uDark, uOutline, uHalo, uMem, uEyeB, uIdleCap, uWarmCap, uBloom, uPoolPx, uPoolHeat, uGlint, uRest, uWallK;\n' +
    'uniform float uFill[8]; uniform vec4 uEyeP[4], uEyeL[4], uTip[4];\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}\n' +
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' +
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}\n' +
    'vec3 wax(float h){vec3 c0=vec3(.92,.13,.05),c1=vec3(1.,.36,.07),c2=vec3(1.,.70,.30),c3=vec3(1.,.88,.62);\n' +
    '  return h<.35?mix(c0,c1,h/.35):h<.7?mix(c1,c2,(h-.35)/.35):mix(c2,c3,(h-.7)/.3);}\n' +
    'void main(){\n' +
    '  vec2 P=vec2(vUv.x*uWall.x,(1.-vUv.y)*uWall.y);\n' +                       // wall px, y down
    // ---- the wax: every shape's field, plus the pool along the bottom
    '  vec4 f=texture(uField,vUv);\n' +
    '  float surf=uWall.y-uPoolPx+2.5*sin(P.x*.011+uTime*.35)+1.5*sin(P.x*.029-uTime*.47);\n' +
    '  float Fp=.5*exp(clamp((P.y-surf)/7.,-20.,4.));\n' +
    '  float F=f.r+Fp, heat=(f.g+Fp*uPoolHeat)/max(F,1e-4), dome=f.b+clamp((P.y-surf)/30.,0.,.8);\n' +
    '  float aa=max(fwidth(F),1e-3)*.75, inside=smoothstep(.5-aa,.5+aa,F);\n' +
    '  float dx=textureLod(uField,vUv+vec2(2.*uFT.x,0.),1.).b-textureLod(uField,vUv-vec2(2.*uFT.x,0.),1.).b;\n' +
    '  float dy=textureLod(uField,vUv+vec2(0.,2.*uFT.y),1.).b-textureLod(uField,vUv-vec2(0.,2.*uFT.y),1.).b;\n' +
    '  vec3 n=normalize(vec3(-dx*1.6,-dy*1.6,1.)), L=normalize(vec3(-.35,.6,.72));\n' +
    '  float lit=.62+.38*dot(n,L), spec=pow(max(dot(reflect(-L,n),vec3(0.,0.,1.)),0.),12.);\n' +
    '  vec3 wc=wax(heat); float I=mix(.5,1.0,smoothstep(.15,1.,heat));\n' +
    '  vec3 w=(wc*(.22+.88*clamp(dome,0.,1.))*lit*I+vec3(1.,.85,.6)*spec*(.12+.25*heat))*inside;\n' +
    '  w*=mix(.78+.4*noise(P*.022+vec2(uTime*.05,-uTime*.035)),1.,smoothstep(.3,.6,heat));\n' +
    '  w+=wc*smoothstep(.12,.5,F)*(1.-inside)*.28*I;\n' +                         // a soft glow just outside the wax
    '  float hot=f.a/max(f.r,1e-4), warmK=smoothstep(uRest+.05,uRest+.25,heat), idleCap=uIdleCap*uWallK;\n' +
    '  w*=mix(uWallK,1.,max(warmK,smoothstep(.12,.45,hot)));\n' +                  // \'Empty wall\': only RESTING wax and pool scale (warmed / fresh wax is the participants\')
    '  float cap=mix(idleCap,max(uWarmCap,idleCap),warmK);\n' +                   // resting wax capped (lifted with the knob), warmed wax a little higher,
    '  cap=mix(cap,8.,smoothstep(.12,.45,hot));\n' +                              // only freshly dropped or poked wax is free (participant light)
    '  w*=min(1.,cap/max(lum(w),1e-4));\n' +
    '  vec3 col=(vec3(.016,.004,.010)+vec3(.07,.018,.022)*exp(-(uWall.y-P.y)/110.))*uWallK+w;\n' +
    '  col+=vec3(1.,.55,.2)*textureLod(uField,vUv,3.).a*uBloom;\n' +
    // ---- the body, through the registration (Kinect space)
    '  vec3 hk=uHinv*vec3(vUv.x,1.-vUv.y,1.); vec2 k=hk.xy/max(hk.z,1e-6);\n' +
    '  float inK=(hk.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.; k=clamp(k,0.,1.);\n' +
    '  float m=texture(uMask,k).r*inK; vec4 hl=texture(uHole,k)*inK;\n' +
    '  int slot=int(texelFetch(uHole,ivec2(min(k*vec2(128.,106.),vec2(127.,105.))),0).b*16.+.5)-1;\n' +
    '  float fwm=max(fwidth(m),1e-4);\n' +
    // ---- a hole: its rim lights at once, then wax fills it from the rim inward
    '  float fill=(slot>=0&&slot<8&&inK>0.)?uFill[slot]:0.;\n' +
    '  float inHole=smoothstep(.15,.5,hl.r)*(1.-smoothstep(.42,.58,m));\n' +
    '  float g=hl.g, fl=fill*1.1;\n' +
    '  float filled=smoothstep(g-.08,g,fl)*step(.001,fill), front=exp(-pow((fl-g)/.045,2.))*step(.02,fill)*step(fl,1.05);\n' +
    '  float sw=noise(P*.05+vec2(uTime*.4,-uTime*.25))*.6+noise(P*.13-vec2(uTime*.3,uTime*.5))*.4;\n' +
    '  vec3 mem=wax(.4+.55*fill)*(.4+.55*fill)*(.8+.4*sw)*filled+vec3(1.,.88,.62)*front*.55+vec3(1.,.55,.25)*smoothstep(.04,.45,m)*.5;\n' +
    '  col+=mem*inHole*uMem;\n' +
    // ---- an eye in a hole held open
    '  for(int i=0;i<4;i++){ float a=uEyeL[i].z; if(a<=0.) continue;\n' +
    '    vec2 c=uEyeP[i].xy, d=P-c; float R=uEyeP[i].z, op=uEyeP[i].w;\n' +
    '    float socket=inHole*smoothstep(R*3.4,R*2.8,length(d));\n' +
    '    float lid=1.75*R*op*sqrt(max(0.,1.-pow(d.x/(2.7*R),2.)));\n' +
    '    float vis=smoothstep(lid+1.2,lid-1.2,abs(d.y))*socket;\n' +
    '    vec2 e=P-(c+uEyeL[i].xy*R*.75); float r=length(e);\n' +
    '    float iris=smoothstep(R+1.2,R-1.2,r), pupil=smoothstep(R*.46+1.,R*.46-1.,r), ang=atan(e.y,e.x);\n' +
    '    vec3 ir=vec3(1.,.58,.12)*(.6+.4*noise(vec2(ang*9.,r*.2)))*(.75+.35*smoothstep(R*.45,R*.8,r));\n' +
    '    ir=mix(ir,vec3(.35,.08,.02),smoothstep(R*.78,R,r));\n' +
    '    vec3 scl=vec3(1.,.8,.56)*.66*(1.-.55*pow(clamp(abs(d.y)/max(lid,1.),0.,1.),2.));\n' +
    '    vec3 ec=mix(scl,ir,iris); ec=mix(ec,vec3(.02,.005,.005),pupil);\n' +
    '    vec2 hp=e-vec2(-.32,-.36)*R; ec+=vec3(1.,.95,.85)*.8*exp(-dot(hp,hp)/(R*R*.012));\n' +
    '    float lidLine=exp(-pow((abs(d.y)-lid)/1.6,2.))*socket*step(abs(d.x),2.7*R);\n' +
    '    col=mix(col,ec*uEyeB,vis*a); col+=vec3(1.,.66,.35)*lidLine*a*.7; }\n' +
    // ---- your outline, and the glow just outside it
    '  float line=exp(-pow(abs(m-.5)/fwm/(1.5*uPx),2.)), halo=smoothstep(0.,.5,m)*(1.-smoothstep(.45,.55,m));\n' +
    '  col+=vec3(1.,.72,.45)*line*uOutline+vec3(1.,.42,.18)*halo*uHalo;\n' +
    '  for(int i=0;i<4;i++){ if(uTip[i].z<=0.) continue; vec2 d=P-uTip[i].xy; col+=vec3(1.,.6,.3)*uTip[i].z*exp(-dot(d,d)/196.)*uGlint; }\n' +
    '  col*=1.-uDark*smoothstep(.55,.8,m);\n' +                                  // nothing projected inside a person
    '  o=vec4(min(col,vec3(1.)),1.);\n' +
    '}\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Shadow Holes needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false});
    if (!gl) throw new Error('Shadow Holes needs WebGL 2');
    var wallK = 2.0;            // 'Empty wall' knob (1 = the 2026-10-05 picture): scales resting wax, the pool and the floor glow, lifts IDLE_CAP with it; warmed/fresh wax, outline, membrane, eye are untouched
    var made = [], destroyed = false, floatOk = !!gl.getExtension('EXT_color_buffer_float');
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
      var U = {}; names.forEach(function (n) { U[n] = gl.getUniformLocation(p, n); });
      return {p: p, U: U};
    }
    function tex(w, h, ifmt, fmt, type, filter, data) {
      var t = gl.createTexture(); made.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    var compP = program(VS_FULL, FS_COMP, ['uField', 'uMask', 'uHole', 'uHinv', 'uWall', 'uFT', 'uTime', 'uPx', 'uDark', 'uOutline', 'uHalo', 'uMem',
      'uEyeB', 'uIdleCap', 'uWarmCap', 'uBloom', 'uPoolPx', 'uPoolHeat', 'uGlint', 'uRest', 'uWallK', 'uFill', 'uEyeP', 'uEyeL', 'uTip']);
    var splat = program(VS_SPLAT, FS_SPLAT, ['uAtlas', 'uWall']);
    var vaoFull = gl.createVertexArray(); made.push(['VertexArray', vaoFull]);
    var vaoSplat = gl.createVertexArray(); made.push(['VertexArray', vaoSplat]);
    gl.bindVertexArray(vaoSplat);
    var cornerBuf = gl.createBuffer(); made.push(['Buffer', cornerBuf]);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var instBuf = gl.createBuffer(); made.push(['Buffer', instBuf]);
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferData(gl.ARRAY_BUFFER, NSLOTS * 48, gl.DYNAMIC_DRAW);
    for (var ai = 0; ai < 3; ai++) { gl.enableVertexAttribArray(1 + ai); gl.vertexAttribPointer(1 + ai, 4, gl.FLOAT, false, 48, ai * 16); gl.vertexAttribDivisor(1 + ai, 1); }
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    var inst = new Float32Array(NSLOTS * 12);

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var BW = WallBody.w, BH = WallBody.h, N = BW * BH, body = WallBody.create(kit, {});
    var atlas = tex(ATLAS, ATLAS, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, gl.LINEAR, new Uint8Array(ATLAS * ATLAS * 2));
    var maskTex = tex(BW, BH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR, null);
    var holeTex = tex(BW, BH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, null);
    var fieldTex = null, fieldFb = null, fw = 0, fh = 0;
    function makeField() {
      if (fieldFb) { gl.deleteFramebuffer(fieldFb); gl.deleteTexture(fieldTex); made = made.filter(function (r) { return r[1] !== fieldFb && r[1] !== fieldTex; }); }
      fw = Math.max(16, canvas.width >> 1); fh = Math.max(16, canvas.height >> 1);
      fieldTex = floatOk ? tex(fw, fh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR_MIPMAP_LINEAR) : tex(fw, fh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      fieldFb = gl.createFramebuffer(); made.push(['Framebuffer', fieldFb]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    makeField();

    // ---------------------------------------------------------------- wall space: 800 px tall, as wide as the picture's shape
    var WW = WH * canvas.width / Math.max(1, canvas.height), floorY = WH - POOL_PX;
    var cellPx = 11, M9 = null;
    function wallToCell(X, Y, out) {           // wall px -> Kinect cell coordinates (cell centres at integers)
      var M = M9, x = X / WW, y = Y / WH, z = M[2] * x + M[5] * y + M[8];
      if (Math.abs(z) < 1e-9) z = 1e-9;
      out[0] = (M[0] * x + M[3] * y + M[6]) / z * BW - 0.5; out[1] = (M[1] * x + M[4] * y + M[7]) / z * BH - 0.5;
    }
    function cellToWall(cx, cy, out) {         // Kinect cell coordinates -> wall px (false when unregistered)
      var s = kit.toScreen((cx + 0.5) * 4, (cy + 0.5) * 4); if (!s) return false;
      out[0] = s[0] * WW; out[1] = s[1] * WH; return true;
    }
    function bil(arr, fx, fy) {
      if (fx < 0) fx = 0; if (fy < 0) fy = 0; if (fx > BW - 1) fx = BW - 1; if (fy > BH - 1) fy = BH - 1;
      var x0 = fx | 0, y0 = fy | 0, x1 = x0 < BW - 1 ? x0 + 1 : x0, y1 = y0 < BH - 1 ? y0 + 1 : y0, tx = fx - x0, ty = fy - y0;
      return (arr[y0 * BW + x0] * (1 - tx) + arr[y0 * BW + x1] * tx) * (1 - ty) + (arr[y1 * BW + x0] * (1 - tx) + arr[y1 * BW + x1] * tx) * ty;
    }
    var q2 = [0, 0];
    function personSdf(X, Y) {                 // distance to a real person's outline (cells; < 0 inside), 99 = nobody near
      if (!peopleNow) return 99;
      wallToCell(X, Y, q2); var fx = q2[0], fy = q2[1];
      if (!(fx > -1 && fx < BW && fy > -1 && fy < BH)) return 99;
      var i = Math.round(Math.max(0, Math.min(BH - 1, fy))) * BW + Math.round(Math.max(0, Math.min(BW - 1, fx)));
      if (!near[i]) return 99;
      return bil(body.sdf, fx, fy);
    }
    function motionAt(X, Y) { wallToCell(X, Y, q2); return bil(body.motion, q2[0], q2[1]); }

    // ---------------------------------------------------------------- per depth frame: people-only mask, holes
    var occ = new Uint8Array(N), comp = new Int32Array(N), queue = new Int32Array(N), near = new Uint8Array(N), tmpN = new Uint8Array(N);
    var maskU8 = new Uint8Array(N), holeRGBA = new Uint8Array(N * 4), holeGrid = new Int16Array(N).fill(-1), prevGrid = new Int16Array(N);
    var holes = [], nextHoleId = 1, slotUsed = [], peopleNow = false, freshClock = 0, staleT = 0, clock = 0, lastFrameMs = -1;
    var spawnBy = {}, spawned = 0, lastSpawn = null, spawnLog = [], holesSeen = 0, depthFrames = 0, foldHoleMs = 0;
    for (var hs = 0; hs < NHOLES; hs++) slotUsed.push(false);
    var c2 = [0, 0];

    function uploadMask() {
      var mk = body.mask;
      for (var i = 0; i < N; i++) maskU8[i] = near[i] ? Math.round(Math.max(0, Math.min(1, mk[i])) * 255) : 0;
      gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, maskU8);
    }
    function computeNear() {                   // cells within 2 of a real person (the stage's people; noise specks never count)
      var lab = body.label, x, y, i, q;
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) {
        var v = 0; for (q = -2; q <= 2 && !v; q++) { var xx = x + q; if (xx >= 0 && xx < BW && lab[y * BW + xx] >= 0) v = 1; } tmpN[y * BW + x] = v; }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) {
        i = y * BW + x; var u = 0; for (q = -2; q <= 2 && !u; q++) { var yy = y + q; if (yy >= 0 && yy < BH && tmpN[yy * BW + x]) u = 1; } near[i] = u; }
    }
    function findHoles() {                     // empty cells the picture's border cannot reach, grouped (4-connected)
      var lab = body.label, i, j, x, y, qh = 0, qt = 0;
      for (i = 0; i < N; i++) { occ[i] = lab[i] >= 0 ? 1 : 0; comp[i] = -1; }
      for (x = 0; x < BW; x++) { j = x; if (!occ[j] && comp[j] === -1) { comp[j] = -2; queue[qt++] = j; } j = (BH - 1) * BW + x; if (!occ[j] && comp[j] === -1) { comp[j] = -2; queue[qt++] = j; } }
      for (y = 1; y < BH - 1; y++) { j = y * BW; if (!occ[j] && comp[j] === -1) { comp[j] = -2; queue[qt++] = j; } j = y * BW + BW - 1; if (!occ[j] && comp[j] === -1) { comp[j] = -2; queue[qt++] = j; } }
      while (qh < qt) {
        i = queue[qh++]; x = i % BW; y = (i - x) / BW;
        if (x > 0 && !occ[i - 1] && comp[i - 1] === -1) { comp[i - 1] = -2; queue[qt++] = i - 1; }
        if (x < BW - 1 && !occ[i + 1] && comp[i + 1] === -1) { comp[i + 1] = -2; queue[qt++] = i + 1; }
        if (y > 0 && !occ[i - BW] && comp[i - BW] === -1) { comp[i - BW] = -2; queue[qt++] = i - BW; }
        if (y < BH - 1 && !occ[i + BW] && comp[i + BW] === -1) { comp[i + BW] = -2; queue[qt++] = i + BW; }
      }
      var found = [], dep = kit.depth(), dd = dep && dep.data, dw = dep && dep.wall, people = body.people;
      for (var s0 = 0; s0 < N; s0++) {
        if (occ[s0] || comp[s0] !== -1) continue;
        var id = found.length; qh = 0; qt = 0; comp[s0] = id; queue[qt++] = s0;
        while (qh < qt) {
          i = queue[qh++]; x = i % BW; y = (i - x) / BW;
          if (x > 0 && !occ[i - 1] && comp[i - 1] === -1) { comp[i - 1] = id; queue[qt++] = i - 1; }
          if (x < BW - 1 && !occ[i + 1] && comp[i + 1] === -1) { comp[i + 1] = id; queue[qt++] = i + 1; }
          if (y > 0 && !occ[i - BW] && comp[i - BW] === -1) { comp[i - BW] = id; queue[qt++] = i - BW; }
          if (y < BH - 1 && !occ[i + BW] && comp[i + BW] === -1) { comp[i + BW] = id; queue[qt++] = i + BW; }
        }
        var h = {cells: null, area: qt, ok: false};
        found.push(h);
        if (qt < HOLE_MIN || qt > HOLE_MAX) continue;
        var cells = new Int32Array(queue.subarray(0, qt)), sx = 0, sy = 0, x0 = BW, y0 = BH, x1 = -1, y1 = -1, maxD = 0, deep = cells[0], seen = 0, tot = 0, owners = {};
        for (var k = 0; k < qt; k++) {
          i = cells[k]; x = i % BW; y = (i - x) / BW; sx += x; sy += y;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          var dv = body.sdf[i]; if (dv > maxD) { maxD = dv; deep = i; }
          if (x > 0 && occ[i - 1]) owners[lab[i - 1]] = 1; if (x < BW - 1 && occ[i + 1]) owners[lab[i + 1]] = 1;
          if (y > 0 && occ[i - BW]) owners[lab[i - BW]] = 1; if (y < BH - 1 && occ[i + BW]) owners[lab[i + BW]] = 1;
          if (dd && dw) for (var yy = 0; yy < 4; yy++) { var base = (y * 4 + yy) * 512 + x * 4;
            for (var xx = 0; xx < 4; xx++) { var z = dd[base + xx], wz = dw[base + xx]; tot++; if (z > 0 && wz === wz && Math.abs(wz - z) < 110) seen++; } }
        }
        if (tot && seen / tot < WALL_SEEN) continue;                          // a no-reading patch, not the wall showing through
        var cxc = sx / qt, cyc = sy / qt;
        if (!cellToWall(cxc, cyc, c2) || c2[0] < 0.01 * WW || c2[0] > 0.99 * WW || c2[1] < 0.01 * WH || c2[1] > 0.99 * WH) continue;   // out of the picture
        var ids = [], dormant = true;
        Object.keys(owners).forEach(function (lb) { var p = people[+lb]; if (p) { ids.push(p.id); if (!(p.still > OBJECT_S)) dormant = false; } });
        if (!ids.length) continue;
        h.cells = cells; h.ok = true; h.cx = cxc; h.cy = cyc; h.box = [x0, y0, x1, y1]; h.maxD = Math.max(0.5, maxD); h.deep = deep;
        h.owners = ids; h.dormant = dormant; h.wx = c2[0]; h.wy = c2[1];
      }
      return found.filter(function (h) { return h.ok; });
    }
    function freeHoleSlot(h) { if (h.slot >= 0) slotUsed[h.slot] = false; h.slot = -1; }
    function trackHoles(found, dtD) {
      var i, k;
      prevGrid.fill(-1);
      for (k = 0; k < holes.length; k++) { var hc = holes[k].cells; for (i = 0; i < hc.length; i++) prevGrid[hc[i]] = k; }
      found.sort(function (a, b) { return b.area - a.area; });
      var taken = {}, counts = new Int32Array(holes.length + 1);
      found.forEach(function (f) {
        counts.fill(0);
        for (i = 0; i < f.cells.length; i++) { var p = prevGrid[f.cells[i]]; if (p >= 0) counts[p]++; }
        var best = -1, bc = 0;
        for (k = 0; k < holes.length; k++) if (!taken[k] && counts[k] > bc && counts[k] >= 0.3 * Math.min(f.area, holes[k].area)) { bc = counts[k]; best = k; }
        var h;
        if (best >= 0) {
          taken[best] = true; h = holes[best];
          var r = f.area / Math.max(1, h.areaS), jump = Math.hypot(f.cx - h.cx, f.cy - h.cy);
          if (h.steady) { if (r < 0.6 || r > 1.65 || jump > 3) h.steady = false; }
          else if (r > 0.8 && r < 1.25 && jump < 1.5) h.steady = true;
          h.areaS += (f.area - h.areaS) * (1 - Math.exp(-dtD / 0.35));
        } else {
          var sl = slotUsed.indexOf(false);
          if (sl < 0) return;                                               // NHOLES holes at once at most (largest first)
          slotUsed[sl] = true;
          h = {id: nextHoleId++, slot: sl, areaS: f.area, steady: true, fill: 0, fired: false, firedAt: 0, eye: 0, blinkAt: 0, nextBlink: 0,
               lookX: 0, lookY: 0, born: freshClock};
          holes.push(h); taken[holes.length - 1] = true; holesSeen++;
        }
        h.cells = f.cells; h.area = f.area; h.cx = f.cx; h.cy = f.cy; h.box = f.box; h.maxD = f.maxD; h.deep = f.deep; h.owners = f.owners;
        h.dormant = f.dormant; h.wx = f.wx; h.wy = f.wy; h.seen = freshClock;
        h.run = h.visibleNow ? (h.run || 0) + 1 : 1; h.visibleNow = true;
      });
      for (k = holes.length - 1; k >= 0; k--) {
        var hh = holes[k];
        if (!taken[k]) hh.visibleNow = false;
        if (freshClock - hh.seen > REARM_S) { freeHoleSlot(hh); holes.splice(k, 1); }
      }
    }
    function writeHoleTex() {
      holeRGBA.fill(0); holeGrid.fill(-1);
      holes.forEach(function (h) {
        if (!h.visibleNow || h.slot < 0 || h.run < 2) return;
        var cells = h.cells, sdf = body.sdf, b = (h.slot + 1) * 16, i, x, y;
        for (var k = 0; k < cells.length; k++) {
          i = cells[k]; holeGrid[i] = h.slot;
          holeRGBA[i * 4] = 255; holeRGBA[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, sdf[i] / h.maxD)) * 255); holeRGBA[i * 4 + 2] = b;
        }
        for (k = 0; k < cells.length; k++) {                                // the slot reaches one cell into the body, so the fill meets the outline
          i = cells[k]; x = i % BW; y = (i - x) / BW;
          for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
            var xx = x + ox, yy = y + oy; if (xx < 0 || yy < 0 || xx >= BW || yy >= BH) continue;
            var j = yy * BW + xx; if (!holeRGBA[j * 4 + 2]) holeRGBA[j * 4 + 2] = b;
          }
        }
      });
      gl.bindTexture(gl.TEXTURE_2D, holeTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, holeRGBA);
    }
    function clearHoles() {
      holes.forEach(freeHoleSlot); holes = []; holeGrid.fill(-1); holeRGBA.fill(0);
      gl.bindTexture(gl.TEXTURE_2D, holeTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, holeRGBA);
    }
    function processDepth() {
      var t0 = performance.now(), dtD = lastFrameMs > 0 ? Math.min(0.2, Math.max(0, (body.frameMs - lastFrameMs) / 1000)) : 0.033;
      lastFrameMs = body.frameMs; depthFrames++;
      M9 = body.hinv();
      computeNear(); uploadMask();
      peopleNow = body.people.length > 0;
      if (body.regOk && kit.toScreen(256, 212)) {
        var a = kit.toScreen(256, 212), b = kit.toScreen(260, 212), c = kit.toScreen(256, 216);
        cellPx = 0.5 * (Math.hypot((b[0] - a[0]) * WW, (b[1] - a[1]) * WH) + Math.hypot((c[0] - a[0]) * WW, (c[1] - a[1]) * WH));
        trackHoles(peopleNow ? findHoles() : [], dtD);
      } else trackHoles([], dtD);
      writeHoleTex();
      wakeTouched();
      foldHoleMs = performance.now() - t0;
    }

    // ---------------------------------------------------------------- shapes: a slot in the atlas, a field, a rigid body
    var shapes = [], slotFree = [], landCount = 0, shapeId = 1, lastAgeMelt = -1e9, lastForceMelt = -1e9, melted = 0, lost = 0;
    for (var si = NSLOTS - 1; si >= 0; si--) slotFree.push(si);
    var vv = new Float32Array(SLOT * SLOT), bIn = new Uint8Array(SLOT * SLOT), dA = new Float32Array(SLOT * SLOT), dB = new Float32Array(SLOT * SLOT), slotData = new Uint8Array(SLOT * SLOT * 2);
    function chamfer(d) {
      var x, y, i, R2 = 1.4142, S = SLOT;
      for (y = 0; y < S; y++) for (x = 0; x < S; x++) { i = y * S + x; if (!d[i]) continue; var v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) { v = Math.min(v, d[i - S] + 1); if (x > 0) v = Math.min(v, d[i - S - 1] + R2); if (x < S - 1) v = Math.min(v, d[i - S + 1] + R2); }
        d[i] = v; }
      for (y = S - 1; y >= 0; y--) for (x = S - 1; x >= 0; x--) { i = y * S + x; if (!d[i]) continue; var u = d[i];
        if (x < S - 1) u = Math.min(u, d[i + 1] + 1);
        if (y < S - 1) { u = Math.min(u, d[i + S] + 1); if (x < S - 1) u = Math.min(u, d[i + S + 1] + R2); if (x > 0) u = Math.min(u, d[i + S - 1] + R2); }
        d[i] = u; }
    }
    // bIn (64 x 64, 1 = solid) covering a square of side S px centred at (cx, cy) -> a shape (null when too small)
    function finishShape(slot, cx, cy, S) {
      var tpx = S / SLOT, i, x, y, n = 0, sx = 0, sy = 0;
      for (y = 0; y < SLOT; y++) for (x = 0; x < SLOT; x++) { i = y * SLOT + x; bIn[i] = vv[i] > 0.5 && x > 0 && y > 0 && x < SLOT - 1 && y < SLOT - 1 ? 1 : 0; }
      for (i = 0; i < SLOT * SLOT; i++) { dA[i] = bIn[i] ? 1e6 : 0; dB[i] = bIn[i] ? 0 : 1e6; if (bIn[i]) n++; }
      if (n < 12) return null;
      chamfer(dA); chamfer(dB);
      for (i = 0; i < SLOT * SLOT; i++) dA[i] = bIn[i] ? dA[i] - 0.5 : -(dB[i] - 0.5);
      for (y = 1; y < SLOT - 1; y++) for (x = 1; x < SLOT - 1; x++) {             // next to the edge: sub-texel distance from the coverage
        i = y * SLOT + x; if (Math.abs(dA[i]) > 1.6) continue;
        var gg = 0.5 * Math.hypot(vv[i + 1] - vv[i - 1], vv[i + SLOT] - vv[i - SLOT]);
        if (gg > 0.02) dA[i] = Math.max(-1.5, Math.min(1.5, (vv[i] - 0.5) / gg));
      }
      var sig = 0.45 * cellPx / tpx, passes = Math.max(1, Math.min(8, Math.round(2 * sig * sig)));
      for (var pass = 0; pass < passes; pass++) {                                   // smooth the distance: no stair steps on big shapes
        for (y = 0; y < SLOT; y++) for (x = 0; x < SLOT; x++) { i = y * SLOT + x; dB[i] = (dA[i] * 2 + dA[x > 0 ? i - 1 : i] + dA[x < SLOT - 1 ? i + 1 : i]) * 0.25; }
        for (y = 0; y < SLOT; y++) for (x = 0; x < SLOT; x++) { i = y * SLOT + x; dA[i] = (dB[i] * 2 + dB[y > 0 ? i - SLOT : i] + dB[y < SLOT - 1 ? i + SLOT : i]) * 0.25; }
      }
      var field = new Uint8Array(SLOT * SLOT), bpts = [], buckets = {}, round = Math.max(ROUND_PX, tpx * 1.3), deepest = 0;
      for (i = 0; i < SLOT * SLOT; i++) deepest = Math.max(deepest, dA[i] * tpx);
      var domePx = Math.max(DOME_PX, 0.75 * deepest);
      for (y = 0; y < SLOT; y++) for (x = 0; x < SLOT; x++) {
        i = y * SLOT + x;
        var sd = dA[i] * tpx, tt;
        var fr = Math.max(0, Math.min(1, 0.5 + sd / (2 * round))), tt = Math.max(0, Math.min(1, sd / domePx)), fg = tt * (2 - tt);
        slotData[i * 2] = field[i] = Math.round(fr * 255); slotData[i * 2 + 1] = Math.round(fg * 255);
        if (bIn[i]) { sx += x; sy += y;
          if (x === 0 || y === 0 || x === SLOT - 1 || y === SLOT - 1 || !bIn[i - 1] || !bIn[i + 1] || !bIn[i - SLOT] || !bIn[i + SLOT]) bpts.push(x, y); }
      }
      var gxT = sx / n, gyT = sy / n, gx = (gxT + 0.5) * tpx - S / 2, gy = (gyT + 0.5) * tpx - S / 2, I = 0, rmax = 0;
      for (y = 0; y < SLOT; y++) for (x = 0; x < SLOT; x++) if (bIn[y * SLOT + x]) { var ddx = (x - gxT) * tpx, ddy = (y - gyT) * tpx; I += ddx * ddx + ddy * ddy; }
      var sp = new Float32Array(bpts.length), cp = [], sdPx = new Float32Array(SLOT * SLOT);
      for (i = 0; i < SLOT * SLOT; i++) sdPx[i] = dA[i] * tpx;
      for (i = 0; i < bpts.length; i += 2) {
        var lx = (bpts[i] + 0.5) * tpx - S / 2 - gx, ly = (bpts[i + 1] + 0.5) * tpx - S / 2 - gy;
        sp[i] = lx; sp[i + 1] = ly; rmax = Math.max(rmax, Math.hypot(lx, ly));
        var key = Math.floor(lx / 9) * 4096 + Math.floor(ly / 9);
        if (!buckets[key] && cp.length < MAXC * 2) { buckets[key] = 1; cp.push(lx, ly); }
      }
      gl.bindTexture(gl.TEXTURE_2D, atlas);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, (slot % SROW) * SLOT, Math.floor(slot / SROW) * SLOT, SLOT, SLOT, gl.RG, gl.UNSIGNED_BYTE, slotData);
      var area = n * tpx * tpx;
      return {id: shapeId++, slot: slot, S: S, tpx: tpx, gx: gx, gy: gy, m: area, I: Math.max(1, I * tpx * tpx), sp: sp, cp: new Float32Array(cp), rmax: rmax,
              field: field, sd: sdPx, x: cx + gx, y: cy + gy, a: 0, vx: 0, vy: 0, w: 0, state: 0, ghost: false, T: 0, kw: 0, nearT: 0, born: clock, restAt: 0,
              melt: 0, calm: 0, dynT: 0, low: 0, phase: Math.random() * 6.283, pokeAt: -1e9, land: 0, area: area};
    }
    var crop = new Float32Array(64 * 64), cropHole = new Uint8Array(64 * 64);
    function shapeFromHole(h, slot) {          // the hole's exact outline (the body mask's 0.5 crossing), in wall space
      if (!M9) return null;
      var bx0 = Math.max(0, h.box[0] - 2), by0 = Math.max(0, h.box[1] - 2), bx1 = Math.min(BW - 1, h.box[2] + 2), by1 = Math.min(BH - 1, h.box[3] + 2);
      var cw = bx1 - bx0 + 1, ch = by1 - by0 + 1, i, k, x, y;
      if (cw * ch > crop.length) { crop = new Float32Array(cw * ch); cropHole = new Uint8Array(cw * ch); }
      cropHole.fill(0, 0, cw * ch);
      for (k = 0; k < h.cells.length; k++) { i = h.cells[k]; x = i % BW; y = (i - x) / BW; cropHole[(y - by0) * cw + (x - bx0)] = 1; }
      var mk = body.mask, X0 = 1e9, Y0 = 1e9, X1 = -1e9, Y1 = -1e9;
      for (y = 0; y < ch; y++) for (x = 0; x < cw; x++) {
        var ring = 0;
        for (var oy = -1; oy <= 1 && !ring; oy++) for (var ox = -1; ox <= 1 && !ring; ox++) {
          var xx = x + ox, yy = y + oy; if (xx >= 0 && yy >= 0 && xx < cw && yy < ch && cropHole[yy * cw + xx]) ring = 1; }
        crop[y * cw + x] = ring ? 1 - Math.max(0, Math.min(1, mk[(y + by0) * BW + x + bx0])) : 0;
        if (cropHole[y * cw + x] && cellToWall(x + bx0, y + by0, c2)) { X0 = Math.min(X0, c2[0]); X1 = Math.max(X1, c2[0]); Y0 = Math.min(Y0, c2[1]); Y1 = Math.max(Y1, c2[1]); }
      }
      if (X1 < X0) return null;
      var S = Math.max(X1 - X0, Y1 - Y0) + 2 * cellPx + 2 * ROUND_PX + 8, cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2, tpx = S / SLOT, wx0 = 1e9, wy0 = 1e9, wx1 = -1e9, wy1 = -1e9;
      for (y = 0; y < SLOT; y++) for (x = 0; x < SLOT; x++) {
        wallToCell(cx - S / 2 + (x + 0.5) * tpx, cy - S / 2 + (y + 0.5) * tpx, q2);
        var fx = q2[0] - bx0, fy = q2[1] - by0, v = 0;
        if (fx >= 0 && fy >= 0 && fx <= cw - 1 && fy <= ch - 1) {
          var ix = Math.min(cw - 2, fx | 0), iy = Math.min(ch - 2, fy | 0), tx = fx - ix, ty = fy - iy;
          if (cw < 2 || ch < 2) v = crop[0];
          else v = (crop[iy * cw + ix] * (1 - tx) + crop[iy * cw + ix + 1] * tx) * (1 - ty) + (crop[(iy + 1) * cw + ix] * (1 - tx) + crop[(iy + 1) * cw + ix + 1] * tx) * ty;
        }
        var on = v > 0.5 && x > 0 && y > 0 && x < SLOT - 1 && y < SLOT - 1;
        vv[y * SLOT + x] = v;
        if (on) { var px = cx - S / 2 + (x + 0.5) * tpx, py = cy - S / 2 + (y + 0.5) * tpx; wx0 = Math.min(wx0, px); wx1 = Math.max(wx1, px); wy0 = Math.min(wy0, py); wy1 = Math.max(wy1, py); }
      }
      var s = finishShape(slot, cx, cy, S);
      if (s) s.spawnBox = [wx0 / WW, wy0 / WH, wx1 / WW, wy1 / WH];
      return s;
    }
    function shapeFromRecipe(slot, kind, size, rnd) {   // the seeded pile's shapes: the kinds of hole people make
      var S = size + 2 * ROUND_PX + 10, tpx = S / SLOT, x, y;
      var sq = 0.6 + 0.6 * rnd;                                                  // squash: each seed a little different
      for (y = 0; y < SLOT; y++) for (x = 0; x < SLOT; x++) {
        var cov = 0;
        for (var sy3 = 0; sy3 < 3; sy3++) for (var sx3 = 0; sx3 < 3; sx3++) {
          var u = ((x + (sx3 + 0.5) / 3) * tpx - S / 2) / (size / 2), v = ((y + (sy3 + 0.5) / 3) * tpx - S / 2) / (size / 2) / sq, on = false;
          if (kind === 0) on = u * u / 0.55 + v * v < 1;                                               // an oval (a looped arm)
          else if (kind === 1) on = v < 0.85 && v > -0.95 && Math.abs(u + 0.1 * v) < 0.62 * (0.85 - v) / 1.8 + 0.06;   // a hands-on-hips triangle
          else if (kind === 2) { var r = Math.hypot(u, v + 0.35); on = r < 1 && r > 0.55 && v < 0.4; }  // an arch (arms over a head)
          else if (kind === 3) on = Math.abs(u) / 0.62 + Math.abs(v) < 1;                              // a diamond (two people's ring)
          else { var r1 = Math.hypot(u, v), r2 = Math.hypot(u - 0.42, v - 0.1); on = r1 < 0.95 && r2 > 0.7; } // a crescent
          if (on) cov++;
        }
        vv[y * SLOT + x] = cov / 9;
      }
      return finishShape(slot, 0, 0, S);
    }
    function world(s, k, pts, out) { var c = Math.cos(s.a), sn = Math.sin(s.a), px = pts[k], py = pts[k + 1]; out[0] = s.x + c * px - sn * py; out[1] = s.y + sn * px + c * py; }
    var wp = [0, 0];
    var pileTopY = WH;
    function measurePile() {                   // how high the resting pile reaches (for the budget)
      var top = floorY;
      for (var k = 0; k < shapes.length; k++) if (shapes[k].state === 1) top = Math.min(top, topOf(shapes[k]));
      pileTopY = top;
    }
    function sdAt(sd, tx, ty) {
      var x0 = tx | 0, y0 = ty | 0, fx = tx - x0, fy = ty - y0, i = y0 * SLOT + x0;
      return (sd[i] * (1 - fx) + sd[i + 1] * fx) * (1 - fy) + (sd[i + SLOT] * (1 - fx) + sd[i + SLOT + 1] * fx) * fy;
    }
    function topOf(s) { var hi = 1e9; for (var j = 0; j < s.sp.length; j += 2) { world(s, j, s.sp, wp); hi = Math.min(hi, wp[1]); } return hi; }
    function lowest(s) { var lo = -1e9; for (var j = 0; j < s.sp.length; j += 2) { world(s, j, s.sp, wp); lo = Math.max(lo, wp[1]); } return lo; }
    function wake(s0) {                        // a resting shape starts moving again; whatever rested on it comes down too
      var woke = [s0]; s0.state = 0; s0.calm = 0; s0.dynT = 0;
      var more = true;
      while (more) {
        more = false;
        for (var k = 0; k < shapes.length; k++) {
          var s = shapes[k]; if (s.state !== 1) continue;
          for (var q = 0; q < woke.length; q++) { var o = woke[q];
            if (s.y < o.y && Math.abs(s.x - o.x) < s.rmax + o.rmax) { s.state = 0; s.calm = 0; s.dynT = 0; woke.push(s); more = true; break; } }
        }
      }
      measurePile();
    }
    function startMelt(s) { var wasRest = s.state === 1; s.low = lowest(s); s.state = 2; s.melt = 0; if (wasRest) { measurePile(); var above = shapes.filter(function (o) { return o.state === 1 && o.y < s.y && Math.abs(o.x - s.x) < o.rmax + s.rmax; }); above.forEach(function (o) { if (o.state === 1) wake(o); }); } }
    function removeShape(k) { slotFree.push(shapes[k].slot); shapes.splice(k, 1); }

    function seedPile() {                      // the empty wall at the start: earlier shapes, dropped and settled by the physics now
      var n = KEEP, order = [0, 2, 1, 3, 4, 1, 2, 0, 3], mounds = [0.12, 0.37, 0.63, 0.88], k;
      for (k = 0; k < n; k++) {
        var slot = slotFree.pop(); if (slot === undefined) break;
        var s = shapeFromRecipe(slot, order[k % order.length], 80 + 60 * Math.random(), Math.random());
        if (!s) { slotFree.push(slot); continue; }
        s.x = WW * (mounds[k % 4] + (Math.random() - 0.5) * 0.07); s.y = floorY - 70 - 170 * Math.floor(k / 4); s.a = Math.random() * 6.283;
        s.state = 0; s.T = 0; s.born = clock - LIFE_S * 0.5; shapes.push(s);
      }
      var pn = peopleNow; peopleNow = false;                                   // the seeds settle on their own, whoever is around
      for (k = 0; k < 1500 && shapes.some(function (q) { return q.state === 0; }); k++) stepAll();
      peopleNow = pn;
      shapes.forEach(function (q) { if (q.state === 0) { q.state = 1; q.vx = q.vy = q.w = 0; q.restAt = clock; q.land = ++landCount; } });
      measurePile();
    }

    // ---------------------------------------------------------------- holes over time: fill, drop, eye
    function canSpawn(h) {
      if (shapes.filter(function (s) { return s.state === 0; }).length >= MAX_FALLING || !slotFree.length) return false;
      for (var k = 0; k < h.owners.length; k++) if (freshClock - (spawnBy[h.owners[k]] || -1e9) < SPAWN_GAP_S) return false;
      return true;
    }
    function spawn(h) {
      if (!slotFree.length) makeRoom();
      var slot = slotFree.pop(); if (slot === undefined) return false;
      var s = shapeFromHole(h, slot);
      if (!s) { slotFree.push(slot); return false; }
      s.state = 0; s.ghost = true; s.T = 1; s.vy = 40; s.w = (Math.random() - 0.5) * SPIN; s.born = clock;
      shapes.push(s); spawned++;
      h.owners.forEach(function (id) { spawnBy[id] = freshClock; });
      var hb = [1e9, 1e9, -1e9, -1e9];
      for (var k = 0; k < h.cells.length; k++) { var i = h.cells[k], x = i % BW, y = (i - x) / BW; if (cellToWall(x, y, c2)) { hb[0] = Math.min(hb[0], c2[0]); hb[1] = Math.min(hb[1], c2[1]); hb[2] = Math.max(hb[2], c2[0]); hb[3] = Math.max(hb[3], c2[1]); } }
      lastSpawn = {at: +clock.toFixed(2), hole: h.id, owners: h.owners.slice(), holeBox: [hb[0] / WW, hb[1] / WH, hb[2] / WW, hb[3] / WH], shapeBox: s.spawnBox, area: Math.round(s.area), holeCells: h.area, shape: s.id};
      spawnLog.push(lastSpawn); if (spawnLog.length > 16) spawnLog.shift();
      return true;
    }
    function updateHoles(dtF) {
      var tips = tipPts;
      holes.forEach(function (h) {
        if (!h.visibleNow) { if (freshClock - h.seen > GRACE_S) { h.fill = Math.max(0, h.fill - dtF * 4); h.eye = Math.max(0, h.eye - dtF * 4); } return; }
        if (h.dormant) { h.fill = Math.max(0, h.fill - dtF); h.eye = Math.max(0, h.eye - dtF); return; }
        if (h.run < 2) return;
        if (!h.fired) {
          if (h.steady) h.fill = Math.min(1, h.fill + dtF / FILL_S);
          if (h.fill >= 1 && dtF > 0 && canSpawn(h) && spawn(h)) { h.fired = true; h.firedAt = freshClock; h.fill = 0; }
        } else if (freshClock - h.firedAt > EYE_AFTER_S) {
          if (h.eye === 0) h.nextBlink = freshClock + 0.8 + Math.random() * BLINK_EVERY_S;
          h.eye = Math.min(1, h.eye + dtF / 0.6);
          if (freshClock > h.nextBlink) { h.blinkAt = freshClock; h.nextBlink = freshClock + BLINK_EVERY_S * (0.4 + 1.2 * Math.random()); }
          // where it looks: a fingertip, else another person, else it wanders
          var tx = null, ty = null, bd = 1e9;
          for (var k = 0; k < tips.length; k += 2) { var dd = Math.hypot(tips[k] - h.wx, tips[k + 1] - h.wy); if (dd < bd) { bd = dd; tx = tips[k]; ty = tips[k + 1]; } }
          if (tx === null) body.people.forEach(function (p) { if (h.owners.indexOf(p.id) >= 0) return; if (cellToWall(p.cx * BW - 0.5, p.cy * BH - 0.5, c2)) { var d2 = Math.hypot(c2[0] - h.wx, c2[1] - h.wy); if (d2 < bd) { bd = d2; tx = c2[0]; ty = c2[1]; } } });
          var lx, ly;
          if (tx !== null) { var L = Math.max(1, Math.hypot(tx - h.wx, ty - h.wy)); lx = (tx - h.wx) / L; ly = (ty - h.wy) / L; }
          else { lx = Math.sin(clock * 0.53 + h.id) * 0.8; ly = Math.sin(clock * 0.37 + h.id * 2) * 0.5; }
          var kk = 1 - Math.exp(-dtF / 0.15); h.lookX += (lx - h.lookX) * kk; h.lookY += (ly - h.lookY) * kk;
        }
      });
    }

    // ---------------------------------------------------------------- fingertips: poke a shape (it hops), poke a hole (it drops)
    var tipPts = [], tipU = new Float32Array(NTIPS * 4);
    // Sparse mouse/HTTP wakes belong to this piece, never to the host's
    // authoritative fingers/touches. Each point expires on its own clock.
    var wakeTips = [], WAKE_MS = 250;
    function freshFingers() {
      var f = kit.fingers, age = f ? Date.now() - f.t : Infinity;
      return f && Array.isArray(f.pts) && age >= 0 && age <= 160 ? f : null;
    }
    function pruneWakes(now) {
      for (var i = wakeTips.length - 1; i >= 0; i--) if (now - wakeTips[i].t > WAKE_MS || now < wakeTips[i].t) wakeTips.splice(i, 1);
    }
    function fingerPts() {
      pruneWakes(performance.now());
      var f = freshFingers();
      if (f) { wakeTips.length = 0; return f.pts; }   // an empty fresh report also wins
      var out = [], now = Date.now(), tt = kit.touches || [], hostAt = kit.fingers && kit.fingers.t;
      function add(x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return;
        for (var j = 0; j < out.length; j++) if (Math.hypot(out[j][0] - x, out[j][1] - y) < 0.025) return;
        if (out.length < 8) out.push([x, y]);
      }
      for (var i = 0; i < wakeTips.length; i++) add(wakeTips[i].x, wakeTips[i].y);
      for (var k = 0; k < tt.length; k++) {
        var t = tt[k];
        if (t && now - t.t >= 0 && now - t.t <= WAKE_MS && (!Number.isFinite(hostAt) || t.t > hostAt)) add(t.x, t.y);
      }
      return out;
    }
    function rememberWake(x, y) {
      if (freshFingers()) { wakeTips.length = 0; return; }
      var now = performance.now(); pruneWakes(now);
      for (var i = 0; i < wakeTips.length; i++) {
        var t = wakeTips[i];
        if (Math.hypot(t.x - x, t.y - y) < 0.025) { t.x = x; t.y = y; t.t = now; return; }
      }
      if (wakeTips.length >= 8) wakeTips.shift();
      wakeTips.push({x: x, y: y, t: now});
    }
    function fingers() {
      var pts = fingerPts();
      tipPts = []; tipU.fill(0);
      for (var i = 0; i < pts.length && tipPts.length < NTIPS * 2; i++) {
        var p = pts[i]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var X = p[0] * WW, Y = p[1] * WH, n = tipPts.length / 2; tipPts.push(X, Y); tipU[n * 4] = X; tipU[n * 4 + 1] = Y; tipU[n * 4 + 2] = 1;
        for (var k = 0; k < shapes.length; k++) {
          var s = shapes[k]; if (s.state === 2 || clock - s.pokeAt < 0.5 || Math.hypot(X - s.x, Y - s.y) > s.rmax + 8) continue;
          var c = Math.cos(-s.a), sn = Math.sin(-s.a), lx = c * (X - s.x) - sn * (Y - s.y) + s.gx, ly = sn * (X - s.x) + c * (Y - s.y) + s.gy;
          var tx = Math.floor((lx + s.S / 2) / s.tpx), ty = Math.floor((ly + s.S / 2) / s.tpx);
          if (tx < 0 || ty < 0 || tx >= SLOT || ty >= SLOT || s.field[ty * SLOT + tx] < 100) continue;
          if (s.state === 1) wake(s);
          s.pokeAt = clock; s.vy = Math.min(s.vy, -POKE); s.vx += (s.x - X) * 3; s.w += (Math.random() - 0.5) * 5; s.T = Math.max(s.T, 0.85); s.ghost = false;
          pokes++;
        }
        if (M9) { wallToCell(X, Y, q2); var ci = Math.round(q2[0]), cj = Math.round(q2[1]);
          if (ci >= 0 && cj >= 0 && ci < BW && cj < BH) { var sl = holeGrid[cj * BW + ci]; if (sl >= 0) holes.forEach(function (h) { if (h.slot === sl && !h.fired) h.fill = 1; }); } }
      }
    }
    var pokes = 0;

    // ---------------------------------------------------------------- physics (fixed 120 Hz steps: frames of dt = 0 change nothing)
    var acc = 0, simT = 0, steps = 0, kicks = 0;
    var CAP = 600, cX = new Float32Array(CAP), cY = new Float32Array(CAP), cNx = new Float32Array(CAP), cNy = new Float32Array(CAP), cP = new Float32Array(CAP), cK = new Float32Array(CAP), cB = new Uint8Array(CAP), cVx = new Float32Array(CAP), cVy = new Float32Array(CAP), cD = new Uint8Array(CAP), nb = [];
    function stepShape(s, h) {
      s.vy += GRAVITY * h; var dmp = Math.exp(-0.25 * h); s.vx *= dmp; s.vy *= dmp; s.w *= Math.exp(-0.9 * h);
      s.x += s.vx * h; s.y += s.vy * h; s.a += s.w * h; s.dynT += h;
      var c = Math.cos(s.a), sn = Math.sin(s.a), pts = s.cp, nc = 0, ground = false, bodyHit = false, inside = 0, deep = -1, dp = 0, gx0 = 1e9, gx1 = -1e9, q, B;
      var nearBody = !s.ghost && peopleNow && personSdf(s.x, s.y) * cellPx < s.rmax + 2 * cellPx;
      nb.length = 0;
      for (q = 0; q < shapes.length; q++) { B = shapes[q]; if (B === s || B.state === 2) continue;
        var ddx = B.x - s.x, ddy = B.y - s.y, rr = s.rmax + B.rmax + 4; if (ddx * ddx + ddy * ddy < rr * rr) { B._c = Math.cos(B.a); B._s = Math.sin(B.a); nb.push(B); } }
      cVx.fill(0); cVy.fill(0); cD.fill(0);
      for (var j = 0; j < pts.length && nc < CAP - 8; j += 2) {
        var rx = c * pts[j] - sn * pts[j + 1], ry = sn * pts[j] + c * pts[j + 1], X = s.x + rx, Y = s.y + ry;
        if (Y > floorY) { cX[nc] = rx; cY[nc] = ry; cNx[nc] = 0; cNy[nc] = -1; cP[nc] = Math.min(Y - floorY, 30); cK[nc] = 0; cB[nc] = 0; nc++; ground = true; if (X < gx0) gx0 = X; if (X > gx1) gx1 = X; }
        if (X < 0) { cX[nc] = rx; cY[nc] = ry; cNx[nc] = 1; cNy[nc] = 0; cP[nc] = Math.min(-X, 30); cK[nc] = 0; cB[nc] = 0; nc++; }
        else if (X > WW) { cX[nc] = rx; cY[nc] = ry; cNx[nc] = -1; cNy[nc] = 0; cP[nc] = Math.min(X - WW, 30); cK[nc] = 0; cB[nc] = 0; nc++; }
        for (q = 0; q < nb.length && nc < CAP - 8; q++) {             // another shape: its signed distance says how deep and which way out
          B = nb[q]; var cb = B._c, sb = B._s, dxw = X - B.x, dyw = Y - B.y;
          var tx = (cb * dxw + sb * dyw + B.gx + B.S / 2) / B.tpx - 0.5, ty = (-sb * dxw + cb * dyw + B.gy + B.S / 2) / B.tpx - 0.5;
          if (tx < 1 || ty < 1 || tx >= SLOT - 3 || ty >= SLOT - 3) continue;
          var d = sdAt(B.sd, tx, ty); if (d < -1 || d > (B.state === 1 ? 22 : 10)) continue;   // deep overlap: it passes through (and fuses), never levitates
          var gxl = sdAt(B.sd, tx + 1, ty) - sdAt(B.sd, tx - 1, ty), gyl = sdAt(B.sd, tx, ty + 1) - sdAt(B.sd, tx, ty - 1), gL = Math.hypot(gxl, gyl);
          if (gL < 1e-3) continue;
          var nX = -(cb * gxl - sb * gyl) / gL, nY = -(sb * gxl + cb * gyl) / gL;
          cX[nc] = rx; cY[nc] = ry; cNx[nc] = nX; cNy[nc] = nY; cP[nc] = B.state === 1 ? d + 1 : Math.min(d + 1, 2) * 0.5; cK[nc] = 0; cB[nc] = 0;
          if (B.state === 0) { cVx[nc] = B.vx - B.w * dyw; cVy[nc] = B.vy + B.w * dxw; cD[nc] = 1; }   // a moving neighbour: relative velocity
          nc++;
          if (nY < -0.5 && B.state === 1) { ground = true; if (X < gx0) gx0 = X; if (X > gx1) gx1 = X; }   // only the floor or a resting shape holds one up
        }
        if (nearBody) {
          var dB = personSdf(X, Y);
          if (dB < 0.15) {
            inside++;
            var e = 3, gx = personSdf(X + e, Y) - personSdf(X - e, Y), gy = personSdf(X, Y + e) - personSdf(X, Y - e), gl2 = Math.hypot(gx, gy);
            if (gl2 > 1e-4 && gx * gx < 1e4) {
              cX[nc] = rx; cY[nc] = ry; cNx[nc] = gx / gl2; cNy[nc] = gy / gl2; cP[nc] = Math.min((0.15 - dB) * cellPx, 25);
              cK[nc] = motionAt(X, Y) > 0.15 ? Math.min(KICK_MAX, cP[nc] * 30 * KICK) : 0; cB[nc] = 1; nc++; bodyHit = true;
            }
          }
        }
      }
      if (s.ghost) { if (!peopleNow) s.ghost = false; else { var any = false; for (q = 0; q < pts.length && !any; q += 4) { var X2 = s.x + c * pts[q] - sn * pts[q + 1], Y2 = s.y + sn * pts[q] + c * pts[q + 1]; if (personSdf(X2, Y2) < 0.5) any = true; } if (!any) s.ghost = false; } }
      else if (inside > 0.4 * pts.length / 2) s.ghost = true;                           // deep inside someone: it passes behind them
      if (s.ghost && bodyHit) { var m2 = 0; for (var b2 = 0; b2 < nc; b2++) if (!cB[b2]) { cX[m2] = cX[b2]; cY[m2] = cY[b2]; cNx[m2] = cNx[b2]; cNy[m2] = cNy[b2]; cP[m2] = cP[b2]; cK[m2] = cK[b2]; cB[m2] = 0; m2++; } nc = m2; bodyHit = false; }
      if (!nc) { s.calm = 0; return; }
      for (var k = 0; k < nc; k++) if (cP[k] > dp) { dp = cP[k]; deep = k; }
      if (deep >= 0) { s.x += cNx[deep] * dp * 0.8; s.y += cNy[deep] * dp * 0.8; }
      var im = 1 / s.m, iI = 1 / s.I;
      for (k = 0; k < nc; k++) {
        var cx = cX[k], cy = cY[k], nX2 = cNx[k], nY2 = cNy[k];
        var vrx = s.vx - s.w * cy - cVx[k], vry = s.vy + s.w * cx - cVy[k], vn = vrx * nX2 + vry * nY2, target = cK[k];
        if (vn >= target) continue;
        var rn = cx * nY2 - cy * nX2, den = im + rn * rn * iI;
        if (cD[k]) { var jd = -0.5 * vn / den; s.vx += jd * nX2 * im; s.vy += jd * nY2 * im; s.w += rn * jd * iI; continue; }   // two moving shapes: share a gentle push, no friction
        var jn = target > 0 ? (target - vn) / den : -(1 + (vn < -140 ? BOUNCE : 0)) * vn / den;
        if (target > 0) kicks++;
        s.vx += jn * nX2 * im; s.vy += jn * nY2 * im; s.w += rn * jn * iI;
        var tX = -nY2, tY = nX2; vrx = s.vx - s.w * cy - cVx[k]; vry = s.vy + s.w * cx - cVy[k];
        var vt = vrx * tX + vry * tY, rt = cx * tY - cy * tX, jt = -vt / (im + rt * rt * iI), lim = FRICTION * jn;
        jt = Math.max(-lim, Math.min(lim, jt));
        s.vx += jt * tX * im; s.vy += jt * tY * im; s.w += rt * jt * iI;
      }
      if (ground || nc > 2) s.w *= Math.exp(-ROLL_STOP * h);                       // wax is soft: it rolls a little, then sticks
      var sp = Math.hypot(s.vx, s.vy);
      if (sp > TOP_SPEED) { s.vx *= TOP_SPEED / sp; s.vy *= TOP_SPEED / sp; }
      if (Math.abs(s.w) > 7) s.w = 7 * Math.sign(s.w);
      var stable = ground && s.x > gx0 - 0.35 * s.rmax && s.x < gx1 + 0.35 * s.rmax;   // never asleep balanced on a point
      if (stable && !bodyHit && sp < 16 && Math.abs(s.w) < 0.2) s.calm += h; else s.calm = 0;
      if ((s.calm > 0.5 || (ground && !bodyHit && s.dynT > 6 && sp < 60) || (!bodyHit && s.dynT > 10 && sp < 30)) && s.state === 0) { s.vx = s.vy = s.w = 0; s.state = 1; s.restAt = clock; s.land = ++landCount; measurePile(); }
    }
    function stepAll() {
      for (var k = shapes.length - 1; k >= 0; k--) {
        var s = shapes[k];
        if (s.state === 0) { stepShape(s, STEP); if (s.y > WH + 400 || s.y < -900 || s.x < -400 || s.x > WW + 400) { removeShape(k); lost++; } }
      }
    }
    function physics(dt) {
      acc += dt; var n = 0;
      while (acc >= STEP && n < MAX_STEPS) { stepAll(); acc -= STEP; n++; simT += STEP; steps++; }
      if (n === MAX_STEPS) acc = 0;
    }
    function wakeTouched() {                   // a body moving into the pile wakes the shapes it sweeps into (then physics shoves them)
      if (!peopleNow) return;
      for (var k = 0; k < shapes.length; k++) {
        var s = shapes[k]; if (s.state !== 1 || personSdf(s.x, s.y) * cellPx > s.rmax + 2 * cellPx) continue;
        var ins = 0, mv = 0, n = s.cp.length / 2;
        for (var j = 0; j < s.cp.length; j += 2) { world(s, j, s.cp, wp); if (personSdf(wp[0], wp[1]) < 0.15) { ins++; if (motionAt(wp[0], wp[1]) > 0.15) mv++; } }
        if (mv > 0 && ins < 0.4 * n) { wake(s); s.kw = Math.max(s.kw, KICK_WARM); }
      }
    }

    // ---------------------------------------------------------------- the pile: cooling, warmth near people, melting, budget
    function makeRoom() { var r = shapes.filter(function (s) { return s.state === 1; }).sort(function (a, b) { return a.land - b.land; }); if (r.length) startMelt(r[0]); }
    function pile(dt) {
      var rest = [], live = 0, k;
      for (k = shapes.length - 1; k >= 0; k--) {
        var s = shapes[k];
        s.T *= Math.exp(-dt / COOL_S); s.kw *= Math.exp(-dt / COOL_S);
        if (s.state === 1 && peopleNow) { var d = personSdf(s.x, s.y) * cellPx - s.rmax * 0.6; s.nearT += ((d < 90 ? 1 - Math.max(0, d) / 90 : 0) - s.nearT) * (1 - Math.exp(-dt / 0.4)); }
        else s.nearT *= Math.exp(-dt / 0.6);
        if (s.state === 2) { s.melt += dt / MELT_S; if (s.melt >= 1) { removeShape(k); melted++; } continue; }
        live++; if (s.state === 1) rest.push(s);
      }
      rest.sort(function (a, b) { return a.land - b.land; });
      var top = pileTopY;
      if (live > MAX_SHAPES && rest.length) { for (k = 0; k < Math.min(rest.length, live - MAX_SHAPES); k++) startMelt(rest[k]); lastForceMelt = clock; }
      else if (floorY - top > PILE_MAX * WH && clock - lastForceMelt > 0.4 && rest.length) {
        var hi = null, hy = 1e9;
        rest.forEach(function (s) { var t = topOf(s); if (clock - s.restAt > 6 && t < hy) { hy = t; hi = s; } });
        if (hi) { startMelt(hi); lastForceMelt = clock; }
      }
      else if (rest.length > KEEP && clock - rest[0].restAt > LIFE_S && clock - lastAgeMelt > 1.5) { startMelt(rest[0]); lastAgeMelt = clock; }
    }

    // ---------------------------------------------------------------- drawing
    var fillU = new Float32Array(NHOLES), eyeP = new Float32Array(NEYES * 4), eyeL = new Float32Array(NEYES * 4), eyeCount = 0;
    function render() {
      var W = canvas.width, H = canvas.height, n = 0;
      for (var k = 0; k < shapes.length && n < NSLOTS; k++) {
        var s = shapes[k], o = n * 12;
        var heat = Math.max(0, Math.min(1, REST_GLOW * (1 + BREATHE * Math.sin(clock * 0.7 + s.phase)) + (1 - REST_GLOW) * s.T + s.kw + NEAR_GLOW * s.nearT));
        inst[o] = s.x; inst[o + 1] = s.y; inst[o + 2] = s.a; inst[o + 3] = s.S / 2;
        inst[o + 4] = s.gx; inst[o + 5] = s.gy; inst[o + 6] = s.slot; inst[o + 7] = s.state === 2 ? Math.max(0, 1 - s.melt) : 1;
        inst[o + 8] = heat; inst[o + 9] = s.state === 2 ? s.melt : 0; inst[o + 10] = s.low; inst[o + 11] = s.T;
        n++;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFb); gl.viewport(0, 0, fw, fh);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (n) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(splat.p); gl.bindVertexArray(vaoSplat);
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, n * 12)); gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(splat.U.uAtlas, 0);
        gl.uniform2f(splat.U.uWall, WW, WH);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.disable(gl.BLEND); gl.bindVertexArray(null);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex); gl.generateMipmap(gl.TEXTURE_2D);
      // hole and eye uniforms
      fillU.fill(0); eyeP.fill(0); eyeL.fill(0); eyeCount = 0;
      var withEye = [];
      holes.forEach(function (h) {
        if (h.slot >= 0) fillU[h.slot] = h.visibleNow ? h.fill : 0;
        if (h.eye > 0.01 && h.visibleNow) withEye.push(h);
      });
      withEye.sort(function (a, b) { return b.area - a.area; });
      for (k = 0; k < Math.min(NEYES, withEye.length); k++) {
        var h = withEye[k];
        if (!cellToWall(h.deep % BW, Math.floor(h.deep / BW), c2)) continue;
        var bt = (freshClock - h.blinkAt) / 0.22, blink = bt >= 0 && bt < 1 ? Math.sin(bt * Math.PI) : 0;
        var R = Math.max(8, Math.min(50, h.maxD * cellPx * 0.62));
        eyeP[k * 4] = c2[0]; eyeP[k * 4 + 1] = c2[1]; eyeP[k * 4 + 2] = R; eyeP[k * 4 + 3] = Math.min(1, h.eye * 1.4) * (1 - blink);
        eyeL[k * 4] = h.lookX; eyeL[k * 4 + 1] = h.lookY; eyeL[k * 4 + 2] = h.eye; eyeCount++;
      }
      gl.viewport(0, 0, W, H);
      gl.useProgram(compP.p); gl.bindVertexArray(vaoFull);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fieldTex); gl.uniform1i(compP.U.uField, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.uniform1i(compP.U.uMask, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, holeTex); gl.uniform1i(compP.U.uHole, 2);
      gl.uniformMatrix3fv(compP.U.uHinv, false, body.hinv());
      gl.uniform2f(compP.U.uWall, WW, WH); gl.uniform2f(compP.U.uFT, 1 / fw, 1 / fh);
      gl.uniform1f(compP.U.uTime, clock); gl.uniform1f(compP.U.uPx, W / 1280); gl.uniform1f(compP.U.uDark, DARK_INSIDE);
      gl.uniform1f(compP.U.uOutline, OUTLINE); gl.uniform1f(compP.U.uHalo, HALO); gl.uniform1f(compP.U.uMem, MEMBRANE); gl.uniform1f(compP.U.uEyeB, EYE);
      gl.uniform1f(compP.U.uIdleCap, IDLE_CAP); gl.uniform1f(compP.U.uWarmCap, WARM_CAP); gl.uniform1f(compP.U.uBloom, BLOOM); gl.uniform1f(compP.U.uPoolPx, POOL_PX);
      gl.uniform1f(compP.U.uPoolHeat, REST_GLOW * 0.9); gl.uniform1f(compP.U.uGlint, GLINT); gl.uniform1f(compP.U.uRest, REST_GLOW * (1 + BREATHE)); gl.uniform1f(compP.U.uWallK, wallK);
      gl.uniform1fv(compP.U.uFill, fillU); gl.uniform4fv(compP.U.uEyeP, eyeP); gl.uniform4fv(compP.U.uEyeL, eyeL); gl.uniform4fv(compP.U.uTip, tipU);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    }

    // ---------------------------------------------------------------- the frame
    var frames = 0, wallT = 0, cpuMs = 0;
    function frame(dt, now) {
      if (destroyed) return;
      var t0 = performance.now();
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); clock += dt; wallT += dt; frames++;
      var fresh = body.update(dt, now);
      if (body.fresh) { staleT = 0; freshClock += dt; } else staleT += dt;
      if (!M9) M9 = body.hinv();
      if (fresh) processDepth();
      else if (!body.fresh) {
        uploadMask();                                                       // the last body fades out at the stage's own pace
        if (staleT > STALE_HOLD_S && (holes.length || peopleNow)) { clearHoles(); peopleNow = false; near.fill(0); }
      }
      fingers();
      updateHoles(body.fresh ? dt : 0);
      physics(dt);
      pile(dt);
      render();
      cpuMs += performance.now() - t0;
    }
    function resize(w, h) {
      var oldW = WW; WW = WH * w / Math.max(1, h);
      makeField();
      if (WW < oldW) shapes.forEach(function (s) { if (s.x > WW - 10) { s.x = WW - 10; if (s.state === 1) { s.state = 0; s.calm = 0; s.dynT = 0; } } });
      measurePile();
    }
    function destroy() {
      if (destroyed) return; destroyed = true; wakeTips = []; tipPts = []; tipU.fill(0);
      if (window.ShadowholesSet === set) delete window.ShadowholesSet;
      if (window.ShadowholesWake === wakeContact) delete window.ShadowholesWake; kit.wantDepth(false);
      made.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); made = [];
      if (window.__shadowholesDebug) try { delete window.__shadowholesDebug; } catch (e) { window.__shadowholesDebug = undefined; }
    }

    seedPile();
    kit.wantDepth(true);
    if (window.WallTest) {                     // sandbox only (the live wall has no WallTest)
      var wallBox = function (h) { var b = [1e9, 1e9, -1e9, -1e9];
        [[h.box[0], h.box[1]], [h.box[2], h.box[1]], [h.box[0], h.box[3]], [h.box[2], h.box[3]]].forEach(function (c) { if (cellToWall(c[0], c[1], c2)) { b[0] = Math.min(b[0], c2[0] / WW); b[1] = Math.min(b[1], c2[1] / WH); b[2] = Math.max(b[2], c2[0] / WW); b[3] = Math.max(b[3], c2[1] / WH); } });
        return b.map(function (v) { return +v.toFixed(3); }); };
      var dbg = function () {
        var by = [0, 0, 0];
        shapes.forEach(function (s) { by[s.state]++; });
        var top = pileTopY;
        var cpu = frames ? cpuMs / frames : 0; cpuMs = 0; frames = 0;
        return {holes: holes.map(function (h) { return {id: h.id, area: h.area, fill: +h.fill.toFixed(2), fired: h.fired, eye: +h.eye.toFixed(2), visible: h.visibleNow,
                  steady: h.steady, dormant: h.dormant, owners: h.owners.slice(), at: [+(h.wx / WW).toFixed(3), +(h.wy / WH).toFixed(3)], box: wallBox(h)}; }),
                shapes: shapes.length, falling: by[0], resting: by[1], melting: by[2], ghosts: shapes.filter(function (s) { return s.ghost; }).length,
                spawned: spawned, spawnLog: spawnLog.slice(), melted: melted, lost: lost, pokes: pokes, kicks: kicks, holesSeen: holesSeen, lastSpawn: lastSpawn, eyes: eyeCount,
                pileTop: +((floorY - top) / WH).toFixed(3), people: body.people.length, fresh: body.fresh, regOk: body.regOk, cellPx: +cellPx.toFixed(2),
                simT: +simT.toFixed(2), wallT: +wallT.toFixed(2), steps: steps, depthFrames: depthFrames, holeMs: +foldHoleMs.toFixed(2), cpuMs: +cpu.toFixed(2),
                floatField: floatOk, glError: gl.getError(), size: [canvas.width, canvas.height]};
      };
      dbg.list = function () { return shapes.map(function (s) { return {id: s.id, state: s.state, x: +(s.x / WW).toFixed(3), y: +(s.y / WH).toFixed(3), a: +s.a.toFixed(2),
        v: Math.round(Math.hypot(s.vx, s.vy)), T: +s.T.toFixed(2), kw: +s.kw.toFixed(2), near: +s.nearT.toFixed(2), ghost: s.ghost, area: Math.round(s.area), low: +(lowest(s) / WH).toFixed(3)}; }); };
      dbg.inside = function (id) {             // a wall point (0..1) well inside shape id
        var s = shapes.filter(function (q) { return q.id === id; })[0]; if (!s) return null;
        var best = -1, bi = 0; for (var i = 0; i < s.sd.length; i++) if (s.sd[i] > best) { best = s.sd[i]; bi = i; }
        var lx = ((bi % SLOT) + 0.5) * s.tpx - s.S / 2 - s.gx, ly = (Math.floor(bi / SLOT) + 0.5) * s.tpx - s.S / 2 - s.gy, c = Math.cos(s.a), sn = Math.sin(s.a);
        return [(s.x + c * lx - sn * ly) / WW, (s.y + sn * lx + c * ly) / WH, +best.toFixed(1)];
      };
      dbg.clear = function () { for (var k = shapes.length - 1; k >= 0; k--) removeShape(k); measurePile(); return true; };
      dbg.seed = function () { seedPile(); return shapes.length; };
      dbg.knob = function (name, v) { if (name === 'OBJECT_S') OBJECT_S = v; else if (name === 'HOLE_MIN') HOLE_MIN = v; else if (name === 'LIFE_S') LIFE_S = v; else if (name === 'KEEP') KEEP = v; return true; };
      dbg.fling = function (n) { for (var k = 0; k < n; k++) { if (!slotFree.length) makeRoom(); var slot = slotFree.pop(); if (slot === undefined) break;
        var s = shapeFromRecipe(slot, k % 5, 70 + 60 * Math.random(), Math.random()); if (!s) { slotFree.push(slot); continue; }
        s.x = WW * (0.1 + 0.8 * Math.random()); s.y = 100 + 200 * Math.random(); s.a = Math.random() * 6; s.w = (Math.random() - 0.5) * 3; s.T = 1; shapes.push(s); spawned++; } return shapes.length; };
      window.__shadowholesDebug = dbg;
    }
    function set(opts) {
      if (!opts || destroyed) return {fill: FILL_S, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.fill)) FILL_S = Math.max(0.2, Math.min(3, opts.fill));
      return {fill: FILL_S, wall: wallK};
    }
    function wakeContact(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy) || sx < 0 || sx > 1 || sy < 0 || sy > 1) return;
      rememberWake(sx, sy);
    }
    window.ShadowholesSet = set;
    window.ShadowholesWake = wakeContact;
    if (window._shadowholesFx) set(window._shadowholesFx);

    return {frame: frame, resize: resize, destroy: destroy};
  }
})();
