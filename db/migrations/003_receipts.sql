CREATE SEQUENCE receipt_numbers;
CREATE TABLE receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE DEFAULT('IN-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('receipt_numbers')::text,6,'0')),project_id uuid NOT NULL REFERENCES projects(id),customer_id uuid NOT NULL,status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','CONFIRMED','REJECTED')),origin text NOT NULL CHECK(origin IN ('MANUAL','EXCEL')),created_by uuid NOT NULL REFERENCES users(id),reviewed_by uuid REFERENCES users(id),remark text NOT NULL DEFAULT '',rejection_reason text,submitted_at timestamptz,confirmed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1,data_kind text NOT NULL CHECK(data_kind IN ('DEMO','REAL')),FOREIGN KEY(project_id,customer_id) REFERENCES customers(project_id,id),CHECK(status<>'CONFIRMED' OR (confirmed_at IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_by<>created_by)));
CREATE TABLE receipt_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receipt_id uuid NOT NULL REFERENCES receipts(id),line_no integer NOT NULL CHECK(line_no>0),bundle_no text NOT NULL CHECK(bundle_no=upper(trim(bundle_no)) AND length(bundle_no) BETWEEN 1 AND 80),batch_id uuid NOT NULL REFERENCES batches(id),production_date date NOT NULL,inbound_at timestamptz NOT NULL,net_weight numeric(14,6) NOT NULL CHECK(net_weight>0),location_id uuid NOT NULL REFERENCES locations(id),remark text NOT NULL DEFAULT '',UNIQUE(receipt_id,line_no),UNIQUE(receipt_id,bundle_no));
ALTER TABLE bundles ADD COLUMN receipt_id uuid REFERENCES receipts(id), ADD COLUMN receipt_line_id uuid UNIQUE REFERENCES receipt_lines(id), ADD COLUMN production_date date, ADD COLUMN remark text NOT NULL DEFAULT '';
CREATE TABLE inventory_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,bundle_id uuid NOT NULL REFERENCES bundles(id),receipt_id uuid REFERENCES receipts(id),event_type text NOT NULL CHECK(event_type IN ('INBOUND','LOCK','UNLOCK')),physical_delta numeric(14,6) NOT NULL CHECK((event_type='INBOUND' AND physical_delta>0) OR(event_type<>'INBOUND' AND physical_delta=0)),actor_id uuid NOT NULL REFERENCES users(id),before_data jsonb,after_data jsonb,occurred_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX inbound_event_unique ON inventory_events(bundle_id) WHERE event_type='INBOUND';
CREATE FUNCTION guard_receipt_history() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE state text; BEGIN
 IF TG_TABLE_NAME='receipts' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Receipt history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status='CONFIRMED' THEN RAISE EXCEPTION 'Confirmed receipt is immutable; authorized reversal is not available in this version' USING ERRCODE='23514'; END IF;
  IF NEW.project_id<>OLD.project_id OR NEW.created_by<>OLD.created_by OR NEW.code<>OLD.code THEN RAISE EXCEPTION 'Receipt identity is immutable' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD.status IN ('DRAFT','REJECTED') AND NEW.status IN ('DRAFT','PENDING')) OR (OLD.status='PENDING' AND NEW.status IN ('CONFIRMED','REJECTED'))) THEN RAISE EXCEPTION 'Invalid receipt transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT status INTO state FROM receipts WHERE id=coalesce(NEW.receipt_id,OLD.receipt_id) FOR UPDATE;
 IF state NOT IN ('DRAFT','REJECTED') THEN RAISE EXCEPTION 'Only editable drafts may change lines' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER receipt_history BEFORE UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION guard_receipt_history();
