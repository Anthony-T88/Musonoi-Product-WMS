ALTER TABLE stocktake_resolutions DROP CONSTRAINT stocktake_resolutions_stocktake_id_pass_bundle_no_key;
ALTER TABLE stocktake_resolutions ADD UNIQUE(stocktake_id,pass,bundle_no,finding);
CREATE FUNCTION v27_count_unresolved(doc uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT count(*)::int FROM stocktakes d CROSS JOIN LATERAL jsonb_array_elements(d.approved_report->'rows') x CROSS JOIN LATERAL(
 SELECT x->>'finding' finding WHERE x->>'finding' IN('LOSS','GAIN','STATUS')
 UNION SELECT 'WEIGHT' WHERE(x->>'weight_mismatch')::boolean
 UNION SELECT 'LOCATION' WHERE(x->>'location_mismatch')::boolean
 ) required WHERE d.id=doc AND NOT EXISTS(
 SELECT 1 FROM stocktake_resolutions z LEFT JOIN stock_adjustments a ON a.id=z.adjustment_id LEFT JOIN receipts r ON r.id=z.receipt_id
 WHERE z.stocktake_id=doc AND z.pass=d.current_pass AND z.bundle_no=x->>'bundle_no' AND z.finding=required.finding AND(z.method='VERIFIED' OR z.method='ADJUSTMENT' AND a.status='APPLIED' OR z.method='INBOUND' AND r.status='CONFIRMED'))
$$;
DO $$ DECLARE d text;start_at integer;end_at integer;BEGIN
 SELECT pg_get_functiondef('v27_stocktake_action(uuid,uuid,int,text,text)'::regprocedure) INTO d;
 start_at:=position('IF EXISTS(SELECT 1 FROM jsonb_array_elements(d.approved_report' in d);
 end_at:=position('THEN RAISE EXCEPTION ''V27_COUNT_ADJUSTMENTS_PENDING''' in d);
 IF start_at=0 OR end_at=0 THEN RAISE EXCEPTION 'Unexpected completion definition';END IF;
 d:=substr(d,1,start_at-1)||'IF v27_count_unresolved(doc)>0 '||substr(d,end_at);EXECUTE d;
 SELECT pg_get_functiondef('v27_stocktake_resolve(uuid,uuid,int,text,text,jsonb,text)'::regprocedure) INTO d;
 d:=replace(d,'kind text;entries jsonb;','kind text;finding text;entries jsonb;');
 d:=replace(d,'IF method=''ADJUSTMENT'' THEN', $n$finding:=coalesce(payload->>'finding',row->>'finding');
 IF NOT(finding=row->>'finding' OR finding='WEIGHT' AND(row->>'weight_mismatch')::boolean OR finding='LOCATION' AND(row->>'location_mismatch')::boolean) THEN RAISE EXCEPTION 'V27_DIFFERENCE_NOT_FOUND' USING ERRCODE='23514';END IF;
 IF method='ADJUSTMENT' THEN$n$);
 d:=replace(d,'IF row->>''finding''=''STATUS''','IF finding=''STATUS''');
 d:=replace(d,'kind:=row->>''finding'';','kind:=finding;');
 d:=replace(d,'row->>''finding'',method,a.id','finding,method,a.id');
 d:=replace(d,'kind:=finding;SELECT', $n$kind:=finding;
 IF kind='WEIGHT' AND(payload->>'gross_weight')::numeric IS DISTINCT FROM(row->>'actual_gross')::numeric THEN RAISE EXCEPTION 'V27_GROSS_BASIS_REQUIRED' USING ERRCODE='23514';END IF;
 IF kind='LOCATION' AND payload->>'location_id' IS DISTINCT FROM row->>'actual_location_id' THEN RAISE EXCEPTION 'V27_INVALID_COUNT_SCOPE' USING ERRCODE='23514';END IF;
 SELECT$n$);EXECUTE d;
END $$;
REVOKE ALL ON FUNCTION v27_count_unresolved(uuid) FROM PUBLIC;
