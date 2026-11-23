-- Current plan ownership is independent of Excel import provenance.
GRANT UPDATE(sales_plan_id) ON sales_dispatch_vehicle_keys TO musonoi_app;
ALTER TABLE co_dispatch_vehicles DROP CONSTRAINT co_dispatch_vehicle_import_plan_fk;

DO $$
DECLARE
 definition text:=pg_get_functiondef('co_sales_guard()'::regprocedure);
 original text:=$guard$IF TG_OP='UPDATE' AND NEW.shipment_month IS DISTINCT FROM OLD.shipment_month THEN
    permission:='dispatch:month';allowed:=ARRAY['shipment_month','truck_key'];
   END IF;$guard$;
 replacement text:=$guard$IF TG_OP='INSERT' AND NEW.import_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM co_dispatch_imports i WHERE i.id=NEW.import_id AND i.sales_plan_id=NEW.sales_plan_id
   ) THEN RAISE EXCEPTION 'CO_DISPATCH_IMPORT_PLAN' USING ERRCODE='23514'; END IF;
   IF TG_OP='UPDATE' AND NEW.sales_plan_id IS DISTINCT FROM OLD.sales_plan_id THEN
    permission:='dispatch:month';allowed:=ARRAY['sales_plan_id','shipment_month','truck_key'];
    IF NEW.shipment_month IS DISTINCT FROM p.shipment_month OR NOT EXISTS (
     SELECT 1 FROM co_sales_plans source
     WHERE source.id=OLD.sales_plan_id AND source.status='OPEN' AND source.project_id=p.project_id
      AND source.customer_id=p.customer_id AND source.shipment_month<>p.shipment_month
      AND co_sales_authorized(NEW.updated_by,permission,source.project_id,source.warehouse_id,source.customer_id)
    ) OR EXISTS(SELECT 1 FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=OLD.id)
    OR EXISTS(SELECT 1 FROM historical_sales_dispatch_links WHERE co_dispatch_id=OLD.id)
    THEN RAISE EXCEPTION 'CO_DISPATCH_TRANSFER_NOT_ALLOWED' USING ERRCODE='23514'; END IF;
   ELSIF TG_OP='UPDATE' AND NEW.shipment_month IS DISTINCT FROM OLD.shipment_month THEN
    RAISE EXCEPTION 'CO_DISPATCH_TARGET_PLAN_REQUIRED' USING ERRCODE='23514';
   END IF;$guard$;
BEGIN
 IF strpos(definition,original)=0 THEN RAISE EXCEPTION 'Expected cobalt dispatch month guard'; END IF;
 EXECUTE replace(definition,original,replacement);
END $$;
