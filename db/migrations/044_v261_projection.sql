ALTER VIEW inventory_view RENAME TO inventory_v26_compat;
DO $$ DECLARE cols text;BEGIN
 SELECT string_agg(CASE column_name
 WHEN 'weight' THEN 'CASE WHEN a.workflow_version=''2.6.1'' AND NOT wi.final_weighed THEN NULL ELSE prior.weight END AS weight'
 WHEN 'gross_weight' THEN 'CASE WHEN a.workflow_version=''2.6.1'' THEN CASE WHEN wi.final_weighed THEN ai.gross_weight END ELSE prior.gross_weight END AS gross_weight'
 WHEN 'business_status' THEN 'CASE WHEN a.workflow_version=''2.6.1'' AND a.workflow_state=''WORKING'' THEN ''备货作业中'' WHEN a.workflow_version=''2.6.1'' AND a.workflow_state=''RECTIFY'' THEN ''已驳回/待整改'' ELSE prior.business_status END AS business_status'
 ELSE 'prior.'||quote_ident(column_name) END,',' ORDER BY ordinal_position) INTO cols FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_v26_compat';
 EXECUTE 'CREATE VIEW inventory_view AS SELECT '||cols||',a.planned_location_id,pl.code AS planned_location,wi.sample_required,wi.sample_stage AS lot_sample_stage,wi.final_weighed,a.workflow_state AS lot_workflow_state,a.workflow_version AS lot_workflow_version FROM inventory_v26_compat prior LEFT JOIN reservations r ON r.bundle_id=prior.uuid AND r.released_at IS NULL LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN allocation_items ai ON ai.allocation_id=a.id AND ai.bundle_id=prior.uuid LEFT JOIN lot_work_items wi ON wi.allocation_id=a.id AND wi.bundle_id=prior.uuid LEFT JOIN locations pl ON pl.id=a.planned_location_id';
END $$;
GRANT SELECT ON inventory_view,inventory_v26_compat TO musonoi_app;
CREATE OR REPLACE FUNCTION v24_capture_bundle(bid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE v inventory_view;BEGIN
 PERFORM v26_capture_legacy(bid);SELECT * INTO v FROM inventory_view WHERE uuid=bid;
 UPDATE inventory_history SET state=state||jsonb_build_object('weight',v.weight::text,'gross_weight',v.gross_weight::text,'business_status',v.business_status,'on_site',v.on_site,'lot_no',v.lot_no,'current_customer',v.current_customer,'loading_workflow_state',v.loading_workflow_state,'actual_departed_at',v.actual_departed_at,'planned_location',v.planned_location,'planned_location_id',v.planned_location_id,'sample_required',v.sample_required,'lot_sample_stage',v.lot_sample_stage,'final_weighed',v.final_weighed,'lot_workflow_state',v.lot_workflow_state,'lot_workflow_version',v.lot_workflow_version) WHERE bundle_id=bid AND revision_id=v24_revision();END $$;

CREATE OR REPLACE FUNCTION v26_receipt_identity() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r receipts;t text;BEGIN
 SELECT * INTO r FROM receipts WHERE id=NEW.receipt_id;
 IF r.workflow_version='2.6' THEN
 IF r.number_rule_version='MUS_V261' THEN
 IF NEW.bundle_no !~ '^MUS-[0-9]{4}-[0-9]{3}-[0-9]{2,}$' OR split_part(NEW.bundle_no,'-',4) !~ '[1-9]' THEN RAISE EXCEPTION '编号须为MUS-YYYY-DDD-至少两位非全零序号，保留前导零' USING ERRCODE='23514';END IF;
 ELSE IF NEW.bundle_no !~ '^MUS-[0-9]{4}-[0-9]{3}-[1-9][0-9]*$' THEN RAISE EXCEPTION '历史生产编号格式无效' USING ERRCODE='23514';END IF;END IF;
 t:=split_part(NEW.bundle_no,'-',1)||'-'||split_part(NEW.bundle_no,'-',2)||'-'||split_part(NEW.bundle_no,'-',3);
 IF NOT EXISTS(SELECT 1 FROM batches WHERE id=NEW.batch_id AND project_id=r.project_id AND code=t) OR NOT EXISTS(SELECT 1 FROM locations WHERE id=NEW.location_id AND project_id=r.project_id AND code='临时堆存区') OR NOT EXISTS(SELECT 1 FROM customers WHERE id=r.customer_id AND project_id=r.project_id AND lower(name)='musonoi') THEN RAISE EXCEPTION '生产入库批次/客户/临时区不匹配' USING ERRCODE='23514';END IF;END IF;RETURN NEW;END $$;

CREATE FUNCTION v261_plan_integrity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE loc uuid;bid uuid;BEGIN
 IF TG_TABLE_NAME='allocations' THEN
 IF NEW.workflow_version='2.6.1' AND NEW.workflow_state NOT IN('CANCELLED','FULFILLED') THEN PERFORM v261_assert_plan(NEW.planned_location_id);END IF;RETURN NULL;
 ELSIF TG_TABLE_NAME='bundles' THEN bid:=NEW.id;
 ELSE bid:=NEW.bundle_id;END IF;
 FOR loc IN SELECT DISTINCT x.location_id FROM(SELECT b.location_id FROM bundles b WHERE b.id=bid UNION SELECT a.planned_location_id FROM allocations a JOIN allocation_items i ON i.allocation_id=a.id WHERE i.bundle_id=bid AND a.workflow_version='2.6.1' AND a.workflow_state NOT IN('CANCELLED','FULFILLED'))x WHERE x.location_id IS NOT NULL LOOP
 IF EXISTS(SELECT 1 FROM allocations a JOIN reservations r ON r.allocation_id=a.id AND r.released_at IS NULL WHERE a.planned_location_id=loc AND a.workflow_version='2.6.1' AND a.workflow_state NOT IN('CANCELLED','FULFILLED')) THEN PERFORM v261_assert_plan(loc);END IF;END LOOP;RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER v261_plan_integrity AFTER INSERT OR UPDATE ON allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v261_plan_integrity();
CREATE CONSTRAINT TRIGGER v261_plan_integrity AFTER INSERT OR UPDATE ON bundles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v261_plan_integrity();
CREATE CONSTRAINT TRIGGER v261_plan_integrity AFTER INSERT OR UPDATE ON reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v261_plan_integrity();
REVOKE ALL ON FUNCTION v261_plan_integrity() FROM PUBLIC;
-- A cancelled Lot releases plans without fabricating movement. Physical owner storage
-- checks still apply, so conflicting actual storage must be resolved before cancellation.
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v261_item_action(uuid,uuid,uuid,int,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'WHERE wi.allocation_id=doc AND wi.bundle_id=bid;', $r$WHERE wi.allocation_id=doc AND wi.bundle_id=bid AND action<>'weigh';$r$);EXECUTE d;END $$;
