ALTER TABLE loading_orders ADD COLUMN replaces_id uuid REFERENCES loading_orders(id);
CREATE UNIQUE INDEX one_live_loading_revision ON loading_orders(replaces_id) WHERE replaces_id IS NOT NULL AND workflow_state<>'REJECTED';
CREATE FUNCTION v26_resubmit_load(actor uuid,prior uuid,vehicle text,load_date date,ids uuid[]) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE old loading_orders;d loading_orders;BEGIN
 PERFORM v24_revision();SELECT * INTO old FROM loading_orders WHERE id=prior FOR UPDATE;
 IF NOT FOUND OR old.workflow_state IS DISTINCT FROM 'REJECTED' OR old.created_by<>actor THEN RAISE EXCEPTION '仅原创建人可纠正并重提已驳回装车单' USING ERRCODE='23514';END IF;
 d:=v26_create_load(actor,old.allocation_id,vehicle,load_date,ids);
 UPDATE loading_orders SET replaces_id=prior WHERE id=d.id RETURNING * INTO d;
 INSERT INTO workflow_reviews(loading_id,action,actor_id,note) VALUES(old.id,'RESUBMITTED',actor,'关联纠正版装车单 '||d.code);RETURN d;END $$;
REVOKE ALL ON FUNCTION v26_resubmit_load(uuid,uuid,text,date,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v26_resubmit_load(uuid,uuid,text,date,uuid[]) TO musonoi_app;
ALTER TABLE bundles ADD CONSTRAINT v26_unknown_mass CHECK(net_weight IS NOT NULL OR (workflow_version IS NOT DISTINCT FROM '2.6' AND physical_status='IN_STOCK' AND gross_weight IS NULL));
CREATE FUNCTION v26_receipt_boundary() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.workflow_version='2.6' AND NEW.workflow_version IS DISTINCT FROM OLD.workflow_version THEN RAISE EXCEPTION '生产入库流程版本不可回退' USING ERRCODE='23514';END IF;
 IF NEW.workflow_version='2.6' AND NOT EXISTS(SELECT 1 FROM customers WHERE id=NEW.customer_id AND project_id=NEW.project_id AND lower(name)='musonoi') THEN RAISE EXCEPTION '生产入库客户固定Musonoi' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v26_receipt_boundary BEFORE INSERT OR UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION v26_receipt_boundary();
-- Direct reservation release is already denied. Old owner functions must not release
-- a V2.6 reservation via a legacy outbound or cancellation path either.
CREATE FUNCTION v26_no_legacy_dispatch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM loading_items z JOIN loading_orders l ON l.id=z.loading_id WHERE l.id=NEW.loading_id AND l.workflow_state IS NOT NULL) THEN RAISE EXCEPTION 'V2.6装车单只能由物流经理新流程正式出库' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v26_no_legacy_dispatch BEFORE INSERT ON outbound_orders FOR EACH ROW EXECUTE FUNCTION v26_no_legacy_dispatch();
