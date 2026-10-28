DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='ciblix_phase2_app') THEN CREATE ROLE ciblix_phase2_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END $$;
GRANT USAGE ON SCHEMA public TO ciblix_phase2_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON organizations,users,memberships,invitations,sessions,oauth_states,companies,contacts,contact_emails,notes,followups,activities,contact_card_images TO ciblix_phase2_app;
REVOKE ALL ON schema_migrations FROM ciblix_phase2_app;
