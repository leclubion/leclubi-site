/* Reliques du Site : cartes récompenses des secrets (dessinées en SVG, format 5:7, cadre doré, fenêtre en arche).
   LCR.liste : les reliques · LCR.carte(id, opts) : HTML d'une carte · LCR.svg(id) : le dessin seul */
(function () {
  var n = 0;
  function R(x, y, w, h, c, a) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"' + (a || '') + '/>'; }
  function pix(rows, x0, y0, k, pal) { var o = ''; rows.forEach(function (r, y) { for (var i = 0; i < r.length; i++) { var c = pal[r[i]]; if (c) o += R(x0 + i * k, y0 + y * k, k, k, c); } }); return o; }
  function mir(rows) { return rows.map(function (r) { return r + r.split('').reverse().join(''); }); }
  var HEAD = mir(['.......G', '.......g', '...ooooo', '..ossssh', '.ossssss', 'osssssss', 'osssssss', 'ossbbbbs', 'osswwiss', 'osswwiss', 'osssssss', 'ossssssn', 'oddsssss', 'oddddsll', 'odDDdlll', '.oDDDDDD', '..oooooo']);
  var HP = {o: '#1b1209', s: '#f0c78f', h: '#f8e2b8', n: '#d9a56a', b: '#0a0a0a', w: '#fff', i: '#2a3cff', d: '#7a4a22', D: '#4e2e12', l: '#e8b070', g: '#c9d3e6', G: '#7f8aa3'};
  var SPI = mir(['x.....', '.xxkkk', '..kkkk', 'xxkeek', '..kKKK', '.xkkkk', 'xx.kkk', 'x..Kk.', '......']);
  function spi(x, y, k, a, b) { return pix(SPI, x, y, k, {k: a, K: b, x: b, e: '#fff', p: '#000'}); }

  function spark(pts, c) { return '<!--L125-->' + pts.map(function (s, i) { return '<path transform="translate(' + s[0] + ' ' + s[1] + ') scale(' + s[2] + ')" d="M0-4L1 -1 4 0 1 1 0 4-1 1-4 0-1-1Z" fill="' + c + '"><animate attributeName="opacity" values="0;1;0" dur="' + (2 + i * .4).toFixed(1) + 's" begin="' + (i * .5).toFixed(1) + 's" repeatCount="indefinite"/></path>'; }).join(''); }
  /* ---------- dessins (fenêtre en arche : x 26-174, y 34-200) ---------- */
  var ART = {
    veuve: function (u) {
      var o = '<defs><radialGradient id="' + u + 'a" cx=".5" cy=".55" r=".6"><stop offset="0" stop-color="#5a1a6e"/><stop offset=".6" stop-color="#1c0b30"/><stop offset="1" stop-color="#07030f"/></radialGradient><radialGradient id="' + u + 'b" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff2a4a" stop-opacity=".55"/><stop offset="1" stop-color="#ff2a4a" stop-opacity="0"/></radialGradient><linearGradient id="' + u + 'c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2466"/><stop offset=".5" stop-color="#150a26"/><stop offset="1" stop-color="#05020a"/></linearGradient></defs>';
      o += '<rect x="20" y="30" width="160" height="176" fill="url(#' + u + 'a)"/>';
      var cx = 100, cy = 62, d = '', i, k;
      for (i = 0; i < 14; i++) { var a = i * Math.PI * 2 / 14; d += 'M' + cx + ' ' + cy + 'L' + (cx + 130 * Math.cos(a)).toFixed(1) + ' ' + (cy + 130 * Math.sin(a)).toFixed(1); }
      [16, 32, 50, 70, 94, 120].forEach(function (r) { var p = ''; for (k = 0; k <= 14; k++) { var a2 = k * Math.PI * 2 / 14, rr = r * (k % 2 ? .93 : 1); p += (k ? 'L' : 'M') + (cx + rr * Math.cos(a2)).toFixed(1) + ' ' + (cy + rr * Math.sin(a2)).toFixed(1); } d += p; });
      o += '<path d="' + d + '" fill="none" stroke="#cfc8ff" stroke-width=".8" opacity=".38"/>';
      o += '<circle cx="100" cy="128" r="62" fill="url(#' + u + 'b)"><animate attributeName="opacity" values=".6;1;.6" dur="3s" repeatCount="indefinite"/></circle>';
      var legs = ['M92 108Q56 74 34 96L26 134', 'M90 113Q50 98 28 124L22 160', 'M90 120Q48 124 28 150L28 186', 'M93 127Q62 150 52 180L52 198'];
      function legSet(ix, sw) { var L = ''; ix.forEach(function (n) { var p = legs[n]; L += '<path d="' + p + '"/>'; L += '<path d="' + p.replace(/(\d+) (\d+)/g, function (s, a, b) { return (200 - a) + ' ' + b; }) + '"/>'; }); return '<g fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#0b0516" stroke-width="' + sw + '">' + L + '</g><g stroke="#8a6cff" stroke-width="1.2" opacity=".8">' + L + '</g></g>'; }
      function bob(g, a) { return '<g>' + g + '<animateTransform attributeName="transform" type="translate" values="0 ' + (-4) + ';0 8;0 ' + (-4) + '" dur="5s" repeatCount="indefinite"/></g>'; }
      var body = '<ellipse cx="100" cy="146" rx="26" ry="32" fill="url(#' + u + 'c)" stroke="#0b0516" stroke-width="2.5"/><path d="M92 130Q100 140 108 130L106 146L112 160Q100 150 88 160L94 146Z" fill="#ff2a4a" opacity=".95"/><ellipse cx="92" cy="132" rx="6" ry="12" fill="#fff" opacity=".12" transform="rotate(14 92 132)"/>';
      body += '<circle cx="100" cy="110" r="14" fill="#1a0e30" stroke="#0b0516" stroke-width="2.5"/><g fill="#ff3a5a"><circle cx="95" cy="107" r="2.6"/><circle cx="105" cy="107" r="2.6"/><circle cx="92" cy="112" r="1.6"/><circle cx="108" cy="112" r="1.6"/><circle cx="97.500" cy="103" r="1.2"/><circle cx="102.500" cy="103" r="1.2"/></g><g fill="#fff" opacity=".9"><circle cx="94.300" cy="106.200" r=".9"/><circle cx="104.300" cy="106.200" r=".9"/></g>';
      body += '<path d="M95 120l2 7 2-6zM105 120l-2 7-2-6z" fill="#e9e4ff" stroke="#0b0516" stroke-width="1"/>';
      o += '<!--L22-->';
      o += bob('<line x1="100" y1="26" x2="100" y2="112" stroke="#d6d0ff" stroke-width="1" opacity=".7"/>' + legSet([2, 3], 5));
      o += '<!--L55-->';
      o += bob(body);
      o += '<!--L95-->';
      o += '<g transform="translate(100 130) scale(1.12) translate(-100 -130)">' + bob(legSet([0, 1], 6.5)) + '</g>';
      o += '<g stroke="#d6d0ff" fill="none" stroke-width="1" opacity=".55"><path d="M24 40Q40 70 34 110"/><path d="M176 40Q160 72 168 116"/></g>';
      o += '<g fill="#fff" opacity=".7"><circle cx="40" cy="170" r="1"><animate attributeName="opacity" values="0;1;0" dur="2.600s" repeatCount="indefinite"/></circle><circle cx="162" cy="60" r="1"><animate attributeName="opacity" values="0;1;0" dur="3.300s" repeatCount="indefinite"/></circle><circle cx="150" cy="180" r="1.200"><animate attributeName="opacity" values="0;1;0" dur="2.100s" repeatCount="indefinite"/></circle></g>';
      o += spark([[22,70,1.1],[178,150,1.3],[30,190,.9]], '#d6c8ff');
      return o;
    },
    balise: function (u) {
      var o = '<defs><linearGradient id="' + u + 'a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06141f"/><stop offset=".55" stop-color="#0f3447"/><stop offset="1" stop-color="#1c5a63"/></linearGradient><radialGradient id="' + u + 'b" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd86a" stop-opacity=".75"/><stop offset="1" stop-color="#ffd86a" stop-opacity="0"/></radialGradient></defs>';
      o += '<rect x="20" y="30" width="160" height="176" fill="url(#' + u + 'a)"/>';
      o += '<g fill="#e9fbff">' + [[40, 52, 1], [68, 44, 1.4], [150, 58, 1], [128, 46, 1.2], [160, 92, 1], [36, 98, 1]].map(function (s, i) { return '<circle cx="' + s[0] + '" cy="' + s[1] + '" r="' + s[2] + '"><animate attributeName="opacity" values=".2;1;.2" dur="' + (2 + i * .5) + 's" repeatCount="indefinite"/></circle>'; }).join('') + '</g>';
      o += '<circle cx="60" cy="64" r="11" fill="#f1f7d8"/><circle cx="64" cy="61" r="9" fill="#fff" opacity=".5"/>';
      o += '<circle cx="104" cy="112" r="64" fill="url(#' + u + 'b)"><animate attributeName="r" values="58;68;58" dur="3.500s" repeatCount="indefinite"/></circle>';
      o += '<!--L22-->';
      o += '<g><image href="images-site/balise.png" x="56" y="52" width="96" height="148" preserveAspectRatio="xMidYMid meet"/><animateTransform attributeName="transform" type="translate" values="0 3;0 -3;0 3" dur="3s" repeatCount="indefinite"/></g>';
      // mur de pierre derrière lequel elle se cache
      var w = '<rect x="20" y="148" width="160" height="60" fill="#10151c"/><rect x="20" y="148" width="160" height="4" fill="#2a3340"/>';
      for (var r = 0; r < 4; r++) for (var c = -1; c < 5; c++) { var x = 20 + c * 40 + (r % 2 ? 20 : 0); w += '<rect x="' + (x + 1) + '" y="' + (153 + r * 14) + '" width="38" height="12" fill="' + ((r + c) % 2 ? '#1a212b' : '#151b24') + '"/>'; }
      o += '<!--L60--><g clip-path="url(#' + u + 'k)">' + w + '</g>';
      o += '<g fill="#7bd7e8" opacity=".5"><rect x="50" y="170" width="6" height="2"/><rect x="120" y="182" width="8" height="2"/></g>';
      o += spark([[24,60,1.2],[176,90,1],[170,190,1.2],[30,170,.9]], '#bff6ff');
      return o;
    },
    coffre: function (u) {
      var o = '<defs><radialGradient id="' + u + 'a" cx=".5" cy=".62" r=".7"><stop offset="0" stop-color="#7a4a10"/><stop offset=".55" stop-color="#2a1608"/><stop offset="1" stop-color="#0a0503"/></radialGradient><linearGradient id="' + u + 'b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0" stop-opacity=".9"/><stop offset="1" stop-color="#ffb02a" stop-opacity="0"/></linearGradient><linearGradient id="' + u + 'c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a3414"/><stop offset=".5" stop-color="#8a5a24"/><stop offset="1" stop-color="#4a2a10"/></linearGradient></defs>';
      o += '<rect x="20" y="30" width="160" height="176" fill="url(#' + u + 'a)"/>';
      var rays = ''; for (var i = 0; i < 9; i++) { var a = -Math.PI + (i + .5) * Math.PI / 9, a1 = a - .09, a2 = a + .09; rays += '<polygon points="100,148 ' + (100 + 170 * Math.cos(a1)).toFixed(0) + ',' + (148 + 170 * Math.sin(a1)).toFixed(0) + ' ' + (100 + 170 * Math.cos(a2)).toFixed(0) + ',' + (148 + 170 * Math.sin(a2)).toFixed(0) + '"/>'; }
      o += '<g fill="url(#' + u + 'b)" opacity=".5">' + rays + '<animate attributeName="opacity" values=".35;.65;.35" dur="3s" repeatCount="indefinite"/></g>';
      o += '<!--L40-->';
      // coffre ouvert
      o += '<polygon points="56,150 144,150 132,112 68,112" fill="url(#' + u + 'c)" stroke="#2a1608" stroke-width="3" stroke-linejoin="round"/><polygon points="64,146 136,146 127,118 73,118" fill="#2a1608" opacity=".55"/><rect x="68" y="112" width="64" height="6" rx="2" fill="#c8901e" stroke="#2a1608" stroke-width="2"/>';
      o += '<ellipse cx="100" cy="150" rx="40" ry="8" fill="#ffd86a"/><ellipse cx="100" cy="150" rx="32" ry="5" fill="#fff3b0"/>';
      o += '<rect x="56" y="148" width="88" height="44" rx="3" fill="url(#' + u + 'c)" stroke="#2a1608" stroke-width="3"/>' + '<rect x="56" y="148" width="88" height="7" fill="#c8901e" stroke="#2a1608" stroke-width="2"/><rect x="72" y="148" width="7" height="44" fill="#c8901e" stroke="#2a1608" stroke-width="2"/><rect x="121" y="148" width="7" height="44" fill="#c8901e" stroke="#2a1608" stroke-width="2"/><rect x="92" y="158" width="16" height="18" rx="3" fill="#ffd86a" stroke="#2a1608" stroke-width="2.5"/><circle cx="100" cy="166" r="2.600" fill="#2a1608"/><rect x="99" y="166" width="2" height="6" fill="#2a1608"/>';
      o += '<g fill="#ffd86a" stroke="#7a4a10" stroke-width="1"><ellipse cx="46" cy="194" rx="9" ry="3"/><ellipse cx="150" cy="195" rx="10" ry="3"/><ellipse cx="156" cy="190" rx="8" ry="3"/></g>';
      o += '<!--L95-->';
      o += '<g><polygon points="100,62 120,80 100,108 80,80" fill="#7df9ff" stroke="#0a2a3a" stroke-width="2.5" stroke-linejoin="round"/><polygon points="100,62 120,80 100,80" fill="#c8fdff"/><polygon points="100,80 120,80 100,108" fill="#2ab8d8"/><path d="M80 80H120M100 62V108" stroke="#0a2a3a" stroke-width="1" opacity=".5"/><animateTransform attributeName="transform" type="translate" values="0 0;0 -7;0 0" dur="3s" repeatCount="indefinite"/></g>';
      o += '<g fill="#fff"><path d="M74 66l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"><animate attributeName="opacity" values="0;1;0" dur="2.200s" repeatCount="indefinite"/></path><path d="M130 94l1.500 4 4 1.500-4 1.500-1.500 4-1.500-4-4-1.500 4-1.500z"><animate attributeName="opacity" values="0;1;0" dur="2.800s" repeatCount="indefinite"/></path></g>';
      o += spark([[24,100,1.3],[176,60,1.1],[170,176,1.4],[34,188,1]], '#ffe9a0');
      return o;
    },
    shoot: function (u) {
      var o = '<defs><linearGradient id="' + u + 'a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#06031a"/><stop offset=".6" stop-color="#2a0f5a"/><stop offset="1" stop-color="#7a1f7a"/></linearGradient></defs>';
      o += '<rect x="20" y="30" width="160" height="176" fill="url(#' + u + 'a)"/>';
      var st = ''; [[34, 48], [60, 70], [150, 54], [120, 88], [172, 110], [40, 120], [86, 56], [140, 126], [28, 80]].forEach(function (s, i) { st += '<rect x="' + s[0] + '" y="' + s[1] + '" width="2" height="2" fill="#fff"><animate attributeName="opacity" values=".2;1;.2" dur="' + (1.6 + i * .3) + 's" repeatCount="indefinite"/></rect>'; });
      o += st;
      // grille néon
      var gr = ''; for (var i = -6; i <= 6; i++) gr += '<line x1="' + (100 + i * 8) + '" y1="156" x2="' + (100 + i * 34) + '" y2="206" stroke="#ff4fd8" stroke-width="1" opacity=".5"/>'; [162, 170, 182, 198].forEach(function (y) { gr += '<line x1="20" y1="' + y + '" x2="180" y2="' + y + '" stroke="#ff4fd8" stroke-width="1" opacity=".45"/>'; });
      o += gr;
      o += '<!--L40-->';
      o += spi(46, 58, 4, '#59e07f', '#1f8f48') + spi(104, 52, 4, '#ff7070', '#b02a2a') + spi(76, 84, 3, '#b98cff', '#6f3fd1') + spi(130, 92, 3, '#ffd45a', '#b8860b');
      o += '<rect x="106" y="102" width="4" height="46" fill="#7df9ff" opacity=".9"><animate attributeName="opacity" values=".4;1;.4" dur=".6s" repeatCount="indefinite"/></rect><rect x="103" y="102" width="10" height="46" fill="#7df9ff" opacity=".18"/>';
      o += '<g fill="#ffe66b"><rect x="116" y="68" width="4" height="4"/><rect x="108" y="72" width="3" height="3"/><rect x="122" y="76" width="3" height="3"/></g>';
      o += '<!--L90-->';
      o += '<g>' + pix(HEAD, 74, 146, 4, HP) + '<animateTransform attributeName="transform" type="translate" values="-14 0;14 0;-14 0" dur="5s" repeatCount="indefinite"/></g>';
      o += spark([[24,80,1.2],[178,110,1.2],[172,60,.9]], '#ffffff');
      return o;
    }
  };
  var LISTE = [
    {id: 'veuve', nom: 'La Veuve du Site', secret: 'Arachnophobe', cle: 'araignee', n: 'I', c: '#b48cff', rim: 'violet'},
    {id: 'balise', nom: 'La Balise Cachée', secret: 'Cache-Cache', cle: 'cachecache', n: 'II', c: '#ffd86a', rim: 'or'},
    {id: 'coffre', nom: 'Le Coffre Scellé', secret: 'Ouvrir le Coffre', cle: 'coffre', n: 'III', c: '#ffb02a', rim: 'or'},
    {id: 'shoot', nom: 'Le Chauve des Étoiles', secret: 'Clubi Shoot', cle: 'clubishoot', n: 'IV', c: '#7df9ff', rim: 'arc'}
  ];
  function svg(id) {
    var r = LISTE.filter(function (x) { return x.id === id; })[0]; if (!r) return '';
    var u = 'lr' + (++n), g = u + 'g';
    var s = '<svg class="lr-art" viewBox="0 0 200 280" preserveAspectRatio="xMidYMid slice" shape-rendering="geometricPrecision" aria-hidden="true" style="--c:' + r.c + '"><defs><linearGradient id="' + g + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".35" stop-color="#f0b82a"/><stop offset=".65" stop-color="#8a5412"/><stop offset="1" stop-color="#ffe27a"/></linearGradient>' +
      '<linearGradient id="' + u + 'r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6bd5"><animate attributeName="stop-color" values="#ff6bd5;#5cf2ff;#ffe66b;#ff6bd5" dur="4s" repeatCount="indefinite"/></stop><stop offset="1" stop-color="#5cf2ff"><animate attributeName="stop-color" values="#5cf2ff;#ffe66b;#ff6bd5;#5cf2ff" dur="4s" repeatCount="indefinite"/></stop></linearGradient>' +
      '<clipPath id="' + u + 'k"><path d="M26 200V108A74 74 0 0 1 174 108V200Z"/></clipPath><linearGradient id="' + u + 's" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>';
    var sp0 = ART[id](u).split(/<!--L(\d*)-->/), parts = [sp0[0]], zs = [0]; for (var q = 1; q < sp0.length; q += 2) { zs.push(+sp0[q] || 0); parts.push(sp0[q + 1]); }
    var fr = r.rim === 'arc' ? 'url(#' + u + 'r)' : 'url(#' + g + ')';
    s += '<rect width="200" height="280" rx="14" fill="#0a0912"/><rect x="2" y="2" width="196" height="276" rx="13" fill="none" stroke="' + fr + '" stroke-width="3.500"/><rect x="9" y="9" width="182" height="262" rx="9" fill="none" stroke="' + fr + '" stroke-width=".8" opacity=".7"/>';
    s += '<text x="100" y="23" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-size="7.500" letter-spacing="3" fill="url(#' + g + ')">RELIQUE ' + r.n + '</text>';
    s += '<path d="M24 202V108A76 76 0 0 1 176 108V202Z" fill="#05040a" stroke="' + fr + '" stroke-width="2.500"/><g clip-path="url(#' + u + 'k)">' + parts[0] + '<rect x="-60" y="30" width="40" height="180" fill="url(#' + u + 's)" transform="rotate(18 100 120)"><animateTransform attributeName="transform" type="translate" values="0 0;300 0;300 0" keyTimes="0;.4;1" dur="6s" repeatCount="indefinite" additive="sum"/></rect></g>';
    s += '<path d="M18 214H182L176 240H24Z" fill="#0d0b16" stroke="' + fr + '" stroke-width="2.500" stroke-linejoin="round"/>';
    s += '<text x="100" y="232" text-anchor="middle" font-family="Georgia,\'Times New Roman\',serif" font-size="' + (r.nom.length > 20 ? 12 : 13.500) + '" font-weight="700" fill="url(#' + g + ')">' + r.nom + '</text>';
    s += '<text x="100" y="256" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-size="7" letter-spacing="1.800" fill="' + r.c + '" opacity=".9">SECRET · ' + r.secret.toUpperCase() + '</text>';
    s += '<g fill="' + fr + '"><path d="M100 264l3 3-3 3-3-3z"/><path d="M80 267l2 2-2 2-2-2zM120 267l2 2-2 2-2-2z"/></g>';
    s += '<g fill="' + fr + '"><path d="M14 14l3 3-3 3-3-3z"/><path d="M186 14l3 3-3 3-3-3z"/><path d="M14 260l3 3-3 3-3-3z"/><path d="M186 260l3 3-3 3-3-3z"/></g></svg>';
    for (var zi = 1; zi < parts.length; zi++) s += '<svg class="lr-art lr-fg" viewBox="0 0 200 280" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="--z:' + (zs[zi] || (zi * 40)) + 'px">' + parts[zi] + '</svg>';
    return s;
  }
  function carte(id, o) { o = o || {}; return '<div class="lr-card' + (o.lock ? ' lr-lock' : '') + '" data-lr="' + id + '" tabindex="0" role="button">' + svg(id) + '<i class="lr-glare"></i></div>'; }
  var css = '.lr-card{position:relative;aspect-ratio:5/7;border-radius:14px;cursor:pointer;transform-style:preserve-3d;transition:box-shadow .2s;box-shadow:0 10px 26px rgba(0,0,0,.45);--rx:0deg;--ry:0deg;--gx:50%;--gy:50%;transform:perspective(700px) rotateX(var(--rx)) rotateY(var(--ry))}.lr-card:hover{transition:transform .15s ease-out,box-shadow .2s;animation:none;box-shadow:0 14px 34px rgba(0,0,0,.55),0 0 24px rgba(255,200,80,.25)}.lr-art{position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:14px}.lr-glare{position:absolute;inset:0;border-radius:14px;pointer-events:none;background:radial-gradient(circle at var(--gx) var(--gy),rgba(255,255,255,.28),transparent 45%);mix-blend-mode:overlay;opacity:0;transition:opacity .2s}.lr-card:hover .lr-glare{opacity:1}.lr-lock .lr-art{filter:grayscale(1) brightness(.35)}@property --rx{syntax:\'<angle>\';inherits:false;initial-value:0deg}@property --ry{syntax:\'<angle>\';inherits:false;initial-value:0deg}.lr-card:not(.lr-dos){animation:lridle 7s ease-in-out infinite}@keyframes lridle{0%,100%{--rx:4deg;--ry:-11deg}50%{--rx:-4deg;--ry:11deg}}.lr-fg{pointer-events:none;overflow:visible;transform:translateZ(var(--z,30px));filter:drop-shadow(0 8px 6px rgba(0,0,0,.6))}.lr-glare{transform:translateZ(1px)}@media (prefers-reduced-motion:reduce){.lr-card{transition:none;animation:none!important}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  document.addEventListener('pointermove', function (e) {
    var c = e.target.closest ? e.target.closest('.lr-card') : null; if (!c) return;
    var b = c.getBoundingClientRect(), x = (e.clientX - b.left) / b.width, y = (e.clientY - b.top) / b.height;
    c.style.setProperty('--ry', ((x - .5) * 16).toFixed(1) + 'deg'); c.style.setProperty('--rx', ((.5 - y) * 16).toFixed(1) + 'deg'); c.style.setProperty('--gx', (x * 100) + '%'); c.style.setProperty('--gy', (y * 100) + '%');
  });
  document.addEventListener('pointerout', function (e) { var c = e.target.closest ? e.target.closest('.lr-card') : null; if (c && !c.contains(e.relatedTarget)) { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); } });

  /* ---------- dos de carte mystère (reliques pas encore obtenues : jamais de dessin) ---------- */
  function dos() {
    var u = 'lrd' + (++n);
    return '<div class="lr-card lr-dos" aria-label="Relique mystère"><svg class="lr-art" viewBox="0 0 200 280" aria-hidden="true"><defs><linearGradient id="' + u + 'g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a6a3a"/><stop offset=".5" stop-color="#4a3e22"/><stop offset="1" stop-color="#8a7a46"/></linearGradient><pattern id="' + u + 'p" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M6 0l6 6-6 6-6-6z" fill="none" stroke="#3a3322" stroke-width=".7"/></pattern></defs>' +
      '<rect width="200" height="280" rx="14" fill="#0c0b12"/><rect x="2" y="2" width="196" height="276" rx="13" fill="none" stroke="url(#' + u + 'g)" stroke-width="3.500"/><rect x="9" y="9" width="182" height="262" rx="9" fill="url(#' + u + 'p)" stroke="url(#' + u + 'g)" stroke-width=".8" opacity=".9"/>' +
      '<path d="M44 220V112A56 56 0 0 1 156 112V220Z" fill="#07060c" stroke="url(#' + u + 'g)" stroke-width="2.500"/><text x="100" y="152" text-anchor="middle" font-family="Georgia,serif" font-size="64" font-weight="700" fill="url(#' + u + 'g)">?</text><text x="100" y="196" text-anchor="middle" font-family="Georgia,serif" font-size="9" letter-spacing="3" fill="#8a7a46">RELIQUE</text>' +
      '<g fill="url(#' + u + 'g)"><path d="M14 14l3 3-3 3-3-3z"/><path d="M186 14l3 3-3 3-3-3z"/><path d="M14 260l3 3-3 3-3-3z"/><path d="M186 260l3 3-3 3-3-3z"/></g></svg></div>';
  }
  function panel(owned, moi) {
    owned = owned || [];
    var h = '<div class="lr-intro"><h2>Reliques du Site</h2><p>' + (moi ? 'Des récompenses rares qui ne se gagnent qu\'en découvrant les secrets du site. Chacune rapporte 500 points. Les reliques que tu n\'as pas encore restent mystérieuses.' : 'Les reliques de ce viewer, gagnées en découvrant les secrets du site.') + '</p><b class="lr-cnt">' + owned.length + ' / ' + LISTE.length + '</b></div><div class="lr-grid">';
    LISTE.forEach(function (r) { h += owned.indexOf(r.id) >= 0 ? carte(r.id) : dos(); });
    return h + '</div>';
  }

  /* ---------- bannière « Récupère ta récompense » + révélation ---------- */
  var closed = false, busy = false;
  function C() { return window.lcCompte; }
  function banner(nb) {
    var el = document.getElementById('lr-ban');
    if (!nb || closed) { if (el) el.remove(); return; }
    if (el) { el.querySelector('small').textContent = nb + (nb > 1 ? ' reliques t\'attendent' : ' relique t\'attend') + ' · +' + (nb * 500) + ' pts'; return; }
    el = document.createElement('div'); el.id = 'lr-ban';
    el.innerHTML = '<span class="lr-ico">✦</span><span class="lr-tx"><b>Récupère ta récompense</b><small>' + nb + (nb > 1 ? ' reliques t\'attendent' : ' relique t\'attend') + ' · +' + (nb * 500) + ' pts</small></span><button type="button" class="lr-go">Récupérer</button><button type="button" class="lr-x" aria-label="Plus tard">✕</button>';
    document.body.appendChild(el);
    el.querySelector('.lr-go').onclick = recuperer;
    el.querySelector('.lr-x').onclick = function () { closed = true; el.remove(); };
  }
  function recuperer() {
    var c = C(); if (!c || busy) return; busy = true;
    c.appel('/reliques/recuperer', {session: c.sess(), body: {}}).then(function (r) {
      busy = false;
      if (!r.ok || !r.d || !r.d.nouvelles || !r.d.nouvelles.length) return;
      var m = c.moi(); if (m) { m.reliques = r.d.reliques; m.relAttente = r.d.relAttente; if (m.points) m.points.solde = (m.points.solde || 0) + r.d.pts; }
      try { c.puce(); } catch (e) {}
      banner(0); revele(r.d.nouvelles, r.d.pts);
    }).catch(function () { busy = false; });
  }
  function revele(ids, pts) {
    var ov = document.createElement('div'); ov.id = 'lr-ov';
    ov.innerHTML = '<div class="lr-bx"><h2>' + (ids.length > 1 ? 'Reliques récupérées !' : 'Relique récupérée !') + '</h2><div class="lr-rev">' + ids.map(function (id) { return '<div class="lr-flip"><div class="lr-fi"><div class="lr-bk">' + dos() + '</div><div class="lr-ft">' + carte(id) + '</div></div></div>'; }).join('') + '</div><p class="lr-pts">+' + pts + ' points ajoutés à ton solde de la boutique</p><div class="lr-bt"><button type="button" class="lr-b1">Voir mes reliques</button><button type="button" class="lr-b2">Fermer</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelectorAll('.lr-fi').forEach(function (f, i) { setTimeout(function () { f.classList.add('on'); }, 700 + i * 650); });
    var fin = function () { ov.remove(); };
    ov.querySelector('.lr-b2').onclick = fin;
    ov.querySelector('.lr-b1').onclick = function () { fin(); if (window.lcOuvrirReliques) window.lcOuvrirReliques(); };
    ov.addEventListener('click', function (e) { if (e.target === ov) fin(); });
  }
  setInterval(function () {
    var c = C(); if (!c || c.etat() !== 'in') { banner(0); return; }
    var m = c.moi(); banner(m && m.relAttente ? m.relAttente.length : 0);
  }, 1500);
  var css2 = '.lr-intro{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;margin:0 0 22px}.lr-intro h2{margin:0;font-size:22px}.lr-intro p{margin:0;flex:1 1 340px;color:var(--muted);font-size:14px;line-height:1.5}.lr-cnt{font-size:20px;color:var(--accent)}' +
    '.lr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:24px;max-width:980px}.lr-dos{cursor:default}.lr-dos:hover{transform:none}' +
    '#lr-ban{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:9000;display:flex;align-items:center;gap:14px;padding:12px 14px 12px 18px;border-radius:16px;background:#14121e;color:#fff;border:2px solid #f0b82a;box-shadow:0 10px 34px rgba(0,0,0,.55),0 0 26px rgba(240,184,42,.35);animation:lrb .6s cubic-bezier(.2,1.4,.4,1) both,lrg 2.4s ease-in-out infinite alternate;max-width:calc(100vw - 24px)}' +
