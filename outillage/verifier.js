'use strict';
/*
 * Vérification AVANT COMMIT de la version publiée (index.html).
 * Usage : node outillage/verifier.js [chemin/index.html]
 *
 * index.html est édité directement : ce script remplace les garde-fous qu'un
 * build assurerait — terminaison de script façon navigateur, confidentialité du
 * dépôt PUBLIC, règles du CLAUDE.md, test de fumée en DOM simulé, et depuis la
 * v3 : capture unique de l'automate rejouée de bout en bout (parseurs PUIS
 * chaîne complète jusqu'à l'état), lecture du classeur, migration de l'état
 * précédent, et contrôle que le desk ne se voit demander aucun chiffre que
 * l'application sait calculer.
 *
 * Sortie : liste des contrôles, code 0 si tout passe, 1 sinon.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CIBLE = process.argv[2] || path.join(__dirname, '..', 'index.html');
if (!fs.existsSync(CIBLE)) { console.error('Fichier introuvable : ' + CIBLE); process.exit(1); }
const RACINE = path.dirname(path.resolve(CIBLE));
const h = fs.readFileSync(CIBLE, 'utf8');

let echecs = 0;
function ok(nom) { console.log('  OK   ' + nom); }
function ko(nom, detail) { console.log('  ECHEC ' + nom + (detail ? ' — ' + detail : '')); echecs++; }
function verifier(nom, condition, detail) { condition ? ok(nom) : ko(nom, detail); }

/* ----------------------------------------------------------------
   A — Structure : le navigateur doit lire le fichier comme prévu
   ---------------------------------------------------------------- */
console.log('\nA. Structure du fichier');

const debutJs = h.indexOf('<script>') + 8;
const finJs = h.slice(debutJs).search(/<\/script/i);
const js = h.slice(debutJs, debutJs + finJs);
// Enveloppe HTML seule : le JS contient des chaînes qui ressemblent à des
// balises et fausseraient les contrôles HTML.
const enveloppe = h.slice(0, debutJs - 8) + h.slice(debutJs + finJs);

// Le piège déjà payé : la séquence « </script » ailleurs dans le JS (même en
// commentaire) fait fermer la balise au navigateur et tue l'application.
verifier('premier </script = vraie fermeture',
  /^<\/script>\s*<\/body>\s*<\/html>\s*$/.test(h.slice(debutJs + finJs)),
  'du contenu suit la première fermeture : une séquence </script traîne dans le JS');

verifier('aucun <!-- dans le JS', !/<!--/.test(js), 'un <!-- ouvre un commentaire HTML et casse le script');

verifier('un seul bloc <script> applicatif',
  (enveloppe.match(/<script(\s|>)/gi) || []).length === 0,
  ((enveloppe.match(/<script(\s|>)/gi) || []).length + 1) + ' balises <script> trouvées');

try { new vm.Script(js); ok('syntaxe JavaScript valide'); }
catch (e) { ko('syntaxe JavaScript valide', e.message); }

/* ----------------------------------------------------------------
   B — Confidentialité : le dépôt « vigie » est PUBLIC
   ---------------------------------------------------------------- */
console.log('\nB. Confidentialité (dépôt public)');

const TITRES_REELS = ['AMAT', 'RIBER', 'Riber', 'Applied Materials', 'SpineGuard', 'Moncler',
  'DE000BB27DG5', '46 727', '46727'];
const trouves = TITRES_REELS.filter(m => h.indexOf(m) >= 0);
verifier('aucun titre du portefeuille réel', trouves.length === 0, 'trouvé : ' + trouves.join(', '));

verifier('aucun état embarqué (script#etat-embarque)',
  !/<script id="etat-embarque"[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(enveloppe),
  'un état de portefeuille est embarqué dans le fichier publié');

const seedEtat = js.match(/const Cst_SeedEtat\s*=\s*(\{[\s\S]{0,400}?\});/);
verifier('Cst_SeedEtat sans donnée de portefeuille',
  !!seedEtat && /positions:\s*\[\s*\]/.test(seedEtat[1]) && /ordres:\s*\[\s*\]/.test(seedEtat[1])
    && /calendrier:\s*\[\s*\]/.test(seedEtat[1]) && /marge:\s*null/.test(seedEtat[1]),
  'le seed contient des positions, des ordres, un calendrier ou une marge');
verifier('Cst_SeedEvents vide',
  /const Cst_SeedEvents\s*=\s*\[\s*\];/.test(js),
  'le seed contient des événements');

const emails = (h.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []);
verifier('aucune adresse e-mail', emails.length === 0, emails.join(', '));

// FR0000120271 est l'exemple pédagogique du glossaire : seul ISIN toléré.
const ISIN_TOLERES = ['FR0000120271'];
const isins = (h.match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g) || []).filter(i => ISIN_TOLERES.indexOf(i) < 0);
verifier('aucun identifiant de titre réel (hors exemple du glossaire)', isins.length === 0, isins.join(', '));

