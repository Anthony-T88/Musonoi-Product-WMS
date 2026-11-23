'use strict';

const B=require('./business-common.cjs'),C=require('./cobalt.cjs'),S=require('./export-shipping.cjs');
const crypto=require('node:crypto'),T=require('../dist/tonnes.js');
const E=require('./customs-bp-print.cjs'),Agencies=require('./customs-bp-agencies.cjs'),Templates=require('./customs-bp-templates.cjs');
const Excel=require('./customs-bp-excel.cjs');
const CO='CO_HYDROXIDE';
const cuUrl='/api/v1/customs/bp',coUrl='/api/v1/cobalt/customs/bp';
const allowed=(path,method)=>method==='GET'&&(/^\/api\/v1\/cobalt\/customs\/packing-list(?:\/[0-9a-f-]{36}\/revisions)?$/i.test(path)||
 /^\/api\/v1\/cobalt\/customs\/bp(?:\/operations\/status|\/agencies|\/template|\/[0-9a-f-]{36}(?:\/(?:print|batches|excel))?)?$/i.test(path))||
 method==='POST'&&/^\/api\/v1\/cobalt\/customs\/bp(?:\/(?:agencies|template|preview|print\/preview|[0-9a-f-]{36}\/print\/preview))?$/i.test(path)||
 method==='PATCH'&&/^\/api\/v1\/cobalt\/customs\/bp\/(?:agencies\/)?[0-9a-f-]{36}$/i.test(path)||
 method==='DELETE'&&/^\/api\/v1\/cobalt\/customs\/bp\/agencies\/[0-9a-f-]{36}$/i.test(path);
const clearanceScope=`NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.source_context) f WHERE NOT EXISTS(
 SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=(f->>'project_id')::uuid
 AND(s.customer_id IS NULL OR s.customer_id=(f->>'customer_id')::uuid)
 AND(s.warehouse_id IS NULL OR s.warehouse_id=(f->>'warehouse_id')::uuid)))`;
const contractScope=alias=>`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=${alias}.project_id
 AND (s.customer_id IS NULL OR s.customer_id=${alias}.customer_id) AND (s.warehouse_id IS NULL OR s.warehouse_id=${alias}.warehouse_id))`;
const coBatch="COALESCE(NULLIF(l.plan_snapshot->>'preparation_batch_no',''),p.preparation_batch_no)";
const coFrom=`FROM co_loading_orders l JOIN co_loading_plans d ON d.id=l.plan_id
 JOIN co_sales_plans sp ON sp.id=l.sales_plan_id JOIN co_customer_profiles c ON c.id=sp.customer_id
 JOIN co_preparations p ON p.id=l.preparation_id JOIN co_load_executions e ON e.order_id=l.id
 WHERE l.status<>'CANCELLED' AND e.logistics_by IS NOT NULL AND e.logistics_at IS NOT NULL
 AND e.state IN('LOGISTICS_APPROVED','OUTBOUND') AND ${contractScope('sp')}`;
const coSql=`SELECT l.id,l.code,l.version,d.version plan_version,e.version execution_version,sp.project_id,sp.warehouse_id,
 sp.customer_id,c.name customer,${coBatch} batch,ARRAY[upper(btrim(${coBatch}))] batch_nos,
 coalesce((e.confirmed_at AT TIME ZONE 'Africa/Lubumbashi')::date,d.planned_load_date)::text loading_date,e.logistics_at approved_at,e.state,
 COALESCE(NULLIF(d.transporter,''),l.transport_snapshot->>'transporter') transporter,
 l.transport_snapshot->>'truck_no' truck,l.transport_snapshot->>'trailer_one' trailer_one,l.transport_snapshot->>'trailer_two' trailer_two,
 l.transport_snapshot->>'container_no' container,l.transport_snapshot->>'driver_name' driver,l.transport_snapshot->>'passport_no' passport,
 d.export_license_no license,l.bag_count quantity,
 coalesce((SELECT k.document_no FROM co_packing_documents k WHERE k.order_id=l.id),d.packing_list_no) packing_list_no,
 round(l.actual_net_kg/1000,6)::text net_mt,round(l.actual_gross_kg/1000,6)::text gross_mt,
 to_jsonb(ARRAY[sp.warehouse_id]) warehouses ${coFrom}`;
