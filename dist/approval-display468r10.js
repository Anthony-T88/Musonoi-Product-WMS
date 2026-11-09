'use strict';
// One presentation for authorized document workflows and recorded approvals.
window.ApprovalDisplay={
 records:new Map(),catalog:null,scheduled:false,
 t:(zh,en)=>I18n.language==='en'?en:zh,
 init(){
  if(this.installed)return;this.installed=true;
  this.catalog=CurrentUser._approval_catalog||null;
  if(window.BusinessWorkflow)BusinessWorkflow.role=p=>p?.role_basis==='RECORDED'?(I18n.language==='en'?p.role_name_en||p.role_name:p.role_name)||this.t('历史角色未记录','Historical Role Not Recorded'):this.t('历史角色未记录','Historical Role Not Recorded');
  const request=API.request.bind(API);API.request=async(url,options)=>{const product=window.ProductContext?.code,data=await request(url,options);if(product===window.ProductContext?.code&&(!options?.method||options.method==='GET'))this.remember(url,data);return data;};
  const adjustment=Control.adjustment.bind(Control);Control.adjustment=async id=>{const target='/stocktaking/adjustments/'+id;if(location.pathname!==target)return Router.go(target);const r=await adjustment(id);this.manual={id,product:ProductContext.code,path:location.pathname};this.mount();return r;};
  const review=RegistrationUI.review.bind(RegistrationUI);RegistrationUI.review=async r=>{this.registrationReview=r;const value=await review(r);this.schedule();return value;};
  Router.add(/^\/stocktaking\/adjustments\/([0-9a-f-]{36})$/,id=>Control.adjustment(id));
  RoutePermissions.register('approval-adjustment-record',p=>p.startsWith('/stocktaking/adjustments/'),()=> 'adjust:read');
  const show=Router.performShow.bind(Router);Router.performShow=async(...args)=>{this.manual=null;const correction=location.pathname.match(/^\/outbounds\/corrections\/([0-9a-f-]{36})$/);if(correction&&ProductContext.isCopper()){const d=await API.request('/v27/corrections/'+correction[1]);history.replaceState(history.state,'','/outbounds/loads/'+d.loading_id+'?correction='+correction[1]);}const r=await show(...args);this.mount();return r;};
  const set=I18n.set.bind(I18n);I18n.set=(...args)=>{const r=set(...args);this.schedule();return r;};
  this.observer=new MutationObserver(changes=>{if(changes.some(c=>!c.target.closest?.('.r10-owned')))this.schedule();});
  for(const n of [document.getElementById('page-content'),document.getElementById('dialog')])if(n)this.observer.observe(n,{childList:true,subtree:true});
  window.addEventListener('session-expired',()=>{this.records.clear();this.catalog=null;});
  this.mount();
 },
 remember(url,data){
  if(data?._approval_catalog)this.catalog=data._approval_catalog;
  if(data?._approval){const a=data._approval,key=ProductContext.code+'|'+a.kind+'|'+a.id;this.records.set(key,{url,data,approval:a});if(this.records.size>80)this.records.delete(this.records.keys().next().value);}
  if(url.split('?')[0]==='/users/registration-requests'&&data?.items)this.registration=data.items;
  this.schedule();
 },
 schedule(){if(this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;if(window.AppSignedIn)this.mount();});},
 roleNames(roles){return (roles||[]).map(r=>'<span class="r10-role" data-role-code="'+esc(r.code)+'">'+esc(I18n.language==='en'?r.name_en||r.name:r.name)+'</span>').join('')||'<span class="r10-role">'+this.t('审批岗位未配置','Approval Role Not Configured')+'</span>';},
 changeDetails(changes){
  if(!changes?.length)return '';
  const states={DRAFT:['草稿','Draft'],PENDING:['待审核','Pending Review'],SUBMITTED:['已提交','Submitted'],SITE_PENDING:['待现场审核','Site Review Pending'],PRODUCTION_PENDING:['待生产审核','Production Review Pending'],COMMERCE_PENDING:['待商务终审','Commercial Review Pending'],RECEIVED:['已入库','Received'],PREPARING:['备货作业中','Preparing'],WORKING:['备货作业中','Preparing'],PENDING_COMPLETION_REVIEW:['待完工审核','Completion Review Pending'],COMPLETED:['已完成','Completed'],APPROVED:['已通过','Approved'],REJECTED:['已退回','Returned'],RECTIFY:['待整改','Changes Required'],CANCELLED:['已取消','Cancelled'],WITHDRAWN:['已撤回','Withdrawn'],PREPARED:['已备货','Prepared'],PARTIAL:['部分发运','Partially Shipped'],FULFILLED:['全部发运','Fully Shipped'],WAITING:['待办理','Waiting'],MATCHED:['已匹配','Matched'],LOADING:['装车中','Loading'],REVIEW_PENDING:['待装车审核','Loading Review Pending'],LOADED:['已装车','Loaded'],READY:['已审核待申报','Reviewed; Awaiting Declaration'],DEPARTED:['已申报离场','Departure Declared'],DEPARTED_PENDING:['待出库审核','Outbound Review Pending'],DEPARTED_CORRECTION:['出库申报退回','Declaration Returned'],OUTBOUND_PENDING:['待物流审核','Logistics Review Pending'],LOGISTICS_APPROVED:['物流审核通过','Logistics Approved'],OUTBOUND_CORRECTION:['出库审核退回','Outbound Review Returned'],OUTBOUND:['已正式出库','Outbound Posted'],EXITED:['已确认出厂','Physical Exit Confirmed'],OPEN:['执行中','Open'],CLOSED:['已关闭','Closed'],REQUESTED:['待更正审批','Correction Review Pending'],AUTHORIZED:['更正审批通过','Correction Authorized'],RETURN_VERIFIED:['实物退回已核验','Physical Return Verified'],APPLIED:['已生效','Applied'],RESOLVED:['已处理','Resolved'],NEW:['待处理','New'],INVESTIGATING:['核查中','Under Review']};
  const value=(v,field)=>v==null?'—':field==='state'?(states[v]?this.t(...states[v]):this.t('状态未识别','Unrecognized State')):String(v);
  return '<details class="r10-change-details"><summary>'+this.t('变更详情','Change Details')+'</summary><div class="r10-change-fields">'+changes.map(c=>'<div class="r10-change-field"><b>'+esc(I18n.language==='en'?c.label[1]:c.label[0])+'</b><div class="r10-change-values"><span>'+esc(value(c.before,c.field))+'</span><span aria-label="'+this.t('变更为','changed to')+'">→</span><span>'+esc(value(c.after,c.field))+'</span></div></div>').join('')+'</div></details>';
 },
 flow(w){
  const completed=['RECEIVED','CONFIRMED','COMPLETED','PREPARED','PARTIAL','FULFILLED','APPROVED','OUTBOUND','EXITED'].includes(w.state),labels={'sales':['销售计划审批','Sales Plan Approval'],'sales-close':['关闭计划审批','Plan Closure Approval'],'co-amend':['备货更正审批','Preparation Correction Approval'],'co-match-review':['匹配变更审批','Match Change Approval'],'lot-cancel':['备货取消审批','Preparation Cancellation Approval'],'co-exception':['装车异常复核','Loading Exception Review'],'correction':['出库更正审批','Outbound Correction Approval'],gate:['出门证办理流程','Gate Permit Workflow']},label=labels[w.kind]?this.t(...labels[w.kind]):this.t('审批与业务进度','Approval and Business Progress');
  return '<section class="r10-flow" data-workflow-kind="'+esc(w.kind)+'"><header><h2>'+label+'</h2>'+(w.cancelled?'<span>'+this.t('流程已终止','Workflow Ended')+'</span>':w.legacy?'<span>'+this.t('历史流程未记录','Historical Workflow Not Recorded')+'</span>':'')+'</header><ol>'+w.nodes.map((n,i)=>{const state=w.legacy||w.cancelled?'waiting':i<w.rank||completed&&i===w.rank?'done':i===w.rank?(w.rejected?'returned':'current'):'waiting';return '<li class="'+state+'" '+(state==='current'?'aria-current="step"':'')+'><span class="r10-step-number">'+(state==='done'?'✓':i+1)+'</span><strong>'+esc(I18n.language==='en'?n.title_en:n.title)+'</strong><div class="r10-step-roles">'+this.roleNames(n.roles)+'</div></li>';}).join('')+'</ol></section>';
 },
 history(h,{compact=false,id=''}={}){
  const t=this.t,headers=[t('办理时间','Time'),t('节点／动作','Step / Action'),t('办理人员','Name'),t('角色','Role'),t('结果','Result'),t('审批意见','Review Note')];
  return '<section class="r10-history'+(compact?' compact':'')+'" data-approval-history="'+esc(id)+'"><header><h2>'+t('审批历史','Approval History')+'</h2><span>'+h.total+' '+t('条','records')+'</span></header>'+(h.items.length?'<div class="r10-history-scroll"><table data-v34-enhanced="true"><thead><tr>'+headers.map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody>'+h.items.map(r=>{const role=r.role_name?(I18n.language==='en'?r.role_name_en||r.role_name:r.role_name):t('历史角色未记录','Historical Role Not Recorded'),values=[BusinessTime.display(r.at),I18n.language==='en'?r.title[1]:r.title[0],(I18n.language==='en'?r.actor_name_en||r.actor_name:r.actor_name)||t('历史人员未记录','Historical Name Not Recorded'),role,I18n.language==='en'?r.result[1]:r.result[0],r.note||'—'];return '<tr data-history-id="'+esc(r.id)+'" data-role-basis="'+esc(r.role_basis)+'">'+values.map((v,i)=>'<td data-label="'+esc(headers[i])+'" '+([0,2,3,5].includes(i)?'data-no-i18n':'')+'>'+esc(v)+(i===5?this.changeDetails(r.changes):'')+'</td>').join('')+'</tr>';}).join('')+'</tbody></table></div>':'<p class="r10-empty">'+t('暂无审批记录','No Approval Records')+'</p>')+'<div class="r10-history-pager"><button type="button" class="button secondary" data-approval-page="'+(h.page-1)+'" '+(h.page<=1?'disabled':'')+'>'+t('上一页','Previous')+'</button><span data-no-i18n>'+h.page+' / '+Math.max(1,Math.ceil(h.total/h.page_size))+'</span><button type="button" class="button secondary" data-approval-page="'+(h.page+1)+'" '+(h.page*h.page_size>=h.total?'disabled':'')+'>'+t('下一页','Next')+'</button></div></section>';
 },
 record(id){return [...this.records.values()].reverse().find(r=>r.approval.product===ProductContext.code&&r.approval.id===id);},
 hideNative(root,kind){
  const hide=n=>{if(!n||n.closest('.r10-owned')||n.querySelector('form'))return;n.classList.add('r10-native-hidden');};
  const workDetails=n=>{const existing=n.closest('.r10-work-details'),label=this.t('作业变更明细','Work Change Details');if(existing){const summary=existing.querySelector('summary');if(summary.textContent!==label)summary.textContent=label;return;}const details=document.createElement('details');details.className='r10-work-details';const summary=document.createElement('summary');summary.textContent=label;n.before(details);details.append(summary,n);const card=details.closest('.p46-card');if(card)for(const b of card.querySelectorAll('[id^="co-history-"]')){const pager=b.parentElement;if(pager&&!pager.contains(details))details.append(pager);}};
  for(const n of root.querySelectorAll('.ux10-workflow,.op-flow,.o4-flow,.s468-flow,.g468-steps,.op-history,.ux10-plan-audit'))hide(n);
  for(const n of root.querySelectorAll('details'))if(/^(盘点审批及历史|审批历史|操作历史|Approval History|Action History)$/.test(n.querySelector('summary')?.textContent.trim()||''))hide(n);
  for(const table of root.querySelectorAll('table')){
   if(table.closest('.r10-owned'))continue;
   if(/时间|Time/.test(table.tHead?.innerText||'')&&/操作人|办理人|Actor|Operator/.test(table.tHead?.innerText||'')&&!table.querySelector('tbody button:not([disabled]),tbody input,tbody select')){
    const block=table.closest('.business-table,.table-scroll,.s468-close-table')||table;
    if(kind==='co-preparation'&&/袋号|Bag No|Before|修改前/.test(table.tHead?.innerText||''))workDetails(block);else hide(block);
   }
  }
  for(const list of root.querySelectorAll('ol'))if(!list.closest('.r10-owned,.ux10-workflow,.op-flow,.o4-flow,.g468-steps')&&/\d{4}[-/]\d{2}[-/]\d{2}/.test(list.textContent)){if(kind==='lot'){if(!list.closest('#v262-history'))workDetails(list);for(const row of list.children)if(/·\s*(APPROVE|REJECT|SUBMIT|CANCEL|REOPEN)\s*·/.test(row.textContent))hide(row);const changes={CREATE_ITEM:['加入备货捆包','Bundle Added to Preparation'],WEIGH:['检斤录入','Weighing Saved'],SEAL_INVALIDATED:['铅封失效','Seal Invalidated'],SEAL:['铅封录入','Seal Saved'],'SAMPLE-STAGE':['取样进度更新','Sampling Progress Updated'],'SAMPLE-MARK':['取样标记更新','Sampling Mark Updated']};const walk=document.createTreeWalker(list,NodeFilter.SHOW_TEXT);let text;while((text=walk.nextNode()))for(const [code,labels]of Object.entries(changes))if(text.textContent.includes(' · '+code+' · '))text.textContent=text.textContent.replace(' · '+code+' · ',' · '+this.t(...labels)+' · ');}else {hide(list);if(list.parentElement?.matches('details.loading465-history'))hide(list.parentElement);}}
  for(const heading of root.querySelectorAll('h2,h3,h4')){
   if(heading.closest('.r10-owned'))continue;
   if(/^(审批历史|审批记录|办理记录|操作历史|操作记录|Approval History|Approval Records|Recorded Activity|Action History|Operation History)$/.test(heading.textContent.trim())){
    const card=heading.closest('.p46-card,.loading465-history');if(card&&!card.querySelector('form,input,select,textarea,[data-execution-action],[data-review],[data-sales-review]')&&(!card.querySelector('table,ol')||[...card.querySelectorAll('table,ol')].every(n=>n.closest('.r10-native-hidden'))))hide(card);else hide(heading);
   }
  }
  for(const card of root.querySelectorAll('.p46-card,.loading465-history')){if(card.closest('.r10-owned')||card.querySelector('.r10-owned,form,input,select,textarea,a'))continue;const tables=[...card.querySelectorAll('table')];if(tables.length&&tables.every(n=>n.closest('.r10-native-hidden'))&&[...card.querySelectorAll('button')].every(b=>/上一页|下一页|较新|较早|Previous|Next|Newer|Older/.test(b.textContent)))hide(card);}
 },
 render(root,record,{preview=false,dialog=false}={}){
  const a=record.approval,signature=I18n.language+'|'+JSON.stringify(a),key=a.kind+'|'+a.id,owned=[...root.querySelectorAll('.r10-owned')].filter(n=>n.dataset.approvalKey===key);
  const expectedHistoryParent=a.kind==='gate'?root.querySelector('#g468-history')||root:root.querySelector('.co469-history-slot')||root;
  if(owned.length===(a.kind==='sales'?1:2)&&owned.every(n=>n.dataset.signature===signature)&&owned.find(n=>n.classList.contains('r10-history-host'))?.parentElement===expectedHistoryParent){this.hideNative(root,a.kind);return;}
  for(const old of owned)old.remove();
  const flow=document.createElement('div');flow.className='r10-owned r10-workflows';flow.dataset.noI18n='';flow.dataset.approvalKey=key;flow.dataset.signature=signature;flow.innerHTML=a.workflows.map(w=>this.flow(w)).join('');
  // Keep operation identities and native business controls in their original layout.
  if(a.kind!=='sales')root.prepend(flow);
  const history=document.createElement('div');history.className='r10-owned r10-history-host';history.dataset.noI18n='';history.dataset.approvalKey=key;history.dataset.signature=signature;const loading=/^\/outbounds\/(?:loads\/)?[0-9a-f-]{36}$/.test(location.pathname);
  history.innerHTML=(loading&&!a.history.total?'':this.history(a.history,{compact:preview,id:a.id}))+(preview?'':(a.related||[]).map(r=>'<section class="r10-related" data-related-id="'+esc(r.id)+'"><h2>'+this.t('更正审批','Correction Approval')+' · '+esc(r.code)+'</h2>'+r.workflows.map(w=>this.flow(w)).join('')+this.history(r.history,{id:r.id})+'</section>').join(''));(a.kind==='gate'?root.querySelector('#g468-history')||root:root.querySelector('.co469-history-slot')||root).append(history);
  history.hidden=!history.hasChildNodes();
  history.onclick=async e=>{const button=e.target.closest('[data-approval-page]');if(!button||button.disabled)return;const relatedId=button.closest('[data-related-id]')?.dataset.relatedId,related=relatedId?(a.related||[]).find(r=>r.id===relatedId):null;button.disabled=true;try{const [path,query]=(related?.url||record.url).split('?'),q=new URLSearchParams(query);q.set('approval_page',button.dataset.approvalPage);const d=await API.request(path+'?'+q);if(!root.isConnected||!d._approval)return;if(related){related.history=d._approval.history;this.render(root,record,{preview,dialog});}else if(d._approval.id===a.id)this.render(root,{url:path+'?'+q,data:d,approval:d._approval},{preview,dialog});}catch(err){notify(err.message);}finally{if(button.isConnected)button.disabled=false;}};
  this.hideNative(root,a.kind);
 },
 draft(root){
  const path=location.pathname,co=ProductContext.code==='CO_HYDROXIDE';let kind;
  if(/^\/sales-plans\/new$/.test(path))kind='sales';else if(/^\/receipts\/new$/.test(path)||/^\/preparation\/new$/.test(path)&&co)kind=co?'co-preparation':'receipt';else if(path==='/preparation/new')kind='lot';else if(path==='/loading-plans/new')kind=co?'co-plan':'plan';else if(path==='/outbounds/loads/new')kind='load';else if(path==='/stocktaking/new')kind=co?'co-stocktake':'stocktake';
  if(!kind||kind==='sales')return;for(const flow of root.querySelectorAll('.o4-flow,.op-flow,.ux10-workflow,.s468-flow'))if(!flow.classList.contains('r10-native-hidden'))flow.classList.add('r10-native-hidden');const w=this.catalog?.drafts?.[ProductContext.code]?.[kind];if(!w)return;
  const signature=I18n.language+'|'+kind+'|'+ProductContext.code;let own=root.querySelector('.r10-draft-flow');if(own?.dataset.signature===signature){if(root.firstElementChild!==own)root.prepend(own);return;}own?.remove();own=document.createElement('div');own.className='r10-owned r10-draft-flow';own.dataset.noI18n='';own.dataset.signature=signature;own.innerHTML=this.flow(w);root.prepend(own);for(const flow of root.querySelectorAll('.o4-flow,.ux10-workflow,.s468-flow'))flow.classList.add('r10-native-hidden');
 },
 registrationHistory(){
  const box=document.querySelector('#dialog[open] .reg-admin');if(!box||!this.registration)return;
  const signature=I18n.language+'|'+JSON.stringify(this.registration.map(r=>[r.id,r._approval_history]));if(box.dataset.approvalSignature===signature)return;box.dataset.approvalSignature=signature;
  box.querySelector('.r10-registration')?.remove();const entries=this.registration.flatMap(r=>(r._approval_history?.items||[]).map(h=>({...h,title:h.title.map(v=>v+' · '+r.username)})));entries.sort((a,b)=>new Date(b.at)-new Date(a.at));const target=document.createElement('div');target.className='r10-owned r10-registration';target.dataset.noI18n='';target.innerHTML=this.history({items:entries,total:entries.length,page:1,page_size:Math.max(1,entries.length)},{id:'registration'});box.append(target);
 },
 registrationReviewFlow(){
  const form=document.querySelector('#dialog[open] #reg-review-form'),r=this.registrationReview;if(!form||!r)return;
  const signature=I18n.language+'|'+r.id+'|'+r.status;if(form.dataset.approvalSignature===signature)return;form.dataset.approvalSignature=signature;form.querySelector('.r10-registration-flow')?.remove();
  const own=document.createElement('div');own.className='r10-owned r10-registration-flow reg-wide';own.dataset.noI18n='';own.innerHTML=this.flow({kind:'registration',state:r.status,rank:r.status==='PENDING'?0:1,nodes:[{title:'注册申请审批',title_en:'Account Registration Review',roles:this.catalog?.roles?.[ProductContext.code]?.['users:manage']||[]}]});form.prepend(own);
 },
 mount(){
  const root=document.getElementById('page-content');if(!root||!window.AppSignedIn)return;
  if(this.observedRoot!==root){this.observer.observe(root,{childList:true,subtree:true});this.observedRoot=root;}
  const q=new URLSearchParams(location.search),id=this.manual?.product===ProductContext.code&&this.manual.path===location.pathname?this.manual.id:q.get('permit')||location.pathname.match(/[0-9a-f-]{36}/)?.[0],record=id?this.record(id):null;
  const preview=window.OperationWorkspace?.active,previewRoot=preview?.node?.querySelector('.op-preview-content');if(previewRoot&&preview.selected){const r=this.record(preview.selected);if(r)this.render(previewRoot,r,{preview:true});}
  if(record&&!location.pathname.endsWith('/dispatch')){const gate=record.approval.kind==='gate'?document.querySelector('#gate-handling[open] .g468-dialog-body'):null;this.render(gate||root,record);}
  else if(!id)this.draft(root);
  const dialog=document.querySelector('#dialog[open]'),title=document.getElementById('dialog-title')?.textContent||'';
  if(dialog&&/调整|Adjustment|更正|Correction/.test(title)){const r=[...this.records.values()].reverse().find(r=>r.approval.product===ProductContext.code&&r.approval.kind===(/调整|Adjustment/.test(title)?'adjustment':'correction'));if(r)this.render(document.getElementById('dialog-content'),r,{dialog:true});}
  this.registrationHistory();
  this.registrationReviewFlow();
 }
};
