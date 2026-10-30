-- Accès plateforme, distinct de l'administrateur d'un espace. Aucune donnée n'est effacée.
CREATE TABLE platform_admins (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organizations ADD COLUMN access_ends_at timestamptz;
GRANT SELECT, INSERT, DELETE ON platform_admins TO ciblix_phase2_app;
