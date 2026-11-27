'use strict';
const R=require('./reports.cjs'),M=require('./management.cjs'),C=require('./control-common.cjs');
const Co=require('./cobalt-reports.cjs'),H=require('./historical-backfill.cjs'),Balance=require('./stock-balance.cjs');
const T=require('../dist/tonnes.js');
const Ship=require('./report-shipping-evidence.cjs');
const mt=v=>v==null?null:Balance.kgToMt(v);
const day=v=>!v?null:typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)?v:new Date(v).toLocaleDateString('en-CA',{timeZone:'Africa/Lubumbashi'});
const scope=a=>'EXISTS (SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id='+a+'.project_id AND (s.warehouse_id IS NULL OR s.warehouse_id='+a+'.warehouse_id) AND s.customer_id IS NULL)';
const limit=10000;
function bounded(rows){if(rows.length>limit)throw C.error(413,'报表超过10000行，请缩小筛选范围');return rows;}
function total(rows,key){if(!rows.length)return 0;if(rows.some(row=>row[key]==null))return null;
 return Number(rows.reduce((n,row)=>n+T.scaled(row[key],8),0n))/1e8;}
const isCo=req=>req.productCode==='CO_HYDROXIDE';

async function historical(c,req,q,transport=false){
 const filters=q.status==='IMPORTED_PACKING'?{...q,status:undefined}:q;
 const rows=await H.reportShipments(c,req,filters,q.from,q.to);
 const evidence=await Ship.historical(c,req.productCode,rows.map(row=>row.source_id),{transport});
 return rows.map(row=>{
  const linked=evidence.get(row.source_id);
  const details=Ship.historicalFields(row,linked);
  const values={customer:row.customer_name,contract:row.contract_no,lot:row.lot_no,gross:mt(row.gross_kg),net:row.net_weight};
  for(const [field,value] of Object.entries(values))if(value==null||value==='')details.pending_fields[field]='HISTORICAL_SOURCE_MISSING';
  return {...values,...details,date:row.date,sourceId:row.source_id,document:row.document_no,packing:row.document_no,
   confirmed:day(linked?.confirmed_at),qty:row.units,metal:row.confirmed_metal_mt,
   status:'IMPORTED_PACKING',source:'HISTORICAL',shipment_status:row.shipment_status,href:'/outbounds/historical/'+row.id,
   trip:details.vehicle?['history',row.date,details.vehicle,details.trailerOne,details.trailerTwo].map(v=>String(v||'').trim().toUpperCase()).join('|'):null};
 });
}

async function copperLoads(c,req,q){
 const x=await M.context(c,req,{...q,type:'outbound'},true);
 return M.outbound(c,x);
}

