/* plugins/sigils-symbols.js — Chladni symbol catalog + default playlist.
   Loaded before plugins/sigils.js. Strokes: ['c',x,y,r] circle, ['l',x0,y0,x1,y1] line.
   Playlist ids: tree, metatron, solomon, pentacle, squared, borromean. */
(function (global) {
  'use strict';
  function ring(x, y, r) { return ['c', x, y, r]; }
  function line(a, b) { return ['l', a[0], a[1], b[0], b[1]]; }
  function poly(pts, close) { var out = []; for (var i = 0; i + 1 < pts.length; i++) out.push(line(pts[i], pts[i + 1])); if (close) out.push(line(pts[pts.length - 1], pts[0])); return out; }
  function ngon(n, r, rot, cx, cy) { var p = []; for (var i = 0; i < n; i++) { var a = rot + 2 * Math.PI * i / n; p.push([(cx || 0) + r * Math.sin(a), (cy || 0) - r * Math.cos(a)]); } return p; }
  function star(n, step, r, rot) {
    var p = ngon(n, r, rot), out = [], i = 0;
    for (var k = 0; k < n; k++) { var j = (i + step) % n; out.push(line(p[i], p[j])); i = j; }
    return out;
  }
  function lineBetween(a, b, r) {
    var dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    return ['l', a[0] + ux * r, a[1] + uy * r, b[0] - ux * r, b[1] - uy * r];
  }
  var SYMBOLS = [
    {id: 'tree', name: 'Tree of Life', make: function() {
      var u = 0.1125, x = 0.21, r = 0.052;
      var S = {keter: [0, -4 * u], chokmah: [x, -3 * u], binah: [-x, -3 * u], chesed: [x, -u], gevurah: [-x, -u], tiferet: [0, 0],
               netzach: [x, u], hod: [-x, u], yesod: [0, 2 * u], malkuth: [0, 4 * u]};
      var P = [['keter', 'chokmah'], ['keter', 'binah'], ['keter', 'tiferet'], ['chokmah', 'binah'], ['chokmah', 'tiferet'], ['chokmah', 'chesed'],
               ['binah', 'tiferet'], ['binah', 'gevurah'], ['chesed', 'gevurah'], ['chesed', 'tiferet'], ['chesed', 'netzach'], ['gevurah', 'tiferet'],
               ['gevurah', 'hod'], ['tiferet', 'netzach'], ['tiferet', 'yesod'], ['tiferet', 'hod'], ['netzach', 'hod'], ['netzach', 'yesod'],
               ['netzach', 'malkuth'], ['hod', 'yesod'], ['hod', 'malkuth'], ['yesod', 'malkuth']];
      var out = [];
      Object.keys(S).forEach(function(k) { out.push(ring(S[k][0], S[k][1], r)); });
      P.forEach(function(p) { out.push(lineBetween(S[p[0]], S[p[1]], r)); });
      return out;
    }},
    {id: 'metatron', name: "Metatron's Cube", make: function() {
      var a = 0.184, c = [[0, 0]], out = [], i, j;
      for (i = 0; i < 6; i++) { var t = Math.PI / 6 + i * Math.PI / 3; c.push([a * Math.cos(t), a * Math.sin(t)]); c.push([2 * a * Math.cos(t), 2 * a * Math.sin(t)]); }
      var r = a * 0.5;
      c.forEach(function(p) { out.push(ring(p[0], p[1], r)); });
      for (i = 0; i < c.length; i++) for (j = i + 1; j < c.length; j++) out.push(line(c[i], c[j]));
      return out;
    }},
    {id: 'solomon', name: 'Seal of Solomon', make: function() {
      return [ring(0, 0, 0.46), ring(0, 0, 0.42)].concat(poly(ngon(3, 0.42, 0), true), poly(ngon(3, 0.42, Math.PI), true), [ring(0, 0, 0.12)]);
    }},
    {id: 'pentacle', name: 'Pentacle', make: function() {
      return [ring(0, 0, 0.46), ring(0, 0, 0.415)].concat(star(5, 2, 0.415, 0));
    }},
    {id: 'squared', name: 'Squared Circle', make: function() {
      var R = 0.46, r2 = R / 2, h = r2 * Math.SQRT1_2;
      return [ring(0, 0, R)].concat(poly(ngon(3, R, 0), true), [ring(0, 0, r2)], poly(ngon(4, r2, Math.PI / 4), true), [ring(0, 0, h)]);
    }},
    {id: 'borromean', name: 'Borromean Rings', make: function() {
      var out = [ring(0, 0, 0.46)];
      ngon(3, 0.12, 0).forEach(function(c) { out.push(ring(c[0], c[1], 0.24)); });
      return out;
    }}
  ];
  var DEFAULT_PLAYLIST = SYMBOLS.map(function (s) { return s.id; });
  var byId = {};
  SYMBOLS.forEach(function (s) { byId[s.id] = s; });

  function parsePlaylist(raw) {
    if (raw == null || raw === '') return DEFAULT_PLAYLIST.slice();
    var seen = {}, out = [], parts = String(raw).split(/[,\s]+/);
    for (var i = 0; i < parts.length; i++) {
      var id = parts[i].trim().toLowerCase();
      if (!id || !byId[id] || seen[id]) continue;
      seen[id] = 1; out.push(id);
    }
    return out.length ? out : DEFAULT_PLAYLIST.slice();
  }
  function formatPlaylist(ids) {
    var seen = {}, out = [];
    (ids || []).forEach(function (id) {
      id = String(id || '').toLowerCase();
      if (!byId[id] || seen[id]) return;
      seen[id] = 1; out.push(id);
    });
    return (out.length ? out : DEFAULT_PLAYLIST).join(',');
  }

  global.SigilsCatalog = {
    SYMBOLS: SYMBOLS,
    DEFAULT_PLAYLIST: DEFAULT_PLAYLIST,
    byId: byId,
    parsePlaylist: parsePlaylist,
    formatPlaylist: formatPlaylist,
    ids: DEFAULT_PLAYLIST.slice()
  };
})(typeof window !== 'undefined' ? window : this);
