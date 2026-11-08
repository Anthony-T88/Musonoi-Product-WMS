-- Add location relationships to the existing cobalt ledger; no copper changes.
CREATE TABLE co_zones(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),
 project_id uuid NOT NULL REFERENCES projects(id),warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 80),name text NOT NULL,name_en text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),active boolean NOT NULL DEFAULT true,
 updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(warehouse_id,code),UNIQUE(id,project_id,warehouse_id));
CREATE TABLE co_locations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),zone_id uuid NOT NULL,project_id uuid NOT NULL,warehouse_id uuid NOT NULL,
 product_code text NOT NULL DEFAULT 'CO_HYDROXIDE' CHECK(product_code='CO_HYDROXIDE'),
 code text NOT NULL CHECK(length(trim(code)) BETWEEN 1 AND 80),x numeric NOT NULL CHECK(x BETWEEN 0 AND 100000),y numeric NOT NULL CHECK(y BETWEEN 0 AND 100000),
 width numeric NOT NULL CHECK(width BETWEEN 40 AND 10000),height numeric NOT NULL CHECK(height BETWEEN 40 AND 10000),
 active boolean NOT NULL DEFAULT true,occupied_by uuid REFERENCES co_preparations(id),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(zone_id,project_id,warehouse_id) REFERENCES co_zones(id,project_id,warehouse_id),
 UNIQUE(warehouse_id,code),UNIQUE(id,occupied_by));
