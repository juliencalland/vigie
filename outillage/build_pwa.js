'use strict';
/*
 * Construction de la version PWA hébergée de Vigie Portefeuille.
 * Usage : node outillage/build_pwa.js "<chemin de calendrier_portefeuille.html>"
 * Produit dans le dossier du dépôt : index.html (SANS données de portefeuille),
 * manifest.webmanifest, sw.js, icon-192.png, icon-512.png, .nojekyll,
 * et ../vigie-donnees/etat.json si le dossier existe (état initial = seed du fichier source).
 * Chaque transformation est ancrée sur un texte UNIQUE du source et échoue bruyamment
 * si l'ancre a disparu (à re-vérifier après toute régénération par le prompt maître).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const vm = require('vm');

const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) { console.error('Source introuvable : ' + SRC); process.exit(1); }
const RACINE = path.join(__dirname, '..');
let h = fs.readFileSync(SRC, 'utf8');
const hSource = h;

function unique(marqueur, nom) {
  const n = h.split(marqueur).length - 1;
  if (n !== 1) { console.error('ANCRE « ' + nom + ' » trouvée ' + n + ' fois (attendu : 1)'); process.exit(1); }
}
function remplacer(marqueur, remplacement, nom) {
  unique(marqueur, nom);
  h = h.replace(marqueur, remplacement);
  console.log('OK  ' + nom);
}

/* T1 — commentaire d'en-tête HTML (contient des données de portefeuille) → générique */
const iC1 = h.indexOf('<!--');
const iC2 = h.indexOf('-->');
if (iC1 < 0 || iC2 < iC1) { console.error('Commentaire d’en-tête introuvable'); process.exit(1); }
h = h.slice(0, iC1) + '<!--\n  VIGIE PORTEFEUILLE — version PWA hébergée (code seul, AUCUNE donnée embarquée).\n  Générée par outillage/build_pwa.js depuis calendrier_portefeuille.html : ne pas éditer à la main.\n  Les données arrivent par la synchronisation GitHub (dépôt privé) ou par import de fichier.\n-->' + h.slice(iC2 + 3);
console.log('OK  T1 en-tête générique');

/* T2 — expurger le bloc DONNÉES DU JOUR (classification + montants) et les seeds */
const iS1 = h.indexOf('// ================================================================\n// DONNÉES DU JOUR');
const iS2 = h.indexOf('/* ================================================================\n   ÉTAT');
if (iS1 < 0 || iS2 < iS1) { console.error('Bloc seed introuvable'); process.exit(1); }
h = h.slice(0, iS1)
  + '// ================================================================\n'
  + '// VERSION PWA : AUCUNE donnée de portefeuille embarquée (dépôt public).\n'
  + '// ================================================================\n'
  + 'const Cst_SeedEtat = { releveAsOf: null, margin: null, positions: [], orders: [] };\n'
  + 'const Cst_SeedEvents = [];\n\n'
  + h.slice(iS2);
console.log('OK  T2 seeds expurgés');

/* T2b — commentaire de la section DONNÉES/CLASSIFICATION (cite des positions) → générique */
const iD1 = h.indexOf('/* ================================================================\n   DONNÉES / CLASSIFICATION');
if (iD1 < 0) { console.error('Section DONNÉES/CLASSIFICATION introuvable'); process.exit(1); }
const iD2 = h.indexOf('================================================================ */', iD1 + 60);
if (iD2 < 0) { console.error('Fin du commentaire DONNÉES/CLASSIFICATION introuvable'); process.exit(1); }
h = h.slice(0, iD1)
  + '/* ================================================================\n'
  + '   DONNÉES / CLASSIFICATION\n'
  + '   ----------------------------------------------------------------\n'
  + '   Version PWA : aucune classification embarquée (dépôt public). La\n'
  + '   taxonomie (CŒUR / CONVICTION / SATELLITE / COUVERTURE /\n'
  + '   SPÉCULATIF-LEVIER / ORDRES / FACTEURS) est portée par le prompt de\n'
  + '   MAJ (Fn_BuildPromptMAJ) ; les données arrivent par synchronisation\n'
  + '   ou import, chaque intégration passant par des cartes « à valider ».\n'
  + '   Les filtres (chips) sont générés dynamiquement depuis les tags des\n'
  + '   événements et les catégories réellement présentes.\n'
  + '   ' + h.slice(iD2);
console.log('OK  T2b commentaire classification expurgé');

