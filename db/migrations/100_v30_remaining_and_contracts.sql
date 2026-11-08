-- Contract number corrections and audited archive preserve the stable identity.
ALTER TABLE customer_contracts ADD COLUMN deleted_at timestamptz,ADD COLUMN deleted_by uuid REFERENCES users(id),ADD COLUMN deletion_reason text;
ALTER TABLE customer_contracts ADD CONSTRAINT archived_contract_inactive CHECK(deleted_at IS NULL OR NOT active);
CREATE OR REPLACE FUNCTION ux_contract_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Contract history cannot be deleted; archive the contract' USING ERRCODE='23514';END IF;
 IF NEW.project_id<>OLD.project_id OR NEW.customer_id<>OLD.customer_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.id<>OLD.id OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'Contract identity immutable or version conflict' USING ERRCODE='23514';END IF;
 IF OLD.deleted_at IS NOT NULL THEN RAISE EXCEPTION '已删除合同仅保留历史，不可修改' USING ERRCODE='23514';END IF;RETURN NEW;END $$;

-- A logistics review releases only this lot's unshipped remainder. Other active
-- truck assignments, sampling and pending adjustments stay protected.
CREATE FUNCTION v31_return_remaining(actor uuid,loadid uuid,lot uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE d loading_orders;r record;destination uuid;destinations int;moved int:=0;claim lot_location_claims;BEGIN
 PERFORM v24_revision();SELECT * INTO d FROM loading_orders WHERE id=loadid FOR UPDATE;
 IF d.allocation_id IS DISTINCT FROM lot OR d.logistics_review_by IS DISTINCT FROM actor OR d.logistics_review_at IS NULL OR d.workflow_state NOT IN('DEPARTED_PENDING','OUTBOUND') THEN RAISE EXCEPTION '必须先由物流经理审核离场，才可释放剩余捆包' USING ERRCODE='23514';END IF;
 FOR r IN SELECT b.*,rr.id reservation_id,rr.released_at reservation_released,sl.warehouse_id,sl.map_usage FROM bundles b
 JOIN allocation_items ai ON ai.bundle_id=b.id AND ai.allocation_id=lot
 JOIN reservations rr ON rr.bundle_id=b.id AND rr.allocation_id=lot JOIN locations sl ON sl.id=b.location_id
 LEFT JOIN lot_bundle_releases lr ON lr.allocation_id=lot AND lr.bundle_id=b.id AND lr.loading_id=loadid
 WHERE b.physical_status='IN_STOCK' AND b.sample_status<>'SAMPLING'
 AND(rr.released_at IS NULL OR(lr.bundle_id IS NOT NULL AND sl.map_usage='FORMAL' AND lr.snapshot->>'location_id'=b.location_id::text AND NOT EXISTS(SELECT 1 FROM inventory_events e WHERE e.bundle_id=b.id AND e.event_type='MOVE' AND e.occurred_at>lr.occurred_at)))
 AND NOT EXISTS(SELECT 1 FROM reservations other WHERE other.bundle_id=b.id AND other.allocation_id<>lot AND other.released_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM loading_items li WHERE li.bundle_id=b.id AND li.active)
 AND NOT EXISTS(SELECT 1 FROM stock_adjustments sa JOIN adjustment_lines al ON al.adjustment_id=sa.id WHERE al.bundle_no=b.bundle_no AND sa.status IN('DRAFT','PENDING'))
 ORDER BY b.id FOR UPDATE OF b,rr LOOP
 PERFORM v23_require(actor,'outbound:logistics-review',b.project_id,d.customer_id,r.warehouse_id) FROM bundles b WHERE b.id=r.id;
 SELECT min(l.id::text)::uuid,count(*) INTO destination,destinations FROM locations l WHERE l.project_id=r.project_id AND l.warehouse_id=r.warehouse_id AND l.active AND l.map_usage='TEMPORARY';
 IF destinations<>1 THEN RAISE EXCEPTION '同仓库必须配置唯一启用的临时堆存区' USING ERRCODE='23514';END IF;
 IF r.reservation_released IS NULL THEN
 INSERT INTO lot_bundle_releases(allocation_id,bundle_id,loading_id,actor_id,snapshot) VALUES(lot,r.id,loadid,actor,to_jsonb(r));
 UPDATE reservations SET released_at=clock_timestamp(),released_by=actor,release_reason='物流经理审核通过：剩余捆包释放并归入临时堆存区' WHERE id=r.reservation_id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(r.id,'UNLOCK',0,actor,jsonb_build_object('allocation_id',lot,'loading_id',loadid,'basis','LOGISTICS_REMAINDER_RETURN'));
 END IF;
 IF r.location_id<>destination THEN
 UPDATE bundles SET location_id=destination,version=version+1 WHERE id=r.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(r.id,'MOVE',0,actor,jsonb_build_object('location_id',r.location_id),jsonb_build_object('location_id',destination,'allocation_id',lot,'loading_id',loadid,'basis','LOGISTICS_REMAINDER_RETURN'));
 END IF;
 INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,before_data,after_data,note) VALUES(lot,r.id,'RETURN_REMAINDER',actor,to_jsonb(r),jsonb_build_object('location_id',destination,'loading_id',loadid),'物流审核后释放剩余捆包并归入同仓库临时堆存区，保留原检斤和铅封');
 PERFORM v24_capture_bundle(r.id);moved:=moved+1;
 END LOOP;
 SELECT * INTO claim FROM lot_location_claims WHERE allocation_id=lot AND released_at IS NULL FOR UPDATE;
 IF FOUND AND NOT EXISTS(SELECT 1 FROM bundles b WHERE b.location_id=claim.location_id AND b.physical_status='IN_STOCK' AND NOT EXISTS(SELECT 1 FROM loading_items li JOIN loading_orders lo ON lo.id=li.loading_id WHERE li.bundle_id=b.id AND li.active AND lo.status='LOADED'))
 AND NOT EXISTS(SELECT 1 FROM reservations rr JOIN bundles b ON b.id=rr.bundle_id WHERE rr.allocation_id=lot AND rr.released_at IS NULL AND b.physical_status='IN_STOCK' AND NOT EXISTS(SELECT 1 FROM loading_items li JOIN loading_orders lo ON lo.id=li.loading_id WHERE li.bundle_id=b.id AND li.active AND lo.workflow_state IN('DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND'))) THEN
 UPDATE lot_location_claims SET released_at=clock_timestamp(),released_by=actor,release_reason='物流审核完成，剩余捆包已归临时区，原货位解除占用' WHERE id=claim.id;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'lot_location_released','locations',claim.location_id::text,jsonb_build_object('allocation_id',lot,'loading_id',loadid,'reason','物流审核后原货位无现场剩余实物'));
 END IF;
 IF moved>0 THEN INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'loading_remainder_returned','loading_orders',loadid::text,jsonb_build_object('allocation_id',lot,'bundles',moved,'basis','LOGISTICS_REMAINDER_RETURN'));END IF;
 RETURN moved;END $$;
