CREATE FUNCTION v261_create(actor uuid,plan uuid,lot text,planned uuid,entries jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a allocations;p sales_plans;b bundles;x jsonb;l locations;BEGIN
 PERFORM v24_revision();SELECT * INTO p FROM sales_plans WHERE id=plan FOR UPDATE;
 IF NOT FOUND OR p.status<>'OPEN' OR lot IS NULL OR lot !~ '^RMM-CU-[0-9]{4}-(0[1-9]|[1-9][0-9])$' OR jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '有效销售计划、Lot、规划货位及1至500捆必填' USING ERRCODE='23514';END IF;
 IF p.contract_id IS NOT NULL THEN PERFORM ux_valid_contract(p.contract_id,p.project_id,p.customer_id);END IF;
 IF (SELECT count(DISTINCT value->>'bundle_id') FROM jsonb_array_elements(entries))<>jsonb_array_length(entries) THEN RAISE EXCEPTION '捆包明细重复' USING ERRCODE='23514';END IF;
 SELECT * INTO l FROM locations WHERE id=planned AND project_id=p.project_id;IF NOT FOUND THEN RAISE EXCEPTION '规划货位不属于该项目' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,l.warehouse_id);
 INSERT INTO allocations(plan_id,created_by,lot_no,workflow_version,planned_location_id) VALUES(p.id,actor,lot,'2.6.1',planned) RETURNING * INTO a;
 FOR x IN SELECT value FROM jsonb_array_elements(entries) ORDER BY value->>'bundle_id' LOOP
 SELECT * INTO b FROM bundles WHERE id=(x->>'bundle_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '捆包不存在: %',x->>'bundle_id' USING ERRCODE='23514';END IF;
 IF b.project_id<>p.project_id OR b.physical_status<>'IN_STOCK' OR b.sample_status='SAMPLING' OR EXISTS(SELECT 1 FROM reservations WHERE bundle_id=b.id AND released_at IS NULL) OR EXISTS(SELECT 1 FROM loading_items WHERE bundle_id=b.id AND active) OR EXISTS(SELECT 1 FROM stock_adjustments sa JOIN adjustment_lines ai ON ai.adjustment_id=sa.id WHERE ai.bundle_no=b.bundle_no AND sa.status IN('DRAFT','PENDING')) THEN RAISE EXCEPTION '捆包已占用或存在业务冲突: %',b.bundle_no USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 IF (SELECT warehouse_id FROM locations WHERE id=b.location_id)<>l.warehouse_id THEN RAISE EXCEPTION 'Lot捆包与规划货位需属于同一仓库: %',b.bundle_no USING ERRCODE='23514';END IF;
 INSERT INTO allocation_items(allocation_id,bundle_id) VALUES(a.id,b.id);
 INSERT INTO lot_work_items(allocation_id,bundle_id,sample_required,sample_stage) VALUES(a.id,b.id,coalesce((x->>'sample_required')::boolean,false),CASE WHEN coalesce((x->>'sample_required')::boolean,false) THEN 'WAITING' ELSE 'NOT_REQUIRED' END);
 INSERT INTO reservations(allocation_id,bundle_id,weight,locked_by) VALUES(a.id,b.id,b.net_weight,actor);
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'LOCK',0,actor,jsonb_build_object('allocation_id',a.id,'lot_no',lot,'basis','LOT_CREATED'));
 INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,after_data) VALUES(a.id,b.id,'CREATE_ITEM',actor,x||jsonb_build_object('planned_location_id',planned));END LOOP;
 UPDATE allocations SET status='LOCKED',workflow_state='WORKING',locked_at=clock_timestamp(),version=version+1 WHERE id=a.id RETURNING * INTO a;
 PERFORM v261_assert_plan(planned);
 INSERT INTO workflow_reviews(allocation_id,action,actor_id,note) VALUES(a.id,'CREATE_LOT',actor,'创建Lot并开始备货，立即锁定');RETURN a;
END $$;

