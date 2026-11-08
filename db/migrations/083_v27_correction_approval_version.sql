DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v27_correction_action(uuid,uuid,int,text,text)'::regprocedure) INTO d;
 d:=replace(d,'IF q.kind<>''VEHICLE'' THEN SELECT', 'IF l.version IS DISTINCT FROM(q.original_snapshot->>''version'')::int THEN RAISE EXCEPTION ''V27_CORRECTION_STATE_CONFLICT'' USING ERRCODE=''23514'';END IF;IF q.kind<>''VEHICLE'' THEN SELECT');EXECUTE d;
END $$;
