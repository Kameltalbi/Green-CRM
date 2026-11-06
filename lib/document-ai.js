const DEFAULT_MODEL = 'gpt-5.4-mini';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_ATTEMPTS = 2;
const MAX_BYTES = 8_388_608;
const MAX_PAGES = 5;
const ORG_DAILY_LIMIT = 20;
const MONTHLY_BUDGET_USD = 10;
const INPUT_USD_PER_M = 0.75;
const CACHED_INPUT_USD_PER_M = 0.075;
const OUTPUT_USD_PER_M = 4.50;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function settings(config = {}) {
  const model = String(config.openaiOcrModel || process.env.OPENAI_OCR_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return {
    apiKey: String(config.openaiApiKey || process.env.OPENAI_API_KEY || '').trim(),
    model,
    maxBytes: Number(config.documentAiMaxBytes || process.env.DOCUMENT_AI_MAX_BYTES) || MAX_BYTES,
    maxPages: Number(config.documentAiMaxPages || process.env.DOCUMENT_AI_MAX_PAGES) || MAX_PAGES,
    orgDailyLimit: Number(config.documentAiOrgDailyLimit || process.env.DOCUMENT_AI_ORG_DAILY_LIMIT) || ORG_DAILY_LIMIT,
    monthlyBudgetUsd: Number(config.documentAiMonthlyBudgetUsd || process.env.DOCUMENT_AI_MONTHLY_BUDGET_USD) || MONTHLY_BUDGET_USD,
    provider: 'openai'
  };
}

function configured(config) {
  return Boolean(settings(config).apiKey);
}

function estimateCostUsd(promptTokens, outputTokens, cachedTokens = 0) {
  const input = Math.max(0, Number(promptTokens) || 0);
  const cached = Math.min(Math.max(0, Number(cachedTokens) || 0), input);
  const fresh = input - cached;
  const output = Math.max(0, Number(outputTokens) || 0);
  return Number(((fresh * INPUT_USD_PER_M + cached * CACHED_INPUT_USD_PER_M + output * OUTPUT_USD_PER_M) / 1_000_000).toFixed(8));
}

function countPdfPages(buffer) {
  const text = buffer.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
  return Math.max(1, matches ? matches.length : 1);
}

function parseDataUrlOrBase64(mimeType, data) {
  if (typeof data !== 'string' || !data) throw Object.assign(new Error('Document invalide.'), {status: 400});
  let raw = data;
  const match = /^data:([^;]+);base64,(.+)$/s.exec(data);
  if (match) {
    if (mimeType && match[1] !== mimeType) throw Object.assign(new Error('Type de fichier incohérent.'), {status: 400});
    mimeType = match[1];
    raw = match[2];
  }
  if (!ALLOWED_MIME.has(mimeType)) throw Object.assign(new Error('Formats acceptés : JPG, PNG, WebP ou PDF.'), {status: 400});
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw.replace(/\s/g, ''))) throw Object.assign(new Error('Document invalide.'), {status: 400});
  const buffer = Buffer.from(raw.replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw Object.assign(new Error('Document vide.'), {status: 400});
  return {mimeType, buffer};
}