CREATE FUNCTION v261_item_action(actor uuid,doc uuid,bid uuid,expected int,action text,payload jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a allocations;p sales_plans;b bundles;w lot_work_items;g numeric;oldw numeric;beforedata jsonb;nextstage text;reqsample boolean;BEGIN
 PERFORM v24_revision();SELECT * INTO a FROM allocations WHERE id=doc FOR UPDATE;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id;
 IF a.workflow_version IS DISTINCT FROM '2.6.1' OR a.workflow_state NOT IN('WORKING','RECTIFY') OR a.version<>expected THEN RAISE EXCEPTION '只允许在备货作业/整改期间修改，或版本已变化' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM bundles WHERE id=bid FOR UPDATE;SELECT * INTO w FROM lot_work_items WHERE allocation_id=doc AND bundle_id=bid FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM reservations WHERE allocation_id=doc AND bundle_id=bid AND released_at IS NULL) OR b.physical_status<>'IN_STOCK' OR EXISTS(SELECT 1 FROM loading_items WHERE bundle_id=bid AND active) THEN RAISE EXCEPTION '捆包已不属于本Lot有效作业' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 SELECT to_jsonb(w)||jsonb_build_object('gross_weight',i.gross_weight,'net_weight',i.net_weight) INTO beforedata FROM allocation_items i WHERE i.allocation_id=doc AND i.bundle_id=bid;
 IF action='sample-mark' THEN
 IF jsonb_typeof(payload->'required') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION '取样标记须为布尔值' USING ERRCODE='23514';END IF;reqsample:=(payload->>'required')::boolean;
 IF w.sample_stage IN('IN_PROGRESS','RETURNED','WEIGHED') AND reqsample IS DISTINCT FROM w.sample_required THEN RAISE EXCEPTION '已经发生取样的记录不可抹除；请走授权更正' USING ERRCODE='23514';END IF;
 IF reqsample IS DISTINCT FROM w.sample_required THEN
 UPDATE lot_work_items SET sample_required=reqsample,sample_stage=CASE WHEN reqsample THEN 'WAITING' ELSE 'NOT_REQUIRED' END,final_weighed=false,weighed_by=NULL,weighed_at=NULL,version=version+1 WHERE allocation_id=doc AND bundle_id=bid;
 UPDATE allocation_items SET gross_weight=NULL,net_weight=NULL WHERE allocation_id=doc AND bundle_id=bid;END IF;
 ELSIF action='sample-stage' THEN
 nextstage:=payload->>'stage';IF NOT w.sample_required OR NOT((w.sample_stage='WAITING' AND nextstage='IN_PROGRESS') OR(w.sample_stage='IN_PROGRESS' AND nextstage='RETURNED') OR(w.sample_stage='WEIGHED' AND nextstage='IN_PROGRESS')) THEN RAISE EXCEPTION '取样须依次待取样→取样中→已返回→最终检斤，不能跳步' USING ERRCODE='23514';END IF;
 IF nextstage='RETURNED' AND coalesce(payload->>'repacked','')<>'true' THEN RAISE EXCEPTION '返回时须确认已完成重新打包' USING ERRCODE='23514';END IF;
 UPDATE lot_work_items SET sample_stage=nextstage,final_weighed=false,weighed_by=NULL,weighed_at=NULL,sample_date=coalesce((payload->>'sample_date')::date,sample_date),version=version+1 WHERE allocation_id=doc AND bundle_id=bid;
 UPDATE allocation_items SET gross_weight=NULL,net_weight=NULL WHERE allocation_id=doc AND bundle_id=bid;
 UPDATE bundles SET sample_status=CASE WHEN nextstage='IN_PROGRESS' THEN 'SAMPLING' ELSE 'SAMPLED' END,version=version+1 WHERE id=bid;
 ELSIF action='weigh' THEN
 IF w.sample_required AND w.sample_stage NOT IN('RETURNED','WEIGHED') THEN RAISE EXCEPTION '取样捆包须先返回并重新打包后才能最终检斤: %',b.bundle_no USING ERRCODE='23514';END IF;
 IF coalesce(payload->>'gross_weight','') !~ '^[0-9]{1,8}(\.[0-9]{1,4})?$' THEN RAISE EXCEPTION '毛重须为最多4位小数的吨数' USING ERRCODE='23514';END IF;g:=(payload->>'gross_weight')::numeric;
 IF g<=0.0025 OR g>=100000000 THEN RAISE EXCEPTION '毛重与扣包后净重须大于零' USING ERRCODE='23514';END IF;
 oldw:=b.net_weight;
 -- Audited measurement authorizes exactly this transaction's bundle projection update.
 INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,before_data,after_data,note) VALUES(doc,bid,'WEIGH',actor,to_jsonb(b),jsonb_build_object('txid',txid_current()::text,'gross_weight',g,'net_weight',g-0.0025),coalesce(payload->>'note',''));
 IF b.workflow_version='2.6' THEN UPDATE bundles SET gross_weight=g,packaging_weight=0.0025,weight_rule_version='PACK_2_5KG_V1',original_net_weight=g-0.0025,net_weight=g-0.0025,version=version+1 WHERE id=bid;
 ELSE UPDATE bundles SET net_weight=g-0.0025,version=version+1 WHERE id=bid;END IF;
 UPDATE reservations SET weight=g-0.0025 WHERE allocation_id=doc AND bundle_id=bid AND released_at IS NULL;
 UPDATE allocation_items SET gross_weight=g,net_weight=g-0.0025 WHERE allocation_id=doc AND bundle_id=bid;
 UPDATE lot_work_items SET final_weighed=true,sample_stage=CASE WHEN sample_required THEN 'WEIGHED' ELSE 'NOT_REQUIRED' END,weighed_at=clock_timestamp(),weighed_by=actor,version=version+1 WHERE allocation_id=doc AND bundle_id=bid;
 IF oldw IS DISTINCT FROM g-0.0025 THEN INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(bid,'ADJUST_WEIGHT',g-0.0025-coalesce(oldw,0),actor,jsonb_build_object('weight',oldw),jsonb_build_object('allocation_id',doc,'basis','V261_MEASURED','weight',g-0.0025));END IF;
 ELSE RAISE EXCEPTION '未知Lot作业操作' USING ERRCODE='23514';END IF;
 INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,before_data,after_data,note) SELECT doc,bid,upper(action),actor,beforedata,to_jsonb(wi)||jsonb_build_object('gross_weight',ai.gross_weight,'net_weight',ai.net_weight),coalesce(payload->>'note','') FROM lot_work_items wi JOIN allocation_items ai USING(allocation_id,bundle_id) WHERE wi.allocation_id=doc AND wi.bundle_id=bid;
 UPDATE allocations SET version=version+1 WHERE id=doc RETURNING * INTO a;PERFORM v261_assert_plan(a.planned_location_id);PERFORM v24_capture_bundle(bid);RETURN a;
