const {test} = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePhone,
  normalizeEmail,
  normalizeExtraction,
  assertExtractionShape,
  extractDocument,
  configured,
  estimateCostUsd
} = require('../../lib/document-ai');

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
).toString('base64');

function openaiOk(name) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        output_text: JSON.stringify({companies: [], contacts: [{name, emails: []}]}),
        usage: {input_tokens: 1000, output_tokens: 100, input_tokens_details: {cached_tokens: 200}}
      };
    }
  };
}

test('Téléphones complets normalisés, numéros incomplets conservés', () => {
  assert.equal(normalizePhone('+216 71 000 222').value, '+21671000222');
  assert.equal(normalizePhone('00216 20 111 334').value, '+21620111334');
  assert.equal(normalizePhone('06 18 20 30 40').value, '+33618203040');
  assert.equal(normalizePhone('01 42 00 10 20').value, '+33142001020');
  assert.equal(normalizePhone('+44 20 7946 0018').value, '+442079460018');
  assert.equal(normalizePhone('+216 71').value, '+216 71');
  assert.equal(normalizePhone('+216 71').uncertain, false);
  assert.equal(normalizePhone('').value, '');
  assert.equal(normalizePhone('appel commercial').value, '');
  const local = normalizePhone('71 000 222', {country: 'Tunisie', defaultCallingCode: '216'});
  assert.equal(local.value, '+21671000222');
  const unknown = normalizePhone('71 000 222');
  assert.equal(unknown.value, '71 000 222');
  assert.equal(unknown.uncertain, true);
});

test('E-mails normalisés, texte sans arobase écarté', () => {
  assert.equal(normalizeEmail('  Amina.Ben@CarboScan.TN ').value, 'amina.ben@carboscan.tn');
  assert.equal(normalizeEmail('Jean.Dupont_pro@atelier-sud.tn').value, 'jean.dupont_pro@atelier-sud.tn');
  assert.equal(normalizeEmail('prenom@').value, 'prenom@');
  assert.equal(normalizeEmail('prenom@').uncertain, true);
  assert.equal(normalizeEmail('amina @ exemple.fr').value, 'amina@exemple.fr');
  assert.equal(normalizeEmail('pas un email').value, '');
  assert.equal(normalizeEmail('').value, '');
  assert.equal(normalizeEmail('a@b').uncertain, true);
});

test('Indicatif tunisien seulement si le pays ou un +216 est déjà sur la carte', () => {
  const out = normalizeExtraction({
    companies: [{name: 'Atelier Sud', country: 'Tunisie', phone: '74 000 210', email: 'contact @ atelier-sud.tn', city: 'Sfax', sector: '', description: '', address: '', website: '', linkedin: '', uncertain: []}],
    contacts: [{name: 'Amina Jaziri', phone: '20 111 334', phone_work: '74 000 210', emails: ['Amina.Jaziri@atelier-sud.tn'], company_name: 'Atelier Sud', job_title: '', department: '', whatsapp: '', uncertain: []}]
  });
  assert.equal(out.companies[0].phone, '+21674000210');
  assert.equal(out.companies[0].email, 'contact@atelier-sud.tn');
  assert.equal(out.contacts[0].phone, '+21620111334');
  assert.equal(out.contacts[0].phone_work, '+21674000210');
  assert.deepEqual(out.contacts[0].emails, ['amina.jaziri@atelier-sud.tn']);
});

test('Aucun indicatif inventé si le pays est absent', () => {
  const out = normalizeExtraction({
    companies: [{name: 'Atelier Sud', phone: '74 000 210'}],
    contacts: [{name: 'Amina Jaziri', phone: '20 111 334', emails: []}]
  });
  assert.equal(out.companies[0].phone, '74 000 210');
  assert.ok(out.companies[0].uncertain.includes('phone'));
  assert.equal(out.contacts[0].phone, '20 111 334');
});

