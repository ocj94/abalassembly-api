import pg from 'pg';

// Pool de connexions PostgreSQL.
// SSL en production : si l'hébergeur fournit son certificat CA (DATABASE_CA,
// contenu PEM), la vérification est STRICTE — c'est la config recommandée.
// Sans CA fourni, on chiffre sans vérifier le certificat (rejectUnauthorized:false),
// ce qui protège du sniffing mais pas d'un MITM actif : à n'utiliser que si
// l'hébergeur ne publie pas de CA. Scaleway et Clever Cloud en fournissent un.
function sslConfig() {
  if (process.env.NODE_ENV !== 'production') return false;
  if (process.env.DATABASE_CA) return { ca: process.env.DATABASE_CA, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslConfig(),
  max: 20,                       // connexions simultanées
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

db.on('error', (err) => {
  console.error('[db] erreur pool inattendue', err);
});

// Petit helper pour les requêtes ponctuelles
export function query(text, params) {
  return db.query(text, params);
}
