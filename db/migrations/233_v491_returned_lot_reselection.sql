-- A confirmed return starts a new approval round without rewriting the old review.
CREATE OR REPLACE FUNCTION v262_lot_approval_active(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=public,pg_temp AS $$
 SELECT coalesce((
  SELECT r.action='APPROVE' FROM workflow_reviews r
  WHERE r.allocation_id=doc AND r.action IN('APPROVE','REOPEN','RETURN_REOPEN')
  ORDER BY r.id DESC LIMIT 1
 ),false);
$$;

-- Ignore only the formally reversed loading from which this lot was restored.
CREATE FUNCTION v262_lot_has_blocking_loading(doc uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM loading_plan_lot_locks WHERE allocation_id=doc)
  OR EXISTS(
   SELECT 1 FROM loading_orders l
   WHERE l.allocation_id=doc AND NOT (
    l.workflow_state IS NOT DISTINCT FROM 'OUTBOUND' AND l.status='DEPARTED'
    AND EXISTS(
     SELECT 1 FROM outbound_corrections q
     JOIN copper_outbound_return_preparations p ON p.correction_id=q.id
     WHERE q.loading_id=l.id AND q.kind='RETURN_OUTBOUND' AND q.status='APPLIED'
      AND doc=ANY(p.allocation_ids)
    )
   )
  );
$$;
REVOKE ALL ON FUNCTION v262_lot_has_blocking_loading(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v262_lot_has_blocking_loading(uuid),
 copper_return_preparation_item_current(uuid,uuid) TO musonoi_app;

DO $$
DECLARE
 definition text:=pg_get_functiondef('v262_preapproval_action(uuid,uuid,integer,text,jsonb)'::regprocedure);
 anchor text;
 replacement text;
BEGIN
 FOR anchor,replacement IN VALUES
  ('PERFORM v24_revision();SELECT', 'PERFORM v24_revision();PERFORM pg_advisory_xact_lock(21004);SELECT'),
  ($old$OR EXISTS(SELECT 1 FROM loading_orders WHERE allocation_id=doc)
  OR EXISTS(SELECT 1 FROM loading_plan_lot_locks WHERE allocation_id=doc)$old$,
   'OR v262_lot_has_blocking_loading(doc)'),
  ('WHERE ai.allocation_id=doc ORDER BY bb.id','WHERE ai.allocation_id=doc AND copper_return_preparation_item_current(doc,bb.id) ORDER BY bb.id'),
  ($old$WHERE allocation_id=doc AND sample_stage='IN_PROGRESS'$old$,
   $new$WHERE allocation_id=doc AND sample_stage='IN_PROGRESS'
    AND copper_return_preparation_item_current(doc,bundle_id)$new$),
  ('WHERE ai.allocation_id=doc AND (bb.physical_status',
   'WHERE ai.allocation_id=doc AND copper_return_preparation_item_current(doc,bb.id) AND (bb.physical_status'),
  ($old$WHERE ai.allocation_id=doc AND (NOT l.active OR l.map_usage='REVIEW')$old$,
   $new$WHERE ai.allocation_id=doc AND copper_return_preparation_item_current(doc,bb.id) AND (NOT l.active OR l.map_usage='REVIEW')$new$)
 LOOP
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected preparation revoke guard: %',anchor; END IF;
  definition:=replace(definition,anchor,replacement);
 END LOOP;
 EXECUTE definition;
END $$;

-- A restored reservation already has an earlier issue/unlock. Identify the new
-- unlock using the checked cancellation in the current transaction.
DO $$
DECLARE
 definition text:=pg_get_functiondef('copper_return_reservation_event_identity()'::regprocedure);
 anchor text:=$old$AND (EXISTS(SELECT 1 FROM loading_items i$old$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected returned reservation history guard'; END IF;
 EXECUTE replace(definition,anchor,$new$AND (
     (NEW.after_data->>'basis'='PREAPPROVAL_REVOKE' AND EXISTS(
      SELECT 1 FROM allocations a
      WHERE a.id=r.allocation_id AND a.workflow_state='CANCELLED' AND a.cancelled_by=NEW.actor_id
       AND a.cancellation_observation->>'preapproval_revoke_txid'=txid_current()::text
       AND r.released_at>=a.cancelled_at AND r.release_reason=a.cancel_note
     ))
     OR EXISTS(SELECT 1 FROM loading_items i$new$);
END $$;
