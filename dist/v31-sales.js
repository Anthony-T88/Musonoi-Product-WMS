'use strict';
const customerMasterForm=Business.masterForm.bind(Business);
Business.masterForm=async function(type,row={}){
 if(type!=='customers')return customerMasterForm(type,row);const d=await this.load();
 this.open(row.id?'编辑客户档案':'新增客户',`<form id="customer-form" class="user-form"><div class="form-grid"><label>客户名称<input name="name" required maxlength="160" value="${esc(row.name||'')}"></label><label>客户代码<input name="code" required maxlength="60" value="${esc(row.code||'')}"></label><label>项目<select name="project_id" ${row.id?'disabled':''}>${this.options(d.projects,row.project_id,'name')}</select></label><label>邮件<input type="email" name="email" maxlength="320" value="${esc(row.email||'')}"></label><label>联系电话<input type="tel" name="phone" maxlength="80" value="${esc(row.phone||'')}"></label><label>状态<select name="active"><option value="true">启用</option><option value="false" ${row.active===false?'selected':''}>停用</option></select></label></div><label>地址<textarea name="address" maxlength="1000">${esc(row.address||'')}</textarea></label><p class="error" id="customer-error" role="alert"></p><button class="button primary">保存客户</button><a class="button secondary" href="/customers">返回客户管理</a></form>`);
 $('customer-form').onsubmit=async e=>{e.preventDefault();e.submitter.disabled=true;try{const body=Object.fromEntries(new FormData(e.target));body.active=body.active==='true';if(row.id)body.version=row.version;await API.request('/masters/customers'+(row.id?'/'+row.id:''),{method:row.id?'PATCH':'POST',body});await Router.go('/customers');notify('客户已保存');}catch(err){$('customer-error').textContent=err.message;e.submitter.disabled=false;}};
};
const Dispatch={
 t:(z,e)=>I18n.language==='en'?e:z,
 vehicleMonthButton(vehicle,allowed){
  if(!allowed)return '';
  return '<button type="button" class="button secondary" data-dispatch-vehicle-month="'+esc(vehicle.id)+'">'+
   this.t('派车月份调整','Adjust Dispatch Month')+'</button>';
 },
 bindVehicleMonth(path,vehicles,targets,refresh){
  const t=this.t;
  const months=[...new Set(targets.map(plan=>plan.shipment_month))];
  for(const button of document.querySelectorAll('[data-dispatch-vehicle-month]'))button.onclick=()=>{
   const vehicle=vehicles.find(v=>v.id===button.dataset.dispatchVehicleMonth);
   if(!vehicle)return;
   const title=t('派车月份调整','Adjust Dispatch Month');
   dialog(title,`<form id="dispatch-vehicle-month-form" class="user-form" data-wms-validation data-no-i18n>
    ${UI46Pages.factList([[t('车牌','Truck Plate'),esc(vehicle.truck_no)],
     [t('当前派车月份','Current Dispatch Month'),esc(vehicle.shipment_month)]])}
    <div class="form-grid wms-field-grid"><label class="wms-field">${t('目标派车月份','Destination Dispatch Month')}
     <select name="shipment_month" required ${months.length?'':'disabled'}>
      <option value="">${t('请选择月份','Select a month')}</option>
      ${months.map(month=>'<option value="'+esc(month)+'">'+esc(month)+'</option>').join('')}
     </select></label>
     <label class="wms-field">${t('目标销售计划','Destination Sales Plan')}
      <select name="target_plan_id" required disabled><option value="">${t('请先选择月份','Select a month first')}</option></select>
     </label></div>
    ${months.length?'':'<p class="wms-feedback" role="status">'+t('同一客户暂无可转入的其他月份销售计划。','This customer has no eligible sales plans in another month.')+'</p>'}
    <p id="dispatch-month-error" class="error" role="alert"></p>
    <div class="business-toolbar wms-form-actions"><button type="button" class="button secondary" id="dispatch-month-cancel">${t('取消','Cancel')}</button>
     <button type="submit" class="button primary" disabled>${t('确认转移','Confirm Transfer')}</button></div></form>`,{protectForm:'#dispatch-vehicle-month-form'});
   const form=$('dispatch-vehicle-month-form'),modal=form.closest('dialog'),error=$('dispatch-month-error');
   const {shipment_month:monthField,target_plan_id:planField}=form.elements,save=form.querySelector('[type=submit]');
   monthField.onchange=()=>{
    const selected=monthField.value;
    planField.replaceChildren(new Option(selected?t('请选择目标销售计划','Select a destination sales plan'):
     t('请先选择月份','Select a month first'),''));
    for(const plan of targets.filter(row=>row.shipment_month===selected)){
     planField.add(new Option([plan.code,plan.contract_no,plan.warehouse_name].filter(Boolean).join(' · '),plan.id));
    }
    planField.disabled=!selected;save.disabled=true;error.textContent='';
   };
   planField.onchange=()=>{save.disabled=!planField.value;error.textContent='';};
   $('dispatch-month-cancel').onclick=()=>modal.close();
   form.onsubmit=e=>{
    e.preventDefault();
    if(save.disabled)return;
    return UI46Pages.submit(e,async()=>{
     monthField.disabled=planField.disabled=true;
     try{
      const moved=await API.request(path+'/vehicles/'+vehicle.id+'/month',{method:'POST',
       body:{shipment_month:monthField.value,previous_month:vehicle.shipment_month,target_plan_id:planField.value}});
      ProductContext.dirty=false;modal.close();await refresh();
      notify(t('车辆已转移至 ','Vehicle transferred to ')+moved.sales_plan_code+' · '+moved.shipment_month);
     }catch(err){
      error.textContent=err.message==='CO_SALES_NOT_FOUND'?t('车辆或目标销售计划已变化，请刷新后重试。',
       'The vehicle or destination sales plan changed. Refresh and try again.'):I18n.translate(err.message,true);
     }finally{monthField.disabled=planField.disabled=false;}
    });
   };
  };
 },
 mappingPanel(p,current,change){p.sheets=p.sheets||[current?.sheet].filter(Boolean);const m=current||{sheet:p.sheets[0],header_row:1,truck_column:1,capacity_column:null,capacity_kg:false};$('dispatch-mapping').innerHTML=`<details class="lp-load-summary" ${current?'':'open'}><summary>调整识别列</summary><div class="form-grid"><label>工作表<select id="dispatch-sheet">${p.sheets.map(s=>'<option '+(m.sheet===s?'selected':'')+'>'+esc(s)+'</option>').join('')}</select></label><label>表头行号<input id="dispatch-header" type="number" min="1" max="60" value="${m.header_row}"></label><label>车头列号（A=1）<input id="dispatch-truck" type="number" min="1" max="256" value="${m.truck_column}"></label><label>载重列号（选填，A=1）<input id="dispatch-capacity" type="number" min="1" max="256" value="${m.capacity_column||''}"></label><label>运输商列号（选填，A=1）<input id="dispatch-transporter" type="number" min="1" max="256" value="${m.transporter_column||''}"></label><label>目的地列号（选填，A=1）<input id="dispatch-destination" type="number" min="1" max="256" value="${m.destination_column||''}"></label><label>载重单位<select id="dispatch-unit"><option value="t">吨</option><option value="kg" ${m.capacity_kg?'selected':''}>kg</option></select></label></div><p>修改识别列后，请再次读取预览。</p></details>`;const update=()=>change({sheet:$('dispatch-sheet').value,header_row:Number($('dispatch-header').value),truck_column:Number($('dispatch-truck').value),capacity_column:$('dispatch-capacity').value?Number($('dispatch-capacity').value):null,capacity_kg:$('dispatch-unit').value==='kg',transporter_column:$('dispatch-transporter').value?Number($('dispatch-transporter').value):undefined,destination_column:$('dispatch-destination').value?Number($('dispatch-destination').value):undefined});$('dispatch-mapping').onchange=update;if(!current)update();},
 table(rows,{saved=false,remove=false,change=false,transportOnly=false}={}){
  const actions=remove||change;
  return `<div class="business-table"><table><thead><tr><th>Excel行号</th><th>车头号</th>${saved?'<th>派车月份</th>':''}${transportOnly?'':'<th>载重（吨）</th>'}<th>运输商</th><th>目的地</th><th>识别结果</th>${actions?'<th>操作</th>':''}</tr></thead><tbody>${rows.map(r=>{
   const removeButton=remove&&r.can_remove&&!r.cancelled_at?'<button type="button" class="button secondary danger" data-dispatch-remove="'+r.id+'">删除车辆</button>':'';
   const changeButton=this.vehicleMonthButton(r,change&&r.can_transfer);
   return `<tr><td>${r.source_row}</td><td data-no-i18n>${esc(r.truck_no)}</td>${saved?'<td data-no-i18n>'+esc(r.shipment_month||'—')+'</td>':''}
    ${transportOnly?'':`<td>${r.capacity_tonnes?Tonnes.format(r.capacity_tonnes):'未提供'}</td>`}<td data-no-i18n>${esc(r.transporter||'—')}</td><td data-no-i18n>${esc(r.destination||'—')}</td><td>${saved?r.cancelled_at?'已取消 · 不计入':r.counted===false?'重复车辆 · 不计入':'已保存':DispatchTransport.outcome(r,transportOnly)}</td>
    ${actions?'<td><div class="wms-dispatch-row-actions">'+(removeButton+changeButton||'<span>—</span>')+'</div></td>':''}</tr>`;
  }).join('')}</tbody></table></div>`;
 },
 async page(id){
  const expanded=new Set([...document.querySelectorAll('[data-dispatch-import][open]')].map(group=>group.dataset.dispatchImport));
  const path='/plans/'+id+'/dispatch',d=await API.request(path),writable=Business.can('dispatch:write')&&d.plan.status==='OPEN';
  const search=DispatchTransport.search(id,d.vehicles),groups=new Map();
  for(const row of search.rows){
   if(!groups.has(row.import_id))groups.set(row.import_id,[]);
   groups.get(row.import_id).push(row);
  }
  Router.page('派车管理',LoadingPlans.context({...d.plan,sales_plan_code:d.plan.code})+`<div class="business-toolbar"><a class="button secondary" href="/sales-plans">返回销售管理</a></div><p>计划发运月份 <strong data-no-i18n>${esc(d.plan.preparation_month||'待销售计划维护')}</strong></p><div class="shipping-kpis">${[['去重车辆数',d.summary?.vehicle_count||0],['车辆载重合计（吨）',Tonnes.format(d.summary?.total_capacity_tonnes||'0')],['未提供载重车辆',d.summary?.unknown_capacity_count||0]].map(([k,v])=>'<article><span>'+k+'</span><strong>'+v+'</strong></article>').join('')}</div>${writable?`<section class="lp-load-summary"><h3 class="p46-card-title" data-dispatch-import-title>导入客户派车单</h3>
   <form id="dispatch-form" class="user-form" data-dispatch-excel-import>${DispatchTransport.importFields(d.vehicles,d.dispatch_month.month)}
    <div class="business-toolbar">
     <button id="dispatch-preview" data-dispatch-preview type="button" class="button secondary">读取预览</button>
     <button id="dispatch-save" type="submit" class="button primary" disabled>确认保存</button></div>
    <p id="dispatch-error" class="error" role="alert"></p><div id="dispatch-mapping"></div><div id="dispatch-rows" data-dispatch-preview-rows></div>
   </form></section>`:''}<h3>已保存派车单</h3>${search.form}${writable?'':DispatchTransport.notice(d.vehicles,false,d.plan.status==='CLOSED')}${d.imports.filter(i=>groups.has(i.id)).map(i=>`<details class="lp-load-summary" data-dispatch-import="${esc(i.id)}" ${search.term||expanded.has(i.id)?'open':''}><summary><strong data-no-i18n>${esc([...new Set(groups.get(i.id).map(row=>row.shipment_month))].sort().join(' / '))}</strong> · <span data-no-i18n>${esc(i.file_name)}</span> · ${groups.get(i.id).length} 辆</summary><p data-no-i18n>${esc(i.created_by_name)} · ${esc(new Date(i.created_at).toLocaleString())}</p>${this.table(groups.get(i.id),{saved:true,remove:Business.can('dispatch:write'),change:d.dispatch_month.can_change})}</details>`).join('')||'<p>'+(search.term?esc(search.empty):'暂无派车记录')+'</p>'}`);
  DispatchTransport.bindSearch();
  this.bindVehicleMonth(path,d.vehicles,d.dispatch_month.targets,()=>this.page(id));
 document.querySelectorAll('[data-dispatch-remove]').forEach(button=>button.onclick=async()=>{const vehicle=d.vehicles.find(v=>v.id===button.dataset.dispatchRemove);if(!vehicle)return;button.disabled=true;try{await API.request('/plans/'+id+'/dispatch/vehicles/'+vehicle.id,{method:'DELETE',body:{reason:'长期未到厂，手动删除'},confirmation:{title:'确认删除未到厂车辆',rows:[['车头号',vehicle.truck_no],['发运月份',vehicle.shipment_month]],note:'删除后不再显示、不计入车辆及载重统计；历史记录保留。同车同月重新上传不会自动恢复。',commentLabel:'删除说明（选填）'}});await this.page(id);notify('车辆已删除，历史记录已保留');}catch(err){if(err.message!==I18n.translate('操作已取消'))notify(err.message);button.disabled=false;}});
  DispatchTransport.bindImport($('dispatch-form'),{
   path,month:d.dispatch_month.month,error:$('dispatch-error'),
   render:(rows,transportOnly)=>this.table(rows,{transportOnly}),reload:()=>this.page(id)
  });
 }
};
const salesPermission=Router.permission.bind(Router);Router.permission=p=>/^\/sales-plans\/[0-9a-f-]{36}\/dispatch$/.test(p)?'dispatch:read':salesPermission(p);
const salesInit=Router.init.bind(Router);Router.init=async function(){this.add(/^\/sales-plans\/([0-9a-f-]{36})\/dispatch$/,id=>Dispatch.page(id));const r=await salesInit();for(const nav of document.querySelectorAll('.sidebar nav,.mobile-primary')){const customers=nav.querySelector('[data-primary-route="customers"]'),sales=nav.querySelector('[data-primary-route="sales-plans"]');if(customers&&sales)customers.after(sales);}return r;};
