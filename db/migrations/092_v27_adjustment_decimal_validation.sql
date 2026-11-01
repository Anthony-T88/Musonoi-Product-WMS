DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('adjustment_create(uuid,uuid,uuid,text,jsonb,uuid)'::regprocedure) INTO d;
 d:=replace(d,'''^d{1,8}(.d{1,4})?$''','''^[0-9]{1,8}([.][0-9]{1,4})?$''');EXECUTE d;
END $$;
