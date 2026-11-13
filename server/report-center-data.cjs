'use strict';
const R=require('./reports.cjs'),M=require('./management.cjs'),C=require('./control-common.cjs');
const Co=require('./cobalt-reports.cjs'),H=require('./historical-backfill.cjs'),Balance=require('./stock-balance.cjs');
const T=require('../dist/tonnes.js');
const mt=v=>v==null?null:Balance.kgToMt(v);
const day=v=>!v?null:typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)?v:new Date(v).toLocaleDateString('en-CA',{timeZone:'Africa/Lubumbashi'});
const scope=a=>'EXISTS (SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id='+a+'.project_id AND (s.warehouse_id IS NULL OR s.warehouse_id='+a+'.warehouse_id) AND s.customer_id IS NULL)';
const limit=10000;
function bounded(rows){if(rows.length>limit)throw C.error(413,'报表超过10000行，请缩小筛选范围');return rows;}
function total(rows,key){if(!rows.length)return 0;if(rows.some(row=>row[key]==null))return null;
 return Number(rows.reduce((n,row)=>n+T.scaled(row[key],8),0n))/1e8;}
const isCo=req=>req.productCode==='CO_HYDROXIDE';

async function historical(c,req,q){
 return (await H.reportShipments(c,req,q,q.from,q.to)).map(row=>({
  date:row.date,document:row.document_no,customer:row.customer_name,contract:row.contract_no,vehicle:row.vehicle_no,
  lot:row.lot_no,packing:row.document_no,qty:row.units,gross:mt(row.gross_kg),net:row.net_weight,
  status:'IMPORTED_PACKING',source:'HISTORICAL',href:'/outbounds/historical/'+row.id,
  trip:row.vehicle_no?['history',row.date,row.vehicle_no,row.trailer_one,row.trailer_two].map(v=>String(v||'').trim().toUpperCase()).join('|'):null
 }));
}

async function copperLoads(c,req,q){
 const x=await M.context(c,req,{...q,type:'outbound'},true);
 return x.w.history_unavailable?[]:M.outbound(c,x);
}

async function shipping(c,req,q){
 let live;
 if(isCo(req)){
  const result=await Co.build(c,req,{from:q.from,to:q.to,contract_no:q.contract_no},{includeHistory:false});
  const invoice=(await c.query('SELECT loading_id,coalesce(invoice_no,source_invoice_no) invoice FROM sales_invoice_shipments WHERE product_code=$1 AND loading_id=ANY($2::uuid[])',
   [req.productCode,result.outbound.map(row=>row.order_id)])).rows;
  const invoices=new Map(invoice.map(row=>[row.loading_id,row.invoice]));
  live=result.outbound.map(row=>({
   date:row.posted_at,document:row.outbound_code||row.order_no,customer:row.customer_name,contract:row.contract_no,
   vehicle:row.truck_no,lot:row.preparation_batch_no,packing:row.document_no,invoice:invoices.get(row.order_id),
   qty:row.bags,gross:mt(row.actual_gross_kg),net:mt(row.actual_net_kg),metal:row.arecoms_mt,trip:row.order_id,
   status:documentStatus(row.packing_revision,row.invoice_confirmed_at),href:'/outbounds/'+row.order_id
  }));
 }else{
  const loads=await copperLoads(c,req,q);
  const lines=bounded((await c.query(
   'SELECT i.loading_id,a.id allocation_id,coalesce(a.lot_no,a.code) lot,'+
   'count(*)::int qty,CASE WHEN count(i.original_weight)=count(*) THEN sum(i.original_weight)::text END net,'+
   'CASE WHEN count(coalesce(ai.gross_weight,b.gross_weight))=count(*) THEN sum(coalesce(ai.gross_weight,b.gross_weight))::text END gross,'+
   'max(s.confirmed_at) confirmed_at,max(coalesce(s.invoice_no,s.source_invoice_no)) invoice '+
   'FROM loading_items i JOIN bundles b ON b.id=i.bundle_id LEFT JOIN reservations r ON r.id=i.reservation_id '+
   'LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN allocation_items ai ON ai.allocation_id=a.id AND ai.bundle_id=i.bundle_id '+
   "LEFT JOIN sales_invoice_shipments s ON s.product_code='CU_CATHODE' AND s.loading_id=i.loading_id AND s.batch_id=a.id "+
   'WHERE i.loading_id=ANY($1::uuid[]) AND NOT i.plan_removed GROUP BY i.loading_id,a.id ORDER BY i.loading_id,lot LIMIT 10001',
   [loads.map(row=>row.id)])).rows);
  const byId=new Map(loads.map(row=>[row.id,row]));
  live=lines.map(line=>{
   const row=byId.get(line.loading_id);
   return {date:row.date,document:row.code,customer:row.customer_name,contract:row.contract_no,vehicle:row.vehicle_no,
    lot:line.lot||row.shipment_batch_no,packing:row.document_no,invoice:line.invoice||row.invoice_no,qty:line.qty,gross:line.gross,
    net:line.net,trip:row.id,status:documentStatus(row.packing_revision,line.confirmed_at),href:row.href};
  });
 }
 return bounded([...live.map(row=>({...row,source:'ONLINE'})),...await historical(c,req,q)])
  .sort((a,b)=>a.date.localeCompare(b.date)||String(a.document).localeCompare(String(b.document)));
}

