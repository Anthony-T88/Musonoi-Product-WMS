ALTER TABLE receipt_lines ADD CONSTRAINT production_before_inbound CHECK(production_date<=(inbound_at AT TIME ZONE 'Africa/Lubumbashi')::date);
CREATE FUNCTION plan_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE used numeric; BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sales plan history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.project_id<>OLD.project_id OR NEW.customer_id<>OLD.customer_id OR NEW.code<>OLD.code OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.origin<>OLD.origin THEN RAISE EXCEPTION 'Plan identity cannot change' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(r.weight),0) INTO used FROM reservations r JOIN allocations a ON a.id=r.allocation_id WHERE a.plan_id=OLD.id AND r.released_at IS NULL;
 IF NEW.target_weight<used OR(NEW.status='CLOSED' AND used>0) THEN RAISE EXCEPTION 'Active reservations exceed target or prevent closing' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER plan_history BEFORE UPDATE OR DELETE ON sales_plans FOR EACH ROW EXECUTE FUNCTION plan_history_guard();
CREATE FUNCTION allocation_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD.status='RELEASED' THEN RAISE EXCEPTION 'Preparation history cannot be deleted or rewritten' USING ERRCODE='23514'; END IF;
 IF NEW.plan_id<>OLD.plan_id OR NEW.code<>OLD.code OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.origin<>OLD.origin THEN RAISE EXCEPTION 'Preparation identity cannot change' USING ERRCODE='23514'; END IF;
 IF OLD.status='DRAFT' AND NEW.status='LOCKED' THEN IF NOT EXISTS(SELECT 1 FROM allocation_items WHERE allocation_id=OLD.id) OR EXISTS(SELECT 1 FROM allocation_items i WHERE i.allocation_id=OLD.id AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.allocation_id=OLD.id AND r.bundle_id=i.bundle_id AND r.released_at IS NULL)) THEN RAISE EXCEPTION 'Every bundle must be locked atomically' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='LOCKED' AND NEW.status='RELEASED' THEN IF EXISTS(SELECT 1 FROM reservations WHERE allocation_id=OLD.id AND released_at IS NULL) THEN RAISE EXCEPTION 'Every reservation must be released atomically' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Invalid preparation transition' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER allocation_history BEFORE UPDATE OR DELETE ON allocations FOR EACH ROW EXECUTE FUNCTION allocation_history_guard();
CREATE FUNCTION allocation_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE state text; BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Preparation items immutable' USING ERRCODE='23514'; END IF;
 SELECT status INTO state FROM allocations WHERE id=NEW.allocation_id FOR UPDATE;
 IF state<>'DRAFT' THEN RAISE EXCEPTION 'Cannot add to locked preparation' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER allocation_items_history BEFORE INSERT OR UPDATE OR DELETE ON allocation_items FOR EACH ROW EXECUTE FUNCTION allocation_items_guard();
CREATE FUNCTION confirmed_bundle_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bundle numbers and inventory history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'version')<>(to_jsonb(OLD)-'version') OR(NEW.version<>OLD.version AND NEW.version<>OLD.version+1) THEN RAISE EXCEPTION 'Direct confirmed inventory changes forbidden; use authorized future adjustment' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER immutable_bundles BEFORE UPDATE OR DELETE ON bundles FOR EACH ROW EXECUTE FUNCTION confirmed_bundle_guard();
CREATE FUNCTION confirmation_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.status='CONFIRMED' AND current_user<>'musonoi_owner' THEN RAISE EXCEPTION 'Confirmation must use the authorized database function' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER confirmation_authority BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION confirmation_authority_guard();
CREATE FUNCTION event_consistency_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.event_type='INBOUND' AND current_user<>'musonoi_owner' THEN RAISE EXCEPTION 'Inbound events only via confirmation' USING ERRCODE='23514'; END IF;
 IF NEW.event_type='LOCK' AND NOT EXISTS(SELECT 1 FROM reservations WHERE bundle_id=NEW.bundle_id AND allocation_id=(NEW.after_data->>'allocation_id')::uuid AND released_at IS NULL AND locked_by=NEW.actor_id) THEN RAISE EXCEPTION 'Lock event has no matching reservation' USING ERRCODE='23514'; END IF;
 IF NEW.event_type='UNLOCK' AND NOT EXISTS(SELECT 1 FROM reservations WHERE bundle_id=NEW.bundle_id AND allocation_id=(NEW.after_data->>'allocation_id')::uuid AND released_at IS NOT NULL AND released_by=NEW.actor_id) THEN RAISE EXCEPTION 'Release event has no matching reservation' USING ERRCODE='23514'; END IF; RETURN NEW;
END $$;
CREATE TRIGGER event_consistency BEFORE INSERT ON inventory_events FOR EACH ROW EXECUTE FUNCTION event_consistency_guard();
CREATE UNIQUE INDEX one_reservation_event ON inventory_events(bundle_id,event_type,(after_data->>'allocation_id')) WHERE event_type IN ('LOCK','UNLOCK');
DO $$ DECLARE definition text; BEGIN
 SELECT pg_get_functiondef('reservation_guard()'::regprocedure) INTO definition;
 definition:=replace(definition,'IF TG_OP=''INSERT'' THEN','IF TG_OP=''INSERT'' THEN PERFORM 1 FROM customers WHERE id=p.customer_id AND active FOR SHARE; IF NOT FOUND THEN RAISE EXCEPTION ''Allocation customer inactive'' USING ERRCODE=''23514''; END IF;');
 EXECUTE definition;
END $$;
CREATE OR REPLACE VIEW inventory_view AS SELECT b.id AS uuid,b.bundle_no AS id,b.project_id,b.customer_id,l.warehouse_id,c.name AS customer,l.code AS location,t.code AS batch,b.net_weight AS weight,CASE WHEN b.physical_status='OUTBOUND' THEN '已出库' WHEN r.id IS NOT NULL THEN '已预留' ELSE '在库' END AS status,CASE b.sample_status WHEN 'NOT_SAMPLED' THEN '未取样' WHEN 'SAMPLING' THEN '取样中' ELSE '已取样' END AS sample,to_char(b.inbound_date,'YYYY-MM-DD') AS date,b.grade,b.purity,b.data_kind,b.version,p.customer_id AS allocated_customer_id,ac.name AS allocated_customer,a.code AS allocation_code,p.code AS sales_plan_code,doc.code AS receipt_code,doc.confirmed_at,to_char(b.production_date,'YYYY-MM-DD') AS production_date,b.inbound_at,u.display_name AS inbound_operator,b.remark,b.receipt_id FROM bundles b JOIN customers c ON c.id=b.customer_id JOIN locations l ON l.id=b.location_id JOIN batches t ON t.id=b.batch_id LEFT JOIN reservations r ON r.bundle_id=b.id AND r.released_at IS NULL LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN sales_plans p ON p.id=a.plan_id LEFT JOIN customers ac ON ac.id=p.customer_id LEFT JOIN receipts doc ON doc.id=b.receipt_id LEFT JOIN users u ON u.id=doc.created_by;
