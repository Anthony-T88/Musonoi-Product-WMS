'use strict';
const ReceiptAlerts={value:null,timer:null,busy:false,
 async refresh(){if(!Business.can('receipt:review')||this.busy)return;this.busy=true;try{this.value=await API.request('/receipts/summary');return this.value;}catch{return null;}finally{this.busy=false;}},
 async start(){if(!Business.can('receipt:review'))return;await this.refresh();window.addEventListener('inventory-changed',()=>{clearTimeout(this.timer);this.timer=setTimeout(()=>this.refresh(),120);});window.addEventListener('focus',()=>this.refresh());document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.refresh();});this.interval=setInterval(()=>{if(!document.hidden&&window.AppSignedIn)this.refresh();},60000);}
};
Business.statuses={DRAFT:'草稿',PENDING:'待审批',CONFIRMED:'已审批',REJECTED:'已驳回'};
Business.receipts=async function(){let current=new URLSearchParams(location.search).get('status')||'',sequence=0;const labels=this.statuses;
 this.open('入库管理',`<div class="approval-cards" id="receipt-approval-cards" aria-label="入库审批统计"></div><div class="business-toolbar">${this.can('receipt:write')?'<a class="button primary" href="/receipts/new">新建入库单</a><a class="button secondary" href="/receipts/import">Excel批量导入</a>':''}<label>单据状态<select id="receipt-status"><option value="">全部状态</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label><span class="quiet-note">显示最近200张</span></div><p class="error" id="receipt-list-error" role="alert"></p><div id="receipt-list" aria-live="polite"></div>`);
 const load=async status=>{const seq=++sequence,listNode=$('receipt-list');current=status;const url=new URL(location.href);if(status)url.searchParams.set('status',status);else url.searchParams.delete('status');history.replaceState({},'',url.pathname+url.search);$('receipt-status').value=status;$('receipt-list-error').textContent='';try{const [r,s]=await Promise.all([API.request('/receipts'+(status?'?status='+status:'')),this.can('receipt:review')?API.request('/receipts/summary'):Promise.resolve(null)]);if(seq!==sequence||!listNode.isConnected)return;ReceiptAlerts.value=s;$('receipt-approval-cards').hidden=!s;$('receipt-approval-cards').innerHTML=s?[['PENDING','待审批',s.pending],['CONFIRMED','已审批通过',s.confirmed],['REJECTED','已驳回',s.rejected]].map(([key,label,count])=>`<button type="button" class="approval-card ${key==='PENDING'?'attention':''} ${status===key?'selected':''}" data-receipt-filter="${key}"><span>${label}</span><strong>${count}</strong><small>查看单据 →</small></button>`).join(''):'';$('receipt-list').innerHTML='<div class="business-table"><table><thead><tr><th>入库单号</th><th>客户</th><th>状态</th><th class="numeric">捆数</th><th>创建人</th><th>操作</th></tr></thead><tbody>'+r.items.map(d=>`<tr class="${d.status==='PENDING'?'approval-pending-row':''}"><td>${esc(d.code)}</td><td>${esc(d.customer_name)}</td><td>${UI.status(d.status,'approval',labels[d.status])}</td><td class="numeric">${d.line_count}</td><td>${esc(d.creator_name)}</td><td><a class="button secondary compact" href="/receipts/${d.id}">${d.status==='PENDING'&&this.can('receipt:review')?'查看 / 审核':'查看详情'}</a></td></tr>`).join('')+(r.items.length?'':'<tr><td colspan="6" class="empty">当前状态没有授权入库单</td></tr>')+'</tbody></table></div>';for(const b of document.querySelectorAll('[data-receipt-filter]'))b.onclick=()=>load(b.dataset.receiptFilter);await ReceiptAlerts.refresh();}catch(e){if(seq!==sequence||!listNode.isConnected)return;$('receipt-list-error').textContent=e.message;$('receipt-list').replaceChildren();}};
 $('receipt-status').onchange=e=>load(e.target.value);await load(current);
};
V261.states.CANCELLED='已撤销';V262.locationNames.PUBLIC_TEMPORARY='公共新生产捆包堆存区';
const supplementLotDetail=V262.detail.bind(V262);
const lotLabel=(zh,en)=>I18n.label(zh,en);
const lotBlockLabels={
 APPROVED:'本备货单的最终审核已生效，请按整批撤销流程办理。',
 LOADING:'已有装车匹配或装车记录，请先核对装车状态。',
 REVERSAL:'本备货单已有待审核的整批撤销申请，请先处理该申请。',
 SAMPLING:'捆包仍在实验室取样，请先登记返回并重新打包。',
 LOCATION:'有捆包的实际货位待定位或已停用，请先核实货位。',
 PERMISSION:'请由有撤销权限的创建人或备货审核人办理。'
};

