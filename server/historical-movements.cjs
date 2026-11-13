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
 (SELECT count(*)::int FROM historical_movement_lines l WHERE l.document_id=d.id) quantity,
 (SELECT sum(net_kg)::text FROM historical_movement_lines l WHERE l.document_id=d.id) net_kg
 FROM historical_movement_documents d JOIN users u ON u.id=d.imported_by LEFT JOIN users v ON v.id=d.voided_by
 LEFT JOIN historical_backfills b ON b.source_id=d.id`;

async function transaction(pool,req,fn){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await Lease.lockBusiness(c,req);const result=await fn(c);Lease.healthy(req);
  await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

function administrator(auth){
 return async req=>{await auth(req);if(!require('./management-security.cjs').isAdmin(req.user))throw B.error(403,'仅系统管理员可办理历史出入库导入');};
}

function register({app,pool,auth,csrf}){
 const admin=administrator(auth);
 Backfill.registerBatch(app,pool,admin,csrf,transaction);
 Backfill.registerRead(app,pool,auth);
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
   const q=req.query,page=Number(q.page||1);
   if(!Number.isSafeInteger(page)||page<1||page>10000)throw B.error(400,'页码无效');
   const type=q.movement_type?kind(q.movement_type):null,from=q.from?B.date(q.from):null,to=q.to?B.date(q.to):null;
   if(from&&to&&from>to)throw B.error(400,'开始日期不得晚于截止日期');
   const where=' WHERE d.product_code=$1 AND ($2::text IS NULL OR d.movement_type=$2) AND ($3::date IS NULL OR d.business_date>=$3) AND ($4::date IS NULL OR d.business_date<=$4)';
   const values=[product(req),type,from,to];
   const all=req.query.all_products==='1';
   const {rows}=await pool.query(select+where.replace('d.product_code=$1',all?'$1::text IS NOT NULL':'d.product_code=$1')+
    ' ORDER BY d.business_date DESC,d.id LIMIT 26 OFFSET $5',[...values,(page-1)*25]);
   return {items:rows.slice(0,25),page,has_next:rows.length>25};
  });
  app.get(prefix+'/:id',read,async req=>{
   const row=await access(req);
   const {rows}=await pool.query(`SELECT source_row,unit_id,seal_no,sheets_count,net_kg::text,gross_kg::text
    FROM historical_movement_lines WHERE document_id=$1 ORDER BY source_row`,[row.id]);
   return {...row,rows,documents:row.import_batch_id?await Backfill.related(pool,row.id):[]};
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
   await c.query('SELECT pg_advisory_xact_lock(477189)');
   const row=await access(req,c),reason=B.text(req.body?.reason,'纠错原因',500);
   if(reason.length<5)throw B.error(400,'纠错原因至少需要五个字符');
   if(row.voided_at){
    const {rows:[prior]}=await c.query('SELECT voided_by,void_reason FROM historical_movement_documents WHERE id=$1',[row.id]);
    if(prior.voided_by===req.user.id&&prior.void_reason===reason)return {id:row.id};
    throw B.error(409,'此台账单据已作废');
   }
   await c.query('UPDATE historical_movement_documents SET voided_at=clock_timestamp(),voided_by=$2,void_reason=$3 WHERE id=$1',[row.id,req.user.id,reason]);
   if(row.import_batch_id)await c.query('UPDATE historical_stock_units SET active=false WHERE source_id=$1',[row.id]);
   await B.audit(c,req,'historical_movement_voided','historical_movement_documents',row.id,null,{product_code:product(req),reason});
   return {id:row.id};
  }));
 }
}
module.exports={allowed,register,administrator};
