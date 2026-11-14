-- Preserve old record IDs and license snapshots while sharing choices across customers.
ALTER TABLE export_license_record_books ADD COLUMN archived_at timestamptz,
 ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN account_name text NOT NULL DEFAULT '';
ALTER TABLE export_license_record_books ALTER COLUMN customer_id DROP NOT NULL,
 ADD CONSTRAINT export_license_book_parent_key UNIQUE(id,product_code,project_id,kind),
 ADD CONSTRAINT export_license_book_parent FOREIGN KEY(bank_id,product_code,project_id,bank_kind)
  REFERENCES export_license_record_books(id,product_code,project_id,kind);
DO $$
DECLARE constraint_name text;
BEGIN
 SELECT conname INTO STRICT constraint_name FROM pg_constraint
 WHERE conrelid='export_license_record_books'::regclass AND confrelid=conrelid
  AND contype='f' AND cardinality(conkey)=5;
 EXECUTE format('ALTER TABLE export_license_record_books DROP CONSTRAINT %I',constraint_name);
END $$;

-- Consolidate identical choices. Archived aliases retain their IDs and historical values.
CREATE TEMP TABLE license_book_bank_aliases AS
 SELECT id,first_value(id) OVER(PARTITION BY product_code,project_id,kind,value ORDER BY created_at,id) canonical_id
 FROM export_license_record_books WHERE kind IN('issuing_bank','offshore_bank');
DROP INDEX export_license_record_book_value;
UPDATE export_license_record_books b SET bank_id=a.canonical_id
 FROM license_book_bank_aliases a WHERE b.bank_id=a.id AND a.id<>a.canonical_id;
DROP TABLE license_book_bank_aliases;
WITH ranked AS (
 SELECT id,row_number() OVER(PARTITION BY product_code,project_id,kind,bank_id,value ORDER BY created_at,id) position
 FROM export_license_record_books
)
UPDATE export_license_record_books b SET archived_at=statement_timestamp()
 FROM ranked r WHERE r.id=b.id AND r.position>1;
CREATE UNIQUE INDEX export_license_book_active_value ON export_license_record_books
 (product_code,project_id,kind,bank_id,md5(value)) NULLS NOT DISTINCT WHERE archived_at IS NULL;
GRANT UPDATE(value, account_name, archived_at, version) ON export_license_record_books TO musonoi_app;

ALTER TABLE export_licenses ADD COLUMN issuing_bank_account_name text NOT NULL DEFAULT '',
 ADD COLUMN offshore_bank_account_name text NOT NULL DEFAULT '',
 ADD COLUMN standard_amount boolean NOT NULL DEFAULT false;
ALTER TABLE export_licenses ADD CONSTRAINT export_license_standard_amount CHECK(
 NOT standard_amount OR (unit_basis='PHYSICAL_MT' AND unit='MT' AND currency='USD' AND price_unit='USD/MT'
  AND amount IS NOT DISTINCT FROM round(quantity*unit_price,2)));
ALTER TABLE export_license_actions ADD COLUMN processing_snapshot jsonb;

-- Source facts are extracted from preserved attachments. Matching is evaluated on read
-- so approvals, extensions, late registration and historical voids take effect together.
CREATE TABLE export_license_historical_sources (
 source_id uuid PRIMARY KEY REFERENCES historical_backfills(source_id),
 license_key text NOT NULL CHECK(license_key<>''),
 invoice_no text
);
CREATE INDEX export_license_history_source_key ON export_license_historical_sources(license_key);
CREATE INDEX export_license_history_number_key ON export_licenses(product_code,project_id,historical_unit_key(license_no))
 WHERE state IN('ISSUED','CLOSED') AND unit_basis='PHYSICAL_MT' AND unit='MT' AND license_no IS NOT NULL;

CREATE VIEW export_license_historical_usage AS
 SELECT l.id license_id,m.id source_id,m.document_no,s.invoice_no,m.business_date,
        (SELECT sum(net_kg)*0.001 FROM historical_movement_lines WHERE document_id=m.id) used_quantity
 FROM export_license_historical_sources s
 JOIN historical_backfills b ON b.source_id=s.source_id
 JOIN historical_movement_documents m ON m.id=b.source_id AND m.voided_at IS NULL AND m.movement_type='OUTBOUND'
 JOIN export_licenses l ON l.product_code=m.product_code AND l.project_id=b.project_id
  AND historical_unit_key(l.license_no)=s.license_key AND l.license_no IS NOT NULL
  AND l.state IN('ISSUED','CLOSED') AND l.unit_basis='PHYSICAL_MT' AND l.unit='MT'
  AND m.business_date BETWEEN l.valid_from AND coalesce(l.extended_until,l.valid_until)
  AND (l.closed_on IS NULL OR m.business_date<=l.closed_on)
  AND (b.customer_id IS NULL OR b.customer_id=l.customer_id)
 WHERE NOT EXISTS (
   SELECT 1 FROM export_license_allocations a
   WHERE a.product_code=m.product_code AND a.state IN('RESERVED','SETTLED')
     AND lower(a.invoice_no)=lower(coalesce(s.invoice_no,m.document_no))
 ) AND NOT EXISTS (
   SELECT 1 FROM export_licenses other WHERE other.id<>l.id AND other.product_code=l.product_code
    AND other.project_id=l.project_id AND historical_unit_key(other.license_no)=s.license_key
 );
GRANT SELECT,INSERT ON export_license_historical_sources TO musonoi_app;
GRANT SELECT ON export_license_historical_usage TO musonoi_app;