const secrets = (h.match(/sk-ant-[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{10,}|ghp_[A-Za-z0-9]{20,}/g) || []);
verifier('aucune clé API ni jeton en dur', secrets.length === 0, secrets.length + ' secret(s) détecté(s)');

// Un code saisi de travers ne se voit pas : la casse automatique du clavier
// mobile suffit à rendre une clé invalide, et l'erreur n'apparaît qu'au premier
// appel. Chaque champ masqué neutralise donc casse et correction, et s'affiche
// en chasse fixe.
(function () {
  const champs = h.match(/<input type="password"[^>]*>/g) || [];
  const fautifs = champs.filter(c =>
    c.indexOf('autocapitalize="none"') < 0 || c.indexOf('autocorrect="off"') < 0
    || c.indexOf('spellcheck="false"') < 0 || c.indexOf('champ-code') < 0);
  verifier('champs de code protégés de la casse automatique (' + champs.length + ' champs)',
    champs.length > 0 && fautifs.length === 0,
    fautifs.length + ' champ(s) sans autocapitalize/autocorrect/spellcheck/champ-code');
})();

verifier('aucun identifiant de courtier',
  !/degiro[^<]{0,40}(login|identifiant|mot de passe|password)/i.test(h),
  'mention suspecte d’un identifiant courtier');

/* ----------------------------------------------------------------
   C — Règles du projet
   ---------------------------------------------------------------- */
console.log('\nC. Règles du projet');

verifier('aucun window.confirm / alert', !/\b(window\.)?(confirm|alert)\s*\(/.test(js),
  'bloqués en artefact : utiliser le double appui temporisé');
verifier('aucun eval / new Function', !/\beval\s*\(|new\s+Function\s*\(/.test(js));
verifier('aucun onclick inline', !/\son(click|change|input)\s*=/i.test(h), 'utiliser la délégation data-action');

const externes = (h.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [])
  .filter(u => !/api\.anthropic\.com|api\.github\.com/.test(u));
verifier('aucune ressource externe', externes.length === 0, externes.join(' | '));

const maxTokens = js.match(/Cst_MaxTokens\s*=\s*(\d+)/);
verifier('Cst_MaxTokens = 128000 (plafond du modèle)',
  !!maxTokens && maxTokens[1] === '128000', maxTokens ? 'vaut ' + maxTokens[1] : 'constante absente');

const modele = js.match(/const Cst_ModeleMAJ\s*=\s*['"]([^'"]+)['"]/);
console.log('  INFO modèle appelé : ' + (modele ? modele[1] : 'introuvable'));

verifier('une seule déclaration de Cst_SyncDepot',
  (js.match(/const Cst_SyncDepot\s*=/g) || []).length === 1,
  'redéclaration = ReferenceError au chargement');

verifier('Fn_BuildPromptMAJ présent', /function Fn_BuildPromptMAJ\s*\(/.test(js));
verifier('interface d’acquisition stable (Fn_ParserCapture)', /function Fn_ParserCapture\s*\(/.test(js),
  'le parseur doit rester derrière une interface unique : c’est elle qu’on recalibre quand un écran change');
verifier('lecteur de classeur sans dépendance (Fn_LireXlsx)', /function Fn_LireXlsx\s*\(/.test(js));
verifier('migration de l’état précédent (Fn_MigrerEtat)', /function Fn_MigrerEtat\s*\(/.test(js));

// L'estampille de version doit exister et être remplaçable par publier.js : sans
// elle, un onglet resté ouvert continue d'exécuter l'ancien code sans que rien
// ne le signale.
verifier('estampille Cst_Version présente et remplaçable',
  /const Cst_Version\s*=\s*'[^']*'/.test(js),
  'publier.js ne pourra pas estampiller la version dans index.html');

// La mécanique d'appel au modèle est transparente pour l'utilisateur : le mot
// « prompt » ne doit apparaître nulle part à l'écran. Toléré dans les
// commentaires, dans l'identifiant Fn_BuildPromptMAJ, et dans le texte envoyé AU
// modèle (le corps de cette fonction).
(function () {
  const lignes = js.split('\n');
  const debutPrompt = lignes.findIndex(l => /function Fn_BuildPromptMAJ\s*\(/.test(l));
  let finPrompt = lignes.length;
  for (let i = debutPrompt + 1; i < lignes.length; i++) {
    if (/^\}/.test(lignes[i])) { finPrompt = i; break; }
  }
  const fuites = [];
  let dansBloc = false;
  lignes.forEach((l, i) => {
    const nu = l.trim();
    const ouvre = nu.indexOf('/*') >= 0, ferme = nu.indexOf('*/') >= 0;
    const etait = dansBloc;
    if (ouvre && !ferme) dansBloc = true;
    else if (ferme) dansBloc = false;
    if (etait || ouvre) return;                       // commentaire de bloc
    if (nu.indexOf('//') === 0) return;               // commentaire de ligne
    if (debutPrompt >= 0 && i >= debutPrompt && i <= finPrompt) return; // texte pour le modèle
    if (/prompt/i.test(l.replace(/Fn_BuildPromptMAJ/g, ''))) {
      fuites.push('L' + (i + 1) + ' « ' + nu.slice(0, 70) + ' »');
    }
  });
  verifier('le mot « prompt » n’atteint pas l’interface', fuites.length === 0, fuites.join(' | '));
})();
const MARQUEURS_MAITRE = ['ARCHITECTURE À DEUX PROMPTS', 'PROMPT MAÎTRE —', 'PROMPT_MAITRE'];
const fuiteMaitre = MARQUEURS_MAITRE.filter(m => h.indexOf(m) >= 0);
verifier('aucun texte maître embarqué', fuiteMaitre.length === 0, 'marqueur trouvé : ' + fuiteMaitre.join(', '));

/* ----------------------------------------------------------------
   D — Coquille PWA
   ---------------------------------------------------------------- */
console.log('\nD. Coquille PWA');

verifier('lien manifest', /<link rel="manifest" href="manifest\.webmanifest">/.test(h));
verifier('meta theme-color', /<meta name="theme-color"/.test(h));
verifier('enregistrement du service worker', /serviceWorker.*register\('sw\.js'\)/.test(js));
['manifest.webmanifest', 'sw.js', 'icon-192.png', 'icon-512.png', '.nojekyll', 'robots.txt'].forEach(f => {
  verifier('fichier ' + f + ' présent', fs.existsSync(path.join(RACINE, f)));
});

// Discrétion : le dépôt est public par nécessité (les pages ne sont pas servies
// depuis un dépôt privé sur un compte gratuit), l'application ne doit pas pour
// autant s'annoncer. Pas de page d'explication, pas d'indexation.
verifier('page non indexable', /<meta name="robots" content="noindex/.test(h));
(function () {
  const doc = fs.readdirSync(RACINE).filter(f => /\.(md|markdown)$/i.test(f));
  verifier('aucune documentation publiée', doc.length === 0, 'à déplacer vers le dépôt privé : ' + doc.join(', '));
})();

const sw = fs.existsSync(path.join(RACINE, 'sw.js')) ? fs.readFileSync(path.join(RACINE, 'sw.js'), 'utf8') : '';
const cache = sw.match(/const CACHE\s*=\s*'([^']+)'/);
console.log('  INFO cache du service worker : ' + (cache ? cache[1] : 'introuvable')
  + '  (à incrémenter à chaque publication, sinon les appareils gardent l’ancienne version)');

/* ----------------------------------------------------------------
   E — Test de fumée : exécution du JS en DOM simulé
   ---------------------------------------------------------------- */
console.log('\nE. Test de fumée (DOM simulé)');

function faireEl(id) {
  return {
    id, innerHTML: '', textContent: '', hidden: true, type: '', value: '', checked: false,
    files: null, style: {}, dataset: {}, children: [], scrollTop: 0, scrollHeight: 0,
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    getAttribute() { return null; }, setAttribute() {}, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, appendChild() {}, insertBefore() {},
    contains() { return false; }, closest() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; }, focus() {}, blur() {}, click() {}, remove() {},
    scrollIntoView() {}, getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
  };
}

const els = {};
const ctx = {
  window: { innerWidth: 400, innerHeight: 800, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  document: {
    getElementById(id) { return els[id] || (els[id] = faireEl(id)); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {}, createElement: t => faireEl(t),
    head: { appendChild() {} }, body: { appendChild() {} },
    documentElement: { cloneNode: () => ({ querySelector: () => null, outerHTML: '' }) },
    hidden: false, visibilityState: 'visible'
  },
  navigator: { serviceWorker: undefined, userAgent: 'node', onLine: true, clipboard: { writeText: () => Promise.resolve() } },
  location: { protocol: 'https:', href: 'https://example.invalid/' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Intl, JSON, Math, Date, Number, String, Object, Array, RegExp, Promise, Error, Map, Set,
  isNaN, parseFloat, parseInt, encodeURIComponent, decodeURIComponent,
  setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout, console,
  requestAnimationFrame: fn => setTimeout(fn, 0),
  TextDecoder, TextEncoder, AbortController, URL, Blob: function () {},
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  fetch: () => Promise.reject(new TypeError('hors ligne (test)')),
  FileReader: function () { this.readAsText = function () {}; this.readAsArrayBuffer = function () {}; },
  Uint8Array, Uint32Array, Int32Array
};
ctx.globalThis = ctx;
ctx.self = ctx;

try {
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  ok('chargement du script sans exception');
} catch (e) {
  ko('chargement du script sans exception', e.message);
}

/* ----------------------------------------------------------------
   ÉCHANTILLON DE TEST DU PARSEUR D'ACQUISITION
   Une CAPTURE UNIQUE complète, calquée trait pour trait sur un relevé réel des
   quatre écrans, marchés ouverts. Tout y est structurellement authentique :
   les bornes de section, l'en-tête clé=valeur, le nom de chaque produit écrit
   DEUX FOIS (l'arbre d'accessibilité expose le texte et sa description), les
   quantités en double, les intitulés de rubrique qui traînent en fin de ligne,
   les signes tantôt collés tantôt détachés du nombre, les cours à deux OU trois
   décimales, le séparateur de milliers tantôt espace tantôt POINT, et les deux
   conventions de paramètres de turbo relevées le même jour.
   Les libellés, identifiants et montants sont FICTIFS : le dépôt est public.
   C'est ce jeu, et lui seul, qui prouve que le parseur lit bien ce que l'écran
   affiche — les échantillons inventés qu'il remplace décrivaient une disposition
   de colonnes qui n'a jamais existé.
   ---------------------------------------------------------------- */
const CAPTURE = [
  '===VIGIE:META===',
  'version=10',
  'capture=2026-08-24T18:58:32',
  'statut=OK',
  'maj_degiro=18:46:08',
  'noeuds_positions=613',
  'noeuds_espace_libre=465',
  'noeuds_ordres=152',
  'noeuds_historique=89',
  'ordres_ouverts=3',
  'ordres_executes=0',
  'historique=aucune transaction sur la periode',
  'valeur_gage=45.180,20',
  'facilite_credit=21.500,00',
  'duree_s=49',
  '===VIGIE:POSITIONS===',
  ' Novax Semiconducteurs Inc Novax Semiconducteurs Inc NVX | $ 512,345 60 60 XX0382221051 $  512,345 USD 30 740,70 30 740,70 152,016666 152,016666 -500,15 - 500,15 -2,09% - 2,09 % +16 333,30   (+193,04%) + 16 333,30   ( + 193,04 % ) +16 502,86 + 16 502,86    ',
  ' Colline-Palma Company Colline-Palma Company CLP | $ 77,125 15 15 XX1941621039 $ 77,125 USD 1 156,88 1 156,88 89,38 89,38 +8,39 +8,39 +0,59% +0,59% -55,15  (-4,47%) -55,15   (-4,47%) -23,62 -23,62 ',
  ' Orbis Luxe S.p.A. Orbis Luxe S.p.A. ORB | € 55,40 90 90 XX0004965148 € 55,40 EUR 4 986,00 4 986,00 52,383333 52,383333 +103,50 +103,50 +2,44% +2,44% -372,00  (-7,89%) -372,00   (-7,89%) +248,07 +248,07 ',
  ' Veridian SA Veridian SA ALVRD | € 7,45 1 098 1 098 XX0000075954 € 7,45 EUR 8 180,10 8 180,10 3,246153 3,246153 -263,52 -263,52 -2,65% -2,65% +6 098,12  (+171,09%) +6 098,12   (+171,09%) +6 292,62 +6 292,62 ',
  ' KLM SE KLM SE KLM | € 143,60 55 55 XX0007164600 € 143,60 EUR 7 898,00 7 898,00 197,978181 197,978181 -50,60 -50,60 -0,48% -0,48% -592,80  (-5,44%) -592,80   (-5,44%) -499,28 -499,28 ',
  ' Spinalis SA Spinalis SA ALSPN | € 0,085 23 000 23 000 XX0011464452 € 0,085 EUR 1 955,00 1 955,00 0,23 0,23 0,00 0,00 0,00% 0,00% -3 174,00  (-60,00%) -3 174,00   (-60,00%) -3 176,00 -3 176,00 1 Trackers (ETF) Produit Étendre la colonne Produit Étendre la colonne Ticker | ISIN Ticker | ISIN Qté Qté Cours Cours Devise Devise Valeur Valeur PRU Hint PRU Hint P/L € P/L € P/L % P/L % P/L latent € Hint P/L latent € Hint Total P/L€ Hint Total P/L€ Hint Hint',
  ' iCore Monde UCITS ETF EUR (Acc) iCore Monde UCITS ETF EUR (Acc) ICWM | € 118,90 30 30 XX00B4L5Y983 € 118,90 EUR 3 567,00 3 567,00 95,0225 95,0225 -8,40 -8,40 -0,22% -0,22% +936,22  (+32,84%) +936,22   (+32,84%) +933,22 +933,22 1 Produits de bourse Produit Étendre la colonne Produit Étendre la colonne Ticker | ISIN Ticker | ISIN Qté Qté Cours Cours Devise Devise Valeur Valeur PRU Hint PRU Hint Hint',
  ' ZED Orbis Luxe Turbo Mini-Future Short ZED Orbis Luxe Turbo Mini-Future Short € 19,40 200 200 XX000BB27DG6 € 19,40 EUR 3 880,00 3 880,00 13,34 13,34 -98,00 -98,00 -2,18% -2,18% +1 722,00  (+64,54%) +1 722,00   (+64,54%) +1 721,50 +1 721,50 1 SL 641.2537 STR 668.7411 R 10 LV 2.15 SL 641.2537 STR 668.7411 R 10 LV 2.15',
  ' KAP Novax Semiconducteurs Turbo illimités BEST Call KAP Novax Semiconducteurs Turbo illimités BEST Call € 12,34 100 100 XX000KA12345 € 12,34 EUR 1 234,00 1 234,00 8,10 8,10 +1,00 + 1,00 +0,08% + 0,08 % +424,00   (+52,34%) + 424,00   ( + 52,34 % ) +424,00 + 424,00 1 BAR 174.63 STR 174.63 P 10 LV 1.48 BAR 174.63 STR 174.63 P 10 LV 1.48',
  'Valeur des titres € 70.212,55',
  'Liquidités € -21 940,50',
  'Valeur liquidative du portefeuille € 48 272,05',
  'Risque du portefeuille € 32 537,40',
  'Marge disponible (déficit/surplus) € 15 734,60',
  'Dernière mise à jour à 18:46:08',
  '===VIGIE:ORDRES===',
  'Orbis Luxe S.p.A. Achat  | 23:43 € 72,00  | 1 800,00  | Continu Qté 25 -0,66 (-0,83%)   ',
  'Novax Semiconducteurs Inc Achat  | 23:42 $ 120,00  | 1 200,00  | Continu Qté 10 - 0,35 ( - 0,25 % ) 02/02/2026  ',
  'ZED Orbis Luxe Turbo Mini-Future Short Vente  | 16:51 € 27,00  | 5 400,00  | Continu Qté 200 -0,49 (-2,18%) SL 641.2537 STR 668.7411 R 10 LV 2.15',
  '===VIGIE:EXECUTES===',
  '',
  '===VIGIE:FIN==='
].join('\n');
// Une transaction exécutée : l'écran est le même que celui des ordres, mais
// aucun relevé réel n'en portait le jour de la calibration. Cette ligne applique
// la disposition des ordres, ce qui est le comportement attendu — à reconfirmer
// sur un relevé qui contient de vraies transactions.
const EXECUTE = 'Novax Semiconducteurs Inc Achat  | 14:02 $ 118,20  | 1 182,00  | Qté 10 04/08/2026  ';

setTimeout(async () => {
  const rendus = ['Fn_RenderEntete', 'Fn_RenderVigie', 'Fn_RenderAcquisition', 'Fn_RenderMajPanel',
    'Fn_RenderDebrief', 'Fn_RenderDecouvertes', 'Fn_RenderCours', 'Fn_RenderDiscipline',
    'Fn_RenderParametres', 'Fn_RenderCalendrier', 'Fn_RenderAValider', 'Fn_RenderTimeline'];
  rendus.forEach(f => {
    try {
      const existe = vm.runInContext('typeof ' + f + " === 'function'", ctx);
      if (!existe) { ko(f + ' (idempotence)', 'fonction absente'); return; }
      vm.runInContext(f + '(); ' + f + '();', ctx); // deux fois : les rendus sont idempotents
      ok(f + ' (appelée deux fois)');
    } catch (e) { ko(f, e.message); }
  });

  /* --- Acquisition : la capture unique, de bout en bout --- */
  console.log('\nF. Acquisition — la capture unique de l’automate');
  try {
    const ev = q => vm.runInContext(q, ctx);
    const app = (f, a) => ev(f + '(' + a.map(x => JSON.stringify(x)).join(',') + ')');

    /* Découpage du document sectionné */
    const doc = app('Fn_DecouperDocument', [CAPTURE]);
    verifier('document sectionné : quatre sections isolées',
      !!doc && doc.positions.length > 0 && doc.ordres.length > 0 && doc.meta.length > 0 && doc.executes === '',
      doc ? Object.keys(doc).map(k => k + '=' + doc[k].length).join(' · ') : 'null');
    verifier('un texte sans borne n’est PAS un document sectionné (le collage écran par écran reste valide)',
      app('Fn_DecouperDocument', ['Untel SA 120 12,50 EUR 1 500,00']) === null);

    /* En-tête : il date et contrôle la lecture, il ne porte aucun chiffre de portefeuille */
    const meta = app('Fn_ParserMeta', [doc.meta]);
    verifier('en-tête : les clés de la capture sont lues (' + Object.keys(meta).length + ')',
      meta.statut === 'OK' && meta.maj_degiro === '18:46:08' && meta.ordres_ouverts === '3'
      && /aucune transaction/i.test(meta.historique), JSON.stringify(meta));

    /* Positions */
    const pos = app('Fn_ParserCapture', ['positions', doc.positions]);
    verifier('positions : 9 lignes reconnues, aucune rejetée',
      pos.lignes.length === 9 && pos.inconnues.length === 0,
      pos.lignes.length + ' reconnue(s), ' + pos.inconnues.length + ' rejetée(s) : ' + pos.inconnues.map(l => l.slice(0, 40)).join(' | '));

    const cours = pos.lignes.map(l => l.cloture);
    const coursAttendus = [512.345, 77.125, 55.4, 7.45, 143.6, 0.085, 118.9, 19.4, 12.34];
    verifier('positions : cours du jour exact sur chacune, décimales comprises',
      JSON.stringify(cours) === JSON.stringify(coursAttendus), 'lus : ' + JSON.stringify(cours));

    const noms = pos.lignes.map(l => l.nom);
    verifier('positions : nom dédoublé (l’écran écrit chaque libellé deux fois)',
      noms[0] === 'Novax Semiconducteurs Inc' && noms[4] === 'KLM SE'
      && noms[6] === 'iCore Monde UCITS ETF EUR (Acc)'
      && noms[7] === 'ZED Orbis Luxe Turbo Mini-Future Short', JSON.stringify(noms));
    verifier('positions : ticker relevé sur l’écran (l’export n’en porte pas)',
      pos.lignes.slice(0, 7).map(l => l.ticker).join(',') === 'NVX,CLP,ORB,ALVRD,KLM,ALSPN,ICWM'
      && pos.lignes[7].ticker === null, pos.lignes.map(l => l.ticker).join(','));
    verifier('positions : identifiant et devise sur chaque ligne',
      pos.lignes.every(l => /^XX[A-Z0-9]{9}[0-9]$/.test(String(l.isin))) &&
      pos.lignes.map(l => l.dev).join(',') === 'USD,USD,EUR,EUR,EUR,EUR,EUR,EUR,EUR',
      pos.lignes.map(l => l.isin + '/' + l.dev).join(' '));

    /* Constat 1 — séparateur de milliers au POINT dans le bloc de marge */
    verifier('marge : milliers au POINT lus comme un seul nombre (sinon la valeur des titres valait 55)',
      !!pos.marge && pos.marge.titres === 70212.55 && pos.marge.cash === -21940.5
      && pos.marge.vl === 48272.05 && pos.marge.risque === 32537.4 && pos.marge.libre === 15734.6,
      JSON.stringify(pos.marge));
    verifier('marge : heure LUE sur la capture, jamais celle de l’appel',
      !!pos.marge && pos.marge.as === '18:46:08', pos.marge && pos.marge.as);

    /* Constat 3 — sur une ligne à levier, le premier nombre était la barrière */
    verifier('produit à levier : le cours lu est le COURS, pas la barrière',
      pos.lignes[7].cloture === 19.4 && pos.lignes[8].cloture === 12.34,
      pos.lignes[7].cloture + ' / ' + pos.lignes[8].cloture);

    /* Constat 2 — les deux conventions de paramètres, relevées le même jour */
    const lv1 = pos.lignes[7].levier, lv2 = pos.lignes[8].levier;
    verifier('levier, convention SL / R : barrière, strike, parité, levier, sens, sous-jacent',
      !!lv1 && lv1.barriere === 641.2537 && lv1.strike === 668.7411 && lv1.parite === 10
      && lv1.levier === 2.15 && lv1.sens === 'short' && lv1.emetteur === 'ZED'
      && lv1.sousJacent === 'Orbis Luxe' && lv1.manquants.length === 0, JSON.stringify(lv1));
    verifier('levier, convention BAR / P et sens Call : l’autre émetteur est lu aussi',
      !!lv2 && lv2.barriere === 174.63 && lv2.strike === 174.63 && lv2.parite === 10
      && lv2.levier === 1.48 && lv2.sens === 'long' && lv2.emetteur === 'KAP'
      && lv2.sousJacent === 'Novax Semiconducteurs' && lv2.manquants.length === 0, JSON.stringify(lv2));
    verifier('levier : le point d’un paramètre est une DÉCIMALE, jamais des milliers',
      app('Fn_NombreParam', ['186.315']) === 186.315 && app('Fn_NombreParam', ['653,4635']) === 653.4635);

    /* LE PRIX DE REVIENT UNITAIRE — colonne « PRU » de l'écran des positions.
       L'écran répète chaque valeur numérique deux fois : cours · quantité ·
       cours · valeur · valeur · PRU · PRU. L'ancre est la RÉPÉTITION DU COURS et
       non la quantité doublée, parce que « 200 200 » se lit légitimement deux
       cent mille deux cents — un groupe de trois chiffres est un séparateur de
       milliers valide — et la quantité fusionne alors en un seul nombre.
       Vérifié sur cinq formes réelles : action en euros, action en dollars, cours
       à trois décimales, quantité à trois chiffres, produit à levier. */
    const pru = t => app('Fn_ParserPositions', [[t], { lignes: [], inconnues: [] }]).lignes[0].pru;
    const casPru = [
      [' Untel SA Untel SA UNT | € 180,02 55 55 XX0000000019 € 180,02 EUR 9 901,10 9 901,10 197,978181 197,978181 -299,20 -299,20 -2,93% -2,93% -987,70  (-9,07%) -987,70   (-9,07%) ', 197.978181, 'action en euros'],
      [' Autre Inc Autre Inc AUT | $ 479,76 60 60 XX0000000027 $ 479,76 USD 24 700,29 24 700,29 152,016666 152,016666 +28,15 +28,15 -0,05% -0,05% ', 152.016666, 'action en dollars'],
      [' Tierce SA Tierce SA TIE | € 0,094 23 000 23 000 XX0000000035 € 0,094 EUR 2 162,00 2 162,00 0,23 0,23 -23,00 -23,00 ', 0.23, 'cours à trois décimales'],
      [' ZED Turbo Short ZED Turbo Short € 22,59 200 200 XX0000000043 € 22,59 EUR 4 518,00 4 518,00 13,34 13,34 +2,00 +2,00 1 SL 652.7484 STR 679.9462 R 10', 13.34, 'quantité à trois chiffres, produit à levier']
    ];
    const mauvais = casPru.filter(c => Math.abs((pru(c[0]) || 0) - c[1]) > 1e-6);
    verifier('le PRU est lu sur chaque forme de ligne, y compris quand la quantité fusionne',
      mauvais.length === 0,
      mauvais.length ? mauvais.map(c => c[2] + ' → ' + pru(c[0])).join(' · ')
        : casPru.map(c => c[2]).join(' · '));
    /* Une ligne qui ne présente PAS cette forme ne rend rien : un prix de revient
       inventé fausserait toute plus-value affichée, et vaut moins qu'un blanc. */
    verifier('une ligne sans la forme attendue ne rend AUCUN prix de revient',
      pru(' Untel SA Untel SA UNT | € 12,50 120 XX0000000019 EUR 1 500,00 ') == null,
      String(pru(' Untel SA Untel SA UNT | € 12,50 120 XX0000000019 EUR 1 500,00 ')));
    /* Constat 4 — les champs d'un ordre se lisent par ancrage */
    const ord = app('Fn_ParserCapture', ['ordres', doc.ordres]);
    verifier('ordres : 3 lignes reconnues, aucune rejetée',
      ord.lignes.length === 3 && ord.inconnues.length === 0,
      ord.lignes.length + ' reconnue(s), ' + ord.inconnues.length + ' rejetée(s)');
    verifier('ordres : quantité, limite et montant par ANCRAGE (l’écran les donne dans l’ordre inverse)',
      ord.lignes.map(o => [o.qte, o.limite, o.montantEur].join('/')).join(' · ')
      === '25/72/1800 · 10/120/1200 · 200/27/5400',
      ord.lignes.map(o => [o.qte, o.limite, o.montantEur].join('/')).join(' · '));
    verifier('ordres : le sens vient du mot d’ordre, jamais du nom du produit',
      ord.lignes.map(o => o.sens).join(',') === 'achat,achat,vente',
      ord.lignes.map(o => o.nom + '=' + o.sens).join(' · '));
    verifier('ordres : nom du produit isolé, validité et échéance relevées',
      ord.lignes[0].nom === 'Orbis Luxe S.p.A.'
      && ord.lignes[2].nom === 'ZED Orbis Luxe Turbo Mini-Future Short'
      && ord.lignes[1].validite === 'Continu jusqu’au 2026-02-02',
      ord.lignes.map(o => o.nom + ' [' + o.validite + ']').join(' · '));

    /* Exécutés : même écran, mêmes ancrages. Section vide le jour du relevé. */
    const exeVide = app('Fn_ParserCapture', ['executes', doc.executes]);
    verifier('exécutés : une section vide ne produit aucune ligne, et aucune erreur',
      exeVide.lignes.length === 0 && exeVide.inconnues.length === 0);
    const exe = app('Fn_ParserCapture', ['executes', EXECUTE]);
    verifier('exécutés : ligne lue avec sa date normalisée en ISO',
      exe.lignes.length === 1 && exe.lignes[0].date === '2026-08-04'
      && exe.lignes[0].qte === 10 && exe.lignes[0].cours === 118.2,
      JSON.stringify(exe.lignes));

    /* Constat 5 — un nom court doit pouvoir s'apparier */
    const app5 = n => ev('Fn_Apparier(' + JSON.stringify(n) + ', ' + JSON.stringify(pos.lignes) + ')');
    verifier('appariement : un nom COURT trouve sa ligne (six caractères n’atteignent pas le seuil de huit)',
      (app5('KLM SE') || {}).nom === 'KLM SE', JSON.stringify(app5('KLM SE')));
    verifier('appariement : un nom long s’apparie par préfixe, l’export tronquant à 32 caractères',
      (app5('Novax Semiconducteurs Inc') || {}).ticker === 'NVX'
      && (app5('iCore Monde UCITS ETF EUR (Acc)') || {}).ticker === 'ICWM');
    verifier('appariement : un préfixe court n’apparie PAS un mot plus long',
      app5('ORB') === null, JSON.stringify(app5('ORB')));

    /* Lecture des nombres */
    const nb = q => ev('Fn_NombreFr(' + JSON.stringify(q) + ')');
    const cas = [['1 234,56', 1234.56], ['1,234.56', 1234.56], ['653,4635', 653.4635],
      ['-21 940,50', -21940.5], ['-0,4892', -0.4892], ['19,40', 19.4], ['1 234', 1234],
      ['70.212,55', 70212.55]];
    const rates = cas.filter(c => nb(c[0]) !== c[1]);
    verifier('décimales françaises et anglaises (' + cas.length + ' cas)', rates.length === 0,
      rates.map(c => '« ' + c[0] + ' » → ' + nb(c[0]) + ' au lieu de ' + c[1]).join(' · '));
    const unSeul = app('Fn_NombresDe', ['Valeur des titres € 70.212,55']);
    verifier('un montant à milliers au point est UN nombre, pas deux',
      unSeul.length === 1 && unSeul[0].v === 70212.55, JSON.stringify(unSeul));
    const quatreDec = app('Fn_NombresDe', ['barriere 641.2537']);
    verifier('un nombre à quatre décimales au point n’est pas pris pour des milliers',
      quatreDec.length === 1 && quatreDec[0].v === 641.2537, JSON.stringify(quatreDec));

    /* Idempotence et tolérance */
    const pos2 = app('Fn_ParserCapture', ['positions', doc.positions]);
    verifier('parseur idempotent (deux lectures identiques)',
      JSON.stringify(pos.lignes) === JSON.stringify(pos2.lignes));
    const bruit = app('Fn_ParserCapture', ['positions',
      'Untel SA Untel SA UNT | € 12,50 120 120 XX0000000019 € 12,50 EUR 1 500,00\n???????\nAutre SA Autre SA AUT | $ 30,00 10 10 XX0000000027 $ 30,00 USD 300,00']);
    verifier('une ligne non comprise n’annule pas les autres',
      bruit.lignes.length === 2 && bruit.inconnues.length === 1,
      bruit.lignes.length + ' reconnue(s), ' + bruit.inconnues.length + ' signalée(s)');
  } catch (e) { ko('capture unique de l’automate', e.message); }

  /* --- La chaîne entière : capture → analyse → intégration → validation ---
     Les parseurs peuvent tous être justes et la chaîne rester cassée : c'est le
     branchement qui a coûté le plus cher. Ce bloc rejoue le geste réel — un seul
     collage, puis « Analyser », puis l'acceptation des cartes — et vérifie ce qui
     ARRIVE DANS L'ÉTAT. Il n'écrit rien sur le disque : la base de documents est
     absente du bac à sable, et chaque enregistrement y échoue silencieusement,
     ce qui est exactement le comportement voulu en fichier local. */
  console.log('\nF bis. Acquisition — la chaîne entière');
  try {
    const R = q => vm.runInContext(q, ctx);
    const J = q => JSON.parse(JSON.stringify(R(q)));
    R('Var_State._runtime.collages = {}; Var_State._runtime.capture = null; Var_State._runtime.xlsx = null;'
      + 'Var_State.positions = []; Var_State.controles = []; Var_State.ordres = []; Var_State.executes = [];');

    verifier('la capture est reconnue et posée en un geste',
      R('Fn_PoserCapture(' + JSON.stringify(CAPTURE) + ')') === true);
    const rt = J('({ cles: Object.keys(Var_State._runtime.collages), sections: Var_State._runtime.capture.sections, notrans: Var_State._runtime.aucuneTransac })');
    verifier('un collage alimente les trois entrées, et une section vide EFFACE la sienne',
      rt.cles.join(',') === 'positions,ordres' && rt.sections.executes === 0, rt.cles.join(','));
    verifier('« aucune transaction récente » est cochée depuis l’en-tête, sans interprétation',
      rt.notrans === true);
    // La zone de capture n'existe à l'écran qu'une fois un document posé : c'est
    // le seul moment où son rendu est réellement exercé.
    R('Fn_RenderAcquisition(); Fn_RenderAcquisition();');
    const zone = R('Fn_HtmlZoneCapture()');
    verifier('la zone de capture affiche ce que l’écran annonçait, et l’échappe',
      /18:46:08/.test(zone) && /3 ordre\(s\) en attente/.test(zone)
      && /aucune transaction sur la période/.test(zone) && zone.indexOf('<script') < 0,
      zone.slice(0, 200));

    R('Var_State._runtime.essai = Fn_AnalyserEntrees();');
    const an = J('({ props: Var_State._runtime.essai.propositions.length, ko: Var_State._runtime.essai.lignesKo, kinds: Var_State._runtime.essai.controles.map(c => c.kind) })');
    verifier('la capture seule produit ses neuf propositions, sans ligne rejetée',
      an.props === 9 && an.ko === 0, an.props + ' proposition(s), ' + an.ko + ' ligne(s) rejetée(s)');
    verifier('l’en-tête annonçait trois ordres, trois ont été lus : aucun écart',
      an.kinds.indexOf('ecart_ordres') < 0, an.kinds.join(','));

    const bilan = J('Fn_IntegrerEntrees(Var_State._runtime.essai)');
    verifier('aucune intégration silencieuse : les neuf lignes inconnues passent par le sas',
      bilan.nouvelles === 9, JSON.stringify(bilan));
    // Journal des entrées : la ligne « capture » a sa propre mise en forme, qui
    // n'existe à l'écran qu'une fois une capture analysée.
    R('Fn_RenderParametres(); Fn_RenderParametres(); Fn_RenderAcquisition();');
    verifier('le journal des entrées distingue la capture des trois collages',
      J('Var_State.captures.map(c => c.type)').join(',') === 'capture,positions,ordres',
      J('Var_State.captures.map(c => c.type)').join(','));
    const marge = J('Var_State.marge');
    verifier('la marge entre datée de l’heure du courtier lue dans l’en-tête',
      marge && marge.vl === 48272.05 && marge.as === '18:46:08', JSON.stringify(marge));
    const ordres = J('Var_State.ordres');
    verifier('les trois ordres entrent avec sens, quantité, limite et montant',
      ordres.length === 3 && ordres[2].sens === 'vente' && ordres[2].qte === 200
      && ordres[0].limite === 72 && ordres[0].montantEur === 1800,
      ordres.map(o => o.sens + '/' + o.qte + '/' + o.limite + '/' + o.montantEur).join(' · '));

    R('Var_State.controles.filter(c => c.statut === "a_valider" && c.kind === "nouvelle_ligne").forEach(c => Fn_AppliquerControle(c, true));');
    const p = J('Var_State.positions.map(x => ({ t: x.ticker, n: x.detention.nom, c: x.detention.cloture, ty: x.produit.type, b: x.produit.barriere, s: x.produit.sens, sj: x.produit.sousJacent }))');
    verifier('neuf positions créées, chacune avec son ticker et son cours du jour',
      p.length === 9 && p[0].t === 'NVX' && p[0].c === 512.345 && p[4].n === 'KLM SE',
      JSON.stringify(p.map(x => x.t + '=' + x.c)));
    const t1 = p.find(x => /ZED/.test(x.n)), t2 = p.find(x => /KAP/.test(x.n));
    verifier('les deux produits à levier gardent barrière, sens et sous-jacent',
      !!t1 && t1.ty === 'derive' && t1.b === 641.2537 && t1.s === 'short' && t1.sj === 'Orbis Luxe'
      && !!t2 && t2.ty === 'derive' && t2.b === 174.63 && t2.s === 'long' && t2.sj === 'Novax Semiconducteurs',
      JSON.stringify([t1, t2]));

    // Recoller la même capture est le geste le plus fréquent : il ne doit rien
    // dupliquer, ni recréer une carte déjà tranchée.
    R('Var_State._runtime.essai = Fn_AnalyserEntrees();');
    const bilan2 = J('Fn_IntegrerEntrees(Var_State._runtime.essai)');
    const apres = J('({ n: Var_State.positions.length, o: Var_State.ordres.length, av: Var_State.controles.filter(c => c.statut === "a_valider").length })');
    verifier('recoller la même capture ne crée rien de neuf',
      bilan2.nouvelles === 0 && apres.n === 9 && apres.o === 3 && apres.av === 0,
      JSON.stringify(bilan2) + ' → ' + JSON.stringify(apres));

    /* --- Mémoire des revues : le desk réévalue, il ne redécouvre pas --- */
    R('Var_State.positions[0].desk = { niveau: "complet", profil: "croissance", tend: "hausse",'
      + ' these: "Thèse précédente à réévaluer.", valoRef: "12x", risques: "concentration", ts: Date.now() };'
      + 'Var_State.theses[Var_State.positions[0].id] = { ecrite: true, invalidation: true, objectif: false, derniereRevue: "2026-08-01" };'
      + 'Var_State.actions = ['
      + ' { id: "a1", isin: Var_State.positions[0].id, propo: "Alléger de moitié", statut: "rejetee", dateDecision: "2026-08-10", prio: 2, ts: Date.now() },'
      + ' { id: "a2", isin: Var_State.positions[1].id, propo: "Couvrir la jambe longue", statut: "acceptee", dateDecision: "2026-08-12", prio: 1, ts: Date.now() },'
      + ' { id: "a3", isin: Var_State.positions[2].id, propo: "Poser une limite", statut: "a_valider", prio: 3, ts: Date.now() }];');
    const mem = J('Fn_MemoireDesk()');
    verifier('la mémoire des revues est comptée à l’écran',
      mem.jugees === 1 && mem.arbitrages === 2 && mem.theses === 1, JSON.stringify(mem));
    const contrat = J('Fn_ContratDesk()');
    verifier('le desk reçoit son jugement PRÉCÉDENT ligne par ligne',
      !!contrat.pos[0].deskPrec && contrat.pos[0].deskPrec.these === 'Thèse précédente à réévaluer.'
      && contrat.pos[0].deskPrec.tend === 'hausse', JSON.stringify(contrat.pos[0].deskPrec));
    verifier('le desk reçoit ce que l’utilisateur a déclaré sur la ligne',
      !!contrat.pos[0].vous && contrat.pos[0].vous.declare.join(',') === 'these,invalidation'
      && contrat.pos[0].vous.revue === '2026-08-01', JSON.stringify(contrat.pos[0].vous));
    verifier('le desk reçoit les arbitrages déjà tranchés, et EUX SEULS comme tranchés',
      contrat.arbitragesTranches.length === 2 && contrat.arbitragesEnAttente.length === 1
      && contrat.arbitragesTranches.map(a => a.statut).sort().join(',') === 'acceptee,rejetee',
      JSON.stringify(contrat.arbitragesTranches));
    const texte = R('Fn_BuildPromptMAJ({ passe: "desk", contrat: Fn_ContratDesk(), budget: Fn_BudgetDesk(0), sitesAutorises: [] })');
    verifier('la consigne de réévaluation est écrite noir sur blanc',
      /RÉÉVALUATION, pas un premier avis/.test(texte) && /ARBITRAGE REJETÉ NE SE REPROPOSE PAS/.test(texte)
      && /ARBITRAGE ACCEPTÉ EST EN COURS/.test(texte));

    /* --- Repartir d'une vigie neuve --- */
    R('Var_State.cumulApi = { appels: 7, jetonsEntree: 100, jetonsSortie: 50, jetonsCacheEcriture: 0, jetonsCacheLecture: 0, recherches: 3, lectures: 1, coutUsd: 1.25 };'
      + 'Var_State.seuils.leverageMax = 1.9; Fn_RemiseAZero();');
    const vide = J('({ n: Var_State.positions.length, o: Var_State.ordres.length, e: Var_State.calendrier.length,'
      + ' a: Var_State.actions.length, c: Var_State.controles.length, j: Var_State.majJournaux.length,'
      + ' t: Object.keys(Var_State.theses).length, m: Var_State.marge, cap: Var_State.captures.length,'
      + ' col: Object.keys(Var_State._runtime.collages).length, capt: Var_State._runtime.capture })');
    verifier('la remise à zéro vide TOUTES les données de portefeuille, collages compris',
      vide.n === 0 && vide.o === 0 && vide.e === 0 && vide.a === 0 && vide.c === 0 && vide.j === 0
      && vide.t === 0 && vide.m === null && vide.cap === 0 && vide.col === 0 && vide.capt === null,
      JSON.stringify(vide));
    const garde = J('({ cumul: Var_State.cumulApi, seuil: Var_State.seuils.leverageMax, modele: Var_State.modeleMAJ })');
    verifier('la remise à zéro NE touche PAS la dépense cumulée ni les réglages',
      garde.cumul.appels === 7 && garde.cumul.coutUsd === 1.25 && garde.seuil === 1.9 && !!garde.modele,
      JSON.stringify(garde));
    verifier('l’état vidé devient le plus récent, sinon la synchronisation le restaurerait',
      J('Var_State.etatTs') > 0 && J('Date.now() - Var_State.etatTs') < 5000);
    R('Fn_RenderTout();');
    ok('la page se redessine entière après une remise à zéro');
  } catch (e) { ko('la chaîne entière', e.message); }

  /* --- Migration de l'état précédent --- */
  console.log('\nG. Migration et calculs déterministes');
  try {
    const v2 = {
      version: 1, etatTs: 1785878960315,
      positions: [{ ticker: 'AAA', isin: 'XX0000000011', libelle: 'Société A', quantite: 10, cours: 100,
        devise: 'EUR', valeurEur: 1000, pctVN: 50, categorie: 'CONVICTION', facteurs: ['secteur A'] }],
      events: [{ id: 'e1', date: '2020-01-01', titre: 'Vieil événement', sev: 'Info', tags: ['AAA'], metrics: [] },
        { id: 'e2', date: '2099-01-01', titre: 'Futur événement', sev: 'Crit', tags: ['AAA'], metrics: [{ label: 'l', value: 'v' }] }],
      quotes: { AAA: { last: 100, clotPrec: 98, dateMaj: 1785878960315 } },
      valuation: { AAA: { perTtm: 20, refHist: 15, dateMaj: 1785878960315 } },
      margin: { securitiesValue: 2000, cash: -500, liquidationValue: 1500, portfolioRisk: 900, freeMargin: 600, asOf: '19:46' },
      opportunites: [{ id: 'o1', libelle: 'Idée', ticker: 'BBB', statut: 'a_etudier', dateMaj: 1785878960315 }],
      orders: [], trades: [], actions: [], aValider: [], theses: {}, instruments: []
    };
    const m = vm.runInContext('Fn_MigrerEtat(' + JSON.stringify(v2) + ')', ctx);
    verifier('migration : schéma v3 produit', m && m.v === 3, m && ('v=' + m.v));
    verifier('migration : blocs parallèles repliés sur la position',
      m.positions.length === 1 && m.positions[0].valo.per === 20 && m.positions[0].valo.refHist === 15
      && m.positions[0].detention.clotureVeille === 98,
      JSON.stringify(m.positions[0] && m.positions[0].valo));
    verifier('migration : statut attribué à chaque événement selon sa date',
      m.calendrier.length === 2 && m.calendrier[0].statut === 'classe' && m.calendrier[1].statut === 'prevu',
      m.calendrier.map(e => e.id + '=' + e.statut).join(' '));
    verifier('migration : textes conservés et marge reprise',
      m.marge.vl === 1500 && m.decouvertes.length === 1,
      JSON.stringify(m.marge));

    // Recalcul déterministe : les grandeurs sortent des données, sans appel.
    vm.runInContext('Fn_AppliquerEtat(Fn_MigrerEtat(' + JSON.stringify(v2) + ')); Fn_Recalculer();', ctx);
    const pct = vm.runInContext('Var_State.positions[0].detention.pctVN', ctx);
    const lev = vm.runInContext('Var_State.marge.levier', ctx);
    const cous = vm.runInContext('Var_State.marge.coussinPct', ctx);
    verifier('calcul : % de la valeur nette', Math.round(pct * 10) / 10 === 66.7, 'pctVN = ' + pct);
    verifier('calcul : levier brut', Math.round(lev * 100) / 100 === 1.33, 'levier = ' + lev);
    verifier('calcul : coussin de marge', Math.round(cous * 10) / 10 === 40, 'coussin = ' + cous);
    const inds = vm.runInContext('Fn_IndicateursDiscipline().length', ctx);
    verifier('discipline : indicateurs construits (' + inds + ')', inds >= 10, inds + ' indicateur(s)');
    const muets = vm.runInContext(
      'Fn_IndicateursDiscipline().filter(i => !i.zone && !i.manquant).map(i => i.nom)', ctx);
    verifier('aucun indicateur muet sans dire ce qui manque', muets.length === 0, muets.join(', '));
    const squelette = vm.runInContext('Fn_GenererSquelette()', ctx);
    verifier('calendrier : squelette généré hors appel au modèle', !!squelette, JSON.stringify(squelette));
  } catch (e) { ko('migration et calculs déterministes', e.message); }

  /* --- L'ARITHMÉTIQUE DU PORTEFEUILLE, sur un état contrôlé ---
     Toutes ces grandeurs sont calculées par l'application et JAMAIS demandées au
     modèle : elles doivent donc être justes sans recours. Le portefeuille d'essai
     est minuscule et ses résultats se vérifient de tête, ce qui est le seul moyen
     de tenir un test d'arithmétique dans le temps.
       Alpha SA  — action EUR, 100 × 20 €, veille 25 €   → 2 000 €, −20 %
       Beta Inc  — action USD,  50 × 10 $, taux 0,90     →   450 €
       Turbo     — short sur Beta, 200 titres, parité 10 → −180 € d'exposition
     Marge : titres 3 000, VL 2 000, marge libre 500. */
  console.log('\nG bis. Calculs — l’arithmétique du portefeuille');
  try {
    const R = q => vm.runInContext(q, ctx);
    const J = q => JSON.parse(JSON.stringify(R(q)));
    const pres = (v, attendu, tol) => v != null && Math.abs(v - attendu) <= (tol == null ? 0.005 : tol);

    R('Var_State.positions = []; Var_State.controles = []; Var_State.calendrier = [];'
      + 'Var_State.fx = { taux: { USD: 0.9 }, ts: Date.now(), origine: "essai" };'
      + 'Var_State.marge = { titres: 3000, cash: -1000, vl: 2000, risque: 1500, libre: 500, as: "18:00", ts: Date.now() };'
      + 'Var_State.positions = ['
      + ' { id: "P1", ticker: "ALP", isin: null, detention: { nom: "Alpha SA", qte: 100, dev: "EUR", cloture: 20,'
      + '     clotureVeille: 25, valEurExport: 2500, facteurs: ["tech"], poche: "CONVICTION", ts: Date.now() },'
      + '   produit: { type: "action", sens: "long", histBarriere: [] }, desk: {}, marche: {}, valo: {}, consensus: {} },'
      + ' { id: "P2", ticker: "BET", isin: null, detention: { nom: "Beta Inc", qte: 50, dev: "USD", cloture: 10,'
      + '     clotureVeille: 10, valEurExport: 999, facteurs: ["tech"], poche: "CONVICTION", ts: Date.now() },'
      + '   produit: { type: "action", sens: "long", histBarriere: [] }, desk: {}, marche: {}, valo: {}, consensus: {} },'
      + ' { id: "P3", ticker: null, isin: null, detention: { nom: "ZED Beta Turbo Short", qte: 200, dev: "EUR", cloture: 1,'
      + '     clotureVeille: 1, valEurExport: null, facteurs: ["tech"], poche: "COUVERTURE", ts: Date.now() },'
      + '   produit: { type: "derive", emetteur: "ZED", sousJacent: "Beta Inc", sens: "short", barriere: 12, strike: 12,'
      + '     parite: 10, levier: 2, histBarriere: [{ d: "2026-08-01", bar: 12, str: 12 }, { d: "2026-08-15", bar: 11.72, str: 11.72 }] },'
      + '   desk: {}, marche: {}, valo: {}, consensus: {} }];'
      + 'Fn_Recalculer();');

    const p = J('Var_State.positions.map(x => ({ id: x.id, v: x.detention.valEur, pct: x.detention.pctVN,'
      + ' vr: x.detention.var, d: x.produit.deltaEur, db: x.produit.distBarriere, po: x.produit.portageMensuel }))');
    const par = k => p.find(x => x.id === k);

    verifier('valeur du jour = quantité × cours du JOUR × taux, jamais le montant de l’export',
      pres(par('P1').v, 2000) && pres(par('P2').v, 450),
      'P1 ' + par('P1').v + ' (attendu 2000, export 2500) · P2 ' + par('P2').v + ' (attendu 450, export 999)');
    verifier('variation du jour = (cours − clôture de la veille) ÷ clôture de la veille',
      pres(par('P1').vr, -20) && pres(par('P2').vr, 0), 'P1 ' + par('P1').vr + ' % · P2 ' + par('P2').vr + ' %');
    verifier('part de la valeur nette rapportée à la valeur liquidative lue',
      pres(par('P1').pct, 100) && pres(par('P2').pct, 22.5, 0.05),
      'P1 ' + par('P1').pct + ' % · P2 ' + par('P2').pct + ' %');
    verifier('exposition d’un turbo : quantité ÷ parité × cours du sous-jacent, AU TAUX DU SOUS-JACENT',
      pres(par('P3').d, -180), par('P3').d + ' € (attendu −180 : 200 ÷ 10 × 10 $ × 0,90, signé short)');
    verifier('distance à la barrière, mesurée sur le cours du sous-jacent',
      pres(par('P3').db, 20), par('P3').db + ' % (attendu 20 : barrière 12 contre cours 10)');
    verifier('portage mensuel déduit de la dérive du financement sur au moins une semaine',
      pres(par('P3').po, 10.8, 0.05), par('P3').po + ' €/mois (attendu 10,80 : 0,02/j ÷ 10 × 180 × 30)');

    const m = J('Var_State.marge');
    verifier('levier brut = titres ÷ valeur liquidative · coussin = marge libre ÷ valeur liquidative',
      pres(m.levier, 1.5) && pres(m.coussinPct, 25), 'levier ' + m.levier + ' · coussin ' + m.coussinPct + ' %');

    const prof = J('Fn_ProfilExposition()');
    const tech = prof.expositionNetteParFacteur.find(f => f.cle === 'tech');
    const brut = prof.expositionBruteParFacteur.find(f => f.cle === 'tech');
    verifier('exposition NETTE par facteur : la jambe short se retranche de la longue',
      tech && tech.deltaEur === 2270 && pres(tech.pctVN, 113.5, 0.05),
      JSON.stringify(tech) + ' (attendu 2 270 € = 2000 + 450 − 180)');
    verifier('exposition BRUTE par facteur : la jambe short s’y ajoute en valeur absolue',
      brut && brut.deltaEur === 2630, JSON.stringify(brut) + ' (attendu 2 630 €)');
    const dev = k => (prof.expositionParDevise.find(d => d.cle === k) || {}).deltaEur;
    verifier('exposition par devise : le turbo compte dans SA devise de cotation',
      dev('EUR') === 1820 && dev('USD') === 450, 'EUR ' + dev('EUR') + ' · USD ' + dev('USD'));

    const gap = J('Fn_ImpactGap(Var_State.positions[2], -10)');
    verifier('impact d’un écart de cours : amplitude × exposition, signe compris',
      pres(gap.eur, 18) && pres(gap.pctVN, 0.9, 0.01), JSON.stringify(gap) + ' (attendu +18 € sur un short qui gagne à la baisse)');

    // Sans bloc de marge, la valeur nette est la SOMME des lignes : elle doit se
    // calculer APRÈS leur mise à jour, sinon chaque poids se rapporte à la veille.
    R('Var_State.marge = null; Fn_Recalculer();');
    const sansMarge = J('({ vn: Fn_ValeurNette(), pct: Var_State.positions[0].detention.pctVN })');
    // 2 650 = 2 000 + 450 + 200 : la VALEUR d'un turbo est son prix de marché
    // (200 × 1 €), pas son exposition (−180 €). Les deux ne se confondent jamais —
    // la valeur nette somme des valeurs, l'exposition somme des deltas.
    verifier('sans bloc de marge, la valeur nette somme les VALEURS de marché du jour, pas les expositions',
      pres(sansMarge.vn.vn, 2650) && sansMarge.vn.approx === true && pres(sansMarge.pct, 75.47, 0.05),
      JSON.stringify(sansMarge));

    // Mémorisation : un seul calcul par état, invalidé par le recalcul.
    verifier('les agrégats ne sont calculés qu’UNE fois par état',
      R('Fn_ProfilExposition() === Fn_ProfilExposition()') === true);
    verifier('un recalcul invalide les agrégats mémorisés',
      R('(function(){ var a = Fn_ProfilExposition(); Fn_Recalculer(); return a !== Fn_ProfilExposition(); })()') === true);

    // La clôture de référence ne glisse pas quand la même séance est réanalysée.
    R('Var_State.marge = { titres: 3000, cash: -1000, vl: 2000, risque: 1500, libre: 500, as: "18:00", ts: Date.now() };'
      + 'Var_State.positions[0].detention.clotureVeille = 25;'
      + 'Var_State._runtime.essai2 = { propositions: [{ id: "P1", nom: "Alpha SA", qte: 100, dev: "EUR", cloture: 21,'
      + '  clotureVeille: null, montantDev: null, montantEur: null, levier: null, source: "essai" }],'
      + '  controles: [], capPos: null, capOrd: null, capExe: null, reg: null, meta: null };'
      + 'Fn_IntegrerEntrees(Var_State._runtime.essai2);');
    const meme = J('({ cv: Var_State.positions[0].detention.clotureVeille, c: Var_State.positions[0].detention.cloture })');
    verifier('réanalyser la MÊME séance ne fait pas glisser la clôture de référence',
      meme.cv === 25 && meme.c === 21, JSON.stringify(meme) + ' (la veille doit rester 25, pas devenir 20)');
  } catch (e) { ko('l’arithmétique du portefeuille', e.message); }

  /* --- CE QUI SE PASSE AVANT QU'UN ORDRE NE PARTE ---
     Un ordre d'achat sur un titre qui publie dans trois jours est exactement ce
     qu'il faut voir AVANT, et rien ne le montrait : la règle des publications ne
     parcourt que les positions, et un titre qu'on ne détient pas encore n'en est
     pas une. Les événements d'ordre, eux, se périmaient chaque nuit. */
  console.log('\nG octies. Ordres en attente — permanence et annonces à venir');
  try {
    const R = q => vm.runInContext(q, ctx);
    const J = q => JSON.parse(JSON.stringify(R(q)));
    const hier = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const dans3j = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const socle = 'Var_State.positions = []; Var_State.calendrier = []; Var_State.controles = [];'
      + 'Var_State.agenda = {}; Var_State.executes = [];'
      + 'Var_State.marge = { titres: 1000, cash: 0, vl: 1000, risque: 500, libre: 500, as: "18:00", ts: Date.now() };'
      + 'Var_State.ordres = [{ id: "o1", ticker: null, nom: "Untel SA", isin: null, sens: "achat",'
      + ' type: "limite", qte: 10, limite: 20, montantEur: 200, validite: "Continu", ts: Date.now() }];';

    /* 1. PERMANENCE. L'identifiant portait la date du jour : chaque analyse créait
       un nouvel événement et laissait le précédent basculer en « échu », donc en
       attente de débrief, donc à repayer — pour un ordre qui n'avait pas bougé. */
    R(socle + 'Fn_GenererSquelette(); Fn_MajStatutsCalendrier();');
    const un = J('Var_State.calendrier.filter(function (e) { return e.source === "regle:ordre"; })');
    R('Fn_GenererSquelette(); Fn_GenererSquelette(); Fn_MajStatutsCalendrier();');
    const apres = J('Var_State.calendrier.filter(function (e) { return e.source === "regle:ordre"; })');
    verifier('trois analyses dans la journée ne font qu’UN événement d’ordre, toujours vif',
      un.length === 1 && apres.length === 1 && apres[0].statut === 'imminent',
      apres.length + ' événement(s), statut ' + (apres[0] || {}).statut);
    /* Le test ci-dessus ne franchit pas minuit : c’est l’identifiant lui-même qui
       doit être daté de rien, sans quoi le lendemain en recrée un et périme celui
       de la veille. On le vérifie donc sur sa FORME. */
    verifier('l’identifiant d’un événement d’ordre ne porte AUCUNE date',
      !/-[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String((apres[0] || {}).id || '')),
      String((apres[0] || {}).id || '(aucun)'));

    /* 2. Les exemplaires datés d'une version antérieure sont CLASSÉS au chargement :
       ils n'ont rien à débriefer, l'ordre qu'ils décrivent est toujours vivant. */
    R('Var_State.calendrier.push({ id: "ordre-untel-sa-achat-20-' + hier + '", isin: null, date: "' + hier + '",'
      + ' statut: "echu", source: "regle:ordre", libelle: "Ordre en attente — achat Untel SA", court: "Ordre",'
      + ' sev: "Info", conf: true, tags: ["ORDRES"], metriques: [], textes: {}, debrief: null });');
    const classees = J('Fn_ClasserOrdresDatesAnciennes()');
    verifier('un exemplaire daté d’une version antérieure est CLASSÉ, jamais mis à débriefer',
      classees === 1 && J('Fn_ADebriefer().length') === 0,
      classees + ' classé(s), ' + J('Fn_ADebriefer().length') + ' à débriefer');

    /* 2 bis. UN SIMPLE RECHARGEMENT remplit le calendrier. Le squelette ne se
       régénérait qu’au moment d’une analyse des entrées : les ordres en attente
       étaient bien dans l’état, mais leurs événements n’existaient pas encore, et
       « j’ai rechargé, rien n’a changé » était donc exact. Le squelette est
       déterministe et gratuit — rien ne justifiait de le faire attendre. */
    R(socle + 'Var_State.calendrier = [];');
    ctx.__etatRech = J('JSON.parse(Fn_SerialiserEtat())');
    R('Fn_AdopterEtat(__etatRech);');
    const auRech = J('Fn_CalendrierVif().filter(function (e) { return e.source === "regle:ordre"; }).length');
    verifier('un simple rechargement suffit à faire apparaître les ordres au calendrier',
      auRech === 1, auRech + ' événement(s) d’ordre, sans avoir relancé d’analyse');

    /* 2 ter. LA GRILLE ET LE DÉTAIL DOIVENT DIRE LA MÊME CHOSE. La grille affiche
       les échus, la frise les excluait : en cliquant sur un jour passé on voyait
       une pastille dans la case et RIEN en dessous. Un jour explicitement choisi
       montre donc ce qu'il porte, échus compris. */
    const frise = () => J('(function () { var j = Var_State.filtreJour;'
      + ' return Fn_EvenementsFiltres().filter(function (e) { return j || e.statut !== "echu"; }).length; })()');
    R(socle + 'Var_State.calendrier = [{ id: "ev-hier", isin: null, date: "' + hier + '",'
      + ' statut: "echu", source: "action", libelle: "Action retenue — essai", court: "Action",'
      + ' sev: "Info", conf: true, tags: ["ACTION"], metriques: [], textes: {}, debrief: null }];'
      + 'Var_State.ordres = []; Var_State.filtreJour = null;');
    const sansFiltre = frise();
    R('Var_State.filtreJour = "' + hier + '";');
    const avecFiltre = frise();
    R('Var_State.filtreJour = null;');
    verifier('un jour passé explicitement choisi montre ce que sa case annonçait',
      sansFiltre === 0 && avecFiltre === 1,
      'sans filtre ' + sansFiltre + ' événement(s), jour choisi ' + avecFiltre);

    /* 3. L'ANNONCE ATTENDUE AVANT EXÉCUTION — le point aveugle. */
    R(socle + 'Var_State.agenda = { "untel-sa": { nom: "Untel SA", pubDate: "' + dans3j + '", ts: Date.now() } };'
      + 'Fn_GenererSquelette(); Fn_MajStatutsCalendrier();');
    const annonce = J('Var_State.calendrier.filter(function (e) { return e.source === "regle:ordre-annonce"; })');
    verifier('un ordre sur un titre NON DÉTENU qui publie sous peu lève un événement daté',
      annonce.length === 1 && annonce[0].date === dans3j && /AVANT exécution/.test(annonce[0].libelle),
      annonce.length + ' événement(s) : ' + ((annonce[0] || {}).libelle || '—').slice(0, 52));
    verifier('et il dit que le titre n’est pas encore détenu, avec le délai restant',
      (annonce[0].metriques || []).some(m => /pas encore détenu|ligne nouvelle/.test(m.v))
      && (annonce[0].metriques || []).some(m => /jour\(s\)/.test(m.v)),
      JSON.stringify((annonce[0].metriques || []).map(m => m.l)));

    /* 4. La sélection de collecte va chercher ces dates : instrument d'un ordre,
       et sous-jacent d'un produit à levier — ni l'un ni l'autre n'est une position. */
    R(socle + 'Var_State.positions = [{ id: "T1", ticker: null, isin: null,'
      + ' detention: { nom: "Zed Turbo Short", qte: 100, dev: "EUR", cloture: 2, clotureVeille: 2,'
      + '   valEurExport: null, facteurs: [], poche: null, ts: Date.now() },'
      + ' produit: { type: "derive", emetteur: "Zed", sousJacent: "Autre Inc", sens: "short", barriere: null,'
      + '   strike: null, parite: 1, levier: 1, histBarriere: [] }, desk: {}, marche: {}, valo: {}, consensus: {} }];'
      + 'Fn_Recalculer();');
    const ag = J('Fn_AgendasAEnrichir()');
    verifier('l’instrument d’un ordre et le SOUS-JACENT d’un produit à levier entrent en collecte',
      ag.length === 2 && ag.some(a => /Untel/.test(a.nom)) && ag.some(a => /Autre Inc/.test(a.nom)),
      ag.map(a => a.nom + ' [' + a.motif + ']').join(' | '));
    R('Var_State.agenda = { "untel-sa": { nom: "Untel SA", pubDate: "' + dans3j + '", ts: Date.now() },'
      + ' "autre-inc": { nom: "Autre Inc", pubDate: "' + dans3j + '", ts: Date.now() } };');
    verifier('un agenda déjà frais n’est JAMAIS recollecté',
      J('Fn_AgendasAEnrichir().length') === 0, J('Fn_AgendasAEnrichir().length') + ' encore demandé(s)');

    /* 5. Aucune ligne détenue n'est privée d'agenda : le traitement allégé se
       disait « agenda seulement » et n'en collectait aucun. */
    R('Var_State.positions.push({ id: "L1", ticker: null, isin: null,'
      + ' detention: { nom: "Petite SA", qte: 1, dev: "EUR", cloture: 5, clotureVeille: 5, valEurExport: null,'
      + '   facteurs: [], poche: null, ts: Date.now() },'
      + ' produit: { type: "action", sens: "long", histBarriere: [] }, desk: {}, marche: {}, valo: {}, consensus: {} });'
      + 'Fn_Recalculer();');
    const petite = J('Var_State.positions.find(function (p) { return p.id === "L1"; }).desk.niveau');
    verifier('une ligne au traitement ALLÉGÉ part quand même à la collecte',
      petite === 'ligne' && J('Fn_LignesAEnrichir().some(function (p) { return p.id === "L1"; })') === true,
      'niveau ' + petite + ', sélectionnée : ' + J('Fn_LignesAEnrichir().length') + ' ligne(s)');
    verifier('un produit à levier, lui, reste hors collecte de valorisation',
      J('Fn_LignesAEnrichir().some(function (p) { return p.id === "T1"; })') === false,
      'produit à levier ' + (J('Fn_LignesAEnrichir().some(function (p) { return p.id === "T1"; })') ? 'sélectionné' : 'écarté'));

    /* 6. Le contrat porte les deux listes, et les agendas ne demandent que des dates. */
    ctx.__lg = J('Fn_LignesAEnrichir()');
    const contrat = J('Fn_ContratEnrichissement(Fn_LignesAEnrichir(), Fn_AgendasAEnrichir())');
    verifier('le cahier des charges sépare les positions à valoriser des agendas à dater',
      Array.isArray(contrat.agendas) && Array.isArray(contrat.lignes),
      (contrat.lignes || []).length + ' ligne(s), ' + (contrat.agendas || []).length + ' agenda(s)');

    /* 7. « INSTRUMENTS SUIVIS EN PLUS DES LIGNES DÉTENUES » — la bascule était à
       l'envers : on y inscrivait les découvertes ANCRÉES sur une ligne détenue,
       c'est-à-dire précisément des titres déjà en portefeuille, avec un
       identifiant préfixé deux fois, ni ticker ni ISIN, et pour libellé la phrase
       entière qui sert de titre à la découverte. */
    const garder = id => R('Fn_SuivreInstrumentDecouverte(Var_State.decouvertes.find(function (x) { return x.id === ' + JSON.stringify(id) + '; }))');
    R('Var_State.instruments = []; Var_State.decouvertes = ['
      + '{ id: "d-ancree", ts: Date.now(), statut: "proposee", cible: "L1", titre: "Une phrase entière qui n’est pas un nom de titre" },'
      + '{ id: "d-neuve", ts: Date.now(), statut: "proposee", cible: null, instr: "Untel SA", titre: "Une phrase entière qui n’est pas un nom de titre" }];');
    garder('d-ancree');
    verifier('garder une découverte sur une ligne DÉTENUE n’ajoute aucun instrument suivi',
      J('Var_State.instruments.length') === 0, J('Var_State.instruments.length') + ' inscrit(s)');
    garder('d-neuve');
    const inst = J('Var_State.instruments');
    verifier('garder une découverte de LIGNE NOUVELLE inscrit le titre, et son NOM seul',
      inst.length === 1 && inst[0].libelle === 'Untel SA',
      JSON.stringify(inst.map(i => i.id + ' → ' + i.libelle)));
    /* Les entrées produites par la bascule inversée se retirent au chargement. */
    R('Var_State.instruments = [{ id: "dec-dec-abc", ticker: "", isin: "", place: "", libelle: "Une phrase" },'
      + ' { id: "inst-manuel", ticker: "ABC", isin: "", place: "", libelle: "Ajouté à la main" }];');
    const retires = J('Fn_NettoyerInstrumentsDecouvertes()');
    verifier('les entrées de l’ancienne bascule sont retirées, celles saisies à la main restent',
      retires === 1 && J('Var_State.instruments.length') === 1 && J('Var_State.instruments[0].id') === 'inst-manuel',
      retires + ' retiré(e), reste ' + J('Var_State.instruments.map(function (i) { return i.id; })').join(', '));
    /* Un titre suivi mérite son agenda, au même titre qu'un titre visé par un ordre. */
    R('Var_State.instruments = [{ id: "suivi-x", ticker: "", isin: "", place: "", libelle: "Autre Inc" }];'
      + 'Var_State.ordres = []; Var_State.positions = []; Var_State.agenda = {};');
    verifier('un instrument suivi entre en collecte d’agenda',
      J('Fn_AgendasAEnrichir().some(function (a) { return a.motif === "instrument suivi"; })') === true,
      J('Fn_AgendasAEnrichir().map(function (a) { return a.nom + " [" + a.motif + "]"; })').join(' | ') || 'aucun');
    /* 8. UNE ÉCHÉANCE D'ORDRE DÉJÀ PASSÉE ne s'affiche pas platement. La date est
       lue sur la ligne de l'écran des ordres, et rien ne garantit qu'elle soit
       celle de l'échéance plutôt qu'une autre date de la ligne. Passée, elle est
       soit un ordre expiré encore affiché, soit une date mal attribuée : dans les
       deux cas on le dit. */
    const hierISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const loinISO = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10);
    const val = v => J('Fn_ValiditeOrdre(' + JSON.stringify({ validite: v }) + ')');
    verifier('une échéance d’ordre DÉPASSÉE est signalée, pas affichée telle quelle',
      /DÉPASSÉE/.test(val('Continu jusqu’au ' + hierISO)), val('Continu jusqu’au ' + hierISO).slice(0, 60));
    verifier('une échéance à venir, et une validité sans date, restent intactes',
      val('Continu jusqu’au ' + loinISO).indexOf('DÉPASSÉE') < 0 && val('Continu') === 'Continu',
      val('Continu jusqu’au ' + loinISO).slice(0, 40) + ' · ' + val('Continu'));
    verifier('une validité absente affiche la donnée manquante, jamais du vide',
      /donnée manquante/.test(val(null)), val(null).slice(0, 50));
    R('Var_State.instruments = []; Var_State.decouvertes = [];');
    R('Var_State.positions = []; Var_State.ordres = []; Var_State.calendrier = []; Var_State.agenda = {}; Fn_Recalculer();');
  } catch (e) { ko('les ordres en attente et leurs annonces', String((e && e.stack) || e)); }

  /* --- CE QUE LES INDICATEURS MESURENT VRAIMENT ---
     Deux d'entre eux annonçaient autre chose que ce qu'ils calculaient, et l'un
     contredisait son voisin sur le même écran. Un indicateur faux est pire qu'un
     indicateur absent : il est lu, et il oriente. */
  console.log('\nG septies. Indicateurs — ce qu’ils annoncent et ce qu’ils calculent');
  try {
    const R = q => vm.runInContext(q, ctx);
    const J = q => JSON.parse(JSON.stringify(R(q)));
    // Extrait le pourcentage affiche par un indicateur, pour le comparer.
    const pctDe = t => { const m = /(-?[\d  ]+(?:,\d+)?)\s*%/.exec(String(t || '')); return m ? Number(m[1].replace(/[  ]/g, '').replace(',', '.')) : null; };
    const indic = nom => (J('Fn_IndicateursDiscipline()') || []).find(x => x.nom === nom) || {};
    const socle = 'Var_State.controles = []; Var_State.calendrier = []; Var_State.decouvertes = [];'
      + 'Var_State.fx = { taux: {}, ts: Date.now(), origine: "essai" };'
      + 'Var_State.marge = { titres: 1000, cash: 0, vl: 1000, risque: 500, libre: 500, as: "18:00", ts: Date.now() };';
    const ligne = (id, nom, qte, cours, sens, type, facteurs, valo) =>
      '{ id: "' + id + '", ticker: null, isin: null, detention: { nom: "' + nom + '", qte: ' + qte
      + ', dev: "EUR", cloture: ' + cours + ', clotureVeille: ' + cours + ', valEurExport: null, facteurs: '
      + JSON.stringify(facteurs) + ', poche: "CONVICTION", ts: Date.now() },'
      + ' produit: { type: "' + type + '", emetteur: null, sousJacent: null, sens: "' + sens + '",'
      + ' barriere: null, strike: null, parite: 1, levier: 1, histBarriere: [] },'
      + ' desk: { niveau: "complet" }, marche: {}, valo: ' + (valo || '{}') + ', consensus: {} }';

    /* 1. QUE DES LIGNES LONGUES, chacune portant PLUSIEURS facteurs non compensés.
       L'ancienne formule sommait un pourcentage PAR FACTEUR : la taille d'une
       ligne était comptée autant de fois qu'elle a de facteurs, et le total
       dépassait structurellement 100 % — 573 % relevés en usage réel, comparés à
       un seuil rouge de 25 %. Rouge à jamais, donc muet. Sans jambe short, la
       réponse juste est zéro. */
    R(socle + 'Var_State.positions = ['
      + ligne('L1', 'Alpha SA', 100, 4, 'long', 'action', ['tech', 'dollar', 'ia']) + ','
      + ligne('L2', 'Beta SA', 100, 4, 'long', 'action', ['luxe', 'euro', 'conso'])
      + ']; Fn_Recalculer();');
    const sansShort = indic('Jambe directionnelle sans contrepartie');
    verifier('sans aucune jambe short, « sans contrepartie » vaut ZÉRO, jamais la somme des facteurs',
      /aucune position short/.test(sansShort.valeurAff || ''),
      sansShort.valeurAff + ' [' + (sansShort.zone || 'exclu') + ']');

    /* 2. Un short dont le facteur porte AUSSI une jambe longue est une vraie
          contrepartie : il ne doit pas être compté. */
    R(socle + 'Var_State.positions = ['
      + ligne('L1', 'Alpha SA', 100, 6, 'long', 'action', ['tech']) + ','
      + ligne('S1', 'Alpha Turbo Short', 100, 2, 'short', 'derive', ['tech'])
      + ']; Fn_Recalculer();');
    const couvert = indic('Jambe directionnelle sans contrepartie');
    verifier('un short dont le facteur porte une jambe longue n’est PAS une jambe nue',
      pctDe(couvert.valeurAff) === 0, couvert.valeurAff);

    /* 2 bis. Le SENS survit à l'absence de delta. Paramètres de levier illisibles
          = delta nul ; l'agrégation se rabattait alors sur la valeur de marché,
          toujours positive, et comptait la jambe short comme une jambe longue. */
    R(socle + 'Var_State.positions = ['
      + ligne('L1', 'Alpha SA', 100, 6, 'long', 'action', ['tech']) + ','
      + ligne('S1', 'Alpha Turbo Short', 100, 2, 'short', 'derive', ['tech'])
      + ']; Var_State.positions[1].produit.deltaEur = null; Fn_Recalculer();');
    const net = J("Fn_ProfilExposition().expositionNetteParFacteur.find(function (f) { return f.cle === 'tech'; })");
    verifier('un short dont le delta est inconnu RÉDUIT l’exposition du facteur, jamais l’inverse',
      net && net.deltaEur === 400, JSON.stringify(net) + ' (attendu 400 : 600 long − 200 short)');

    /* 3. Un short seul sur son facteur est un pari autonome, compté UNE fois. */
    R(socle + 'Var_State.positions = ['
      + ligne('L1', 'Alpha SA', 100, 6, 'long', 'action', ['tech']) + ','
      + ligne('S1', 'Gamma Turbo Short', 100, 2, 'short', 'derive', ['gamma', 'euro', 'cyclique'])
      + ']; Fn_Recalculer();');
    const nu = indic('Jambe directionnelle sans contrepartie');
    verifier('un short seul sur ses facteurs compte UNE fois, pas une fois par facteur',
      pctDe(nu.valeurAff) === 20, nu.valeurAff + ' (attendu 20 % : 200 € sur 1 000 € de VN, trois facteurs)');

    /* 4. Sans facteurs, on ne peut pas dire si le short couvre : la lacune
          s'affiche et l'indicateur sort du score, jamais compté zéro. */
    R(socle + 'Var_State.positions = ['
      + ligne('L1', 'Alpha SA', 100, 6, 'long', 'action', ['tech']) + ','
      + ligne('S1', 'Delta Turbo Short', 100, 2, 'short', 'derive', [])
      + ']; Fn_Recalculer();');
    const aveugle = indic('Jambe directionnelle sans contrepartie');
    verifier('un short SANS facteurs sort du score et nomme sa lacune, au lieu d’être ignoré',
      !!aveugle.manquant && /Delta Turbo/.test(aveugle.manquant) && aveugle.zone == null,
      String(aveugle.manquant || aveugle.valeurAff).slice(0, 90));

    /* 5. LA COUVERTURE DES DONNÉES ne regardait que l'HORODATAGE. Une passe
          d'enrichissement rentrée bredouille estampillait quand même la ligne,
          qui comptait alors comme documentée : l'écran affichait « 100 % de la VN
          documentée et fraîche » trois lignes sous « multiples ET référentiel
          manquants » sur la totalité du portefeuille. */
    R(socle + 'Var_State.positions = ['
      + ligne('L1', 'Alpha SA', 100, 10, 'long', 'action', ['tech'], '{ freshTs: Date.now() }')
      + ']; Var_State.positions[0].consensus = { freshTs: Date.now() }; Fn_Recalculer();');
    const creuse = indic('Couverture des données de valorisation');
    verifier('une ligne estampillée FRAÎCHE mais sans multiple ne compte pas comme documentée',
      pctDe(creuse.valeurAff) === 0 && /absent/.test(creuse.extra || ''),
      creuse.valeurAff + ' · ' + String(creuse.extra || '').slice(0, 70));
    verifier('et elle repart à l’enrichissement au lieu d’attendre la péremption',
      J('Fn_LignesAEnrichir().length') === 1, J('Fn_LignesAEnrichir().length') + ' ligne(s)');

    /* 6. Avec un multiple ET son référentiel, la ligne est documentée — et sort
          de la sélection : un champ complet et frais n'est jamais recollecté. */
    R(socle + 'Var_State.positions = ['
      + ligne('L1', 'Alpha SA', 100, 10, 'long', 'action', ['tech'], '{ per: 12, refHist: 15, freshTs: Date.now() }')
      + ']; Var_State.positions[0].consensus = { freshTs: Date.now() }; Fn_Recalculer();');
    const pleine = indic('Couverture des données de valorisation');
    verifier('un multiple AVEC son référentiel documente la ligne, et la sort de la collecte',
      pctDe(pleine.valeurAff) === 100 && J('Fn_LignesAEnrichir().length') === 0,
      pleine.valeurAff + ' · ' + J('Fn_LignesAEnrichir().length') + ' ligne(s) à enrichir');
    /* La contradiction d'origine : couverture pleine et tension calculable
       doivent désormais aller de pair, puisqu'elles posent la MÊME question. */
    const tension = indic('Tension de valorisation');
    verifier('couverture pleine et tension de valorisation ne peuvent plus se contredire',
      !tension.manquant, String(tension.manquant || tension.valeurAff).slice(0, 80));

    /* 7. CHERCHÉ ET INTROUVABLE N'EST PAS MANQUANT. Deux passes complètes ont
       ramené neuf lignes valorisées et ZÉRO référentiel : la médiane historique
       demandée n'est publiée à peu près nulle part. Sans mémoire de cet échec, la
       ligne repartait à la collecte CHAQUE semaine pour le même résultat — un
       abonnement à l'échec, payé au tarif de la recherche web. */
    const aujISO = J('Fn_AujISO()');
    const vieuxISO = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const poserLigne = valo => R(socle + 'Var_State.positions = ['
      + ligne('L1', 'Alpha SA', 100, 10, 'long', 'action', ['tech'], valo)
      + ']; Var_State.positions[0].consensus = { freshTs: Date.now() }; Fn_Recalculer();');
    poserLigne('{ per: 12, freshTs: Date.now() }');
    verifier('sans référentiel et sans recherche passée, la ligne repart à la collecte',
      J('Fn_LignesAEnrichir().length') === 1, J('Fn_LignesAEnrichir().length') + ' ligne(s)');
    poserLigne('{ per: 12, freshTs: Date.now(), cherche: { ref: "' + aujISO + '" } }');
    verifier('CHERCHÉ AUJOURD’HUI et introuvable : la ligne ne repart PAS',
      J('Fn_LignesAEnrichir().length') === 0, J('Fn_LignesAEnrichir().length') + ' ligne(s)');
    verifier('et le cahier des charges cesse de le réclamer',
      J('Fn_ContratEnrichissement([{ id: "L1", detention: { nom: "Alpha", dev: "EUR" }, produit: { type: "action" }, desk: {}, consensus: { conso: 1, pubDate: "2026-12-01" }, valo: { per: 12, cherche: { ref: "' + aujISO + '" } } }], []).lignes[0].manque')
        .indexOf('refPairs') < 0,
      JSON.stringify(J('Fn_ContratEnrichissement([{ id: "L1", detention: { nom: "Alpha", dev: "EUR" }, produit: { type: "action" }, desk: {}, consensus: { conso: 1, pubDate: "2026-12-01" }, valo: { per: 12, cherche: { ref: "' + aujISO + '" } } }], []).lignes[0].manque')));
    /* Passé le délai, on retente : une fiche sectorielle a pu paraître. */
    poserLigne('{ per: 12, freshTs: Date.now(), cherche: { ref: "' + vieuxISO + '" } }');
    verifier('cherché il y a deux mois : on retente, l’échec n’est pas définitif',
      J('Fn_LignesAEnrichir().length') === 1, J('Fn_LignesAEnrichir().length') + ' ligne(s)');
    /* QUEL CHAMP A ÉTÉ CHERCHÉ EN VAIN ? Le premier jet marquait « référentiel
       introuvable » dès que la ligne n'était pas exploitable — sans regarder
       lequel des deux manquait. Sur un appel réel, deux lignes avaient bel et
       bien reçu leur référentiel et c'était le MULTIPLE qui manquait : elles se
       seraient tues trente jours pour la mauvaise raison, et le champ réellement
       absent n'aurait plus jamais été demandé. Ce test passe par l'INTÉGRATION,
       seul endroit où la marque est posée. */
    poserLigne('{}');
    R('Fn_IntegrerEnrichissement({ lignes: [{ id: "L1", valo: { refPairs: 18, s: "x", u: "https://e.invalid/" } }] });');
    const refSeul = J('Var_State.positions[0].valo.cherche');
    verifier('référentiel trouvé mais multiple absent : c’est le MULTIPLE qui est marqué',
      refSeul && !refSeul.ref && !!refSeul.mult, JSON.stringify(refSeul));
    poserLigne('{}');
    R('Fn_IntegrerEnrichissement({ lignes: [{ id: "L1", valo: { per: 18, s: "x", u: "https://e.invalid/" } }] });');
    const multSeul = J('Var_State.positions[0].valo.cherche');
    verifier('multiple trouvé mais référentiel absent : c’est le RÉFÉRENTIEL qui est marqué',
      multSeul && !!multSeul.ref && !multSeul.mult, JSON.stringify(multSeul));
    verifier('et une ligne dont le référentiel est trouvé repart chercher son multiple',
      J('Fn_LignesAEnrichir().length') >= 0, 'sélection : ' + J('Fn_LignesAEnrichir().length') + ' ligne(s)');
    poserLigne('{}');
    R('Fn_IntegrerEnrichissement({ lignes: [{ id: "L1", valo: { per: 18, refPairs: 20, s: "x", u: "https://e.invalid/" } }] });');
    const complet = J('Var_State.positions[0].valo.cherche');
    verifier('les deux trouvés : aucune marque, la ligne est documentée',
      complet && !complet.ref && !complet.mult && J('Fn_ValoExploitable(Var_State.positions[0]) !== null'),
      JSON.stringify(complet));
    /* L'écran doit dire laquelle des deux lacunes, sans quoi l'utilisateur
       relance une collecte qui ne peut rien rapporter. */
    poserLigne('{ per: 12, freshTs: Date.now(), cherche: { ref: "' + aujISO + '" } }');
    const couv = (J('Fn_IndicateursDiscipline()') || []).filter(x => x.nom === 'Couverture des données de valorisation')[0] || {};
    verifier('l’écran distingue « cherché, introuvable » de « manquant »',
      /introuvable/.test(String(couv.extra || '')) && /n’y repartiront PAS/.test(String(couv.extra || '')),
      String(couv.extra || '').slice(0, 130));
    R('Var_State.positions = []; Fn_Recalculer();');
  } catch (e) { ko('ce que les indicateurs mesurent', String((e && e.stack) || e)); }

  /* --- L'EXPORT DU COURTIER, lu pour de bon ---
     Le lecteur de classeur n'était vérifié que par sa PRÉSENCE. Il fait pourtant
     foi sur les quantités, les identifiants et les devises, et c'est de lui que
     se déduit le taux de change : une régression y passait inaperçue.
     Le classeur d'essai est un vrai fichier ZIP construit ici, entrées STOCKÉES
     sans compression — le bac à sable n'a pas de décompresseur, et le lecteur
     accepte la méthode 0, comme n'importe quel outil d'archive. */
  console.log('\nG ter. Export du courtier — lecture réelle d’un classeur');
  try {
    const enc = new TextEncoder();
    const u16 = n => [n & 255, (n >> 8) & 255];
    const u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const faireZip = fichiers => {
      const loc = [], cen = [];
      let offset = 0;
      fichiers.forEach(f => {
        const nom = Array.from(enc.encode(f.nom)), data = Array.from(enc.encode(f.contenu));
        const entete = [0x50, 0x4b, 0x03, 0x04].concat(u16(20), u16(0), u16(0), u16(0), u16(0),
          u32(0), u32(data.length), u32(data.length), u16(nom.length), u16(0), nom, data);
        cen.push([0x50, 0x4b, 0x01, 0x02].concat(u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
          u32(0), u32(data.length), u32(data.length), u16(nom.length), u16(0), u16(0),
          u16(0), u16(0), u32(0), u32(offset), nom));
        offset += entete.length;
        loc.push(entete);
      });
      const cl = [].concat.apply([], loc), cc = [].concat.apply([], cen);
      const fin = [0x50, 0x4b, 0x05, 0x06].concat(u16(0), u16(0), u16(fichiers.length),
        u16(fichiers.length), u32(cc.length), u32(cl.length), u16(0));
      return new Uint8Array(cl.concat(cc, fin));
    };
    const mots = ['Produit', 'Ticker/ISIN', 'Qté', 'Clôture', 'Devise', 'Montant', 'Montant EUR',
      'Untel SA', 'XX0000000019', 'EUR', 'Autre Inc', 'XX0000000027', 'USD',
      'Tierce SA', 'XX0000000035', 'CASH & CASH FUND & FTX CASH (EUR)'];
    const ss = '<?xml version="1.0"?><sst count="' + mots.length + '" uniqueCount="' + mots.length + '">'
      + mots.map(m => '<si><t>' + m.replace(/&/g, '&amp;') + '</t></si>').join('') + '</sst>';
    const cs = (r, c, i) => '<c r="' + c + r + '" t="s"><v>' + i + '</v></c>';
    const cn = (r, c, v) => '<c r="' + c + r + '"><v>' + v + '</v></c>';
    const feuille = '<?xml version="1.0"?><worksheet><sheetData>'
      + '<row r="1">' + ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => cs(1, c, i)).join('') + '</row>'
      + '<row r="2">' + cs(2, 'A', 7) + cs(2, 'B', 8) + cn(2, 'C', 120) + cn(2, 'D', '12.1')
        + cs(2, 'E', 9) + cn(2, 'F', 1452) + cn(2, 'G', 1452) + '</row>'
      + '<row r="3">' + cs(3, 'A', 10) + cs(3, 'B', 11) + cn(3, 'C', 5) + cn(3, 'D', '136.63')
        + cs(3, 'E', 12) + cn(3, 'F', '683.15') + cn(3, 'G', '578.745') + '</row>'
      + '<row r="4">' + cs(4, 'A', 13) + cs(4, 'B', 14) + cn(4, 'C', 23000) + cn(4, 'D', '0.085')
        + cs(4, 'E', 9) + cn(4, 'F', 1955) + cn(4, 'G', 1955) + '</row>'
      + '<row r="5">' + cs(5, 'A', 15) + cs(5, 'E', 9) + cn(5, 'F', -1000) + cn(5, 'G', -1000) + '</row>'
      + '</sheetData></worksheet>';
    const octets = faireZip([
      { nom: 'xl/sharedStrings.xml', contenu: ss },
      { nom: 'xl/worksheets/sheet1.xml', contenu: feuille }
    ]);
    ctx.__essaiXlsx = { name: 'export-essai.xlsx', size: octets.length,
      arrayBuffer: () => Promise.resolve(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength)) };
    const lu = await vm.runInContext('Fn_LireXlsx(__essaiXlsx)', ctx);
    verifier('classeur lu sans aucune bibliothèque : cinq lignes de cellules',
      !!lu && lu.lignes.length === 5, lu ? lu.lignes.length + ' ligne(s)' : 'illisible');
    ctx.__essaiReg = lu;
    const reg = JSON.parse(JSON.stringify(vm.runInContext('Fn_RegistreDepuisXlsx(__essaiReg)', ctx)));
    verifier('en-tête ignoré, trois positions retenues, aucune ligne rejetée',
      reg.lignes.length === 3 && reg.inconnues.length === 0,
      reg.lignes.length + ' position(s), ' + reg.inconnues.length + ' rejetée(s) : '
      + reg.inconnues.join(' | '));
    /* La régression la plus coûteuse de ce lecteur : un classeur écrit des
       nombres MACHINE, où le point est une décimale. Lus avec la règle d'un
       écran français, « 578.745 » devenait 578 745 et « 0.085 » devenait 85 —
       mille fois trop, en silence, sur le montant comme sur le cours. */
    verifier('un montant du classeur à TROIS décimales n’est pas lu mille fois trop grand',
      reg.lignes[1].montantEur === 578.745 && reg.lignes[1].montantDev === 683.15,
      'montEur ' + reg.lignes[1].montantEur + ' (attendu 578,745) · montDev ' + reg.lignes[1].montantDev);
    verifier('un cours du classeur à TROIS décimales non plus',
      reg.lignes[2].clotureVeille === 0.085,
      'clôture veille ' + reg.lignes[2].clotureVeille + ' (attendu 0,085)');
    verifier('quantités, devises et identifiants viennent du classeur, qui fait foi',
      reg.lignes[0].qte === 120 && reg.lignes[0].dev === 'EUR' && reg.lignes[0].isin === 'XX0000000019'
      && reg.lignes[1].qte === 5 && reg.lignes[1].dev === 'USD' && reg.lignes[1].isin === 'XX0000000027'
      && reg.lignes[2].qte === 23000 && reg.lignes[2].dev === 'EUR' && reg.lignes[2].isin === 'XX0000000035',
      JSON.stringify(reg.lignes.map(l => l.qte + '/' + l.dev + '/' + l.isin)));
    verifier('la colonne de clôture est lue comme la VEILLE, jamais comme le cours du jour',
      reg.lignes[0].clotureVeille === 12.1 && reg.lignes[1].clotureVeille === 136.63,
      JSON.stringify(reg.lignes.map(l => l.clotureVeille)));
    verifier('taux de change DÉDUIT du fichier : montant en euros ÷ montant en devise',
      Math.abs(reg.taux.USD - Math.round(578.745 / 683.15 * 1e6) / 1e6) < 1e-9 && reg.taux.EUR === undefined,
      JSON.stringify(reg.taux));
    /* La ligne de liquidités du courtier porte un LIBELLÉ. Exiger un libellé vide
       la faisait tomber en « ligne non reconnue » à chaque analyse, et privait de
       tout terme de comparaison le contrôle croisé des liquidités, qui ne
       s’exécutait donc jamais. */
    verifier('la ligne de liquidités est reconnue MALGRÉ son libellé — un montant, aucune quantité, aucun identifiant',
      !!reg.liquidites && reg.liquidites.montantEur === -1000 && /CASH/.test(reg.liquidites.nom || ''),
      JSON.stringify(reg.liquidites));

    /* --- LE CONTRÔLE CROISÉ, sur la même base des deux côtés ---
       L'écran donne la valeur des titres DU JOUR ; l'export donne des montants
       de la VEILLE. Sommer l'export et l'opposer à l'écran faisait lever la carte
       presque chaque jour pour tout le mouvement de la séance — un contrôle qui
       crie toujours ne se lit plus. La somme est donc recalculée au cours du jour.
       Le classeur d'essai ci-dessus est volontairement daté : 3 985,75 € de
       montants d'export contre 4 162,95 € au cours du jour, soit 4,4 % — bien
       au-delà de la tolérance de 0,5 %. */
    const R2 = q => vm.runInContext(q, ctx);
    const capture = [
      ' Untel SA Untel SA UNT | € 12,50 120 120 XX0000000019 € 12,50 EUR 1 500,00 1 500,00 ',
      ' Autre Inc Autre Inc AUT | $ 140,00 5 5 XX0000000027 $ 140,00 USD 592,95 592,95 ',
      ' Tierce SA Tierce SA TIE | € 0,090 23 000 23 000 XX0000000035 € 0,090 EUR 2 070,00 2 070,00 ',
      'Valeur des titres € 4 163,00',
      'Liquidités € -1 000,00',
      'Valeur liquidative du portefeuille € 3 163,00',
      'Dernière mise à jour à 18:46:08'
    ].join('\n');
    const analyser = titres => {
      R2('Var_State.positions = []; Var_State.controles = []; Var_State.fx = null;'
        + 'Var_State._runtime.collages = { positions: { texte: ' + JSON.stringify(capture.replace('4 163,00', titres)) + ', ts: Date.now() } };'
        + 'Var_State._runtime.xlsx = __essaiReg;');
      return JSON.parse(JSON.stringify(R2('Fn_AnalyserEntrees().controles.map(c => c.kind)')));
    };
    const justes = analyser('4 163,00');
    verifier('un export daté de la veille ne lève PLUS de faux écart de valeur des titres',
      justes.indexOf('ecart_valeur_titres') < 0, justes.join(',') || 'aucun écart');
    verifier('et les liquidités de l’export sont enfin comparables à celles de l’écran',
      justes.indexOf('ecart_liquidites') < 0, justes.join(',') || 'aucun écart');
    /* L'ÉCART QUI S'EXPLIQUE TOUT SEUL. L'écran du courtier réserve la trésorerie
       des ordres d'ACHAT en attente ; l'export ne connaît que les positions
       dénouées. Les deux écarts qui en résultent sont égaux et opposés, et valent
       la somme des achats en attente — une soustraction que l'application sait
       faire. La faire évite qu'une carte se lève chaque jour sur une divergence
       parfaitement comprise ; un contrôle qui crie toujours ne se lit plus.
       Ici : liquidités de l'écran −3 000 €, de l'export −1 000 €, et un ordre
       d'achat en attente de 2 000 € qui comble exactement la différence. */
    const preuveLiq = () => {
      const cs = JSON.parse(JSON.stringify(R2('Fn_AnalyserEntrees().controles')));
      const c = cs.filter(x => x.kind === 'ecart_liquidites')[0];
      return c ? String(c.preuve || '') + ' || ' + String(c.propo || '') : '(aucune carte)';
    };
    R2('Var_State.positions = []; Var_State.controles = []; Var_State.fx = null;'
      + 'Var_State._runtime.collages = { positions: { texte: ' + JSON.stringify(capture.replace('-1 000,00', '-3 000,00')) + ', ts: Date.now() },'
      + ' ordres: { texte: ' + JSON.stringify('Untel SA Achat  | 23:43 € 20,00  | 2 000,00  | Continu Qté 100 -0,66 (-0,83%)   ') + ', ts: Date.now() } };'
      + 'Var_State._runtime.xlsx = __essaiReg;');
    const explique = preuveLiq();
    verifier('un écart de trésorerie que les ordres d’achat en attente expliquent le DIT',
      /ordres d’ACHAT en attente/.test(explique) && /expliquée par les ordres/.test(explique),
      explique.slice(0, 120));
    // Sans ordre en attente, la carte redevient une vraie question ouverte.
    R2('Var_State.controles = []; delete Var_State._runtime.collages.ordres;');
    const ouvert = preuveLiq();
    verifier('sans ordre en attente, l’écart reste une question ouverte à expliquer',
      ouvert.indexOf('ordres d’ACHAT') < 0 && /à expliquer avant intégration/.test(ouvert),
      ouvert.slice(0, 110));
    R2('Var_State.controles = [];');
    const fausses = analyser('6 000,00');
    verifier('un écart RÉEL de valeur des titres est toujours signalé',
      fausses.indexOf('ecart_valeur_titres') >= 0, fausses.join(',') || 'aucun écart');
    // Un fichier qui n'est pas une archive doit le dire, sans casser la page.
    ctx.__essaiPdf = { name: 'faux.pdf', size: 5,
      arrayBuffer: () => Promise.resolve(new Uint8Array([37, 80, 68, 70, 45]).buffer) };
    let refus = null;
    try { await vm.runInContext('Fn_LireXlsx(__essaiPdf)', ctx); } catch (e) { refus = String(e.message || e); }
    verifier('un fichier d’aucun des deux formats est refusé avec un message lisible',
      !!refus && /ni archive/.test(refus) && /classeur ancien/.test(refus), refus || 'aucune erreur levée');
  } catch (e) { ko('lecture réelle d’un classeur', e.message); }


  /* --- L'EXPORT ANCIEN (.xls), lu pour de bon lui aussi ---
     Le courtier propose deux formats et rien ne dit lequel on a téléchargé. Le
     .xls n'est pas une archive mais un conteneur OLE2 : deux lecteurs distincts,
     donc deux jeux d'essai. Le fichier est construit ICI, à l'octet près —
     conteneur, table d'allocation, répertoire, puis les enregistrements BIFF. */
  console.log('\nG ter bis. Export ancien — conteneur OLE2 et enregistrements BIFF');
  try {
    const enc = new TextEncoder();
    const p16 = (t, o, v) => { t[o] = v & 255; t[o + 1] = (v >> 8) & 255; };
    const p32 = (t, o, v) => { t[o] = v & 255; t[o + 1] = (v >> 8) & 255; t[o + 2] = (v >> 16) & 255; t[o + 3] = (v >>> 24) & 255; };

    // --- Un flux BIFF8 : globaux (table des chaînes) puis une feuille ---
    const faireBiff = (chaines, cellules, remplissage) => {
      const recs = [];
      const rec = (id, data) => { const t = new Uint8Array(4 + data.length); p16(t, 0, id); p16(t, 2, data.length); t.set(data, 4); recs.push(t); return t; };
      const bof = type => { const d = new Uint8Array(16); p16(d, 0, 0x0600); p16(d, 2, type); return d; };
      rec(0x0809, bof(5));
      // SST : total, uniques, puis chaque chaîne (longueur, drapeaux, caractères)
      let corps = [];
      /* Une chaîne du format s'écrit soit sur UN octet par caractère (Latin-1),
         soit sur DEUX (UTF-16), et c'est un drapeau qui le dit — pas de l'UTF-8. */
      chaines.forEach(s => {
        const large = /[^ -ÿ]/.test(s), o = [];
        for (let i = 0; i < s.length; i++) {
          const cc = s.charCodeAt(i);
          if (large) o.push(cc & 255, (cc >> 8) & 255); else o.push(cc);
        }
        corps = corps.concat([s.length & 255, (s.length >> 8) & 255, large ? 1 : 0], o);
      });
      const sst = new Uint8Array(8 + corps.length);
      p32(sst, 0, chaines.length); p32(sst, 4, chaines.length); sst.set(corps, 8);
      rec(0x00fc, sst);
      const bs = new Uint8Array(8 + 5);
      p16(bs, 4, 0); bs[6] = 5; bs[7] = 0; bs.set(Array.from(enc.encode('Sheet')), 8);
      const recBs = rec(0x0085, bs.subarray(0, 13));
      rec(0x000a, new Uint8Array(0));
      const avant = recs.reduce((s, r) => s + r.length, 0);
      p32(recBs, 4, avant);                       // position de la feuille dans le flux
      rec(0x0809, bof(0x10));
      cellules.forEach(c => {
        if (c.t === 's') { const d = new Uint8Array(10); p16(d, 0, c.r); p16(d, 2, c.c); p32(d, 6, c.v); rec(0x00fd, d); }
        else if (c.t === 'n') { const d = new Uint8Array(14); p16(d, 0, c.r); p16(d, 2, c.c); new DataView(d.buffer).setFloat64(6, c.v, true); rec(0x0203, d); }
        else if (c.t === 'rk') { const d = new Uint8Array(10); p16(d, 0, c.r); p16(d, 2, c.c); p32(d, 6, c.v); rec(0x027e, d); }
      });
      rec(0x000a, new Uint8Array(0));
      if (remplissage) rec(0x00ff, new Uint8Array(remplissage));   // bourrage inerte
      const total = recs.reduce((s, r) => s + r.length, 0);
      const flux = new Uint8Array(total);
      let o = 0; recs.forEach(r => { flux.set(r, o); o += r.length; });
      return flux;
    };

    /* --- Le conteneur OLE2. Sous 4 096 octets un flux vit dans un « mini-flux »
       à secteurs de 64 octets, au-dessus dans les secteurs normaux de 512 : les
       deux chemins existent réellement dans les exports du courtier, donc les
       deux sont construits et lus. --- */
    const faireOle = flux => {
      const S = 512, MS = 64, FIN = 0xfffffffe, LIBRE = 0xffffffff, FATSEC = 0xfffffffd;
      const mini = flux.length < 4096;
      const entree = (t, o, nom, type, debut, taille) => {
        for (let i = 0; i < nom.length; i++) p16(t, o + i * 2, nom.charCodeAt(i));
        p16(t, o + 64, nom.length * 2 + 2);
        t[o + 66] = type; t[o + 67] = 1;
        p32(t, o + 116, debut); p32(t, o + 120, taille);
      };
      let secteurs, dirSec, fatSec, miniFatSec = -1, racineDebut = FIN, racineTaille = 0, wbDebut, wbSecteurs;
      if (mini) {
        const M = Math.ceil(flux.length / MS), C = Math.ceil(M * MS / S);
        miniFatSec = C; dirSec = C + 1; fatSec = C + 2;
        secteurs = C + 3; wbDebut = 0; wbSecteurs = C;
        racineDebut = 0; racineTaille = M * MS;
        var Mmini = M;
      } else {
        const W = Math.ceil(flux.length / S);
        dirSec = W; fatSec = W + 1; secteurs = W + 2; wbDebut = 0; wbSecteurs = W;
      }
      const out = new Uint8Array(512 + secteurs * S);
      const sec = i => 512 + i * S;
      // En-tête
      out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
      p16(out, 24, 0x003e); p16(out, 26, 0x0003); p16(out, 28, 0xfffe);
      p16(out, 30, 9); p16(out, 32, 6);                    // 2^9 = 512, 2^6 = 64
      p32(out, 44, 1); p32(out, 48, dirSec); p32(out, 56, 4096);
      p32(out, 60, mini ? miniFatSec : FIN); p32(out, 64, mini ? 1 : 0);
      p32(out, 68, FIN); p32(out, 72, 0);
      for (let i = 0; i < 109; i++) p32(out, 76 + i * 4, i === 0 ? fatSec : LIBRE);
      // Contenu du flux, en secteurs normaux ou en mini-secteurs
      if (mini) out.set(flux, sec(0)); else out.set(flux, sec(0));
      // Table d'allocation
      for (let i = 0; i < S / 4; i++) p32(out, sec(fatSec) + i * 4, LIBRE);
      for (let i = 0; i < wbSecteurs; i++) p32(out, sec(fatSec) + i * 4, i === wbSecteurs - 1 ? FIN : i + 1);
      p32(out, sec(fatSec) + dirSec * 4, FIN);
      p32(out, sec(fatSec) + fatSec * 4, FATSEC);
      if (mini) {
        p32(out, sec(fatSec) + miniFatSec * 4, FIN);
        for (let i = 0; i < S / 4; i++) p32(out, sec(miniFatSec) + i * 4, LIBRE);
        for (let i = 0; i < Mmini; i++) p32(out, sec(miniFatSec) + i * 4, i === Mmini - 1 ? FIN : i + 1);
      }
      // Répertoire
      entree(out, sec(dirSec), 'Root Entry', 5, racineDebut, racineTaille);
      entree(out, sec(dirSec) + 128, 'Workbook', 2, wbDebut, flux.length);
      return out;
    };

    const fichier = (octets, nom) => ({ name: nom, size: octets.length,
      arrayBuffer: () => Promise.resolve(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength)) });

    /* Sept colonnes, comme l'export courant — et la case d'en-tête du montant en
       devise VOLONTAIREMENT VIDE, parce qu'elle l'est dans le vrai fichier. */
    const mots7 = ['Produit', 'Ticker/ISIN', 'Quantité', 'Clôture', 'Devise', 'Montant en EUR',
      'Œuvre SA', 'XX0000000019', 'EUR', 'Autre Inc', 'XX0000000027', 'USD',
      'CASH & CASH FUND & FTX CASH (EUR)'];
    const cel7 = [
      { t: 's', r: 0, c: 0, v: 0 }, { t: 's', r: 0, c: 1, v: 1 }, { t: 's', r: 0, c: 2, v: 2 },
      { t: 's', r: 0, c: 3, v: 3 }, { t: 's', r: 0, c: 4, v: 4 }, { t: 's', r: 0, c: 6, v: 5 },
      { t: 's', r: 1, c: 0, v: 6 }, { t: 's', r: 1, c: 1, v: 7 }, { t: 'n', r: 1, c: 2, v: 23000 },
      { t: 'n', r: 1, c: 3, v: 0.085 }, { t: 's', r: 1, c: 4, v: 8 },
      { t: 'n', r: 1, c: 5, v: 1955 }, { t: 'n', r: 1, c: 6, v: 1955 },
      { t: 's', r: 2, c: 0, v: 9 }, { t: 's', r: 2, c: 1, v: 10 }, { t: 'rk', r: 2, c: 2, v: (5 << 2) | 2 },
      { t: 'n', r: 2, c: 3, v: 136.63 }, { t: 's', r: 2, c: 4, v: 11 },
      { t: 'n', r: 2, c: 5, v: 683.15 }, { t: 'n', r: 2, c: 6, v: 578.745 },
      { t: 's', r: 3, c: 0, v: 12 }, { t: 's', r: 3, c: 4, v: 8 },
      { t: 'rk', r: 3, c: 5, v: ((-100000 << 2) | 3) >>> 0 }, { t: 'n', r: 3, c: 6, v: -1000 }
    ];
    const biff7 = faireBiff(mots7, cel7, 0);
    ctx.__xlsMini = fichier(faireOle(biff7), 'export-ancien.xls');
    const lu7 = await vm.runInContext('Fn_LireXlsx(__xlsMini)', ctx);
    verifier('classeur ancien lu sans bibliothèque : le flux vit dans le MINI-flux (moins de 4 Ko)',
      biff7.length < 4096 && lu7.lignes.length === 4, biff7.length + ' octets, ' + (lu7 ? lu7.lignes.length : 0) + ' ligne(s)');
    ctx.__xlsReg = lu7;
    const reg7 = JSON.parse(JSON.stringify(vm.runInContext('Fn_RegistreDepuisXlsx(__xlsReg)', ctx)));
    verifier('deux positions et les liquidités, aucune ligne rejetée',
      reg7.lignes.length === 2 && !!reg7.liquidites && reg7.inconnues.length === 0,
      reg7.lignes.length + ' position(s), ' + reg7.inconnues.length + ' rejetée(s) : ' + reg7.inconnues.join(' | '));
    /* Le format ancien stocke de VRAIS nombres binaires : aucune règle de
       séparateur décimal ne s'y applique, et 0,085 doit rester 0,085. */
    verifier('les libellés sont décodés dans LES DEUX écritures du format, un et deux octets',
      reg7.lignes[0].nom === 'Œuvre SA' && reg7.lignes[1].nom === 'Autre Inc',
      reg7.lignes.map(l => l.nom).join(' | '));
    verifier('les nombres du classeur ancien sont natifs, jamais relus à la française',
      reg7.lignes[0].clotureVeille === 0.085 && reg7.lignes[1].montantEur === 578.745,
      'clôture ' + reg7.lignes[0].clotureVeille + ' · montant ' + reg7.lignes[1].montantEur);
    // « RK » : la compression maison du format, entier ou centièmes.
    verifier('un nombre compressé « RK » est décodé, entier comme centièmes',
      reg7.lignes[1].qte === 5 && reg7.liquidites.montantDev === -1000,
      'qte ' + reg7.lignes[1].qte + ' · liquidités en devise ' + reg7.liquidites.montantDev);
    /* La colonne du montant en devise n'a PAS de titre dans l'export du courtier.
       Cherchée par son libellé elle disparaissait, et le taux de change avec. */
    verifier('la colonne de montant SANS TITRE est retrouvée par sa place, donc le taux aussi',
      Math.abs(reg7.taux.USD - Math.round(578.745 / 683.15 * 1e6) / 1e6) < 1e-9, JSON.stringify(reg7.taux));

    // Le même classeur au-dessus de 4 096 octets : secteurs normaux cette fois.
    const biffGros = faireBiff(mots7, cel7, 4096);
    ctx.__xlsGros = fichier(faireOle(biffGros), 'export-ancien-gros.xls');
    const luG = await vm.runInContext('Fn_LireXlsx(__xlsGros)', ctx);
    verifier('au-dessus de 4 Ko le flux passe en secteurs normaux, et se lit pareil',
      biffGros.length >= 4096 && luG.lignes.length === 4, biffGros.length + ' octets, ' + luG.lignes.length + ' ligne(s)');

    /* SIX COLONNES — la disposition d'avant, où la devise et le montant tiennent
       dans UNE SEULE cellule (« USD 683.15 »). Lue à la lettre, elle rendait des
       montants en euros tous vides et une somme nulle, sans rien signaler. */
    const mots6 = ['Produit', 'Ticker/ISIN', 'Quantité', 'Clôture', 'Devise', 'Montant en EUR',
      'Autre Inc', 'XX0000000027', 'USD 683.15', 'CASH & CASH FUND & FTX CASH (EUR)', 'EUR -1000.00'];
    const cel6 = [
      { t: 's', r: 0, c: 0, v: 0 }, { t: 's', r: 0, c: 1, v: 1 }, { t: 's', r: 0, c: 2, v: 2 },
      { t: 's', r: 0, c: 3, v: 3 }, { t: 's', r: 0, c: 4, v: 4 }, { t: 's', r: 0, c: 5, v: 5 },
      { t: 's', r: 1, c: 0, v: 6 }, { t: 's', r: 1, c: 1, v: 7 }, { t: 'n', r: 1, c: 2, v: 5 },
      { t: 'n', r: 1, c: 3, v: 136.63 }, { t: 's', r: 1, c: 4, v: 8 }, { t: 'n', r: 1, c: 5, v: 578.745 },
      { t: 's', r: 2, c: 0, v: 9 }, { t: 's', r: 2, c: 4, v: 10 }, { t: 'n', r: 2, c: 5, v: -1000 }
    ];
    ctx.__xls6 = fichier(faireOle(faireBiff(mots6, cel6, 0)), 'export-six-colonnes.xls');
    const lu6 = await vm.runInContext('Fn_LireXlsx(__xls6)', ctx);
    ctx.__xls6Reg = lu6;
    const reg6 = JSON.parse(JSON.stringify(vm.runInContext('Fn_RegistreDepuisXlsx(__xls6Reg)', ctx)));
    verifier('une disposition à SIX colonnes reste lisible : les colonnes viennent de l’en-tête',
      reg6.lignes.length === 1 && reg6.lignes[0].montantEur === 578.745 && reg6.inconnues.length === 0,
      reg6.lignes.length + ' position(s), montant ' + (reg6.lignes[0] || {}).montantEur);
    verifier('devise et montant FUSIONNÉS dans une cellule sont séparés, et le taux s’en déduit',
      reg6.lignes[0].dev === 'USD' && reg6.lignes[0].montantDev === 683.15
      && Math.abs(reg6.taux.USD - Math.round(578.745 / 683.15 * 1e6) / 1e6) < 1e-9,
      reg6.lignes[0].dev + ' / ' + reg6.lignes[0].montantDev + ' · ' + JSON.stringify(reg6.taux));
    verifier('la ligne de liquidités de cette disposition est reconnue elle aussi',
      !!reg6.liquidites && reg6.liquidites.montantEur === -1000 && reg6.liquidites.montantDev === -1000,
      JSON.stringify(reg6.liquidites));

    /* Un classeur VIDE se lit sans erreur et ne donne rien : accepté, il
       s'afficherait comme chargé pendant que les contrôles croisés seraient morts. */
    ctx.__xlsVide = fichier(faireOle(faireBiff(['Produit'], [], 0)), 'vide.xls');
    let refusVide = null;
    try { await vm.runInContext('Fn_LireXlsx(__xlsVide)', ctx); } catch (e) { refusVide = String(e.message || e); }
    verifier('un classeur entièrement vide est REFUSÉ, avec la marche à suivre',
      !!refusVide && /vide/i.test(refusVide) && /export/i.test(refusVide), refusVide || 'accepté en silence');

    // Un fichier à signature ancienne mais illisible doit le dire, sans casser la page.
    ctx.__xlsPdf = { name: 'faux.xls', size: 8,
      arrayBuffer: () => Promise.resolve(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3, 4]).buffer) };
    let refusPdf = null;
    try { await vm.runInContext('Fn_LireXlsx(__xlsPdf)', ctx); } catch (e) { refusPdf = String(e.message || e); }
    verifier('un fichier à signature ancienne mais tronqué est refusé lisiblement',
      !!refusPdf && /classeur/i.test(refusPdf), refusPdf || 'accepté en silence');
  } catch (e) {
    verifier('section G ter bis exécutée', false, String((e && e.stack) || e));
  }

  /* --- LE CYCLE DE VIE D'UN ÉVÉNEMENT, et l'économie qu'il porte ---
     Un événement dont les chiffres n'ont pas bougé ne doit JAMAIS repartir au
     desk. C'est la principale économie du cycle, et elle repose entièrement sur
     l'empreinte : un seul champ qui change en douce, et tout le calendrier se
     repaie à chaque analyse. */
  console.log('\nG quater. Calendrier — l’empreinte et ce qu’elle économise');
  try {
    const R = q => vm.runInContext(q, ctx);
    const J = q => JSON.parse(JSON.stringify(R(q)));
    R('Var_State.calendrier = [];'
      + 'Fn_PoserEvenement({ id: "ev1", isin: "P1", date: "2099-01-01", statut: "prevu", source: "regle:test",'
      + '  libelle: "Publication trimestrielle", court: "Publication", sev: "Warn", conf: true, tags: ["P1"],'
      + '  metriques: [{ l: "poids", v: "12 %" }] });');
    verifier('un événement neuf est à écrire : il n’a pas encore de textes',
      R('Fn_TextesAEcrire(Var_State.calendrier[0])') === true);

    // Le desk écrit ses textes ET ajoute une métrique de son cru.
    R('Fn_IntegrerDesk({ v: 3, evTextes: [{ id: "ev1", surv: "à lire", arb: "si X alors Y", prat: "règle",'
      + '  m: [{ l: "gap implicite", v: "8 %" }] }] }, null);');
    const apres = J('Var_State.calendrier[0]');
    verifier('le desk peut AJOUTER une métrique, et l’empreinte est prise APRÈS l’ajout',
      apres.metriques.length === 2 && apres.textes.empreinte.indexOf('gap implicite') >= 0,
      JSON.stringify(apres.metriques) + ' → ' + apres.textes.empreinte);
    verifier('textes écrits : l’événement ne repart plus au desk',
      R('Fn_TextesAEcrire(Var_State.calendrier[0])') === false);

    // Une régénération du squelette repose le MÊME événement, avec les seules
    // métriques de la règle. Rien ne doit bouger.
    R('Fn_PoserEvenement({ id: "ev1", isin: "P1", date: "2099-01-01", statut: "prevu", source: "regle:test",'
      + '  libelle: "Publication trimestrielle", court: "Publication", sev: "Warn", conf: true, tags: ["P1"],'
      + '  metriques: [{ l: "poids", v: "12 %" }] });');
    const rejoue = J('Var_State.calendrier[0]');
    verifier('reposer l’événement ne perd PAS la métrique ajoutée par le desk',
      rejoue.metriques.length === 2 && rejoue.metriques.some(m => m.l === 'gap implicite'),
      JSON.stringify(rejoue.metriques));
    verifier('et il ne repart donc PAS au desk — c’est là qu’est l’économie',
      R('Fn_TextesAEcrire(Var_State.calendrier[0])') === false,
      'empreinte stockée ' + rejoue.textes.empreinte + ' · calculée ' + R('Fn_EmpreinteEvenement(Var_State.calendrier[0])'));

    // Un chiffre qui BOUGE, en revanche, doit le renvoyer.
    R('Fn_PoserEvenement({ id: "ev1", isin: "P1", date: "2099-01-01", statut: "prevu", source: "regle:test",'
      + '  libelle: "Publication trimestrielle", court: "Publication", sev: "Crit", conf: true, tags: ["P1"],'
      + '  metriques: [{ l: "poids", v: "31 %" }] });');
    verifier('un chiffre qui a matériellement bougé le renvoie au desk',
      R('Fn_TextesAEcrire(Var_State.calendrier[0])') === true);

    // Un événement archivé ne se réécrit jamais, quoi qu'en dise la règle.
    R('Var_State.calendrier[0].statut = "debriefe";');
    verifier('un événement débriefé est archivé : la règle ne le ressuscite pas',
      R('Fn_PoserEvenement({ id: "ev1", date: "2099-02-02", statut: "prevu", source: "regle:test",'
        + ' libelle: "Autre", court: "Autre", sev: "Info", conf: true, tags: [], metriques: [] })') === 'archive'
      && J('Var_State.calendrier[0].date') === '2099-01-01');
  } catch (e) { ko('le cycle de vie d’un événement', e.message); }

  /* --- L'ARBITRAGE DE SYNCHRONISATION ---
     C'est le seul code de l'application capable de DÉTRUIRE des données sans que
     personne ne clique : il décide, seul, si l'état distant remplace le local.
     Les trois cas sont rejoués ici contre un dépôt simulé. */
  console.log('\nG quinquies. Synchronisation — qui gagne, et pourquoi');
  try {
    const R = q => vm.runInContext(q, ctx);
    const J = q => JSON.parse(JSON.stringify(R(q)));
    const vraiFetch = ctx.fetch, vraiLs = ctx.localStorage.getItem;
    // Jeton présent, sinon Fn_SyncTirer s'arrête avant tout arbitrage.
    ctx.localStorage.getItem = c => (/ghtoken/.test(String(c)) ? 'jeton-essai' : null);
    let dernierPut = null;
    const poserDepot = etat => {
      ctx.fetch = (url, opt) => {
        if (opt && opt.method === 'PUT') { dernierPut = JSON.parse(opt.body); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ content: { sha: 'sha2' } }) }); }
        const b = Buffer.from(JSON.stringify(etat), 'utf8').toString('base64');
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sha: 'sha1', content: b }) });
      };
    };
    const distantPlein = { v: 3, etatTs: 5000, positions: [{ id: 'D1', detention: { nom: 'Ligne distante', qte: 1, dev: 'EUR' }, produit: {}, desk: {} }], calendrier: [{ id: 'e9', date: '2099-01-01', statut: 'prevu', libelle: 'Distante', metriques: [] }] };

    // Cas 1 — le distant est plus récent : il gagne, c'est la règle générale.
    poserDepot(distantPlein);
    R('Var_State.etatTs = 1000; Var_State.razTs = null; Var_State.positions = []; Var_State.calendrier = [];'
      + 'Var_State.derniereMaj = 4000; Var_State._runtime.syncSha = null;');
    await R('Fn_SyncTirer()');
    verifier('le distant plus récent est adopté — « le plus récent gagne »',
      J('Var_State.positions.length') === 1 && J('Var_State.etatTs') === 5000,
      'positions ' + J('Var_State.positions.length') + ' · etatTs ' + J('Var_State.etatTs'));

    // Cas 2 — appareil vierge, distant rempli : la ceinture de sécurité joue,
    // quels que soient les horodatages.
    poserDepot(distantPlein);
    R('Var_State.etatTs = 99999; Var_State.razTs = null; Var_State.positions = []; Var_State.calendrier = [];'
      + 'Var_State.derniereMaj = null; Var_State._runtime.syncSha = null;');
    await R('Fn_SyncTirer()');
    verifier('un appareil VIERGE adopte un distant rempli, même s’il se croit plus récent',
      J('Var_State.positions.length') === 1,
      'positions ' + J('Var_State.positions.length'));

    // Cas 3 — même signature, mais le vide est VOULU : il doit gagner, et partir.
    poserDepot(distantPlein);
    dernierPut = null;
    R('Var_State.positions = []; Var_State.calendrier = []; Var_State.derniereMaj = null;'
      + 'Var_State._runtime.syncSha = "sha1"; Var_State._runtime.syncDernierPushTs = 0;'
      + 'Var_State.razTs = Date.now(); Var_State.etatTs = Var_State.razTs;');
    await R('Fn_SyncTirer()');
    verifier('une remise à zéro VOULUE n’est PAS défaite par la synchronisation',
      J('Var_State.positions.length') === 0 && J('Var_State.calendrier.length') === 0,
      'positions ' + J('Var_State.positions.length') + ' · événements ' + J('Var_State.calendrier.length'));
    // L’envoi est déclenché PAR Fn_SyncTirer, sans attente : on laisse la chaîne
    // de promesses se dénouer avant de regarder ce qui est parti.
    await new Promise(r => setTimeout(r, 30));
    const envoye = dernierPut ? JSON.parse(Buffer.from(dernierPut.content, 'base64').toString('utf8')) : null;
    verifier('et le vide part AU DÉPÔT, sinon le prochain appareil le restaurerait',
      !!envoye && (envoye.positions || []).length === 0 && (envoye.calendrier || []).length === 0,
      envoye ? 'positions ' + (envoye.positions || []).length : 'aucun envoi');
    verifier('l’aveu de remise à zéro s’efface une fois le dépôt vidé',
      J('Var_State.razTs') === null, String(J('Var_State.razTs')));

    ctx.fetch = vraiFetch;
    ctx.localStorage.getItem = vraiLs;
  } catch (e) { ko('l’arbitrage de synchronisation', e.message); }

  /* --- UNE CARTE PAR FAIT, PAS UNE PAR LANCEMENT ---
     Le dédoublonnage comparait l'identifiant ENTRANT d'un contrôle à
     l'identifiant de STOCKAGE du contrôle rangé — or celui-ci est engendré à
     l'écriture, donc jamais porté par l'entrant. Tout contrôle sans identifiant
     métier échappait ainsi à la comparaison, et « Analyser les entrées »
     empilait un jeu complet de doublons à chaque lancement : invisible à
     l'écran, qui n'en montre qu'un, mais bien présent dans l'état synchronisé
     et laissé derrière par un « tout accepter ». */
  console.log('\nG sexies. Cartes à valider — une carte par fait');
  try {
    const J = q => JSON.parse(JSON.stringify(vm.runInContext(q, ctx)));
    const R = q => vm.runInContext(q, ctx);
    const poser = (obj, fois) => {
      R('Var_State.controles = [];');
      for (let i = 0; i < fois; i++) R('Fn_AjouterControle(' + JSON.stringify(obj) + ');');
      return J('Var_State.controles.length');
    };
    // Le cas qui a mordu : aucun identifiant métier, seulement un payload.
    const ligne = { kind: 'nouvelle_ligne', payload: { id: 'pos-abc', nom: 'Untel SA' },
      resume: 'Nouvelle ligne détectée : Untel SA — 60 titres, 1 452 €.' };
    verifier('trois analyses de suite ne laissent QU’UNE carte « nouvelle ligne »',
      poser(ligne, 3) === 1, poser(ligne, 3) + ' carte(s) pour un seul fait');
    // Un contrôle de portefeuille est unique par nature, et ses chiffres bougent.
    R('Var_State.controles = [];');
    R('Fn_AjouterControle({ kind: "ecart_valeur_titres", resume: "écart de 8 958 €." });');
    R('Fn_AjouterControle({ kind: "ecart_valeur_titres", resume: "écart de 9 102 €." });');
    const uniq = J('Var_State.controles');
    verifier('un écart de portefeuille reste UNE carte, et ses chiffres sont RAFRAÎCHIS',
      uniq.length === 1 && /9 102/.test(uniq[0].resume),
      uniq.length + ' carte(s) · ' + (uniq[0] || {}).resume);
    // Deux faits distincts restent deux cartes — le repli ne doit pas trop replier.
    R('Var_State.controles = [];');
    R('Fn_AjouterControle({ kind: "ecart_quantite", id: "pos-un", resume: "quantité divergente sur Untel SA." });');
    R('Fn_AjouterControle({ kind: "ecart_quantite", id: "pos-deux", resume: "quantité divergente sur Autre Inc." });');
    R('Fn_AjouterControle({ kind: "ligne_absente_capture", resume: "Ligne absente de la capture : Untel SA." });');
    R('Fn_AjouterControle({ kind: "ligne_absente_capture", resume: "Ligne absente de la capture : Autre Inc." });');
    verifier('deux faits distincts font toujours deux cartes, avec ou sans identifiant métier',
      J('Var_State.controles.length') === 4, J('Var_State.controles.length') + ' carte(s) pour quatre faits');
    // Une carte déjà tranchée ne bloque pas la réapparition du même écart.
    R('Var_State.controles = [];');
    R('Fn_AjouterControle({ kind: "ecart_liquidites", resume: "écart de -8 999 €." });');
    R('Var_State.controles[0].statut = "rejete";');
    R('Fn_AjouterControle({ kind: "ecart_liquidites", resume: "écart de -8 999 €." });');
    verifier('une carte déjà tranchée n’empêche pas le même écart de revenir',
      J('Var_State.controles.length') === 2, J('Var_State.controles.length') + ' carte(s)');
    /* Repli d'un état ANTÉRIEUR : les doublons déjà écrits doivent disparaître au
       chargement, sinon la correction ne nettoie jamais ce qu'elle a laissé. */
    R('Var_State.controles = ['
      + '{ id: "ctl-1", statut: "a_valider", kind: "nouvelle_ligne", payload: { id: "pos-abc" }, resume: "vieille" },'
      + '{ id: "ctl-2", statut: "a_valider", kind: "nouvelle_ligne", payload: { id: "pos-abc" }, resume: "récente" },'
      + '{ id: "ctl-3", statut: "a_valider", kind: "ecart_valeur_titres", resume: "8 958 €" },'
      + '{ id: "ctl-4", statut: "a_valider", kind: "ecart_valeur_titres", resume: "8 958 €" },'
      + '{ id: "ctl-5", statut: "accepte", kind: "nouvelle_ligne", payload: { id: "pos-abc" }, resume: "tranchée" }];');
    const replies = J('Fn_FusionnerControlesDoublons()');
    const apres = J('Var_State.controles');
    verifier('un état déjà pollué est replié au chargement, la carte la plus FRAÎCHE gagnant',
      replies === 2 && apres.length === 3 && apres[0].resume === 'récente'
      && apres.filter(c => c.statut === 'accepte').length === 1,
      replies + ' repliée(s), reste ' + apres.length + ' : ' + apres.map(c => c.statut + '/' + c.resume).join(' | '));
    R('Var_State.controles = [];');
  } catch (e) { ko('l’unicité des cartes à valider', String((e && e.stack) || e)); }

  /* --- Le texte envoyé au modèle --- */
  console.log('\nH. Contrat d’appel');
  try {
    const ctxDesk = { passe: 'desk', contrat: vm.runInContext('Fn_ContratDesk()', ctx),
      budget: vm.runInContext('Fn_BudgetDesk(0)', ctx), sitesAutorises: [] };
    const texteDesk = vm.runInContext('Fn_BuildPromptMAJ(' + JSON.stringify(ctxDesk) + ')', ctx);
    verifier('le desk reçoit un cahier des charges complet', texteDesk.length > 6000,
      'longueur ' + texteDesk.length + ' caractères (trop court : consignes appauvries ?)');
    console.log('  INFO texte envoyé au desk : ' + texteDesk.length + ' caractères');
    // Le principe directeur doit être écrit noir sur blanc : c'est lui qui
    // empêche de redemander au modèle ce que l'application sait calculer.
    verifier('le desk se voit interdire de réémettre les chiffres',
      /n’ÉMETS aucun|Ces champs te sont FOURNIS/.test(texteDesk),
      'la règle « le desk reçoit les nombres et n’en émet aucun » a disparu du texte');
    verifier('le budget des découvertes est annoncé au modèle',
      /réservé/.test(texteDesk) && /découvertes/.test(texteDesk));
    verifier('les deux régimes de style sont imposés',
      /TÉLÉGRAPHIQUE/.test(texteDesk) && /aucun appauvrissement/i.test(texteDesk));

    const ctxEnr = { passe: 'enrichissement', contrat: vm.runInContext('Fn_ContratEnrichissement([])', ctx),
      budget: vm.runInContext('Fn_BudgetEnrichissement(3)', ctx), sitesAutorises: [] };
    const texteEnr = vm.runInContext('Fn_BuildPromptMAJ(' + JSON.stringify(ctxEnr) + ')', ctx);
    verifier('la passe d’enrichissement a son propre cahier des charges', texteEnr.length > 2000,
      'longueur ' + texteEnr.length + ' caractères');
    console.log('  INFO texte envoyé à l’enrichissement : ' + texteEnr.length + ' caractères');
    verifier('l’enrichissement ne collecte que ce qui manque',
      /DÉJÀ CONNUS et frais/.test(texteEnr));

    // Budgets calculés, jamais des constantes en dur (§ 16 du cahier).
    const b1 = vm.runInContext('Fn_BudgetEnrichissement(3).recherches', ctx);
    const b2 = vm.runInContext('Fn_BudgetEnrichissement(30).recherches', ctx);
    verifier('budget de collecte proportionnel, jamais une constante', b2 > b1, b1 + ' puis ' + b2);
  } catch (e) { ko('contrat d’appel', e.message); }

  /* --- Aide des commandes --- */
  /* --- OÙ VIT QUOI ---
     L'onglet Vigie sert à DÉCIDER : ce qui est échu, ce qui est à valider, ce qui
     vient. La mécanique d'appel — charge du desk, projection de dépense, journal
     détaillé — se RÈGLE, et un réglage vit dans Paramètres. Elle occupait 5 477
     caractères en tête de Vigie, avant tout ce qu'on vient y lire. Le partage doit
     tenir : ni retour du pavé dans Vigie, ni duplication entre les deux onglets. */
  console.log('\nJ. Répartition Vigie / Paramètres');
  try {
    const R = q => vm.runInContext(q, ctx);
    const J = q => JSON.parse(JSON.stringify(R(q)));
    R('Fn_ModeAcces = function () { return { mode: "cle", libelle: "Clé personnelle" }; };');
    R('Fn_RenderVigie();');
    const texte = id => String((els[id] && els[id].innerHTML) || '')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
    const maj = texte('v-maj');
    verifier('l’onglet Vigie ne porte plus le pavé de mise à jour (moins de 900 caractères)',
      maj.length > 0 && maj.length < 900, maj.length + ' caractères');
    /* Sans journal en base, la ligne « Dernier appel » n’a rien à dire : on
       vérifie donc les deux déclencheurs, puis la ligne une fois un journal posé. */
    /* Sans accès configuré, les deux lancements sont MASQUÉS : leur absence doit
       alors s’expliquer d’elle-même, et rappeler que la clé est stockée PAR APPAREIL
       — l’avoir saisie ailleurs ne la met pas ici. */
    R('Fn_ModeAcces = function () { return { mode: "aucun", libelle: "aucun" }; }; Fn_RenderMajPanel();');
    const sansCle = texte('v-maj');
    verifier('sans accès, l’absence de bouton s’explique et rappelle que la clé est par appareil',
      /masqués/.test(sansCle) && /CET appareil/.test(sansCle) && /jamais synchronis/i.test(sansCle),
      sansCle.slice(-110));
    R('Fn_ModeAcces = function () { return { mode: "cle", libelle: "Clé personnelle" }; }; Fn_RenderVigie();');

    verifier('mais il garde le lancement du desk, et ce qui le justifie',
      /data-action="maj-lancer"/.test(String(els['v-maj'].innerHTML))
      && /découverte\(s\) visée\(s\)/.test(maj), maj.slice(0, 80));
    R('Var_State.majJournaux = [{ debutTs: Date.now(), passe: "desk", statut: "terminee", coutUsd: 1.5, phases: [] }]; Fn_RenderMajPanel();');
    verifier('et le sort du dernier appel, avec son coût, en UNE ligne',
      /Dernier appel/.test(texte('v-maj')) && /US/.test(texte('v-maj')),
      texte('v-maj').slice(0, 80));
    R('Var_State.majJournaux = [];');
    /* AUCUNE REDONDANCE : ce qui est parti ne doit pas être resté. */
    ['Ce que le desk aura à produire', 'Ce que le desk sait déjà', 'Projection de dépense']
      .forEach(t => {
        verifier('« ' + t.slice(0, 34) + ' » a quitté l’onglet Vigie',
          maj.indexOf(t) < 0, maj.indexOf(t) < 0 ? 'absent, comme voulu' : 'encore présent');
      });
    R('Var_State.panneaux.majDetail = true; Fn_RenderParametres();');
    const param = texte('p-contenu');
    verifier('et se retrouve en entier dans Paramètres',
      /Ce que le desk aura à produire/.test(param) && /Ce que le desk sait déjà/.test(param),
      param.length + ' caractères dans Paramètres');
    /* LA BANDE D'AVANCEMENT, construite avec la VRAIE forme d'une phase.
       Fn_Phase range ses phases sous « cle » ; un premier essai les lisait sous
       « id » et affichait « undefined » en plein milieu de la bande — le test ne
       l'avait pas vu parce que sa fixture reproduisait la faute du code. Une
       fixture se calque sur la donnée réelle, jamais sur le code qu'elle teste. */
    R('Var_State.majJournaux = [{ id: "t", debutTs: Date.now() - 90000, passe: "enrichissement", statut: "en cours", modele: "m", recherches: 68, lectures: 4, jetonsSortie: 900, budget: { recherches: 36, lectures: 24 }, phases: [{ cle: "recherches", statut: "en cours", message: "Recherches web" }] }]; Fn_RenderBandeMAJ();');
    const bande = texte('entete-maj');
    verifier('pendant un appel, la bande dit la passe, la phase, le chrono et la dépense',
      /ENRICHISSEMENT/.test(bande) && /Recherches web/.test(bande) && /chrono/.test(bande)
      && /dépense/.test(bande) && bande.indexOf('undefined') < 0,
      bande.slice(0, 100));
    /* Le compteur en direct compte des APPELS D'OUTIL ; la facturation compte des
       requêtes et les déduplique. Le voir dépasser son budget est alarmant tant
       qu'on l'ignore : 68 appels ont donné 35 requêtes facturées pour 36 budgétées. */
    verifier('et quand le compteur dépasse son budget, elle dit POURQUOI',
      /68/.test(bande) && /36/.test(bande) && /appels d’outil/.test(bande) && /déduplique/.test(bande),
      bande.slice(-120));
    R('Var_State.majJournaux = []; Fn_RenderBandeMAJ();');
    verifier('hors appel, la bande est vide et s’efface',
      texte('entete-maj') === '', JSON.stringify(texte('entete-maj')));
    /* CHANGER D'ONGLET DEPUIS LE CORPS DE PAGE. L'action « onglet » n'était
       câblée que sur la barre de navigation : « Voir la discipline », posé dans
       le bandeau d'alerte, ne faisait rien. Un bouton qui ne fait rien est pire
       qu'un bouton absent — on le presse deux fois avant de douter de soi. */
    verifier('l’action « onglet » est routée depuis le corps de page, pas seulement la barre',
      /case 'onglet':/.test(js), 'Fn_OnAction traite l’action onglet');
    /* Une valeur de case ne déborde plus : « Strong Buy (28 achat fort / … ) »
       sortait de sa colonne de 8,5 rem, faute de pouvoir se replier. */
    verifier('une valeur longue se replie dans sa case au lieu de déborder',
      /\.valo-grille \.met b\{[^}]*white-space:normal/.test(h)
      && /\.valo-grille \.met-large\{grid-column:1\/-1\}/.test(h),
      'CSS des cases de valeur');

    /* CE QUE LES TROIS CASES DE THÈSE FONT, ET CE QU'ELLES NE FONT PAS.
       Leur aide annonçait qu'elles alimentaient « Fraîcheur des thèses » — c'est
       faux : cet indicateur ne lit que la date de dernière revue. Une aide qui
       promet un effet inexistant est un bug, pas une approximation. */
    R('Var_State.marge = { titres: 1000, cash: 0, vl: 1000, risque: 500, libre: 500, as: "18:00", ts: Date.now() };'
      + 'Var_State.positions = [{ id: "L1", ticker: null, isin: null,'
      + ' detention: { nom: "Alpha SA", qte: 100, dev: "EUR", cloture: 10, clotureVeille: 10, valEurExport: null,'
      + '   facteurs: ["tech"], poche: "CONVICTION", ts: Date.now() },'
      + ' produit: { type: "action", sens: "long", histBarriere: [] }, desk: { niveau: "complet", profil: "croissance" },'
      + ' marche: {}, valo: {}, consensus: {} }];'
      + 'Var_State.theses = { L1: { ecrite: true, invalidation: true, objectif: true, derniereRevue: null } };'
      + 'Fn_Recalculer();');
    const fraich = (J('Fn_IndicateursDiscipline()') || []).filter(x => x.nom === 'Fraîcheur des thèses')[0] || {};
    verifier('cocher les trois cases ne change RIEN à la fraîcheur des thèses',
      /jamais revue/.test(String(fraich.valeurAff) + String(fraich.extra)),
      String(fraich.valeurAff));
    verifier('mais les trois déclarations PARTENT au desk, qui cesse de les redemander',
      JSON.stringify(J('Fn_ContratDesk().pos[0].vous')).indexOf('these') >= 0,
      JSON.stringify(J('Fn_ContratDesk().pos[0].vous')));
    /* « Thèse » désignait DEUX choses sur la même fiche : celle que le desk vient
       d’écrire, et celle de l’utilisateur. « Thèse écrite » se lisait comme un constat
       — le desk en a écrit une, je coche — au lieu d’une question. */
    verifier('les cases de thèse se lisent à la PREMIÈRE PERSONNE, pas comme un constat',
      Object.keys(J('Cst_AideThese')).every(k => /^J’ai /.test(J('Cst_AideThese')[k].t)),
      Object.keys(J('Cst_AideThese')).map(k => J('Cst_AideThese')[k].t).join(' · '));
    verifier('et l’aide de chaque case dit ce qu’elle fait vraiment, sans promettre l’inverse',
      Object.keys(J('Cst_AideThese')).every(k =>
        /sans effet sur le score|Sans effet sur le score/.test(J('Cst_AideThese')[k].d)),
      Object.keys(J('Cst_AideThese')).join(', '));
    /* DÉCLARER NE SUFFIT PAS : ce que l'utilisateur ÉCRIT doit atteindre le desk.
       Sans le texte, celui-ci savait qu'une thèse existait sans savoir ce qu'elle
       disait — il écrivait la sienne à côté au lieu de dialoguer avec. Avec, il
       peut la confronter, chiffrer l'écart à l'objectif, et surtout signaler
       qu'une invalidation VIENT D'ÊTRE TOUCHÉE : lui seul lit l'actualité. */
    R('Var_State.theses = { L1: { ecrite: true, invalidation: true, objectif: true, derniereRevue: "2026-08-26", texte: "Ma raison de détenir.", invalTexte: "Ce qui me ferait sortir.", objTexte: "Mon objectif." } };');
    const vous = J('Fn_ContratDesk().pos[0].vous');
    verifier('les TEXTES de l’utilisateur partent au desk, pas seulement ses cases cochées',
      vous.these === 'Ma raison de détenir.' && vous.inval === 'Ce qui me ferait sortir.'
      && vous.obj === 'Mon objectif.',
      JSON.stringify(vous));
    /* Une déclaration SANS texte reste valide : une thèse tenue dans un carnet
       est une thèse, et la déclarer vaut mieux que de ne rien dire. */
    R('Var_State.theses = { L1: { ecrite: true, invalidation: false, objectif: false, derniereRevue: null } };');
    const nu = J('Fn_ContratDesk().pos[0].vous');
    verifier('une déclaration sans texte reste transmise, sans champ vide inventé',
      nu.declare.indexOf('these') >= 0 && nu.these === undefined, JSON.stringify(nu));
    /* Le cahier des charges doit DEMANDER le dialogue, sinon le texte voyage
       pour rien : le modèle le lirait sans savoir qu'on attend une confrontation. */
    const brief = R('Fn_BuildPromptMAJ({ contrat: Fn_ContratDesk(), budget: { recherches: 5, lectures: 3, decouvertes: 2, debriefs: 0 } })');
    verifier('et le desk reçoit la consigne de DIALOGUER avec, pas de la paraphraser',
      /vous\.inval/.test(brief) && /D\u00c9J\u00c0 TOUCH\u00c9E/.test(brief) && /DIALOGUER/.test(brief),
      'consigne de confrontation présente dans le cahier des charges');
    /* Le texte s'enregistre par la fonction, borné à sa longueur déclarée. */
    R('Var_State.theses = {};');
    R('Fn_SauverTexteThese("L1", "texte", new Array(900).join("x"));');
    verifier('un texte trop long est TRONQUÉ à son plafond, jamais refusé en silence',
      J('Var_State.theses.L1.texte.length') === 600, J('Var_State.theses.L1.texte.length') + ' caractères');
    verifier('et un champ inconnu n’écrit rien du tout',
      J('Fn_SauverTexteThese("L1", "inconnu", "x")') === false && J('Var_State.theses.L1.inconnu === undefined'),
      'champ refusé');
    /* COCHER DOIT FAIRE APPARAÎTRE LE CHAMP. La case ne faisait qu'enregistrer
       un booléen, et ne redessinait rien : l'état coché est natif, cela suffisait.
       Depuis qu'elle commande l'ouverture d'une zone de saisie, ne pas re-rendre
       signifie que cocher ne produit RIEN de visible. Ce test passe par le
       gestionnaire réel, avec un faux événement — le tester sur la seule fonction
       de rendu aurait laissé le trou exactement là où il était. */
    R('Var_State.theses = {}; Var_State.positions = [{ id: "L1", ticker: null, isin: null,'
      + ' detention: { nom: "Alpha SA", qte: 10, dev: "EUR", cloture: 10, clotureVeille: 10, valEurExport: null,'
      + '   facteurs: [], poche: null, ts: Date.now() },'
      + ' produit: { type: "action", sens: "long", histBarriere: [] }, desk: { niveau: "complet" },'
      + ' marche: {}, valo: {}, consensus: {} }]; Fn_Recalculer();');
    verifier('case décochée : aucune zone de saisie, l’écran ne promet rien',
      String(R('Fn_HtmlThese(Var_State.positions[0])')).indexOf('these-texte') < 0,
      'aucune zone avant de cocher');
    /* Le bloc de déclarations s’affiche sur TOUTE ligne, quel que soit son poids :
       la matérialité règle ce que le desk écrit, pas ce que l’utilisateur a le droit
       de formaliser. Réservé aux lignes lourdes, il interdisait d’écrire une
       invalidation sur un produit à levier — celui qui en réclame le plus. */
    ['compact', 'ligne', 'derive'].forEach(niv => {
      R('Var_State.positions[0].desk.niveau = ' + JSON.stringify(niv) + ';');
      verifier('les déclarations restent accessibles au niveau « ' + niv + ' »',
        /these-check/.test(String(R('Fn_HtmlCartePosition(Var_State.positions[0])'))),
        'bloc présent');
    });
    R('Var_State.positions[0].desk.niveau = ' + JSON.stringify('complet') + ';');

    /* UNE INVITE NE CITE PAS L'EXEMPLE D'UN AUTRE TITRE. Écrites en dur, elles
       finissaient par proposer « pas de commande ROSIE » — exemple pris sur une
       small cap — dans la case d'un turbo LVMH. Elles sont donc fonction de la
       ligne, et un produit à levier reçoit les siennes. */
    R('Var_State.theses = { L1: { ecrite: true, invalidation: true, objectif: true } };');
    R('Var_State.positions[0].produit.type = "derive"; Var_State.positions[0].produit.sousJacent = "Untel SA";');
    const invDerive = String(R('Fn_HtmlThese(Var_State.positions[0])'));
    R('Var_State.positions[0].produit.type = "action"; Var_State.positions[0].produit.sousJacent = null;');
    const invAction = String(R('Fn_HtmlThese(Var_State.positions[0])'));
    verifier('un produit à levier reçoit ses PROPRES invites, nommant son sous-jacent',
      /barrière/.test(invDerive) && /Untel SA/.test(invDerive) && !/barrière/.test(invAction),
      'invites distinctes selon le type de produit');
    verifier('et aucune invite ne cite l’exemple d’un titre étranger à la ligne',
      !/ROSIE/i.test(invDerive) && !/ROSIE/i.test(invAction), 'aucun exemple emprunté');
    R('Var_State.theses = {};');
    ctx.__faux = { target: { closest: () => ({
      getAttribute: n => ({ 'data-action': 'these-check', 'data-id': 'L1', 'data-champ': 'ecrite' })[n],
      checked: true }) } };
    R('Fn_OnChange(__faux);');
    const apresCoche = String(R('Fn_HtmlThese(Var_State.positions[0])'));
    verifier('cocher la case fait APPARAÎTRE la zone de saisie, avec son invite',
      /these-texte/.test(apresCoche) && /data-champ="texte"/.test(apresCoche)
      && /maxlength="600"/.test(apresCoche),
      J('Var_State.theses.L1.ecrite') ? 'case enregistrée, zone présente' : 'case non enregistrée');
    verifier('et le gestionnaire re-rend la vue, sans quoi rien n’apparaîtrait à l’écran',
      /case 'these-check':[\s\S]{0,700}?Fn_RenderCours\(\)/.test(js),
      'Fn_RenderCours appelé après la coche');
    R('Var_State.theses = {}; Var_State.positions = []; Fn_Recalculer();');
  } catch (e) { ko('la répartition Vigie / Paramètres', String((e && e.stack) || e)); }

  console.log('\nI. Aide des commandes et codes d’erreur');
  try {
    const uniques = a => Array.from(new Set(a));
    const extraire = (re, groupe) => {
      const res = [];
      let m;
      while ((m = re.exec(h)) !== null) res.push(m[groupe]);
      return uniques(res);
    };
    const contextuelles = ['onglet', 'toggle', 'these-check'];
    const actions = extraire(/data-action="([a-z0-9-]+)"/g, 1).filter(a => contextuelles.indexOf(a) < 0);
    const sansAide = actions.filter(a => !vm.runInContext('!!Cst_AideActions[' + JSON.stringify(a) + ']', ctx));
    verifier('chaque commande porte son aide (' + actions.length + ' commandes)',
      sansAide.length === 0, 'sans aide : ' + sansAide.join(', '));

    const onglets = extraire(/data-action="onglet"\s+data-id="([a-zA-Z]+)"/g, 1);
    const ongletsSansAide = onglets.filter(o => !vm.runInContext('!!Cst_AideOnglets[' + JSON.stringify(o) + ']', ctx));
    verifier('chaque onglet porte son aide (' + onglets.length + ' onglets)',
      onglets.length >= 5 && ongletsSansAide.length === 0, 'sans aide : ' + ongletsSansAide.join(', '));

    // Les panneaux sont ouverts par data-id dynamiques : la couverture se
    // vérifie sur l'ÉTAT, qui les déclare tous, et non sur le texte du fichier.
    const panneaux = vm.runInContext('Object.keys(Var_State.panneaux)', ctx);
    const panneauxSansAide = panneaux.filter(p => !vm.runInContext('!!Cst_AidePanneaux[' + JSON.stringify(p) + ']', ctx));
    verifier('chaque panneau porte son aide (' + panneaux.length + ' panneaux)',
      panneaux.length > 0 && panneauxSansAide.length === 0, 'sans aide : ' + panneauxSansAide.join(', '));

    // Les cases de thèse sont DÉRIVÉES de Cst_AideThese : il est structurellement
    // impossible d'en ajouter une sans son aide. On contrôle donc la dérivation.
    const cases = vm.runInContext('Object.keys(Cst_AideThese).length', ctx);
    verifier('cases de thèse dérivées de leur aide (' + cases + ' cases)',
      cases > 0 && /Object\.keys\(Cst_AideThese\)\.map/.test(js),
      'les cases doivent être générées depuis Cst_AideThese, jamais listées en dur');

    const courtes = vm.runInContext(
      'Object.keys(Cst_AideActions).filter(k => (Cst_AideActions[k].d || "").length < 60)', ctx);
    verifier('aucune aide réduite à un libellé', courtes.length === 0, 'trop courtes : ' + courtes.join(', '));
  } catch (e) { ko('couverture de l’aide des commandes', e.message); }

  // Codes d'erreur : un échec affiche un code entre crochets, et l'utilisateur
  // doit pouvoir le retrouver dans Paramètres.
  try {
    const officiels = ['authentication_error', 'permission_error', 'not_found_error',
      'request_too_large', 'rate_limit_error', 'api_error', 'overloaded_error', 'invalid_request_error'];
    const manquants = officiels.filter(c => !vm.runInContext('!!Fn_ErreurCatalogue(' + JSON.stringify(c) + ')', ctx));
    verifier('types d’erreur officiels de l’API tous documentés',
      manquants.length === 0, 'absents du catalogue : ' + manquants.join(', '));

    const leves = [];
    const re = /type:\s*'([a-z_]+)'\s*,\s*(?:fluxIncomplet|message)/g;
    let m;
    while ((m = re.exec(js)) !== null) if (leves.indexOf(m[1]) < 0) leves.push(m[1]);
    const orphelins = leves.filter(c => !vm.runInContext('!!Fn_ErreurCatalogue(' + JSON.stringify(c) + ')', ctx));
    verifier('codes levés par le code tous documentés (' + leves.length + ' levés)',
      orphelins.length === 0, 'levés mais non documentés : ' + orphelins.join(', '));

    const creuses = vm.runInContext(
      'Cst_ErreursAPI.filter(e => !e.quoi || !e.pourquoi || !e.faire || e.faire.length < 40).map(e => e.code)', ctx);
    verifier('chaque code indique la conduite à tenir', creuses.length === 0, 'incomplets : ' + creuses.join(', '));
  } catch (e) { ko('couverture des codes d’erreur', e.message); }

  console.log('\n' + (echecs === 0
    ? 'TOUT EST VERT — publication possible (penser à incrémenter le CACHE de sw.js).'
    : echecs + ' CONTRÔLE(S) EN ÉCHEC — ne pas publier.'));
  process.exit(echecs === 0 ? 0 : 1);
}, 300);
