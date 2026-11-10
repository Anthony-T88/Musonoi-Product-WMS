-- Additive export-license records. Historical plan numbers and postings are retained.
CREATE TABLE export_licenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_code text NOT NULL CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 project_id uuid NOT NULL REFERENCES projects(id),
 customer_id uuid NOT NULL REFERENCES customers(id),
 cu_contract_id uuid REFERENCES customer_contracts(id),
 co_contract_id uuid REFERENCES co_sales_contracts(id),
 contract_id uuid GENERATED ALWAYS AS(coalesce(cu_contract_id,co_contract_id)) STORED,
 applied_on date NOT NULL,
 proforma_no text NOT NULL CHECK(length(proforma_no) BETWEEN 1 AND 64 AND proforma_no=trim(proforma_no)),
 license_no text CHECK(length(license_no) BETWEEN 1 AND 160),
 quantity numeric NOT NULL CHECK(quantity>0),
 unit_basis text NOT NULL CHECK(unit_basis IN('PHYSICAL_MT','COBALT_MT','CUSTOM') AND (unit_basis<>'COBALT_MT' OR product_code='CO_HYDROXIDE')),
 unit text NOT NULL CHECK(length(unit) BETWEEN 1 AND 40),
 clearing_agent text NOT NULL DEFAULT '',
 issuing_bank text NOT NULL DEFAULT '',
 unit_price numeric CHECK(unit_price>=0),
 price_unit text NOT NULL DEFAULT '',
 amount numeric CHECK(amount>=0),
 currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 destination text NOT NULL DEFAULT '',
 valid_from date,
 valid_until date,
 extended_until date,
 extension_on date,
 state text NOT NULL DEFAULT 'APPLYING' CHECK(state IN('APPLYING','ISSUED','CLOSED','CANCELLED')),
 closed_on date,
 note text NOT NULL DEFAULT '',
 next_serial bigint NOT NULL DEFAULT 1 CHECK(next_serial>0),
 version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((product_code='CU_CATHODE' AND cu_contract_id IS NOT NULL AND co_contract_id IS NULL) OR (product_code='CO_HYDROXIDE' AND co_contract_id IS NOT NULL AND cu_contract_id IS NULL)),
 CHECK(valid_until>=valid_from),
 CHECK((extended_until IS NULL)=(extension_on IS NULL) AND (extended_until IS NULL OR extended_until>valid_until)),
 CHECK(state NOT IN('ISSUED','CLOSED') OR (license_no IS NOT NULL AND valid_from IS NOT NULL AND valid_until IS NOT NULL)),
 CHECK((state='CLOSED')=(closed_on IS NOT NULL))
);
CREATE UNIQUE INDEX export_licenses_proforma_unique ON export_licenses(lower(proforma_no));
CREATE UNIQUE INDEX export_licenses_number_unique ON export_licenses(product_code,lower(license_no)) WHERE license_no IS NOT NULL;
CREATE INDEX export_licenses_scope ON export_licenses(product_code,project_id,customer_id,contract_id);

CREATE TABLE export_license_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 license_id uuid NOT NULL REFERENCES export_licenses(id),
 action text NOT NULL CHECK(action IN('ISSUE','AMEND','EXTEND','CANCEL','CLOSE','CLOSE_EXCEPTION','SETTLE','CORRECT')),
 payload jsonb NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000),
 requested_by uuid NOT NULL REFERENCES users(id),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decision text NOT NULL DEFAULT 'PENDING' CHECK(decision IN('PENDING','APPROVED','REJECTED')),
 reviewed_by uuid REFERENCES users(id),
 reviewed_at timestamptz,
 review_note text,
 result jsonb,
 CHECK((decision='PENDING')=(reviewed_by IS NULL AND reviewed_at IS NULL)),
 CHECK(reviewed_by IS DISTINCT FROM requested_by)
);
CREATE UNIQUE INDEX export_license_one_pending ON export_license_actions(license_id) WHERE decision='PENDING';
CREATE INDEX export_license_action_history ON export_license_actions(license_id,requested_at DESC,id);

