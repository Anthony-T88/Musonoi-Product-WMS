'use strict';
const B=require('./business-common.cjs');
const kinds=['MONTHLY','SEMIANNUAL','ANNUAL','SPECIAL'];

function validate(type,period){
 if(type&&!kinds.includes(type)||period&&(typeof period!=='string'||!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(period)||type==='SPECIAL'||
  type==='ANNUAL'&&!period.endsWith('-01')||type==='SEMIANNUAL'&&!/-0[17]$/.test(period)))throw B.error(400,'盘点类型或时期无效');
}

async function list(c,req,{cobalt=false}={}){
 const {phase='',status='',search='',document_no:code='',task_type:type='',period='',created_date:createdDate=''}=req.query||{};
 const page=Number(req.query?.page||1),size=cobalt?50:20;
 validate(type,period);
 if(!Number.isInteger(page)||page<1||page>100000||[search,code].some(value=>typeof value!=='string'||value.length>160)||
  cobalt&&!['','OPEN','SUBMITTED','APPROVED','REJECTED','CANCELLED'].includes(status))throw B.error(400,'盘点筛选或分页参数无效');
 const table=cobalt?'co_stocktakes':'stocktakes',state=cobalt?'status':'phase';
 const scoped=`FROM ${table} d WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=d.project_id
  AND s.customer_id IS NULL AND(s.warehouse_id IS NULL OR s.warehouse_id=d.warehouse_id))`;
 const base=`${scoped} AND ($2='' OR d.${state}=$2) AND ($3='' OR strpos(lower(${cobalt&&!code?"d.code||' '||d.title":'d.code'}),lower($3))>0)
  AND ($4='' OR d.task_type=$4) AND ($5='' OR d.period_month=$5)
  AND ($6::date IS NULL OR (d.created_at AT TIME ZONE 'Africa/Lubumbashi')::date=$6)`;
 const baseline=cobalt?'(SELECT r.cutoff_at FROM co_stocktake_rounds r WHERE r.task_id=d.id AND r.round=d.round)':
  "CASE WHEN d.phase<>'DRAFT' OR d.snapshot_on_create THEN d.snapshot_at END";
 const values=[req.user.id,cobalt?status:phase,code||search,type,period,createdDate?B.date(createdDate):null];
 const fields=cobalt?'d.id,d.code,d.title,d.status,d.created_at,d.round,d.task_type,d.period_month,(SELECT name FROM warehouses WHERE id=d.warehouse_id) warehouse_name':
  'd.*,(SELECT display_name FROM users WHERE id=d.assigned_to) assigned_name';
 const {rows:items}=await c.query(`SELECT ${fields},${baseline} baseline_at ${base}
  ORDER BY d.created_at DESC,d.id LIMIT $7 OFFSET $8`,[...values,size,(page-1)*size]);
 const {rows:[count]}=await c.query('SELECT count(*)::int total '+base,values);
 const {rows:periods}=await c.query('SELECT DISTINCT d.task_type,d.period_month '+scoped+' AND d.period_month IS NOT NULL ORDER BY d.period_month DESC,d.task_type',[req.user.id]);
 return {items,periods,total:count.total,page,page_size:size};
}

module.exports={validate,list};
