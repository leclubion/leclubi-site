/* Le ClubiForum : pages du forum (accueil, catégories, sujets, règles, modération).
   Ce fichier est chargé par index.html. Il parle au serveur Cloudflare du jeu (config-jeu.js) et utilise la connexion Twitch du site. */
(function(){
  'use strict';
  var root = document.getElementById('v-forum');
  if(!root) return;
  var EMOJIS = ['👍', '🔥', '👀', '❤️', '😂', '🎉'];
  var S = {delais: {msg: 60, sujet: 300}, cd: 0, cite: 0, req: 0, hash: '', etat: '', accueil: null, moi: null, suj: null, picker: false};

  // ---------- outils ----------
  function esc(t){ return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function $(s, r){ return (r || root).querySelector(s); }
  function C(){ return window.lcCompte || null; }
  function login(){ var c = C(); return c && c.etat && c.etat() === 'in' && c.login ? c.login() : ''; }
  function api(path, body){
    var c = C(); if(!c) return Promise.resolve({ok: false, status: 0, d: {}});
    return c.appel(path, {session: c.sess(), body: body}).catch(function(){ return {ok: false, status: 0, d: {erreur: 'reseau'}}; });
  }
  function ago(ts){
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if(s < 60) return "à l'instant";
    var m = Math.round(s / 60); if(m < 60) return 'il y a ' + m + ' min';
    var h = Math.round(m / 60); if(h < 24) return 'il y a ' + h + ' h';
    var d = Math.round(h / 24); if(d < 30) return 'il y a ' + d + ' j';
    var mo = Math.round(d / 30); return 'il y a ' + (mo < 12 ? mo + ' mois' : Math.round(mo / 12) + ' an' + (mo >= 24 ? 's' : ''));
  }
  function dureeTxt(s){ return s >= 120 ? Math.round(s / 60) + ' min' : s + ' s'; }
  function nb(n){ return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function plur(n, a, b){ return n + ' ' + (n > 1 ? b : a); }
  function avatar(u, taille){ var c = (u && u.cosm) || {}; return window.LCC ? LCC.avatar(u.avatar, u.pseudo, c.cadre, taille) : '<span class="fo-av" style="--s:' + taille + 'px">' + esc((u.pseudo || '?')[0]) + '</span>'; }
  function nom(u){ var c = (u && u.cosm) || {}; return window.LCC ? LCC.nom(u.pseudo, c.couleur) : esc(u.pseudo); }
  function toast(t){
    var e = document.createElement('div'); e.className = 'fo-toast'; e.setAttribute('role', 'status'); e.textContent = t; document.body.appendChild(e);
    setTimeout(function(){ e.classList.add('out'); }, 3200); setTimeout(function(){ e.remove(); }, 3700);
  }
  function seConnecter(msg){
    toast(msg || 'Connecte-toi avec Twitch pour participer.');
    var b = document.getElementById('login'); if(b && !b.hidden) setTimeout(function(){ b.click(); }, 900);
  }
  function go(h){ if(location.hash === h) aller(h); else location.hash = h; }
  function erreurTxt(d){
    switch(d && d.erreur){
      case 'delai': return 'Encore ' + d.reste + ' s avant ton prochain message (1 minute entre deux messages).';
      case 'delai_sujet': return 'Encore ' + dureeTxt(d.reste) + ' avant ton prochain sujet.';
      case 'doublon': return 'Ce message est identique à ton précédent. Modifie-le ou écris autre chose.';
      case 'sourdine': return 'Tu es en sourdine jusqu\'à ' + new Date(d.jusqua).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'}) + '.';
      case 'banni_forum': return "Tu n'as plus accès au forum.";
      case 'trop_court': return 'Ton message est trop court.';
      case 'titre_court': return 'Donne un titre un peu plus long à ton sujet.';
      case 'ferme': return 'Ce sujet est fermé.';
      case 'interdit': return "Tu n'as pas le droit de faire ça ici.";
      case 'session': return 'Ta connexion a expiré : reconnecte-toi avec Twitch.';
      default: return "Le forum n'a pas répondu. Réessaie dans un instant.";
    }
  }

  // ---------- texte des messages : **gras**, *italique*, ||spoiler||, [lien](https://…), @pseudo, {carte:s1-5} ----------
  function fmt(t){
    var h = esc(t);
    h = h.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="fo-sp" tabindex="0" role="button" aria-label="Spoiler masqué : appuie pour afficher">$1</span>');
    h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    h = h.replace(/\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+|#forum[^\s)]*)\)/g, function(m, a, u){
      var ext = /^https?:/.test(u); return '<a href="' + u + '"' + (ext ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' + a + '</a>'; });
    h = h.replace(/(^|[\s>])@([A-Za-z0-9_]{3,25})/g, '$1<a class="fo-mt" href="#profil=$2">@$2</a>');
    h = h.replace(/\{carte:([a-z0-9_-]{1,40})\}/gi, '<img class="fo-cardimg" src="cartes/$1.png" alt="Carte $1" loading="lazy" onerror="this.remove()">');
    return h.replace(/\n/g, '<br>');
  }

  // ---------- morceaux d'interface ----------
  function tag(e){ return e ? '<span class="fo-tg ' + (/^(Indice|Bug)$/.test(e) ? 'r' : 'n') + '">' + esc(e) + '</span>' : ''; }
  function tags(s){
    return (s.epingle ? '<span class="fo-tg g">Épinglé</span>' : '') + tag(s.etiq) + (s.resolu ? '<span class="fo-tg v">Résolu</span>' : '') + (s.ferme ? '<span class="fo-tg x">Fermé</span>' : '');
  }
  function pager(base, page, pages){
    if(pages <= 1) return '';
    var o = [], i, lo = Math.max(1, page - 2), hi = Math.min(pages, page + 2);
    if(page > 1) o.push('<a href="' + base + (page - 1) + '" aria-label="Page précédente">‹</a>');
    if(lo > 1) o.push('<a href="' + base + '1">1</a>' + (lo > 2 ? '<span>…</span>' : ''));
    for(i = lo; i <= hi; i++) o.push(i === page ? '<b aria-current="page">' + i + '</b>' : '<a href="' + base + i + '">' + i + '</a>');
    if(hi < pages) o.push((hi < pages - 1 ? '<span>…</span>' : '') + '<a href="' + base + pages + '">' + pages + '</a>');
    if(page < pages) o.push('<a href="' + base + (page + 1) + '" aria-label="Page suivante">›</a>');
    return '<nav class="fo-pg" aria-label="Pages">' + o.join('') + '</nav>';
  }
  function fil(items){
    return '<nav class="fo-fil" aria-label="Fil d\'Ariane">' + items.map(function(x, i){ return i === items.length - 1 ? '<span>' + esc(x[0]) + '</span>' : '<a href="' + x[1] + '">' + esc(x[0]) + '</a><i>/</i>'; }).join('') + '</nav>';
  }
  function outils(avecRecherche){
    var m = S.moi, n = m ? m.notifs : 0;
    return '<div class="fo-tools">' + (avecRecherche ? '<form class="fo-search" data-form="search" role="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><label class="fo-vh" for="foQ">Rechercher</label><input id="foQ" type="search" placeholder="Rechercher un sujet ou un membre" autocomplete="off"></form>' : '') +
      (m && m.modo ? '<a class="fo-ib" href="#forum/moderation">Modération</a>' : '') +
      '<button type="button" class="fo-bell" data-act="notifs" aria-label="Notifications' + (n ? ' (' + n + ' non lues)' : '') + '" aria-expanded="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 004 0"/></svg>' + (n ? '<b>' + n + '</b>' : '') + '</button><div class="fo-notifs" hidden></div></div>';
  }
  function onglets(actif){
    var m = S.moi, o = [['', 'Catégories', '#forum'], ['derniers', 'Derniers sujets', '#forum/derniers']];
    if(login()){ o.push(['non-lus', 'Non lus' + (m && m.nonLus ? ' · ' + m.nonLus : ''), '#forum/non-lus'], ['miens', 'Mes sujets', '#forum/miens'], ['suivis', 'Suivis', '#forum/suivis']); }
    return '<div class="fo-tabs" role="navigation" aria-label="Vues du forum">' + o.map(function(t){ return '<a href="' + t[2] + '"' + (t[0] === actif ? ' aria-current="page"' : '') + '>' + esc(t[1]) + '</a>'; }).join('') + '</div>';
  }
  function chargement(){ root.innerHTML = '<div class="fo wrap"><p class="fo-load" role="status">Chargement du forum…</p></div>'; }
  function indispo(){ root.innerHTML = '<div class="fo wrap"><div class="fo-box"><h2>Le forum n\'est pas disponible pour le moment</h2><p>Réessaie dans quelques instants.</p><p><a class="btn ghost" href="#accueil">Retour à l\'accueil</a></p></div></div>'; }
  function titreH1(t){ return '<h1 class="fo-h1">' + t + '</h1>'; }

  function ligneSujet(s, avecCat){
    var rep = s.nrep;
    return '<a class="fo-row fo-sj' + (s.nonLu ? ' nl' : '') + '" href="#forum/s/' + s.n + (s.nonLu ? '/nouveau' : '') + '">' +
      '<span class="fo-sjav">' + avatar(s.auteur, 40) + '</span>' +
      '<span class="fo-sjb"><span class="fo-sjt">' + (s.nonLu ? '<i class="fo-dot" title="Nouveaux messages"></i>' : '') + tags(s) + esc(s.titre) + '</span>' +
      '<span class="fo-meta">par ' + esc(s.auteur.pseudo) + (avecCat ? ' · ' + esc(s.catNom) : '') + ' · ' + (s.nrep ? 'dernière réponse ' + ago(s.dernier) : ago(s.ts)) + '</span></span>' +
      '<span class="fo-parts" aria-hidden="true">' + s.participants.map(function(p){ return avatar(p, 26); }).join('') + '</span>' +
      '<span class="fo-cnt"><b>' + nb(rep) + '</b> réponse' + (rep > 1 ? 's' : '') + '</span><span class="fo-cnt v">' + nb(s.vues) + ' vue' + (s.vues > 1 ? 's' : '') + '</span></a>';
  }
  function listeHtml(l, base, vide, avecCat){
    if(!l.sujets.length) return '<div class="fo-box"><p>' + vide + '</p></div>';
    return '<div class="fo-card">' + l.sujets.map(function(s){ return ligneSujet(s, avecCat); }).join('') + '</div>' + pager(base, l.page, l.pages);
  }

  // ---------- accueil ----------
  function pageAccueil(d){
    S.accueil = d; S.moi = d.moi; S.delais = d.delais || S.delais;
    var groupes = [], vus = {};
    d.cats.forEach(function(c){ if(!vus[c.g]){ vus[c.g] = {t: c.g, l: []}; groupes.push(vus[c.g]); } vus[c.g].l.push(c); });
    var cols = groupes.map(function(g){
      return '<section class="fo-grp"><div class="fo-gh"><h2>' + esc(g.t) + '</h2><span></span></div><div class="fo-card">' + g.l.map(function(c){
        return '<a class="fo-row fo-cat" href="#forum/c/' + c.id + '"><span class="fo-tile" style="background:' + c.couleur + ';color:' + c.ink + '" aria-hidden="true">' + esc(c.lettre) + (c.nonLus ? '<b>' + c.nonLus + '</b>' : '') + '</span>' +
          '<span class="fo-cb"><b>' + esc(c.nom) + '</b><small>' + esc(c.desc) + '</small></span><span class="fo-cnt">' + plur(c.nsujets, 'sujet', 'sujets') + '</span>' +
          '<span class="fo-last">' + (c.dernier ? '<b>' + esc(c.dernier.titre) + '</b><small>par ' + esc(c.dernier.auteur.pseudo) + ' · ' + ago(c.dernier.ts) + '</small>' : '<small>Aucun sujet</small>') + '</span></a>';
      }).join('') + '</div></section>';
    }).join('');
    var actifs = d.actifs.length ? d.actifs.map(function(a, i){ return '<a class="fo-top3" href="#forum/s/' + a.n + '"><i>' + (i + 1) + '</i><span><b>' + esc(a.titre) + '</b><small>' + plur(a.c, 'message', 'messages') + " aujourd'hui</small></span></a>"; }).join('') : '<p class="fo-vide">Rien pour le moment : lance la discussion !</p>';
    var dern = d.dernieres.length ? d.dernieres.map(function(r){ return '<a class="fo-last3" href="#forum/s/' + r.sujet + '/dernier">' + avatar(r.auteur, 30) + '<span><b>' + esc(r.auteur.pseudo) + '</b> dans ' + esc(r.titre) + '<small>' + ago(r.ts) + '</small></span></a>'; }).join('') : '<p class="fo-vide">Pas encore de réponse.</p>';
    root.innerHTML = '<div class="fo wrap">' + '<div class="fo-hero"><div><span class="fo-eb">Forum de la commu</span>' + titreH1('Le ClubiForum') +
      '<p class="fo-lead">Discute avec la commu, partage tes stratégies et cherche les secrets du site. Connexion avec ton compte Twitch, rien d\'autre à créer.</p></div>' +
      '<div class="fo-hact">' + outils(true) + '<a class="btn fo-new" href="#forum/c/' + (d.cats[2] ? 'general' : 'general') + '/nouveau">Nouveau sujet</a></div></div>' + onglets('') +
      '<div class="fo-cols"><div class="fo-main">' + cols + '</div><aside class="fo-side" aria-label="Le forum en direct">' +
      '<div class="fo-card fo-sc"><h3>En ce moment</h3>' + actifs + '</div><div class="fo-card fo-sc"><h3>Dernières réponses</h3>' + dern + '</div>' +
      '<div class="fo-card fo-sc"><h3>La commu</h3><dl class="fo-st"><div><dt>Sujets</dt><dd>' + nb(d.stats.sujets) + '</dd></div><div><dt>Messages</dt><dd>' + nb(d.stats.messages) + '</dd></div><div><dt>Membres</dt><dd>' + nb(d.stats.membres) + '</dd></div><div><dt>En ligne</dt><dd><i class="fo-on"></i>' + nb(d.stats.enLigne) + '</dd></div></dl></div>' +
      '<a class="fo-rulesc" href="#forum/regles"><b>Lis les règles du forum</b><span>Trois minutes pour savoir comment ça marche, et pourquoi il y a un délai entre deux messages.</span></a></aside></div></div>' + sanctionBandeau();
  }
  function sanctionBandeau(){
    var m = S.moi; if(!m || !m.sanction) return '';
    return '<div class="fo wrap"><div class="fo-box warn">' + (m.sanction.type === 'ban' ? "Tu n'as plus accès à l'écriture sur le forum." : 'Tu es en sourdine jusqu\'à ' + new Date(m.sanction.jusqua).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'}) + '.') + '</div></div>';
  }

  // ---------- listes (derniers / non lus / miens / suivis / recherche) ----------
  function pageListe(vue, page){
    var titres = {derniers: 'Derniers sujets', 'non-lus': 'Sujets non lus', miens: 'Mes sujets', suivis: 'Sujets suivis'}, vides = {derniers: 'Aucun sujet pour le moment.', 'non-lus': 'Tout est lu, bravo !', miens: "Tu n'as pas encore créé de sujet.", suivis: 'Tu ne suis aucun sujet pour le moment. Ouvre un sujet et choisis « Suivre ce sujet ».'};
    var v = vue === 'non-lus' ? 'nonlus' : vue;
    if(vue !== 'derniers' && !login()){ root.innerHTML = '<div class="fo wrap">' + fil([['Forum', '#forum'], [titres[vue], '']]) + '<div class="fo-box"><p>Connecte-toi avec Twitch pour voir cette liste.</p></div></div>'; seConnecter(); return; }
    chargement(); var t = ++S.req;
    api('/forum/liste?vue=' + v + '&page=' + page).then(function(r){
      if(t !== S.req) return; if(!r.ok) return indispo();
      api('/forum/accueil').then(function(a){ if(a.ok){ S.moi = a.d.moi; S.delais = a.d.delais || S.delais; }
        if(t !== S.req) return;
        root.innerHTML = '<div class="fo wrap"><div class="fo-toprow">' + fil([['Forum', '#forum'], [titres[vue], '']]) + outils(true) + '</div>' + titreH1(titres[vue]) + onglets(vue) + listeHtml(r.d, '#forum/' + vue + '/', vides[vue], true) + '</div>';
      });
    });
  }
  function pageRecherche(q, page){
    chargement(); var t = ++S.req;
    api('/forum/recherche?q=' + encodeURIComponent(q) + '&page=' + page).then(function(r){
      if(t !== S.req) return; if(!r.ok) return indispo();
      var d = r.d, mem = (d.membres || []).length ? '<div class="fo-mems">' + d.membres.map(function(m){ return '<a href="#profil=' + encodeURIComponent(m.login) + '">' + avatar({avatar: m.avatar, pseudo: m.pseudo, cosm: {}}, 26) + esc(m.pseudo) + '</a>'; }).join('') + '</div>' : '';
      root.innerHTML = '<div class="fo wrap"><div class="fo-toprow">' + fil([['Forum', '#forum'], ['Recherche', '']]) + outils(false) + '</div>' + titreH1('Recherche : ' + esc(q)) +
        '<form class="fo-search big" data-form="search" role="search"><label class="fo-vh" for="foQ">Rechercher</label><input id="foQ" type="search" value="' + esc(q) + '" autocomplete="off"><button class="btn" type="submit">Chercher</button></form>' + mem +
        listeHtml(d, '#forum/recherche/' + encodeURIComponent(q) + '/', 'Aucun sujet ne correspond à « ' + esc(q) + ' ».', true) + '</div>';
    });
  }

  // ---------- une catégorie ----------
  var TRIS = [['recents', 'Récents'], ['populaires', 'Populaires'], ['sans', 'Sans réponse'], ['resolus', 'Résolus']];
  function pageCat(id, tri, page){
    chargement(); var t = ++S.req;
    api('/forum/liste?vue=cat&cat=' + encodeURIComponent(id) + '&tri=' + tri + '&page=' + page).then(function(r){
      if(t !== S.req) return; if(!r.ok) return r.status === 404 ? go('#forum') : indispo();
      api('/forum/accueil').then(function(a){ if(a.ok){ S.moi = a.d.moi; S.delais = a.d.delais || S.delais; } if(t !== S.req) return;
        var c = r.d.cat, d = r.d, tris = TRIS.map(function(x){ return '<a href="#forum/c/' + id + '/' + x[0] + '"' + (x[0] === tri ? ' aria-current="page"' : '') + '>' + x[1] + '</a>'; }).join('');
        var peutEcrire = !c.modo || (S.moi && S.moi.modo);
        root.innerHTML = '<div class="fo wrap"><div class="fo-toprow">' + fil([['Forum', '#forum'], [c.g, '#forum'], [c.nom, '']]) + outils(true) + '</div>' +
          '<div class="fo-chead"><div class="fo-chl"><span class="fo-tile big" style="background:' + c.couleur + ';color:' + c.ink + '" aria-hidden="true">' + esc(c.lettre) + '</span><div>' + titreH1(esc(c.nom)) + '<p class="fo-lead">' + esc(c.desc) + '</p></div></div>' +
          '<div class="fo-chact"><button type="button" class="fo-ib" data-act="suivrecat" data-cat="' + id + '" data-on="' + (c.suivie ? 0 : 1) + '"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/></svg>' + (c.suivie ? 'Catégorie suivie' : 'Suivre la catégorie') + '</button>' +
          (peutEcrire ? '<a class="btn fo-new" href="#forum/c/' + id + '/nouveau">Nouveau sujet</a>' : '') + '</div></div>' +
          (c.spoilers ? '<div class="fo-warn"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5M12 18.5v.01"/></svg><div><b>Entraide oui, solution jamais.</b> Ici on s\'aide avec des indices, mais on ne dévoile jamais un secret : pas de réponse, pas de capture qui le montre. Un doute ? Masque ton message avec « Masquer en spoiler ». Je ne confirme ni ne révèle aucun secret. <a href="#forum/regles">Lire les règles</a></div></div>' : '') +
          (c.modo && !peutEcrire ? '<p class="fo-note">Je suis le seul à écrire dans cette catégorie.</p>' : '') +
          '<div class="fo-filters"><div class="fo-tabs">' + tris + '</div>' + (c.etiq && c.etiq.length ? '<div class="fo-leg">Étiquettes : ' + c.etiq.map(tag).join('') + '<span class="fo-tg v">Résolu</span></div>' : '') + '<span class="fo-meta">' + plur(d.total, 'sujet', 'sujets') + '</span></div>' +
          listeHtml(d, '#forum/c/' + id + '/' + tri + '/', tri === 'recents' ? 'Aucun sujet pour le moment. Sois le premier à en créer un !' : 'Aucun sujet dans cette vue.', false) + '</div>';
      });
    });
  }
  function pageNouveau(id){
    chargement(); var t = ++S.req;
    api('/forum/accueil').then(function(a){
      if(t !== S.req) return; if(!a.ok) return indispo(); S.moi = a.d.moi; S.delais = a.d.delais || S.delais;
      var c = null; a.d.cats.forEach(function(x){ if(x.id === id) c = x; }); if(!c) return go('#forum');
      if(!login()){ root.innerHTML = '<div class="fo wrap">' + fil([['Forum', '#forum'], [c.nom, '#forum/c/' + id], ['Nouveau sujet', '']]) + '<div class="fo-box"><p>Connecte-toi avec Twitch pour créer un sujet.</p></div></div>'; return seConnecter(); }
      if(c.modo && !(S.moi && S.moi.modo)){ root.innerHTML = '<div class="fo wrap">' + fil([['Forum', '#forum'], [c.nom, '#forum/c/' + id]]) + '<div class="fo-box"><p>Je suis le seul à écrire dans cette catégorie.</p></div></div>'; return; }
      var et = (c.etiq || []).length ? '<fieldset class="fo-et"><legend>Étiquette</legend><label><input type="radio" name="foEt" value="" checked><span>Aucune</span></label>' + c.etiq.map(function(e){ return '<label><input type="radio" name="foEt" value="' + esc(e) + '"><span>' + esc(e) + '</span></label>'; }).join('') + '</fieldset>' : '';
      root.innerHTML = '<div class="fo wrap fo-narrow">' + fil([['Forum', '#forum'], [c.nom, '#forum/c/' + id], ['Nouveau sujet', '']]) + titreH1('Nouveau sujet') +
        '<p class="fo-lead">Dans <b>' + esc(c.nom) + '</b>' + (c.spoilers ? ' · rappel : jamais de solution en clair, utilise « Masquer en spoiler ».' : '.') + '</p>' +
        '<div class="fo-card fo-form"><label class="fo-lab" for="foTitre">Titre</label><input id="foTitre" class="fo-in" maxlength="120" placeholder="Un titre clair en une phrase" autocomplete="off">' + et +
        composer({label: 'Message', sujet: true, cat: id}) + '</div></div>';
      majCd();
    });
  }

  // ---------- un sujet ----------
  function pageSujet(n, page){
    var keep = S.keep; S.keep = false;
    if(!keep) chargement(); var t = ++S.req;
    api('/forum/sujet?id=' + n + '&page=' + page).then(function(r){
      if(t !== S.req) return; if(!r.ok) return r.status === 404 ? (root.innerHTML = '<div class="fo wrap">' + fil([['Forum', '#forum']]) + '<div class="fo-box"><h2>Ce sujet n\'existe pas ou a été supprimé</h2><p><a class="btn ghost" href="#forum">Retour au forum</a></p></div></div>') : indispo();
      var d = r.d, s = d.sujet; S.suj = d;
      if(keep && S.lusN === n) d.lusAvant = S.lusV; else { S.lusN = n; S.lusV = d.lusAvant; } if(d.moi) { S.moi = S.moi || {}; S.moi.modo = d.moi.modo; S.moi.login = d.moi.login; }
      S.delais.msg = d.delais ? d.delais.msg : S.delais.msg; if(d.reste) S.cd = Date.now() + d.reste * 1000;
      var modo = !!(d.moi && d.moi.modo), nouveaux = 0;
      var cartes = d.messages.map(function(m){
        var sep = '';
        if(d.lusAvant && !nouveaux && m.n > d.lusAvant && !m.moi){ nouveaux = d.messages.filter(function(x){ return x.n > d.lusAvant && !x.moi; }).length; sep = '<div class="fo-new-sep" role="separator"><span></span>' + plur(nouveaux, 'nouveau message', 'nouveaux messages') + '<i></i></div>'; }
        return sep + messageHtml(m, s, d, modo);
      }).join('');
      var base = '#forum/s/' + n + '/';
      var suivi = '<button type="button" class="fo-ib" data-act="suivre" data-sujet="' + n + '" data-on="' + (s.suivi ? 0 : 1) + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/></svg>' + (s.suivi ? 'Sujet suivi' : 'Suivre ce sujet') + '</button>';
      var modoBar = modo ? '<div class="fo-modbar" role="group" aria-label="Modération du sujet"><b>Modération</b><button type="button" class="fo-ib" data-act="epingler" data-sujet="' + n + '" data-on="' + (s.epingle ? 0 : 1) + '">' + (s.epingle ? 'Désépingler' : 'Épingler') + '</button><button type="button" class="fo-ib" data-act="fermer" data-sujet="' + n + '" data-on="' + (s.ferme ? 0 : 1) + '">' + (s.ferme ? 'Rouvrir' : 'Fermer') + '</button><button type="button" class="fo-ib danger" data-act="supsujet" data-sujet="' + n + '" data-cat="' + s.cat + '">Supprimer le sujet</button></div>' : '';
      var resolu = (s.auteurMoi || modo) && !s.modoSeul ? '<button type="button" class="fo-ib" data-act="resolu" data-sujet="' + n + '" data-on="' + (s.resolu ? 0 : 1) + '">' + (s.resolu ? 'Retirer « Résolu »' : 'Marquer comme résolu') + '</button>' : '';
      var zone;
      if(!login()) zone = '<div class="fo-box"><p>Connecte-toi avec Twitch pour répondre.</p><p><button type="button" class="btn" data-act="login">Se connecter avec Twitch</button></p></div>';
      else if(s.ferme && !modo) zone = '<div class="fo-box"><p>Ce sujet est fermé : on ne peut plus y répondre.</p></div>';
      else if(s.modoSeul && !modo) zone = '<div class="fo-box"><p>Je suis le seul à écrire dans cette catégorie.</p></div>';
      else zone = '<div class="fo-card fo-form" id="foReply"><div class="fo-fh"><b>Ta réponse</b><span>Pense à relire avant d\'envoyer, ça évite les doublons.</span></div>' + composer({sujet: false}) + '</div>';
      root.innerHTML = '<div class="fo wrap fo-narrow"><div class="fo-toprow">' + fil([['Forum', '#forum'], [s.catNom, '#forum/c/' + s.cat], ['Sujet', '']]) + outils(false) + '</div>' +
        '<div class="fo-th"><div class="fo-thm">' + tags(s) + '<span class="fo-meta">' + plur(s.nrep, 'réponse', 'réponses') + ' · ' + plur(s.vues, 'vue', 'vues') + ' · ' + plur(s.participants, 'participant', 'participants') + '</span></div>' + titreH1(esc(s.titre)) +
        '<div class="fo-acts">' + (login() ? suivi : '') + '<button type="button" class="fo-ib" data-act="copy">Partager</button>' + (d.pages > 1 || d.page < d.pages ? '<a class="fo-ib" href="' + base + 'dernier">Aller au dernier message</a>' : '') + resolu + '</div>' + modoBar + '</div>' +
        pager(base, d.page, d.pages) + '<div class="fo-msgs">' + cartes + '</div>' + pager(base, d.page, d.pages) + zone + '</div>';
      majCd();
      if(page === 'nouveau' && nouveaux){ var sep = $('.fo-new-sep'); if(sep) sep.scrollIntoView({block: 'center'}); }
      if(page === 'dernier'){ var last = root.querySelector('.fo-msg:last-child'); if(last) last.scrollIntoView({block: 'center'}); }
      if(S.cite){ majCite(); }
      api('/forum/accueil').then(function(a){ if(a.ok){ S.moi = a.d.moi; var b = $('.fo-bell'); if(b){ var o = document.createElement('div'); o.innerHTML = outils(false); b.parentNode.replaceWith(o.firstChild); } } });
    });
  }
  function messageHtml(m, s, d, modo){
    var a = m.auteur, moiMsg = m.moi, connecte = !!login();
    var corps;
    if(m.masque) corps = '<div class="fo-hid">Ce message a été signalé et masqué en attendant que je le vérifie.' + (modo ? ' <button type="button" class="fo-ib" data-act="show" data-msg="' + m.n + '">Afficher quand même</button>' : '') + '</div>' + (modo ? '<div class="fo-body" hidden id="fo-b-' + m.n + '">' + fmt(m.texte) + '</div>' : '');
    else corps = '<div class="fo-body">' + fmt(m.texte) + '</div>';
    var cite = m.cite ? '<blockquote class="fo-q"><a href="#forum/s/' + s.n + '"><b>' + esc(m.cite.pseudo) + '</b> a dit :</a> ' + esc(m.cite.extrait) + (m.cite.extrait.length >= 160 ? '…' : '') + '</blockquote>' : '';
    var rx = m.reactions.map(function(r){ return '<button type="button" class="fo-rx' + (r.moi ? ' me' : '') + '" data-act="react" data-msg="' + m.n + '" data-e="' + r.e + '" aria-pressed="' + r.moi + '" aria-label="Réaction ' + r.e + ', ' + r.n + '">' + r.e + ' ' + r.n + '</button>'; }).join('');
    var plus = '<span class="fo-rxw"><button type="button" class="fo-rx add" data-act="rxmenu" aria-label="Ajouter une réaction" aria-expanded="false">+</button><span class="fo-rxm" hidden>' + EMOJIS.map(function(e){ return '<button type="button" data-act="react" data-msg="' + m.n + '" data-e="' + e + '" aria-label="Réagir ' + e + '">' + e + '</button>'; }).join('') + '</span></span>';
    var peutUtile = !m.premier && (s.auteurMoi || modo);
    var actions = (m.masque && !modo ? '' : '<button type="button" class="fo-lk" data-act="citer" data-msg="' + m.n + '" data-p="' + esc(a.pseudo) + '">Citer</button><button type="button" class="fo-lk" data-act="rep" data-p="' + esc(a.login || a.pseudo) + '">Répondre</button>') +
      (peutUtile ? '<button type="button" class="fo-lk" data-act="utile" data-msg="' + m.n + '">' + (m.utile ? 'Retirer « utile »' : 'Marquer utile') + '</button>' : '') +
      ((moiMsg || modo) && !m.masque ? '<button type="button" class="fo-lk" data-act="edit" data-msg="' + m.n + '">Modifier</button>' : '') +
      (connecte && !moiMsg ? '<button type="button" class="fo-lk" data-act="signaler" data-msg="' + m.n + '"' + (m.signale ? ' disabled' : '') + '>' + (m.signale ? 'Signalé' : 'Signaler') + '</button>' : '');
    var mod = modo ? '<div class="fo-mm" role="group" aria-label="Modération du message"><b>Modo</b>' + (m.nSignalements ? '<span>' + plur(m.nSignalements, 'signalement', 'signalements') + '</span>' : '') +
      (m.masque ? '<button type="button" class="fo-lk" data-act="valider" data-msg="' + m.n + '">Valider</button>' : '<button type="button" class="fo-lk" data-act="masquer" data-msg="' + m.n + '">Masquer</button>') +
      '<button type="button" class="fo-lk danger" data-act="supmsg" data-msg="' + m.n + '">Supprimer</button>' +
      (a.login && !a.modo && !a.sys ? '<button type="button" class="fo-lk" data-act="sourdine" data-login="' + esc(a.login) + '">Sourdine 24 h</button><button type="button" class="fo-lk danger" data-act="ban" data-login="' + esc(a.login) + '">Bannir</button>' : '') + '</div>' : '';
    return '<article class="fo-msg' + (m.utile ? ' utile' : '') + (m.masque ? ' masque' : '') + '" id="m' + m.n + '" data-msg="' + m.n + '"><div class="fo-au">' + avatar(a, 56) + '<a class="fo-an" href="' + (a.login && !a.sys ? '#profil=' + encodeURIComponent(a.login) : '#forum') + '">' + nom(a) + '</a>' +
      (a.modo ? '<span class="fo-ti mod">Créateur</span>' : (a.titre ? '<span class="fo-ti">' + esc(a.titre) + '</span>' : '')) + (a.n ? '<small>' + plur(a.n, 'message', 'messages') + '</small>' : '') + '</div>' +
      '<div class="fo-mc"><div class="fo-mh"><span>' + ago(m.ts) + (m.edite ? ' · modifié' : '') + '</span>' + (m.utile ? '<b class="fo-ut">Aide utile</b>' : '') + '</div>' + cite + corps +
      '<div class="fo-ra">' + rx + (m.masque && !modo ? '' : plus) + '<span class="fo-sp1"></span>' + actions + '</div>' + mod + '</div></article>';
  }

  // ---------- éditeur ----------
  function composer(o){
    return '<div class="fo-comp"><div class="fo-ctb" role="toolbar" aria-label="Mise en forme"><button type="button" data-act="f-b" aria-label="Gras"><b>G</b></button><button type="button" data-act="f-i" aria-label="Italique"><i>I</i></button><button type="button" data-act="f-l">Lien</button><button type="button" data-act="f-at">@ Mention</button><button type="button" data-act="f-card">Insérer une carte</button><button type="button" class="sp" data-act="f-sp">Masquer en spoiler</button></div>' +
      '<div class="fo-cardpick" hidden><label class="fo-vh" for="foCardId">Identifiant de la carte</label><input id="foCardId" class="fo-in" placeholder="Identifiant de la carte, par ex. s1-5" autocomplete="off"><img alt="" class="fo-cp-img" hidden><button type="button" class="btn ghost" data-act="f-card-ok">Insérer</button></div>' +
      '<div class="fo-cite" hidden></div><label class="fo-vh" for="foTxt">' + (o.label || 'Message') + '</label><textarea id="foTxt" class="fo-ta" maxlength="6000" placeholder="Écris ton message ici…" rows="5"></textarea>' +
      '<div class="fo-cfoot"><div class="fo-cd" aria-live="polite"></div><button type="button" class="fo-pub" data-act="publier"' + (o.sujet ? ' data-cat="' + o.cat + '"' : '') + '>Publier</button></div></div>';
  }
  function majCite(){
    var b = $('.fo-cite'); if(!b) return;
    if(!S.cite){ b.hidden = true; b.innerHTML = ''; return; }
    var m = $('#m' + S.cite + ' .fo-an'); b.hidden = false;
    b.innerHTML = 'Tu cites le message de <b>' + esc(m ? m.textContent : 'un membre') + '</b> <button type="button" class="fo-lk" data-act="uncite">Retirer</button>';
  }
  function majCd(){
    var cds = root.querySelectorAll('.fo-cd'); if(!cds.length) return;
    var reste = Math.max(0, Math.ceil((S.cd - Date.now()) / 1000));
    var modo = S.moi && S.moi.modo;
    Array.prototype.forEach.call(cds, function(c){
      var btn = c.parentNode.querySelector('.fo-pub'), sj = btn && btn.getAttribute('data-cat');
      if(modo || reste <= 0){ c.innerHTML = '<span class="fo-ok"></span>Tu peux publier.'; if(btn) btn.disabled = false; }
      else { c.innerHTML = '<span class="fo-wait"></span>Tu pourras publier à nouveau dans <b>' + reste + ' s</b> (' + (S.delais.msg >= 120 ? Math.round(S.delais.msg / 60) + ' minutes' : S.delais.msg === 60 ? '1 minute' : S.delais.msg + (S.delais.msg > 1 ? ' secondes' : ' seconde')) + ' entre deux messages)'; if(btn) btn.disabled = true; }
    });
  }
  setInterval(function(){ if(!root.hidden) majCd(); }, 500);

  function entourer(avant, apres, defaut){
    var ta = $('#foTxt'); if(!ta) return;
    var a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b) || defaut;
    ta.value = ta.value.slice(0, a) + avant + sel + apres + ta.value.slice(b);
    ta.focus(); ta.setSelectionRange(a + avant.length, a + avant.length + sel.length);
  }
  function inserer(t){ var ta = $('#foTxt'); if(!ta) return; var a = ta.selectionStart; ta.value = ta.value.slice(0, a) + t + ta.value.slice(ta.selectionEnd); ta.focus(); ta.setSelectionRange(a + t.length, a + t.length); }

  // ---------- règles ----------
  function pageRegles(){
    var dm = S.delais.msg, ds = S.delais.sujet;
    function box(id, n, titre, corps, cls){ return '<section class="fo-card fo-rule ' + (cls || '') + '" id="r' + id + '"><h2><i>' + n + '</i>' + titre + '</h2>' + corps + '</section>'; }
    root.innerHTML = '<div class="fo wrap fo-narrow wide">' + fil([['Forum', '#forum'], ['Règles', '']]) + '<span class="fo-eb">À lire une fois</span>' + titreH1('Les règles du ClubiForum') +
      '<p class="fo-lead">Le forum est là pour que la commu discute dans de bonnes conditions. Quelques règles simples, et surtout les raisons derrière chacune.</p>' +
      '<div class="fo-cols rules"><nav class="fo-card fo-toc" aria-label="Sommaire"><b>Sommaire</b><a href="#forum/regles">1. Respect</a><a href="#forum/regles">2. Pas de spam</a><a href="#forum/regles">3. Secrets et spoilers</a><a href="#forum/regles">4. Où poster quoi</a><a href="#forum/regles">5. Signaler un message</a><a href="#forum/regles">6. Sanctions</a></nav><div class="fo-main">' +
      box(1, 1, 'Respect', '<p>On peut ne pas être d\'accord, mais on reste poli. Pas d\'insultes, de moqueries ciblées, de harcèlement ni de propos discriminatoires. Ce qui est interdit sur le tchat Twitch l\'est aussi ici. Tu es connecté avec ton compte Twitch : ton pseudo est visible, comme sur le live.</p>') +
      box(2, 2, 'Pas de spam', '<p>Pour garder les discussions lisibles, merci de ne pas envoyer plusieurs messages d\'affilée, ni répéter le même message. Le forum t\'y aide :</p><div class="fo-nums"><div><b>' + dureeTxt(dm) + '</b><span>entre deux messages. Un compte à rebours s\'affiche sous la zone de réponse.</span></div><div><b>' + dureeTxt(ds) + '</b><span>entre deux nouveaux sujets, pour éviter de noyer les autres.</span></div><div><b>0 doublon</b><span>un message identique au précédent est refusé automatiquement.</span></div></div><p class="mu">Pourquoi ces limites ? Ce n\'est pas pour te bloquer : sans elles, un seul message répété en boucle peut recouvrir toute une discussion. Il n\'y a aucun plafond par jour, tu peux écrire autant que tu veux tant que tu laisses ' + (dm === 60 ? 'une minute' : dureeTxt(dm)) + ' entre deux messages. Insister pour contourner le délai ou publier en masse peut entraîner une sanction (voir plus bas).</p>') +
      box(3, 3, 'Secrets et spoilers', '<p><b>On s\'entraide, mais on ne dévoile jamais un secret.</b> Chaque secret doit pouvoir être trouvé par chacun, sans qu\'on le lui souffle.</p><dl class="fo-pi"><div><dt class="ok">Permis</dt><dd>Donner un indice vague, dire « cherche du côté de telle page », encourager, comparer vos pistes sans conclure.</dd></div><div><dt class="ko">Interdit</dt><dd>Donner la réponse, montrer une capture qui la révèle, expliquer pas à pas comment le déclencher.</dd></div><div><dt class="dq">Doute ?</dt><dd>Utilise « Masquer en spoiler » : le message reste caché tant que personne ne clique.</dd></div></dl><p class="mu">Je ne confirme et ne révèle aucun secret, pour que la découverte reste la même pour tout le monde. Un message qui dévoile une solution est masqué puis supprimé.</p>', 'sec') +
      box(4, 4, 'Où poster quoi', '<ul><li><b>Présente-toi</b> : uniquement pour te présenter toi, pas pour parler des cartes ou du jeu.</li><li><b>Idées et suggestions</b> : pour améliorer le site (pages, fonctions, confort, affichage). Les idées de cartes passent par la collection, pas par ici.</li><li><b>Cartes et collection</b> : échanges, belles pulls, raretés.</li><li><b>Aide et bugs</b> : décris le problème, ton navigateur et ce que tu as fait juste avant.</li></ul><p class="mu">Avant de créer un sujet, un coup d\'œil à la recherche évite les doublons.</p>') +
      box(5, 5, 'Signaler un message', '<p>Un message qui enfreint ces règles ? Utilise « Signaler » sous le message. Quand plusieurs personnes le signalent, il est masqué automatiquement en attendant que je le vérifie. Pas besoin de répondre ou de te disputer avec l\'auteur : signale, c\'est suffisant.</p>') +
      box(6, 6, 'Sanctions', '<p>Je privilégie toujours la discussion, sauf cas grave (harcèlement, contenu choquant), où la sanction peut être immédiate.</p><div class="fo-nums three"><div><span>Étape 1</span><b class="s">Rappel à l\'ordre</b></div><div><span>Étape 2</span><b class="s">Mise en sourdine temporaire</b></div><div class="r"><span>Étape 3</span><b class="s">Bannissement du forum</b></div></div>') +
      '<p class="fo-end"><a class="btn" href="#forum">J\'ai compris, aller au forum</a></p></div></div></div>';
  }

  // ---------- modération ----------
  function pageModeration(){
    chargement(); var t = ++S.req;
    api('/forum/moderation').then(function(r){
      if(t !== S.req) return;
      if(!r.ok){ root.innerHTML = '<div class="fo wrap">' + fil([['Forum', '#forum']]) + '<div class="fo-box"><p>Cette page est réservée à la modération.</p></div></div>'; return; }
      var d = r.d;
      root.innerHTML = '<div class="fo wrap fo-narrow">' + fil([['Forum', '#forum'], ['Modération', '']]) + titreH1('Modération') +
        '<h2 class="fo-h2">Messages signalés</h2>' + (d.signales.length ? d.signales.map(function(m){ return '<div class="fo-card fo-sgn"><div class="fo-sgh"><a href="#forum/s/' + m.sujet + '/dernier">' + esc(m.titre) + '</a> · ' + esc(m.auteur.pseudo) + ' · ' + plur(m.nSignalements || 0, 'signalement', 'signalements') + (m.masque ? ' · <b>masqué</b>' : '') + '</div><div class="fo-body">' + fmt(m.texte) + '</div><div class="fo-ra" data-msg="' + m.n + '"><button type="button" class="fo-lk" data-act="valider" data-msg="' + m.n + '" data-mod="1">Valider (garder)</button><button type="button" class="fo-lk danger" data-act="supmsg" data-msg="' + m.n + '" data-mod="1">Supprimer</button></div></div>'; }).join('') : '<div class="fo-box"><p>Aucun message à vérifier.</p></div>') +
        '<h2 class="fo-h2">Sanctions en cours</h2>' + (d.sanctions.length ? '<div class="fo-card">' + d.sanctions.map(function(s){ return '<div class="fo-row"><span class="fo-cb"><b>' + esc(s.pseudo) + '</b><small>' + (s.type === 'ban' ? 'Banni du forum' : 'Sourdine jusqu\'à ' + new Date(s.jusqua).toLocaleString('fr-FR', {dateStyle: 'short', timeStyle: 'short'})) + (s.raison ? ' · ' + esc(s.raison) : '') + '</small></span><button type="button" class="fo-ib" data-act="deban" data-login="' + esc(s.login) + '" data-mod="1">Lever</button></div>'; }).join('') + '</div>' : '<div class="fo-box"><p>Aucune sanction en cours.</p></div>') + '</div>';
    });
  }

  // ---------- notifications ----------
  var NT = {reponse: 'a répondu à ton sujet', suivi: 'a écrit dans un sujet que tu suis', mention: 't\'a mentionné', citation: 'a cité ton message', utile: 'a marqué ton message comme utile', nouveau: 'a créé un sujet dans une catégorie que tu suis'};
  function ouvrirNotifs(btn){
    var box = btn.parentNode.querySelector('.fo-notifs');
    if(!box.hidden){ box.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    if(!login()) return seConnecter('Connecte-toi avec Twitch pour voir tes notifications.');
    box.hidden = false; btn.setAttribute('aria-expanded', 'true'); box.innerHTML = '<p class="fo-vide">Chargement…</p>';
    api('/forum/notifs').then(function(r){
      if(!r.ok){ box.innerHTML = '<p class="fo-vide">Impossible de charger les notifications.</p>'; return; }
      var l = r.d.notifs;
      box.innerHTML = l.length ? l.map(function(x){ return '<a class="' + (x.lu ? '' : 'nw') + '" href="#forum/s/' + x.sujet + '/nouveau">' + avatar(x.de, 30) + '<span><b>' + esc(x.de.pseudo) + '</b> ' + (NT[x.type] || '') + '<em>' + esc(x.titre) + '</em><small>' + ago(x.ts) + '</small></span></a>'; }).join('') : '<p class="fo-vide">Rien de nouveau pour le moment.</p>';
      if(l.some(function(x){ return !x.lu; })) api('/forum/notifs-lu', {}).then(function(){ if(S.moi) S.moi.notifs = 0; var b = btn.querySelector('b'); if(b) b.remove(); });
    });
  }

  // ---------- actions ----------
  function envoyer(btn){
    if(!login()) return seConnecter();
    var ta = $('#foTxt'), texte = ta ? ta.value.trim() : '', cat = btn.getAttribute('data-cat');
    if(texte.length < 2) return toast('Ton message est vide.');
    btn.disabled = true;
    var p;
    if(cat){ var ti = $('#foTitre'), et = $('input[name=foEt]:checked'); p = api('/forum/sujet', {cat: cat, titre: ti ? ti.value : '', texte: texte, etiquette: et ? et.value : ''}); }
    else p = api('/forum/message', {sujet: S.suj.sujet.n, texte: texte, cite: S.cite || 0});
    p.then(function(r){
      if(r.ok){
        if(!(S.moi && S.moi.modo)) S.cd = Date.now() + S.delais.msg * 1000;
        S.cite = 0;
        if(cat) go('#forum/s/' + r.d.sujet); else go('#forum/s/' + S.suj.sujet.n + '/dernier');
        return;
      }
      if(r.d && (r.d.reste)) S.cd = Date.now() + r.d.reste * 1000;
      majCd(); if(!(r.d && r.d.reste)) btn.disabled = false;
      toast(erreurTxt(r.d));
      if(r.status === 401) seConnecter(erreurTxt(r.d));
    });
  }
  function post(path, body, ok){
    api(path, body).then(function(r){ if(r.ok) { if(ok) ok(r.d); } else { toast(erreurTxt(r.d)); if(r.status === 401) seConnecter(); } });
  }
  function recharger(){ S.keep = true; aller(location.hash); }
  var sigDemande = {};
  root.addEventListener('click', function(e){
    var sp = e.target.closest('.fo-sp'); if(sp){ sp.classList.toggle('on'); return; }
    var b = e.target.closest('[data-act]'); if(!b){ if(!e.target.closest('.fo-tools')){ var n = $('.fo-notifs'); if(n) n.hidden = true; } return; }
    var a = b.getAttribute('data-act'), msg = +b.getAttribute('data-msg'), sujet = +b.getAttribute('data-sujet');
    switch(a){
      case 'notifs': return ouvrirNotifs(b);
      case 'login': return seConnecter('Redirection vers Twitch…');
      case 'copy': try{ navigator.clipboard.writeText(location.href); toast('Lien copié.'); }catch(x){ toast('Copie le lien dans la barre d\'adresse.'); } return;
      case 'publier': return envoyer(b);
      case 'f-b': return entourer('**', '**', 'texte');
      case 'f-i': return entourer('*', '*', 'texte');
      case 'f-sp': return entourer('||', '||', 'texte caché');
      case 'f-l': { var u = prompt('Adresse du lien (https://…)'); if(u && /^https?:\/\//.test(u)) entourer('[', '](' + u + ')', 'texte du lien'); else if(u) toast('Le lien doit commencer par https://'); return; }
      case 'f-at': return inserer('@');
      case 'f-card': { var cp = $('.fo-cardpick'); cp.hidden = !cp.hidden; if(!cp.hidden) $('#foCardId').focus(); return; }
      case 'f-card-ok': { var id = ($('#foCardId').value || '').trim().toLowerCase(); if(!/^[a-z0-9_-]{1,40}$/.test(id)) return toast('Identifiant de carte invalide (exemple : s1-5).'); inserer('{carte:' + id + '}'); $('.fo-cardpick').hidden = true; return; }
      case 'citer': S.cite = msg; majCite(); { var z = $('#foReply'); if(z) z.scrollIntoView({block: 'center'}); } { var t1 = $('#foTxt'); if(t1) t1.focus(); } return;
      case 'uncite': S.cite = 0; return majCite();
      case 'rep': { var t2 = $('#foTxt'); if(!t2) return seConnecter('Connecte-toi avec Twitch pour répondre.'); inserer('@' + b.getAttribute('data-p') + ' '); var z2 = $('#foReply'); if(z2) z2.scrollIntoView({block: 'center'}); return; }
      case 'rxmenu': { var m = b.nextElementSibling; m.hidden = !m.hidden; b.setAttribute('aria-expanded', String(!m.hidden)); return; }
      case 'react': if(!login()) return seConnecter('Connecte-toi avec Twitch pour réagir.'); return post('/forum/reaction', {msg: msg, emoji: b.getAttribute('data-e')}, recharger);
      case 'signaler':
        if(!sigDemande[msg]){ sigDemande[msg] = 1; b.textContent = 'Confirmer le signalement'; setTimeout(function(){ delete sigDemande[msg]; if(b.isConnected && !b.disabled) b.textContent = 'Signaler'; }, 4000); return; }
        return post('/forum/signaler', {msg: msg}, function(){ toast('Merci, c\'est signalé.'); recharger(); });
      case 'suivre': return post('/forum/suivre', {sujet: sujet, on: b.getAttribute('data-on') === '1'}, recharger);
      case 'suivrecat': return post('/forum/suivre', {cat: b.getAttribute('data-cat'), on: b.getAttribute('data-on') === '1'}, recharger);
      case 'utile': return post('/forum/utile', {msg: msg}, recharger);
      case 'resolu': return post('/forum/resolu', {sujet: sujet, on: b.getAttribute('data-on') === '1'}, recharger);
      case 'edit': {
        var art = $('#m' + msg), body = art && art.querySelector('.fo-body'); if(!body || art.querySelector('.fo-editbox')) return;
        var orig = S.suj && S.suj.messages.filter(function(x){ return x.n === msg; })[0]; var eb = document.createElement('div'); eb.className = 'fo-editbox';
        eb.innerHTML = '<label class="fo-vh" for="foEdit">Modifier le message</label><textarea id="foEdit" class="fo-ta" maxlength="6000" rows="5"></textarea><div class="fo-cfoot"><button type="button" class="fo-lk" data-act="editno">Annuler</button><button type="button" class="fo-pub" data-act="editok" data-msg="' + msg + '">Enregistrer</button></div>';
        body.hidden = true; body.parentNode.insertBefore(eb, body.nextSibling); $('#foEdit').value = orig ? orig.texte : ''; $('#foEdit').focus(); return; }
      case 'editno': { var bx = b.closest('.fo-editbox'); bx.previousElementSibling.hidden = false; bx.remove(); return; }
      case 'editok': return post('/forum/modifier', {msg: msg, texte: $('#foEdit').value}, recharger);
      case 'show': { var hb = $('#fo-b-' + msg); if(hb){ hb.hidden = false; } return; }
      case 'epingler': return post('/forum/modo', {action: 'epingler', sujet: sujet, on: b.getAttribute('data-on') === '1'}, recharger);
      case 'fermer': return post('/forum/modo', {action: 'fermer', sujet: sujet, on: b.getAttribute('data-on') === '1'}, recharger);
      case 'supsujet': if(!confirm('Supprimer ce sujet pour tout le monde ?')) return; return post('/forum/modo', {action: 'supprimer_sujet', sujet: sujet}, function(){ go('#forum/c/' + b.getAttribute('data-cat')); });
      case 'supmsg': if(!confirm('Supprimer ce message ? (si c\'est le premier, le sujet disparaît)')) return; return post('/forum/modo', {action: 'supprimer_msg', msg: msg}, recharger);
      case 'valider': return post('/forum/modo', {action: 'valider', msg: msg}, recharger);
      case 'masquer': return post('/forum/modo', {action: 'masquer', msg: msg}, recharger);
      case 'sourdine': if(!confirm('Mettre ' + b.getAttribute('data-login') + ' en sourdine pendant 24 h ?')) return; return post('/forum/modo', {action: 'sourdine', login: b.getAttribute('data-login'), minutes: 1440}, function(){ toast('Sourdine appliquée.'); });
      case 'ban': if(!confirm('Bannir ' + b.getAttribute('data-login') + ' du forum ?')) return; return post('/forum/modo', {action: 'ban', login: b.getAttribute('data-login')}, function(){ toast('Membre banni du forum.'); });
      case 'deban': return post('/forum/modo', {action: 'deban', login: b.getAttribute('data-login')}, recharger);
    }
  });
  root.addEventListener('keydown', function(e){ var sp = e.target.closest && e.target.closest('.fo-sp'); if(sp && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); sp.classList.toggle('on'); } });
  root.addEventListener('submit', function(e){
    var f = e.target.closest('[data-form="search"]'); if(!f) return; e.preventDefault();
    var q = f.querySelector('input').value.trim(); if(q.length >= 2) location.hash = '#forum/recherche/' + encodeURIComponent(q);
  });
  root.addEventListener('input', function(e){
    if(e.target.id === 'foCardId'){ var im = $('.fo-cp-img'), v = e.target.value.trim().toLowerCase(); if(/^[a-z0-9_-]{1,40}$/.test(v)){ im.src = 'cartes/' + v + '.png'; im.hidden = false; im.onerror = function(){ im.hidden = true; }; } else im.hidden = true; }
  });

  // ---------- routage ----------
  function aller(h){
    h = h || location.hash; S.hash = h;
    if(!String((window.JEU_CONFIG || {}).API_URL || '') || !C()){ indispo(); return; }
    var seg = h.replace(/^#forum\/?/, '').split('/').filter(Boolean).map(function(x){ try{ return decodeURIComponent(x); }catch(e){ return x; } });
    var k = seg[0] || '';
    if(k !== 's') S.cite = 0;
    if(k === '') { chargement(); var t = ++S.req; api('/forum/accueil').then(function(r){ if(t !== S.req) return; if(r.ok) pageAccueil(r.d); else indispo(); }); return; }
    if(k === 'regles'){ api('/forum/accueil').then(function(r){ if(r.ok){ S.delais = r.d.delais || S.delais; S.moi = r.d.moi; } pageRegles(); }); pageRegles(); return; }
    if(k === 'c' && seg[1]){ if(seg[2] === 'nouveau') return pageNouveau(seg[1]); var tri = TRIS.some(function(x){ return x[0] === seg[2]; }) ? seg[2] : 'recents'; return pageCat(seg[1], tri, +seg[3] || 1); }
    if(k === 's' && +seg[1]) return pageSujet(+seg[1], seg[2] === 'dernier' || seg[2] === 'nouveau' ? seg[2] : (+seg[2] || 1));
    if(k === 'recherche' && seg[1]) return pageRecherche(seg[1], +seg[2] || 1);
    if(k === 'moderation') return pageModeration();
    if(['derniers', 'non-lus', 'miens', 'suivis'].indexOf(k) > -1) return pageListe(k, +seg[1] || 1);
    go('#forum');
  }
  window.lcForum = {aller: aller};
  // la connexion Twitch se termine après le chargement de la page : on redessine quand elle change
  setInterval(function(){
    if(root.hidden) return; var c = C(), e = c && c.etat ? c.etat() : '';
    if(e !== S.etat){ var avant = S.etat; S.etat = e; if(avant){ S.keep = true; aller(location.hash); } }
  }, 800);
  document.addEventListener('visibilitychange', function(){ if(!document.hidden && !root.hidden && S.moi) api('/forum/accueil').then(function(r){ if(r.ok) S.moi = r.d.moi; }); });
  if(location.hash.indexOf('#forum') === 0){ S.etat = C() && C().etat ? C().etat() : ''; aller(location.hash); }
})();

/* ---------- styles du forum ---------- */
(function(){
  var css = '' +
  '.fo{padding-top:34px;padding-bottom:80px}.fo-narrow{max-width:960px}.fo-narrow.wide{max-width:1100px}.fo *{box-sizing:border-box}' +
  '.fo a{color:inherit}.fo-vh{position:absolute!important;left:-9999px;width:1px;height:1px;overflow:hidden}' +
  '.fo-load{color:var(--muted);padding:40px 0}.fo-eb{display:inline-block;font:700 12px Inter,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}' +
  '.fo-h1{font-family:var(--display);text-transform:uppercase;font-weight:400;font-size:clamp(30px,4.6vw,46px);line-height:1.04;margin:0 0 8px}.fo-h2{font-family:var(--display);text-transform:uppercase;font-weight:400;font-size:20px;margin:28px 0 12px}' +
  '.fo-narrow>.fo-lead{margin-bottom:22px}.fo-lead{color:var(--muted);font-size:16px;line-height:1.55;max-width:60ch;margin:0}' +
  '.fo-hero{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-end;justify-content:space-between;margin-bottom:26px}.fo-hact{display:flex;flex-wrap:wrap;gap:12px;align-items:center}' +
  '.fo-new{height:46px;display:inline-flex;align-items:center;font-weight:600}' +
  '.fo-toprow{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:18px}.fo-toprow .fo-fil{margin:0}' +
  '.fo-fil{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;line-height:1.2;color:var(--muted);margin-bottom:18px}.fo-fil a{color:var(--accent);font-size:13px}.fo-fil span{font-size:13px}.fo-fil i{font-style:normal;opacity:.6}.fo-fil span{color:var(--text)}' +
  '.fo-tools{position:relative;display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
  '.fo-search{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:0 14px;height:46px;min-width:260px;color:var(--muted)}.fo-search input{background:none;border:0;outline:0;color:var(--text);font:inherit;font-size:14px;width:100%}.fo-search:focus-within{border-color:var(--accent)}' +
  '.fo-search.big{max-width:560px;margin:14px 0 20px;padding-right:6px}.fo-search.big .btn{height:36px;padding:0 16px}' +
  '.fo-ib{display:inline-flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:9px 14px;font:500 13px Inter,sans-serif;color:var(--text);cursor:pointer;text-decoration:none;transition:border-color .2s}.fo-ib:hover{border-color:var(--accent)}.fo-ib.danger{color:var(--red)}' +
  '.fo-bell{position:relative;width:42px;height:42px;border-radius:50%;background:var(--panel);border:1px solid var(--line);color:var(--text);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.fo-bell:hover{border-color:var(--accent)}' +
  '.fo-bell b{position:absolute;top:-5px;right:-5px;background:#e0243b;color:#fff;font:600 11px Inter,sans-serif;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px}' +
  '.fo-notifs{position:absolute;right:0;top:50px;z-index:9;width:min(380px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 34px rgba(0,0,0,.35);padding:6px;display:flex;flex-direction:column;max-height:70vh;overflow:auto}.fo-notifs[hidden]{display:none}' +
  '.fo-notifs a{display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:10px;text-decoration:none;font-size:13px}.fo-notifs a:hover{background:color-mix(in srgb,var(--accent) 14%,transparent)}.fo-notifs a.nw{background:color-mix(in srgb,var(--accent) 10%,transparent)}.fo-notifs em{display:block;font-style:normal;color:var(--muted);margin-top:2px}.fo-notifs small{color:var(--muted)}.fo-vide{color:var(--muted);font-size:13px;margin:6px 10px}' +
  '.fo-tabs{display:flex;flex-wrap:wrap;gap:8px}.fo-tabs a{background:var(--panel);border:1px solid var(--line);color:var(--muted);font-size:13px;font-weight:500;padding:7px 14px;border-radius:999px;text-decoration:none}.fo-tabs a:hover{color:var(--text)}.fo-tabs a[aria-current=page]{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}' +
  '.fo>.fo-tabs{margin-bottom:26px}' +
  '.fo-cols{display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start}.fo-main{flex:999 1 620px;min-width:0;display:flex;flex-direction:column;gap:32px}.fo-side{flex:1 1 280px;display:flex;flex-direction:column;gap:20px;min-width:0}.fo-cols.rules .fo-main{gap:16px}' +
  '.fo section,.fo-grp{padding:0;margin:0;border:0;background:none}.fo section.fo-rule{padding:24px 26px;background:var(--panel);border:1px solid var(--line)}.fo section.fo-rule.sec{background:color-mix(in srgb,#e0243b 8%,var(--panel));border-color:color-mix(in srgb,#e0243b 40%,var(--line))}.fo-gh{display:flex;align-items:center;gap:12px;margin-bottom:12px}.fo-gh h2{margin:0;font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:20px;letter-spacing:.02em}.fo-gh span{flex:1;height:1px;background:var(--line)}' +
  '.fo-card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}' +
  '.fo-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px;padding:16px 22px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit;transition:background .15s}.fo-card>.fo-row:last-child{border-bottom:0}a.fo-row:hover{background:color-mix(in srgb,var(--accent) 8%,transparent)}' +
  '.fo-tile{position:relative;width:46px;height:46px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;font-family:var(--display);font-size:18px}.fo-tile.big{width:64px;height:64px;border-radius:16px;font-size:28px}' +
  '.fo-tile b{position:absolute;top:-6px;right:-6px;background:#e0243b;color:#fff;font:600 11px Inter,sans-serif;min-width:18px;height:18px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px}' +
  '.fo-cb{flex:1 1 240px;display:flex;flex-direction:column;gap:3px;min-width:0}.fo-cb b{font-size:16px;font-weight:600}.fo-cb small{font-size:13px;color:var(--muted);line-height:1.45}' +
  '.fo-cnt{width:84px;font-size:13px;color:var(--muted)}.fo-cnt b{color:var(--text)}.fo-cnt.v{width:70px;text-align:right}.fo-last{width:190px;display:flex;flex-direction:column;font-size:13px;min-width:0}.fo-last b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fo-last small{color:var(--muted)}' +
  '.fo-sc{padding:20px;display:flex;flex-direction:column;gap:12px}.fo-sc h3{margin:0;font-family:var(--display);font-weight:400;font-size:15px;text-transform:uppercase;letter-spacing:.03em}' +
  '.fo-top3,.fo-last3{display:flex;gap:10px;align-items:flex-start;text-decoration:none;font-size:14px;line-height:1.4}.fo-top3 i{font:400 16px var(--display);font-style:normal;color:var(--accent);width:18px}.fo-top3 b,.fo-last3 b{font-weight:500}.fo-top3 small,.fo-last3 small{display:block;font-size:12px;color:var(--muted)}.fo-last3{align-items:center;font-size:13px;color:var(--muted)}.fo-last3 b{color:var(--text)}' +
  '.fo-st{margin:0;display:flex;flex-direction:column;gap:10px}.fo-st div{display:flex;justify-content:space-between;font-size:14px}.fo-st dt{color:var(--muted)}.fo-st dd{margin:0;display:flex;align-items:center;gap:6px}.fo-on{width:8px;height:8px;border-radius:50%;background:#3fb27f;display:inline-block}' +
  '.fo-rulesc{display:flex;flex-direction:column;gap:6px;background:color-mix(in srgb,var(--accent) 12%,var(--panel));border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));border-radius:14px;padding:18px 20px;text-decoration:none}.fo-rulesc b{color:var(--accent);font-size:15px}.fo-rulesc span{font-size:13px;color:var(--muted);line-height:1.5}' +
  '.fo-chead{display:flex;flex-wrap:wrap;gap:20px;align-items:center;justify-content:space-between;margin-bottom:22px}.fo-chl{display:flex;gap:18px;align-items:center}.fo-chact{display:flex;flex-wrap:wrap;gap:10px;align-items:center}' +
  '.fo-warn{display:flex;gap:14px;align-items:flex-start;background:color-mix(in srgb,#e0243b 10%,var(--panel));border:1px solid color-mix(in srgb,#e0243b 45%,var(--line));border-radius:12px;padding:16px 20px;font-size:14px;line-height:1.55;margin-bottom:22px}.fo-warn svg{flex:none;margin-top:2px;color:#e0243b}.fo-warn a{color:var(--accent);text-decoration:underline}' +
  '.fo-note{color:var(--muted);font-size:14px;margin:0 0 16px}.fo-filters{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;justify-content:space-between;margin-bottom:16px}.fo-leg{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;color:var(--muted)}' +
  '.fo-meta{font-size:12px;color:var(--muted)}' +
  '.fo-tg{display:inline-block;font:700 11px Inter,sans-serif;letter-spacing:.05em;text-transform:uppercase;border-radius:6px;padding:2px 8px;margin-right:8px;vertical-align:1px;white-space:nowrap}.fo-tg.r{background:#e0243b;color:#fff}.fo-tg.n{background:#ece8df;color:#17181a}.fo-tg.g{background:#c79a4b;color:#17181a}.fo-tg.v{background:#3fb27f;color:#0d1f17}.fo-tg.x{background:#5a5d63;color:#fff}.fo-leg .fo-tg{margin:0}' +
  '.fo-sjav{flex:none}.fo-sjb{flex:1 1 300px;display:flex;flex-direction:column;gap:5px;min-width:0}.fo-sjt{font-weight:600;font-size:15px;line-height:1.35}.fo-sj.nl{background:color-mix(in srgb,var(--accent) 7%,transparent)}.fo-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px}' +
  '.fo-parts{display:flex}.fo-parts>*{margin-left:-8px}.fo-parts>*:first-child{margin-left:0}' +
  '.fo-pg{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;font-size:14px;margin:22px 0}.fo-pg a,.fo-pg b,.fo-pg span{min-width:38px;height:38px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;padding:0 8px;text-decoration:none}.fo-pg a{background:var(--panel);border:1px solid var(--line);color:var(--muted)}.fo-pg a:hover{border-color:var(--accent);color:var(--text)}.fo-pg b{background:var(--accent);color:var(--accent-ink)}.fo-pg span{color:var(--muted)}' +
  '.fo-box{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px 26px;color:var(--muted)}.fo-box p{margin:0 0 10px}.fo-box p:last-child{margin:0}.fo-box h2{margin:0 0 8px;color:var(--text)}.fo-box.warn{border-color:#e0243b;color:var(--text);margin-top:20px}' +
  '.fo-mems{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 18px}.fo-mems a{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:5px 14px 5px 6px;font-size:14px;text-decoration:none}' +
  /* sujet */
  '.fo-th{margin-bottom:6px}.fo-thm{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px}.fo-thm .fo-tg{margin:0}.fo-acts{display:flex;flex-wrap:wrap;gap:10px;margin:14px 0}.fo-modbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:color-mix(in srgb,#e0243b 8%,var(--panel));border:1px dashed color-mix(in srgb,#e0243b 40%,var(--line));border-radius:12px;padding:10px 14px;font-size:13px}' +
  '.fo-msgs{display:flex;flex-direction:column;gap:16px;margin:8px 0 24px}' +
  '.fo-msg{display:flex;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line);border-radius:14px;scroll-margin-top:90px}.fo-msg.utile{border-color:#3fb27f}.fo-msg.masque{border-style:dashed;opacity:.9}' +
  '.fo-au{flex:0 0 170px;padding:20px;border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;min-width:0}.fo-an{font-weight:600;font-size:14px;text-decoration:none;word-break:break-word}.fo-au small{font-size:12px;color:var(--muted)}' +
  '.fo-ti{font:600 11px Inter,sans-serif;background:var(--accent);color:var(--accent-ink);border-radius:6px;padding:2px 8px}.fo-ti.mod{background:#e0243b;color:#fff}' +
  '.fo-mc{flex:1 1 400px;min-width:0;padding:18px 24px;display:flex;flex-direction:column;gap:14px}.fo-mh{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted)}.fo-ut{color:#3fb27f}' +
  '.fo-body{font-size:15px;line-height:1.65;overflow-wrap:anywhere}.fo-body a{color:var(--accent);text-decoration:underline}.fo-body a.fo-mt{text-decoration:none;font-weight:600}.fo-cardimg{display:inline-block;height:150px;border-radius:8px;vertical-align:middle;margin:4px 6px 4px 0;box-shadow:0 4px 14px rgba(0,0,0,.3)}' +
  '.fo-sp{background:var(--text);color:transparent;border-radius:4px;padding:0 4px;cursor:pointer;user-select:none;transition:color .15s,background .15s}.fo-sp:hover{background:color-mix(in srgb,var(--text) 80%,transparent)}.fo-sp.on{background:color-mix(in srgb,var(--muted) 30%,transparent);color:var(--text);user-select:auto}' +
  '.fo-q{margin:0;border-left:3px solid var(--line);padding:4px 14px;font-size:13px;color:var(--muted);line-height:1.5}.fo-q a{text-decoration:none;color:var(--text)}' +
  '.fo-hid{background:var(--bg);border:1px dashed var(--line);border-radius:10px;padding:14px 16px;font-size:14px;color:var(--muted)}' +
  '.fo-ra{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:2px}.fo-sp1{flex:1}.fo-rx{background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:5px 12px;font:13px Inter,sans-serif;color:var(--text);cursor:pointer}.fo-rx.me{border-color:var(--accent)}.fo-rx.add{color:var(--muted)}.fo-rx:hover{border-color:var(--accent)}' +
  '.fo-rxw{position:relative}.fo-rxm{position:absolute;left:0;bottom:38px;z-index:5;display:flex;gap:4px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:6px;box-shadow:0 10px 26px rgba(0,0,0,.3)}.fo-rxm[hidden]{display:none}.fo-rxm button{background:none;border:0;font-size:20px;cursor:pointer;border-radius:8px;padding:4px 6px}.fo-rxm button:hover{background:color-mix(in srgb,var(--accent) 18%,transparent)}' +
  '.fo-lk{background:none;border:0;font:500 13px Inter,sans-serif;color:var(--muted);cursor:pointer;padding:6px 10px;border-radius:8px}.fo-lk:hover{color:var(--text);background:color-mix(in srgb,var(--accent) 12%,transparent)}.fo-lk:disabled{opacity:.6;cursor:default}.fo-lk.danger{color:var(--red)}' +
  '.fo-mm{display:flex;flex-wrap:wrap;gap:6px;align-items:center;border-top:1px dashed var(--line);padding-top:10px;font-size:12px;color:var(--muted)}.fo-mm b{color:#e0243b}' +
  '.fo-new-sep{display:flex;align-items:center;gap:12px;color:var(--muted);font-size:12px}.fo-new-sep span{flex:1;height:1px;background:var(--line)}.fo-new-sep i{flex:1;height:1px;background:var(--accent)}' +
  /* éditeur */
  '.fo-form{padding:20px 24px;display:flex;flex-direction:column;gap:14px;overflow:visible}.fo-fh{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;align-items:center}.fo-fh span{font-size:12px;color:var(--muted)}' +
  '.fo-lab{font-weight:600;font-size:14px}.fo-in{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 14px;font:inherit;font-size:15px;color:var(--text)}.fo-in:focus,.fo-ta:focus{outline:2px solid var(--accent);outline-offset:1px}' +
  '.fo-et{border:0;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.fo-et legend{font-weight:600;font-size:14px;float:left;margin-right:12px;padding:0}.fo-et label{cursor:pointer}.fo-et input{position:absolute;opacity:0}.fo-et span{display:inline-block;border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:6px 14px;font-size:13px}.fo-et input:checked+span{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}.fo-et input:focus-visible+span{outline:2px solid var(--accent);outline-offset:2px}' +
  '.fo-comp{display:flex;flex-direction:column;gap:12px}.fo-ctb{display:flex;flex-wrap:wrap;gap:8px}.fo-ctb button{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:7px 12px;font:13px Inter,sans-serif;color:var(--text);cursor:pointer}.fo-ctb button:hover{border-color:var(--accent)}.fo-ctb .sp{border-color:#e0243b}' +
  '.fo-cardpick{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.fo-cardpick[hidden],.fo-cite[hidden]{display:none}.fo-cardpick .fo-in{flex:1 1 220px;width:auto}.fo-cp-img{height:70px;border-radius:6px}.fo-cp-img[hidden]{display:none}.fo-cite{font-size:13px;color:var(--muted);border-left:3px solid var(--accent);padding:4px 12px}' +
  '.fo-ta{width:100%;min-height:120px;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font:inherit;font-size:15px;line-height:1.55;color:var(--text);resize:vertical}' +
  '.fo-cfoot{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}.fo-cd{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:8px}.fo-cd b{color:var(--text)}.fo-wait,.fo-ok{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block}.fo-ok{background:#3fb27f}' +
  '.fo-pub{background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;height:44px;padding:0 24px;font:600 14px Inter,sans-serif;cursor:pointer}.fo-pub:disabled{background:color-mix(in srgb,var(--muted) 30%,var(--panel));color:var(--muted);cursor:not-allowed}.fo-editbox{display:flex;flex-direction:column;gap:10px}' +
  /* règles */
  '.fo-rule{padding:24px 26px;display:flex;flex-direction:column;gap:12px;overflow:visible}.fo-rule h2{margin:0;font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:20px}.fo-rule h2 i{font-style:normal;color:var(--accent);margin-right:10px}.fo-rule p{margin:0;line-height:1.65}.fo-rule p.mu{color:var(--muted);font-size:14px}.fo-rule ul{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px;line-height:1.55}' +
  '.fo-rule.sec{background:color-mix(in srgb,#e0243b 8%,var(--panel));border-color:color-mix(in srgb,#e0243b 40%,var(--line))}.fo-rule.sec h2 i{color:#e0243b}' +
  '.fo-nums{display:flex;flex-wrap:wrap;gap:12px}.fo-nums>div{flex:1 1 200px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:4px}.fo-nums b{font:400 24px var(--display);color:var(--accent)}.fo-nums b.s{font:600 16px Inter,sans-serif;color:var(--text)}.fo-nums span{font-size:13px;color:var(--muted);line-height:1.5}.fo-nums .r{border-color:color-mix(in srgb,#e0243b 50%,var(--line))}' +
  '.fo-pi{margin:0;display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:1.55}.fo-pi div{display:flex;gap:12px}.fo-pi dt{flex:0 0 64px;font-weight:600}.fo-pi dd{margin:0}.fo-pi .ok{color:#3fb27f}.fo-pi .ko{color:#e0243b}.fo-pi .dq{color:var(--accent)}' +
  '.fo-toc{flex:1 1 220px;max-width:260px;padding:18px 20px;display:flex;flex-direction:column;gap:12px;font-size:14px;position:sticky;top:90px}.fo-toc b{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:13px;color:var(--muted)}.fo-toc a{text-decoration:none}.fo-toc a:hover{color:var(--accent)}.fo-end{text-align:right;margin:8px 0 0}' +
  '.fo-sgn{padding:16px 20px;margin-bottom:12px;display:flex;flex-direction:column;gap:10px;overflow:visible}.fo-sgh{font-size:13px;color:var(--muted)}.fo-sgh a{color:var(--accent)}' +
  '.fo-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;background:var(--text);color:var(--bg);font:500 14px Inter,sans-serif;border-radius:10px;padding:12px 18px;max-width:90vw;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:opacity .4s}.fo-toast.out{opacity:0}' +
  '@media (max-width:760px){.fo-au{flex:1 1 100%;flex-direction:row;border-right:0;border-bottom:1px solid var(--line);justify-content:flex-start;text-align:left;flex-wrap:wrap;padding:14px 18px}.fo-mc{padding:16px 18px}.fo-search{min-width:0;width:100%}.fo-tools{width:100%}.fo-cnt,.fo-cnt.v,.fo-last{width:auto}.fo-parts{display:none}.fo-toc{position:static;max-width:none}.fo-row{padding:14px 16px}}' +
  '@media (prefers-reduced-motion:reduce){.fo-toast{transition:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
})();
