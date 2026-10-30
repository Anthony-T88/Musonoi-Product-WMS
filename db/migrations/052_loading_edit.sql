-- Pending transport metadata may be corrected without changing allocations or weights.
CREATE FUNCTION fixed_edit_load(actor uuid,doc uuid,expected int,vehicle text,load_date date) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d loading_orders;b bundles;BEGIN
 PERFORM v24_revision();SELECT * INTO d FROM loading_orders WHERE id=doc FOR UPDATE;
 IF NOT FOUND OR d.workflow_state IS DISTINCT FROM 'PENDING' OR d.version<>expected THEN RAISE EXCEPTION '仅可修改当前版本待审核装车单；已审核单须走正式纠正流程' USING ERRCODE='23514';END IF;
 FOR b IN SELECT x.* FROM bundles x JOIN loading_items i ON i.bundle_id=x.id WHERE i.loading_id=doc AND i.active ORDER BY x.id FOR UPDATE OF x LOOP
 PERFORM v23_require(actor,'load:write',d.project_id,d.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));END LOOP;
 IF trim(coalesce(vehicle,''))='' OR length(vehicle)>80 OR load_date IS NULL OR load_date>(clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date THEN RAISE EXCEPTION '车牌或装车日期无效' USING ERRCODE='23514';END IF;
 UPDATE loading_orders SET vehicle_no=trim(vehicle),loaded_at=(load_date::text||'T00:00:00+02:00')::timestamptz,submitted_by=actor,version=version+1 WHERE id=doc RETURNING * INTO d;
 INSERT INTO workflow_reviews(loading_id,action,actor_id,note) VALUES(doc,'EDIT',actor,'更正车牌及装车日期并重新提交审核');RETURN d;
END $$;
REVOKE ALL ON FUNCTION fixed_edit_load(uuid,uuid,int,text,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fixed_edit_load(uuid,uuid,int,text,date) TO musonoi_app;
-- All four authorized logistics roles can correct rejected requests, retaining history.
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v26_resubmit_load(uuid,uuid,text,date,uuid[])'::regprocedure) INTO d;
 d:=replace(d,' OR old.created_by<>actor','');d:=replace(d,'仅原创建人可纠正并重提已驳回装车单','仅可纠正并重提已驳回装车单');EXECUTE d;END $$;
