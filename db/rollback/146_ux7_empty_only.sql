-- Empty/new-business-safe reverse migration. Reject any new preparation/customer or edited cobalt profile.
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM co_preparations WHERE identity_mode='PREPARATION') OR EXISTS(SELECT 1 FROM customers WHERE product_code='CO_HYDROXIDE') OR EXISTS(SELECT 1 FROM co_customer_profiles p JOIN customers c ON c.id=p.id WHERE NOT p.legacy_shared OR p.updated_by IS NOT NULL OR p.version<>c.version OR (p.code,p.name,p.active,p.address,p.email,p.phone) IS DISTINCT FROM(c.code,c.name,c.active,coalesce(c.address,''),coalesce(c.email,''),coalesce(c.phone,''))) THEN RAISE EXCEPTION 'UX7_USED_DATA_ROLLBACK_REFUSED';END IF;
END$$;
ALTER TABLE co_sales_contracts DROP CONSTRAINT co_contract_customer_profile;
ALTER TABLE co_sales_plans DROP CONSTRAINT co_plan_customer_profile;
DO $$DECLARE n text;def text;r record;BEGIN
 FOREACH n IN ARRAY ARRAY['co_sales_guard','co_execution_record_guard','co_loading_arrival_valid'] LOOP SELECT pg_get_functiondef(oid) INTO def FROM pg_proc WHERE proname=n AND pronamespace='public'::regnamespace;EXECUTE replace(def,'co_customer_profiles','customers');END LOOP;
 SELECT pg_get_functiondef(oid) INTO def FROM pg_proc WHERE proname='co_loading_bag_guard' AND pronamespace='public'::regnamespace;EXECUTE replace(def,'LEFT JOIN co_production_batches pb','JOIN co_production_batches pb');
 FOR r IN SELECT t.relname FROM pg_trigger g JOIN pg_class t ON t.oid=g.tgrelid WHERE g.tgfoid='copper_customer_reference_guard()'::regprocedure LOOP EXECUTE format('DROP TRIGGER copper_customer_reference ON %I',r.relname);END LOOP;
END$$;
DROP FUNCTION copper_customer_reference_guard();
DROP TRIGGER customer_product_identity ON customers;
DROP FUNCTION customer_product_identity_guard();
DROP TABLE co_customer_profiles;
DROP FUNCTION co_customer_profile_guard();
DROP VIEW copper_customers;
ALTER TABLE customers DROP COLUMN product_code;
DROP TRIGGER co_preparation_line_mode ON co_preparation_lines;
DROP FUNCTION co_preparation_line_mode_guard();
DROP INDEX co_preparation_single_identity_line;
ALTER TABLE co_preparation_lines ALTER COLUMN production_batch_id SET NOT NULL;
ALTER TABLE co_preparations DROP COLUMN identity_mode;
DELETE FROM schema_migrations WHERE version='146_ux7_cobalt_identity_customers.sql';
