-- Validate each returned bundle against its own immutable posting and all later custody activity.
CREATE FUNCTION copper_return_stock_blockers(p_doc uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH correction AS (
  SELECT q.*,nullif(q.proposed_data->>'return_location_id','')::uuid return_location
  FROM outbound_corrections q WHERE q.id=p_doc AND q.kind='RETURN_OUTBOUND' AND q.status='APPLIED'
 ), evidence AS (
  SELECT q.id correction_id,q.applied_revision,q.applied_at,q.return_location,x snapshot,b.id bundle_id,
   b.bundle_no,b.version,b.physical_status,b.location_id,b.sample_status,b.net_weight,b.project_id,b.customer_id,b.batch_id,
   posted.id event_id,posted.physical_delta returned_weight,posted.before_data original_state,count(*) OVER (PARTITION BY x->>'bundle_id') matches
  FROM correction q CROSS JOIN LATERAL jsonb_array_elements(q.bundle_snapshot) x
  LEFT JOIN bundles b ON b.id=(x->>'bundle_id')::uuid
  LEFT JOIN inventory_events posted ON posted.bundle_id=b.id AND posted.event_type='REVERSAL'
   AND posted.revision_id=q.applied_revision AND posted.actor_id=q.applied_by
   AND posted.physical_delta>0 AND posted.after_data @> jsonb_build_object(
    'correction_id',q.id,'loading_id',q.loading_id,'location_id',q.return_location)
   AND posted.before_data @> jsonb_build_object('physical_status','OUTBOUND','version',x->'version','net_weight',posted.physical_delta)
   AND x->'net_weight'=to_jsonb(posted.physical_delta)
 ), checks AS (
  SELECT coalesce(b.snapshot->>'bundle_no',b.bundle_no) bundle_no,
   CASE
    WHEN b.event_id IS NULL OR b.matches<>1 THEN 'RETURN_EVIDENCE_MISSING'
    WHEN b.physical_status<>'IN_STOCK' THEN 'STOCK_NOT_ON_SITE'
    WHEN b.location_id IS DISTINCT FROM b.return_location THEN 'RETURN_LOCATION_CHANGED'
    WHEN EXISTS(SELECT 1 FROM reservations r WHERE r.bundle_id=b.bundle_id AND r.released_at IS NULL) THEN 'ACTIVE_RESERVATION'
    WHEN EXISTS(SELECT 1 FROM loading_items i WHERE i.bundle_id=b.bundle_id AND i.active AND NOT i.plan_removed) THEN 'ACTIVE_LOADING'
    WHEN EXISTS(SELECT 1 FROM adjustment_lines al JOIN stock_adjustments sa ON sa.id=al.adjustment_id
     WHERE al.bundle_no=b.bundle_no AND sa.project_id=b.project_id AND sa.status IN('DRAFT','PENDING')) THEN 'STOCK_ADJUSTMENT_PENDING'
    WHEN EXISTS(SELECT 1 FROM inventory_events e WHERE e.bundle_id=b.bundle_id AND e.id>b.event_id)
     OR EXISTS(SELECT 1 FROM reservations r WHERE r.bundle_id=b.bundle_id
      AND (r.locked_at>b.applied_at OR r.released_at>b.applied_at))
     OR EXISTS(SELECT 1 FROM inventory_history h WHERE h.bundle_id=b.bundle_id AND h.revision_id>b.applied_revision
      AND (h.state->>'physical_status' IS DISTINCT FROM 'IN_STOCK'
       OR h.state->>'location_id' IS DISTINCT FROM b.return_location::text
       OR h.state->>'reservation_id' IS NOT NULL OR h.state->>'effective_loading_id' IS NOT NULL))
     THEN 'SUBSEQUENT_STOCK_ACTIVITY'
    WHEN b.net_weight IS DISTINCT FROM b.returned_weight
     OR b.sample_status IS DISTINCT FROM (b.original_state->>'sample_status')
     OR b.project_id::text IS DISTINCT FROM (b.original_state->>'project_id')
     OR b.customer_id::text IS DISTINCT FROM (b.original_state->>'customer_id')
     OR b.batch_id::text IS DISTINCT FROM (b.original_state->>'batch_id')
     OR b.version<(b.snapshot->>'version')::integer+1
     OR (b.version>(b.snapshot->>'version')::integer+1 AND NOT (
      SELECT count(DISTINCT fix.bundle_version)=b.version-((b.snapshot->>'version')::integer+1)
      FROM bundle_corrections fix JOIN inventory_revisions rev ON rev.txid=fix.applied_txid
      JOIN inventory_history h ON h.bundle_id=fix.bundle_id AND h.revision_id=rev.id
      WHERE fix.bundle_id=b.bundle_id AND fix.state='APPROVED' AND rev.id>b.applied_revision
       AND fix.bundle_version BETWEEN (b.snapshot->>'version')::integer+1 AND b.version-1
       AND fix.changes<>'{}'::jsonb AND (fix.changes-ARRAY['sheets_per_bundle','production_date','seal_no'])='{}'::jsonb
       AND h.state->'version'=to_jsonb(fix.bundle_version+1)
       AND h.state->>'project_id'=b.project_id::text AND h.state->>'customer_id'=b.customer_id::text
       AND h.state->>'batch_id'=b.batch_id::text AND h.state->>'sample_status'=b.sample_status
       AND (h.state->>'weight')::numeric=b.returned_weight
     )) THEN 'BUNDLE_DATA_CHANGED'
   END reason
  FROM evidence b
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('bundle_no',bundle_no,'reason',reason) ORDER BY bundle_no,reason),'[]'::jsonb)
 FROM (SELECT DISTINCT bundle_no,reason FROM checks WHERE reason IS NOT NULL) blockers