END $$;

CREATE FUNCTION v261_check_ready(doc uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE a allocations;p sales_plans;missing text;BEGIN
 SELECT * INTO a FROM allocations WHERE id=doc;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id;
 IF p.status IS DISTINCT FROM 'OPEN' THEN RAISE EXCEPTION '销售计划已关闭' USING ERRCODE='23514';END IF;IF p.contract_id IS NOT NULL THEN PERFORM ux_valid_contract(p.contract_id,p.project_id,p.customer_id);END IF;
 SELECT string_agg(b.bundle_no||': '||CASE WHEN w.sample_required AND w.sample_stage<>'WEIGHED' THEN '取样未返回/未最终检斤' ELSE '未完成有效检斤' END,'；' ORDER BY b.bundle_no) INTO missing FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id JOIN lot_work_items w USING(allocation_id,bundle_id) WHERE i.allocation_id=doc AND (NOT w.final_weighed OR i.gross_weight IS NULL OR i.net_weight IS NULL OR i.net_weight<=0 OR i.gross_weight-i.net_weight<>0.0025 OR(w.sample_required AND w.sample_stage<>'WEIGHED') OR NOT EXISTS(SELECT 1 FROM reservations WHERE allocation_id=doc AND bundle_id=b.id AND released_at IS NULL) OR b.physical_status<>'IN_STOCK');
 IF missing IS NOT NULL THEN RAISE EXCEPTION '尚未完成: %',missing USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM lot_work_items WHERE allocation_id=doc) THEN RAISE EXCEPTION 'Lot无有效捆包' USING ERRCODE='23514';END IF;PERFORM v261_assert_plan(a.planned_location_id);
 IF (SELECT coalesce(sum(r.weight),0) FROM reservations r JOIN allocations aa ON aa.id=r.allocation_id WHERE aa.plan_id=p.id AND r.released_at IS NULL)>p.target_weight THEN RAISE EXCEPTION '有效备货已知净重超过销售计划目标' USING ERRCODE='23514';END IF;
END $$;

