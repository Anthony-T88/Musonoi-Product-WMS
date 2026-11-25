-- An active historical dispatch proves arrival even when the exact arrival time is unknown.
CREATE VIEW historical_sales_arrivals AS
SELECT h.*,m.product_code,m.document_no packing_list_no,m.business_date,
 coalesce(cu.sales_plan_id,co.sales_plan_id) plan_id,
 CASE WHEN length(trim(n.invoice_no)) BETWEEN 1 AND 160
  AND upper(trim(n.invoice_no)) NOT IN ('N/A','NA','NONE','UNKNOWN','-','—')
  AND n.invoice_no !~ '[[:cntrl:]]' THEN trim(n.invoice_no) END source_invoice_no
FROM historical_sales_dispatch_links h
JOIN historical_movement_documents m ON m.id=h.source_id
LEFT JOIN sales_dispatch_vehicles v ON v.id=h.cu_dispatch_id AND v.cancelled_at IS NULL
LEFT JOIN sales_dispatch_vehicle_keys cu ON cu.vehicle_id=v.id
LEFT JOIN co_dispatch_vehicles co ON co.id=h.co_dispatch_id AND co.cancelled_at IS NULL
LEFT JOIN export_license_historical_sources l ON l.source_id=m.id
CROSS JOIN LATERAL (VALUES(coalesce(nullif(trim(m.source_facts->>'invoice_no'),''),l.invoice_no))) n(invoice_no)
WHERE m.voided_at IS NULL AND m.movement_type='OUTBOUND'
 AND ((m.product_code='CU_CATHODE' AND cu.sales_plan_id IS NOT NULL)
   OR (m.product_code='CO_HYDROXIDE' AND co.sales_plan_id IS NOT NULL))
 AND m.business_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lubumbashi')::date;

GRANT SELECT ON historical_sales_arrivals TO musonoi_app;

-- Existing manual confirmations and their original actor/time take precedence.
WITH confirmed AS (
 INSERT INTO sales_invoice_confirmations(product_code,plan_id,loading_id,batch_id,invoice_no,confirmed_by)
 SELECT h.product_code,h.plan_id,h.source_id,h.source_id,h.source_invoice_no,h.linked_by
 FROM historical_sales_arrivals h
 WHERE h.automatic AND h.source_invoice_no IS NOT NULL
  AND EXISTS(SELECT 1 FROM historical_movement_lines l WHERE l.document_id=h.source_id)
 ON CONFLICT DO NOTHING
 RETURNING *
)
INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data)
SELECT confirmed_by,'sales_historical_invoice_auto_confirmed',
 CASE WHEN product_code='CO_HYDROXIDE' THEN 'co_sales_plans' ELSE 'sales_plans' END,
 plan_id::text,to_jsonb(confirmed)||jsonb_build_object('source','EXISTING_AUTOMATIC_LINK')
FROM confirmed;
