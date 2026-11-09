'use strict';
window.PageLayout={
 rows:new Map(),draft:null,requestId:0,saving:false,
 t:(zh,en)=>I18n.language==='en'?en:zh,
 scope(){const route=location.pathname.toLowerCase().replace(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g,':id').replace(/^\/inventory\/.+/,'/inventory/:id');return (ProductContext.isCopper()?'cu:':'co:')+(route==='/'?'/overview':route);},
 apply(){
  const page=this.scope(),global=this.rows.get('global')?.settings,pageSettings=this.rows.get(page)?.settings;
  const settings={...global,...pageSettings};
  if(this.draft){
   const {scope,settings:preview}=this.draft;
   if(scope===page)Object.assign(settings,{...global},Object.fromEntries(this.keys.map(key=>[key,preview[key]??global?.[key]])));
   else if(scope==='global')Object.assign(settings,Object.fromEntries(this.keys.map(key=>[key,pageSettings?.[key]??preview[key]])));
  }
  for(const key of this.keys){
   const attribute='data-layout-'+key;
   if(settings[key])document.documentElement.setAttribute(attribute,settings[key]);
   else document.documentElement.removeAttribute(attribute);
  }
  window.OverviewDesigner?.apply();window.PageTextDesigner?.schedule();
 },
 async refresh(){
  if(!window.AppSignedIn)return;
  const id=++this.requestId;
  try{const d=await API.request('/page-layout');if(id!==this.requestId||!window.AppSignedIn)return;this.rows=new Map(d.items.map(row=>[row.scope,row]));this.apply();}
  catch(e){if(this.dialog?.open)this.error.textContent=e.message;}
 },
 fields(){
  const t=this.t,align=[['center',t('居中','Centered')],['left',t('靠左','Left aligned')]];
  return [
   ['title',t('页面主标题','Page Title'),align],['section',t('区块标题','Section Titles'),align],
   ['table',t('表格标题和数据','Table Headings and Cells'),align],
   ['density',t('页面留白','Page Spacing'),[['standard',t('标准','Standard')],['compact',t('紧凑','Compact')],['roomy',t('宽松','Roomy')]]],
   ['charts',t('总览图表布局','Overview Charts'),[['side',t('并排','Side by Side')],['stack',t('上下排列','Stacked')]]]
  ];
 },
 selectScope(scope){
  const row=this.rows.get(scope);
  this.draft={scope,version:row?.version||0,settings:{...row?.settings}};
  const t=this.t;
  this.form.querySelector('[data-layout-fields]').innerHTML=this.fields().map(([key,label,options])=>'<label>'+label+'<select name="'+key+'"><option value="">'+t(scope==='global'?'系统默认':'跟随全系统',scope==='global'?'System Default':'Follow System')+'</option>'+options.map(([value,name])=>'<option value="'+value+'">'+name+'</option>').join('')+'</select></label>').join('');
  for(const key of this.keys)this.form.elements[key].value=this.draft.settings[key]||'';
  this.error.textContent='';
  this.apply();
 },
 async open(){
  await this.refresh();
  if(this.dialog.open||!window.AppSignedIn)return;
  if(window.OverviewDesigner?.dialog?.open)OverviewDesigner.dialog.close();
  this.page=this.scope();
  this.form.elements.scope.value='page';
  this.selectScope(this.page);
  this.dialog.show();
 },
 init(){
  this.keys=this.fields().map(([key])=>key);
  const t=this.t;
  const admin=CurrentUser.role_code==='admin'&&CurrentUser.permissions.includes('system:manage');
  if(admin){
   const trigger=document.createElement('button');trigger.id='page-layout-open';trigger.type='button';trigger.className='button secondary';trigger.textContent=t('编辑排版','Edit Layout');
   document.querySelector('.top-actions').append(trigger);
   const dialog=document.createElement('dialog');dialog.id='page-layout-editor';dialog.setAttribute('aria-labelledby','page-layout-title');dialog.dataset.noI18n='';
   dialog.innerHTML='<form><header><h2 id="page-layout-title">'+t('页面排版编辑器','Page Layout Editor')+'</h2><button type="button" data-layout-close aria-label="'+t('关闭','Close')+'">×</button></header><p>'+t('更改会实时预览，发布后对所有账号生效。','Changes preview live and apply to all accounts after publishing.')+'</p><label>'+t('应用范围','Scope')+'<select name="scope"><option value="page">'+t('当前页面','Current Page')+'</option><option value="global">'+t('全系统','All Pages')+'</option></select></label><div data-layout-fields></div><p class="error" role="alert" data-layout-error></p><footer><button type="button" data-layout-reset>'+t('恢复默认','Reset Defaults')+'</button><button type="submit" class="button primary">'+t('发布给所有账号','Publish to All Accounts')+'</button></footer></form>';
   document.body.append(dialog);this.dialog=dialog;this.form=dialog.querySelector('form');this.error=dialog.querySelector('[data-layout-error]');
   trigger.onclick=()=>this.open();
   dialog.querySelector('[data-layout-close]').onclick=()=>dialog.close();
   dialog.addEventListener('close',()=>{this.draft=null;this.apply();});
   dialog.querySelector('[data-layout-reset]').onclick=()=>{if(this.saving)return;for(const key of this.keys)delete this.draft.settings[key];for(const key of this.keys)this.form.elements[key].value='';this.apply();};
   this.form.onchange=e=>{
    if(this.saving)return;
    const {name,value}=e.target;
    if(name==='scope'){this.selectScope(value==='global'?'global':this.page);return;}
    if(!this.keys.includes(name))return;
    if(value)this.draft.settings[name]=value;else delete this.draft.settings[name];
    this.apply();
   };
   this.form.onsubmit=async e=>{
    e.preventDefault();if(this.saving||!this.draft)return;
    this.saving=true;for(const field of this.form.elements)field.disabled=true;
    this.error.textContent='';
    try{
     const signature=JSON.stringify(this.draft);
     if(this.saveSignature!==signature){this.saveSignature=signature;this.saveKey=crypto.randomUUID();}
     const row=await API.request('/page-layout',{method:'PATCH',body:this.draft,idempotencyKey:this.saveKey});
     this.requestId++;this.rows.set(row.scope,row);this.draft=null;this.apply();dialog.close();
    }catch(err){this.error.textContent=err.message;}
    finally{this.saving=false;for(const field of this.form.elements)field.disabled=false;}
   };
  }
  const show=Router.performShow.bind(Router);
  Router.performShow=async(...args)=>{
   if(this.dialog?.open&&this.page!==this.scope())this.dialog.close();
   const designer=window.OverviewDesigner;if(designer?.dialog?.open&&(!designer.active()||designer.draft?.scope!==this.scope()))designer.dialog.close();
   this.apply();
   try{return await show(...args);}finally{this.apply();}
  };
  window.addEventListener('focus',()=>this.refresh());
  setInterval(()=>{if(!document.hidden)this.refresh();},30000);
  window.addEventListener('session-expired',()=>{this.requestId++;this.rows.clear();this.dialog?.close();window.OverviewDesigner?.dialog?.close();this.draft=null;this.apply();});
  this.apply();
  return this.refresh();
 }
};