async function shipping(c,req,q){
 let live;
 if(q.source==='HISTORICAL'||q.status==='IMPORTED_PACKING'){
  live=[];
 }else if(isCo(req)){
  const result=await Co.build(c,req,{from:q.from,to:q.to,contract_no:q.contract_no},{includeHistory:false});
  const evidence=await Ship.cobalt(c,result.outbound.map(row=>row.order_id));
  live=result.outbound.map(row=>{
   const e=evidence.get(row.order_id)??{},snapshot=e.snapshot??{},plan=snapshot.plan??{},sales=snapshot.sales_plan??{};
   const order=snapshot.order?.transport_snapshot??{},departure=snapshot.departure?.transport_snapshot??{},arrival=e.transport??{};
   const details=Ship.onlineFields({
    packing:Ship.first(row.document_no,plan.packing_list_no),
    invoice:Ship.first(e.confirmed_invoice,e.source_invoice_no,plan.invoice_no,e.invoice_no),
    license:Ship.first(plan.export_license_no,e.export_license_no),
    driver:Ship.first(departure.driver_name,order.driver_name,arrival.driver_name),
    passport:Ship.first(departure.passport_no,order.passport_no,arrival.passport_no),
    vehicle:Ship.first(departure.truck_no,order.truck_no,row.truck_no,arrival.truck_no),
    trailerOne:Ship.trailer(departure.trailer_one,order.trailer_one,arrival.trailer_one),
    trailerTwo:Ship.trailer(departure.trailer_two,order.trailer_two,arrival.trailer_two),
    transporter:Ship.first(departure.transporter,order.transporter,plan.transporter,e.transporter,arrival.transporter,e.dispatch_transporter),
    destination:Ship.first(plan.destination,e.destination,e.dispatch_destination),
    plan:Ship.first(sales.code,e.plan),month:Ship.first(sales.shipment_month,e.shipment_month),
    loadDate:day(snapshot.execution?.confirmed_at||e.loaded_at||row.loaded_at)
   });
   return {...details,date:row.posted_at,document:row.outbound_code||row.order_no,customer:row.customer_name,contract:row.contract_no,
    lot:row.preparation_batch_no,qty:row.bags,gross:mt(row.actual_gross_kg),net:mt(row.actual_net_kg),metal:row.arecoms_mt,trip:row.order_id,
    status:documentStatus(row.packing_revision,e.confirmed_at||row.invoice_confirmed_at),href:'/outbounds/'+row.order_id};
  });
 }else{
  const loads=await copperLoads(c,req,q);
  const evidence=await Ship.copper(c,loads.map(row=>row.id));
  const lines=bounded((await c.query(
   'SELECT i.loading_id,a.id allocation_id,coalesce(a.lot_no,a.code) lot,p.code plan,p.preparation_month,'+
   'count(*)::int qty,CASE WHEN count(i.original_weight)=count(*) THEN sum(i.original_weight)::text END net,'+
   'CASE WHEN count(coalesce(ai.gross_weight,b.gross_weight))=count(*) THEN sum(coalesce(ai.gross_weight,b.gross_weight))::text END gross,'+
   'max(s.confirmed_at) confirmed_at,max(coalesce(s.invoice_no,s.source_invoice_no)) invoice '+
   'FROM loading_items i JOIN bundles b ON b.id=i.bundle_id LEFT JOIN reservations r ON r.id=i.reservation_id '+
   'LEFT JOIN allocations a ON a.id=r.allocation_id LEFT JOIN allocation_items ai ON ai.allocation_id=a.id AND ai.bundle_id=i.bundle_id '+
   'LEFT JOIN sales_plans p ON p.id=a.plan_id '+
   "LEFT JOIN sales_invoice_shipments s ON s.product_code='CU_CATHODE' AND s.loading_id=i.loading_id AND s.batch_id=a.id "+
   'WHERE i.loading_id=ANY($1::uuid[]) AND NOT i.plan_removed GROUP BY i.loading_id,a.id,p.id ORDER BY i.loading_id,lot LIMIT 10001',
   [loads.map(row=>row.id)])).rows);
  const byId=new Map(loads.map(row=>[row.id,row]));
  live=lines.map(line=>{
   const row=byId.get(line.loading_id);
   const e=evidence.get(line.loading_id)??{},archive=e.archived??{},transport=archive.transport??{},legacy=e.legacy??{};
   const details=Ship.onlineFields({
    packing:Ship.first(e.archived_packing_no,e.packing_list_no,legacy.packing_list_no),
    invoice:Ship.first(line.invoice,row.invoice_no,archive.loading_plan?.invoice_no,transport.invoice_no,legacy.invoice_no),
    license:Ship.first(transport.eb_license,row.export_license_no,legacy.eb_license),
    driver:Ship.first(transport.driver_name,e.driver_name,legacy.driver_name),
    passport:Ship.first(transport.passport_no,e.passport_no,legacy.passport_no),
    vehicle:Ship.first(row.corrected_vehicle_no,transport.vehicle_no,legacy.vehicle_no,row.vehicle_no),
    trailerOne:Ship.trailer(transport.trailer_one,e.trailer_one,legacy.trailer_one),
    trailerTwo:Ship.trailer(transport.trailer_two,e.trailer_two,legacy.trailer_two),
    transporter:Ship.first(transport.forwarder,row.transporter,legacy.forwarder,e.dispatch_transporter,row.carrier),
    destination:Ship.first(transport.destination,row.destination,legacy.destination,e.dispatch_destination),
    plan:Ship.first(line.plan),month:Ship.first(e.shipment_month,line.preparation_month),
    loadDate:day(row.loaded_at)
   });
   return {...details,date:row.date,document:row.code,customer:row.customer_name,contract:row.contract_no,
    lot:line.lot||row.shipment_batch_no,qty:line.qty,gross:line.gross,
    net:line.net,trip:row.id,status:documentStatus(row.packing_revision,line.confirmed_at),href:row.href};
  });
 }
 const archive=q.source==='ONLINE'?[]:await historical(c,req,q,true);
 return bounded([...live.map(row=>({...row,source:'ONLINE'})),...archive])
  .sort((a,b)=>a.date.localeCompare(b.date)||String(a.document).localeCompare(String(b.document)));
}

