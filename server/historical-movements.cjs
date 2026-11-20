'use strict';
const B=require('./business-common.cjs');
const Lease=require('./authorization-lease.cjs');
const Backfill=require('./historical-backfill.cjs');

const allowed=(path,method)=>/^\/api\/v1\/cobalt\/historical-movements(?:\/preview|\/operations\/status|\/[0-9a-f-]{36}(?:\/source|\/void)?)?$/.test(path)&&['GET','POST'].includes(method);
const kind=value=>{
 if(!['INBOUND','OUTBOUND'].includes(value))throw B.error(400,'请选择入库或出库');
 return value;
};
const select=`SELECT d.id,d.product_code,d.movement_type,d.document_no,d.business_date::text,d.date_evidence,d.source_name,d.source_sha256,d.source_facts,
 d.imported_at,d.voided_at,d.void_reason,u.display_name imported_by,v.display_name voided_by,b.import_batch_id,
 weights.quantity,weights.net_kg
 FROM historical_movement_documents d JOIN users u ON u.id=d.imported_by LEFT JOIN users v ON v.id=d.voided_by
 LEFT JOIN historical_backfills b ON b.source_id=d.id
 CROSS JOIN LATERAL (SELECT count(*)::int quantity,sum(l.net_kg)::text net_kg
  FROM historical_movement_lines l WHERE l.document_id=d.id) weights`;

