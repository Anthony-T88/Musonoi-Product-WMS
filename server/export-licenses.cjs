'use strict';

const {createHash}=require('node:crypto'),B=require('./business-common.cjs'),C=require('./cobalt.cjs');
const CU='CU_CATHODE',CO='CO_HYDROXIDE',today="(clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date";
const read='export-license:read',write='export-license:write',approve='export-license:approve';
const actions=['ISSUE','AMEND','EXTEND','CANCEL','CLOSE','CLOSE_EXCEPTION','SETTLE','CORRECT'];
const categories=['LICENSE','PROFORMA','EXTENSION','CLOSURE','USAGE','OTHER'];
const allowed=(path,method)=>{
 const m=/^\/api\/v1\/cobalt\/export-permits(?:\/operations\/status|\/(options|contracts|preferences|[0-9a-f-]{36})(?:\/(actions|attachments)(?:\/([0-9a-f-]{36}))?)?)?$/i.exec(path);
 return !!m&&['GET','POST','PATCH'].includes(method);
};
const fail=(status,message)=>B.error(status,message);
const scope=(alias='l')=>"EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id="+alias+".project_id AND s.warehouse_id IS NULL AND(s.customer_id IS NULL OR s.customer_id="+alias+".customer_id))";
const contracts="(SELECT 'CU_CATHODE'::text product_code,k.id,k.project_id,k.customer_id,k.contract_no,k.active,c.name buyer FROM customer_contracts k JOIN copper_customers c ON c.id=k.customer_id UNION ALL SELECT 'CO_HYDROXIDE',k.id,k.project_id,k.customer_id,k.contract_no,k.active,c.name FROM co_sales_contracts k JOIN co_customer_profiles c ON c.id=k.customer_id)";
const effective="coalesce(l.extended_until,l.valid_until)";
const status="CASE WHEN l.state<>'ISSUED' THEN l.state WHEN "+effective+"<"+today+" THEN 'EXPIRED' WHEN l.valid_from>"+today+" THEN 'SCHEDULED' ELSE 'ACTIVE' END";
const observed="CASE l.unit_basis WHEN 'PHYSICAL_MT' THEN p.net_mt WHEN 'COBALT_MT' THEN coalesce(p.confirmed_metal_mt,p.estimated_metal_mt) END";
const held="greatest(a.reserved_quantity,coalesce("+observed+",a.reserved_quantity))";
const totalsSQL="SELECT coalesce(sum(a.used_quantity),0) used,coalesce(sum("+held+") FILTER(WHERE a.state='RESERVED'),0) reserved,coalesce(sum("+held+") FILTER(WHERE a.state='RESERVED' AND p.posted_at IS NOT NULL),0) pending,count(*) FILTER(WHERE a.state='RESERVED')::int open_allocations FROM export_license_allocations a LEFT JOIN export_license_postings p ON p.allocation_id=a.id WHERE a.license_id=l.id";
const projection="SELECT l.id,l.product_code,l.project_id,l.customer_id,l.contract_id,l.applied_on,l.proforma_no,l.license_no,l.quantity::text,l.unit_basis,l.unit,l.clearing_agent,l.issuing_bank,l.unit_price::text,l.price_unit,l.amount::text,l.currency,l.destination,l.valid_from,l.valid_until,l.extension_on,l.extended_until,"+effective+" effective_until,"+status+" status,l.state,l.closed_on,l.note,l.version,k.contract_no,k.buyer,t.used::text,t.reserved::text,t.pending::text,t.open_allocations,(l.quantity-t.used)::text remaining,(l.quantity-t.used-t.reserved)::text available,round(t.used/l.quantity*100,2)::text utilization,CASE WHEN lower(l.price_unit)=lower(l.currency||'/'||l.unit) THEN (l.quantity*l.unit_price)::text END reference_amount FROM export_licenses l JOIN "+contracts+" k ON k.id=l.contract_id AND k.product_code=l.product_code CROSS JOIN LATERAL("+totalsSQL+") t";

