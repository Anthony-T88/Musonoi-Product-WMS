-- A final, physically verified return keeps the original loading, reservation and preparation history.
CREATE TABLE copper_outbound_return_preparations(
 correction_id uuid PRIMARY KEY REFERENCES outbound_corrections(id),
 allocation_ids uuid[] NOT NULL CHECK(cardinality(allocation_ids)>0),
 actor_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL,
 restored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 restore_txid bigint NOT NULL
);
CREATE TRIGGER copper_outbound_return_preparations_immutable BEFORE UPDATE OR DELETE
 ON copper_outbound_return_preparations FOR EACH ROW EXECUTE FUNCTION v23_immutable();
GRANT SELECT ON copper_outbound_return_preparations TO musonoi_app;

CREATE TABLE copper_outbound_return_reservations(
 reservation_id uuid PRIMARY KEY REFERENCES reservations(id),
 correction_id uuid NOT NULL REFERENCES copper_outbound_return_preparations(correction_id),
 previous_reservation_id uuid NOT NULL REFERENCES reservations(id)
);
CREATE TRIGGER copper_outbound_return_reservations_immutable BEFORE UPDATE OR DELETE
 ON copper_outbound_return_reservations FOR EACH ROW EXECUTE FUNCTION v23_immutable();

-- Existing history retains its prior uniqueness. A proven replacement reservation starts a new lock cycle.
DROP INDEX one_reservation_event;
CREATE UNIQUE INDEX one_reservation_event ON inventory_events(
 bundle_id,event_type,(after_data->>'allocation_id'),(coalesce(after_data->>'return_reservation_id','')))
 WHERE event_type IN('LOCK','UNLOCK');

CREATE FUNCTION copper_return_reservation_event_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE active_reservation uuid; loading_ref text;
BEGIN
 IF NEW.event_type NOT IN('LOCK','UNLOCK') THEN RETURN NEW; END IF;
 NEW.after_data:=NEW.after_data-'return_reservation_id';
 IF current_user<>'musonoi_owner' THEN RETURN NEW; END IF;
 loading_ref:=coalesce(NEW.after_data->>'loading_id',NEW.after_data->>'outbound_id');
 SELECT r.id INTO active_reservation
 FROM copper_outbound_return_reservations replacement JOIN reservations r ON r.id=replacement.reservation_id
 WHERE r.bundle_id=NEW.bundle_id AND r.allocation_id::text=NEW.after_data->>'allocation_id'
  AND (
   (NEW.event_type='LOCK' AND r.released_at IS NULL AND r.locked_by=NEW.actor_id)
   OR (NEW.event_type='UNLOCK' AND r.released_at IS NOT NULL AND r.released_by=NEW.actor_id
    AND (EXISTS(SELECT 1 FROM loading_items i WHERE i.reservation_id=r.id AND i.loading_id::text=loading_ref AND NOT i.plan_removed)
     OR EXISTS(SELECT 1 FROM lot_bundle_releases rem WHERE rem.allocation_id=r.allocation_id AND rem.bundle_id=r.bundle_id
      AND rem.loading_id::text=loading_ref AND rem.actor_id=NEW.actor_id AND r.released_at>=rem.occurred_at)))
  )
 ORDER BY r.locked_at DESC,r.id LIMIT 1;
 IF active_reservation IS NOT NULL THEN
  NEW.after_data:=NEW.after_data||jsonb_build_object('return_reservation_id',active_reservation);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION copper_return_reservation_event_identity() FROM PUBLIC;
CREATE TRIGGER copper_return_reservation_event_identity BEFORE INSERT ON inventory_events
 FOR EACH ROW EXECUTE FUNCTION copper_return_reservation_event_identity();

