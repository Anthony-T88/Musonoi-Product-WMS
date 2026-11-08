DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('adjustment_create(uuid,uuid,uuid,text,jsonb,uuid)'::regprocedure) INTO d;
 d:=replace(d,'{0,511}','*');
 d:=replace(d,'IF no IS NULL OR no!~','IF no IS NULL OR length(no)>512 OR no!~');EXECUTE d;
END $$;
