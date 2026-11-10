'use strict';
const fields=['search','location','batch','customer','status','sample','start','end','allocated_customer','contract_no','weight_basis','business_status','lifecycle','lot_no','packing_list_no'];
const samplingSql="CASE WHEN v.sample_required IS TRUE THEN CASE WHEN v.lot_sample_stage IN('RETURNED','WEIGHED') THEN '完成取样' ELSE '取样/待取样' END WHEN v.sample_required IS FALSE THEN '无需取样' WHEN v.sample='已取样' THEN '完成取样' WHEN v.sample='取样中' THEN '取样/待取样' ELSE '未取样' END";
const physicalStatusSql='(SELECT physical_status FROM bundles b WHERE b.id=v.uuid)';
const preparingLabel='备货作业中';
const isPreparing=row=>row.inventory_state_code==='PREPARATION_LOCKED'&&row.lot_workflow_state==='WORKING';
const businessStatus=row=>isPreparing(row)?preparingLabel:row.business_status||row.status;
const preparingSql="(v.inventory_state_code='PREPARATION_LOCKED' AND v.lot_workflow_state IS NOT DISTINCT FROM 'WORKING')";
// Loading takes precedence, then active sampling, then preparation.
const stockCategorySql=`CASE
 WHEN v.inventory_state_code='LOADED_PENDING' THEN 'loaded'
 WHEN v.inventory_state_code='LOADING_ASSIGNED' THEN 'assigned'
 WHEN v.lot_sample_stage='IN_PROGRESS' OR v.sample='取样中' THEN 'sampling'
 WHEN v.inventory_state_code='PREPARATION_LOCKED' AND v.lot_workflow_state IN ('WORKING','RECTIFY','PENDING') THEN 'preparing'
 WHEN v.inventory_state_code='AVAILABLE' THEN 'available'
 WHEN v.inventory_state_code='PREPARATION_LOCKED' AND v.effective_reservation_id IS NOT NULL THEN 'prepared'
 ELSE 'other'
 END`;
