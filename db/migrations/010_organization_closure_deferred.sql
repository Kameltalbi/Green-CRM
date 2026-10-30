-- Les références de fermeture sont vérifiées en fin de transaction.
-- Cela permet de retirer l'adhésion et l'organisation dans la même transaction, sans effacer les comptes utilisateurs.
ALTER TABLE organizations DROP CONSTRAINT organization_closure_requested_member;
ALTER TABLE organizations DROP CONSTRAINT organization_closure_cancelled_member;
ALTER TABLE organizations
  ADD CONSTRAINT organization_closure_requested_member
  FOREIGN KEY (id, closure_requested_by) REFERENCES memberships (organization_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE organizations
  ADD CONSTRAINT organization_closure_cancelled_member
  FOREIGN KEY (id, closure_cancelled_by) REFERENCES memberships (organization_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;
