'use strict';

const B=require('./business-common.cjs'),C=require('./cobalt.cjs');
const cobalt=req=>req.productCode==='CO_HYDROXIDE';
const stateLabels=['DRAFT','PENDING','APPROVED','REJECTED'];
const holds=(user,role)=>user.role_code==='admin'||user.role_code===role;
const canCreate=req=>holds(req.user,'export_supervisor')&&req.user.permissions.includes('plan:read');
const canReview=req=>holds(req.user,'logistics_manager')&&req.user.permissions.includes('allocation:review');
const canStart=req=>req.user.permissions.includes(cobalt(req)?'co:create':'allocation:write');
function assertRead(user,product){
 const startPermission=product==='CO_HYDROXIDE'?'co:create':'allocation:write';
 if(!user.permissions.includes('plan:read')&&!user.permissions.includes(startPermission)&&!canReview({user}))throw B.error(403,'备货计划超出授权');
}
const read=async req=>assertRead(req.user,req.productCode);
function assertCreate(user){if(!canCreate({user}))throw B.error(403,'当前岗位无权创建备货计划');}
const cobaltBase='/api/v1/cobalt/preparation-plans';
const allowed=(path,method)=>method==='GET'&&['/operations/status','/occupied'].some(s=>path===cobaltBase+s)||
 method==='POST'&&['/batch','/batch/preview','/batch/submit','/batch/approve'].some(s=>path===cobaltBase+s)||
 /^\/api\/v1\/cobalt\/preparation-plans(?:\/[0-9a-f-]{36}(?:\/(?:submit|approve|reject))?)?$/i.test(path)&&['GET','POST','PATCH'].includes(method);

