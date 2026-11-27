'use strict';
const B=require('./business-common.cjs');
const cobalt='CO_HYDROXIDE';

const plate=value=>`historical_unit_key(regexp_replace(${value},'[[:space:]-]+','','g'))`;
const dispatchColumn=co=>co?'co_dispatch_id':'cu_dispatch_id';
const arrivalExists=(co,dispatch)=>`EXISTS(SELECT 1 FROM historical_sales_arrivals h WHERE h.${dispatchColumn(co)}=${dispatch})`;

async function assertNotArrived(c,req,id){
 const {rows:[row]}=await c.query('SELECT '+arrivalExists(req.productCode===cobalt,'$1')+' arrived',[id]);
 if(row.arrived)throw B.error(409,req.user.language_code==='en'?
  'This vehicle has already arrived according to the linked historical shipment.':
  '该车辆已依据关联历史出库单登记到场');
}

function candidateSql(co){
 const vehicles=co?`SELECT v.id,v.sales_plan_id,v.shipment_month,v.truck_no,v.trailer_no,p.code plan_no,
  p.project_id,p.warehouse_id,p.customer_id,k.contract_no
  FROM co_dispatch_vehicles v JOIN co_sales_plans p ON p.id=v.sales_plan_id
  JOIN co_sales_contracts k ON k.id=p.contract_id WHERE v.cancelled_at IS NULL`:
  `SELECT v.id,k.sales_plan_id,k.shipment_month,v.truck_no,v.trailer_no,p.code plan_no,
  p.project_id,NULL::uuid warehouse_id,p.customer_id,c.contract_no
  FROM sales_dispatch_vehicle_keys k JOIN sales_dispatch_vehicles v ON v.id=k.vehicle_id
  JOIN sales_plans p ON p.id=k.sales_plan_id JOIN customer_contracts c ON c.id=p.contract_id WHERE v.cancelled_at IS NULL`;
 const link=dispatchColumn(co);
 return `WITH vehicles AS (${vehicles}), pairs AS (
  SELECT m.id source_id,m.document_no,m.business_date::text shipping_date,m.source_facts->>'batch_no' batch_no,
   m.source_facts->>'truck' source_truck,m.source_facts->>'trailer_one' source_trailer,
   v.id dispatch_id,v.sales_plan_id,v.plan_no,v.truck_no,v.trailer_no,v.shipment_month,
   b.project_id,b.warehouse_id,v.customer_id,
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
   AND b.project_id=$4 AND m.business_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lubumbashi')::date
   AND ($5::date IS NULL OR (m.business_date>=$5 AND m.business_date<$5+interval '1 month'))
   AND nullif(btrim(m.source_facts->>'truck'),'') IS NOT NULL
   AND EXISTS (SELECT 1 FROM historical_movement_lines l WHERE l.document_id=m.id)
   AND (coalesce(${plate('v.trailer_no')},'') IN('','NA','N/A','NONE') OR
        coalesce(${plate("m.source_facts->>'trailer_one'")},'') IN('','NA','N/A','NONE') OR
        ${plate('v.trailer_no')}=${plate("m.source_facts->>'trailer_one'")})
   AND NOT EXISTS (SELECT 1 FROM historical_sales_dispatch_links h WHERE h.source_id=m.id OR h.${link}=v.id)
   AND NOT EXISTS (SELECT 1 FROM ${co?'co_loading_plans':'loading_plan_documents'} d
    JOIN ${co?'co_vehicle_arrivals':'vehicle_arrivals'} a ON a.id=d.arrival_id
    WHERE a.dispatch_vehicle_id=v.id AND ${co?"d.status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM export_license_allocations a WHERE a.co_plan_id=d.id AND a.state='RELEASED')":"d.cancelled_at IS NULL"})
 ) SELECT * FROM pairs v WHERE sales_plan_id=$3 AND EXISTS (SELECT 1 FROM user_scopes s
  WHERE s.user_id=$1 AND s.project_id=v.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=v.warehouse_id)
  AND(s.customer_id IS NULL OR s.customer_id=v.customer_id))`;
}

async function access(c,req,planId,lock=false){
 return req.productCode===cobalt?require('./cobalt-sales.cjs').access(c,req,'plan',planId,lock):
  require('./allocations.cjs').planAccess(c,req,planId);
}

async function lockDispatches(c,co,plan,ids){
 const vehicles=co?'co_dispatch_vehicles v':'sales_dispatch_vehicles v JOIN sales_dispatch_vehicle_keys k ON k.vehicle_id=v.id';
 const owner=co?'v.sales_plan_id':'k.sales_plan_id';
 await c.query(`SELECT v.id FROM ${vehicles} WHERE ${owner}=$1 AND v.cancelled_at IS NULL
  AND ($2::uuid[] IS NULL OR v.id=ANY($2)) ORDER BY v.id FOR NO KEY UPDATE OF v`,[plan,ids]);
}

async function candidates(c,req){
 const plan=await access(c,req,B.uuid(req.params.id));
 const {rows}=await c.query(candidateSql(req.productCode===cobalt)+' ORDER BY shipping_date DESC,document_no,dispatch_id LIMIT 100',
  [req.user.id,req.productCode,plan.id,plan.project_id,null]);
 return {items:rows};
}

