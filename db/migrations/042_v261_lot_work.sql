-- V2.6.1 additive model. All previous documents retain their original workflow.
ALTER TABLE allocations ADD COLUMN workflow_version text,ADD COLUMN planned_location_id uuid REFERENCES locations(id),ADD COLUMN cancelled_by uuid REFERENCES users(id),ADD COLUMN cancel_note text,ADD COLUMN cancelled_at timestamptz,ADD COLUMN cancellation_observation jsonb;
ALTER TABLE allocations DROP CONSTRAINT allocations_workflow_state_check;
ALTER TABLE allocations ADD CHECK(workflow_state IN('WORKING','PENDING','RECTIFY','REJECTED','PREPARED','PARTIAL','FULFILLED','CANCELLED'));
ALTER TABLE receipts ADD COLUMN number_rule_version text;
ALTER TABLE receipt_lines DROP CONSTRAINT receipt_lines_bundle_no_check;
ALTER TABLE receipt_lines ADD CHECK(bundle_no=upper(trim(bundle_no)) AND length(bundle_no) BETWEEN 1 AND 512);
ALTER TABLE reservations ALTER COLUMN weight DROP NOT NULL;
CREATE TABLE lot_work_items(allocation_id uuid NOT NULL,bundle_id uuid NOT NULL,sample_required boolean NOT NULL DEFAULT false,sample_stage text NOT NULL DEFAULT 'NOT_REQUIRED' CHECK(sample_stage IN('NOT_REQUIRED','WAITING','IN_PROGRESS','RETURNED','WEIGHED')),final_weighed boolean NOT NULL DEFAULT false,weighed_at timestamptz,weighed_by uuid REFERENCES users(id),sample_date date,version int NOT NULL DEFAULT 1,PRIMARY KEY(allocation_id,bundle_id),FOREIGN KEY(allocation_id,bundle_id) REFERENCES allocation_items(allocation_id,bundle_id),CHECK((sample_required AND sample_stage<>'NOT_REQUIRED') OR(NOT sample_required AND sample_stage='NOT_REQUIRED')),CHECK(NOT sample_required OR NOT final_weighed OR sample_stage='WEIGHED'));
CREATE TABLE lot_work_history(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,allocation_id uuid NOT NULL REFERENCES allocations(id),bundle_id uuid REFERENCES bundles(id),action text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),before_data jsonb,after_data jsonb,note text NOT NULL DEFAULT '',occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER lot_work_history_immutable BEFORE UPDATE OR DELETE ON lot_work_history FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE TRIGGER lot_work_items_owner BEFORE INSERT OR UPDATE OR DELETE ON lot_work_items FOR EACH ROW EXECUTE FUNCTION v23_state_owner();
-- INSERT must be owner protected too (v23_state_owner rejects non-owner in every operation).
GRANT SELECT ON lot_work_items,lot_work_history TO musonoi_app;

CREATE FUNCTION v261_assert_plan(loc uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE cap locations;k int;n int;w numeric;BEGIN
 PERFORM storage_touch_location(loc);SELECT * INTO cap FROM locations WHERE id=loc;
 IF NOT FOUND OR NOT cap.active OR NOT EXISTS(SELECT 1 FROM warehouses WHERE id=cap.warehouse_id AND active) OR (cap.yard_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM yards WHERE id=cap.yard_id AND active)) OR coalesce(cap.map_cell_code,cap.code) NOT IN(SELECT code FROM stock_map_cells) THEN RAISE EXCEPTION '规划货位必须是启用的地图货位' USING ERRCODE='23514';END IF;
 WITH occupancy AS(
 SELECT b.id,coalesce(p.customer_id,b.customer_id) customer,b.net_weight FROM bundles b LEFT JOIN reservations r ON r.bundle_id=b.id AND r.released_at IS NULL LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN sales_plans p ON p.id=a.plan_id WHERE b.location_id=loc AND b.physical_status='IN_STOCK' AND NOT EXISTS(SELECT 1 FROM loading_items z JOIN loading_orders l ON l.id=z.loading_id WHERE z.bundle_id=b.id AND z.active AND l.status='LOADED')
 UNION
 SELECT b.id,p.customer_id,b.net_weight FROM allocations a JOIN sales_plans p ON p.id=a.plan_id JOIN reservations r ON r.allocation_id=a.id AND r.released_at IS NULL JOIN bundles b ON b.id=r.bundle_id WHERE a.planned_location_id=loc AND a.workflow_version='2.6.1' AND a.workflow_state NOT IN('CANCELLED','FULFILLED') AND b.physical_status='IN_STOCK' AND NOT EXISTS(SELECT 1 FROM loading_items z JOIN loading_orders l ON l.id=z.loading_id WHERE z.bundle_id=b.id AND z.active AND l.workflow_state IN('DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND')))
 SELECT count(DISTINCT customer),count(DISTINCT id),coalesce(sum(net_weight),0) INTO k,n,w FROM occupancy;
 IF k>1 THEN RAISE EXCEPTION '规划货位存在其他客户实物或有效Lot规划占用' USING ERRCODE='23514';END IF;
 IF cap.max_bundles IS NOT NULL AND n>cap.max_bundles OR cap.max_net_weight IS NOT NULL AND w>cap.max_net_weight THEN RAISE EXCEPTION '规划货位数量或已知净重超过容量' USING ERRCODE='23514';END IF;
END $$;
REVOKE ALL ON FUNCTION v261_assert_plan(uuid) FROM PUBLIC;

