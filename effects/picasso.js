/* Picasso · Cubist Mirror (id: picasso) - paintings round 2 (2026-10-08), built by Claude (paintings round 2).
 *
 * THE PAINTING: an original Synthetic-Cubism canvas fills the wall: flat interlocking planes in ochre, umber, slate blue, cream and
 * black, patterned with dots, stripes, wood grain, harlequin diamonds, newsprint and music staves. Three musicians are assembled from
 * those planes (a guitarist in a bowler hat, a horn player in a tall split hat, a seated violinist in a beret), with a table, a bottle,
 * a glass and two playing cards. Every face is a two-way face: one eye seen from the front, one in profile. With nobody there the
 * planes slide one at a time, slowly, like a deck of cards being reshuffled.
 *
 * PLAY: step up and the wall around you SHATTERS: a crack wave (glowing cracks) races out from you and the painting breaks into big
 * angular planes, cut by more straight cracks the closer they are to you. The planes show YOU from other viewpoints: copies of your
 * figure shifted to either side, mirrored, turned, a moment (up to 1.4 s) late, and your head enlarged 2.6x with a two-way Cubist face
 * on it (one eye from the front, one in profile). So a moving person becomes a multi-view Cubist portrait. Move and more planes crack;
 * a big jump sends out another wave. Tap the wall and the plane under your hand bursts into a fan of wedges that tumble and settle back.
 * Stand still and the wall mends around you. Walk away and the small cracks heal in a few seconds; the big planes keep your views and
 * show the painting knocked out of line, then slide back into place and vanish over roughly 20-30 s (longer with `memory`).
 *
 * LIGHT ON PEOPLE: the knob `inside` (default 0.15) dims the picture where a person's own body is, so the person is a dark shadow
 * figure at the centre of their own shattered reflections, and the projector is not shining into anyone's eyes. The face glyphs
 * therefore live on the heads INSIDE the facets (the views of you), never on your real face.
 *
 * HOW: WebGL 2, one file, no assets. The painting is procedural polygons drawn into a texture each frame (group transforms do the
 * reshuffle). A persistent fracture field (wall space, float) is written by people (via the shared WallBody stage), crack waves and
 * taps; it heals fast down to a "scar" level, then fades over `memory`. Planes are big Voronoi cells that appear where the field passes
 * a threshold, split by up to 10 straight cuts (plus radial cracks at a tap) as it rises. A ring of the last ~2 s of body masks feeds
 * the views (one view per big cell, chosen from six person-relative viewpoints); a full-resolution keepsake buffer stores what the
 * planes showed, so the views outlive the person, then slide and fade. Something that stays put (even on noisy depth) habituates.
 * Needs plugins/body.js (WallBody). One depth client (via the host).
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ tuning (the dials; plain English)
  var KNOBS = {                       // key: [min, max, default]
    shatter: [0.3, 2, 1],             // how far and how hard the wall cracks around a person (1 = about a body-width all round)
    memory: [10, 120, 35],            // how long the big cracked planes linger after people leave (fade time constant, s)
    tumble: [0, 2, 1],                // how wildly tapped pieces spin before they fall back into place
    inside: [0, 1, 0.15],             // brightness of the picture ON a person (0.15 = dark shadow figure, keeps light off faces)
    shuffle: [0, 2, 1]                // how lively the empty painting is (planes sliding like cards); 0 = still
  };
  var ZONE_CELLS = 15;      // radius of the cracked zone around a person, in depth cells (about 11 px of wall each)
  var HEAL_S = 3;           // once the cause is gone, the small cuts heal with this time constant (s)...
  var SCAR = 0.23;         // ...down to big planes (this fracture level), which then fade over `memory` seconds
  var CALM_S = 9;           // around someone standing still the facets mend with this time constant (s)
  var MOVE_ON = 0.06;       // a person whose smoothed movement rises above this counts as moving...
  var MOVE_OFF = 0.03;      // ...and as standing still once it stays below this for QUIET_MS
  var QUIET_MS = 1600;
  var ACT_ON = 0.12, ACT_OFF = 0.06;   // ...or whose outline box changes faster than ACT_ON (share of the image per s); calm needs both low
  var JUMP_V = 0.15;        // a jump (centre rising or falling faster than this, share of the image per s) sends out another crack wave...
  var MOVE_BIG = 0.25;      // ...and so does very lively movement (a big fast arm swing)...
  var WAVE_GAP_MS = 1500;   // ...at most this often per person
  var WAVE_SPEED = 0.8;     // crack-wave speed (wall heights per second)
  var WAVE_REACH = 0.45;    // how far an arrival crack wave travels (wall heights)
  var TAP_R = 0.15;         // a tap shatters this radius (wall heights): the plane under the hand bursts into wedges
  var TAP_REACH = 0.38;     // and sends a crack wave this far
  var TAP_AGAIN_S = 1.5;    // a touch within 0.1 of any touch in the last TAP_AGAIN_S is the same hand (a drag, not a new tap)
  var IMPACT_S = 4;         // a tap's radial cracks last this long
  var WAKE_R0 = 0.035, WAKE_S0 = 0.012;   // the bridge's normal touch (PicassoWake radius, strength): treated as one normal tap
  var SPIN_S = 1.3;         // tapped pieces settle back with this time constant (s)
  var VIEW_FADE_S = 14;     // after you leave, your silhouette in the facets fades with this time constant (s)
  var HABIT_S = 15;         // something that stays in one spot (within HABIT_MOVE) this long stops cracking the wall...
  var HABIT_FADE_S = 5;     // ...fading out over this long (a noisy still object, a chair, must not keep the wall shattered)
  var HABIT_MOVE = 0.08;    // moving this far quickly (centre smoothed over 3 s, share of the depth image) counts as new again
  var HABIT_FLOOR = 0.35;   // a habituated person whose outline still changes keeps this much of the cracking
  var LINGER_MS = 800;      // a person missing from depth for less than this is the same person (no new crack wave)
  var RING = 64;            // depth frames remembered (~2.1 s) for the "different moment" facets
  var DELAY_STEP = 0.24;    // the views can look back 0, 0.24, ... 1.68 s (the six viewpoints use up to 1.44 s)
  var SHUFFLE_EVERY = 3.6;  // a new card starts sliding this often (s, at shuffle 1)
  var SLIDE_S = 8;          // each slide takes this long (s)
  var THR = [0.12, 0.24, 0.6, 0.94];    // fracture where a big plane appears; where its first cut and its last (10th) cut switch on
  var FIELD_W = 160, FIELD_H = 100;     // fracture field resolution

  registerWallPlugin({id: 'picasso', title: 'Picasso · Cubist Mirror', author: 'Claude (paintings round 2)', create: create});

  // ------------------------------------------------------------------ palette (sRGB 0..1)
  var PAL = [[.78, .58, .24], [.88, .72, .38], [.30, .20, .13], [.50, .34, .20], [.64, .34, .18], [.28, .38, .52], [.48, .58, .68],
             [.13, .18, .29], [.86, .81, .67], [.06, .055, .05], [.38, .42, .30], [.72, .46, .40], [.74, .70, .58]];
  var OCH = 0, OCH2 = 1, UMB = 2, UMB2 = 3, SIE = 4, SLA = 5, SLA2 = 6, NAV = 7, OFF = 8, BLK = 9, GRN = 10, ROS = 11, NEWS = 12;
  var PLAIN = 0, DOTS = 1, STRIPES = 2, WOOD = 3, DIAM = 4, STAVES = 5, NEWSP = 6, CHECK = 7, HATCH = 8;
  function glslVec3(c) { return 'vec3(' + c.map(function (v) { return v.toFixed(3); }).join(',') + ')'; }

  // ------------------------------------------------------------------ the painting (authored in wall units: x 0..1.6, y 0..1 down)
  function compose() {
    var polys = [], OL = 0.0027;
    function add(pts, g, ca, cb, pat, ps, pa, ol) {
      polys.push({pts: pts, g: g, ca: ca, cb: cb === undefined ? ca : cb, pat: pat || 0, ps: ps || 0.03, pa: pa || 0, ol: ol === undefined ? OL : ol});
    }
    function rr(cx, cy, w, h, r, g, ca, cb, pat, ps, pa, ol) {
      var c = Math.cos(r), s = Math.sin(r), pts = [];
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) { var x = k[0] * w / 2, y = k[1] * h / 2; pts.push([cx + c * x - s * y, cy + s * x + c * y]); });
      add(pts, g, ca, cb, pat, ps, pa, ol);
    }
    function ell(cx, cy, rx, ry, g, ca, cb, pat, ps, pa, ol, a0, a1, n) {
      a0 = a0 || 0; a1 = a1 === undefined ? Math.PI * 2 : a1; n = n || 30;
      var pts = [], full = Math.abs(a1 - a0) >= 6.28;
      if (!full) pts.push([cx, cy]);
      for (var i = 0; i < (full ? n : n + 1); i++) { var a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
      add(pts, g, ca, cb, pat, ps, pa, ol);
    }
    function line(ax, ay, bx, by, w, g, col) {
      var dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * w, ny = dx / L * w;
      add([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]], g, col, col, 0, 1, 0, 0);
    }
    function hand(cx, cy, r, g) {          // a Cubist hand: a cream block with finger lines
      rr(cx, cy, 0.042, 0.03, r, g, OFF, OFF, 0, 1, 0, 0.0022);
      var c = Math.cos(r), s = Math.sin(r);
      for (var k = -1; k <= 1; k++) { var x = k * 0.011; line(cx + c * x - s * -0.015, cy + s * x + c * -0.015, cx + c * x - s * 0.006, cy + s * x + c * 0.006, 0.0016, g, BLK); }
    }
    function frontEye(cx, cy, w, g) { ell(cx, cy, w, w * 0.48, g, OFF, OFF, 0, 1, 0, 0.0022); ell(cx, cy, w * 0.34, w * 0.34, g, BLK, BLK, 0, 1, 0, 0); }
    function profEye(cx, cy, w, g, dir) { add([[cx - dir * w, cy - w * 0.55], [cx + dir * w, cy], [cx - dir * w, cy + w * 0.55]], g, BLK, BLK, 0, 1, 0, 0); }

    // ---- background cards
    add([[0, 0], [1.6, 0], [1.6, 1], [0, 1]], 0, UMB, UMB2, HATCH, 0.03, 0.4, 0);
    add([[0, 0], [0.60, 0], [0.50, 0.52], [0, 0.60]], 1, SLA, SLA, PLAIN);
    rr(0.21, 0.105, 0.36, 0.17, -0.07, 2, NEWS, UMB, NEWSP, 0.0135, -0.07);
    add([[0.56, 0], [1.02, 0], [0.98, 0.22], [0.54, 0.26]], 3, NAV, SLA, HATCH, 0.02, 0);
    line(0.78, 0.0, 0.76, 0.24, 0.006, 3, BLK); line(0.55, 0.12, 1.0, 0.105, 0.006, 3, BLK);
    add([[0.98, 0.03], [1.30, 0.0], [1.33, 0.36], [1.02, 0.40]], 4, ROS, OFF, DOTS, 0.03, 0.15);
    add([[1.28, 0], [1.6, 0], [1.6, 0.58], [1.32, 0.64]], 5, OCH, OCH, PLAIN);
    add([[1.47, 0], [1.6, 0], [1.6, 1], [1.52, 1]], 6, NAV, SLA2, STRIPES, 0.05, 0);
    add([[0.52, 0.26], [0.64, 0.22], [0.70, 0.88], [0.55, 0.90]], 7, BLK, BLK, PLAIN);
    add([[0, 0.58], [0.20, 0.54], [0.17, 0.92], [0, 0.94]], 8, GRN, GRN, PLAIN);
    add([[1.06, 0.38], [1.34, 0.34], [1.40, 0.70], [1.08, 0.74]], 9, SLA2, SLA, HATCH, 0.018, -0.6);
    add([[0, 0.90], [1.6, 0.86], [1.6, 1], [0, 1]], 10, OCH2, UMB2, DIAM, 0.075, 0);
    add([[0.70, 0.60], [0.97, 0.56], [0.99, 0.87], [0.72, 0.89]], 11, OCH2, OCH2, PLAIN);
    // stencilled letters on the newsprint (an invented fragment, "CAF")
    var Lw = 0.0085, G2 = 2;
    for (var i = 0; i <= 8; i++) { var a0 = Math.PI * (0.32 + 1.36 * i / 8), a1 = Math.PI * (0.32 + 1.36 * (i + 1) / 8);
      if (i < 8) line(0.095 + Math.cos(a0) * 0.032, 0.11 + Math.sin(a0) * 0.04, 0.095 + Math.cos(a1) * 0.032, 0.11 + Math.sin(a1) * 0.04, Lw, G2, BLK); }
    line(0.15, 0.152, 0.18, 0.068, Lw, G2, BLK); line(0.18, 0.068, 0.21, 0.15, Lw, G2, BLK); line(0.162, 0.122, 0.2, 0.12, Lw, G2, BLK);
    line(0.235, 0.066, 0.232, 0.15, Lw, G2, BLK); line(0.235, 0.068, 0.285, 0.064, Lw, G2, BLK); line(0.234, 0.105, 0.272, 0.102, Lw, G2, BLK);

    // ---- music stand (between the guitarist and the horn player)
    line(0.625, 0.55, 0.63, 0.88, 0.004, 26, BLK); line(0.63, 0.86, 0.59, 0.90, 0.004, 26, BLK); line(0.63, 0.86, 0.67, 0.90, 0.004, 26, BLK);
    rr(0.625, 0.47, 0.13, 0.17, 0.06, 26, OFF, BLK, STAVES, 0.11, 0.06);

    // ---- figure A: the guitarist (bowler hat), left
    add([[0.22, 0.70], [0.31, 0.70], [0.30, 0.91], [0.21, 0.92]], 15, UMB2, UMB2, PLAIN);
    add([[0.32, 0.70], [0.41, 0.70], [0.43, 0.91], [0.33, 0.91]], 15, BLK, BLK, PLAIN);
    add([[0.17, 0.90], [0.30, 0.89], [0.30, 0.935], [0.16, 0.945]], 15, OCH, OCH, PLAIN);
    add([[0.33, 0.89], [0.47, 0.89], [0.48, 0.935], [0.33, 0.935]], 15, SLA2, SLA2, PLAIN);
    add([[0.19, 0.33], [0.45, 0.32], [0.49, 0.72], [0.16, 0.73]], 12, SLA, OFF, DOTS, 0.032, 0.2);
    add([[0.16, 0.41], [0.235, 0.39], [0.225, 0.73], [0.16, 0.73]], 12, BLK, BLK, PLAIN, 0.03, 0, 0);
    add([[0.36, 0.33], [0.45, 0.32], [0.47, 0.50], [0.37, 0.52]], 12, OCH, UMB, STRIPES, 0.022, 0.5);
    add([[0.27, 0.32], [0.37, 0.32], [0.32, 0.405]], 12, OFF, OFF, PLAIN);
    add([[0.42, 0.335], [0.50, 0.355], [0.56, 0.325], [0.545, 0.29], [0.47, 0.305]], 12, UMB, UMB, PLAIN);
    add([[0.19, 0.40], [0.25, 0.38], [0.32, 0.56], [0.27, 0.59]], 12, SLA2, SLA2, PLAIN);
    ell(0.285, 0.605, 0.09, 0.09, 14, OCH, UMB2, WOOD, 0.012, 0.75);
    ell(0.367, 0.508, 0.067, 0.067, 14, OCH, UMB2, WOOD, 0.012, 0.75);
    ell(0.332, 0.556, 0.03, 0.03, 14, BLK, BLK, PLAIN);
    add((function () { var a = [0.39, 0.475], b = [0.60, 0.255], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L * 0.017, ny = dx / L * 0.017;
      return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]; })(), 14, UMB, UMB, PLAIN);
    rr(0.617, 0.237, 0.055, 0.038, -0.8, 14, BLK, BLK, PLAIN);
    rr(0.262, 0.634, 0.045, 0.013, -0.81, 14, BLK, BLK, PLAIN, 1, 0, 0);
    for (var s = -1.5; s <= 1.5; s += 1) { var o = s * 0.0068, nx = 0.724, ny = 0.69; line(0.262 + nx * o, 0.634 + ny * o, 0.60 + nx * o, 0.255 + ny * o, 0.0011, 14, OFF); }
    hand(0.552, 0.296, -0.6, 12); hand(0.305, 0.583, 0.35, 12);
    add([[0.30, 0.285], [0.345, 0.285], [0.345, 0.335], [0.30, 0.335]], 13, UMB2, UMB2, PLAIN);
    add([[0.262, 0.17], [0.322, 0.17], [0.322, 0.315], [0.276, 0.296], [0.258, 0.232]], 13, OFF, OFF, PLAIN);
    add([[0.322, 0.17], [0.368, 0.176], [0.374, 0.214], [0.408, 0.252], [0.372, 0.264], [0.369, 0.292], [0.322, 0.315]], 13, OCH2, OCH2, PLAIN);
    frontEye(0.292, 0.224, 0.019, 13); profEye(0.352, 0.222, 0.012, 13, 1);
    line(0.276, 0.203, 0.308, 0.201, 0.0022, 13, BLK); line(0.33, 0.285, 0.36, 0.279, 0.0028, 13, BLK); line(0.322, 0.17, 0.322, 0.315, 0.0022, 13, BLK);
    ell(0.318, 0.172, 0.064, 0.058, 13, BLK, BLK, PLAIN, 1, 0, 0.0027, Math.PI, Math.PI * 2, 20);
    rr(0.318, 0.176, 0.18, 0.017, -0.03, 13, BLK, BLK, PLAIN);

    // ---- figure B: the horn player (tall split hat), centre
    add([[0.73, 0.66], [0.81, 0.66], [0.80, 0.88], [0.72, 0.88]], 19, SLA, SLA, PLAIN);
    add([[0.83, 0.66], [0.91, 0.66], [0.93, 0.88], [0.84, 0.88]], 19, UMB2, UMB2, PLAIN);
    add([[0.69, 0.87], [0.81, 0.865], [0.81, 0.905], [0.68, 0.91]], 19, BLK, BLK, PLAIN);
    add([[0.84, 0.865], [0.97, 0.865], [0.98, 0.905], [0.84, 0.905]], 19, OCH, OCH, PLAIN);
    add([[0.71, 0.31], [0.93, 0.30], [0.96, 0.67], [0.69, 0.68]], 16, OCH2, UMB2, STRIPES, 0.045, -0.4);
    add([[0.83, 0.33], [0.95, 0.32], [0.965, 0.56], [0.845, 0.57]], 16, SLA, SLA, PLAIN);
    add([[0.69, 0.50], [0.76, 0.48], [0.77, 0.68], [0.69, 0.68]], 16, BLK, BLK, PLAIN, 1, 0, 0);
    add([[0.77, 0.30], [0.87, 0.30], [0.82, 0.38]], 16, OFF, OFF, PLAIN);
    add([[0.72, 0.34], [0.78, 0.33], [0.955, 0.305], [0.965, 0.345], [0.80, 0.40]], 16, SLA2, SLA2, PLAIN);
    add([[0.90, 0.345], [0.95, 0.335], [1.02, 0.305], [1.03, 0.345], [0.97, 0.385]], 16, UMB, UMB, PLAIN);
    add((function () { var a = [0.87, 0.268], b = [1.10, 0.298], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L * 0.012, ny = dx / L * 0.012;
      return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]; })(), 18, OCH2, OCH2, PLAIN);
    add([[1.09, 0.282], [1.185, 0.215], [1.205, 0.395], [1.09, 0.316]], 18, OCH, OCH, PLAIN);
    ell(1.194, 0.305, 0.019, 0.083, 18, BLK, BLK, PLAIN, 1, 0, 0.0022);
    [0.95, 0.982, 1.014].forEach(function (x) { rr(x, 0.254, 0.012, 0.03, 0.13, 18, BLK, BLK, PLAIN, 1, 0, 0); rr(x - 0.002, 0.236, 0.02, 0.008, 0.13, 18, OFF, OFF, PLAIN, 1, 0, 0.0015); });
    hand(0.958, 0.296, 0.15, 16); hand(1.035, 0.305, 0.15, 16);
    add([[0.775, 0.155], [0.825, 0.155], [0.825, 0.292], [0.782, 0.282], [0.768, 0.222]], 17, OFF, OFF, PLAIN);
    add([[0.825, 0.155], [0.866, 0.16], [0.869, 0.20], [0.902, 0.236], [0.869, 0.246], [0.866, 0.292], [0.825, 0.292]], 17, SLA2, SLA2, PLAIN);
    frontEye(0.797, 0.207, 0.018, 17); profEye(0.848, 0.198, 0.011, 17, 1);
    line(0.783, 0.186, 0.812, 0.184, 0.0022, 17, BLK); line(0.825, 0.155, 0.825, 0.292, 0.0022, 17, BLK);
    add([[0.815, 0.015], [0.877, 0.158], [0.815, 0.158]], 17, OCH, OCH, PLAIN);
    add([[0.815, 0.015], [0.815, 0.158], [0.753, 0.158]], 17, BLK, BLK, PLAIN);

    // ---- table and still life (right, in front of the violinist's legs)
    // ---- figure C: the seated violinist (beret), right
    add([[1.33, 0.36], [1.40, 0.36], [1.40, 0.80], [1.33, 0.80]], 23, BLK, BLK, PLAIN);
    add([[1.17, 0.60], [1.37, 0.60], [1.37, 0.68], [1.17, 0.69]], 23, UMB2, UMB2, PLAIN);
    add([[1.27, 0.68], [1.35, 0.68], [1.37, 0.89], [1.28, 0.89]], 23, SLA, SLA, PLAIN);
    add([[1.26, 0.875], [1.40, 0.87], [1.41, 0.91], [1.26, 0.915]], 23, OCH, OCH, PLAIN);
    add([[1.16, 0.34], [1.38, 0.33], [1.40, 0.62], [1.15, 0.63]], 20, UMB, UMB2, WOOD, 0.011, 0.1);
    add([[1.15, 0.345], [1.235, 0.34], [1.22, 0.62], [1.15, 0.625]], 20, OCH, OCH, PLAIN);
    add([[1.22, 0.33], [1.31, 0.33], [1.265, 0.41]], 20, OFF, OFF, PLAIN);
    add([[1.34, 0.36], [1.40, 0.38], [1.36, 0.50], [1.30, 0.48]], 20, SLA2, SLA2, PLAIN);
    hand(1.325, 0.49, 0.5, 20);
    ell(1.147, 0.482, 0.047, 0.047, 22, SIE, UMB, WOOD, 0.009, 0.8);
    ell(1.203, 0.426, 0.036, 0.036, 22, SIE, UMB, WOOD, 0.009, 0.8);
    line(1.135, 0.455, 1.15, 0.47, 0.0028, 22, BLK); line(1.175, 0.475, 1.19, 0.49, 0.0028, 22, BLK);
    add((function () { var a = [1.19, 0.44], b = [1.07, 0.56], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L * 0.008, ny = dx / L * 0.008;
      return [[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]; })(), 22, BLK, BLK, PLAIN, 1, 0, 0);
    ell(1.062, 0.569, 0.015, 0.015, 22, UMB2, UMB2, PLAIN); ell(1.062, 0.569, 0.005, 0.005, 22, BLK, BLK, PLAIN, 1, 0, 0);
    line(1.03, 0.36, 1.38, 0.52, 0.0028, 22, OFF); rr(1.36, 0.511, 0.03, 0.014, 0.43, 22, BLK, BLK, PLAIN, 1, 0, 0);
    add([[1.222, 0.20], [1.322, 0.20], [1.226, 0.336]], 21, OFF, OFF, PLAIN);
    add([[1.322, 0.20], [1.328, 0.33], [1.226, 0.336]], 21, SLA, SLA, PLAIN);
    frontEye(1.252, 0.236, 0.017, 21); profEye(1.30, 0.272, 0.011, 21, -1);
    line(1.276, 0.215, 1.258, 0.296, 0.0024, 21, BLK); line(1.258, 0.296, 1.284, 0.3, 0.0024, 21, BLK); line(1.245, 0.318, 1.29, 0.312, 0.0028, 21, BLK);
    ell(1.272, 0.203, 0.064, 0.036, 21, BLK, BLK, PLAIN, 1, 0, 0.0027, Math.PI, Math.PI * 2, 18);
    add([[0.98, 0.64], [1.32, 0.62], [1.36, 0.76], [0.96, 0.79]], 24, UMB2, UMB, WOOD, 0.01, 0.06);
    add([[0.96, 0.79], [1.36, 0.76], [1.36, 0.80], [0.96, 0.83]], 24, BLK, BLK, PLAIN);
    add([[0.985, 0.83], [1.015, 0.83], [1.015, 0.90], [0.985, 0.90]], 24, BLK, BLK, PLAIN);
    add([[1.02, 0.52], [1.08, 0.52], [1.08, 0.70], [1.02, 0.70]], 25, GRN, NAV, STRIPES, 0.03, 0);
    add([[1.04, 0.45], [1.06, 0.45], [1.06, 0.52], [1.04, 0.52]], 25, GRN, GRN, PLAIN);
    add([[1.025, 0.58], [1.075, 0.58], [1.075, 0.635], [1.025, 0.635]], 25, OFF, BLK, NEWSP, 0.008, 0);
    add([[1.10, 0.56], [1.165, 0.56], [1.15, 0.625], [1.115, 0.625]], 25, SLA2, SLA2, PLAIN);
    line(1.133, 0.625, 1.133, 0.67, 0.003, 25, BLK); ell(1.133, 0.672, 0.022, 0.006, 25, SLA2, SLA2, PLAIN, 1, 0, 0.002);
    rr(1.215, 0.69, 0.075, 0.052, 0.25, 25, OFF, OFF, PLAIN);
    ell(1.209, 0.682, 0.008, 0.008, 25, BLK, BLK, PLAIN, 1, 0, 0); ell(1.2, 0.694, 0.008, 0.008, 25, BLK, BLK, PLAIN, 1, 0, 0);
    ell(1.217, 0.695, 0.008, 0.008, 25, BLK, BLK, PLAIN, 1, 0, 0); line(1.208, 0.695, 1.205, 0.712, 0.0025, 25, BLK);
    rr(1.28, 0.715, 0.07, 0.05, -0.18, 25, OFF, OFF, PLAIN);
    add([[1.28, 0.697], [1.292, 0.715], [1.28, 0.733], [1.268, 0.715]], 25, SIE, SIE, PLAIN, 1, 0, 0);
    return polys;
  }
  // which groups slide, and how far (wall units / radians)
  var MOVABLE = [[1, .035], [2, .03], [3, .03], [4, .035], [5, .03], [6, .02], [7, .03], [8, .03], [9, .03], [10, .015], [11, .03],
                 [12, .016], [13, .024], [14, .02], [15, .012], [16, .016], [17, .024], [18, .02], [19, .012], [20, .016], [21, .024],
                 [22, .02], [23, .012], [24, .015], [25, .02], [26, .025]];
  var NG = 32;

  function inTri(p, a, b, c) {
    var d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1]), d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1]),
        d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1]);
    return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
  }
  function triangulate(pts) {               // ear clipping (polygons are small; a fan if it ever gets stuck)
    var n = pts.length, idx = [], out = [], i, area = 0;
    for (i = 0; i < n; i++) { idx.push(i); var a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    var sg = area > 0 ? 1 : -1, guard = 0;
    while (idx.length > 3 && guard++ < 400) {
      var found = false;
      for (var k = 0; k < idx.length; k++) {
        var i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length], A = pts[i0], B = pts[i1], C = pts[i2];
        if (((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) * sg <= 1e-12) continue;
        var blocked = false;
        for (var m = 0; m < idx.length && !blocked; m++) { var j = idx[m]; if (j !== i0 && j !== i1 && j !== i2 && inTri(pts[j], A, B, C)) blocked = true; }
        if (blocked) continue;
        out.push(i0, i1, i2); idx.splice(k, 1); found = true; break;
      }
      if (!found) break;
    }
    if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
    else for (var f = 1; f < idx.length - 1; f++) out.push(idx[0], idx[f], idx[f + 1]);
    return out;
  }
  // vertex: x, y, group, ca rgb, cb rgb, pattern id, pattern scale, pattern angle  (12 floats)
  function buildGeometry(polys) {
    var v = [], piv = new Float32Array(NG * 2), cnt = new Float32Array(NG);
    function vert(p, P, ca, cb, pat, ps, pa) { v.push(p[0], p[1], P.g, ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], pat, ps, pa); }
    polys.forEach(function (P) {
      var ca = PAL[P.ca], cb = PAL[P.cb], t = triangulate(P.pts), i;
      for (i = 0; i < t.length; i++) vert(P.pts[t[i]], P, ca, cb, P.pat, P.ps, P.pa);
      P.pts.forEach(function (p) { piv[P.g * 2] += p[0]; piv[P.g * 2 + 1] += p[1]; cnt[P.g]++; });
      if (P.ol > 0) {
        var w = P.ol, n = P.pts.length, K = PAL[BLK];
        for (i = 0; i < n; i++) {
          var a = P.pts[i], b = P.pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
          if (L < 1e-6) continue;
          var ux = dx / L * w, uy = dy / L * w, nx = -uy, ny = ux;
          var q = [[a[0] - ux + nx, a[1] - uy + ny], [b[0] + ux + nx, b[1] + uy + ny], [b[0] + ux - nx, b[1] + uy - ny], [a[0] - ux - nx, a[1] - uy - ny]];
          [0, 1, 2, 0, 2, 3].forEach(function (k) { vert(q[k], P, K, K, 0, 1, 0); });
        }
      }
    });
    for (var g = 0; g < NG; g++) if (cnt[g]) { piv[g * 2] /= cnt[g]; piv[g * 2 + 1] /= cnt[g]; }
    return {data: new Float32Array(v), count: v.length / 12, piv: piv};
  }

  // ------------------------------------------------------------------ shaders
  var HEAD = '#version 300 es\nprecision highp float;precision highp int;precision highp sampler2DArray;\n';
  var VS_FULL = '#version 300 es\nout vec2 vUv;\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));vUv=p;gl_Position=vec4(p*2.-1.,0.,1.);}\n';
  var LIB = [
    'vec2 h22(vec2 p){vec3 a=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));a+=dot(a,a.yzx+33.33);return fract((a.xx+a.yz)*a.zy);}',
    'float h12(vec2 p){vec3 a=fract(vec3(p.xyx)*.1031);a+=dot(a,a.yzx+33.33);return fract((a.x+a.y)*a.z);}',
    'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h12(i),h12(i+vec2(1,0)),f.x),mix(h12(i+vec2(0,1)),h12(i+vec2(1,1)),f.x),f.y);}',
    'mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}',
    // q is in pattern units (one repeat = 1); w = one pixel in those units (explicit, so no derivatives inside branches)
    'vec3 pattern(int k,vec2 q,vec3 ca,vec3 cb,float w){',
    '  w=clamp(w,1e-4,.45);',
    '  if(k==1){vec2 g=q;g.x+=.5*mod(floor(g.y),2.);float d=length(fract(g)-.5);return mix(ca,cb,1.-smoothstep(.27-w,.27+w,d));}',
    '  if(k==2){float t=abs(fract(q.x)-.5);return mix(ca,cb,smoothstep(.25-w,.25+w,t));}',
    '  if(k==3){vec2 kc=(floor(q/vec2(9.,5.))+.5)*vec2(9.,5.)+(h22(floor(q/vec2(9.,5.)))-.5)*vec2(5.,2.);vec2 kd=(q-kc)*vec2(.42,1.);',
    '    float v=q.y+.6*sin(q.x*.33+1.3)+.22*sin(q.x*1.07+q.y*.2)+1.3*exp(-dot(kd,kd)*.7);',
    '    float l=abs(fract(v)-.5);vec3 c=mix(ca,mix(ca,cb,.22),step(.5,fract(v*.5)));return mix(c,cb,smoothstep(.36-w,.36+w,l)*.9);}',
    '  if(k==4){vec2 r=vec2(q.x,q.y*.62);float u=r.x+r.y,v=r.x-r.y;vec3 c=mix(ca,cb,mod(floor(u)+floor(v),2.));',
    '    float e=min(min(fract(u),1.-fract(u)),min(fract(v),1.-fract(v)));return mix(c,vec3(.06,.055,.05),(1.-smoothstep(.035-w,.035+w,e))*.85);}',
    '  if(k==5){float row=floor(q.y),f=fract(q.y),y5=(f-.14)/.085;float inb=step(-.12,y5)*step(y5,4.12);',
    '    float l=abs(fract(y5+.5)-.5)*.085;float ln=inb*(1.-smoothstep(.011-w,.011+w,l));',
    '    float n=floor(q.x*2.4);float hn=h12(vec2(n,row+3.));vec2 nc=vec2((n+.5)/2.4,row+.14+.0425*floor(hn*9.));',
    '    vec2 d=rot(-.45)*(q-nc);float note=step(.28,hn)*(1.-smoothstep(1.-w*20.,1.+w*20.,length(d*vec2(20.,30.))));',
    '    float stem=step(.28,hn)*(1.-smoothstep(.009-w,.009+w,abs(q.x-nc.x-.045)))*step(nc.y-.25,q.y)*step(q.y,nc.y);',
    '    float bd=(.5-abs(fract(q.x*.6)-.5))/.6;float bar=inb*(1.-smoothstep(.01-w,.01+w,bd));',
    '    return mix(ca,cb,max(max(ln,note),max(stem,bar)));}',
    '  if(k==6){float row=floor(q.y),f=fract(q.y);float ink=step(.3,f)*step(f,.7);float colx=mod(q.x,22.);float gut=step(20.5,colx);',
    '    float wi=floor(q.x*.5+h12(vec2(row,3.))*7.);float word=step(.2,h12(vec2(wi,row)));float hd=step(.85,h12(vec2(floor(q.x/22.),floor(row/9.))));',
    '    float m=ink*(1.-gut)*word*(.6+.4*step(.45,fract(q.x*2.1)));return mix(ca,cb,m*(.55+.3*hd));}',
    '  if(k==7){return mix(ca,cb,mod(floor(q.x)+floor(q.y),2.));}',
    '  if(k==8){float t=abs(fract(q.x+q.y)-.5);return mix(ca,cb,smoothstep(.37-w,.37+w,t)*.8);}',
    '  return ca;',
    '}',
    'const vec3 PAL[13]=vec3[13](' + PAL.map(glslVec3).join(',') + ');'
  ].join('\n') + '\n';

  // Cubist planes: big Voronoi cells (S0 wall heights apart) appear where the fracture passes THR[0]; inside a shown cell up to
  // CUTS straight cuts (near-vertical, near-horizontal or diagonal) switch on one by one as the fracture at each cut's anchor rises,
  // splitting the cell into angular planes. regionAt() gives the plane under a pixel: an id, an estimated centre, and border ink.
  var CUTS = 10;
  var HIER = [
    'uniform sampler2D uField;uniform float uAsp;uniform vec4 uThr;uniform float uLineK;uniform vec4 uImp[4];',
    'vec4 fld(vec2 q){return textureLod(uField,vec2(q.x/uAsp,1.-q.y),0.);}',
    'const float S0=.22;',
    'float cutThr(float k){return uThr.y+(uThr.w-uThr.y)*k/' + (CUTS - 1) + '.;}',
    'int regionAt(vec2 p,float px,out vec2 cs,out vec2 rc,out vec2 rid,out float show,out float line){',
    '  vec2 g=floor(p/S0);vec2 ss[9];float bd=1e9;int bi=0;',
    '  for(int j=0;j<3;j++)for(int i=0;i<3;i++){vec2 c=g+vec2(float(i-1),float(j-1));vec2 s=(c+.5+(h22(c)-.5)*.72)*S0;ss[j*3+i]=s;vec2 d=p-s;float dd=dot(d,d);if(dd<bd){bd=dd;bi=j*3+i;}}',
    '  vec2 s=ss[bi];vec2 gid=g+vec2(float(bi-(bi/3)*3-1),float(bi/3-1));',
    '  float m=1e9;vec2 c0=s;',
    '  for(int n=0;n<9;n++){if(n==bi)continue;vec2 o=ss[n];vec2 dv=o-s;float d=dot(.5*(s+o)-p,dv/max(length(dv),1e-6));if(d<m){m=d;c0=o;}}',
    '  float F0=fld(s).r;bool on=F0>uThr.x;show=smoothstep(uThr.x,uThr.x+.015,F0);',
    '  line=0.;if(on||fld(c0).r>uThr.x){float w=3.4*px*uLineK;line=1.-smoothstep(w-px*.8,w+px*.8,m);}',
    '  float code=0.;rc=s;',
    '  if(on){for(int k=0;k<' + CUTS + ';k++){float fk=float(k);vec2 hk=h22(gid*1.7+fk*3.1+.5);vec2 c=s+(hk-.5)*S0*.95;',
    '    if(fld(c).r>cutThr(fk)){float hz=h12(gid+fk*7.7);float a=floor(hz*4.)*.7854+(h12(gid.yx+fk*2.3)-.5)*.36;vec2 n=vec2(cos(a),sin(a));',
    '      float sd=dot(p-c,n);float sgn=step(0.,sd);code+=sgn*exp2(fk);rc+=(sgn*2.-1.)*n*S0*.1;',
    '      float w=(2.7-.13*fk)*px*uLineK;line=max(line,1.-smoothstep(w-px*.8,w+px*.8,abs(sd)));}}\n' +
    '    for(int i=0;i<4;i++){vec4 im=uImp[i];if(im.w<=0.)continue;int ib=0;float b2=1e9;for(int n=0;n<9;n++){vec2 d=im.xy-ss[n];float dd=dot(d,d);if(dd<b2){b2=dd;ib=n;}}\n' +
    '      if(ib!=bi||fld(im.xy).r<uThr.z)continue;for(int k=0;k<6;k++){float fk=float(k);float a=im.z+fk*.5236+(h12(im.xy*91.+fk)-.5)*.3;vec2 n=vec2(cos(a),sin(a));\n' +
    '        float sd=dot(p-im.xy,n);float sgn=step(0.,sd);code+=sgn*exp2(10.+fk+float(i)*6.);rc+=(sgn*2.-1.)*n*S0*.07;\n' +
    '        float w=1.9*px*uLineK;line=max(line,1.-smoothstep(w-px*.8,w+px*.8,abs(sd)));}}}',
    '  cs=s;rid=gid*17.31+vec2(code*.731,code*1.377)+vec2(3.,5.);return on?1:0;',
    '}'
  ].join('\n') + '\n';

  var VS_IDLE = '#version 300 es\nin vec2 aPos;in float aGrp;in vec3 aCa;in vec3 aCb;in vec3 aPat;\n' +
    'uniform vec4 uG[' + NG + '];uniform vec2 uPiv[' + NG + '];\n' +
    'out vec2 vP;out vec3 vCa;out vec3 vCb;flat out vec3 vPat;\n' +
    'void main(){int g=int(aGrp+.5);vec4 t=uG[g];vec2 pv=uPiv[g];float c=cos(t.z),s=sin(t.z);vec2 q=aPos-pv;q=vec2(c*q.x-s*q.y,s*q.x+c*q.y)+pv+t.xy;\n' +
    'vP=aPos;vCa=aCa;vCb=aCb;vPat=aPat;gl_Position=vec4(q.x/1.6*2.-1.,1.-q.y*2.,0.,1.);}\n';
  var FS_IDLE = HEAD + LIB +
    'in vec2 vP;in vec3 vCa;in vec3 vCb;flat in vec3 vPat;uniform float uPx;out vec4 o;\n' +
    'void main(){float sc=vPat.y,an=vPat.z;vec2 q=rot(-an)*vP/sc;vec3 c=pattern(int(vPat.x+.5),q,vCa,vCb,uPx/sc);\n' +
    '  vec2 b=rot(-(an+.6))*vP;float n=vn(b*vec2(13.,64.))*.6+vn(b*vec2(37.,150.))*.4;c*=.92+.13*n;o=vec4(c,1.);}\n';

  var FS_FIELD = HEAD +
    'uniform sampler2D uPrev,uSrc;uniform mat3 uHinv;uniform float uDt,uAsp,uMem,uCalm,uSpinT,uRise,uMotK,uLin,uWaveW,uScar,uHeal;\n' +
    'uniform vec4 uWave[4];uniform vec4 uTap[8];uniform vec4 uTapB[8];in vec2 vUv;out vec4 o;\n' +
    'void main(){vec4 f=texture(uPrev,vUv);vec2 p=vec2(vUv.x*uAsp,1.-vUv.y);\n' +
    '  vec3 h=uHinv*vec3(vUv.x,1.-vUv.y,1.);vec2 k=h.xy/max(h.z,1e-6);float inK=(h.z>0.&&k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;\n' +
    '  vec4 s=texture(uSrc,clamp(k,0.,1.))*inK;float target=(s.r+s.g*uMotK)*1.25;float F=f.r,spinT=0.,flashT=0.;\n' +
    '  for(int i=0;i<4;i++){vec4 w=uWave[i];if(w.w<=0.)continue;float x=(length(p-w.xy)-w.z)/uWaveW;float ring=exp(-x*x)*w.w;F=max(F,ring*.62);flashT=max(flashT,ring);}\n' +
    '  for(int i=0;i<8;i++){vec4 t=uTap[i];if(t.w<=0.)continue;float d=length(p-t.xy);float fall=1.-smoothstep(t.z*.6,t.z,d);float f2=1.-smoothstep(t.z*.9,t.z*1.7,d);vec4 b=uTapB[i];\n' +
    '    F=max(F,b.z*fall*t.w);spinT=max(spinT,b.x*f2*t.w);flashT=max(flashT,b.y*fall*t.w);}\n' +
    '  float rise=max(0.,target-F)*(1.-exp(-uDt*uRise));F+=rise;\n' +
    '  float tau=mix(uMem,uCalm,clamp(s.b,0.,1.));if(target<F)F=max(target,F-(max(0.,F-uScar)/uHeal+F/tau+uLin)*uDt);F=clamp(F,0.,1.25);\n' +
    '  float flash=max(f.g*exp(-uDt/.7),max(flashT,clamp(rise/max(uDt,1e-3)*.07,0.,1.)));float spin=max(f.b*exp(-uDt/uSpinT),spinT);\n' +
    '  o=vec4(F,min(flash,1.),min(spin,1.5),0.);}\n';

  // the facets' views of people, written into the keepsake buffer where people are (and kept where they are not).
  // Seven viewpoints, relative to each person (offsets in body heights): each plane (a big facet) picks the nearer of two at random,
  // so displaced, turned, mirrored, enlarged-head and delayed copies of the person surround them, cut up by the planes.
  var VIEWS = [  // offset x, offset y (body heights), turn (rad), sample scale (<1 = enlarged), mirror, delay class, anchor (0 body, 1 head)
    [-0.15, 0.0, -0.12, 1.0, 0, 2, 0], [0.16, 0.0, 0.10, 1.0, 1, 0, 0], [0.15, -0.03, 0.0, 0.38, 0, 0, 1],
    [-0.15, -0.03, 0.12, 0.38, 1, 1, 1], [0.25, 0.03, -0.2, 1.15, 0, 4, 0], [-0.26, 0.02, 0.18, 1.0, 1, 6, 0]];
  var NV = VIEWS.length;
  var FS_KEEP = HEAD + LIB + HIER +
    'uniform sampler2D uPrevP,uSrc;uniform sampler2DArray uHist;uniform mat3 uHinv;\n' +
    'uniform float uDL[8];uniform vec4 uHead[24];uniform vec4 uBody[24];uniform float uWrite,uDt,uRecT,uPx;in vec2 vUv;out vec4 o;\n' +
    'const vec4 VA['+NV+']=vec4['+NV+'](' + VIEWS.map(function (v) { return 'vec4(' + v.slice(0, 4).map(function (x) { return x.toFixed(3); }).join(',') + ')'; }).join(',') + ');\n' +
    'const ivec3 VB['+NV+']=ivec3['+NV+'](' + VIEWS.map(function (v) { return 'ivec3(' + v.slice(4).join(',') + ')'; }).join(',') + ');\n' +
    'vec2 toK(vec2 q){vec3 h=uHinv*vec3(q.x/uAsp,q.y,1.);return h.xy/max(h.z,1e-6);}\n' +
    'float maskAt(vec2 q,float layer){vec2 k=toK(q);if(k.x<0.||k.x>1.||k.y<0.||k.y>1.)return 0.;return textureLod(uHist,vec3(k,layer),0.).r;}\n' +
    'float sg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}\n' +
    // the two-way face: front almond eye + pupil on the left, profile eye (a chevron) and a jutting profile nose on the right, mouth, brow
    'float glyph(vec2 u,float aa){vec2 e=u-vec2(-.36,-.12);float d=abs(length(e/vec2(.3,.14))-1.)*.14;d=min(d,length(e)-.07);\n' +
    '  vec2 t=u-vec2(.36,-.14);d=min(d,max(abs(t.y)-.1*(1.-clamp((t.x+.11)/.22,0.,1.)),abs(t.x)-.11));\n' +
    '  d=min(d,sg(u,vec2(0.,-.38),vec2(.18,.17)));d=min(d,sg(u,vec2(.18,.17),vec2(-.01,.23)));\n' +
    '  d=min(d,sg(u,vec2(-.28,.5),vec2(.22,.46)));\n' +
    '  return 1.-smoothstep(.045-aa,.045+aa,d);}\n' +
    'int nearestP(int cls,vec2 s,vec2 off){int pj=-1;float pd=1e9;for(int j=0;j<3;j++){vec4 b=uBody[cls*3+j];if(b.w<.5)continue;float d=length(s-b.xy-off*b.z);if(d<pd){pd=d;pj=j;}}return pj;}\n' +
    'void main(){vec4 prev=textureLod(uPrevP,vUv,0.);vec2 p=vec2(vUv.x*uAsp,1.-vUv.y);\n' +
    '  vec2 k=toK(p);float inK=(k.x>=0.&&k.x<=1.&&k.y>=0.&&k.y<=1.)?1.:0.;float w=textureLod(uSrc,clamp(k,0.,1.),0.).a*inK*uWrite;\n' +
    '  float rec=prev.b*exp(-uDt/uRecT);\n' +
    '  if(w<.004){o=vec4(prev.rg,rec,prev.a);return;}\n' +
    '  vec2 cs,ps,pid;float show,line;int L=regionAt(p,uPx,cs,ps,pid,show,line)-1;\n' +
    '  int v=0;float bd=1e9;for(int c=0;c<4;c++){int vc=int(h12(cs*13.7+float(c)*1.9)*' + NV + '.*.999);vec4 a=VA[vc];int aj=nearestP(0,cs,a.xy);\n' +
    '    if(aj<0)continue;vec4 bb=uBody[aj],hh=uHead[aj];bool hv=VB[vc].z==1&&hh.w>.5;vec2 an=hv?hh.xy:bb.xy;float d=length(cs-an-a.xy*bb.z)*(hv?.55:1.);if(d<bd){bd=d;v=vc;}}\n' +
    '  vec4 va=VA[v];ivec3 vb=VB[v];float layer=uDL[vb.y];\n' +
    '  int pj=nearestP(vb.y,cs,va.xy);float cov=0.,gy=0.,hf=0.;\n' +
    '  if(pj>=0&&L>=0){vec4 b=uBody[vb.y*3+pj],hd=uHead[vb.y*3+pj];vec2 anc=vb.z==1&&hd.w>.5?hd.xy:b.xy;\n' +
    '    vec2 d=rot(va.z)*(p-anc-va.xy*b.z)*va.w;if(vb.x==1)d.x=-d.x;vec2 q=anc+d;\n' +
    '    cov=smoothstep(.3,.7,maskAt(q,layer));vec2 u=(q-hd.xy)/max(hd.z,1e-3);\n' +
    '    gy=glyph(u,uPx*va.w/max(hd.z,1e-3)*1.3)*step(.5,hd.w);hf=(length(u*vec2(1.,.8))<1.05&&hd.w>.5)?(u.x>0.?1.:.5):0.;}\n' +
    '  vec3 nv=vec3(cov,gy*cov,hf*cov);\n' +
    '  o=vec4(mix(prev.rg,nv.xy,w),max(rec,w),mix(prev.a,nv.z,w));}\n';

  var NSTY = 14;
  // plane styles: base colour, second colour, pattern, silhouette colour, silhouette second colour, silhouette pattern.
  // Mostly dark and mid planes, so the person's (light) views are the brightest thing on the wall.
  var STY = [[OCH, UMB2, PLAIN, BLK, BLK, PLAIN], [NAV, SLA, STRIPES, OCH2, OFF, PLAIN], [UMB, UMB2, WOOD, OFF, OCH2, DOTS],
             [SLA2, SLA, PLAIN, NAV, NAV, PLAIN], [SIE, UMB, PLAIN, OFF, OFF, PLAIN], [GRN, UMB, HATCH, OCH2, OFF, PLAIN],
             [OCH2, UMB2, DIAM, BLK, BLK, PLAIN], [BLK, BLK, PLAIN, OFF, OFF, PLAIN], [ROS, OFF, DOTS, BLK, BLK, PLAIN],
             [NEWS, BLK, NEWSP, SIE, SIE, PLAIN], [SLA, OFF, DOTS, OCH2, OCH2, PLAIN], [UMB2, UMB, PLAIN, OFF, OCH2, STRIPES],
             [OCH, UMB, STRIPES, NAV, NAV, PLAIN], [SLA2, SLA, CHECK, BLK, BLK, PLAIN]];
  var FS_COMP = HEAD + LIB + HIER +
    'uniform sampler2D uIdle,uP,uLive,uSrc;uniform mat3 uHinv;uniform float uInside,uPx,uTumble,uIdleOnly,uSlide;in vec2 vUv;out vec4 o;\n' +
    'float presAt(vec2 q){vec3 h=uHinv*vec3(q.x/uAsp,q.y,1.);vec2 k=h.xy/max(h.z,1e-6);if(h.z<=0.||k.x<0.||k.x>1.||k.y<0.||k.y>1.)return 0.;return textureLod(uSrc,k,0.).a;}\n' +
    'const ivec3 STA[' + NSTY + ']=ivec3[' + NSTY + '](' + STY.map(function (s) { return 'ivec3(' + s[0] + ',' + s[1] + ',' + s[2] + ')'; }).join(',') + ');\n' +
    'const ivec3 STB[' + NSTY + ']=ivec3[' + NSTY + '](' + STY.map(function (s) { return 'ivec3(' + s[3] + ',' + s[4] + ',' + s[5] + ')'; }).join(',') + ');\n' +
    'float pscale(int k){return k==1?.028:k==2?.04:k==3?.011:k==4?.06:k==5?.1:k==6?.012:k==7?.045:k==8?.016:.05;}\n' +
    'vec2 uvOf(vec2 q){return vec2(q.x/uAsp,1.-q.y);}\n' +
    'void main(){vec2 p=vec2(vUv.x*uAsp,1.-vUv.y);vec3 idle=textureLod(uIdle,vUv,0.).rgb;\n' +
    '  vec2 cs,ps,pid;float show,line;int L=regionAt(p,uPx,cs,ps,pid,show,line)-1;vec2 id=pid;\n' +
    '  vec4 fp=fld(p);vec4 fpl=fld(ps);\n' +
    '  float spin=fpl.b*uTumble;float fa=pow(clamp((fpl.r-uThr.x)/.25,0.,1.),.7);\n' +
    '  vec3 hp=vec3(h12(pid+3.3),h12(pid+5.9),h12(pid+8.1));vec3 hl=vec3(h12(id+2.2),h12(id+6.6),h12(id+9.9));\n' +
    '  float ta=(hl.x-.5)*3.6*spin;vec2 toff=(h22(id+13.)-.5)*.07*spin;\n' +
    '  vec2 pt=ps+rot(ta)*(p-ps)*(1.+.35*spin)+toff;\n' +                                        // tumbling pieces
    '  int st=int(hp.y*' + NSTY + '.*.999);ivec3 A=STA[st],B=STB[st];vec3 ca=PAL[A.x],cb=PAL[A.y];\n' +
    '  float pang=(hp.z-.5)*2.4;float psc=pscale(A.z);vec3 pat=pattern(A.z,rot(-pang)*(pt-ps+pid*.001)/psc,ca,cb,uPx/psc);\n' +
    '  vec3 fl=hl.y<.34?pat:hl.y<.44?ca*.78:ca;\n' +   // tonal facets
    '  vec2 qi=ps+rot((hp.x-.5)*.8*fa+ta)*(pt-ps)*(1.+(hp.z-.5)*.5*fa)+(h22(pid+21.)-.5)*.14*fa;\n' +   // the painting seen from elsewhere
    '  vec3 view=textureLod(uIdle,uvOf(qi),0.).rgb;\n' +
    '  float usePaint=step(hp.x,mix(mix(.88,.12,smoothstep(.3,.48,fpl.r)),.1,smoothstep(.2,.7,presAt(ps)))+.4*clamp(spin,0.,1.));vec3 facet=mix(fl,mix(view*.9,fl,.15),usePaint);\n' +
    '  vec4 P0=textureLod(uP,uvOf(pt),0.);float age=1.-clamp(P0.b,0.,1.);\n' +
    '  vec2 slide=(h22(cs*7.3+41.)-.5)*.2*age*uSlide;vec4 P=textureLod(uP,uvOf(pt+slide),0.);\n' +
    '  float vis=smoothstep(.03,.35,P.b);float sil=smoothstep(.35,.65,P.r)*vis;\n' +
    '  float spat=pscale(B.z);vec3 sp=pattern(B.z,rot(-pang-.8)*(pt-ps)/spat,PAL[B.x],PAL[B.y],uPx/spat);\n' +
    '  vec3 silc=hl.z<.55?PAL[B.x]:hl.z<.8?sp:PAL[B.x]*.86;\n' +
    '  float sl=dot(PAL[B.x],vec3(.3,.59,.11));vec3 prof=sl>.4?silc*.66:mix(silc,PAL[8],.35);\n' +
    '  silc=mix(silc,prof,smoothstep(.75,.9,P.a)*step(.2,P.a));\n' +
    '  vec3 gcol=sl>.4?PAL[9]:PAL[8];\n' +
    '  facet=mix(facet,silc,sil);facet=mix(facet,gcol,smoothstep(.3,.6,P.g)*vis*step(.2,sil));\n' +
    '  float pr=P.r;float e=abs(pr-.5)/max(fwidth(pr),1e-4);facet=mix(facet,PAL[9],(1.-smoothstep(1.,2.6,e))*vis*.95);\n' +
    '  vec3 col=mix(idle,facet,L>=0?show:0.);\n' +
    '  vec3 lc=mix(vec3(.05,.045,.04),vec3(1.,.9,.62),clamp(fp.g*1.6,0.,1.));\n' +
    '  col=mix(col,lc,line);\n' +
    '  col=mix(col,idle,uIdleOnly);\n' +
    '  vec3 hk=uHinv*vec3(vUv.x,1.-vUv.y,1.);vec2 kk=hk.xy/max(hk.z,1e-6);float inK=(hk.z>0.&&kk.x>=0.&&kk.x<=1.&&kk.y>=0.&&kk.y<=1.)?1.:0.;\n' +
    '  float live=smoothstep(.35,.75,textureLod(uLive,clamp(kk,0.,1.),0.).r)*inK*(1.-uIdleOnly);\n' +
    '  col*=mix(1.,uInside,live);\n' +
    '  col*=.975+.05*h12(floor(vUv*vec2(1280.,800.)));\n' +
    '  o=vec4(col,1.);}\n';

  // ------------------------------------------------------------------ the piece
  function create(canvas, kit) {
    if (!window.WallBody) throw new Error('Picasso needs plugins/body.js');
    var gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, preserveDrawingBuffer: false});
    if (!gl) throw new Error('Picasso needs WebGL 2');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Picasso needs EXT_color_buffer_float');
    var floatLinear = !!gl.getExtension('OES_texture_float_linear');
    var made = [], destroyed = false, t0Create = performance.now();
    var settings = {};
    Object.keys(KNOBS).forEach(function (k) { settings[k] = KNOBS[k][2]; });

    function shader(type, src) {
      var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { var e = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(e); }
      return s;
    }
    function program(vsSrc, fsSrc, names, attribs) {
      var p = gl.createProgram(), vs = shader(gl.VERTEX_SHADER, vsSrc), fs = shader(gl.FRAGMENT_SHADER, fsSrc);
      gl.attachShader(p, vs); gl.attachShader(p, fs);
      if (attribs) attribs.forEach(function (a, i) { gl.bindAttribLocation(p, i, a); });
      gl.linkProgram(p); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { var e = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(e); }
      made.push(['Program', p]);
      var U = {}; names.forEach(function (n) { U[n] = gl.getUniformLocation(p, n); });
      return {p: p, U: U};
    }
    var HIER_U = ['uField', 'uAsp', 'uThr', 'uLineK', 'uImp'];
    var pIdle = program(VS_IDLE, FS_IDLE, ['uG', 'uPiv', 'uPx'], ['aPos', 'aGrp', 'aCa', 'aCb', 'aPat']);
    var pField = program(VS_FULL, FS_FIELD, ['uPrev', 'uSrc', 'uHinv', 'uDt', 'uAsp', 'uMem', 'uCalm', 'uSpinT', 'uRise', 'uMotK', 'uLin', 'uWaveW', 'uScar', 'uHeal', 'uWave', 'uTap', 'uTapB']);
    var pKeep = program(VS_FULL, FS_KEEP, HIER_U.concat(['uPrevP', 'uSrc', 'uHist', 'uHinv', 'uDL', 'uHead', 'uBody', 'uWrite', 'uDt', 'uRecT', 'uPx']));
    var pComp = program(VS_FULL, FS_COMP, HIER_U.concat(['uIdle', 'uP', 'uLive', 'uSrc', 'uHinv', 'uInside', 'uPx', 'uTumble', 'uIdleOnly', 'uSlide']));

    // painting geometry
    var geo = buildGeometry(compose());
    var vaoIdle = gl.createVertexArray(); made.push(['VertexArray', vaoIdle]);
    var vbo = gl.createBuffer(); made.push(['Buffer', vbo]);
    gl.bindVertexArray(vaoIdle); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, geo.data, gl.STATIC_DRAW);
    [[0, 2, 0], [1, 1, 2], [2, 3, 3], [3, 3, 6], [4, 3, 9]].forEach(function (a) { gl.enableVertexAttribArray(a[0]); gl.vertexAttribPointer(a[0], a[1], gl.FLOAT, false, 48, a[2] * 4); });
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    var vaoFull = gl.createVertexArray(); made.push(['VertexArray', vaoFull]);

    function tex(w, h, ifmt, fmt, type, filter, data) {
      var t = gl.createTexture(); made.push(['Texture', t]);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    function fbo(t) {
      var f = gl.createFramebuffer(); made.push(['Framebuffer', f]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Picasso: framebuffer incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return f;
    }
    function clearFbo(f, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }

    var BW = WallBody.w, BH = WallBody.h, body = WallBody.create(kit, {});
    var N = BW * BH;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    var ff = floatLinear ? gl.LINEAR : gl.NEAREST;
    var fieldT = [tex(FIELD_W, FIELD_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, ff), tex(FIELD_W, FIELD_H, gl.RGBA32F, gl.RGBA, gl.FLOAT, ff)];
    var fieldF = [fbo(fieldT[0]), fbo(fieldT[1])], fi = 0;
    clearFbo(fieldF[0], FIELD_W, FIELD_H); clearFbo(fieldF[1], FIELD_W, FIELD_H);
    var srcT = tex(BW, BH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR), srcU8 = new Uint8Array(N * 4);
    var liveT = tex(BW, BH, gl.R8, gl.RED, gl.UNSIGNED_BYTE, gl.LINEAR), gm = new Uint8Array(N);
    var hist = gl.createTexture(); made.push(['Texture', hist]);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, hist);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R8, BW, BH, RING, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(N * RING));
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.LINEAR); });
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (p) { gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.CLAMP_TO_EDGE); });
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

    var CW = 0, CH = 0, PW = 0, PH = 0, idleT = null, idleF = null, keepT = [null, null], keepF = [null, null], ki = 0;
    function freeSized() {
      [idleT, keepT[0], keepT[1]].forEach(function (t) { if (t) { gl.deleteTexture(t); made = made.filter(function (r) { return r[1] !== t; }); } });
      [idleF, keepF[0], keepF[1]].forEach(function (f) { if (f) { gl.deleteFramebuffer(f); made = made.filter(function (r) { return r[1] !== f; }); } });
      idleT = idleF = null; keepT = [null, null]; keepF = [null, null];
    }
    function allocSized() {
      CW = Math.max(2, canvas.width); CH = Math.max(2, canvas.height);
      PW = CW; PH = CH;
      freeSized();
      idleT = tex(CW, CH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR); idleF = fbo(idleT);
      keepT = [tex(PW, PH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR), tex(PW, PH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR)];
      keepF = [fbo(keepT[0]), fbo(keepT[1])]; clearFbo(keepF[0], PW, PH); clearFbo(keepF[1], PW, PH);
    }
    allocSized();

    // ---- state
    var elapsed = 0, frames = 0, simSteps = 0, firstFrameMs = null;
    var gOff = new Float32Array(NG * 4), moves = [], nextShuffle = 1.5, rngState = 1234567;
    function rnd() { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; }
    var impacts = [], uImp = new Float32Array(16);
    var tracks = [], nextTrack = 1, waves = [], taps = [], prevPts = [], lastTapAt = [], bigMoments = 0, wakes = 0, touches = 0, fingerLandings = 0;
    var ringTimes = new Float64Array(RING).fill(-Infinity), ringHead = -1, lastRec = -1e9;
    var ringHeads = new Float32Array(RING * 12), ringBodies = new Float32Array(RING * 12);
    var uDL = new Float32Array(8), uHead = new Float32Array(96), uBody = new Float32Array(96);
    var uWave = new Float32Array(16), uTap = new Float32Array(32), uTapB = new Float32Array(32);
    var srcActive = false, srcZero = true, livePeak = 0, writing = false, lastFreshMs = -1e9, frameMsLast = 0;
    var trackOfPerson = [], peopleWall = [];
    var asp = 1.6;

    function toWall(u, v) {        // Kinect pixel -> wall units [x (0..asp), y (0..1, down)]
      var s = kit.toScreen(u, v);
      if (!s || !isFinite(s[0]) || !isFinite(s[1])) return [u / 512 * asp, v / 424];
      return [s[0] * asp, s[1]];
    }

    // ---- people: our own short-lived tracks (ids survive depth gaps under LINGER_MS)
    function trackPeople(now, dtF) {
      var ppl = body.people, i, j;
      for (i = 0; i < tracks.length; i++) tracks[i].matched = false;
      trackOfPerson.length = ppl.length; peopleWall.length = ppl.length;
      for (i = 0; i < ppl.length; i++) {
        var p = ppl[i], c = toWall(p.cx * 512, p.cy * 424), best = null, bd = 0.3;
        var top = toWall(p.cx * 512, p.top * 424), bot = toWall(p.cx * 512, p.bottom * 424);
        peopleWall[i] = {x: c[0], y: c[1], h: Math.abs(bot[1] - top[1]), top: top[1]};
        for (j = 0; j < tracks.length; j++) { var t = tracks[j]; if (t.matched) continue; var d = Math.hypot(t.x - c[0], t.y - c[1]); if (d < bd) { bd = d; best = t; } }
        if (!best) { best = {id: nextTrack++, x: c[0], y: c[1], mvS: 0, act: 0, vy: 0, bb: null, anchor: null, anchorT: now, habit: 0, active: true, quietSince: -1, agit: 0, calm: 0, seen: 0, arrived: false, boostUntil: 0, lastWave: -1e9, born: now}; tracks.push(best); }
        best.matched = true; best.x = c[0]; best.y = c[1]; best.lastSeen = now; best.seen++; best.area = p.area; best.h = peopleWall[i].h;
        var k = 1 - Math.exp(-dtF / 0.45); best.mvS += (p.moving - best.mvS) * k; best.moving = p.moving;
        if (best.bb) { var dm = (Math.abs(p.cx - best.bb[4]) + Math.abs(p.cy - best.bb[5]) + 0.5 * (Math.abs(p.left - best.bb[0]) + Math.abs(p.top - best.bb[1]) + Math.abs(p.right - best.bb[2]) + Math.abs(p.bottom - best.bb[3]))) / dtF;
          best.act += (Math.min(3, dm) - best.act) * (1 - Math.exp(-dtF / 0.6)); }
        if (best.bb) best.vy += (Math.abs(p.cy - best.bb[5]) / dtF - best.vy) * (1 - Math.exp(-dtF / 0.12));
        best.bb = [p.left, p.top, p.right, p.bottom, p.cx, p.cy];
        var ks = 1 - Math.exp(-dtF / 3); if (!best.sc) best.sc = [p.cx, p.cy]; else { best.sc[0] += (p.cx - best.sc[0]) * ks; best.sc[1] += (p.cy - best.sc[1]) * ks; }
        if (!best.anchor || Math.hypot(best.sc[0] - best.anchor[0], best.sc[1] - best.anchor[1]) > HABIT_MOVE) { best.anchor = [best.sc[0], best.sc[1]]; best.anchorT = now; best.resets = (best.resets || 0) + 1; }
        else { var ka = 1 - Math.exp(-dtF / 4); best.anchor[0] += (best.sc[0] - best.anchor[0]) * ka; best.anchor[1] += (best.sc[1] - best.anchor[1]) * ka; }   // slow drift (noisy depth) never adds up; walking does
        best.habit = Math.max(0, Math.min(1, ((now - best.anchorT) / 1000 - HABIT_S) / HABIT_FADE_S));
        if (best.mvS > MOVE_ON || best.act > ACT_ON) { best.active = true; best.quietSince = -1; }
        else if (best.mvS < MOVE_OFF && best.act < ACT_OFF) { if (best.quietSince < 0) best.quietSince = now; if (now - best.quietSince > QUIET_MS) best.active = false; }
        else best.quietSince = -1;
        if (!best.arrived && best.seen >= 3 && p.area >= 40) {        // a person stepping up: the big crack wave
          best.arrived = true; best.boostUntil = now + 1600; best.lastWave = now; best.active = true; best.anchorT = now;
          addWave(c[0], c[1] - 0.05, 1.0, WAVE_REACH * settings.shatter); bigMoments++;
        } else if (best.arrived && (best.vy > JUMP_V || best.mvS > MOVE_BIG) && now - best.lastWave > WAVE_GAP_MS && (best.habit || 0) < 0.5) {
          best.lastWave = now; addWave(c[0], c[1] - 0.05, 0.8, WAVE_REACH * 0.8 * settings.shatter); bigMoments++;
        }
        trackOfPerson[i] = best;
      }
      for (j = tracks.length - 1; j >= 0; j--) if (!tracks[j].matched && now - tracks[j].lastSeen > LINGER_MS) tracks.splice(j, 1);
    }
    function updateAgitation(dt, now) {
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i], target = now < t.boostUntil ? 1.12 : t.active ? Math.min(1.05, 0.82 + Math.max(0, t.mvS - MOVE_ON) * 2.5) : 0;
        target *= 1 - (t.habit || 0) * (1 - (t.act > 0.1 ? HABIT_FLOOR : 0));
        t.agit += (target - t.agit) * (1 - Math.exp(-dt / (target > t.agit ? 0.12 : 1.4)));
        t.calm = t.active ? Math.max(0, t.calm - dt * 2) : Math.min(1, t.calm + dt / 2);
      }
    }

    // ---- sources for the field (Kinect space): R crack target, G movement, B calm, A presence (keepsake writing)
    function buildSources() {
      var ppl = body.people, lab = body.label, sdf = body.sdf, mo = body.motion, mask = body.mask, R = Math.min(38, ZONE_CELLS * settings.shatter);
      var nP = ppl.length, any = false, peak = 0, bx = [], i;
      for (i = 0; i < nP; i++) { var p = ppl[i]; bx.push([p.left * BW, p.top * BH, p.right * BW, p.bottom * BH]); }
      for (var y = 0; y < BH; y++) for (var x = 0; x < BW; x++) {
        var c = y * BW + x, k = lab[c], o = c * 4;
        if (k < 0 && nP) { var bdist = 1e9; for (i = 0; i < nP; i++) { var b = bx[i], dx = Math.max(b[0] - x, 0, x - b[2]), dy = Math.max(b[1] - y, 0, y - b[3]), dd = Math.max(dx, dy); if (dd < bdist) { bdist = dd; k = i; } } if (bdist > R * 1.5 + 3) k = -1; }
        if (k < 0) { srcU8[o] = srcU8[o + 1] = srcU8[o + 2] = srcU8[o + 3] = 0; gm[c] = 0; continue; }
        var t = trackOfPerson[k], d = sdf[c], halo = d <= 2 ? 1 : d >= R ? 0 : 1 - (d - 2) / (R - 2);
        var ag = t ? t.agit : 0, r = halo > 0 ? ag * (0.06 + 0.50 * halo) : 0;
        var m = d < 5 ? mo[c] * (t && t.active ? 1 : 0.2) : 0;
        var pres = d <= R ? 1 : d >= R * 1.5 ? 0 : 1 - (d - R) / (R * 0.5);
        srcU8[o] = Math.round(Math.min(1, r / 1.25) * 255); srcU8[o + 1] = Math.round(Math.min(1, m) * 255);
        srcU8[o + 2] = Math.round((t ? Math.max(t.calm, t.habit || 0) : 0) * (halo > 0 ? 1 : 0) * 255); srcU8[o + 3] = Math.round(pres * 255);
        var mv = (lab[c] >= 0 || d < 2) ? mask[c] : 0; gm[c] = Math.round(Math.min(1, mv) * 255); if (mv > peak) peak = mv;
        if (r > 0.01 || m > 0.01) any = true;
      }
      srcActive = any; livePeak = peak; srcZero = false;
      gl.bindTexture(gl.TEXTURE_2D, srcT); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, srcU8);
      gl.bindTexture(gl.TEXTURE_2D, liveT); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, gm);
    }
    function zeroSources() {
      srcU8.fill(0); gm.fill(0); srcActive = false; livePeak = 0; srcZero = true;
      gl.bindTexture(gl.TEXTURE_2D, srcT); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RGBA, gl.UNSIGNED_BYTE, srcU8);
      gl.bindTexture(gl.TEXTURE_2D, liveT); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BW, BH, gl.RED, gl.UNSIGNED_BYTE, gm);
    }
    // a person's head: the top of the blob above its centre column
    function findHead(k) {
      var p = body.people[k], lab = body.label, cx = Math.round(p.cx * BW - 0.5), t = Math.floor(p.top * BH), b = Math.ceil(p.bottom * BH) - 1, top = -1;
      for (var y = Math.max(0, t); y <= b && top < 0; y++) for (var x = Math.max(0, cx - 2); x <= Math.min(BW - 1, cx + 2); x++) if (lab[y * BW + x] === k) { top = y; break; }
      if (top < 0) return null;
      var hh = Math.max(3, (b - t + 1) * 0.13), sx = 0, n = 0;
      for (var yy = top; yy < Math.min(BH, top + hh); yy++) for (var xx = Math.max(0, cx - Math.ceil(hh)); xx <= Math.min(BW - 1, cx + Math.ceil(hh)); xx++) if (lab[yy * BW + xx] === k) { sx += xx; n++; }
      var hx = n ? sx / n : cx, hy = top + hh * 0.5;
      var a = toWall(hx * 4 + 2, hy * 4 + 2), a2 = toWall(hx * 4 + 2, (hy + hh * 0.5) * 4 + 2);
      return [a[0], a[1], Math.max(0.012, Math.hypot(a2[0] - a[0], a2[1] - a[1]) * 1.05)];
    }
    function record(now, withPeople) {
      ringHead = (ringHead + 1) % RING; ringTimes[ringHead] = now; lastRec = now;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, hist);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, ringHead, BW, BH, 1, gl.RED, gl.UNSIGNED_BYTE, gm);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
      var o = ringHead * 12;
      for (var j = 0; j < 3; j++) {
        var hd = null, pw = null;
        if (withPeople && j < body.people.length) { hd = findHead(j); pw = peopleWall[j]; }
        if (hd && pw) { ringHeads.set([hd[0], hd[1], hd[2], 1], o + j * 4); ringBodies.set([pw.x, pw.y, pw.h, 1], o + j * 4); }
        else { ringHeads.fill(0, o + j * 4, o + j * 4 + 4); ringBodies.fill(0, o + j * 4, o + j * 4 + 4); }
      }
    }
    function delayClasses(now) {
      for (var c = 0; c < 8; c++) {
        var t = now - c * DELAY_STEP * 1000, best = -1, bd = Infinity;
        for (var i = 0; i < RING; i++) { if (ringTimes[i] === -Infinity) continue; var d = Math.abs(ringTimes[i] - t); if (d < bd) { bd = d; best = i; } }
        uDL[c] = best < 0 ? 0 : best;
        for (var j = 0; j < 3; j++) for (var q = 0; q < 4; q++) {
          uHead[(c * 3 + j) * 4 + q] = best < 0 ? 0 : ringHeads[best * 12 + j * 4 + q];
          uBody[(c * 3 + j) * 4 + q] = best < 0 ? 0 : ringBodies[best * 12 + j * 4 + q];
        }
      }
    }

    // ---- crack waves and taps
    function addWave(x, y, s, reach) {
      if (waves.length >= 4) waves.shift();
      waves.push({x: x, y: y, s: s, reach: Math.max(0.1, reach), t0: elapsed});
    }
    function tapAt(sx, sy, kind, r, s, force) {     // sx, sy: window 0..1 (y down); force = an explicit Wake (always a tap)
      if (!isFinite(sx) || !isFinite(sy)) return;
      var x = Math.max(0, Math.min(1, sx)) * asp, y = Math.max(0, Math.min(1, sy)), now = elapsed, i, near = null;
      for (i = lastTapAt.length - 1; i >= 0; i--) { if (now - lastTapAt[i].t > TAP_AGAIN_S + 0.5) { lastTapAt.splice(i, 1); continue; } if (Math.hypot(lastTapAt[i].x - x, lastTapAt[i].y - y) < 0.1) near = lastTapAt[i]; }
      if (kind === 'tap' && !force && near && now - near.t < TAP_AGAIN_S) kind = 'drag';   // a still hand re-reported by the bridge
      if (near) { near.x = x; near.y = y; near.t = now; } else { lastTapAt.push({x: x, y: y, t: now}); if (lastTapAt.length > 16) lastTapAt.shift(); }
      if (kind === 'tap') {
        var rr = isFinite(r) ? Math.max(0.04, Math.min(0.25, r)) : TAP_R, ss = isFinite(s) ? Math.max(0.2, Math.min(1.5, s)) : 1;
        taps.push([x, y, rr, ss, 1, 1, 1.0]); addWave(x, y, 1.0 * ss, TAP_REACH * (0.6 + 0.4 * settings.shatter)); bigMoments++;
        impacts.push([x, y, rnd() * Math.PI, 1, now]); if (impacts.length > 4) impacts.shift();
      } else taps.push([x, y, 0.05, 1, 0.25, 0.5, 0.92]);
      if (taps.length > 8) taps.shift();
    }
    function fingersFrame() {
      var f = kit.fingers, pts = (f && Date.now() - f.t <= 150 && Array.isArray(f.pts)) ? f.pts : [], cur = [];
      for (var i = 0; i < pts.length && i < 10; i++) {
        var p = pts[i]; if (!p || !isFinite(p[0]) || !isFinite(p[1]) || p[0] < -0.05 || p[0] > 1.05 || p[1] < -0.05 || p[1] > 1.05) continue;
        var landed = true;
        for (var j = 0; j < prevPts.length; j++) if (Math.hypot(prevPts[j][0] - p[0], prevPts[j][1] - p[1]) < 0.08) { landed = false; break; }
        if (landed) fingerLandings++;
        tapAt(p[0], p[1], landed ? 'tap' : 'drag');
        cur.push([p[0], p[1]]);
      }
      prevPts = cur;
    }

    // ---- the reshuffle: one card slides at a time
    function shuffleStep(dt) {
      var k = settings.shuffle;
      if (k > 0) {
        nextShuffle -= dt * k;
        if (nextShuffle <= 0) {
          nextShuffle = SHUFFLE_EVERY * (0.7 + 0.6 * rnd());
          var tries = 0, pick;
          do { pick = MOVABLE[Math.floor(rnd() * MOVABLE.length)]; tries++; } while (tries < 8 && moves.some(function (m) { return m.g === pick[0]; }));
          var g = pick[0], amp = pick[1], home = rnd() < 0.35;
          var from = [gOff[g * 4], gOff[g * 4 + 1], gOff[g * 4 + 2]];
          var to = home ? [0, 0, 0] : [(rnd() * 2 - 1) * amp, (rnd() * 2 - 1) * amp * 0.7, (rnd() * 2 - 1) * 0.035];
          moves = moves.filter(function (m) { return m.g !== g; });
          moves.push({g: g, from: from, to: to, t: 0, dur: SLIDE_S});
        }
      }
      for (var i = moves.length - 1; i >= 0; i--) {
        var m = moves[i]; m.t += dt * Math.max(0.15, k);
        var u = Math.min(1, m.t / m.dur), e = u * u * u * (u * (u * 6 - 15) + 10);
        for (var q = 0; q < 3; q++) gOff[m.g * 4 + q] = m.from[q] + (m.to[q] - m.from[q]) * e;
        if (u >= 1) moves.splice(i, 1);
      }
    }

    // ---- passes
    function bindTex(unit, target, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, t); }
    function hierUniforms(P, unit) {
      gl.uniform1i(P.U.uField, unit); gl.uniform1f(P.U.uAsp, asp); gl.uniform4f(P.U.uThr, THR[0], THR[1], THR[2], THR[3]);
      gl.uniform1f(P.U.uLineK, 1); gl.uniform4fv(P.U.uImp, uImp);
    }
    function drawIdle() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, idleF); gl.viewport(0, 0, CW, CH);
      gl.useProgram(pIdle.p); gl.bindVertexArray(vaoIdle);
      gl.uniform4fv(pIdle.U.uG, gOff); gl.uniform2fv(pIdle.U.uPiv, geo.piv); gl.uniform1f(pIdle.U.uPx, 1 / CH);
      gl.drawArrays(gl.TRIANGLES, 0, geo.count);
    }
    function stepField(dt) {
      var src = fieldT[fi], dst = fieldF[1 - fi];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst); gl.viewport(0, 0, FIELD_W, FIELD_H);
      gl.useProgram(pField.p); gl.bindVertexArray(vaoFull);
      bindTex(0, gl.TEXTURE_2D, src); bindTex(1, gl.TEXTURE_2D, srcT);
      var U = pField.U;
      gl.uniform1i(U.uPrev, 0); gl.uniform1i(U.uSrc, 1); gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
      gl.uniform1f(U.uDt, dt); gl.uniform1f(U.uAsp, asp); gl.uniform1f(U.uMem, settings.memory); gl.uniform1f(U.uCalm, CALM_S);
      gl.uniform1f(U.uSpinT, SPIN_S); gl.uniform1f(U.uRise, 7); gl.uniform1f(U.uMotK, 0.16); gl.uniform1f(U.uLin, 0.002); gl.uniform1f(U.uWaveW, 0.045); gl.uniform1f(U.uScar, SCAR); gl.uniform1f(U.uHeal, HEAL_S);
      uWave.fill(0);
      for (var i = 0; i < waves.length; i++) { var w = waves[i], r = (elapsed - w.t0) * WAVE_SPEED; uWave.set([w.x, w.y, r, w.s * Math.max(0, 1 - r / w.reach)], i * 4); }
      uTap.fill(0); uTapB.fill(0);
      for (i = 0; i < taps.length; i++) { var t = taps[i]; uTap.set([t[0], t[1], t[2], t[3]], i * 4); uTapB.set([t[4] * (settings.tumble > 0 ? 1 : 0), t[5], t[6], 0], i * 4); }
      gl.uniform4fv(U.uWave, uWave); gl.uniform4fv(U.uTap, uTap); gl.uniform4fv(U.uTapB, uTapB);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      fi = 1 - fi; simSteps++;
      taps.length = 0;
      waves = waves.filter(function (w) { return (elapsed - w.t0) * WAVE_SPEED < w.reach + 0.1; });
    }
    function stepKeep(dt) {
      var src = keepT[ki], dst = keepF[1 - ki];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst); gl.viewport(0, 0, PW, PH);
      gl.useProgram(pKeep.p); gl.bindVertexArray(vaoFull);
      bindTex(0, gl.TEXTURE_2D, fieldT[fi]); bindTex(1, gl.TEXTURE_2D, src); bindTex(2, gl.TEXTURE_2D, srcT); bindTex(3, gl.TEXTURE_2D_ARRAY, hist);
      var U = pKeep.U; hierUniforms(pKeep, 0);
      gl.uniform1i(U.uPrevP, 1); gl.uniform1i(U.uSrc, 2); gl.uniform1i(U.uHist, 3); gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
      gl.uniform1fv(U.uDL, uDL); gl.uniform4fv(U.uHead, uHead); gl.uniform4fv(U.uBody, uBody);
      gl.uniform1f(U.uWrite, writing ? 1 : 0); gl.uniform1f(U.uDt, dt); gl.uniform1f(U.uRecT, VIEW_FADE_S); gl.uniform1f(U.uPx, 1 / PH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ki = 1 - ki;
      bindTex(3, gl.TEXTURE_2D_ARRAY, null);
    }
    function composite(idleOnly) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(pComp.p); gl.bindVertexArray(vaoFull);
      bindTex(0, gl.TEXTURE_2D, fieldT[fi]); bindTex(1, gl.TEXTURE_2D, idleT); bindTex(2, gl.TEXTURE_2D, keepT[ki]); bindTex(3, gl.TEXTURE_2D, liveT); bindTex(4, gl.TEXTURE_2D, srcT);
      var U = pComp.U; hierUniforms(pComp, 0);
      gl.uniform1i(U.uIdle, 1); gl.uniform1i(U.uP, 2); gl.uniform1i(U.uLive, 3); gl.uniform1i(U.uSrc, 4); gl.uniformMatrix3fv(U.uHinv, false, body.hinv());
      gl.uniform1f(U.uInside, settings.inside); gl.uniform1f(U.uPx, 1 / CH); gl.uniform1f(U.uTumble, settings.tumble);
      gl.uniform1f(U.uIdleOnly, idleOnly ? 1 : 0); gl.uniform1f(U.uSlide, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null); gl.activeTexture(gl.TEXTURE0);
    }

    function frame(dt, now) {
      if (destroyed) return;
      var f0 = performance.now();
      dt = Math.max(0, Math.min(0.1, Number.isFinite(dt) ? dt : 0)); elapsed += dt; frames++;
      if (canvas.width !== CW || canvas.height !== CH) allocSized();
      asp = CW / CH;
      var fresh = body.update(dt, now);
      if (fresh) {
        var dtF = Math.min(0.2, Math.max(0.001, (now - lastFreshMs) / 1000)); lastFreshMs = now;
        trackPeople(now, dtF);
      }
      updateAgitation(dt, now);
      if (fresh) { buildSources(); record(body.frameMs, true); }
      else if (!body.fresh) { if (!srcZero) zeroSources(); if (now - lastRec > 33 && now - body.frameMs > LINGER_MS) record(now, false); }
      writing = body.fresh && body.people.length > 0;
      fingersFrame();
      if (dt > 0) shuffleStep(dt);
      delayClasses(now);
      impacts = impacts.filter(function (im) { return elapsed - im[4] < IMPACT_S; });
      uImp.fill(0); for (var ii = 0; ii < impacts.length; ii++) uImp.set(impacts[ii].slice(0, 4), ii * 4);
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
      drawIdle();
      if (dt > 0) { stepField(dt); stepKeep(dt); }
      composite(false);
      if (firstFrameMs === null) firstFrameMs = performance.now() - t0Create;
      frameMsLast = performance.now() - f0;
    }
    function touch(t) {
      if (destroyed || !t) return;
      touches++;
      tapAt(t.x, t.y, t.first ? 'tap' : 'drag');
    }
    function wake(sx, sy, radius, strength) {
      if (destroyed || !Number.isFinite(sx) || !Number.isFinite(sy)) return;
      wakes++;
      // radius / strength are hints relative to the bridge's normal touch (radius 0.035, strength 0.012 = one normal tap)
      var rk = Number.isFinite(radius) && radius > 0 ? Math.max(0.6, Math.min(2, radius / WAKE_R0)) : 1;
      var sk = Number.isFinite(strength) && strength > 0 ? Math.max(0.6, Math.min(2, strength / WAKE_S0)) : 1;
      tapAt(sx, sy, 'tap', TAP_R * rk, sk);   // a still hand re-sent by the bridge within TAP_AGAIN_S is a drag, not a new tap
    }
    function set(v) {
      if (v && typeof v === 'object' && !destroyed) Object.keys(KNOBS).forEach(function (k) {
        var x = Number(v[k]); if (Number.isFinite(x)) settings[k] = Math.max(KNOBS[k][0], Math.min(KNOBS[k][1], x));
      });
      var out = {}; Object.keys(settings).forEach(function (k) { out[k] = settings[k]; }); return out;
    }
    function resize() { /* sizes are checked every frame */ }
    function destroy() {
      if (destroyed) return; destroyed = true;
      if (window.PicassoSet === set) delete window.PicassoSet;
      if (window.PicassoWake === wake) delete window.PicassoWake;
      kit.wantDepth(false);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      made.reverse().forEach(function (r) { try { gl['delete' + r[0]](r[1]); } catch (e) {} }); made = [];
      if (window.__picassoDebug) try { delete window.__picassoDebug; } catch (e) { window.__picassoDebug = undefined; }
    }

    kit.wantDepth(true);
    set(window._picassoFx);
    window.PicassoSet = set;
    window.PicassoWake = wake;
    if (window.WallTest) window.__picassoDebug = function (cmd) {   // sandbox only (the live wall has no WallTest)
      if (destroyed) return null;
      if (cmd === 'idleframe' || cmd === 'fullframe') { composite(cmd === 'idleframe'); return true; }
      var fb = new Float32Array(FIELD_W * FIELD_H * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fieldF[fi]); gl.readPixels(0, 0, FIELD_W, FIELD_H, gl.RGBA, gl.FLOAT, fb);
      var kb = new Float32Array(PW * PH * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, keepF[ki]); gl.readPixels(0, 0, PW, PH, gl.RGBA, gl.FLOAT, kb);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      var sF = 0, mF = 0, sS = 0, sFl = 0, cracked = 0, i, n = FIELD_W * FIELD_H;
      for (i = 0; i < n; i++) { var F = fb[i * 4]; sF += F; if (F > mF) mF = F; sS += fb[i * 4 + 2]; sFl += fb[i * 4 + 1]; if (F > THR[0]) cracked++; }
      var sR = 0, sG = 0, m = PW * PH; for (i = 0; i < m; i++) { sR += kb[i * 4 + 2]; if (kb[i * 4 + 1] > 0.5) sG++; }
      var cmdF = null;
      if (cmd && cmd.fieldAt) { var fx = Math.max(0, Math.min(FIELD_W - 1, Math.floor(cmd.fieldAt[0] * FIELD_W))), fy = Math.max(0, Math.min(FIELD_H - 1, Math.floor((1 - cmd.fieldAt[1]) * FIELD_H))); cmdF = Array.prototype.slice.call(fb, (fy * FIELD_W + fx) * 4, (fy * FIELD_W + fx) * 4 + 4); }
      return {frames: frames, elapsed: +elapsed.toFixed(2), simSteps: simSteps, energy: +(sF / n).toFixed(4), maxF: +mF.toFixed(3), cracked: +(cracked / n).toFixed(4),
              spin: +(sS / n).toFixed(4), flash: +(sFl / n).toFixed(4), keep: +(sR / m).toFixed(4), glyphPx: sG, fieldAt: cmdF,
              people: body.people.length, tracks: tracks.map(function (t) { return {id: t.id, x: +t.x.toFixed(3), y: +t.y.toFixed(3), mvS: +t.mvS.toFixed(3), act: +t.act.toFixed(3), vy: +(t.vy || 0).toFixed(3), resets: t.resets || 0, sc: t.sc && t.sc.map(function (v) { return +v.toFixed(3); }), habit: +(t.habit || 0).toFixed(2), area: t.area, moving: +(t.moving || 0).toFixed(3), active: t.active, agit: +t.agit.toFixed(2), calm: +t.calm.toFixed(2), arrived: t.arrived}; }),
              waves: waves.length, impacts: impacts.length, bigMoments: bigMoments, wakes: wakes, touches: touches, fingerLandings: fingerLandings,
              livePeak: +livePeak.toFixed(3), srcActive: srcActive, writing: writing, fresh: body.fresh, present: body.present, regOk: body.regOk,
              firstFrameMs: firstFrameMs === null ? null : Math.round(firstFrameMs), frameMs: +frameMsLast.toFixed(2), foldMs: +body.foldMs.toFixed(2),
              heads0: Array.prototype.map.call(uHead.slice(0, 4), function (x) { return +x.toFixed(3); }), bodies0: Array.prototype.map.call(uBody.slice(0, 4), function (x) { return +x.toFixed(3); }),
              boxes: body.people.map(function (p) { var c = [kit.toScreen(p.left * 512, p.top * 424), kit.toScreen(p.right * 512, p.top * 424), kit.toScreen(p.right * 512, p.bottom * 424), kit.toScreen(p.left * 512, p.bottom * 424)];
                if (c.some(function (q) { return !q; })) return null; var xs = c.map(function (q) { return q[0]; }), ys = c.map(function (q) { return q[1]; });
                return [+Math.min.apply(null, xs).toFixed(3), +Math.min.apply(null, ys).toFixed(3), +Math.max.apply(null, xs).toFixed(3), +Math.max.apply(null, ys).toFixed(3)]; }),
              objects: made.length, floatLinear: floatLinear, settings: set(), glError: gl.getError()};
    };
    return {frame: frame, touch: touch, resize: resize, destroy: destroy};
  }
})();
