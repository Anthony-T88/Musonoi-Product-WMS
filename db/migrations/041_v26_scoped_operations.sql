-- Row-level calls validate the actual warehouse for warehouse-scoped operators.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v26_submit(uuid,uuid,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,$f$PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,NULL);$f$,'');EXECUTE d;
 SELECT pg_get_functiondef('v26_create_load(uuid,uuid,text,date,uuid[])'::regprocedure) INTO d;
 d:=replace(d,'OR cardinality(ids) NOT BETWEEN','OR ids IS NULL OR cardinality(ids) NOT BETWEEN');
 d:=replace(d,$f$PERFORM v23_require(actor,'load:write',p.project_id,p.customer_id,NULL);$f$,'');EXECUTE d;
END $$;