function decimal(value,label,zero=false){
 if(typeof value!=='string'||!/^\d{1,18}(\.\d{1,12})?$/.test(value)||!zero&&!/[1-9]/.test(value))throw fail(400,label+'须为有效十进制数量');
 return value;
}
function fields(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw fail(400,'许可证参数无效');
}
function optional(value,label,max){return value==null||value===''?'':B.text(value,label,max);}
function form(body,product){
 fields(body,['contract_id','applied_on','proforma_no','quantity','unit_basis','unit','clearing_agent','issuing_bank','unit_price','price_unit','amount','currency','destination','note','version']);
 const basis=body.unit_basis,unit=B.text(body.unit,'计量单位',40),currency=B.text(body.currency,'币种',3).toUpperCase();
 if(!['PHYSICAL_MT','COBALT_MT','CUSTOM'].includes(basis)||basis==='COBALT_MT'&&product!==CO||!/^[A-Z]{3}$/.test(currency))throw fail(400,'计量口径或币种无效');
 return {
  applied_on:B.date(body.applied_on),proforma_no:B.text(body.proforma_no,'形式发票号',64),
  quantity:decimal(body.quantity,'批准数量'),unit_basis:basis,unit,currency,
  clearing_agent:optional(body.clearing_agent,'清关公司',160),issuing_bank:optional(body.issuing_bank,'银行',160),
  unit_price:body.unit_price?decimal(body.unit_price,'单价',true):null,price_unit:optional(body.price_unit,'计价单位',64),
  amount:body.amount?decimal(body.amount,'许可证金额',true):null,destination:optional(body.destination,'目的地',320),note:optional(body.note,'备注',1000)
 };
}
async function contract(c,req,id){
 const row=(await c.query('SELECT * FROM '+contracts+' l WHERE l.product_code=$2 AND l.id=$3 AND '+scope(),[req.user.id,req.productCode,B.uuid(id)])).rows[0];
 if(!row)throw fail(404,'销售合同不存在或超出授权范围');
 return row;
}
async function record(c,req,id,lock=false){
 const row=(await c.query('SELECT l.*,l.applied_on::text,l.valid_from::text,l.valid_until::text,l.extension_on::text,('+effective+')::text effective_until,'+status+' status FROM export_licenses l WHERE l.product_code=$2 AND l.id=$3 AND '+scope()+(lock?' FOR UPDATE OF l':''),[req.user.id,req.productCode,B.uuid(id)])).rows[0];
 if(!row)throw fail(404,'许可证不存在或超出授权范围');
 return row;
}
async function patch(c,table,id,values){
 const keys=Object.keys(values);
 await c.query('UPDATE '+table+' SET '+keys.map((key,i)=>key+'=$'+(i+2)).join(',')+' WHERE id=$1',[id,...Object.values(values)]);
}
async function detail(c,req,id){
 await record(c,req,id);
 const data=(await c.query(projection+' WHERE l.id=$1',[id])).rows[0];
 const history=(await c.query('SELECT a.*,u.display_name requester,v.display_name reviewer FROM export_license_actions a JOIN users u ON u.id=a.requested_by LEFT JOIN users v ON v.id=a.reviewed_by WHERE a.license_id=$1 ORDER BY a.requested_at DESC,a.id',[id])).rows;
 const allocations=(await c.query("SELECT a.id,a.plan_id,a.batch_id,a.invoice_no,a.reserved_quantity::text,a.used_quantity::text,a.state,a.closed_at,p.loading_id,p.posted_at,p.net_mt::text,p.estimated_metal_mt::text,p.confirmed_metal_mt::text,coalesce(d.code,cp.code) plan_no FROM export_license_allocations a LEFT JOIN export_license_postings p ON p.allocation_id=a.id LEFT JOIN loading_plan_documents d ON d.id=a.cu_plan_id LEFT JOIN co_loading_plans cp ON cp.id=a.co_plan_id WHERE a.license_id=$1 ORDER BY a.created_at,a.id",[id])).rows;
 const attachments=(await c.query('SELECT a.id,a.category,a.filename,a.mime,a.sha256,a.created_at,u.display_name uploader FROM export_license_attachments a JOIN users u ON u.id=a.created_by WHERE a.license_id=$1 ORDER BY a.created_at DESC,a.id',[id])).rows;
 return {...data,history,allocations,attachments};
}
async function list(c,req,eligible){
 const q=req.query||{},page=Number(q.page||1),filter=String(q.search||'').trim().slice(0,160);
 if(!Number.isInteger(page)||page<1||page>100000)throw fail(400,'页码无效');
 const v=[req.user.id,req.productCode],conditions=['l.product_code=$2',scope()],add=(sql,value)=>{v.push(value);conditions.push(sql.replace('?', '$'+v.length));};
 if(filter)add("strpos(lower(concat_ws(' ',l.proforma_no,l.license_no,k.contract_no,k.buyer)),lower(?))>0",filter);
 if(q.status==='EXPIRING')conditions.push(status+"='ACTIVE' AND "+effective+"<="+today+"+(SELECT expiry_days FROM export_license_preferences WHERE product_code=$2)");
 else if(q.status){if(!['APPLYING','ACTIVE','SCHEDULED','EXPIRED','CLOSED','CANCELLED'].includes(q.status))throw fail(400,'许可证状态无效');add(status+'=?',q.status);}
 if(eligible){
  const p=req.productCode===CO?await require('./cobalt-sales.cjs').access(c,req,'plan',B.uuid(q.sales_plan_id)):await require('./allocations.cjs').planAccess(c,req,B.uuid(q.sales_plan_id));
  conditions.push(status+"='ACTIVE' AND (l.quantity-t.used-t.reserved)>0");
  add('l.contract_id=?',p.contract_id);add('l.project_id=?',p.project_id);add('l.customer_id=?',p.customer_id);
  if(q.planned_load_date){add('l.valid_from<=?::date',B.date(q.planned_load_date));add(effective+'>=?::date',q.planned_load_date);}
 }
 const where=' WHERE '+conditions.join(' AND '),result=await c.query(projection+where+' ORDER BY l.created_at DESC,l.id LIMIT 50 OFFSET '+((page-1)*50),v);
 if(eligible)return {items:result.rows};
 const count=(await c.query('SELECT count(*)::int n FROM ('+projection+where+') q',v)).rows[0].n;
 const units=(await c.query("SELECT unit_basis,unit,count(*)::int licenses,sum(quantity::numeric)::text quantity,sum(used::numeric)::text used,sum(remaining::numeric)::text remaining,sum(available::numeric)::text available FROM ("+projection+" WHERE l.product_code=$2 AND "+scope()+") q WHERE status='ACTIVE' GROUP BY unit_basis,unit ORDER BY unit_basis,unit",v.slice(0,2))).rows;
 const pref=(await c.query('SELECT expiry_days FROM export_license_preferences WHERE product_code=$1',[req.productCode])).rows[0];
 const indicators=(await c.query("SELECT count(*) FILTER(WHERE status='ACTIVE')::int active,count(*) FILTER(WHERE status='ACTIVE' AND effective_until<="+today+"+$3::int)::int expiring,count(*) FILTER(WHERE status='EXPIRED' AND open_allocations=0)::int pending_close FROM ("+projection+" WHERE l.product_code=$2 AND "+scope()+") q",[...v.slice(0,2),pref.expiry_days])).rows[0];
 return {items:result.rows,total:count,page,page_size:50,units,indicators,expiry_days:pref.expiry_days};
}
async function save(c,req,id=null){
 const b=req.body,p=await contract(c,req,b?.contract_id),f=form(b,req.productCode);
 if(id){
  const l=await record(c,req,id,true);
  if(l.state!=='APPLYING'||l.version!==B.version(b.version)||l.contract_id!==p.id)throw fail(409,'许可证申请已变更，或须通过审核修改');
  if((await c.query("SELECT 1 FROM export_license_actions WHERE license_id=$1 AND decision='PENDING'",[id])).rowCount)throw fail(409,'请先完成在途审核');
  await patch(c,'export_licenses',id,{...f,version:l.version+1});
  await B.audit(c,req,'export_license_application_edited','export_licenses',id,l,f);
 }else{
  if(!p.active)throw fail(409,'销售合同已停用');
  const values={...f,product_code:req.productCode,project_id:p.project_id,customer_id:p.customer_id,[req.productCode===CO?'co_contract_id':'cu_contract_id']:p.id,created_by:req.user.id};
  const keys=Object.keys(values);
  id=(await c.query('INSERT INTO export_licenses('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING id',Object.values(values))).rows[0].id;
  await B.audit(c,req,'export_license_application_created','export_licenses',id,null,values);
 }
 return detail(c,req,id);
}
async function approvedChange(c,l,a){
 const p=a.payload;
 if(a.action==='ISSUE'){
  fields(p,['license_no','valid_from','valid_until']);
  if(l.state!=='APPLYING')throw fail(409,'仅申请中的许可证可签发');
  const from=B.date(p.valid_from),until=B.date(p.valid_until);
  if(until<from||from<l.applied_on)throw fail(400,'许可证生效与失效日期无效');
  return {license_no:B.text(p.license_no,'许可证号',160),valid_from:from,valid_until:until,state:'ISSUED'};
 }
 if(a.action==='EXTEND'){
  fields(p,['extension_on','extended_until','reference']);
  if(l.state!=='ISSUED')throw fail(409,'仅已签发许可证可延期');
  const on=B.date(p.extension_on),until=B.date(p.extended_until),current=l.effective_until;
  B.text(p.reference,'延期依据',200);
  if(until<=current||on>until||on<l.valid_from||l.extension_on&&on<l.extension_on)throw fail(400,'延期日期无效');
  return {extension_on:on,extended_until:until};
 }
 if(a.action==='AMEND'){
  fields(p,['quantity','clearing_agent','issuing_bank','unit_price','price_unit','amount','currency','destination','note']);
  if(l.state!=='ISSUED')throw fail(409,'仅已签发许可证可审核修改');
  const result={};
  for(const key of ['clearing_agent','issuing_bank','price_unit','destination','note'])if(Object.hasOwn(p,key))result[key]=optional(p[key],key,key==='note'?1000:key==='destination'?320:160);
  for(const key of ['unit_price','amount'])if(Object.hasOwn(p,key))result[key]=p[key]?decimal(p[key],key,true):null;
  if(p.currency){const value=String(p.currency).toUpperCase();if(!/^[A-Z]{3}$/.test(value))throw fail(400,'币种无效');result.currency=value;}
  if(p.quantity){result.quantity=decimal(p.quantity,'批准数量');await assertCapacity(c,l.id,null,'0',result.quantity);}
  if(!Object.keys(result).length)throw fail(400,'没有待审核的修改');
  return result;
 }
 if(a.action==='CANCEL'||a.action==='CLOSE'||a.action==='CLOSE_EXCEPTION'){
  fields(p,a.action==='CANCEL'?['reference']:['closed_on','reference']);
  B.text(p.reference,'处置依据',200);
  if(!['ISSUED','APPLYING'].includes(l.state)||a.action!=='CANCEL'&&l.state!=='ISSUED')throw fail(409,'许可证状态不允许该操作');
  const state=(await c.query(projection+' WHERE l.id=$1',[l.id])).rows[0];
  if(a.action!=='CLOSE_EXCEPTION'&&(state.open_allocations||state.remaining.startsWith('-')))throw fail(409,'存在未核销、预占或超额业务');
  if(a.action==='CANCEL')return {state:'CANCELLED'};
  const closed=B.date(p.closed_on),day=(await c.query('SELECT '+today+'::text AS local_day')).rows[0].local_day;
  if(closed>day||closed<l.valid_from)throw fail(400,'关证日期无效');
  return {state:'CLOSED',closed_on:closed};
 }
 return {};
}
async function assertCapacity(c,id,excluded,quantity,limit=null){
 const {rows:[result]}=await c.query("SELECT coalesce($4::numeric,l.quantity)>=t.used+t.reserved+$3::numeric ok FROM export_licenses l CROSS JOIN LATERAL("+totalsSQL+" AND a.id IS DISTINCT FROM $2::uuid) t WHERE l.id=$1",[id,excluded,quantity,limit]);
 if(!result?.ok)throw fail(409,'许可证可分配额度不足');
}
async function usage(c,l,a){
 const p=a.payload;
 fields(p,['allocation_id','quantity','reference']);
 B.text(p.reference,'实际核销依据',200);
 const amount=decimal(p.quantity,'实际核销数量',a.action==='CORRECT');
 const row=(await c.query('SELECT a.*,p.posted_at,('+held+')::text pending_hold FROM export_license_allocations a JOIN export_license_postings p ON p.allocation_id=a.id JOIN export_licenses l ON l.id=a.license_id WHERE a.license_id=$1 AND a.id=$2 FOR UPDATE OF a',[l.id,B.uuid(p.allocation_id)])).rows[0];
 if(!row||row.state!==(a.action==='SETTLE'?'RESERVED':'SETTLED'))throw fail(409,'只能核销已正式出库且状态有效的关联单据');
 if(a.action==='SETTLE'&&!['ISSUED','CLOSED'].includes(l.state))throw fail(409,'许可证状态不允许核销');
 const positive=/[1-9]/.test(amount);
 await assertCapacity(c,l.id,row.id,positive?amount:row.pending_hold);
 if(positive){
  await patch(c,'export_license_allocations',row.id,{state:'SETTLED',used_quantity:amount,closed_at:new Date()});
 }else await patch(c,'export_license_allocations',row.id,{state:'RESERVED',used_quantity:'0',closed_at:null});
 return {allocation_id:row.id,old_quantity:row.used_quantity,new_quantity:amount};
}
async function requestAction(c,req,id){
 const l=await record(c,req,id,true),b=req.body;
 fields(b,['action','payload','reason','version']);
 if(!actions.includes(b.action)||!b.payload||Array.isArray(b.payload)||typeof b.payload!=='object'||l.version!==B.version(b.version))throw fail(409,'审核申请状态或版本无效');
 if(!['SETTLE','CORRECT'].includes(b.action))await approvedChange(c,l,{action:b.action,payload:b.payload});
 const a=(await c.query('INSERT INTO export_license_actions(license_id,action,payload,reason,requested_by) VALUES($1,$2,$3,$4,$5) RETURNING *',[id,b.action,b.payload,B.text(b.reason,'申请原因',1000),req.user.id])).rows[0];
 await B.audit(c,req,'export_license_action_requested','export_licenses',id,null,a);
 return a;
}
async function review(c,req,id,actionId){
 const l=await record(c,req,id,true),b=req.body;
 fields(b,['decision','note']);
 const a=(await c.query('SELECT * FROM export_license_actions WHERE id=$1 AND license_id=$2 FOR UPDATE',[B.uuid(actionId),id])).rows[0];
 if(!a||a.decision!=='PENDING'||a.requested_by===req.user.id||!['APPROVED','REJECTED'].includes(b.decision))throw fail(409,'审核状态无效或需要独立审核人');
 let result=null;
 if(b.decision==='APPROVED'){
  result=['SETTLE','CORRECT'].includes(a.action)?await usage(c,l,a):await approvedChange(c,l,a);
  await patch(c,'export_licenses',id,{...(['SETTLE','CORRECT'].includes(a.action)?{}:result),version:l.version+1});
 }
 await patch(c,'export_license_actions',a.id,{decision:b.decision,reviewed_by:req.user.id,reviewed_at:new Date(),review_note:B.text(b.note,'审核意见',1000),result});
 await B.audit(c,req,'export_license_action_reviewed','export_licenses',id,{id:a.id,state:l.state},{action:a.action,decision:b.decision,result});
 return detail(c,req,id);
}
function fileData(b){
 fields(b,['category','filename','base64']);
 if(!categories.includes(b.category)||typeof b.base64!=='string'||b.base64.length>349528||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.base64))throw fail(400,'附件须为不超过256KiB的PDF、PNG或JPEG');
 const content=Buffer.from(b.base64,'base64'),filename=B.text(b.filename,'附件名',120).replace(/[^\p{L}\p{N}._ -]/gu,'_');
 const mime=content.subarray(0,5).toString()==='%PDF-'?'application/pdf':content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':content[0]===255&&content[1]===216&&content[2]===255?'image/jpeg':null;
 if(!mime||content.length>262144)throw fail(400,'附件格式或大小无效');
 return {content,filename,mime,sha256:createHash('sha256').update(content).digest('hex')};
}
function register({app,pool,permitted,csrf}){
 for(const prefix of ['/api/v1/export-permits','/api/v1/cobalt/export-permits']){
  const mutation=(permission,fn)=>({preHandler:[permitted(read),permitted(permission),csrf],handler:req=>B.mutate(pool,req,c=>fn(c,req))});
  app.get(prefix,{preHandler:permitted(read)},req=>C.readTransaction(pool,c=>list(c,req,false)));
  app.get(prefix+'/options',{preHandler:permitted('loading-plan:read')},req=>C.readTransaction(pool,c=>list(c,req,true)));
  app.get(prefix+'/operations/status',{preHandler:permitted(read)},req=>C.readTransaction(pool,async c=>{
   const {method,path,key}=req.query,base=prefix.slice('/api/v1'.length),target=typeof path==='string'&&path.startsWith(base)?path.slice(base.length):null;
   const matched=target!==null&&/^\/([0-9a-f-]{36})(?:\/(?:actions(?:\/[0-9a-f-]{36})?|attachments))?$/i.exec(target);
   const accepted=method==='POST'&&(target===''||target==='/preferences'||matched&&target.includes('/',1))||method==='PATCH'&&matched&&!target.includes('/',1);
   if(!accepted||typeof key!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(key))throw fail(400,'操作查询参数无效');
   const {rows:[receipt]}=await c.query('SELECT response FROM idempotency_requests WHERE actor_id=$1 AND route=$2 AND key=$3',[req.user.id,method+' /api/v1'+path,key]);
   const license=matched?.[1]||target===''&&receipt?.response.id;
   if(license)await record(c,req,license);
   return {committed:!!receipt};
  }));
  app.get(prefix+'/contracts',{preHandler:permitted(read)},async req=>({items:(await pool.query('SELECT id,project_id,customer_id,contract_no,buyer FROM '+contracts+' l WHERE product_code=$2 AND active AND '+scope()+' ORDER BY buyer,contract_no LIMIT 500',[req.user.id,req.productCode])).rows}));
  app.get(prefix+'/:id',{preHandler:permitted(read)},req=>C.readTransaction(pool,c=>detail(c,req,req.params.id)));
  app.route({method:'POST',url:prefix,...mutation(write,(c,req)=>save(c,req))});
  app.route({method:'PATCH',url:prefix+'/:id',...mutation(write,(c,req)=>save(c,req,req.params.id))});
  app.route({method:'POST',url:prefix+'/:id/actions',...mutation(write,(c,req)=>requestAction(c,req,req.params.id))});
  app.route({method:'POST',url:prefix+'/:id/actions/:action',...mutation(approve,(c,req)=>review(c,req,req.params.id,req.params.action))});
  app.route({method:'POST',url:prefix+'/preferences',...mutation('system:manage',async(c,req)=>{
   const n=req.body?.expiry_days;if(!Number.isInteger(n)||n<1||n>365)throw fail(400,'到期提醒范围为1至365天');
   await c.query('UPDATE export_license_preferences SET expiry_days=$2,updated_by=$3 WHERE product_code=$1',[req.productCode,n,req.user.id]);return {expiry_days:n};
  })});
  app.route({method:'POST',url:prefix+'/:id/attachments',...mutation(write,async(c,req)=>{
   const l=await record(c,req,req.params.id,true),b=req.body,f=fileData(b);
   if(['CLOSED','CANCELLED'].includes(l.state)&&!req.user.permissions.includes(approve))throw fail(409,'已结束许可证附件须由审核人员补录');
   const {rows:[r]}=await c.query('INSERT INTO export_license_attachments(license_id,category,filename,mime,content,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,category,filename,sha256,created_at',[l.id,b.category,f.filename,f.mime,f.content,f.sha256,req.user.id]);
   await B.audit(c,req,'export_license_attachment_added','export_licenses',l.id,null,r);return r;
  })});
  app.get(prefix+'/:id/attachments/:file',{preHandler:permitted(read)},async(req,reply)=>{
   await record(pool,req,req.params.id);
   const {rows:[file]}=await pool.query('SELECT filename,content,sha256 FROM export_license_attachments WHERE id=$1 AND license_id=$2',[B.uuid(req.params.file),req.params.id]);
   if(!file)throw fail(404,'附件不存在');
   if(createHash('sha256').update(file.content).digest('hex')!==file.sha256)throw fail(409,'附件完整性校验失败');
   return reply.header('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.filename)).type('application/octet-stream').send(file.content);
  });
 }
}

module.exports={register,allowed,record,assertCapacity,decimal,detail};
