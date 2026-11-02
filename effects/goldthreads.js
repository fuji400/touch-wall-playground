/* Gold Threads — a living network of fine gold threads that grows between people            (fx-research concept #11)
 *
 * The idea. The wall is black, crossed by a sparse web of fine bronze threads that slowly wanders and re-forms: a slime-mould
 * network (Physarum) searching the empty wall. People are food:
 *   - step in and every thread you touch lights up gold at once, and the light runs out along it; within a second the threads
 *     around you turn and stream toward you and wrap your outline in gold;
 *   - two or more people: the network finds bridges between you and turns them into brighter, pulsing veins (only between
 *     people, or a person and a crumb);
 *   - step away: your gold drains out of the threads in a couple of seconds, and the threads you grew slowly wither and
 *     re-route into the resting web;
 *   - touch the wall to drop a crumb (a small gold seed): the network finds it within seconds and links it up. Drag a finger
 *     to drop a line of crumbs and lead the threads where you want;
 *   - something perfectly still for a long time (a chair by the wall) is slowly "eaten": its food runs low and its gold dims;
 *     any movement feeds it again.
 * Nothing is projected inside a person (DARK_INSIDE): the threads wrap your outline, they never cross your back.
 *
 * How. Jones's (2010) agent model on the GPU (WebGL 2, fragment shaders, no compute): ~100,000 tiny explorers live in float
 * textures (position, heading, how well fed, which food they last ate at, a bridge charge). Every 1/60 s each one smells the
 * trail map with three feelers, turns toward the strongest smell, steps forward, and drops a little trail (drawn as 1-pixel
 * points, added up); the trail map then blurs and fades. That loop is what grows the threads. People come from the shared body
 * stage (WallBody): their outline is food, and a scent spreads a short way out from it, so hungry explorers nearby turn toward
 * you at once. Half the explorers stay and wrap you once fed; the other half (foragers) carry gold away along the threads,
 * so veins of gold reach out of you. One that walks from one person (or crumb) to a different one gets a bridge charge, turns
 * back and shuttles, which lights the veins between people. Four trail channels: the plain network (dim bronze, capped so the
 * resting wall stays calm), gold (fed explorers), bridge light, and a slow amber ghost of the gold (what withers after you go).
 * Each person's food keeps one id while they move (matched by overlap, so depth noise that splits or re-numbers a blob does
 * not drain the gold or fake a bridge).
 * Needs plugins/body.js (WallBody). WebGL 2 + EXT_color_buffer_float, no assets, no audio, one depth client (via the host).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- tuning knobs
  var AGENTS_W = 320, AGENTS_H = 320;  // number of explorers = W x H (102,400); fewer = a sparser, fainter web
  var TRAIL_SCALE = 1.0;               // resolution of the trail map, as a share of the picture's (1 = 1280 x 800, fine threads)
  var SPEED = 60;                      // how fast an explorer crawls (px/s on a 1280-wide picture)
  var SENSE_DIST = 18;                 // how far ahead an explorer smells (px). Bigger = a coarser web with bigger holes
  var SENSE_ANGLE = 35;                // angle between an explorer's three feelers (degrees)
  var TURN = 40;                       // how far it turns toward the strongest smell each step (degrees, 60 steps a second)
  var WOBBLE = 0.25;                   // random wiggle per step (radians)
  var TRAIL_FADE_S = 0.25;             // how quickly a thread fades once nobody walks it (s)
  var SPREAD = 0.6;                    // how much a thread softens sideways each step (0..1)
  var DEPOSIT = 1.0;                   // trail an explorer leaves per step
  var SEARCH = 0.15;                   // a slow drifting pull that keeps the resting web searching instead of freezing
  var EDGE_AVOID = 0.06;               // threads fade out within about this far of the picture's edges (wall heights); an explorer
                                       // that walks off the picture is dropped somewhere random (no threads run along the frame)
  var RESPAWN_S = 15;                  // each explorer is lifted and dropped somewhere random about this often (keeps the
                                       // empty parts of the wall alive; nobody can gather every explorer)

  var SCENT = 0.8;                     // how strongly a hungry explorer is drawn to a person's scent
  var SCENT_REACH = 0.07;              // how far the scent reaches out from a person's outline (wall heights; keeps it local)
  var FORAGERS = 0.5;                  // share of explorers that carry food away once they have eaten (the rest stay and wrap you)
  var SCENT_AWAY = 0.4;                // how strongly a forager that has eaten is pushed away from food (gold flows out along veins,
                                       // and a forager that reaches someone else lights a bridge)
  var FEED_CELLS = 2.2;                // an explorer this close to an outline is eating (depth cells; one is ~1.4% of the wall's height)
  var FED_REACH = 0.18;                // how far a fed explorer carries gold before it is hungry again (wall heights)
  var BRIDGE_GAP = 0.05;               // an explorer must travel at least this far between two different people (or crumbs)
  var BRIDGE_MAX = 1.6;                // ...and at most this far, for the trip to count as a bridge (wall heights)
  var FED_TRAIL = 1.0;                 // fed explorers lay this much extra trail (veins leading away from people grow stronger)
  var BRIDGE_TRAIL = 3.0;              // explorers on a bridge lay this much extra trail (a found bridge thickens and draws more traffic)
  var BRIDGE_REACH = 0.5;              // how far a bridge charge lasts as it travels (wall heights)
  var PULSE_LEN = 0.09;                // spacing of the bands of light that crawl along a bridge (wall heights)
  var PULSE_S = 1.3;                   // bridges throb (brighter, then half as bright) once in this long (s)
  var DRAIN_S = 0.5;                   // when someone leaves, the gold their explorers carry drains this fast (s)
  var GOLD_FADE_S = 0.35;              // how quickly gold fades from a thread once fed explorers stop walking it (s)
  var BRIDGE_FADE_S = 0.25;            // the same for bridge light (short, so the pulses stay sharp)

  var WEB_LEVEL = 12;                  // trail strength at which a resting thread is about 2/3 of its ceiling (higher = dimmer, finer)
  var WEB_CAP = 0.36;                  // the ceiling for the resting web (0.36 = about 55/255): the empty wall stays calm
  var GOLD_LIGHT = 1.0;                // brightness of gold threads (participant light)
  var GOLD_LEVEL = 40;                 // trail strength of fed explorers at which gold is about 2/3 of full
  var BRIDGE_LIGHT = 1.3;              // brightness of bridge veins
  var BRIDGE_LEVEL = 6;                // bridge trail strength at which a bridge is about 2/3 of full (lower = bridges flare sooner)
  var BLOOM = 0.35;                    // the soft glow around gold and bridges
  var RIM = 0.15;                      // a faint gold shimmer just outside a still person's outline (0 = none)
  var RIM_MOVE = 1.0;                  // ...and how much brighter it glistens where you just appeared or moved (from the first frame)
  var FRESH_S = 1.0;                   // how long that glisten lasts after a movement (s)
  var DASH = 1.5;                      // hungry explorers that smell someone crawl up to 1 + DASH times faster (a quick first swarm)
  var WITHER_S = 3.0;                  // after you leave, a dim amber ghost of your gold threads fades over about this long (s)
  var WITHER_LIGHT = 0.20;             // brightness ceiling of that ghost (0.20 = about 30/255; 0 = none)

  var CRUMB_S = 9;                     // a crumb lasts this long after the finger lifts (s), then fades over 2 s
  var CRUMB_R = 0.012;                 // size of a crumb (wall heights)
  var CRUMB_PULL = 0.7;                // how strongly a crumb's scent draws hungry explorers (a person's is 1)
  var CRUMB_SCENT = 0.09;              // how far a crumb's scent reaches (wall heights)
  var CRUMB_SPACING = 0.035;           // a dragged finger drops a new crumb this far from the last (wall heights)
  var CRUMB_MAX = 8;                   // at most this many crumbs at once (the oldest is eaten first)

  var STILL_CALM_S = 40;               // a part of the wall where nothing has changed for this long is slowly "eaten"...
  var STILL_CALM_LEVEL = 0.35;         // ...down to this share of its food (a chair cannot glow forever; any movement feeds it)
  var WAKE_MOVE = 0.12;                // ...a person counts as moving (and is fed fully again) when this share of them changes at once
  var GROUP_CELLS = 5;                 // blobs closer than this (depth cells) count as one person for bridges (an arm the depth image
                                       // splits off is not a second person)
  var PRESENT_GRACE_S = 0.6;           // someone missing from the depth for less than this still counts as there (their gold holds)
  var STALL_HOLD_S = 0.6;              // the depth camera pausing this long or less keeps everything as it was
  var DARK_INSIDE = 1.0;               // no light inside a person (1 = none, 0 = off)

  // ---------------------------------------------------------------- fixed sizes
  var BW = 128, BH = 106;               // body cells (WallBody)
  var STEP_S = 1 / 60;                  // the simulation's fixed time step
  var MAX_STEPS = 4;                    // per animation frame
  var NCRUMB = 10;

  registerWallPlugin({id: 'goldthreads', title: 'Gold Threads', author: 'Claude (fx-batch), fx-research concept #11', create: create});

  var GLSL_HASH =
    'uint hsh(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }\n' +
    'float u01(uint x) { return float(hsh(x) >> 8) * (1.0 / 16777216.0); }\n';
  var VS_TRI = '#version 300 es\nout vec2 vUv;\nvoid main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }\n';

  // the body, sampled at a window point (x, y in 0..1, y down): r = mask, g = outline distance (cells, + outside), b = distance to
  // the nearest person (cells, 0 on them, 40 = nobody), a = how much food they give (calm, stall)
  var GLSL_BODY =
    'uniform sampler2D uBody, uId; uniform mat3 uHinv;\n' +
    'vec4 bodyAt1(vec2 q) { vec3 h = uHinv * vec3(q, 1.0); vec2 k = h.xy / max(h.z, 1e-6);\n' +   // one tap: cheap, for smelling and fading
    '  if (h.z <= 0.0 || k.x < 0.0 || k.x > 1.0 || k.y < 0.0 || k.y > 1.0) return vec4(0.0, 40.0, 40.0, 0.0);\n' +
    '  return texture(uBody, k); }\n' +
    'vec4 bodyAt(vec2 q) { vec3 h = uHinv * vec3(q, 1.0); vec2 k = h.xy / max(h.z, 1e-6);\n' +
    '  if (h.z <= 0.0 || k.x < 0.0 || k.x > 1.0 || k.y < 0.0 || k.y > 1.0) return vec4(0.0, 40.0, 40.0, 0.0);\n' +
    '  vec2 e = 0.5 / vec2(' + BW + '.0, ' + BH + '.0);\n' +   // four bilinear taps: a smooth outline, not 4 x 4-pixel stairs
    '  return 0.25 * (texture(uBody, k + vec2(-e.x, -e.y)) + texture(uBody, k + vec2(e.x, -e.y)) + texture(uBody, k + vec2(-e.x, e.y)) + texture(uBody, k + e)); }\n' +
    'float freshAt(vec2 q) { vec3 h = uHinv * vec3(q, 1.0); vec2 k = h.xy / max(h.z, 1e-6);\n' +
    '  if (h.z <= 0.0 || k.x < 0.0 || k.x > 1.0 || k.y < 0.0 || k.y > 1.0) return 0.0;\n' +
    '  return texture(uId, k).g; }\n' +
    'float idAt(vec2 q) { vec3 h = uHinv * vec3(q, 1.0); vec2 k = h.xy / max(h.z, 1e-6);\n' +
    '  if (h.z <= 0.0 || k.x < 0.0 || k.x > 1.0 || k.y < 0.0 || k.y > 1.0) return 0.0;\n' +
    '  return texelFetch(uId, ivec2(clamp(k * vec2(' + BW + '.0, ' + BH + '.0), vec2(0.0), vec2(' + (BW - 1) + '.0, ' + (BH - 1) + '.0))), 0).r; }\n';

  var GLSL_NOISE =
    'float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);\n' +
    '  return mix(mix(vhash(i), vhash(i + vec2(1, 0)), f.x), mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), f.x), f.y); }\n';

  // one step of every explorer. state0 = x, y (window 0..1, y down), heading (radians, window pixels), fed (0..1)
  //                              state1 = id of the food last eaten (0 = none), bridge charge, distance since eating (wall heights), inside
  var FS_AGENT =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uS0, uS1, uTrail;\n' + GLSL_BODY + GLSL_HASH + GLSL_NOISE +
    'uniform vec2 uTpx; uniform float uStep, uSense, uSA, uRA, uWob, uAspect, uHalf, uSearch, uTime, uRespawn, uEdge;\n' +
    'uniform float uForagers, uDash, uScentW, uScentAway, uScentCells, uFeedCells, uFedReach, uBridgeGap, uBridgeMax, uBridgeReach, uFoodOn;\n' +
    'uniform vec4 uCrumb[' + NCRUMB + ']; uniform int uCrumbN; uniform float uCrumbR, uCrumbScent, uCrumbW;\n' +
    'uniform uint uFrame; uniform float uPresent[24]; uniform int uPresentN; uniform float uBridgeDrop, uFedDrop;\n' +
    'bool present(float id) { if (id < 0.5) return false;\n' +
    '  for (int i = 0; i < 24; i++) { if (i >= uPresentN) break; if (abs(uPresent[i] - id) < 0.5) return true; } return false; }\n' +
    'layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;\n' +
    'float scent(vec2 q, vec4 b) {\n' +
    '  float s = b.a * uFoodOn * exp(-max(b.b, 0.0) / uScentCells), c = 0.0;\n' +
    '  for (int i = 0; i < ' + NCRUMB + '; i++) { if (i >= uCrumbN) break;\n' +
    '    float d = length((q - uCrumb[i].xy) * vec2(uAspect, 1.0)); c = max(c, uCrumb[i].z * exp(-d / uCrumbScent)); }\n' +
    '  return s + c * uCrumbW;\n' +
    '}\n' +
    'float sense(vec2 q, float w) {\n' +
    '  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return -1.0;\n' +
    '  float t = textureLod(uTrail, vec2(q.x, 1.0 - q.y), 0.0).r;\n' +
    '  vec4 b = bodyAt1(q);\n' +
    '  float v = t / (t + uHalf) + w * scent(q, b);\n' +
    '  v += uSearch * vnoise(vec2(q.x * uAspect, q.y) * 5.0 + vec2(uTime * 0.05, -uTime * 0.037));\n' +
    '  return v - 3.0 * smoothstep(0.45, 0.7, b.r);\n' +
    '}\n' +
    'vec2 dir(float a) { return vec2(cos(a), sin(a)); }\n' +
    'void main() {\n' +
    '  ivec2 ij = ivec2(gl_FragCoord.xy);\n' +
    '  vec4 s = texelFetch(uS0, ij, 0), s1 = texelFetch(uS1, ij, 0);\n' +
    '  vec2 q = s.xy; float h = s.z, fed = s.w, lastId = s1.x, br = s1.y, dist = s1.z, prevId = floor(s1.w);\n' +
    '  uint seed = hsh(uint(ij.x) + uint(ij.y) * 4096u) ^ (uFrame * 0x9E3779B9u);\n' +
    '  float r1 = u01(seed), r2 = u01(seed ^ 0x68bc21ebu), r3 = u01(seed ^ 0x2c1b3c6du), r4 = u01(seed ^ 0x297a2d39u), r5 = u01(seed ^ 0x51ed270bu);\n' +
    '  if (r1 < uRespawn) { o0 = vec4(r2, r3, r4 * 6.2831853, 0.0); o1 = vec4(0.0, 0.0, 9.0, 0.5); return; }\n' +
    // hungry: drawn toward food; full: pushed away from it (so the gold leaves along the threads)
    '  float forager = u01(hsh(uint(ij.x) * 7919u + uint(ij.y) * 104729u + 17u)) < uForagers ? 1.0 : 0.0;\n' +   // a fixed trait per explorer
    '  float leave = max(forager, step(0.3, br));\n' +   // foragers, and anyone carrying a bridge, leave food once fed
    '  float w = mix(uScentW, -uScentAway, smoothstep(0.35, 0.8, fed) * leave);\n' +
    '  vec2 so = uTpx * uSense;\n' +
    '  float F = sense(q + dir(h) * so, w), L = sense(q + dir(h - uSA) * so, w), R = sense(q + dir(h + uSA) * so, w);\n' +
    '  if (F > L && F > R) {}\n' +
    '  else if (F < L && F < R) h += r2 < 0.5 ? -uRA : uRA;\n' +
    '  else if (L > R) h -= uRA; else h += uRA;\n' +
    '  h += (r3 - 0.5) * 2.0 * uWob;\n' +
    '  vec4 b0 = bodyAt(q); vec2 nq; float inside = 0.0;\n' +
    '  if (b0.r > 0.6) {\n' +                       // under a person: crawl straight out (along the outline distance), leave no trail
    '    vec2 e = uTpx * 3.0;\n' +
    '    vec2 g = vec2(bodyAt(q + vec2(e.x, 0.0)).g - bodyAt(q - vec2(e.x, 0.0)).g, bodyAt(q + vec2(0.0, e.y)).g - bodyAt(q - vec2(0.0, e.y)).g);\n' +
    '    if (dot(g, g) > 1e-6) h = atan(g.y, g.x) + (r4 - 0.5) * 0.8;\n' +
    '    nq = q + dir(h) * uTpx * uStep * 3.0; inside = 1.0;\n' +
    '  } else {\n' +
    '    float dash = 1.0 + uDash * (1.0 - smoothstep(0.2, 0.6, fed)) * smoothstep(0.03, 0.4, scent(q, b0));\n' +
    '    nq = q + dir(h) * uTpx * uStep * dash;\n' +
    '    if (bodyAt(nq).r > 0.6) { nq = q; h = r4 * 6.2831853; }\n' +   // bumped into a person: stay, try another way
    '  }\n' +
    '  if (nq.x < 0.0 || nq.x > 1.0 || nq.y < 0.0 || nq.y > 1.0) { o0 = vec4(r2, r3, r5 * 6.2831853, 0.0); o1 = vec4(0.0, 0.0, 9.0, 0.5); return; }\n' +
    '  h -= 6.2831853 * floor(h / 6.2831853 + 0.5);\n' +
    '  float stepLen = length((nq - q) * vec2(uAspect, 1.0));\n' +
    '  dist += stepLen; fed *= exp(-stepLen / uFedReach); br *= exp(-stepLen / uBridgeReach);\n' +
    '  if (dist > uBridgeMax) { lastId = 0.0; prevId = 0.0; }\n' +
    '  if (!(present(lastId) && present(prevId) && abs(lastId - prevId) > 0.5)) br *= uBridgeDrop;\n' +   // a bridge needs both its ends there
    '  if (!present(lastId)) fed *= uFedDrop;\n' +   // the food it carries is gone (the person left): the gold drains
    // eating: next to a person (the nearest person's id), or on a crumb
    '  vec4 b1 = bodyAt(nq); float id = 0.0, food = 0.0;\n' +
    '  if (inside < 0.5 && b1.r < 0.6 && b1.b < uFeedCells && b1.a * uFoodOn > 0.05) { id = idAt(nq); food = b1.a * uFoodOn; }\n' +
    '  for (int i = 0; i < ' + NCRUMB + '; i++) { if (i >= uCrumbN) break;\n' +
    '    if (uCrumb[i].z > 0.05 && length((nq - uCrumb[i].xy) * vec2(uAspect, 1.0)) < uCrumbR) { id = uCrumb[i].w; food = uCrumb[i].z; } }\n' +
    '  if (id > 0.5) {\n' +
    '    if (present(lastId) && abs(id - lastId) > 0.5 && dist > uBridgeGap) { br = max(br, food); prevId = lastId; h += 3.14159265; }\n' +   // a bridge: turn back (shuttle)
    '    else if (abs(id - lastId) > 0.5) prevId = 0.0;\n' +   // new food without a bridge trip: whatever bridge it carried is over
    '    lastId = id; dist = 0.0; fed = max(fed, food);\n' +
    '  }\n' +
    '  o0 = vec4(nq, h, fed); o1 = vec4(lastId, br, dist, prevId + 0.5 * inside);\n' +
    '}\n';

  // every explorer drops a little trail where it stands (1-pixel points, added up): r = network, g = gold, b = bridge
  var VS_DEP =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uS0, uS1; uniform float uDep, uTime, uPulseLen, uPulseS, uFedTrail, uBridgeTrail;\n' +
    'out vec4 vD;\n' +
    'void main() { int i = gl_VertexID; ivec2 ij = ivec2(i % ' + AGENTS_W + ', i / ' + AGENTS_W + ');\n' +
    '  vec4 s = texelFetch(uS0, ij, 0), s1 = texelFetch(uS1, ij, 0);\n' +
    '  gl_Position = vec4(s.x * 2.0 - 1.0, 1.0 - s.y * 2.0, 0.0, 1.0); gl_PointSize = 1.0;\n' +
    '  float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * cos(6.2831853 * (s1.z / uPulseLen - uTime / uPulseS)), 2.0);\n' +
    '  float onWay = smoothstep(0.004, 0.03, s1.z);\n' +   // bridge light is laid on the way between people, not while eating
    '  vD = vec4(1.0 + uFedTrail * s.w + uBridgeTrail * s1.y, s.w, s1.y * pulse * onWay, s.w) * uDep * (fract(s1.w) > 0.25 ? 0.0 : 1.0);\n' +
    '}\n';
  var FS_DEP = '#version 300 es\nprecision highp float;\nin vec4 vD; out vec4 o;\nvoid main() { o = vD; }\n';

  // the trail map blurs and fades; nothing survives under a person
  var FS_DIFF =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uTrail;\n' + GLSL_BODY +
    'uniform vec4 uDecay; uniform float uSpread, uErase, uEdge, uAspect, uEdgeFade;\n' +
    'out vec4 o;\n' +
    'void main() {\n' +
    '  ivec2 ij = ivec2(gl_FragCoord.xy), mx = textureSize(uTrail, 0) - 1;\n' +
    '  vec4 c = texelFetch(uTrail, ij, 0), sum = vec4(0.0);\n' +
    '  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) sum += texelFetch(uTrail, clamp(ij + ivec2(dx, dy), ivec2(0), mx), 0);\n' +
    '  vec4 v = mix(c, sum / 9.0, uSpread) * uDecay;\n' +
    '  vec2 q = vec2((float(ij.x) + 0.5) / float(mx.x + 1), 1.0 - (float(ij.y) + 0.5) / float(mx.y + 1));\n' +
    '  v *= 1.0 - smoothstep(0.5, 0.8, bodyAt1(q).r) * uErase;\n' +
    '  float e = min(min(q.x, 1.0 - q.x) * uAspect, min(q.y, 1.0 - q.y));\n' +
    '  v *= 1.0 - (1.0 - smoothstep(0.0, uEdge, e)) * uEdgeFade;\n' +
    '  o = v;\n' +
    '}\n';

  // to the wall
  var FS_COMP =
    '#version 300 es\n' +
    'precision highp float; precision highp int; precision highp sampler2D;\n' +
    'uniform sampler2D uTrail;\n' + GLSL_BODY + GLSL_NOISE +
    'uniform float uPulseS, uWebLevel, uWebCap, uGoldLight, uGoldLevel, uBridgeLight, uBridgeLevel, uBloom, uRim, uRimMove, uDark, uAspect, uTime, uFoodOn, uWither, uWitherLevel, uLift;\n' +
    'uniform vec4 uCrumb[' + NCRUMB + ']; uniform int uCrumbN; uniform float uCrumbR;\n' +
    'in vec2 vUv; out vec4 o;\n' +
    'void main() {\n' +
    '  vec2 q = vec2(vUv.x, 1.0 - vUv.y);\n' +
    '  vec4 t = textureLod(uTrail, vUv, 0.0), g1 = textureLod(uTrail, vUv, 2.0), g2 = textureLod(uTrail, vUv, 3.5);\n' +
    '  float web = uWebCap * (1.0 - exp(-pow(t.r / uWebLevel, 1.4)));\n' +
    '  float gold = 1.0 - exp(-pow(t.g / uGoldLevel, 1.2)), bridge = 1.0 - exp(-pow(t.b / uBridgeLevel, 1.2));\n' +
    '  float glowG = 1.0 - exp(-(g1.g * 0.6 + g2.g * 0.4) / uGoldLevel), glowB = 1.0 - exp(-(g1.b * 0.6 + g2.b * 0.4) / uBridgeLevel);\n' +
    '  float wither = uWither * (1.0 - exp(-t.a / uWitherLevel));\n' +
    '  vec3 col = max(vec3(0.84, 0.56, 0.22) * web, vec3(0.95, 0.55, 0.16) * wither);\n' +
    '  vec3 gcol = mix(vec3(0.80, 0.42, 0.08), vec3(1.0, 0.74, 0.30), smoothstep(0.0, 0.55, gold));\n' +   // amber -> gold -> pale gold
    '  gcol = mix(gcol, vec3(1.0, 0.84, 0.48), smoothstep(0.6, 1.0, gold));\n' +   // gold tops out a little below white: white is for bridges
    '  col += gcol * gold * uGoldLight;\n' +
    '  float beat = pow(0.5 + 0.5 * cos(6.2831853 * uTime / uPulseS), 2.0);\n' +   // bridges throb, about once every PULSE_S
    '  col += vec3(1.0, 0.97, 0.88) * bridge * uBridgeLight * (0.5 + 0.5 * beat);\n' +
    '  col += (vec3(0.9, 0.52, 0.14) * glowG + vec3(1.0, 0.80, 0.45) * glowB) * uBloom;\n' +
    '  vec4 b = bodyAt(q);\n' +
    '  float rimD = b.b - 0.9; float rim = exp(-rimD * rimD / 0.3) * b.a * uFoodOn * (uRim + uRimMove * freshAt(q));\n' +
    '  rim *= 0.4 + 0.6 * vnoise(vec2(q.x * uAspect, q.y) * 90.0 + vec2(uTime * 0.7, 0.0));\n' +
    '  col += vec3(1.0, 0.72, 0.30) * rim;\n' +
    '  for (int i = 0; i < ' + NCRUMB + '; i++) { if (i >= uCrumbN) break;\n' +
    '    float d = length((q - uCrumb[i].xy) * vec2(uAspect, 1.0)) / uCrumbR;\n' +
    '    col += vec3(1.0, 0.84, 0.50) * uCrumb[i].z * (exp(-d * d * 2.0) * 0.75 + 0.10 * exp(-d * 0.9)); }\n' +
    '  col *= uLift * (1.0 - uDark * smoothstep(0.55, 0.8, b.r));\n' +   // uLift: music (1 = unchanged)
    '  o = vec4(min(col, vec3(1.0)), 1.0);\n' +
    '}\n';

  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Gold Threads needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false,
                                          preserveDrawingBuffer: false, powerPreference: 'high-performance'});
    if (!gl) throw new Error('Gold Threads needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is not available');
    var wallK = 2.0;                     // 'Empty wall' knob (1 = the 2026-10-05 picture): lifts the resting web's ceiling (WEB_CAP); gold, bridges, rim, crumbs and the wither ghost are untouched
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
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      made.tex.push(t);
      return t;
    }
    function target(texs) {
      var f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      for (var i = 0; i < texs.length; i++) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texs[i], 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
      made.fb.push(f);
      return f;
    }
    function forget(list, x) { var i = list.indexOf(x); if (i >= 0) list.splice(i, 1); }
    function dropTex(t) { if (t) { forget(made.tex, t); gl.deleteTexture(t); } }
    function dropFb(f) { if (f) { forget(made.fb, f); gl.deleteFramebuffer(f); } }

    var vao = gl.createVertexArray(); made.vao.push(vao);
    gl.bindVertexArray(vao);
    var pAgent = program(VS_TRI, FS_AGENT), pDep = program(VS_DEP, FS_DEP), pDiff = program(VS_TRI, FS_DIFF), pComp = program(VS_TRI, FS_COMP);
    var DRAW2 = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1], DRAW1 = [gl.COLOR_ATTACHMENT0];

    // ------------------------------------------------------------ explorers
    var N = AGENTS_W * AGENTS_H, init0 = new Float32Array(N * 4), init1 = new Float32Array(N * 4);
    for (var i = 0; i < N; i++) {
      init0[i * 4] = Math.random(); init0[i * 4 + 1] = Math.random(); init0[i * 4 + 2] = Math.random() * Math.PI * 2; init0[i * 4 + 3] = 0;
      init1[i * 4 + 2] = 9;
    }
    var stA = [texture(AGENTS_W, AGENTS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init0),
               texture(AGENTS_W, AGENTS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init0)];
    var stB = [texture(AGENTS_W, AGENTS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init1),
               texture(AGENTS_W, AGENTS_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, gl.NEAREST, init1)];
    init0 = init1 = null;
    var stFb = [target([stA[0], stB[0]]), target([stA[1], stB[1]])], cur = 0;

    // ------------------------------------------------------------ the body (Kinect space)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var bodyData = new Float32Array(BW * BH * 4), idData = new Float32Array(BW * BH * 2), freshCell = new Float32Array(BW * BH);
    for (var bi = 0; bi < BW * BH; bi++) { bodyData[bi * 4 + 1] = 40; bodyData[bi * 4 + 2] = 40; }
    var bodyTex = texture(BW, BH, gl.RGBA16F, gl.RGBA, gl.FLOAT, gl.LINEAR, bodyData);
    var idTex = texture(BW, BH, gl.RG16F, gl.RG, gl.FLOAT, gl.LINEAR, idData);   // r = nearest person's id, g = how fresh their edge is

    // ------------------------------------------------------------ the trail map (window space, y up as GL likes it)
    var W = 0, H = 0, TW = 0, TH = 0, trail = [null, null], trailFb = [null, null], tcur = 0, aspect = 1.6;
    function sizeBuffers(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (w === W && h === H) return false;
      for (var j = 0; j < 2; j++) { dropFb(trailFb[j]); dropTex(trail[j]); }
      W = w; H = h; aspect = W / H;
      TW = Math.max(16, Math.round(W * TRAIL_SCALE)); TH = Math.max(16, Math.round(H * TRAIL_SCALE));
      for (var j2 = 0; j2 < 2; j2++) {
        trail[j2] = texture(TW, TH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR_MIPMAP_LINEAR);
        gl.generateMipmap(gl.TEXTURE_2D);
        trailFb[j2] = target([trail[j2]]);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      return true;
    }
    sizeBuffers(canvas.width, canvas.height);

    // ------------------------------------------------------------ bodies -> food
    var body = WallBody.create(kit, {});
    var fd = new Float32Array(BW * BH), src = new Int32Array(BW * BH), groupIds = [], offFor = new Float32Array(BW * BH).fill(1e3);
    var cellFood = new Int16Array(BW * BH), nextFood = 1;
    var cellWall = 0.012, cellAt = -1e9;       // size of a depth cell on the wall (wall heights), re-read every 2 s
    function measureCell(now) {
      if (now - cellAt < 2000) return; cellAt = now;
      var a = kit.toScreen(256, 212), b = kit.toScreen(260, 212), c = kit.toScreen(256, 216);
      if (a && b && c) cellWall = Math.max(0.002, (Math.hypot((b[0] - a[0]) * aspect, b[1] - a[1]) + Math.hypot((c[0] - a[0]) * aspect, c[1] - a[1])) / 2);
    }
    // calm: the depth image in blocks of 8 x 8 cells; a block whose occupancy has not changed for STILL_CALM_S gives less food.
    // Per block, not per person: ids split and merge on real data (a chair flickers into two "people"), blocks do not.
    var CBW = Math.ceil(BW / 8), CBH = Math.ceil(BH / 8), NB = CBW * CBH;
    var blkOcc = new Float32Array(NB), blkN = new Float32Array(NB), blkRef = new Float32Array(NB), blkAge = new Float32Array(NB),
        blkGain = new Float32Array(NB).fill(1), blkLP = new Float32Array(NB), blkMo = new Float32Array(NB);
    for (var bb = 0; bb < BW * BH; bb++) blkN[((bb / BW | 0) >> 3) * CBW + ((bb % BW) >> 3)]++;
    function settle(dtS) {
      var m = body.mask, mo = body.motion, b;
      blkOcc.fill(0); blkMo.fill(0);
      for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) { var k = (y >> 3) * CBW + (x >> 3); blkOcc[k] += m[y * BW + x]; blkMo[k] += mo[y * BW + x]; }
      for (b = 0; b < NB; b++) {
        var occNow = blkOcc[b] / blkN[b], o = blkLP[b] += (occNow - blkLP[b]) * (1 - Math.exp(-dtS / 0.4));
        if (blkMo[b] / blkN[b] > 0.08) { blkRef[b] = blkLP[b] = occNow; blkAge[b] = 0; }          // real movement wakes it at once
        else if (Math.abs(o - blkRef[b]) > 0.12) { blkRef[b] = o; blkAge[b] = 0; } else blkAge[b] += dtS;
      }
      // a person who clearly moves (more than WAKE_MOVE of them changed this frame) wakes every block they cover, so one step
      // feeds the whole of them again; real stillness wobbles around 0.01-0.08, so the bar sits well above that
      body.people.forEach(function (p) {
        if (!(p.moving > WAKE_MOVE)) return;
        for (var by = Math.max(0, Math.floor(p.top * BH) >> 3); by <= Math.min(CBH - 1, Math.floor(p.bottom * BH - 1) >> 3); by++)
          for (var bx = Math.max(0, Math.floor(p.left * BW) >> 3); bx <= Math.min(CBW - 1, Math.floor(p.right * BW - 1) >> 3); bx++) { var q = by * CBW + bx; blkAge[q] = 0; blkRef[q] = blkLP[q]; }
      });
      for (b = 0; b < NB; b++) {
        var k2 = Math.max(0, Math.min(1, (blkAge[b] - STILL_CALM_S) / 8)); k2 = k2 * k2 * (3 - 2 * k2);
        blkGain[b] = 1 - (1 - STILL_CALM_LEVEL) * k2;
      }
    }
    // food distance: from every cell to the nearest person cell (blobs the stage calls people, not speckle), with that person's id
    function buildBody(dtS) {
      var lab = body.label, people = body.people, m = body.mask, sd = body.sdf, mo = body.motion, x, y, i, R2 = 1.4142, kf = Math.exp(-dtS / FRESH_S);
      for (i = 0; i < BW * BH; i++) {
        var L = lab[i];
        // freshness: a cell that becomes part of someone after being empty for a while (you stepped in, or moved there) glistens;
        // an outline that flickers on and off in place (real depth noise, a chair) does not
        if (L >= 0 && people[L]) { fd[i] = 0; src[i] = i; freshCell[i] = offFor[i] > 0.4 ? 1 : freshCell[i] * kf; offFor[i] = 0; }
        else { fd[i] = 1e6; src[i] = -1; freshCell[i] = 0; offFor[i] += dtS; }
      }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; if (!fd[i]) continue;
        var v = fd[i], sv = src[i], c;
        if (x > 0 && (c = fd[i - 1] + 1) < v) { v = c; sv = src[i - 1]; }
        if (y > 0) { if ((c = fd[i - BW] + 1) < v) { v = c; sv = src[i - BW]; }
          if (x > 0 && (c = fd[i - BW - 1] + R2) < v) { v = c; sv = src[i - BW - 1]; }
          if (x < BW - 1 && (c = fd[i - BW + 1] + R2) < v) { v = c; sv = src[i - BW + 1]; } }
        fd[i] = v; src[i] = sv; }
      for (y = BH - 1; y >= 0; y--) for (x = BW - 1; x >= 0; x--) { i = y * BW + x; if (!fd[i]) continue;
        var u = fd[i], su = src[i], c2;
        if (x < BW - 1 && (c2 = fd[i + 1] + 1) < u) { u = c2; su = src[i + 1]; }
        if (y < BH - 1) { if ((c2 = fd[i + BW] + 1) < u) { u = c2; su = src[i + BW]; }
          if (x < BW - 1 && (c2 = fd[i + BW + 1] + R2) < u) { u = c2; su = src[i + BW + 1]; }
          if (x > 0 && (c2 = fd[i + BW - 1] + R2) < u) { u = c2; su = src[i + BW - 1]; } }
        fd[i] = u; src[i] = su; }
      // blobs that nearly touch are one person for bridges (union-find over people, across the boundary between their regions)
      var np = people.length, par = [], gid = [];
      for (var a = 0; a < np; a++) par.push(a);
      function root(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = y * BW + x; if (src[i] < 0 || fd[i] >= GROUP_CELLS) continue;
        var la = lab[src[i]], nb2 = [x < BW - 1 ? i + 1 : -1, y < BH - 1 ? i + BW : -1];
        for (var n2 = 0; n2 < 2; n2++) { var j = nb2[n2]; if (j < 0 || src[j] < 0) continue; var lb = lab[src[j]];
          if (la !== lb && la >= 0 && lb >= 0 && fd[i] + fd[j] + 1 <= GROUP_CELLS) { var ra = root(la), rb = root(lb); if (ra !== rb) par[ra] = rb; } } }
      // each group keeps its food id from frame to frame by overlap with where it was (the stage's ids jump on real data when
      // a blob splits, merges or flickers; a food id that jumps would drain everyone's gold and fake bridges)
      var area = {}, over = {}, sid = {}, taken = {}, r;
      for (i = 0; i < BW * BH; i++) { if (lab[i] < 0) continue; r = root(lab[i]); area[r] = (area[r] || 0) + 1;
        var pv = cellFood[i]; if (pv) { over[r] = over[r] || {}; over[r][pv] = (over[r][pv] || 0) + 1; } }
      Object.keys(area).map(Number).sort(function (u, v) { return area[v] - area[u]; }).forEach(function (rr) {
        var best = 0, bc = 0, ov = over[rr] || {};
        for (var k in ov) if (!taken[k] && ov[k] > bc) { bc = ov[k]; best = +k; }
        if (best && bc >= 0.25 * area[rr]) sid[rr] = best; else { sid[rr] = nextFood; nextFood = nextFood % 999 + 1; }
        taken[sid[rr]] = true;
      });
      for (i = 0; i < BW * BH; i++) cellFood[i] = lab[i] >= 0 ? sid[root(lab[i])] : 0;
      groupIds = [];
      for (a = 0; a < np; a++) { gid.push(sid[root(a)] || 0); if (gid[a] && groupIds.indexOf(gid[a]) < 0) groupIds.push(gid[a]); }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) {
        i = y * BW + x; var near = fd[i] < 40 && src[i] >= 0, sc = near ? src[i] : 0;
        bodyData[i * 4] = m[i]; bodyData[i * 4 + 1] = sd[i]; bodyData[i * 4 + 2] = Math.min(40, fd[i]);
        bodyData[i * 4 + 3] = near ? blkGain[(y >> 3) * CBW + (x >> 3)] : 0;
        idData[i * 2] = near ? gid[lab[sc]] : 0; idData[i * 2 + 1] = near ? freshCell[sc] : 0;
      }
      gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.FLOAT, bodyData);
      gl.bindTexture(gl.TEXTURE_2D, idTex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RG, gl.FLOAT, idData);
    }

    // ------------------------------------------------------------ fingertips -> crumbs
    var crumbs = [], fallback = [], crumbU = new Float32Array(NCRUMB * 4), crumbSeq = 0, crumbsDropped = 0;
    function fingersFrame(nowS) {
      var f = kit.fingers, nowD = Date.now(), pts = [];
      if (f && Array.isArray(f.pts) && nowD - f.t <= 160) pts = f.pts;
      else { fallback = fallback.filter(function (p) { return nowD - p.t < 400; }); pts = fallback.map(function (p) { return [p.x, p.y]; }); }
      for (var i = 0; i < pts.length && i < 4; i++) {
        var p = pts[i]; if (!p || !(p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1)) continue;
        var best = null, bd = CRUMB_SPACING;
        crumbs.forEach(function (c) { var d = Math.hypot((c.x - p[0]) * aspect, c.y - p[1]); if (d < bd) { bd = d; best = c; } });
        if (best) best.last = nowS;
        else {
          if (crumbs.length >= CRUMB_MAX) crumbs.shift();
          var kin = null, kd = CRUMB_SPACING * 2.5;     // a dragged finger: the new crumb belongs to the same line (no bridges along it)
          crumbs.forEach(function (c) { var d = Math.hypot((c.x - p[0]) * aspect, c.y - p[1]); if (nowS - c.last < 0.35 && d < kd) { kd = d; kin = c; } });
          crumbs.push({x: p[0], y: p[1], born: nowS, last: nowS, id: kin ? kin.id : 1001 + (crumbSeq++ % 900)}); crumbsDropped++;
        }
      }
      crumbs = crumbs.filter(function (c) { return nowS - c.last < CRUMB_S + 2; });
      crumbU.fill(0);
      crumbs.forEach(function (c, k) {
        var age = nowS - c.last, s = Math.min(1, (nowS - c.born) / 0.08 + 0.3) * (age < CRUMB_S ? 1 : Math.max(0, 1 - (age - CRUMB_S) / 2));
        crumbU[k * 4] = c.x; crumbU[k * 4 + 1] = c.y; crumbU[k * 4 + 2] = s; crumbU[k * 4 + 3] = c.id;
      });
    }

    // ------------------------------------------------------------ passes
    var mLift = 1, mGrow = 1;
    var simT = 0, wallT = 0, frames = 0, steps = 0, acc = 0, foodOn = 0, presentU = new Float32Array(24), presentN = 0, seenAt = {};
    function presentIds() {                  // the food sources that exist right now (a bridge needs both of its ends)
      presentN = 0;
      if (foodOn > 0.5) groupIds.forEach(function (g) { seenAt[g] = simT; });
      Object.keys(seenAt).map(Number).sort(function (u, v) { return seenAt[v] - seenAt[u]; }).forEach(function (g) {   // a short grace: a
        if (simT - seenAt[g] > PRESENT_GRACE_S) delete seenAt[g]; else if (presentN < 16) presentU[presentN++] = g;   // frame without someone
      });                                                                                                                // is not them leaving
      for (var k = 0; k < crumbs.length && presentN < 24; k++) if (crumbU[k * 4 + 2] > 0.05) presentU[presentN++] = crumbU[k * 4 + 3];
    }
    function bodyUniforms(u, unitBody, unitId) {
      gl.activeTexture(gl.TEXTURE0 + unitBody); gl.bindTexture(gl.TEXTURE_2D, bodyTex); gl.uniform1i(u.uBody, unitBody);
      if (u.uId) { gl.activeTexture(gl.TEXTURE0 + unitId); gl.bindTexture(gl.TEXTURE_2D, idTex); gl.uniform1i(u.uId, unitId); }
      gl.uniformMatrix3fv(u.uHinv, false, body.hinv());
    }
    function step() {
      var nxt = 1 - cur, u = pAgent.u, deg = Math.PI / 180, sc = TW / 1280 / TRAIL_SCALE;   // knob px (1280 wide) -> trail px
      // 1. explorers smell, turn, step, eat
      gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[nxt]); gl.drawBuffers(DRAW2); gl.viewport(0, 0, AGENTS_W, AGENTS_H); gl.disable(gl.BLEND);
      gl.useProgram(pAgent.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stA[cur]); gl.uniform1i(u.uS0, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, stB[cur]); gl.uniform1i(u.uS1, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, trail[tcur]); gl.uniform1i(u.uTrail, 2);
      bodyUniforms(u, 3, 4);
      gl.uniform2f(u.uTpx, 1 / TW, 1 / TH);
      gl.uniform1f(u.uStep, SPEED * mGrow * STEP_S * sc * TRAIL_SCALE); gl.uniform1f(u.uSense, SENSE_DIST * sc * TRAIL_SCALE);
      gl.uniform1f(u.uSA, SENSE_ANGLE * deg); gl.uniform1f(u.uRA, TURN * deg); gl.uniform1f(u.uWob, WOBBLE);
      gl.uniform1f(u.uAspect, aspect); gl.uniform1f(u.uHalf, WEB_LEVEL); gl.uniform1f(u.uSearch, SEARCH); gl.uniform1f(u.uTime, simT);
      gl.uniform1f(u.uRespawn, STEP_S / RESPAWN_S); gl.uniform1f(u.uEdge, EDGE_AVOID);
      gl.uniform1f(u.uForagers, FORAGERS); gl.uniform1f(u.uDash, DASH); gl.uniform1f(u.uScentW, SCENT); gl.uniform1f(u.uScentAway, SCENT_AWAY); gl.uniform1f(u.uScentCells, SCENT_REACH / cellWall);
      gl.uniform1f(u.uFeedCells, FEED_CELLS); gl.uniform1f(u.uFedReach, FED_REACH); gl.uniform1f(u.uBridgeGap, BRIDGE_GAP);
      gl.uniform1f(u.uBridgeMax, BRIDGE_MAX); gl.uniform1f(u.uBridgeReach, BRIDGE_REACH); gl.uniform1f(u.uFoodOn, foodOn);
      gl.uniform4fv(u.uCrumb, crumbU); gl.uniform1i(u.uCrumbN, crumbs.length); gl.uniform1f(u.uCrumbR, CRUMB_R); gl.uniform1f(u.uCrumbScent, CRUMB_SCENT); gl.uniform1f(u.uCrumbW, CRUMB_PULL);
      gl.uniform1ui(u.uFrame, (steps++) >>> 0); gl.uniform1fv(u.uPresent, presentU); gl.uniform1i(u.uPresentN, presentN); gl.uniform1f(u.uBridgeDrop, Math.exp(-STEP_S / 0.4)); gl.uniform1f(u.uFedDrop, Math.exp(-STEP_S / DRAIN_S));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur = nxt;
      // 2. each drops its trail
      gl.bindFramebuffer(gl.FRAMEBUFFER, trailFb[tcur]); gl.drawBuffers(DRAW1); gl.viewport(0, 0, TW, TH);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      var d = pDep.u; gl.useProgram(pDep.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, stA[cur]); gl.uniform1i(d.uS0, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, stB[cur]); gl.uniform1i(d.uS1, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, null);
      gl.uniform1f(d.uDep, DEPOSIT); gl.uniform1f(d.uFedTrail, FED_TRAIL); gl.uniform1f(d.uBridgeTrail, BRIDGE_TRAIL); gl.uniform1f(d.uTime, simT); gl.uniform1f(d.uPulseLen, PULSE_LEN); gl.uniform1f(d.uPulseS, PULSE_S);
      gl.drawArrays(gl.POINTS, 0, N);
      gl.disable(gl.BLEND);
      // 3. the trail blurs and fades
      var tn = 1 - tcur, f = pDiff.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, trailFb[tn]); gl.viewport(0, 0, TW, TH);
      gl.useProgram(pDiff.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, trail[tcur]); gl.uniform1i(f.uTrail, 0);
      bodyUniforms(f, 1, 2);
      gl.uniform4f(f.uDecay, Math.exp(-STEP_S / TRAIL_FADE_S), Math.exp(-STEP_S / GOLD_FADE_S), Math.exp(-STEP_S / BRIDGE_FADE_S), Math.exp(-STEP_S / WITHER_S));
      gl.uniform1f(f.uSpread, SPREAD); gl.uniform1f(f.uErase, 1 - Math.exp(-STEP_S / 0.08));
      gl.uniform1f(f.uEdge, EDGE_AVOID); gl.uniform1f(f.uAspect, aspect); gl.uniform1f(f.uEdgeFade, 1 - Math.exp(-STEP_S / 0.05));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      tcur = tn;
      simT += STEP_S;
    }
    function render() {
      gl.bindTexture(gl.TEXTURE_2D, trail[tcur]); gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.drawBuffers([gl.BACK]); gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.BLEND);
      var c = pComp.u; gl.useProgram(pComp.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, trail[tcur]); gl.uniform1i(c.uTrail, 0);
      bodyUniforms(c, 1, 2);
      gl.uniform1f(c.uPulseS, PULSE_S); gl.uniform1f(c.uWebLevel, WEB_LEVEL); gl.uniform1f(c.uWebCap, Math.min(1, WEB_CAP * wallK)); gl.uniform1f(c.uGoldLight, GOLD_LIGHT); gl.uniform1f(c.uGoldLevel, GOLD_LEVEL);
      gl.uniform1f(c.uBridgeLight, BRIDGE_LIGHT); gl.uniform1f(c.uBridgeLevel, BRIDGE_LEVEL); gl.uniform1f(c.uBloom, BLOOM); gl.uniform1f(c.uRim, RIM); gl.uniform1f(c.uRimMove, RIM_MOVE); gl.uniform1f(c.uWither, WITHER_LIGHT); gl.uniform1f(c.uWitherLevel, GOLD_LEVEL * WITHER_S / GOLD_FADE_S * 0.5);
      gl.uniform1f(c.uLift, mLift); gl.uniform1f(c.uDark, DARK_INSIDE); gl.uniform1f(c.uAspect, aspect); gl.uniform1f(c.uTime, simT); gl.uniform1f(c.uFoodOn, foodOn);
      gl.uniform4fv(c.uCrumb, crumbU); gl.uniform1i(c.uCrumbN, crumbs.length); gl.uniform1f(c.uCrumbR, CRUMB_R);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }

    // the empty web exists from the first frame
    function warm(n) { for (var k = 0; k < n; k++) step(); }
    measureCell(performance.now());
    warm(150);

    // ------------------------------------------------------------ per frame
    var lastFrameMs = -1, staleFor = 0, heldUpload = true;
    function frame(dt, now) {
      if (destroyed) return;
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0));
      var m = kit.music ? kit.music() : null, e = m && m.enabled && m.fresh ? m.amount : 0, bass = e ? e * m.bands[0] : 0, mid = e ? e * m.bands[1] : 0, high = e ? e * m.bands[2] : 0, beat = e ? e * m.pulse : 0;
      mLift = Math.min(1.8, 1 + 0.8 * beat + 0.25 * bass); mGrow = Math.min(1.6, 1 + 1.5 * mid);   // music: beat flashes the threads, mid speeds their growth
      frames++; wallT += dt;
      if (canvas.width !== W || canvas.height !== H) { if (sizeBuffers(canvas.width, canvas.height)) warm(60); }
      measureCell(now);
      var fresh = body.update(dt, now);
      if (fresh) {
        var dtS = lastFrameMs > 0 ? Math.min(0.2, Math.max(0, (body.frameMs - lastFrameMs) / 1000)) : 0;
        lastFrameMs = body.frameMs;
        settle(dtS); buildBody(dtS); staleFor = 0; heldUpload = false;
      } else if (!body.fresh) {
        staleFor += dt;
        if (staleFor > STALL_HOLD_S && !heldUpload) { buildBody(dt); var any = false, mk = body.mask; for (var j = 0; j < mk.length; j++) if (mk[j] > 0) { any = true; break; } heldUpload = !any; }
      }
      foodOn = staleFor <= STALL_HOLD_S ? 1 : Math.exp(-(staleFor - STALL_HOLD_S) / 0.25);
      fingersFrame(simT); presentIds();
      acc += dt; var n = 0;
      while (acc >= STEP_S && n < MAX_STEPS) { step(); acc -= STEP_S; n++; }
      if (n === MAX_STEPS) acc = Math.min(acc, STEP_S);
      render();
    }
    function touch(t) {
      if (!t) return;                          // sparse touches: only used while kit.fingers is silent
      var nowD = Date.now(), near = null;
      fallback.forEach(function (p) { if (Math.hypot(p.x - t.x, p.y - t.y) < 0.08) near = p; });
      if (near) { near.x = t.x; near.y = t.y; near.t = nowD; return; }
      fallback.push({x: t.x, y: t.y, t: nowD});
      if (fallback.length > 4) fallback.shift();
    }
    function resize(w, h) { if (sizeBuffers(w, h)) warm(60); }
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.GoldthreadsSet === set) delete window.GoldthreadsSet;
      if (window.GoldthreadsWake === wake) delete window.GoldthreadsWake;
      kit.wantDepth(false);
      made.fb.forEach(function (f) { gl.deleteFramebuffer(f); });
      made.tex.forEach(function (t) { gl.deleteTexture(t); });
      made.prog.forEach(function (p) { gl.deleteProgram(p); });
      made.vao.forEach(function (v) { gl.deleteVertexArray(v); });
      made = {tex: [], fb: [], prog: [], vao: []};
      if (window.__goldthreadsDebug) try { delete window.__goldthreadsDebug; } catch (e) { window.__goldthreadsDebug = undefined; }
    }
    kit.wantDepth(true);

    function set(opts) {
      if (!opts || destroyed) return {speed: SPEED, sense: SENSE_DIST, wall: wallK};
      if (typeof opts.wall === 'number' && Number.isFinite(opts.wall)) wallK = Math.max(0.5, Math.min(3, opts.wall));
      if (Number.isFinite(opts.speed)) SPEED = Math.max(20, Math.min(150, opts.speed));
      if (Number.isFinite(opts.sense)) SENSE_DIST = Math.max(6, Math.min(40, opts.sense));
      return {speed: SPEED, sense: SENSE_DIST, wall: wallK};
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      var force = true;
      try {
        if (typeof touch === 'function') touch({id: 'wake', x: sx, y: sy, first: true, _wake: true});
      } catch (e) {}
    }
    window.GoldthreadsSet = set;
    window.GoldthreadsWake = wake;
    if (window._goldthreadsFx) set(window._goldthreadsFx);

    if (window.WallTest) {   // sandbox only (the live wall has no WallTest): readbacks of the trail map and the explorers, for the tests
      window.__goldthreadsDebug = function (o) {
        o = o || {};
        var out = {simT: +simT.toFixed(2), wallT: +wallT.toFixed(2), frames: frames, steps: steps, grid: [W, H], trail: [TW, TH],
                   people: body.people.length, present: Array.prototype.slice.call(presentU, 0, presentN), crumbIds: crumbs.map(function (c) { return c.id; }), crumbs: crumbs.length, crumbsDropped: crumbsDropped, foodOn: +foodOn.toFixed(2), cellWall: +cellWall.toFixed(4),
                   calm: +Math.min.apply(null, Array.prototype.filter.call(blkGain, function (g, k) { return blkLP[k] > 0.05; }).concat([1])).toFixed(2)};
        if (o.boxes) {                       // trail means (r = network, g = gold, b = bridge) in window boxes [x0, y0, x1, y1]
          var px = new Float32Array(TW * TH * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, trailFb[tcur]); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, TW, TH, gl.RGBA, gl.FLOAT, px);
          out.trailBoxes = o.boxes.map(function (b) {
            var x0 = Math.floor(b[0] * TW), x1 = Math.ceil(b[2] * TW), y0 = Math.floor((1 - b[3]) * TH), y1 = Math.ceil((1 - b[1]) * TH), s = [0, 0, 0], n = 0, mx = [0, 0, 0];
            for (var y = Math.max(0, y0); y < Math.min(TH, y1); y++) for (var x = Math.max(0, x0); x < Math.min(TW, x1); x++) {
              var k = (y * TW + x) * 4; n++; for (var c = 0; c < 3; c++) { s[c] += px[k + c]; if (px[k + c] > mx[c]) mx[c] = px[k + c]; } }
            return {web: n ? +(s[0] / n).toFixed(3) : 0, gold: n ? +(s[1] / n).toFixed(3) : 0, bridge: n ? +(s[2] / n).toFixed(3) : 0,
                    max: mx.map(function (v) { return +v.toFixed(2); })};
          });
        }
        if (o.grid) {                        // the network (r) in a coarse grid of gx x gy boxes, for "has it changed" checks
          var gp = new Float32Array(TW * TH * 4), gx = o.grid[0], gy = o.grid[1], g = new Float32Array(gx * gy), gn = new Float32Array(gx * gy);
          gl.bindFramebuffer(gl.FRAMEBUFFER, trailFb[tcur]); gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, TW, TH, gl.RGBA, gl.FLOAT, gp);
          for (var yy = 0; yy < TH; yy++) for (var xx = 0; xx < TW; xx++) { var gi = Math.min(gy - 1, Math.floor((1 - (yy + 0.5) / TH) * gy)) * gx + Math.min(gx - 1, Math.floor((xx + 0.5) / TW * gx));
            g[gi] += Math.min(gp[(yy * TW + xx) * 4], 60); gn[gi]++; }
          out.grid = Array.prototype.map.call(g, function (v, k) { return +(v / gn[k]).toFixed(3); });
        }
        if (o.agents) {                      // explorers in window boxes: how many, how many fed, how many carry a bridge charge
          var a0 = new Float32Array(N * 4), a1 = new Float32Array(N * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, stFb[cur]);
          gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, AGENTS_W, AGENTS_H, gl.RGBA, gl.FLOAT, a0);
          gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, AGENTS_W, AGENTS_H, gl.RGBA, gl.FLOAT, a1);
          gl.readBuffer(gl.COLOR_ATTACHMENT0);
          out.agentBoxes = o.agents.map(function (b) {
            var n = 0, fed = 0, br = 0, ends = {};
            for (var i = 0; i < N; i++) { var x = a0[i * 4], y = a0[i * 4 + 1]; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
              n++; if (a0[i * 4 + 3] > 0.3) fed++;
              if (a1[i * 4 + 1] > 0.3) { br++; var e = a1[i * 4] + '>' + Math.floor(a1[i * 4 + 3]); ends[e] = (ends[e] || 0) + 1; } }
            return {n: n, fed: fed, bridge: br, bridgeEnds: ends};
          });
        }
        if (o.cells) {                       // the body cells as text: # = person, + = food ring, . = mask only, space = nothing
          var rows = [];
          for (var y = 0; y < BH; y += 3) { var r = ''; for (var x = 0; x < BW; x += 2) { var k = y * BW + x;
            r += body.label[k] >= 0 ? '#' : fd[k] < 3 ? '+' : body.mask[k] > 0.5 ? '.' : ' '; } rows.push(r); }
          out.cells = rows.join('\n');
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        out.glError = gl.getError();
        return out;
      };
    }
    return {frame: frame, touch: touch, resize: resize, destroy: destroy};
  }
})();
