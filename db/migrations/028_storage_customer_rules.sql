-- New writes cannot create mixed customer storage. Historical mixtures are reported, never rewritten.
CREATE FUNCTION storage_serial_gate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM pg_advisory_xact_lock(24000);RETURN NULL;END $$;
CREATE FUNCTION storage_touch_location(loc uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF loc IS NULL THEN RETURN;END IF;
 INSERT INTO storage_location_locks(location_id,revision) VALUES(loc,1) ON CONFLICT(location_id) DO UPDATE SET revision=storage_location_locks.revision+1;
 PERFORM 1 FROM locations WHERE id=loc FOR UPDATE;
END $$;
CREATE FUNCTION storage_row_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE loc uuid;BEGIN
 IF TG_TABLE_NAME='bundles' THEN
 IF TG_OP='UPDATE' AND(NEW.location_id,NEW.physical_status,NEW.net_weight) IS NOT DISTINCT FROM(OLD.location_id,OLD.physical_status,OLD.net_weight) THEN RETURN NEW;END IF;
 FOR loc IN SELECT DISTINCT x FROM unnest(CASE WHEN TG_OP='INSERT' THEN ARRAY[NEW.location_id] ELSE ARRAY[OLD.location_id,NEW.location_id] END) x ORDER BY x LOOP PERFORM storage_touch_location(loc);END LOOP;
 ELSIF TG_TABLE_NAME IN('reservations','loading_items') THEN
 SELECT location_id INTO loc FROM bundles WHERE id=NEW.bundle_id;PERFORM storage_touch_location(loc);
 ELSIF TG_TABLE_NAME='loading_orders' THEN
 IF NEW.status IS DISTINCT FROM OLD.status THEN FOR loc IN SELECT DISTINCT b.location_id FROM loading_items i JOIN bundles b ON b.id=i.bundle_id WHERE i.loading_id=NEW.id ORDER BY b.location_id LOOP PERFORM storage_touch_location(loc);END LOOP;END IF;
 ELSIF TG_TABLE_NAME='locations' THEN
 IF(NEW.max_bundles,NEW.max_net_weight) IS DISTINCT FROM(OLD.max_bundles,OLD.max_net_weight) THEN PERFORM storage_touch_location(NEW.id);END IF;
 END IF;RETURN NEW;END $$;
CREATE FUNCTION storage_assert_location(loc uuid,customer_check boolean DEFAULT true) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE n bigint;k bigint;w numeric;cap locations;BEGIN
 SELECT * INTO cap FROM locations WHERE id=loc;
 SELECT count(*),count(DISTINCT coalesce(p.customer_id,b.customer_id)),coalesce(sum(b.net_weight),0) INTO n,k,w
 FROM bundles b LEFT JOIN reservations r ON r.bundle_id=b.id AND r.released_at IS NULL LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN sales_plans p ON p.id=a.plan_id
 WHERE b.location_id=loc AND b.physical_status='IN_STOCK' AND NOT EXISTS(SELECT 1 FROM loading_items z JOIN loading_orders d ON d.id=z.loading_id WHERE z.bundle_id=b.id AND z.active AND d.status='LOADED');
 IF customer_check AND k>1 THEN RAISE EXCEPTION '货位客户不一致或存在历史混放，请先安排合法移库；锁定/释放不会绕过此规则' USING ERRCODE='23514';END IF;
 IF cap.max_bundles IS NOT NULL AND n>cap.max_bundles OR cap.max_net_weight IS NOT NULL AND w>cap.max_net_weight THEN RAISE EXCEPTION '货位最大捆数或最大净重容量超限' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION storage_deferred_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE bid uuid;loc uuid;BEGIN
 IF TG_TABLE_NAME='bundles' THEN
 IF TG_OP='UPDATE' AND(NEW.location_id,NEW.physical_status,NEW.net_weight) IS NOT DISTINCT FROM(OLD.location_id,OLD.physical_status,OLD.net_weight) THEN RETURN NULL;END IF;
 bid:=NEW.id;
 ELSIF TG_TABLE_NAME='reservations' THEN
 IF TG_OP='UPDATE' AND NEW.released_at IS NOT DISTINCT FROM OLD.released_at THEN RETURN NULL;END IF;bid:=NEW.bundle_id;
 ELSIF TG_TABLE_NAME='loading_items' THEN
 IF TG_OP='INSERT' THEN RETURN NULL;END IF;
 IF OLD.active AND NOT NEW.active THEN bid:=NEW.bundle_id;ELSE RETURN NULL;END IF;
 ELSIF TG_TABLE_NAME='locations' THEN
 IF(NEW.max_bundles,NEW.max_net_weight) IS DISTINCT FROM(OLD.max_bundles,OLD.max_net_weight) THEN PERFORM storage_assert_location(NEW.id,false);END IF;RETURN NULL;
 END IF;
 SELECT b.location_id INTO loc FROM bundles b WHERE b.id=bid AND b.physical_status='IN_STOCK' AND NOT EXISTS(SELECT 1 FROM loading_items z JOIN loading_orders d ON d.id=z.loading_id WHERE z.bundle_id=b.id AND z.active AND d.status='LOADED');
 IF loc IS NOT NULL THEN PERFORM storage_assert_location(loc);END IF;RETURN NULL;
END $$;
DO $$ DECLARE tab text;BEGIN FOREACH tab IN ARRAY ARRAY['bundles','reservations','loading_items','loading_orders','locations'] LOOP
 EXECUTE format('CREATE TRIGGER storage_gate BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION storage_serial_gate()',tab);
 IF tab='loading_orders' OR tab='locations' THEN EXECUTE format('CREATE TRIGGER storage_lock BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION storage_row_lock()',tab);
 ELSE EXECUTE format('CREATE TRIGGER storage_lock BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION storage_row_lock()',tab);END IF;
 IF tab<>'loading_orders' THEN EXECUTE format('CREATE CONSTRAINT TRIGGER storage_validate AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION storage_deferred_check()',tab);END IF;
 END LOOP;END $$;
REVOKE ALL ON FUNCTION storage_serial_gate(),storage_touch_location(uuid),storage_row_lock(),storage_assert_location(uuid,boolean),storage_deferred_check() FROM PUBLIC;
