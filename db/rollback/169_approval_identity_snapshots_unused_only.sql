-- Only usable before any new identity snapshot has been recorded.
DO $$ DECLARE source_table text; occupied boolean; BEGIN
 FOREACH source_table IN ARRAY ARRAY['audit_logs','workflow_reviews','inventory_events','lot_work_history','loading_plan_match_history','stocktake_steps','adjustment_steps','outbound_steps','outbound_correction_steps','co_events','co_work_events','co_loading_events','co_execution_events','co_stocktake_events','co_sales_events','co_location_events','gate_events','bundle_metadata_history','exception_steps','exception_rule_history','label_events'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE actor_name_snapshot IS NOT NULL OR actor_role_snapshot IS NOT NULL)',source_table) INTO occupied;
  IF occupied THEN RAISE EXCEPTION 'Recorded approval identities must be retained; snapshot rollback refused';END IF;
 END LOOP;
 FOREACH source_table IN ARRAY ARRAY['audit_logs','workflow_reviews','inventory_events','lot_work_history','loading_plan_match_history','stocktake_steps','adjustment_steps','outbound_steps','outbound_correction_steps','co_events','co_work_events','co_loading_events','co_execution_events','co_stocktake_events','co_sales_events','co_location_events','gate_events','bundle_metadata_history','exception_steps','exception_rule_history','label_events'] LOOP
  EXECUTE format('DROP TRIGGER zz_workflow_identity_snapshot ON %I',source_table);
  EXECUTE format('ALTER TABLE %I DROP COLUMN actor_name_snapshot, DROP COLUMN actor_role_snapshot, DROP COLUMN actor_role_name_snapshot, DROP COLUMN actor_role_name_en_snapshot',source_table);
 END LOOP;
END $$;
DROP FUNCTION workflow_identity_snapshot();
