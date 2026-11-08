-- Copper sales/contracts/vehicles remain unchanged. Common customers hold contact information only.
CREATE TABLE co_sales_contracts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),
 project_id uuid NOT NULL REFERENCES projects(id),customer_id uuid NOT NULL REFERENCES customers(id),contract_no text NOT NULL CHECK(length(trim(contract_no)) BETWEEN 1 AND 80),
 effective_date date NOT NULL,end_date date NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(end_date>=effective_date),UNIQUE(project_id,contract_no),UNIQUE(id,project_id,customer_id));
CREATE SEQUENCE co_sales_plan_number;
CREATE TABLE co_sales_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),
 code text NOT NULL UNIQUE DEFAULT('CO-SP-'||nextval('co_sales_plan_number')::text),project_id uuid NOT NULL REFERENCES projects(id),warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 customer_id uuid NOT NULL REFERENCES customers(id),contract_id uuid NOT NULL,FOREIGN KEY(contract_id,project_id,customer_id) REFERENCES co_sales_contracts(id,project_id,customer_id),
 shipment_month text NOT NULL CHECK(shipment_month~'^\d{4}-(0[1-9]|1[0-2])$'),target_weight numeric NOT NULL CHECK(target_weight>0 AND target_weight<100000000),
 planned_metal_mt numeric CHECK(planned_metal_mt>0 AND planned_metal_mt<100000000),planned_vehicle_count integer NOT NULL CHECK(planned_vehicle_count BETWEEN 1 AND 2147483647),
 destination text NOT NULL CHECK(length(trim(destination)) BETWEEN 1 AND 1000),remark text NOT NULL DEFAULT '' CHECK(length(remark)<=1000),status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','CLOSED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,shipment_month));
CREATE TABLE co_dispatch_imports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),sales_plan_id uuid NOT NULL REFERENCES co_sales_plans(id),
 shipment_month text NOT NULL CHECK(shipment_month~'^\d{4}-(0[1-9]|1[0-2])$'),file_name text NOT NULL,file_sha256 text NOT NULL,row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 5000),
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(id,sales_plan_id,shipment_month));
CREATE TABLE co_dispatch_vehicles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),import_id uuid REFERENCES co_dispatch_imports(id),sales_plan_id uuid NOT NULL REFERENCES co_sales_plans(id),
 shipment_month text NOT NULL CHECK(shipment_month~'^\d{4}-(0[1-9]|1[0-2])$'),FOREIGN KEY(import_id,sales_plan_id,shipment_month) REFERENCES co_dispatch_imports(id,sales_plan_id,shipment_month),
 source_row integer,source_sheet text,truck_no text NOT NULL CHECK(length(trim(truck_no)) BETWEEN 1 AND 80),truck_key text GENERATED ALWAYS AS(upper(regexp_replace(truck_no,'[[:space:]-]+','','g'))) STORED CHECK(length(truck_key)>0),
 trailer_no text NOT NULL DEFAULT '' CHECK(length(trailer_no)<=80),transporter text NOT NULL DEFAULT '' CHECK(length(transporter)<=160),driver_name text NOT NULL DEFAULT '' CHECK(length(driver_name)<=160),passport_no text NOT NULL DEFAULT '' CHECK(length(passport_no)<=80),
 planned_arrival_date date,capacity_tonnes numeric(12,4) CHECK(capacity_tonnes>0 AND capacity_tonnes<=1000),remark text NOT NULL DEFAULT '' CHECK(length(remark)<=1000),
 cancelled_at timestamptz,cancellation_reason text,CHECK((cancelled_at IS NULL AND cancellation_reason IS NULL) OR(cancelled_at IS NOT NULL AND length(trim(cancellation_reason))>0)),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(sales_plan_id,shipment_month,truck_key),UNIQUE(id,sales_plan_id),UNIQUE(import_id,source_row));
CREATE TABLE co_vehicle_arrivals(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),dispatch_vehicle_id uuid NOT NULL UNIQUE,sales_plan_id uuid NOT NULL,
 FOREIGN KEY(dispatch_vehicle_id,sales_plan_id) REFERENCES co_dispatch_vehicles(id,sales_plan_id),arrived_at timestamptz NOT NULL,
 trailer_one text NOT NULL CHECK(length(trim(trailer_one)) BETWEEN 1 AND 80),trailer_two text NOT NULL DEFAULT '' CHECK(length(trailer_two)<=80),driver_name text NOT NULL CHECK(length(trim(driver_name)) BETWEEN 1 AND 160),passport_no text NOT NULL CHECK(length(trim(passport_no)) BETWEEN 1 AND 80),
 transporter text NOT NULL CHECK(length(trim(transporter)) BETWEEN 1 AND 160),container_no text NOT NULL DEFAULT '' CHECK(length(container_no)<=40),exception_remark text NOT NULL DEFAULT '' CHECK(length(exception_remark)<=1000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),registered_by uuid NOT NULL REFERENCES users(id),registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE co_sales_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entity_type text NOT NULL,entity_id uuid NOT NULL,project_id uuid NOT NULL REFERENCES projects(id),warehouse_id uuid REFERENCES warehouses(id),customer_id uuid NOT NULL REFERENCES customers(id),actor_id uuid NOT NULL REFERENCES users(id),before_data jsonb,after_data jsonb NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX co_sales_scope ON co_sales_plans(project_id,warehouse_id,customer_id,created_at);