const visibility="p.product_code=$2 AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND (s.customer_id IS NULL OR s.customer_id=p.customer_id) AND (p.warehouse_id IS NULL OR s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id))";
const projection="SELECT p.*,coalesce(cu.code,co.code) sales_plan_no,coalesce(ck.contract_no,ok.contract_no) contract_no,customer.name customer_name FROM preparation_plans p JOIN customers customer ON customer.id=p.customer_id LEFT JOIN sales_plans cu ON cu.id=p.cu_sales_plan_id LEFT JOIN co_sales_plans co ON co.id=p.co_sales_plan_id LEFT JOIN customer_contracts ck ON ck.id=cu.contract_id LEFT JOIN co_sales_contracts ok ON ok.id=co.contract_id";
const params=req=>[req.user.id,req.productCode];
async function access(c,req,id,lock=false){
 const {rows:[plan]}=await c.query(projection+' WHERE '+visibility+' AND p.id=$3'+(lock?' FOR UPDATE OF p':''),[...params(req),B.uuid(id)]);
 if(!plan)throw B.error(404,'备货计划不存在或超出授权范围');
 return plan;
}
async function sales(c,req,id,lock=false){
 const plan=cobalt(req)?await require('./cobalt-sales.cjs').access(c,req,'plan',id,lock):await require('./allocations.cjs').planAccess(c,req,id,lock);
 const {rows:[approval]}=await c.query('SELECT state FROM sales_plan_approvals WHERE product_code=$1 AND plan_id=$2',[req.productCode,plan.id]);
 if(plan.status!=='OPEN'||approval&&approval.state!=='APPROVED')throw B.error(409,'请选择已获批且执行中的销售计划');
 return plan;
}
function fields(body,keys){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key)))throw B.error(400,'备货计划参数无效');
}
function actions(req,plan){
 const editable=canCreate(req)&&req.user.id===plan.created_by&&['DRAFT','REJECTED'].includes(plan.state);
 return {edit:editable,submit:editable,review:canReview(req)&&plan.state==='PENDING',
  start:canStart(req)&&plan.state==='APPROVED'&&!plan.allocation_id&&!plan.co_preparation_id};
}
async function event(c,req,plan,action,reason=''){
 await c.query('INSERT INTO preparation_plan_events(plan_id,action,actor_id,reason) VALUES($1,$2,$3,$4)',[plan.id,action,req.user.id,reason]);
 await B.audit(c,req,'preparation_plan_'+action.toLowerCase(),'preparation_plans',plan.id,null,
  {product_code:plan.product_code,project_id:plan.project_id,customer_id:plan.customer_id,state:plan.state,version:plan.version,reason});
}
async function detail(c,req,id){
 const plan=await access(c,req,id);
 const {rows:events}=await c.query('SELECT e.action,e.reason,e.occurred_at,u.display_name actor FROM preparation_plan_events e JOIN users u ON u.id=e.actor_id WHERE e.plan_id=$1 ORDER BY e.occurred_at DESC,e.id',[id]);
 return {...plan,actions:actions(req,plan),events};
}
async function list(c,req){
 const query=req.query||{},state=query.state||'',search=query.search?B.text(query.search,'查找计划',160):'',page=Number(query.page||1);
 if((state&&!stateLabels.includes(state))||!Number.isInteger(page)||page<1||page>100000)throw B.error(400,'备货计划筛选条件无效');
 const executable=query.executable==='1';
 if(executable&&!canStart(req))throw B.error(403,'当前岗位无权创建备货单');
 const ready=executable?" AND p.state='APPROVED' AND p.allocation_id IS NULL AND p.co_preparation_id IS NULL AND coalesce(cu.status,co.status)='OPEN' AND NOT EXISTS(SELECT 1 FROM sales_plan_approvals a WHERE a.plan_id=coalesce(cu.id,co.id) AND a.product_code=p.product_code AND a.state<>'APPROVED')":'';
 const where=' WHERE '+visibility+" AND ($3::text='' OR p.state=$3) AND ($4::text='' OR strpos(lower(concat_ws(' ',p.batch_no,cu.code,co.code,customer.name)),lower($4))>0)"+ready;
 const values=[...params(req),state,search];
 const {rows}=await c.query(projection+where+' ORDER BY p.created_at DESC,p.id LIMIT 50 OFFSET $5',[...values,(page-1)*50]);
 const {rows:[total]}=await c.query('SELECT count(*)::int n FROM ('+projection+where+') results',values);
 return {items:rows.map(plan=>({...plan,actions:actions(req,plan)})),can_create:canCreate(req),page,total:total.n,page_size:50};
}
const batchLimit=100;
async function occupied(c,req){
 const query=req.query||{},search=query.search?B.text(query.search,'查找批次或客户',160):'',page=Number(query.page||1);
 if(!Number.isSafeInteger(page)||page<1||page>100000)throw B.error(400,'备货计划筛选条件无效');
 const work=cobalt(req)?`
  SELECT w.preparation_batch_no batch_no,coalesce(p.customer_id,sale.customer_id) customer_id,
   w.project_id,w.warehouse_id,coalesce(p.shipment_month,sale.shipment_month) shipment_month,
   coalesce(work.status,w.status) state,CASE WHEN p.id IS NULL THEN 'HISTORICAL_WORK' ELSE 'WORK' END source
  FROM co_preparations w LEFT JOIN preparation_plans p ON p.co_preparation_id=w.id
  LEFT JOIN co_work_batches work ON work.preparation_id=w.id
  LEFT JOIN LATERAL (SELECT s.customer_id,s.shipment_month FROM co_loading_orders l
   JOIN co_sales_plans s ON s.id=l.sales_plan_id WHERE l.preparation_id=w.id AND l.status<>'CANCELLED'
   ORDER BY l.created_at DESC,l.id LIMIT 1) sale ON true`:`
  SELECT w.lot_no batch_no,sale.customer_id,sale.project_id,location.warehouse_id,
   coalesce(p.shipment_month,sale.preparation_month) shipment_month,
   coalesce(w.workflow_state,w.status) state,CASE WHEN p.id IS NULL THEN 'HISTORICAL_WORK' ELSE 'WORK' END source
  FROM allocations w JOIN sales_plans sale ON sale.id=w.plan_id
  LEFT JOIN preparation_plans p ON p.allocation_id=w.id LEFT JOIN locations location ON location.id=w.planned_location_id
  WHERE w.lot_no IS NOT NULL`;
 const {rows}=await c.query(`WITH lots AS (
   SELECT batch_no,customer_id,project_id,warehouse_id,shipment_month,state,'PLAN' source
   FROM preparation_plans WHERE product_code=$2 AND allocation_id IS NULL AND co_preparation_id IS NULL
   UNION ALL ${work}
  ), visible AS (
   SELECT DISTINCT ON (x.batch_no) x.batch_no,x.shipment_month,x.state,x.source,customer.name customer_name
   FROM lots x LEFT JOIN customers customer ON customer.id=x.customer_id
   WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=x.project_id
    AND (s.customer_id IS NULL OR s.customer_id=x.customer_id)
    AND (s.warehouse_id IS NULL OR s.warehouse_id=x.warehouse_id OR ($2='CU_CATHODE' AND x.source='PLAN')))
   ORDER BY x.batch_no,(x.source='PLAN'),x.customer_id
  ) SELECT * FROM visible WHERE $3='' OR strpos(lower(concat_ws(' ',batch_no,customer_name)),lower($3))>0
  ORDER BY batch_no LIMIT 26 OFFSET $4`,[...params(req),search,(page-1)*25]);
 return {items:rows.slice(0,25),page,has_next:rows.length>25};
}
function batchItems(req){
 fields(req.body,['items','submit']);
 if(req.body.submit!==undefined&&typeof req.body.submit!=='boolean')throw B.error(400,'提交审核参数无效');
 if(!Array.isArray(req.body.items)||!req.body.items.length||req.body.items.length>batchLimit)throw B.error(400,'每批须有 1 至 100 行备货计划');
 return req.body.items;
}
async function evaluateBatch(c,req){
 const items=batchItems(req),counts=new Map();
 for(const item of items){
  const lot=typeof item?.batch_no==='string'?item.batch_no.trim().toUpperCase():'';
  if(lot)counts.set(lot,(counts.get(lot)||0)+1);
 }
 const results=[];
 for(const [index,item] of items.entries()){
  try{
   if(typeof item?.batch_no==='string'&&counts.get(item.batch_no.trim().toUpperCase())>1)
    throw B.error(400,'录入表内重复');
   await save(c,req,null,item,{preview:true});
   results.push({index,error:null});
  }catch(e){
   if(!e.statusCode||e.statusCode>=500)throw e;
   results.push({index,error:e.message,status:e.statusCode});
  }
 }
 return results;
}
async function saveBatch(c,req){
 const items=batchItems(req),blocked=(await evaluateBatch(c,req)).find(row=>row.error);
 if(blocked)throw B.error(blocked.status,'第 '+(blocked.index+1)+' 行：'+blocked.error);
 for(const id of [...new Set(items.map(item=>item.sales_plan_id.toLowerCase()))].sort())await sales(c,req,id,true);
 const ordered=items.map((item,index)=>({item,index})).sort((a,b)=>
  a.item.batch_no.trim().toUpperCase().localeCompare(b.item.batch_no.trim().toUpperCase()));
 const saved=[];
 for(const {item,index} of ordered){
  try{
   const draft=await save(c,req,null,item,{bulk:true});
   const result=req.body.submit?await transition(c,req,draft.id,'submit',{version:draft.version}):draft;
   saved[index]={id:result.id,batch_no:result.batch_no,state:result.state};
  }catch(e){if(e.statusCode&&e.statusCode<500)throw B.error(e.statusCode,'第 '+(index+1)+' 行：'+e.message);throw e;}
 }
 return {items:saved};
}
async function save(c,req,id=null,body=req.body,{preview=false,bulk=false}={}){
 if(!canCreate(req))throw B.error(403,'由出口主管创建和修改备货计划');
 fields(body,id?['sales_plan_id','customer_id','batch_no','shipment_month','version']:['sales_plan_id','customer_id','batch_no','shipment_month']);
 const prior=id?await access(c,req,id,true):null;
 if(prior&&(!actions(req,prior).edit||prior.version!==B.version(body.version)))throw B.error(409,'备货计划状态或版本已变化');
 const plan=await sales(c,req,B.uuid(body.sales_plan_id),!preview),co=cobalt(req),month=body.shipment_month;
 if(body.customer_id&&B.uuid(body.customer_id).toLowerCase()!==plan.customer_id)throw B.error(400,'客户与销售计划不一致');
 if(typeof month!=='string'||!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month))throw B.error(400,'发运月无效');
 const batch=B.text(body.batch_no,'备货批次号',48).toUpperCase();
 const pattern=co?/^RMM-CO-[0-9]{4}-[0-9]{3,}$/:/^RMM-CU-[0-9]{4}-(0[1-9]|[1-9][0-9]{1,35})$/;
 if(!pattern.test(batch)||!/[1-9]/.test(batch.split('-').at(-1)))throw B.error(400,'备货批次号格式无效');
 const used=await c.query(co?'SELECT 1 FROM co_preparations WHERE preparation_batch_no=$1':'SELECT 1 FROM allocations WHERE lot_no=$1',[batch]);
 if(used.rowCount||(await c.query('SELECT 1 FROM preparation_plans WHERE product_code=$1 AND batch_no=$2 AND id IS DISTINCT FROM $3',[req.productCode,batch,id])).rowCount)
  throw B.error(409,'备货批次号已占用');
 if(preview)return;
 const values=[req.productCode,plan.project_id,plan.customer_id,co?plan.warehouse_id:null,co?null:plan.id,co?plan.id:null,batch,month];
 const result=prior?await c.query('UPDATE preparation_plans SET product_code=$1,project_id=$2,customer_id=$3,warehouse_id=$4,cu_sales_plan_id=$5,co_sales_plan_id=$6,batch_no=$7,shipment_month=$8,version=version+1 WHERE id=$9 RETURNING *',[...values,id]):
  await c.query('INSERT INTO preparation_plans(product_code,project_id,customer_id,warehouse_id,cu_sales_plan_id,co_sales_plan_id,batch_no,shipment_month,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(product_code,batch_no) DO NOTHING RETURNING *',[...values,req.user.id]);
 const saved=result.rows[0];
 if(!saved)throw B.error(409,'备货批次号已占用');
 await event(c,req,saved,prior?'EDIT':'CREATE');
 return bulk?saved:detail(c,req,saved.id);
}
async function transition(c,req,id,operation,body=req.body){
 fields(body,['version','reason']);
 const old=await access(c,req,id,true),action=actions(req,old);
 const submit=operation==='submit';
 if(submit&&!canCreate(req)||!submit&&!canReview(req))throw B.error(403,'当前岗位无权办理该备货计划');
 if(old.version!==B.version(body.version)||!(submit?action.submit:action.review))throw B.error(409,'备货计划状态、办理人或版本已变化');
 const reason=operation==='reject'||body.reason?B.text(body.reason,'审批意见',1000):'';
 if(operation!=='reject')await sales(c,req,old.sales_plan_id,true);
 const state=({submit:'PENDING',approve:'APPROVED',reject:'REJECTED'})[operation];
 const {rows:[plan]}=await c.query('UPDATE preparation_plans SET state=$2,version=version+1 WHERE id=$1 RETURNING *',[id,state]);
 await event(c,req,plan,operation.toUpperCase(),reason);
 return detail(c,req,id);
}
async function transitionBatch(c,req,operation){
 fields(req.body,['items']);
 const items=req.body.items;
 if(!Array.isArray(items)||items.length<1||items.length>batchLimit)throw B.error(400,'请选择 1 至 100 张备货计划');
 const ordered=items.map(item=>{
  fields(item,['id','version']);
  return {id:B.uuid(item.id).toLowerCase(),version:B.version(item.version)};
 }).sort((a,b)=>a.id.localeCompare(b.id));
 if(new Set(ordered.map(item=>item.id)).size!==ordered.length)throw B.error(400,'选中的备货计划重复');
 const plans=[];
 for(const item of ordered)plans.push(await access(c,req,item.id,true));
 for(const id of [...new Set(plans.map(plan=>plan.sales_plan_id))].sort())await sales(c,req,id,true);
 const result=[];
 for(const item of ordered){
  const plan=await transition(c,req,item.id,operation,{version:item.version});
  result.push({id:plan.id,batch_no:plan.batch_no,state:plan.state});
 }
 return {items:result};
}
async function claim(c,req,id){
 if(!id)throw B.error(409,'新建备货作业须从已审批备货计划发起');
 if(!canStart(req))throw B.error(403,'当前账号无权创建备货作业');
 const plan=await access(c,req,id,true);
 if(!actions(req,plan).start)throw B.error(409,'备货计划未获批准或已生成作业');
 const current=await sales(c,req,plan.sales_plan_id,true);
 if(current.project_id!==plan.project_id||current.customer_id!==plan.customer_id||cobalt(req)&&current.warehouse_id!==plan.warehouse_id)
  throw B.error(409,'销售计划与备货计划的项目、客户或仓库不一致');
 return plan;
}
async function bind(c,req,plan,workId){
 const field=cobalt(req)?'co_preparation_id':'allocation_id';
 const {rows:[row]}=await c.query('UPDATE preparation_plans SET '+field+'=$2,version=version+1 WHERE id=$1 AND '+field+' IS NULL RETURNING *',[plan.id,workId]);
 if(!row)throw B.error(409,'备货计划已生成作业');
 await event(c,req,row,'START');
}
function register({app,pool,auth,csrf}){
 for(const prefix of ['/api/v1/preparation-plans','/api/v1/cobalt/preparation-plans']){
  const create=async req=>assertCreate(req.user);
  app.get(prefix,{preHandler:[auth,read]},req=>C.readTransaction(pool,c=>list(c,req)));
  app.get(prefix+'/occupied',{preHandler:[auth,create]},req=>C.readTransaction(pool,c=>occupied(c,req)));
  app.post(prefix+'/batch/preview',{preHandler:[auth,create,csrf]},req=>C.readTransaction(pool,async c=>({items:await evaluateBatch(c,req)})));
  app.get(prefix+'/operations/status',{preHandler:[auth,read]},req=>C.readTransaction(pool,async c=>{
   const {method,path,key}=req.query,base=prefix.slice('/api/v1'.length);
   const target=typeof path==='string'&&path.startsWith(base)?path.slice(base.length):null;
   const match=target!==null&&/^\/([0-9a-f-]{36})(?:\/(submit|approve|reject))?$/i.exec(target);
   const batch=['/batch','/batch/submit','/batch/approve'].includes(target);
   const valid=method==='POST'&&(target===''||batch||match?.[2])||method==='PATCH'&&match&&!match[2];
   if(!valid||typeof key!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(key))throw B.error(400,'操作查询参数无效');
   const {rows:[receipt]}=await c.query('SELECT response FROM idempotency_requests WHERE actor_id=$1 AND route=$2 AND key=$3',[req.user.id,method+' /api/v1'+path,key]);
   const id=match?.[1]||receipt?.response.id;
   if(id)await access(c,req,id);
   if(batch&&receipt)for(const row of receipt.response.items)await access(c,req,row.id);
   return {committed:!!receipt};
  }));
  app.get(prefix+'/:id',{preHandler:[auth,read]},req=>C.readTransaction(pool,c=>detail(c,req,req.params.id)));
  const mutate=(method,url,authorize,handler)=>app.route({method,url,preHandler:[auth,read,csrf,async req=>{
   if(!authorize(req))throw B.error(403,'当前岗位无权办理该备货计划');
   if(req.params?.id)await access(pool,req,req.params.id);
  }],handler:req=>B.mutate(pool,req,c=>handler(c,req))});
  mutate('POST',prefix,canCreate,(c,req)=>save(c,req));
  mutate('POST',prefix+'/batch',canCreate,saveBatch);
  for(const operation of ['submit','approve'])mutate('POST',prefix+'/batch/'+operation,operation==='submit'?canCreate:canReview,(c,req)=>transitionBatch(c,req,operation));
  mutate('PATCH',prefix+'/:id',canCreate,(c,req)=>save(c,req,req.params.id));
  for(const operation of ['submit','approve','reject'])mutate('POST',prefix+'/:id/'+operation,operation==='submit'?canCreate:canReview,(c,req)=>transition(c,req,req.params.id,operation));
 }
}

async function pending(c,req){
 if(!canReview(req))return [];
 const sql="SELECT p.id,p.project_id,p.warehouse_id,p.customer_id,customer.name customer_name,p.batch_no document_no,p.state status,p.created_by,"+
  " u.display_name initiator_name,latest.occurred_at created_at,'PREPARATION_PLAN' doc_type,'preparation_plans' entity_type,"+
  " 'PREPARATION_PLAN_REVIEW' kind,'/preparation/work-plans/'||p.id::text href FROM preparation_plans p JOIN customers customer ON customer.id=p.customer_id"+
  " JOIN users u ON u.id=p.created_by LEFT JOIN LATERAL(SELECT occurred_at FROM preparation_plan_events e WHERE e.plan_id=p.id AND e.action='SUBMIT' ORDER BY occurred_at DESC LIMIT 1) latest ON true"+
  " WHERE "+visibility+" AND p.state='PENDING' ORDER BY latest.occurred_at,p.id";
 return (await c.query(sql,params(req))).rows;
}

module.exports={allowed,register,claim,bind,pending,assertRead,assertCreate};
