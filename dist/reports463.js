'use strict';
window.Reports463={
 serial:0,
 categories:[
  ['shipping','发运及单证','Shipments & Documents'],
  ['movement','出入库流水','Inventory Movements'],
  ['balance','收发存与对账','Stock Balance & Reconciliation'],
  ['stocktake','盘点与差异','Stocktake & Variances'],
  ['sales','销售与履约','Sales & Fulfilment']
 ],
 groups:[['date','按日','By Day'],['customer','按客户','By Customer'],['contract','按合同','By Contract'],['vehicle','按车辆','By Vehicle'],['lot','按批次号','By Lot Number']],
 t(zh,en){return I18n.language==='en'?en:zh;},
 captureDraft(){
  const form=document.querySelector('#r481-filter');
  return location.pathname==='/reports'&&form?{values:Object.fromEntries(new FormData(form)),advanced:!!form.querySelector('details[open]')}:null;
 },
 language(draft){
  if(location.pathname!=='/reports'||!window.AppSignedIn)return;
  this.draft=draft;
  if(!Router.rendering)Router.show();
 },
 query(){
  const url=new URLSearchParams(location.search);
  const legacy={inventory:'movement',outbound:'shipping',counts:'stocktake',balance:'balance',sales:'sales'};
  const kind=url.get('kind')||legacy[url.get('section')]||'shipping';
  const query={kind:this.categories.some(item=>item[0]===kind)?kind:'shipping'};
  for(const key of ['from','to','month','group','source','kind_filter','status','finding','document','customer','contract','vehicle','lot','warehouse_id','scope']){
   if(url.get(key))query[key]=url.get(key);
  }
  return query;
 },
 url(patch={},reset=false){
  const q=new URLSearchParams(reset?{kind:this.query().kind}:this.query());
  const current=new URLSearchParams(location.search);
  for(const key of ['tab','page'])if(!reset&&current.get(key))q.set(key,current.get(key));
  for(const [key,value] of Object.entries(patch))value==null||value===''?q.delete(key):q.set(key,value);
  return '/reports?'+q.toString();
 },
 async render(){
  const serial=++this.serial;
  const q=this.query(),product=ProductContext.code;
  const query=new URLSearchParams(q);
  const current=new URLSearchParams(location.search);
  const view=current.get('tab')==='detail'?'detail':'summary';
  const page=Math.max(1,Number.parseInt(current.get('page'),10)||1);
  let data,error;
  try{data=await API.request('/report-center?'+query);}
  catch(err){error={message:err.message,status:err.statusCode||err.status};}
  if(serial!==this.serial||location.pathname!=='/reports'||product!==ProductContext.code)return;
  this.current={q,data,view,page,product};
  const content='<div class="r463-page r481-report" data-no-i18n data-report-center>'+
   this.navigation(q)+'<section class="r463-card">'+this.filters(q,data,view)+'</section>'+
   (error?'<div class="r463-empty" role="alert">'+esc(error.message)+'</div>':this.metrics(data)+this.results(data,q,view,page))+'</div>';
  ProductContext.dirty=false;
  Router.page(this.t('统计报表','Business Reports'),content);
  const root=document.querySelector('[data-report-center]');
  if(!root)return;
  root.querySelector('#r481-filter').onsubmit=event=>{
   event.preventDefault();
   const values=Object.fromEntries(new FormData(event.currentTarget));
   for(const key of Object.keys(values))values[key]=values[key].trim();
   if(values.from&&values.to&&values.from>values.to){
    root.querySelector('#r481-error').textContent=this.t('截止日期须等于或晚于开始日期。','End date must be on or after the start date.');
    return;
   }
   Router.go(this.url({...values,kind:q.kind,group:q.group},true));
  };
  root.querySelector('#r481-group')?.addEventListener('change',event=>Router.go(this.url({group:event.target.value,page:null,scope:null})));
  root.querySelector('#r481-clear-scope')?.addEventListener('click',()=>Router.go(this.url({scope:null,page:null})));
  root.querySelector('#r481-export')?.addEventListener('click',event=>this.export(event.currentTarget));
  if(this.draft){
   const draft=this.draft;this.draft=null;
   for(const [key,value] of Object.entries(draft.values)){const input=root.querySelector('[name="'+key+'"]');if(input)input.value=value;}
   const details=root.querySelector('details');if(details)details.open=draft.advanced;
  }
 },
 navigation(q){
  return '<nav class="r463-categories" aria-label="'+this.t('报表类别','Report Categories')+'">'+this.categories.map(([key,zh,en])=>
   '<a href="'+esc(this.url({kind:key},true))+'"'+(q.kind===key?' aria-current="page"':'')+'><strong>'+esc(this.t(zh,en))+'</strong></a>').join('')+'</nav>';
 },
 field(name,zh,en,type,value,list){
  const caption=esc(this.t(zh,en));
  const options=list&&'<option value="">'+this.t('全部','All')+'</option>'+list.map(option=>{
   const id=typeof option==='string'?option:option.id,label=typeof option==='string'?option:option.label;
   return '<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(label)+'</option>';
  }).join('');
  return '<label>'+caption+(list?'<select name="'+name+'">'+options+'</select>':'<input type="'+type+'" name="'+name+'" value="'+esc(value||'')+
   '"'+(type==='month'?' required':'')+(type==='search'?' maxlength="160"':'')+'>')+'</label>';
 },
 filters(q,data,view){
  const make=(name,zh,en,type='search',list)=>this.field(name,zh,en,type,q[name],list);
  const fieldEnum=(key,zh,en,values)=>make(key,zh,en,'select',values.map(id=>({id,label:data?.labels[id]||id})));
  const dates=this.field('from','开始日期','Start Date','date',q.from||data?.from)+this.field('to','截止日期','End Date','date',q.to||data?.to);
  const monthly=q.kind==='balance'||q.kind==='sales';
  const month=this.field('month',q.kind==='balance'?'对账月份':'发运月',q.kind==='balance'?'Reconciliation Month':'Shipment Month','month',
   q.month||data?.from?.slice(0,7)||new Date().toISOString().slice(0,7));
  const terms=make('customer','客户','Customer')+make('contract','合同号','Contract No.');
  const source=()=>fieldEnum('source','数据来源','Source',['ONLINE','HISTORICAL']);
  const lot=()=>make('lot','批次号','Lot Number');
  const warehouse=()=>make('warehouse_id','仓库','Warehouse','select',data?.warehouses||[]);
  let fields=monthly?month:dates,extra='';
  if(q.kind==='shipping'){
   fields+=terms;
   extra=make('vehicle','车辆','Vehicle')+lot()+
    fieldEnum('status','单证状态','Document Status',['DOCUMENT_COMPLETE','DOCUMENT_MISSING','INVOICE_PENDING','IMPORTED_PACKING'])+source();
  }else if(q.kind==='movement'){
   fields+=fieldEnum('kind_filter','业务类型','Movement',['INBOUND','OUTBOUND','RETURN','WEIGHT','TRANSFER','ADJUSTMENT','BASELINE'])+source();
   extra=make('document','单据号','Document No.')+lot();
  }else if(q.kind==='balance')fields+=warehouse();
  else if(q.kind==='stocktake'){
   fields+=make('document','盘点单号','Stocktake No.');
   extra=fieldEnum('finding','差异类型','Finding',['MATCH','GAIN','LOSS','WEIGHT_MISMATCH','LOCATION','STATUS','UNCOUNTED','DIFFERENCE'])+
    fieldEnum('status','处理状态','Resolution',['MATCH','OPEN','RESOLVED']);
  }else fields+=terms;
  const advanced=Object.keys(q).some(key=>['vehicle','lot','status','finding'].includes(key)||key==='source'&&q.kind==='shipping');
  return '<form id="r481-filter" class="r463-filter">'+
   '<div class="wms-filter-row">'+fields+'<div class="wms-filter-actions">'+
   '<a class="button secondary" href="'+esc(this.url({},true))+'">'+this.t('重置','Reset')+'</a>'+
   '<button class="button primary" type="submit">'+this.t('查询','Search')+'</button></div></div>'+
   (extra?'<details'+(advanced?' open':'')+'><summary>'+this.t('更多筛选','More Filters')+'</summary><div class="wms-filter-row">'+extra+'</div></details>':'')+
   '<p class="error" role="alert" id="r481-error"></p></form>';
 },
 metrics(data){
  return '<div class="r463-stats" role="group" aria-label="Report Metrics">'+data.metrics.map(({label,value,type})=>
   '<div class="r463-stat"><span>'+esc(label)+'</span><strong>'+esc(this.number(value,type))+'</strong></div>').join('')+'</div>';
 },
 number(v,type){
  if(v==null||v==='')return '—';
  if(type==='number')return CountValues.display(v);
  if(type==='percent')return Number(v).toLocaleString(I18n.language==='en'?'en':'zh-CN',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1});
  if(type==='weight')return Tonnes.format(String(v));
  return v;
 },
 cell(row,col,data){
  const value=row[col.key];
  if(col.type==='enum'){
   const text=data.labels[value]||value;
   if(!text)return '—';
   const notice=['HISTORICAL','INVOICE_PENDING','DOCUMENT_MISSING','IMPORTED_PACKING','OPEN','UNLINKED_HISTORY'].includes(value);
   return '<span class="r463-badge'+(notice?' partial':'')+'">'+esc(text)+'</span>';
  }
  if(col.type==='percent'&&value!=null)return '<span class="r481-progress"><progress max="1" value="'+Math.min(1,Number(value))+
   '" aria-label="'+esc(col.label)+'"></progress> '+esc(this.number(value,col.type))+'</span>';
  return esc(this.number(value,col.type));
 },
 results(data,q,view,page){
  const {columns,rows}=data[view],size=25,total=rows.length,maximum=Math.max(1,Math.ceil(total/size));
  page=Math.min(page,maximum);
  const selected=rows.slice((page-1)*size,page*size);
  const action=view==='summary'&&q.scope==null;
  const group=q.kind!=='shipping'||view!=='summary'?'':'<label>'+this.t('汇总分组','Group By')+
   ' <select id="r481-group">'+this.groups.map(([key,zh,en])=>'<option value="'+key+'"'+((q.group||'date')===key?' selected':'')+'>'+esc(this.t(zh,en))+'</option>').join('')+'</select></label>';
  const viewLink=(key,label)=>'<a href="'+esc(this.url({tab:key,page:null,scope:key==='summary'?null:q.scope}))+'"'+
   (view===key?' aria-current="page"':'')+'>'+label+'</a>';
  const header='<div class="r481-toolbar"><nav class="r463-views" aria-label="'+this.t('结果视图','Result View')+'">'+
   viewLink('summary',this.t('汇总','Summary'))+viewLink('detail',this.t('明细','Detail'))+'</nav><div>'+
   group+(data.canExport?'<button id="r481-export" class="button primary" type="button"'+(!data.detail.rows.length&&!data.summary.rows.length?' disabled':'')+
   '>'+this.t('导出 Excel','Export Excel')+'</button>':'')+'</div></div>';
  const scope=data.scopeLabel==null?'':'<div class="r481-scope">'+esc(data.scopeLabel)+' <button id="r481-clear-scope" class="button compact secondary" type="button">'+
   this.t('清除明细范围','Clear Detail Scope')+'</button></div>';
  const cellClass=col=>['number','weight','percent'].includes(col.type)?' class="r481-number"':'';
  const table=!total?'<p class="r463-empty">'+this.t('当前筛选条件下暂无记录','No records under the current filters')+'</p>':
   '<div class="r463-table-wrap" tabindex="0" role="region" aria-label="'+esc(data.title)+'"><table class="r463-table"><thead><tr>'+
   columns.map(col=>'<th scope="col"'+cellClass(col)+'>'+esc(col.label)+'</th>').join('')+
   (action?'<th scope="col">'+this.t('操作','Actions')+'</th>':'')+'</tr></thead><tbody>'+
   selected.map(row=>'<tr>'+columns.map(col=>'<td'+cellClass(col)+'>'+this.cell(row,col,data)+'</td>').join('')+
   (action?'<td><a href="'+esc(this.url({tab:'detail',scope:row.scope||null,page:null}))+'">'+this.t('查看明细','View Detail')+'</a></td>':'')+'</tr>').join('')+
   '</tbody></table></div>';
  const pager='<div class="r463-pager"><span role="status">'+this.t('共 ','Total ')+total+this.t(' 条',' records')+'</span>'+
   (maximum>1?'<div>'+[[page-1,this.t('上一页','Previous')],[page+1,this.t('下一页','Next')]].filter(([p])=>p>=1&&p<=maximum)
    .map(([p,label])=>'<a class="button secondary" href="'+esc(this.url({page:p}))+'">'+label+'</a>').join(' ')+'</div>':'')+'</div>';
  const note=q.kind==='balance'?this.t('历史发运单独列示。报表重量单位为 MT。','Historical shipments are shown separately. Weight is in MT.'):
   q.kind==='sales'?this.t('履约率按确认开票净重计算。重量单位为 MT。','Fulfilment uses invoice-confirmed net weight. Weight is in MT.'):
   q.kind==='shipping'&&q.group==='lot'?this.t('同一车次可归入多个批次。发运总车次已去重。','A trip can appear under several lots. Total trips are deduplicated.'):'';
  return '<section class="r463-card" aria-label="'+esc(data.title)+'">'+header+scope+table+
   (note?'<p class="r463-note">'+esc(note)+'</p>':'')+pager+'<p id="r481-export-error" class="error" role="alert"></p></section>';
 },
 async export(button){
  button.disabled=true;
  const error=document.querySelector('#r481-export-error');error.textContent='';
  try{
   const current=this.current;
   const result=await API.request('/report-center/export',{method:'POST',body:current.q,binary:true});
   const url=URL.createObjectURL(result.blob),link=document.createElement('a');
   link.href=url;link.download=current.data.title+'.xlsx';link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }catch(err){error.textContent=err.message;}finally{button.disabled=false;}
 }
};
