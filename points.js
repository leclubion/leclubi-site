/* Points du Jeu du jour : page Boutique + onglet « Jeu du jour » du Classement.
   S'appuie sur window.lcCompte (compte Twitch) et window.LCC (cosmétiques). */
(function () {
  var C = function () { return window.lcCompte; };
  var g = function (i) { return document.getElementById(i); };
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; }
  function n(x) { return Number(x || 0).toLocaleString('fr-FR'); }
  function api(chemin, body) { var c = C(); return c.appel(chemin, {session: c.sess(), body: body}); }
  function connecte() { var c = C(); return c && c.etat() === 'in' && c.moi(); }

  var css = [
    '.bq-top{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:26px}',
    '.bq-eye{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:600}',
    '.bq-top h1{margin:6px 0 0;font-family:var(--display);text-transform:uppercase;font-size:clamp(30px,5vw,44px)}',
    '.bq-bal{display:flex;flex-wrap:wrap;gap:12px 22px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px 22px}',
    '.bq-bal small{display:block;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}',
    '.bq-bal b{font:800 30px/1.1 var(--display);color:var(--accent)}',
    '.bq-bal p{margin:0;font-size:13px;color:var(--muted);line-height:1.5}.bq-bal p b{font:600 13px Inter,sans-serif;color:var(--text)}',
    '.bq-sep{width:1px;align-self:stretch;background:var(--line)}',
    '.bq-prev{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden;margin-bottom:26px}',
    '.bq-prev .lcb{border-radius:0;aspect-ratio:6/1;min-height:90px}',
    '.bq-pv{display:flex;align-items:center;gap:16px;padding:0 24px 18px;margin-top:-34px;position:relative}',
    '.bq-pv .lcf{box-shadow:0 0 0 4px var(--panel);border-radius:50%}',
    '.bq-pv .lcf[class*=" lcf-"]{box-shadow:none}',
    '.bq-pv h2{margin:34px 0 0;font-size:22px}.bq-pv p{margin:0;font-size:13px;color:var(--muted)}',
    '.bq-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}',
    '.bq-tabs button{cursor:pointer;border-radius:999px;padding:9px 18px;font:600 14px Inter,sans-serif;border:1px solid var(--line);background:transparent;color:var(--muted)}',
    '.bq-tabs button[aria-selected=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}',
    '.bq-pioche{display:flex;flex-wrap:wrap;align-items:center;gap:20px 28px;background:linear-gradient(110deg,#2b060c,#5a0f17);border:1px solid #7a2a30;border-radius:20px;padding:24px 28px;margin-bottom:30px;color:#f3e6c6}',
    '.bq-fan{display:flex;padding-left:12px}.bq-fan i{display:block;width:60px;aspect-ratio:2/3;border-radius:9px;border:2px solid #f4d98a;background:linear-gradient(160deg,#c8202a,#3a0810);margin-left:-14px;box-shadow:0 6px 14px rgba(0,0,0,.4)}',
    '.bq-fan i:nth-child(1){transform:rotate(-9deg)}.bq-fan i:nth-child(3){transform:rotate(9deg)}',
    '.bq-pioche h2{margin:0;font:800 24px var(--display);text-transform:uppercase;color:#fff}',
    '.bq-pioche p{margin:6px 0 0;font-size:14px;line-height:1.5;color:#e8d9b8}',
    '.bq-pr{text-align:right}.bq-pr b{display:block;font:800 28px var(--display);color:#ffe08a}',
    '.bq-pr small{display:block;margin-top:6px;font-size:12px;color:#e8d9b8}',
    '.bq-h{margin:0 0 4px;font:800 22px var(--display);text-transform:uppercase}.bq-sub{margin:0 0 16px;font-size:14px;color:var(--muted)}',
    '.bq-sec{margin-bottom:36px}',
    '.bq-grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}',
    '.bq-grid.ban{grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}.bq-grid.ln{grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}',
    '.bq-c{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center}',
    '.bq-c.ban{padding:0;overflow:hidden;align-items:stretch;text-align:left}.bq-c.ban .lcb{border-radius:0;aspect-ratio:5/1.15}',
    '.bq-cb{padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}',
    '.bq-c.ln{flex-direction:row;justify-content:space-between;text-align:left;padding:16px 18px}',
    '.bq-n{font-weight:600;font-size:15px}.bq-k{font-size:12px;color:var(--muted);margin-top:2px}',
    '.bq-kk{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}',
    '.bq-b{cursor:pointer;border:1px solid var(--accent);border-radius:10px;padding:9px 16px;font:700 14px Inter,sans-serif;background:var(--accent);color:var(--accent-ink);white-space:nowrap}',
    '.bq-b.own{background:rgba(111,208,140,.12);border-color:#2f7a4a;color:#4aa86a}',
    '.bq-b.on{background:transparent;color:var(--accent);cursor:pointer}',
    '.bq-b[disabled]{cursor:not-allowed;background:transparent;border-color:var(--line);color:var(--muted)}',
    '.bq-b.big{border:2px solid #fff0b8;border-radius:12px;padding:12px 26px;font-size:15px;color:#3a0a10;background:linear-gradient(#ffe9a0,#e7b94a 55%,#c08a28)}',
    '.bq-b.big[disabled]{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2);color:#e8d9b8}',
    '.bq-msg{min-height:22px;margin:0 0 16px;font-size:14px;color:var(--accent)}',
    '.bq-out{text-align:center;padding:50px 0}.bq-out p{color:var(--muted);max-width:46ch;margin:0 auto 20px}',
    '.bq-palier{margin-top:8px;height:6px;border-radius:99px;background:var(--line);overflow:hidden;min-width:140px}.bq-palier i{display:block;height:100%;background:var(--accent)}',
    /* classement du jeu du jour */
    '.kz-sw{display:inline-flex;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:4px;gap:2px;margin-bottom:18px}',
    '.kz-sw button,.kz-sw a{cursor:pointer;border:0;background:transparent;color:var(--muted);border-radius:999px;padding:8px 18px;font:500 14px Inter,sans-serif}',
    '.kz-sw [aria-selected=true]{background:var(--accent);color:var(--accent-ink);font-weight:600}',
    '.kz-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px}',
    '.kz-head h1{margin:0}',
    '.kz-rew{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;background:linear-gradient(110deg,#2b060c,#5a0f17);border:1px solid #7a2a30;border-radius:16px;padding:16px 22px;margin-bottom:26px;font-size:14px;color:#e8d9b8;line-height:1.5}',
    '.kz-rew b{color:#ffe08a}.kz-rew svg{flex:none}',
    '.kz-pod{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;align-items:end;margin-bottom:26px}',
    '.kz-p{text-align:center;border-radius:20px;padding:22px 14px 24px;background:var(--panel);border:1px solid var(--line)}',
    '.kz-p.r1{border-color:var(--accent);box-shadow:0 0 36px rgba(199,154,75,.2);padding-bottom:38px}',
    '.kz-p .rk{font:800 36px var(--display);line-height:1}.kz-p.r1 .rk{color:var(--accent)}',
    '.kz-p .lcf{margin:12px 0 10px}',
    '.kz-p h3{margin:0;font-size:17px;overflow-wrap:anywhere}',
    '.kz-t{font-size:12px;letter-spacing:.06em;color:var(--accent);min-height:16px;text-transform:uppercase;margin-top:2px}',
    '.kz-p .pt{margin-top:8px;font:800 24px var(--display)}.kz-p .pt small{font:600 13px Inter,sans-serif;color:var(--muted)}',
    '.kz-p .sb{font-size:13px;color:var(--muted);margin-top:2px}',
    '.kz-tb{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden}',
    '.kz-r{display:grid;grid-template-columns:56px minmax(0,1fr) 90px 90px 80px;gap:10px;align-items:center;padding:11px 20px;border-bottom:1px solid var(--line);font-size:15px}',
    '.kz-r:last-child{border-bottom:0}.kz-r.h{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}',
    '.kz-r.me{background:rgba(199,154,75,.12)}',
    '.kz-r .rk{font:800 17px var(--display);color:var(--muted)}',
    '.kz-r .who{display:flex;align-items:center;gap:12px;min-width:0}.kz-r .who span.nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.kz-r .num{text-align:right}.kz-r .num.s{color:#ff9a5c;font-weight:600}',
    '.kz-old{margin-top:26px;font-size:14px;color:var(--muted)}.kz-old b{color:var(--text)}',
    '@media (max-width:680px){.kz-pod{grid-template-columns:1fr}.kz-r{grid-template-columns:38px minmax(0,1fr) 70px;padding:11px 14px}.kz-r .hid{display:none}.bq-top{align-items:stretch}.bq-pv{padding:0 16px 16px;flex-wrap:wrap}}'
  ].join('\n');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  /* ---------------- Boutique ---------------- */
  var CAT = null, tab = 'tout', msg = '', occupe = false;
  var ONGLETS = [['tout', 'Tout'], ['pioche', 'Pioche'], ['cadre', 'Cadres'], ['banniere', 'Bannières'], ['titre', 'Titres'], ['badge', 'Badges'], ['couleur', 'Pseudos']];
  var KIND = {cadre: 'Cadre d’avatar', banniere: 'Bannière animée', titre: 'Titre', badge: 'Badge', couleur: 'Couleur de pseudo'};
  var ERR = {solde: 'Pas assez de points pour le moment.', deja: 'Tu possèdes déjà cet article.', pioche_du_jour: 'Tu as déjà pris ta pioche du jour. Reviens demain !', pas_possede: 'Tu ne possèdes pas encore cet article.'};

  function charger() {
    if (!connecte()) { rendre(); return; }
    api('/boutique').then(function (r) { if (r.ok) { CAT = r.d; syncMoi(); } rendre(); }).catch(function () { msg = 'La boutique est indisponible pour le moment.'; rendre(); });
  }
  function syncMoi() { var m = C().moi(); if (m && CAT) { m.cosm = CAT.equipe; m.points = {score: CAT.score, solde: CAT.solde, piocheFaite: CAT.piocheFaite, prochainPalier: CAT.prochainPalier}; C().puce(); } }
  function btn(a) {
    var cost = a.prix;
    if (a.kind === 'pioche') return '';
    if (a.possede) {
      if (['cadre', 'banniere', 'couleur'].indexOf(a.kind) > -1) {
        var cur = CAT.equipe[a.kind === 'cadre' ? 'cadre' : a.kind === 'banniere' ? 'banniere' : 'couleur'], mon = a.id.replace(/^[a-z]-/, '') === cur;
        return mon ? '<button class="bq-b on" data-eq="' + a.id + '" data-k="' + a.kind + '" data-off="1" title="Retirer">Équipé ✓</button>' : '<button class="bq-b own" data-eq="' + a.id + '" data-k="' + a.kind + '">Équiper</button>';
      }
      return '<button class="bq-b own" disabled style="cursor:default">Possédé ✓</button>';
    }
    return CAT.solde >= cost ? '<button class="bq-b" data-buy="' + a.id + '">' + n(cost) + ' pts</button>' : '<button class="bq-b" disabled title="Il te manque ' + n(cost - CAT.solde) + ' pts">' + n(cost) + ' pts</button>';
  }
  function carte(a, m) {
    var av = m.avatar, nm = m.pseudo;
    if (a.kind === 'cadre') return '<div class="bq-c">' + LCC.avatar(av, nm, a.id, 84) + '<div><div class="bq-n">' + esc(a.nom) + '</div><div class="bq-k">' + KIND.cadre + '</div></div>' + btn(a) + '</div>';
    if (a.kind === 'banniere') return '<div class="bq-c ban">' + LCC.banniere(a.id) + '<div class="bq-cb"><div><div class="bq-n">' + esc(a.nom) + '</div><div class="bq-k">' + KIND.banniere + '</div></div>' + btn(a) + '</div></div>';
    var k = a.kind === 'couleur' ? '<div class="bq-n" style="font-size:18px">' + LCC.nom(nm, a.id) + '</div>' : '<div class="bq-n">' + esc(a.nom) + '</div>';
    return '<div class="bq-c ln"><div><div class="bq-kk">' + KIND[a.kind] + '</div>' + k + '</div>' + btn(a) + '</div>';
  }
  function section(titre, sous, items, cls, m) { return items.length ? '<section class="bq-sec"><h2 class="bq-h">' + titre + '</h2><p class="bq-sub">' + sous + '</p><div class="bq-grid ' + (cls || '') + '">' + items.map(function (a) { return carte(a, m); }).join('') + '</div></section>' : ''; }
  function rendre() {
    var el = g('bq'); if (!el) return;
    var c = C();
    if (!c || c.etat() === 'init') { el.innerHTML = '<div class="bq-out"><p>Chargement…</p></div>'; return; }
    if (!connecte()) { el.innerHTML = '<div class="bq-out"><div class="bq-eye">Récompenses du Jeu du jour</div><h1>Boutique de points</h1><p>Connecte-toi avec ton compte Twitch pour dépenser tes points : cadres d’avatar, bannières animées, titres, badges et pioches Arcade.</p><button type="button" class="btn big" id="bqlog">Se connecter avec Twitch</button></div>'; var b = g('bqlog'); if (b) b.onclick = function () { var l = g('login'); if (l) l.click(); }; return; }
    var m = c.moi();
    if (!CAT) { el.innerHTML = '<div class="bq-out"><p>' + (msg || 'Chargement de la boutique…') + '</p></div>'; return; }
    var art = CAT.articles, pal = CAT.prochainPalier, h = [];
    h.push('<div class="bq-top"><div><div class="bq-eye">Récompenses du Jeu du jour</div><h1>Boutique de points</h1></div>' +
      '<div class="bq-bal"><div><small>Ton solde</small><b>' + n(CAT.solde) + ' pts</b></div><div class="bq-sep"></div><p>Score total : <b>' + n(CAT.score) + '</b><br>Le score du classement ne baisse jamais.' + (pal ? '<br>Prochain palier : ' + n(pal.pts) + ' pts · ' + esc(pal.titre) : '') + '</p></div></div>');
    h.push('<div class="bq-prev">' + LCC.banniere(CAT.equipe.banniere) + '<div class="bq-pv">' + LCC.avatar(m.avatar, m.pseudo, CAT.equipe.cadre, 92) + '<div><h2>' + LCC.nom(m.pseudo, CAT.equipe.couleur) + '</h2><p>Voilà ton profil avec ce que tu as équipé. <a href="#compte" style="color:var(--accent)">Voir mon profil</a></p></div></div></div>');
    h.push('<div class="bq-tabs" role="tablist">' + ONGLETS.map(function (t) { return '<button type="button" role="tab" data-t="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div>');
    h.push('<p class="bq-msg" aria-live="polite">' + esc(msg) + '</p>');
    var show = function (k) { return tab === 'tout' || tab === k; }, of = function (k) { return art.filter(function (a) { return a.kind === k; }); };
    if (show('pioche')) h.push('<section class="bq-pioche"><div class="bq-fan"><i></i><i></i><i></i></div><div style="flex:1 1 260px"><h2>Pioche Arcade</h2><p>Trois cartes Arcade tirées au hasard : tu en gardes <b>une</b>. Limité à <b>1 achat par jour</b>.</p></div><div class="bq-pr"><b>400 pts</b>' +
      (CAT.piocheFaite ? '<button class="bq-b big" disabled>Déjà prise aujourd’hui</button><small>Reviens demain</small>' : CAT.solde >= 400 ? '<button class="bq-b big" data-buy="pioche">Acheter</button><small>Disponible aujourd’hui</small>' : '<button class="bq-b big" disabled>Acheter</button><small>Il te manque ' + n(400 - CAT.solde) + ' pts</small>') + '</div></section>');
    if (show('cadre')) h.push(section('Cadres d’avatar', 'S’affichent autour de ta photo de profil. Certains sont animés.', of('cadre'), '', m));
    if (show('banniere')) h.push(section('Bannières de profil', 'Le grand visuel en haut de ton profil, en pixel art animé.', of('banniere'), 'ban', m));
    if (show('titre')) h.push(section('Titres', 'Un titre affiché sous ton pseudo. Choisis-le ensuite dans ton profil.', of('titre'), 'ln', m));
    if (show('badge')) h.push(section('Badges', 'À ranger dans ta vitrine de badges.', of('badge'), 'ln', m));
    if (show('couleur')) h.push(section('Couleurs de pseudo', 'Ton pseudo prend des couleurs partout où il s’affiche.', of('couleur'), 'ln', m));
    g('bq').innerHTML = h.join('');
    el.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { tab = b.dataset.t; rendre(); }; });
    el.querySelectorAll('[data-buy]').forEach(function (b) { b.onclick = function () { acheter(b.dataset.buy); }; });
    el.querySelectorAll('[data-eq]').forEach(function (b) { b.onclick = function () { equiper(b.dataset.k, b.dataset.off ? '' : b.dataset.eq); }; });
  }
  function acheter(id) {
    if (occupe) return; occupe = true; msg = '';
    api('/boutique', {act: 'acheter', id: id}).then(function (r) {
      occupe = false;
      if (r.ok) {
        CAT = r.d; syncMoi();
        var a = CAT.articles.filter(function (x) { return x.id === id; })[0];
        msg = id === 'pioche' ? 'Ta pioche t’attend : ouvre l’onglet Arcade de ta collection pour choisir ta carte.' : 'Acheté : ' + (a ? a.nom : '') + (a && ['cadre', 'banniere', 'couleur'].indexOf(a.kind) > -1 ? '. Clique sur « Équiper » pour le porter.' : a && a.kind === 'titre' ? '. Tu peux le choisir dans ton profil.' : '.');
        if (window.lcArcadeMaj) try { window.lcArcadeMaj(); } catch (e) {}
      } else msg = ERR[r.d && r.d.erreur] || 'Achat impossible pour le moment.';
      rendre();
    }).catch(function () { occupe = false; msg = 'Serveur injoignable, réessaie dans un instant.'; rendre(); });
  }
  function equiper(kind, id) {
    if (occupe) return; occupe = true;
    api('/boutique', {act: 'equiper', kind: kind, id: id}).then(function (r) {
      occupe = false;
      if (r.ok) { CAT.equipe = r.d.equipe; syncMoi(); msg = id ? 'Équipé !' : 'Retiré.'; } else msg = ERR[r.d && r.d.erreur] || 'Impossible pour le moment.';
      rendre();
    }).catch(function () { occupe = false; msg = 'Serveur injoignable.'; rendre(); });
  }
  window.lcBoutique = function () { rendre(); charger(); };

  /* ---------------- Classement du Jeu du jour ---------------- */
  var KZ = null, kzLoad = 0, kzPer = 'semaine';
  var TROPHEE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffe08a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3"/></svg>';
  function ligne(r, me) {
    var c = r.cosm || {};
    return '<div class="kz-r' + (me && r.login === me ? ' me' : '') + '"><span class="rk">' + r.rang + '</span><span class="who">' + LCC.avatar(r.avatar, r.pseudo, c.cadre, 36) + '<span class="nm">' + LCC.nom(r.pseudo, c.couleur) + (r.titre ? ' <small style="color:var(--accent);font-weight:500">' + esc(r.titre) + '</small>' : '') + '</span></span><span class="num"><b>' + n(r.pts) + '</b></span><span class="num hid">' + n(r.victoires) + '</span><span class="num s hid">' + (r.serie ? r.serie + ' j' : '–') + '</span></div>';
  }
  function podium(l, me) {
    var ordre = [l[1], l[0], l[2]], cl = ['r2', 'r1', 'r3'];
    return '<div class="kz-pod">' + ordre.map(function (r, i) {
      if (!r) return '<div></div>';
      var c = r.cosm || {};
      return '<div class="kz-p ' + cl[i] + '"><div class="rk">' + r.rang + '</div>' + LCC.avatar(r.avatar, r.pseudo, c.cadre, 76) + '<h3>' + LCC.nom(r.pseudo, c.couleur) + '</h3><div class="kz-t">' + esc(r.titre || '') + '</div><div class="pt">' + n(r.pts) + ' <small>pts</small></div><div class="sb">' + n(r.victoires) + ' victoire' + (r.victoires > 1 ? 's' : '') + (r.serie ? ' · série ' + r.serie : '') + '</div></div>';
    }).join('') + '</div>';
  }
  function kzRendre() {
    var el = g('kqz'); if (!el) return;
    var me = C() && C().login ? C().login() : '';
    var h = [];
    h.push('<div class="kz-head"><div><h1>Classement · Jeu du jour</h1><p class="lead" style="margin:6px 0 0">Les points se gagnent en trouvant le jeu mystère du jour : plus tu devines vite, plus tu en gagnes.</p></div>' +
      '<div class="kz-sw" role="tablist"><button type="button" role="tab" data-per="semaine" aria-selected="' + (kzPer === 'semaine') + '">Cette semaine</button><button type="button" role="tab" data-per="total" aria-selected="' + (kzPer === 'total') + '">Depuis le début</button></div></div>');
    if (!KZ) { h.push('<p class="note">' + (kzLoad === -1 ? 'Le classement n’est pas disponible pour le moment.' : 'Chargement…') + '</p>'); el.innerHTML = h.join(''); kzBind(el); return; }
    var l = KZ[kzPer === 'semaine' ? 'semaine' : 'total'];
    if (kzPer === 'semaine') h.push('<div class="kz-rew">' + TROPHEE + '<span style="flex:1 1 320px"><b>Le top 3 de la semaine gagne une pioche Arcade bonus</b> et le badge « Champion de la semaine ». Le 1er garde en plus un titre sur son profil jusqu’au lundi suivant. Fin de la semaine ' + (KZ.joursRestants <= 0 ? 'ce soir.' : 'dans ' + KZ.joursRestants + ' jour' + (KZ.joursRestants > 1 ? 's' : '') + '.') + '</span></div>');
    if (!l.length) h.push('<p class="note">' + (kzPer === 'semaine' ? 'Personne n’a encore marqué de points cette semaine. À toi de jouer !' : 'Aucun point marqué pour le moment.') + '</p><p><a class="btn" href="#jeudujour">Jouer au Jeu du jour</a></p>');
    else {
      h.push(podium(l.slice(0, 3), me));
      if (l.length > 3) h.push('<div class="kz-tb"><div class="kz-r h"><span>Rang</span><span>Joueur</span><span class="num">Points</span><span class="num hid">Victoires</span><span class="num hid">Série</span></div>' + l.slice(3).map(function (r) { return ligne(r, me); }).join('') + '</div>');
    }
    if (kzPer === 'semaine' && KZ.semainePassee && KZ.semainePassee.top.length) h.push('<p class="kz-old">Champions de la semaine dernière : ' + KZ.semainePassee.top.map(function (t, i) { return '<b>' + (i + 1) + '. ' + esc(t.pseudo) + '</b> (' + n(t.pts) + ' pts)'; }).join(' · ') + '</p>');
    h.push('<p class="note">Les joueurs au profil privé n’apparaissent pas dans le classement. <a href="#boutique" style="color:var(--accent)">Dépenser mes points</a></p>');
    el.innerHTML = h.join(''); kzBind(el);
  }
  function kzBind(el) { el.querySelectorAll('[data-per]').forEach(function (b) { b.onclick = function () { kzPer = b.dataset.per; kzRendre(); }; }); }
  function kzCharger() {
    kzRendre();
    var api0 = (window.JEU_CONFIG || {}).API_URL; if (!api0 || Date.now() - kzLoad < 15000 && KZ) return;
    kzLoad = Date.now();
    fetch(String(api0).replace(/\/$/, '') + '/classement-quiz').then(function (r) { return r.json(); }).then(function (d) { KZ = d; kzRendre(); }).catch(function () { if (!KZ) { kzLoad = -1; kzRendre(); } });
  }
  window.lcClassementQuiz = kzCharger;
  window.lcFormatPts = n;

  /* ---------------- Accueil : scènes animées et top de la semaine ---------------- */
  function accueil() {
    var ids = ['ile', 'manoir', 'tour', 'station', 'foret', 'neon', 'salle', 'ville'], d = Math.floor(Date.now() / 864e5);
    var bg = g('hzbg'); if (bg && window.LCC) bg.innerHTML = LCC.banniere(ids[d % ids.length]);
    document.querySelectorAll('.hz-th[data-sc]').forEach(function (e) { if (window.LCC) e.innerHTML = LCC.banniere(e.dataset.sc); });
    var api0 = (window.JEU_CONFIG || {}).API_URL, box = g('hzTop'); if (!api0 || !box) return;
    fetch(String(api0).replace(/\/$/, '') + '/classement-quiz').then(function (r) { return r.json(); }).then(function (k) {
      var l = (k.semaine || []).slice(0, 3); if (!l.length) return;
      box.hidden = false;
      box.innerHTML = '<b>Top de la semaine</b>' + l.map(function (r) { var c = r.cosm || {}; return '<a href="#classement-jeu">' + LCC.avatar(r.avatar, r.pseudo, c.cadre, 36) + '<span>' + r.rang + '. ' + LCC.nom(r.pseudo, c.couleur) + ' <small>' + n(r.pts) + ' pts</small></span></a>'; }).join('') + '<a href="#classement-jeu" style="margin-left:auto;color:var(--accent)">Voir le classement →</a>';
    }).catch(function () {});
  }
  accueil();
})();
