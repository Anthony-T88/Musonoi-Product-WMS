CREATE FUNCTION v31_require_plan(actor uuid,perm text,project uuid,customer uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_code=u.role_code WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND rp.permission_code=perm) OR NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=actor AND s.project_id=project AND(s.customer_id IS NULL OR s.customer_id=customer)) THEN RAISE EXCEPTION '装车计划权限或客户范围不符' USING ERRCODE='23514';END IF;END $$;
REVOKE ALL ON FUNCTION v31_require_plan(uuid,text,uuid,uuid) FROM PUBLIC;
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v31_save_load(uuid,uuid,int,uuid,int,uuid[],text)'::regprocedure) INTO d;
 d:=replace(d,'v23_require(actor,''loading-plan:match'',p.project_id,p.customer_id,NULL)','v31_require_plan(actor,''loading-plan:match'',p.project_id,p.customer_id)');
 d:=replace(d,'v23_require(actor,''loading-plan:match'',d.project_id,d.customer_id,NULL)','v31_require_plan(actor,''loading-plan:match'',d.project_id,d.customer_id)');
 d:=replace(d,'d.version<>expected OR v31_load_posted(doc)','d.version<>expected OR d.workflow_state IS NULL OR d.workflow_state IN(''CANCELLED'',''UNLOADED'') OR v31_load_posted(doc)');EXECUTE d;
 SELECT pg_get_functiondef('v31_sync_document(uuid,uuid)'::regprocedure) INTO d;
 d:=replace(d,'PERFORM pg_advisory_xact_lock(21004);','PERFORM v24_revision();PERFORM pg_advisory_xact_lock(21004);');
 d:=replace(d,'v23_require(actor,''loading-plan:write'',p.project_id,p.customer_id,NULL)','v31_require_plan(actor,''loading-plan:write'',p.project_id,p.customer_id)');EXECUTE d;
 SELECT pg_get_functiondef('v26_load_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;d:=replace(d,'PERFORM pg_advisory_xact_lock(21004);','PERFORM v24_revision();PERFORM pg_advisory_xact_lock(21004);');EXECUTE d;
END $$;
