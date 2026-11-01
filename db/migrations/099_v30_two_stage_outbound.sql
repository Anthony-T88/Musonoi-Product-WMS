-- Incremental two-stage approval; no historic posted stock is changed.
INSERT INTO permissions(code) VALUES('outbound:logistics-review'),('outbound:production-approve') ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps VALUES
 ('admin','outbound:logistics-review'),('admin','outbound:production-approve'),
 ('logistics_manager','outbound:logistics-review'),
 ('production_manager','load:read'),('production_manager','outbound:read'),
 ('production_manager','outbound:approve'),('production_manager','outbound:production-approve') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT role_code,permission_code FROM role_permission_caps WHERE
 (role_code='admin' AND permission_code LIKE 'outbound:%') OR
 (role_code='logistics_manager' AND permission_code='outbound:logistics-review') OR
 (role_code='production_manager' AND permission_code IN('load:read','outbound:read','outbound:approve','outbound:production-approve')) ON CONFLICT DO NOTHING;
ALTER TABLE loading_orders ADD COLUMN logistics_review_by uuid REFERENCES users(id),
 ADD COLUMN logistics_review_at timestamptz,ADD COLUMN logistics_review_note text;
-- Existing pending trucks explicitly confirmed as departed by an independent
-- logistics manager can continue from that recorded first-stage action.
UPDATE loading_orders l SET logistics_review_by=l.departure_by,
 logistics_review_at=l.actual_departed_at,
 logistics_review_note='沿用升级前物流经理已确认的实际离场记录'
 FROM users u WHERE l.workflow_state='DEPARTED_PENDING' AND l.departure_by=u.id
 AND u.role_code='logistics_manager' AND l.actual_departed_at IS NOT NULL
 AND l.departure_by<>l.created_by AND l.departure_by IS DISTINCT FROM l.submitted_by;
INSERT INTO workflow_reviews(loading_id,action,actor_id,note)
 SELECT id,'LOGISTICS-APPROVE',logistics_review_by,logistics_review_note
 FROM loading_orders WHERE logistics_review_by IS NOT NULL AND workflow_state='DEPARTED_PENDING';
ALTER FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) RENAME TO v30_single_stage_load_action;
CREATE FUNCTION v26_load_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS loading_orders
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE d loading_orders;item record;note text;BEGIN
 PERFORM v24_revision();SELECT * INTO d FROM loading_orders WHERE id=doc FOR UPDATE;
 IF NOT FOUND OR d.version<>expected THEN RAISE EXCEPTION '装车状态或版本冲突' USING ERRCODE='23514';END IF;
 note:=trim(coalesce(payload->>'note',''));
 IF action IN('logistics-approve','logistics-reject','manager-approve','manager-reject') THEN
 FOR item IN SELECT b.*,l.warehouse_id FROM loading_items i JOIN bundles b ON b.id=i.bundle_id JOIN locations l ON l.id=b.location_id WHERE i.loading_id=doc LOOP
 PERFORM v23_require(actor,CASE WHEN action LIKE 'logistics-%' THEN 'outbound:logistics-review' ELSE 'outbound:production-approve' END,d.project_id,d.customer_id,item.warehouse_id);END LOOP;
 IF d.workflow_state<>'DEPARTED_PENDING' OR actor=d.created_by OR actor IS NOT DISTINCT FROM d.submitted_by THEN RAISE EXCEPTION '必须由独立授权人员审核已离场装车单' USING ERRCODE='23514';END IF;
 END IF;
 IF action IN('logistics-approve','logistics-reject') THEN
 IF d.logistics_review_by IS NOT NULL THEN RAISE EXCEPTION '物流审核已完成，请由生产部经理审批' USING ERRCODE='23514';END IF;
 IF action='logistics-reject' THEN
 IF note='' THEN RAISE EXCEPTION '驳回原因必填' USING ERRCODE='23514';END IF;
 UPDATE loading_orders SET workflow_state='DEPARTED_CORRECTION',version=version+1 WHERE id=doc;
 ELSE UPDATE loading_orders SET logistics_review_by=actor,logistics_review_at=clock_timestamp(),logistics_review_note=note,version=version+1 WHERE id=doc;END IF;
 INSERT INTO workflow_reviews(loading_id,action,actor_id,note) VALUES(doc,upper(action),actor,note);
 ELSE
 IF action IN('manager-approve','manager-reject') AND(d.logistics_review_by IS NULL OR actor=d.logistics_review_by) THEN RAISE EXCEPTION '请先由物流经理审核离场，再由另一位生产部经理审批正式出库' USING ERRCODE='23514';END IF;
 d:=v30_single_stage_load_action(actor,doc,expected,action,payload);
 IF action='correct' THEN UPDATE loading_orders SET logistics_review_by=NULL,logistics_review_at=NULL,logistics_review_note=NULL WHERE id=doc;END IF;
 IF action='depart' AND actor<>d.created_by AND actor IS DISTINCT FROM d.submitted_by AND EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code WHERE u.id=actor AND p.permission_code='outbound:logistics-review') THEN
 FOR item IN SELECT l.warehouse_id FROM loading_items i JOIN bundles b ON b.id=i.bundle_id JOIN locations l ON l.id=b.location_id WHERE i.loading_id=doc LOOP PERFORM v23_require(actor,'outbound:logistics-review',d.project_id,d.customer_id,item.warehouse_id);END LOOP;
 UPDATE loading_orders SET logistics_review_by=actor,logistics_review_at=clock_timestamp(),logistics_review_note=note WHERE id=doc;
 INSERT INTO workflow_reviews(loading_id,action,actor_id,note) VALUES(doc,'LOGISTICS-APPROVE',actor,'物流经理确认实际离场并审核：'||note);
 END IF;
 END IF;
 SELECT * INTO d FROM loading_orders WHERE id=doc;RETURN d;END $$;
REVOKE ALL ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb),v30_single_stage_load_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION v30_single_stage_load_action(uuid,uuid,int,text,jsonb) FROM musonoi_app;
GRANT EXECUTE ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
CREATE FUNCTION v30_final_outbound_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.workflow_state='OUTBOUND' AND OLD.workflow_state IS DISTINCT FROM 'OUTBOUND' THEN
 IF NEW.logistics_review_by IS NULL OR NEW.logistics_review_at IS NULL OR NEW.manager_by IS NULL OR NEW.manager_by=NEW.logistics_review_by THEN RAISE EXCEPTION '正式出库必须完成物流与生产两级独立审批' USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code WHERE u.id=NEW.manager_by AND u.active AND u.deleted_at IS NULL AND p.permission_code='outbound:production-approve') THEN RAISE EXCEPTION '缺少生产部经理正式出库审批权限' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER v30_final_outbound BEFORE UPDATE ON loading_orders FOR EACH ROW EXECUTE FUNCTION v30_final_outbound_guard();
-- Keep original issuance, stock posting and immutable events. Only the final
-- approver's wording changes; historical events retain their original text.
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v262_prior_load_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'物流经理批准正式出库','生产部经理批准正式出库');d:=replace(d,'仅独立物流经理可审核已离场单据','仅独立生产部经理可审核已离场单据');EXECUTE d;END $$;
DELETE FROM sessions WHERE user_id IN(SELECT id FROM users WHERE role_code IN('admin','logistics_manager','production_manager'));
