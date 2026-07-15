import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';

// Applique tous les .sql du dossier, par ordre alphabétique.
const here = dirname(fileURLToPath(import.meta.url));

async function run() {
  const files = readdirSync(here).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(here, f), 'utf8');
    console.log('[migrate] ' + f);
    await db.query(sql);
  }
  console.log('[migrate] terminé');
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
