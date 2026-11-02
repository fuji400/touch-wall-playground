/* Glow Tide \u2014 move and the dark water lights up (2026-10-05; fx-research concept #7, built by Claude (fx-batch)).
 *
 * Night water full of plankton. With nobody there, slow swells roll across the dark and the plankton on their crests glint
 * faintly; now and then a fish darts through and leaves a pale trail. Step in and the water you push lights up blue-green:
 * your outline sends a ring of light out across the water, and every movement (an arm sweep, a jump, a step) splashes light
 * in your wake that travels outward as ripples and fades. Stand still and the light dies away: the water around you goes
 * calm and dark. Every touch stays responsive, including water you just disturbed. This Lab variant disables fatigue.
 * A fingertip on the wall drops a ring of light; drag it and it draws a glowing wake.
 * Nothing is projected inside a person (DARK_INSIDE).
 *
 * How: a damped wave equation (a quarter of the picture's resolution, fixed 120 Hz steps) is the water. A body moves water
 * where its outline changes: each Kinect cell keeps the mask value it last stirred at, and once it has changed by STIR (or by
 * STIR_SETTLE next to such a cell, or held; small lone changes only faintly) it pushes the water (up where a body arrived, down where it left) and flashes the plankton there.
 * That makes every cell a body crosses push the same amount however the depth frames fall, and keeps Kinect noise at a still
 * outline quiet. Pushes come only from fresh depth frames, only near real people; the push is spread over half a depth frame (its flash is not).
 * Plankton glow where the water moves fast enough (a passing ripple) and where a body just swept, in swirling filaments; each
 * flash spends charge that comes back over RECHARGE_S, and a bright flash drops quickly to a softer afterglow that drifts on a
 * slow current and fades. A fingertip's ring is drawn at the ripple's speed. The picture is a fine plankton grain whose points
 * switch on as the glow rises, plus a soft glow and a bloom. Each new splash keeps its full energy; existing glow does not
 * reduce exposure. Local glow is capped and the final colour is tone-mapped. The empty water's crest lines are drawn, not simulated.
 * Body: plugins/body.js (WallBody), unmodified. Beyond the stage this piece computes, per fresh depth frame (CPU, 128 x 106):
 * the per-cell stir events above, gated to real people (the stage's people plus last frame's, grown 3 cells), and a held copy
 * of the mask that survives depth stalls up to STALE_HOLD_S.
 * WebGL 2 + EXT_color_buffer_float, no assets, no audio, one depth client (via the host).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  // (px = pixels on a 1280-wide picture)
  var WAVE_SPEED = 230;      // how fast ripples travel across the water (px per second)
  var WAVE_FADE_S = 0.6;     // how quickly ripples die out (seconds; lower = they stay closer to you)
  var PUSH = 2.2;            // how hard a moving body pushes the water (ripple size)
  var STIR = 0.85;           // a body cell (0..1) that changes this much since it last stirred the water stirs it at once...
  var STIR_SETTLE = 0.3;     // ...a smaller change (over this) stirs it at once next to such a cell, else once it holds still...
  var STIR_FAINT = 0.8;      // ...and a change smaller than this stirs only faintly (Kinect noise at a still outline is ~0.3-0.5)
  var EDDIES = 1.0;          // how much the light in your wake breaks into swirling filaments (0 = a smooth sheet)
  var SPLASH = 2.4;          // light right where a body just swept (instant, before any ripple)
  var RIPPLE_LIGHT = 0.5;    // how much afterglow a passing ripple leaves
  var RIPPLE_MIN = 1.2;      // ripples slower than this light nothing (water speed, arbitrary units)...
  var RIPPLE_FULL = 8.0;     // ...ripples this fast light fully
  var RING_FLASH = 1.0;      // brightness of the ripple fronts themselves as they travel
  var FLASH_S = 0.35;        // a bright flash drops back to an afterglow this fast (seconds)...
  var AFTERGLOW = 0.7;       // ...to about this level (share of a full flash)...
  var GLOW_FADE_S = 1.2;     // ...which then fades away over this long (seconds, time constant)
  var RECHARGE_S = 4.0;      // seconds for tired plankton to recover (time constant)
  var TIRE = 0.0;           // how much a flash tires the plankton (0 = never, 1 = a lot)
  var CURRENT = 14;          // the slow current that carries the glow (px per second)
  var SWIRL = 22;            // eddies in the current (px per second)
  var GRAIN = 1.4;           // brightness of the plankton points
  var SOFT = 0.9;            // the soft glow under the points
  var BRIGHTNESS = 1.3;
  var BLOOM = 0.5;           // the wide halo around bright water
  var SWELL = 1.0;           // the empty water: brightness of the plankton glinting along the swells' crests
  var SWELL_GAP = 0.17;      // ...distance between crests (share of the picture's width)
  var SWELL_SPEED = 0.02;    // ...how fast the swells roll (picture widths per second)
  var TWINKLE = 1.0;         // the empty water: stray sparkles
  var CALM = 0.7;            // how much the empty water's glints die down right around a person (1 = completely)
  var CALM_CELLS = 12;       // ...and how far around them (Kinect cells, ~10 px each)
  var FISH_EVERY_S = 9;      // a fish darts through about this often (seconds; 0 = no fish)
  var FISH_GLOW = 1.0;       // brightness of a fish's trail
  var MUS_G = 0.5;           // how much stronger bass pushes the water than the room code does
  var TAP_RING = 1.0;        // the ring of light a fingertip drops when it lands
  var TAP_EVERY_S = 0.33;    // big rings at most this often in one spot (the rest are small)
  var FINGER_WAKE = 1.0;     // the glowing wake of a dragged fingertip
  var STALE_HOLD_S = 0.7;    // the Kinect may stall this long without anything being forgotten
  var DARK_INSIDE = 1.0;     // no light inside a person (1 = none, 0 = off)

  registerWallPlugin({id: 'glowtidetouch', title: 'Glow Tide \u00b7 Touch Fix', author: 'Claude (fx-batch), fx-research concept #7', create: create});

  var STEP = 1 / 120, MAX_STEPS = 8, MAX_SPL = 12, MAX_RINGS = 6, RING_S = 1.1;

  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var NOISE = 'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' +
    'float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}\n';

  // the water: r = height, g = previous height, b = glow, a = tiredness (0 = fresh plankton)
  var SIM_FS = '#version 300 es\nprecision highp float;\n' + NOISE +
    'uniform sampler2D uS, uBody; uniform mat3 uHinv; uniform vec2 uSim;\n' +
    'uniform float uC2, uDampV, uDampH, uDt, uInject, uSplashNow, uImp, uPush, uSplash, uRipple, uR0, uR1, uFadeE, uFadeHot, uHot, uRecK, uTire, uSwirl, uTime, uCell, uEddy;\n' +
    'uniform vec2 uDrift; uniform int uNS; uniform vec4 uSA[' + MAX_SPL + ']; uniform vec4 uSB[' + MAX_SPL + '];\n' +
    'uniform int uNR; uniform vec4 uRG[' + MAX_RINGS + ']; uniform float uRW;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'vec2 curl(vec2 p){float e=.6; float a=vnoise(p+vec2(0,e)), b=vnoise(p-vec2(0,e)), c=vnoise(p+vec2(e,0)), d=vnoise(p-vec2(e,0)); return vec2(a-b,-(c-d))/(2.*e);}\n' +
    'void main(){ ivec2 ip=ivec2(gl_FragCoord.xy), mx=ivec2(uSim)-1;\n' +
    '  vec4 s=texelFetch(uS,ip,0);\n' +
    '  float hl=texelFetch(uS,clamp(ip-ivec2(1,0),ivec2(0),mx),0).r, hr=texelFetch(uS,clamp(ip+ivec2(1,0),ivec2(0),mx),0).r;\n' +
    '  float hd=texelFetch(uS,clamp(ip-ivec2(0,1),ivec2(0),mx),0).r, hu=texelFetch(uS,clamp(ip+ivec2(0,1),ivec2(0),mx),0).r;\n' +
    '  float h=s.r, hp=s.g, hn=(h+(h-hp)*uDampV+uC2*(hl+hr+hu+hd-4.*h))*uDampH;\n' +
    '  vec2 w=vec2(vUv.x,1.-vUv.y); vec3 hh=uHinv*vec3(w,1.); vec2 k=hh.xy/max(hh.z,1e-6);\n' +
    '  float inK=(hh.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;\n' +
    '  vec4 b=textureLod(uBody,clamp(k,0.,1.),0.)*inK;\n' +
    '  float q=clamp((b.g*255.-128.)/127.,-1.5,1.5)*inK;\n' +           // the body's push this depth frame: spread over a few steps...
    '  float dh=uPush*q*uInject;\n' +
    '  float qs=q*uSplashNow, stim=0., once=uSplash*(max(-qs,0.)+.85*max(qs,0.));\n' +   // ...its flash all at once   // water closing in behind you flashes; under you it is hidden anyway
    '  vec2 tp=gl_FragCoord.xy*uCell/4.;\n' +                        // eddies in your wake: the flash comes in swirling filaments
    '  float r1=1.-abs(2.*vnoise(tp/26.+vec2(uTime*.04,0.))-1.), r2=1.-abs(2.*vnoise(tp/11.-vec2(0.,uTime*.06))-1.);\n' +
    '  once*=uEddy*(pow(r1,3.)*.75+pow(r2,4.)*.55)+(1.-uEddy)*.8+.18;\n' +
    '  for(int i=0;i<' + MAX_SPL + ';i++){ if(i>=uNS) break;\n' +        // fingertips and fish: capsules in sim px
    '    vec2 a=uSA[i].xy, ab=uSA[i].zw-a, p=gl_FragCoord.xy; float t=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-6),0.,1.);\n' +
    '    float d=length(p-a-ab*t), r=uSB[i].x, g=exp(-d*d/(r*r));\n' +
    '    dh+=uSB[i].y*g*uImp; stim+=uSB[i].z*g; once+=uSB[i].w*g*uImp; }\n' +
    '  for(int i=0;i<' + MAX_RINGS + ';i++){ if(i>=uNR) break;\n' +       // a tap's ring of light, travelling at the water's speed
    '    float d=abs(length(gl_FragCoord.xy-uRG[i].xy)-uRG[i].z); stim+=uRG[i].w*exp(-d*d/(uRW*uRW)); }\n' +
    '  hn+=dh; float hpn=h+dh;\n' +                                     // a push moves the water without kicking it (no runaway)
    '  float vel=abs(hn-hpn)/uDt;\n' +
    '  vec2 cp=gl_FragCoord.xy*uCell/90.;\n' +                           // the slow current and its eddies (sim px per second)
    '  vec2 v=uDrift+uSwirl*curl(cp+vec2(uTime*.05,-uTime*.037));\n' +
    '  vec2 ed=textureLod(uS,(gl_FragCoord.xy-v*uDt)/uSim,0.).ba;\n' +
    '  float E=max(ed.x,0.), D=clamp(ed.y,0.,1.), C=1.-D;\n' +
    '  float fl=(uRipple*smoothstep(uR0,uR1,vel)+stim)*uDt*6.*C+once*C;\n' +   // a fresh splash keeps its full energy on glowing water
    '  E=E*uFadeE-max(E-uHot,0.)*uFadeHot+fl; D=clamp(D*uRecK+fl*uTire,0.,1.);\n' +   // a flash drops quickly to a softer afterglow
    '  o=vec4(hn,hpn,min(E,4.),D); }\n';

  // the glow, blurred at half the water's resolution (mode 0 reads the water's glow, mode 1 blurs as is)
  var BLUR_FS = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uSrc; uniform vec2 uStep; uniform int uMode; in vec2 vUv; out vec4 o;\n' +
    'void main(){ float acc=0., ws=0.;\n' +
    '  for(int i=-6;i<=6;i++){ float wt=exp(-float(i*i)/12.); vec4 s=textureLod(uSrc,vUv+uStep*float(i),0.); acc+=(uMode==0?s.b:s.r)*wt; ws+=wt; }\n' +
    '  o=vec4(acc/ws,0.,0.,1.); }\n';

  var DISP_FS = '#version 300 es\nprecision highp float;\n' + NOISE +
    'uniform sampler2D uS, uBloom, uBody; uniform mat3 uHinv; uniform vec2 uRes, uDriftPx; uniform float uTime, uPx, uDark;\n' +
    'uniform float uGrain, uSoft, uBloomK, uSwell, uTwinkle, uCalm, uStepInv, uR0, uR1, uRing, uSpacing, uRoll; uniform vec2 uSimRes;\n' +
    'uniform int uNR; uniform vec4 uRP[' + MAX_RINGS + ']; uniform float uRWp; in vec2 vUv; out vec4 o;\n' +
    'vec3 hash3(vec2 p){ vec3 q=vec3(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)),dot(p,vec2(419.2,371.9))); return fract(sin(q)*43758.5453); }\n' +
    // one layer of plankton: a point per cell, each with its own threshold; more light switches more of them on, brighter
    'float plank(vec2 px, float cell, float rad, float e, float spread, out float tw){\n' +
    '  vec2 g=px/cell, ci=floor(g), f=fract(g); vec3 r=hash3(ci); vec2 pp=.12+.76*r.xy; vec2 d=(f-pp)*cell;\n' +
    '  float pt=exp(-dot(d,d)/(rad*rad)); float th=.03+r.z*spread;\n' +
    '  tw=pt*step(.975,fract(r.z*91.7))*pow(max(0.,sin(uTime*(.5+r.x*.8)+r.y*40.)),30.);\n' +   // a few stray sparkles
    '  return pt*smoothstep(th,th+.3,e)*(.5+.5*smoothstep(th,th+1.5,e))*(.35+.65*fract(r.x*57.3+r.y*13.1)); }\n' +
    'void main(){\n' +
    '  vec2 px=vec2(vUv.x,1.-vUv.y)*uRes;\n' +                                     // window pixels, y down
    '  vec2 w=vec2(vUv.x,1.-vUv.y); vec3 hh=uHinv*vec3(w,1.); vec2 k=hh.xy/max(hh.z,1e-6);\n' +
    '  float inK=(hh.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.; vec4 b=texture(uBody,clamp(k,0.,1.))*inK;\n' +
    '  vec4 s=texture(uS,vUv); float C=1.-clamp(s.a,0.,1.);\n' +
    '  float F=smoothstep(uR0,uR1,abs(s.r-s.g)*uStepInv)*C*uRing;\n' +             // ring fronts: plankton flashing where the water moves now
    '  float FR=0.; for(int i=0;i<' + MAX_RINGS + ';i++){ if(i>=uNR) break; float d=abs(length(px-uRP[i].xy)-uRP[i].z-(vnoise(px/(38.*uPx)+float(i)*7.)-.5)*9.*uPx); FR+=uRP[i].w*exp(-d*d/(uRWp*uRWp)); }\n' +   // a tap's ring front
    '  float L=max(s.b,0.)+F+FR*C, bl=textureLod(uBloom,vUv,0.).r;\n' +
    // the empty water: long swells roll slowly across; plankton glint along their crests (thin lines of faint light that break
    // up and re-form). A ripple from someone bends the crests a little.
    '  vec2 p=px/uPx/1280.; float t=uTime;\n' +
    '  vec2 ts=1./uSimRes; float gx=texture(uS,vUv+vec2(ts.x,0.)).r-texture(uS,vUv-vec2(ts.x,0.)).r, gy=texture(uS,vUv+vec2(0.,ts.y)).r-texture(uS,vUv-vec2(0.,ts.y)).r;\n' +
    '  vec2 wp=p+vec2(gx,-gy)*.03;\n' +
    '  float warp=.07*vnoise(wp*2.3+vec2(t*.03,0.))+.035*vnoise(wp*5.7-vec2(0.,t*.05));\n' +
    '  vec2 dir=normalize(vec2(.13,1.)); float along=dot(wp,vec2(dir.y,-dir.x));\n' +
    '  float ph=(dot(wp,dir)+warp)/uSpacing-t*uRoll, ci=floor(ph+.5), fi=ph-ci;\n' +   // fi = 0 on a crest
    '  float dpx=abs(fi)/max(1e-5,length(vec2(dFdx(ph),dFdy(ph))));\n' +                // px to the nearest crest
    '  float brk=smoothstep(.42,.76,vnoise(vec2(along*5.,ci*3.7)+vec2(t*.07,ci)));\n' +   // where along a crest the plankton glow
    '  float calm=1.-uCalm*b.b;\n' +
    '  float core=exp(-pow(dpx/(3.4*uPx),2.)), halo=exp(-pow(dpx/(11.*uPx),2.)), wake=fi<0.?exp(-dpx/(38.*uPx)):0.;\n' +
    '  float idle=brk*calm*uSwell;\n' +
    '  vec2 gp=px+uDriftPx*t; float tw1, tw2;\n' +
    '  float dens=.5+.7*smoothstep(.2,.85,vnoise(gp/(150.*uPx))*.6+vnoise(gp/(48.*uPx)+3.1)*.4);\n' +   // plankton drift in patches
    '  L*=dens;\n' +
    '  float g1=plank(gp, 3.4*uPx, .9*uPx, L, 1.6, tw1);\n' +
    '  float g2=plank(gp*.93+vec2(37.,11.), 7.*uPx, 1.3*uPx, L*.9, 2.4, tw2);\n' +
    '  float i1=plank(gp*1.07+vec2(91.,53.), 3.8*uPx, .9*uPx, idle*(halo*.9+wake*.35), .9, tw1);\n' +   // plankton on the crests
    '  float twk=(tw1+tw2)*uTwinkle*calm;\n' +
    '  vec3 col=vec3(.004,.011,.026)+vec3(.0,.006,.012)*(.5+.5*sin(ph*6.2832))*calm;\n' +
    '  col+=(vec3(.02,.11,.142)*core+vec3(.007,.045,.067)*halo+vec3(.003,.024,.044)*wake)*idle+vec3(.024,.105,.125)*i1;\n' +
    '  col+=vec3(.035,.11,.16)*twk;\n' +
    '  col+=vec3(.1,.8,1.)*(1.-exp(-1.5*L*L/(L+.3)))*uSoft+vec3(.03,.3,.55)*bl*bl/(bl+.15)*uBloomK;\n' +
    '  col+=mix(vec3(.3,1.,1.),vec3(.9,1.,1.),smoothstep(1.,2.6,L))*(g1+g2*1.2)*uGrain;\n' +
    '  col*=1.-uDark*smoothstep(.55,.8,b.r)*inK;\n' +                              // nothing projected inside a person
    '  col=1.-exp(-col*1.25);\n' +
    '  o=vec4(col,1.); }\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Glow Tide needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Glow Tide needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Glow Tide needs EXT_color_buffer_float');
    var floatLin = !!gl.getExtension('OES_texture_float_linear');
    var SFMT = floatLin ? gl.RGBA32F : gl.RGBA16F, STYPE = floatLin ? gl.FLOAT : gl.HALF_FLOAT;
    var made = [], sized = [], destroyed = false;

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
    function texture(w, h, ifmt, fmt, type, filter, list, mip) {
      var t = gl.createTexture(); list.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      return t;
    }
    function target(t, list) {
      var f = gl.createFramebuffer(); list.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Glow Tide: framebuffer incomplete');
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    }

    var P = {sim: program(SIM_FS), blur: program(BLUR_FS), disp: program(DISP_FS)};
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    // ---- the body, folded into what this piece needs (Kinect cells, 128 x 106)
    var BW = WallBody.w, BH = WallBody.h, BN = BW * BH, body = WallBody.create(kit, {});
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var bodyTex = texture(BW, BH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, made), bodyBytes = new Uint8Array(BN * 4);
    var held = new Float32Array(BN), prevM = new Float32Array(BN), ref = new Float32Array(BN), q = new Float32Array(BN);
    var nearNow = new Uint8Array(BN), nearPrev = new Uint8Array(BN), grow = new Uint8Array(BN), grow2 = new Uint8Array(BN), full = new Uint8Array(BN), full2 = new Uint8Array(BN);
    var heldAny = false, splashNow = false, foldLog = [], realFrames = 0, lastFold = -1e9, injLeft = 0, depthDt = 1 / 30, folds = 0, injects = 0, lastQ = {cells: 0, sum: 0, max: 0}, haveRef = false;
    for (var bi = 0; bi < BN; bi++) bodyBytes[bi * 4 + 1] = 128;

    // ---- everything sized by the canvas
    var W = 0, H = 0, SW = 0, SH = 0, BWs = 0, BHs = 0, pxS = 1, cur = 0;
    var st = [null, null], stFb = [null, null], blA, blAFb, blB, blBFb;
    function alloc(w, h) {
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      W = w; H = h; pxS = w / 1280; SW = Math.max(64, Math.round(w / 4)); SH = Math.max(40, Math.round(h / 4));
      BWs = Math.max(16, Math.round(SW / 2)); BHs = Math.max(10, Math.round(SH / 2));
      for (var k = 0; k < 2; k++) { st[k] = texture(SW, SH, SFMT, gl.RGBA, STYPE, gl.LINEAR, sized); stFb[k] = target(st[k], sized); }
      blA = texture(BWs, BHs, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, sized); blAFb = target(blA, sized);
      blB = texture(BWs, BHs, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, sized, true); blBFb = target(blB, sized);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); cur = 0;
    }

    // ---- fingertips, fish and the splats they make (window 0..1, y down)
    var spl = [], SA = new Float32Array(MAX_SPL * 4), SB = new Float32Array(MAX_SPL * 4), rings = [], RG = new Float32Array(MAX_RINGS * 4), RP = new Float32Array(MAX_RINGS * 4);
    var fPrev = [], taps = [], landings = 0, bigRings = 0, wakes = 0, touchMode = false, tPrev = {}, lastTouch = -1e9;
    var fish = [], fishNext = 4 + Math.random() * 5, fishMade = 0, elapsed = 0, frames = 0, simAcc = 0, steps = 0;
    var musPrev = 0;
    function splat(x0, y0, x1, y1, rPx, ring, stim, flash) {
      if (spl.length >= MAX_SPL) return;
      spl.push([x0, y0, x1, y1, rPx, ring, stim, flash]);
    }
    function land(x, y, now) {               // a fingertip lands: a ring of light (big at most every TAP_EVERY_S in one spot)
      var big = true;
      for (var i = 0; i < taps.length; i++) if (now - taps[i][2] < TAP_EVERY_S * 1000 && Math.hypot(taps[i][0] - x, (taps[i][1] - y) * 0.625) < 0.06) big = false;
      if (big) { taps.push([x, y, now]); bigRings++; if (taps.length > 16) taps.shift(); rings.push({x: x, y: y, age: 0}); if (rings.length > MAX_RINGS) rings.shift(); }
      landings++;
      var k = big ? 1 : 0.3;
      splat(x, y, x, y, 30, 3.5 * TAP_RING * k, 0, 0.9 * TAP_RING * k);
    }
    function drag(x0, y0, x1, y1, dtS) {     // a fingertip moving on the wall: a glowing wake along its path
      var sp = Math.hypot(x1 - x0, (y1 - y0) * 0.625) / Math.max(dtS, 1e-3);
      if (sp < 0.03) return;
      // A moving contact renews its ring after real travel, not just on the first landing.
      var now = performance.now(), recent = null;
      for (var ri = taps.length - 1; ri >= 0; ri--) {
        if (Math.hypot(taps[ri][0] - x1, (taps[ri][1] - y1) * 0.625) < 0.1) { recent = taps[ri]; break; }
      }
      if (!recent || (now - recent[2] >= TAP_EVERY_S * 1000 && Math.hypot(recent[0] - x1, (recent[1] - y1) * 0.625) > 0.012)) land(x1, y1, now);
      var a = Math.min(1, sp / 0.6) * FINGER_WAKE;
      wakes++;
      splat(x0, y0, x1, y1, 13, 0.25 * a, 3.4 * a, 0.7 * a);
    }
    function mergeContactPts(pts, now) {
      // Bridge op:touch \u2192 WallKit.touches (rate-limited) plus wake() contacts, even when
      // op:fingers is empty/static-filtered. Dedup against existing finger pts.
      var tips = kit.touches || [], i, j, p, near;
      for (i = 0; i < tips.length; i++) {
        p = tips[i]; if (!p || Date.now() - p.t > 220) continue;   // kit.touches is stamped with Date.now(), not the rAF clock
        if (!(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) continue;
        near = false;
        for (j = 0; j < pts.length; j++) if (Math.hypot(pts[j][0] - p.x, (pts[j][1] - p.y) * 0.625) < 0.06) { near = true; break; }
        if (!near) pts.push([p.x, p.y]);
      }
      return pts;
    }
    function fingers(now, dtS) {
      var f = kit.fingers;
      if (f) touchMode = false;
      var pts = (f && Array.isArray(f.pts) && Date.now() - f.t <= 160) ? f.pts.slice() : [];
      pts = mergeContactPts(pts, now);
      var nowPts = [];
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var best = -1, bd = 0.08;
        for (var j = 0; j < fPrev.length; j++) { var d = Math.hypot(fPrev[j][0] - p[0], fPrev[j][1] - p[1]); if (d < bd) { bd = d; best = j; } }
        if (best < 0) land(p[0], p[1], now); else drag(fPrev[best][0], fPrev[best][1], p[0], p[1], dtS);
        nowPts.push([p[0], p[1]]);
      }
      fPrev = nowPts;
    }
    // Kinect contact \u2192 UV wake (main.js routes op:touch here when bg=glowtidetouch). Scales with PUSH knob.
    var wakePrev = null, wakeCount = 0;
    function wake(x, y, radius, strength) {
      if (destroyed || !Number.isFinite(x) || !Number.isFinite(y)) return;
      x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
      var now = performance.now(), pushK = Math.max(0.35, Math.min(2.5, PUSH / 1.5));
      var st = Number.isFinite(strength) ? Math.max(0.25, Math.min(2, strength * 80)) : 1;
      var prev = wakePrev;
      if (!prev || now - prev.t > 380 || Math.hypot(prev.x - x, (prev.y - y) * 0.625) > 0.1) {
        land(x, y, now);
        splat(x, y, x, y, 22 + 10 * pushK, 2.2 * TAP_RING * pushK * st, 0, 0.7 * TAP_RING * pushK * st);
      } else {
        drag(prev.x, prev.y, x, y, Math.max(0.03, (now - prev.t) / 1000));
        var a = Math.min(1.4, pushK * st) * FINGER_WAKE;
        splat(prev.x, prev.y, x, y, 12 + 6 * pushK, 0.3 * a, 3.2 * a, 0.65 * a);
        wakes++;
      }
      wakePrev = {x: x, y: y, t: now}; wakeCount++; lastTouch = now;
    }
    function maskAt(x, y) {                  // the held body mask at a window point (CPU, through the registration)
      var m = body.hinv(), hz = m[2] * x + m[5] * y + m[8]; if (!(hz > 1e-6)) return 0;
      var u = (m[0] * x + m[3] * y + m[6]) / hz, v = (m[1] * x + m[4] * y + m[7]) / hz;
      if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return 0;
      return held[Math.min(BH - 1, (v * BH) | 0) * BW + Math.min(BW - 1, (u * BW) | 0)];
    }
    function fishFrame(dt) {                 // now and then a fish darts through the empty water, leaving a faint trail
      if (FISH_EVERY_S > 0) {
        fishNext -= dt;
        if (fishNext <= 0 && fish.length < 2) {
          fishNext = FISH_EVERY_S * (0.5 + Math.random());
          for (var tries = 0; tries < 8; tries++) {
            var x = 0.12 + Math.random() * 0.76, y = 0.15 + Math.random() * 0.7, clear = true;
            for (var a = 0; a < 6.28; a += 1.05) if (maskAt(x + Math.cos(a) * 0.08, y + Math.sin(a) * 0.12) > 0.2 || maskAt(x, y) > 0.2) clear = false;
            if (!clear) continue;
            fish.push({x: x, y: y, hd: Math.random() * 6.283, sp: 0.2 + Math.random() * 0.12, age: 0, life: 1.4 + Math.random() * 1.1, ph: Math.random() * 6.28});
            fishMade++; break;
          }
        }
      }
      for (var i = fish.length - 1; i >= 0; i--) {
        var f = fish[i], x0 = f.x, y0 = f.y;
        f.age += dt;
        if (f.age > f.life || f.x < -0.05 || f.x > 1.05 || f.y < -0.05 || f.y > 1.05) { fish.splice(i, 1); continue; }
        var ax = f.x + Math.cos(f.hd) * 0.07, ay = f.y + Math.sin(f.hd) * 0.11;
        var turn = Math.sin(f.age * 7 + f.ph) * 1.6 + (maskAt(ax, ay) > 0.15 ? 5 : 0);   // a swimmer's wiggle; veer from people
        f.hd += turn * dt;
        var burst = 0.75 + 0.5 * Math.max(0, Math.sin(f.age * 3.1 + f.ph));
        f.x += Math.cos(f.hd) * f.sp * burst * dt; f.y += Math.sin(f.hd) * f.sp * burst * dt * 1.6;
        var env = Math.min(1, f.age / 0.25) * Math.min(1, (f.life - f.age) / 0.35);
        splat(x0, y0, f.x, f.y, 6, 0.02 * env * FISH_GLOW, 0.55 * env * FISH_GLOW, 0);
      }
    }

    function dilate(src, dst) {               // 8-neighbour grow by one cell
      for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) { var i = y * BW + x;
        dst[i] = src[i] | (x > 0 ? src[i - 1] : 0) | (x < BW - 1 ? src[i + 1] : 0) | (y > 0 ? src[i - BW] : 0) | (y < BH - 1 ? src[i + BW] : 0) |
          (x > 0 && y > 0 ? src[i - BW - 1] : 0) | (x < BW - 1 && y > 0 ? src[i - BW + 1] : 0) | (x > 0 && y < BH - 1 ? src[i + BW - 1] : 0) | (x < BW - 1 && y < BH - 1 ? src[i + BW + 1] : 0); }
    }
    // ---- per fresh depth frame: the signed push of real people, gated, plus the held mask and the calm around people
    function fold(now) {
      var m = body.mask, lab = body.label, i, x, y, gap = (now - lastFold) / 1000;
      lastFold = now; folds++; 
      for (i = 0; i < BN; i++) nearNow[i] = lab[i] >= 0 ? 1 : 0;
      for (i = 0; i < BN; i++) grow[i] = nearNow[i] | nearPrev[i];
      var pass, tmp;
      for (pass = 0; pass < 3; pass++) dilate(grow, grow2), tmp = grow, grow = grow2, grow2 = tmp;   // grow the people zone by 3 cells
      var use = haveRef && gap < STALE_HOLD_S, cells = 0, sum = 0, mxq = 0, carry = injLeft;
      if (gap > 0.005 && gap < 0.2) depthDt += (gap - depthDt) * 0.2;   // how often depth frames come (each push is spread over half that)
      for (i = 0; i < BN; i++) { var a0 = Math.abs(m[i] - ref[i]); full[i] = use && grow[i] && a0 > STIR ? 1 : 0; }
      for (pass = 0; pass < 2; pass++) dilate(full, full2), tmp = full, full = full2, full2 = tmp;   // cells near a full change
      for (i = 0; i < BN; i++) {
        var d = m[i] - ref[i], a = Math.abs(d), v = 0;   // change since this cell last stirred: every cell a body crosses gets the same push
        if (!use || !grow[i]) ref[i] = m[i];
        else if (a > STIR || (a > STIR_SETTLE && full[i])) { v = (d > 0 ? 1 : -1) * Math.min(1.2, a); ref[i] = m[i]; }   // part of a real move
        else if (a > STIR_SETTLE && Math.abs(m[i] - prevM[i]) < 0.04) {             // a small change that has settled: faint
          var tt = Math.min(1, Math.max(0, (a - STIR_SETTLE) / (STIR_FAINT - STIR_SETTLE)));
          v = (d > 0 ? 1 : -1) * Math.min(1.2, a) * tt * tt * (3 - 2 * tt); ref[i] = m[i];
        }
        q[i] = Math.max(-1.5, Math.min(1.5, q[i] * carry + v));   // what the last frame had not pushed yet, plus this frame
        if (v) { cells++; sum += Math.abs(v); if (Math.abs(v) > mxq) mxq = Math.abs(v); }
        prevM[i] = m[i]; held[i] = m[i];
      }
      heldAny = true;
      haveRef = true;
      var t = nearNow; nearNow = nearPrev; nearPrev = t;
      lastQ = {cells: cells, sum: +sum.toFixed(2), max: +mxq.toFixed(2)};
      if (cells) injects++;
      injLeft = cells || carry > 0 ? 1 : 0; if (cells) splashNow = true;
      foldLog.push([folds, realFrames, cells]); if (foldLog.length > 12) foldLog.shift();
      upload();
    }
    function upload() {
      var sdf = body.sdf, any = body.people.length > 0;
      for (var i = 0; i < BN; i++) {
        var o = i * 4, c = any ? Math.max(0, Math.min(1, 1 - Math.max(0, sdf[i]) / CALM_CELLS)) : 0;
        bodyBytes[o] = Math.round(Math.max(0, Math.min(1, held[i])) * 255);
        bodyBytes[o + 1] = Math.round(128 + Math.max(-1, Math.min(1, q[i])) * 127);
        bodyBytes[o + 2] = Math.round(c * 255);
      }
      gl.bindTexture(gl.TEXTURE_2D, bodyTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, bodyBytes);
    }
    function staleFade(dt, now) {            // the Kinect went quiet: hold everything for STALE_HOLD_S, then let the body go
      if ((now - lastFold) / 1000 < STALE_HOLD_S) return;
      if (!heldAny) return;
      var k = Math.exp(-dt / 0.15), any = false;
      for (var i = 0; i < BN; i++) { if (held[i] > 0.003) { held[i] *= k; any = true; } else held[i] = 0; }
      heldAny = any; upload();
    }

    function simStep(first) {
      var S = P.sim, u = S.u, n = Math.min(MAX_SPL, spl.length);
      for (var i = 0; i < n; i++) {
        var s = spl[i], sc = SW;   // window 0..1 (y down) -> sim px (y up)
        SA[i * 4] = s[0] * SW; SA[i * 4 + 1] = (1 - s[1]) * SH; SA[i * 4 + 2] = s[2] * SW; SA[i * 4 + 3] = (1 - s[3]) * SH;
        SB[i * 4] = s[4] * pxS / 4; SB[i * 4 + 1] = s[5]; SB[i * 4 + 2] = s[6]; SB[i * 4 + 3] = s[7];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[1 - cur]); gl.viewport(0, 0, SW, SH);
      gl.useProgram(S.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st[cur]); gl.uniform1i(u.uS, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 1);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv());
      gl.uniform2f(u.uSim, SW, SH);
      var c = WAVE_SPEED * pxS / 4 * STEP;
      gl.uniform1f(u.uC2, Math.min(0.48, c * c));
      gl.uniform1f(u.uDampV, Math.exp(-STEP / WAVE_FADE_S)); gl.uniform1f(u.uDampH, Math.exp(-STEP / 2.5));
      gl.uniform1f(u.uDt, STEP); var frac = Math.min(injLeft, STEP / Math.max(0.012, depthDt * 0.5)); gl.uniform1f(u.uInject, frac); gl.uniform1f(u.uSplashNow, splashNow ? 1 : 0); splashNow = false; gl.uniform1f(u.uImp, first ? 1 : 0);
      gl.uniform1f(u.uPush, PUSH); gl.uniform1f(u.uSplash, SPLASH); gl.uniform1f(u.uRipple, RIPPLE_LIGHT);
      gl.uniform1f(u.uR0, RIPPLE_MIN); gl.uniform1f(u.uR1, RIPPLE_FULL);
      gl.uniform1f(u.uFadeE, Math.exp(-STEP / GLOW_FADE_S)); gl.uniform1f(u.uHot, AFTERGLOW); gl.uniform1f(u.uEddy, EDDIES); gl.uniform1f(u.uFadeHot, 1 - Math.exp(-STEP / FLASH_S)); gl.uniform1f(u.uRecK, Math.exp(-STEP / RECHARGE_S)); gl.uniform1f(u.uTire, TIRE);
      gl.uniform1f(u.uSwirl, SWIRL * pxS / 4); gl.uniform1f(u.uTime, elapsed); gl.uniform1f(u.uCell, 4 / pxS);
      gl.uniform2f(u.uDrift, CURRENT * pxS / 4 * 0.8, CURRENT * pxS / 4 * 0.6);
      gl.uniform1i(u.uNS, n); gl.uniform4fv(u.uSA, SA); gl.uniform4fv(u.uSB, SB);
      for (var r = 0; r < rings.length; r++) {
        var g = rings[r], rad = g.age * WAVE_SPEED * pxS / 4, k = Math.pow(Math.max(0, 1 - g.age / RING_S), 1.5);
        RG[r * 4] = g.x * SW; RG[r * 4 + 1] = (1 - g.y) * SH; RG[r * 4 + 2] = rad; RG[r * 4 + 3] = 1.2 * TAP_RING * k;
      }
      gl.uniform1i(u.uNR, rings.length); gl.uniform4fv(u.uRG, RG); gl.uniform1f(u.uRW, 2.6 * pxS);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = 1 - cur; steps++;
      injLeft = Math.max(0, injLeft - frac); if (injLeft < 1e-6 && frac > 0) { injLeft = 0; q.fill(0); }
    }
    function blurPasses() {
      var B = P.blur, u = B.u;
      gl.useProgram(B.p); gl.viewport(0, 0, BWs, BHs); gl.uniform1i(u.uSrc, 0); gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blAFb); gl.bindTexture(gl.TEXTURE_2D, st[cur]);
      gl.uniform2f(u.uStep, 1.6 / BWs, 0); gl.uniform1i(u.uMode, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blBFb); gl.bindTexture(gl.TEXTURE_2D, blA);
      gl.uniform2f(u.uStep, 0, 1.6 / BHs); gl.uniform1i(u.uMode, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, blB); gl.generateMipmap(gl.TEXTURE_2D);
    }
    function display() {
      var D = P.disp, u = D.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(D.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st[cur]); gl.uniform1i(u.uS, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blB); gl.uniform1i(u.uBloom, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 2);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv());
      gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uDriftPx, -CURRENT * pxS * 0.8, CURRENT * pxS * 0.6);
      gl.uniform1f(u.uTime, elapsed); gl.uniform1f(u.uPx, pxS); gl.uniform1f(u.uDark, DARK_INSIDE);
      gl.uniform1f(u.uGrain, GRAIN * BRIGHTNESS); gl.uniform1f(u.uSoft, SOFT * BRIGHTNESS); gl.uniform1f(u.uBloomK, BLOOM * BRIGHTNESS);
      gl.uniform1f(u.uSwell, SWELL); gl.uniform1f(u.uTwinkle, TWINKLE); gl.uniform1f(u.uCalm, CALM);
      gl.uniform1f(u.uStepInv, 1 / STEP); gl.uniform1f(u.uR0, RIPPLE_MIN); gl.uniform1f(u.uR1, RIPPLE_FULL); gl.uniform1f(u.uRing, RING_FLASH);
      gl.uniform1f(u.uSpacing, SWELL_GAP); gl.uniform1f(u.uRoll, SWELL_SPEED / SWELL_GAP); gl.uniform2f(u.uSimRes, SW, SH);
      for (var r = 0; r < rings.length; r++) {
        var g = rings[r], k = Math.pow(Math.max(0, 1 - g.age / RING_S), 1.3);
        RP[r * 4] = g.x * W; RP[r * 4 + 1] = g.y * H; RP[r * 4 + 2] = g.age * WAVE_SPEED * pxS; RP[r * 4 + 3] = 2.4 * TAP_RING * k * Math.min(1, g.age / 0.04);
      }
      gl.uniform1i(u.uNR, rings.length); gl.uniform4fv(u.uRP, RP); gl.uniform1f(u.uRWp, 5 * pxS);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); frames++; if (dt > 0) realFrames++;
      if (canvas.width !== W || canvas.height !== H) alloc(canvas.width, canvas.height);
      if (dt > 0) {
        elapsed += dt;
        if (body.update(dt, now)) fold(now); else if (!body.fresh) staleFade(dt, now);
        // Keep asynchronous touch impulses until a simulation step consumes them.
        if (!touchMode) fingers(now, dt);
        fishFrame(dt);
        var room=kit.room?kit.room(dt):null;
        if(room && room.motion>.002)splat(.18+room.x*.1,.64,.82+room.x*.1,.64,65,.06*room.motion*dt*60,.2*room.motion*dt*60,.12*room.motion*dt*60);
        // music: bass drives the same wide splat as the room code; each beat adds one ring at a slowly drifting x
        var m = kit.music ? kit.music() : null, e = m && m.enabled && m.fresh ? m.amount : 0, bass = e ? e * m.bands[0] : 0, mid = e ? e * m.bands[1] : 0, high = e ? e * m.bands[2] : 0, beat = e ? e * m.pulse : 0;
        if (bass > .002) splat(.18 + .1 * Math.sin(elapsed * .3), .64, .82 + .1 * Math.sin(elapsed * .3), .64, 65, .06 * bass * dt * 60 * MUS_G, .2 * bass * dt * 60 * MUS_G, .12 * bass * dt * 60 * MUS_G);
        if (m && m.pulse > .95 && musPrev <= .95 && e) {
          var mx = .5 + .35 * Math.sin(elapsed * .21), my = .5 + .15 * Math.sin(elapsed * .13), mk = Math.min(1, beat * 1.3);
          rings.push({x: mx, y: my, age: 0}); if (rings.length > MAX_RINGS) rings.shift();
          splat(mx, my, mx, my, 30, 3.5 * TAP_RING * mk, 0, 0.9 * TAP_RING * mk);
        }
        musPrev = m ? m.pulse : 0;
        for (var ri = rings.length - 1; ri >= 0; ri--) { rings[ri].age += dt; if (rings[ri].age > RING_S) rings.splice(ri, 1); }
        simAcc = Math.min(simAcc + dt, STEP * MAX_STEPS);
        gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
        var first = true;
        while (simAcc >= STEP) { simStep(first); first = false; simAcc -= STEP; }
        if (!first) { spl = []; blurPasses(); }
      }
      gl.bindVertexArray(vao); gl.disable(gl.BLEND);
      display();
      gl.bindVertexArray(null);
    }
    function touch(t) {                      // WallKit path (also used if main.js falls through)
      if (!t) return;
      wake(t.x, t.y);
    }
    function set(opts) {
      // Namespaced floats (fx_schema.py / main.js FX_FLOAT_NS): mutate live module knobs
      // so the next sim/display pass picks them up. Store key: window._glowtidetouchFx.
      if (!opts || destroyed) {
        return {speed: WAVE_SPEED, fade: WAVE_FADE_S, push: PUSH, glow: GLOW_FADE_S, brightness: BRIGHTNESS};
      }
      [['speed', 80, 400, function (v) { WAVE_SPEED = v; }],
       ['fade', 0.15, 1.5, function (v) { WAVE_FADE_S = v; }],
       ['push', 0.3, 3.5, function (v) { PUSH = v; }],
       ['glow', 0.3, 3.0, function (v) { GLOW_FADE_S = v; }],
       ['brightness', 0.5, 3.0, function (v) { BRIGHTNESS = v; }]].forEach(function (item) {
        var v = opts[item[0]];
        if (Number.isFinite(v)) item[3](Math.max(item[1], Math.min(item[2], v)));
      });
      return {speed: WAVE_SPEED, fade: WAVE_FADE_S, push: PUSH, glow: GLOW_FADE_S, brightness: BRIGHTNESS};
    }
    function destroy() {
      if (destroyed) return; destroyed = true; kit.wantDepth(false);
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
      if (window.GlowtidetouchSet === set) delete window.GlowtidetouchSet;
      if (window.GlowtidetouchWake === wake) delete window.GlowtidetouchWake;
      if (window.__glowtidetouchDebug) try { delete window.__glowtidetouchDebug; } catch (e) { window.__glowtidetouchDebug = undefined; }
    }
    kit.wantDepth(true);
    window.GlowtidetouchSet = set;
    window.GlowtidetouchWake = wake;
    // Apply-on-create: GlowtidetouchSet is deleted on destroy and may not fire again.
    if (window._glowtidetouchFx) set(window._glowtidetouchFx);
    if (window.WallTest) window.__glowtidetouchDebug = function (box) {   // sandbox only (the live wall has no WallTest)
      var out = {queuedSplats: spl.length, fatigueEnabled: TIRE > 0, frames: frames, realFrames: realFrames, foldLog: foldLog.slice(), steps: steps, folds: folds, injects: injects, lastQ: lastQ, fresh: body.fresh, regOk: body.regOk,
        people: body.people.map(function (p) { return {id: p.id, area: p.area, moving: +p.moving.toFixed(3), still: +p.still.toFixed(2)}; }),
        fish: fish.length, fishMade: fishMade, landings: landings, bigRings: bigRings, wakes: wakes, wakeCount: wakeCount, sim: [SW, SH], glError: gl.getError()};
      if (box) {                               // glow / tiredness / water in a window box (0..1, y down): read back, sandbox only
        var x0 = Math.max(0, Math.floor(box[0] * SW)), x1 = Math.min(SW, Math.ceil(box[2] * SW)), y0 = Math.max(0, Math.floor((1 - box[3]) * SH)), y1 = Math.min(SH, Math.ceil((1 - box[1]) * SH));
        var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), px = new Float32Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[cur]); gl.readPixels(x0, y0, w, h, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        var se = 0, me = 0, sd = 0, sh = 0, ml = 0;
        for (var i = 0; i < w * h; i++) {
          var e = px[i * 4 + 2], vel = Math.abs(px[i * 4] - px[i * 4 + 1]) / STEP, tt = Math.min(1, Math.max(0, (vel - RIPPLE_MIN) / (RIPPLE_FULL - RIPPLE_MIN)));
          se += e; me = Math.max(me, e); sd += px[i * 4 + 3]; sh += Math.abs(px[i * 4]);
          ml = Math.max(ml, e + tt * tt * (3 - 2 * tt) * (1 - Math.min(1, Math.max(0, px[i * 4 + 3]))) * RING_FLASH);   // what the display lights: afterglow + ripple front
        }
        out.box = {glow: +(se / (w * h)).toFixed(4), glowMax: +me.toFixed(3), lightMax: +ml.toFixed(3), tired: +(sd / (w * h)).toFixed(3), water: +(sh / (w * h)).toFixed(4)};
      }
      return out;
    };
    return {frame: frame, touch: touch, destroy: destroy};
  }
})();
