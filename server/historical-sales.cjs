'use strict';
const B=require('./business-common.cjs');
const cobalt='CO_HYDROXIDE';

const plate=value=>`historical_unit_key(regexp_replace(${value},'[[:space:]-]+','','g'))`;
const trailer=value=>`CASE WHEN ${plate(value)} NOT IN('','NA','N/A','NONE','UNKNOWN','—') THEN ${plate(value)} END`;
const dispatchColumn=co=>co?'co_dispatch_id':'cu_dispatch_id';
const arrivalExists=(co,dispatch)=>`EXISTS(SELECT 1 FROM historical_sales_arrivals h WHERE h.${dispatchColumn(co)}=${dispatch})`;

async function assertNotArrived(c,req,id){
 const {rows:[row]}=await c.query('SELECT '+arrivalExists(req.productCode===cobalt,'$1')+' arrived',[id]);
 if(row.arrived)throw B.error(409,req.user.language_code==='en'?
  'The linked historical stock issue already records this vehicle’s arrival.':
  '该车辆已依据关联历史出库单登记到场');
}

const sourceInScope=(h,actor,project,customer,warehouse)=>`EXISTS(
 SELECT 1 FROM historical_backfills b JOIN user_scopes s ON s.user_id=${actor} AND s.project_id=b.project_id
 WHERE b.source_id=${h}.source_id AND b.project_id=${project}
  AND (${warehouse} IS NULL OR b.warehouse_id=${warehouse})
  AND (b.customer_id IS NULL OR b.customer_id=${customer})
  AND (s.warehouse_id IS NULL OR s.warehouse_id=b.warehouse_id)
  AND (s.customer_id IS NULL OR s.customer_id=${customer})
)`;
const removalBlocker=(h,actor,project,customer,warehouse='NULL::uuid')=>`CASE
 WHEN ${h}.source_id IS NULL THEN NULL
 WHEN NOT ${sourceInScope(h,actor,project,customer,warehouse)} THEN 'HISTORICAL_SCOPE'
 WHEN NOT ${h}.automatic THEN 'MANUAL_HISTORY_LINK'
 WHEN historical_dispatch_has_manual_invoice(${h}.product_code,${h}.plan_id,${h}.source_id) THEN 'CONFIRMED_HISTORY_INVOICE'
 END`;

function cancellationError(req,code){
 const messages={
  MANUAL_HISTORY_LINK:['该车辆关联了人工确认的历史单据，不能撤销派车','This dispatch cannot be cancelled because its historical document was linked manually.','Cette affectation est liée manuellement à un document historique et ne peut pas être annulée.'],
  CONFIRMED_HISTORY_INVOICE:['该车辆的历史发票已经人工确认，不能撤销派车','This dispatch cannot be cancelled because its historical invoice was confirmed manually.','La facture historique a été confirmée manuellement. Cette affectation ne peut pas être annulée.'],
  HISTORICAL_SCOPE:['无权解除该历史单据的派车关联','You do not have permission to unlink this historical document.','Vous n’avez pas l’autorisation de dissocier ce document historique.'],
  ONLINE_ARRIVAL:['该车辆已有在线到厂登记，不能删除派车记录','This dispatch cannot be removed because a vehicle arrival was registered.','Une arrivée a été enregistrée pour ce véhicule. Cette affectation ne peut pas être supprimée.'],
  ONLINE_LOADING:['该车辆已关联装车计划或装车单，不能删除派车记录','This dispatch cannot be removed because it is linked to a loading plan or order.','Cette affectation est liée à un plan ou ordre de chargement et ne peut pas être supprimée.'],
  HISTORICAL_DISPATCH_ONLINE_WORK:['该车辆已有在线到厂或装车记录，不能撤销派车','This dispatch cannot be cancelled because it has a vehicle arrival or loading record.','Cette affectation ne peut pas être annulée car une arrivée ou un chargement a été enregistré.']
 };
 const message=messages[code];
 if(!message)return null;
 const language=req.user.language_code;
 return B.error(code==='HISTORICAL_SCOPE'?403:409,message[language==='en'?1:language==='fr'?2:0]);
}

