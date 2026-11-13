'use strict';
const D=require('./report-center-data.cjs'),M=require('./management.cjs'),C=require('./control-common.cjs');
const W=require('./professional-workbook.cjs');
const kindNames={shipping:['发运及单证','Shipments & Documents'],movement:['出入库流水','Inventory Movements'],
 balance:['收发存与对账','Stock Balance & Reconciliation'],stocktake:['盘点与差异','Stocktake & Variances'],sales:['销售与履约','Sales & Fulfilment']};
const names={
 date:['日期','Date','date'],document:['单据号','Document No.'],customer:['客户','Customer'],contract:['合同号','Contract No.'],
 vehicle:['车辆','Vehicle'],lot:['批次号','Lot Number'],packing:['装箱单号','Packing List No.'],invoice:['商业发票号','Commercial Invoice No.'],
 trips:['发运车次','Trips','number'],qty:['数量','Quantity','number'],gross:['毛重（MT）','Gross (MT)','weight'],
 net:['净重（MT）','Net (MT)','weight'],history:['历史净重（MT）','Historical Net (MT)','weight'],
 pending:['待处理','Pending','number'],status:['状态','Status','enum'],source:['数据来源','Source','enum'],
 kind:['业务类型','Movement','enum'],piece:['捆包号 / 袋号','Bundle / Bag No.'],warehouse:['仓库','Warehouse'],position:['货位','Location'],
 change:['净变动（MT）','Net Change (MT)','weight'],included:['计入在线库存账','Included in Live Ledger','enum'],period:['账期','Period'],
 opening_net_mt:['期初净重','Opening Net','weight'],inbound_net_mt:['入库净重','Receipt Net','weight'],outbound_net_mt:['出库净重','Outbound Net','weight'],
 weight_correction_mt:['重量确认 / 更正','Weight Confirmation / Correction','weight'],other_net_mt:['返场 / 调整 / 流转','Return / Adjustment / Transfer','weight'],
 baseline_net_mt:['追溯基准','History Baseline','weight'],closing_net_mt:['期末净重','Closing Net','weight'],
 reconciliation_net_mt:['已知净重勾稽差额','Known Net Reconciliation Difference','weight'],coverage:['历史覆盖','History Coverage','enum'],
 bookQty:['账面数量','Book Qty','number'],realQty:['实盘数量','Counted Qty','number'],qtyDelta:['数量差','Qty Variance','number'],
 bookWeight:['账面净重（MT）','Book Net (MT)','weight'],realWeight:['实盘净重（MT）','Counted Net (MT)','weight'],
 variance:['已核净重差（MT）','Verified Net Variance (MT)','weight'],finding:['差异类型','Finding','enum'],
 unknown:['待核重量行','Rows Awaiting Weight','number'],snapshot:['冻结快照','Frozen Snapshot'],
 plan:['销售计划号','Sales Plan No.'],month:['发运月','Shipment Month'],target:['计划净重','Planned Net','weight'],
 prepared:['备货净重','Prepared Net','weight'],loaded:['装车净重','Loaded Net','weight'],outbound:['出库净重','Outbound Net','weight'],
 invoiced:['确认开票净重','Invoice-confirmed Net','weight'],rate:['履约率','Fulfilment','percent'],
 confirmed:['开票确认日期','Invoice Confirmation Date','date']
};
const enums={
 ONLINE:['在线单据','Online'],HISTORICAL:['历史导入','Historical Import'],INBOUND:['入库','Receipt'],OUTBOUND:['出库','Outbound'],
 RETURN:['返场','Return'],ADJUSTMENT:['调整','Adjustment'],WEIGHT:['重量确认 / 更正','Weight Confirmation / Correction'],
 TRANSFER:['范围流转','Scope Transfer'],BASELINE:['追溯基准','History Baseline'],YES:['是','Yes'],NO:['否','No'],
 DOCUMENT_MISSING:['未归档','Not Archived'],IMPORTED_PACKING:['历史装箱单','Historical Packing List'],
 INVOICE_PENDING:['待开票确认','Awaiting Invoice Confirmation'],INVOICE_CONFIRMED:['已确认开票','Invoice Confirmed'],
 DOCUMENT_COMPLETE:['单证齐全','Documents Complete'],UNLINKED_HISTORY:['历史发运未关联销售计划','Historical Shipment Without Sales Plan'],
 COMPLETE:['完整','Complete'],PARTIAL:['部分可追溯','Partially Traceable'],UNKNOWN:['未覆盖','Unavailable'],MATCH:['相符','Matched'],
 GAIN:['盘盈','Gain'],LOSS:['盘亏','Loss'],WEIGHT_MISMATCH:['重量差异','Weight Variance'],LOCATION:['货位差异','Location Variance'],
 STATUS:['状态差异','Status Variance'],DUPLICATE:['重复','Duplicate'],UNVERIFIED_MOVEMENT:['变动待核实','Unverified Movement'],
 UNCOUNTED:['未盘','Uncounted'],DIFFERENCE:['有差异','Variance'],OPEN:['待处理','Open'],RESOLVED:['已处理','Resolved']
};
const groupKeys=['date','customer','contract','vehicle','lot'];
const formats={
 shipping:['date document customer contract vehicle lot packing invoice qty gross net status source','trips qty net history pending'],
 movement:['date kind document lot piece warehouse position qty net source','kind source qty net change'],
 balance:['date warehouse kind document lot piece qty change source included',
  'period warehouse opening_net_mt inbound_net_mt outbound_net_mt weight_correction_mt other_net_mt baseline_net_mt closing_net_mt reconciliation_net_mt coverage history'],
 stocktake:['document date warehouse position lot piece bookQty realQty bookWeight realWeight variance finding status snapshot',
  'document date warehouse bookQty realQty qtyDelta variance unknown pending snapshot'],
 sales:['plan date customer contract lot document outbound status confirmed invoice source','plan customer contract month target prepared loaded outbound invoiced rate']
};
const required={stocktake:'stocktake:read',sales:'plan:read'};
const texts=(en)=>Object.fromEntries(Object.entries(enums).map(([k,v])=>[k,v[+en]]));
const groupBy=(rows,fn)=>{
 const groups=new Map();
 for(const row of rows){const key=fn(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 return groups;
};
const countTrips=rows=>new Set(rows.map(row=>row.trip).filter(Boolean)).size;
const sum=D.total;
const includes=(value,term)=>!term||String(value??'').toLowerCase().includes(term.toLowerCase());
const findStatuses=rows=>rows.filter(r=>r.status==='INVOICE_PENDING');
const moveMetrics=rows=>({qty:sum(rows,'qty'),net:sum(rows,'net'),change:sum(rows,'change')});
const shipMetrics=rows=>({trips:countTrips(rows),qty:sum(rows,'qty'),net:sum(rows,'net'),
 history:sum(rows.filter(r=>r.source==='HISTORICAL'),'net'),pending:countTrips(findStatuses(rows))});
const rate=(actual,target)=>actual!=null&&Number(target)>0?Number(actual)/Number(target):null;
const col=(key,en)=>({key,label:names[key][+en],type:names[key][2]||'text'});
function groupRows(rows,fn,aggregate){
 return [...groupBy(rows,fn)].map(([key,items])=>({...aggregate(items),scope:key}));
}
function select(rows,q,keys){return rows.filter(row=>keys.every(key=>includes(row[key],q[key])));}
function stockSummary(items){
 const known=items.filter(row=>row.variance!=null);
 const qtyBook=sum(items,'bookQty'),qtyReal=sum(items,'realQty');
 const first=items[0];
 return {document:first.document,date:first.date,warehouse:first.warehouse,bookQty:qtyBook,realQty:qtyReal,qtyDelta:qtyReal==null?null:qtyReal-qtyBook,
  variance:known.length?sum(known,'variance'):null,pending:items.filter(r=>r.status==='OPEN').length,
  unknown:items.length-known.length,snapshot:first.snapshot};
}
function dataSourceFilter(rows,q){
 return select(rows,q,['document','customer','contract','vehicle','lot'])
  .filter(row=>['source','kind','status','finding'].every(key=>!q[key]||row[key]===q[key]));
}
function clippedMonth(m){return new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).toISOString().slice(0,10);}
async function parameters(c,input){
 const kind=input.kind||'shipping';
 if(!Object.hasOwn(kindNames,kind))throw C.error(400,'未知报表类型');
 const today=(await c.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi','YYYY-MM-DD') d")).rows[0].d;
 const month=input.month||today.slice(0,7);
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<'1900-01')throw C.error(400,'月份无效');
 const monthly=kind==='balance'||kind==='sales';
 const from=monthly?month+'-01':C.date(input.from||today.slice(0,8)+'01');
 const to=monthly?(kind==='balance'? [clippedMonth(month),today].sort()[0]:clippedMonth(month)):C.date(input.to||today);
 if(from>to||kind!=='sales'&&to>today||(+new Date(to)-+new Date(from))/86400000>366)throw C.error(400,'日期范围无效');
 const group=input.group||'date';
 if(!groupKeys.includes(group))throw C.error(400,'发运分组无效');
 const q={kind,from,to,group,month,today};
 for(const key of ['source','kind_filter','status','finding','document','customer','contract','vehicle','lot','scope']){
  const value=input[key];
  if(value!=null&&value!==''){
   if(typeof value!=='string'||value.length>(key==='scope'?600:160))throw C.error(400,'筛选值无效');
   q[key]=value.trim();
  }
 }
 if(input.warehouse_id)q.warehouse_id=C.uuid(input.warehouse_id);
 return q;
}
async function report(c,req,input){
 const q=await parameters(c,input),kind=q.kind,en=req.user.language_code==='en';
 if(required[kind]&&!req.user.permissions.includes(required[kind]))throw C.error(403,'当前账号没有此报表的查询权限');
 let detail,summary,metric,warehouses=[],traceableFrom=null;
 if(kind==='shipping'){
  detail=dataSourceFilter(await D.shipping(c,req,{...q,contract_no:q.contract}),{...q,kind:null});
  summary=groupRows(detail,row=>JSON.stringify(row[q.group]??null),items=>({[q.group]:items[0][q.group],...shipMetrics(items)}));
  metric=shipMetrics(detail);
 }else if(kind==='movement'){
  detail=dataSourceFilter(await D.movements(c,req,q),{...q,kind:q.kind_filter});
  summary=groupRows(detail,row=>row.kind+'|'+row.source,items=>({kind:items[0].kind,source:items[0].source,...moveMetrics(items)}));
  const incoming=detail.filter(r=>r.kind==='INBOUND'),outgoing=detail.filter(r=>r.kind==='OUTBOUND');
  metric={inbound_net_mt:sum(incoming,'net'),outbound_net_mt:sum(outgoing,'net'),qty:sum(detail,'qty')};
 }else if(kind==='balance'){
  const balance=await D.balance(c,req,q);
  ({warehouses,traceable_from:traceableFrom}=balance);
  detail=balance.rows;
  summary=[{...balance.summary,scope:'ONLINE'}];
  metric=Object.fromEntries(['opening_net_mt','closing_net_mt','reconciliation_net_mt','history'].map(key=>[key,balance.summary[key]]));
 }else if(kind==='stocktake'){
  detail=dataSourceFilter(await D.stocktake(c,req,q),{...q,kind:null});
  summary=groupRows(detail,row=>row.id,stockSummary);
  metric={pending:detail.filter(r=>r.status==='OPEN').length,unknown:detail.filter(r=>r.variance==null).length,
   variance:sum(detail.filter(r=>r.variance!=null),'variance')};
 }else{
  const sales=await D.sales(c,req,{...q,contract_no:q.contract});
  summary=select(sales.plans,q,['customer','contract']).map(row=>({...row,scope:row.id,rate:rate(row.invoiced,row.target)}));
  detail=select(sales.rows,q,['customer','contract','source']);
  metric={target:sum(summary,'target'),outbound:sum(summary,'outbound'),invoiced:sum(summary,'invoiced')};
  metric.rate=rate(metric.invoiced,metric.target);
 }
 const selected=q.scope!=null?summary.find(row=>row.scope===q.scope):null;
 if(q.scope!=null&&!selected)throw C.error(400,'明细范围已变化，请重新查询');
 const matcher={shipping:r=>JSON.stringify(r[q.group]??null)===q.scope,movement:r=>r.kind+'|'+r.source===q.scope,
  balance:r=>r.source===q.scope,stocktake:r=>r.id===q.scope,sales:r=>r.id===q.scope};
 if(selected)detail=detail.filter(matcher[kind]);
 const [detailCols,summaryCols]=formats[kind].map(s=>s.split(' '));
 if(kind==='shipping')summaryCols.unshift(q.group);
 const customerOptions=[...new Set([...summary,...detail].map(r=>r.customer).filter(Boolean))].sort();
 const columns=(keys)=>keys.map(key=>{
  const column=col(key,en);
  if(key==='qty')column.label=req.productCode==='CO_HYDROXIDE'?(en?'Bags':'袋数'):(en?'Bundles':'捆包数');
  return column;
 });
 const localLabels=texts(en);
 const keyForScope={shipping:q.group,movement:'kind',balance:'warehouse',stocktake:'document',sales:'plan'};
 const scopeLabel=selected?(localLabels[selected[keyForScope[kind]]]||selected[keyForScope[kind]]||'—'):null;
 return {kind,title:kindNames[kind][+en],from:q.from,to:q.to,today:q.today,product:req.productCode,traceableFrom,
  summary:{columns:columns(summaryCols),rows:selected?[selected]:summary},
  detail:{columns:columns(detailCols),rows:detail},
  metrics:columns(Object.keys(metric)).map(item=>({...item,value:metric[item.key]})),
  labels:localLabels,scopeLabel,warehouses,customers:customerOptions,canExport:req.user.permissions.includes('inventory:export')};
}
async function workbook(data,req){
 const ctx=W.make(req),t=ctx.t;
 const product=data.product==='CO_HYDROXIDE'?t('氢氧化钴','Cobalt Hydroxide'):t('阴极铜','Copper Cathodes');
 const subtitle=[product,data.from+' – '+data.to,'MT',data.scopeLabel].filter(Boolean).join('  /  ');
 for(const [key,cn,en] of [['summary','汇总','Summary'],['detail','明细','Detail']]){
  const section=data[key],sheet=W.sheet(ctx,cn,en,data.title,subtitle);
  const columns=section.columns.map(col=>W.col(col.key,col.label,col.label,col.type==='enum'?null:col.type,Math.max(18,col.label.length+5)));
  const rows=section.rows.map(row=>Object.fromEntries(section.columns.map(col=>[col.key,col.type==='enum'?data.labels[row[col.key]]??row[col.key]:row[col.key]])));
  const last=W.table(ctx,sheet,6,columns,rows,{filter:true});
  if(data.kind==='balance')W.note(ctx,sheet,last+2,'历史导入的发运单独列示，在线账只包含正式业务。','Historical shipments are shown separately from the live ledger.');
  if(data.kind==='sales')W.note(ctx,sheet,last+2,'履约率以确认开票净重计算。','Fulfilment uses invoice-confirmed net weight.');
 }
 return Buffer.from(await ctx.wb.xlsx.writeBuffer());
}
const route='/api/v1/report-center';
function allowed(path,method){return method==='GET'&&path===route||method==='POST'&&path===route+'/export';}
function register({app,pool,permitted,csrf}){
 const read=permitted('report:read'),exportAllowed=permitted('inventory:export');
 app.get(route,{preHandler:read},req=>M.read(pool,c=>report(c,req,req.query||{})));
 app.post(route+'/export',{preHandler:[read,exportAllowed,csrf]},async(req,reply)=>{
  const data=await M.read(pool,c=>report(c,req,req.body||{}));
  const file=await workbook(data,req);
  await C.audit(pool,req,'management_report_export','reports',null,null,{report:data.kind,product:data.product,from:data.from,to:data.to,rows:data.detail.rows.length});
  return reply.header('Content-Disposition','attachment; filename="'+data.kind+'.xlsx"')
   .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(file);
 });
}
module.exports={allowed,register,report,workbook};
