CREATE FUNCTION v262_sync_claims() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE q record;BEGIN
 FOR q IN SELECT c.* FROM lot_location_claims c JOIN allocations a ON a.id=c.allocation_id WHERE c.released_at IS NULL AND a.workflow_state IN('CANCELLED','FULFILLED') ORDER BY c.location_id LOOP
 IF NOT EXISTS(SELECT 1 FROM bundles b JOIN allocation_items ai ON ai.bundle_id=b.id WHERE ai.allocation_id=q.allocation_id AND b.location_id=q.location_id AND b.physical_status='IN_STOCK' AND NOT EXISTS(SELECT 1 FROM loading_items li JOIN loading_orders lo ON lo.id=li.loading_id WHERE li.bundle_id=b.id AND li.active AND lo.workflow_state IN('DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND'))) AND NOT EXISTS(SELECT 1 FROM reservations WHERE allocation_id=q.allocation_id AND released_at IS NULL) THEN
 UPDATE lot_location_claims SET released_at=clock_timestamp(),release_reason='Lot结束且无剩余现场实物/有效分配' WHERE id=q.id;
 INSERT INTO audit_logs(action,entity_type,entity_id,after_data) VALUES('lot_location_released','locations',q.location_id::text,jsonb_build_object('allocation_id',q.allocation_id,'reason','无剩余实物或业务占用'));
 END IF;END LOOP;
END $$;
CREATE FUNCTION v262_claim_deferred() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN PERFORM v262_sync_claims();RETURN NULL;END $$;
CREATE CONSTRAINT TRIGGER v262_claim_sync AFTER UPDATE ON bundles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v262_claim_deferred();
CREATE CONSTRAINT TRIGGER v262_claim_sync AFTER UPDATE ON allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v262_claim_deferred();
ALTER FUNCTION v261_create(uuid,uuid,text,uuid,jsonb) RENAME TO v262_prior_create;
REVOKE ALL ON FUNCTION v262_prior_create(uuid,uuid,text,uuid,jsonb) FROM musonoi_app;
CREATE FUNCTION v261_create(actor uuid,plan uuid,lot text,planned uuid,entries jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE a allocations;x record;BEGIN
 PERFORM v24_revision();PERFORM storage_touch_location(planned);PERFORM v262_sync_claims();
 IF EXISTS(SELECT 1 FROM lot_location_claims WHERE location_id=planned AND released_at IS NULL) OR EXISTS(SELECT 1 FROM bundles b WHERE b.location_id=planned AND b.physical_status='IN_STOCK' AND NOT EXISTS(SELECT 1 FROM loading_items li JOIN loading_orders lo ON lo.id=li.loading_id WHERE li.bundle_id=b.id AND li.active AND lo.workflow_state IN('DEPARTED_PENDING','DEPARTED_CORRECTION','OUTBOUND'))) THEN RAISE EXCEPTION '规划货位已被Lot锁定或仍有现场实物，不可选择' USING ERRCODE='23514';END IF;
 SELECT * INTO a FROM v262_prior_create(actor,plan,lot,planned,entries);
 INSERT INTO lot_location_claims(location_id,allocation_id) VALUES(planned,a.id);
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'lot_location_claimed','allocations',a.id::text,jsonb_build_object('location_id',planned));
 FOR x IN SELECT b.*,wi.sample_required FROM bundles b JOIN lot_work_items wi ON wi.bundle_id=b.id WHERE wi.allocation_id=a.id LOOP
 IF NOT x.sample_required AND x.gross_weight IS NOT NULL AND x.seal_no IS NOT NULL AND EXISTS(SELECT 1 FROM lot_work_items w JOIN reservations r USING(allocation_id,bundle_id) WHERE w.bundle_id=x.id AND w.allocation_id<>a.id AND w.final_weighed AND w.seal_valid AND r.released_at IS NOT NULL) THEN
 UPDATE allocation_items SET gross_weight=x.gross_weight,net_weight=x.net_weight WHERE allocation_id=a.id AND bundle_id=x.id;
 UPDATE lot_work_items SET final_weighed=true,seal_valid=true,weighed_at=clock_timestamp(),weighed_by=actor,version=version+1 WHERE allocation_id=a.id AND bundle_id=x.id;
 INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,after_data,note) VALUES(a.id,x.id,'INHERIT',actor,jsonb_build_object('gross_weight',x.gross_weight,'net_weight',x.net_weight,'seal_no',x.seal_no),'未重新取样；沿用有效检斤和铅封，不代替新Lot取样');END IF;END LOOP;
 RETURN a;
