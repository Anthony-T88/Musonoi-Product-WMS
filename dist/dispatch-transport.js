'use strict';

window.DispatchTransport={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 // Cobalt pages translate their own markup and opt out of the global DOM translator.
 label:value=>ProductContext.isCopper()?value:I18n.translate(value,true),
 state:new WeakMap(),
 missingRows(rows){
  return rows.filter(row=>!row.cancelled_at&&!row.transport_locked&&row.counted!==false&&(!row.transporter?.trim()||!row.destination?.trim()));
 },
 notice(rows,canImport,closed){
  const count=this.missingRows(rows).length;
  if(!count)return '';
  const prompt=closed?'销售计划已关闭':canImport?'请重新导入派车单，系统会批量补全。':
   '请具备派车导入权限的人员重新导入派车单。';
  return '<div class="business-toolbar"><p class="wms-feedback" role="status">'+
   '<span>'+this.label('缺少运输商或目的地的车辆')+'</span> <strong>'+count+'</strong> · <span>'+this.label(prompt)+'</span></p>'+
   (canImport?'<button type="button" class="button secondary" data-dispatch-reimport>'+this.label('重新导入派车单')+'</button>':'')+'</div>';
 },
 importFields(rows){
  const months=[...new Set(this.missingRows(rows).map(row=>row.shipment_month).filter(Boolean))].sort().reverse();
  return '<div class="form-grid"><div data-dispatch-month-field hidden><label>'+
   this.label('原派车月份')+'<select name="transport_month" disabled>'+
   (months.length===1?'':'<option value="">'+this.label('请选择原派车月份')+'</option>')+
   months.map(month=>'<option value="'+esc(month)+'">'+esc(month)+'</option>').join('')+'</select></label></div>'+
   '<label>'+this.label('客户Excel派车单')+'<input name="file" type="file" accept=".xls,.xlsx" required></label></div>';
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
 bindImport(form,{path,month,planVersion,error,render,reload,savePath=path,confirm=false,errorText=e=>I18n.translate(e.message,true)}){
  if(!form)return;
  const fileField=form.elements.file,monthField=form.elements.transport_month;
  const title=form.closest('.lp-load-summary').querySelector('[data-dispatch-import-title]');
  const previewButton=form.querySelector('[data-dispatch-preview]');
  const save=form.querySelector('[type="submit"]'),exit=form.querySelector('[data-dispatch-normal-import]');
  const output=form.querySelector('[data-dispatch-preview-rows]'),mappingPanel=$('dispatch-mapping');
  const reimport=document.querySelector('[data-dispatch-reimport]'),t=this.t;
  let transportOnly=false,mapping,preview,sequence=0,saving=false;
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
   const request=sequence,file=fileField.files[0],targetMonth=transportOnly?monthField.value:month;
   const current=()=>form.isConnected&&sequence===request;
   previewButton.disabled=true;error.textContent='';
   try{
    if(!targetMonth)throw Error(transportOnly?'DISPATCH_TRANSPORT_MONTH_REQUIRED':
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
    if(transportOnly&&!mapping.transporter_column&&!mapping.destination_column)notes.push(
     '未识别运输商或目的地列。请调整识别列，或重新上传包含运输资料的派车单。');
    const rows=[...result.items,...(result.cancelled||[]).map(row=>({...row,cancelled:true}))];
    output.innerHTML='<p role="status">'+esc(this.label(this.summary(result)))+'</p>'+
     notes.map(note=>'<p class="dialog-notice">'+esc(this.label(note))+'</p>').join('')+render(rows,transportOnly);
    I18n.apply();save.disabled=transportOnly&&!result.transport_filled_count;
   }catch(e){if(current())showError(e);}
   finally{if(current())previewButton.disabled=false;}
  };
  const selectMode=only=>{
   if(saving)return;
   transportOnly=only;
   monthField.disabled=!only;
   exit.hidden=!only;
   if(reimport)reimport.hidden=only;
   form.querySelector('[data-dispatch-month-field]').hidden=!only;
   title.textContent=this.label(only?'重新导入派车单':'导入客户派车单');
   fileField.value='';mapping=undefined;mappingPanel.replaceChildren();clearPreview();error.textContent='';
   form.scrollIntoView({block:'nearest'});
   (only&&!monthField.value?monthField:fileField).focus({preventScroll:true});
  };
  if(reimport)reimport.onclick=()=>selectMode(true);
  exit.onclick=()=>selectMode(false);
  fileField.onchange=()=>{
   mapping=undefined;mappingPanel.replaceChildren();clearPreview();error.textContent='';
   if(fileField.files.length&&(transportOnly?monthField.value:month))void readPreview();
  };
  monthField.onchange=()=>{
   clearPreview();error.textContent='';
   if(fileField.files.length&&monthField.value)void readPreview();
  };
  previewButton.onclick=readPreview;
  form.onsubmit=async e=>{
   e.preventDefault();
   if(!preview||save.disabled||saving)return;
   const pending=preview;
   saving=save.disabled=previewButton.disabled=fileField.disabled=exit.disabled=true;
   monthField.disabled=true;
   if(reimport)reimport.disabled=true;
   try{
    if(confirm&&!await OperationConfirm.ask({title:transportOnly?t('确认补全运输资料','Confirm Route Details'):
     t('确认保存派车单','Confirm Dispatch Import')}))return;
    if(preview!==pending||!form.isConnected)return;
    const saved=await API.request(savePath,{method:'POST',body:pending,timeoutMs:30000});
    ProductContext.dirty=false;
    await reload();
    notify(I18n.translate(this.summary(saved),true));
   }catch(err){if(form.isConnected)showError(err);}
   finally{
    saving=previewButton.disabled=fileField.disabled=exit.disabled=false;
    monthField.disabled=!transportOnly;save.disabled=preview!==pending;
    if(reimport)reimport.disabled=false;
   }
  };
 },
 fill(form,row,existing=false,fallback=''){
  let state=this.state.get(form);
  if(!state){state={last:{},manual:new Set()};this.state.set(form,state);}
  for(const field of ['transporter','destination']){
   const input=form.elements[field];
   if(!input)continue;
   if(!(field in state.last)){
    if(existing&&input.value)state.manual.add(field);
    input.addEventListener('input',()=>state.manual.add(field));
   }else if(input.value!==state.last[field])state.manual.add(field);
   if(!state.manual.has(field))input.value=row?.['dispatch_'+field]||(field==='destination'?fallback:'');
   state.last[field]=input.value;
  }
 }
};
