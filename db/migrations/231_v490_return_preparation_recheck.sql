CREATE TABLE copper_return_prechecks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 correction_id uuid NOT NULL REFERENCES outbound_corrections(id),
 requested_by uuid NOT NULL REFERENCES users(id),
 requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 reason text NOT NULL,
 evidence jsonb NOT NULL,
 measurements jsonb NOT NULL
);
CREATE INDEX copper_return_prechecks_correction ON copper_return_prechecks(correction_id,requested_at DESC);
CREATE TABLE copper_return_precheck_reviews(
 recheck_id uuid PRIMARY KEY REFERENCES copper_return_prechecks(id),
 reviewed_by uuid NOT NULL REFERENCES users(id),
 reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 decision text NOT NULL CHECK(decision IN('APPROVED','REJECTED')),
 reason text NOT NULL
);
CREATE TRIGGER copper_return_prechecks_immutable BEFORE UPDATE OR DELETE ON copper_return_prechecks
 FOR EACH ROW EXECUTE FUNCTION v23_immutable();
CREATE TRIGGER copper_return_precheck_reviews_immutable BEFORE UPDATE OR DELETE ON copper_return_precheck_reviews
 FOR EACH ROW EXECUTE FUNCTION v23_immutable();
GRANT SELECT ON copper_return_prechecks,copper_return_precheck_reviews TO musonoi_app;

CREATE INDEX inventory_events_bundle_order ON inventory_events(bundle_id,id);
CREATE INDEX reservations_bundle_history ON reservations(bundle_id);
CREATE INDEX lot_work_history_allocation_bundle ON lot_work_history(allocation_id,bundle_id);
CREATE INDEX loading_items_reservation ON loading_items(reservation_id);

-- Keep the original entry points strict. Only the private approval path can use verified bundle IDs.
DO $$
DECLARE signature text; anchor text; replacement text; definition text; header text;
BEGIN
 FOR signature,anchor,replacement IN VALUES
  ('copper_return_stock_blockers(uuid)',
   'WHEN EXISTS(SELECT 1 FROM inventory_events e WHERE e.bundle_id=b.bundle_id AND e.id>b.event_id)',
   'WHEN NOT (b.bundle_id=ANY(p_rechecked_bundles)) AND (EXISTS(SELECT 1 FROM inventory_events e WHERE e.bundle_id=b.bundle_id AND e.id>b.event_id)'),
  ('copper_return_preparation_state(uuid)','copper_return_stock_blockers(p_doc);',
   'copper_return_stock_blockers(p_doc,p_rechecked_bundles);'),
  ('copper_apply_return_preparation(uuid,uuid,int,text)','result:=copper_return_preparation_state(p_doc);',
   'result:=copper_return_preparation_state(p_doc,p_rechecked_bundles);')
 LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  header:=split_part(definition,chr(10),1);
  IF right(header,1)<>')' OR strpos(definition,anchor)=0 THEN
   RAISE EXCEPTION 'Expected return preparation check in %',signature;
  END IF;
  IF signature='copper_return_stock_blockers(uuid)' THEN
   IF strpos(definition,' THEN ''SUBSEQUENT_STOCK_ACTIVITY''')=0 THEN RAISE EXCEPTION 'Expected stock activity blocker'; END IF;
   definition:=replace(definition,' THEN ''SUBSEQUENT_STOCK_ACTIVITY''',') THEN ''SUBSEQUENT_STOCK_ACTIVITY''');
  END IF;
  EXECUTE left(header,-1)||', p_rechecked_bundles uuid[])'||chr(10)||
   replace(substr(definition,length(header)+2),anchor,replacement);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION copper_return_stock_blockers(uuid,uuid[]),copper_return_preparation_state(uuid,uuid[]),
 copper_apply_return_preparation(uuid,uuid,int,text,uuid[]) FROM PUBLIC,musonoi_app;

