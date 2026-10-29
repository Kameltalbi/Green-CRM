-- Indexes only: existing rows and relationships remain unchanged.
CREATE INDEX contacts_company_page ON contacts(organization_id,company_id,name,id);
CREATE INDEX contacts_owner ON contacts(organization_id,owner_user_id);
CREATE INDEX companies_owner ON companies(organization_id,owner_user_id);
CREATE INDEX notes_contact_page ON notes(organization_id,contact_id,created_at DESC,id DESC);
CREATE INDEX notes_company_page ON notes(organization_id,company_id,created_at DESC,id DESC);
CREATE INDEX followups_contact_due ON followups(organization_id,contact_id,status,due_at,id);
CREATE INDEX followups_company_due ON followups(organization_id,company_id,status,due_at,id);
CREATE INDEX followups_owner_due ON followups(organization_id,owner_user_id,status,due_at,id);
