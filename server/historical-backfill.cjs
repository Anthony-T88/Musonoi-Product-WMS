'use strict';
const B=require('./business-common.cjs');
const Packing=require('./historical-packing.cjs');
const {randomUUID}=require('node:crypto');

const products=['CU_CATHODE','CO_HYDROXIDE'];
const docKinds={receipts:'RECEIPT','loading-plans':'LOADING_PLAN',outbounds:'LOADING_ORDER','stock-outbound':'OUTBOUND'};
const permissions={
 CU_CATHODE:{RECEIPT:'receipt:read',LOADING_PLAN:'loading-plan:read',LOADING_ORDER:'load:read',OUTBOUND:'load:read',stock:'inventory:read'},
 CO_HYDROXIDE:{RECEIPT:'co:read',LOADING_PLAN:'loading-plan:read',LOADING_ORDER:'load:read',OUTBOUND:'load:read',stock:'co:read'}
};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const scope=(a='b')=>`EXISTS (SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=${a}.project_id
 AND (s.warehouse_id IS NULL OR s.warehouse_id=${a}.warehouse_id)
 AND (s.customer_id IS NULL OR s.customer_id=${a}.customer_id))`;
const bad=(code,message,status=400)=>Object.assign(B.error(status,message),{code});
const allowed=(path,method)=>method==='GET'&&/^\/api\/v1\/cobalt\/historical-backfill\/(?:documents(?:\/[0-9a-f-]{36})?|stock\/batch\/[0-9a-f-]{36})$/.test(path);
const factsOf=({rows,document_no,document_key,errors,...facts})=>facts;

async function destinations(c,req){
 return (await c.query(`SELECT w.id,w.name,w.code,p.name project_name FROM warehouses w JOIN projects p ON p.id=w.project_id
 WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=w.project_id AND s.customer_id IS NULL
  AND (s.warehouse_id IS NULL OR s.warehouse_id=w.id)) ORDER BY p.code,w.code`,[req.user.id])).rows;
}

async function destination(c,req,id,facts){
 const {rows:[warehouse]}=await c.query('SELECT id,project_id FROM warehouses WHERE id=$1',[B.uuid(id)]);
 if(!warehouse||!(await destinations(c,req)).some(row=>row.id===id.toLowerCase()))throw bad('HISTORY_SCOPE','导入仓库不在授权范围内',403);
 const {rows:customers}=await c.query(`SELECT id FROM customers WHERE project_id=$1 AND product_code=$2
  AND (historical_unit_key(name)=$3 OR historical_unit_key(code)=$3)`,[warehouse.project_id,facts.product_code,Packing.key(facts.customer)]);
 return {...warehouse,customer_id:customers.length===1?customers[0].id:null};
}

function compareLines(existing,proposed,{seal=true}={}){
 if(existing.length!==proposed.length)return false;
 const units=new Map(existing.map(row=>[Packing.unitKey(row.unit_id),row]));
 return proposed.every(row=>{
  const found=units.get(row.unit_key);
  return found&&Number(found.net_kg)===Number(row.net_kg)&&Number(found.gross_kg)===Number(row.gross_kg)
   &&found.sheets_count===row.sheets_count&&(!seal||Packing.key(found.seal_no)===Packing.key(row.seal_no));
 });
}

