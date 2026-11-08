ALTER FUNCTION v27_correction_action(uuid,uuid,int,text,text) RENAME TO v32_prior_correction_action;
CREATE FUNCTION v27_correction_action(actor uuid,doc uuid,expected int,action text,reason text) RETURNS outbound_corrections LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE q outbound_corrections;lp uuid;BEGIN
 q:=v32_prior_correction_action(actor,doc,expected,action,reason);
 IF action='apply' AND q.kind='CANCEL_LOAD' AND q.status='APPLIED' THEN
 SELECT document_id INTO lp FROM loading_plan_matches WHERE loading_id=q.loading_id;
 IF lp IS NOT NULL THEN DELETE FROM loading_plan_matches WHERE loading_id=q.loading_id;INSERT INTO loading_plan_match_history(document_id,loading_id,action,actor_id,note) VALUES(lp,q.loading_id,'UNMATCH',actor,'受控取消已核实卸车：'||q.code||'；'||reason);
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'controlled_cancel_plan_unmatched','loading_orders',q.loading_id::text,jsonb_build_object('document_id',lp,'correction_id',q.id,'reason',reason));END IF;
 END IF;RETURN q;END $$;
REVOKE ALL ON FUNCTION v32_prior_correction_action(uuid,uuid,int,text,text),v27_correction_action(uuid,uuid,int,text,text) FROM PUBLIC,musonoi_app;
GRANT EXECUTE ON FUNCTION v27_correction_action(uuid,uuid,int,text,text) TO musonoi_app;
