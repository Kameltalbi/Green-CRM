require('dotenv').config({quiet: true});
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {Pool} = require('pg');
const {spawnSync} = require('node:child_process');
const {createDatabase} = require('../../lib/db');
const {createApp} = require('../../server');
const {readZip} = require('../../lib/zip');
const {hash, token} = require('../../lib/validation');
const {fixtureSession} = require('../session-fixture.cjs');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const suspended = 'Cet espace est en cours de fermeture. Les modifications sont suspendues.';
let admin, db, server, base, rootPool, testDb, orgA, orgB, userA, userB, userC, memberA, retiredAdmin, invitee, secretA, secretB, secretC, secretMember, secretRetired, secretInvitee, companyA, contactA, followupA, inviteToken;
const gmailCalls = {exchange: 0};
const mails = [];

async function request(path, {method = 'GET', body, auth = secretA, headers = {}} = {}) {
  const response = await fetch(base + path, {method, redirect: 'manual', headers: {...(auth ? {authorization: 'Bearer ' + auth} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
  let data;
  try { data = await response.json(); } catch { data = undefined; }
  return {status: response.status, data, headers: response.headers};
}
const v = (path, opts) => request('/api/v1' + path, opts);
async function addUser(sub, address, name) {
  return (await admin.query('INSERT INTO users(google_sub, email, name, email_verified) VALUES($1,$2,$3,true) RETURNING id', [sub, address, name])).rows[0].id;
}
async function addSession(user, org) { return fixtureSession(admin, user, org, process.env.BETTER_AUTH_SECRET); }
async function count(table, org) {
  return (await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id=$1`, [org])).rows[0].n;
}
function ask(name, confirm = true, auth = secretA) {
  return v('/organization/closure', {method: 'POST', auth, body: {name, confirm}});
}

before(async () => {
  assert.ok(process.env.MIGRATION_DATABASE_URL, 'Configurez la base locale avant les tests.');
  const rootUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  rootPool = new Pool({connectionString: rootUrl.toString()});
  testDb = 'ciblix_test_' + crypto.randomBytes(6).toString('hex');
  await rootPool.query('CREATE DATABASE ' + testDb);
  rootUrl.pathname = '/' + testDb;
  const migration = rootUrl.toString();
  const result = spawnSync(process.execPath, ['scripts/migrate.js'], {env: {...process.env, MIGRATION_DATABASE_URL: migration}, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  admin = new Pool({connectionString: migration});
  const appUrl = new URL(process.env.DATABASE_URL);
  appUrl.pathname = '/' + testDb;
  db = createDatabase(appUrl.toString());
  await db.verify();
  orgA = (await admin.query("INSERT INTO organizations(name) VALUES('Organisation A') RETURNING id")).rows[0].id;
  orgB = (await admin.query("INSERT INTO organizations(name) VALUES('Organisation B') RETURNING id")).rows[0].id;
  userA = await addUser('closure-a', 'closure-a@example.com', 'Admin A');
  userB = await addUser('closure-b', 'closure-b@example.com', 'Admin B');
  userC = await addUser('closure-c', 'closure-c@example.com', 'Admin C');
  memberA = await addUser('closure-m', 'closure-membre@example.com', 'Membre A');
  retiredAdmin = await addUser('closure-retired', 'closure-retire@example.com', 'Admin retiré');
  invitee = await addUser('closure-invite', 'invite-fermeture@example.com', 'Invité');
  await admin.query("INSERT INTO memberships(organization_id, user_id, role) VALUES($1,$2,'admin'),($1,$3,'admin'),($1,$4,'member'),($1,$5,'admin'),($6,$2,'admin'),($6,$7,'admin')", [orgA, userA, userC, memberA, retiredAdmin, orgB, userB]);
  ({secret: secretA} = await addSession(userA, orgA));
  ({secret: secretB} = await addSession(userB, orgB));
  ({secret: secretC} = await addSession(userC, orgA));
  ({secret: secretMember} = await addSession(memberA, orgA));
  ({secret: secretRetired} = await addSession(retiredAdmin, orgA));
  ({secret: secretInvitee} = await addSession(invitee, null));
  await admin.query('UPDATE memberships SET active=false WHERE organization_id=$1 AND user_id=$2', [orgA, retiredAdmin]);
  companyA = (await admin.query("INSERT INTO companies(organization_id, name) VALUES($1,'Société conservée') RETURNING id", [orgA])).rows[0].id;
  contactA = (await admin.query("INSERT INTO contacts(organization_id, name) VALUES($1,'Contact conservé') RETURNING id", [orgA])).rows[0].id;
  followupA = (await admin.query("INSERT INTO followups(organization_id, owner_user_id, subject, due_at) VALUES($1,$2,'Relance conservée', now()+interval '1 day') RETURNING id", [orgA, userA])).rows[0].id;
  server = (await createApp(db, {appUrl: 'http://localhost', authRateLimit: false, gmailClientId: 'gmail-client', gmailClientSecret: 'gmail-secret', gmailGoogle: {authorizationUrl() { return 'https://accounts.google.com/o/oauth2/v2/auth'; }, async exchange() { gmailCalls.exchange += 1; throw new Error('exchange'); }, async refresh() { throw new Error('refresh'); }, async revoke() {}, async send() { throw new Error('send'); }}, mailer: {configured: true, send: async mail => mails.push(mail)}})).listen(0, '127.0.0.1');
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

test('Membre, administrateur désactivé et confirmation inexacte sont refusés', async () => {
  assert.equal((await v('/organization/closure', {auth: null, method: 'POST', body: {name: 'Organisation A', confirm: true}})).status, 401);
  const member = await ask('Organisation A', true, secretMember);
  assert.equal(member.status, 403);
  assert.equal(member.data.message, 'Cette action est réservée à un administrateur.');
  const retired = await ask('Organisation A', true, secretRetired);
  assert.equal(retired.status, 403);
  assert.equal(retired.data.message, 'Votre accès à cette entreprise a été retiré.');
  for (const body of [
    {name: 'Organisation A'},
    {name: 'Organisation A', confirm: 'true'},
    {name: 'Organisation A', confirm: false},
    {name: 'organisation a', confirm: true},
    {name: 'Organisation A ', confirm: true},
    {name: 'Organisation B', confirm: true},
    {name: 'Organisation A', confirm: true, organization_id: orgB}
  ]) {
    const refused = await v('/organization/closure', {method: 'POST', body});
    assert.equal(refused.status, 400, JSON.stringify(body));
  }
  assert.match((await ask('Organisation B')).data.message, /nom saisi/);
  const state = (await admin.query('SELECT closure_status, closure_requested_at FROM organizations WHERE id=$1', [orgA])).rows[0];
  assert.equal(state.closure_status, 'active');
  assert.equal(state.closure_requested_at, null);
  assert.equal(await count('companies', orgA), 1);
});

test('Demandes simultanées : une seule fermeture à J+30', async () => {
  const results = await Promise.all(Array.from({length: 8}, () => ask('Organisation A')));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 7);
  const saved = results.find(result => result.status === 200).data;
  assert.equal(saved.status, 'pending_deletion');
  assert.equal(saved.requested_by, userA);
  assert.equal(saved.cancelled_by, null);
  assert.equal(new Date(saved.scheduled_at) - new Date(saved.requested_at), 30 * 24 * 60 * 60 * 1000);
  const row = (await admin.query("SELECT closure_requested_by, closure_scheduled_at = closure_requested_at + interval '30 days' AS exact FROM organizations WHERE id=$1", [orgA])).rows[0];
  assert.equal(row.closure_requested_by, userA);
  assert.equal(row.exact, true);
  assert.equal((await ask('Organisation A')).status, 409);
  assert.equal(await count('companies', orgA), 1);
  assert.equal(await count('contacts', orgA), 1);
});

test('Lecture et export restent ouverts, les écritures et l’autre espace sont isolés', async () => {
  const companiesBefore = await count('companies', orgA);
  const blocked = [
    v('/companies', {method: 'POST', body: {name: 'Interdite'}}),
    v('/companies/' + companyA, {method: 'PATCH', body: {name: 'Renommée'}}),
    v('/companies/' + companyA, {method: 'DELETE'}),
    v('/notes', {method: 'POST', body: {body: 'Note interdite', contact_id: contactA}}),
    v('/followups/' + followupA, {method: 'PATCH', body: {subject: 'Reportée'}}),
    v('/contacts/' + contactA + '/card', {method: 'POST', body: {mime_type: 'image/png', data: png}}),
    v('/organization', {method: 'PATCH', body: {name: 'Organisation A'}}),
    v('/invitations', {method: 'POST', body: {email: 'nouveau-membre@example.com'}}),
    v('/members/' + memberA, {method: 'PATCH', body: {role: 'admin', active: true}}),
    v('/gmail/connect', {method: 'POST', body: {}}),
    v('/gmail/messages', {method: 'POST', body: {}}),
    v('/gmail/accounts/' + crypto.randomUUID(), {method: 'DELETE'})
  ];
  for (const result of await Promise.all(blocked)) {
    assert.equal(result.status, 403, JSON.stringify(result.data));
    assert.equal(result.data.message, suspended);
  }
  assert.equal(mails.length, 0);
  assert.equal((await v('/companies/' + companyA)).status, 200);
  assert.equal((await v('/companies/' + companyA)).data.name, 'Société conservée');
  assert.equal((await v('/contacts/' + contactA)).data.name, 'Contact conservé');
  assert.equal((await v('/followups/' + followupA)).data.subject, 'Relance conservée');
  assert.equal((await v('/organization')).data.closure.status, 'pending_deletion');
  assert.equal((await v('/companies', {auth: secretMember})).status, 200);
  const csv = await fetch(base + '/api/v1/contacts/export', {headers: {authorization: 'Bearer ' + secretMember}});
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Contact conservé/);
  const exported = await fetch(base + '/api/v1/organization/export', {headers: {authorization: 'Bearer ' + secretA}});
  assert.equal(exported.status, 200);
  const files = readZip(Buffer.from(await exported.arrayBuffer()));
  assert.equal(JSON.parse(files['organization.json']).closure_status, 'pending_deletion');
  assert.equal(JSON.parse(files['companies.json'])[0].name, 'Société conservée');
  inviteToken = token();
  await admin.query("INSERT INTO invitations(organization_id, email, role, token_hash, invited_by, expires_at) VALUES($1,'invite-fermeture@example.com','member',$2,$3,now()+interval '2 days')", [orgA, hash(inviteToken), userA]);
  const accepted = await v('/invitations/accept', {method: 'POST', auth: secretInvitee, body: {token: inviteToken}});
  assert.equal(accepted.status, 403);
  assert.equal(accepted.data.message, suspended);
  assert.equal((await admin.query('SELECT accepted_at FROM invitations WHERE token_hash=$1', [hash(inviteToken)])).rows[0].accepted_at, null);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM memberships WHERE user_id=$1', [invitee])).rows[0].n, 0);
  const state = token();
  await admin.query("INSERT INTO gmail_oauth_states(state_hash, organization_id, user_id, verifier_enc, expires_at) VALUES($1,$2,$3,'verifier',now()+interval '5 minutes')", [hash(state), orgA, userA]);
  const callback = await v('/gmail/callback?code=pending&state=' + encodeURIComponent(state));
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get('location'), /etat=suspendu/);
  assert.equal(gmailCalls.exchange, 0);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM gmail_oauth_states WHERE state_hash=$1', [hash(state)])).rows[0].n, 1);
  assert.equal((await v('/organizations/switch', {method: 'POST', body: {organization_id: orgB}})).status, 200);
  assert.equal((await v('/organization')).data.closure.status, 'active');
  assert.equal((await v('/companies', {method: 'POST', body: {name: 'Société active B'}})).status, 201);
  assert.equal((await v('/organization/closure', {method: 'POST', auth: secretB, body: {name: 'Organisation A', confirm: true}})).status, 400);
  assert.equal((await admin.query('SELECT closure_status FROM organizations WHERE id=$1', [orgB])).rows[0].closure_status, 'active');
  assert.equal((await v('/organizations/switch', {method: 'POST', body: {organization_id: orgA}})).status, 200);
  assert.equal((await v('/companies', {method: 'POST', body: {name: 'Toujours interdite'}})).status, 403);
  assert.equal(await count('companies', orgA), companiesBefore);
  assert.equal(await count('companies', orgB), 1);
  const headers = {origin: 'http://localhost'};
  const signup = await request('/api/auth/sign-up/email', {method: 'POST', auth: null, headers, body: {name: 'Nouveau Compte', email: 'closure-auth@example.com', password: 'Une phrase solide 2026!', companyName: 'Société libre'}});
  assert.equal(signup.status, 200, JSON.stringify(signup.data));
  assert.equal((await request('/api/auth/sign-in/email', {method: 'POST', auth: null, headers, body: {email: 'closure-auth@example.com', password: 'Une phrase solide 2026!'}})).status, 403);
  assert.equal((await v('/organization', {method: 'DELETE'})).status, 404);
});

test('Annulations simultanées, puis rétablissement des écritures', async () => {
  const results = await Promise.all(Array.from({length: 8}, () => v('/organization/closure/cancel', {method: 'POST', body: {}})));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  assert.equal(results.filter(result => result.status === 409).length, 7);
  const saved = results.find(result => result.status === 200).data;
  assert.equal(saved.status, 'active');
  assert.equal(saved.cancelled_by, userA);
  assert.ok(new Date(saved.cancelled_at) < new Date(saved.scheduled_at));
  assert.equal((await v('/organization/closure/cancel', {method: 'POST', body: {}})).status, 409);
  assert.equal((await v('/companies', {method: 'POST', body: {name: 'De nouveau possible'}})).status, 201);
  const accepted = await v('/invitations/accept', {method: 'POST', auth: secretInvitee, body: {token: inviteToken}});
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(await count('companies', orgA), 2);
  assert.equal((await v('/companies/' + companyA)).data.name, 'Société conservée');
});

test('Un autre administrateur peut demander, puis l’annulation rétablit l’espace', async () => {
  const [created, closed] = await Promise.all([
    v('/companies', {method: 'POST', body: {name: 'Course'}}),
    ask('Organisation A', true, secretC)
  ]);
  assert.equal(closed.status, 200);
  assert.equal(closed.data.requested_by, userC);
  assert.ok([201, 403].includes(created.status));
  assert.equal((await v('/companies', {method: 'POST', body: {name: 'Après la course'}})).status, 403);
  if (created.status === 201) assert.equal((await v('/companies/' + created.data.id)).data.name, 'Course');
  const [cancel, during] = await Promise.all([
    v('/organization/closure/cancel', {method: 'POST', body: {}}),
    v('/notes', {method: 'POST', body: {body: 'Note de course', contact_id: contactA}})
  ]);
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.cancelled_by, userA);
  assert.ok([201, 403].includes(during.status));
  assert.equal((await v('/organization')).data.closure.status, 'active');
  assert.equal((await v('/notes', {method: 'POST', body: {body: 'Note après annulation', contact_id: contactA}})).status, 201);
  assert.equal((await v('/companies/' + companyA)).data.name, 'Société conservée');
});

test('Après l’échéance, l’annulation est refusée et les données restent consultables', async () => {
  const closed = await ask('Organisation A');
  assert.equal(closed.status, 200);
  const before = {companies: await count('companies', orgA), contacts: await count('contacts', orgA), notes: await count('notes', orgA)};
  await admin.query("UPDATE organizations SET closure_requested_at = closure_requested_at - interval '31 days', closure_scheduled_at = closure_scheduled_at - interval '31 days' WHERE id=$1", [orgA]);
  const cancel = await v('/organization/closure/cancel', {method: 'POST', body: {}});
  assert.equal(cancel.status, 409);
  assert.match(cancel.data.message, /délai de 30 jours/);
  assert.equal((await v('/companies', {method: 'POST', body: {name: 'Trop tard'}})).status, 403);
  assert.equal((await v('/companies/' + companyA)).data.name, 'Société conservée');
  const exported = await fetch(base + '/api/v1/organization/export', {headers: {authorization: 'Bearer ' + secretA}});
  assert.equal(exported.status, 200);
  assert.equal(JSON.parse(readZip(Buffer.from(await exported.arrayBuffer()))['organization.json']).closure_status, 'pending_deletion');
  assert.equal((await admin.query('SELECT closure_status FROM organizations WHERE id=$1', [orgB])).rows[0].closure_status, 'active');
  assert.deepEqual({companies: await count('companies', orgA), contacts: await count('contacts', orgA), notes: await count('notes', orgA)}, before);
  assert.equal((await v('/companies', {method: 'POST', auth: secretB, body: {name: 'Société encore B'}})).status, 201);
});

test('L’interface décrit la fermeture sans suppression immédiate', () => {
  const live = fs.readFileSync('public/live.js', 'utf8');
  const migration = fs.readFileSync('db/migrations/009_organization_closure.sql', 'utf8');
  assert.match(live, /Fermer cet espace/);
  assert.match(live, /La fermeture de cet espace entraînera la suppression de ses données après un délai de 30 jours\. Pendant cette période, vous pourrez consulter et exporter vos données, ou annuler la fermeture\./);
  assert.match(live, /Demander la fermeture/);
  assert.match(live, /Annuler la fermeture/);
  assert.match(live, /Exporter mes données/);
  assert.equal(live.includes('Supprimer cet espace'), false);
  assert.equal(live.includes('suppression immédiate'), false);
  assert.equal(migration.includes('auth_accounts'), false);
  assert.equal(migration.includes('auth_sessions'), false);
  assert.equal(migration.includes('DELETE FROM'), false);
  assert.equal(migration.includes('DROP TABLE'), false);
});
