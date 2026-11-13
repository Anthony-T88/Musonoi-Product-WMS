'use strict';
const B=require('./business-common.cjs'),M=require('./management.cjs');
const customerScope=a=>`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=${a}.project_id AND(s.customer_id IS NULL OR s.customer_id=${a}.customer_id))`;
const can=(req,p)=>req.user.permissions.includes(p);
const defaults={cu_stock_age_days:30,cu_approval_hours:24,cu_plan_expiry_days:7,cu_show_overview_alerts:true,cu_show_todo_reminders:true};
async function settings(c,req){return(await c.query(`SELECT p.id project_id,p.name project_name,coalesce(s.version,0) version,
 coalesce(s.plan_overdue_days,0) plan_overdue_days,coalesce(s.document_hours,0) document_hours,coalesce(s.count_difference_days,0) count_difference_days,
 coalesce(r.loaded_hours,48)::text loaded_hours,coalesce(s.cu_stock_age_days,30) cu_stock_age_days,coalesce(s.cu_approval_hours,24) cu_approval_hours,
 coalesce(s.cu_plan_expiry_days,7) cu_plan_expiry_days,coalesce(s.cu_show_overview_alerts,true) cu_show_overview_alerts,
 coalesce(s.cu_show_todo_reminders,true) cu_show_todo_reminders,s.updated_at,u.display_name updated_by_name,
 EXISTS(SELECT 1 FROM user_scopes x WHERE x.user_id=$1 AND x.project_id=p.id AND x.warehouse_id IS NULL AND x.customer_id IS NULL) editable
 FROM projects p LEFT JOIN management_warning_settings s ON s.project_id=p.id LEFT JOIN exception_rules r ON r.project_id=p.id LEFT JOIN users u ON u.id=s.updated_by
 WHERE EXISTS(SELECT 1 FROM user_scopes x WHERE x.user_id=$1 AND x.project_id=p.id) ORDER BY p.name`,[req.user.id])).rows;}
