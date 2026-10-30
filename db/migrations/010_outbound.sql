CREATE TABLE outbound_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text NOT NULL UNIQUE DEFAULT('OUT-'||gen_random_uuid()::text),project_id uuid NOT NULL REFERENCES projects(id),customer_id uuid NOT NULL REFERENCES customers(id),loading_id uuid NOT NULL REFERENCES loading_orders(id),weighing_id uuid NOT NULL REFERENCES weighings(id),status text NOT NULL DEFAULT 'CREATED' CHECK(status IN('CREATED','PACKING_CONFIRMED','COMMERCIAL_APPROVED','GATE_VERIFIED','DEPARTED','CANCELLED','REVERSED')),created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),packing_by uuid REFERENCES users(id),packing_at timestamptz,commerce_by uuid REFERENCES users(id),commerce_at timestamptz,gate_by uuid REFERENCES users(id),gate_at timestamptz,gate_observed_at timestamptz,departed_by uuid REFERENCES users(id),departed_at timestamptz,confirmed_at timestamptz,variance_by uuid REFERENCES users(id),variance_at timestamptz,variance_reason text,cancel_reason text,reversal_status text NOT NULL DEFAULT 'NONE' CHECK(reversal_status IN('NONE','REQUESTED','AUTHORIZED','RETURN_VERIFIED','CONFIRMED')),reversal_reason text,reversal_requested_by uuid REFERENCES users(id),reversal_approved_by uuid REFERENCES users(id),return_verified_by uuid REFERENCES users(id),return_observed_at timestamptz,reversed_by uuid REFERENCES users(id),reversed_at timestamptz,version int NOT NULL DEFAULT 1,FOREIGN KEY(project_id,customer_id) REFERENCES customers(project_id,id));
CREATE UNIQUE INDEX one_live_outbound ON outbound_orders(loading_id) WHERE status<>'CANCELLED';
CREATE TABLE outbound_steps(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,outbound_id uuid NOT NULL REFERENCES outbound_orders(id),action text NOT NULL,result text NOT NULL,remark text NOT NULL,payload jsonb NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TRIGGER outbound_history BEFORE UPDATE OR DELETE ON outbound_orders FOR EACH ROW EXECUTE FUNCTION v23_state_owner();
CREATE TRIGGER outbound_steps_history BEFORE UPDATE OR DELETE ON outbound_steps FOR EACH ROW EXECUTE FUNCTION v23_immutable();
REVOKE INSERT ON outbound_steps FROM musonoi_app;
CREATE FUNCTION outbound_creation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE l loading_orders;w weighings;BEGIN
 SELECT * INTO l FROM loading_orders WHERE id=NEW.loading_id FOR UPDATE;SELECT * INTO w FROM weighings WHERE id=NEW.weighing_id FOR UPDATE;
 IF l.status<>'LOADED' OR NEW.status<>'CREATED' OR w.status<>'RECORDED' OR w.kind<>'VEHICLE' OR w.loading_id<>l.id OR NEW.project_id<>l.project_id OR NEW.customer_id<>l.customer_id OR w.vehicle_no<>l.vehicle_no OR w.weighed_at<l.loaded_at OR NEW.reversal_status<>'NONE' THEN RAISE EXCEPTION 'Outbound requires completed matching loading and vehicle weighing' USING ERRCODE='23514';END IF;
 IF w.id<>(SELECT id FROM weighings WHERE loading_id=l.id AND status='RECORDED' ORDER BY created_at DESC,id DESC LIMIT 1) OR EXISTS((SELECT bundle_id FROM loading_items WHERE loading_id=l.id AND active EXCEPT SELECT bundle_id FROM weighing_items WHERE weighing_id=w.id) UNION ALL(SELECT bundle_id FROM weighing_items WHERE weighing_id=w.id EXCEPT SELECT bundle_id FROM loading_items WHERE loading_id=l.id AND active)) OR w.bundle_weight<>(SELECT sum(original_weight) FROM loading_items WHERE loading_id=l.id AND active) THEN RAISE EXCEPTION 'Weighing must match every loaded bundle and latest valid ticket' USING ERRCODE='23514';END IF;
 PERFORM v23_require(NEW.created_by,'load:write',l.project_id,l.customer_id,NULL);RETURN NEW;END $$;
CREATE TRIGGER outbound_creation BEFORE INSERT ON outbound_orders FOR EACH ROW EXECUTE FUNCTION outbound_creation_guard();
CREATE FUNCTION outbound_dependency_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='weighings' THEN IF NEW.loading_id IS NOT NULL AND EXISTS(SELECT 1 FROM outbound_orders WHERE loading_id=NEW.loading_id AND status<>'CANCELLED') THEN RAISE EXCEPTION 'Cancel outbound approval before changing weighing; departed tickets immutable' USING ERRCODE='23514';END IF;
 ELSE IF NEW.status='CANCELLED' AND EXISTS(SELECT 1 FROM outbound_orders WHERE loading_id=OLD.id AND status<>'CANCELLED') THEN RAISE EXCEPTION 'Cancel outbound approval before unloading' USING ERRCODE='23514';END IF;END IF;RETURN NEW;END $$;
CREATE TRIGGER outbound_weighing_dependency BEFORE INSERT OR UPDATE ON weighings FOR EACH ROW EXECUTE FUNCTION outbound_dependency_guard();
CREATE TRIGGER outbound_loading_dependency BEFORE UPDATE ON loading_orders FOR EACH ROW EXECUTE FUNCTION outbound_dependency_guard();
-- Departure consumes locks through the authorized owner function; normal release remains API-permission gated.
DO $$ DECLARE definition text;BEGIN SELECT pg_get_functiondef('reservation_guard()'::regprocedure) INTO definition;definition:=replace(definition,$find$rp.permission_code='allocation:release'$find$,$find$rp.permission_code IN('allocation:release','outbound:depart')$find$);EXECUTE definition;END $$;
ALTER TABLE allocations DROP CONSTRAINT allocations_status_check;
ALTER TABLE allocations ADD CHECK(status IN('DRAFT','LOCKED','RELEASED','FULFILLED'));
DO $$ DECLARE definition text;BEGIN SELECT pg_get_functiondef('allocation_history_guard()'::regprocedure) INTO definition;definition:=replace(definition,$find$IF OLD.status='DRAFT' AND NEW.status='LOCKED' THEN$find$,$find$IF OLD.status='LOCKED' AND NEW.status='FULFILLED' AND current_user='musonoi_owner' AND NOT EXISTS(SELECT 1 FROM reservations WHERE allocation_id=OLD.id AND released_at IS NULL) THEN RETURN NEW; ELSIF OLD.status='DRAFT' AND NEW.status='LOCKED' THEN$find$);EXECUTE definition;END $$;
CREATE UNIQUE INDEX one_dispatch_event ON inventory_events(bundle_id,event_type,(after_data->>'outbound_id')) WHERE event_type IN('OUTBOUND','REVERSAL');
CREATE FUNCTION outbound_action(actor uuid,doc uuid,expected int,action text,payload jsonb) RETURNS outbound_orders LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE d outbound_orders;l loading_orders;w weighings;i loading_items;b bundles;warehouse uuid;perm text;note text;stamp timestamptz;old_data jsonb;BEGIN
 SELECT * INTO d FROM outbound_orders WHERE id=doc FOR UPDATE;
 IF NOT FOUND OR d.version<>expected THEN RAISE EXCEPTION 'Outbound version conflict' USING ERRCODE='23514';END IF;old_data:=to_jsonb(d);
 SELECT * INTO l FROM loading_orders WHERE id=d.loading_id FOR UPDATE;SELECT * INTO w FROM weighings WHERE id=d.weighing_id FOR UPDATE;
 perm:=CASE action WHEN 'packing' THEN 'outbound:packing' WHEN 'commerce' THEN 'outbound:commerce' WHEN 'gate' THEN 'outbound:gate' WHEN 'depart' THEN 'outbound:depart' WHEN 'return-verify' THEN 'outbound:gate' WHEN 'reverse-confirm' THEN 'outbound:depart' ELSE 'outbound:supervise' END;
 note:=trim(coalesce(payload->>'remark',''));IF length(note) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Workflow remark required' USING ERRCODE='23514';END IF;
 FOR b IN SELECT x.* FROM bundles x JOIN loading_items z ON z.bundle_id=x.id WHERE z.loading_id=l.id ORDER BY x.id LOOP SELECT warehouse_id INTO warehouse FROM locations WHERE id=b.location_id;PERFORM v23_require(actor,perm,d.project_id,d.customer_id,warehouse);END LOOP;
 IF action='variance-approve' THEN
 IF d.status NOT IN('CREATED','PACKING_CONFIRMED') OR w.difference=0 OR actor=w.created_by OR d.variance_by IS NOT NULL THEN RAISE EXCEPTION 'Invalid independent variance approval' USING ERRCODE='23514';END IF;UPDATE outbound_orders SET variance_by=actor,variance_at=now(),variance_reason=note WHERE id=doc;
 ELSIF action='packing' THEN
 IF d.status<>'CREATED' OR l.status<>'LOADED' OR coalesce(payload->>'packing_checked','')<>'true' THEN RAISE EXCEPTION 'Production packing confirmation required' USING ERRCODE='23514';END IF;UPDATE outbound_orders SET status='PACKING_CONFIRMED',packing_by=actor,packing_at=now() WHERE id=doc;
 ELSIF action='commerce' THEN
 IF d.status<>'PACKING_CONFIRMED' OR actor=d.packing_by OR coalesce(payload->>'documents_checked','')<>'true' OR coalesce(payload->>'conditions_checked','')<>'true' OR(w.difference<>0 AND d.variance_by IS NULL) THEN RAISE EXCEPTION 'Independent commercial review and variance resolution required' USING ERRCODE='23514';END IF;UPDATE outbound_orders SET status='COMMERCIAL_APPROVED',commerce_by=actor,commerce_at=now() WHERE id=doc;
 ELSIF action='gate' THEN
 stamp:=(payload->>'observed_at')::timestamptz;
 IF d.status<>'COMMERCIAL_APPROVED' OR actor IN(d.packing_by,d.commerce_by) OR coalesce(payload->>'actual_departure','')<>'true' OR coalesce(payload->>'vehicle_checked','')<>'true' OR stamp IS NULL OR stamp<d.commerce_at OR stamp>now()+interval '1 minute' THEN RAISE EXCEPTION 'Independent security actual-departure observation required' USING ERRCODE='23514';END IF;UPDATE outbound_orders SET status='GATE_VERIFIED',gate_by=actor,gate_at=now(),gate_observed_at=stamp WHERE id=doc;
 ELSIF action='depart' THEN
 IF d.status<>'GATE_VERIFIED' OR l.status<>'LOADED' OR actor IN(d.commerce_by,d.gate_by) OR coalesce(payload->>'actual_departure','')<>'true' OR w.status<>'RECORDED' THEN RAISE EXCEPTION 'Only production actual departure confirmation decrements inventory' USING ERRCODE='23514';END IF;
 -- Lock preparation and plans before bundles to serialize reservation release and dispatch.
 PERFORM a.id FROM allocations a WHERE id IN(SELECT r.allocation_id FROM reservations r JOIN loading_items z ON z.reservation_id=r.id WHERE z.loading_id=l.id) ORDER BY a.id FOR UPDATE;
 PERFORM p.id FROM sales_plans p WHERE id IN(SELECT a.plan_id FROM allocations a JOIN reservations r ON r.allocation_id=a.id JOIN loading_items z ON z.reservation_id=r.id WHERE z.loading_id=l.id) ORDER BY p.id FOR UPDATE;
 FOR i IN SELECT * FROM loading_items WHERE loading_id=l.id ORDER BY bundle_id LOOP
 SELECT * INTO b FROM bundles WHERE id=i.bundle_id FOR UPDATE;
 IF NOT i.active OR b.physical_status<>'IN_STOCK' OR b.net_weight<>i.original_weight OR NOT EXISTS(SELECT 1 FROM reservations WHERE id=i.reservation_id AND released_at IS NULL) THEN RAISE EXCEPTION 'Loaded bundle or customer reservation changed' USING ERRCODE='23514';END IF;
 UPDATE loading_items SET active=false,removed_reason='正式离场 '||d.code,removed_at=now() WHERE loading_id=l.id AND bundle_id=b.id;
 UPDATE reservations SET released_at=now(),released_by=actor,release_reason='正式出库 '||d.code WHERE id=i.reservation_id;
 UPDATE bundles SET physical_status='OUTBOUND',version=version+1 WHERE id=b.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(b.id,'UNLOCK',0,actor,jsonb_build_object('allocation_id',(SELECT allocation_id FROM reservations WHERE id=i.reservation_id)),jsonb_build_object('allocation_id',(SELECT allocation_id FROM reservations WHERE id=i.reservation_id),'outbound_id',doc,'reason','正式出库消耗锁定'));
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(b.id,'OUTBOUND',-b.net_weight,actor,jsonb_build_object('physical_status','IN_STOCK'),jsonb_build_object('outbound_id',doc,'code',d.code,'vehicle_no',l.vehicle_no,'departed_at',d.gate_observed_at,'physical_status','OUTBOUND'));
 END LOOP;
 UPDATE allocations SET status='FULFILLED',version=version+1 WHERE id IN(SELECT r.allocation_id FROM reservations r JOIN loading_items z ON z.reservation_id=r.id WHERE z.loading_id=l.id) AND status='LOCKED' AND NOT EXISTS(SELECT 1 FROM reservations WHERE allocation_id=allocations.id AND released_at IS NULL);
 UPDATE loading_orders SET status='DEPARTED',version=version+1 WHERE id=l.id;
 UPDATE outbound_orders SET status='DEPARTED',departed_by=actor,departed_at=gate_observed_at,confirmed_at=now() WHERE id=doc;
 ELSIF action='cancel' THEN
 IF d.status NOT IN('CREATED','PACKING_CONFIRMED','COMMERCIAL_APPROVED') THEN RAISE EXCEPTION 'Cannot cancel after actual vehicle departure observation; use authorized reversal' USING ERRCODE='23514';END IF;UPDATE outbound_orders SET status='CANCELLED',cancel_reason=note WHERE id=doc;
 ELSIF action='reverse-request' THEN
 IF d.status<>'DEPARTED' OR d.reversal_status<>'NONE' THEN RAISE EXCEPTION 'Only departed shipment can request one reversal' USING ERRCODE='23514';END IF;UPDATE outbound_orders SET reversal_status='REQUESTED',reversal_reason=note,reversal_requested_by=actor WHERE id=doc;
 ELSIF action='reverse-approve' THEN
 IF d.status<>'DEPARTED' OR d.reversal_status<>'REQUESTED' OR actor=d.reversal_requested_by OR actor=d.departed_by THEN RAISE EXCEPTION 'Independent supervisor reversal approval required' USING ERRCODE='23514';END IF;UPDATE outbound_orders SET reversal_status='AUTHORIZED',reversal_approved_by=actor WHERE id=doc;
 ELSIF action='return-verify' THEN
 stamp:=(payload->>'observed_at')::timestamptz;
 IF d.status<>'DEPARTED' OR d.reversal_status<>'AUTHORIZED' OR actor IN(d.reversal_requested_by,d.reversal_approved_by) OR coalesce(payload->>'actual_return','')<>'true' OR stamp IS NULL OR stamp<d.departed_at OR stamp>now()+interval '1 minute' THEN RAISE EXCEPTION 'Independent security physical-return verification required' USING ERRCODE='23514';END IF;UPDATE outbound_orders SET reversal_status='RETURN_VERIFIED',return_verified_by=actor,return_observed_at=stamp WHERE id=doc;
 ELSIF action='reverse-confirm' THEN
 IF d.status<>'DEPARTED' OR d.reversal_status<>'RETURN_VERIFIED' OR actor IN(d.reversal_requested_by,d.reversal_approved_by,d.return_verified_by) OR coalesce(payload->>'actual_return','')<>'true' THEN RAISE EXCEPTION 'Production confirmation of verified physical return required' USING ERRCODE='23514';END IF;
 FOR b IN SELECT x.* FROM bundles x JOIN loading_items z ON z.bundle_id=x.id WHERE z.loading_id=l.id ORDER BY x.id FOR UPDATE OF x LOOP
 IF b.physical_status<>'OUTBOUND' OR NOT EXISTS(SELECT 1 FROM locations x JOIN warehouses h ON h.id=x.warehouse_id WHERE x.id=b.location_id AND x.active AND h.active AND NOT EXISTS(SELECT 1 FROM yards y WHERE y.id=x.yard_id AND NOT y.active) FOR SHARE OF x,h) THEN RAISE EXCEPTION 'Return location inactive or bundle no longer outbound' USING ERRCODE='23514';END IF;
 UPDATE bundles SET physical_status='IN_STOCK',version=version+1 WHERE id=b.id;
 INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,before_data,after_data) VALUES(b.id,'REVERSAL',b.net_weight,actor,jsonb_build_object('physical_status','OUTBOUND'),jsonb_build_object('outbound_id',doc,'code',d.code,'reason',d.reversal_reason,'physical_status','IN_STOCK','reservation_restored',false));END LOOP;
 UPDATE loading_orders SET status='REVERSED',version=version+1 WHERE id=l.id;UPDATE outbound_orders SET status='REVERSED',reversal_status='CONFIRMED',reversed_by=actor,reversed_at=now() WHERE id=doc;
 ELSE RAISE EXCEPTION 'Unknown outbound action' USING ERRCODE='23514';END IF;
 INSERT INTO outbound_steps(outbound_id,action,result,remark,payload,actor_id) VALUES(doc,action,'APPROVED',note,payload,actor);
 UPDATE outbound_orders SET version=version+1 WHERE id=doc RETURNING * INTO d;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data) VALUES(actor,'outbound_'||action,'outbound_orders',doc::text,old_data,to_jsonb(d));RETURN d;
END $$;
REVOKE ALL ON FUNCTION outbound_action(uuid,uuid,int,text,jsonb) FROM PUBLIC;GRANT EXECUTE ON FUNCTION outbound_action(uuid,uuid,int,text,jsonb) TO musonoi_app;
GRANT SELECT,INSERT ON outbound_orders TO musonoi_app;GRANT SELECT ON outbound_steps TO musonoi_app;
