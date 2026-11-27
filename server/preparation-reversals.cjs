'use strict';

const B=require('./business-common.cjs'),C=require('./cobalt.cjs');
const requestPermission='lot:reverse-request',reviewPermission='lot:reverse-review';
const canRequest=req=>req.user.permissions.includes(requestPermission);
const canReview=req=>req.user.permissions.includes(reviewPermission);
const co=req=>req.productCode==='CO_HYDROXIDE';
const link=(product,id)=>product==='CO_HYDROXIDE'?'/receipts/'+id:'/preparation/'+id;
const cobaltPath=/^\/api\/v1\/cobalt\/preparations\/[0-9a-f-]{36}\/reversal(?:\/[0-9a-f-]{36}\/review)?$/i;
const allowed=(path,method)=>cobaltPath.test(path)&&(['POST','GET'].includes(method));
const fields=(body,names)=>{
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!names.includes(key)))
  throw B.error(400,'PREPARATION_REVERSAL_INVALID');
};

async function access(c,req,id){
 if(co(req))await C.document(c,req,id);
 else await require('./allocations.cjs').orderAccess(c,req,id);
 const facts=(await c.query('SELECT preparation_reversal_status($1,$2,false) facts',[req.productCode,id])).rows[0].facts;
 if(facts)await B.scope(c,req,facts.project_id,facts.warehouse_id,facts.customer_id);
 return facts;
}

async function read(c,req,id){
 const facts=await access(c,req,id);
 if(!facts)return {items:[],can_request:false,can_review:false};
 const {rows}=await c.query(`SELECT r.id,r.batch_no,r.state,r.reason,r.observation,r.work_version,r.requested_at,r.reviewed_at,
  r.review_note,r.original_plan_id,r.customer_id,r.warehouse_id,r.project_id,jsonb_array_length(r.stock_snapshot) stock_count,
  u.display_name requester,v.display_name reviewer,replacement.id replacement_plan_id,replacement.batch_no replacement_batch
  FROM preparation_reversals r JOIN users u ON u.id=r.requested_by LEFT JOIN users v ON v.id=r.reviewed_by
  LEFT JOIN preparation_plans replacement ON replacement.reversal_id=r.id
  WHERE r.product_code=$1 AND r.work_id=$2 ORDER BY r.requested_at DESC,r.id LIMIT 30`,[req.productCode,id]);
 const archived=req.query.record?rows.find(row=>row.id===B.uuid(req.query.record)):null;
 if(req.query.record&&!archived)throw B.error(404,'PREPARATION_REVERSAL_NOT_FOUND');
 if(archived){
  const page=Number(req.query.stock_page||1);
  if(!Number.isSafeInteger(page)||page<1||page>10000)throw B.error(400,'PREPARATION_REVERSAL_INVALID');
  archived.stock=(await c.query(`SELECT j.value FROM preparation_reversals r
    CROSS JOIN LATERAL jsonb_array_elements(r.stock_snapshot) WITH ORDINALITY j(value,n)
    WHERE r.id=$1 AND j.n>$2 AND j.n<=$3 ORDER BY j.n`,[archived.id,(page-1)*100,page*100])).rows.map(row=>row.value);
  archived.stock_page=page;
 }
 return {items:rows,version:facts.version,block:facts.block,state:facts.state,
  can_request:canRequest(req)&&!facts.block&&!rows.some(r=>r.state==='PENDING'),
  can_review:canReview(req)};
}

