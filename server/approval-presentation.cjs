'use strict';
// Presentation only. Called after the owning document handler has authorized access.
const R=require('./role-catalog.cjs'),E=require('./employee-identity.cjs');
const uuid='([0-9a-fA-F-]{36})';
const roleOrder=new Map(R.builtins.map((v,i)=>[v,i]));
async function catalog(c){
 const rows=(await c.query('SELECT r.code,r.name,r.name_en,coalesce(array_agg(p.permission_code) FILTER(WHERE p.permission_code IS NOT NULL),ARRAY[]::text[]) permissions FROM roles r LEFT JOIN role_permissions p ON p.role_code=r.code WHERE r.code=ANY($1) OR NOT r.built_in GROUP BY r.code ORDER BY r.code',[R.builtins])).rows;
 const resolve=(permission,product)=>{
  const needs=Array.isArray(permission)?permission:[permission],fixed=({'plan:write':['sales_operator','sales_manager'],'plan:approve':['sales_manager'],'plan:commerce-approve':['commerce_manager'],'co:site-review':['site_supervisor'],'co:production-review':['production_manager'],'co:completion-review':['site_supervisor'],'co:amend-review':['site_supervisor'],'co:loading-review':['site_supervisor'],'gate:exit':['sales_operator','sales_manager']})[needs[0]]||(product==='CO_HYDROXIDE'?({'load:review':['site_supervisor'],'outbound:production-approve':['production_manager']})[needs[0]]:null);
  let eligible=rows.filter(r=>(!fixed||fixed.includes(r.code)||r.code==='admin')&&needs.every(p=>r.permissions.includes(p)));
  if(eligible.some(r=>r.code!=='admin'))eligible=eligible.filter(r=>r.code!=='admin');
  return eligible.sort((a,b)=>(roleOrder.get(a.code)??99)-(roleOrder.get(b.code)??99)||a.code.localeCompare(b.code)).map(({code,name,name_en})=>({code,name,name_en:name_en||name}));
 };
 const definitions=require('./workflow-permissions.cjs').catalog,roles={};for(const product of ['CU_CATHODE','CO_HYDROXIDE']){roles[product]={};for(const permission of Object.keys(definitions).filter(p=>definitions[p].products.includes(product)))roles[product][permission]=resolve(permission,product);if(product==='CU_CATHODE'){roles[product]['outbound:approve']=resolve('outbound:approve',product);roles[product]['stocktake:final']=resolve(['stocktake:review','adjust:approve'],product);}}
 return roles;
}
function identify(path,data){
 const rules=[['receipt',`receipts/${uuid}`],['lot',`(?:allocations|v261/lots)/${uuid}`],['load',`loads/${uuid}`],['sales',`(?:cobalt/)?sales-workflow/plans/${uuid}`],['plan',`(?:loading-plan-documents|loading-plans/unified/documents)/${uuid}`],['co-preparation',`cobalt/preparations/${uuid}(?:/work)?`],['co-plan',`cobalt/loading/plans/${uuid}`],['co-load',`cobalt/execution/orders/${uuid}`],['stocktake',`(?:v27/)?stocktakes/${uuid}`],['co-stocktake',`cobalt/stocktaking/${uuid}`],['adjustment',`adjustments/${uuid}`],['correction',`v27/corrections/${uuid}`],['gate',`(?:cobalt/)?gate-permits/${uuid}`]];
 for(const[k,re]of rules){const m=path.match(new RegExp('^/api/v1/'+re+'$'));if(m)return {kind:k,id:m[1],document:data.permit||data.document||data.task||data.order||data.lot||data};}
 return null;
}
const titles={
 CREATE:['创建单据','Document Created'],EDIT:['编辑单据','Document Edited'],SUBMIT:['提交审核','Submitted for Review'],APPROVE:['审核通过','Approved'],REJECT:['退回修改','Returned for Changes'],WITHDRAW:['撤回申请','Submission Withdrawn'],CANCEL:['取消单据','Document Cancelled'],REQUEST:['提出申请','Request Submitted'],AUTHORIZE:['批准更正','Correction Authorized'],APPLY:['更正生效','Correction Applied'],VERIFY_RETURN:['核验实物退回','Physical Return Verified'],
 RECEIPT_CREATED:['创建入库单','Receipt Created'],RECEIPT_EDITED:['编辑入库单','Receipt Edited'],RECEIPT_SUBMITTED:['提交入库审核','Receipt Submitted'],RECEIPT_CONFIRMED:['审核确认入库','Receipt Approved'],RECEIPT_REJECTED:['入库审核退回','Receipt Returned'],RECEIPT_REVIEW_COMMENT:['入库审批意见','Receipt Review Note'],
 SALES_PLAN_SUBMITTED:['提交销售计划','Sales Plan Submitted'],SALES_PLAN_EDIT_SUBMITTED:['编辑后重新提交','Edited Plan Resubmitted'],SALES_PLAN_APPROVED:['销售计划审批通过','Sales Plan Approved'],SALES_PLAN_REJECTED:['销售计划退回','Sales Plan Returned'],SALES_PLAN_CLOSE_REQUESTED:['申请关闭计划','Plan Closure Requested'],SALES_PLAN_CLOSE_SALES_APPROVED:['销售经理通过关闭申请','Sales Manager Approved Closure'],SALES_PLAN_CLOSED:['商务部经理批准关闭','Commercial Manager Approved Closure'],SALES_PLAN_CLOSE_REJECTED:['关闭申请退回','Closure Request Returned'],
 DRAFT:['保存草稿','Draft Saved'],SITE_APPROVE:['现场审核通过','Site Review Approved'],SITE_REJECT:['现场审核退回','Site Review Returned'],PRODUCTION_APPROVE:['生产终审通过','Production Review Approved'],PRODUCTION_REJECT:['生产终审退回','Production Review Returned'],COMPLETE:['完工提交','Completion Submitted'],COMPLETION_APPROVE:['完工审核通过','Completion Approved'],COMPLETION_REJECT:['完工审核退回','Completion Returned'],RETURN:['退回修改','Returned for Changes'],AMEND_REQUEST:['申请更正','Correction Requested'],AMEND_APPROVE:['更正申请通过','Correction Request Approved'],AMEND_REJECT:['更正申请退回','Correction Request Returned'],
 MATCH:['匹配装车单','Loading Order Matched'],UNMATCH:['解除装车匹配','Loading Match Removed'],MATCH_CHANGE:['变更装车匹配','Loading Match Changed'],MATCH_CANCEL:['取消装车匹配','Loading Match Cancelled'],LOADING_PLAN_MATCH:['匹配装车计划','Loading Plan Matched'],START:['开始作业','Work Started'],CONFIRM:['确认实际装车','Actual Loading Confirmed'],DEPART:['提交离场申报','Departure Declared'],OUTBOUND_SUBMIT:['提交出库审核','Outbound Review Submitted'],LOGISTICS_APPROVE:['物流审核通过','Logistics Review Approved'],LOGISTICS_REJECT:['物流审核退回','Logistics Review Returned'],MANAGER_APPROVE:['生产终审通过','Production Review Approved'],MANAGER_REJECT:['生产终审退回','Production Review Returned'],OUTBOUND:['正式出库','Outbound Posted'],
 SUBMIT_REVIEW:['提交差异复核','Discrepancy Review Submitted'],REVIEW:['差异复核通过','Discrepancy Review Approved'],APPROVAL:['盘点审批通过','Stocktake Approved'],OBSERVE:['保存实盘记录','Count Saved'],REFRESH:['更新盘点轮次','Count Round Updated'],SNAPSHOT_CREATED:['建立盘点快照','Stocktake Snapshot Created'],
 GATE_ISSUED:['生成出门证','Gate Permit Issued'],GATE_REVISED:['修订出门证','Gate Permit Revised'],GATE_PRINT_DIALOG_REQUESTED:['打开打印窗口','Print Window Opened'],GATE_EXCEL_DOWNLOADED:['下载出门证','Gate Permit Downloaded'],GATE_ACTUAL_EXIT_CONFIRMED:['确认实际出厂','Physical Exit Confirmed'],REGISTRATION_APPROVED:['注册申请通过','Registration Approved'],REGISTRATION_REJECTED:['注册申请退回','Registration Rejected']
};
const key=s=>String(s||'').replace(/[- .]+/g,'_').toUpperCase();
Object.assign(titles,{SAVE:['保存备货作业','Preparation Work Saved'],UPDATE_BATCH:['保存备货资料','Preparation Information Saved'],BATCH_SAVE:['保存备货资料','Preparation Information Saved'],SAVE_BATCH:['保存备货资料','Preparation Information Saved'],AMENDMENT_REQUEST:['申请备货更正','Preparation Correction Requested'],AMENDMENT_APPROVE:['备货更正审批通过','Preparation Correction Approved'],AMENDMENT_REJECT:['备货更正审批退回','Preparation Correction Returned'],REOPEN:['授权重新作业','Return to Work Authorized'],CANCEL_REQUEST:['申请取消','Cancellation Requested'],CANCEL_APPROVE:['取消审批通过','Cancellation Approved'],CHANGE_REQUEST:['申请变更车辆','Truck Change Requested'],CHANGE_APPROVE:['车辆变更审批通过','Truck Change Approved'],RESOLVE:['异常复核完成','Exception Review Completed']});
Object.assign(titles,{COMPLETION_SUBMIT:['提交完工审核','Completion Review Submitted'],COMPLETION_RETURN:['完工审核退回','Completion Review Returned'],DOCUMENTS:['维护装车单证','Loading Documents Updated'],DEPARTURE_CORRECT:['更正离场申报','Departure Declaration Corrected'],EXCEPTION:['登记装车异常','Loading Exception Recorded'],LOAD_APPROVE:['装车审核通过','Loading Review Approved'],LOAD_REJECT:['装车审核退回','Loading Review Returned']});
Object.assign(titles,{MATCH_CANCEL_REQUEST:['申请取消装车匹配','Loading Match Cancellation Requested'],MATCH_CANCEL_APPROVED:['取消匹配审核通过','Match Cancellation Approved'],MATCH_CANCEL_REJECTED:['取消匹配审核退回','Match Cancellation Returned'],TRUCK_CHANGE_REQUEST:['申请变更装车车辆','Loading Truck Change Requested'],TRUCK_CHANGE_APPROVED:['车辆变更审核通过','Truck Change Approved'],TRUCK_CHANGE_REJECTED:['车辆变更审核退回','Truck Change Returned'],GATE_PRINT_DIALOG_REQUESTED:['请求打印出门证','Gate Permit Print Requested']});
function action(row,kind){
 let k=key(row.action||row.after_data?.last_action||row.after_data?.action||row.to_status||row.after_data?.status);
 const a=row.after_data||{},b=row.before_data||{};
 if(row.entity_type==='co_load_exceptions')return {key:a.state==='RESOLVED'?'RESOLVE':'EXCEPTION',title:titles[a.state==='RESOLVED'?'RESOLVE':'EXCEPTION']};
 if(row.entity_type==='co_loading_reviews'){const prefix=String(a.kind||b.kind).includes('CANCEL')?'MATCH_CANCEL':'TRUCK_CHANGE',suffix=a.status==='APPROVED'?'APPROVED':a.status==='REJECTED'?'REJECTED':'REQUEST';return {key:prefix+'_'+suffix,title:titles[prefix+'_'+suffix]};}
 if(!row.action){
  if(row.entity_type==='co_outbounds')k='OUTBOUND';
  else if(/review/.test(row.entity_type||'')){k=a.status==='APPROVED'?'AMEND_APPROVE':a.status==='REJECTED'?'AMEND_REJECT':'AMEND_REQUEST';}
  else if(!row.before_data)k='CREATE';else if(!k||k===key(b.last_action))k='EDIT';
 }
 if(k.startsWith('CO_COUNT_'))k=k.slice(9);
 if(k==='CREATE_PREPARATION'||k==='CREATED')k='CREATE';
 if(k==='APPROVE_COMPLETION')k='COMPLETION_APPROVE';
 if(k==='SUBMIT_COMPLETION')k='COMPLETE';
 if(k==='REVIEW_APPROVE')k='APPROVE';
 if(k==='APPROVE'&&kind==='co-stocktake'||k==='APPROVE'&&kind==='stocktake')k='APPROVAL';
 if(k==='COMPLETE'&&kind==='stocktake')return {key:k,title:['完成盘点归档','Stocktake Archived']};
 if(k==='APPROVE'&&kind==='co-preparation')k='COMPLETION_APPROVE';
 if(k==='SALES_PLAN_APPROVED'){const state=a.state;return {key:k,title:state==='COMMERCE_PENDING'?['销售经理审批通过','Sales Manager Approved']:['销售计划终审通过','Sales Plan Final Approval']};}
 if(titles[k])return {key:k,title:titles[k]};
 const words=k.split('_');
 for(const token of ['REJECTED','REJECT','APPROVED','APPROVE','SUBMITTED','SUBMIT','WITHDRAWN','WITHDRAW','CANCELLED','CANCEL','CREATED','CREATE','UPDATED','EDIT','REQUESTED','REQUEST','APPLIED','APPLY'])if(words.includes(token)){const aliases={REJECTED:'REJECT',APPROVED:'APPROVE',SUBMITTED:'SUBMIT',WITHDRAWN:'WITHDRAW',CANCELLED:'CANCEL',CREATED:'CREATE',UPDATED:'EDIT',REQUESTED:'REQUEST',APPLIED:'APPLY'};return {key:k,title:titles[aliases[token]||token]};}
 return {key:k,title:['单据变更记录','Document Change Recorded']};
}
function normalize(row,kind){
 const a=row.after_data||{},b=row.before_data||{},act=action(row,kind),role=row.actor_role_snapshot||row.actor_role||null;
 const reason=row.reason||row.note||a.review_note||a.reason||a.note||a.last_note||a.commerce_reason||a.sales_reason||a.request_reason||'';
 const result=act.key!=='VERIFY_RETURN'&&/REJECT|(?:^|_)RETURN$/.test(act.key)?['已退回','Returned']:/SUBMIT|REQUEST/.test(act.key)&&!/APPROV/.test(act.key)?['已提交','Submitted']:/CANCEL/.test(act.key)?['已取消','Cancelled']:/WITHDRAW/.test(act.key)?['已撤回','Withdrawn']:/APPROV|AUTHORIZE/.test(act.key)?['已通过','Approved']:/CONFIRM|APPLY|APPLIED|OUTBOUND|CLOSED|EXIT_CONFIRMED|VERIFY_RETURN/.test(act.key)?['已完成','Completed']:['已记录','Recorded'];
 const before=row.from_status||b.workflow_state||b.state||b.status||null,after=row.to_status||a.workflow_state||a.state||a.status||null;
 const fields={code:['单据编号','Document No.'],invoice_no:['发票号','Invoice No.'],packing_list_no:['装箱单号','Packing List No.'],export_license_no:['出口许可证号','Export License No.'],transporter:['运输商','Transporter'],destination:['目的地','Destination'],vehicle_no:['车牌号','Truck Plate'],truck_no:['车头号','Truck Plate'],shipment_month:['发运月份','Shipment Month'],preparation_month:['发运月份','Shipment Month'],target_weight:['计划数量（吨）','Planned Quantity (MT)'],quantity_tolerance:['溢短装（%）','Tolerance (%)'],bag_count:['袋数','Bags'],actual_gross_kg:['实际毛重（kg）','Actual Gross (kg)'],actual_net_kg:['实际净重（kg）','Actual Net (kg)'],cobalt_grade_pct:['钴品位（%）','Cobalt Grade (%)'],arecoms_quantity_mt:['ARECOMS金属量（吨）','ARECOMS Quantity (MT)'],remark:['备注','Remarks']},changes=[];
 if(before!==after&&(before||after))changes.push({field:'state',label:['状态','State'],before,after});
 for(const[field,label]of Object.entries(fields))if(Object.hasOwn(a,field)&&a[field]!==b[field]&&[a[field],b[field]].every(v=>v==null||['string','number','boolean'].includes(typeof v)))changes.push({field,label,before:b[field]??null,after:a[field]??null});
 if(Array.isArray(a.lines)){const numbers=lines=>Array.isArray(lines)?lines.map(r=>r.bundle_no).filter(Boolean).sort().join('\n'):null,beforeNumbers=numbers(b.lines),afterNumbers=numbers(a.lines);if(beforeNumbers!==afterNumbers&&afterNumbers)changes.push({field:'bundle_numbers',label:['捆包号','Bundle Numbers'],before:beforeNumbers,after:afterNumbers});}
 return {id:row.source+':'+row.id,source:row.source,at:row.occurred_at,action:act.key,title:act.title,actor_id:row.actor_id,actor_name:row.actor_name_snapshot||row.actor_name||null,actor_name_en:E.englishName(row.actor_name_snapshot||row.actor_name||''),role_code:role,role_name:row.actor_role_name_snapshot||row.recorded_role_name||null,role_name_en:row.actor_role_name_en_snapshot||row.recorded_role_name_en||null,role_basis:role?'RECORDED':'HISTORICAL_UNKNOWN',result,note:String(reason||''),before_state:before,after_state:after,changes};
}
const sources={
 lot:[['lot_work_history','allocation_id']],load:[['workflow_reviews','loading_id']],plan:[['loading_plan_match_history','document_id']],
 'co-preparation':[['co_events','preparation_id']],
 'co-plan':[['co_loading_events','plan_id']], 'co-load':[['co_execution_events','order_id'],['co_loading_events','order_id']],
 stocktake:[['stocktake_steps','stocktake_id']],'co-stocktake':[['co_stocktake_events','task_id']],adjustment:[['adjustment_steps','adjustment_id']],correction:[['outbound_correction_steps','correction_id']],gate:[['gate_events','permit_id']]
};
const entityTypes={receipt:['receipts'],lot:['allocations'],sales:['sales_plans','co_sales_plans','sales_plan_review','sales_plan_close'],plan:['loading_plan_documents','loading_plans','loading_plan_document'],registration:['registration_request','registration_requests']};
async function history(c,kind,id,product,page=1){
 const selects=[];
 for(const[table,col]of sources[kind]||[]){let extra='';if(table==='co_work_events')extra=" AND e.bag_id IS NULL";if(table==='co_loading_events')extra=" AND (e.entity_type='co_loading_reviews' OR e.entity_type='co_loading_orders' AND e.before_data IS NULL OR e.entity_type='co_loading_plans' AND (e.before_data IS NULL OR e.after_data->>'last_action' IN('EDIT','UPDATE','DRAFT_EDIT','DOCUMENTS')))";if(table==='co_execution_events')extra=" AND e.entity_type IN('co_load_executions','co_load_exceptions') AND NOT(e.entity_type='co_load_executions' AND e.after_data->>'last_action'='EXCEPTION')";
  if(table==='lot_work_history')extra+=' AND e.bundle_id IS NULL';
  if(table==='stocktake_steps')extra+=" AND e.action<>'SNAPSHOT_CREATED'";
  selects.push(`SELECT e.id,e.occurred_at,'${table}'::text source,to_jsonb(e)||jsonb_build_object('source','${table}','actor_name',u.display_name) payload FROM ${table} e LEFT JOIN users u ON u.id=e.actor_id WHERE e.${col}=$1::uuid${extra}`);
 }
 const values=entityTypes[kind]?[id,entityTypes[kind],product]:[id];
 if(entityTypes[kind])selects.push(`SELECT a.id,a.occurred_at,'audit_logs'::text source,to_jsonb(a)||jsonb_build_object('source','audit_logs','actor_name',u.display_name,'recorded_role_name',r.name,'recorded_role_name_en',r.name_en) payload FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id LEFT JOIN roles r ON r.code=a.actor_role WHERE a.entity_id=$1::text AND a.entity_type=ANY($2) AND coalesce(a.outcome,'COMMITTED')='COMMITTED' AND (a.after_data->>'product_code' IS NULL OR a.after_data->>'product_code'=$3)${kind==='plan'?" AND a.action NOT ILIKE '%match%'":kind==='lot'?" AND a.action ILIKE '%creat%'":kind==='sales'?" AND a.action NOT ILIKE '%dispatch%'":''}`);
 // Every row retains its original source identity. No timing-based role matching or fabricated approvals.
 if(!selects.length)return {items:[],page,page_size:20,total:0};
 const size=20,sql=selects.join(' UNION ALL '),result=(await c.query('WITH events AS('+sql+') SELECT (SELECT count(*)::int FROM events) total,coalesce((SELECT jsonb_agg(payload ORDER BY occurred_at DESC,source,id DESC) FROM(SELECT * FROM events ORDER BY occurred_at DESC,source,id DESC LIMIT $'+(values.length+1)+' OFFSET $'+(values.length+2)+") paged),'[]'::jsonb) items",[...values,size,(page-1)*size])).rows[0];
 const last=Math.max(1,Math.ceil(result.total/size));if(page>last)return history(c,kind,id,product,last);
 return {items:result.items.map(r=>normalize(r,kind)),page,page_size:size,total:result.total};
}
function workflow(kind,data,product,roles,{draft=false}={}){
 const d=data.permit||data.document||data.task||data.order||data.lot||data,p=data.plan||{},co=product==='CO_HYDROXIDE';
 const node=(zh,en,permission)=>({title:zh,title_en:en,permission,roles:roles[product]?.[permission]||[]});
 let nodes=[],rank=-1,state=d.workflow_state||d.phase||d.status||'',legacy=false;
 const n=node;
 if(kind==='receipt'){nodes=[n('提交入库单','Submit Receipt','receipt:write'),n('入库审核','Receipt Review','receipt:review'),n('正式入库','Receipt Posted','receipt:review')];rank=({DRAFT:0,PENDING:1,REJECTED:1,CONFIRMED:2})[state]??-1;}
 if(kind==='lot'){nodes=[n('备货作业','Preparation Work','allocation:write'),n('备货审核','Preparation Review','allocation:review'),n('备货完成','Preparation Completed','allocation:review')];rank=({DRAFT:0,WORKING:0,RECTIFY:1,PENDING:1,PREPARED:2,PARTIAL:2,FULFILLED:2})[state]??-1;}
 if(kind==='co-preparation'){const w=data.work||{};if(draft||data.intake_flow_version===2){nodes=[n('提交备货','Submit Preparation','co:submit'),n('备货作业','Preparation Work','co:work-edit'),n('现场主管审核','Site Supervisor Review','co:completion-review'),n('确认入库','Confirm Receipt','co:production-review'),n('正式入库','Formally Received','co:production-review')];rank=({DRAFT:0,WITHDRAWN:0,PREPARING:1,SITE_PENDING:2,PRODUCTION_PENDING:3,RECEIVED:4})[data.prep_status||state]??-1;return {kind,state:data.prep_status||state,nodes,rank,rejected:false};}if(w.status&&(state==='RECEIVED'||!state))state=w.status;nodes=[n('提交入库单','Submit Intake','co:submit'),n('现场审核','Site Review','co:site-review'),n('生产审核入库','Production Receipt Approval','co:production-review'),n('备货作业','Preparation Work','co:work-edit'),n('完工审核','Completion Review','co:completion-review'),n('备货完成','Preparation Completed','co:completion-review')];rank=({DRAFT:0,WITHDRAWN:0,SITE_PENDING:1,PRODUCTION_PENDING:2,RECEIVED:3,PREPARING:3,PENDING_COMPLETION_REVIEW:4,COMPLETED:5,REJECTED:1})[state]??-1;}
 if(kind==='plan'||kind==='co-plan'){state=data._loading_state||data.plan?.status||state;nodes=[n('创建装车计划','Create Loading Plan','loading-plan:write'),n(co?'整批匹配建单':'匹配新建装车单',co?'Match Whole Batch':'Match Loading Order','loading-plan:match'),n('实际装车','Actual Loading','load:write'),n('装车审核','Loading Review','load:review'),n('出库申报','Outbound Declaration','load:execute'),n('物流审核','Logistics Review','outbound:logistics-review'),n('生产终审','Final Production Review','outbound:production-approve')];rank=draft?0:({LOADING:2,PENDING:3,REVIEW_PENDING:3,READY:4,LOADED:4,DEPARTED:5,OUTBOUND_PENDING:5,DEPARTED_PENDING:5,LOGISTICS_APPROVED:6,OUTBOUND_CORRECTION:6,OUTBOUND:7})[state]??(data.order?.status!=='CANCELLED'&&data.order||d.loading_id||d.current_load_id||state==='MATCHED'?2:1);}
 if(kind==='load'||kind==='co-load'){
  state=data.execution?.state||state;nodes=[n('新建及实际装车','Create and Load','load:write'),n('装车审核','Loading Review','load:review'),n('出库申报','Outbound Declaration','load:execute'),n('物流审核','Logistics Review','outbound:logistics-review'),n('生产终审','Final Production Review','outbound:production-approve'),n('正式出库','Outbound Posted','outbound:production-approve')];
  rank=({WAITING:0,MATCHED:0,DRAFT:0,LOADING:0,PENDING:1,REVIEW_PENDING:1,READY:2,LOADED:2,DEPARTED:2,OUTBOUND_PENDING:3,DEPARTED_PENDING:d.logistics_review_by?4:3,DEPARTED_CORRECTION:3,LOGISTICS_APPROVED:4,OUTBOUND_CORRECTION:4,OUTBOUND:5,COMPLETED:5,REJECTED:1})[state]??-1;
 }
 if(kind==='sales'){state=data.approval_state||'';legacy=state==='LEGACY';const old=data.flow_version===1&&state==='APPROVED';nodes=[n('提交销售计划','Submit Sales Plan','plan:write'),n('销售审批','Sales Review','plan:approve'),...(!old?[n('商务终审','Commercial Final Review','plan:commerce-approve')]:[])];rank=state==='APPROVED'?nodes.length:state==='COMMERCE_PENDING'||data.rejected_stage==='COMMERCE'?2:state==='PENDING'||state==='REJECTED'?1:-1;}
 if(kind==='sales-close'){state=data.state;nodes=[n('申请关闭计划','Request Plan Closure','plan:write'),n('销售审批','Sales Review','plan:approve'),n('商务终审','Commercial Final Review','plan:commerce-approve')];rank=state==='APPROVED'?3:state==='COMMERCE_PENDING'||data.rejected_stage==='COMMERCE'?2:1;}
 if(kind==='co-amend'){state=data.amendment_status;nodes=[n('申请备货更正','Request Preparation Correction','co:amend-request'),n('更正复核','Correction Review','co:amend-review')];rank=state==='APPROVED'?2:1;}
 if(kind==='co-match-review'){state=data.status;nodes=[n(String(data.kind).includes('CANCEL')?'申请取消匹配':'申请变更车辆',String(data.kind).includes('CANCEL')?'Request Match Cancellation':'Request Truck Change','loading-plan:match'),n('匹配变更审核','Match Change Review','co:loading-review')];rank=state==='APPROVED'?2:1;}
 if(kind==='lot-cancel'){state='APPROVED';nodes=[n('取消备货审核','Preparation Cancellation Review','lot:cancel-approve')];rank=1;}
 if(kind==='co-exception'){state=data.state;nodes=[n('登记装车异常','Record Loading Exception','load:write'),n('异常复核','Exception Review','load:review')];rank=state==='RESOLVED'?2:1;}
 if(kind==='stocktake'){const adjusts=state==='ADJUSTMENTS'||(data.resolutions||[]).some(r=>r.adjustment_id)||(data.adjustments||[]).length;nodes=[n('创建盘点','Create Stocktake','stocktake:write'),n('实盘作业','Physical Count','stocktake:write'),n('差异复核','Discrepancy Review','stocktake:review'),n('盘点审批','Stocktake Approval','stocktake:final'),...(adjusts?[n('调整生效','Apply Adjustments','adjust:approve')]:[]),n('完成归档','Archive Stocktake','stocktake:review')];rank=state==='COMPLETED'?nodes.length-1:({DRAFT:0,IN_PROGRESS:1,REVIEW:2,APPROVAL:3,ADJUSTMENTS:4})[state]??-1;}
 if(kind==='co-stocktake'){nodes=[n('创建及实盘','Create and Count','stocktake:write'),n('提交盘点','Submit Stocktake','stocktake:write'),n('独立复核','Independent Review','stocktake:review'),n('完成归档','Archive Stocktake','stocktake:review')];rank=({OPEN:0,SUBMITTED:2,REJECTED:0,APPROVED:3})[state]??-1;}
 if(kind==='adjustment'){nodes=[n('调整申请','Request Adjustment','adjust:write'),n('调整审批','Adjustment Review','adjust:approve'),n('调整生效','Adjustment Applied','adjust:approve')];rank=({DRAFT:0,PENDING:1,SUBMITTED:1,APPROVED:2,APPLIED:2,REJECTED:1})[state]??-1;}
 if(kind==='correction'){nodes=[n('更正申请','Request Correction','load:write'),n('更正审批','Correction Review','outbound:approve'),...(d.kind==='RETURN_OUTBOUND'?[n('退回核验','Verify Return','load:review')]:[]),n('更正生效','Correction Applied','outbound:approve')];rank=({REQUESTED:1,AUTHORIZED:nodes.length-2,RETURN_VERIFIED:nodes.length-1,APPLIED:nodes.length,REJECTED:1})[state]??-1;}
 if(kind==='gate'){const permit=data.permit||d,revision=permit.current_revision;state=permit.state;nodes=[n('最终出库审批','Final Outbound Approval','outbound:production-approve'),n('生成出门证','Issue Gate Permit','gate:issue'),n('请求打印出门证','Request Gate Permit Printing','gate:print'),n('确认实际出厂','Confirm Physical Exit','gate:exit')];rank=data.exit||state==='EXITED'?4:(data.history||[]).some(e=>e.action==='gate_print_dialog_requested'&&Number(e.after_data?.revision)===revision)?3:2;}
 if(draft&&rank<0)rank=0;
 const rejected=/REJECT|RECTIFY|CORRECTION/.test(state),cancelled=/CANCELLED|WITHDRAWN/.test(state);
 return {kind,state,nodes,rank:cancelled?-1:rank,rejected,cancelled,legacy};
}
async function recordedFacts(c,kind,id,data){
 const d=data.permit||data.document||data.task||data.order||data.lot||data;
 // These are explicit actor/time pairs from the authorized original document.
 // They do not prove a role or an unrecorded review decision.
 const pairs=[['created_by','created_at',['创建单据记录','Recorded Document Creation']],...(kind==='sales'?[
  ['submitted_by','submitted_at',['销售计划提交记录','Recorded Sales Plan Submission']],['sales_reviewed_by','sales_reviewed_at',['销售审批记录','Recorded Sales Review']],['commerce_reviewed_by','commerce_reviewed_at',['商务审批记录','Recorded Commercial Review']]
 ]:kind==='receipt'?[
  ['submitted_by','submitted_at',['入库提交记录','Recorded Receipt Submission']],['reviewed_by','confirmed_at',['入库确认记录','Recorded Receipt Confirmation']]
 ]:kind==='co-preparation'?[
  ['submitted_by','submitted_at',['入库提交记录','Recorded Intake Submission']],['site_reviewed_by','site_reviewed_at',['现场审核记录','Recorded Site Review']],['production_reviewed_by','production_reviewed_at',['生产审核记录','Recorded Production Review']]
 ]:kind==='adjustment'?[
  ['approved_by','approved_at',['调整审批记录','Recorded Adjustment Approval']]
 ]:[['submitted_by','submitted_at',['提交审核记录','Recorded Review Submission']],['reviewed_by','reviewed_at',['审核办理记录','Recorded Review']]])];
 const entries=pairs.filter(([actor,at])=>/^[0-9a-f-]{36}$/i.test(d[actor]||'')&&d[at]&&Number.isFinite(Date.parse(d[at]))),ids=[...new Set(entries.map(([actor])=>d[actor]))];if(!ids.length)return {items:[],page:1,page_size:20,total:0};
 const people=(await c.query('SELECT id,display_name FROM users WHERE id=ANY($1::uuid[])',[ids])).rows;
 const items=entries.map(([actor,at,title])=>{const r=normalize({source:'document_fields',id:id+'/'+actor,actor_id:d[actor],actor_name:people.find(p=>p.id===d[actor])?.display_name,occurred_at:d[at],action:'RECORDED_FACT'},kind);return {...r,title};}).sort((a,b)=>new Date(b.at)-new Date(a.at));
 return {items,page:1,page_size:20,total:items.length};
}
async function enrich(c,req,data){
 const path=req.url.split('?')[0];
 if(path==='/api/v1/me'||path==='/api/v1/product-context'){
  const roles=await catalog(c);data._approval_catalog={roles,drafts:Object.fromEntries(['CU_CATHODE','CO_HYDROXIDE'].map(product=>[product,Object.fromEntries((product==='CU_CATHODE'?['receipt','lot','plan','load','sales','stocktake']:['co-preparation','co-plan','co-load','sales','co-stocktake']).map(kind=>[kind,workflow(kind,{status:'DRAFT'},product,roles,{draft:true})]))]))};return data;
 }
 if(path==='/api/v1/users/registration-requests'&&Array.isArray(data.items)){
  for(const row of data.items){row._approval_history=await history(c,'registration',row.id,req.productCode);if(!row._approval_history.total&&row.reviewed_at){const r=(await c.query('SELECT q.reviewed_by,u.display_name FROM registration_requests q LEFT JOIN users u ON u.id=q.reviewed_by WHERE q.id=$1',[row.id])).rows[0];if(r?.reviewed_by){row._approval_history={items:[normalize({source:'registration_requests',id:row.id,actor_id:r.reviewed_by,actor_name:r.display_name,occurred_at:row.reviewed_at,action:'REGISTRATION_'+row.status,note:row.review_reason},'registration')],page:1,page_size:20,total:1};}}}
  return data;
 }
 const target=identify(path,data);if(!target)return data;
 const product=req.productCode||'CU_CATHODE',page=Number(req.query.approval_page||1);
 if(!Number.isInteger(page)||page<1||page>100000)throw Object.assign(Error('审批历史页码无效'),{statusCode:400});
 const[roles,events]=await Promise.all([catalog(c),history(c,target.kind,target.id,product,page)]),timeline=events.total?events:await recordedFacts(c,target.kind,target.id,data);
 let flowData=data;
 if(target.kind==='plan'&&data.loading_id){const load=(await c.query('SELECT workflow_state,logistics_review_by FROM loading_orders WHERE id=$1',[data.loading_id])).rows[0];if(load)flowData={...data,_loading_state:load.workflow_state==='DEPARTED_PENDING'&&load.logistics_review_by?'LOGISTICS_APPROVED':load.workflow_state};}
 if(target.kind==='co-plan'&&data.order?.id){const load=(await c.query('SELECT state FROM co_load_executions WHERE order_id=$1',[data.order.id])).rows[0];if(load)flowData={...data,_loading_state:load.state};}
 const main=workflow(target.kind,flowData,product,roles);
 if(target.kind==='co-preparation'&&main.state==='REJECTED')main.rank=data.site_reviewed_by?2:1;
 const additional=[];
 if(target.kind==='sales')additional.push(...(data.close_requests||[]).slice(0,1).map(r=>workflow('sales-close',r,product,roles)));
 if(target.kind==='co-preparation'&&data.work?.amendment_status&&data.work.amendment_status!=='NONE')additional.push(workflow('co-amend',data.work,product,roles));
 if(target.kind==='co-plan')additional.push(...(data.reviews||[]).slice(0,1).map(r=>workflow('co-match-review',r,product,roles)));
 if(target.kind==='co-load')additional.push(...(data.exceptions||[]).slice(0,1).map(r=>workflow('co-exception',r,product,roles)));
 if(target.kind==='lot'&&main.state==='CANCELLED')additional.push(workflow('lot-cancel',data,product,roles));
 const related=[];
 if(target.kind==='load')for(const correction of (await c.query('SELECT id,code,kind,status FROM outbound_corrections WHERE loading_id=$1 ORDER BY requested_at DESC',[target.id])).rows){related.push({kind:'correction',id:correction.id,code:correction.code,url:'/v27/corrections/'+correction.id,workflows:[workflow('correction',correction,product,roles)],history:await history(c,'correction',correction.id,product)});}
 data._approval={kind:target.kind,id:target.id,product,workflows:[main,...additional],history:timeline,related};
 return data;
}
module.exports={catalog,identify,workflow,normalize,history,recordedFacts,enrich};