function mountLotPreapproval(a,toolbar){
 const t=lotLabel,p=a.preapproval,id=a.id;
 const action=(name,label,style)=>'<button type="button" class="button '+style+'" id="lot-'+name+'">'+label+'</button>';
 const blocked=lotBlockLabels[p.blocked_code];
 toolbar.insertAdjacentHTML('beforeend',
  (p.can_withdraw?action('withdraw','撤回审核','secondary'):'')+
  (p.can_reselect?action('reselect','重选捆包','secondary'):'')+
  (p.can_revoke?action('revoke','撤销备货','danger-outline'):'')+
  (p.reopened_preparation_plan_id?'<a class="button secondary" id="lot-reopen-plan" data-i18n href="'+
   esc(PreparationPlans.startRoute({id:p.reopened_preparation_plan_id}))+'">按原计划重选捆包</a>':'')+
  (blocked?'<span class="wms-feedback" role="status" data-i18n>'+esc(blocked)+'</span>':''));
 for(const kind of ['withdraw','reselect','revoke']){
  const trigger=$('lot-'+kind);
  if(!trigger)continue;
  trigger.onclick=async()=>{
   trigger.disabled=true;
   try{
    const current=await API.request('/v261/lots/'+id);
    if(!toolbar.isConnected)return;
    const field=({withdraw:'can_withdraw',reselect:'can_reselect',revoke:'can_revoke'})[kind];
    if(!current.preapproval?.[field]){
     notify(t('备货状态已变化，请核对最新操作。','Preparation status changed. Check the available actions.'));
     await V262.detail(id);
     return;
    }
    openLotPreapproval(kind,current);
   }catch(error){notify(I18n.translate(error.message,true));}
   finally{trigger.disabled=false;}
  };
 }
}

