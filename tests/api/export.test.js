require('dotenv').config({quiet:true});
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const {Pool} = require('pg');
const {spawnSync} = require('node:child_process');
const {createDatabase} = require('../../lib/db');
const {createApp} = require('../../server');
const {buildArchive} = require('../../lib/export');
const {readZip} = require('../../lib/zip');
const {fixtureSession} = require('../session-fixture.cjs');

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const secrets = ['access-token-DO-NOT-EXPORT', 'refresh-token-DO-NOT-EXPORT', 'verifier-DO-NOT-EXPORT', 'password-DO-NOT-EXPORT', 'session-token-DO-NOT-EXPORT', 'csrf-DO-NOT-EXPORT', 'invite-hash-DO-NOT-EXPORT'];
let admin, db, server, base, rootPool, testDb, orgA, orgB, orgEmpty, userA, userB, userEmpty, memberA, retiredAdmin, secretA, secretB, secretEmpty, secretMember, secretRetired;
const mails = [];

async function request(path, {method = 'GET', body, auth = secretA, headers = {}} = {}) {
  const response = await fetch(base + path, {method, redirect: 'manual', headers: {...(auth ? {authorization: 'Bearer ' + auth} : {}), ...(body !== undefined ? {'content-type': 'application/json'} : {}), ...headers}, body: body === undefined ? undefined : JSON.stringify(body)});
  const buffer = Buffer.from(await response.arrayBuffer());
  let data;
  try { data = JSON.parse(buffer.toString('utf8')); } catch { data = undefined; }
  return {status: response.status, data, buffer, headers: response.headers};
}
const v = (path, opts) => request('/api/v1' + path, opts);
async function addUser(sub, address, name) {
  return (await admin.query('INSERT INTO users(google_sub, email, name, email_verified) VALUES($1,$2,$3,true) RETURNING id', [sub, address, name])).rows[0].id;
}
async function addSession(user, org) { return fixtureSession(admin, user, org, process.env.BETTER_AUTH_SECRET); }
function archiveOf(response) {
  assert.equal(response.status, 200, response.buffer.toString('utf8').slice(0, 300));
  assert.match(response.headers.get('content-type'), /^application\/zip/);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="ciblix-donnees\.zip"/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const files = readZip(response.buffer);
  const manifest = JSON.parse(files['manifest.json'].toString('utf8'));
  assert.equal(manifest.format, 'ciblix-export');
  assert.equal(manifest.version, 1);
  assert.deepEqual(Object.keys(files).sort(), manifest.files.sort());
  const json = name => JSON.parse(files[name].toString('utf8'));
  return {files, manifest, json};
}
function assertNoSecrets(files) {
  const raw = Buffer.concat(Object.values(files));
  for (const secret of secrets) assert.equal(raw.includes(Buffer.from(secret)), false, secret);
  const banned = new Set(['password', 'access_token', 'access_token_enc', 'refresh_token', 'refresh_token_enc', 'id_token', 'verifier', 'verifier_enc', 'csrf_token', 'token_hash', 'google_sub']);
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(banned.has(key), false, key);
      walk(child);
    }
  };
  for (const [name, data] of Object.entries(files)) if (name.endsWith('.json')) walk(JSON.parse(data.toString('utf8')));
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
  orgEmpty = (await admin.query("INSERT INTO organizations(name) VALUES('Organisation vide') RETURNING id")).rows[0].id;
  userA = await addUser('export-a', 'admin-a@example.com', 'Admin A');
  userB = await addUser('export-b', 'admin-b@example.com', 'Admin B');
  userEmpty = await addUser('export-empty', 'admin-vide@example.com', 'Admin vide');
  memberA = await addUser('export-m', 'membre@example.com', 'Membre A');
  retiredAdmin = await addUser('export-retired', 'retire@example.com', 'Admin retiré');
  await admin.query("INSERT INTO memberships(organization_id, user_id, role) VALUES($1,$2,'admin'),($3,$4,'admin'),($5,$6,'admin'),($1,$7,'member'),($1,$8,'admin')", [orgA, userA, orgB, userB, orgEmpty, userEmpty, memberA, retiredAdmin]);
  ({secret: secretA} = await addSession(userA, orgA));
  ({secret: secretB} = await addSession(userB, orgB));
  ({secret: secretEmpty} = await addSession(userEmpty, orgEmpty));
  ({secret: secretMember} = await addSession(memberA, orgA));
  ({secret: secretRetired} = await addSession(retiredAdmin, orgA));
  await admin.query('UPDATE memberships SET active=false WHERE organization_id=$1 AND user_id=$2', [orgA, retiredAdmin]);
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

