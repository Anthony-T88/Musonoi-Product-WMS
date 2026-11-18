'use strict';
const scope=(alias='b')=>`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1
 AND s.project_id=${alias}.project_id AND(s.warehouse_id IS NULL OR s.warehouse_id=${alias}.warehouse_id)
 AND(s.customer_id IS NULL OR s.customer_id=${alias}.customer_id))`;

const eligible=`FROM historical_backfills b
 JOIN historical_movement_documents m ON m.id=b.source_id
 LEFT JOIN customers customer ON customer.id=b.customer_id
 LEFT JOIN historical_business_documents h ON h.source_id=b.source_id AND h.kind='OUTBOUND'
 WHERE m.product_code=$2 AND m.voided_at IS NULL AND m.movement_type='OUTBOUND'
 AND nullif(trim(m.source_facts->>'truck'),'') IS NOT NULL AND ${scope()}`;
const listSql=`SELECT m.source_facts->>'batch_no' batch_number,m.id order_id,m.document_no code,
 m.source_facts->>'truck' truck_no,coalesce(customer.name,m.source_facts->>'customer') customer_name,
 NULL::timestamptz approved_at,NULL::uuid permit_id,m.source_facts->>'gate_permit_no' document_no,
 'EXITED'::text state,
 NULL::integer version,NULL::integer current_revision,false current_print_requested,
 NULL::timestamptz actual_exit_at,m.id historical_source_id,
 h.id historical_detail_id,m.business_date::text shipping_date ${eligible}`;

module.exports={listSql};
