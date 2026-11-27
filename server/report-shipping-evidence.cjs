'use strict';
const Packing=require('./historical-packing.cjs');

const archiveFields={invoice:'invoice_no',license:'license_no',driver:'driver_name',passport:'passport_no',
 vehicle:'truck',trailerOne:'trailer_one',trailerTwo:'trailer_two',transporter:'transporter',destination:'destination',
 plan:'sales_plan_no',month:'shipment_month',loadDate:'loading_date'};
const placeholders=/^(?:N\/A|NA|NONE|UNKNOWN|-|—|待确认|待补充)$/i;
function first(...values){
 return values.find(v=>typeof v==='string'&&v.trim()&&!placeholders.test(v.trim()))?.trim()??null;
}
function trailer(...values){
 return values.find(v=>typeof v==='string'&&v.trim()&&!/^(?:UNKNOWN|-|—|待确认|待补充)$/i.test(v.trim()))?.trim()??null;
}
const indexed=(rows,key)=>new Map(rows.map(row=>[row[key],row]));
const archiveCache=new Map(),archiveCacheLimit=1024,archiveCacheTtl=10*60*1000;
const archiveKey=(product,row)=>[product,row.id,row.source_sha256].join(':');
function cachedArchive(key){
 const entry=archiveCache.get(key);
 if(!entry)return null;
 archiveCache.delete(key);
 if(entry.expires<=Date.now())return null;
 archiveCache.set(key,entry);
 return entry.metadata;
}
function storeArchive(key,metadata){
 archiveCache.set(key,{metadata,expires:Date.now()+archiveCacheTtl});
 if(archiveCache.size>archiveCacheLimit)archiveCache.delete(archiveCache.keys().next().value);
}

async function copper(c,ids){
 if(!ids.length)return new Map();
 const {rows}=await c.query(`SELECT l.id,archive.snapshot archived,t.fields legacy,d.packing_list_no,
   doc.document_no archived_packing_no,va.trailer_one,
   va.trailer_two,va.driver_name,va.passport_no,va.shipment_month,
   v.transporter dispatch_transporter,v.destination dispatch_destination
  FROM loading_orders l LEFT JOIN loading_plan_matches m ON m.loading_id=l.id
  LEFT JOIN loading_plan_documents d ON d.id=m.document_id
  LEFT JOIN vehicle_arrivals va ON va.id=d.arrival_id AND va.registration_phase='CONFIRMED'
  LEFT JOIN sales_dispatch_vehicles v ON v.id=va.dispatch_vehicle_id AND v.cancelled_at IS NULL
  LEFT JOIN export_transport t ON t.loading_id=l.id
  LEFT JOIN packing_list_documents doc ON doc.loading_id=l.id
  LEFT JOIN packing_list_revisions archive ON archive.loading_id=l.id AND archive.revision=doc.revision
  WHERE l.id=ANY($1::uuid[])`,[ids]);
 return indexed(rows,'id');
}

async function cobalt(c,ids){
 if(!ids.length)return new Map();
 const {rows}=await c.query(`SELECT l.id,o.snapshot,coalesce(live.plan_id,l.sales_plan_id) plan_id,
   live.invoice_no confirmed_invoice,live.source_invoice_no,live.confirmed_at,
   p.code plan,p.shipment_month,d.invoice_no,d.export_license_no,d.transporter,d.destination,
   l.transport_snapshot transport,e.confirmed_at loaded_at,v.transporter dispatch_transporter,v.destination dispatch_destination
  FROM co_outbounds o JOIN co_loading_orders l ON l.id=o.order_id
  JOIN co_sales_plans p ON p.id=l.sales_plan_id
  LEFT JOIN co_loading_plans d ON d.id=l.plan_id
  LEFT JOIN co_load_executions e ON e.order_id=l.id
  LEFT JOIN co_dispatch_vehicles v ON v.id=l.vehicle_id AND v.sales_plan_id=p.id AND v.cancelled_at IS NULL
  LEFT JOIN sales_invoice_shipments live ON live.product_code='CO_HYDROXIDE'
   AND live.loading_id=l.id AND live.plan_id=l.sales_plan_id AND live.batch_id=l.preparation_id
  WHERE l.id=ANY($1::uuid[])`,[ids]);
 return indexed(rows,'id');
}

