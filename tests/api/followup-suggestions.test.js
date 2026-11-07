require('dotenv').config({quiet: true});
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Pool} = require('pg');
const {spawnSync} = require('node:child_process');
const {createDatabase} = require('../../lib/db');
const {createApp} = require('../../server');
const {fixtureSession} = require('../session-fixture.cjs');
const {businessDaysBetween} = require('../../lib/followup-suggestions');

let admin, db, server, base, rootPool, testDb, orgA, orgB, userA, userB, readerA, secretA, secretB, secretReader;

async function request(path, {method = 'GET', body, auth = secretA} = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? {authorization: 'Bearer ' + auth} : {}),
      ...(body !== undefined ? {'content-type': 'application/json'} : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data;
  try { data = await response.json(); } catch {}
  return {status: response.status, data};
}
const v = (path, opts) => request('/api/v1' + path, opts);

before(async () => {
  assert.ok(process.env.MIGRATION_DATABASE_URL, 'Configurez la base locale avant les tests.');
  const rootUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  rootPool = new Pool({connectionString: rootUrl.toString()});
  testDb = 'ciblix_relances_' + crypto.randomBytes(6).toString('hex');
  await rootPool.query('CREATE DATABASE ' + testDb);
  rootUrl.pathname = '/' + testDb;
  const migration = rootUrl.toString();
  const result = spawnSync(process.execPath, ['scripts/migrate.js'], {env: {...process.env, MIGRATION_DATABASE_URL: migration}, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr + result.stdout);
  admin = new Pool({connectionString: migration});
  const appUrl = new URL(process.env.DATABASE_URL);
  appUrl.pathname = '/' + testDb;
  db = createDatabase(appUrl.toString());
  await db.verify();
  orgA = (await admin.query("INSERT INTO organizations(name) VALUES('Org Relance') RETURNING id")).rows[0].id;
  orgB = (await admin.query("INSERT INTO organizations(name) VALUES('Autre Org') RETURNING id")).rows[0].id;
  const addUser = async (sub, address, name) => (await admin.query('INSERT INTO users(google_sub,email,name,email_verified) VALUES($1,$2,$3,true) RETURNING id', [sub, address, name])).rows[0].id;
  userA = await addUser('relance-a', 'relance-a@example.com', 'Admin Relance');
  userB = await addUser('relance-b', 'relance-b@example.com', 'Admin Autre');
  readerA = await addUser('relance-r', 'relance-r@example.com', 'Lecteur Relance');
  await admin.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'admin'),($3,$4,'admin'),($1,$5,'reader')", [orgA, userA, orgB, userB, readerA]);
  ({secret: secretA} = await fixtureSession(admin, userA, orgA, process.env.BETTER_AUTH_SECRET));
  ({secret: secretB} = await fixtureSession(admin, userB, orgB, process.env.BETTER_AUTH_SECRET));
  ({secret: secretReader} = await fixtureSession(admin, readerA, orgA, process.env.BETTER_AUTH_SECRET));
  server = (await createApp(db, {appUrl: 'http://localhost', authRateLimit: false, disableGmailSyncLoop: true, mailer: {configured: true, send: async () => {}}})).listen(0, '127.0.0.1');
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

test('les jours ouvrés ignorent le week-end', () => {
  assert.equal(businessDaysBetween('2026-11-06', '2026-11-13'), 5);
  assert.equal(businessDaysBetween('2026-11-09', '2026-11-13'), 4);
  assert.equal(businessDaysBetween('2026-11-13', '2026-11-16'), 1);
});

test('suggestions : e-mail sans réponse, contact inactif, relance en retard', async () => {
  const company = await v('/companies', {method: 'POST', body: {name: 'Client Relance'}});
  assert.equal(company.status, 201, JSON.stringify(company.data));
  const contact = await v('/contacts', {method: 'POST', body: {name: 'Inès Relance', company_id: company.data.id, emails: ['ines.relance@example.com']}});
  assert.equal(contact.status, 201, JSON.stringify(contact.data));
  const quiet = (await admin.query(
    `INSERT INTO contacts(organization_id,name,created_at,updated_at)
     VALUES($1,'Samir Inactif',now()-interval '45 days',now()-interval '45 days') RETURNING id`,
    [orgA]
  )).rows[0].id;
  const account = (await admin.query(
    `INSERT INTO gmail_accounts(organization_id,user_id,email,google_sub,access_token_enc,scope,is_default)
     VALUES($1,$2,'vendeur@example.com','sub-relance','jeton','openid email',true) RETURNING id`,
    [orgA, userA]
  )).rows[0].id;
  const oldMail = (await admin.query(
    `INSERT INTO gmail_synced_messages(
       organization_id,gmail_account_id,owner_user_id,gmail_message_id,gmail_thread_id,direction,from_email,to_emails,subject,snippet,body_text,internal_date
     ) VALUES($1,$2,$3,'ancien','thread-devis','outbound','vendeur@example.com',ARRAY['ines.relance@example.com'],'Devis solaire','CORPS-SECRET','CORPS-SECRET',now()-interval '14 days')
     RETURNING id`,
    [orgA, account, userA]
  )).rows[0].id;
  await admin.query(
    `INSERT INTO gmail_synced_messages(
       organization_id,gmail_account_id,owner_user_id,gmail_message_id,gmail_thread_id,direction,from_email,to_emails,subject,internal_date
     ) VALUES($1,$2,$3,'recent','thread-recent','outbound','vendeur@example.com',ARRAY['ines.relance@example.com'],'Message récent',now()-interval '20 hours')`,
    [orgA, account, userA]
  );
  await admin.query(
    `INSERT INTO gmail_synced_message_contacts(organization_id,message_id,contact_id)
     SELECT organization_id,id,$2 FROM gmail_synced_messages WHERE gmail_account_id=$1`,
    [account, contact.data.id]
  );
  const late = await v('/followups', {method: 'POST', body: {contact_id: contact.data.id, subject: 'Appeler Inès', due_at: new Date(Date.now() - 36 * 3600000).toISOString()}});
  assert.equal(late.status, 201, JSON.stringify(late.data));

  const first = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  assert.equal(first.status, 200, JSON.stringify(first.data));
  const kinds = Object.fromEntries(first.data.items.map(item => [item.kind, item]));
  assert.ok(kinds.no_reply, 'e-mail sans réponse');
  assert.equal(kinds.no_reply.contact_id, contact.data.id);
  assert.match(kinds.no_reply.reason, /Devis solaire/);
  assert.match(kinds.no_reply.reason, /jours ouvrés/);
  assert.equal(kinds.inactive.contact_name, 'Samir Inactif');
  assert.match(kinds.inactive.reason, /45 jours|4[0-9] jours/);
  assert.equal(kinds.overdue.followup_id, late.data.id);
  assert.equal(kinds.overdue.priority_label, 'Haute');
  assert.equal(JSON.stringify(first.data).includes('CORPS-SECRET'), false);
  assert.equal(first.data.items.some(item => item.subject === 'Message récent'), false);
  assert.equal((await db.pool.query('SELECT * FROM followup_suggestions')).rowCount, 0, 'RLS : aucune ligne hors organisation');
  assert.equal((await v('/followup-suggestions/refresh', {method: 'POST', auth: secretB, body: {}})).data.total, 0);
  assert.equal((await v('/followup-suggestions', {auth: secretReader})).status, 200);
  assert.equal((await v('/followup-suggestions/' + kinds.no_reply.id, {method: 'PATCH', auth: secretReader, body: {action: 'ignore'}})).status, 403);
  assert.equal((await v('/followup-suggestions/' + kinds.no_reply.id, {method: 'PATCH', body: {action: 'send'}})).status, 400);
  const board = await v('/dashboard');
  assert.ok(board.data.suggestions.items.length >= 3);

  await admin.query(
    `INSERT INTO gmail_synced_messages(
       organization_id,gmail_account_id,owner_user_id,gmail_message_id,gmail_thread_id,direction,from_email,to_emails,subject,internal_date
     ) VALUES($1,$2,$3,'reponse','thread-devis','inbound','ines.relance@example.com',ARRAY['vendeur@example.com'],'Re: Devis solaire',now())`,
    [orgA, account, userA]
  );
  const replyId = (await admin.query(`SELECT id FROM gmail_synced_messages WHERE gmail_message_id='reponse'`)).rows[0].id;
  await admin.query('INSERT INTO gmail_synced_message_contacts(organization_id,message_id,contact_id) VALUES($1,$2,$3)', [orgA, replyId, contact.data.id]);
  const afterReply = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  assert.equal(afterReply.data.items.some(item => item.kind === 'no_reply'), false);
  const stored = (await admin.query(`SELECT status FROM followup_suggestions WHERE message_id=$1`, [oldMail])).rows[0];
  assert.equal(stored.status, 'done');
  const again = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  assert.equal(again.data.items.some(item => item.message_id === oldMail), false);

  await admin.query(`UPDATE contacts SET status='perdu' WHERE id=$1`, [quiet]);
  const afterStatus = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  assert.equal(afterStatus.data.items.some(item => item.contact_id === quiet), false);

  assert.equal((await v('/followup-suggestions/' + kinds.overdue.id, {method: 'PATCH', body: {action: 'ignore'}})).status, 200);
  const ignored = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  assert.equal(ignored.data.items.some(item => item.id === kinds.overdue.id), false);
  assert.equal((await v('/followups/' + late.data.id)).data.status, 'pending');

  const second = await v('/followups', {method: 'POST', body: {contact_id: contact.data.id, subject: 'Relance oubliée', due_at: new Date(Date.now() - 36 * 3600000).toISOString()}});
  assert.equal(second.status, 201, JSON.stringify(second.data));
  const withSecond = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  const overdue = withSecond.data.items.find(item => item.followup_id === second.data.id);
  assert.ok(overdue);
  assert.equal((await v('/followup-suggestions/' + overdue.id, {method: 'PATCH', body: {action: 'done'}})).status, 200);
  assert.equal((await v('/followups/' + second.data.id)).data.status, 'completed');
  const cleared = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  assert.equal(cleared.data.items.some(item => item.followup_id === second.data.id), false);

  const other = (await admin.query(
    `INSERT INTO gmail_synced_messages(
       organization_id,gmail_account_id,owner_user_id,gmail_message_id,gmail_thread_id,direction,from_email,to_emails,subject,internal_date
     ) VALUES($1,$2,$3,'autre','thread-autre','outbound','vendeur@example.com',ARRAY['ines.relance@example.com'],'Deuxième devis',now()-interval '14 days')
     RETURNING id`,
    [orgA, account, userA]
  )).rows[0].id;
  await admin.query('INSERT INTO gmail_synced_message_contacts(organization_id,message_id,contact_id) VALUES($1,$2,$3)', [orgA, other, contact.data.id]);
  const renewed = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  const next = renewed.data.items.find(item => item.kind === 'no_reply');
  assert.equal(next.message_id, other);
  assert.equal((await v('/followup-suggestions/' + next.id, {method: 'PATCH', body: {action: 'snooze', snooze_days: 7}})).status, 200);
  assert.equal((await v('/followup-suggestions')).data.items.some(item => item.id === next.id), false);
  await admin.query(`UPDATE followup_suggestions SET snooze_until = now() - interval '1 hour' WHERE id = $1`, [next.id]);
  const unsnoozed = await v('/followup-suggestions/refresh', {method: 'POST', body: {}});
  assert.equal(unsnoozed.data.items.some(item => item.message_id === other), true);

  const settings = await v('/organization');
  assert.equal(settings.data.followup_business_days, 5);
  assert.equal(settings.data.followup_inactive_days, 30);
  assert.equal((await v('/followup-settings', {method: 'PATCH', body: {no_reply_business_days: 0}})).status, 400);
  assert.equal((await v('/followup-settings', {method: 'PATCH', auth: secretReader, body: {inactive_days: 40}})).status, 403);
  assert.equal((await v('/followup-settings', {method: 'PATCH', body: {inactive_days: 45}})).data.inactive_days, 45);
});
