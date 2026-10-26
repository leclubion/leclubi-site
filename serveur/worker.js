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
const parisMs = (jour, fin) => {      // minuit (heure de Paris) du jour donné ; fin=true : minuit du lendemain
  const [y, m, d] = jour.split('-').map(Number), base = Date.UTC(y, m - 1, d + (fin ? 1 : 0)), iso = new Date(base).toISOString().slice(0, 10);
  for (const off of [2, 1]) { const t = base - off * 3600e3, x = new Date(t).toLocaleString('sv-SE', {timeZone: 'Europe/Paris'}); if (x.slice(0, 10) === iso && x.slice(11, 13) === '00') return t; }
  return base - 3600e3;
};
const JOURJ = ts => new Date(ts).toLocaleDateString('sv-SE', {timeZone: 'Europe/Paris'});
const ICONES = ['star', 'layers', 'cards', 'crown', 'trophy', 'gem', 'moon', 'eye', 'flame', 'sword', 'dice', 'bulb', 'spider', 'balise'], TIERS = ['bronze', 'argent', 'or', 'epique', 'mythique'];
const TYPES_DEFI = ['cartes', 'differentes', 'usages', 'parties', 'visites', 'manuel'];
const jourParis = () => new Date().toLocaleDateString('sv-SE', {timeZone: 'Europe/Paris'});
const rid = (n = 5) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); };
const rng = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const pub = c => ({id: c.id, art: c.art, saison: c.saison, n: c.n, power: c.power, r: c.r, ...(c.sc ? {sc: 1} : {}), ...(c.mod ? {mod: 1, base: c.base} : {})});
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
const PROXIES = new Set(['/auth', '/moi', '/vitrine', '/vitrine-badges', '/reglage-profil', '/propositions', '/defis', '/titre', '/araignee', '/cache', '/fiche', '/quotidien', '/arcade', '/arcade/coffre', '/journal/carte', '/journal/usage', '/boutique', '/classement-quiz', '/shoot/debut', '/shoot/fin', '/reliques', '/reliques/recuperer']);

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
    if (url.pathname === '/classement' || url.pathname === '/classement-survie' || url.pathname === '/etat') {
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
    if (url.pathname === '/titres') {                    // titres affichés des joueurs au profil public (classement, collectionneurs)
      const cache = caches.default, cle = new Request(url.origin + '/titres');
      let r = await cache.match(cle);
      if (!r) {
        const d = await hub.fetch(new Request('https://hub/titres'));
        r = new Response(d.body, {status: d.status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60'}});
        if (d.ok) ctx.waitUntil(cache.put(cle, r.clone()));
      }
      const out = new Response(r.body, r); Object.entries(h).forEach(([k, v]) => out.headers.set(k, v)); return out;
    }
    if (url.pathname.startsWith('/forum/') && req.method === 'GET' && !req.headers.get('Authorization')) {   // lectures du forum sans connexion : petit cache de 10 secondes
      const cache = caches.default, cle = new Request(url.origin + url.pathname + url.search);
      let r = await cache.match(cle);
      if (!r) {
        const d = await hub.fetch(new Request('https://hub' + url.pathname + url.search, {headers: {'X-Ip': req.headers.get('CF-Connecting-IP') || ''}}));
        r = new Response(d.body, {status: d.status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=10'}});
        if (d.ok) ctx.waitUntil(cache.put(cle, r.clone()));
      }
      const out = new Response(r.body, r); Object.entries(h).forEach(([k, v]) => out.headers.set(k, v)); return out;
    }
    if (PROXIES.has(url.pathname) || url.pathname.startsWith('/profil/') || url.pathname.startsWith('/forum/')) {
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
      const d = await hub.fetch(new Request('https://hub' + url.pathname + url.search, {method: req.method, headers: {Authorization: req.headers.get('Authorization') || '', 'Content-Type': 'application/json', 'X-Ip': req.headers.get('CF-Connecting-IP') || ''}, body: req.method === 'POST' ? await req.text() : undefined}));
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
     `ALTER TABLE joueurs ADD COLUMN cree INTEGER DEFAULT 0`, `ALTER TABLE joueurs ADD COLUMN vbadges TEXT DEFAULT '[]'`, `ALTER TABLE joueurs ADD COLUMN titre TEXT DEFAULT ''`, `ALTER TABLE joueurs ADD COLUMN fiche TEXT DEFAULT '{}'`, `ALTER TABLE joueurs ADD COLUMN cadre_av TEXT DEFAULT ''`, `ALTER TABLE joueurs ADD COLUMN banniere TEXT DEFAULT ''`, `ALTER TABLE joueurs ADD COLUMN couleur TEXT DEFAULT ''`,
     `ALTER TABLE joueurs ADD COLUMN sv_parties INTEGER DEFAULT 0`, `ALTER TABLE joueurs ADD COLUMN sv_victoires INTEGER DEFAULT 0`, `ALTER TABLE joueurs ADD COLUMN sv_defaites INTEGER DEFAULT 0`, `ALTER TABLE joueurs ADD COLUMN sv_nuls INTEGER DEFAULT 0`].forEach(a => { try { q(a); } catch (e) {} });
    q(`CREATE TABLE IF NOT EXISTS journal_cartes(n INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, pseudo TEXT, carte TEXT, src TEXT)`);
    q(`CREATE TABLE IF NOT EXISTS journal_usages(n INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, pseudo TEXT, carte TEXT, choix TEXT)`);
    q(`CREATE TABLE IF NOT EXISTS propositions(n INTEGER PRIMARY KEY AUTOINCREMENT, joueur TEXT, saison TEXT, part TEXT, kind TEXT, texte TEXT, ts INTEGER,
       statut TEXT DEFAULT 'ouverte', UNIQUE(joueur, saison, part))`);
    q(`CREATE TABLE IF NOT EXISTS votes(prop INTEGER, joueur TEXT, ts INTEGER, PRIMARY KEY(prop, joueur))`);
    // défis, titres et badges spéciaux
    q(`CREATE TABLE IF NOT EXISTS defis(n INTEGER PRIMARY KEY AUTOINCREMENT, titre TEXT, descr TEXT DEFAULT '', type TEXT, cible INTEGER DEFAULT 1, saison TEXT DEFAULT '',
       debut INTEGER, fin INTEGER, rec_titre TEXT DEFAULT '', b_nom TEXT DEFAULT '', b_ico TEXT DEFAULT 'star', b_tier TEXT DEFAULT 'argent', secret INTEGER DEFAULT 0, actif INTEGER DEFAULT 1)`);
    q(`CREATE TABLE IF NOT EXISTS succes(joueur TEXT, kind TEXT, cle TEXT, ts INTEGER, src TEXT DEFAULT '', PRIMARY KEY(joueur, kind, cle))`);
    q(`CREATE TABLE IF NOT EXISTS qjeux(nom TEXT PRIMARY KEY, genre TEXT DEFAULT '', annee INTEGER DEFAULT 0, plateforme TEXT DEFAULT '', studio TEXT DEFAULT '', chaine INTEGER DEFAULT 0)`);
    try { q(`ALTER TABLE qjeux ADD COLUMN vue TEXT DEFAULT ''`); } catch (e) {}
    q(`CREATE TABLE IF NOT EXISTS puzzles(n INTEGER PRIMARY KEY AUTOINCREMENT, fmt TEXT, jeu TEXT, data TEXT, jour TEXT DEFAULT '', ts INTEGER)`);
    q(`CREATE TABLE IF NOT EXISTS acartes(joueur TEXT, carte TEXT, ts INTEGER, src TEXT DEFAULT '', PRIMARY KEY(joueur, carte))`);
    q(`CREATE TABLE IF NOT EXISTS atirages(joueur TEXT, jour TEXT, cartes TEXT, choix INTEGER DEFAULT -1, PRIMARY KEY(joueur, jour))`);
    q(`CREATE TABLE IF NOT EXISTS qparties(joueur TEXT, jour TEXT, fmt TEXT, puzzle INTEGER, essais TEXT DEFAULT '[]', fini INTEGER DEFAULT 0, gagne INTEGER DEFAULT 0, pts INTEGER DEFAULT 0, PRIMARY KEY(joueur, jour))`);
    q(`CREATE TABLE IF NOT EXISTS bq_achats(n INTEGER PRIMARY KEY AUTOINCREMENT, joueur TEXT, item TEXT, prix INTEGER, jour TEXT, ts INTEGER)`);
    q(`CREATE TABLE IF NOT EXISTS qsemaines(sem INTEGER PRIMARY KEY, deb TEXT, top TEXT)`);
    q(`CREATE TABLE IF NOT EXISTS bonus(joueur TEXT, cle TEXT, pts INTEGER, ts INTEGER, PRIMARY KEY(joueur, cle))`);
    q(`CREATE TABLE IF NOT EXISTS shoot_sessions(joueur TEXT PRIMARY KEY, seed INTEGER, ts INTEGER)`);
    q(`CREATE TABLE IF NOT EXISTS reliques(joueur TEXT, cle TEXT, ts INTEGER, PRIMARY KEY(joueur, cle))`);
    q(`CREATE TABLE IF NOT EXISTS visites(joueur TEXT, jour TEXT, PRIMARY KEY(joueur, jour))`);
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
    if (url.pathname === '/classement-survie') return this.classement(true);
    if (url.pathname === '/etat') return json(this.etat());
    if (url.pathname.startsWith('/admin/')) return this.admin(req, url);
    if (url.pathname === '/journal') return this.journalLire();
    if (url.pathname === '/titres') return this.titresPublics();
    if (url.pathname.startsWith('/journal/')) return this.journalAjout(req, url);
    if (url.pathname.startsWith('/propositions')) return this.propositions(req, url);
    if (url.pathname.startsWith('/forum/')) return forumRoute(this, req, url);
    if (url.pathname === '/auth' || url.pathname === '/moi' || url.pathname === '/vitrine' || url.pathname === '/vitrine-badges' || url.pathname === '/reglage-profil' || url.pathname === '/defis' || url.pathname === '/titre' || url.pathname === '/araignee' || url.pathname === '/cache' || url.pathname === '/fiche' || url.pathname === '/quotidien' || url.pathname === '/arcade' || url.pathname === '/arcade/coffre' || url.pathname === '/boutique' || url.pathname === '/classement-quiz' || url.pathname === '/shoot/debut' || url.pathname === '/shoot/fin' || url.pathname === '/reliques' || url.pathname === '/reliques/recuperer' || url.pathname.startsWith('/profil/')) return this.compte(req, url);
    return json({erreur: 'inconnu'}, {}, 404);
  }
  etat() {
    return {enLigne: this.users.size, enFile: this.file.length, parties: this.parties.size, partiesJouees: this.nbJouees, orActif: this.reglage('pause', '0') !== '1'};
  }
  classement(survie) {
    const l = this.sql.exec(survie ? 'SELECT * FROM joueurs WHERE sv_parties>0 AND banni=0 ORDER BY sv_victoires DESC, sv_parties ASC LIMIT 300'
      : 'SELECT * FROM joueurs WHERE parties>0 AND banni=0 ORDER BY victoires DESC, parties ASC LIMIT 300').toArray();
    return json({maj: Date.now(), minimumRatio: 10, joueurs: l.map(j => { const n = survie ? j.sv_parties : j.parties, w = survie ? j.sv_victoires : j.victoires;
      return {pseudo: j.nom, login: j.login, avatar: j.prive ? '' : (j.avatar || ''), titre: this.titreDe(j), cosm: cosmDe(j), parties: n, victoires: w, ratio: Math.round(1000 * w / n) / 10}; })});
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
    if (act === 'remettre' && login) { this.run('UPDATE joueurs SET parties=0, victoires=0, defaites=0, nuls=0, sv_parties=0, sv_victoires=0, sv_defaites=0, sv_nuls=0 WHERE login=?', login); return json({ok: true}); }
    if (act === 'supprimer' && login) { const jj = this.un('SELECT id FROM joueurs WHERE login=?', login); if (jj) { this.run('DELETE FROM succes WHERE joueur=?', jj.id); this.run('DELETE FROM visites WHERE joueur=?', jj.id); } this.run('DELETE FROM joueurs WHERE login=?', login); return json({ok: true}); }
    if (act === 'rejouer-paiements') { await this.traiterPaiements(true); return json({ok: true}); }
    if (act === 'importer-journal') return this.importerJournal(b);
    if (act === 'propositions') return json(this.sql.exec(`SELECT p.n, p.saison, p.part, p.kind, p.texte, p.ts, p.statut, j.nom AS pseudo, j.login, (SELECT COUNT(*) FROM votes v WHERE v.prop=p.n) AS votes
      FROM propositions p JOIN joueurs j ON j.id=p.joueur ORDER BY p.n DESC LIMIT 300`).toArray());
    if (act === 'proposition' && Number.isInteger(b.n)) {
      if (b.supprimer) { this.run('DELETE FROM votes WHERE prop=?', b.n); this.run('DELETE FROM propositions WHERE n=?', b.n); return json({ok: true}); }
      if (['ouverte', 'retenue', 'refusee', 'masquee'].includes(b.statut)) { this.run('UPDATE propositions SET statut=? WHERE n=?', b.statut, b.n); return json({ok: true}); }
    }
    if (act === 'defis') return json({defis: this.sql.exec(`SELECT d.*, (SELECT COUNT(*) FROM succes s WHERE s.kind='defi' AND s.cle=CAST(d.n AS TEXT)) AS reussis FROM defis d ORDER BY d.debut DESC, d.n DESC LIMIT 100`).toArray(),
      cartesLive7j: this.un('SELECT COUNT(*) AS c FROM journal_cartes WHERE ts>?', Date.now() - 7 * 86400e3).c, usagesLive7j: this.un('SELECT COUNT(*) AS c FROM journal_usages WHERE ts>?', Date.now() - 7 * 86400e3).c});
    if (act === 'defi') {
      if (Number.isInteger(b.n) && b.supprimer) { this.run('DELETE FROM defis WHERE n=?', b.n); this.run(`DELETE FROM succes WHERE (kind='defi' AND cle=?) OR (kind='badge' AND cle=?)`, String(b.n), 'defi-' + b.n); return json({ok: true}); }
      const t = String(b.titre || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60), ty = String(b.type || '');
      const dj = /^\d{4}-\d{2}-\d{2}$/.test(b.debut_jour || '') && parisMs(b.debut_jour), fj = /^\d{4}-\d{2}-\d{2}$/.test(b.fin_jour || '') && parisMs(b.fin_jour, true);
      if (!t || !TYPES_DEFI.includes(ty) || !dj || !fj || fj <= dj) return json({erreur: 'champs'}, {}, 400);
      const c = Math.max(1, Math.min(1000, parseInt(b.cible, 10) || 1)), sa = String(b.saison || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
      const rt = String(b.rec_titre || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40), bn = String(b.b_nom || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 30);
      const bi = ICONES.includes(b.b_ico) ? b.b_ico : 'star', bt = TIERS.includes(b.b_tier) ? b.b_tier : 'argent', de = String(b.descr || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
      if (Number.isInteger(b.n)) this.run('UPDATE defis SET titre=?,descr=?,type=?,cible=?,saison=?,debut=?,fin=?,rec_titre=?,b_nom=?,b_ico=?,b_tier=?,secret=?,actif=? WHERE n=?', t, de, ty, c, sa, dj, fj, rt, bn, bi, bt, b.secret ? 1 : 0, b.actif === false ? 0 : 1, b.n);
      else this.run('INSERT INTO defis(titre,descr,type,cible,saison,debut,fin,rec_titre,b_nom,b_ico,b_tier,secret,actif) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', t, de, ty, c, sa, dj, fj, rt, bn, bi, bt, b.secret ? 1 : 0, b.actif === false ? 0 : 1);
      return json({ok: true});
    }
    if (act === 'donner' && login) {        // remet à la main un titre ou les récompenses d'un défi (défis « manuel », cadeaux, événements)
      const j = this.un('SELECT * FROM joueurs WHERE login=?', login);
      if (!j) return json({erreur: 'inconnu'}, {}, 404);
      if (Number.isInteger(b.defi)) { const d = this.un('SELECT * FROM defis WHERE n=?', b.defi); if (!d) return json({erreur: 'defi'}, {}, 404); this.donner(j, d, 'admin'); return json({ok: true}); }
      const rt = String(b.titre || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
      if (!rt) return json({erreur: 'champs'}, {}, 400);
      this.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'titre', rt, Date.now(), 'admin'); return json({ok: true});
    }
    if (act === 'fiches') return json(this.sql.exec(`SELECT login, nom, fiche FROM joueurs WHERE fiche!='{}' ORDER BY vu DESC LIMIT 300`).toArray().map(r => ({login: r.login, pseudo: r.nom, ...this.ficheDe(r)})).filter(f => f.jeu || f.devise));
    if (act === 'fiche-effacer' && login) { this.run(`UPDATE joueurs SET fiche=json_set(COALESCE(NULLIF(fiche,''),'{}'),'$.jeu','','$.devise','') WHERE login=?`, login); return json({ok: true}); }
    if (act === 'journal-etat') return json({cartes: this.un('SELECT COUNT(*) AS c FROM journal_cartes').c, usages: this.un('SELECT COUNT(*) AS c FROM journal_usages').c,
      dernieres: this.sql.exec('SELECT ts,pseudo,carte,src FROM journal_cartes ORDER BY n DESC LIMIT 10').toArray()});
    if (act === 'a-donner') { const jj = this.un('SELECT id FROM joueurs WHERE login=?', String(b.login || '').toLowerCase()); const c = ARCADE.find(x => x[0] === b.carte); if (!jj || !c) return json({erreur: 'inconnu'}, {}, 404); this.run(`INSERT OR IGNORE INTO acartes(joueur,carte,ts,src) VALUES(?,?,?,?)`, jj.id, c[0], Date.now(), 'admin'); return json({ok: true}); }
    if (act === 'a-tirage' && b.login) { const jj = this.un('SELECT id FROM joueurs WHERE login=?', String(b.login).toLowerCase()); if (!jj) return json({erreur: 'inconnu'}, {}, 404); aTirage(this, jj.id, 'test-' + Date.now()); return json({ok: true}); }
    if (act.startsWith('q-')) { const r = await qAdmin(this, act, b); if (r) return r; }
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
      case 'file': return this.rejoindreFile(u, m.mode);
      case 'defi': return this.creerDefi(u, m.mode);
      case 'objet': return this.objetDemande(u, m);
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
    const bj = this.badgesDe(j), fi = this.ficheDe(j); return {...base, fiche: fi, ficheBadge: this.succesDe(j).filter(x => x.id === fi.badge), titre: this.titreDe(j), badgesInfo: this.succesDe(j).filter(x => bj.includes(x.id)), vitrine: this.vitrineDe(j), serie: qSerie(this, j.id).serie, cosm: cosmDe(j), reliques: relEtat(this, j).reliques, score: ptsScore(this, j.id), cree: j.cree || 0, pstats: (() => { const e = ptsEtat(this, j); return {score: e.score, rang: e.rang, victoires: e.victoires, parties: e.parties, serie: e.serie, meilleure: e.meilleure, arcade: e.arcade}; })(), arcade: this.sql.exec("SELECT carte FROM acartes WHERE joueur=? AND carte NOT IN ('la-cle-ancienne','le-coffre-ferme') ORDER BY ts", j.id).toArray().map(r => r.carte), badges: bj, parties: j.parties, victoires: j.victoires, ratio: j.parties ? Math.round(1000 * j.victoires / j.parties) / 10 : null};
  }
  async compte(req, url) {
    const p = url.pathname;
    if (p.startsWith('/profil/')) {
      const login = decodeURIComponent(p.slice(8)).toLowerCase().slice(0, 40);
      const j = this.un('SELECT * FROM joueurs WHERE login=? AND banni=0', login);
      return j ? json(this.profilPublic(j)) : json({erreur: 'inconnu'}, {}, 404);
    }
    if (p === '/classement-quiz') return json(ptsClassementVue(this));
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
      const j2 = this.joueur(info.id); this.visite(j2); this.evaluer(j2);
      const mj = this.moi(this.joueur(info.id)); mj.solde = await this.solde(mj.login);
      return json({session: sess, moi: mj});
    }
    const j = await this.lireSession(req);
    if (!j) return json({erreur: 'session'}, {}, 401);
    this.visite(j); qCloture(this);
    if (p === '/boutique') return bqRoute(this, j, req);
    if (p === '/moi') { this.evaluer(j); ptsPaliers(this, j.id); const mj = this.moi(j); mj.solde = await this.solde(mj.login); return json({moi: mj}); }
    if (p === '/defis') { this.evaluer(j); return json(this.defisPour(j)); }
    if (p === '/titre' && req.method === 'POST') {
      let b = {}; try { b = await req.json(); } catch (x) {}
      const t = String(b.titre || '').slice(0, 40);
      if (t && !this.un(`SELECT 1 AS x FROM succes WHERE joueur=? AND kind='titre' AND cle=?`, j.id, t)) return json({erreur: 'titre'}, {}, 400);
      this.run('UPDATE joueurs SET titre=? WHERE id=?', t, j.id);
      return json({ok: true, titre: t});
    }
    if (p === '/cache' && req.method === 'POST') {          // badge secret « Cache-Cache » : les 6 Balises cachées sur les pages du site
      let b = {}; try { b = await req.json(); } catch (x) {}
      const PAGES = ['accueil', 'planning', 'collection', 'collectionneurs', 'classement', 'apropos'];
      (Array.isArray(b.pages) ? b.pages : []).filter(x => PAGES.includes(x)).forEach(x => this.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'cache', x, Date.now(), 'secret'));
      const pages = this.cacheDe(j), deja = !!this.un(`SELECT 1 AS x FROM succes WHERE joueur=? AND kind='badge' AND cle='cachecache'`, j.id);
      let nouveau = false;
      if (pages.length >= PAGES.length && !deja) { this.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'badge', 'cachecache', Date.now(), 'secret'); nouveau = true; }
      return json({ok: true, pages, nouveau, badge: deja || nouveau});
    }
    if (p === '/araignee' && req.method === 'POST') {        // badge secret : l'araignée écrasée sur le site
      const deja = !!this.un(`SELECT 1 AS x FROM succes WHERE joueur=? AND kind='badge' AND cle='araignee'`, j.id);
      if (!deja) this.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'badge', 'araignee', Date.now(), 'secret');
      return json({ok: true, nouveau: !deja});
    }
    if (p === '/fiche' && req.method === 'POST') {       // fiche de collectionneur : carte, jeu et badge favoris, devise, couleur du cadre
      let b = {}; try { b = await req.json(); } catch (x) {}
      const f = this.ficheDe({fiche: JSON.stringify(b)});
      this.run('UPDATE joueurs SET fiche=? WHERE id=?', JSON.stringify(f), j.id);
      return json({ok: true, fiche: f});
    }
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
    if (p === '/quotidien') return qQuotidien(this, j, req, url);
    if (p === '/arcade') return aArcade(this, j, req);
    if (p === '/arcade/coffre' && req.method === 'POST') return aCoffre(this, j);
    if (p === '/reliques') return json(relEtat(this, j));
    if (p === '/reliques/recuperer' && req.method === 'POST') return relRecuperer(this, j);
    if (p === '/shoot/debut' && req.method === 'POST') return shootDebut(this, j);
    if (p === '/shoot/fin' && req.method === 'POST') return shootFin(this, j, req);
    return json({erreur: 'inconnu'}, {}, 404);
  }
  cacheDe(j) { return this.sql.exec(`SELECT cle FROM succes WHERE joueur=? AND kind='cache' ORDER BY ts`, j.id).toArray().map(r => r.cle); }
  moi(j) {
    const jour = jourParis();
    return {...relEtat(this, j), id: j.id, login: j.login, pseudo: j.nom, avatar: j.avatar || '', vitrine: this.vitrineDe(j), badges: this.badgesDe(j), prive: !!j.prive, titre: this.titreDe(j), titres: this.titresDe(j), succes: this.succesDe(j), visites: this.nbVisites(j), fiche: this.ficheDe(j), cache: this.cacheDe(j), cosm: cosmDe(j), points: ptsEtat(this, j), cree: j.cree || 0,
      jeu: {parties: j.parties, victoires: j.victoires, defaites: j.defaites, nuls: j.nuls, orTotal: j.or_total, victoiresOrAujourdhui: j.jour === jour ? j.gains_jour : 0,
        ratio: j.parties ? Math.round(1000 * j.victoires / j.parties) / 10 : null, rang: this.rangs(j), maxJour: this.C.maxJour, minimumRatio: 10,
        survie: {parties: j.sv_parties || 0, victoires: j.sv_victoires || 0, defaites: j.sv_defaites || 0, nuls: j.sv_nuls || 0}}};
  }

  // ----- défis, titres, badges spéciaux -----
  ficheDe(j) {
    let f = {}; try { f = JSON.parse(j.fiche || '{}') || {}; } catch (e) {}
    const txt = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
    return {carte: /^((s\d+|halloween)-\d{1,3}|tarot-\d{1,2})$/.test(f.carte || '') ? f.carte : '', jeu: txt(f.jeu, 40), badge: /^[a-z0-9-]{2,24}$/.test(f.badge || '') ? f.badge : '',
      devise: txt(f.devise, 60), cadre: ['or', 'rouge', 'bleu', 'argent'].includes(f.cadre) ? f.cadre : 'or'};
  }
  titresDe(j) {
    const t = this.sql.exec(`SELECT cle FROM succes WHERE joueur=? AND kind='titre' ORDER BY ts`, j.id).toArray().map(r => r.cle);
    const last = this.un('SELECT top FROM qsemaines WHERE sem=?', semaineDe(jourParis()) - 1);   // le 1er de la semaine passée garde ce titre jusqu'au lundi suivant
    if (last) { try { const top = JSON.parse(last.top); if (top[0] && top[0].id === j.id) t.push('Champion de la semaine'); } catch (e) {} }
    return t;
  }
  titreDe(j) { return j.titre && this.titresDe(j).includes(j.titre) ? j.titre : ''; }
  succesDe(j) {
    const out = [];
    this.sql.exec(`SELECT cle, ts FROM succes WHERE joueur=? AND kind='badge' ORDER BY ts`, j.id).toArray().forEach(r => {
      if (r.cle === 'balise') { out.push({id: 'balise', nom: 'Gardien de la Balise', desc: 'Tu es revenu sur le site 10 jours différents : la Balise veille sur toi.', ico: 'balise', tier: 'or', cat: 'Fidélité', ts: r.ts}); return; }
      if (r.cle === 'cachecache') { out.push({id: 'cachecache', nom: 'Cache-Cache', desc: 'Tu as retrouvé les 6 Balises cachées sur les pages du site.', ico: 'balise', tier: 'epique', cat: 'Secrets', ts: r.ts}); return; }
      if (r.cle === 'clubishoot') { out.push({id: 'clubishoot', nom: 'Maître du Clubi Shoot', desc: 'Tu as trouvé le jeu le mieux caché du site et vaincu toutes les araignées.', ico: 'clubishoot', tier: 'mythique', cat: 'Secrets', ts: r.ts}); return; }
      if (r.cle === 'coffre') { out.push({id: 'coffre', nom: 'Ouvrir le Coffre', desc: 'Tu as trouvé le coffre caché sur le site et tu l\'as ouvert.', ico: 'key', tier: 'epique', cat: 'Secrets', ts: r.ts}); return; }
      if (r.cle === 'serie3') { out.push({id: 'serie3', nom: 'Série de 3', desc: 'Tu as terminé le Jeu du jour 3 jours de suite.', ico: 'flame', tier: 'bronze', cat: 'Jeu du jour', ts: r.ts}); return; }
      if (r.cle === 'serie7') { out.push({id: 'serie7', nom: 'Une semaine de flamme', desc: 'Tu as terminé le Jeu du jour 7 jours de suite.', ico: 'flame', tier: 'or', cat: 'Jeu du jour', ts: r.ts}); return; }
      if (r.cle === 'serie30') { out.push({id: 'serie30', nom: 'Inarrêtable', desc: 'Tu as tenu une série de 30 jours au Jeu du jour.', ico: 'flame', tier: 'mythique', cat: 'Secrets', ts: r.ts}); return; }
      if (r.cle === 'araignee') { out.push({id: 'araignee', nom: 'Arachnophobe', desc: 'Tu as écrasé l\'araignée qui rôdait sur le site. Mais elles étaient plusieurs… cherche du côté du logo.', ico: 'spider', tier: 'epique', cat: 'Secrets', ts: r.ts}); return; }
      const bqb = bqBadge(r.cle); if (bqb) { out.push({...bqb, ts: r.ts}); return; }
      const d = this.un('SELECT * FROM defis WHERE n=?', Number(String(r.cle).replace('defi-', '')));
      if (d && d.b_nom) out.push({id: r.cle, nom: d.b_nom, desc: d.descr || d.titre, ico: d.b_ico, tier: d.b_tier, cat: d.fin - d.debut > 20 * 86400e3 ? 'Événements' : 'Défis', ts: r.ts});
    });
    return out;
  }
  titresPublics() {
    const t = {};
    this.sql.exec(`SELECT id, login, nom, titre FROM joueurs WHERE titre!='' AND prive=0 AND banni=0 LIMIT 2000`).toArray().forEach(r => {
      if (!this.titresDe(r).includes(r.titre)) return;
      t[String(r.login).toLowerCase()] = r.titre; t[String(r.nom || '').toLowerCase()] = r.titre;
    });
    return json({t});
  }
  nbVisites(j) { return this.un('SELECT COUNT(*) AS c FROM visites WHERE joueur=?', j.id).c; }
  visite(j) { try { this.run('INSERT OR IGNORE INTO visites(joueur,jour) VALUES(?,?)', j.id, jourParis()); } catch (e) {} }
  progres(d, j) {
    if (d.type === 'manuel') return 0;
    const a = j.login, b = String(j.nom || '').toLowerCase(), t0 = d.debut, t1 = d.fin;
    const w = `ts>0 AND ts>=? AND ts<? AND lower(pseudo) IN (?,?)`;
    const s = d.saison ? ` AND carte LIKE ?` : '', args = d.saison ? [t0, t1, a, b, d.saison + '-%'] : [t0, t1, a, b];
    if (d.type === 'cartes') return this.un(`SELECT COUNT(*) AS c FROM journal_cartes WHERE ${w}${s}`, ...args).c;
    if (d.type === 'differentes') return this.un(`SELECT COUNT(DISTINCT carte) AS c FROM journal_cartes WHERE ${w}${s}`, ...args).c;
    if (d.type === 'usages') return this.un(`SELECT COUNT(*) AS c FROM journal_usages WHERE ts>0 AND ts>=? AND ts<? AND lower(pseudo) IN (?,?)`, t0, t1, a, b).c;
    if (d.type === 'visites') return this.un(`SELECT COUNT(*) AS c FROM visites WHERE joueur=? AND jour>=? AND jour<=?`, j.id, JOURJ(t0), JOURJ(t1 - 1)).c;
    if (d.type === 'parties') return this.un(`SELECT COALESCE(SUM(parties),0) AS c FROM paires WHERE (a=? OR b=?) AND jour>=? AND jour<=?`, j.id, j.id, JOURJ(t0), JOURJ(t1 - 1)).c;
    return 0;
  }
  donner(j, d, src) {        // remet les récompenses d'un défi (une seule fois)
    const now = Date.now();
    this.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'defi', String(d.n), now, src || 'auto');
    if (d.rec_titre) this.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'titre', d.rec_titre, now, 'defi-' + d.n);
    if (d.b_nom) this.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'badge', 'defi-' + d.n, now, 'defi-' + d.n);
  }
  evaluer(j) {       // un défi réussi pendant sa période est validé tout seul, même si le viewer revient plus tard
    const now = Date.now();
    if (this.nbVisites(j) >= 10) this.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'badge', 'balise', now, 'fidelite');
    this.sql.exec('SELECT * FROM defis WHERE actif=1 AND type!=\'manuel\' AND debut<=?', now).toArray().forEach(d => {
      if (this.un(`SELECT 1 AS x FROM succes WHERE joueur=? AND kind='defi' AND cle=?`, j.id, String(d.n))) return;
      if (this.progres(d, j) >= d.cible) this.donner(j, d, 'auto');
    });
  }
  defisPour(j) {
    const now = Date.now(), out = [];
    this.sql.exec('SELECT * FROM defis WHERE actif=1 ORDER BY debut DESC, n DESC LIMIT 60').toArray().forEach(d => {
      const fait = !!this.un(`SELECT 1 AS x FROM succes WHERE joueur=? AND kind='defi' AND cle=?`, j.id, String(d.n));
      const etat = now < d.debut ? 'a_venir' : now >= d.fin ? 'termine' : 'en_cours';
      if (d.secret && !fait) return;
      if (etat === 'termine' && !fait && now - d.fin > 14 * 86400e3) return;
      if (etat === 'a_venir' && d.debut - now > 7 * 86400e3) return;
      out.push({n: d.n, titre: d.titre, descr: d.descr, type: d.type, cible: d.cible, saison: d.saison, debut: d.debut, fin: d.fin, etat, fait,
        progres: etat === 'a_venir' ? 0 : fait ? d.cible : Math.min(d.cible, this.progres(d, j)), rec_titre: d.rec_titre,
        badge: d.b_nom ? {nom: d.b_nom, ico: d.b_ico, tier: d.b_tier} : null});
    });
    return {defis: out, titres: this.titresDe(j), titre: this.titreDe(j), maintenant: now};
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
      const c = this.sql.exec('SELECT pseudo,carte,ts FROM journal_cartes ORDER BY n').toArray().map(r => [r.pseudo, r.carte, r.ts]);
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
      victoiresOrAujourdhui: j.jour === jour ? j.gains_jour : 0, rang: this.un('SELECT COUNT(*)+1 AS r FROM joueurs WHERE victoires>? AND banni=0', j.victoires).r,
      survie: {parties: j.sv_parties || 0, victoires: j.sv_victoires || 0, defaites: j.sv_defaites || 0, nuls: j.sv_nuls || 0,
        rang: this.un('SELECT COUNT(*)+1 AS r FROM joueurs WHERE sv_victoires>? AND banni=0', j.sv_victoires || 0).r}};
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
  rejoindreFile(u, jeu) {
    if (u.game && !u.game.fini) return;
    this.annuler(u, true);
    const jm = jeu === 'survie' ? 'survie' : 'classique'; u.fm = jm;
    const i = this.file.findIndex(id => { const o = this.users.get(id); return id !== u.id && o && o.ws && o.ws.readyState === 1 && !o.game && o.fm === jm; });
    if (i >= 0) { const o = this.users.get(this.file.splice(i, 1)[0]); this.lancer(o, u, 'file', jm); }
    else { this.file.push(u.id); this.envoyer(u.ws, {t: 'attente', mode: 'file', jeu: jm}); }
    this.diffuser();
  }
  creerDefi(u, jeu) {
    if (u.game && !u.game.fini) return;
    const jm = jeu === 'survie' ? 'survie' : 'classique';
    this.annuler(u, true);
    const al = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code;
    do { code = Array.from({length: 6}, () => al[Math.floor(rng() * al.length)]).join(''); } while (this.defis.has(code));
    this.defis.set(code, {id: u.id, exp: Date.now() + 15 * 60 * 1000, jm}); u.defi = code;
    this.envoyer(u.ws, {t: 'attente', mode: 'defi', code, jeu: jm});
  }
  rejoindreDefi(u, code) {
    if (u.game && !u.game.fini) return;
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    const d = this.defis.get(code), o = d && this.users.get(d.id);
    if (!d || d.exp < Date.now() || !o || !o.ws || o.game) { this.defis.delete(code); this.envoyer(u.ws, {t: 'erreur', code: 'defi_inconnu'}); return; }
    if (o.id === u.id) { this.envoyer(u.ws, {t: 'erreur', code: 'defi_soi_meme'}); return; }
    this.defis.delete(code); o.defi = null; this.annuler(u, true);
    this.lancer(o, u, 'defi', d.jm);
  }

  // ----- une partie -----
  lancer(a, b, mode, jm) {
    const opts = J.reglages({seconds: this.C.tour});
    let M = null, S;
    if (jm === 'survie') { M = J.nouveauMatch(opts, rng); S = J.lancerManche(M); } else S = J.nouvellePartie(opts, rng);
    [S.pioche, S.hands[0], S.hands[1]].forEach(l => l.forEach(c => { c.id = rid(); }));   // identifiants secrets : ils ne révèlent rien sur la carte
    const g = {id: rid(4), S, M, joueurs: [a.id, b.id], noms: [a.nom, b.nom], logins: [a.login, b.login], mode, timeouts: [0, 0], deco: [false, false],
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
      pioche: S.pioche.length + S.defausse.length, adversaire: {pseudo: g.noms[1 - s]}, ...this.vueSurvie(g)};
  }
  vueSurvie(g) {          // informations propres au mode Survie (inventaires, manches) : tout est public
    if (!g.M) return {};
    const M = g.M; return {jeu: 'survie', manche: M.manche, wins: M.wins, recu: M.recu, bonus: M.bonus, sv: J.vueSv(g.S)};
  }
  etatVue(g, v) {         // photographie de la partie vue par le joueur v (sa main est complète, celle de l'adversaire reste cachée sauf Œil)
    const S = g.S, oeil = S.sv && S.sv.vu[v];
    return {tour: S.turn, scores: S.scores, plateau: S.board.map(b => b.map(col => col.map(pub))), main: S.hands[v].map(pub), adv: S.hands[1 - v].map(oeil ? pub : blanc),
      pioche_n: S.pioche.length + S.defausse.length, sv: J.vueSv(S), tours: S.tours, timeouts: g.timeouts};
  }
  vueReprise(g, s) {
    const S = g.S;
    return {t: 'reprise', partie: g.id, mode: g.mode, siege: s, premier: S.first, regles: this.regles(S), tour: S.turn, reste: Math.max(0, g.deadline - Date.now()),
      plateau: S.board.map(b => b.map(col => col.map(pub))), main: S.hands[s].map(pub), adv: S.hands[1 - s].map(blanc),
      pioche: S.pioche.length + S.defausse.length, scores: S.scores, timeouts: g.timeouts, tours: S.tours, adversaire: {pseudo: g.noms[1 - s]}, ...this.vueSurvie(g),
      ...(g.M && S.sv.vu[s] ? {adv: S.hands[1 - s].map(pub)} : {})};
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
    [0, 1].forEach(v => this.envoyer(this.users.get(g.joueurs[v])?.ws, {...base, pioche: res.pioche ? (v === s ? pub(res.pioche) : blanc(res.pioche)) : null,
      ...(g.M ? {tour: S.turn, sv: J.vueSv(S), parade: !!res.parade, main: S.hands[v].map(pub), adv: S.hands[1 - v].map(blanc), perdue: res.perdue ? pub(res.perdue) : null} : {})}));
    if (res.fin) { if (g.M) this.finManche(g); else this.finir(g, 'normal'); } else this.armer(g);
  }
  // ----- mode Survie : utiliser un objet, fin de manche -----
  objetDemande(u, m) {
    const g = u.game; if (!g || g.fini || !g.M) return;
    const s = g.joueurs.indexOf(u.id), S = g.S, i = Number.isInteger(m.i) ? m.i : -1;
    if (S.turn !== s || i < 0) { this.envoyer(u.ws, {t: 'erreur', code: 'objet_invalide'}); this.envoyer(u.ws, this.vueReprise(g, s)); return; }
    const r = J.utiliser(S, s, i, m.cible == null ? null : m.cible);
    if (!r.ok) { this.envoyer(u.ws, {t: 'erreur', code: 'objet_invalide'}); this.envoyer(u.ws, this.vueReprise(g, s)); return; }
    if (r.attente === 'ordre') { this.envoyer(u.ws, {t: 'prophetie', i, cartes: r.cartes.map(pub)}); return; }
    const info = {t: 'objet', p: s, obj: r.obj, i, cible: r.cible || null, detruites: (r.detruites || []).map(x => x.c.id), parade: !!r.parade, valeur: r.valeur || 0,
      pile: r.pile == null ? null : !!r.pile, n: r.n || 0, jetees: r.jetees || 0, fin: !!r.fin};
    [0, 1].forEach(v => this.envoyer(this.users.get(g.joueurs[v])?.ws, {...info, ...this.etatVue(g, v), ...(r.pris ? {pris: v === s ? pub(r.pris) : blanc(r.pris)} : {})}));
    if (r.fin) this.finManche(g);
  }
  finManche(g) {
    const M = g.M, S = g.S; clearTimeout(g.timer);
    J.finManche(M);
    const prec = {gagnant: S.winner, scores: S.scores.slice(), manche: M.manche};
    if (M.fini) { S.winner = M.gagnant; this.finir(g, 'normal'); return; }
    const N = J.lancerManche(M); g.S = N; g.seq++;
    [N.pioche, N.hands[0], N.hands[1]].forEach(l => l.forEach(c => { c.id = rid(); }));
    g.timeouts = [0, 0];
    [0, 1].forEach(v => this.envoyer(this.users.get(g.joueurs[v])?.ws, {...this.vueDebut(g, v), t: 'manche', precedente: prec}));
    this.armer(g, 14);
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
        const col = w === -1 ? 'nuls' : (w === s ? 'victoires' : 'defaites'), t = g.M ? 'sv_' : '';
        this.run(`UPDATE joueurs SET ${t}parties=${t}parties+1, ${t}${col}=${t}${col}+1 WHERE id=?`, g.joueurs[s]);
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
        or: {gain: w === s ? gain : 0, raison: motifOr}, moi: this.fiche(g.joueurs[s]), orPlafond: this.C.maxJour,
        ...(g.M ? {jeu: 'survie', wins: g.M.wins, histo: g.M.histo} : {})});
    });
    // nettoyage
    [0, 1].forEach(s => { const u = this.users.get(g.joueurs[s]); if (u) { u.game = null; if (!u.ws) this.users.delete(u.id); } });
    this.parties.delete(g.id); this.diffuser();
    if (paiement) this.payer(paiement).catch(e => console.log('paiement', e && e.message));
  }

  // ----- solde ClubiGold (lu chez WizeBot ; facultatif : tant que WIZEBOT_SOLDE_URL n'est pas renseignée, le site n'affiche que les ClubiGold gagnés au jeu) -----
  async solde(login) {
    const tpl = String(this.env.WIZEBOT_SOLDE_URL || '').trim();
    let cle = String(this.env.WIZEBOT_KEY || '').trim(); const mc = cle.match(/(?:custom-alerts|currency)\/([^\/\s]+)/); if (mc) cle = mc[1];
    if (!tpl || !cle) return null;
    this.soldes = this.soldes || new Map();
    const c = this.soldes.get(login); if (c && Date.now() - c.t < 60000) return c.v;
    let v = null;
    try {
      const r = await fetch(tpl.replace('{cle}', encodeURIComponent(cle)).replace('{login}', encodeURIComponent(login)), {signal: AbortSignal.timeout(4000)});
      if (r.ok) {
        const txt = (await r.text()).trim();
        const cherche = (o, d) => {
          if (typeof o === 'number') return o;
          if (typeof o === 'string' && /^-?\d+(\.\d+)?$/.test(o.trim())) return Number(o);
          if (!o || typeof o !== 'object' || d > 3) return null;
          for (const k of ['amount', 'balance', 'value', 'points', 'currency', 'total', 'quantity', 'count', 'data', 'result']) if (k in o) { const x = cherche(o[k], d + 1); if (x != null) return x; }
          for (const k of Object.keys(o)) { const x = cherche(o[k], d + 1); if (x != null) return x; }
          return null;
        };
        let j = null; try { j = JSON.parse(txt); } catch (e) { j = txt; }
        const n = cherche(j, 0); if (n != null && isFinite(n) && n >= 0) v = Math.floor(n);
      }
    } catch (e) {}
    if (this.soldes.size > 500) this.soldes.clear();
    this.soldes.set(login, {v, t: Date.now()});
    return v;
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

// ---------- Jeu du jour (7 formats, un par jour de la semaine) ----------
const QFMT = {1: 'pixel', 2: 'anagramme', 3: 'emoji', 4: 'pendu', 5: 'motscles', 6: 'indices', 0: 'resume'};
const QPTS = [100, 85, 70, 55, 40];
const nrm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const joursDepuis = j => Math.floor(Date.parse(j + 'T12:00:00Z') / 86400000);
const fmtDuJour = j => QFMT[new Date(j + 'T12:00:00Z').getUTCDay()];
const listeSet = s => String(s || '').split(/[\/,;]/).map(x => nrm(x)).filter(Boolean);
function qPuzzle(h, jour) {
  const fmt = fmtDuJour(jour);
  let p = h.un(`SELECT * FROM puzzles WHERE fmt=? AND jour=?`, fmt, jour);
  if (!p) { const pool = h.sql.exec(`SELECT * FROM puzzles WHERE fmt=? AND jour='' ORDER BY n`, fmt).toArray(); if (pool.length) p = pool[Math.floor(joursDepuis(jour) / 7) % pool.length]; }
  return p ? {...p, fmt, data: JSON.parse(p.data || '{}')} : {fmt, vide: true};
}
function qAttrs(h, nom) { const r = h.un('SELECT * FROM qjeux WHERE nom=?', nom); return r || null; }
function qComparer(rep, g) {
  if (!rep || !g) return [];
  const m = (a, b) => { const x = listeSet(a), y = listeSet(b); if (!x.length || !y.length) return 'no'; const c = x.filter(v => y.includes(v)).length; return c === x.length && c === y.length ? 'ok' : c ? 'part' : 'no'; };
  return [
    {k: 'genre', v: g.genre || '?', s: m(g.genre, rep.genre)},
    {k: 'annee', v: g.annee || '?', s: g.annee === rep.annee ? 'ok' : 'no', dir: g.annee && rep.annee && g.annee !== rep.annee ? (rep.annee > g.annee ? 'up' : 'down') : ''},
    {k: 'studio', v: g.studio || '?', s: nrm(g.studio) && nrm(g.studio) === nrm(rep.studio) ? 'ok' : 'no'},
    {k: 'plateforme', v: g.plateforme || '?', s: m(g.plateforme, rep.plateforme)},
    {k: 'vue', v: g.vue || '?', s: nrm(g.vue) && nrm(g.vue) === nrm(rep.vue) ? 'ok' : 'no'}
  ];
}
function qMasque(nom, trouvees) {
  return [...String(nom)].map(c => { const n = nrm(c); return n ? (trouvees.has(n) ? c : '_') : c; }).join('');
}
function qResume(texte, erreurs, fini, graine) {
  // texte : [[mot]] = censuré, révélé petit à petit ; [[!mot]] = censuré jusqu'à la fin.
  // En plus (pour corser) : les noms propres au milieu d'une phrase et les nombres sont censurés d'office jusqu'à la fin.
  const brut = String(texte || '').split(/(\[\[!?[^\]]+\]\])/g), parts = [];
  let debut = true;
  brut.forEach(x => {
    if (/^\[\[!?[^\]]+\]\]$/.test(x)) { parts.push(x); debut = false; return; }
    x.split(/([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9'’\-]*)/g).forEach(t => {
      if (!t) return;
      if (/^[A-Za-zÀ-ÿ0-9]/.test(t)) {
        const nom = /^[A-ZÀ-Ý]/.test(t) && !debut && t.length > 2, nombre = /[0-9]/.test(t);
        parts.push(nom || nombre ? '[[!' + t + ']]' : t); debut = false;
      } else { parts.push(t); if (/[.!?:«\n]/.test(t)) debut = true; }
    });
  });
  const cachables = [];
  parts.forEach((x, i) => { const m = /^\[\[(!?)([^\]]+)\]\]$/.exec(x); if (m) cachables.push({i, fixe: !!m[1], mot: m[2]}); });
  const libres = cachables.filter(c => !c.fixe).map(c => c.i);
  let s = graine || 1; const alea = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  libres.sort(() => alea() - .5);
  // 1 erreur = un petit dixième des mots libérés (environ 40 % après 4 erreurs, au moins un mot dès la 1re erreur)
  const nb = fini ? libres.length : (erreurs > 0 ? Math.ceil(libres.length * Math.min(erreurs, 4) / 10) : 0);
  const ouverts = new Set(libres.slice(0, nb));
  return parts.map((x, i) => {
    const c = cachables.find(z => z.i === i); if (!c) return {t: x};
    // la longueur du mot n'est plus un indice : mêmes barres pour tous
    return (fini || ouverts.has(i)) ? {t: c.mot, r: 1} : {t: '█████', h: 1};
  });
}
const joursPlus = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const semaineDe = d => Math.floor((joursDepuis(d) + 3) / 7);
// Série du Jeu du jour : un jour compte dès que la partie est terminée (gagnée ou perdue). Un « joker » par semaine pardonne un jour manqué.
function qSerie(h, id) {
  const jours = h.sql.exec(`SELECT DISTINCT jour FROM qparties WHERE joueur=? AND fini=1 ORDER BY jour`, id).toArray().map(r => r.jour);
  const auj = jourParis(), jok = new Set(), sd = {}; let streak = 0, best = 0, last = null;
  for (const d of jours) {
    if (!last) streak = 1;
    else { const gap = joursDepuis(d) - joursDepuis(last); const manque = gap === 2 ? joursPlus(last, 1) : null;
      if (gap === 1) streak++; else if (manque && !jok.has(semaineDe(manque))) { jok.add(semaineDe(manque)); streak++; } else streak = 1; }
    sd[d] = streak; if (streak > best) best = streak; last = d;
  }
  let serie = 0;
  if (last) { const gap = joursDepuis(auj) - joursDepuis(last); if (gap <= 1 || (gap === 2 && !jok.has(semaineDe(joursPlus(auj, -1))))) serie = streak; }
  const pal = [3, 7, 15], prochain = serie < 15 ? pal.find(x => x > serie) : (Math.floor(serie / 15) + 1) * 15;
  return {serie, meilleure: Math.max(best, serie), sd, joker: !jok.has(semaineDe(auj)), prochain};
}
function qStats(h, j) {
  const rows = h.sql.exec(`SELECT jour, gagne, pts FROM qparties WHERE joueur=? AND essais!='[]' ORDER BY jour DESC`, j.id).toArray(), s = qSerie(h, j.id);
  return {serie: s.serie, meilleure: s.meilleure, joker: s.joker, prochain: s.prochain, jouees: rows.length, victoires: rows.filter(r => r.gagne).length, points: rows.reduce((a, r) => a + (r.pts || 0), 0)};
}
// récompenses de série : pioche bonus à 3 / 7 / 15 jours (puis tous les 15), badges 3 / 7 / 30
function qRecompenseSerie(h, id, jour) {
  const s = qSerie(h, id), n = s.sd[jour] || 0; let bonus = null;
  const pal = n >= 15 ? (n % 15 === 0 ? 15 : 0) : (n === 3 || n === 7 ? n : 0);
  if (pal) { const cle = jour + ':s' + pal; if (!h.un('SELECT 1 AS x FROM atirages WHERE joueur=? AND jour=?', id, cle)) { aTirage(h, id, cle, pal); bonus = {palier: pal, serie: n}; } }
  [[3, 'serie3'], [7, 'serie7'], [30, 'serie30']].forEach(([k, c]) => { if (n >= k) h.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, id, 'badge', c, Date.now(), 'serie'); });
  return bonus;
}
function qVue(h, j, p, pa) {
  const jour = jourParis(), ess = pa ? JSON.parse(pa.essais || '[]') : [], fmt = p.fmt;
  const erreurs = ess.filter(e => !e.ok).length, gagne = !!(pa && pa.gagne), fini = !!(pa && pa.fini);
  const out = {jour, fmt, max: 5, erreurs, fini, gagne, pts: pa ? pa.pts : 0, essais: ess, stats: qStats(h, j), demain: fmtDuJour(new Date(Date.parse(jour + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10))};
  if (p.vide) { out.vide = true; return out; }
  const d = p.data || {};
  if (fmt === 'pixel' || fmt === 'zoom') out.img = fini ? d.final : (d.stages || [])[Math.min(erreurs, (d.stages || []).length - 1)];
  if (fmt === 'silhouette') out.img = fini ? d.final : (d.stages || [])[Math.min(erreurs, (d.stages || []).length - 1)];
  if (fmt === 'emoji') { const e = d.emojis || []; out.emojis = fini ? e : e.slice(0, Math.min(e.length, 2 + erreurs)); out.total = e.length; }
  if (fmt === 'pendu') {
    const trouvees = new Set(ess.filter(e => e.ok).map(e => nrm(e.g)));
    out.masque = fini && !gagne ? p.jeu : qMasque(p.jeu, trouvees); out.lettres = ess.map(e => ({l: e.g, ok: e.ok})); if (d.indice && (fini || erreurs >= 3)) out.indice = d.indice;
  }
  if (fmt === 'indices') {
    const rep = qAttrs(h, p.jeu) || d.attrs || {}; const ordre = ['genre', 'annee', 'studio', 'plateforme', 'vue'], n = fini ? 5 : Math.min(5, 1 + erreurs);
    const lab = {genre: rep.genre, annee: rep.annee, studio: rep.studio, plateforme: rep.plateforme, vue: rep.vue};
    out.indices = ordre.slice(0, n).map(k => ({k, v: lab[k] || '?'}));
    out.essais = ess.map(e => ({...e, cmp: qComparer(rep, qAttrs(h, e.g))}));
  }
  if (fmt === 'anagramme') {
    const L = [...String(p.jeu)].map(c => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()).filter(c => /[A-Z0-9]/.test(c)), k = fini ? L.length : Math.min(erreurs, Math.max(0, L.length - 2));
    const reste = L.slice(k); let s = (p.n || 1) * 7919 + 13; const alea = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const m = reste.slice(); for (let i = m.length - 1; i > 0; i--) { const j = Math.floor(alea() * (i + 1)); [m[i], m[j]] = [m[j], m[i]]; }
    if (m.length > 1 && m.join('') === reste.join('')) m.push(m.shift());
    out.debut = L.slice(0, k).join(''); out.melange = fini ? [] : m;
    out.forme = String(p.jeu).split(/\s+/).map(x => [...x].filter(c => /[A-Za-z0-9\u00C0-\u017F]/.test(c)).length).filter(Boolean);
  }
  if (fmt === 'motscles') {
    const m = Array.isArray(d.mots) ? d.mots : [], n = fini ? m.length : Math.min(m.length, 1 + erreurs);
    out.mots = m.slice(0, n); out.totalMots = m.length;
  }
  if (fmt === 'resume') out.resume = qResume(d.texte, erreurs, fini, p.n * 7919);
  if (fini) out.reponse = {nom: p.jeu, img: (fmt === 'pixel' || fmt === 'zoom' || fmt === 'silhouette') ? undefined : (d.final || undefined)};
  return out;
}
const ARCADE = [['la-chevaliere-rouillee','u'], ['le-ronin-neon','c'], ['boulon-le-cueilleur','c'], ['le-renard-voyageur','c'], ['le-veilleur','r'], ['le-bourreau-a-la-cloche','r'], ['la-fillette-a-la-lanterne','c'], ['le-chasseur-a-la-lame-double','u'], ['le-pirate-fantome','c'], ['la-pilote-spatiale','c'], ['la-poupee-qui-rit','c'], ['le-loup-de-sang','u'], ['le-chat-cuisinier','c'], ['le-gamer-de-3-h-du-matin','c'], ['la-mere-des-corbeaux','r'], ['le-livreur-sauteur','c'], ['le-petit-chevalier-jardinier','c'], ['le-mineur-cubique','c'], ['le-docteur-du-manoir','u'], ['le-mannequin-qui-bouge','c'], ['le-gardien-au-sac','c'], ['la-cendreuse','u'], ['le-roi-sans-couronne','l'], ['la-dame-du-lac-noir','l'], ['l-archiviste-aveugle','c'], ['le-brule-du-brouillard','u'], ['le-pelerin-calcine','u'], ['le-veilleur-des-couloirs','u'], ['le-chasseur-de-cassettes','u'], ['le-geant-enchaine','l'], ['la-couturiere-d-ames','u'], ['la-sage-femme-aux-yeux-cousus','u'], ['le-phare','c'], ['le-manoir-hante','u'], ['la-chapelle-brulee','u'], ['le-chateau-perche','c'], ['la-foret-sans-retour','c'], ['la-salle-d-arcade-oubliee','c'], ['la-station-orbitale-silencieuse','c'], ['la-cathedrale-du-chasseur','u'], ['le-village-cubique','c'], ['l-ile-au-tresor-pixel','c'], ['le-donjon-final','r'], ['la-cave-du-sous-sol','c'], ['le-pont-des-geants','c'], ['la-ville-dans-le-brouillard','u'], ['l-hopital-abandonne','c'], ['le-commissariat-gothique','c'], ['la-cle-ancienne','r'], ['la-lanterne-d-ames','r'], ['le-coffre-ferme','s'], ['la-machine-a-ecrire','c'], ['la-manette-cassee','c'], ['le-grimoire-scelle','r'], ['la-potion-rouge','c'], ['la-piece-d-or-pixel','c'], ['le-coeur-de-cristal','r'], ['l-epee-geante','u'], ['la-cassette-de-sauvegarde','c'], ['le-bouclier-brise','c'], ['la-torche-eteinte','c'], ['le-medaillon-en-spirale','c'], ['la-disquette-maudite','c'], ['la-carte-au-tresor','c']];
const ARC_POIDS = {c: 50, u: 30, r: 15, l: 5};
function aAlea(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; }
function aPossedees(h, id) { return new Set(h.sql.exec('SELECT carte FROM acartes WHERE joueur=?', id).toArray().map(r => r.carte)); }
// 3 cartes tirées au hasard (jamais la secrète), de préférence des cartes que le joueur n'a pas encore
function aTirage(h, id, jour, palier) {
  if (h.un('SELECT 1 AS x FROM atirages WHERE joueur=? AND jour=?', id, jour)) return;
  const own = aPossedees(h, id), sel = [];
  const poids = palier === 15 ? {c: 0, u: 0, r: 75, l: 25} : palier === 7 ? {c: 20, u: 35, r: 35, l: 10} : ARC_POIDS;
  const ok = c => c[1] !== 's' && poids[c[1]] > 0;
  let pool = ARCADE.filter(c => ok(c) && !own.has(c[0]));
  if (pool.length < 3) pool = pool.concat(ARCADE.filter(c => ok(c) && own.has(c[0])));
  while (sel.length < 3 && pool.length) {
    const tot = pool.reduce((a, c) => a + poids[c[1]], 0); let x = aAlea(tot * 10) / 10, k = 0;
    for (; k < pool.length - 1; k++) { x -= poids[pool[k][1]]; if (x < 0) break; }
    sel.push(pool[k][0]); pool = pool.filter((_, i) => i !== k);
  }
  h.run('INSERT INTO atirages(joueur,jour,cartes,choix) VALUES(?,?,?,-1)', id, jour, JSON.stringify(sel));
}
function aAttente(h, id) { return h.sql.exec('SELECT COUNT(*) AS c FROM atirages WHERE joueur=? AND choix<0', id).toArray()[0].c; }
const ARCADE_DOUBLE_PTS = 50;
async function aArcade(h, j, req) {
  if (req.method === 'POST') {
    let b = {}; try { b = await req.json(); } catch (x) {}
    const t = h.un('SELECT * FROM atirages WHERE joueur=? AND choix<0 ORDER BY jour LIMIT 1', j.id), k = parseInt(b.choix, 10);
    if (!t) return json({erreur: 'aucun_tirage'}, {}, 400);
    if (!(k >= 0 && k < 3)) return json({erreur: 'choix'}, {}, 400);
    const cartes = JSON.parse(t.cartes), carte = cartes[k], nouvelle = !h.un('SELECT 1 AS x FROM acartes WHERE joueur=? AND carte=?', j.id, carte);
    h.run('INSERT OR IGNORE INTO acartes(joueur,carte,ts,src) VALUES(?,?,?,?)', j.id, carte, Date.now(), 'jeu');
    h.run('UPDATE atirages SET choix=? WHERE joueur=? AND jour=?', k, j.id, t.jour);
    // un double rapporte des points de boutique (jamais comptés au classement)
    let pts = 0; if (!nouvelle) { pts = ARCADE_DOUBLE_PTS; h.run('INSERT OR IGNORE INTO bonus(joueur,cle,pts,ts) VALUES(?,?,?,?)', j.id, 'double-' + t.jour, pts, Date.now()); }
    return json({ok: true, carte, nouvelle, choix: k, attente: aAttente(h, j.id), pts});
  }
  const cartes = h.sql.exec('SELECT carte, ts FROM acartes WHERE joueur=? ORDER BY ts', j.id).toArray();
  const t = h.un('SELECT jour FROM atirages WHERE joueur=? AND choix<0 ORDER BY jour LIMIT 1', j.id);
  return json({cartes, attente: aAttente(h, j.id), tirage: t ? {n: 3} : null, total: ARCADE.length});
}
// le coffre caché : s'ouvre seulement si le joueur possède la Clé Ancienne (rien ne le dit sur le site)
async function aCoffre(h, j) {
  const cle = !!h.un(`SELECT 1 AS x FROM acartes WHERE joueur=? AND carte='la-cle-ancienne'`, j.id);
  if (!cle) return json({ouvert: false});
  const nouvelle = !h.un(`SELECT 1 AS x FROM acartes WHERE joueur=? AND carte='le-coffre-ferme'`, j.id);
  h.run(`INSERT OR IGNORE INTO acartes(joueur,carte,ts,src) VALUES(?,?,?,?)`, j.id, 'le-coffre-ferme', Date.now(), 'coffre');
  const deja = !!h.un(`SELECT 1 AS x FROM succes WHERE joueur=? AND kind='badge' AND cle='coffre'`, j.id);
  if (!deja) h.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'badge', 'coffre', Date.now(), 'secret');
  return json({ouvert: true, nouvelle, badgeNouveau: !deja});
}
async function qQuotidien(h, j, req, url) {
  qCloture(h); const jour = jourParis(), p = qPuzzle(h, jour); let bonusSerie = null;
  let pa = h.un('SELECT * FROM qparties WHERE joueur=? AND jour=?', j.id, jour);
  if (req.method === 'POST') {
    if (p.vide) return json({erreur: 'vide'}, {}, 400);
    if (pa && pa.fini) return json({erreur: 'termine'}, {}, 400);
    let b = {}; try { b = await req.json(); } catch (x) {}
    const ess = pa ? JSON.parse(pa.essais || '[]') : [];
    let g = String(b.g == null ? '' : b.g).slice(0, 80), ok = false;
    if (p.fmt === 'pendu') {
      g = nrm(g).slice(0, 1).toUpperCase(); if (!/^[A-Z0-9]$/.test(g)) return json({erreur: 'lettre'}, {}, 400);
      if (ess.some(e => e.g === g)) return json({erreur: 'deja'}, {}, 400);
      ok = nrm(p.jeu).includes(g.toLowerCase());
    } else {
      const r = h.un('SELECT nom FROM qjeux WHERE nom=?', g) || h.sql.exec('SELECT nom FROM qjeux').toArray().find(x => nrm(x.nom) === nrm(g));
      if (!r) return json({erreur: 'inconnu'}, {}, 400);
      g = r.nom; if (ess.some(e => nrm(e.g) === nrm(g))) return json({erreur: 'deja'}, {}, 400);
      ok = nrm(g) === nrm(p.jeu);
    }
    ess.push({g, ok: ok ? 1 : 0});
    const erreurs = ess.filter(e => !e.ok).length;
    let gagne = ok ? 1 : 0;
    if (p.fmt === 'pendu' && !ok) gagne = 0;
    if (p.fmt === 'pendu' && ok) { const tr = new Set(ess.filter(e => e.ok).map(e => e.g.toLowerCase())); gagne = [...new Set(nrm(p.jeu))].every(c => tr.has(c)) ? 1 : 0; }
    const fini = gagne || erreurs >= 5 ? 1 : 0, pts = gagne ? QPTS[Math.min(erreurs, 4)] : 0;
    h.run(`INSERT INTO qparties(joueur,jour,fmt,puzzle,essais,fini,gagne,pts) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(joueur,jour) DO UPDATE SET essais=excluded.essais, fini=excluded.fini, gagne=excluded.gagne, pts=excluded.pts`, j.id, jour, p.fmt, p.n || 0, JSON.stringify(ess), fini, gagne, pts);
    pa = h.un('SELECT * FROM qparties WHERE joueur=? AND jour=?', j.id, jour);
    if (pa && pa.gagne) aTirage(h, j.id, jour);
    if (pa && pa.fini) { bonusSerie = qRecompenseSerie(h, j.id, jour); ptsPaliers(h, j.id); }
  }
  const v = qVue(h, j, p, pa);
  if (bonusSerie) v.bonus = bonusSerie;
  v.arcade = {attente: aAttente(h, j.id)}; v.points = ptsEtat(h, j);
  if (url.searchParams.get('jeux')) v.jeux = h.sql.exec('SELECT nom FROM qjeux ORDER BY nom COLLATE NOCASE').toArray().map(x => x.nom);
  return json(v);
}
// ---------- Points, classement, récompenses hebdo, boutique ----------
// « score » = points gagnés au Jeu du jour, cumulés, ne baisse jamais (sert au classement et aux paliers).
// « solde » = score moins ce qui a été dépensé en boutique.
const lundiDe = d => joursPlus(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
const PALIERS = [[500, 'pts500', 'Initié du Quiz'], [2000, 'pts2000', 'Expert du Quiz'], [5000, 'pts5000', 'Légende du Quiz']];
const BQ_BADGES = {
  pts500: {nom: 'Initié du Quiz', desc: 'Tu as cumulé 500 points au Jeu du jour.', ico: 'pts500', tier: 'bronze', cat: 'Jeu du jour'},
  pts2000: {nom: 'Expert du Quiz', desc: 'Tu as cumulé 2 000 points au Jeu du jour.', ico: 'pts2000', tier: 'or', cat: 'Jeu du jour'},
  pts5000: {nom: 'Légende du Quiz', desc: 'Tu as cumulé 5 000 points au Jeu du jour.', ico: 'pts5000', tier: 'mythique', cat: 'Jeu du jour'},
  champion: {nom: 'Champion de la semaine', desc: 'Tu as fini dans le top 3 du classement hebdomadaire du Jeu du jour.', ico: 'champion', tier: 'epique', cat: 'Jeu du jour'},
  'bq-etoile': {nom: 'Étoile filante', desc: 'Acheté à la boutique de points.', ico: 'bq-etoile', tier: 'bronze', cat: 'Boutique'},
  'bq-lune': {nom: 'Hibou de nuit', desc: 'Acheté à la boutique de points.', ico: 'bq-lune', tier: 'bronze', cat: 'Boutique'},
  'bq-vue': {nom: 'Vue perçante', desc: 'Acheté à la boutique de points.', ico: 'bq-vue', tier: 'argent', cat: 'Boutique'},
  'bq-des': {nom: 'Joueur de dés', desc: 'Acheté à la boutique de points.', ico: 'bq-des', tier: 'argent', cat: 'Boutique'},
  'bq-couronne': {nom: 'Couronné', desc: 'Acheté à la boutique de points.', ico: 'bq-couronne', tier: 'or', cat: 'Boutique'},
  'bq-gemme': {nom: 'Chasseur de gemmes', desc: 'Acheté à la boutique de points.', ico: 'bq-gemme', tier: 'epique', cat: 'Boutique'}
};
const bqBadge = cle => BQ_BADGES[cle] ? {id: cle, ...BQ_BADGES[cle]} : null;
const BQ = [
  {id: 'pioche', kind: 'pioche', nom: 'Pioche Arcade', prix: 400, desc: 'Trois cartes Arcade tirées au hasard, tu en gardes une. Une seule par jour.'},
  ...[['Curieux', 150], ['Noctambule', 200], ['Œil de lynx', 250], ['Chasseur d’énigmes', 300], ['Collectionneur', 400], ['Gardien des Cartes', 600], ['Légende vivante', 1200], ['Roi de l’Arcade', 2000]]
    .map(([n, p]) => ({id: 't-' + nrm(n), kind: 'titre', nom: n, prix: p, val: n, desc: 'Un titre affiché sous ton pseudo.'})),
  ...[['etoile', 200], ['lune', 250], ['vue', 400], ['des', 350], ['couronne', 800], ['gemme', 1200]]
    .map(([k, p]) => ({id: 'bq-' + k, kind: 'badge', nom: BQ_BADGES['bq-' + k].nom, prix: p, cle: 'bq-' + k, desc: 'Un badge à ranger dans ta vitrine.'})),
  ...[['pixel', 'Pixel doré', 300], ['neon', 'Néon violet', 400], ['ronces', 'Ronces', 500], ['flamme', 'Flammes', 600], ['glace', 'Givre', 600], ['etoiles', 'Voie lactée', 700], ['arcade', 'Arcade RGB', 800], ['glitch', 'Glitch', 900], ['royal', 'Couronne royale', 1500], ['citrouille', 'Citrouille ardente (Halloween)', 700], ['fantome', 'Fantôme farceur (Halloween)', 800], ['toile', 'Toile d’araignée (Halloween)', 900], ['chauvesouris', 'Chauves-souris (Halloween)', 1000]]
    .map(([k, n, p]) => ({id: 'c-' + k, kind: 'cadre', nom: n, prix: p, desc: 'Un cadre autour de ton avatar.'})),
  ...[['ville', 'Ville sous la pluie', 600], ['salle', 'Salle d’arcade', 700], ['foret', 'Forêt du Renard', 800], ['neon', 'Néons du Ronin', 900], ['station', 'Station du Pilote', 1000], ['tour', 'Tour du Bourreau', 1200], ['ile', 'Île du Pirate Fantôme', 1500], ['manoir', 'Manoir du Veilleur', 2000], ['citrouilles', 'Champ de citrouilles (Halloween)', 900], ['fantomes', 'Bal des fantômes (Halloween)', 1000], ['toile', 'Repaire des araignées (Halloween)', 1100], ['sorciere', 'Nuit de la sorcière (Halloween)', 1300]]
    .map(([k, n, p]) => ({id: 'b-' + k, kind: 'banniere', nom: n, prix: p, desc: 'Une bannière animée en haut de ton profil.'})),
  ...[['or', 'Or', 250], ['rose', 'Rose', 250], ['cyan', 'Cyan', 250], ['vert', 'Vert', 250], ['arc', 'Arc-en-ciel animé', 700]]
    .map(([k, n, p]) => ({id: 'p-' + k, kind: 'couleur', nom: n, prix: p, desc: 'Une couleur pour ton pseudo.'}))
];
const BQ_PAR_ID = Object.fromEntries(BQ.map(x => [x.id, x]));
function ptsScore(h, id) { return h.un('SELECT COALESCE(SUM(pts),0) AS s FROM qparties WHERE joueur=?', id).s; }
function ptsBonus(h, id) { return h.un('SELECT COALESCE(SUM(pts),0) AS s FROM bonus WHERE joueur=?', id).s; }
function ptsEtat(h, j) {
  const score = ptsScore(h, j.id), bonus = ptsBonus(h, j.id), depense = h.un('SELECT COALESCE(SUM(prix),0) AS s FROM bq_achats WHERE joueur=?', j.id).s, jour = jourParis();
  const prochain = PALIERS.find(p => score < p[0]);
  const qs = qStats(h, j), sem = ptsClassement(h, lundiDe(jour), joursPlus(lundiDe(jour), 6), 500), ix = sem.findIndex(r => r.id === j.id);
  return {score, solde: score + bonus - depense, rang: ix >= 0 ? ix + 1 : null, victoires: qs.victoires, parties: qs.jouees, serie: qs.serie, meilleure: qs.meilleure, joker: qs.joker, prochain: qs.prochain,
    arcade: {n: h.un("SELECT COUNT(*) AS c FROM acartes WHERE joueur=? AND carte NOT IN ('la-cle-ancienne','le-coffre-ferme')", j.id).c, total: ARCADE.length - 2}, piocheFaite: !!h.un('SELECT 1 AS x FROM bq_achats WHERE joueur=? AND item=? AND jour=?', j.id, 'pioche', jour),
    prochainPalier: prochain ? {pts: prochain[0], titre: prochain[2]} : null};
}
function ptsPaliers(h, id) {
  const s = ptsScore(h, id);
  PALIERS.forEach(([n, cle, titre]) => { if (s >= n) { h.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, id, 'badge', cle, Date.now(), 'points'); h.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, id, 'titre', titre, Date.now(), 'points'); } });
}
function cosmDe(j) { return {cadre: j.cadre_av || '', banniere: j.banniere || '', couleur: j.couleur || ''}; }
// classement : deb/fin = bornes (jours) ou null pour « depuis le début » ; les profils privés et bannis n'apparaissent pas
function ptsClassement(h, deb, fin, lim) {
  const w = deb ? ' AND q.jour>=? AND q.jour<=?' : '', args = deb ? [deb, fin] : [];
  return h.sql.exec(`SELECT j.*, SUM(q.pts) AS pts, SUM(q.gagne) AS wins, COUNT(*) AS n FROM qparties q JOIN joueurs j ON j.id=q.joueur
    WHERE j.banni=0 AND j.prive=0 AND q.fini=1${w} GROUP BY q.joueur HAVING SUM(q.pts)>0 ORDER BY pts DESC, wins DESC, n ASC, q.joueur ASC LIMIT ?`, ...args, lim).toArray();
}
function ptsLigne(h, r, i) {
  return {rang: i + 1, login: r.login, pseudo: r.nom, avatar: r.avatar || '', titre: h.titreDe(r), pts: r.pts, victoires: r.wins, parties: r.n, serie: qSerie(h, r.id).serie, cosm: cosmDe(r)};
}
// à chaque début de semaine, les 3 meilleurs de la semaine passée reçoivent leur récompense (traité à la première visite, une seule fois)
function qCloture(h) {
  const cur = semaineDe(jourParis()); if (h._clot === cur) return;
  const prem = h.un('SELECT MIN(jour) AS d FROM qparties WHERE pts>0').d;
  if (prem) for (let s = semaineDe(prem); s < cur; s++) {
    if (h.un('SELECT 1 AS x FROM qsemaines WHERE sem=?', s)) continue;
    const deb = joursPlus(lundiDe(prem), (s - semaineDe(prem)) * 7), top = ptsClassement(h, deb, joursPlus(deb, 6), 3);
    h.run('INSERT OR IGNORE INTO qsemaines(sem,deb,top) VALUES(?,?,?)', s, deb, JSON.stringify(top.map(r => ({id: r.id, login: r.login, pseudo: r.nom, pts: r.pts}))));
    top.forEach((r, i) => { aTirage(h, r.id, 'w' + s + ':' + (i + 1), 0); h.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, r.id, 'badge', 'champion', Date.now(), 'semaine'); });
  }
  h._clot = cur;
}
function ptsClassementVue(h) {
  qCloture(h);
  const auj = jourParis(), deb = lundiDe(auj), fin = joursPlus(deb, 6);
  const sem = ptsClassement(h, deb, fin, 50).map((r, i) => ptsLigne(h, r, i)), tot = ptsClassement(h, null, null, 50).map((r, i) => ptsLigne(h, r, i));
  const passee = h.un('SELECT deb, top FROM qsemaines WHERE sem=?', semaineDe(auj) - 1);
  return {jour: auj, debut: deb, fin, joursRestants: joursDepuis(fin) - joursDepuis(auj), semaine: sem, total: tot, semainePassee: passee ? {debut: passee.deb, top: JSON.parse(passee.top)} : null};
}
function bqCatalogue(h, j) {
  const possede = new Set(h.sql.exec('SELECT item FROM bq_achats WHERE joueur=? AND item!=?', j.id, 'pioche').toArray().map(r => r.item));
  const e = ptsEtat(h, j);
  return {...e, equipe: cosmDe(j), articles: BQ.map(x => ({id: x.id, kind: x.kind, nom: x.nom, prix: x.prix, desc: x.desc, possede: x.kind === 'pioche' ? false : possede.has(x.id)}))};
}
async function bqRoute(h, j, req) {
  ptsPaliers(h, j.id);
  if (req.method !== 'POST') return json(bqCatalogue(h, j));
  let b = {}; try { b = await req.json(); } catch (x) {}
  if (b.act === 'acheter') {
    const x = BQ_PAR_ID[String(b.id)]; if (!x) return json({erreur: 'article'}, {}, 400);
    const e = ptsEtat(h, j), jour = jourParis();
    if (x.kind !== 'pioche' && h.un('SELECT 1 AS y FROM bq_achats WHERE joueur=? AND item=?', j.id, x.id)) return json({erreur: 'deja'}, {}, 400);
    if (x.kind === 'pioche' && e.piocheFaite) return json({erreur: 'pioche_du_jour'}, {}, 400);
    if (e.solde < x.prix) return json({erreur: 'solde'}, {}, 400);
    h.run('INSERT INTO bq_achats(joueur,item,prix,jour,ts) VALUES(?,?,?,?,?)', j.id, x.id, x.prix, jour, Date.now());
    if (x.kind === 'pioche') aTirage(h, j.id, 'b' + jour, 0);
    if (x.kind === 'titre') h.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'titre', x.val, Date.now(), 'boutique');
    if (x.kind === 'badge') h.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'badge', x.cle, Date.now(), 'boutique');
    return json({ok: true, article: x.id, ...bqCatalogue(h, j), attente: aAttente(h, j.id)});
  }
  if (b.act === 'equiper') {
    const kind = String(b.kind), id = String(b.id || ''), col = {cadre: 'cadre_av', banniere: 'banniere', couleur: 'couleur'}[kind];
    if (!col) return json({erreur: 'type'}, {}, 400);
    if (id) { const x = BQ_PAR_ID[id]; if (!x || x.kind !== kind || !h.un('SELECT 1 AS y FROM bq_achats WHERE joueur=? AND item=?', j.id, id)) return json({erreur: 'pas_possede'}, {}, 400); }
    h.run(`UPDATE joueurs SET ${col}=? WHERE id=?`, id.replace(/^[a-z]-/, ''), j.id);
    return json({ok: true, equipe: cosmDe(h.joueur(j.id))});
  }
  return json({erreur: 'action'}, {}, 400);
}
// <SHOOT-SIM>
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
// </SHOOT-SIM>
// ----- Reliques du Site : une carte par secret trouvé, +500 points (solde de la boutique seulement) -----
const RELIQUES = {araignee: 'veuve', cachecache: 'balise', coffre: 'coffre', clubishoot: 'shoot'};
const RELIQUE_PTS = 500;
function relEtat(h, j) {
  const secrets = new Set(h.sql.exec(`SELECT cle FROM succes WHERE joueur=? AND kind='badge'`, j.id).toArray().map(r => r.cle));
  const a = new Set(h.sql.exec('SELECT cle FROM reliques WHERE joueur=?', j.id).toArray().map(r => r.cle));
  const dues = Object.entries(RELIQUES).filter(([sec, id]) => secrets.has(sec) && !a.has(id)).map(([, id]) => id);
  return {reliques: [...a], relAttente: dues, relTotal: Object.keys(RELIQUES).length};
}
async function relRecuperer(h, j) {
  const e = relEtat(h, j), now = Date.now();
  e.relAttente.forEach(id => {
    h.run('INSERT OR IGNORE INTO reliques(joueur,cle,ts) VALUES(?,?,?)', j.id, id, now);
    h.run('INSERT OR IGNORE INTO bonus(joueur,cle,pts,ts) VALUES(?,?,?,?)', j.id, 'relique-' + id, RELIQUE_PTS, now);
  });
  return json({ok: true, nouvelles: e.relAttente, pts: e.relAttente.length * RELIQUE_PTS, ...relEtat(h, j)});
}
// ----- Clubi Shoot (jeu secret) : le serveur donne la graine, puis REJOUE la partie envoyée avant de verser les points -----
const SHOOT_PTS = 1000;
async function shootDebut(h, j) {
  const now = Date.now(), prec = h.un('SELECT ts FROM shoot_sessions WHERE joueur=?', j.id);
  if (prec && now - prec.ts < 3000) return json({erreur: 'trop_vite'}, {}, 429);
  const deja = !!h.un('SELECT 1 AS x FROM bonus WHERE joueur=? AND cle=?', j.id, 'clubishoot');
  const seed = aAlea(4294967295) + 1;
  if (!deja) h.run('INSERT INTO shoot_sessions(joueur,seed,ts) VALUES(?,?,?) ON CONFLICT(joueur) DO UPDATE SET seed=excluded.seed, ts=excluded.ts', j.id, seed, now);
  return json({seed, deja});
}
async function shootFin(h, j, req) {
  let b = {}; try { b = await req.json(); } catch (x) {}
  const se = h.un('SELECT * FROM shoot_sessions WHERE joueur=?', j.id);
  if (!se) return json({ok: true, gagne: false});
  h.run('DELETE FROM shoot_sessions WHERE joueur=?', j.id);
  const n = Math.floor(+b.n || 0), liste = String(b.i || '').slice(0, 60000), ecoule = Date.now() - se.ts;
  if (n < 600 || ecoule < n / 60 * 1000 * 0.85 - 4000 || ecoule > 3 * 3600 * 1000) return json({ok: true, gagne: false});
  const r = LCSIM.rejouer(se.seed, n, liste);
  if (r.state !== 'won' || r.f !== n) return json({ok: true, gagne: false});
  const nouveau = !h.un('SELECT 1 AS x FROM bonus WHERE joueur=? AND cle=?', j.id, 'clubishoot');
  if (nouveau) {
    h.run('INSERT OR IGNORE INTO bonus(joueur,cle,pts,ts) VALUES(?,?,?,?)', j.id, 'clubishoot', SHOOT_PTS, Date.now());
    h.run(`INSERT OR IGNORE INTO succes(joueur,kind,cle,ts,src) VALUES(?,?,?,?,?)`, j.id, 'badge', 'clubishoot', Date.now(), 'secret');
  }
  return json({ok: true, gagne: true, pts: SHOOT_PTS, nouveau});
}
async function qAdmin(h, act, b) {
  if (act === 'q-jeux') return json(h.sql.exec('SELECT * FROM qjeux ORDER BY nom COLLATE NOCASE').toArray());
  if (act === 'q-jeux-set') {
    const l = (Array.isArray(b.jeux) ? b.jeux : []).map(x => ({nom: String(x.nom || '').trim().slice(0, 80), genre: String(x.genre || '').slice(0, 60), annee: parseInt(x.annee, 10) || 0, plateforme: String(x.plateforme || '').slice(0, 80), studio: String(x.studio || '').slice(0, 60), vue: String(x.vue || '').slice(0, 40)})).filter(x => x.nom);
    if (l.length > 3000) return json({erreur: 'trop'}, {}, 400);
    h.run('DELETE FROM qjeux'); l.forEach(x => h.run('INSERT OR REPLACE INTO qjeux(nom,genre,annee,plateforme,studio,chaine,vue) VALUES(?,?,?,?,?,0,?)', x.nom, x.genre, x.annee, x.plateforme, x.studio, x.vue));
    return json({ok: true, n: l.length});
  }
  if (act === 'q-liste') return json(h.sql.exec(`SELECT n, fmt, jeu, jour, length(data) AS taille FROM puzzles ORDER BY fmt, n`).toArray());
  if (act === 'q-supprimer') { h.run('DELETE FROM puzzles WHERE n=?', b.n); return json({ok: true}); }
  if (act === 'q-ajouter') {
    const fmt = String(b.fmt || ''), jeu = String(b.jeu || '').trim().slice(0, 80), jour = /^\d{4}-\d{2}-\d{2}$/.test(String(b.jour || '')) ? b.jour : '';
    if (!Object.values(QFMT).includes(fmt) || !jeu) return json({erreur: 'champs'}, {}, 400);
    const d = b.data && typeof b.data === 'object' ? b.data : {}, img = x => typeof x === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(x) && x.length < 450000;
    const data = {};
    if (['pixel', 'silhouette', 'zoom'].includes(fmt)) {
      const need = fmt === 'silhouette' ? 4 : 5;
      if (!Array.isArray(d.stages) || d.stages.length !== need || !d.stages.every(img) || !img(d.final)) return json({erreur: 'images'}, {}, 400);
      data.stages = d.stages; data.final = d.final;
    }
    if (fmt === 'emoji') { const e = (Array.isArray(d.emojis) ? d.emojis : []).map(x => String(x).slice(0, 16)).filter(Boolean).slice(0, 8); if (e.length < 2) return json({erreur: 'emojis'}, {}, 400); data.emojis = e; }
    if (fmt === 'pendu' && d.indice) data.indice = String(d.indice).slice(0, 120);
    if (fmt === 'indices') { const a = qAttrs(h, jeu); if (!a) return json({erreur: 'jeu_absent_de_la_liste'}, {}, 400); data.attrs = a; }
    if (fmt === 'motscles') { const m = (Array.isArray(d.mots) ? d.mots : []).map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 6); if (m.length < 3) return json({erreur: 'mots'}, {}, 400); data.mots = m; }
    if (fmt === 'resume') { data.texte = String(d.texte || '').slice(0, 1500); if (!/\[\[/.test(data.texte)) return json({erreur: 'resume'}, {}, 400); if (img(d.final)) data.final = d.final; }
    const s = JSON.stringify(data); if (s.length > 1700000) return json({erreur: 'trop_gros'}, {}, 400);
    h.run('INSERT INTO puzzles(fmt,jeu,data,jour,ts) VALUES(?,?,?,?,?)', fmt, jeu, s, jour, Date.now());
    return json({ok: true});
  }
  if (act === 'q-apercu') {        // aperçu d'un puzzle avec un nombre d'erreurs simulé (sert à vérifier ce que verront les joueurs)
    const r = h.un('SELECT * FROM puzzles WHERE n=?', b.n); if (!r) return json({erreur: 'inconnu'}, {}, 404);
    const p = {...r, data: JSON.parse(r.data || '{}')}, e = Math.max(0, Math.min(5, parseInt(b.erreurs, 10) || 0));
    const pa = {essais: JSON.stringify(Array.from({length: e}, (_, i) => ({g: p.fmt === 'pendu' ? 'ZQXWJ'[i] : 'Essai ' + (i + 1), ok: 0}))), fini: b.fini ? 1 : 0, gagne: b.gagne ? 1 : 0, pts: 0};
    return json(qVue(h, {id: '_apercu'}, p, pa));
  }
  if (act === 'q-stats') { const jour = jourParis(); return json({jour, format: fmtDuJour(jour), joueursAujourdhui: h.un('SELECT COUNT(*) AS c FROM qparties WHERE jour=?', jour).c, victoiresAujourdhui: h.un('SELECT COUNT(*) AS c FROM qparties WHERE jour=? AND gagne=1', jour).c}); }
  return null;
}

// ---------- Le ClubiForum ----------
// Catégories (écrites ici : pour en ajouter ou en renommer, on change cette liste). modo:true = seul LeClubi peut écrire. etiq = étiquettes proposées à la création d'un sujet.
const FORUM_CATS = [
  {id: 'annonces', g: 'Accueil', nom: 'Annonces', desc: 'Nouveautés du site, mises à jour, événements et lives spéciaux. Je suis le seul à écrire ici.', lettre: 'A', couleur: '#c79a4b', ink: '#17181a', modo: true},
  {id: 'regles', g: 'Accueil', nom: 'Règles et bienvenue', desc: 'Comment fonctionne le forum et comment parler des secrets sans jamais les dévoiler.', lettre: 'R', couleur: '#c79a4b', ink: '#17181a', modo: true},
  {id: 'presentation', g: 'Accueil', nom: 'Présente-toi', desc: 'Nouveau dans la commu ? Dis bonjour et présente-toi en quelques mots.', lettre: 'P', couleur: '#c79a4b', ink: '#17181a'},
  {id: 'general', g: 'Discussions', nom: 'Discussion générale', desc: 'Tout ce qui touche à la commu, sans thème précis.', lettre: 'G', couleur: '#9d6bff', ink: '#17181a'},
  {id: 'lives', g: 'Discussions', nom: 'Lives, clips et jeux', desc: 'Revenir sur un live, proposer un jeu à jouer, partager un clip marquant.', lettre: 'L', couleur: '#9d6bff', ink: '#17181a'},
  {id: 'idees', g: 'Discussions', nom: 'Idées et suggestions', desc: 'Des idées pour améliorer le site : nouvelles pages, fonctions, confort, affichage.', lettre: 'I', couleur: '#9d6bff', ink: '#17181a'},
  {id: 'horssujet', g: 'Discussions', nom: 'Hors sujet', desc: 'Musique, séries, jeux vidéo, tout le reste.', lettre: 'H', couleur: '#9d6bff', ink: '#17181a'},
  {id: 'secrets', g: 'Le site et les jeux', nom: 'Secrets et énigmes', desc: "La chasse aux secrets, en équipe. On s'entraide avec des indices, jamais avec la solution.", lettre: 'S', couleur: '#e0243b', ink: '#ffffff', spoilers: true, etiq: ['Indice', 'Théorie', 'Question']},
  {id: 'cardbattle', g: 'Le site et les jeux', nom: 'Clubi Card Battle', desc: "Stratégies, combos d'objets, mode Survie, défis entre viewers.", lettre: 'B', couleur: '#4d86ff', ink: '#ffffff', etiq: ['Stratégie', 'Question']},
  {id: 'cartes', g: 'Le site et les jeux', nom: 'Cartes et collection', desc: 'Boosters, raretés, ta plus belle pull, échanges entre collectionneurs.', lettre: 'C', couleur: '#4d86ff', ink: '#ffffff', etiq: ['Échange', 'Question']},
  {id: 'jeudujour', g: 'Le site et les jeux', nom: 'Jeu du jour et classements', desc: 'Discuter du jeu à deviner, des points, des titres et du classement.', lettre: 'J', couleur: '#4d86ff', ink: '#ffffff'},
  {id: 'aide', g: 'Le site et les jeux', nom: 'Aide et bugs', desc: 'Un souci sur le site ou dans le jeu ? Décris-le ici, avec ton navigateur si possible.', lettre: '?', couleur: '#4d86ff', ink: '#ffffff', etiq: ['Bug', 'Question']}
];
const FORUM_EMOJIS = ['👍', '🔥', '👀', '❤️', '😂', '🎉'];
const fCat = id => FORUM_CATS.find(c => c.id === id) || null;
const fTexte = (t, max) => String(t == null ? '' : t).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​-‏‪-‮﻿]/g, '').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
const fNorm = t => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
const fLike = q => '%' + String(q).replace(/[\\%_]/g, m => '\\' + m) + '%';

