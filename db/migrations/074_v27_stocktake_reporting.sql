CREATE OR REPLACE FUNCTION stocktake_report(actor uuid,doc uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d stocktakes;r bigint;result jsonb;BEGIN
 SELECT * INTO d FROM stocktakes WHERE id=doc;IF NOT FOUND THEN RAISE EXCEPTION 'Stocktake missing' USING ERRCODE='23514';END IF;PERFORM v24_count_require(actor,'stocktake:read',d.project_id,d.warehouse_id);
 IF d.status='APPROVED' THEN RETURN d.approved_report;END IF;
 r:=coalesce(d.close_revision,v24_revision());
 IF d.phase='DRAFT' THEN RETURN jsonb_build_object('snapshot_pending',true,'rows','[]'::jsonb,'close_revision',r::text,'opening_weight',NULL,'closing_weight',NULL,'difference',NULL,'duplicates',0,'unverified',0);END IF;
 WITH latest AS(SELECT DISTINCT ON(bundle_id) bundle_id,state,revision_id FROM inventory_history WHERE revision_id<=r ORDER BY bundle_id,revision_id DESC),
 ending AS(SELECT * FROM latest WHERE state->>'physical_status'='IN_STOCK' AND v24_count_scope(state,d.scope)),
 obs AS(SELECT o.* FROM stocktake_observations o WHERE stocktake_id=doc AND pass=d.current_pass AND NOT EXISTS(SELECT 1 FROM stocktake_observations n WHERE n.replaces_id=o.id)),
 keys AS(SELECT state->>'bundle_no' no FROM stocktake_snapshot WHERE stocktake_id=doc UNION SELECT state->>'bundle_no' FROM ending UNION SELECT bundle_no FROM obs),
 raw AS(SELECT k.no,base.state book_snapshot,e.state closing_snapshot,o.id observation_id,o.present,o.actual_gross,o.actual_weight,o.actual_location_id,ol.code actual_location,o.actual_state,o.remark,o.counted_at,o.observed_at,o.observed_revision,
 (base.state->>'weight')::numeric opening,(e.state->>'weight')::numeric closing,ob.state observed_book,
 (SELECT count(*) FROM obs WHERE bundle_no=k.no) occurrences,
 CASE WHEN ob.state->>'on_site'='false' THEN 'DEPARTED' WHEN ob.state->>'loading_workflow_state' IN('PENDING','READY','DEPARTED_PENDING','DEPARTED_CORRECTION') OR ob.state->>'loading_status'='LOADED' THEN 'LOADED' WHEN ob.state->>'reservation_id' IS NOT NULL THEN 'RESERVED' ELSE 'AVAILABLE' END expected_state,
 EXISTS(SELECT 1 FROM stocktake_reconciliations z WHERE z.stocktake_id=doc AND z.pass=d.current_pass AND z.bundle_no=k.no AND z.covered_revision>=e.revision_id) reconciled
 FROM keys k LEFT JOIN stocktake_snapshot base ON base.stocktake_id=doc AND base.state->>'bundle_no'=k.no LEFT JOIN ending e ON e.state->>'bundle_no'=k.no LEFT JOIN obs o ON o.bundle_no=k.no LEFT JOIN locations ol ON ol.id=o.actual_location_id
 LEFT JOIN LATERAL(SELECT state FROM inventory_history WHERE state->>'bundle_no'=k.no AND revision_id<=o.observed_revision ORDER BY revision_id DESC LIMIT 1) ob ON true),
 rows AS(SELECT *,CASE
 WHEN occurrences>1 THEN 'DUPLICATE'
 WHEN observation_id IS NULL AND closing_snapshot IS NULL THEN 'REMOVED_BY_FLOW'
 WHEN observation_id IS NULL AND closing_snapshot->>'on_site'='false' THEN 'OFFSITE_PENDING'
 WHEN observation_id IS NULL AND book_snapshot IS NULL THEN CASE WHEN reconciled THEN 'RECONCILED_MOVEMENT' ELSE 'UNVERIFIED_MOVEMENT' END
 WHEN observation_id IS NULL THEN 'UNCOUNTED'
 WHEN NOT present AND(observed_book->>'physical_status' IS DISTINCT FROM 'IN_STOCK' OR observed_book->>'on_site'='false') THEN 'REMOVED_BY_FLOW'
 WHEN NOT present THEN 'LOSS'
 WHEN observed_book IS NULL OR observed_book->>'physical_status'<>'IN_STOCK' THEN 'GAIN'
 WHEN actual_location_id::text IS DISTINCT FROM observed_book->>'location_id' AND expected_state NOT IN('LOADED','DEPARTED') THEN 'LOCATION'
 WHEN actual_state IS NOT NULL AND actual_state<>'UNKNOWN' AND actual_state<>expected_state THEN 'STATUS'
 WHEN actual_weight IS NOT NULL AND actual_weight IS DISTINCT FROM(observed_book->>'weight')::numeric THEN 'WEIGHT'
 ELSE 'MATCH' END finding,
 CASE WHEN actual_weight IS NOT NULL AND closing IS NOT NULL AND observed_book->>'weight' IS NOT NULL THEN actual_weight+closing-(observed_book->>'weight')::numeric END rolled_count
 FROM raw)
 SELECT jsonb_build_object('stocktake_id',doc,'snapshot_revision',d.snapshot_revision::text,'snapshot_at',d.snapshot_at,'snapshot_version',d.snapshot_version,'close_revision',r::text,'pass',d.current_pass,
 'opening_weight',sum(opening)::text,'closing_weight',sum(closing)::text,'movement_net',sum(closing-opening)::text,'rolled_count_weight',sum(rolled_count)::text,'difference',sum(rolled_count-closing)::text,
 'weight_basis','KNOWN_ONLY','unknown_opening',count(*) FILTER(WHERE book_snapshot IS NOT NULL AND opening IS NULL),'unknown_closing',count(*) FILTER(WHERE closing_snapshot IS NOT NULL AND closing IS NULL),
 'duplicates',count(*) FILTER(WHERE finding='DUPLICATE'),'unverified',count(*) FILTER(WHERE finding IN('UNVERIFIED_MOVEMENT','UNCOUNTED')),
 'rows',coalesce(jsonb_agg(jsonb_build_object('bundle_no',no,'finding',finding,'opening',opening::text,'closing',closing::text,'actual_weight',actual_weight::text,'actual_gross',actual_gross::text,'rolled_count',rolled_count::text,'difference',(rolled_count-closing)::text,
 'expected_location',observed_book->>'location','actual_location',actual_location,'actual_location_id',actual_location_id,'actual_state',actual_state,'expected_state',expected_state,'present',present,'observation_id',observation_id,'observed_at',observed_at,'counted_at',counted_at,'observed_revision',observed_revision::text,'remark',remark,'occurrences',occurrences,
 'book_snapshot',book_snapshot,'closing_snapshot',closing_snapshot,'observed_book',observed_book,'weight_mismatch',actual_weight IS NOT NULL AND actual_weight IS DISTINCT FROM(observed_book->>'weight')::numeric,'location_mismatch',actual_location_id::text IS DISTINCT FROM observed_book->>'location_id') ORDER BY no),'[]'::jsonb)) INTO result FROM rows;
 RETURN result;END $$;
CREATE FUNCTION v27_stocktake_action(actor uuid,doc uuid,expected int,action text,note text) RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d stocktakes;r bigint;report jsonb;review boolean;BEGIN
 r:=v24_revision();SELECT * INTO d FROM stocktakes WHERE id=doc FOR UPDATE;IF NOT FOUND OR d.version IS DISTINCT FROM expected OR length(trim(coalesce(note,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 review:=action IN('review','approve','reject','complete');PERFORM v24_count_require(actor,CASE WHEN review THEN 'stocktake:review' ELSE 'stocktake:write' END,d.project_id,d.warehouse_id);
 IF review AND(actor=d.created_by OR EXISTS(SELECT 1 FROM stocktake_observations WHERE stocktake_id=doc AND counted_by=actor)) THEN RAISE EXCEPTION 'V27_INDEPENDENT_COUNT_REVIEWER_REQUIRED' USING ERRCODE='23514';END IF;
 IF action='start' THEN
 IF d.phase<>'DRAFT' THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 UPDATE stocktakes SET phase='IN_PROGRESS',snapshot_revision=r,snapshot_at=v24_posting_time(),snapshot_version=snapshot_version+1 WHERE id=doc RETURNING * INTO d;
 INSERT INTO stocktake_snapshot SELECT doc,bundle_id,state FROM(SELECT DISTINCT ON(bundle_id) bundle_id,state FROM inventory_history WHERE revision_id<=r ORDER BY bundle_id,revision_id DESC)s WHERE state->>'physical_status'='IN_STOCK' AND v24_count_scope(state,d.scope);
 ELSIF action='submit-review' THEN
 IF d.phase<>'IN_PROGRESS' THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;report:=stocktake_report(actor,doc);
 IF(report->>'duplicates')::int>0 OR(report->>'unverified')::int>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(report->'rows') x WHERE x->>'finding' IN('GAIN','LOSS','LOCATION','WEIGHT','STATUS') AND nullif(trim(x->>'remark'),'') IS NULL) THEN RAISE EXCEPTION 'V27_COUNT_DIFFERENCES_REQUIRE_REVIEW' USING ERRCODE='23514';END IF;
 UPDATE stocktakes SET phase='REVIEW',close_revision=r WHERE id=doc;
 ELSIF action='review' THEN
 IF d.phase<>'REVIEW' THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;UPDATE stocktakes SET phase='APPROVAL',status='SUBMITTED',verified_by=actor,verified_at=v24_posting_time() WHERE id=doc;
 ELSIF action='approve' THEN
 IF d.phase<>'APPROVAL' THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;report:=stocktake_report(actor,doc);
 UPDATE stocktakes SET status='APPROVED',phase=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(report->'rows') x WHERE x->>'finding' IN('GAIN','LOSS','LOCATION','WEIGHT','STATUS')) THEN 'ADJUSTMENTS' ELSE 'COMPLETED' END,approved_report=report,reviewed_by=actor,reviewed_at=v24_posting_time(),review_note=note WHERE id=doc;
 ELSIF action='reject' THEN
 IF d.phase NOT IN('REVIEW','APPROVAL') OR d.current_pass>=10 THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;UPDATE stocktakes SET phase='IN_PROGRESS',status='OPEN',current_pass=current_pass+1,close_revision=NULL,verified_by=NULL,verified_at=NULL WHERE id=doc;
 ELSIF action='cancel' THEN
 IF d.phase NOT IN('DRAFT','IN_PROGRESS','REVIEW') THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;UPDATE stocktakes SET phase='CANCELLED',cancelled_by=actor,cancelled_at=v24_posting_time(),cancel_reason=note WHERE id=doc;
 ELSIF action='complete' THEN
 IF d.phase<>'ADJUSTMENTS' THEN RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(d.approved_report->'rows') x WHERE x->>'finding' IN('GAIN','LOSS','LOCATION','WEIGHT','STATUS') AND NOT EXISTS(SELECT 1 FROM stocktake_resolutions z LEFT JOIN stock_adjustments a ON a.id=z.adjustment_id LEFT JOIN receipts rc ON rc.id=z.receipt_id WHERE z.stocktake_id=doc AND z.pass=d.current_pass AND z.bundle_no=x->>'bundle_no' AND(z.method='VERIFIED' OR z.method='ADJUSTMENT' AND a.status='APPLIED' OR z.method='INBOUND' AND rc.status='CONFIRMED'))) THEN RAISE EXCEPTION 'V27_COUNT_ADJUSTMENTS_PENDING' USING ERRCODE='23514';END IF;
 UPDATE stocktakes SET phase='COMPLETED' WHERE id=doc;
 ELSE RAISE EXCEPTION 'V27_COUNT_STATE_CONFLICT' USING ERRCODE='23514';END IF;
 UPDATE stocktakes SET version=version+1 WHERE id=doc RETURNING * INTO d;INSERT INTO stocktake_steps(stocktake_id,action,pass,actor_id,note) VALUES(doc,action,d.current_pass,actor,note);INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data) VALUES(actor,'stocktake_'||action,'stocktakes',doc::text,to_jsonb(d)-'approved_report');RETURN d;
END $$;
REVOKE ALL ON FUNCTION v27_stocktake_action(uuid,uuid,int,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v27_stocktake_action(uuid,uuid,int,text,text) TO musonoi_app;
