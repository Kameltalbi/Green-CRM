const {decrypt} = require('./gmail-crypto');
const {email: normalizeEmail} = require('./validation');

const READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const INITIAL_DAYS = 90;
const PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 40;
const SKIP_LABELS = new Set(['SPAM', 'TRASH', 'DRAFT']);

function scopeList(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean);
  return [];
}

function hasReadScope(scope) {
  return scopeList(scope).includes(READ_SCOPE);
}

function hasSendScope(scope) {
  return scopeList(scope).includes(SEND_SCOPE);
}

function parseAddressList(header) {
  if (!header || typeof header !== 'string') return [];
  const found = [];
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  let match;
  while ((match = re.exec(header))) {
    try { found.push(normalizeEmail(match[0])); } catch { /* ignore malformed */ }
  }
  return [...new Set(found)];
}

function headerMap(payload) {
  const map = {};
  for (const header of payload?.headers || []) {
    if (header?.name && typeof header.value === 'string') map[header.name.toLowerCase()] = header.value;
  }
  return map;
}

function decodeBodyData(data) {
  if (!data || typeof data !== 'string') return '';
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractBodies(payload, acc = {text: '', html: '', attachments: false}) {
  if (!payload || typeof payload !== 'object') return acc;
  if (payload.filename) acc.attachments = true;
  const mime = String(payload.mimeType || '');
  if (payload.body?.data) {
    const chunk = decodeBodyData(payload.body.data);
    if (mime.startsWith('text/plain') && chunk) acc.text += (acc.text ? '\n' : '') + chunk;
    else if (mime.startsWith('text/html') && chunk) acc.html += chunk;
  }
  if (Array.isArray(payload.parts)) for (const part of payload.parts) extractBodies(part, acc);
  return acc;
}

function plainBody(payload) {
  const bodies = extractBodies(payload);
  if (bodies.text) return bodies.text.replace(/\0/g, '').slice(0, 100000);
  if (bodies.html) {
    return bodies.html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100000);
  }
  return '';
}

function isExcludedMessage(labelIds, matchedContacts) {
  if (!matchedContacts.length) return true;
  const labels = new Set(labelIds || []);
  for (const label of SKIP_LABELS) if (labels.has(label)) return true;
  return false;
}

function directionOf(labelIds, accountEmail, fromEmail) {
  const labels = new Set(labelIds || []);
  if (labels.has('SENT')) return 'outbound';
  if (fromEmail && accountEmail && fromEmail === accountEmail) return 'outbound';
  return 'inbound';
}

async function gmailFetch(accessToken, path, query = {}) {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/' + path);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {authorization: 'Bearer ' + accessToken},
    signal: AbortSignal.timeout(25000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = data.error?.status || data.error?.errors?.[0]?.reason || 'backendError';
    throw Object.assign(new Error('Gmail API'), {
      reason: typeof reason === 'string' ? reason : 'backendError',
      status: response.status,
      oauth: true
    });
  }
  return data;
}

async function loadContactEmailIndex(c) {
  const {rows} = await c.query(
    `SELECT e.contact_id, e.email, ct.company_id
     FROM contact_emails e
     JOIN contacts ct ON ct.id = e.contact_id`
  );
  const byEmail = new Map();
  for (const row of rows) {
    const list = byEmail.get(row.email) || [];
    list.push({contact_id: row.contact_id, company_id: row.company_id});
    byEmail.set(row.email, list);
  }
  return byEmail;
}

function matchContacts(byEmail, addresses) {
  const matched = [];
  const seen = new Set();
  for (const address of addresses) {
    for (const hit of byEmail.get(address) || []) {
      if (seen.has(hit.contact_id)) continue;
      seen.add(hit.contact_id);
      matched.push(hit);
    }
  }
  return matched;
}

