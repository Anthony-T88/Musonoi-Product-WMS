CREATE TABLE consistency_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),findings jsonb NOT NULL,summary jsonb NOT NULL);
CREATE TRIGGER consistency_run_immutable BEFORE UPDATE OR DELETE ON consistency_runs FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE INDEX consistency_runs_date ON consistency_runs(created_at DESC);
CREATE TABLE backup_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),database_name text NOT NULL,started_at timestamptz NOT NULL,finished_at timestamptz NOT NULL,status text NOT NULL CHECK(status IN('SUCCESS','FAILED')),file_name text,sha256 text,bytes bigint,error_code text,restore_database text,restore_verified boolean NOT NULL DEFAULT false);
CREATE TRIGGER backup_run_immutable BEFORE UPDATE OR DELETE ON backup_runs FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE INDEX backup_runs_date ON backup_runs(started_at DESC);
GRANT SELECT,INSERT ON consistency_runs TO musonoi_app;
GRANT SELECT ON backup_runs TO musonoi_app;
