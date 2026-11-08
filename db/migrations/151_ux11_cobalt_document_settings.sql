-- Product-specific settings. Copper settings and archived files are untouched.
CREATE TABLE co_packing_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),revision integer NOT NULL UNIQUE CHECK(revision>0),content bytea NOT NULL,file_sha256 text NOT NULL,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),reason text NOT NULL);
CREATE TABLE co_document_settings(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),active_template_id uuid REFERENCES co_packing_templates(id),template_version integer NOT NULL DEFAULT 0,weight_version integer NOT NULL DEFAULT 0,fallback_net_tonnes numeric(12,4) CHECK(fallback_net_tonnes>0 AND fallback_net_tonnes<=1000),updated_by uuid REFERENCES users(id),updated_at timestamptz);
INSERT INTO co_document_settings(singleton) VALUES(true);
CREATE TRIGGER co_packing_templates_immutable BEFORE UPDATE OR DELETE ON co_packing_templates FOR EACH ROW EXECUTE FUNCTION v23_immutable();
GRANT SELECT,INSERT ON co_packing_templates TO musonoi_app;
GRANT SELECT,UPDATE ON co_document_settings TO musonoi_app;
