'use strict';

const B=require('./business-common.cjs'),L=require('./export-licenses.cjs');
const CO='CO_HYDROXIDE',CU='CU_CATHODE';
async function link(c,product,id){
 if(!id)return null;
 const {rows:[row]}=await c.query("SELECT a.*,l.license_no,l.proforma_no,l.unit,l.unit_basis FROM export_license_allocations a JOIN export_licenses l ON l.id=a.license_id WHERE a.product_code=$1 AND a.plan_id=$2 AND a.state<>'VOID' ORDER BY a.created_at DESC,a.id LIMIT 1",[product,id]);
 return row||null;
}
async function weight(c,l,batch,body){
 if(l.unit_basis==='CUSTOM'){
  if(body.license_unit!==l.unit)throw B.error(409,'计划预占单位须与许可证一致');
  return L.decimal(body.license_quantity,'许可证预占数量');
 }
 let row;
 if(l.product_code===CO){
  const column=l.unit_basis==='COBALT_MT'?'co_estimated_metal_mt(sum(w.actual_net_kg))':'sum(w.actual_net_kg)/1000';
  row=(await c.query('SELECT CASE WHEN count(w.actual_net_kg)=p.bag_count THEN ('+column+')::text END quantity FROM co_preparations p LEFT JOIN co_bag_work w ON w.preparation_id=p.id WHERE p.id=$1 GROUP BY p.id',[batch])).rows[0];
 }else row=(await c.query("SELECT CASE WHEN count(r.weight)=count(*) THEN sum(r.weight)::text END quantity FROM reservations r WHERE r.allocation_id=$1 AND r.released_at IS NULL",[batch])).rows[0];
 if(!row?.quantity||!/[1-9]/.test(row.quantity))throw B.error(409,'备货批次缺少可用于许可证预占的有效重量');
 return row.quantity;
}
async function allowedDates(c,id,date){
 const {rows:[r]}=await c.query("SELECT state='ISSUED' AND valid_from<=$2::date AND coalesce(extended_until,valid_until)>=$2::date AND (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date BETWEEN valid_from AND coalesce(extended_until,valid_until) ok FROM export_licenses WHERE id=$1",[id,date]);
 if(!r?.ok)throw B.error(409,'许可证状态或有效日期不允许分配');
}
async function invoiceConflict(c,invoice,owner=null){
 if(!invoice)return;
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 await lockInvoice(c,invoice);
 if(await hasInvoice(c,invoice,owner))throw B.error(409,'发票号已使用，请修改后保存');
}
async function hasInvoice(c,invoice,owner=null){
 const {rowCount}=await c.query(`SELECT 1 FROM (
  SELECT invoice_no FROM export_license_allocations WHERE plan_id IS DISTINCT FROM $2::uuid
  UNION ALL SELECT invoice_no FROM loading_plan_documents WHERE id IS DISTINCT FROM $2
  UNION ALL SELECT invoice_no FROM loading_plan_groups WHERE id IS DISTINCT FROM $2
   AND id IS DISTINCT FROM (SELECT group_id FROM loading_plan_documents WHERE id=$2)
  UNION ALL SELECT invoice_no FROM co_loading_plans WHERE id IS DISTINCT FROM $2
  UNION ALL SELECT invoice_no FROM sales_invoice_confirmations
  UNION ALL ${historicalInvoices}
 ) n WHERE historical_unit_key(n.invoice_no)=historical_unit_key($1) LIMIT 1`,[invoice,owner]);
 return rowCount>0;
}
async function lockInvoice(c,invoice){
 await c.query('SELECT pg_advisory_xact_lock(472,hashtext(lower($1)))',[invoice]);
}
const invoices=`SELECT invoice_no FROM export_license_allocations UNION ALL SELECT invoice_no FROM loading_plan_documents
 UNION ALL SELECT invoice_no FROM loading_plan_groups UNION ALL SELECT invoice_no FROM co_loading_plans
 UNION ALL SELECT invoice_no FROM sales_invoice_confirmations`;
