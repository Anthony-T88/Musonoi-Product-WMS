'use strict';

const OutboundDateCorrections={
 t:(zh,en)=>I18n.label(zh,en),
 states:{
  PENDING_LOGISTICS:['待物流经理审批','Awaiting Logistics Manager Approval'],
  PENDING_PRODUCTION:['待生产管理部经理审批','Awaiting Production Manager Approval'],
  APPROVED:['已生效','Effective'],
  REJECTED:['已驳回','Rejected']
 },
 dates(row){
  return [
   [this.t('原出库日期','Original Stock Issue Date'),row.original_date],
   [this.t('更正后出库日期','Corrected Stock Issue Date'),row.corrected_date]
  ];
 },
 record(row,waiting){
  const t=this.t,state=this.states[row.state]||[row.state,row.state];
  const stages=[
   [t('申请','Request'),row.requester_name,row.requested_at,row.reason],
   [t('物流经理审批','Logistics Manager Approval'),row.logistics_name,row.logistics_at,row.logistics_note],
   [t('生产管理部经理审批','Production Manager Approval'),row.production_name,row.production_at,row.production_note]
  ];
  const history=stages.filter(([,name,at])=>name||at).map(([label,name,at,note])=>
   '<p><strong>'+esc(label)+'</strong> · <span data-no-i18n>'+esc([name,at&&BusinessTime.display(at),note].filter(Boolean).join(' · '))+'</span></p>').join('');
  const controls=row.can_review?'<div class="business-toolbar">'+
   '<button type="button" class="button primary" data-date-review="'+esc(row.id)+'" data-decision="APPROVED">'+t('审批通过','Approve')+'</button>'+
   '<button type="button" class="button secondary" data-date-review="'+esc(row.id)+'" data-decision="REJECTED">'+t('驳回申请','Reject Request')+'</button></div>':'';
  return '<details '+(waiting?'open':'')+'><summary><span data-no-i18n>'+esc(row.original_date||'—')+' → '+esc(row.corrected_date)+'</span> · '+
   UI.status(row.state.startsWith('PENDING_')?'PENDING':row.state,'approval',t(...state))+'</summary>'+history+controls+'</details>';
 },
 async refresh(section,api){
  const t=this.t;
  try{
   const data=await API.request(api);
   if(!section.isConnected)return;
   const fromTasks=new URLSearchParams(location.search).get('date_correction')==='1';
   section.innerHTML='<div class="business-toolbar"><strong>'+t('当前出库日期','Current Stock Issue Date')+'</strong> '+
    '<span data-no-i18n>'+esc(data.outbound_date||'—')+'</span>'+
    (data.can_request?'<button type="button" class="button secondary" id="outbound-date-correction-request">'+t('出库日期更正','Correct Stock Issue Date')+'</button>':'')+
    '</div><p class="error" role="alert"></p>'+
    data.items.map(row=>this.record(row,row.can_review||fromTasks&&row.state.startsWith('PENDING_'))).join('');
   section.querySelector('#outbound-date-correction-request')?.addEventListener('click',()=>this.request(section,api,data.outbound_date));
   for(const button of section.querySelectorAll('[data-date-review]'))button.onclick=()=>{
    const row=data.items.find(item=>item.id===button.dataset.dateReview);
    return this.review(section,api,row,button);
   };
  }catch(error){
   if(section.isConnected)section.innerHTML='<p class="error" role="alert">'+esc(error.message)+'</p>';
  }
 },
 request(section,api,current){
  const t=this.t,formId='outbound-date-correction-form';
  dialog(t('出库日期更正','Correct Stock Issue Date'),[
   '<form id="'+formId+'" class="user-form">',
   '<p>'+t('当前出库日期','Current Stock Issue Date')+' <strong data-no-i18n>'+esc(current||'—')+'</strong></p>',
   '<p>'+t('物流经理审批后转生产管理部经理，终审通过后更正生效。','The Logistics Manager reviews first. The correction takes effect after final approval by the Production Manager.')+'</p>',
   '<label>'+t('更正后出库日期','Corrected Stock Issue Date')+'<input name="outbound_date" type="date" required></label>',
   '<label>'+t('更正原因','Correction Reason')+'<textarea name="reason" required maxlength="1000"></textarea></label>',
   '<p class="error" role="alert"></p>',
   '<button type="submit" class="button primary">'+t('提交更正申请','Submit Correction Request')+'</button></form>'
  ].join(''),{protectForm:'#'+formId});
  const form=$(formId),errorLine=form.querySelector('[role="alert"]'),submit=form.querySelector('button[type="submit"]');
  form.onsubmit=async event=>{
   event.preventDefault();
   errorLine.textContent='';
   const {outbound_date,reason}=Object.fromEntries(new FormData(form));
   if(outbound_date===current){
    errorLine.textContent=t('更正后的日期须与当前出库日期不同。','The corrected date must differ from the current stock issue date.');
    return;
   }
   if(!reason.trim()){
    errorLine.textContent=t('请填写更正原因。','Enter the reason for the correction.');
    return;
   }
   submit.disabled=true;
   try{
    await API.request(api,{method:'POST',body:{expected_date:current,outbound_date,reason:reason.trim()}});
    $('dialog').close();
    await this.refresh(section,api);
   }catch(error){errorLine.textContent=error.message;}
   finally{submit.disabled=false;}
  };
  I18n.apply();
 },
 async review(section,api,row,button){
  const t=this.t,decision=button.dataset.decision,isApproval=decision==='APPROVED',errorLine=section.querySelector('[role="alert"]');
  let note='';
  button.disabled=true;
  try{
   if(!await OperationConfirm.ask({
    title:isApproval?t('通过出库日期更正','Approve Stock Issue Date Correction'):t('驳回出库日期更正','Reject Stock Issue Date Correction'),
    rows:this.dates(row),note:row.reason,comment:true,commentRequired:!isApproval,onComment:value=>{note=value;}
   }))return;
   errorLine.textContent='';
   await API.request(api+'/'+row.id+'/review',{method:'POST',body:{version:row.version,decision,note}});
   await this.refresh(section,api);
  }catch(error){errorLine.textContent=error.message;}
  finally{button.disabled=false;}
 },
 async mount(id,co){
  const parent=$(co?'ux11-co-corrections':'ux11-load-corrections');
  if(!parent)return;
  const section=document.createElement('section');
  section.id='outbound-date-correction-panel';
  section.className='panel';
  parent.prepend(section);
  await this.refresh(section,(co?'/cobalt/execution/orders/':'/v26/loads/')+id+'/outbound-date-corrections');
 }
};

const cuLoadWithDateCorrection=Flow.load.bind(Flow);
Flow.load=async function(id){
 const data=await cuLoadWithDateCorrection(id);
 if(data.workflow_state==='OUTBOUND'||!data.workflow_state&&data.status==='DEPARTED')await OutboundDateCorrections.mount(id,false);
 return data;
};
const coLoadWithDateCorrection=CobaltExecutionUI.detail.bind(CobaltExecutionUI);
CobaltExecutionUI.detail=async function(id){
 await coLoadWithDateCorrection(id);
 if(this.data.execution?.state==='OUTBOUND')await OutboundDateCorrections.mount(id,true);
};