CREATE OR REPLACE FUNCTION copper_return_stock_blockers(p_doc uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT copper_return_stock_blockers(p_doc,ARRAY[]::uuid[])
$$;
CREATE OR REPLACE FUNCTION copper_return_preparation_state(p_doc uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT copper_return_preparation_state(p_doc,ARRAY[]::uuid[])
$$;
CREATE OR REPLACE FUNCTION copper_apply_return_preparation(p_actor uuid,p_doc uuid,p_expected int,p_reason text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT copper_apply_return_preparation(p_actor,p_doc,p_expected,p_reason,ARRAY[]::uuid[])
$$;

CREATE FUNCTION copper_return_revoked_lot_evidence(p_doc uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH returned AS (
  SELECT q.applied_at,q.applied_revision,b.id bundle_id,b.bundle_no,b.location_id,b.version,
   b.net_weight,b.sample_status,b.project_id,b.customer_id,b.batch_id,loc.code location_code,
   original.allocation_id,source.lot_no,posted.id return_event_id
  FROM outbound_corrections q CROSS JOIN LATERAL jsonb_array_elements(q.bundle_snapshot) x
  JOIN bundles b ON b.id=(x->>'bundle_id')::uuid AND b.location_id=(q.proposed_data->>'return_location_id')::uuid
  JOIN locations loc ON loc.id=b.location_id
  JOIN reservations original ON original.id=(x->>'reservation_id')::uuid AND original.bundle_id=b.id
  JOIN allocations source ON source.id=original.allocation_id
  JOIN inventory_events posted ON posted.bundle_id=b.id AND posted.event_type='REVERSAL'
   AND posted.revision_id=q.applied_revision AND posted.physical_delta=b.net_weight
   AND posted.after_data->>'correction_id'=q.id::text
  WHERE q.id=p_doc AND q.kind='RETURN_OUTBOUND' AND q.status='APPLIED'
 ), pairs AS (
  SELECT b.bundle_id,r.id reservation_id,a.id allocation_id,a.lot_no,locked.id lock_id,unlocked.id unlock_id,
   locked.occurred_at locked_at,unlocked.occurred_at released_at
  FROM returned b
  JOIN inventory_events locked ON locked.bundle_id=b.bundle_id AND locked.revision_id>b.applied_revision
   AND locked.id>b.return_event_id AND locked.event_type='LOCK' AND locked.physical_delta=0
   AND locked.after_data->>'basis'='LOT_CREATED'
  JOIN allocations a ON a.id::text=locked.after_data->>'allocation_id' AND a.id<>b.allocation_id
   AND a.workflow_state='CANCELLED' AND a.status='RELEASED' AND a.lot_no=locked.after_data->>'lot_no'
  JOIN reservations r ON r.allocation_id=a.id AND r.bundle_id=b.bundle_id AND r.origin='BUSINESS' AND r.weight=b.net_weight
   AND r.locked_by=locked.actor_id AND r.released_by=a.cancelled_by AND r.released_at IS NOT NULL
   AND r.released_at>=a.cancelled_at AND r.release_reason=a.cancel_note
  JOIN inventory_events unlocked ON unlocked.bundle_id=b.bundle_id AND unlocked.id>locked.id
   AND unlocked.revision_id>=locked.revision_id AND unlocked.event_type='UNLOCK' AND unlocked.physical_delta=0
   AND unlocked.actor_id=r.released_by AND unlocked.after_data @> jsonb_build_object(
    'allocation_id',a.id,'basis','PREAPPROVAL_REVOKE','physical_location_id',b.location_id,'reason',r.release_reason)
  WHERE EXISTS(SELECT 1 FROM lot_work_history h WHERE h.allocation_id=a.id AND h.bundle_id=b.bundle_id
    AND h.action='CREATE_ITEM' AND h.actor_id=r.locked_by)
   AND EXISTS(SELECT 1 FROM lot_work_history h WHERE h.allocation_id=a.id AND h.bundle_id IS NULL
    AND h.action='REVOKE' AND h.actor_id=r.released_by AND h.occurred_at>=r.released_at
    AND h.after_data @> jsonb_build_object('workflow_state','CANCELLED','status','RELEASED'))
   AND NOT EXISTS(SELECT 1 FROM lot_work_history h WHERE h.allocation_id=a.id
    AND ((h.bundle_id=b.bundle_id AND h.action NOT IN('CREATE_ITEM','INHERIT'))
     OR (h.bundle_id IS NULL AND h.action NOT IN('SUBMIT','WITHDRAW','REJECT','REVOKE'))))
   AND NOT EXISTS(SELECT 1 FROM loading_items i WHERE i.reservation_id=r.id)
 ), grouped AS (
  SELECT bundle_id,array_agg(reservation_id) reservations,array_agg(lock_id)||array_agg(unlock_id) events,
   jsonb_agg(jsonb_build_object('allocation_id',allocation_id,'lot_no',lot_no,'reservation_id',reservation_id,
    'lock_event_id',lock_id,'unlock_event_id',unlock_id,'locked_at',locked_at,'released_at',released_at) ORDER BY lock_id) cycles
  FROM pairs GROUP BY bundle_id HAVING count(*)=count(DISTINCT allocation_id)
 )
 SELECT jsonb_agg(jsonb_build_object('bundle_id',b.bundle_id,'bundle_no',b.bundle_no,'bundle_version',b.version,
  'location_id',b.location_id,'location_code',b.location_code,'net_weight',b.net_weight::text,'allocation_id',b.allocation_id,
  'lot_no',b.lot_no,'return_event_id',b.return_event_id,'cycles',p.cycles) ORDER BY b.bundle_no)
 FROM returned b JOIN grouped p USING(bundle_id)
 WHERE NOT EXISTS(SELECT 1 FROM inventory_events e WHERE e.bundle_id=b.bundle_id AND e.id>b.return_event_id AND NOT(e.id=ANY(p.events)))
  AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.bundle_id=b.bundle_id
   AND (r.locked_at>b.applied_at OR r.released_at>b.applied_at) AND NOT(r.id=ANY(p.reservations)))
  AND NOT EXISTS(SELECT 1 FROM inventory_history h WHERE h.bundle_id=b.bundle_id AND h.revision_id>b.applied_revision
   AND (h.state->>'physical_status' IS DISTINCT FROM 'IN_STOCK'
    OR h.state->>'location_id' IS DISTINCT FROM b.location_id::text
    -- A new preparation can hide its unconfirmed weight in the projection.
    -- The matching reservation above still proves the exact physical net weight.
    OR ((h.state->>'weight')::numeric IS DISTINCT FROM b.net_weight AND NOT(
     h.state->>'weight' IS NULL AND coalesce((h.state->>'reservation_id')::uuid=ANY(p.reservations),false)))
    OR h.state->>'sample_status' IS DISTINCT FROM b.sample_status
    OR h.state->>'project_id' IS DISTINCT FROM b.project_id::text
    OR h.state->>'customer_id' IS DISTINCT FROM b.customer_id::text
    OR h.state->>'batch_id' IS DISTINCT FROM b.batch_id::text
    OR h.state->>'loading_id' IS NOT NULL OR h.state->>'effective_loading_id' IS NOT NULL
    OR (h.state->>'reservation_id' IS NOT NULL AND NOT((h.state->>'reservation_id')::uuid=ANY(p.reservations)))
    OR (h.state->>'effective_reservation_id' IS NOT NULL AND NOT((h.state->>'effective_reservation_id')::uuid=ANY(p.reservations)))))
$$;
REVOKE ALL ON FUNCTION copper_return_revoked_lot_evidence(uuid) FROM PUBLIC,musonoi_app;

CREATE FUNCTION copper_return_recheck_evidence(p_doc uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE checked jsonb; eligible uuid[]; recovery jsonb; originals jsonb; versions jsonb;
BEGIN
 checked:=copper_return_revoked_lot_evidence(p_doc);
 IF checked IS NULL THEN RETURN NULL; END IF;
 SELECT array_agg((item->>'bundle_id')::uuid) INTO eligible FROM jsonb_array_elements(checked) item;
 recovery:=copper_return_preparation_state(p_doc,eligible);
 IF recovery->>'state' IS DISTINCT FROM 'READY' THEN RETURN NULL; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',a.id,'lot_no',a.lot_no,'version',a.version,'plan_version',p.version) ORDER BY a.id)
 INTO originals FROM jsonb_array_elements_text(recovery->'allocation_ids') lot
 JOIN allocations a ON a.id=lot::uuid JOIN sales_plans p ON p.id=a.plan_id;
 SELECT jsonb_object_agg(b.id,b.version) INTO versions FROM outbound_corrections q
 CROSS JOIN LATERAL jsonb_array_elements(q.bundle_snapshot) x JOIN bundles b ON b.id=(x->>'bundle_id')::uuid WHERE q.id=p_doc;
 RETURN jsonb_build_object('bundles',checked,'originals',originals,'returned_versions',versions);
END $$;
REVOKE ALL ON FUNCTION copper_return_recheck_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copper_return_recheck_evidence(uuid) TO musonoi_app;

CREATE FUNCTION copper_return_recheck_scope(p_actor uuid,p_doc uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(
  SELECT 1 FROM outbound_corrections q JOIN loading_orders l ON l.id=q.loading_id
  JOIN locations returned ON returned.id=(q.proposed_data->>'return_location_id')::uuid AND returned.project_id=l.project_id
  WHERE q.id=p_doc AND q.kind='RETURN_OUTBOUND' AND q.status='APPLIED'
   AND NOT EXISTS(
    SELECT 1 FROM (
     SELECT returned.warehouse_id
     UNION SELECT origin.warehouse_id FROM loading_items i JOIN locations origin ON origin.id=i.original_location_id
      WHERE i.loading_id=l.id AND NOT i.plan_removed
     UNION SELECT loc.warehouse_id FROM loading_items i JOIN bundles b ON b.id=i.bundle_id
      JOIN locations loc ON loc.id=b.location_id WHERE i.loading_id=l.id
    ) required WHERE NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=p_actor AND s.project_id=l.project_id
     AND (s.customer_id IS NULL OR s.customer_id=l.customer_id) AND (s.warehouse_id IS NULL OR s.warehouse_id=required.warehouse_id))
   )
 )
$$;
REVOKE ALL ON FUNCTION copper_return_recheck_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copper_return_recheck_scope(uuid,uuid) TO musonoi_app;

CREATE FUNCTION copper_return_recheck_document(p_actor uuid,p_doc uuid,p_expected int,p_permission text,p_reason text)
RETURNS outbound_corrections LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE q outbound_corrections; l loading_orders;
BEGIN
 PERFORM v24_revision();
 PERFORM pg_advisory_xact_lock(21004);
 SELECT * INTO q FROM outbound_corrections WHERE id=p_doc FOR UPDATE;
 IF q.kind IS DISTINCT FROM 'RETURN_OUTBOUND' OR q.status IS DISTINCT FROM 'APPLIED'
  OR q.version IS DISTINCT FROM p_expected OR length(trim(coalesce(p_reason,''))) NOT BETWEEN 5 AND 2000 THEN
  RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514';
 END IF;
 IF NOT copper_return_recheck_scope(p_actor,q.id) THEN
  RAISE EXCEPTION 'V27_RETURN_RECHECK_SCOPE' USING ERRCODE='42501';
 END IF;
 SELECT * INTO l FROM loading_orders WHERE id=q.loading_id;
 PERFORM v23_require(p_actor,'load:read',l.project_id,l.customer_id,loc.warehouse_id),
  v23_require(p_actor,p_permission,l.project_id,l.customer_id,loc.warehouse_id)
 FROM locations loc WHERE loc.id=(q.proposed_data->>'return_location_id')::uuid AND loc.project_id=l.project_id;
 RETURN q;
END $$;
REVOKE ALL ON FUNCTION copper_return_recheck_document(uuid,uuid,int,text,text) FROM PUBLIC,musonoi_app;

CREATE FUNCTION copper_return_request_recheck(p_actor uuid,p_doc uuid,p_expected int,p_reason text,p_token text,
 p_confirmed boolean,p_measurements jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE q outbound_corrections; facts jsonb; result uuid; readings jsonb;
BEGIN
 q:=copper_return_recheck_document(p_actor,p_doc,p_expected,'load:review',p_reason);
 IF EXISTS(SELECT 1 FROM copper_return_prechecks r LEFT JOIN copper_return_precheck_reviews v ON v.recheck_id=r.id
  WHERE r.correction_id=q.id AND v.recheck_id IS NULL) THEN
  RAISE EXCEPTION 'V27_RETURN_RECHECK_PENDING' USING ERRCODE='23514';
 END IF;
 facts:=copper_return_recheck_evidence(q.id);
 IF facts IS NULL OR p_token IS DISTINCT FROM encode(sha256(convert_to(facts::text,'UTF8')),'hex') THEN
  RAISE EXCEPTION 'V27_RETURN_RECHECK_STALE' USING ERRCODE='23514';
 END IF;
 IF p_confirmed IS DISTINCT FROM true OR (CASE WHEN jsonb_typeof(p_measurements)='object'
  THEN (SELECT count(*) FROM jsonb_object_keys(p_measurements))<>jsonb_array_length(facts->'bundles') ELSE true END) THEN
  RAISE EXCEPTION 'V27_RETURN_RECHECK_MEASUREMENTS' USING ERRCODE='23514';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('bundle_id',b->'bundle_id','location_code',upper(trim(m->>'location_code')),
  'net_weight',trim(m->>'net_weight')) ORDER BY b->>'bundle_no') INTO readings
 FROM jsonb_array_elements(facts->'bundles') b
 CROSS JOIN LATERAL (SELECT p_measurements->(b->>'bundle_id') AS m) input
 WHERE upper(trim(m->>'location_code'))=upper(b->>'location_code') AND
  CASE WHEN m->>'net_weight' ~ '^[0-9]{1,8}(\.[0-9]{1,6})?$'
   THEN (m->>'net_weight')::numeric=(b->>'net_weight')::numeric ELSE false END;
 IF jsonb_array_length(readings) IS DISTINCT FROM jsonb_array_length(facts->'bundles') THEN
  RAISE EXCEPTION 'V27_RETURN_RECHECK_MEASUREMENTS' USING ERRCODE='23514';
 END IF;
 INSERT INTO copper_return_prechecks(correction_id,requested_by,reason,evidence,measurements)
 VALUES(q.id,p_actor,trim(p_reason),facts,readings) RETURNING id INTO result;
 INSERT INTO outbound_correction_steps(correction_id,action,actor_id,reason)
 VALUES(q.id,'request-preparation-recheck',p_actor,trim(p_reason));
 UPDATE outbound_corrections SET version=version+1 WHERE id=q.id;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data)
 VALUES(p_actor,'outbound_return_recheck_requested','outbound_corrections',q.id::text,
  jsonb_build_object('recheck_id',result,'reason',trim(p_reason),'measurements',readings));
 RETURN result;
END $$;

CREATE FUNCTION copper_return_review_recheck(p_actor uuid,p_doc uuid,p_expected int,p_recheck uuid,p_decision text,
 p_reason text,p_confirmed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE q outbound_corrections; application copper_return_prechecks; eligible uuid[]; recovery jsonb;
BEGIN
 q:=copper_return_recheck_document(p_actor,p_doc,p_expected,'outbound:approve',p_reason);
 SELECT * INTO application FROM copper_return_prechecks WHERE id=p_recheck AND correction_id=q.id;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM copper_return_precheck_reviews WHERE recheck_id=p_recheck)
  OR (p_decision IS DISTINCT FROM 'APPROVED' AND p_decision IS DISTINCT FROM 'REJECTED') THEN
  RAISE EXCEPTION 'V27_CORRECTION_STATE_CONFLICT' USING ERRCODE='23514';
 END IF;
 IF application.requested_by=p_actor AND NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND active AND role_code='admin') THEN
  RAISE EXCEPTION 'V27_INDEPENDENT_CORRECTION_REVIEWER_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF p_decision='APPROVED' THEN
  IF p_confirmed IS DISTINCT FROM true THEN RAISE EXCEPTION 'V27_RETURN_RECHECK_MEASUREMENTS' USING ERRCODE='23514'; END IF;
  IF application.evidence IS DISTINCT FROM copper_return_recheck_evidence(q.id) THEN
   RAISE EXCEPTION 'V27_RETURN_RECHECK_STALE' USING ERRCODE='23514';
  END IF;
 END IF;
 INSERT INTO copper_return_precheck_reviews(recheck_id,reviewed_by,decision,reason)
 VALUES(p_recheck,p_actor,p_decision,trim(p_reason));
 INSERT INTO outbound_correction_steps(correction_id,action,actor_id,reason)
 VALUES(q.id,CASE WHEN p_decision='APPROVED' THEN 'approve-preparation-recheck' ELSE 'reject-preparation-recheck' END,p_actor,trim(p_reason));
 IF p_decision='APPROVED' THEN
  SELECT array_agg((b->>'bundle_id')::uuid) INTO eligible FROM jsonb_array_elements(application.evidence->'bundles') b;
  recovery:=copper_apply_return_preparation(p_actor,q.id,q.version,p_reason,eligible);
  IF recovery->>'state' IS DISTINCT FROM 'RESTORED' THEN
   RAISE EXCEPTION 'V27_RETURN_RECHECK_RESTORE_BLOCKED' USING ERRCODE='23514';
  END IF;
  PERFORM copper_close_returned_loading_plan(p_actor,q.id);
 ELSE
  UPDATE outbound_corrections SET version=version+1 WHERE id=q.id;
 END IF;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data)
 VALUES(p_actor,'outbound_return_recheck_'||lower(p_decision),'outbound_corrections',q.id::text,
  jsonb_build_object('recheck_id',p_recheck,'reason',trim(p_reason),'decision',p_decision));
 RETURN jsonb_build_object('state',p_decision,'recheck_id',p_recheck,'preparation_recovery',recovery);
END $$;
REVOKE ALL ON FUNCTION copper_return_request_recheck(uuid,uuid,int,text,text,boolean,jsonb),
 copper_return_review_recheck(uuid,uuid,int,uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copper_return_request_recheck(uuid,uuid,int,text,text,boolean,jsonb),
 copper_return_review_recheck(uuid,uuid,int,uuid,text,text,boolean) TO musonoi_app;