-- Only evidenced remainders become historical rows on a reopened preparation.
CREATE FUNCTION copper_return_preparation_item_current(p_allocation uuid,p_bundle uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT NOT EXISTS(
  SELECT 1 FROM lot_bundle_releases rem
  WHERE rem.allocation_id=p_allocation AND rem.bundle_id=p_bundle
   AND EXISTS(SELECT 1 FROM copper_outbound_return_preparations restored WHERE p_allocation=ANY(restored.allocation_ids))
   AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.allocation_id=p_allocation AND r.bundle_id=p_bundle AND r.released_at IS NULL)
 )
$$;
REVOKE ALL ON FUNCTION copper_return_preparation_item_current(uuid,uuid) FROM PUBLIC;

DO $$
DECLARE definition text; anchor text; patch text; signature text;
BEGIN
 FOR signature,anchor,patch IN VALUES
  ('v262_prior_ready(uuid)','WHERE i.allocation_id=doc AND (NOT w.final_weighed',
   'WHERE i.allocation_id=doc AND copper_return_preparation_item_current(doc,b.id) AND (NOT w.final_weighed'),
  ('v261_check_ready(uuid)','WHERE w.allocation_id=doc AND (NOT w.seal_valid',
   'WHERE w.allocation_id=doc AND copper_return_preparation_item_current(doc,b.id) AND (NOT w.seal_valid'),
  ('v262_prior_lot_action(uuid,uuid,int,text,jsonb)','WHERE i.allocation_id=doc ORDER BY bb.id',
   'WHERE i.allocation_id=doc AND copper_return_preparation_item_current(doc,bb.id) ORDER BY bb.id'),
  ('v265_lot_guard()','WHERE i.allocation_id=NEW.id AND',
   'WHERE i.allocation_id=NEW.id AND copper_return_preparation_item_current(NEW.id,b.id) AND')
 LOOP
  SELECT pg_get_functiondef(signature::regprocedure) INTO definition;
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected % preparation guard',signature; END IF;
  EXECUTE replace(definition,anchor,patch);
 END LOOP;
END $$;

