'use strict';
const B=require('./business-common.cjs'),C=require('./cobalt.cjs'),D=require('./sales-dispatch.cjs'),crypto=require('crypto'),canonical=require('./cobalt-stock.cjs').canonical;
const Month=require('./dispatch-month.cjs'),Transport=require('./dispatch-transport.cjs');
const History=require('./historical-sales.cjs');
const {truckKey}=Transport;
const prefix='/api/v1/cobalt/sales',id='[0-9a-fA-F-]{36}';
const allowed=(p,m)=>m==='GET'&&new RegExp('^'+prefix+'/(options|customers|contracts|contracts/'+id+'|plans|plans/'+id+'|plans/'+id+'/dispatch|arrivals|history)$').test(p)||m==='POST'&&new RegExp('^'+prefix+'/(arrivals/export|customers|customers/'+id+'|contracts|contracts/'+id+'|plans|plans/'+id+'|plans/'+id+'/dispatch/(import-preview|import|vehicles|vehicles/'+id+'/month)|vehicles/'+id+'(?:/cancel)?|arrivals/'+id+')$').test(p);
const enabled=async c=>(await c.query("SELECT to_regclass('public.co_sales_plans') IS NOT NULL ok")).rows[0].ok;
const error=(s,k)=>B.error(s,k),fields=(b,keys)=>{if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!keys.includes(k)))throw error(400,'CO_SALES_INPUT');};
const visible=(a='p',warehouse=true)=>`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=${a}.project_id ${warehouse?`AND(s.warehouse_id IS NULL OR s.warehouse_id=${a}.warehouse_id)`:''} AND(s.customer_id IS NULL OR s.customer_id=${a}.customer_id))`;
async function access(c,req,entity,idValue,lock=false){const table={plan:'co_sales_plans',contract:'co_sales_contracts'}[entity],row=(await c.query(`SELECT p.* FROM ${table} p WHERE p.id=$2 AND ${visible('p',entity==='plan')}${lock?' FOR UPDATE OF p':''}`,[req.user.id,B.uuid(idValue)])).rows[0];if(!row)throw error(404,'CO_SALES_NOT_FOUND');return row;}
const metadata=p=>({project_id:p.project_id,warehouse_id:p.warehouse_id||null,customer_id:p.customer_id||p.id});
async function mutation(pool,req,permission,fn){if(req.productCode!=='CO_HYDROXIDE')throw error(409,'CO_PRODUCT_REQUIRED');const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(key))throw error(400,'CO_IDEMPOTENCY_REQUIRED');const c=await pool.connect(),route=req.method+' '+req.url.split('?')[0],hash=crypto.createHash('sha256').update(JSON.stringify(canonical(req.body))).digest('hex');try{await c.query('BEGIN');await require('./authorization-lease.cjs').lockBusiness(c,req);if(!(await c.query('SELECT 1 FROM users u JOIN role_permissions r ON r.role_code=u.role_code WHERE u.id=$1 AND u.active AND u.deleted_at IS NULL AND r.permission_code=$2',[req.user.id,permission])).rowCount)throw error(403,'CO_PERMISSION_DENIED');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.user.id+route+key]);const old=(await c.query('SELECT * FROM co_requests WHERE actor_id=$1 AND route=$2 AND key=$3',[req.user.id,route,key])).rows[0];if(old){if(old.request_hash!==hash)throw error(409,'CO_KEY_REUSED');await B.scope(c,req,old.response.project_id,old.response.warehouse_id,old.response.customer_id);require('./authorization-lease.cjs').healthy(req);await c.query('COMMIT');return old.response;}const result=await fn(c);await c.query('INSERT INTO co_requests(actor_id,route,key,request_hash,response) VALUES($1,$2,$3,$4,$5)',[req.user.id,route,key,hash,result]);require('./authorization-lease.cjs').healthy(req);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');if(e.code==='23514'&&/^CO_(LOADING|EXECUTION|PACKING|METAL)_[A-Z_]+$/.test(e.message))throw B.error(409,e.message);if(['23505','23503','23514','40001','40P01'].includes(e.code))throw error(409,'CO_SALES_CONFLICT');throw e;}finally{c.release();}}
function month(v){if(typeof v!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(v))throw error(400,'CO_SALES_MONTH');return v;}
function optional(v,n){if(v===undefined)return '';if(typeof v!=='string'||v.length>n||/[\x00-\x1f]/.test(v))throw error(400,'CO_SALES_INPUT');return v.trim();}
const plate=v=>B.text(v,'CO_SALES_PLATE',80).toUpperCase();
async function filter(c,req,arrivals=false){const q=req.query||{},values=[req.user.id],where=[visible()];for(const k of ['project_id','warehouse_id','customer_id','sales_plan_id'])if(q[k])B.uuid(q[k]);if(q.sales_plan_id)await access(c,req,'plan',q.sales_plan_id);if(q.warehouse_id){const w=(await c.query('SELECT * FROM warehouses WHERE id=$1',[q.warehouse_id])).rows[0];if(!w)throw error(403,'CO_SALES_SCOPE');await B.scope(c,req,w.project_id,w.id,q.customer_id||null);if(q.project_id&&q.project_id!==w.project_id)throw error(403,'CO_SALES_SCOPE');}else if(q.project_id&&!(await c.query('SELECT 1 FROM user_scopes WHERE user_id=$1 AND project_id=$2',[req.user.id,q.project_id])).rowCount)throw error(403,'CO_SALES_SCOPE');const add=(sql,v)=>{values.push(v);where.push(sql.replace('?', '$'+values.length));};for(const k of ['project_id','warehouse_id','customer_id'])if(q[k])add('p.'+k+'=?',q[k]);if(q.sales_plan_id)add('p.id=?',q.sales_plan_id);if(q.shipment_month&&!arrivals)add('p.shipment_month=?',month(q.shipment_month));if(q.search)add("strpos(lower(p.code||' '||c.name||' '||k.contract_no),lower(?))>0",B.text(q.search,'CO_SALES_SEARCH',160));if(q.status){if(!['OPEN','CLOSED'].includes(q.status))throw error(400,'CO_SALES_INPUT');add('p.status=?',q.status);}const page=Number(q.page||1);if(!Number.isInteger(page)||page<1||page>100000)throw error(400,'CO_SALES_INPUT');return {where:where.join(' AND '),values,page};}
const plansSql=`FROM co_sales_plans p JOIN co_customer_profiles c ON c.id=p.customer_id JOIN co_sales_contracts k ON k.id=p.contract_id`;
const planSelect=`SELECT p.*,(SELECT display_name FROM users WHERE id=p.created_by) creator_name,c.name customer_name,k.contract_no,
 (SELECT count(*)::int FROM co_dispatch_vehicles v WHERE v.sales_plan_id=p.id AND v.cancelled_at IS NULL) dispatched_vehicles,
 (SELECT count(*)::int FROM co_dispatch_vehicles v WHERE v.sales_plan_id=p.id AND v.cancelled_at IS NULL
   AND (${History.arrivalExists(true,'v.id')} OR EXISTS(SELECT 1 FROM co_vehicle_arrivals a
    WHERE a.dispatch_vehicle_id=v.id AND a.registration_phase='CONFIRMED'))) arrived_vehicles ${plansSql}`;
