-- Sales managers may submit plans when granted plan:write. Review still requires
-- a different actor. No role receives the permission automatically.
INSERT INTO role_permission_caps(role_code,permission_code)
VALUES ('sales_manager','plan:write') ON CONFLICT DO NOTHING;

DO $$
DECLARE original text; updated text;
BEGIN
 original:=pg_get_functiondef('ux10_plan_submission()'::regprocedure);
 updated:=replace(original,$old$u.role_code IN('sales_operator','admin')$old$,
                           $new$u.role_code IN('sales_operator','admin','sales_manager')$new$);
 IF updated=original THEN RAISE EXCEPTION 'Unexpected sales submission definition'; END IF;
 EXECUTE updated;
 original:=pg_get_functiondef('v468_submit_legacy_plan_edit(text,uuid,uuid,integer)'::regprocedure);
 updated:=replace(original,$old$u.role_code IN('sales_operator','admin')$old$,
                           $new$u.role_code IN('sales_operator','admin','sales_manager')$new$);
 IF updated=original THEN RAISE EXCEPTION 'Unexpected sales edit definition'; END IF;
 EXECUTE updated;
END $$;

-- Operational scale readings remain available on the preparation document.
-- Only supervisor-approved work contributes weight to inventory projections.
CREATE FUNCTION v470_pending_preparation_weight(workflow text, state text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT coalesce(workflow='2.6.1' AND state NOT IN('PREPARED','PARTIAL','FULFILLED'),false)
$$;

CREATE INDEX v470_inventory_weight_events
 ON inventory_events(bundle_id,revision_id DESC,id DESC) WHERE event_type='ADJUST_WEIGHT';

-- Revoking an unapproved lot releases the stock without approving its reading.
CREATE FUNCTION v470_pending_released_weight(bid uuid, cutoff bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH latest AS (
  SELECT revision_id,after_data FROM inventory_events
  WHERE bundle_id=bid AND event_type='ADJUST_WEIGHT' AND revision_id<=cutoff
  ORDER BY revision_id DESC,id DESC LIMIT 1
 )
 SELECT EXISTS(
  SELECT 1 FROM latest e WHERE e.after_data->>'basis'='V261_MEASURED'
  AND NOT EXISTS(
   SELECT 1 FROM inventory_history h JOIN reservations r ON r.id::text=h.state->>'reservation_id'
   WHERE h.bundle_id=bid AND h.revision_id BETWEEN e.revision_id AND cutoff
   AND r.allocation_id::text=e.after_data->>'allocation_id'
   AND h.state->>'lot_workflow_state' IN('PREPARED','PARTIAL','FULFILLED')
  )
 )
$$;

DO $$
DECLARE original text; updated text;
 pending text:=$condition$v470_pending_preparation_weight(prior.lot_workflow_version,prior.lot_workflow_state)
   OR (prior.lot_workflow_version IS NULL AND prior.weight IS NOT NULL AND b.physical_status='IN_STOCK'
       AND v470_pending_released_weight(b.id,9223372036854775807))$condition$;
BEGIN
 original:=pg_get_viewdef('inventory_view'::regclass,false);
 updated:=replace(original,'prior.weight,',
   'CASE WHEN '||pending||' THEN NULL ELSE prior.weight END AS weight,');
 IF updated=original THEN RAISE EXCEPTION 'Unexpected inventory weight projection'; END IF;
 original:=updated;
 updated:=replace(original,'prior.gross_weight,',
   'CASE WHEN '||pending||' THEN NULL ELSE prior.gross_weight END AS gross_weight,');
 IF updated=original THEN RAISE EXCEPTION 'Unexpected inventory gross projection'; END IF;
 EXECUTE 'CREATE OR REPLACE VIEW inventory_view AS '||updated;
END $$;

CREATE OR REPLACE FUNCTION v32_inventory_history(revision bigint)
RETURNS TABLE(bundle_id uuid,state jsonb) LANGUAGE sql STABLE AS $$
 WITH latest AS (
  SELECT DISTINCT ON(h.bundle_id) h.bundle_id,h.state
  FROM inventory_history h WHERE h.revision_id<=revision
  ORDER BY h.bundle_id,h.revision_id DESC
 ), effective AS (
  SELECT h.bundle_id,h.state||jsonb_build_object('pending_adjustment',
    CASE WHEN h.state->>'physical_status'='IN_STOCK' THEN EXISTS(
      SELECT 1 FROM adjustment_lines al JOIN (
        SELECT DISTINCT ON(document_id) document_id,data FROM document_history
        WHERE kind='stock_adjustments' AND revision_id<=revision
        ORDER BY document_id,revision_id DESC
      ) d ON d.document_id=al.adjustment_id
      WHERE al.bundle_no=h.state->>'bundle_no' AND d.data->>'status' IN('DRAFT','PENDING')
    ) ELSE false END
  ) state FROM latest h
 ), classified AS (
  SELECT e.bundle_id,e.state,v32_snapshot_state(e.state) code FROM effective e
 )
 SELECT c.bundle_id,c.state||jsonb_build_object('inventory_state_code',c.code,'business_status',v32_state_label(c.code))||
   CASE WHEN v470_pending_preparation_weight(c.state->>'lot_workflow_version',c.state->>'lot_workflow_state')
     OR (c.state->>'lot_workflow_version' IS NULL AND c.state->>'weight' IS NOT NULL
         AND c.state->>'physical_status'='IN_STOCK' AND v470_pending_released_weight(c.bundle_id,revision))
     THEN '{"weight":null,"gross_weight":null,"net_weight":null}'::jsonb ELSE '{}'::jsonb END
 FROM classified c;
$$;
