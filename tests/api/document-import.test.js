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
  extractDocument,
  publicProviderError,
  estimateCostUsd,
  countPdfPages,
  parseDataUrlOrBase64
} = require('../../lib/document-ai');

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);

let admin, db, server, base, rootPool, testDb, orgA, orgB, userA, userB, secretA, secretB, openaiCalls, openaiImpl;

function mockOpenAI(payload) {
  return async (url, options) => {
    openaiCalls.push({
      url: String(url),
      body: JSON.parse(options.body),
      authorization: String(options.headers?.authorization || '')
    });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          output_text: JSON.stringify(payload),
          usage: {input_tokens: 1000, output_tokens: 200, input_tokens_details: {cached_tokens: 0}}
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
  const rich = cleanContact({
    name: 'Lina Ben Ali',
    phone: '+216 98',
    phone_work: '+216 71',
    emails: ['lina@example.com'],
    uncertain: ['phone', 'inventé']
  });
  assert.equal(rich.phone_work, '+216 71');
  assert.deepEqual(rich.uncertain, ['phone']);
  assert.match(publicProviderError({message: 'API key not valid. Please pass a valid API key.', providerStatus: 400}).message, /authentification/);
  assert.doesNotMatch(publicProviderError({message: 'API key not valid AIzaSySECRETKEY1234567890'}).message, /AIza|API key/i);
  assert.match(publicProviderError({code: 'quota', providerStatus: 429}).message, /quota/);
  assert.match(publicProviderError({code: 'network'}).message, /injoignable/);
  assert.match(publicProviderError({code: 'timeout'}).message, /photo est conservée/);
  assert.equal(publicProviderError({status: 400, message: 'Image JPEG invalide.'}).status, 400);
  assert.match(publicProviderError({providerStatus: 503, message: 'This model is currently experiencing high demand.'}).message, /photo est conservée/);
  const namedOnly = normalizeExtraction({companies: [], contacts: [{name: 'Amina Ben Salah', company_name: 'CarboScan', emails: []}]});
  assert.equal(namedOnly.companies.length, 1);
  assert.equal(namedOnly.companies[0].name, 'CarboScan');
  assert.equal(namedOnly.companies[0].email, '');
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
  openaiCalls = [];
  openaiImpl = mockOpenAI({
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
  });
  server = (await createApp(db, {
    appUrl: 'http://localhost',
    authRateLimit: false,
    disableGmailSyncLoop: true,
    openaiApiKey: 'test-key',
    openaiOcrModel: 'gpt-5.4-mini',
    documentAiFetch: (url, options) => openaiImpl(url, options),
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
  assert.match(status.data.notice, /OpenAI/);
  assert.doesNotMatch(status.data.notice, /Gemini|Google/);
  assert.equal(status.data.maxPages, 5);
  assert.equal(status.data.quotas.dailyLimit, 20);
  assert.equal((await v('/documents/extract', {
    method: 'POST',
    body: {mime_type: 'image/png', data: png.toString('base64'), external_processing_consent: false}
  })).status, 400);
});

test('saturation OpenAI : un second essai du même modèle, sans Gemini', async () => {
  const calls = [];
  const payload = {companies: [], contacts: [{name: 'Amina Ben Salah', job_title: 'Directrice', department: null, phone: null, phone_work: null, whatsapp: null, emails: ['amina@example.com'], company_name: 'CarboScan', uncertain: []}]};
  const fetchImpl = async (url, options) => {
    calls.push({url: String(url), model: JSON.parse(options.body).model});
    if (calls.length === 1) return {ok: false, status: 503, async json() { return {error: {message: 'high demand', code: 'server_error'}}; }};
    return {ok: true, status: 200, async json() { return {output_text: JSON.stringify(payload), usage: {input_tokens: 10, output_tokens: 10}}; }};
  };
  const result = await extractDocument({
    config: {openaiApiKey: 'test-key-not-real', openaiOcrModel: 'gpt-5.4-mini'},
    mimeType: 'image/png',
    data: png.toString('base64'),
    fetchImpl
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[1].url, calls[0].url);
  assert.equal(calls[0].model, 'gpt-5.4-mini');
  assert.equal(calls[1].model, 'gpt-5.4-mini');
  assert.equal(result.meta.model, 'gpt-5.4-mini');
  assert.equal(result.contacts[0].name, 'Amina Ben Salah');
  assert.equal(result.companies[0].name, 'CarboScan');
  assert.equal(result.companies[0].phone, '');
  assert.doesNotMatch(JSON.stringify(calls), /generativelanguage|gemini/i);
});

test('Extraction mockée, quotas et création après confirmation seulement', async () => {
  openaiCalls.length = 0;
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
  assert.equal(openaiCalls.length, 1);
  assert.equal(openaiCalls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(openaiCalls[0].body.model, 'gpt-5.4-mini');
  assert.equal(openaiCalls[0].body.store, false);
  assert.equal(openaiCalls[0].body.text.format.strict, true);
  assert.equal(openaiCalls[0].body.text.format.type, 'json_schema');
  assert.equal(openaiCalls[0].body.input[0].content.find(part => part.type === 'input_image').detail, 'high');
  assert.match(openaiCalls[0].authorization, /^Bearer /);
  assert.doesNotMatch(openaiCalls[0].url, /test-key|sk-/);
  assert.equal(extract.data.meta.model, 'gpt-5.4-mini');
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

test('Carte nouvelle entreprise, association, doublon e-mail et image illisible', async () => {
  const stamp = crypto.randomBytes(4).toString('hex');
  const companyName = 'Scan ' + stamp;
  const email = 'scan-' + stamp + '@example.com';
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const created = await v('/documents/import', {
    method: 'POST',
    body: {
      companies: [{selected: true, action: 'create', name: companyName, city: 'Tunis', address: '12 rue du Scan', phone: '+216 71 111 111', website: 'scan.example'}],
      contacts: [{
        selected: true, action: 'create', name: 'Nadia ' + stamp, job_title: 'Directrice',
        phone: '+216 98 111 111', phone_work: '+216 71 222 222', emails: [email],
        company_name: companyName, source: 'Carte de visite',
        card_mime_type: 'image/jpeg', card_data: jpeg.toString('base64')
      }]
    }
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.created.contacts[0].company_id, created.data.created.companies[0].id);
  assert.equal(created.data.created.contacts[0].phone_work, '+216 71 222 222');
  assert.equal(created.data.created.contacts[0].source, 'Carte de visite');
  const image = await admin.query('SELECT mime_type, octet_length(data) AS n FROM contact_card_images WHERE contact_id=$1', [created.data.created.contacts[0].id]);
  assert.equal(image.rowCount, 0);

  const beforeCompanies = await admin.query('SELECT count(*)::int AS n FROM companies WHERE organization_id=$1 AND name=$2', [orgA, companyName]);
  const linked = await v('/documents/import', {
    method: 'POST',
    body: {
      companies: [{selected: true, action: 'link', id: created.data.created.companies[0].id, name: companyName}],
      contacts: [{selected: true, action: 'create', name: 'Karim ' + stamp, emails: ['karim-' + stamp + '@example.com'], company_name: companyName, phone_work: '+216 71 333 333'}]
    }
  });
  assert.equal(linked.status, 200, JSON.stringify(linked.data));
  assert.equal(linked.data.created.companies.length, 0);
  assert.equal(linked.data.linked.companies.length, 1);
  assert.equal(linked.data.created.contacts[0].company_id, created.data.created.companies[0].id);
  const afterCompanies = await admin.query('SELECT count(*)::int AS n FROM companies WHERE organization_id=$1 AND name=$2', [orgA, companyName]);
  assert.equal(afterCompanies.rows[0].n, beforeCompanies.rows[0].n);

  const orphan = 'Orpheline ' + stamp;
  const duplicate = await v('/documents/import', {
    method: 'POST',
    body: {
      companies: [{selected: true, action: 'create', name: orphan}],
      contacts: [{selected: true, action: 'create', name: 'Doublon ' + stamp, emails: [email], company_name: orphan}]
    }
  });
  assert.equal(duplicate.status, 409);
  assert.match(duplicate.data.message, /Aucune fiche/);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM companies WHERE organization_id=$1 AND name=$2', [orgA, orphan])).rows[0].n, 0);

  const companiesBefore = (await admin.query('SELECT count(*)::int AS n FROM companies WHERE organization_id=$1', [orgA])).rows[0].n;
  const bad = await v('/documents/extract', {
    method: 'POST',
    body: {mime_type: 'image/jpeg', data: Buffer.from('pas-une-image').toString('base64'), external_processing_consent: true}
  });
  assert.equal(bad.status, 400);
  assert.match(bad.data.message, /JPEG|Aucune fiche/);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM companies WHERE organization_id=$1', [orgA])).rows[0].n, companiesBefore);

  const previous = openaiImpl;
  openaiImpl = async () => ({ok: false, status: 401, async json() { return {error: {message: 'Incorrect API key provided: sk-testsecretvalue. ', code: 'invalid_api_key', type: 'authentication_error'}}; }});
  try {
    const down = await v('/documents/extract', {
      method: 'POST',
      body: {mime_type: 'image/png', data: png.toString('base64'), external_processing_consent: true}
    });
    assert.equal(down.status, 503);
    assert.match(down.data.message, /authentification/);
    assert.match(down.data.message, /Aucune fiche/);
    assert.doesNotMatch(JSON.stringify(down.data), /API key|sk-|AIza/i);
    const logged = await admin.query("SELECT error_code FROM document_extractions WHERE organization_id=$1 AND error_code='auth'", [orgA]);
    assert.equal(logged.rows.length, 1);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM companies WHERE organization_id=$1', [orgA])).rows[0].n, companiesBefore);
  } finally {
    openaiImpl = previous;
  }
});