async function review(c,req,body){
 const file=Packing.source(body),facts=Packing.parse(null,file);
 const site=await destination(c,req,body.warehouse_id,facts);
 const product=facts.product_code,day=facts.shipping_date,issues=[...facts.errors];
 const keys=facts.rows.map(row=>row.unit_key).filter(Boolean);
 if(facts.shipping_issue)issues.push(facts.shipping_issue);
 if(day&&day>today())issues.push('SHIPPING_DATE_INVALID');
 const original=facts.actual_dates.INBOUND?.day||null;
 if(original&&day&&original>day)issues.push('RECEIPT_AFTER_SHIPPING');
 const {rows:ledger}=await c.query(`SELECT m.id,m.document_key,m.document_no,m.source_facts,m.movement_type,m.business_date::text,m.source_sha256,
  b.source_id backfill,b.warehouse_id,
  ARRAY(SELECT historical_stock_key(l.unit_id) FROM historical_movement_lines l WHERE l.document_id=m.id AND historical_stock_key(l.unit_id)=ANY($3::text[])) matching_units
  FROM historical_movement_documents m LEFT JOIN historical_backfills b ON b.source_id=m.id
  WHERE m.product_code=$1 AND m.voided_at IS NULL AND (m.document_key=$2 OR EXISTS
   (SELECT 1 FROM historical_movement_lines l WHERE l.document_id=m.id AND historical_stock_key(l.unit_id)=ANY($3::text[]))) ORDER BY m.id`,[product,facts.document_key,keys]);
 const legacyOutbound=ledger.find(row=>row.movement_type==='OUTBOUND'&&row.document_key===facts.document_key);
 const priorLines=id=>c.query('SELECT * FROM historical_movement_lines WHERE document_id=$1 ORDER BY source_row',[id]).then(result=>result.rows);
 let already=null,reuse=null,receipt=null;
 if(legacyOutbound){
  const same=legacyOutbound.source_sha256===file.sha256&&Packing.key(legacyOutbound.source_facts.batch_no)===Packing.key(facts.batch_no)&&
   compareLines(await priorLines(legacyOutbound.id),facts.rows);
  if(same&&legacyOutbound.business_date===day&&(!legacyOutbound.backfill||legacyOutbound.warehouse_id===site.id)){
   if(legacyOutbound.backfill)already=legacyOutbound.id;else reuse=legacyOutbound.id;
  }else issues.push('DOCUMENT_CONFLICT');
 }
 const inbound=ledger.filter(row=>row.movement_type==='INBOUND');
 if(inbound.length===1){
  const candidate=inbound[0];
  if(day&&candidate.business_date<=day&&(!original||candidate.business_date===original)&&
     Packing.key(candidate.source_facts.batch_no)===Packing.key(facts.batch_no)&&compareLines(await priorLines(candidate.id),facts.rows,{seal:false}))receipt=candidate;
 }
 const onlineQuery=product==='CO_HYDROXIDE'?
  `SELECT historical_stock_key(b.bag_no) unit_key,p.document_no reference FROM co_bags b
   JOIN co_preparations p ON p.id=b.preparation_id WHERE historical_stock_key(b.bag_no)=ANY($1::text[])`:
  `SELECT historical_stock_key(b.bundle_no) unit_key,coalesce(v.outbound_code,v.receipt_code,b.bundle_no) reference
   FROM bundles b LEFT JOIN inventory_view v ON v.uuid=b.id WHERE historical_stock_key(b.bundle_no)=ANY($1::text[])
   UNION SELECT k.unit_key,r.number_key FROM unnest($1::text[]) k(unit_key)
    JOIN bundle_number_registry r ON r.number_key=v265_bundle_key(k.unit_key)`;
 const {rows:online}=await c.query(onlineQuery,[keys]);
 const {rows:existingDocs}=await c.query(product==='CO_HYDROXIDE'?
  `SELECT document_no reference FROM co_packing_documents WHERE historical_unit_key(document_no)=$1
   UNION SELECT code FROM co_loading_plans WHERE historical_unit_key(packing_list_no)=$1 AND status<>'CANCELLED'`:
  `SELECT document_no reference FROM packing_list_documents WHERE historical_unit_key(document_no)=$1
   UNION SELECT code FROM loading_plan_documents WHERE historical_unit_key(packing_list_no)=$1 AND cancelled_at IS NULL`,[facts.document_key]);
 if(existingDocs.length)issues.push('FORMAL_DOCUMENT_CONFLICT');
 const references=new Map();
 const addReference=(key,reference)=>{
  if(!references.has(key))references.set(key,new Set());
  references.get(key).add(reference);
 };
 for(const match of online)addReference(match.unit_key,match.reference);
 for(const other of ledger){
  if([already,reuse,receipt?.id].includes(other.id))continue;
  for(const key of other.matching_units)addReference(key,other.document_no);
 }
 const rows=facts.rows.map(row=>{
  const conflicts=[...(references.get(row.unit_key)||[])].sort();
  return {...row,conflicts,flags:row.flags.concat(conflicts.length?'UNIT_CONFLICT':[])};
 });
 const originalDate=original||receipt?.business_date||null;
 const receiptId=receipt?.id||null;
 const token=Packing.digest(JSON.stringify([file.sha256,product,day,site.id,site.customer_id,issues,existingDocs.map(row=>row.reference).sort(),
  already,reuse,originalDate,receiptId,rows.map(row=>[row.unit_key,row.flags,row.conflicts])]));
 return {file,facts,site,reuse,receiptId,originalDate,preview:{...facts,rows,issues,conflicting_documents:existingDocs.map(row=>row.reference),
  business_date:day,original_receipt_date:originalDate,already_imported:already,
  importable:!already&&!issues.length&&rows.every(row=>!row.flags.length),preview_token:token}};
}

