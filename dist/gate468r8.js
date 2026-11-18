'use strict';
// Scoped presentation for the existing gate-permit and physical-exit APIs.
window.GateWorkspace468={
 generation:0,t:(z,e)=>I18n.language==='en'?e:z,
 signature:()=>ProductContext.code+'|'+location.pathname+location.search,
 query(){const q=new URLSearchParams(location.search);for(const k of ['permit','order','pane'])q.delete(k);q.set('view','departures');return q;},
 link(extra={}){const q=this.query();for(const [k,v]of Object.entries(extra)){if(v)q.set(k,v);else q.delete(k);}return '/outbounds?'+q;},
 state:s=>GateWorkspace468.t(...({MISSING:['待生成出门证','Permit Not Generated'],READY:['待确认实际出厂','Awaiting Physical Exit'],HISTORY_PENDING:['历史车辆待确认出厂','Historical Exit Pending'],EXITED:['已确认实际出厂','Physical Exit Confirmed']}[s]||['全部','All'])),
 exitHistoryAllowed(){return GateUI.can('gate:exit')&&['sales_manager','sales_operator','admin'].includes(CurrentUser.role_code);},
 filters(q,list,states){
  const t=this.t;
  const input=(key,zh,en,type='search')=>'<label>'+t(zh,en)+'<input name="'+key+'" type="'+type+'" maxlength="160" value="'+esc(q.get(key)||'')+'"></label>';
  const options=(values,key,label)=>values.map(value=>'<option value="'+esc(value)+'" '+((q.get(key)||'')===value?'selected':'')+'>'+esc(label(value))+'</option>').join('');
  return '<form id="gate-filter" class="filters wms-filter-row"><div class="form-grid">'+input('permit_no','出门证编号','Gate Permit No.')+
   input('truck_no','车牌号','Truck Plate')+'<label>'+t('客户','Customer')+'<select name="customer">'+
   options(['',...(list.customers||[])],'customer',value=>value||t('全部客户','All Customers'))+'</select></label>'+
   input('approved_on','出库审批时间','Outbound Approval Date','date')+'<label>'+t('状态','State')+'<select name="state">'+
   options(states,'state',value=>this.state(value))+'</select></label></div>'+
   '<div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+'</button><a class="button secondary" data-wms-reset href="'+GateUI.path()+'">'+t('重置','Reset')+'</a></div></form>';
 },
 historyRow(row,selectable){
  const t=this.t,confirmed=row.state==='EXITED';
  const select=selectable?'<td>'+(confirmed?'—':'<input type="checkbox" data-historical-exit value="'+esc(row.historical_source_id)+'" aria-label="'+esc(t('选择 ','Select ')+row.code)+'">')+'</td>':'';
  const link=row.historical_detail_id&&GateUI.can('load:read')?'<a class="button secondary" href="/outbounds/historical/'+esc(row.historical_detail_id)+'">'+t('查看历史单据','View Historical Document')+'</a>':'—';
  return '<tr data-gate-order="'+esc(row.order_id)+'">'+select+'<td data-no-i18n><strong>'+esc(row.document_no||'—')+'</strong><small>'+t('历史装箱单','Historical Packing List')+' '+esc(row.code)+'</small></td>'+
   '<td data-no-i18n>'+esc(row.truck_no)+'</td><td data-no-i18n>'+esc(row.customer_name||'—')+'</td><td>—<small data-no-i18n>'+
   t('发运日期 ','Shipping date ')+esc(row.shipping_date)+'</small></td><td><span class="g468-badge" data-state="'+row.state+'">'+this.state(row.state)+'</span>'+
   (confirmed?'<small data-no-i18n>'+esc(BusinessTime.display(row.historical_exit_confirmed_at))+'</small>':'')+'</td><td>'+link+'</td></tr>';
 },
 bindHistory(){
  const button=$('gate-confirm-history');
  if(!button)return;
  const t=this.t,checks=[...document.querySelectorAll('[data-historical-exit]')],all=$('gate-select-history');
  const selected=()=>checks.filter(box=>box.checked);
  const update=()=>{const count=selected().length;button.disabled=!count;all.checked=count===checks.length;all.indeterminate=!!count&&!all.checked;};
  for(const box of checks)box.onchange=update;
  all.onchange=()=>{const checked=all.checked;checks.forEach(box=>{box.checked=checked;});update();};
  button.onclick=async()=>{
   const rows=selected(),error=$('gate-error');
   if(rows.length>30){error.textContent=t('每次最多确认 30 张历史单据。','Select no more than 30 historical documents at a time.');return;}
   let evidence='';
   if(!await OperationConfirm.ask({title:t('确认所选历史车辆均已实际出厂？','Confirm all selected historical vehicles have physically exited?'),
    rows:[[t('历史单据数','Historical Documents'),rows.length]],comment:true,commentRequired:true,commentMax:500,
    commentLabel:t('出厂核对依据（至少 5 个字符）','Exit evidence (at least 5 characters)'),onComment:value=>{evidence=value;}}))return;
   button.disabled=true;error.textContent='';
   try{
    const result=await API.request(GateUI.base()+'/historical-exits',{method:'POST',body:{ids:rows.map(box=>box.value),actual_exit:true,evidence}});
    await this.render();
    notify(t('已确认 '+result.count+' 张历史单据出厂','Confirmed exit for '+result.count+' historical documents'));
   }catch(e){error.textContent=e.message;update();}
  };
  update();
 },
 printed(d){return d.history.some(e=>e.action==='gate_print_dialog_requested'&&Number(e.after_data?.revision)===d.permit.current_revision);},
 facts(rows){return '<dl class="g468-facts">'+rows.map(([k,v])=>'<div><dt>'+k+'</dt><dd data-no-i18n>'+esc(v??'—')+'</dd></div>').join('')+'</dl>';},
 table(headers,rows,id){if(id==='gate-list')rows=rows.map(row=>{let i=0;return row.replace(/<td([^>]*)>/g,(m,attrs)=>{
  if(attrs.includes('colspan'))return m;
  const heading=headers[i++];
  return '<td'+attrs+' data-label="'+esc(heading?.startsWith('<input')?this.t('选择','Select'):heading)+'">';
 });});return '<div class="g468-scroll"><table id="'+id+'" data-v34-enhanced="true" data-v34-server="true"><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';},
 async render(id){
  if(!GateUI.can('gate:read'))throw Error(this.t('无车辆出厂权限','No gate access permission'));
  const generation=++this.generation,scope=this.signature(),q=new URLSearchParams(location.search),t=this.t;
  const [list,detail]=await Promise.all([API.request(GateUI.base()+'?'+this.query()),id?API.request(GateUI.base()+'/'+id):null]);
  const printers=detail&&GateUI.can('gate:print')?(await API.request('/printers')).items.filter(x=>x.active&&x.project_id===detail.permit.project_id):[];
  if(generation!==this.generation||scope!==this.signature()||!window.AppSignedIn)return;
  this.list=list;this.detail=detail;GateUI.data=detail;
  if(detail){if(GateUI.preserveVersion?.id===id)detail.permit.version=GateUI.preserveVersion.version;GateUI.detailVersion={id,version:detail.permit.version};}
  const counts=list.counts||{},states=['','MISSING','READY','HISTORY_PENDING','EXITED'];
  const selectable=this.exitHistoryAllowed()&&list.items.some(row=>row.state==='HISTORY_PENDING');
  const cards='<nav class="g468-states" aria-label="'+t('出厂状态','Gate State')+'">'+states.map(s=>'<a class="g468-state" '+((q.get('state')||'')===s?'aria-current="page"':'')+' href="'+esc(this.link({state:s,page:null}))+'"><span>'+(s?this.state(s):t('全部车辆','All Vehicles'))+'</span><strong>'+Number(s?counts[s]||0:Object.values(counts).reduce((n,v)=>n+Number(v),0))+'</strong></a>').join('')+'</nav>';
  const rows=list.items.map(r=>{if(r.historical_source_id)return this.historyRow(r,selectable);const s=r.state||'MISSING',href=this.link(r.permit_id?{permit:r.permit_id,pane:s==='EXITED'?'history':r.current_print_requested?'exit':'print'}:{order:r.order_id}),label=s==='MISSING'?t('核对并生成','Verify and Generate'):s==='EXITED'?t('查看记录','View Record'):r.current_print_requested?t('确认出厂','Confirm Exit'):t('打印出门证','Print Permit');return '<tr data-gate-order="'+r.order_id+'">'+(selectable?'<td>—</td>':'')+'<td data-no-i18n><strong>'+esc(r.document_no||'—')+'</strong><small>'+esc(r.permit_id?t('当前版本','Current Version')+' V'+r.current_revision:t('待生成出门证','Permit Not Generated'))+'</small></td><td data-no-i18n>'+esc(r.truck_no||'—')+'</td><td data-no-i18n>'+esc(r.customer_name||'—')+'</td><td data-no-i18n>'+esc(BusinessTime.display(r.approved_at))+'</td><td><span class="g468-badge" data-state="'+s+'">'+this.state(s)+'</span>'+(s==='READY'?'<small>'+t(r.current_print_requested?'当前版本打印窗口已请求':'待打开当前版本打印窗口',r.current_print_requested?'Current Print Window Requested':'Current Print Window Required')+'</small>':'')+'</td><td><div class="g468-row-actions"><a class="button '+(s==='EXITED'?'secondary':'primary')+'" href="'+esc(href)+'">'+label+'</a>'+(s==='READY'?'<a class="g468-text-link" href="'+esc(this.link({permit:r.permit_id,pane:'print'}))+'">'+t('查看 / 打印','View / Print')+'</a>':'')+'</div></td></tr>';});
  const select=selectable?'<input type="checkbox" id="gate-select-history" aria-label="'+t('选择本页历史车辆','Select Historical Vehicles on This Page')+'">':'';
  const bulk=selectable?'<div class="business-toolbar"><button type="button" class="button secondary" id="gate-confirm-history" disabled>'+
   t('批量确认历史车辆出厂','Confirm Historical Exits')+'</button></div>':'';
  const heads=[...(selectable?[select]:[]),t('出门证编号','Gate Permit No.'),t('车牌号','Truck Plate'),t('客户','Customer'),
   t('出库审批时间','Outbound Approval Time'),t('状态','State'),t('操作','Actions')];
  const content=cards+'<section class="g468-list">'+this.filters(q,list,states)+bulk+
   this.table(heads,rows.length?rows:['<tr><td colspan="'+heads.length+'">'+t('暂无符合条件的车辆','No Vehicles Match These Filters')+'</td></tr>'],'gate-list')+
   '<footer class="g468-list-footer"><span>'+t('共','Total')+' '+list.total+' '+t('辆','vehicles')+'</span>'+
   CobaltStockUI.pager(list.page,list.total,list.page_size)+'</footer></section>';
  const missing=!id&&q.get('order')?list.items.find(r=>!r.historical_source_id&&r.order_id===q.get('order')):null;
  Router.page(t('车辆出厂管理','Vehicle Gate Exit'),'<section class="g468 gate-page" data-ui468-owned="gate" data-no-i18n><div class="g468-top"><span>'+t('卢本巴希时间','Lubumbashi Time')+'</span>'+'</div>'+content+(detail?this.modal(detail,printers,list.items.find(r=>r.permit_id===id)):missing?this.missingModal(missing):'')+(!detail&&!missing?'<p id="gate-error" class="error" role="alert"></p>':'')+'</section>');
  GateUI.nav();ProductContext.dirty=false;
  $('gate-filter').onsubmit=e=>{e.preventDefault();Router.go(this.link({...Object.fromEntries(new FormData(e.target)),search:null,page:null,order:null,permit:null,pane:null}));};
  CobaltStockUI.bindPager(list);
  this.bindHistory();
  const dialog=$('gate-handling');if(dialog){dialog.addEventListener('cancel',e=>{e.preventDefault();Router.go(this.link());});this.bind(detail,missing);dialog.showModal();}
 },
 modal(d,printers,row){
  const t=this.t,p=d.permit,r=d.revisions[0],s=r.snapshot,id=p.id,printed=this.printed(d),canExit=GateUI.can('gate:exit')&&['sales_manager','sales_operator'].includes(CurrentUser.role_code),url='/api/v1'+GateUI.base()+'/'+id+'/revisions/'+r.revision;
  const print=GateUI.can('gate:print')?'<div class="g468-print-state"><span>'+t('当前版本','Current Version')+' V'+r.revision+'</span><span>'+t(printed?'本版打印窗口已请求':'本版打印窗口尚未打开',printed?'Print Window Requested':'Print Window Required')+'</span></div><label>'+t('打印配置','Printer Profile')+'<select id="gate-printer"><option value="">'+t('本机系统打印窗口 · A4纵向','System Print Dialog · A4 Portrait')+'</option>'+printers.map(x=>'<option value="'+x.id+'">'+esc(x.name+' · '+x.queue_name+' · '+x.paper_size+' · '+t(x.orientation==='portrait'?'纵向':'横向',x.orientation==='portrait'?'Portrait':'Landscape'))+'</option>').join('')+'</select></label><div class="g468-tools"><a class="button secondary" target="_blank" rel="noopener" href="'+url+'/view">'+t('预览当前出门证','Preview Current Permit')+'</a><a class="button secondary" href="'+url+'/file">'+t('下载 Excel','Download Excel')+'</a><button id="gate-print-open" class="button primary">'+t(p.state==='EXITED'?'补打当前版本':'打开打印窗口',p.state==='EXITED'?'Reprint Current Version':'Open Print Window')+'</button></div><p class="g468-note">'+t('打印窗口记录不代表实际出纸；出厂确认前核对当前版本纸证及现场签字。','A print-window record does not prove paper output. Verify the current paper permit and on-site signatures before confirming exit.')+'</p>':'<p>'+t('当前账号无打印权限','This Account Cannot Print Permits')+'</p>';
  const exit=d.exit?'<div class="g468-exited"><h3>'+t('已确认实际出厂','Physical Exit Confirmed')+'</h3>'+this.facts([[t('实际出厂时间','Actual Gate Exit'),BusinessTime.display(d.exit.actual_exit_at)],[t('确认版本','Confirmed Version'),'V'+d.exit.revision],[t('备注','Note'),d.exit.note||'—']])+'</div>':canExit?'<form id="gate-exit" class="g468-exit-form"><div class="g468-print-state"><span>'+t('核对版本','Verify Version')+' V'+r.revision+'</span><span>'+t(printed?'当前版本打印窗口已请求':'请先打开当前版本打印窗口',printed?'Current Print Window Requested':'Open Current Print Window First')+'</span></div><div class="g468-time"><label>'+t('实际出厂时间 · 卢本巴希','Actual Gate Exit · Lubumbashi')+'<input name="actual_exit_at" type="datetime-local" step="0.001" required></label><button id="gate-now" type="button" class="button secondary">'+t('填入当前项目时间','Use Current Project Time')+'</button></div><label>'+t('备注','Note')+'<textarea name="note" maxlength="1000" rows="2"></textarea></label><label class="gate-check"><input name="printed_permit_checked" type="checkbox" required><span>'+t('已打印当前版本出门证，并核对车辆、业务资料及现场签字','Current Permit Printed; Truck, Business Details and On-Site Signatures Checked')+'</span></label><label class="gate-check"><input name="actual_exit" type="checkbox" required><span>'+t('确认车辆已经实际通过厂区出口','The Truck Has Physically Passed the Gate')+'</span></label><div class="g468-tools"><button type="button" class="button secondary" data-gate-tab="print">'+t('返回打印核对','Return to Printing')+'</button><button class="button primary" '+(!printed?'disabled':'')+'>'+t('确认实际出厂','Confirm Physical Exit')+'</button></div></form>':'<p>'+t('由销售经理或销售业务员确认实际出厂','Sales Manager or Sales Operator Confirms Physical Exit')+'</p>';
  const revisions=this.table([t('版本','Version'),t('生成时间','Generated At'),t('原因','Reason'),t('操作','Actions')],d.revisions.map(x=>'<tr><td>V'+x.revision+(x.revision===r.revision?' · '+t('当前','Current'):'')+'</td><td data-no-i18n>'+esc(BusinessTime.display(x.generated_at))+'</td><td data-no-i18n>'+esc(x.reason)+'</td><td>'+(GateUI.can('gate:print')?'<a class="button secondary" target="_blank" rel="noopener" href="/api/v1'+GateUI.base()+'/'+id+'/revisions/'+x.revision+'/view">'+t('查看原版本','View Version')+'</a> <a href="/api/v1'+GateUI.base()+'/'+id+'/revisions/'+x.revision+'/file">Excel</a>':'—')+'<details><summary>'+t('校验值','Checksum')+'</summary><code data-no-i18n>'+esc(x.file_sha256)+'</code></details></td></tr>'),'gate-revisions');
  const history=(p.state==='READY'&&GateUI.can('gate:issue')?'<details class="g468-revise"><summary>'+t('修订出门证','Revise Permit')+'</summary><form id="gate-revise"><label>'+t('修订原因','Revision Reason')+'<textarea name="reason" required maxlength="1000" rows="2"></textarea></label><button class="button secondary">'+t('生成新版本','Generate New Version')+'</button></form></details>':'')+'<h3>'+t('历史版本','Revision History')+'</h3>'+revisions+'<h3>'+t('办理记录','Action History')+'</h3>'+this.table([t('时间','Time'),t('办理人','Actor'),t('操作','Action')],d.history.map(h=>'<tr><td data-no-i18n>'+esc(BusinessTime.display(h.occurred_at))+'</td><td data-no-i18n>'+esc(h.actor_name)+'</td><td>'+GateUI.event(h.action)+'</td></tr>'),'gate-history');
  return '<dialog id="gate-handling" aria-labelledby="gate-handling-title"><header class="g468-dialog-head"><div><h2 id="gate-handling-title">'+t('车辆出厂办理','Vehicle Gate Handling')+'</h2><p data-no-i18n>'+esc(s.truck_no+' · '+s.customer_name)+'</p></div><a class="button secondary" href="'+esc(this.link())+'">'+t('关闭','Close')+'</a></header><div class="g468-dialog-body">'+this.steps(printed,p.state==='EXITED')+this.facts([[t('出门证编号','Gate Permit No.'),s.document_no],[t('当前版本','Current Version'),'V'+r.revision],[t('车牌号','Truck Plate'),s.truck_no],[t('客户','Customer'),s.customer_name],[t('司机','Driver'),s.driver_name],[t('装箱单号','Packing List'),s.packing_list_no],[t(ProductContext.isCopper()?'捆包 / 片数':'袋数',ProductContext.isCopper()?'Bundles / Sheets':'Bags'),CountValues.display(s.quantity)+(ProductContext.isCopper()?' / '+s.sheets:'')],[t('实物净重 kg','Physical Net kg'),s.net_kg],[t('最终出库审批时间','Final Outbound Approval'),BusinessTime.display(row?.approved_at||s.posted_at)]])+(!s.batch_number?'<p class="g468-note">'+t('历史出门证保留原版式及编号。','Historical Permits Retain Their Original Format and Number.')+'</p>':'')+'<nav class="g468-tabs" role="tablist" aria-label="'+t('出厂办理','Gate Handling')+'">'+[['print','出门证与打印','Permit and Printing'],['exit','实际出厂确认','Physical Exit'],['history','版本与办理记录','Versions and History']].map(([k,z,e])=>'<button type="button" id="g468-tab-'+k+'" class="g468-tab" role="tab" aria-controls="g468-'+k+'" data-gate-tab="'+k+'">'+t(z,e)+'</button>').join('')+'</nav><section id="g468-print" role="tabpanel" aria-labelledby="g468-tab-print">'+print+(GateUI.can('gate:print')&&GateUI.can('printer:manage')?'<details id="gate-print-settings"><summary>'+t('出门证打印设置','Gate Permit Print Settings')+'</summary><div data-gate-print-profiles role="status"></div></details>':'')+'</section><section id="g468-exit" role="tabpanel" aria-labelledby="g468-tab-exit" hidden>'+exit+'</section><section id="g468-history" role="tabpanel" aria-labelledby="g468-tab-history" hidden>'+history+'</section><p id="gate-error" class="error" role="alert"></p></div></dialog>';
 },
 steps(printed,exited){const t=this.t;return '<ol class="g468-steps">'+[[true,t('最终出库审批','Final Outbound Approval'),t('已通过','Approved')],[printed,t('当前版本打印','Current Version Printing'),t(printed?'打印窗口已请求':'待打开打印窗口',printed?'Print Window Requested':'Awaiting Print Window')],[exited,t('销售确认出厂','Sales Confirms Physical Exit'),t(exited?'已确认实际出厂':'待核对纸证与现场签字',exited?'Physical Exit Confirmed':'Verify Paper Permit and Signatures')]].map(([done,title,state])=>'<li class="'+(done?'is-done':'')+'"><strong>'+title+'</strong><span>'+state+'</span></li>').join('')+'</ol>';},
 missingModal(r){const t=this.t;return '<dialog id="gate-handling" aria-labelledby="gate-handling-title"><header class="g468-dialog-head"><h2 id="gate-handling-title">'+t('核对并生成出门证','Verify and Generate Permit')+'</h2><a class="button secondary" href="'+esc(this.link())+'">'+t('关闭','Close')+'</a></header><div class="g468-dialog-body">'+this.facts([[t('业务批次','Business Batch'),r.batch_number],[t('车牌号','Truck Plate'),r.truck_no],[t('客户','Customer'),r.customer_name],[t('最终出库审批时间','Final Outbound Approval'),BusinessTime.display(r.approved_at)]])+'<a class="button secondary" href="'+(ProductContext.isCopper()?'/outbounds/loads/':'/outbounds/')+r.order_id+'">'+t('核对原出库单据','View Original Outbound')+'</a>'+(GateUI.can('gate:issue')?'<form id="gate-issue"><label class="gate-check"><input type="checkbox" name="facts" required><span>'+t('已核对原单的批次、车辆、司机、单证、数量及重量','Original Batch, Vehicle, Driver, Documents, Quantity and Weight Checked')+'</span></label><label class="gate-check"><input type="checkbox" name="onsite" required><span>'+t('已核实车辆仍在厂内，尚未实际出厂','Vehicle Is Still On Site and Has Not Physically Exited')+'</span></label><div class="g468-tools"><button class="button primary">'+t('生成出门证','Generate Permit')+'</button></div></form>':'<p>'+t('当前账号无生成出门证权限','This Account Cannot Generate Permits')+'</p>')+'<p id="gate-error" class="error" role="alert"></p></div></dialog>';},
 tab(name){if(!['print','exit','history'].includes(name))name='print';this.pane=name;for(const k of ['print','exit','history']){const panel=$('g468-'+k);if(panel)panel.hidden=k!==name;const tab=$('g468-tab-'+k);if(tab)tab.setAttribute('aria-selected',String(k===name));}},
 actualISO(value){const match=value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,3})$/);return match?new Date(Date.parse(BusinessTime.toISO(match[1]))+Number(match[2].padEnd(3,'0'))).toISOString():BusinessTime.toISO(value);},
 bind(d,missing){
  const t=this.t;
  if(missing){if($('gate-issue'))$('gate-issue').onsubmit=e=>{e.preventDefault();GateUI.action(e.submitter,async()=>{const r=await API.request(GateUI.base()+'/from/'+missing.order_id,{method:'POST',body:{}});ProductContext.dirty=false;await Router.go(this.link({order:null,permit:r.permit_id,pane:'print'}));});};return;}
  const p=d.permit,r=d.revisions[0],id=p.id,s=r.snapshot;
  const requested=new URLSearchParams(location.search).get('pane');this.tab(requested||'print');
  for(const b of document.querySelectorAll('[data-gate-tab]'))b.onclick=()=>{this.tab(b.dataset.gateTab);const q=new URLSearchParams(location.search);q.set('pane',b.dataset.gateTab);history.replaceState(history.state,'',location.pathname+'?'+q);};
  const printSettings=$('gate-print-settings');if(printSettings)printSettings.ontoggle=()=>{if(printSettings.open&&!printSettings.dataset.loaded){printSettings.dataset.loaded='1';GateUI.printers(printSettings.querySelector('[data-gate-print-profiles]'),p.project_id,()=>this.render(id));}};
  if($('gate-print-open'))$('gate-print-open').onclick=e=>GateUI.action(e.target,async()=>{
   const win=window.open('about:blank','_blank');if(!win)throw Error(t('浏览器阻止弹窗，请允许此站点弹窗后重试','Browser blocked the window. Allow pop-ups for this site and retry'));
   const fields=$('gate-exit')?[...$('gate-exit').elements].filter(n=>n.name).map(n=>[n.name,n.type==='checkbox'?n.checked:n.value]):[],dirty=ProductContext.dirty;
   try{const job=await API.request(GateUI.base()+'/'+id+'/print',{method:'POST',body:{version:p.version,printer_id:$('gate-printer').value||null}});win.opener=null;win.location='/api/v1'+GateUI.base()+'/'+id+'/revisions/'+r.revision+'/view?job='+job.job_id;await this.render(id);const form=$('gate-exit');if(form)for(const [k,v]of fields){const n=form.elements[k];n.type==='checkbox'?n.checked=v:n.value=v;}ProductContext.dirty=dirty;}catch(err){win.close();throw err;}
  });
  if($('gate-now'))$('gate-now').onclick=()=>{const now=new Date(),a=BusinessTime.parts(now);$('gate-exit').elements.actual_exit_at.value=`${a.year}-${a.month}-${a.day}T${a.hour}:${a.minute}:${a.second}.${String(now.getUTCMilliseconds()).padStart(3,'0')}`;};
  if($('gate-exit'))$('gate-exit').onsubmit=e=>{e.preventDefault();GateUI.action(e.submitter,async()=>{
   const f=e.target,actual=this.actualISO(f.elements.actual_exit_at.value),stamp=Date.parse(actual);if(!Number.isFinite(stamp)||stamp<Date.parse(r.generated_at)||stamp>Date.now())throw Error(t('实际出厂时间须在本版生成时间与当前项目时间之间','Actual exit must be between the current version generation time and now'));
   if(!await OperationConfirm.ask({title:t('确认车辆实际出厂','Confirm Physical Gate Exit'),rows:[[t('车牌号','Truck Plate'),s.truck_no],[t('出门证','Permit'),s.document_no],[t('版本','Version'),'V'+r.revision]],note:t('确认车辆已实际通过厂区出口，原出厂事实与历史版本将保留。','Confirm the truck has physically passed the gate. The exit fact and revisions will be retained.')}))return;
   await API.request(GateUI.base()+'/'+id+'/exit',{method:'POST',body:{version:p.version,actual_exit_at:actual,actual_exit:f.elements.actual_exit.checked,printed_permit_checked:f.elements.printed_permit_checked.checked,note:f.elements.note.value}});ProductContext.dirty=false;await this.render(id);
  });};
  if($('gate-revise'))$('gate-revise').onsubmit=e=>{e.preventDefault();GateUI.action(e.submitter,async()=>{const reason=e.target.elements.reason.value.trim();if(!reason)throw Error(t('请填写修订原因','A revision reason is required'));await API.request(GateUI.base()+'/'+id+'/revise',{method:'POST',body:{version:p.version,reason}});ProductContext.dirty=false;const q=new URLSearchParams(location.search);q.set('pane','print');history.replaceState(history.state,'',location.pathname+'?'+q);await this.render(id);});};
 }
};
