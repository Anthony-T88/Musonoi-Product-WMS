INSERT INTO role_permissions VALUES('logistics_manager','master:read') ON CONFLICT DO NOTHING;
-- Unknown mass contributes no known mass to reports, without changing stored NULL.
CREATE OR REPLACE FUNCTION v24_qty(actor uuid,s jsonb,f jsonb) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT CASE WHEN v24_visible(actor,s,f) AND s->>'physical_status'='IN_STOCK' THEN coalesce((s->>'weight')::numeric,0) ELSE 0::numeric END $$;
CREATE FUNCTION v26_loading_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE a allocations;d loading_orders;BEGIN
 SELECT aa.* INTO a FROM reservations r JOIN allocations aa ON aa.id=r.allocation_id WHERE r.id=NEW.reservation_id;
 SELECT * INTO d FROM loading_orders WHERE id=NEW.loading_id;
 IF a.lot_no IS NOT NULL AND (d.allocation_id IS DISTINCT FROM a.id OR d.workflow_state IS DISTINCT FROM 'PENDING' OR a.workflow_state NOT IN('PREPARED','PARTIAL')) THEN RAISE EXCEPTION 'Lot装车必须走已审核的新流程' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v26_loading_boundary BEFORE INSERT ON loading_items FOR EACH ROW EXECUTE FUNCTION v26_loading_boundary();
CREATE FUNCTION v26_reservation_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM bundles WHERE id=NEW.bundle_id AND workflow_version='2.6') AND NOT EXISTS(SELECT 1 FROM allocations WHERE id=NEW.allocation_id AND lot_no IS NOT NULL) THEN RAISE EXCEPTION '新生产库存必须经过检斤及Lot审批流程' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v26_reservation_boundary BEFORE INSERT ON reservations FOR EACH ROW EXECUTE FUNCTION v26_reservation_boundary();
