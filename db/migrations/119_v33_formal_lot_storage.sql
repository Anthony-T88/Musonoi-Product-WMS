ALTER FUNCTION storage_assert_location(uuid,boolean) RENAME TO v33_prior_storage_assert;
CREATE FUNCTION storage_assert_location(loc uuid,customer_check boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE n int;BEGIN
 PERFORM v33_prior_storage_assert(loc,customer_check);
 IF EXISTS(SELECT 1 FROM locations WHERE id=loc AND map_usage='FORMAL') THEN
 SELECT count(DISTINCT lot) INTO n FROM(SELECT r.allocation_id lot FROM bundles b JOIN reservations r ON r.bundle_id=b.id AND r.released_at IS NULL JOIN allocations a ON a.id=r.allocation_id WHERE b.location_id=loc AND b.physical_status='IN_STOCK' AND coalesce(a.workflow_state,'') NOT IN('CANCELLED','FULFILLED') AND NOT EXISTS(SELECT 1 FROM loading_items i JOIN loading_orders l ON l.id=i.loading_id WHERE i.bundle_id=b.id AND i.active AND l.status='LOADED') UNION SELECT c.allocation_id FROM lot_location_claims c JOIN allocations a ON a.id=c.allocation_id WHERE c.location_id=loc AND c.released_at IS NULL AND coalesce(a.workflow_state,'') NOT IN('CANCELLED','FULFILLED'))lots;
 IF n>1 THEN RAISE EXCEPTION '一个正式货位只能由一个有效Lot占用，禁止混放不同备货批次' USING ERRCODE='23514';END IF;END IF;
END $$;
REVOKE ALL ON FUNCTION v33_prior_storage_assert(uuid,boolean),storage_assert_location(uuid,boolean) FROM PUBLIC,musonoi_app;
