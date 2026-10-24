/* Clubi Shoot : moteur du jeu, 100 % déterministe (même graine + mêmes touches = même partie).
   Le navigateur l'utilise pour jouer, le serveur le rejoue pour vérifier la victoire avant de donner les points. */
var LCSIM = (function () {
  var W = 240, H = 320, FPS = 60, MAXF = 60 * 60 * 10, VAGUES = 3;
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function create(seed) {
    var rnd = mulberry32(seed >>> 0);
    var S = {f: 0, wave: 0, lives: 3, score: 0, px: 112, py: 296, cool: 0, inv: 0, wait: 90, bul: [], webs: [], sp: [], dir: 1, tick: 0, mv: 0, fireT: 60, state: 'play', total: 0, ev: []};
    function spawn(w) {
      var rows = w === 2 ? 5 : 4; S.sp = []; S.dir = 1; S.tick = 0;
      for (var r = 0; r < rows; r++) for (var c = 0; c < 8; c++) S.sp.push({x: 20 + c * 22, y: 30 + w * 8 + r * 17, t: Math.min(r, 3), c: c});
      S.total = S.sp.length; S.bul = []; S.webs = [];
    }
    spawn(0);
    function step(mask) {
      if (S.state !== 'play') return;
      S.f++;
      var dx = ((mask & 2) ? 1 : 0) - ((mask & 1) ? 1 : 0);
      S.px = Math.max(0, Math.min(W - 16, S.px + dx * 2));
      if (S.cool > 0) S.cool--; if (S.inv > 0) S.inv--;
      if (S.wait > 0) { S.wait--; return; }
      if ((mask & 4) && S.cool === 0 && S.bul.length < 2) { S.bul.push({x: S.px + 7, y: S.py - 4}); S.cool = 14; S.ev.push({k: 'tir'}); }
      var i, j, b, s, wb;
      for (i = S.bul.length - 1; i >= 0; i--) { b = S.bul[i]; b.y -= 5; if (b.y < -6) S.bul.splice(i, 1); }
      // les araignées avancent d'autant plus vite qu'il en reste peu
      var alive = S.sp.length; S.tick++;
      var iv = Math.max(1, 1 + Math.floor(alive * 9 / S.total) - S.wave);
      if (S.tick >= iv) {
        S.tick = 0; S.mv++;
        var mn = 999, mx = -1; for (i = 0; i < alive; i++) { if (S.sp[i].x < mn) mn = S.sp[i].x; if (S.sp[i].x > mx) mx = S.sp[i].x; }
        if ((S.dir > 0 && mx + 12 + 2 > W - 6) || (S.dir < 0 && mn - 2 < 6)) { for (i = 0; i < alive; i++) S.sp[i].y += 8; S.dir = -S.dir; }
        else for (i = 0; i < alive; i++) S.sp[i].x += S.dir * 2;
      }
      // tirs de toiles
      if (--S.fireT <= 0 && alive > 0) {
        var bas = {}; for (i = 0; i < alive; i++) { s = S.sp[i]; if (!bas[s.c] || s.y > bas[s.c].y) bas[s.c] = s; }
        var ks = Object.keys(bas).map(Number).sort(function (a, c) { return a - c; });
        var q = bas[ks[Math.floor(rnd() * ks.length)]];
        if (S.webs.length < 4) S.webs.push({x: q.x + 5, y: q.y + 9});
        S.fireT = Math.max(14, 36 - S.wave * 7) + Math.floor(rnd() * 30);
      }
      var ws = 2 + (S.wave >= 1 ? 1 : 0);
      for (i = S.webs.length - 1; i >= 0; i--) { wb = S.webs[i]; wb.y += ws; if (wb.y > H) S.webs.splice(i, 1); }
      // balles contre araignées
      for (i = S.bul.length - 1; i >= 0; i--) {
        b = S.bul[i];
        for (j = 0; j < S.sp.length; j++) {
          s = S.sp[j];
          if (b.x + 2 > s.x && b.x < s.x + 12 && b.y < s.y + 9 && b.y + 6 > s.y) { S.score += 10 * (4 - s.t); S.ev.push({k: 'mort', x: s.x + 6, y: s.y + 4, t: s.t}); S.sp.splice(j, 1); S.bul.splice(i, 1); break; }
        }
      }
      // toiles contre le chauve
      if (S.inv === 0) for (i = 0; i < S.webs.length; i++) {
        wb = S.webs[i];
        if (wb.x + 3 > S.px + 2 && wb.x < S.px + 14 && wb.y + 8 > S.py + 2 && wb.y < S.py + 17) {
          S.lives--; S.inv = 90; S.webs = []; S.ev.push({k: 'touche'});
          if (S.lives <= 0) { S.state = 'lost'; return; }
          break;
        }
      }
      for (i = 0; i < S.sp.length; i++) if (S.sp[i].y + 9 >= S.py) { S.state = 'lost'; return; }
      if (S.sp.length === 0) {
        if (S.wave >= VAGUES - 1) { S.state = 'won'; S.ev.push({k: 'gagne'}); return; }
        S.wave++; spawn(S.wave); S.wait = 90; S.ev.push({k: 'vague'});
      }
      if (S.ev.length > 40) S.ev.splice(0, S.ev.length - 40);
    }
    return {S: S, step: step};
  }
  // rejoue une partie à partir de la liste des changements de touches « frame:masque,frame:masque,… »
  function rejouer(seed, n, liste) {
    var g = create(seed), ch = [], p = String(liste || '').split(','), i, m = 0, k = 0;
    if (p.length > 6000) return {state: 'invalide'};
    for (i = 0; i < p.length; i++) { var a = p[i].split(':'); if (a.length === 2) { var f = +a[0], v = +a[1]; if (f >= 0 && f <= MAXF && (v >= 0 && v <= 7)) ch.push([f, v]); } }
    ch.sort(function (x, y) { return x[0] - y[0]; });
    n = Math.min(+n || 0, MAXF);
    while (g.S.state === 'play' && g.S.f < n) { while (k < ch.length && ch[k][0] <= g.S.f) { m = ch[k][1]; k++; } g.step(m); g.S.ev.length = 0; }
    return {state: g.S.state, f: g.S.f, score: g.S.score, lives: g.S.lives};
  }
  return {create: create, rejouer: rejouer, W: W, H: H, FPS: FPS, MAXF: MAXF};
})();