const historicalInvoices=`SELECT n.invoice_no FROM historical_movement_documents m
 LEFT JOIN export_license_historical_sources s ON s.source_id=m.id
 CROSS JOIN LATERAL (VALUES (m.source_facts->>'invoice_no'),(s.invoice_no),(regexp_replace(m.document_no,'-?PL$','','i'))) n(invoice_no)
 WHERE m.voided_at IS NULL AND m.movement_type='OUTBOUND'`;
async function invoiceCandidate(c,l){
 const {rows:[row]}=await c.query(`WITH suffixes AS (
  SELECT substr(invoice_no,length($1)+2) suffix FROM (${invoices}) invoices
  WHERE left(lower(invoice_no),length($1)+1)=lower($1)||'-'
 ), next AS (SELECT greatest($2::numeric,coalesce(max(CASE WHEN suffix~'^[0-9]+$' THEN suffix::numeric END),0)+1) serial FROM suffixes),
 historical_suffixes AS (
  SELECT substr(historical_unit_key(invoice_no),length(historical_unit_key($1))+2) suffix FROM (${historicalInvoices}) h
  WHERE left(historical_unit_key(invoice_no),length(historical_unit_key($1))+1)=historical_unit_key($1)||'-'
 ), blocked AS (SELECT DISTINCT CASE WHEN suffix~'^[0-9]+$' THEN suffix::numeric END serial FROM historical_suffixes),
 candidates AS (SELECT next.serial+offsets.n serial FROM next CROSS JOIN generate_series(0,(SELECT count(*)::int FROM blocked)) offsets(n))
 SELECT serial::text FROM candidates c WHERE NOT EXISTS(SELECT 1 FROM blocked b WHERE b.serial=c.serial)
 ORDER BY serial LIMIT 1`,
 [l.proforma_no,l.next_serial]);
 const invoice=l.proforma_no+'-'+row.serial.padStart(2,'0');
 if(invoice.length>77||BigInt(row.serial)>=9223372036854775807n)throw B.error(409,'生成的发票号超长');
 return {invoice,serial:row.serial};
}
async function nextInvoice(c,l){
 // The caller holds the transaction lock shared by automatic and manual invoice writes.
 let next_serial=l.next_serial;
 for(let i=0;i<100;i++){
  const {invoice,serial}=await invoiceCandidate(c,{...l,next_serial});
  await lockInvoice(c,invoice);
  next_serial=(BigInt(serial)+1n).toString();
  if(await hasInvoice(c,invoice))continue;
  if(l.id)await c.query('UPDATE export_licenses SET next_serial=$2::bigint WHERE id=$1',[l.id,next_serial]);
  return invoice;
 }
 throw B.error(409,'历史发票号冲突过多，请联系管理员核对');
}
async function prepare(c,req,plan,old,body,batch,date){
 const previous=await link(c,req.productCode,old?.id);
 if(previous?.state==='RELEASED')throw B.error(409,'许可证关联计划已取消');
 if(!body.license_id&&!previous){
  if(!old&&body.auto_invoice===true&&!body.invoice_no){
   await c.query('SELECT pg_advisory_xact_lock(477189)');
   return {invoice:await nextInvoice(c,{proforma_no:plan.code,next_serial:1})};
  }
  if(body.invoice_no!==old?.invoice_no)await invoiceConflict(c,body.invoice_no,old?.id);
  return null;
 }
 const id=body.license_id?B.uuid(body.license_id):previous.license_id;
 const switching=previous&&id!==previous.license_id;
 const matched=old&&(req.productCode===CO?old.status!=='DRAFT':!!old.loading_id);
 if(matched&&(!previous||switching))throw B.error(409,'已经匹配或办理的装车计划不可变更许可证');
 if(old&&(!previous||switching)){
  const history=req.productCode===CO?'SELECT 1 FROM co_loading_orders WHERE plan_id=$1 LIMIT 1':'SELECT 1 FROM loading_plan_match_history WHERE document_id=$1 LIMIT 1';
  if((await c.query(history,[old.id])).rowCount)throw B.error(409,'已有装车历史的计划不可变更许可证');
 }
 if(previous&&previous.state!=='RESERVED')throw B.error(409,'已核销许可证关联不可修改');
 const ids=[...new Set([id,previous?.license_id].filter(Boolean))].sort();
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 await c.query('SELECT id FROM export_licenses WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
 const license=await L.record(c,req,id,false,plan);
 await allowedDates(c,id,date);
 const quantity=license.unit_basis==='CUSTOM'&&previous&&!switching&&!body.license_quantity?previous.reserved_quantity:await weight(c,license,batch,body);
 await L.assertCapacity(c,id,!switching?previous?.id||null:null,quantity);
 const requested=!old&&body.invoice_no?B.text(body.invoice_no,'发票号',77):null;
 if(requested)await invoiceConflict(c,requested);
 const invoice=previous&&!switching?previous.invoice_no:requested||await nextInvoice(c,license);
 return {license,previous,switching,invoice,quantity,batch};
}
async function bind(c,req,plan,reservation){
 if(!reservation?.license)return null;
 const {license,previous,switching,invoice,quantity,batch}=reservation,co=req.productCode===CO;
 if(switching)await c.query("UPDATE export_license_allocations SET state='VOID',closed_at=clock_timestamp() WHERE id=$1",[previous.id]);
 const {rows:[row]}=previous&&!switching?
  await c.query('UPDATE export_license_allocations SET batch_id=$2,reserved_quantity=$3 WHERE id=$1 RETURNING *',[previous.id,batch,quantity]):
  await c.query('INSERT INTO export_license_allocations(license_id,product_code,'+(co?'co_plan_id':'cu_plan_id')+',batch_id,invoice_no,reserved_quantity,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[license.id,req.productCode,plan.id,batch,invoice,quantity,req.user.id]);
 await B.audit(c,req,previous&&!switching?'export_license_reservation_updated':'export_license_invoice_allocated',co?'co_loading_plans':'loading_plan_documents',plan.id,previous,row);
 return row;
}
async function beforeMatch(c,product,id,date){
 const r=await link(c,product,id);
 if(!r)return;
 if(r.state!=='RESERVED')throw B.error(409,'装车计划的许可证预占已经结束');
 await c.query('SELECT id FROM export_licenses WHERE id=$1 FOR UPDATE',[r.license_id]);
 await allowedDates(c,r.license_id,date);
 await L.assertCapacity(c,r.license_id,r.id,r.reserved_quantity);
}
async function cancelCobalt(c,req,plan){
 if(plan.status!=='DRAFT'||plan.version!==B.version(req.body?.version))throw B.error(409,'仅可取消版本一致的未匹配计划');
 const reason=B.text(req.body.reason,'取消原因',1000),r=await link(c,CO,plan.id);
 if(!r||r.state!=='RESERVED')throw B.error(409,'此装车计划无可释放的许可证预占');
 await c.query('SELECT id FROM export_licenses WHERE id=$1 FOR UPDATE',[r.license_id]);
 await c.query("UPDATE export_license_allocations SET state='RELEASED',closed_at=clock_timestamp() WHERE id=$1",[r.id]);
 await B.audit(c,req,'licensed_cobalt_plan_cancelled','co_loading_plans',plan.id,r,{...r,state:'RELEASED',reason});
 return {id:plan.id,status:'CANCELLED',project_id:plan.project_id,warehouse_id:plan.warehouse_id,customer_id:plan.customer_id};
}

module.exports={link,prepare,bind,beforeMatch,cancelCobalt,invoiceConflict,invoiceCandidate,hasInvoice};
