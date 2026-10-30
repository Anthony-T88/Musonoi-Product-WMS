'use strict';
const fields=['search','location','batch','customer','status','sample','start','end','allocated_customer','contract_no','weight_basis','business_status'];
const sorts={id:'v.id',batch:'v.batch',location:'v.location',customer:"coalesce(to_jsonb(v)->>'current_customer',v.customer)",weight:'v.weight',gross_weight:'v.gross_weight',packaging_weight:'v.packaging_weight',contract_no:'v.contract_no',status:'v.status',sample:'v.sample',date:'v.date',allocated_customer:"coalesce(to_jsonb(v)->>'current_customer',v.customer)",receipt_code:'v.receipt_code',confirmed_at:'v.confirmed_at'};
function invalid(message){const e=Error(message);e.statusCode=400;throw e;}
function filters(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))invalid('筛选结构无效');
 const f={};for(const k of fields){if(input[k]!==undefined){if(typeof input[k]!=='string'||input[k].length>(k==='search'?512:160))invalid('筛选字段无效');f[k]=input[k].trim();}}
 for(const k of ['start','end'])if(f[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(f[k])||Number.isNaN(Date.parse(f[k]))||new Date(f[k]).toISOString().slice(0,10)!==f[k]))invalid('日期格式无效');
 if(f.start&&f.end&&f.start>f.end)invalid('开始日期不能晚于结束日期');
 if(f.status&&!['在库','已预留','已出库','已调整移出'].includes(f.status))invalid('库存状态无效');
 if(f.sample&&!['未取样','取样中','已取样'].includes(f.sample))invalid('取样状态无效');
 return f;
}
function order(input={}){const key=input.sort||'date',dir=input.direction||'desc';if(!Object.hasOwn(sorts,key)||!['asc','desc'].includes(dir))invalid('排序参数无效');return `${sorts[key]} ${dir}, v.id ${dir}`;}
function where(userId,input={},selectedIds){const f=filters(input),values=[userId],parts=[`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=v.project_id AND (s.customer_id IS NULL OR s.customer_id=v.customer_id OR s.customer_id=v.allocated_customer_id OR s.customer_id=v.dispatched_customer_id) AND (s.warehouse_id IS NULL OR s.warehouse_id=v.warehouse_id))`];
 const bind=v=>{values.push(v);return '$'+values.length;};
 if(f.search){const p=bind(f.search);parts.push(`(strpos(lower(v.id),lower(${p}))>0 OR strpos(lower(v.batch),lower(${p}))>0 OR strpos(lower(v.customer),lower(${p}))>0 OR strpos(lower(v.location),lower(${p}))>0 OR strpos(lower(coalesce(v.seal_no,'')),lower(${p}))>0 OR v.sheets_per_bundle::text=${p})`);}
 for(const k of ['location','batch','customer','status','sample','allocated_customer','contract_no','weight_basis','business_status'])if(f[k])parts.push(`${k==='customer'?"coalesce(to_jsonb(v)->>'current_customer',v.customer)":'v.'+k}=${bind(f[k])}`);
 if(f.start)parts.push(`v.date>=${bind(f.start)}`);if(f.end)parts.push(`v.date<=${bind(f.end)}`);
 if(selectedIds!==undefined){if(!Array.isArray(selectedIds)||selectedIds.length>10000||selectedIds.some(id=>typeof id!=='string'||id.length>512))invalid('选中捆包参数无效');parts.push(`v.id=ANY(${bind(selectedIds)}::text[])`);}
 return {text:parts.join(' AND '),values};
}
async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function listing(c,uid,input){const w=where(uid,input),sort=order(input),page=Number(input.page||1),size=Number(input.page_size||10);if(!Number.isInteger(page)||page<1||page>1000000||![10,20,50].includes(size))invalid('分页参数无效');
 const summary=(await c.query(`SELECT count(*)::int AS count,sum(sheets_per_bundle) FILTER(WHERE status IN('在库','已预留'))::text AS total_sheets,count(*) FILTER(WHERE status IN('在库','已预留') AND sheets_per_bundle IS NULL)::int AS missing_sheets_count,coalesce(sum(weight) FILTER(WHERE status IN('在库','已预留')),0)::text AS weight,coalesce(sum(weight) FILTER(WHERE status IN('在库','已预留') AND coalesce((to_jsonb(v)->>'on_site')::boolean,true)),0)::text AS physical_weight,coalesce(sum(weight) FILTER(WHERE status='已预留'),0)::text AS locked_weight,coalesce(sum(weight) FILTER(WHERE status='在库'),0)::text AS available_weight,count(*) FILTER(WHERE status='在库')::int AS available,count(*) FILTER(WHERE status='已预留')::int AS reserved,count(*) FILTER(WHERE status='已出库')::int AS outbound,count(*) FILTER(WHERE status IN('在库','已预留') AND sample<>'已取样')::int AS pending,count(*) FILTER(WHERE status IN('在库','已预留') AND weight IS NULL)::int AS unweighed_count FROM inventory_view v WHERE ${w.text}`,w.values)).rows[0];
 const effectivePage=Math.min(page,Math.max(1,Math.ceil(summary.count/size)));
 const items=(await c.query(`SELECT v.* FROM inventory_view v WHERE ${w.text} ORDER BY ${sort} LIMIT $${w.values.length+1} OFFSET $${w.values.length+2}`,[...w.values,size,(effectivePage-1)*size])).rows;
 return {items,total:summary.count,page:effectivePage,page_size:size,summary,snapshot_at:(await c.query('SELECT transaction_timestamp() AS at')).rows[0].at};
}
module.exports={where,order,filters,listing,transaction,invalid};