REVOKE ALL ON FUNCTION v31_return_remaining(uuid,uuid,uuid) FROM PUBLIC,musonoi_app;
-- The supervisor's loading approval no longer releases the remainder early.
CREATE OR REPLACE FUNCTION v262_release_remaining(actor uuid,loadid uuid,lot uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN RETURN;END $$;
DO $$ DECLARE d text;p int;BEGIN SELECT pg_get_functiondef('reservation_guard()'::regprocedure) INTO d;p:=strpos(d,'BEGIN');
 d:=overlay(d placing $branch$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL AND(to_jsonb(NEW)-ARRAY['released_at','released_by','release_reason'])=(to_jsonb(OLD)-ARRAY['released_at','released_by','release_reason']) AND EXISTS(SELECT 1 FROM lot_bundle_releases lr JOIN loading_orders lo ON lo.id=lr.loading_id WHERE lr.allocation_id=OLD.allocation_id AND lr.bundle_id=OLD.bundle_id AND lr.actor_id=NEW.released_by AND lo.logistics_review_by=NEW.released_by AND lo.logistics_review_at IS NOT NULL AND lo.workflow_state IN('DEPARTED_PENDING','OUTBOUND')) THEN
 PERFORM v23_require(NEW.released_by,'outbound:logistics-review',(SELECT project_id FROM bundles WHERE id=OLD.bundle_id),(SELECT customer_id FROM sales_plans WHERE id=(SELECT plan_id FROM allocations WHERE id=OLD.allocation_id)),(SELECT warehouse_id FROM locations WHERE id=(SELECT location_id FROM bundles WHERE id=OLD.bundle_id)));RETURN NEW;END IF;
 $branch$ from p for 5);EXECUTE d;END $$;
ALTER FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) RENAME TO v31_prior_load_action;
REVOKE ALL ON FUNCTION v31_prior_load_action(uuid,uuid,int,text,jsonb) FROM PUBLIC,musonoi_app;
CREATE FUNCTION v26_load_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d loading_orders;BEGIN
 d:=v31_prior_load_action(actor,doc,expected,action,payload);
 IF action IN('logistics-approve','depart') AND d.logistics_review_by=actor THEN PERFORM v31_return_remaining(actor,doc,d.allocation_id);END IF;
 RETURN d;END $$;
REVOKE ALL ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
-- Repair only previously released, untouched remainder supported by a recorded
-- logistics approval. Never move reallocated, loaded, sampled or adjusted stock.
DO $$ DECLARE d record;BEGIN FOR d IN SELECT l.id,l.allocation_id,l.logistics_review_by FROM loading_orders l JOIN users u ON u.id=l.logistics_review_by WHERE l.workflow_state IN('DEPARTED_PENDING','OUTBOUND') AND l.logistics_review_at IS NOT NULL AND u.active AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM role_permissions p WHERE p.role_code=u.role_code AND p.permission_code='outbound:logistics-review') LOOP
 PERFORM v31_return_remaining(d.logistics_review_by,d.id,d.allocation_id);END LOOP;END $$;
