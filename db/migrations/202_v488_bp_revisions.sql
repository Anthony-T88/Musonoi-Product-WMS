-- Keep the first issued BP and the membership of every existing document intact.
CREATE TABLE customs_bp_batch_claims (
 product_code text NOT NULL CHECK (product_code IN ('CU_CATHODE','CO_HYDROXIDE')),
 project_id uuid NOT NULL REFERENCES projects(id),
 batch_no text NOT NULL CHECK (length(batch_no)>0 AND batch_no=upper(btrim(batch_no))),
 document_id uuid NOT NULL REFERENCES customs_bp_documents(id),
 PRIMARY KEY (product_code,project_id,batch_no)
);

CREATE INDEX customs_bp_document_sources ON customs_bp_documents USING gin (source_ids);

-- Use the source batch numbers, including each lot of a combined copper load.
-- Old duplicate documents remain readable. A historical batch is claimed once.
WITH batches AS (
 SELECT d.product_code,(s.value->>'project_id')::uuid project_id,upper(btrim(b.value)) batch_no,
        d.id,d.created_at
 FROM customs_bp_documents d
 CROSS JOIN LATERAL jsonb_array_elements(d.source_context) s(value)
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(d.snapshot->'original'->'rows',d.snapshot->'rows')) r(value)
 CROSS JOIN LATERAL regexp_split_to_table(r.value->>'batch',' / ') b(value)
 WHERE nullif(btrim(b.value),'') IS NOT NULL
)
INSERT INTO customs_bp_batch_claims (product_code,project_id,batch_no,document_id)
SELECT DISTINCT ON (product_code,project_id,batch_no) product_code,project_id,batch_no,id
FROM batches ORDER BY product_code,project_id,batch_no,created_at,id;

CREATE TABLE customs_bp_revisions (
 document_id uuid NOT NULL REFERENCES customs_bp_documents(id),
 revision integer NOT NULL CHECK (revision>1),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (document_id,revision)
);

CREATE TABLE customs_bp_agencies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 1000 AND name=btrim(name)),
 version integer NOT NULL DEFAULT 1 CHECK (version>0),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 archived_at timestamptz
);
CREATE UNIQUE INDEX customs_bp_active_agency_name
 ON customs_bp_agencies (project_id,lower(name)) WHERE archived_at IS NULL;

-- Make the agencies already used on BP documents available in the shared book.
WITH names AS (
 SELECT (s.value->>'project_id')::uuid project_id,btrim(d.snapshot->'header'->>'agency') name,
        d.created_by,d.created_at,d.id
 FROM customs_bp_documents d
 CROSS JOIN LATERAL jsonb_array_elements(d.source_context) s(value)
 WHERE nullif(btrim(d.snapshot->'header'->>'agency'),'') IS NOT NULL
)
INSERT INTO customs_bp_agencies (project_id,name,created_by,created_at)
SELECT DISTINCT ON (project_id,lower(name)) project_id,name,created_by,created_at
FROM names ORDER BY project_id,lower(name),created_at,id;

GRANT SELECT,INSERT ON customs_bp_batch_claims,customs_bp_revisions TO musonoi_app;
GRANT SELECT,INSERT,UPDATE(name,version,archived_at) ON customs_bp_agencies TO musonoi_app;