/* T3 — <head> : manifest PWA, couleur de thème, icônes */
remplacer('<title>Vigie Portefeuille</title>',
  '<title>Vigie Portefeuille</title>\n'
  + '<link rel="manifest" href="manifest.webmanifest">\n'
  + '<meta name="theme-color" content="#0B1220">\n'
  + '<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">\n'
  + '<link rel="apple-touch-icon" href="icon-192.png">', 'T3 head PWA');

/* T4 — Fn_Save : planifier la poussée de synchronisation après chaque sauvegarde */
remplacer("    Fn_StorageSet(chaine);\n  } catch (e) { /* stockage indisponible",
  "    Fn_StorageSet(chaine);\n    Fn_SyncPlanifier();\n  } catch (e) { /* stockage indisponible", 'T4 hook Fn_Save');

/* T5 — module de synchronisation GitHub, inséré en fin de section PERSISTANCE */
const MODULE_SYNC = `/* ----------------------------------------------------------------
   SYNCHRONISATION GITHUB (version PWA) — l'état complet voyage via le
   dépôt privé ci-dessous ; « le plus récent gagne » par etatTs. La clé
   API Anthropic n'est JAMAIS synchronisée (stockage local par appareil).
   ---------------------------------------------------------------- */
const Cst_SyncDepot = 'juliencalland/vigie-donnees';
const Cst_SyncChemin = 'etat.json';
const Cst_CleSyncToken = 'vigie-portefeuille-ghtoken';
function Fn_GetSyncToken() { try { return localStorage.getItem(Cst_CleSyncToken) || ''; } catch (e) { return ''; } }
function Fn_SetSyncToken(t) { try { if (t) localStorage.setItem(Cst_CleSyncToken, t); else localStorage.removeItem(Cst_CleSyncToken); return true; } catch (e) { return false; } }
function Fn_SyncLibelle() { if (!Fn_GetSyncToken()) return 'sync non configurée'; return Var_State._runtime.syncLibelle || 'sync prête'; }
function Fn_SyncStatut(txt, ok) {
  Var_State._runtime.syncLibelle = txt;
  const el = document.getElementById('sync-etat');
  if (el) { el.textContent = txt; el.style.color = ok === false ? 'var(--crit)' : (ok === true ? 'var(--ok)' : ''); }
  const el2 = document.getElementById('p-sync-etat');
  if (el2) el2.textContent = txt;
}
function Fn_B64VersTexte(b64) {
  const bin = atob(String(b64).replace(/\\n/g, ''));
  const oct = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(oct);
}
function Fn_TexteVersB64(txt) {
  const oct = new TextEncoder().encode(txt);
  let bin = '';
  for (let i = 0; i < oct.length; i += 8192) bin += String.fromCharCode.apply(null, oct.subarray(i, i + 8192));
  return btoa(bin);
}
function Fn_SyncRequete(methode, corps) {
  const token = Fn_GetSyncToken();
  const entetes = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (corps) entetes['Content-Type'] = 'application/json';
  return fetch('https://api.github.com/repos/' + Cst_SyncDepot + '/contents/' + Cst_SyncChemin,
    { method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined });
}
function Fn_SerialiserEtat() {
  return JSON.stringify(Var_State, (k, v) => (k && k.charAt && k.charAt(0) === '_') ? undefined : v);
}
// Adoption d'un état complet (distant ou importé) SANS toucher etatTs (sinon boucle de poussée).
function Fn_AdopterEtat(s) {
  ['onglet', 'events', 'instruments', 'positions', 'orders', 'trades', 'margin', 'releveAsOf',
   'derniereConsolidation', 'actions', 'aValider', 'majJournaux', 'filtreTag', 'filtreJour',
   'zbId', 'freqRappel', 'etatTs'].forEach(c => { if (s[c] !== undefined) Var_State[c] = s[c]; });
  ['quotes', 'fundamentals', 'valuation', 'expertise', 'theses'].forEach(c => { if (s[c] && typeof s[c] === 'object') Var_State[c] = s[c]; });
  ['seuils', 'tarifs', 'cumulApi', 'panneaux'].forEach(c => { if (s[c] && typeof s[c] === 'object') Var_State[c] = Object.assign({}, Var_State[c], s[c]); });
  try { Fn_StorageSet(Fn_SerialiserEtat()); } catch (e) { /* session seulement */ }
}
async function Fn_SyncTirer(silencieux) {
  const rt = Var_State._runtime;
  if (!Fn_GetSyncToken()) return;
  try {
    Fn_SyncStatut('⟳ synchronisation…');
    const rep = await Fn_SyncRequete('GET');
    if (rep.status === 404) { rt.syncSha = null; Fn_SyncStatut('dépôt vide — envoi au prochain enregistrement', true); Fn_SyncPlanifier(); return; }
    if (rep.status === 401 || rep.status === 403) { Fn_SyncStatut('jeton refusé (' + rep.status + ') — vérifier le jeton', false); return; }
    if (!rep.ok) { Fn_SyncStatut('erreur GitHub ' + rep.status, false); return; }
    const d = await rep.json();
    rt.syncSha = d.sha || null;
    let distant = null;
    try { distant = JSON.parse(Fn_B64VersTexte(d.content)); } catch (e) { distant = null; }
    const tsDistant = distant ? (Fn_Num(distant.etatTs) || 0) : 0;
    const tsLocal = Fn_Num(Var_State.etatTs) || 0;
    // Ceinture de sécurité : un appareil sans substance locale (ni événement, ni
    // position, ni consolidation) ADOPTE toujours un distant rempli, quels que
    // soient les horodatages — on n'écrase jamais des données par du vide.
    const localVide = !Var_State.events.length && !Var_State.positions.length && !Var_State.derniereConsolidation;
    const distantPlein = !!(distant && (((distant.events || []).length) || ((distant.positions || []).length)));
    if (distant && (tsDistant > tsLocal || (localVide && distantPlein))) {
      Fn_AdopterEtat(distant);
      rt.syncDernierPushTs = tsDistant;
      Fn_SyncStatut('✓ état distant repris (' + Fn_FmtHeure(tsDistant) + ')', true);
      Fn_RenderVigie(); Fn_RenderCours(); Fn_RenderDiscipline(); Fn_RenderParametres();
    } else if (distant && tsDistant < tsLocal) {
      Fn_SyncStatut('état local plus récent — envoi…');
      Fn_SyncPousser();
    } else {
      rt.syncDernierPushTs = tsLocal;
      Fn_SyncStatut('✓ synchronisé (' + Fn_FmtHeure(tsLocal) + ')', true);
    }
  } catch (e) { Fn_SyncStatut('hors ligne — sync différée', false); }
}
function Fn_SyncPlanifier() {
  const rt = Var_State._runtime;
  if (!Fn_GetSyncToken()) return;
  if (rt.timers.syncPush) clearTimeout(rt.timers.syncPush);
  rt.timers.syncPush = setTimeout(() => { rt.timers.syncPush = null; Fn_SyncPousser(); }, 2500);
}
async function Fn_SyncPousser() {
  const rt = Var_State._runtime;
  if (!Fn_GetSyncToken()) return;
  if (rt.syncEnvoiEnCours) { rt.syncReplanifier = true; return; }
  if (rt.syncDernierPushTs === Var_State.etatTs) return; // rien de neuf à envoyer
  rt.syncEnvoiEnCours = true;
  try {
    Fn_SyncStatut('⟳ envoi…');
    const corps = { message: 'MAJ état Vigie ' + new Date().toISOString(), content: Fn_TexteVersB64(Fn_SerialiserEtat()) };
    if (rt.syncSha) corps.sha = rt.syncSha;
    let rep = await Fn_SyncRequete('PUT', corps);
    if (rep.status === 409 || rep.status === 422) {
      // Conflit d'écriture : re-tirer (le plus récent gagne) puis retenter si l'état local prime encore.
      await Fn_SyncTirer(true);
      if ((Fn_Num(Var_State.etatTs) || 0) > (rt.syncDernierPushTs || 0)) {
        const corps2 = { message: 'MAJ état Vigie (après conflit) ' + new Date().toISOString(), content: Fn_TexteVersB64(Fn_SerialiserEtat()) };
        if (rt.syncSha) corps2.sha = rt.syncSha;
        rep = await Fn_SyncRequete('PUT', corps2);
      } else { rt.syncEnvoiEnCours = false; return; }
    }
    if (rep && rep.ok) {
      const d = await rep.json();
      rt.syncSha = (d.content && d.content.sha) || rt.syncSha;
      rt.syncDernierPushTs = Var_State.etatTs;
      Fn_SyncStatut('✓ synchronisé (' + Fn_FmtHeure(Var_State.etatTs) + ')', true);
    } else if (rep) {
      Fn_SyncStatut('erreur envoi GitHub ' + rep.status, false);
    }
  } catch (e) { Fn_SyncStatut('hors ligne — sync différée', false); }
  finally {
    rt.syncEnvoiEnCours = false;
    if (rt.syncReplanifier) { rt.syncReplanifier = false; Fn_SyncPlanifier(); }
  }
}
// Import d'un état : fichier HTML exporté par la version locale (script#etat-embarque) ou etat.json brut.
function Fn_SyncImporterFichier(fichier) {
  const lecteur = new FileReader();
  lecteur.onload = () => {
    try {
      const t = String(lecteur.result || '');
      const m = t.match(/<script id="etat-embarque" type="application\\/json">([\\s\\S]*?)<\\/script>/);
      const s = m ? JSON.parse(m[1]) : JSON.parse(t);
      if (s && typeof s === 'object' && (Fn_Num(s.etatTs) || 0) > (Fn_Num(Var_State.etatTs) || 0)) {
        Fn_AdopterEtat(s);
        Fn_RenderVigie(); Fn_RenderCours(); Fn_RenderDiscipline(); Fn_RenderParametres();
        Fn_SyncStatut('✓ fichier importé (' + Fn_FmtHeure(s.etatTs) + ')', true);
        Fn_SyncPlanifier();
      } else {
        Fn_SyncStatut(s ? 'fichier plus ancien que l’état actuel — ignoré' : 'fichier illisible', false);
      }
    } catch (e) { Fn_SyncStatut('fichier illisible', false); }
  };
  lecteur.readAsText(fichier);
}

`;
remplacer('/* ================================================================\n   UTILITAIRES',
  MODULE_SYNC + '/* ================================================================\n   UTILITAIRES', 'T5 module sync');

