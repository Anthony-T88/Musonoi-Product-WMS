'use strict';
window.PreparationPlans={
 route:'/preparation/work-plans',
 t:(zh,en)=>I18n.language==='en'?en:zh,
 api(){return (ProductContext.isCopper()?'':'/cobalt')+'/preparation-plans';},
 readPermission(){
  const permissions=CurrentUser.permissions,start=ProductContext.isCopper()?'allocation:write':'co:create';
  if(permissions.includes('plan:read'))return 'plan:read';
  if(permissions.includes(start))return start;
  if(['admin','logistics_manager'].includes(CurrentUser.role_code)&&permissions.includes('allocation:review'))return 'allocation:review';
  return null;
 },
 backLink(){
  const co=!ProductContext.isCopper();
  if(!CurrentUser.permissions.includes(co?'co:read':'allocation:read'))return '';
  return '<a class="button secondary" href="'+(co?'/receipts':'/preparation')+'">'+this.t('返回备货管理','Back to Lot Preparation')+'</a>';
 },
 state(state){return this.t(...({
  DRAFT:['草稿','Draft'],PENDING:['待物流经理审批','Pending Logistics Approval'],
  APPROVED:['已批准','Approved'],REJECTED:['已退回','Returned'],CANCELLED:['已取消','Cancelled']
 }[state]||[state,state]));},
 salesPlanLabel(plan){return [plan.code,this.t('发运月份','Shipment Month')+' '+(plan.shipment_month||'—'),plan.customer_name].join(' · ');},
 orderRoute(p){return (ProductContext.isCopper()?'/preparation/':'/receipts/')+(p.allocation_id||p.co_preparation_id);},
 startRoute(p){return (ProductContext.isCopper()?'/preparation/new':'/receipts/new')+'?preparation_plan='+p.id;},
 planStatus(p){
  const t=this.t,co=!ProductContext.isCopper();
  if(p.allocation_id||p.co_preparation_id){
   const state=p.work_state,label=!state?t('待核查','To Be Verified'):co?CobaltUI.status(state):OperationWorkspace.state({kind:'cu-preparation'},state);
   const badge=UI.status(state,'preparation',label);
   return CurrentUser.permissions.includes(co?'co:read':'allocation:read')?'<a href="'+this.orderRoute(p)+'" title="'+t('查看备货单','View Preparation Order')+'">'+badge+'</a>':badge;
  }
  return UI.status('WAITING_ORDER','preparation',t('待创建备货单','Awaiting Preparation Order'));
 },
 pendingCountCard(count){
  const t=this.t;
  return '<div class="v34-kpi" data-pending-preparation-plans title="'+t('已批准、尚无备货单，且对应销售计划仍在执行','Approved plans with no preparation order and an active sales plan')+'"><span>'+t('待创建备货单计划数','Plans Awaiting Preparation Order')+'</span><strong>'+esc(count)+'</strong></div>';
 },
 async selected(){
  const id=new URLSearchParams(location.search).get('preparation_plan');
  if(!id){await this.selectPlan();return null;}
  const p=await API.request(this.api()+'/'+encodeURIComponent(id));
  if(!p.actions.start)throw Error(this.t('该计划尚未获批或已生成作业。','This plan is not approved or already has a work order.'));
  return p;
 },
 async selectPlan(){
  const t=this.t,path=location.pathname,q=new URLSearchParams(location.search);
  q.set('executable','1');
  const d=await API.request(this.api()+'?'+q);
  if(location.pathname!==path||new URLSearchParams(location.search).has('preparation_plan'))return;
  const rows=d.items.map(p=>'<tr><td><a href="'+this.route+'/'+p.id+'">'+esc(p.batch_no)+'</a></td><td>'+esc(p.sales_plan_no)+'</td><td>'+esc(p.customer_name)+'</td><td>'+esc(p.shipment_month)+'</td><td><a class="button primary compact" href="'+this.startRoute(p)+'">'+t('创建备货单','Create Preparation Order')+'</a></td></tr>');
  const table=rows.length?ExportLicenses.table([['备货批次号','Preparation Lot Number'],['销售计划','Sales Plan'],['客户','Customer'],['发运月','Shipment Month'],['操作','Actions']],rows,'executable-preparation-plans',true,{actions:[4]}):
   '<p class="wms-feedback" role="status">'+t('暂无可执行的已审批备货计划。','No approved preparation plan is available for execution.')+'</p>';
  Router.page(t('选择备货计划','Select Preparation Plan'),'<section class="wms-page" data-page-composed data-no-i18n><div class="business-toolbar">'+this.backLink()+'</div>'+
   '<form id="executable-preparation-filter" class="filters wms-filter-row"><label>'+t('批次号 / 销售计划 / 客户','Lot Number / Sales Plan / Customer')+'<input type="search" name="search" maxlength="160" value="'+esc(q.get('search')||'')+'"></label><div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+'</button><a data-wms-reset class="button secondary" href="'+path+'">'+t('重置','Reset')+'</a></div></form>'+
   table+CobaltStockUI.pager(d.page,d.total,d.page_size)+'</section>');
  $('executable-preparation-filter').onsubmit=e=>{e.preventDefault();Router.go(path+'?'+new URLSearchParams(new FormData(e.target)));};
  CobaltStockUI.bindPager(d);ProductContext.dirty=false;
 },
 async batch(){
  const t=this.t,state=this.state.bind(this),co=!ProductContext.isCopper(),api=this.api(),base=(co?'/cobalt':'')+'/sales-workflow/plans';
  if(!['admin','export_supervisor'].includes(CurrentUser.role_code)||!CurrentUser.permissions.includes('plan:read'))
   throw Object.assign(Error(t('当前岗位无权创建备货计划','This role cannot create preparation plans')),{statusCode:403});
  const title=t('新建备货计划','New Preparation Plan'),formId='preparation-plan-batch';
  const heads=[t('备货批次号','Preparation Lot Number'),t('销售计划','Sales Plan'),t('客户','Customer'),
   t('发运月份','Shipment Month'),t('校验结果','Validation'),t('操作','Actions')];
  const back='<a class="button secondary" data-wms-back href="'+this.route+'">'+t('返回备货计划','Back to Plans')+'</a>';
  const grid='<div class="business-table"><table id="preparation-batch-table" class="wms-table" data-v34-server="true"><thead><tr>'+
   heads.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody></tbody></table></div>';
  Router.page(title,'<section class="wms-page" data-page-composed data-no-i18n>'+
   '<form id="'+formId+'" class="user-form" novalidate><div class="business-toolbar wms-batch-toolbar">'+back+
   '<button type="submit" class="button secondary">'+t('保存草稿','Save Drafts')+'</button>'+
   '<button type="submit" class="button primary" data-submit-for-review>'+t('提交审核','Submit for Review')+'</button></div>'+
   '<section class="panel wms-section"><div class="wms-batch-toolbar"><div><h2>'+t('批量录入','Batch Entry')+
   '</h2><p id="preparation-batch-summary" class="wms-feedback" role="status"></p></div><div class="business-toolbar">'+
   '<button id="preparation-batch-add" type="button" class="button secondary">'+t('添加一行','Add Row')+'</button>'+
   '<button id="preparation-batch-paste" type="button" class="button secondary" aria-expanded="false" aria-controls="preparation-paste-panel">'+
   t('粘贴批次号','Paste Lot Numbers')+'</button></div></div>'+
   '<label class="wms-field">'+t('查找可选销售计划','Find Available Sales Plans')+'<input type="search" id="preparation-batch-sales-search" maxlength="160"></label>'+
   '<div id="preparation-paste-panel" class="wms-field" hidden><label for="preparation-paste-text">'+t('批次号（每行一个）','Lot Numbers (one per line)')+'</label>'+
   '<textarea id="preparation-paste-text" rows="3" spellcheck="false"></textarea><div class="business-toolbar">'+
   '<button type="button" class="button secondary" id="preparation-paste-insert">'+t('加入录入表','Add to Table')+'</button>'+
   '<button type="button" class="button secondary" id="preparation-paste-cancel">'+t('取消','Cancel')+'</button></div></div>'+
   grid+'<p class="error wms-feedback" role="alert"></p></section></form>'+
   '<details class="panel wms-section" id="preparation-occupied" open><summary>'+t('已占用批次','Occupied Lots')+'</summary>'+
   '<form class="wms-filter-row filters" id="preparation-occupied-filter" data-v34-reset="true"><label>'+t('查找批次或客户','Find Lot or Customer')+
   '<input name="search" type="search" maxlength="160"></label><div class="wms-filter-actions"><button type="submit" class="button secondary">'+t('查询','Search')+
   '</button><button type="button" class="button secondary" id="preparation-occupied-reset">'+t('重置','Reset')+
   '</button></div></form><div id="preparation-occupied-results" aria-live="polite"></div></details></section>');
  const form=$(formId),tbody=$('preparation-batch-table').tBodies[0],summary=$('preparation-batch-summary');
  const alert=form.querySelector('[role=alert]'),lookup=$('preparation-occupied-filter'),lookupResults=$('preparation-occupied-results');
  const paste=$('preparation-paste-text'),pastePanel=$('preparation-paste-panel'),pasteButton=$('preparation-batch-paste');
  const salesOptions=new Map();
  const data=[],newRow=(batch_no='',defaults={})=>({batch_no,sales_plan_id:defaults.sales_plan_id||'',shipment_month:defaults.shipment_month||''});
  data.push(newRow());
  let shown=[],saleSequence=0,lookupSequence=0,validationSequence=0,timer;
  const messages={
   '发运月无效':t('发运月份无效','Invalid shipment month'),'标识格式无效':t('请选择销售计划','Choose a sales plan'),
   '备货批次号无效':t('填写批次号','Enter a lot number'),'备货批次号格式无效':t('批次号格式无效','Invalid lot number format'),
   '录入表内重复':t('录入表内重复','Duplicate in the entry table'),'备货批次号已占用':t('批次已占用','Lot already occupied'),
   '请选择授权范围内已获批且执行中的销售计划':t('请选择授权范围内已获批且执行中的销售计划','Choose an authorized, approved and open sales plan')
  };
  const translate=message=>messages[message]||I18n.translate(message,true);
  const renderOptions=(select,row)=>{
   const ids=[...new Set([row.sales_plan_id,...shown])].filter(id=>salesOptions.has(id));
   select.replaceChildren(new Option(t('请选择','Select'),''));
   for(const id of ids){const p=salesOptions.get(id);select.add(new Option(this.salesPlanLabel(p),id));}
   select.value=row.sales_plan_id;
  };
  function render(){
   tbody.innerHTML=data.map((r,i)=>'<tr data-preparation-row="'+i+'">'+
    '<td><input type="text" name="batch_no" data-field="batch_no" aria-label="'+t('第 '+(i+1)+' 行备货批次号','Row '+(i+1)+' preparation lot number')+
    '" aria-describedby="preparation-row-error-'+i+'" maxlength="48" placeholder="'+(co?'RMM-CO-2611-001':'RMM-CU-2611-01')+'" value="'+esc(r.batch_no)+'"></td>'+
    '<td><select name="sales_plan_id" data-field="sales_plan_id" aria-label="'+t('第 '+(i+1)+' 行销售计划','Row '+(i+1)+' sales plan')+'"></select></td>'+
    '<td><input name="customer" readonly aria-label="'+t('客户','Customer')+'" value="'+esc(salesOptions.get(r.sales_plan_id)?.customer_name||'')+'"></td>'+
    '<td><input name="shipment_month" type="month" data-field="shipment_month" aria-label="'+t('第 '+(i+1)+' 行发运月份','Row '+(i+1)+' shipment month')+
    '" value="'+esc(r.shipment_month)+'"></td><td id="preparation-row-error-'+i+'" data-batch-validation></td>'+
    '<td><button type="button" data-remove-batch-row class="button secondary compact" aria-label="'+t('移除第 '+(i+1)+' 行','Remove row '+(i+1))+'"'+
    (data.length===1?' disabled':'')+'>'+t('移除','Remove')+'</button></td></tr>').join('');
   [...tbody.rows].forEach((tr,i)=>{
    renderOptions(tr.querySelector('select'),data[i]);
    [...tr.cells].forEach((cell,j)=>{cell.dataset.label=heads[j];});
   });
   $('preparation-batch-add').disabled=data.length>=100;
   schedule();
  }
  function feedback(results){
   let ready=0;
   [...tbody.rows].forEach((tr,i)=>{
    const result=results[i],target=tr.querySelector('[data-batch-validation]');
    target.textContent=result?.message||t('待校验','Awaiting validation');
    target.classList.toggle('error',!!result?.invalid);
    for(const input of tr.querySelectorAll('[data-field]')){
     if(result?.field===input.name)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
    }
    if(result?.ready)ready++;
   });
   summary.textContent=t(data.length+' 行 · '+ready+' 行可保存',data.length+' rows · '+ready+' ready');
  }
  function localResults(){
   const counts=new Map();
   for(const r of data){const key=r.batch_no.trim().toUpperCase();if(key)counts.set(key,(counts.get(key)||0)+1);}
   return data.map(r=>{
    const lot=r.batch_no.trim().toUpperCase();
    if(!lot)return {message:t('填写批次号','Enter a lot number'),field:'batch_no',invalid:true};
    if(counts.get(lot)>1)return {message:t('录入表内重复','Duplicate in the entry table'),field:'batch_no',invalid:true};
    if(!r.sales_plan_id)return {message:t('选择销售计划','Choose a sales plan'),field:'sales_plan_id',invalid:true};
    if(!r.shipment_month)return {message:t('选择发运月份','Choose a shipment month'),field:'shipment_month',invalid:true};
    return null;
   });
  }
  async function validate(){
   const sequence=++validationSequence,results=localResults(),check=[];
   feedback(results);
   for(const [index,row] of data.entries())if(!results[index])check.push({index,row:{...row}});
   if(!check.length)return results;
   const answer=await API.request(api+'/batch/preview',{method:'POST',body:{items:check.map(x=>x.row)}});
   if(!form.isConnected||sequence!==validationSequence)return null;
   answer.items.forEach(x=>{
    const error=x.error,field=error&&(/批次|重复/.test(error)?'batch_no':/销售计划|客户/.test(error)?'sales_plan_id':null);
    results[check[x.index].index]=error?{message:translate(error),invalid:true,field}:{message:t('可保存','Ready'),ready:true};
   });
   feedback(results);return results;
  }
  function schedule(){
   ++validationSequence;
   clearTimeout(timer);
   feedback(localResults());
   timer=setTimeout(()=>{if(form.isConnected&&form.getAttribute('aria-busy')!=='true')validate().catch(error=>{if(form.isConnected)alert.textContent=translate(error.message);});},300);
  }
  async function loadSales(){
   const n=++saleSequence,search=$('preparation-batch-sales-search').value.trim();
   try{
    const result=await API.request(base+'?'+new URLSearchParams({status:'OPEN',search}));
    if(!form.isConnected||n!==saleSequence)return;
    shown=result.items.map(p=>p.id);
    for(const p of result.items)salesOptions.set(p.id,p);
    [...tbody.rows].forEach((tr,i)=>renderOptions(tr.querySelector('select'),data[i]));
   }catch(e){if(form.isConnected&&n===saleSequence)alert.textContent=translate(e.message);}
  }
  async function loadOccupied(page=1){
   const n=++lookupSequence,q=new URLSearchParams({search:lookup.elements.search.value.trim(),page:String(page)});
   lookupResults.setAttribute('aria-busy','true');
   try{
    const result=await API.request(api+'/occupied?'+q);
    if(!lookup.isConnected||n!==lookupSequence)return;
    const source={PLAN:t('备货计划','Preparation Plan'),WORK:t('备货作业','Preparation Work'),HISTORICAL_WORK:t('历史备货作业','Historical Work')};
    const rows=result.items.map(r=>'<tr><td>'+esc(r.batch_no)+'</td><td>'+esc(r.customer_name||'—')+'</td><td>'+esc(r.shipment_month||'—')+
     '</td><td>'+esc(r.source==='PLAN'?state(r.state):co?(window.CobaltUI?.states?.[r.state]?CobaltUI.status(r.state):CobaltWorkUI.status(r.state)):I18n.translate(Flow.names[r.state]||r.state,true))+
     '</td><td>'+source[r.source]+'</td></tr>');
    lookupResults.innerHTML=(rows.length?ExportLicenses.table([['备货批次号','Preparation Lot Number'],['客户','Customer'],['发运月份','Shipment Month'],['状态','Status'],['来源','Source']],rows,'preparation-occupied-table',true):
     '<p class="wms-feedback" role="status">'+t('没有符合条件的批次','No matching lots')+'</p>')+
     '<div class="business-toolbar">'+(page>1?'<button type="button" class="button secondary" data-occupied-page="'+(page-1)+'">'+t('上一页','Previous')+'</button>':'')+
     (result.has_next?'<button type="button" class="button secondary" data-occupied-page="'+(page+1)+'">'+t('下一页','Next')+'</button>':'')+'</div>';
   }catch(e){if(lookup.isConnected&&n===lookupSequence)lookupResults.textContent=translate(e.message);}
   finally{if(lookup.isConnected&&n===lookupSequence)lookupResults.removeAttribute('aria-busy');}
  }
  tbody.oninput=e=>{
   const field=e.target.dataset.field,idx=Number(e.target.closest('tr').dataset.preparationRow);
   if(!field)return;
   const r=data[idx];r[field]=e.target.value;
   if(field==='sales_plan_id'){
    const p=salesOptions.get(r.sales_plan_id);r.shipment_month=p?.shipment_month||'';
    const tr=tbody.rows[idx];tr.querySelector('[name=customer]').value=p?.customer_name||'';
    tr.querySelector('[name=shipment_month]').value=r.shipment_month;
   }
   alert.textContent='';ProductContext.dirty=true;schedule();
  };
  tbody.onclick=e=>{
   if(!e.target.matches('[data-remove-batch-row]')||data.length<2)return;
   const idx=Number(e.target.closest('tr').dataset.preparationRow);
   data.splice(idx,1);ProductContext.dirty=true;render();
   tbody.rows[Math.min(idx,data.length-1)].querySelector('[name=batch_no]').focus();
  };
  $('preparation-batch-add').onclick=()=>{
   data.push(newRow('',data[0]));ProductContext.dirty=true;render();tbody.lastElementChild.querySelector('[name=batch_no]').focus();
  };
  function closePaste(){pastePanel.hidden=true;pasteButton.setAttribute('aria-expanded','false');paste.value='';pasteButton.focus();}
  pasteButton.onclick=()=>{if(!pastePanel.hidden)return closePaste();pastePanel.hidden=false;pasteButton.setAttribute('aria-expanded','true');paste.focus();};
  $('preparation-paste-cancel').onclick=closePaste;
  $('preparation-paste-insert').onclick=()=>{
   const lots=paste.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
   if(!lots.length||lots.some(x=>x.length>48)||lots.length+data.filter(r=>r.batch_no.trim()).length>100){
    alert.textContent=t('每行输入一个批次号，最多 48 字符，每批最多 100 行。','Enter one lot per line, up to 48 characters and 100 rows per batch.');return;
   }
   const defaults=data[0],blank=data.filter(r=>!r.batch_no.trim());
   for(const lot of lots){const row=blank.shift();if(row)row.batch_no=lot;else data.push(newRow(lot,defaults));}
   alert.textContent='';ProductContext.dirty=true;closePaste();render();
  };
  let searchTimer;
  $('preparation-batch-sales-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(form.isConnected)loadSales();},250);};
  lookup.onsubmit=e=>{e.preventDefault();loadOccupied();};
  $('preparation-occupied-reset').onclick=()=>{lookup.reset();loadOccupied();};
  lookupResults.onclick=e=>{if(e.target.dataset.occupiedPage)loadOccupied(Number(e.target.dataset.occupiedPage));};
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   const submit=e.submitter?.hasAttribute('data-submit-for-review')||false;
   clearTimeout(timer);
   const rows=await validate();
   if(!rows)return;
   const bad=rows.findIndex(r=>r.invalid);
   if(bad>=0){const r=rows[bad];tbody.rows[bad].querySelector('[name="'+(r.field||'batch_no')+'"]').focus();
    throw Error(t('请修正标记的行后再办理。','Correct the marked rows to continue.'));}
   if(submit&&!await OperationConfirm.ask({title:t('提交整批备货计划审核？','Submit this batch of preparation plans for review?'),
    rows:[[t('计划数量','Plans'),data.length]]}))return;
   try{
    const saved=await API.request(api+'/batch',{method:'POST',body:{items:data.map(r=>({...r})),submit}});
    this.recent={product:ProductContext.code,ids:saved.items.map(r=>r.id)};
    ProductContext.dirty=false;
    await Router.go(this.route+'?state='+(submit?'PENDING':'DRAFT'));
    notify(submit?t('已提交 '+saved.items.length+' 张备货计划','Submitted '+saved.items.length+' plans'):
     t('已保存 '+saved.items.length+' 条备货草稿','Saved '+saved.items.length+' preparation drafts'));
   }catch(error){if(error.statusCode===409)await validate();throw error;}
  });
  ProductContext.dirty=false;
  render();await Promise.all([loadSales(),loadOccupied()]);
 },
 fields(p,includeBatch=true){
  const t=this.t,rows=[['销售计划','Sales Plan',p.sales_plan_no],['发运月','Shipment Month',p.shipment_month],['客户','Customer',p.customer_name]];
  if(p.reversal_batch_no)rows.push(['原备货批次','Original Preparation Batch',p.reversal_batch_no]);
  if(includeBatch)rows.unshift(['备货批次号','Preparation Lot Number',p.batch_no]);
  return UI46Pages.factList(rows.map(([z,e,value])=>[t(z,e),esc(value||'—')]));
 },
 async list(){
  const t=this.t,q=new URLSearchParams(location.search),d=await API.request(this.api()+'?'+q);
  const status=['DRAFT','PENDING','APPROVED','REJECTED','CANCELLED'].map(s=>'<option value="'+s+'" '+(s===q.get('state')?'selected':'')+'>'+this.state(s)+'</option>').join('');
  const headings=[['备货批次号','Preparation Lot Number'],['销售计划','Sales Plan'],['发运月','Shipment Month'],['客户','Customer'],['审批状态','Review Status'],['计划状态','Plan Status']];
  const operations=[['submit','submit',t('一键提交审核','Submit Selected')],['approve','review',t('一键审批','Approve Selected')]];
  const available=operations.filter(([,action])=>d.items.some(p=>p.actions[action]));
  if(available.length)headings.unshift(['选择','Select']);
  const selection=p=>available.length?'<td>'+(p.actions.submit||p.actions.review?'<input type="checkbox" data-preparation-select value="'+esc(p.id)+'" aria-label="'+esc(t('选择 ','Select ')+p.batch_no)+'">':'')+'</td>':'';
  const recent=this.recent?.product===ProductContext.code?this.recent.ids:[],rows=d.items.map(p=>'<tr'+(recent.includes(p.id)?' class="wms-batch-created"':'')+'>'+selection(p)+'<td><a href="'+this.route+'/'+p.id+'">'+esc(p.batch_no)+'</a></td><td>'+esc(p.sales_plan_no)+'</td><td>'+esc(p.shipment_month)+'</td><td>'+esc(p.customer_name)+'</td><td>'+UI.status(p.state,'approval',this.state(p.state))+'</td><td>'+this.planStatus(p)+'</td></tr>');
  Router.page(t('备货计划','Preparation Plans'),'<section class="wms-page" data-page-composed data-no-i18n>'+
   '<div class="business-toolbar">'+(d.can_create?'<button type="button" id="preparation-plan-create" class="button primary">'+t('新建备货计划','New Preparation Plan')+'</button>':'')+
   available.map(([operation,,label])=>'<button type="button" class="button secondary" data-preparation-operation="'+operation+'" disabled>'+label+'</button>').join('')+
   this.backLink()+'</div>'+
   '<form id="preparation-plan-filter" class="filters wms-filter-row"><label>'+t('批次号','Lot Number')+
   '<input name="batch_no" type="search" maxlength="160" value="'+esc(q.get('batch_no')||q.get('search')||'')+'"></label><label>'+t('销售计划号','Sales Plan No.')+
   '<input name="sales_plan_no" type="search" maxlength="160" value="'+esc(q.get('sales_plan_no')||'')+'"></label><label>'+t('发运月','Shipment Month')+
   '<input name="shipment_month" type="month" value="'+esc(q.get('shipment_month')||'')+'"></label><label>'+t('客户','Customer')+
   '<select name="customer_id"><option value="">'+t('全部客户','All Customers')+'</option>'+(d.customer_options||[]).map(c=>'<option value="'+esc(c.id)+'" '+(c.id===q.get('customer_id')?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label><label>'+t('审批状态','Review Status')+
   '<select name="state"><option value="">'+t('全部','All')+'</option>'+status+'</select></label><div class="wms-filter-actions">'+
   '<button class="button primary">'+t('查询','Search')+'</button><a class="button secondary" data-wms-reset href="'+this.route+'">'+t('重置','Reset')+'</a></div></form>'+
   '<p id="preparation-bulk-error" class="wms-feedback error" role="alert"></p>'+
   ExportLicenses.table(headings,rows,'preparation-plans-table',true)+CobaltStockUI.pager(d.page,d.total,d.page_size)+'</section>');
  $('preparation-plan-filter').onsubmit=e=>{e.preventDefault();Router.go(this.route+'?'+new URLSearchParams(new FormData(e.target)));};
  if($('preparation-plan-create'))$('preparation-plan-create').onclick=()=>Router.go(this.route+'/new');
  const checks=[...document.querySelectorAll('[data-preparation-select]')],buttons=[...document.querySelectorAll('[data-preparation-operation]')];
  const plans=new Map(d.items.map(p=>[p.id,p]));
  const selected=()=>checks.filter(input=>input.checked).map(input=>plans.get(input.value));
  let working=false;
  const sync=()=>{
   const items=selected();
   for(const b of buttons)b.disabled=working||!items.length||items.some(p=>!p.actions[b.dataset.preparationOperation==='submit'?'submit':'review']);
   for(const input of checks)input.disabled=working;
  };
  for(const input of checks)input.onchange=sync;
  for(const button of buttons)button.onclick=async()=>{
   if(working)return;
   const items=selected(),operation=button.dataset.preparationOperation;
   working=true;sync();$('preparation-bulk-error').textContent='';
   try{
    if(!await OperationConfirm.ask({title:button.textContent,rows:[[t('计划数量','Plans'),items.length]]}))return;
    await API.request(this.api()+'/batch/'+operation,{method:'POST',body:{items:items.map(({id,version})=>({id,version}))}});
    await this.list();window.dispatchEvent(new Event('inventory-changed'));
   }catch(error){if($('preparation-bulk-error'))$('preparation-bulk-error').textContent=error.message;}
   finally{working=false;sync();}
  };
  CobaltStockUI.bindPager(d);ProductContext.dirty=false;
 },
 async detail(id){
  const t=this.t,p=await API.request(this.api()+'/'+id);
  const button=(id,z,e,style='secondary')=>'<button type="button" class="button '+style+'" data-plan-action="'+id+'">'+t(z,e)+'</button>';
  const work=p.allocation_id||p.co_preparation_id?'<a class="button secondary" href="'+this.orderRoute(p)+'">'+t('查看备货单','View Preparation Order')+'</a>':
   p.actions.start?'<a class="button primary" href="'+this.startRoute(p)+'">'+t('创建备货单','Create Preparation Order')+'</a>':'';
  const previous=p.events.filter(e=>['WORK_CANCEL','REUSE','FINAL_REVERSE'].includes(e.action)&&(e.allocation_id||e.co_preparation_id));
  const workHistory=previous.length?'<section class="wms-section"><h2>'+t('历史备货作业','Previous Preparation Work')+'</h2><ul>'+previous.map(e=>
   '<li><a href="'+this.orderRoute(e)+(e.reversal_id?'?reversal='+e.reversal_id+'#preparation-reversal':'')+'">'+
   (e.action==='FINAL_REVERSE'?t('查看整批撤销记录','View Whole-Batch Reversal'):t('查看已取消的备货单','View Cancelled Preparation Order'))+
   '</a> · '+esc(BusinessTime.display(e.occurred_at))+'</li>').join('')+'</ul></section>':'';
  const actions=work+(p.actions.edit?button('edit','修改','Edit')+button('submit','提交审批','Submit for Approval','primary'):'')+
   (p.actions.review?button('approve','审批通过','Approve','primary')+button('reject','退回','Return','danger-outline'):'');
  const back='<a class="button secondary" data-wms-back href="'+this.route+'">'+t('返回备货计划','Back to Plans')+'</a>';
  Router.page(t('备货计划详情','Preparation Plan Details'),'<div class="wms-page" data-page-composed data-no-i18n>'+
   UI46Pages.identity(p.batch_no,UI.status(p.state,'approval',this.state(p.state)),back+actions,this.fields(p,false))+
   workHistory+'<div class="preparation-plan-approval-slot"></div><p id="preparation-plan-error" class="error" role="alert"></p></div>');
  for(const button of document.querySelectorAll('[data-plan-action]'))button.onclick=async()=>{
   const action=button.dataset.planAction;
   if(action==='edit')return this.form(p);
   let reason='';
   if(!await OperationConfirm.ask({title:button.textContent,rows:[[t('备货批次','Preparation Batch'),p.batch_no]],comment:action==='reject',commentRequired:action==='reject',commentLabel:t('退回意见','Return Note'),onComment:value=>{reason=value||'';}}))return;
   button.disabled=true;
   try{await API.request(this.api()+'/'+id+'/'+action,{method:'POST',body:{version:p.version,reason}});await this.detail(id);window.dispatchEvent(new Event('inventory-changed'));}
   catch(err){$('preparation-plan-error').textContent=err.message;button.disabled=false;}
  };
  ProductContext.dirty=false;
 },
 form(prior,source=null){
  const t=this.t,base=(ProductContext.isCopper()?'':'/cobalt')+'/sales-workflow/plans';
  dialog(prior?t('修改备货计划','Edit Preparation Plan'):t('新建备货计划','New Preparation Plan'),
   '<form id="preparation-plan-form" class="user-form" data-no-i18n data-wms-validation>'+
   (source?'<p>'+t('关联已撤销批次','Related Reversed Batch')+' · '+esc(source.batch_no)+'</p>':'')+'<div class="form-grid wms-field-grid">'+
   '<label class="wms-field">'+t('搜索销售计划','Search Sales Plans')+'<input id="preparation-sales-search" type="search" maxlength="160"></label>'+
   '<label class="wms-field">'+t('销售计划','Sales Plan')+'<select name="sales_plan_id" required></select></label>'+
   '<label class="wms-field">'+t('客户','Customer')+'<input name="customer" readonly></label>'+
   '<label class="wms-field">'+t('发运月','Shipment Month')+'<input name="shipment_month" type="month" required value="'+esc(prior?.shipment_month||'')+'"></label>'+
   '<label class="wms-field">'+t('备货批次号','Preparation Lot Number')+'<input name="batch_no" maxlength="48" required placeholder="'+(ProductContext.isCopper()?'RMM-CU-YYYY-01':'RMM-CO-YYYY-001')+'" value="'+esc(prior?.batch_no||'')+'"></label>'+
   '</div><p class="error wms-feedback" role="alert"></p><div class="business-toolbar wms-form-actions"><button class="button primary">'+t('保存计划','Save Plan')+'</button></div></form>');
  const form=$('preparation-plan-form'),select=form.elements.sales_plan_id,search=$('preparation-sales-search'),message=form.querySelector('[role=alert]');
  let plans=[],sequence=0;
  const apply=()=>{
   const p=plans.find(row=>row.id===select.value);
   form.elements.customer.value=p?.customer_name||'';
   if(p&&!form.elements.shipment_month.value)form.elements.shipment_month.value=p.shipment_month||'';
  };
  const load=async()=>{
   const n=++sequence,selected=select.value||prior?.sales_plan_id;
   try{
    const d=await API.request(base+'?'+new URLSearchParams({status:'OPEN',search:search.value.trim()}));
    if(!form.isConnected||n!==sequence)return;
    plans=source?d.items.filter(p=>p.project_id===source.project_id&&(!source.customer_id||p.customer_id===source.customer_id)&&
     (ProductContext.isCopper()||p.warehouse_id===source.warehouse_id)):d.items;
    if(prior&&!plans.some(row=>row.id===prior.sales_plan_id))plans=[{id:prior.sales_plan_id,code:prior.sales_plan_no,customer_name:prior.customer_name,shipment_month:prior.sales_shipment_month},...plans];
    select.replaceChildren(new Option(t('请选择','Select'),''));
    for(const p of plans)select.add(new Option(this.salesPlanLabel(p),p.id));
    select.value=plans.some(p=>p.id===selected)?selected:'';
    apply();
   }catch(err){if(form.isConnected&&n===sequence)message.textContent=err.message;}
  };
  let timer;
  search.oninput=()=>{clearTimeout(timer);timer=setTimeout(load,250);};
  select.onchange=()=>{form.elements.shipment_month.value='';apply();};
  form.onsubmit=e=>UI46Pages.submit(e,async()=>{
   const {sales_plan_id,shipment_month,batch_no}=Object.fromEntries(new FormData(form));
   let r;
   try{r=await API.request(this.api()+(prior?'/'+prior.id:''),{method:prior?'PATCH':'POST',
    body:{sales_plan_id,shipment_month,batch_no,...(prior?{version:prior.version}:source?{reversal_id:source.id}:{})}});}
   catch(err){throw Error(PreparationReversal.message(err.message));}
   $('dialog').close();ProductContext.dirty=false;
   if(prior)await this.detail(r.id);else await Router.go(this.route+'/'+r.id);
  });
  load();
 }
};
RoutePermissions.register('preparation-plans',path=>/^\/preparation\/work-plans(?:\/(?:new|[0-9a-f-]{36}))?$/.test(path),()=>PreparationPlans.readPermission()||'plan:read');
Router.add(/^\/preparation\/work-plans$/,()=>PreparationPlans.list());
Router.add(/^\/preparation\/work-plans\/new$/,()=>PreparationPlans.batch());
Router.add(/^\/preparation\/work-plans\/([0-9a-f-]{36})$/,id=>PreparationPlans.detail(id));
Object.assign(ManagementLabels.names,{PREPARATION_PLAN_REVIEW:'备货计划审批'});
Object.assign(ManagementLabels.en,{'备货计划审批':'Preparation Plan Review'});