const cuTruck="coalesce(nullif(l.vehicle_no,''),d.vehicle_no,t.fields->>'vehicle_no')";
const cuFrom=withDetails=>`FROM loading_orders l JOIN copper_customers c ON c.id=l.customer_id
 LEFT JOIN loading_plan_matches m ON m.loading_id=l.id LEFT JOIN loading_plan_documents d ON d.id=m.document_id
 LEFT JOIN export_transport t ON t.loading_id=l.id
 ${withDetails?'LEFT JOIN vehicle_arrivals a ON a.id=d.arrival_id':''}
 CROSS JOIN LATERAL (
  SELECT string_agg(DISTINCT lot.lot_no,' / ' ORDER BY lot.lot_no) batch,count(*)::int quantity,
   array_agg(DISTINCT upper(btrim(lot.lot_no)) ORDER BY upper(btrim(lot.lot_no))) batch_nos,
   CASE WHEN bool_and(i.original_weight IS NOT NULL) THEN sum(i.original_weight)::text END net_mt
   ${withDetails?`,CASE WHEN bool_and(coalesce(ai.gross_weight,b.gross_weight) IS NOT NULL) THEN sum(coalesce(ai.gross_weight,b.gross_weight))::text END gross_mt,
   array_agg(DISTINCT loc.warehouse_id ORDER BY loc.warehouse_id) warehouses`:''}
  FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN allocations lot ON lot.id=r.allocation_id
  ${withDetails?`JOIN bundles b ON b.id=i.bundle_id JOIN locations loc ON loc.id=i.original_location_id
  LEFT JOIN allocation_items ai ON ai.allocation_id=lot.id AND ai.bundle_id=b.id`:''}
  WHERE i.loading_id=l.id AND NOT i.plan_removed
 ) x
 WHERE l.logistics_review_by IS NOT NULL AND l.logistics_review_at IS NOT NULL
 AND x.quantity>0 AND (l.workflow_state='OUTBOUND' AND (${S.posted}) OR l.workflow_state='DEPARTED_PENDING' AND l.status NOT IN('CANCELLED','REVERSED'))
 AND NOT EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=l.id
  AND (cr.status IN('REQUESTED','AUTHORIZED','RETURN_VERIFIED') OR cr.kind='RETURN_OUTBOUND' AND cr.status='APPLIED')) AND ${S.scope}`;
const cuSql=`SELECT l.id,l.code,l.version,d.version plan_version,NULL::integer execution_version,l.project_id,l.customer_id,
 c.name customer,x.batch,x.batch_nos,coalesce((l.loaded_at AT TIME ZONE 'Africa/Lubumbashi')::date,d.planned_load_date)::text loading_date,
 l.logistics_review_at approved_at,l.workflow_state state,
 coalesce(nullif(d.transporter,''),nullif(t.fields->>'forwarder',''),l.carrier) transporter,
 ${cuTruck} truck,
 coalesce(nullif(a.trailer_one,''),t.fields->>'trailer_one') trailer_one,
 coalesce(nullif(a.trailer_two,''),t.fields->>'trailer_two') trailer_two,
 coalesce(nullif(a.container_no,''),t.fields->>'container_no') container,
 coalesce(nullif(a.driver_name,''),t.fields->>'driver_name') driver,
 coalesce(nullif(a.passport_no,''),t.fields->>'passport_no') passport,
 coalesce((SELECT k.document_no FROM packing_list_documents k WHERE k.loading_id=l.id),d.packing_list_no) packing_list_no,
 coalesce(nullif(d.export_license_no,''),t.fields->>'eb_license') license,
 x.quantity,x.net_mt,x.gross_mt,to_jsonb(x.warehouses) warehouses ${cuFrom(true)}`;
const coList=`SELECT l.id,l.code,sp.project_id,sp.customer_id,c.name customer,${coBatch} batch,ARRAY[upper(btrim(${coBatch}))] batch_nos,
 l.transport_snapshot->>'truck_no' truck,e.logistics_at approved_at,round(l.actual_net_kg/1000,6)::text net_mt ${coFrom}`;
const cuList=`SELECT l.id,l.code,l.project_id,l.customer_id,c.name customer,x.batch,x.batch_nos,${cuTruck} truck,l.logistics_review_at approved_at,x.net_mt ${cuFrom(false)}`;
const claimed=(alias,product)=>`(EXISTS(SELECT 1 FROM customs_bp_batch_claims c WHERE c.product_code=${product}
 AND c.project_id=${alias}.project_id AND c.batch_no=ANY(${alias}.batch_nos))
 OR EXISTS(SELECT 1 FROM customs_bp_documents b WHERE b.product_code=${product} AND b.source_ids @> ARRAY[${alias}.id]))`;
