-- Pending selection removals remain audit history, never actual dispatch candidates.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_viewdef('inventory_v26_compat'::regclass,true) INTO d;
 IF strpos(d,'z.bundle_id = b.id')=0 THEN RAISE EXCEPTION 'Inventory loading lookup changed unexpectedly';END IF;
 d:=replace(d,'z.bundle_id = b.id','z.bundle_id = b.id AND NOT z.plan_removed');EXECUTE 'CREATE OR REPLACE VIEW inventory_v26_compat AS '||d;
END $$;
