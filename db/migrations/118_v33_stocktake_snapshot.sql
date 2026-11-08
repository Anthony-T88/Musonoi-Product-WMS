ALTER TABLE stocktakes ADD COLUMN snapshot_on_create boolean NOT NULL DEFAULT false;
ALTER TABLE stocktake_observations ADD COLUMN carried_from_id bigint REFERENCES stocktake_observations(id);
CREATE OR REPLACE FUNCTION v24_count_scope(s jsonb,f jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT s IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_each_text(f) k WHERE k.key NOT IN('customer_id','scope_mode','region_code','location_ids') AND nullif(k.value,'') IS NOT NULL AND s->>k.key IS DISTINCT FROM k.value) AND(nullif(f->>'customer_id','') IS NULL OR coalesce(s->>'allocated_customer_id',s->>'customer_id')=f->>'customer_id') AND(NOT(f ? 'location_ids') OR f->'location_ids' ? (s->>'location_id')) $$;
CREATE FUNCTION v33_stocktake_create(actor uuid,p uuid,w uuid,f jsonb,assignee uuid,kind text,cutoff timestamptz,note text) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d stocktakes;basic jsonb;BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN('project_id','warehouse_id','yard_id','location_id','batch_id','customer_id','scope_mode','region_code','location_ids')) THEN RAISE EXCEPTION '盘点范围无效' USING ERRCODE='23514';END IF;
 IF f ? 'customer_id' AND NOT EXISTS(SELECT 1 FROM customers WHERE id=(f->>'customer_id')::uuid AND project_id=p AND active) THEN RAISE EXCEPTION '盘点客户不属于本项目' USING ERRCODE='23514';END IF;
 IF f ? 'location_ids' AND(jsonb_typeof(f->'location_ids')<>'array' OR jsonb_array_length(f->'location_ids')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(f->'location_ids') id WHERE NOT EXISTS(SELECT 1 FROM locations l WHERE l.id=id::uuid AND l.project_id=p AND l.warehouse_id=w AND l.active))) THEN RAISE EXCEPTION '盘点区域无有效货位' USING ERRCODE='23514';END IF;
 basic:=f-ARRAY['customer_id','scope_mode','region_code','location_ids'];d:=v27_stocktake_create(actor,p,w,basic,assignee,kind,cutoff,note);
 UPDATE stocktakes SET scope=f||jsonb_build_object('project_id',p,'warehouse_id',w),snapshot_on_create=true WHERE id=d.id RETURNING * INTO d;
 INSERT INTO stocktake_snapshot SELECT d.id,h.bundle_id,h.state FROM v32_inventory_history(d.snapshot_revision) h WHERE h.state->>'physical_status'='IN_STOCK' AND v24_count_scope(h.state,d.scope);
 INSERT INTO stocktake_steps(stocktake_id,action,pass,actor_id,note) VALUES(d.id,'SNAPSHOT_CREATED',1,actor,'创建任务时保存库存快照；正常业务不冻结');RETURN d;END $$;
