require('dotenv').config({quiet:true});
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Pool} = require('pg');
const {spawnSync} = require('node:child_process');
const {createDatabase} = require('../../lib/db');
const {createApp} = require('../../server');
const {SEND_SCOPE, READ_SCOPE} = require('../../lib/gmail');
const {encrypt} = require('../../lib/gmail-crypto');
const {fixtureSession} = require('../session-fixture.cjs');

const SCOPE_FULL = 'openid email ' + SEND_SCOPE + ' ' + READ_SCOPE;
const calls = {exchange: []};
const gmailGoogle = {
  authorizationUrl({state, codeChallenge}) {
    return 'https://accounts.google.com/o/oauth2/v2/auth?state=' + encodeURIComponent(state) + '&code_challenge=' + encodeURIComponent(codeChallenge);
  },
  async exchange({code, codeVerifier}) {
    calls.exchange.push({code, codeVerifier});
    return {
      access_token: 'access-' + code,
      refresh_token: 'refresh-' + code,
      expires_in: 3600,
      scope: SCOPE_FULL,
      email: code === 'member' ? 'membre-gmail@gmail.com' : 'admin-gmail@gmail.com',
      sub: 'sub-' + code
    };
  },
  async refresh() { return {access_token: 'access-renewed', expires_in: 3600}; },
  async revoke() {},
  async send() { return {id: 'gmail-sent-1'}; }
};

const mailbox = new Map();
function seedMessage({id, threadId, from, to, cc = '', subject, body, date, messageId, labels = ['INBOX']}) {
  mailbox.set(id, {
    id,
    threadId: threadId || 'thread-' + id,
    labelIds: labels,
    snippet: body.slice(0, 80),
    internalDate: String(date.getTime()),
    payload: {
      mimeType: 'text/plain',
      headers: [
        {name: 'From', value: from},
        {name: 'To', value: to},
        ...(cc ? [{name: 'Cc', value: cc}] : []),
        {name: 'Subject', value: subject},
        {name: 'Message-ID', value: messageId}
      ],
      body: {data: Buffer.from(body, 'utf8').toString('base64url')}
    }
  });
}

let admin, db, server, base, rootPool, testDb, orgA, orgB, userA, userB, memberA, secretA, secretB, secretMember, contactA, companyA, realFetch;