async function confirm(c,req,body,batch){
 // Protect the conflict review and all generated facts until this file commits.
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 const {file,facts,site,reuse,receiptId,originalDate,preview}=await review(c,req,body);
 if(preview.already_imported)return {status:'ALREADY_IMPORTED',id:preview.already_imported};
 if(!preview.importable||preview.preview_token!==body.preview_token)return {status:'FAILED',code:'REVIEW_REQUIRED',issues:preview.issues,rows:preview.rows.filter(row=>row.flags.length)};
 const day=preview.business_date,product=facts.product_code;
 const id=reuse||(await c.query(`INSERT INTO historical_movement_documents(product_code,movement_type,document_no,document_key,business_date,
  date_evidence,source_name,source_sha256,source_data,source_facts,imported_by) VALUES($1,'OUTBOUND',$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
 [product,facts.document_no,facts.document_key,day,'Shipping date from '+facts.shipping_cell,file.name,file.sha256,file.data,factsOf(facts),req.user.id])).rows[0].id;
 if(!reuse)await c.query(`INSERT INTO historical_movement_lines(document_id,source_row,unit_id,unit_key,seal_no,sheets_count,net_kg,gross_kg)
  SELECT $1,source_row,unit_id,unit_key,seal_no,sheets_count,net_kg,gross_kg FROM jsonb_to_recordset($2)
  AS x(source_row integer,unit_id text,unit_key text,seal_no text,sheets_count integer,net_kg numeric,gross_kg numeric)`,[id,JSON.stringify(facts.rows)]);
 await c.query('INSERT INTO historical_backfills(source_id,import_batch_id,project_id,warehouse_id,customer_id,original_receipt_date,receipt_source_id,backfilled_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [id,batch,site.project_id,site.id,site.customer_id,originalDate,receiptId,req.user.id]);
 await c.query(`INSERT INTO historical_business_documents(source_id,kind,document_no,business_date)
  VALUES ($1,'RECEIPT',$2,$3),($1,'LOADING_PLAN',$4,$5),($1,'LOADING_ORDER',$6,$5),($1,'OUTBOUND',$7,$5)`,
 [id,'HIST-IN-'+facts.document_no,originalDate||day,'HIST-LP-'+facts.document_no,day,'HIST-LOAD-'+facts.document_no,'HIST-OUT-'+facts.document_no]);
 await c.query(`INSERT INTO historical_stock_units(source_id,source_row,product_code,unit_key)
  SELECT document_id,source_row,$2,historical_stock_key(unit_id) FROM historical_movement_lines WHERE document_id=$1`,[id,product]);
 await B.audit(c,req,'historical_backfill_imported','historical_movement_documents',id,null,
  {product_code:product,project_id:site.project_id,warehouse_id:site.id,customer_id:site.customer_id,import_batch_id:batch,
   shipping_date:day,original_receipt_date:originalDate,quantity:facts.rows.length,source_sha256:file.sha256});
 return {status:'IMPORTED',id,import_batch_id:batch};
}

function registerBatch(app,pool,admin,csrf,transaction){
 const base='/api/v1/historical-movements';
 app.get(base+'/destinations',{preHandler:admin},req=>destinations(pool,req));
 for(const action of ['preview','confirm'])app.post(base+'/batch/'+action,{preHandler:[admin,csrf],bodyLimit:15*1024*1024},async req=>{
  const files=req.body?.files;
  if(!Array.isArray(files)||!files.length||files.length>20)throw bad('HISTORY_FILE_LIMIT','每批请选择 1 至 20 份装箱单');
  const batch=randomUUID(),results=[];
  for(const [index,entry] of files.entries()){
   const file=entry&&typeof entry==='object'&&!Array.isArray(entry)?entry:{};
   try{
    const result=action==='preview'?(await review(pool,req,file)).preview:await transaction(pool,req,c=>confirm(c,req,file,batch));
    results.push({index,...result});
   }catch(error){
    if(!error.statusCode&&!['23505','23514'].includes(error.code))require('./service-errors.cjs').report(error,req);
    results.push({index,status:'FAILED',code:error.statusCode?(error.code||'INVALID_WORKBOOK'):action==='preview'?'PREVIEW_FAILED':'IMPORT_WRITE_FAILED',
     error:error.statusCode&&error.statusCode<500?error.message:undefined});
   }
  }
  return {import_batch_id:action==='confirm'?batch:null,results};
 });
}

const documentSelect=`SELECT d.id,d.kind,d.document_no,d.business_date::text,d.event_order,d.source_id,
 m.document_no packing_list_no,m.product_code,m.business_date::text shipping_date,m.source_name,m.source_facts,
 b.original_receipt_date::text,b.import_batch_id,w.name warehouse_name,u.display_name imported_by,b.backfilled_at imported_at,
 (SELECT jsonb_build_object('id',o.id,'document_no',o.document_no) FROM historical_business_documents o WHERE o.source_id=d.source_id AND o.kind='OUTBOUND') outbound_document,
 (SELECT count(*)::int FROM historical_movement_lines l WHERE l.document_id=m.id) quantity,
 (SELECT sum(l.net_kg)::text FROM historical_movement_lines l WHERE l.document_id=m.id) net_kg
 FROM historical_business_documents d JOIN historical_backfills b ON b.source_id=d.source_id
 JOIN historical_movement_documents m ON m.id=b.source_id AND m.voided_at IS NULL
 JOIN users u ON u.id=b.backfilled_by JOIN warehouses w ON w.id=b.warehouse_id`;
const related=(c,id)=>c.query(`SELECT id,kind,document_no,business_date::text,event_order FROM historical_business_documents
 WHERE source_id=$1 ORDER BY event_order`,[id]).then(result=>result.rows);
const lines=(c,id,query='',unitId=null)=>c.query(`SELECT id,source_row,unit_id,seal_no,sheets_count,net_kg::text,gross_kg::text
 FROM historical_outbound_units WHERE source_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ($3='' OR
 strpos(lower(unit_id),lower($3))>0 OR strpos(lower(coalesce(seal_no,'')),lower($3))>0) ORDER BY source_row`,[id,unitId,query]).then(result=>result.rows);

// Row projection for the regular business lists. Keep archival identifiers
// and facts separate from records that participate in live workflows.
function listSql(kind){
 const facts="m.source_facts";
 return `SELECT d.id,d.document_no AS code,d.document_no,d.business_date,d.business_date::text AS planned_load_day,
  b.backfilled_at created_at,b.project_id,b.warehouse_id,b.customer_id,m.document_no packing_list_no,m.product_code,
  ${facts}->>'batch_no' preparation_batch_no,${facts}->>'batch_no' shipment_batch_no,
  ${facts}->>'customer' customer_name,${facts}->>'contract_no' contract_no,${facts}->>'truck' vehicle_no,
  to_char(m.business_date,'YYYY-MM') shipment_month,true historical_import,
  weight.quantity,weight.net_kg::text,(weight.net_kg/1000)::text net_weight,
  (SELECT o.document_no FROM historical_business_documents o WHERE o.source_id=m.id AND o.kind='OUTBOUND') outbound_code,
  '/${Object.keys(docKinds).find(area=>docKinds[area]===kind)}/historical/'||d.id AS href
 FROM historical_business_documents d JOIN historical_backfills b ON b.source_id=d.source_id
 JOIN historical_movement_documents m ON m.id=b.source_id AND m.voided_at IS NULL
 CROSS JOIN LATERAL(SELECT count(*)::int quantity,sum(l.net_kg) net_kg FROM historical_movement_lines l WHERE l.document_id=m.id) weight
 WHERE ${scope()} AND d.kind='${kind}'`;
}

async function reportShipments(c,req,filters,from,to){
 if(['location_id','yard_id','batch_id','allocated_customer_id','preparation_id','sales_plan_id'].some(key=>filters[key])||
  filters.status&&filters.status!=='OUTBOUND')return [];
 const {rows}=await c.query(`SELECT h.source_id,d.id,h.shipping_date::text date,h.original_receipt_date::text,
   h.packing_list_no document_no,h.customer_id,
   (SELECT k.id FROM co_sales_contracts k WHERE h.product_code='CO_HYDROXIDE' AND k.project_id=h.project_id
    AND k.customer_id=h.customer_id AND k.contract_no=h.source_facts->>'contract_no' ORDER BY k.id LIMIT 1) contract_id,nullif(h.source_facts->>'customer','') customer_name,
   nullif(h.source_facts->>'contract_no','') contract_no,nullif(h.source_facts->>'truck','') vehicle_no,
   h.source_facts->>'trailer_one' trailer_one,h.source_facts->>'trailer_two' trailer_two,
   coalesce(nullif(h.source_facts->>'batch_no',''),nullif(h.source_facts->>'lot_no','')) lot_no,count(*)::int units,
   sum(h.net_kg)::text net_kg,(sum(h.net_kg)/1000)::text net_weight,
   CASE WHEN count(h.gross_kg)=count(*) THEN sum(h.gross_kg)::text END gross_kg
  FROM historical_outbound_units h
  JOIN historical_business_documents d ON d.source_id=h.source_id AND d.kind='LOADING_ORDER'
  WHERE ${scope('h')} AND h.product_code=$2 AND h.shipping_date BETWEEN $3::date AND $4::date
   AND ($5::uuid IS NULL OR h.project_id=$5) AND ($6::uuid IS NULL OR h.warehouse_id=$6)
   AND ($7::uuid IS NULL OR h.customer_id=$7)
   AND ($8='' OR strpos(lower(h.source_facts->>'contract_no'),lower($8))>0)
   AND ($9::uuid IS NULL OR EXISTS(SELECT 1 FROM co_sales_contracts k WHERE k.id=$9
    AND k.customer_id=h.customer_id AND k.contract_no=h.source_facts->>'contract_no'))
  GROUP BY h.source_id,d.id,h.shipping_date,h.original_receipt_date,h.packing_list_no,h.customer_id,h.project_id,h.product_code,h.source_facts
  ORDER BY h.shipping_date,h.packing_list_no LIMIT 10001`,
 [req.user.id,req.productCode,from,to,filters.project_id||null,filters.warehouse_id||null,filters.customer_id||null,
  filters.contract_no||'',filters.contract_id||null]);
 if(rows.length>10000)throw bad('HISTORY_REPORT_LIMIT','报表超过10000行，请缩小范围',413);
 return rows;
}

async function reportMovements(c,req,filters,from,to){
 if(['location_id','yard_id','batch_id','allocated_customer_id'].some(key=>filters[key]))return [];
 const {rows}=await c.query(`SELECT h.unit_id bundle_no,flow.type,flow.weight::text physical_delta,
  flow.day::text confirmed_at,h.packing_list_no document_code FROM historical_outbound_units h
  CROSS JOIN LATERAL(VALUES ('历史导入入库',h.original_receipt_date,h.net_kg/1000),
   ('历史导入出库',h.shipping_date,-h.net_kg/1000)) flow(type,day,weight)
  WHERE ${scope('h')} AND h.product_code=$2 AND flow.day BETWEEN $3::date AND $4::date
   AND ($5::uuid IS NULL OR h.project_id=$5) AND ($6::uuid IS NULL OR h.warehouse_id=$6)
   AND ($7::uuid IS NULL OR h.customer_id=$7) ORDER BY flow.day,h.source_id,h.source_row LIMIT 10001`,
 [req.user.id,req.productCode,from,to,filters.project_id||null,filters.warehouse_id||null,filters.customer_id||null]);
 return rows;
}

function outboundListSql(product,q,bind){
 const conditions=[`m.product_code=${bind(product)}`];
 // The supplied packing list has no status in the live generation workflow.
 if(q.plan_id||q.document_status)conditions.push('false');
 for(const [key,field] of Object.entries({customer:"m.source_facts->>'customer'",vehicle_no:"m.source_facts->>'truck'",
  contract_no:"m.source_facts->>'contract_no'",outbound_no:'m.document_no'})){
  if(q[key])conditions.push(`strpos(lower(${field}),lower(${bind(q[key].trim())}))>0`);
 }
 if(q.search)conditions.push(`strpos(lower(concat_ws(' ',d.document_no,m.document_no,m.source_facts->>'batch_no',m.source_facts->>'customer',m.source_facts->>'contract_no',m.source_facts->>'truck')),lower(${bind(q.search.trim())}))>0`);
 if(q.start)conditions.push(`m.business_date>=${bind(B.date(q.start))}::date`);
 if(q.end)conditions.push(`m.business_date<=${bind(B.date(q.end))}::date`);
 return listSql('LOADING_ORDER')+' AND '+conditions.join(' AND ');
}

async function overview(c,req,chart,filters){
 // Packing lists do not establish an association with these live dimensions.
 if(['yard_id','location_id','batch_id','allocated_customer_id','contract_id','sales_plan_id','preparation_id','status'].some(key=>filters[key]))return null;
 const period=chart.granularity==='month'?'YYYY-MM':'YYYY-MM-DD';
 const {rows:[result]}=await c.query(`WITH documents AS (
  SELECT h.source_id,h.shipping_date,h.original_receipt_date,count(*)::int units,sum(h.net_kg)/1000 net_mt,
   nullif(trim(h.source_facts->>'truck'),'') truck,h.source_facts->>'trailer_one' trailer_one,h.source_facts->>'trailer_two' trailer_two
  FROM historical_outbound_units h WHERE h.product_code=$2 AND ${scope('h')}
   AND ($3::uuid IS NULL OR h.project_id=$3) AND ($4::uuid IS NULL OR h.warehouse_id=$4)
   AND ($5::uuid IS NULL OR h.customer_id=$5)
   AND ($9='' OR strpos(lower(h.source_facts->>'contract_no'),lower($9))>0)
  GROUP BY h.source_id,h.shipping_date,h.original_receipt_date,h.source_facts
 ), flow AS (
  SELECT shipping_date AS movement_date,'OUTBOUND' direction,units,net_mt,
   CASE WHEN truck IS NOT NULL THEN concat_ws('|',shipping_date,upper(truck),upper(coalesce(trailer_one,'')),upper(coalesce(trailer_two,''))) END trip FROM documents
  UNION ALL
  SELECT original_receipt_date,'INBOUND',units,net_mt,NULL FROM documents WHERE original_receipt_date IS NOT NULL
 ), buckets AS (
  SELECT to_char(movement_date,$8) period,direction,count(*)::int documents,sum(units)::int units,sum(net_mt)::text net_mt,count(DISTINCT trip)::int vehicles
  FROM flow WHERE movement_date BETWEEN $6::date AND $7::date GROUP BY 1,2
 ) SELECT (SELECT max(shipping_date)::text FROM documents) latest_shipping_date,
  coalesce((SELECT jsonb_agg(buckets ORDER BY period,direction) FROM buckets),'[]'::jsonb) rows`,
 [req.user.id,req.productCode,filters.project_id||null,filters.warehouse_id||null,filters.customer_id||null,
  chart.from,chart.observed_through<chart.to?chart.observed_through:chart.to,period,filters.contract_no||'']);
 return result.latest_shipping_date?result:null;
}

function permission(req,name){
 if(!req.user.permissions.includes(permissions[req.productCode]?.[name]))throw bad('HISTORY_PERMISSION','当前账号没有此页面权限',403);
}
function authorizePage(auth,area){
 return async req=>{
  await auth(req);
  req.productCode=req.cookies.musonoi_product==='CO_HYDROXIDE'?'CO_HYDROXIDE':'CU_CATHODE';
  permission(req,area==='inventory'?'stock':docKinds[area]);
 };
}

function registerRead(app,pool,auth){
 for(const base of ['/api/v1/historical-backfill','/api/v1/cobalt/historical-backfill']){
  app.get(base+'/documents',{preHandler:auth},async req=>{
   const kind=req.query.kind;
   if(!Object.values(docKinds).includes(kind))throw bad('HISTORY_KIND','历史单据类型无效');
   permission(req,kind);
   const search=req.query.search||'',page=Number(req.query.page||1);
   if(typeof search!=='string'||search.length>160||!Number.isSafeInteger(page)||page<1||page>100000)throw bad('HISTORY_QUERY','查询条件无效');
   const {rows}=await pool.query(documentSelect+` WHERE ${scope()} AND m.product_code=$2 AND d.kind=$3 AND
    ($4='' OR strpos(lower(concat_ws(' ',d.document_no,m.source_facts->>'batch_no',m.source_facts->>'customer',m.source_facts->>'truck',m.source_facts->>'contract_no')),lower($4))>0)
    ORDER BY d.business_date DESC,d.id LIMIT 26 OFFSET $5`,[req.user.id,req.productCode,kind,search,(page-1)*25]);
   return {items:rows.slice(0,25),page,has_next:rows.length>25};
  });
  app.get(base+'/documents/:id',{preHandler:auth},async req=>{
   const kind=req.query.kind;
   if(!Object.values(docKinds).includes(kind))throw bad('HISTORY_KIND','历史单据类型无效');
   permission(req,kind);
   const {rows:[row]}=await pool.query(documentSelect+` WHERE ${scope()} AND m.product_code=$2 AND d.id=$3 AND d.kind=$4`,
    [req.user.id,req.productCode,B.uuid(req.params.id),kind]);
   if(!row)throw bad('HISTORY_NOT_FOUND','历史单据不存在或超出授权范围',404);
   const [units,documents]=await Promise.all([lines(pool,row.source_id),related(pool,row.source_id)]);
   return {...row,rows:units,documents};
  });
  app.get(base+'/stock/batch/:id',{preHandler:auth},async req=>{
   permission(req,'stock');
   const unit=req.query.unit||'';
   if(typeof unit!=='string'||unit.length>160)throw bad('HISTORY_QUERY','查询条件无效');
   const id=B.uuid(req.params.id).toLowerCase();
   const {rows:[row]}=await pool.query(documentSelect+` WHERE ${scope()} AND m.product_code=$2 AND d.kind='OUTBOUND'
    AND (m.id=$3 OR EXISTS(SELECT 1 FROM historical_stock_units x WHERE x.source_id=m.id AND x.id=$3 AND x.active))`,
    [req.user.id,req.productCode,id]);
   if(!row)throw bad('HISTORY_NOT_FOUND','历史库存不存在或超出授权范围',404);
   const [units,documents]=await Promise.all([lines(pool,row.source_id,unit,row.source_id===id?null:id),related(pool,row.source_id)]);
   return {...row,rows:units,documents};
  });
 }
}

module.exports={allowed,docKinds,scope,listSql,outboundListSql,reportShipments,reportMovements,overview,registerBatch,registerRead,related,authorizePage};