const rowFields={batch:160,truck:80,trailer_one:80,trailer_two:80,container:80,transporter:160,driver:160,passport:80,quantity:8,net_mt:32,gross_mt:32,packing_list_no:160,loading_date:10};
const editableHeader={mode:60,border:120,signature_date:10};
const choices={modes:['ROAD','RAILWAY'],borders:['Kasumbalesa','Sakania','Mokambo']};
const hash=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const scopeFor=rows=>[...new Map(rows.flatMap(row=>row.warehouses.map(warehouse_id=>{
 const scope={project_id:row.project_id,customer_id:row.customer_id,warehouse_id};
 return [JSON.stringify(scope),scope];
}))).values()];
const coords=co=>co?coSql:cuSql;
const join=(rows,key)=>[...new Set(rows.map(row=>row[key]).filter(Boolean))].sort().join(' / ');
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function text(value,max){
 if(typeof value!=='string'||value.length>max||/[\x00-\x1f]/.test(value))throw B.error(400,'BP_INVALID_FIELD');
 return value.trim();
}
function keys(obj,shape){
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||Object.keys(obj).some(k=>!Object.hasOwn(shape,k)))throw B.error(400,'BP_INVALID_FIELD');
}
function fieldMap(data,shape){
 keys(data,shape);
 return Object.fromEntries(Object.entries(shape).map(([k,max])=>[k,text(String(data[k]??''),max)]));
}
function totals(rows,required=false){
 const weight=(row,field)=>{
  const v=row[field];if(!v&&!required)return null;
  if(!/^\d{1,9}(?:\.\d{1,6})?$/.test(v)||T.scaled(v,6)<=0n)throw B.error(400,'BP_INVALID_WEIGHT');
  return T.scaled(v,6);
 };
 let quantity=0,gross=0n,net=0n,complete=true;
 for(const row of rows){
  if(!/^[1-9]\d{0,7}$/.test(row.quantity))throw B.error(400,'BP_INVALID_QUANTITY');
  quantity+=Number(row.quantity);
  const w=weight(row,'gross_mt'),n=weight(row,'net_mt');
  if(w==null||n==null){complete=false;continue;}
  if(n>w)throw B.error(400,'BP_INVALID_WEIGHT');
  gross+=w;net+=n;
 }
 return {quantity,gross_mt:complete?T.fixed(gross,6):null,net_mt:complete?T.fixed(net,6):null};
}
function sourceHeader(header,co){
 return {customer:header.customer||'',license:header.license||'',
  product:co?'HYDROXYDE DE COBALT':'CATHODE DE CUIVRE',
  loading_date:String(header.loading_date||'').split(' / ').filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)).sort().at(-1)||''};
}
async function list(c,req){
 const co=req.productCode===CO,q=req.query||{};
 const page=Number(q.page||1),documentPage=Number(q.document_page||1);
 const size=Number(q.page_size||10),documentSize=Number(q.document_page_size||10);
 if(![page,documentPage].every(n=>Number.isInteger(n)&&n>=1&&n<=100000)||
  ![size,documentSize].every(n=>[10,25,50,100].includes(n)))throw B.error(400,'BP_INVALID_FIELD');
 const customer=q.customer_id?B.uuid(q.customer_id):null,generatedDate=q.generated_date?B.date(q.generated_date):null;
 const batch=text(q.batch_no||'',160),documentNo=text(q.document_no||'',80),legacy=text(q.search||'',160);
 const {rows:[result]}=await c.query(`WITH eligible AS MATERIALIZED (
  ${co?coList:cuList}
 ), grouped AS MATERIALIZED (
  SELECT COALESCE(NULLIF(batch,''),id::text) batch_key,customer_id,max(batch) batch,max(customer) customer,
   string_agg(DISTINCT truck,' / ' ORDER BY truck) truck,max(approved_at) approved_at,array_agg(id ORDER BY id) source_ids,
   CASE WHEN count(*)=count(net_mt) THEN sum(net_mt::numeric)::text END net_mt
  FROM eligible WHERE NOT ${claimed('eligible','$2')} AND ($3::uuid IS NULL OR customer_id=$3) AND ($4='' OR strpos(lower(batch),lower($4))>0)
  GROUP BY batch_key,customer_id HAVING bool_or($7='' OR strpos(lower(concat_ws(' ',batch,code,customer,truck)),lower($7))>0)
 ), visible AS MATERIALIZED (
  SELECT d.id,d.document_no,d.created_at,d.source_context FROM customs_bp_documents d
  WHERE d.product_code=$2 AND ${clearanceScope}
 ), matching AS MATERIALIZED (
  SELECT d.id,d.created_at FROM visible d
  WHERE ($3 IS NULL OR d.source_context @> jsonb_build_array(jsonb_build_object('customer_id',$3::text)))
   AND ($5='' OR strpos(lower(d.document_no),lower($5))>0)
   AND ($6::date IS NULL OR (d.created_at AT TIME ZONE 'Africa/Lubumbashi')::date=$6)
   AND ($4='' OR EXISTS(SELECT 1 FROM customs_bp_documents s
    CROSS JOIN LATERAL jsonb_array_elements(s.snapshot->'rows'||coalesce(s.snapshot->'original'->'rows','[]')) r
    WHERE s.id=d.id AND strpos(lower(r->>'batch'),lower($4))>0))
 ), bp_page AS (
  SELECT id,created_at FROM matching ORDER BY created_at DESC,id LIMIT $10 OFFSET $11
 ), customers AS (
  SELECT customer_id id,customer name FROM eligible
  UNION
  SELECT p.id,p.name FROM visible d CROSS JOIN LATERAL jsonb_array_elements(d.source_context) s
  JOIN ${co?'co_customer_profiles':'copper_customers'} p ON p.id=(s->>'customer_id')::uuid
 ) SELECT (SELECT count(*)::int FROM grouped) total,
  (SELECT count(*)::int FROM matching) document_total,
  coalesce((SELECT jsonb_agg(f ORDER BY approved_at DESC,batch_key,customer_id)
   FROM (SELECT * FROM grouped ORDER BY approved_at DESC,batch_key,customer_id LIMIT $8 OFFSET $9) f),'[]') items,
  coalesce((SELECT jsonb_agg(f ORDER BY created_at DESC,id) FROM (
   SELECT s.id,s.document_no,s.created_at,cardinality(s.source_ids) vehicle_count,coalesce(r.revision,1) revision,
    coalesce(r.snapshot,s.snapshot)->'header'->>'customer' customer,
    coalesce(r.snapshot,s.snapshot)->'total'->>'net_mt' net_mt,coalesce(r.snapshot,s.snapshot)->'total'->>'gross_mt' gross_mt
   FROM bp_page b JOIN customs_bp_documents s ON s.id=b.id
   LEFT JOIN LATERAL (SELECT revision,snapshot FROM customs_bp_revisions WHERE document_id=s.id ORDER BY revision DESC LIMIT 1) r ON true) f),'[]') documents,
  coalesce((SELECT jsonb_agg(customers ORDER BY name,id) FROM customers),'[]') customer_options`,
 [req.user.id,req.productCode,customer,batch,documentNo,generatedDate,legacy,size,(page-1)*size,documentSize,(documentPage-1)*documentSize]);
 return {...result,page,page_size:size,document_page:documentPage,document_page_size:documentSize};
}
function selection(body){
 if(!Array.isArray(body?.ids)||body.ids.length<1||body.ids.length>200)throw B.error(400,'BP_SELECTION_REQUIRED');
 const ids=body.ids.map(v=>B.uuid(v).toLowerCase()).sort();
 if(new Set(ids).size!==ids.length)throw B.error(400,'BP_SELECTION_REQUIRED');
 return ids;
}
async function chosen(c,req,ids){
 const co=req.productCode===CO;
 const {rows}=await c.query(`SELECT eligible.*,${claimed('eligible','$3')} claimed FROM (${coords(co)}) eligible WHERE id=ANY($2::uuid[]) ORDER BY id`,
  [req.user.id,ids,req.productCode]);
 if(rows.length!==ids.length)throw B.error(409,'BP_SOURCE_CHANGED');
 if(new Set(rows.map(row=>row.customer_id)).size!==1)throw B.error(409,'BP_CUSTOMER_MISMATCH');
 if(rows.some(row=>row.claimed))throw B.error(409,'BP_BATCH_LOCKED');
 if(rows.some(row=>!row.batch||!row.batch_nos?.length))throw B.error(409,'BP_SOURCE_CHANGED');
 const template=await Templates.active(c,req.productCode),{title,...fixed}=template.fields;
 const header={...fixed,...sourceHeader({customer:rows[0].customer,license:join(rows,'license'),loading_date:join(rows,'loading_date')},co)};
 // Source signatures include every business field and the latest approval version.
 return {token:hash([template.revision,rows]),rows,project_id:rows[0].project_id,header,template_title:title,
  template_revision:template.revision,data:rows.map(row=>fieldMap(rowFieldsFrom(row),rowFields))};
}
const rowFieldsFrom=row=>Object.fromEntries(Object.keys(rowFields).map(k=>[k,row[k]??'']));
const draftFields={ids:0,token:0,number:0,header:0,agency_id:0,agency_version:0};
const editFields={revision:0,header:0,agency_id:0,agency_version:0};