async function prepareDispatchCancellation(c,req,plan,dispatchId){
 const co=req.productCode===cobalt;
 // The caller already locked the dispatch. Recheck against concurrent historical imports, voids and invoice confirmations.
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 const {rows:[linked]}=await c.query(`SELECT h.source_id,${removalBlocker('h','$3','$4','$5','$6::uuid')} removal_blocker
  FROM historical_sales_arrivals h WHERE h.${dispatchColumn(co)}=$1 AND h.plan_id=$2`,
  [dispatchId,plan.id,req.user.id,plan.project_id,plan.customer_id,co?plan.warehouse_id:null]);
 if(linked?.removal_blocker)throw cancellationError(req,linked.removal_blocker);
 return linked?.source_id||null;
}

async function finishDispatchCancellation(c,req,plan,dispatchId,sourceId,reason){
 if(!sourceId)return;
 try{
  await c.query('SELECT historical_dispatch_detach_cancelled($1,$2,$3,$4,$5,$6,$7)',
   [req.productCode,plan.id,dispatchId,sourceId,req.user.id,reason,req.id]);
 }catch(error){
  const codes={
   HISTORICAL_DISPATCH_LINK_PROTECTED:'MANUAL_HISTORY_LINK',
   HISTORICAL_DISPATCH_INVOICE_PROTECTED:'CONFIRMED_HISTORY_INVOICE',
   HISTORICAL_DISPATCH_SOURCE_SCOPE:'HISTORICAL_SCOPE'
  };
  throw cancellationError(req,codes[error.message]||error.message)||error;
 }
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
 return `WITH vehicles AS NOT MATERIALIZED (${vehicles}), target_trucks AS (
  SELECT DISTINCT ${plate('t.truck_no')} truck FROM vehicles t
  WHERE t.sales_plan_id=$3 AND ($5::uuid[] IS NULL OR t.id=ANY($5))
 ), pairs AS (
  SELECT m.id source_id,m.document_no,m.business_date::text shipping_date,m.source_facts->>'batch_no' batch_no,
   m.source_facts->>'truck' source_truck,m.source_facts->>'trailer_one' source_trailer,
   m.source_facts->>'trailer_two' source_trailer_two,
   v.id dispatch_id,v.sales_plan_id,v.plan_no,v.truck_no,v.trailer_no,v.shipment_month,
   b.project_id,b.warehouse_id,v.customer_id,stale.plan_id stale_plan_id,stale.dispatch_id stale_dispatch_id,
   count(*) OVER (PARTITION BY m.id)::int dispatch_matches,
   count(*) OVER (PARTITION BY v.id)::int source_matches
  FROM target_trucks t JOIN historical_movement_documents m ON ${plate("m.source_facts->>'truck'")}=t.truck
  JOIN historical_backfills b ON b.source_id=m.id
  JOIN vehicles v ON v.project_id=b.project_id AND (v.warehouse_id IS NULL OR v.warehouse_id=b.warehouse_id)
   AND ${plate('v.truck_no')}=t.truck
   AND (b.customer_id=v.customer_id OR b.customer_id IS NULL
    AND historical_unit_key(nullif(btrim(m.source_facts->>'contract_no'),''))=historical_unit_key(v.contract_no))
   AND (nullif(btrim(m.source_facts->>'contract_no'),'') IS NULL
    OR historical_unit_key(m.source_facts->>'contract_no')=historical_unit_key(v.contract_no))
  LEFT JOIN historical_sales_dispatch_links existing ON existing.source_id=m.id
  LEFT JOIN historical_dispatch_stale_auto_links stale ON stale.source_id=existing.source_id AND stale.product_code=$2
   AND stale.project_id=v.project_id AND stale.customer_id=v.customer_id
   AND (stale.warehouse_id IS NULL OR stale.warehouse_id=b.warehouse_id)
  WHERE m.product_code=$2 AND m.voided_at IS NULL AND m.movement_type='OUTBOUND'
   AND b.project_id=$4 AND m.business_date<=(CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lubumbashi')::date
   AND nullif(btrim(m.source_facts->>'truck'),'') IS NOT NULL
   AND EXISTS (SELECT 1 FROM historical_movement_lines l WHERE l.document_id=m.id)
   AND (${trailer('v.trailer_no')} IS NULL OR
        (${trailer("m.source_facts->>'trailer_one'")} IS NULL AND ${trailer("m.source_facts->>'trailer_two'")} IS NULL)
        OR ${trailer('v.trailer_no')} IN(${trailer("m.source_facts->>'trailer_one'")},${trailer("m.source_facts->>'trailer_two'")}))
   AND NOT EXISTS (SELECT 1 FROM historical_sales_dispatch_links h WHERE h.${link}=v.id)
   AND (existing.source_id IS NULL OR (stale.source_id IS NOT NULL
    AND EXISTS(SELECT 1 FROM users u JOIN role_permissions p ON p.role_code=u.role_code
     WHERE u.id=$1 AND u.active AND p.permission_code='dispatch:write')
    AND NOT historical_dispatch_has_manual_invoice($2,stale.plan_id,m.id)
    AND ${co?'cobalt_dispatch_online_blocker(stale.dispatch_id)':
     'copper_dispatch_online_blocker(stale.dispatch_id,stale.plan_id,stale.shipment_month,stale.truck_key)'} IS NULL))
   AND NOT EXISTS (SELECT 1 FROM ${co?'co_loading_plans':'loading_plan_documents'} d
    JOIN ${co?'co_vehicle_arrivals':'vehicle_arrivals'} a ON a.id=d.arrival_id
    WHERE a.dispatch_vehicle_id=v.id AND ${co?"d.status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM export_license_allocations a WHERE a.co_plan_id=d.id AND a.state='RELEASED')":"d.cancelled_at IS NULL"})
 ) SELECT * FROM pairs v WHERE sales_plan_id=$3 AND ($5::uuid[] IS NULL OR dispatch_id=ANY($5))
  AND EXISTS (SELECT 1 FROM user_scopes s
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
 await releaseStaleLink(c,req,candidate);
 const {rows:[saved]}=await c.query(`INSERT INTO historical_sales_dispatch_links(source_id,${target},linked_by)
  VALUES($1,$2,$3) RETURNING *`,[source,dispatch,req.user.id]);
 await B.audit(c,req,'historical_sales_dispatch_linked','historical_movement_documents',source,null,{...saved,sales_plan_id:plan.id});
 return saved;
}

async function releaseStaleLink(c,req,row){
 if(row.stale_dispatch_id)await finishDispatchCancellation(c,req,{id:row.stale_plan_id},row.stale_dispatch_id,row.source_id,
  'RELINK_CANCELLED_DISPATCH');
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
 const {rows:matches}=await c.query(candidateSql(co)+' ORDER BY source_id,dispatch_id',
  [req.user.id,req.productCode,plan.id,plan.project_id,dispatchIds]);
 const unique=matches.filter(row=>row.dispatch_matches===1&&row.source_matches===1);
 let linkedIds=[];
 if(unique.length){
  for(const row of unique)await releaseStaleLink(c,req,row);
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
  const saved=new Set(linkedIds);
  if(unique.some(row=>row.stale_dispatch_id&&!saved.has(row.source_id)))
   throw B.error(409,'该历史装箱单的关联已变化，请刷新后重新匹配。');
 }
 const invoices=await confirmInvoices(c,req,plan.id,linkedIds);
 return {linked:linkedIds.length,ambiguous:new Set(matches.filter(row=>row.dispatch_matches>1||row.source_matches>1).map(row=>row.source_id)).size,...invoices};
}

async function afterDispatchImport(c,req,plan,dispatchIds){
 if(!dispatchIds.length)return null;
 return autoLink(c,req,{plan,dispatchIds});
}

module.exports={candidates,link,autoLink,afterDispatchImport,arrivalExists,assertNotArrived,removalBlocker,cancellationError,
 prepareDispatchCancellation,finishDispatchCancellation};
