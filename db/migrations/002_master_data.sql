ALTER TABLE customers ADD COLUMN active boolean NOT NULL DEFAULT true, ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE warehouses ADD COLUMN active boolean NOT NULL DEFAULT true, ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE batches ADD COLUMN active boolean NOT NULL DEFAULT true, ADD COLUMN version integer NOT NULL DEFAULT 1, ADD COLUMN production_date date;
ALTER TABLE locations ADD COLUMN version integer NOT NULL DEFAULT 1;
CREATE TABLE yards(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL,warehouse_id uuid NOT NULL,code text NOT NULL,name text NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,FOREIGN KEY(project_id,warehouse_id) REFERENCES warehouses(project_id,id),UNIQUE(project_id,code),UNIQUE(project_id,id));
ALTER TABLE locations ADD COLUMN yard_id uuid, ADD FOREIGN KEY(project_id,yard_id) REFERENCES yards(project_id,id);
CREATE TABLE idempotency_requests(actor_id uuid REFERENCES users(id),route text NOT NULL,key text NOT NULL,request_hash text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(actor_id,route,key));
CREATE FUNCTION guard_occupied_master() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT NEW.active AND OLD.active THEN
  IF TG_TABLE_NAME='locations' AND EXISTS(SELECT 1 FROM bundles WHERE location_id=OLD.id AND physical_status='IN_STOCK') THEN RAISE EXCEPTION 'Occupied location cannot be disabled' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='warehouses' AND EXISTS(SELECT 1 FROM bundles b JOIN locations l ON l.id=b.location_id WHERE l.warehouse_id=OLD.id AND b.physical_status='IN_STOCK') THEN RAISE EXCEPTION 'Occupied warehouse cannot be disabled' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='yards' AND EXISTS(SELECT 1 FROM bundles b JOIN locations l ON l.id=b.location_id WHERE l.yard_id=OLD.id AND b.physical_status='IN_STOCK') THEN RAISE EXCEPTION 'Occupied yard cannot be disabled' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER guard_location_disable BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION guard_occupied_master();
CREATE TRIGGER guard_warehouse_disable BEFORE UPDATE ON warehouses FOR EACH ROW EXECUTE FUNCTION guard_occupied_master();
CREATE TRIGGER guard_yard_disable BEFORE UPDATE ON yards FOR EACH ROW EXECUTE FUNCTION guard_occupied_master();
INSERT INTO permissions VALUES('master:read'),('master:write'),('receipt:read'),('receipt:write'),('receipt:review'),('allocation:read'),('allocation:write'),('allocation:release');
INSERT INTO role_permissions SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE p.code IN ('master:read','receipt:read','allocation:read');
INSERT INTO role_permissions VALUES('admin','master:write'),('supervisor','master:write'),('admin','receipt:write'),('operator','receipt:write'),('supervisor','receipt:write'),('admin','receipt:review'),('supervisor','receipt:review'),('admin','allocation:write'),('sales','allocation:write'),('supervisor','allocation:write'),('admin','allocation:release'),('supervisor','allocation:release'),('sales','allocation:release');
GRANT SELECT,INSERT,UPDATE ON customers,warehouses,yards,locations,batches TO musonoi_app;
GRANT SELECT,INSERT ON idempotency_requests TO musonoi_app;
