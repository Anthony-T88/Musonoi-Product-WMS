'use strict';
window.StocktakeList={
 t:(zh,en)=>I18n.language==='en'?en:zh,
 kinds:{MONTHLY:['月度盘点','Monthly'],SEMIANNUAL:['半年度盘点','Half-year'],ANNUAL:['年度盘点','Annual'],SPECIAL:['临时专项盘点','Special']},
 type(value){return this.kinds[value]?this.t(...this.kinds[value]):'—';},
 period(type,value){
  if(!value)return '—';
  if(type==='MONTHLY')return value;
  const end=type==='SEMIANNUAL'&&value.endsWith('-01')?'06':'12';
  return value+this.t('至',' to ')+value.slice(0,5)+end;
 },
 option(value,label,selected){return '<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';},
 types(selected,empty=true){return (empty?this.option('',this.t('全部','All'),selected):'')+
  Object.keys(this.kinds).map(key=>this.option(key,this.type(key),selected)).join('');},
 creationFields(includeType){
  const t=this.t;
  return (includeType?'<label class="wms-field">'+t('盘点类型','Stocktake Type')+'<select name="task_type">'+this.types('MONTHLY',false)+'</select></label>':'')+
   '<label class="wms-field">'+t('盘点时期','Stocktake Period')+'<select name="period_month"></select></label>';
 },
 bindCreation(form){
  const type=form.elements.task_type,period=form.elements.period_month,t=this.t,month=BusinessTime.today().slice(0,7);
  const fill=()=>{
   const kind=type.value,year=Number(month.slice(0,4)),months=kind==='ANNUAL'?['01']:kind==='SEMIANNUAL'?['01','07']:
    Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
   period.disabled=kind==='SPECIAL';period.required=!period.disabled;
   const values=period.disabled?[]:[year+1,year,year-1,year-2].flatMap(y=>months.map(m=>y+'-'+m)).reverse();
   period.innerHTML=this.option('',t('请选择','Select'),null)+values.map(value=>this.option(value,this.period(kind,value),null)).join('');
  };
  type.addEventListener('change',fill);fill();
 },
 async list(cobalt){
  const t=this.t,route='/stocktaking',signature=location.href+ProductContext.code,q=new URLSearchParams(location.search);
  const data=await API.request((cobalt?CobaltCount.base:'/v27/stocktakes')+'?'+q);
  if(signature!==location.href+ProductContext.code)return;
  const stateKey=cobalt?'status':'phase',states=cobalt?['OPEN','SUBMITTED','APPROVED','REJECTED','CANCELLED']:Object.keys(V27Counts.phases);
  const label=value=>cobalt?CobaltCount.status(value):I18n.translate(V27Counts.phases[value]||value);
  const input=(key,z,e,kind)=>'<label>'+t(z,e)+'<input name="'+key+'" type="'+kind+'" maxlength="160" value="'+esc(q.get(key)||'')+'"></label>';
  const columns=[['单据编号','Document No.'],['盘点类型','Stocktake Type'],['盘点基准时间','Baseline Time'],['盘点时期','Stocktake Period'],['创建日期','Created Date'],['状态','Status']];
  const rows=data.items.map(row=>'<tr><td><a href="'+route+'/'+row.id+'">'+esc(row.code)+'</a></td><td>'+this.type(row.task_type)+'</td><td>'+
   esc(BusinessTime.display(row.baseline_at))+'</td><td>'+esc(this.period(row.task_type,row.period_month))+'</td><td>'+
   esc(row.created_at?BusinessTime.input(row.created_at).slice(0,10):'—')+'</td><td>'+UI.status(row[stateKey],'count',label(row[stateKey]))+'</td></tr>');
  Router.page(t('库存盘点','Stocktaking'),'<section class="wms-page" data-page-composed data-no-i18n><div class="business-toolbar">'+
   (CurrentUser.permissions.includes('stocktake:write')?'<a class="button primary" href="'+route+'/new">'+t('新建盘点任务','New Stocktake')+'</a>':'')+
   '</div><form id="stocktake-list-filter" class="filters wms-filter-row">'+input('document_no','单据编号','Document No.','search')+
   '<label>'+t('盘点类型','Stocktake Type')+'<select name="task_type">'+this.types(q.get('task_type'))+'</select></label>'+
   '<label>'+t('盘点时期','Stocktake Period')+'<select name="period"></select></label>'+input('created_date','创建日期','Created Date','date')+
   '<label>'+t('状态','Status')+'<select name="'+stateKey+'">'+this.option('',t('全部','All'),null)+states.map(value=>this.option(value,label(value),q.get(stateKey))).join('')+'</select></label>'+
   '<div class="wms-filter-actions"><button class="button primary">'+t('查询','Search')+'</button><a class="button secondary" data-wms-reset href="'+route+'">'+t('重置','Reset')+'</a></div></form>'+
   ExportLicenses.table(columns,rows,'stocktake-list-table',true,{center:[2,3,4,5]})+CobaltStockUI.pager(data.page,data.total,data.page_size)+'</section>');
  const form=$('stocktake-list-filter'),type=form.elements.task_type,period=form.elements.period;
  const fill=(selected='')=>{
   period.disabled=!type.value||type.value==='SPECIAL';
   const options=period.disabled?[]:data.periods.filter(option=>option.task_type===type.value);
   const unique=new Map(options.map(option=>[option.period_month,this.period(option.task_type,option.period_month)]));
   period.innerHTML=this.option('',t('全部','All'),selected)+[...unique].map(([value,label])=>this.option(value,label,selected)).join('');
  };
  fill(q.get('period'));type.onchange=()=>fill();
  form.onsubmit=e=>{e.preventDefault();Router.go(route+'?'+new URLSearchParams([...new FormData(form)].filter(([,value])=>value)));};
  CobaltStockUI.bindPager(data);ProductContext.dirty=false;
 }
};
