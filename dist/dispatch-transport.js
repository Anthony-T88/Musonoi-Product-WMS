'use strict';

window.DispatchTransport={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 state:new WeakMap(),
 button(row){
  if(!CurrentUser.permissions.includes('dispatch:write')||row.cancelled_at||row.counted===false)return '';
  const missing=!row.transporter||!row.destination;
  return '<button type="button" class="button secondary compact" data-dispatch-transport="'+esc(row.id)+'">'+
   this.t(missing?'补全运输资料':'修改运输资料',missing?'Complete Route Details':'Edit Route Details')+'</button>';
 },
 notice(rows){
  const count=rows.filter(row=>!row.cancelled_at&&row.counted!==false&&(!row.transporter||!row.destination)).length;
  return count?'<p class="wms-feedback" role="status" data-no-i18n>'+esc(this.t(count+' 辆派车缺少运输商或目的地，请销售补全。',count+' dispatches need a transporter or destination. Sales can complete these details.'))+'</p>':'';
 },
 bind(base,rows,reload){
  for(const button of document.querySelectorAll('[data-dispatch-transport]'))button.onclick=()=>{
   const row=rows.find(v=>v.id===button.dataset.dispatchTransport),t=this.t;
   if(!row)return;
   const input=(key,label,max)=>'<label class="wms-field">'+label+'<input name="'+key+'" maxlength="'+max+'" value="'+esc(row[key]||'')+'" required></label>';
   dialog(t('派车运输资料','Dispatch Route Details'),'<form class="user-form" id="dispatch-route-form" data-no-i18n data-wms-validation>'+
    UI46Pages.factList([[t('车头号','Truck Plate'),esc(row.truck_no)],[t('发运月','Shipment Month'),esc(row.shipment_month||'—')]])+
    '<div class="form-grid wms-field-grid">'+input('transporter',t('运输商','Transporter'),160)+input('destination',t('目的地','Destination'),1000)+'</div>'+
    '<p class="error" role="alert"></p><div class="business-toolbar wms-form-actions"><button class="button primary">'+t('保存','Save')+'</button></div></form>');
   $('dispatch-route-form').onsubmit=e=>UI46Pages.submit(e,async()=>{
    await API.request(base+'/vehicles/'+row.id+'/transport',{method:'POST',body:{...Object.fromEntries(new FormData(e.target)),version:row.transport_version??row.version}});
    $('dialog').close();ProductContext.dirty=false;await reload();
   });
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
