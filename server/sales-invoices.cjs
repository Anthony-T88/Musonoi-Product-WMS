'use strict';
const B=require('./business-common.cjs'),C=require('./cobalt.cjs'),shipping=require('./export-shipping.cjs');
const copper='CU_CATHODE',cobalt='CO_HYDROXIDE';
const roles=['sales_operator','sales_manager','admin'];
const canConfirm=req=>roles.includes(req.user.role_code)&&req.user.permissions.includes('plan:write');
const allowed=(path,method)=>method==='GET'&&path==='/api/v1/cobalt/export-licenses'||method==='POST'&&/^\/api\/v1\/cobalt\/sales-workflow\/plans\/[0-9a-f-]{36}\/confirm-invoice$/i.test(path);

async function totals(c,product,plans){
 if(!plans.length)return new Map();
 const {rows}=await c.query('SELECT plan_id,net_mt::text,unknown_packages FROM sales_invoiced_totals($1,$2)',[product,plans]);
 return new Map(rows.map(row=>[row.plan_id,row]));
}

async function shipments(c,req,planId,loadingId=null,batchId=null){
 const co=req.productCode===cobalt;
 const scope=co?`EXISTS(SELECT 1 FROM user_scopes u WHERE u.user_id=$1 AND u.project_id=p.project_id
   AND(u.warehouse_id IS NULL OR u.warehouse_id=p.warehouse_id) AND(u.customer_id IS NULL OR u.customer_id=p.customer_id))`:shipping.scope;
 const joins=co?'JOIN co_sales_plans p ON p.id=s.plan_id':'JOIN loading_orders l ON l.id=s.loading_id';
 const {rows}=await c.query(`SELECT s.*,s.net_mt::text,actor.display_name confirmed_by_name
  FROM sales_invoice_shipments s ${joins} LEFT JOIN users actor ON actor.id=s.confirmed_by
  WHERE s.product_code=$2 AND s.plan_id=$3 AND ($4::uuid IS NULL OR s.loading_id=$4)
  AND ($5::uuid IS NULL OR s.batch_id=$5) AND ${scope} ORDER BY s.posted_at DESC NULLS LAST,s.loading_id,s.batch_id`,
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
 const [row]=await shipments(c,req,planId,loadingId,batchId);
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

async function licenses(c,req){
 const co=req.productCode===cobalt,page=Number(req.query.page||1);
 if(!Number.isInteger(page)||page<1||page>100000)throw B.error(400,'页码无效');
 const search=typeof req.query.search==='string'?req.query.search.trim():'';
 if(search.length>160)throw B.error(400,'搜索条件过长');
 const source=co?`co_loading_plans d JOIN co_sales_plans p ON p.id=d.sales_plan_id JOIN co_customer_profiles customer ON customer.id=p.customer_id`:
  `loading_plan_documents d JOIN loading_plan_groups g ON g.id=d.group_id JOIN sales_plans p ON p.id=g.sales_plan_id JOIN copper_customers customer ON customer.id=p.customer_id`;
 const active=co?'true':'d.cancelled_at IS NULL AND g.cancelled_at IS NULL';
 const warehouse=co?'(s.warehouse_id IS NULL OR s.warehouse_id=p.warehouse_id)':'s.warehouse_id IS NULL';
 const match=`FROM ${source} WHERE ${active} AND nullif(trim(d.export_license_no),'') IS NOT NULL
  AND EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=p.project_id AND ${warehouse}
   AND(s.customer_id IS NULL OR s.customer_id=p.customer_id))
  AND strpos(lower(concat_ws(' ',d.export_license_no,d.code,customer.name)),lower($2))>0`;
 const args=[req.user.id,search];
 const {rows}=await c.query(`SELECT d.id,d.code,d.export_license_no,d.planned_load_date::text,customer.name customer_name
  ${match} ORDER BY d.planned_load_date DESC,d.id LIMIT 50 OFFSET $3`,[...args,(page-1)*50]);
 const {rows:[count]}=await c.query('SELECT count(*)::int total '+match,args);
 return {items:rows,total:count.total,page,page_size:50};
}

function register({app,pool,permitted,csrf}){
 for(const prefix of ['/api/v1','/api/v1/cobalt']){
  app.get(prefix+'/export-licenses',{preHandler:permitted('loading-plan:read')},req=>C.readTransaction(pool,c=>licenses(c,req)));
  app.post(prefix+'/sales-workflow/plans/:id/confirm-invoice',{preHandler:[permitted('plan:read'),permitted('plan:write'),csrf]},req=>{
   if(!canConfirm(req))throw B.error(403,'SALES_INVOICE_ROLE_REQUIRED');
   return B.mutate(pool,req,c=>confirm(c,req));
  });
 }
}

module.exports={allowed,canConfirm,register,shipments,totals};
