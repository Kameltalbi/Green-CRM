const {fail, text, email, uuid, allowed} = require('./validation');
const {
  configured,
  settings,
  extractDocument,
  estimateCostUsd,
  publicProviderError
} = require('./document-ai');

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function assertQuotas(c, organizationId, limits) {
  const {rows: [day]} = await c.query(
    `SELECT count(*)::int AS n FROM document_extractions
     WHERE organization_id = $1 AND status = 'ok' AND created_at >= date_trunc('day', now())`,
    [organizationId]
  );
  if (day.n >= limits.orgDailyLimit) {
    fail(429, 'Limite quotidienne d’importation atteinte (20 documents par organisation).');
  }
  const {rows: [month]} = await c.query(
    `SELECT coalesce(sum(estimated_cost_usd), 0)::float8 AS spent
     FROM document_extractions
     WHERE status = 'ok' AND created_at >= $1`,
    [monthStart()]
  );
  if (Number(month.spent) >= limits.monthlyBudgetUsd) {
    fail(429, 'Le plafond mensuel d’extraction documentaire est atteint.');
  }
  return {
    dailyUsed: day.n,
    dailyLimit: limits.orgDailyLimit,
    monthlySpentUsd: Number(month.spent) || 0,
    monthlyBudgetUsd: limits.monthlyBudgetUsd
  };
}

async function findCompanyMatches(c, companies) {
  const matches = [];
  for (const company of companies) {
    const {rows} = await c.query(
      `SELECT id, name, sector, city, description, address, phone, email, website
       FROM companies
       WHERE archived_at IS NULL AND lower(trim(name)) = lower(trim($1))
       ORDER BY created_at
       LIMIT 5`,
      [company.name]
    );
    matches.push({name: company.name, items: rows});
  }
  return matches;
}

async function findContactMatches(c, contacts) {
  const matches = [];
  for (const contact of contacts) {
    const emails = contact.emails || [];
    let rows = [];
    if (emails.length) {
      ({rows} = await c.query(
        `SELECT DISTINCT ct.id, ct.name, ct.job_title, ct.phone, ct.company_id
         FROM contacts ct
         JOIN contact_emails ce ON ce.contact_id = ct.id
         WHERE ct.archived_at IS NULL AND ce.email = ANY($1::text[])
         ORDER BY ct.name
         LIMIT 5`,
        [emails]
      ));
    }
    if (!rows.length) {
      ({rows} = await c.query(
        `SELECT id, name, job_title, phone, company_id
         FROM contacts
         WHERE archived_at IS NULL AND lower(trim(name)) = lower(trim($1))
         ORDER BY created_at
         LIMIT 5`,
        [contact.name]
      ));
    }
    matches.push({name: contact.name, emails, items: rows});
  }
  return matches;
}