async function declaration(c,req,body,project,{prior,lock=false}={}){
 const edited=fieldMap(body.header,editableHeader);
 const {mode,border,signature_date}=edited;
 if(!choices.modes.includes(mode)||!choices.borders.includes(border)||!signature_date)throw B.error(400,'BP_DECLARATION_REQUIRED');
 const agency=body.agency_id?await Agencies.resolve(c,req,project,body.agency_id,body.agency_version,lock):
  {agency:prior?.header.agency||'',agency_id:prior?.agency_id||null};
 if(!agency.agency)throw B.error(400,'BP_DECLARATION_REQUIRED');
 return {...agency,...edited,signature_date:B.date(signature_date)};
}

async function draft(c,req,source,{lock=false}={}){
 const body=req.body;
 if(body.token!==source.token)throw B.error(409,'BP_SOURCE_CHANGED');
 if(!source.template_revision)throw B.error(409,'BP_TEMPLATE_REQUIRED');
 const {agency_id,...fields}=await declaration(c,req,body,source.project_id,{lock});
 const original={header:source.header,rows:source.data};
 if(!source.header.customer||source.data.some(row=>!row.batch||!row.truck||!row.quantity||!row.net_mt||!row.gross_mt))
  throw B.error(409,'BP_REQUIRED_DETAILS');
 const rows=source.rows.map(({id,code},i)=>({...source.data[i],order_id:id,code}));
 return {header:{...source.header,...fields},total:totals(rows,true),rows,original,agency_id,
  template_revision:source.template_revision,template_title:source.template_title};
}