CREATE FUNCTION v261_lot_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a allocations;p sales_plans;b bundles;note text;review boolean;facts boolean;oldloc uuid;BEGIN
 PERFORM v24_revision();SELECT * INTO a FROM allocations WHERE id=doc FOR UPDATE;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id FOR UPDATE;
 IF a.workflow_version IS DISTINCT FROM '2.6.1' OR a.version<>expected THEN RAISE EXCEPTION 'Lot版本或流程冲突' USING ERRCODE='23514';END IF;note:=trim(coalesce(payload->>'note',''));review:=action IN('approve','reject');
 FOR b IN SELECT bb.* FROM bundles bb JOIN allocation_items i ON i.bundle_id=bb.id WHERE i.allocation_id=doc ORDER BY bb.id FOR UPDATE OF bb LOOP
 PERFORM v23_require(actor,CASE WHEN review THEN 'allocation:review' ELSE 'allocation:write' END,p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));END LOOP;
 IF review AND actor=a.created_by THEN RAISE EXCEPTION '主管不能审核自己创建的Lot' USING ERRCODE='23514';END IF;
 IF action='submit' THEN
 IF a.workflow_state NOT IN('WORKING','RECTIFY') THEN RAISE EXCEPTION '只有作业中或整改Lot可提交审核' USING ERRCODE='23514';END IF;PERFORM v261_check_ready(doc);
 UPDATE allocations SET workflow_state='PENDING',submitted_at=clock_timestamp(),version=version+1 WHERE id=doc;
 ELSIF action IN('approve','reject') THEN
 IF a.workflow_state<>'PENDING' THEN RAISE EXCEPTION '只允许审核待审核Lot' USING ERRCODE='23514';END IF;
 IF action='reject' THEN IF note='' THEN RAISE EXCEPTION '驳回原因必填' USING ERRCODE='23514';END IF;
 UPDATE allocations SET workflow_state='RECTIFY',reviewed_by=actor,reviewed_at=clock_timestamp(),review_note=note,version=version+1 WHERE id=doc;
 ELSE
 IF coalesce(payload->>'all_weighed_and_stored','')<>'true' THEN RAISE EXCEPTION '主管须确认全部捆包检斤完成且已归位' USING ERRCODE='23514';END IF;PERFORM v261_check_ready(doc);PERFORM v23_require(actor,'allocation:review',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=a.planned_location_id));
 UPDATE allocations SET workflow_state='PREPARED',reviewed_by=actor,reviewed_at=clock_timestamp(),review_note=note,version=version+1 WHERE id=doc;
 FOR b IN SELECT bb.* FROM bundles bb JOIN allocation_items i ON i.bundle_id=bb.id WHERE i.allocation_id=doc ORDER BY bb.id LOOP
 oldloc:=b.location_id;UPDATE bundles SET location_id=a.planned_location_id,version=version+1 WHERE id=b.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(b.id,'MOVE',0,actor,jsonb_build_object('location_id',oldloc),jsonb_build_object('allocation_id',doc,'location_id',a.planned_location_id,'basis','SUPERVISOR_CONFIRMED_STORED'));END LOOP;END IF;
 ELSIF action='cancel' THEN
 IF a.workflow_state NOT IN('WORKING','RECTIFY') OR note='' THEN RAISE EXCEPTION '仅作业/整改Lot可取消，原因必填；待审核需主管驳回后整改' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM lot_work_items WHERE allocation_id=doc AND sample_stage='IN_PROGRESS') THEN RAISE EXCEPTION '仍有捆包在实验室取样，不可释放；须先确认返回重新打包' USING ERRCODE='23514';END IF;
 SELECT EXISTS(SELECT 1 FROM lot_work_history WHERE allocation_id=doc AND action IN('WEIGH','SAMPLE-STAGE')) INTO facts;
 IF facts AND (coalesce(payload->>'current_state_verified','')<>'true' OR length(trim(coalesce(payload->>'observation','')))<1) THEN RAISE EXCEPTION '已有取样/检斤事实，须核实全部捆包当前状态并填写观察说明' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM loading_items z JOIN allocation_items i ON i.bundle_id=z.bundle_id WHERE i.allocation_id=doc AND z.active) THEN RAISE EXCEPTION '已有有效装车占用，不可取消' USING ERRCODE='23514';END IF;
 UPDATE allocations SET workflow_state='CANCELLED',status='RELEASED',cancelled_by=actor,cancelled_at=clock_timestamp(),cancel_note=note,cancellation_observation=payload,released_at=clock_timestamp(),release_reason=note,version=version+1 WHERE id=doc;
 FOR b IN SELECT bb.* FROM bundles bb JOIN reservations r ON r.bundle_id=bb.id WHERE r.allocation_id=doc AND r.released_at IS NULL ORDER BY bb.id LOOP
 UPDATE reservations SET released_at=clock_timestamp(),released_by=actor,release_reason=note WHERE allocation_id=doc AND bundle_id=b.id AND released_at IS NULL;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data) VALUES(b.id,'UNLOCK',0,actor,jsonb_build_object('allocation_id',doc,'basis','LOT_CANCELLED','note',note));END LOOP;
 ELSE RAISE EXCEPTION '未知Lot操作' USING ERRCODE='23514';END IF;
 INSERT INTO workflow_reviews(allocation_id,action,actor_id,note) VALUES(doc,upper(action),actor,note);
 INSERT INTO lot_work_history(allocation_id,action,actor_id,before_data,after_data,note) SELECT doc,upper(action),actor,to_jsonb(a),to_jsonb(aa),note FROM allocations aa WHERE aa.id=doc;
 SELECT * INTO a FROM allocations WHERE id=doc;RETURN a;
END $$;
REVOKE ALL ON FUNCTION v261_create(uuid,uuid,text,uuid,jsonb),v261_item_action(uuid,uuid,uuid,int,text,jsonb),v261_check_ready(uuid),v261_lot_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v261_create(uuid,uuid,text,uuid,jsonb),v261_item_action(uuid,uuid,uuid,int,text,jsonb),v261_lot_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