function documentStatus(archived,confirmed){return !archived?'DOCUMENT_MISSING':!confirmed?'INVOICE_PENDING':'DOCUMENT_COMPLETE';}

async function historyMovements(c,req,q,warehouse=null){
 const {rows}=await c.query(
  "SELECT flow.day::text date,flow.kind,CASE WHEN flow.kind='INBOUND' THEN receipt.document_no ELSE h.packing_list_no END document,"+
  "h.unit_id piece,w.name warehouse,NULL::text position,"+
  "coalesce(nullif(h.source_facts->>'batch_no',''),nullif(h.source_facts->>'lot_no','')) lot,h.customer_id,"+
  "1 qty,(h.net_kg/1000)::text net,(flow.direction*h.net_kg/1000)::text change,'HISTORICAL' source,'NO' included "+
  "FROM historical_outbound_units h JOIN warehouses w ON w.id=h.warehouse_id "+
  "JOIN historical_backfills archive ON archive.source_id=h.source_id "+
  "LEFT JOIN historical_movement_documents receipt ON receipt.id=archive.receipt_source_id AND receipt.product_code=h.product_code "+
  "AND receipt.movement_type='INBOUND' AND receipt.voided_at IS NULL AND receipt.business_date=h.original_receipt_date "+
  "CROSS JOIN LATERAL "+
  "(VALUES(h.original_receipt_date,'INBOUND',1),(h.shipping_date,'OUTBOUND',-1)) flow(day,kind,direction) "+
  "WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=h.project_id "+
  "AND(s.warehouse_id IS NULL OR s.warehouse_id=h.warehouse_id) AND(s.customer_id IS NULL OR s.customer_id=h.customer_id)) "+
  "AND h.product_code=$2 AND flow.day BETWEEN $3::date AND $4::date AND ($5::uuid IS NULL OR h.warehouse_id=$5) "+
  "ORDER BY flow.day,h.source_id,h.source_row LIMIT 10001",[req.user.id,req.productCode,q.from,q.to,warehouse]);
 return bounded(rows).map(row=>row.kind==='INBOUND'&&!row.document?
  {...row,pending_fields:{document:'HISTORICAL_NOT_LINKED'}}:row);
}

const movementKind=k=>({RECEIPT:'INBOUND',REVERSAL:'RETURN',SCOPE_TRANSFER:'TRANSFER',OPENING_BALANCE:'BASELINE'})[k]||
 (k.startsWith('ADJUST_')?'ADJUSTMENT':k);

