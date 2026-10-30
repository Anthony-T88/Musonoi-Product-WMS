-- Retain the actor even when automatic location release is deferred to commit.
ALTER TABLE lot_location_claims ADD COLUMN released_by uuid REFERENCES users(id);
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v262_sync_claims()'::regprocedure) INTO d;
 d:=replace(d,$old$SET released_at=clock_timestamp(),release_reason=$old$, $new$SET released_at=clock_timestamp(),released_by=coalesce((SELECT cancelled_by FROM allocations WHERE id=q.allocation_id),(SELECT lo.manager_by FROM loading_orders lo WHERE lo.allocation_id=q.allocation_id AND lo.manager_by IS NOT NULL ORDER BY lo.manager_at DESC LIMIT 1)),release_reason=$new$);
 d:=replace(d,$old$INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('lot_location_released'$old$, $new$INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES((SELECT released_by FROM lot_location_claims WHERE id=q.id),'lot_location_released'$new$);EXECUTE d;
 SELECT pg_get_functiondef('v261_item_action(uuid,uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,$old$THEN UPDATE lot_work_items SET seal_valid=false$old$, $new$THEN INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,before_data,after_data,note) SELECT doc,bid,'SEAL_INVALIDATED',actor,jsonb_build_object('seal_no',bb.seal_no,'seal_valid',ww.seal_valid),jsonb_build_object('seal_no',bb.seal_no,'seal_valid',false),'取样/复磅后须重新确认铅封' FROM bundles bb JOIN lot_work_items ww ON ww.bundle_id=bb.id WHERE bb.id=bid AND ww.allocation_id=doc;UPDATE lot_work_items SET seal_valid=false$new$);EXECUTE d;
END $$;
-- The unique live claim is additionally enforced at deferred document validation.
CREATE FUNCTION v262_claim_required() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM allocations a WHERE a.id=NEW.id AND a.workflow_version='2.6.1' AND a.workflow_state NOT IN('CANCELLED','FULFILLED') AND NOT EXISTS(SELECT 1 FROM lot_location_claims lc WHERE lc.allocation_id=a.id AND lc.location_id=a.planned_location_id AND lc.released_at IS NULL)) THEN RAISE EXCEPTION '有效Lot必须持有唯一规划货位锁定' USING ERRCODE='23514';END IF;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER v262_claim_required AFTER INSERT OR UPDATE ON allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v262_claim_required();
REVOKE ALL ON FUNCTION v262_claim_required() FROM PUBLIC;
