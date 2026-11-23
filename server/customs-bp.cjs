'use strict';

const B=require('./business-common.cjs'),C=require('./cobalt.cjs'),S=require('./export-shipping.cjs');
const crypto=require('node:crypto'),T=require('../dist/tonnes.js');
const E=require('./customs-bp-print.cjs');
const CO='CO_HYDROXIDE';
const cuUrl='/api/v1/customs/bp',coUrl='/api/v1/cobalt/customs/bp';
const allowed=(path,method)=>method==='GET'&&path==='/api/v1/cobalt/customs/packing-list'||method==='GET'&&/^\/api\/v1\/cobalt\/customs\/bp(?:\/operations\/status|\/[0-9a-f-]{36}\/print)?$/i.test(path)||
 method==='POST'&&/^\/api\/v1\/cobalt\/customs\/bp(?:\/(?:preview|print\/preview))?$/.test(path);
const clearanceScope=`NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.source_context) f WHERE NOT EXISTS(
 SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=(f->>'project_id')::uuid
 AND(s.customer_id IS NULL OR s.customer_id=(f->>'customer_id')::uuid)
 AND(s.warehouse_id IS NULL OR s.warehouse_id=(f->>'warehouse_id')::uuid)))`;
const contractScope=alias=>`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=${alias}.project_id
 AND (s.customer_id IS NULL OR s.customer_id=${alias}.customer_id) AND (s.warehouse_id IS NULL OR s.warehouse_id=${alias}.warehouse_id))`;
const coSql=`SELECT l.id,l.code,l.version,d.version plan_version,e.version execution_version,sp.project_id,sp.warehouse_id,
 sp.customer_id,c.name customer,COALESCE(NULLIF(l.plan_snapshot->>'preparation_batch_no',''),p.preparation_batch_no) batch,
 d.planned_load_date::text loading_date,e.logistics_at approved_at,e.state,
 COALESCE(NULLIF(d.transporter,''),l.transport_snapshot->>'transporter') transporter,
 l.transport_snapshot->>'truck_no' truck,l.transport_snapshot->>'trailer_one' trailer_one,l.transport_snapshot->>'trailer_two' trailer_two,
 l.transport_snapshot->>'container_no' container,l.transport_snapshot->>'driver_name' driver,l.transport_snapshot->>'passport_no' passport,
 d.destination,d.export_license_no license,l.bag_count quantity,
 round(l.actual_net_kg/1000,6)::text net_mt,round(l.actual_gross_kg/1000,6)::text gross_mt,
 to_jsonb(ARRAY[sp.warehouse_id]) warehouses
 FROM co_loading_orders l JOIN co_loading_plans d ON d.id=l.plan_id
 JOIN co_sales_plans sp ON sp.id=l.sales_plan_id JOIN co_customer_profiles c ON c.id=sp.customer_id
 JOIN co_preparations p ON p.id=l.preparation_id JOIN co_load_executions e ON e.order_id=l.id
 WHERE l.status<>'CANCELLED' AND e.logistics_by IS NOT NULL AND e.logistics_at IS NOT NULL
 AND e.state IN('LOGISTICS_APPROVED','OUTBOUND') AND ${contractScope('sp')}`;
const cuSql=`SELECT l.id,l.code,l.version,d.version plan_version,NULL::integer execution_version,l.project_id,l.customer_id,
 c.name customer,x.batch,coalesce(d.planned_load_date,(l.loaded_at AT TIME ZONE 'Africa/Lubumbashi')::date)::text loading_date,
 l.logistics_review_at approved_at,l.workflow_state state,
 coalesce(nullif(d.transporter,''),nullif(t.fields->>'forwarder',''),l.carrier) transporter,
 coalesce(nullif(l.vehicle_no,''),d.vehicle_no,t.fields->>'vehicle_no') truck,
 coalesce(nullif(a.trailer_one,''),t.fields->>'trailer_one') trailer_one,
 coalesce(nullif(a.trailer_two,''),t.fields->>'trailer_two') trailer_two,
 coalesce(nullif(a.container_no,''),t.fields->>'container_no') container,
 coalesce(nullif(a.driver_name,''),t.fields->>'driver_name') driver,
 coalesce(nullif(a.passport_no,''),t.fields->>'passport_no') passport,
 coalesce(nullif(d.destination,''),t.fields->>'destination') destination,
 coalesce(nullif(d.export_license_no,''),t.fields->>'eb_license') license,
 x.quantity,x.net_mt,x.gross_mt,to_jsonb(x.warehouses) warehouses
 FROM loading_orders l JOIN copper_customers c ON c.id=l.customer_id
 LEFT JOIN loading_plan_matches m ON m.loading_id=l.id LEFT JOIN loading_plan_documents d ON d.id=m.document_id
 LEFT JOIN vehicle_arrivals a ON a.id=d.arrival_id LEFT JOIN export_transport t ON t.loading_id=l.id
 CROSS JOIN LATERAL (
  SELECT string_agg(DISTINCT lot.lot_no,' / ' ORDER BY lot.lot_no) batch,count(*)::int quantity,
   CASE WHEN bool_and(i.original_weight IS NOT NULL) THEN sum(i.original_weight)::text END net_mt,
   CASE WHEN bool_and(coalesce(ai.gross_weight,b.gross_weight) IS NOT NULL) THEN sum(coalesce(ai.gross_weight,b.gross_weight))::text END gross_mt,
   array_agg(DISTINCT loc.warehouse_id ORDER BY loc.warehouse_id) warehouses
  FROM loading_items i JOIN reservations r ON r.id=i.reservation_id
  JOIN bundles b ON b.id=i.bundle_id JOIN allocations lot ON lot.id=r.allocation_id
  JOIN locations loc ON loc.id=i.original_location_id
  LEFT JOIN allocation_items ai ON ai.allocation_id=lot.id AND ai.bundle_id=b.id
  WHERE i.loading_id=l.id AND NOT i.plan_removed
 ) x
 WHERE l.logistics_review_by IS NOT NULL AND l.logistics_review_at IS NOT NULL
 AND x.quantity>0 AND (l.workflow_state='OUTBOUND' AND (${S.posted}) OR l.workflow_state='DEPARTED_PENDING' AND l.status NOT IN('CANCELLED','REVERSED'))
 AND NOT EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=l.id
  AND (cr.status IN('REQUESTED','AUTHORIZED','RETURN_VERIFIED') OR cr.kind='RETURN_OUTBOUND' AND cr.status='APPLIED')) AND ${S.scope}`;
