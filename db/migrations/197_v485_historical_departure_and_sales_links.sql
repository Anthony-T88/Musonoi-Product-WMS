CREATE TABLE historical_gate_exits (
 source_id uuid PRIMARY KEY REFERENCES historical_backfills(source_id),
 confirmed_by uuid NOT NULL REFERENCES users(id),
 confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 evidence text NOT NULL CHECK (length(trim(evidence)) BETWEEN 5 AND 500)
);
GRANT SELECT,INSERT ON historical_gate_exits TO musonoi_app;

CREATE TABLE historical_sales_dispatch_links (
 source_id uuid PRIMARY KEY REFERENCES historical_backfills(source_id),
 cu_dispatch_id uuid UNIQUE REFERENCES sales_dispatch_vehicles(id),
 co_dispatch_id uuid UNIQUE REFERENCES co_dispatch_vehicles(id),
 linked_by uuid NOT NULL REFERENCES users(id),
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (num_nonnulls(cu_dispatch_id,co_dispatch_id)=1)
);
GRANT SELECT,INSERT ON historical_sales_dispatch_links TO musonoi_app;

ALTER VIEW sales_invoice_shipments RENAME TO sales_invoice_live_shipments;
CREATE VIEW sales_invoice_shipments AS
SELECT s.*,NULL::uuid historical_source_id FROM sales_invoice_live_shipments s
UNION ALL
SELECT m.product_code, coalesce(v.sales_plan_id,cv.sales_plan_id),m.id,m.id,
 m.source_facts->>'batch_no',m.document_no,m.source_facts->>'truck',
 m.business_date::timestamp AT TIME ZONE 'Africa/Lubumbashi',
 nullif(coalesce(nullif(m.source_facts->>'invoice_no',''),ls.invoice_no),''),
 l.packages,l.net_mt,l.unknown_packages,ic.invoice_no,ic.confirmed_by,ic.confirmed_at,m.id
FROM historical_sales_dispatch_links h
JOIN historical_movement_documents m ON m.id=h.source_id AND m.voided_at IS NULL
LEFT JOIN sales_dispatch_vehicle_keys v ON v.vehicle_id=h.cu_dispatch_id
LEFT JOIN co_dispatch_vehicles cv ON cv.id=h.co_dispatch_id
LEFT JOIN export_license_historical_sources ls ON ls.source_id=m.id
JOIN LATERAL (
 SELECT count(*)::int packages,sum(net_kg)/1000 net_mt,count(*) FILTER (WHERE net_kg IS NULL)::int unknown_packages
 FROM historical_movement_lines WHERE document_id=m.id
) l ON l.packages>0
LEFT JOIN sales_invoice_confirmations ic ON ic.product_code=m.product_code
 AND ic.plan_id=coalesce(v.sales_plan_id,cv.sales_plan_id) AND ic.loading_id=m.id AND ic.batch_id=m.id;
GRANT SELECT ON sales_invoice_shipments TO musonoi_app;

CREATE OR REPLACE FUNCTION sales_invoiced_totals(product text, plans uuid[])
RETURNS TABLE(plan_id uuid, net_mt numeric, unknown_packages integer)
LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
 SELECT s.plan_id,coalesce(sum(s.net_mt),0),sum(s.unknown_packages)::int
 FROM public.sales_invoice_shipments s
 WHERE s.product_code=product AND s.plan_id=ANY(plans) AND s.confirmed_at IS NOT NULL
 GROUP BY s.plan_id
$$;
