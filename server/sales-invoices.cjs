'use strict';
const B=require('./business-common.cjs'),C=require('./cobalt.cjs'),shipping=require('./export-shipping.cjs');
const copper='CU_CATHODE',cobalt='CO_HYDROXIDE';
const canConfirm=req=>req.user.permissions.includes('plan:write');
const allowed=(path,method)=>
 ['GET','POST'].includes(method)&&/^\/api\/v1\/cobalt\/sales-workflow\/plans\/[0-9a-f-]{36}\/historical-matches$/i.test(path)||
 method==='POST'&&/^\/api\/v1\/cobalt\/sales-workflow\/plans\/[0-9a-f-]{36}\/confirm-invoice$/i.test(path);
const archiveScope=`EXISTS (SELECT 1 FROM historical_backfills h JOIN user_scopes u ON u.project_id=h.project_id
 AND (u.warehouse_id IS NULL OR u.warehouse_id=h.warehouse_id)
 AND (u.customer_id IS NULL OR u.customer_id=h.customer_id OR h.customer_id IS NULL AND u.customer_id=p.customer_id)
 WHERE u.user_id=$1 AND h.source_id=s.historical_source_id)`;

async function totals(c,product,plans){
 if(!plans.length)return new Map();
 const {rows}=await c.query('SELECT plan_id,net_mt::text,unknown_packages FROM sales_invoiced_totals($1,$2)',[product,plans]);
 return new Map(rows.map(row=>[row.plan_id,row]));
}

async function execution(c,req,selection,params){
 const co=req.productCode===cobalt,joins=co?'':'LEFT JOIN loading_orders l ON l.id=s.loading_id',live=co?'true':shipping.scope;
 const visible=`(s.historical_source_id IS NULL AND (${live}) OR s.historical_source_id IS NOT NULL AND ${archiveScope})`;
 const {rows}=await c.query(`
  WITH plans AS MATERIALIZED (${selection}), movements AS (
   SELECT s.plan_id,sum(s.net_mt) posted,sum(s.net_mt) FILTER(WHERE s.confirmed_at IS NOT NULL) invoiced,
    sum(s.unknown_packages) unknown_posted,sum(s.unknown_packages) FILTER(WHERE s.confirmed_at IS NOT NULL) unknown_invoiced
   FROM sales_invoice_shipments s JOIN plans p ON p.id=s.plan_id ${joins}
   WHERE s.product_code=$${params.length+1} AND ${visible} GROUP BY s.plan_id
  ), sums AS (
   SELECT p.id,coalesce(sum(p.target_weight),0) planned,coalesce(sum(m.posted),0) posted,coalesce(sum(m.invoiced),0) invoiced,
    coalesce(sum(m.unknown_posted),0) unknown_posted,coalesce(sum(m.unknown_invoiced),0) unknown_invoiced
   FROM plans p LEFT JOIN movements m ON m.plan_id=p.id GROUP BY GROUPING SETS((),(p.id))
  )
  SELECT id,planned::text,CASE WHEN unknown_posted=0 THEN posted::text END posted,
   CASE WHEN unknown_posted=0 THEN greatest(planned-posted,0)::text END remaining,
   CASE WHEN unknown_invoiced=0 THEN invoiced::text END invoiced,
   CASE WHEN unknown_invoiced=0 AND planned>0 THEN round(invoiced/planned*100,2)::text END fulfillment,
   CASE WHEN unknown_invoiced=0 AND planned>0 THEN invoiced/planned END fulfillment_sort
  FROM sums`,[...params,req.productCode]);
 return {summary:rows.find(row=>row.id===null),byId:new Map(rows.filter(row=>row.id).map(row=>[row.id,row]))};
}

