-- Demande de fermeture d'un espace. Aucune donnée n'est supprimée. Aucune table Better Auth n'est modifiée.
ALTER TABLE organizations
  ADD COLUMN closure_status text NOT NULL DEFAULT 'active',
  ADD COLUMN closure_requested_by uuid,
  ADD COLUMN closure_requested_at timestamptz,
  ADD COLUMN closure_scheduled_at timestamptz,
  ADD COLUMN closure_cancelled_by uuid,
  ADD COLUMN closure_cancelled_at timestamptz;

ALTER TABLE organizations
  ADD CONSTRAINT organization_closure_status CHECK (closure_status IN ('active', 'pending_deletion')),
  ADD CONSTRAINT organization_closure_requested_member FOREIGN KEY (id, closure_requested_by) REFERENCES memberships (organization_id, user_id),
  ADD CONSTRAINT organization_closure_cancelled_member FOREIGN KEY (id, closure_cancelled_by) REFERENCES memberships (organization_id, user_id),
  ADD CONSTRAINT organization_closure_delay CHECK (closure_scheduled_at IS NULL OR closure_scheduled_at = closure_requested_at + interval '30 days'),
  ADD CONSTRAINT organization_closure_state CHECK (
    (closure_status = 'active' AND closure_requested_by IS NULL AND closure_requested_at IS NULL AND closure_scheduled_at IS NULL AND closure_cancelled_by IS NULL AND closure_cancelled_at IS NULL)
    OR (closure_status = 'pending_deletion' AND closure_requested_by IS NOT NULL AND closure_requested_at IS NOT NULL AND closure_scheduled_at IS NOT NULL AND closure_cancelled_by IS NULL AND closure_cancelled_at IS NULL)
    OR (closure_status = 'active' AND closure_requested_by IS NOT NULL AND closure_requested_at IS NOT NULL AND closure_scheduled_at IS NOT NULL AND closure_cancelled_by IS NOT NULL AND closure_cancelled_at IS NOT NULL AND closure_cancelled_at >= closure_requested_at AND closure_cancelled_at < closure_scheduled_at)
  );
