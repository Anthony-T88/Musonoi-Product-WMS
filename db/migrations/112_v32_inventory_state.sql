-- One classifier for current projections and immutable historical snapshots.
CREATE FUNCTION v32_inventory_state(physical text,occupied boolean,workflow text,loading text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN physical='OUTBOUND' THEN 'OUTBOUND' WHEN workflow IN('READY','DEPARTED_PENDING','DEPARTED_CORRECTION') OR loading='LOADED' THEN 'LOADED_PENDING' WHEN workflow='PENDING' OR loading='DRAFT' THEN 'LOADING_ASSIGNED' WHEN occupied THEN 'PREPARATION_LOCKED' ELSE 'AVAILABLE' END $$;
CREATE FUNCTION v32_state_label(code text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE code WHEN 'AVAILABLE' THEN '可用库存' WHEN 'PREPARATION_LOCKED' THEN '备货锁定' WHEN 'LOADING_ASSIGNED' THEN '已分配装车' WHEN 'LOADED_PENDING' THEN '已装车待正式出库' WHEN 'OUTBOUND' THEN '已正式出库' END $$;
CREATE FUNCTION v32_snapshot_state(s jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT coalesce(s->>'inventory_state_code',v32_inventory_state(s->>'physical_status',s->>'reservation_id' IS NOT NULL OR s->>'sample_status'='SAMPLING' OR coalesce((s->>'pending_adjustment')::boolean,false),s->>'loading_workflow_state',CASE WHEN s->>'loading_status' IN('DRAFT','LOADED') THEN s->>'loading_status' END)) $$;
DO $$ DECLARE cols text;BEGIN
 SELECT string_agg(CASE column_name
 WHEN 'business_status' THEN 'v32_state_label(v32_inventory_state(b.physical_status,(rr.id IS NOT NULL OR lo.id IS NOT NULL OR b.sample_status=''SAMPLING'' OR pending.occupied),lo.workflow_state,lo.status)) AS business_status'
 WHEN 'status' THEN 'CASE WHEN b.physical_status=''OUTBOUND'' THEN ''已出库'' WHEN b.physical_status=''IN_STOCK'' AND(rr.id IS NOT NULL OR lo.id IS NOT NULL OR b.sample_status=''SAMPLING'' OR pending.occupied) THEN ''已预留'' WHEN b.physical_status=''IN_STOCK'' THEN ''在库'' ELSE prior.status END AS status'
 WHEN 'loading_workflow_state' THEN 'lo.workflow_state AS loading_workflow_state'
 WHEN 'on_site' THEN '(b.physical_status=''IN_STOCK'' AND coalesce(lo.workflow_state,'''') NOT IN(''DEPARTED_PENDING'',''DEPARTED_CORRECTION'')) AS on_site'
 ELSE 'prior.'||quote_ident(column_name) END,',' ORDER BY ordinal_position) INTO cols FROM information_schema.columns WHERE table_schema='public' AND table_name='inventory_view';
 ALTER VIEW inventory_view RENAME TO inventory_v31_compat;
 EXECUTE 'CREATE VIEW inventory_view AS SELECT '||cols||',prior.business_status AS workflow_detail,v32_inventory_state(b.physical_status,(rr.id IS NOT NULL OR lo.id IS NOT NULL OR b.sample_status=''SAMPLING'' OR pending.occupied),lo.workflow_state,lo.status) AS inventory_state_code,rr.id AS effective_reservation_id,lo.id AS effective_loading_id FROM inventory_v31_compat prior JOIN bundles b ON b.id=prior.uuid LEFT JOIN LATERAL(SELECT r.id FROM reservations r JOIN allocations a ON a.id=r.allocation_id WHERE r.bundle_id=b.id AND r.released_at IS NULL AND a.status NOT IN(''CANCELLED'',''FULFILLED'') AND coalesce(a.workflow_state,'''')<>''CANCELLED'' LIMIT 1)rr ON true LEFT JOIN LATERAL(SELECT l.* FROM loading_items i JOIN loading_orders l ON l.id=i.loading_id WHERE i.bundle_id=b.id AND i.active AND NOT i.plan_removed AND l.status IN(''DRAFT'',''LOADED'') AND coalesce(l.workflow_state,'''') NOT IN(''CANCELLED'',''UNLOADED'',''REJECTED'',''OUTBOUND'') LIMIT 1)lo ON true CROSS JOIN LATERAL(SELECT EXISTS(SELECT 1 FROM stock_adjustments sa JOIN adjustment_lines al ON al.adjustment_id=sa.id WHERE al.bundle_no=b.bundle_no AND sa.status IN(''DRAFT'',''PENDING'')) AS occupied)pending';
END $$;
GRANT SELECT ON inventory_view,inventory_v31_compat TO musonoi_app;
ALTER FUNCTION v24_capture_bundle(uuid) RENAME TO v32_prior_capture;
CREATE FUNCTION v24_capture_bundle(bid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE v inventory_view;BEGIN
 PERFORM v32_prior_capture(bid);SELECT * INTO v FROM inventory_view WHERE uuid=bid;
 UPDATE inventory_history SET state=state||jsonb_build_object('inventory_state_code',v.inventory_state_code,'business_status',v.business_status,'workflow_detail',v.workflow_detail,'status',v.status,'loading_workflow_state',v.loading_workflow_state,'on_site',v.on_site,'effective_reservation_id',v.effective_reservation_id,'effective_loading_id',v.effective_loading_id) WHERE bundle_id=bid AND revision_id=v24_revision();
END $$;
REVOKE ALL ON FUNCTION v32_prior_capture(uuid),v24_capture_bundle(uuid) FROM PUBLIC;
-- Append a new projection revision; never rewrite a pre-upgrade snapshot.
DO $$ DECLARE id uuid;BEGIN PERFORM v24_revision();FOR id IN SELECT b.id FROM bundles b ORDER BY b.id LOOP PERFORM v24_capture_bundle(id);END LOOP;END $$;
