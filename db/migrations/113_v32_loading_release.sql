-- Reuse the existing remainder release/move routine at supervisor approval.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v31_return_remaining(uuid,uuid,uuid)'::regprocedure) INTO d;
 d:=replace(d,'public.v31_return_remaining','public.v32_release_remaining');
 IF strpos(d,'d.logistics_review_by IS DISTINCT FROM actor')=0 THEN RAISE EXCEPTION 'Unexpected remainder guard';END IF;
 d:=replace(d,'d.logistics_review_by IS DISTINCT FROM actor OR d.logistics_review_at IS NULL OR d.workflow_state NOT IN(''DEPARTED_PENDING'',''OUTBOUND'')','d.reviewed_by IS DISTINCT FROM actor OR d.workflow_state<>''READY''');
 d:=replace(d,'''outbound:logistics-review''','''load:review''');d:=replace(d,'必须先由物流经理审核离场，才可释放剩余捆包','必须先由现场主管审核装车，才可释放剩余捆包');d:=replace(d,'物流经理审核通过','现场主管装车审核通过');d:=replace(d,'物流审核','现场装车审核');d:=replace(d,'LOGISTICS_REMAINDER_RETURN','SUPERVISOR_REMAINDER_RELEASE');EXECUTE d;
END $$;
REVOKE ALL ON FUNCTION v32_release_remaining(uuid,uuid,uuid) FROM PUBLIC,musonoi_app;
ALTER FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) RENAME TO v32_prior_load_action;
CREATE FUNCTION v26_load_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d loading_orders;lot uuid;BEGIN
 d:=v32_prior_load_action(actor,doc,expected,action,payload);
 IF action='approve' THEN FOR lot IN SELECT d.allocation_id UNION SELECT allocation_id FROM loading_order_lots WHERE loading_id=doc LOOP PERFORM v32_release_remaining(actor,doc,lot);END LOOP;PERFORM v262_sync_claims();END IF;
 RETURN d;END $$;
REVOKE ALL ON FUNCTION v32_prior_load_action(uuid,uuid,int,text,jsonb),v26_load_action(uuid,uuid,int,text,jsonb) FROM PUBLIC,musonoi_app;
GRANT EXECUTE ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) TO musonoi_app;

-- Unmatching a pending declaration removes vehicle allocation, retaining valid
-- Lot reservations. Loaded vehicles must use the existing verified unload flow.
ALTER FUNCTION v31_save_load(uuid,uuid,int,uuid,int,uuid[],text) RENAME TO v32_prior_save_load;
CREATE FUNCTION v31_save_load(actor uuid,doc uuid,expected int,lp uuid,lp_expected int,ids uuid[],note text) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d loading_orders;b uuid;BEGIN
 PERFORM v24_revision();PERFORM pg_advisory_xact_lock(21004);
 IF doc IS NOT NULL AND lp IS NULL THEN SELECT * INTO d FROM loading_orders WHERE id=doc FOR UPDATE;
 IF EXISTS(SELECT 1 FROM loading_items WHERE loading_id=doc AND active) AND d.workflow_state<>'PENDING' THEN RAISE EXCEPTION '已装车车辆请先通过实物卸车或受控取消流程，再解除匹配' USING ERRCODE='23514';END IF;
 IF length(trim(note))<5 THEN RAISE EXCEPTION '解除匹配原因至少5个字' USING ERRCODE='23514';END IF;END IF;
 d:=v32_prior_save_load(actor,doc,expected,lp,lp_expected,ids,note);
 IF doc IS NOT NULL AND lp IS NULL AND d.workflow_state='PENDING' THEN
 PERFORM set_config('musonoi.v31_edit',doc::text,true);
 UPDATE loading_items SET active=false,plan_removed=true,removed_at=clock_timestamp(),removed_reason=note WHERE loading_id=doc AND active;
 PERFORM set_config('musonoi.v31_edit','',true);
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) SELECT bundle_id,'UNLOAD',0,actor,jsonb_build_object('loading_id',doc,'basis','V32_UNMATCH','reason',note,'lot_lock_retained',true) FROM loading_items WHERE loading_id=doc;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'loading_allocation_released','loading_orders',doc::text,jsonb_build_object('reason',note,'lot_lock_retained',true));
 END IF;RETURN d;END $$;
REVOKE ALL ON FUNCTION v32_prior_save_load(uuid,uuid,int,uuid,int,uuid[],text),v31_save_load(uuid,uuid,int,uuid,int,uuid[],text) FROM PUBLIC,musonoi_app;
GRANT EXECUTE ON FUNCTION v31_save_load(uuid,uuid,int,uuid,int,uuid[],text) TO musonoi_app;

ALTER FUNCTION loading_action(uuid,uuid,int,text,text) RENAME TO v32_prior_loading_action;
CREATE FUNCTION loading_action(actor uuid,doc uuid,expected int,action text,reason text DEFAULT '') RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d loading_orders;r record;lp uuid;BEGIN
 PERFORM v24_revision();PERFORM pg_advisory_xact_lock(21004);SELECT * INTO d FROM loading_orders WHERE id=doc FOR UPDATE;
 IF d.workflow_state='PENDING' AND action='cancel' THEN
 IF d.version<>expected OR length(trim(reason)) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION '版本已变化或取消原因不足5个字' USING ERRCODE='23514';END IF;
 FOR r IN SELECT l.warehouse_id FROM loading_items i JOIN locations l ON l.id=i.original_location_id WHERE i.loading_id=doc LOOP PERFORM v23_require(actor,'load:write',d.project_id,d.customer_id,r.warehouse_id);END LOOP;
 SELECT document_id INTO lp FROM loading_plan_matches WHERE loading_id=doc;
 IF lp IS NOT NULL THEN PERFORM v31_require_plan(actor,'loading-plan:match',d.project_id,d.customer_id);DELETE FROM loading_plan_matches WHERE loading_id=doc;INSERT INTO loading_plan_match_history(document_id,loading_id,action,actor_id,note) VALUES(lp,doc,'UNMATCH',actor,reason);END IF;
 UPDATE loading_items SET active=false,removed_reason=reason,removed_at=clock_timestamp() WHERE loading_id=doc AND active;
 UPDATE loading_orders SET status='CANCELLED',workflow_state='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=actor,cancel_reason=reason,version=version+1 WHERE id=doc RETURNING * INTO d;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) SELECT bundle_id,'UNLOAD',0,actor,jsonb_build_object('loading_id',doc,'reason',reason,'basis','V32_CANCEL_PENDING','lot_lock_retained',true) FROM loading_items WHERE loading_id=doc;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'loading_cancelled','loading_orders',doc::text,to_jsonb(d)||jsonb_build_object('lot_lock_retained',true));RETURN d;
 END IF;RETURN v32_prior_loading_action(actor,doc,expected,action,reason);END $$;
REVOKE ALL ON FUNCTION v32_prior_loading_action(uuid,uuid,int,text,text),loading_action(uuid,uuid,int,text,text) FROM PUBLIC,musonoi_app;
GRANT EXECUTE ON FUNCTION loading_action(uuid,uuid,int,text,text) TO musonoi_app;