function openLotPreapproval(kind,a){
 if($('lot-preapproval-dialog'))return;
 const t=lotLabel,p=a.preapproval,withdraw=kind==='withdraw',reselect=kind==='reselect';
 const title=withdraw?'撤回备货审核':reselect?'撤销本次备货并重选捆包':'撤销备货';
 const confirm=withdraw?'确认撤回':reselect?'确认撤销并重选':'确认撤销';
 const facts=[
  ['销售计划',a.plan.code],
  ['当前分配客户',a.plan.customer_name],
  ['备货捆数',a.quantities?.original_count??a.summary.total],
  ['已检斤捆数',a.summary.weighed],
  ['规划堆存货位',copperSlotLabel(a.planned?.code)]
 ];
 const popup=document.createElement('dialog');
 popup.id='lot-preapproval-dialog';
 popup.className='product-dialog';
 popup.setAttribute('data-i18n','');
 popup.setAttribute('aria-labelledby','lot-preapproval-title');
 popup.innerHTML='<form id="lot-preapproval-form"><header><h2 id="lot-preapproval-title">'+title+'</h2><p data-no-i18n>'+esc(a.lot_no)+'</p></header>'+
  '<dl class="confirmation-grid" id="lot-preapproval-facts">'+facts.map(([label,value])=>'<dt>'+label+'</dt><dd data-no-i18n>'+esc(value??'—')+'</dd>').join('')+'</dl>'+
  (withdraw?'<p class="work-notice">撤回后恢复备货作业，保留现有捆包和货位锁定。</p>':
   '<div id="lot-revoke-fields"><p class="work-notice">'+(reselect?'<span>确认后从原备货计划进入选货。原作业记录保留。</span> ':'')+
   '<span>系统按核对结果释放备货锁定，捆包仍在当前实物货位。</span></p>'+
   (p.restored_after_return?'<p class="quiet-note">保留原出库、返厂冲销及备货流水。重选后须重新提交备货审核。</p>':'')+
   '<label>撤销原因<textarea name="reason" maxlength="1000" rows="2" required></textarea></label>'+
   '<label class="check-label"><input type="checkbox" name="work_stopped" required>已停止原备货作业</label>'+
   '<label class="check-label"><input type="checkbox" name="physical_state_verified" required>已逐捆核实当前实物位置</label>'+
   '<label>现场作业及位置核实说明<textarea name="observation" maxlength="1000" rows="2"'+(p.has_operations?' required':'')+
   '></textarea></label></div>')+
  '<p id="lot-preapproval-error" class="error" role="alert"></p><footer>'+
  '<button type="button" id="lot-preapproval-back" class="button secondary">返回</button>'+
  '<button type="submit" class="button '+(withdraw?'primary':'danger')+'" id="lot-preapproval-confirm">'+confirm+'</button></footer></form>';
 $('page-content').append(popup);
 popup.addEventListener('close',()=>popup.remove(),{once:true});
 popup.querySelector('#lot-preapproval-back').onclick=()=>popup.close();
 const form=popup.querySelector('form'),error=popup.querySelector('[role=alert]');
 form.onsubmit=async event=>{
  event.preventDefault();
  const button=event.submitter;
  button.disabled=true;
  const data=new FormData(form),input={version:a.version};
  if(!withdraw)Object.assign(input,{
   reason:data.get('reason'),observation:data.get('observation'),
   work_stopped:data.has('work_stopped'),physical_state_verified:data.has('physical_state_verified')
  });
  let result;
  try{result=await API.request('/v262/lots/'+a.id+'/'+(withdraw?'withdraw':'revoke'),{method:'POST',body:input});}
  catch(failure){error.textContent=failure.message;button.disabled=false;return;}
  if(!popup.isConnected)return;
  popup.close();
  if(!withdraw){
   for(const bundle of a.items)V262.drafts.delete(a.id+':'+bundle.id);
   ProductContext.dirty=false;
  }
  window.dispatchEvent(new Event('inventory-changed'));
  if(reselect&&result.reopened_preparation_plan_id){
   await Router.go(PreparationPlans.startRoute({id:result.reopened_preparation_plan_id}));
   return;
  }
  notify(withdraw?t('已撤回审核','Review withdrawn'):
   result.reopened_preparation_plan_id?t('备货已撤销，原计划可重新选货','Preparation cancelled. The original plan is available.') :
   t('备货已撤销','Preparation cancelled'));
  await V262.detail(a.id);
 };
 popup.showModal();
}

