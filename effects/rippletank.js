/* Ripple Tank — waves bounce off you; two fingers make interference (2026-10-05; fx-research concept #10, built by Claude (fx-batch)).
 *
 * The wall is a school ripple tank seen from above, lit from overhead, so every crest focuses the lamp into a thin line of
 * light on the dark floor (caustics, with a little colour split between wavelengths). With nobody there, slow trains of
 * gently curved swells roll in from the left edge, with calm water between trains. Step in and you are a wall in the tank:
 * the water's edge glints along your outline, no water moves inside you, the swell piles up against your windward side and
 * glances off you in warm light, and the waves bend round you and meet again behind you. Move and you push water: stepping
 * in sends a ring out from your whole outline, a walk leaves a wake, an arm sweep throws a fan of ripples. Hold a fingertip
 * on the wall and it becomes a vibrating pin (a dipper) that rings out circles; every pin beats in step, so two fingertips
 * (one each, or two hands) make the classic two-source interference pattern between them, which swings as the fingers move.
 * The waves people make shine brighter and warmer (gold) than the idle swell (silver-blue). Nothing is projected inside a
 * person (DARK_INSIDE), except a 10 px glint at a fingertip that lands on the finger itself.
 *
 * How: the water is two fields added together. The idle swell is written down exactly (a far point source beyond the left
 * edge, in trains), so it never fades and looks the same at any frame rate. The simulation holds only what people add: a
 * damped wave equation (isotropic 9-point Laplacian, fixed 120 Hz steps at 1/2.5 of the picture's resolution) whose waves
 * fade slowly near people and fingertips and fast far from everyone, and are absorbed by a beach at the window edges.
 * Inside a person the total height is forced to zero (the simulated field = minus the swell): that is what reflects the
 * swell and bends it round them. A pin forces the total height to one shared sine (so pins interfere); a moving outline
 * pushes the water just outside it like a piston. Light = 1 / det(I + D * Hessian) of the total height (how much a patch
 * of floor is focused), per colour with a slightly different D, minus the flat-water level; where people have added wave
 * energy (a GPU-only local average, no read-back) the light is brighter and warmer.
 * Body: plugins/body.js (WallBody), unmodified. Beyond the stage this piece computes, per fresh depth frame (CPU, 128 x 106):
 * a copy of the mask gated to real people (the stage's people plus last frame's, grown 3 cells) that survives depth stalls up
 * to STALE_HOLD_S, a near-people map (from the stage's outline distance) for the slow/fast fade, and per-cell push events
 * (a cell pushes once it has changed by STIR since it last pushed; see README).
 * WebGL 2 + EXT_color_buffer_float, no assets, no audio, one depth client (via the host).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  // (px = pixels on a 1280-wide picture)
  var WAVE_SPEED = 75;       // how fast every wave travels across the tank (px per second)
  var FADE_S = 3.5;          // how long the waves people make last near people (seconds, time constant); the swell never fades
  var FAR_FADE_S = 0.5;      // ...and once they are far from everyone (so one person never fills the whole wall)
  var NEAR_PX = 220;         // ...what counts as near a person or a fingertip (px); it shades off over the next 160 px
  var SWELL_GAP = 56;        // the idle swell: distance between crests (px); shorter than a person is wide, so it glances off you
  var SWELL = 0.85;          // ...how sharply its crests focus the light (0 = flat water, 0.95 = razor-thin bright lines)
  var SWELL_VARY = 0.45;     // ...how much its strength drifts along a crest (0 = perfectly even)
  var SWELL_TRAIN = 9;       // ...it comes in trains of about this many crests with calm water between (0 = one endless swell)
  var SWELL_FROM = 0;        // ...the side it rolls in from, in degrees (0 = from the left, 90 = from the top, 180 = from the right)
  var SWELL_ARC = 1600;      // ...from a far source this far beyond that edge (px; bigger = straighter crests)
  var FINGER_HZ = 1.7;       // a held fingertip's pin: rings per second (at 75 px/s, 1.7 gives 44 px between rings)
  var FINGER_AMP = 1.0;      // ...how strong its rings are
  var FINGER_FADE_S = 9;     // ...its rings fade this slowly around it (seconds), so two fingertips' rings reach each other
  var SWELL_YIELD = 0.75;    // ...the swell quietens this much around a held fingertip (0 = never), so its rings read clearly
  var FINGER_HOLE = 34;      // ...the pin pierces a person's outline this far around the fingertip (px), so a hand can ring
  var PUSH = 1.0;            // how hard a moving body pushes water (wake size)
  var STIR = 0.85;           // a body cell (0..1) that changed this much since it last pushed pushes at once...
  var STIR_SETTLE = 0.3;     // ...a smaller change (over this) pushes at once next to such a cell, else once it holds still...
  var STIR_FAINT = 0.8;      // ...and a change smaller than this pushes only faintly (Kinect noise at a still outline is ~0.3-0.5)
  var LIGHT = 0.07;          // brightness of the focused light (the idle swell's crests)
  var PEOPLE_LIGHT = 4.5;    // waves that people make shine this much brighter on top (so the strongest light is theirs)
  var WARM = 1.0;            // ...and warmer: gold where people stir the water, silver-blue where the swell is alone (0 = no tint)
  var GLOW = 0.05;           // ...and the stirred water glows softly around them
  var AMBIENT = 0.012;       // a little light everywhere, so troughs read darker than open water
  var SPLIT = 0.08;          // colour split between wavelengths (0 = white light only)
  var MENISCUS = 0.55;       // the glint of water along a person's outline
  var CALMING = 1.0;         // how much a very busy tank calms itself faster (0 = never)
  var EDGE_PX = 70;          // the absorbing beach at the window edges (px)
  var STALE_HOLD_S = 0.7;    // the Kinect may stall this long without anything being forgotten
  var DARK_INSIDE = 1.0;     // no light inside a person (1 = none, 0 = off)

  registerWallPlugin({id: 'rippletank', title: 'Ripple Tank', author: 'Claude (fx-batch), fx-research concept #10', create: create});

  var CELL = 2.5, MAX_PINS = 8, MAX_STEPS = 10, EPS = 0.05;
  var STEP_HZ = Math.max(120, Math.ceil(WAVE_SPEED / CELL / 0.55)), STEP = 1 / STEP_HZ;   // Courant number <= 0.55 (9-point limit 0.87)

  var VS = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  // the idle swell, written down exactly (xr in px, y up): amplitude drifts slowly along the crest
  var INC = 'uniform vec4 uInc; uniform vec2 uIncM, uSrc, uSim0; uniform int uNY; uniform vec4 uYield[' + MAX_PINS + '];\n' +   // uInc: k (rad/px), phase, amplitude, vary; uSrc: the far source (px, y up)
    'float incA(vec2 xr){ vec2 dd=normalize(uSim0*.5-uSrc); float al=dot(xr,vec2(-dd.y,dd.x)); float m=.5*sin(al*.01208+uIncM.x)+.5*sin(al*.02027-uIncM.y);\n' +
    '  float y=0.; for(int i=0;i<' + MAX_PINS + ';i++){ if(i>=uNY) break; y=max(y,uYield[i].z*(1.-smoothstep(110.,330.,length(xr-uYield[i].xy)))); }\n' +
    '  return uInc.z*(1.-uInc.w*(.5-.5*m))*(1.-y); }\n' +
    'uniform vec2 uEnv;\n' +                                         // the trains: envelope wavenumber (rad/px), its phase
    'float incE(float r){ return uEnv.x>0.?.5+.5*sin(uEnv.x*r-uEnv.y):1.; }\n' +
    'float incH(vec2 xr, float ph){ float r=length(xr-uSrc); return incA(xr)*incE(r)*sin(uInc.x*r-ph); }\n';

  // the simulated field (what people add): r = height now, g = height a step ago
  var SIM_FS = '#version 300 es\nprecision highp float;\n' + INC +
    'uniform sampler2D uS, uBody, uCalm; uniform mat3 uHinv; uniform vec2 uSim; uniform float uCell;\n' +
    'uniform float uC2, uDampV, uDampH, uDampF, uVisc, uInject, uPush, uEdge, uCalmK, uNear, uCap, uDampP, uDampPH;\n' +
    'uniform int uNP; uniform vec4 uPin[' + MAX_PINS + ']; uniform float uPinS, uPinHole, uPinPh;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'vec2 F(ivec2 p, ivec2 mx){ return texelFetch(uS, clamp(p, ivec2(0), mx), 0).rg; }\n' +
    'void main(){ ivec2 ip=ivec2(gl_FragCoord.xy), mx=ivec2(uSim)-1;\n' +
    '  vec2 c=F(ip,mx), n=F(ip+ivec2(0,1),mx), s=F(ip-ivec2(0,1),mx), e=F(ip+ivec2(1,0),mx), w=F(ip-ivec2(1,0),mx);\n' +
    '  vec2 ne=F(ip+ivec2(1,1),mx), nw=F(ip+ivec2(-1,1),mx), se=F(ip+ivec2(1,-1),mx), sw=F(ip+ivec2(-1,-1),mx);\n' +
    '  vec2 lap=(4.*(n+s+e+w)+(ne+nw+se+sw)-20.*c)/6.;\n' +            // isotropic: rings stay round
    '  vec4 cm=textureLod(uCalm,vec2(.5),20.); float calm=1.+uCalmK*max(cm.b-cm.a,0.);\n' +        // a very busy tank calms faster (GPU-only average)
    '  vec2 wv=vec2(vUv.x,1.-vUv.y); vec3 hh=uHinv*vec3(wv,1.); vec2 k=hh.xy/max(hh.z,1e-6);\n' +
    '  float inK=(hh.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;\n' +
    '  vec4 b=textureLod(uBody,clamp(k,0.,1.),0.)*inK; float q=inK>0.?(b.g*255.-128.)/127.:0.;\n' +
    '  vec2 xr=gl_FragCoord.xy*uCell; float hole=0., pw=0., pf=0., near=b.b, nearP=0.;\n' +
    '  for(int i=0;i<' + MAX_PINS + ';i++){ if(i>=uNP) break; vec2 d=xr-uPin[i].xy; float r=length(d);\n' +
    '    hole=max(hole,1.-smoothstep(uPinHole*.6,uPinHole,r)); nearP=max(nearP,1.-smoothstep(uNear,uNear+160.,r));\n' +
    '    float g=exp(-r*r/(uPinS*uPinS)); if(g>pw){ pw=g; pf=uPin[i].z*sin(uPinPh)+uPin[i].w; } }\n' +
    '  float dv=mix(mix(uDampF,uDampV,near),uDampP,nearP), dhh=mix(mix(uDampF,uDampH,near),uDampPH,nearP);\n' +   // waves fade fast once far from everyone
    '  float h=c.r, hp=c.g, hn=h+(h-hp)*pow(dv,calm)+uC2*lap.r+uVisc*(lap.r-lap.g);\n' +
    '  hn*=pow(dhh,calm);\n' +
    '  vec2 px=gl_FragCoord.xy; float de=min(min(px.x,uSim.x-px.x),min(px.y,uSim.y-px.y));\n' +
    '  float beach=1.-smoothstep(0.,uEdge,de); hn*=1.-.06*beach*beach;\n' +   // waves leaving the window are absorbed
    '  float ob=smoothstep(.42,.58,b.r)*(1.-hole);\n' +                 // a person is a wall in the tank (a crisp edge, so it reflects)
    // a moving body pushes the water just outside its outline like a piston: read the push from a cell and a half inside
    '  vec2 kc=vec2(1./128.,1./106.); vec2 gm=vec2(textureLod(uBody,k+vec2(kc.x,0.),0.).r-textureLod(uBody,k-vec2(kc.x,0.),0.).r,\n' +
    '    textureLod(uBody,k+vec2(0.,kc.y),0.).r-textureLod(uBody,k-vec2(0.,kc.y),0.).r); float gml=length(gm);\n' +
    '  float qi=(textureLod(uBody,clamp(k+gm/max(gml,1e-4)*kc*1.5,0.,1.),0.).g*255.-128.)/127.;\n' +
    '  float qp=inK>0.?mix(q,qi,smoothstep(.03,.25,gml)):0.;\n' +
    '  float dh=uPush*qp*uInject*(1.-ob);\n' +
    '  float inc=incH(xr,uInc.y);\n' +
    '  hn=mix(hn,-inc,ob);\n' +                                          // inside a person the total height is zero
    '  hn=mix(hn,pf-inc,pw);\n' +                                       // a pin is a dipper: it moves the water with one shared sine
    '  float cap=uCap; hn=cap*tanh(clamp(hn/cap,-6.,6.));\n' +                        // a soft ceiling for the wildest splashes
    '  o=vec4(hn+dh,h+dh,max(ob,pw),1.); }\n';

  // slopes and curvatures of the TOTAL height (swell + simulated), in px units, for the light; MRT
  var DER_FS = '#version 300 es\nprecision highp float;\n' + INC +
    'uniform sampler2D uS; uniform vec2 uSim; uniform float uCell, uPh, uAI;\n' +
    'layout(location=0) out vec4 o1; layout(location=1) out vec4 o2;\n' +
    'float F(ivec2 p, ivec2 mx){ return texelFetch(uS, clamp(p, ivec2(0), mx), 0).r; }\n' +
    'void main(){ ivec2 ip=ivec2(gl_FragCoord.xy), mx=ivec2(uSim)-1;\n' +
    '  float ob=texelFetch(uS,ip,0).b, c=F(ip,mx), n=F(ip+ivec2(0,1),mx), s=F(ip-ivec2(0,1),mx), e=F(ip+ivec2(1,0),mx), w=F(ip-ivec2(1,0),mx);\n' +
    '  float ne=F(ip+ivec2(1,1),mx), nw=F(ip+ivec2(-1,1),mx), se=F(ip+ivec2(1,-1),mx), sw=F(ip+ivec2(-1,-1),mx);\n' +
    '  float e2=F(ip+ivec2(2,0),mx), w2=F(ip-ivec2(2,0),mx), n2=F(ip+ivec2(0,2),mx), s2=F(ip-ivec2(0,2),mx);\n' +
    '  float i2=1./(uCell*uCell);\n' +                                 // wide stencils: blind to grid-scale checkerboard (no sparkle)
    '  float gx=(e-w)/(2.*uCell), gy=(n-s)/(2.*uCell), hxx=(e2-2.*c+w2)*.25*i2, hyy=(n2-2.*c+s2)*.25*i2, hxy=(ne-nw-se+sw)*.25*i2;\n' +
    '  vec2 xr=gl_FragCoord.xy*uCell, dv=xr-uSrc; float r=length(dv); vec2 d=dv/r;\n' +   // the swell is radial: f(r), exactly
    '  float A=incA(xr), th=uInc.x*r-uPh, si=sin(th), co=cos(th), k=uInc.x, ke=uEnv.x, ps=ke*r-uEnv.y;\n' +
    '  float E=uEnv.x>0.?.5+.5*sin(ps):1., E1=uEnv.x>0.?.5*cos(ps)*ke:0., E2=uEnv.x>0.?-.5*sin(ps)*ke*ke:0.;\n' +
    '  float f=A*E*si, f1=A*(E1*si+E*k*co), f2=A*(E2*si+2.*E1*k*co-E*k*k*si), bb=f1/r;\n' +
    '  gx+=f1*d.x; gy+=f1*d.y;\n' +
    '  hxx+=f2*d.x*d.x+bb*(1.-d.x*d.x); hyy+=f2*d.y*d.y+bb*(1.-d.y*d.y); hxy+=(f2-bb)*d.x*d.y;\n' +
    '  float tt=(c+f)*uAI, ti=f*uAI; o1=vec4(gx,gy,hxx,hyy); o2=vec4(hxy,c+f,tt*tt*(1.-ob),ti*ti*(1.-ob)); }\n';

  var DISP_FS = '#version 300 es\nprecision highp float;\n' +
    INC + 'uniform sampler2D uD1, uD2, uBody; uniform mat3 uHinv; uniform vec2 uSimR; uniform float uPx, uLight, uSplit, uMen, uDark, uAmp, uBoost, uAmb, uView, uWarm, uGlow, uWallK;\n' +
    'uniform int uNP; uniform vec4 uPin[' + MAX_PINS + ']; in vec2 vUv; out vec4 o;\n' +
    'float caus(vec2 uv, vec2 g, float D){ vec2 su=uv-D*g/uSimR; vec4 a=texture(uD1,su); float hxy=texture(uD2,su).r;\n' +
    '  float det=(1.+D*a.z)*(1.+D*a.w)-D*D*hxy*hxy; return inversesqrt(det*det+' + (EPS * EPS).toFixed(4) + '); }\n' +
    'void main(){\n' +
    '  vec2 uv=vUv; vec4 d0=texture(uD1,uv); vec2 g=d0.xy; float gl=length(g); g*=min(1.,24./max(gl,1e-4));\n' +   // light shifts at most 24 px
    '  float sp=uSplit/(1.+2.*max(0.,abs(d0.z)+abs(d0.w)-1.2)+.08*gl);\n' +             // less colour split where the water is wild (no speckle)
    '  vec3 I=vec3(caus(uv,g,1.-sp),caus(uv,g,1.),caus(uv,g,1.+sp));\n' +          // red focuses a little later than blue
    '  vec3 L=max(I-1.,0.); L=L/(1.+L*.06);\n' +                                  // only light focused above flat water; folds roll off
    '  vec4 en=textureLod(uD2,uv,3.5); float act=sqrt(max(en.b-en.a,0.));\n' +       // wave energy here beyond the swell's own
    '  float wm=smoothstep(.06,.45,act);\n' +                                       // the waves people make: brighter and warmer
    '  vec3 tint=mix(vec3(.72,.9,1.),vec3(1.,.86,.62),wm*uWarm);\n' +
    '  float wk=mix(uWallK,1.,wm);\n' +                                            // \'Empty wall\': the idle swell scales; water people stir (wm) stays as it was
    '  vec3 col=vec3(.006,.014,.028)*uWallK+tint*(L*uLight*wk*(1.+uBoost*wm)+uAmb*uWallK*min(I,3.))+vec3(1.,.8,.55)*uGlow*act*act/(1.+act);\n' +
    '  vec2 wv=vec2(uv.x,1.-uv.y); vec3 hh=uHinv*vec3(wv,1.); vec2 k=hh.xy/max(hh.z,1e-6);\n' +
    '  float inK=(hh.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.; float m=texture(uBody,clamp(k,0.,1.)).r*inK;\n' +
    // the water's edge along a person: a thin glint just outside the outline that brightens as a crest laps against it
    '  vec2 gm=vec2(dFdx(m),dFdy(m)); float fw=max(fwidth(m),1e-4);\n' +
    '  float lap=texture(uD2,uv-gm/max(length(gm),1e-6)*12./uSimR).g/max(uAmp,1e-3);\n' +   // the water level just outside
    '  float edge=exp(-pow((m-.3)/(fw*1.3*uPx),2.)), halo=exp(-pow((m-.3)/(fw*5.*uPx),2.));\n' +
    '  col*=1.-smoothstep(.36,.5,m);\n' +                                         // the outline itself is the water's edge, not a caustic
    '  col+=vec3(.86,.97,1.)*(edge+.22*halo)*uMen*(.85+.3*clamp(lap,-1.,1.));\n' +
    '  vec2 px=vec2(uv.x,uv.y)*uSimR; float pin=0., pinZ=0.;\n' +                 // the pins themselves: a small bright glint
    '  for(int i=0;i<' + MAX_PINS + ';i++){ if(i>=uNP) break; float r=length(px-uPin[i].xy);\n' +
    '    pin+=exp(-r*r/9.)*min(1.,uPin[i].z); pinZ=max(pinZ,1.-smoothstep(10.,16.,r)); }\n' +
    '  col+=vec3(.85,.97,1.)*pin*1.4;\n' +
    '  col*=1.-uDark*smoothstep(.55,.8,m)*(1.-pinZ);\n' +                        // nothing projected inside a person
    '  col=1.-exp(-col);\n' +
    '  if(uView==1.){ float hv=texture(uD2,uv).g/uAmp; col=vec3(.5+.25*hv)*(1.-smoothstep(.45,.55,m)); }\n' +
    '  if(uView==2.){ col=vec3(act,en.a,0.); }\n' +   // sandbox only: the height itself
    '  o=vec4(col,1.); }\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Ripple Tank needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Ripple Tank needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Ripple Tank needs EXT_color_buffer_float');
    var wallK = 2.0;           // 'Empty wall' knob (1 = the 2026-10-05 picture): scales the idle swell's focused light, ambient and floor; waves people make (PEOPLE_LIGHT, GLOW), the meniscus and pins are untouched
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
    function target(texs, list) {
      var f = gl.createFramebuffer(); list.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      for (var i = 0; i < texs.length; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texs[i], 0);
      gl.drawBuffers(texs.map(function (_, i) { return gl.COLOR_ATTACHMENT0 + i; }));
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Ripple Tank: framebuffer incomplete');
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return f;
    }

    var P = {sim: program(SIM_FS), der: program(DER_FS), disp: program(DISP_FS)};
    var vao = gl.createVertexArray(); made.push(['VertexArray', vao]);

    // ---- the body, folded into what this piece needs (Kinect cells, 128 x 106): R = held mask of real people, G = push
    var BW = WallBody.w, BH = WallBody.h, BN = BW * BH, body = WallBody.create(kit, {});
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var bodyTex = texture(BW, BH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR, made), bodyBytes = new Uint8Array(BN * 4);
    var near = new Float32Array(BN), NEAR_CELLS = NEAR_PX / 10.5, held = new Float32Array(BN), prevM = new Float32Array(BN), ref = new Float32Array(BN), q = new Float32Array(BN);
    var nearNow = new Uint8Array(BN), nearPrev = new Uint8Array(BN), grow = new Uint8Array(BN), grow2 = new Uint8Array(BN), full = new Uint8Array(BN), full2 = new Uint8Array(BN);
    var heldAny = false, haveRef = false, lastFold = -1e9, injLeft = 0, depthDt = 1 / 30, folds = 0, pushes = 0, foldLog = [], pushSum = 0, realFrames = 0, lastQ = {cells: 0, sum: 0};
    for (var bi = 0; bi < BN; bi++) bodyBytes[bi * 4 + 1] = 128;

    // ---- everything sized by the canvas
    var W = 0, H = 0, SW = 0, SH = 0, pxS = 1, cur = 0, st = [null, null], stFb = [null, null], d1, d2, dFb;
    function alloc(w, h) {
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      W = w; H = h; pxS = w / 1280;
      SW = Math.max(64, Math.round(w / pxS / CELL)); SH = Math.max(40, Math.round(h / pxS / CELL));
      for (var k = 0; k < 2; k++) { st[k] = texture(SW, SH, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, sized); stFb[k] = target([st[k]], sized); }
      d1 = texture(SW, SH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, sized);
      d2 = texture(SW, SH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, sized, true);
      dFb = target([d1, d2], sized);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); cur = 0;
    }

    // ---- the swell and the pins share one clock (sim seconds); phases are wrapped on the CPU so they stay exact for hours
    var tSim = 0, acc = 0, steps = 0, elapsed = 0, frames = 0;
    var TAU = Math.PI * 2, kEnv = SWELL_TRAIN > 0 ? TAU / (SWELL_GAP * SWELL_TRAIN) : 0, kInc = TAU / SWELL_GAP, wInc = TAU * WAVE_SPEED / SWELL_GAP, aInc = SWELL / (kInc * kInc);
    function wrap(x) { return x - TAU * Math.floor(x / TAU); }
    var kPin = TAU * FINGER_HZ / WAVE_SPEED, aPin = 4.5 * FINGER_AMP / (kPin * kPin);   // the dipper's stroke, in the same focus units

    // ---- fingertips: each one on the wall is a pin (window 0..1, y down); array order is not identity, so match by distance
    var view = 0, swellOn = 1, pins = [], landings = 0, touchMode = false, tPins = {}, wakeCount = 0;
    // Contact wakes from bridge op:touch (main.js → RippletankWake), kept alongside kit.fingers.
    var contactWake = [];
    function fingers(now) {
      var f = kit.fingers, pts = [], i, j, p, near;
      if (f && Array.isArray(f.pts) && Date.now() - f.t <= 160) pts = f.pts.slice();
      else if (touchMode) { for (var id in tPins) if (now - tPins[id][2] < 400) pts.push(tPins[id]); else delete tPins[id]; }
      // Merge rate-limited WallKit tips + wake() contacts so static-filtered fingers still ring.
      var tips = kit.touches || [];
      for (i = 0; i < tips.length; i++) {
        p = tips[i]; if (!p || Date.now() - p.t > 400) continue;   // kit.touches is stamped with Date.now(), not the rAF clock
        if (!(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) continue;
        near = false;
        for (j = 0; j < pts.length; j++) if (Math.hypot(pts[j][0] - p.x, (pts[j][1] - p.y) * 0.625) < 0.06) { near = true; break; }
        if (!near) pts.push([p.x, p.y]);
      }
      for (i = contactWake.length - 1; i >= 0; i--) {
        p = contactWake[i];
        if (now - p.t > 450) { contactWake.splice(i, 1); continue; }
        near = false;
        for (j = 0; j < pts.length; j++) if (Math.hypot(pts[j][0] - p.x, (pts[j][1] - p.y) * 0.625) < 0.06) { near = true; break; }
        if (!near) pts.push([p.x, p.y]);
      }
      var next = [];
      for (i = 0; i < pins.length; i++) pins[i].used = false;
      for (i = 0; i < pts.length && next.length < MAX_PINS; i++) {
        p = pts[i]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var best = -1, bd = 0.08;
        for (j = 0; j < pins.length; j++) { var d = Math.hypot(pins[j].x - p[0], (pins[j].y - p[1]) * 0.625); if (d < bd && !pins[j].used) { bd = d; best = j; } }
        if (best >= 0) { pins[best].used = true; next.push({x: p[0], y: p[1], t0: pins[best].t0}); }
        else { next.push({x: p[0], y: p[1], t0: now}); landings++; }
      }
      pins = next;
    }
    // Kinect contact → UV (main.js routes op:touch here when bg=rippletank). Becomes a vibrating pin; PUSH scales landing slap.
    function wake(x, y, radius, strength) {
      if (destroyed || !Number.isFinite(x) || !Number.isFinite(y)) return;
      x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
      var now = performance.now(), best = -1, bd = 0.1, i;
      for (i = 0; i < contactWake.length; i++) {
        var d = Math.hypot(contactWake[i].x - x, (contactWake[i].y - y) * 0.625);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) { contactWake[best].x = x; contactWake[best].y = y; contactWake[best].t = now; }
      else contactWake.push({x: x, y: y, t: now, t0: now});
      wakeCount++;
    }
    var PIN = new Float32Array(MAX_PINS * 4), YLD = new Float32Array(MAX_PINS * 4), spots = [];
    function yieldFrame(dt) {                // where the swell quietens: ramps in over ~0.6 s while a pin is held, out over ~1 s after
      var i, j;
      for (j = 0; j < spots.length; j++) spots[j].held = false;
      for (i = 0; i < pins.length; i++) {
        var best = -1, bd = 0.1;
        for (j = 0; j < spots.length; j++) { var d = Math.hypot(spots[j].x - pins[i].x, (spots[j].y - pins[i].y) * 0.625); if (d < bd && !spots[j].held) { bd = d; best = j; } }
        if (best < 0 && spots.length < MAX_PINS) { spots.push({x: pins[i].x, y: pins[i].y, w: 0, held: true}); continue; }
        if (best >= 0) { spots[best].x = pins[i].x; spots[best].y = pins[i].y; spots[best].held = true; }
      }
      for (j = spots.length - 1; j >= 0; j--) {
        var sp = spots[j]; sp.w = sp.held ? Math.min(1, sp.w + dt / 0.6) : sp.w - dt / 1.0;
        if (sp.w <= 0) spots.splice(j, 1);
      }
    }
    function packPins(now, simW, simH) {     // px (y up), amplitude, landing dip (a drop: the first slap shows at once)
      for (var i = 0; i < pins.length; i++) {
        var p = pins[i], age = (now - p.t0) / 1000;
        PIN[i * 4] = p.x * simW; PIN[i * 4 + 1] = (1 - p.y) * simH;
        PIN[i * 4 + 2] = aPin * Math.min(1, 0.35 + age / 0.25); PIN[i * 4 + 3] = -1.5 * aPin * Math.exp(-age / 0.08);
      }
      return pins.length;
    }

    function dilate(src, dst) {               // 8-neighbour grow by one cell
      for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) { var i = y * BW + x;
        dst[i] = src[i] | (x > 0 ? src[i - 1] : 0) | (x < BW - 1 ? src[i + 1] : 0) | (y > 0 ? src[i - BW] : 0) | (y < BH - 1 ? src[i + BW] : 0) |
          (x > 0 && y > 0 ? src[i - BW - 1] : 0) | (x < BW - 1 && y > 0 ? src[i - BW + 1] : 0) | (x > 0 && y < BH - 1 ? src[i + BW - 1] : 0) | (x < BW - 1 && y < BH - 1 ? src[i + BW + 1] : 0); }
    }
    // ---- per fresh depth frame: the held mask of real people and the signed push where their outline moved
    function fold(now) {
      var m = body.mask, lab = body.label, i, pass, tmp, gap = (now - lastFold) / 1000;
      lastFold = now; folds++;
      for (i = 0; i < BN; i++) nearNow[i] = lab[i] >= 0 ? 1 : 0;
      for (i = 0; i < BN; i++) grow[i] = nearNow[i] | nearPrev[i];
      for (pass = 0; pass < 3; pass++) { dilate(grow, grow2); tmp = grow; grow = grow2; grow2 = tmp; }   // people + 3 cells (the soft edge)
      var use = haveRef && gap < STALE_HOLD_S, cells = 0, sum = 0, carry = injLeft;
      if (gap > 0.005 && gap < 0.2) depthDt += (gap - depthDt) * 0.2;
      for (i = 0; i < BN; i++) full[i] = use && grow[i] && Math.abs(m[i] - ref[i]) > STIR ? 1 : 0;
      for (pass = 0; pass < 2; pass++) { dilate(full, full2); tmp = full; full = full2; full2 = tmp; }
      for (i = 0; i < BN; i++) {
        var g = grow[i], mg = g ? m[i] : 0, d = mg - ref[i], a = Math.abs(d), v = 0;
        if (!use) ref[i] = mg;
        else if (a > STIR || (a > STIR_SETTLE && full[i])) { v = (d > 0 ? 1 : -1) * Math.min(1.2, a); ref[i] = mg; }   // part of a real move
        else if (a > STIR_SETTLE && Math.abs(mg - prevM[i]) < 0.04) {                                                // a small change that has settled
          var tt = Math.min(1, Math.max(0, (a - STIR_SETTLE) / (STIR_FAINT - STIR_SETTLE)));
          v = (d > 0 ? 1 : -1) * Math.min(1.2, a) * tt * tt * (3 - 2 * tt); ref[i] = mg;
        }
        q[i] = Math.max(-1.5, Math.min(1.5, q[i] * carry + v));
        if (v) { cells++; sum += Math.abs(v); }
        prevM[i] = mg; held[i] = mg;
        near[i] = body.people.length ? Math.max(0, Math.min(1, 1 - (body.sdf[i] - NEAR_CELLS) / 15)) : 0;
      }
      heldAny = true; haveRef = true;
      tmp = nearNow; nearNow = nearPrev; nearPrev = tmp;
      lastQ = {cells: cells, sum: +sum.toFixed(2)};
      if (cells) pushes++; pushSum += sum;
      injLeft = cells || carry > 0 ? 1 : 0;
      foldLog.push([folds, realFrames, cells]); if (foldLog.length > 12) foldLog.shift();
      upload();
    }
    var qs = new Float32Array(BN), qs2 = new Float32Array(BN), qt = new Float32Array(BN);
    function soften(src, dst, tmp) {          // 1-2-1 both ways: a push is a smooth swell of water, not a Kinect-cell block
      var x, y, i;
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; tmp[i] = (src[x > 0 ? i - 1 : i] + 2 * src[i] + src[x < BW - 1 ? i + 1 : i]) * 0.25; }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; dst[i] = (tmp[y > 0 ? i - BW : i] + 2 * tmp[i] + tmp[y < BH - 1 ? i + BW : i]) * 0.25; }
    }
    function upload() {
      soften(q, qs, qt); soften(qs, qs2, qt);
      for (var i = 0; i < BN; i++) {
        var o = i * 4;
        bodyBytes[o] = Math.round(Math.max(0, Math.min(1, held[i])) * 255);
        bodyBytes[o + 1] = Math.round(128 + Math.max(-1, Math.min(1, qs2[i])) * 127);
        bodyBytes[o + 2] = Math.round(Math.max(0, Math.min(1, near[i])) * 255);
      }
      gl.bindTexture(gl.TEXTURE_2D, bodyTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, bodyBytes);
    }
    function staleFade(dt, now) {            // the Kinect went quiet: hold everything for STALE_HOLD_S, then let the body go
      if ((now - lastFold) / 1000 < STALE_HOLD_S || !heldAny) return;
      var k = Math.exp(-dt / 0.15), any = false;
      for (var i = 0; i < BN; i++) { if (held[i] > 0.003) { held[i] *= k; any = true; } else held[i] = 0; q[i] = 0; near[i] *= k; }
      heldAny = any; haveRef = false; upload();
    }

    function simStep(np) {
      var S = P.sim, u = S.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[1 - cur]); gl.viewport(0, 0, SW, SH);
      gl.useProgram(S.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st[cur]); gl.uniform1i(u.uS, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, d2); gl.uniform1i(u.uCalm, 2);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv());
      gl.uniform2f(u.uSim, SW, SH); gl.uniform1f(u.uCell, CELL);
      var c = WAVE_SPEED * STEP / CELL;
      gl.uniform1f(u.uC2, c * c);
      gl.uniform1f(u.uDampV, Math.exp(-STEP / FADE_S)); gl.uniform1f(u.uDampH, Math.exp(-STEP / (FADE_S * 1.5)));
      gl.uniform1f(u.uDampF, Math.exp(-STEP / FAR_FADE_S)); gl.uniform1f(u.uNear, NEAR_PX);
      gl.uniform1f(u.uDampP, Math.exp(-STEP / FINGER_FADE_S)); gl.uniform1f(u.uDampPH, Math.exp(-STEP / (FINGER_FADE_S * 1.5)));
      gl.uniform1f(u.uVisc, 0.012); gl.uniform1f(u.uCap, 8 * aInc); gl.uniform1f(u.uEdge, EDGE_PX / CELL); gl.uniform1f(u.uCalmK, CALMING * 3);
      var frac = Math.min(injLeft, STEP / Math.max(0.012, depthDt * 0.5));
      gl.uniform1f(u.uInject, frac); gl.uniform1f(u.uPush, PUSH * 1.2 * aInc);
      incUniforms(u, wrap(wInc * (tSim + STEP)));
      gl.uniform1i(u.uNP, np); gl.uniform4fv(u.uPin, PIN); gl.uniform1f(u.uPinS, 7); gl.uniform1f(u.uPinHole, FINGER_HOLE);
      gl.uniform1f(u.uPinPh, wrap(TAU * FINGER_HZ * (tSim + STEP)));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = 1 - cur; steps++; tSim += STEP;
      injLeft = Math.max(0, injLeft - frac); if (injLeft < 1e-6 && frac > 0) { injLeft = 0; q.fill(0); }
    }
    function incUniforms(u, ph) {
      gl.uniform4f(u.uInc, kInc, ph, aInc * swellOn, SWELL_VARY);
      var ex0 = SW * CELL, ey0 = SH * CELL;
      for (var yi = 0; yi < spots.length; yi++) { var sw = spots[yi].w; YLD[yi * 4] = spots[yi].x * ex0; YLD[yi * 4 + 1] = (1 - spots[yi].y) * ey0; YLD[yi * 4 + 2] = SWELL_YIELD * sw * sw * (3 - 2 * sw); }
      gl.uniform1i(u.uNY, spots.length); gl.uniform4fv(u.uYield, YLD); gl.uniform2f(u.uEnv, kEnv, wrap(kEnv * WAVE_SPEED * tSim));
      var a = SWELL_FROM * Math.PI / 180, ex = SW * CELL, ey = SH * CELL, rr = SWELL_ARC + 0.5 * Math.abs(Math.cos(a)) * ex + 0.5 * Math.abs(Math.sin(a)) * ey;
      gl.uniform2f(u.uIncM, wrap(tSim * 0.07), wrap(tSim * 0.05)); gl.uniform2f(u.uSim0, ex, ey);
      gl.uniform2f(u.uSrc, ex / 2 - Math.cos(a) * rr, ey / 2 + Math.sin(a) * rr);
    }
    function derive() {
      var D = P.der, u = D.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dFb); gl.viewport(0, 0, SW, SH); gl.useProgram(D.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, st[cur]); gl.uniform1i(u.uS, 0);
      gl.uniform2f(u.uSim, SW, SH); gl.uniform1f(u.uCell, CELL);
      incUniforms(u, wrap(wInc * tSim)); gl.uniform1f(u.uPh, wrap(wInc * tSim)); gl.uniform1f(u.uAI, 1 / aInc);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, d2); gl.generateMipmap(gl.TEXTURE_2D);
    }
    function display(np) {
      var D = P.disp, u = D.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(D.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, d1); gl.uniform1i(u.uD1, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, d2); gl.uniform1i(u.uD2, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 2);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv());
      gl.uniform2f(u.uSimR, SW * CELL, SH * CELL); gl.uniform1f(u.uPx, pxS);
      gl.uniform1f(u.uLight, LIGHT); gl.uniform1f(u.uSplit, SPLIT); gl.uniform1f(u.uMen, MENISCUS); gl.uniform1f(u.uDark, DARK_INSIDE);
      gl.uniform1f(u.uAmp, aInc); gl.uniform1f(u.uBoost, PEOPLE_LIGHT); gl.uniform1f(u.uAmb, AMBIENT); gl.uniform1f(u.uWallK, wallK); gl.uniform1f(u.uView, view); gl.uniform1f(u.uWarm, WARM); gl.uniform1f(u.uGlow, GLOW); incUniforms(u, 0);
      gl.uniform1i(u.uNP, np); gl.uniform4fv(u.uPin, PIN);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); frames++;
      if (canvas.width !== W || canvas.height !== H) alloc(canvas.width, canvas.height);
      gl.bindVertexArray(vao); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      if (dt > 0) {
        elapsed += dt; realFrames++;
        if (body.update(dt, now)) fold(now); else if (!body.fresh) staleFade(dt, now);
        fingers(now); yieldFrame(dt);
        acc = Math.min(acc + dt, STEP * MAX_STEPS);
        var stepped = false;
        while (acc >= STEP) { simStep(packPins(now, SW * CELL, SH * CELL)); acc -= STEP; stepped = true; }
        if (stepped) derive();
      }
      display(packPins(now, SW * CELL, SH * CELL));
      gl.bindVertexArray(null);
    }
    function touch(t) {                      // WallKit path (also used if main.js falls through)
      if (!t) return;
      wake(t.x, t.y);
    }
    function refreshStep() {
      // Courant c = WAVE_SPEED * STEP / CELL must stay <= 0.55 (9-point limit 0.87).
      STEP_HZ = Math.max(120, Math.ceil(WAVE_SPEED / CELL / 0.55));
      STEP = 1 / STEP_HZ;
      wInc = TAU * WAVE_SPEED / SWELL_GAP;
      kPin = TAU * FINGER_HZ / WAVE_SPEED;
      aPin = 4.5 * FINGER_AMP / (kPin * kPin);
    }
    function set(opts) {
      // Namespaced floats (fx_schema.py / main.js FX_FLOAT_NS): window._rippletankFx.
      if (!opts || destroyed) {
        return {speed: WAVE_SPEED, fade: FADE_S, push: PUSH, boost: PEOPLE_LIGHT, wall: wallK};
      }
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      var speedTouched = false;
      if (Number.isFinite(opts.speed)) {
        WAVE_SPEED = Math.max(40, Math.min(150, opts.speed));
        speedTouched = true;
      }
      if (Number.isFinite(opts.fade)) FADE_S = Math.max(1, Math.min(8, opts.fade));
      if (Number.isFinite(opts.push)) PUSH = Math.max(0.2, Math.min(3, opts.push));
      if (Number.isFinite(opts.boost)) PEOPLE_LIGHT = Math.max(1, Math.min(10, opts.boost));
      if (speedTouched) refreshStep();
      return {speed: WAVE_SPEED, fade: FADE_S, push: PUSH, boost: PEOPLE_LIGHT, wall: wallK};
    }
    function destroy() {
      if (destroyed) return; destroyed = true; kit.wantDepth(false);
      sized.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); sized = [];
      made.reverse().forEach(function (r) { gl['delete' + r[0]](r[1]); }); made = [];
      if (window.RippletankSet === set) delete window.RippletankSet;
      if (window.RippletankWake === wake) delete window.RippletankWake;
      if (window.__rippletankDebug) try { delete window.__rippletankDebug; } catch (e) { window.__rippletankDebug = undefined; }
    }
    kit.wantDepth(true);
    window.RippletankSet = set;
    window.RippletankWake = wake;
    // Apply-on-create: RippletankSet is deleted on destroy and may not fire again.
    if (window._rippletankFx) set(window._rippletankFx);
    if (window.WallTest) window.__rippletankDebug = function (box, opt) {   // sandbox only (the live wall has no WallTest)
      if (opt && 'view' in opt) view = opt.view;
      if (opt && 'swell' in opt) swellOn = opt.swell ? 1 : 0;          // sandbox only: the idle swell off, to see a person's own response
      var out = {frames: frames, realFrames: realFrames, steps: steps, stepHz: STEP_HZ, sim: [SW, SH], folds: folds, pushes: pushes, pushSum: +pushSum.toFixed(1), lastQ: lastQ,
        foldLog: foldLog.slice(), pins: pins.length, landings: landings, wakeCount: wakeCount, fresh: body.fresh, regOk: body.regOk, aInc: +aInc.toFixed(1),
        people: body.people.map(function (p) { return {id: p.id, area: p.area, moving: +p.moving.toFixed(3)}; }), glError: gl.getError()};
      if (box) {                               // the simulated field (what people added) in a window box (0..1, y down): read back, sandbox only
        var x0 = Math.max(0, Math.floor(box[0] * SW)), x1 = Math.min(SW, Math.ceil(box[2] * SW)), y0 = Math.max(0, Math.floor((1 - box[3]) * SH)), y1 = Math.min(SH, Math.ceil((1 - box[1]) * SH));
        var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), px = new Float32Array(w * h * 4), tot = new Float32Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[cur]); gl.readPixels(x0, y0, w, h, gl.RGBA, gl.FLOAT, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dFb); gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(x0, y0, w, h, gl.RGBA, gl.FLOAT, tot); gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        var s2 = 0, mx = 0, t2 = 0, n = w * h;
        for (var i = 0; i < n; i++) { var v = px[i * 4] / aInc, tv = tot[i * 4 + 1] / aInc; s2 += v * v; mx = Math.max(mx, Math.abs(v)); t2 += tv * tv; }
        out.box = {rms: +Math.sqrt(s2 / n).toFixed(4), max: +mx.toFixed(4), totalRms: +Math.sqrt(t2 / n).toFixed(4), mean: +(px.reduce(function (a, v, j) { return j % 4 ? a : a + v; }, 0) / n / aInc).toFixed(4)};
      }
      return out;
    };
    return {frame: frame, touch: touch, destroy: destroy};
  }
})();
