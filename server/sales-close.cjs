'use strict';
const B=require('./business-common.cjs'),C=require('./cobalt.cjs');
const available=async c=>(await c.query("SELECT to_regclass('public.sales_plan_close_requests') IS NOT NULL ok")).rows[0].ok;
const latestJoin=co=>` LEFT JOIN LATERAL(SELECT r.* FROM sales_plan_close_requests r WHERE r.plan_id=p.id AND r.product_code='${co?'CO_HYDROXIDE':'CU_CATHODE'}' ORDER BY r.requested_at DESC,r.id DESC LIMIT 1) cr ON true`;
const columns=`cr.id close_request_id,cr.state close_state,cr.version close_version,cr.requested_by close_requested_by,cr.requested_at close_requested_at,cr.sales_reviewed_by close_sales_reviewed_by,cr.sales_reviewed_at close_sales_reviewed_at`;
function eligibility(req,plan){
 if(plan.status==='CLOSED')return 'CLOSED';
 if(['PENDING','COMMERCE_PENDING'].includes(plan.close_state))return 'IN_REVIEW';
 if(!req.user.permissions.includes('plan:write')||!['sales_operator','admin'].includes(req.user.role_code))return 'NO_PERMISSION';
 if(!['APPROVED','LEGACY'].includes(plan.approval_state))return 'NOT_APPROVED';
 if(plan.approval_state!=='LEGACY'&&plan.submitted_by!==req.user.id)return 'OTHER_SUBMITTER';
 return 'AVAILABLE';
}
async function enrich(c,req,rows){
 if(!rows.length)return rows;
 const ids=rows.map(p=>p.id),co=req.productCode==='CO_HYDROXIDE';
 const values=co?(await c.query(`SELECT p.id,jsonb_build_object('planned_net_weight',p.target_weight::text,'outbound_net_weight',coalesce(sum((o.snapshot->'order'->>'actual_net_kg')::numeric)/1000,0)::text,'remaining_weight',greatest(0,p.target_weight-coalesce(sum((o.snapshot->'order'->>'actual_net_kg')::numeric)/1000,0))::text) control FROM co_sales_plans p LEFT JOIN co_loading_orders l ON l.sales_plan_id=p.id AND l.status IN('WAITING','OUTBOUND') LEFT JOIN co_outbounds o ON o.order_id=l.id WHERE p.id=ANY($1::uuid[]) GROUP BY p.id`,[ids])).rows:(await c.query('SELECT id,v265_plan_progress(id) control FROM sales_plans WHERE id=ANY($1::uuid[])',[ids])).rows;
 const invoiced=await require('./sales-invoices.cjs').totals(c,req.productCode,ids);
 const controls=new Map(values.map(r=>{const total=invoiced.get(r.id);return [r.id,{...r.control,invoiced_net_weight:total?.unknown_packages?null:total?.net_mt||'0',invoiced_unknown_packages:total?.unknown_packages||0}];})),dispatch=await require('./sales-dispatch-summary.cjs').counts(c,req.productCode,ids);return rows.map(p=>({...p,close_eligibility:eligibility(req,p),control:controls.get(p.id)||null,dispatch_counts:dispatch.get(p.id)}));
}
async function detail(c,req,plan){
 const [history,readiness]=await Promise.all([
  c.query(`SELECT r.*,u.display_name requester_name,s.display_name sales_reviewer_name,m.display_name commerce_reviewer_name FROM sales_plan_close_requests r JOIN users u ON u.id=r.requested_by LEFT JOIN users s ON s.id=r.sales_reviewed_by LEFT JOIN users m ON m.id=r.commerce_reviewed_by WHERE r.product_code=$1 AND r.plan_id=$2 ORDER BY r.requested_at DESC,r.id DESC`,[req.productCode,plan.id]),
  c.query('SELECT v468_close_readiness($1,$2) readiness',[req.productCode,plan.id])
 ]);return {...(await enrich(c,req,[plan]))[0],close_requests:history.rows,close_readiness:readiness.rows[0].readiness};
}
function register({app,pool,permitted,csrf,prefix,access}){
 app.post(prefix+'/plans/:id/close',{preHandler:[permitted('plan:write'),csrf,async req=>{await access(pool,req,req.params.id);if(!['sales_operator','admin'].includes(req.user.role_code))throw B.error(403,'SALES_OPERATOR_REQUIRED');}]},req=>B.mutate(pool,req,async c=>{
  const b=req.body||{};if(Object.keys(b).some(k=>!['version','reason'].includes(k))||typeof(b.reason??'')!=='string'||(b.reason||'').length>1000)throw B.error(400,'SALES_REVIEW_INPUT');
  const before=await access(c,req,req.params.id),row=(await c.query('SELECT * FROM v468_request_plan_close($1,$2,$3,$4,$5)',[req.productCode,before.id,req.user.id,B.version(b.version),(b.reason||'').trim()])).rows[0];
  await B.audit(c,req,'sales_plan_close_requested','sales_plan_close',before.id,null,{...row,product_code:req.productCode});return {id:before.id,status:before.status,close_request:row};
 }));
 app.post(prefix+'/plans/:id/close-review',{preHandler:[permitted('plan:read'),csrf,async req=>{const plan=await access(pool,req,req.params.id);const commerce=plan.close_state==='COMMERCE_PENDING';if(!['admin',commerce?'commerce_manager':'sales_manager'].includes(req.user.role_code)||!req.user.permissions.includes(commerce?'plan:commerce-approve':'plan:approve'))throw B.error(403,commerce?'COMMERCE_MANAGER_REQUIRED':'SALES_MANAGER_REQUIRED');}]},req=>B.mutate(pool,req,async c=>{
  const b=req.body||{};if(Object.keys(b).some(k=>!['request_id','version','decision','reason'].includes(k))||!['APPROVED','REJECTED'].includes(b.decision)||typeof(b.reason??'')!=='string'||(b.reason||'').length>1000||b.decision==='REJECTED'&&!(b.reason||'').trim())throw B.error(400,'SALES_REVIEW_INPUT');
  const before=await access(c,req,req.params.id),row=(await c.query('SELECT * FROM v468_review_plan_close($1,$2,$3,$4,$5,$6,$7)',[req.productCode,before.id,B.uuid(b.request_id),req.user.id,B.version(b.version),b.decision,(b.reason||'').trim()])).rows[0];
  await B.audit(c,req,row.state==='APPROVED'?'sales_plan_closed':b.decision==='REJECTED'?'sales_plan_close_rejected':'sales_plan_close_sales_approved','sales_plan_close',before.id,{status:before.status},{...row,product_code:req.productCode});
  return {id:before.id,status:row.state==='APPROVED'?'CLOSED':before.status,close_request:row};
 }));
}
async function pending(c,req){
 if(!req.user.permissions.includes('plan:read')||!await available(c))return [];
 const co=req.productCode==='CO_HYDROXIDE',table=co?'co_sales_plans':'sales_plans',customers=co?'co_customer_profiles':'copper_customers',isSales=['sales_manager','admin'].includes(req.user.role_code)&&req.user.permissions.includes('plan:approve'),isCommerce=['commerce_manager','admin'].includes(req.user.role_code)&&req.user.permissions.includes('plan:commerce-approve');if(!isSales&&!isCommerce)return [];
 const stages=[...(isSales?['PENDING']:[]),...(isCommerce?['COMMERCE_PENDING']:[])];
 return (await c.query(`SELECT r.id,r.plan_id,p.project_id,${co?'p.warehouse_id':'null::uuid'} warehouse_id,p.customer_id,c.name customer_name,p.code document_no,r.requested_by created_by,(SELECT display_name FROM users WHERE id=r.requested_by) initiator_name,CASE WHEN r.state='PENDING' THEN 'CLOSE_PENDING' ELSE 'CLOSE_COMMERCE_PENDING' END status,r.requested_by submitted_by,r.sales_reviewed_by,CASE WHEN r.state='PENDING' THEN r.requested_at ELSE r.sales_reviewed_at END created_at,CASE WHEN r.state='PENDING' THEN r.requested_at ELSE r.sales_reviewed_at END submitted_at,'SALES_CLOSE' doc_type,'sales_plan_close_requests' entity_type,CASE WHEN r.state='PENDING' THEN 'SALES_CLOSE_REVIEW' ELSE 'COMMERCE_CLOSE_REVIEW' END kind,'/sales-plans/'||p.id::text href FROM sales_plan_close_requests r JOIN ${table} p ON p.id=r.plan_id JOIN ${customers} c ON c.id=p.customer_id WHERE r.product_code=$2 AND r.state=ANY($3::text[]) AND r.requested_by<>$1 AND(r.state<>'COMMERCE_PENDING' OR r.sales_reviewed_by<>$1) AND p.status='OPEN' AND p.version=r.plan_version AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND(s.customer_id IS NULL OR s.customer_id=p.customer_id)${co?' AND(s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id)':''}) ORDER BY r.requested_at,r.id`,[req.user.id,req.productCode,stages])).rows;
}
module.exports={available,latestJoin,columns,enrich,detail,register,pending};