async function related(c,req,plan){
 const has=permission=>req.user.permissions.includes(permission),co=req.productCode===cobalt;
 const source=co?`SELECT d.id,d.code,d.invoice_no,p.preparation_batch_no batch_no,d.current_load_id loading_id,
   CASE WHEN e.state='OUTBOUND' THEN 'OUTBOUND' WHEN EXISTS(SELECT 1 FROM export_license_allocations a WHERE a.co_plan_id=d.id AND a.state='RELEASED') THEN 'CANCELLED' ELSE d.status END status
   FROM co_loading_plans d JOIN co_preparations p ON p.id=d.preparation_id LEFT JOIN co_load_executions e ON e.order_id=d.current_load_id
   WHERE d.sales_plan_id=$2`:`SELECT d.id,d.code,coalesce(d.invoice_no,g.invoice_no) invoice_no,d.shipment_batch_no batch_no,m.loading_id,
   CASE WHEN ${require('./copper-returns.cjs').applied('m.loading_id')} THEN 'REVERSED'
    WHEN d.cancelled_at IS NOT NULL OR g.cancelled_at IS NOT NULL THEN 'CANCELLED' WHEN m.loading_id IS NULL THEN 'WAITING'
    WHEN v31_load_posted(m.loading_id) THEN 'OUTBOUND' WHEN l.workflow_state IN('READY','DEPARTED_PENDING','DEPARTED_CORRECTION') THEN 'LOADING' ELSE 'MATCHED' END status
   FROM loading_plan_documents d JOIN loading_plan_groups g ON g.id=d.group_id
   LEFT JOIN loading_plan_matches m ON m.document_id=d.id LEFT JOIN loading_orders l ON l.id=m.loading_id
   WHERE g.sales_plan_id=$2 AND (m.loading_id IS NULL OR ${shipping.scope})`;
 const scoped=co?'SELECT * FROM ('+source+') d WHERE $1::uuid IS NOT NULL':source;
 const args=[req.user.id,plan.id];
 const loading=has('loading-plan:read')?(await c.query(scoped+' ORDER BY id',args)).rows:[];
 const packing=has('load:read')?(await c.query('WITH plans AS ('+scoped+') SELECT DISTINCT d.document_no,d.'+
  (co?'order_id FROM co_packing_documents d JOIN plans p ON p.loading_id=d.order_id':'loading_id AS order_id FROM packing_list_documents d JOIN plans p ON p.loading_id=d.loading_id')+' ORDER BY d.document_no',args)).rows:[];
 const licenses=has('export-license:read')?(await c.query('WITH plans AS ('+scoped+`) SELECT DISTINCT l.id,l.license_no,l.proforma_no
  FROM plans p JOIN export_license_allocations a ON a.plan_id=p.id AND a.product_code=$3
  JOIN export_licenses l ON l.id=a.license_id AND l.product_code=a.product_code
  WHERE EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=l.project_id AND s.warehouse_id IS NULL
  AND(s.customer_id IS NULL OR s.customer_id=l.customer_id)) ORDER BY l.license_no,l.proforma_no`,[...args,req.productCode])).rows:[];
 const preparations=co?(has('co:read')?(await c.query(
  "SELECT DISTINCT p.id,p.preparation_batch_no batch_no,p.status FROM co_preparations p WHERE (EXISTS(SELECT 1 FROM preparation_plans q WHERE q.co_sales_plan_id=$2 AND q.co_preparation_id=p.id)"+
  " OR EXISTS(SELECT 1 FROM co_loading_plans d WHERE d.sales_plan_id=$2 AND d.preparation_id=p.id))"+
  " AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND s.customer_id IS NULL AND(s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id)) ORDER BY batch_no",args)).rows:[]):
  (has('allocation:read')?(await c.query("SELECT a.id,coalesce(a.lot_no,a.code) batch_no,coalesce(a.workflow_state,a.status) status FROM allocations a JOIN sales_plans p ON p.id=a.plan_id WHERE p.id=$2"+
  " AND NOT EXISTS(SELECT 1 FROM allocation_items i JOIN bundles b ON b.id=i.bundle_id JOIN locations l ON l.id=b.location_id WHERE i.allocation_id=a.id"+
  " AND NOT EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND(s.customer_id IS NULL OR s.customer_id=p.customer_id) AND(s.warehouse_id IS NULL OR s.warehouse_id=l.warehouse_id))) ORDER BY batch_no",args)).rows:[]);
 return {preparations,loading,packing,licenses};
}

