-- Inheritance must use the latest previous Lot's validity, never an older valid
-- measurement that was invalidated by a later sampling/repacking operation.
DO $$ DECLARE original text;patched text;BEGIN
 SELECT pg_get_functiondef('v261_create(uuid,uuid,text,uuid,jsonb)'::regprocedure) INTO original;
 patched:=replace(original,$old$AND w.final_weighed AND w.seal_valid AND r.released_at IS NOT NULL$old$,$new$AND w.final_weighed AND w.seal_valid AND r.released_at IS NOT NULL AND w.allocation_id=(SELECT ww.allocation_id FROM lot_work_items ww JOIN allocations aa ON aa.id=ww.allocation_id WHERE ww.bundle_id=x.id AND ww.allocation_id<>a.id ORDER BY aa.created_at DESC,aa.id DESC LIMIT 1)$new$);
 IF patched=original THEN RAISE EXCEPTION 'Expected inheritance guard missing';END IF;EXECUTE patched;
END $$;
