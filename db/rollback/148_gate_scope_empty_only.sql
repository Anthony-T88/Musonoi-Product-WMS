DO $$BEGIN IF EXISTS(SELECT 1 FROM gate_permits) OR EXISTS(SELECT 1 FROM users WHERE role_code IN('sales_manager','sales_operator')) THEN RAISE EXCEPTION 'GATE_NEW_DATA_EXISTS_RETAIN_SCHEMA_AND_FIX_FORWARD';END IF;END$$;
CREATE OR REPLACE FUNCTION gate_permit_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GATE_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN IF to_jsonb(NEW)-ARRAY['version','state','current_revision']<>to_jsonb(OLD)-ARRAY['version','state','current_revision'] OR OLD.state='EXITED' OR NEW.version<>OLD.version+1 OR NEW.current_revision NOT IN(OLD.current_revision,OLD.current_revision+1) THEN RAISE EXCEPTION 'GATE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;END IF;
 IF NOT gate_actor_scope(NEW,NEW.created_by) OR NOT gate_source_ready(NEW) THEN RAISE EXCEPTION 'GATE_FINAL_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
DELETE FROM schema_migrations WHERE version='148_gate_current_actor_scope.sql';