function validateDocument(mimeType, buffer, limits) {
  if (buffer.length > limits.maxBytes) throw Object.assign(new Error('Le fichier dépasse 8 Mo.'), {status: 400});
  let pageCount = 1;
  if (mimeType === 'application/pdf') {
    pageCount = countPdfPages(buffer);
    if (pageCount > limits.maxPages) throw Object.assign(new Error('Cinq pages PDF maximum.'), {status: 400});
  } else if (mimeType === 'image/png') {
    if (!buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw Object.assign(new Error('Image PNG invalide.'), {status: 400});
  } else if (mimeType === 'image/jpeg') {
    if (!(buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255)) throw Object.assign(new Error('Image JPEG invalide.'), {status: 400});
  } else if (mimeType === 'image/webp') {
    if (!(buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')) throw Object.assign(new Error('Image WebP invalide.'), {status: 400});
  }
  return pageCount;
}

const NULLABLE_STRING = {anyOf: [{type: 'string'}, {type: 'null'}]};

function objectSchema(properties) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: Object.keys(properties)
  };
}

const EXTRACTION_SCHEMA = objectSchema({
  companies: {
    type: 'array',
    items: objectSchema({
      name: NULLABLE_STRING,
      sector: NULLABLE_STRING,
      city: NULLABLE_STRING,
      description: NULLABLE_STRING,
      address: NULLABLE_STRING,
      phone: NULLABLE_STRING,
      email: NULLABLE_STRING,
      website: NULLABLE_STRING,
      country: NULLABLE_STRING,
      linkedin: NULLABLE_STRING,
      uncertain: {type: 'array', items: {type: 'string', enum: ['name', 'sector', 'city', 'description', 'address', 'phone', 'email', 'website', 'country', 'linkedin']}}
    })
  },
  contacts: {
    type: 'array',
    items: objectSchema({
      name: NULLABLE_STRING,
      job_title: NULLABLE_STRING,
      department: NULLABLE_STRING,
      phone: NULLABLE_STRING,
      phone_work: NULLABLE_STRING,
      whatsapp: NULLABLE_STRING,
      emails: {anyOf: [{type: 'array', items: {type: 'string'}}, {type: 'null'}]},
      company_name: NULLABLE_STRING,
      uncertain: {type: 'array', items: {type: 'string', enum: ['name', 'job_title', 'department', 'phone', 'phone_work', 'whatsapp', 'emails', 'company_name']}}
    })
  }
});

const SYSTEM_PROMPT = `Tu lis une carte de visite, une brochure ou un PDF commercial pour un CRM.
Extrais uniquement ce qui est réellement imprimé. Si un champ est absent, mets null (ou un tableau vide pour uncertain, null pour emails). N’invente jamais un nom, une fonction, une entreprise, un numéro, un e-mail, un site, une adresse, une ville ou un pays.
Si un champ est partiellement lisible, garde la meilleure lecture et ajoute son nom dans uncertain.
Personne : name = prénom et nom tels qu’imprimés, sans traduire ni corriger l’orthographe ; phone = mobile ; phone_work = fixe, standard ou ligne directe ; whatsapp seulement si le mot WhatsApp est visible.
Entreprise : name = raison sociale imprimée ; address = adresse postale ; phone = standard ; city et country seulement s’ils sont imprimés ; website et email seulement s’ils sont imprimés.
Ne crée pas de contact sans personne identifiable. Un logo, un slogan ou un QR code n’est pas une personne. Deux numéros : le mobile dans phone, le fixe dans phone_work.
Langues : français, anglais et arabe. Conserve les noms propres et le texte arabe. Recopie les numéros tels qu’imprimés, sans ajouter d’indicatif qui n’est pas visible.
E-mail : recopie l’adresse seulement si elle est entièrement lisible, en conservant @, les points, _ et -. N’assemble jamais une adresse à partir d’un prénom et d’un domaine. Si une partie est illisible, mets null.`;

const COMPANY_FIELDS = ['name', 'sector', 'city', 'description', 'address', 'phone', 'email', 'website', 'country', 'linkedin'];
const CONTACT_FIELDS = ['name', 'job_title', 'department', 'phone', 'phone_work', 'whatsapp', 'emails', 'company_name'];

function uncertainFields(raw, known) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(value => String(value || '').trim()).filter(value => known.includes(value)))].slice(0, 12);
}

function noteUncertain(list, field, flag) {
  if (flag && field && !list.includes(field)) list.push(field);
  return list;
}

function normalizeEmail(raw) {
  const compact = String(raw || '').trim().toLowerCase().replace(/\s+/g, '').slice(0, 254);
  if (!compact) return {value: '', uncertain: false};
  if (/^[a-z0-9._%+\-]+@[a-z0-9.-]+\.[a-z]{2,24}$/.test(compact)) return {value: compact, uncertain: false};
  if (compact.includes('@')) return {value: compact, uncertain: true};
  return {value: '', uncertain: false};
}

function normalizePhone(raw, hints = {}) {
  const original = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  if (!original) return {value: '', uncertain: false};
  const digits = original.replace(/\D/g, '');
  if (/[a-zA-Z\u0600-\u06FF]{3,}/.test(original) && digits.length < 8) return {value: '', uncertain: false};
  const international = /^\s*\+/.test(original) || /^\s*00\d/.test(original);
  let national = digits;
  if (international && national.startsWith('00')) national = national.slice(2);
  const country = String(hints.country || '');
  const callingCode = hints.defaultCallingCode || '';
  const tunisia = callingCode === '216' || /tunis|تونس/i.test(country);
  const asInternational = value => ({value, uncertain: false});
  if (national.startsWith('216') && national.length === 11) return asInternational('+216' + national.slice(3));
  if (national.startsWith('33') && national.length === 11) return asInternational('+33' + national.slice(2));
  if (/^0[1-9]\d{8}$/.test(national)) return asInternational('+33' + national.slice(1));
  if (national.length === 8 && tunisia) return asInternational('+216' + national);
  if (international && national.length >= 8 && national.length <= 15) return asInternational('+' + national);
  return {value: original, uncertain: digits.length >= 8 && !international};
}

