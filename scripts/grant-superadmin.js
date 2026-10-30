require('dotenv').config({quiet: true});
const {createDatabase} = require('../lib/db');
const {email} = require('../lib/validation');

async function main() {
  const address = email(process.argv[2]);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL requis.');
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    await db.verify();
    const {rows} = await db.pool.query('SELECT id FROM users WHERE email = $1', [address]);
    if (!rows.length) throw new Error('Aucun compte avec cette adresse.');
    const inserted = await db.pool.query('INSERT INTO platform_admins(user_id) VALUES($1) ON CONFLICT DO NOTHING', [rows[0].id]);
    console.log(inserted.rowCount ? 'Superadmin enregistré : ' + rows[0].id : 'Déjà superadmin : ' + rows[0].id);
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
