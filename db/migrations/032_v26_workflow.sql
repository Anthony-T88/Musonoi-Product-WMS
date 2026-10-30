-- Additive V2.6. Existing documents remain legacy; no historical weights are backfilled.
ALTER TABLE receipts ADD COLUMN workflow_version text;
ALTER TABLE bundles ADD COLUMN workflow_version text;
ALTER TABLE bundles ALTER COLUMN net_weight DROP NOT NULL, ALTER COLUMN original_net_weight DROP NOT NULL;
ALTER TABLE receipt_lines ALTER COLUMN net_weight DROP NOT NULL;
ALTER TABLE allocations ADD COLUMN lot_no text UNIQUE CHECK(lot_no ~ '^RMM-CU-[0-9]{4}-(0[1-9]|[1-9][0-9])$'),
 ADD COLUMN workflow_state text CHECK(workflow_state IN('PENDING','REJECTED','PREPARED','PARTIAL','FULFILLED')),
 ADD COLUMN submitted_at timestamptz,ADD COLUMN reviewed_by uuid REFERENCES users(id),ADD COLUMN reviewed_at timestamptz,ADD COLUMN review_note text;
ALTER TABLE allocation_items ADD COLUMN gross_weight numeric(14,4),ADD COLUMN net_weight numeric(14,4);
ALTER TABLE loading_orders ADD COLUMN allocation_id uuid REFERENCES allocations(id),
 ADD COLUMN workflow_state text CHECK(workflow_state IN('PENDING','REJECTED','READY','DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND')),
 ADD COLUMN reviewed_by uuid REFERENCES users(id),ADD COLUMN reviewed_at timestamptz,ADD COLUMN actual_departed_at timestamptz,
 ADD COLUMN departure_by uuid REFERENCES users(id),ADD COLUMN manager_by uuid REFERENCES users(id),ADD COLUMN manager_at timestamptz,
 ADD COLUMN correction_note text NOT NULL DEFAULT '';
ALTER TABLE loading_orders ALTER COLUMN carrier DROP NOT NULL,ALTER COLUMN loading_point DROP NOT NULL;
CREATE TABLE workflow_reviews(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,allocation_id uuid REFERENCES allocations(id),loading_id uuid REFERENCES loading_orders(id),action text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),note text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),CHECK(num_nonnulls(allocation_id,loading_id)=1));
CREATE TRIGGER workflow_reviews_immutable BEFORE UPDATE OR DELETE ON workflow_reviews FOR EACH ROW EXECUTE FUNCTION v23_immutable();
GRANT SELECT ON workflow_reviews TO musonoi_app;
INSERT INTO roles VALUES('logistics_manager','物流经理');
INSERT INTO permissions VALUES('allocation:review'),('load:review'),('outbound:approve');
INSERT INTO role_permissions SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE (r.code IN('supervisor','admin') AND p.code IN('allocation:review','load:review')) OR (r.code='logistics_manager' AND p.code IN('inventory:read','inventory:export','allocation:read','load:read','outbound:read','outbound:approve','dashboard:read','report:read')) ON CONFLICT DO NOTHING;