REVOKE ALL ON FUNCTION v33_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v33_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text) TO musonoi_app;
DO $$ DECLARE def text;BEGIN SELECT pg_get_functiondef('stocktake_report(uuid,uuid)'::regprocedure) INTO def;def:=replace(def,'IF d.phase=''DRAFT'' THEN','IF d.phase=''DRAFT'' AND NOT d.snapshot_on_create THEN');EXECUTE def;END $$;
ALTER FUNCTION v27_stocktake_action(uuid,uuid,int,text,text) RENAME TO v33_prior_stocktake_action;
CREATE FUNCTION v27_stocktake_action(actor uuid,doc uuid,expected int,action text,note text) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d stocktakes;r jsonb;BEGIN
 PERFORM v24_revision();SELECT * INTO d FROM stocktakes WHERE id=doc FOR UPDATE;
 IF action='approve' THEN PERFORM v24_count_require(actor,'adjust:approve',d.project_id,d.warehouse_id);END IF;
 IF d.snapshot_on_create THEN
 IF action='start' THEN
 PERFORM v24_count_require(actor,'stocktake:write',d.project_id,d.warehouse_id);IF d.phase<>'DRAFT' OR d.version<>expected OR length(trim(note)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 UPDATE stocktakes SET phase='IN_PROGRESS',version=version+1 WHERE id=doc RETURNING * INTO d;INSERT INTO stocktake_steps(stocktake_id,action,pass,actor_id,note) VALUES(doc,'start',d.current_pass,actor,note||'；沿用创建时库存快照');RETURN d;
 END IF;
 IF action IN('submit-review','review','approve') THEN r:=stocktake_report(actor,doc);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') row WHERE row->>'finding'='UNCOUNTED') THEN RAISE EXCEPTION '盘点范围仍有未清点捆包，请先完成实盘' USING ERRCODE='23514';END IF;
 IF action IN('review','approve') AND d.current_pass=1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') row WHERE row->>'finding' IN('GAIN','LOSS','LOCATION','WEIGHT','STATUS')) THEN RAISE EXCEPTION '盘点差异须先由独立人员复盘，再提交物流经理审批' USING ERRCODE='23514';END IF;END IF;
 END IF;RETURN v33_prior_stocktake_action(actor,doc,expected,action,note);END $$;
REVOKE ALL ON FUNCTION v33_prior_stocktake_action(uuid,uuid,int,text,text),v27_stocktake_action(uuid,uuid,int,text,text) FROM PUBLIC,musonoi_app;
GRANT EXECUTE ON FUNCTION v27_stocktake_action(uuid,uuid,int,text,text) TO musonoi_app;
CREATE FUNCTION v33_stocktake_recount(actor uuid,doc uuid,expected int,note text) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d stocktakes;r jsonb;oldpass int;copied int;BEGIN
 SELECT * INTO d FROM stocktakes WHERE id=doc FOR UPDATE;IF NOT d.snapshot_on_create THEN RAISE EXCEPTION '旧盘点任务继续使用原复盘流程' USING ERRCODE='23514';END IF;
 r:=stocktake_report(actor,doc);oldpass:=d.current_pass;d:=v33_prior_stocktake_action(actor,doc,expected,'reject',note);
 INSERT INTO stocktake_observations(stocktake_id,pass,bundle_no,actual_location_id,actual_weight,observed_revision,counted_by,counted_at,remark,source,present,actual_gross,actual_state,observed_at,carried_from_id)
 SELECT doc,d.current_pass,o.bundle_no,o.actual_location_id,o.actual_weight,o.observed_revision,o.counted_by,o.counted_at,o.remark,o.source,o.present,o.actual_gross,o.actual_state,o.observed_at,o.id FROM stocktake_observations o WHERE o.stocktake_id=doc AND o.pass=oldpass AND NOT EXISTS(SELECT 1 FROM stocktake_observations n WHERE n.replaces_id=o.id) AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') row WHERE row->>'bundle_no'=o.bundle_no AND row->>'finding' NOT IN('GAIN','LOSS','LOCATION','WEIGHT','STATUS','DUPLICATE','UNCOUNTED','UNVERIFIED_MOVEMENT') AND NOT coalesce((row->>'weight_mismatch')::boolean,false) AND NOT coalesce((row->>'location_mismatch')::boolean,false));
 GET DIAGNOSTICS copied=ROW_COUNT;INSERT INTO stocktake_steps(stocktake_id,action,pass,actor_id,note) VALUES(doc,'RECOUNT_STARTED',d.current_pass,actor,note||'；沿用无差异记录'||copied||'条');RETURN d;END $$;
REVOKE ALL ON FUNCTION v33_stocktake_recount(uuid,uuid,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v33_stocktake_recount(uuid,uuid,int,text) TO musonoi_app;
ALTER FUNCTION v27_stocktake_record(uuid,uuid,int,jsonb) RENAME TO v33_prior_stocktake_record;
CREATE FUNCTION v27_stocktake_record(actor uuid,doc uuid,expected int,entries jsonb) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d stocktakes;BEGIN
 SELECT * INTO d FROM stocktakes WHERE id=doc FOR UPDATE;
 IF d.snapshot_on_create AND d.current_pass>1 AND EXISTS(SELECT 1 FROM jsonb_array_elements(entries) x JOIN stocktake_observations o ON o.stocktake_id=doc AND o.pass=1 AND v265_bundle_key(o.bundle_no)=v265_bundle_key(x->>'bundle_no') WHERE o.counted_by=actor) THEN RAISE EXCEPTION '差异复盘须由初盘之外的独立人员实盘' USING ERRCODE='23514';END IF;
 RETURN v33_prior_stocktake_record(actor,doc,expected,entries);END $$;
REVOKE ALL ON FUNCTION v33_prior_stocktake_record(uuid,uuid,int,jsonb),v27_stocktake_record(uuid,uuid,int,jsonb) FROM PUBLIC,musonoi_app;
GRANT EXECUTE ON FUNCTION v27_stocktake_record(uuid,uuid,int,jsonb) TO musonoi_app;
-- A counter may prepare an adjustment only AFTER independent count approval;
-- the existing independent adjustment approver remains mandatory.
DO $$ DECLARE def text;BEGIN SELECT pg_get_functiondef('v27_stocktake_resolve(uuid,uuid,int,text,text,jsonb,text)'::regprocedure) INTO def;
 def:=replace(def,'OR actor=d.created_by OR EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND counted_by=actor)','OR((actor=d.created_by OR EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND counted_by=actor)) AND NOT(d.snapshot_on_create AND method=''ADJUSTMENT'' AND d.status=''APPROVED''))');EXECUTE def;END $$;
INSERT INTO role_permissions(role_code,permission_code) SELECT r,p FROM unnest(ARRAY['logistics_operator','site_supervisor','logistics_manager']) r CROSS JOIN unnest(ARRAY['stocktake:read','stocktake:write','move:write']) p ON CONFLICT DO NOTHING;
INSERT INTO role_permissions VALUES('site_supervisor','stocktake:review'),('site_supervisor','adjust:read'),('site_supervisor','adjust:write'),('logistics_manager','stocktake:review'),('logistics_manager','adjust:read'),('logistics_manager','adjust:approve') ON CONFLICT DO NOTHING;
