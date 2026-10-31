require('dotenv').config({quiet:true});
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {Pool} = require('pg');
const {spawnSync} = require('node:child_process');
const {createDatabase} = require('../../lib/db');
const {createApp} = require('../../server');
const {fixtureSession} = require('../session-fixture.cjs');
const {
  normalizeExtraction,
  cleanContact,
  estimateCostUsd,
  countPdfPages,
  parseDataUrlOrBase64
} = require('../../lib/document-ai');

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);

let admin, db, server, base, rootPool, testDb, orgA, orgB, userA, userB, secretA, secretB, geminiCalls;

function mockGemini(payload) {
  return async (url, options) => {
    geminiCalls.push({url: String(url), body: JSON.parse(options.body)});
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          candidates: [{content: {parts: [{text: JSON.stringify(payload)}]}}],
          usageMetadata: {promptTokenCount: 1000, candidatesTokenCount: 200}
        };
      }
    };
  };
}

async function request(path, {method = 'GET', body, auth = secretA, headers = {}} = {}) {
  const response = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      ...(auth ? {authorization: 'Bearer ' + auth} : {}),
      ...(body !== undefined ? {'content-type': 'application/json'} : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data;
  try { data = await response.json(); } catch {}
  return {status: response.status, data};
}
const v = (path, opts) => request('/api/v1' + path, opts);

test('Normalisation : entreprise seule, contact personne, coût estimé', () => {
  const out = normalizeExtraction({
    companies: [{name: 'Atelier Vert', sector: '', city: 'Tunis', description: '', address: '', phone: '', email: '', website: ''}],
    contacts: [
      {name: 'MarqueSeule', job_title: '', phone: '', emails: [], company_name: ''},
      {name: 'Inès Ben Ali', job_title: 'Directrice', phone: '+216 00', emails:['ines@example.com'], company_name: 'Atelier Vert'}
    ]
  });
  assert.equal(out.companies.length, 1);
  assert.equal(out.contacts.length, 2);
  assert.equal(out.contacts[0].name, 'MarqueSeule');
  assert.equal(out.contacts[1].name, 'Inès Ben Ali');
  assert.equal(cleanContact({name: 'Solo', emails: [], phone: ''}).name, 'Solo');
  assert.equal(cleanContact({name: '', emails: []}), null);
  assert.ok(estimateCostUsd(1_000_000, 0) > 0);
  assert.equal(countPdfPages(Buffer.from('%PDF-1.4 /Type /Page /Type /Page')), 2);
  assert.throws(() => parseDataUrlOrBase64('application/pdf', '%%%'), e => e.status === 400);
});

before(async () => {
  assert.ok(process.env.MIGRATION_DATABASE_URL, 'Configurez la base locale avant les tests.');
  assert.ok(process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32);
  const rootUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  rootPool = new Pool({connectionString: rootUrl.toString()});
  testDb = 'ciblix_doc_' + crypto.randomBytes(6).toString('hex');
  await rootPool.query('CREATE DATABASE ' + testDb);
  rootUrl.pathname = '/' + testDb;
  const migration = rootUrl.toString();
  const result = spawnSync(process.execPath, ['scripts/migrate.js'], {
    env: {...process.env, MIGRATION_DATABASE_URL: migration},
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  admin = new Pool({connectionString: migration});
  const appUrl = new URL(process.env.DATABASE_URL);
  appUrl.pathname = '/' + testDb;
  db = createDatabase(appUrl.toString());
  await db.verify();
  orgA = (await admin.query("INSERT INTO organizations(name) VALUES('Organisation A') RETURNING id")).rows[0].id;
  orgB = (await admin.query("INSERT INTO organizations(name) VALUES('Organisation B') RETURNING id")).rows[0].id;
  userA = (await admin.query("INSERT INTO users(google_sub,email,name,email_verified) VALUES('doc-a','doc-a@example.com','Admin A',true) RETURNING id")).rows[0].id;
  userB = (await admin.query("INSERT INTO users(google_sub,email,name,email_verified) VALUES('doc-b','doc-b@example.com','Admin B',true) RETURNING id")).rows[0].id;
  await admin.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'admin'),($3,$4,'admin')", [orgA, userA, orgB, userB]);
  ({secret: secretA} = await fixtureSession(admin, userA, orgA, process.env.BETTER_AUTH_SECRET));
  ({secret: secretB} = await fixtureSession(admin, userB, orgB, process.env.BETTER_AUTH_SECRET));
  geminiCalls = [];
  server = (await createApp(db, {
    appUrl: 'http://localhost',
    authRateLimit: false,
    disableGmailSyncLoop: true,
    documentAiApiKey: 'test-key',
    documentAiModel: 'gemini-2.5-flash',
    documentAiFetch: mockGemini({
      companies: [{
        name: 'Atelier Document',
        sector: 'Conseil',
        city: 'Tunis',
        description: 'Bureau',
        address: '1 rue Test',
        phone: '+216 71 000 000',
        email: 'contact@atelier.example',
        website: 'https://atelier.example'
      }],
      contacts: [{
        name: 'Sara Trabelsi',
        job_title: 'Associée',
        phone: '+216 98 000 000',
        emails: ['sara@atelier.example'],
        company_name: 'Atelier Document'
      }]
    }),
    mailer: {configured: true, send: async () => {}}
  })).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});

after(async () => {
  if (server) await new Promise(r => server.close(r));
  if (db) await db.pool.end();
  if (admin) await admin.end();
  if (rootPool) {
    if (testDb) await rootPool.query('DROP DATABASE ' + testDb);
    await rootPool.end();
  }
});

test('Statut d’importation et refus sans consentement', async () => {
  const status = await v('/documents/import-status');
  assert.equal(status.status, 200, JSON.stringify(status.data));
  assert.equal(status.data.configured, true);
  assert.equal(status.data.maxPages, 5);
  assert.equal(status.data.quotas.dailyLimit, 20);
  assert.equal((await v('/documents/extract', {
    method: 'POST',
    body: {mime_type: 'image/png', data: png.toString('base64'), external_processing_consent: false}
  })).status, 400);
});

test('Extraction mockée, quotas et création après confirmation seulement', async () => {
  geminiCalls.length = 0;
  const before = await admin.query("SELECT count(*)::int AS n FROM companies WHERE organization_id=$1", [orgA]);
  const extract = await v('/documents/extract', {
    method: 'POST',
    body: {
      mime_type: 'image/png',
      data: png.toString('base64'),
      external_processing_consent: true
    }
  });
  assert.equal(extract.status, 200, JSON.stringify(extract.data));
  assert.equal(geminiCalls.length, 1);
  assert.match(geminiCalls[0].url, /generativelanguage\.googleapis\.com/);
  assert.equal(extract.data.companies[0].name, 'Atelier Document');
  assert.equal(extract.data.contacts[0].name, 'Sara Trabelsi');
  const afterExtract = await admin.query("SELECT count(*)::int AS n FROM companies WHERE organization_id=$1", [orgA]);
  assert.equal(afterExtract.rows[0].n, before.rows[0].n, 'Aucune fiche créée à l’extraction');
  const logs = await admin.query("SELECT status, mime_type FROM document_extractions WHERE organization_id=$1", [orgA]);
  assert.equal(logs.rows[0].status, 'ok');
  assert.equal(logs.rows[0].mime_type, 'image/png');

  const empty = await v('/documents/import', {method: 'POST', body: {companies: [], contacts: []}});
  assert.equal(empty.status, 400);

  const saved = await v('/documents/import', {
    method: 'POST',
    body: {
      companies: [{
        selected: true,
        action: 'create',
        name: 'Atelier Document',
        sector: 'Conseil',
        city: 'Tunis',
        description: 'Bureau',
        address: '1 rue Test',
        phone: '+216 71 000 000',
        email: 'contact@atelier.example',
        website: 'atelier.example'
      }],
      contacts: [{
        selected: true,
        action: 'create',
        name: 'Sara Trabelsi',
        job_title: 'Associée',
        phone: '+216 98 000 000',
        emails: ['sara@atelier.example'],
        company_name: 'Atelier Document'
      }]
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.created.companies.length, 1);
  assert.equal(saved.data.created.contacts.length, 1);
  assert.equal(saved.data.created.companies[0].email, 'contact@atelier.example');
  assert.match(saved.data.created.companies[0].website, /^https:\/\//);
  assert.equal(saved.data.created.contacts[0].company_id, saved.data.created.companies[0].id);
  const emails = await admin.query('SELECT email FROM contact_emails WHERE contact_id=$1', [saved.data.created.contacts[0].id]);
  assert.deepEqual(emails.rows.map(r => r.email), ['sara@atelier.example']);
});

test('Champs entreprise CRUD et isolation entre organisations', async () => {
  const created = await v('/companies', {
    method: 'POST',
    body: {
      name: 'Société Coordonnées',
      address: '12 avenue Habib',
      phone: '+216 70 111 111',
      email: 'hello@coords.example',
      website: 'https://coords.example'
    }
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.address, '12 avenue Habib');
  const patched = await v('/companies/' + created.data.id, {
    method: 'PATCH',
    body: {website: 'coords.example/path', description: 'x'.repeat(4000)}
  });
  assert.equal(patched.status, 200, JSON.stringify(patched.data));
  assert.match(patched.data.website, /^https:\/\/coords\.example\/path/);
  assert.equal(patched.data.description.length, 4000);
  assert.equal((await v('/companies/' + created.data.id, {auth: secretB})).status, 404);
  assert.equal((await v('/documents/import-status', {auth: secretB})).status, 200);
});

test('Fiches enrichies : champs facultatifs entreprise et contact', async () => {
  const company = await v('/companies', {
    method: 'POST',
    body: {
      name: 'CRM Form Société',
      relation_type: 'prospect',
      country: 'Tunisie',
      source: 'Prospection',
      status: 'en cours',
      company_size: '11-50',
      linkedin: 'https://linkedin.com/company/crm-form',
      socials: 'Instagram @crm'
    }
  });
  assert.equal(company.status, 201, JSON.stringify(company.data));
  assert.equal(company.data.relation_type, 'prospect');
  assert.equal(company.data.company_size, '11-50');
  const contact = await v('/contacts', {
    method: 'POST',
    body: {
      name: 'Amira Ben Salah',
      company_id: company.data.id,
      department: 'Achats',
      phone: '+216 98 000 001',
      phone_work: '+216 71 000 001',
      whatsapp: '+216 98 000 001',
      status: 'à organiser',
      emails: ['amira.pro@example.com', 'amira.perso@example.com']
    }
  });
  assert.equal(contact.status, 201, JSON.stringify(contact.data));
  assert.equal(contact.data.department, 'Achats');
  assert.equal(contact.data.phone_work, '+216 71 000 001');
  assert.equal(contact.data.whatsapp, '+216 98 000 001');
  const namedOnly = await v('/companies', {method: 'POST', body: {name: 'Seulement Un Nom'}});
  assert.equal(namedOnly.status, 201, JSON.stringify(namedOnly.data));
  assert.equal(namedOnly.data.phone, '');
  assert.equal(namedOnly.data.relation_type, '');
});

test('Import partiel : nom seul suffit pour entreprise et contact', async () => {
  const saved = await v('/documents/import', {
    method: 'POST',
    body: {
      companies: [{selected: true, action: 'create', name: 'Société Minimale', sector: '', city: '', description: '', address: '', phone: '', email: '', website: ''}],
      contacts: [{selected: true, action: 'create', name: 'Personne Seule', job_title: '', phone: '', emails: [], company_name: 'Société Minimale'}]
    }
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.created.companies[0].name, 'Société Minimale');
  assert.equal(saved.data.created.companies[0].phone, '');
  assert.equal(saved.data.created.contacts[0].name, 'Personne Seule');
  assert.equal(saved.data.created.contacts[0].company_id, saved.data.created.companies[0].id);
  const again = await v('/documents/import', {
    method: 'POST',
    body: {companies: [{selected: true, action: 'create', name: 'Société Minimale'}], contacts: []}
  });
  assert.equal(again.status, 409);
});

test('document_extractions isolé par RLS', async () => {
  assert.equal((await db.pool.query('SELECT * FROM document_extractions')).rowCount, 0);
  await db.tenant(orgA, async c => {
    assert.ok((await c.query('SELECT * FROM document_extractions')).rowCount >= 1);
  });
  await db.tenant(orgB, async c => {
    assert.equal((await c.query('SELECT * FROM document_extractions')).rowCount, 0);
  });
});
