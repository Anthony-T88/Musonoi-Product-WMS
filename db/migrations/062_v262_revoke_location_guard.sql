-- A checkbox is not enough to release a Lot whose actual position is unverified.
DO $$ DECLARE original text;patched text;BEGIN
 SELECT pg_get_functiondef('v262_preapproval_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO original;
 patched:=replace(original,$old$SELECT EXISTS(SELECT 1 FROM lot_work_history h$old$,$new$IF EXISTS(SELECT 1 FROM allocation_items ai JOIN bundles bb ON bb.id=ai.bundle_id JOIN locations l ON l.id=bb.location_id WHERE ai.allocation_id=doc AND (NOT l.active OR l.map_usage='REVIEW')) THEN RAISE EXCEPTION '存在未定位或停用的实际货位，须先核查位置，整单未撤销且未释放任何锁定' USING ERRCODE='23514';END IF;
 SELECT EXISTS(SELECT 1 FROM lot_work_history h$new$);
 IF patched=original THEN RAISE EXCEPTION 'Expected preapproval guard missing';END IF;EXECUTE patched;
END $$;