async function vehicle(c,req,vid){const v=(await c.query('SELECT * FROM co_dispatch_vehicles WHERE id=$1',[B.uuid(vid)])).rows[0];if(!v)throw error(404,'CO_SALES_NOT_FOUND');const p=await access(c,req,'plan',v.sales_plan_id,true);const locked=(await c.query('SELECT * FROM co_dispatch_vehicles WHERE id=$1 FOR UPDATE',[v.id])).rows[0];if(locked.sales_plan_id!==p.id)throw error(409,'CO_SALES_STALE');if(p.status!=='OPEN'||locked.cancelled_at)throw error(409,'CO_SALES_LOCKED');return {v:locked,p};}
function vehicleFields(b){const v={trailer_no:optional(b.trailer_no,80),transporter:optional(b.transporter,160),destination:optional(b.destination,1000),driver_name:optional(b.driver_name,160),passport_no:optional(b.passport_no,80),remark:optional(b.remark,1000),planned_arrival_date:b.planned_arrival_date?B.date(b.planned_arrival_date):null,capacity_tonnes:b.capacity_tonnes===undefined||b.capacity_tonnes===null||b.capacity_tonnes===''?null:D.capacity(b.capacity_tonnes)};return v;}
async function saveVehicle(c,req,p,b,source=null){const truck=plate(b.truck_no),f=vehicleFields(b),columns=['sales_plan_id','shipment_month','truck_no','created_by','updated_by',...Object.keys(f)],values=[p.id,source?b.shipment_month:Month.effective(p,b.shipment_month),truck,req.user.id,req.user.id,...Object.values(f)];if(source){Object.assign(f,{});columns.push('import_id','source_row','source_sheet');values.push(source.id,b.source_row,source.sheet);}return (await c.query('INSERT INTO co_dispatch_vehicles('+columns.join(',')+') VALUES('+values.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',values)).rows[0];}
async function importPlan(c,req,plan,body,parsed){
 const month=Transport.importMonth(plan,body);
 const original=await Transport.assertImportAvailable(c,req,plan,parsed,{co:true,transportOnly:body.transport_only});
 let cancelled_count=0;
 for(const item of body.transport_only?[]:parsed.cancelled||[]){
  const changed=await c.query(`UPDATE co_dispatch_vehicles SET cancelled_at=clock_timestamp(),cancellation_reason=$4,
   version=version+1,updated_by=$5,updated_at=clock_timestamp()
   WHERE sales_plan_id=$1 AND shipment_month=$2 AND truck_key=$3 AND cancelled_at IS NULL
    AND NOT ${History.arrivalExists(true,'co_dispatch_vehicles.id')}`,
   [plan.id,month,truckKey(item.truck_no||''),item.reason||'Cancelled in dispatch file',req.user.id]);
  cancelled_count+=changed.rowCount;
 }
 const {fresh,restores,updates,tally}=await Transport.analyzeImport(c,plan.id,month,parsed.items,
  {co:true,transportOnly:body.transport_only,lock:true,restoreFrom:original?parsed:null});
 await Transport.fillFromImport(c,req,plan,month,body,parsed,updates,true);
 let imported=null;
 const dispatchIds=await Transport.restoreFromImport(c,req,plan,month,parsed,restores,true);
 if(fresh.length){
  imported=(await c.query('INSERT INTO co_dispatch_imports(sales_plan_id,shipment_month,file_name,file_sha256,row_count,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING *',
   [plan.id,month,body.file_name,parsed.file_sha256,fresh.length,req.user.id])).rows[0];
  for(const item of fresh){
   const vehicle=await saveVehicle(c,req,plan,{...item,shipment_month:month},{id:imported.id,sheet:parsed.mapping.sheet});
   dispatchIds.push(vehicle.id);
  }
 }
 const {new_count:added_count,...results}=tally;
 const historical=await History.afterDispatchImport(c,req,plan,dispatchIds);
 return {id:plan.id,...metadata(plan),import_id:imported?.id||null,added_count,...results,cancelled_count,...(historical?{historical}:{})};
}
const transferHistory=`EXISTS(SELECT 1 FROM co_vehicle_arrivals a WHERE a.dispatch_vehicle_id=v.id)
 OR EXISTS(SELECT 1 FROM historical_sales_dispatch_links h WHERE h.co_dispatch_id=v.id)`;
async function listDispatch(c,req){
 const plan=await access(c,req,'plan',req.params.id),shipmentMonth=req.query.shipment_month?month(req.query.shipment_month):null;
 const {rows:vehicles}=await c.query(`SELECT v.*,${Transport.cobaltTransportLocked} transport_locked,a.id arrival_id,a.arrived_at,
  h.source_id historical_source_id,
  v.cancelled_at IS NULL AND removal.blocker IS NULL can_cancel,
  h.source_id IS NOT NULL AND removal.blocker IS NULL historical_auto_detach,
  removal.blocker removal_blocker,
  NOT (${transferHistory}) AND v.cancelled_at IS NULL can_transfer,
  CASE WHEN v.cancelled_at IS NOT NULL THEN 'CANCELLED' WHEN h.source_id IS NOT NULL THEN 'HISTORICAL_ARRIVED'
   WHEN a.registration_phase='DRAFT' OR arrival_legacy_draft('CO_HYDROXIDE',v.id,a.updated_at) THEN 'PENDING_CONFIRMATION'
   WHEN a.registration_phase='CONFIRMED' THEN 'WAITING_PLAN' ELSE 'WAITING_ARRIVAL' END arrival_state
  FROM co_dispatch_vehicles v LEFT JOIN co_vehicle_arrivals a ON a.dispatch_vehicle_id=v.id
  LEFT JOIN historical_sales_arrivals h ON h.co_dispatch_id=v.id
  CROSS JOIN LATERAL (SELECT coalesce(cobalt_dispatch_online_blocker(v.id),
   ${History.removalBlocker('h','$3','$4','$5','$6::uuid')},CASE WHEN NOT $7::boolean THEN 'PLAN_CLOSED' END) blocker) removal
  WHERE v.sales_plan_id=$1 AND ($2::text IS NULL OR v.shipment_month=$2) ORDER BY v.created_at DESC,v.id`,
  [plan.id,shipmentMonth,req.user.id,plan.project_id,plan.customer_id,plan.warehouse_id,plan.status==='OPEN']);
 const byImport=new Map();
 for(const v of vehicles){
  if(!v.import_id)continue;
  if(!byImport.has(v.import_id))byImport.set(v.import_id,[]);
  byImport.get(v.import_id).push(v.shipment_month);
 }
 const imports=byImport.size?(await c.query('SELECT * FROM co_dispatch_imports WHERE id=ANY($1::uuid[]) ORDER BY created_at DESC,id',[[...byImport.keys()]])).rows:[];
 return {plan:(await c.query(planSelect+' WHERE p.id=$1',[plan.id])).rows[0],
  dispatch_month:{...Month.settings(req,plan),targets:await Month.targets(c,req,plan,true)},vehicles,
  imports:imports.map(row=>{
   const months=byImport.get(row.id);
   return {...row,row_count:months.length,current_months:[...new Set(months)].sort()};
  })};
}
async function arrivals(c,req,all=false){
 const q=req.query,loading=await require('./cobalt-loading.cjs').enabled(c),execution=await require('./cobalt-execution.cjs').enabled(c),f=await filter(c,req,true);
 const add=(clause,value)=>{f.values.push(value);f.where+=' AND '+clause+'=$'+f.values.length;};
 if(q.shipment_month)add('v.shipment_month',month(q.shipment_month));
 if(q.arrival_date)add("(a.arrived_at AT TIME ZONE 'Africa/Lubumbashi')::date",B.date(q.arrival_date));
 if(q.vehicle_id)add('v.id',B.uuid(q.vehicle_id));
 const plate=B.plateKey(q.truck_no);
 if(plate){
  f.values.push(plate);
  f.where+=' AND '+B.plateContains('v.truck_no','$'+f.values.length);
 }
 const registrationStates=['WAITING_ARRIVAL','PENDING_CONFIRMATION','WAITING_PLAN','PLANNED','HISTORICAL_ARRIVED','CANCELLED'];
 const states=[...registrationStates,'LOADING','REVIEW_PENDING','LOADED','DEPARTED','OUTBOUND_PENDING','LOGISTICS_APPROVED','OUTBOUND_CORRECTION','OUTBOUND'];
 if(q.arrival_state&&!states.includes(q.arrival_state))throw error(400,'CO_SALES_INPUT');
 const plan=loading?`LEFT JOIN LATERAL (
  SELECT lp.id,lp.packing_list_no FROM co_loading_plans lp WHERE lp.arrival_id=a.id AND lp.status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM export_license_allocations x WHERE x.co_plan_id=lp.id AND x.state='RELEASED')
  ORDER BY (lp.status<>'DRAFT') DESC,lp.created_at DESC,lp.id LIMIT 1
 ) lp ON true`:'LEFT JOIN LATERAL (SELECT NULL::uuid id,NULL::text packing_list_no) lp ON true';
 const registration=`CASE WHEN v.cancelled_at IS NOT NULL THEN 'CANCELLED' WHEN lp.id IS NOT NULL THEN 'PLANNED'
  WHEN h.source_id IS NOT NULL THEN 'HISTORICAL_ARRIVED'
  WHEN a.registration_phase='DRAFT' OR arrival_legacy_draft('CO_HYDROXIDE',v.id,a.updated_at) THEN 'PENDING_CONFIRMATION'
  WHEN a.registration_phase='CONFIRMED' THEN 'WAITING_PLAN' ELSE 'WAITING_ARRIVAL' END`;
 const lifecycle=execution?`CASE WHEN v.cancelled_at IS NOT NULL THEN 'CANCELLED' ELSE coalesce((
  SELECT e.state FROM co_load_executions e JOIN co_loading_orders l ON l.id=e.order_id
  WHERE l.arrival_id=a.id AND l.status IN('WAITING','OUTBOUND') LIMIT 1),${registration}) END`:registration;
 const rows=`SELECT v.*,p.code sales_plan_code,p.project_id,p.warehouse_id,p.customer_id,p.contract_id,c.name customer_name,
  k.contract_no,p.status plan_status,lp.id loading_plan_id,coalesce(lp.packing_list_no,h.packing_list_no) packing_list_no,
  h.source_id historical_source_id,a.id arrival_id,a.version arrival_version,a.registration_phase,a.updated_at arrival_updated_at,a.arrived_at,
  a.trailer_one,a.trailer_two,a.driver_name actual_driver_name,a.passport_no actual_passport_no,a.transporter actual_transporter,
  a.container_no,a.exception_remark,a.registered_by,a.registered_at,${registration} registration_state,${lifecycle} arrival_state
  ${plansSql} JOIN co_dispatch_vehicles v ON v.sales_plan_id=p.id LEFT JOIN co_vehicle_arrivals a ON a.dispatch_vehicle_id=v.id
  LEFT JOIN historical_sales_arrivals h ON h.co_dispatch_id=v.id
  ${plan} WHERE ${f.where}`;
 if(q.vehicle_id&&!all){
  const items=(await c.query(rows,f.values)).rows;
  return {items,total:items.length,page:1,page_size:50};
 }
 const counts=(await c.query('SELECT registration_state,count(*)::int n FROM ('+rows+') r GROUP BY registration_state',f.values)).rows;
 const state_counts=Object.fromEntries(counts.map(r=>[r.registration_state,r.n]));
 const args=[...f.values],stateColumn=registrationStates.includes(q.arrival_state)?'registration_state':'arrival_state';
 const filtered=' FROM ('+rows+') r'+(q.arrival_state?' WHERE '+stateColumn+'=$'+args.push(q.arrival_state):'');
 const options=await filter(c,{...req,query:{}},true);
 const month_options=all?[]:(await c.query('SELECT DISTINCT v.shipment_month '+plansSql+
  " JOIN co_dispatch_vehicles v ON v.sales_plan_id=p.id WHERE v.cancellation_reason IS DISTINCT FROM 'MANUAL_DELETE' AND "+
  options.where+' ORDER BY v.shipment_month DESC',options.values)).rows.map(row=>row.shipment_month);
 return {state_counts,month_options,customer_options:(await c.query('SELECT DISTINCT p.customer_id id,c.name '+plansSql+' WHERE '+options.where+' ORDER BY c.name',options.values)).rows,
  items:(await c.query('SELECT *'+filtered+' ORDER BY '+B.documentOrder({pending:"registration_state IN('WAITING_ARRIVAL','PENDING_CONFIRMATION','WAITING_PLAN')"})+(all?' LIMIT 10001':' LIMIT 50 OFFSET '+((f.page-1)*50)),args)).rows,
  total:Number((await c.query('SELECT count(*)'+filtered,args)).rows[0].count),page:f.page,page_size:50};
}
async function register({app,pool,permitted,csrf,auth}){
 const read=permitted('plan:read'),writes=p=>[permitted(p),csrf];
 app.get(prefix+'/options',{preHandler:async req=>{await auth(req);if(!['plan:read','customer:read','dispatch:read','vehicle-arrival:read'].some(p=>req.user.permissions.includes(p)))throw error(403,'CO_PERMISSION_DENIED');}},req=>C.readTransaction(pool,async c=>({projects:(await c.query('SELECT p.* FROM projects p WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.id) ORDER BY p.name',[req.user.id])).rows,warehouses:(await c.query('SELECT w.* FROM warehouses w WHERE w.active AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=w.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=w.id)) ORDER BY w.name',[req.user.id])).rows,customers:(await c.query('SELECT c.* FROM co_customer_profiles c WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=c.project_id AND(s.customer_id IS NULL OR s.customer_id=c.id)) ORDER BY c.name',[req.user.id])).rows,contracts:(await c.query(`SELECT p.*,c.name customer_name FROM co_sales_contracts p JOIN co_customer_profiles c ON c.id=p.customer_id WHERE ${visible('p',false)} ORDER BY p.created_at DESC`,[req.user.id])).rows,states:['OPEN','CLOSED'],arrival_states:['WAITING_ARRIVAL','WAITING_PLAN','CANCELLED']})));
 app.get(prefix+'/customers',{preHandler:permitted('customer:read')},async req=>({items:(await pool.query('SELECT c.* FROM co_customer_profiles c WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=c.project_id AND(s.customer_id IS NULL OR s.customer_id=c.id)) ORDER BY c.name',[req.user.id])).rows}));
 for(const edit of [false,true])app.post(prefix+'/customers'+(edit?'/:id':''),{preHandler:writes('customer:write')},req=>mutation(pool,req,'customer:write',async c=>{fields(req.body,['project_id','code','name','address','email','phone','active','version']);const row=await require('./cobalt-customers.cjs').save(c,req,edit);return {...row,customer_id:row.id,warehouse_id:null};}));
 app.get(prefix+'/contracts',{preHandler:permitted('customer:read')},async req=>({items:(await pool.query(`SELECT p.*,c.name customer_name FROM co_sales_contracts p JOIN co_customer_profiles c ON c.id=p.customer_id WHERE ${visible('p',false)} ORDER BY p.created_at DESC`,[req.user.id])).rows}));
 app.get(prefix+'/contracts/:id',{preHandler:permitted('customer:read')},req=>access(pool,req,'contract',req.params.id));
 for(const edit of [false,true])app.post(prefix+'/contracts'+(edit?'/:id':''),{preHandler:writes('customer:write')},req=>mutation(pool,req,'customer:write',async c=>{const b=req.body;fields(b,['project_id','customer_id','contract_no','effective_date','end_date','active','version','contract_net_weight','remark']);const old=edit?await access(c,req,'contract',req.params.id,true):null,project=B.uuid(b.project_id),customer=B.uuid(b.customer_id);await B.scope(c,req,project,null,null,true);if(old&&(old.project_id!==project||old.customer_id!==customer))throw error(409,'CO_SALES_IDENTITY');if(old&&old.version!==B.version(b.version))throw error(409,'CO_SALES_STALE');if(typeof b.active!=='boolean')throw error(400,'CO_SALES_INPUT');const start=B.date(b.effective_date),end=B.date(b.end_date);if(start>end)throw error(400,'CO_SALES_CONTRACT_DATE');const amount=b.contract_net_weight===undefined?old?.contract_net_weight??null:b.contract_net_weight===null||b.contract_net_weight===''?null:B.weight(b.contract_net_weight),remark=b.remark===undefined?old?.remark||'':b.remark;if(typeof remark!=='string'||remark.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(remark))throw error(400,'CO_SALES_INPUT');const values=[B.text(b.contract_no,'CO_SALES_CONTRACT',80),start,end,b.active,req.user.id,amount,remark.trim()];let row;if(old)row=(await c.query('UPDATE co_sales_contracts SET contract_no=$1,effective_date=$2,end_date=$3,active=$4,updated_by=$5,contract_net_weight=$6,remark=$7,version=version+1,updated_at=clock_timestamp() WHERE id=$8 RETURNING *',[...values,old.id])).rows[0];else row=(await c.query('INSERT INTO co_sales_contracts(contract_no,effective_date,end_date,active,updated_by,created_by,contract_net_weight,remark,project_id,customer_id) VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9) RETURNING *',[...values,project,customer])).rows[0];return {...row,warehouse_id:null};}));
 app.get(prefix+'/plans',{preHandler:read},req=>C.readTransaction(pool,async c=>{const f=await filter(c,req);return {items:(await c.query(planSelect+' WHERE '+f.where+' ORDER BY p.created_at DESC,p.id LIMIT 50 OFFSET '+((f.page-1)*50),f.values)).rows,total:Number((await c.query('SELECT count(*) '+plansSql+' WHERE '+f.where,f.values)).rows[0].count),page:f.page,page_size:50};}));
 app.get(prefix+'/plans/:id',{preHandler:read},req=>C.readTransaction(pool,async c=>{await access(c,req,'plan',req.params.id);const row=(await c.query(planSelect+' WHERE p.id=$1',[req.params.id])).rows[0];return {...row,creator_name_en:require('./employee-identity.cjs').englishName(row.creator_name)};}));
 for(const edit of [false,true])app.post(prefix+'/plans'+(edit?'/:id':''),{preHandler:writes('plan:write')},req=>mutation(pool,req,'plan:write',async c=>{await require('./sales-approval.cjs').submission(c,req,'CO_HYDROXIDE',edit?req.params.id:null);const b=req.body;fields(b,['project_id','warehouse_id','customer_id','contract_id','shipment_month','target_weight','planned_metal_mt','planned_vehicle_count','destination','remark','status','version']);const old=edit?await access(c,req,'plan',req.params.id,true):null;
 const project=B.uuid(b.project_id),customer=B.uuid(b.customer_id);
 const warehouse=b.warehouse_id?B.uuid(b.warehouse_id):old?.warehouse_id||(await c.query(`SELECT w.id FROM warehouses w WHERE w.project_id=$2
  AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=w.project_id AND (s.warehouse_id IS NULL OR s.warehouse_id=w.id) AND (s.customer_id IS NULL OR s.customer_id=$3))
  ORDER BY EXISTS(SELECT 1 FROM co_zones z WHERE z.warehouse_id=w.id AND z.active) DESC,w.name,w.id LIMIT 1`,[req.user.id,project,customer])).rows[0]?.id;
 if(!warehouse)throw error(403,'CO_SALES_SCOPE');
 const p={project_id:project,warehouse_id:warehouse,customer_id:customer,contract_id:B.uuid(b.contract_id)};await B.scope(c,req,p.project_id,p.warehouse_id,p.customer_id);if(old){if(Object.keys(p).some(k=>old[k]!==p[k]))throw error(409,'CO_SALES_IDENTITY');if(old.version!==B.version(b.version))throw error(409,'CO_SALES_STALE');}if(!Number.isInteger(b.planned_vehicle_count)||b.planned_vehicle_count<1||b.planned_vehicle_count>2147483647)throw error(400,'CO_SALES_COUNT');if(!['OPEN','CLOSED'].includes(b.status||'OPEN'))throw error(400,'CO_SALES_INPUT');const f={...p,shipment_month:month(b.shipment_month),target_weight:B.weight(b.target_weight),planned_metal_mt:b.planned_metal_mt===null||b.planned_metal_mt===''||b.planned_metal_mt===undefined?null:B.weight(b.planned_metal_mt),planned_vehicle_count:b.planned_vehicle_count,destination:b.destination===undefined?old?.destination||'':optional(b.destination,1000),remark:optional(b.remark,1000),status:b.status||'OPEN',updated_by:req.user.id};let row;if(old){const keys=Object.keys(f);row=(await c.query('UPDATE co_sales_plans SET '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+',version=version+1,updated_at=clock_timestamp() WHERE id=$'+(keys.length+1)+' RETURNING *',[...Object.values(f),old.id])).rows[0];}else{f.created_by=req.user.id;const keys=Object.keys(f);row=(await c.query('INSERT INTO co_sales_plans('+keys.join(',')+') VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+') RETURNING *',Object.values(f))).rows[0];}return row;}));
 app.get(prefix+'/plans/:id/dispatch',{preHandler:permitted('dispatch:read')},
  req=>C.readTransaction(pool,c=>listDispatch(c,req)));
 app.post(prefix+'/plans/:id/dispatch/vehicles/:vehicle/month',{preHandler:writes('dispatch:month')},req=>mutation(pool,req,'dispatch:month',async c=>{
  const {body,source,target}=await Month.lockTransfer(c,req,true,(conn,request,id,lock)=>access(conn,request,'plan',id,lock));
  const id=B.uuid(req.params.vehicle);
  const {rows:[v]}=await c.query('SELECT v.*,'+transferHistory+' transfer_history FROM co_dispatch_vehicles v WHERE v.sales_plan_id=$1 AND v.id=$2 FOR UPDATE OF v',
   [source.id,id]);
  if(!v)throw error(404,'CO_SALES_NOT_FOUND');
  Month.validate(body,v.shipment_month);
  if(v.cancelled_at||v.transfer_history)throw B.error(409,'车辆已取消或已关联到厂、装车业务，不能调整派车月份');
  if((await c.query('SELECT 1 FROM co_dispatch_vehicles WHERE sales_plan_id=$1 AND shipment_month=$2 AND truck_key=$3',
   [target.id,target.shipment_month,v.truck_key])).rowCount)throw B.error(409,'目标销售计划已存在相同车牌');
  await c.query('UPDATE co_dispatch_vehicles SET sales_plan_id=$2,shipment_month=$3,version=version+1,updated_by=$4,updated_at=clock_timestamp() WHERE id=$1',
   [id,target.id,target.shipment_month,req.user.id]);
  return Month.audit(c,req,true,v,source,target);
 }));
 app.post(prefix+'/plans/:id/dispatch/import-preview',{bodyLimit:3000000,preHandler:writes('dispatch:write')},req=>C.readTransaction(pool,async c=>{
  const plan=await access(c,req,'plan',req.params.id);
  if(plan.status!=='OPEN')throw error(409,'CO_SALES_LOCKED');
  const body=req.body;
  fields(body,['plan_version','shipment_month','file_name','file_base64','mapping','transport_only']);
  if(plan.version!==B.version(body.plan_version))throw error(409,'CO_SALES_STALE');
  const month=Transport.importMonth(plan,body),parsed=await D.parse(body);
  if(parsed.needs_mapping)return parsed;
  const original=await Transport.assertImportAvailable(c,req,plan,parsed,{co:true,transportOnly:body.transport_only});
  const change=await Transport.analyzeImport(c,plan.id,month,parsed.items,
   {co:true,transportOnly:body.transport_only,restoreFrom:original?parsed:null});
  return {...parsed,shipment_month:month,items:change.items,...change.tally};
 }));
 app.post(prefix+'/plans/:id/dispatch/import',{bodyLimit:3000000,preHandler:writes('dispatch:write')},req=>mutation(pool,req,'dispatch:write',async c=>{
  await c.query('SELECT pg_advisory_xact_lock(21004)');
  const plan=await access(c,req,'plan',req.params.id,true);
  if(plan.status!=='OPEN')throw error(409,'CO_SALES_LOCKED');
  const body=req.body;
  fields(body,['plan_version','shipment_month','file_name','file_base64','mapping','preview_sha256','transport_only']);
  if(plan.version!==B.version(body.plan_version))throw error(409,'CO_SALES_STALE');
  const parsed=await D.parse(body);
  if(parsed.needs_mapping||parsed.file_sha256!==body.preview_sha256)throw error(409,'CO_SALES_PREVIEW');
  return importPlan(c,req,plan,body,parsed);
 }));
 app.post(prefix+'/plans/:id/dispatch/vehicles',{preHandler:writes('dispatch:write')},req=>mutation(pool,req,'dispatch:write',async c=>{const p=await access(c,req,'plan',req.params.id,true);if(p.status!=='OPEN')throw error(409,'CO_SALES_LOCKED');const b=req.body;fields(b,['plan_version','shipment_month','truck_no','trailer_no','transporter','destination','driver_name','passport_no','planned_arrival_date','capacity_tonnes','remark']);if(p.version!==B.version(b.plan_version))throw error(409,'CO_SALES_STALE');return {...await saveVehicle(c,req,p,b),...metadata(p)};}));
 app.post(prefix+'/vehicles/:id',{preHandler:writes('dispatch:write')},req=>mutation(pool,req,'dispatch:write',async c=>{const {v,p}=await vehicle(c,req,req.params.id),b=req.body;fields(b,['version','trailer_no','transporter','destination','driver_name','passport_no','planned_arrival_date','capacity_tonnes','remark']);if(v.version!==B.version(b.version))throw error(409,'CO_SALES_STALE');const storedDate=v.planned_arrival_date instanceof Date?v.planned_arrival_date.toISOString().slice(0,10):v.planned_arrival_date;const f=vehicleFields({...v,planned_arrival_date:storedDate,...b}),keys=Object.keys(f);return {...(await c.query('UPDATE co_dispatch_vehicles SET '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+',version=version+1,updated_by=$'+(keys.length+1)+',updated_at=clock_timestamp() WHERE id=$'+(keys.length+2)+' RETURNING *',[...Object.values(f),req.user.id,v.id])).rows[0],...metadata(p)};}));
 app.post(prefix+'/vehicles/:id/cancel',{preHandler:writes('dispatch:write')},req=>mutation(pool,req,'dispatch:write',async c=>{
  await c.query('SELECT pg_advisory_xact_lock(21004)');
  const {v,p}=await vehicle(c,req,req.params.id),b=req.body;
  fields(b,['version','reason']);
  if(v.version!==B.version(b.version))throw error(409,'CO_SALES_STALE');
  const reason=B.text(b.reason,'CO_SALES_REASON',1000);
  const {rows:[{blocker}]}=await c.query('SELECT cobalt_dispatch_online_blocker($1) blocker',[v.id]);
  if(blocker)throw History.cancellationError(req,blocker);
  const sourceId=await History.prepareDispatchCancellation(c,req,p,v.id);
  const row=(await c.query('UPDATE co_dispatch_vehicles SET cancelled_at=clock_timestamp(),cancellation_reason=$2,version=version+1,updated_by=$3,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
   [v.id,reason,req.user.id])).rows[0];
  await History.finishDispatchCancellation(c,req,p,v.id,sourceId,reason);
  return {...row,...metadata(p)};
 }));
 app.get(prefix+'/arrivals',{preHandler:permitted('vehicle-arrival:read')},req=>C.readTransaction(pool,c=>arrivals(c,req)));
 app.post(prefix+'/arrivals/export',{preHandler:[permitted('vehicle-arrival:read'),permitted('inventory:export'),csrf]},async(req,reply)=>{const q=req.body||{};if(Object.keys(q).some(k=>!['shipment_month','arrival_state','project_id','warehouse_id','customer_id','sales_plan_id','search','arrival_date','truck_no'].includes(k)))throw error(400,'CO_SALES_INPUT');const data=await C.readTransaction(pool,c=>arrivals(c,{...req,query:q},true));return require('./vehicle-arrival-export.cjs').send({pool,req,reply,product:'CO_HYDROXIDE',items:data.items});});
 app.post(prefix+'/arrivals/:id',{preHandler:writes('vehicle-arrival:write')},req=>mutation(pool,req,'vehicle-arrival:write',async c=>{await c.query('SELECT pg_advisory_xact_lock(21004)');const {v,p}=await vehicle(c,req,req.params.id),b=req.body;fields(b,['dispatch_version','version','action','arrived_at','trailer_one','trailer_two','driver_name','passport_no','transporter','container_no','exception_remark']);if(v.version!==B.version(b.dispatch_version))throw error(409,'CO_SALES_STALE');await History.assertNotArrived(c,req,v.id);const old=(await c.query('SELECT * FROM co_vehicle_arrivals WHERE dispatch_vehicle_id=$1 FOR UPDATE',[v.id])).rows[0];if(old&&await require('./cobalt-loading.cjs').enabled(c)&&(await c.query("SELECT 1 FROM co_loading_plans lp WHERE arrival_id=$1 AND lp.status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM export_license_allocations x WHERE x.co_plan_id=lp.id AND x.state='RELEASED') LIMIT 1",[old.id])).rowCount)throw error(409,'CO_LOADING_ARRIVAL_FROZEN');const Yard=require('./vehicle-arrivals.cjs'),f=Yard.arrivalFields(b,old,true);if(f.registration_phase==='CONFIRMED')await Yard.assertUniqueArrival(c,req,p.project_id,v.id,'CO_HYDROXIDE',f);const keys=Object.keys(f);let row;if(old)row=(await c.query('UPDATE co_vehicle_arrivals SET '+keys.map((k,i)=>k+'=$'+(i+1)).join(',')+',version=version+1,updated_by=$'+(keys.length+1)+',updated_at=clock_timestamp() WHERE id=$'+(keys.length+2)+' RETURNING *',[...Object.values(f),req.user.id,old.id])).rows[0];else row=(await c.query('INSERT INTO co_vehicle_arrivals('+keys.join(',')+',dispatch_vehicle_id,sales_plan_id,registered_by,updated_by) VALUES('+keys.map((_,i)=>'$'+(i+1)).join(',')+',$'+(keys.length+1)+',$'+(keys.length+2)+',$'+(keys.length+3)+',$'+(keys.length+3)+') RETURNING *',[...Object.values(f),v.id,p.id,req.user.id])).rows[0];return {...row,...metadata(p)};}));
 app.get(prefix+'/history',{preHandler:auth},req=>C.readTransaction(pool,async c=>{const entity=B.uuid(req.query.entity_id);const rows=(await c.query(`SELECT e.*,u.display_name actor_name FROM co_sales_events e JOIN users u ON u.id=e.actor_id WHERE e.entity_id=$2 AND ${visible('e',false)} AND(e.warehouse_id IS NULL OR EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=e.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=e.warehouse_id) AND(s.customer_id IS NULL OR s.customer_id=e.customer_id))) ORDER BY e.id DESC LIMIT 200`,[req.user.id,entity])).rows;if(rows.length){const permission={co_sales_contracts:'customer:read',co_sales_plans:'plan:read',co_dispatch_imports:'dispatch:read',co_dispatch_vehicles:'dispatch:read',co_vehicle_arrivals:'vehicle-arrival:read'}[rows[0].entity_type];if(!req.user.permissions.includes(permission))throw error(403,'CO_PERMISSION_DENIED');}return {items:rows.map(e=>({...e,actor_name_en:require('./employee-identity.cjs').englishName(e.actor_name)}))};}));
}
module.exports={allowed,enabled,register,mutation,access};