function extractionHints(payload) {
  const companies = Array.isArray(payload?.companies) ? payload.companies : [];
  const contacts = Array.isArray(payload?.contacts) ? payload.contacts : [];
  const country = companies.map(item => String(item?.country || '')).join(' ');
  const blob = JSON.stringify({companies, contacts});
  let defaultCallingCode = '';
  if (/tunis|تونس/i.test(country) || /\+216|00216/.test(blob)) defaultCallingCode = '216';
  else if (/\bfrance\b|فرنسا/i.test(country) || /\+33|0033/.test(blob)) defaultCallingCode = '33';
  return {country, defaultCallingCode};
}

function takePhone(raw, hints, uncertain, field) {
  const normalized = normalizePhone(raw, hints);
  noteUncertain(uncertain, field, normalized.uncertain);
  return normalized.value.slice(0, 50);
}

function takeEmail(raw, uncertain, field) {
  const normalized = normalizeEmail(raw);
  noteUncertain(uncertain, field, normalized.uncertain);
  return normalized.value;
}

function assertExtractionShape(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Réponse d’extraction illisible.'), {status: 502, code: 'parse_error'});
  }
  if (payload.companies != null && !Array.isArray(payload.companies)) {
    throw Object.assign(new Error('Réponse d’extraction illisible.'), {status: 502, code: 'parse_error'});
  }
  if (payload.contacts != null && !Array.isArray(payload.contacts)) {
    throw Object.assign(new Error('Réponse d’extraction illisible.'), {status: 502, code: 'parse_error'});
  }
  for (const item of [...(payload.companies || []), ...(payload.contacts || [])]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw Object.assign(new Error('Réponse d’extraction illisible.'), {status: 502, code: 'parse_error'});
    }
  }
}

function cleanCompany(raw, hints = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 150);
  if (!name) return null;
  const uncertain = uncertainFields(raw.uncertain, COMPANY_FIELDS);
  return {
    name,
    sector: String(raw.sector || '').trim().slice(0, 150),
    city: String(raw.city || '').trim().slice(0, 150),
    description: String(raw.description || '').trim().slice(0, 5000),
    address: String(raw.address || '').trim().slice(0, 1000),
    phone: takePhone(raw.phone, hints, uncertain, 'phone'),
    email: takeEmail(raw.email, uncertain, 'email'),
    website: String(raw.website || '').trim().slice(0, 254),
    country: String(raw.country || '').trim().slice(0, 100),
    linkedin: String(raw.linkedin || '').trim().slice(0, 254),
    uncertain
  };
}

function cleanContact(raw, hints = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 150);
  if (!name) return null;
  let source = raw.emails;
  let emailUncertain = false;
  if (typeof source === 'string') {
    source = source.split(/[;,]/);
    emailUncertain = true;
  }
  if (!Array.isArray(source)) {
    emailUncertain = raw.emails != null && raw.emails !== '';
    source = [];
  }
  const emails = [];
  for (const item of source) {
    const normalized = normalizeEmail(item);
    if (!normalized.value || emails.includes(normalized.value)) continue;
    if (normalized.uncertain) emailUncertain = true;
    emails.push(normalized.value);
    if (emails.length === 10) break;
  }
  const uncertain = uncertainFields(raw.uncertain, CONTACT_FIELDS);
  noteUncertain(uncertain, 'emails', emailUncertain);
  return {
    name,
    job_title: String(raw.job_title || '').trim().slice(0, 150),
    department: String(raw.department || '').trim().slice(0, 150),
    phone: takePhone(raw.phone, hints, uncertain, 'phone'),
    phone_work: takePhone(raw.phone_work, hints, uncertain, 'phone_work'),
    whatsapp: takePhone(raw.whatsapp, hints, uncertain, 'whatsapp'),
    emails,
    company_name: String(raw.company_name || '').trim().slice(0, 150),
    uncertain
  };
}

