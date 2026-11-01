-- Add an annual task without changing existing tasks, snapshots or approval rules.
ALTER TABLE stocktakes DROP CONSTRAINT stocktakes_task_type_check;
ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_task_type_check CHECK(task_type IN('MONTHLY','ANNUAL','SPECIAL'));
DO $patch$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('v27_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text)'::regprocedure) INTO definition;
 IF position('kind NOT IN(''MONTHLY'',''SPECIAL'')' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected stocktake create function';END IF;
 definition:=replace(definition,'kind NOT IN(''MONTHLY'',''SPECIAL'')','kind NOT IN(''MONTHLY'',''ANNUAL'',''SPECIAL'')');
 EXECUTE definition;
END $patch$;
