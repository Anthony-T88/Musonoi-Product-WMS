DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v27_correction_action(uuid,uuid,int,text,text)'::regprocedure) INTO d;
 d:=replace(d,'r bigint;a allocations;','r bigint;');EXECUTE d;
END $$;