function publicProviderError(error = {}) {
  const code = error.code || '';
  const raw = String(error.message || '');
  const secret = /api[_ -]?key|sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{8,}|bearer\s+\S+|unauthenticated|invalid_api_key|permission denied/i.test(raw);
  if (code === 'unconfigured' || /n’est pas configurée|n'est pas configurée/.test(raw)) {
    return {status: 503, message: 'L’analyse de documents n’est pas configurée sur le serveur. Aucune fiche n’a été créée.'};
  }
  if (code === 'parse_error') {
    return {status: 502, message: 'La lecture de la carte a échoué. Reprenez la photo ou saisissez les informations. Aucune fiche n’a été créée.'};
  }
  if (code === 'auth' || secret || error.providerStatus === 401 || error.providerStatus === 403) {
    return {status: 503, message: 'L’authentification du service d’analyse a échoué. Aucune fiche n’a été créée.'};
  }
  if (code === 'quota' || /insufficient_quota|exceeded your current quota|billing/i.test(raw)) {
    return {status: 503, message: 'Le quota d’analyse est épuisé. Aucune fiche n’a été créée.'};
  }
  if (code === 'saturation' || /resource_exhausted|high demand|rate_limit|unavailable/i.test(raw) || error.providerStatus === 429 || error.providerStatus === 503) {
    return {status: 503, message: 'Le service d’analyse est saturé. Réessayez dans un instant. Aucune fiche n’a été créée.'};
  }
  if (code === 'timeout') {
    return {status: 503, message: 'Le délai d’analyse est dépassé. Réessayez. Aucune fiche n’a été créée.'};
  }
  if (code === 'network') {
    return {status: 503, message: 'Le service d’analyse est injoignable. Réessayez. Aucune fiche n’a été créée.'};
  }
  if (code === 'rejected') {
    return {status: 502, message: 'Le service d’analyse a refusé ce document. Reprenez la photo ou saisissez les informations. Aucune fiche n’a été créée.'};
  }
  if (error.status === 400) return {status: 400, message: raw.slice(0, 300) || 'Document invalide. Aucune fiche n’a été créée.'};
  return {status: 502, message: 'L’analyse du document a échoué. Aucune fiche n’a été créée.'};
}

function normalizeExtraction(payload) {
  assertExtractionShape(payload);
  const hints = extractionHints(payload);
  const companies = [];
  const contacts = [];
  const seenCompanies = new Set();
  for (const item of payload?.companies || []) {
    const company = cleanCompany(item, hints);
    if (!company) continue;
    const key = company.name.toLowerCase();
    if (seenCompanies.has(key)) continue;
    seenCompanies.add(key);
    companies.push(company);
  }
  const seenContacts = new Set();
  for (const item of payload?.contacts || []) {
    const contact = cleanContact(item, hints);
    if (!contact) continue;
    const key = (contact.name + '|' + (contact.emails[0] || '')).toLowerCase();
    if (seenContacts.has(key)) continue;
    seenContacts.add(key);
    contacts.push(contact);
  }
  for (const contact of contacts) {
    const companyName = contact.company_name;
    if (!companyName || seenCompanies.has(companyName.toLowerCase())) continue;
    seenCompanies.add(companyName.toLowerCase());
    companies.push({
      name: companyName,
      sector: '',
      city: '',
      description: '',
      address: '',
      phone: '',
      email: '',
      website: '',
      country: '',
      linkedin: '',
      uncertain: []
    });
  }
  return {companies, contacts};
}

function timedOut(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || Number(error?.code) === 23;
}

function providerKind(status, data) {
  const err = data?.error || {};
  const code = String(err.code || '');
  const type = String(err.type || '');
  const blob = `${code} ${type} ${err.message || ''}`;
  if (status === 401 || code === 'invalid_api_key' || type === 'authentication_error') return 'auth';
  if (status === 403) return 'auth';
  if (/insufficient_quota|billing_hard_limit|exceeded your current quota/i.test(blob)) return 'quota';
  if (status === 429 || status === 500 || status === 503 || code === 'rate_limit_exceeded' || /rate_limit|overloaded|unavailable/i.test(blob)) return 'saturation';
  if (status === 400) return 'rejected';
  return 'provider_error';
}

