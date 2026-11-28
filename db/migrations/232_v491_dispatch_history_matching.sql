-- Keep stale links auditable, while excluding cancelled vehicles from active sales figures.
CREATE OR REPLACE VIEW sales_invoice_shipments AS
SELECT s.*,NULL::uuid historical_source_id FROM sales_invoice_live_shipments s
UNION ALL
SELECT m.product_code,h.plan_id,m.id,m.id,
 m.source_facts->>'batch_no',m.document_no,m.source_facts->>'truck',
 m.business_date::timestamp AT TIME ZONE 'Africa/Lubumbashi',
 nullif(coalesce(nullif(m.source_facts->>'invoice_no',''),ls.invoice_no),''),
 l.packages,l.net_mt,l.unknown_packages,ic.invoice_no,ic.confirmed_by,ic.confirmed_at,m.id
FROM historical_sales_arrivals h
JOIN historical_movement_documents m ON m.id=h.source_id
LEFT JOIN export_license_historical_sources ls ON ls.source_id=m.id
JOIN LATERAL (
 SELECT count(*)::int packages,sum(net_kg)/1000 net_mt,count(*) FILTER (WHERE net_kg IS NULL)::int unknown_packages
 FROM historical_movement_lines WHERE document_id=m.id
) l ON l.packages>0
LEFT JOIN sales_invoice_confirmations ic ON ic.product_code=m.product_code
 AND ic.plan_id=h.plan_id AND ic.loading_id=m.id AND ic.batch_id=m.id;

CREATE VIEW historical_dispatch_stale_auto_links AS
 SELECT h.source_id,v.id dispatch_id,p.id plan_id,p.project_id,p.customer_id,NULL::uuid warehouse_id,
  'CU_CATHODE'::text product_code,k.shipment_month,k.truck_key
 FROM historical_sales_dispatch_links h JOIN sales_dispatch_vehicles v ON v.id=h.cu_dispatch_id
 JOIN sales_dispatch_vehicle_keys k ON k.vehicle_id=v.id JOIN sales_plans p ON p.id=k.sales_plan_id
 WHERE h.automatic AND v.cancelled_at IS NOT NULL AND v.cancellation_reason='MANUAL_DELETE'
 UNION ALL
 SELECT h.source_id,v.id,p.id,p.project_id,p.customer_id,p.warehouse_id,'CO_HYDROXIDE',v.shipment_month,v.truck_key
 FROM historical_sales_dispatch_links h JOIN co_dispatch_vehicles v ON v.id=h.co_dispatch_id
 JOIN co_sales_plans p ON p.id=v.sales_plan_id
 WHERE h.automatic AND v.cancelled_at IS NOT NULL AND p.status='OPEN';
GRANT SELECT ON historical_dispatch_stale_auto_links TO musonoi_app;

-- A scoped dispatcher can reconcile an earlier automatic link after another user cancelled the vehicle.
DO $$
DECLARE definition text:=pg_get_functiondef('historical_dispatch_detach_cancelled(text,uuid,uuid,uuid,uuid,text,text)'::regprocedure);
 anchor text:='v.cancelled_at IS NOT NULL AND v.updated_by=p_actor';
BEGIN
 IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Expected cancelled cobalt dispatch guard'; END IF;
 EXECUTE replace(definition,anchor,'v.cancelled_at IS NOT NULL');
END $$;

CREATE INDEX historical_outbound_vehicle_key ON historical_movement_documents
 (product_code,historical_unit_key(regexp_replace(source_facts->>'truck','[[:space:]-]+','','g')))
 WHERE movement_type='OUTBOUND' AND voided_at IS NULL;
CREATE INDEX copper_dispatch_historical_vehicle_key ON sales_dispatch_vehicles
 (historical_unit_key(regexp_replace(truck_no,'[[:space:]-]+','','g'))) WHERE cancelled_at IS NULL;
CREATE INDEX cobalt_dispatch_historical_vehicle_key ON co_dispatch_vehicles
 (historical_unit_key(regexp_replace(truck_no,'[[:space:]-]+','','g'))) WHERE cancelled_at IS NULL;
