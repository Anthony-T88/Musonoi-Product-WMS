'use strict';
const B=require('./business-common.cjs');
const Lease=require('./authorization-lease.cjs');
const guid='[0-9a-f-]{36}';
const cu='CU_CATHODE',co='CO_HYDROXIDE';
const specs={
 'preparation-plan-form':{path:'/preparation/work-plans(?:/'+guid+')?',module:'preparation',permissions:['plan:read'],roles:['admin','export_supervisor'],target:'preparation_plans'},
 'v26-receipt':{path:'/receipts/new',module:'receipts',permissions:['receipt:write'],product:cu},
 'receipt-editor':{path:'/receipts/'+guid+'/edit',module:'receipts',permissions:['receipt:write'],product:cu,target:'receipts'},
 'v26-preparation':{path:'/preparation/new',module:'preparation',permissions:['allocation:write'],product:cu},
 'v261-create':{path:'/preparation/new',module:'preparation',permissions:['allocation:write'],product:cu},
 'co-create':{path:'/receipts/new|/preparation/new',module:'preparation',permissions:['co:create'],product:co},
 'co469-work-draft':{path:'/(?:receipts|preparation)/'+guid+'(?:/work)?',module:'preparation',permissions:['co:work-edit'],product:co,target:'co_preparations'},
 'single-plan-form':{path:'/loading-plans/(?:new|orders/'+guid+'/edit)',module:'loading-plans',permissions:['loading-plan:write'],product:cu,target:'loading_plan_documents'},
 'yard-arrival-form':{path:'/loading-plans',module:'loading-plans',permissions:['vehicle-arrival:write'],product:cu,vehicle:'sales_dispatch_vehicles'},
 'co-arrival-form':{path:'/loading-plans',module:'loading-plans',permissions:['vehicle-arrival:write'],product:co,vehicle:'co_dispatch_vehicles'},
 'co-loading-form':{path:'/loading-plans/(?:new|'+guid+'/edit)',module:'loading-plans',permissions:['loading-plan:write'],product:co,target:'co_loading_plans'},
 'co-loading-documents':{path:'/loading-plans/orders/'+guid,module:'loading-plans',permissions:['loading-plan:write'],product:co,target:'co_loading_plans'},
 'v26-load':{path:'/outbounds/loads/new',module:'outbounds',permissions:['load:write'],product:cu},
 'lp-load-form':{path:'/outbounds/loads/(?:new|'+guid+'/matching)',module:'outbounds',permissions:['loading-plan:match','load:write'],product:cu,target:'loading_orders'},
 'pending-load-edit':{path:'/outbounds/loads/'+guid+'(?:/edit)?',module:'outbounds',permissions:['load:write'],product:cu,target:'loading_orders'},
 'cu-departure-draft':{path:'/outbounds/loads/'+guid,module:'outbounds',permissions:['load:execute'],product:cu,target:'loading_orders'},
 'co-execution-departure':{path:'/outbounds/'+guid+'|/loading-plans/execution/'+guid,module:'outbounds',permissions:['load:execute'],product:co,target:'co_loading_orders'},
 'v27-count-create':{path:'/stocktaking/new',module:'stocktaking',permissions:['stocktake:write'],product:cu},
 'v33-count-create':{path:'/stocktaking/new',module:'stocktaking',permissions:['stocktake:write'],product:cu},
 'co-count-create':{path:'/stocktaking/new',module:'stocktaking',permissions:['stocktake:write'],product:co},
 'v27-observation':{path:'/stocktaking/'+guid,module:'stocktaking',permissions:['stocktake:write'],product:cu,target:'stocktakes'},
 'co-count-record':{path:'/stocktaking/'+guid,module:'stocktaking',permissions:['stocktake:write'],product:co,target:'co_stocktakes'},
 'export-license-application':{path:'/export-licenses/(?:new|'+guid+'/edit)',module:'export-licenses',permissions:['export-license:write'],target:'export_licenses'},
 'permit-extension-form':{path:'/export-licenses/'+guid,module:'export-licenses',permissions:['export-license:write'],target:'export_licenses'},
 'shipping-generate':{path:'/export-shipments/'+guid+'|/outbounds/packing-list/'+guid,module:'outbounds',permissions:['document:generate','inventory:export','load:read'],product:cu,target:'loading_orders'},
 'co-packing-generate':{path:'/outbounds/'+guid+'/packing-list',module:'outbounds',permissions:['document:generate','inventory:export'],product:co,target:'co_loading_orders'},
 'ux10-plan-form':{path:'/sales-plans/(?:new|'+guid+'/edit)',module:'sales-plans',permissions:['plan:write'],product:cu,target:'sales_plans'},
 'co-sales-plan-form':{path:'/sales-plans/(?:new|'+guid+'/edit)',module:'sales-plans',permissions:['plan:write'],product:co,target:'co_sales_plans'}
};
const allowed=(path,method)=>/^\/api\/v1\/cobalt\/document-drafts(?:\/[0-9a-f-]{36})?$/.test(path)&&['GET','PUT','DELETE'].includes(method);
const can=(req,spec)=>spec&&(!spec.product||spec.product===req.productCode)&&
 (!spec.roles||spec.roles.includes(req.user.role_code))&&spec.permissions.every(permission=>req.user.permissions.includes(permission));
