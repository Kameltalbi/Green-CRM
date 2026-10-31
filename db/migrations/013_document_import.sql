-- Champs entreprise enrichis + suivi des extractions documentaires. Aucune table Better Auth / Gmail n'est modifiée.
ALTER TABLE companies
  ADD COLUMN address text NOT NULL DEFAULT '' CHECK (length(address) <= 1000),
  ADD COLUMN phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 50),
  ADD COLUMN email text NOT NULL DEFAULT '' CHECK (email = '' OR email = lower(trim(email))),
  ADD COLUMN website text NOT NULL DEFAULT '' CHECK (length(website) <= 254);

CREATE TABLE document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  page_count integer NOT NULL DEFAULT 1 CHECK (page_count BETWEEN 1 AND 5),
  byte_length integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 8388608),
  model text NOT NULL DEFAULT '' CHECK (length(model) <= 120),
  prompt_tokens integer NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (estimated_cost_usd >= 0),
  status text NOT NULL CHECK (status IN ('ok', 'error')),
  error_code text NOT NULL DEFAULT '' CHECK (length(error_code) <= 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES memberships(organization_id, user_id)
);
CREATE INDEX document_extractions_org_day ON document_extractions(organization_id, created_at DESC);
CREATE INDEX document_extractions_month ON document_extractions(created_at DESC);

ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_extractions
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON document_extractions TO ciblix_phase2_app;
