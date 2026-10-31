-- Historique Gmail synchronisé pour le CRM collaboratif. Aucune table Better Auth n'est modifiée.
ALTER TABLE gmail_oauth_states
  ADD COLUMN share_consent boolean NOT NULL DEFAULT false;

ALTER TABLE gmail_accounts
  ADD COLUMN share_consent_at timestamptz,
  ADD COLUMN history_id text,
  ADD COLUMN last_synced_at timestamptz,
  ADD COLUMN sync_cursor_at timestamptz,
  ADD COLUMN sync_status text NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'running', 'error', 'needs_reauth')),
  ADD COLUMN sync_error text NOT NULL DEFAULT '' CHECK (length(sync_error) <= 300);

CREATE TABLE gmail_synced_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  gmail_account_id uuid NOT NULL REFERENCES gmail_accounts(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id),
  gmail_message_id text NOT NULL CHECK (length(gmail_message_id) BETWEEN 1 AND 128),
  gmail_thread_id text NOT NULL DEFAULT '' CHECK (length(gmail_thread_id) <= 128),
  rfc822_message_id text NOT NULL DEFAULT '' CHECK (length(rfc822_message_id) <= 998),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_email text NOT NULL CHECK (from_email = lower(trim(from_email))),
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 998),
  snippet text NOT NULL DEFAULT '' CHECK (length(snippet) <= 512),
  body_text text NOT NULL DEFAULT '' CHECK (octet_length(body_text) <= 200000),
  internal_date timestamptz NOT NULL,
  has_attachments boolean NOT NULL DEFAULT false,
  excluded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, gmail_account_id, gmail_message_id),
  FOREIGN KEY (organization_id, gmail_account_id) REFERENCES gmail_accounts(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, owner_user_id) REFERENCES memberships(organization_id, user_id)
);
CREATE UNIQUE INDEX gmail_synced_rfc822_unique
  ON gmail_synced_messages(organization_id, lower(rfc822_message_id))
  WHERE rfc822_message_id <> '' AND excluded = false;
CREATE INDEX gmail_synced_internal ON gmail_synced_messages(organization_id, internal_date DESC, id DESC);
CREATE INDEX gmail_synced_thread ON gmail_synced_messages(organization_id, gmail_thread_id, internal_date DESC);
CREATE INDEX gmail_synced_account ON gmail_synced_messages(organization_id, gmail_account_id, internal_date DESC);

CREATE TABLE gmail_synced_message_contacts (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  message_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, contact_id),
  UNIQUE (organization_id, message_id, contact_id),
  FOREIGN KEY (organization_id, message_id) REFERENCES gmail_synced_messages(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX gmail_synced_contacts_contact
  ON gmail_synced_message_contacts(organization_id, contact_id, message_id);

CREATE TRIGGER touch_updated BEFORE UPDATE ON gmail_synced_messages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['gmail_synced_messages', 'gmail_synced_message_contacts'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON gmail_synced_messages, gmail_synced_message_contacts TO ciblix_phase2_app;