async function transaction(pool,req,fn){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await Lease.lockBusiness(c,req);const result=await fn(c);Lease.healthy(req);
  await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

async function voidSources(c,req,ids,expectedProduct=null){
 const reason=B.text(req.body?.reason,'纠错原因',500);
 if(reason.length<5)throw B.error(400,'纠错原因至少需要五个字符');
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 const {rows}=await c.query(`SELECT id,product_code,voided_at,voided_by,void_reason
  FROM historical_movement_documents WHERE id=ANY($1::uuid[]) AND ($2::text IS NULL OR product_code=$2)
  ORDER BY id FOR UPDATE`,[ids,expectedProduct]);
 if(rows.length!==ids.length)throw B.error(404,'历史台账单据不存在');
 if(rows.some(row=>row.voided_at&&(row.voided_by!==req.user.id||row.void_reason!==reason)))throw B.error(409,'此台账单据已作废');
 const active=rows.filter(row=>!row.voided_at);
 if(active.length){
  const targets=active.map(row=>row.id);
  await c.query('UPDATE historical_movement_documents SET voided_at=clock_timestamp(),voided_by=$2,void_reason=$3 WHERE id=ANY($1::uuid[])',[targets,req.user.id,reason]);
  await c.query('UPDATE historical_stock_units SET active=false WHERE source_id=ANY($1::uuid[]) AND active',[targets]);
  for(const row of active)await B.audit(c,req,'historical_movement_voided','historical_movement_documents',row.id,null,{product_code:row.product_code,reason});
 }
 return {count:rows.length,products:[...new Set(rows.map(row=>row.product_code))]};
}

function administrator(auth){
 return async req=>{await auth(req);if(!require('./management-security.cjs').isAdmin(req.user))throw B.error(403,'仅系统管理员可办理历史出入库导入');};
}

function register({app,pool,auth,csrf}){
 const admin=administrator(auth);
 Backfill.registerBatch(app,pool,admin,csrf,transaction);
 Backfill.registerRead(app,pool,auth);
 app.post('/api/v1/historical-movements/batch/void',{preHandler:[admin,csrf]},req=>{
  const ids=req.body?.ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>25)throw B.error(400,'请选择 1 至 25 份历史单据');
  const unique=new Set(ids.map(id=>B.uuid(id).toLowerCase()));
  if(unique.size!==ids.length)throw B.error(400,'选择的历史单据有重复');
  return transaction(pool,req,c=>voidSources(c,req,[...unique]));
 });
 for(const prefix of ['/api/v1/historical-movements','/api/v1/cobalt/historical-movements']){
  const read={preHandler:admin},write={preHandler:[admin,csrf]};
  const product=req=>{
   const code=req.headers['x-historical-product']||req.productCode;
   if(!['CU_CATHODE','CO_HYDROXIDE'].includes(code)||prefix.includes('/cobalt/')&&code!=='CO_HYDROXIDE')throw B.error(400,'产品类型无效');
   return code;
  };
  const access=async(req,c=pool)=>{
   const {rows:[row]}=await c.query(select+' WHERE d.id=$1 AND d.product_code=$2',[B.uuid(req.params.id),product(req)]);
   if(!row)throw B.error(404,'历史台账单据不存在');return row;
  };
  app.get(prefix,read,async req=>{
   const q=req.query,page=Number(q.page||1),size=Number(q.page_size||25);
   if(!Number.isSafeInteger(page)||page<1||page>10000)throw B.error(400,'页码无效');
   if(![10,25,50,100].includes(size))throw B.error(400,'每页行数无效');
   const type=q.movement_type?kind(q.movement_type):null,from=q.from?B.date(q.from):null,to=q.to?B.date(q.to):null;
   const businessDate=q.business_date?B.date(q.business_date):null;
   const keyword=(value,label)=>typeof value==='string'&&!value.trim()||value===undefined?null:B.text(value,label,160);
   const batch=keyword(q.batch_no,'批次号'),document=keyword(q.document_no,'装箱单号');
   if(from&&to&&from>to)throw B.error(400,'开始日期不得晚于截止日期');
   const state=q.state||null;
   if(state&&!['ACTIVE','VOIDED'].includes(state))throw B.error(400,'历史单据状态无效');
   const where=` WHERE d.product_code=$1 AND ($2::text IS NULL OR d.movement_type=$2)
    AND ($3::date IS NULL OR d.business_date>=$3) AND ($4::date IS NULL OR d.business_date<=$4)
    AND ($5::text IS NULL OR (d.voided_at IS NOT NULL)=($5='VOIDED'))
    AND ($6::date IS NULL OR d.business_date=$6)
    AND ($7::text IS NULL OR strpos(lower(d.source_facts->>'batch_no'),lower($7))>0)
    AND ($8::text IS NULL OR strpos(lower(d.document_no),lower($8))>0)`;
   const values=[product(req),type,from,to,state,businessDate,batch,document];
   const all=req.query.all_products==='1';
   const matching=all?where.replace('d.product_code=$1','$1::text IS NOT NULL'):where;
   const {rows:[result]}=await pool.query(`WITH filtered AS MATERIALIZED (
    SELECT d.id,d.imported_at FROM historical_movement_documents d ${matching}
   ), page_ids AS (
    SELECT id FROM filtered ORDER BY imported_at DESC,id LIMIT $9 OFFSET $10
   ), page_rows AS (
    ${select} JOIN page_ids ids ON ids.id=d.id
   )
   SELECT (SELECT count(*)::int FROM filtered) total,
    coalesce((SELECT jsonb_agg(r ORDER BY r.imported_at DESC,r.id) FROM page_rows r),'[]') items`,
    [...values,size,(page-1)*size]);
   return {...result,page,page_size:size,has_next:page*size<result.total};
  });
  app.get(prefix+'/:id',read,async req=>{
   const row=await access(req);
   const {rows}=await pool.query(`SELECT source_row,unit_id,seal_no,sheets_count,net_kg::text,gross_kg::text
    FROM historical_movement_lines WHERE document_id=$1 ORDER BY source_row`,[row.id]);
   const {rows:[review]}=await pool.query(`SELECT after_data->'exception_review' exception_review
    FROM audit_logs WHERE entity_type='historical_movement_documents' AND entity_id=$1 AND action='historical_backfill_imported'
    ORDER BY id DESC LIMIT 1`,[row.id]);
   const exception_review=review?.exception_review??null;
   const sourceRows=new Map(rows.map(line=>[line.source_row,line]));
   for(const line of exception_review?.rows||[])sourceRows.set(line.source_row,line);
   return {...row,rows:[...sourceRows.values()].sort((a,b)=>a.source_row-b.source_row),exception_review,
    documents:row.import_batch_id&&!row.voided_at?await Backfill.related(pool,row.id):[]};
  });
  app.get(prefix+'/:id/source',read,async(req,reply)=>{
   const row=await access(req);
   const {rows:[source]}=await pool.query('SELECT source_data FROM historical_movement_documents WHERE id=$1',[row.id]);
   return reply.header('Cache-Control','no-store').header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(row.source_name))
    .type('application/octet-stream').send(source.source_data);
  });
  app.get(prefix+'/operations/status',read,async req=>{
   const {method,path,key}=req.query;
   if(method!=='POST'||path!==prefix.slice('/api/v1'.length)||typeof key!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(key))throw B.error(400,'操作查询参数无效');
   const {rows:[row]}=await pool.query('SELECT response FROM idempotency_requests WHERE actor_id=$1 AND route=$2 AND key=$3',[req.user.id,'POST '+prefix,key]);
   return {committed:!!row,entity_id:row?.response.id??null};
  });
  for(const endpoint of [prefix,prefix+'/preview'])app.post(endpoint,write,()=>{
   throw B.error(410,'请使用批量装箱单导入');
  });
  app.post(prefix+'/:id/void',write,req=>transaction(pool,req,async c=>{
   const id=B.uuid(req.params.id).toLowerCase();
   await voidSources(c,req,[id],product(req));
   return {id};
  }));
 }
}
module.exports={allowed,register,administrator};
