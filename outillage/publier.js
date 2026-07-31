'use strict';
/*
 * Publication de Vigie sur GitHub Pages.
 * Usage : node outillage/publier.js "Message de commit"
 *
 * Enchaîne : vérifications (outillage/verifier.js) → incrément du cache du
 * service worker → commit → push. S'arrête au premier échec : rien n'est
 * poussé si un contrôle échoue.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const message = process.argv[2];
if (!message) { console.error('Message de commit manquant.\nUsage : node outillage/publier.js "Message de commit"'); process.exit(1); }

function git(args, silencieux) {
  const r = spawnSync('git', ['-C', RACINE].concat(args), { encoding: 'utf8' });
  if (r.status !== 0 && !silencieux) { console.error((r.stderr || r.stdout || '').trim()); process.exit(1); }
  return (r.stdout || '').trim();
}

/* 1 — vérifications (le script sort en 1 si un contrôle échoue) */
console.log('1/4 Vérifications…');
try {
  execFileSync(process.execPath, [path.join(__dirname, 'verifier.js')], { stdio: 'inherit' });
} catch (e) {
  console.error('\nPublication ANNULÉE : des contrôles ont échoué.');
  process.exit(1);
}

/* 2 — estampille de version : sw.js ET index.html reçoivent LE MÊME horodatage.
   Le cache du service worker seul ne suffisait pas : un onglet resté ouvert ne
   navigue pas, donc ne repasse jamais par le réseau, et continue d'exécuter
   l'ancien code sans que rien ne le signale. Cas vécu : trois publications
   d'affilée, aucune reprise par l'onglet, et des MAJ à 2 $ lancées sur du code
   périmé pendant deux heures. La page compare désormais sa propre estampille à
   celle de sw.js (relu par le réseau) et le dit à l'écran. */
console.log('\n2/4 Estampille de version (sw.js + index.html)…');
const cheminSw = path.join(RACINE, 'sw.js');
const sw = fs.readFileSync(cheminSw, 'utf8');
const horodatage = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
const version = 'vigie-' + horodatage;
if (!/const CACHE\s*=\s*'[^']+'/.test(sw)) { console.error('Constante CACHE introuvable dans sw.js'); process.exit(1); }
fs.writeFileSync(cheminSw, sw.replace(/const CACHE\s*=\s*'[^']+'/, "const CACHE = '" + version + "'"));
const cheminHtml = path.join(RACINE, 'index.html');
const html = fs.readFileSync(cheminHtml, 'utf8');
if (!/const Cst_Version\s*=\s*'[^']*'/.test(html)) { console.error('Constante Cst_Version introuvable dans index.html'); process.exit(1); }
fs.writeFileSync(cheminHtml, html.replace(/const Cst_Version\s*=\s*'[^']*'/, "const Cst_Version = '" + version + "'"));
console.log('  version = ' + version + '  (sw.js et index.html)');

/* 3 — commit */
console.log('\n3/4 Commit…');
if (!git(['status', '--porcelain'])) { console.log('  Rien à committer.'); process.exit(0); }
git(['add', '-A']);
git(['commit', '-m', message]);
console.log('  ' + git(['log', '--oneline', '-1']));

/* 4 — push */
console.log('\n4/4 Envoi vers GitHub…');
git(['push']);
console.log('\nPUBLIÉ : https://juliencalland.github.io/vigie/');
console.log('Sur chaque appareil : recharger la page (le service worker se met à jour tout seul,');
console.log('parfois au deuxième chargement).');
