INSERT INTO permissions VALUES('label:print') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT code,'label:print' FROM roles WHERE code IN('admin','supervisor','operator','production') ON CONFLICT DO NOTHING;
CREATE TABLE label_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES users(id),width_mm int NOT NULL CHECK(width_mm BETWEEN 40 AND 100),height_mm int NOT NULL CHECK(height_mm BETWEEN 40 AND 100),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE label_job_items(job_id uuid NOT NULL REFERENCES label_jobs(id),bundle_id uuid NOT NULL REFERENCES bundles(id),PRIMARY KEY(job_id,bundle_id));
CREATE TABLE label_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,job_id uuid NOT NULL REFERENCES label_jobs(id),actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL CHECK(action IN('PREVIEW','PRINT_REQUESTED','EXPORTED')),reason text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['label_jobs','label_job_items','label_events'] LOOP EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION v23_immutable()',t);END LOOP;END $$;
GRANT SELECT,INSERT ON label_jobs,label_job_items,label_events TO musonoi_app;