-- Permit unknown inbound mass, while retaining a count event and explicit unknown basis.
ALTER TABLE inventory_events ALTER COLUMN physical_delta DROP NOT NULL;
ALTER TABLE inventory_events DROP CONSTRAINT inventory_events_check;
ALTER TABLE inventory_events ADD CHECK((event_type='INBOUND' AND (physical_delta IS NULL OR physical_delta>0)) OR(event_type IN('REVERSAL','ADJUST_GAIN','ADJUST_RESTORE') AND physical_delta>0) OR(event_type IN('OUTBOUND','ADJUST_LOSS') AND physical_delta<0) OR(event_type='ADJUST_WEIGHT' AND physical_delta<>0) OR(event_type IN('LOCK','UNLOCK','SAMPLE','WEIGH','LOAD','UNLOAD','MOVE','ADJUST_LOCATION') AND physical_delta=0));
CREATE OR REPLACE FUNCTION ux_receipt_weight() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM receipts WHERE id=NEW.receipt_id AND workflow_version='2.6') THEN
  IF num_nonnulls(NEW.gross_weight,NEW.net_weight,NEW.packaging_weight,NEW.weight_rule_version)<>0 THEN RAISE EXCEPTION '生产入库重量必须未知，检斤在备货环节登记' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 IF NEW.gross_weight IS NULL OR NEW.gross_weight<=0.002500 THEN RAISE EXCEPTION 'Legacy receipt requires verified gross weight' USING ERRCODE='23514';END IF;
 IF NEW.net_weight IS NOT NULL AND NEW.net_weight<>NEW.gross_weight-0.002500 THEN RAISE EXCEPTION 'Net weight mismatch' USING ERRCODE='23514';END IF;
 NEW.packaging_weight:=0.002500;NEW.weight_rule_version:='PACK_2_5KG_V1';NEW.net_weight:=NEW.gross_weight-NEW.packaging_weight;RETURN NEW;END $$;
CREATE OR REPLACE FUNCTION ux_bundle_weight() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE l receipt_lines;r receipts;BEGIN
 IF NEW.receipt_line_id IS NOT NULL THEN SELECT * INTO l FROM receipt_lines WHERE id=NEW.receipt_line_id;SELECT * INTO r FROM receipts WHERE id=l.receipt_id;
 IF r.workflow_version IS DISTINCT FROM '2.6' AND (l.gross_weight IS NULL OR l.weight_rule_version IS NULL) THEN RAISE EXCEPTION 'Legacy pending receipt requires verified gross weight' USING ERRCODE='23514';END IF;
 NEW.workflow_version:=r.workflow_version;NEW.gross_weight:=l.gross_weight;NEW.packaging_weight:=l.packaging_weight;NEW.weight_rule_version:=l.weight_rule_version;END IF;RETURN NEW;END $$;

-- Only the dedicated owner functions can update V2.6 workflow columns.
CREATE FUNCTION v26_document_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION '历史单据不可删除' USING ERRCODE='23514';END IF;
 IF current_user<>'musonoi_owner' AND (to_jsonb(NEW)->>'workflow_state' IS NOT NULL OR to_jsonb(OLD)->>'workflow_state' IS NOT NULL OR to_jsonb(NEW)->>'lot_no' IS NOT NULL OR to_jsonb(NEW)->>'allocation_id' IS NOT NULL) THEN RAISE EXCEPTION '新流程仅允许通过授权审批函数操作' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER v26_document BEFORE INSERT OR UPDATE OR DELETE ON allocations FOR EACH ROW EXECUTE FUNCTION v26_document_guard();
CREATE TRIGGER v26_document BEFORE INSERT OR UPDATE OR DELETE ON loading_orders FOR EACH ROW EXECUTE FUNCTION v26_document_guard();

