/* WallBody — the shared body stage for wall pieces (2026-10-05; Echo is the first piece on it). Not a piece: it registers no
 * plugin (main.js's startup check knows it by its global, WallBody). Pieces opt in; nothing else changes.
 * One depth client: it only reads kit.depth(). The piece itself calls kit.wantDepth(true) / (false).
 *
 *   var body = WallBody.create(kit, {minMm: 110});
 *   body.update(dt, nowMs) -> true when a new depth frame was folded in (call it once per animation frame)
 *   body.mask      Float32Array(w * h), 0..1: someone is in front of the wall here (Kinect space, 4 x 4-pixel cells, softened)
 *   body.gap       Float32Array(w * h): how far in front of the wall (mm) where someone is, else 0
 *   body.w, body.h 128 x 106 cells (the 512 x 424 depth image)
 *   body.present   anyone in front of the wall right now (fresh depth)
 *   body.meanGap   mean distance in front of the wall over everyone (mm); NaN when nobody
 *   body.fresh     the newest depth frame is younger than staleMs; once stale, the mask fades out (time-based, not per frame)
 *   body.frameMs   performance.now() when the newest folded depth frame arrived
 *   body.hinv()    Float32Array(9), column-major mat3: window (0..1, y down) -> Kinect texture coords (0..1), for shaders;
 *                  rebuilt from kit.fromScreen every 2 s (the host re-reads the registration every 30 s)
 *   body.regOk     a touch registration is loaded
 * Added 2026-10-05 (for the research pieces; Echo does not need them):
 *   body.motion    Float32Array(w * h), 0..1: how much the person map changed here lately (fades over ~0.3 s)
 *   body.sdf       Float32Array(w * h): distance to the nearest outline in cells, + outside a person, - inside (capped at +-40)
 *   body.label     Int16Array(w * h): which entry of body.people a cell belongs to, -1 = nobody
 *   body.people    [{id, cx, cy, left, top, right, bottom (Kinect 0..1), area (cells), gap (mm), still (s), moving (0..1)}]
 *                  one entry per separate person (blobs under minArea cells are noise); an id follows a person from frame to
 *                  frame (nearest centre); still = seconds the whole person has barely moved (per person, not per cell, so a
 *                  flickering outline edge never resets it); moving = how much of the person changed this frame
 * Cell (x, y) covers Kinect pixels 4x..4x+3, 4y..4y+3; texture coordinate of its centre = ((x + .5) / 128, (y + .5) / 106).
 */
