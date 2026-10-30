DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v26_load_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'JOIN bundles b ON b.id=z.bundle_id WHERE z.allocation_id=a.id AND b.physical_status', 'JOIN bundles bb ON bb.id=z.bundle_id WHERE z.allocation_id=a.id AND bb.physical_status');EXECUTE d;END $$;
