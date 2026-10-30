CREATE FUNCTION v26_submit(actor uuid,plan uuid,lot text,entries jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p sales_plans;a allocations;b bundles;x jsonb;g numeric;loc locations;oldw numeric;BEGIN
 PERFORM v24_revision(); SELECT * INTO p FROM sales_plans WHERE id=plan FOR UPDATE;
 IF NOT FOUND OR p.status<>'OPEN' OR lot IS NULL OR lot !~ '^RMM-CU-[0-9]{4}-(0[1-9]|[1-9][0-9])$' OR jsonb_typeof(entries) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '有效销售计划、Lot格式及明细必填' USING ERRCODE='23514';END IF;
 PERFORM ux_valid_contract(p.contract_id,p.project_id,p.customer_id);
 IF jsonb_array_length(entries) NOT BETWEEN 1 AND 500 OR (SELECT count(DISTINCT value->>'bundle_id') FROM jsonb_array_elements(entries))<>jsonb_array_length(entries) THEN RAISE EXCEPTION '选择1至500个不重复捆包' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,NULL);
 INSERT INTO allocations(plan_id,created_by,lot_no,submitted_at) VALUES(plan,actor,lot,clock_timestamp()) RETURNING * INTO a;
 FOR x IN SELECT value FROM jsonb_array_elements(entries) ORDER BY value->>'bundle_id' LOOP
 SELECT * INTO b FROM bundles WHERE id=(x->>'bundle_id')::uuid FOR UPDATE;
 IF NOT FOUND OR b.project_id<>p.project_id OR b.physical_status<>'IN_STOCK' OR b.sample_status='SAMPLING' OR EXISTS(SELECT 1 FROM reservations WHERE bundle_id=b.id AND released_at IS NULL) OR EXISTS(SELECT 1 FROM loading_items WHERE bundle_id=b.id AND active) OR EXISTS(SELECT 1 FROM stock_adjustments s JOIN adjustment_lines i ON i.adjustment_id=s.id WHERE i.bundle_no=b.bundle_no AND s.status IN('DRAFT','PENDING')) THEN RAISE EXCEPTION '捆包已占用或不可备货' USING ERRCODE='23514';END IF;
 IF coalesce(x->>'gross_weight','') !~ '^[0-9]{1,8}(\.[0-9]{1,4})?$' THEN RAISE EXCEPTION '每捆毛重必填，最多4位小数，单位吨' USING ERRCODE='23514';END IF;
 g:=(x->>'gross_weight')::numeric;IF g<=0.0025 OR g>=100000000 THEN RAISE EXCEPTION '毛重扣包后净重必须大于零' USING ERRCODE='23514';END IF;
 SELECT * INTO loc FROM locations WHERE id=b.location_id;PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,loc.warehouse_id);
 IF b.workflow_version='2.6' THEN
 oldw:=b.net_weight;
 UPDATE bundles SET gross_weight=g,net_weight=g-0.0025,original_net_weight=g-0.0025,packaging_weight=0.0025,weight_rule_version='PACK_2_5KG_V1',version=version+1 WHERE id=b.id;
 -- Measurement adds known mass to the ledger; original inbound NULL remains unknown.
 IF oldw IS DISTINCT FROM g-0.0025 THEN INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'ADJUST_WEIGHT',g-0.0025-coalesce(oldw,0),actor,jsonb_build_object('basis','V26_FIRST_OR_RECONFIRMED_WEIGHING','allocation_id',a.id,'previous_weight',oldw,'net_weight',g-0.0025));END IF;
 ELSE
 IF b.gross_weight IS DISTINCT FROM g OR b.net_weight IS DISTINCT FROM g-0.0025 THEN RAISE EXCEPTION '历史重量不可覆盖；请走原授权调整流程后再备货' USING ERRCODE='23514';END IF;
 END IF;
 INSERT INTO allocation_items(allocation_id,bundle_id,gross_weight,net_weight) VALUES(a.id,b.id,g,g-0.0025);
 INSERT INTO reservations(allocation_id,bundle_id,weight,locked_by) VALUES(a.id,b.id,g-0.0025,actor);
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'LOCK',0,actor,jsonb_build_object('allocation_id',a.id,'lot_no',lot,'customer_id',p.customer_id));
 -- A change of location is an explicit observation, never an approval side effect.
 IF x->>'location_id' IS NOT NULL AND (x->>'location_id')::uuid<>b.location_id THEN
 IF coalesce(x->>'actual_moved','')<>'true' THEN RAISE EXCEPTION '实际移位必须明确确认' USING ERRCODE='23514';END IF;
 SELECT * INTO loc FROM locations WHERE id=(x->>'location_id')::uuid AND project_id=p.project_id AND active AND coalesce(map_cell_code,code) IN(SELECT code FROM stock_map_cells) FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION '正式货位必须关联库存地图' USING ERRCODE='23514';END IF;PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,loc.warehouse_id);
 UPDATE bundles SET location_id=loc.id,version=version+1 WHERE id=b.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(b.id,'MOVE',0,actor,jsonb_build_object('location_id',b.location_id),jsonb_build_object('allocation_id',a.id,'location_id',loc.id,'actual_moved',true));END IF;
 END LOOP;
 UPDATE allocations SET status='LOCKED',workflow_state='PENDING',locked_at=clock_timestamp(),version=version+1 WHERE id=a.id RETURNING * INTO a;
 INSERT INTO workflow_reviews(allocation_id,action,actor_id,note) VALUES(a.id,'SUBMIT',actor,'提交审核并锁定');RETURN a;
