'use strict';
// Presentation of existing scoped projections; no write paths or alternative ledgers.
const T=require('../dist/tonnes.js'),{kgToMt}=require('./stock-balance.cjs');
async function copper(c,req,q,data){
 const execution=req.user.permissions.includes('plan:read')?(await require('./management.cjs').report(c,req,{...q,type:'fulfilment'})).rows:null;
 return {execution,current_customers:data.customers.filter(row=>row.bundles>0).map(row=>({id:row.customer_id,name:row.customer_name,quantity:row.bundles,batches:row.batches||0,known_net_mt:row.bundles>row.unknown_weights?row.known_net_weight:null,unknown:row.unknown_weights})),states:['available','preparing','locked','assigned','loaded'].map(key=>{const m=data.metrics[key];return {key,quantity:m.bundles,batches:m.batches,known_net_mt:m.bundles>m.unknown_weights?m.known_net_weight:null,unknown:m.unknown_weights};})};
}
async function cobalt(c,req,data){
 const pendingScope=!(data.filters.customer_id||data.filters.contract_id||data.filters.contract_no||data.filters.sales_plan_id);
 const pending=pendingScope?(await c.query(`SELECT p.id preparation_id,p.bag_count bags,
  (p.bag_count-count(bw.actual_net_kg))::int unconfirmed_bags,sum(bw.actual_net_kg)::text actual_net_kg,
  CASE WHEN w.status='COMPLETED' THEN 'PENDING_COMPLETION_REVIEW' ELSE w.status END work_status,w.status
  FROM co_preparations p JOIN co_work_batches w ON w.preparation_id=p.id
  LEFT JOIN co_bags b ON b.preparation_id=p.id LEFT JOIN co_bag_work bw ON bw.bag_id=b.id
  WHERE p.intake_flow_version=2 AND p.status IN ('PREPARING','SITE_PENDING','PRODUCTION_PENDING')
    AND ($2::uuid IS NULL OR p.project_id=$2) AND ($3::uuid IS NULL OR p.warehouse_id=$3)
    AND ($4::uuid IS NULL OR p.id=$4) AND ($5::text IS NULL OR w.status=$5)
    AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id
     AND (s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id) AND s.customer_id IS NULL)
  GROUP BY p.id,w.preparation_id`,[req.user.id,data.filters.project_id||null,data.filters.warehouse_id||null,data.filters.preparation_id||null,data.filters.status||null])).rows:[];
 const inventory=data.inventory,ids=inventory.map(row=>row.preparation_id),links=ids.length?(await c.query("SELECT l.preparation_id,p.customer_id,c.name FROM co_loading_orders l JOIN co_sales_plans p ON p.id=l.sales_plan_id JOIN co_customer_profiles c ON c.id=p.customer_id WHERE l.preparation_id=ANY($1::uuid[]) AND l.status IN('WAITING','OUTBOUND')",[ids])).rows:[],byPreparation=new Map(links.map(row=>[row.preparation_id,row])),groups=new Map(),states=new Map(['preparing','review','prepared','assigned','loaded'].map(key=>[key,{quantity:0,batches:0,knownMt:0n,unknown:0}]));
 const received=new Set(ids);
 for(const row of [...inventory,...pending]){
  const quantity=Number(row.bags),unknown=Number(row.unconfirmed_bags),mt=T.scaled(kgToMt(row.actual_net_kg||'0'),9);
  if(received.has(row.preparation_id)){
   const customer=byPreparation.get(row.preparation_id),key=customer?.customer_id||'unassigned';
   if(!groups.has(key))groups.set(key,{id:customer?.customer_id||null,name:customer?.name||null,quantity:0,batches:0,knownMt:0n,unknown:0});
   const group=groups.get(key);group.quantity+=quantity;group.batches++;group.knownMt+=mt;group.unknown+=unknown;
  }
  const state=['LOADED','DEPARTED','OUTBOUND_PENDING','LOGISTICS_APPROVED','OUTBOUND_CORRECTION'].includes(row.status)?'loaded':['MATCHED','LOADING','REVIEW_PENDING'].includes(row.status)?'assigned':row.work_status==='PENDING_COMPLETION_REVIEW'?'review':row.work_status==='COMPLETED'?'prepared':'preparing';const totals=states.get(state);totals.quantity+=quantity;totals.batches++;totals.knownMt+=mt;totals.unknown+=unknown;}
 const toRow=({knownMt,...row})=>({...row,known_net_mt:row.quantity>row.unknown?T.fixed(knownMt,9):null});
 const card=(...keys)=>{const rows=keys.map(k=>states.get(k)),total=rows.reduce((a,b)=>({quantity:a.quantity+b.quantity,batches:a.batches+b.batches,knownMt:a.knownMt+b.knownMt,unknown:a.unknown+b.unknown}));return toRow(total);};
 return {execution:req.user.permissions.includes('plan:read')?data.execution:null,current_customers:[...groups.values()].map(toRow),
  states:[...states].map(([key,row])=>({key,...toRow(row)})),
  stock_cards:{preparing:card('preparing','review'),prepared:card('prepared'),loading:card('assigned'),loaded:card('loaded'),
   outbound:{batches:new Set(data.outbound.map(r=>r.preparation_id)).size,quantity:Number(data.shippingSummary.bags),known_net_mt:kgToMt(data.shippingSummary.actual_net_kg)}}};

}
module.exports={copper,cobalt};