test('Les champs absents du modèle deviennent des chaînes vides, jamais des valeurs inventées', () => {
  const out = normalizeExtraction({
    companies: [{name: 'Nord', sector: null, city: null, phone: null, email: null, website: null, country: null, address: null, description: null, linkedin: null, uncertain: null}],
    contacts: [{name: 'ليلى العمري', job_title: null, department: null, phone: null, phone_work: null, whatsapp: null, emails: null, company_name: null, uncertain: null}]
  });
  assert.equal(out.companies[0].city, '');
  assert.equal(out.companies[0].email, '');
  assert.equal(out.contacts[0].name, 'ليلى العمري');
  assert.equal(out.contacts[0].job_title, '');
  assert.deepEqual(out.contacts[0].emails, []);
});

test('Une clé Gemini ne configure plus l’OCR', () => {
  assert.equal(configured({documentAiApiKey: 'gemini-key', documentAiProvider: 'gemini'}), false);
  assert.equal(configured({openaiApiKey: 'sk-test-value'}), true);
  assert.equal(estimateCostUsd(1_000_000, 0), 0.75);
  assert.equal(estimateCostUsd(1_000_000, 1_000_000, 1_000_000), 4.575);
});

test('Un délai d’analyse relance le même modèle une fois', async () => {
  let calls = 0;
  const result = await extractDocument({
    config: {openaiApiKey: 'test-key-not-real', openaiOcrModel: 'gpt-5.4-mini'},
    mimeType: 'image/png',
    data: png,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('timeout'), {name: 'TimeoutError', code: 23});
      return openaiOk('Claire Morel');
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.contacts[0].name, 'Claire Morel');
  assert.equal(result.meta.model, 'gpt-5.4-mini');
  assert.equal(result.meta.estimatedCostUsd, estimateCostUsd(1000, 100, 200));
});

test('Une saturation relance gpt-5.4-mini une fois, sans autre fournisseur', async () => {
  const calls = [];
  const result = await extractDocument({
    config: {openaiApiKey: 'test-key-not-real', openaiOcrModel: 'gpt-5.4-mini'},
    mimeType: 'image/png',
    data: png,
    fetchImpl: async url => {
      calls.push(String(url));
      if (calls.length === 1) return {ok: false, status: 429, async json() { return {error: {message: 'Rate limit reached', code: 'rate_limit_exceeded'}}; }};
      return openaiOk('Claire Morel');
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'https://api.openai.com/v1/responses');
  assert.equal(result.meta.model, 'gpt-5.4-mini');
});

test('Authentification et quota ne sont pas relancés', async () => {
  for (const failure of [
    {status: 401, error: {code: 'invalid_api_key', type: 'authentication_error', message: 'bad key sk-secret'}, code: 'auth'},
    {status: 429, error: {code: 'insufficient_quota', message: 'exceeded your current quota'}, code: 'quota'}
  ]) {
    let calls = 0;
    await assert.rejects(() => extractDocument({
      config: {openaiApiKey: 'test-key-not-real'},
      mimeType: 'image/png',
      data: png,
      fetchImpl: async () => {
        calls += 1;
        return {ok: false, status: failure.status, async json() { return {error: failure.error}; }};
      }
    }), error => error.code === failure.code);
    assert.equal(calls, 1);
  }
});

test('Un PDF part en fichier, une image en haute définition', async () => {
  const seen = [];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    seen.push(body.input[0].content.filter(part => part.type !== 'input_text'));
    return openaiOk('Claire Morel');
  };
  await extractDocument({
    config: {openaiApiKey: 'test-key-not-real'},
    mimeType: 'image/png',
    data: png,
    fetchImpl
  });
  const pdf = Buffer.from('%PDF-1.4 /Type /Page').toString('base64');
  await extractDocument({
    config: {openaiApiKey: 'test-key-not-real'},
    mimeType: 'application/pdf',
    data: pdf,
    fetchImpl
  });
  assert.equal(seen[0][0].type, 'input_image');
  assert.equal(seen[0][0].detail, 'high');
  assert.equal(seen[1][0].type, 'input_file');
  assert.match(seen[1][0].file_data, /^data:application\/pdf;base64,/);
});

test('JSON OpenAI rejeté s’il n’est pas un objet de fiches', () => {
  assert.throws(() => assertExtractionShape(['carte']), error => error.code === 'parse_error');
  assert.throws(() => normalizeExtraction({companies: 'CarboScan', contacts: []}), error => error.code === 'parse_error');
  assert.throws(() => normalizeExtraction({companies: [null], contacts: []}), error => error.code === 'parse_error');
});