CREATE FUNCTION copper_return_preparation_state(p_doc uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 q outbound_corrections;
 source_lots uuid[];
 target uuid;
 matched_count int;
 block text;
BEGIN
 SELECT * INTO q FROM outbound_corrections WHERE id=p_doc;
 IF q.kind IS DISTINCT FROM 'RETURN_OUTBOUND' OR q.status IS DISTINCT FROM 'APPLIED'
  OR q.verified_by IS NULL OR q.verified_at IS NULL OR q.applied_at IS NULL THEN
  RETURN jsonb_build_object('state','NOT_APPLIED','allocation_ids','[]'::jsonb);
 END IF;
 SELECT allocation_ids INTO source_lots FROM copper_outbound_return_preparations WHERE correction_id=p_doc;
 IF FOUND THEN RETURN jsonb_build_object('state','RESTORED','allocation_ids',source_lots); END IF;

 target:=nullif(q.proposed_data->>'return_location_id','')::uuid;
 SELECT array_agg(DISTINCT r.allocation_id ORDER BY r.allocation_id),count(*)::int
 INTO source_lots,matched_count
 FROM jsonb_array_elements(q.bundle_snapshot) x
 JOIN loading_items i ON i.loading_id=q.loading_id AND i.bundle_id=(x->>'bundle_id')::uuid
  AND i.reservation_id=(x->>'reservation_id')::uuid AND NOT i.plan_removed AND NOT i.active
 JOIN reservations r ON r.id=i.reservation_id AND r.bundle_id=i.bundle_id AND r.released_at IS NOT NULL
 JOIN allocation_items ai ON ai.allocation_id=r.allocation_id AND ai.bundle_id=i.bundle_id
 JOIN lot_work_items w ON w.allocation_id=ai.allocation_id AND w.bundle_id=ai.bundle_id;
 IF matched_count=0 OR matched_count<>jsonb_array_length(q.bundle_snapshot) THEN
  block:='ORIGINAL_PREPARATION_UNAVAILABLE';
 ELSIF EXISTS(SELECT 1 FROM allocations a WHERE a.id=ANY(source_lots)
  AND (a.workflow_version IS DISTINCT FROM '2.6.1' OR a.lot_no IS NULL
   OR a.workflow_state NOT IN('FULFILLED','PARTIAL','PREPARED') OR a.status NOT IN('FULFILLED','LOCKED'))) THEN
  block:='ORIGINAL_PREPARATION_UNAVAILABLE';
 ELSIF EXISTS(SELECT 1 FROM allocations a JOIN sales_plans p ON p.id=a.plan_id
  JOIN loading_orders l ON l.id=q.loading_id WHERE a.id=ANY(source_lots)
   AND (p.status<>'OPEN' OR p.project_id<>l.project_id OR p.customer_id<>l.customer_id)) THEN
  block:='SALES_PLAN_UNAVAILABLE';
 ELSIF NOT EXISTS(SELECT 1 FROM locations loc JOIN warehouses w ON w.id=loc.warehouse_id
  WHERE loc.id=target AND loc.active AND loc.map_usage='TEMPORARY' AND w.active)
  OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(q.bundle_snapshot) x JOIN bundles b ON b.id=(x->>'bundle_id')::uuid
   WHERE b.physical_status<>'IN_STOCK' OR b.location_id IS DISTINCT FROM target
    OR b.version<>(x->>'version')::integer+1 OR b.net_weight IS NULL
    OR NOT EXISTS(SELECT 1 FROM inventory_events e WHERE e.bundle_id=b.id AND e.event_type='REVERSAL'
     AND e.revision_id=q.applied_revision AND e.actor_id=q.applied_by AND e.physical_delta=b.net_weight
     AND e.after_data->>'correction_id'=q.id::text AND e.after_data->>'loading_id'=q.loading_id::text
     AND e.after_data->>'location_id'=target::text)
    OR EXISTS(SELECT 1 FROM reservations r WHERE r.bundle_id=b.id AND r.released_at IS NULL)
    OR EXISTS(SELECT 1 FROM adjustment_lines al JOIN stock_adjustments sa ON sa.id=al.adjustment_id
     WHERE al.bundle_no=b.bundle_no AND sa.status IN('DRAFT','PENDING'))
  ) THEN block:='RETURNED_STOCK_CHANGED';
 ELSIF EXISTS(
  SELECT 1 FROM loading_plan_lot_locks k WHERE k.allocation_id=ANY(source_lots)
   AND NOT EXISTS(SELECT 1 FROM loading_plan_matches m WHERE m.document_id=k.document_id AND m.loading_id=q.loading_id)
 ) OR EXISTS(
  SELECT 1 FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN loading_orders l ON l.id=i.loading_id
  WHERE r.allocation_id=ANY(source_lots) AND i.loading_id<>q.loading_id AND NOT i.plan_removed
   AND (i.active OR (l.status='DEPARTED' AND l.workflow_state='OUTBOUND'
    AND NOT EXISTS(SELECT 1 FROM outbound_corrections prior
     WHERE prior.loading_id=l.id AND prior.kind='RETURN_OUTBOUND' AND prior.status='APPLIED')))
 ) THEN block:='OTHER_LOADING';
 ELSIF EXISTS(
  SELECT 1 FROM allocation_items ai JOIN bundles b ON b.id=ai.bundle_id
  WHERE ai.allocation_id=ANY(source_lots)
   AND NOT EXISTS(SELECT 1 FROM loading_items i JOIN reservations r ON r.id=i.reservation_id
    WHERE i.loading_id=q.loading_id AND NOT i.plan_removed AND r.allocation_id=ai.allocation_id AND i.bundle_id=ai.bundle_id)
   AND NOT EXISTS(SELECT 1 FROM lot_bundle_releases rem WHERE rem.allocation_id=ai.allocation_id AND rem.bundle_id=ai.bundle_id
    AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.allocation_id=ai.allocation_id AND r.bundle_id=ai.bundle_id AND r.released_at IS NULL))
   AND (b.physical_status<>'IN_STOCK' OR NOT EXISTS(SELECT 1 FROM reservations r
    WHERE r.allocation_id=ai.allocation_id AND r.bundle_id=ai.bundle_id AND r.released_at IS NULL))
 ) THEN block:='ORIGINAL_BATCH_PARTIAL';
 ELSIF EXISTS(
  SELECT 1 FROM allocations a LEFT JOIN locations loc ON loc.id=a.planned_location_id
  LEFT JOIN warehouses w ON w.id=loc.warehouse_id WHERE a.id=ANY(source_lots)
   AND (loc.id IS NULL OR NOT loc.active OR NOT w.active OR loc.map_usage<>'FORMAL'
    OR EXISTS(SELECT 1 FROM lot_location_claims c WHERE c.released_at IS NULL
     AND ((c.location_id=loc.id AND c.allocation_id<>a.id) OR (c.allocation_id=a.id AND c.location_id<>loc.id)))
    OR EXISTS(SELECT 1 FROM bundles b WHERE b.location_id=loc.id AND b.physical_status='IN_STOCK'
     AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.bundle_id=b.id AND r.allocation_id=a.id AND r.released_at IS NULL)))
 ) THEN block:='LOCATION_CONFLICT';
 END IF;
 RETURN jsonb_build_object('state',CASE WHEN block IS NULL THEN 'READY' ELSE 'BLOCKED' END,
  'blocker',block,'allocation_ids',coalesce(to_jsonb(source_lots),'[]'::jsonb));
