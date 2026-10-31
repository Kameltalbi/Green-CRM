require('dotenv').config({quiet: true});
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {Pool} = require('pg');
const {spawnSync} = require('node:child_process');
const {createDatabase} = require('../../lib/db');
const {createApp} = require('../../server');
const {encrypt} = require('../../lib/gmail-crypto');
const {fixtureSession} = require('../session-fixture.cjs');
const {listEligible, deleteExpiredOrganization, runDeletion, formatReport, purgeExternalFiles, CHILD_TABLES, ELIGIBLE_SQL} = require('../../lib/organization-deletion');

const secretToken = 'token-google-NE-PAS-JOURNALISER';
const hiddenName = 'SECRET-NE-PAS-IMPRIMER';
let admin, db, server, base, rootPool, testDb, runtimeUrl;
let orgActive, orgFuture, orgCancelled, orgDue, orgKeep, orgBlocked, orgScript, orgLater;
let userDual, userSolo, userKeep, userBlocked, userScript, userLater, secretDue;
const revoked = [];

async function addUser(sub, address, name) {
  const id = (await admin.query('INSERT INTO users(google_sub, email, name, email_verified) VALUES($1,$2,$3,true) RETURNING id', [sub, address, name])).rows[0].id;
  await admin.query("INSERT INTO auth_accounts(user_id, account_id, provider_id, password) VALUES($1,$2,'credential',$3)", [id, sub, 'hash-' + sub]);
  return id;
}
async function closure(org, user, kind) {
  const offset = kind === 'due' ? "interval '31 days'" : kind === 'later' ? "interval '40 days'" : kind === 'future' ? "interval '0'" : "interval '10 days'";
  const status = kind === 'cancelled' ? 'active' : 'pending_deletion';
  const cancelled = kind === 'cancelled'
    ? "closure_cancelled_by = $2, closure_cancelled_at = stamp.t + interval '1 day'"
    : 'closure_cancelled_by = NULL, closure_cancelled_at = NULL';
  await admin.query(`UPDATE organizations AS org SET closure_status = '${status}', closure_requested_by = $2, closure_requested_at = stamp.t, closure_scheduled_at = stamp.t + interval '30 days', ${cancelled} FROM (SELECT clock_timestamp() - ${offset} AS t) AS stamp WHERE org.id = $1`, [org, user]);
}
async function counts(org) {
  const {rows} = await admin.query("SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organization_id' ORDER BY table_name");
  const result = {};
  for (const row of rows) result[row.table_name] = (await admin.query(`SELECT count(*)::int AS n FROM ${row.table_name} WHERE organization_id = $1`, [org])).rows[0].n;
  return result;
}

