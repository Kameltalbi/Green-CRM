require('dotenv').config({quiet: true});
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Pool} = require('pg');
const {spawnSync} = require('node:child_process');
const {createDatabase} = require('../../lib/db');
const {createApp} = require('../../server');
const {fixtureSession} = require('../session-fixture.cjs');

let admin, db, server, base, rootPool, testDb, runtimeUrl;
let orgA, orgB, userA, userB, secretA, secretB;
const mails = [];
const firstPassword = 'Phrase initiale solide 2026';
const nextPassword = 'Phrase remplacee solide 2026';

async function request(path, {method = 'GET', body, auth = secretA, headers = {}} = {}) {
  const response = await fetch(base + path, {method, redirect: 'manual', headers: {origin: 'http://localhost', ...(auth ? {authorization: 'Bearer ' + auth} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch { /* redirection sans corps */ }
  return {status: response.status, data, headers: response.headers};
}
const v = (path, opts) => request('/api/v1' + path, opts);

before(async () => {
  assert.ok(process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
  const rootUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  rootPool = new Pool({connectionString: rootUrl.toString()});
  testDb = 'ciblix_test_' + crypto.randomBytes(6).toString('hex');
  await rootPool.query('CREATE DATABASE ' + testDb);
  rootUrl.pathname = '/' + testDb;
  const migrated = spawnSync(process.execPath, ['scripts/migrate.js'], {env: {...process.env, MIGRATION_DATABASE_URL: rootUrl.toString()}, encoding: 'utf8'});
  assert.equal(migrated.status, 0, migrated.stderr);
  admin = new Pool({connectionString: rootUrl.toString()});
  const appUrl = new URL(process.env.DATABASE_URL);
  appUrl.pathname = '/' + testDb;
  runtimeUrl = appUrl.toString();
  db = createDatabase(runtimeUrl);
  await db.verify();
  orgA = (await admin.query("INSERT INTO organizations(name) VALUES('Atelier Nord') RETURNING id")).rows[0].id;
  orgB = (await admin.query("INSERT INTO organizations(name) VALUES('Novatech') RETURNING id")).rows[0].id;
  userA = (await admin.query("INSERT INTO users(google_sub, email, name, email_verified) VALUES('super-a','super@example.com','Super A',true) RETURNING id")).rows[0].id;
  userB = (await admin.query("INSERT INTO users(google_sub, email, name, email_verified) VALUES('admin-b','admin-b@example.com','Admin B',true) RETURNING id")).rows[0].id;
  const googleUser = (await admin.query("INSERT INTO users(google_sub, email, name, email_verified) VALUES('google-only','google@example.com','Compte Google',true) RETURNING id")).rows[0].id;
  await admin.query("INSERT INTO memberships(organization_id, user_id, role) VALUES($1,$2,'admin'),($3,$4,'admin'),($1,$4,'member'),($3,$5,'member')", [orgA, userA, orgB, userB, googleUser]);
  await admin.query("INSERT INTO auth_accounts(user_id, account_id, provider_id) VALUES($1,$2,'google')", [googleUser, 'google-only']);
  await admin.query('INSERT INTO platform_admins(user_id) VALUES($1)', [userA]);
  ({secret: secretA} = await fixtureSession(admin, userA, orgA, process.env.BETTER_AUTH_SECRET));
  ({secret: secretB} = await fixtureSession(admin, userB, orgB, process.env.BETTER_AUTH_SECRET));
  server = (await createApp(db, {appUrl: 'http://localhost', authRateLimit: false, mailer: {configured: true, send: async mail => mails.push(mail)}})).listen(0, '127.0.0.1');
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

test('Un administrateur d’espace ne voit pas les autres organisations', async () => {
  assert.equal((await v('/superadmin/organizations', {auth: null})).status, 401);
  const refused = await v('/superadmin/organizations', {auth: secretB});
  assert.equal(refused.status, 403);
  assert.equal(refused.data.message, 'Cette action est réservée au superadmin.');
  assert.equal((await v('/me', {auth: secretB})).data.superadmin, false);
  assert.equal((await v('/me')).data.superadmin, true);
});

test('Le superadmin voit les organisations, leurs administrateurs et leurs utilisateurs', async () => {
  const listed = await v('/superadmin/organizations');
  assert.equal(listed.status, 200);
  assert.equal(JSON.stringify(listed.data).includes(firstPassword), false);
  const names = listed.data.organizations.map(organization => organization.name).sort();
  assert.deepEqual(names, ['Atelier Nord', 'Novatech']);
  const north = listed.data.organizations.find(organization => organization.id === orgA);
  const other = listed.data.organizations.find(organization => organization.id === orgB);
  assert.equal(north.access_ends_at, null);
  assert.ok(north.created_at);
  assert.equal(north.users.find(user => user.role === 'admin').email, 'super@example.com');
  assert.equal(other.users.find(user => user.role === 'admin').name, 'Admin B');
  assert.equal(other.users.find(user => user.email === 'google@example.com').password_account, false);
  assert.ok(north.users.some(user => user.email === 'admin-b@example.com' && user.role === 'member'));
});

test('La date de fin se définit et se retire', async () => {
  assert.equal((await v('/superadmin/organizations/' + orgB, {method: 'PATCH', auth: secretB, body: {access_ends_at: '2026-12-31'}})).status, 403);
  assert.equal((await v('/superadmin/organizations/' + orgB, {method: 'PATCH', body: {access_ends_at: '31/12/2026'}})).status, 400);
  const saved = await v('/superadmin/organizations/' + orgB, {method: 'PATCH', body: {access_ends_at: '2026-12-31'}});
  assert.equal(saved.status, 200);
  assert.equal(new Date(saved.data.access_ends_at).toISOString(), '2026-12-31T22:59:59.000Z');
  const cleared = await v('/superadmin/organizations/' + orgB, {method: 'PATCH', body: {access_ends_at: null}});
  assert.equal(cleared.data.access_ends_at, null);
  assert.equal((await admin.query('SELECT access_ends_at FROM organizations WHERE id = $1', [orgA])).rows[0].access_ends_at, null);
});

test('Le mot de passe d’un compte e-mail peut être remplacé', async () => {
  const address = 'inscrit@example.com';
  let created = await request('/api/auth/sign-up/email', {method: 'POST', auth: null, body: {name: 'Inscrit Test', email: address, password: firstPassword, companyName: 'Société inscrite'}});
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const verification = new URL(mails.filter(mail => mail.to === address).at(-1).url);
  assert.equal((await request(verification.pathname + verification.search, {auth: null})).status, 302);
  const signed = await request('/api/auth/sign-in/email', {method: 'POST', auth: null, body: {email: address, password: firstPassword}});
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  const userId = (await admin.query('SELECT id FROM users WHERE email = $1', [address])).rows[0].id;
  const sessionBefore = (await admin.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id = $1', [userId])).rows[0].n;
  assert.ok(sessionBefore > 0);
  assert.equal((await v('/superadmin/users/' + userId + '/password', {method: 'POST', auth: secretB, body: {password: nextPassword}})).status, 403);
  assert.equal((await v('/superadmin/users/' + userId + '/password', {method: 'POST', body: {password: 'court'}})).status, 400);
  const googleId = (await admin.query("SELECT id FROM users WHERE email = 'google@example.com'")).rows[0].id;
  assert.equal((await v('/superadmin/users/' + googleId + '/password', {method: 'POST', body: {password: nextPassword}})).status, 409);
  const changed = await v('/superadmin/users/' + userId + '/password', {method: 'POST', body: {password: nextPassword}});
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.data, {ok: true});
  assert.equal(JSON.stringify(changed.data).includes(nextPassword), false);
  const stored = (await admin.query("SELECT password FROM auth_accounts WHERE user_id = $1 AND provider_id = 'credential'", [userId])).rows[0].password;
  assert.notEqual(stored, nextPassword);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM auth_sessions WHERE user_id = $1', [userId])).rows[0].n, 0);
  assert.equal((await v('/me')).status, 200);
  assert.equal((await request('/api/auth/sign-in/email', {method: 'POST', auth: null, body: {email: address, password: firstPassword}})).status, 401);
  const renewed = await request('/api/auth/sign-in/email', {method: 'POST', auth: null, body: {email: address, password: nextPassword}});
  assert.equal(renewed.status, 200);
  const granted = spawnSync(process.execPath, ['scripts/grant-superadmin.js', address], {env: {...process.env, DATABASE_URL: runtimeUrl}, encoding: 'utf8'});
  assert.equal(granted.status, 0, granted.stderr);
  assert.match(granted.stdout, new RegExp(userId));
  assert.equal(granted.stdout.includes(nextPassword), false);
});
