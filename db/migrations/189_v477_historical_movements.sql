CREATE TABLE historical_movement_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_code text NOT NULL CHECK (product_code IN ('CU_CATHODE','CO_HYDROXIDE')),
 movement_type text NOT NULL CHECK (movement_type IN ('INBOUND','OUTBOUND')),
 document_no text NOT NULL,
 document_key text NOT NULL,
 business_date date NOT NULL,
 date_evidence text NOT NULL,
 source_name text NOT NULL,
 source_sha256 text NOT NULL,
 source_data bytea NOT NULL,
 source_facts jsonb NOT NULL,
 imported_by uuid NOT NULL REFERENCES users(id),
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 voided_by uuid REFERENCES users(id),
 voided_at timestamptz,
 void_reason text,
 CHECK ((voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
     OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE UNIQUE INDEX historical_movement_document_active
 ON historical_movement_documents(product_code,movement_type,document_key) WHERE voided_at IS NULL;
CREATE INDEX historical_movement_date ON historical_movement_documents(product_code,business_date DESC,id);

CREATE TABLE historical_movement_lines (
 document_id uuid NOT NULL REFERENCES historical_movement_documents(id),
 source_row integer NOT NULL CHECK (source_row>0),
 unit_id text NOT NULL,
 unit_key text NOT NULL,
 seal_no text,
 sheets_count integer CHECK (sheets_count>0),
 net_kg numeric NOT NULL CHECK (net_kg>0),
 gross_kg numeric NOT NULL CHECK (gross_kg>=net_kg),
 PRIMARY KEY (document_id,source_row),
 UNIQUE (document_id,unit_key)
);
CREATE INDEX historical_movement_unit ON historical_movement_lines(unit_key,document_id);
GRANT SELECT,INSERT ON historical_movement_documents,historical_movement_lines TO musonoi_app;
GRANT UPDATE (voided_at,voided_by,void_reason) ON historical_movement_documents TO musonoi_app;
