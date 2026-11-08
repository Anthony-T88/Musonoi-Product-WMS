DO $$BEGIN
 IF EXISTS(SELECT 1 FROM schema_migrations WHERE version='148_gate_current_actor_scope.sql') THEN RAISE EXCEPTION 'GATE_ROLLBACK_148_FIRST';END IF;
 IF EXISTS(SELECT 1 FROM gate_permits) OR EXISTS(SELECT 1 FROM gate_printers) OR EXISTS(SELECT 1 FROM gate_events) OR EXISTS(SELECT 1 FROM gate_requests) OR EXISTS(SELECT 1 FROM users WHERE role_code IN('sales_manager','sales_operator')) THEN RAISE EXCEPTION 'GATE_NEW_DATA_EXISTS_RETAIN_SCHEMA_AND_FIX_FORWARD';END IF;
END$$;
DROP TABLE gate_requests,gate_events,gate_exits,gate_print_jobs,gate_permit_revisions,gate_printers,gate_permits CASCADE;
DROP FUNCTION IF EXISTS gate_source_ready,gate_actor_scope,gate_permit_guard,gate_exit_guard,gate_complete_guard,gate_history_immutable CASCADE;
DROP SEQUENCE gate_permit_numbers;
DELETE FROM role_permissions WHERE role_code IN('sales_manager','sales_operator');
DELETE FROM role_permission_caps WHERE role_code IN('sales_manager','sales_operator');
DELETE FROM roles WHERE code IN('sales_manager','sales_operator');
-- Administrator permission protection is never disabled. The five inert permission codes and admin grants remain; old code has no corresponding handlers.

DELETE FROM schema_migrations WHERE version='147_gate_permits_sales_print.sql';
