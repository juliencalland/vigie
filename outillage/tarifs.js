#!/usr/bin/env node
'use strict';
/**
 * RELEVÉ DES TARIFS CLAUDE — sur la page officielle d'Anthropic.
 *
 * Exécuté chaque semaine par .github/workflows/tarifs.yml, qui publie le résultat
 * en tarifs.json sur la branche « tarifs » ; Vigie le lit depuis
 * raw.githubusercontent.com (lecture ouverte à toute page, donc sans relais).
 * L'API Models donne les modèles accessibles et leurs capacités, PAS leurs prix :
 * seule cette page les publie.
 *
 * Usage : node outillage/tarifs.js                → relève la page, écrit le JSON sur la sortie
 *         node outillage/tarifs.js --fichier p.md → lit une copie locale de la page (essai)
 *
 * Échoue (code 1) plutôt que de publier un relevé douteux : Vigie garde alors le
 * précédent, ou à défaut la table intégrée.
 */
const URL_TARIFS = 'https://platform.claude.com/docs/en/about-claude/pricing.md';

function prix(cellule) {
  const m = /\$\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*MTok/i.exec(String(cellule || ''));
  return m ? Number(m[1]) : null;
}

function analyser(md) {
  const debut = md.indexOf('## Model pricing');
  if (debut < 0) throw new Error('section « Model pricing » introuvable');
  const fin = md.indexOf('\n## ', debut + 5);
  const section = md.slice(debut, fin > 0 ? fin : undefined).split('\n');
  const tete = section.find(l => /^\|\s*Model\s*\|/i.test(l));
  if (!tete) throw new Error('en-tête du tableau introuvable');
  // Les colonnes se repèrent par leur intitulé, jamais par leur rang.
  const cols = tete.split('|').slice(1, -1).map(c => c.trim().toLowerCase());
  const col = re => cols.findIndex(c => re.test(c));
  const iE = col(/^base input/), iW5 = col(/5m cache write/), iW1 = col(/1h cache write/), iR = col(/cache hits/), iS = col(/^output/);
  if ([iE, iW1, iR, iS].some(i => i < 0)) throw new Error('colonnes inattendues : ' + cols.join(' | '));
  const modeles = {};
  section.filter(l => /^\|\s*Claude /.test(l)).forEach(l => {
    const c = l.split('|').slice(1, -1).map(x => x.trim());
    const brut = c[0];
    let nom = brut.replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '').replace(/<[^>]+>/g, '').trim();
    // Un modèle à deux paliers (« for prompts up to / over 100,000 tokens ») : le palier
    // bas est retenu, c'est celui d'un appel ordinaire ; le palier haut est noté.
    const mp = /\((for prompts [^)]*)\)/i.exec(nom);
    let palier = null;
    if (mp) { palier = mp[1]; nom = nom.replace(mp[0], '').trim(); }
    const x = { entree: prix(c[iE]), sortie: prix(c[iS]), cacheLecture: prix(c[iR]),
      cacheEcriture1h: prix(c[iW1]), cacheEcriture5m: iW5 >= 0 ? prix(c[iW5]) : null };
    if (/retired/i.test(brut)) x.retire = true;
    if (/limited availability|limited access/i.test(brut)) x.restreint = true;
    if (palier && /over/i.test(palier)) {
      if (modeles[nom]) modeles[nom].auDelaDuPalier = { entree: x.entree, sortie: x.sortie };
      return;
    }
    if (palier) x.palier = palier;
    modeles[nom] = x;
  });
  const mr = /\$\s*([0-9]+(?:\.[0-9]+)?)\s*per\s*1,000\s*searches/i.exec(md);
  return { modeles, recherchePour1000: mr ? Number(mr[1]) : null };
}

function valider(r) {
  const noms = Object.keys(r.modeles);
  if (noms.length < 5) throw new Error('trop peu de modèles lus : ' + noms.length);
  if (!noms.some(n => /Opus/.test(n)) || !noms.some(n => /Sonnet/.test(n))) throw new Error('ni Opus ni Sonnet dans le relevé');
  noms.forEach(n => {
    const x = r.modeles[n];
    if (!(x.entree > 0) || !(x.sortie > x.entree)) throw new Error(n + ' : entrée ' + x.entree + ' / sortie ' + x.sortie + ' incohérentes');
    if (x.cacheLecture != null && !(x.cacheLecture < x.entree)) throw new Error(n + ' : relecture du cache ' + x.cacheLecture + ' ≥ entrée');
    if (x.cacheEcriture1h != null && !(x.cacheEcriture1h > x.entree)) throw new Error(n + ' : écriture du cache ' + x.cacheEcriture1h + ' ≤ entrée');
  });
  if (!(r.recherchePour1000 > 0)) throw new Error('prix de la recherche web introuvable');
  return r;
}

async function main() {
  const i = process.argv.indexOf('--fichier');
  const md = i > 0 ? require('fs').readFileSync(process.argv[i + 1], 'utf8') : await (async () => {
    const r = await fetch(URL_TARIFS);
    if (!r.ok) throw new Error('page Tarifs : HTTP ' + r.status);
    return r.text();
  })();
  const r = valider(analyser(md));
  const sortie = { v: 1, source: URL_TARIFS, verifie: new Date().toISOString(),
    recherchePour1000: r.recherchePour1000, modeles: r.modeles };
  process.stdout.write(JSON.stringify(sortie, null, 1) + '\n');
}

if (require.main === module) main().catch(e => { console.error('Relevé refusé : ' + e.message); process.exit(1); });
module.exports = { analyser, valider };
