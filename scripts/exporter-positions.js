// La base de positions d'une campagne, pour entraîner un réseau de neurones (v3.24).
//
//   node --env-file=.env scripts/exporter-positions.js <campagne> [--csv] [--sans-ouverture] > positions.ndjson
//   docker compose exec -T api node scripts/exporter-positions.js 12 > positions.ndjson
//
// Chaque partie acceptée (donc vérifiée) de la campagne est rejouée dans le moteur
// (src/moteurIA.js, positionsDePartie) ; chaque position devient une ligne :
//
//   {"c":12,"m":345,"p":7,"trait":"b","plateau":"wwwww…","pb":0,"pw":1,"eval":-35,"resultat":1,"fin":"6capt","ouv":false}
//
//   c, m, p     campagne, mission, numéro du demi-coup (0 : position de départ)
//   trait       camp qui doit jouer : b (Noirs) ou w (Blancs)
//   plateau     61 cases dans l'ordre du moteur, ligne par ligne (5,6,7,8,9,8,7,6,5) : b, w ou .
//   pb, pw      billes blanches sorties par les Noirs, billes noires sorties par les Blancs
//   eval        le juge actuel (evaluateBoard, poids A de la campagne), vu du camp au trait
//   resultat    fin de la partie vue du camp au trait : 1 gagnée, 0 nulle, -1 perdue
//   fin         comment elle s'est finie (6capt, adj3, adjCap, adjEval, draw…)
//   ouv         position de l'ouverture tirée au hasard (--sans-ouverture les retire)
//
// --csv écrit les mêmes colonnes en CSV. Le résumé (parties, positions) va sur la sortie d'erreur.
import { db } from '../src/db.js';
import { creerFil, positionsDePartie, moteurConnu } from '../src/moteurIA.js';

const COLONNES = ['c', 'm', 'p', 'trait', 'plateau', 'pb', 'pw', 'eval', 'resultat', 'fin', 'ouv'];
const ecrire = (s) => new Promise((res) => { if (process.stdout.write(s)) res(); else process.stdout.once('drain', res); });

export async function exporter(id, sortie, options) {
  const o = options || {};
  const { rows: cs } = await db.query(`SELECT id, moteur, poids_a, reglages FROM ordo_campagnes WHERE id = $1`, [id]);
  if (!cs[0]) throw new Error('campagne inconnue : ' + id);
  const c = cs[0];
  if (!moteurConnu(c.moteur)) throw new Error('le moteur de cette campagne n\'est plus sur ce serveur : ' + c.moteur);
  const fil = creerFil(c.moteur), nOuv = c.reglages.ouverture || 0;
  let dernier = 0, parties = 0, positions = 0, ecartees = 0;
  if (o.csv) await sortie(COLONNES.join(',') + '\n');
  for (;;) {
    // par lots de 200 parties, dans l'ordre des missions : la mémoire reste petite, même pour 10 000 parties
    const { rows } = await db.query(
      `SELECT id, couleur_a, vainqueur, pourquoi, coups FROM ordo_missions
        WHERE campagne_id = $1 AND etat = 'faite' AND id > $2 ORDER BY id LIMIT 200`, [id, dernier]);
    if (!rows.length) break;
    for (const m of rows) {
      dernier = m.id;
      const gagnant = m.vainqueur === 'A' ? m.couleur_a : m.vainqueur === 'B' ? (m.couleur_a === 'black' ? 'white' : 'black') : null;
      let lignes;
      try { lignes = positionsDePartie(fil, { poidsA: c.poids_a }, m.coups || []); }
      catch (e) { ecartees++; continue; }      // ne devrait pas arriver : la partie a été vérifiée
      parties++;
      let bloc = '';
      for (const x of lignes) {
        const ouv = x.p < nOuv;
        if (o.sansOuverture && ouv) continue;
        const camp = x.trait === 'b' ? 'black' : 'white';
        const l = { c: Number(id), m: Number(m.id), p: x.p, trait: x.trait, plateau: x.plateau, pb: x.pb, pw: x.pw, eval: x.eval,
          resultat: gagnant === null ? 0 : gagnant === camp ? 1 : -1, fin: m.pourquoi, ouv };
        bloc += (o.csv ? COLONNES.map((k) => l[k]).join(',') : JSON.stringify(l)) + '\n';
        positions++;
      }
      await sortie(bloc);
    }
  }
  return { parties, positions, ecartees };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const campagne = Number(args.find((x) => /^\d+$/.test(x)));
  const CSV = args.includes('--csv'), SANS_OUV = args.includes('--sans-ouverture');
  if (!campagne) {
    console.error('usage : node --env-file=.env scripts/exporter-positions.js <campagne> [--csv] [--sans-ouverture] > positions.ndjson');
    process.exit(2);
  }
  exporter(campagne, ecrire, { csv: CSV, sansOuverture: SANS_OUV })
    .then((r) => { console.error(`campagne ${campagne} : ${r.parties} parties, ${r.positions} positions` + (r.ecartees ? `, ${r.ecartees} écartées` : '')); return db.end(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