function documentStatus(archived,confirmed){return !archived?'DOCUMENT_MISSING':!confirmed?'INVOICE_PENDING':'DOCUMENT_COMPLETE';}

async function historyMovements(c,req,q,warehouse=null){
 const {rows}=await c.query(
  "SELECT flow.day::text date,flow.kind,h.packing_list_no document,h.unit_id piece,w.name warehouse,"+
  "coalesce(nullif(h.source_facts->>'batch_no',''),nullif(h.source_facts->>'lot_no','')) lot,h.customer_id,"+
  "1 qty,(h.net_kg/1000)::text net,(flow.direction*h.net_kg/1000)::text change,'HISTORICAL' source,'NO' included "+
  "FROM historical_outbound_units h JOIN warehouses w ON w.id=h.warehouse_id CROSS JOIN LATERAL "+
  "(VALUES(h.original_receipt_date,'INBOUND',1),(h.shipping_date,'OUTBOUND',-1)) flow(day,kind,direction) "+
  "WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=h.project_id "+
  "AND(s.warehouse_id IS NULL OR s.warehouse_id=h.warehouse_id) AND(s.customer_id IS NULL OR s.customer_id=h.customer_id)) "+
  "AND h.product_code=$2 AND flow.day BETWEEN $3::date AND $4::date AND ($5::uuid IS NULL OR h.warehouse_id=$5) "+
  "ORDER BY flow.day,h.source_id,h.source_row LIMIT 10001",[req.user.id,req.productCode,q.from,q.to,warehouse]);
 return bounded(rows);
}

const movementKind=k=>({RECEIPT:'INBOUND',REVERSAL:'RETURN',SCOPE_TRANSFER:'TRANSFER',OPENING_BALANCE:'BASELINE'})[k]||
 (k.startsWith('ADJUST_')?'ADJUSTMENT':k);

async function movements(c,req,q,warehouse=null){
 const history=await historyMovements(c,req,q,warehouse);
 let live;
 if(isCo(req)){
  const {rows}=await c.query(
   "SELECT to_char(m.occurred_at AT TIME ZONE 'Africa/Lubumbashi','YYYY-MM-DD') date,m.kind,"+
   "CASE WHEN m.kind='OUTBOUND' THEN o.code ELSE p.document_no END document,p.preparation_batch_no lot,b.bag_no piece,w.name warehouse,"+
   "abs(m.bags_delta)::int qty,(abs(m.known_net_delta_kg)/1000)::text net,(m.known_net_delta_kg/1000)::text change,m.unknown_bags_delta "+
   "FROM co_report_movements m JOIN co_bags b ON b.id=m.bag_id JOIN co_preparations p ON p.id=b.preparation_id "+
   "JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN co_outbounds o ON o.preparation_id=p.id WHERE "+scope('m')+
   " AND m.occurred_at>=$2::date::timestamp AT TIME ZONE 'Africa/Lubumbashi' "+
   "AND m.occurred_at<($3::date+1)::timestamp AT TIME ZONE 'Africa/Lubumbashi' AND ($4::uuid IS NULL OR m.warehouse_id=$4) "+
   "ORDER BY m.occurred_at,m.id LIMIT 10001",[req.user.id,q.from,q.to,warehouse]);
  live=rows.map(row=>({...row,change:row.unknown_bags_delta!==0&&row.kind!=='WEIGHT'?null:row.change,
   net:row.unknown_bags_delta!==0&&row.kind!=='WEIGHT'?null:row.net}));
 }else{
  const window=await R.window(c,q,true);
  live=await R.movements(c,req.user.id,warehouse?{warehouse_id:warehouse}:{},window,true);
  live=live.map(row=>({date:day(row.confirmed_at),kind:row.type,document:row.document_code,lot:row.lot_no,piece:row.bundle_no,
   warehouse:row.warehouse,position:row.location,qty:1,net:row.unknown_weight?null:Math.abs(Number(row.physical_delta)),
   change:row.unknown_weight?null:row.physical_delta}));
 }
 return bounded([...live.map(row=>({...row,kind:movementKind(row.kind),source:'ONLINE',included:'YES'})),...history])
  .sort((a,b)=>a.date.localeCompare(b.date));
}

