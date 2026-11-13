'use strict';
window.HistoricalMovements={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 path:'/historical-movements',
 api(){return (ProductContext.isCopper()?'':'/cobalt')+this.path;},
 type(value){return value==='INBOUND'?this.t('入库','Inbound'):this.t('出库','Outbound');},
 amount(value){return value==null?'—':Tonnes.fixed(Tonnes.scaled(String(value),4),4);},
 status(row){return row.voided_at?this.t('已作废','Voided'):this.t('已入历史台账','Recorded');},
 message(code){const t=this.t,labels={
  DATE_MISSING:t('缺少经核实的实际业务日期','Verified business date is required'),
  DATE_INVALID:t('实际业务日期无效','Invalid business date'),
  EVIDENCE_MISSING:t('请填写手工账、签收单或核实依据','Provide a ledger, signed record or verification reference'),
  ALREADY_IMPORTED:t('该单据已导入','This document was already imported'),
  DOCUMENT_CONFLICT:t('同号单据内容或日期冲突','The same document number has different contents or dates'),
  UNIT_ALREADY_IMPORTED:t('该件已在同类型历史单据登记','Unit already recorded for this movement type'),
  UNIT_MISSING:t('缺少捆包号或袋号','Bundle or bag ID missing'),
  DUPLICATE_UNIT:t('单内编号重复','Duplicate unit within the document'),
  INVALID_SHEETS:t('片数必须为正整数','Sheet quantity must be a positive integer'),
  INVALID_WEIGHT:t('重量缺失或无效','Weight missing or invalid'),
  TOTAL_ROW_MISSING:t('缺少原单合计行','Source totals row is missing'),
  SOURCE_TOTAL_MISMATCH:t('原单合计与明细不符','Source totals do not match details'),
  DOCUMENT_NO_MISSING:t('缺少装箱单号','Packing list number is missing'),
  BATCH_NO_MISSING:t('缺少备货批次','Preparation batch is missing'),
  DETAILS_MISSING:t('没有明细','No detail rows')
 };return labels[code]||code;},
 table(headers,rows,{numeric=[],center=[]}={}){
  return '<div class="business-table">'+UI46Pages.table('<table><thead><tr>'+headers.map(label=>'<th scope="col">'+esc(label)+'</th>').join('')+
   '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table>',{numeric,center})+'</div>';
 },
 options(selected='',all=false){return (all?'<option value="">'+this.t('全部','All')+'</option>':'')+
  ['OUTBOUND','INBOUND'].map(v=>'<option value="'+v+'"'+(selected===v?' selected':'')+'>'+this.type(v)+'</option>').join('');},
 async list(){
  const t=this.t,q=new URLSearchParams(location.search),url=this.path,api=this.api();
  const data=await API.request(api+'?'+q);
  const date=(name,zh,en)=>'<label>'+t(zh,en)+'<input type="date" name="'+name+'" value="'+esc(q.get(name)||'')+'"></label>';
  const filters='<form id="historical-filter" class="filters wms-filter-row"><label>'+t('业务类型','Movement Type')+
   '<select name="movement_type">'+this.options(q.get('movement_type'),true)+'</select></label>'+date('from','开始日期','From')+date('to','截止日期','Through')+
   '<div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+'</button><a class="button secondary" data-wms-reset href="'+url+'">'+t('重置','Reset')+'</a></div></form>';
  const rows=data.items.map(row=>[esc(row.document_no),esc(this.type(row.movement_type)),esc(row.business_date),esc(row.source_facts.batch_no),
   esc(CountValues.display(row.quantity)),this.amount(row.net_kg),esc(this.status(row)),
   '<a class="button secondary compact" href="'+url+'/'+row.id+'">'+t('查看','View')+'</a>']);
  const pager=(page,zh,en)=>{const params=new URLSearchParams(q);params.set('page',page);return '<a class="button secondary compact" href="'+url+'?'+esc(params)+'">'+t(zh,en)+'</a>';};
  Router.page(t('历史出入库导入','Historical Stock Movements'),'<div data-page-composed data-no-i18n><section class="panel wms-section"><h2>'+t('上传装箱单','Upload Packing List')+'</h2>'+this.uploadForm()+'</section>'+
   '<section class="panel wms-section"><h2>'+t('历史出入库台账','Historical Movement Ledger')+'</h2>'+filters+
   (rows.length?this.table([t('装箱单号','Packing List No.'),t('业务类型','Movement Type'),t('实际业务日期','Actual Business Date'),t('备货批次','Preparation Batch'),t('数量','Quantity'),t('净重（kg）','Net (kg)'),t('状态','Status'),t('操作','Action')],rows,{numeric:[4,5],center:[1,2,6,7]}):System46.stateHTML('empty'))+
   '<div class="wms-filter-actions">'+(data.page>1?pager(data.page-1,'上一页','Previous'):'')+(data.has_next?pager(data.page+1,'下一页','Next'):'')+'</div></section></div>');
  $('historical-filter').onsubmit=e=>{e.preventDefault();const params=new URLSearchParams(new FormData(e.target));for(const [k,v] of params)if(!v)params.delete(k);Router.go(url+(params.size?'?'+params:''));};
  const form=$('historical-upload');
  form.oninput=()=>{this.previewSequence=(this.previewSequence||0)+1;$('historical-preview').replaceChildren();$('historical-upload-error').textContent='';};
  form.onsubmit=e=>this.read(e,api);
 },
 uploadForm(){const t=this.t;
  return '<form id="historical-upload" class="user-form" data-wms-validation><div class="form-grid wms-field-grid">'+
   '<label class="wms-field">'+t('装箱单（XLS 或 XLSX）','Packing List (XLS or XLSX)')+'<input required type="file" name="source" accept=".xls,.xlsx"></label>'+
   '<label class="wms-field">'+t('拟导入业务类型','Movement Type')+'<select name="movement_type">'+this.options()+'</select></label>'+
   '<label class="wms-field">'+t('经核实的实际业务日期','Verified Business Date')+'<input type="date" name="business_date"></label>'+
   '<label class="wms-field" data-field-span="full">'+t('日期依据','Date Evidence')+'<input name="date_evidence" maxlength="500" placeholder="'+t('手工账编号、签收单号或核实记录','Ledger number, signed receipt or verification record')+'"></label></div>'+
   '<div class="wms-filter-actions"><button class="button primary">'+t('预览','Preview')+'</button></div><p id="historical-upload-error" class="error" role="alert"></p></form><div id="historical-preview" aria-live="polite"></div>';
 },
 async read(event,api){
  event.preventDefault();const t=this.t,form=event.target,error=$('historical-upload-error'),preview=$('historical-preview'),button=event.submitter;
  const input=Object.fromEntries(new FormData(form));const {source,...body}=input;
  if(source.size>524288){error.textContent=t('文件上限为 512 KB','The file limit is 512 KB');return;}
  button.disabled=true;error.textContent='';preview.replaceChildren();
  const sequence=this.previewSequence=(this.previewSequence||0)+1;
  try{
   const raw=await source.arrayBuffer(),bytes=new Uint8Array(raw);let binary='';
   for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   Object.assign(body,{file_name:source.name,file_base64:btoa(binary)});
   const result=await API.request(api+'/preview',{method:'POST',body});
   if(form.isConnected&&sequence===this.previewSequence)this.preview(result,body,api);
  }catch(e){if(form.isConnected&&sequence===this.previewSequence)error.textContent=e.message;}finally{button.disabled=false;}
 },
 facts(row){const t=this.t,source=row.source_facts||row;
  return UI46Pages.factList([[t('装箱单号','Packing List No.'),row.document_no],[t('业务类型','Movement Type'),this.type(row.movement_type)],
   [t('实际业务日期','Actual Business Date'),row.business_date],[t('装箱单发运日期','Packing List Shipping Date'),source.shipping_date],
   [t('备货批次','Preparation Batch'),source.batch_no],[t('客户','Customer'),source.customer],[t('车头号','Truck'),source.truck],
   [t('数量','Quantity'),CountValues.display(row.totals?.quantity??row.quantity)],
   [t('净重（kg）','Net (kg)'),this.amount(row.totals?.net_kg??row.net_kg)],[t('毛重（kg）','Gross (kg)'),this.amount(source.totals?.gross_kg)]]
   .map(([label,value])=>[label,esc(value??'—')]));
 },
 lines(rows){const t=this.t,cu=ProductContext.isCopper();
  const values=rows.map(row=>[row.source_row,esc(row.unit_id||'—'),esc(row.seal_no||'—'),...(cu?[esc(CountValues.display(row.sheets_count))]:[]),this.amount(row.net_kg),this.amount(row.gross_kg),
   esc([...(row.flags||[]).map(code=>this.message(code)),...(row.overlap?[t('与在线库存或出库单重叠','Overlaps online inventory or outbound records')]:[])].join(' · ')||'—')]);
  return this.table([t('原表行','Source Row'),t(cu?'捆包号':'袋号',cu?'Bundle No.':'Bag No.'),t('铅封号','Seal No.'),...(cu?[t('片数','Sheets')]:[]),
   t('净重（kg）','Net (kg)'),t('毛重（kg）','Gross (kg)'),t('校验','Validation')],values,{numeric:cu?[0,3,4,5]:[0,3,4]});
 },
 preview(row,body,api){
  const t=this.t,box=$('historical-preview');
  box.innerHTML='<h3>'+t('导入预览','Import Preview')+'</h3>'+this.facts(row)+
   (row.issues.length?'<ul class="error">'+row.issues.map(issue=>'<li>'+esc(this.message(issue))+'</li>').join('')+'</ul>':'')+
   (row.warnings?'<p class="wms-feedback">'+t('可能与期初库存或正式业务单据重叠，请核实。','Possible overlap with opening inventory or formal documents. Verify before importing.')+'</p>':'')+
   this.lines(row.rows)+(row.importable?'<div class="wms-filter-actions"><button class="button primary" id="historical-confirm">'+t('确认导入','Confirm Import')+'</button></div>':'')+
   '<p id="historical-confirm-error" class="error" role="alert"></p>';
  if($('historical-confirm'))$('historical-confirm').onclick=async e=>{
   const button=e.currentTarget;button.disabled=true;
   try{
    if(!await OperationConfirm.ask({title:t('确认写入历史出入库台账？','Import into the historical movement ledger?'),note:row.warnings?t('我已核对可能重叠的记录。','I have verified the possible overlaps.'):''}))return;
    const result=await API.request(api,{method:'POST',body:{...body,preview_token:row.preview_token,acknowledge_overlap:row.warnings}});
    await Router.go(this.path+'/'+result.id);
   }catch(error){const target=$('historical-confirm-error');if(target)target.textContent=error.message;}finally{button.disabled=false;}
  };
 },
 async detail(id){
  const t=this.t,api=this.api()+'/'+id,row=await API.request(api);
  Router.page(t('历史出入库台账单据','Historical Movement Record'),'<div data-page-composed data-no-i18n><section class="panel wms-section">'+
   '<div class="business-toolbar"><a class="button secondary" href="'+this.path+'">'+t('返回台账','Back to Ledger')+'</a><button type="button" class="button secondary" id="historical-source">'+t('下载原文件','Download Source')+'</button></div>'+
   '<h2>'+esc(row.document_no)+'</h2><p>'+esc(this.status(row))+'</p>'+this.facts(row)+UI46Pages.factList([
    [t('日期依据','Date Evidence'),esc(row.date_evidence)],[t('导入人','Imported By'),esc(row.imported_by)],[t('导入时间','Imported At'),esc(BusinessTime.display(row.imported_at))],
    ...(row.voided_at?[[t('作废原因','Void Reason'),esc(row.void_reason)],[t('作废人','Voided By'),esc(row.voided_by)],[t('作废时间','Voided At'),esc(BusinessTime.display(row.voided_at))]]:[])])+'</section>'+
   '<section class="panel wms-section"><h2>'+t('原表明细','Source Lines')+'</h2>'+this.lines(row.rows)+'</section>'+
   (!row.voided_at?'<section class="panel wms-section"><h2>'+t('导入纠错','Import Correction')+'</h2><form id="historical-void" class="user-form"><label>'+t('作废原因','Void Reason')+'<textarea name="reason" required minlength="5" maxlength="500"></textarea></label><button class="button danger-outline">'+t('作废该条历史单据','Void Historical Record')+'</button></form></section>':'')+
   '<p id="historical-detail-error" class="error" role="alert"></p></div>');
  $('historical-source').onclick=async()=>{
   try{const file=await API.request(api+'/source',{binary:true}),url=URL.createObjectURL(file.blob),a=document.createElement('a');a.href=url;a.download=row.source_name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   catch(e){$('historical-detail-error').textContent=e.message;}
  };
  if($('historical-void'))$('historical-void').onsubmit=async e=>{
   e.preventDefault();const button=e.submitter;button.disabled=true;
   try{if(await OperationConfirm.ask({title:t('作废此历史单据？','Void this historical document?')})){
    await API.request(api+'/void',{method:'POST',body:Object.fromEntries(new FormData(e.target))});await this.detail(id);
   }}catch(error){$('historical-detail-error').textContent=error.message;}finally{button.disabled=false;}
  };
 },
 install(){
  RoutePermissions.register('historical-movements',path=>/^\/historical-movements(?:\/|$)/.test(path),()=>
   CurrentUser.role_code==='admin'?undefined:'__historical_admin_only');
  Router.add(/^\/historical-movements$/,()=>this.list());
  Router.add(/^\/historical-movements\/([0-9a-f-]{36})$/,id=>this.detail(id));
 }
};
