-- Closing is a separate, independent two-stage request. Existing plans,
-- approvals, users, scopes and audit rows are not rewritten.
CREATE TABLE sales_plan_close_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 product_code text NOT NULL CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 cu_plan_id uuid REFERENCES sales_plans(id),co_plan_id uuid REFERENCES co_sales_plans(id),
 plan_id uuid GENERATED ALWAYS AS(coalesce(cu_plan_id,co_plan_id)) STORED,
 plan_version integer NOT NULL CHECK(plan_version>0),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','COMMERCE_PENDING','APPROVED','REJECTED','STALE')),
 requested_by uuid NOT NULL REFERENCES users(id),requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 request_reason text NOT NULL DEFAULT '' CHECK(length(request_reason)<=1000),
 sales_reviewed_by uuid REFERENCES users(id),sales_reviewed_at timestamptz,sales_reason text NOT NULL DEFAULT '',
 commerce_reviewed_by uuid REFERENCES users(id),commerce_reviewed_at timestamptz,commerce_reason text NOT NULL DEFAULT '',
 rejected_stage text CHECK(rejected_stage IN('SALES','COMMERCE')),applied_transaction bigint,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK((product_code='CU_CATHODE' AND cu_plan_id IS NOT NULL AND co_plan_id IS NULL) OR(product_code='CO_HYDROXIDE' AND co_plan_id IS NOT NULL AND cu_plan_id IS NULL)),
 CHECK(sales_reviewed_by IS NULL OR sales_reviewed_by<>requested_by),
 CHECK(commerce_reviewed_by IS NULL OR(commerce_reviewed_by<>requested_by AND commerce_reviewed_by IS DISTINCT FROM sales_reviewed_by)),
 CHECK(state<>'COMMERCE_PENDING' OR(sales_reviewed_by IS NOT NULL AND sales_reviewed_at IS NOT NULL AND commerce_reviewed_by IS NULL)),
 CHECK(state<>'APPROVED' OR(sales_reviewed_by IS NOT NULL AND commerce_reviewed_by IS NOT NULL AND commerce_reviewed_at IS NOT NULL AND applied_transaction IS NOT NULL))
);
CREATE UNIQUE INDEX sales_plan_close_one_pending ON sales_plan_close_requests(product_code,plan_id) WHERE state IN('PENDING','COMMERCE_PENDING');
CREATE INDEX sales_plan_close_history ON sales_plan_close_requests(product_code,plan_id,requested_at DESC,id);