async function balance(c,req,q){
 const archiveWarehouse=!q.warehouse_id&&(await c.query(
  "SELECT h.warehouse_id FROM historical_outbound_units h WHERE h.product_code=$2 AND h.shipping_date BETWEEN $3::date AND $4::date AND "+
  scope('h')+" GROUP BY h.warehouse_id ORDER BY count(*) DESC,h.warehouse_id LIMIT 1",[req.user.id,req.productCode,q.from,q.to])).rows[0]?.warehouse_id;
 const warehouseId=q.warehouse_id||archiveWarehouse;
 const data=await Balance.build(c,req,{period:'month',anchor:q.to,...(warehouseId?{warehouse_id:warehouseId}:{})});
 const detail=await movements(c,req,{from:data.period.from,to:data.period.effective_to},data.warehouse.id);
 return {rows:detail,warehouses:data.warehouses.map(w=>({id:w.id,label:w.name})),warehouse:data.warehouse,
  summary:{...data.summary,period:data.period.from.slice(0,7),warehouse:data.warehouse.name,
   history:total(detail.filter(row=>row.source==='HISTORICAL'&&row.kind==='OUTBOUND'),'net'),
   href:null},traceable_from:data.traceable_from,from:data.period.from,to:data.period.effective_to};
}

async function stocktake(c,req,q){
 const co=isCo(req);
 const baseline=co?'coalesce(round.cutoff_at,t.created_at)':'coalesce(t.snapshot_at,t.created_at)';
 const docs=(await c.query('SELECT t.*,w.name warehouse,'+baseline+' report_date FROM '+(co?'co_stocktakes':'stocktakes')+
  ' t JOIN warehouses w ON w.id=t.warehouse_id '+
  (co?'LEFT JOIN co_stocktake_rounds round ON round.task_id=t.id AND round.round=t.round ':'')+'WHERE '+scope('t')+' AND '+
  (co?"t.status NOT IN ('CANCELLED')":"t.phase NOT IN ('DRAFT','CANCELLED')")+
  " AND "+baseline+">=$2::date::timestamp AT TIME ZONE 'Africa/Lubumbashi' "+
  "AND "+baseline+"<($3::date+1)::timestamp AT TIME ZONE 'Africa/Lubumbashi' "+
  "AND ($4::uuid IS NULL OR t.warehouse_id=$4) ORDER BY t.created_at DESC LIMIT 10001",[req.user.id,q.from,q.to,q.warehouse_id||null])).rows;
 bounded(docs);
 const rows=[];
 for(const doc of docs){
  const report=doc.approved_report||(await c.query(co?'SELECT v451_co_count_report($1) r':'SELECT stocktake_report($2,$1) r',co?[doc.id]:[doc.id,req.user.id])).rows[0].r;
  const resolved=co?[]:(await c.query("SELECT r.bundle_no,r.finding FROM stocktake_resolutions r LEFT JOIN stock_adjustments a ON a.id=r.adjustment_id WHERE r.stocktake_id=$1 AND(r.method<>'ADJUSTMENT' OR a.status='APPLIED')",[doc.id])).rows;
  const fixed=new Set(resolved.map(row=>row.bundle_no+'|'+row.finding));
  for(const item of (co?report.items:report.rows)||[]){
   const expected=co?item.book.actual_net_kg:item.closing,observed=co?item.actual_net_kg:item.rolled_count;
   const rawFinding=co?(!item.observation_id?'UNCOUNTED':item.present===false?'LOSS':item.difference?'DIFFERENCE':'MATCH'):item.finding;
   const finding=rawFinding==='WEIGHT'?'WEIGHT_MISMATCH':rawFinding;
   const piece=co?item.book.bag_no:item.bundle_no;
   const variance=co?(expected==null||observed==null?null:Number(mt(observed))-Number(mt(expected))):item.difference;
   rows.push({id:doc.id,document:doc.code,date:day(doc.report_date),warehouse:doc.warehouse,
    position:co?item.book.location_code:item.expected_location,piece,lot:co?item.book.batch_no:null,finding,
    bookQty:finding==='GAIN'?0:1,realQty:item.present==null?null:item.present?1:0,
    bookWeight:co?mt(expected):expected,realWeight:co?mt(observed):observed,variance,
    status:finding==='MATCH'?'MATCH':fixed.has(piece+'|'+rawFinding)||doc.phase==='COMPLETED'||co&&doc.status==='APPROVED'?'RESOLVED':'OPEN',
    snapshot:co?report.baseline_digest||String(doc.round):report.snapshot_revision,href:'/stocktaking/'+doc.id});
  }
  bounded(rows);
 }
 return rows;
}