before(async () => {
  assert.ok(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
  const rootUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  rootPool = new Pool({connectionString: rootUrl.toString()});
  testDb = 'ciblix_test_' + crypto.randomBytes(6).toString('hex');
  await rootPool.query('CREATE DATABASE ' + testDb);
  rootUrl.pathname = '/' + testDb;
  const migration = rootUrl.toString();
  const migrated = spawnSync(process.execPath, ['scripts/migrate.js'], {env: {...process.env, MIGRATION_DATABASE_URL: migration}, encoding: 'utf8'});
  assert.equal(migrated.status, 0, migrated.stderr);
  admin = new Pool({connectionString: migration});
  const appUrl = new URL(process.env.DATABASE_URL);
  appUrl.pathname = '/' + testDb;
  runtimeUrl = appUrl.toString();
  db = createDatabase(runtimeUrl);
  await db.verify();
  const created = async name => (await admin.query('INSERT INTO organizations(name) VALUES($1) RETURNING id', [name])).rows[0].id;
  orgActive = await created('Organisation active');
  orgFuture = await created('Organisation future');
  orgCancelled = await created('Organisation annulée');
  orgDue = await created('Organisation échue');
  orgKeep = await created('Autre espace');
  orgBlocked = await created('Organisation bloquée');
  orgScript = await created(hiddenName);
  orgLater = await created('Organisation suivante');
  userDual = await addUser('del-dual', 'dual@example.com', 'Deux espaces');
  userSolo = await addUser('del-solo', 'solo@example.com', 'Un seul espace');
  userKeep = await addUser('del-keep', 'keep@example.com', 'Espace conservé');
  userBlocked = await addUser('del-blocked', 'blocked@example.com', 'Bloqué');
  userScript = await addUser('del-script', 'script@example.com', 'Script');
  userLater = await addUser('del-later', 'later@example.com', 'Suivant');
  const member = (org, user, role = 'admin') => admin.query('INSERT INTO memberships(organization_id, user_id, role) VALUES($1,$2,$3)', [org, user, role]);
  await member(orgDue, userDual);
  await member(orgKeep, userDual);
  await member(orgKeep, userKeep);
  await member(orgActive, userKeep);
  await member(orgDue, userSolo, 'member');
  await member(orgBlocked, userBlocked);
  await member(orgFuture, userDual);
  await member(orgCancelled, userDual);
  await member(orgScript, userScript);
  await member(orgLater, userLater);
  ({secret: secretDue} = await fixtureSession(admin, userDual, orgDue, process.env.BETTER_AUTH_SECRET));
  await fixtureSession(admin, userSolo, orgDue, process.env.BETTER_AUTH_SECRET);
  const company = (await admin.query("INSERT INTO companies(organization_id, name, owner_user_id) VALUES($1,'Société échue',$2) RETURNING id", [orgDue, userDual])).rows[0].id;
  const contact = (await admin.query("INSERT INTO contacts(organization_id, company_id, name, owner_user_id) VALUES($1,$2,'Contact échu',$3) RETURNING id", [orgDue, company, userDual])).rows[0].id;
  await admin.query("INSERT INTO contact_emails(organization_id, contact_id, email) VALUES($1,$2,'secret-contact@example.com')", [orgDue, contact]);
  await admin.query("INSERT INTO notes(organization_id, contact_id, author_user_id, body) VALUES($1,$2,$3,'Note secrète')", [orgDue, contact, userDual]);
  await admin.query("INSERT INTO followups(organization_id, contact_id, owner_user_id, subject, due_at) VALUES($1,$2,$3,'Relance secrète', clock_timestamp() + interval '1 day')", [orgDue, contact, userDual]);
  await admin.query("INSERT INTO activities(organization_id, actor_user_id, entity_type, entity_id, action, summary, company_id, contact_id) VALUES($1,$2,'contacts',$3,'created','Activité secrète',$4,$3)", [orgDue, userDual, contact, company]);
  await admin.query("INSERT INTO contact_card_images(organization_id, contact_id, uploaded_by, mime_type, data) VALUES($1,$2,$3,'image/png',$4)", [orgDue, contact, userDual, Buffer.from('image-secrete')]);
  await admin.query("UPDATE organizations SET profile = $2::jsonb WHERE id = $1", [orgDue, JSON.stringify({logo: 'data:image/png;base64,aW1hZ2Utc2VjcmV0ZQ=='})]);
  const token = encrypt(process.env.BETTER_AUTH_SECRET, secretToken);
  await admin.query("INSERT INTO gmail_accounts(organization_id, user_id, email, google_sub, access_token_enc, refresh_token_enc, scope) VALUES($1,$2,'owner@gmail.com','sub-due',$3,$3,'openid email')", [orgDue, userDual, token]);
  await admin.query("INSERT INTO gmail_messages(organization_id, user_id, contact_id, company_id, to_email, subject, body, status, idempotency_key) VALUES($1,$2,$3,$4,'destinataire@example.com','Objet secret','Corps secret','sent','idempotency-due-0001')", [orgDue, userDual, contact, company]);
  await admin.query("INSERT INTO gmail_oauth_states(state_hash, organization_id, user_id, verifier_enc, expires_at) VALUES('due-state',$1,$2,'verifier-secret', clock_timestamp() + interval '5 minutes')", [orgDue, userDual]);
  await admin.query("INSERT INTO invitations(organization_id, email, role, token_hash, invited_by, expires_at) VALUES($1,'invite-due@example.com','member','hash-due',$2, clock_timestamp() + interval '1 day')", [orgDue, userDual]);
  await admin.query("INSERT INTO companies(organization_id, name) VALUES($1,'Société active'),($2,'Société future'),($3,'Société annulée'),($4,'Société autre'),($5,'Société bloquée'),($6,$7),($8,'Société suivante')", [orgActive, orgFuture, orgCancelled, orgKeep, orgBlocked, orgScript, hiddenName, orgLater]);
  await closure(orgDue, userDual, 'due');
  await closure(orgFuture, userDual, 'future');
  await closure(orgCancelled, userDual, 'cancelled');
  await closure(orgBlocked, userBlocked, 'due');
  await closure(orgScript, userScript, 'due');
  await closure(orgLater, userLater, 'later');
  server = (await createApp(db, {appUrl: 'http://localhost', authRateLimit: false, mailer: {configured: true, send: async () => {}}})).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) await db.pool.end();
  if (admin) await admin.end();
  if (rootPool) {
    if (testDb) await rootPool.query('DROP DATABASE ' + testDb);
    await rootPool.end();
  }
});