END $$;

CREATE FUNCTION v26_allocation_action(actor uuid,doc uuid,expected int,action text,note text) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a allocations;p sales_plans;b bundles;loc locations;BEGIN
 PERFORM v24_revision();SELECT * INTO a FROM allocations WHERE id=doc FOR UPDATE;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id FOR UPDATE;
 IF a.workflow_state IS DISTINCT FROM 'PENDING' OR a.version<>expected OR action NOT IN('approve','reject') OR actor=a.created_by THEN RAISE EXCEPTION '备货审核状态/版本冲突或不允许自审' USING ERRCODE='23514';END IF;
 IF action='reject' AND length(trim(coalesce(note,''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION '驳回原因必填' USING ERRCODE='23514';END IF;
 FOR b IN SELECT x.* FROM bundles x JOIN allocation_items i ON i.bundle_id=x.id WHERE i.allocation_id=a.id ORDER BY x.id FOR UPDATE OF x LOOP
 SELECT * INTO loc FROM locations WHERE id=b.location_id;
 PERFORM v23_require(actor,'allocation:review',p.project_id,p.customer_id,loc.warehouse_id);
 IF NOT EXISTS(SELECT 1 FROM reservations WHERE allocation_id=a.id AND bundle_id=b.id AND released_at IS NULL) OR b.physical_status<>'IN_STOCK' THEN RAISE EXCEPTION '备货锁定发生变化' USING ERRCODE='23514';END IF;
 IF action='approve' THEN
 IF NOT loc.active OR coalesce(loc.map_cell_code,loc.code) NOT IN(SELECT code FROM stock_map_cells) THEN RAISE EXCEPTION '审核通过前必须确认实际地图货位' USING ERRCODE='23514';END IF;PERFORM storage_assert_location(loc.id);
 ELSE
 UPDATE reservations SET released_at=clock_timestamp(),released_by=actor,release_reason=note WHERE allocation_id=a.id AND bundle_id=b.id AND released_at IS NULL;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'UNLOCK',0,actor,jsonb_build_object('allocation_id',a.id,'reason',note));END IF;END LOOP;
 UPDATE allocations SET workflow_state=CASE WHEN action='approve' THEN 'PREPARED' ELSE 'REJECTED' END,status=CASE WHEN action='approve' THEN 'LOCKED' ELSE 'RELEASED' END,reviewed_by=actor,reviewed_at=clock_timestamp(),review_note=coalesce(note,''),released_at=CASE WHEN action='reject' THEN clock_timestamp() END,release_reason=CASE WHEN action='reject' THEN note END,version=version+1 WHERE id=doc RETURNING * INTO a;
 INSERT INTO workflow_reviews(allocation_id,action,actor_id,note) VALUES(doc,upper(action),actor,coalesce(note,''));RETURN a;
END $$;

CREATE FUNCTION v26_create_load(actor uuid,lot uuid,vehicle text,load_date date,ids uuid[]) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a allocations;p sales_plans;d loading_orders;b bundles;r reservations;wh uuid;BEGIN
 PERFORM v24_revision();SELECT * INTO a FROM allocations WHERE id=lot FOR UPDATE;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id FOR UPDATE;
 IF a.workflow_state IS NULL OR a.workflow_state NOT IN('PREPARED','PARTIAL') OR p.status<>'OPEN' OR cardinality(ids) NOT BETWEEN 1 AND 500 OR cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids)x) OR length(trim(vehicle)) NOT BETWEEN 1 AND 80 OR load_date IS NULL THEN RAISE EXCEPTION '有效已备货Lot、车牌、日期和捆包必填' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'load:write',p.project_id,p.customer_id,NULL);
 INSERT INTO loading_orders(project_id,customer_id,vehicle_no,loaded_at,created_by,allocation_id,workflow_state) VALUES(p.project_id,p.customer_id,upper(trim(vehicle)),load_date::timestamp AT TIME ZONE 'Africa/Lubumbashi',actor,a.id,'PENDING') RETURNING * INTO d;
 FOR b IN SELECT * FROM bundles WHERE id=ANY(ids) ORDER BY id FOR UPDATE LOOP
 SELECT warehouse_id INTO wh FROM locations WHERE id=b.location_id;PERFORM v23_require(actor,'load:write',p.project_id,p.customer_id,wh);
 SELECT * INTO r FROM reservations WHERE allocation_id=a.id AND bundle_id=b.id AND released_at IS NULL;
 IF NOT FOUND OR b.physical_status<>'IN_STOCK' OR EXISTS(SELECT 1 FROM loading_items WHERE bundle_id=b.id AND active) THEN RAISE EXCEPTION '捆包不属于Lot或已装车占用' USING ERRCODE='23514';END IF;
 INSERT INTO loading_items(loading_id,bundle_id,reservation_id,original_weight,original_location_id) VALUES(d.id,b.id,r.id,b.net_weight,b.location_id);END LOOP;
 IF (SELECT count(*) FROM loading_items WHERE loading_id=d.id)<>cardinality(ids) THEN RAISE EXCEPTION '捆包列表已变化' USING ERRCODE='23514';END IF;
 UPDATE allocations SET workflow_state='PARTIAL',version=version+1 WHERE id=a.id;
 INSERT INTO workflow_reviews(loading_id,action,actor_id,note) VALUES(d.id,'SUBMIT',actor,'提交装车审核');RETURN d;
