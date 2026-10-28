-- Contexte historique conservé même si une note ou une relance est supprimée.
-- Identifiants d'instantané, sans cascade : accès toujours protégé par organization_id/RLS.
ALTER TABLE activities ADD COLUMN company_id uuid;
ALTER TABLE activities ADD COLUMN contact_id uuid;
UPDATE activities SET company_id=entity_id WHERE entity_type='companies';
UPDATE activities a SET contact_id=c.id,company_id=c.company_id FROM contacts c WHERE a.entity_type='contacts' AND a.entity_id=c.id AND a.organization_id=c.organization_id;
UPDATE activities a SET contact_id=n.contact_id,company_id=coalesce(n.company_id,c.company_id) FROM notes n LEFT JOIN contacts c ON c.organization_id=n.organization_id AND c.id=n.contact_id WHERE a.entity_type='notes' AND a.entity_id=n.id AND a.organization_id=n.organization_id;
UPDATE activities a SET contact_id=f.contact_id,company_id=f.company_id FROM followups f WHERE a.entity_type='followups' AND a.entity_id=f.id AND a.organization_id=f.organization_id;
CREATE INDEX activities_company_history ON activities(organization_id,company_id,created_at DESC,id);
CREATE INDEX activities_contact_history ON activities(organization_id,contact_id,created_at DESC,id);