-- Preserve the old reservation guard; new reservations can have unknown mass while working.
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('reservation_guard()'::regprocedure) INTO d;
 d:=replace(d,'IF TG_OP=''INSERT'' THEN PERFORM', $new$IF a.workflow_version='2.6.1' THEN
 IF current_user<>'musonoi_owner' THEN RAISE EXCEPTION 'Lot锁定必须使用作业函数' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
 IF a.status<>'DRAFT' OR p.status<>'OPEN' OR b.physical_status<>'IN_STOCK' OR b.project_id<>p.project_id OR NEW.weight IS DISTINCT FROM b.net_weight OR NOT EXISTS(SELECT 1 FROM allocation_items WHERE allocation_id=a.id AND bundle_id=b.id) THEN RAISE EXCEPTION 'Lot锁定状态冲突' USING ERRCODE='23514';END IF;
 PERFORM v23_require(NEW.locked_by,'allocation:write',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 ELSIF NEW.released_at IS NULL THEN
 IF OLD.released_at IS NOT NULL OR a.workflow_state NOT IN('WORKING','RECTIFY') OR (to_jsonb(NEW)-'weight')<>(to_jsonb(OLD)-'weight') OR NEW.weight IS DISTINCT FROM b.net_weight THEN RAISE EXCEPTION '只允许作业期间同步实际检斤锁定重量' USING ERRCODE='23514';END IF;
 ELSE
 IF OLD.released_at IS NOT NULL OR (to_jsonb(NEW)-ARRAY['released_at','released_by','release_reason'])<>(to_jsonb(OLD)-ARRAY['released_at','released_by','release_reason']) OR length(trim(NEW.release_reason))<1 THEN RAISE EXCEPTION '锁定历史不可覆盖' USING ERRCODE='23514';END IF;
 IF a.workflow_state='CANCELLED' AND a.cancelled_by=NEW.released_by THEN PERFORM v23_require(NEW.released_by,'allocation:write',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 ELSE PERFORM v23_require(NEW.released_by,'outbound:approve',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));IF NOT EXISTS(SELECT 1 FROM loading_items z JOIN loading_orders l ON l.id=z.loading_id WHERE z.reservation_id=OLD.id AND l.workflow_state='DEPARTED_PENDING') THEN RAISE EXCEPTION '只有经理正式出库或专门取消可释放Lot' USING ERRCODE='23514';END IF;END IF;
 END IF;RETURN NEW;END IF;
 IF TG_OP='INSERT' THEN PERFORM$new$);EXECUTE d;
 -- Only an audited lot measurement in this transaction may update a reserved bundle.
 SELECT pg_get_functiondef('confirmed_bundle_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN', $new$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND EXISTS(SELECT 1 FROM reservations rr JOIN allocations aa ON aa.id=rr.allocation_id JOIN lot_work_history hh ON hh.allocation_id=aa.id AND hh.bundle_id=OLD.id WHERE rr.bundle_id=OLD.id AND rr.released_at IS NULL AND aa.workflow_version='2.6.1' AND aa.workflow_state IN('WORKING','RECTIFY') AND hh.action='WEIGH' AND hh.after_data->>'txid'=txid_current()::text AND (hh.after_data->>'net_weight')::numeric=NEW.net_weight) AND (to_jsonb(NEW)-ARRAY['version','net_weight','original_net_weight','gross_weight','packaging_weight','weight_rule_version'])=(to_jsonb(OLD)-ARRAY['version','net_weight','original_net_weight','gross_weight','packaging_weight','weight_rule_version']) AND NEW.version=OLD.version+1 THEN RETURN NEW;END IF;
 $new$);EXECUTE d;
 SELECT pg_get_functiondef('allocation_items_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN', $new$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND NEW.allocation_id=OLD.allocation_id AND NEW.bundle_id=OLD.bundle_id AND EXISTS(SELECT 1 FROM allocations WHERE id=OLD.allocation_id AND workflow_version='2.6.1' AND workflow_state IN('WORKING','RECTIFY')) THEN RETURN NEW;END IF;
 $new$);EXECUTE d;
 -- Pending Lot assignment is a plan; temporary physical stock has not moved yet.
 SELECT pg_get_functiondef('storage_assert_location(uuid,boolean)'::regprocedure) INTO d;
 d:=replace(d,'coalesce(p.customer_id,b.customer_id)', $new$CASE WHEN a.workflow_version='2.6.1' AND a.workflow_state IN('WORKING','PENDING','RECTIFY') THEN b.customer_id ELSE coalesce(p.customer_id,b.customer_id) END$new$);EXECUTE d;
END $$;

-- Prevent older endpoints/functions from bypassing new work stages.
DO $$ DECLARE d text;n text;BEGIN FOREACH n IN ARRAY ARRAY['v26_allocation_action(uuid,uuid,integer,text,text)','v26_register_positions(uuid,uuid,integer,jsonb)'] LOOP SELECT pg_get_functiondef(n::regprocedure) INTO d;
 d:=replace(d,'SELECT * INTO p FROM sales_plans WHERE id=a.plan_id', $new$IF a.workflow_version='2.6.1' THEN RAISE EXCEPTION '请使用V2.6.1备货作业流程，不提供实际移动确认' USING ERRCODE='23514';END IF;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id$new$);EXECUTE d;END LOOP;END $$;
CREATE FUNCTION v261_old_sample_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM reservations r JOIN allocations a ON a.id=r.allocation_id WHERE r.bundle_id=NEW.bundle_id AND r.released_at IS NULL AND a.workflow_version='2.6.1') THEN RAISE EXCEPTION '该捆包取样须在所属Lot作业内登记' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v261_old_sample_boundary BEFORE INSERT ON sampling_items FOR EACH ROW EXECUTE FUNCTION v261_old_sample_boundary();