function responseText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const chunks = [];
  for (const item of data?.output || []) {
    if (item?.type === 'refusal') return '';
    for (const part of item?.content || []) {
      if (part?.type === 'refusal') return '';
      if (typeof part?.text === 'string' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('');
}

function contentPart(parsed) {
  const data = parsed.buffer.toString('base64');
  if (parsed.mimeType === 'application/pdf') {
    return {type: 'input_file', filename: 'document.pdf', file_data: `data:application/pdf;base64,${data}`};
  }
  return {type: 'input_image', image_url: `data:${parsed.mimeType};base64,${data}`, detail: 'high'};
}

async function callOpenAI({apiKey, model, parts, fetchImpl}) {
  const fetchFn = fetchImpl || fetch;
  const body = {
    model,
    store: false,
    max_output_tokens: 4096,
    reasoning: {effort: 'low'},
    instructions: SYSTEM_PROMPT,
    input: [{
      role: 'user',
      content: [
        {type: 'input_text', text: 'Extrais les entreprises et les personnes. Les champs absents sont null. phone est le mobile, phone_work le téléphone fixe ou professionnel. Signale dans uncertain les champs ambigus. Un nom seul suffit pour une fiche.'},
        ...parts
      ]
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'crm_card_extraction',
        strict: true,
        schema: EXTRACTION_SCHEMA
      }
    }
  };
  let response;
  try {
    response = await fetchFn(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    if (timedOut(error)) {
      throw Object.assign(new Error('Délai d’analyse dépassé.'), {status: 503, code: 'timeout', transient: true});
    }
    throw Object.assign(new Error('Réseau indisponible.'), {status: 503, code: 'network', transient: true});
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const kind = providerKind(response.status, data);
    throw Object.assign(new Error('Extraction OpenAI refusée.'), {
      status: kind === 'rejected' || kind === 'provider_error' ? 502 : 503,
      code: kind,
      providerStatus: response.status,
      transient: kind === 'saturation'
    });
  }
  const text = responseText(data);
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    throw Object.assign(new Error('Réponse d’extraction illisible.'), {status: 502, code: 'parse_error'});
  }
  assertExtractionShape(parsed);
  const usage = data?.usage || {};
  return {
    extraction: normalizeExtraction(parsed),
    promptTokens: Number(usage.input_tokens ?? usage.prompt_tokens) || 0,
    outputTokens: Number(usage.output_tokens ?? usage.completion_tokens) || 0,
    cachedTokens: Number(usage.input_tokens_details?.cached_tokens) || 0
  };
}

function normalizePages({mimeType, data, pages}) {
  const items = Array.isArray(pages) && pages.length
    ? pages
    : (mimeType || data ? [{mime_type: mimeType, data}] : []);
  if (!items.length) throw Object.assign(new Error('Document invalide.'), {status: 400});
  if (items.length > MAX_PAGES) throw Object.assign(new Error('Cinq pages maximum.'), {status: 400});
  return items;
}

async function extractDocument({config, mimeType, data, pages, fetchImpl}) {
  const limits = settings(config);
  if (!configured(config)) throw Object.assign(new Error('L’importation de documents n’est pas configurée.'), {status: 503, code: 'unconfigured'});
  const inputs = normalizePages({mimeType, data, pages});
  const parsedPages = [];
  let totalBytes = 0;
  let pageCount = 0;
  const parts = [];
  for (const item of inputs) {
    const parsed = parseDataUrlOrBase64(item.mime_type || item.mimeType, item.data);
    const pagesInDoc = validateDocument(parsed.mimeType, parsed.buffer, limits);
    totalBytes += parsed.buffer.length;
    if (totalBytes > limits.maxBytes) throw Object.assign(new Error('Le fichier dépasse 8 Mo.'), {status: 400});
    pageCount += pagesInDoc;
    if (pageCount > limits.maxPages) throw Object.assign(new Error('Cinq pages maximum.'), {status: 400});
    parsedPages.push(parsed);
    parts.push(contentPart(parsed));
  }
  const attempt = () => callOpenAI({apiKey: limits.apiKey, model: limits.model, parts, fetchImpl});
  let result = null;
  let lastError = null;
  for (let n = 1; n <= MAX_ATTEMPTS; n++) {
    try {
      result = await attempt();
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!error.transient || n === MAX_ATTEMPTS) break;
    }
  }
  if (!result) throw lastError;
  const estimatedCostUsd = estimateCostUsd(result.promptTokens, result.outputTokens, result.cachedTokens);
  const primary = parsedPages[0];
  return {
    ...result.extraction,
    meta: {
      mimeType: primary.mimeType,
      pageCount,
      byteLength: totalBytes,
      model: limits.model,
      promptTokens: result.promptTokens,
      outputTokens: result.outputTokens,
      estimatedCostUsd
    }
  };
}

module.exports = {
  DEFAULT_MODEL,
  MAX_BYTES,
  MAX_PAGES,
  ORG_DAILY_LIMIT,
  MONTHLY_BUDGET_USD,
  settings,
  configured,
  estimateCostUsd,
  countPdfPages,
  parseDataUrlOrBase64,
  validateDocument,
  normalizeExtraction,
  cleanCompany,
  cleanContact,
  normalizePhone,
  normalizeEmail,
  assertExtractionShape,
  publicProviderError,
  extractDocument,
  callOpenAI,
  EXTRACTION_SCHEMA,
  OPENAI_RESPONSES_URL,
  SYSTEM_PROMPT
};
