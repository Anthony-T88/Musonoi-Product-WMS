DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v27_stocktake_action(uuid,uuid,int,text,text)'::regprocedure) INTO d;
 d:=replace(d,'SET phase=''CANCELLED'',cancelled_by=actor','SET phase=''CANCELLED'',close_revision=r,cancelled_by=actor');EXECUTE d;
END $$;