/* T6 — carte Paramètres : remplacer la carte « fichier via OneDrive » par la carte GitHub */
const iK1 = h.indexOf("  // Synchronisation multi-appareils : l'état voyage DANS le fichier via OneDrive/Drive.");
const iK2 = h.indexOf('  // Accès API (section 6)');
if (iK1 < 0 || iK2 < iK1) { console.error('Carte synchronisation introuvable'); process.exit(1); }
const CARTE_SYNC = `  // Synchronisation GitHub multi-appareils (PWA)
  const tokenSync = Fn_GetSyncToken();
  h += '<div class="carte"><div class="carte-titre">Synchronisation entre appareils</div>'
    + '<div class="petit">L’état complet (MAJ, validations, coches, réglages) est synchronisé automatiquement entre vos appareils via votre dépôt GitHub privé <b class="mono">' + Fn_Esc(Cst_SyncDepot) + '</b> : tirage à l’ouverture, envoi ~3 s après chaque modification, « le plus récent gagne ». La clé API Anthropic n’est JAMAIS synchronisée (une saisie par appareil).</div>'
    + '<div class="tres-petit muted" style="margin:4px 0">État : <b id="p-sync-etat">' + Fn_Esc(Fn_SyncLibelle()) + '</b> · dernière modification locale : <b class="mono">' + Fn_Esc(Var_State.etatTs ? Fn_FmtHeure(Var_State.etatTs) : '—') + '</b></div>'
    + '<label class="champ">Jeton GitHub (fine-grained, limité au dépôt de données) — ' + (tokenSync ? 'enregistré (…' + Fn_Esc(tokenSync.slice(-4)) + ')' : 'aucun') + '</label>'
    + '<div style="display:flex;gap:8px"><input type="password" id="p-ghtoken" placeholder="github_pat_…" autocomplete="off" title="Jeton GitHub">'
    + '<button type="button" class="btn" data-action="ghtoken-voir" style="flex:none">👁</button></div>'
    + '<div class="rang-btn">'
    + '<button type="button" class="btn btn-accent" data-action="ghtoken-enregistrer">Enregistrer le jeton</button>'
    + '<button type="button" class="btn" data-action="sync-maintenant">Synchroniser maintenant</button>'
    + (tokenSync ? '<button type="button" class="btn btn-danger' + (rt.armes['ghtoken-effacer'] ? ' arme' : '') + '" data-action="ghtoken-effacer">' + (rt.armes['ghtoken-effacer'] ? 'Confirmer ?' : 'Effacer le jeton') + '</button>' : '')
    + '</div>'
    + '<div class="tres-petit muted" style="margin-top:6px">Créer le jeton (une seule fois, puis le coller sur chaque appareil) : github.com → photo de profil → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token · Repository access : <b>Only select repositories → vigie-donnees</b> · Permissions → Repository permissions → <b>Contents : Read and write</b> · Expiration : 1 an. Ce jeton ne donne accès qu’au dépôt de données, à rien d’autre.</div>'
    + '<hr class="sep"><label class="champ">Importer un état (fichier HTML exporté par la version locale, ou etat.json)</label>'
    + '<label class="btn">Choisir le fichier<input type="file" accept=".html,.json,text/html,application/json" data-action="sync-importer" style="display:none"></label>'
    + '<div class="tres-petit muted" style="margin-top:4px">Le bouton « Télécharger le fichier à jour » du bilan de MAJ reste disponible comme sauvegarde : le fichier produit se réimporte ici.</div>'
    + '</div>';
`;
h = h.slice(0, iK1) + CARTE_SYNC + h.slice(iK2);
console.log('OK  T6 carte GitHub');