function forumTables(h) {
  const q = s => h.sql.exec(s);
  q(`CREATE TABLE IF NOT EXISTS forum_sujets(n INTEGER PRIMARY KEY AUTOINCREMENT, cat TEXT, titre TEXT, auteur TEXT, etiq TEXT DEFAULT '', ts INTEGER, dernier INTEGER, dmsg INTEGER DEFAULT 0, nrep INTEGER DEFAULT 0, vues INTEGER DEFAULT 0, epingle INTEGER DEFAULT 0, ferme INTEGER DEFAULT 0, resolu INTEGER DEFAULT 0, supprime INTEGER DEFAULT 0, dauteur TEXT DEFAULT '')`);
  q(`CREATE TABLE IF NOT EXISTS forum_messages(n INTEGER PRIMARY KEY AUTOINCREMENT, sujet INTEGER, auteur TEXT, texte TEXT, ts INTEGER, cite INTEGER DEFAULT 0, utile INTEGER DEFAULT 0, masque INTEGER DEFAULT 0, valide INTEGER DEFAULT 0, supprime INTEGER DEFAULT 0, edite INTEGER DEFAULT 0)`);
  q(`CREATE INDEX IF NOT EXISTS forum_m_sujet ON forum_messages(sujet, n)`);
  q(`CREATE INDEX IF NOT EXISTS forum_m_auteur ON forum_messages(auteur, ts)`);
  q(`CREATE INDEX IF NOT EXISTS forum_s_cat ON forum_sujets(cat, dernier)`);
  q(`CREATE TABLE IF NOT EXISTS forum_reactions(msg INTEGER, joueur TEXT, emoji TEXT, PRIMARY KEY(msg, joueur, emoji))`);
  q(`CREATE TABLE IF NOT EXISTS forum_signalements(msg INTEGER, joueur TEXT, ts INTEGER, PRIMARY KEY(msg, joueur))`);
  q(`CREATE TABLE IF NOT EXISTS forum_suivis(sujet INTEGER, joueur TEXT, PRIMARY KEY(sujet, joueur))`);
  q(`CREATE TABLE IF NOT EXISTS forum_suivis_cat(cat TEXT, joueur TEXT, PRIMARY KEY(cat, joueur))`);
  q(`CREATE TABLE IF NOT EXISTS forum_lus(sujet INTEGER, joueur TEXT, msg INTEGER, PRIMARY KEY(sujet, joueur))`);
  q(`CREATE TABLE IF NOT EXISTS forum_membres(joueur TEXT PRIMARY KEY, depuis INTEGER)`);
  q(`CREATE TABLE IF NOT EXISTS forum_notifs(n INTEGER PRIMARY KEY AUTOINCREMENT, joueur TEXT, type TEXT, sujet INTEGER, msg INTEGER, de TEXT, ts INTEGER, lu INTEGER DEFAULT 0)`);
  q(`CREATE INDEX IF NOT EXISTS forum_n_joueur ON forum_notifs(joueur, n)`);
  q(`CREATE TABLE IF NOT EXISTS forum_sanctions(joueur TEXT PRIMARY KEY, type TEXT, jusqua INTEGER DEFAULT 0, raison TEXT DEFAULT '', ts INTEGER)`);
  h.fVues = new Map(); h.fPresence = new Map();
  if (!h.un('SELECT 1 AS x FROM forum_sujets LIMIT 1')) {        // premiers sujets (modifiables ensuite en mode modération)
    const now = Date.now(), ajout = (cat, titre, texte, epingle) => {
      h.run('INSERT INTO forum_sujets(cat,titre,auteur,ts,dernier,epingle,dauteur) VALUES(?,?,?,?,?,?,?)', cat, titre, 'sys', now, now, epingle ? 1 : 0, 'sys');
      const n = h.un('SELECT MAX(n) AS n FROM forum_sujets').n;
      h.run('INSERT INTO forum_messages(sujet,auteur,texte,ts) VALUES(?,?,?,?)', n, 'sys', texte, now);
      h.run('UPDATE forum_sujets SET dmsg=? WHERE n=?', h.un('SELECT MAX(n) AS n FROM forum_messages').n, n);
    };
    ajout('annonces', 'Bienvenue sur le ClubiForum !', "Le ClubiForum est ouvert. Tu te connectes avec ton compte Twitch, sans rien créer d'autre.\n\nPrends une minute pour lire les [règles du forum](#forum/regles), puis lance-toi : présente-toi, discute, cherche les secrets avec les autres.", true);
    ajout('regles', 'Les règles du ClubiForum en bref', "Respect, pas de spam (1 minute entre deux messages), et jamais de solution pour les secrets.\n\nLe détail complet, avec les raisons de chaque règle, est sur la page des [règles du forum](#forum/regles).", true);
    ajout('secrets', 'Comment fonctionnent les secrets : lis ça avant de chercher', "**On s'entraide, mais on ne dévoile jamais un secret.** Chaque secret doit pouvoir être trouvé par chacun, sans qu'on le lui souffle.\n\n**Permis** : donner un indice vague, dire « cherche du côté de telle page », encourager, comparer vos pistes sans conclure.\n**Interdit** : donner la réponse, montrer une capture qui la révèle, expliquer pas à pas comment le déclencher.\n**Un doute ?** Utilise « Masquer en spoiler » : le message reste caché tant que personne ne clique.\n\nJe ne confirme et ne révèle aucun secret, pour que la découverte reste la même pour tout le monde. Un message qui dévoile une solution est masqué puis supprimé.", true);
  }
}
function fCfg(h) {
  const e = h.env || {};
  return {delaiMsg: num(e.FORUM_DELAI_MSG, 60), delaiSujet: num(e.FORUM_DELAI_SUJET, 300), seuil: num(e.FORUM_SEUIL_SIGNALEMENT, 3), parPage: 20, parListe: 25,
    modos: String(e.FORUM_MODOS || 'leclubi').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)};
}
function fSanction(h, id) {
  const s = h.un('SELECT * FROM forum_sanctions WHERE joueur=?', id); if (!s) return null;
  if (s.type === 'sourdine' && s.jusqua < Date.now()) { h.run('DELETE FROM forum_sanctions WHERE joueur=?', id); return null; }
  return s;
}
function fAuteur(h, C, id, cache) {
  if (cache && cache.has(id)) return cache.get(id);
  let a;
  if (!id || id === 'sys') a = {pseudo: 'LeClubi', login: 'leclubi', avatar: '', titre: '', cosm: {}, modo: true, sys: true, n: 0};
  else {
    const j = h.joueur(id);
    a = j ? {pseudo: j.nom, login: j.login, avatar: j.prive ? '' : (j.avatar || ''), titre: h.titreDe(j), cosm: cosmDe(j), modo: C.modos.includes(j.login), n: h.un('SELECT COUNT(*) AS c FROM forum_messages WHERE auteur=? AND supprime=0', id).c}
      : {pseudo: 'Ancien membre', login: '', avatar: '', titre: '', cosm: {}, modo: false, n: 0};
  }
  if (cache) cache.set(id, a); return a;
}
const fMini = a => ({pseudo: a.pseudo, login: a.login, avatar: a.avatar, cosm: a.cosm});
function fNotif(h, joueur, type, sujet, msg, de) {
  if (!joueur || joueur === 'sys' || joueur === de) return;
  h.run('INSERT INTO forum_notifs(joueur,type,sujet,msg,de,ts) VALUES(?,?,?,?,?,?)', joueur, type, sujet, msg, de, Date.now());
  h.run('DELETE FROM forum_notifs WHERE joueur=? AND n NOT IN (SELECT n FROM forum_notifs WHERE joueur=? ORDER BY n DESC LIMIT 60)', joueur, joueur);
}
function fNonLusSql(cat) { return `SELECT s.n FROM forum_sujets s LEFT JOIN forum_lus l ON l.sujet=s.n AND l.joueur=? WHERE s.supprime=0 ${cat ? 'AND s.cat=?' : ''} AND ((l.msg IS NULL AND s.dernier>?) OR (l.msg IS NOT NULL AND l.msg<s.dmsg))`; }
function fNonLus(h, me, depuis, cat) { return h.sql.exec(fNonLusSql(cat), ...(cat ? [me.id, cat, depuis] : [me.id, depuis])).toArray().map(r => r.n); }