/* Clubi Shoot : écran de jeu (caché sur le site). */
(function () {
  var W = LCSIM.W, H = LCSIM.H;
  var PAL = {o: '#1b1209', s: '#f0c78f', h: '#f8e2b8', n: '#d9a56a', b: '#0a0a0a', w: '#ffffff', i: '#2a3cff', d: '#7a4a22', D: '#4e2e12', l: '#e8b070', g: '#c9d3e6', G: '#7f8aa3'};
  var HEAD = ['.......G', '.......g', '...ooooo', '..ossssh', '.ossssss', 'osssssss', 'osssssss', 'ossbbbbs', 'osswwiss', 'osswwiss', 'osssssss', 'ossssssn', 'oddsssss', 'oddddsll', 'odDDdlll', '.oDDDDDD', '..oooooo'];
  var SPI = [
    ['x.....', '.xxkkk', '..kkkk', 'xxkeek', '..kKKK', '.xkkkk', 'xx.kkk', 'x..Kk.', '......'],
    ['......', '..xkkk', 'x.kkkk', 'xxkeek', '.xkKKK', 'x.kkkk', '..xkkk', '.x.Kk.', 'x.....']
  ];
  var COUL = [['#b98cff', '#6f3fd1'], ['#59e07f', '#1f8f48'], ['#ff7070', '#b02a2a'], ['#ffd45a', '#b8860b']];
  function mir(rows) { return rows.map(function (r) { return r + r.split('').reverse().join(''); }); }
  function sprite(rows, pal) {
    var c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length; var x = c.getContext('2d');
    rows.forEach(function (r, y) { for (var i = 0; i < r.length; i++) { var k = r[i]; if (pal[k]) { x.fillStyle = pal[k]; x.fillRect(i, y, 1, 1); } } });
    return c;
  }
  var headC = sprite(mir(HEAD), PAL);
  var spiC = COUL.map(function (cl) { var p = {k: cl[0], K: cl[1], x: cl[1], e: '#fff', p: '#000'}; return SPI.map(function (f) { return sprite(mir(f), p); }); });
  var ov, cv, cx, scale = 2, run = null;
  var stars = []; (function () { var s = 7; for (var i = 0; i < 50; i++) { s = (s * 16807) % 2147483647; var a = s; s = (s * 16807) % 2147483647; stars.push([a % W, s % H, 1 + a % 3]); } })();
  var aud = null;
  function bip(f, d, t, v) { try { aud = aud || new (window.AudioContext || window.webkitAudioContext)(); var o = aud.createOscillator(), g = aud.createGain(); o.type = t || 'square'; o.frequency.value = f; g.gain.value = v || 0.04; o.connect(g); g.connect(aud.destination); o.start(); g.gain.exponentialRampToValueAtTime(0.0001, aud.currentTime + d); o.stop(aud.currentTime + d); } catch (e) {} }
  function C() { return window.lcCompte; }

  function build() {
    ov = document.createElement('div'); ov.id = 'lcsh';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(3,2,10,.985);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#fff;touch-action:none;user-select:none;-webkit-user-select:none';
    ov.innerHTML = '<button type="button" aria-label="Fermer" style="position:absolute;top:12px;right:16px;background:none;border:0;color:#fff;font-size:28px;cursor:pointer;line-height:1">✕</button><canvas></canvas>' +
      '<div class="lcsh-tc" style="display:none;gap:14px;align-items:center"><button type="button" data-k="1">◀</button><button type="button" data-k="4" style="width:110px">TIR</button><button type="button" data-k="2">▶</button></div>';
    var st = document.createElement('style');
    st.textContent = '#lcsh canvas{image-rendering:pixelated;border:2px solid #3b2b6b;border-radius:6px;background:#05030f;box-shadow:0 0 40px #5b3bd144}#lcsh .lcsh-tc button{width:84px;height:64px;border-radius:14px;border:2px solid #5b3bd1;background:#1a1236;color:#fff;font:700 20px ui-monospace,monospace}@media (pointer:coarse){#lcsh .lcsh-tc{display:flex!important}}';
    ov.appendChild(st); document.body.appendChild(ov);
    cv = ov.querySelector('canvas'); cx = cv.getContext('2d'); cv.width = W; cv.height = H;
    ov.querySelector('button').onclick = fermer;
    ov.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    ov.querySelectorAll('.lcsh-tc button').forEach(function (b) {
      var k = +b.dataset.k;
      var on = function (e) { e.preventDefault(); keys |= k; if (k === 4) action(); }, off = function (e) { e.preventDefault(); keys &= ~k; };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
    });
    cv.addEventListener('pointerdown', function () { action(); });
    fit(); window.addEventListener('resize', fit);
  }
  function fit() { if (!cv) return; var s = Math.max(1, Math.floor(Math.min((innerWidth - 20) / W, (innerHeight - (matchMedia('(pointer:coarse)').matches ? 190 : 80)) / H))); scale = s; cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px'; }

  var keys = 0, ecran = 'intro', game = null, info = '', rec = null, seed = 0, dernier = 0, acc = 0, rafId = 0, tPartie = 0, resultat = null;
  var parts = [];
  function onKey(e, d) {
    var k = e.code; var m = k === 'ArrowLeft' || k === 'KeyA' || k === 'KeyQ' ? 1 : k === 'ArrowRight' || k === 'KeyD' ? 2 : k === 'Space' || k === 'ArrowUp' || k === 'KeyW' || k === 'KeyZ' ? 4 : 0;
    if (k === 'Escape' && d) { fermer(); return; }
    if (!m) return; e.preventDefault(); e.stopPropagation();
    if (d) { keys |= m; if (m === 4 && !e.repeat) action(); } else keys &= ~m;
  }
  function kd(e) { onKey(e, true); } function ku(e) { onKey(e, false); }

  function action() {
    if (ecran === 'jeu') return;
    if (ecran === 'envoi') return;
    commencer();
  }
  function commencer() {
    var c = C(); info = ''; resultat = null;
    var lance = function (sd, deja) {
      seed = sd >>> 0; game = LCSIM.create(seed); rec = {ch: [], last: -1}; parts = []; acc = 0; dernier = performance.now(); ecran = 'jeu'; keys = 0; tPartie = Date.now(); recompense = !deja && c && c.etat() === 'in';
      deja_ = deja;
    };
    if (c && c.etat() === 'in') {
      ecran = 'envoi'; info = '…';
      c.appel('/shoot/debut', {session: c.sess(), body: {}}).then(function (r) {
        if (r.ok && r.d && typeof r.d.seed === 'number') lance(r.d.seed, !!r.d.deja); else lance(Math.floor(Math.random() * 4294967296), true);
      }).catch(function () { lance(Math.floor(Math.random() * 4294967296), true); });
    } else lance(Math.floor(Math.random() * 4294967296), true);
  }
  var recompense = false, deja_ = false;

  function fin() {
    var S = game.S;
    if (S.state === 'won') {
      var c = C();
      if (recompense && c) {
        ecran = 'envoi'; info = 'Vérification de ta victoire…';
        c.appel('/shoot/fin', {session: c.sess(), body: {n: S.f, i: rec.ch.join(',')}}).then(function (r) {
          if (r.ok && r.d && r.d.gagne) {
            resultat = {pts: r.d.pts, nouveau: !!r.d.nouveau};
            if (r.d.nouveau) {
              var m = c.moi(); if (m && m.points) { m.points.solde = (m.points.solde || 0) + r.d.pts; }
              c.ajoutSucces({id: 'clubishoot', nom: 'Maître du Clubi Shoot', desc: 'Tu as trouvé le jeu le mieux caché du site et vaincu toutes les araignées.', ico: 'clubishoot', tier: 'mythique', cat: 'Secrets', ts: Date.now()});
              try { c.puce(); } catch (e) {}
              c.toast('SECRET TROUVÉ !', '+' + r.d.pts + ' points et le badge « Maître du Clubi Shoot ».');
            }
          } else resultat = {erreur: true};
          ecran = 'gagne';
        }).catch(function () { resultat = {erreur: true}; ecran = 'gagne'; });
      } else ecran = 'gagne';
    } else ecran = 'perdu';
  }

  function boucle(t) {
    rafId = requestAnimationFrame(boucle);
    if (ecran === 'jeu' && game) {
      var dt = Math.min(100, t - dernier); dernier = t; acc += dt;
      while (acc >= 1000 / 60 && game.S.state === 'play') {
        acc -= 1000 / 60;
        if (keys !== rec.last) { rec.ch.push(game.S.f + ':' + keys); rec.last = keys; }
        game.step(keys);
        game.S.ev.forEach(function (e) {
          if (e.k === 'tir') bip(880, .06, 'square', .03);
          if (e.k === 'mort') { bip(180, .12, 'sawtooth', .05); for (var i = 0; i < 8; i++) parts.push({x: e.x, y: e.y, vx: (Math.random() - .5) * 3, vy: (Math.random() - .5) * 3, l: 18, c: COUL[e.t][0]}); }
          if (e.k === 'touche') bip(90, .35, 'sawtooth', .08);
          if (e.k === 'vague') bip(520, .3, 'triangle', .06);
          if (e.k === 'gagne') bip(660, .5, 'triangle', .08);
        });
        game.S.ev.length = 0;
      }
      if (game.S.state !== 'play') fin();
    }
    dessiner(t);
  }
  function txt(s, x, y, sz, col, al) { cx.font = 'bold ' + sz + 'px ui-monospace,Menlo,Consolas,monospace'; cx.fillStyle = col || '#fff'; cx.textAlign = al || 'center'; cx.fillText(s, x, y); }
  function dessiner(t) {
    cx.fillStyle = '#05030f'; cx.fillRect(0, 0, W, H);
    var S = game ? game.S : null, off = S ? S.f : Math.floor(t / 40);
    stars.forEach(function (s) { var y = (s[1] + off * s[2] * 0.12) % H; cx.fillStyle = s[2] === 3 ? '#9d8cff' : s[2] === 2 ? '#5a4ea8' : '#3a3270'; cx.fillRect(s[0], y, 1, 1); });
    if (S && (ecran === 'jeu' || ecran === 'gagne' || ecran === 'perdu' || ecran === 'envoi')) {
      S.sp.forEach(function (s) { cx.drawImage(spiC[s.t][S.mv & 1], s.x, s.y); });
      cx.fillStyle = '#ffe66b'; S.bul.forEach(function (b) { cx.fillRect(b.x, b.y, 2, 6); });
      S.webs.forEach(function (w) { cx.fillStyle = '#e8ecff'; var z = (S.f >> 2) & 1; cx.fillRect(w.x + 1, w.y, 1, 8); cx.fillRect(w.x + z, w.y + 1, 1, 2); cx.fillRect(w.x + 2 - z, w.y + 4, 1, 2); cx.fillStyle = '#8f9cff'; cx.fillRect(w.x + 1, w.y + 7, 1, 1); });
      if (S.state === 'play' ? (S.inv === 0 || (S.f >> 2) & 1) : S.state === 'won') cx.drawImage(headC, S.px, S.py);
      parts = parts.filter(function (p) { p.x += p.vx; p.y += p.vy; return --p.l > 0; });
      parts.forEach(function (p) { cx.fillStyle = p.c; cx.fillRect(p.x, p.y, 2, 2); });
      txt('SCORE ' + S.score, 6, 12, 10, '#ffe66b', 'left'); txt('VAGUE ' + (S.wave + 1) + '/3', W / 2, 12, 10, '#9d8cff');
      for (var i = 0; i < S.lives; i++) cx.drawImage(headC, W - 14 - i * 12, 3, 10, 10);
      if (S.wait > 0 && ecran === 'jeu') { txt(S.wave === 0 ? 'PRÊT ?' : 'VAGUE ' + (S.wave + 1), W / 2, H / 2, 16, '#fff'); }
    }
    if (ecran === 'intro') {
      cx.drawImage(headC, W / 2 - 24, 70, 48, 51);
      txt('CLUBI SHOOT', W / 2, 160, 22, '#ffe66b'); txt('Les araignées ont envahi le site.', W / 2, 184, 9, '#b8b0e8');
      txt('◀ ▶ / A D : bouger', W / 2, 214, 10, '#fff'); txt('ESPACE : tirer', W / 2, 230, 10, '#fff');
      if ((Math.floor(t / 500)) % 2) txt('ESPACE ou TOUCHE pour jouer', W / 2, 270, 10, '#5be37d');
    }
    if (ecran === 'envoi') { cx.fillStyle = 'rgba(5,3,15,.7)'; cx.fillRect(0, 0, W, H); txt(info || '…', W / 2, H / 2, 11, '#fff'); }
    if (ecran === 'perdu') {
      cx.fillStyle = 'rgba(5,3,15,.72)'; cx.fillRect(0, 0, W, H); txt('PERDU…', W / 2, 120, 24, '#ff7070'); txt('Score ' + S.score, W / 2, 148, 12, '#ffe66b');
      txt('Les araignées sont tenaces.', W / 2, 178, 9, '#b8b0e8'); if ((Math.floor(t / 500)) % 2) txt('ESPACE ou TOUCHE : rejouer', W / 2, 230, 10, '#5be37d');
    }
    if (ecran === 'gagne') {
      cx.fillStyle = 'rgba(5,3,15,.74)'; cx.fillRect(0, 0, W, H); txt('VICTOIRE !', W / 2, 96, 24, '#5be37d'); txt('Score ' + S.score, W / 2, 122, 12, '#ffe66b');
      if (resultat && resultat.pts && resultat.nouveau) { txt('+' + resultat.pts + ' POINTS', W / 2, 160, 20, '#ffd45a'); txt('Badge « Maître du Clubi Shoot »', W / 2, 184, 9, '#fff'); txt('Garde ce secret pour toi…', W / 2, 202, 9, '#b8b0e8'); }
      else if (resultat && resultat.pts && !resultat.nouveau) txt('Récompense déjà récupérée.', W / 2, 168, 10, '#b8b0e8');
      else if (resultat && resultat.erreur) txt('Victoire non validée par le serveur.', W / 2, 168, 9, '#ff9a9a');
      else if (!C() || C().etat() !== 'in') { txt('Connecte-toi avec Twitch avant de', W / 2, 160, 9, '#ffd45a'); txt('jouer pour gagner les points.', W / 2, 174, 9, '#ffd45a'); }
      else txt('Bien joué !', W / 2, 168, 11, '#fff');
      if ((Math.floor(t / 500)) % 2) txt('ESPACE : rejouer', W / 2, 250, 10, '#5be37d');
    }
  }
  function ouvrir() {
    if (ov) return; build(); ecran = 'intro'; game = null; keys = 0;
    document.addEventListener('keydown', kd, true); document.addEventListener('keyup', ku, true);
    rafId = requestAnimationFrame(boucle); document.documentElement.style.overflow = 'hidden';
  }
  function fermer() {
    if (!ov) return; cancelAnimationFrame(rafId); document.removeEventListener('keydown', kd, true); document.removeEventListener('keyup', ku, true);
    window.removeEventListener('resize', fit); ov.remove(); ov = null; document.documentElement.style.overflow = '';
  }
  window.LCShootOuvrir = ouvrir;
})();