async function documentNumber(c,product,value='',reserve=false){
 const requested=text(value,80);
 if(reserve)await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['customs-bp-number/'+product]);
 if(requested){
  const used=await c.query('SELECT 1 FROM customs_bp_documents WHERE product_code=$1 AND upper(document_no)=upper($2)',[product,requested]);
  if(used.rowCount)throw B.error(409,'BP_NUMBER_IN_USE');
  return requested;
 }
 const year=Number(date().slice(0,4)),suffix='/'+year+'/'+(product===CO?'CO':'CU');
 const {rows:[counter]}=await c.query(`SELECT coalesce((SELECT last_number FROM customs_bp_counters WHERE product_code=$1 AND business_year=$2),0) last_number,
  ARRAY(SELECT upper(document_no) FROM customs_bp_documents WHERE product_code=$1 AND upper(document_no) LIKE $3) used`,[product,year,'%'+suffix]);
 const format=serial=>String(serial).padStart(3,'0')+suffix;
 const used=new Set(counter.used);
 let serial=counter.last_number+1;
 while(used.has(format(serial)))serial++;
 if(reserve)await c.query(`INSERT INTO customs_bp_counters(product_code,business_year,last_number) VALUES($1,$2,$3)
  ON CONFLICT(product_code,business_year) DO UPDATE SET last_number=EXCLUDED.last_number`,[product,year,serial]);
 return format(serial);
}

