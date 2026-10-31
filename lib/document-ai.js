const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_BYTES = 8_388_608;
const MAX_PAGES = 5;
const ORG_DAILY_LIMIT = 20;
const MONTHLY_BUDGET_USD = 10;
const INPUT_USD_PER_M = 0.30;
const OUTPUT_USD_PER_M = 2.50;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function settings(config = {}) {
  return {
    apiKey: config.documentAiApiKey || process.env.DOCUMENT_AI_API_KEY || '',
    model: config.documentAiModel || process.env.DOCUMENT_AI_MODEL || DEFAULT_MODEL,
    maxBytes: Number(config.documentAiMaxBytes || process.env.DOCUMENT_AI_MAX_BYTES) || MAX_BYTES,
    maxPages: Number(config.documentAiMaxPages || process.env.DOCUMENT_AI_MAX_PAGES) || MAX_PAGES,
    orgDailyLimit: Number(config.documentAiOrgDailyLimit || process.env.DOCUMENT_AI_ORG_DAILY_LIMIT) || ORG_DAILY_LIMIT,
    monthlyBudgetUsd: Number(config.documentAiMonthlyBudgetUsd || process.env.DOCUMENT_AI_MONTHLY_BUDGET_USD) || MONTHLY_BUDGET_USD,
    provider: config.documentAiProvider || process.env.DOCUMENT_AI_PROVIDER || 'gemini'
  };
}

function configured(config) {
  const s = settings(config);
  return s.provider === 'gemini' && Boolean(s.apiKey);
}

function estimateCostUsd(promptTokens, outputTokens) {
  return Number((((promptTokens || 0) * INPUT_USD_PER_M) + ((outputTokens || 0) * OUTPUT_USD_PER_M)) / 1_000_000);
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

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {type: 'string'},
          sector: {type: 'string'},
          city: {type: 'string'},
          description: {type: 'string'},
          address: {type: 'string'},
          phone: {type: 'string'},
          email: {type: 'string'},
          website: {type: 'string'}
        },
        required: ['name', 'sector', 'city', 'description', 'address', 'phone', 'email', 'website']
      }
    },
    contacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: {type: 'string'},
          job_title: {type: 'string'},
          phone: {type: 'string'},
          emails: {type: 'array', items: {type: 'string'}},
          company_name: {type: 'string'}
        },
        required: ['name', 'job_title', 'phone', 'emails', 'company_name']
      }
    }
  },
  required: ['companies', 'contacts']
};

const SYSTEM_PROMPT = `Tu analyses un document commercial (carte de visite, brochure, leaflet, flyer, catalogue ou PDF).
Extrais uniquement les informations réellement visibles. Ne jamais inventer une coordonnée absente : laisse une chaîne vide.
Réponds en JSON selon le schéma.
Distingue clairement :
- entreprises / organisations (raison sociale ou nom commercial) ;
- personnes nominatives (prénom et nom).
Ne crée pas de contact s'il n'y a aucune personne identifiable.
Ne confonds pas une marque produit avec une entreprise sauf si le document présente clairement l'entreprise.
Plusieurs entreprises ou contacts possibles.
Langues possibles : français, anglais, arabe. Conserves les noms tels qu'ils apparaissent.`;

function cleanCompany(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 150);
  if (!name) return null;
  return {
    name,
    sector: String(raw.sector || '').trim().slice(0, 150),
    city: String(raw.city || '').trim().slice(0, 150),
    description: String(raw.description || '').trim().slice(0, 5000),
    address: String(raw.address || '').trim().slice(0, 1000),
    phone: String(raw.phone || '').trim().slice(0, 50),
    email: String(raw.email || '').trim().toLowerCase().slice(0, 254),
    website: String(raw.website || '').trim().slice(0, 254)
  };
}

function cleanContact(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 150);
  if (!name) return null;
  const emails = Array.isArray(raw.emails)
    ? [...new Set(raw.emails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))].slice(0, 10)
    : [];
  const phone = String(raw.phone || '').trim().slice(0, 50);
  return {
    name,
    job_title: String(raw.job_title || '').trim().slice(0, 150),
    phone,
    emails,
    company_name: String(raw.company_name || '').trim().slice(0, 150)
  };
}

function normalizeExtraction(payload) {
  const companies = [];
  const contacts = [];
  const seenCompanies = new Set();
  for (const item of payload?.companies || []) {
    const company = cleanCompany(item);
    if (!company) continue;
    const key = company.name.toLowerCase();
    if (seenCompanies.has(key)) continue;
    seenCompanies.add(key);
    companies.push(company);
  }
  const seenContacts = new Set();
  for (const item of payload?.contacts || []) {
    const contact = cleanContact(item);
    if (!contact) continue;
    const key = (contact.name + '|' + (contact.emails[0] || '')).toLowerCase();
    if (seenContacts.has(key)) continue;
    seenContacts.add(key);
    contacts.push(contact);
  }
  return {companies, contacts};
}

async function callGemini({apiKey, model, parts, fetchImpl}) {
  const fetchFn = fetchImpl || fetch;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: {parts: [{text: SYSTEM_PROMPT}]},
    contents: [{
      role: 'user',
      parts: [
        {text: 'Extrais les entreprises et contacts professionnels présents dans ce document. Les champs absents restent vides. Un nom seul suffit pour une fiche.'},
        ...parts
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: EXTRACTION_SCHEMA
    }
  };
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || 'Extraction indisponible.';
    throw Object.assign(new Error(message.slice(0, 300)), {
      status: response.status >= 500 ? 502 : 502,
      code: 'provider_error',
      providerStatus: response.status
    });
  }
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    throw Object.assign(new Error('Réponse d’extraction illisible.'), {status: 502, code: 'parse_error'});
  }
  const usage = data?.usageMetadata || {};
  return {
    extraction: normalizeExtraction(parsed),
    promptTokens: Number(usage.promptTokenCount) || 0,
    outputTokens: Number(usage.candidatesTokenCount || usage.totalTokenCount) || 0
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
  const geminiParts = [];
  for (const item of inputs) {
    const parsed = parseDataUrlOrBase64(item.mime_type || item.mimeType, item.data);
    const pagesInDoc = validateDocument(parsed.mimeType, parsed.buffer, limits);
    totalBytes += parsed.buffer.length;
    if (totalBytes > limits.maxBytes) throw Object.assign(new Error('Le fichier dépasse 8 Mo.'), {status: 400});
    pageCount += pagesInDoc;
    if (pageCount > limits.maxPages) throw Object.assign(new Error('Cinq pages maximum.'), {status: 400});
    parsedPages.push(parsed);
    geminiParts.push({inlineData: {mimeType: parsed.mimeType, data: parsed.buffer.toString('base64')}});
  }
  const result = await callGemini({
    apiKey: limits.apiKey,
    model: limits.model,
    parts: geminiParts,
    fetchImpl
  });
  const estimatedCostUsd = estimateCostUsd(result.promptTokens, result.outputTokens);
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
  extractDocument,
  callGemini,
  SYSTEM_PROMPT
};