CREATE TABLE export_license_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 license_id uuid NOT NULL REFERENCES export_licenses(id),
 product_code text NOT NULL CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 cu_plan_id uuid REFERENCES loading_plan_documents(id),
 co_plan_id uuid REFERENCES co_loading_plans(id),
 plan_id uuid GENERATED ALWAYS AS(coalesce(cu_plan_id,co_plan_id)) STORED,
 batch_id uuid NOT NULL,
 invoice_no text NOT NULL CHECK(length(invoice_no) BETWEEN 1 AND 77),
 reserved_quantity numeric NOT NULL CHECK(reserved_quantity>0),
 used_quantity numeric NOT NULL DEFAULT 0 CHECK(used_quantity>=0),
 state text NOT NULL DEFAULT 'RESERVED' CHECK(state IN('RESERVED','SETTLED','RELEASED','VOID')),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz,
 CHECK((product_code='CU_CATHODE' AND cu_plan_id IS NOT NULL AND co_plan_id IS NULL) OR (product_code='CO_HYDROXIDE' AND co_plan_id IS NOT NULL AND cu_plan_id IS NULL)),
 CHECK((state='SETTLED')=(used_quantity>0)),
 CHECK((state='RESERVED')=(closed_at IS NULL))
);
CREATE UNIQUE INDEX export_license_invoice_unique ON export_license_allocations(lower(invoice_no));
CREATE UNIQUE INDEX export_license_plan_active ON export_license_allocations(product_code,plan_id) WHERE state IN('RESERVED','SETTLED');
CREATE UNIQUE INDEX export_license_batch_reserved ON export_license_allocations(product_code,batch_id) WHERE state='RESERVED';
CREATE INDEX export_license_allocation_history ON export_license_allocations(license_id,created_at,id);

CREATE TABLE export_license_attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 license_id uuid NOT NULL REFERENCES export_licenses(id),
 category text NOT NULL CHECK(category IN('LICENSE','PROFORMA','EXTENSION','CLOSURE','USAGE','OTHER')),
 filename text NOT NULL,
 mime text NOT NULL CHECK(mime IN('application/pdf','image/png','image/jpeg')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 262144),
 sha256 text NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX export_license_attachment_history ON export_license_attachments(license_id,created_at,id);
CREATE TABLE export_license_preferences (
 product_code text PRIMARY KEY CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 expiry_days integer NOT NULL DEFAULT 30 CHECK(expiry_days BETWEEN 1 AND 365),
 updated_by uuid REFERENCES users(id)
);
INSERT INTO export_license_preferences(product_code) VALUES('CU_CATHODE'),('CO_HYDROXIDE');

CREATE VIEW export_license_postings AS
 SELECT a.id allocation_id,coalesce(cm.loading_id,cp.current_load_id) loading_id,p.posted_at,p.net_mt,
  cmr.estimated_metal_mt,cmr.confirmed_metal_mt
 FROM export_license_allocations a
 LEFT JOIN loading_plan_matches cm ON cm.document_id=a.cu_plan_id
 LEFT JOIN co_loading_plans cp ON cp.id=a.co_plan_id
 LEFT JOIN co_metal_outbound cmr ON cmr.order_id=cp.current_load_id
 JOIN LATERAL(SELECT max(s.posted_at) posted_at,CASE WHEN sum(s.unknown_packages)=0 THEN sum(s.net_mt) END net_mt
  FROM sales_invoice_shipments s WHERE s.product_code=a.product_code AND s.loading_id=coalesce(cm.loading_id,cp.current_load_id)
  HAVING count(*)>0) p ON true;

CREATE FUNCTION export_license_release_copper() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF OLD.cancelled_at IS NULL AND NEW.cancelled_at IS NOT NULL THEN
  PERFORM l.id FROM public.export_licenses l JOIN public.export_license_allocations a ON a.license_id=l.id
   WHERE a.cu_plan_id=NEW.id AND a.state='RESERVED' ORDER BY l.id FOR UPDATE OF l;
  UPDATE public.export_license_allocations SET state='RELEASED',closed_at=clock_timestamp()
   WHERE cu_plan_id=NEW.id AND state='RESERVED';
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION export_license_release_copper() FROM PUBLIC;
CREATE TRIGGER export_license_release_cancelled_copper AFTER UPDATE OF cancelled_at ON loading_plan_documents
 FOR EACH ROW EXECUTE FUNCTION export_license_release_copper();

GRANT SELECT,INSERT,UPDATE ON export_licenses,export_license_actions,export_license_allocations TO musonoi_app;
GRANT SELECT,INSERT ON export_license_attachments TO musonoi_app;
GRANT SELECT,UPDATE ON export_license_preferences TO musonoi_app;
GRANT SELECT ON export_license_postings TO musonoi_app;

INSERT INTO permissions(code) VALUES('export-license:read'),('export-license:write'),('export-license:approve');
INSERT INTO role_permission_caps(role_code,permission_code) VALUES
 ('admin','export-license:read'),('admin','export-license:write'),('admin','export-license:approve'),
 ('sales_operator','export-license:read'),('sales_operator','export-license:write'),
 ('sales_manager','export-license:read'),('sales_manager','export-license:write'),('sales_manager','export-license:approve'),
 ('commerce_manager','export-license:read'),('commerce_manager','export-license:approve'),
 ('logistics_manager','export-license:read'),('logistics_field_operator','export-license:read');
INSERT INTO role_permissions SELECT role_code,permission_code FROM role_permission_caps WHERE permission_code LIKE 'export-license:%';
