-- A normal move outside a partial count scope is not a stock loss.
DO $$ DECLARE def text;BEGIN
 SELECT pg_get_functiondef('stocktake_report(uuid,uuid)'::regprocedure) INTO def;
 def:=replace(def,'WHEN NOT present AND(observed_book->>''physical_status'' IS DISTINCT FROM ''IN_STOCK'' OR observed_book->>''on_site''=''false'')','WHEN NOT present AND(observed_book->>''physical_status'' IS DISTINCT FROM ''IN_STOCK'' OR observed_book->>''on_site''=''false'' OR NOT v24_count_scope(observed_book,d.scope))');
 def:=replace(def,'observed_book->>''physical_status''<>''IN_STOCK'' OR observed_book->>''weight'' IS NOT NULL','observed_book->>''physical_status''<>''IN_STOCK'' OR NOT v24_count_scope(observed_book,d.scope) OR observed_book->>''weight'' IS NOT NULL');
 def:=replace(def,'CASE WHEN observed_book IS NULL OR observed_book->>''physical_status''<>''IN_STOCK'' THEN 0 ELSE','CASE WHEN observed_book IS NULL OR observed_book->>''physical_status''<>''IN_STOCK'' OR NOT v24_count_scope(observed_book,d.scope) THEN 0 ELSE');EXECUTE def;
END $$;
