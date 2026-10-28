ALTER TABLE contacts ADD COLUMN source text NOT NULL DEFAULT 'Non renseignée' CHECK(length(source)<=100);