test('Seule une fermeture échue est éligible, quel que soit le fuseau', async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'Pacific/Kiritimati'");
    const ids = (await client.query(ELIGIBLE_SQL)).rows.map(row => row.id);
    await client.query('ROLLBACK');
    assert.deepEqual(ids.sort(), [orgBlocked, orgDue, orgScript, orgLater].sort());
  } finally { client.release(); }
  assert.equal((await listEligible(db)).includes(orgActive), false);
  assert.equal((await listEligible(db)).includes(orgFuture), false);
  assert.equal((await listEligible(db)).includes(orgCancelled), false);
  assert.equal((await counts(orgKeep)).companies, 1);
});

test('Une erreur annule toute la suppression', async () => {
  const before = await counts(orgBlocked);
  const failed = await deleteExpiredOrganization(db, orgBlocked, {secret: process.env.BETTER_AUTH_SECRET, revoke: async () => { throw new Error(secretToken); }, beforeCommit: async () => { throw Object.assign(new Error('stop'), {code: 'TFAIL'}); }});
  assert.equal(failed.outcome, 'echec');
  assert.equal(failed.code, 'TFAIL');
  assert.equal(JSON.stringify(failed).includes(secretToken), false);
  assert.deepEqual(await counts(orgBlocked), before);
  await admin.query("INSERT INTO legacy_sessions(token_hash, user_id, organization_id, csrf_token, expires_at) VALUES('legacy-due',$1,$2,'csrf', clock_timestamp() + interval '1 day')", [userBlocked, orgBlocked]);
  const foreignKey = await deleteExpiredOrganization(db, orgBlocked, {secret: process.env.BETTER_AUTH_SECRET, revoke: async () => {}});
  assert.equal(foreignKey.outcome, 'echec');
  assert.equal(foreignKey.code, '23503');
  assert.deepEqual(await counts(orgBlocked), {...before, legacy_sessions: 1});
  await admin.query('DELETE FROM legacy_sessions WHERE organization_id = $1', [orgBlocked]);
});

test('La suppression échue retire les données de l’espace et conserve les comptes', async () => {
  const beforeUsers = (await admin.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const beforeAccounts = (await admin.query('SELECT count(*)::int AS n FROM auth_accounts')).rows[0].n;
  const otherBefore = await counts(orgKeep);
  const activeBefore = await counts(orgActive);
  const result = await deleteExpiredOrganization(db, orgDue, {secret: process.env.BETTER_AUTH_SECRET, revoke: async token => { revoked.push(token); throw new Error('google indisponible'); }});
  assert.equal(result.outcome, 'supprime');
  assert.equal(result.revocation, 'echec');
  assert.deepEqual(revoked, [secretToken, secretToken]);
  assert.equal(JSON.stringify(result).includes(secretToken), false);
  const gone = await counts(orgDue);
  for (const table of Object.keys(gone)) assert.equal(gone[table], 0, table);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM organizations WHERE id = $1', [orgDue])).rows[0].n, 0);
  const kept = await counts(orgKeep);
  assert.equal(kept.companies, otherBefore.companies);
  assert.equal(kept.auth_sessions, otherBefore.auth_sessions + 1);
  assert.deepEqual(await counts(orgActive), activeBefore);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM users')).rows[0].n, beforeUsers);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM auth_accounts')).rows[0].n, beforeAccounts);
  assert.equal((await admin.query('SELECT organization_id FROM auth_sessions WHERE user_id = $1', [userDual])).rows[0].organization_id, orgKeep);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id = $1', [userSolo])).rows[0].n, 0);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM memberships WHERE user_id = $1 AND organization_id = $2', [userDual, orgKeep])).rows[0].n, 1);
  assert.equal((await admin.query('SELECT closure_status FROM organizations WHERE id = $1', [orgFuture])).rows[0].closure_status, 'pending_deletion');
  assert.equal((await admin.query('SELECT closure_status FROM organizations WHERE id = $1', [orgCancelled])).rows[0].closure_status, 'active');
  assert.equal(await deleteExpiredOrganization(db, orgActive, {revoke: async () => {}}).then(value => value.outcome), 'ignore');
  assert.equal(await deleteExpiredOrganization(db, orgFuture, {revoke: async () => {}}).then(value => value.outcome), 'ignore');
  assert.equal(await deleteExpiredOrganization(db, orgCancelled, {revoke: async () => {}}).then(value => value.outcome), 'ignore');
  assert.equal((await deleteExpiredOrganization(db, orgDue, {revoke: async () => {}})).outcome, 'absent');
  for (const path of ['/api/v1/organization', '/api/v1/organization/delete', '/api/v1/organizations/' + orgFuture]) {
    const response = await fetch(base + path, {method: 'DELETE', headers: {authorization: 'Bearer ' + secretDue}});
    assert.equal(response.status, 404, path);
  }
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM organizations WHERE id = $1', [orgFuture])).rows[0].n, 1);
});

