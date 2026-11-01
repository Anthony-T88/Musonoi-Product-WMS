-- A bundle frozen in this task may be found elsewhere in the same warehouse.
-- Newly discovered bundles still have to be observed inside the selected task scope.
DO $$ DECLARE d text;old text;BEGIN
 SELECT pg_get_functiondef('v27_stocktake_record(uuid,uuid,int,jsonb)'::regprocedure) INTO d;
 old:='IF NOT FOUND OR(d.scope->>''location_id'' IS NOT NULL AND l.id::text<>d.scope->>''location_id'') OR(d.scope->>''yard_id'' IS NOT NULL AND l.yard_id::text IS DISTINCT FROM d.scope->>''yard_id'') THEN';
 IF position(old in d)=0 THEN RAISE EXCEPTION 'Unexpected observation scope definition';END IF;
 d:=replace(d,old,'IF NOT FOUND OR(((d.scope->>''location_id'' IS NOT NULL AND l.id::text<>d.scope->>''location_id'') OR(d.scope->>''yard_id'' IS NOT NULL AND l.yard_id::text IS DISTINCT FROM d.scope->>''yard_id'')) AND NOT EXISTS(SELECT 1 FROM stocktake_snapshot s WHERE s.stocktake_id=doc AND s.state->>''bundle_no''=label)) THEN');EXECUTE d;
END $$;
