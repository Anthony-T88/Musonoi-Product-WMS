-- Snapshot future activity identities without rewriting any historical event.
CREATE FUNCTION workflow_identity_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE identity_record record;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.actor_name_snapshot,NEW.actor_role_snapshot,NEW.actor_role_name_snapshot,NEW.actor_role_name_en_snapshot)
     IS DISTINCT FROM (OLD.actor_name_snapshot,OLD.actor_role_snapshot,OLD.actor_role_name_snapshot,OLD.actor_role_name_en_snapshot) THEN
   RAISE EXCEPTION 'WORKFLOW_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT u.display_name,u.role_code,r.name,r.name_en INTO identity_record
 FROM users u LEFT JOIN roles r ON r.code=u.role_code WHERE u.id=NEW.actor_id;
 NEW.actor_name_snapshot:=identity_record.display_name;
 NEW.actor_role_snapshot:=identity_record.role_code;
 NEW.actor_role_name_snapshot:=identity_record.name;
 NEW.actor_role_name_en_snapshot:=identity_record.name_en;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION workflow_identity_snapshot() FROM PUBLIC;
DO $$ DECLARE source_table text; BEGIN
 FOREACH source_table IN ARRAY ARRAY[
  'audit_logs','workflow_reviews','inventory_events','lot_work_history',
  'loading_plan_match_history','stocktake_steps','adjustment_steps','outbound_steps',
  'outbound_correction_steps','co_events','co_work_events','co_loading_events',
  'co_execution_events','co_stocktake_events','co_sales_events','co_location_events',
  'gate_events','bundle_metadata_history','exception_steps','exception_rule_history','label_events'
 ] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN actor_name_snapshot text, ADD COLUMN actor_role_snapshot text, ADD COLUMN actor_role_name_snapshot text, ADD COLUMN actor_role_name_en_snapshot text',source_table);
  EXECUTE format('CREATE TRIGGER zz_workflow_identity_snapshot BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION workflow_identity_snapshot()',source_table);
 END LOOP;
END $$;
