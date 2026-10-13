/* Serveur du jeu "Clash des Piliers" – LeClubi
   Cloudflare Worker + un seul Durable Object ("Hub") qui garde en mémoire les joueurs connectés, la file d'attente
   et les parties en cours, et en base (SQLite) le classement, les limites du jour et les paiements ClubiGold.
   Le serveur est l'ARBITRE : il applique les règles (jeu-core.js), il tire les cartes, il garde les mains secrètes
   et il chronomètre les tours. Le navigateur ne fait qu'afficher et envoyer "je joue telle carte dans telle colonne". */
import J from './jeu-core.js';

const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const cfg = env => ({
  or: num(env.GOLD_VICTOIRE, 10), maxJour: num(env.MAX_VICTOIRES_JOUR, 5), maxOrPaire: num(env.MAX_OR_PAR_ADVERSAIRE, 2),
  maxStatsPaire: num(env.MAX_STATS_PAR_ADVERSAIRE, 6), tour: num(env.DUREE_TOUR, 30), grace: num(env.GRACE_TOUR, 3),
  maxCo: num(env.MAX_CONNEXIONS, 400)
});
const jourParis = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Paris'});
const rid = (n = 5) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); };
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const pub = c => ({id: c.id, art: c.art, saison: c.saison, n: c.n, power: c.power, r: c.r});
const blanc = c => ({id: c.id});

