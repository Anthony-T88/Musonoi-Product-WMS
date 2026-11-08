ALTER TABLE stocktake_resolutions DROP CONSTRAINT stocktake_resolutions_method_check;
ALTER TABLE stocktake_resolutions ADD CONSTRAINT stocktake_resolutions_method_check CHECK(method IN('ADJUSTMENT','VERIFIED','INBOUND','CORRECTION'));
ALTER TABLE stocktake_resolutions ADD COLUMN correction_id uuid REFERENCES outbound_corrections(id);
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('stocktake_report(uuid,uuid)'::regprocedure) INTO d;
 d:=replace(d,'''weight_mismatch'',actual_weight IS NOT NULL AND actual_weight IS DISTINCT FROM(observed_book->>''weight'')::numeric','''weight_mismatch'',present AND observed_book->>''physical_status''=''IN_STOCK'' AND actual_weight IS NOT NULL AND actual_weight IS DISTINCT FROM(observed_book->>''weight'')::numeric');EXECUTE d;
 SELECT pg_get_functiondef('v27_stocktake_resolve(uuid,uuid,int,text,text,jsonb,text)'::regprocedure) INTO d;
 d:=replace(d,'receipt receipts;kind text;','receipt receipts;correction outbound_corrections;kind text;');
 d:=replace(d,'AND project_id=d.project_id AND status=''CONFIRMED''','AND project_id=d.project_id AND status=''CONFIRMED'' AND confirmed_at>=d.snapshot_at');
 d:=replace(d,'WHERE receipt_id=receipt.id AND v265_bundle_key','WHERE physical_status=''IN_STOCK'' AND receipt_id=receipt.id AND v265_bundle_key');
 d:=replace(d,'ELSIF method=''VERIFIED'' THEN', $n$ELSIF method='CORRECTION' THEN
 SELECT * INTO correction FROM outbound_corrections q WHERE id=(payload->>'correction_id')::uuid AND status='APPLIED' AND EXISTS(SELECT 1 FROM jsonb_array_elements(q.bundle_snapshot) z WHERE z->>'bundle_no'=label);
 IF NOT FOUND OR finding NOT IN('GAIN','LOCATION','STATUS') OR NOT EXISTS(SELECT 1 FROM bundles WHERE bundle_no=label AND physical_status='IN_STOCK' AND(row->>'actual_weight' IS NULL OR net_weight=(row->>'actual_weight')::numeric) AND(row->>'actual_location_id' IS NULL OR location_id=(row->>'actual_location_id')::uuid)) THEN RAISE EXCEPTION 'V27_USE_RELATED_WORKFLOW' USING ERRCODE='23514';END IF;
 ELSIF method='VERIFIED' THEN$n$);
 d:=replace(d,'adjustment_id,receipt_id,reason,actor_id)','adjustment_id,receipt_id,correction_id,reason,actor_id)');
 d:=replace(d,'method,a.id,receipt.id,reason,actor)','method,a.id,receipt.id,correction.id,reason,actor)');EXECUTE d;
 SELECT pg_get_functiondef('v27_count_unresolved(uuid)'::regprocedure) INTO d;
 d:=replace(d,'LEFT JOIN receipts r ON r.id=z.receipt_id','LEFT JOIN receipts r ON r.id=z.receipt_id LEFT JOIN outbound_corrections cr ON cr.id=z.correction_id');
 d:=replace(d,'z.method=''VERIFIED'' OR','z.method=''CORRECTION'' AND cr.status=''APPLIED'' OR z.method=''VERIFIED'' OR');EXECUTE d;
END $$;
