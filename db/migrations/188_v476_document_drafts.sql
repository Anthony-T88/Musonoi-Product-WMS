CREATE TABLE document_drafts (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES users(id),
 product_code text NOT NULL CHECK(product_code IN ('CU_CATHODE','CO_HYDROXIDE')),
 form_key text NOT NULL,
 route text NOT NULL,
 fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='array'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz
);
CREATE INDEX document_drafts_owner ON document_drafts(actor_id,product_code,updated_at DESC) WHERE closed_at IS NULL;
GRANT SELECT,INSERT,UPDATE ON document_drafts TO musonoi_app;
