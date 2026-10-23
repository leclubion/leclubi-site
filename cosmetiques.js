/* Cosmétiques LeClubi : bannières animées (pixel art), cadres d'avatar, couleurs de pseudo.
   Tout est dessiné en SVG / CSS : aucune image à fournir. Utilisation :
   LCC.avatar(url, nom, cadre, taille) · LCC.banniere(id) · LCC.nom(pseudo, couleur) */
(function () {
  var W = 270, H = 54;
  function R(x, y, w, h, c, a) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"' + (a || '') + '/>'; }
  function seed(n) { var s = n || 1; return function () { s = (s * 16807) % 2147483647; return s / 2147483647; }; }
  function bands(cols, y0, y1) { var h = (y1 - y0) / cols.length, o = ''; cols.forEach(function (c, i) { o += R(0, Math.round(y0 + i * h), W, Math.ceil(h) + 1, c); }); return o; }
  function disk(cx, cy, r, c, a) { var o = ''; for (var y = -r; y <= r; y++) { var w = Math.floor(Math.sqrt(r * r - y * y + r * .5)); o += R(cx - w, cy + y, w * 2 + 1, 1, c, a); } return o; }
  function stars(n, sd, ymax, col) { var r = seed(sd), o = ''; for (var i = 0; i < n; i++) { var x = Math.floor(r() * W), y = Math.floor(r() * ymax), d = (r() * 4).toFixed(1); o += R(x, y, 1, 1, col || '#fff', ' class="lcb-tw" style="animation-delay:-' + d + 's"'); } return o; }
  function g(cls, inner, style) { return '<g class="' + cls + '"' + (style ? ' style="' + style + '"' : '') + '>' + inner + '</g>'; }

  var SC = {};

  // 1. Île du Pirate Fantôme
  SC.ile = function () {
    var o = bands(['#050a1e', '#081230', '#0c1b3d', '#112650', '#183560'], 0, 36) + stars(26, 7, 26, '#cfe8ff');
    o += disk(226, 11, 6, '#f4f1d0') + disk(228, 10, 5, '#fffbe0', ' opacity=".6"') + R(224, 9, 2, 2, '#d8d3a8') + R(229, 13, 2, 1, '#d8d3a8');
    o += bands(['#0e3b58', '#0b3049', '#08263b', '#061d2e', '#04141f'], 36, H);
    // reflet de lune
    o += R(222, 37, 10, 1, '#cfe8ff', ' opacity=".5"') + R(224, 40, 6, 1, '#cfe8ff', ' opacity=".35"') + R(225, 43, 4, 1, '#cfe8ff', ' opacity=".25"');
    // île flottante
    var isl = '';
    isl += R(62, 24, 52, 3, '#2f7a3b') + R(66, 22, 44, 2, '#3f9a4b') + R(72, 21, 30, 1, '#52b85c') + R(60, 27, 56, 2, '#a6773c') + R(64, 29, 48, 2, '#8a5f2e') + R(70, 31, 36, 2, '#6d4a24') + R(78, 33, 20, 2, '#52391b') + R(84, 35, 8, 2, '#3b2814') + R(88, 37, 2, 2, '#3b2814');
    isl += R(66, 26, 2, 1, '#52b85c') + R(104, 26, 3, 1, '#52b85c');
    // palmier
    isl += R(88, 12, 2, 10, '#6b4423') + R(89, 14, 1, 2, '#4a2e15') + R(90, 10, 1, 3, '#6b4423');
    isl += R(82, 10, 9, 2, '#2f9a4a') + R(78, 12, 6, 1, '#2f9a4a') + R(91, 9, 9, 2, '#3fb35a') + R(98, 11, 6, 1, '#3fb35a') + R(86, 8, 8, 2, '#46c264') + R(84, 12, 2, 3, '#1f7a38') + R(96, 12, 2, 3, '#1f7a38');
    isl += R(92, 12, 2, 2, '#9b6a2a');
    // coffre au trésor
    isl += R(100, 19, 6, 3, '#7a4a1a') + R(100, 19, 6, 1, '#b5792a') + R(102, 20, 2, 2, '#f4d35e');
    o += g('lcb-bob', isl);
    // vaisseau fantôme
    var sh = '';
    sh += R(168, 30, 44, 3, '#1c3a4f') + R(171, 33, 38, 2, '#162f40') + R(174, 35, 32, 1, '#10242f') + R(166, 28, 4, 2, '#1c3a4f') + R(210, 27, 4, 3, '#1c3a4f');
    sh += R(189, 8, 2, 22, '#2a4d63') + R(176, 14, 1, 16, '#2a4d63') + R(203, 16, 1, 14, '#2a4d63');
    sh += R(182, 10, 16, 14, '#b8dfe8', ' opacity=".55"') + R(183, 12, 3, 5, '#0a1b2b', ' opacity=".6"') + R(190, 15, 6, 3, '#0a1b2b', ' opacity=".5"') + R(184, 20, 12, 1, '#0a1b2b', ' opacity=".4"');
    sh += R(170, 17, 11, 9, '#b8dfe8', ' opacity=".5"') + R(173, 20, 2, 3, '#0a1b2b', ' opacity=".5"') + R(177, 24, 4, 1, '#0a1b2b', ' opacity=".4"');
    sh += R(197, 18, 12, 8, '#b8dfe8', ' opacity=".5"') + R(200, 20, 3, 3, '#0a1b2b', ' opacity=".5"');
    sh += R(189, 4, 5, 4, '#e8f4f8') + R(190, 5, 1, 1, '#0a1b2b') + R(192, 5, 1, 1, '#0a1b2b');
    sh += g('lcb-fl', R(176, 28, 2, 2, '#7dfcff') + R(205, 28, 2, 2, '#7dfcff') + R(192, 29, 2, 1, '#7dfcff'));
    o += g('lcb-bob2', '<g opacity=".92">' + sh + '</g>');
    // vagues
    var w = ''; for (var x = -8; x < W + 8; x += 8) w += R(x, 38, 4, 1, '#3b86a8', ' opacity=".6"') + R(x + 4, 42, 4, 1, '#2c6c8a', ' opacity=".5"') + R(x + 2, 46, 4, 1, '#2c6c8a', ' opacity=".4"') + R(x + 6, 50, 4, 1, '#1f5670', ' opacity=".4"');
    o += g('lcb-wv', w);
    // lucioles fantômes
    var r = seed(11); for (var i = 0; i < 9; i++) o += R(Math.floor(60 + r() * 150), 20 + Math.floor(r() * 18), 1, 1, '#7dfcff', ' class="lcb-up" style="animation-delay:-' + (r() * 5).toFixed(1) + 's"');
    return o;
  };

  // 2. Manoir du Veilleur
  SC.manoir = function () {
    var o = bands(['#090814', '#0f0c22', '#17122f', '#211a3d', '#2c2250'], 0, H) + stars(18, 3, 22, '#d9d2ff');
    o += disk(40, 14, 9, '#e9e4c8') + disk(43, 12, 8, '#f6f2da', ' opacity=".55"') + R(35, 11, 3, 2, '#c9c3a2') + R(40, 17, 2, 2, '#c9c3a2') + R(37, 17, 1, 1, '#c9c3a2');
    o += g('lcb-fg', R(0, 30, 120, 3, '#8d86b8', ' opacity=".18"') + R(150, 26, 140, 2, '#8d86b8', ' opacity=".14"') + R(60, 36, 160, 3, '#8d86b8', ' opacity=".16"'));
    // manoir
    var m = '';
    m += R(106, 26, 70, 22, '#0a0816') + R(112, 20, 14, 8, '#0a0816') + R(150, 18, 18, 10, '#0a0816');
    m += R(108, 18, 2, 8, '#0a0816') + R(114, 16, 2, 4, '#0a0816') + R(122, 14, 2, 6, '#0a0816');
    m += R(128, 12, 20, 14, '#0a0816') + R(132, 8, 12, 4, '#0a0816') + R(135, 5, 6, 3, '#0a0816') + R(137, 2, 2, 3, '#0a0816');
    m += R(152, 14, 4, 4, '#0a0816') + R(160, 12, 2, 6, '#0a0816');
    // fenêtres
    m += g('lcb-wn', R(133, 15, 3, 4, '#ffcf5a') + R(140, 15, 3, 4, '#ffcf5a')) + g('lcb-wn2', R(113, 23, 3, 4, '#ff9a3a') + R(155, 22, 3, 4, '#ffcf5a')) + R(122, 32, 3, 4, '#ffcf5a', ' opacity=".5"') + R(160, 33, 3, 4, '#ff9a3a', ' opacity=".7"') + R(136, 34, 4, 8, '#2b2150') + R(137, 36, 2, 6, '#ffcf5a', ' opacity=".35"');
    o += m;
    // grille, arbres tordus
    var f = ''; for (var x = 0; x < W; x += 4) f += R(x, 42, 1, 8, '#06050e'); f += R(0, 42, W, 1, '#06050e') + R(0, 46, W, 1, '#06050e');
    o += R(0, 48, W, 6, '#06050e') + f;
    o += R(14, 24, 3, 24, '#06050e') + R(8, 20, 4, 2, '#06050e') + R(17, 18, 6, 2, '#06050e') + R(5, 26, 6, 2, '#06050e') + R(18, 26, 6, 2, '#06050e') + R(10, 14, 2, 8, '#06050e') + R(21, 12, 2, 8, '#06050e');
    o += R(228, 28, 3, 20, '#06050e') + R(222, 26, 6, 2, '#06050e') + R(231, 22, 8, 2, '#06050e') + R(236, 18, 2, 6, '#06050e') + R(224, 22, 2, 5, '#06050e');
    // chauves-souris
    function bat(x, y, d) { return g('lcb-bat', R(x, y, 1, 1, '#0a0816') + R(x - 3, y - 1, 3, 1, '#0a0816') + R(x + 1, y - 1, 3, 1, '#0a0816') + R(x - 4, y, 2, 1, '#0a0816') + R(x + 3, y, 2, 1, '#0a0816'), 'animation-delay:-' + d + 's'); }
    o += bat(70, 10, 0) + bat(88, 18, 4) + bat(205, 9, 2) + bat(190, 16, 6);
    o += R(0, 0, W, H, '#cfd8ff', ' class="lcb-ec" opacity="0"');
    return o;
  };

  // 3. Tour du Bourreau
  SC.tour = function () {
    var o = bands(['#2a0e1c', '#4a1424', '#7a1f2b', '#b2402f', '#e07a3a', '#f5b05a'], 0, 40);
    o += disk(198, 31, 12, '#ffd37a') + disk(198, 31, 9, '#ffe6a3', ' opacity=".7"');
    o += R(0, 33, W, 1, '#2a0e1c', ' opacity=".12"');
    o += R(0, 40, W, 14, '#1b0910');
    // montagnes
    var m = ''; for (var i = 0; i < 18; i++) { var x = i * 16 - 6, hh = 6 + ((i * 7) % 9); for (var k = 0; k < Math.min(hh, 8); k += 2) m += R(x + k, 40 - hh + k, 16 - 2 * k, 2, '#3a1220'); }
    o += m;
    // tour
    var t = '';
    t += R(60, 20, 24, 34, '#12060c') + R(58, 16, 28, 4, '#12060c') + R(58, 12, 4, 4, '#12060c') + R(66, 12, 4, 4, '#12060c') + R(74, 12, 4, 4, '#12060c') + R(82, 12, 4, 4, '#12060c');
    t += R(62, 22, 2, 30, '#1e0b13') + R(70, 24, 2, 28, '#1e0b13');
    t += R(70, 28, 4, 8, '#ffb84a', ' class="lcb-wn" opacity=".9"') + R(71, 29, 2, 6, '#3b0f14') + R(64, 40, 3, 5, '#ff7a2a', ' class="lcb-wn2"');
    o += t;
    // cloche
    o += R(70, 4, 4, 2, '#12060c') + g('lcb-cl', R(71, 6, 2, 2, '#3a2a14') + R(68, 8, 8, 3, '#d9a43a') + R(67, 11, 10, 2, '#e8b84a') + R(72, 13, 1, 1, '#a07a24'), 'transform-box:view-box;transform-origin:72px 6px');
    // pendu
    o += R(30, 26, 2, 26, '#12060c') + R(30, 26, 14, 2, '#12060c') + R(42, 28, 1, 6, '#12060c') + R(41, 34, 3, 1, '#12060c');
    // corbeaux
    function cr(x, y, d) { return g('lcb-bat', R(x, y, 1, 1, '#0b0408') + R(x - 3, y - 1, 3, 1, '#0b0408') + R(x + 1, y - 1, 3, 1, '#0b0408') + R(x - 5, y, 3, 1, '#0b0408') + R(x + 3, y, 3, 1, '#0b0408'), 'animation-delay:-' + d + 's'); }
    o += cr(120, 14, 0) + cr(140, 20, 3) + cr(110, 24, 5) + cr(232, 10, 2);
    o += g('lcb-fg', R(0, 42, 140, 3, '#e8b8a0', ' opacity=".18"') + R(120, 38, 160, 2, '#e8b8a0', ' opacity=".14"'));
    o += R(0, 46, W, 8, '#0b0408');
    var gr = ''; for (var x = 0; x < W; x += 6) gr += R(x, 44 + (x * 5 % 3), 1, 3, '#0b0408'); o += gr;
    return o;
  };

  // 4. Station du Pilote
  SC.station = function () {
    var o = R(0, 0, W, H, '#04050f') + R(0, 0, W, 18, '#080a1c') + stars(60, 5, H, '#fff') + stars(12, 21, H, '#7dd3ff');
    // planète à anneaux
    o += disk(204, 28, 14, '#c96a3a') + disk(206, 26, 11, '#e08a4a') + R(194, 22, 20, 2, '#a4502a') + R(196, 30, 18, 2, '#a4502a') + R(192, 36, 22, 1, '#8a4020');
    o += R(176, 28, 56, 1, '#f2d6a8', ' opacity=".8"') + R(172, 29, 64, 1, '#f2d6a8', ' opacity=".5"');
    o += disk(204, 28, 14, 'none') + R(190, 20, 3, 2, '#fff', ' opacity=".2"');
    // station
    var s = '';
    s += R(96, 26, 36, 6, '#4a5578') + R(98, 24, 32, 2, '#6b79a3') + R(98, 32, 32, 2, '#2f3858') + R(112, 14, 4, 12, '#5a6890') + R(110, 12, 8, 2, '#8b9bc6');
    s += R(72, 28, 24, 2, '#3a4466') + R(132, 28, 24, 2, '#3a4466') + R(60, 22, 12, 12, '#1c4a8a') + R(62, 24, 8, 8, '#2a6ac2') + R(60, 28, 12, 1, '#0c2a54') + R(156, 22, 12, 12, '#1c4a8a') + R(158, 24, 8, 8, '#2a6ac2') + R(156, 28, 12, 1, '#0c2a54');
    s += R(100, 28, 3, 2, '#ffd25a') + R(106, 28, 3, 2, '#ffd25a') + R(120, 28, 3, 2, '#ffd25a') + R(126, 28, 3, 2, '#ffd25a');
    s += g('lcb-fl', R(113, 10, 2, 2, '#ff4a4a') + R(97, 30, 1, 1, '#4aff8a') + R(130, 30, 1, 1, '#4aff8a'));
    o += g('lcb-bob', s);
    // vaisseau
    var v = R(0, 6, 8, 3, '#e8edf8') + R(8, 7, 4, 1, '#e8edf8') + R(2, 4, 3, 2, '#7dd3ff') + R(-4, 7, 4, 1, '#ff9a3a') + R(-8, 7, 4, 1, '#ffd25a', ' opacity=".7"') + R(0, 9, 6, 1, '#8b9bc6');
    o += g('lcb-ship', v);
    o += g('lcb-sh', R(0, 0, 1, 1, '#fff') + R(-3, 0, 3, 1, '#fff', ' opacity=".5"'), 'animation-delay:-3s');
    return o;
  };

  // 5. Forêt du Renard
  SC.foret = function () {
    var o = bands(['#050f12', '#07181a', '#0a2422', '#0e332b', '#144536'], 0, H) + stars(14, 9, 18, '#e8ffe0');
    o += disk(232, 12, 5, '#eaf5c8') + disk(234, 11, 4, '#f8ffe0', ' opacity=".5"');
    function pine(x, y, h, c, c2) { var o = R(x + Math.floor(h / 4) - 0, y + h, 2, 4, '#0a1a14'); for (var k = 0; k < h; k += 2) { var w = 3 + k; o += R(x - Math.floor(w / 2) + Math.floor(h / 4), y + k, w, 2, k % 4 ? c : c2); } return o; }
    var r = seed(4), back = '', mid = '', front = '';
    for (var x = -4; x < W; x += 14) back += pine(x, 8 + Math.floor(r() * 8), 22 + Math.floor(r() * 8), '#0b2a24', '#0e342c');
    for (var x2 = 4; x2 < W; x2 += 22) mid += pine(x2, 6 + Math.floor(r() * 8), 30 + Math.floor(r() * 8), '#0c3a2c', '#10473a');
    o += back + g('lcb-fg', R(0, 34, 200, 2, '#9fe8c0', ' opacity=".12"') + R(100, 38, 200, 2, '#9fe8c0', ' opacity=".1"')) + mid;
    o += R(0, 44, W, 10, '#07140f') + R(0, 44, W, 1, '#1b5a3c');
    for (var x3 = 0; x3 < W; x3 += 5) o += R(x3, 42 + (x3 * 7 % 3), 1, 2, '#1b5a3c');
    for (var x4 = 20; x4 < W; x4 += 52) front += R(x4, 40, 4, 4, '#a63a3a') + R(x4 + 1, 39, 2, 1, '#d24a4a') + R(x4 + 1, 44, 2, 3, '#e8e0c8');
    o += front;
    // renard
    var f = '';
    f += R(160, 38, 10, 6, '#e8742a') + R(168, 33, 6, 6, '#e8742a') + R(170, 31, 2, 2, '#e8742a') + R(173, 31, 2, 2, '#e8742a') + R(174, 36, 4, 3, '#fff2dc') + R(178, 37, 2, 2, '#1a0e08') + R(170, 34, 1, 1, '#1a0e08') + R(166, 41, 4, 3, '#fff2dc') + R(162, 43, 3, 1, '#2a160c') + R(168, 43, 3, 1, '#2a160c');
    o += f + g('lcb-tail', R(152, 36, 9, 5, '#e8742a') + R(148, 34, 5, 4, '#e8742a') + R(146, 34, 3, 3, '#fff2dc'), 'transform-box:view-box;transform-origin:160px 40px');
    // lucioles
    for (var i = 0; i < 16; i++) o += R(Math.floor(r() * W), 14 + Math.floor(r() * 28), 1, 1, '#ffe66b', ' class="lcb-ff" style="animation-delay:-' + (r() * 6).toFixed(1) + 's;animation-duration:' + (4 + r() * 4).toFixed(1) + 's"');
    return o;
  };

  // 6. Néons du Ronin
  SC.neon = function () {
    var o = bands(['#14052e', '#2a0b4a', '#4a1068', '#7a1a82', '#b02a8a', '#e04a8a', '#ff7a7a'], 0, 36);
    o += stars(20, 6, 14, '#ffd0f0');
    var sun = disk(135, 30, 16, '#ffd66b') + disk(135, 30, 12, '#ffb04a', ' opacity=".5"');
    o += sun + R(115, 31, 40, 1, '#b02a8a') + R(115, 34, 40, 1, '#b02a8a') + R(115, 36, 40, 1, '#14052e') + R(115, 22, 40, 1, '#ff7a7a', ' opacity=".0"');
    o += R(119, 28, 32, 1, '#e04a8a', ' opacity=".55"');
    // skyline
    var r = seed(2), sk = '', x = 0; while (x < W) { var w = 6 + Math.floor(r() * 10), h = 8 + Math.floor(r() * 16); sk += R(x, 36 - h, w, h + 6, '#12042a'); if (r() > .5) sk += R(x + 1, 36 - h + 2, 1, 1, '#00e5ff', ' class="lcb-wn"') + R(x + w - 2, 36 - h + 5, 1, 1, '#ff4fd8', ' class="lcb-wn2"'); x += w; }
    o += sk;
    // torii
    var t = R(178, 14, 3, 30, '#d4143a') + R(212, 14, 3, 30, '#d4143a') + R(172, 12, 48, 3, '#d4143a') + R(174, 10, 44, 2, '#12042a') + R(176, 20, 40, 2, '#d4143a') + R(190, 12, 2, 8, '#d4143a') + R(202, 12, 2, 8, '#d4143a');
    o += R(178, 14, 1, 30, '#ff6a7a', ' opacity=".6"') + t;
    o += g('lcb-wn', R(176, 18, 1, 2, '#00e5ff') + R(216, 18, 1, 2, '#00e5ff'));
    // sol : grille
    o += R(0, 36, W, 18, '#0a0220') + R(0, 36, W, 1, '#00e5ff');
    var gr = ''; for (var k = 0; k < 6; k++) gr += R(0, 38 + k * k, W, 1, '#ff4fd8', ' opacity="' + (0.8 - k * .08).toFixed(2) + '"');
    for (var vx = -90; vx < W + 90; vx += 20) gr += '<path d="M' + (W / 2 + (vx - W / 2) * .2) + ' 36 L' + vx + ' 54" stroke="#b02aff" stroke-width=".6" opacity=".7"/>';
    o += gr;
    // ronin silhouette
    o += R(80, 28, 6, 12, '#07021a') + R(81, 26, 4, 3, '#07021a') + R(78, 24, 10, 2, '#07021a') + R(79, 23, 8, 1, '#07021a') + R(86, 30, 1, 10, '#07021a') + R(87, 22, 1, 18, '#00e5ff', ' opacity=".9"') + R(79, 40, 3, 4, '#07021a') + R(83, 40, 3, 4, '#07021a');
    // pétales
    for (var i = 0; i < 14; i++) o += R(Math.floor(r() * W), Math.floor(r() * 30), 1, 1, '#ffb0d8', ' class="lcb-pt" style="animation-delay:-' + (r() * 7).toFixed(1) + 's;animation-duration:' + (5 + r() * 4).toFixed(1) + 's"');
    return o;
  };

  // 7. Salle d'arcade
  SC.salle = function () {
    var o = bands(['#120726', '#1a0a36', '#220e46'], 0, 38) + R(0, 38, W, 16, '#0d0620');
    for (var y = 38; y < H; y += 4) for (var x = (y / 4) % 2 ? 0 : 6; x < W; x += 12) o += R(x, y, 6, 4, '#1b0e3a');
    o += R(0, 37, W, 1, '#ff4fd8') + R(0, 36, W, 1, '#ff4fd8', ' opacity=".4"');
    o += R(0, 10, W, 1, '#00e5ff', ' class="lcb-fl" opacity=".8"') + R(0, 11, W, 1, '#00e5ff', ' opacity=".25"');
    // néon "ARCADE"
    var neon = R(104, 2, 62, 8, '#1a0a36', ' opacity=".0"');
    var txt = 'ARCADE', glyph = {A: ['010', '101', '111', '101', '101'], R: ['110', '101', '110', '101', '101'], C: ['011', '100', '100', '100', '011'], D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111']};
    for (var i = 0; i < txt.length; i++) { var gl = glyph[txt[i]]; for (var yy = 0; yy < 5; yy++) for (var xx = 0; xx < 3; xx++) if (gl[yy][xx] === '1') neon += R(108 + i * 9 + xx * 2, 3 + yy * 1.4, 2, 1.4, '#ff4fd8'); }
    o += g('lcb-fl', neon);
    // bornes
    var cols = ['#e02a5a', '#2a8ae0', '#2ae07a', '#e0a02a', '#a02ae0', '#e05a2a'], scr = ['#7dfcff', '#ffd25a', '#ff7ac8', '#7dff9a', '#b8a0ff', '#ffa86a'];
    for (var c = 0; c < 9; c++) {
      var x0 = 8 + c * 29 + (c > 4 ? 0 : 0), col = cols[c % 6];
      o += R(x0, 16, 22, 28, '#0a0618') + R(x0 + 1, 17, 20, 27, col) + R(x0 + 3, 19, 16, 11, '#050310') + R(x0 + 4, 20, 14, 9, scr[c % 6], ' opacity=".9" class="lcb-sc" style="animation-delay:-' + (c * 0.7).toFixed(1) + 's"');
      o += R(x0 + 5, 22, 3, 3, '#050310') + R(x0 + 12, 25, 4, 2, '#050310') + R(x0 + 1, 31, 20, 2, '#0a0618') + R(x0 + 5, 34, 2, 2, '#ffd25a') + R(x0 + 8, 33, 1, 3, '#222') + R(x0 + 14, 34, 2, 2, '#ff4a4a') + R(x0 + 17, 34, 2, 2, '#4aff8a') + R(x0 + 2, 38, 18, 6, '#10081f');
      o += R(x0 + 1, 17, 1, 27, '#fff', ' opacity=".18"');
    }
    o += R(0, 44, W, 1, '#00e5ff', ' opacity=".5"');
    var r = seed(5); for (var s = 0; s < 22; s++) o += R(Math.floor(r() * W), 44 + Math.floor(r() * 9), 1, 1, '#ff4fd8', ' class="lcb-tw" style="animation-delay:-' + (r() * 3).toFixed(1) + 's"');
    return o;
  };

  // 8. Ville sous la pluie
  SC.ville = function () {
    var o = bands(['#070b1a', '#0b1226', '#10192f', '#16223d', '#1d2d4d'], 0, H);
    o += disk(36, 12, 7, '#9fb4d8', ' opacity=".35"') + disk(36, 12, 4, '#c8d8f0', ' opacity=".25"');
    var r = seed(8);
    function rang(y0, cols, ww) { var x = -2, s = ''; while (x < W) { var w = ww[0] + Math.floor(r() * ww[1]), h = 10 + Math.floor(r() * 22); s += R(x, y0 - h, w, h + 40, cols[0]); if (w > 6) s += R(x + Math.floor(w / 2), y0 - h - 4, 1, 4, cols[0]); for (var wy = y0 - h + 2; wy < y0 - 2; wy += 3) for (var wx = x + 1; wx < x + w - 1; wx += 3) if (r() > .7) s += R(wx, wy, 1, 2, r() > .5 ? '#ffd25a' : '#7dd3ff', r() > .85 ? ' class="lcb-wn"' : ' opacity=".7"'); x += w + 1; } return s; }
    o += rang(40, ['#0a1020'], [9, 8]) + rang(46, ['#050810'], [12, 12]);
    // enseigne néon
    o += R(196, 14, 26, 10, '#07030f') + g('lcb-fl', R(198, 16, 22, 1, '#ff4fd8') + R(198, 19, 22, 1, '#ff4fd8') + R(198, 22, 22, 1, '#00e5ff') + R(198, 16, 1, 7, '#ff4fd8') + R(219, 16, 1, 7, '#ff4fd8'));
    o += R(0, 48, W, 6, '#04060e') + R(0, 48, W, 1, '#2a3a60', ' opacity=".7"');
    // reflets sur sol mouillé
    for (var k = 0; k < 26; k++) o += R(Math.floor(r() * W), 49 + Math.floor(r() * 4), 3 + Math.floor(r() * 5), 1, r() > .5 ? '#ff4fd8' : '#00e5ff', ' opacity=".35"');
    // pluie
    var p1 = '', p2 = ''; for (var i = 0; i < 70; i++) { var rx = Math.floor(r() * (W + 20)), ry = Math.floor(r() * H), len = 2 + Math.floor(r() * 3); if (i % 2) p1 += R(rx, ry, 1, len, '#9fc4ff', ' opacity=".55"'); else p2 += R(rx, ry, 1, len, '#9fc4ff', ' opacity=".35"'); }
    o += g('lcb-rain', p1) + g('lcb-rain2', p2);
    return o;
  };

  var NOMS = {ile: 'Île du Pirate Fantôme', manoir: 'Manoir du Veilleur', tour: 'Tour du Bourreau', station: 'Station du Pilote', foret: 'Forêt du Renard', neon: 'Néons du Ronin', salle: 'Salle d’arcade', ville: 'Ville sous la pluie'};
  var cache = {};
  function banniere(id, cls) {
    id = String(id || '').replace(/^b-/, '');
    if (!SC[id]) return '<div class="lcb lcb-vide ' + (cls || '') + '" aria-hidden="true"></div>';
    if (!cache[id]) cache[id] = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' + SC[id]() + '</svg>';
    return '<div class="lcb lcb-' + id + ' ' + (cls || '') + '" role="img" aria-label="Bannière : ' + NOMS[id] + '">' + cache[id] + '</div>';
  }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  var CADRES = ['pixel', 'neon', 'ronces', 'flamme', 'glace', 'etoiles', 'arcade', 'glitch', 'royal'];
  function avatar(url, nom, cadre, taille, cls) {
    cadre = String(cadre || '').replace(/^c-/, ''); if (CADRES.indexOf(cadre) < 0) cadre = '';
    var s = taille || 64, ini = esc((String(nom || '?').trim()[0] || '?').toUpperCase());
    var im = url ? '<img class="lcf-a" src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-i="' + ini + '" onerror="this.outerHTML=\'<span class=&quot;lcf-a lcf-i&quot;>\'+(this.getAttribute(\'data-i\')||\'?\')+\'</span>\'">' : '<span class="lcf-a lcf-i">' + ini + '</span>';
    return '<span class="lcf' + (cadre ? ' lcf-' + cadre : '') + (cls ? ' ' + cls : '') + '" style="--s:' + s + 'px">' + (cadre ? '<span class="lcf-r"></span><span class="lcf-x"></span>' : '') + im + '</span>';
  }
  var COULEURS = ['or', 'rose', 'cyan', 'vert', 'arc'];
  function nom(pseudo, couleur) { couleur = String(couleur || '').replace(/^p-/, ''); return '<span class="lcn' + (COULEURS.indexOf(couleur) > -1 ? ' lcn-' + couleur : '') + '">' + esc(pseudo) + '</span>'; }

  var css = [
    /* bannières */
    '.lcb{position:relative;overflow:hidden;border-radius:14px;background:#1b1c1f;line-height:0;aspect-ratio:5/1;width:100%}',
    '.lcb svg{width:100%;height:100%;display:block;image-rendering:pixelated}',
    '.lcb-vide{background:linear-gradient(120deg,#2b2c31,#1a1b1e 60%,#2b2218)}',
    '.lcb svg g,.lcb svg rect{transform-box:fill-box}',
    '.lcb-tw{animation:lcbtw 3s steps(2,end) infinite}@keyframes lcbtw{0%,100%{opacity:1}50%{opacity:.15}}',
    '.lcb-bob{animation:lcbbob 4s ease-in-out infinite}.lcb-bob2{animation:lcbbob 5.5s ease-in-out infinite reverse}@keyframes lcbbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}',
    '.lcb-wv{animation:lcbwv 3.2s steps(8,end) infinite}@keyframes lcbwv{to{transform:translateX(-8px)}}',
    '.lcb-up{animation:lcbup 5s linear infinite}@keyframes lcbup{0%{transform:translateY(4px);opacity:0}30%{opacity:1}100%{transform:translateY(-12px);opacity:0}}',
    '.lcb-fl{animation:lcbfl 1.6s steps(2,end) infinite}@keyframes lcbfl{0%,100%{opacity:1}45%{opacity:.4}60%{opacity:.9}}',
    '.lcb-wn{animation:lcbwn 4.5s steps(1,end) infinite}.lcb-wn2{animation:lcbwn 6.3s steps(1,end) infinite;animation-delay:-2s}@keyframes lcbwn{0%,70%{opacity:1}72%,78%{opacity:.1}80%,100%{opacity:1}}',
    '.lcb-fg{animation:lcbfg 26s linear infinite alternate}@keyframes lcbfg{to{transform:translateX(40px)}}',
    '.lcb-bat{animation:lcbbat 11s linear infinite}@keyframes lcbbat{0%{transform:translate(-30px,0)}25%{transform:translate(60px,-5px)}50%{transform:translate(150px,3px)}75%{transform:translate(230px,-4px)}100%{transform:translate(320px,2px)}}',
    '.lcb-ec{animation:lcbec 9s steps(1,end) infinite}@keyframes lcbec{0%,92%,96%,100%{opacity:0}93%{opacity:.5}94%{opacity:0}95%{opacity:.35}}',
    '.lcb-cl{animation:lcbcl 2.6s ease-in-out infinite alternate}@keyframes lcbcl{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}',
    '.lcb-ship{animation:lcbsp 16s linear infinite}@keyframes lcbsp{0%{transform:translate(-20px,8px)}100%{transform:translate(300px,-2px)}}',
    '.lcb-sh{animation:lcbsh 9s linear infinite}@keyframes lcbsh{0%{transform:translate(40px,2px);opacity:0}5%{opacity:1}20%{transform:translate(110px,18px);opacity:0}100%{opacity:0}}',
    '.lcb-tail{animation:lcbtl 2.2s ease-in-out infinite alternate}@keyframes lcbtl{from{transform:rotate(-8deg)}to{transform:rotate(10deg)}}',
    '.lcb-ff{animation:lcbff 5s ease-in-out infinite}@keyframes lcbff{0%,100%{transform:translate(0,0);opacity:.1}25%{opacity:1}50%{transform:translate(6px,-4px);opacity:.3}75%{transform:translate(-3px,-7px);opacity:1}}',
    '.lcb-pt{animation:lcbpt 6s linear infinite}@keyframes lcbpt{0%{transform:translate(0,-4px);opacity:0}15%{opacity:1}100%{transform:translate(-28px,52px);opacity:.2}}',
    '.lcb-sc{animation:lcbsc 2.4s steps(1,end) infinite}@keyframes lcbsc{0%{opacity:.95}20%{opacity:.5}40%{opacity:1}60%{opacity:.35}80%{opacity:.85}}',
    '.lcb-rain{animation:lcbrn .55s linear infinite}.lcb-rain2{animation:lcbrn .8s linear infinite}@keyframes lcbrn{from{transform:translate(0,-6px)}to{transform:translate(-4px,18px)}}',
    /* cadres d'avatar */
    '.lcf{--s:64px;position:relative;display:inline-block;width:var(--s);height:var(--s);flex:0 0 auto;vertical-align:middle;line-height:0}',
    '.lcf-a{position:absolute;inset:0;width:100%;height:100%;border-radius:50%;object-fit:cover;background:#2c2e33;display:flex;align-items:center;justify-content:center;font:800 calc(var(--s)*.42)/1 Archivo,Inter,sans-serif;color:#ece8df;background-image:linear-gradient(135deg,#3a3d44,#232428)}',
    '.lcf-r,.lcf-x{position:absolute;pointer-events:none}',
    '.lcf:not([class*=" lcf-"]):not(.lcf-pixel) .lcf-a{box-shadow:0 0 0 1px rgba(255,255,255,.08)}',
    /* les cadres : l'avatar est réduit pour laisser la place à l'anneau */
    '.lcf[class*=" lcf-"] .lcf-a{inset:calc(var(--s)*.1);width:auto;height:auto}',
    '.lcf-r{inset:0;border-radius:50%;--w:calc(var(--s)*.1);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - var(--w)),#000 calc(100% - var(--w) + 1px));mask:radial-gradient(farthest-side,transparent calc(100% - var(--w)),#000 calc(100% - var(--w) + 1px))}',
    /* pixel doré */
    '.lcf-pixel .lcf-r{border-radius:0;clip-path:polygon(0 18%,8% 18%,8% 8%,18% 8%,18% 0,82% 0,82% 8%,92% 8%,92% 18%,100% 18%,100% 82%,92% 82%,92% 92%,82% 92%,82% 100%,18% 100%,18% 92%,8% 92%,8% 82%,0 82%);background:linear-gradient(135deg,#fff0a8,#e0a82a 40%,#8a5a12 60%,#f4d35e);-webkit-mask:none;mask:none;--w:0}',
    '.lcf-pixel .lcf-a{border-radius:0;clip-path:polygon(0 14%,10% 14%,10% 6%,14% 6%,14% 0,86% 0,86% 6%,90% 6%,90% 14%,100% 14%,100% 86%,90% 86%,90% 94%,86% 94%,86% 100%,14% 100%,14% 94%,10% 94%,10% 86%,0 86%)}',
    '.lcf-pixel .lcf-a{inset:calc(var(--s)*.12)}',
    '.lcf-pixel .lcf-x{inset:0;background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.7) 50%,transparent 60%);background-size:250% 100%;animation:lcfsh 2.8s linear infinite;clip-path:polygon(0 18%,8% 18%,8% 8%,18% 8%,18% 0,82% 0,82% 8%,92% 8%,92% 18%,100% 18%,100% 82%,92% 82%,92% 92%,82% 92%,82% 100%,18% 100%,18% 92%,8% 92%,8% 82%,0 82%);mix-blend-mode:overlay}',
    '@keyframes lcfsh{from{background-position:150% 0}to{background-position:-100% 0}}',
    /* néon violet */
    '.lcf-neon .lcf-r{background:linear-gradient(135deg,#d6a8ff,#8a3cff 50%,#ff4fd8);box-shadow:none}',
    '.lcf-neon .lcf-x{inset:0;border-radius:50%;box-shadow:0 0 calc(var(--s)*.18) #9a4dff,inset 0 0 calc(var(--s)*.12) #9a4dff;animation:lcfpl 2s ease-in-out infinite alternate}',
    '@keyframes lcfpl{from{opacity:.55}to{opacity:1}}',
    /* ronces */
    '.lcf-ronces .lcf-r{background:repeating-conic-gradient(from 0deg,#2f7a3a 0 9deg,#16381c 9deg 18deg),#1d4a24;--w:calc(var(--s)*.13)}',
    '.lcf-ronces .lcf-x{inset:-3%;border-radius:50%;background:repeating-conic-gradient(from 4deg,transparent 0 16deg,#d83a4a 16deg 19deg,transparent 19deg 36deg);-webkit-mask:radial-gradient(farthest-side,transparent 84%,#000 85%,#000 94%,transparent 95%);mask:radial-gradient(farthest-side,transparent 84%,#000 85%,#000 94%,transparent 95%)}',
    /* flammes */
    '.lcf-flamme .lcf-r{background:conic-gradient(from 0deg,#ffd04a,#ff6a1a,#c8202a,#ff6a1a,#ffd04a,#ff8a2a,#c8202a,#ffd04a);animation:lcfsp 3s linear infinite;--w:calc(var(--s)*.12)}',
    '.lcf-flamme .lcf-x{inset:-8%;border-radius:50%;background:radial-gradient(circle at 50% 8%,rgba(255,170,40,.9),transparent 22%),radial-gradient(circle at 12% 40%,rgba(255,120,30,.8),transparent 20%),radial-gradient(circle at 88% 36%,rgba(255,150,30,.85),transparent 20%),radial-gradient(circle at 30% 90%,rgba(255,90,20,.7),transparent 18%);filter:blur(1.5px);animation:lcffl .45s steps(2,end) infinite alternate}',
    '@keyframes lcffl{from{transform:scale(1) rotate(0)}to{transform:scale(1.05) rotate(4deg)}}',
    '@keyframes lcfsp{to{transform:rotate(360deg)}}',
    /* givre */
    '.lcf-glace .lcf-r{background:linear-gradient(160deg,#ffffff,#a8e4ff 35%,#4aa8e0 65%,#d8f4ff)}',
    '.lcf-glace .lcf-x{inset:-6%;background:radial-gradient(circle,#fff 0 1.5px,transparent 2px) 18% 8%/22% 22% no-repeat,radial-gradient(circle,#fff 0 1.2px,transparent 1.8px) 86% 30%/20% 20% no-repeat,radial-gradient(circle,#cfeeff 0 1.5px,transparent 2px) 70% 92%/20% 20% no-repeat,radial-gradient(circle,#fff 0 1px,transparent 1.6px) 8% 70%/20% 20% no-repeat;animation:lcftw 2.2s steps(2,end) infinite}',
    '@keyframes lcftw{0%,100%{opacity:1}50%{opacity:.2}}',
    /* voie lactée */
    '.lcf-etoiles .lcf-r{background:radial-gradient(circle at 20% 30%,#fff 0 1px,transparent 1.5px),radial-gradient(circle at 70% 20%,#ffe8a0 0 1px,transparent 1.5px),radial-gradient(circle at 85% 70%,#fff 0 1px,transparent 1.5px),radial-gradient(circle at 35% 85%,#a8c8ff 0 1px,transparent 1.5px),radial-gradient(circle at 55% 55%,#fff 0 1px,transparent 1.5px),conic-gradient(#1b1450,#4a2a9a,#1b1450,#2a4a9a,#1b1450);background-size:100% 100%;animation:lcfsp 14s linear infinite;--w:calc(var(--s)*.13)}',
    '.lcf-etoiles .lcf-x{inset:-3%;border-radius:50%;box-shadow:0 0 calc(var(--s)*.14) rgba(140,120,255,.7)}',
    /* arcade RGB */
    '.lcf-arcade .lcf-r{background:conic-gradient(#ff2a2a,#ffd02a,#2aff5a,#2ad4ff,#6a2aff,#ff2aa8,#ff2a2a);animation:lcfhu 4s linear infinite;--w:calc(var(--s)*.11)}',
    '.lcf-arcade .lcf-x{inset:0;border-radius:50%;box-shadow:0 0 calc(var(--s)*.12) rgba(255,255,255,.35)}',
    '@keyframes lcfhu{to{filter:hue-rotate(360deg)}}',
    /* glitch */
    '.lcf-glitch .lcf-r{background:#00e5ff;transform:translate(-2px,0);mix-blend-mode:screen;animation:lcfgl 1.7s steps(1,end) infinite}',
    '.lcf-glitch .lcf-x{inset:0;border-radius:50%;background:#ff2a8a;transform:translate(2px,0);mix-blend-mode:screen;-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - var(--s)*.1),#000 calc(100% - var(--s)*.1 + 1px));mask:radial-gradient(farthest-side,transparent calc(100% - var(--s)*.1),#000 calc(100% - var(--s)*.1 + 1px));animation:lcfgl2 1.7s steps(1,end) infinite}',
    '@keyframes lcfgl{0%,60%,100%{transform:translate(-2px,0);clip-path:inset(0)}62%{transform:translate(-4px,2px);clip-path:inset(20% 0 55% 0)}66%{transform:translate(3px,-1px);clip-path:inset(60% 0 10% 0)}70%{transform:translate(-2px,0);clip-path:inset(0)}}',
    '@keyframes lcfgl2{0%,60%,100%{transform:translate(2px,0);clip-path:inset(0)}63%{transform:translate(4px,-2px);clip-path:inset(40% 0 30% 0)}68%{transform:translate(-3px,1px);clip-path:inset(5% 0 75% 0)}72%{transform:translate(2px,0);clip-path:inset(0)}}',
    /* couronne royale */
    '.lcf-royal .lcf-r{background:linear-gradient(135deg,#fff3b0,#f0b82a 35%,#9a6212 60%,#ffe27a);--w:calc(var(--s)*.14)}',
    '.lcf-royal .lcf-x{left:20%;right:20%;top:-22%;height:34%;background:linear-gradient(#ffe27a,#d99a1c);clip-path:polygon(0 100%,0 30%,22% 62%,50% 0,78% 62%,100% 30%,100% 100%);filter:drop-shadow(0 0 3px rgba(255,210,90,.8));animation:lcfcr 2.4s ease-in-out infinite alternate}',
    '.lcf-royal .lcf-x::after{content:"";position:absolute;left:44%;top:46%;width:12%;height:20%;background:#d8202a;border-radius:50%}',
    '@keyframes lcfcr{from{transform:translateY(0)}to{transform:translateY(-6%)}}',
    '.lcf-royal{margin-top:calc(var(--s)*.18)}',
    /* couleurs de pseudo */
    '.lcn-or{color:#ffd35a;text-shadow:0 0 8px rgba(255,200,60,.35)}.lcn-rose{color:#ff7ac8}.lcn-cyan{color:#5fe3ff}.lcn-vert{color:#7dff9a}',
    '.lcn-arc{background:linear-gradient(90deg,#ff6a6a,#ffd25a,#7dff9a,#5fe3ff,#c08aff,#ff6a6a);background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;animation:lcnar 4s linear infinite}',
    '@keyframes lcnar{to{background-position:200% 0}}',
    '@media (prefers-reduced-motion:reduce){.lcb svg *,.lcf *,.lcf,.lcn{animation:none!important}}'
  ].join('\n');
  var st = document.createElement('style'); st.id = 'lcc-css'; st.textContent = css; document.head.appendChild(st);

  window.LCC = {banniere: banniere, avatar: avatar, nom: nom, NOMS: NOMS, CADRES: CADRES, COULEURS: COULEURS};
})();
