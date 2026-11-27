-- Only an automatic confirmation with matching audit evidence can be detached.
CREATE FUNCTION historical_dispatch_has_manual_invoice(p_product text,p_plan uuid,p_source uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM sales_invoice_confirmations i
  WHERE (i.product_code,i.plan_id,i.loading_id,i.batch_id)=(p_product,p_plan,p_source,p_source)
   AND NOT EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.action='sales_historical_invoice_auto_confirmed'
     AND a.entity_type=CASE WHEN p_product='CO_HYDROXIDE' THEN 'co_sales_plans' ELSE 'sales_plans' END
     AND a.entity_id=p_plan::text AND a.actor_id=i.confirmed_by
     AND a.after_data @> (to_jsonb(i)-'confirmed_at')
     AND (a.after_data->>'confirmed_at')::timestamptz=i.confirmed_at
   )
 )
$$;
REVOKE ALL ON FUNCTION historical_dispatch_has_manual_invoice(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION historical_dispatch_has_manual_invoice(text,uuid,uuid) TO musonoi_app;

-- The app can remove only this cancelled vehicle's derived rows. Source files and manual decisions stay immutable.
CREATE FUNCTION historical_dispatch_detach_cancelled(
 p_product text,p_plan uuid,p_dispatch uuid,p_source uuid,p_actor uuid,p_reason text,p_request text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
 linked historical_sales_dispatch_links;
 invoice sales_invoice_confirmations;
 scope historical_backfills;
 plan_project uuid;
 plan_warehouse uuid;
 plan_customer uuid;
 vehicle_key text;
BEGIN
 PERFORM pg_advisory_xact_lock(477189);
 IF p_product='CU_CATHODE' THEN
  SELECT p.project_id,p.customer_id,k.truck_key INTO plan_project,plan_customer,vehicle_key
  FROM sales_dispatch_vehicle_keys k JOIN sales_dispatch_vehicles v ON v.id=k.vehicle_id
  JOIN sales_plans p ON p.id=k.sales_plan_id
  WHERE p.id=p_plan AND v.id=p_dispatch AND v.cancelled_at IS NOT NULL AND v.cancellation_reason='MANUAL_DELETE';
  IF EXISTS (SELECT 1 FROM vehicle_arrivals WHERE dispatch_vehicle_id=p_dispatch AND registration_phase<>'CLEARED')
   OR EXISTS (SELECT 1 FROM loading_plan_documents d JOIN loading_plan_groups g ON g.id=d.group_id
    WHERE g.sales_plan_id=p_plan AND upper(regexp_replace(d.vehicle_no,'[[:space:]-]','','g'))=vehicle_key)
   OR EXISTS (SELECT 1 FROM loading_orders l JOIN loading_order_lots q ON q.loading_id=l.id JOIN allocations a ON a.id=q.allocation_id
    WHERE a.plan_id=p_plan AND upper(regexp_replace(l.vehicle_no,'[[:space:]-]','','g'))=vehicle_key) THEN
   RAISE EXCEPTION 'HISTORICAL_DISPATCH_ONLINE_WORK' USING ERRCODE='23514';
  END IF;
 ELSIF p_product='CO_HYDROXIDE' THEN
  SELECT p.project_id,p.warehouse_id,p.customer_id INTO plan_project,plan_warehouse,plan_customer
  FROM co_dispatch_vehicles v JOIN co_sales_plans p ON p.id=v.sales_plan_id
  WHERE p.id=p_plan AND p.status='OPEN' AND v.id=p_dispatch AND v.cancelled_at IS NOT NULL AND v.updated_by=p_actor;
  IF EXISTS (SELECT 1 FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=p_dispatch) THEN
   RAISE EXCEPTION 'HISTORICAL_DISPATCH_ONLINE_WORK' USING ERRCODE='23514';
  END IF;
 END IF;

 SELECT h.* INTO linked
 FROM historical_sales_dispatch_links h JOIN historical_movement_documents m ON m.id=h.source_id
 WHERE h.source_id=p_source AND m.product_code=p_product AND m.voided_at IS NULL AND m.movement_type='OUTBOUND'
  AND m.business_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lubumbashi')::date
  AND ((p_product='CU_CATHODE' AND h.cu_dispatch_id=p_dispatch) OR (p_product='CO_HYDROXIDE' AND h.co_dispatch_id=p_dispatch));
 IF plan_project IS NULL OR linked.source_id IS NULL OR NOT linked.automatic THEN
  RAISE EXCEPTION 'HISTORICAL_DISPATCH_LINK_PROTECTED' USING ERRCODE='23514';
 END IF;
 SELECT * INTO STRICT scope FROM historical_backfills WHERE source_id=p_source;
 IF scope.project_id<>plan_project OR (plan_warehouse IS NOT NULL AND scope.warehouse_id<>plan_warehouse)
  OR (scope.customer_id IS NOT NULL AND scope.customer_id<>plan_customer)
  OR NOT co_sales_authorized(p_actor,'dispatch:write',scope.project_id,scope.warehouse_id,plan_customer) THEN
  RAISE EXCEPTION 'HISTORICAL_DISPATCH_SOURCE_SCOPE' USING ERRCODE='42501';
 END IF;
 IF historical_dispatch_has_manual_invoice(p_product,p_plan,p_source) THEN
  RAISE EXCEPTION 'HISTORICAL_DISPATCH_INVOICE_PROTECTED' USING ERRCODE='23514';
 END IF;

 DELETE FROM sales_invoice_confirmations i
 WHERE (i.product_code,i.plan_id,i.loading_id,i.batch_id)=(p_product,p_plan,p_source,p_source)
 RETURNING i.* INTO invoice;
 DELETE FROM historical_sales_dispatch_links WHERE source_id=p_source;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,request_id)
 VALUES (p_actor,'historical_sales_dispatch_unlinked','historical_movement_documents',p_source::text,
  jsonb_build_object('link',to_jsonb(linked),'automatic_invoice',CASE WHEN invoice.plan_id IS NOT NULL THEN to_jsonb(invoice) END),
  jsonb_build_object('product_code',p_product,'sales_plan_id',p_plan,'dispatch_id',p_dispatch,'source_id',p_source,'reason',p_reason),p_request);
END $$;
REVOKE ALL ON FUNCTION historical_dispatch_detach_cancelled(text,uuid,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION historical_dispatch_detach_cancelled(text,uuid,uuid,uuid,uuid,text,text) TO musonoi_app;
