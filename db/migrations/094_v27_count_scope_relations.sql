DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v27_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text)'::regprocedure) INTO d;
 d:=replace(d,' OR cutoff>clock_timestamp()','');
 d:=replace(d,'INSERT INTO stocktakes(project_id', $n$IF f->>'yard_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM yards WHERE id=(f->>'yard_id')::uuid AND warehouse_id=w AND project_id=p AND active) OR f->>'batch_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM batches WHERE id=(f->>'batch_id')::uuid AND project_id=p AND active) OR f->>'location_id' IS NOT NULL AND f->>'yard_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM locations WHERE id=(f->>'location_id')::uuid AND yard_id=(f->>'yard_id')::uuid) THEN RAISE EXCEPTION 'V27_INVALID_COUNT_SCOPE' USING ERRCODE='23514';END IF;
 INSERT INTO stocktakes(project_id$n$);EXECUTE d;
END $$;
