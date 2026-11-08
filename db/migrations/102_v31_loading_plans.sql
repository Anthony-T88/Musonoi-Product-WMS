INSERT INTO roles(code,name) VALUES('export_supervisor','出口主管') ON CONFLICT DO NOTHING;
INSERT INTO permissions(code) VALUES('loading-plan:read'),('loading-plan:write'),('loading-plan:match') ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps SELECT 'export_supervisor',unnest(ARRAY['master:read','dashboard:read','inventory:read','customer:read','plan:read','load:read','loading-plan:read','loading-plan:write']);
INSERT INTO role_permission_caps SELECT r,p FROM unnest(ARRAY['logistics_manager','logistics_operator']) r CROSS JOIN unnest(ARRAY['loading-plan:read','loading-plan:match']) p ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps VALUES('logistics_manager','loading-plan:write') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT role_code,permission_code FROM role_permission_caps WHERE role_code='export_supervisor' OR permission_code LIKE 'loading-plan:%' ON CONFLICT DO NOTHING;
INSERT INTO role_permission_caps SELECT 'admin',code FROM permissions ON CONFLICT DO NOTHING;
INSERT INTO role_permissions SELECT 'admin',code FROM permissions ON CONFLICT DO NOTHING;
CREATE SEQUENCE loading_plan_group_numbers;
CREATE SEQUENCE loading_plan_document_numbers;
CREATE TABLE loading_plan_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE NOT NULL DEFAULT('LPG-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('loading_plan_group_numbers')::text,6,'0')),sales_plan_id uuid NOT NULL REFERENCES sales_plans(id),name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 160),note text NOT NULL DEFAULT '',version int NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),cancelled_at timestamptz,cancelled_by uuid REFERENCES users(id),cancel_reason text);
CREATE TABLE loading_plan_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE NOT NULL DEFAULT('LP-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('loading_plan_document_numbers')::text,6,'0')),group_id uuid NOT NULL REFERENCES loading_plan_groups(id),packing_list_no text NOT NULL DEFAULT '',export_license_no text NOT NULL DEFAULT '',transporter text NOT NULL DEFAULT '',destination text NOT NULL DEFAULT '',vehicle_no text NOT NULL DEFAULT '',shipment_batch_no text NOT NULL DEFAULT '',planned_load_date date NOT NULL,version int NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),cancelled_at timestamptz,cancelled_by uuid REFERENCES users(id),cancel_reason text,CHECK(length(packing_list_no)<=80 AND length(export_license_no)<=160 AND length(transporter)<=160 AND length(destination)<=1000 AND length(vehicle_no)<=80 AND length(shipment_batch_no)<=160));
CREATE TABLE loading_plan_matches(document_id uuid PRIMARY KEY REFERENCES loading_plan_documents(id),loading_id uuid NOT NULL UNIQUE REFERENCES loading_orders(id),matched_by uuid NOT NULL REFERENCES users(id),matched_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE loading_plan_match_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,document_id uuid REFERENCES loading_plan_documents(id),loading_id uuid NOT NULL REFERENCES loading_orders(id),action text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),note text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER immutable_plan_match_history BEFORE UPDATE OR DELETE ON loading_plan_match_history FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE TABLE loading_order_lots(loading_id uuid NOT NULL REFERENCES loading_orders(id),allocation_id uuid NOT NULL REFERENCES allocations(id),PRIMARY KEY(loading_id,allocation_id));
ALTER TABLE loading_items ADD COLUMN plan_removed boolean NOT NULL DEFAULT false;
CREATE FUNCTION v31_load_posted(doc uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM loading_orders WHERE id=doc AND(manager_at IS NOT NULL OR workflow_state='OUTBOUND' OR status IN('DEPARTED','REVERSED'))) $$;
CREATE FUNCTION v31_plan_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION '装车计划历史不可删除，请取消' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
 IF NEW.id<>OLD.id OR NEW.code<>OLD.code OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR OLD.cancelled_at IS NOT NULL THEN RAISE EXCEPTION '装车计划身份、历史或版本冲突' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='loading_plan_documents' THEN
 IF NEW.group_id<>OLD.group_id OR EXISTS(SELECT 1 FROM loading_plan_matches m WHERE m.document_id=OLD.id AND v31_load_posted(m.loading_id)) THEN RAISE EXCEPTION '已正式出库的装车计划单不可修改' USING ERRCODE='23514';END IF;
 IF NEW.cancelled_at IS NOT NULL AND EXISTS(SELECT 1 FROM loading_plan_matches WHERE document_id=OLD.id) THEN RAISE EXCEPTION '请先解除匹配再取消装车计划单' USING ERRCODE='23514';END IF;
 ELSIF NEW.sales_plan_id<>OLD.sales_plan_id OR(NEW.cancelled_at IS NOT NULL AND EXISTS(SELECT 1 FROM loading_plan_documents d JOIN loading_plan_matches m ON m.document_id=d.id WHERE d.group_id=OLD.id)) THEN RAISE EXCEPTION '销售计划关联不可变更，存在匹配单据不能取消' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER loading_plan_group_guard BEFORE UPDATE OR DELETE ON loading_plan_groups FOR EACH ROW EXECUTE FUNCTION v31_plan_guard();
CREATE TRIGGER loading_plan_document_guard BEFORE UPDATE OR DELETE ON loading_plan_documents FOR EACH ROW EXECUTE FUNCTION v31_plan_guard();
CREATE FUNCTION v31_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE target uuid;d loading_orders;p sales_plans;BEGIN
 IF TG_OP IN('UPDATE','DELETE') AND v31_load_posted(OLD.loading_id) THEN RAISE EXCEPTION '正式出库后禁止解除或调整装车计划单匹配' USING ERRCODE='23514';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;
 SELECT * INTO d FROM loading_orders WHERE id=NEW.loading_id FOR UPDATE;
 SELECT sp.* INTO p FROM loading_plan_documents x JOIN loading_plan_groups g ON g.id=x.group_id JOIN sales_plans sp ON sp.id=g.sales_plan_id WHERE x.id=NEW.document_id AND x.cancelled_at IS NULL AND g.cancelled_at IS NULL;
 IF NOT FOUND OR v31_load_posted(d.id) OR d.project_id<>p.project_id OR d.customer_id<>p.customer_id OR p.contract_id IS NULL OR EXISTS(SELECT 1 FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN allocations a ON a.id=r.allocation_id JOIN sales_plans s ON s.id=a.plan_id WHERE i.loading_id=d.id AND NOT i.plan_removed AND(s.customer_id<>p.customer_id OR s.contract_id IS DISTINCT FROM p.contract_id)) THEN RAISE EXCEPTION '装车计划单与装车单客户、合同不一致或已锁定' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER loading_plan_match_guard BEFORE INSERT OR UPDATE OR DELETE ON loading_plan_matches FOR EACH ROW EXECUTE FUNCTION v31_match_guard();
GRANT SELECT,INSERT,UPDATE ON loading_plan_groups,loading_plan_documents TO musonoi_app;
GRANT SELECT ON loading_plan_matches,loading_order_lots TO musonoi_app;
GRANT SELECT,INSERT ON loading_plan_match_history TO musonoi_app;
GRANT USAGE ON SEQUENCE loading_plan_group_numbers,loading_plan_document_numbers,loading_plan_match_history_id_seq TO musonoi_app;

-- Reuse the original per-bundle loading and posting guards, with each bundle's
-- actual reservation/lot identity instead of the truck's primary-lot shortcut.
CREATE OR REPLACE FUNCTION v26_loading_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE a allocations;d loading_orders;BEGIN
 SELECT aa.* INTO a FROM reservations r JOIN allocations aa ON aa.id=r.allocation_id WHERE r.id=NEW.reservation_id;SELECT * INTO d FROM loading_orders WHERE id=NEW.loading_id;
 IF a.lot_no IS NOT NULL AND((d.allocation_id IS DISTINCT FROM a.id AND NOT EXISTS(SELECT 1 FROM loading_order_lots WHERE loading_id=d.id AND allocation_id=a.id)) OR d.workflow_state IS DISTINCT FROM 'PENDING' OR a.workflow_state NOT IN('PREPARED','PARTIAL')) THEN RAISE EXCEPTION '备货批次装车必须使用已审核且匹配的装车流程' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
DO $$ DECLARE d text;pos int;BEGIN SELECT pg_get_functiondef('loading_item_guard()'::regprocedure) INTO d;pos:=strpos(d,'BEGIN');d:=overlay(d placing $patch$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND current_setting('musonoi.v31_edit',true)=NEW.loading_id::text AND EXISTS(SELECT 1 FROM loading_orders WHERE id=NEW.loading_id AND workflow_state='PENDING' AND status='DRAFT') AND(to_jsonb(NEW)-ARRAY['active','removed_reason','removed_at','plan_removed'])=(to_jsonb(OLD)-ARRAY['active','removed_reason','removed_at','plan_removed']) THEN RETURN NEW;END IF;
 $patch$ from pos for 5);EXECUTE d;
 SELECT pg_get_functiondef('v262_prior_load_action(uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'FOR i IN SELECT * FROM loading_items WHERE loading_id=doc ORDER BY bundle_id LOOP','FOR i IN SELECT * FROM loading_items WHERE loading_id=doc AND NOT plan_removed ORDER BY bundle_id LOOP');
 d:=replace(d,'''allocation_id'',a.id,''loading_id'',doc','''allocation_id'',(SELECT allocation_id FROM reservations WHERE id=i.reservation_id),''loading_id'',doc');
 d:=replace(d,'''lot_no'',a.lot_no,''departed_at'',d.actual_departed_at','''lot_no'',(SELECT aa.lot_no FROM reservations rr JOIN allocations aa ON aa.id=rr.allocation_id WHERE rr.id=i.reservation_id),''departed_at'',d.actual_departed_at');EXECUTE d;
 SELECT pg_get_functiondef('v31_return_remaining(uuid,uuid,uuid)'::regprocedure) INTO d;
 d:=replace(d,'d.allocation_id IS DISTINCT FROM lot','(d.allocation_id IS DISTINCT FROM lot AND NOT EXISTS(SELECT 1 FROM loading_order_lots WHERE loading_id=loadid AND allocation_id=lot))');EXECUTE d;END $$;

CREATE FUNCTION v31_save_load(actor uuid,doc uuid,expected int,lp uuid,lp_expected int,ids uuid[],note text) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DECLARE x loading_plan_documents;p sales_plans;d loading_orders;r record;primary_lot uuid;primary_ids uuid[];oldlp uuid;chosen uuid[];lotid uuid;BEGIN
 PERFORM v24_revision();PERFORM pg_advisory_xact_lock(21004);
 IF lp IS NOT NULL THEN SELECT * INTO x FROM loading_plan_documents WHERE id=lp FOR UPDATE;SELECT sp.* INTO p FROM loading_plan_groups g JOIN sales_plans sp ON sp.id=g.sales_plan_id WHERE g.id=x.group_id AND g.cancelled_at IS NULL;
 IF x.id IS NULL OR x.cancelled_at IS NOT NULL OR p.id IS NULL OR x.version<>lp_expected THEN RAISE EXCEPTION '装车计划单已变化、已取消或不存在' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'loading-plan:match',p.project_id,p.customer_id,NULL);
 IF EXISTS(SELECT 1 FROM loading_plan_matches WHERE document_id=lp AND loading_id IS DISTINCT FROM doc) THEN RAISE EXCEPTION '装车计划单已匹配其他装车单' USING ERRCODE='23514';END IF;END IF;
 IF doc IS NOT NULL THEN SELECT * INTO d FROM loading_orders WHERE id=doc FOR UPDATE;
 IF d.id IS NULL OR d.version<>expected OR v31_load_posted(doc) THEN RAISE EXCEPTION '装车单版本已变化或已正式出库锁定' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'loading-plan:match',d.project_id,d.customer_id,NULL);
 FOR r IN SELECT b.*,l.warehouse_id FROM loading_items i JOIN bundles b ON b.id=i.bundle_id JOIN locations l ON l.id=i.original_location_id WHERE i.loading_id=doc LOOP PERFORM v23_require(actor,'load:write',d.project_id,d.customer_id,r.warehouse_id);END LOOP;
 IF lp IS NOT NULL AND(d.project_id<>p.project_id OR d.customer_id<>p.customer_id) THEN RAISE EXCEPTION '客户或项目不匹配' USING ERRCODE='23514';END IF;
 IF ids IS NOT NULL AND d.workflow_state<>'PENDING' THEN RAISE EXCEPTION '仅待审核装车单可调整实际捆包，已审核单继续使用原更正流程' USING ERRCODE='23514';END IF;
 ELSE IF lp IS NULL OR ids IS NULL OR trim(x.vehicle_no)='' THEN RAISE EXCEPTION '请选择装车计划单、捆包并补齐车牌号' USING ERRCODE='23514';END IF;END IF;
 IF ids IS NOT NULL THEN
 IF cardinality(ids) NOT BETWEEN 1 AND 500 OR cardinality(ids)<>(SELECT count(DISTINCT z) FROM unnest(ids) z) OR lp IS NULL THEN RAISE EXCEPTION '请选择1至500个不重复的实际捆包及装车计划单' USING ERRCODE='23514';END IF;
 FOR r IN SELECT b.id,b.location_id,b.net_weight,a.id lotid,a.workflow_state,s.project_id,s.customer_id,s.contract_id,s.status,l.warehouse_id FROM bundles b JOIN reservations rr ON rr.bundle_id=b.id AND rr.released_at IS NULL JOIN allocations a ON a.id=rr.allocation_id JOIN sales_plans s ON s.id=a.plan_id JOIN locations l ON l.id=b.location_id WHERE b.id=ANY(ids) AND b.physical_status='IN_STOCK' ORDER BY b.id FOR UPDATE OF b,rr,a LOOP
 IF r.customer_id<>p.customer_id OR r.project_id<>p.project_id OR r.contract_id IS DISTINCT FROM p.contract_id OR r.workflow_state NOT IN('PREPARED','PARTIAL') OR r.status<>'OPEN' OR r.net_weight IS NULL OR EXISTS(SELECT 1 FROM loading_items i WHERE i.bundle_id=r.id AND i.active AND i.loading_id IS DISTINCT FROM doc) THEN RAISE EXCEPTION '捆包客户、合同、备货状态或车辆占用冲突' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'load:write',p.project_id,p.customer_id,r.warehouse_id);chosen:=array_append(chosen,r.id);IF primary_lot IS NULL THEN primary_lot:=r.lotid;END IF;END LOOP;
 IF cardinality(chosen) IS DISTINCT FROM cardinality(ids) THEN RAISE EXCEPTION '捆包不存在、已出库或没有有效备货预留' USING ERRCODE='23514';END IF;
 PERFORM ux_valid_contract(p.contract_id,p.project_id,p.customer_id);
 IF doc IS NULL THEN SELECT array_agg(rr.bundle_id) INTO primary_ids FROM reservations rr WHERE rr.allocation_id=primary_lot AND rr.released_at IS NULL AND rr.bundle_id=ANY(ids);d:=v26_create_load(actor,primary_lot,x.vehicle_no,x.planned_load_date,primary_ids);doc:=d.id;END IF;
 INSERT INTO loading_order_lots SELECT DISTINCT doc,rr.allocation_id FROM reservations rr WHERE rr.bundle_id=ANY(ids) AND rr.released_at IS NULL ON CONFLICT DO NOTHING;
 PERFORM set_config('musonoi.v31_edit',doc::text,true);
 UPDATE loading_items SET active=false,removed_reason='待审核装车单调整实际捆包',removed_at=clock_timestamp(),plan_removed=true WHERE loading_id=doc AND active AND NOT(bundle_id=ANY(ids));
 FOR r IN SELECT b.*,rr.id rid FROM bundles b JOIN reservations rr ON rr.bundle_id=b.id AND rr.released_at IS NULL WHERE b.id=ANY(ids) ORDER BY b.id LOOP
 IF EXISTS(SELECT 1 FROM loading_items WHERE loading_id=doc AND bundle_id=r.id) THEN
 IF EXISTS(SELECT 1 FROM loading_items WHERE loading_id=doc AND bundle_id=r.id AND(reservation_id<>r.rid OR original_weight<>r.net_weight OR original_location_id<>r.location_id)) THEN RAISE EXCEPTION '原捆包快照已变化，请使用关联纠正流程' USING ERRCODE='23514';END IF;
 UPDATE loading_items SET active=true,plan_removed=false,removed_at=NULL,removed_reason=NULL WHERE loading_id=doc AND bundle_id=r.id AND plan_removed;
 ELSE INSERT INTO loading_items(loading_id,bundle_id,reservation_id,original_weight,original_location_id) VALUES(doc,r.id,r.rid,r.net_weight,r.location_id);END IF;END LOOP;
 PERFORM set_config('musonoi.v31_edit','',true);
 DELETE FROM loading_order_lots ll WHERE ll.loading_id=doc AND NOT EXISTS(SELECT 1 FROM loading_items i JOIN reservations rr ON rr.id=i.reservation_id WHERE i.loading_id=doc AND NOT i.plan_removed AND rr.allocation_id=ll.allocation_id);
 UPDATE allocations SET workflow_state='PARTIAL',version=version+1 WHERE id IN(SELECT allocation_id FROM loading_order_lots WHERE loading_id=doc);
 UPDATE loading_orders SET allocation_id=primary_lot WHERE id=doc;
 END IF;
 SELECT document_id INTO oldlp FROM loading_plan_matches WHERE loading_id=doc;
 IF oldlp IS DISTINCT FROM lp THEN
 IF oldlp IS NOT NULL THEN DELETE FROM loading_plan_matches WHERE loading_id=doc;INSERT INTO loading_plan_match_history(document_id,loading_id,action,actor_id,note) VALUES(oldlp,doc,'UNMATCH',actor,note);END IF;
 IF lp IS NOT NULL THEN INSERT INTO loading_plan_matches(document_id,loading_id,matched_by) VALUES(lp,doc,actor);INSERT INTO loading_plan_match_history(document_id,loading_id,action,actor_id,note) VALUES(lp,doc,'MATCH',actor,note);END IF;END IF;
 IF lp IS NOT NULL THEN UPDATE loading_orders SET vehicle_no=coalesce(nullif(trim(x.vehicle_no),''),vehicle_no),carrier=coalesce(nullif(trim(x.transporter),''),carrier) WHERE id=doc;END IF;
 UPDATE loading_orders SET version=version+1,logistics_review_by=NULL,logistics_review_at=NULL,logistics_review_note=NULL WHERE id=doc RETURNING * INTO d;
 INSERT INTO workflow_reviews(loading_id,action,actor_id,note) VALUES(doc,'LOADING-PLAN-MATCH',actor,note);RETURN d;END $$;
REVOKE ALL ON FUNCTION v31_save_load(uuid,uuid,int,uuid,int,uuid[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v31_save_load(uuid,uuid,int,uuid,int,uuid[],text) TO musonoi_app;
CREATE FUNCTION v31_sync_document(actor uuid,lp uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE x loading_plan_documents;d loading_orders;p sales_plans;BEGIN
 PERFORM pg_advisory_xact_lock(21004);SELECT * INTO x FROM loading_plan_documents WHERE id=lp;SELECT sp.* INTO p FROM loading_plan_groups g JOIN sales_plans sp ON sp.id=g.sales_plan_id WHERE g.id=x.group_id;PERFORM v23_require(actor,'loading-plan:write',p.project_id,p.customer_id,NULL);
 SELECT l.* INTO d FROM loading_plan_matches m JOIN loading_orders l ON l.id=m.loading_id WHERE m.document_id=lp FOR UPDATE OF l;
 IF FOUND THEN IF v31_load_posted(d.id) THEN RAISE EXCEPTION '正式出库后装车计划单和匹配关系锁定' USING ERRCODE='23514';END IF;
 UPDATE loading_orders SET vehicle_no=coalesce(nullif(trim(x.vehicle_no),''),vehicle_no),carrier=coalesce(nullif(trim(x.transporter),''),carrier),version=version+1,logistics_review_by=NULL,logistics_review_at=NULL,logistics_review_note=NULL WHERE id=d.id;
 INSERT INTO workflow_reviews(loading_id,action,actor_id,note) VALUES(d.id,'LOADING-PLAN-UPDATED',actor,'装车计划单信息变更，已有物流审核须重新确认');END IF;END $$;
REVOKE ALL ON FUNCTION v31_sync_document(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v31_sync_document(uuid,uuid) TO musonoi_app;
ALTER FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) RENAME TO v31_single_lot_action;
REVOKE ALL ON FUNCTION v31_single_lot_action(uuid,uuid,int,text,jsonb) FROM PUBLIC,musonoi_app;
CREATE FUNCTION v26_load_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d loading_orders;q record;BEGIN
 d:=v31_single_lot_action(actor,doc,expected,action,payload);
 FOR q IN SELECT allocation_id FROM loading_order_lots WHERE loading_id=doc AND allocation_id<>d.allocation_id ORDER BY allocation_id LOOP
 IF action IN('logistics-approve','depart') AND d.logistics_review_by=actor THEN PERFORM v31_return_remaining(actor,doc,q.allocation_id);END IF;
 IF action='manager-approve' THEN UPDATE allocations SET workflow_state=CASE WHEN EXISTS(SELECT 1 FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id WHERE i.allocation_id=q.allocation_id AND b.physical_status<>'OUTBOUND' AND NOT EXISTS(SELECT 1 FROM lot_bundle_releases lr WHERE lr.allocation_id=i.allocation_id AND lr.bundle_id=i.bundle_id)) THEN 'PARTIAL' ELSE 'FULFILLED' END,status=CASE WHEN EXISTS(SELECT 1 FROM reservations WHERE allocation_id=q.allocation_id AND released_at IS NULL) THEN 'LOCKED' ELSE 'FULFILLED' END,version=version+1 WHERE id=q.allocation_id;END IF;END LOOP;
 RETURN d;END $$;
REVOKE ALL ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v26_load_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
