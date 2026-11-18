'use strict';
const B=require('./business-common.cjs');
const cobalt='CO_HYDROXIDE';

const plate=value=>`historical_unit_key(regexp_replace(${value},'[[:space:]-]+','','g'))`;

function candidateSql(co){
 const vehicles=co?`SELECT v.id,v.sales_plan_id,v.shipment_month,v.truck_no,v.trailer_no,p.code plan_no,
  p.project_id,p.warehouse_id,p.customer_id,k.contract_no
  FROM co_dispatch_vehicles v JOIN co_sales_plans p ON p.id=v.sales_plan_id
  JOIN co_sales_contracts k ON k.id=p.contract_id WHERE v.cancelled_at IS NULL`:
  `SELECT v.id,k.sales_plan_id,k.shipment_month,v.truck_no,v.trailer_no,p.code plan_no,
  p.project_id,NULL::uuid warehouse_id,p.customer_id,c.contract_no
  FROM sales_dispatch_vehicle_keys k JOIN sales_dispatch_vehicles v ON v.id=k.vehicle_id
  JOIN sales_plans p ON p.id=k.sales_plan_id JOIN customer_contracts c ON c.id=p.contract_id WHERE v.cancelled_at IS NULL`;
 const link=co?'co_dispatch_id':'cu_dispatch_id';
 return `WITH vehicles AS (${vehicles}), pairs AS (
  SELECT m.id source_id,m.document_no,m.business_date::text shipping_date,m.source_facts->>'batch_no' batch_no,
   m.source_facts->>'truck' source_truck,m.source_facts->>'trailer_one' source_trailer,
   v.id dispatch_id,v.sales_plan_id,v.plan_no,v.truck_no,v.trailer_no,v.shipment_month,
   count(*) OVER (PARTITION BY m.id)::int dispatch_matches,
   count(*) OVER (PARTITION BY v.id)::int source_matches
  FROM historical_movement_documents m JOIN historical_backfills b ON b.source_id=m.id
  JOIN vehicles v ON v.project_id=b.project_id AND (v.warehouse_id IS NULL OR v.warehouse_id=b.warehouse_id)
   AND v.shipment_month=to_char(m.business_date,'YYYY-MM')
   AND ${plate('v.truck_no')}=${plate("m.source_facts->>'truck'")}
   AND (b.customer_id=v.customer_id OR b.customer_id IS NULL
    AND historical_unit_key(nullif(btrim(m.source_facts->>'contract_no'),''))=historical_unit_key(v.contract_no))
   AND (nullif(btrim(m.source_facts->>'contract_no'),'') IS NULL
    OR historical_unit_key(m.source_facts->>'contract_no')=historical_unit_key(v.contract_no))
  WHERE m.product_code=$2 AND m.voided_at IS NULL AND m.movement_type='OUTBOUND'
   AND nullif(btrim(m.source_facts->>'truck'),'') IS NOT NULL
   AND EXISTS (SELECT 1 FROM historical_movement_lines l WHERE l.document_id=m.id)
   AND EXISTS (SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=b.project_id
    AND (s.warehouse_id IS NULL OR s.warehouse_id=b.warehouse_id)
    AND (s.customer_id IS NULL OR s.customer_id=v.customer_id))
   AND NOT EXISTS (SELECT 1 FROM historical_sales_dispatch_links h WHERE h.source_id=m.id OR h.${link}=v.id)
   AND NOT EXISTS (SELECT 1 FROM ${co?'co_loading_plans':'loading_plan_documents'} d
    JOIN ${co?'co_vehicle_arrivals':'vehicle_arrivals'} a ON a.id=d.arrival_id
    WHERE a.dispatch_vehicle_id=v.id AND ${co?"d.status<>'CANCELLED'":"d.cancelled_at IS NULL"})
 ) SELECT * FROM pairs WHERE sales_plan_id=$3`;
}

async function access(c,req,planId){
 return req.productCode===cobalt?require('./cobalt-sales.cjs').access(c,req,'plan',planId):
  require('./allocations.cjs').planAccess(c,req,planId);
}

async function candidates(c,req){
 const plan=B.uuid(req.params.id);
 await access(c,req,plan);
 const {rows}=await c.query(candidateSql(req.productCode===cobalt)+' ORDER BY shipping_date DESC,document_no,dispatch_id LIMIT 100',
  [req.user.id,req.productCode,plan]);
 return {items:rows};
}

async function link(c,req){
 const plan=B.uuid(req.params.id),body=req.body||{};
 const source=B.uuid(body.source_id),dispatch=B.uuid(body.dispatch_id),co=req.productCode===cobalt;
 const target=co?'co_dispatch_id':'cu_dispatch_id';
 await access(c,req,plan);
 // Serialize with import confirmation and voiding so a link never uses a voided source.
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 const {rows:[candidate]}=await c.query(candidateSql(co)+' AND source_id=$4 AND dispatch_id=$5',
  [req.user.id,req.productCode,plan,source,dispatch]);
 const en=req.user.language_code==='en';
 if(!candidate)throw B.error(409,en?'This dispatch or historical document is no longer available for linking. Refresh and check again.':
  '该派车或历史单据已关联、作废或不再符合匹配条件，请刷新后核对');
 if((candidate.dispatch_matches>1||candidate.source_matches>1)&&body.verified_trip!==true)
  throw B.error(409,en?'Confirm the specific trip after checking the dispatch month, plate and source document.':'存在重复派车或装箱单，请核对派车月份、车牌和原始单据后确认具体趟次');
 const {rows:[saved]}=await c.query(`INSERT INTO historical_sales_dispatch_links(source_id,${target},linked_by)
  VALUES($1,$2,$3) RETURNING *`,[source,dispatch,req.user.id]);
 await B.audit(c,req,'historical_sales_dispatch_linked','historical_movement_documents',source,null,{...saved,sales_plan_id:plan});
 return saved;
}

module.exports={candidates,link};