async function save(c,req){
 const body=req.body;keys(body,draftFields);
 const ids=selection(body);
 if(req.productCode===CO){
  await chosen(c,req,ids);
  await c.query('SELECT id FROM co_loading_orders WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);
  await c.query('SELECT order_id FROM co_load_executions WHERE order_id=ANY($1::uuid[]) ORDER BY order_id FOR UPDATE',[ids]);
 }else await c.query('SELECT customs_bp_lock_cu($1,$2)',[req.user.id,ids]);
 const source=await chosen(c,req,ids);
 const snapshot=await draft(c,req,source,{lock:true});
 const number=await documentNumber(c,req.productCode,body.number??'',true);
 snapshot.number=number;
 const context=scopeFor(source.rows);
 let doc;
 try{doc=(await c.query(`INSERT INTO customs_bp_documents(product_code,document_no,source_ids,source_context,snapshot,created_by)
  VALUES($1,$2,$3,$4,$5,$6) RETURNING id,document_no`,[req.productCode,number,ids,JSON.stringify(context),snapshot,req.user.id])).rows[0];}
 catch(err){if(err.code==='23505')throw B.error(409,'BP_NUMBER_IN_USE');throw err;}
 const batches=source.rows.flatMap(row=>row.batch_nos.filter(Boolean).map(batch_no=>[row.project_id,batch_no]));
 const unique=[...new Map(batches.map(pair=>[pair.join('/'),pair])).values()];
 const claims=await c.query(`INSERT INTO customs_bp_batch_claims(product_code,project_id,batch_no,document_id)
  SELECT $1,project_id,batch_no,$2 FROM unnest($3::uuid[],$4::text[]) AS lot(project_id,batch_no)
  ORDER BY project_id,batch_no ON CONFLICT DO NOTHING`,[req.productCode,doc.id,unique.map(row=>row[0]),unique.map(row=>row[1])]);
 if(claims.rowCount!==unique.length)throw B.error(409,'BP_BATCH_LOCKED');
 for(const row of source.rows)await B.audit(c,req,'customs_bp_generated',req.productCode===CO?'co_loading_orders':'loading_orders',row.id,null,{
  bp_id:doc.id,document_no:number,product_code:req.productCode,project_id:row.project_id,customer_id:row.customer_id,
  warehouse_id:row.warehouses.length===1?row.warehouses[0]:null
 });
 return {...doc,revision:1};
}

async function archived(c,req,revision=null){
 const doc=(await c.query(`SELECT d.id,d.document_no,d.created_at,d.source_context->0->>'project_id' project_id,
  CASE WHEN $4::integer=1 THEN d.snapshot ELSE coalesce(r.snapshot,d.snapshot) END snapshot,
  CASE WHEN $4::integer=1 THEN 1 ELSE coalesce(r.revision,1) END revision
  FROM customs_bp_documents d LEFT JOIN LATERAL (
   SELECT snapshot,revision FROM customs_bp_revisions WHERE document_id=d.id AND ($4::integer IS NULL OR revision=$4::integer)
   ORDER BY revision DESC LIMIT 1) r ON true
  WHERE d.product_code=$2 AND d.id=$3 AND ${clearanceScope}`,
 [req.user.id,req.productCode,B.uuid(req.params.id),revision])).rows[0];
 if(!doc||revision!==null&&doc.revision!==revision)throw B.error(404,'BP_NOT_FOUND');
 return doc;
}

async function archiveBasis(c,req,doc){
 const {snapshot}=doc;
 if(snapshot.template_revision)return {header:snapshot.header,template_revision:snapshot.template_revision,template_title:snapshot.template_title};
 const template=await Templates.active(c,req.productCode),{title,...fixed}=template.fields;
 return {header:{...fixed,...sourceHeader(snapshot.original?.header||snapshot.header,req.productCode===CO)},
  template_revision:template.revision,template_title:title};
}

async function withPrintIdentification(c,product,snapshot){
 const missing=['rccm','id_nat','nif','contact'].filter(field=>!snapshot.header[field]?.trim());
 if(!missing.length)return snapshot;
 // Earlier BP revisions predate the approved template. Use its first version for missing print fields.
 const template=await Templates.fieldsAt(c,product,snapshot.template_revision||1),header={...snapshot.header};
 for(const field of missing)header[field]=snapshot.original?.header?.[field]?.trim()||template?.[field]||'';
 return {...snapshot,header};
}
function archiveForOutput(pool,req){
 const revision=req.query.revision===undefined?null:B.version(Number(req.query.revision));
 return C.readTransaction(pool,async c=>{
  const doc=await archived(c,req,revision);
  return {...doc,snapshot:await withPrintIdentification(c,req.productCode,doc.snapshot)};
 });
}

function editorData(doc,basis){
 const {snapshot}=doc;
 const findChoice=(key,options)=>options.find(option=>option.toUpperCase()===String(snapshot.header[key]||'').toUpperCase())||'';
 return {id:doc.id,number:doc.document_no,revision:doc.revision,template_revision:basis.template_revision,header:{...basis.header,
  mode:findChoice('mode',choices.modes),border:findChoice('border',choices.borders),
  signature_date:/^\d{4}-\d{2}-\d{2}$/.test(snapshot.header.signature_date)?snapshot.header.signature_date:'',agency:snapshot.header.agency||''},
 rows:snapshot.rows.map(({order_id,code,...row})=>({...row,id:order_id,code}))};
}

async function revised(c,req,doc,lock=false){
 keys(req.body,editFields);
 if(B.version(req.body.revision)!==doc.revision)throw B.error(409,'BP_REVISION_CHANGED');
 const basis=await archiveBasis(c,req,doc);
 if(!basis.template_revision)throw B.error(409,'BP_TEMPLATE_REQUIRED');
 const {agency_id,...fields}=await declaration(c,req,req.body,doc.project_id,{prior:doc.snapshot,lock});
 return {...doc.snapshot,...basis,header:{...basis.header,...fields},agency_id,number:doc.document_no};
}

async function archiveBatches(c,req,rows){
 const ids=rows.filter(row=>(!row.packing_list_no||!row.loading_date)&&row.order_id).map(row=>row.order_id);
 let source=new Map();
 if(ids.length){
  const sql=req.productCode===CO?`SELECT l.id,coalesce(k.document_no,p.packing_list_no) packing_list_no,
   coalesce((e.confirmed_at AT TIME ZONE 'Africa/Lubumbashi')::date,p.planned_load_date)::text loading_date
   FROM co_loading_orders l JOIN co_loading_plans p ON p.id=l.plan_id
   LEFT JOIN co_load_executions e ON e.order_id=l.id LEFT JOIN co_packing_documents k ON k.order_id=l.id`:
   `SELECT l.id,coalesce(k.document_no,p.packing_list_no) packing_list_no,
   coalesce((l.loaded_at AT TIME ZONE 'Africa/Lubumbashi')::date,p.planned_load_date)::text loading_date
   FROM loading_orders l LEFT JOIN loading_plan_matches m ON m.loading_id=l.id
   LEFT JOIN loading_plan_documents p ON p.id=m.document_id LEFT JOIN packing_list_documents k ON k.loading_id=l.id`;
  source=new Map((await c.query(sql+' WHERE l.id=ANY($1::uuid[])',[ids])).rows.map(row=>[row.id,row]));
 }
 return {items:rows.map(({batch,truck,code,packing_list_no,order_id,net_mt,gross_mt,loading_date})=>{
  const row=source.get(order_id);
  return {batch,truck,code,packing_list_no:packing_list_no||row?.packing_list_no||'',net_mt,gross_mt,
   loading_date:loading_date||row?.loading_date||''};
 })};
}

async function editArchive(c,req){
 const id=B.uuid(req.params.id).toLowerCase();
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['customs-bp-edit/'+id]);
 const doc=await archived(c,req);
 const snapshot=await revised(c,req,doc,true),revision=doc.revision+1;
 await c.query('INSERT INTO customs_bp_revisions(document_id,revision,snapshot,created_by) VALUES($1,$2,$3,$4)',
  [id,revision,snapshot,req.user.id]);
 await B.audit(c,req,'customs_bp_revised','customs_bp_documents',id,
  {document_no:doc.document_no,project_id:doc.project_id,product_code:req.productCode,revision:doc.revision},
  {document_no:doc.document_no,project_id:doc.project_id,product_code:req.productCode,revision});
 return {id,document_no:doc.document_no,revision};
}