/* T7 — indicateur de sync dans l'en-tête */
remplacer("    + (Var_State.releveAsOf ? ' · relevé du <b class=\"mono\">' + Fn_Esc(Var_State.releveAsOf) + '</b>' : '');",
  "    + (Var_State.releveAsOf ? ' · relevé du <b class=\"mono\">' + Fn_Esc(Var_State.releveAsOf) + '</b>' : '');\n  el.innerHTML += ' · <span id=\"sync-etat\" class=\"tres-petit\">' + Fn_Esc(Fn_SyncLibelle()) + '</span>';", 'T7 indicateur en-tête');

/* T8 — routage des actions du jeton + import */
remplacer("    case 'cle-voir': {",
  `    case 'ghtoken-voir': {
      const inp = document.getElementById('p-ghtoken');
      if (inp) inp.type = (inp.type === 'password') ? 'text' : 'password';
      break;
    }
    case 'ghtoken-enregistrer': {
      const inp = document.getElementById('p-ghtoken');
      const val = inp ? inp.value.trim() : '';
      if (val) { Fn_SetSyncToken(val); if (inp) inp.value = ''; Fn_RenderParametres(); Fn_RenderEntete(); Fn_SyncTirer(); }
      break;
    }
    case 'ghtoken-effacer': {
      Fn_DoubleTap('ghtoken-effacer', () => { Fn_SetSyncToken(''); Fn_RenderParametres(); Fn_RenderEntete(); }, () => Fn_RenderParametres());
      break;
    }
    case 'sync-maintenant': { Fn_SyncTirer(); break; }
    case 'cle-voir': {`, 'T8 actions jeton');