(function () {
  'use strict';
  var W = 128, H = 106;

  function create(kit, opts) {
    opts = opts || {};
    var minMm = opts.minMm || 110;           // closer than the wall by more than this is a person (noise stays under ~90)
    var maxMm = opts.maxMm || 3000;          // ...but not further than this (the Kinect's own near range)
    var staleMs = opts.staleMs || 150;       // the host's rule: a depth frame older than this means the Kinect stopped
    var fadeS = opts.fadeS || 0.12;          // how fast a stale body fades (time constant, s)
    var minArea = opts.minArea || 30;        // a separate blob smaller than this many cells is noise, not a person
    var stillMove = opts.stillMove || 0.035;  // a person whose 'moving' stays under this is standing still
    var raw = new Float32Array(W * H), tmp = new Float32Array(W * H), prevMask = new Float32Array(W * H);
    var dOut = new Float32Array(W * H), dIn = new Float32Array(W * H), parent = new Int32Array(W * H), nextId = 1;
    var hinvM = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), regAt = -1e9;
    var self = {
      w: W, h: H, mask: new Float32Array(W * H), gap: new Float32Array(W * H),
      present: false, meanGap: NaN, fresh: false, frameMs: -1e9, regOk: false, seq: -1, foldMs: 0,
      motion: new Float32Array(W * H), sdf: new Float32Array(W * H).fill(40), label: new Int16Array(W * H).fill(-1), people: [],
      update: update, hinv: function () { return hinvM; }
    };

    function blur(src, dst, horiz) {        // 1-2-1 along one axis
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var i = y * W + x, a, b;
        if (horiz) { a = x > 0 ? src[i - 1] : src[i]; b = x < W - 1 ? src[i + 1] : src[i]; }
        else { a = y > 0 ? src[i - W] : src[i]; b = y < H - 1 ? src[i + W] : src[i]; }
        dst[i] = (a + 2 * src[i] + b) * 0.25;
      }
    }

    function chamfer(d) {                     // in place: 0 at seeds, 1e6 elsewhere -> distance in cells (8-neighbour chamfer)
      var x, y, i, R2 = 1.4142;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { i = y * W + x; if (!d[i]) continue;
        var v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + R2); if (x < W - 1) v = Math.min(v, d[i - W + 1] + R2); }
        d[i] = v; }
      for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) { i = y * W + x; if (!d[i]) continue;
        var u = d[i];
        if (x < W - 1) u = Math.min(u, d[i + 1] + 1);
        if (y < H - 1) { u = Math.min(u, d[i + W] + 1); if (x < W - 1) u = Math.min(u, d[i + W + 1] + R2); if (x > 0) u = Math.min(u, d[i + W - 1] + R2); }
        d[i] = u; }
    }
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function shape(dtS) {                     // after a new mask: motion, outline distance, separate people with ids and stillness
      var mask = self.mask, mo = self.motion, lab = self.label, i, x, y, k = Math.exp(-Math.max(0, dtS) / 0.3);
      for (i = 0; i < W * H; i++) { var ch = Math.abs(mask[i] - prevMask[i]); mo[i] = Math.max(mo[i] * k, ch); prevMask[i] = mask[i]; }
      for (i = 0; i < W * H; i++) { var on = mask[i] > 0.5; dOut[i] = on ? 0 : 1e6; dIn[i] = on ? 1e6 : 0; }
      chamfer(dOut); chamfer(dIn);
      for (i = 0; i < W * H; i++) self.sdf[i] = Math.max(-40, Math.min(40, mask[i] > 0.5 ? -dIn[i] : dOut[i]));
      for (i = 0; i < W * H; i++) parent[i] = mask[i] > 0.5 ? i : -1;     // union-find over occupied cells, 8-connected
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { i = y * W + x; if (parent[i] < 0) continue;
        var nb = [x > 0 ? i - 1 : -1, y > 0 ? i - W : -1, y > 0 && x > 0 ? i - W - 1 : -1, y > 0 && x < W - 1 ? i - W + 1 : -1];
        for (var n = 0; n < 4; n++) { var j = nb[n]; if (j >= 0 && parent[j] >= 0) { var a = find(i), b = find(j); if (a !== b) parent[a] = b; } } }
      var blobs = {}, list = [];
      for (i = 0; i < W * H; i++) { lab[i] = -1; if (parent[i] < 0) continue; var r = find(i), bl = blobs[r];
        if (!bl) bl = blobs[r] = {area: 0, sx: 0, sy: 0, l: 1e9, t: 1e9, rr: -1, b: -1, gs: 0, mv: 0, cells: []};
        x = i % W; y = (i / W) | 0; bl.area++; bl.sx += x; bl.sy += y; bl.gs += self.gap[i]; bl.mv += mo[i]; bl.cells.push(i);
        if (x < bl.l) bl.l = x; if (x > bl.rr) bl.rr = x; if (y < bl.t) bl.t = y; if (y > bl.b) bl.b = y; }
      Object.keys(blobs).forEach(function (r) { var bl = blobs[r]; if (bl.area >= minArea) list.push(bl); });
      list.sort(function (a, b) { return b.area - a.area; });
      var prev = self.people, used = {}, people = [];
      list.forEach(function (bl, idx) {
        var cx = (bl.sx / bl.area + 0.5) / W, cy = (bl.sy / bl.area + 0.5) / H, best = null, bd = 0.15;
        for (var q = 0; q < prev.length; q++) { if (used[prev[q].id]) continue; var d = Math.hypot(prev[q].cx - cx, prev[q].cy - cy); if (d < bd) { bd = d; best = prev[q]; } }
        var moving = bl.mv / bl.area, id = best ? best.id : nextId++;
        if (best) used[id] = true;
        var still = best && moving < stillMove ? best.still + Math.max(0, dtS) : 0;
        bl.cells.forEach(function (c) { lab[c] = idx; });
        people.push({id: id, cx: cx, cy: cy, left: bl.l / W, top: bl.t / H, right: (bl.rr + 1) / W, bottom: (bl.b + 1) / H,
                     area: bl.area, gap: bl.gs / bl.area, still: still, moving: moving});
      });
      self.people = people;
    }
    function registration(nowMs) {           // window (0..1) -> Kinect (0..1) as a 3x3, from four corners (Heckbert's square-to-quad)
      if (nowMs - regAt < 2000) return;
      regAt = nowMs;
      var c0 = kit.fromScreen(0, 0), c1 = kit.fromScreen(1, 0), c2 = kit.fromScreen(1, 1), c3 = kit.fromScreen(0, 1);
      if (!c0 || !c1 || !c2 || !c3) { self.regOk = false; regAt = nowMs - 1750; return; }
      var x0 = c0[0] / 512, y0 = c0[1] / 424, x1 = c1[0] / 512, y1 = c1[1] / 424, x2 = c2[0] / 512, y2 = c2[1] / 424, x3 = c3[0] / 512, y3 = c3[1] / 424;
      var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
      var g = 0, h = 0, den = dx1 * dy2 - dx2 * dy1;
      if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) { if (Math.abs(den) < 1e-12) return; g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
      var a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
      hinvM.set([a, d, g, b, e, h, c, f, 1]);   // column-major
      self.regOk = true;
    }

    function update(dt, nowMs) {
      registration(nowMs);
      var dep = kit.depth(), age = dep ? nowMs - dep.time : Infinity;
      // a frame that arrived after this animation frame's timestamp is the newest, not a stale one
      self.fresh = !!(dep && dep.wall && age >= -34 && age <= staleMs);
      if (self.fresh && dep.seq !== self.seq && dep.data.length === 512 * 424 && dep.wall.length === dep.data.length) {
        var t0 = performance.now(), data = dep.data, wall = dep.wall, sum = 0, n = 0, any = false;
        var dtS = self.frameMs > 0 ? (dep.time - self.frameMs) / 1000 : 0;
        self.seq = dep.seq; self.frameMs = dep.time;
        for (var cy = 0; cy < H; cy++) for (var cx = 0; cx < W; cx++) {
          var cnt = 0, gs = 0;
          for (var yy = 0; yy < 4; yy++) {
            var base = (cy * 4 + yy) * 512 + cx * 4;
            for (var xx = 0; xx < 4; xx++) {
              var z = data[base + xx], wz = wall[base + xx];
              if (z > 0 && wz === wz) { var gp = wz - z; if (gp > minMm && gp < maxMm) { cnt++; gs += gp; } }
            }
          }
          var i = cy * W + cx, m = Math.max(0, Math.min(1, (cnt - 3) / 6));   // 4+ of 16 pixels start a cell, 9+ fill it
          raw[i] = m; self.gap[i] = cnt ? gs / cnt : 0;
          if (m > 0.5) { sum += self.gap[i]; n++; any = true; }
        }
        blur(raw, tmp, true); blur(tmp, raw, false); blur(raw, tmp, true); blur(tmp, self.mask, false);
        self.present = any; self.meanGap = n ? sum / n : NaN;
        shape(Math.min(0.2, dtS));
        self.foldMs = performance.now() - t0;
        return true;
      }
      if (!self.fresh) {                     // the Kinect went quiet: let the last body go, at the same speed at any frame rate
        var k = Math.exp(-Math.max(0, dt) / fadeS), mk = self.mask, peak = 0;
        for (var j = 0; j < mk.length; j++) { mk[j] *= k; if (mk[j] > peak) peak = mk[j]; }
        if (peak < 0.01) mk.fill(0);
        self.present = false; self.meanGap = NaN;
        if (self.people.length) { self.people = []; self.label.fill(-1); self.sdf.fill(40); }
        var km = Math.exp(-Math.max(0, dt) / 0.3), mo2 = self.motion; for (var j2 = 0; j2 < mo2.length; j2++) mo2[j2] *= km;
      }
      return false;
    }
    return self;
  }

  window.WallBody = {create: create, w: W, h: H};
})();
