CREATE FUNCTION v26_production_context(actor uuid,pid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE cust customers;loc locations;wh warehouses;BEGIN
 PERFORM v24_revision();SELECT w.* INTO wh FROM warehouses w WHERE w.project_id=pid AND w.active AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=actor AND s.project_id=pid AND s.customer_id IS NULL AND(s.warehouse_id IS NULL OR s.warehouse_id=w.id)) ORDER BY w.code LIMIT 1 FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '生产入库需项目仓库范围及全部客户权限' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'receipt:write',pid,NULL,wh.id);
 SELECT * INTO cust FROM customers WHERE project_id=pid AND lower(name)='musonoi' ORDER BY code LIMIT 1;
 IF NOT FOUND THEN INSERT INTO customers(project_id,code,name) VALUES(pid,'MUSONOI-PRODUCTION','Musonoi') RETURNING * INTO cust;END IF;
 IF NOT cust.active THEN RAISE EXCEPTION 'Musonoi客户已停用' USING ERRCODE='23514';END IF;
 SELECT * INTO loc FROM locations WHERE project_id=pid AND code='临时堆存区';
 IF NOT FOUND THEN INSERT INTO locations(project_id,warehouse_id,code,map_note) VALUES(pid,wh.id,'临时堆存区','V2.6 未检斤生产入库区，非现场地图正式货位') RETURNING * INTO loc;END IF;
 IF NOT loc.active OR loc.warehouse_id<>wh.id THEN RAISE EXCEPTION '临时堆存区已停用或仓库不一致' USING ERRCODE='23514';END IF;
 RETURN jsonb_build_object('customer_id',cust.id,'customer','Musonoi','location_id',loc.id,'location','临时堆存区','warehouse_id',wh.id);END $$;
REVOKE ALL ON FUNCTION v26_production_context(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v26_production_context(uuid,uuid) TO musonoi_app;
CREATE FUNCTION v26_receipt_identity() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r receipts;t text;BEGIN
 SELECT * INTO r FROM receipts WHERE id=NEW.receipt_id;
 IF r.workflow_version='2.6' THEN
 IF NEW.bundle_no !~ '^MUS-[0-9]{4}-[0-9]{3}-[1-9][0-9]*$' THEN RAISE EXCEPTION '捆包编号须为MUS-YYYY-DDD-N' USING ERRCODE='23514';END IF;
 t:=split_part(NEW.bundle_no,'-',1)||'-'||split_part(NEW.bundle_no,'-',2)||'-'||split_part(NEW.bundle_no,'-',3);
 IF NOT EXISTS(SELECT 1 FROM batches WHERE id=NEW.batch_id AND project_id=r.project_id AND code=t) OR NOT EXISTS(SELECT 1 FROM locations WHERE id=NEW.location_id AND project_id=r.project_id AND code='临时堆存区') OR NOT EXISTS(SELECT 1 FROM customers WHERE id=r.customer_id AND project_id=r.project_id AND lower(name)='musonoi') THEN RAISE EXCEPTION '生产入库批次、Musonoi客户、临时堆存区不匹配' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER v26_receipt_identity BEFORE INSERT OR UPDATE ON receipt_lines FOR EACH ROW EXECUTE FUNCTION v26_receipt_identity();
CREATE FUNCTION v26_register_positions(actor uuid,doc uuid,expected int,entries jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE a allocations;p sales_plans;x jsonb;b bundles;l locations;BEGIN
 PERFORM v24_revision();SELECT * INTO a FROM allocations WHERE id=doc FOR UPDATE;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id;
 IF a.workflow_state IS NULL OR a.workflow_state NOT IN('PENDING','PREPARED','PARTIAL') OR a.version<>expected OR jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '货位登记状态或版本不允许' USING ERRCODE='23514';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(entries) ORDER BY value->>'bundle_id' LOOP
 SELECT b0.* INTO b FROM bundles b0 JOIN reservations r ON r.bundle_id=b0.id WHERE b0.id=(x->>'bundle_id')::uuid AND r.allocation_id=a.id AND r.released_at IS NULL FOR UPDATE OF b0;
 IF NOT FOUND OR b.physical_status<>'IN_STOCK' OR EXISTS(SELECT 1 FROM loading_items WHERE bundle_id=b.id AND active) OR coalesce(x->>'actual_moved','')<>'true' THEN RAISE EXCEPTION '必须是本Lot有效锁定且未装车的捆包，并确认实际移位' USING ERRCODE='23514';END IF;
 SELECT * INTO l FROM locations WHERE id=(x->>'location_id')::uuid AND project_id=p.project_id AND active AND coalesce(map_cell_code,code) IN(SELECT code FROM stock_map_cells) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '请选择现有地图正式货位' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,l.warehouse_id);PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 UPDATE bundles SET location_id=l.id,version=version+1 WHERE id=b.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(b.id,'MOVE',0,actor,jsonb_build_object('location_id',b.location_id),jsonb_build_object('allocation_id',a.id,'location_id',l.id,'actual_moved',true));END LOOP;
 UPDATE allocations SET version=version+1 WHERE id=doc RETURNING * INTO a;RETURN a;END $$;
REVOKE ALL ON FUNCTION v26_register_positions(uuid,uuid,int,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v26_register_positions(uuid,uuid,int,jsonb) TO musonoi_app;