$$;
REVOKE ALL ON FUNCTION copper_return_stock_blockers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copper_return_stock_blockers(uuid) TO musonoi_app;

DO $$
DECLARE
 definition text:=pg_get_functiondef('copper_return_preparation_state(uuid)'::regprocedure);
 first text:=$start$ ELSIF NOT EXISTS(SELECT 1 FROM locations loc JOIN warehouses w ON w.id=loc.warehouse_id$start$;
 last text:=$finish$ ELSIF EXISTS(
  SELECT 1 FROM loading_plan_lot_locks k$finish$;
 initialize_from text:=$anchor$ target:=nullif(q.proposed_data->>'return_location_id','')::uuid;$anchor$;
 patch text:=$replacement$ ELSIF return_area_unavailable OR jsonb_array_length(stock_blockers)>0 THEN
  block:='RETURNED_STOCK_CHANGED';
$replacement$;
BEGIN
 IF strpos(definition,first)=0 OR strpos(definition,last)<=strpos(definition,first)
  OR strpos(definition,' block text;')=0 OR strpos(definition,'''blocker'',block,')=0 OR strpos(definition,initialize_from)=0 THEN
  RAISE EXCEPTION 'Expected copper return stock and result checks';
 END IF;
 definition:=left(definition,strpos(definition,first)-1)||patch||substr(definition,strpos(definition,last));
 definition:=replace(definition,' block text;',
  ' block text;'||chr(10)||' stock_blockers jsonb;'||chr(10)||' return_area_unavailable boolean;');
 definition:=replace(definition,initialize_from,$initialize$
 target:=nullif(q.proposed_data->>'return_location_id','')::uuid;
 stock_blockers:=copper_return_stock_blockers(p_doc);
 SELECT NOT EXISTS(SELECT 1 FROM locations loc JOIN warehouses w ON w.id=loc.warehouse_id
  JOIN loading_orders l ON l.id=q.loading_id AND l.project_id=loc.project_id
  WHERE loc.id=target AND loc.active AND loc.map_usage='TEMPORARY' AND w.active) INTO return_area_unavailable;
$initialize$);
 EXECUTE replace(definition,'''blocker'',block,','''blocker'',block,''stock_blockers'',stock_blockers,''return_area_unavailable'',return_area_unavailable,');
END $$;

-- If the seal was corrected since return, require confirmation on the reopened preparation.
DO $$
DECLARE definition text:=pg_get_functiondef('copper_apply_return_preparation(uuid,uuid,int,text)'::regprocedure);
 anchor text:=$start$   PERFORM v24_capture_bundle(item.bundle_id);$start$;
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected restored bundle inventory capture'; END IF;
 EXECUTE replace(definition,anchor,$replacement$   IF EXISTS(SELECT 1 FROM bundle_corrections fix JOIN inventory_revisions rev ON rev.txid=fix.applied_txid
    WHERE fix.bundle_id=item.bundle_id AND fix.state='APPROVED' AND rev.id>q.applied_revision AND fix.changes?'seal_no') THEN
    UPDATE lot_work_items SET seal_valid=false,version=version+1
     WHERE allocation_id=item.allocation_id AND bundle_id=item.bundle_id AND seal_valid;
    IF FOUND THEN
     INSERT INTO lot_work_history(allocation_id,bundle_id,action,actor_id,before_data,after_data,note)
      VALUES(item.allocation_id,item.bundle_id,'SEAL_INVALIDATED',p_actor,'{"seal_valid":true}',
       jsonb_build_object('seal_valid',false,'correction_id',p_doc),'核对返厂后更正的铅封号');
    END IF;
   END IF;
   PERFORM v24_capture_bundle(item.bundle_id);$replacement$);
END $$;
