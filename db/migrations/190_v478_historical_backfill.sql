-- Read-only historical documents share the original source ledger and are
-- intentionally outside the live inventory, approval and licence tables.
CREATE TABLE historical_backfills (
 source_id uuid PRIMARY KEY REFERENCES historical_movement_documents(id),
 import_batch_id uuid NOT NULL,
 backfilled_by uuid NOT NULL REFERENCES users(id),
 backfilled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 project_id uuid NOT NULL REFERENCES projects(id),
 warehouse_id uuid NOT NULL,
 customer_id uuid,
 original_receipt_date date,
 receipt_source_id uuid REFERENCES historical_movement_documents(id),
 FOREIGN KEY (project_id,warehouse_id) REFERENCES warehouses(project_id,id),
 FOREIGN KEY (project_id,customer_id) REFERENCES customers(project_id,id)
);
CREATE INDEX historical_backfill_scope ON historical_backfills(project_id,warehouse_id,customer_id);
CREATE INDEX historical_backfill_batch ON historical_backfills(import_batch_id);

CREATE TABLE historical_business_documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_id uuid NOT NULL REFERENCES historical_backfills(source_id),
 kind text NOT NULL CHECK (kind IN ('RECEIPT','LOADING_PLAN','LOADING_ORDER','OUTBOUND')),
 document_no text NOT NULL,
 business_date date NOT NULL,
 event_order smallint GENERATED ALWAYS AS
  (CASE kind WHEN 'RECEIPT' THEN 1 WHEN 'LOADING_PLAN' THEN 2 WHEN 'LOADING_ORDER' THEN 3 ELSE 4 END) STORED,
 UNIQUE(source_id,kind)
);
CREATE INDEX historical_business_kind_date ON historical_business_documents(kind,business_date DESC,id);

CREATE TABLE historical_stock_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_id uuid NOT NULL REFERENCES historical_backfills(source_id),
 source_row integer NOT NULL,
 product_code text NOT NULL CHECK (product_code IN ('CU_CATHODE','CO_HYDROXIDE')),
 unit_key text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 FOREIGN KEY (source_id,source_row) REFERENCES historical_movement_lines(document_id,source_row),
 UNIQUE (source_id,source_row)
);
CREATE UNIQUE INDEX historical_active_unit ON historical_stock_units(product_code,unit_key) WHERE active;
CREATE INDEX historical_stock_source ON historical_stock_units(source_id);

GRANT SELECT,INSERT ON historical_backfills,historical_business_documents,historical_stock_units TO musonoi_app;
GRANT UPDATE(active) ON historical_stock_units TO musonoi_app;

CREATE FUNCTION historical_unit_key(value text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT normalize(upper(regexp_replace(btrim(value),'[[:space:]]+',' ','g')),NFKC)
$$;
CREATE FUNCTION historical_stock_key(value text) RETURNS text
 LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT public.v265_bundle_key(public.historical_unit_key(value))
$$;
CREATE INDEX historical_movement_normalized_unit ON historical_movement_lines(historical_stock_key(unit_id),document_id);

CREATE VIEW historical_outbound_units AS
 SELECT h.id,h.source_id,h.unit_key,m.product_code,m.document_no packing_list_no,
  m.business_date shipping_date,m.source_facts,m.imported_at,m.imported_by,
  b.project_id,b.warehouse_id,b.customer_id,b.original_receipt_date,b.import_batch_id,
  l.unit_id,l.source_row,l.seal_no,l.sheets_count,l.net_kg,l.gross_kg
 FROM historical_stock_units h
 JOIN historical_backfills b ON b.source_id=h.source_id
 JOIN historical_movement_documents m ON m.id=h.source_id AND m.voided_at IS NULL
 JOIN historical_movement_lines l ON l.document_id=h.source_id AND l.source_row=h.source_row
 WHERE h.active;
GRANT SELECT ON historical_outbound_units TO musonoi_app;

-- Live writes serialize against import confirmation and may not reuse a
-- shipped unit identifier from the historical archive.
CREATE FUNCTION historical_guard_unit() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE product text; unit text;
 BEGIN
  IF TG_TABLE_NAME='bundles' THEN product:='CU_CATHODE'; unit:=NEW.bundle_no;
  ELSE product:='CO_HYDROXIDE'; unit:=NEW.bag_no;
  END IF;
  PERFORM pg_advisory_xact_lock(477189);
  IF EXISTS(SELECT 1 FROM public.historical_stock_units WHERE product_code=product AND unit_key=public.historical_stock_key(unit) AND active) THEN
   RAISE EXCEPTION 'HISTORICAL_UNIT_CONFLICT' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER historical_copper_unit_guard BEFORE INSERT OR UPDATE OF bundle_no ON bundles
 FOR EACH ROW EXECUTE FUNCTION historical_guard_unit();
CREATE TRIGGER historical_cobalt_unit_guard BEFORE INSERT OR UPDATE OF bag_no ON co_bags
 FOR EACH ROW EXECUTE FUNCTION historical_guard_unit();

CREATE FUNCTION historical_guard_packing_number() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE product text;
 BEGIN
  product:=CASE WHEN TG_TABLE_NAME='packing_list_documents' THEN 'CU_CATHODE' ELSE 'CO_HYDROXIDE' END;
  PERFORM pg_advisory_xact_lock(477189);
  IF EXISTS(SELECT 1 FROM public.historical_movement_documents m JOIN public.historical_backfills b ON b.source_id=m.id
   WHERE m.voided_at IS NULL AND m.product_code=product AND m.document_key=public.historical_unit_key(NEW.document_no)) THEN
   RAISE EXCEPTION 'HISTORICAL_PACKING_NUMBER_CONFLICT' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
 END $$;
CREATE TRIGGER historical_copper_packing_guard BEFORE INSERT OR UPDATE OF document_no ON packing_list_documents
 FOR EACH ROW EXECUTE FUNCTION historical_guard_packing_number();
CREATE TRIGGER historical_cobalt_packing_guard BEFORE INSERT OR UPDATE OF document_no ON co_packing_documents
 FOR EACH ROW EXECUTE FUNCTION historical_guard_packing_number();
