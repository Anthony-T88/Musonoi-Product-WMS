CREATE OR REPLACE FUNCTION v31_plan_lots_deferred() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='loading_plan_documents' THEN PERFORM v31_check_plan_lots(NEW.id);
 ELSIF TG_OP='DELETE' THEN PERFORM v31_check_plan_lots(OLD.document_id);
 ELSE PERFORM v31_check_plan_lots(NEW.document_id);END IF;RETURN NULL;END $$;