V262.detail=async function(id){
 if(location.pathname!=='/preparation/'+id)return;
 const a=await supplementLotDetail(id);
 if(!a||location.pathname!=='/preparation/'+id||!$('v262-summary'))return;
 const summaryNode=$('v262-summary'),toolbar=$('v262-lot-actions');
 if(a.preapproval&&toolbar){
  $('v261-cancel')?.remove();
  mountLotPreapproval(a,toolbar);
 }
 const reversalArea=document.createElement('section');
 reversalArea.id='preparation-reversal';
 reversalArea.className='wms-section';
 reversalArea.dataset.noI18n='';
 reversalArea.hidden=true;
 summaryNode.parentElement.append(reversalArea);
 await PreparationReversal.mount(reversalArea,id);
};
V261.detail=V262.detail.bind(V262);Business.allocationDetail=V261.detail;
StockMap.stateNames.TEMPORARY='公共新生产捆包堆存区';
const supplementMapDraw=StockMap.draw.bind(StockMap),supplementMapSelect=StockMap.select.bind(StockMap);
StockMap.draw=function(){supplementMapDraw();const cell=document.querySelector('[data-map-cell="P5"]');if(cell){cell.classList.add('map-public-p5');cell.setAttribute('data-i18n','');cell.setAttribute('aria-label','P5 新生产捆包堆存区');const title=cell.querySelector('title');if(title)title.textContent='P5 公共新生产捆包堆存区，可共存多个入库批次；实物数量按数据库统计';if(cell.namespaceURI.includes('svg')){const texts=cell.querySelectorAll('text');if(texts[0])texts[0].textContent='P5';if(texts[1]){texts[1].textContent='新生产捆包堆存区';texts[1].setAttribute('x',Number(this.data.cells.find(c=>c.code==='P5').x)+100);}}}};
StockMap.unmapped=function(){const section=$('stock-map-unmapped'),count=this.data.review_summary?.bundle_count||0;if(!section)return;section.hidden=!count;section.innerHTML=count?'<p class="quiet-note">待核查实物 '+count+' 捆，已计入仓库总量；请在库存查询中核对货位。</p>':'';};
StockMap.select=async function(id,page=1){const loc=this.data.locations.find(l=>l.id===id);if(loc?.map_usage!=='TEMPORARY'){$('stock-map-detail')?.classList.remove('map-temporary-detail');return supplementMapSelect(id,page);}const seq=++this.detailSequence,area=$('stock-map-detail');area.classList.add('map-temporary-detail');area.innerHTML='<p role="status">正在读取P5新生产捆包堆存区…</p>';try{const q=this.detailParams(page);const r=await API.request('/stock-map/locations/'+id+'?'+q);if(seq!==this.detailSequence)return;const s=r.summary,knownGross=s.bundle_count&&s.missing_gross_count===s.bundle_count?'未知':Tonnes.format(s.known_gross_weight),knownNet=s.bundle_count&&s.unweighed_count===s.bundle_count?'未知':Tonnes.format(s.known_net_weight);area.innerHTML=`<h2 data-i18n>P5 新生产捆包堆存区</h2><p class="quiet-note">公共区域，不参与单Lot独占</p><dl><dt>当前实物捆数</dt><dd>${s.bundle_count}</dd><dt>总片数</dt><dd>${s.total_sheets??'未录入'}${s.missing_sheets_count?'（'+s.missing_sheets_count+'捆未录入）':''}</dd><dt>重量未知</dt><dd>${s.unweighed_count||0} 捆</dd><dt>已知毛重 / 净重(t)</dt><dd>${knownGross} / ${knownNet}</dd><dt>已锁定 / 可用</dt><dd>${s.locked_count} / ${s.available_count} 捆</dd></dl><p class="work-notice">创建Lot时实物可留在P5；主管审核并确认归位后才更新正式货位。未知重量不推算。</p><a class="button secondary" href="/inventory?location=${encodeURIComponent('新生产捆包堆存区')}">查看临时区库存</a><h3>捆包明细</h3><div class="map-bundle-cards">${r.items.map(b=>`<article class="map-bundle-card"><header><a data-no-i18n href="/inventory/${encodeURIComponent(b.id)}">${esc(b.id)}</a><span>${UI.status(b.inventory_state_code,'business',InventoryControl.states[b.inventory_state_code]||b.business_status)}</span></header><dl><div><dt>生产批次</dt><dd data-no-i18n>${esc(b.batch||'—')}</dd></div><div><dt>片数</dt><dd>${b.sheets_per_bundle??'未录入'}</dd></div><div><dt>毛重（吨）</dt><dd>${StockMap.number(b.gross_weight)}</dd></div><div><dt>净重（吨）</dt><dd>${StockMap.number(b.weight)}</dd></div><div><dt>取样状态</dt><dd>${UI.sampling(b)}</dd></div></dl></article>`).join('')||'<p>当前筛选无实物库存</p>'}</div><div class="business-toolbar"><button type="button" id="p5-prev" class="button secondary" ${page===1?'disabled':''}>上一页</button><span>${page} / ${Math.max(1,Math.ceil(r.total/20))}</span><button type="button" id="p5-next" class="button secondary" ${page*20>=r.total?'disabled':''}>下一页</button></div>`;$('p5-prev').onclick=()=>this.select(id,page-1,q.get('batch_group'),q.get('customer_group'));$('p5-next').onclick=()=>this.select(id,page+1,q.get('batch_group'),q.get('customer_group'));const u=new URL(location.href);u.searchParams.set('focus',id);history.replaceState({},'',u.pathname+u.search);}catch(e){if(seq===this.detailSequence)area.innerHTML='<p class="error" role="alert">'+esc(e.message)+'</p>';}};

const supplementMapRegion=StockMap.region.bind(StockMap);StockMap.region=function(code){if(code!=='P5')return supplementMapRegion(code);const p5=this.data.locations.find(l=>l.map_usage==='TEMPORARY');if(p5){this.viewRegion='P5';this.zoom=1;this.draw();this.select(p5.id);}};