async function movements(c,req,q,warehouse=null){
 const history=await historyMovements(c,req,q,warehouse);
 let live;
 if(isCo(req)){
  const {rows}=await c.query(
   "SELECT to_char(m.occurred_at AT TIME ZONE 'Africa/Lubumbashi','YYYY-MM-DD') date,m.kind,"+
   "CASE WHEN m.kind='OUTBOUND' THEN coalesce(nullif(btrim(packing.document_no),''),nullif(btrim(o.snapshot->'plan'->>'packing_list_no'),'')) "+
   "WHEN m.kind<>'TRANSFER' THEN p.document_no END document,p.preparation_batch_no lot,b.bag_no piece,w.name warehouse,loc.code position,"+
   "abs(m.bags_delta)::int qty,(abs(m.known_net_delta_kg)/1000)::text net,(m.known_net_delta_kg/1000)::text change,m.unknown_bags_delta "+
   "FROM co_report_movements m JOIN co_bags b ON b.id=m.bag_id JOIN co_preparations p ON p.id=b.preparation_id "+
   "JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN co_outbound_bags ob ON m.kind='OUTBOUND' AND ob.bag_id=m.bag_id "+
   "LEFT JOIN co_outbounds o ON o.id=ob.outbound_id LEFT JOIN co_packing_documents packing ON packing.outbound_id=o.id "+
   "LEFT JOIN LATERAL (SELECT e.after_data->>'location_id' location_id FROM co_location_events e "+
   "WHERE m.kind<>'OUTBOUND' AND e.preparation_id=p.id AND e.entity_type='co_positions' AND e.entity_id=m.bag_id "+
   "AND e.occurred_at<=m.occurred_at ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) position ON true "+
   "LEFT JOIN co_locations loc ON loc.id=(coalesce(ob.position_snapshot->>'location_id',position.location_id))::uuid "+
   "AND loc.project_id=m.project_id AND loc.warehouse_id=m.warehouse_id WHERE "+scope('m')+
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
 const online=live.map(row=>{
  const kind=movementKind(row.kind);
  return {...row,kind, source:'ONLINE',included:'YES',
   ...(!row.document&&['INBOUND','OUTBOUND'].includes(kind)?{pending_fields:{document:'ONLINE_SOURCE_MISSING'}}:{})};
 });
 return bounded([...online,...history])
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
  'SELECT s.* FROM sales_invoice_shipments s WHERE s.product_code=$1 AND s.plan_id=ANY($2::uuid[]) '+
  'AND (s.historical_source_id IS NULL OR EXISTS (SELECT 1 FROM historical_sales_arrivals a '+
  'JOIN historical_backfills b ON b.source_id=a.source_id JOIN user_scopes u ON u.user_id=$3 AND u.project_id=b.project_id '+
  'AND (u.warehouse_id IS NULL OR u.warehouse_id=b.warehouse_id) AND (u.customer_id IS NULL OR u.customer_id=b.customer_id) '+
  'WHERE a.source_id=s.historical_source_id AND a.plan_id=s.plan_id AND a.product_code=s.product_code)) '+
  'ORDER BY posted_at,loading_no,batch_no LIMIT 10001',
  [req.productCode,plans.map(row=>row.id),req.user.id])).rows);
 const byId=new Map(plans.map(row=>[row.id,row]));
 const asSalesRow=(row,source)=>({...byId.get(row.plan_id),lot:row.batch_no,document:row.loading_no,date:day(row.posted_at),
  outbound:row.unknown_packages?null:row.net_mt,invoice:row.invoice_no||row.source_invoice_no,
  confirmed:day(row.confirmed_at),status:row.confirmed_at?'INVOICE_CONFIRMED':'INVOICE_PENDING',source});
 const rows=shipped.filter(row=>!row.historical_source_id).map(row=>asSalesRow(row,'ONLINE'));
 const linked=new Map(shipped.filter(row=>row.historical_source_id).map(row=>[row.historical_source_id,row]));
 const archive=await historical(c,req,q);
 for(const row of archive){
  const match=linked.get(row.sourceId);
  if(match)linked.delete(row.sourceId);
  const plan=byId.get(match?.plan_id||row.planId);
  const linkedToPlan=Boolean(match||row.planId);
  const confirmed=day(match?.confirmed_at)||row.confirmed||null;
  rows.push({...row,id:plan?.id,plan:plan?.plan||row.plan,month:plan?.month||row.month,
   customer:row.customer||plan?.customer,contract:row.contract||plan?.contract,document:row.packing||row.document,
   outbound:row.net,invoice:match?.invoice_no||row.invoice||match?.source_invoice_no,confirmed,
   status:confirmed?'INVOICE_CONFIRMED':linkedToPlan?'INVOICE_PENDING':'UNLINKED_HISTORY',
   pending_fields:{...row.pending_fields,...(!confirmed?{confirmed:linkedToPlan?'INVOICE_NOT_CONFIRMED':'HISTORICAL_NOT_LINKED'}:{})}});
 }
 // The sales-plan month can precede the actual departure month.
 for(const row of linked.values())rows.push(asSalesRow(row,'HISTORICAL'));
 return {plans,rows:bounded(rows)};
}

module.exports={shipping,movements,balance,stocktake,sales,total,bounded,day};