test('Deux traitements simultanés ne suppriment qu’une fois', async () => {
  const results = await Promise.all([
    deleteExpiredOrganization(db, orgBlocked, {secret: process.env.BETTER_AUTH_SECRET, revoke: async () => {}}),
    deleteExpiredOrganization(db, orgBlocked, {secret: process.env.BETTER_AUTH_SECRET, revoke: async () => {}})
  ]);
  assert.deepEqual(results.map(result => result.outcome).sort(), ['absent', 'supprime']);
  assert.equal((await counts(orgBlocked)).companies, 0);
  assert.equal((await counts(orgKeep)).companies, 1);
});

test('Le script simule par défaut et poursuit après un échec', async () => {
  const retried = [];
  const failed = await purgeExternalFiles(['fichier-a'], async () => { throw new Error('disque'); }, 3);
  assert.deepEqual(failed, ['fichier-a']);
  await purgeExternalFiles(['fichier-b'], async file => { retried.push(file); if (retried.length < 2) throw new Error('reprise'); });
  assert.deepEqual(retried, ['fichier-b', 'fichier-b']);
  const report = formatReport({mode: 'execution', ids: [orgScript], results: [{id: orgScript, outcome: 'supprime', revocation: 'echec', filesFailed: true}]});
  assert.equal(report.includes(secretToken), false);
  assert.equal(report.includes(hiddenName), false);
  assert.match(report, /revocation=echec/);
  const dry = spawnSync(process.execPath, ['scripts/delete-expired-organizations.js'], {env: {...process.env, DATABASE_URL: runtimeUrl}, encoding: 'utf8'});
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /mode=simulation/);
  assert.match(dry.stdout, new RegExp('id=' + orgScript));
  assert.equal(dry.stdout.includes(hiddenName), false);
  assert.equal(dry.stdout.includes('secret-contact@example.com'), false);
  assert.equal((await counts(orgScript)).companies, 1);
  const blockedRun = await runDeletion(db, {execute: true, secret: process.env.BETTER_AUTH_SECRET, revoke: async () => {}, beforeCommit: id => id === orgLater ? async () => { throw Object.assign(new Error('stop'), {code: 'TFAIL'}); } : null});
  assert.equal(blockedRun.results.find(result => result.id === orgLater).outcome, 'echec');
  assert.equal(blockedRun.results.find(result => result.id === orgScript).outcome, 'supprime');
  assert.equal((await counts(orgLater)).companies, 1);
  assert.equal((await counts(orgScript)).companies, 0);
  const removed = spawnSync(process.execPath, ['scripts/delete-expired-organizations.js', '--execute'], {env: {...process.env, DATABASE_URL: runtimeUrl}, encoding: 'utf8'});
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /mode=execution/);
  assert.match(removed.stdout, new RegExp('id=' + orgLater + ' resultat=supprime'));
  assert.equal(removed.stdout.includes(hiddenName), false);
  assert.equal((await counts(orgLater)).companies, 0);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [userLater])).rows[0].n, 1);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM users WHERE id = $1', [userScript])).rows[0].n, 1);
  const again = spawnSync(process.execPath, ['scripts/delete-expired-organizations.js', '--execute'], {env: {...process.env, DATABASE_URL: runtimeUrl}, encoding: 'utf8'});
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /espaces=0/);
  const usage = spawnSync(process.execPath, ['scripts/delete-expired-organizations.js', '--now'], {env: {...process.env, DATABASE_URL: runtimeUrl}, encoding: 'utf8'});
  assert.equal(usage.status, 1);
  assert.equal((await counts(orgActive)).companies, 1);
  const live = fs.readFileSync('public/live.js', 'utf8');
  const api = fs.readFileSync('lib/api.js', 'utf8');
  assert.equal(live.includes('Supprimer immédiatement'), false);
  assert.equal(api.includes('/organization/delete'), false);
  assert.equal(CHILD_TABLES.includes('users'), false);
  assert.equal(CHILD_TABLES.includes('auth_accounts'), false);
  assert.equal(CHILD_TABLES.includes('document_extractions'), true);
});