const rowFields={batch:160,truck:80,trailer_one:80,trailer_two:80,container:80,transporter:160,driver:160,passport:80,quantity:8,net_mt:32,gross_mt:32};
const headerFields={issuer:180,address:360,rccm:120,id_nat:120,nif:120,contact:360,customer:1000,product:120,mode:60,
 destination:1000,border:120,agency:1000,license:1000,loading_point:360,loading_date:160,signature_date:80};
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
function defaultHeader(rows,co){
 return {issuer:'RUASHI MINING SAS',address:'Musonoi Project site, Kolwezi, Lualaba Province, Democratic Republic of Congo',
  rccm:'',id_nat:'',nif:'',contact:'',customer:join(rows,'customer'),
  product:co?'HYDROXYDE DE COBALT':'CATHODE DE CUIVRE',mode:'ROAD',destination:join(rows,'destination'),
  border:'',agency:'',license:join(rows,'license'),loading_point:'RUASHI MINING MUSONOI PLANT',
  loading_date:join(rows,'loading_date'),signature_date:date()};
}
async function list(c,req){
 const co=req.productCode===CO,q=req.query||{},search=text(q.search||'',160),page=Number(q.page||1),size=30;
 if(!Number.isInteger(page)||page<1||page>100000)throw B.error(400,'BP_INVALID_FIELD');
 const {rows:[result]}=await c.query(`WITH eligible AS MATERIALIZED (
  SELECT *,COALESCE(NULLIF(batch,''),id::text) batch_key FROM (${coords(co)}) candidates
 ), matching_keys AS (
  SELECT DISTINCT batch_key FROM eligible WHERE ($2='' OR strpos(lower(concat_ws(' ',batch,code,customer,truck)),lower($2))>0)
 ), grouped AS (
  SELECT e.batch_key,max(e.batch) batch,string_agg(DISTINCT e.customer,' / ' ORDER BY e.customer) customer,
   string_agg(DISTINCT e.truck,' / ' ORDER BY e.truck) truck,max(e.approved_at) approved_at,array_agg(e.id ORDER BY e.id) source_ids
  FROM eligible e JOIN matching_keys USING(batch_key) GROUP BY e.batch_key
 ) SELECT (SELECT count(*)::int FROM grouped) total,
 coalesce((SELECT jsonb_agg(f) FROM (SELECT * FROM grouped ORDER BY approved_at DESC,batch_key LIMIT $3 OFFSET $4) f),'[]') items`,
 [req.user.id,search,size,(page-1)*size]);
 const {rows:documents}=await c.query(`SELECT d.id,d.document_no,d.created_at,cardinality(d.source_ids) vehicle_count
  FROM customs_bp_documents d WHERE d.product_code=$2 AND ${clearanceScope} ORDER BY d.created_at DESC,d.id LIMIT 30`,[req.user.id,req.productCode]);
 return {...result,documents,page,page_size:size};
}
function selection(body){
 if(!Array.isArray(body?.ids)||body.ids.length<1||body.ids.length>200)throw B.error(400,'BP_SELECTION_REQUIRED');
 const ids=body.ids.map(v=>B.uuid(v).toLowerCase()).sort();
 if(new Set(ids).size!==ids.length)throw B.error(400,'BP_SELECTION_REQUIRED');
 return ids;
}
async function chosen(c,req,ids){
 const co=req.productCode===CO;
 const {rows}=await c.query(`SELECT * FROM (${coords(co)}) eligible WHERE id=ANY($2::uuid[]) ORDER BY id`,[req.user.id,ids]);
 if(rows.length!==ids.length)throw B.error(409,'BP_SOURCE_CHANGED');
 // Source signatures include every business field and the latest approval version.
 return {token:hash(rows),rows,header:defaultHeader(rows,co),data:rows.map(row=>fieldMap(rowFieldsFrom(row),rowFields))};
}
const rowFieldsFrom=row=>Object.fromEntries(Object.keys(rowFields).map(k=>[k,row[k]??'']));
const draftFields={ids:0,token:0,number:0,header:0,rows:0};

