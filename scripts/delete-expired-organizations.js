require('dotenv').config({quiet: true});
const {createDatabase} = require('../lib/db');
const {runDeletion, formatReport} = require('../lib/organization-deletion');

// Simulation par défaut. Aucune planification n'est installée ici.
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--execute')) {
    console.error('Usage : node scripts/delete-expired-organizations.js [--execute]');
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL requis.');
    process.exitCode = 1;
    return;
  }
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    await db.verify();
    const report = await runDeletion(db, {execute: args[0] === '--execute', secret: process.env.BETTER_AUTH_SECRET});
    process.stdout.write(formatReport(report));
    if (report.results.some(result => result.outcome === 'echec')) process.exitCode = 1;
  } catch (error) {
    const message = typeof error.message === 'string' && !/postgres|token|secret|password|:\/\//i.test(error.message) ? error.message : (error.code || 'erreur');
    console.error(message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

if (require.main === module) main();
module.exports = {main};
