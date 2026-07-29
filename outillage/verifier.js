'use strict';
/*
 * Vérification AVANT COMMIT de la version publiée (index.html).
 * Usage : node outillage/verifier.js [chemin/index.html]
 *
 * Depuis la v7, index.html N'EST PLUS généré par build_pwa.js : il est édité
 * directement (le module de synchronisation y est déjà injecté, les ancres du
 * build ont disparu). Ce script remplace donc les garde-fous que le build
 * assurait : terminaison de script façon navigateur, confidentialité du dépôt
 * PUBLIC, règles du CLAUDE.md, et test de fumée en DOM simulé.
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
// balises (regex d'import, textes d'aide) et fausseraient les contrôles HTML.
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
verifier('Cst_SeedEtat sans positions',
  !!seedEtat && /positions:\s*\[\s*\]/.test(seedEtat[1]) && /orders:\s*\[\s*\]/.test(seedEtat[1]),
  'le seed contient des positions ou des ordres');
verifier('Cst_SeedEvents vide',
  /const Cst_SeedEvents\s*=\s*\[\s*\];/.test(js),
  'le seed contient des événements');

const emails = (h.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []);
verifier('aucune adresse e-mail', emails.length === 0, emails.join(', '));

// FR0000120271 (Total) est l'exemple pédagogique du glossaire : seul ISIN toléré.
const ISIN_TOLERES = ['FR0000120271'];
const isins = (h.match(/\b[A-Z]{2}[A-Z0-9]{9}\d\b/g) || []).filter(i => ISIN_TOLERES.indexOf(i) < 0);
verifier('aucun ISIN réel (hors exemple du glossaire)', isins.length === 0, isins.join(', '));

const secrets = (h.match(/sk-ant-[A-Za-z0-9_-]{10,}|github_pat_[A-Za-z0-9_]{10,}|ghp_[A-Za-z0-9]{20,}/g) || []);
verifier('aucune clé API ni jeton en dur', secrets.length === 0, secrets.length + ' secret(s) détecté(s)');

// Un code saisi de travers ne se voit pas : la casse automatique du clavier
// mobile suffit à rendre une clé invalide, et l'erreur n'apparaît qu'au premier
// appel. Chaque champ masqué doit donc neutraliser casse et correction, et
// s'afficher en chasse fixe.
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
   C — Règles du CLAUDE.md
   ---------------------------------------------------------------- */
console.log('\nC. Règles du projet');