function fLigne(h, C, s, me, cache, nonLus, suivis) {
  const parts = h.sql.exec('SELECT DISTINCT auteur FROM forum_messages WHERE sujet=? AND supprime=0 ORDER BY n DESC LIMIT 4', s.n).toArray().map(r => r.auteur).filter(a => a !== s.auteur).slice(0, 3);
  const cat = fCat(s.cat);
  return {n: s.n, cat: s.cat, catNom: cat ? cat.nom : s.cat, titre: s.titre, etiq: s.etiq, resolu: !!s.resolu, epingle: !!s.epingle, ferme: !!s.ferme, nrep: s.nrep, vues: s.vues, ts: s.ts, dernier: s.dernier,
    auteur: fMini(fAuteur(h, C, s.auteur, cache)), dernierAuteur: s.dauteur ? fMini(fAuteur(h, C, s.dauteur, cache)) : null, participants: parts.map(p => fMini(fAuteur(h, C, p, cache))),
    nonLu: !!(nonLus && nonLus.has(s.n)), suivi: !!(suivis && suivis.has(s.n))};
}
function fListe(h, C, me, depuis, where, params, ordre, page, extra) {
  const total = h.un(`SELECT COUNT(*) AS c FROM forum_sujets s WHERE s.supprime=0 AND ${where}`, ...params).c;
  const pages = Math.max(1, Math.ceil(total / C.parListe)); page = Math.min(Math.max(1, page | 0 || 1), pages);
  const rows = h.sql.exec(`SELECT s.* FROM forum_sujets s WHERE s.supprime=0 AND ${where} ORDER BY ${ordre} LIMIT ${C.parListe} OFFSET ${(page - 1) * C.parListe}`, ...params).toArray();
  const cache = new Map(), nl = me ? new Set(fNonLus(h, me, depuis)) : null, sv = me ? new Set(h.sql.exec('SELECT sujet FROM forum_suivis WHERE joueur=?', me.id).toArray().map(r => r.sujet)) : null;
  return {total, page, pages, sujets: rows.map(s => fLigne(h, C, s, me, cache, nl, sv)), ...(extra || {})};
}
function fMessage(h, C, m, me, modo, cache, premier, reacts) {
  const masque = m.masque === 1, cacher = masque && !modo;
  let cite = null;
  if (m.cite) { const c = h.un('SELECT * FROM forum_messages WHERE n=? AND supprime=0', m.cite); if (c) cite = {n: c.n, pseudo: fAuteur(h, C, c.auteur, cache).pseudo, extrait: c.masque === 1 && !modo ? '' : String(c.texte).replace(/\|\|[\s\S]*?\|\|/g, '▮▮▮').slice(0, 160)}; }
  const rx = {}; (reacts[m.n] || []).forEach(r => { rx[r.emoji] = {e: r.emoji, n: r.c, moi: !!r.moi}; });
  return {n: m.n, auteur: fAuteur(h, C, m.auteur, cache), texte: cacher ? '' : m.texte, masque, ts: m.ts, edite: !!m.edite, utile: !!m.utile, cite, premier, reactions: FORUM_EMOJIS.filter(e => rx[e]).map(e => rx[e]),
    moi: !!(me && m.auteur === me.id), signale: me ? !!h.un('SELECT 1 AS x FROM forum_signalements WHERE msg=? AND joueur=?', m.n, me.id) : false, ...(modo ? {nSignalements: h.un('SELECT COUNT(*) AS c FROM forum_signalements WHERE msg=?', m.n).c} : {})};
}
function fMentions(h, texte, de) {
  const vus = new Set(); let m; const re = /@([A-Za-z0-9_]{3,25})/g;
  while ((m = re.exec(texte)) && vus.size < 5) { const j = h.un('SELECT id FROM joueurs WHERE login=? AND banni=0', m[1].toLowerCase()); if (j && j.id !== de) vus.add(j.id); }
  return [...vus];
}