function installDocumentImport(api, {route, db, config, entity}) {
  api.get('/documents/import-status', route(async (req, c) => {
    const limits = settings(config);
    const ready = configured(config);
    let quotas = null;
    if (ready) {
      const {rows: [day]} = await c.query(
        `SELECT count(*)::int AS n FROM document_extractions
         WHERE organization_id = $1 AND status = 'ok' AND created_at >= date_trunc('day', now())`,
        [req.auth.organization_id]
      );
      const {rows: [month]} = await c.query(
        `SELECT coalesce(sum(estimated_cost_usd), 0)::float8 AS spent
         FROM document_extractions WHERE status = 'ok' AND created_at >= $1`,
        [monthStart()]
      );
      quotas = {
        dailyUsed: day.n,
        dailyLimit: limits.orgDailyLimit,
        monthlySpentUsd: Number(month.spent) || 0,
        monthlyBudgetUsd: limits.monthlyBudgetUsd
      };
    }
    return {
      configured: ready,
      notice: 'Pour analyser cette carte de visite, Ciblix transmettra sa photographie à OpenAI afin d’en extraire les coordonnées professionnelles. Vérifiez les informations avant leur enregistrement.',
      maxBytes: limits.maxBytes,
      maxPages: limits.maxPages,
      languages: ['fr', 'en', 'ar'],
      quotas
    };
  }));

  api.post('/documents/extract', route(async (req, c) => {
    allowed(req.body || {}, ['mime_type', 'data', 'pages', 'external_processing_consent']);
    if (req.body?.external_processing_consent !== true) {
      fail(400, 'Confirmez l’envoi du document au prestataire d’analyse.');
    }
    const limits = settings(config);
    const quotas = await assertQuotas(c, req.auth.organization_id, limits);
    const started = Date.now();
    let result;
    try {
      result = await extractDocument({
        config,
        mimeType: req.body.mime_type,
        data: req.body.data,
        pages: req.body.pages,
        fetchImpl: config.documentAiFetch
      });
    } catch (error) {
      const mimeGuess = Array.isArray(req.body.pages) && req.body.pages[0]?.mime_type
        ? req.body.pages[0].mime_type
        : (typeof req.body.mime_type === 'string' && req.body.mime_type.startsWith('image/') ? req.body.mime_type : 'application/pdf');
      const errorCode = String(error.code || 'error').slice(0, 80);
      await c.query(
        `INSERT INTO document_extractions(
           organization_id, user_id, mime_type, page_count, byte_length, model,
           prompt_tokens, output_tokens, estimated_cost_usd, status, error_code
         ) VALUES ($1,$2,$3,1,1,$4,0,0,0,'error',$5)`,
        [
          req.auth.organization_id,
          req.auth.user_id,
          String(mimeGuess).startsWith('image/') ? mimeGuess : 'application/pdf',
          limits.model,
          errorCode
        ]
      );
      console.info(JSON.stringify({
        event: 'ocr',
        outcome: 'error',
        code: errorCode,
        providerStatus: Number(error.providerStatus) || 0,
        model: limits.model,
        ms: Date.now() - started
      }));
      const pub = publicProviderError(error);
      return {status: pub.status, data: {message: pub.message}};
    }
    console.info(JSON.stringify({
      event: 'ocr',
      outcome: 'ok',
      model: result.meta.model,
      ms: Date.now() - started,
      bytes: result.meta.byteLength,
      companies: result.companies.length,
      contacts: result.contacts.length
    }));

    await c.query(
      `INSERT INTO document_extractions(
         organization_id, user_id, mime_type, page_count, byte_length, model,
         prompt_tokens, output_tokens, estimated_cost_usd, status, error_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ok','')`,
      [
        req.auth.organization_id,
        req.auth.user_id,
        result.meta.mimeType,
        result.meta.pageCount,
        result.meta.byteLength,
        result.meta.model,
        result.meta.promptTokens,
        result.meta.outputTokens,
        result.meta.estimatedCostUsd
      ]
    );

    const companyMatches = await findCompanyMatches(c, result.companies);
    const contactMatches = await findContactMatches(c, result.contacts);
    return {
      companies: result.companies,
      contacts: result.contacts,
      matches: {companies: companyMatches, contacts: contactMatches},
      meta: result.meta,
      quotas: {
        ...quotas,
        dailyUsed: quotas.dailyUsed + 1,
        monthlySpentUsd: quotas.monthlySpentUsd + result.meta.estimatedCostUsd
      }
    };
  }));

  api.post('/documents/import', route(async (req, c) => {
    allowed(req.body || {}, ['companies', 'contacts']);
    const companiesIn = Array.isArray(req.body.companies) ? req.body.companies.slice(0, 20) : [];
    const contactsIn = Array.isArray(req.body.contacts) ? req.body.contacts.slice(0, 40) : [];
    if (!companiesIn.length && !contactsIn.length) fail(400, 'Sélectionnez au moins une fiche à enregistrer.');

    const created = {companies: [], contacts: []};
    const updated = {companies: [], contacts: []};
    const linked = {companies: []};
    const nameToId = new Map();

    for (const item of companiesIn) {
      if (!item || item.selected !== true) continue;
      allowed(item, ['selected', 'action', 'id', 'name', 'sector', 'city', 'description', 'address', 'phone', 'email', 'website', 'relation_type', 'country', 'source', 'status', 'company_size', 'linkedin', 'socials', 'uncertain']);
      const name = text(item.name, 'nom de l’entreprise', 150);
      const fields = {
        sector: text(item.sector, 'secteur', 150, false),
        city: text(item.city, 'ville', 150, false),
        description: text(item.description, 'description', 5000, false),
        address: text(item.address, 'adresse', 1000, false),
        phone: text(item.phone, 'téléphone', 50, false),
        email: item.email ? email(item.email) : '',
        website: text(item.website, 'site web', 254, false),
        relation_type: text(item.relation_type, 'type de relation', 40, false),
        country: text(item.country, 'pays', 100, false),
        source: text(item.source, 'source', 100, false),
        status: text(item.status, 'statut', 40, false),
        company_size: text(item.company_size, 'taille', 40, false),
        linkedin: text(item.linkedin, 'LinkedIn', 254, false),
        socials: text(item.socials, 'réseaux sociaux', 1000, false)
      };
      const action = item.action === 'update' ? 'update' : item.action === 'link' ? 'link' : 'create';
      if (action === 'link') {
        const row = await entity(c, 'companies', item.id);
        nameToId.set(String(row.name || '').trim().toLowerCase(), row.id);
        nameToId.set(name.toLowerCase(), row.id);
        linked.companies.push(row);
        continue;
      }
      if (fields.website) {
        try {
          const url = new URL(fields.website.includes('://') ? fields.website : 'https://' + fields.website);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('url');
          fields.website = url.toString().slice(0, 254);
        } catch {
          fail(400, 'Site web invalide.');
        }
      }
      if (action === 'create') {
        const {rows: existing} = await c.query(
          `SELECT id, name FROM companies WHERE archived_at IS NULL AND lower(trim(name)) = lower(trim($1)) ORDER BY created_at LIMIT 1`,
          [name]
        );
        if (existing[0]) {
          fail(409, 'Une entreprise homonyme existe déjà. Associez le contact à cette entreprise au lieu d’en créer une nouvelle. Aucune fiche n’a été enregistrée.');
        }
      }
      if (action === 'update') {
        const id = uuid(item.id);
        const current = await entity(c, 'companies', id);
        const keep = (next, prev) => next || prev || '';
        const {rows: [row]} = await c.query(
          `UPDATE companies SET name=$2, sector=$3, city=$4, description=$5, address=$6, phone=$7, email=$8, website=$9,
            relation_type=$10, country=$11, source=$12, status=$13, company_size=$14, linkedin=$15, socials=$16
           WHERE id=$1 RETURNING *`,
          [id, name, keep(fields.sector, current.sector), keep(fields.city, current.city), keep(fields.description, current.description), keep(fields.address, current.address), keep(fields.phone, current.phone), keep(fields.email, current.email), keep(fields.website, current.website), keep(fields.relation_type, current.relation_type), keep(fields.country, current.country), keep(fields.source, current.source), keep(fields.status, current.status), keep(fields.company_size, current.company_size), keep(fields.linkedin, current.linkedin), keep(fields.socials, current.socials)]
        );
        await c.query(
          'INSERT INTO activities(organization_id, actor_user_id, entity_type, entity_id, action, summary, company_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [req.auth.organization_id, req.auth.user_id, 'companies', row.id, 'updated', 'Entreprise complétée depuis un document', row.id]
        );
        updated.companies.push(row);
        nameToId.set(name.toLowerCase(), row.id);
      } else {
        const {rows: [row]} = await c.query(
          `INSERT INTO companies(organization_id, name, sector, city, description, address, phone, email, website, relation_type, country, source, status, company_size, linkedin, socials, owner_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
          [req.auth.organization_id, name, fields.sector, fields.city, fields.description, fields.address, fields.phone, fields.email, fields.website, fields.relation_type, fields.country, fields.source || 'Non renseignée', fields.status, fields.company_size, fields.linkedin, fields.socials, req.auth.user_id]
        );
        await c.query(
          'INSERT INTO activities(organization_id, actor_user_id, entity_type, entity_id, action, summary, company_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [req.auth.organization_id, req.auth.user_id, 'companies', row.id, 'created', 'Entreprise créée depuis un document', row.id]
        );
        created.companies.push(row);
        nameToId.set(name.toLowerCase(), row.id);
      }
    }

    for (const item of contactsIn) {
      if (!item || item.selected !== true) continue;
      allowed(item, ['selected', 'action', 'id', 'name', 'job_title', 'department', 'phone', 'phone_work', 'whatsapp', 'emails', 'company_id', 'company_name', 'source', 'status', 'uncertain', 'card_mime_type', 'card_data']);
      const name = text(item.name, 'nom du contact', 150);
      const jobTitle = text(item.job_title, 'fonction', 150, false);
      const department = text(item.department, 'service', 150, false);
      const phone = text(item.phone, 'mobile', 50, false);
      const phoneWork = text(item.phone_work, 'téléphone professionnel', 50, false);
      const whatsapp = text(item.whatsapp, 'WhatsApp', 50, false);
      const source = text(item.source, 'origine', 100, false);
      const status = text(item.status, 'statut', 40, false);
      const emails = Array.isArray(item.emails) ? item.emails : [];
      if (emails.length > 10) fail(400, 'Au maximum dix adresses par contact.');
      const normalizedEmails = [...new Set(
        emails.map(value => String(value || '').trim()).filter(Boolean).map(value => email(value))
      )];
      let companyId = item.company_id ? uuid(item.company_id) : null;
      if (!companyId && item.company_name) {
        const key = String(item.company_name).trim().toLowerCase();
        companyId = nameToId.get(key) || null;
        if (!companyId) {
          const {rows} = await c.query(
            `SELECT id FROM companies WHERE archived_at IS NULL AND lower(trim(name)) = lower(trim($1)) ORDER BY created_at LIMIT 1`,
            [String(item.company_name)]
          );
          companyId = rows[0]?.id || null;
        }
      }
      if (companyId) await entity(c, 'companies', companyId);

      let action = item.action === 'update' ? 'update' : 'create';
      if (action === 'create' && normalizedEmails.length) {
        const {rows: byEmail} = await c.query(
          `SELECT DISTINCT ct.id, ct.name FROM contacts ct
           JOIN contact_emails ce ON ce.contact_id = ct.id
           WHERE ct.archived_at IS NULL AND ce.email = ANY($1::text[])
           ORDER BY ct.name LIMIT 1`,
          [normalizedEmails]
        );
        if (byEmail[0]) {
          fail(409, 'Un contact avec cette adresse e-mail existe déjà. Complétez la fiche existante au lieu d’en créer une nouvelle. Aucune fiche de cet envoi n’a été enregistrée.');
        }
      }
      if (action === 'update') {
        const id = uuid(item.id);
        const current = await entity(c, 'contacts', id);
        const keep = (next, prev) => next || prev || '';
        const {rows: [row]} = await c.query(
          `UPDATE contacts SET name=$2, job_title=$3, department=$4, phone=$5, phone_work=$6, whatsapp=$7, source=$8, status=$9, company_id=COALESCE($10, company_id)
           WHERE id=$1 RETURNING *`,
          [id, name, keep(jobTitle, current.job_title), keep(department, current.department), keep(phone, current.phone), keep(phoneWork, current.phone_work), keep(whatsapp, current.whatsapp), keep(source, current.source), keep(status, current.status), companyId]
        );
        if (normalizedEmails.length) {
          await c.query('DELETE FROM contact_emails WHERE contact_id=$1', [id]);
          for (const address of normalizedEmails) {
            await c.query(
              'INSERT INTO contact_emails(organization_id, contact_id, email) VALUES($1,$2,$3)',
              [req.auth.organization_id, id, address]
            );
          }
        }
        await c.query(
          'INSERT INTO activities(organization_id, actor_user_id, entity_type, entity_id, action, summary, company_id, contact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [req.auth.organization_id, req.auth.user_id, 'contacts', row.id, 'updated', 'Contact complété depuis un document', row.company_id, row.id]
        );
        updated.contacts.push(row);
      } else {
        const {rows: [row]} = await c.query(
          `INSERT INTO contacts(organization_id, name, company_id, job_title, department, phone, phone_work, whatsapp, owner_user_id, source, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [req.auth.organization_id, name, companyId, jobTitle, department, phone, phoneWork, whatsapp, req.auth.user_id, source || 'Document', status]
        );
        for (const address of normalizedEmails) {
          await c.query(
            'INSERT INTO contact_emails(organization_id, contact_id, email) VALUES($1,$2,$3)',
            [req.auth.organization_id, row.id, address]
          );
        }
        await c.query(
          'INSERT INTO activities(organization_id, actor_user_id, entity_type, entity_id, action, summary, company_id, contact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [req.auth.organization_id, req.auth.user_id, 'contacts', row.id, 'created', 'Contact créé depuis un document', row.company_id, row.id]
        );
        created.contacts.push(row);
      }
    }

    if (!created.companies.length && !created.contacts.length && !updated.companies.length && !updated.contacts.length && !linked.companies.length) {
      fail(400, 'Sélectionnez au moins une fiche à enregistrer.');
    }
    return {created, updated, linked};
  }));
}

module.exports = {installDocumentImport, assertQuotas, findCompanyMatches, findContactMatches, estimateCostUsd};
