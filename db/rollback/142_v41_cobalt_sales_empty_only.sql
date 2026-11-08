-- TEST only, execute inside a transaction. Never erase used sales, vehicle or history data.
SELECT pg_advisory_xact_lock(21001);
SELECT pg_advisory_xact_lock(21002);
LOCK TABLE co_sales_contracts,co_sales_plans,co_dispatch_imports,co_dispatch_vehicles,co_vehicle_arrivals,co_sales_events IN ACCESS EXCLUSIVE MODE;
DO $$BEGIN
 IF (SELECT environment FROM system_info)<>'test' OR EXISTS(SELECT 1 FROM co_sales_contracts) OR EXISTS(SELECT 1 FROM co_sales_plans) OR EXISTS(SELECT 1 FROM co_dispatch_imports) OR EXISTS(SELECT 1 FROM co_dispatch_vehicles) OR EXISTS(SELECT 1 FROM co_vehicle_arrivals) OR EXISTS(SELECT 1 FROM co_sales_events) OR EXISTS(SELECT 1 FROM co_requests WHERE route LIKE '%/cobalt/sales/%') THEN RAISE EXCEPTION 'V41_USED_DATA_ROLLBACK_REFUSED';END IF;
END$$;
DROP TABLE co_sales_events,co_vehicle_arrivals,co_dispatch_vehicles,co_dispatch_imports,co_sales_plans,co_sales_contracts;
DROP SEQUENCE co_sales_plan_number;
DROP FUNCTION co_sales_audit(),co_sales_guard(),co_sales_authorized(uuid,text,uuid,uuid,uuid);
DELETE FROM schema_migrations WHERE version='142_v41_cobalt_sales_vehicles.sql';
