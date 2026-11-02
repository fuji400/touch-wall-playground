/* Iron Filings — a black sheet dusted with steel filings; every person is a magnet          (fx-research concept #9)
 *
 * The idea. The wall is a sheet dusted with ~80,000 short steel filings. Under it a hidden bar magnet drifts and slowly turns,
 * so with nobody there the filings lie combed into its field: the classic school picture, two bristly poles and the loops
 * between them, slowly changing shape. Every person in front of the wall is a magnet pole:
 *   - step in and the filings around you swivel at once, stand up and bristle out of your outline like fur;
 *     the ones nearby slide in and pile up along your edge (stand still and the fur thickens);
 *   - a pole is north on the left half of the wall and south on the right half. Two people on opposite halves: arcs of filings
 *     bridge between you, straw-warm at the north end and steel-blue at the south; step apart and the bridge snaps (the filings
 *     shiver and drop back into the sheet). Two people on the same half push the lines apart and leave a calm gap between them;
 *   - a fingertip on the wall is a small strong pole: filings leap into a star around it;
 *   - step away and the light goes at once, but the filings stay lying the way your magnet combed them (a bridge stays drawn
 *     on the sheet for a while); the hidden magnet slowly re-combs them, and the sheet keeps itself evenly dusted by lifting
 *     resting filings and dropping them elsewhere (so piles melt away over about a minute);
 *   - something perfectly still for half a minute (a chair by the wall) calms down; any movement wakes it at once.
 * Nothing is projected inside a person (DARK_INSIDE): filings under you stay where they are, hidden; the light is at your
 * outline and beyond.
 *
 * How. Filings are a WebGL 2 particle system: position, angle and "energy" (how much the filing stands up) in a float texture,
 * stepped in a fragment shader, drawn as thin additive dashes. The people's field is a direct sum over charges on their
 * outlines (from the shared body stage, WallBody: outline cells of each separate person, weighted toward tips such as hands
 * and head, mapped to the wall through the registration), summed on the GPU into a 256 x 160 field texture on each depth frame.
 * The hidden magnet and fingertips are added analytically per filing. Filings rotate toward the total field (fast where the
 * people's field beats the sheet's friction, slowly elsewhere), slide toward the people's stronger field, and gather sideways
 * into chains along the field lines (they sense a small density map), which is what draws the lines.
 * Needs plugins/body.js (WallBody). WebGL 2 + EXT_color_buffer_float, no assets, no audio, one depth client (via the host).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  var FILINGS_W = 320, FILINGS_H = 256;  // filing count = W x H (81,920 filings)
  var FILING_PX = 7.5;                   // length of a filing in pixels on a 1280-wide picture (each varies 0.6x-1.4x)
  var FILING_WIDTH_PX = 0.75;            // half-thickness of a filing (px)
  var STAND = 0.9;                       // how much longer a filing looks when it stands up near a magnet (0.9 = 1.9x)

  var PERSON_Q = 6.0;                    // magnet strength of one person (bigger = filings react further from you)
  var FRICTION = 1.1;                    // the sheet's friction: field strength where filings start to stir...
  var FRICTION_FULL = 2.6;               // ...and where they swivel and stand up fully
  var TIP_BOOST = 1.0;                   // extra pull at the tips of a silhouette (hands, head, elbows); 0 = even all round
  var REACH_FALLOFF = 0.035;             // beyond about this distance (wall heights) a person's field fades faster (keeps it local)
  var POLE_SPLIT = 0.5, POLE_HYST = 0.05;  // the line between north (left) and south (right) poles, and the band you can stand in
                                         // without flipping (a pole only flips once you are this far past the line)
  var TIP_Q = 0.8;                       // a fingertip's magnet strength
  var TIP_REACH = 0.09;                  // ...and how quickly it fades (wall heights)
  var TIP_CORE = 0.022;                  // the star's empty middle: filings gather outside this radius (wall heights)
  var TIP_PULL = 0.035;                  // how fast filings leap toward a fingertip (wall heights / s)
  var TIP_ATTACK_S = 0.05, TIP_RELEASE_S = 0.3;   // a fingertip pole switches on / fades after the finger lifts

  var SWIVEL = 16;                       // how fast filings turn to a person's field (1/s)
  var IDLE_COMB = 0.10;                  // how fast the whole sheet re-combs itself to the hidden magnet (1/s; 0.1 = ~10 s)
  var IDLE_WEIGHT = 0.55;                // the hidden magnet's say in the direction, next to people's field (in FRICTION units)
  var ATTACK_S = 0.035, RELEASE_S = 0.3;   // filings stand up / lie back down
  var SNAP = 1.0;                        // when a field vanishes fast (a bridge breaking): how hard the filings shiver as they drop
                                         // (they stay lying the way the field left them: the lines you made stay on the sheet)
  var GATHER = 0.012;                    // how fast filings slide toward a person's outline (wall heights / s)
  var PUSH_OUT = 0;                      // how fast filings under a person creep out to their edge (wall heights / s). 0 = they stay
                                         // put, hidden under you: anything faster than a slow shuffle ploughs dark empty swaths
                                         // through the sheet wherever people linger (tried 1.2 and 0.06, both left voids)
  var CHAIN = 0.035;                     // how strongly filings gather sideways into chains (the visible field lines)
  var CHAIN_SPACING = 0.0085;            // distance a filing looks sideways for neighbours (wall heights; ~2x = line spacing)
  var JITTER = 0.0025;                   // a little restlessness everywhere (wall heights / sqrt s)
  var REDUST_S = 40;                     // the sheet keeps itself fresh: a resting filing is lifted and dropped somewhere else on
                                         // the sheet about this often (seconds), fading in, already lying along the field. Piles
                                         // and empty shadows people leave behind melt back into even lines over about a minute
  var SPREAD = 0.012;                    // how fast resting filings flow from crowded patches into bare ones (wall heights / s)

  var MAG_HALF = 0.22;                   // the hidden bar magnet: half its length (wall heights)...
  var MAG_DRIFT = 1.0;                   // ...and how fast it wanders and turns (1 = a full turn in ~4 minutes)

  var IDLE_LIGHT = 0.05;                 // brightness of a resting filing
  var IDLE_CAP = 0.265;                  // the most light resting filings may add up to (so piles and the empty wall stay quiet)
  var GLINT = 0.10;                      // a few filings catch the light more than others
  var ENERGY_LIGHT = 0.095;              // brightness of a standing filing near a magnet (adds up where they crowd)
  var EXPOSURE = 2.6;                    // tone curve for the standing filings
  var POLE_TINT = 0.45;                  // straw (north) / steel-blue (south) tint of standing filings (0 = plain silver)
  var BLOOM = 0.22;                      // the soft glow around standing filings
  var STILL_CALM_S = 30;                 // a part of the wall where nothing has changed for this long calms down...
  var STILL_CALM_LEVEL = 0.4;            // ...to this share of its pull (so a chair left by the wall cannot glow forever; a real
                                         // person who moves again is back to full strength at once)
  var STALL_HOLD_S = 0.6;                // the depth camera pausing this long or less keeps every pole as it was
  var DARK_INSIDE = 1.0;                 // no light inside a person (1 = none, 0 = off)

  // ---------------------------------------------------------------- fixed sizes
  var MAXC = 320;                         // charges on all outlines together (subsampled to fit)
  var FW = 256, FH = 160;                 // the people's field texture
  var BW = 128, BH = 106;                 // body cells (WallBody)

  registerWallPlugin({id: 'ironfilings', title: 'Iron Filings', author: 'Claude (fx-batch), fx-research concept #9', create: create});

  var GLSL_HASH =
    'uint hsh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }\n' +
    'float u01(uint x) { return float(hsh(x) >> 8) * (1.0 / 16777216.0); }\n';
  var VS_TRI = '#version 300 es\nout vec2 vUv;\nvoid main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }\n';

  // the people's field: a direct sum over the outline charges (x, y in wall heights, y down; q signed: + north, - south)
  var FS_FIELD =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uCh; uniform int uN; uniform float uAspect, uEps, uR0, uR1;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'void main() {\n' +
    '  vec2 P = vec2(vUv.x * uAspect, 1.0 - vUv.y), B = vec2(0.0); float pot = 0.0;\n' +
    '  for (int i = 0; i < ' + MAXC + '; i++) { if (i >= uN) break;\n' +
    '    vec4 c = texelFetch(uCh, ivec2(i, 0), 0);\n' +
    '    vec2 d = P - c.xy; float rs = sqrt(dot(d, d) + uEps * uEps);\n' +
    '    B += c.z * d * (uR0 / (rs * rs * (rs + uR0)));\n' +
    '    pot += c.z / (1.0 + rs / uR1);\n' +
    '  }\n' +
    '  o = vec4(B, pot, 0.0);\n' +
    '}\n';

  // where the filings are, as a small density map (they look sideways in it to gather into chains)
  var VS_DENS =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uState;\n' +
    'void main() { int i = gl_VertexID; vec4 s = texelFetch(uState, ivec2(i % ' + FILINGS_W + ', i / ' + FILINGS_W + '), 0);\n' +
    '  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0); gl_PointSize = 2.0; }\n';
  var FS_DENS = '#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(1.0, 0.0, 0.0, 0.0); }\n';

  var GLSL_COMMON =
    'uniform float uAspect, uMagHalf, uMagSoft, uBodyGain, uTipEps, uTipR0;\n' +
    'uniform vec4 uMag;\n' +                            // hidden magnet: centre (wall heights), angle
    'uniform vec4 uTips[4]; uniform int uTipN;\n' +    // fingertips: x, y (wall heights), q (signed), strength 0..1
    'vec2 idleField(vec2 P) {\n' +
    '  vec2 m = vec2(cos(uMag.z), sin(uMag.z)) * uMagHalf, a = P - (uMag.xy + m), b = P - (uMag.xy - m);\n' +
    '  float ra = dot(a, a) + uMagSoft * uMagSoft, rb = dot(b, b) + uMagSoft * uMagSoft;\n' +
    '  return a / (ra * sqrt(ra)) - b / (rb * sqrt(rb));\n' +
    '}\n' +
    'vec2 tipField(vec2 P, out float pot) {\n' +
    '  vec2 B = vec2(0.0); pot = 0.0;\n' +
    '  for (int i = 0; i < 4; i++) { if (i >= uTipN) break;\n' +
    '    vec2 d = P - uTips[i].xy; float rs = sqrt(dot(d, d) + uTipEps * uTipEps);\n' +
    '    B += uTips[i].z * d * (uTipR0 / (rs * rs * (rs + uTipR0)));\n' +
    '    pot += uTips[i].z * 6.0 / (1.0 + rs / uTipR0);\n' +
    '  }\n' +
    '  return B;\n' +
    '}\n';

  // one step of every filing: (x, y) window 0..1 y down, angle (radians, filings have no head so it lives in -pi/2..pi/2), energy
  var FS_STEP =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uState, uField, uDens, uBody;\n' +
    'uniform mat3 uHinv;\n' +
    'uniform float uDt, uT0, uT1, uIdleRate, uFastRate, uIdleW, uAttack, uRelease, uSnap, uGather, uPush, uClump, uClumpD,\n' +
    '  uJit, uHeal, uSpread, uDensLod, uTopLod, uTipCore, uTipPull;\n' +
    'uniform vec2 uFieldTexel;\n' +
    'uniform uint uFrame;\n' +
    'out vec4 o;\n' +
    'const float PI = 3.14159265;\n' + GLSL_HASH + GLSL_COMMON +
    'vec4 bodyAt(vec2 q) { vec3 h = uHinv * vec3(q, 1.0); vec2 k = h.xy / max(h.z, 1e-6);\n' +
    '  if (h.z <= 0.0 || k.x < 0.0 || k.x > 1.0 || k.y < 0.0 || k.y > 1.0) return vec4(0.0, 40.0, 0.0, 0.0);\n' +
    '  return texture(uBody, k); }\n' +
    'float fieldMag(vec2 q) { return length(texture(uField, vec2(q.x, 1.0 - q.y)).xy) * uBodyGain; }\n' +
    'void main() {\n' +
    '  ivec2 ij = ivec2(gl_FragCoord.xy);\n' +
    '  vec4 s = texelFetch(uState, ij, 0);\n' +
    '  vec2 q = s.xy; float th = s.z, e = max(s.w, 0.0), land = min(s.w, 0.0);\n' +
    '  vec2 P = vec2(q.x * uAspect, q.y);\n' +
    '  uint seed = hsh(uint(ij.x) + uint(ij.y) * 4096u) ^ (uFrame * 0x9E3779B9u);\n' +
    '  float r1 = max(u01(seed), 1e-7), r2 = u01(seed ^ 0x68bc21ebu), r3 = max(u01(seed ^ 0x2c1b3c6du), 1e-7), r4 = u01(seed ^ 0x297a2d39u);\n' +
    '  vec2 g1 = sqrt(-2.0 * log(r1)) * vec2(cos(2.0 * PI * r2), sin(2.0 * PI * r2));\n' +
    '  vec2 g2 = sqrt(-2.0 * log(r3)) * vec2(cos(2.0 * PI * r4), sin(2.0 * PI * r4));\n' +
    // the field here: people (from the field texture), fingertips, and the hidden magnet (direction only, a fixed small weight)
    '  vec2 Bp = texture(uField, vec2(q.x, 1.0 - q.y)).xy * uBodyGain;\n' +
    '  float tpot; vec2 Bt = tipField(P, tpot);\n' +
    '  vec2 Bpt = Bp + Bt; float S = length(Bpt);\n' +
    '  vec2 Bi = idleField(P);\n' +
    '  vec2 Btot = Bpt + Bi / max(length(Bi), 1e-9) * uIdleW;\n' +
    '  float act = smoothstep(uT0, uT1, S);\n' +
    '  float snap = max(0.0, e - act - 0.15) * uSnap;\n' +   // a field that vanished faster than the filings could lie down
    '  e += (act - e) * (1.0 - exp(-uDt / (act > e ? uAttack : uRelease)));\n' +
    '  land = min(0.0, land + uDt / 0.8);\n' +
    // turn toward the field (a filing has no head: the nearer of the two ends)
    '  float phi = atan(Btot.y, Btot.x), dth = phi - th; dth -= PI * floor(dth / PI + 0.5);\n' +
    '  float rate = uIdleRate + uFastRate * act;\n' +
    '  th += dth * (1.0 - exp(-rate * uDt)) + g1.x * (0.04 + 0.8 * snap) * sqrt(uDt);\n' +
    '  th -= PI * floor(th / PI + 0.5);\n' +
    '  vec2 v = vec2(0.0);\n' +
    // slide toward the stronger part of a person's field (they pile up along the outline)
    '  if (act > 0.01) {\n' +
    '    vec2 dq = uFieldTexel;\n' +
    '    vec2 gS = vec2((fieldMag(q + vec2(dq.x, 0.0)) - fieldMag(q - vec2(dq.x, 0.0))) / (2.0 * dq.x * uAspect),\n' +
    '                   (fieldMag(q + vec2(0.0, dq.y)) - fieldMag(q - vec2(0.0, dq.y))) / (2.0 * dq.y));\n' +
    '    v += gS / max(length(gS), 8.0) * uGather * act;\n' +
    '  }\n' +
    // and leap toward a fingertip, stopping short of its core (a star, not a dot)
    '  float nearTip = 0.0;\n' +
    '  for (int i = 0; i < 4; i++) { if (i >= uTipN) break;\n' +
    '    vec2 d = uTips[i].xy - P; float r = length(d);\n' +
    '    float w = uTips[i].w * (1.0 - smoothstep(uTipR0 * 0.6, uTipR0 * 1.6, r)); nearTip = max(nearTip, w);\n' +
    '    v += d / max(r, 1e-4) * uTipPull * w * (smoothstep(uTipCore * 0.9, uTipCore * 1.6, r) - 0.6 * (1.0 - smoothstep(0.0, uTipCore * 0.9, r)));\n' +
    '  }\n' +
    // gather sideways into chains: move toward the side with more filings
    '  vec2 t = vec2(cos(th), sin(th)), n = vec2(-t.y, t.x), nq = vec2(n.x / uAspect, n.y) * uClumpD;\n' +
    '  float Dp = textureLod(uDens, vec2(q.x + nq.x, 1.0 - q.y - nq.y), 0.0).r, Dm = textureLod(uDens, vec2(q.x - nq.x, 1.0 - q.y + nq.y), 0.0).r;\n' +
    '  v += n * uClump * (1.0 + 0.5 * e) * (1.0 - 0.8 * nearTip) * (Dp - Dm) / (Dp + Dm + 1.0);\n' +
    // creep out from under a person (their outline distance, through the registration), slower than a walk
    '  vec4 b = bodyAt(q);\n' +
    '  if (b.g < 2.0) {\n' +
    '    const float ex = 0.004;\n' +
    '    vec2 gb = vec2((bodyAt(q + vec2(ex, 0.0)).g - bodyAt(q - vec2(ex, 0.0)).g) / (2.0 * ex * uAspect),\n' +
    '                   (bodyAt(q + vec2(0.0, ex)).g - bodyAt(q - vec2(0.0, ex)).g) / (2.0 * ex));\n' +
    '    v += gb / max(length(gb), 1e-4) * uPush * (1.0 - smoothstep(-1.5, 1.0, b.g));\n' +
    '  }\n' +
    // resting filings flow slowly from crowded patches into bare ones (coarse density, so the chains themselves are not undone)
    '  if (e < 0.3) {\n' +
    '    vec2 cq = vec2(exp2(uDensLod) / float(textureSize(uDens, 0).x), exp2(uDensLod) / float(textureSize(uDens, 0).y));\n' +
    '    float mean = max(textureLod(uDens, vec2(0.5), uTopLod).r, 1e-3);\n' +
    '    vec2 gD = vec2(textureLod(uDens, vec2(q.x + cq.x, 1.0 - q.y), uDensLod).r - textureLod(uDens, vec2(q.x - cq.x, 1.0 - q.y), uDensLod).r,\n' +
    '                   textureLod(uDens, vec2(q.x, 1.0 - q.y - cq.y), uDensLod).r - textureLod(uDens, vec2(q.x, 1.0 - q.y + cq.y), uDensLod).r) / mean;\n' +
    '    v -= clamp(gD, -1.5, 1.5) * uSpread * (1.0 - e / 0.3);\n' +
    '  }\n' +
    '  P += v * uDt + g2 * uJit * (1.0 + 1.0 * e + 3.0 * snap) * sqrt(uDt);\n' +
    '  q = vec2(P.x / uAspect, P.y);\n' +
    '  if (!(q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) || isnan(th) || isinf(th)) {\n' +   // off the sheet: sprinkled back in
    '    q = vec2(u01(seed ^ 0x1b873593u), u01(seed ^ 0xcc9e2d51u)); vec2 bi = idleField(vec2(q.x * uAspect, q.y)); th = atan(bi.y, bi.x); th -= PI * floor(th / PI + 0.5); e = 0.0; land = -1.0;\n' +
    '  } else if (u01(seed ^ 0x85ebca6bu) < uHeal * uDt && e < 0.03 && land == 0.0) {\n' +   // re-dust: a resting filing lifts and lands elsewhere
    '    vec2 tq = vec2(u01(seed ^ 0x27d4eb2fu), u01(seed ^ 0x165667b1u));\n' +
    '    if (bodyAt(tq).g > 3.0) {\n' +
    '      q = tq; vec2 bi = idleField(vec2(q.x * uAspect, q.y)); th = atan(bi.y, bi.x) + g1.y * 0.15; th -= PI * floor(th / PI + 0.5); e = 0.0; land = -1.0; }\n' +
    '  }\n' +
    '  o = vec4(q, th, e > 0.01 || land == 0.0 ? clamp(e, 0.0, 1.0) : land);\n' +
    '}\n';

  // every filing as a thin dash: r = resting light, g = standing light, b = standing light x pole tint (+ north, - south)
  var VS_FIL =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uState, uField;\n' +
    'uniform vec2 uView; uniform float uLenPx, uWidPx, uStand, uIdleB, uGlint, uEnergyB, uPotRef;\n' +
    'out vec3 vL; out vec3 vC;\n' + GLSL_HASH + GLSL_COMMON +
    'void main() {\n' +
    '  int i = gl_VertexID / 6, c = gl_VertexID - i * 6;\n' +
    '  vec4 s = texelFetch(uState, ivec2(i % ' + FILINGS_W + ', i / ' + FILINGS_W + '), 0);\n' +
    '  float h = u01(uint(i) * 2654435761u), h2 = u01(uint(i) * 0x9E3779B9u + 7u);\n' +
    '  float len = uLenPx * (0.6 + 0.8 * h) * (1.0 + uStand * max(s.w, 0.0)) * 0.5 + 1.0, wid = uWidPx + 1.2;\n' +
    '  vec2 k = c == 0 ? vec2(-1.0, -1.0) : c == 1 ? vec2(1.0, -1.0) : c == 2 ? vec2(1.0, 1.0) : c == 3 ? vec2(-1.0, -1.0) : c == 4 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);\n' +
    '  vec2 t = vec2(cos(s.z), sin(s.z)), n = vec2(-t.y, t.x);\n' +
    '  vec2 p = s.xy * uView + t * k.x * len + n * k.y * wid;\n' +
    '  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);\n' +
    '  vL = vec3(k.x * len, k.y * wid, len);\n' +
    '  float tpot; tipField(vec2(s.x * uAspect, s.y), tpot);\n' +
    '  float pot = texture(uField, vec2(s.x, 1.0 - s.y)).z * uBodyGain + tpot;\n' +
    '  float e = max(s.w, 0.0), fade = 1.0 + min(s.w, 0.0);\n' +
    '  vC = vec3((uIdleB * (0.55 + 0.9 * h) + uGlint * pow(h2, 10.0)) * fade, uEnergyB * e * e * (0.35 + 1.3 * h * h), clamp(pot / uPotRef, -1.0, 1.0));\n' +
    '}\n';
  var FS_FIL =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform float uWidPx;\n' +
    'in vec3 vL; in vec3 vC; out vec4 o;\n' +
    'void main() {\n' +
    '  float a = exp(-vL.y * vL.y / (uWidPx * uWidPx * 1.4)) * (1.0 - smoothstep(vL.z - 1.5, vL.z, abs(vL.x)));\n' +
    '  o = vec4(vC.x * a, vC.y * a, vC.y * vC.z * a, 0.0);\n' +
    '}\n';

  var GLSL_TONE =
    'uniform float uExposure, uTint;\n' +
    'vec3 hotColor(vec4 a) {\n' +
    '  float L = 1.0 - exp(-a.g * uExposure);\n' +
    '  float tn = clamp(a.b / max(a.g, 1e-4), -1.0, 1.0);\n' +
    '  vec3 tint = tn > 0.0 ? vec3(1.0, 0.80, 0.52) : vec3(0.55, 0.74, 1.0);\n' +   // straw-tempered / blued steel
    '  return mix(vec3(0.93, 0.96, 1.0), tint, abs(tn) * uTint) * L;\n' +
    '}\n';
  var FS_DOWN =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uSrc; uniform vec2 uTexel;\n' +
    'in vec2 vUv; out vec4 o;\n' + GLSL_TONE +
    'void main() {\n' +
    '  vec4 a = textureLod(uSrc, vUv + uTexel * vec2(-1.0, -1.0), 0.0) + textureLod(uSrc, vUv + uTexel * vec2(1.0, -1.0), 0.0)\n' +
    '         + textureLod(uSrc, vUv + uTexel * vec2(-1.0, 1.0), 0.0) + textureLod(uSrc, vUv + uTexel * vec2(1.0, 1.0), 0.0);\n' +
    '  o = vec4(hotColor(a * 0.25), 1.0);\n' +
    '}\n';
  var FS_BLUR =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uSrc; uniform vec2 uDir;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'void main() {\n' +
    '  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;\n' +
    '  c += (texture(uSrc, vUv + uDir * 1.3846153846).rgb + texture(uSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;\n' +
    '  c += (texture(uSrc, vUv + uDir * 3.2307692308).rgb + texture(uSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;\n' +
    '  o = vec4(c, 1.0);\n' +
    '}\n';
  var FS_COMP =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D uAccum, uGlow, uBody; uniform mat3 uHinv; uniform float uGlowAmt, uIdleCap, uDark;\n' +
    'in vec2 vUv; out vec4 o;\n' + GLSL_TONE +
    'void main() {\n' +
    '  vec4 a = textureLod(uAccum, vUv, 0.0);\n' +
    '  float idle = uIdleCap * (1.0 - exp(-a.r / uIdleCap));\n' +   // resting light saturates softly at the cap: piles stay quiet
    '  vec3 col = vec3(0.74, 0.80, 0.92) * idle + hotColor(a) + texture(uGlow, vUv).rgb * uGlowAmt;\n' +
    '  vec3 h = uHinv * vec3(vUv.x, 1.0 - vUv.y, 1.0); vec2 k = h.xy / max(h.z, 1e-6);\n' +
    '  float m = (h.z > 0.0 && k.x >= 0.0 && k.x <= 1.0 && k.y >= 0.0 && k.y <= 1.0) ? texture(uBody, k).r : 0.0;\n' +
    '  col *= 1.0 - uDark * smoothstep(0.55, 0.85, m);\n' +   // nothing projected inside a person
    '  o = vec4(min(col, vec3(1.0)), 1.0);\n' +
    '}\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Iron Filings needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
                                          preserveDrawingBuffer: false, powerPreference: 'high-performance'});
    if (!gl) throw new Error('Iron Filings needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');
    var wallK = 2.0;                 // 'Empty wall' knob (1 = the 2026-10-05 picture): scales the resting filings' light (and glints) and lifts IDLE_CAP with it; standing filings (ENERGY_LIGHT) are untouched
    var destroyed = false;

    // ------------------------------------------------------------ GL plumbing
    var made = {tex: [], fb: [], prog: [], vao: []};
    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var m = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + m); }
      return s;
    }
    function program(vs, fs) {
      var p = gl.createProgram(), a = shader(gl.VERTEX_SHADER, vs), b = shader(gl.FRAGMENT_SHADER, fs);
      gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p); gl.deleteShader(a); gl.deleteShader(b);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var le = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error('link: ' + le); }
      made.prog.push(p);
      var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (var i = 0; i < n; i++) { var info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
      return {p: p, u: u};
    }
    function texture(w, h, ifmt, fmt, type, filter, data) {
      var t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_NEAREST ? gl.LINEAR : filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      made.tex.push(t);
      return t;
    }
    function target(tex) {
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
      made.fb.push(f);
      return f;
    }
    function forget(list, x) { var i = list.indexOf(x); if (i >= 0) list.splice(i, 1); }
    function dropTex(t) { if (t) { forget(made.tex, t); gl.deleteTexture(t); } }
    function dropFb(f) { if (f) { forget(made.fb, f); gl.deleteFramebuffer(f); } }

    var vao = gl.createVertexArray(); made.vao.push(vao);
    gl.bindVertexArray(vao);
    var pField = program(VS_TRI, FS_FIELD), pDens = program(VS_DENS, FS_DENS), pStep = program(VS_TRI, FS_STEP),
        pFil = program(VS_FIL, FS_FIL), pDown = program(VS_TRI, FS_DOWN), pBlur = program(VS_TRI, FS_BLUR), pComp = program(VS_TRI, FS_COMP);

    // ------------------------------------------------------------ the hidden magnet
    var simT = 0, wallT = 0, frames = 0, steps = 0, aspect = Math.max(0.2, canvas.width / Math.max(1, canvas.height)) || 1.6;
    var TAU = Math.PI * 2;
    function magnet(t) {
      var s = t * MAG_DRIFT;
      return [aspect * (0.5 + 0.20 * Math.sin(s * TAU / 170 + 0.7)), 0.5 + 0.13 * Math.sin(s * TAU / 130 + 2.1),
              0.35 + s * TAU / 240 + 0.5 * Math.sin(s * TAU / 90)];
    }
    function idleAngle(px, py, mg) {             // the same field as idleField() in the shaders
      var mx = Math.cos(mg[2]) * MAG_HALF, my = Math.sin(mg[2]) * MAG_HALF, s2 = 0.04 * 0.04;
      var ax = px - (mg[0] + mx), ay = py - (mg[1] + my), bx = px - (mg[0] - mx), by = py - (mg[1] - my);
      var ra = ax * ax + ay * ay + s2, rb = bx * bx + by * by + s2, fa = 1 / (ra * Math.sqrt(ra)), fb = 1 / (rb * Math.sqrt(rb));
      var th = Math.atan2(ay * fa - by * fb, ax * fa - bx * fb);
      return th - Math.PI * Math.floor(th / Math.PI + 0.5);
    }

    // ------------------------------------------------------------ filings: rgba32f = x, y (window 0..1, y down), angle, energy
    var N = FILINGS_W * FILINGS_H, init = new Float32Array(N * 4), mg0 = magnet(0);
    for (var i = 0; i < N; i++) {
      var x = Math.random(), y = Math.random();
      init[i * 4] = x; init[i * 4 + 1] = y; init[i * 4 + 2] = idleAngle(x * aspect, y, mg0); init[i * 4 + 3] = 0;
    }
    var stTex = [texture(FILINGS_W, FILINGS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init),
                 texture(FILINGS_W, FILINGS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init)];
    init = null;
    var stFb = [target(stTex[0]), target(stTex[1])], cur = 0;

    // the people's field (window space) and its charges
    var fieldTex = texture(FW, FH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR), fieldFb = target(fieldTex);
    var chData = new Float32Array(MAXC * 4), chHeld = new Float32Array(MAXC * 4), chN = 0, chDirty = true;
    var chTex = texture(MAXC, 1, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, chData);
    // the body (Kinect space): r = mask (anyone in front of the wall), g = outline distance in cells (+ outside, - inside)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var bodyData = new Float32Array(BW * BH * 2);
    for (var bi = 0; bi < BW * BH; bi++) bodyData[bi * 2 + 1] = 40;
    var bodyTex = texture(BW, BH, gl.RG16F, gl.RG, gl.FLOAT, gl.LINEAR, bodyData);

    // screen-sized buffers: the filings' light, its glow, the density map
    var W = 0, H = 0, accTex = null, accFb = null, glow = [null, null], glowFb = [null, null], GW = 0, GH = 0;
    var densTex = null, densFb = null, DW = 0, DH = 0, topLod = 0, densLod = 0;
    function sizeBuffers(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (w === W && h === H) return;
      dropFb(accFb); dropTex(accTex); dropFb(densFb); dropTex(densTex);
      for (var j = 0; j < 2; j++) { dropFb(glowFb[j]); dropTex(glow[j]); }
      W = w; H = h; aspect = W / H;
      accTex = texture(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); accFb = target(accTex);
      GW = Math.max(1, Math.round(W / 4)); GH = Math.max(1, Math.round(H / 4));
      for (var j2 = 0; j2 < 2; j2++) { glow[j2] = texture(GW, GH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); glowFb[j2] = target(glow[j2]); }
      DW = Math.max(8, Math.round(W / 4)); DH = Math.max(8, Math.round(H / 4));
      densTex = texture(DW, DH, gl.R16F, gl.RED, gl.HALF_FLOAT, gl.LINEAR_MIPMAP_NEAREST); densFb = target(densTex);
      gl.generateMipmap(gl.TEXTURE_2D);
      topLod = Math.floor(Math.log2(Math.max(DW, DH)));
      densLod = Math.min(topLod, Math.max(0, Math.round(Math.log2(DH / 8))));   // cells about 1/8 of the picture's height
      chDirty = true;                                                              // charges are in wall heights: the aspect moved them
    }
    sizeBuffers(canvas.width, canvas.height);

    // ------------------------------------------------------------ bodies -> magnet poles
    var body = WallBody.create(kit, {});
    var occ = new Uint8Array(BW * BH), sat = new Int32Array((BW + 1) * (BH + 1));
    var poles = {};                       // per person id: {pol, seen}
    // calm: the depth image in blocks of 8 x 8 cells; a block whose occupancy has not changed for STILL_CALM_S calms its poles.
    // Per block, not per person: ids can split and merge on real data (a chair flickers into two "people"), blocks do not.
    var CB = 8, CBW = Math.ceil(BW / CB), CBH = Math.ceil(BH / CB);
    var blkOcc = new Float32Array(CBW * CBH), blkN = new Float32Array(CBW * CBH), blkRef = new Float32Array(CBW * CBH),
        blkAge = new Float32Array(CBW * CBH), blkGain = new Float32Array(CBW * CBH).fill(1), blkLP = new Float32Array(CBW * CBH),
        blkMo = new Float32Array(CBW * CBH);
    for (var bb = 0; bb < BW * BH; bb++) blkN[((bb / BW | 0) >> 3) * CBW + ((bb % BW) >> 3)]++;
    function settle(dtS) {
      var m = body.mask, mo = body.motion, b;
      blkOcc.fill(0); blkMo.fill(0);
      for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) { var bi2 = (y >> 3) * CBW + (x >> 3); blkOcc[bi2] += m[y * BW + x]; blkMo[bi2] += mo[y * BW + x]; }
      for (b = 0; b < blkOcc.length; b++) {
        var now1 = blkOcc[b] / blkN[b], o = blkLP[b] += (now1 - blkLP[b]) * (1 - Math.exp(-dtS / 0.4));   // smoothed: edge flicker
        if (blkMo[b] / blkN[b] > 0.08) { blkRef[b] = blkLP[b] = now1; blkAge[b] = 0; }                   // real movement wakes it at once
        else if (Math.abs(o - blkRef[b]) > 0.12) { blkRef[b] = o; blkAge[b] = 0; } else blkAge[b] += dtS;
        var k = Math.max(0, Math.min(1, (blkAge[b] - STILL_CALM_S) / 5)); k = k * k * (3 - 2 * k);
        blkGain[b] = 1 - (1 - STILL_CALM_LEVEL) * k;
      }
    }
    var staleFor = 0, bodyGain = 0, lastPeople = 0, lastPolarity = [];
    function personState(p, dtS, now) {
      var st = poles[p.id], sx = screenOf(p.cx, p.cy);
      var x = sx ? sx[0] : p.cx;
      if (!st) st = poles[p.id] = {pol: x < POLE_SPLIT ? 1 : -1, seen: now};
      if (x < POLE_SPLIT - POLE_HYST) st.pol = 1; else if (x > POLE_SPLIT + POLE_HYST) st.pol = -1;
      st.seen = now;
      return st;
    }
    function screenOf(kx, ky) { return kit.toScreen(kx * 512, ky * 424); }
    function buildCharges(dtS, now) {
      var lab = body.label, people = body.people, x, y, i;
      for (i = 0; i < BW * BH; i++) occ[i] = lab[i] >= 0 ? 1 : 0;
      for (y = 0; y < BH; y++) { var row = 0; for (x = 0; x < BW; x++) { row += occ[y * BW + x]; sat[(y + 1) * (BW + 1) + x + 1] = sat[y * (BW + 1) + x + 1] + row; } }
      var lists = people.map(function () { return []; }), total = 0, R = 4;
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) {
        i = y * BW + x; var L = lab[i]; if (L < 0) continue;
        if (!((x > 0 && lab[i - 1] !== L) || (x < BW - 1 && lab[i + 1] !== L) || (y > 0 && lab[i - BW] !== L) || (y < BH - 1 && lab[i + BW] !== L))) continue;
        var x0 = Math.max(0, x - R), x1 = Math.min(BW, x + R + 1), y0 = Math.max(0, y - R), y1 = Math.min(BH, y + R + 1);
        var inside = sat[y1 * (BW + 1) + x1] - sat[y0 * (BW + 1) + x1] - sat[y1 * (BW + 1) + x0] + sat[y0 * (BW + 1) + x0];
        var frac = inside / ((x1 - x0) * (y1 - y0));
        lists[L].push(x, y, Math.max(0.35, Math.min(2.6, 1 + TIP_BOOST * (0.5 - frac) * 2)), blkGain[(y >> 3) * CBW + (x >> 3)]);
        total++;
      }
      var stride = Math.max(1, Math.ceil(total / MAXC)), n = 0;
      lastPolarity = [];
      for (var k = 0; k < people.length; k++) {
        var p = people[k], st = personState(p, dtS, now), list = lists[k], sw = 0, j;
        lastPolarity.push(st.pol);
        for (j = 0; j < list.length; j += 4 * stride) sw += list[j + 2];
        if (!sw) continue;
        var Q = st.pol * PERSON_Q * Math.max(0.5, Math.min(1.2, Math.sqrt(p.area / 900)));
        for (j = 0; j < list.length && n < MAXC; j += 4 * stride) {
          var s = kit.toScreen((list[j] + 0.5) * 4, (list[j + 1] + 0.5) * 4);
          if (!s) continue;
          chData[n * 4] = s[0] * aspect; chData[n * 4 + 1] = s[1]; chData[n * 4 + 2] = Q * list[j + 2] / sw * list[j + 3]; chData[n * 4 + 3] = 0; n++;
        }
      }
      for (var id in poles) if (now - poles[id].seen > 2000) delete poles[id];
      chN = n; chDirty = true; lastPeople = people.length;
    }
    function uploadBody() {
      var m = body.mask, sd = body.sdf;
      for (var i = 0; i < BW * BH; i++) { bodyData[i * 2] = m[i]; bodyData[i * 2 + 1] = sd[i]; }
      gl.bindTexture(gl.TEXTURE_2D, bodyTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RG, gl.FLOAT, bodyData);
    }

    // ------------------------------------------------------------ fingertips -> small strong poles
    var tips = [], fallback = [], tipU = new Float32Array(16);
    function tipsFrame(dt) {
      var f = kit.fingers, nowD = Date.now(), pts = [];
      if (f && Array.isArray(f.pts) && nowD - f.t <= 160) pts = f.pts;
      else { fallback = fallback.filter(function (p) { return nowD - p.t < 400; }); pts = fallback.map(function (p) { return [p.x, p.y]; }); }
      tips.forEach(function (t) { t.seen = false; });
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var best = null, bd = 0.1;
        tips.forEach(function (t) { if (!t.seen) { var d = Math.hypot(t.x - p[0], t.y - p[1]); if (d < bd) { bd = d; best = t; } } });
        if (best) { var g = 1 - Math.exp(-dt * 30); best.x += (p[0] - best.x) * g; best.y += (p[1] - best.y) * g; best.seen = true; }
        else if (tips.length < 4) tips.push({x: p[0], y: p[1], s: 0.4, pol: p[0] < POLE_SPLIT ? 1 : -1, seen: true});
      }
      tips.forEach(function (t) {
        if (t.x < POLE_SPLIT - POLE_HYST) t.pol = 1; else if (t.x > POLE_SPLIT + POLE_HYST) t.pol = -1;
        var want = t.seen ? 1 : 0; t.s += (want - t.s) * (1 - Math.exp(-dt / (t.seen ? TIP_ATTACK_S : TIP_RELEASE_S)));
      });
      tips = tips.filter(function (t) { return t.seen || t.s > 0.06; });
      tipU.fill(0);
      tips.forEach(function (t, k) { tipU[k * 4] = t.x * aspect; tipU[k * 4 + 1] = t.y; tipU[k * 4 + 2] = t.pol * TIP_Q * t.s; tipU[k * 4 + 3] = t.s; });
    }

    // ------------------------------------------------------------ passes
    function common(u, mg) {
      gl.uniform1f(u.uAspect, aspect); gl.uniform1f(u.uMagHalf, MAG_HALF); gl.uniform1f(u.uMagSoft, 0.04);
      gl.uniform1f(u.uBodyGain, bodyGain); gl.uniform1f(u.uTipEps, 0.012); gl.uniform1f(u.uTipR0, TIP_REACH);
      gl.uniform4f(u.uMag, mg[0], mg[1], mg[2], 0); gl.uniform4fv(u.uTips, tipU); gl.uniform1i(u.uTipN, tips.length);
    }
    function fieldPass() {
      gl.bindTexture(gl.TEXTURE_2D, chTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAXC, 1, gl.RGBA, gl.FLOAT, chHeld);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFb); gl.viewport(0, 0, FW, FH); gl.disable(gl.BLEND);
      gl.useProgram(pField.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, chTex); gl.uniform1i(pField.u.uCh, 0);
      gl.uniform1i(pField.u.uN, chN); gl.uniform1f(pField.u.uAspect, aspect); gl.uniform1f(pField.u.uEps, 0.012);
      gl.uniform1f(pField.u.uR0, REACH_FALLOFF); gl.uniform1f(pField.u.uR1, 0.06);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function densPass() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, densFb); gl.viewport(0, 0, DW, DH);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(pDens.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stTex[cur]); gl.uniform1i(pDens.u.uState, 0);
      gl.drawArrays(gl.POINTS, 0, N);
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, densTex); gl.generateMipmap(gl.TEXTURE_2D);
    }
    function stepPass(dt, mg) {
      var nxt = 1 - cur, u = pStep.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[nxt]); gl.viewport(0, 0, FILINGS_W, FILINGS_H); gl.disable(gl.BLEND);
      gl.useProgram(pStep.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stTex[cur]); gl.uniform1i(u.uState, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fieldTex); gl.uniform1i(u.uField, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, densTex); gl.uniform1i(u.uDens, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, 3);
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv());
      common(u, mg);
      gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uT0, FRICTION); gl.uniform1f(u.uT1, FRICTION_FULL);
      gl.uniform1f(u.uIdleRate, IDLE_COMB); gl.uniform1f(u.uFastRate, SWIVEL); gl.uniform1f(u.uIdleW, IDLE_WEIGHT);
      gl.uniform1f(u.uAttack, ATTACK_S); gl.uniform1f(u.uRelease, RELEASE_S); gl.uniform1f(u.uSnap, SNAP);
      gl.uniform1f(u.uGather, GATHER); gl.uniform1f(u.uPush, PUSH_OUT); gl.uniform1f(u.uClump, CHAIN); gl.uniform1f(u.uClumpD, CHAIN_SPACING);
      gl.uniform1f(u.uJit, JITTER); gl.uniform1f(u.uHeal, 1 / REDUST_S); gl.uniform1f(u.uSpread, SPREAD); gl.uniform1f(u.uDensLod, densLod); gl.uniform1f(u.uTopLod, topLod);
      gl.uniform1f(u.uTipCore, TIP_CORE); gl.uniform1f(u.uTipPull, TIP_PULL);
      gl.uniform2f(u.uFieldTexel, 1 / FW, 1 / FH);
      gl.uniform1ui(u.uFrame, (steps++) >>> 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = nxt;
    }
    function render(mg) {
      // the filings' light
      gl.bindFramebuffer(gl.FRAMEBUFFER, accFb); gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      var u = pFil.u; gl.useProgram(pFil.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stTex[cur]); gl.uniform1i(u.uState, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fieldTex); gl.uniform1i(u.uField, 1);
      common(u, mg);
      var sc = W / 1280;
      gl.uniform2f(u.uView, W, H); gl.uniform1f(u.uLenPx, FILING_PX * sc); gl.uniform1f(u.uWidPx, Math.max(0.5, FILING_WIDTH_PX * sc));
      gl.uniform1f(u.uStand, STAND); gl.uniform1f(u.uIdleB, IDLE_LIGHT * wallK); gl.uniform1f(u.uGlint, GLINT * wallK); gl.uniform1f(u.uEnergyB, ENERGY_LIGHT);
      gl.uniform1f(u.uPotRef, 0.05);
      gl.drawArrays(gl.TRIANGLES, 0, N * 6);
      gl.disable(gl.BLEND);
      // glow of the standing filings
      gl.useProgram(pDown.p); gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[0]); gl.viewport(0, 0, GW, GH);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(pDown.u.uSrc, 0);
      gl.uniform2f(pDown.u.uTexel, 1 / W, 1 / H); gl.uniform1f(pDown.u.uExposure, EXPOSURE); gl.uniform1f(pDown.u.uTint, POLE_TINT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(pBlur.p); gl.uniform1i(pBlur.u.uSrc, 0);
      for (var it = 0; it < 2; it++) {
        gl.uniform2f(pBlur.u.uDir, (1 + it) / GW, 0); gl.bindTexture(gl.TEXTURE_2D, glow[0]); gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[1]); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.uniform2f(pBlur.u.uDir, 0, (1 + it) / GH); gl.bindTexture(gl.TEXTURE_2D, glow[1]); gl.bindFramebuffer(gl.FRAMEBUFFER, glowFb[0]); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      // to the wall
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      var c = pComp.u; gl.useProgram(pComp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex); gl.uniform1i(c.uAccum, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, glow[0]); gl.uniform1i(c.uGlow, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(c.uBody, 2);
      gl.uniformMatrix3fv(c.uHinv, false, body.hinv());
      gl.uniform1f(c.uGlowAmt, BLOOM); gl.uniform1f(c.uIdleCap, IDLE_CAP * wallK); gl.uniform1f(c.uDark, DARK_INSIDE);
      gl.uniform1f(c.uExposure, EXPOSURE); gl.uniform1f(c.uTint, POLE_TINT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    // settle the sheet before the first frame: the filings gather into the hidden magnet's lines
    (function warm() { var mg = magnet(0); for (var k = 0; k < 90; k++) { densPass(); stepPass(1 / 30, mg); } })();

    // ------------------------------------------------------------ per frame
    var lastFrameMs = -1;
    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
      frames++; wallT += dt;
      if (canvas.width !== W || canvas.height !== H) sizeBuffers(canvas.width, canvas.height);
      var fresh = body.update(dt, now);
      if (fresh) {
        var dtS = lastFrameMs > 0 ? Math.min(0.2, Math.max(0, (body.frameMs - lastFrameMs) / 1000)) : 0;
        lastFrameMs = body.frameMs;
        settle(dtS); buildCharges(dtS, now);
        chHeld.set(chData); staleFor = 0; uploadBody();
      } else if (!body.fresh) {
        staleFor += dt;
        if (staleFor > STALL_HOLD_S) uploadBody();                // a real stop: let the body go (body.js fades the mask)
      }
      // the poles hold through a short stall, then fade
      var wantGain = staleFor <= STALL_HOLD_S ? 1 : Math.exp(-(staleFor - STALL_HOLD_S) / 0.25);
      bodyGain = chN ? wantGain : 0;
      if (bodyGain < 0.02 && chN) { chN = 0; chDirty = true; bodyGain = 0; }
      if (chDirty) { fieldPass(); chDirty = false; }
      tipsFrame(dt);
      var mg = magnet(simT);
      if (dt > 0) {
        var n = dt > 0.026 ? 2 : 1;
        for (var k = 0; k < n; k++) { simT += dt / n; densPass(); stepPass(dt / n, mg); }
      }
      render(mg);
    }
    function touch(t) {
      if (!t) return;                          // sparse touches: only used while kit.fingers is silent; a report near a recent one is that finger
      var nowD = Date.now(), near = null;
      fallback.forEach(function (p) { if (Math.hypot(p.x - t.x, p.y - t.y) < 0.08) near = p; });
      if (near) { near.x = t.x; near.y = t.y; near.t = nowD; return; }
      fallback.push({x: t.x, y: t.y, t: nowD});
      if (fallback.length > 4) fallback.shift();
    }
    function resize(w, h) { sizeBuffers(w, h); }
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.IronfilingsSet === set) delete window.IronfilingsSet;
      if (window.IronfilingsWake === wake) delete window.IronfilingsWake;
      kit.wantDepth(false);
      made.fb.forEach(function (f) { gl.deleteFramebuffer(f); });
      made.tex.forEach(function (t) { gl.deleteTexture(t); });
      made.prog.forEach(function (p) { gl.deleteProgram(p); });
      made.vao.forEach(function (v) { gl.deleteVertexArray(v); });
      made = {tex: [], fb: [], prog: [], vao: []};
      if (window.__ironfilingsDebug) try { delete window.__ironfilingsDebug; } catch (e) { window.__ironfilingsDebug = undefined; }
    }
    kit.wantDepth(true);

    if (window.WallTest) {   // sandbox only (the live wall has no WallTest): a readback of the filings, for the tests
      window.__ironfilingsDebug = function (o) {
        o = o || {};
        var px = new Float32Array(N * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[cur]); gl.readPixels(0, 0, FILINGS_W, FILINGS_H, gl.RGBA, gl.FLOAT, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        var box = o.box || [0, 0, 1, 1], mg = magnet(simT), n = 0, en = 0, hot = 0, al = 0, ali = 0;
        for (var i = 0; i < N; i++) {
          var x = px[i * 4], y = px[i * 4 + 1], th = px[i * 4 + 2], e = Math.max(0, px[i * 4 + 3]);
          if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
          if (o.ring) { var rr = Math.hypot((x - o.ring[0]) * aspect, y - o.ring[1]); if (rr < o.ring[2] || rr > o.ring[3]) continue; }
          n++; en += e; if (e > 0.3) hot++;
          ali += Math.abs(Math.cos(th - idleAngle(x * aspect, y, mg)));
          if (o.radial) al += Math.abs(Math.cos(th - Math.atan2(y - o.radial[1], (x - o.radial[0]) * aspect)));
          else if (o.dir != null) al += Math.abs(Math.cos(th - o.dir));
        }
        var probe = null;
        if (o.probe) {                                       // the people's field strength at window points (x, y)
          var fpx = new Float32Array(FW * FH * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, fieldFb); gl.readPixels(0, 0, FW, FH, gl.RGBA, gl.FLOAT, fpx); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          probe = o.probe.map(function (p) { var fx = Math.min(FW - 1, Math.floor(p[0] * FW)), fy = Math.min(FH - 1, Math.floor((1 - p[1]) * FH)), k = (fy * FW + fx) * 4;
            return +(Math.hypot(fpx[k], fpx[k + 1]) * bodyGain).toFixed(2); });
        }
        var ages = Array.prototype.filter.call(blkAge, function (g, k) { return blkLP[k] > 0.05; }).map(function (v) { return Math.round(v); });
        return {n: n, energy: n ? +(en / n).toFixed(3) : 0, probe: probe, ages: o.ages ? ages : undefined, standing: hot, align: n ? +(al / n).toFixed(3) : null, alignIdle: n ? +(ali / n).toFixed(3) : null,
                people: lastPeople, polarity: lastPolarity.slice(), calm: +Math.min.apply(null, Array.prototype.filter.call(blkGain, function (g, k) { return blkLP[k] > 0.05; }).concat([1])).toFixed(2), charges: chN, bodyGain: +bodyGain.toFixed(2), tips: tips.length,
                magnet: mg.map(function (v) { return +v.toFixed(3); }), simT: +simT.toFixed(2), wallT: +wallT.toFixed(2), frames: frames,
                grid: [W, H], glError: gl.getError()};
      };
    }
    function set(opts) {
      if (!opts || destroyed) return {stand: STAND, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.stand)) STAND = Math.max(0.2, Math.min(1.5, opts.stand));
      return {stand: STAND, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      var force = true;
      try {
        if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
      } catch (e) {}
    }
    window.IronfilingsSet = set;
    window.IronfilingsWake = wake;
    if (window._ironfilingsFx) set(window._ironfilingsFx);

    return {frame: frame, touch: touch, resize: resize, destroy: destroy};
  }
})();
