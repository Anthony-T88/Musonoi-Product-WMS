'use strict';
window.DocumentDrafts={
 forms:{
  'preparation-plan-form':['备货计划','Preparation Plan','preparation',/^(?:\/cobalt)?\/preparation-plans(?:\/[0-9a-f-]+)?$/],
  'v26-receipt':['入库单','Receipt','receipts',/^\/v26\/receipts$/],
  'receipt-editor':['入库单','Receipt','receipts',/^\/(?:v26\/)?receipts(?:\/[0-9a-f-]+)?$/],
  'v26-preparation':['备货单','Preparation Order','preparation',/^\/v26\/allocations$/],
  'v261-create':['备货单','Preparation Order','preparation',/^\/v261\/lots$/],
  'co-create':['入库备货单','Receipt Preparation','preparation',/^\/cobalt\/preparations$/],
  'co469-work-draft':['袋级备货作业','Bag Preparation Work','preparation',/^\/cobalt\/preparations\/[0-9a-f-]+\/work\/save$/],
  'single-plan-form':['装车计划','Loading Plan','loading-plans',/^\/loading-plans\/unified(?:\/documents\/[0-9a-f-]+)?$/],
  'yard-arrival-form':['车辆到厂登记','Vehicle Arrival','loading-plans',/^\/loading-plans\/arrivals\/[0-9a-f-]+$/],
  'co-arrival-form':['车辆到厂登记','Vehicle Arrival','loading-plans',/^\/cobalt\/sales\/arrivals\/[0-9a-f-]+$/],
  'co-loading-form':['装车计划','Loading Plan','loading-plans',/^\/cobalt\/loading\/plans(?:\/[0-9a-f-]+)?$/],
  'co-loading-documents':['装车单证资料','Loading Documents','loading-plans',/^\/cobalt\/loading\/plans\/[0-9a-f-]+\/documents$/],
  'v26-load':['装车单','Loading Order','outbounds',/^\/v26\/loads$/],
  'lp-load-form':['装车单','Loading Order','outbounds',/^\/v31\/loads(?:\/[0-9a-f-]+)?$/],
  'pending-load-edit':['装车单','Loading Order','outbounds',/^\/(?:v26\/)?loads\/[0-9a-f-]+$/],
  'cu-departure-draft':['离场申报','Departure Declaration','outbounds',/^\/v26\/loads\/[0-9a-f-]+\/depart$/],
  'co-execution-departure':['离场申报','Departure Declaration','outbounds',/^\/cobalt\/execution\/orders\/[0-9a-f-]+\/(?:correct-)?depart(?:ure)?$/],
  'v27-count-create':['盘点单','Stocktake','stocktaking',/^\/v27\/stocktakes$/],
  'v33-count-create':['盘点单','Stocktake','stocktaking',/^\/v33\/stocktakes$/],
  'co-count-create':['盘点单','Stocktake','stocktaking',/^\/cobalt\/stocktaking$/],
  'v27-observation':['盘点记录','Stocktake Observation','stocktaking',/^\/v27\/stocktakes\/[0-9a-f-]+\/observations?$/],
  'co-count-record':['盘点记录','Stocktake Observation','stocktaking',/^\/cobalt\/stocktaking\/[0-9a-f-]+\/observe$/],
  'export-license-application':['许可证申请','License Application','export-licenses',/^(?:\/cobalt)?\/export-permits(?:\/[0-9a-f-]+)?$/],
  'permit-extension-form':['许可证延期','License Extension','export-licenses',/^(?:\/cobalt)?\/export-permits\/[0-9a-f-]+\/actions$/],
  'shipping-generate':['商业发票与装箱单','Invoice and Packing List','outbounds',/^\/shipping\/[0-9a-f-]+\/packing-list$/],
  'co-packing-generate':['装箱单','Packing List','outbounds',/^\/cobalt\/packing\/orders\/[0-9a-f-]+(?:\/generate)?$/],
  'ux10-plan-form':['销售计划','Sales Plan','sales-plans',/^\/(?:sales-workflow\/)?plans(?:\/[0-9a-f-]+)?$/],
  'co-sales-plan-form':['销售计划','Sales Plan','sales-plans',/^\/cobalt\/(?:sales|sales-workflow)\/plans(?:\/[0-9a-f-]+)?$/]
 },
 t:(zh,en)=>I18n.language==='en'?en:zh,
 api(){return (ProductContext.isCopper()?'':'/cobalt')+'/document-drafts';},
 route(){
  const url=new URL(location.href);
  const query=new URLSearchParams([...url.searchParams].filter(([name])=>
   ['preparation_plan','replaces','document_id','sales_plan_id','bag_page'].includes(name)||
   (url.pathname==='/loading-plans'&&url.searchParams.has('vehicle_id')&&['tab','vehicle_id','shipment_month'].includes(name))||
   (name==='page'&&!ProductContext.isCopper()&&/^\/stocktaking\/[0-9a-f-]+$/.test(url.pathname))));
  return url.pathname+(query.size?'?'+query:'');
 },
 scope(){
  const section=location.pathname.split('/')[1];
  if(section==='receipts'&&!ProductContext.isCopper())return 'preparation';
  if(section==='export-shipments')return 'outbounds';
  return section;
 },
 fields(form){
  const fields=new Map();
  for(const control of form.querySelectorAll('input,select,textarea')){
   const observationBundle=form.id==='v27-observation'&&control.name==='bundle_no';
   if(control.matches(':disabled')||control.readOnly&&!observationBundle||['hidden','password','file','submit','button','reset'].includes(control.type))continue;
   const {field,bookField,pick,loadPick,lpBundle,gross,location,moved}=control.dataset;
   const bag=control.closest('[data-count-bag]')?.dataset.countBag;
   const bagField=bag&&['present','location','gross','note'].find(name=>Object.hasOwn(control.dataset,name));
   const key=(observationBundle&&control.readOnly?'recorded_bundle_no':'')||(bagField?'count-'+bagField+':'+bag:'')||control.name||field||(bookField?'book:'+bookField:'')||
    (pick?'pick:'+pick:loadPick||lpBundle?'load-pick:'+(loadPick||lpBundle):gross?'gross:'+gross:location?'location:'+location:moved?'moved:'+moved:'')||control.id;
   if(!key||!/^[-\w:]{1,100}$/.test(key)||control.type==='search')continue;
   if(!fields.has(key))fields.set(key,[]);
   fields.get(key).push(control);
  }
  return fields;
 },
 collect(form){
  const saved=[...this.fields(form)].flatMap(([name,controls])=>controls.map((control,i)=>[
   name,i,control.type,['checkbox','radio'].includes(control.type)?control.checked:
    control.type==='select-multiple'?[...control.selectedOptions].map(option=>option.value):control.value
  ]));
  return saved.concat(form.documentDraftFields?.()||[]);
 },
 async fill(form,entries){
  const repeated=entries.reduce((max,[,index])=>Math.max(max,index+1),0);
  const add=form.querySelector('#v26-add,[data-co-add-line],[data-add-line]');
  if(add&&repeated>1){
   const maximum=()=>Math.max(0,...[...this.fields(form).values()].map(values=>values.length));
   for(let count=maximum();count<repeated;count++){
    add.click();if(maximum()<=count)break;
   }
  }
  let unavailable=0;
  for(const [name,i,type,value] of entries){
   if(form.restoreDocumentDraft&&/^(bundle:|bag-|work-version$)/.test(name))continue;
   let control=this.fields(form).get(name)?.[i];
   for(let tryNo=0;!control&&value!==''&&value!==false&&tryNo<12;tryNo++){
    await new Promise(resolve=>setTimeout(resolve,50));control=this.fields(form).get(name)?.[i];
   }
   if(!control){if(value!==''&&value!==false)unavailable++;continue;}
   if(control.type!==type){unavailable++;continue;}
   if(type==='select-one'||type==='select-multiple'){
    const selections=Array.isArray(value)?value:value?[value]:[];
    const hasOptions=()=>selections.every(selected=>[...control.options].some(option=>option.value===selected));
    for(let tryNo=0;tryNo<12&&!hasOptions();tryNo++)
     await new Promise(resolve=>setTimeout(resolve,50));
    if(!hasOptions()){unavailable++;continue;}
   }
   if(['checkbox','radio'].includes(type)){if(control.checked===value)continue;control.checked=value;}
   else if(type==='select-multiple'){for(const option of control.options)option.selected=value.includes(option.value);}
   else{if(control.value===value)continue;if(control.readOnly){unavailable++;continue;}control.value=value;}
   control.dispatchEvent(new Event('input',{bubbles:true}));
   control.dispatchEvent(new Event('change',{bubbles:true}));
  }
  await form.restoreDocumentDraft?.(entries);
  if(unavailable)throw Error(this.t('部分已保存的关联或明细已不可用，请核对后继续','Some saved relationships or lines are unavailable. Review the form before continuing.'));
 },
 async save(form,button){
  const key=this.api(),record=form.documentDraft||{id:crypto.randomUUID(),version:0,route:this.route()};
  form.documentDraft=record;
  const feedback=form.querySelector('[data-draft-feedback]');
  button.disabled=true;
  try{
   if(!form.checkValidity()&&[...form.elements].some(control=>control.validity?.badInput))throw Error(this.t('请修正格式无效的输入','Correct fields with an invalid format'));
   form.documentDraft=await API.request(key+'/'+record.id,{method:'PUT',body:{
    form_key:form.id,route:record.route,fields:this.collect(form),version:record.version
   }});
   feedback.textContent=this.t('草稿已保存','Draft saved');
   this.listCache=null;this.refresh();
   ProductContext.dirty=false;
  }catch(error){feedback.textContent=I18n.translate(error.message,true);}
  finally{button.disabled=false;}
 },
 bind(form){
  if(form.dataset.documentDraftBound||!this.fields(form).size&&!form.documentDraftFields)return;
  form.dataset.documentDraftBound='1';
  let controls=form.querySelector(':scope > .wms-filter-actions,:scope > .wms-form-actions');
  if(!controls){controls=document.createElement('div');controls.className='wms-filter-actions';form.append(controls);}
  const native=['v26-receipt','receipt-editor'].includes(form.id)&&[...form.querySelectorAll('button')].find(button=>
   ['保存草稿','Save Draft'].includes(button.textContent.trim()));
  if(native){
   native.addEventListener('click',event=>{
    if(form.checkValidity())return;
    event.preventDefault();this.save(form,event.currentTarget);
   });
  }else{
   controls.insertAdjacentHTML('beforeend','<button type="button" class="button secondary" data-draft-save>'+this.t('保存草稿','Save Draft')+'</button>');
   controls.querySelector('[data-draft-save]').onclick=event=>this.save(form,event.currentTarget);
  }
  controls.insertAdjacentHTML('beforeend','<span class="wms-feedback" role="status" data-draft-feedback></span>');
  form.addEventListener('submit',()=>this.arm(form),true);
  this.attach(form).catch(error=>{controls.querySelector('[data-draft-feedback]').textContent=I18n.translate(error.message,true);});
 },
 arm(form){
  if(form.documentDraft?.version&&!(this.pending?.form===form&&this.pending.result))
   this.pending={record:form.documentDraft,key:this.api(),matcher:this.forms[form.id][3],form};
 },
 async attach(form){
  const record=this.resume;
  if(!record||record.product_code!==ProductContext.code||record.form_key!==form.id||record.route!==this.route())return;
  this.resume=null;form.documentDraft=record;
  await this.fill(form,record.fields);
  form.querySelector('[data-draft-feedback]').textContent=this.t('已载入草稿','Draft loaded');
  ProductContext.dirty=false;
 },
 lists:{
  '/receipts':['#op-table,#co-intake-table,.business-table table','v26-receipt','receipt-editor','co-create','co469-work-draft'],
  '/preparation':['#op-table,#ux10-preparation-list,.business-table table','v26-preparation','v261-create'],
  '/preparation/work-plans':['#preparation-plans-table','preparation-plan-form'],
  '/loading-plans':['#cu-arrivals-table,#co-arrivals-table','yard-arrival-form','co-arrival-form'],
  '/loading-plans/query':['#co-loading-plans,.business-table table','single-plan-form','co-loading-form','co-loading-documents'],
  '/outbounds':['#op-table,#co-execution-list,.business-table table','v26-load','lp-load-form','pending-load-edit','cu-departure-draft','co-execution-departure','shipping-generate','co-packing-generate'],
  '/stocktaking':['#stocktake-list-table','v27-count-create','v33-count-create','co-count-create','v27-observation','co-count-record'],
  '/export-licenses':['#export-license-table','export-license-application','permit-extension-form'],
  '/sales-plans':['#co-sales-table,#ux10-sales-table','ux10-plan-form','co-sales-plan-form']
 },
 async open(button){
  button.disabled=true;
  try{
   const record=await API.request(this.api()+'/'+button.dataset.draftOpen);
   this.resume=record;
   await Router.go(record.route);
   if(record.form_key==='preparation-plan-form'){
    const id=location.pathname.split('/')[3];
    PreparationPlans.form(id?await API.request(PreparationPlans.api()+'/'+id):null);
   }else if(record.form_key==='pending-load-edit'&&$('edit-pending-load')){
    $('edit-pending-load').click();
   }else if(record.form_key==='v27-observation'){
    const bundle=record.fields.find(([key])=>key==='recorded_bundle_no')?.[3];
    const trigger=bundle?[...document.querySelectorAll('[data-v27-edit-count]')].find(entry=>entry.dataset.v27EditCount===bundle):$('v27-record');
    if(!trigger)throw Error(this.t('该盘点记录当前不可编辑','This stocktake observation is no longer editable'));
    await trigger.onclick();
   }else if(!document.getElementById(record.form_key)){
    throw Error(this.t('请在此单据打开原填写入口以继续草稿','Open the original entry form on this document to resume'));
   }else{
    const form=document.getElementById(record.form_key);
    for(let container=form.closest('details');container;container=container.parentElement?.closest('details'))container.open=true;
   }
  }catch(error){this.resume=null;notify(I18n.translate(error.message,true));}
  finally{button.disabled=false;}
 },
 async remove(row){
  if(!await OperationConfirm.ask({title:this.t('删除这份草稿？','Delete this draft?')}))return;
  try{
   await API.request(this.api()+'/'+row.id,{method:'DELETE',body:{version:row.version}});
   this.listCache=null;
   this.refresh();
  }catch(error){notify(I18n.translate(error.message,true));}
 },
 draftRow(table,headers,row){
  const entry=table.tBodies[0].insertRow(0),type=this.forms[row.form_key];
  entry.dataset.documentDraftRow=row.id;
  const title=this.t(type[0],type[1]),date=OperationWorkspace.date(row.updated_at);
  const status=headers.findIndex(h=>/状态|status|workflow/i.test(h.textContent));
  const created=headers.findIndex(h=>/创建日期|创建时间|^created/i.test(h.textContent));
  const action=headers.findIndex(h=>/^(操作|Actions?)$/i.test(h.textContent.trim()));
  headers.forEach((header,index)=>{
   const cell=entry.insertCell();
   cell.dataset.label=header.textContent.trim();
   if(header.dataset.wmsColumn)cell.dataset.wmsColumn=header.dataset.wmsColumn;
   cell.textContent='—';
   if(index===0){
    cell.dataset.noI18n='';
    cell.textContent=row.display_no||title+' · '+row.id.slice(0,8);
    if(row.display_no){const label=document.createElement('small');label.textContent=title;cell.append(label);}
   }
   if(index===created)cell.textContent=date;
   if(index===status)cell.innerHTML=UI.status('DRAFT','approval',this.t('草稿','Draft'));
   if(index===(action<0?headers.length-1:action)){
    cell.innerHTML='<div class="wms-row-actions">'+(status<0?UI.status('DRAFT','approval',this.t('草稿','Draft')):'')+
     '<button type="button" class="button secondary compact" data-draft-open="'+esc(row.id)+'">'+this.t('继续填写','Continue')+'</button>'+
     '<button type="button" class="button danger-outline compact" data-draft-close="'+esc(row.id)+'">'+this.t('删除草稿','Delete Draft')+'</button></div>';
    cell.querySelector('[data-draft-open]').onclick=event=>this.open(event.currentTarget);
    cell.querySelector('[data-draft-close]').onclick=()=>this.remove(row);
   }
  });
 },
 async list(){
  const route=location.pathname,spec=this.lists[route],root=$('page-content');
  const q=new URLSearchParams(location.search);
  const state=q.get('state')||q.get('status'),view=q.get('view');
  const departureList=route==='/outbounds'&&view==='departures';
  const documentList=route==='/outbounds'&&view==='shipments';
  if(!spec||q.has('workflow')||Number(q.get('page')||1)>1||
   state&&!['ALL','DRAFT'].includes(state.toUpperCase())||q.get('work_status')||q.get('document_status')||
   route==='/loading-plans'&&(q.has('vehicle_id')||q.has('tab')&&q.get('tab')!=='arrivals')||
   route==='/outbounds'&&view==='printers'||route==='/export-licenses'&&view==='legacy')return;
  const [selector,...keys]=departureList?['#cu-departures-table,#co-departures-table','cu-departure-draft','co-execution-departure']:
   documentList?['#co-execution-list,.business-table table','shipping-generate','co-packing-generate']:spec;
  const table=root.querySelector(selector);
  if(!table?.tBodies[0]||!table.tHead?.rows[0]||$('business-page').hidden)return;
  const language=I18n.language,context=ProductContext.code+'|'+location.href+'|'+Router.sequence;
  if(this.listCache?.context!==context){
   const request=API.request(this.api()+'?'+new URLSearchParams({module:this.scope()}));
   this.listCache={context,request};
  }
  const {items}=await this.listCache.request;
  if(context!==ProductContext.code+'|'+location.href+'|'+Router.sequence||!table.isConnected||I18n.language!==language)return;
  const search=(q.get('search')||'').trim().toLowerCase();
  const rows=items.filter(row=>keys.includes(row.form_key)&&
   (!q.get('created_date')||OperationWorkspace.date(row.updated_at)===q.get('created_date'))&&
   (!search||[row.display_no,...this.forms[row.form_key].slice(0,2)].some(value=>value?.toLowerCase().includes(search))));
  const signature=language+'|'+rows.map(row=>row.id+':'+row.version).join('|');
  if(table.dataset.documentDraftSignature===signature)return;
  table.dataset.documentDraftSignature=signature;
  const body=table.tBodies[0],headers=[...table.tHead.rows[0].cells];
  body.querySelectorAll('[data-document-draft-row]').forEach(row=>row.remove());
  const empty=body.rows.length===1&&body.rows[0].cells[0].colSpan>1?body.rows[0]:null;
  if(empty)empty.hidden=rows.length>0;
  if(rows.length){
   delete table.dataset.s46Empty;
   if(table.nextElementSibling?.matches('.s46-empty-container'))table.nextElementSibling.remove();
  }
  for(const row of rows.reverse())this.draftRow(table,headers,row);
 },
 refresh(){
  for(const form of document.querySelectorAll('#page-content form,#dialog-content form'))if(this.forms[form.id])this.bind(form);
  this.list().catch(error=>{if(error.status!==401&&error.status!==403)console.warn('Document draft list:',error.message);});
 },
 install(){
  if(this.installed)return;
  this.installed=true;
  const request=API.request.bind(API);
  API.request=async(url,options={})=>{
   const pending=this.pending;
   if(!pending||!pending.form.isConnected||!['POST','PATCH','PUT'].includes(options.method)||!pending.matcher.test(url))return request(url,options);
   if(!pending.result){
    pending.result=(async()=>{
     const path=pending.key+'/'+pending.record.id;
     const current=await request(path);
     if(current.version!==pending.record.version)throw Error(this.t('草稿已在另一窗口更新，请重新打开','Draft changed in another window. Reopen it first.'));
     const result=await request(url,{...options,idempotencyKey:pending.record.id});
     try{await request(path,{method:'DELETE',body:{version:current.version}});this.listCache=null;}
     catch{notify(this.t('业务单据已保存，草稿清理待重试','Document saved. Draft cleanup can be retried.'));}
     return result;
    })().catch(error=>{if(this.pending===pending)this.pending=null;throw error;});
   }
   return pending.result;
  };
  const observer=new MutationObserver(()=>this.refresh());
  for(const id of ['page-content','dialog-content'])observer.observe($(id),{childList:true,subtree:true});
  this.refresh();
 }
};
