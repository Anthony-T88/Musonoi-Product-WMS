ALTER TABLE sales_plans ADD COLUMN quantity_tolerance numeric(7,4) CHECK(quantity_tolerance BETWEEN 0 AND 100),
 ADD COLUMN preparation_month text CHECK(preparation_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 ADD COLUMN planned_lot_count integer CHECK(planned_lot_count>0);
CREATE FUNCTION v265_plan_progress(plan uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH effective AS(
 SELECT DISTINCT ON(r.bundle_id) r.bundle_id,b.net_weight,w.final_weighed,false shipped
 FROM reservations r JOIN allocations a ON a.id=r.allocation_id JOIN bundles b ON b.id=r.bundle_id LEFT JOIN lot_work_items w ON w.allocation_id=a.id AND w.bundle_id=b.id
 WHERE a.plan_id=plan AND r.released_at IS NULL AND b.physical_status='IN_STOCK'
 UNION ALL
 SELECT DISTINCT ON(li.bundle_id) li.bundle_id,li.original_weight,true,true FROM loading_items li JOIN loading_orders lo ON lo.id=li.loading_id JOIN allocations a ON a.id=lo.allocation_id
 WHERE a.plan_id=plan AND li.active AND lo.workflow_state='OUTBOUND' AND lo.status='DEPARTED'
 ), amounts AS(SELECT coalesce(sum(net_weight) FILTER(WHERE final_weighed),0) total,
 coalesce(sum(net_weight) FILTER(WHERE final_weighed AND NOT shipped),0) assigned,
 coalesce(sum(net_weight) FILTER(WHERE shipped),0) outbound,count(*) FILTER(WHERE final_weighed IS DISTINCT FROM true OR net_weight IS NULL)::int unknown FROM effective),
 lots AS(SELECT count(*)::int used FROM allocations a WHERE a.plan_id=plan AND (a.workflow_state<>'CANCELLED' OR EXISTS(SELECT 1 FROM loading_orders l WHERE l.allocation_id=a.id AND l.workflow_state IN('READY','DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND'))))
 SELECT jsonb_build_object('planned_net_weight',p.target_weight::text,'quantity_tolerance',p.quantity_tolerance::text,'preparation_month',p.preparation_month,'planned_lot_count',p.planned_lot_count,
 'used_lot_count',lots.used,'remaining_lot_count',p.planned_lot_count-lots.used,
 'minimum_weight',(p.target_weight*(1-p.quantity_tolerance/100))::text,'maximum_weight',(p.target_weight*(1+p.quantity_tolerance/100))::text,
 'effective_net_weight',amounts.total::text,'assigned_net_weight',assigned::text,'outbound_net_weight',outbound::text,'unknown_bundles',unknown,
 'remaining_weight',(p.target_weight*(1+p.quantity_tolerance/100)-total)::text,
 'fields_complete',p.quantity_tolerance IS NOT NULL AND p.preparation_month IS NOT NULL AND p.planned_lot_count IS NOT NULL,
 'over_limit',p.quantity_tolerance IS NOT NULL AND total>p.target_weight*(1+p.quantity_tolerance/100),
 'completion_eligible',p.quantity_tolerance IS NOT NULL AND unknown=0 AND assigned=0 AND outbound BETWEEN p.target_weight*(1-p.quantity_tolerance/100) AND p.target_weight*(1+p.quantity_tolerance/100))
 FROM sales_plans p CROSS JOIN amounts CROSS JOIN lots WHERE p.id=plan
$$;
CREATE FUNCTION v265_assert_weight(plan uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE progress jsonb;BEGIN
 PERFORM 1 FROM sales_plans WHERE id=plan FOR UPDATE;progress:=v265_plan_progress(plan);
 IF (progress->>'over_limit')::boolean THEN RAISE EXCEPTION 'SALES_PLAN_WEIGHT_EXCEEDED' USING ERRCODE='23514',DETAIL=progress::text;END IF;
END $$;
CREATE FUNCTION v265_lot_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p sales_plans;progress jsonb;BEGIN
 SELECT * INTO p FROM sales_plans WHERE id=NEW.plan_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
 IF p.status IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION 'SALES_PLAN_INVALID' USING ERRCODE='23514';END IF;
 IF p.quantity_tolerance IS NULL OR p.preparation_month IS NULL OR p.planned_lot_count IS NULL THEN RAISE EXCEPTION 'SALES_PLAN_REQUIRED_FIELDS_MISSING' USING ERRCODE='23514';END IF;
 progress:=v265_plan_progress(p.id);
 IF (progress->>'used_lot_count')::int>=p.planned_lot_count THEN RAISE EXCEPTION 'LOT_COUNT_LIMIT_EXCEEDED' USING ERRCODE='23514',DETAIL=progress::text;END IF;
 ELSIF NEW.workflow_state IN('PENDING','PREPARED') AND NEW.workflow_state IS DISTINCT FROM OLD.workflow_state THEN PERFORM v265_assert_weight(p.id);
 IF EXISTS(SELECT 1 FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id LEFT JOIN seal_number_registry s ON s.seal_key=upper(trim(b.seal_no)) WHERE i.allocation_id=NEW.id AND(s.seal_key IS NULL OR s.conflicted OR s.bundle_id IS DISTINCT FROM b.id)) THEN RAISE EXCEPTION 'DUPLICATE_SEAL_NO' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER v265_lot_guard BEFORE INSERT OR UPDATE OF workflow_state ON allocations FOR EACH ROW EXECUTE FUNCTION v265_lot_guard();
-- Replace only the obsolete target-only comparison; preserve all stage/permission/storage checks.
DO $$ DECLARE d text;old text:='IF (SELECT coalesce(sum(r.weight),0) FROM reservations r JOIN allocations aa ON aa.id=r.allocation_id WHERE aa.plan_id=p.id AND r.released_at IS NULL)>p.target_weight THEN RAISE EXCEPTION ''有效备货已知净重超过销售计划目标'' USING ERRCODE=''23514'';END IF;';BEGIN
 SELECT pg_get_functiondef('v262_prior_ready(uuid)'::regprocedure) INTO d;
 IF position(old in d)=0 THEN RAISE EXCEPTION 'Unexpected readiness function definition';END IF;
 EXECUTE replace(d,old,'PERFORM v265_assert_weight(p.id);');END $$;
CREATE FUNCTION v265_plan_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE progress jsonb;BEGIN
 IF NEW.status='CLOSED' AND OLD.status IS DISTINCT FROM NEW.status THEN
 progress:=v265_plan_progress(OLD.id);
 IF NOT (progress->>'completion_eligible')::boolean THEN RAISE EXCEPTION 'SALES_PLAN_COMPLETION_NOT_READY' USING ERRCODE='23514',DETAIL=progress::text;END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER v265_plan_guard BEFORE UPDATE ON sales_plans FOR EACH ROW EXECUTE FUNCTION v265_plan_guard();
REVOKE ALL ON FUNCTION v265_lot_guard(),v265_plan_guard(),v265_assert_weight(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION v265_plan_progress(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v265_plan_progress(uuid) TO musonoi_app;