function draft(body,source){
 if(body.token!==source.token)throw B.error(409,'BP_SOURCE_CHANGED');
 if(!Array.isArray(body.rows)||body.rows.length!==source.rows.length)throw B.error(400,'BP_INVALID_FIELD');
 const rows=body.rows.map(row=>fieldMap(row,rowFields)),header=fieldMap(body.header,headerFields);
 if(rows.some(row=>!row.batch||!row.truck)||!header.issuer||!header.customer||!header.product)throw B.error(400,'BP_REQUIRED_DETAILS');
 return {header,total:totals(rows,true),rows:rows.map((row,i)=>({...row,order_id:source.rows[i].id,code:source.rows[i].code})),
  original:{header:source.header,rows:source.data}};
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
 const snapshot=draft(body,source);
 const number=await documentNumber(c,req.productCode,body.number??'',true);
 snapshot.number=number;
 const context=scopeFor(source.rows);
 let doc;
 try{doc=(await c.query(`INSERT INTO customs_bp_documents(product_code,document_no,source_ids,source_context,snapshot,created_by)
  VALUES($1,$2,$3,$4,$5,$6) RETURNING id,document_no`,[req.productCode,number,ids,JSON.stringify(context),snapshot,req.user.id])).rows[0];}
 catch(err){if(err.code==='23505')throw B.error(409,'BP_NUMBER_IN_USE');throw err;}
 for(const row of source.rows)await B.audit(c,req,'customs_bp_generated',req.productCode===CO?'co_loading_orders':'loading_orders',row.id,null,{
  bp_id:doc.id,document_no:number,product_code:req.productCode,project_id:row.project_id,customer_id:row.customer_id,
  warehouse_id:row.warehouses.length===1?row.warehouses[0]:null
 });
 return doc;
}

function register({app,pool,permitted,csrf}){
 for(const url of [cuUrl,coUrl]){
  const permission=permitted('customs:bp');
  const co=url===coUrl;
  app.get(url.replace(/bp$/,'packing-list'),{preHandler:permitted('load:read')},req=>C.readTransaction(pool,c=>co?
   require('./cobalt-overview.cjs').operations(c,{...req,query:{...req.query,state:'OUTBOUND'}}):S.list(c,req,true,true)));
  app.get(url,{preHandler:permission},req=>C.readTransaction(pool,c=>list(c,req)));
  app.post(url+'/preview',{preHandler:[permission,csrf]},req=>C.readTransaction(pool,async c=>{
   const source=await chosen(c,req,selection(req.body));
   return {header:source.header,rows:source.data.map((row,i)=>({...row,id:source.rows[i].id,code:source.rows[i].code})),
    token:source.token,number:await documentNumber(c,req.productCode)};
  }));
  app.post(url+'/print/preview',{preHandler:[permission,csrf]},req=>C.readTransaction(pool,async c=>{
   const body=req.body;keys(body,draftFields);
   const snapshot=draft(body,await chosen(c,req,selection(body)));
   snapshot.number=await documentNumber(c,req.productCode,body.number??'');
   return {number:snapshot.number,content:E.content(snapshot)};
  }));
  app.post(url,{preHandler:[permission,csrf]},req=>B.mutate(pool,req,c=>save(c,req)));
  app.get(url+'/operations/status',{preHandler:permission},async req=>{
   const {method,path,key}=req.query;
   if(method!=='POST'||path!==url.slice('/api/v1'.length)||typeof key!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(key))throw B.error(400,'BP_INVALID_FIELD');
   const result=await pool.query(`SELECT 1 FROM idempotency_requests r JOIN customs_bp_documents d ON d.id=(r.response->>'id')::uuid
    WHERE r.actor_id=$1 AND r.route=$2 AND r.key=$3 AND d.product_code=$4 AND ${clearanceScope}`,[req.user.id,method+' '+url,key,req.productCode]);
   return {committed:result.rowCount===1};
  });
  app.get(url+'/:id/print',{preHandler:permission},async(req,reply)=>{
   const doc=(await pool.query(`SELECT d.snapshot FROM customs_bp_documents d
    WHERE d.product_code=$2 AND d.id=$3 AND ${clearanceScope}`,[req.user.id,req.productCode,B.uuid(req.params.id)])).rows[0];
   if(!doc)throw B.error(404,'BP_NOT_FOUND');
   return reply.type('text/html; charset=utf-8').send(E.html(doc.snapshot,req.query.print==='1'));
  });
 }
}

module.exports={register,allowed,totals};
