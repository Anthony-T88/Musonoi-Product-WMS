-- TEST only. Initialized defaults can be rebuilt; actual work and history cannot.
DO $$BEGIN
 IF(SELECT environment FROM system_info WHERE singleton)<>'test' THEN RAISE EXCEPTION 'TEST_ONLY';END IF;
 IF EXISTS(SELECT 1 FROM co_work_events) OR EXISTS(SELECT 1 FROM co_work_batches WHERE version<>1 OR status<>'PREPARING' OR cobalt_grade_pct IS NOT NULL OR arecoms_input IS NOT NULL OR amendment_status<>'NONE') OR EXISTS(SELECT 1 FROM co_bag_work WHERE version<>1 OR actual_gross_kg IS NOT NULL OR seal_no IS NOT NULL OR sampled) OR EXISTS(SELECT 1 FROM co_inventory WHERE status<>'PREPARING') OR EXISTS(SELECT 1 FROM co_requests WHERE route LIKE '%/work/%') THEN RAISE EXCEPTION 'CO_WORK_POPULATED_ROLLBACK_REFUSED';END IF;
END$$;
LOCK TABLE role_permissions IN ACCESS EXCLUSIVE MODE;
ALTER TABLE role_permissions DISABLE TRIGGER administrator_permissions;
DELETE FROM role_permission_caps WHERE permission_code IN('co:work-edit','co:work-submit','co:completion-review','co:amend-request','co:amend-review');
DELETE FROM role_permissions WHERE permission_code IN('co:work-edit','co:work-submit','co:completion-review','co:amend-request','co:amend-review');
DELETE FROM permissions WHERE code IN('co:work-edit','co:work-submit','co:completion-review','co:amend-request','co:amend-review');
ALTER TABLE role_permissions ENABLE TRIGGER administrator_permissions;
DROP TRIGGER co_work_on_receipt ON co_inventory;
CREATE OR REPLACE TRIGGER co_inventory_immutable BEFORE UPDATE OR DELETE ON co_inventory FOR EACH ROW EXECUTE FUNCTION co_immutable();
ALTER TABLE co_inventory DROP CONSTRAINT co_inventory_status_check;
ALTER TABLE co_inventory ADD CONSTRAINT co_inventory_status_check CHECK(status='PREPARING');
REVOKE UPDATE(status) ON co_inventory FROM musonoi_app;
DROP TABLE co_work_events,co_bag_work,co_work_batches;
DROP FUNCTION co_work_initialize(),co_work_authorized(uuid,text,uuid,text),co_work_batch_guard(),co_bag_work_guard(),co_inventory_work_guard(),co_work_complete_guard(),co_work_audit();
DELETE FROM schema_migrations WHERE version='140_v39_cobalt_work.sql';