CREATE FUNCTION v468_close_readiness(product text,plan uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE control jsonb;vehicles integer;documents integer;loads integer;physical boolean;
BEGIN
 IF product='CU_CATHODE' THEN
  control:=v265_plan_progress(plan);
  physical:=coalesce((control->>'fields_complete')::boolean,false) AND coalesce((control->>'unknown_bundles')::integer,0)=0 AND coalesce((control->>'assigned_net_weight')::numeric,0)=0;
  SELECT count(*) INTO vehicles FROM sales_dispatch_vehicles v JOIN sales_dispatch_imports i ON i.id=v.import_id
   WHERE i.sales_plan_id=plan AND v.cancelled_at IS NULL AND NOT EXISTS(
    SELECT 1 FROM vehicle_arrivals a JOIN loading_plan_documents d ON d.arrival_id=a.id AND d.cancelled_at IS NULL
     JOIN loading_plan_matches m ON m.document_id=d.id WHERE a.dispatch_vehicle_id=v.id AND v31_load_posted(m.loading_id));
  SELECT count(*) INTO documents FROM loading_plan_documents d JOIN loading_plan_groups g ON g.id=d.group_id
   WHERE g.sales_plan_id=plan AND d.cancelled_at IS NULL AND g.cancelled_at IS NULL AND NOT EXISTS(
    SELECT 1 FROM loading_plan_matches m WHERE m.document_id=d.id AND v31_load_posted(m.loading_id));
  SELECT count(DISTINCT l.id) INTO loads FROM loading_orders l JOIN loading_order_lots q ON q.loading_id=l.id JOIN allocations a ON a.id=q.allocation_id
   WHERE a.plan_id=plan AND l.workflow_state<>'CANCELLED' AND NOT v31_load_posted(l.id);
 ELSIF product='CO_HYDROXIDE' THEN
  control:='{}'::jsonb;physical:=true;
  SELECT count(*) INTO vehicles FROM co_dispatch_vehicles v WHERE v.sales_plan_id=plan AND v.cancelled_at IS NULL AND NOT EXISTS(
   SELECT 1 FROM co_vehicle_arrivals a JOIN co_loading_orders l ON l.arrival_id=a.id JOIN co_outbounds o ON o.order_id=l.id WHERE a.dispatch_vehicle_id=v.id);
  SELECT count(*) INTO documents FROM co_loading_plans p WHERE p.sales_plan_id=plan AND NOT EXISTS(
   SELECT 1 FROM co_loading_orders l LEFT JOIN co_outbounds o ON o.order_id=l.id WHERE l.id=p.current_load_id AND(l.status='CANCELLED' OR o.order_id IS NOT NULL));
  SELECT count(*) INTO loads FROM co_loading_orders l LEFT JOIN co_outbounds o ON o.order_id=l.id WHERE l.sales_plan_id=plan AND l.status<>'CANCELLED' AND o.order_id IS NULL;
 ELSE RAISE EXCEPTION 'SALES_REVIEW_INPUT' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('ready',physical AND vehicles=0 AND documents=0 AND loads=0,'physical_ready',physical,'pending_vehicles',vehicles,'pending_loading_plans',documents,'pending_loads',loads,'control',control);
END $$;

CREATE FUNCTION v468_close_scope(product text,plan uuid,actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE project uuid;warehouse uuid;customer uuid;
BEGIN
 IF product='CU_CATHODE' THEN SELECT p.project_id,p.customer_id INTO project,customer FROM sales_plans p WHERE p.id=plan FOR UPDATE;
 ELSIF product='CO_HYDROXIDE' THEN SELECT p.project_id,p.warehouse_id,p.customer_id INTO project,warehouse,customer FROM co_sales_plans p WHERE p.id=plan FOR UPDATE;
 ELSE RAISE EXCEPTION 'SALES_REVIEW_INPUT' USING ERRCODE='23514';END IF;
 IF project IS NULL OR NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=actor AND s.project_id=project AND(s.customer_id IS NULL OR s.customer_id=customer) AND(product='CU_CATHODE' OR s.warehouse_id IS NULL OR s.warehouse_id=warehouse)) THEN RAISE EXCEPTION 'SALES_REVIEW_SCOPE' USING ERRCODE='23514';END IF;
END $$;

CREATE FUNCTION v468_request_plan_close(product text,plan uuid,actor uuid,expected integer,note text) RETURNS sales_plan_close_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record;request sales_plan_close_requests;readiness jsonb;approval sales_plan_approvals;
BEGIN
 PERFORM v468_close_scope(product,plan,actor);
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code WHERE u.id=actor AND u.role_code='sales_operator' AND u.active AND u.deleted_at IS NULL AND rp.permission_code='plan:write') THEN RAISE EXCEPTION 'SALES_OPERATOR_REQUIRED' USING ERRCODE='23514';END IF;
 IF product='CU_CATHODE' THEN SELECT id,status,version,created_by INTO p FROM sales_plans WHERE id=plan;
 ELSE SELECT id,status,version,created_by INTO p FROM co_sales_plans WHERE id=plan;END IF;
 IF p.status<>'OPEN' OR p.version<>expected THEN RAISE EXCEPTION 'SALES_REVIEW_STALE' USING ERRCODE='23514';END IF;
 SELECT * INTO approval FROM sales_plan_approvals WHERE plan_id=plan AND product_code=product;
 IF FOUND THEN
  IF approval.state<>'APPROVED' THEN RAISE EXCEPTION 'SALES_PLAN_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;
  IF approval.submitted_by<>actor THEN RAISE EXCEPTION 'SALES_PLAN_SUBMITTER_REQUIRED' USING ERRCODE='23514';END IF;
 END IF;
 IF note IS NULL OR length(note)>1000 THEN RAISE EXCEPTION 'SALES_REVIEW_INPUT' USING ERRCODE='23514';END IF;
 readiness:=v468_close_readiness(product,plan);
 IF NOT (readiness->>'ready')::boolean THEN RAISE EXCEPTION 'SALES_CLOSE_IN_FLIGHT' USING ERRCODE='23514',DETAIL=readiness::text;END IF;
 INSERT INTO sales_plan_close_requests(product_code,cu_plan_id,co_plan_id,plan_version,requested_by,request_reason)
 VALUES(product,CASE WHEN product='CU_CATHODE' THEN plan END,CASE WHEN product='CO_HYDROXIDE' THEN plan END,expected,actor,btrim(note)) RETURNING * INTO request;
 RETURN request;
