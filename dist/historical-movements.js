'use strict';
window.HistoricalMovements={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 path:'/workbench/historical-movements',
 kinds:{receipts:'RECEIPT','loading-plans':'LOADING_PLAN',outbounds:'LOADING_ORDER','stock-outbound':'OUTBOUND'},
 queue:[],
 canImport:()=>CurrentUser.role_code==='admin',
 prefix:()=>ProductContext.isCopper()?'':'/cobalt',
 product(code){return this.t(...(code==='CU_CATHODE'?['阴极铜','Copper Cathodes']:code==='CO_HYDROXIDE'?['氢氧化钴','Cobalt Hydroxide']:['—','—']));},
 badge(){return '<span class="s46-badge">'+this.t('历史导入数据','Historical Import')+'</span>';},
 text(v){return esc(v==null||v===''?'—':v);},
 weight(kg){return kg==null?'—':Tonnes.format(Tonnes.fixed(Tonnes.scaled(String(kg),9)/1000n,9));},
 section(zh,en,body){return '<section class="panel wms-section"><h2>'+this.t(zh,en)+'</h2>'+body+'</section>';},
 table(head,rows,numeric=[]){
  if(!rows.length)return System46.stateHTML('empty');
  return '<div class="business-table">'+UI46Pages.table('<table><thead><tr>'+head.map(label=>'<th scope="col">'+esc(label)+'</th>').join('')+
   '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table>',{numeric})+'</div>';
 },
 message(code){
  const labels={
   SHIPPING_DATE_MISSING:['发运日期缺失','Shipping date is missing'],SHIPPING_DATE_INVALID:['发运日期格式无效或晚于今天','Invalid or future shipping date'],
   SHIPPING_DATE_AMBIGUOUS:['发运日期字段重复','More than one shipping date field'],RECEIPT_AFTER_SHIPPING:['原始入库日期晚于发运日期','Original receipt is later than shipping'],
   FORMAL_DOCUMENT_CONFLICT:['与现有正式单据冲突','Conflicts with a formal document'],DOCUMENT_CONFLICT:['同号单据内容、日期或仓库冲突','Same number with different content, date or warehouse'],
   UNIT_CONFLICT:['编号已关联其他单据','Identifier already linked to another document'],UNIT_MISSING:['缺少编号','Missing identifier'],DUPLICATE_UNIT:['单内编号重复','Duplicate identifier'],
   INVALID_SHEETS:['片数无效','Invalid sheet count'],INVALID_WEIGHT:['重量缺失或无效','Missing or invalid weight'],SOURCE_TOTAL_MISMATCH:['原单合计与明细不符','Totals do not match detail rows'],
   TOTAL_ROW_MISSING:['缺少合计行','Totals row is missing'],DOCUMENT_NO_MISSING:['缺少装箱单号','Missing packing list number'],BATCH_NO_MISSING:['缺少备货批次','Missing preparation batch'],
   DETAILS_MISSING:['缺少明细','Missing detail rows'],INVALID_WORKBOOK:['工作簿格式或表头无效','Invalid workbook format or headers'],
   HISTORY_SCOPE:['仓库不在授权范围内','Warehouse is outside your scope'],REVIEW_REQUIRED:['数据已变化，请重新预览','Data changed. Preview again.'],
   PREVIEW_FAILED:['预览服务暂不可用，请重试','Preview is temporarily unavailable. Retry.'],
   IMPORT_WRITE_FAILED:['整张已回滚，可重试','The entire file was rolled back. Retry.']
  };
  return labels[code]?this.t(...labels[code]):this.t('无法处理文件','File could not be processed');
 },
 kind(code){
  const labels={RECEIPT:['历史入库单','Historical Receipt'],LOADING_PLAN:['历史装车计划','Historical Loading Plan'],
   LOADING_ORDER:['历史装车单','Historical Loading Order'],OUTBOUND:['历史出库库存记录','Historical Outbound Stock Record']};
  return this.t(...labels[code]);
 },
 documentRoute(path){return /^\/(receipts|loading-plans|outbounds|stock-outbound|inventory)\/historical(?:\/[0-9a-f-]{36})?$/.test(path);},
 permission(area){
  return ({receipts:ProductContext.isCopper()?'receipt:read':'co:read',inventory:ProductContext.isCopper()?'inventory:read':'co:read',
   'loading-plans':'loading-plan:read',outbounds:'load:read','stock-outbound':'load:read'})[area];
 },
 canArea(area){return CurrentUser.permissions.includes(this.permission(area));},
 stockPath(facts={}){
  const q=new URLSearchParams(ProductContext.isCopper()?{status:'OUTBOUND'}:{stock_state:'OUTBOUND'});
  if(ProductContext.isCopper()&&facts.packing_list_no)q.set('packing_list_no',facts.packing_list_no);
  if(!ProductContext.isCopper()&&facts.batch_no)q.set('batch',facts.batch_no);
  return '/inventory?'+q;
 },
 recordLink(id,product,label){
  const query=product?'?'+new URLSearchParams({product}):'';
  return '<a class="button secondary compact" href="'+this.path+'/'+esc(id)+query+'">'+label+'</a>';
 },
 links(documents){
  return documents.map(doc=>{
   const area=Object.keys(this.kinds).find(key=>this.kinds[key]===doc.kind);
   return '<li>'+this.kind(doc.kind)+' · '+(this.canArea(area)?'<a href="/'+area+'/historical/'+esc(doc.id)+'">'+esc(doc.document_no)+'</a>':esc(doc.document_no))+
    ' · '+esc(doc.business_date)+'</li>';
  }).join('');
 },
 page(zh,en,body,admin=false){
  const title=this.t(zh,en);
  Router.page(title,'<div data-page-composed data-no-i18n data-historical-page>'+
   (admin?'<nav aria-label="'+this.t('面包屑','Breadcrumb')+'" class="business-toolbar"><a href="/workbench">'+this.t('系统管理','System Administration')+'</a><span aria-hidden="true">›</span><span aria-current="page">'+this.t('历史出入库导入','Historical Stock Imports')+'</span></nav>':'')+body+'</div>');
 },
 async list({retain=false}={}){
  const t=this.t,q=new URLSearchParams(location.search);
  const [data,warehouses]=await Promise.all([API.request('/historical-movements?'+new URLSearchParams([...q,['all_products','1']])),API.request('/historical-movements/destinations')]);
  if(!retain){this.queue=[];this.warehouse='';}
  const filter='<form id="historical-filter" class="filters wms-filter-row">'+[['from',t('起始日期','From')],['to',t('截止日期','To')]].map(([name,label])=>
   '<label>'+label+'<input type="date" name="'+name+'" value="'+esc(q.get(name)||'')+'"></label>').join('')+
   '<div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+'</button><a class="button secondary" href="'+this.path+'">'+t('重置','Reset')+'</a></div></form>';
  this.page('历史出入库导入','Historical Stock Imports',this.section('上传装箱单','Upload Packing Lists',
   '<form id="historical-upload" class="user-form" data-wms-validation><div class="form-grid wms-field-grid">'+
   '<label class="wms-field">'+t('归档仓库','Archive Warehouse')+'<select name="warehouse_id" required>'+
   warehouses.map(w=>'<option value="'+esc(w.id)+'">'+esc(w.project_name+' / '+w.name)+'</option>').join('')+'</select></label>'+
   '<label class="wms-field">'+t('装箱单（XLS 或 XLSX）','Packing Lists (XLS or XLSX)')+
   '<input required multiple type="file" name="source" accept=".xls,.xlsx"></label></div><div class="wms-filter-actions">'+
   '<button class="button primary" '+(warehouses.length?'':'disabled')+'>'+t('预览','Preview')+'</button></div>'+
   '<p id="historical-upload-error" class="error" role="alert">'+(warehouses.length?'':t('当前账号没有可用的归档仓库。','No archive warehouse is available.'))+'</p></form>'+
   '<div id="historical-preview" aria-live="polite"></div>')+
   this.section('导入记录','Import Records',filter+'<div id="historical-ledger">'+this.ledger(data,q)+'</div>'),true);
  const form=$('historical-upload');
  if(this.warehouse)form.elements.warehouse_id.value=this.warehouse;
  for(const name of ['source','warehouse_id'])form.elements[name].onchange=()=>{this.queue=[];this.showQueue();};
  form.onsubmit=e=>{e.preventDefault();return this.read([...form.elements.source.files],form.elements.warehouse_id.value,form);};
  $('historical-filter').onsubmit=e=>{e.preventDefault();Router.go(this.path+'?'+new URLSearchParams(new FormData(e.target)));};
  this.showQueue();
 },
 ledger(data,q){
  const t=this.t;
  const pager=(page,label)=>{const next=new URLSearchParams(q);next.set('page',page);return '<a class="button secondary compact" href="'+this.path+'?'+esc(next)+'">'+label+'</a>';};
  return this.table([t('装箱单号','Packing List No.'),t('产品','Product'),t('业务日期','Business Date'),t('备货批次','Preparation Batch'),t('数量','Quantity'),t('净重（吨）','Net Weight (MT)'),t('状态','Status'),t('操作','Action')],
   data.items.map(r=>[esc(r.document_no),this.product(r.product_code),esc(r.business_date),this.text(r.source_facts.batch_no),CountValues.display(r.quantity),this.weight(r.net_kg),
    r.voided_at?t('已作废','Voided'):r.import_batch_id?this.badge():t('旧版台账','Legacy Ledger'),this.recordLink(r.id,r.product_code,t('查看','View'))]),[4,5])+
   '<div class="wms-filter-actions">'+(data.page>1?pager(data.page-1,t('上一页','Previous')):'')+(data.has_next?pager(data.page+1,t('下一页','Next')):'')+'</div>';
 },
 async read(files,warehouse,form,replaceIndex){
  if(this.busy)return;
  const t=this.t,error=$('historical-upload-error');
  if(!files.length||files.length>20){error.textContent=t('请选择 1 至 20 份装箱单。','Select 1 to 20 packing lists.');return;}
  this.busy=true;this.warehouse=warehouse;form.querySelectorAll('input,select,button').forEach(n=>n.disabled=true);error.textContent='';
  const uploaded=[];
  try{
   for(const file of files){
    if(file.size>524288){uploaded.push({name:file.name,preview:{code:'INVALID_WORKBOOK',error:t('超过 512 KB','Exceeds 512 KB')}});continue;}
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    uploaded.push({name:file.name,body:{file_name:file.name,file_base64:btoa(binary),warehouse_id:warehouse}});
   }
   const valid=uploaded.filter(row=>row.body);
   if(valid.length){
    const result=await API.request('/historical-movements/batch/preview',{method:'POST',body:{files:valid.map(row=>row.body)}});
    for(const row of result.results)valid[row.index].preview=row;
   }
   if(!form.isConnected)return;
   if(replaceIndex===undefined)this.queue=uploaded;else this.queue.splice(replaceIndex,1,uploaded[0]);
  }catch(e){if(form.isConnected)error.textContent=I18n.translate(e.message,true);}
  finally{
   this.busy=false;
   if(form.isConnected){form.querySelectorAll('input,select,button').forEach(n=>n.disabled=false);this.showQueue();}
  }
 },
 showQueue(){
  const box=$('historical-preview');if(!box)return;
  const t=this.t,queue=this.queue,form=$('historical-upload');
  if(!queue.length){box.replaceChildren();return;}
  box.innerHTML='<h3>'+t('批量导入预览','Batch Import Preview')+'</h3>'+queue.map(({name,preview:p,result},index)=>{
   const id=result?.id||p?.already_imported,product=p?.product_code;
   const review=(result?.issues||p?.issues||[]).map(code=>this.message(code));
   if(p?.shipping_issue)review.push(p.shipping_cell||'PL!E7');
   if(p?.conflicting_documents?.length)review.push(p.conflicting_documents.join(' / '));
   if(result?.code||p?.code)review.push(this.message(result?.code||p.code));
   if(p?.error&&I18n.language!=='en')review.push(p.error);
   const status=id?(result?.status==='IMPORTED'?t('导入成功','Imported'):t('已导入','Already Imported')):
    p?.importable&&!result?t('可导入','Ready to Import'):result?.code==='IMPORT_WRITE_FAILED'?t('写入失败，可重试','Write Failed, Retry'):t('待修正','Needs Correction');
   return '<details class="panel wms-section" data-history-file="'+index+'"'+(queue.length===1?' open':'')+'><summary>'+
    [name,this.product(product),p?.business_date||'—',p?.document_no,p?.batch_no,
     p?.totals?CountValues.display(p.totals.quantity)+' '+t('件','units')+' / '+this.weight(p.totals.net_kg)+' MT':null,status].filter(Boolean).map(esc).join(' · ')+'</summary>'+
    (review.length?'<p class="error" role="status">'+esc(review.join(' · '))+'</p>':'')+
    (p?.rows?.length?this.lines(result?.rows?.length?result.rows:p.rows,product):'')+
   (id?'<div class="business-toolbar">'+this.recordLink(id,product,t('查看导入记录','View Import Record'))+
    (product===ProductContext.code&&this.canArea('inventory')&&p?'<a class="button secondary compact" href="'+esc(this.stockPath({packing_list_no:p.document_no,batch_no:p.batch_no}))+'">'+t('查看已出库库存','View Outbound Stock')+'</a>':'')+'</div>':
     '<label class="wms-field">'+t('单独重传此文件','Replace This File')+'<input type="file" accept=".xls,.xlsx" data-historical-replace="'+index+'"></label>')+
    '</details>';
  }).join('')+'<div class="wms-filter-actions"><button type="button" class="button primary" id="historical-confirm">'+t('确认导入合格文件','Import Valid Files')+
   '</button></div><p id="historical-confirm-error" class="error" role="alert"></p>';
  for(const input of box.querySelectorAll('[data-historical-replace]'))input.onchange=()=>this.read([...input.files],form.elements.warehouse_id.value,form,Number(input.dataset.historicalReplace));
  const button=$('historical-confirm'),pending=queue.filter(row=>row.preview?.importable&&(!row.result||row.result.code==='IMPORT_WRITE_FAILED'));
  button.disabled=this.busy||!pending.length;
  button.onclick=async()=>{
   button.disabled=true;this.busy=true;
   try{
    if(!await OperationConfirm.ask({title:t('确认导入合格装箱单？','Import validated packing lists?')}))return;
    const response=await API.request('/historical-movements/batch/confirm',{method:'POST',body:{files:pending.map(row=>({...row.body,preview_token:row.preview.preview_token}))}});
    for(const result of response.results){pending[result.index].result=result;if(result.id)delete pending[result.index].body;}
    if(box.isConnected){
     const q=new URLSearchParams(location.search),data=await API.request('/historical-movements?'+new URLSearchParams([...q,['all_products','1']]));
     if(box.isConnected)$('historical-ledger').innerHTML=this.ledger(data,q);
    }
   }catch(e){if(box.isConnected)$('historical-upload-error').textContent=I18n.translate(e.message,true);}
   finally{this.busy=false;if(box.isConnected)this.showQueue();}
  };
 },
 lines(rows,product){
  const t=this.t,cu=product==='CU_CATHODE';
  return this.table([t('原表行','Source Row'),t(cu?'捆包号':'袋号',cu?'Bundle No.':'Bag No.'),t('铅封号','Seal No.'),
   ...(cu?[t('片数','Sheets')]:[]),t('毛重（吨）','Gross (MT)'),t('净重（吨）','Net (MT)'),t('校验','Validation')],
   rows.map(r=>[r.source_row,this.text(r.unit_id),this.text(r.seal_no),...(cu?[CountValues.display(r.sheets_count)]:[]),
    this.weight(r.gross_kg),this.weight(r.net_kg),this.text([...(r.flags||[]).map(code=>this.message(code)),...(r.conflicts||[])].join(' · '))]),
   cu?[0,3,4,5]:[0,3,4]);
 },
 facts(row){
  const t=this.t,f=row.source_facts||row;
  return UI46Pages.factList([
   [t('产品','Product'),this.product(row.product_code)],[t('装箱单号','Packing List No.'),row.packing_list_no||row.document_no],
   [t('备货批次','Preparation Batch'),f.batch_no],[t('发运日期','Shipping Date'),row.shipping_date||f.shipping_date],
   [t('原始入库日期','Original Receipt Date'),row.original_receipt_date],[t('客户','Customer'),f.customer],[t('合同号','Contract No.'),f.contract_no],
   [t('车头号','Truck'),f.truck],[t('挂车','Trailers'),[f.trailer_one,f.trailer_two].filter(Boolean).join(' / ')],
   [t('净重（吨）','Net Weight (MT)'),this.weight(row.net_kg)],[t('原文件','Source File'),row.source_name],
   [t('导入批次','Import Batch'),row.import_batch_id],[t('导入人','Imported By'),row.imported_by],
   [t('导入时间','Imported At'),row.imported_at&&BusinessTime.display(row.imported_at)]
  ].map(([label,value])=>[label,this.text(value)]));
 },
 async detail(id){
  const t=this.t,requested=new URLSearchParams(location.search).get('product');
  // Administrator records may be opened directly from a mixed-product import.
  const api='/historical-movements/'+id,options={headers:requested?{'X-Historical-Product':requested}:{}};
  const r=await API.request(api,options);
  this.page('历史导入记录','Historical Import Record','<div class="business-toolbar"><a class="button secondary" href="'+this.path+'">'+t('返回导入记录','Back to Imports')+
   '</a><button type="button" class="button secondary" id="historical-source">'+t('下载原文件','Download Source')+'</button></div>'+
   this.section('导入资料','Import Information',this.badge()+this.facts(r))+
    (r.documents?.length?this.section('关联单据','Related Documents',r.product_code!==ProductContext.code?
    '<p>'+t('请切换到对应产品后打开业务单据。','Switch to the matching product to open its business documents.')+'</p>':'<ol>'+this.links(r.documents)+'</ol>'+
    (!r.voided_at&&r.product_code===ProductContext.code&&this.canArea('inventory')?'<a class="button secondary" href="'+esc(this.stockPath({packing_list_no:r.document_no,batch_no:r.source_facts.batch_no}))+'">'+t('查看已出库库存','View Outbound Stock')+'</a>':'')):'')+
   this.section('原表明细','Source Lines',this.lines(r.rows,r.product_code))+
   (!r.voided_at?this.section('导入纠错','Import Correction','<form id="historical-void" class="user-form"><label>'+t('作废原因','Void Reason')+
    '<textarea name="reason" required minlength="5" maxlength="500"></textarea></label><button class="button danger-outline">'+t('作废该条历史单据','Void Historical Record')+'</button></form>'):
    this.section('作废记录','Void Record',this.text(r.void_reason)))+'<p id="historical-detail-error" class="error" role="alert"></p>',true);
  $('historical-source').onclick=async()=>{
   try{const file=await API.request(api+'/source',{...options,binary:true}),url=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=url;a.download=r.source_name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   catch(e){$('historical-detail-error').textContent=I18n.translate(e.message,true);}
  };
  if($('historical-void'))$('historical-void').onsubmit=async e=>{
   e.preventDefault();const button=e.submitter;button.disabled=true;
   try{if(await OperationConfirm.ask({title:t('作废此历史单据？','Void this historical document?')})){
    await API.request(api+'/void',{...options,method:'POST',body:Object.fromEntries(new FormData(e.target))});await this.detail(id);
   }}catch(error){$('historical-detail-error').textContent=I18n.translate(error.message,true);}finally{button.disabled=false;}
  };
 },
 listPath(area){return '/'+(area==='loading-plans'?'loading-plans/query':area==='stock-outbound'?'outbounds':area);},
 async document(area,id){
  const t=this.t,stock=area==='inventory',cu=ProductContext.isCopper(),q=new URLSearchParams(location.search),kind=this.kinds[area];
  const api=this.prefix()+'/historical-backfill';
  const row=await API.request(stock?api+'/stock/batch/'+id+'?'+new URLSearchParams({unit:q.get('unit')||''}):api+'/documents/'+id+'?kind='+kind);
  const title=stock?t(cu?'捆包详情档案':'批次详情档案',cu?'Bundle Detail Archive':'Batch Detail Archive'):this.kind(kind);
  const back=stock?this.stockPath():this.listPath(area);
  this.page(title,title,'<div class="inventory-archive"><div class="business-toolbar"><a class="button secondary" href="'+back+'">'+t('返回列表','Back to List')+'</a></div>'+
   this.section(stock?(cu?'捆包资料':'备货批次'):'单据资料',stock?(cu?'Bundle Information':'Preparation Batch'):'Document Information',
    '<h3>'+esc(stock?(cu?row.rows[0]?.unit_id:row.source_facts.batch_no):row.document_no)+'</h3>'+this.badge()+
    '<span class="s46-badge">'+(stock?t('已出库','Outbound'):t('历史归档','Archived'))+'</span>'+this.facts(row)+
    (kind==='RECEIPT'&&!row.original_receipt_date?'<p class="wms-feedback">'+t('历史补录记账日','Historical Posting Date')+' · '+esc(row.business_date)+'</p>':''))+
   this.section('关联单据','Related Documents','<ol>'+this.links(row.documents)+'</ol>'+
    (this.canImport()?this.recordLink(row.source_id,row.product_code,t('查看装箱单来源','View Source Packing List')):''))+
   this.section(cu?'逐捆明细':'逐袋明细',cu?'Bundle Details':'Bag Details',
    (stock&&!cu?'<form id="historical-unit-search" class="filters wms-filter-row"><label>'+t('袋号或铅封号','Bag or Seal No.')+
     '<input type="search" name="unit" maxlength="160" value="'+esc(q.get('unit')||'')+'"></label><button class="button primary">'+t('查询','Search')+'</button></form>':'')+
    this.lines(row.rows,row.product_code))+'</div>');
  if($('historical-unit-search'))$('historical-unit-search').onsubmit=e=>{e.preventDefault();Router.go(location.pathname+'?'+new URLSearchParams(new FormData(e.target)));};
 },
 install(){
  RoutePermissions.register('historical-movements',path=>/^\/(?:workbench\/)?historical-movements(?:\/|$)/.test(path),()=>this.canImport()?undefined:'__historical_admin_only');
  RoutePermissions.register('historical-documents',path=>this.documentRoute(path),path=>this.permission(path.split('/')[1]));
  Router.add(/^\/workbench\/historical-movements$/,()=>this.list());
  Router.add(/^\/workbench\/historical-movements\/([0-9a-f-]{36})$/,id=>this.detail(id));
  Router.add(/^\/historical-movements$/,()=>{history.replaceState(history.state,'',this.path+location.search);return this.list();});
  Router.add(/^\/historical-movements\/([0-9a-f-]{36})$/,id=>{history.replaceState(history.state,'',this.path+'/'+id+location.search);return this.detail(id);});
  Router.add(/^\/(receipts|loading-plans|outbounds|stock-outbound)\/historical$/,area=>Router.go(this.listPath(area)));
  Router.add(/^\/(receipts|loading-plans|outbounds|stock-outbound|inventory)\/historical\/([0-9a-f-]{36})$/,(area,id)=>this.document(area,id));
  const show=Router.performShow.bind(Router);
  Router.performShow=async(...args)=>{
   const path=location.pathname;
   if(!this.documentRoute(path)&&!path.startsWith(this.path)&&!path.startsWith('/historical-movements')){
    return show(...args);
   }
   if(/^\/(receipts|loading-plans|outbounds|stock-outbound)\/historical$/.test(path)){
    history.replaceState(history.state,'',this.listPath(path.split('/')[1]));
    return show(...args);
   }
   Router.current=path;Router.rendering=true;
   try{
    if(!System46.canRoute())throw Object.assign(Error(this.t('当前账号没有此页面权限','This account cannot access this page')),{statusCode:403});
    if(path.startsWith('/historical-movements'))history.replaceState(history.state,'','/workbench'+path+location.search);
    const [,area,,id]=location.pathname.split('/');
    if(area==='workbench'){
     if(id)await this.detail(id);else await this.list();
    }else await this.document(area,id);
    I18n.apply();window.scrollTo({top:0});
   }catch(error){
    System46.lastFailure={route:location.pathname+location.search,status:error.statusCode||0,message:error.message};
    Router.page(this.t('页面暂不可用','Page Unavailable'),System46.stateHTML(error.statusCode===403?'denied':'error'));
   }finally{
    Router.rendering=false;UnifiedNavigation.refresh();AdaptiveLayout.queue();
   }
  };
  const set=I18n.set.bind(I18n);
  I18n.set=language=>{
   const previous=I18n.language,result=set(language),path=location.pathname;
   if(previous!==I18n.language){
    if(path===this.path&&!this.busy)this.list({retain:true}).catch(e=>notify(I18n.translate(e.message,true)));
    else if(path.startsWith(this.path+'/')||this.documentRoute(path))Router.show();

   }
   return result;
  };
 }
};
