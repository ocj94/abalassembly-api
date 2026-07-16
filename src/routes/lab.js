import { requireAuth, hashIp } from '../auth.js';
import { db } from '../db.js';
import { createEngine } from '../engine.js';
import { sprtLLR, sprtBounds, SPRT_DEFAULTS } from '../sprt.js';

// Miroir du EVAL_W par défaut côté client (index.html, AI_WORKER_CODE).
const DEFAULT_WEIGHTS = { center: 6, cohesion: 4, edge: 8, mob: 2, iso: 18, dng: 14 };
const WEIGHT_KEYS = ['center', 'cohesion', 'edge', 'mob', 'iso', 'dng'];

// Un lot de résultats soumis d'un coup ne peut raisonnablement pas dépasser
// ce nombre de parties pour un client JS dans une session : au-delà, on
// rejette d'emblée sans même consulter la base — un garde-fou simple contre
// un lot fabriqué de toutes pièces annonçant des centaines de victoires.
const MAX_GAMES_PER_REPORT = 200;

const weightsSchema = {
  type: 'object',
  required: WEIGHT_KEYS,
  additionalProperties: false,
  properties: Object.fromEntries(WEIGHT_KEYS.map(k => [k, { type: 'number', minimum: -100, maximum: 100 }]))
};

const jobSchema = {
  body: {
    type: 'object',
    required: ['candidateWeights'],
    additionalProperties: false,
    properties: { candidateWeights: weightsSchema }
  }
};

const resultSchema = {
  body: {
    type: 'object',
    required: ['jobId', 'candidateWins', 'draws', 'baselineWins', 'sampleStart', 'sampleSeq', 'sampleWinner'],
    additionalProperties: false,
    properties: {
      jobId:         { type: 'integer', minimum: 1 },
      candidateWins: { type: 'integer', minimum: 0 },
      draws:         { type: 'integer', minimum: 0 },
      baselineWins:  { type: 'integer', minimum: 0 },
      sampleStart:      { type: 'string', minLength: 3, maxLength: 400 },
      sampleStartColor: { type: 'string', enum: ['black', 'white'] },
      sampleSeq:        { type: 'string', minLength: 1, maxLength: 8000 },
      sampleWinner:     { type: 'string', enum: ['candidate', 'baseline', 'draw'] }
    }
  }
};

