CREATE FUNCTION v262_release_remaining(actor uuid,loadid uuid,lot uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r record;BEGIN
 IF NOT EXISTS(SELECT 1 FROM loading_orders WHERE id=loadid AND allocation_id=lot AND workflow_state='READY' AND reviewed_by=actor) THEN RAISE EXCEPTION '只有已通过装车审核的单据可释放剩余捆包' USING ERRCODE='23514';END IF;
 FOR r IN SELECT rr.id reservation_id,b.* FROM reservations rr JOIN bundles b ON b.id=rr.bundle_id WHERE rr.allocation_id=lot AND rr.released_at IS NULL AND b.physical_status='IN_STOCK' AND b.sample_status<>'SAMPLING' AND NOT EXISTS(SELECT 1 FROM loading_items li WHERE li.bundle_id=b.id AND li.active) AND NOT EXISTS(SELECT 1 FROM stock_adjustments sa JOIN adjustment_lines al ON al.adjustment_id=sa.id WHERE al.bundle_no=b.bundle_no AND sa.status IN('DRAFT','PENDING')) ORDER BY b.id FOR UPDATE OF b,rr LOOP
 INSERT INTO lot_bundle_releases(allocation_id,bundle_id,loading_id,actor_id,snapshot) VALUES(lot,r.id,loadid,actor,to_jsonb(r));
 UPDATE reservations SET released_at=clock_timestamp(),released_by=actor,release_reason='装车审核通过：释放未被有效装车单占用的剩余捆包' WHERE id=r.reservation_id;
 INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,after_data,note) VALUES(lot,r.id,'RELEASE_REMAINDER',actor,to_jsonb(r),'保留检斤、取样、铅封和当前物理货位');
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(r.id,'UNLOCK',0,actor,jsonb_build_object('allocation_id',lot,'loading_id',loadid,'basis','V262_LOAD_APPROVAL_REMAINDER'));
 PERFORM v24_capture_bundle(r.id);END LOOP;
END $$;
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('reservation_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN',$new$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL AND (to_jsonb(NEW)-ARRAY['released_at','released_by','release_reason'])=(to_jsonb(OLD)-ARRAY['released_at','released_by','release_reason']) AND EXISTS(SELECT 1 FROM lot_bundle_releases lr JOIN loading_orders lo ON lo.id=lr.loading_id WHERE lr.allocation_id=OLD.allocation_id AND lr.bundle_id=OLD.bundle_id AND lr.actor_id=NEW.released_by AND lo.workflow_state='READY' AND lo.reviewed_by=NEW.released_by) THEN
 PERFORM v23_require(NEW.released_by,'load:review',(SELECT project_id FROM bundles WHERE id=OLD.bundle_id),(SELECT customer_id FROM sales_plans WHERE id=(SELECT plan_id FROM allocations WHERE id=OLD.allocation_id)),(SELECT warehouse_id FROM locations WHERE id=(SELECT location_id FROM bundles WHERE id=OLD.bundle_id)));RETURN NEW;END IF;
 $new$);EXECUTE d;END $$;
ALTER FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) RENAME TO v262_prior_load_action;
REVOKE ALL ON FUNCTION v262_prior_load_action(uuid,uuid,int,text,jsonb) FROM musonoi_app;
CREATE FUNCTION v26_load_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d loading_orders;BEGIN
 SELECT * INTO d FROM v262_prior_load_action(actor,doc,expected,action,payload);
 IF action='approve' THEN PERFORM v262_release_remaining(actor,doc,d.allocation_id);END IF;
 IF action='manager-approve' THEN
 UPDATE allocations SET workflow_state=CASE WHEN EXISTS(SELECT 1 FROM allocation_items ai JOIN bundles b ON b.id=ai.bundle_id WHERE ai.allocation_id=d.allocation_id AND b.physical_status<>'OUTBOUND' AND NOT EXISTS(SELECT 1 FROM lot_bundle_releases lr WHERE lr.allocation_id=ai.allocation_id AND lr.bundle_id=ai.bundle_id)) THEN 'PARTIAL' ELSE 'FULFILLED' END WHERE id=d.allocation_id;
 END IF;PERFORM v262_sync_claims();RETURN d;
END $$;
REVOKE ALL ON FUNCTION v262_release_remaining(uuid,uuid,uuid),v26_load_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
-- Append metadata without changing existing view column names/types or old snapshots.
DO $$ DECLARE cols text;BEGIN
 SELECT string_agg(CASE column_name WHEN 'current_customer' THEN 'CASE WHEN r.id IS NOT NULL THEN cu.name WHEN b.physical_status=''OUTBOUND'' THEN prior.current_customer ELSE prior.customer END AS current_customer' WHEN 'lot_no' THEN 'CASE WHEN r.id IS NOT NULL THEN a.lot_no WHEN b.physical_status=''OUTBOUND'' THEN prior.lot_no ELSE NULL::text END AS lot_no' ELSE 'prior.'||quote_ident(column_name) END,',' ORDER BY ordinal_position) INTO cols FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_view';
 ALTER VIEW inventory_view RENAME TO inventory_v261_compat;
 EXECUTE 'CREATE VIEW inventory_view AS SELECT '||cols||',b.sheets_per_bundle,b.seal_no,wi.seal_valid FROM inventory_v261_compat prior JOIN bundles b ON b.id=prior.uuid LEFT JOIN reservations r ON r.bundle_id=b.id AND r.released_at IS NULL LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN sales_plans p ON p.id=a.plan_id LEFT JOIN customers cu ON cu.id=p.customer_id LEFT JOIN lot_work_items wi ON wi.allocation_id=a.id AND wi.bundle_id=b.id';
END $$;
GRANT SELECT ON inventory_view,inventory_v261_compat TO musonoi_app;
ALTER FUNCTION v24_capture_bundle(uuid) RENAME TO v262_prior_capture;
CREATE FUNCTION v24_capture_bundle(bid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE v inventory_view;BEGIN
 PERFORM v262_prior_capture(bid);SELECT * INTO v FROM inventory_view WHERE uuid=bid;
 UPDATE inventory_history SET state=state||jsonb_build_object('sheets_per_bundle',v.sheets_per_bundle,'seal_no',v.seal_no,'seal_valid',v.seal_valid,'current_customer',v.current_customer,'lot_no',v.lot_no) WHERE bundle_id=bid AND revision_id=v24_revision();
END $$;
REVOKE ALL ON FUNCTION v262_prior_capture(uuid),v24_capture_bundle(uuid) FROM PUBLIC;
