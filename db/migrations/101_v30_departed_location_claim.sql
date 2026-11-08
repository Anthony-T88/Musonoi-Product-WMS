-- A lot waiting for production approval keeps truck/bundle reservations, but
-- no longer owns the original empty physical location after logistics review.
CREATE OR REPLACE FUNCTION v262_claim_required() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM allocations a WHERE a.id=NEW.id AND a.workflow_version='2.6.1' AND a.workflow_state NOT IN('CANCELLED','FULFILLED')
 AND NOT EXISTS(SELECT 1 FROM lot_location_claims lc WHERE lc.allocation_id=a.id AND lc.location_id=a.planned_location_id AND lc.released_at IS NULL)
 AND NOT(a.workflow_state IN('PREPARED','PARTIAL')
 AND EXISTS(SELECT 1 FROM lot_location_claims lc WHERE lc.allocation_id=a.id AND lc.released_at IS NOT NULL AND lc.release_reason='物流审核完成，剩余捆包已归临时区，原货位解除占用')
 AND EXISTS(SELECT 1 FROM loading_orders lo WHERE lo.allocation_id=a.id AND lo.logistics_review_at IS NOT NULL AND lo.workflow_state IN('DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND'))
 AND NOT EXISTS(SELECT 1 FROM reservations rr JOIN bundles b ON b.id=rr.bundle_id WHERE rr.allocation_id=a.id AND rr.released_at IS NULL AND b.physical_status='IN_STOCK'
 AND NOT EXISTS(SELECT 1 FROM loading_items li JOIN loading_orders lo ON lo.id=li.loading_id WHERE li.bundle_id=b.id AND li.active AND lo.logistics_review_at IS NOT NULL AND lo.workflow_state IN('DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND'))))) THEN
 RAISE EXCEPTION '有效Lot必须持有唯一规划货位锁定' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
