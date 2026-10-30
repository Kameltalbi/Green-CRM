const {fail, uuid, allowed} = require('./validation');

function requireDate(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, 'Date de fin invalide.');
  const ends = new Date(`${value}T23:59:59+01:00`);
  if (Number.isNaN(ends.getTime())) fail(400, 'Date de fin invalide.');
  return ends;
}

function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'Choisissez un mot de passe de 12 à 128 caractères.');
  return value;
}

async function requireSuperadmin(db, userId) {
  const {rowCount} = await db.pool.query('SELECT 1 FROM platform_admins WHERE user_id = $1', [userId]);
  if (!rowCount) fail(403, 'Cette action est réservée au superadmin.');
}

function groupOrganizations(rows) {
  const organizations = new Map();
  for (const row of rows) {
    if (!organizations.has(row.id)) {
      organizations.set(row.id, {
        id: row.id,
        name: row.name,
        created_at: row.created_at,
        access_ends_at: row.access_ends_at,
        users: []
      });
    }
    if (!row.user_id) continue;
    organizations.get(row.id).users.push({
      id: row.user_id,
      name: row.user_name,
      email: row.email,
      role: row.role,
      active: row.active,
      created_at: row.user_created_at,
      password_account: row.password_account
    });
  }
  return [...organizations.values()];
}

async function listOrganizations(db) {
  const {rows} = await db.pool.query(`SELECT organization.id, organization.name, organization.created_at, organization.access_ends_at,
      users.id AS user_id, users.name AS user_name, users.email, users.created_at AS user_created_at,
      membership.role, membership.active,
      EXISTS(SELECT 1 FROM auth_accounts account WHERE account.user_id = users.id AND account.provider_id = 'credential' AND account.password IS NOT NULL) AS password_account
    FROM organizations organization
    LEFT JOIN memberships membership ON membership.organization_id = organization.id
    LEFT JOIN users ON users.id = membership.user_id
    ORDER BY organization.created_at, organization.id, membership.role DESC, users.name, users.id`);
  return groupOrganizations(rows);
}

async function setAccessEnd(db, organizationId, value) {
  const ends = requireDate(value);
  const {rows} = await db.pool.query('UPDATE organizations SET access_ends_at = $2 WHERE id = $1 RETURNING id, access_ends_at', [organizationId, ends]);
  if (!rows.length) fail(404, 'Organisation introuvable.');
  return rows[0];
}

async function replacePassword(db, userId, password, currentSessionId) {
  const {hashPassword} = await import('better-auth/crypto');
  const hashed = await hashPassword(password);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const {rowCount: user} = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!user) fail(404, 'Compte introuvable.');
    const updated = await client.query("UPDATE auth_accounts SET password = $2, updated_at = now() WHERE user_id = $1 AND provider_id = 'credential' AND password IS NOT NULL", [userId, hashed]);
    if (!updated.rowCount) fail(409, 'Ce compte se connecte avec Google. Il n’a pas de mot de passe Ciblix.');
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1 AND id IS DISTINCT FROM $2', [userId, currentSessionId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function installSuperadmin(api, db) {
  api.get('/superadmin/organizations', async (req, res, next) => {
    try {
      await requireSuperadmin(db, req.auth.user_id);
      res.json({organizations: await listOrganizations(db)});
    } catch (error) { next(error); }
  });
  api.patch('/superadmin/organizations/:id', async (req, res, next) => {
    try {
      await requireSuperadmin(db, req.auth.user_id);
      allowed(req.body, ['access_ends_at']);
      res.json(await setAccessEnd(db, uuid(req.params.id), req.body.access_ends_at));
    } catch (error) { next(error); }
  });
  api.post('/superadmin/users/:id/password', async (req, res, next) => {
    try {
      await requireSuperadmin(db, req.auth.user_id);
      allowed(req.body, ['password']);
      await replacePassword(db, uuid(req.params.id), passwordValue(req.body.password), req.auth.session_id);
      res.json({ok: true});
    } catch (error) { next(error); }
  });
}

module.exports = {installSuperadmin, requireSuperadmin};
