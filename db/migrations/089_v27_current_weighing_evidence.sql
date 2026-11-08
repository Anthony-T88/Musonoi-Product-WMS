-- Preserve original_net_weight as historical evidence; constrain the current measured pair.
DO $$ DECLARE c record;d text;n integer;BEGIN
 SELECT count(*) INTO n FROM bundles WHERE gross_weight IS NOT NULL AND net_weight IS DISTINCT FROM gross_weight-0.0025;
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='bundles'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%original_net_weight%' LOOP EXECUTE format('ALTER TABLE bundles DROP CONSTRAINT %I',c.conname);END LOOP;
 ALTER TABLE bundles ADD CONSTRAINT v27_current_net_mass CHECK((gross_weight IS NULL AND packaging_weight IS NULL AND weight_rule_version IS NULL) OR(gross_weight IS NOT NULL AND packaging_weight=0.0025 AND weight_rule_version='PACK_2_5KG_V1' AND gross_weight>packaging_weight AND net_weight=gross_weight-packaging_weight)) NOT VALID;
 IF n=0 THEN ALTER TABLE bundles VALIDATE CONSTRAINT v27_current_net_mass;ELSE RAISE NOTICE 'Historical current-weight mismatches retained: %; inspect consistency report',n;END IF;
 SELECT pg_get_functiondef('adjustment_action(uuid,uuid,int,text,text)'::regprocedure) INTO d;
 d:=replace(d,'''GROSS_MINUS_PACKAGING''','''PACK_2_5KG_V1''');
 d:=replace(d,'UPDATE bundles SET gross_weight=', 'UPDATE bundles SET weight_rule_version=CASE WHEN l.kind=''WEIGHT'' THEN ''PACK_2_5KG_V1'' ELSE weight_rule_version END,gross_weight=');
 d:=replace(d,'WHEN ''WEIGHT'' THEN qty-b.net_weight','WHEN ''WEIGHT'' THEN coalesce(qty-b.net_weight,0)');
 d:=replace(d,'delta,(l.after_data->>''net_weight'') IS NOT NULL,actor','delta,CASE WHEN l.kind=''WEIGHT'' THEN(l.before_data->>''net_weight'') IS NOT NULL ELSE(l.after_data->>''net_weight'') IS NOT NULL END,actor');EXECUTE d;
 SELECT pg_get_functiondef('confirmed_bundle_guard()'::regprocedure) INTO d;
 d:=replace(d,'ARRAY[''version'',''net_weight'',''gross_weight'',''packaging_weight'']','ARRAY[''version'',''net_weight'',''gross_weight'',''packaging_weight'',''weight_rule_version'']');EXECUTE d;
 FOR c IN SELECT conname,pg_get_expr(conbin,conrelid) expression FROM pg_constraint WHERE conrelid='inventory_events'::regclass AND contype='c' AND pg_get_expr(conbin,conrelid) LIKE '%physical_delta%' LOOP
 EXECUTE format('ALTER TABLE inventory_events DROP CONSTRAINT %I',c.conname);
 EXECUTE format('ALTER TABLE inventory_events ADD CONSTRAINT %I CHECK((NOT weight_known AND event_type=''ADJUST_WEIGHT'' AND physical_delta=0) OR(%s))',c.conname,c.expression);
 END LOOP;
END $$;