-- Keep mature legacy guards as functions, wrapping narrowly defined owner-only V2.6 actions.
ALTER FUNCTION confirmed_bundle_guard() RENAME TO legacy_confirmed_bundle_guard;
CREATE FUNCTION confirmed_bundle_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND NEW.workflow_version='2.6' AND NEW.net_weight IS NOT NULL AND NEW.net_weight>0 AND NEW.gross_weight=NEW.net_weight+0.0025 AND NEW.original_net_weight=NEW.net_weight AND NEW.version=OLD.version+1 AND
 (to_jsonb(NEW)-ARRAY['version','net_weight','original_net_weight','gross_weight','packaging_weight','weight_rule_version','updated_at'])=(to_jsonb(OLD)-ARRAY['version','net_weight','original_net_weight','gross_weight','packaging_weight','weight_rule_version','updated_at']) AND NOT EXISTS(SELECT 1 FROM reservations WHERE bundle_id=OLD.id AND released_at IS NULL) THEN RETURN NEW;END IF;
 -- Remaining owner updates retain all original archive and adjustment checks.
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bundle history immutable' USING ERRCODE='23514';END IF;
 IF current_user='musonoi_owner' THEN
 IF(to_jsonb(NEW)-ARRAY['version','sample_status','location_id','physical_status','net_weight','updated_at'])<>(to_jsonb(OLD)-ARRAY['version','sample_status','location_id','physical_status','net_weight','updated_at']) THEN RAISE EXCEPTION 'Original bundle archive immutable' USING ERRCODE='23514';END IF;
 IF NEW.net_weight IS DISTINCT FROM OLD.net_weight AND NOT EXISTS(SELECT 1 FROM stock_adjustments a JOIN adjustment_lines l ON l.adjustment_id=a.id WHERE a.status='APPLIED' AND a.applied_txid=txid_current() AND l.bundle_no=OLD.bundle_no AND(l.before_data->>'net_weight')::numeric=OLD.net_weight AND(l.after_data->>'net_weight')::numeric=NEW.net_weight) THEN RAISE EXCEPTION 'Weight adjustment requires approval' USING ERRCODE='23514';END IF;
 IF NEW.physical_status IS DISTINCT FROM OLD.physical_status AND (NEW.physical_status='ADJUSTED_OUT' OR OLD.physical_status='ADJUSTED_OUT') AND NOT EXISTS(SELECT 1 FROM stock_adjustments a JOIN adjustment_lines l ON l.adjustment_id=a.id WHERE a.status='APPLIED' AND a.applied_txid=txid_current() AND l.bundle_no=OLD.bundle_no AND l.after_data->>'physical_status'=NEW.physical_status) THEN RAISE EXCEPTION 'Adjustment requires approval' USING ERRCODE='23514';END IF;
 ELSE IF(to_jsonb(NEW)-'version')<>(to_jsonb(OLD)-'version') THEN RAISE EXCEPTION 'Direct inventory changes forbidden' USING ERRCODE='23514';END IF;END IF;
 IF NEW.version NOT IN(OLD.version,OLD.version+1) THEN RAISE EXCEPTION 'Bundle version conflict' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
-- Trigger references are OIDs; point them to the new wrapper explicitly.
DROP TRIGGER immutable_bundles ON bundles;
CREATE TRIGGER immutable_bundles BEFORE UPDATE OR DELETE ON bundles FOR EACH ROW EXECUTE FUNCTION confirmed_bundle_guard();

-- Guard legacy entry points against applying old release/dispatch rules to new documents.
DO $$ DECLARE n text;d text;BEGIN
 FOREACH n IN ARRAY ARRAY['loading_action(uuid,uuid,integer,text,text)','outbound_creation_guard()'] LOOP
 SELECT pg_get_functiondef(n::regprocedure) INTO d;
 IF n LIKE 'loading_action%' THEN d:=replace(d,'SELECT * INTO d FROM loading_orders WHERE id=doc FOR UPDATE;','SELECT * INTO d FROM loading_orders WHERE id=doc FOR UPDATE; IF d.workflow_state IS NOT NULL THEN RAISE EXCEPTION ''Use V2.6 workflow'' USING ERRCODE=''23514'';END IF;');
 ELSE d:=replace(d,$f$IF l.status<>'LOADED'$f$, $r$IF l.workflow_state IS NOT NULL THEN RAISE EXCEPTION 'Use V2.6 workflow' USING ERRCODE='23514';END IF; IF l.status<>'LOADED'$r$);END IF;EXECUTE d;END LOOP;
END $$;
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('allocation_history_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN', $r$BEGIN
 IF current_user='musonoi_owner' AND TG_OP='UPDATE' AND OLD.lot_no IS NOT NULL AND NEW.plan_id=OLD.plan_id AND NEW.lot_no=OLD.lot_no AND NEW.created_by=OLD.created_by AND NEW.code=OLD.code THEN RETURN NEW;END IF;$r$);EXECUTE d;
 SELECT pg_get_functiondef('reservation_guard()'::regprocedure) INTO d;
 d:=replace(d,$f$rp.permission_code IN('allocation:release','outbound:depart')$f$,$r$rp.permission_code IN('allocation:release','outbound:depart','outbound:approve','allocation:review')$r$);EXECUTE d;
END $$;
