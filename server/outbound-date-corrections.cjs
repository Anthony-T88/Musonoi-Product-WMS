'use strict';

const B=require('./business-common.cjs');
const cobalt='CO_HYDROXIDE';
const stages={PENDING_LOGISTICS:'outbound:logistics-review',PENDING_PRODUCTION:'outbound:production-approve'};
const endpoint='/api/v1/cobalt/execution/orders/';
const correctionPath=new RegExp('^'+endpoint+'[a-f0-9-]{36}/outbound-date-corrections(?:/[a-f0-9-]{36}/review)?$','i');
const allowed=(path,method)=>correctionPath.test(path)&&(method==='POST'||method==='GET'&&path.endsWith('/outbound-date-corrections'));
const can=(req,permission)=>req.user.permissions.includes(permission);
const requestPermission=req=>['load:execute','load:write'].find(permission=>can(req,permission));
const canReview=(req,row)=>!!stages[row.state]&&can(req,stages[row.state])&&
 req.user.id!==row.requested_by&&req.user.id!==row.logistics_by;
const isCobalt=req=>req.productCode===cobalt;

const errors={
 date:['请选择有效的出库日期','Choose a valid stock issue date','Choisissez une date de sortie de stock valide'],
 required:['出库日期更正原因必填，最多1000个字符','Enter a reason for the stock issue date correction (up to 1000 characters)','Indiquez le motif de la correction de la date de sortie de stock (1 000 caractères maximum)'],
 invalid:['请核对出库日期更正资料','Check the stock issue date correction details','Vérifiez les informations de correction de la date de sortie de stock'],
 forbidden:['当前账号无权办理此审批，申请人及已完成上一级审批的账号须回避','This account cannot review this correction. The requester and previous reviewer must decline to act.','Ce compte ne peut pas valider cette correction. Le demandeur et le premier approbateur doivent se récuser.'],
 formal:['只有有效的正式出库单可以更正出库日期','Only active posted stock issues can be corrected','Seules les sorties de stock validées et actives peuvent être corrigées'],
 stale:['出库日期或审批状态已变化，请刷新后重新核对','The stock issue date or review status changed. Refresh and check again.','La date de sortie de stock ou le statut de validation a changé. Actualisez et vérifiez.'],
 noChange:['请选择不同的出库日期','Choose a different stock issue date','Choisissez une autre date de sortie de stock'],
 pending:['此出库单已有待审批的日期更正','A date correction is already pending for this stock issue','Une correction de date est déjà en attente pour cette sortie de stock'],
 missing:['找不到出库日期更正申请','Stock issue date correction not found','Demande de correction de date de sortie de stock introuvable']
};
function fail(req,status,key){
 const language=req.user.language_code;
 return B.error(status,errors[key][language==='fr'?2:language==='en'?1:0]);
}

function businessDate(req,value){
 try{
  if(typeof value==='string'&&value.startsWith('0000-'))throw fail(req,400,'date');
  return B.date(value);
 }catch{throw fail(req,400,'date');}
}
function fields(req,keys){
 const body=req.body;
 if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(key=>!keys.includes(key)))
  throw fail(req,400,'invalid');
 return body;
}
function note(req,value,required){
 if(value===undefined&&!required)return '';
 if(typeof value!=='string'||value.trim().length>1000||required&&!value.trim())
  throw fail(req,400,required?'required':'invalid');
 return value.trim();
}

async function effectiveDate(c,orderId,co){
 const fn=co?'wms_cobalt_outbound_date':'wms_copper_outbound_date';
 return (await c.query('SELECT '+fn+'($1)::text AS day',[orderId])).rows[0].day;
}
async function declare(c,req,{orderId,departureId,day}){
 const key=departureId?'cobalt_departure_id':'copper_order_id',source=departureId||orderId;
 const previous=(await c.query('SELECT declared_date::text FROM outbound_date_declarations WHERE '+key+'=$1',[source])).rows[0];
 await c.query(`INSERT INTO outbound_date_declarations(${key},declared_date,declared_by) VALUES($1,$2,$3)
  ON CONFLICT(${key}) DO UPDATE SET declared_date=excluded.declared_date,
   declared_by=excluded.declared_by,declared_at=excluded.declared_at`,[source,day,req.user.id]);
 await B.audit(c,req,'outbound_date_declared',isCobalt(req)?'co_loading_orders':'loading_orders',orderId,previous||null,
  {declared_date:day,product_code:req.productCode});
}

