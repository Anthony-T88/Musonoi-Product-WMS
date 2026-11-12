CREATE TABLE export_license_record_books (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_code text NOT NULL CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 project_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('clearing_agent','issuing_bank','issuing_bank_account','offshore_bank','offshore_bank_account','destination','note')),
 value text NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 1000 AND trim(value)=value),
 bank_id uuid,
 bank_kind text GENERATED ALWAYS AS (CASE kind WHEN 'issuing_bank_account' THEN 'issuing_bank' WHEN 'offshore_bank_account' THEN 'offshore_bank' END) STORED,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(project_id,customer_id) REFERENCES customers(project_id,id),
 UNIQUE(id,product_code,project_id,customer_id,kind),
 FOREIGN KEY(bank_id,product_code,project_id,customer_id,bank_kind)
  REFERENCES export_license_record_books(id,product_code,project_id,customer_id,kind),
 CHECK((bank_id IS NULL)=(bank_kind IS NULL))
);
CREATE UNIQUE INDEX export_license_record_book_value
 ON export_license_record_books(product_code,project_id,customer_id,kind,bank_id,md5(value)) NULLS NOT DISTINCT;

ALTER TABLE export_licenses
 ADD COLUMN issuing_bank_account text NOT NULL DEFAULT '',
 ADD COLUMN offshore_bank text NOT NULL DEFAULT '',
 ADD COLUMN offshore_bank_account text NOT NULL DEFAULT '',
 ADD COLUMN processing_records jsonb NOT NULL DEFAULT '{}'
  CHECK(jsonb_typeof(processing_records)='object');

-- Seed existing choices within their original product, project and customer.
INSERT INTO export_license_record_books(product_code,project_id,customer_id,kind,value,created_by)
SELECT DISTINCT ON (p.product_code,p.project_id,p.customer_id,b.kind,trim(b.value))
 p.product_code,p.project_id,p.customer_id,b.kind,trim(b.value),p.created_by
FROM export_licenses p
CROSS JOIN LATERAL (VALUES ('clearing_agent',p.clearing_agent),('issuing_bank',p.issuing_bank),
 ('destination',p.destination),('note',p.note)) b(kind,value)
WHERE length(trim(b.value)) BETWEEN 1 AND 1000
ORDER BY p.product_code,p.project_id,p.customer_id,b.kind,trim(b.value),p.created_at,p.id
ON CONFLICT DO NOTHING;

GRANT SELECT,INSERT ON export_license_record_books TO musonoi_app;
