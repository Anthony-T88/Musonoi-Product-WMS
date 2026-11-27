'use strict';
window.HistoricalMovements={
 t:(zh,en)=>I18n.label(zh,en),
 path:'/workbench/historical-movements',
 kinds:{receipts:'RECEIPT','loading-plans':'LOADING_PLAN',outbounds:'LOADING_ORDER','stock-outbound':'OUTBOUND'},
 queue:[],
 status(kind){
  const states={ready:['可导入','Ready to Import'],review:['待管理员复核','Admin Review Required'],imported:['导入成功','Imported'],duplicate:['已导入','Already Imported'],correction:['待修正','Needs Correction'],retry:['写入失败，可重试','Write Failed, Retry'],voided:['已作废','Voided'],legacy:['旧版台账','Legacy Ledger']};
  return '<span class="wms-import-status" data-import-state="'+kind+'">'+this.t(...states[kind])+'</span>';
 },
 canImport:()=>CurrentUser.role_code==='admin',
 prefix:()=>ProductContext.isCopper()?'':'/cobalt',
 product(code){return this.t(...(code==='CU_CATHODE'?['阴极铜','Copper Cathodes']:code==='CO_HYDROXIDE'?['氢氧化钴','Cobalt Hydroxide']:['—','—']));},
 badge(){return '<span class="s46-badge">'+this.t('历史导入数据','Historical Import')+'</span>';},
 text(v){return esc(v==null||v===''?'—':v);},
 weight(kg){return kg==null?'—':Tonnes.format(Tonnes.fixed(Tonnes.scaled(String(kg),9)/1000n,9));},
 section(zh,en,body){return '<section class="panel wms-section"><h2>'+this.t(zh,en)+'</h2>'+body+'</section>';},
 table(head,rows,numeric=[],server=false){
  if(!rows.length)return System46.stateHTML('empty');
  return '<div class="business-table">'+UI46Pages.table('<table'+(server?' data-v34-server="true"':'')+'><thead><tr>'+head.map(label=>'<th scope="col">'+esc(label)+'</th>').join('')+
   '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table>',{numeric})+'</div>';
 },
 message(code){
  const labels={
   SHIPPING_DATE_MISSING:['请填写发运日期','Enter the shipping date'],SHIPPING_DATE_INVALID:['发运日期格式无效，请使用 YYYY-MM-DD','Enter a valid shipping date in YYYY-MM-DD format'],
   SHIPPING_DATE_FUTURE:['发运日期晚于卢本巴希当前日期','Shipping date is later than today in Lubumbashi'],
   SHIPPING_DATE_AMBIGUOUS:['发运日期字段重复','More than one shipping date field'],RECEIPT_AFTER_SHIPPING:['原始入库日期晚于发运日期','Original receipt is later than shipping'],
   FORMAL_DOCUMENT_CONFLICT:['与现有正式单据冲突','Conflicts with a formal document'],DOCUMENT_CONFLICT:['已存在同号历史单据','A historical document with this number already exists'],
   UNIT_CONFLICT:['编号已关联其他单据','Identifier already linked to another document'],UNIT_MISSING:['缺少编号','Missing identifier'],DUPLICATE_UNIT:['单内编号重复','Duplicate identifier'],
   DUPLICATE_SEAL:['单内铅封号重复','Duplicate seal in the file'],SEAL_CONFLICT:['铅封号已关联其他单据','Seal already linked to another document'],
   EXCEPTION_REASON_REQUIRED:['请填写 5 至 500 字的复核原因','Enter a review reason of 5 to 500 characters'],
   INVALID_SHEETS:['片数须为 1 至 100000 的整数','Sheet count must be a whole number between 1 and 100,000'],
   INVALID_WEIGHT:['重量缺失或无效','Missing or invalid weight'],
   NET_WEIGHT_INVALID:['净重须为大于 0 的 kg 数值','Net weight must be a positive value in kg'],
   GROSS_WEIGHT_INVALID:['毛重须为大于 0 的 kg 数值','Gross weight must be a positive value in kg'],
   GROSS_BELOW_NET:['毛重小于净重','Gross weight is less than net weight'],
   SOURCE_TOTAL_MISMATCH:['原单合计与明细不符','Source total does not match the detail rows'],
   TOTAL_ROW_MISSING:['请在明细下方的 A 列填写 TOTAL 作为合计行','Add a totals row marked TOTAL in column A below the detail rows'],
   DOCUMENT_NO_MISSING:['请填写有效的装箱单号','Enter a valid packing list number'],BATCH_NO_MISSING:['请填写有效的备货批次','Enter a valid preparation lot number'],
   DETAILS_MISSING:['第 30 行起未找到捆包或袋明细','No bundle or bag detail rows were found from row 30'],
   INVALID_WORKBOOK:['工作簿格式或表头无效','Invalid workbook format or headers'],
   FILE_TYPE_INVALID:['文件名或扩展名无效，请选用 XLS 或 XLSX 工作簿','Invalid file name or extension. Choose an XLS or XLSX workbook.'],
   FILE_ENCODING_INVALID:['文件数据不完整或超过大小限制，请重新选择文件','File data is incomplete or exceeds the size limit. Select the file again.'],
   FILE_FORMAT_MISMATCH:['文件内容与扩展名不匹配，请用 Excel 重新另存为 XLS 或 XLSX','The file content does not match its extension. Save it again as XLS or XLSX in Excel.'],
   WORKBOOK_ARCHIVE_INVALID:['XLSX 结构无效或含不支持的组件，请使用标准模板重新另存','The XLSX archive is invalid or contains unsupported components. Save it again using the standard template.'],
   WORKBOOK_UNREADABLE:['无法读取工作簿，请用 Excel 打开检查并重新保存','Could not read the workbook. Open it in Excel and save it again.'],
   WORKBOOK_STRUCTURE_INVALID:['请移除宏，并将工作表数量减至 16 张以内','Remove macros and keep no more than 16 worksheets.'],
   PACKING_SHEET_MISSING:['缺少 PL 装箱单工作表，请检查工作表名称','The PL packing list worksheet is missing. Check the worksheet name.'],
   HEADER_MISMATCH:['表头与装箱单模板不一致','Header does not match the packing list template'],
   TEMPLATE_PRODUCT_MISMATCH:['装箱单产品与所选产品不一致','The packing list product does not match the selected product'],
   FILE_TOO_LARGE:['单份文件不能超过 512 KB','Each file must be 512 KB or smaller'],
   FILE_READ_FAILED:['无法读取文件。若文件仅存于网盘，请先下载或设为离线可用，再重新选择。','Could not read the file. If it is online-only, download it or make it available offline, then select it again.'],
   HISTORY_SCOPE:['仓库不在授权范围内','Warehouse is outside your scope'],REVIEW_REQUIRED:['数据已变化，请重新预览','Data changed. Preview again.'],
   PREVIEW_FAILED:['预览服务暂不可用，请重试','Preview is temporarily unavailable. Retry.'],
   IMPORT_WRITE_FAILED:['整张已回滚，可重试','The entire file was rolled back. Retry.']
  };
  return labels[code]?this.t(...labels[code]):this.t('无法处理文件','File could not be processed');
 },
 issueText(issue){
  const t=this.t,{code,cell,cells,other_cell,value,expected,references,different_fields}=issue;
  const display=value=>value==null||value===''?t('空白','blank'):value;
  const location=cells?.length?cells.join('、'):cell;
  const message=(location?location+' · ':'')+this.message(code);
  if(code==='HEADER_MISMATCH')return message+t('。应为 ','. Expected ')+expected+t('，当前为 ','. Found ')+display(value);
  if(code==='SOURCE_TOTAL_MISMATCH'){
   const weight=issue.field==='net_kg'?t('净重','Net weight'):t('毛重','Gross weight');
   return message+' · '+weight+t('原单 ',' on the source ')+Number(value)+' kg'+t('，明细合计 ','. Detail rows total ')+Number(expected)+' kg';
  }
  if(code==='GROSS_BELOW_NET')return message+' · '+Number(value)+' kg < '+other_cell+' '+Number(expected)+' kg';
  if(code==='SHIPPING_DATE_FUTURE')return message+' · '+value+t('，当天日期 ','. Today is ')+expected;
  if(code==='RECEIPT_AFTER_SHIPPING')return message+' · '+value+' > '+other_cell+' '+expected;
  if(code==='DUPLICATE_UNIT'||code==='DUPLICATE_SEAL')return message+' · '+t('另见 ','See also ')+other_cell;
  if(code==='DOCUMENT_CONFLICT'){
   const fields={content:t('原文件或明细','source file or details'),shipping_date:t('发运日期','shipping date'),warehouse:t('归档仓库','archive warehouse')};
   return message+' · '+value+t('。请核对不一致的','. Check the differing ')+different_fields.map(key=>fields[key]).join(t('、',', '));
  }
  if(references?.length)return message+' · '+t('关联编号 ','Related references ')+references.join(' / ');
  if(value!==undefined&&!['SHIPPING_DATE_AMBIGUOUS','SHIPPING_DATE_MISSING'].includes(code))
   return message+' · '+t('原值 ','Found ')+display(value);
  return message;
 },
 uploadError(error,confirm=false){
  if(error.statusCode===413)return this.t('本次上传总大小超过服务器限制。请减少每次选择的文件数后重试。','This upload exceeds the server limit. Select fewer files at a time and retry.');
  if(error.uncertain)return this.t('连接中断，导入结果待确认。请查看导入记录，再重试尚未导入的文件。','Connection interrupted. Check the import records before retrying any files that were not imported.');
  if(!confirm&&!error.statusCode)return this.t('未收到预览结果。请检查网络连接后重新预览。','No preview was received. Check your connection and preview again.');
  return I18n.translate(error.message,true);
 },
 kind(code){
  const labels={RECEIPT:['历史入库单','Historical Receipt'],LOADING_PLAN:['历史装车计划','Historical Loading Plan'],
   LOADING_ORDER:['历史装车单','Historical Loading Order'],OUTBOUND:['历史出库单','Historical Stock Issue Order']};
  return this.t(...labels[code]);
 },
 documentRoute(path){return /^\/(receipts|loading-plans|outbounds|stock-outbound|inventory)\/historical(?:\/[0-9a-f-]{36})?$/.test(path);},
 permission(area){
  if(area==='stock-outbound'&&!ProductContext.isCopper()){
   const permission=CobaltMetal.outboundPermission();
   if(permission)return permission;
  }
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
 links(documents,{current,stock,source}={}){
  const t=this.t,entries=documents.filter(doc=>doc.id!==current).map(doc=>{
   const area=Object.keys(this.kinds).find(key=>this.kinds[key]===doc.kind);
   return {label:this.kind(doc.kind),code:doc.document_no,href:this.canArea(area)?'/'+area+'/historical/'+doc.id:null};
  });
  if(stock&&this.canArea('inventory'))entries.push(stock);
  if(source&&this.canImport())entries.push(source);
  if(!entries.length)return '';
  return '<ul class="wms-historical-links">'+entries.map(({label,code,href})=>{
   const data='<span>'+esc(label)+'</span><small>'+this.text(code)+'</small>';
   return '<li>'+(href?'<a href="'+esc(href)+'">'+data+'<span class="wms-history-arrow" aria-hidden="true">→</span></a>':'<span>'+data+'</span>')+'</li>';
  }).join('')+'</ul>';
 },
 navigationState(target,replace){
  if(!this.documentRoute(target.pathname)&&!target.pathname.startsWith(this.path+'/'))return {};
  if(target.pathname===location.pathname)return {historicalReturn:history.state?.historicalReturn||null};
  if(replace)return {};
  return {historicalReturn:{url:location.pathname+location.search+location.hash,product:ProductContext.code}};
 },
 back(fallback,zh='返回列表',en='Back to List'){
  const entry=history.state?.historicalReturn,back=entry?.product===ProductContext.code&&entry.url;
  return '<a class="button secondary" data-wms-back '+(back?'data-historical-back ':'')+'href="'+esc(back||fallback)+'">'+
   (back?this.t('返回上一页','Back'):this.t(zh,en))+'</a>';
 },
 followReturn(){
  const link=document.querySelector('[data-historical-back]');
  if(link)link.onclick=event=>{if(event.button===0&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();event.stopPropagation();history.back();}};
 },
 archiveLink(row){
  const cu=row.product_code==='CU_CATHODE',unit=cu?row.rows?.[0]:null;
  if(!row.quantity||cu&&!unit||!this.canArea('inventory'))return null;
  return {label:this.t(cu?'捆包详情档案':'批次详情档案',cu?'Bundle Detail Archive':'Lot Detail Archive'),
   code:cu?unit.unit_id:row.source_facts?.batch_no,href:'/inventory/historical/'+(cu?unit.id:row.source_id)};
 },
 page(zh,en,body,admin=false){
  const title=this.t(zh,en);
  Router.page(title,'<div data-page-composed data-no-i18n data-historical-page>'+
   (admin?'<nav aria-label="'+this.t('面包屑','Breadcrumb')+'" class="wms-history-breadcrumb"><a href="/workbench">'+this.t('系统管理','System Administration')+'</a><span aria-hidden="true">›</span><span aria-current="page">'+this.t('历史出入库导入','Historical Stock Imports')+'</span></nav>':'')+body+'</div>');
 },
 async list({retain=false}={}){
  const t=this.t,q=new URLSearchParams(location.search);
  const [data,warehouses]=await Promise.all([this.records(q),API.request('/historical-movements/destinations')]);
  if(!retain){this.queue=[];this.warehouse='';}
  const fields=[['batch_no','批次号','Batch No.','search'],['document_no','装箱单号','Packing List No.','search'],
   ['business_date','业务日期','Business Date','date'],['from','起始日期','From','date'],['to','截止日期','To','date']];
  const filter='<form id="historical-filter" class="filters wms-filter-row"><div class="form-grid">'+fields.map(([name,zh,en,type])=>
   '<label>'+t(zh,en)+'<input type="'+type+'" name="'+name+'" '+(type==='search'?'maxlength="160" ':'')+'value="'+esc(q.get(name)||'')+'"></label>').join('')+
   '<label>'+t('单据状态','Document Status')+'<select name="state">'+[['',t('全部','All')],['ACTIVE',t('有效','Active')],['VOIDED',t('已作废','Voided')]].map(([state,label])=>
   '<option value="'+state+'"'+(q.get('state')===state?' selected':'')+'>'+label+'</option>').join('')+'</select></label></div>'+
   '<div class="wms-filter-actions"><button type="submit" class="button primary">'+t('查询','Search')+'</button><a class="button secondary" data-wms-reset href="'+this.path+'">'+t('重置','Reset')+'</a></div></form>';
  this.page('历史出入库导入','Historical Stock Imports',this.section('上传装箱单','Upload Packing Lists',
   '<form id="historical-upload" class="user-form wms-import-upload" data-wms-validation><div class="form-grid wms-field-grid">'+
   '<label class="wms-field">'+t('归档仓库','Archive Warehouse')+'<select name="warehouse_id" required>'+
   warehouses.map(w=>'<option value="'+esc(w.id)+'">'+esc(w.project_name+' / '+w.name)+'</option>').join('')+'</select></label>'+
   '<label class="wms-field">'+t('装箱单（XLS 或 XLSX）','Packing Lists (XLS or XLSX)')+
   '<input required multiple type="file" name="source" accept=".xls,.xlsx"></label></div><div class="wms-filter-actions">'+
   '<button class="button primary" '+(warehouses.length?'':'disabled')+'>'+t('预览装箱单','Preview Packing Lists')+'</button></div></form>'+
   '<p id="historical-progress" class="wms-feedback" role="status"></p>'+
   '<p id="historical-upload-error" class="error" role="alert">'+(warehouses.length?'':t('当前账号没有可用的归档仓库。','No archive warehouse is available.'))+'</p>'+
   '<div id="historical-preview" aria-live="polite"></div>')+
   this.section('导入记录','Import Records',filter+'<div id="historical-ledger"></div>'),true);
  this.renderLedger(data,q);
  const form=$('historical-upload');
  if(this.warehouse)form.elements.warehouse_id.value=this.warehouse;
  for(const name of ['source','warehouse_id'])form.elements[name].onchange=()=>{this.queue=[];this.showQueue();};
  form.onsubmit=e=>{e.preventDefault();return this.read([...form.elements.source.files],form.elements.warehouse_id.value,form);};
  $('historical-filter').onsubmit=e=>{e.preventDefault();Router.go(this.path+'?'+new URLSearchParams(new FormData(e.target)));};
  this.showQueue();
 },
 records(q){
  const query=new URLSearchParams(q);
  query.set('page_size',RowsPerPage.read('historical-ledger',RowsPerPage.standard,q.get('page_size')));
  query.set('all_products','1');
  return API.request('/historical-movements?'+query);
 },
 async refreshLedger(box){
  const q=new URLSearchParams(location.search);
  let data=await this.records(q);
  if(!box.isConnected)return;
  if(!data.items.length&&data.page>1){
   q.set('page',Math.max(1,Math.ceil(data.total/data.page_size)));
   data=await this.records(q);
   if(!box.isConnected)return;
   history.replaceState(history.state,'',this.path+'?'+q);
  }
  this.renderLedger(data,q);
 },
 renderLedger(data,q){
  const box=$('historical-ledger'),t=this.t;
  box.innerHTML=this.ledger(data,q);
  $('historical-page-size').onchange=e=>{
   const size=Number(e.target.value),next=new URLSearchParams(q);
   RowsPerPage.remember('historical-ledger',size);
   next.set('page_size',size);next.delete('page');
   Router.go(this.path+'?'+next);
  };
  const all=$('historical-void-all'),button=$('historical-bulk-void');
  if(!button)return;
  const inputs=[...box.querySelectorAll('[data-historical-select]')],selected=()=>inputs.filter(input=>input.checked);
  let working=false;
  const sync=()=>{
   const count=selected().length;
   button.disabled=working||count===0;
   all.disabled=working;
   all.checked=count===inputs.length;
   all.indeterminate=count>0&&count<inputs.length;
   $('historical-void-count').textContent=t('已选 '+count+' 份','Selected '+count);
   for(const input of inputs)input.disabled=working;
  };
  all.onchange=()=>{for(const input of inputs)input.checked=all.checked;sync();};
  for(const input of inputs)input.onchange=sync;
  button.onclick=async()=>{
   if(this.voiding)return;
   const ids=selected().map(input=>input.value),error=$('historical-bulk-error');
   this.voiding=working=true;sync();error.textContent='';
   let reason='';
   try{
    if(!await OperationConfirm.ask({title:t('批量作废所选历史单据？','Void selected historical documents?'),
     rows:[[t('单据数','Documents'),ids.length]],comment:true,commentRequired:true,commentMax:500,
     commentLabel:t('作废原因（至少五个字符）','Void Reason (at least five characters)'),onComment:value=>reason=value}))return;
    if(reason.length<5)throw Error(t('作废原因至少需要五个字符。','Enter a void reason of at least five characters.'));
    const result=await API.request('/historical-movements/batch/void',{method:'POST',body:{ids,reason}});
    this.voidChannel?.postMessage(result.products);
    if(box.isConnected)await this.refreshLedger(box);
    notify(t('已作废 '+result.count+' 份历史单据','Voided '+result.count+' historical documents'));
   }catch(e){if(error.isConnected)error.textContent=e.uncertain?t('暂未确认作废结果，请查询单据状态。','The void result is pending. Check the document status.'):I18n.translate(e.message,true);}
   finally{this.voiding=working=false;if(button.isConnected)sync();}
  };
  sync();
 },
 ledger(data,q){
  const t=this.t;
  const selectable=data.items.some(r=>!r.voided_at);
  const pager=(page,label)=>{const next=new URLSearchParams(q);next.set('page',page);return '<a class="button secondary compact" href="'+this.path+'?'+esc(next)+'">'+label+'</a>';};
  const actions=selectable?'<div class="wms-action-bar"><div class="wms-history-selection"><label><input type="checkbox" id="historical-void-all">'+t('选择本页有效单据','Select Active Documents on This Page')+'</label>'+
   '<span id="historical-void-count" class="wms-feedback" role="status"></span></div><div class="wms-filter-actions"><button id="historical-bulk-void" type="button" class="button danger-outline" disabled>'+t('批量作废','Void Selected')+'</button></div></div><p id="historical-bulk-error" class="wms-feedback error" role="alert"></p>':'';
  return actions+this.table([...(selectable?[t('选择','Select')]:[]),t('装箱单号','Packing List No.'),t('产品','Product'),t('业务日期','Business Date'),t('备货批次','Preparation Batch'),t('数量','Quantity'),t('净重（吨）','Net Weight (MT)'),t('状态','Status'),t('操作','Action')],
   data.items.map(r=>[...(selectable?[r.voided_at?'—':'<input type="checkbox" data-historical-select value="'+esc(r.id)+'" aria-label="'+esc(t('选择 ','Select ')+r.document_no)+'">']:[]),
    esc(r.document_no),this.product(r.product_code),esc(r.business_date),this.text(r.source_facts.batch_no),CountValues.display(r.quantity),this.weight(r.net_kg),
   this.status(r.voided_at?'voided':r.import_batch_id?'imported':'legacy'),this.recordLink(r.id,r.product_code,t('查看','View'))]),selectable?[5,6]:[4,5],true)+
   '<nav class="co-pager historical-pagination" aria-label="'+t('导入记录分页','Import Record Pagination')+'">'+
   (data.page>1?pager(data.page-1,t('上一页','Previous')):'<button class="button secondary compact" disabled>'+t('上一页','Previous')+'</button>')+
   '<span>'+data.page+' / '+Math.max(1,Math.ceil(data.total/data.page_size))+' · '+data.total+'</span>'+
   '<select id="historical-page-size" aria-label="'+t('每页行数','Rows per page')+'">'+RowsPerPage.standard.map(size=>
    '<option value="'+size+'"'+(size===data.page_size?' selected':'')+'>'+size+'</option>').join('')+'</select>'+
   (data.has_next?pager(data.page+1,t('下一页','Next')):'<button class="button secondary compact" disabled>'+t('下一页','Next')+'</button>')+'</nav>';
 },
 async read(files,warehouse,form,replaceIndex){
  if(this.busy)return;
  const t=this.t,error=$('historical-upload-error');
  if(!files.length||files.length>20){error.textContent=t('请选择 1 至 20 份装箱单。','Select 1 to 20 packing lists.');return;}
  const progress=$('historical-progress');
  progress.textContent=t('正在读取并校验装箱单…','Reading and validating packing lists…');
  this.busy=true;this.warehouse=warehouse;form.querySelectorAll('input,select,button').forEach(n=>n.disabled=true);error.textContent='';
  const uploaded=[];
  try{
   for(const file of files){
    if(file.size>524288){uploaded.push({name:file.name,preview:{code:'FILE_TOO_LARGE'}});continue;}
    let buffer;
    try{buffer=await file.arrayBuffer();}catch{
     uploaded.push({name:file.name,preview:{code:'FILE_READ_FAILED'}});continue;
    }
    const bytes=new Uint8Array(buffer);let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    uploaded.push({name:file.name,body:{file_name:file.name,file_base64:btoa(binary),warehouse_id:warehouse}});
   }
   const valid=uploaded.filter(row=>row.body);
   if(valid.length){
    const result=await API.request('/historical-movements/batch/preview',{method:'POST',timeoutMs:120000,body:{files:valid.map(row=>row.body)}});
    for(const row of result.results)valid[row.index].preview=row;
   }
   if(!form.isConnected)return;
   if(replaceIndex===undefined)this.queue=uploaded;else this.queue.splice(replaceIndex,1,uploaded[0]);
  }catch(e){if(form.isConnected)error.textContent=this.uploadError(e);}
  finally{
   this.busy=false;
   if(form.isConnected){progress.textContent='';form.querySelectorAll('input,select,button').forEach(n=>n.disabled=false);this.showQueue();}
  }
 },
 showQueue(){
  const box=$('historical-preview');if(!box)return;
  const t=this.t,queue=this.queue,form=$('historical-upload');
  if(!queue.length){box.replaceChildren();return;}
  const pending=queue.filter(row=>row.preview?.importable&&(!row.result||row.result.code==='IMPORT_WRITE_FAILED'));
  const canReview=row=>row.preview?.reviewable&&(!row.result||['IMPORT_WRITE_FAILED','EXCEPTION_REASON_REQUIRED'].includes(row.result.code));
  box.innerHTML='<h3>'+t('批量导入预览','Batch Import Preview')+'</h3>'+queue.map((row,index)=>{
   const {name,preview:p,result}=row;
   const id=result?.id||p?.already_imported,product=p?.product_code;
   const validation=result?.issues||result?.issue_details?result:p;
   const details=validation?.issue_details||[],shown=new Set(details.map(issue=>issue.code));
   if(shown.has('SHIPPING_DATE_FUTURE'))shown.add('SHIPPING_DATE_INVALID');
   const review=[...details.map(issue=>this.issueText(issue)),...(validation?.issues||[]).filter(code=>!shown.has(code)).map(code=>this.message(code))];
   const code=result?.code||p?.code;
   if(code&&!shown.has(code))review.push(this.message(code));
   if(['INVALID_WORKBOOK','WORKBOOK_ARCHIVE_INVALID'].includes(code)&&!I18n.usesEnglish&&p?.error)review.push(p.error);
   const lines=result?.rows?.length?result.rows:p?.rows;
   const flagged=(lines||[]).filter(line=>line.flags?.length);
   if(flagged.length){
    const lineNumbers=flagged.slice(0,5).map(line=>line.source_row).join(t('、',', '));
    review.push(t('发现 '+flagged.length+' 条明细异常，见原表第 '+lineNumbers+(flagged.length>5?' 等':'')+' 行。',flagged.length+' detail rows flagged. See source '+(flagged.length===1?'row ':'rows ')+lineNumbers+(flagged.length>5?' and others':'')+'.'));
   }
   const status=id?(result?.status==='IMPORTED'?'imported':'duplicate'):
    p?.importable&&!result?'ready':canReview(row)?'review':result?.code==='IMPORT_WRITE_FAILED'?'retry':'correction';
   const facts=[this.product(product),p?.business_date,p?.document_no,p?.batch_no,
    p?.totals?CountValues.display(p.totals.quantity)+' '+t('件','units')+' / '+this.weight(p.totals.net_kg)+' MT':null]
    .filter(value=>value&&value!=='—');
   return '<details class="panel wms-section wms-import-file" data-history-file="'+index+'"'+(queue.length===1||review.length||canReview(row)?' open':'')+'><summary>'+
    '<span class="wms-import-filename">'+esc(name)+'</span>'+this.status(status)+'</summary>'+
    (facts.length?'<p class="wms-import-facts">'+facts.map(esc).join(' · ')+'</p>':'')+
    (review.length?'<div class="error" role="status"><ul>'+review.map(message=>'<li>'+esc(message)+'</li>').join('')+'</ul></div>':'')+
    (lines?.length?this.lines(lines,product):'')+
    (canReview(row)?'<div class="business-toolbar"><button type="button" class="button secondary" data-history-review="'+index+'" '+(this.busy?'disabled':'')+'>'+t('复核并导入','Review and Import')+'</button></div>':'')+
   (id?'<div class="business-toolbar">'+this.recordLink(id,product,t('查看导入记录','View Import Record'))+
    (product===ProductContext.code&&this.canArea('inventory')&&p?.accepted_quantity?'<a class="button secondary compact" href="'+esc(this.stockPath({packing_list_no:p.document_no,batch_no:p.batch_no}))+'">'+t('查看已出库库存','View Issued Stock')+'</a>':'')+'</div>':
     '<label class="wms-field">'+t('单独重传此文件','Replace This File')+'<input type="file" accept=".xls,.xlsx" data-historical-replace="'+index+'"></label>')+
    '</details>';
  }).join('')+'<div class="wms-filter-actions"><button type="button" class="button primary" id="historical-confirm">'+t('确认导入合格文件','Import Valid Files')+' ('+pending.length+')'+
   '</button></div>';
  for(const input of box.querySelectorAll('[data-historical-replace]'))input.onchange=()=>this.read([...input.files],form.elements.warehouse_id.value,form,Number(input.dataset.historicalReplace));
  const button=$('historical-confirm'),progress=$('historical-progress');
  button.disabled=this.busy||!pending.length;
  const submit=async(files,review)=>{
   if(this.busy)return;
   button.disabled=true;this.busy=true;
   let reason='';
   try{
    const options=review?{title:t('确认复核后导入？','Import after review?'),
     rows:[[t('装箱单号','Packing List No.'),files[0].preview.document_no],
      [t('计入库存追溯的明细','Lines included in stock history'),CountValues.display(files[0].preview.accepted_quantity)],
      [t('仅保留原表记录的明细','Lines kept in the source record only'),CountValues.display(files[0].preview.totals.quantity-files[0].preview.accepted_quantity)]],
     comment:true,commentRequired:true,commentMax:500,commentValue:files[0].exceptionReason,
     commentLabel:t('复核原因','Review Reason'),onComment:value=>{reason=value.trim();files[0].exceptionReason=reason;}}
     :{title:t('确认导入合格装箱单？','Import validated packing lists?')};
    if(!await OperationConfirm.ask(options))return;
    if(review&&(reason.length<5||reason.length>500)){$('historical-upload-error').textContent=this.message('EXCEPTION_REASON_REQUIRED');return;}
    $('historical-upload-error').textContent='';
    progress.textContent=t('正在导入，请等待每份文件的结果…','Importing. Wait for each file’s result…');
    for(const input of form.elements)input.disabled=true;
    for(const input of box.querySelectorAll('[data-historical-replace],[data-history-review]'))input.disabled=true;
    const response=await API.request('/historical-movements/batch/confirm',{method:'POST',timeoutMs:120000,body:{files:files.map(row=>({...row.body,preview_token:row.preview.preview_token,...(review?{exception_reason:reason}:{})}))}});
    for(const result of response.results){files[result.index].result=result;if(result.id)delete files[result.index].body;}
    if(box.isConnected){
     if(box.isConnected)await this.refreshLedger($('historical-ledger'));
    }
   }catch(e){if(box.isConnected)$('historical-upload-error').textContent=this.uploadError(e,true);}
   finally{this.busy=false;if(box.isConnected){progress.textContent='';for(const input of form.elements)input.disabled=false;this.showQueue();}}
  };
  button.onclick=()=>submit(pending,false);
  for(const review of box.querySelectorAll('[data-history-review]'))review.onclick=()=>submit([queue[Number(review.dataset.historyReview)]],true);
 },
 unitLines(rows,product,linkUnits){
  const t=this.t,cu=product==='CU_CATHODE',link=cu&&linkUnits&&this.canArea('inventory');
  return this.table([t(cu?'捆包号':'袋号',cu?'Bundle No.':'Bag No.'),t('铅封号','Seal No.'),
   ...(cu?[t('捆包片数','Sheets')]:[]),t('毛重（吨）','Gross (MT)'),t('净重（吨）','Net (MT)')],
   rows.map(r=>[link?'<a href="/inventory/historical/'+esc(r.id)+'">'+this.text(r.unit_id)+'</a>':this.text(r.unit_id),
    this.text(r.seal_no),...(cu?[CountValues.display(r.sheets_count)]:[]),this.weight(r.gross_kg),this.weight(r.net_kg)]),
   cu?[2,3,4]:[2,3]);
 },
 summary(row,area){
  const t=this.t,cu=row.product_code==='CU_CATHODE',f=row.source_facts||{},stock=area==='inventory',unit=stock&&cu?row.rows[0]:null;
  const field=(zh,en,value)=>[t(zh,en),this.text(value)];
  const lot=field('备货批次号','Preparation Lot Number',f.batch_no);
  const shipment=field('发运日期','Shipping Date',row.shipping_date);
  const party=[field('客户','Customer',f.customer),field('合同号','Contract No.',f.contract_no),lot];
  const totals=[field(cu?'捆包数':'吨包袋数',cu?'Bundles':'Bulk Bags',CountValues.display(row.quantity)),
   [t('净重（吨）','Net Weight (MT)'),this.weight(row.net_kg)]];
  const truck=field('车牌','Truck Plate',f.truck),trailer=field('挂车','Trailers',[f.trailer_one,f.trailer_two].filter(Boolean).join(' / '));
  const packing=field('装箱单号','Packing List No.',row.packing_list_no);
  if(area==='receipts')return [field('仓库','Warehouse',row.warehouse_name),field('原入库日期','Original Receipt Date',row.original_receipt_date),
   ...(row.original_receipt_date?[]:[field('历史补录记账日','Historical Posting Date',row.business_date)]),lot,...totals];
  if(area==='loading-plans')return [packing,field('计划发运日期','Planned Shipping Date',row.shipping_date),...party,truck];
  if(area==='outbounds')return [packing,shipment,...party,truck,trailer,field('运输商','Transporter',f.transporter),...totals];
  if(!stock)return [shipment,packing,...party,truck,...totals];
  if(!cu)return [...party,...totals,field('预计钴金属量（MT）','Estimated Cobalt (MT)',row.estimated_mt),
   field('ARECOMS 实际确认量（MT）','ARECOMS Confirmed (MT)',null)];
  return [field('捆包号','Bundle No.',unit?.unit_id),...party,field('捆包片数','Sheets',CountValues.display(unit?.sheets_count)),
   field('铅封号','Seal No.',unit?.seal_no),[t('净重（吨）','Net Weight (MT)'),this.weight(unit?.net_kg)]];
 },
 lines(rows,product){
  const t=this.t,cu=product==='CU_CATHODE';
  return this.table([t('原表行','Source Row'),t(cu?'捆包号':'袋号',cu?'Bundle No.':'Bag No.'),t('铅封号','Seal No.'),
   ...(cu?[t('片数','Sheets')]:[]),t('毛重（吨）','Gross (MT)'),t('净重（吨）','Net (MT)'),t('校验','Validation')],
   rows.map(r=>[r.source_row,this.text(r.unit_id),this.text(r.seal_no),...(cu?[CountValues.display(r.sheets_count)]:[]),
    this.weight(r.gross_kg),this.weight(r.net_kg),this.text(this.lineIssues(r).join(' · '))]),
   cu?[0,3,4,5]:[0,3,4]);
 },
 lineIssues(row){
  const t=this.t,details=row.issue_details||[],shown=new Set(details.map(issue=>issue.code));
  if(['NET_WEIGHT_INVALID','GROSS_WEIGHT_INVALID','GROSS_BELOW_NET'].some(code=>shown.has(code)))shown.add('INVALID_WEIGHT');
  const messages=details.map(issue=>this.issueText(issue));
  for(const code of row.flags||[]){
   if(shown.has(code))continue;
   if(code==='UNIT_CONFLICT'||code==='SEAL_CONFLICT'){
    const seal=code==='SEAL_CONFLICT';
    messages.push(this.issueText({code,cell:'PL!'+(seal?'E':'C')+row.source_row,references:seal?row.seal_conflicts:row.conflicts}));
   }else messages.push(this.message(code));
  }
  if(row.excluded)messages.push(t('仅保留原表记录','Source record only'));
  return messages;
 },
 facts(row){
  const t=this.t,f=row.source_facts||row;
  return UI46Pages.factList([
   [t('产品','Product'),this.product(row.product_code)],[t('装箱单号','Packing List No.'),row.packing_list_no||row.document_no],
   [t('备货批次号','Preparation Lot Number'),f.batch_no],[t('发运日期','Shipping Date'),row.shipping_date||f.shipping_date],
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
  this.page('装箱单来源','Packing List Source',UI46Pages.identity(r.document_no,this.badge()+this.status(r.voided_at?'voided':'imported'),
   this.back(this.path,'返回导入记录','Back to Imports')+
   '<button type="button" class="button secondary" id="historical-source">'+t('下载原文件','Download Source')+'</button>','')+
   this.section('导入资料','Import Information',this.facts(r))+
    (!r.voided_at&&r.documents?.length?this.section('关联单据','Related Documents',r.product_code!==ProductContext.code?
    '<p>'+t('请切换到对应产品后打开业务单据。','Switch to the matching product to open its business documents.')+'</p>':this.links(r.documents,{
    stock:!r.voided_at&&r.quantity?{label:t('查看已出库库存','View Issued Stock'),code:r.source_facts?.batch_no,
     href:this.stockPath({packing_list_no:r.document_no,batch_no:r.source_facts?.batch_no})}:null
   })):'')+
   (r.exception_review?this.section('管理员复核','Administrator Review',UI46Pages.factList([
    [t('复核原因','Review Reason'),this.text(r.exception_review.reason)],
    [t('计入库存追溯的明细','Lines included in stock history'),CountValues.display(r.exception_review.accepted_quantity)]])):'')+
   this.section('原表明细','Source Lines',this.lines(r.rows,r.product_code))+
   (!r.voided_at?this.section('导入纠错','Import Correction','<form id="historical-void" class="user-form"><label>'+t('作废原因','Void Reason')+
    '<textarea name="reason" required minlength="5" maxlength="500"></textarea></label><div class="wms-filter-actions"><button class="button danger-outline">'+t('作废该条历史单据','Void Historical Record')+'</button></div></form>'):
    this.section('作废记录','Void Record',UI46Pages.factList([
     [t('作废人','Voided By'),this.text(r.voided_by)],
     [t('作废时间','Voided At'),this.text(BusinessTime.display(r.voided_at))],
     [t('作废原因','Void Reason'),this.text(r.void_reason)]])))+'<p id="historical-detail-error" class="error" role="alert"></p>',true);
  this.followReturn();
  $('historical-source').onclick=async()=>{
   try{const file=await API.request(api+'/source',{...options,binary:true}),url=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=url;a.download=r.source_name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   catch(e){$('historical-detail-error').textContent=I18n.translate(e.message,true);}
  };
  if($('historical-void'))$('historical-void').onsubmit=async e=>{
   e.preventDefault();const button=e.submitter;button.disabled=true;
   try{if(await OperationConfirm.ask({title:t('作废此历史单据？','Void this historical document?')})){
    await API.request(api+'/void',{...options,method:'POST',body:Object.fromEntries(new FormData(e.target))});
    this.voidChannel?.postMessage([r.product_code]);
    await this.detail(id);
   }}catch(error){$('historical-detail-error').textContent=I18n.translate(error.message,true);}finally{button.disabled=false;}
  };
 },
 listPath(area){return '/'+(area==='loading-plans'?'loading-plans/query':area==='stock-outbound'?'outbounds':area);},
 async document(area,id){
  const t=this.t,stock=area==='inventory',cu=ProductContext.isCopper(),q=new URLSearchParams(location.search),kind=this.kinds[area];
  const api=this.prefix()+'/historical-backfill';
  const row=await API.request(stock?api+'/stock/batch/'+id+'?'+new URLSearchParams({unit:q.get('unit')||''}):api+'/documents/'+id+'?kind='+kind);
  const title=stock?t(cu?'捆包详情档案':'批次详情档案',cu?'Bundle Detail Archive':'Batch Detail Archive'):this.kind(kind);
  const code=stock?(cu?row.rows[0]?.unit_id:row.source_facts?.batch_no):row.document_no;
  const back=stock?this.stockPath():this.listPath(area),outbound=stock||area==='stock-outbound';
  const summaries={receipts:['入库资料','Receipt Information'],'loading-plans':['计划资料','Plan Information'],
   outbounds:['车辆与装载','Vehicle and Load'],'stock-outbound':['出库资料','Stock Issue Information'],inventory:['库存资料','Stock Information']};
  const related=this.links(row.documents,{current:stock?null:row.id,stock:stock?null:this.archiveLink(row),
   source:{label:t('装箱单来源','Packing List Source'),code:row.source_name,
    href:this.path+'/'+row.source_id+'?'+new URLSearchParams({product:row.product_code})}});
  this.page(title,title,'<div class="inventory-archive wms-historical-detail">'+
   UI46Pages.identity(code||'—',this.badge()+(outbound?UI.status('OUTBOUND','stock',t('已出库','Issued')):''),this.back(back),'')+
   this.section(...summaries[area],UI46Pages.factList(this.summary(row,area)))+
   (related?this.section('关联单据','Related Documents',related):'')+
   (row.metal?CobaltMetal.outbound(row):'')+
   this.section(cu?'逐捆明细':'逐袋明细',cu?'Bundle Details':'Bag Details',
    (stock&&!cu?'<form id="historical-unit-search" class="filters wms-filter-row"><label>'+t('袋号或铅封号','Bag or Seal No.')+
     '<input type="search" name="unit" maxlength="160" value="'+esc(q.get('unit')||'')+'"></label><div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+'</button></div></form>':'')+
    this.unitLines(row.rows,row.product_code,!stock))+'</div>');
  this.followReturn();
  if(row.metal)CobaltMetal.bindOutbound(row.metal,()=>this.document(area,id));
  if($('historical-unit-search'))$('historical-unit-search').onsubmit=e=>{e.preventDefault();Router.go(location.pathname+'?'+new URLSearchParams(new FormData(e.target)),true);};
 },
 install(){
  if(typeof BroadcastChannel==='function'){
   this.voidChannel?.close();
   this.voidChannel=new BroadcastChannel('musonoi-historical-void');
   this.voidChannel.onmessage=({data})=>{
    if(window.AppSignedIn&&Array.isArray(data)&&data.includes(ProductContext.code)&&
     ['/receipts','/outbounds'].includes(location.pathname))Router.show();
   };
  }
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
    I18n.apply();
    const target=location.hash==='#co-metal-detail'?$('co-metal-detail'):null;
    if(target)target.scrollIntoView();else window.scrollTo({top:0});
   }catch(error){
    System46.lastFailure={route:location.pathname+location.search,status:error.statusCode||0,message:error.message};
    WmsException.route(error);
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
