'use strict';

window.DispatchTransport={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 // Cobalt pages translate their own markup and opt out of the global DOM translator.
 label:value=>ProductContext.isCopper()?value:I18n.translate(value,true),
 state:new WeakMap(),
 search(id,rows){
  const t=this.t,term=(new URLSearchParams(location.search).get('truck_no')||'').slice(0,80),path='/sales-plans/'+encodeURIComponent(id)+'/dispatch';
  const plate=value=>String(value??'').toUpperCase().replace(/[\s-]+/g,'');
  const key=plate(term);
  return {term,rows:key?rows.filter(row=>[row.truck_no,row.trailer_no].some(value=>plate(value).includes(key))):rows,
   empty:t('未找到匹配车牌的车辆','No vehicles match this plate'),
   form:'<form id="dispatch-plate-search" class="filters wms-filter-row wms-dispatch-search" action="'+path+'">'+
    '<label>'+t('车牌号','Truck Plate')+'<input type="search" name="truck_no" maxlength="80" value="'+esc(term)+'"></label>'+
    '<div class="wms-filter-actions"><button class="button secondary">'+t('查询','Search')+'</button>'+
    '<a class="button secondary" data-wms-reset href="'+path+'">'+t('重置','Reset')+'</a></div></form>'};
 },
 bindSearch(){
  const form=$('dispatch-plate-search');
  form.onsubmit=e=>{
   e.preventDefault();
   const value=form.elements.truck_no.value.trim();
   return Router.go(form.getAttribute('action')+(value?'?'+new URLSearchParams({truck_no:value}):''));
  };
 },
 missingRows(rows){
  return rows.filter(row=>!row.cancelled_at&&!row.transport_locked&&!row.historical_source_id&&row.counted!==false&&(!row.transporter?.trim()||!row.destination?.trim()));
 },
 notice(rows,canImport,closed){
  const count=this.missingRows(rows).length;
  if(!count)return '';
  const prompt=closed?'销售计划已关闭':canImport?
   '请在下方再次导入包含运输商和目的地的派车单，确认保存时系统会自动补全空缺。':
   '请具备派车导入权限的人员再次导入派车单。';
  return '<div class="dispatch-transport-notice" data-dispatch-notice role="status">'+
   '<strong>'+this.label('缺少运输商或目的地的车辆')+' · '+count+'</strong><p>'+this.label(prompt)+'</p></div>';
 },
 importFields(rows,currentMonth){
  const olderMonths=[...new Set(this.missingRows(rows).map(row=>row.shipment_month)
   .filter(month=>month&&month!==currentMonth))].sort().reverse();
  const monthOption=(month,label)=>'<option value="'+esc(month)+'">'+esc(label)+'</option>';
  const monthField=olderMonths.length?'<label>'+this.label('派车单所属月份')+'<select name="transport_month">'+
   (currentMonth?monthOption(currentMonth,currentMonth):monthOption('',this.label('请选择原派车月份')))+
   olderMonths.map(month=>monthOption(month,month+' · '+this.label('补全运输资料'))).join('')+
   '</select></label>':'';
  return this.notice(rows,true,false)+'<div class="form-grid">'+monthField+'<label>'+
   this.label('客户Excel派车单')+'<input name="file" type="file" accept=".xls,.xlsx" required></label></div>';
 },
 outcome(row,transportOnly=false){
  if(row.cancelled)return transportOnly?'取消行 · 跳过':'已取消 · 不计入';
  if(row.action==='FILL_TRANSPORT')return '补全运输资料';
  if(row.action==='UNMATCHED')return '未匹配 · 跳过';
  if(row.action==='TRANSPORT_CONFLICT')return '运输资料冲突 · 跳过';
  if(row.action==='TRANSPORT_LOCKED')return '已有装车单 · 跳过';
  if(row.duplicate)return '重复车辆 · 跳过';
  return '新增';
 },
 summary(result){
  const parts=[];
  if(Array.isArray(result.items))parts.push('已读取 '+result.row_count);
  parts.push('新增 '+(result.new_count??result.added_count??0),'补全运输资料 '+result.transport_filled_count,
   '重复跳过 '+result.duplicate_count);
  if(result.unmatched_count)parts.push('未匹配 '+result.unmatched_count);
  if(result.transport_conflict_count)parts.push('资料冲突 '+result.transport_conflict_count);
  if(result.transport_locked_count)parts.push('装车单锁定 '+result.transport_locked_count);
  if(result.cancelled_count)parts.push('取消行 '+result.cancelled_count);
  return parts.join(' · ');
 },
 historicalSummary({linked,invoice_confirmed,invoice_missing,ambiguous}){
  const t=this.t;
  return [t('历史匹配并登记到场','Historical arrivals matched')+' '+linked,
   t('自动确认开票','Invoices confirmed')+' '+(invoice_confirmed||0),
   ...(invoice_missing?[t('缺少发票号','Missing invoice number')+' '+invoice_missing]:[]),
   ...(ambiguous?[t('需核对趟次','Trips to verify')+' '+ambiguous]:[])].join(' · ');
 },
 bindImport(form,{path,month,planVersion,error,render,reload,savePath=path,confirm=false,errorText=e=>I18n.translate(e.message,true)}){
  if(!form)return;
  const fileField=form.elements.file,monthField=form.elements.transport_month;
  const previewButton=form.querySelector('[data-dispatch-preview]');
  const save=form.querySelector('[type="submit"]');
  const output=form.querySelector('[data-dispatch-preview-rows]'),mappingPanel=$('dispatch-mapping');
  const t=this.t;
  let mapping,preview,sequence=0,saving=false;
  const clearPreview=()=>{
   preview=null;sequence++;save.disabled=true;output.replaceChildren();
   previewButton.disabled=saving;
  };
  const showError=e=>{
   error.textContent=e.message==='DISPATCH_TRANSPORT_MONTH_REQUIRED'?
    t('请选择原派车月份','Select the original dispatch month'):errorText(e);
  };
  const readPreview=async()=>{
   if(saving)return;
   clearPreview();
   const request=sequence,file=fileField.files[0],targetMonth=monthField?monthField.value:month;
   const transportOnly=!!targetMonth&&targetMonth!==month;
   const current=()=>form.isConnected&&sequence===request;
   previewButton.disabled=true;error.textContent='';
   try{
    if(!targetMonth)throw Error(monthField?'DISPATCH_TRANSPORT_MONTH_REQUIRED':
     t('请先维护销售计划的发运月份','Set the shipment month on the sales plan first'));
    if(!file)throw Error(t('请选择客户Excel派车单','Select a customer dispatch Excel file'));
    if(file.size>2*1024*1024)throw Error(t('派车单最大2MB','The dispatch file must not exceed 2 MB'));
    const base64=await new Promise((resolve,reject)=>{
     const reader=new FileReader();
     reader.onload=()=>resolve(reader.result.split(',')[1]);
     reader.onerror=()=>reject(Error(t('文件读取失败','Could not read the file')));
     reader.readAsDataURL(file);
    });
    if(!current())return;
    const body={file_name:file.name,file_base64:base64,shipment_month:targetMonth,
     ...(planVersion!==undefined?{plan_version:planVersion}:{}),
     ...(transportOnly?{transport_only:true}:{}),...(mapping?{mapping}:{})};
    const result=await API.request(path+'/import-preview',{method:'POST',body,timeoutMs:30000});
    if(!current())return;
    Dispatch.mappingPanel(result,result.mapping||null,value=>{
     mapping=value;clearPreview();
   });
    if(!ProductContext.isCopper())for(const el of mappingPanel.querySelectorAll('label,p,summary,option')){
     if(!el.closest('#dispatch-sheet'))for(const node of el.childNodes){
      if(node.nodeType===3)node.textContent=this.label(node.textContent);
     }
    }
    I18n.apply();
    if(result.needs_mapping)return;
    mapping=result.mapping;
    preview={...body,mapping,preview_sha256:result.file_sha256};
    const notes=[];
    if(result.warnings?.length)notes.push('请核对车牌格式异常的行。');
    if((transportOnly||form.querySelector('[data-dispatch-notice]'))&&!mapping.transporter_column&&!mapping.destination_column)notes.push(
     '未识别运输商或目的地列。请调整识别列，或重新上传包含运输资料的派车单。');
    const rows=[...result.items,...(result.cancelled||[]).map(row=>({...row,cancelled:true}))];
    output.innerHTML='<p role="status">'+esc(this.label(this.summary(result)))+'</p>'+
     notes.map(note=>'<p class="dialog-notice">'+esc(this.label(note))+'</p>').join('')+render(rows,transportOnly);
    I18n.apply();save.disabled=transportOnly&&!result.transport_filled_count;
   }catch(e){if(current())showError(e);}
   finally{if(current())previewButton.disabled=false;}
  };
  fileField.onchange=()=>{
   mapping=undefined;mappingPanel.replaceChildren();clearPreview();error.textContent='';
   if(fileField.files.length)void readPreview();
  };
  if(monthField)monthField.onchange=()=>{
   clearPreview();error.textContent='';
   if(fileField.files.length&&monthField.value)void readPreview();
  };
  previewButton.onclick=readPreview;
  form.onsubmit=async e=>{
   e.preventDefault();
   if(!preview||save.disabled||saving)return;
   const pending=preview;
   saving=save.disabled=previewButton.disabled=fileField.disabled=true;
   if(monthField)monthField.disabled=true;
   try{
    if(confirm&&!await OperationConfirm.ask({title:pending.transport_only?t('确认补全运输资料','Confirm Route Details'):
     t('确认保存派车单','Confirm Dispatch Import')}))return;
    if(preview!==pending||!form.isConnected)return;
    const saved=await API.request(savePath,{method:'POST',body:pending,timeoutMs:30000});
    ProductContext.dirty=false;
    await reload();
    const historical=saved.historical;
    const arrivalMessage=historical&&(historical.linked||historical.ambiguous)?this.historicalSummary(historical):'';
    notify([I18n.translate(this.summary(saved),true),arrivalMessage].filter(Boolean).join(' · '));
   }catch(err){if(form.isConnected)showError(err);}
   finally{
    saving=previewButton.disabled=fileField.disabled=false;
    if(monthField)monthField.disabled=false;
    save.disabled=preview!==pending;
   }
  };
 },
 verifyPlan(form,row,original){
  const panel=form.querySelector('[data-dispatch-verification]');
  const current=original&&(row?original.arrival_id===(row.arrival_id||row.id):
   !original.arrival_required&&!original.arrival_id);
  panel.hidden=!row||!!row.cancelled_at||!!current;
  if(panel.hidden)return !!current;
  const missing=[['transporter','运输商'],['destination','目的地']]
   .filter(([field])=>!row['dispatch_'+field]?.trim());
  panel.classList.toggle('dispatch-transport-verified',missing.length===0);
  if(!missing.length){
   panel.innerHTML='<strong>'+this.label('派车资料已核验')+'</strong>';
   return true;
  }
  const planId=row.sales_plan_id||form.elements.sales_plan_id.value;
  const link=planId&&Business.can('dispatch:read')?
   ' <a target="_blank" rel="noopener" href="/sales-plans/'+encodeURIComponent(planId)+'/dispatch">'+
   this.label('打开派车管理')+'</a>':'';
  panel.innerHTML='<strong>'+this.label('派车资料不全')+' · '+
   missing.map(([,label])=>this.label(label)).join(' / ')+'</strong><p>'+
   this.label('请再次导入派车单补全资料，保存后刷新装车计划页面。')+link+'</p>';
  return false;
 },
 fill(form,row,existing=false){
  let state=this.state.get(form);
  if(!state){state={last:{},manual:new Set()};this.state.set(form,state);}
  for(const field of ['transporter','destination']){
   const input=form.elements[field];
   if(!input)continue;
   if(!(field in state.last)){
    if(existing&&input.value)state.manual.add(field);
    input.addEventListener('input',()=>state.manual.add(field));
   }else if(input.value!==state.last[field])state.manual.add(field);
   if(!state.manual.has(field))input.value=row?.['dispatch_'+field]||'';
   state.last[field]=input.value;
  }
 }
};
