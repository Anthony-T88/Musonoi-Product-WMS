'use strict';

window.ExportLicenses={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 route:'/export-licenses',
 api(){return (ProductContext.isCopper()?'':'/cobalt')+'/export-permits';},
 can:key=>CurrentUser.permissions.includes('export-license:'+key),
 labels:{
  contract_id:['买家 / 合同','Buyer / Contract'],applied_on:['申请日期','Application Date'],proforma_no:['形式发票号','Proforma Invoice No.'],license_no:['许可证号','License No.'],buyer:['买家','Buyer'],contract_no:['合同号','Contract No.'],
  quantity:['批准数量','Approved Quantity'],unit_basis:['计量口径','Quantity Basis'],unit:['计量单位','Unit'],clearing_agent:['开证清关公司','Clearance Agent'],issuing_bank:['开证银行','Issuing Bank'],issuing_bank_account:['开证银行账户号','Issuing Bank Account No.'],issuing_bank_account_name:['开证银行账户名','Issuing Bank Account Name'],offshore_bank:['离岸银行','Offshore Bank'],offshore_bank_account:['离岸银行账户号','Offshore Bank Account No.'],offshore_bank_account_name:['离岸银行账户名','Offshore Bank Account Name'],unit_price:['单价','Unit Price'],price_unit:['计价单位','Price Unit'],amount:['正式登记金额','Registered Amount'],currency:['币种','Currency'],reference_amount:['计算参考金额','Calculated Reference Amount'],destination:['目的地','Destination'],
  valid_from:['生效日期','Valid From'],valid_until:['原失效日期','Original Expiry'],extension_on:['最近批准延期日期','Latest Extension Date'],extended_until:['延期后失效日期','Extended Expiry'],effective_until:['当前失效日期','Current Expiry Date'],closed_on:['关证日期','Closure Date'],status:['许可证状态','License Status'],note:['备注','Remarks'],
  used:['已使用','Used'],reserved:['有效预占','Reserved'],pending:['待核销（含于预占）','Pending Reconciliation (Reserved)'],remaining:['剩余额度','Remaining'],available:['可分配额度','Allocatable'],utilization:['使用率','Usage Rate'],
  reference:['业务依据 / 凭证号','Evidence / Reference'],allocation_id:['装车计划 / 发票号','Loading Plan / Invoice']
 },
 statuses:{APPLYING:['申请中','Applying'],ACTIVE:['有效','Active'],SCHEDULED:['未到生效日','Scheduled'],EXPIRED:['已失效','Expired'],CLOSED:['已关证','Closed'],CANCELLED:['已撤销','Cancelled'],EXPIRING:['即将到期','Expiring'],PENDING:['待审批','Pending Approval'],APPROVED:['已通过','Approved'],REJECTED:['已驳回','Rejected'],RESERVED:['已预占','Reserved'],SETTLED:['已核销','Reconciled'],RELEASED:['已释放','Released'],VOID:['编号作废','Number Voided']},
 actions:{ISSUE:['签发','Issue'],AMEND:['正式资料修改','Amend'],EXTEND:['延期','Extend'],CANCEL:['撤销','Revoke'],CLOSE:['正常关证','Close'],CLOSE_EXCEPTION:['异常关证','Exceptional Closure'],SETTLE:['核销','Reconcile'],CORRECT:['核销更正','Correct Reconciliation']},
 types:{LICENSE:['许可证','License'],PROFORMA:['形式发票','Proforma Invoice'],EXTENSION:['延期文件','Extension File'],CLOSURE:['关证文件','Closure File'],USAGE:['核销凭证','Reconciliation Evidence'],OTHER:['其他附件','Other']},
 bases:{PHYSICAL_MT:['实物净重吨','Physical Net MT'],COBALT_MT:['钴金属吨','Cobalt Metal MT'],CUSTOM:['许可证指定单位','License-specific Unit']},
 title(){return this.t('出口许可证管理','Export License Management');},
 label(key){return this.t(...(this.labels[key]||[key,key]));},
 state(key){return this.t(...(this.statuses[key]||[key,key]));},
 options(choices,value){return Object.entries(choices).map(([k,v])=>'<option value="'+esc(k)+'" '+(value===k?'selected':'')+'>'+esc(this.t(...v))+'</option>').join('');},
 value(value){return value==null||value===''?'—':esc(String(value).replace(/T00:00:00\.000Z$/,''));},
 table(headers,rows,id,responsive=false,columns={}){
  const html=CobaltSalesUI.table(headers,rows,id).replace('<table id=','<table data-v34-enhanced="true" id=');
  return UI46Pages.table(html,{responsive,...columns});
 },
 section(title,body){return '<section class="panel export-license-section wms-section"><h2>'+title+'</h2>'+body+'</section>';},
 page(title,html){Router.page(title,'<div class="export-license-page wms-page" data-page-composed data-no-i18n>'+html+'</div>');},
 facts(keys,data){return UI46Pages.factList(keys.map(k=>[this.label(k),k==='status'?UI.status(data[k],'permit',this.state(data[k])):
  this.value(k==='utilization'?data[k]+'%':['quantity','used','reserved','remaining','pending','available'].includes(k)&&data[k]!=null?data[k]+' '+data.unit:data[k])]));},
 input(key,data={},type='text',required=false){return '<label>'+this.label(key)+'<input name="'+key+'" type="'+type+'" '+(required?'required ':'')+'maxlength="'+(key==='note'?1000:320)+'" value="'+esc(data[key]??'')+'"></label>';},
 moneyFields(d){
  const t=this.t,numeric=(key,label,required=false)=>'<label class="wms-field">'+label+'<input name="'+key+'" inputmode="decimal" pattern="[0-9]{1,18}([.][0-9]{1,12})?" maxlength="31" '+(required?'required ':'')+'value="'+esc(d[key]??'')+'"></label>';
  return numeric('quantity',t('批准数量（吨）','Approved Quantity (MT)'),true)+numeric('unit_price',t('单价（美元/吨）','Unit Price (USD/MT)'))+
   '<label class="wms-field">'+t('正式登记金额（美元）','Registered Amount (USD)')+'<input data-permit-amount readonly value="'+esc(d.amount??'')+'"></label>';
 },
 bindMoney(form){
  const [quantity,price]=[form.elements.quantity,form.elements.unit_price],output=form.querySelector('[data-permit-amount]');
  const update=()=>{
   if(!quantity.value||!price.value||!quantity.validity.valid||!price.validity.valid){output.value='';return;}
   const product=Tonnes.scaled(quantity.value,12)*Tonnes.scaled(price.value,12);
   output.value=Tonnes.fixed(Tonnes.scaled(Tonnes.fixed(product,24),2),2);
  };
  quantity.addEventListener('input',update);price.addEventListener('input',update);update();
 },
 bookFields:{
  clearing_agent:160,issuing_bank:160,issuing_bank_account:160,
  offshore_bank:160,offshore_bank_account:160,destination:320,note:1000
 },
 bookParents:{issuing_bank_account:'issuing_bank',offshore_bank_account:'offshore_bank'},
 bookControls(){
  const t=this.t;
  return '<div class="form-grid wms-field-grid permit-books" data-permit-books>'+Object.keys(this.bookFields).map(key=>
   '<div class="permit-book-field"><label for="permit-book-'+key+'">'+this.label(key)+'</label><div>'+
   '<select id="permit-book-'+key+'" data-book-field="'+key+'" disabled><option value="">'+t('请选择','Select')+'</option></select>'+
   '<button type="button" class="button secondary compact" data-book-open="'+key+'" aria-label="'+esc(this.label(key)+' · '+t('记录簿','Record Book'))+'" disabled>'+t('记录簿','Record Book')+'</button></div></div>'+
   (this.bookParents[key]?'<label class="wms-field">'+this.label(key+'_name')+'<input data-account-holder="'+key+'" readonly></label>':'')
  ).join('')+'<p class="permit-book-status" data-book-status role="status"></p></div>';
 },
 bookDialog(){
  const t=this.t;
  return '<dialog id="permit-book-dialog" class="permit-book-dialog" aria-labelledby="permit-book-title"><form class="user-form"><h2 id="permit-book-title"></h2><p data-book-bank></p><ul data-book-entries></ul><div class="form-grid wms-field-grid"><label class="wms-field"><span data-book-label></span><input name="value" required autocomplete="off"></label><label class="wms-field" data-account-name hidden>'+t('账户名','Account Name')+'<input name="account_name" maxlength="160" autocomplete="off"></label></div><p class="error" role="alert"></p><div class="business-toolbar"><button class="button primary" data-book-save>'+t('新增记录','Add Record')+'</button><button type="button" class="button secondary" data-book-create hidden>'+t('返回新增','Back to Add')+'</button><button type="button" class="button secondary" data-book-close>'+t('关闭','Close')+'</button></div></form></dialog>';
 },
 bindBooks(root,getProject,d){
  const t=this.t,fields=Object.keys(this.bookFields),dialog=$('permit-book-dialog'),form=dialog.querySelector('form'),api=this.api()+'/record-books';
  const controls=Object.fromEntries([...root.querySelectorAll('[data-book-field]')].map(select=>[select.dataset.bookField,select]));
  const initial=Object.fromEntries(fields.map(key=>[key,d.processing_records?.[key]||(d[key]?'legacy':'')]));
  let values={...initial},records=[],revision=0,ready=false,scope,kind='',editing=null;
  const status=root.querySelector('[data-book-status]'),alert=form.querySelector('[role=alert]');
  const options=key=>records.filter(row=>row.kind===key&&(!this.bookParents[key]||row.bank_id===values[this.bookParents[key]]));
  const paint=()=>{
   for(const [key,select] of Object.entries(controls)){
    const rows=options(key),selected=values[key];
    select.replaceChildren(new Option(t('请选择','Select'),''));
    if(d[key]&&selected===initial[key]&&!rows.some(row=>row.id===selected))select.add(new Option(d[key],selected));
    for(const row of rows)select.add(new Option(d[key]&&row.id===initial[key]?d[key]:row.value,row.id));
    select.value=selected||'';
    const enabled=ready&&(!this.bookParents[key]||records.some(row=>row.id===values[this.bookParents[key]]));
    select.disabled=!enabled;
    root.querySelector('[data-book-open='+key+']').disabled=!enabled;
    if(this.bookParents[key]){
     const row=rows.find(item=>item.id===selected);
     root.querySelector('[data-account-holder='+key+']').value=(selected===initial[key]?d[key+'_name']:row?.account_name)||'';
    }
   }
  };
  const load=async()=>{
   const project=getProject();
   if(scope===project&&ready)return;
   if(scope&&scope!==project)values={};
   const request=++revision;
   scope=project;ready=false;records=[];paint();
   status.textContent=project?t('正在加载记录簿…','Loading record books…'):t('请先选择所属项目的合同。','Select a contract for the relevant project.');
   if(!project)return;
   try{
    const data=await API.request(api+'?'+new URLSearchParams({project_id:project}));
    if(revision!==request||!root.isConnected)return;
    records=data.items;ready=true;status.textContent='';paint();
   }catch(error){if(revision===request)status.textContent=I18n.translate(error.message,true);}
  };
  for(const [key,select] of Object.entries(controls))select.onchange=()=>{
   values[key]=select.value;
   for(const [account,bank] of Object.entries(this.bookParents))if(bank===key){
    const matching=options(account);
    values[account]=matching.length===1?matching[0].id:'';
   }
   paint();
  };
  const editor=row=>{
   editing=row;
   alert.textContent='';form.elements.value.value=row?.value||'';form.elements.account_name.value=row?.account_name||'';
   form.querySelector('[data-book-label]').textContent=this.label(kind);
   form.querySelector('[data-book-save]').textContent=row?t('保存修改','Save Changes'):t('新增记录','Add Record');
   form.querySelector('[data-book-create]').hidden=!row;
  };
  const entries=()=>{
   const buttons=(label,style,action)=>{
    const b=document.createElement('button');b.type='button';b.className='button compact '+style;b.textContent=label;b.onclick=action;return b;
   };
   dialog.querySelector('[data-book-entries]').replaceChildren(...options(kind).map(row=>{
    const li=document.createElement('li'),label=document.createElement('span'),actions=document.createElement('span');
    label.textContent=[row.value,row.account_name].filter(Boolean).join(' · ');
    actions.className='business-toolbar';
    const edit=buttons(t('编辑','Edit'),'secondary',()=>{editor(row);form.elements.value.focus();});
    const remove=buttons(t('删除','Delete'),'danger-outline',async()=>{
     if(!await OperationConfirm.ask({title:t('删除此记录簿选项？','Delete this record book option?')}))return;
     remove.disabled=true;
     try{
      await API.request(api+'/'+row.id,{method:'DELETE',body:{project_id:scope,version:row.version}});
      records=records.filter(item=>item.id!==row.id);
      if(values[kind]===row.id&&initial[kind]!==row.id)values[kind]='';
      editor(null);paint();entries();
     }catch(error){alert.textContent=I18n.translate(error.message,true);remove.disabled=false;}
    });
    edit.setAttribute('aria-label',t('编辑','Edit')+' '+row.value);
    remove.setAttribute('aria-label',t('删除','Delete')+' '+row.value);
    actions.append(edit,remove);li.append(label,actions);return li;
   }));
  };
  for(const button of root.querySelectorAll('[data-book-open]'))button.onclick=()=>{
   kind=button.dataset.bookOpen;editor(null);
   const bank=records.find(row=>row.id===values[this.bookParents[kind]]);
   $('permit-book-title').textContent=this.label(kind)+' · '+t('记录簿','Record Book');
   dialog.querySelector('[data-book-bank]').textContent=bank?.value||'';
   form.querySelector('[data-account-name]').hidden=!bank;
   form.elements.value.maxLength=this.bookFields[kind];
   entries();dialog.showModal();form.elements.value.focus();
  };
  dialog.querySelector('[data-book-close]').onclick=()=>dialog.close();
  form.querySelector('[data-book-create]').onclick=()=>editor(null);
  form.onsubmit=e=>this.submit(e,async()=>{
   const key=kind,bank=values[this.bookParents[key]],current=editing;
   const row=await API.request(api+(current?'/'+current.id:''),{method:current?'PATCH':'POST',
    body:{project_id:scope,kind:key,value:form.elements.value.value,...(current?{version:current.version}:{}),...(bank?{bank_id:bank,account_name:form.elements.account_name.value}:{})}});
   if(!root.isConnected)return;
   records=records.filter(item=>item.id!==row.id);records.push(row);
   paint();dialog.close();controls[key].focus();
  });
  load();
  return {load,selection:()=>{
   if(!ready)throw Error(t('请等待办证资料加载完成。','Wait for the processing records to load.'));
   return Object.fromEntries(fields.filter(key=>values[key]!=='legacy'&&(values[key]||'')!==initial[key]).map(key=>[key,values[key]||null]));
  }};
 },
 async routePage(path){
  this.page(this.title(),'<section class="panel export-license-loading" aria-busy="true" aria-busy="true"><p role="status">'+this.t('正在加载许可证…','Loading licenses…')+'</p><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></section>');
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
  const indicators=[['','许可证总数','Total Licenses',d.indicators.total],['ACTIVE','有效许可证','Active Licenses',d.indicators.active],['EXPIRING','即将到期','Expiring Soon',d.indicators.expiring],['CLOSED','已关证','Closed Licenses',d.indicators.closed]];
  const cards='<div class="v34-kpi-grid">'+indicators.map(([k,zh,en,n])=>'<a class="v34-kpi" href="'+base+(k?'?status='+k:'')+'"><span>'+t(zh,en)+'</span><strong>'+n+'</strong></a>').join('')+'</div>';
  const units=d.units.length?this.table([['计量口径 / 单位','Basis / Unit'],['批准总量','Approved'],['已使用','Used'],['剩余','Remaining'],['可分配','Allocatable']],d.units.map(row=>'<tr><th scope="row">'+esc(this.t(...this.bases[row.unit_basis]))+' / '+esc(row.unit)+'</th>'+['quantity','used','remaining','available'].map(k=>'<td>'+this.value(row[k])+'</td>').join('')+'</tr>'),'export-license-units'):'';
  const buttons='<div class="business-toolbar">'+(this.can('write')?'<a class="button primary" href="'+base+'/new">'+t('登记许可证申请','Register Application')+'</a>':'')+(CurrentUser.permissions.includes('loading-plan:read')?'<a class="button secondary" href="'+base+'?view=legacy">'+t('历史装车许可证号','Legacy Loading License Numbers')+'</a>':'')+'</div>';
  const searchField=(key,zh,en,type='search')=>'<label>'+t(zh,en)+'<input type="'+type+'" name="'+key+'" maxlength="160" value="'+esc(q.get(key)||'')+'"></label>';
  const selectField=(key,zh,en,options)=>'<label>'+t(zh,en)+'<select name="'+key+'"><option value="">'+t('全部','All')+'</option>'+
   options.map(([id,label])=>'<option value="'+esc(id)+'" '+(q.get(key)===id?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>';
  const facets=(key,label=key)=>[...new Map(d.facets.filter(row=>row[key]).map(row=>[row[key],row[label]]))].sort((a,b)=>a[1].localeCompare(b[1]));
  const states=['APPLYING','PENDING','ACTIVE','SCHEDULED','EXPIRING','EXPIRED','CLOSED','CANCELLED'].map(key=>[key,this.state(key)]);
  const filter='<form id="export-license-filter" class="filters permit-register-filter wms-filter-row">'+
   searchField('proforma_no','形式发票号','Proforma Invoice No.')+searchField('license_no','许可证号','License No.')+
   selectField('customer_id','客户','Customer',facets('customer_id','buyer'))+searchField('contract_no','合同号','Contract No.')+
   selectField('clearing_agent','开证清关公司','Clearance Agent',facets('clearing_agent'))+
   selectField('issuing_bank','开证银行','Issuing Bank',facets('issuing_bank'))+selectField('status','许可证状态','License Status',states)+
   '<div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+'</button><a class="button secondary" data-wms-reset href="'+base+'">'+t('重置','Reset')+'</a></div></form>';
  const headings=[['形式发票号','Proforma Invoice No.'],['许可证号','License No.'],['买家','Buyer'],['合同号','Contract No.'],
   ['许可证数量','Licensed Quantity'],['已用量 / 使用率','Used / Usage Rate'],['剩余量','Remaining'],['生效日期','Valid From'],['失效日期','Expiry Date'],['状态','Status'],['操作','Actions']];
  const rows=d.items.map(r=>{
   const url=base+'/'+r.id,amount=key=>this.value(r[key])+' '+esc(r.unit);
   const cells=['<a href="'+url+'">'+this.value(r.proforma_no)+'</a>',this.value(r.license_no),this.value(r.buyer),this.value(r.contract_no),
    amount('quantity'),amount('used')+' / '+this.value(r.utilization)+'%',amount('remaining'),this.value(r.valid_from),this.value(r.effective_until),
    UI.status(r.status,'permit',this.state(r.status)),'<a class="button secondary compact" href="'+url+'">'+t('查看','View')+'</a>'];
   return '<tr>'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>';
  });
  const settings=CurrentUser.permissions.includes('system:manage')?'<details><summary>'+t('到期提醒设置','Expiry Reminder Settings')+'</summary><form id="export-license-settings" class="user-form"><div class="form-grid"><label>'+t('提前提醒天数','Reminder Days')+'<input type="number" name="expiry_days" min="1" max="365" required value="'+d.expiry_days+'"></label></div><div class="business-toolbar"><button class="button secondary">'+t('保存提醒设置','Save Reminder')+'</button></div></form></details>':'';
  this.page(this.title(),buttons+cards+this.section(t('许可证台账','License Register'),filter+this.table(headings,rows,'export-license-table',true,{numeric:[4,5,6],actions:[10]})+CobaltStockUI.pager(d.page,d.total,d.page_size))+units+settings);
  $('export-license-filter').onsubmit=e=>{e.preventDefault();const values=new URLSearchParams([...new FormData(e.target)].filter(([,v])=>v));Router.go(base+(values.size?'?'+values:''));};
  if($('export-license-settings'))$('export-license-settings').onsubmit=e=>this.submit(e,async()=>{await API.request(this.api()+'/preferences',{method:'POST',body:{expiry_days:Number(e.target.elements.expiry_days.value)}});await this.list();});
  CobaltStockUI.bindPager(d);
 },
 async form(id){
  const t=this.t,api=this.api(),[options,d]=await Promise.all([API.request(api+'/contracts'),id?API.request(api+'/'+id):Promise.resolve({currency:'USD',unit:'MT',unit_basis:'PHYSICAL_MT',applied_on:BusinessTime.today()})]);
  const selected='<label>'+this.label('contract_id')+'<select name="contract_id" required '+(id?'disabled':'')+'><option value="">'+t('请选择','Select')+'</option>'+[...options.items,...(id&&!options.items.some(row=>row.id===d.contract_id)?[{id:d.contract_id,buyer:d.buyer,contract_no:d.contract_no}]:[])].map(r=>'<option value="'+r.id+'" '+(d.contract_id===r.id?'selected':'')+'>'+esc(r.buyer+' / '+r.contract_no)+'</option>').join('')+'</select></label>';
  const legacy=id&&(d.unit_basis!=='PHYSICAL_MT'||d.unit!=='MT'||d.currency!=='USD');
  this.page(id?t('编辑许可证申请','Edit License Application'):t('登记出口许可证申请','Register Export License Application'),
   '<form id="export-license-application" class="user-form" data-wms-validation>'+
   this.section(t('申请资料','Application Details'),'<div class="form-grid wms-field-grid">'+selected+this.input('applied_on',d,'date',true)+this.input('proforma_no',d,'text',true)+'</div>')+
   this.section(t('数量与金额','Quantity and Amount'),'<div class="form-grid wms-field-grid">'+(legacy?this.facts(['quantity','unit_price','price_unit','amount','currency'],d):this.moneyFields(d))+'</div>')+
   this.section(t('办证资料','Processing Details'),this.bookControls())+
   '<p class="error" role="alert"></p><div class="business-toolbar"><button class="button primary">'+t('保存申请','Save Application')+'</button><a class="button secondary" href="'+this.route+(id?'/'+id:'')+'">'+t('返回','Back')+'</a></div></form>'+this.bookDialog());
  ProductContext.dirty=false;
  const f=$('export-license-application');if(!legacy)this.bindMoney(f);
  const projects=[...new Set(options.items.map(row=>row.project_id))];
  const project=()=>d.project_id||options.items.find(row=>row.id===f.elements.contract_id.value)?.project_id||(projects.length===1?projects[0]:null);
  const books=this.bindBooks(f.querySelector('[data-permit-books]'),project,d);
  f.elements.contract_id.onchange=()=>books.load();
  f.onsubmit=e=>this.submit(e,async()=>{
   const body=Object.fromEntries(new FormData(f));body.processing_records=books.selection();if(id){body.contract_id=d.contract_id;body.version=d.version;}
   const saved=await API.request(api+(id?'/'+id:''),{method:id?'PATCH':'POST',body});
   await Router.go(this.route+'/'+saved.id);
  });
 },
 async detail(id){
  const t=this.t,api=this.api()+'/'+id,d=await API.request(api),write=this.can('write'),pending=d.history.some(a=>a.decision==='PENDING');
  const attached=d.attachments.length?this.table([['类别','Category'],['文件','File'],['上传人','Uploader'],['时间','Time']],d.attachments.map(f=>'<tr><td>'+esc(t(...this.types[f.category]))+'</td><td><button type="button" class="button secondary compact" data-permit-download="'+f.id+'">'+esc(f.filename)+'</button></td><td>'+esc(f.uploader)+'</td><td>'+esc(BusinessTime.display(f.created_at))+'</td></tr>'),'permit-attachments'):'<p class="quiet-note" role="status">'+t('暂无附件','No attachments')+'</p>';
  const upload=write?'<form id="permit-upload" class="user-form"><div class="form-grid"><label>'+t('附件类别','Attachment Category')+'<select name="category">'+this.options(this.types)+'</select></label><label>'+t('附件（PDF、PNG、JPEG，最多256 KiB）','Attachment (PDF, PNG, JPEG, 256 KiB max)')+'<input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" required></label></div><div class="business-toolbar"><button class="button secondary">'+t('上传','Upload')+'</button></div><p class="error" role="alert"></p></form>':'';
  const bindings=d.allocations.length?this.table([['装车计划','Loading Plan'],['发票号','Invoice'],['预占数量','Reserved'],['正式核销量','Reconciled'],['状态','Status'],['正式出库','Formal Outbound']],d.allocations.map(a=>'<tr><td><a href="/loading-plans/orders/'+a.plan_id+'">'+esc(a.plan_no)+'</a></td><td>'+esc(a.invoice_no)+'</td><td>'+this.value(a.reserved_quantity)+'</td><td>'+this.value(a.used_quantity)+'</td><td>'+esc(a.state==='RESERVED'&&a.posted_at?t('待核销','Pending Reconciliation'):this.state(a.state))+'</td><td>'+esc(a.posted_at?BusinessTime.display(a.posted_at):'—')+'</td></tr>'),'permit-allocations'):'<p class="quiet-note" role="status">'+t('暂无关联装车','No linked loading plans')+'</p>';
  const history=a=>{
   const can=this.can('approve')&&a.decision==='PENDING'&&a.requested_by!==CurrentUser.id;
   const evidence=Object.entries({...a.payload,processing_records:undefined,...a.processing_changes}).filter(([k,v])=>k!=='allocation_id'&&v!==undefined).map(([k,v])=>this.label(k)+' '+(v??t('清空','Clear'))).join(' · ');
   const review=can?'<form data-permit-review="'+a.id+'" id="permit-review-'+a.id+'"><label>'+t('审核意见','Review Note')+'<input name="note" required maxlength="1000"></label><button class="button primary" name="decision" value="APPROVED">'+t('通过','Approve')+'</button> <button class="button secondary" name="decision" value="REJECTED">'+t('驳回','Reject')+'</button><p class="error" role="alert"></p></form>':'';
   const change=a.action==='EXTEND'&&a.result?.previous_effective_until?'<p>'+t('失效日期变更','Expiry Date Changed')+' '+this.value(a.result.previous_effective_until)+' → '+this.value(a.result.extended_until)+'</p>':'';
   return '<article><strong>'+t(...this.actions[a.action])+' · '+this.state(a.decision)+'</strong><p>'+esc(a.requester+' · '+BusinessTime.display(a.requested_at)+' · '+a.reason)+'</p><p>'+esc(evidence)+'</p>'+(a.reviewer?'<p>'+esc(a.reviewer+' · '+BusinessTime.display(a.reviewed_at)+' · '+a.review_note)+'</p>':'')+change+review+'</article>';
  };
  const extensions=d.history.filter(a=>a.action==='EXTEND').map(history).join('');
  const reviews=d.history.filter(a=>a.action!=='EXTEND').map(history).join('');
  const request=write&&!pending?this.actionForm(d):'';
  const product=ProductContext.isCopper()?t('阴极铜','Copper Cathodes'):t('氢氧化钴','Cobalt Hydroxide');
  const actionLink=write&&d.state==='ISSUED'&&!pending?'<a class="button primary" href="#permit-extension">'+t('申请延期','Request Extension')+'</a>':'';
  const historical=d.historical_usage?.length?this.table([['历史装箱单','Historical Packing List'],['发票号','Invoice'],['发运日期','Shipping Date'],['已用量（吨）','Used (MT)']],
   d.historical_usage.map(a=>'<tr><td>'+(CurrentUser.role_code==='admin'?'<a href="/workbench/historical-movements/'+a.source_id+'?product='+d.product_code+'">'+this.value(a.document_no)+'</a>':this.value(a.document_no))+'</td><td>'+this.value(a.invoice_no)+'</td><td>'+this.value(a.business_date)+'</td><td>'+this.value(a.used_quantity)+'</td></tr>'),
   'permit-historical-usage',true,{numeric:[3]}):'';
  const quota=this.facts(['quantity','used','utilization','reserved','remaining'],d);
  this.page(t('出口许可证详情','Export License Details'),'<div class="business-toolbar">'+actionLink+'<a class="button secondary" href="'+this.route+'">'+t('返回许可证列表','Back to Licenses')+'</a>'+(write&&!pending&&d.state==='APPLYING'?'<a class="button secondary" href="'+this.route+'/'+id+'/edit">'+t('编辑申请','Edit Application')+'</a>':'')+'</div>'+
   this.section(t('许可证资料','License Information'),this.facts(['license_no','proforma_no','status'],d))+
   this.section(t('许可证额度','License Quota'),quota)+
   this.section(t('基础资料','Basic Information'),'<p>'+product+'</p>'+this.facts(['buyer','contract_no','applied_on'],d))+
   this.section(t('办证资料','Processing Details'),this.facts(Object.keys(this.bookFields).flatMap(key=>this.bookParents[key]?[key,key+'_name']:[key]),d))+
   this.section(t('金额','Amount'),this.facts(d.standard_amount?['unit_price','price_unit','amount','currency']:['unit_price','price_unit','amount','reference_amount','currency'],d))+
   this.section(t('有效期与关证','Validity and Closure'),this.facts(['valid_from','valid_until','extension_on','extended_until','effective_until','closed_on'],d))+
   this.extensionPanel(d,pending,extensions)+
   this.section(t('装车及额度记录','Loading and Quota Records'),this.facts(['pending','available'],d)+bindings+historical)+
   this.section(t('审核与历史','Review and History'),request+'<div class="export-license-history">'+(reviews||'<p>'+t('暂无审核记录','No review records')+'</p>')+'</div>')+
   this.section(t('许可证附件','License Attachments'),attached+upload)+(request?this.bookDialog():''));
  this.bindExtension(d);
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
 extensionPanel(d,pending,history){
  const t=this.t,allowed=this.can('write')&&d.state==='ISSUED'&&!pending;
  const form=allowed?'<form id="permit-extension-form" class="user-form"><div class="form-grid">'+
   '<label>'+t('拟延期至','Proposed Expiry')+'<input name="until" type="date" required aria-describedby="permit-extension-date-error"><small id="permit-extension-date-error" class="error"></small></label>'+
   '<label>'+t('延期原因','Extension Reason')+'<input name="reason" maxlength="200" required></label></div>'+
   '<div class="business-toolbar"><button class="button primary">'+t('提交延期审批','Submit Extension for Review')+'</button></div><p class="error" role="alert"></p></form>':'';
  return '<section id="permit-extension" class="panel export-license-section"><h2>'+t('许可证延期','License Extension')+'</h2>'+
   this.facts(['effective_until'],d)+form+'<div class="export-license-history">'+(history||'<p>'+t('暂无延期记录','No extension records')+'</p>')+'</div></section>';
 },
 bindExtension(d){
  const form=$('permit-extension-form');
  if(!form)return;
  const field=form.elements.until,error=$('permit-extension-date-error');
  field.oninput=()=>{error.textContent='';field.removeAttribute('aria-invalid');};
  form.onsubmit=e=>this.submit(e,async()=>{
   if(field.value<=String(d.effective_until).slice(0,10)){
    field.setAttribute('aria-invalid','true');
    error.textContent=this.t('拟延期至须晚于当前失效日期。','The proposed date must be after the current expiry date.');
    field.focus();
    return;
   }
   const reason=form.elements.reason.value.trim();
   await API.request(this.api()+'/'+d.id+'/actions',{method:'POST',body:{action:'EXTEND',version:d.version,reason,
    payload:{extension_on:d.local_day,extended_until:field.value,reference:reason}}});
   await this.detail(d.id);
  });
 },
 actionForm(d){
  const t=this.t,options=d.state==='APPLYING'?['ISSUE','CANCEL']:d.state==='ISSUED'?['AMEND','CLOSE','CLOSE_EXCEPTION','CANCEL']:[];
  if(['ISSUED','CLOSED'].includes(d.state)){
   if(d.allocations.some(a=>a.state==='RESERVED'&&a.posted_at))options.push('SETTLE');
   if(d.allocations.some(a=>a.state==='SETTLED'&&a.posted_at))options.push('CORRECT');
  }
  return options.length?'<form id="permit-action" class="user-form"><label>'+t('审核事项','Action for Review')+'<select name="action">'+this.options(Object.fromEntries(options.map(k=>[k,this.actions[k]])))+'</select></label><div id="permit-action-fields" class="form-grid"></div><label>'+t('申请原因','Reason')+'<input name="reason" required maxlength="1000"></label><button class="button secondary">'+t('提交审核','Submit for Review')+'</button><p class="error" role="alert"></p></form>':'';
 },
 bindAction(d){
  const f=$('permit-action'),t=this.t;
  let books;
  const draw=()=>{
   books=null;
   const action=f.elements.action.value;
   let inputs;
   if(action==='ISSUE')inputs=this.input('license_no',{},'text',true)+this.input('valid_from',{},'date',true)+this.input('valid_until',{},'date',true);
   else if(action==='AMEND')inputs=(d.standard_amount?this.moneyFields(d):['quantity','unit_price','price_unit','amount','currency'].map(k=>this.input(k,d)).join(''))+this.bookControls();
   else if(['SETTLE','CORRECT'].includes(action)){
    const candidates=d.allocations.filter(a=>a.state===(action==='SETTLE'?'RESERVED':'SETTLED')&&a.posted_at);
    inputs='<label>'+this.label('allocation_id')+'<select name="allocation_id" required>'+candidates.map(a=>'<option value="'+a.id+'">'+esc(a.plan_no+' / '+a.invoice_no)+'</option>').join('')+'</select></label>'+this.input('quantity',{},'text',true)+this.input('reference',{},'text',true)+'<p>'+t('核销单位','Reconciliation Unit')+' '+esc(d.unit)+'</p>';
   }else inputs=(action==='CANCEL'?'':this.input('closed_on',{},'date',true))+this.input('reference',{},'text',true);
   $('permit-action-fields').innerHTML=inputs;
   if(action==='AMEND'){if(d.standard_amount)this.bindMoney(f);books=this.bindBooks(f.querySelector('[data-permit-books]'),()=>d.project_id,d);}
  };
  f.elements.action.onchange=draw;draw();
  f.onsubmit=e=>this.submit(e,async()=>{
   const {action,reason,...payload}=Object.fromEntries(new FormData(f));
   if(books)payload.processing_records=books.selection();
   await API.request(this.api()+'/'+d.id+'/actions',{method:'POST',body:{action,reason,payload,version:d.version}});
   await this.detail(d.id);
  });
 },
 submit(e,run){return UI46Pages.submit(e,run);},
 async mountOverview(root){
  if(!this.can('read'))return;
  const t=this.t;
  try{
   const {indicators,units}=await API.request(this.api());
   if(!root.isConnected)return;
   const section=document.createElement('section');
   section.className='oa-kpis oa-permit-kpis';
   section.setAttribute('aria-label',this.title());
   const amount=units.map(row=>row.remaining+' '+row.unit).join(' / ')||'0';
   const cards=[
    ['ACTIVE',t('有效出口许可证','Active Export Licenses'),indicators.active],
    ['ACTIVE',t('许可证剩余额度','Remaining License Quota'),amount],
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
  let request=0,previewRequest=0,timer;
  const show=()=>{
   const token=++previewRequest,licenseId=select.value;
   const chosen=known.get(select.value),reserved=!!select.value,isCustom=chosen?.unit_basis==='CUSTOM';
   if(invoice){invoice.required=!reserved&&ProductContext.isCopper();invoice.readOnly=reserved;}
   if(manual)manual.readOnly=reserved;
   slot.querySelector('#'+id+'-quantity').hidden=!isCustom;form.elements.license_unit.value=isCustom?chosen.unit:'';
   if(reserved){
    if(manual)manual.value=chosen?.license_no||old?.license_no||'';
    if(invoice)invoice.value=old?.license_id===select.value?old.invoice_no:'';
   }
   const available=chosen?.available!=null?' '+t('可分配 ','Allocatable ')+chosen.available+' '+chosen.unit:'';
   note.textContent=reserved?t('最终发票号在保存时确定。','The final invoice number is assigned on save.')+available:'';
   if(!reserved||old?.license_id===licenseId)return;
   const filters=new URLSearchParams({sales_plan_id:sales.value,invoice_preview_id:licenseId});
   if(date?.value)filters.set('planned_load_date',date.value);
   API.request(this.api()+'/options?'+filters).then(d=>{
    if(token!==previewRequest||select.value!==licenseId||!form.isConnected)return;
    if(invoice)invoice.value=d.invoice_preview||'';
    if(d.invoice_preview)note.textContent=t('预计发票号 ','Proposed invoice ')+d.invoice_preview+' · '+note.textContent;
   }).catch(error=>{if(token===previewRequest&&select.value===licenseId&&form.isConnected)note.textContent=error.message;});
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