async function link(c,req){
 const plan=await access(c,req,B.uuid(req.params.id),true),body=req.body||{};
 const source=B.uuid(body.source_id),dispatch=B.uuid(body.dispatch_id),co=req.productCode===cobalt;
 const target=dispatchColumn(co);
 await lockDispatches(c,co,plan.id,[dispatch]);
 // Serialize with import confirmation and voiding so a link never uses a voided source.
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 const {rows:[candidate]}=await c.query(candidateSql(co)+' AND source_id=$6 AND dispatch_id=$7',
  [req.user.id,req.productCode,plan.id,plan.project_id,null,source,dispatch]);
 const en=req.user.language_code==='en';
 if(!candidate)throw B.error(409,en?'This dispatch or historical document is no longer available for linking. Refresh and check again.':
  '该派车或历史单据已关联、作废或不再符合匹配条件，请刷新后核对');
 if((candidate.dispatch_matches>1||candidate.source_matches>1)&&body.verified_trip!==true)
  throw B.error(409,en?'Confirm the specific trip after checking the dispatch month, plate and source document.':'存在重复派车或装箱单，请核对派车月份、车牌和原始单据后确认具体趟次');
 const {rows:[saved]}=await c.query(`INSERT INTO historical_sales_dispatch_links(source_id,${target},linked_by)
  VALUES($1,$2,$3) RETURNING *`,[source,dispatch,req.user.id]);
 await B.audit(c,req,'historical_sales_dispatch_linked','historical_movement_documents',source,null,{...saved,sales_plan_id:plan.id});
 return saved;
}

async function confirmInvoices(c,req,plan,sourceIds){
 if(!sourceIds.length)return {invoice_confirmed:0,invoice_missing:0};
 const {rows:[counts]}=await c.query(`WITH eligible AS MATERIALIZED (
  SELECT * FROM historical_sales_arrivals WHERE product_code=$1 AND plan_id=$2 AND source_id=ANY($3::uuid[]) AND automatic
 ), confirmed AS (
  INSERT INTO sales_invoice_confirmations(product_code,plan_id,loading_id,batch_id,invoice_no,confirmed_by)
  SELECT product_code,plan_id,source_id,source_id,source_invoice_no,$4 FROM eligible WHERE source_invoice_no IS NOT NULL
  ON CONFLICT DO NOTHING RETURNING *
 ), audited AS (
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data,request_id)
  SELECT confirmed_by,'sales_historical_invoice_auto_confirmed',$5,plan_id::text,to_jsonb(confirmed),$6 FROM confirmed
 ) SELECT (SELECT count(*)::int FROM confirmed) invoice_confirmed,
  count(*) FILTER(WHERE source_invoice_no IS NULL)::int invoice_missing FROM eligible`,
  [req.productCode,plan,sourceIds,req.user.id,req.productCode===cobalt?'co_sales_plans':'sales_plans',req.id]);
 return counts;
}

async function autoLink(c,req,imported=null){
 const plan=imported?.plan||await access(c,req,B.uuid(req.params.id),true);
 const co=req.productCode===cobalt,target=dispatchColumn(co),dispatchIds=imported?.dispatchIds||null;
 // Match alongside live loading and dispatch changes, then share the import/void lock.
 if(!imported)await lockDispatches(c,co,plan.id,null);
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 const {rows:matches}=await c.query(candidateSql(co)+' AND ($6::uuid[] IS NULL OR dispatch_id=ANY($6)) ORDER BY source_id,dispatch_id',
  [req.user.id,req.productCode,plan.id,plan.project_id,imported?imported.month+'-01':null,dispatchIds]);
 const unique=matches.filter(row=>row.dispatch_matches===1&&row.source_matches===1);
 let linkedIds=[];
 if(unique.length){
  const {rows}=await c.query(`WITH linked AS (
   INSERT INTO historical_sales_dispatch_links(source_id,${target},linked_by,automatic)
   SELECT source_id,dispatch_id,$3,true FROM unnest($1::uuid[],$2::uuid[]) AS matches(source_id,dispatch_id)
   ON CONFLICT DO NOTHING RETURNING *
  ), audited AS (
   INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,after_data,request_id)
   SELECT linked_by,'historical_sales_dispatch_linked','historical_movement_documents',source_id::text,
    to_jsonb(linked)||jsonb_build_object('sales_plan_id',$4::uuid),$5 FROM linked
  ) SELECT source_id FROM linked`,
   [unique.map(row=>row.source_id),unique.map(row=>row.dispatch_id),req.user.id,plan.id,req.id]);
  linkedIds=rows.map(row=>row.source_id);
 }
 const invoices=await confirmInvoices(c,req,plan.id,linkedIds);
 return {linked:linkedIds.length,ambiguous:new Set(matches.filter(row=>row.dispatch_matches>1||row.source_matches>1).map(row=>row.source_id)).size,...invoices};
}

async function afterDispatchImport(c,req,plan,month,dispatchIds){
 if(!dispatchIds.length)return null;
 return autoLink(c,req,{plan,month,dispatchIds});
}

module.exports={candidates,link,autoLink,afterDispatchImport,arrivalExists,assertNotArrived};