remplacer("    case 'these-check': {",
  `    case 'sync-importer': {
      const fichier = el.files && el.files[0];
      if (fichier) Fn_SyncImporterFichier(fichier);
      break;
    }
    case 'these-check': {`, 'T8b import');

/* T9 — init : service worker + tirage borné à 4 s */
remplacer('  await Fn_Load();',
  `  await Fn_Load();
  // PWA : service worker (hors ligne) + tirage de l'état distant, borné à 4 s
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    try { navigator.serviceWorker.register('sw.js'); } catch (e) { /* hors PWA */ }
  }
  await Promise.race([Fn_SyncTirer(true), new Promise(r => setTimeout(r, 4000))]);`, 'T9 init PWA');

/* Vérifications finales : terminaison de script façon navigateur + aucune donnée résiduelle */
const debutJs = h.indexOf('<script>') + 8;
const finJs = h.slice(debutJs).search(/<\/script/i);
const js = h.slice(debutJs, debutJs + finJs);
if (!/^<\/script>\s*<\/body>\s*<\/html>\s*$/.test(h.slice(debutJs + finJs))) { console.error('ANOMALIE : premier </script ≠ vraie fermeture'); process.exit(1); }
if (/<!--/.test(js)) { console.error('ANOMALIE : <!-- dans le JS'); process.exit(1); }
['AMAT', 'RIBER', 'Riber', 'SpineGuard', 'Moncler', 'DE000BB27DG5', '46 727', '46727', 'Applied Materials'].forEach(m => {
  if (h.indexOf(m) >= 0) { console.error('DONNÉE RÉSIDUELLE dans la version publique : ' + m); process.exit(1); }
});
new vm.Script(js); // vérification de syntaxe
fs.writeFileSync(path.join(RACINE, 'index.html'), h);
console.log('OK  index.html écrit (' + h.length + ' octets)');