END $$;

-- Only the verified return's own transaction can insert replacement reservations into an existing Lot.
DO $$
DECLARE definition text:=pg_get_functiondef('reservation_guard()'::regprocedure);
 anchor text:=$anchor$IF a.workflow_version='2.6.1' THEN$anchor$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected modern reservation guard'; END IF;
 EXECUTE replace(definition,anchor,$guard$
 IF TG_OP='INSERT' AND current_user='musonoi_owner' AND a.workflow_state='RECTIFY' AND a.status='LOCKED'
  AND p.status='OPEN' AND b.physical_status='IN_STOCK' AND b.project_id=p.project_id AND NEW.weight IS NOT DISTINCT FROM b.net_weight
  AND NEW.origin='BUSINESS' AND NEW.released_at IS NULL
  AND EXISTS(SELECT 1 FROM copper_outbound_return_preparations repair
   JOIN outbound_corrections q ON q.id=repair.correction_id AND q.status='APPLIED' AND q.kind='RETURN_OUTBOUND'
   JOIN loading_items i ON i.loading_id=q.loading_id AND i.bundle_id=NEW.bundle_id AND NOT i.plan_removed
   JOIN reservations prior ON prior.id=i.reservation_id AND prior.allocation_id=NEW.allocation_id AND prior.bundle_id=NEW.bundle_id
   WHERE repair.restore_txid=txid_current() AND repair.actor_id=NEW.locked_by AND a.id=ANY(repair.allocation_ids)
    AND prior.released_at IS NOT NULL AND b.location_id=(q.proposed_data->>'return_location_id')::uuid
    AND q.bundle_snapshot @> jsonb_build_array(jsonb_build_object('bundle_id',NEW.bundle_id,'reservation_id',prior.id))) THEN
  RETURN NEW;
 END IF;
 IF a.workflow_version='2.6.1' THEN$guard$);
END $$;

