CREATE TABLE outbound_corrections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE DEFAULT('COR-'||gen_random_uuid()::text),loading_id uuid NOT NULL REFERENCES loading_orders(id),kind text NOT NULL CHECK(kind IN('CANCEL_LOAD','RETURN_OUTBOUND','VEHICLE')),
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN('REQUESTED','AUTHORIZED','RETURN_VERIFIED','APPLIED','REJECTED')),reason text NOT NULL,requested_by uuid NOT NULL REFERENCES users(id),requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),authorized_by uuid REFERENCES users(id),authorized_at timestamptz,verified_by uuid REFERENCES users(id),verified_at timestamptz,applied_by uuid REFERENCES users(id),applied_at timestamptz,applied_revision bigint REFERENCES inventory_revisions(id),applied_txid bigint,original_snapshot jsonb NOT NULL,proposed_data jsonb NOT NULL,bundle_snapshot jsonb NOT NULL,version integer NOT NULL DEFAULT 1);
CREATE UNIQUE INDEX one_open_load_correction ON outbound_corrections(loading_id) WHERE status IN('REQUESTED','AUTHORIZED','RETURN_VERIFIED');
CREATE UNIQUE INDEX one_formal_load_return ON outbound_corrections(loading_id) WHERE kind='RETURN_OUTBOUND' AND status='APPLIED';
CREATE TABLE outbound_correction_steps(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,correction_id uuid NOT NULL REFERENCES outbound_corrections(id),action text NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),reason text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER correction_owner BEFORE UPDATE OR DELETE ON outbound_corrections FOR EACH ROW EXECUTE FUNCTION v23_state_owner();
CREATE TRIGGER correction_steps_immutable BEFORE UPDATE OR DELETE ON outbound_correction_steps FOR EACH ROW EXECUTE FUNCTION v23_immutable();
GRANT SELECT ON outbound_corrections,outbound_correction_steps TO musonoi_app;
CREATE FUNCTION v27_correction_create(actor uuid,loadid uuid,expected int,kind text,reason text,payload jsonb) RETURNS outbound_corrections LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE l loading_orders;q outbound_corrections;b record;BEGIN
 PERFORM v24_revision();SELECT * INTO l FROM loading_orders WHERE id=loadid FOR UPDATE;
 IF NOT FOUND OR l.version IS DISTINCT FROM expected OR length(trim(reason)) NOT BETWEEN 5 AND 2000 OR kind NOT IN('CANCEL_LOAD','RETURN_OUTBOUND','VEHICLE') THEN RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 FOR b IN SELECT bb.*,loc.warehouse_id FROM loading_items i JOIN bundles bb ON bb.id=i.bundle_id JOIN locations loc ON loc.id=bb.location_id WHERE i.loading_id=loadid LOOP PERFORM v23_require(actor,'load:write',l.project_id,l.customer_id,b.warehouse_id);END LOOP;
 IF kind='RETURN_OUTBOUND' AND l.workflow_state IS DISTINCT FROM 'OUTBOUND' OR kind='CANCEL_LOAD' AND l.workflow_state NOT IN('PENDING','READY','REJECTED','DEPARTED_PENDING','DEPARTED_CORRECTION') OR l.status IN('CANCELLED','REVERSED') THEN RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 IF kind='VEHICLE' AND nullif(trim(payload->>'vehicle_no'),'') IS NULL THEN RAISE EXCEPTION 'V27_CORRECTION_EVIDENCE_REQUIRED' USING ERRCODE='23514';END IF;
 INSERT INTO outbound_corrections(loading_id,kind,reason,requested_by,original_snapshot,proposed_data,bundle_snapshot) VALUES(loadid,kind,reason,actor,to_jsonb(l),payload,
 (SELECT jsonb_agg(jsonb_build_object('bundle_id',b.id,'bundle_no',b.bundle_no,'version',b.version,'physical_status',b.physical_status,'location_id',b.location_id,'net_weight',b.net_weight,'reservation_id',i.reservation_id)) FROM loading_items i JOIN bundles b ON b.id=i.bundle_id WHERE i.loading_id=loadid)) RETURNING * INTO q;
 INSERT INTO outbound_correction_steps(correction_id,action,actor_id,reason) VALUES(q.id,'REQUEST',actor,reason);INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'outbound_correction_request','outbound_corrections',q.id::text,to_jsonb(q));RETURN q;
