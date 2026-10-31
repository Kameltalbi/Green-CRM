-- Enrichissement des fiches CRM. Aucune colonne existante n’est renommée ni supprimée.
-- Gmail et Better Auth ne sont pas touchés.

ALTER TABLE companies
  ADD COLUMN relation_type text NOT NULL DEFAULT ''
    CHECK (relation_type IN ('', 'prospect', 'client', 'partenaire', 'fournisseur')),
  ADD COLUMN country text NOT NULL DEFAULT '' CHECK (length(country) <= 100),
  ADD COLUMN source text NOT NULL DEFAULT 'Non renseignée' CHECK (length(source) <= 100),
  ADD COLUMN status text NOT NULL DEFAULT ''
    CHECK (status IN ('', 'à organiser', 'en cours', 'en attente', 'gagné', 'perdu', 'inactif')),
  ADD COLUMN company_size text NOT NULL DEFAULT ''
    CHECK (company_size IN ('', '1-10', '11-50', '51-200', '201-1000', '1000+')),
  ADD COLUMN linkedin text NOT NULL DEFAULT '' CHECK (length(linkedin) <= 254),
  ADD COLUMN socials text NOT NULL DEFAULT '' CHECK (length(socials) <= 1000);

ALTER TABLE contacts
  ADD COLUMN department text NOT NULL DEFAULT '' CHECK (length(department) <= 150),
  ADD COLUMN phone_work text NOT NULL DEFAULT '' CHECK (length(phone_work) <= 50),
  ADD COLUMN whatsapp text NOT NULL DEFAULT '' CHECK (length(whatsapp) <= 50),
  ADD COLUMN status text NOT NULL DEFAULT ''
    CHECK (status IN ('', 'à organiser', 'en cours', 'en attente', 'gagné', 'perdu', 'inactif'));
