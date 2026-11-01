'use strict';
const C=require('./control-common.cjs'),A=require('./allocations.cjs'),PL=require('./packing-list.cjs'),T=require('../dist/tonnes.js');
const posted="NOT EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=l.id AND cr.kind='RETURN_OUTBOUND' AND cr.status='APPLIED') AND l.status='DEPARTED' AND (l.workflow_state='OUTBOUND' AND l.manager_at IS NOT NULL OR l.workflow_state IS NULL AND EXISTS(SELECT 1 FROM outbound_orders oo WHERE oo.loading_id=l.id AND oo.status='DEPARTED' AND oo.reversal_status<>'CONFIRMED'))";
const logisticsReady="l.workflow_state='DEPARTED_PENDING' AND l.status NOT IN('CANCELLED','REVERSED') AND l.logistics_review_by IS NOT NULL AND l.logistics_review_at IS NOT NULL AND l.actual_departed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=l.id AND cr.status IN('REQUESTED','AUTHORIZED','RETURN_VERIFIED'))";
const packingEligible='(('+posted+') OR ('+logisticsReady+'))';
const scope=`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=l.project_id AND(s.customer_id IS NULL OR s.customer_id=l.customer_id)) AND NOT EXISTS(SELECT 1 FROM loading_items ix JOIN bundles bx ON bx.id=ix.bundle_id JOIN locations lx ON lx.id=ix.original_location_id WHERE ix.loading_id=l.id AND NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=l.project_id AND(s.customer_id IS NULL OR s.customer_id=l.customer_id) AND(s.warehouse_id IS NULL OR s.warehouse_id=lx.warehouse_id)))`;
const LP=require('./loading-plans.cjs');
const requiredTransport={packing_list_no:'装箱单号',eb_license:'出口许可证号',forwarder:'运输商',destination:'目的地',vehicle_no:'车牌号',shipment_batch_no:'发运批次号'};
const transportFields={packing_list_no:80,shipment_batch_no:160,vehicle_no:80,trailer_one:80,trailer_two:80,driver_name:160,passport_no:80,container_no:40,container_seal_no:40,forwarder:160,destination:1000,buyer_information:1600,eb_license:160};
const contact=l=>[l.customer_address||'',l.customer_email?'Email: '+l.customer_email:'',l.customer_phone?'Tel: '+l.customer_phone:''].filter(Boolean).join('\n');
const format=n=>(n/1000000n)+'.'+String(n%1000000n).padStart(6,'0');
async function load(c,req,id,formal=true){
 const l=(await c.query(`SELECT l.*,(${posted}) posted,(${packingEligible}) packing_eligible,cu.name customer_name,cu.code customer_code,cu.address customer_address,cu.email customer_email,cu.phone customer_phone,
 coalesce((SELECT o.code FROM outbound_orders o WHERE o.loading_id=l.id AND o.status='DEPARTED' ORDER BY o.created_at DESC LIMIT 1),l.code) outbound_no,
 coalesce(l.manager_at,(SELECT max(o.departed_at) FROM outbound_orders o WHERE o.loading_id=l.id AND o.status='DEPARTED')) outbound_at
 FROM loading_orders l JOIN customers cu ON cu.id=l.customer_id WHERE l.id=$2 AND ${scope}`,[req.user.id,C.uuid(id)])).rows[0];
 if(!l)throw C.error(403,'装车记录不存在或超出授权范围');
 if(formal&&!l.packing_eligible)throw C.error(409,'物流经理审批通过后方可生成、预览或下载Packing List；已取消、驳回或冲销单据不可使用');return l;
}
async function detail(c,req,id){
 const v31=await LP.enabled(c),selected=v31?' AND NOT i.plan_removed':'';const l=await load(c,req,id),items=(await c.query(`SELECT i.bundle_id,b.bundle_no,
 CASE WHEN l.workflow_state IS NULL THEN coalesce(i.sheets_snapshot,b.sheets_per_bundle) ELSE i.sheets_snapshot END sheets_per_bundle,
 CASE WHEN l.workflow_state IS NULL THEN coalesce(i.seal_no_snapshot,b.seal_no) ELSE i.seal_no_snapshot END seal_no,
 coalesce(ai.gross_weight,b.gross_weight)::text gross_weight,i.original_weight::text net_weight,
 a.id allocation_id,a.lot_no,p.id plan_id,p.code plan_code,k.contract_no
 FROM loading_items i JOIN loading_orders l ON l.id=i.loading_id JOIN bundles b ON b.id=i.bundle_id
 JOIN reservations r ON r.id=i.reservation_id JOIN allocations a ON a.id=r.allocation_id JOIN sales_plans p ON p.id=a.plan_id
 LEFT JOIN allocation_items ai ON ai.allocation_id=a.id AND ai.bundle_id=i.bundle_id LEFT JOIN customer_contracts k ON k.id=p.contract_id
 WHERE i.loading_id=$1 ${selected} ORDER BY b.bundle_no`,[l.id])).rows;
 if(items.length!==Number((await c.query('SELECT count(*) n FROM loading_items i WHERE loading_id=$1'+selected,[l.id])).rows[0].n))throw C.error(409,'出库明细关联不完整，请核查原始记录');
 const transport=(await c.query('SELECT fields,version,updated_at FROM export_transport WHERE loading_id=$1',[l.id])).rows[0]||{fields:{},version:0};
 const authorized_correction=(await c.query("SELECT id,code,proposed_data->>'vehicle_no' vehicle_no,applied_revision FROM outbound_corrections WHERE loading_id=$1 AND kind='VEHICLE' AND status='APPLIED' ORDER BY applied_at DESC,id DESC LIMIT 1",[l.id])).rows[0]||null;const loading_plan=await LP.matched(c,l.id);transport.fields={vehicle_no:l.vehicle_no,forwarder:l.carrier||'',...transport.fields,...(loading_plan?LP.transport(loading_plan):{})};
 if(authorized_correction)transport.fields.vehicle_no=authorized_correction.vehicle_no;transport.fields.buyer_information=contact(l);const customer_contact={name:l.customer_name,address:l.customer_address,email:l.customer_email,phone:l.customer_phone},customer_contact_signature=PL.digest(Buffer.from(JSON.stringify(customer_contact)));
 const document=(await c.query("SELECT d.*,r.file_name,r.file_sha256,r.template_sha256,r.snapshot->>'customer_contact_signature' customer_contact_signature,r.snapshot->>'source_signature' source_signature,r.snapshot->>'generation_basis' generation_basis FROM packing_list_documents d JOIN packing_list_revisions r ON r.loading_id=d.loading_id AND r.revision=d.revision WHERE d.loading_id=$1",[l.id])).rows[0]||null;
 const totals={gross:0n,net:0n},missing=[];for(const i of items){for(const key of ['gross','net']){const v=i[key+'_weight'];if(v==null)missing.push(i.bundle_no+' '+(key==='gross'?'毛重':'净重'));else totals[key]+=T.scaled(v,6);}}
 const date=at=>at?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(at):null,document_date=loading_plan?.planned_load_date||date(l.actual_departed_at||l.logistics_review_at||l.outbound_at),source_signature=PL.digest(Buffer.from(JSON.stringify({loading_id:l.id,customer:l.customer_name,document_date,...(authorized_correction?{authorized_correction}:{}),actual_departed_at:l.actual_departed_at,logistics_review_at:l.logistics_review_at,plan:loading_plan?{id:loading_plan.id,version:loading_plan.version,fields:LP.transport(loading_plan)}:null,items}))),document_stale=!!document&&(document.transport_version!==transport.version||!!authorized_correction&&!document.source_signature||!!document.source_signature&&document.source_signature!==source_signature||(document.customer_contact_signature?document.customer_contact_signature!==customer_contact_signature:!!contact(l)));
 return {authorized_correction,customer_contact,customer_contact_signature,posted:l.posted,packing_eligible:l.packing_eligible,document_date,source_signature,document_stale,generation_basis:l.posted?'POSTED':'LOGISTICS_APPROVED',loading_plan,packing_list_no:loading_plan?.packing_list_no||null,loading_id:l.id,loading_code:l.code,outbound_no:loading_plan?.packing_list_no||document?.document_no||l.outbound_no,outbound_at:l.outbound_at?.toISOString(),outbound_date:l.outbound_at?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(l.outbound_at):null,vehicle_no:l.vehicle_no,customer_name:l.customer_name,customer_code:l.customer_code,
 items,bundle_count:items.length,total_net_weight:missing.some(x=>x.endsWith('净重'))?null:format(totals.net),total_gross_weight:missing.some(x=>x.endsWith('毛重'))?null:format(totals.gross),
 contracts:[...new Set(items.map(i=>i.contract_no).filter(Boolean))],lots:[...new Set(items.map(i=>i.lot_no).filter(Boolean))],plans:[...new Map(items.map(i=>[i.plan_id,{id:i.plan_id,code:i.plan_code}])).values()],
 transport,document,missing_weights:missing,transport_changes:(await c.query("SELECT a.occurred_at,a.before_data->'fields' before_fields,a.after_data->'fields' after_fields,a.after_data->>'reason' reason,u.display_name actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id WHERE a.entity_id=$1 AND a.action='export_transport_updated' ORDER BY a.id DESC",[l.id])).rows,revisions:(await c.query('SELECT revision,file_name,file_sha256,template_sha256,generated_at,generated_by,reason FROM packing_list_revisions WHERE loading_id=$1 ORDER BY revision DESC',[l.id])).rows};
}
async function list(c,req,formal,includeApproved=false){
 const v31=await LP.enabled(c),selected=v31?' AND NOT i.plan_removed':'';const q=req.query||{},page=Number(q.page||1);if(!Number.isInteger(page)||page<1||page>100000)throw C.error(400,'页码无效');
 const values=[req.user.id],parts=[scope];if(formal)parts.push(includeApproved?packingEligible:posted);
 const bind=v=>{values.push(v);return '$'+values.length;};
 for(const key of ['contract_no','customer','outbound_no','vehicle_no','status','plan_id','start','end'])if(q[key]!==undefined&&(typeof q[key]!=='string'||q[key].length>160))throw C.error(400,'筛选参数无效');
 if(q.customer)parts.push('cu.name ILIKE '+bind('%'+q.customer.trim()+'%'));
 if(q.vehicle_no){const p=bind('%'+q.vehicle_no.trim()+'%');parts.push(`(l.vehicle_no ILIKE ${p} OR t.fields->>'vehicle_no' ILIKE ${p} OR EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=l.id AND cr.kind='VEHICLE' AND cr.status='APPLIED' AND cr.proposed_data->>'vehicle_no' ILIKE ${p}))`);}
 if(q.outbound_no){const p=bind('%'+q.outbound_no.trim()+'%');parts.push(`(l.code ILIKE ${p} OR EXISTS(SELECT 1 FROM outbound_orders oo WHERE oo.loading_id=l.id AND oo.code ILIKE ${p}) ${v31?`OR EXISTS(SELECT 1 FROM loading_plan_matches m JOIN loading_plan_documents x ON x.id=m.document_id WHERE m.loading_id=l.id AND x.packing_list_no ILIKE ${p})`:""})`);}
 if(q.status)parts.push('l.workflow_state='+bind(q.status));
 if(q.contract_no)parts.push(`EXISTS(SELECT 1 FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN allocations a ON a.id=r.allocation_id JOIN sales_plans p ON p.id=a.plan_id JOIN customer_contracts k ON k.id=p.contract_id WHERE i.loading_id=l.id ${selected} AND k.contract_no ILIKE ${bind('%'+q.contract_no.trim()+'%')})`);
 if(q.plan_id)parts.push(`EXISTS(SELECT 1 FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN allocations a ON a.id=r.allocation_id WHERE i.loading_id=l.id ${selected} AND a.plan_id=${bind(C.uuid(q.plan_id))})`);
 const at=includeApproved?"coalesce(l.manager_at,l.actual_departed_at,l.logistics_review_at,(SELECT max(o.departed_at) FROM outbound_orders o WHERE o.loading_id=l.id AND o.status='DEPARTED'))":"coalesce(l.manager_at,(SELECT max(o.departed_at) FROM outbound_orders o WHERE o.loading_id=l.id AND o.status='DEPARTED'))";
 if(q.start)parts.push(`${at}>=(${bind(C.date(q.start))}::date::timestamp AT TIME ZONE 'Africa/Lubumbashi')`);
 if(q.start&&q.end&&q.start>q.end)throw C.error(400,'开始日期不能晚于结束日期');
 if(q.end)parts.push(`${at}<((${bind(C.date(q.end))}::date+1)::timestamp AT TIME ZONE 'Africa/Lubumbashi')`);
 const from=`FROM loading_orders l JOIN customers cu ON cu.id=l.customer_id LEFT JOIN export_transport t ON t.loading_id=l.id LEFT JOIN packing_list_documents d ON d.loading_id=l.id WHERE ${parts.join(' AND ')}`;
 const total=Number((await c.query('SELECT count(*) n '+from,values)).rows[0].n);values.push((page-1)*30);
 const items=(await c.query(`SELECT ${v31?"(SELECT x.packing_list_no FROM loading_plan_matches m JOIN loading_plan_documents x ON x.id=m.document_id WHERE m.loading_id=l.id) packing_list_no,":''} l.id,l.code,l.workflow_state,l.logistics_review_by,l.status,l.vehicle_no,coalesce((SELECT cr.proposed_data->>'vehicle_no' FROM outbound_corrections cr WHERE cr.loading_id=l.id AND cr.kind='VEHICLE' AND cr.status='APPLIED' ORDER BY cr.applied_at DESC,cr.id DESC LIMIT 1),nullif(t.fields->>'vehicle_no',''),l.vehicle_no) shipping_vehicle_no,cu.name customer_name,
 coalesce((SELECT o.code FROM outbound_orders o WHERE o.loading_id=l.id AND o.status='DEPARTED' ORDER BY o.created_at DESC LIMIT 1),l.code) outbound_no,
 ${at} outbound_at,to_char((${at}) AT TIME ZONE 'Africa/Lubumbashi','YYYY-MM-DD') outbound_date,(${posted}) posted,(${packingEligible}) packing_eligible,d.document_no,d.revision,d.generated_at,
 (SELECT count(*)::int FROM loading_items i WHERE i.loading_id=l.id ${selected}) bundle_count,
 (SELECT sum(i.original_weight)::text FROM loading_items i WHERE i.loading_id=l.id ${selected}) total_net_weight,
 (SELECT string_agg(DISTINCT a.lot_no,' / ') FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN allocations a ON a.id=r.allocation_id WHERE i.loading_id=l.id ${selected}) lot_no,
 (SELECT string_agg(DISTINCT k.contract_no,' / ') FROM loading_items i JOIN reservations r ON r.id=i.reservation_id JOIN allocations a ON a.id=r.allocation_id JOIN sales_plans p ON p.id=a.plan_id LEFT JOIN customer_contracts k ON k.id=p.contract_id WHERE i.loading_id=l.id ${selected}) contract_no
 ${from} ORDER BY l.created_at DESC,l.id LIMIT 30 OFFSET $${values.length}`,values)).rows;return {items:items.map(r=>({...r,internal_loading_no:r.code,outbound_no:r.packing_list_no||r.document_no||r.outbound_no})),total,page,page_size:30};
}
async function progress(c,req,id){
 const p=await A.planAccess(c,req,id),values=[req.user.id,p.id];
 const valid=`EXISTS(SELECT 1 FROM user_scopes s JOIN locations lc ON lc.warehouse_id=coalesce(s.warehouse_id,lc.warehouse_id) WHERE lc.id=b.location_id AND s.user_id=$1 AND s.project_id=p.project_id AND(s.customer_id IS NULL OR s.customer_id=p.customer_id))`;
 const selected=await LP.enabled(c)?' AND NOT i.plan_removed':'';const rows=(await c.query(`WITH current_assigned AS(SELECT DISTINCT ON(b.id) b.id bundle_id,CASE WHEN wi.final_weighed IS DISTINCT FROM false THEN b.net_weight END net_weight, false shipped,NULL::uuid loading_id FROM reservations r JOIN allocations a ON a.id=r.allocation_id JOIN sales_plans p ON p.id=a.plan_id JOIN bundles b ON b.id=r.bundle_id LEFT JOIN lot_work_items wi ON wi.allocation_id=a.id AND wi.bundle_id=b.id WHERE a.plan_id=$2 AND r.released_at IS NULL AND a.workflow_state IS DISTINCT FROM 'CANCELLED' AND b.physical_status='IN_STOCK' AND ${valid}),
 shipped AS(SELECT DISTINCT ON(l.id,i.bundle_id) i.bundle_id,i.original_weight net_weight,true shipped,l.id loading_id FROM loading_items i JOIN loading_orders l ON l.id=i.loading_id JOIN reservations r ON r.id=i.reservation_id JOIN allocations a ON a.id=r.allocation_id JOIN sales_plans p ON p.id=a.plan_id JOIN bundles b ON b.id=i.bundle_id WHERE a.plan_id=$2 ${selected} AND (${posted}) AND ${valid}) SELECT * FROM current_assigned UNION ALL SELECT * FROM shipped`,values)).rows;
 const sum=rs=>format(rs.reduce((n,r)=>n+(r.net_weight==null?0n:T.scaled(r.net_weight,6)),0n)),out=rows.filter(r=>r.shipped),unknown=rows.filter(r=>r.net_weight==null).length,outUnknown=out.filter(r=>r.net_weight==null).length,shippedNet=sum(out),remaining=outUnknown?null:T.scaled(p.target_weight,6)-T.scaled(shippedNet,6);
 const related=(await c.query(`SELECT a.id,a.code,a.lot_no,a.workflow_state FROM allocations a WHERE a.plan_id=$1 AND NOT EXISTS(SELECT 1 FROM allocation_items ai JOIN bundles b ON b.id=ai.bundle_id WHERE ai.allocation_id=a.id AND NOT EXISTS(SELECT 1 FROM user_scopes s JOIN locations lc ON lc.id=b.location_id WHERE s.user_id=$2 AND s.project_id=$3 AND(s.customer_id IS NULL OR s.customer_id=$4) AND(s.warehouse_id IS NULL OR s.warehouse_id=lc.warehouse_id))) ORDER BY a.created_at`,[p.id,req.user.id,p.project_id,p.customer_id])).rows;
 const shipmentList=await list(c,{...req,query:{plan_id:p.id}},true);for(const shipment of shipmentList.items){const selected=out.filter(r=>r.loading_id===shipment.id);shipment.plan_net_weight=selected.some(r=>r.net_weight==null)?null:sum(selected);shipment.plan_bundles=selected.length;}
 return {plan_id:p.id,plan_code:p.code,customer_name:p.customer_name,contract_no:p.contract_no,planned_net_weight:p.target_weight,
 prepared_net_weight:unknown?null:sum(rows),prepared_known_net_weight:sum(rows),prepared_bundles:rows.length,unknown_bundles:unknown,
 shipped_net_weight:outUnknown?null:shippedNet,shipped_bundles:out.length,remaining_net_weight:remaining==null?null:(remaining<0n?'-'+format(-remaining):format(remaining)),over_shipped:remaining!=null&&remaining<0n,
 allocations:related,shipments:shipmentList,unit:'MT'};
}
async function currentRevision(c,req,id){const d=await detail(c,req,id);if(!d.document)throw C.error(409,'请先生成Packing List');if(d.document_stale)throw C.error(409,'计划或运输资料已变更，请重新生成Packing List。旧修订保留。');const r=(await c.query('SELECT * FROM packing_list_revisions WHERE loading_id=$1 AND revision=$2',[id,d.document.revision])).rows[0];if(!r||PL.digest(r.content)!==r.file_sha256)throw C.error(409,'单证文件校验失败');return {...r,transport_version:d.document.transport_version};}
async function download({pool,req,reply}){
 if(!req.user.permissions.includes('inventory:export'))throw C.error(403,'当前账号没有单证下载权限');
 const file=await C.read(pool,c=>currentRevision(c,req,req.params.id));
 return reply.header('Content-Disposition','attachment; filename="'+file.file_name+'"').type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(file.content);
}
async function register({app,pool,permitted,csrf}){
 app.get('/api/v1/shipping',{preHandler:permitted('load:read')},req=>C.read(pool,c=>list(c,req,true,true)));
 app.get('/api/v1/shipping/loads',{preHandler:permitted('load:read')},req=>C.read(pool,c=>list(c,req,false)));
 app.get('/api/v1/shipping/plans',{preHandler:permitted('plan:read')},req=>C.read(pool,async c=>{const ids=(await c.query('SELECT p.id FROM sales_plans p WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND(s.customer_id IS NULL OR s.customer_id=p.customer_id)) ORDER BY p.created_at DESC LIMIT 300',[req.user.id])).rows;return {items:await Promise.all(ids.map(p=>progress(c,req,p.id)))};}));
 app.get('/api/v1/shipping/plans/:id',{preHandler:permitted('plan:read')},req=>C.read(pool,c=>progress(c,req,req.params.id)));
 app.get('/api/v1/shipping/:id/eligibility',{preHandler:permitted('load:read')},req=>C.read(pool,async c=>{const l=await load(c,req,req.params.id,false);return {posted:l.posted,packing_eligible:l.packing_eligible};}));
 app.get('/api/v1/shipping/:id',{preHandler:permitted('load:read')},req=>C.read(pool,c=>detail(c,req,req.params.id)));
 app.get('/api/v1/shipping/:id/packing-list/preview',{preHandler:permitted('load:read')},req=>C.read(pool,async c=>{
  const d=await currentRevision(c,req,req.params.id);return {revision:d.revision,transport_version:d.transport_version,snapshot:d.snapshot,layout:await PL.preview(d.content)};
 }));
 app.patch('/api/v1/shipping/:id/transport',{preHandler:[permitted('load:write'),permitted('load:read'),csrf]},req=>C.mutate(pool,req,async c=>{
  const l=await load(c,req,req.params.id);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['packing-list:'+l.id]);
  const old=(await c.query('SELECT * FROM export_transport WHERE loading_id=$1 FOR UPDATE',[l.id])).rows[0],b=req.body||{};if(b.version!==(old?.version||0))throw C.error(409,'运输资料版本已变化，请刷新');
  const linked=await LP.matched(c,l.id),approvedVehicle=(await c.query("SELECT proposed_data->>'vehicle_no' vehicle_no FROM outbound_corrections WHERE loading_id=$1 AND kind='VEHICLE' AND status='APPLIED' ORDER BY applied_at DESC,id DESC LIMIT 1",[l.id])).rows[0],controlled={...(linked?LP.transport(linked):{}),...(approvedVehicle?{vehicle_no:approvedVehicle.vehicle_no}:{}),buyer_information:contact(l)};const fields={...old?.fields};if(!b.fields||Array.isArray(b.fields)||typeof b.fields!=='object'||Object.keys(b.fields).some(k=>!transportFields[k]))throw C.error(400,'运输资料字段无效');
  for(const [key,v] of Object.entries(b.fields)){if(typeof v!=='string'||v.length>transportFields[key]||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))throw C.error(400,'运输资料内容无效');if(key==='buyer_information'&&v.trim()!==controlled[key])throw C.error(409,'客户联系信息请在客户档案中维护');if(Object.hasOwn(controlled,key)&&v.trim()!==controlled[key])throw C.error(409,'此信息由装车计划单统一维护，不能单独修改：'+key);fields[key]=v.trim();}
  const reason=C.text(b.reason,'修改原因',1000);if(reason.length<5)throw C.error(400,'修改原因至少5个字');
  const row=(await c.query('INSERT INTO export_transport(loading_id,fields,updated_by) VALUES($1,$2,$3) ON CONFLICT(loading_id) DO UPDATE SET fields=excluded.fields,version=export_transport.version+1,updated_by=excluded.updated_by,updated_at=clock_timestamp() RETURNING loading_id,fields,version,updated_at',[l.id,fields,req.user.id])).rows[0];await C.audit(c,req,'export_transport_updated','loading_orders',l.id,old?{fields:old.fields,version:old.version}:null,{...row,reason});return row;
 }));
 app.post('/api/v1/shipping/:id/packing-list',{preHandler:[permitted('load:write'),permitted('load:read'),permitted('inventory:export'),csrf]},req=>C.mutate(pool,req,async c=>{
  const l=await load(c,req,req.params.id);await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['packing-list:'+l.id]);const b=req.body||{},d=await detail(c,req,l.id);
  if(b.expected_revision!==(d.document?.revision||0)||b.transport_version!==d.transport.version)throw C.error(409,'单证或运输资料版本已变化，请刷新后重新生成');
  if(d.loading_plan){const labels=requiredTransport,missing=Object.keys(labels).filter(k=>!d.transport.fields[k]?.trim());if(missing.length)throw C.error(409,'装车计划单缺少必需信息：'+missing.map(k=>labels[k]).join('、')+(d.posted?'；请使用授权更正流程核实补充':'；请编辑装车计划单补齐，并重新进行物流审核'));}
  if(b.source_signature!==undefined&&b.source_signature!==d.source_signature)throw C.error(409,'计划或装车资料已变化，请刷新核对后重新生成');
  if(!d.document_date)throw C.error(409,'装车日期缺失，请核查计划和离场记录');
  if(!d.bundle_count||d.missing_weights.length)throw C.error(409,'装车明细或原始重量缺失，不能生成Packing List：'+d.missing_weights.slice(0,5).join(' / '));
  for(const i of d.items)if(T.scaled(i.gross_weight,6)<=2500n||T.scaled(i.net_weight,6)<=0n||T.scaled(i.gross_weight,6)-T.scaled(i.net_weight,6)!==2500n)throw C.error(409,'原装车净重与每捆扣2.5kg规则不一致，请先核查原记录：'+i.bundle_no);
  const reason=C.text(b.reason,'生成原因',1000);if(reason.length<5)throw C.error(400,'生成原因至少5个字');
  const revision=(d.document?.revision||0)+1,document_no=d.loading_plan?d.loading_plan.packing_list_no:d.document?.document_no||d.outbound_no+'-PL',snapshot={...d,transport:{...d.transport.fields},document_no};delete snapshot.document;delete snapshot.revisions;delete snapshot.document_stale;
  const activeTemplate=await require('./packing-templates.cjs').source(c,true);snapshot.template_revision=activeTemplate.revision||0;const rendered=await PL.render(snapshot,activeTemplate.content),file_name=('PackingList_'+d.outbound_no+'_r'+revision+'.xlsx').replace(/[^A-Za-z0-9_.-]/g,'_');
  await c.query('INSERT INTO packing_list_documents(loading_id,document_no,revision,transport_version,generated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(loading_id) DO UPDATE SET document_no=excluded.document_no,revision=excluded.revision,transport_version=excluded.transport_version,generated_by=excluded.generated_by,generated_at=clock_timestamp()',[l.id,document_no,revision,d.transport.version,req.user.id]);
  await c.query('INSERT INTO packing_list_revisions(loading_id,revision,snapshot,template_sha256,file_sha256,file_name,content,generated_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[l.id,revision,snapshot,rendered.template_sha256,rendered.file_sha256,file_name,rendered.buffer,req.user.id,reason]);
  const result={loading_id:l.id,document_no,revision,file_name,file_sha256:rendered.file_sha256,transport_version:d.transport.version,generation_basis:d.generation_basis,source_signature:d.source_signature};await C.audit(c,req,'packing_list_generated','loading_orders',l.id,d.document,result);return result;
 }));
 app.get('/api/v1/shipping/:id/packing-list.xlsx',{preHandler:[permitted('load:read'),permitted('inventory:export')]},(req,reply)=>download({pool,req,reply}));
}
module.exports={requiredTransport,register,download,load,detail,progress,list,posted,packingEligible};