// Rejoue la partie témoin avec le VRAI moteur (src/engine.js) pour confirmer
// qu'il s'agit d'une suite de coups légaux menant réellement au résultat
// annoncé. Ne rejoue pas la réflexion de l'IA (trop coûteux en masse) — mais
// une partie qui ne peut même pas être rejouée légalement est un signal de
// fraude ou de bug sans ambiguïté, et un résultat annoncé qui ne correspond
// pas à l'état final du plateau l'est tout autant.
function verifySampleGame({ sampleStart, sampleStartColor, sampleSeq, sampleWinner }) {
  try {
    const E = createEngine();
    const parts = String(sampleStart).split(',');
    if (parts.length !== 2) return { ok: false, note: 'format de position de départ invalide' };
    const board = {};
    parts.forEach((part, side) => {
      const cells = part.slice(1).match(/[a-i][1-9]/g) || [];
      const color = side === 0 ? 'black' : 'white';
      cells.forEach(cc => { const p = E.abaproToRc(cc); if (p) board[p.r + ',' + p.c] = color; });
    });
    if (Object.keys(board).length < 2) return { ok: false, note: 'position de départ vide ou illisible' };
    E.setBoard(board);

    let color = sampleStartColor || 'black';
    const tokens = String(sampleSeq).replace(/\d+\./g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return { ok: false, note: 'séquence de coups vide' };
    if (tokens.length > 600) return { ok: false, note: 'séquence de coups invraisemblablement longue' };

    for (const tok of tokens) {
      const mv = E.resolveAbaProToken(tok.toLowerCase(), color);
      if (!mv) return { ok: false, note: `coup illégal ou non résolu : "${tok}" (${color})` };
      E.applyMove(mv, color);
      color = color === 'black' ? 'white' : 'black';
    }

    const capturedBlack = E.capturedByBlack, capturedWhite = E.capturedByWhite;
    const blackWon = capturedBlack >= 6;   // Noirs gagnent en ayant capturé 6 pièces adverses
    const whiteWon = capturedWhite >= 6;
    if (!blackWon && !whiteWon) {
      // Autorisé : un lot peut représenter une partie encore en cours au
      // moment de l'échantillon plutôt qu'une partie achevée à 6 captures.
      return { ok: true, note: 'partie légale, non conclue (échantillon partiel accepté)' };
    }
    // Le camp "candidate" est par convention celui qui commence (sampleStartColor).
    const candidateColor = sampleStartColor || 'black';
    const candidateWon = (candidateColor === 'black' && blackWon) || (candidateColor === 'white' && whiteWon);
    const actualWinner = blackWon === whiteWon ? 'draw' : (candidateWon ? 'candidate' : 'baseline');
    if (actualWinner !== sampleWinner) {
      return { ok: false, note: `résultat annoncé (${sampleWinner}) incohérent avec la partie rejouée (${actualWinner})` };
    }
    return { ok: true, note: 'partie légale et résultat confirmé' };
  } catch (e) {
    return { ok: false, note: 'erreur de rejeu : ' + e.message };
  }
}

async function currentChampion() {
  const { rows } = await db.query(
    `SELECT candidate_weights FROM lab_jobs WHERE status = 'promoted' ORDER BY closed_at DESC LIMIT 1`);
  return rows[0] ? rows[0].candidate_weights : DEFAULT_WEIGHTS;
}

export default async function (app) {
  // Public : n'importe quel client (connecté ou non) peut lire le champion actuel.
  app.get('/champion', async () => {
    const { rows } = await db.query(
      `SELECT candidate_weights, closed_at,
              (SELECT COALESCE(SUM(candidate_wins+draws+baseline_wins),0) FROM lab_results WHERE job_id = lab_jobs.id AND verified = true) AS games
       FROM lab_jobs WHERE status = 'promoted' ORDER BY closed_at DESC LIMIT 1`);
    if (!rows[0]) return { weights: DEFAULT_WEIGHTS, promoted: false };
    return { weights: rows[0].candidate_weights, promoted: true, promotedAt: rows[0].closed_at, gamesConfirmed: Number(rows[0].games) };
  });

  // Un addHook('preHandler', ...) s'applique à TOUT le contexte d'encapsulation
  // du plugin, pas seulement "à partir de cette ligne" — le sous-contexte via
  // register() est la vraie façon d'isoler les routes protégées de /champion
  // (sinon /champion se retrouve protégée aussi, silencieusement).
  app.register(async function (protectedRoutes) {
    protectedRoutes.addHook('preHandler', requireAuth);

    // Récupère le job ouvert actuel (à quoi contribuer), ou null s'il n'y en a pas.
    protectedRoutes.get('/job', async () => {
      const { rows } = await db.query(
        `SELECT id, baseline_weights, candidate_weights, created_at,
                (SELECT COALESCE(SUM(candidate_wins),0) FROM lab_results WHERE job_id = lab_jobs.id AND verified = true) AS cw,
                (SELECT COALESCE(SUM(draws),0) FROM lab_results WHERE job_id = lab_jobs.id AND verified = true) AS d,
                (SELECT COALESCE(SUM(baseline_wins),0) FROM lab_results WHERE job_id = lab_jobs.id AND verified = true) AS bw
         FROM lab_jobs WHERE status = 'open' ORDER BY created_at ASC LIMIT 1`);
      if (!rows[0]) return { job: null };
      const r = rows[0];
      return { job: { id: r.id, baselineWeights: r.baseline_weights, candidateWeights: r.candidate_weights,
        createdAt: r.created_at, pooled: { candidateWins: Number(r.cw), draws: Number(r.d), baselineWins: Number(r.bw) } } };
    });

    // Propose un nouveau candidat — seulement s'il n'y a pas déjà un job ouvert
    // (un seul test collectif à la fois : évite de fragmenter l'effort de tous
    // les Labos connectés sur des dizaines de candidats jamais confirmés).
    protectedRoutes.post('/job', { schema: jobSchema }, async (req, reply) => {
      const { rows: openRows } = await db.query(`SELECT id FROM lab_jobs WHERE status = 'open' LIMIT 1`);
      if (openRows[0]) return reply.code(409).send({ error: 'un job est déjà ouvert', jobId: openRows[0].id });
      const baseline = await currentChampion();
      const { rows } = await db.query(
        `INSERT INTO lab_jobs (baseline_weights, candidate_weights, created_by) VALUES ($1,$2,$3) RETURNING id, created_at`,
        [JSON.stringify(baseline), JSON.stringify(req.body.candidateWeights), req.user.sub]);
      reply.code(201);
      return { ok: true, job: { id: rows[0].id, baselineWeights: baseline, candidateWeights: req.body.candidateWeights, createdAt: rows[0].created_at } };
    });

    // Soumet un lot de résultats pour le job en cours. Vérifie la partie
    // témoin par rejeu avant de compter quoi que ce soit dans l'agrégat SPRT.
    protectedRoutes.post('/result', { schema: resultSchema }, async (req, reply) => {
      const b = req.body;
      const total = b.candidateWins + b.draws + b.baselineWins;
      if (total < 1) return reply.code(400).send({ error: 'lot vide' });
      if (total > MAX_GAMES_PER_REPORT) return reply.code(400).send({ error: 'lot invraisemblablement volumineux (max ' + MAX_GAMES_PER_REPORT + ')' });

      const { rows: jobRows } = await db.query(`SELECT id, status FROM lab_jobs WHERE id = $1`, [b.jobId]);
      const job = jobRows[0];
      if (!job) return reply.code(404).send({ error: 'job introuvable' });
      if (job.status !== 'open') return reply.code(409).send({ error: 'ce job est déjà clos (' + job.status + ')' });

      const verdict = verifySampleGame({
        sampleStart: b.sampleStart, sampleStartColor: b.sampleStartColor || 'black',
        sampleSeq: b.sampleSeq, sampleWinner: b.sampleWinner
      });

      const ipHash = hashIp(req.ip);
      await db.query(
        `INSERT INTO lab_results (job_id, user_id, candidate_wins, draws, baseline_wins,
          sample_start, sample_start_color, sample_seq, sample_winner, verified, verify_note, ip_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [b.jobId, req.user.sub, b.candidateWins, b.draws, b.baselineWins,
         b.sampleStart, b.sampleStartColor || 'black', b.sampleSeq, b.sampleWinner,
         verdict.ok, verdict.note, ipHash]);

      if (!verdict.ok) {
        return { ok: true, counted: false, reason: verdict.note };
      }

      const { rows: pooledRows } = await db.query(
        `SELECT COALESCE(SUM(candidate_wins),0) AS w, COALESCE(SUM(draws),0) AS d, COALESCE(SUM(baseline_wins),0) AS l
         FROM lab_results WHERE job_id = $1 AND verified = true`, [b.jobId]);
      const W = Number(pooledRows[0].w), D = Number(pooledRows[0].d), L = Number(pooledRows[0].l);
      const llr = sprtLLR(W, D, L);
      const { up, lo } = sprtBounds();

      let outcome = 'open';
      if (llr >= up) { outcome = 'promoted'; await db.query(`UPDATE lab_jobs SET status='promoted', closed_at=now() WHERE id=$1`, [b.jobId]); }
      else if (llr <= lo) { outcome = 'rejected'; await db.query(`UPDATE lab_jobs SET status='rejected', closed_at=now() WHERE id=$1`, [b.jobId]); }

      return { ok: true, counted: true, pooled: { candidateWins: W, draws: D, baselineWins: L }, llr, outcome };
    });
  });
}
