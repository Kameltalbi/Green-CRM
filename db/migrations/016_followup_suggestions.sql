-- Suggestions de relance calculées côté serveur. L'envoi reste une action explicite de l'utilisateur.
ALTER TABLE organizations ALTER COLUMN followup_business_days SET DEFAULT 5;
UPDATE organizations SET followup_business_days = 5 WHERE followup_business_days = 4;

CREATE TABLE followup_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_id uuid NOT NULL,
  company_id uuid,
  owner_user_id uuid,
  kind text NOT NULL CHECK (kind IN ('no_reply', 'inactive', 'overdue')),
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 200),
  priority smallint NOT NULL CHECK (priority BETWEEN 1 AND 3),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 300),
  message_id uuid,
  followup_id uuid,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'snoozed', 'ignored', 'done')),
  snooze_until timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, source_key),
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, message_id) REFERENCES gmail_synced_messages(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, followup_id) REFERENCES followups(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX followup_suggestions_open ON followup_suggestions(organization_id, status, priority, detected_at);
CREATE INDEX followup_suggestions_contact ON followup_suggestions(organization_id, contact_id, status);
CREATE TRIGGER touch_updated BEFORE UPDATE ON followup_suggestions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE followup_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_suggestions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON followup_suggestions
  USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON followup_suggestions TO ciblix_phase2_app;
