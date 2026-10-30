-- Shared row locks close races between return/move/receipt confirmation and parent deactivation.
CREATE FUNCTION v23_position_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE p locations;BEGIN
 IF NEW.physical_status<>'IN_STOCK' THEN RETURN NEW;END IF;
 IF TG_OP='UPDATE' AND NEW.location_id=OLD.location_id AND OLD.physical_status='IN_STOCK' THEN RETURN NEW;END IF;
 SELECT * INTO p FROM locations WHERE id=NEW.location_id AND project_id=NEW.project_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inventory destination inactive or mismatched' USING ERRCODE='23514';END IF;
 PERFORM 1 FROM warehouses WHERE id=p.warehouse_id AND project_id=NEW.project_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inventory warehouse inactive' USING ERRCODE='23514';END IF;
 IF p.yard_id IS NOT NULL THEN PERFORM 1 FROM yards WHERE id=p.yard_id AND warehouse_id=p.warehouse_id AND project_id=NEW.project_id AND active FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'Inventory yard inactive' USING ERRCODE='23514';END IF;END IF;RETURN NEW;END $$;
CREATE TRIGGER inventory_position BEFORE INSERT OR UPDATE ON bundles FOR EACH ROW EXECUTE FUNCTION v23_position_guard();
CREATE FUNCTION move_item_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM 1 FROM stock_moves WHERE id=NEW.move_id AND status='DRAFT' FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Confirmed move immutable' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER move_item_insert BEFORE INSERT ON stock_move_items FOR EACH ROW EXECUTE FUNCTION move_item_insert_guard();