verifier('aucun window.confirm / alert', !/\b(window\.)?(confirm|alert)\s*\(/.test(js),
  'bloqués en artefact : utiliser le double-tap temporisé');
verifier('aucun eval / new Function', !/\beval\s*\(|new\s+Function\s*\(/.test(js));
verifier('aucun onclick inline', !/\son(click|change|input)\s*=/i.test(h), 'utiliser la délégation data-action');

const externes = (h.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [])
  .filter(u => !/api\.anthropic\.com|api\.github\.com/.test(u));
verifier('aucune ressource externe', externes.length === 0, externes.join(' | '));

const maxTokens = js.match(/Cst_MaxTokens\s*=\s*(\d+)/);
verifier('Cst_MaxTokens = 128000 (plafond claude-opus-5)',
  !!maxTokens && maxTokens[1] === '128000', maxTokens ? 'vaut ' + maxTokens[1] : 'constante absente');

const modele = js.match(/const Cst_ModeleMAJ\s*=\s*['"]([^'"]+)['"]/);
console.log('  INFO modèle appelé : ' + (modele ? modele[1] : 'introuvable'));

verifier('une seule déclaration de Cst_SyncDepot',
  (js.match(/const Cst_SyncDepot\s*=/g) || []).length === 1,
  'redéclaration = ReferenceError au chargement');

verifier('Fn_BuildPromptMAJ présent', /function Fn_BuildPromptMAJ\s*\(/.test(js));

// La mécanique d'appel au modèle est transparente pour l'utilisateur : le mot
// « prompt » ne doit apparaître nulle part à l'écran. Toléré dans les
// commentaires, dans l'identifiant Fn_BuildPromptMAJ, et dans le texte envoyé
// AU modèle (le corps de cette fonction).
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
// Le fichier ne doit embarquer QUE le prompt de MAJ. Marqueurs propres au
// prompt maître (les simples mentions « prompt maître » en clair sont légitimes).
const MARQUEURS_MAITRE = ['ARCHITECTURE À DEUX PROMPTS', 'PROMPT MAÎTRE —', 'PROMPT_MAITRE'];
const fuiteMaitre = MARQUEURS_MAITRE.filter(m => h.indexOf(m) >= 0);
verifier('prompt maître non embarqué', fuiteMaitre.length === 0,
  'marqueur trouvé : ' + fuiteMaitre.join(', '));

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

// Discrétion : le dépôt est public par nécessité (GitHub Pages ne sert pas de
// site depuis un dépôt privé sur un compte gratuit), l'application ne doit pas
// pour autant s'annoncer. Pas de page d'explication, pas d'indexation.
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
  window: { innerWidth: 400, innerHeight: 800, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) },
  document: {
    getElementById(id) { return els[id] || (els[id] = faireEl(id)); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, createElement: t => faireEl(t),
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
  FileReader: function () { this.readAsText = function () {}; },
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

setTimeout(() => {
  const rendus = ['Fn_RenderEntete', 'Fn_RenderVigie', 'Fn_RenderOpportunites', 'Fn_RenderCours',
    'Fn_RenderDiscipline', 'Fn_RenderParametres', 'Fn_RenderCalendrier', 'Fn_RenderAValider'];
  rendus.forEach(f => {
    try {
      const existe = vm.runInContext('typeof ' + f + " === 'function'", ctx);
      if (!existe) { ko(f + ' (idempotence)', 'fonction absente'); return; }
      vm.runInContext(f + '(); ' + f + '();', ctx); // deux fois : les rendus sont idempotents
      ok(f + ' (appelée deux fois)');
    } catch (e) { ko(f, e.message); }
  });

  try {
    // Même forme d'argument que l'appel réel (coursSeuls, instruments, aucuneTransac, docNoms).
    const n = vm.runInContext(
      "Fn_BuildPromptMAJ({ coursSeuls: false, instruments: [], aucuneTransac: false, docNoms: {} }).length", ctx);
    verifier('Fn_BuildPromptMAJ produit un prompt', n > 3000, 'longueur ' + n + ' caractères (trop court : prompt appauvri ?)');
    console.log('  INFO prompt de MAJ : ' + n + ' caractères');
  } catch (e) { ko('Fn_BuildPromptMAJ', e.message); }

  // Aide des commandes : une commande dont on ignore la conséquence ne se clique
  // pas. Toute data-action doit donc être expliquée — y compris les contextuelles,
  // vérifiées sur chacune de leurs valeurs réellement présentes dans la page.
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

    const panneaux = extraire(/data-action="toggle"\s+data-id="([a-zA-Z]+)"/g, 1);
    const panneauxSansAide = panneaux.filter(p => !vm.runInContext('!!Cst_AidePanneaux[' + JSON.stringify(p) + ']', ctx));
    verifier('chaque panneau porte son aide (' + panneaux.length + ' panneaux)',
      panneaux.length > 0 && panneauxSansAide.length === 0, 'sans aide : ' + panneauxSansAide.join(', '));

    const champs = extraire(/data-champ="([a-zA-Z]+)"/g, 1);
    const champsSansAide = champs.filter(c => !vm.runInContext('!!Cst_AideThese[' + JSON.stringify(c) + ']', ctx));
    verifier('chaque case de thèse porte son aide (' + champs.length + ' cases)',
      champs.length > 0 && champsSansAide.length === 0, 'sans aide : ' + champsSansAide.join(', '));

    // L'aide doit dire ce que ça implique, pas seulement nommer le bouton.
    const courtes = vm.runInContext(
      'Object.keys(Cst_AideActions).filter(k => (Cst_AideActions[k].d || "").length < 60)', ctx);
    verifier('aucune aide réduite à un libellé', courtes.length === 0, 'trop courtes : ' + courtes.join(', '));
  } catch (e) { ko('couverture de l’aide des commandes', e.message); }

  console.log('\n' + (echecs === 0
    ? 'TOUT EST VERT — publication possible (penser à incrémenter le CACHE de sw.js).'
    : echecs + ' CONTRÔLE(S) EN ÉCHEC — ne pas publier.'));
  process.exit(echecs === 0 ? 0 : 1);
}, 300);