async function historical(c,product,ids,{transport=true}={}){
 if(!ids.length)return new Map();
 const {rows}=await c.query(`SELECT m.id,m.source_sha256,m.source_facts facts,h.plan_id,
   coalesce(cup.code,cop.code) plan,coalesce(cuk.shipment_month,cod.shipment_month) shipment_month,
   coalesce(cud.truck_no,cod.truck_no) truck,coalesce(cud.trailer_no,cod.trailer_no) trailer_one,
   coalesce(cud.transporter,cod.transporter) transporter,coalesce(cud.destination,cod.destination) destination,
   cod.driver_name,cod.passport_no,ic.invoice_no confirmed_invoice,ic.confirmed_at,
   h.source_invoice_no,ls.invoice_no license_invoice,license.license_no
  FROM historical_movement_documents m JOIN historical_backfills b ON b.source_id=m.id
  LEFT JOIN historical_sales_arrivals h ON h.source_id=m.id
  LEFT JOIN sales_dispatch_vehicle_keys cuk ON cuk.vehicle_id=h.cu_dispatch_id
  LEFT JOIN sales_plans cup ON cup.id=cuk.sales_plan_id AND cup.project_id=b.project_id
   AND (b.customer_id IS NULL OR cup.customer_id=b.customer_id)
  LEFT JOIN sales_dispatch_vehicles cud ON cud.id=h.cu_dispatch_id AND cup.id IS NOT NULL
  LEFT JOIN co_dispatch_vehicles cod ON cod.id=h.co_dispatch_id AND EXISTS(
   SELECT 1 FROM co_sales_plans p WHERE p.id=cod.sales_plan_id AND p.project_id=b.project_id
    AND p.warehouse_id=b.warehouse_id AND (b.customer_id IS NULL OR p.customer_id=b.customer_id))
  LEFT JOIN co_sales_plans cop ON cop.id=cod.sales_plan_id
  LEFT JOIN sales_invoice_confirmations ic ON ic.product_code=m.product_code AND ic.loading_id=m.id
   AND ic.batch_id=m.id AND ic.plan_id=coalesce(cup.id,cop.id)
  LEFT JOIN export_license_historical_sources ls ON ls.source_id=m.id
  LEFT JOIN LATERAL (
   SELECT CASE WHEN count(*)=1 THEN min(e.license_no) END license_no FROM export_licenses e
   WHERE e.product_code=m.product_code AND e.project_id=b.project_id AND e.state IN ('ISSUED','CLOSED')
    AND historical_unit_key(e.license_no)=ls.license_key
  ) license ON true
  WHERE m.product_code=$1 AND m.id=ANY($2::uuid[]) AND m.voided_at IS NULL`,[product,ids]);
 const byId=indexed(rows.map(row=>({...row,plan_id:row.plan?row.plan_id:null})),'id');
 // For newly imported workbooks, the relevant header values were saved with the
 // source facts. Read old archived workbooks only when they can add evidence.
 const potential=rows.filter(row=>!row.facts.shipping_metadata&&(transport||
   !first(row.confirmed_invoice,row.source_invoice_no,row.license_invoice,row.facts.invoice_no)||
   !first(row.plan)||!first(row.shipment_month)));
 const needsWorkbook=[];
 for(const row of potential){
  // Caller already applied report scope to ids. The archive cache is an
  // optimization of verified content for those same ids and checksums.
  const metadata=cachedArchive(archiveKey(product,row));
  if(metadata)byId.get(row.id).metadata=metadata;
  else needsWorkbook.push(row.id);
 }
 for(let offset=0;offset<needsWorkbook.length;offset+=32){
  const {rows:archives}=await c.query(`SELECT id,source_name,source_sha256,source_data
   FROM historical_movement_documents WHERE product_code=$1 AND id=ANY($2::uuid[]) AND voided_at IS NULL`,
  [product,needsWorkbook.slice(offset,offset+32)]);
  for(const archive of archives){
   try{
    const file=Packing.source({file_name:archive.source_name,file_base64:archive.source_data.toString('base64')});
    if(file.sha256===archive.source_sha256&&archive.source_sha256===byId.get(archive.id).source_sha256){
     const metadata=Packing.archivedShippingMetadata(product,file);
     byId.get(archive.id).metadata=metadata;
     storeArchive(archiveKey(product,archive),metadata);
    }
   }catch(error){if(error.statusCode!==400)throw error;}
  }
 }
 return byId;
}

function historicalFields(row,e={}){
 const facts=e.facts??{},metadata=facts.shipping_metadata??e.metadata??{};
 const values=metadata.values??{},ambiguous=new Set(metadata.ambiguous??[]);
 const legacy={invoice:facts.invoice_no,license:facts.license_no,driver:facts.driver_name,
  passport:facts.passport_no,vehicle:row.vehicle_no,trailerOne:row.trailer_one,trailerTwo:row.trailer_two,
  transporter:facts.transporter,destination:facts.destination,plan:facts.sales_plan_no,
  month:facts.shipment_month,loadDate:facts.loading_date};
 const linked={invoice:first(e.source_invoice_no,e.license_invoice),license:e.license_no,
  driver:e.driver_name,passport:e.passport_no,vehicle:e.truck,trailerOne:e.trailer_one,
  transporter:e.transporter,destination:e.destination,plan:e.plan,month:e.shipment_month};
 const pending_fields={},fields={planId:e.plan_id??null};
 for(const [field,key] of Object.entries(archiveFields)){
  const choose=field.startsWith('trailer')?trailer:first;
  const confirmed=field==='invoice'?first(e.confirmed_invoice):e.plan_id&&['plan','month'].includes(field)?first(linked[field]):null;
  const conflicting=ambiguous.has(key)&&!confirmed;
  fields[field]=conflicting?null:confirmed??choose(values[key],legacy[field],linked[field]);
  if(fields[field]==null)pending_fields[field]=conflicting?'HISTORICAL_AMBIGUOUS':
   !e.plan_id&&['plan','month'].includes(field)?'HISTORICAL_NOT_LINKED':'HISTORICAL_SOURCE_MISSING';
 }
 return {...fields,pending_fields};
}

function onlineFields(fields){
 return {...fields,pending_fields:Object.fromEntries(
  Object.keys(archiveFields).concat('packing').filter(key=>fields[key]==null).map(key=>[key,'ONLINE_SOURCE_MISSING']))};
}

module.exports={copper,cobalt,historical,historicalFields,onlineFields,first,trailer};
