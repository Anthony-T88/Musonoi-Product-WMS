DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v265_plan_progress(uuid)'::regprocedure) INTO d;
 EXECUTE replace(d,'''fields_complete'',','''released_net_weight'',(SELECT coalesce(sum((lr.snapshot->>''net_weight'')::numeric),0)::text FROM lot_bundle_releases lr JOIN allocations a ON a.id=lr.allocation_id WHERE a.plan_id=plan),''fields_complete'',');
END $$;
