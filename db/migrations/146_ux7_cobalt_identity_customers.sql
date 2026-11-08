-- Seven UI corrections: independent cobalt customer profiles and preparation-only identity.
-- Historical migrations and all historical business identities remain untouched.
ALTER TABLE co_preparations ADD COLUMN identity_mode text NOT NULL DEFAULT 'LEGACY_BATCH' CHECK(identity_mode IN('LEGACY_BATCH','PREPARATION'));
ALTER TABLE co_preparation_lines ALTER COLUMN production_batch_id DROP NOT NULL;
CREATE UNIQUE INDEX co_preparation_single_identity_line ON co_preparation_lines(preparation_id) WHERE production_batch_id IS NULL;
CREATE FUNCTION co_preparation_line_mode_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_preparations;BEGIN
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id;
 IF p.status<>'DRAFT' OR (p.identity_mode='PREPARATION' AND(NEW.production_batch_id IS NOT NULL OR NEW.bag_count<>p.bag_count)) OR(p.identity_mode='LEGACY_BATCH' AND NEW.production_batch_id IS NULL) THEN RAISE EXCEPTION 'CO_PREPARATION_LINE_MODE' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER co_preparation_line_mode BEFORE INSERT ON co_preparation_lines FOR EACH ROW EXECUTE FUNCTION co_preparation_line_mode_guard();
-- Preserve the immutable bag/preparation/line relationship; only optional legacy metadata uses a LEFT JOIN.
DO $$DECLARE def text;BEGIN SELECT pg_get_functiondef(oid) INTO def FROM pg_proc WHERE proname='co_loading_bag_guard' AND pronamespace='public'::regnamespace;
 IF position('JOIN co_production_batches pb' in def)=0 THEN RAISE EXCEPTION 'EXPECTED_CO_BAG_GUARD_BASELINE';END IF;
 EXECUTE replace(def,'JOIN co_production_batches pb','LEFT JOIN co_production_batches pb');END$$;

ALTER TABLE customers ADD COLUMN product_code text NOT NULL DEFAULT 'CU_CATHODE' CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE'));
CREATE VIEW copper_customers AS SELECT * FROM customers WHERE product_code='CU_CATHODE';
CREATE TABLE co_customer_profiles(
 id uuid PRIMARY KEY REFERENCES customers(id),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),project_id uuid NOT NULL REFERENCES projects(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 60),name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 address text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',phone text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_by uuid REFERENCES users(id),legacy_shared boolean NOT NULL DEFAULT false,
 UNIQUE(project_id,code),UNIQUE(id,project_id));
-- Only records with proven previous cobalt use receive an independent profile. No copper-only customer is imported.
INSERT INTO co_customer_profiles(id,project_id,code,name,active,version,address,email,phone,created_at,legacy_shared)
 SELECT c.id,c.project_id,c.code,c.name,c.active,c.version,coalesce(c.address,''),coalesce(c.email,''),coalesce(c.phone,''),c.created_at,true FROM customers c WHERE EXISTS(SELECT 1 FROM co_sales_contracts k WHERE k.customer_id=c.id) OR EXISTS(SELECT 1 FROM co_sales_plans p WHERE p.customer_id=c.id) OR EXISTS(SELECT 1 FROM co_requests r WHERE r.route LIKE 'POST /api/v1/cobalt/sales/customers%' AND r.response->>'customer_id'=c.id::text);
ALTER TABLE co_sales_contracts ADD CONSTRAINT co_contract_customer_profile FOREIGN KEY(customer_id,project_id) REFERENCES co_customer_profiles(id,project_id);
ALTER TABLE co_sales_plans ADD CONSTRAINT co_plan_customer_profile FOREIGN KEY(customer_id,project_id) REFERENCES co_customer_profiles(id,project_id);
CREATE FUNCTION co_customer_profile_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE c customers;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_CUSTOMER_HISTORY_PRESERVED' USING ERRCODE='23514';END IF;
 SELECT * INTO c FROM customers WHERE id=NEW.id;
 IF c.project_id IS DISTINCT FROM NEW.project_id OR (NOT NEW.legacy_shared AND c.product_code<>'CO_HYDROXIDE') THEN RAISE EXCEPTION 'CO_CUSTOMER_IDENTITY' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' AND NEW.legacy_shared AND NOT(EXISTS(SELECT 1 FROM co_sales_contracts k WHERE k.customer_id=NEW.id) OR EXISTS(SELECT 1 FROM co_requests r WHERE r.route LIKE 'POST /api/v1/cobalt/sales/customers%' AND r.response->>'customer_id'=NEW.id::text)) THEN RAISE EXCEPTION 'CO_CUSTOMER_LEGACY_PROVENANCE' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND((to_jsonb(NEW)-ARRAY['code','name','address','email','phone','active','version','updated_at','updated_by']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['code','name','address','email','phone','active','version','updated_at','updated_by']) OR NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'CO_CUSTOMER_IDENTITY' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER co_customer_profile_identity BEFORE INSERT OR UPDATE OR DELETE ON co_customer_profiles FOR EACH ROW EXECUTE FUNCTION co_customer_profile_guard();
CREATE FUNCTION customer_product_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.product_code<>OLD.product_code OR OLD.product_code='CO_HYDROXIDE' THEN RAISE EXCEPTION 'CUSTOMER_PRODUCT_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
CREATE TRIGGER customer_product_identity BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION customer_product_identity_guard();
CREATE FUNCTION copper_customer_reference_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE k text;v uuid;BEGIN
 FOREACH k IN ARRAY TG_ARGV LOOP v:=nullif(to_jsonb(NEW)->>k,'')::uuid;IF v IS NOT NULL AND NOT EXISTS(SELECT 1 FROM customers WHERE id=v AND product_code='CU_CATHODE') THEN RAISE EXCEPTION 'COPPER_CUSTOMER_REQUIRED' USING ERRCODE='23514';END IF;END LOOP;RETURN NEW;END$$;
DO $$DECLARE r record;args text;BEGIN
 FOR r IN SELECT t.relname,array_agg(DISTINCT a.attname) cols FROM pg_constraint f JOIN pg_class t ON t.oid=f.conrelid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(f.conkey) WHERE f.contype='f' AND a.attname IN('customer_id','reserved_for_customer_id') AND f.confrelid='customers'::regclass AND t.relnamespace='public'::regnamespace AND t.relname NOT LIKE 'co\_%' ESCAPE '\' AND t.relname<>'user_scopes' GROUP BY t.relname LOOP
 SELECT string_agg(quote_literal(v),',') INTO args FROM unnest(r.cols) v;
 EXECUTE format('CREATE TRIGGER copper_customer_reference BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION copper_customer_reference_guard(%s)',r.relname,args);END LOOP;
END$$;
-- New cobalt snapshots and eligibility use cobalt profiles; already-frozen snapshots are not rewritten.
DO $$DECLARE n text;def text;BEGIN FOREACH n IN ARRAY ARRAY['co_sales_guard','co_execution_record_guard','co_loading_arrival_valid'] LOOP
 SELECT pg_get_functiondef(oid) INTO def FROM pg_proc WHERE proname=n AND pronamespace='public'::regnamespace;
 IF def IS NULL THEN RAISE EXCEPTION 'EXPECTED_CO_CUSTOMER_BASELINE';END IF;
 EXECUTE replace(replace(def,'FROM customers','FROM co_customer_profiles'),'JOIN customers','JOIN co_customer_profiles');END LOOP;END$$;
GRANT SELECT ON copper_customers TO musonoi_app;
GRANT SELECT,INSERT,UPDATE ON co_customer_profiles TO musonoi_app;