CREATE FUNCTION copper_apply_return_preparation(p_actor uuid,p_doc uuid,p_expected int,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 q outbound_corrections;
 l loading_orders;
 lots uuid[];
 loc locations;
 result jsonb;
 item record;
 active_reservation uuid;
BEGIN
 PERFORM v24_revision();
 PERFORM pg_advisory_xact_lock(21004);
 SELECT * INTO q FROM outbound_corrections WHERE id=p_doc FOR UPDATE;
 IF q.kind IS DISTINCT FROM 'RETURN_OUTBOUND' OR q.status IS DISTINCT FROM 'APPLIED'
  OR q.version IS DISTINCT FROM p_expected OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 2000 THEN
  RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514';
 END IF;
 SELECT * INTO l FROM loading_orders WHERE id=q.loading_id FOR UPDATE;
 SELECT * INTO loc FROM locations WHERE id=(q.proposed_data->>'return_location_id')::uuid;
 PERFORM v23_require(p_actor,'outbound:approve',l.project_id,l.customer_id,loc.warehouse_id);
 PERFORM v23_require(p_actor,'outbound:approve',l.project_id,l.customer_id,origin.warehouse_id)
 FROM loading_items i JOIN locations origin ON origin.id=i.original_location_id
 WHERE i.loading_id=l.id AND NOT i.plan_removed;
 result:=copper_return_preparation_state(p_doc);
 IF result->>'state'<>'READY' THEN RETURN result; END IF;
 SELECT array_agg(x::uuid) INTO lots FROM jsonb_array_elements_text(result->'allocation_ids') x;
 BEGIN
  INSERT INTO copper_outbound_return_preparations(correction_id,allocation_ids,actor_id,reason,restore_txid)
   VALUES(p_doc,lots,p_actor,trim(p_reason),txid_current());
  UPDATE allocations SET status='LOCKED',workflow_state='RECTIFY',
   review_note='返厂冲销恢复备货：'||q.code,version=version+1 WHERE id=ANY(lots);
  INSERT INTO workflow_reviews(allocation_id,action,actor_id,note)
   SELECT a.id,'RETURN_REOPEN',p_actor,trim(p_reason)||' · '||q.code FROM allocations a WHERE a.id=ANY(lots);
  INSERT INTO lot_location_claims(location_id,allocation_id)
   SELECT a.planned_location_id,a.id FROM allocations a WHERE a.id=ANY(lots)
   AND NOT EXISTS(SELECT 1 FROM lot_location_claims c WHERE c.allocation_id=a.id AND c.released_at IS NULL);
  FOR item IN
   SELECT b.id bundle_id,b.net_weight,r.id prior_id,r.allocation_id FROM loading_items i
   JOIN reservations r ON r.id=i.reservation_id JOIN bundles b ON b.id=i.bundle_id
   WHERE i.loading_id=l.id AND NOT i.plan_removed ORDER BY b.id
  LOOP
   INSERT INTO reservations(allocation_id,bundle_id,weight,locked_by)
    VALUES(item.allocation_id,item.bundle_id,item.net_weight,p_actor) RETURNING id INTO active_reservation;
   INSERT INTO copper_outbound_return_reservations(reservation_id,correction_id,previous_reservation_id)
    VALUES(active_reservation,p_doc,item.prior_id);
   INSERT INTO inventory_events(bundle_id,event_type,physical_delta,actor_id,after_data)
    VALUES(item.bundle_id,'LOCK',0,p_actor,jsonb_build_object('correction_id',p_doc,'loading_id',l.id,
     'allocation_id',item.allocation_id,'previous_reservation_id',item.prior_id,'basis','VERIFIED_OUTBOUND_RETURN'));
   INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,after_data,note)
    VALUES(item.allocation_id,item.bundle_id,'RESTORE_OUTBOUND_RETURN',p_actor,
     jsonb_build_object('correction_id',p_doc,'loading_id',l.id,'previous_reservation_id',item.prior_id),trim(p_reason));
   PERFORM v24_capture_bundle(item.bundle_id);
  END LOOP;
  PERFORM v261_assert_plan(a.planned_location_id) FROM allocations a WHERE a.id=ANY(lots) ORDER BY a.planned_location_id;
  PERFORM v265_assert_weight(a.plan_id) FROM allocations a WHERE a.id=ANY(lots) ORDER BY a.plan_id;
  INSERT INTO outbound_correction_steps(correction_id,action,actor_id,reason) VALUES(p_doc,'restore-preparation',p_actor,trim(p_reason));
  UPDATE outbound_corrections SET version=version+1 WHERE id=p_doc;
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data)
   VALUES(p_actor,'outbound_return_preparation_restored','outbound_corrections',p_doc::text,
    jsonb_build_object('loading_id',l.id,'allocation_ids',lots,'reason',trim(p_reason)));
 EXCEPTION WHEN check_violation OR unique_violation OR foreign_key_violation THEN
  RETURN result||jsonb_build_object('state','BLOCKED','blocker','RESTORE_VALIDATION_REQUIRED');
 END;
 RETURN copper_return_preparation_state(p_doc);