async function documents(c,req,x){const out=[];
 for(const [permission,table,type,path]of [['receipt:read','receipts','RECEIPT','/receipts/'],['allocation:read','allocations','LOT','/preparation/'],['load:read','loading_orders','LOAD','/outbounds/loads/'],['adjust:read','stock_adjustments','ADJUST','/stocktaking/adjustments/']]){
  if(!can(req,permission))continue;const rows=table==='loading_orders'?await M.loads(c,x):await M.docs(c,x,table);
  for(const d of rows)out.push({...d,doc_type:type,href:path+d.id,entity_type:table,document_no:d.lot_no||d.document_no||d.code,status:d.phase||d.workflow_state||d.status});
 }
 if(can(req,'stocktake:read'))for(const d of await M.counts(c,x))out.push({...d,doc_type:'COUNT',entity_type:'stocktakes',document_no:d.code,status:d.phase||d.status,href:'/stocktaking/'+d.id});
 if(can(req,'loading-plan:read'))for(const d of await M.loadingPlans(c,x))out.push({...d,doc_type:'LOADING_PLAN',entity_type:'loading_plan_documents',document_no:d.packing_list_no,href:'/loading-plans/'+d.id});
 if(can(req,'plan:read')&&!['warehouse_id','location_id','batch_id','yard_id'].some(k=>x.f[k])){
  const rows=(await c.query(`SELECT p.*,a.state approval_state,a.submitted_by,a.submitted_at,a.sales_reviewed_by,a.flow_version,a.reviewed_by,a.commerce_reviewed_by,c.name customer_name,k.contract_no
   FROM sales_plans p JOIN copper_customers c ON c.id=p.customer_id LEFT JOIN customer_contracts k ON k.id=p.contract_id
   LEFT JOIN sales_plan_approvals a ON a.plan_id=p.id AND a.product_code='CU_CATHODE' WHERE ${customerScope('p')}
   AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND(s.customer_id IS NULL OR s.customer_id=p.customer_id) AND s.warehouse_id IS NULL)
   AND($2::uuid IS NULL OR p.project_id=$2) AND($3::uuid IS NULL OR p.customer_id=$3)`,[req.user.id,x.f.project_id||null,x.f.customer_id||null])).rows;
  for(const d of rows)out.push({...d,doc_type:'SALES',entity_type:'sales_plans',document_no:d.code,business_status:d.status,status:d.approval_state||d.status,href:'/sales-plans/'+d.id});
 }
 if(can(req,'vehicle-arrival:read')&&!['warehouse_id','location_id','batch_id','yard_id'].some(k=>x.f[k])){
  const vehicles=(await require('./vehicle-arrivals.cjs').list(c,req,{customer_id:x.f.customer_id||''})).filter(v=>!x.f.project_id||v.project_id===x.f.project_id),ids=vehicles.map(v=>v.dispatch_vehicle_id),metadata=ids.length?(await c.query(`SELECT v.id,i.created_by,i.created_at,a.registered_by,a.registered_at FROM sales_dispatch_vehicles v JOIN sales_dispatch_imports i ON i.id=v.import_id LEFT JOIN vehicle_arrivals a ON a.dispatch_vehicle_id=v.id WHERE v.id=ANY($1::uuid[])`,[ids])).rows:[];
  for(const v of vehicles){const m=metadata.find(m=>m.id===v.dispatch_vehicle_id)||{};out.push({...v,id:v.dispatch_vehicle_id,doc_type:'VEHICLE',entity_type:'sales_dispatch_vehicles',document_no:v.truck_no,status:v.arrival_state,created_by:m.created_by,created_at:m.created_at,href:'/loading-plans?tab=arrivals&shipment_month='+v.shipment_month+'&vehicle_id='+v.dispatch_vehicle_id});
   if(v.arrival_id)out.push({...v,id:v.arrival_id,doc_type:'ARRIVAL',entity_type:'vehicle_arrivals',document_no:v.truck_no,status:v.arrival_state,created_by:m.registered_by,created_at:m.registered_at,href:'/loading-plans/new?sales_plan_id='+v.sales_plan_id+'&arrival_id='+v.arrival_id});
  }
 }
 const customers=(await c.query(`SELECT c.id,c.name FROM copper_customers c WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=c.project_id AND(s.customer_id IS NULL OR s.customer_id=c.id))`,[req.user.id])).rows;
 const ids=[...new Set(out.flatMap(d=>[d.created_by,d.submitted_by]).filter(Boolean))],people=ids.length?(await c.query('SELECT id,display_name FROM users WHERE id=ANY($1::uuid[])',[ids])).rows:[];
 return out.map(d=>({...d,customer_name:d.customer_name||customers.find(u=>u.id===d.customer_id)?.name||null,initiator_name:people.find(u=>u.id===(d.submitted_by||d.created_by))?.display_name||null,lot_no:d.lot_no||null,created_at:d.submitted_at||d.created_at||null}));
}
async function tasks(c,req,context=null){const x=context||await M.context(c,req,{}),all=await documents(c,req,x),original=await M.todos(c,x);
 let pending=original.map(t=>{const type=({RECEIPT:'RECEIPT',LOT:'LOT',LOAD:'LOAD',LOGISTICS:'LOAD',FORMAL:'LOAD',COUNT:'COUNT',ADJUST:'ADJUST',PLAN:'LOADING_PLAN',VEHICLE:'VEHICLE',ARRIVAL:'ARRIVAL'})[t.kind.split('_')[0]],d=all.find(d=>d.id===t.id&&d.doc_type===type);return {...d,...t,created_at:t.created_at||d?.created_at||null};});
 for(const d of all.filter(d=>d.doc_type==='SALES')){
  const sales=d.status==='PENDING'&&['sales_manager','admin'].includes(req.user.role_code)&&can(req,'plan:approve')&&(d.submitted_by||d.created_by)!==req.user.id;
  const commerce=d.status==='COMMERCE_PENDING'&&['commerce_manager','admin'].includes(req.user.role_code)&&can(req,'plan:commerce-approve')&&(d.submitted_by||d.created_by)!==req.user.id&&d.sales_reviewed_by!==req.user.id;
  if(sales||commerce)pending.push({...d,kind:sales?'SALES_REVIEW':'COMMERCE_REVIEW'});
  if(d.status==='REJECTED'&&['sales_operator','sales_manager','admin'].includes(req.user.role_code)&&d.submitted_by===req.user.id&&can(req,'plan:write'))pending.push({...d,kind:'SALES_EDIT'});
 }
 if(can(req,'gate:read')&&['sales_manager','sales_operator','admin'].includes(req.user.role_code))for(const d of await M.outbound(c,x,false)){
  const g=(await c.query('SELECT id,state,document_no FROM gate_permits WHERE cu_loading_id=$1',[d.id])).rows[0];
  const returned=(await c.query("SELECT 1 FROM outbound_corrections WHERE loading_id=$1 AND kind='RETURN_OUTBOUND' AND status IN('REQUESTED','AUTHORIZED','RETURN_VERIFIED','APPLIED')",[d.id])).rowCount;
  if(!returned&&g?.state!=='EXITED')pending.push({...d,doc_type:'GATE',kind:'GATE_EXIT',document_no:g?.document_no||d.document_no,href:'/outbounds?view=departures'+(g?'&permit='+g.id:''),created_at:d.manager_at,initiator_name:null});
 }
 pending.push(...await require('./sales-close.cjs').pending(c,req),...await require('./preparation-plans.cjs').pending(c,req),...await require('./registration-requests.cjs').pending(c,req));
 pending=[...new Map(pending.map(t=>[t.kind+'|'+t.id,t])).values()];
 const ids=all.map(d=>d.id),audit=ids.length?(await c.query(`SELECT a.entity_id,a.entity_type,a.action,a.occurred_at,a.after_data->>'product_code' product_code,u.display_name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
  WHERE a.actor_id=$1 AND a.entity_id=ANY($2::text[]) ORDER BY a.occurred_at DESC,a.id DESC`,[req.user.id,ids])).rows:[];
 const completed=all.flatMap(d=>{const a=audit.find(a=>a.entity_id===d.id&&(!a.product_code||a.product_code==='CU_CATHODE')&&(a.entity_type===d.entity_type||d.doc_type==='SALES'&&['sales_plan_review','sales_plan_close'].includes(a.entity_type))&&!/(?:^|_)(created|draft|export|download|view)(?:_|$)/.test(a.action));return a?[{...d,kind:'HANDLED',handled_at:a.occurred_at,action:a.action,handler_name:a.actor_name}]:[];});
 const conf=await settings(c,req),get=id=>conf.find(s=>s.project_id===id)||defaults,now=x.now.getTime();
 for(const t of pending){t.wait_hours=t.created_at?Math.max(0,(now-new Date(t.created_at))/3600000):null;t.due_soon=t.wait_hours!=null&&t.wait_hours>=get(t.project_id).cu_approval_hours;t.reminders_enabled=get(t.project_id).cu_show_todo_reminders;}
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}),date=v=>today.format(new Date(v));
 return {pending,initiated:all.filter(d=>d.created_by===req.user.id||d.submitted_by===req.user.id),completed,summary:{approval:pending.filter(t=>/REVIEW|APPROVE|FORMAL_OUTBOUND/.test(t.kind)).length,work:pending.filter(t=>!/REVIEW|APPROVE|FORMAL_OUTBOUND/.test(t.kind)).length,due:pending.filter(t=>t.due_soon).length,today:completed.filter(t=>date(t.handled_at)===x.today).length},as_of:x.now};
}
async function contracts(c,req){const rows=(await c.query(`SELECT k.*,p.name project_name,c.name customer_name,c.active customer_active,
 CASE WHEN NOT k.active OR NOT c.active THEN 'INACTIVE' WHEN (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date<k.effective_date THEN 'UPCOMING'
 WHEN (clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date>k.end_date THEN 'EXPIRED' ELSE 'VALID' END validity,
 EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=k.project_id AND(s.customer_id IS NULL OR s.customer_id=k.customer_id) AND s.warehouse_id IS NULL) full_plan_scope
 FROM customer_contracts k JOIN copper_customers c ON c.id=k.customer_id JOIN projects p ON p.id=k.project_id WHERE ${customerScope('k')} ORDER BY k.created_at DESC,k.id`,[req.user.id])).rows;
 const plans=can(req,'plan:read')?(await c.query(`SELECT p.*,k.contract_no,c.name customer_name,coalesce(a.state,'LEGACY') approval_state FROM sales_plans p
 JOIN customer_contracts k ON k.id=p.contract_id JOIN copper_customers c ON c.id=p.customer_id LEFT JOIN sales_plan_approvals a ON a.plan_id=p.id AND a.product_code='CU_CATHODE'
 WHERE ${customerScope('p')} AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND(s.customer_id IS NULL OR s.customer_id=p.customer_id) AND s.warehouse_id IS NULL) ORDER BY p.created_at DESC,p.id`,[req.user.id])).rows:[];
 const invoiced=await require('./sales-invoices.cjs').totals(c,'CU_CATHODE',plans.map(p=>p.id));
 for(const p of plans){const total=invoiced.get(p.id);p.progress={invoiced_net_weight:total?.net_mt||'0',invoiced_unknown_packages:total?.unknown_packages||0};}
 for(const k of rows){k.plans=plans.filter(p=>p.contract_id===k.id);const known=can(req,'plan:read')&&k.full_plan_scope;
  const progress=k.plans.map(p=>({net_weight:p.progress?.invoiced_net_weight??null}));k.fulfilled_net_weight=known?M.sum(progress).net_weight:null;k.fulfilled_unknown_weights=known?k.plans.reduce((n,p)=>n+p.progress.invoiced_unknown_packages,0):null;
  const tonnes=require('../dist/tonnes.js');k.fulfilment_available=known;k.remaining_contract_weight=known&&!k.fulfilled_unknown_weights&&k.contract_net_weight!=null&&k.fulfilled_net_weight!=null?tonnes.fixed(tonnes.scaled(k.contract_net_weight,6)-tonnes.scaled(k.fulfilled_net_weight,6),6):null;
 }
 return rows;
}
async function workspace(c,req){const items=(await c.query(`SELECT c.*,p.name project_name FROM copper_customers c JOIN projects p ON p.id=c.project_id WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=c.project_id AND(s.customer_id IS NULL OR s.customer_id=c.id)) ORDER BY c.name,c.id`,[req.user.id])).rows;
 const ks=(await contracts(c,req)).filter(k=>!k.deleted_at);for(const c of items)c.contract_count=ks.filter(k=>k.customer_id===c.id).length;
 const shipped=can(req,'load:read')?new Set((await M.outbound(c,await M.context(c,req,{}))).map(l=>l.customer_id)).size:null;
 const projects=(await c.query('SELECT p.id,p.name,EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.id AND s.warehouse_id IS NULL AND s.customer_id IS NULL) editable FROM projects p WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.id) ORDER BY p.name',[req.user.id])).rows;
 return {customers:items,contracts:ks,projects,summary:{customers:items.length,active:items.filter(c=>c.active).length,valid_contracts:ks.filter(k=>k.validity==='VALID').length,shipped_customers:shipped}};
}
async function alerts(c,req,x){const conf=await settings(c,req),cfg=id=>conf.find(s=>s.project_id===id)||defaults,out=[];
 if(can(req,'inventory:read'))for(const b of await M.inventory(c,x)){const s=cfg(b.project_id),at=b.confirmed_at||b.inbound_at||b.date;if(!s.cu_show_overview_alerts||b.physical_status!=='IN_STOCK'||!at)continue;const days=Math.floor((x.now-new Date(at))/86400000);if(days>=s.cu_stock_age_days)out.push({key:'STOCK_AGE:'+b.id,type:'STOCK_AGE',document_no:b.bundle_no,days,href:b.href});}
 const feed=await tasks(c,req,x);for(const t of feed.pending)if(t.due_soon&&cfg(t.project_id).cu_show_overview_alerts)out.push({key:'APPROVAL_WAIT:'+t.kind+':'+t.id,type:'APPROVAL_WAIT',document_no:t.document_no,hours:Math.floor(t.wait_hours),href:t.href});
 if(can(req,'plan:read'))for(const p of await documents(c,req,x)){if(p.doc_type!=='SALES'||!p.preparation_month||p.business_status==='CLOSED')continue;const [y,m]=p.preparation_month.split('-').map(Number),end=new Date(Date.UTC(y,m,0)),days=Math.floor((end-Date.parse(x.today))/86400000),s=cfg(p.project_id);if(s.cu_show_overview_alerts&&days>=0&&days<=s.cu_plan_expiry_days)out.push({key:'PLAN_DUE:'+p.id,type:'PLAN_DUE',document_no:p.code,days,href:p.href});}
 return out;
}
async function register({app,pool,permitted,auth,csrf}){const base='/api/v1/v34/ui461';
 app.get(base+'/tasks',{preHandler:auth},req=>M.read(pool,async c=>{const d=await tasks(c,req);if(req.query.handover==='1')d.handover=await require('./handover467.cjs').copper(c,req,d);return d;}));
 app.get(base+'/customers',{preHandler:permitted('customer:read')},req=>M.read(pool,c=>workspace(c,req)));
 app.post(base+'/contracts/export',{preHandler:[permitted('customer:read'),permitted('inventory:export'),csrf]},async(req,reply)=>{const q=req.body||{};if(Object.keys(q).some(k=>!['tab','search','customer_id','validity','page'].includes(k))||typeof(q.search||'')!=='string'||(q.search||'').length>160||!['','VALID','UPCOMING','EXPIRED','INACTIVE'].includes(q.validity||''))throw B.error(400,'合同导出筛选无效');if(q.customer_id)B.uuid(q.customer_id);
  const rows=await M.read(pool,async c=>(await contracts(c,req)).filter(k=>!k.deleted_at&&(!q.search||(k.contract_no+' '+(k.customer_name||'')).toLowerCase().includes(q.search.toLowerCase()))&&(!q.customer_id||k.customer_id===q.customer_id)&&(!q.validity||k.validity===q.validity)));
  const en=req.user.language_code==='en',header=en?['Contract No.','Customer','Effective Date','End Date','Contract Net MT','Fulfilled MT','Unverified Weights','Status']:['合同号','客户','生效日期','截止日期','合同净重MT','已履约MT','待核实重量捆数','状态'];
  const clean=v=>'"'+String(v??'').replace(/^[\s]*[=+@\-]/,s=>"'"+s).replaceAll('"','""')+'"',matrix=[header,...rows.map(k=>[k.contract_no,k.customer_name,k.effective_date,k.end_date,k.contract_net_weight,k.fulfilled_net_weight,k.fulfilled_unknown_weights,k.validity])];
  await B.audit(pool,req,'copper_contract_export','customer_contracts',null,null,{count:rows.length,filters:{search:q.search||'',customer_id:q.customer_id||'',validity:q.validity||''}});
  return reply.header('Content-Disposition','attachment; filename="musonoi-copper-contracts.csv"').header('X-Export-Count',rows.length).type('text/csv; charset=utf-8').send('\ufeff'+matrix.map(r=>r.map(clean).join(',')).join('\r\n'));
 });
 app.get(base+'/contracts/:id',{preHandler:permitted('customer:read')},req=>M.read(pool,async c=>{const k=(await contracts(c,req)).find(k=>k.id===B.uuid(req.params.id));if(!k)throw B.error(404,'合同不存在或无权访问');k.history=(await c.query(`SELECT a.id,a.action,a.occurred_at,u.display_name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_type='customer_contracts' AND a.entity_id=$1 ORDER BY a.occurred_at DESC,a.id DESC`,[k.id])).rows;return k;}));
 app.get(base+'/preferences',{preHandler:auth},req=>M.read(pool,async c=>({items:await settings(c,req)})));
 app.get(base+'/warning-settings',{preHandler:permitted('system:manage')},req=>M.read(pool,async c=>{const rows=await settings(c,req),ids=rows.map(r=>r.project_id);return {items:rows,history:ids.length?(await c.query(`SELECT a.id,a.entity_id project_id,a.action,a.occurred_at,a.before_data,a.after_data,u.display_name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_type='management_warning_settings' AND a.entity_id=ANY($1::text[]) AND(a.action<>'management_warning_settings_updated' OR NOT EXISTS(SELECT 1 FROM audit_logs n WHERE n.entity_type=a.entity_type AND n.entity_id=a.entity_id AND n.action='copper_warning_settings_updated' AND n.after_data->>'version'=a.after_data->>'version')) ORDER BY a.occurred_at DESC,a.id DESC LIMIT 100`,[ids])).rows:[]};}));
 app.patch(base+'/warning-settings',{preHandler:[permitted('system:manage'),csrf]},req=>B.mutate(pool,req,async c=>{const b=req.body||{};if(!Number.isInteger(b.version)||b.version<0)throw B.error(400,'预警设置版本无效');for(const [key,min,max]of [['plan_overdue_days',0,3650],['document_hours',0,87600],['count_difference_days',0,3650],['cu_stock_age_days',1,3650],['cu_approval_hours',1,87600],['cu_plan_expiry_days',0,3650]])if(!Number.isInteger(b[key])||b[key]<min||b[key]>max)throw B.error(400,'预警阈值无效：'+key);
  if(typeof b.loaded_hours!=='string'||!/^\d{1,5}(\.\d{1,3})?$/.test(b.loaded_hours)||Number(b.loaded_hours)<=0||Number(b.loaded_hours)>87600)throw B.error(400,'装车超期阈值无效');for(const k of ['cu_show_overview_alerts','cu_show_todo_reminders'])if(typeof b[k]!=='boolean')throw B.error(400,'预警开关无效');
  return(await c.query('SELECT * FROM v461_warning_configure($1,$2,$3,$4)',[req.user.id,B.uuid(b.project_id),b.version,b])).rows[0];}));
}
module.exports={register,tasks,contracts,workspace,settings,alerts};
