'use strict';
const B=require('./business-common.cjs'),C=require('./cobalt.cjs'),S=require('./cobalt-sales.cjs');
const base='/api/v1/cobalt/metal',idPattern='[0-9a-fA-F-]{36}';
const allowed=(path,method)=>method==='GET'&&new RegExp('^'+base+'(?:|/export|/outbounds/'+idPattern+')$').test(path)
 ||method==='POST'&&new RegExp('^'+base+'/outbounds/'+idPattern+'/(?:submit|confirm|reject)$').test(path);
const enabled=async c=>(await c.query("SELECT to_regclass('public.co_metal_outbound') IS NOT NULL ok")).rows[0].ok;
const scope=(p,customer)=>`EXISTS(SELECT 1 FROM user_scopes s WHERE s.user_id=$1 AND s.project_id=${p}.project_id
 AND(s.warehouse_id IS NULL OR s.warehouse_id=${p}.warehouse_id) AND(s.customer_id IS NULL OR s.customer_id=${customer}))`;
const outboundFrom=`FROM co_metal_outbound m JOIN co_outbounds o ON o.id=m.outbound_id
 JOIN co_loading_orders l ON l.id=m.order_id JOIN co_preparations b ON b.id=m.preparation_id
 JOIN co_sales_plans p ON p.id=l.sales_plan_id JOIN co_customer_profiles cu ON cu.id=p.customer_id
 JOIN co_sales_contracts ct ON ct.id=p.contract_id LEFT JOIN users u ON u.id=m.confirmed_by`;
const postedDay="(m.posted_at AT TIME ZONE 'Africa/Lubumbashi')::date";
const shipment=`SELECT m.*,o.code outbound_code,l.code order_no,b.document_no,b.preparation_batch_no,
 p.project_id,p.warehouse_id,p.customer_id,p.contract_id,p.id sales_plan_id,
 coalesce(o.snapshot#>>'{customer,name}',cu.name) customer_name,
 coalesce(o.snapshot#>>'{contract,contract_no}',ct.contract_no) contract_no,
 l.transport_snapshot->>'truck_no' truck_no,l.bag_count bags,${postedDay}::text posted_day,u.display_name confirmed_by_name,
 round(m.net_kg*0.001,4)::text net_mt,round(m.estimated_metal_mt,5)::text estimated_mt,
 round(m.confirmed_metal_mt,5)::text confirmed_mt,
 round(m.confirmed_metal_mt-m.estimated_metal_mt,5)::text difference_mt,
 round((m.confirmed_metal_mt-m.estimated_metal_mt)*100/nullif(m.estimated_metal_mt,0),2)::text difference_pct
 ${outboundFrom}`;
const weightTotals=`count(*)::int bags,count(*) FILTER(WHERE weight_basis='ESTIMATED')::int estimated_bags,
 count(*) FILTER(WHERE weight_basis='MISSING')::int missing_bags,
 CASE WHEN count(*)=0 THEN '0.0000' ELSE round(sum(net_kg)*0.001,4)::text END net_mt,
 CASE WHEN count(*)=0 THEN '0.00000' ELSE round(co_estimated_metal_mt(sum(net_kg)),5)::text END estimated_mt`;
const shipTotals=`count(*)::int vehicles,coalesce(sum(l.bag_count),0)::int bags,
 count(*) FILTER(WHERE m.shipment_status='COMPLETED')::int completed,
 count(*) FILTER(WHERE m.shipment_status='PENDING_ARECOMS')::int pending,
 CASE WHEN count(*)=0 THEN '0.00000' ELSE round(sum(m.estimated_metal_mt),5)::text END estimated_mt,
 round(sum(m.confirmed_metal_mt),5)::text confirmed_mt`;