END $$;
-- Physical custody stays with the original claimed location until supervisor relocation.
-- Effective customer changes on release/reallocation do not fabricate physical movement.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('storage_assert_location(uuid,boolean)'::regprocedure) INTO d;
 d:=replace(d,'count(DISTINCT CASE WHEN', 'count(DISTINCT CASE WHEN');
 d:=replace(d,'SELECT count(*),count(DISTINCT ', 'SELECT count(*),count(DISTINCT coalesce((SELECT sp.customer_id FROM lot_location_claims lc JOIN allocations la ON la.id=lc.allocation_id JOIN sales_plans sp ON sp.id=la.plan_id WHERE lc.location_id=b.location_id AND lc.released_at IS NULL),');
 d:=replace(d,',coalesce(sum(b.net_weight),0) INTO n,k,w', '),coalesce(sum(b.net_weight),0) INTO n,k,w');EXECUTE d;
 SELECT pg_get_functiondef('v261_assert_plan(uuid)'::regprocedure) INTO d;
 d:=replace(d,'coalesce(p.customer_id,b.customer_id) customer', '(coalesce((SELECT sp.customer_id FROM lot_location_claims lc JOIN allocations la ON la.id=lc.allocation_id JOIN sales_plans sp ON sp.id=la.plan_id WHERE lc.location_id=b.location_id AND lc.released_at IS NULL),p.customer_id,b.customer_id)) customer');
 -- A work Lot plans future storage; transferred residual bundles keep old custody meanwhile.
 EXECUTE d;
END $$;
CREATE FUNCTION v262_set_seal(actor uuid,doc uuid,bid uuid,newseal text,why text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE b bundles;w lot_work_items;BEGIN
 newseal:=trim(newseal);IF newseal IS NULL OR newseal='' OR length(newseal)>512 THEN RAISE EXCEPTION '铅封号不能为空且最多512字符' USING ERRCODE='23514';END IF;
 SELECT * INTO b FROM bundles WHERE id=bid FOR UPDATE;SELECT * INTO w FROM lot_work_items WHERE allocation_id=doc AND bundle_id=bid;
 IF NOT w.final_weighed OR (w.sample_required AND w.sample_stage<>'WEIGHED') THEN RAISE EXCEPTION '完成最终检斤后才可确认铅封: %',b.bundle_no USING ERRCODE='23514';END IF;
 INSERT INTO bundle_metadata_history(bundle_id,actor_id,kind,before_data,after_data,reason) VALUES(bid,actor,'SEAL',to_jsonb(b),to_jsonb(b)||jsonb_build_object('seal_no',newseal),coalesce(nullif(trim(why),''),'Lot检斤铅封确认'));
 UPDATE bundles SET seal_no=newseal,version=version+1 WHERE id=bid;
 UPDATE lot_work_items SET seal_valid=true,version=version+1 WHERE allocation_id=doc AND bundle_id=bid;
 INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,before_data,after_data,note) VALUES(doc,bid,'SEAL',actor,jsonb_build_object('seal_no',b.seal_no),jsonb_build_object('seal_no',newseal),coalesce(why,''));
