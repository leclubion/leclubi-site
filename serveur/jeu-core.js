/* Moteur de règles du jeu de cartes de LeClubi (bataille de colonnes).
   Ce fichier ne touche à aucun affichage : il pourra tourner tel quel côté serveur pour le 1 contre 1.
   Plateau : 3 colonnes de 3 cases par joueur. Une colonne est une liste : l'index 0 est la case la plus proche du centre. */
(function(root){
  'use strict';

  // ---------- Les cartes ----------
  // Puissance fixe par carte (n° de la carte dans sa saison). Commune 1-2, Peu commune 3-4, Rare 5-6, Légendaire 7-8, Spéciale 9.
  var SAISONS = {
    s1:        {commune:[1,6],  peu:[7,11], rare:[12,14], legendaire:[15,15], speciale:[16,16]},
    halloween: {commune:[1,6],  peu:[7,11], rare:[12,14], legendaire:[15,15], speciale:[16,17]}
  };
  var PUISSANCE = {
    s1:        {1:1,2:1,3:1, 4:2,5:2,6:2, 7:3,8:3,9:3, 10:4,11:4, 12:5,13:5, 14:6, 15:7, 16:9},
    halloween: {1:1,2:1,3:1, 4:2,5:2,6:2, 7:3,8:3, 9:4,10:4,11:4, 12:5, 13:6,14:6, 15:8, 16:9,17:9}
  };
  // Nombre d'exemplaires de chaque puissance dans la pioche (total 52). Plusieurs compositions à comparer :
  //  a  = 4 Légendaires + 4 Spéciales 
  //  b  = 4 cartes hautes en tout (2 Légendaires + 2 Spéciales)
  //  v1 = première version (6 Légendaires + 6 Spéciales)
  var PIOCHES = {
    e:  {1:14, 2:14, 3:14, 4:14, 5:5, 6:5, 7:4, 8:4, 9:3},   // 77 cartes (défaut) : Rares+ = 27 % de la pioche, Légendaires+Spéciales = 14 %
    c:  {1:10, 2:10, 3:10, 4:10, 5:6, 6:6, 7:5, 8:5, 9:4},   // 66 cartes : 5 exemplaires de chaque Légendaire (un triple devient possible)
    d:  {1:9, 2:9, 3:9, 4:9, 5:6, 6:6, 7:4, 8:4, 9:4},        // 60 cartes : 4 exemplaires de chaque Légendaire
    a:  {1:8, 2:8, 3:8, 4:8, 5:6, 6:6, 7:2, 8:2, 9:4},
    b:  {1:9, 2:9, 3:8, 4:8, 5:7, 6:7, 7:1, 8:1, 9:2},
    v1: {1:7, 2:7, 3:7, 4:7, 5:6, 6:6, 7:3, 8:3, 9:6}
  };

  function rareteDe(saison, n){
    var s = SAISONS[saison];
    for(var r in s) if(n >= s[r][0] && n <= s[r][1]) return r;
    return 'commune';
  }
  // Liste de toutes les illustrations (33) avec leur puissance
  function toutesLesCartes(){
    var out = [];
    ['s1', 'halloween'].forEach(function(sa){
      Object.keys(PUISSANCE[sa]).forEach(function(n){
        n = +n; out.push({art: sa + '-' + n, saison: sa, n: n, power: PUISSANCE[sa][n], r: rareteDe(sa, n)});
      });
    });
    return out;
  }
  // La pioche : chaque puissance est répartie sur ses illustrations pour atteindre EXEMPLAIRES[puissance]
  function composerPioche(nom){
    var EXEMPLAIRES = PIOCHES[nom] || PIOCHES.a;
    var arts = toutesLesCartes(), pioche = [], uid = 0;
    for(var p = 1; p <= 9; p++){
      var groupe = arts.filter(function(c){ return c.power === p; }), cible = EXEMPLAIRES[p];
      if(!groupe.length) continue;
      var base = Math.floor(cible / groupe.length), reste = cible % groupe.length;
      groupe.forEach(function(c, i){
        var k = base + (i < reste ? 1 : 0);
        for(var j = 0; j < k; j++) pioche.push({id: ++uid, art: c.art, saison: c.saison, n: c.n, power: c.power, r: c.r});
      });
    }
    return pioche;
  }

  // ---------- Réglages par défaut ----------
  function reglages(o){
    var d = {destroy:'all', triple:{type:'add', value:10}, hand:3, seconds:30, tolerance:3, pile:'e', startMax:6};
    o = o || {};
    for(var k in o) d[k] = o[k];
    return d;
  }

  // ---------- Utilitaires ----------
  function melanger(a, rng){
    rng = rng || Math.random;
    for(var i = a.length - 1; i > 0; i--){ var j = Math.floor(rng() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pleine(board){ return board.every(function(c){ return c.length >= 3; }); }
  function scoreColonne(col, opts){
    var s = 0; col.forEach(function(c){ s += c.power; });
    var triple = col.length === 3 && col[0].power === col[1].power && col[1].power === col[2].power;
    if(triple){ var t = opts.triple || {type:'add', value:0}; s = t.type === 'mul' ? s * t.value : s + t.value; }
    return {score: s, triple: triple};
  }
  function scoreBoard(board, opts){
    var tot = 0; board.forEach(function(c){ tot += scoreColonne(c, opts).score; }); return tot;
  }

  // ---------- Une partie ----------
  function nouvellePartie(opts, rng, premier){
    opts = reglages(opts); rng = rng || Math.random;
    var S = {
      opts: opts, pioche: melanger(composerPioche(opts.pile), rng), defausse: [],
      board: [[[], [], []], [[], [], []]], hands: [[], []], first: premier == null ? (rng() < 0.5 ? 0 : 1) : premier,
      turn: 0, tours: [0, 0], over: false, winner: null, scores: [0, 0], rng: rng
    };
    S.turn = S.first;
    for(var i = 0; i < opts.hand; i++){ piocherDepart(S, S.first); piocherDepart(S, 1 - S.first); }
    return S;
  }
  // Cartes de départ : aucune carte plus forte que startMax (les cartes écartées retournent dans la pioche, à une place au hasard)
  function piocherDepart(S, p){
    var ecartees = [], c;
    while(S.pioche.length){
      c = S.pioche.pop();
      if(!S.opts.startMax || c.power <= S.opts.startMax){ S.hands[p].push(c); break; }
      ecartees.push(c);
    }
    ecartees.forEach(function(x){ S.pioche.splice(Math.floor(S.rng() * (S.pioche.length + 1)), 0, x); });
  }
  function piocher(S, p){
    if(!S.pioche.length && S.defausse.length){ S.pioche = melanger(S.defausse, S.rng); S.defausse = []; if(S.sv) S.sv.cim = [[], []]; }
    if(S.pioche.length){
      var c = S.pioche.pop();
      if(S.sv && S.hands[p].length >= 5){ S.defausse.push(c); return null; }       // mode Survie : 5 cartes en main au maximum
      S.hands[p].push(c); return c;
    }
    return null;
  }
  function coupsPossibles(S, p){
    var out = [];
    S.hands[p].forEach(function(c, h){ for(var ci = 0; ci < 3; ci++) if(S.board[p][ci].length < 3 && !(S.sv && verrouillee(S, p, ci))) out.push({h: h, ci: ci}); });
    return out;
  }
  // Cartes de l'adversaire qui seraient détruites par ce coup (sans rien modifier)
  function apercu(S, p, h, ci){
    var card = S.hands[p][h], col = S.board[1 - p][ci], out = [];
    if(!card) return out;
    if(S.sv && protegee(S, 1 - p, ci)) return out;
    if(S.opts.destroy === 'all'){ col.forEach(function(c, i){ if(c.power === card.power && !(S.sv && c.sc)) out.push(i); }); }
    else { for(var i = 0; i < col.length; i++) if(col[i].power === card.power && !(S.sv && col[i].sc)){ out.push(i); break; } }
    return out;
  }
  // Joue le coup, détruit, pioche, vérifie la fin. Retourne un résumé pour l'affichage.
  function jouer(S, p, h, ci){
    if(S.sv) return jouerSv(S, p, h, ci);
    if(S.over || S.turn !== p) return null;
    var card = S.hands[p][h];
    if(!card || S.board[p][ci].length >= 3) return null;
    var idx = apercu(S, p, h, ci);
    S.hands[p].splice(h, 1);
    S.board[p][ci].push(card);
    var col = S.board[1 - p][ci], detruites = [];
    for(var i = idx.length - 1; i >= 0; i--) detruites.unshift(col.splice(idx[i], 1)[0]);
    detruites.forEach(function(c){ S.defausse.push(c); });
    S.tours[p]++;
    var nouvelle = S.hands[p].length < S.opts.hand ? piocher(S, p) : null;       // main déjà pleine (objets) : on ne pioche pas
    S.scores = [scoreBoard(S.board[0], S.opts), scoreBoard(S.board[1], S.opts)];
    var res = {p: p, card: card, ci: ci, detruites: detruites, indices: idx, pioche: nouvelle};
    if(pleine(S.board[p])){ terminer(S); res.fin = true; }
    else {
      S.turn = 1 - p;
      if(!S.hands[S.turn].length){ S.turn = p; if(!S.hands[S.turn].length){ terminer(S); res.fin = true; } }   // cas rarissime : plus de cartes
    }
    return res;
  }
  function terminer(S){
    S.over = true;
    S.scores = [scoreBoard(S.board[0], S.opts), scoreBoard(S.board[1], S.opts)];
    S.winner = S.scores[0] > S.scores[1] ? 0 : S.scores[1] > S.scores[0] ? 1 : -1;
  }
  function abandon(S, p){ S.over = true; S.winner = 1 - p; S.forfait = p; }

  // ---------- Adversaires automatiques ----------
  // simule un coup sur des copies de colonnes (sans toucher à la partie)
  function simuler(S, p, card, ci){
    var me = S.board[p].map(function(c){ return c.slice(); }), op = S.board[1 - p].map(function(c){ return c.slice(); });
    me[ci].push(card);
    if(S.sv && protegee(S, 1 - p, ci)) return {me: me, op: op};
    var sc = function(c){ return S.sv && c.sc; };
    if(S.opts.destroy === 'all') op[ci] = op[ci].filter(function(c){ return c.power !== card.power || sc(c); });
    else { for(var i = 0; i < op[ci].length; i++) if(op[ci][i].power === card.power && !sc(op[ci][i])){ op[ci].splice(i, 1); break; } }
    return {me: me, op: op};
  }
  function ecart(me, op, opts){ return scoreBoard(me, opts) - scoreBoard(op, opts); }

  var BOTS = {
    facile: function(S, p){
      var m = coupsPossibles(S, p); return m[Math.floor(S.rng() * m.length)];
    },
    normal: function(S, p){
      var best = null, bv = -1e9;
      coupsPossibles(S, p).forEach(function(m){
        var r = simuler(S, p, S.hands[p][m.h], m.ci), v = ecart(r.me, r.op, S.opts) + S.rng() * 0.01;
        if(v > bv){ bv = v; best = m; }
      });
      return best;
    },
    difficile: function(S, p){
      var comptes = {}, n = S.pioche.length || 1;
      S.pioche.forEach(function(c){ comptes[c.power] = (comptes[c.power] || 0) + 1; });
      var best = null, bv = -1e9;
      coupsPossibles(S, p).forEach(function(m){
        var card = S.hands[p][m.h], r = simuler(S, p, card, m.ci), base = ecart(r.me, r.op, S.opts), val;
        if(pleine(r.me)) val = base;
        else {
          // l'adversaire répond avec une carte tirée au hasard : on suppose qu'il joue son meilleur coup
          var esp = 0;
          Object.keys(comptes).forEach(function(pw){
            pw = +pw; var pire = 1e9;
            for(var cj = 0; cj < 3; cj++){
              if(r.op[cj].length >= 3) continue;
              var op2 = r.op.map(function(c){ return c.slice(); }), me2 = r.me.map(function(c){ return c.slice(); });
              op2[cj].push({power: pw});
              if(S.opts.destroy === 'all') me2[cj] = me2[cj].filter(function(c){ return c.power !== pw; });
              else { for(var i = 0; i < me2[cj].length; i++) if(me2[cj][i].power === pw){ me2[cj].splice(i, 1); break; } }
              pire = Math.min(pire, ecart(me2, op2, S.opts));
            }
            if(pire === 1e9) pire = base;
            esp += pire * comptes[pw] / n;
          });
          val = base * 0.5 + esp * 0.5;
        }
        val += S.rng() * 0.01;
        if(val > bv){ bv = val; best = m; }
      });
      return best;
    }
  };

  // =====================================================================
  //  MODE SURVIE : un match en manches, des objets tirés au hasard au début de chaque manche.
  //  Tout ce qui suit n'agit que si la partie possède S.sv : le mode classique reste exactement comme avant.
  // =====================================================================
  var OBJETS = {
    foudre:      {nom:'Foudre',             fam:'attaque', r:'commun', cible:'colAdv',   txt:'Détruit 1 carte au hasard dans une colonne adverse de ton choix.'},
    sceau:       {nom:'Sceau de faiblesse', fam:'attaque', r:'commun', cible:'carteAdv', txt:'Divise par 2 (arrondi haut) la puissance d\'une carte adverse.'},
    faux:        {nom:'Faux',               fam:'attaque', r:'peu',    cible:'colAdv',   txt:'Détruit la carte la plus forte d\'une colonne adverse.'},
    rafle:       {nom:'Rafle',              fam:'attaque', r:'rare',   cible:'puissance',txt:'Choisis une puissance : toutes les cartes de cette puissance sont détruites sur les deux plateaux, les tiennes aussi.'},
    seisme:      {nom:'Séisme',             fam:'attaque', r:'rare',   cible:null,       txt:'Détruit la carte la plus proche du centre dans chaque colonne adverse.'},
    renfort:     {nom:'Renfort',            fam:'defense', r:'commun', cible:'carteMoi', txt:'Ajoute +1 à la puissance d\'une de tes cartes (9 au maximum).'},
    bouclier:    {nom:'Bouclier',           fam:'defense', r:'commun', cible:'colMoi',   txt:'Protège une de tes colonnes pendant les 2 prochains tours de l\'adversaire.'},
    parade:      {nom:'Parade',             fam:'defense', r:'peu',    cible:null,       txt:'Annule la prochaine destruction que tu subis. Reste active jusqu\'à son déclenchement.'},
    rempart:     {nom:'Rempart',            fam:'defense', r:'rare',   cible:'carteMoi', txt:'Scelle une de tes cartes jusqu\'à la fin de la manche : elle ne peut plus être détruite ni modifiée.'},
    echange:     {nom:'Échange',            fam:'controle',r:'commun', cible:'deuxMoi',  txt:'Intervertis deux de tes cartes. Chacune agit comme une pose dans sa nouvelle colonne : elle détruit les cartes adverses de même valeur.'},
    chaine:      {nom:'Chaîne',             fam:'controle',r:'peu',    cible:'colAdv',   txt:'L\'adversaire ne pourra pas poser de carte dans cette colonne à son prochain tour.'},
    derive:      {nom:'Dérive',             fam:'controle',r:'peu',    cible:'derive',   txt:'Déplace une carte adverse vers une autre colonne adverse qui a de la place. Si une de tes cartes de même valeur lui fait face dans cette colonne, elle est détruite.'},
    larcin:      {nom:'Larcin',             fam:'controle',r:'rare',   cible:null,       txt:'Prends une carte au hasard dans la main de l\'adversaire.'},
    oeil:        {nom:'Œil',                fam:'pioche',  r:'commun', cible:null,       txt:'Regarde la main de l\'adversaire jusqu\'à la fin de ton tour.'},
    reassort:    {nom:'Réassort',           fam:'pioche',  r:'commun', cible:null,       txt:'Défausse ta main et pioche le même nombre de cartes.'},
    prophetie:   {nom:'Prophétie',          fam:'pioche',  r:'peu',    cible:'ordre',    txt:'Regarde les 3 prochaines cartes de la pioche et choisis leur ordre.'},
    tresor:      {nom:'Trésor',             fam:'pioche',  r:'peu',    cible:null,       txt:'Pioche 2 cartes (5 cartes en main au maximum).'},
    resurrection:{nom:'Résurrection',       fam:'pioche',  r:'peu',    cible:null,       txt:'Reprends en main la dernière de tes cartes détruites.'},
    de:          {nom:'Dé du destin',       fam:'chaos',   r:'commun', cible:'carteMoi', txt:'La puissance d\'une de tes cartes devient un nombre au hasard de 1 à 6.'},
    pari:        {nom:'Pari',               fam:'chaos',   r:'rare',   cible:null,       txt:'Pile ou face. Pile : 1 carte au hasard détruite dans chaque colonne adverse. Face : dans chacune des tiennes.'},
    pacte:       {nom:'Pacte',              fam:'chaos',   r:'rare',   cible:null,       txt:'Tu poses 2 cartes ce tour. Après la deuxième, 1 carte au hasard de ta main est défaussée.'}
  };
  var POIDS_RARETE = {commun: 55, peu: 33, rare: 12};
  var INV_MAX = 4, MAIN_MAX = 5, MANCHES_MAX = 5;

  function tirerObjet(rng){
    rng = rng || Math.random;
    var x = rng() * 100, r = x < POIDS_RARETE.commun ? 'commun' : x < POIDS_RARETE.commun + POIDS_RARETE.peu ? 'peu' : 'rare';
    var liste = Object.keys(OBJETS).filter(function(k){ return OBJETS[k].r === r; });
    return liste[Math.floor(rng() * liste.length)];
  }

  // ----- état d'une manche -----
  function nouvelEtatSv(inv){
    return {inv: inv, used: [false, false], shield: [], lock: [], parade: [false, false], pacte: [0, 0], cim: [[], []], vu: [false, false]};
  }
  function protegee(S, p, ci){ return S.sv.shield.some(function(s){ return s.p === p && s.ci === ci; }); }
  function verrouillee(S, p, ci){ return S.sv.lock.some(function(l){ return l.p === p && l.ci === ci; }); }
  function frappable(S, p, ci, c){ return !protegee(S, p, ci) && !c.sc; }
  function cartesDe(S, p){ var out = []; S.board[p].forEach(function(col, ci){ col.forEach(function(c, r){ out.push({ci: ci, r: r, c: c}); }); }); return out; }
  function rendreBase(c){ if(c.base != null){ c.power = c.base; } delete c.base; delete c.mod; delete c.sc; }
  function modifier(c, v){ if(c.base == null) c.base = c.power; c.power = Math.max(1, Math.min(9, v)); c.mod = 1; }
  function aleat(S, n){ return Math.floor(S.rng() * n); }
  function majScores(S){ S.scores = [scoreBoard(S.board[0], S.opts), scoreBoard(S.board[1], S.opts)]; }

  // Détruit une liste de positions {ci, r} chez le joueur `owner`. La Parade annule toute la destruction.
  function detruireListe(S, owner, pos){
    var res = {cartes: [], parade: false};
    if(!pos.length) return res;
    if(S.sv.parade[owner]){ S.sv.parade[owner] = false; res.parade = true; return res; }
    var parCol = {};
    pos.forEach(function(x){ (parCol[x.ci] = parCol[x.ci] || []).push(x.r); });
    Object.keys(parCol).forEach(function(ci){
      parCol[ci].sort(function(a, b){ return b - a; }).forEach(function(r){
        var c = S.board[owner][ci].splice(r, 1)[0];
        if(c){ res.cartes.unshift(c); }
      });
    });
    res.cartes.forEach(function(c){ rendreBase(c); S.defausse.push(c); S.sv.cim[owner].push(c); });
    return res;
  }

  // ----- fin d'un tour (compte à rebours des protections et des chaînes) -----
  function passerTour(S, p, res){
    var sv = S.sv;
    sv.lock = sv.lock.filter(function(l){ return l.p !== p; });
    sv.shield = sv.shield.filter(function(s){ if(s.p !== p) s.left--; return s.left > 0; });
    sv.vu[p] = false; sv.pacte[p] = 0; sv.used[1 - p] = false;
    S.turn = 1 - p;
    if(!S.hands[S.turn].length){ S.turn = p; sv.used[p] = false; if(!S.hands[S.turn].length){ terminer(S); if(res) res.fin = true; } }
  }

  // ----- poser une carte (mode Survie) -----
  function jouerSv(S, p, h, ci){
    if(S.over || S.turn !== p) return null;
    var card = S.hands[p][h], sv = S.sv;
    if(!card || S.board[p][ci].length >= 3 || verrouillee(S, p, ci)) return null;
    var idx = apercu(S, p, h, ci);
    S.hands[p].splice(h, 1);
    S.board[p][ci].push(card);
    var d = detruireListe(S, 1 - p, idx.map(function(r){ return {ci: ci, r: r}; }));
    S.tours[p]++;
    var nouvelle = S.hands[p].length < S.opts.hand ? piocher(S, p) : null;       // main déjà pleine (objets) : on ne pioche pas
    majScores(S);
    var res = {p: p, card: card, ci: ci, detruites: d.cartes, indices: d.parade ? [] : idx, pioche: nouvelle, parade: d.parade};
    if(pleine(S.board[p])){ terminer(S); res.fin = true; return res; }
    if(sv.pacte[p] === 1){
      sv.pacte[p] = 2;
      if(S.hands[p].length && coupsPossibles(S, p).length){ res.pacte = 2; return res; }     // le tour continue : deuxième carte
      passerTour(S, p, res); return res;
    }
    if(sv.pacte[p] === 2){
      if(S.hands[p].length){ var k = aleat(S, S.hands[p].length), x = S.hands[p].splice(k, 1)[0]; rendreBase(x); S.defausse.push(x); res.perdue = x; }
      passerTour(S, p, res); return res;
    }
    passerTour(S, p, res);
    return res;
  }

  // ----- les cibles de chaque objet -----
  function paire(a, b){ return a.ci * 3 + a.r <= b.ci * 3 + b.r ? {a: {ci: a.ci, r: a.r}, b: {ci: b.ci, r: b.r}} : {a: {ci: b.ci, r: b.r}, b: {ci: a.ci, r: a.r}}; }
  // liste de toutes les cibles valides de l'objet `id` pour le joueur p ([null] = objet sans cible ; [] = injouable)
  function enumerer(S, p, id){
    var o = 1 - p, sv = S.sv, out = [], ci, mes = cartesDe(S, p), eux = cartesDe(S, o);
    switch(id){
      case 'foudre': case 'faux':
        for(ci = 0; ci < 3; ci++) if(S.board[o][ci].some(function(c){ return frappable(S, o, ci, c); })) out.push({ci: ci});
        break;
      case 'sceau':
        eux.forEach(function(x){ if(frappable(S, o, x.ci, x.c) && x.c.power > 1) out.push({ci: x.ci, r: x.r}); });
        break;
      case 'rafle':
        for(var n = 1; n <= 9; n++){
          var ok = [0, 1].some(function(q){ return cartesDe(S, q).some(function(x){ return x.c.power === n && frappable(S, q, x.ci, x.c); }); });
          if(ok) out.push({n: n});
        }
        break;
      case 'seisme':
        for(ci = 0; ci < 3; ci++){ var c0 = S.board[o][ci][0]; if(c0 && frappable(S, o, ci, c0)){ out.push(null); break; } }
        break;
      case 'renfort': mes.forEach(function(x){ if(!x.c.sc && x.c.power < 9) out.push({ci: x.ci, r: x.r}); }); break;
      case 'rempart': mes.forEach(function(x){ if(!x.c.sc) out.push({ci: x.ci, r: x.r}); }); break;
      case 'de': mes.forEach(function(x){ if(!x.c.sc) out.push({ci: x.ci, r: x.r}); }); break;
      case 'bouclier': for(ci = 0; ci < 3; ci++) if(!protegee(S, p, ci)) out.push({ci: ci}); break;
      case 'parade': if(!sv.parade[p]) out.push(null); break;
      case 'echange':
        for(var i = 0; i < mes.length; i++) for(var j = i + 1; j < mes.length; j++) out.push(paire(mes[i], mes[j]));
        break;
      case 'chaine':
        var libres = [0, 1, 2].filter(function(k){ return S.board[o][k].length < 3; });
        if(libres.length >= 2) libres.forEach(function(k){ if(!verrouillee(S, o, k)) out.push({ci: k}); });
        break;
      case 'derive':
        eux.forEach(function(x){
          if(x.c.sc || protegee(S, o, x.ci)) return;
          for(var d = 0; d < 3; d++) if(d !== x.ci && S.board[o][d].length < 3 && !protegee(S, o, d)) out.push({ci: x.ci, r: x.r, dst: d});
        });
        break;
      case 'larcin': if(S.hands[o].length && S.hands[p].length < MAIN_MAX) out.push(null); break;
      case 'oeil': if(S.hands[o].length && !sv.vu[p]) out.push(null); break;
      case 'reassort': if(S.hands[p].length && S.pioche.length + S.defausse.length > 0) out.push(null); break;
      case 'prophetie': if(S.pioche.length >= 2) out.push(null); break;
      case 'tresor': if(S.hands[p].length < MAIN_MAX && S.pioche.length + S.defausse.length > 0) out.push(null); break;
      case 'resurrection':
        var last = sv.cim[p][sv.cim[p].length - 1];
        if(last && S.hands[p].length < MAIN_MAX && S.defausse.indexOf(last) >= 0) out.push(null);
        break;
      case 'pari': out.push(null); break;
      case 'pacte':
        var libresCases = 0; S.board[p].forEach(function(col){ libresCases += 3 - col.length; });
        if(S.hands[p].length >= 2 && libresCases >= 2 && sv.pacte[p] === 0) out.push(null);
        break;
    }
    return out;
  }
  var cle = function(c){ return JSON.stringify(c); };
  function normCible(id, c){
    if(c == null) return null;
    var t = OBJETS[id].cible, n = function(v){ return v | 0; };
    if(t === 'colAdv' || t === 'colMoi') return {ci: n(c.ci)};
    if(t === 'carteAdv' || t === 'carteMoi') return {ci: n(c.ci), r: n(c.r)};
    if(t === 'puissance') return {n: n(c.n)};
    if(t === 'deuxMoi'){ if(!c.a || !c.b) return undefined; return paire({ci: n(c.a.ci), r: n(c.a.r)}, {ci: n(c.b.ci), r: n(c.b.r)}); }
    if(t === 'derive') return {ci: n(c.ci), r: n(c.r), dst: n(c.dst)};
    if(t === 'ordre') return {ordre: Array.isArray(c.ordre) ? c.ordre.map(n) : []};
    return null;
  }
  function peutUtiliser(S, p, i){
    if(!S.sv || S.over || S.turn !== p || S.sv.used[p] || S.sv.pacte[p] !== 0) return false;
    var id = S.sv.inv[p][i]; return !!id && enumerer(S, p, id).length > 0;
  }

  // ----- appliquer un objet -----
  function utiliser(S, p, i, cible){
    var sv = S.sv, id = sv && sv.inv[p][i];
    if(!id || S.over || S.turn !== p || sv.used[p] || sv.pacte[p] !== 0) return {ok: false, raison: 'impossible'};
    var o = 1 - p, valides = enumerer(S, p, id);
    if(!valides.length) return {ok: false, raison: 'injouable'};
    var T = OBJETS[id].cible, c;
    // Prophétie : sans cible = on regarde ; avec {ordre} = on valide
    if(id === 'prophetie'){
      var n = Math.min(3, S.pioche.length), vus = [];
      for(var q = 0; q < n; q++) vus.push(S.pioche[S.pioche.length - 1 - q]);
      if(cible == null) return {ok: true, attente: 'ordre', cartes: vus, obj: id};
      var ord = normCible(id, cible).ordre, bon = ord.length === n && ord.slice().sort().every(function(v, k){ return v === k; });
      if(!bon) return {ok: false, raison: 'ordre'};
      for(q = 0; q < n; q++) S.pioche[S.pioche.length - 1 - q] = vus[ord[q]];
      sv.inv[p].splice(i, 1); sv.used[p] = true;
      return {ok: true, obj: id, ordre: ord};
    }
    c = T ? normCible(id, cible) : null;
    if(T && !c) return {ok: false, raison: 'cible'};
    if(!valides.some(function(v){ return cle(v) === cle(c); })) return {ok: false, raison: 'cible'};
    var res = {ok: true, obj: id, cible: c, detruites: [], parade: false};
    var detr = function(owner, pos){ var d = detruireListe(S, owner, pos); res.detruites = res.detruites.concat(d.cartes.map(function(x){ return {c: x, owner: owner}; })); if(d.parade) res.parade = true; return d; };
    switch(id){
      case 'foudre': {
        var cand = []; S.board[o][c.ci].forEach(function(x, r){ if(frappable(S, o, c.ci, x)) cand.push(r); });
        detr(o, [{ci: c.ci, r: cand[aleat(S, cand.length)]}]); break; }
      case 'faux': {
        var mx = 0, cs = []; S.board[o][c.ci].forEach(function(x, r){ if(frappable(S, o, c.ci, x)){ if(x.power > mx){ mx = x.power; cs = [r]; } else if(x.power === mx) cs.push(r); } });
        detr(o, [{ci: c.ci, r: cs[aleat(S, cs.length)]}]); break; }
      case 'sceau': modifier(S.board[o][c.ci][c.r], Math.ceil(S.board[o][c.ci][c.r].power / 2)); break;
      case 'rafle': {
        res.n = c.n;
        [p, o].forEach(function(q){
          var pos = []; cartesDe(S, q).forEach(function(x){ if(x.c.power === c.n && frappable(S, q, x.ci, x.c)) pos.push({ci: x.ci, r: x.r}); });
          detr(q, pos);
        });
        break; }
      case 'seisme': {
        var pos = []; for(var ci = 0; ci < 3; ci++){ var c0 = S.board[o][ci][0]; if(c0 && frappable(S, o, ci, c0)) pos.push({ci: ci, r: 0}); }
        detr(o, pos); break; }
      case 'renfort': modifier(S.board[p][c.ci][c.r], S.board[p][c.ci][c.r].power + 1); break;
      case 'rempart': S.board[p][c.ci][c.r].sc = 1; break;
      case 'de': res.valeur = 1 + aleat(S, 6); modifier(S.board[p][c.ci][c.r], res.valeur); break;
      case 'bouclier': sv.shield.push({p: p, ci: c.ci, left: 2}); break;
      case 'parade': sv.parade[p] = true; break;
      case 'echange': {
        var A = S.board[p][c.a.ci], B = S.board[p][c.b.ci], t = A[c.a.r]; A[c.a.r] = B[c.b.r]; B[c.b.r] = t;
        if(c.a.ci !== c.b.ci){                                    // chaque carte déplacée agit comme une pose dans sa nouvelle colonne
          var pe = [], ar = [[A[c.a.r], c.a.ci], [B[c.b.r], c.b.ci]];
          ar.forEach(function(x){
            var card = x[0], cj = x[1]; if(protegee(S, o, cj)) return;
            var col = S.board[o][cj];
            for(var u = 0; u < col.length; u++){
              if(col[u].power === card.power && !col[u].sc && !pe.some(function(z){ return z.ci === cj && z.r === u; })){ pe.push({ci: cj, r: u}); if(S.opts.destroy !== 'all') break; }
            }
          });
          detr(o, pe); res.echange = true;
        }
        break; }
      case 'chaine': sv.lock.push({p: o, ci: c.ci}); break;
      case 'derive': {
        var cd = S.board[o][c.ci].splice(c.r, 1)[0]; S.board[o][c.dst].push(cd);
        // la carte déplacée n'est détruite que si une de tes cartes de même valeur lui fait face dans la colonne d'arrivée (la Parade peut l'annuler)
        if(S.board[p][c.dst].some(function(x){ return x.power === cd.power; })){ detr(o, [{ci: c.dst, r: S.board[o][c.dst].length - 1}]); res.derive = true; }
        break; }
      case 'larcin': { var k = aleat(S, S.hands[o].length), x = S.hands[o].splice(k, 1)[0]; S.hands[p].push(x); res.pris = x; break; }
      case 'oeil': sv.vu[p] = true; res.vus = S.hands[o].slice(); break;
      case 'reassort': {
        var nb = S.hands[p].length; S.hands[p].forEach(function(x){ rendreBase(x); S.defausse.push(x); }); S.hands[p] = [];
        res.jetees = nb; res.piochees = []; for(var m2 = 0; m2 < nb; m2++){ var y = piocher(S, p); if(y) res.piochees.push(y); }
        break; }
      case 'tresor': { res.piochees = []; for(var m3 = 0; m3 < 2; m3++){ var z = piocher(S, p); if(z) res.piochees.push(z); } break; }
      case 'resurrection': {
        var dern = sv.cim[p].pop(); S.defausse.splice(S.defausse.indexOf(dern), 1); S.hands[p].push(dern); res.reprise = dern; break; }
      case 'pari': {
        res.pile = S.rng() < .5; var cible2 = res.pile ? o : p;
        var pos2 = []; for(var cj = 0; cj < 3; cj++){
          if(protegee(S, cible2, cj)) continue;
          var cc = []; S.board[cible2][cj].forEach(function(x, r){ if(!x.sc) cc.push(r); });
          if(cc.length) pos2.push({ci: cj, r: cc[aleat(S, cc.length)]});
        }
        detr(cible2, pos2); break; }
      case 'pacte': sv.pacte[p] = 1; break;
    }
    sv.inv[p].splice(i, 1); sv.used[p] = true;
    majScores(S);
    if(pleine(S.board[0]) || pleine(S.board[1])){ terminer(S); res.fin = true; }
    return res;
  }

  // ----- vue publique de l'état Survie (pas de secret : tout ce qui est ici est visible des deux joueurs) -----
  function vueSv(S){
    var sv = S.sv;
    return {inv: [sv.inv[0].slice(), sv.inv[1].slice()], used: sv.used.slice(), shield: sv.shield.map(function(x){ return {p: x.p, ci: x.ci, left: x.left}; }),
            lock: sv.lock.map(function(x){ return {p: x.p, ci: x.ci}; }), parade: sv.parade.slice(), pacte: sv.pacte.slice(), vu: sv.vu.slice(), cim: [sv.cim[0].length, sv.cim[1].length]};
  }

  // ----- le match : manches successives, objets reçus au début de chacune -----
  function nouveauMatch(opts, rng){
    return {opts: reglages(opts), rng: rng || Math.random, wins: [0, 0], manche: 0, inv: [[], []], perdant: null, S: null, fini: false, gagnant: null, histo: []};
  }
  function lancerManche(M){
    M.manche++;
    var premier = M.perdant === 0 || M.perdant === 1 ? M.perdant : null;
    var S = nouvellePartie(M.opts, M.rng, premier);
    S.sv = nouvelEtatSv(M.inv);
    var n = Math.min(M.manche, 3), recu = [[], []], bonus = [0, 0];
    [0, 1].forEach(function(p){
      var k = Math.min(3, n + (M.perdant === p ? 1 : 0)); bonus[p] = M.perdant === p ? 1 : 0;
      for(var j = 0; j < k; j++){ var ob = tirerObjet(M.rng); if(M.inv[p].length < INV_MAX){ M.inv[p].push(ob); recu[p].push(ob); } else recu[p].push('!' + ob); }   // "!" : inventaire plein, objet perdu
    });
    M.S = S; M.recu = recu; M.bonus = bonus;
    return S;
  }
  function finManche(M){
    var S = M.S, w = S.winner;
    M.histo.push({manche: M.manche, gagnant: w, scores: S.scores.slice()});
    if(S.forfait != null){ M.fini = true; M.gagnant = S.winner; return M; }
    if(w === 0 || w === 1) M.wins[w]++;
    M.perdant = w === -1 ? -1 : 1 - w;
    if(M.wins[0] >= 2 || M.wins[1] >= 2 || M.manche >= MANCHES_MAX){ M.fini = true; M.gagnant = M.wins[0] > M.wins[1] ? 0 : M.wins[1] > M.wins[0] ? 1 : -1; }
    return M;
  }

  // ----- robots : ils savent utiliser les objets -----
  function cloner(S){
    var cp = function(c){ return Object.assign({}, c); };
    return {opts: S.opts, pioche: S.pioche.slice(), defausse: S.defausse.slice(), board: S.board.map(function(b){ return b.map(function(col){ return col.map(cp); }); }),
            hands: S.hands.map(function(h){ return h.map(cp); }), turn: S.turn, tours: S.tours.slice(), over: false, winner: null, scores: S.scores.slice(), rng: Math.random,
            first: S.first, sv: JSON.parse(JSON.stringify(S.sv))};
  }
  function actions(S, p){
    var out = [], vus = {};
    S.sv.inv[p].forEach(function(id, i){
      if(vus[id]) return; vus[id] = 1;
      if(S.sv.used[p] || S.sv.pacte[p] !== 0) return;
      enumerer(S, p, id).forEach(function(c){ out.push({i: i, id: id, cible: c}); });
    });
    return out;
  }
  var FIXE = {oeil: .3, prophetie: .5, tresor: 1.0, larcin: 1.6, parade: 1.1, pacte: 1.4, bouclier: .6, chaine: 1.0, resurrection: .9};
  function valeurAction(S, p, a){
    var base = scoreBoard(S.board[p], S.opts) - scoreBoard(S.board[1 - p], S.opts), fois = (a.id === 'pari' || a.id === 'de' || a.id === 'foudre') ? 4 : 1, tot = 0;
    for(var k = 0; k < fois; k++){
      var C = cloner(S);
      if(a.id === 'prophetie' || a.id === 'tresor' || a.id === 'reassort' || a.id === 'larcin' || a.id === 'oeil' || a.id === 'resurrection'){ break; }
      var r = utiliser(C, p, a.i, a.cible);
      if(!r.ok){ tot = -99; break; }
      tot += scoreBoard(C.board[p], C.opts) - scoreBoard(C.board[1 - p], C.opts) - base;
    }
    var v = fois && tot !== -99 ? tot / fois : tot;
    if(a.id === 'tresor') v += FIXE.tresor;
    else if(a.id === 'reassort'){ var h = S.hands[p], m = h.reduce(function(s, c){ return s + c.power; }, 0) / (h.length || 1); v = m < 3.2 ? .9 : -.5; }
    else if(a.id === 'resurrection'){ var l = S.sv.cim[p][S.sv.cim[p].length - 1]; v = .5 + (l ? l.power * .4 : 0); }
    else if(a.id === 'prophetie') v = FIXE.prophetie;
    else if(a.id === 'larcin') v = FIXE.larcin;
    else if(a.id === 'oeil') v = FIXE.oeil;
    else if(a.id === 'parade') v += FIXE.parade;
    else if(a.id === 'pacte') v += FIXE.pacte;
    else if(a.id === 'bouclier'){ var sc = scoreColonne(S.board[p][a.cible.ci], S.opts).score; v += FIXE.bouclier + .12 * sc; }
    else if(a.id === 'chaine') v += FIXE.chaine;
    else if(a.id === 'rempart') v += .35 * S.board[p][a.cible.ci][a.cible.r].power;
    return v;
  }
  var BOTS_OBJET = {
    facile: function(S, p){
      if(S.rng() > .35) return null;
      var l = actions(S, p); return l.length ? l[aleat(S, l.length)] : null;
    },
    normal: function(S, p){ return meilleure(S, p, 1.0); },
    difficile: function(S, p){ return meilleure(S, p, .6); }
  };
  function meilleure(S, p, seuil){
    var best = null, bv = -1e9;
    actions(S, p).forEach(function(a){ var v = valeurAction(S, p, a) + S.rng() * .01; if(v > bv){ bv = v; best = a; } });
    return best && bv >= seuil ? best : null;
  }
  // ordre choisi par le robot pour la Prophétie : la meilleure carte d'abord
  function ordreRobot(cartes){
    var idx = cartes.map(function(c, k){ return k; });
    return idx.sort(function(a, b){ return cartes[b].power - cartes[a].power; });
  }

  root.LeClubiJeu = {
    reglages: reglages, nouvellePartie: nouvellePartie, coupsPossibles: coupsPossibles, apercu: apercu, jouer: jouer,
    abandon: abandon, scoreColonne: scoreColonne, scoreBoard: scoreBoard, pleine: pleine, BOTS: BOTS,
    composerPioche: composerPioche, toutesLesCartes: toutesLesCartes, PIOCHES: PIOCHES,
    OBJETS: OBJETS, tirerObjet: tirerObjet, nouveauMatch: nouveauMatch, lancerManche: lancerManche, finManche: finManche, enumerer: enumerer, normCible: normCible,
    peutUtiliser: peutUtiliser, utiliser: utiliser, vueSv: vueSv, protegee: protegee, verrouillee: verrouillee, BOTS_OBJET: BOTS_OBJET, ordreRobot: ordreRobot, INV_MAX: INV_MAX, MAIN_MAX: MAIN_MAX
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = root.LeClubiJeu;
})(typeof window !== 'undefined' ? window : globalThis);
