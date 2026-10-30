DO $$ DECLARE d text;BEGIN
 SELECT rtrim(trim(pg_get_viewdef('inventory_view'::regclass,true)),';') INTO d;
 EXECUTE 'CREATE OR REPLACE VIEW inventory_view AS SELECT prior.*,coalesce(a.lot_no,h.lot_no) AS lot_no,coalesce(ac.name,h.customer_name,prior.customer) AS current_customer,
 CASE WHEN b.physical_status=''OUTBOUND'' THEN ''已出库'' WHEN lo.workflow_state=''DEPARTED_CORRECTION'' THEN ''已离场/待纠正'' WHEN lo.workflow_state=''DEPARTED_PENDING'' THEN ''已离场/待出库审批'' WHEN lo.workflow_state=''READY'' THEN ''已审核/待离场'' WHEN lo.workflow_state=''PENDING'' THEN ''装车待审核'' WHEN a.workflow_state=''PENDING'' THEN ''备货待审核'' WHEN a.workflow_state IN(''PREPARED'',''PARTIAL'') THEN ''已备货'' WHEN prior.status=''在库'' THEN ''可备货'' ELSE prior.status END AS business_status,
 (b.physical_status=''IN_STOCK'' AND coalesce(lo.workflow_state,'''') NOT IN(''DEPARTED_PENDING'',''DEPARTED_CORRECTION'',''OUTBOUND'')) AS on_site,
 lo.actual_departed_at AS actual_departed_at,lo.workflow_state AS loading_workflow_state
 FROM ('||d||') prior JOIN bundles b ON b.id=prior.uuid
 LEFT JOIN reservations r ON r.bundle_id=b.id AND r.released_at IS NULL LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN sales_plans p ON p.id=a.plan_id LEFT JOIN customers ac ON ac.id=p.customer_id
 LEFT JOIN LATERAL(SELECT d.* FROM loading_items z JOIN loading_orders d ON d.id=z.loading_id WHERE z.bundle_id=b.id AND (z.active OR d.workflow_state=''OUTBOUND'' AND b.physical_status=''OUTBOUND'') ORDER BY d.created_at DESC LIMIT 1) lo ON true
 LEFT JOIN LATERAL(SELECT aa.lot_no,c.name AS customer_name FROM allocation_items ai JOIN allocations aa ON aa.id=ai.allocation_id JOIN sales_plans sp ON sp.id=aa.plan_id JOIN customers c ON c.id=sp.customer_id WHERE ai.bundle_id=b.id AND aa.workflow_state IN(''PREPARED'',''PARTIAL'',''FULFILLED'') ORDER BY aa.created_at DESC LIMIT 1)h ON true';
END $$;
-- The current projection changes; committed historical snapshots remain immutable.
ALTER FUNCTION v24_capture_bundle(uuid) RENAME TO v26_capture_legacy;
CREATE FUNCTION v24_capture_bundle(bid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE v inventory_view;BEGIN
 PERFORM v26_capture_legacy(bid);SELECT * INTO v FROM inventory_view WHERE uuid=bid;
 UPDATE inventory_history SET state=state||jsonb_build_object('business_status',v.business_status,'on_site',v.on_site,'lot_no',v.lot_no,'current_customer',v.current_customer,'loading_workflow_state',v.loading_workflow_state,'actual_departed_at',v.actual_departed_at) WHERE bundle_id=bid AND revision_id=v24_revision();END $$;
REVOKE ALL ON FUNCTION v26_capture_legacy(uuid),v24_capture_bundle(uuid) FROM PUBLIC;

-- Keep all capacity/customer checks, excluding departed physical goods from yard occupancy.
DO $$ DECLARE n text;d text;BEGIN
 FOREACH n IN ARRAY ARRAY['storage_assert_location(uuid,boolean)','storage_deferred_check()'] LOOP
 SELECT pg_get_functiondef(n::regprocedure) INTO d;
 d:=replace(d,$f$d.status='LOADED'$f$,$r$(d.status='LOADED')$r$); -- loaded and departed retained in vehicle history
 EXECUTE d;END LOOP;
END $$;
-- No implicit move on rejection. A released V2.6 allocation can expose an actual mixed
-- location; retain the observation and report it, rather than inventing a move or refusing release.
CREATE FUNCTION v26_rejection_storage() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE loc uuid;BEGIN
 IF TG_TABLE_NAME='reservations' AND TG_OP='UPDATE' AND NEW.released_at IS NOT NULL AND EXISTS(SELECT 1 FROM allocations WHERE id=NEW.allocation_id AND workflow_state='REJECTED') THEN
 SELECT location_id INTO loc FROM bundles WHERE id=NEW.bundle_id;
 IF (SELECT count(DISTINCT coalesce(p.customer_id,b.customer_id)) FROM bundles b LEFT JOIN reservations r ON r.bundle_id=b.id AND r.released_at IS NULL LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN sales_plans p ON p.id=a.plan_id WHERE b.location_id=loc AND b.physical_status='IN_STOCK')>1 THEN
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(NEW.released_by,'v26_rejection_storage_conflict','locations',loc::text,jsonb_build_object('allocation_id',NEW.allocation_id,'notice','真实货位未移动，释放后客户混放须现场处理'));
 END IF;RETURN NULL;END IF;RETURN NULL;END $$;
-- Rejection uses a dedicated deferred wrapper for the single release case.
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('storage_deferred_check()'::regprocedure) INTO d;
 d:=replace(d,$f$ELSIF TG_TABLE_NAME='reservations' THEN$f$,$r$ELSIF TG_TABLE_NAME='reservations' THEN
 IF TG_OP='UPDATE' AND NEW.released_at IS NOT NULL AND EXISTS(SELECT 1 FROM allocations WHERE id=NEW.allocation_id AND workflow_state='REJECTED') THEN RETURN NULL;END IF;$r$);EXECUTE d;END $$;
CREATE CONSTRAINT TRIGGER v26_rejection_storage AFTER UPDATE ON reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v26_rejection_storage();
REVOKE ALL ON FUNCTION v26_rejection_storage() FROM PUBLIC;

-- Legacy lock/release API and raw SQL must not manipulate a V2.6 reservation.
CREATE FUNCTION v26_reservation_authority() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user<>'musonoi_owner' AND EXISTS(SELECT 1 FROM allocations WHERE id=NEW.allocation_id AND lot_no IS NOT NULL) THEN RAISE EXCEPTION 'V2.6锁定只能经授权流程操作' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v26_reservation_authority BEFORE INSERT OR UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION v26_reservation_authority();
