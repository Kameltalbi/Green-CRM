const {decrypt} = require('./gmail-crypto');

const ELIGIBLE_WHERE = `closure_status = 'pending_deletion'
    AND closure_cancelled_at IS NULL
    AND closure_cancelled_by IS NULL
    AND closure_requested_at IS NOT NULL
    AND closure_scheduled_at IS NOT NULL
    AND closure_scheduled_at <= clock_timestamp()
    AND closure_requested_at + interval '30 days' <= clock_timestamp()`;
const ELIGIBLE_SQL = `SELECT id FROM organizations WHERE ${ELIGIBLE_WHERE} ORDER BY closure_scheduled_at, id`;

const CHILD_TABLES = [
  'document_extractions',
  'gmail_synced_message_contacts',
  'gmail_synced_messages',
  'gmail_messages',
  'gmail_oauth_states',
  'gmail_accounts',
  'activities',
  'followups',
  'contact_card_images',
  'notes',
  'contact_emails',
  'contacts',
  'companies',
  'invitations'
];

function safeCode(error) {
  return typeof error?.code === 'string' && /^[0-9A-Za-z]{2,5}$/.test(error.code) ? error.code : 'erreur';
}

function externalFiles() {
  return [];
}

async function purgeExternalFiles(files, remove, attempts = 3) {
  const failed = [];
  for (const file of files) {
    let removed = false;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await remove(file);
        removed = true;
        break;
      } catch { /* nouvelle tentative après l'échec */ }
    }
    if (!removed) failed.push(file);
  }
  return failed;
}

async function revokeGoogleToken(token) {
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({token})
  });
  if (!response.ok && response.status !== 400) throw Object.assign(new Error('Révocation impossible.'), {code: 'REVOC'});
}

async function listEligible(db) {
  const {rows} = await db.pool.query(ELIGIBLE_SQL);
  return rows.map(row => row.id);
}

async function lockEligible(client, organizationId) {
  const {rows} = await client.query(`SELECT id FROM organizations WHERE id = $1 FOR UPDATE`, [organizationId]);
  if (!rows.length) return {id: organizationId, outcome: 'absent'};
  const {rows: eligible} = await client.query(`SELECT id FROM organizations WHERE id = $1 AND ${ELIGIBLE_WHERE}`, [organizationId]);
  if (!eligible.length) return {id: organizationId, outcome: 'ignore'};
  return {id: organizationId, outcome: 'eligible'};
}

async function collectTokens(client, organizationId, secret) {
  const {rows} = await client.query('SELECT access_token_enc, refresh_token_enc FROM gmail_accounts WHERE organization_id = $1', [organizationId]);
  const tokens = [];
  let unreadable = false;
  for (const row of rows) {
    for (const value of [row.refresh_token_enc, row.access_token_enc]) {
      if (!value) continue;
      if (!secret) { unreadable = true; continue; }
      try { tokens.push(decrypt(secret, value)); } catch { unreadable = true; }
    }
  }
  return {tokens, unreadable};
}

async function erase(client, organizationId) {
  for (const table of CHILD_TABLES) {
    await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [organizationId]);
  }
  await client.query(`UPDATE auth_sessions AS session SET organization_id = next.organization_id
    FROM (
      SELECT DISTINCT ON (membership.user_id) membership.user_id, membership.organization_id
      FROM memberships membership
      WHERE membership.organization_id <> $1 AND membership.active = true
        AND membership.user_id IN (SELECT user_id FROM auth_sessions WHERE organization_id = $1)
      ORDER BY membership.user_id, membership.created_at, membership.organization_id
    ) AS next
    WHERE session.organization_id = $1 AND session.user_id = next.user_id`, [organizationId]);
  await client.query('DELETE FROM auth_sessions WHERE organization_id = $1', [organizationId]);
  await client.query('DELETE FROM memberships WHERE organization_id = $1', [organizationId]);
  const removed = await client.query(`DELETE FROM organizations WHERE id = $1 AND closure_status = 'pending_deletion' AND closure_scheduled_at <= clock_timestamp()`, [organizationId]);
  if (removed.rowCount !== 1) throw Object.assign(new Error('État changé.'), {code: 'ETAT'});
}

async function revokeCollected(tokens, unreadable, revoke) {
  if (!tokens.length) return unreadable ? 'indisponible' : 'aucune';
  let failed = false;
  for (const token of tokens) {
    try { await revoke(token); } catch { failed = true; }
  }
  if (failed) return 'echec';
  return unreadable ? 'indisponible' : 'ok';
}

async function deleteExpiredOrganization(db, organizationId, options = {}) {
  const tokens = [];
  let unreadable = false;
  let result;
  try {
    result = await db.tenant(organizationId, async client => {
      const decision = await lockEligible(client, organizationId);
      if (decision.outcome !== 'eligible') return decision;
      const collected = await collectTokens(client, organizationId, options.secret);
      tokens.push(...collected.tokens);
      unreadable = collected.unreadable;
      await erase(client, organizationId);
      if (options.beforeCommit) await options.beforeCommit(client);
      return {id: organizationId, outcome: 'supprime', files: externalFiles()};
    });
  } catch (error) {
    return {id: organizationId, outcome: 'echec', code: safeCode(error)};
  }
  if (result.outcome !== 'supprime') return result;
  const revocation = await revokeCollected(tokens, unreadable, options.revoke || revokeGoogleToken);
  const failedFiles = await purgeExternalFiles(result.files || [], options.removeFile || (async () => {}));
  return {id: organizationId, outcome: 'supprime', revocation, filesFailed: failedFiles.length > 0};
}

async function runDeletion(db, options = {}) {
  const ids = await listEligible(db);
  if (!options.execute) return {mode: 'simulation', ids, results: []};
  const results = [];
  for (const id of ids) {
    results.push(await deleteExpiredOrganization(db, id, options.beforeCommit ? {...options, beforeCommit: options.beforeCommit(id)} : options));
  }
  return {mode: 'execution', ids, results};
}

function formatReport(report) {
  const lines = [`mode=${report.mode}`, `espaces=${report.ids.length}`];
  if (report.mode === 'execution') {
    lines.push(`supprimes=${report.results.filter(result => result.outcome === 'supprime').length}`);
    lines.push(`echecs=${report.results.filter(result => result.outcome === 'echec').length}`);
    for (const result of report.results) {
      let line = `id=${result.id} resultat=${result.outcome}`;
      if (result.code) line += ` code=${result.code}`;
      if (result.revocation === 'echec' || result.revocation === 'indisponible') line += ` revocation=${result.revocation}`;
      if (result.filesFailed) line += ' fichiers=echec';
      lines.push(line);
    }
  } else {
    for (const id of report.ids) lines.push(`id=${id}`);
  }
  return lines.join('\n') + '\n';
}

module.exports = {
  listEligible,
  deleteExpiredOrganization,
  runDeletion,
  formatReport,
  purgeExternalFiles,
  ELIGIBLE_SQL,
  ELIGIBLE_WHERE,
  CHILD_TABLES
};
