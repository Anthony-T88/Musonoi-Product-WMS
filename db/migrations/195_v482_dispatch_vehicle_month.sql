-- The import retains the source month. The effective month belongs to the vehicle.
GRANT UPDATE(shipment_month) ON sales_dispatch_vehicle_keys TO musonoi_app;

ALTER TABLE co_dispatch_imports ADD CONSTRAINT co_dispatch_import_plan_unique UNIQUE(id,sales_plan_id);
ALTER TABLE co_dispatch_vehicles ADD CONSTRAINT co_dispatch_vehicle_import_plan_fk
 FOREIGN KEY(import_id,sales_plan_id) REFERENCES co_dispatch_imports(id,sales_plan_id);
DO $$
DECLARE old_name text;
BEGIN
 SELECT conname INTO STRICT old_name FROM pg_constraint
 WHERE conrelid='co_dispatch_vehicles'::regclass AND confrelid='co_dispatch_imports'::regclass
 AND contype='f' AND cardinality(conkey)=3;
 EXECUTE format('ALTER TABLE co_dispatch_vehicles DROP CONSTRAINT %I',old_name);
END $$;

DO $$
DECLARE definition text; anchor text := 'IF TG_OP=''INSERT'' THEN IF NEW.cancelled_at IS NOT NULL';
BEGIN
 SELECT pg_get_functiondef('co_sales_guard()'::regprocedure) INTO definition;
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Cobalt dispatch guard changed'; END IF;
 EXECUTE replace(definition,anchor,
  'IF TG_OP=''UPDATE'' AND NEW.shipment_month IS DISTINCT FROM OLD.shipment_month THEN
    permission:=''dispatch:month'';allowed:=ARRAY[''shipment_month'',''truck_key''];
   END IF;
   '||anchor);
END $$;
