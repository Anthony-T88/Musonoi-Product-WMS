ALTER TABLE inventory_events ADD COLUMN weight_known boolean NOT NULL DEFAULT true;
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('adjustment_create(uuid,uuid,uuid,text,jsonb,uuid)'::regprocedure) INTO d;
 d:=replace(d,'{0,79}','{0,511}');
 d:=replace(d,'IF kind=''GAIN'' THEN IF FOUND', $n$IF kind IN('GAIN','WEIGHT') AND(coalesce(x->>'gross_weight','')!~'^d{1,8}(.d{1,4})?$' OR(x->>'gross_weight')::numeric<=0.0025 OR(x->>'net_weight')::numeric IS DISTINCT FROM(x->>'gross_weight')::numeric-0.0025) THEN RAISE EXCEPTION 'V27_GROSS_BASIS_REQUIRED' USING ERRCODE='23514';END IF;
 IF kind='GAIN' AND length(trim(coalesce(x->>'basis_document','')))<5 THEN RAISE EXCEPTION 'V27_GAIN_DOCUMENT_REQUIRED' USING ERRCODE='23514';END IF;
 IF kind='GAIN' THEN IF FOUND$n$);
 d:=replace(d,'before:=jsonb_build_object(''net_weight'',b.net_weight::text', 'before:=jsonb_build_object(''gross_weight'',b.gross_weight::text,''packaging_weight'',b.packaging_weight::text,''net_weight'',b.net_weight::text');
 d:=replace(d,'IF coalesce(after->>''net_weight'','''')!~', 'IF NOT(kind IN(''LOSS'',''LOCATION'') AND b.net_weight IS NULL) AND coalesce(after->>''net_weight'','''')!~');
 d:=replace(d,'INSERT INTO adjustment_lines(adjustment_id', $n$IF kind IN('GAIN','WEIGHT') THEN after:=after||jsonb_build_object('gross_weight',x->>'gross_weight','packaging_weight','0.0025','basis_document',x->>'basis_document');END IF;
 INSERT INTO adjustment_lines(adjustment_id$n$);EXECUTE d;
 SELECT pg_get_functiondef('adjustment_action(uuid,uuid,int,text,text)'::regprocedure) INTO d;
 d:=replace(d,'customer_id,net_weight,physical_status,sample_status,inbound_date','customer_id,gross_weight,packaging_weight,weight_rule_version,net_weight,physical_status,sample_status,inbound_date');
 d:=replace(d,')::uuid,qty,''IN_STOCK'',''NOT_SAMPLED''', ')::uuid,(l.after_data->>''gross_weight'')::numeric,0.0025,''GROSS_MINUS_PACKAGING'',qty,''IN_STOCK'',''NOT_SAMPLED''');
 d:=replace(d,'WHEN ''LOSS'' THEN -b.net_weight','WHEN ''LOSS'' THEN coalesce(-b.net_weight,0)');
 d:=replace(d,'UPDATE bundles SET net_weight=qty,location_id=', 'UPDATE bundles SET gross_weight=CASE WHEN l.kind=''WEIGHT'' THEN(l.after_data->>''gross_weight'')::numeric ELSE gross_weight END,packaging_weight=CASE WHEN l.kind=''WEIGHT'' THEN 0.0025 ELSE packaging_weight END,net_weight=qty,location_id=');
 d:=replace(d,'inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(bid,''ADJUST_''||l.kind,delta,actor', 'inventory_events(bundle_id,event_type,physical_delta,weight_known,actor_id,before_data,after_data) VALUES(bid,''ADJUST_''||l.kind,delta,(l.after_data->>''net_weight'') IS NOT NULL,actor');EXECUTE d;
 SELECT pg_get_functiondef('confirmed_bundle_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN', $n$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND NEW.net_weight=NEW.gross_weight-0.0025 AND NEW.packaging_weight=0.0025 AND NEW.version=OLD.version+1 AND(to_jsonb(NEW)-ARRAY['version','net_weight','gross_weight','packaging_weight'])=(to_jsonb(OLD)-ARRAY['version','net_weight','gross_weight','packaging_weight']) AND EXISTS(SELECT 1 FROM adjustment_lines l JOIN stock_adjustments a ON a.id=l.adjustment_id WHERE a.status='APPLIED' AND a.applied_txid=txid_current() AND l.kind='WEIGHT' AND l.bundle_no=OLD.bundle_no AND(l.after_data->>'gross_weight')::numeric=NEW.gross_weight AND(l.after_data->>'net_weight')::numeric=NEW.net_weight AND(l.before_data->>'net_weight')::numeric IS NOT DISTINCT FROM OLD.net_weight) THEN RETURN NEW;END IF;
 $n$);EXECUTE d;
END $$;
CREATE FUNCTION v27_stocktake_resolve(actor uuid,doc uuid,expected int,label text,method text,payload jsonb,reason text) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d stocktakes;row jsonb;e inventory_exceptions;a stock_adjustments;receipt receipts;kind text;entries jsonb;BEGIN
 PERFORM v24_revision();SELECT * INTO d FROM stocktakes WHERE id=doc FOR UPDATE;PERFORM v24_count_require(actor,'stocktake:review',d.project_id,d.warehouse_id);
 IF d.phase<>'ADJUSTMENTS' OR d.version IS DISTINCT FROM expected OR length(trim(reason)) NOT BETWEEN 5 AND 2000 OR actor=d.created_by OR EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND counted_by=actor) THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 SELECT value INTO row FROM jsonb_array_elements(d.approved_report->'rows') WHERE value->>'bundle_no'=label AND value->>'finding' IN('LOSS','GAIN','LOCATION','WEIGHT','STATUS');IF NOT FOUND THEN RAISE EXCEPTION 'V27_DIFFERENCE_NOT_FOUND' USING ERRCODE='23514';END IF;
 IF method='ADJUSTMENT' THEN
 IF row->>'finding'='STATUS' THEN RAISE EXCEPTION 'V27_USE_RELATED_WORKFLOW' USING ERRCODE='23514';END IF;
 kind:=row->>'finding';SELECT * INTO e FROM exception_manual(actor,d.project_id,d.warehouse_id,label,kind,reason);
 entries:=jsonb_build_array(jsonb_build_object('kind',kind,'bundle_no',label,'location_id',payload->>'location_id','gross_weight',payload->>'gross_weight','net_weight',CASE WHEN payload->>'gross_weight' IS NOT NULL THEN((payload->>'gross_weight')::numeric-0.0025)::text END,'basis_document',payload->>'basis_document','batch_id',payload->>'batch_id','customer_id',payload->>'customer_id','production_date',payload->>'production_date'));
 SELECT * INTO a FROM adjustment_create(actor,d.project_id,e.id,reason,entries,NULL);UPDATE stock_adjustments SET stocktake_id=doc WHERE id=a.id;
 ELSIF method='INBOUND' THEN
 SELECT * INTO receipt FROM receipts WHERE id=(payload->>'receipt_id')::uuid AND project_id=d.project_id AND status='CONFIRMED';
 IF row->>'finding'<>'GAIN' OR NOT FOUND OR NOT EXISTS(SELECT 1 FROM bundles WHERE receipt_id=receipt.id AND v265_bundle_key(bundle_no)=v265_bundle_key(label)) THEN RAISE EXCEPTION 'V27_GAIN_DOCUMENT_REQUIRED' USING ERRCODE='23514';END IF;
 ELSIF method='VERIFIED' THEN
 -- Verification can explain a state discrepancy, never silently waive quantity/weight differences.
 IF row->>'finding'<>'STATUS' THEN RAISE EXCEPTION 'V27_USE_ADJUSTMENT_OR_RECOUNT' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 INSERT INTO stocktake_resolutions(stocktake_id,pass,bundle_no,finding,method,adjustment_id,receipt_id,reason,actor_id) VALUES(doc,d.current_pass,label,row->>'finding',method,a.id,receipt.id,reason,actor);
 UPDATE stocktakes SET version=version+1 WHERE id=doc RETURNING * INTO d;INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'stocktake_resolution','stocktakes',doc::text,jsonb_build_object('bundle_no',label,'method',method,'adjustment_id',a.id,'receipt_id',receipt.id,'reason',reason));RETURN d;
END $$;
REVOKE ALL ON FUNCTION v27_stocktake_resolve(uuid,uuid,int,text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v27_stocktake_resolve(uuid,uuid,int,text,text,jsonb,text) TO musonoi_app;