async function status(c,req,url){
 const {method,path,key}=req.query,base=url.slice('/api/v1'.length);
 const relative=typeof path==='string'&&path.startsWith(base)?path.slice(base.length):null;
 const template=method==='POST'&&relative==='/template';
 const agency=method==='POST'&&relative==='/agencies'||['PATCH','DELETE'].includes(method)&&/^\/agencies\/[0-9a-f-]{36}$/i.test(relative);
 const document=method==='POST'&&relative===''||method==='PATCH'&&/^\/[0-9a-f-]{36}$/i.test(relative);
 if(!agency&&!document&&!template||typeof key!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(key))throw B.error(400,'BP_INVALID_FIELD');
 const query=agency?`JOIN customs_bp_agencies a ON a.id=(r.response->>'id')::uuid
  WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=a.project_id)`:
  template?`JOIN customs_bp_templates t ON t.id=(r.response->>'id')::uuid WHERE t.product_code=$4`:
  `JOIN customs_bp_documents d ON d.id=(r.response->>'id')::uuid WHERE d.product_code=$4 AND ${clearanceScope}`;
 const {rowCount}=await c.query(`SELECT 1 FROM idempotency_requests r ${query}
  AND r.actor_id=$1 AND r.route=$2 AND r.key=$3`,[req.user.id,method+' /api/v1'+path,key,...(agency?[]:[req.productCode])]);
 return {committed:rowCount===1};
}

async function packingRevisions(c,req,co){
 const id=B.uuid(req.params.id);
 if(co){
  const {order,execution}=await require('./cobalt-execution.cjs').access(c,req,id);
  if(order.status!=='OUTBOUND'||execution?.state!=='OUTBOUND')throw B.error(409,'CO_PACKING_OUTBOUND_REQUIRED');
 }else await S.load(c,req,id);
 const [table,lookup]=co?['co_packing_revisions','order_id']:['packing_list_revisions','loading_id'];
 const {rows}=await c.query(`SELECT revision,generated_at,reason FROM ${table}
  WHERE ${lookup}=$1 ORDER BY revision DESC LIMIT 10`,[id]);
 return {items:rows};
}

