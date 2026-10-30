const {fail} = require('./validation');
const {zip} = require('./zip');

const EXPORT_BYTE_LIMIT = 80 * 1024 * 1024;
const IMAGE_EXTENSIONS = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'};

function json(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n');
}

function logoFile(profile) {
  const logo = profile && profile.logo;
  const match = typeof logo === 'string' && /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(logo);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length) return null;
  return {name: `files/logo.${match[1] === 'jpeg' ? 'jpg' : match[1]}`, data: bytes};
}

async function buildArchive(client, organizationId, maxBytes = EXPORT_BYTE_LIMIT) {
  const files = [];
  let total = 0;
  const add = (name, data) => {
    total += data.length;
    if (total > maxBytes) fail(413, 'L’export dépasse la taille autorisée. Réduisez les images enregistrées, puis réessayez.');
    files.push({name, data});
  };
  const list = async (sql, params = [organizationId]) => (await client.query(sql, params)).rows;

  const {rows: [organization]} = await client.query(
    `SELECT id, name, timezone, followup_business_days, profile, created_by, created_at,
      closure_status, closure_requested_by, closure_requested_at, closure_scheduled_at, closure_cancelled_by, closure_cancelled_at
     FROM organizations WHERE id=$1`,
    [organizationId]
  );
  if (!organization) fail(404, 'Organisation introuvable.');
  const profile = {...(organization.profile || {})};
  const logo = logoFile(profile);
  delete profile.logo;
  if (logo) profile.logo_file = logo.name;

  const members = await list(`SELECT u.id, u.name, u.email, m.role, m.active, m.created_at
    FROM memberships m JOIN users u ON u.id=m.user_id
    WHERE m.organization_id=$1 ORDER BY u.name, u.id`);
  const companies = await list(`SELECT id, organization_id, name, sector, city, description, owner_user_id, archived_at, created_at, updated_at
    FROM companies WHERE organization_id=$1 ORDER BY created_at, id`);
  const contacts = await list(`SELECT id, organization_id, company_id, name, job_title, phone, source, owner_user_id, archived_at, created_at, updated_at
    FROM contacts WHERE organization_id=$1 ORDER BY created_at, id`);
  const emails = await list(`SELECT id, organization_id, contact_id, email
    FROM contact_emails WHERE organization_id=$1 ORDER BY email, id`);
  const notes = await list(`SELECT id, organization_id, company_id, contact_id, author_user_id, body, created_at, updated_at
    FROM notes WHERE organization_id=$1 ORDER BY created_at, id`);
  const followups = await list(`SELECT id, organization_id, company_id, contact_id, owner_user_id, subject, due_at, status, cancellation_reason, local_draft, created_at, updated_at
    FROM followups WHERE organization_id=$1 ORDER BY created_at, id`);
  const activities = await list(`SELECT id, organization_id, actor_user_id, entity_type, entity_id, action, summary, company_id, contact_id, created_at
    FROM activities WHERE organization_id=$1 ORDER BY created_at, id`);
  const gmailAccounts = await list(`SELECT id, organization_id, user_id, email, status, is_default, scope, created_at, updated_at
    FROM gmail_accounts WHERE organization_id=$1 ORDER BY created_at, id`);
  const gmailMessages = await list(`SELECT id, organization_id, user_id, gmail_account_id, contact_id, company_id, to_email, subject, body, gmail_message_id, status, idempotency_key, error_code, created_at, updated_at
    FROM gmail_messages WHERE organization_id=$1 ORDER BY created_at, id`);
  const images = await list(`SELECT id, organization_id, contact_id, uploaded_by, mime_type, octet_length(data)::int AS byte_length, created_at, data
    FROM contact_card_images WHERE organization_id=$1 ORDER BY created_at, id`);

  const imageRecords = images.map(image => {
    const extension = IMAGE_EXTENSIONS[image.mime_type];
    const file = extension && Buffer.isBuffer(image.data) && image.data.length ? `files/images/${image.id}.${extension}` : null;
    if (file) add(file, image.data);
    return {id: image.id, organization_id: image.organization_id, contact_id: image.contact_id, uploaded_by: image.uploaded_by, mime_type: image.mime_type, byte_length: image.byte_length, created_at: image.created_at, file};
  });
  if (logo) add(logo.name, logo.data);

  const documents = {
    'organization.json': {id: organization.id, name: organization.name, timezone: organization.timezone, followup_business_days: organization.followup_business_days, profile, created_by: organization.created_by, created_at: organization.created_at, closure_status: organization.closure_status, closure_requested_by: organization.closure_requested_by, closure_requested_at: organization.closure_requested_at, closure_scheduled_at: organization.closure_scheduled_at, closure_cancelled_by: organization.closure_cancelled_by, closure_cancelled_at: organization.closure_cancelled_at},
    'members.json': members,
    'companies.json': companies,
    'contacts.json': contacts,
    'contact-emails.json': emails,
    'notes.json': notes,
    'followups.json': followups,
    'activities.json': activities,
    'gmail-accounts.json': gmailAccounts,
    'gmail-messages.json': gmailMessages,
    'images.json': imageRecords
  };
  for (const [name, value] of Object.entries(documents)) add(name, json(value));
  const names = ['manifest.json', ...files.map(file => file.name)];
  add('manifest.json', json({format: 'ciblix-export', version: 1, exported_at: new Date().toISOString(), organization_id: organizationId, files: names}));
  return zip(files);
}

function installExport(api, {db, config}) {
  const maxBytes = Number.isInteger(config.exportByteLimit) && config.exportByteLimit > 0 ? config.exportByteLimit : EXPORT_BYTE_LIMIT;
  api.get('/organization/export', async (req, res, next) => {
    try {
      const archive = await db.tenant(req.auth.organization_id, async client => {
        const {rows: [member]} = await client.query('SELECT role FROM memberships WHERE organization_id=$1 AND user_id=$2 AND active=true', [req.auth.organization_id, req.auth.user_id]);
        if (!member) fail(403, 'Accès à cette organisation révoqué.');
        if (member.role !== 'admin') fail(403, 'Cette action est réservée à un administrateur.');
        return buildArchive(client, req.auth.organization_id, maxBytes);
      });
      res.set({'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="ciblix-donnees.zip"', 'Cache-Control': 'private, no-store'});
      res.send(archive);
    } catch (error) { next(error); }
  });
}

module.exports = {installExport, buildArchive, EXPORT_BYTE_LIMIT};