async function mutate(c,req,id,review){
 const facts=await access(c,req,id);
 if(!facts)throw B.error(404,'PREPARATION_REVERSAL_NOT_FOUND');
 const body=req.body,params=[req.user.id,req.productCode,id];
 fields(body,review?['decision','note','verified']:['version','reason','observation','verified']);
 let sql;
 if(review){
  if(!['APPROVED','REJECTED'].includes(body.decision)||body.decision==='APPROVED'&&body.verified!==true)
   throw B.error(400,'PREPARATION_REVERSAL_INVALID');
  params.push(B.uuid(req.params.reversal),body.decision,B.text(body.note,'PREPARATION_REVERSAL_NOTE',1000));
  sql='SELECT preparation_reversal_review($1,$2,$3,$4,$5,$6) id';
 }else{
  if(body.verified!==true)throw B.error(400,'PREPARATION_REVERSAL_INVALID');
  params.push(B.version(body.version),B.text(body.reason,'PREPARATION_REVERSAL_REASON',1000),B.text(body.observation,'PREPARATION_REVERSAL_OBSERVATION',1000));
  sql='SELECT preparation_reversal_request($1,$2,$3,$4,$5,$6) id';
 }
 let rid;
 try{rid=(await c.query(sql,params)).rows[0].id;}
 catch(err){
  if(err.constraint==='preparation_reversal_pending')throw B.error(409,'PREPARATION_REVERSAL_PENDING');
  if(err.code==='23514'&&err.message.startsWith('PREPARATION_REVERSAL_'))throw B.error(409,err.message);
  if(err.code==='42501')throw B.error(403,'PREPARATION_REVERSAL_FORBIDDEN');
  throw err;
 }
 const {rows:[row]}=await c.query(
  'SELECT id,product_code,project_id,customer_id,warehouse_id,batch_no,state,reason,observation,work_id FROM preparation_reversals WHERE id=$1',[rid]);
 await B.audit(c,req,'preparation_reversal_'+row.state.toLowerCase(),co(req)?'co_preparations':'allocations',id,
  {batch_no:row.batch_no,version:facts.version,product_code:row.product_code,warehouse_id:row.warehouse_id,customer_id:row.customer_id,project_id:row.project_id},row);
 return {id,reversal_id:row.id,state:row.state};
}

function register({app,pool,permitted,csrf}){
 for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
  const cobalt=product==='CO_HYDROXIDE',base=cobalt?'/api/v1/cobalt/preparations/:id/reversal':'/api/v1/v261/lots/:id/reversal';
  const authorizedRead=permitted(cobalt?'co:read':'allocation:read');
  app.get(base,{preHandler:authorizedRead},req=>C.readTransaction(pool,c=>read(c,req,B.uuid(req.params.id))));
  for(const review of [false,true])app.post(base+(review?'/:reversal/review':''),{preHandler:[
   authorizedRead,permitted(review?reviewPermission:requestPermission),csrf,async req=>{await access(pool,req,B.uuid(req.params.id));}
  ]},req=>{
   const run=c=>mutate(c,req,B.uuid(req.params.id),review);
   return cobalt?C.mutation(pool,req,review?reviewPermission:requestPermission,run):B.mutate(pool,req,run);
  });
 }
}
async function pending(c,req){
 if(!canReview(req)||!req.user.permissions.includes(co(req)?'co:read':'allocation:read'))return [];
 const {rows}=await c.query(`SELECT r.id,r.work_id,r.project_id,r.warehouse_id,r.customer_id,r.batch_no document_no,r.state status,
  cust.name customer_name,u.display_name initiator_name,r.requested_at created_at,'PREPARATION_REVERSAL' doc_type,
  'PREPARATION_REVERSAL_REVIEW' kind FROM preparation_reversals r JOIN users u ON u.id=r.requested_by
  LEFT JOIN customers cust ON cust.id=r.customer_id
  WHERE r.product_code=$2 AND r.state='PENDING' AND EXISTS(SELECT 1 FROM user_scopes s
   WHERE s.user_id=$1 AND s.project_id=r.project_id AND (s.warehouse_id IS NULL OR s.warehouse_id=r.warehouse_id)
   AND (s.customer_id IS NULL OR s.customer_id=r.customer_id)
   AND (r.product_code<>'CO_HYDROXIDE' OR s.customer_id IS NULL))
  AND NOT EXISTS(SELECT 1 FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id JOIN locations l ON l.id=b.location_id
   WHERE i.allocation_id=r.allocation_id AND NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1
    AND s.project_id=r.project_id AND (s.warehouse_id IS NULL OR s.warehouse_id=l.warehouse_id)
    AND (s.customer_id IS NULL OR s.customer_id=r.customer_id)))
  ORDER BY r.requested_at,r.id`,[req.user.id,req.productCode]);
 return rows.map(row=>({...row,href:link(req.productCode,row.work_id)+'?reversal='+row.id+'#preparation-reversal'}));
}

module.exports={register,allowed,pending};