function register({app,pool,permitted,csrf}){
 for(const url of [cuUrl,coUrl]){
  const permission=permitted('customs:bp'),templatePermission=permitted('customs:bp-template');
  const co=url===coUrl;
  const packing=url.replace(/bp$/,'packing-list'),options={packingWorkspace:true};
  app.get(packing,{preHandler:permitted('load:read')},req=>C.readTransaction(pool,c=>co?
   require('./cobalt-overview.cjs').operations(c,{...req,query:{...req.query,state:'OUTBOUND'}},false,false,options):
   S.list(c,req,true,true,false,options)));
  app.get(packing+'/:id/revisions',{preHandler:permitted('load:read')},req=>C.readTransaction(pool,c=>packingRevisions(c,req,co)));
  app.get(url,{preHandler:permission},req=>C.readTransaction(pool,c=>list(c,req)));
  app.get(url+'/template',{preHandler:templatePermission},req=>Templates.active(pool,req.productCode));
  app.post(url+'/template',{preHandler:[templatePermission,csrf]},req=>B.mutate(pool,req,c=>Templates.save(c,req)));
  app.get(url+'/agencies',{preHandler:permission},req=>C.readTransaction(pool,c=>Agencies.book(c,req)));
  app.post(url+'/agencies',{preHandler:[permission,csrf]},req=>B.mutate(pool,req,c=>Agencies.change(c,req)));
  for(const method of ['PATCH','DELETE'])app.route({method,url:url+'/agencies/:id',preHandler:[permission,csrf],
   handler:req=>B.mutate(pool,req,c=>Agencies.change(c,req))});
  app.post(url+'/preview',{preHandler:[permission,csrf]},req=>C.readTransaction(pool,async c=>{
   const source=await chosen(c,req,selection(req.body));
   return {header:{...source.header,mode:'',border:'',agency:'',signature_date:date()},
    rows:source.data.map((row,i)=>({...row,id:source.rows[i].id,code:source.rows[i].code})),
    token:source.token,number:await documentNumber(c,req.productCode),options:choices,template_revision:source.template_revision,
    project_id:source.project_id,agencies:await Agencies.list(c,req,source.project_id)};
  }));
  app.post(url+'/print/preview',{preHandler:[permission,csrf]},req=>C.readTransaction(pool,async c=>{
   const body=req.body;keys(body,draftFields);
   const snapshot=await draft(c,req,await chosen(c,req,selection(body)));
   snapshot.number=await documentNumber(c,req.productCode,body.number??'');
   return {number:snapshot.number,content:E.content(snapshot)};
  }));
  app.post(url,{preHandler:[permission,csrf]},req=>B.mutate(pool,req,c=>save(c,req)));
  app.get(url+'/operations/status',{preHandler:req=>(req.query.path===url.slice('/api/v1'.length)+'/template'?templatePermission:permission)(req)},
   req=>status(pool,req,url));
  app.get(url+'/:id',{preHandler:permission},req=>C.readTransaction(pool,async c=>{
   const doc=await archived(c,req),view=editorData(doc,await archiveBasis(c,req,doc));
   const {rows}=await c.query(`SELECT revision,created_at FROM customs_bp_revisions WHERE document_id=$1 ORDER BY revision DESC`,[doc.id]);
   return {...view,options:choices,project_id:doc.project_id,agencies:await Agencies.list(c,req,doc.project_id),
    versions:[...rows,{revision:1,created_at:doc.created_at}]};
  }));
  app.post(url+'/:id/print/preview',{preHandler:[permission,csrf]},req=>C.readTransaction(pool,async c=>{
   const snapshot=await withPrintIdentification(c,req.productCode,await revised(c,req,await archived(c,req)));
   return {number:snapshot.number,content:E.content(snapshot)};
  }));
  app.patch(url+'/:id',{preHandler:[permission,csrf]},req=>B.mutate(pool,req,c=>editArchive(c,req)));
  app.get(url+'/:id/batches',{preHandler:permission},req=>C.readTransaction(pool,async c=>archiveBatches(c,req,(await archived(c,req)).snapshot.rows)));
  app.get(url+'/:id/print',{preHandler:permission},async(req,reply)=>{
   const doc=await archiveForOutput(pool,req);
   return reply.type('text/html; charset=utf-8').send(E.html(doc.snapshot,req.query.print==='1'));
  });
  app.get(url+'/:id/excel',{preHandler:permission},async(req,reply)=>{
   const doc=await archiveForOutput(pool,req);
   return Excel.send(reply,doc,await Excel.workbook(doc.snapshot));
  });
 }
}

module.exports={register,allowed,totals};
