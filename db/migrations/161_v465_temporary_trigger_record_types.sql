-- Resolve table-specific record fields only inside the matching trigger branch.
CREATE OR REPLACE FUNCTION co_temporary_operation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p uuid;z uuid;is_temp boolean;
BEGIN
 IF TG_TABLE_NAME='co_locations' THEN IF TG_OP='UPDATE' AND NEW.occupied_by IS NOT NULL
 AND EXISTS(SELECT 1 FROM co_temporary_points t WHERE t.location_id=NEW.id AND(t.status<>'ACTIVE' OR t.preparation_id<>NEW.occupied_by))
 THEN RAISE EXCEPTION 'CO_TEMP_POINT_CLOSED' USING ERRCODE='23514';END IF;END IF;
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
