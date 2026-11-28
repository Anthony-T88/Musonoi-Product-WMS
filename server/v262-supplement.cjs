'use strict';
const B=require('./business-common.cjs'),I=require('./inventory.cjs');
const enabled=async c=>(await c.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='locations' AND column_name='map_usage') ok")).rows[0].ok;
const receiptScope=`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=r.project_id AND(s.customer_id IS NULL OR s.customer_id=r.customer_id) AND(s.warehouse_id IS NULL OR NOT EXISTS(SELECT 1 FROM receipt_lines rl JOIN locations l ON l.id=rl.location_id WHERE rl.receipt_id=r.id AND l.warehouse_id<>s.warehouse_id)))`;
async function receiptList(c,req){const status=req.query.status||'';if(status&&!['DRAFT','PENDING','CONFIRMED','REJECTED'].includes(status))throw B.error(400,'入库状态筛选无效');return {items:(await c.query(`SELECT r.*,u.display_name AS creator_name,cu.name AS customer_name,(SELECT count(*)::int FROM receipt_lines WHERE receipt_id=r.id) line_count FROM receipts r JOIN users u ON u.id=r.created_by JOIN copper_customers cu ON cu.id=r.customer_id WHERE ${receiptScope} AND($2='' OR r.status=$2) ORDER BY ${B.documentOrder({pending:"r.status='PENDING'",created:'r.created_at',id:'r.id'})} LIMIT 200`,[req.user.id,status])).rows};}
async function summary(c,req){return (await c.query(`SELECT count(*) FILTER(WHERE status='PENDING')::int pending,count(*) FILTER(WHERE status='CONFIRMED')::int confirmed,count(*) FILTER(WHERE status='REJECTED')::int rejected,count(*) FILTER(WHERE status='DRAFT')::int draft,count(*) FILTER(WHERE status='PENDING' AND ((r.created_by IS DISTINCT FROM $1::uuid AND r.submitted_by IS DISTINCT FROM $1::uuid) OR receipt_self_review_allowed($1)))::int actionable FROM receipts r WHERE ${receiptScope}`,[req.user.id])).rows[0];}
async function reopenedPlan(c,req,a){
 if(a.workflow_state!=='CANCELLED'||!req.user.permissions.includes('allocation:write'))return null;
 const {rows:[plan]}=await c.query(`SELECT p.id FROM preparation_plan_events e JOIN preparation_plans p ON p.id=e.plan_id
  JOIN sales_plans s ON s.id=p.cu_sales_plan_id
  WHERE e.allocation_id=$1 AND e.action IN('WORK_CANCEL','REUSE') AND p.state='APPROVED'
   AND p.allocation_id IS NULL AND p.co_preparation_id IS NULL AND s.status='OPEN'
  ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1`,[a.id]);
 return plan?.id??null;
}
async function eligibility(c,req,a){
 const {rows:[facts]}=await c.query(`SELECT EXISTS(SELECT 1 FROM workflow_reviews WHERE allocation_id=$1 AND action='APPROVE') was_approved,
  v262_lot_approval_active($1) has_active_approval,
  v262_lot_has_blocking_loading($1) has_loading,
  EXISTS(SELECT 1 FROM copper_outbound_return_preparations r WHERE $1=ANY(r.allocation_ids)) restored_after_return,
  EXISTS(SELECT 1 FROM preparation_reversals WHERE allocation_id=$1 AND state='PENDING') has_pending_reversal,
  (EXISTS(SELECT 1 FROM lot_work_history WHERE allocation_id=$1 AND action IN('WEIGH','SAMPLE-STAGE','SEAL','INHERIT'))
   OR EXISTS(SELECT 1 FROM inventory_events e JOIN allocation_items ai ON ai.bundle_id=e.bundle_id
    WHERE ai.allocation_id=$1 AND e.event_type IN('MOVE','ADJUST_LOCATION') AND e.occurred_at>=$2)) has_operations,
  EXISTS(SELECT 1 FROM lot_work_items WHERE allocation_id=$1 AND sample_stage='IN_PROGRESS'
   AND copper_return_preparation_item_current($1,bundle_id)) sampling,
  EXISTS(SELECT 1 FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id JOIN locations l ON l.id=b.location_id
   WHERE i.allocation_id=$1 AND copper_return_preparation_item_current($1,i.bundle_id)
    AND (NOT l.active OR l.map_usage='REVIEW')) unverified_location,
  EXISTS(SELECT 1 FROM preparation_plans p JOIN sales_plans s ON s.id=p.cu_sales_plan_id
   WHERE p.allocation_id=$1 AND p.state='APPROVED' AND s.status='OPEN') has_plan`,[a.id,a.created_at]);
 const owns=a.created_by===req.user.id,canWrite=req.user.permissions.includes('allocation:write');
 const revokePermission=req.user.permissions.includes('lot:revoke')&&(owns||req.user.permissions.includes('allocation:review'));
 const eligibleState=['WORKING','RECTIFY'].includes(a.workflow_state);
 const blocks=[
  [facts.has_active_approval,'APPROVED','本备货单的最终审核已生效，请按整批撤销流程办理'],
  [facts.has_loading,'LOADING','已有装车匹配或装车记录，请先核对装车状态'],
  [facts.has_pending_reversal,'REVERSAL','本备货单已有待审核的整批撤销申请，请先处理该申请'],
  [facts.sampling,'SAMPLING','捆包仍在实验室取样，请先登记返回并重新打包'],
  [facts.unverified_location,'LOCATION','有捆包的实际货位待定位或已停用，请先核实货位'],
  [!revokePermission,'PERMISSION','请由有撤销权限的创建人或备货审核人办理']
 ];
 const [,blocked_code,blocked_reason]=eligibleState?blocks.find(([blocked])=>blocked)||[]:[];
 const can_revoke=eligibleState&&!blocked_code;
 return {...facts,can_withdraw:owns&&canWrite&&a.workflow_state==='PENDING'&&!facts.has_active_approval&&!facts.has_loading,
  can_revoke,can_reselect:can_revoke&&canWrite&&facts.has_plan&&a.workflow_state==='RECTIFY',
  blocked_code:blocked_code||null,blocked_reason:blocked_reason||'',reopened_preparation_plan_id:await reopenedPlan(c,req,a)};
}
async function register({app,pool,permitted,csrf}){
 app.get('/api/v1/receipts/summary',{preHandler:permitted('receipt:review')},req=>I.transaction(pool,c=>summary(c,req)));
 for(const action of ['withdraw','revoke'])app.post('/api/v1/v262/lots/:id/'+action,{
  preHandler:[permitted(action==='withdraw'?'allocation:write':'lot:revoke'),csrf]
 },req=>B.mutate(pool,req,async c=>{
  const a=await require('./allocations.cjs').orderAccess(c,req,B.uuid(req.params.id));
  if(a.created_by!==req.user.id&&(action==='withdraw'||!req.user.permissions.includes('allocation:review')))
   throw B.error(403,'只允许创建人撤回；普通操作员只能撤销自己创建的Lot');
  const b=req.body||{};
  const {rows:[row]}=await c.query('SELECT * FROM v262_preapproval_action($1,$2,$3,$4,$5)',
   [req.user.id,a.id,B.version(b.version),action,JSON.stringify(b)]);
  await B.audit(c,req,'lot_'+action,'allocations',a.id,a,row);
  return action==='revoke'?{...row,reopened_preparation_plan_id:await reopenedPlan(c,req,row)}:row;
 }));
}
module.exports={enabled,receiptList,summary,eligibility,register,receiptScope};
