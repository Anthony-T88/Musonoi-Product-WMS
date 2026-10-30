-- Retain the immutable preparation contract link after the active reservation has been released by departure.
DO $$ DECLARE def text;cols text;BEGIN
 SELECT rtrim(trim(pg_get_viewdef('inventory_view'::regclass,true)),';') INTO def;
 SELECT string_agg('prior.'||quote_ident(attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid='inventory_view'::regclass AND attnum>0 AND NOT attisdropped AND attname<>'contract_no';
 EXECUTE 'CREATE OR REPLACE VIEW inventory_view AS SELECT '||cols||',coalesce(prior.contract_no,(SELECT k.contract_no FROM loading_items z JOIN outbound_orders d ON d.loading_id=z.loading_id JOIN reservations r ON r.id=z.reservation_id JOIN allocations a ON a.id=r.allocation_id JOIN sales_plans p ON p.id=a.plan_id LEFT JOIN customer_contracts k ON k.id=p.contract_id WHERE z.bundle_id=prior.uuid AND d.code=prior.outbound_code AND d.status=''DEPARTED'' LIMIT 1)) AS contract_no FROM ('||def||') prior';
END $$;
