const {fail, uuid, allowed} = require('./validation');

const ZONE = 'Africa/Tunis';
const FRESH_MS = 2 * 60 * 1000;
const freshAt = new Map();
const KIND_LABEL = {no_reply: 'Sans réponse', inactive: 'Sans activité récente', overdue: 'Relance en retard'};
const PRIORITY_LABEL = {1: 'Haute', 2: 'Moyenne', 3: 'Basse'};

function zonedDay(value, timeZone = ZONE) {
  return new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(value));
}

function shiftDay(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function businessDaysBetween(startIso, endIso) {
  let count = 0;
  let cursor = shiftDay(startIso, 1);
  while (cursor <= endIso) {
    const weekday = new Date(cursor + 'T00:00:00Z').getUTCDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    cursor = shiftDay(cursor, 1);
  }
  return count;
}

function calendarDaysBetween(startIso, endIso) {
  const start = Date.parse(startIso + 'T00:00:00Z');
  const end = Date.parse(endIso + 'T00:00:00Z');
  return Math.round((end - start) / 86400000);
}

function integer(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

async function organizationId(c) {
  const {rows: [row]} = await c.query(`SELECT current_setting('app.organization_id', true) AS id`);
  return row.id;
}

async function readSettings(c) {
  const {rows: [org]} = await c.query(`SELECT followup_business_days, profile FROM organizations WHERE id = current_setting('app.organization_id', true)::uuid`);
  const stored = Number(org?.followup_business_days);
  const inactive = Number(org?.profile?.followup_inactive_days);
  return {
    no_reply_business_days: Number.isInteger(stored) && stored >= 1 && stored <= 60 ? stored : 5,
    inactive_days: Number.isInteger(inactive) && inactive >= 7 && inactive <= 365 ? inactive : 30
  };
}

function present(row) {
  return {
    id: row.id,
    kind: row.kind,
    kind_label: KIND_LABEL[row.kind] || row.kind,
    priority: row.priority,
    priority_label: PRIORITY_LABEL[row.priority] || '',
    reason: row.reason,
    subject: row.subject,
    contact_id: row.contact_id,
    contact_name: row.contact_name,
    company_name: row.company_name || '',
    email: row.email || '',
    owner_user_id: row.owner_user_id,
    followup_id: row.followup_id,
    message_id: row.message_id,
    due_at: row.due_at
  };
}

async function list(c, query = {}) {
  const settings = await readSettings(c);
  const limit = Math.min(50, Math.max(1, integer(query.limit) || 20));
  const offset = Math.max(0, integer(query.offset) || 0);
  if (query.limit !== undefined && integer(query.limit) === null) fail(400, 'Pagination invalide.');
  if (query.offset !== undefined && integer(query.offset) === null) fail(400, 'Pagination invalide.');
  const params = [];
  let contact = '';
  if (query.contact_id) {
    params.push(uuid(query.contact_id));
    contact = ` AND s.contact_id = $${params.length}`;
  }
  const where = `s.status = 'open'${contact}`;
  const {rows: [count]} = await c.query(
    `SELECT count(*)::int AS total
     FROM followup_suggestions s
     JOIN contacts c ON c.id = s.contact_id
     WHERE ${where} AND c.archived_at IS NULL`,
    params
  );
  params.push(limit, offset);
  const {rows} = await c.query(
    `SELECT s.id, s.kind, s.priority, s.reason, s.subject, s.contact_id, s.owner_user_id,
            s.followup_id, s.message_id, s.due_at, c.name AS contact_name, co.name AS company_name,
            (SELECT email FROM contact_emails e WHERE e.contact_id = c.id ORDER BY email LIMIT 1) AS email
     FROM followup_suggestions s
     JOIN contacts c ON c.id = s.contact_id
     LEFT JOIN companies co ON co.id = c.company_id
     WHERE ${where} AND c.archived_at IS NULL
     ORDER BY s.priority, s.detected_at, s.id
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {items: rows.map(present), total: count.total, limit, offset, settings};
}

async function remember(c, orgId, item, states, active) {
  const state = states.get(item.source_key);
  if (state && (state.status === 'ignored' || state.status === 'done')) return;
  active.add(item.source_key);
  if (state && state.status === 'snoozed' && state.snooze_until && new Date(state.snooze_until).getTime() > Date.now()) {
    await c.query(
      `UPDATE followup_suggestions
       SET reason = $2, priority = $3, subject = $4, message_id = $5, followup_id = $6, due_at = $7, owner_user_id = $8, company_id = $9
       WHERE source_key = $1 AND status = 'snoozed'`,
      [item.source_key, item.reason, item.priority, item.subject, item.message_id, item.followup_id, item.due_at, item.owner_user_id, item.company_id]
    );
    return;
  }
  await c.query(
    `INSERT INTO followup_suggestions(
       organization_id, contact_id, company_id, owner_user_id, kind, source_key, priority, reason, subject, message_id, followup_id, due_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (organization_id, source_key) DO UPDATE SET
       status = 'open', reason = EXCLUDED.reason, priority = EXCLUDED.priority, subject = EXCLUDED.subject,
       message_id = EXCLUDED.message_id, followup_id = EXCLUDED.followup_id, due_at = EXCLUDED.due_at,
       owner_user_id = EXCLUDED.owner_user_id, company_id = EXCLUDED.company_id, contact_id = EXCLUDED.contact_id,
       snooze_until = NULL, resolved_at = NULL
     WHERE followup_suggestions.status IN ('open', 'snoozed')`,
    [orgId, item.contact_id, item.company_id, item.owner_user_id, item.kind, item.source_key, item.priority, item.reason, item.subject, item.message_id, item.followup_id, item.due_at]
  );
}

async function analyze(c) {
  const orgId = await organizationId(c);
  const {rows: [org]} = await c.query(`SELECT closure_status FROM organizations WHERE id = $1`, [orgId]);
  if (org?.closure_status === 'pending_deletion') {
    freshAt.set(orgId, Date.now());
    return;
  }
  const settings = await readSettings(c);
  const today = zonedDay(new Date());
  const {rows: states} = await c.query(`SELECT source_key, status, snooze_until FROM followup_suggestions`);
  const known = new Map(states.map(row => [row.source_key, row]));
  const active = new Set();

  const {rows: outbound} = await c.query(
    `SELECT m.id, m.subject, m.internal_date, m.gmail_thread_id, l.contact_id, c.owner_user_id, c.company_id
     FROM gmail_synced_messages m
     JOIN gmail_synced_message_contacts l ON l.message_id = m.id
     JOIN contacts c ON c.id = l.contact_id
     WHERE m.direction = 'outbound' AND m.excluded = false AND c.archived_at IS NULL
       AND c.status NOT IN ('perdu', 'inactif')
       AND m.internal_date < now() - interval '1 day'
     ORDER BY m.internal_date ASC
     LIMIT 1000`
  );
  const byContact = new Map();
  for (const row of outbound) {
    const days = businessDaysBetween(zonedDay(row.internal_date), today);
    if (days < settings.no_reply_business_days) continue;
    const {rows: [reply]} = await c.query(
      `SELECT 1
       FROM gmail_synced_messages reply
       JOIN gmail_synced_message_contacts link ON link.message_id = reply.id AND link.contact_id = $2
       WHERE reply.direction = 'inbound' AND reply.excluded = false AND reply.internal_date > $3
         AND ($1 = '' OR reply.gmail_thread_id = $1)
       LIMIT 1`,
      [row.gmail_thread_id || '', row.contact_id, row.internal_date]
    );
    if (reply) continue;
    const key = 'no_reply:' + row.id;
    const listForContact = byContact.get(row.contact_id) || [];
    listForContact.push({row, days, key});
    byContact.set(row.contact_id, listForContact);
  }
  for (const listForContact of byContact.values()) {
    const chosen = listForContact.find(item => {
      const state = known.get(item.key);
      return !state || (state.status !== 'ignored' && state.status !== 'done');
    });
    if (!chosen) continue;
    const subject = String(chosen.row.subject || '').slice(0, 300);
    await remember(c, orgId, {
      contact_id: chosen.row.contact_id,
      company_id: chosen.row.company_id,
      owner_user_id: chosen.row.owner_user_id,
      kind: 'no_reply',
      source_key: chosen.key,
      priority: chosen.days >= settings.no_reply_business_days * 2 ? 1 : 2,
      reason: `E-mail « ${subject || 'Sans objet'} » envoyé il y a ${chosen.days} jours ouvrés, sans réponse dans la conversation.`.slice(0, 500),
      subject,
      message_id: chosen.row.id,
      followup_id: null,
      due_at: null
    }, known, active);
  }

  const {rows: quiet} = await c.query(
    `SELECT c.id, c.owner_user_id, c.company_id, c.created_at,
            GREATEST(
              c.created_at,
              COALESCE((SELECT max(created_at) FROM notes WHERE contact_id = c.id), c.created_at),
              COALESCE((SELECT max(created_at) FROM activities WHERE contact_id = c.id), c.created_at),
              COALESCE((SELECT max(m.internal_date) FROM gmail_synced_messages m JOIN gmail_synced_message_contacts l ON l.message_id = m.id WHERE l.contact_id = c.id AND m.excluded = false), c.created_at),
              COALESCE((SELECT max(GREATEST(created_at, updated_at)) FROM followups WHERE contact_id = c.id), c.created_at)
            ) AS last_touch
     FROM contacts c
     WHERE c.archived_at IS NULL AND c.status NOT IN ('perdu', 'inactif')
       AND (c.created_at AT TIME ZONE 'Africa/Tunis')::date <= (now() AT TIME ZONE 'Africa/Tunis')::date - $1::int`,
    [settings.inactive_days]
  );
  for (const row of quiet) {
    const days = calendarDaysBetween(zonedDay(row.last_touch), today);
    if (days < settings.inactive_days) continue;
    const day = zonedDay(row.last_touch);
    await remember(c, orgId, {
      contact_id: row.id,
      company_id: row.company_id,
      owner_user_id: row.owner_user_id,
      kind: 'inactive',
      source_key: `inactive:${row.id}:${day}`,
      priority: days >= 60 ? 2 : 3,
      reason: `Aucune activité commerciale depuis ${days} jours.`.slice(0, 500),
      subject: '',
      message_id: null,
      followup_id: null,
      due_at: null
    }, known, active);
  }

  const {rows: late} = await c.query(
    `SELECT f.id, f.subject, f.due_at, f.contact_id, f.owner_user_id, c.company_id
     FROM followups f
     JOIN contacts c ON c.id = f.contact_id
     WHERE f.status = 'pending' AND f.contact_id IS NOT NULL AND c.archived_at IS NULL
       AND c.status NOT IN ('perdu', 'inactif')
       AND (f.due_at AT TIME ZONE 'Africa/Tunis')::date < (now() AT TIME ZONE 'Africa/Tunis')::date`
  );
  for (const row of late) {
    const dueDay = zonedDay(row.due_at);
    const subject = String(row.subject || '').slice(0, 300);
    const when = new Intl.DateTimeFormat('fr-TN', {timeZone: ZONE, dateStyle: 'medium'}).format(new Date(row.due_at));
    await remember(c, orgId, {
      contact_id: row.contact_id,
      company_id: row.company_id,
      owner_user_id: row.owner_user_id,
      kind: 'overdue',
      source_key: `overdue:${row.id}:${dueDay}`,
      priority: 1,
      reason: `Relance « ${subject} » prévue le ${when}, non effectuée.`.slice(0, 500),
      subject,
      message_id: null,
      followup_id: row.id,
      due_at: row.due_at
    }, known, active);
  }

  if (active.size === 0) {
    await c.query(`UPDATE followup_suggestions SET status = 'done', resolved_at = now() WHERE status IN ('open', 'snoozed')`);
  } else {
    await c.query(
      `UPDATE followup_suggestions SET status = 'done', resolved_at = now()
       WHERE status IN ('open', 'snoozed') AND NOT (source_key = ANY($1::text[]))`,
      [[...active]]
    );
  }
  freshAt.set(orgId, Date.now());
}

async function ensureFresh(c) {
  const orgId = await organizationId(c);
  if (Date.now() - (freshAt.get(orgId) || 0) < FRESH_MS) return;
  await analyze(c);
}

async function act(c, userId, id, body) {
  const action = body.action;
  if (!['ignore', 'done', 'snooze'].includes(action)) fail(400, 'Action invalide.');
  const {rows: [row]} = await c.query(`SELECT * FROM followup_suggestions WHERE id = $1 AND status IN ('open', 'snoozed')`, [uuid(id)]);
  if (!row) fail(404, 'Suggestion introuvable.');
  let summary = 'Suggestion de relance ignorée.';
  if (action === 'ignore') {
    await c.query(`UPDATE followup_suggestions SET status = 'ignored', resolved_at = now() WHERE id = $1`, [row.id]);
  } else if (action === 'done') {
    summary = 'Suggestion de relance marquée comme traitée.';
    await c.query(`UPDATE followup_suggestions SET status = 'done', resolved_at = now() WHERE id = $1`, [row.id]);
    if (row.kind === 'overdue' && row.followup_id) {
      await c.query(`UPDATE followups SET status = 'completed' WHERE id = $1 AND status = 'pending'`, [row.followup_id]);
    }
  } else {
    const days = integer(body.snooze_days);
    if (days === null || days < 1 || days > 90) fail(400, 'Le report doit être entre 1 et 90 jours.');
    summary = `Suggestion de relance reportée de ${days} jours.`;
    const until = new Date(Date.now() + days * 86400000);
    await c.query(`UPDATE followup_suggestions SET status = 'snoozed', snooze_until = $2 WHERE id = $1`, [row.id, until]);
    if (row.kind === 'overdue' && row.followup_id) {
      await c.query(`UPDATE followups SET due_at = $2 WHERE id = $1 AND status = 'pending'`, [row.followup_id, until]);
    }
  }
  await c.query(
    `INSERT INTO activities(organization_id, actor_user_id, entity_type, entity_id, action, summary, company_id, contact_id)
     VALUES ($1,$2,'contacts',$3,'updated',$4,$5,$3)`,
    [row.organization_id, userId, row.contact_id, summary, row.company_id]
  );
}

async function saveSettings(c, body) {
  const noReply = body.no_reply_business_days === undefined ? null : integer(body.no_reply_business_days);
  const inactive = body.inactive_days === undefined ? null : integer(body.inactive_days);
  if (body.no_reply_business_days === undefined && body.inactive_days === undefined) fail(400, 'Aucun réglage à enregistrer.');
  if (body.no_reply_business_days !== undefined && (noReply === null || noReply < 1 || noReply > 60)) fail(400, 'Le délai sans réponse doit être entre 1 et 60 jours ouvrés.');
  if (body.inactive_days !== undefined && (inactive === null || inactive < 7 || inactive > 365)) fail(400, 'Le délai d’inactivité doit être entre 7 et 365 jours.');
  if (noReply !== null) await c.query(`UPDATE organizations SET followup_business_days = $1 WHERE id = current_setting('app.organization_id', true)::uuid`, [noReply]);
  if (inactive !== null) await c.query(`UPDATE organizations SET profile = profile || $1::jsonb WHERE id = current_setting('app.organization_id', true)::uuid`, [JSON.stringify({followup_inactive_days: inactive})]);
  await analyze(c);
  return readSettings(c);
}

function install(api, {route, admin}) {
  api.get('/followup-suggestions', route(async (req, c) => {
    await ensureFresh(c);
    return list(c, req.query);
  }));
  api.post('/followup-suggestions/refresh', route(async (req, c) => {
    allowed(req.body || {}, []);
    await analyze(c);
    return list(c, req.query);
  }));
  api.patch('/followup-suggestions/:id', route(async (req, c) => {
    allowed(req.body, ['action', 'snooze_days']);
    await act(c, req.auth.user_id, req.params.id, req.body);
    return {ok: true};
  }));
  api.patch('/followup-settings', route(async (req, c) => {
    admin(req);
    allowed(req.body, ['no_reply_business_days', 'inactive_days']);
    return saveSettings(c, req.body);
  }));
}

function startLoop(db) {
  const tick = async () => {
    let rows = [];
    try {
      rows = (await db.pool.query('SELECT id FROM organizations')).rows;
    } catch (error) {
      console.error('FollowupSuggestions', error.code || 'organizations');
      return;
    }
    for (const org of rows) {
      try { await db.tenant(org.id, analyze); }
      catch (error) { console.error('FollowupSuggestions', error.code || 'analyze'); }
    }
  };
  const timer = setInterval(tick, 15 * 60 * 1000);
  timer.unref?.();
  const first = setTimeout(tick, 20000);
  first.unref?.();
}

module.exports = {analyze, ensureFresh, list, install, startLoop, businessDaysBetween, zonedDay};
