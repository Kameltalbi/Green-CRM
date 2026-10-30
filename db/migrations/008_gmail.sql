-- Comptes Gmail par utilisateur et organisation. Aucune table Better Auth n'est modifiée.
CREATE TABLE gmail_oauth_states (
  state_hash text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  verifier_enc text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX gmail_oauth_states_expiration ON gmail_oauth_states(expires_at);

CREATE TABLE gmail_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  email text NOT NULL CHECK (email = lower(trim(email))),
  google_sub text NOT NULL CHECK (google_sub ~ '^[A-Za-z0-9_-]{1,255}$'),
  access_token_enc text NOT NULL,
  refresh_token_enc text,
  access_token_expires_at timestamptz,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired')),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id, google_sub),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id)
);
CREATE UNIQUE INDEX gmail_accounts_one_default ON gmail_accounts(organization_id, user_id) WHERE is_default;
CREATE INDEX gmail_accounts_owner ON gmail_accounts(organization_id, user_id);

CREATE TABLE gmail_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  gmail_account_id uuid REFERENCES gmail_accounts(id) ON DELETE SET NULL,
  contact_id uuid,
  company_id uuid,
  to_email text NOT NULL CHECK (to_email = lower(trim(to_email))),
  subject text NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 300),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 20000),
  gmail_message_id text,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  error_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, idempotency_key),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX gmail_messages_contact ON gmail_messages(organization_id, contact_id, created_at DESC);
CREATE INDEX gmail_messages_company ON gmail_messages(organization_id, company_id, created_at DESC);

CREATE TRIGGER touch_updated BEFORE UPDATE ON gmail_accounts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER touch_updated BEFORE UPDATE ON gmail_messages FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['gmail_oauth_states', 'gmail_accounts', 'gmail_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON gmail_oauth_states, gmail_accounts, gmail_messages TO ciblix_phase2_app;
