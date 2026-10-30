-- Previously approved Lots keep their original approval and NULL metadata.
-- New loading must not ship a V2.6.1 work item with an unknown/invalid seal.
CREATE FUNCTION v262_loading_seal_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE missing text;BEGIN
 SELECT b.bundle_no INTO missing FROM reservations r JOIN lot_work_items w USING(allocation_id,bundle_id) JOIN bundles b ON b.id=r.bundle_id WHERE r.id=NEW.reservation_id AND (NOT w.final_weighed OR NOT w.seal_valid OR nullif(trim(b.seal_no),'') IS NULL);
 IF missing IS NOT NULL THEN RAISE EXCEPTION '装车前须完成有效检斤与铅封，历史已审核Lot可授权补录: %',missing USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER loading_seal_guard BEFORE INSERT ON loading_items FOR EACH ROW EXECUTE FUNCTION v262_loading_seal_guard();
CREATE FUNCTION v262_correct_seal(actor uuid,bid uuid,expected int,newseal text,why text) RETURNS bundles LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE b bundles;a allocations;p sales_plans;BEGIN
 PERFORM v24_revision();SELECT * INTO b FROM bundles WHERE id=bid FOR UPDATE;
 SELECT aa.* INTO a FROM allocations aa JOIN reservations r ON r.allocation_id=aa.id WHERE r.bundle_id=bid AND r.released_at IS NULL FOR UPDATE OF aa;
 SELECT * INTO p FROM sales_plans WHERE id=a.plan_id;
 PERFORM v23_require(actor,'users:manage',b.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 IF b.version IS DISTINCT FROM expected OR a.workflow_state IS NULL OR a.workflow_state NOT IN('PREPARED','PARTIAL') OR b.physical_status<>'IN_STOCK' OR nullif(trim(why),'') IS NULL OR EXISTS(SELECT 1 FROM loading_items WHERE bundle_id=bid AND active) THEN RAISE EXCEPTION '仅可授权更正已备货且未被装车占用的捆包；版本及原因必须有效' USING ERRCODE='23514';END IF;
 PERFORM v262_set_seal(actor,a.id,bid,newseal,'授权铅封补录/更正：'||why);
 UPDATE allocations SET version=version+1 WHERE id=a.id;
 PERFORM v24_capture_bundle(bid);SELECT * INTO b FROM bundles WHERE id=bid;RETURN b;
END $$;
REVOKE ALL ON FUNCTION v262_correct_seal(uuid,uuid,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v262_correct_seal(uuid,uuid,int,text,text) TO musonoi_app;
