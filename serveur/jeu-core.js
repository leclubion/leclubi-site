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
    var d = {destroy:'all', triple:{type:'add', value:10}, hand:3, seconds:30, tolerance:3, pile:'c', startMax:6};
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
    if(!S.pioche.length && S.defausse.length){ S.pioche = melanger(S.defausse, S.rng); S.defausse = []; }
    if(S.pioche.length){ var c = S.pioche.pop(); S.hands[p].push(c); return c; }
    return null;
  }
  function coupsPossibles(S, p){
    var out = [];
    S.hands[p].forEach(function(c, h){ for(var ci = 0; ci < 3; ci++) if(S.board[p][ci].length < 3) out.push({h: h, ci: ci}); });
    return out;
  }
  // Cartes de l'adversaire qui seraient détruites par ce coup (sans rien modifier)
  function apercu(S, p, h, ci){
    var card = S.hands[p][h], col = S.board[1 - p][ci], out = [];
    if(!card) return out;
    if(S.opts.destroy === 'all'){ col.forEach(function(c, i){ if(c.power === card.power) out.push(i); }); }
    else { for(var i = 0; i < col.length; i++) if(col[i].power === card.power){ out.push(i); break; } }
    return out;
  }
  // Joue le coup, détruit, pioche, vérifie la fin. Retourne un résumé pour l'affichage.
  function jouer(S, p, h, ci){
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
    var nouvelle = piocher(S, p);
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
    if(S.opts.destroy === 'all') op[ci] = op[ci].filter(function(c){ return c.power !== card.power; });
    else { for(var i = 0; i < op[ci].length; i++) if(op[ci][i].power === card.power){ op[ci].splice(i, 1); break; } }
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

  root.LeClubiJeu = {
    reglages: reglages, nouvellePartie: nouvellePartie, coupsPossibles: coupsPossibles, apercu: apercu, jouer: jouer,
    abandon: abandon, scoreColonne: scoreColonne, scoreBoard: scoreBoard, pleine: pleine, BOTS: BOTS,
    composerPioche: composerPioche, toutesLesCartes: toutesLesCartes, PIOCHES: PIOCHES
  };
  if(typeof module !== 'undefined' && module.exports) module.exports = root.LeClubiJeu;
})(typeof window !== 'undefined' ? window : globalThis);