async function access(c,req,orderId,lock=false){
 if(isCobalt(req)){
  const {order,execution,plan}=await require('./cobalt-execution.cjs').access(c,req,orderId,lock);
  const posted=execution?.state==='OUTBOUND'&&order.status==='OUTBOUND'&&
   (await c.query('SELECT 1 FROM co_outbounds WHERE order_id=$1',[orderId])).rowCount>0;
  return {posted,project_id:plan.project_id,warehouse_id:plan.warehouse_id,customer_id:plan.customer_id};
 }
 // Copper mutations already hold the inventory revision lock shared with returns and document generation.
 const order=await require('./workflow-common.cjs').document(c,req,'loading_orders',orderId,'loading_items','loading_id');
 const {posted}=(await c.query('SELECT ('+require('./export-shipping.cjs').posted+
  ') AS posted FROM loading_orders l WHERE l.id=$1',[orderId])).rows[0];
 return {posted,project_id:order.project_id,warehouse_id:order.items[0]?.warehouse_id??null,customer_id:order.customer_id};
}

const orderKey=req=>isCobalt(req)?'cobalt_order_id':'copper_order_id';
const result=(row,scope,day)=>({id:row.id,version:row.version,state:row.state,outbound_date:day,
 project_id:scope.project_id,warehouse_id:scope.warehouse_id,customer_id:scope.customer_id});
const audit=(c,req,action,id,before,after,scope)=>B.audit(c,req,'outbound_date_correction_'+action,
 'outbound_date_correction',id,before,{...after,...scope,product_code:req.productCode});
const pendingStates="('PENDING_LOGISTICS','PENDING_PRODUCTION')";

function register({app,pool,permitted,csrf,cobaltExecutionEnabled}){
 const read=permitted('load:read');
 const bases=['/api/v1/v26/loads/:id/outbound-date-corrections'];
 if(cobaltExecutionEnabled)bases.push(endpoint+':id/outbound-date-corrections');
 for(const base of bases){
  const co=base.startsWith(endpoint);
  const transact=(req,fn)=>co?require('./cobalt-sales.cjs').mutation(pool,req,'load:read',fn):B.mutate(pool,req,fn);
  app.get(base,{preHandler:read},req=>require('./control-common.cjs').read(pool,async c=>{
   const orderId=B.uuid(req.params.id),scope=await access(c,req,orderId);
   const {rows}=await c.query(`SELECT q.*,q.original_date::text,q.corrected_date::text,
    u.display_name requester_name,l.display_name logistics_name,p.display_name production_name
    FROM outbound_date_corrections q JOIN users u ON u.id=q.requested_by
    LEFT JOIN users l ON l.id=q.logistics_by LEFT JOIN users p ON p.id=q.production_by
    WHERE q.${orderKey(req)}=$1 ORDER BY (q.state IN ${pendingStates}) DESC,q.requested_at DESC,q.id DESC LIMIT 50`,[orderId]);
   const day=await effectiveDate(c,orderId,co);
   return {outbound_date:day,can_request:!!requestPermission(req)&&scope.posted&&!!day&&!rows.some(row=>stages[row.state]),
    items:rows.map(row=>({...row,can_review:scope.posted&&canReview(req,row)}))};
  }));
  app.post(base,{preHandler:[read,csrf]},req=>transact(req,async c=>{
   if(!requestPermission(req))throw fail(req,403,'forbidden');
   const orderId=B.uuid(req.params.id),scope=await access(c,req,orderId,true);
   if(!scope.posted)throw fail(req,409,'formal');
   const body=fields(req,['expected_date','outbound_date','reason']);
   const day=await effectiveDate(c,orderId,co),target=businessDate(req,body.outbound_date);
   if(!day||day!==body.expected_date)throw fail(req,409,'stale');
   if(day===target)throw fail(req,400,'noChange');
   const key=orderKey(req);
   if((await c.query(`SELECT 1 FROM outbound_date_corrections WHERE ${key}=$1 AND state IN ${pendingStates}`,[orderId])).rowCount)
    throw fail(req,409,'pending');
   const {rows:[row]}=await c.query(`INSERT INTO outbound_date_corrections(${key},original_date,corrected_date,reason,requested_by)
    VALUES($1,$2,$3,$4,$5) RETURNING *,original_date::text,corrected_date::text`,[orderId,day,target,note(req,body.reason,true),req.user.id]);
   await audit(c,req,'requested',row.id,null,row,scope);
   return result(row,scope,day);
  }));
  app.post(base+'/:correction/review',{preHandler:[read,csrf]},req=>transact(req,async c=>{
   const orderId=B.uuid(req.params.id),scope=await access(c,req,orderId,true);
   if(!scope.posted)throw fail(req,409,'formal');
   const body=fields(req,['version','decision','note']);
   if(!['APPROVED','REJECTED'].includes(body.decision))throw fail(req,400,'invalid');
   const correction=B.uuid(req.params.correction);
   const {rows:[prior]}=await c.query(`SELECT *,original_date::text,corrected_date::text FROM outbound_date_corrections
    WHERE id=$1 AND ${orderKey(req)}=$2 FOR UPDATE`,[correction,orderId]);
   if(!prior)throw fail(req,404,'missing');
   if(!stages[prior.state]||prior.version!==B.version(body.version))throw fail(req,409,'stale');
   if(!canReview(req,prior))throw fail(req,403,'forbidden');
   const day=await effectiveDate(c,orderId,co);
   if(day!==prior.original_date)throw fail(req,409,'stale');
   const stage=prior.state==='PENDING_LOGISTICS'?'logistics':'production';
   const rejected=body.decision==='REJECTED';
   const state=rejected?'REJECTED':stage==='logistics'?'PENDING_PRODUCTION':'APPROVED';
   const {rows:[row]}=await c.query(`UPDATE outbound_date_corrections SET state=$2,version=version+1,
    ${stage}_by=$3,${stage}_at=clock_timestamp(),${stage}_note=$4
    WHERE id=$1 RETURNING *,original_date::text,corrected_date::text`,[correction,state,req.user.id,note(req,body.note,rejected)]);
   await audit(c,req,stage+(rejected?'_rejected':'_approved'),correction,prior,row,scope);
   return result(row,scope,state==='APPROVED'?row.corrected_date:day);
  }));
 }
}

