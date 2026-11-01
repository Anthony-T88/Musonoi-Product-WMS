-- Preserve existing business IDs and snapshots; govern newly created Loading Plans.
ALTER TABLE customers ADD COLUMN created_at timestamptz;
UPDATE customers c SET created_at=(SELECT min(a.occurred_at) FROM audit_logs a WHERE a.entity_type='customers' AND a.entity_id=c.id::text AND a.action='master_created');
ALTER TABLE customers ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE FUNCTION v34_location_code(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT regexp_replace(value,'^(P[0-9]+)-([1-9])$','\1-0\2') $$;
INSERT INTO stock_map_cells(code,region_code,display_order,x,y,width,height) SELECT v34_location_code(code),region_code,display_order,x,y,width,height FROM stock_map_cells WHERE code ~ '^P[0-9]+-[1-9]$';
UPDATE locations SET code=v34_location_code(code),map_cell_code=v34_location_code(map_cell_code),version=version+1 WHERE code ~ '^P[0-9]+-[1-9]$' OR map_cell_code ~ '^P[0-9]+-[1-9]$';
DELETE FROM stock_map_cells WHERE code ~ '^P[0-9]+-[1-9]$';
CREATE OR REPLACE FUNCTION v265_bundle_key(label text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT CASE WHEN upper(trim(label)) ~ '^MUS-[0-9]{4}-[0-9]{1,3}-[0-9]+$' THEN split_part(upper(trim(label)),'-',1)||'-'||split_part(label,'-',2)||'-'||lpad(split_part(label,'-',3),3,'0')||'-'||coalesce(nullif(ltrim(split_part(label,'-',4),'0'),''),'0') ELSE upper(trim(label)) END $$;
ALTER TABLE sales_dispatch_vehicles ADD COLUMN cancelled_at timestamptz,ADD COLUMN cancellation_reason text;
CREATE TABLE vehicle_arrivals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dispatch_vehicle_id uuid NOT NULL UNIQUE REFERENCES sales_dispatch_vehicles(id),sales_plan_id uuid NOT NULL REFERENCES sales_plans(id),shipment_month text NOT NULL CHECK(shipment_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),trailer_one text NOT NULL,trailer_two text NOT NULL DEFAULT '',driver_name text NOT NULL,passport_no text NOT NULL,container_no text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1,registered_by uuid NOT NULL REFERENCES users(id),registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE customer_transport_book(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customers(id),field text NOT NULL CHECK(field IN('export_license_no','transporter','destination')),value text NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 1000),active boolean NOT NULL DEFAULT true,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(customer_id,field,value));
ALTER TABLE loading_plan_documents ADD COLUMN arrival_id uuid REFERENCES vehicle_arrivals(id),ADD COLUMN arrival_required boolean NOT NULL DEFAULT false;
ALTER TABLE loading_plan_documents ALTER COLUMN arrival_required SET DEFAULT true;
CREATE UNIQUE INDEX loading_plan_one_active_arrival ON loading_plan_documents(arrival_id) WHERE cancelled_at IS NULL AND arrival_id IS NOT NULL;
CREATE TABLE loading_plan_lot_locks(allocation_id uuid PRIMARY KEY REFERENCES allocations(id),document_id uuid NOT NULL UNIQUE REFERENCES loading_plan_documents(id),actor_id uuid NOT NULL REFERENCES users(id),locked_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE FUNCTION v34_loading_lot_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(21004);
 IF EXISTS(SELECT 1 FROM loading_plan_lots q JOIN loading_plan_documents d ON d.id=q.document_id JOIN loading_plan_groups g ON g.id=d.group_id WHERE q.allocation_id=NEW.allocation_id AND q.document_id<>NEW.document_id AND d.cancelled_at IS NULL AND g.cancelled_at IS NULL) THEN RAISE EXCEPTION '该备货批次已被其他装车计划锁定' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v34_loading_lot_lock_guard BEFORE INSERT OR UPDATE ON loading_plan_lot_locks FOR EACH ROW EXECUTE FUNCTION v34_loading_lot_lock_guard();
CREATE FUNCTION v34_plan_closed_locks() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN IF NEW.cancelled_at IS NOT NULL THEN DELETE FROM loading_plan_lot_locks WHERE document_id=NEW.id;END IF;RETURN NEW;END $$;
CREATE TRIGGER v34_plan_closed_locks AFTER UPDATE OF cancelled_at ON loading_plan_documents FOR EACH ROW EXECUTE FUNCTION v34_plan_closed_locks();
CREATE FUNCTION v34_loading_plan_integrity() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE did uuid;d loading_plan_documents;a vehicle_arrivals;BEGIN
 IF TG_TABLE_NAME='loading_plan_documents' THEN did:=coalesce(NEW.id,OLD.id);ELSE did:=coalesce(NEW.document_id,OLD.document_id);END IF;
 SELECT * INTO d FROM loading_plan_documents WHERE id=did;IF NOT FOUND OR d.cancelled_at IS NOT NULL OR NOT d.arrival_required THEN RETURN NULL;END IF;
 SELECT * INTO a FROM vehicle_arrivals WHERE id=d.arrival_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM loading_plan_groups g WHERE g.id=d.group_id AND g.sales_plan_id=a.sales_plan_id) THEN RAISE EXCEPTION '新装车计划必须关联同一销售计划的已登记到厂车辆' USING ERRCODE='23514';END IF;
 IF (SELECT count(*) FROM loading_plan_lots WHERE document_id=did)<>1 OR NOT EXISTS(SELECT 1 FROM loading_plan_lots q JOIN loading_plan_lot_locks k USING(allocation_id,document_id) WHERE q.document_id=did) THEN RAISE EXCEPTION '每张装车计划必须且只能锁定一个备货批次' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER v34_plan_integrity AFTER INSERT OR UPDATE ON loading_plan_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v34_loading_plan_integrity();
CREATE CONSTRAINT TRIGGER v34_plan_lots_integrity AFTER INSERT OR UPDATE OR DELETE ON loading_plan_lots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v34_loading_plan_integrity();
INSERT INTO permissions(code) VALUES('vehicle-arrival:read'),('vehicle-arrival:write') ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps SELECT r,'vehicle-arrival:read' FROM unnest(ARRAY['admin','logistics_manager','site_supervisor','logistics_office_operator','logistics_field_operator','export_supervisor']) r ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r,'vehicle-arrival:read' FROM unnest(ARRAY['admin','logistics_manager','site_supervisor','logistics_office_operator','logistics_field_operator','export_supervisor']) r ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps SELECT r,'vehicle-arrival:write' FROM unnest(ARRAY['admin','logistics_manager','logistics_field_operator']) r ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT r,'vehicle-arrival:write' FROM unnest(ARRAY['admin','logistics_manager','logistics_field_operator']) r ON CONFLICT DO NOTHING;
GRANT SELECT,INSERT,UPDATE ON vehicle_arrivals,customer_transport_book TO musonoi_app;
GRANT SELECT,INSERT,DELETE ON loading_plan_lot_locks TO musonoi_app;
GRANT UPDATE(cancelled_at,cancellation_reason) ON sales_dispatch_vehicles TO musonoi_app;
CREATE INDEX vehicle_arrivals_sales_month ON vehicle_arrivals(sales_plan_id,shipment_month);

DO $$ DECLARE b uuid;BEGIN FOR b IN SELECT id FROM bundles WHERE location_id IN(SELECT id FROM locations WHERE code ~ '^P[0-9]+-0[1-9]$') LOOP PERFORM v24_capture_bundle(b);END LOOP;END $$;