END $$;

CREATE FUNCTION v468_review_plan_close(product text,plan uuid,request_id uuid,actor uuid,expected integer,decision text,note text) RETURNS sales_plan_close_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request sales_plan_close_requests;p record;stage text;role_name text;permission text;readiness jsonb;
BEGIN
 PERFORM v468_close_scope(product,plan,actor);
 IF product='CU_CATHODE' THEN SELECT status,version INTO p FROM sales_plans WHERE id=plan;
 ELSE SELECT status,version INTO p FROM co_sales_plans WHERE id=plan;END IF;
 SELECT * INTO request FROM sales_plan_close_requests WHERE id=request_id AND product_code=product AND plan_id=plan FOR UPDATE;
 IF NOT FOUND OR request.state NOT IN('PENDING','COMMERCE_PENDING') OR request.version<>expected OR p.status<>'OPEN' OR p.version<>request.plan_version THEN RAISE EXCEPTION 'SALES_REVIEW_STALE' USING ERRCODE='23514';END IF;
 stage:=CASE WHEN request.state='PENDING' THEN 'SALES' ELSE 'COMMERCE' END;
 role_name:=CASE WHEN stage='SALES' THEN 'sales_manager' ELSE 'commerce_manager' END;
 permission:=CASE WHEN stage='SALES' THEN 'plan:approve' ELSE 'plan:commerce-approve' END;
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND u.role_code=role_name AND rp.permission_code=permission) THEN RAISE EXCEPTION '%',CASE WHEN stage='SALES' THEN 'SALES_MANAGER_REQUIRED' ELSE 'COMMERCE_MANAGER_REQUIRED' END USING ERRCODE='23514';END IF;
 IF actor=request.requested_by OR(stage='COMMERCE' AND actor=request.sales_reviewed_by) THEN RAISE EXCEPTION 'SALES_REVIEW_SELF' USING ERRCODE='23514';END IF;
 IF decision NOT IN('APPROVED','REJECTED') OR note IS NULL OR length(note)>1000 OR(decision='REJECTED' AND length(btrim(note))=0) THEN RAISE EXCEPTION 'SALES_REVIEW_INPUT' USING ERRCODE='23514';END IF;
 IF stage='COMMERCE' AND decision='APPROVED' THEN
  readiness:=v468_close_readiness(product,plan);
  IF NOT(readiness->>'ready')::boolean THEN RAISE EXCEPTION 'SALES_CLOSE_IN_FLIGHT' USING ERRCODE='23514',DETAIL=readiness::text;END IF;
 END IF;
 UPDATE sales_plan_close_requests SET state=CASE WHEN decision='REJECTED' THEN 'REJECTED' WHEN stage='SALES' THEN 'COMMERCE_PENDING' ELSE 'APPROVED' END,
 sales_reviewed_by=CASE WHEN stage='SALES' THEN actor ELSE sales_reviewed_by END,sales_reviewed_at=CASE WHEN stage='SALES' THEN clock_timestamp() ELSE sales_reviewed_at END,sales_reason=CASE WHEN stage='SALES' THEN btrim(note) ELSE sales_reason END,
 commerce_reviewed_by=CASE WHEN stage='COMMERCE' THEN actor ELSE commerce_reviewed_by END,commerce_reviewed_at=CASE WHEN stage='COMMERCE' THEN clock_timestamp() ELSE commerce_reviewed_at END,commerce_reason=CASE WHEN stage='COMMERCE' THEN btrim(note) ELSE commerce_reason END,
 rejected_stage=CASE WHEN decision='REJECTED' THEN stage END,applied_transaction=CASE WHEN stage='COMMERCE' AND decision='APPROVED' THEN txid_current() END,version=version+1
 WHERE id=request_id RETURNING * INTO request;
 IF request.state='APPROVED' THEN
  IF product='CU_CATHODE' THEN UPDATE sales_plans SET status='CLOSED',version=version+1 WHERE id=plan AND version=request.plan_version;
  ELSE UPDATE co_sales_plans SET status='CLOSED',version=version+1,updated_by=actor,updated_at=clock_timestamp() WHERE id=plan AND version=request.plan_version;END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'SALES_REVIEW_STALE' USING ERRCODE='23514';END IF;
 END IF;
 RETURN request;
