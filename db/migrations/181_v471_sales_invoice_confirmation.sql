-- One sales confirmation per posted vehicle and business preparation batch.
CREATE TABLE sales_invoice_confirmations (
 product_code text NOT NULL CHECK (product_code IN ('CU_CATHODE','CO_HYDROXIDE')),
 plan_id uuid NOT NULL,
 loading_id uuid NOT NULL,
 batch_id uuid NOT NULL,
 invoice_no text NOT NULL CHECK (length(trim(invoice_no)) BETWEEN 1 AND 160),
 confirmed_by uuid NOT NULL REFERENCES users(id),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (product_code,plan_id,loading_id,batch_id)
);
REVOKE ALL ON sales_invoice_confirmations FROM PUBLIC,musonoi_app;
GRANT SELECT,INSERT ON sales_invoice_confirmations TO musonoi_app;

CREATE VIEW sales_invoice_shipments AS
WITH posted AS (
 SELECT 'CU_CATHODE'::text product_code,a.plan_id,l.id loading_id,a.id batch_id,
  coalesce(a.lot_no,a.code) batch_no,l.code loading_no,l.vehicle_no truck_no,
  coalesce(l.manager_at,legacy.posted_at) posted_at,
  coalesce(nullif(d.invoice_no,''),nullif(g.invoice_no,'')) source_invoice_no,
  count(*)::int packages,sum(i.original_weight) net_mt,count(*) FILTER (WHERE i.original_weight IS NULL)::int unknown_packages
 FROM loading_items i
 JOIN loading_orders l ON l.id=i.loading_id
 JOIN reservations r ON r.id=i.reservation_id
 JOIN allocations a ON a.id=r.allocation_id
 LEFT JOIN loading_plan_matches m ON m.loading_id=l.id
 LEFT JOIN loading_plan_documents d ON d.id=m.document_id
 LEFT JOIN loading_plan_groups g ON g.id=d.group_id
 LEFT JOIN LATERAL (
  SELECT max(o.departed_at) posted_at,count(*) records FROM outbound_orders o
  WHERE o.loading_id=l.id AND o.status='DEPARTED' AND o.reversal_status<>'CONFIRMED'
 ) legacy ON l.workflow_state IS NULL
 WHERE NOT i.plan_removed AND l.status='DEPARTED'
  AND (l.workflow_state='OUTBOUND' AND l.manager_at IS NOT NULL OR l.workflow_state IS NULL AND legacy.records>0)
  AND NOT EXISTS(SELECT 1 FROM outbound_corrections c WHERE c.loading_id=l.id AND c.kind='RETURN_OUTBOUND' AND c.status='APPLIED')
 GROUP BY a.id,l.id,legacy.posted_at,d.invoice_no,g.invoice_no
 UNION ALL
 SELECT 'CO_HYDROXIDE',l.sales_plan_id,l.id,p.id,p.preparation_batch_no,l.code,
  l.transport_snapshot->>'truck_no',o.posted_at,coalesce(nullif(o.snapshot#>>'{plan,invoice_no}',''),d.invoice_no),
  l.bag_count,m.net_kg/1000,CASE WHEN m.net_kg IS NULL THEN l.bag_count ELSE 0 END
 FROM co_outbounds o JOIN co_loading_orders l ON l.id=o.order_id
 JOIN co_load_executions e ON e.order_id=l.id
 JOIN co_preparations p ON p.id=l.preparation_id
 JOIN co_loading_plans d ON d.id=l.plan_id
 JOIN co_metal_outbound m ON m.outbound_id=o.id
 WHERE l.status='OUTBOUND' AND e.state='OUTBOUND'
)
SELECT p.*,c.invoice_no,c.confirmed_by,c.confirmed_at
FROM posted p LEFT JOIN sales_invoice_confirmations c USING (product_code,plan_id,loading_id,batch_id);
GRANT SELECT ON sales_invoice_shipments TO musonoi_app;

CREATE FUNCTION sales_invoiced_totals(product text, plans uuid[])
RETURNS TABLE(plan_id uuid, net_mt numeric, unknown_packages integer)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT s.plan_id,coalesce(sum(s.net_mt),0),sum(s.unknown_packages)::int
 FROM public.sales_invoice_shipments s
 WHERE s.product_code=product AND s.plan_id=ANY(plans) AND s.confirmed_at IS NOT NULL
 GROUP BY s.plan_id
$$;
REVOKE ALL ON FUNCTION sales_invoiced_totals(text,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sales_invoiced_totals(text,uuid[]) TO musonoi_app;