async function request(path, {method = 'GET', body, auth = secretA, cookie = false, headers = {}} = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(auth ? cookie ? {cookie: 'ciblix.session_token=' + auth} : {authorization: 'Bearer ' + auth} : {}),
      ...(body !== undefined ? {'content-type': 'application/json'} : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data;
  try { data = await response.json(); } catch {}
  return {status: response.status, data, headers: response.headers};
}
const v = (path, opts) => request('/api/v1' + path, opts);

async function connect(code, auth = secretA) {
  const start = await v('/gmail/connect', {method: 'POST', auth, body: {share_consent: true}});
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const state = new URL(start.data.url).searchParams.get('state');
  const callback = await v('/gmail/callback?code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state), {auth, cookie: true});
  return {start, state, callback};
}

before(async () => {
  assert.ok(process.env.MIGRATION_DATABASE_URL, 'Configurez la base locale avant les tests.');
  assert.ok(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32);
  const rootUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  rootPool = new Pool({connectionString: rootUrl.toString()});
  testDb = 'ciblix_gsync_' + crypto.randomBytes(6).toString('hex');
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
  orgA = (await admin.query("INSERT INTO organizations(name) VALUES('Org Sync A') RETURNING id")).rows[0].id;
  orgB = (await admin.query("INSERT INTO organizations(name) VALUES('Org Sync B') RETURNING id")).rows[0].id;
  const addUser = async (sub, address, name) => (await admin.query('INSERT INTO users(google_sub,email,name,email_verified) VALUES($1,$2,$3,true) RETURNING id', [sub, address, name])).rows[0].id;
  userA = await addUser('gsync-a', 'admin-sync@example.com', 'Admin Sync');
  userB = await addUser('gsync-b', 'admin-b-sync@example.com', 'Admin B Sync');
  memberA = await addUser('gsync-m', 'membre-sync@example.com', 'Membre Sync');
  await admin.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'admin'),($3,$4,'admin'),($1,$5,'member')", [orgA, userA, orgB, userB, memberA]);
  ({secret: secretA} = await fixtureSession(admin, userA, orgA, process.env.BETTER_AUTH_SECRET));
  ({secret: secretB} = await fixtureSession(admin, userB, orgB, process.env.BETTER_AUTH_SECRET));
  ({secret: secretMember} = await fixtureSession(admin, memberA, orgA, process.env.BETTER_AUTH_SECRET));

  server = (await createApp(db, {
    appUrl: 'http://localhost',
    authRateLimit: false,
    disableGmailSyncLoop: true,
    googleClientId: 'better-auth-client',
    googleClientSecret: 'better-auth-secret-value',
    gmailClientId: 'gmail-client',
    gmailClientSecret: 'gmail-secret-value',
    gmailRedirectUri: 'https://ciblix.com/api/v1/gmail/callback',
    gmailGoogle,
    mailer: {configured: true, send: async () => {}}
  })).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;

  realFetch = global.fetch;
  global.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith(base)) return realFetch(input, init);
    if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/')) {
      const parsed = new URL(url);
      const path = parsed.pathname.replace('/gmail/v1/users/me/', '');
      if (path === 'messages') {
        const ids = [...mailbox.keys()].map(id => ({id, threadId: mailbox.get(id).threadId}));
        return new Response(JSON.stringify({messages: ids, resultSizeEstimate: ids.length}), {status: 200, headers: {'content-type': 'application/json'}});
      }
      if (path.startsWith('messages/')) {
        const id = decodeURIComponent(path.slice('messages/'.length));
        const msg = mailbox.get(id);
        if (!msg) return new Response(JSON.stringify({error: {status: 'NOT_FOUND'}}), {status: 404});
        return new Response(JSON.stringify(msg), {status: 200, headers: {'content-type': 'application/json'}});
      }
      if (path === 'profile') {
        return new Response(JSON.stringify({emailAddress: 'admin-gmail@gmail.com', historyId: 'hist-1'}), {status: 200, headers: {'content-type': 'application/json'}});
      }
      if (path === 'history') {
        return new Response(JSON.stringify({history: [], historyId: 'hist-2'}), {status: 200, headers: {'content-type': 'application/json'}});
      }
      return new Response(JSON.stringify({error: {status: 'NOT_FOUND'}}), {status: 404});
    }
    return realFetch(input, init);
  };

  companyA = (await v('/companies', {method: 'POST', body: {name: 'Client Sync'}})).data.id;
  contactA = (await v('/contacts', {method: 'POST', body: {name: 'Inès Sync', company_id: companyA, emails: ['ines.sync@example.com']}})).data.id;
  await v('/contacts', {method: 'POST', auth: secretB, body: {name: 'Autre Org', emails: ['autre@example.com']}});

  const now = Date.now();
  seedMessage({
    id: 'm1',
    from: 'ines.sync@example.com',
    to: 'admin-gmail@gmail.com',
    subject: 'Devis solaire',
    body: 'Bonjour, voici le devis.',
    date: new Date(now - 86400000),
    messageId: '<deal-1@example.com>'
  });
  seedMessage({
    id: 'm2',
    from: 'admin-gmail@gmail.com',
    to: 'ines.sync@example.com',
    subject: 'Re: Devis solaire',
    body: 'Merci, je reviens vers vous.',
    date: new Date(now - 3600000),
    messageId: '<deal-2@example.com>',
    labels: ['SENT']
  });
  seedMessage({
    id: 'm3',
    from: 'perso@example.com',
    to: 'admin-gmail@gmail.com',
    subject: 'Message personnel',
    body: 'Hors CRM',
    date: new Date(now - 7200000),
    messageId: '<perso@example.com>'
  });
  seedMessage({
    id: 'm4',
    from: 'ines.sync@example.com',
    to: 'membre-gmail@gmail.com',
    subject: 'Devis solaire',
    body: 'Copie dans une autre boîte.',
    date: new Date(now - 80000000),
    messageId: '<deal-1@example.com>'
  });
});

after(async () => {
  if (realFetch) global.fetch = realFetch;
  if (server) await new Promise(r => server.close(r));
  if (db) await db.pool.end();
  if (admin) await admin.end();
  if (rootPool) {
    if (testDb) await rootPool.query('DROP DATABASE ' + testDb);
    await rootPool.end();
  }
});