test('Export administrateur, relations, images, Gmail et absence de secrets', async () => {
  const company = await v('/companies', {method: 'POST', body: {name: 'Atelier A', sector: 'Conseil'}});
  assert.equal(company.status, 201, JSON.stringify(company.data));
  const contact = await v('/contacts', {method: 'POST', body: {name: 'Inès', company_id: company.data.id, phone: '+216 100', emails: ['INES@example.com']}});
  assert.equal(contact.status, 201);
  const note = await v('/notes', {method: 'POST', body: {contact_id: contact.data.id, body: 'Note partagée'}});
  assert.equal(note.status, 201);
  const followup = await v('/followups', {method: 'POST', body: {contact_id: contact.data.id, subject: 'Faire le point', due_at: '2026-11-02T10:00:00+01:00'}});
  assert.equal(followup.status, 201);
  const image = await v('/contacts/' + contact.data.id + '/card', {method: 'POST', body: {mime_type: 'image/png', data: png}});
  assert.equal(image.status, 201);
  const saved = await v('/organization', {method: 'PATCH', body: {name: 'Organisation A', logo: 'data:image/png;base64,' + png}});
  assert.equal(saved.status, 200);
  const account = (await admin.query(`INSERT INTO gmail_accounts(organization_id, user_id, email, google_sub, access_token_enc, refresh_token_enc, scope, is_default)
    VALUES($1,$2,'sender@example.com','gsub-export','access-token-DO-NOT-EXPORT','refresh-token-DO-NOT-EXPORT','https://www.googleapis.com/auth/gmail.send',true) RETURNING id`, [orgA, userA])).rows[0];
  await admin.query(`INSERT INTO gmail_messages(organization_id, user_id, gmail_account_id, contact_id, company_id, to_email, subject, body, gmail_message_id, status, idempotency_key)
    VALUES($1,$2,$3,$4,$5,'destinataire@example.com','Objet export','Corps du message A','gmail-id-a','sent','idempotency-export-0001')`, [orgA, userA, account.id, contact.data.id, company.data.id]);
  await admin.query("INSERT INTO gmail_oauth_states(state_hash, organization_id, user_id, verifier_enc, expires_at) VALUES('export-state',$1,$2,'verifier-DO-NOT-EXPORT',now()+interval '5 minutes')", [orgA, userA]);
  await admin.query("INSERT INTO auth_accounts(user_id, account_id, provider_id, password) VALUES($1,'export-cred','credential','password-DO-NOT-EXPORT')", [userA]);
  await admin.query("INSERT INTO auth_sessions(user_id, organization_id, token, csrf_token, expires_at) VALUES($1,$2,'session-token-DO-NOT-EXPORT','csrf-DO-NOT-EXPORT',now()+interval '1 hour')", [userA, orgA]);
  await admin.query("INSERT INTO invitations(organization_id, email, role, token_hash, expires_at) VALUES($1,'invite-secrete@example.com','member','invite-hash-DO-NOT-EXPORT',now()+interval '1 day')", [orgA]);
  await admin.query("INSERT INTO companies(organization_id, name) VALUES($1,'Société seulement B')", [orgB]);

  const response = await v('/organization/export');
  const {files, manifest, json} = archiveOf(response);
  assert.equal(manifest.organization_id, orgA);
  const organization = json('organization.json');
  const companies = json('companies.json');
  const contacts = json('contacts.json');
  const emails = json('contact-emails.json');
  const notes = json('notes.json');
  const followups = json('followups.json');
  const activities = json('activities.json');
  const accounts = json('gmail-accounts.json');
  const messages = json('gmail-messages.json');
  const images = json('images.json');
  assert.equal(organization.name, 'Organisation A');
  assert.equal(organization.profile.logo_file, 'files/logo.png');
  assert.equal(organization.profile.logo, undefined);
  assert.equal(companies.length, 1);
  assert.equal(companies[0].id, company.data.id);
  assert.equal(contacts[0].company_id, companies[0].id);
  assert.equal(contacts[0].phone, '+216 100');
  assert.equal(emails[0].contact_id, contacts[0].id);
  assert.equal(emails[0].email, 'ines@example.com');
  assert.equal(notes.find(item => item.id === note.data.id).contact_id, contacts[0].id);
  assert.equal(followups.find(item => item.id === followup.data.id).company_id, companies[0].id);
  assert.ok(activities.some(item => item.entity_id === companies[0].id && item.entity_type === 'companies'));
  assert.equal(accounts[0].email, 'sender@example.com');
  assert.equal(accounts[0].id, account.id);
  assert.equal(messages[0].gmail_account_id, account.id);
  assert.equal(messages[0].contact_id, contacts[0].id);
  assert.equal(messages[0].company_id, companies[0].id);
  assert.equal(messages[0].body, 'Corps du message A');
  assert.equal(images[0].contact_id, contacts[0].id);
  assert.equal(images[0].file, 'files/images/' + images[0].id + '.png');
  assert.ok(files[images[0].file].equals(Buffer.from(png, 'base64')));
  assert.ok(files['files/logo.png'].equals(Buffer.from(png, 'base64')));
  assert.equal(json('members.json').some(member => member.email === 'membre@example.com' && member.role === 'member'), true);
  assert.equal(Buffer.concat(Object.values(files)).includes('Société seulement B'), false);
  assert.equal(Buffer.concat(Object.values(files)).includes('admin-b@example.com'), false);
  assertNoSecrets(files);
  const broken = Buffer.from(response.buffer);
  const central = broken.readUInt32LE(broken.length - 6);
  broken[central + 16] ^= 0xff;
  assert.throws(() => readZip(broken), /intégrité/);
});

