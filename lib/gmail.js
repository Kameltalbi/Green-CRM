const crypto = require('node:crypto');
const {OAuth2Client} = require('google-auth-library');
const {fail, uuid, text, email, allowed, hash, token} = require('./validation');
const {encrypt, decrypt} = require('./gmail-crypto');

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
// openid et email identifient le compte choisi. Ils ne lisent pas la boîte.
const SCOPES = [SEND_SCOPE, 'openid', 'email'];
const MAX_ATTACHMENT_BYTES = 7_000_000;
const SETTINGS = '/app/parametres?section=email';

function configured(config) {
  return Boolean(config.gmailClientId && config.gmailClientSecret && config.gmailRedirectUri);
}

function providerFor(config) {
  return config.gmailGoogle || createGmailProvider(config);
}

function createGmailProvider(config) {
  const oauth = () => new OAuth2Client(config.gmailClientId, config.gmailClientSecret, config.gmailRedirectUri);
  return {
    authorizationUrl({state, codeChallenge}) {
      return oauth().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent select_account',
        include_granted_scopes: false,
        scope: SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        redirect_uri: config.gmailRedirectUri
      });
    },
    async exchange({code, codeVerifier}) {
      const client = oauth();
      let tokens;
      try {
        ({tokens} = await client.getToken({code, codeVerifier, redirect_uri: config.gmailRedirectUri}));
      } catch (error) {
        throw cleanOAuthError(error, 'token_exchange_failed');
      }
      const scope = typeof tokens.scope === 'string' ? tokens.scope : '';
      if (!scope.split(/\s+/).includes(SEND_SCOPE) || !tokens.access_token) {
        if (tokens.access_token) await revokeQuiet(tokens.access_token);
        throw Object.assign(new Error('Autorisation incomplète.'), {reason: 'insufficient_scope', status: 403, oauth: true});
      }
      const identity = await identityOf(client, tokens, config.gmailClientId);
      if (!identity) {
        await revokeQuiet(tokens.access_token);
        throw Object.assign(new Error('Adresse non confirmée.'), {reason: 'identity', status: 403, oauth: true});
      }
      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || '',
        expires_in: tokens.expiry_date ? Math.max(0, Math.round((tokens.expiry_date - Date.now()) / 1000)) : 3600,
        scope,
        email: identity.email,
        sub: identity.sub
      };
    },
    async refresh(refreshToken) {
      const body = new URLSearchParams({
        client_id: config.gmailClientId,
        client_secret: config.gmailClientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      });
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body,
        signal: AbortSignal.timeout(20000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) throw Object.assign(new Error('Renouvellement refusé.'), {reason: safeReason(data.error) || 'invalid_grant', status: response.status || 400, oauth: true});
      return {access_token: data.access_token, refresh_token: data.refresh_token || '', expires_in: Number(data.expires_in) || 3600};
    },
    async revoke(value) {
      const response = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({token: value}),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok && response.status !== 400) throw Object.assign(new Error('Révocation refusée.'), {reason: 'revoke_failed', status: response.status, oauth: true});
    },
    async send({accessToken, raw}) {
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {authorization: 'Bearer ' + accessToken, 'content-type': 'application/json'},
        body: JSON.stringify({raw}),
        signal: AbortSignal.timeout(20000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const reason = data.error?.errors?.[0]?.reason || data.error?.status;
        throw Object.assign(new Error('Envoi refusé.'), {reason: safeReason(reason) || 'backendError', status: response.status, oauth: true});
      }
      if (!data.id) throw Object.assign(new Error('Confirmation absente.'), {reason: 'unconfirmed', status: 502, oauth: true});
      return {id: String(data.id)};
    }
  };
}

function safeReason(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : '';
}

function cleanOAuthError(error, fallback) {
  const reason = safeReason(error?.response?.data?.error) || fallback;
  return Object.assign(new Error('Echange refusé.'), {reason, status: error?.response?.status || 400, oauth: true});
}

async function revokeQuiet(value) {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({token: value}),
      signal: AbortSignal.timeout(20000)
    });
  } catch { /* la révocation reste indicative */ }
}