const sorts={production_date:'v.production_date',business_status:"CASE WHEN "+preparingSql+" THEN '"+preparingLabel+"' ELSE v.business_status END",id:'v.id',batch:'v.batch',location:'v.location',customer:"coalesce(v.current_customer,v.customer)",weight:'v.weight',gross_weight:'v.gross_weight',packaging_weight:'v.packaging_weight',contract_no:'v.contract_no',status:'v.status',sample:samplingSql,date:'v.date',allocated_customer:"coalesce(v.current_customer,v.customer)",receipt_code:'v.receipt_code',confirmed_at:'v.confirmed_at'};
function invalid(message){const e=Error(message);e.statusCode=400;throw e;}
function filters(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))invalid('筛选结构无效');
 const f={};for(const k of fields){if(input[k]!==undefined){if(typeof input[k]!=='string'||input[k].length>(k==='search'?512:160))invalid('筛选字段无效');f[k]=input[k].trim();}}
 for(const k of ['start','end'])if(f[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(f[k])||Number.isNaN(Date.parse(f[k]))||new Date(f[k]).toISOString().slice(0,10)!==f[k]))invalid('日期格式无效');
 if(f.start&&f.end&&f.start>f.end)invalid('开始日期不能晚于结束日期');
 if(f.status&&!['在库','已预留','已出库','已调整移出','CURRENT','OUTBOUND','ALL'].includes(f.status))invalid('库存状态无效');
 if(f.lifecycle&&!['CURRENT','OUTBOUND','ALL'].includes(f.lifecycle))invalid('库存视图无效');
 if(f.sample&&!['未取样','取样中','已取样','无需取样','取样/待取样','完成取样'].includes(f.sample))invalid('取样状态无效');
 return f;
}
function order(input={}){const key=input.sort||'date',dir=input.direction||'desc';if(!Object.hasOwn(sorts,key)||!['asc','desc'].includes(dir))invalid('排序参数无效');return `${sorts[key]} ${dir}, v.id ${dir}`;}
function where(userId,input={},selectedIds){const f=filters(input),values=[userId],parts=[`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=v.project_id AND (s.customer_id IS NULL OR s.customer_id=v.customer_id OR s.customer_id=v.allocated_customer_id OR s.customer_id=v.dispatched_customer_id) AND (s.warehouse_id IS NULL OR s.warehouse_id=v.warehouse_id))`];
 const bind=v=>{values.push(v);return '$'+values.length;};
 const lifecycle=['CURRENT','OUTBOUND','ALL'].includes(f.status)?f.status:f.lifecycle;
 // A scalar lookup by the bundle primary key avoids flattening this filter into a repeated table scan.
 if(lifecycle==='CURRENT')parts.push(physicalStatusSql+"='IN_STOCK'");
 if(lifecycle==='OUTBOUND')parts.push(physicalStatusSql+"='OUTBOUND'");
 if(f.lot_no){const p=bind(f.lot_no);parts.push(`(strpos(lower(coalesce(v.lot_no,'')),lower(${p}))>0${lifecycle==='ALL'?` OR EXISTS(SELECT 1 FROM reservations hr JOIN allocations ha ON ha.id=hr.allocation_id WHERE hr.bundle_id=v.uuid AND strpos(lower(coalesce(ha.lot_no,'')),lower(${p}))>0)`:''})`);}
 if(f.packing_list_no){const n=bind(f.packing_list_no);parts.push(`EXISTS(SELECT 1 FROM loading_items pi LEFT JOIN loading_plan_matches pm ON pm.loading_id=pi.loading_id LEFT JOIN loading_plan_documents pd ON pd.id=pm.document_id LEFT JOIN packing_list_documents pl ON pl.loading_id=pi.loading_id WHERE pi.bundle_id=v.uuid AND NOT pi.plan_removed AND(upper(pd.packing_list_no)=upper(${n}) OR upper(pl.document_no)=upper(${n}) OR EXISTS(SELECT 1 FROM packing_list_revisions pr WHERE pr.loading_id=pi.loading_id AND upper(pr.snapshot->>'document_no')=upper(${n}))))`);}
 if(f.search){const p=bind(f.search);parts.push(`(strpos(lower(v.id),lower(${p}))>0 OR strpos(lower(v.batch),lower(${p}))>0 OR strpos(lower(v.customer),lower(${p}))>0 OR strpos(lower(v.location),lower(${p}))>0 OR strpos(lower(coalesce(v.seal_no,'')),lower(${p}))>0 OR v.sheets_per_bundle::text=${p})`);}
 for(const k of ['location','batch','customer','status','allocated_customer','contract_no','weight_basis','business_status'])if(k==='contract_no'&&f[k]&&lifecycle==='ALL'){const p=bind(f[k]);parts.push(`(v.contract_no=${p} OR EXISTS(SELECT 1 FROM reservations hr JOIN allocations ha ON ha.id=hr.allocation_id JOIN sales_plans hp ON hp.id=ha.plan_id JOIN customer_contracts hc ON hc.id=hp.contract_id WHERE hr.bundle_id=v.uuid AND upper(hc.contract_no)=upper(${p})))`);}else if(k==='business_status'&&f[k]){if(f[k]===preparingLabel)parts.push(preparingSql);else{const value=bind(f[k]);parts.push(`(v.business_status=${value} OR v.workflow_detail=${value})`);if(f[k]==='备货锁定')parts.push('NOT '+preparingSql);}}else if(f[k]&&!(k==='status'&&['CURRENT','OUTBOUND','ALL'].includes(f[k])))parts.push(`${k==='customer'?"coalesce(v.current_customer,v.customer)":'v.'+k}=${bind(f[k])}`);
 if(f.start)parts.push(`v.date>=${bind(f.start)}`);if(f.end)parts.push(`v.date<=${bind(f.end)}`);
 if(selectedIds!==undefined){if(!Array.isArray(selectedIds)||selectedIds.length>10000||selectedIds.some(id=>typeof id!=='string'||id.length>512))invalid('选中捆包参数无效');parts.push(`v.id=ANY(${bind(selectedIds)}::text[])`);}
 if(f.sample){const state={'已取样':'完成取样','取样中':'取样/待取样'}[f.sample]||f.sample;parts.push('('+samplingSql+')='+bind(state));}
 return {text:parts.join(' AND '),values};
}
async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
function inventoryInput(input={}){if(!input||typeof input!=='object'||Array.isArray(input))invalid('筛选结构无效');return {...input,lifecycle:input.lifecycle||(Object.hasOwn(input,'status')?'ALL':'CURRENT')};}
async function listing(c,uid,input){const w=where(uid,inventoryInput(input)),metricsWhere=where(uid,{...input,status:'CURRENT',lifecycle:'CURRENT'}),sort=order(input),page=Number(input.page||1),size=Number(input.page_size||10);if(!Number.isInteger(page)||page<1||page>1000000||![10,20,50].includes(size))invalid('分页参数无效');
 const count=(await c.query(`SELECT count(*)::int n FROM inventory_view v WHERE ${w.text}`,w.values)).rows[0].n;
 const summary=(await c.query(`SELECT count(*)::int AS stock_count,sum(sheets_per_bundle) FILTER(WHERE status IN('在库','已预留'))::text AS total_sheets,count(*) FILTER(WHERE status IN('在库','已预留') AND sheets_per_bundle IS NULL)::int AS missing_sheets_count,coalesce(sum(weight) FILTER(WHERE status IN('在库','已预留')),0)::text AS weight,coalesce(sum(weight) FILTER(WHERE status IN('在库','已预留') AND coalesce(v.on_site,true)),0)::text AS physical_weight,coalesce(sum(weight) FILTER(WHERE status='已预留'),0)::text AS locked_weight,coalesce(sum(weight) FILTER(WHERE status='在库'),0)::text AS available_weight,count(*) FILTER(WHERE status='在库')::int AS available,count(*) FILTER(WHERE status='已预留')::int AS reserved,count(*) FILTER(WHERE status='已出库')::int AS outbound,count(*) FILTER(WHERE status IN('在库','已预留') AND (${samplingSql}) IN('未取样','取样/待取样'))::int AS pending,count(*) FILTER(WHERE status IN('在库','已预留') AND weight IS NULL)::int AS unweighed_count FROM inventory_view v WHERE ${metricsWhere.text}`,metricsWhere.values)).rows[0];summary.count=count;
 const stock=(await c.query(`SELECT ${stockCategorySql} AS state,count(*)::int AS bundles,
  sum(v.weight) FILTER(WHERE v.final_weighed IS DISTINCT FROM false)::text AS known_net_weight,
  count(*) FILTER(WHERE v.weight IS NULL OR v.final_weighed IS FALSE)::int AS unknown_weights
  FROM inventory_view v WHERE ${metricsWhere.text} GROUP BY 1`,metricsWhere.values)).rows;
 summary.stock_categories=Object.fromEntries(stock.map(({state,...values})=>[state,values]));
 const effectivePage=Math.min(page,Math.max(1,Math.ceil(summary.count/size)));
 const items=(await c.query(`SELECT v.*,${physicalStatusSql} physical_status FROM inventory_view v WHERE ${w.text} ORDER BY ${sort} LIMIT $${w.values.length+1} OFFSET $${w.values.length+2}`,[...w.values,size,(effectivePage-1)*size])).rows;
 return {items:items.map(row=>({...row,business_status:businessStatus(row)})),total:summary.count,page:effectivePage,page_size:size,summary,snapshot_at:(await c.query('SELECT transaction_timestamp() AS at')).rows[0].at};
}
module.exports={businessStatus,isPreparing,samplingSql,inventoryInput,where,order,filters,listing,transaction,invalid};
