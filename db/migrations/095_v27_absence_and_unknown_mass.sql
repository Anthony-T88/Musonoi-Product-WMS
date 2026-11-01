-- An absent ledger row has zero balance; an existing unweighed row has unknown mass.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('stocktake_report(uuid,uuid)'::regprocedure) INTO d;
 d:=replace(d,'(base.state->>''weight'')::numeric opening,(e.state->>''weight'')::numeric closing','CASE WHEN base.state IS NULL THEN 0 ELSE(base.state->>''weight'')::numeric END opening,CASE WHEN e.state IS NULL THEN 0 ELSE(e.state->>''weight'')::numeric END closing');
 d:=replace(d,'CASE WHEN actual_weight IS NOT NULL AND closing IS NOT NULL AND observed_book->>''weight'' IS NOT NULL THEN actual_weight+closing-(observed_book->>''weight'')::numeric END rolled_count',
 'CASE WHEN (actual_weight IS NOT NULL OR NOT present) AND closing IS NOT NULL AND(observed_book IS NULL OR observed_book->>''physical_status''<>''IN_STOCK'' OR observed_book->>''weight'' IS NOT NULL) THEN CASE WHEN NOT present THEN 0 ELSE actual_weight END+closing-CASE WHEN observed_book IS NULL OR observed_book->>''physical_status''<>''IN_STOCK'' THEN 0 ELSE(observed_book->>''weight'')::numeric END END rolled_count');
 EXECUTE d;
END $$;
