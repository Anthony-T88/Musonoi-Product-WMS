-- Run inside a transaction, in local TEST only. Never remove used location history.
SELECT pg_advisory_xact_lock(21001);
SELECT pg_advisory_xact_lock(21002);
LOCK TABLE co_zones,co_locations,co_positions,co_location_events IN ACCESS EXCLUSIVE MODE;
DO $$BEGIN
 IF (SELECT environment FROM system_info)<>'test' OR EXISTS(SELECT 1 FROM co_zones) OR EXISTS(SELECT 1 FROM co_locations) OR EXISTS(SELECT 1 FROM co_location_events) OR EXISTS(SELECT 1 FROM co_positions WHERE location_id IS NOT NULL OR version<>1 OR updated_by IS NOT NULL) OR EXISTS(SELECT 1 FROM co_requests WHERE route LIKE '%/cobalt/stock/%') THEN RAISE EXCEPTION 'V40_USED_DATA_ROLLBACK_REFUSED';END IF;
END$$;
DROP TRIGGER co_position_on_receipt ON co_inventory;
DROP TABLE co_location_events,co_positions,co_locations,co_zones;
DROP FUNCTION co_location_audit(),co_location_integrity(),co_position_initialize(),co_position_guard(),co_location_guard(),co_location_authorized(uuid,text,uuid,uuid);
ALTER TABLE role_permissions DISABLE TRIGGER administrator_permissions;
DELETE FROM role_permissions WHERE permission_code IN('co:locate','co:location-manage');
ALTER TABLE role_permissions ENABLE TRIGGER administrator_permissions;
DELETE FROM role_permission_caps WHERE permission_code IN('co:locate','co:location-manage');
DELETE FROM permissions WHERE code IN('co:locate','co:location-manage');
DELETE FROM schema_migrations WHERE version='141_v40_cobalt_locations.sql';