CREATE TRIGGER receipt_line_history BEFORE INSERT OR UPDATE OR DELETE ON receipt_lines FOR EACH ROW EXECUTE FUNCTION guard_receipt_history();
CREATE FUNCTION immutable_inventory_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Inventory history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON inventory_events FOR EACH ROW EXECUTE FUNCTION immutable_inventory_event();
CREATE FUNCTION confirm_receipt(actor uuid,document uuid,expected_version integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r receipts; l receipt_lines; bid uuid; BEGIN
 SELECT * INTO r FROM receipts WHERE id=document FOR UPDATE;
 IF NOT FOUND OR r.status<>'PENDING' OR r.version<>expected_version THEN RAISE EXCEPTION 'Receipt changed or already confirmed' USING ERRCODE='23514'; END IF;
 IF r.created_by=actor THEN RAISE EXCEPTION 'Independent reviewer required' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code WHERE u.id=actor AND u.active AND p.permission_code='receipt:review') THEN RAISE EXCEPTION 'Unauthorized reviewer' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM receipt_lines WHERE receipt_id=document) THEN RAISE EXCEPTION 'Receipt is empty' USING ERRCODE='23514'; END IF;
 FOR l IN SELECT * FROM receipt_lines WHERE receipt_id=document ORDER BY bundle_no LOOP
  PERFORM 1 FROM batches t JOIN locations x ON x.id=l.location_id JOIN warehouses w ON w.id=x.warehouse_id JOIN customers c ON c.id=r.customer_id WHERE t.id=l.batch_id AND t.project_id=r.project_id AND x.project_id=r.project_id AND c.project_id=r.project_id AND t.active AND x.active AND w.active AND c.active FOR SHARE OF t,x,w,c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Master data inactive or mismatched' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM locations x JOIN yards y ON y.id=x.yard_id WHERE x.id=l.location_id AND NOT y.active) THEN RAISE EXCEPTION 'Yard inactive' USING ERRCODE='23514'; END IF;
  PERFORM y.id FROM yards y JOIN locations x ON x.yard_id=y.id WHERE x.id=l.location_id FOR SHARE OF y;
  IF NOT EXISTS(SELECT 1 FROM user_scopes s JOIN locations x ON x.id=l.location_id WHERE s.user_id=actor AND s.project_id=r.project_id AND (s.customer_id IS NULL OR s.customer_id=r.customer_id) AND(s.warehouse_id IS NULL OR s.warehouse_id=x.warehouse_id)) THEN RAISE EXCEPTION 'Review scope denied' USING ERRCODE='23514'; END IF;
  INSERT INTO bundles(bundle_no,project_id,batch_id,location_id,customer_id,net_weight,physical_status,sample_status,inbound_date,inbound_at,data_kind,receipt_id,receipt_line_id,production_date,remark) VALUES(l.bundle_no,r.project_id,l.batch_id,l.location_id,r.customer_id,l.net_weight,'IN_STOCK','NOT_SAMPLED',(l.inbound_at AT TIME ZONE 'Africa/Lubumbashi')::date,l.inbound_at,r.data_kind,document,l.id,l.production_date,l.remark) RETURNING id INTO bid;
  INSERT INTO inventory_events(bundle_id,receipt_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(bid,document,'INBOUND',l.net_weight,actor,jsonb_build_object('weight','0'),jsonb_build_object('weight',l.net_weight::text,'location_id',l.location_id,'bundle_no',l.bundle_no));
 END LOOP;
 UPDATE receipts SET status='CONFIRMED',reviewed_by=actor,confirmed_at=now(),updated_at=now(),version=version+1 WHERE id=document;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data) VALUES(actor,'receipt_confirmed','receipts',document::text,to_jsonb(r),jsonb_build_object('status','CONFIRMED','code',r.code));
 RETURN document;
END $$;
REVOKE ALL ON FUNCTION confirm_receipt(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confirm_receipt(uuid,uuid,integer) TO musonoi_app;
GRANT SELECT,INSERT,UPDATE ON receipts TO musonoi_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON receipt_lines TO musonoi_app;
GRANT SELECT ON inventory_events TO musonoi_app;
CREATE FUNCTION guard_pending_location() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT NEW.active AND OLD.active AND EXISTS(SELECT 1 FROM receipt_lines l JOIN receipts r ON r.id=l.receipt_id WHERE r.status='PENDING' AND ((TG_TABLE_NAME='locations' AND l.location_id=OLD.id) OR (TG_TABLE_NAME='warehouses' AND EXISTS(SELECT 1 FROM locations x WHERE x.id=l.location_id AND x.warehouse_id=OLD.id)) OR (TG_TABLE_NAME='yards' AND EXISTS(SELECT 1 FROM locations x WHERE x.id=l.location_id AND x.yard_id=OLD.id)))) THEN RAISE EXCEPTION 'Pending receipt occupies this location' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER pending_location BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION guard_pending_location();
CREATE TRIGGER pending_warehouse BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION guard_pending_location();
CREATE TRIGGER pending_yard BEFORE UPDATE ON yards FOR EACH ROW EXECUTE FUNCTION guard_pending_location();
