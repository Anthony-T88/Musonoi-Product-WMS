-- A frozen document does not lose its validity when its creator changes assignment.
-- Current actor scope is checked by APIs and gate_exit_guard; retain all source, identity and version checks.
CREATE OR REPLACE FUNCTION gate_permit_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GATE_HISTORY_IMMUTABLE' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' THEN IF to_jsonb(NEW)-ARRAY['version','state','current_revision']<>to_jsonb(OLD)-ARRAY['version','state','current_revision'] OR OLD.state='EXITED' OR NEW.version<>OLD.version+1 OR NEW.current_revision NOT IN(OLD.current_revision,OLD.current_revision+1) THEN RAISE EXCEPTION 'GATE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';END IF;END IF;
 IF (TG_OP='INSERT' AND NOT gate_actor_scope(NEW,NEW.created_by)) OR NOT gate_source_ready(NEW) THEN RAISE EXCEPTION 'GATE_FINAL_APPROVAL_REQUIRED' USING ERRCODE='23514';END IF;RETURN NEW;
END$$;
