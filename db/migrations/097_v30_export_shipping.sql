-- New document records only. Existing warehouse functions and data are untouched.
CREATE TABLE export_transport (
 loading_id uuid PRIMARY KEY REFERENCES loading_orders(id),
 fields jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(fields)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid NOT NULL REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE packing_list_documents (
 loading_id uuid PRIMARY KEY REFERENCES loading_orders(id),
 document_no text NOT NULL UNIQUE,
 revision integer NOT NULL CHECK(revision>0),
 transport_version integer NOT NULL,
 generated_by uuid NOT NULL REFERENCES users(id), generated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE packing_list_revisions (
 loading_id uuid NOT NULL REFERENCES packing_list_documents(loading_id),
 revision integer NOT NULL CHECK(revision>0),
 snapshot jsonb NOT NULL,
 template_sha256 text NOT NULL CHECK(length(template_sha256)=64),
 file_sha256 text NOT NULL CHECK(length(file_sha256)=64),
 file_name text NOT NULL, content bytea NOT NULL,
 generated_by uuid NOT NULL REFERENCES users(id), generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL CHECK(length(reason) BETWEEN 5 AND 1000),
 PRIMARY KEY(loading_id,revision)
);
CREATE TRIGGER packing_list_revision_immutable BEFORE UPDATE OR DELETE ON packing_list_revisions FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE INDEX packing_list_generated ON packing_list_documents(generated_at DESC);
GRANT SELECT,INSERT,UPDATE ON export_transport,packing_list_documents TO musonoi_app;
GRANT SELECT,INSERT ON packing_list_revisions TO musonoi_app;
