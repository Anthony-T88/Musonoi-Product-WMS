-- Add reviewed site configuration and scoped temporary locations. Existing stock
-- facts, fixed-location permissions, movement guards and audit triggers remain.
CREATE TABLE co_stock_map_configs(
 warehouse_id uuid PRIMARY KEY REFERENCES warehouses(id),project_id uuid NOT NULL REFERENCES projects(id),
 layout_key text NOT NULL,temp_zone_id uuid NOT NULL REFERENCES co_zones(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE co_temporary_points(
 location_id uuid PRIMARY KEY REFERENCES co_locations(id),preparation_id uuid NOT NULL REFERENCES co_preparations(id),
 project_id uuid NOT NULL REFERENCES projects(id),warehouse_id uuid NOT NULL REFERENCES warehouses(id),
 description text NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','CLOSED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),closed_by uuid REFERENCES users(id),closed_at timestamptz,
 CHECK((status='ACTIVE' AND closed_by IS NULL AND closed_at IS NULL) OR(status='CLOSED' AND closed_by IS NOT NULL AND closed_at IS NOT NULL)));
CREATE INDEX co_temporary_points_batch ON co_temporary_points(preparation_id,status);
CREATE SEQUENCE co_temporary_point_number;
INSERT INTO permissions(code) VALUES('co:temp-locate');
INSERT INTO role_permissions(role_code,permission_code)
 SELECT DISTINCT r.code,'co:temp-locate' FROM roles r JOIN role_permissions p ON p.role_code=r.code
 WHERE p.permission_code IN('co:work-edit','co:locate','co:location-manage')
 AND r.code IN('admin','logistics_manager','site_supervisor','logistics_field_operator','logistics_office_operator');
INSERT INTO role_permission_caps SELECT role_code,permission_code FROM role_permissions WHERE permission_code='co:temp-locate';

-- The local flag is set only by the scoped temporary operation transaction.
-- Additional row guards below prevent it from authorizing fixed-to-fixed moves,
-- zone edits or any structural edit to an existing fixed location.
CREATE OR REPLACE FUNCTION co_location_authorized(actor uuid,permission text,project uuid,warehouse uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u JOIN role_permissions r ON r.role_code=u.role_code
 WHERE u.id=actor AND u.active AND u.deleted_at IS NULL
 AND(r.permission_code=permission OR(permission IN('co:locate','co:location-manage')
 AND current_setting('musonoi.co_temporary_operation',true)='1' AND r.permission_code='co:temp-locate'))
 AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=u.id AND s.project_id=project
 AND(s.warehouse_id IS NULL OR s.warehouse_id=warehouse) AND s.customer_id IS NULL))$$;

