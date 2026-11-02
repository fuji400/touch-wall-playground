/*
 * Synthetic Kinect v2 depth frames (512 x 424, uint16 mm) for previews and tests: people standing in front of the wall, reaching toward it.
 *   SynthDepth.frame(spec, wall) -> Uint16Array
 *   spec = {wallMM: 2225, noise: 5, people: [{bx: 256, bodyMM: 700, hands: [{u, v, mm: 60}]}]}
 *     bx = the person's centre in Kinect pixels; bodyMM = how far the torso is in front of the wall; each hand at Kinect pixel (u, v),
 *     mm in front of the wall (a touch is ~0-40, a hover 60-200). The arm runs from the shoulder to the hand.
 *   wall: Float32Array(512*424) mm of the empty wall (NaN = unknown), or null for a flat wall at spec.wallMM.
 * Nearest-to-camera wins where shapes overlap (the Kinect looks at the people's backs, toward the wall).
 */
var SynthDepth = (function() {
  var W = 512, H = 424;
  function frame(spec, wall) {
    var out = new Uint16Array(W * H), dist = new Float32Array(W * H), noise = spec.noise == null ? 5 : spec.noise, flat = spec.wallMM || 2225;
    function put(x, y, mm) { if (x < 0 || y < 0 || x >= W || y >= H) return; var k = y * W + x; if (mm > dist[k]) dist[k] = mm; }
    function disk(cx, cy, r, mm) {
      for (var y = Math.max(0, Math.floor(cy - r)); y <= Math.min(H - 1, Math.ceil(cy + r)); y++)
        for (var x = Math.max(0, Math.floor(cx - r)); x <= Math.min(W - 1, Math.ceil(cx + r)); x++)
          if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) put(x, y, mm);
    }
    function ellipse(cx, cy, rx, ry, mm) {
      for (var y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++)
        for (var x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
          var a = (x - cx) / rx, b = (y - cy) / ry; if (a * a + b * b <= 1) put(x, y, mm);
        }
    }
    function capsule(x0, y0, m0, x1, y1, m1, r) {      // upper arm slopes from the body toward the wall; the forearm (last 30%) runs near it
      var n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
      for (var i = 0; i <= n; i++) { var f = i / n; disk(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, r, m0 + (m1 - m0) * Math.min(1, f / 0.7)); }
    }
    // dist = how far in front of the wall each pixel is (0 = wall); the person is drawn as distances, the camera sees the largest
    (spec.people || []).forEach(function(p) {
      var bx = p.bx, body = p.bodyMM || 700;
      ellipse(bx, 300, 46, 125, body);                      // torso (runs off the bottom of the image)
      disk(bx, 160, 30, body + 40);                          // head
      (p.hands || []).forEach(function(h, i) {
        var sx = bx + (h.u < bx ? -32 : 32), sy = 205;       // shoulder on the side of the hand
        capsule(sx, sy, body - 60, h.u, h.v, (h.mm == null ? 60 : h.mm) + 15, 9);
        disk(h.u, h.v, 12, h.mm == null ? 60 : h.mm);        // the hand, nearest the wall
      });
    });
    for (var k = 0; k < W * H; k++) {
      var w = wall ? wall[k] : flat;
      if (!(w > 0)) { out[k] = 0; continue; }
      var z = w - dist[k] + (Math.random() - 0.5) * 2 * noise;
      out[k] = z > 0 ? Math.round(z) : 0;
    }
    return out;
  }
  return {frame: frame, W: W, H: H};
})();