END $$;

DO $$
DECLARE
 definition text:=pg_get_functiondef('v27_correction_action(uuid,uuid,int,text,text)'::regprocedure);
 anchor text:=$anchor$q:=v32_prior_correction_action(actor,doc,expected,action,reason);$anchor$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected correction approval delegate'; END IF;
 definition:=replace(definition,'DECLARE q outbound_corrections;lp uuid;',
  'DECLARE q outbound_corrections;lp uuid;l loading_orders;destination locations;');
 EXECUTE replace(definition,anchor,$wrapper$
 IF action IN('verify-return','apply') THEN
  PERFORM v24_revision();
  IF action='apply' THEN PERFORM pg_advisory_xact_lock(21004); END IF;
  SELECT * INTO q FROM outbound_corrections WHERE id=doc;
  IF q.kind='RETURN_OUTBOUND' THEN
   SELECT * INTO l FROM loading_orders WHERE id=q.loading_id;
   IF coalesce(jsonb_array_length(q.bundle_snapshot),0)=0 OR
    (SELECT count(*) FROM loading_items i WHERE i.loading_id=l.id AND NOT i.plan_removed)
    <>jsonb_array_length(q.bundle_snapshot) OR EXISTS (
     SELECT 1 FROM jsonb_array_elements(q.bundle_snapshot) x WHERE NOT EXISTS(
      SELECT 1 FROM loading_items i WHERE i.loading_id=l.id AND NOT i.plan_removed
       AND i.bundle_id=(x->>'bundle_id')::uuid AND i.reservation_id=(x->>'reservation_id')::uuid)
    ) THEN RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
   IF coalesce(q.proposed_data->>'return_location_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION 'V27_RETURN_LOCATION_REQUIRED' USING ERRCODE='23514'; END IF;
   SELECT * INTO destination FROM locations WHERE id=(q.proposed_data->>'return_location_id')::uuid
    AND project_id=l.project_id AND active AND map_usage='TEMPORARY';
   IF NOT FOUND THEN RAISE EXCEPTION 'V27_RETURN_LOCATION_REQUIRED' USING ERRCODE='23514'; END IF;
   PERFORM v23_require(actor,CASE WHEN action='verify-return' THEN 'load:review' ELSE 'outbound:approve' END,
    l.project_id,l.customer_id,destination.warehouse_id);
  END IF;
 END IF;
 q:=v32_prior_correction_action(actor,doc,expected,action,reason);
 IF action='apply' AND q.kind='RETURN_OUTBOUND' AND q.status='APPLIED' THEN
  PERFORM copper_apply_return_preparation(actor,q.id,q.version,reason);
  SELECT * INTO q FROM outbound_corrections WHERE id=doc;
 END IF;
$wrapper$);
END $$;

REVOKE ALL ON FUNCTION copper_return_preparation_state(uuid),copper_apply_return_preparation(uuid,uuid,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copper_return_preparation_state(uuid),copper_apply_return_preparation(uuid,uuid,int,text) TO musonoi_app;