END $$;
CREATE FUNCTION v27_correction_action(actor uuid,doc uuid,expected int,action text,reason text) RETURNS outbound_corrections LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE q outbound_corrections;l loading_orders;b bundles;i loading_items;x jsonb;destination locations;r bigint;a allocations;BEGIN
 r:=v24_revision();SELECT * INTO q FROM outbound_corrections WHERE id=doc FOR UPDATE;SELECT * INTO l FROM loading_orders WHERE id=q.loading_id FOR UPDATE;
 IF NOT FOUND OR q.version IS DISTINCT FROM expected OR length(trim(reason)) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(q.bundle_snapshot) LOOP SELECT * INTO b FROM bundles WHERE id=(x->>'bundle_id')::uuid;PERFORM v23_require(actor,CASE WHEN action='verify-return' THEN 'load:review' ELSE 'outbound:approve' END,l.project_id,l.customer_id,(SELECT warehouse_id FROM locations WHERE id=b.location_id));END LOOP;
 IF actor=q.requested_by THEN RAISE EXCEPTION 'V27_INDEPENDENT_CORRECTION_REVIEWER_REQUIRED' USING ERRCODE='23514';END IF;
 IF action='authorize' AND q.status='REQUESTED' THEN UPDATE outbound_corrections SET status='AUTHORIZED',authorized_by=actor,authorized_at=v24_posting_time() WHERE id=doc;
 ELSIF action='reject' AND q.status IN('REQUESTED','AUTHORIZED','RETURN_VERIFIED') THEN UPDATE outbound_corrections SET status='REJECTED' WHERE id=doc;
 ELSIF action='verify-return' AND q.status='AUTHORIZED' AND q.kind<>'VEHICLE' THEN
 IF q.proposed_data->>'physical_return_verified' IS DISTINCT FROM 'true' OR length(trim(coalesce(q.proposed_data->>'physical_evidence','')))<5 THEN RAISE EXCEPTION 'V27_CORRECTION_EVIDENCE_REQUIRED' USING ERRCODE='23514';END IF;
 UPDATE outbound_corrections SET status='RETURN_VERIFIED',verified_by=actor,verified_at=v24_posting_time() WHERE id=doc;
 ELSIF action='apply' AND(q.status='RETURN_VERIFIED' OR q.status='AUTHORIZED' AND q.kind='VEHICLE') THEN
 IF q.kind<>'VEHICLE' THEN SELECT * INTO destination FROM locations WHERE id=(q.proposed_data->>'return_location_id')::uuid AND project_id=l.project_id AND active AND map_usage='TEMPORARY';IF NOT FOUND THEN RAISE EXCEPTION 'V27_RETURN_LOCATION_REQUIRED' USING ERRCODE='23514';END IF;END IF;
 IF q.kind='RETURN_OUTBOUND' AND(l.workflow_state<>'OUTBOUND' OR l.status<>'DEPARTED' OR EXISTS(SELECT 1 FROM sales_plans p JOIN allocations a ON a.plan_id=p.id WHERE a.id=l.allocation_id AND p.status<>'OPEN')) THEN RAISE EXCEPTION 'V27_PLAN_REOPEN_REQUIRED' USING ERRCODE='23514';END IF;
 UPDATE outbound_corrections SET status='APPLIED',applied_by=actor,applied_at=v24_posting_time(),applied_revision=r,applied_txid=txid_current() WHERE id=doc;
 IF q.kind='VEHICLE' THEN
 -- Preserve the original vehicle on the posted document; the associated correction is authoritative display data.
 IF l.workflow_state<>'OUTBOUND' THEN UPDATE loading_orders SET vehicle_no=trim(q.proposed_data->>'vehicle_no'),version=version+1 WHERE id=l.id;END IF;
 ELSE
 FOR x IN SELECT value FROM jsonb_array_elements(q.bundle_snapshot) ORDER BY value->>'bundle_id' LOOP
 SELECT * INTO b FROM bundles WHERE id=(x->>'bundle_id')::uuid FOR UPDATE;SELECT * INTO i FROM loading_items WHERE loading_id=l.id AND bundle_id=b.id;
 IF b.version<>(x->>'version')::int OR EXISTS(SELECT 1 FROM reservations WHERE bundle_id=b.id AND released_at IS NULL AND allocation_id<>l.allocation_id) OR(q.kind='RETURN_OUTBOUND' AND b.physical_status<>'OUTBOUND') OR(q.kind='CANCEL_LOAD' AND b.physical_status<>'IN_STOCK') THEN RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 IF q.kind='CANCEL_LOAD' THEN
 UPDATE loading_items SET active=false,removed_at=v24_posting_time(),removed_reason='Authorized cancellation '||q.code WHERE loading_id=l.id AND bundle_id=b.id AND active;
 UPDATE reservations SET released_at=v24_posting_time(),released_by=actor,release_reason='Authorized cancellation '||q.code WHERE id=i.reservation_id AND released_at IS NULL;
 END IF;
 UPDATE bundles SET physical_status='IN_STOCK',location_id=destination.id,version=version+1 WHERE id=b.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(b.id,CASE WHEN q.kind='RETURN_OUTBOUND' THEN 'REVERSAL' ELSE 'UNLOAD' END,CASE WHEN q.kind='RETURN_OUTBOUND' THEN b.net_weight ELSE 0 END,actor,to_jsonb(b),jsonb_build_object('correction_id',doc,'loading_id',l.id,'location_id',destination.id,'physical_evidence',q.proposed_data->>'physical_evidence'));
 END LOOP;
 IF q.kind='CANCEL_LOAD' THEN
 UPDATE loading_orders SET status='CANCELLED',workflow_state='REJECTED',cancel_reason=q.reason,cancelled_by=actor,cancelled_at=v24_posting_time(),version=version+1 WHERE id=l.id;
 IF NOT EXISTS(SELECT 1 FROM reservations WHERE allocation_id=l.allocation_id AND released_at IS NULL) THEN UPDATE allocations SET status=CASE WHEN EXISTS(SELECT 1 FROM loading_orders WHERE allocation_id=l.allocation_id AND workflow_state='OUTBOUND') THEN 'FULFILLED' ELSE 'RELEASED' END,workflow_state=CASE WHEN EXISTS(SELECT 1 FROM loading_orders WHERE allocation_id=l.allocation_id AND workflow_state='OUTBOUND') THEN 'FULFILLED' ELSE 'CANCELLED' END,version=version+1 WHERE id=l.allocation_id;END IF;
 END IF;
 PERFORM v262_sync_claims();FOR x IN SELECT value FROM jsonb_array_elements(q.bundle_snapshot) LOOP PERFORM v24_capture_bundle((x->>'bundle_id')::uuid);END LOOP;
 END IF;
 ELSE RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 UPDATE outbound_corrections SET version=version+1 WHERE id=doc RETURNING * INTO q;INSERT INTO outbound_correction_steps(correction_id,action,actor_id,reason) VALUES(doc,action,actor,reason);INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data) VALUES(actor,'outbound_correction_'||action,'outbound_corrections',doc::text,jsonb_build_object('loading_id',l.id,'original',q.original_snapshot),to_jsonb(q));RETURN q;
