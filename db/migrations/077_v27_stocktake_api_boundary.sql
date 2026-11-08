ALTER TABLE stocktakes ADD COLUMN workflow_version text;
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v27_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text)'::regprocedure) INTO d;
 d:=replace(d,'task_type,phase,cutoff_at,remark)','task_type,phase,cutoff_at,remark,workflow_version)');
 d:=replace(d,'coalesce(note,'''')) RETURNING','coalesce(note,''''),''2.7'') RETURNING');EXECUTE d;
 SELECT pg_get_functiondef('stocktake_record(uuid,uuid,int,jsonb,text)'::regprocedure) INTO d;
 d:=replace(d,'IF d.status<>''OPEN''', 'IF d.workflow_version=''2.7'' THEN RAISE EXCEPTION ''V27_USE_STOCKTAKE_API'' USING ERRCODE=''23514'';END IF;IF d.status<>''OPEN''');EXECUTE d;
 SELECT pg_get_functiondef('stocktake_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'IF action=''submit'' THEN', 'IF d.workflow_version=''2.7'' AND(action<>''reconcile'' OR d.phase<>''IN_PROGRESS'') THEN RAISE EXCEPTION ''V27_USE_STOCKTAKE_API'' USING ERRCODE=''23514'';END IF;IF action=''submit'' THEN');EXECUTE d;
END $$;