END $$;
ALTER FUNCTION v261_item_action(uuid,uuid,uuid,int,text,jsonb) RENAME TO v262_prior_item;
REVOKE ALL ON FUNCTION v262_prior_item(uuid,uuid,uuid,int,text,jsonb) FROM musonoi_app;
CREATE FUNCTION v261_item_action(actor uuid,doc uuid,bid uuid,expected int,action text,payload jsonb) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE a allocations;p sales_plans;b bundles;BEGIN
 IF action='seal' THEN
 PERFORM v24_revision();SELECT * INTO a FROM allocations WHERE id=doc FOR UPDATE;SELECT * INTO p FROM sales_plans WHERE id=a.plan_id;SELECT * INTO b FROM bundles WHERE id=bid FOR UPDATE;
 IF a.version<>expected OR a.workflow_state NOT IN('WORKING','RECTIFY') OR NOT EXISTS(SELECT 1 FROM reservations WHERE allocation_id=doc AND bundle_id=bid AND released_at IS NULL) THEN RAISE EXCEPTION 'Lot版本或作业状态冲突' USING ERRCODE='23514';END IF;
 PERFORM v23_require(actor,'allocation:write',p.project_id,p.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 PERFORM v262_set_seal(actor,doc,bid,payload->>'seal_no',payload->>'note');UPDATE allocations SET version=version+1 WHERE id=doc RETURNING * INTO a;
 ELSE
 SELECT * INTO a FROM v262_prior_item(actor,doc,bid,expected,action,payload);
 IF action IN('weigh','sample-mark','sample-stage') THEN UPDATE lot_work_items SET seal_valid=false WHERE allocation_id=doc AND bundle_id=bid;END IF;
 IF action='weigh' AND payload ? 'seal_no' THEN PERFORM v262_set_seal(actor,doc,bid,payload->>'seal_no',payload->>'note');END IF;
 END IF;PERFORM v24_capture_bundle(bid);RETURN a;
END $$;
CREATE FUNCTION v262_batch_weigh(actor uuid,doc uuid,expected int,entries jsonb,note text) RETURNS allocations LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE a allocations;x jsonb;w lot_work_items;label text;BEGIN
 PERFORM v24_revision();SELECT * INTO a FROM allocations WHERE id=doc FOR UPDATE;
 IF a.version IS DISTINCT FROM expected OR a.workflow_state NOT IN('WORKING','RECTIFY') THEN RAISE EXCEPTION 'Lot版本已变化，请核对最新数据，未覆盖已有录入' USING ERRCODE='23514';END IF;
 IF jsonb_typeof(entries) IS DISTINCT FROM 'array' OR jsonb_array_length(entries) NOT BETWEEN 1 AND 500 OR (SELECT count(DISTINCT value->>'bundle_id') FROM jsonb_array_elements(entries))<>jsonb_array_length(entries) THEN RAISE EXCEPTION '提交1至500条不重复修改记录' USING ERRCODE='23514';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(entries) ORDER BY value->>'bundle_id' LOOP
 SELECT * INTO w FROM lot_work_items WHERE allocation_id=doc AND bundle_id=(x->>'bundle_id')::uuid FOR UPDATE;
 SELECT bundle_no INTO label FROM bundles WHERE id=(x->>'bundle_id')::uuid;
 IF NOT FOUND OR w.version IS DISTINCT FROM (x->>'item_version')::int OR NOT(x ? 'gross_weight' OR x ? 'seal_no') OR EXISTS(SELECT 1 FROM jsonb_object_keys(x)k WHERE k NOT IN('bundle_id','item_version','gross_weight','seal_no')) THEN RAISE EXCEPTION '捆包 % 版本或修改字段无效',coalesce(label,x->>'bundle_id') USING ERRCODE='23514';END IF;
 BEGIN SELECT * INTO a FROM v261_item_action(actor,doc,(x->>'bundle_id')::uuid,a.version,CASE WHEN x ? 'gross_weight' THEN 'weigh' ELSE 'seal' END,x||jsonb_build_object('note',note));
 EXCEPTION WHEN check_violation THEN RAISE EXCEPTION '捆包 %: %',label,SQLERRM USING ERRCODE='23514';END;
 END LOOP;RETURN a;
END $$;
ALTER FUNCTION v261_check_ready(uuid) RENAME TO v262_prior_ready;
CREATE FUNCTION v261_check_ready(doc uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE missing text;BEGIN
 PERFORM v262_prior_ready(doc);
 SELECT string_agg(b.bundle_no,'、' ORDER BY b.bundle_no) INTO missing FROM lot_work_items w JOIN bundles b ON b.id=w.bundle_id WHERE w.allocation_id=doc AND (NOT w.seal_valid OR nullif(trim(b.seal_no),'') IS NULL);
 IF missing IS NOT NULL THEN RAISE EXCEPTION '缺少有效铅封号或需重新确认铅封: %',missing USING ERRCODE='23514';END IF;
 IF NOT EXISTS(SELECT 1 FROM lot_location_claims c JOIN allocations a ON a.id=c.allocation_id WHERE a.id=doc AND c.location_id=a.planned_location_id AND c.released_at IS NULL) THEN RAISE EXCEPTION 'Lot规划货位独占锁定失效' USING ERRCODE='23514';END IF;
END $$;
CREATE FUNCTION v262_correct_sheets(actor uuid,bid uuid,expected int,sheets int,why text) RETURNS bundles LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE b bundles;BEGIN
 PERFORM v24_revision();SELECT * INTO b FROM bundles WHERE id=bid FOR UPDATE;
 PERFORM v23_require(actor,'users:manage',b.project_id,b.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));
 IF b.version IS DISTINCT FROM expected OR sheets IS NULL OR sheets<=0 OR nullif(trim(why),'') IS NULL THEN RAISE EXCEPTION '版本冲突，或正整数片数及更正原因缺失' USING ERRCODE='23514';END IF;
 INSERT INTO bundle_metadata_history(bundle_id,actor_id,kind,before_data,after_data,reason) VALUES(bid,actor,'SHEETS',to_jsonb(b),to_jsonb(b)||jsonb_build_object('sheets_per_bundle',sheets),why);
 UPDATE bundles SET sheets_per_bundle=sheets,version=version+1 WHERE id=bid RETURNING * INTO b;PERFORM v24_capture_bundle(bid);RETURN b;
END $$;
REVOKE ALL ON FUNCTION v262_sync_claims(),v262_claim_deferred(),v262_set_seal(uuid,uuid,uuid,text,text),v262_prior_ready(uuid),v261_check_ready(uuid),v262_correct_sheets(uuid,uuid,int,int,text),v262_batch_weigh(uuid,uuid,int,jsonb,text),v261_create(uuid,uuid,text,uuid,jsonb),v261_item_action(uuid,uuid,uuid,int,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v261_create(uuid,uuid,text,uuid,jsonb),v261_item_action(uuid,uuid,uuid,int,text,jsonb),v262_batch_weigh(uuid,uuid,int,jsonb,text),v262_correct_sheets(uuid,uuid,int,int,text) TO musonoi_app;
