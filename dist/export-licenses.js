'use strict';

window.ExportLicenses={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 route:'/export-licenses',
 api(){return (ProductContext.isCopper()?'':'/cobalt')+'/export-permits';},
 can:key=>CurrentUser.permissions.includes('export-license:'+key),
 labels:{
  contract_id:['买家 / 合同','Buyer / Contract'],applied_on:['申请日期','Application Date'],proforma_no:['形式发票号','Proforma Invoice No.'],license_no:['许可证号','License No.'],buyer:['买家','Buyer'],contract_no:['合同号','Contract No.'],
  quantity:['批准数量','Approved Quantity'],unit_basis:['计量口径','Quantity Basis'],unit:['计量单位','Unit'],clearing_agent:['开证清关公司','Clearance Agent'],issuing_bank:['开证银行','Issuing Bank'],unit_price:['单价','Unit Price'],price_unit:['计价单位','Price Unit'],amount:['正式登记金额','Registered Amount'],currency:['币种','Currency'],reference_amount:['计算参考金额','Calculated Reference Amount'],destination:['目的地','Destination'],
  valid_from:['生效日期','Valid From'],valid_until:['原失效日期','Original Expiry'],extension_on:['最近批准延期日期','Latest Extension Date'],extended_until:['延期后失效日期','Extended Expiry'],effective_until:['当前有效截止','Current Expiry'],closed_on:['关证日期','Closure Date'],status:['许可证状态','License Status'],note:['备注','Remarks'],
  used:['已使用','Used'],reserved:['有效预占','Reserved'],pending:['待核销（含于预占）','Pending Reconciliation (Reserved)'],remaining:['剩余额度','Remaining'],available:['可分配额度','Allocatable'],utilization:['使用率','Usage Rate'],
  reference:['业务依据 / 凭证号','Evidence / Reference'],allocation_id:['装车计划 / 发票号','Loading Plan / Invoice']
 },
 statuses:{APPLYING:['申请中','Applying'],ACTIVE:['有效','Active'],SCHEDULED:['未到生效日','Scheduled'],EXPIRED:['已失效','Expired'],CLOSED:['已关证','Closed'],CANCELLED:['已撤销','Cancelled'],EXPIRING:['即将到期','Expiring'],PENDING:['待审核','Pending'],APPROVED:['已通过','Approved'],REJECTED:['已驳回','Rejected'],RESERVED:['已预占','Reserved'],SETTLED:['已核销','Reconciled'],RELEASED:['已释放','Released'],VOID:['编号作废','Number Voided']},
 actions:{ISSUE:['签发','Issue'],AMEND:['正式资料修改','Amend'],EXTEND:['延期','Extend'],CANCEL:['撤销','Revoke'],CLOSE:['正常关证','Close'],CLOSE_EXCEPTION:['异常关证','Exceptional Closure'],SETTLE:['核销','Reconcile'],CORRECT:['核销更正','Correct Reconciliation']},
 types:{LICENSE:['许可证','License'],PROFORMA:['形式发票','Proforma Invoice'],EXTENSION:['延期文件','Extension File'],CLOSURE:['关证文件','Closure File'],USAGE:['核销凭证','Reconciliation Evidence'],OTHER:['其他附件','Other']},
 bases:{PHYSICAL_MT:['实物净重吨','Physical Net MT'],COBALT_MT:['钴金属吨','Cobalt Metal MT'],CUSTOM:['许可证指定单位','License-specific Unit']},
 title(){return this.t('出口许可证管理','Export License Management');},
 label(key){return this.t(...(this.labels[key]||[key,key]));},
 state(key){return this.t(...(this.statuses[key]||[key,key]));},
 options(choices,value){return Object.entries(choices).map(([k,v])=>'<option value="'+esc(k)+'" '+(value===k?'selected':'')+'>'+esc(this.t(...v))+'</option>').join('');},
 value(value){return value==null||value===''?'—':esc(String(value).replace(/T00:00:00\.000Z$/,''));},
 table(headers,rows,id){return CobaltSalesUI.table(headers,rows,id).replace('<table id=','<table data-v34-enhanced="true" id=');},
 section(title,body){return '<section class="panel export-license-section"><h2>'+title+'</h2>'+body+'</section>';},
 page(title,html){Router.page(title,'<div class="export-license-page" data-no-i18n>'+html+'</div>');},
 facts(keys,data){return '<dl class="export-license-facts">'+keys.map(k=>'<div><dt>'+this.label(k)+'</dt><dd>'+this.value(k==='status'?this.state(data[k]):k==='utilization'?data[k]+'%':data[k])+'</dd></div>').join('')+'</dl>';},
 input(key,data={},type='text',required=false){return '<label>'+this.label(key)+'<input name="'+key+'" type="'+type+'" '+(required?'required ':'')+'maxlength="'+(key==='note'?1000:320)+'" value="'+esc(data[key]??'')+'"></label>';},
 async routePage(path){
  if(path===this.route){
   if(new URLSearchParams(location.search).get('view')==='legacy')return SalesReviewUI.licenses();
   return this.list();
  }
  if(path.endsWith('/new'))return this.form();
  const id=path.split('/')[2];
  return path.endsWith('/edit')?this.form(id):this.detail(id);
 },
 async list(){
  const t=this.t,q=new URLSearchParams(location.search),d=await API.request(this.api()+'?'+q),base=this.route;
  const indicators=[['ACTIVE','有效许可证','Active Licenses',d.indicators.active],['EXPIRING','即将到期','Expiring Soon',d.indicators.expiring],['EXPIRED','待关证','Awaiting Closure',d.indicators.pending_close]];
  const cards='<div class="v34-kpi-grid">'+indicators.map(([k,zh,en,n])=>'<a class="v34-kpi" href="'+base+'?status='+k+'"><span>'+t(zh,en)+'</span><strong>'+n+'</strong></a>').join('')+'</div>';
  const units=d.units.length?this.table([['计量口径 / 单位','Basis / Unit'],['批准总量','Approved'],['已使用','Used'],['剩余','Remaining'],['可分配','Allocatable']],d.units.map(row=>'<tr><th scope="row">'+esc(this.t(...this.bases[row.unit_basis]))+' / '+esc(row.unit)+'</th>'+['quantity','used','remaining','available'].map(k=>'<td>'+this.value(row[k])+'</td>').join('')+'</tr>'),'export-license-units'):'';
  const buttons='<div class="business-toolbar">'+(this.can('write')?'<a class="button primary" href="'+base+'/new">'+t('登记许可证申请','Register Application')+'</a>':'')+(CurrentUser.permissions.includes('loading-plan:read')?'<a class="button secondary" href="'+base+'?view=legacy">'+t('历史装车许可证号','Legacy Loading License Numbers')+'</a>':'')+'</div>';
  const filter='<form id="export-license-filter" class="filters"><label>'+t('形式发票、许可证、买家或合同','Proforma, License, Buyer or Contract')+'<input name="search" type="search" maxlength="160" value="'+esc(q.get('search')||'')+'"></label><label>'+t('许可证状态','License Status')+'<select name="status"><option value="">'+t('全部','All')+'</option>'+this.options(Object.fromEntries(['APPLYING','ACTIVE','SCHEDULED','EXPIRING','EXPIRED','CLOSED','CANCELLED'].map(k=>[k,this.statuses[k]])),q.get('status'))+'</select></label><button class="button secondary">'+t('查询','Search')+'</button><a class="button secondary" href="'+base+'">'+t('重置','Reset')+'</a></form>';
  const rows=d.items.map(r=>'<tr><td><a href="'+base+'/'+r.id+'">'+esc(r.proforma_no)+'</a><small>'+this.value(r.license_no)+'</small></td><td>'+esc(r.buyer)+'<small>'+esc(r.contract_no)+'</small></td><td>'+this.value(r.quantity)+' '+esc(r.unit)+'</td><td>'+this.value(r.used)+' / '+this.value(r.utilization)+'%</td><td>'+this.value(r.remaining)+' / '+this.value(r.available)+'</td><td>'+this.value(r.effective_until)+'</td><td>'+esc(this.state(r.status))+'</td></tr>');
  const settings=CurrentUser.permissions.includes('system:manage')?'<details><summary>'+t('到期提醒设置','Expiry Reminder Settings')+'</summary><form id="export-license-settings" class="filters"><label>'+t('提前提醒天数','Reminder Days')+'<input type="number" name="expiry_days" min="1" max="365" required value="'+d.expiry_days+'"></label><button class="button secondary">'+t('保存提醒设置','Save Reminder')+'</button></form></details>':'';
  this.page(this.title(),buttons+cards+units+filter+this.table([['形式发票 / 许可证号','Proforma / License'],['买家 / 合同','Buyer / Contract'],['批准数量','Approved'],['已用 / 使用率','Used / Rate'],['剩余 / 可分配','Remaining / Allocatable'],['有效截止','Expiry'],['状态','Status']],rows,'export-license-table')+CobaltStockUI.pager(d.page,d.total,d.page_size)+settings);
  $('export-license-filter').onsubmit=e=>{e.preventDefault();const values=new URLSearchParams([...new FormData(e.target)].filter(([,v])=>v));Router.go(base+(values.size?'?'+values:''));};
  if($('export-license-settings'))$('export-license-settings').onsubmit=e=>this.submit(e,async()=>{await API.request(this.api()+'/preferences',{method:'POST',body:{expiry_days:Number(e.target.elements.expiry_days.value)}});await this.list();});
  CobaltStockUI.bindPager(d);
 },
 async form(id){
  const t=this.t,api=this.api(),[options,d]=await Promise.all([API.request(api+'/contracts'),id?API.request(api+'/'+id):Promise.resolve({currency:'USD',unit:'MT',unit_basis:'PHYSICAL_MT',applied_on:BusinessTime.today()})]);
  const selected='<label>'+this.label('contract_id')+'<select name="contract_id" required '+(id?'disabled':'')+'><option value="">'+t('请选择','Select')+'</option>'+options.items.map(r=>'<option value="'+r.id+'" '+(d.contract_id===r.id?'selected':'')+'>'+esc(r.buyer+' / '+r.contract_no)+'</option>').join('')+'</select></label>';
  const basis=Object.fromEntries(Object.entries(this.bases).filter(([k])=>k!=='COBALT_MT'||!ProductContext.isCopper()));
  const basisField='<label>'+this.label('unit_basis')+'<select name="unit_basis">'+this.options(basis,d.unit_basis)+'</select></label>';
  this.page(id?t('编辑许可证申请','Edit License Application'):t('登记出口许可证申请','Register Export License Application'),
   '<form id="export-license-application" class="user-form"><div class="form-grid">'+selected+this.input('applied_on',d,'date',true)+this.input('proforma_no',d,'text',true)+this.input('quantity',d,'text',true)+basisField+this.input('unit',d,'text',true)+['clearing_agent','issuing_bank','unit_price','price_unit','amount','currency','destination','note'].map(k=>this.input(k,d)).join('')+'</div><p class="error" role="alert"></p><div class="business-toolbar"><button class="button primary">'+t('保存申请','Save Application')+'</button><a class="button secondary" href="'+this.route+(id?'/'+id:'')+'">'+t('返回','Back')+'</a></div></form>');
  const f=$('export-license-application');f.elements.unit_basis.onchange=()=>{if(f.elements.unit_basis.value!=='CUSTOM')f.elements.unit.value=f.elements.unit_basis.value==='COBALT_MT'?'Co MT':'MT';};
  f.onsubmit=e=>this.submit(e,async()=>{
   const body=Object.fromEntries(new FormData(f));if(id){body.contract_id=d.contract_id;body.version=d.version;}
   const saved=await API.request(api+(id?'/'+id:''),{method:id?'PATCH':'POST',body});
   await Router.go(this.route+'/'+saved.id);
  });
 },
 async detail(id){
  const t=this.t,api=this.api()+'/'+id,d=await API.request(api),write=this.can('write'),pending=d.history.some(a=>a.decision==='PENDING');
  const attached=this.table([['类别','Category'],['文件','File'],['上传人','Uploader'],['时间','Time']],d.attachments.map(f=>'<tr><td>'+esc(t(...this.types[f.category]))+'</td><td><button type="button" class="button secondary compact" data-permit-download="'+f.id+'">'+esc(f.filename)+'</button></td><td>'+esc(f.uploader)+'</td><td>'+esc(BusinessTime.display(f.created_at))+'</td></tr>'),'permit-attachments');
  const upload=write?'<form id="permit-upload" class="filters"><label>'+t('附件类别','Attachment Category')+'<select name="category">'+this.options(this.types)+'</select></label><label>'+t('附件（PDF、PNG、JPEG，最多256 KiB）','Attachment (PDF, PNG, JPEG, 256 KiB max)')+'<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required></label><button class="button secondary">'+t('上传','Upload')+'</button><p class="error" role="alert"></p></form>':'';
  const bindings=this.table([['装车计划','Loading Plan'],['发票号','Invoice'],['预占数量','Reserved'],['正式核销量','Reconciled'],['状态','Status'],['正式出库','Formal Outbound']],d.allocations.map(a=>'<tr><td><a href="/loading-plans/orders/'+a.plan_id+'">'+esc(a.plan_no)+'</a></td><td>'+esc(a.invoice_no)+'</td><td>'+this.value(a.reserved_quantity)+'</td><td>'+this.value(a.used_quantity)+'</td><td>'+esc(a.state==='RESERVED'&&a.posted_at?t('待核销','Pending Reconciliation'):this.state(a.state))+'</td><td>'+esc(a.posted_at?BusinessTime.display(a.posted_at):'—')+'</td></tr>'),'permit-allocations');
  const history=d.history.map(a=>{
   const can=this.can('approve')&&a.decision==='PENDING'&&a.requested_by!==CurrentUser.id;
   const evidence=Object.entries(a.payload).filter(([k])=>k!=='allocation_id').map(([k,v])=>this.label(k)+' '+String(v)).join(' · ');
   const review=can?'<form data-permit-review="'+a.id+'"><label>'+t('审核意见','Review Note')+'<input name="note" required maxlength="1000"></label><button class="button primary" name="decision" value="APPROVED">'+t('通过','Approve')+'</button> <button class="button secondary" name="decision" value="REJECTED">'+t('驳回','Reject')+'</button><p class="error" role="alert"></p></form>':'';
   return '<article><strong>'+t(...this.actions[a.action])+' · '+this.state(a.decision)+'</strong><p>'+esc(a.requester+' · '+BusinessTime.display(a.requested_at)+' · '+a.reason)+'</p><p>'+esc(evidence)+'</p>'+(a.reviewer?'<p>'+esc(a.reviewer+' · '+BusinessTime.display(a.reviewed_at)+' · '+a.review_note)+'</p>':'')+review+'</article>';
  }).join('');
  const request=write&&!pending?this.actionForm(d):'';
  const product=ProductContext.isCopper()?t('阴极铜','Copper Cathodes'):t('氢氧化钴','Cobalt Hydroxide');
  this.page(this.title(),'<div class="business-toolbar"><a class="button secondary" href="'+this.route+'">'+t('返回许可证列表','Back to Licenses')+'</a>'+(write&&!pending&&d.state==='APPLYING'?'<a class="button secondary" href="'+this.route+'/'+id+'/edit">'+t('编辑申请','Edit Application')+'</a>':'')+'</div>'+
   this.section(t('基础与开证资料','License Information'),'<p>'+product+'</p>'+this.facts(['status','proforma_no','license_no','buyer','contract_no','applied_on','clearing_agent','issuing_bank','destination','note'],d))+
   this.section(t('数量与金额','Quantity and Amount'),this.facts(['quantity','unit','used','reserved','pending','remaining','available','utilization','unit_price','price_unit','amount','reference_amount','currency'],d))+
   this.section(t('有效期与关证','Validity and Closure'),this.facts(['valid_from','valid_until','extension_on','extended_until','effective_until','closed_on'],d))+
   this.section(t('装车计划与核销','Loading Plans and Reconciliation'),bindings)+
   this.section(t('审核与历史','Review and History'),request+'<div class="export-license-history">'+(history||'<p>'+t('暂无审核记录','No review records')+'</p>')+'</div>')+
   this.section(t('许可证附件','License Attachments'),attached+upload));
  if($('permit-action'))this.bindAction(d);
  for(const f of document.querySelectorAll('[data-permit-review]'))f.onsubmit=e=>this.submit(e,async()=>{await API.request(api+'/actions/'+f.dataset.permitReview,{method:'POST',body:{decision:e.submitter.value,note:f.elements.note.value}});await this.detail(id);});
  if($('permit-upload'))$('permit-upload').onsubmit=e=>this.submit(e,async()=>{
   const f=e.target,file=f.elements.file.files[0];
   if(file.size>262144)throw Error(t('附件超过256 KiB','Attachment exceeds 256 KiB'));
   const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});
   await API.request(api+'/attachments',{method:'POST',body:{category:f.elements.category.value,filename:file.name,base64:data}});await this.detail(id);
  });
  for(const b of document.querySelectorAll('[data-permit-download]'))b.onclick=async()=>{try{
   const file=await API.request(api+'/attachments/'+b.dataset.permitDownload,{binary:true}),url=URL.createObjectURL(file.blob),a=document.createElement('a');
   a.href=url;a.download=file.filename||b.textContent;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){notify(e.message);}};
 },
 actionForm(d){
  const t=this.t,options=d.state==='APPLYING'?['ISSUE','CANCEL']:d.state==='ISSUED'?['AMEND','EXTEND','CLOSE','CLOSE_EXCEPTION','CANCEL']:[];
  if(['ISSUED','CLOSED'].includes(d.state)){
   if(d.allocations.some(a=>a.state==='RESERVED'&&a.posted_at))options.push('SETTLE');
   if(d.allocations.some(a=>a.state==='SETTLED'&&a.posted_at))options.push('CORRECT');
  }
  return options.length?'<form id="permit-action" class="user-form"><label>'+t('审核事项','Action for Review')+'<select name="action">'+this.options(Object.fromEntries(options.map(k=>[k,this.actions[k]])))+'</select></label><div id="permit-action-fields" class="form-grid"></div><label>'+t('申请原因','Reason')+'<input name="reason" required maxlength="1000"></label><button class="button secondary">'+t('提交审核','Submit for Review')+'</button><p class="error" role="alert"></p></form>':'';
 },
 bindAction(d){
  const f=$('permit-action'),t=this.t,draw=()=>{
   const action=f.elements.action.value;
   let inputs;
   if(action==='ISSUE')inputs=this.input('license_no',{},'text',true)+this.input('valid_from',{},'date',true)+this.input('valid_until',{},'date',true);
   else if(action==='EXTEND')inputs=this.input('extension_on',{},'date',true)+this.input('extended_until',{},'date',true)+this.input('reference',{},'text',true);
   else if(action==='AMEND')inputs=['quantity','clearing_agent','issuing_bank','unit_price','price_unit','amount','currency','destination','note'].map(k=>this.input(k,d)).join('');
   else if(['SETTLE','CORRECT'].includes(action)){
    const candidates=d.allocations.filter(a=>a.state===(action==='SETTLE'?'RESERVED':'SETTLED')&&a.posted_at);
    inputs='<label>'+this.label('allocation_id')+'<select name="allocation_id" required>'+candidates.map(a=>'<option value="'+a.id+'">'+esc(a.plan_no+' / '+a.invoice_no)+'</option>').join('')+'</select></label>'+this.input('quantity',{},'text',true)+this.input('reference',{},'text',true)+'<p>'+t('核销单位','Reconciliation Unit')+' '+esc(d.unit)+'</p>';
   }else inputs=(action==='CANCEL'?'':this.input('closed_on',{},'date',true))+this.input('reference',{},'text',true);
   $('permit-action-fields').innerHTML=inputs;
  };
  f.elements.action.onchange=draw;draw();
  f.onsubmit=e=>this.submit(e,async()=>{
   const {action,reason,...payload}=Object.fromEntries(new FormData(f));
   await API.request(this.api()+'/'+d.id+'/actions',{method:'POST',body:{action,reason,payload,version:d.version}});
   await this.detail(d.id);
  });
 },
 async submit(e,run){
  e.preventDefault();const b=e.submitter,error=e.target.querySelector('[role=alert]');b.disabled=true;
  if(error)error.textContent='';
  try{await run();}catch(err){if(error)error.textContent=err.message;else notify(err.message);}
  finally{if(b.isConnected)b.disabled=false;}
 },
 async mountOverview(root){
  if(!this.can('read'))return;
  const t=this.t;
  try{
   const {indicators,units}=await API.request(this.api());
   if(!root.isConnected)return;
   const section=document.createElement('section');
   section.className='oa-kpis';
   section.setAttribute('aria-label',this.title());
   const amount=units.map(row=>row.available+' '+row.unit).join(' / ')||'—';
   const cards=[
    ['ACTIVE',t('有效出口许可证','Active Export Licenses'),indicators.active],
    ['ACTIVE',t('许可证可分配额度','Allocatable License Quota'),amount],
    ['EXPIRING',t('即将到期许可证','Expiring Licenses'),indicators.expiring]
   ];
   for(const [state,label,value] of cards){
    const link=document.createElement('a');
    link.className='oa-kpi';
    link.href=this.route+'?status='+state;
    link.innerHTML='<span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>';
    section.append(link);
   }
   root.querySelector('.oa-charts')?.before(section);
  }catch(error){
   if(!root.isConnected)return;
   const warning=document.createElement('p');
   warning.className='oa-warning';
   warning.textContent=t('暂时无法读取出口许可证指标。','Export license indicators are temporarily unavailable.');
   root.querySelector('.oa-charts')?.before(warning);
  }
 },
 mountPicker(form,record={}){
  const t=this.t,id='loading-permit-picker',slot=document.createElement('div'),known=new Map(),old=record.export_license;
  slot.className='export-license-picker';
  slot.innerHTML='<label>'+t('搜索出口许可证','Search Export Licenses')+'<input id="'+id+'-search" type="search" maxlength="160"></label><label>'+t('出口许可证','Export License')+'<select name="license_id"><option value="">'+t('使用原有手工编号流程','Use Existing Manual Numbering')+'</option></select></label><div id="'+id+'-quantity" hidden><label>'+t('预占数量','Reserved Quantity')+'<input name="license_quantity"></label><input type="hidden" name="license_unit"></div><p id="'+id+'-note" role="status"></p>';
  const invoice=form.elements.invoice_no,manual=form.elements.export_license_no,select=slot.querySelector('select'),date=form.elements.planned_load_date,sales=form.elements.sales_plan_id,query=slot.querySelector('input[type=search]'),note=slot.querySelector('p');
  const container=invoice?.closest('label')||manual?.closest('label');
  if(!container||!sales)return;
  container.before(slot);
  if(old)select.options[0].disabled=true;
  let request=0,timer;
  const show=()=>{
   const chosen=known.get(select.value),reserved=!!select.value,isCustom=chosen?.unit_basis==='CUSTOM';
   if(invoice){invoice.required=!reserved&&ProductContext.isCopper();invoice.readOnly=reserved;}
   if(manual)manual.readOnly=reserved;
   slot.querySelector('#'+id+'-quantity').hidden=!isCustom;form.elements.license_unit.value=isCustom?chosen.unit:'';
   if(reserved){
    if(manual)manual.value=chosen?.license_no||old?.license_no||'';
    if(invoice)invoice.value=old?.license_id===select.value?old.invoice_no:'';
   }
   note.textContent=reserved?t('发票号在保存时由所选许可证自动生成。','The license assigns an invoice number on save.')+(chosen?.available!=null?' '+t('可分配 ','Allocatable ')+chosen.available+' '+chosen.unit:''):'';
  };
  const refresh=async()=>{
   const token=++request,previous=select.value||old?.license_id||'';
   known.clear();if(old)known.set(old.license_id,old);
   if(sales.value)try{
    const filters=new URLSearchParams({sales_plan_id:sales.value,search:query.value});
    if(date?.value)filters.set('planned_load_date',date.value);
    const d=await API.request(this.api()+'/options?'+filters);
    if(token!==request||!form.isConnected)return;
    for(const item of d.items)known.set(item.id,item);
   }catch(e){if(token===request&&form.isConnected)note.textContent=e.message;return;}
   select.querySelectorAll('option:not(:first-child)').forEach(o=>o.remove());
   for(const [key,item] of known)select.add(new Option([item.proforma_no,item.license_no,item.buyer,item.contract_no,item.available!=null?t('可分配 ','Allocatable ')+item.available+' '+item.unit:'',item.effective_until].filter(Boolean).join(' / '),key));
   select.value=known.has(previous)?previous:'';
   if(old&&select.value===old.license_id&&old.unit_basis==='CUSTOM')form.elements.license_quantity.value=old.reserved_quantity;
   show();
  };
  select.onchange=show;query.oninput=()=>{clearTimeout(timer);timer=setTimeout(refresh,220);};
  sales.addEventListener('change',refresh);date?.addEventListener('change',refresh);
  refresh();
 },
 planLink(row){return row.export_license&&this.can('read')?'<p><a class="export-license-link" href="'+this.route+'/'+row.export_license.license_id+'">'+esc(this.t('关联出口许可证','Linked Export License')+' · '+row.export_license.license_no)+'</a></p>':'';}
};
