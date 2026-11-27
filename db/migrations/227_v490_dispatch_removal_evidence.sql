-- Protect actual dispatch references. Plate-only legacy rows remain blockers
-- unless another dispatch in the plan accounts for the document's month.
CREATE FUNCTION copper_dispatch_online_blocker(p_dispatch uuid,p_plan uuid,p_month text,p_plate text)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
 WITH own_arrival AS (
  SELECT id,registration_phase FROM vehicle_arrivals WHERE dispatch_vehicle_id=p_dispatch
 ), other_months AS (
  SELECT k.shipment_month FROM sales_dispatch_vehicle_keys k JOIN sales_dispatch_vehicles v ON v.id=k.vehicle_id
  WHERE k.sales_plan_id=p_plan AND k.truck_key=p_plate AND k.vehicle_id<>p_dispatch AND v.cancelled_at IS NULL
 )
 SELECT CASE
  WHEN EXISTS(SELECT 1 FROM own_arrival WHERE registration_phase<>'CLEARED') THEN 'ONLINE_ARRIVAL'
  WHEN EXISTS (
   SELECT 1 FROM loading_plan_documents d JOIN loading_plan_groups g ON g.id=d.group_id
   WHERE d.cancelled_at IS NULL AND g.cancelled_at IS NULL
    AND (d.arrival_id IN (SELECT id FROM own_arrival)
     OR (d.arrival_id IS NULL AND g.sales_plan_id=p_plan
      AND upper(regexp_replace(d.vehicle_no,'[[:space:]-]+','','g'))=p_plate
      AND (to_char(d.planned_load_date,'YYYY-MM')=p_month OR NOT EXISTS (
       SELECT 1 FROM other_months m WHERE m.shipment_month=to_char(d.planned_load_date,'YYYY-MM')
      ))))
  ) OR EXISTS (
   SELECT 1 FROM loading_orders l
   LEFT JOIN loading_plan_matches m ON m.loading_id=l.id
   LEFT JOIN loading_plan_documents d ON d.id=m.document_id
   CROSS JOIN LATERAL (SELECT to_char(coalesce(d.planned_load_date,(l.loaded_at AT TIME ZONE 'Africa/Lubumbashi')::date),'YYYY-MM') AS month) evidence
   WHERE (l.status<>'CANCELLED' OR v31_load_posted(l.id))
    AND (d.arrival_id IN (SELECT id FROM own_arrival)
     OR (d.arrival_id IS NULL AND upper(regexp_replace(l.vehicle_no,'[[:space:]-]+','','g'))=p_plate
      AND (EXISTS(SELECT 1 FROM loading_order_lots q JOIN allocations a ON a.id=q.allocation_id
        WHERE q.loading_id=l.id AND a.plan_id=p_plan)
       OR EXISTS(SELECT 1 FROM allocations a WHERE a.id=l.allocation_id AND a.plan_id=p_plan))
      AND (evidence.month=p_month OR NOT EXISTS(SELECT 1 FROM other_months x WHERE x.shipment_month=evidence.month))))
  ) THEN 'ONLINE_LOADING'
 END
$$;

CREATE FUNCTION cobalt_dispatch_online_blocker(p_dispatch uuid)
RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
 SELECT CASE
  WHEN EXISTS(SELECT 1 FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=p_dispatch AND registration_phase<>'CLEARED')
   THEN 'ONLINE_ARRIVAL'
  WHEN EXISTS (
   SELECT 1 FROM co_loading_plans d JOIN co_vehicle_arrivals a ON a.id=d.arrival_id
   WHERE a.dispatch_vehicle_id=p_dispatch AND d.status<>'CANCELLED'
    AND NOT EXISTS(SELECT 1 FROM export_license_allocations x WHERE x.co_plan_id=d.id AND x.state='RELEASED')
  ) OR EXISTS(SELECT 1 FROM co_loading_orders WHERE vehicle_id=p_dispatch AND status<>'CANCELLED')
   THEN 'ONLINE_LOADING'
 END
$$;

REVOKE ALL ON FUNCTION copper_dispatch_online_blocker(uuid,uuid,text,text),cobalt_dispatch_online_blocker(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION copper_dispatch_online_blocker(uuid,uuid,text,text),cobalt_dispatch_online_blocker(uuid) TO musonoi_app;

DO $$
DECLARE
 definition text:=pg_get_functiondef('historical_dispatch_detach_cancelled(text,uuid,uuid,uuid,uuid,text,text)'::regprocedure);
 old_copper text:=$copper$IF EXISTS (SELECT 1 FROM vehicle_arrivals WHERE dispatch_vehicle_id=p_dispatch AND registration_phase<>'CLEARED')
   OR EXISTS (SELECT 1 FROM loading_plan_documents d JOIN loading_plan_groups g ON g.id=d.group_id
    WHERE g.sales_plan_id=p_plan AND upper(regexp_replace(d.vehicle_no,'[[:space:]-]','','g'))=vehicle_key)
   OR EXISTS (SELECT 1 FROM loading_orders l JOIN loading_order_lots q ON q.loading_id=l.id JOIN allocations a ON a.id=q.allocation_id
    WHERE a.plan_id=p_plan AND upper(regexp_replace(l.vehicle_no,'[[:space:]-]','','g'))=vehicle_key) THEN$copper$;
 old_cobalt text:='IF EXISTS (SELECT 1 FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=p_dispatch) THEN';
BEGIN
 IF strpos(definition,old_copper)=0 OR strpos(definition,old_cobalt)=0 THEN
  RAISE EXCEPTION 'Unexpected historical dispatch removal guard';
 END IF;
 definition:=replace(definition,' vehicle_key text;',' vehicle_key text;'||chr(10)||' vehicle_month text;');
 definition:=replace(definition,'k.truck_key INTO plan_project,plan_customer,vehicle_key',
  'k.truck_key,k.shipment_month INTO plan_project,plan_customer,vehicle_key,vehicle_month');
 definition:=replace(definition,old_copper,
  'IF copper_dispatch_online_blocker(p_dispatch,p_plan,vehicle_month,vehicle_key) IS NOT NULL THEN');
 definition:=replace(definition,old_cobalt,'IF cobalt_dispatch_online_blocker(p_dispatch) IS NOT NULL THEN');
 EXECUTE definition;
END $$;
