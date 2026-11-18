'use strict';
const B=require('./business-common.cjs');

const scope=(alias='b')=>`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1
 AND s.project_id=${alias}.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=${alias}.warehouse_id)
 AND(s.customer_id IS NULL OR s.customer_id=${alias}.customer_id))`;

const eligible=`FROM historical_backfills b
 JOIN historical_movement_documents m ON m.id=b.source_id
 LEFT JOIN customers customer ON customer.id=b.customer_id
 LEFT JOIN historical_gate_exits x ON x.source_id=b.source_id
 WHERE m.product_code=$2 AND m.voided_at IS NULL AND m.movement_type='OUTBOUND'
 AND nullif(trim(m.source_facts->>'truck'),'') IS NOT NULL AND ${scope()}`;
const listSql=`SELECT m.source_facts->>'batch_no' batch_number,m.id order_id,m.document_no code,
 m.source_facts->>'truck' truck_no,coalesce(customer.name,m.source_facts->>'customer') customer_name,
 NULL::timestamptz approved_at,NULL::uuid permit_id,m.source_facts->>'gate_permit_no' document_no,
 CASE WHEN x.source_id IS NULL THEN 'HISTORY_PENDING' ELSE 'EXITED' END state,
 NULL::integer version,NULL::integer current_revision,false current_print_requested,
 NULL::timestamptz actual_exit_at,m.id historical_source_id,
 (SELECT h.id FROM historical_business_documents h WHERE h.source_id=m.id AND h.kind='OUTBOUND') historical_detail_id,
 m.business_date::text shipping_date,x.confirmed_at historical_exit_confirmed_at ${eligible}`;

async function confirm(c,req){
 const body=req.body||{},ids=body.ids;
 if(!['sales_manager','sales_operator','admin'].includes(req.user.role_code))throw B.error(403,'GATE_SALES_REQUIRED');
 if(body.actual_exit!==true||!Array.isArray(ids)||!ids.length||ids.length>30)
  throw B.error(400,'请选择 1 至 30 张历史单据，并核实所选车辆均已实际出厂');
 const sourceIds=[...new Set(ids.map(value=>B.uuid(value).toLowerCase()))].sort();
 if(sourceIds.length!==ids.length)throw B.error(400,'历史单据选择重复');
 const evidence=B.text(body.evidence,'出厂核对依据',500);
 if(evidence.length<5)throw B.error(400,'出厂核对依据至少需要五个字符');
 await c.query('SELECT pg_advisory_xact_lock(477189)');
 const {rows}=await c.query('SELECT m.id '+eligible+' AND m.id=ANY($3::uuid[]) ORDER BY m.id FOR UPDATE OF m',[req.user.id,req.productCode,sourceIds]);
 if(rows.length!==ids.length)throw B.error(409,'部分历史单据已作废、无车牌或超出授权范围，请刷新后重新选择');
 const {rows:saved}=await c.query(`INSERT INTO historical_gate_exits(source_id,confirmed_by,evidence)
  SELECT id,$2,$3 FROM unnest($1::uuid[]) AS selected(id)
  ON CONFLICT(source_id) DO NOTHING RETURNING *`,[sourceIds,req.user.id,evidence]);
 for(const row of saved)await B.audit(c,req,'historical_vehicle_exit_confirmed','historical_movement_documents',row.source_id,null,row);
 return {count:saved.length,already_confirmed:ids.length-saved.length};
}
module.exports={listSql,confirm};