// Création d'un message (réponse ou premier message d'un sujet). Retourne {erreur, ...} ou {ok}
function fVerifier(h, C, me, modo, texte, estSujet) {
  const sa = fSanction(h, me.id);
  if (sa) return sa.type === 'ban' ? {erreur: 'banni_forum', code: 403} : {erreur: 'sourdine', jusqua: sa.jusqua, code: 403};
  if (texte.length < 2) return {erreur: 'trop_court', code: 400};
  if (modo) return null;                                   // LeClubi n'est pas freiné par les délais
  const now = Date.now(), dm = h.un('SELECT ts, texte FROM forum_messages WHERE auteur=? ORDER BY n DESC LIMIT 1', me.id);
  if (dm && now - dm.ts < C.delaiMsg * 1000) return {erreur: 'delai', reste: Math.ceil((C.delaiMsg * 1000 - (now - dm.ts)) / 1000), code: 429};
  if (estSujet) {
    const ds = h.un('SELECT ts FROM forum_sujets WHERE auteur=? ORDER BY n DESC LIMIT 1', me.id);
    if (ds && now - ds.ts < C.delaiSujet * 1000) return {erreur: 'delai_sujet', reste: Math.ceil((C.delaiSujet * 1000 - (now - ds.ts)) / 1000), code: 429};
  }
  if (dm && fNorm(dm.texte) === fNorm(texte)) return {erreur: 'doublon', code: 409};
  return null;
}
function fEnregistrer(h, C, me, sujet, texte, cite) {
  const now = Date.now();
  h.run('INSERT INTO forum_messages(sujet,auteur,texte,ts,cite) VALUES(?,?,?,?,?)', sujet.n, me.id, texte, now, cite || 0);
  const n = h.un('SELECT MAX(n) AS n FROM forum_messages').n;
  h.run('UPDATE forum_sujets SET dernier=?, dmsg=?, dauteur=?, nrep=(SELECT COUNT(*)-1 FROM forum_messages WHERE sujet=? AND supprime=0) WHERE n=?', now, n, me.id, sujet.n, sujet.n);
  h.run('INSERT OR IGNORE INTO forum_suivis(sujet,joueur) VALUES(?,?)', sujet.n, me.id);
  h.run('INSERT INTO forum_lus(sujet,joueur,msg) VALUES(?,?,?) ON CONFLICT(sujet,joueur) DO UPDATE SET msg=excluded.msg', sujet.n, me.id, n);
  const deja = new Set([me.id]), notif = (id, type) => { if (id && !deja.has(id)) { deja.add(id); fNotif(h, id, type, sujet.n, n, me.id); } };
  if (cite) { const c = h.un('SELECT auteur FROM forum_messages WHERE n=?', cite); if (c) notif(c.auteur, 'citation'); }
  fMentions(h, texte, me.id).forEach(id => notif(id, 'mention'));
  notif(sujet.auteur, 'reponse');
  h.sql.exec('SELECT joueur FROM forum_suivis WHERE sujet=?', sujet.n).toArray().forEach(r => notif(r.joueur, 'suivi'));
  return n;
}