test('Consentement obligatoire et synchro CRM partagée dans l’organisation', async () => {
  assert.equal((await v('/gmail/connect', {method: 'POST', body: {}})).status, 400);
  const connected = await connect('admin');
  assert.match(connected.callback.headers.get('location'), /etat=connecte/);
  const accounts = await v('/gmail/accounts');
  assert.equal(accounts.data.accounts.length, 1);
  assert.equal(accounts.data.mine.length, 1);
  assert.ok(accounts.data.consentNotice);
  assert.equal(accounts.data.accounts[0].canSync, true);
  const memberView = await v('/gmail/accounts', {auth: secretMember});
  assert.equal(memberView.data.accounts.length, 1);
  assert.equal(memberView.data.mine.length, 0);
  assert.equal(memberView.data.accounts[0].email, 'admin-gmail@gmail.com');

  const accountId = accounts.data.accounts[0].id;
  const sync = await v('/gmail/accounts/' + accountId + '/sync', {method: 'POST', body: {full: true}});
  assert.equal(sync.status, 200, JSON.stringify(sync.data));
  assert.ok(sync.data.imported >= 2);
  assert.ok(sync.data.skipped >= 1);

  const contactEmails = await v('/contacts/' + contactA + '/emails');
  assert.equal(contactEmails.status, 200);
  assert.ok(contactEmails.data.total >= 2);
  assert.ok(contactEmails.data.items.every(item => item.subject.includes('Devis') || item.from_email.includes('ines')));

  const companyEmails = await v('/companies/' + companyA + '/emails');
  assert.ok(companyEmails.data.total >= 2);

  const memberEmails = await v('/contacts/' + contactA + '/emails', {auth: secretMember});
  assert.equal(memberEmails.status, 200);
  assert.equal(memberEmails.data.total, contactEmails.data.total);

  const detail = await v('/gmail/synced/' + contactEmails.data.items[0].id, {auth: secretMember});
  assert.equal(detail.status, 200);
  assert.ok(detail.data.body || detail.data.snippet);
  assert.equal(detail.data.ownerUserId, userA);

  const foreign = await v('/contacts/' + contactA + '/emails', {auth: secretB});
  assert.equal(foreign.status, 404);

  const sendAsOther = await v('/gmail/messages', {
    method: 'POST',
    auth: secretMember,
    body: {
      account_id: accountId,
      contact_id: contactA,
      to: 'ines.sync@example.com',
      subject: 'Interdit',
      body: 'Non',
      idempotency_key: crypto.randomBytes(12).toString('hex')
    }
  });
  assert.equal(sendAsOther.status, 404);
});

test('Dédoublonnage Message-ID et purge à la déconnexion', async () => {
  const beforeTotal = (await v('/contacts/' + contactA + '/emails?q=Devis')).data.total;
  await connect('member', secretMember);
  const memberAccounts = await v('/gmail/accounts', {auth: secretMember});
  const memberAccount = memberAccounts.data.mine.find(a => a.email === 'membre-gmail@gmail.com');
  assert.ok(memberAccount);
  const sync = await v('/gmail/accounts/' + memberAccount.id + '/sync', {method: 'POST', auth: secretMember, body: {full: true}});
  assert.equal(sync.status, 200, JSON.stringify(sync.data));
  const emails = await v('/contacts/' + contactA + '/emails?q=Devis');
  const inbound = emails.data.items.filter(i => (i.subject || '').includes('Devis solaire') && i.direction === 'inbound');
  assert.equal(inbound.length, 1, 'le Message-ID partagé ne doit pas créer de doublon');
  assert.ok(emails.data.total >= beforeTotal);

  const adminAccountId = (await v('/gmail/accounts')).data.mine[0].id;
  const adminCountBefore = (await admin.query('SELECT count(*)::int AS n FROM gmail_synced_messages WHERE gmail_account_id=$1', [adminAccountId])).rows[0].n;
  assert.equal((await v('/gmail/accounts/' + memberAccount.id, {method: 'DELETE', auth: secretMember})).status, 204);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM gmail_synced_messages WHERE gmail_account_id=$1', [memberAccount.id])).rows[0].n, 0);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM gmail_synced_messages WHERE gmail_account_id=$1', [adminAccountId])).rows[0].n, adminCountBefore);
  assert.ok((await v('/contacts/' + contactA + '/emails')).data.total >= 2);
});

test('Compte sans lecture exige une reconnexion', async () => {
  const enc = encrypt(process.env.BETTER_AUTH_SECRET, 'access-send-only');
  const refresh = encrypt(process.env.BETTER_AUTH_SECRET, 'refresh-send-only');
  const {rows: [row]} = await admin.query(
    `INSERT INTO gmail_accounts(organization_id, user_id, email, google_sub, access_token_enc, refresh_token_enc, access_token_expires_at, scope, status, is_default, share_consent_at)
     VALUES($1,$2,'sendonly@gmail.com','sub-sendonly',$3,$4,now()+interval '1 hour',$5,'active',false,now())
     RETURNING id`,
    [orgA, userA, enc, refresh, SEND_SCOPE]
  );
  const sync = await v('/gmail/accounts/' + row.id + '/sync', {method: 'POST', body: {}});
  assert.equal(sync.status, 409);
  const status = (await admin.query('SELECT sync_status FROM gmail_accounts WHERE id=$1', [row.id])).rows[0].sync_status;
  assert.equal(status, 'needs_reauth');
});