END $$;
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('reservation_guard()'::regprocedure) INTO d;
 d:=replace(d,'BEGIN', $n$BEGIN
 IF TG_OP='UPDATE' AND current_user='musonoi_owner' AND OLD.released_at IS NULL AND NEW.released_at IS NOT NULL AND(to_jsonb(NEW)-ARRAY['released_at','released_by','release_reason'])=(to_jsonb(OLD)-ARRAY['released_at','released_by','release_reason']) AND EXISTS(SELECT 1 FROM outbound_corrections q JOIN loading_orders l ON l.id=q.loading_id JOIN loading_items i ON i.loading_id=l.id AND i.reservation_id=OLD.id WHERE q.kind='CANCEL_LOAD' AND q.status='APPLIED' AND q.applied_txid=txid_current() AND q.applied_by=NEW.released_by) THEN RETURN NEW;END IF;
 $n$);EXECUTE d;
 SELECT pg_get_functiondef('v265_plan_progress(uuid)'::regprocedure) INTO d;
 d:=replace(d,'AND lo.workflow_state = ''OUTBOUND''::text', 'AND lo.workflow_state = ''OUTBOUND''::text AND NOT EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=lo.id AND cr.kind=''RETURN_OUTBOUND'' AND cr.status=''APPLIED'')');
 -- pg_get_functiondef may preserve SQL source without pretty-printing.
 d:=replace(d,'AND lo.workflow_state=''OUTBOUND''','AND lo.workflow_state=''OUTBOUND'' AND NOT EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=lo.id AND cr.kind=''RETURN_OUTBOUND'' AND cr.status=''APPLIED'')');
 d:=replace(d,'a.workflow_state IS DISTINCT FROM ''CANCELLED''', '(a.workflow_state IS DISTINCT FROM ''CANCELLED'' OR EXISTS(SELECT 1 FROM outbound_corrections cr JOIN loading_orders cl ON cl.id=cr.loading_id WHERE cl.allocation_id=a.id AND cr.status=''APPLIED'' AND cr.kind=''CANCEL_LOAD'' AND cr.original_snapshot->>''workflow_state'' IN(''READY'',''DEPARTED_PENDING'',''DEPARTED_CORRECTION'')))');EXECUTE d;
END $$;
REVOKE ALL ON FUNCTION v27_correction_create(uuid,uuid,int,text,text,jsonb),v27_correction_action(uuid,uuid,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v27_correction_create(uuid,uuid,int,text,text,jsonb),v27_correction_action(uuid,uuid,int,text,text) TO musonoi_app;
