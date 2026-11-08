-- Append a Commercial Department Manager decision. Already-approved plans remain
-- valid under their recorded workflow; no historical approval is fabricated.
INSERT INTO permissions(code) VALUES('plan:commerce-approve') ON CONFLICT DO NOTHING;
INSERT INTO roles(code,name,name_en,built_in,created_at) VALUES('commerce_manager','商务部经理','Commercial Department Manager',false,clock_timestamp()) ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps(role_code,permission_code) SELECT 'commerce_manager',p FROM unnest(ARRAY['plan:read','plan:commerce-approve','customer:read','master:read']) p ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_code,permission_code) SELECT role_code,permission_code FROM role_permission_caps WHERE role_code='commerce_manager' ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps VALUES('admin','plan:commerce-approve') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions VALUES('admin','plan:commerce-approve') ON CONFLICT DO NOTHING;
ALTER TABLE sales_plan_approvals ADD COLUMN flow_version integer NOT NULL DEFAULT 1 CHECK(flow_version IN(1,2)),ADD COLUMN sales_reviewed_by uuid REFERENCES users(id),ADD COLUMN sales_reviewed_at timestamptz,ADD COLUMN sales_reason text NOT NULL DEFAULT '',ADD COLUMN commerce_reviewed_by uuid REFERENCES users(id),ADD COLUMN commerce_reviewed_at timestamptz,ADD COLUMN commerce_reason text NOT NULL DEFAULT '',ADD COLUMN rejected_stage text CHECK(rejected_stage IN('SALES','COMMERCE'));
ALTER TABLE sales_plan_approvals ALTER COLUMN flow_version SET DEFAULT 2;
-- Replace only the two state-related checks; the product, FK and version checks remain.
DO $$DECLARE r record;BEGIN FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='sales_plan_approvals'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%state%' LOOP EXECUTE format('ALTER TABLE sales_plan_approvals DROP CONSTRAINT %I',r.conname);END LOOP;END$$;
ALTER TABLE sales_plan_approvals ADD CHECK(state IN('PENDING','COMMERCE_PENDING','APPROVED','REJECTED')),
 ADD CHECK((state='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR(state<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by<>submitted_by)),
 ADD CHECK(state<>'COMMERCE_PENDING' OR(sales_reviewed_by IS NOT NULL AND sales_reviewed_at IS NOT NULL AND commerce_reviewed_by IS NULL)),
 ADD CHECK(flow_version=1 OR state<>'APPROVED' OR(sales_reviewed_by IS NOT NULL AND commerce_reviewed_by IS NOT NULL AND sales_reviewed_by<>commerce_reviewed_by AND commerce_reviewed_by<>submitted_by AND sales_reviewed_by<>submitted_by));
CREATE OR REPLACE FUNCTION ux10_plan_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a sales_plan_approvals;BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code AND p.permission_code='plan:write' WHERE u.id=NEW.created_by AND u.active AND u.deleted_at IS NULL AND u.role_code='sales_operator') THEN RAISE EXCEPTION 'SALES_OPERATOR_REQUIRED' USING ERRCODE='23514';END IF;
  INSERT INTO sales_plan_approvals(product_code,cu_plan_id,co_plan_id,submitted_by) VALUES(CASE WHEN TG_TABLE_NAME='sales_plans' THEN 'CU_CATHODE' ELSE 'CO_HYDROXIDE' END,CASE WHEN TG_TABLE_NAME='sales_plans' THEN NEW.id END,CASE WHEN TG_TABLE_NAME='co_sales_plans' THEN NEW.id END,NEW.created_by);
 ELSE
  SELECT * INTO a FROM sales_plan_approvals WHERE plan_id=OLD.id FOR UPDATE;
  IF FOUND THEN
   IF a.state IN('APPROVED','COMMERCE_PENDING') AND to_jsonb(NEW)-ARRAY['status','version','updated_at','updated_by']<>to_jsonb(OLD)-ARRAY['status','version','updated_at','updated_by'] THEN RAISE EXCEPTION 'SALES_APPROVED_PLAN_LOCKED' USING ERRCODE='23514';END IF;
   IF a.state IN('PENDING','REJECTED') THEN UPDATE sales_plan_approvals SET state='PENDING',flow_version=2,submitted_at=clock_timestamp(),reviewed_by=NULL,reviewed_at=NULL,reason='',sales_reviewed_by=NULL,sales_reviewed_at=NULL,sales_reason='',commerce_reviewed_by=NULL,commerce_reviewed_at=NULL,commerce_reason='',rejected_stage=NULL,version=version+1 WHERE plan_id=OLD.id;END IF;
  END IF;
 END IF;RETURN NEW;END$$;
CREATE OR REPLACE FUNCTION ux10_review_sales_plan(product text,plan uuid,actor uuid,expected_version integer,decision text,note text) RETURNS sales_plan_approvals LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a sales_plan_approvals;p_project uuid;p_warehouse uuid;p_customer uuid;expected_role text;required_permission text;stage text;BEGIN
 IF product='CU_CATHODE' THEN SELECT project_id,customer_id INTO p_project,p_customer FROM sales_plans WHERE id=plan FOR UPDATE;
 ELSIF product='CO_HYDROXIDE' THEN SELECT project_id,warehouse_id,customer_id INTO p_project,p_warehouse,p_customer FROM co_sales_plans WHERE id=plan FOR UPDATE;ELSE RAISE EXCEPTION 'SALES_REVIEW_INPUT' USING ERRCODE='23514';END IF;
 IF p_project IS NULL OR NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=actor AND s.project_id=p_project AND(s.customer_id IS NULL OR s.customer_id=p_customer) AND(product='CU_CATHODE' OR s.warehouse_id IS NULL OR s.warehouse_id=p_warehouse)) THEN RAISE EXCEPTION 'SALES_REVIEW_SCOPE' USING ERRCODE='23514';END IF;
 SELECT * INTO a FROM sales_plan_approvals WHERE plan_id=plan AND product_code=product FOR UPDATE;
 IF NOT FOUND OR a.state NOT IN('PENDING','COMMERCE_PENDING') OR a.version<>expected_version THEN RAISE EXCEPTION 'SALES_REVIEW_STALE' USING ERRCODE='23514';END IF;
 stage:=CASE WHEN a.state='PENDING' THEN 'SALES' ELSE 'COMMERCE' END;expected_role:=CASE WHEN stage='SALES' THEN 'sales_manager' ELSE 'commerce_manager' END;required_permission:=CASE WHEN stage='SALES' THEN 'plan:approve' ELSE 'plan:commerce-approve' END;
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code AND rp.permission_code=required_permission WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND u.role_code=expected_role) THEN RAISE EXCEPTION '%',CASE WHEN stage='SALES' THEN 'SALES_MANAGER_REQUIRED' ELSE 'COMMERCE_MANAGER_REQUIRED' END USING ERRCODE='23514';END IF;
 IF actor=a.submitted_by OR(stage='COMMERCE' AND actor=a.sales_reviewed_by) THEN RAISE EXCEPTION 'SALES_REVIEW_SELF' USING ERRCODE='23514';END IF;
 IF decision NOT IN('APPROVED','REJECTED') OR note IS NULL OR length(note)>1000 OR(decision='REJECTED' AND length(btrim(note))=0) THEN RAISE EXCEPTION 'SALES_REVIEW_INPUT' USING ERRCODE='23514';END IF;
 UPDATE sales_plan_approvals SET state=CASE WHEN decision='REJECTED' THEN 'REJECTED' WHEN stage='SALES' THEN 'COMMERCE_PENDING' ELSE 'APPROVED' END,flow_version=2,reviewed_by=actor,reviewed_at=clock_timestamp(),reason=note,
 sales_reviewed_by=CASE WHEN stage='SALES' THEN actor ELSE sales_reviewed_by END,sales_reviewed_at=CASE WHEN stage='SALES' THEN clock_timestamp() ELSE sales_reviewed_at END,sales_reason=CASE WHEN stage='SALES' THEN note ELSE sales_reason END,
 commerce_reviewed_by=CASE WHEN stage='COMMERCE' THEN actor ELSE commerce_reviewed_by END,commerce_reviewed_at=CASE WHEN stage='COMMERCE' THEN clock_timestamp() ELSE commerce_reviewed_at END,commerce_reason=CASE WHEN stage='COMMERCE' THEN note ELSE commerce_reason END,rejected_stage=CASE WHEN decision='REJECTED' THEN stage END,version=version+1 WHERE plan_id=plan RETURNING * INTO a;RETURN a;END$$;