async function pending(c,req){
 if(!can(req,'load:read')||!Object.values(stages).some(permission=>can(req,permission)))return [];
 const co=isCobalt(req),key=orderKey(req),orderTable=co?'co_loading_orders':'loading_orders';
 const batch=co?'batch.preparation_batch_no':'batch.lot_no';
 const joinedBatch=co?'co_preparations batch ON batch.id=l.preparation_id':'allocations batch ON batch.id=l.allocation_id';
 const {rows}=await c.query(`SELECT q.id,q.state,q.requested_by,q.logistics_by,q.${key} order_id,
  coalesce(q.logistics_at,q.requested_at) created_at,coalesce(${batch},l.code) document_no,u.display_name initiator_name
  FROM outbound_date_corrections q JOIN ${orderTable} l ON l.id=q.${key}
  JOIN users u ON u.id=q.requested_by LEFT JOIN ${joinedBatch}
  WHERE q.state IN ${pendingStates} AND q.requested_by<>$1 AND q.logistics_by IS DISTINCT FROM $1
  ORDER BY q.requested_at,q.id`,[req.user.id]);
 const items=[];
 for(const row of rows){
  if(!canReview(req,row))continue;
  let scope;
  try{scope=await access(c,req,row.order_id);}catch(err){if([403,404].includes(err.statusCode))continue;throw err;}
  if(!scope.posted)continue;
  const kind=row.state==='PENDING_LOGISTICS'?'OUTBOUND_DATE_LOGISTICS_REVIEW':'OUTBOUND_DATE_PRODUCTION_REVIEW';
  const href=(co?'/outbounds/':'/outbounds/loads/')+row.order_id+'?date_correction=1#outbound-date-correction-panel';
  items.push({...scope,...row,kind,doc_type:'OUTBOUND_DATE_CORRECTION',status:row.state,href});
 }
 return items;
}

module.exports={allowed,register,declare,businessDate,effectiveDate,pending};