const refNames={
 project_id:['projects','projects'],warehouse_id:['warehouses','warehouses'],
 customer_id:['copper_customers','co_customer_profiles'],contract_id:['customer_contracts','co_sales_contracts'],
 sales_plan_id:['sales_plans','co_sales_plans'],plan_id:['sales_plans','co_sales_plans'],'v26-plan':['sales_plans','co_sales_plans'],
 preparation_id:[null,'co_preparations'],preparation_plan:['preparation_plans','preparation_plans'],
 allocation_id:['allocations',null],allocation_ids:['allocations',null],
 document_id:['loading_plan_documents','co_loading_plans'],
 receipt_id:['receipts','co_preparations'],location_id:['locations','co_locations'],
 actual_location_id:['locations','co_locations'],planned_location_id:['locations','co_locations'],
 assigned_to:['users','users'],
 arrival_id:['vehicle_arrivals','co_vehicle_arrivals'],new_arrival_id:['vehicle_arrivals','co_vehicle_arrivals'],
 export_license_id:['export_licenses','export_licenses'],license_id:['export_licenses','export_licenses'],
 replaces:['loading_orders','co_loading_orders'],bundle_id:['bundles',null],bag_id:[null,'co_bags'],
 'receipt-fixed-customer':['copper_customers',null],'receipt-fixed-location':['locations',null],
 'v261-planned':['locations',null]
};
const paths={
 allocations:'JOIN sales_plans p ON p.id=x.plan_id',loading_plan_documents:'JOIN loading_plan_groups g ON g.id=x.group_id JOIN sales_plans p ON p.id=g.sales_plan_id',
 co_loading_plans:'JOIN co_sales_plans p ON p.id=x.sales_plan_id',co_loading_orders:'JOIN co_sales_plans p ON p.id=x.sales_plan_id',
 co_bags:'JOIN co_preparations p ON p.id=x.preparation_id',
 sales_dispatch_vehicles:'JOIN sales_dispatch_imports i ON i.id=x.import_id JOIN sales_plans p ON p.id=i.sales_plan_id',
 co_dispatch_vehicles:'JOIN co_sales_plans p ON p.id=x.sales_plan_id'
};
function checkRoute(req,key,input){
 const spec=Object.hasOwn(specs,key)?specs[key]:null;
 if(!can(req,spec))throw B.error(403,'无权保存此类单据草稿');
 if(typeof input!=='string'||!input.startsWith('/')||input.startsWith('//')||input.length>500)throw B.error(400,'草稿页面无效');
 const route=new URL(input,'http://draft.local');
 if(!new RegExp('^(?:'+spec.path+')$','i').test(route.pathname)||route.hash||route.origin!=='http://draft.local')throw B.error(400,'草稿页面无效');
 if(spec.vehicle&&!route.searchParams.get('vehicle_id'))throw B.error(400,'草稿缺少派车记录');
 for(const [name,value] of route.searchParams){
  if(name==='bag_page'&&/^[1-9]\d{0,5}$/.test(value))continue;
  if(key==='co-count-record'&&name==='page'&&/^[1-9]\d{0,5}$/.test(value))continue;
  if(spec.vehicle&&(name==='vehicle_id'&&new RegExp('^'+guid+'$','i').test(value)||
   name==='tab'&&value==='arrivals'||name==='shipment_month'&&/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)))continue;
  if(!['preparation_plan','replaces','document_id','sales_plan_id'].includes(name)||!value)throw B.error(400,'草稿页面参数无效');
 }
 return {spec,route};
}
async function reference(c,req,table,id){
 if(table==='users'){
  const {rowCount}=await c.query(`SELECT 1 FROM users u JOIN user_scopes target ON target.user_id=u.id
   JOIN user_scopes actor ON actor.user_id=$1 AND actor.project_id=target.project_id
   WHERE u.id=$2 AND u.active AND u.deleted_at IS NULL
   AND (actor.warehouse_id IS NULL OR actor.warehouse_id=target.warehouse_id)
   AND (actor.customer_id IS NULL OR actor.customer_id=target.customer_id) LIMIT 1`,[req.user.id,B.uuid(id)]);
  if(!rowCount)throw B.error(404,'草稿指派人员不存在或超出授权');
  return null;
 }
 const relation=paths[table],fields=relation?'to_jsonb(p.*)||to_jsonb(x.*)':'to_jsonb(x.*)';
 const {rows:[row]}=await c.query('SELECT '+fields+' obj FROM '+table+' x '+(relation||'')+' WHERE x.id=$1',[B.uuid(id)]);
 const data=row?.obj;
 if(!data||data.product_code&&data.product_code!==req.productCode)throw B.error(404,'草稿关联对象不存在或超出授权');
 const project=table==='projects'?id:data.project_id;
 if(!project)throw B.error(400,'草稿关联对象缺少项目');
 const customer=['copper_customers','co_customer_profiles'].includes(table)?id:data.customer_id||null;
 const warehouse=table==='warehouses'?id:data.warehouse_id||null;
 await B.scope(c,req,project,warehouse,customer);
 return data;
}
const types=new Set(['text','textarea','search','select-one','select-multiple','number','date','month','datetime-local','time','checkbox','radio','email','tel','url']);
function fieldValue(entry){
 if(!Array.isArray(entry)||entry.length!==4)throw B.error(400,'草稿字段格式无效');
 const [key,index,type,value]=entry;
 const validValue=['checkbox','radio'].includes(type)?typeof value==='boolean':type==='select-multiple'?
  Array.isArray(value)&&value.length<=500&&value.every(item=>typeof item==='string'&&item.length<=100):typeof value==='string'&&value.length<=10000;
 if(typeof key!=='string'||!/^[-\w:]{1,100}$/.test(key)||!Number.isInteger(index)||index<0||index>9999||
  !types.has(type)||!validValue)throw B.error(400,'草稿字段格式无效');
 if(typeof value!=='string'||!value)return;
 if(type==='number'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)||
  type==='month'&&!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(value)||
  type==='datetime-local'&&!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))throw B.error(400,'草稿字段数据类型无效');
 if(type==='date')B.date(value);
}
async function validate(c,req,key,route,fields){
 const {spec,route:path}=checkRoute(req,key,route);
 if(!Array.isArray(fields)||fields.length>10000||Buffer.byteLength(JSON.stringify(fields))>512000)throw B.error(400,'草稿内容格式无效或超出限制');
 const checks=new Map(),target=path.pathname.match(new RegExp(guid,'i'))?.[0],index=req.productCode===co?1:0;
 if(spec.vehicle)await reference(c,req,spec.vehicle,path.searchParams.get('vehicle_id'));
 if(target&&spec.target){
  const record=await reference(c,req,spec.target,target);
  if(key==='preparation-plan-form'&&(record.created_by!==req.user.id||!['DRAFT','REJECTED'].includes(record.state)))
   throw B.error(409,'该备货计划已不在可编辑状态');
 }
 const add=(name,value)=>{
  const table=refNames[name]?.[index];
  if(table&&value)checks.set(table+'|'+value,[table,value]);
 };
 for(const [name,value] of path.searchParams)add(name,value);
 for(const field of fields){
  fieldValue(field);
  const [name,,type,value]=field;
  if(typeof value==='string'&&value)add(name,value);
  if(type==='select-multiple'&&Array.isArray(value))for(const item of value)add(name,item);
  if(type==='checkbox'&&value===true&&/^(load-pick|pick):/.test(name))add('bundle_id',name.slice(name.indexOf(':')+1));
  if(/^bundle:/.test(name))add('bundle_id',name.slice(name.indexOf(':')+1));
  if(/^bag-(?:version|gross|seal|sample):/.test(name))add('bag_id',name.slice(name.indexOf(':')+1));
  if(key==='co-count-record'&&/^count-(?:present|location|gross|note):/.test(name)){
   add('bag_id',name.slice(name.indexOf(':')+1));
   if(name.startsWith('count-location:'))add('actual_location_id',value);
  }
  if(/^book:/.test(name)&&value&&value!=='legacy')checks.set('book|'+value,['export_license_record_books',value]);
 }
 if(checks.size>1500)throw B.error(400,'草稿关联项过多');
 for(const [table,id] of checks.values())await reference(c,req,table,id);
}
async function transaction(pool,fn){
 const c=await pool.connect();
 try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}
 catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
