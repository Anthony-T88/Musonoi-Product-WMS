'use strict';
const B=require('./business-common.cjs'),C=require('./cobalt.cjs'),Close=require('./sales-close.cjs');
const id='[0-9a-fA-F-]{36}',root='/api/v1/(?:cobalt/)?sales-workflow';
const allowed=(p,m)=>m==='GET'&&new RegExp('^'+root+'/(?:options|plans|plans/'+id+'|preparations|operations/status)$').test(p)||m==='POST'&&new RegExp('^'+root+'/plans/'+id+'/(?:review|close|close-review)$').test(p);
const enabled=async c=>(await c.query("SELECT to_regclass('public.sales_plan_approvals') IS NOT NULL ok")).rows[0].ok;
const scope=(co,a='p')=>`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=${a}.project_id AND(s.customer_id IS NULL OR s.customer_id=${a}.customer_id)${co?` AND(s.warehouse_id IS NULL OR s.warehouse_id=${a}.warehouse_id)`:''})`;
const tables=co=>({plans:co?'co_sales_plans':'sales_plans',customers:co?'co_customer_profiles':'copper_customers',contracts:co?'co_sales_contracts':'customer_contracts'});
function select(co){const t=tables(co);return `SELECT p.*,p.${co?'shipment_month':'preparation_month'} shipment_month,c.name customer_name,k.contract_no,${Close.columns},coalesce(a.state,'LEGACY') approval_state,a.version approval_version,a.submitted_by,a.submitted_at,a.reviewed_by,a.reviewed_at,a.reason review_reason,a.flow_version,a.sales_reviewed_by,a.sales_reviewed_at,a.sales_reason,a.commerce_reviewed_by,a.commerce_reviewed_at,a.commerce_reason,a.rejected_stage,(SELECT display_name FROM users WHERE id=a.sales_reviewed_by) sales_reviewer_name,(SELECT display_name FROM users WHERE id=a.commerce_reviewed_by) commerce_reviewer_name,(SELECT display_name FROM users WHERE id=a.submitted_by) submitter_name,(SELECT display_name FROM users WHERE id=p.created_by) creator_name,(SELECT display_name FROM users WHERE id=a.reviewed_by) reviewer_name FROM ${t.plans} p JOIN ${t.customers} c ON c.id=p.customer_id LEFT JOIN ${t.contracts} k ON k.id=p.contract_id LEFT JOIN sales_plan_approvals a ON a.plan_id=p.id${Close.latestJoin(co)}`;} 
async function access(c,req,plan){const co=req.productCode==='CO_HYDROXIDE',r=(await c.query(select(co)+` WHERE p.id=$2 AND ${scope(co)}`,[req.user.id,B.uuid(plan)])).rows[0];if(!r)throw B.error(404,'SALES_PLAN_NOT_FOUND');return r;}
async function submission(c,req,product,plan=null){
 if(!await enabled(c))return;
 if(!plan){if(!['sales_operator','sales_manager','admin'].includes(req.user.role_code))throw B.error(403,'SALES_OPERATOR_REQUIRED');return;}
 const a=(await c.query('SELECT * FROM sales_plan_approvals WHERE plan_id=$1 AND product_code=$2',[plan,product])).rows[0];
 if(!a){
  await access(c,req,plan);
  if(!['sales_operator','sales_manager','admin'].includes(req.user.role_code))throw B.error(403,'SALES_OPERATOR_REQUIRED');
  const approval=(await c.query('SELECT * FROM v468_submit_legacy_plan_edit($1,$2,$3,$4)',[product,plan,req.user.id,B.version(req.body?.version)])).rows[0];
  await B.audit(c,req,'sales_plan_edit_submitted','sales_plan_review',plan,null,{...approval,product_code:product});return;
 }
 if(['APPROVED','COMMERCE_PENDING'].includes(a.state))throw B.error(409,'SALES_APPROVED_PLAN_LOCKED');
 if(!['sales_operator','sales_manager','admin'].includes(req.user.role_code)||a.submitted_by!==req.user.id)throw B.error(403,'SALES_PLAN_SUBMITTER_REQUIRED');
}
async function register({app,pool,permitted,csrf}){
 if(!await enabled(pool))return;
 for(const co of [false,true]){
  const prefix='/api/v1/'+(co?'cobalt/':'')+'sales-workflow',t=tables(co);
  app.get(prefix+'/operations/status',{preHandler:permitted('plan:read')},req=>C.readTransaction(pool,async c=>{const target=req.query.path||'',match=target.match(new RegExp('^'+prefix.replace('/api/v1','')+'/plans/('+id+')/(?:review|close|close-review)$'));if(!match)throw B.error(400,'SALES_REVIEW_INPUT');await access(c,req,match[1]);const row=(await c.query('SELECT response FROM idempotency_requests WHERE actor_id=$1 AND route=$2 AND key=$3',[req.user.id,(req.query.method||'POST')+' /api/v1'+target,req.query.key])).rows[0];return {committed:!!row,response:row?.response};}));
  app.get(prefix+'/options',{preHandler:permitted('plan:read')},req=>C.readTransaction(pool,async c=>({
   projects:(await c.query('SELECT p.id,p.name FROM projects p WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.id) ORDER BY p.name',[req.user.id])).rows,
   warehouses:(await c.query('SELECT w.id,w.project_id,w.name FROM warehouses w WHERE w.active AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=w.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=w.id)) ORDER BY w.name',[req.user.id])).rows,
   customers:(await c.query(`SELECT c.id,c.project_id,c.name,c.active FROM ${t.customers} c WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=c.project_id AND(s.customer_id IS NULL OR s.customer_id=c.id)) ORDER BY c.name`,[req.user.id])).rows,
   contracts:(await c.query(`SELECT k.* FROM ${t.contracts} k WHERE k.active AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=k.project_id AND(s.customer_id IS NULL OR s.customer_id=k.customer_id)) ORDER BY k.contract_no`,[req.user.id])).rows
  })));
  app.get(prefix+'/plans',{preHandler:permitted('plan:read')},req=>C.readTransaction(pool,async c=>{
   const q=req.query||{},v=[req.user.id],where=[scope(co)],add=(sql,value)=>{v.push(value);where.push(sql.replace('?', '$'+v.length));},page=Number(q.page||1);
   if(!Number.isInteger(page)||page<1||page>100000)throw B.error(400,'SALES_FILTER_INPUT');
   if(q.search)add("strpos(lower(concat_ws(' ',p.code,c.name,k.contract_no)),lower(?))>0",B.text(q.search,'计划/客户/合同',160));
   if(q.shipment_month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.shipment_month))throw B.error(400,'SALES_FILTER_INPUT');add('p.'+(co?'shipment_month':'preparation_month')+'=?',q.shipment_month);}
   if(q.customer_id)add('p.customer_id=?',B.uuid(q.customer_id));
   const summaryWhere=[...where],summaryValues=[...v];
   if(q.status){if(q.status==='APPROVAL_IN_PROGRESS')where.push("a.state IN ('PENDING','COMMERCE_PENDING')");else if(q.status==='CLOSING')where.push("cr.state IN ('PENDING','COMMERCE_PENDING')");else if(['CLOSE_PENDING','CLOSE_COMMERCE_PENDING','CLOSE_REJECTED'].includes(q.status))add('cr.state=?',q.status.slice(6));else if(['PENDING','COMMERCE_PENDING','REJECTED','APPROVED'].includes(q.status))add('a.state=?',q.status);else if(['OPEN','CLOSED'].includes(q.status)){add('p.status=?',q.status);where.push("coalesce(a.state,'APPROVED')='APPROVED'");}else throw B.error(400,'SALES_FILTER_INPUT');}
   const from=select(co),filtered=from+' WHERE '+where.join(' AND '),items=(await c.query(filtered+' ORDER BY p.created_at DESC,p.id LIMIT 50 OFFSET '+(page-1)*50,v)).rows;
   const summary=(await c.query("SELECT count(*)::int all,count(*) FILTER(WHERE approval_state='PENDING')::int sales_pending,count(*) FILTER(WHERE approval_state='COMMERCE_PENDING')::int commerce_pending,count(*) FILTER(WHERE approval_state IN('APPROVED','LEGACY') AND status='OPEN')::int open FROM ("+select(co)+' WHERE '+summaryWhere.join(' AND ')+') scoped',summaryValues)).rows[0];
   return {items:await Close.enrich(c,req,items),total:Number((await c.query('SELECT count(*) FROM ('+filtered+') scoped',v)).rows[0].count),page,page_size:50,summary};
  }));
  app.get(prefix+'/plans/:id',{preHandler:permitted('plan:read')},req=>C.readTransaction(pool,async c=>{const plan=await access(c,req,req.params.id);return {...await Close.detail(c,req,plan),history:(await c.query("SELECT a.action,a.after_data,a.occurred_at,u.display_name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_id=$1 AND a.entity_type='sales_plan_review' AND a.after_data->>'product_code'=$2 ORDER BY a.id",[plan.id,req.productCode])).rows};}));
  app.post(prefix+'/plans/:id/review',{preHandler:[permitted('plan:read'),csrf,async req=>{const plan=await access(pool,req,req.params.id);const commerce=plan.approval_state==='COMMERCE_PENDING',role=commerce?'commerce_manager':'sales_manager',permission=commerce?'plan:commerce-approve':'plan:approve';if(!['admin',role].includes(req.user.role_code)||!req.user.permissions.includes(permission))throw B.error(403,commerce?'COMMERCE_MANAGER_REQUIRED':'SALES_MANAGER_REQUIRED');}]},req=>B.mutate(pool,req,async c=>{
   const b=req.body||{};if(Object.keys(b).some(k=>!['version','decision','reason'].includes(k))||!['APPROVED','REJECTED'].includes(b.decision)||typeof(b.reason??'')!=='string'||(b.reason||'').length>1000||b.decision==='REJECTED'&&!(b.reason||'').trim())throw B.error(400,'SALES_REVIEW_INPUT');
   const before=await access(c,req,req.params.id),commerce=before.approval_state==='COMMERCE_PENDING';if(!['admin',commerce?'commerce_manager':'sales_manager'].includes(req.user.role_code))throw B.error(403,commerce?'COMMERCE_MANAGER_REQUIRED':'SALES_MANAGER_REQUIRED');const row=(await c.query('SELECT * FROM ux10_review_sales_plan($1,$2,$3,$4,$5,$6)',[req.productCode,req.params.id,req.user.id,B.version(b.version),b.decision,(b.reason||'').trim()])).rows[0];
   await B.audit(c,req,'sales_plan_'+b.decision.toLowerCase(),'sales_plan_review',req.params.id,{state:before.approval_state},{...row,product_code:req.productCode});return {id:req.params.id,approval_state:row.state,approval_version:row.version};
  }));
  Close.register({app,pool,permitted,csrf,prefix,access});
 }
 app.get('/api/v1/cobalt/sales-workflow/preparations',{preHandler:permitted('co:read')},req=>C.readTransaction(pool,async c=>{
  const q=req.query||{},page=Number(q.page||1),status=q.status||'',work=q.work_status||'';
  if(!Number.isInteger(page)||page<1||page>100000||!['','DRAFT','PREPARING','SITE_PENDING','PRODUCTION_PENDING','REJECTED','WITHDRAWN','RECEIVED'].includes(status)||!['','PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED'].includes(work))throw B.error(400,'CO_INVALID_INPUT');
  const visible=`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id) AND s.customer_id IS NULL)`,from=' FROM co_preparations p LEFT JOIN co_work_batches w ON w.preparation_id=p.id WHERE '+visible,filtered=from+" AND($2='' OR p.status=$2) AND($3='' OR w.status=$3)",v=[req.user.id,status,work];
  const summary=(await c.query("SELECT count(*)::int total,coalesce(sum(p.bag_count),0)::int bags,count(*) FILTER(WHERE p.status='DRAFT')::int draft,count(*) FILTER(WHERE p.status='SITE_PENDING' OR w.status='PENDING_COMPLETION_REVIEW')::int site_pending,count(*) FILTER(WHERE p.status='PRODUCTION_PENDING')::int production_pending,count(*) FILTER(WHERE p.status IN('RECEIVED','PREPARING') AND w.status='PREPARING')::int preparing,count(*) FILTER(WHERE w.status='PENDING_COMPLETION_REVIEW')::int review,count(*) FILTER(WHERE p.status='RECEIVED' AND w.status='COMPLETED')::int completed,count(*) FILTER(WHERE p.status='RECEIVED')::int received"+from,[req.user.id])).rows[0];
  return {items:(await c.query('SELECT p.*,w.status work_status,p.bag_count*647 expected_net_kg'+filtered+' ORDER BY p.created_at DESC,p.id LIMIT 50 OFFSET '+(page-1)*50,v)).rows,total:Number((await c.query('SELECT count(*)'+filtered,v)).rows[0].count),page,page_size:50,summary};
 }));
}
module.exports={allowed,enabled,register,submission,access};