test('Membre, administrateur désactivé et autre organisation sont refusés ou isolés', async () => {
  assert.equal((await v('/organization/export', {auth: null})).status, 401);
  const member = await v('/organization/export', {auth: secretMember});
  assert.equal(member.status, 403);
  assert.equal(member.data.message, 'Cette action est réservée à un administrateur.');
  const retired = await v('/organization/export', {auth: secretRetired});
  assert.equal(retired.status, 403);
  assert.equal(retired.data.message, 'Votre accès à cette entreprise a été retiré.');
  const other = archiveOf(await v('/organization/export', {auth: secretB}));
  assert.equal(other.manifest.organization_id, orgB);
  assert.equal(other.json('companies.json')[0].name, 'Société seulement B');
  assert.equal(other.json('gmail-messages.json').length, 0);
  assert.equal(other.json('gmail-accounts.json').length, 0);
  assert.equal(other.json('contacts.json').length, 0);
  assert.equal(Buffer.concat(Object.values(other.files)).includes('Corps du message A'), false);
  assert.equal(Buffer.concat(Object.values(other.files)).includes('Atelier A'), false);
  assertNoSecrets(other.files);
});

test('Export vide et limite de volume', async () => {
  const empty = archiveOf(await v('/organization/export', {auth: secretEmpty}));
  assert.equal(empty.manifest.organization_id, orgEmpty);
  for (const name of ['companies.json', 'contacts.json', 'contact-emails.json', 'notes.json', 'followups.json', 'activities.json', 'gmail-accounts.json', 'gmail-messages.json', 'images.json']) assert.deepEqual(empty.json(name), []);
  assert.equal(empty.json('members.json').length, 1);
  assert.equal(empty.files['files/logo.png'], undefined);
  await assert.rejects(() => db.tenant(orgEmpty, client => buildArchive(client, orgEmpty, 40)), error => error.status === 413);
  const limited = (await createApp(db, {appUrl: 'http://localhost', authRateLimit: false, exportByteLimit: 40, mailer: {configured: true, send: async () => {}}})).listen(0, '127.0.0.1');
  try {
    await new Promise(resolve => limited.once('listening', resolve));
    const response = await fetch('http://127.0.0.1:' + limited.address().port + '/api/v1/organization/export', {headers: {authorization: 'Bearer ' + secretEmpty}});
    const body = await response.json();
    assert.equal(response.status, 413);
    assert.match(body.message, /taille autorisée/);
    assert.equal(response.headers.get('content-type')?.includes('application/zip'), false);
  } finally {
    await new Promise(resolve => limited.close(resolve));
  }
});

test('Le CSV des contacts reste accessible à un membre actif', async () => {
  const response = await fetch(base + '/api/v1/contacts/export', {headers: {authorization: 'Bearer ' + secretMember}});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  const csv = await response.text();
  assert.match(csv, /Inès/);
  assert.equal(csv.includes('Société seulement B'), false);
});

test('Better Auth et la création CRM restent disponibles', async () => {
  assert.equal((await request('/api/health', {auth: null})).data.authentication, 'Better Auth');
  const headers = {origin: 'http://localhost'};
  const signup = await request('/api/auth/sign-up/email', {method: 'POST', auth: null, headers, body: {name: 'Nouvel Export', email: 'export-auth@example.com', password: 'Une phrase solide 2026!', companyName: 'Société export'}});
  assert.equal(signup.status, 200, JSON.stringify(signup.data));
  const stored = (await admin.query("SELECT password FROM auth_accounts WHERE user_id=(SELECT id FROM users WHERE email='export-auth@example.com') AND provider_id='credential'")).rows[0].password;
  assert.notEqual(stored, 'Une phrase solide 2026!');
  assert.equal((await request('/api/auth/sign-in/email', {method: 'POST', auth: null, headers, body: {email: 'export-auth@example.com', password: 'Une phrase solide 2026!'}})).status, 403);
  assert.equal((await v('/companies', {method: 'POST', body: {name: 'Suite CRM'}})).status, 201);
});

test('L’interface décrit l’export et le serveur n’écrit pas l’archive', () => {
  const live = fs.readFileSync('public/live.js', 'utf8');
  assert.match(live, /Exporter mes données/);
  assert.match(live, /Exporter les données de votre espace/);
  assert.match(live, /Téléchargez une copie des données de votre CRM pour les conserver ou les transférer vers un autre outil\./);
  assert.match(live, /Télécharger mes données/);
  assert.match(live, /Cette action est réservée à un administrateur\./);
  assert.equal(fs.readFileSync('lib/export.js', 'utf8').includes('writeFile'), false);
  assert.equal(fs.readFileSync('lib/zip.js', 'utf8').includes('writeFile'), false);
});