async function identityOf(client, tokens, audience) {
  if (tokens.id_token) {
    try {
      const ticket = await client.verifyIdToken({idToken: tokens.id_token, audience});
      const payload = ticket.getPayload() || {};
      if (payload.email_verified && payload.email && payload.sub) return {email: String(payload.email).toLowerCase(), sub: String(payload.sub)};
    } catch { /* essai suivant */ }
  }
  if (!tokens.access_token) return null;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {authorization: 'Bearer ' + tokens.access_token},
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data || data.email_verified === false || typeof data.email !== 'string' || typeof data.sub !== 'string') return null;
  return {email: data.email.toLowerCase(), sub: data.sub};
}

function publicAccount(row) {
  return {id: row.id, email: row.email, status: row.status, isDefault: row.is_default, connectedAt: row.created_at};
}

function requireConfigured(config) {
  if (!configured(config)) fail(503, 'La connexion Gmail n’est pas disponible.');
}

function stateValue(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  return value;
}

function idempotencyKey(value) {
  const key = text(value, 'clé d’envoi', 80);
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) fail(400, 'Clé d’envoi invalide.');
  return key;
}

function attachmentsOf(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) fail(400, 'Cinq pièces jointes maximum.');
  let total = 0;
  return value.map(file => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) fail(400, 'Pièce jointe invalide.');
    allowed(file, ['filename', 'mime_type', 'data']);
    const filename = text(file.filename, 'nom de fichier', 180).replace(/[\r\n"]/g, '');
    if (!filename || /[/\\]/.test(filename)) fail(400, 'Nom de fichier invalide.');
    const mime = text(file.mime_type, 'type de fichier', 120);
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) fail(400, 'Type de fichier invalide.');
    if (typeof file.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) fail(400, 'Pièce jointe invalide.');
    const bytes = Buffer.from(file.data, 'base64');
    if (!bytes.length) fail(400, 'Pièce jointe vide.');
    total += bytes.length;
    if (total > MAX_ATTACHMENT_BYTES) fail(400, 'Les pièces jointes dépassent 7 Mo.');
    return {filename, mime, data: file.data.replace(/\s/g, '')};
  });
}

function header(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function buildRaw({from, to, subject, body, attachments}) {
  const encodedBody = Buffer.from(body, 'utf8').toString('base64');
  const subjectHeader = /^[\x20-\x7E]*$/.test(subject) ? subject : '=?UTF-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';
  if (!attachments.length) {
    return Buffer.from([
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subjectHeader}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      encodedBody
    ].join('\r\n')).toString('base64url');
  }
  const boundary = 'ciblix_' + crypto.randomBytes(12).toString('hex');
  const parts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subjectHeader}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    encodedBody
  ];
  for (const file of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${file.mime}`,
      `Content-Disposition: attachment; filename="${file.filename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      file.data
    );
  }
  parts.push(`--${boundary}--`, '');
  return Buffer.from(parts.join('\r\n')).toString('base64url');
}