CREATE FUNCTION co_temporary_row_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p co_preparations;l co_locations;cfg co_stock_map_configs;actor uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CO_TEMP_NO_DELETE' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='co_stock_map_configs' THEN
  IF NOT co_location_authorized(NEW.updated_by,'co:location-manage',NEW.project_id,NEW.warehouse_id)
  OR current_setting('musonoi.co_temporary_operation',true)='1'
  OR NOT EXISTS(SELECT 1 FROM co_zones z WHERE z.id=NEW.temp_zone_id AND z.project_id=NEW.project_id AND z.warehouse_id=NEW.warehouse_id AND z.code='CO-TEMP' AND z.active)
  THEN RAISE EXCEPTION 'CO_MAP_CONFIG_PERMISSION' USING ERRCODE='23514';END IF;
  IF TG_OP='UPDATE' AND((to_jsonb(NEW)-ARRAY['version','updated_by','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['version','updated_by','updated_at']) OR NEW.version<>OLD.version+1)
  THEN RAISE EXCEPTION 'CO_MAP_CONFIG_IMMUTABLE' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 SELECT * INTO p FROM co_preparations WHERE id=NEW.preparation_id;
 SELECT * INTO l FROM co_locations WHERE id=NEW.location_id;
 SELECT * INTO cfg FROM co_stock_map_configs WHERE warehouse_id=NEW.warehouse_id;
 IF p.id IS NULL OR l.id IS NULL OR cfg.warehouse_id IS NULL OR l.zone_id<>cfg.temp_zone_id
 OR p.project_id<>NEW.project_id OR p.warehouse_id<>NEW.warehouse_id
 OR l.project_id<>p.project_id OR l.warehouse_id<>p.warehouse_id
 THEN RAISE EXCEPTION 'CO_TEMP_SCOPE' USING ERRCODE='23514';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'ACTIVE' OR NEW.version<>1 OR NOT co_location_authorized(NEW.updated_by,'co:temp-locate',NEW.project_id,NEW.warehouse_id)
  OR current_setting('musonoi.co_temporary_operation',true) IS DISTINCT FROM '1'
  THEN RAISE EXCEPTION 'CO_TEMP_CREATE_PERMISSION' USING ERRCODE='23514';END IF;
 ELSE
  IF OLD.status<>'ACTIVE' OR NEW.status<>'CLOSED' OR NEW.version<>OLD.version+1
  OR(to_jsonb(NEW)-ARRAY['status','version','updated_by','closed_by','closed_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','version','updated_by','closed_by','closed_at'])
  OR EXISTS(SELECT 1 FROM co_positions WHERE location_id=NEW.location_id)
  OR NEW.updated_by IS DISTINCT FROM NEW.closed_by
  OR NOT(co_location_authorized(NEW.updated_by,'co:temp-locate',NEW.project_id,NEW.warehouse_id)
    OR co_location_authorized(NEW.updated_by,'co:locate',NEW.project_id,NEW.warehouse_id)
    OR EXISTS(SELECT 1 FROM co_outbounds o WHERE o.preparation_id=p.id AND o.posted_by=NEW.updated_by))
  THEN RAISE EXCEPTION 'CO_TEMP_CLOSE_STATE_PERMISSION' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_map_config_guard BEFORE INSERT OR UPDATE OR DELETE ON co_stock_map_configs FOR EACH ROW EXECUTE FUNCTION co_temporary_row_guard();
CREATE TRIGGER co_temp_point_guard BEFORE INSERT OR UPDATE OR DELETE ON co_temporary_points FOR EACH ROW EXECUTE FUNCTION co_temporary_row_guard();

CREATE FUNCTION co_temporary_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid;z uuid;is_temp boolean;
BEGIN
 IF TG_TABLE_NAME='co_locations' AND TG_OP='UPDATE' AND NEW.occupied_by IS NOT NULL
 AND EXISTS(SELECT 1 FROM co_temporary_points t WHERE t.location_id=NEW.id AND(t.status<>'ACTIVE' OR t.preparation_id<>NEW.occupied_by))
 THEN RAISE EXCEPTION 'CO_TEMP_POINT_CLOSED' USING ERRCODE='23514';END IF;
 IF current_setting('musonoi.co_temporary_operation',true) IS DISTINCT FROM '1' THEN RETURN NEW;END IF;
 p:=nullif(current_setting('musonoi.co_temporary_preparation',true),'')::uuid;
 IF p IS NULL THEN RAISE EXCEPTION 'CO_TEMP_OPERATION_CONTEXT' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='co_zones' THEN RAISE EXCEPTION 'CO_TEMP_FIXED_CONFIG_FORBIDDEN' USING ERRCODE='23514';END IF;
 IF TG_TABLE_NAME='co_positions' THEN
  IF NEW.preparation_id<>p OR NOT EXISTS(SELECT 1 FROM co_temporary_points t WHERE t.preparation_id=p AND t.status='ACTIVE' AND t.location_id IN(OLD.location_id,NEW.location_id))
  THEN RAISE EXCEPTION 'CO_TEMP_FIXED_MOVE_FORBIDDEN' USING ERRCODE='23514';END IF;RETURN NEW;
 END IF;
 SELECT temp_zone_id INTO z FROM co_stock_map_configs WHERE warehouse_id=NEW.warehouse_id;
 IF TG_OP='INSERT' THEN
  IF NEW.zone_id IS DISTINCT FROM z OR NEW.code NOT LIKE 'CO-TMP-%' OR NEW.occupied_by IS NOT NULL
  THEN RAISE EXCEPTION 'CO_TEMP_FIXED_CONFIG_FORBIDDEN' USING ERRCODE='23514';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['occupied_by','version','updated_by','updated_at']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['occupied_by','version','updated_by','updated_at'])
  OR NOT(OLD.occupied_by IS NOT DISTINCT FROM p OR NEW.occupied_by IS NOT DISTINCT FROM p)
  THEN RAISE EXCEPTION 'CO_TEMP_FIXED_CONFIG_FORBIDDEN' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END$$;
CREATE TRIGGER co_temp_location_boundary AFTER INSERT OR UPDATE ON co_locations FOR EACH ROW EXECUTE FUNCTION co_temporary_operation_guard();
CREATE TRIGGER co_temp_zone_boundary AFTER INSERT OR UPDATE ON co_zones FOR EACH ROW EXECUTE FUNCTION co_temporary_operation_guard();
CREATE TRIGGER co_temp_position_boundary AFTER UPDATE ON co_positions FOR EACH ROW EXECUTE FUNCTION co_temporary_operation_guard();

CREATE FUNCTION co_temporary_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE data jsonb;BEGIN
 data:=to_jsonb(NEW);
 INSERT INTO public.co_location_events(entity_type,entity_id,preparation_id,actor_id,before_data,after_data,reason)
 VALUES(TG_TABLE_NAME,coalesce((data->>'location_id')::uuid,(data->>'warehouse_id')::uuid),(data->>'preparation_id')::uuid,
 NEW.updated_by,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,data,
 coalesce(nullif(current_setting('musonoi.co_location_reason',true),''),'Temporary point occupancy ended after physical movement'));
 RETURN NEW;
END$$;
CREATE TRIGGER co_map_config_audit AFTER INSERT OR UPDATE ON co_stock_map_configs FOR EACH ROW EXECUTE FUNCTION co_temporary_audit();
CREATE TRIGGER co_temp_point_audit AFTER INSERT OR UPDATE ON co_temporary_points FOR EACH ROW EXECUTE FUNCTION co_temporary_audit();

CREATE FUNCTION co_close_empty_temporary_points() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.co_temporary_points t SET status='CLOSED',version=t.version+1,closed_at=clock_timestamp(),
 closed_by=(SELECT n.updated_by FROM new_positions n JOIN old_positions o ON o.bag_id=n.bag_id WHERE o.location_id=t.location_id ORDER BY n.bag_id LIMIT 1),
 updated_by=(SELECT n.updated_by FROM new_positions n JOIN old_positions o ON o.bag_id=n.bag_id WHERE o.location_id=t.location_id ORDER BY n.bag_id LIMIT 1)
 WHERE t.status='ACTIVE' AND t.location_id IN(SELECT location_id FROM old_positions WHERE location_id IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM public.co_positions p WHERE p.location_id=t.location_id);
 RETURN NULL;
END$$;
CREATE TRIGGER co_temp_close_after_move AFTER UPDATE ON co_positions
 REFERENCING OLD TABLE AS old_positions NEW TABLE AS new_positions
 FOR EACH STATEMENT EXECUTE FUNCTION co_close_empty_temporary_points();
GRANT SELECT,INSERT,UPDATE ON co_stock_map_configs,co_temporary_points TO musonoi_app;
GRANT USAGE ON SEQUENCE co_temporary_point_number TO musonoi_app;
