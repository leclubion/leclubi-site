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
const PROXIES = new Set(['/auth', '/moi', '/vitrine', '/vitrine-badges', '/reglage-profil', '/propositions', '/defis', '/titre', '/araignee', '/cache', '/fiche', '/quotidien', '/arcade', '/arcade/coffre', '/journal/carte', '/journal/usage', '/boutique', '/classement-quiz']);

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
     `ALTER TABLE joueurs ADD COLUMN cree INTEGER DEFAULT 0`, `ALTER TABLE joueurs ADD COLUMN vbadges TEXT DEFAULT '[]'`, `ALTER TABLE joueurs ADD COLUMN titre TEXT DEFAULT ''`, `ALTER TABLE joueurs ADD COLUMN fiche TEXT DEFAULT '{}'`, `ALTER TABLE joueurs ADD COLUMN cadre_av TEXT DEFAULT ''`, `ALTER TABLE joueurs ADD COLUMN banniere TEXT DEFAULT ''`, `ALTER TABLE joueurs ADD COLUMN couleur TEXT DEFAULT ''`].forEach(a => { try { q(a); } catch (e) {} });
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
    q(`CREATE TABLE IF NOT EXISTS puzzles(n INTEGER PRIMARY KEY AUTOINCREMENT, fmt TEXT, jeu TEXT, data TEXT, jour TEXT DEFAULT '', ts INTEGER)`);
    q(`CREATE TABLE IF NOT EXISTS acartes(joueur TEXT, carte TEXT, ts INTEGER, src TEXT DEFAULT '', PRIMARY KEY(joueur, carte))`);
    q(`CREATE TABLE IF NOT EXISTS atirages(joueur TEXT, jour TEXT, cartes TEXT, choix INTEGER DEFAULT -1, PRIMARY KEY(joueur, jour))`);
    q(`CREATE TABLE IF NOT EXISTS qparties(joueur TEXT, jour TEXT, fmt TEXT, puzzle INTEGER, essais TEXT DEFAULT '[]', fini INTEGER DEFAULT 0, gagne INTEGER DEFAULT 0, pts INTEGER DEFAULT 0, PRIMARY KEY(joueur, jour))`);
    q(`CREATE TABLE IF NOT EXISTS bq_achats(n INTEGER PRIMARY KEY AUTOINCREMENT, joueur TEXT, item TEXT, prix INTEGER, jour TEXT, ts INTEGER)`);
    q(`CREATE TABLE IF NOT EXISTS qsemaines(sem INTEGER PRIMARY KEY, deb TEXT, top TEXT)`);
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
    if (url.pathname === '/etat') return json(this.etat());
    if (url.pathname.startsWith('/admin/')) return this.admin(req, url);
    if (url.pathname === '/journal') return this.journalLire();
    if (url.pathname === '/titres') return this.titresPublics();
    if (url.pathname.startsWith('/journal/')) return this.journalAjout(req, url);
    if (url.pathname.startsWith('/propositions')) return this.propositions(req, url);
    if (url.pathname === '/auth' || url.pathname === '/moi' || url.pathname === '/vitrine' || url.pathname === '/vitrine-badges' || url.pathname === '/reglage-profil' || url.pathname === '/defis' || url.pathname === '/titre' || url.pathname === '/araignee' || url.pathname === '/cache' || url.pathname === '/fiche' || url.pathname === '/quotidien' || url.pathname === '/arcade' || url.pathname === '/arcade/coffre' || url.pathname === '/boutique' || url.pathname === '/classement-quiz' || url.pathname.startsWith('/profil/')) return this.compte(req, url);
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
    const bj = this.badgesDe(j), fi = this.ficheDe(j); return {...base, fiche: fi, ficheBadge: this.succesDe(j).filter(x => x.id === fi.badge), titre: this.titreDe(j), badgesInfo: this.succesDe(j).filter(x => bj.includes(x.id)), vitrine: this.vitrineDe(j), serie: qSerie(this, j.id).serie, cosm: cosmDe(j), score: ptsScore(this, j.id), cree: j.cree || 0, pstats: (() => { const e = ptsEtat(this, j); return {score: e.score, rang: e.rang, victoires: e.victoires, parties: e.parties, serie: e.serie, meilleure: e.meilleure, arcade: e.arcade}; })(), arcade: this.sql.exec("SELECT carte FROM acartes WHERE joueur=? AND carte NOT IN ('la-cle-ancienne','le-coffre-ferme') ORDER BY ts", j.id).toArray().map(r => r.carte), badges: bj, parties: j.parties, victoires: j.victoires, ratio: j.parties ? Math.round(1000 * j.victoires / j.parties) / 10 : null};
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
    return json({erreur: 'inconnu'}, {}, 404);
  }
  cacheDe(j) { return this.sql.exec(`SELECT cle FROM succes WHERE joueur=? AND kind='cache' ORDER BY ts`, j.id).toArray().map(r => r.cle); }
  moi(j) {
    const jour = jourParis();
    return {id: j.id, login: j.login, pseudo: j.nom, avatar: j.avatar || '', vitrine: this.vitrineDe(j), badges: this.badgesDe(j), prive: !!j.prive, titre: this.titreDe(j), titres: this.titresDe(j), succes: this.succesDe(j), visites: this.nbVisites(j), fiche: this.ficheDe(j), cache: this.cacheDe(j), cosm: cosmDe(j), points: ptsEtat(this, j), cree: j.cree || 0,
      jeu: {parties: j.parties, victoires: j.victoires, defaites: j.defaites, nuls: j.nuls, orTotal: j.or_total, victoiresOrAujourdhui: j.jour === jour ? j.gains_jour : 0,
        ratio: j.parties ? Math.round(1000 * j.victoires / j.parties) / 10 : null, rang: this.rangs(j), maxJour: this.C.maxJour, minimumRatio: 10}};
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
      if (r.cle === 'coffre') { out.push({id: 'coffre', nom: 'Ouvrir le Coffre', desc: 'Tu as trouvé le coffre caché sur le site et tu l\'as ouvert.', ico: 'key', tier: 'epique', cat: 'Secrets', ts: r.ts}); return; }
      if (r.cle === 'serie3') { out.push({id: 'serie3', nom: 'Série de 3', desc: 'Tu as terminé le Jeu du jour 3 jours de suite.', ico: 'flame', tier: 'bronze', cat: 'Jeu du jour', ts: r.ts}); return; }
      if (r.cle === 'serie7') { out.push({id: 'serie7', nom: 'Une semaine de flamme', desc: 'Tu as terminé le Jeu du jour 7 jours de suite.', ico: 'flame', tier: 'or', cat: 'Jeu du jour', ts: r.ts}); return; }
      if (r.cle === 'serie30') { out.push({id: 'serie30', nom: 'Inarrêtable', desc: 'Tu as tenu une série de 30 jours au Jeu du jour.', ico: 'flame', tier: 'mythique', cat: 'Secrets', ts: r.ts}); return; }
      if (r.cle === 'araignee') { out.push({id: 'araignee', nom: 'Arachnophobe', desc: 'Tu as écrasé l\'araignée qui rôdait sur le site.', ico: 'spider', tier: 'epique', cat: 'Secrets', ts: r.ts}); return; }
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
    {k: 'chaine', v: g.chaine ? 'Joué sur la chaîne' : 'Pas joué sur la chaîne', s: !!g.chaine === !!rep.chaine ? 'ok' : 'no'}
  ];
}
function qMasque(nom, trouvees) {
  return [...String(nom)].map(c => { const n = nrm(c); return n ? (trouvees.has(n) ? c : '_') : c; }).join('');
}
function qResume(texte, erreurs, fini, graine) {
  const parts = String(texte || '').split(/(\[\[!?[^\]]+\]\])/g), cachables = [];
  parts.forEach((x, i) => { const m = /^\[\[(!?)([^\]]+)\]\]$/.exec(x); if (m) cachables.push({i, fixe: !!m[1], mot: m[2]}); });
  const libres = cachables.filter(c => !c.fixe).map(c => c.i);
  let s = graine || 1; const alea = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  libres.sort(() => alea() - .5);
  const nb = fini ? libres.length : Math.floor(libres.length * Math.min(erreurs, 4) / 5);
  const ouverts = new Set(libres.slice(0, nb));
  return parts.map((x, i) => {
    const c = cachables.find(z => z.i === i); if (!c) return {t: x};
    return (fini || ouverts.has(i)) ? {t: c.mot, r: 1} : {t: '█'.repeat(Math.max(3, Math.min(c.mot.length, 10))), h: 1};
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
    const rep = d.attrs || qAttrs(h, p.jeu) || {}; const ordre = ['genre', 'annee', 'studio', 'plateforme', 'chaine'], n = fini ? 5 : Math.min(5, 1 + erreurs);
    const lab = {genre: rep.genre, annee: rep.annee, studio: rep.studio, plateforme: rep.plateforme, chaine: rep.chaine ? 'Joué sur la chaîne' : 'Pas joué sur la chaîne'};
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
async function aArcade(h, j, req) {
  if (req.method === 'POST') {
    let b = {}; try { b = await req.json(); } catch (x) {}
    const t = h.un('SELECT * FROM atirages WHERE joueur=? AND choix<0 ORDER BY jour LIMIT 1', j.id), k = parseInt(b.choix, 10);
    if (!t) return json({erreur: 'aucun_tirage'}, {}, 400);
    if (!(k >= 0 && k < 3)) return json({erreur: 'choix'}, {}, 400);
    const cartes = JSON.parse(t.cartes), carte = cartes[k], nouvelle = !h.un('SELECT 1 AS x FROM acartes WHERE joueur=? AND carte=?', j.id, carte);
    h.run('INSERT OR IGNORE INTO acartes(joueur,carte,ts,src) VALUES(?,?,?,?)', j.id, carte, Date.now(), 'jeu');
    h.run('UPDATE atirages SET choix=? WHERE joueur=? AND jour=?', k, j.id, t.jour);
    return json({ok: true, carte, nouvelle, choix: k, attente: aAttente(h, j.id)});
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
  pts500: {nom: 'Initié du Quiz', desc: 'Tu as cumulé 500 points au Jeu du jour.', ico: 'bulb', tier: 'bronze', cat: 'Jeu du jour'},
  pts2000: {nom: 'Expert du Quiz', desc: 'Tu as cumulé 2 000 points au Jeu du jour.', ico: 'trophy', tier: 'or', cat: 'Jeu du jour'},
  pts5000: {nom: 'Légende du Quiz', desc: 'Tu as cumulé 5 000 points au Jeu du jour.', ico: 'crown', tier: 'mythique', cat: 'Jeu du jour'},
  champion: {nom: 'Champion de la semaine', desc: 'Tu as fini dans le top 3 du classement hebdomadaire du Jeu du jour.', ico: 'trophy', tier: 'epique', cat: 'Jeu du jour'},
  'bq-etoile': {nom: 'Étoile filante', desc: 'Acheté à la boutique de points.', ico: 'star', tier: 'bronze', cat: 'Boutique'},
  'bq-lune': {nom: 'Hibou de nuit', desc: 'Acheté à la boutique de points.', ico: 'moon', tier: 'bronze', cat: 'Boutique'},
  'bq-vue': {nom: 'Vue perçante', desc: 'Acheté à la boutique de points.', ico: 'eye', tier: 'argent', cat: 'Boutique'},
  'bq-des': {nom: 'Joueur de dés', desc: 'Acheté à la boutique de points.', ico: 'dice', tier: 'argent', cat: 'Boutique'},
  'bq-couronne': {nom: 'Couronné', desc: 'Acheté à la boutique de points.', ico: 'crown', tier: 'or', cat: 'Boutique'},
  'bq-gemme': {nom: 'Chasseur de gemmes', desc: 'Acheté à la boutique de points.', ico: 'gem', tier: 'epique', cat: 'Boutique'}
};
const bqBadge = cle => BQ_BADGES[cle] ? {id: cle, ...BQ_BADGES[cle]} : null;
const BQ = [
  {id: 'pioche', kind: 'pioche', nom: 'Pioche Arcade', prix: 400, desc: 'Trois cartes Arcade tirées au hasard, tu en gardes une. Une seule par jour.'},
  ...[['Curieux', 150], ['Noctambule', 200], ['Œil de lynx', 250], ['Chasseur d’énigmes', 300], ['Collectionneur', 400], ['Gardien des Cartes', 600], ['Légende vivante', 1200], ['Roi de l’Arcade', 2000]]
    .map(([n, p]) => ({id: 't-' + nrm(n), kind: 'titre', nom: n, prix: p, val: n, desc: 'Un titre affiché sous ton pseudo.'})),
  ...[['etoile', 200], ['lune', 250], ['vue', 400], ['des', 350], ['couronne', 800], ['gemme', 1200]]
    .map(([k, p]) => ({id: 'bq-' + k, kind: 'badge', nom: BQ_BADGES['bq-' + k].nom, prix: p, cle: 'bq-' + k, desc: 'Un badge à ranger dans ta vitrine.'})),
  ...[['pixel', 'Pixel doré', 300], ['neon', 'Néon violet', 400], ['ronces', 'Ronces', 500], ['flamme', 'Flammes', 600], ['glace', 'Givre', 600], ['etoiles', 'Voie lactée', 700], ['arcade', 'Arcade RGB', 800], ['glitch', 'Glitch', 900], ['royal', 'Couronne royale', 1500]]
    .map(([k, n, p]) => ({id: 'c-' + k, kind: 'cadre', nom: n, prix: p, desc: 'Un cadre autour de ton avatar.'})),
  ...[['ville', 'Ville sous la pluie', 600], ['salle', 'Salle d’arcade', 700], ['foret', 'Forêt du Renard', 800], ['neon', 'Néons du Ronin', 900], ['station', 'Station du Pilote', 1000], ['tour', 'Tour du Bourreau', 1200], ['ile', 'Île du Pirate Fantôme', 1500], ['manoir', 'Manoir du Veilleur', 2000]]
    .map(([k, n, p]) => ({id: 'b-' + k, kind: 'banniere', nom: n, prix: p, desc: 'Une bannière animée en haut de ton profil.'})),
  ...[['or', 'Or', 250], ['rose', 'Rose', 250], ['cyan', 'Cyan', 250], ['vert', 'Vert', 250], ['arc', 'Arc-en-ciel animé', 700]]
    .map(([k, n, p]) => ({id: 'p-' + k, kind: 'couleur', nom: n, prix: p, desc: 'Une couleur pour ton pseudo.'}))
];
const BQ_PAR_ID = Object.fromEntries(BQ.map(x => [x.id, x]));
function ptsScore(h, id) { return h.un('SELECT COALESCE(SUM(pts),0) AS s FROM qparties WHERE joueur=?', id).s; }
function ptsEtat(h, j) {
  const score = ptsScore(h, j.id), depense = h.un('SELECT COALESCE(SUM(prix),0) AS s FROM bq_achats WHERE joueur=?', j.id).s, jour = jourParis();
  const prochain = PALIERS.find(p => score < p[0]);
  const qs = qStats(h, j), sem = ptsClassement(h, lundiDe(jour), joursPlus(lundiDe(jour), 6), 500), ix = sem.findIndex(r => r.id === j.id);
  return {score, solde: score - depense, rang: ix >= 0 ? ix + 1 : null, victoires: qs.victoires, parties: qs.jouees, serie: qs.serie, meilleure: qs.meilleure, joker: qs.joker, prochain: qs.prochain,
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
async function qAdmin(h, act, b) {
  if (act === 'q-jeux') return json(h.sql.exec('SELECT * FROM qjeux ORDER BY nom COLLATE NOCASE').toArray());
  if (act === 'q-jeux-set') {
    const l = (Array.isArray(b.jeux) ? b.jeux : []).map(x => ({nom: String(x.nom || '').trim().slice(0, 80), genre: String(x.genre || '').slice(0, 60), annee: parseInt(x.annee, 10) || 0, plateforme: String(x.plateforme || '').slice(0, 80), studio: String(x.studio || '').slice(0, 60), chaine: x.chaine ? 1 : 0})).filter(x => x.nom);
    if (l.length > 2000) return json({erreur: 'trop'}, {}, 400);
    h.run('DELETE FROM qjeux'); l.forEach(x => h.run('INSERT OR REPLACE INTO qjeux(nom,genre,annee,plateforme,studio,chaine) VALUES(?,?,?,?,?,?)', x.nom, x.genre, x.annee, x.plateforme, x.studio, x.chaine));
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
