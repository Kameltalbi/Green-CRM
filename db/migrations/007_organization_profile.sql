ALTER TABLE organizations ADD COLUMN profile jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE organizations ADD CONSTRAINT organization_profile_object CHECK (jsonb_typeof(profile)='object');
