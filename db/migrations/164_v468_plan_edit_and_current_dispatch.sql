-- Use only canonical current copper dispatch vehicles, not superseded imports.
DO $$DECLARE definition text;updated text;BEGIN
 SELECT pg_get_functiondef('v468_close_readiness(text,uuid)'::regprocedure) INTO definition;
 IF position('FROM sales_dispatch_vehicles v JOIN sales_dispatch_imports i ON i.id=v.import_id' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected close readiness definition';END IF;
 updated:=replace(definition,'FROM sales_dispatch_vehicles v JOIN sales_dispatch_imports i ON i.id=v.import_id','FROM sales_dispatch_vehicle_keys vk JOIN sales_dispatch_vehicles v ON v.id=vk.vehicle_id');
 updated:=replace(updated,'WHERE i.sales_plan_id=plan AND v.cancelled_at IS NULL','WHERE vk.sales_plan_id=plan AND v.cancelled_at IS NULL');
 EXECUTE updated;
END $$;

-- An actual edit of a grandfathered open plan enters today's review chain.
-- No row is created for an untouched historical plan; its creator is retained.
CREATE FUNCTION v468_submit_legacy_plan_edit(product text,plan uuid,actor uuid,expected integer) RETURNS sales_plan_approvals
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p record;a sales_plan_approvals;
BEGIN
 PERFORM v468_close_scope(product,plan,actor);
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code WHERE u.id=actor AND u.role_code='sales_operator' AND u.active AND u.deleted_at IS NULL AND rp.permission_code='plan:write') THEN RAISE EXCEPTION 'SALES_OPERATOR_REQUIRED' USING ERRCODE='23514';END IF;
 IF product='CU_CATHODE' THEN SELECT status,version INTO p FROM sales_plans WHERE id=plan;
 ELSE SELECT status,version INTO p FROM co_sales_plans WHERE id=plan;END IF;
 IF p.status<>'OPEN' THEN RAISE EXCEPTION 'SALES_CLOSED_PLAN_LOCKED' USING ERRCODE='23514';END IF;
 IF p.version<>expected THEN RAISE EXCEPTION 'SALES_REVIEW_STALE' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM sales_plan_approvals WHERE plan_id=plan AND product_code=product) THEN RAISE EXCEPTION 'SALES_REVIEW_STALE' USING ERRCODE='23514';END IF;
 INSERT INTO sales_plan_approvals(product_code,cu_plan_id,co_plan_id,submitted_by)
 VALUES(product,CASE WHEN product='CU_CATHODE' THEN plan END,CASE WHEN product='CO_HYDROXIDE' THEN plan END,actor) RETURNING * INTO a;
 RETURN a;
END $$;
REVOKE ALL ON FUNCTION v468_submit_legacy_plan_edit(text,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v468_submit_legacy_plan_edit(text,uuid,uuid,integer) TO musonoi_app;