function sendFailure(error) {
  const reason = error.reason || '';
  if (reason === 'invalid_grant' || reason === 'invalid_token' || error.status === 401) return {status: 409, message: 'Reconnectez ce compte Gmail.', code: 'expired', expire: true};
  if (error.status === 429 || ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'].includes(reason)) return {status: 429, message: 'L’envoi est momentanément limité. Réessayez plus tard.', code: 'quota'};
  return {status: 502, message: 'L’envoi n’a pas abouti. Aucun message n’a été envoyé.', code: 'rejected'};
}

async function markExpired(c, account) {
  await c.query("UPDATE gmail_accounts SET status='expired', access_token_enc='', refresh_token_enc=NULL, access_token_expires_at=now() WHERE id=$1 AND user_id=$2", [account.id, account.user_id]);
}

async function usableToken(c, config, account) {
  const fresh = account.status === 'active' && account.access_token_expires_at && new Date(account.access_token_expires_at).getTime() > Date.now() + 60_000 && account.access_token_enc;
  if (fresh) {
    try { return {token: decrypt(config.authSecret, account.access_token_enc)}; } catch { /* renouvellement */ }
  }
  if (!account.refresh_token_enc) {
    await markExpired(c, account);
    return {failure: {status: 409, message: 'Reconnectez ce compte Gmail.', code: 'expired'}};
  }
  let refreshToken;
  try { refreshToken = decrypt(config.authSecret, account.refresh_token_enc); }
  catch {
    await markExpired(c, account);
    return {failure: {status: 409, message: 'Reconnectez ce compte Gmail.', code: 'expired'}};
  }
  try {
    const next = await providerFor(config).refresh(refreshToken);
    const expires = new Date(Date.now() + Math.max(0, next.expires_in) * 1000);
    const refreshEnc = next.refresh_token ? encrypt(config.authSecret, next.refresh_token) : account.refresh_token_enc;
    await c.query("UPDATE gmail_accounts SET access_token_enc=$2, refresh_token_enc=$3, access_token_expires_at=$4, status='active' WHERE id=$1", [account.id, encrypt(config.authSecret, next.access_token), refreshEnc, expires]);
    return {token: next.access_token};
  } catch (error) {
    const mapped = sendFailure(error);
    if (mapped.expire) await markExpired(c, account);
    return {failure: mapped};
  }
}

async function gmailConnected(c, userId) {
  const {rows: [row]} = await c.query("SELECT EXISTS(SELECT 1 FROM gmail_accounts WHERE user_id=$1 AND status='active') AS connected", [userId]);
  return Boolean(row?.connected);
}

function installGmail(api, {route, db, config, entity}) {
  api.get('/gmail/accounts', route(async (req, c) => {
    const {rows} = await c.query('SELECT id, email, status, is_default, created_at FROM gmail_accounts WHERE user_id=$1 ORDER BY is_default DESC, created_at', [req.auth.user_id]);
    return {configured: configured(config), accounts: rows.map(publicAccount)};
  }));

  api.post('/gmail/connect', route(async (req, c) => {
    requireConfigured(config);
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) fail(400, 'Champs non autorisés.');
    await c.query('DELETE FROM gmail_oauth_states WHERE user_id=$1 AND expires_at<=now()', [req.auth.user_id]);
    const state = token();
    const verifier = crypto.randomBytes(32).toString('base64url');
    await c.query('INSERT INTO gmail_oauth_states(state_hash, organization_id, user_id, verifier_enc, expires_at) VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')', [hash(state), req.auth.organization_id, req.auth.user_id, encrypt(config.authSecret, verifier)]);
    const url = providerFor(config).authorizationUrl({state, codeChallenge: crypto.createHash('sha256').update(verifier).digest('base64url')});
    return {url};
  }));

  api.post('/gmail/accounts/:id/default', route(async (req, c) => {
    const id = uuid(req.params.id);
    const {rows: [account]} = await c.query('SELECT id, status FROM gmail_accounts WHERE id=$1 AND user_id=$2 FOR UPDATE', [id, req.auth.user_id]);
    if (!account) fail(404, 'Compte Gmail introuvable.');
    if (account.status !== 'active') fail(409, 'Reconnectez ce compte avant de le choisir par défaut.');
    await c.query('UPDATE gmail_accounts SET is_default=false WHERE user_id=$1', [req.auth.user_id]);
    await c.query('UPDATE gmail_accounts SET is_default=true WHERE id=$1 AND user_id=$2', [account.id, req.auth.user_id]);
    return {ok: true};
  }));

  api.delete('/gmail/accounts/:id', route(async (req, c) => {
    const id = uuid(req.params.id);
    const {rows: [account]} = await c.query('SELECT * FROM gmail_accounts WHERE id=$1 AND user_id=$2', [id, req.auth.user_id]);
    if (!account) fail(404, 'Compte Gmail introuvable.');
    await c.query('DELETE FROM gmail_accounts WHERE id=$1 AND user_id=$2', [account.id, req.auth.user_id]);
    const stored = account.refresh_token_enc || account.access_token_enc;
    if (stored) {
      try { await providerFor(config).revoke(decrypt(config.authSecret, stored)); } catch { /* le compte local est déjà retiré */ }
    }
    return {status: 204};
  }));

  api.post('/gmail/messages', route(async (req, c) => {
    requireConfigured(config);
    allowed(req.body, ['account_id', 'contact_id', 'company_id', 'to', 'subject', 'body', 'attachments', 'idempotency_key']);
    const accountId = uuid(req.body.account_id);
    const to = email(req.body.to);
    const subject = header(text(req.body.subject, 'objet', 300));
    const body = text(req.body.body, 'message', 20000);
    if (!subject) fail(400, 'Champ objet invalide.');
    const attachments = attachmentsOf(req.body.attachments);
    const key = idempotencyKey(req.body.idempotency_key);
    let contactId = req.body.contact_id ? uuid(req.body.contact_id) : null;
    let companyId = req.body.company_id ? uuid(req.body.company_id) : null;
    if (!contactId && !companyId) fail(400, 'Choisissez une fiche.');
    if (contactId) {
      const contact = await entity(c, 'contacts', contactId);
      if (companyId && contact.company_id !== companyId) fail(400, 'Le contact ne correspond pas à cette entreprise.');
      companyId = contact.company_id || companyId;
    } else await entity(c, 'companies', companyId);

    const {rows: [account]} = await c.query('SELECT * FROM gmail_accounts WHERE id=$1 AND user_id=$2 FOR UPDATE', [accountId, req.auth.user_id]);
    if (!account) fail(404, 'Compte Gmail introuvable.');
    const inserted = await c.query("INSERT INTO gmail_messages(organization_id, user_id, gmail_account_id, contact_id, company_id, to_email, subject, body, status, idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'sending',$9) ON CONFLICT (organization_id, user_id, idempotency_key) DO NOTHING RETURNING id", [req.auth.organization_id, req.auth.user_id, account.id, contactId, companyId, to, subject, body, key]);
    let messageId = inserted.rows[0]?.id;
    if (!messageId) {
      const {rows: [existing]} = await c.query('SELECT * FROM gmail_messages WHERE user_id=$1 AND idempotency_key=$2', [req.auth.user_id, key]);
      if (!existing) fail(409, 'Un envoi est déjà en cours.');
      if (existing.status === 'sent') return {status: 200, data: sentPayload(existing)};
      if (existing.status === 'sending') fail(409, 'Un envoi est déjà en cours.');
      const claimed = await c.query("UPDATE gmail_messages SET status='sending', error_code='', gmail_account_id=$2, contact_id=$3, company_id=$4, to_email=$5, subject=$6, body=$7 WHERE id=$1 AND user_id=$8 AND status='failed' RETURNING id", [existing.id, account.id, contactId, companyId, to, subject, body, req.auth.user_id]);
      if (!claimed.rowCount) fail(409, 'Un envoi est déjà en cours.');
      messageId = existing.id;
    }
    const ready = await usableToken(c, config, account);
    if (ready.failure) {
      await c.query("UPDATE gmail_messages SET status='failed', error_code=$2 WHERE id=$1", [messageId, ready.failure.code]);
      return {status: ready.failure.status, data: {message: ready.failure.message}};
    }
    let sent;
    try {
      sent = await providerFor(config).send({accessToken: ready.token, raw: buildRaw({from: account.email, to, subject, body, attachments})});
    } catch (error) {
      const mapped = sendFailure(error);
      if (mapped.expire) await markExpired(c, account);
      await c.query("UPDATE gmail_messages SET status='failed', error_code=$2 WHERE id=$1", [messageId, mapped.code]);
      console.error('Gmail', mapped.code);
      return {status: mapped.status, data: {message: mapped.message}};
    }
    const excerpt = body.replace(/\s+/g, ' ').slice(0, 280);
    const summary = `E-mail envoyé à ${to} — ${subject}. ${excerpt}`;
    await c.query("UPDATE gmail_messages SET status='sent', gmail_message_id=$2, error_code='' WHERE id=$1 AND status='sending'", [messageId, sent.id]);
    await c.query('INSERT INTO activities(organization_id, actor_user_id, entity_type, entity_id, action, summary, company_id, contact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [req.auth.organization_id, req.auth.user_id, 'gmail_messages', messageId, 'sent', summary, companyId, contactId]);
    const {rows: [saved]} = await c.query('SELECT * FROM gmail_messages WHERE id=$1', [messageId]);
    return {status: 201, data: sentPayload(saved)};
  }));

  api.get('/gmail/callback', async (req, res) => {
    let etat = 'indisponible';
    try { etat = await completeOAuth(req, db, config); }
    catch (error) { console.error('Gmail', error.reason || error.code || 'callback'); }
    res.redirect(SETTINGS + '&etat=' + etat);
  });
}

function sentPayload(row) {
  return {id: row.id, status: row.status, to: row.to_email, subject: row.subject, gmailMessageId: row.gmail_message_id, contactId: row.contact_id, companyId: row.company_id};
}

async function completeOAuth(req, db, config) {
  if (!configured(config)) return 'indisponible';
  const state = stateValue(req.query.state);
  if (req.query.error === 'access_denied') {
    if (state) await db.tenant(req.auth.organization_id, c => c.query('DELETE FROM gmail_oauth_states WHERE state_hash=$1 AND user_id=$2', [hash(state), req.auth.user_id]));
    return 'refuse';
  }
  if (req.query.error || !state || typeof req.query.code !== 'string' || req.query.code.length < 2 || req.query.code.length > 2048 || /[\s&]/.test(req.query.code)) return 'invalide';
  return db.tenant(req.auth.organization_id, async c => {
    const {rows: [organization]} = await c.query('SELECT closure_status FROM organizations WHERE id=$1 FOR UPDATE', [req.auth.organization_id]);
    if (organization?.closure_status === 'pending_deletion') return 'suspendu';
    const {rows: [saved]} = await c.query('DELETE FROM gmail_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING *', [hash(state)]);
    if (!saved || saved.user_id !== req.auth.user_id) return 'invalide';
    let verifier;
    try { verifier = decrypt(config.authSecret, saved.verifier_enc); }
    catch { return 'invalide'; }
    let exchanged;
    try { exchanged = await providerFor(config).exchange({code: req.query.code, codeVerifier: verifier}); }
    catch (error) { console.error('Gmail', error.reason || 'exchange'); return error.reason === 'identity' ? 'identite' : 'invalide'; }
    let address;
    let subject;
    try {
      address = email(exchanged.email);
      subject = text(exchanged.sub, 'compte', 255);
      if (!/^[A-Za-z0-9_-]{1,255}$/.test(subject)) throw new Error('sub');
      if (!String(exchanged.scope || '').split(/\s+/).includes(SEND_SCOPE)) throw new Error('scope');
    } catch { return 'identite'; }
    const accessEnc = encrypt(config.authSecret, exchanged.access_token);
    const refreshEnc = exchanged.refresh_token ? encrypt(config.authSecret, exchanged.refresh_token) : null;
    const expires = new Date(Date.now() + Math.max(0, Number(exchanged.expires_in) || 0) * 1000);
    await c.query(`INSERT INTO gmail_accounts(organization_id, user_id, email, google_sub, access_token_enc, refresh_token_enc, access_token_expires_at, scope, status, is_default)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active', NOT EXISTS(SELECT 1 FROM gmail_accounts WHERE organization_id=$1 AND user_id=$2))
      ON CONFLICT (organization_id, user_id, google_sub) DO UPDATE SET email=EXCLUDED.email, access_token_enc=EXCLUDED.access_token_enc, refresh_token_enc=COALESCE(EXCLUDED.refresh_token_enc, gmail_accounts.refresh_token_enc), access_token_expires_at=EXCLUDED.access_token_expires_at, scope=EXCLUDED.scope, status='active'`, [req.auth.organization_id, req.auth.user_id, address, subject, accessEnc, refreshEnc, expires, SEND_SCOPE]);
    return 'connecte';
  });
}

module.exports = {installGmail, gmailConnected, createGmailProvider, SEND_SCOPE, SCOPES};
