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
 async browse(scope){
  const {items}=await API.request(this.api()+'?'+new URLSearchParams({module:scope}));
  const title=this.t('我的草稿','My Drafts');
  dialog(title,items.length?'<div class="business-table"><table><thead><tr><th>'+this.t('单据类型','Document Type')+
   '</th><th>'+this.t('最近保存','Last Saved')+'</th><th>'+this.t('操作','Actions')+'</th></tr></thead><tbody>'+items.map(row=>{
    const type=this.forms[row.form_key];
    return '<tr><td>'+esc(type?this.t(type[0],type[1]):row.form_key)+'</td><td>'+esc(BusinessTime.display(row.updated_at))+
     '</td><td><div class="wms-filter-actions"><button class="button secondary" data-draft-open="'+esc(row.id)+'">'+this.t('继续填写','Continue')+
     '</button><button class="button danger-outline" data-draft-close="'+esc(row.id)+'">'+this.t('删除草稿','Delete Draft')+'</button></div></td></tr>';
   }).join('')+'</tbody></table></div>':'<p>'+this.t('当前模块没有已保存的草稿','No saved drafts for this module')+'</p>');
  for(const button of $('dialog-content').querySelectorAll('[data-draft-open]'))button.onclick=async()=>{
   button.disabled=true;
   try{
    const record=await API.request(this.api()+'/'+button.dataset.draftOpen);
    this.resume=record;
    $('dialog').close();
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
  };
  for(const button of $('dialog-content').querySelectorAll('[data-draft-close]'))button.onclick=async()=>{
   if(!await OperationConfirm.ask({title:this.t('删除这份草稿？','Delete this draft?')}))return;
   try{
    const row=items.find(item=>item.id===button.dataset.draftClose);
    await API.request(this.api()+'/'+row.id,{method:'DELETE',body:{version:row.version}});
    $('dialog').close();await this.browse(scope);
   }catch(error){notify(I18n.translate(error.message,true));}
  };
 },
 refresh(){
  for(const form of document.querySelectorAll('#page-content form,#dialog-content form'))if(this.forms[form.id])this.bind(form);
  const scope=this.scope(),header=$('business-page')?.querySelector('.page-heading');
  const permissions={preparation:['allocation:write','co:create','co:work-edit','plan:read'],receipts:['receipt:write'],outbounds:['load:write','load:execute','document:generate'],
   'loading-plans':['loading-plan:write','vehicle-arrival:write'],stocktaking:['stocktake:write'],'export-licenses':['export-license:write'],'sales-plans':['plan:write']};
  const available=permissions[scope]?.some(permission=>Business.can(permission))&&header&&!$('business-page').hidden;
  const current=$('module-document-drafts');
  if(!available){current?.remove();return;}
  if(current)return;
  const button=document.createElement('button');button.id='module-document-drafts';button.type='button';button.className='button secondary';
  button.textContent=this.t('我的草稿','My Drafts');button.onclick=()=>this.browse(this.scope()).catch(error=>notify(error.message));
  header.append(button);
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
     try{await request(path,{method:'DELETE',body:{version:current.version}});}
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