CREATE INDEX co_dispatch_plan ON co_dispatch_vehicles(sales_plan_id,shipment_month);
CREATE INDEX co_sales_event_entity ON co_sales_events(entity_id,id);
CREATE TRIGGER co_sales_events_immutable BEFORE UPDATE OR DELETE ON co_sales_events FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE FUNCTION co_sales_authorized(actor uuid,permission text,project uuid,warehouse uuid,customer uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
SELECT EXISTS(SELECT 1 FROM users u JOIN role_permissions r ON r.role_code=u.role_code WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND r.permission_code=permission AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=u.id AND s.project_id=project AND(s.warehouse_id IS NULL OR s.warehouse_id=warehouse) AND(s.customer_id IS NULL OR s.customer_id=customer)))$$;
CREATE FUNCTION co_sales_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE d jsonb;p co_sales_plans;v co_dispatch_vehicles;k co_sales_contracts;pr uuid;wh uuid;cu uuid;permission text;allowed text[];BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_SALES_NO_DELETE' USING ERRCODE='23514';END IF;d:=to_jsonb(NEW);
 IF TG_TABLE_NAME='co_sales_contracts' THEN
  pr:=NEW.project_id;cu:=NEW.customer_id;permission:='customer:write';allowed:=ARRAY['contract_no','effective_date','end_date','active'];
  IF NOT EXISTS(SELECT 1 FROM customers WHERE id=cu AND project_id=pr) THEN RAISE EXCEPTION 'CO_SALES_CUSTOMER_PROJECT' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='co_sales_plans' THEN
  pr:=NEW.project_id;wh:=NEW.warehouse_id;cu:=NEW.customer_id;permission:='plan:write';allowed:=ARRAY['shipment_month','target_weight','planned_metal_mt','planned_vehicle_count','destination','remark','status'];
  IF NOT EXISTS(SELECT 1 FROM warehouses WHERE id=wh AND project_id=pr AND active) THEN RAISE EXCEPTION 'CO_SALES_WAREHOUSE' USING ERRCODE='23514';END IF;
  SELECT * INTO k FROM co_sales_contracts WHERE id=NEW.contract_id FOR SHARE;
  IF k.id IS NULL OR k.project_id<>pr OR k.customer_id<>cu THEN RAISE EXCEPTION 'CO_SALES_CONTRACT_PRODUCT' USING ERRCODE='23514';END IF;
  IF TG_OP='INSERT' THEN IF NEW.status<>'OPEN' THEN RAISE EXCEPTION 'CO_SALES_INITIAL_STATUS' USING ERRCODE='23514';END IF;END IF;
  IF NEW.status='OPEN' AND(NOT k.active OR (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date NOT BETWEEN k.effective_date AND k.end_date OR NOT EXISTS(SELECT 1 FROM customers WHERE id=cu AND active)) THEN RAISE EXCEPTION 'CO_SALES_CONTRACT_INVALID' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO p FROM co_sales_plans WHERE id=NEW.sales_plan_id FOR UPDATE;pr:=p.project_id;wh:=p.warehouse_id;cu:=p.customer_id;
  IF p.id IS NULL OR p.status<>'OPEN' THEN RAISE EXCEPTION 'CO_SALES_PLAN_CLOSED' USING ERRCODE='23514';END IF;
  IF TG_TABLE_NAME='co_dispatch_imports' THEN permission:='dispatch:write';allowed:=ARRAY[]::text[];
  ELSIF TG_TABLE_NAME='co_dispatch_vehicles' THEN
   permission:='dispatch:write';allowed:=ARRAY['truck_key','trailer_no','transporter','driver_name','passport_no','planned_arrival_date','capacity_tonnes','remark','cancelled_at','cancellation_reason'];
   IF TG_OP='INSERT' THEN IF NEW.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'CO_SALES_INITIAL_STATUS' USING ERRCODE='23514';END IF;
   ELSE IF OLD.cancelled_at IS NOT NULL OR EXISTS(SELECT 1 FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=NEW.id) THEN RAISE EXCEPTION 'CO_DISPATCH_LOCKED' USING ERRCODE='23514';END IF;END IF;
  ELSE
   permission:='vehicle-arrival:write';allowed:=ARRAY['arrived_at','trailer_one','trailer_two','driver_name','passport_no','transporter','container_no','exception_remark'];
   SELECT * INTO v FROM co_dispatch_vehicles WHERE id=NEW.dispatch_vehicle_id FOR UPDATE;
   IF v.id IS NULL OR v.sales_plan_id<>p.id OR v.cancelled_at IS NOT NULL OR NEW.arrived_at>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION 'CO_ARRIVAL_INVALID' USING ERRCODE='23514';END IF;
  END IF;
 END IF;
 IF NOT co_sales_authorized((d->>'updated_by')::uuid,permission,pr,wh,cu) THEN RAISE EXCEPTION 'CO_SALES_SCOPE_PERMISSION' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='co_dispatch_imports' THEN IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'CO_IMPORT_IMMUTABLE' USING ERRCODE='23514';END IF;
 ELSE
  IF TG_OP='INSERT' THEN IF NEW.version<>1 OR (d->>'created_by')::uuid IS DISTINCT FROM (d->>'updated_by')::uuid AND TG_TABLE_NAME<>'co_vehicle_arrivals' OR TG_TABLE_NAME='co_vehicle_arrivals' AND (d->>'registered_by')::uuid IS DISTINCT FROM (d->>'updated_by')::uuid THEN RAISE EXCEPTION 'CO_SALES_INITIAL_ACTOR_VERSION' USING ERRCODE='23514';END IF;
  ELSE
   IF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-(allowed||ARRAY['version','updated_by','updated_at'])) IS DISTINCT FROM (to_jsonb(OLD)-(allowed||ARRAY['version','updated_by','updated_at'])) THEN RAISE EXCEPTION 'CO_SALES_IDENTITY_VERSION' USING ERRCODE='23514';END IF;
  END IF;
 END IF;RETURN NEW;