'#lr-zm{position:fixed;inset:0;z-index:9600;background:rgba(5,4,10,.9);display:flex;align-items:center;justify-content:center;padding:16px;cursor:zoom-out;animation:lrz .2s ease-out}.lr-zb{width:min(440px,86vw,calc((100vh - 40px)*5/7));cursor:default}.lr-zb .lr-card{width:100%;box-shadow:0 20px 60px rgba(0,0,0,.7),0 0 40px rgba(255,200,80,.25)}.lr-zx{position:absolute;top:14px;right:14px;width:40px;height:40px;border-radius:50%;border:2px solid #f0b82a;background:#14121e;color:#fff;font-size:18px;cursor:pointer}@keyframes lrz{from{opacity:0}}' +
    '@keyframes lrb{from{opacity:0;transform:translate(-50%,30px)}}@keyframes lrg{to{box-shadow:0 10px 34px rgba(0,0,0,.55),0 0 38px rgba(240,184,42,.6)}}' +
    '#lr-ban .lr-ico{font-size:24px;color:#ffd86a}#lr-ban .lr-tx{display:flex;flex-direction:column;line-height:1.25}#lr-ban b{font-size:15px}#lr-ban small{color:#c9c3a8;font-size:12px}#lr-ban .lr-go{border:0;border-radius:10px;padding:10px 16px;font:700 14px system-ui,sans-serif;color:#2a1a00;cursor:pointer;background:linear-gradient(135deg,#fff3b0,#f0b82a 55%,#c8901e)}#lr-ban .lr-x{background:none;border:0;color:#9a97aa;font-size:16px;cursor:pointer;padding:4px 6px}' +
    '#lr-ov{position:fixed;inset:0;z-index:9500;background:rgba(5,4,10,.92);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}.lr-bx{text-align:center;color:#fff;max-width:900px}.lr-bx h2{font-size:26px;margin:0 0 18px;color:#ffd86a}' +
    '.lr-rev{display:flex;flex-wrap:wrap;gap:20px;justify-content:center;margin-bottom:18px}.lr-flip{width:min(210px,40vw);perspective:900px}.lr-fi{position:relative;aspect-ratio:5/7;transform-style:preserve-3d;transition:transform .9s cubic-bezier(.3,1.2,.4,1)}.lr-fi.on{transform:rotateY(180deg)}' +
    '.lr-bk,.lr-ft{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden}.lr-ft{transform:rotateY(180deg)}.lr-bk .lr-card,.lr-ft .lr-card{width:100%;height:100%;transform:none}' +
    '.lr-pts{font-size:17px;color:#fff;margin:6px 0 18px}.lr-bt{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}.lr-bt button{border-radius:10px;padding:11px 20px;font:700 14px system-ui,sans-serif;cursor:pointer;border:2px solid #f0b82a}.lr-b1{background:linear-gradient(135deg,#fff3b0,#f0b82a 55%,#c8901e);color:#2a1a00}.lr-b2{background:transparent;color:#ffd86a}' +
    '@media (prefers-reduced-motion:reduce){#lr-ban{animation:none}.lr-fi{transition:none}}';
  var st2 = document.createElement('style'); st2.textContent = css2; document.head.appendChild(st2);
  /* ---------- agrandir une relique (seulement celles obtenues) ---------- */
  function zoom(id) {
    if (document.getElementById('lr-zm')) return;
    var o = document.createElement('div'); o.id = 'lr-zm'; o.setAttribute('role', 'dialog');
    o.innerHTML = '<div class="lr-zb">' + carte(id) + '</div><button type="button" class="lr-zx" aria-label="Fermer">✕</button>';
    document.body.appendChild(o);
    var fin = function () { o.remove(); document.removeEventListener('keydown', kd); };
    var kd = function (e) { if (e.key === 'Escape') fin(); };
    document.addEventListener('keydown', kd);
    o.addEventListener('click', fin);
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('.lr-grid .lr-card') : null;
    if (!c || c.classList.contains('lr-dos') || !c.getAttribute('data-lr')) return;
    zoom(c.getAttribute('data-lr'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var c = document.activeElement; if (c && c.closest && c.closest('.lr-grid') && c.getAttribute && c.getAttribute('data-lr')) { e.preventDefault(); zoom(c.getAttribute('data-lr')); }
  });
  window.LCR = {liste: LISTE, svg: svg, carte: carte, dos: dos, panel: panel};
})();
