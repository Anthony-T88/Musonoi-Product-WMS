'use strict';
const B=require('./business-common.cjs');
const Lease=require('./authorization-lease.cjs');
const Packing=require('./historical-packing.cjs');

const allowed=(path,method)=>/^\/api\/v1\/cobalt\/historical-movements(?:\/preview|\/operations\/status|\/[0-9a-f-]{36}(?:\/source|\/void)?)?$/.test(path)&&['GET','POST'].includes(method);
const kind=value=>{
 if(!['INBOUND','OUTBOUND'].includes(value))throw B.error(400,'请选择入库或出库');
 return value;
};
const select=`SELECT d.id,d.product_code,d.movement_type,d.document_no,d.business_date::text,d.date_evidence,d.source_name,d.source_sha256,d.source_facts,
 d.imported_at,d.voided_at,d.void_reason,u.display_name imported_by,v.display_name voided_by,
 (SELECT count(*)::int FROM historical_movement_lines l WHERE l.document_id=d.id) quantity,
 (SELECT sum(net_kg)::text FROM historical_movement_lines l WHERE l.document_id=d.id) net_kg
 FROM historical_movement_documents d JOIN users u ON u.id=d.imported_by LEFT JOIN users v ON v.id=d.voided_by`;

async function transaction(pool,req,fn){
 const c=await pool.connect();
 try{
  await c.query('BEGIN');await Lease.lockBusiness(c,req);const result=await fn(c);Lease.healthy(req);
  await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

function proposed(req){
 const input=req.body||{},type=kind(input.movement_type),file=Packing.source(input),facts=Packing.parse(req.productCode,file);
 const recorded=facts.actual_dates[type];
 let day=recorded?.day??null;
 const issues=[...facts.errors];
 if(input.business_date){try{day=B.date(input.business_date);}catch{issues.push('DATE_INVALID');}}
 else if(!day)issues.push('DATE_MISSING');
 if(day&&day>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))issues.push('DATE_INVALID');
 const enteredEvidence=typeof input.date_evidence==='string'?input.date_evidence.trim():'';
 const evidence=enteredEvidence||(recorded&&recorded.day===day?'Actual date from '+recorded.cell:'');
 if(evidence.length<5||evidence.length>500)issues.push('EVIDENCE_MISSING');
 return {type,file,facts,day,evidence,issues};
}

async function preview(c,req,data){
 const {type,file,facts,day,evidence,issues}=data,product=req.productCode,co=product==='CO_HYDROXIDE';
 const keys=facts.rows.map(row=>row.unit_key).filter(Boolean);
 const {rows:[prior]}=await c.query(`SELECT id,source_sha256,business_date::text,date_evidence FROM historical_movement_documents
  WHERE product_code=$1 AND movement_type=$2 AND document_key=$3 AND voided_at IS NULL`,[product,type,facts.document_key]);
 const replay=prior&&prior.source_sha256===file.sha256&&prior.business_date===day&&prior.date_evidence===evidence;
 const {rows:used}=await c.query(`SELECT l.unit_key,d.document_no FROM historical_movement_lines l
  JOIN historical_movement_documents d ON d.id=l.document_id WHERE l.unit_key=ANY($1::text[])
   AND d.product_code=$2 AND d.movement_type=$3 AND d.voided_at IS NULL`,[keys,product,type]);
 const {rows:overlap}=await c.query(co?
  `SELECT upper(trim(b.bag_no)) unit_key,(i.bag_id IS NOT NULL) in_online_ledger,EXISTS(SELECT 1 FROM co_outbound_bags o WHERE o.bag_id=b.id) outbound
   FROM co_bags b LEFT JOIN co_inventory i ON i.bag_id=b.id WHERE upper(trim(b.bag_no))=ANY($1::text[])`:
  `SELECT upper(trim(b.bundle_no)) unit_key,true in_online_ledger,b.physical_status='OUTBOUND' outbound
   FROM bundles b WHERE upper(trim(b.bundle_no))=ANY($1::text[])`,[keys]);
 const linked=(await c.query(co?'SELECT 1 FROM co_packing_documents WHERE upper(trim(document_no))=$1 LIMIT 1':
  'SELECT 1 FROM packing_list_documents WHERE upper(trim(document_no))=$1 LIMIT 1',[facts.document_key])).rowCount>0;
 const rowIssues=new Map(used.map(row=>[row.unit_key,row.document_no])),matches=new Map(overlap.map(row=>[row.unit_key,row]));
 const warnings=linked||overlap.length>0;
 const problems=[...issues,...(prior?[replay?'ALREADY_IMPORTED':'DOCUMENT_CONFLICT']:[])];
 const rows=facts.rows.map(row=>({...row,existing_document:rowIssues.get(row.unit_key)||null,
  overlap:matches.get(row.unit_key)||null,flags:[...row.flags,...(rowIssues.has(row.unit_key)?['UNIT_ALREADY_IMPORTED']:[])]}));
 const token=Packing.digest(JSON.stringify([product,type,day,evidence,file.sha256,problems,rows.map(r=>[r.source_row,r.flags,r.overlap,r.existing_document]),linked]));
 return {...facts,rows,issues:problems,importable:!problems.length&&rows.every(r=>!r.flags.length),
  warnings,online_document_overlap:linked,preview_token:token,source_name:file.name,source_sha256:file.sha256,
  movement_type:type,business_date:day,already_imported:replay?prior.id:null};
}

function register({app,pool,auth,csrf}){
 const admin=async req=>{await auth(req);if(req.user.role_code!=='admin')throw B.error(403,'仅系统管理员可办理历史出入库导入');};
 for(const prefix of ['/api/v1/historical-movements','/api/v1/cobalt/historical-movements']){
  const read={preHandler:admin},write={preHandler:[admin,csrf]};
  const product=req=>req.productCode;
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
   const {rows}=await pool.query(select+where+' ORDER BY d.business_date DESC,d.id LIMIT 26 OFFSET $5',[...values,(page-1)*25]);
   return {items:rows.slice(0,25),page,has_next:rows.length>25};
  });
  app.get(prefix+'/:id',read,async req=>{
   const row=await access(req);
   const {rows}=await pool.query(`SELECT source_row,unit_id,seal_no,sheets_count,net_kg::text,gross_kg::text
    FROM historical_movement_lines WHERE document_id=$1 ORDER BY source_row`,[row.id]);
   return {...row,rows};
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
  app.post(prefix+'/preview',write,req=>preview(pool,req,proposed(req)));
  app.post(prefix,write,req=>{
   const idempotencyKey=req.headers['idempotency-key'];
   if(typeof idempotencyKey!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(idempotencyKey))throw B.error(400,'缺少有效的操作标识');
   const data=proposed(req);
   return transaction(pool,req,async c=>{
    await c.query('SELECT pg_advisory_xact_lock(477189)');
    const route=req.method+' '+req.url.split('?')[0],fingerprint=Packing.digest(JSON.stringify(req.body));
    const {rows:[existing]}=await c.query('SELECT request_hash,response FROM idempotency_requests WHERE actor_id=$1 AND route=$2 AND key=$3',
     [req.user.id,route,idempotencyKey]);
    if(existing){
     if(existing.request_hash!==fingerprint)throw B.error(409,'同一操作标识对应的请求内容不一致');
     return {...existing.response,replayed:true};
    }
    const receipt=async result=>{
     await c.query('INSERT INTO idempotency_requests VALUES($1,$2,$3,$4,$5,now())',[req.user.id,route,idempotencyKey,fingerprint,result]);
     return result;
    };
    const review=await preview(c,req,data);
    if(review.already_imported)return receipt({id:review.already_imported,replayed:true});
    if(!review.importable||review.preview_token!==req.body.preview_token)throw B.error(409,'导入条件或预览已变化，请重新预览');
    if(review.warnings&&req.body.acknowledge_overlap!==true)throw B.error(409,'请核对与期初库存或正式单据的重叠提示');
    const {rows,document_no,document_key,errors,...facts}=data.facts;
    const {rows:[saved]}=await c.query(`INSERT INTO historical_movement_documents(product_code,movement_type,document_no,document_key,business_date,
     date_evidence,source_name,source_sha256,source_data,source_facts,imported_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
     [product(req),data.type,document_no,document_key,data.day,data.evidence,data.file.name,data.file.sha256,data.file.data,facts,req.user.id]);
    await c.query(`INSERT INTO historical_movement_lines(document_id,source_row,unit_id,unit_key,seal_no,sheets_count,net_kg,gross_kg)
     SELECT $1,source_row,unit_id,unit_key,seal_no,sheets_count,net_kg,gross_kg FROM jsonb_to_recordset($2)
      AS x(source_row integer,unit_id text,unit_key text,seal_no text,sheets_count integer,net_kg numeric,gross_kg numeric)`,[saved.id,JSON.stringify(rows)]);
    await B.audit(c,req,'historical_movement_imported','historical_movement_documents',saved.id,null,
     {product_code:product(req),movement_type:data.type,business_date:data.day,source_sha256:data.file.sha256,quantity:rows.length,overlap_acknowledged:review.warnings});
    return receipt({id:saved.id,replayed:false});
   });
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
   await B.audit(c,req,'historical_movement_voided','historical_movement_documents',row.id,null,{product_code:product(req),reason});
   return {id:row.id};
  }));
 }
}
module.exports={allowed,register};
