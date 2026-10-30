const {fail, allowed} = require('./validation');

const SUSPENDED = 'Cet espace est en cours de fermeture. Les modifications sont suspendues.';

function closureView(row) {
  return {
    status: row.closure_status,
    requested_by: row.closure_requested_by,
    requested_at: row.closure_requested_at,
    scheduled_at: row.closure_scheduled_at,
    cancelled_by: row.closure_cancelled_by,
    cancelled_at: row.closure_cancelled_at
  };
}

async function assertWritable(client, organizationId) {
  const {rows: [organization]} = await client.query('SELECT closure_status FROM organizations WHERE id=$1 FOR UPDATE', [organizationId]);
  if (organization?.closure_status === 'pending_deletion') fail(403, SUSPENDED);
}

async function requestClosure(client, req) {
  allowed(req.body, ['name', 'confirm']);
  if (req.body.confirm !== true) fail(400, 'Confirmez explicitement la fermeture de cet espace.');
  if (typeof req.body.name !== 'string') fail(400, 'Le nom saisi ne correspond pas à cet espace.');
  await client.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [req.auth.organization_id]);
  const {rows: [current]} = await client.query('SELECT name, closure_status FROM organizations WHERE id=$1', [req.auth.organization_id]);
  if (!current) fail(404, 'Organisation introuvable.');
  if (req.body.name !== current.name) fail(400, 'Le nom saisi ne correspond pas à cet espace.');
  if (current.closure_status === 'pending_deletion') fail(409, 'Une fermeture est déjà demandée pour cet espace.');
  const {rows: [updated]} = await client.query(`WITH stamp AS (SELECT clock_timestamp() AS requested_at)
    UPDATE organizations o SET closure_status='pending_deletion', closure_requested_by=$2,
      closure_requested_at=stamp.requested_at, closure_scheduled_at=stamp.requested_at + interval '30 days',
      closure_cancelled_by=NULL, closure_cancelled_at=NULL
    FROM stamp
    WHERE o.id=$1 AND o.closure_status='active'
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id=o.id AND m.user_id=$2 AND m.role='admin' AND m.active)
    RETURNING o.closure_status, o.closure_requested_by, o.closure_requested_at, o.closure_scheduled_at, o.closure_cancelled_by, o.closure_cancelled_at`, [req.auth.organization_id, req.auth.user_id]);
  if (!updated) {
    const {rows: [again]} = await client.query('SELECT closure_status FROM organizations WHERE id=$1', [req.auth.organization_id]);
    if (again?.closure_status === 'pending_deletion') fail(409, 'Une fermeture est déjà demandée pour cet espace.');
    fail(403, 'Cette action est réservée à un administrateur.');
  }
  return closureView(updated);
}

async function cancelClosure(client, req) {
  if (req.body == null) req.body = {};
  allowed(req.body, []);
  await client.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [req.auth.organization_id]);
  const {rows: [current]} = await client.query("SELECT closure_status, closure_scheduled_at <= clock_timestamp() AS expired FROM organizations WHERE id=$1", [req.auth.organization_id]);
  if (!current || current.closure_status !== 'pending_deletion') fail(409, 'Aucune fermeture n’est en cours.');
  if (current.expired) fail(409, 'Le délai de 30 jours est écoulé. L’annulation n’est plus possible.');
  const {rows: [updated]} = await client.query(`UPDATE organizations o SET closure_status='active', closure_cancelled_by=$2, closure_cancelled_at=clock_timestamp()
    WHERE o.id=$1 AND o.closure_status='pending_deletion' AND o.closure_scheduled_at > clock_timestamp()
      AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id=o.id AND m.user_id=$2 AND m.role='admin' AND m.active)
    RETURNING o.closure_status, o.closure_requested_by, o.closure_requested_at, o.closure_scheduled_at, o.closure_cancelled_by, o.closure_cancelled_at`, [req.auth.organization_id, req.auth.user_id]);
  if (!updated) {
    const {rows: [again]} = await client.query("SELECT closure_status, closure_scheduled_at <= clock_timestamp() AS expired FROM organizations WHERE id=$1", [req.auth.organization_id]);
    if (again?.closure_status === 'pending_deletion' && again.expired) fail(409, 'Le délai de 30 jours est écoulé. L’annulation n’est plus possible.');
    fail(409, 'Aucune fermeture n’est en cours.');
  }
  return closureView(updated);
}

function installClosure(api, {route, admin}) {
  api.post('/organization/closure', route(async (req, c) => { admin(req); return requestClosure(c, req); }));
  api.post('/organization/closure/cancel', route(async (req, c) => { admin(req); return cancelClosure(c, req); }));
}

module.exports = {installClosure, assertWritable, closureView, SUSPENDED};
