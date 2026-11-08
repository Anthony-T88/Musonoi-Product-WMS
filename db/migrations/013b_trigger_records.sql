CREATE OR REPLACE FUNCTION v24_source_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE bid uuid;did uuid;tab text;BEGIN
 IF TG_TABLE_NAME='bundles' THEN PERFORM v24_capture_bundle(NEW.id);
 ELSIF TG_TABLE_NAME IN('reservations','loading_items','inventory_events') THEN PERFORM v24_capture_bundle(NEW.bundle_id);IF TG_TABLE_NAME='loading_items' THEN PERFORM v24_doc_save('loading_orders',NEW.loading_id);END IF;
 ELSIF TG_TABLE_NAME='sampling_items' THEN PERFORM v24_doc_save('sampling_batches',NEW.sample_id);
 ELSIF TG_TABLE_NAME='weighing_items' THEN PERFORM v24_doc_save('weighings',NEW.weighing_id);
 ELSE PERFORM v24_doc_save(TG_TABLE_NAME,NEW.id);IF TG_TABLE_NAME='loading_orders' THEN did:=NEW.id;ELSIF TG_TABLE_NAME='outbound_orders' THEN did:=NEW.loading_id;END IF;IF did IS NOT NULL THEN FOR bid IN SELECT bundle_id FROM loading_items WHERE loading_id=did LOOP PERFORM v24_capture_bundle(bid);END LOOP;END IF;END IF;RETURN NEW;END $$;
