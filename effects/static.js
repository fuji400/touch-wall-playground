/* Static — sparks jump between you and another person (2026-10-05; concept #5 of the fx-research report, built by Claude (fx-batch)).
 * The wall is a dark room full of faint drifting static. Step in and your outline picks up a thin electric glow; stand there (or
 * shuffle about) and you charge up: the glow brightens and little sparks start crackling off your edges. Come near another person
 * and sparks jump across the gap between you, from the closest points of your two outlines: rare and thin at arm's length, then
 * thicker and more often, then one steady crackling arc as the gap closes. Touch, and it goes out: you are one circuit now.
 * Touch the wall with a fingertip and your charge grounds there: a bolt jumps from your hand to the finger and a branching
 * discharge spreads over the wall from it, leaving its violet mark on the wall for a few seconds; then you charge up again.
 * Nobody there: dim charge clouds drift, motes of charge twinkle in them, tiny sparks flicker now and then, and once in a while a
 * cloud glows softly from inside.
 * All the light is on the wall around and between people, never on them (DARK_INSIDE). Sparks flicker, they do not strobe the room:
 * separate strikes stay at three a second or fewer per pair, and close up they become one steady arc that only changes shape.
 * Needs plugins/body.js (WallBody, the shared body stage). WebGL 2 (float render targets), no assets, no audio, one depth client.
 * Computed here (not in the body stage): a distance-to-the-nearest-person map from real people only (the stage's sdf also counts
 * tiny noise specks), which person is nearest to each cell, and each person's outline points with their outward direction.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs (px are on a 1280-wide picture)
  var REACH_PX = 430;          // two people closer than this start sparking at each other
  var STEADY_PX = 120;         // closer than this the sparks become one steady crackling arc
  var CONTACT_PX = 10;         // closer than this you are one circuit: the arc goes out
  var STRIKES_FAR = 0.7;       // sparks per second between two people at the edge of reach...
  var STRIKES_NEAR = 3.0;      // ...and when close (kept at 3 or under: brightness flickers, the room never strobes)
  var ARC_BRIGHT = 1.0;        // brightness of the sparks between people
  var ARC_WIDTH = 1.0;         // thickness of the sparks between people
  var JAG = 0.36;              // how crooked a spark is
  var BRANCHES = 3;            // side branches on a long spark
  var CHARGE_S = 7;            // seconds standing alone to charge up fully
  var MOVE_CHARGE = 2.5;       // moving charges you this much faster (shuffle your feet!)
  var CORONA = 1.0;            // the thin electric glow hugging a person's outline
  var CORONA_BASE = 0.32;      // ...how much of it shows before any charge (the instant response)
  var CRACKLE = 9;             // little sparks per second off a fully charged outline
  var GROUND = 1.0;            // size of the discharge into the wall at a fingertip
  var AFTERGLOW_S = 1.3;       // how long a spark's faint violet trace stays in the air between people (time constant, s)
  var SCORCH_S = 3.5;          // how long the branching mark of a discharge stays on the wall (time constant, s)
  var FIELD = 1.0;             // the faint drifting static on the empty wall
  var FLICKERS = 4;            // tiny distant flickers per second in the static
  var BLOOM = 1.0;             // glow around bright sparks
  var DARK_INSIDE = 1.0;       // no light inside a person (1 = none, 0 = off)
  var MAX_SEGS = 6000;         // drawing budget: spark segments per frame

  registerWallPlugin({id: 'static', title: 'Static', author: 'Claude (fx-batch), fx-research concept #5', create: create});

  var K_PAIR = 0, K_STEADY = 1, K_SPARK = 2, K_AMB = 3, K_GROUND = 4, K_TIP = 5;

  // ---------------------------------------------------------------- shaders
  var VS_TRI = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  // one spark segment = one quad around it; a gaussian core plus a short glow. Positions in canvas px, y down.
  var VS_SEG = '#version 300 es\n' +
    'layout(location=0) in vec4 aSeg; layout(location=1) in vec4 aPar; uniform vec2 uRes;\n' +
    'out vec2 vP; flat out vec4 vSeg; flat out vec4 vPar;\n' +
    'void main(){vec2 a=aSeg.xy,b=aSeg.zw,d=b-a;float L=length(d);vec2 t=L>1e-3?d/L:vec2(1.,0.),n=vec2(-t.y,t.x);\n' +
    '  float r=aPar.y*5.+2.,s=float(gl_VertexID&1),side=float((gl_VertexID>>1)&1)*2.-1.;\n' +
    '  vec2 p=mix(a-t*r,b+t*r,s)+n*side*r; vP=p; vSeg=aSeg; vPar=aPar;\n' +
    '  gl_Position=vec4(p.x/uRes.x*2.-1.,1.-p.y/uRes.y*2.,0.,1.);}\n';
  var FS_SEG = '#version 300 es\nprecision highp float;\n' +
    'in vec2 vP; flat in vec4 vSeg; flat in vec4 vPar; layout(location=0) out vec4 o; layout(location=1) out vec4 o2;\n' +
    'void main(){vec2 a=vSeg.xy,ba=vSeg.zw-a,pa=vP-a;float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-6),0.,1.);float d=length(pa-ba*h);\n' +
    '  float w=vPar.y,core=exp(-d*d/(w*w)),glow=exp(-d/(w*2.2));\n' +
    '  o=vec4((vec3(.86,.92,1.)*core+vec3(.30,.40,1.)*glow*.32)*vPar.x,0.); o2=vec4(core*vPar.x*vPar.z,core*vPar.x*vPar.w,0.,0.);}\n';
  // the afterglow (r: a spark's trace in the air) and the scorch (g: a discharge's mark), kept at half size, fading at their own rates
  var FS_TRAIL = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uPrev,uBurn; uniform vec2 uTx,uDecay; in vec2 vUv; out vec4 o;\n' +
    'void main(){vec2 a=max(max(texture(uBurn,vUv+uTx*vec2(-.5,-.5)).rg,texture(uBurn,vUv+uTx*vec2(.5,-.5)).rg),max(texture(uBurn,vUv+uTx*vec2(-.5,.5)).rg,texture(uBurn,vUv+uTx*vec2(.5,.5)).rg));\n' +
    '  o=vec4(max(texture(uPrev,vUv).rg*uDecay,min(a,vec2(2.))),0.,1.);}\n';
  var FS_DOWN = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uSrc; uniform vec2 uTx; in vec2 vUv; out vec4 o;\n' +
    'void main(){o=vec4((texture(uSrc,vUv+uTx*vec2(-1.,-1.)).rgb+texture(uSrc,vUv+uTx*vec2(1.,-1.)).rgb+texture(uSrc,vUv+uTx*vec2(-1.,1.)).rgb+texture(uSrc,vUv+uTx*vec2(1.,1.)).rgb)*.25,1.);}\n';
  var FS_BLUR = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uSrc; uniform vec2 uDir; in vec2 vUv; out vec4 o;\n' +
    'void main(){vec3 c=texture(uSrc,vUv).rgb*.227;\n' +
    '  c+=(texture(uSrc,vUv+uDir*1.385).rgb+texture(uSrc,vUv-uDir*1.385).rgb)*.316;\n' +
    '  c+=(texture(uSrc,vUv+uDir*3.231).rgb+texture(uSrc,vUv-uDir*3.231).rgb)*.070;\n' +
    '  o=vec4(c,1.);}\n';
  var GLSL_NOISE = 'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n' +
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}\n';
  var GLSL_BODY = '  vec3 h=uHinv*vec3(vUv.x,1.-vUv.y,1.); vec2 k=h.xy/max(h.z,1e-6);\n' +
    '  float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.; k=clamp(k,0.,1.);\n' +
    '  vec4 b=texture(uBody,k); float mask=b.r*inK, d=mix(40.,b.g,inK), ch=b.b*inK;\n' +
    '  vec2 q=vec2(vUv.x*uAspect,1.-vUv.y); float t=uTime;\n';
  // the outline, drawn into the spark buffer (so the bloom gives it its soft glow): a thin steady electric line just outside the
  // person's edge, and with charge, bright knots crawling along it. Only around real people (not noise specks).
  var FS_CORONA = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uBody; uniform mat3 uHinv; uniform float uTime,uAspect,uPx,uCorona,uBase;\n' +
    'in vec2 vUv; layout(location=0) out vec4 o; layout(location=1) out vec4 o2;\n' + GLSL_NOISE +
    'void main(){\n' + GLSL_BODY +
    '  float fw=max(fwidth(mask),1e-4), dl=(mask-.36)/fw, w=1.25*uPx;\n' +
    '  float line=exp(-dl*dl/(w*w)), wide=exp(-dl*dl/(w*w*12.));\n' +
    '  float kn=smoothstep(.56,.86,vn(q*30.+vec2(t*7.,-t*5.)))+.8*smoothstep(.6,.88,vn(q*57.-vec2(t*4.,t*9.)));\n' +
    '  float real=1.-smoothstep(2.,4.,d);\n' +
    '  float crawl=.55+.45*vn(q*13.+vec2(t*2.3,-t*3.1));\n' +
    '  float cv=ch*ch;\n' +
    '  vec3 c=vec3(.50,.70,1.)*(line*(uBase*crawl+.3*cv)+wide*.08*(.3+1.2*cv)+(line+.35*wide)*kn*(.2+2.1*cv))*uCorona*real;\n' +
    '  o=vec4(c,0.); o2=vec4(0.);\n' +
    '}\n';
  // the picture: drifting static (charge clouds, twinkling motes), sparks + outline + bloom + afterglow; nothing inside a person
  var FS_COMP = '#version 300 es\nprecision highp float;\n' +
    'uniform sampler2D uBody,uArc,uQ,uE,uTrail; uniform mat3 uHinv;\n' +
    'uniform float uTime,uAspect,uPx,uDark,uField,uBloom,uH,uWall; uniform vec4 uSheet[2];\n' +
    'in vec2 vUv; out vec4 o;\n' + GLSL_NOISE +
    'void main(){\n' + GLSL_BODY +
    // charge clouds: a slow, faint indigo haze; now and then one glows softly from inside (distant sheet lightning, never a flash)
    '  vec2 cp=q*1.25+vec2(t*.011,-t*.007);\n' +
    '  float cl=vn(cp)*.6+vn(cp*2.3+vec2(4.1,-t*.02))*.4, cloud=smoothstep(.3,.85,cl);\n' +
    '  vec3 col=vec3(.028,.032,.088)*(.6+.75*cloud);\n' +
    '  for(int i=0;i<2;i++){vec2 sd=(q-uSheet[i].xy)/max(uSheet[i].z,1e-3); col+=vec3(.10,.11,.32)*uSheet[i].w*exp(-dot(sd,sd))*(.35+.65*cloud);}\n' +
    // motes of charge drifting in them: mostly faint, now and then a quick twinkle; drawn in close around a charged person
    '  float pull=1.+1.4*ch*exp(-d/5.);\n' +
    '  for(int L=0;L<2;L++){\n' +
    '    float fl=float(L), sc=mix(26.,16.,fl);\n' +
    '    vec2 p=q*sc+vec2(t*mix(.42,-.25,fl),-t*mix(.55,.33,fl)), id=floor(p), f=fract(p);\n' +
    '    float hh=hash(id+fl*13.1);\n' +
    '    vec2 pos=.22+.56*vec2(hash(id+3.1+fl),hash(id+7.7+fl))+.1*vec2(sin(t*.7+hh*40.),cos(t*.6+hh*31.));\n' +
    '    float r=length(f-pos)/sc*uH, sz=mix(1.7,2.5,fl);\n' +
    '    float tw=.4+.6*pow(max(0.,sin(t*(.9+hh*2.3)+hh*60.)),6.);\n' +
    '    col+=vec3(.55,.66,1.)*exp(-r*r/(sz*sz))*tw*step(hh,.5)*mix(.115,.085,fl)*(.65+.4*cloud)*pull;\n' +
    '  }\n' +
    '  col*=uField*mix(uWall,1.,clamp(ch*exp(-d/5.),0.,1.));\n' +   // the empty wall's static scales with 'Empty wall'; around a charged person it stays as it was

    // sparks and outline, their bloom and their afterglow
    '  vec3 arc=texture(uArc,vUv).rgb;\n' +
    '  col+=arc+(texture(uQ,vUv).rgb*vec3(.55,.62,1.)*1.0+texture(uE,vUv).rgb*vec3(.45,.40,1.)*1.1)*uBloom;\n' +
    '  vec2 tr=texture(uTrail,vUv).rg;\n' +
    '  col+=vec3(.30,.20,.95)*tr.r*.16+vec3(.42,.32,1.)*tr.g*.42;\n' +
    '  col*=1.-uDark*smoothstep(.55,.8,mask);\n' +
    '  col=1.-exp(-col*1.2);\n' +
    '  o=vec4(col,1.);\n' +
    '}\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Static needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Static needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Static needs float render targets');
    var wallK = 2.0;             // 'Empty wall' knob (1 = the 2026-10-05 picture): scales the drifting charge clouds, motes, sheet glow and the tiny ambient flickers; corona, sparks, arcs, discharges are untouched
    var destroyed = false, made = {tex: [], fb: [], prog: [], buf: [], vao: []};

    // ------------------------------------------------------------ GL plumbing
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var m = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + m); }
      return s;
    }
    function program(vs, fs) {
      var p = gl.createProgram(), a = shader(gl.VERTEX_SHADER, vs), b = shader(gl.FRAGMENT_SHADER, fs);
      gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p); gl.deleteShader(a); gl.deleteShader(b);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var m = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error('link: ' + m); }
      made.prog.push(p);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    function texture(w, h, ifmt, fmt, type, filter) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      made.tex.push(t);
      return t;
    }
    function target(tex, tex2) {             // tex2: a second colour attachment (the sparks' burn)
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (tex2) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex2, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]); }
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      made.fb.push(f);
      return f;
    }
    function drop(t, f) {
      var i = made.tex.indexOf(t); if (i >= 0) made.tex.splice(i, 1); gl.deleteTexture(t);
      if (f) { var j = made.fb.indexOf(f); if (j >= 0) made.fb.splice(j, 1); gl.deleteFramebuffer(f); }
    }

    var pSeg = program(VS_SEG, FS_SEG), pTrail = program(VS_TRI, FS_TRAIL), pDown = program(VS_TRI, FS_DOWN),
        pBlur = program(VS_TRI, FS_BLUR), pComp = program(VS_TRI, FS_COMP), pCor = program(VS_TRI, FS_CORONA);
    var triVao = gl.createVertexArray(); made.vao.push(triVao);
    var segVao = gl.createVertexArray(); made.vao.push(segVao);
    var segBuf = gl.createBuffer(); made.buf.push(segBuf);
    var inst = new Float32Array(MAX_SEGS * 8);
    gl.bindVertexArray(segVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, segBuf);
    gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);

    // the body, as the shader sees it: r = mask, g = distance to the nearest real person (cells), b = that person's charge
    var BW = WallBody.w, BH = WallBody.h, NC = BW * BH, body = WallBody.create(kit, {});
    var bodyData = new Float32Array(NC * 4), bodyTex = texture(BW, BH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR);

    var W = 0, H = 0, S = 1, arcT = null, arcF = null, burnT = null, trail = [null, null], trailF = [null, null], tw = 0, th = 0, ti = 0;
    var qT = [null, null], qF = [null, null], qw = 0, qh = 0, eT = [null, null], eF = [null, null], ew = 0, eh = 0;
    function sizeBuffers(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (w === W && h === H) return;
      if (arcT) { drop(arcT, arcF); drop(burnT, null); for (var j = 0; j < 2; j++) { drop(trail[j], trailF[j]); drop(qT[j], qF[j]); drop(eT[j], eF[j]); } }
      W = w; H = h; S = W / 1280;
      tw = Math.max(1, W >> 1); th = Math.max(1, H >> 1); qw = Math.max(1, W >> 2); qh = Math.max(1, H >> 2); ew = Math.max(1, W >> 3); eh = Math.max(1, H >> 3);
      arcT = texture(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); burnT = texture(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
      arcF = target(arcT, burnT);
      for (var k = 0; k < 2; k++) {
        trail[k] = texture(tw, th, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); trailF[k] = target(trail[k]);
        qT[k] = texture(qw, qh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); qF[k] = target(qT[k]);
        eT[k] = texture(ew, eh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); eF[k] = target(eT[k]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, trailF[k]); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    sizeBuffers(canvas.width, canvas.height);

    // ------------------------------------------------------------ Kinect cell -> canvas px (through the touch registration)
    var regOk = false;
    function toPx(u, v, out) {                // u, v in Kinect pixels
      var s = kit.toScreen(u, v);
      if (s && isFinite(s[0]) && isFinite(s[1])) { out[0] = s[0] * W; out[1] = s[1] * H; regOk = true; }
      else { out[0] = u / 512 * W; out[1] = v / 424 * H; regOk = false; }
      return out;
    }

    // ------------------------------------------------------------ people: distance map, outline points, charge
    var dist = new Float32Array(NC), near = new Int16Array(NC);
    var MAXB = 6000, BX = new Float32Array(MAXB), BY = new Float32Array(MAXB), NX = new Float32Array(MAXB), NY = new Float32Array(MAXB);
    var persons = [], pairs = {}, charges = {}, tmpA = [0, 0], tmpB = [0, 0];
    function chamfer() {                      // distance (cells) to the nearest cell of a real person (body.people only), and which one
      var lab = body.label, x, y, i, R2 = 1.4142;
      for (i = 0; i < NC; i++) { near[i] = lab[i]; dist[i] = lab[i] >= 0 ? 0 : 1e6; }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; if (dist[i] === 0) continue;
        var v = dist[i], nb = near[i];
        if (x > 0 && dist[i - 1] + 1 < v) { v = dist[i - 1] + 1; nb = near[i - 1]; }
        if (y > 0) {
          if (dist[i - BW] + 1 < v) { v = dist[i - BW] + 1; nb = near[i - BW]; }
          if (x > 0 && dist[i - BW - 1] + R2 < v) { v = dist[i - BW - 1] + R2; nb = near[i - BW - 1]; }
          if (x < BW - 1 && dist[i - BW + 1] + R2 < v) { v = dist[i - BW + 1] + R2; nb = near[i - BW + 1]; }
        }
        dist[i] = v; near[i] = nb; }
      for (y = BH - 1; y >= 0; y--) for (x = BW - 1; x >= 0; x--) { i = y * BW + x; if (dist[i] === 0) continue;
        var u = dist[i], nu = near[i];
        if (x < BW - 1 && dist[i + 1] + 1 < u) { u = dist[i + 1] + 1; nu = near[i + 1]; }
        if (y < BH - 1) {
          if (dist[i + BW] + 1 < u) { u = dist[i + BW] + 1; nu = near[i + BW]; }
          if (x < BW - 1 && dist[i + BW + 1] + R2 < u) { u = dist[i + BW + 1] + R2; nu = near[i + BW + 1]; }
          if (x > 0 && dist[i + BW - 1] + R2 < u) { u = dist[i + BW - 1] + R2; nu = near[i + BW - 1]; }
        }
        dist[i] = u; near[i] = nu; }
    }
    function outlines() {                     // each person's outline points (canvas px) just outside the edge, with outward directions
      var lab = body.label, mk = body.mask, list = [], n = 0, x, y, i, p, ppl = body.people;
      for (p = 0; p < ppl.length; p++) list.push({id: ppl[p].id, idx: p, s: 0, e: 0, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9,
        cx: 0, cy: 0, moving: ppl[p].moving, area: ppl[p].area});
      var starts = [], counts = [];
      for (p = 0; p < list.length; p++) { starts.push([]); counts.push(0); }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; var L = lab[i]; if (L < 0 || L >= list.length) continue;
        if (!((x > 0 && lab[i - 1] < 0) || (x < BW - 1 && lab[i + 1] < 0) || (y > 0 && lab[i - BW] < 0) || (y < BH - 1 && lab[i + BW] < 0))) continue;
        starts[L].push(i); }
      for (p = 0; p < list.length; p++) {
        var P = list[p], cells = starts[p], stride = Math.max(1, Math.ceil(cells.length / 700));
        P.s = n;
        for (var c = 0; c < cells.length && n < MAXB; c += stride) {
          i = cells[c]; x = i % BW; y = (i / BW) | 0;
          var gx = (x < BW - 1 ? mk[i + 1] : mk[i]) - (x > 0 ? mk[i - 1] : mk[i]), gy = (y < BH - 1 ? mk[i + BW] : mk[i]) - (y > 0 ? mk[i - BW] : mk[i]);
          var gl2 = Math.hypot(gx, gy); if (gl2 < 1e-4) continue;
          var ox = -gx / gl2, oy = -gy / gl2;
          toPx((x + 0.5 + ox * 0.75) * 4, (y + 0.5 + oy * 0.75) * 4, tmpA);
          toPx((x + 0.5 + ox * 1.75) * 4, (y + 0.5 + oy * 1.75) * 4, tmpB);
          if (tmpA[0] < 0 || tmpA[0] > W || tmpA[1] < 0 || tmpA[1] > H) continue;   // only outline that lands on the picture
          var dx = tmpB[0] - tmpA[0], dy = tmpB[1] - tmpA[1], dl = Math.hypot(dx, dy) || 1;
          BX[n] = tmpA[0]; BY[n] = tmpA[1]; NX[n] = dx / dl; NY[n] = dy / dl;
          if (tmpA[0] < P.x0) P.x0 = tmpA[0]; if (tmpA[0] > P.x1) P.x1 = tmpA[0]; if (tmpA[1] < P.y0) P.y0 = tmpA[1]; if (tmpA[1] > P.y1) P.y1 = tmpA[1];
          P.cx += tmpA[0]; P.cy += tmpA[1]; n++;
        }
        P.e = n; if (P.e > P.s) { P.cx /= (P.e - P.s); P.cy /= (P.e - P.s); }
      }
      return list.filter(function (P) { return P.e - P.s >= 6; });
    }
    function boxDist(x, y, P) { var dx = Math.max(0, P.x0 - x, x - P.x1), dy = Math.max(0, P.y0 - y, y - P.y1); return Math.hypot(dx, dy); }
    function closest(A, B, reach) {           // the closest outline points of two people (px), plus a few near-best places
      var sa = Math.max(1, Math.ceil((A.e - A.s) / 160)), sb = Math.max(1, Math.ceil((B.e - B.s) / 160)), cand = [], i, j;
      for (i = A.s; i < A.e; i += sa) {
        if (boxDist(BX[i], BY[i], B) > reach) continue;
        var bd = 1e18, bj = -1;
        for (j = B.s; j < B.e; j += sb) { var dx = BX[j] - BX[i], dy = BY[j] - BY[i], d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; bj = j; } }
        if (bj >= 0) cand.push({a: i, b: bj, d: Math.sqrt(bd)});
      }
      if (!cand.length) return null;
      cand.sort(function (p, q) { return p.d - q.d; });
      var best = cand[0], a = best.a, b = best.b, k;             // refine the best at full outline resolution
      for (k = 0; k < 2; k++) {
        var bd2 = 1e18; for (j = B.s; j < B.e; j++) { var ex = BX[j] - BX[a], ey = BY[j] - BY[a], e2 = ex * ex + ey * ey; if (e2 < bd2) { bd2 = e2; b = j; } }
        var ad2 = 1e18; for (i = A.s; i < A.e; i++) { var fx = BX[i] - BX[b], fy = BY[i] - BY[b], f2 = fx * fx + fy * fy; if (f2 < ad2) { ad2 = f2; a = i; } }
      }
      var dmin = Math.hypot(BX[a] - BX[b], BY[a] - BY[b]);
      var sites = [{ax: BX[a], ay: BY[a], bx: BX[b], by: BY[b], d: dmin}];
      for (k = 1; k < cand.length && sites.length < 10; k++) {
        var c = cand[k]; if (c.d > dmin * 1.8 + 40 * S) break;
        sites.push({ax: BX[c.a], ay: BY[c.a], bx: BX[c.b], by: BY[c.b], d: c.d});
      }
      return {d: dmin, sites: sites};
    }
    function shapes() {                        // after each new depth frame
      chamfer();
      persons = outlines();
      var reach = REACH_PX * S, n = persons.length, g = [], i, j, k, seen = {};
      for (i = 0; i < n; i++) { g.push([]); for (j = 0; j < n; j++) g[i].push(null); }
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
        var A = persons[i], B = persons[j];
        var bx = Math.max(0, A.x0 - B.x1, B.x0 - A.x1), by = Math.max(0, A.y0 - B.y1, B.y0 - A.y1);
        if (Math.hypot(bx, by) > reach) continue;
        g[i][j] = g[j][i] = closest(A, B, reach);
      }
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
        var r = g[i][j]; if (!r || r.d > reach) continue;
        var blocked = false;                   // only neighbours spark: not past a third person standing between them
        for (k = 0; k < n && !blocked; k++) { if (k === i || k === j) continue;
          var a2 = g[i][k], b2 = g[k][j]; if (a2 && b2 && a2.d < r.d && b2.d < r.d) blocked = true; }
        if (blocked) continue;
        var ia = persons[i].id, ib = persons[j].id, key = Math.min(ia, ib) + '-' + Math.max(ia, ib);
        var pr = pairs[key];
        if (!pr) pr = pairs[key] = {key: key, a: ia, b: ib, next: -1, steadyNext: 0, strikes: 0, born: elapsed};
        pr.d = r.d; pr.sites = r.sites; pr.seen = elapsed; seen[key] = true;
      }
      for (var key2 in pairs) if (!seen[key2]) delete pairs[key2];
      // pack the body for the shader
      var mk = body.mask;
      for (i = 0; i < NC; i++) {
        var o = i * 4, L = near[i], P = L >= 0 ? body.people[L] : null;
        bodyData[o] = mk[i]; bodyData[o + 1] = Math.min(40, dist[i]);
        bodyData[o + 2] = P && charges[P.id] ? charges[P.id].c : 0; bodyData[o + 3] = 0;
      }
      gl.bindTexture(gl.TEXTURE_2D, bodyTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.FLOAT, bodyData);
    }
    function charge(dt) {                      // charge builds on everyone, faster while moving; forgotten when someone leaves
      for (var i = 0; i < persons.length; i++) {
        var P = persons[i], c = charges[P.id];
        if (!c) c = charges[P.id] = {c: 0.12, seen: elapsed};
        c.c = Math.min(1, c.c + dt / CHARGE_S * (1 + MOVE_CHARGE * Math.min(1, P.moving * 12)));
        if (c.grounded > elapsed) c.c = Math.min(c.c, 0.08);
        c.seen = elapsed;
      }
      for (var id in charges) if (elapsed - charges[id].seen > 1.5) delete charges[id];
    }
    function chargeOf(id) { return charges[id] ? charges[id].c : 0; }

    // ------------------------------------------------------------ sparks
    var arcs = [], segCount = 0, stats = {pair: 0, steady: 0, spark: 0, amb: 0, ground: 0, tip: 0}, grounds = 0;
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function path(ax, ay, bx, by, levels, jag) {   // midpoint displacement: a crooked line from a to b
      var pts = [ax, ay, bx, by];
      for (var l = 0; l < levels; l++) {
        var out = [pts[0], pts[1]];
        for (var i = 0; i < pts.length - 2; i += 2) {
          var px = pts[i], py = pts[i + 1], qx = pts[i + 2], qy = pts[i + 3], dx = qx - px, dy = qy - py, len = Math.hypot(dx, dy) || 1e-3;
          var off = (Math.random() - 0.5) * jag * len;
          out.push((px + qx) / 2 - dy / len * off, (py + qy) / 2 + dx / len * off, qx, qy);
        }
        pts = out;
      }
      return pts;
    }
    function newArc(kind, tau, life, burn) {
      var a = {kind: kind, t0: elapsed - 1 / 60, tau: tau, life: life, burn: burn, seed: Math.random() * 100, s: [], n: 0};   // born one frame old: seen on its first frame
      arcs.push(a); return a;
    }
    function addPts(a, pts, b, w, rev0, speed, taper) {   // a polyline into an arc; brightness tapers along it when taper > 0
      var len = 0, total = 0, i;
      for (i = 0; i < pts.length - 2; i += 2) total += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      for (i = 0; i < pts.length - 2; i += 2) {
        var sl = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]), f = taper ? 1 - taper * len / Math.max(1, total) : 1;
        a.s.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], b * f, w * (0.55 + 0.45 * f), rev0 + (speed ? len / speed : 0));
        len += sl; a.n++;
      }
      return total;
    }
    function levelsFor(len) { return Math.max(2, Math.min(7, Math.ceil(Math.log2(Math.max(2, len / (7 * S)))))); }
    function bolt(a, ax, ay, bx, by, b, w, branches, jag) {   // a main channel with side branches and a little splash where it lands
      var len = Math.hypot(bx - ax, by - ay), pts = path(ax, ay, bx, by, levelsFor(len), jag);
      addPts(a, pts, b, w, 0, 0, 0);
      var m = pts.length / 2;
      for (var k = 0; k < branches && m > 4; k++) {
        var at = 1 + Math.floor(Math.random() * (m - 3)), px = pts[at * 2], py = pts[at * 2 + 1];
        var ang = Math.atan2(by - ay, bx - ax) + (Math.random() < 0.5 ? -1 : 1) * rnd(0.35, 1.0), bl = len * rnd(0.12, 0.32);
        var bp = path(px, py, px + Math.cos(ang) * bl, py + Math.sin(ang) * bl, levelsFor(bl), jag * 1.15);
        addPts(a, bp, b * 0.55, w * 0.62, 0, 0, 0.85);
      }
      splash(a, ax, ay, bx - ax, by - ay, b, w); splash(a, bx, by, ax - bx, ay - by, b, w);
    }
    function splash(a, x, y, dx, dy, b, w) {   // two or three tiny forks where a spark touches an outline
      var base = Math.atan2(dy, dx), k = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (var i = 0; i < k; i++) {
        var ang = base + rnd(-1.3, 1.3), l = rnd(5, 13) * S;
        addPts(a, path(x, y, x + Math.cos(ang) * l, y + Math.sin(ang) * l, 2, 0.5), b * 0.6, w * 0.6, 0, 0, 0.9);
      }
    }
    function pickSite(pr) {
      var dmin = pr.sites[0].d, spread = 10 * S + 0.3 * dmin, tot = 0, ws = [], i;
      for (i = 0; i < pr.sites.length; i++) { var wv = Math.exp(-(pr.sites[i].d - dmin) / spread); ws.push(wv); tot += wv; }
      var r = Math.random() * tot; for (i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return pr.sites[i]; }
      return pr.sites[0];
    }
    function closeness(d) { return Math.max(0, Math.min(1, (REACH_PX * S - d) / ((REACH_PX - STEADY_PX) * S))); }
    function nearestSite(pr, x, y) {          // the place on a pair's gap nearest to where a living spark already is
      var best = pr.sites[0], bd = 1e18;
      for (var i = 0; i < pr.sites.length; i++) { var st = pr.sites[i], mx = (st.ax + st.bx) / 2 - x, my = (st.ay + st.by) / 2 - y, d2 = mx * mx + my * my; if (d2 < bd) { bd = d2; best = st; } }
      return best;
    }
    function strike(pr, c, ch) {              // a spark that lives a moment, re-forming its path while it lasts (crackle), then fades
      var s = pickSite(pr), a = newArc(K_PAIR, 0, 0.26 + 0.24 * c, 0.55);
      a.key = pr.key; a.mx = (s.ax + s.bx) / 2; a.my = (s.ay + s.by) / 2; a.every = 0.05;
      a.b = ARC_BRIGHT * (1.2 + 0.7 * c + 0.3 * ch); a.w = ARC_WIDTH * S * (1.7 + 1.5 * c);
      a.br = Math.round(BRANCHES * rnd(0.4, 1.0) * (pr.d > 160 * S ? 1 : 0.5));
      a.make = function (a) {
        var q = pairs[a.key], st = q && q.sites && q.sites.length ? nearestSite(q, a.mx, a.my) : null;
        if (!st) { a.life = Math.min(a.life, elapsed - a.t0 + 0.06); return false; }   // the pair is gone: let it go out
        if (q.d < CONTACT_PX * S) { a.life = Math.min(a.life, elapsed - a.t0 + 0.04); return false; }
        a.mx = (st.ax + st.bx) / 2; a.my = (st.ay + st.by) / 2;
        bolt(a, st.ax, st.ay, st.bx, st.by, a.b, a.w, a.br, JAG); return true;
      };
      a.make(a); a.next = elapsed + a.every;
    }
    function steady(pr) {                     // close: one standing arc across the gap, always on, only its shape changes
      var a = pr.steady;
      if (!a || arcs.indexOf(a) < 0) {
        a = pr.steady = newArc(K_STEADY, 0, 0.2, 0.25); a.key = pr.key; a.every = 0.045;
        a.make = function (a) {
          var q = pairs[a.key]; if (!q || !q.sites || !q.sites.length || q.d >= STEADY_PX * S || q.d < CONTACT_PX * S) return false;
          var k2 = 1 - q.d / (STEADY_PX * S), s0 = q.sites[0];
          bolt(a, s0.ax, s0.ay, s0.bx, s0.by, ARC_BRIGHT * (1.5 + 0.6 * k2), ARC_WIDTH * S * (2.6 + 1.6 * k2), 1, JAG * 0.85);
          if (q.sites.length > 1) { var s1 = q.sites[1 + Math.floor(Math.random() * (q.sites.length - 1))];
            bolt(a, s1.ax, s1.ay, s1.bx, s1.by, ARC_BRIGHT * 0.7, ARC_WIDTH * S * 1.3, 0, JAG); }
          return true;
        };
        a.make(a); a.next = elapsed + a.every; stats.steady++;
      }
      a.life = elapsed - a.t0 + 0.15;          // kept alive while the pair stays close; it fades 0.15 s after
    }
    function pairArcs(dt) {
      for (var key in pairs) {
        var pr = pairs[key]; if (!pr.sites || !pr.sites.length) continue;
        if (pr.d < CONTACT_PX * S) continue;                       // touching: one circuit, no spark
        var c = closeness(pr.d), ch = 0.5 * (chargeOf(pr.a) + chargeOf(pr.b));
        if (pr.next < 0 || elapsed >= pr.next) {                   // a separate strike (the first one comes at once), 3 a second at most
          var rate = STRIKES_FAR + (STRIKES_NEAR - STRIKES_FAR) * Math.pow(c, 1.3);
          strike(pr, c, ch);
          pr.next = elapsed + Math.max(1 / 3, (1 / rate) * rnd(0.7, 1.3)); pr.strikes++; stats.pair++;
          drain(pr.a, 0.04); drain(pr.b, 0.04);
        }
        if (pr.d < STEADY_PX * S) { steady(pr); drain(pr.a, dt * 0.08); drain(pr.b, dt * 0.08); }
      }
    }
    function drain(id, amt) { var c = charges[id]; if (c) c.c = Math.max(0.15, c.c - amt); }
    function outlineSparks(dt) {               // a charged outline crackles: short sparks off the edge into the air
      for (var p = 0; p < persons.length; p++) {
        var P = persons[p], c = chargeOf(P.id), rate = CRACKLE * (0.1 + Math.pow(c, 1.5)), nPts = P.e - P.s;
        var cnt = poisson(rate * dt);
        for (var k = 0; k < cnt && nPts > 0; k++) {
          var i = P.s + Math.floor(Math.random() * nPts), a = newArc(K_SPARK, 0.12, rnd(0.12, 0.24), 0.15);
          a.x = BX[i]; a.y = BY[i]; a.ang = Math.atan2(NY[i], NX[i]); a.l = rnd(16, 50) * S * (0.5 + 0.7 * c); a.b = 0.75 + 0.75 * c; a.every = 0.05;
          a.make = function (a) {
            var ang = a.ang + rnd(-0.6, 0.6), pts = path(a.x, a.y, a.x + Math.cos(ang) * a.l, a.y + Math.sin(ang) * a.l, 3, 0.55);
            addPts(a, pts, a.b, S * 1.0, 0, 0, 0.7);
            if (Math.random() < 0.7) { var m = pts.length / 2, at = 1 + Math.floor(Math.random() * Math.max(1, m - 2)), ba = ang + (Math.random() < 0.5 ? -1 : 1) * rnd(0.5, 1.1), bl = a.l * rnd(0.3, 0.6);
              addPts(a, path(pts[at * 2], pts[at * 2 + 1], pts[at * 2] + Math.cos(ba) * bl, pts[at * 2 + 1] + Math.sin(ba) * bl, 2, 0.6), a.b * 0.6, S * 0.8, 0, 0, 0.8); }
            return true;
          };
          a.make(a); a.next = elapsed + a.every; stats.spark++;
        }
      }
    }
    function poisson(m) { var n = 0, L = Math.exp(-m), p = Math.random(); while (p > L && n < 8) { n++; p *= Math.random(); } return n; }
    function ambient(dt) {                     // tiny distant flickers in the static; with people there, some drift in close to them
      var cnt = poisson(FLICKERS * dt);
      for (var k = 0; k < cnt; k++) {
        var x = Math.random() * W, y = Math.random() * H, ok = true;
        if (persons.length) {                   // keep the far flickers off people (cell distance through the registration)
          var kk = kit.fromScreen(x / W, y / H);
          if (kk) { var cx = Math.floor(kk[0] / 4), cy = Math.floor(kk[1] / 4); if (cx >= 0 && cx < BW && cy >= 0 && cy < BH && dist[cy * BW + cx] < 9) ok = false; }
        }
        if (!ok) continue;
        var ang = Math.random() * 6.283, l = rnd(12, 34) * S, a = newArc(K_AMB, 0.06, 0.25, 0);
        var pts = path(x, y, x + Math.cos(ang) * l, y + Math.sin(ang) * l, 3, 0.6);
        addPts(a, pts, (persons.length ? rnd(0.05, 0.07) : rnd(0.10, 0.15)) * FIELD * (persons.length ? 1 : wallK), S * 0.85, 0, 0, 0.5);   // quieter while people are here
        if (Math.random() < 0.5) { var m = pts.length / 2, at = 1 + Math.floor(Math.random() * Math.max(1, m - 2)), ba = ang + rnd(-1.2, 1.2);
          addPts(a, path(pts[at * 2], pts[at * 2 + 1], pts[at * 2] + Math.cos(ba) * l * 0.5, pts[at * 2 + 1] + Math.sin(ba) * l * 0.5, 2, 0.6), (persons.length ? 0.04 : 0.08) * FIELD * (persons.length ? 1 : wallK), S * 0.7, 0, 0, 0.6); }
        stats.amb++;
      }
    }

    var sheets = [{t0: -99, x: 0, y: 0, r: 0.3, peak: 0}, {t0: -99, x: 0, y: 0, r: 0.3, peak: 0}], nextSheet = 3, sheetU = new Float32Array(8);
    function sheetLight() {                   // a distant glow inside a charge cloud every few seconds: slow, soft, local
      if (elapsed >= nextSheet) {
        var sh = sheets[0].t0 < sheets[1].t0 ? sheets[0] : sheets[1];
        sh.t0 = elapsed; sh.x = rnd(0.1, 0.9) * W / H; sh.y = rnd(0.1, 0.9); sh.r = rnd(0.18, 0.32); sh.peak = rnd(0.6, 1.0);
        nextSheet = elapsed + rnd(5, 11);
      }
      for (var i = 0; i < 2; i++) {
        var sh2 = sheets[i], t = elapsed - sh2.t0, e = t < 0 ? 0 : (1 - Math.exp(-t / 0.18)) * Math.exp(-t / 0.9) * (0.85 + 0.15 * Math.sin(t * 11 + i));
        sheetU[i * 4] = sh2.x; sheetU[i * 4 + 1] = sh2.y; sheetU[i * 4 + 2] = sh2.r; sheetU[i * 4 + 3] = e * sh2.peak * FIELD * (persons.length ? 0.5 : 1);
      }
    }

    // ------------------------------------------------------------ fingertips: your charge grounds into the wall
    var tips = [], landings = [];
    // Sparse mouse/HTTP wakes belong to this piece, never to the host's
    // authoritative fingers/touches. Each point expires on its own clock.
    var wakeTips = [], WAKE_MS = 160;
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
    function nearestOutline(x, y, maxD) {
      var best = -1, bd = maxD * maxD, who = null;
      for (var p = 0; p < persons.length; p++) { var P = persons[p];
        if (boxDist(x, y, P) > maxD) continue;
        for (var i = P.s; i < P.e; i++) { var dx = BX[i] - x, dy = BY[i] - y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = i; who = P; } } }
      return best < 0 ? null : {i: best, d: Math.sqrt(bd), P: who};
    }
    function insidePerson(x, y) {
      var kk = kit.fromScreen(x / W, y / H); if (!kk) return false;
      var cx = Math.floor(kk[0] / 4), cy = Math.floor(kk[1] / 4);
      return cx >= 0 && cx < BW && cy >= 0 && cy < BH && body.label[cy * BW + cx] >= 0;
    }
    function ground(x, y, small) {             // a discharge at a fingertip: a bolt from your outline, a branching spread over the wall
      var no = nearestOutline(x, y, 260 * S), c = no ? chargeOf(no.P.id) : 0.5, size = GROUND * (small ? 0.22 + 0.25 * c : 0.5 + 0.75 * c);
      var a = newArc(K_GROUND, 0.13, 1.4, 0.4), away; a.scorch = small ? 0.35 : 0.9;
      if (no) {
        away = Math.atan2(y - BY[no.i], x - BX[no.i]);
        if (no.d > 14 * S && !insidePerson(x, y)) bolt(a, BX[no.i], BY[no.i], x, y, small ? 0.8 : 1.35, S * (small ? 1.2 : 1.9), small ? 0 : 1, JAG);
        if (!small && charges[no.P.id]) { charges[no.P.id].c = 0.03; charges[no.P.id].grounded = elapsed + 0.25; }
      } else away = Math.random() * 6.283;
      var spread = no ? 2.3 : 3.14, nb = Math.round((small ? 3 : 5) + 4 * size), budget = 0;
      for (var k = 0; k < nb && budget < 900; k++) {
        var ang = away + spread * ((k + 0.5) / nb * 2 - 1) + rnd(-0.25, 0.25);
        budget += grow(a, x, y, ang, (40 + 150 * size) * S * rnd(0.6, 1.25), (small ? 0.7 : 1.2), S * (small ? 1.0 : 1.5), 0, 0);
      }
      stats[small ? 'tip' : 'ground']++; if (!small) grounds++;
    }
    function grow(a, x, y, ang, len, b, w, depth, rev) {   // a Lichtenberg branch: wandering steps, forking as it goes, spreading outward in time
      var step = 11 * S, n = 0, walked = 0, speed = 3600 * S;
      while (walked < len && n < 60) {
        ang += rnd(-0.55, 0.55);
        var l = step * rnd(0.7, 1.3), nx = x + Math.cos(ang) * l, ny = y + Math.sin(ang) * l, f = 1 - walked / len;
        a.s.push(x, y, nx, ny, b * (0.35 + 0.65 * f), w * (0.5 + 0.5 * f), rev + walked / speed); a.n++; n++;
        if (depth < 3 && Math.random() < 0.22) n += grow(a, x, y, ang + (Math.random() < 0.5 ? -1 : 1) * rnd(0.4, 1.0), (len - walked) * rnd(0.35, 0.7), b * 0.7, w * 0.7, depth + 1, rev + walked / speed);
        x = nx; y = ny; walked += l;
      }
      return n;
    }
    function fingers() {
      var pts = fingerPts(), now = elapsed, i, j;
      for (i = 0; i < tips.length; i++) tips[i].hit = false;
      for (j = 0; j < pts.length; j++) {
        var p = pts[j]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var x = p[0] * W, y = p[1] * H, best = null, bd = 0.07 * W;
        for (i = 0; i < tips.length; i++) { if (tips[i].hit) continue; var d = Math.hypot(tips[i].x - x, tips[i].y - y); if (d < bd) { bd = d; best = tips[i]; } }
        if (best) { best.x = x; best.y = y; best.last = now; best.hit = true; continue; }
        var nt = {x: x, y: y, last: now, born: now, hit: true, next: now + rnd(0.35, 0.55)};
        tips.push(nt);
        var recent = false;                     // rapid taps in one place: only one big discharge per 0.4 s there (no strobing)
        for (i = 0; i < landings.length; i++) if (now - landings[i].t < 0.4 && Math.hypot(landings[i].x - x, landings[i].y - y) < 0.2 * W) recent = true;
        ground(x, y, recent);                   // the landing: same frame
        if (!recent) landings.push({x: x, y: y, t: now});
      }
      for (i = landings.length - 1; i >= 0; i--) if (now - landings[i].t > 1) landings.splice(i, 1);
      for (i = tips.length - 1; i >= 0; i--) {
        var t = tips[i];
        if (!t.hit && now - t.last > 0.2) { tips.splice(i, 1); continue; }
        if (t.hit && now >= t.next) { ground(t.x, t.y, true); t.next = now + rnd(0.35, 0.6); }   // held: small sparks keep finding it
        if (t.hit) tipGlow(t);
      }
    }
    function tipGlow(t) {                      // a held fingertip: a small steady crackle right at the contact point
      var a = newArc(K_TIP, 1e9, 0.05, 0.1);
      for (var k = 0; k < 3; k++) { var ang = Math.random() * 6.283, l = rnd(5, 12) * S;
        addPts(a, path(t.x, t.y, t.x + Math.cos(ang) * l, t.y + Math.sin(ang) * l, 2, 0.6), 0.7, S * 0.9, 0, 0, 0.7); }
    }

    // ------------------------------------------------------------ brightness over a spark's life (a flicker, never a strobe)
    function env(a, t) {
      if (t < 0) return 0;
      var out = Math.max(0, Math.min(1, (a.life - t) / (a.kind === K_GROUND ? 0.5 : 0.12)));
      if (a.kind === K_STEADY || a.kind === K_TIP) return Math.min(1, t / 0.04) * out * (0.78 + 0.22 * Math.sin(elapsed * 23 + a.seed) * Math.sin(elapsed * 9.3 + a.seed));
      var rise = 1 - Math.exp(-t / 0.012), fl = 0.8 + 0.2 * Math.sin(t * 53 + a.seed) * Math.sin(t * 29 + a.seed * 1.7);
      if (a.kind === K_PAIR) return rise * out * (0.72 + 0.28 * Math.sin(t * 61 + a.seed) * Math.sin(t * 37 + a.seed * 1.3));
      if (a.kind === K_GROUND) return rise * (0.6 * Math.exp(-t / 0.13) + 0.4 * Math.exp(-t / 0.45)) * out * fl;
      return rise * Math.exp(-t / a.tau) * out * fl;
    }
    function pack() {
      var n = 0;
      for (var i = arcs.length - 1; i >= 0; i--) {
        var a = arcs[i], t = elapsed - a.t0;
        if (t > a.life) { arcs.splice(i, 1); continue; }
        if (a.make && elapsed >= a.next) {    // a living spark re-forms its path: it crackles in place
          var keep = {s: a.s, n: a.n}; a.s = []; a.n = 0;
          if (!a.make(a)) { a.s = keep.s; a.n = keep.n; }
          a.next = elapsed + a.every;
        }
        var e = env(a, t); if (e < 0.004) continue;
        var s = a.s, reveal = a.kind === K_GROUND;
        for (var k = 0; k < a.n && n < MAX_SEGS; k++) {
          var o = k * 7, r = 1;
          if (reveal) { r = Math.max(0, Math.min(1, (t - s[o + 6]) / 0.015)); if (r <= 0) continue; }
          var j = n * 8;
          inst[j] = s[o]; inst[j + 1] = s[o + 1]; inst[j + 2] = s[o + 2]; inst[j + 3] = s[o + 3];
          inst[j + 4] = s[o + 4] * e * r; inst[j + 5] = Math.max(0.6, s[o + 5]); inst[j + 6] = a.burn; inst[j + 7] = a.scorch || 0; n++;
        }
      }
      if (arcs.length > 400) arcs.splice(0, arcs.length - 400);
      return n;
    }

    // ------------------------------------------------------------ the frame
    var elapsed = 0, frames = 0, cpuMs = 0, cpuN = 0, hadPeople = false;
    function pass(fb, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); }
    function bindTex(unit, t, loc) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); }
    function frame(dt, now) {
      if (destroyed) return;
      var c0 = performance.now();
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); elapsed += dt; frames++;
      sizeBuffers(canvas.width, canvas.height);
      var fresh = body.update(dt, now);
      if (fresh || (!body.fresh && hadPeople)) { shapes(); hadPeople = body.people.length > 0; }
      if (!body.fresh) { persons = []; pairs = {}; charges = {}; }
      if (dt > 0) { charge(dt); pairArcs(dt); outlineSparks(dt); ambient(dt); fingers(); }
      sheetLight();
      segCount = pack();
      cpuMs += performance.now() - c0; cpuN++;

      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      // sparks -> arc buffer (max blend: a joint never doubles up)
      pass(arcF, W, H); gl.bindVertexArray(triVao); gl.useProgram(pCor.p);   // the outline first (it fills the whole buffer)
      bindTex(0, bodyTex, pCor.u.uBody); gl.uniformMatrix3fv(pCor.u.uHinv, false, body.hinv());
      gl.uniform1f(pCor.u.uTime, elapsed); gl.uniform1f(pCor.u.uAspect, W / Math.max(1, H)); gl.uniform1f(pCor.u.uPx, S);
      gl.uniform1f(pCor.u.uCorona, CORONA); gl.uniform1f(pCor.u.uBase, CORONA_BASE);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
      if (segCount) {
        gl.bindBuffer(gl.ARRAY_BUFFER, segBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, segCount * 8); gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(pSeg.p); gl.uniform2f(pSeg.u.uRes, W, H);
        gl.bindVertexArray(segVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segCount); gl.bindVertexArray(null);
        gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
      }
      gl.bindVertexArray(triVao);
      // afterglow
      var tn = 1 - ti;
      pass(trailF[tn], tw, th); gl.useProgram(pTrail.p);
      bindTex(0, trail[ti], pTrail.u.uPrev); bindTex(1, burnT, pTrail.u.uBurn);
      gl.uniform2f(pTrail.u.uTx, 1 / W, 1 / H); gl.uniform2f(pTrail.u.uDecay, Math.exp(-dt / AFTERGLOW_S), Math.exp(-dt / SCORCH_S));
      gl.drawArrays(gl.TRIANGLES, 0, 3); ti = tn;
      // bloom: quarter and eighth size
      pass(qF[0], qw, qh); gl.useProgram(pDown.p); bindTex(0, arcT, pDown.u.uSrc); gl.uniform2f(pDown.u.uTx, 1 / W, 1 / H); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(pBlur.p);
      pass(qF[1], qw, qh); bindTex(0, qT[0], pBlur.u.uSrc); gl.uniform2f(pBlur.u.uDir, 1 / qw, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(qF[0], qw, qh); bindTex(0, qT[1], pBlur.u.uSrc); gl.uniform2f(pBlur.u.uDir, 0, 1 / qh); gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(eF[0], ew, eh); gl.useProgram(pDown.p); bindTex(0, qT[0], pDown.u.uSrc); gl.uniform2f(pDown.u.uTx, 1 / qw, 1 / qh); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(pBlur.p);
      pass(eF[1], ew, eh); bindTex(0, eT[0], pBlur.u.uSrc); gl.uniform2f(pBlur.u.uDir, 1 / ew, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      pass(eF[0], ew, eh); bindTex(0, eT[1], pBlur.u.uSrc); gl.uniform2f(pBlur.u.uDir, 0, 1 / eh); gl.drawArrays(gl.TRIANGLES, 0, 3);
      // the picture, on the screen
      pass(null, W, H); gl.useProgram(pComp.p);
      bindTex(0, bodyTex, pComp.u.uBody); bindTex(1, arcT, pComp.u.uArc); bindTex(2, qT[0], pComp.u.uQ); bindTex(3, eT[0], pComp.u.uE); bindTex(4, trail[ti], pComp.u.uTrail);
      gl.uniformMatrix3fv(pComp.u.uHinv, false, body.hinv());
      gl.uniform1f(pComp.u.uTime, elapsed); gl.uniform1f(pComp.u.uAspect, W / Math.max(1, H)); gl.uniform1f(pComp.u.uPx, S);
      gl.uniform1f(pComp.u.uDark, DARK_INSIDE); gl.uniform1f(pComp.u.uField, FIELD); gl.uniform1f(pComp.u.uWall, wallK); gl.uniform1f(pComp.u.uBloom, BLOOM); gl.uniform1f(pComp.u.uH, H);
      gl.uniform4fv(pComp.u.uSheet, sheetU);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    }
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.StaticSet === set) delete window.StaticSet;
      if (window.StaticWake === wake) delete window.StaticWake; kit.wantDepth(false);
      made.fb.forEach(function (f) { gl.deleteFramebuffer(f); }); made.tex.forEach(function (t) { gl.deleteTexture(t); });
      made.prog.forEach(function (p) { gl.deleteProgram(p); }); made.buf.forEach(function (b) { gl.deleteBuffer(b); });
      made.vao.forEach(function (v) { gl.deleteVertexArray(v); });
      made = {tex: [], fb: [], prog: [], buf: [], vao: []}; arcs = []; pairs = {}; charges = {}; persons = []; tips = []; wakeTips = [];
      if (window.__staticDebug) try { delete window.__staticDebug; } catch (e) { window.__staticDebug = undefined; }
    }
    kit.wantDepth(true);
    if (window.WallTest) window.__staticDebug = function () {   // sandbox only (the live wall has no WallTest)
      var pl = [], kinds = {}, i;
      for (var key in pairs) { var pr = pairs[key]; pl.push({key: key, gap: Math.round(pr.d / S), strikes: pr.strikes, steady: pr.d < STEADY_PX * S, contact: pr.d < CONTACT_PX * S}); }
      for (i = 0; i < arcs.length; i++) kinds[arcs[i].kind] = (kinds[arcs[i].kind] || 0) + 1;
      var out = {frames: frames, elapsed: +elapsed.toFixed(2), people: persons.map(function (P) { return {id: P.id, outline: P.e - P.s, charge: +chargeOf(P.id).toFixed(3), cx: +(P.cx / W).toFixed(3), cy: +(P.cy / H).toFixed(3), area: P.area}; }),
        bodyPeople: body.people.map(function (p) { return {id: p.id, area: p.area}; }),
        pairs: pl, arcs: arcs.length, kinds: kinds, segs: segCount, stats: JSON.parse(JSON.stringify(stats)), grounds: grounds, tips: tips.length,
        fresh: body.fresh, regOk: regOk, cpuMs: cpuN ? +(cpuMs / cpuN).toFixed(3) : null, foldMs: +body.foldMs.toFixed(2), glError: gl.getError()};
      cpuMs = 0; cpuN = 0;
      return out;
    };
    function set(opts) {
      if (!opts || destroyed) return {reach: REACH_PX, strikes: STRIKES_FAR, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.reach)) REACH_PX = Math.max(150, Math.min(700, opts.reach));
      if (Number.isFinite(opts.strikes)) STRIKES_FAR = Math.max(0.2, Math.min(2, opts.strikes));
      return {reach: REACH_PX, strikes: STRIKES_FAR, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy) || sx < 0 || sx > 1 || sy < 0 || sy > 1) return;
      rememberWake(sx, sy);
    }
    window.StaticSet = set;
    window.StaticWake = wake;
    if (window._staticFx) set(window._staticFx);

    return {frame: frame, destroy: destroy, resize: function (w, h) { sizeBuffers(w, h); }};
  }
})();