async function shipments(c,req,planId,loadingId=null,batchId=null){
 const co=req.productCode===cobalt;
 const scope=co?`EXISTS(SELECT 1 FROM user_scopes u WHERE u.user_id=$1 AND u.project_id=p.project_id
   AND(u.warehouse_id IS NULL OR u.warehouse_id=p.warehouse_id) AND(u.customer_id IS NULL OR u.customer_id=p.customer_id))`:shipping.scope;
 const joins=co?'JOIN co_sales_plans p ON p.id=s.plan_id':'JOIN sales_plans p ON p.id=s.plan_id LEFT JOIN loading_orders l ON l.id=s.loading_id';
 const {rows}=await c.query(`SELECT s.*,s.net_mt::text,actor.display_name confirmed_by_name,
  CASE WHEN history.source_id IS NOT NULL THEN history.source_invoice_no ELSE s.source_invoice_no END source_invoice_no
  FROM sales_invoice_shipments s ${joins} LEFT JOIN users actor ON actor.id=s.confirmed_by
  LEFT JOIN historical_sales_arrivals history ON history.source_id=s.historical_source_id
  WHERE s.product_code=$2 AND s.plan_id=$3 AND ($4::uuid IS NULL OR s.loading_id=$4)
  AND ($5::uuid IS NULL OR s.batch_id=$5)
  AND (s.historical_source_id IS NULL AND (${scope}) OR s.historical_source_id IS NOT NULL AND ${archiveScope})
  ORDER BY s.posted_at DESC NULLS LAST,s.loading_id,s.batch_id`,
 [req.user.id,req.productCode,planId,loadingId,batchId]);
 return rows;
}

async function confirm(c,req){
 const planId=B.uuid(req.params.id),body=req.body||{};
 if(Object.keys(body).some(key=>!['loading_id','batch_id','invoice_no'].includes(key)))throw B.error(400,'SALES_INVOICE_INPUT');
 const loadingId=B.uuid(body.loading_id),batchId=B.uuid(body.batch_id),invoiceNo=B.text(body.invoice_no,'发票号',160);
 const co=req.productCode===cobalt;
 if(co)await require('./cobalt-sales.cjs').access(c,req,'plan',planId);
 else await require('./allocations.cjs').planAccess(c,req,planId);
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['sales-invoice:'+req.productCode+':'+loadingId.toLowerCase()]);
 let [row]=await shipments(c,req,planId,loadingId,batchId);
 if(row?.historical_source_id){
  await c.query('SELECT pg_advisory_xact_lock(477189)');
  [row]=await shipments(c,req,planId,loadingId,batchId);
 }
 if(!row)throw B.error(404,'SALES_INVOICE_POSTED_BATCH_REQUIRED');
 if(row.invoice_no&&row.invoice_no!==invoiceNo||row.source_invoice_no&&row.source_invoice_no!==invoiceNo)throw B.error(409,'SALES_INVOICE_NUMBER_MISMATCH');
 if(row.confirmed_at){
  const {product_code,plan_id,loading_id,batch_id,invoice_no,confirmed_by,confirmed_at}=row;
  return {product_code,plan_id,loading_id,batch_id,invoice_no,confirmed_by,confirmed_at};
 }
 const {rows:[saved]}=await c.query(`INSERT INTO sales_invoice_confirmations(product_code,plan_id,loading_id,batch_id,invoice_no,confirmed_by)
  VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.productCode,planId,loadingId,batchId,invoiceNo,req.user.id]);
 await B.audit(c,req,'sales_invoice_confirmed',co?'co_sales_plans':'sales_plans',planId,null,saved);
 return saved;
}

function register({app,pool,permitted,csrf}){
 const archive=require('./historical-sales.cjs');
 for(const prefix of ['/api/v1','/api/v1/cobalt']){
  const match=prefix+'/sales-workflow/plans/:id/historical-matches';
  app.get(match,{preHandler:[permitted('plan:read'),permitted('plan:write')]},req=>C.readTransaction(pool,c=>archive.candidates(c,req)));
  app.post(match,{preHandler:[permitted('plan:read'),permitted('plan:write'),csrf]},req=>B.mutate(pool,req,c=>req.body?.automatic===true?archive.autoLink(c,req):archive.link(c,req)));
  app.post(prefix+'/sales-workflow/plans/:id/confirm-invoice',{preHandler:[permitted('plan:read'),permitted('plan:write'),csrf]},req=>B.mutate(pool,req,c=>confirm(c,req)));
 }
}

module.exports={allowed,canConfirm,register,shipments,totals,execution,related};
