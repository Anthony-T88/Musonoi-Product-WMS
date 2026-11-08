-- New plans require a separate Sales Manager decision. Existing rows are legacy;
-- no historical plan, approval, inventory or account is rewritten.
INSERT INTO permissions(code) VALUES('plan:approve') ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps VALUES('sales_operator','plan:write'),('sales_manager','plan:approve'),('admin','plan:approve') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions VALUES('sales_operator','plan:write'),('sales_manager','plan:approve'),('admin','plan:approve') ON CONFLICT DO NOTHING;
CREATE TABLE sales_plan_approvals(
 plan_id uuid GENERATED ALWAYS AS(coalesce(cu_plan_id,co_plan_id)) STORED PRIMARY KEY,
 product_code text NOT NULL CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 cu_plan_id uuid UNIQUE REFERENCES sales_plans(id),co_plan_id uuid UNIQUE REFERENCES co_sales_plans(id),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','APPROVED','REJECTED')),
 submitted_by uuid NOT NULL REFERENCES users(id),submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,reason text NOT NULL DEFAULT '',version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((product_code='CU_CATHODE' AND cu_plan_id IS NOT NULL AND co_plan_id IS NULL) OR(product_code='CO_HYDROXIDE' AND co_plan_id IS NOT NULL AND cu_plan_id IS NULL)),
 CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR(state IN('APPROVED','REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by<>submitted_by))
);
CREATE FUNCTION ux10_plan_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a sales_plan_approvals; BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code AND p.permission_code='plan:write' WHERE u.id=NEW.created_by AND u.active AND u.deleted_at IS NULL AND u.role_code='sales_operator') THEN RAISE EXCEPTION 'SALES_OPERATOR_REQUIRED' USING ERRCODE='23514';END IF;
  INSERT INTO sales_plan_approvals(product_code,cu_plan_id,co_plan_id,submitted_by) VALUES(CASE WHEN TG_TABLE_NAME='sales_plans' THEN 'CU_CATHODE' ELSE 'CO_HYDROXIDE' END,CASE WHEN TG_TABLE_NAME='sales_plans' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='co_sales_plans' THEN NEW.id END,NEW.created_by);
 ELSE
  SELECT * INTO a FROM sales_plan_approvals WHERE plan_id=OLD.id FOR UPDATE;
  IF FOUND THEN
   IF a.state='APPROVED' AND to_jsonb(NEW)-ARRAY['status','version','updated_at','updated_by']<>to_jsonb(OLD)-ARRAY['status','version','updated_at','updated_by'] THEN RAISE EXCEPTION 'SALES_APPROVED_PLAN_LOCKED' USING ERRCODE='23514';END IF;
   IF a.state<>'APPROVED' THEN UPDATE sales_plan_approvals SET state='PENDING',submitted_at=clock_timestamp(),reviewed_by=NULL,reviewed_at=NULL,reason='',version=version+1 WHERE plan_id=OLD.id;END IF;
  END IF;
 END IF;RETURN NEW;END$$;
CREATE TRIGGER ux10_sales_submission AFTER INSERT OR UPDATE ON sales_plans FOR EACH ROW EXECUTE FUNCTION ux10_plan_submission();
CREATE TRIGGER ux10_co_sales_submission AFTER INSERT OR UPDATE ON co_sales_plans FOR EACH ROW EXECUTE FUNCTION ux10_plan_submission();
CREATE FUNCTION ux10_sales_ready(product text,plan uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT NOT EXISTS(SELECT 1 FROM sales_plan_approvals WHERE plan_id=plan AND product_code=product AND state<>'APPROVED')$$;
CREATE FUNCTION ux10_approved_plan_dependency() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF NOT ux10_sales_ready(TG_ARGV[0],(to_jsonb(NEW)->>TG_ARGV[1])::uuid) THEN RAISE EXCEPTION 'SALES_PLAN_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
DO $$DECLARE r record;BEGIN
 FOR r IN SELECT * FROM(VALUES('allocations','plan_id','CU_CATHODE'),('sales_dispatch_imports','sales_plan_id','CU_CATHODE'),('loading_plan_groups','sales_plan_id','CU_CATHODE'),('co_dispatch_imports','sales_plan_id','CO_HYDROXIDE'),('co_dispatch_vehicles','sales_plan_id','CO_HYDROXIDE'),('co_vehicle_arrivals','sales_plan_id','CO_HYDROXIDE'),('co_loading_plans','sales_plan_id','CO_HYDROXIDE'),('co_loading_orders','sales_plan_id','CO_HYDROXIDE')) t(tab,col,product) LOOP
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=r.tab AND column_name=r.col) THEN EXECUTE format('CREATE TRIGGER ux10_approved_plan BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION ux10_approved_plan_dependency(%L,%L)',r.col,r.tab,r.product,r.col);END IF;
 END LOOP;END$$;
CREATE FUNCTION ux10_review_sales_plan(product text,plan uuid,actor uuid,expected_version integer,decision text,note text) RETURNS sales_plan_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a sales_plan_approvals;p_project uuid;p_warehouse uuid;p_customer uuid;BEGIN
 IF product='CU_CATHODE' THEN SELECT project_id,customer_id INTO p_project,p_customer FROM sales_plans WHERE id=plan FOR UPDATE;
 ELSIF product='CO_HYDROXIDE' THEN SELECT project_id,warehouse_id,customer_id INTO p_project,p_warehouse,p_customer FROM co_sales_plans WHERE id=plan FOR UPDATE;ELSE RAISE EXCEPTION 'SALES_REVIEW_INPUT' USING ERRCODE='23514';END IF;
 IF p_project IS NULL OR NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=actor AND s.project_id=p_project AND(s.customer_id IS NULL OR s.customer_id=p_customer) AND(s.warehouse_id IS NULL OR s.warehouse_id=p_warehouse)) THEN RAISE EXCEPTION 'SALES_REVIEW_SCOPE' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code AND rp.permission_code='plan:approve' WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND u.role_code='sales_manager') THEN RAISE EXCEPTION 'SALES_MANAGER_REQUIRED' USING ERRCODE='23514';END IF;
 SELECT * INTO a FROM sales_plan_approvals WHERE plan_id=plan AND product_code=product FOR UPDATE;
 IF NOT FOUND OR a.state<>'PENDING' OR a.version<>expected_version THEN RAISE EXCEPTION 'SALES_REVIEW_STALE' USING ERRCODE='23514';END IF;
 IF actor=a.submitted_by THEN RAISE EXCEPTION 'SALES_REVIEW_SELF' USING ERRCODE='23514';END IF;
 IF decision NOT IN('APPROVED','REJECTED') OR note IS NULL OR length(note)>1000 OR(decision='REJECTED' AND length(btrim(note))=0) THEN RAISE EXCEPTION 'SALES_REVIEW_INPUT' USING ERRCODE='23514';END IF;
 UPDATE sales_plan_approvals SET state=decision,reviewed_by=actor,reviewed_at=clock_timestamp(),reason=note,version=version+1 WHERE plan_id=plan RETURNING * INTO a;RETURN a;END$$;
REVOKE ALL ON sales_plan_approvals FROM PUBLIC,musonoi_app;
GRANT SELECT ON sales_plan_approvals TO musonoi_app;
REVOKE ALL ON FUNCTION ux10_review_sales_plan(text,uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ux10_review_sales_plan(text,uuid,uuid,integer,text,text) TO musonoi_app;