async function sales(c,req,q){
 const co=isCo(req);
 let plans;
 if(co){
  const data=await Co.build(c,req,{month:q.month,from:q.from,to:q.to,contract_no:q.contract_no});
  plans=data.execution.map(row=>({id:row.id,plan:row.code,customer:row.customer_name,contract:row.contract_no,month:row.shipment_month,
   target:row.planned_physical_mt,prepared:null,loaded:null,outbound:mt(row.actual_net_kg),invoiced:mt(row.invoiced_net_kg)}));
  const stage=(await c.query(
   "WITH assigned AS (SELECT co_sales_plan_id sales_plan_id,co_preparation_id preparation_id FROM preparation_plans "+
   "WHERE co_sales_plan_id=ANY($1::uuid[]) AND state='APPROVED' AND co_preparation_id IS NOT NULL "+
   "UNION SELECT sales_plan_id,preparation_id FROM co_loading_orders WHERE sales_plan_id=ANY($1::uuid[]) AND status IN ('WAITING','OUTBOUND')), "+
   "prepared AS (SELECT a.sales_plan_id,CASE WHEN count(*)=count(bw.actual_net_kg) THEN sum(bw.actual_net_kg) END::text net "+
   "FROM assigned a JOIN co_work_batches w ON w.preparation_id=a.preparation_id AND w.status='COMPLETED' "+
   "JOIN co_bags b ON b.preparation_id=a.preparation_id LEFT JOIN co_bag_work bw ON bw.bag_id=b.id GROUP BY a.sales_plan_id), "+
   "loaded AS (SELECT l.sales_plan_id,sum(l.actual_net_kg)::text net FROM co_loading_orders l JOIN co_load_executions e ON e.order_id=l.id "+
   "WHERE l.sales_plan_id=ANY($1::uuid[]) AND l.status IN ('WAITING','OUTBOUND') AND e.load_reviewed_at IS NOT NULL GROUP BY l.sales_plan_id) "+
   "SELECT sales_plan_id,prepared.net prepared,loaded.net loaded FROM prepared FULL JOIN loaded USING(sales_plan_id)",[plans.map(row=>row.id)])).rows;
  const byId=new Map(stage.map(row=>[row.sales_plan_id,row]));
  for(const row of plans){
   row.prepared=mt(byId.get(row.id)?.prepared);
   row.loaded=mt(byId.get(row.id)?.loaded);
  }
 }else{
  const data=await M.report(c,req,{from:q.from,to:q.to,type:'fulfilment',contract_no:q.contract_no});
  plans=data.rows.map(row=>({id:row.id,plan:row.document_no,customer:row.customer_name,contract:row.contract_no,month:row.shipment_month,
   target:row.planned_net_weight,prepared:row.prepared_net_weight,loaded:null,outbound:row.outbound_net_weight,invoiced:row.invoiced_net_weight}));
  const stage=(await c.query(
   "SELECT a.plan_id,sum(i.original_weight)::text loaded FROM loading_items i JOIN loading_orders l ON l.id=i.loading_id "+
   "JOIN reservations r ON r.id=i.reservation_id JOIN allocations a ON a.id=r.allocation_id "+
   "WHERE a.plan_id=ANY($1::uuid[]) AND NOT i.plan_removed AND (l.logistics_review_at IS NOT NULL OR l.status='DEPARTED') "+
   "AND NOT EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=l.id AND cr.kind='RETURN_OUTBOUND' AND cr.status='APPLIED') "+
   "GROUP BY a.plan_id",[plans.map(row=>row.id)])).rows;
  const byId=new Map(stage.map(row=>[row.plan_id,row]));
  for(const row of plans)row.loaded=byId.get(row.id)?.loaded??null;
 }
 const shipped=bounded((await c.query(
  'SELECT * FROM sales_invoice_shipments WHERE product_code=$1 AND plan_id=ANY($2::uuid[]) ORDER BY posted_at,loading_no,batch_no LIMIT 10001',
  [req.productCode,plans.map(row=>row.id)])).rows);
 const byId=new Map(plans.map(row=>[row.id,row]));
 const rows=shipped.map(row=>({...byId.get(row.plan_id),lot:row.batch_no,document:row.loading_no,date:day(row.posted_at),
  outbound:row.unknown_packages?null:row.net_mt,invoice:row.invoice_no||row.source_invoice_no,
  confirmed:day(row.confirmed_at),status:row.confirmed_at?'INVOICE_CONFIRMED':'INVOICE_PENDING',source:'ONLINE'}));
 const archive=await historical(c,req,q);
 rows.push(...archive.map(row=>({...row,outbound:row.net,status:'UNLINKED_HISTORY'})));
 return {plans,rows:bounded(rows)};
}

module.exports={shipping,movements,balance,stocktake,sales,total,bounded,day};
