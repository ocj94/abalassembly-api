import { requireAuth } from '../auth.js';
import { db } from '../db.js';
import { redis } from '../redis.js';

/* XP d'un résultat de tournoi : fixée par le serveur (mêmes valeurs que le jeu,
   _tourneyAward). Avant, le client annonçait lui-même xpAwarded (jusqu'à 100 000)
   pour n'importe quel tournoi, passé ou à venir. Le champ xpAwarded envoyé est
   retiré par la validation et sans effet. */
export const TOURNOI_XP = { champion: 1000, finaliste: 500, participant: 100 };

// Le tournoi est mensuel ('AAAA-MM', comme currentTournamentId() côté jeu) : seul
// celui du mois en cours s'enregistre, à un jour près (fuseaux horaires).
export function tournoiDuMois(t = Date.now()) {
  const d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}
export function tournoisOuverts(now = Date.now()) {
  return [...new Set([tournoiDuMois(now - 86400000), tournoiDuMois(now), tournoiDuMois(now + 86400000)])];
}

export default async function (app) {
  // Soumettre un résultat de tournoi (protégé). Le résultat reste déclaratif (le
  // tournoi se joue contre l'IA, sur l'appareil) : c'est le palmarès personnel du
  // joueur, il ne doit alimenter aucun classement partagé.
  app.post('/result', {
    preHandler: requireAuth,
    schema: {
      body: {
        type: 'object',
        required: ['tournamentId', 'result'],
        additionalProperties: false,
        properties: {
          tournamentId: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}$' },
          stage:        { type: 'integer', minimum: 0, maximum: 10 },
          result:       { type: 'string', enum: ['champion', 'finaliste', 'participant'] }
        }
      }
    }
  }, async (req, reply) => {
    const { tournamentId, stage = 0, result } = req.body;
    if (!tournoisOuverts().includes(tournamentId)) {
      return reply.code(400).send({ error: 'tournoi clos ou pas encore ouvert : seul celui du mois en cours s\'enregistre' });
    }
    const xpAwarded = TOURNOI_XP[result];
    await db.query(
      `INSERT INTO tournament_entries (user_id, tournament_id, stage, result, xp_awarded)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, tournament_id) DO UPDATE
       SET stage = EXCLUDED.stage, result = EXCLUDED.result, xp_awarded = EXCLUDED.xp_awarded`,
      [req.user.sub, tournamentId, stage, result, xpAwarded]
    );
    return { ok: true, xpAwarded };
  });

  // Leaderboard mondial (lecture publique, servi depuis Redis pour la rapidité)
  app.get('/leaderboard', async () => {
    // ZREVRANGE : top 100 par elo. Alimenté à chaque mise à jour de progression.
    let top = [];
    try {
      const raw = await redis.zrevrange('leaderboard:elo', 0, 99, 'WITHSCORES');
      for (let i = 0; i < raw.length; i += 2) top.push({ user: raw[i], elo: Number(raw[i + 1]) });
    } catch (e) { /* si Redis indisponible, on renvoie une liste vide plutôt qu'une erreur */ }
    return { top };
  });
}
