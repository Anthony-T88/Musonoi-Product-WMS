'use strict';

window.PreparationReversal={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 base(id){return (ProductContext.isCopper()?'/v261/lots/':'/cobalt/preparations/')+id+'/reversal';},
 message(code){
  const text={
   PREPARATION_REVERSAL_NOT_FINAL:['只有终审通过的备货批次可办理整批撤销。','Whole-batch reversal is available after final preparation approval.'],
   PREPARATION_REVERSAL_LOADED:['该批次已有实际装车或出库记录，请办理对应的卸车或出库更正。','This batch has loading or outbound records. Use the unloading or outbound correction workflow.'],
   PREPARATION_REVERSAL_MATCHED:['请先取消占用该批次的装车计划或解除车辆匹配。','Cancel the loading plan or release its vehicle match first.'],
   PREPARATION_REVERSAL_STOCK_CONFLICT:['请核对整批货位、库存状态及未完成的取样或更正。','Verify every stock location, stock status and outstanding sampling or correction.'],
   PREPARATION_REVERSAL_STALE:['备货或库存资料已变更，请退回申请并重新核实。','Preparation or stock details changed. Return the request and verify again.'],
   PREPARATION_REVERSAL_PENDING:['该批次已有待审核的整批撤销申请。','This batch already has a pending reversal request.'],
   PREPARATION_REVERSAL_HANDLED:['该申请已办理，请刷新查看。','This request has already been reviewed. Refresh to see the result.'],
   PREPARATION_REVERSAL_SOURCE_INVALID:['请选择适用于该批次的销售计划和新批次号。','Choose a sales plan for this batch and enter a new lot number.'],
   PREPARATION_REVERSAL_ALREADY_LINKED:['该撤销记录已关联新的备货计划。','This reversal already has a replacement preparation plan.'],
   PREPARATION_PLAN_STALE:['备货计划已变化，请返回重新选择。','The preparation plan changed. Go back and select it again.'],
   PREPARATION_REVERSAL_INVALID:['请填写必填资料并确认核对结果。','Complete the required fields and confirm the stock check.'],
   PREPARATION_REVERSAL_FORBIDDEN:['该操作仅限指定岗位在授权范围内办理。','This action requires the designated role and stock scope.'],
   PREPARATION_REVERSAL_NOT_FOUND:['整批撤销记录不存在或已不可见。','The preparation reversal is unavailable.']
  }[code];
  return text?this.t(...text):code;
 },
 async mount(area,id){
  if(!area)return;
  const params=new URLSearchParams(location.search),t=this.t,record=params.get('reversal'),route=this.base(id);
  const query=record?new URLSearchParams({record,stock_page:params.get('stock_page')||'1'}):null;
  let d;
  try{d=await API.request(route+(query?'?'+query:''));}
  catch(err){if(area.isConnected&&record)area.innerHTML='<p class="error" role="alert">'+esc(this.message(err.message))+'</p>';return;}
  if(!area.isConnected)return;
  const pending=d.items.find(row=>row.state==='PENDING');
  const eligibleState=['PREPARED','COMPLETED','REVERSED'].includes(d.state);
  if(!d.items.length&&!d.can_request&&!(eligibleState&&CurrentUser.permissions.includes('lot:reverse-request')))return;
  const action=(key,zh,en,style='secondary')=>'<button type="button" data-reversal-action="'+key+'" class="button '+style+'">'+t(zh,en)+'</button>';
  const state=code=>t(...({PENDING:['待物流经理审核','Pending Logistics Manager Review'],APPROVED:['已撤销','Reversed'],REJECTED:['已退回','Returned']}[code]));
  const history=d.items.map(r=>{
   const selected=r.id===record;
   const href=location.pathname+'?reversal='+r.id+'#preparation-reversal';
   const details='<dl class="confirmation-grid">'+[
    [t('申请人','Requested By'),r.requester],[t('申请原因','Reason'),r.reason],[t('现场核对','Stock Check'),r.observation],
    [t('审核人','Reviewed By'),r.reviewer],[t('审核意见','Review Note'),r.review_note]
   ].map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value||'—')+'</dd>').join('')+'</dl>';
   const successor=r.replacement_plan_id?'<a class="button secondary" href="/preparation/work-plans/'+r.replacement_plan_id+'">'+t('查看新备货计划','View Replacement Plan')+' · '+esc(r.replacement_batch)+'</a>':
    r.state==='APPROVED'&&['export_supervisor','admin'].includes(CurrentUser.role_code)&&CurrentUser.permissions.includes('plan:read')?action('replacement-'+r.id,'新建关联备货计划','Create Related Plan'):'';
   const dates=[BusinessTime.display(r.requested_at),r.reviewed_at&&BusinessTime.display(r.reviewed_at)].filter(Boolean).join(' · ');
   const records=r.stock?this.stock(r,href):'<a class="button secondary compact" href="'+href+'">'+t('查看库存快照','View Stock Snapshot')+'</a>';
   return '<details class="panel" '+(selected||r===pending||d.items.length===1?'open':'')+'><summary>'+esc(r.batch_no)+' · '+state(r.state)+' · '+esc(dates)+'</summary>'+
    details+'<div class="business-toolbar">'+successor+records+'</div></details>';
  }).join('');
  const blocked=d.block&&(pending&&d.can_review||eligibleState&&d.block!=='NOT_FINAL'&&CurrentUser.permissions.includes('lot:reverse-request'))?
   '<p class="wms-feedback" role="status">'+esc(this.message('PREPARATION_REVERSAL_'+d.block))+'</p>':'';
  area.hidden=false;
  area.innerHTML='<h2>'+t('整批撤销备货','Whole-Batch Preparation Reversal')+'</h2>'+blocked+history+
   '<p class="error" role="alert"></p><div class="business-toolbar">'+
   (d.can_request?action('request','申请整批撤销备货','Request Whole-Batch Reversal','danger-outline'):'')+
   (pending&&d.can_review?(d.block?'':action('approve','批准整批撤销','Approve Whole-Batch Reversal','primary'))+action('reject','退回撤销申请','Return Reversal Request','danger-outline'):'')+'</div>';
  const run=async(path,body,button,feedback=area.querySelector('[role=alert]'))=>{
   button.disabled=true;
   try{
    const result=await API.request(path,{method:'POST',body});
    if(!area.isConnected)return;
    $('dialog')?.close();
    ProductContext.dirty=false;
    const search='?reversal='+result.reversal_id;
    if(location.search===search)await Router.show();
    else await Router.go(location.pathname+search+'#preparation-reversal');
   }catch(err){feedback.textContent=this.message(err.message);button.disabled=false;}
  };
  for(const button of area.querySelectorAll('[data-reversal-action]'))button.onclick=async()=>{
   const op=button.dataset.reversalAction;
   if(op.startsWith('replacement-'))return PreparationPlans.form(null,d.items.find(row=>row.id===op.slice('replacement-'.length)));
   if(op==='request')return this.request(route,d.version,run);
   this.review(route,pending,op==='approve',button.textContent,run);
  };
  if(record)area.scrollIntoView({block:'start'});
 },
 request(route,version,run){
  const t=this.t;
  dialog(t('申请整批撤销备货','Request Whole-Batch Reversal'),
   '<form id="preparation-reversal-form" class="user-form" data-no-i18n data-wms-validation>'+
   '<div class="form-grid wms-field-grid"><label class="wms-field" data-field-span="full">'+t('撤销原因','Reason for Reversal')+'<textarea name="reason" required maxlength="1000" rows="2"></textarea></label>'+
   '<label class="wms-field" data-field-span="full">'+t('实物、数量及货位核对结果','Physical Stock, Quantity and Location Check')+'<textarea name="observation" required maxlength="1000" rows="3"></textarea></label></div>'+
   '<label class="check-label"><input name="verified" type="checkbox" required>'+t('已核对整批在库，尚未装车','Verified that the whole batch is in stock and loading has not started')+'</label>'+
   '<p class="error" role="alert"></p><div class="business-toolbar wms-form-actions"><button type="button" class="button secondary" data-close-reversal>'+t('取消','Cancel')+'</button><button class="button primary">'+t('提交申请','Submit Request')+'</button></div></form>');
  const form=$('preparation-reversal-form');
  form.querySelector('[data-close-reversal]').onclick=()=>$('dialog').close();
  form.onsubmit=e=>{
   e.preventDefault();
   const body=Object.fromEntries(new FormData(form));
   run(route,{...body,version,verified:body.verified==='on'},e.submitter,form.querySelector('[role=alert]'));
  };
 },
 review(route,pending,approve,title,run){
  const t=this.t;
  const verified=approve?'<label class="check-label"><input name="verified" type="checkbox" required>'+
   t('已核对全部实物、数量和货位，确认释放整批备货占用','Verified the full batch, quantity and locations. Release the preparation reservation.')+'</label>':'';
  dialog(title,'<form id="preparation-reversal-review" class="user-form" data-no-i18n data-wms-validation>'+
   '<p>'+esc(pending.batch_no)+' · '+t('库存数量','Stock Count')+' '+pending.stock_count+'</p>'+
   '<div class="form-grid wms-field-grid"><label class="wms-field" data-field-span="full">'+t('审核意见','Review Note')+
   '<textarea name="note" required maxlength="1000" rows="3"></textarea></label></div>'+verified+
   '<p class="error" role="alert"></p><div class="business-toolbar wms-form-actions">'+
   '<button type="button" class="button secondary" data-close-reversal>'+t('取消','Cancel')+'</button>'+
   '<button class="button primary" type="submit">'+esc(title)+'</button></div></form>');
  const form=$('preparation-reversal-review');
  form.querySelector('[data-close-reversal]').onclick=()=>$('dialog').close();
  form.onsubmit=e=>{
   e.preventDefault();
   const data=new FormData(form);
   run(route+'/'+pending.id+'/review',{decision:approve?'APPROVED':'REJECTED',note:data.get('note'),verified:data.has('verified')},e.submitter,form.querySelector('[role=alert]'));
  };
 },
 stock(row,href){
  const t=this.t,page=row.stock_page,total=Math.ceil(row.stock_count/100);
  const labels=[[t('捆包 / 袋号','Bundle / Bag Number'),s=>s.number],[t('实际货位','Actual Location'),s=>ProductContext.isCopper()?copperSlotLabel(s.location):s.location],
   [t('毛重','Gross Weight'),s=>s.gross],[t('净重','Net Weight'),s=>s.net],[t('铅封号','Seal Number'),s=>s.seal]];
  const nav=(n,zh,en)=>'<a class="button secondary compact" href="'+href.replace('#','&amp;stock_page='+n+'#')+'">'+t(zh,en)+'</a>';
  return '<div class="table-scroll">'+UI46Pages.table('<table><thead><tr>'+labels.map(([label])=>'<th>'+esc(label)+'</th>').join('')+
   '</tr></thead><tbody>'+row.stock.map(s=>'<tr>'+labels.map(([,get])=>'<td>'+esc(get(s)??'—')+'</td>').join('')+'</tr>').join('')+
   '</tbody></table>',{center:[0,1,2,3,4]})+'</div><div class="business-toolbar">'+(page>1?nav(page-1,'上一页','Previous'):'')+
   (total>1?'<span>'+page+' / '+total+'</span>':'')+(page<total?nav(page+1,'下一页','Next'):'')+'</div>';
 },
 restart(plan){
  const t=this.t;
  CobaltUI.page(t('重新开始氢氧化钴备货','Restart Cobalt Preparation'),'<section class="wms-page" data-no-i18n>'+
   PreparationPlans.fields(plan)+'<p>'+t('沿用已入库的袋号、实测重量和货位。请按新批次重新办理备货审批。','Keep the received bag identities, measured weights and locations. The replacement batch requires preparation approval.')+'</p>'+
   '<form class="user-form" id="restart-cobalt-preparation"><p class="error" role="alert"></p><button class="button primary">'+t('重新开始备货','Restart Preparation')+'</button></form></section>');
  $('restart-cobalt-preparation').onsubmit=e=>UI46Pages.submit(e,async()=>{
   const r=await API.request('/cobalt/preparations',{method:'POST',body:{preparation_plan_id:plan.id,preparation_plan_version:plan.version}});
   await Router.go('/receipts/'+r.id);
  });
 }
};
