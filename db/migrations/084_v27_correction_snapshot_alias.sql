DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v27_correction_create(uuid,uuid,int,text,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'b record;','item record;');d:=replace(d,'FOR b IN','FOR item IN');d:=replace(d,'l.customer_id,b.warehouse_id','l.customer_id,item.warehouse_id');EXECUTE d;
END $$;
