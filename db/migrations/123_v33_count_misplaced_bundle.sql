-- A bundle in the frozen scope may be found elsewhere in the same warehouse.
-- Unrecorded gains must still be observed inside the selected location/region.
DO $$ DECLARE def text;old text;replacement text;BEGIN
 SELECT pg_get_functiondef('v33_prior_stocktake_record(uuid,uuid,int,jsonb)'::regprocedure) INTO def;
 old:='IF NOT FOUND OR(((d.scope->>''location_id'' IS NOT NULL AND l.id::text<>d.scope->>''location_id'') OR(d.scope->>''yard_id'' IS NOT NULL AND l.yard_id::text IS DISTINCT FROM d.scope->>''yard_id'')) AND NOT EXISTS(SELECT 1 FROM stocktake_snapshot s WHERE s.stocktake_id=doc AND s.state->>''bundle_no''=label)) THEN';
 replacement:='IF NOT FOUND OR(((d.scope->>''location_id'' IS NOT NULL AND l.id::text<>d.scope->>''location_id'') OR(d.scope->>''yard_id'' IS NOT NULL AND l.yard_id::text IS DISTINCT FROM d.scope->>''yard_id'') OR(d.snapshot_on_create AND d.scope ? ''location_ids'' AND NOT(d.scope->''location_ids'' ? l.id::text))) AND NOT EXISTS(SELECT 1 FROM stocktake_snapshot ss WHERE ss.stocktake_id=doc AND v265_bundle_key(ss.state->>''bundle_no'')=v265_bundle_key(label))) THEN';
 IF position(old IN def)=0 THEN RAISE EXCEPTION 'Missing stocktake scope validation boundary';END IF;
 EXECUTE replace(def,old,replacement);
END $$;
