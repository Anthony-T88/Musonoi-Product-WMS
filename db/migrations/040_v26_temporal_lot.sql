-- Allocation review changes the business state even when no physical field changes.
CREATE FUNCTION v26_allocation_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE bid uuid;BEGIN
 FOR bid IN SELECT bundle_id FROM allocation_items WHERE allocation_id=NEW.id ORDER BY bundle_id LOOP PERFORM v24_capture_bundle(bid);END LOOP;RETURN NEW;END $$;
CREATE TRIGGER v26_allocation_capture AFTER UPDATE ON allocations FOR EACH ROW EXECUTE FUNCTION v26_allocation_capture();
REVOKE ALL ON FUNCTION v26_allocation_capture() FROM PUBLIC;
-- Also protect the legacy API when a measured new bundle has already physically left.
CREATE FUNCTION v26_offsite_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM loading_items i JOIN loading_orders l ON l.id=i.loading_id WHERE i.bundle_id=OLD.id AND i.active AND l.workflow_state IN('DEPARTED_PENDING','DEPARTED_CORRECTION')) AND
 (NEW.location_id,NEW.net_weight,NEW.sample_status) IS DISTINCT FROM(OLD.location_id,OLD.net_weight,OLD.sample_status) THEN RAISE EXCEPTION '已离场待审批库存不可移库、改重或取样' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v26_offsite_immutable BEFORE UPDATE ON bundles FOR EACH ROW EXECUTE FUNCTION v26_offsite_immutable();