async function upsertSyncedMessage(c, {organizationId, account, parsed, matched}) {
  if (parsed.rfc822_message_id) {
    const existing = await c.query(
      `SELECT id FROM gmail_synced_messages
       WHERE organization_id = $1 AND lower(rfc822_message_id) = lower($2) AND excluded = false
       LIMIT 1`,
      [organizationId, parsed.rfc822_message_id]
    );
    if (existing.rowCount) {
      const messageId = existing.rows[0].id;
      for (const hit of matched) {
        await c.query(
          `INSERT INTO gmail_synced_message_contacts(organization_id, message_id, contact_id)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [organizationId, messageId, hit.contact_id]
        );
      }
      return {id: messageId, inserted: false};
    }
  }

  const inserted = await c.query(
    `INSERT INTO gmail_synced_messages(
       organization_id, gmail_account_id, owner_user_id, gmail_message_id, gmail_thread_id, rfc822_message_id,
       direction, from_email, to_emails, cc_emails, subject, snippet, body_text, internal_date, has_attachments, excluded
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,false)
     ON CONFLICT (organization_id, gmail_account_id, gmail_message_id) DO UPDATE SET
       subject = EXCLUDED.subject,
       snippet = EXCLUDED.snippet,
       body_text = CASE WHEN EXCLUDED.body_text <> '' THEN EXCLUDED.body_text ELSE gmail_synced_messages.body_text END,
       has_attachments = EXCLUDED.has_attachments,
       updated_at = now()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      organizationId,
      account.id,
      account.user_id,
      parsed.gmail_message_id,
      parsed.gmail_thread_id,
      parsed.rfc822_message_id,
      parsed.direction,
      parsed.from_email,
      parsed.to_emails,
      parsed.cc_emails,
      parsed.subject,
      parsed.snippet,
      parsed.body_text,
      parsed.internal_date,
      parsed.has_attachments
    ]
  );
  const row = inserted.rows[0];
  for (const hit of matched) {
    await c.query(
      `INSERT INTO gmail_synced_message_contacts(organization_id, message_id, contact_id)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [organizationId, row.id, hit.contact_id]
    );
  }
  return {id: row.id, inserted: Boolean(row.inserted)};
}

function parseFullMessage(raw, accountEmail) {
  const labels = raw.labelIds || [];
  const headers = headerMap(raw.payload);
  const fromEmails = parseAddressList(headers.from || '');
  const toEmails = parseAddressList(headers.to || '');
  const ccEmails = parseAddressList(headers.cc || '');
  const fromEmail = fromEmails[0] || accountEmail || 'unknown@invalid';
  const bodies = extractBodies(raw.payload);
  const bodyText = plainBody(raw.payload);
  const rfc822 = String(headers['message-id'] || '').trim().slice(0, 998);
  const subject = String(headers.subject || raw.snippet || '(sans objet)').trim().slice(0, 998);
  const internalMs = Number(raw.internalDate) || Date.now();
  return {
    gmail_message_id: String(raw.id),
    gmail_thread_id: String(raw.threadId || ''),
    rfc822_message_id: rfc822,
    direction: directionOf(labels, accountEmail, fromEmail),
    from_email: fromEmail,
    to_emails: toEmails,
    cc_emails: ccEmails,
    subject: subject || '(sans objet)',
    snippet: String(raw.snippet || '').slice(0, 512),
    body_text: bodyText,
    internal_date: new Date(internalMs),
    has_attachments: Boolean(bodies.attachments),
    label_ids: labels
  };
}

async function fetchAndStoreMessage(c, config, account, accessToken, messageId, byEmail, stats) {
  const raw = await gmailFetch(accessToken, 'messages/' + encodeURIComponent(messageId), {format: 'full'});
  const parsed = parseFullMessage(raw, account.email);
  const addresses = [...new Set([parsed.from_email, ...parsed.to_emails, ...parsed.cc_emails])];
  const matched = matchContacts(byEmail, addresses);
  if (isExcludedMessage(parsed.label_ids, matched)) {
    stats.skipped += 1;
    return;
  }
  const result = await upsertSyncedMessage(c, {
    organizationId: account.organization_id,
    account,
    parsed,
    matched
  });
  if (result.inserted) stats.imported += 1;
  else stats.linked += 1;
}

async function syncAccount(db, config, accountId, options = {}) {
  const usableToken = options.usableToken;
  if (typeof usableToken !== 'function') throw new Error('usableToken requis.');

  return db.tenant(options.organizationId, async c => {
    const {rows: [account]} = await c.query('SELECT * FROM gmail_accounts WHERE id = $1 FOR UPDATE', [accountId]);
    if (!account) return {ok: false, code: 'missing'};
    if (!account.share_consent_at) return {ok: false, code: 'consent'};
    if (!hasReadScope(account.scope)) {
      await c.query("UPDATE gmail_accounts SET sync_status = 'needs_reauth', sync_error = $2 WHERE id = $1", [account.id, 'Lecture Gmail non autorisée.']);
      return {ok: false, code: 'needs_reauth'};
    }
    if (account.sync_status === 'running' && !options.force) return {ok: false, code: 'busy'};

    await c.query("UPDATE gmail_accounts SET sync_status = 'running', sync_error = '' WHERE id = $1", [account.id]);
    const ready = await usableToken(c, config, account);
    if (ready.failure) {
      await c.query("UPDATE gmail_accounts SET sync_status = 'needs_reauth', sync_error = $2 WHERE id = $1", [account.id, ready.failure.message.slice(0, 300)]);
      return {ok: false, code: ready.failure.code || 'expired'};
    }

    const stats = {imported: 0, linked: 0, skipped: 0, pages: 0};
    const byEmail = await loadContactEmailIndex(c);
    const accessToken = ready.token;
    let historyId = account.history_id || '';

    try {
      if (historyId && !options.full) {
        let pageToken = '';
        for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
          let data;
          try {
            data = await gmailFetch(accessToken, 'history', {
              startHistoryId: historyId,
              historyTypes: 'messageAdded',
              maxResults: PAGE_SIZE,
              pageToken: pageToken || undefined
            });
          } catch (error) {
            if (error.status === 404 || /historyId|notFound/i.test(String(error.reason || ''))) {
              historyId = '';
              break;
            }
            throw error;
          }
          stats.pages += 1;
          const ids = new Set();
          for (const entry of data.history || []) {
            for (const added of entry.messagesAdded || []) {
              if (added.message?.id) ids.add(added.message.id);
            }
          }
          for (const id of ids) await fetchAndStoreMessage(c, config, account, accessToken, id, byEmail, stats);
          if (data.historyId) historyId = String(data.historyId);
          pageToken = data.nextPageToken || '';
          if (!pageToken) break;
        }
      }

      if (!historyId || options.full) {
        const after = Math.floor((Date.now() - INITIAL_DAYS * 24 * 60 * 60 * 1000) / 1000);
        let pageToken = '';
        for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
          const data = await gmailFetch(accessToken, 'messages', {
            q: `after:${after} -in:trash -in:spam -in:drafts`,
            maxResults: PAGE_SIZE,
            pageToken: pageToken || undefined
          });
          stats.pages += 1;
          for (const item of data.messages || []) {
            await fetchAndStoreMessage(c, config, account, accessToken, item.id, byEmail, stats);
          }
          pageToken = data.nextPageToken || '';
          if (!pageToken) break;
        }
        const profile = await gmailFetch(accessToken, 'profile');
        if (profile.historyId) historyId = String(profile.historyId);
      }

      await c.query(
        `UPDATE gmail_accounts
         SET history_id = $2, last_synced_at = now(), sync_cursor_at = now(), sync_status = 'idle', sync_error = ''
         WHERE id = $1`,
        [account.id, historyId || account.history_id || null]
      );
      return {ok: true, ...stats, last_synced_at: new Date().toISOString()};
    } catch (error) {
      const message = error.status === 401 || error.reason === 'invalid_grant'
        ? 'Reconnectez ce compte Gmail.'
        : 'Synchronisation interrompue.';
      const status = error.status === 401 || error.reason === 'invalid_grant' ? 'needs_reauth' : 'error';
      await c.query('UPDATE gmail_accounts SET sync_status = $2, sync_error = $3 WHERE id = $1', [account.id, status, message.slice(0, 300)]);
      console.error('GmailSync', error.reason || error.code || 'sync');
      return {ok: false, code: status, ...stats};
    }
  });
}

async function listRecordEmails(c, {field, recordId, q, limit, offset, ownerUserId}) {
  const filters = ['msg.excluded = false'];
  const params = [];
  if (field === 'contact_id') {
    params.push(recordId);
    filters.push(`EXISTS (
      SELECT 1 FROM gmail_synced_message_contacts link
      WHERE link.message_id = msg.id AND link.contact_id = $${params.length}
    )`);
  } else {
    params.push(recordId);
    filters.push(`EXISTS (
      SELECT 1 FROM gmail_synced_message_contacts link
      JOIN contacts ct ON ct.id = link.contact_id
      WHERE link.message_id = msg.id AND ct.company_id = $${params.length}
    )`);
  }
  if (ownerUserId) {
    params.push(ownerUserId);
    filters.push(`msg.owner_user_id = $${params.length}`);
  }
  if (q) {
    params.push(q.toLowerCase());
    filters.push(`(
      strpos(lower(msg.subject), $${params.length}) > 0
      OR strpos(lower(msg.from_email), $${params.length}) > 0
      OR strpos(lower(array_to_string(msg.to_emails, ' ')), $${params.length}) > 0
      OR strpos(lower(msg.snippet), $${params.length}) > 0
    )`);
  }
  const where = filters.join(' AND ');
  const countParams = [...params];
  params.push(limit, offset);
  const {rows: items} = await c.query(
    `SELECT
       msg.id, msg.gmail_thread_id, msg.direction, msg.from_email, msg.to_emails, msg.cc_emails,
       msg.subject, msg.snippet, msg.internal_date, msg.has_attachments, msg.owner_user_id,
       msg.gmail_account_id, acc.email AS gmail_account_email, u.name AS owner_name
     FROM gmail_synced_messages msg
     JOIN gmail_accounts acc ON acc.id = msg.gmail_account_id
     JOIN users u ON u.id = msg.owner_user_id
     WHERE ${where}
     ORDER BY msg.internal_date DESC, msg.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const {rows: [count]} = await c.query(
    `SELECT count(*)::int AS total FROM gmail_synced_messages msg WHERE ${where}`,
    countParams
  );
  return {items, total: count.total, limit, offset};
}

async function getSyncedMessage(c, messageId) {
  const {rows: [msg]} = await c.query(
    `SELECT msg.*, acc.email AS gmail_account_email, u.name AS owner_name
     FROM gmail_synced_messages msg
     JOIN gmail_accounts acc ON acc.id = msg.gmail_account_id
     JOIN users u ON u.id = msg.owner_user_id
     WHERE msg.id = $1 AND msg.excluded = false`,
    [messageId]
  );
  return msg || null;
}

function startPeriodicSync({db, config, usableToken, intervalMs = 10 * 60 * 1000}) {
  if (config.disableGmailSyncLoop) return () => {};
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const {rows} = await db.pool.query(
        `SELECT id, organization_id FROM gmail_accounts
         WHERE status = 'active' AND share_consent_at IS NOT NULL AND sync_status IN ('idle', 'error')
         ORDER BY COALESCE(last_synced_at, to_timestamp(0)) ASC
         LIMIT 10`
      );
      for (const row of rows) {
        if (stopped) break;
        await syncAccount(db, config, row.id, {organizationId: row.organization_id, usableToken});
      }
    } catch (error) {
      console.error('GmailSync', error.code || 'loop');
    }
  };
  const timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  setTimeout(tick, 15000).unref?.();
  return () => { stopped = true; clearInterval(timer); };
}

module.exports = {
  READ_SCOPE,
  INITIAL_DAYS,
  hasReadScope,
  hasSendScope,
  scopeList,
  parseAddressList,
  syncAccount,
  listRecordEmails,
  getSyncedMessage,
  startPeriodicSync,
  parseFullMessage,
  matchContacts
};