/* manifest + service worker (horodatage de cache = déploiement) */
fs.writeFileSync(path.join(RACINE, 'manifest.webmanifest'), JSON.stringify({
  name: 'Vigie Portefeuille',
  short_name: 'Vigie',
  description: 'Vigie de portefeuille : calendrier des catalyseurs, discipline, consolidation par IA',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#0B1220',
  theme_color: '#0B1220',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));
const horodatage = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
fs.writeFileSync(path.join(RACINE, 'sw.js'), `'use strict';
// Service worker Vigie — coquille en cache (hors ligne), réseau d'abord pour la page.
// N'intercepte JAMAIS les autres origines (api.anthropic.com, api.github.com).
const CACHE = 'vigie-${horodatage}';
const COQUILLE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    e.respondWith(fetch(e.request).then(r => {
      const copie = r.clone();
      caches.open(CACHE).then(c => c.put('./index.html', copie));
      return r;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
`);
fs.writeFileSync(path.join(RACINE, '.nojekyll'), '');
console.log('OK  manifest + sw (' + horodatage + ') + .nojekyll');

/* Icônes PNG sans dépendance : 3 chandeliers sur fond sombre */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const long = Buffer.alloc(4); long.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([long, t, data, crc]);
}
function png(taille) {
  const px = Buffer.alloc(taille * taille * 4);
  const ech = taille / 512;
  function rect(x, y, w, hh, r, g, b) {
    const x1 = Math.round(x * ech), y1 = Math.round(y * ech), x2 = Math.round((x + w) * ech), y2 = Math.round((y + hh) * ech);
    for (let yy = y1; yy < y2; yy++) for (let xx = x1; xx < x2; xx++) {
      const i = (yy * taille + xx) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  rect(0, 0, 512, 512, 11, 18, 32);            // fond #0B1220
  rect(150, 150, 12, 240, 70, 196, 138);        // mèche verte
  rect(116, 210, 80, 120, 70, 196, 138);        // corps vert  #46C48A
  rect(260, 96, 12, 240, 78, 161, 243);         // mèche bleue
  rect(226, 150, 80, 118, 78, 161, 243);        // corps bleu  #4EA1F3
  rect(370, 170, 12, 240, 224, 82, 107);        // mèche rouge
  rect(336, 232, 80, 118, 224, 82, 107);        // corps rouge #E0526B
  const lignes = [];
  for (let y = 0; y < taille; y++) {
    lignes.push(Buffer.concat([Buffer.from([0]), px.subarray(y * taille * 4, (y + 1) * taille * 4)]));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0); ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(lignes), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
fs.writeFileSync(path.join(RACINE, 'icon-512.png'), png(512));
fs.writeFileSync(path.join(RACINE, 'icon-192.png'), png(192));
console.log('OK  icônes 192/512');

/* etat.json initial pour le dépôt privé : l'état seed du fichier SOURCE (via vm + stubs) */
const depotDonnees = path.join(RACINE, '..', 'vigie-donnees');
if (fs.existsSync(depotDonnees)) {
  const dSrc = hSource.indexOf('<script>') + 8;
  const fSrc = hSource.slice(dSrc).search(/<\/script/i);
  const jsSrc = hSource.slice(dSrc, dSrc + fSrc);
  const els = {};
  const faireEl = id => ({ id, innerHTML: '', textContent: '', hidden: true, type: '', value: '', checked: false, files: null, style: {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } }, getAttribute() { return null; }, setAttribute() {}, addEventListener() {}, contains() { return false; }, getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 }; }, scrollIntoView() {}, click() {}, remove() {} });
  const ctx = {
    window: { innerWidth: 400, innerHeight: 800, addEventListener() {} },
    document: { getElementById(id) { return els[id] || (els[id] = faireEl(id)); }, querySelectorAll() { return []; }, addEventListener() {}, createElement: t => faireEl(t), head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { cloneNode() { return { querySelector: () => null, outerHTML: '' }; } } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Intl, JSON, Math, Date, Number, String, Object, Array, RegExp, Promise, isNaN, parseFloat, parseInt,
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout, console,
    TextDecoder, AbortController, fetch: () => Promise.reject(new TypeError('x')), FileReader: function () {}
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(jsSrc, ctx);
  setTimeout(() => {
    const etat = vm.runInContext("Var_State.etatTs = Date.now(); JSON.stringify(Var_State, (k, v) => (k && k.charAt && k.charAt(0) === '_') ? undefined : v)", ctx);
    fs.writeFileSync(path.join(depotDonnees, 'etat.json'), etat);
    console.log('OK  etat.json initial (' + etat.length + ' octets, seed du fichier source)');
    console.log('CONSTRUCTION TERMINÉE');
  }, 200);
} else {
  console.log('(dépôt vigie-donnees absent — etat.json non généré)');
  console.log('CONSTRUCTION TERMINÉE');
}
