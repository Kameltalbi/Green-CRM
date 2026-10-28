-- Better Auth gère l’identité et les sessions. Les sessions précédentes sont révoquées.
ALTER TABLE users ALTER COLUMN google_sub DROP NOT NULL;
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN image text;
ALTER TABLE users ADD COLUMN company_name text NOT NULL DEFAULT '' CHECK(length(company_name)<=150);
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
UPDATE users SET email_verified=true WHERE google_sub IS NOT NULL;
CREATE TABLE auth_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id text NOT NULL, provider_id text NOT NULL, password text, access_token text,refresh_token text,id_token text,
 access_token_expires_at timestamptz,refresh_token_expires_at timestamptz,scope text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(provider_id,account_id)
);
INSERT INTO auth_accounts(user_id,account_id,provider_id) SELECT id,google_sub,'google' FROM users WHERE google_sub IS NOT NULL;
ALTER TABLE sessions RENAME TO legacy_sessions;
DELETE FROM legacy_sessions;
CREATE TABLE auth_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, ip_address text,user_agent text,
 organization_id uuid,csrf_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX auth_sessions_expiration ON auth_sessions(expires_at);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE auth_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),identifier text NOT NULL,value text NOT NULL,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier ON auth_verifications(identifier);
ALTER TABLE organizations ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE invitations ADD COLUMN sent_at timestamptz;
GRANT SELECT,INSERT,UPDATE,DELETE ON auth_accounts,auth_sessions,auth_verifications TO ciblix_phase2_app;
REVOKE ALL ON legacy_sessions,oauth_states FROM ciblix_phase2_app;
