-- TEST only; populated cobalt models must be retained during a code rollback.
DO $$BEGIN
 IF (SELECT environment FROM system_info WHERE singleton)<>'test' THEN RAISE EXCEPTION 'TEST_ONLY';END IF;
 IF EXISTS(SELECT 1 FROM co_preparations) OR EXISTS(SELECT 1 FROM co_production_batches) OR EXISTS(SELECT 1 FROM co_number_counters) OR EXISTS(SELECT 1 FROM co_requests) THEN RAISE EXCEPTION 'CO_POPULATED_ROLLBACK_REFUSED';END IF;
END$$;
-- The original admin guard rejects even removal of newly-added grants. Hold an
-- exclusive lock and suspend only that trigger for the six V3.8 grants below.
LOCK TABLE role_permissions IN ACCESS EXCLUSIVE MODE;
ALTER TABLE role_permissions DISABLE TRIGGER administrator_permissions;
DELETE FROM role_permission_caps WHERE permission_code IN('co:read','co:create','co:submit','co:site-review','co:production-review','co:withdraw');
DELETE FROM role_permissions WHERE permission_code IN('co:read','co:create','co:submit','co:site-review','co:production-review','co:withdraw');
DELETE FROM permissions WHERE code IN('co:read','co:create','co:submit','co:site-review','co:production-review','co:withdraw');
ALTER TABLE role_permissions ENABLE TRIGGER administrator_permissions;
DROP TABLE co_inventory,co_requests,co_events,co_bags,co_preparation_lines,co_production_batches,co_preparations,co_number_counters;
DROP SEQUENCE co_preparation_number;
DROP FUNCTION co_immutable(),co_counter_guard(),co_document_guard(),co_bag_identity(),co_receipt_guard(),co_document_complete();
DELETE FROM schema_migrations WHERE version='139_v38_cobalt_preparation.sql';