const owner=(req,id)=>[req.user.id,req.productCode,B.uuid(id)];
async function get(c,req,id,lock=false){
 const {rows:[row]}=await c.query('SELECT * FROM document_drafts WHERE actor_id=$1 AND product_code=$2 AND id=$3 AND closed_at IS NULL'+(lock?' FOR UPDATE':''),owner(req,id));
 if(!row)throw B.error(404,'草稿不存在或超出授权');
 return row;
}
function register({app,pool,auth,csrf}){
 for(const prefix of ['/api/v1/document-drafts','/api/v1/cobalt/document-drafts']){
  app.get(prefix,{preHandler:auth},async req=>{
   const keys=Object.keys(specs).filter(key=>can(req,specs[key])&&(!req.query.module||specs[key].module===req.query.module));
   const {rows}=await pool.query(`SELECT id,form_key,route,version,updated_at,
    (SELECT left(item->>3,160) FROM jsonb_array_elements(fields) WITH ORDINALITY field(item, position)
     WHERE item->>0 IN ('batch_no','preparation_batch_no','document_no','invoice_no','proforma_no','code','title','truck_no')
      AND jsonb_typeof(item->3)='string' AND nullif(trim(item->>3),'') IS NOT NULL ORDER BY position LIMIT 1) AS display_no
    FROM document_drafts WHERE actor_id=$1 AND product_code=$2 AND closed_at IS NULL AND form_key=ANY($3::text[])
    ORDER BY updated_at DESC,id LIMIT 100`,
    [req.user.id,req.productCode,keys]);
   return {items:rows};
  });
  app.get(prefix+'/:id',{preHandler:auth},req=>transaction(pool,async c=>{
   const row=await get(c,req,req.params.id);await validate(c,req,row.form_key,row.route,row.fields);return row;
  }));
  app.put(prefix+'/:id',{preHandler:[auth,csrf]},req=>transaction(pool,async c=>{
   await Lease.lockBusiness(c,req);
   const values=owner(req,req.params.id),body=req.body||{};
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[values[2]]);
   await validate(c,req,body.form_key,body.route,body.fields);
   const {rows:[prior]}=await c.query('SELECT * FROM document_drafts WHERE id=$1',[values[2]]);
   if(prior&&(prior.actor_id!==values[0]||prior.product_code!==values[1]||prior.closed_at))throw B.error(404,'草稿不存在或超出授权');
   const fields=JSON.stringify(body.fields);
   if(prior){
    if(prior.form_key!==body.form_key||prior.route!==body.route)throw B.error(409,'草稿页面已变化');
    if(JSON.stringify(prior.fields)===fields)return prior;
    if(prior.version!==body.version)throw B.error(409,'草稿已在另一窗口更新，请重新打开');
   }else if(body.version!==0)throw B.error(409,'草稿版本无效');
   const {rows:[saved]}=prior?await c.query('UPDATE document_drafts SET fields=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',[values[2],fields]):
    await c.query('INSERT INTO document_drafts(actor_id,product_code,id,form_key,route,fields) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[...values,body.form_key,body.route,fields]);
   await B.audit(c,req,prior?'document_draft_updated':'document_draft_saved','document_drafts',saved.id,null,{form_key:saved.form_key,version:saved.version,product_code:saved.product_code});
   Lease.healthy(req);
   return saved;
  }));
  app.delete(prefix+'/:id',{preHandler:[auth,csrf]},req=>transaction(pool,async c=>{
   await Lease.lockBusiness(c,req);
   const prior=await get(c,req,req.params.id,true);
   if(!can(req,specs[prior.form_key]))throw B.error(403,'无权删除此类单据草稿');
   if(prior.version!==req.body?.version)throw B.error(409,'草稿版本已变化');
   await c.query("UPDATE document_drafts SET closed_at=clock_timestamp(),fields='[]'::jsonb WHERE id=$1",[prior.id]);
   await B.audit(c,req,'document_draft_closed','document_drafts',prior.id,null,{form_key:prior.form_key,version:prior.version});
   Lease.healthy(req);
   return {closed:true};
  }));
 }
}
module.exports={allowed,register};