END $$;

CREATE FUNCTION v468_close_authorized(product text,plan uuid,expected integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM sales_plan_close_requests r WHERE r.product_code=product AND r.plan_id=plan AND r.plan_version=expected AND r.state='APPROVED' AND r.applied_transaction=txid_current())
$$;
CREATE FUNCTION v468_plan_close_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF OLD.status='OPEN' AND NEW.status='CLOSED' AND NOT v468_close_authorized(TG_ARGV[0],OLD.id,OLD.version) THEN RAISE EXCEPTION 'SALES_CLOSE_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;
 IF OLD.status='CLOSED' AND NEW.status='OPEN' THEN RAISE EXCEPTION 'SALES_CLOSED_PLAN_LOCKED' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER v468_sales_close_guard BEFORE UPDATE OF status ON sales_plans FOR EACH ROW EXECUTE FUNCTION v468_plan_close_guard('CU_CATHODE');
CREATE TRIGGER v468_co_sales_close_guard BEFORE UPDATE OF status ON co_sales_plans FOR EACH ROW EXECUTE FUNCTION v468_plan_close_guard('CO_HYDROXIDE');

-- Keep all current physical/unknown-weight constraints. Approved early closure
-- waives only the lower quantity threshold, never the upper weight ceiling.
DO $$DECLARE definition text;updated text;BEGIN
 SELECT pg_get_functiondef('plan_history_guard()'::regprocedure) INTO definition;
 IF position('(p->>''outbound_net_weight'')::numeric NOT BETWEEN minimum AND maximum' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected plan closing guard';END IF;
 updated:=replace(definition,'(p->>''outbound_net_weight'')::numeric NOT BETWEEN minimum AND maximum','((p->>''outbound_net_weight'')::numeric>maximum OR((p->>''outbound_net_weight'')::numeric<minimum AND NOT v468_close_authorized(''CU_CATHODE'',OLD.id,OLD.version)))');
 EXECUTE updated;
END $$;

CREATE FUNCTION v468_close_stale_on_edit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$BEGIN
 IF NEW.version<>OLD.version AND NEW.status='OPEN' THEN
  UPDATE sales_plan_close_requests SET state='STALE',version=version+1 WHERE plan_id=NEW.id AND product_code=TG_ARGV[0] AND state IN('PENDING','COMMERCE_PENDING');
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER v468_sales_close_stale AFTER UPDATE ON sales_plans FOR EACH ROW EXECUTE FUNCTION v468_close_stale_on_edit('CU_CATHODE');
CREATE TRIGGER v468_co_sales_close_stale AFTER UPDATE ON co_sales_plans FOR EACH ROW EXECUTE FUNCTION v468_close_stale_on_edit('CO_HYDROXIDE');
CREATE TRIGGER v468_close_history_no_delete BEFORE DELETE ON sales_plan_close_requests FOR EACH ROW EXECUTE FUNCTION v23_immutable();
REVOKE ALL ON sales_plan_close_requests FROM PUBLIC,musonoi_app;
GRANT SELECT ON sales_plan_close_requests TO musonoi_app;
REVOKE ALL ON FUNCTION v468_close_readiness(text,uuid),v468_close_scope(text,uuid,uuid),v468_request_plan_close(text,uuid,uuid,integer,text),v468_review_plan_close(text,uuid,uuid,uuid,integer,text,text),v468_close_authorized(text,uuid,integer),v468_close_stale_on_edit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v468_close_readiness(text,uuid),v468_request_plan_close(text,uuid,uuid,integer,text),v468_review_plan_close(text,uuid,uuid,uuid,integer,text,text),v468_close_authorized(text,uuid,integer) TO musonoi_app;
