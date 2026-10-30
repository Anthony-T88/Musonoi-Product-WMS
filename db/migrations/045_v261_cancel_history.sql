DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v261_lot_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,$old$FROM lot_work_history WHERE allocation_id=doc AND action IN('WEIGH','SAMPLE-STAGE')$old$,$new$FROM lot_work_history h WHERE h.allocation_id=doc AND h.action IN('WEIGH','SAMPLE-STAGE')$new$);EXECUTE d;END $$;
