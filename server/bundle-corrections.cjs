'use strict';
const B=require('./business-common.cjs'),I=require('./inventory.cjs');
const requestPermission='inventory:correct-request',reviewPermission='inventory:correct-review';
const canRequest=req=>req.user.permissions.includes(requestPermission);
const canReview=req=>req.user.permissions.includes(reviewPermission);
const errors={
 BUNDLE_CORRECTION_NOT_FOUND:[404,'捆包不存在或超出权限'],
 BUNDLE_CORRECTION_ROLE:[403,'当前账号无权办理捆包信息更正'],
 BUNDLE_CORRECTION_STALE_OR_LOCKED:[409,'捆包已锁定或库存资料已变化，请核对后重新申请'],
 BUNDLE_CORRECTION_ALREADY_REVIEWED:[409,'该申请已办理，请刷新页面'],
 BUNDLE_CORRECTION_INVALID:[400,'请填写有效的捆包资料及更正原因'],
 BUNDLE_CORRECTION_NO_CHANGE:[400,'请至少修改一项捆包资料'],
 DUPLICATE_SEAL_NO:[409,'该铅封号已有使用记录，请核对']
};
async function visible(c,req,id){
 if(req.productCode!=='CU_CATHODE')throw B.error(404,'捆包不存在或超出权限');
 const scope=I.where(req.user.id,{}),{rows:[row]}=await c.query(`SELECT b.id,b.version,b.project_id,b.customer_id,v.warehouse_id,
  b.sheets_per_bundle,b.seal_no,b.production_date::text,bundle_correction_available(b.id) AS available
  FROM inventory_view v JOIN bundles b ON b.id=v.uuid WHERE ${scope.text} AND v.uuid=$${scope.values.length+1}`,[...scope.values,id]);
 if(!row)throw B.error(404,'捆包不存在或超出权限');
 return row;
}
function fields(body,names){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(name=>!names.includes(name)))throw B.error(400,'请填写有效的捆包资料及更正原因');
}
async function mutate(c,req,authorizer,apply){
 if(!authorizer(req))throw B.error(403,'当前账号无权办理捆包信息更正');
 const bundle=await visible(c,req,B.uuid(req.params.id));
 let row;
 try{row=await apply(bundle);}catch(err){
  if(errors[err.message])throw B.error(...errors[err.message]);
  if(err.constraint==='bundle_correction_one_pending')throw B.error(409,'此捆包已有待审核的更正申请');
  throw err;
 }
 await B.audit(c,req,row.state==='PENDING'?'bundle_correction_requested':'bundle_correction_'+row.state.toLowerCase(),
  'bundles',bundle.id,{...row.original,project_id:bundle.project_id,warehouse_id:bundle.warehouse_id,customer_id:bundle.customer_id},
  {...row,project_id:bundle.project_id,warehouse_id:bundle.warehouse_id,customer_id:bundle.customer_id,product_code:'CU_CATHODE'});
 return {id:row.id,state:row.state};
}
async function register({app,pool,permitted,csrf}){
 const base='/api/v1/bundles/:id/corrections',read=permitted('inventory:read');
 app.get(base,{preHandler:read},req=>I.transaction(pool,async c=>{
  const bundle=await visible(c,req,B.uuid(req.params.id));
  const {rows}=await c.query(`SELECT q.id,q.bundle_version,q.original,q.changes,q.reason,q.requested_at,q.state,
   q.reviewed_at,q.review_note,u.display_name requester,v.display_name reviewer,q.requester_id<>$2 AS independent_reviewer
   FROM bundle_corrections q JOIN users u ON u.id=q.requester_id LEFT JOIN users v ON v.id=q.reviewer_id
   WHERE q.bundle_id=$1 ORDER BY (q.state='PENDING') DESC,q.requested_at DESC,q.id LIMIT 20`,[bundle.id,req.user.id]);
  return {bundle,items:rows,can_request:canRequest(req)&&bundle.available&&!rows.some(row=>row.state==='PENDING'),can_review:canReview(req)};
 }));
 app.post(base,{preHandler:[read,permitted(requestPermission),csrf]},req=>B.mutate(pool,req,c=>mutate(c,req,canRequest,async bundle=>{
  const body=req.body;fields(body,['version','changes','reason']);fields(body.changes,['sheets_per_bundle','seal_no','production_date']);
  const changes={};
  if(Object.hasOwn(body.changes,'sheets_per_bundle'))changes.sheets_per_bundle=require('./v262.cjs').sheets(body.changes.sheets_per_bundle);
  if(Object.hasOwn(body.changes,'seal_no'))changes.seal_no=B.text(body.changes.seal_no,'铅封号',512);
  if(Object.hasOwn(body.changes,'production_date'))changes.production_date=B.date(body.changes.production_date);
  return (await c.query('SELECT * FROM bundle_correction_request($1,$2,$3,$4,$5)',
   [req.user.id,bundle.id,B.version(body.version),changes,B.text(body.reason,'更正原因',1000)])).rows[0];
 })));
 app.post(base+'/:correction/review',{preHandler:[read,permitted(reviewPermission),csrf]},req=>B.mutate(pool,req,c=>mutate(c,req,canReview,async bundle=>{
  const body=req.body;fields(body,['decision','note']);
  if(!['APPROVED','REJECTED'].includes(body.decision))throw B.error(400,'审批结果无效');
  const note=body.decision==='REJECTED'||body.note?B.text(body.note,'审核说明',1000):'';
  return (await c.query('SELECT * FROM bundle_correction_review($1,$2,$3,$4,$5)',
   [req.user.id,bundle.id,B.uuid(req.params.correction),body.decision,note])).rows[0];
 })));
}
async function pending(c,req){
 if(!canReview(req)||!req.user.permissions.includes('inventory:read'))return [];
 const scope=I.where(req.user.id,{});
 return (await c.query(`SELECT q.id,v.project_id,v.warehouse_id,v.customer_id,v.customer,v.id document_no,
  q.requested_at created_at,u.display_name initiator_name,'BUNDLE_CORRECTION' kind,'BUNDLE_CORRECTION' doc_type,
  'PENDING' status
  FROM bundle_corrections q JOIN inventory_view v ON v.uuid=q.bundle_id JOIN users u ON u.id=q.requester_id
  WHERE q.state='PENDING' AND q.requester_id<>$1 AND ${scope.text} ORDER BY q.requested_at,q.id`,scope.values)).rows.map(row=>({...row,href:'/inventory/'+encodeURIComponent(row.document_no)}));
}
module.exports={register,pending};