CREATE TABLE co_positions(
 bag_id uuid PRIMARY KEY REFERENCES co_inventory(bag_id),preparation_id uuid NOT NULL,
 location_id uuid,version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_by uuid REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(bag_id,preparation_id) REFERENCES co_bags(id,preparation_id),
 FOREIGN KEY(location_id,preparation_id) REFERENCES co_locations(id,occupied_by) DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX co_positions_location ON co_positions(location_id,preparation_id);
CREATE INDEX co_positions_preparation ON co_positions(preparation_id,bag_id);
INSERT INTO co_positions(bag_id,preparation_id) SELECT bag_id,preparation_id FROM co_inventory;
CREATE TABLE co_location_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entity_type text NOT NULL,entity_id uuid NOT NULL,preparation_id uuid REFERENCES co_preparations(id),actor_id uuid NOT NULL REFERENCES users(id),before_data jsonb,after_data jsonb NOT NULL,reason text NOT NULL CHECK(length(trim(reason))>0),occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX co_location_events_batch ON co_location_events(preparation_id,id);
CREATE TRIGGER co_location_events_immutable BEFORE UPDATE OR DELETE ON co_location_events FOR EACH ROW EXECUTE FUNCTION co_immutable();
CREATE FUNCTION co_location_authorized(actor uuid,permission text,project uuid,warehouse uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN role_permissions r ON r.role_code=u.role_code WHERE u.id=actor AND u.active AND u.deleted_at IS NULL AND r.permission_code=permission AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=u.id AND s.project_id=project AND(s.warehouse_id IS NULL OR s.warehouse_id=warehouse) AND s.customer_id IS NULL))$$;
CREATE FUNCTION co_location_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE permission text;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_LOCATION_NO_DELETE' USING ERRCODE='23514';END IF;
 permission:='co:location-manage';
 IF TG_OP='INSERT' AND NEW.version<>1 THEN RAISE EXCEPTION 'CO_LOCATION_INIT_VERSION' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='co_locations' THEN IF NEW.occupied_by IS DISTINCT FROM OLD.occupied_by THEN
   permission:='co:locate';
   IF (to_jsonb(NEW)-ARRAY['occupied_by','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['occupied_by','version','updated_by','updated_at']) THEN RAISE EXCEPTION 'CO_LOCATION_UNRELATED_CHANGE' USING ERRCODE='23514';END IF;
  END IF;END IF;
  IF (to_jsonb(NEW)-ARRAY['code','name','name_en','active','x','y','width','height','occupied_by','version','updated_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['code','name','name_en','active','x','y','width','height','occupied_by','version','updated_by','updated_at']) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'CO_LOCATION_IDENTITY_VERSION' USING ERRCODE='23514';END IF;
 END IF;
 IF NOT co_location_authorized(NEW.updated_by,permission,NEW.project_id,NEW.warehouse_id) OR NOT EXISTS(SELECT 1 FROM warehouses WHERE id=NEW.warehouse_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'CO_LOCATION_SCOPE_PERMISSION' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='co_locations' THEN
  IF permission='co:location-manage' AND NEW.active THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('co-layout:'||NEW.warehouse_id::text,0));
   IF EXISTS(SELECT 1 FROM co_locations a WHERE a.warehouse_id=NEW.warehouse_id AND a.id<>NEW.id AND a.active AND a.x<NEW.x+NEW.width AND a.x+a.width>NEW.x AND a.y<NEW.y+NEW.height AND a.y+a.height>NEW.y) THEN RAISE EXCEPTION 'CO_LOCATION_OVERLAP' USING ERRCODE='23514';END IF;
  END IF;
  IF TG_OP='INSERT' AND NEW.occupied_by IS NOT NULL THEN RAISE EXCEPTION 'CO_LOCATION_INSERT_OCCUPIED' USING ERRCODE='23514';END IF;
  IF NEW.occupied_by IS NOT NULL AND(NOT NEW.active OR NOT EXISTS(SELECT 1 FROM co_preparations p WHERE p.id=NEW.occupied_by AND p.project_id=NEW.project_id AND p.warehouse_id=NEW.warehouse_id AND p.status='RECEIVED')) THEN RAISE EXCEPTION 'CO_LOCATION_BATCH_SCOPE' USING ERRCODE='23514';END IF;
  IF NOT NEW.active AND EXISTS(SELECT 1 FROM co_positions WHERE location_id=NEW.id) THEN RAISE EXCEPTION 'CO_LOCATION_OCCUPIED' USING ERRCODE='23514';END IF;
 ELSE
  IF NOT NEW.active AND EXISTS(SELECT 1 FROM co_locations l JOIN co_positions p ON p.location_id=l.id WHERE l.zone_id=NEW.id) THEN RAISE EXCEPTION 'CO_ZONE_OCCUPIED' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_zone_guard BEFORE INSERT OR UPDATE OR DELETE ON co_zones FOR EACH ROW EXECUTE FUNCTION co_location_guard();
CREATE TRIGGER co_location_guard BEFORE INSERT OR UPDATE OR DELETE ON co_locations FOR EACH ROW EXECUTE FUNCTION co_location_guard();
CREATE FUNCTION co_position_guard() RETURNS trigger LANGUAGE plpgsql AS $$DECLARE p co_preparations;w co_work_batches;l co_locations;BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_POSITION_NO_DELETE' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN IF NEW.location_id IS NOT NULL OR NEW.version<>1 OR NEW.updated_by IS NOT NULL THEN RAISE EXCEPTION 'CO_POSITION_INIT_ONLY' USING ERRCODE='23514';END IF;RETURN NEW;END IF;
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id FOR UPDATE;
 SELECT * INTO w FROM co_work_batches WHERE preparation_id=p.id FOR UPDATE;
 IF NEW.bag_id<>OLD.bag_id OR NEW.preparation_id<>OLD.preparation_id OR NEW.version<>OLD.version+1 OR NEW.location_id IS NOT DISTINCT FROM OLD.location_id OR p.status<>'RECEIVED' OR w.status NOT IN('PREPARING','COMPLETED') OR w.amendment_status='PENDING' OR NOT co_location_authorized(NEW.updated_by,'co:locate',p.project_id,p.warehouse_id) THEN RAISE EXCEPTION 'CO_POSITION_STATE_PERMISSION' USING ERRCODE='23514';END IF;
 IF NEW.location_id IS NOT NULL THEN
  SELECT * INTO l FROM co_locations WHERE id=NEW.location_id FOR UPDATE;
  PERFORM id FROM co_zones WHERE id=l.zone_id FOR SHARE;
  IF l.id IS NULL OR l.project_id<>p.project_id OR l.warehouse_id<>p.warehouse_id OR NOT l.active OR l.occupied_by IS DISTINCT FROM p.id OR NOT EXISTS(SELECT 1 FROM co_zones z WHERE z.id=l.zone_id AND z.active) THEN RAISE EXCEPTION 'CO_POSITION_SCOPE_OCCUPANCY' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_position_guard BEFORE INSERT OR UPDATE OR DELETE ON co_positions FOR EACH ROW EXECUTE FUNCTION co_position_guard();
CREATE FUNCTION co_position_initialize() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN INSERT INTO public.co_positions(bag_id,preparation_id) VALUES(NEW.bag_id,NEW.preparation_id);RETURN NEW;END$$;
CREATE TRIGGER co_position_on_receipt AFTER INSERT ON co_inventory FOR EACH ROW EXECUTE FUNCTION co_position_initialize();
CREATE FUNCTION co_location_integrity() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF EXISTS(SELECT 1 FROM co_locations l JOIN co_zones z ON z.id=l.zone_id WHERE l.occupied_by IS NOT NULL AND(NOT l.active OR NOT z.active)) THEN RAISE EXCEPTION 'CO_LOCATION_DISABLED_OCCUPIED' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM co_locations l WHERE l.occupied_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM co_positions p WHERE p.location_id=l.id AND p.preparation_id=l.occupied_by)) THEN RAISE EXCEPTION 'CO_LOCATION_EMPTY_RESERVATION' USING ERRCODE='23514';END IF;RETURN NULL;
END$$;
CREATE CONSTRAINT TRIGGER co_location_integrity AFTER INSERT OR UPDATE ON co_locations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_location_integrity();
CREATE CONSTRAINT TRIGGER co_zone_integrity AFTER UPDATE ON co_zones DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_location_integrity();
CREATE CONSTRAINT TRIGGER co_position_integrity AFTER UPDATE ON co_positions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION co_location_integrity();
CREATE FUNCTION co_location_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$BEGIN
 IF coalesce(length(trim(current_setting('musonoi.co_location_reason',true))),0)=0 THEN RAISE EXCEPTION 'CO_LOCATION_REASON_REQUIRED' USING ERRCODE='23514';END IF;
 INSERT INTO public.co_location_events(entity_type,entity_id,preparation_id,actor_id,before_data,after_data,reason) VALUES(TG_TABLE_NAME,CASE WHEN TG_TABLE_NAME='co_positions' THEN (to_jsonb(NEW)->>'bag_id')::uuid ELSE (to_jsonb(NEW)->>'id')::uuid END,CASE WHEN TG_TABLE_NAME='co_positions' THEN (to_jsonb(NEW)->>'preparation_id')::uuid ELSE NULL END,NEW.updated_by,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW),current_setting('musonoi.co_location_reason',true));RETURN NEW;
END$$;
CREATE TRIGGER co_zone_audit AFTER INSERT OR UPDATE ON co_zones FOR EACH ROW EXECUTE FUNCTION co_location_audit();
CREATE TRIGGER co_location_audit AFTER INSERT OR UPDATE ON co_locations FOR EACH ROW EXECUTE FUNCTION co_location_audit();
CREATE TRIGGER co_position_audit AFTER UPDATE ON co_positions FOR EACH ROW EXECUTE FUNCTION co_location_audit();
INSERT INTO permissions(code) VALUES('co:location-manage'),('co:locate');
INSERT INTO role_permissions SELECT r.code,p.code FROM roles r CROSS JOIN permissions p WHERE p.code IN('co:location-manage','co:locate') AND(r.code='admin' OR(r.code='logistics_manager') OR(r.code='site_supervisor' AND p.code='co:locate')) AND EXISTS(SELECT 1 FROM role_permissions a WHERE a.role_code=r.code AND a.permission_code='co:read');
INSERT INTO role_permission_caps SELECT role_code,permission_code FROM role_permissions WHERE permission_code IN('co:location-manage','co:locate');
GRANT SELECT,INSERT,UPDATE ON co_zones,co_locations TO musonoi_app;
GRANT SELECT,UPDATE ON co_positions TO musonoi_app;
GRANT SELECT ON co_location_events TO musonoi_app;
