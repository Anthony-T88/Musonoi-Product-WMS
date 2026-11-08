DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v261_create(uuid,uuid,text,uuid,jsonb)'::regprocedure) INTO d;
 d:=replace(d,$old$IF p.contract_id IS NOT NULL THEN$old$,$new$PERFORM 1 FROM customers WHERE id=p.customer_id AND project_id=p.project_id AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION '销售计划客户无效或已停用' USING ERRCODE='23514';END IF;
 IF p.contract_id IS NOT NULL THEN$new$);EXECUTE d;END $$;