END$$;
-- Import batches have no mutable version: actor is their creator.
ALTER TABLE co_dispatch_imports ADD COLUMN updated_by uuid NOT NULL REFERENCES users(id);
CREATE TRIGGER co_contract_guard BEFORE INSERT OR UPDATE OR DELETE ON co_sales_contracts FOR EACH ROW EXECUTE FUNCTION co_sales_guard();
CREATE TRIGGER co_plan_guard BEFORE INSERT OR UPDATE OR DELETE ON co_sales_plans FOR EACH ROW EXECUTE FUNCTION co_sales_guard();
CREATE TRIGGER co_dispatch_import_guard BEFORE INSERT OR UPDATE OR DELETE ON co_dispatch_imports FOR EACH ROW EXECUTE FUNCTION co_sales_guard();
CREATE TRIGGER co_dispatch_vehicle_guard BEFORE INSERT OR UPDATE OR DELETE ON co_dispatch_vehicles FOR EACH ROW EXECUTE FUNCTION co_sales_guard();
CREATE TRIGGER co_arrival_guard BEFORE INSERT OR UPDATE OR DELETE ON co_vehicle_arrivals FOR EACH ROW EXECUTE FUNCTION co_sales_guard();
CREATE FUNCTION co_sales_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$DECLARE d jsonb;p co_sales_plans;BEGIN d:=to_jsonb(NEW);
 IF TG_TABLE_NAME IN('co_sales_contracts','co_sales_plans') THEN
 INSERT INTO public.co_sales_events(entity_type,entity_id,project_id,warehouse_id,customer_id,actor_id,before_data,after_data) VALUES(TG_TABLE_NAME,NEW.id,(d->>'project_id')::uuid,(d->>'warehouse_id')::uuid,(d->>'customer_id')::uuid,(d->>'updated_by')::uuid,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,d);
 ELSE
 SELECT * INTO p FROM public.co_sales_plans WHERE id=(d->>'sales_plan_id')::uuid;
 INSERT INTO public.co_sales_events(entity_type,entity_id,project_id,warehouse_id,customer_id,actor_id,before_data,after_data) VALUES(TG_TABLE_NAME,NEW.id,p.project_id,p.warehouse_id,p.customer_id,(d->>'updated_by')::uuid,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,d);
 END IF;RETURN NEW;END$$;
CREATE TRIGGER co_contract_audit AFTER INSERT OR UPDATE ON co_sales_contracts FOR EACH ROW EXECUTE FUNCTION co_sales_audit();
CREATE TRIGGER co_plan_audit AFTER INSERT OR UPDATE ON co_sales_plans FOR EACH ROW EXECUTE FUNCTION co_sales_audit();
CREATE TRIGGER co_dispatch_import_audit AFTER INSERT ON co_dispatch_imports FOR EACH ROW EXECUTE FUNCTION co_sales_audit();
CREATE TRIGGER co_dispatch_vehicle_audit AFTER INSERT OR UPDATE ON co_dispatch_vehicles FOR EACH ROW EXECUTE FUNCTION co_sales_audit();
CREATE TRIGGER co_arrival_audit AFTER INSERT OR UPDATE ON co_vehicle_arrivals FOR EACH ROW EXECUTE FUNCTION co_sales_audit();
GRANT SELECT,INSERT,UPDATE ON co_sales_contracts,co_sales_plans,co_dispatch_vehicles,co_vehicle_arrivals TO musonoi_app;
GRANT SELECT,INSERT ON co_dispatch_imports TO musonoi_app;
GRANT SELECT ON co_sales_events TO musonoi_app;
GRANT USAGE ON SEQUENCE co_sales_plan_number TO musonoi_app;
-- Reuse existing plan/customer/dispatch/vehicle-arrival permissions. No role grants expanded.
