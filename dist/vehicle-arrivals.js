'use strict';
const LoadingYard={states:{WAITING_ARRIVAL:'待到厂登记',PENDING_CONFIRMATION:'待修改确认',WAITING_PLAN:'等待创建装车计划',PLANNED:'已创建装车计划',CANCELLED:'已取消'},fields:{trailer_one:'挂车1车牌号',trailer_two:'挂车2车牌号（选填）',driver_name:'司机全名',passport_no:'司机护照号',container_no:'集装箱号（选填）'},
 async page(){const q=new URLSearchParams(location.search),month=q.get('shipment_month')||new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7),query=new URLSearchParams({shipment_month:month,...(q.get('customer_id')?{customer_id:q.get('customer_id')}: {}),...(q.get('sales_plan_id')?{sales_plan_id:q.get('sales_plan_id')}:{}),...(q.get('status')?{status:q.get('status')}: {}),...(q.get('arrival_date')?{arrival_date:q.get('arrival_date')}:{}),...(q.get('truck_no')?{truck_no:q.get('truck_no')}: {})}),data=await API.request('/loading-plans/arrivals?'+query);if(q.has('vehicle_id'))return this.form(data.items.find(r=>r.dispatch_vehicle_id===q.get('vehicle_id')));const master=await Business.load();Router.page('车辆到厂登记',`<div class="business-toolbar yard-tabs"><a class="button primary" href="/loading-plans">车辆到厂登记</a><a class="button secondary" href="/loading-plans/query">装车计划查询</a><span class="yard-step">派车单 → 到厂登记 → 装车计划 → 装车及出库</span></div><div class="yard-counts">${Object.entries(this.states).map(([k,v])=>`<article><span>${v}</span><strong data-no-i18n>${data.items.filter(r=>r.arrival_state===k).length}</strong></article>`).join('')}</div><form id="yard-filter" class="filters"><div class="form-grid"><label>发运月份<input name="shipment_month" type="month" value="${esc(month)}" required></label><label>客户名称<select name="customer_id"><option value="">全部客户</option>${Business.options(master.customers,q.get('customer_id'),'name')}</select></label><label>状态<select name="status"><option value="">全部状态</option>${Object.entries(this.states).map(([key,label])=>`<option value="${key}" ${q.get('status')===key?'selected':''}>${label}</option>`).join('')}</select></label></div><button class="button secondary">查询</button>${Business.can('inventory:export')?'<button type="button" id="yard-export" class="button secondary">导出Excel</button>':''}</form><div class="business-table yard-arrival-table"><table id="cu-arrivals-table"><thead><tr><th>客户 / 销售计划</th><th>发运月份</th><th>车头号</th><th>载重（吨）</th><th>到达时间</th><th>状态</th><th>操作</th></tr></thead><tbody>${data.items.map(r=>`<tr class="${r.arrival_id?'yard-arrived':''}"><td data-no-i18n>${esc(r.customer_name)}<br>${esc(r.sales_plan_code)}</td><td data-no-i18n>${esc(r.shipment_month)}</td><td data-no-i18n>${esc(r.truck_no)}</td><td>${r.capacity_tonnes?Tonnes.format(r.capacity_tonnes):'未提供'}</td><td data-no-i18n>${r.arrived_at?BusinessTime.display(r.arrived_at):'—'}</td><td>${this.states[r.arrival_state]}</td><td>${['WAITING_ARRIVAL','PENDING_CONFIRMATION','WAITING_PLAN'].includes(r.arrival_state)&&Business.can('vehicle-arrival:write')?`<a class="button secondary" href="/loading-plans?tab=arrivals&${query}&vehicle_id=${r.dispatch_vehicle_id}">${r.arrival_id&&r.registration_phase!=='CLEARED'||r.arrival_state==='PENDING_CONFIRMATION'?'编辑到厂登记':'登记车辆到厂'}</a>`:''}${r.arrival_state==='WAITING_PLAN'&&Business.can('loading-plan:write')?`<a class="button primary" href="/loading-plans/new?sales_plan_id=${r.sales_plan_id}&arrival_id=${r.arrival_id}">创建装车计划</a>`:''}${r.plan_document_id?`<a class="button secondary" href="/loading-plans/orders/${r.plan_document_id}">查看装车计划</a>`:''}</td></tr>`).join('')||'<tr><td colspan="7">该客户发运月份暂无有效派车车辆，请先上传派车单。</td></tr>'}</tbody></table></div>`);LoadingFiltersR9.arrivals($('yard-filter'),master.customers,false,query);$('yard-filter').onsubmit=e=>{e.preventDefault();Router.go('/loading-plans?tab=arrivals&'+new URLSearchParams(new FormData(e.target)));};},
 async export(query,b=$('yard-export')){b.disabled=true;try{const r=await API.request('/loading-plans/arrivals/export',{method:'POST',body:Object.fromEntries(query),binary:true}),a=document.createElement('a'),url=URL.createObjectURL(r.blob);a.href=url;a.download=r.filename||'Vehicle_Arrivals_CU.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(e){notify(e.message);}finally{if(b.isConnected)b.disabled=false;}},
 t:(zh,en)=>I18n.language==='en'?en:zh,
 arrivalActions(back,confirm,r){
  const t=this.t;
  return '<div class="wms-form-actions wms-arrival-actions">'+
   (r.arrival_id&&r.registration_phase!=='CLEARED'?'<button type="button" class="button danger-outline" data-arrival-clear>'+t('取消到场并清除登记信息','Cancel Arrival and Clear Details')+'</button>':'')+
   '<div class="wms-filter-actions"><a class="button secondary" href="'+esc(back)+'">'+t('返回车辆列表','Back to Vehicles')+'</a>'+
   '<button type="button" class="button secondary" data-arrival-save>'+t('保存草稿','Save Draft')+'</button>'+
   '<button type="submit" class="button primary">'+esc(confirm)+'</button></div></div>';
 },
 async bindArrival(form,r,route,back,version,reportError){
  const t=this.t,vehicleId=r.dispatch_vehicle_id||r.id;
  if((r.arrival_state==='PENDING_CONFIRMATION'||r.registration_state==='PENDING_CONFIRMATION')&&r.registration_phase!=='DRAFT'&&window.DocumentDrafts){
   try{
    const api=DocumentDrafts.api(),list=await API.request(api+'?module=loading-plans');
    const draft=list.items.find(row=>row.form_key===form.id&&new URL(row.route,location.origin).searchParams.get('vehicle_id')===vehicleId&&
     (!r.arrival_updated_at||Date.parse(row.updated_at)>Date.parse(r.arrival_updated_at)));
    if(draft&&form.isConnected)await DocumentDrafts.fill(form,(await API.request(api+'/'+draft.id)).fields);
   }catch(error){reportError(error);}
  }
  let working=false;
  const save=async action=>{
   if(working)return;
   const controls=[...form.querySelectorAll('button')];working=true;
   for(const button of controls)button.disabled=true;
   try{
    if(action!=='DRAFT'&&!await OperationConfirm.ask({title:action==='CLEAR'?t('取消到场并清除登记信息？','Cancel arrival and clear its details?'):
     t('确认车辆已到场？','Confirm that the vehicle has arrived?'),rows:[[t('车头号','Truck'),r.truck_no],[t('客户','Customer'),r.customer_name]]}))return;
    const data=action==='CLEAR'?{}:Object.fromEntries(new FormData(form));
    if(data.arrived_at)data.arrived_at=BusinessTime.toISO(data.arrived_at);
    await API.request(route,{method:'POST',body:{...data,...version,action}});
    ProductContext.dirty=false;
    await Router.go(back);
    if(action==='DRAFT')notify(t('草稿已保存，待修改确认','Draft saved. Pending confirmation.'));
    if(action==='CLEAR')notify(t('已取消到场并清除登记信息','Arrival cancelled and details cleared'));
   }catch(error){reportError(error);}
   finally{working=false;for(const button of controls)button.disabled=false;}
  };
  form.onsubmit=e=>{e.preventDefault();return save('CONFIRM');};
  form.querySelector('[data-arrival-save]').onclick=()=>save('DRAFT');
  const clear=form.querySelector('[data-arrival-clear]');if(clear)clear.onclick=()=>save('CLEAR');
 },
 async form(r){
  if(!Business.can('vehicle-arrival:write'))throw Error('没有车辆到厂登记权限');
  if(!r||r.cancelled_at||r.plan_document_id)throw Error('车辆已取消、已创建计划或不在当前筛选范围');
  const back='/loading-plans?tab=arrivals&shipment_month='+r.shipment_month,hasRecord=!!r.registration_phase;
  const fields=Object.entries(this.fields).map(([k,label])=>'<label class="wms-field">'+label+
   '<input name="'+k+'" value="'+esc(hasRecord?r[k]||'':k==='trailer_one'?r.trailer_no||'':'')+'" maxlength="'+
   (k==='driver_name'?160:k==='container_no'?40:80)+'" '+(['trailer_one','driver_name','passport_no'].includes(k)?'required':'')+'></label>').join('');
  Router.page('车辆到厂登记','<div class="lot-context-grid">'+
   [['客户名称',r.customer_name],['发运月份',r.shipment_month],['车头号',r.truck_no]].map(([label,value])=>'<article><span>'+label+'</span><strong data-no-i18n>'+esc(value)+'</strong></article>').join('')+
   '</div><form id="yard-arrival-form" class="user-form" data-arrival-native data-wms-validation><div class="form-grid wms-field-grid">'+
   '<label class="wms-field">到达时间（卢本巴希）<input name="arrived_at" type="datetime-local" required value="'+
   esc(r.arrived_at?BusinessTime.input(r.arrived_at):hasRecord?'':BusinessTime.input(new Date()))+'"></label>'+fields+
   '</div><p id="yard-error" class="wms-feedback error" role="alert"></p>'+this.arrivalActions(back,'确认到厂并提交',r)+'</form>');
  await this.bindArrival($('yard-arrival-form'),r,'/loading-plans/arrivals/'+r.dispatch_vehicle_id,back,r.arrival_id?{version:r.version}:{},error=>{
   if($('yard-error'))$('yard-error').textContent=I18n.translate(error.message,true);
  });
 },
 async enhance(id){
  const form=$('single-plan-form');
  if(!form||form.querySelector('#yard-arrival-choice'))return;
  const query=new URLSearchParams(location.search),save=form.querySelector('button[type=submit]');
  save.disabled=true;
  const current=id?await API.request('/loading-plans/unified/documents/'+id):null;
  if(!form.isConnected)return;
  const label=document.createElement('label'),notice=document.createElement('div');
  label.className='yard-arrival-choice';
  label.innerHTML='<span>已登记到厂车辆</span><select name="arrival_id" id="yard-arrival-choice"></select><small id="yard-arrival-help"></small>';
  notice.className='dispatch-transport-notice';
  notice.dataset.dispatchVerification='';
  notice.setAttribute('role','status');
  notice.hidden=true;
  const plan=form.elements.sales_plan_id,select=label.querySelector('select'),help=label.querySelector('small');
  plan.closest('label').after(label,notice);
  select.required=!current||current.arrival_required||!!current.arrival_id;
  const placeholder='<option value="">请选择等待创建计划的车辆</option>';
  let rows=[],sequence=0;
  const selected=()=>rows.find(row=>row.arrival_id===select.value);
  select.onchange=()=>{
   const row=selected();
   DispatchTransport.fill(form,row,!!id);
   const plate=form.elements.vehicle_no;
   if(row)plate.value=row.truck_no;
   else if(!current)plate.value='';
   plate.readOnly=!!row||select.required;
   save.disabled=!DispatchTransport.verifyPlan(form,row,current);
   I18n.apply();
  };
  const load=async()=>{
   const request=++sequence,planId=plan.value;
   form.operationArrivals=rows=[];
   select.innerHTML=placeholder;
   help.replaceChildren();
   select.onchange();
   if(!planId)return;
   try{
    const result=await API.request('/loading-plans/arrivals?sales_plan_id='+planId);
    if(!form.isConnected||request!==sequence)return;
    form.operationArrivals=rows=result.items.filter(row=>row.arrival_id&&
     (row.arrival_state==='WAITING_PLAN'||row.arrival_id===current?.arrival_id));
    const chosen=current?.arrival_id||query.get('arrival_id');
    select.innerHTML=placeholder+rows.map(row=>'<option value="'+esc(row.arrival_id)+'" '+
     (chosen===row.arrival_id?'selected':'')+'>'+esc(row.truck_no+' · '+row.shipment_month+' · '+row.driver_name)+'</option>').join('');
    help.innerHTML=rows.length?'':'暂无已登记到厂的车辆。<a href="/loading-plans?tab=arrivals">查看到厂登记</a>';
    select.onchange();
   }catch(e){if(form.isConnected&&request===sequence)$('single-plan-error').textContent=I18n.translate(e.message,true);}
  };
  const prior=plan.onchange,submit=form.onsubmit;
  plan.onchange=async()=>{await Promise.all([load(),prior?.()]);};
  form.onsubmit=e=>{
   if(!DispatchTransport.verifyPlan(form,selected(),current)){
    e.preventDefault();
    I18n.apply();
    return;
   }
   return submit.call(form,e);
  };
  await load();
 }
};
const yardPlanForm=SinglePlan.form.bind(SinglePlan);SinglePlan.form=async function(id,legacy){await yardPlanForm(id,legacy);await LoadingYard.enhance(id);};
const yardList=Management.list.bind(Management);Management.list=async function(kind){if(kind==='loading'&&location.pathname==='/loading-plans')return LoadingYard.page();await yardList(kind);if(kind==='loading'){const tabs=document.createElement('div');tabs.className='business-toolbar yard-tabs';tabs.innerHTML='<a class="button secondary" href="/loading-plans">车辆到厂登记</a><a class="button primary" href="/loading-plans/query">装车计划查询</a>';$('page-content').prepend(tabs);I18n.apply();}};
const yardInit=Router.init.bind(Router);Router.init=async function(){Router.add(/^\/loading-plans\/query$/,()=>Management.list('loading'));return yardInit();};
const yardPlanDetail=SinglePlan.detail.bind(SinglePlan);SinglePlan.detail=async function(id){await yardPlanDetail(id);const d=await API.request('/loading-plans/unified/documents/'+id);if(d.arrival_transport){const section=document.createElement('section');section.className='lot-summary-detail lp-arrival-transport';section.innerHTML='<h3>到厂运输信息</h3><dl class="lp-fields">'+Object.entries(LoadingYard.fields).map(([k,l])=>'<dt>'+l+'</dt><dd data-no-i18n>'+esc(d.arrival_transport[k]||'—')+'</dd>').join('')+'</dl>';$('page-content').append(section);I18n.apply();}};LoadingPlans.doc=SinglePlan.detail.bind(SinglePlan);

const yardShippingDetail=Shipping.detail.bind(Shipping);Shipping.detail=async function(id){await yardShippingDetail(id);const d=await API.request('/shipping/'+id);if(d.loading_plan?.arrival_id){const form=$('shipping-transport-form');for(const key of Object.keys(LoadingYard.fields))if(form?.elements[key])form.elements[key].readOnly=true;const note=document.createElement('p');note.className='dialog-notice';note.textContent='司机、挂车及集装箱信息来自到厂登记，已与装车计划关联。';form?.before(note);I18n.apply();}};