// ---------- Entrée HTTP ----------
function entetes(env, req) {
  const liste = String(env.ORIGINES || '*').split(',').map(s => s.trim()).filter(Boolean);
  const o = req.headers.get('Origin') || '';
  const ok = liste.includes('*') || liste.includes(o);
  return {'Access-Control-Allow-Origin': liste.includes('*') ? '*' : (ok ? o : liste[0] || ''), 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'};
}
function originOk(env, req) {
  const liste = String(env.ORIGINES || '*').split(',').map(s => s.trim()).filter(Boolean);
  if (liste.includes('*')) return true;
  const o = req.headers.get('Origin'); return !o || liste.includes(o);
}
const json = (o, h = {}, s = 200) => new Response(JSON.stringify(o), {status: s, headers: {'Content-Type': 'application/json; charset=utf-8', ...h}});

// lecture d'un CSV (guillemets, virgules et retours à la ligne dans les cellules)
function parseCsv(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}
const PROXIES = new Set(['/auth', '/moi', '/vitrine', '/vitrine-badges', '/reglage-profil', '/propositions', '/journal/carte', '/journal/usage']);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), h = entetes(env, req);
    if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: url.pathname.startsWith('/journal/') ? {...h, 'Access-Control-Allow-Origin': '*'} : h});
    const hub = env.HUB.get(env.HUB.idFromName('salon'));
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return json({erreur: 'websocket attendu'}, h, 426);
      if (!originOk(env, req)) return json({erreur: 'origine refusée'}, h, 403);
      return hub.fetch(req);
    }
    if (url.pathname === '/classement' || url.pathname === '/etat') {
      const cache = caches.default, cle = new Request(url.origin + url.pathname);
      let r = await cache.match(cle);
      if (!r) {
        const d = await hub.fetch(new Request('https://hub' + url.pathname));
        r = new Response(d.body, {status: d.status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + (url.pathname === '/etat' ? 5 : 30)}});
        if (d.ok) ctx.waitUntil(cache.put(cle, r.clone()));
      }
      const out = new Response(r.body, r); Object.entries(h).forEach(([k, v]) => out.headers.set(k, v)); return out;
    }
    if (url.pathname === '/journal') {                  // copie du journal des cartes (lecture publique, comme les tableurs publiés)
      const cache = caches.default, cle = new Request(url.origin + '/journal');
      let r = await cache.match(cle);
      if (!r) {
        const d = await hub.fetch(new Request('https://hub/journal'));
        r = new Response(d.body, {status: d.status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=15'}});
        if (d.ok) ctx.waitUntil(cache.put(cle, r.clone()));
      }
      const out = new Response(r.body, r); Object.entries(h).forEach(([k, v]) => out.headers.set(k, v)); return out;
    }
    if (PROXIES.has(url.pathname) || url.pathname.startsWith('/profil/')) {
      const ecriture = url.pathname.startsWith('/journal/');
      if (req.method === 'POST' && !ecriture && !originOk(env, req)) return json({erreur: 'origine refusée'}, h, 403);
      if (url.pathname.startsWith('/profil/')) {       // profil public : petit cache pour ne pas solliciter le salon à chaque visite
        const cache = caches.default, cle = new Request(url.origin + url.pathname);
        let r = await cache.match(cle);
        if (!r) {
          const d = await hub.fetch(new Request('https://hub' + url.pathname));
          r = new Response(d.body, {status: d.status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=20'}});
          if (d.ok) ctx.waitUntil(cache.put(cle, r.clone()));
        }
        const out = new Response(r.body, r); Object.entries(h).forEach(([k, v]) => out.headers.set(k, v)); return out;
      }
      const d = await hub.fetch(new Request('https://hub' + url.pathname, {method: req.method, headers: {Authorization: req.headers.get('Authorization') || '', 'Content-Type': 'application/json', 'X-Ip': req.headers.get('CF-Connecting-IP') || ''}, body: req.method === 'POST' ? await req.text() : undefined}));
      const out = new Response(d.body, d); out.headers.set('Cache-Control', 'no-store'); Object.entries(h).forEach(([k, v]) => out.headers.set(k, v)); if (ecriture) out.headers.set('Access-Control-Allow-Origin', '*'); return out;
    }
    if (url.pathname.startsWith('/admin/')) {
      const d = await hub.fetch(req);
      const out = new Response(d.body, d); Object.entries(h).forEach(([k, v]) => out.headers.set(k, v)); return out;
    }
    return json({ok: true, service: 'Jeu LeClubi'}, h);
  }
};

// ---------- Le salon ----------
export class Hub {
  constructor(state, env) {
    this.state = state; this.env = env; this.C = cfg(env); this.sql = state.storage.sql;
    const q = s => this.sql.exec(s);
    q(`CREATE TABLE IF NOT EXISTS joueurs(id TEXT PRIMARY KEY, login TEXT, nom TEXT, parties INTEGER DEFAULT 0, victoires INTEGER DEFAULT 0,
       defaites INTEGER DEFAULT 0, nuls INTEGER DEFAULT 0, or_total INTEGER DEFAULT 0, jour TEXT DEFAULT '', gains_jour INTEGER DEFAULT 0,
       banni INTEGER DEFAULT 0, vu INTEGER DEFAULT 0)`);
    q(`CREATE TABLE IF NOT EXISTS paires(jour TEXT, a TEXT, b TEXT, parties INTEGER DEFAULT 0, gains INTEGER DEFAULT 0, PRIMARY KEY(jour, a, b))`);
    q(`CREATE TABLE IF NOT EXISTS paiements(n INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, jour TEXT, id TEXT, login TEXT, montant INTEGER,
       statut TEXT, essais INTEGER DEFAULT 0, info TEXT DEFAULT '')`);
    q(`CREATE TABLE IF NOT EXISTS reglages(k TEXT PRIMARY KEY, v TEXT)`);
    // compte du site : avatar, vitrine (3 cartes), profil public ou non (ajoutés sans toucher aux données existantes)
    [`ALTER TABLE joueurs ADD COLUMN avatar TEXT DEFAULT ''`, `ALTER TABLE joueurs ADD COLUMN vitrine TEXT DEFAULT '[]'`, `ALTER TABLE joueurs ADD COLUMN prive INTEGER DEFAULT 0`,
     `ALTER TABLE joueurs ADD COLUMN cree INTEGER DEFAULT 0`, `ALTER TABLE joueurs ADD COLUMN vbadges TEXT DEFAULT '[]'`].forEach(a => { try { q(a); } catch (e) {} });
    q(`CREATE TABLE IF NOT EXISTS journal_cartes(n INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, pseudo TEXT, carte TEXT, src TEXT)`);
    q(`CREATE TABLE IF NOT EXISTS journal_usages(n INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, pseudo TEXT, carte TEXT, choix TEXT)`);
    q(`CREATE TABLE IF NOT EXISTS propositions(n INTEGER PRIMARY KEY AUTOINCREMENT, joueur TEXT, saison TEXT, part TEXT, kind TEXT, texte TEXT, ts INTEGER,
       statut TEXT DEFAULT 'ouverte', UNIQUE(joueur, saison, part))`);
    q(`CREATE TABLE IF NOT EXISTS votes(prop INTEGER, joueur TEXT, ts INTEGER, PRIMARY KEY(prop, joueur))`);
    this.jCache = null;            // journal sérialisé gardé en mémoire (relu seulement après un ajout)
    this.essaisAuth = new Map();   // ip -> {n, t}  (limite les connexions répétées)
    this.users = new Map();      // id Twitch -> {id, login, nom, ws, game, defi}
    this.file = [];              // ids en attente d'un adversaire
    this.defis = new Map();      // code -> {id, exp}
    this.parties = new Map();    // id partie -> partie
    this.nbJouees = 0; this.dernierDiffuse = 0; this.tDiffuse = null; this.nbSockets = 0;
    // au redémarrage : s'il reste des paiements non envoyés, on les relance
    state.blockConcurrencyWhile(async () => {
      const r = this.un(`SELECT COUNT(*) AS c FROM paiements WHERE statut='attente'`);
      if (r && r.c) await state.storage.setAlarm(Date.now() + 5000);
    });
  }

  // ----- petits outils base de données -----
  un(sql, ...a) { const r = this.sql.exec(sql, ...a).toArray(); return r[0] || null; }
  run(sql, ...a) { this.sql.exec(sql, ...a); }
  reglage(k, d) { const r = this.un('SELECT v FROM reglages WHERE k=?', k); return r ? r.v : d; }
  setReglage(k, v) { this.run('INSERT INTO reglages(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v)); }
  paire(jour, x, y) {
    const a = x < y ? x : y, b = x < y ? y : x;
    this.run('INSERT OR IGNORE INTO paires(jour,a,b) VALUES(?,?,?)', jour, a, b);
    return this.un('SELECT * FROM paires WHERE jour=? AND a=? AND b=?', jour, a, b);
  }
  joueur(id) { return this.un('SELECT * FROM joueurs WHERE id=?', id); }

  // ----- HTTP vers le salon -----
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') return this.ouvrirSocket();
    if (url.pathname === '/classement') return this.classement();
    if (url.pathname === '/etat') return json(this.etat());
    if (url.pathname.startsWith('/admin/')) return this.admin(req, url);
    if (url.pathname === '/journal') return this.journalLire();
    if (url.pathname.startsWith('/journal/')) return this.journalAjout(req, url);
    if (url.pathname.startsWith('/propositions')) return this.propositions(req, url);
    if (url.pathname === '/auth' || url.pathname === '/moi' || url.pathname === '/vitrine' || url.pathname === '/vitrine-badges' || url.pathname === '/reglage-profil' || url.pathname.startsWith('/profil/')) return this.compte(req, url);
    return json({erreur: 'inconnu'}, {}, 404);
  }
  etat() {
    return {enLigne: this.users.size, enFile: this.file.length, parties: this.parties.size, partiesJouees: this.nbJouees, orActif: this.reglage('pause', '0') !== '1'};
  }
  classement() {
    const l = this.sql.exec('SELECT nom, parties, victoires FROM joueurs WHERE parties>0 AND banni=0 ORDER BY victoires DESC, parties ASC LIMIT 300').toArray();
    return json({maj: Date.now(), minimumRatio: 10, joueurs: l.map(j => ({pseudo: j.nom, parties: j.parties, victoires: j.victoires, ratio: Math.round(1000 * j.victoires / j.parties) / 10}))});
  }

  // ----- administration (Authorization: Bearer ADMIN_KEY) -----
  async admin(req, url) {
    const cle = this.env.ADMIN_KEY || '', bon = 'Bearer ' + cle, recu = req.headers.get('Authorization') || '';
    let diff = bon.length ^ recu.length; for (let i = 0; i < bon.length; i++) diff |= bon.charCodeAt(i) ^ (recu.charCodeAt(i) || 0);
    if (!cle || diff !== 0) return json({erreur: 'non autorisé'}, {}, 401);
    const act = url.pathname.slice(7);
    let b = {}; if (req.method === 'POST') { try { b = await req.json(); } catch (e) {} }
    const login = String(b.login || url.searchParams.get('login') || '').toLowerCase();
    if (act === 'etat') return json({...this.etat(), limites: this.C});
    if (act === 'joueurs') return json(this.sql.exec('SELECT id,login,nom,parties,victoires,defaites,nuls,or_total,gains_jour,jour,banni FROM joueurs ORDER BY vu DESC LIMIT 200').toArray());
    if (act === 'paiements') return json(this.sql.exec('SELECT * FROM paiements ORDER BY n DESC LIMIT 100').toArray());
    if (act === 'pause') { this.setReglage('pause', b.pause ? '1' : '0'); return json({pause: !!b.pause}); }
    if (act === 'bannir' && login) {
      this.run('UPDATE joueurs SET banni=? WHERE login=?', b.banni === false ? 0 : 1, login);
      for (const u of this.users.values()) if (u.login === login && b.banni !== false) { this.envoyer(u.ws, {t: 'erreur', code: 'banni'}); try { u.ws.close(1008, 'banni'); } catch (e) {} }
      return json({ok: true});
    }
    if (act === 'remettre' && login) { this.run('UPDATE joueurs SET parties=0, victoires=0, defaites=0, nuls=0 WHERE login=?', login); return json({ok: true}); }
    if (act === 'supprimer' && login) { this.run('DELETE FROM joueurs WHERE login=?', login); return json({ok: true}); }
    if (act === 'rejouer-paiements') { await this.traiterPaiements(true); return json({ok: true}); }
    if (act === 'importer-journal') return this.importerJournal(b);
    if (act === 'propositions') return json(this.sql.exec(`SELECT p.n, p.saison, p.part, p.kind, p.texte, p.ts, p.statut, j.nom AS pseudo, j.login, (SELECT COUNT(*) FROM votes v WHERE v.prop=p.n) AS votes
      FROM propositions p JOIN joueurs j ON j.id=p.joueur ORDER BY p.n DESC LIMIT 300`).toArray());
    if (act === 'proposition' && Number.isInteger(b.n)) {
      if (b.supprimer) { this.run('DELETE FROM votes WHERE prop=?', b.n); this.run('DELETE FROM propositions WHERE n=?', b.n); return json({ok: true}); }
      if (['ouverte', 'retenue', 'refusee', 'masquee'].includes(b.statut)) { this.run('UPDATE propositions SET statut=? WHERE n=?', b.statut, b.n); return json({ok: true}); }
    }
    if (act === 'journal-etat') return json({cartes: this.un('SELECT COUNT(*) AS c FROM journal_cartes').c, usages: this.un('SELECT COUNT(*) AS c FROM journal_usages').c,
      dernieres: this.sql.exec('SELECT ts,pseudo,carte,src FROM journal_cartes ORDER BY n DESC LIMIT 10').toArray()});
    return json({erreur: 'action inconnue'}, {}, 404);
  }

  // ----- WebSocket -----
  ouvrirSocket() {
    if (this.users.size >= this.C.maxCo || this.nbSockets >= this.C.maxCo * 2) return json({erreur: 'complet'}, {}, 503);
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const ws = server; ws.u = null; ws.chaine = Promise.resolve(); ws.cpt = 0; ws.fen = Date.now(); this.nbSockets++;
    ws.tAuth = setTimeout(() => { if (!ws.u) { try { ws.close(1008, 'pas de connexion'); } catch (e) {} } }, 10000);   // une connexion sans identification est coupée au bout de 10 s
    ws.addEventListener('message', ev => {
      if (Date.now() - ws.fen > 10000) { ws.fen = Date.now(); ws.cpt = 0; }
      if (++ws.cpt > 60 || typeof ev.data !== 'string' || ev.data.length > 2000) { try { ws.close(1008, 'trop de messages'); } catch (e) {} return; }
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      ws.chaine = ws.chaine.then(() => this.message(ws, m)).catch(e => console.log('erreur message', e && e.message));
    });
    let ferme = false;
    const fermer = () => { if (ferme) return; ferme = true; this.nbSockets--; clearTimeout(ws.tAuth); this.fermeture(ws); };
    ws.addEventListener('close', fermer); ws.addEventListener('error', fermer);
    return new Response(null, {status: 101, webSocket: client});
  }
  envoyer(ws, o) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) {} }

  async twitch(tok) {
    const vurl = this.env.TWITCH_VALIDATE_URL || 'https://id.twitch.tv/oauth2/validate';
    const r = await fetch(vurl, {headers: {Authorization: 'OAuth ' + tok}});
    if (!r.ok) throw new Error('jeton refusé');
    const v = await r.json();
    if (!v.user_id || !v.login || v.client_id !== this.env.TWITCH_CLIENT_ID) throw new Error('mauvaise application');
    let nom = v.login, avatar = '';
    try {
      const u = await fetch(this.env.TWITCH_USERS_URL || 'https://api.twitch.tv/helix/users', {headers: {Authorization: 'Bearer ' + tok, 'Client-Id': this.env.TWITCH_CLIENT_ID}});
      if (u.ok) { const j = await u.json(); if (j.data && j.data[0]) { if (j.data[0].display_name) nom = String(j.data[0].display_name).slice(0, 40); if (/^https:\/\//.test(j.data[0].profile_image_url || '')) avatar = String(j.data[0].profile_image_url).slice(0, 300); } }
    } catch (e) {}
    return {id: String(v.user_id), login: String(v.login).toLowerCase(), nom, avatar};
  }

  async message(ws, m) {
    if (m.t === 'ping') { this.envoyer(ws, {t: 'pong'}); return; }
    if (m.t === 'hello') return this.hello(ws, m);
    const u = ws.u; if (!u) { this.envoyer(ws, {t: 'erreur', code: 'auth'}); return; }
    switch (m.t) {
      case 'file': return this.rejoindreFile(u);
      case 'defi': return this.creerDefi(u);
      case 'rejoindre': return this.rejoindreDefi(u, m.code);
      case 'annuler': return this.annuler(u);
      case 'jouer': return this.jouerDemande(u, m);
      case 'abandon': { const g = u.game; if (g && !g.fini) this.forfait(g, g.joueurs.indexOf(u.id), 'abandon'); return; }
      case 'reprise': { const g = u.game; if (g && !g.fini) this.envoyer(u.ws, this.vueReprise(g, g.joueurs.indexOf(u.id))); return; }
    }
  }

  async hello(ws, m) {
    if (ws.u) return;
    let info;
    try { info = await this.twitch(String(m.token || '').slice(0, 300)); }
    catch (e) { this.envoyer(ws, {t: 'erreur', code: 'auth'}); try { ws.close(1008, 'auth'); } catch (x) {} return; }
    let ligne = this.joueur(info.id);
    if (ligne && ligne.banni) { this.envoyer(ws, {t: 'erreur', code: 'banni'}); try { ws.close(1008, 'banni'); } catch (x) {} return; }
    this.run(`INSERT INTO joueurs(id,login,nom,vu,avatar,cree) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login, nom=excluded.nom, vu=excluded.vu, avatar=COALESCE(NULLIF(excluded.avatar,''), avatar)`, info.id, info.login, info.nom, Date.now(), info.avatar || '', Date.now());
    let u = this.users.get(info.id);
    if (u) {                                     // même joueur sur un autre onglet : l'ancien est remplacé
      if (u.ws && u.ws !== ws) { u.ws.u = null; this.envoyer(u.ws, {t: 'remplace'}); try { u.ws.close(1000, 'remplace'); } catch (x) {} }
      u.ws = ws; u.nom = info.nom; u.login = info.login;
    } else { u = {id: info.id, login: info.login, nom: info.nom, ws, game: null, defi: null}; this.users.set(info.id, u); }
    ws.u = u;
    this.envoyer(ws, {t: 'bienvenue', moi: this.fiche(info.id), presence: this.presence(), pause: this.reglage('pause', '0') === '1', regles: {tour: this.C.tour, or: this.C.or, maxJour: this.C.maxJour}});
    const g = u.game;
    if (g && !g.fini) {
      const s = g.joueurs.indexOf(u.id); g.deco[s] = false;
      this.envoyer(ws, this.vueReprise(g, s));
      this.envoyer(this.users.get(g.joueurs[1 - s])?.ws, {t: 'adv_retour'});
    }
    this.diffuser();
  }

  // ----- compte du site : session signée, profil, vitrine -----
  async cleSession() {
    let k = this.reglage('cle_session', '');
    if (!k) { k = rid(32); this.setReglage('cle_session', k); }
    return crypto.subtle.importKey('raw', new TextEncoder().encode(k), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
  }
  b64(buf) { let s = ''; new Uint8Array(buf).forEach(x => s += String.fromCharCode(x)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  deb64(t) { t = t.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; const s = atob(t), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  async creerSession(id) {
    const p = this.b64(new TextEncoder().encode(JSON.stringify({i: id, e: Date.now() + 30 * 86400000})));
    const sig = await crypto.subtle.sign('HMAC', await this.cleSession(), new TextEncoder().encode(p));
    return p + '.' + this.b64(sig);
  }
  async lireSession(req) {
    const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim(), [p, sig] = t.split('.');
    if (!p || !sig || t.length > 400) return null;
    try {
      const ok = await crypto.subtle.verify('HMAC', await this.cleSession(), this.deb64(sig), new TextEncoder().encode(p));
      if (!ok) return null;
      const d = JSON.parse(new TextDecoder().decode(this.deb64(p)));
      if (!d.i || d.e < Date.now()) return null;
      const j = this.joueur(String(d.i)); return j && !j.banni ? j : null;
    } catch (e) { return null; }
  }
  badgesDe(j) { try { const v = JSON.parse(j.vbadges || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 5) : []; } catch (e) { return []; } }
  vitrineDe(j) { try { const v = JSON.parse(j.vitrine || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 3) : []; } catch (e) { return []; } }
  rangs(j) {
    const rv = this.un('SELECT COUNT(*)+1 AS r FROM joueurs WHERE victoires>? AND banni=0 AND parties>0', j.victoires).r;
    let rr = null;
    if (j.parties >= 10) rr = this.un('SELECT COUNT(*)+1 AS r FROM joueurs WHERE parties>=10 AND banni=0 AND (victoires*1.0/parties)>?', j.victoires / j.parties).r;
    return {victoires: j.parties > 0 ? rv : null, ratio: rr};
  }
  profilPublic(j) {
    const base = {login: j.login, pseudo: j.nom, avatar: j.avatar || '', prive: !!j.prive};
    if (j.prive) return base;
    return {...base, vitrine: this.vitrineDe(j), badges: this.badgesDe(j), parties: j.parties, victoires: j.victoires, ratio: j.parties ? Math.round(1000 * j.victoires / j.parties) / 10 : null};
  }
  async compte(req, url) {
    const p = url.pathname;
    if (p.startsWith('/profil/')) {
      const login = decodeURIComponent(p.slice(8)).toLowerCase().slice(0, 40);
      const j = this.un('SELECT * FROM joueurs WHERE login=? AND banni=0', login);
      return j ? json(this.profilPublic(j)) : json({erreur: 'inconnu'}, {}, 404);
    }
    if (p === '/auth' && req.method === 'POST') {
      const ip = req.headers.get('X-Ip') || '?', now = Date.now(), e = this.essaisAuth.get(ip) || {n: 0, t: now};
      if (now - e.t > 60000) { e.n = 0; e.t = now; }
      if (++e.n > 20) return json({erreur: 'trop_de_demandes'}, {}, 429);
      this.essaisAuth.set(ip, e); if (this.essaisAuth.size > 500) this.essaisAuth.clear();
      let b = {}; try { b = await req.json(); } catch (x) {}
      let info; try { info = await this.twitch(String(b.token || '').slice(0, 300)); } catch (x) { return json({erreur: 'auth'}, {}, 401); }
      const ligne = this.joueur(info.id);
      if (ligne && ligne.banni) return json({erreur: 'banni'}, {}, 403);
      this.run(`INSERT INTO joueurs(id,login,nom,vu,avatar,cree) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login, nom=excluded.nom, vu=excluded.vu, avatar=COALESCE(NULLIF(excluded.avatar,''), avatar)`, info.id, info.login, info.nom, now, info.avatar || '', now);
      const sess = await this.creerSession(info.id);
      return json({session: sess, moi: this.moi(this.joueur(info.id))});
    }
    const j = await this.lireSession(req);
    if (!j) return json({erreur: 'session'}, {}, 401);
    if (p === '/moi') return json({moi: this.moi(j)});
    if (p === '/vitrine-badges' && req.method === 'POST') {     // jusqu'à 5 badges montrés sur le profil (les identifiants sont vérifiés à l'affichage par le site)
      let b = {}; try { b = await req.json(); } catch (x) {}
      const v = (Array.isArray(b.badges) ? b.badges : []).filter(x => typeof x === 'string' && /^[a-z0-9-]{2,24}$/.test(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 5);
      this.run('UPDATE joueurs SET vbadges=? WHERE id=?', JSON.stringify(v), j.id);
      return json({ok: true, badges: v});
    }
    if (p === '/vitrine' && req.method === 'POST') {
      let b = {}; try { b = await req.json(); } catch (x) {}
      const ok = /^(s\d+|halloween)-\d{1,3}$|^tarot-\d{1,2}$/;
      const v = (Array.isArray(b.cartes) ? b.cartes : []).filter(x => typeof x === 'string' && ok.test(x)).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3);
      this.run('UPDATE joueurs SET vitrine=? WHERE id=?', JSON.stringify(v), j.id);
      return json({ok: true, vitrine: v});
    }
    if (p === '/reglage-profil' && req.method === 'POST') {
      let b = {}; try { b = await req.json(); } catch (x) {}
      this.run('UPDATE joueurs SET prive=? WHERE id=?', b.prive ? 1 : 0, j.id);
      return json({ok: true, prive: !!b.prive});
    }
    return json({erreur: 'inconnu'}, {}, 404);
  }
  moi(j) {
    const jour = jourParis();
    return {id: j.id, login: j.login, pseudo: j.nom, avatar: j.avatar || '', vitrine: this.vitrineDe(j), badges: this.badgesDe(j), prive: !!j.prive,
      jeu: {parties: j.parties, victoires: j.victoires, defaites: j.defaites, nuls: j.nuls, orTotal: j.or_total, victoiresOrAujourdhui: j.jour === jour ? j.gains_jour : 0,
        ratio: j.parties ? Math.round(1000 * j.victoires / j.parties) / 10 : null, rang: this.rangs(j), maxJour: this.C.maxJour, minimumRatio: 10}};
  }

  // ----- journal des cartes : COPIE du Google Sheet (le site continue de lire le tableur tant que tu ne bascules pas) -----
  cleJournalOk(req) {
    const recu = req.headers.get('Authorization') || '';
    return [this.env.JOURNAL_KEY, this.env.ADMIN_KEY].some(k => {
      if (!k) return false;
      const bon = 'Bearer ' + k; let d = bon.length ^ recu.length;
      for (let i = 0; i < bon.length; i++) d |= bon.charCodeAt(i) ^ (recu.charCodeAt(i) || 0);
      return d === 0;
    });
  }
  async journalAjout(req, url) {
    if (req.method !== 'POST') return json({erreur: 'méthode'}, {}, 405);
    if (!this.cleJournalOk(req)) return json({erreur: 'non autorisé'}, {}, 401);
    let b = {}; try { b = await req.json(); } catch (e) {}
    const pseudo = String(b.pseudo || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60), now = Date.now();
    if (!pseudo) return json({erreur: 'pseudo'}, {}, 400);
    if (url.pathname === '/journal/carte') {
      const l = (Array.isArray(b.cartes) ? b.cartes : [b.carte]).map(x => String(x || '').trim().toLowerCase()).filter(x => /^[a-z0-9]+-\d{1,3}$/.test(x)).slice(0, 10);
      if (!l.length) return json({erreur: 'carte'}, {}, 400);
      l.forEach(c => this.run('INSERT INTO journal_cartes(ts,pseudo,carte,src) VALUES(?,?,?,?)', now, pseudo, c, 'live'));
      this.jCache = null; return json({ok: true, ajoutees: l.length});
    }
    if (url.pathname === '/journal/usage') {
      const c = String(b.carte || '').trim().toLowerCase(), ch = String(b.choix || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
      if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(c)) return json({erreur: 'carte'}, {}, 400);
      this.run('INSERT INTO journal_usages(ts,pseudo,carte,choix) VALUES(?,?,?,?)', now, pseudo, c, ch);
      this.jCache = null; return json({ok: true});
    }
    return json({erreur: 'inconnu'}, {}, 404);
  }
  journalLire() {
    if (!this.jCache) {
      const c = this.sql.exec('SELECT pseudo,carte FROM journal_cartes ORDER BY n').toArray().map(r => [r.pseudo, r.carte]);
      const u = this.sql.exec('SELECT pseudo,carte,choix FROM journal_usages ORDER BY n').toArray().map(r => [r.pseudo, r.carte, r.choix]);
      this.jCache = JSON.stringify({cartes: c, usages: u, maj: Date.now()});
    }
    return new Response(this.jCache, {headers: {'Content-Type': 'application/json; charset=utf-8'}});
  }
  // Recopie les deux tableaux Google (liens CSV publiés) dans le serveur. remplacer:true efface d'abord la copie.
  async importerJournal(b) {
    const ok = u => /^https:\/\/docs\.google\.com\//.test(String(u || '')) || (!!this.env.IMPORT_TEST && String(u || '').startsWith(this.env.IMPORT_TEST));   // IMPORT_TEST : réservé aux essais
    const lire = async u => { const r = await fetch(u + (u.includes('?') ? '&' : '?') + '_=' + Date.now(), {headers: {'Cache-Control': 'no-cache'}}); if (!r.ok) throw new Error('HTTP ' + r.status); return parseCsv(await r.text()); };
    const col = (rows, ...mots) => { const h = (rows[0] || []).map(x => String(x || '').trim().toLowerCase()); return mots.map((m, i) => { const k = h.findIndex(x => x.includes(m)); return k < 0 ? i + 1 : k; }); };
    let cartes = null, usages = null;
    try {
      if (ok(b.cartes_url)) cartes = await lire(b.cartes_url);
      if (ok(b.usages_url)) usages = await lire(b.usages_url);
    } catch (e) { return json({erreur: 'lecture_impossible', detail: String(e && e.message)}, {}, 502); }
    if (!cartes && !usages) return json({erreur: 'aucun_lien'}, {}, 400);
    const res = {cartes: 0, usages: 0};
    this.state.storage.transactionSync(() => {
      if (cartes) {
        if (b.remplacer) this.run("DELETE FROM journal_cartes");
        const [ip, ic] = col(cartes, 'pseudo', 'carte');
        cartes.slice(1).forEach(r => {
          const p = String(r[ip] || '').trim().slice(0, 60), c = String(r[ic] || '').trim().toLowerCase();
          if (p && /^[a-z0-9]+-\d{1,3}$/.test(c)) { this.run('INSERT INTO journal_cartes(ts,pseudo,carte,src) VALUES(?,?,?,?)', 0, p, c, 'import'); res.cartes++; }
        });
      }
      if (usages) {
        if (b.remplacer) this.run("DELETE FROM journal_usages");
        const [ip, ic, ix] = col(usages, 'pseudo', 'carte', 'choix');
        usages.slice(1).forEach(r => {
          const p = String(r[ip] || '').trim().slice(0, 60), c = String(r[ic] || '').trim().toLowerCase(), ch = String(r[ix] || '').trim().slice(0, 40);
          if (p && /^[a-z0-9][a-z0-9-]{0,40}$/.test(c)) { this.run('INSERT INTO journal_usages(ts,pseudo,carte,choix) VALUES(?,?,?,?)', 0, p, c, ch); res.usages++; }
        });
      }
    });
    this.jCache = null;
    return json({ok: true, ...res});
  }

  // ----- propositions et votes (liés au compte Twitch) -----
  async propositions(req, url) {
    const p = url.pathname, me = await this.lireSession(req);
    if (!me) return json({erreur: 'session'}, {}, 401);
    if (p === '/propositions' && req.method === 'GET') {      // privé : chacun ne voit que ses propres propositions (LeClubi les lit dans la page admin)
      const miennes = this.sql.exec(`SELECT n, saison, part, kind, texte, ts, statut FROM propositions WHERE joueur=? AND statut!='masquee' ORDER BY ts DESC`, me.id).toArray();
      return json({miennes});
    }
    let b = {}; try { b = await req.json(); } catch (e) {}
    if (p === '/propositions' && req.method === 'POST') {
      const saison = String(b.saison || ''), part = String(b.part || ''), kind = String(b.kind || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 50);
      const texte = String(b.texte || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 400);
      if (!/^(s\d{1,2}|halloween)$/.test(saison) || !/^[a-z-]{2,20}$/.test(part)) return json({erreur: 'invalide'}, {}, 400);
      if (texte.length < 3) return json({erreur: 'trop_court'}, {}, 400);
      const ex = this.un('SELECT n, statut FROM propositions WHERE joueur=? AND saison=? AND part=?', me.id, saison, part);
      if (ex) {
        if (ex.statut !== 'ouverte') return json({erreur: 'deja_traitee'}, {}, 409);
        this.run('UPDATE propositions SET texte=?, kind=?, ts=? WHERE n=?', texte, kind, Date.now(), ex.n);
        return json({ok: true, n: ex.n, modifiee: true});
      }
      if (this.un("SELECT COUNT(*) AS c FROM propositions WHERE joueur=? AND statut='ouverte'", me.id).c >= 12) return json({erreur: 'trop_de_propositions'}, {}, 429);
      this.run('INSERT INTO propositions(joueur,saison,part,kind,texte,ts) VALUES(?,?,?,?,?,?)', me.id, saison, part, kind, texte, Date.now());
      return json({ok: true, n: this.un('SELECT MAX(n) AS n FROM propositions').n});
    }
    return json({erreur: 'inconnu'}, {}, 404);
  }

  fiche(id) {
    const j = this.joueur(id), jour = jourParis();
    return {pseudo: j.nom, parties: j.parties, victoires: j.victoires, defaites: j.defaites, nuls: j.nuls, orTotal: j.or_total,
      victoiresOrAujourdhui: j.jour === jour ? j.gains_jour : 0, rang: this.un('SELECT COUNT(*)+1 AS r FROM joueurs WHERE victoires>? AND banni=0', j.victoires).r};
  }
  presence() { return {enLigne: this.users.size, enFile: this.file.length, parties: this.parties.size}; }
  diffuser() {
    if (this.tDiffuse) return;
    this.tDiffuse = setTimeout(() => {
      this.tDiffuse = null; const p = {t: 'presence', ...this.presence()};
      for (const u of this.users.values()) this.envoyer(u.ws, p);
    }, 1500);
  }

  fermeture(ws) {
    const u = ws.u; if (!u || u.ws !== ws) return;
    ws.u = null;
    this.file = this.file.filter(x => x !== u.id);
    if (u.defi) { this.defis.delete(u.defi); u.defi = null; }
    const g = u.game;
    if (g && !g.fini) {
      const s = g.joueurs.indexOf(u.id); g.deco[s] = true; u.ws = null;
      this.envoyer(this.users.get(g.joueurs[1 - s])?.ws, {t: 'adv_deco'});
      this.raccourcir(g);
    } else this.users.delete(u.id);
    this.diffuser();
  }

  // ----- file d'attente et défis -----
  annuler(u, muet) {
    this.file = this.file.filter(x => x !== u.id);
    if (u.defi) { this.defis.delete(u.defi); u.defi = null; }
    if (!muet) this.envoyer(u.ws, {t: 'annule'}); this.diffuser();
  }
  rejoindreFile(u) {
    if (u.game && !u.game.fini) return;
    this.annuler(u, true);
    const i = this.file.findIndex(id => { const o = this.users.get(id); return id !== u.id && o && o.ws && o.ws.readyState === 1 && !o.game; });
    if (i >= 0) { const o = this.users.get(this.file.splice(i, 1)[0]); this.lancer(o, u, 'file'); }
    else { this.file.push(u.id); this.envoyer(u.ws, {t: 'attente', mode: 'file'}); }
    this.diffuser();
  }
  creerDefi(u) {
    if (u.game && !u.game.fini) return;
    this.annuler(u, true);
    const al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code;
    do { code = Array.from({length: 6}, () => al[Math.floor(rng() * al.length)]).join(''); } while (this.defis.has(code));
    this.defis.set(code, {id: u.id, exp: Date.now() + 15 * 60 * 1000}); u.defi = code;
    this.envoyer(u.ws, {t: 'attente', mode: 'defi', code});
  }
  rejoindreDefi(u, code) {
    if (u.game && !u.game.fini) return;
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const d = this.defis.get(code), o = d && this.users.get(d.id);
    if (!d || d.exp < Date.now() || !o || !o.ws || o.game) { this.defis.delete(code); this.envoyer(u.ws, {t: 'erreur', code: 'defi_inconnu'}); return; }
    if (o.id === u.id) { this.envoyer(u.ws, {t: 'erreur', code: 'defi_soi_meme'}); return; }
    this.defis.delete(code); o.defi = null; this.annuler(u, true);
    this.lancer(o, u, 'defi');
  }

  // ----- une partie -----
  lancer(a, b, mode) {
    const S = J.nouvellePartie(J.reglages({seconds: this.C.tour}), rng);
    [S.pioche, S.hands[0], S.hands[1]].forEach(l => l.forEach(c => { c.id = rid(); }));   // identifiants secrets : ils ne révèlent rien sur la carte
    const g = {id: rid(4), S, joueurs: [a.id, b.id], noms: [a.nom, b.nom], logins: [a.login, b.login], mode, timeouts: [0, 0], deco: [false, false],
      fini: false, timer: null, deadline: 0, seq: 0, debut: Date.now()};
    a.game = g; b.game = g; this.parties.set(g.id, g);
    [0, 1].forEach(s => this.envoyer(this.users.get(g.joueurs[s]).ws, this.vueDebut(g, s)));
    this.armer(g, 8);
    this.diffuser();
  }
  regles(S) { return {destroy: S.opts.destroy, triple: S.opts.triple, hand: S.opts.hand, seconds: S.opts.seconds, tolerance: S.opts.tolerance, startMax: S.opts.startMax, pile: S.opts.pile}; }
  vueDebut(g, s) {
    const S = g.S;
    return {t: 'debut', partie: g.id, mode: g.mode, siege: s, premier: S.first, regles: this.regles(S), main: S.hands[s].map(pub), adv: S.hands[1 - s].map(blanc),
      pioche: S.pioche.length + S.defausse.length, adversaire: {pseudo: g.noms[1 - s]}};
  }
  vueReprise(g, s) {
    const S = g.S;
    return {t: 'reprise', partie: g.id, mode: g.mode, siege: s, premier: S.first, regles: this.regles(S), tour: S.turn, reste: Math.max(0, g.deadline - Date.now()),
      plateau: S.board.map(b => b.map(col => col.map(pub))), main: S.hands[s].map(pub), adv: S.hands[1 - s].map(blanc),
      pioche: S.pioche.length + S.defausse.length, scores: S.scores, timeouts: g.timeouts, tours: S.tours, adversaire: {pseudo: g.noms[1 - s]}};
  }
  armer(g, bonus = 0) {
    clearTimeout(g.timer); if (g.fini) return;
    const S = g.S, p = S.turn, mon = ++g.seq;
    let ms = (this.C.tour + this.C.grace + bonus) * 1000;
    if (g.deco[p]) ms = Math.min(ms, 10000);
    g.deadline = Date.now() + ms;
    g.timer = setTimeout(() => { if (g.seq === mon) this.expire(g, p); }, ms);
  }
  raccourcir(g) {            // joueur déconnecté pendant son tour : il ne lui reste que 10 s au maximum (jamais plus qu'avant)
    if (g.fini) return;
    const p = g.S.turn, mon = ++g.seq, ms = Math.max(0, Math.min(g.deadline - Date.now(), g.deco[p] ? 10000 : 1e9));
    g.deadline = Date.now() + ms;
    g.timer = (clearTimeout(g.timer), setTimeout(() => { if (g.seq === mon) this.expire(g, p); }, ms));
  }
  expire(g, p) {
    if (g.fini || g.S.turn !== p) return;
    g.timeouts[p]++;
    if (g.timeouts[p] >= g.S.opts.tolerance) { this.forfait(g, p, 'forfait'); return; }
    const m = J.BOTS.facile(g.S, p);
    if (!m) { this.forfait(g, p, 'forfait'); return; }
    this.coup(g, p, m.h, m.ci, true);
  }
  jouerDemande(u, m) {
    const g = u.game; if (!g || g.fini) return;
    const s = g.joueurs.indexOf(u.id), S = g.S, ci = m.ci;
    const h = S.hands[s].findIndex(c => c.id === m.id);
    if (S.turn !== s || h < 0 || !Number.isInteger(ci) || ci < 0 || ci > 2 || S.board[s][ci].length >= 3) {
      this.envoyer(u.ws, {t: 'erreur', code: 'coup_invalide'}); this.envoyer(u.ws, this.vueReprise(g, s)); return;
    }
    this.coup(g, s, h, ci, false);
  }
  coup(g, s, h, ci, auto) {
    const S = g.S, carte = S.hands[s][h];
    const res = J.jouer(S, s, h, ci); if (!res) return;
    const base = {t: 'coup', p: s, h, ci, carte: pub(carte), detruites: res.detruites.map(c => c.id), scores: S.scores, auto: !!auto, timeouts: g.timeouts,
      fin: !!res.fin, pioche_n: S.pioche.length + S.defausse.length};
    [0, 1].forEach(v => this.envoyer(this.users.get(g.joueurs[v])?.ws, {...base, pioche: res.pioche ? (v === s ? pub(res.pioche) : blanc(res.pioche)) : null}));
    if (res.fin) this.finir(g, 'normal'); else this.armer(g);
  }
  forfait(g, s, raison) {
    if (g.fini) return;
    J.abandon(g.S, s); this.finir(g, raison);
  }

  // ----- fin de partie : statistiques, limites, ClubiGold -----
  finir(g, raison) {
    if (g.fini) return; g.fini = true; clearTimeout(g.timer);
    const S = g.S, jour = jourParis(), w = S.winner, [a, b] = g.joueurs;
    const total = S.tours[0] + S.tours[1];
    let compte = true, motifStats = null;
    if (S.forfait != null && total < 4) { compte = false; motifStats = 'trop_courte'; }
    const paire = this.paire(jour, a, b);
    if (compte && paire.parties >= this.C.maxStatsPaire) { compte = false; motifStats = 'amicale'; }
    if (compte) {
      this.run('UPDATE paires SET parties=parties+1 WHERE jour=? AND a=? AND b=?', jour, paire.a, paire.b);
      this.nbJouees++;
      [0, 1].forEach(s => {
        const col = w === -1 ? 'nuls' : (w === s ? 'victoires' : 'defaites');
        this.run(`UPDATE joueurs SET parties=parties+1, ${col}=${col}+1 WHERE id=?`, g.joueurs[s]);
      });
    }
    // récompense
    let gain = 0, motifOr = null, paiement = null;
    if (!compte) motifOr = motifStats;
    else if (w === -1) motifOr = 'nul';
    else {
      const gid = g.joueurs[w], pj = this.joueur(gid), uw = this.users.get(gid), gj = pj.jour === jour ? pj.gains_jour : 0;
      const pa = this.paire(jour, a, b);
      if (this.reglage('pause', '0') === '1') motifOr = 'pause';
      else if (g.deco[w] || !uw || !uw.ws) motifOr = 'deconnecte';
      else if (gj >= this.C.maxJour) motifOr = 'limite_jour';
      else if (pa.gains >= this.C.maxOrPaire) motifOr = 'limite_adversaire';
      else {
        gain = this.C.or;
        this.run('UPDATE joueurs SET jour=?, gains_jour=?, or_total=or_total+? WHERE id=?', jour, gj + 1, gain, gid);
        this.run('UPDATE paires SET gains=gains+1 WHERE jour=? AND a=? AND b=?', jour, pa.a, pa.b);
        this.run('INSERT INTO paiements(ts,jour,id,login,montant,statut) VALUES(?,?,?,?,?,?)', Date.now(), jour, gid, pj.login, gain, 'attente');
        paiement = this.un('SELECT MAX(n) AS n FROM paiements').n;
      }
    }
    [0, 1].forEach(s => {
      const u = this.users.get(g.joueurs[s]);
      this.envoyer(u && u.ws, {t: 'fin', gagnant: w, scores: S.scores, raison, forfait: S.forfait == null ? null : S.forfait, compte,
        or: {gain: w === s ? gain : 0, raison: motifOr}, moi: this.fiche(g.joueurs[s]), orPlafond: this.C.maxJour});
    });
    // nettoyage
    [0, 1].forEach(s => { const u = this.users.get(g.joueurs[s]); if (u) { u.game = null; if (!u.ws) this.users.delete(u.id); } });
    this.parties.delete(g.id); this.diffuser();
    if (paiement) this.payer(paiement).catch(e => console.log('paiement', e && e.message));
  }

  // ----- paiements WizeBot -----
  async payer(n) {
    const p = this.un('SELECT * FROM paiements WHERE n=?', n); if (!p || p.statut === 'ok') return;
    let cle = String(this.env.WIZEBOT_KEY || '').trim(); const mc = cle.match(/(?:custom-alerts|currency)\/([^\/\s]+)/); if (mc) cle = mc[1];   // tolère un lien collé en entier ou des espaces autour de la clé
    let ok = false, info = '';
    if (!cle) info = 'clé WizeBot absente';
    else {
      try {
        const base = this.env.WIZEBOT_URL || 'https://wapi.wizebot.tv/api/currency';
        const r = await fetch(`${base}/${encodeURIComponent(cle)}/action/add/${encodeURIComponent(p.login)}/${p.montant}`, {method: 'POST'});
        const txt = (await r.text()).slice(0, 200);
        ok = r.ok && !/"success"\s*:\s*false|"error"/i.test(txt); info = (ok ? 'réponse WizeBot : ' : 'HTTP ' + r.status + ' : ') + txt.replace(/\s+/g, ' ').slice(0, 120);
      } catch (e) { info = 'réseau'; }
    }
    const essais = p.essais + 1;
    this.run('UPDATE paiements SET statut=?, essais=?, info=? WHERE n=?', ok ? 'ok' : (essais >= 8 ? 'echec' : 'attente'), essais, info, n);
    if (!ok && essais < 8) await this.state.storage.setAlarm(Date.now() + 60000);
  }
  async traiterPaiements(force) {
    const l = this.sql.exec(`SELECT n FROM paiements WHERE statut='attente' OR (?=1 AND statut='echec') ORDER BY n LIMIT 20`, force ? 1 : 0).toArray();
    for (const r of l) { if (force) this.run('UPDATE paiements SET essais=0, statut=? WHERE n=?', 'attente', r.n); await this.payer(r.n); }
  }
  async alarm() {
    await this.traiterPaiements(false);
    const vieux = new Date(Date.now() - 8 * 86400000).toLocaleDateString('sv-SE', {timeZone: 'Europe/Paris'});
    this.run('DELETE FROM paires WHERE jour<?', vieux);
    for (const [c, d] of this.defis) if (d.exp < Date.now()) this.defis.delete(c);
  }
}