END $$;

CREATE FUNCTION v26_load_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS loading_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d loading_orders;a allocations;b bundles;i loading_items;perm text;note text;wh uuid;stamp timestamptz;BEGIN
 PERFORM v24_revision();SELECT * INTO d FROM loading_orders WHERE id=doc FOR UPDATE;SELECT * INTO a FROM allocations WHERE id=d.allocation_id FOR UPDATE;
 IF d.workflow_state IS NULL OR d.version<>expected THEN RAISE EXCEPTION '装车状态或版本冲突' USING ERRCODE='23514';END IF;
 perm:=CASE WHEN action IN('approve','reject') THEN 'load:review' WHEN action IN('manager-approve','manager-reject') THEN 'outbound:approve' ELSE 'load:write' END;
 note:=trim(coalesce(payload->>'note',''));
 FOR b IN SELECT x.* FROM bundles x JOIN loading_items z ON z.bundle_id=x.id WHERE z.loading_id=d.id ORDER BY x.id FOR UPDATE OF x LOOP
 SELECT warehouse_id INTO wh FROM locations WHERE id=b.location_id;PERFORM v23_require(actor,perm,d.project_id,d.customer_id,wh);END LOOP;
 IF action IN('approve','reject') THEN
 IF d.workflow_state<>'PENDING' OR actor=d.created_by THEN RAISE EXCEPTION '仅独立现场主管可审核待审核装车单' USING ERRCODE='23514';END IF;
 IF action='approve' THEN UPDATE loading_orders SET status='LOADED',workflow_state='READY',reviewed_by=actor,reviewed_at=clock_timestamp(),completed_by=actor,completed_at=clock_timestamp(),version=version+1 WHERE id=doc;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) SELECT bundle_id,'LOAD',0,actor,jsonb_build_object('loading_id',doc,'lot_no',a.lot_no) FROM loading_items WHERE loading_id=doc AND active;
 ELSE IF note='' THEN RAISE EXCEPTION '驳回原因必填' USING ERRCODE='23514';END IF;
 UPDATE loading_items SET active=false,removed_reason=note,removed_at=clock_timestamp() WHERE loading_id=doc AND active;
 UPDATE loading_orders SET status='CANCELLED',workflow_state='REJECTED',reviewed_by=actor,reviewed_at=clock_timestamp(),version=version+1 WHERE id=doc;END IF;
 ELSIF action='depart' THEN
 stamp:=(payload->>'departed_at')::timestamptz;
 IF d.workflow_state<>'READY' OR coalesce(payload->>'actual_departure','')<>'true' OR stamp IS NULL OR stamp<d.loaded_at OR stamp>clock_timestamp()+interval '1 minute' THEN RAISE EXCEPTION '需确认真实离场日期，不能早于装车或晚于当前时间' USING ERRCODE='23514';END IF;
 UPDATE loading_orders SET workflow_state='DEPARTED_PENDING',actual_departed_at=stamp,departure_by=actor,version=version+1 WHERE id=doc;
 ELSIF action='correct' THEN
 IF d.workflow_state<>'DEPARTED_CORRECTION' OR note='' THEN RAISE EXCEPTION '待纠正单据须填写更正说明' USING ERRCODE='23514';END IF;
 UPDATE loading_orders SET correction_note=note,workflow_state='DEPARTED_PENDING',version=version+1 WHERE id=doc;
 ELSIF action IN('manager-approve','manager-reject') THEN
 IF d.workflow_state<>'DEPARTED_PENDING' OR actor IN(d.created_by,d.departure_by) THEN RAISE EXCEPTION '仅独立物流经理可审核已离场单据' USING ERRCODE='23514';END IF;
 IF action='manager-reject' THEN
 IF note='' THEN RAISE EXCEPTION '驳回原因必填' USING ERRCODE='23514';END IF;
 UPDATE loading_orders SET workflow_state='DEPARTED_CORRECTION',version=version+1 WHERE id=doc;
 ELSE
 FOR i IN SELECT * FROM loading_items WHERE loading_id=doc ORDER BY bundle_id LOOP
 SELECT * INTO b FROM bundles WHERE id=i.bundle_id FOR UPDATE;
 IF NOT i.active OR b.physical_status<>'IN_STOCK' OR b.net_weight IS DISTINCT FROM i.original_weight OR NOT EXISTS(SELECT 1 FROM reservations WHERE id=i.reservation_id AND released_at IS NULL) THEN RAISE EXCEPTION '装车占用或重量发生冲突' USING ERRCODE='23514';END IF;
 UPDATE loading_items SET active=false,removed_reason='物流经理批准正式出库',removed_at=clock_timestamp() WHERE loading_id=doc AND bundle_id=b.id;
 UPDATE reservations SET released_at=clock_timestamp(),released_by=actor,release_reason='物流经理批准正式出库' WHERE id=i.reservation_id;
 UPDATE bundles SET physical_status='OUTBOUND',version=version+1 WHERE id=b.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'UNLOCK',0,actor,jsonb_build_object('allocation_id',a.id,'loading_id',doc));
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'OUTBOUND',-b.net_weight,actor,jsonb_build_object('outbound_id',doc,'loading_id',doc,'lot_no',a.lot_no,'departed_at',d.actual_departed_at));END LOOP;
 UPDATE loading_orders SET workflow_state='OUTBOUND',status='DEPARTED',manager_by=actor,manager_at=clock_timestamp(),version=version+1 WHERE id=doc;
 UPDATE allocations SET workflow_state=CASE WHEN EXISTS(SELECT 1 FROM allocation_items z JOIN bundles b ON b.id=z.bundle_id WHERE z.allocation_id=a.id AND b.physical_status<>'OUTBOUND') THEN 'PARTIAL' ELSE 'FULFILLED' END,status=CASE WHEN EXISTS(SELECT 1 FROM reservations WHERE allocation_id=a.id AND released_at IS NULL) THEN 'LOCKED' ELSE 'FULFILLED' END,version=version+1 WHERE id=a.id;END IF;
 ELSE RAISE EXCEPTION '不支持的装车操作' USING ERRCODE='23514';END IF;
 INSERT INTO workflow_reviews(loading_id,action,actor_id,note) VALUES(doc,upper(action),actor,note);
 SELECT * INTO d FROM loading_orders WHERE id=doc;RETURN d;
END $$;
REVOKE ALL ON FUNCTION v26_submit(uuid,uuid,text,jsonb),v26_allocation_action(uuid,uuid,int,text,text),v26_create_load(uuid,uuid,text,date,uuid[]),v26_load_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v26_submit(uuid,uuid,text,jsonb),v26_allocation_action(uuid,uuid,int,text,text),v26_create_load(uuid,uuid,text,date,uuid[]),v26_load_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