const invalid=()=>B.error(400,'CO_METAL_FILTER');
const filters=['project_id','warehouse_id','customer_id','contract_id','sales_plan_id','preparation_id'];
function query(user,f,stock){
 const alias=stock?'i':'p',args=[user.id],clauses=[scope(alias,alias+'.customer_id')];
 const add=(sql,value)=>{args.push(value);clauses.push(sql.replace('?', '$'+args.length));};
 for(const key of filters)if(f[key])add((key==='preparation_id'?(stock?'i':'m')+'.preparation_id':key==='sales_plan_id'?(stock?'i.sales_plan_id':'p.id'):alias+'.'+key)+'=?',B.uuid(f[key]));
 if(f.contract_no)add(`EXISTS(SELECT 1 FROM co_sales_contracts k WHERE k.id=${alias}.contract_id AND strpos(lower(k.contract_no),lower(?))>0)`,f.contract_no);
 return {args,clauses,add,where(){return ' WHERE '+clauses.join(' AND ');}};
}
function stockFilter(user,f){
 const q=query(user,f,true);
 if(f.status)q.add('i.status=?',f.status);
 if(f.search)q.add(`strpos(lower(concat_ws(' ',document_no,preparation_batch_no,bag_no,seal_no,location_code)),lower(?))>0`,f.search);
 return q;
}
function outboundFilter(user,f){
 const q=query(user,f,false);
 if(f.status&&!['OUTBOUND','PENDING_ARECOMS','COMPLETED'].includes(f.status))q.clauses.push('false');
 if(['PENDING_ARECOMS','COMPLETED'].includes(f.status))q.add('m.shipment_status=?',f.status);
 if(f.search)q.add(`strpos(lower(concat_ws(' ',o.code,l.code,b.preparation_batch_no,cu.name,ct.contract_no,l.transport_snapshot->>'truck_no')),lower(?))>0`,f.search);
 if(f.from)q.add("m.posted_at >= (?::date::timestamp AT TIME ZONE 'Africa/Lubumbashi')",f.from);
 if(f.to)q.add("m.posted_at < ((?::date+1)::timestamp AT TIME ZONE 'Africa/Lubumbashi')",f.to);
 return q;
}
async function summary(c,req,f={},window){
 const i=stockFilter(req.user,f),o=outboundFilter(req.user,f);
 const inventory=(await c.query('SELECT '+weightTotals+',count(DISTINCT i.preparation_id)::int batches FROM co_metal_inventory i'+i.where(),i.args)).rows[0];
 const status=(await c.query('SELECT '+shipTotals+' '+outboundFrom+o.where(),o.args)).rows[0];
 const currentMonth="date_trunc('month',clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')";
 const month=(await c.query('SELECT '+shipTotals+' '+outboundFrom+o.where()+
  ' AND m.posted_at >= ('+currentMonth+" AT TIME ZONE 'Africa/Lubumbashi') AND m.posted_at < (("+currentMonth+"+interval '1 month') AT TIME ZONE 'Africa/Lubumbashi')",o.args)).rows[0];
 let period=month,months=[];
 if(window){
  const selected=outboundFilter(req.user,{...f,from:window.from,to:window.to});
  period=(await c.query('SELECT '+shipTotals+' '+outboundFrom+selected.where(),selected.args)).rows[0];
  const start="(date_trunc('month',?::date::timestamp) AT TIME ZONE 'Africa/Lubumbashi')";
  const end="((date_trunc('month',?::date::timestamp)+interval '1 month') AT TIME ZONE 'Africa/Lubumbashi')";
  const monthly=outboundFilter(req.user,{...f,from:null,to:null});
  monthly.add('m.posted_at >= '+start,window.from);monthly.add('m.posted_at < '+end,window.to);
  months=(await c.query(`SELECT to_char(${postedDay},'YYYY-MM') period,${shipTotals} ${outboundFrom}${monthly.where()} GROUP BY 1 ORDER BY 1`,monthly.args)).rows;
 }
 return {inventory,status,month,period,months};
}
async function preparation(c,id){
 return (await c.query(`SELECT
  (SELECT row_to_json(inv) FROM (SELECT ${weightTotals} FROM co_metal_inventory WHERE preparation_id=$1) inv) inventory,
  count(*)::int bags,count(bw.actual_net_kg)::int measured_bags,
  round(sum(bw.actual_gross_kg)*0.001,4)::text gross_mt,
  round(sum(bw.actual_net_kg)*0.001,4)::text measured_net_mt,
  round(co_estimated_metal_mt(sum(bw.actual_net_kg)),5)::text measured_estimated_mt
  FROM co_bags b LEFT JOIN co_bag_work bw ON bw.bag_id=b.id WHERE b.preparation_id=$1`,[id])).rows[0];
}
async function detail(c,req,orderId,includeHistory=true){
 const q=outboundFilter(req.user,{});q.add('m.order_id=?',B.uuid(orderId));
 const row=(await c.query(shipment+q.where(),q.args)).rows[0];
 if(!row)return null;
 const history=includeHistory?(await c.query(`SELECT e.*,round(e.amount_mt,5)::text display_mt,u.display_name actor_name
  FROM co_metal_events e JOIN users u ON u.id=e.actor_id WHERE outbound_id=$1 ORDER BY version DESC`,[row.outbound_id])).rows:undefined;
 return {...row,history,can_submit:req.user.permissions.includes('outbound:logistics-review')&&row.latest_action!=='SUBMITTED',
  can_decide:req.user.permissions.includes('outbound:production-approve')&&['admin','production_manager'].includes(req.user.role_code)&&
   row.latest_action==='SUBMITTED'&&row.latest_actor_id!==req.user.id};
}
const inventorySort={date:'received_at',batch:'preparation_batch_no',net:'sum(net_kg)'};
const outboundSort={date:'m.posted_at',batch:'b.preparation_batch_no',net:'m.net_kg',metal:'m.confirmed_metal_mt'};
function listOptions(q){
 const view=q.view||'inventory',page=Number(q.page||1),sort=q.sort||'date',direction=q.direction||'desc';
 if(Object.keys(q).some(k=>!['view','page','sort','direction','search','status','from','to',...filters].includes(k))||
  !['inventory','outbound'].includes(view)||!Number.isInteger(page)||page<1||page>100000||
  !Object.hasOwn(view==='inventory'?inventorySort:outboundSort,sort)||!['asc','desc'].includes(direction)||
  q.search!==undefined&&(typeof q.search!=='string'||q.search.length>160)||
  q.status&&!['PREPARING','PENDING_COMPLETION_REVIEW','COMPLETED','MATCHED','LOADING','REVIEW_PENDING','LOADED','DEPARTED',
   'OUTBOUND_PENDING','LOGISTICS_APPROVED','OUTBOUND_CORRECTION','PENDING_ARECOMS'].includes(q.status)||
  view==='outbound'&&q.status&&!['PENDING_ARECOMS','COMPLETED'].includes(q.status))throw invalid();
 for(const k of ['from','to'])if(q[k])B.date(q[k]);
 if(q.from&&q.to&&q.from>q.to)throw invalid();
 return {view,page,sort,direction};
}
async function list(c,req,q,exporting=false){
 const opts=listOptions(q),stock=opts.view==='inventory',f=stock?stockFilter(req.user,q):outboundFilter(req.user,q);
 const groups=stock?` FROM co_metal_inventory i${f.where()} GROUP BY preparation_id,document_no,preparation_batch_no,status`:null;
 const sql=stock?`SELECT preparation_id,document_no,preparation_batch_no,status,min(received_at) received_at,
  string_agg(DISTINCT location_code,' / ' ORDER BY location_code) location_codes,${weightTotals}${groups}`:shipment+f.where();
 const count=stock?'SELECT count(*) FROM (SELECT 1'+groups+') batches':'SELECT count(*) '+outboundFrom+f.where();
 const total=Number((await c.query(count,f.args)).rows[0].count);
 if(exporting&&total>10000)throw B.error(413,'CO_METAL_EXPORT_LIMIT');
 const order=(stock?inventorySort:outboundSort)[opts.sort]+' '+opts.direction+' NULLS LAST,'+(stock?'preparation_id':'m.outbound_id');
 const items=(await c.query(sql+' ORDER BY '+order+(exporting?'':' LIMIT 50 OFFSET '+(opts.page-1)*50),f.args)).rows;
 return {...opts,total,items};
}
async function exportBook(req,data){
 const en=req.user.language_code==='en',book=new(require('exceljs').Workbook)();
 const sheet=book.addWorksheet(en?'Cobalt Metal':'钴金属量');
 const cols=data.view==='inventory'?[
  ['preparation_batch_no','备货批次','Preparation Batch'],['document_no','入库单','Receipt'],['status','库存状态','Stock Status'],
  ['bags','袋数','Bags'],['net_mt','净重（MT）','Net Weight (MT)',4],['estimated_mt','预计金属量（MT）','Estimated Metal (MT)',5],
  ['estimated_bags','预计重量袋数','Estimated Weight Bags'],['missing_bags','待计算袋数','Missing Weight Bags'],
  ['location_codes','货位','Locations'],['received_at','入库时间','Receipt Time']
 ]:[
  ['preparation_batch_no','备货批次','Preparation Batch'],['order_no','装车单','Loading Order'],['customer_name','客户','Customer'],
  ['contract_no','合同','Contract'],['truck_no','车牌','Truck'],['posted_day','出库日期','Formal Outbound Date'],['bags','袋数','Bags'],
  ['net_mt','净重（MT）','Net Weight (MT)',4],['estimated_mt','预计金属量（MT）','Estimated Metal (MT)',5],
  ['confirmed_mt','ARECOMS确认（MT）','Confirmed ARECOMS (MT)',5],['difference_mt','差异（MT）','Difference (MT)',5],
  ['difference_pct','差异率（%）','Difference (%)',2],['shipment_status','发运状态','Shipment Status'],
  ['confirmed_metal_mt','确认原值（MT）','Exact Confirmed Source (MT)'],['confirmed_at','确认时间','Confirmation Time']
 ];
 sheet.columns=cols.map(([key,zh,label])=>({key,header:en?label:zh,width:24}));
 for(const item of data.items){
  const row=sheet.addRow(item);
  cols.forEach(([key,,,digits],index)=>{
   if(!digits||item[key]==null)return;
   const cell=row.getCell(index+1);
   // Excel has 15 significant digits. Keep wider values as exact decimal text.
   if(String(item[key]).replace(/[^0-9]/g,'').replace(/^0+/,'').length<=15){
    cell.value=Number(item[key]);cell.numFmt='0.'+'0'.repeat(digits);
   }
  });
 }
 sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];
 sheet.autoFilter={from:'A1',to:{row:1,column:cols.length}};
 sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:1'};
 return Buffer.from(await book.xlsx.writeBuffer());
}
const writePermissions={submit:'outbound:logistics-review',confirm:'outbound:production-approve',reject:'outbound:production-approve'};
async function decide(c,req,action){
 const body=req.body,id=B.uuid(req.params.id);
 if(!body||Object.keys(body).some(k=>!['version','reason',...(action==='submit'?['amount_mt']:[])].includes(k))||
  !Number.isSafeInteger(body.version)||body.version<0)throw B.error(400,'CO_METAL_INPUT');
 const reason=B.text(body.reason,'CO_METAL_REASON',1000);
 if(action==='submit'&&(typeof body.amount_mt!=='string'||!/^\d{1,16}(\.\d{1,5})?$/.test(body.amount_mt)||!/[1-9]/.test(body.amount_mt)))
  throw B.error(400,'CO_METAL_AMOUNT');
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended('co-metal:'||id,0)) FROM co_outbounds WHERE order_id=$1",[id]);
 const row=await detail(c,req,id,false);
 if(!row)throw B.error(404,'CO_METAL_NOT_POSTED');
 if(row.version!==body.version)throw B.error(409,'CO_METAL_STALE');
 if(action==='submit'&&!row.can_submit)throw B.error(409,'CO_METAL_PENDING');
 if(action!=='submit'&&!row.can_decide)throw B.error(403,'CO_METAL_PERMISSION');
 const event=(await c.query(`INSERT INTO co_metal_events(outbound_id,version,action,amount_mt,actor_id,reason)
  VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[row.outbound_id,row.version+1,
  {submit:'SUBMITTED',confirm:'CONFIRMED',reject:'REJECTED'}[action],
  action==='submit'?body.amount_mt:action==='confirm'?row.pending_metal_mt:null,req.user.id,reason])).rows[0];
 await B.audit(c,req,'co_metal_'+action,'co_outbounds',row.outbound_id,{version:row.version,confirmed_metal_mt:row.confirmed_metal_mt},event);
 return {...event,id:row.order_id,project_id:row.project_id,warehouse_id:row.warehouse_id,customer_id:row.customer_id};
}
async function register({app,pool,permitted,csrf}){
 const read=req=>permitted(req.query.view==='outbound'?'outbound:read':'co:read')(req);
 app.get(base,{preHandler:read},req=>C.readTransaction(pool,async c=>{
  const result=await list(c,req,req.query),scope=Object.fromEntries(filters.filter(k=>req.query[k]).map(k=>[k,req.query[k]]));
  const dated=result.view==='outbound'&&(req.query.from||req.query.to),totals=await summary(c,req,scope);
  if(dated){
   const selected=outboundFilter(req.user,{...scope,from:req.query.from,to:req.query.to});
   totals.period=(await c.query('SELECT '+shipTotals+' '+outboundFrom+selected.where(),selected.args)).rows[0];
  }
  if(result.view==='inventory'){
   const report=await require('./cobalt-reports.cjs').build(c,req,scope);
   const analysis=await require('./overview-analysis.cjs').cobalt(c,req,report);
   const {preparing,prepared,loading,loaded}=analysis.stock_cards;
   totals.stock_cards={preparing,prepared,loading,loaded};
   totals.execution=analysis.execution?.map(({planned_physical_mt,invoiced_net_kg})=>({planned_physical_mt,invoiced_net_kg}));
  }
  if(!req.user.permissions.includes('co:read'))delete totals.inventory;
  if(!req.user.permissions.includes('outbound:read')){delete totals.status;delete totals.month;delete totals.period;}
  return {...result,summary:totals};
 }));
 app.get(base+'/export',{preHandler:[read,permitted('inventory:export')]},async(req,reply)=>{
  const data=await C.readTransaction(pool,c=>list(c,req,req.query,true));
  return reply.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
   .header('Content-Disposition','attachment; filename="cobalt-metal.xlsx"').send(await exportBook(req,data));
 });
 app.get(base+'/outbounds/:id',{preHandler:permitted('outbound:read')},req=>C.readTransaction(pool,async c=>{
  const row=await detail(c,req,req.params.id);
  if(!row)throw B.error(404,'CO_METAL_NOT_POSTED');
  return row;
 }));
 for(const [action,permission] of Object.entries(writePermissions))
  app.post(base+'/outbounds/:id/'+action,{preHandler:[permitted(permission),csrf]},req=>S.mutation(pool,req,permission,c=>decide(c,req,action)));
}
module.exports={allowed,enabled,register,summary,detail,preparation,exportBook};
