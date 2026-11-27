-- Keep the posted loading order and match immutable. Close only its active plan
-- so the returned lot and arrival may be selected in a new loading plan.
DO $$
DECLARE definition text:=pg_get_functiondef('v31_plan_guard()'::regprocedure);
 anchor text:=$old$IF NEW.group_id<>OLD.group_id OR EXISTS(SELECT 1 FROM loading_plan_matches m$old$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected copper loading plan guard'; END IF;
 EXECUTE replace(definition,anchor,$new$IF current_user='musonoi_owner' AND NEW.cancelled_at IS NOT NULL
  AND (to_jsonb(NEW)-ARRAY['cancelled_at','cancelled_by','cancel_reason','version','updated_at'])=
      (to_jsonb(OLD)-ARRAY['cancelled_at','cancelled_by','cancel_reason','version','updated_at'])
  AND EXISTS(SELECT 1 FROM loading_plan_matches m JOIN outbound_corrections q ON q.loading_id=m.loading_id
   WHERE m.document_id=OLD.id AND q.kind='RETURN_OUTBOUND' AND q.status='APPLIED'
    AND q.id::text=current_setting('musonoi.copper_return_close_plan',true)) THEN
  RETURN NEW;
 END IF;
 IF NEW.group_id<>OLD.group_id OR EXISTS(SELECT 1 FROM loading_plan_matches m$new$);
END $$;

CREATE FUNCTION copper_close_returned_loading_plan(p_actor uuid,p_correction uuid)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE prior loading_plan_documents; result loading_plan_documents;
BEGIN
 PERFORM pg_advisory_xact_lock(21004);
 SELECT d.* INTO prior FROM outbound_corrections q JOIN loading_plan_matches m ON m.loading_id=q.loading_id
 JOIN loading_plan_documents d ON d.id=m.document_id
 WHERE q.id=p_correction AND q.kind='RETURN_OUTBOUND' AND q.status='APPLIED' AND d.cancelled_at IS NULL
 FOR UPDATE OF d;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM set_config('musonoi.copper_return_close_plan',p_correction::text,true);
 UPDATE loading_plan_documents SET cancelled_at=clock_timestamp(),cancelled_by=p_actor,
  cancel_reason='正式出库返场已冲销',version=version+1,updated_at=clock_timestamp()
 WHERE id=prior.id RETURNING * INTO result;
 PERFORM set_config('musonoi.copper_return_close_plan','',true);
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data)
 VALUES(p_actor,'copper_return_loading_plan_closed','loading_plan_documents',prior.id::text,to_jsonb(prior),
  to_jsonb(result)||jsonb_build_object('correction_id',p_correction));
END $$;
REVOKE ALL ON FUNCTION copper_close_returned_loading_plan(uuid,uuid) FROM PUBLIC,musonoi_app;

ALTER FUNCTION v27_correction_action(uuid,uuid,int,text,text) RENAME TO v490_return_correction_action;
REVOKE ALL ON FUNCTION v490_return_correction_action(uuid,uuid,int,text,text) FROM PUBLIC,musonoi_app;
CREATE FUNCTION v27_correction_action(actor uuid,doc uuid,expected int,action text,reason text)
RETURNS outbound_corrections LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE q outbound_corrections;
BEGIN
 q:=v490_return_correction_action(actor,doc,expected,action,reason);
 IF action='apply' AND q.kind='RETURN_OUTBOUND' AND q.status='APPLIED' THEN
  PERFORM copper_close_returned_loading_plan(actor,q.id);
 END IF;
 RETURN q;
END $$;
REVOKE ALL ON FUNCTION v27_correction_action(uuid,uuid,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v27_correction_action(uuid,uuid,int,text,text) TO musonoi_app;

CREATE FUNCTION copper_restore_return_with_plan(p_actor uuid,p_doc uuid,p_expected int,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE recovery jsonb;
BEGIN
 recovery:=copper_apply_return_preparation(p_actor,p_doc,p_expected,p_reason);
 IF recovery->>'state'='RESTORED' THEN PERFORM copper_close_returned_loading_plan(p_actor,p_doc); END IF;
 RETURN recovery;
END $$;
REVOKE ALL ON FUNCTION copper_apply_return_preparation(uuid,uuid,int,text),copper_restore_return_with_plan(uuid,uuid,int,text) FROM PUBLIC,musonoi_app;
GRANT EXECUTE ON FUNCTION copper_restore_return_with_plan(uuid,uuid,int,text) TO musonoi_app;

DO $$
DECLARE definition text:=pg_get_functiondef('v27_correction_create(uuid,uuid,int,text,text,jsonb)'::regprocedure);
 anchor text:=$old$IF kind='VEHICLE' AND nullif(trim(payload->>'vehicle_no')$old$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected copper correction creation guard'; END IF;
 EXECUTE replace(definition,anchor,$new$IF EXISTS(SELECT 1 FROM outbound_corrections prior_return WHERE prior_return.loading_id=loadid
  AND prior_return.kind='RETURN_OUTBOUND' AND prior_return.status='APPLIED') THEN
  RAISE EXCEPTION 'V27_RETURN_ALREADY_APPLIED' USING ERRCODE='23514';
 END IF;
 IF kind='VEHICLE' AND nullif(trim(payload->>'vehicle_no')$new$);
END $$;
