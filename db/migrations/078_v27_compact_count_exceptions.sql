-- The complete evidence is frozen in approved_report; exception descriptions remain bounded.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v24_count_exceptions()'::regprocedure) INTO d;
 d:=replace(d,'''盘点批准差异：''||x::text', '''盘点批准差异：''||jsonb_build_object(''bundle_no'',x->>''bundle_no'',''finding'',x->>''finding'',''observation_id'',x->>''observation_id'',''reason'',x->>''remark'',''actual_weight'',x->>''actual_weight'',''expected_location'',x->>''expected_location'')::text');EXECUTE d;
 SELECT pg_get_functiondef('stocktake_report(uuid,uuid)'::regprocedure) INTO d;
 d:=replace(d,'''location_mismatch'',actual_location_id::text IS DISTINCT FROM observed_book->>''location_id''','''location_mismatch'',present AND observed_book IS NOT NULL AND(actual_location_id::text IS DISTINCT FROM observed_book->>''location_id'')');EXECUTE d;
END $$;
