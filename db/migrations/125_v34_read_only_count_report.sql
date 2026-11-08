-- Reporting must not allocate inventory revisions or serialize normal stock writes.
-- Keep the existing classification and reconciliation logic in a single function.
DO $$ DECLARE def text;BEGIN
 SELECT pg_get_functiondef('stocktake_report(uuid,uuid)'::regprocedure) INTO def;
 IF strpos(def,'r:=coalesce(d.close_revision,v24_revision());')=0 THEN RAISE EXCEPTION 'Missing stocktake reporting revision boundary';END IF;
 EXECUTE replace(def,'r:=coalesce(d.close_revision,v24_revision());','r:=coalesce(d.close_revision,(SELECT coalesce(max(id),0) FROM inventory_revisions));');
END $$;
