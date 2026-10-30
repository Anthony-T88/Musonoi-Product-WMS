DO $$ DECLARE definition text;BEGIN
 SELECT pg_get_functiondef('outbound_creation_guard()'::regprocedure) INTO definition;
 definition:=replace(definition,$old$PERFORM v23_require(NEW.created_by,'load:write',l.project_id,l.customer_id,NULL);$old$,$new$IF l.loaded_at>now()+interval '1 minute' OR w.weighed_at>now()+interval '1 minute' THEN RAISE EXCEPTION 'Loading and weighing cannot be future evidence' USING ERRCODE='23514';END IF;PERFORM v23_require(NEW.created_by,'load:write',l.project_id,l.customer_id,x.warehouse_id) FROM loading_items z JOIN bundles b ON b.id=z.bundle_id JOIN locations x ON x.id=b.location_id WHERE z.loading_id=l.id;$new$);EXECUTE definition;
 SELECT pg_get_functiondef('outbound_action(uuid,uuid,integer,text,jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition,$old$WHEN 'packing' THEN 'outbound:packing'$old$,$new$WHEN 'reject' THEN CASE d.status WHEN 'CREATED' THEN 'outbound:packing' WHEN 'PACKING_CONFIRMED' THEN 'outbound:commerce' ELSE 'outbound:gate' END WHEN 'packing' THEN 'outbound:packing'$new$);
 definition:=replace(definition,$old$ELSIF action='cancel' THEN$old$,$new$ELSIF action IN('cancel','reject') THEN$new$);
 definition:=replace(definition,$old$VALUES(doc,action,'APPROVED',note,payload,actor)$old$,$new$VALUES(doc,action,CASE WHEN action='reject' THEN 'REJECTED' ELSE 'APPROVED' END,note,payload,actor)$new$);EXECUTE definition;
END $$;
CREATE FUNCTION v23_draft_item_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE state text;BEGIN
 IF TG_TABLE_NAME='sampling_items' THEN SELECT status INTO state FROM sampling_batches WHERE id=NEW.sample_id FOR UPDATE;ELSE SELECT status INTO state FROM weighings WHERE id=NEW.weighing_id FOR UPDATE;END IF;
 IF state<>'DRAFT' THEN RAISE EXCEPTION 'Cannot append items to registered workflow document' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER sampling_item_insert BEFORE INSERT ON sampling_items FOR EACH ROW EXECUTE FUNCTION v23_draft_item_guard();
CREATE TRIGGER weighing_item_insert BEFORE INSERT ON weighing_items FOR EACH ROW EXECUTE FUNCTION v23_draft_item_guard();