async function forumRoute(h, req, url) {
  if (!h.fVues) forumTables(h);
  const C = fCfg(h), p = url.pathname.slice(6), me = await h.lireSession(req), modo = !!(me && C.modos.includes(me.login)), now = Date.now();
  let depuis = 0;
  if (me) {
    h.run('INSERT OR IGNORE INTO forum_membres(joueur,depuis) VALUES(?,?)', me.id, now);
    depuis = h.un('SELECT depuis FROM forum_membres WHERE joueur=?', me.id).depuis;
    h.fPresence.set(me.login, now); if (h.fPresence.size > 500) for (const [k, t] of h.fPresence) if (now - t > 300000) h.fPresence.delete(k);
  }
  let b = {}; if (req.method === 'POST') { try { b = await req.json(); } catch (e) {} }
  const niv = (code, o) => json(o, {}, code), cache = new Map();
  const sujetDe = n => { const s = h.un('SELECT * FROM forum_sujets WHERE n=? AND supprime=0', n | 0); return s || null; };
  const requis = () => me ? null : niv(401, {erreur: 'session'});

  // ---------- lectures ----------
  if (p === '/accueil' && req.method === 'GET') {
    const nl = me ? new Set(fNonLus(h, me, depuis)) : null;
    const cats = FORUM_CATS.map(c => {
      const d = h.un('SELECT * FROM forum_sujets WHERE cat=? AND supprime=0 ORDER BY dernier DESC LIMIT 1', c.id);
      const nonLus = me ? h.sql.exec('SELECT n, cat FROM forum_sujets WHERE cat=? AND supprime=0', c.id).toArray().filter(r => nl.has(r.n)).length : 0;
      return {...c, nsujets: h.un('SELECT COUNT(*) AS c FROM forum_sujets WHERE cat=? AND supprime=0', c.id).c, nonLus, suivie: me ? !!h.un('SELECT 1 AS x FROM forum_suivis_cat WHERE cat=? AND joueur=?', c.id, me.id) : false,
        dernier: d ? {n: d.n, titre: d.titre, ts: d.dernier, auteur: fMini(fAuteur(h, C, d.dauteur || d.auteur, cache))} : null};
    });
    const sinceJ = now - 86400000;
    const actifs = h.sql.exec(`SELECT s.n, s.titre, COUNT(m.n) AS c FROM forum_sujets s JOIN forum_messages m ON m.sujet=s.n AND m.ts>? AND m.supprime=0 WHERE s.supprime=0 GROUP BY s.n ORDER BY c DESC, s.dernier DESC LIMIT 3`, sinceJ).toArray();
    const dernieres = h.sql.exec(`SELECT m.n, m.sujet, m.auteur, m.ts, s.titre FROM forum_messages m JOIN forum_sujets s ON s.n=m.sujet WHERE m.supprime=0 AND m.masque=0 AND s.supprime=0 AND m.n>(SELECT MIN(n) FROM forum_messages WHERE sujet=m.sujet) ORDER BY m.n DESC LIMIT 4`).toArray()
      .map(r => ({n: r.n, sujet: r.sujet, titre: r.titre, ts: r.ts, auteur: fMini(fAuteur(h, C, r.auteur, cache))}));
    for (const [k, t] of h.fPresence) if (now - t > 300000) h.fPresence.delete(k);
    const sanction = me ? fSanction(h, me.id) : null;
    return json({cats, actifs, dernieres, stats: {sujets: h.un('SELECT COUNT(*) AS c FROM forum_sujets WHERE supprime=0').c, messages: h.un('SELECT COUNT(*) AS c FROM forum_messages WHERE supprime=0').c, membres: h.un('SELECT COUNT(*) AS c FROM joueurs WHERE banni=0').c, enLigne: h.fPresence.size},
      moi: me ? {login: me.login, pseudo: me.nom, modo, nonLus: nl.size, notifs: h.un('SELECT COUNT(*) AS c FROM forum_notifs WHERE joueur=? AND lu=0', me.id).c, sanction: sanction ? {type: sanction.type, jusqua: sanction.jusqua} : null} : null, delais: {msg: C.delaiMsg, sujet: C.delaiSujet}});
  }
  if (p === '/liste' && req.method === 'GET') {            // vue : derniers | nonlus | miens | suivis | cat
    const vue = url.searchParams.get('vue') || 'derniers', page = +url.searchParams.get('page') || 1;
    if (vue === 'cat') {
      const c = fCat(url.searchParams.get('cat')); if (!c) return niv(404, {erreur: 'inconnu'});
      const tri = url.searchParams.get('tri') || 'recents';
      let w = 's.cat=?', pa = [c.id], o = 's.epingle DESC, s.dernier DESC';
      if (tri === 'populaires') o = 's.epingle DESC, s.nrep DESC, s.vues DESC';
      else if (tri === 'sans') { w += ' AND s.nrep=0'; }
      else if (tri === 'resolus') { w += ' AND s.resolu=1'; }
      const l = fListe(h, C, me, depuis, w, pa, o, page, {cat: {...c, suivie: me ? !!h.un('SELECT 1 AS x FROM forum_suivis_cat WHERE cat=? AND joueur=?', c.id, me.id) : false}});
      return json(l);
    }
    if (['nonlus', 'miens', 'suivis'].includes(vue) && !me) return niv(401, {erreur: 'session'});
    if (vue === 'nonlus') { const ids = fNonLus(h, me, depuis); return json(fListe(h, C, me, depuis, ids.length ? `s.n IN (${ids.map(() => '?').join(',')})` : '0', ids, 's.dernier DESC', page)); }
    if (vue === 'miens') return json(fListe(h, C, me, depuis, 's.auteur=?', [me.id], 's.dernier DESC', page));
    if (vue === 'suivis') return json(fListe(h, C, me, depuis, 's.n IN (SELECT sujet FROM forum_suivis WHERE joueur=?)', [me.id], 's.dernier DESC', page));
    return json(fListe(h, C, me, depuis, '1=1', [], 's.dernier DESC', page));
  }
  if (p === '/sujet' && req.method === 'GET') {
    const s = sujetDe(+url.searchParams.get('id')); if (!s) return niv(404, {erreur: 'inconnu'});
    const total = h.un('SELECT COUNT(*) AS c FROM forum_messages WHERE sujet=? AND supprime=0', s.n).c, pages = Math.max(1, Math.ceil(total / C.parPage));
    const lusAvant = me ? ((h.un('SELECT msg FROM forum_lus WHERE sujet=? AND joueur=?', s.n, me.id) || {}).msg || 0) : 0;
    let page = url.searchParams.get('page') || '1';
    if (page === 'dernier') page = pages;
    else if (page === 'nouveau') { const f = h.un('SELECT COUNT(*) AS c FROM forum_messages WHERE sujet=? AND supprime=0 AND n<=?', s.n, lusAvant); page = lusAvant ? Math.floor(f.c / C.parPage) + 1 : 1; }
    page = Math.min(Math.max(1, +page || 1), pages);
    const ms = h.sql.exec('SELECT * FROM forum_messages WHERE sujet=? AND supprime=0 ORDER BY n LIMIT ? OFFSET ?', s.n, C.parPage, (page - 1) * C.parPage).toArray();
    const premierN = (h.un('SELECT MIN(n) AS n FROM forum_messages WHERE sujet=? AND supprime=0', s.n) || {}).n;
    const reacts = {};
    if (ms.length) h.sql.exec(`SELECT msg, emoji, COUNT(*) AS c, SUM(joueur=?) AS moi FROM forum_reactions WHERE msg IN (${ms.map(() => '?').join(',')}) GROUP BY msg, emoji`, me ? me.id : '', ...ms.map(m => m.n)).toArray().forEach(r => { (reacts[r.msg] = reacts[r.msg] || []).push(r); });
    const cle = (me ? me.login : (req.headers.get('X-Ip') || '?')) + ':' + s.n; if (!h.fVues.has(cle) || now - h.fVues.get(cle) > 1800000) { h.fVues.set(cle, now); if (h.fVues.size > 2000) h.fVues.clear(); h.run('UPDATE forum_sujets SET vues=vues+1 WHERE n=?', s.n); s.vues++; }
    if (me && ms.length) {
      const dernier = Math.max(...ms.map(m => m.n));
      if (dernier > lusAvant) h.run('INSERT INTO forum_lus(sujet,joueur,msg) VALUES(?,?,?) ON CONFLICT(sujet,joueur) DO UPDATE SET msg=MAX(msg, excluded.msg)', s.n, me.id, dernier);
    }
    const c = fCat(s.cat), participants = h.un('SELECT COUNT(DISTINCT auteur) AS c FROM forum_messages WHERE sujet=? AND supprime=0', s.n).c;
    return json({sujet: {n: s.n, cat: s.cat, catNom: c ? c.nom : s.cat, catG: c ? c.g : '', titre: s.titre, etiq: s.etiq, resolu: !!s.resolu, epingle: !!s.epingle, ferme: !!s.ferme, nrep: s.nrep, vues: s.vues, ts: s.ts, participants,
        auteurMoi: !!(me && s.auteur === me.id), spoilers: !!(c && c.spoilers), modoSeul: !!(c && c.modo), suivi: me ? !!h.un('SELECT 1 AS x FROM forum_suivis WHERE sujet=? AND joueur=?', s.n, me.id) : false},
      messages: ms.map(m => fMessage(h, C, m, me, modo, cache, m.n === premierN, reacts)), page, pages, lusAvant, moi: me ? {modo, login: me.login} : null, delais: {msg: C.delaiMsg},
      reste: me && !modo ? Math.max(0, Math.ceil((C.delaiMsg * 1000 - (now - ((h.un('SELECT MAX(ts) AS t FROM forum_messages WHERE auteur=?', me.id) || {}).t || 0))) / 1000)) : 0});
  }
  if (p === '/recherche' && req.method === 'GET') {
    const q = fTexte(url.searchParams.get('q'), 60); if (q.length < 2) return json({sujets: [], membres: [], total: 0, page: 1, pages: 1});
    const like = fLike(q);
    const l = fListe(h, C, me, depuis, `(s.titre LIKE ? ESCAPE '\\' OR s.n IN (SELECT sujet FROM forum_messages WHERE supprime=0 AND masque=0 AND texte LIKE ? ESCAPE '\\'))`, [like, like], 's.dernier DESC', +url.searchParams.get('page') || 1);
    l.membres = h.sql.exec(`SELECT login, nom, avatar, prive FROM joueurs WHERE banni=0 AND (nom LIKE ? ESCAPE '\\' OR login LIKE ? ESCAPE '\\') LIMIT 5`, like, like).toArray().map(j => ({login: j.login, pseudo: j.nom, avatar: j.prive ? '' : (j.avatar || '')}));
    return json(l);
  }
  if (p === '/notifs' && req.method === 'GET') {
    if (!me) return niv(401, {erreur: 'session'});
    const l = h.sql.exec('SELECT * FROM forum_notifs WHERE joueur=? ORDER BY n DESC LIMIT 30', me.id).toArray().map(r => {
      const s = h.un('SELECT titre, supprime FROM forum_sujets WHERE n=?', r.sujet);
      return {n: r.n, type: r.type, sujet: r.sujet, msg: r.msg, titre: s && !s.supprime ? s.titre : '(sujet supprimé)', ts: r.ts, lu: !!r.lu, de: fMini(fAuteur(h, C, r.de, cache))};
    });
    return json({notifs: l});
  }
  if (p === '/moderation' && req.method === 'GET') {
    if (!modo) return niv(403, {erreur: 'interdit'});
    const rows = h.sql.exec(`SELECT m.* FROM forum_messages m WHERE m.supprime=0 AND m.valide=0 AND (m.masque=1 OR m.n IN (SELECT msg FROM forum_signalements)) ORDER BY m.n DESC LIMIT 50`).toArray();
    const reacts = {};
    return json({signales: rows.map(m => ({...fMessage(h, C, m, me, true, cache, false, reacts), sujet: m.sujet, titre: (h.un('SELECT titre FROM forum_sujets WHERE n=?', m.sujet) || {}).titre || ''})),
      sanctions: h.sql.exec('SELECT * FROM forum_sanctions ORDER BY ts DESC LIMIT 50').toArray().map(s => { const j = h.joueur(s.joueur); return {login: j ? j.login : s.joueur, pseudo: j ? j.nom : s.joueur, type: s.type, jusqua: s.jusqua, raison: s.raison, ts: s.ts}; })});
  }

  // ---------- écritures ----------
  if (req.method !== 'POST') return niv(404, {erreur: 'inconnu'});
  const non = requis(); if (non) return non;
  if (p === '/sujet') {
    const c = fCat(String(b.cat || '')); if (!c) return niv(400, {erreur: 'categorie'});
    if (c.modo && !modo) return niv(403, {erreur: 'interdit'});
    const titre = fTexte(b.titre, 120).replace(/\n/g, ' '), texte = fTexte(b.texte, 6000), etiq = (c.etiq || []).includes(String(b.etiquette || '')) ? String(b.etiquette) : '';
    if (titre.length < 3) return niv(400, {erreur: 'titre_court'});
    const v = fVerifier(h, C, me, modo, texte, true); if (v) return niv(v.code, v);
    h.run('INSERT INTO forum_sujets(cat,titre,auteur,etiq,ts,dernier,dauteur) VALUES(?,?,?,?,?,?,?)', c.id, titre, me.id, etiq, now, now, me.id);
    const s = h.un('SELECT * FROM forum_sujets WHERE n=(SELECT MAX(n) FROM forum_sujets)');
    fEnregistrer(h, C, me, s, texte, 0);
    h.sql.exec('SELECT joueur FROM forum_suivis_cat WHERE cat=?', c.id).toArray().forEach(r => fNotif(h, r.joueur, 'nouveau', s.n, 0, me.id));
    return json({ok: true, sujet: s.n});
  }
  if (p === '/message') {
    const s = sujetDe(b.sujet); if (!s) return niv(404, {erreur: 'inconnu'});
    const c = fCat(s.cat); if (c && c.modo && !modo) return niv(403, {erreur: 'interdit'});
    if (s.ferme && !modo) return niv(403, {erreur: 'ferme'});
    const texte = fTexte(b.texte, 6000), v = fVerifier(h, C, me, modo, texte, false); if (v) return niv(v.code, v);
    const cite = b.cite && h.un('SELECT n FROM forum_messages WHERE n=? AND sujet=? AND supprime=0', b.cite | 0, s.n) ? b.cite | 0 : 0;
    const n = fEnregistrer(h, C, me, s, texte, cite);
    return json({ok: true, msg: n, page: Math.max(1, Math.ceil(h.un('SELECT COUNT(*) AS c FROM forum_messages WHERE sujet=? AND supprime=0', s.n).c / C.parPage))});
  }
  if (p === '/reaction') {
    const m = h.un('SELECT m.*, s.supprime AS ss FROM forum_messages m JOIN forum_sujets s ON s.n=m.sujet WHERE m.n=? AND m.supprime=0', b.msg | 0), e = String(b.emoji || '');
    if (!m || m.ss || !FORUM_EMOJIS.includes(e)) return niv(400, {erreur: 'invalide'});
    const sa = fSanction(h, me.id); if (sa) return niv(403, {erreur: sa.type === 'ban' ? 'banni_forum' : 'sourdine', jusqua: sa.jusqua});
    if (h.un('SELECT 1 AS x FROM forum_reactions WHERE msg=? AND joueur=? AND emoji=?', m.n, me.id, e)) h.run('DELETE FROM forum_reactions WHERE msg=? AND joueur=? AND emoji=?', m.n, me.id, e);
    else h.run('INSERT INTO forum_reactions(msg,joueur,emoji) VALUES(?,?,?)', m.n, me.id, e);
    return json({ok: true, reactions: FORUM_EMOJIS.map(x => ({e: x, n: h.un('SELECT COUNT(*) AS c FROM forum_reactions WHERE msg=? AND emoji=?', m.n, x).c, moi: !!h.un('SELECT 1 AS x FROM forum_reactions WHERE msg=? AND joueur=? AND emoji=?', m.n, me.id, x)})).filter(x => x.n)});
  }
  if (p === '/signaler') {
    const m = h.un('SELECT * FROM forum_messages WHERE n=? AND supprime=0', b.msg | 0);
    if (!m) return niv(404, {erreur: 'inconnu'});
    if (m.auteur === me.id) return niv(400, {erreur: 'propre_message'});
    h.run('INSERT OR IGNORE INTO forum_signalements(msg,joueur,ts) VALUES(?,?,?)', m.n, me.id, now);
    const nb = h.un('SELECT COUNT(*) AS c FROM forum_signalements WHERE msg=?', m.n).c; let masque = m.masque === 1;
    if (nb >= C.seuil && !m.valide && !masque) { h.run('UPDATE forum_messages SET masque=1 WHERE n=?', m.n); masque = true; }
    return json({ok: true, masque});
  }
  if (p === '/suivre') {
    const on = b.on !== false;
    if (b.cat) { if (!fCat(String(b.cat))) return niv(400, {erreur: 'invalide'}); if (on) h.run('INSERT OR IGNORE INTO forum_suivis_cat(cat,joueur) VALUES(?,?)', String(b.cat), me.id); else h.run('DELETE FROM forum_suivis_cat WHERE cat=? AND joueur=?', String(b.cat), me.id); return json({ok: true}); }
    const s = sujetDe(b.sujet); if (!s) return niv(404, {erreur: 'inconnu'});
    if (on) h.run('INSERT OR IGNORE INTO forum_suivis(sujet,joueur) VALUES(?,?)', s.n, me.id); else h.run('DELETE FROM forum_suivis WHERE sujet=? AND joueur=?', s.n, me.id);
    return json({ok: true});
  }
  if (p === '/utile') {
    const m = h.un('SELECT * FROM forum_messages WHERE n=? AND supprime=0', b.msg | 0), s = m && sujetDe(m.sujet);
    if (!m || !s) return niv(404, {erreur: 'inconnu'});
    if (!(modo || s.auteur === me.id)) return niv(403, {erreur: 'interdit'});
    const nouveau = m.utile ? 0 : 1;
    h.run('UPDATE forum_messages SET utile=0 WHERE sujet=?', s.n); if (nouveau) h.run('UPDATE forum_messages SET utile=1 WHERE n=?', m.n);
    if (nouveau) fNotif(h, m.auteur, 'utile', s.n, m.n, me.id);
    return json({ok: true, utile: !!nouveau});
  }
  if (p === '/resolu') {
    const s = sujetDe(b.sujet); if (!s) return niv(404, {erreur: 'inconnu'});
    if (!(modo || s.auteur === me.id)) return niv(403, {erreur: 'interdit'});
    h.run('UPDATE forum_sujets SET resolu=? WHERE n=?', b.on === false ? 0 : 1, s.n); return json({ok: true});
  }
  if (p === '/modifier') {
    const m = h.un('SELECT * FROM forum_messages WHERE n=? AND supprime=0', b.msg | 0); if (!m) return niv(404, {erreur: 'inconnu'});
    if (!(modo || (m.auteur === me.id && now - m.ts < 600000))) return niv(403, {erreur: 'interdit'});
    const sa = fSanction(h, me.id); if (sa && !modo) return niv(403, {erreur: sa.type === 'ban' ? 'banni_forum' : 'sourdine'});
    const texte = fTexte(b.texte, 6000); if (texte.length < 2) return niv(400, {erreur: 'trop_court'});
    h.run('UPDATE forum_messages SET texte=?, edite=1 WHERE n=?', texte, m.n); return json({ok: true});
  }
  if (p === '/modo') {
    if (!modo) return niv(403, {erreur: 'interdit'});
    const a = String(b.action || ''), s = b.sujet ? sujetDe(b.sujet) : null;
    const sup = n => { h.run('UPDATE forum_messages SET supprime=1 WHERE n=?', n); };
    if (a === 'epingler' && s) h.run('UPDATE forum_sujets SET epingle=? WHERE n=?', b.on === false ? 0 : 1, s.n);
    else if (a === 'fermer' && s) h.run('UPDATE forum_sujets SET ferme=? WHERE n=?', b.on === false ? 0 : 1, s.n);
    else if (a === 'supprimer_sujet' && s) { h.run('UPDATE forum_sujets SET supprime=1 WHERE n=?', s.n); }
    else if (a === 'deplacer' && s && fCat(String(b.cat || ''))) h.run('UPDATE forum_sujets SET cat=? WHERE n=?', String(b.cat), s.n);
    else if (a === 'supprimer_msg' || a === 'masquer' || a === 'valider') {
      const m = h.un('SELECT * FROM forum_messages WHERE n=?', b.msg | 0); if (!m) return niv(404, {erreur: 'inconnu'});
      if (a === 'valider') { h.run('UPDATE forum_messages SET masque=0, valide=1 WHERE n=?', m.n); h.run('DELETE FROM forum_signalements WHERE msg=?', m.n); }
      else if (a === 'masquer') h.run('UPDATE forum_messages SET masque=1 WHERE n=?', m.n);
      else {
        const premier = (h.un('SELECT MIN(n) AS n FROM forum_messages WHERE sujet=?', m.sujet) || {}).n;
        if (m.n === premier) h.run('UPDATE forum_sujets SET supprime=1 WHERE n=?', m.sujet); else sup(m.n);
        h.run('UPDATE forum_sujets SET nrep=MAX(0,(SELECT COUNT(*)-1 FROM forum_messages WHERE sujet=? AND supprime=0)) WHERE n=?', m.sujet, m.sujet);
        h.run('UPDATE forum_sujets SET dmsg=COALESCE((SELECT MAX(n) FROM forum_messages WHERE sujet=? AND supprime=0),0) WHERE n=?', m.sujet, m.sujet);
      }
    } else if (a === 'sourdine' || a === 'ban' || a === 'deban') {
      const j = h.un('SELECT * FROM joueurs WHERE login=?', String(b.login || '').toLowerCase().slice(0, 40)); if (!j) return niv(404, {erreur: 'membre'});
      if (C.modos.includes(j.login)) return niv(400, {erreur: 'modo'});
      if (a === 'deban') h.run('DELETE FROM forum_sanctions WHERE joueur=?', j.id);
      else {
        const minutes = Math.min(Math.max(1, +b.minutes || 60), 60 * 24 * 90), raison = fTexte(b.raison, 200);
        h.run('INSERT INTO forum_sanctions(joueur,type,jusqua,raison,ts) VALUES(?,?,?,?,?) ON CONFLICT(joueur) DO UPDATE SET type=excluded.type, jusqua=excluded.jusqua, raison=excluded.raison, ts=excluded.ts', j.id, a, a === 'ban' ? 0 : now + minutes * 60000, raison, now);
      }
    } else return niv(400, {erreur: 'invalide'});
    return json({ok: true});
  }
  if (p === '/notifs-lu') { if (b.n) h.run('UPDATE forum_notifs SET lu=1 WHERE joueur=? AND n=?', me.id, b.n | 0); else h.run('UPDATE forum_notifs SET lu=1 WHERE joueur=?', me.id); return json({ok: true}); }
  return niv(404, {erreur: 'inconnu'});
}
