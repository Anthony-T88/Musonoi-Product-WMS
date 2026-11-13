'use strict';
window.ProductContext={code:'CU_CATHODE',ready:false,switching:false,dirty:false,
 isCopper(){return this.code==='CU_CATHODE';},
 cobaltPage(path){return !this.isCopper()&&(window.AppConfig?.cobaltMetalV471&&path==='/cobalt-metal'||window.AppConfig?.cobaltReportsV441&&path==='/reports'||window.AppConfig?.cobaltPackingV44&&/^\/outbounds\/[0-9a-f-]{36}\/packing-list$/.test(path)||window.AppConfig?.cobaltExecutionV43&&(/^\/loading-plans\/execution\/[0-9a-f-]{36}$/.test(path)||/^\/outbounds(?:\/[0-9a-f-]{36})?$/.test(path))||window.AppConfig?.cobaltLoadingV42&&/^\/loading-plans\/(?:query|new|orders\/[0-9a-f-]{36}|[0-9a-f-]{36}\/edit)$/.test(path)||window.AppConfig?.cobaltSalesV41&&/^\/(?:sales-plans(?:\/(?:new|[0-9a-f-]{36}(?:\/(?:edit|dispatch))?))?|customers|loading-plans)$/.test(path)||window.AppConfig?.cobaltStockV40&&/^\/(?:inventory(?:\/[0-9a-f-]{36}(?:\/archive)?)?|overview|stock-map)$/.test(path)||window.AppConfig?.cobaltV38&&/^\/preparation(?:\/(?:new|[0-9a-f-]{36}(?:\/work)?))?$/.test(path));},
 globalPage(path){return /^\/(?:workbench|historical-movements)(?:\/|$)/.test(path)||path==='/audit';},
 text(zh,en){return window.I18n?.language==='en'?en:zh;},
 async init(){
  this.key='musonoi-product:'+CurrentUser.id;
  let preferred='CU_CATHODE';try{preferred=localStorage.getItem(this.key)||preferred;}catch{preferred=(await API.request('/product-context')).productCode;}
  if(!['CU_CATHODE','CO_HYDROXIDE'].includes(preferred))preferred='CU_CATHODE';
  const r=await API.request('/product-context',{method:'POST',body:{productCode:preferred}});this.code=r.productCode;this.ready=true;
  document.documentElement.dataset.product=this.code;
  // A different tab must not continue showing or operating its old context.
  window.addEventListener('storage',async e=>{if(e.key!==this.key||e.newValue===this.code)return;document.querySelector('.workspace').setAttribute('inert','');document.querySelector('.workspace').hidden=true;
   if(this.dirty){const accepted=await OperationConfirm.ask({title:this.text('产品已在其他页面切换','Product Changed in Another Tab'),note:this.text('当前有未保存修改。确认后放弃修改并载入新产品；取消可保留本页，业务操作暂时锁定。','There are unsaved changes. Confirm to discard them and load the new product; cancel to keep this page with business operations locked.')});if(!accepted){document.querySelector('.workspace').hidden=false;return;}}
   location.replace(location.pathname.split('/').slice(0,2).join('/')||'/overview');});
  // Capture edits, including non-form grids, file imports, contenteditable and modal forms.
  const edited=e=>{if(e.target.closest('#page-content,#dialog-content,#dashboard,#inventory')&&!e.target.closest('#filter-form,#dashboard-form,.filters,[data-product-switch],[data-work-view]'))this.dirty=true;};
  document.addEventListener('input',edited,true);document.addEventListener('change',edited,true);
  document.addEventListener('click',e=>{const button=e.target.closest('button');if(button?.closest('#page-content form,#dialog-content form')&&!button.closest('.filters,[data-work-view]'))this.dirty=true;},true);
 },
 mount(){
  const box=document.createElement('div');box.className='product-switch';box.dataset.noI18n='';box.setAttribute('role','group');
  box.setAttribute('aria-label',this.text('产品切换','Switch Product'));
  for(const [code,zh,en] of [['CU_CATHODE','阴极铜','Copper Cathodes'],['CO_HYDROXIDE','氢氧化钴','Cobalt Hydroxide']]){const b=document.createElement('button');b.type='button';b.dataset.productSwitch=code;b.textContent=this.text(zh,en);b.setAttribute('aria-pressed',String(code===this.code));b.onclick=()=>this.switchTo(code);box.append(b);}
  const narrow=matchMedia('(max-width: 900px)'),sidebar=document.querySelector('.sidebar');
  const place=()=>{const menu=narrow.matches&&document.querySelector('.mobile-nav-shell');(menu||sidebar).append(box);};
  place();narrow.addEventListener('change',place);
  const sharedDocument=()=>/^\/(?:export-licenses|preparation\/work-plans)(?:\/|$)/.test(location.pathname)||
   ['/stocktaking','/stock-map'].includes(location.pathname)||
   /^\/(?:preparation|receipts)\/new$/.test(location.pathname)&&!!document.getElementById('executable-preparation-filter');
  const editing=()=>this.dirty||document.querySelector('#dialog[open] form');
  const changeLanguage=I18n.change.bind(I18n);
  I18n.change=async language=>{
   if(language===I18n.language)return;
   if(sharedDocument()&&editing()){
    const discard=await OperationConfirm.ask({
     title:this.text('切换语言','Switch Language'),
     note:this.text('切换语言会放弃未保存的填写内容。','Switching languages will discard your unsaved entries.')
    });
    if(!discard){
     document.querySelectorAll('[data-language]').forEach(select=>{select.value=I18n.language;});
     return;
    }
    if(document.querySelector('#dialog[open] form'))document.getElementById('dialog').close();
    this.dirty=false;
   }
   return changeLanguage(language);
  };
  const originalSet=I18n.set.bind(I18n);
  I18n.set=language=>{
   const changed=language!==I18n.language;
   originalSet(language);
   box.setAttribute('aria-label',this.text('产品切换','Switch Product'));
   const names=this.text(['阴极铜','氢氧化钴'],['Copper Cathodes','Cobalt Hydroxide']);
   [...box.children].forEach((button,index)=>{button.textContent=names[index];});
   if(sharedDocument()){
    if(changed&&!editing())Router.show();
   }else if(window.HistoricalMovements?.documentRoute(location.pathname)){
    // HistoricalMovements refreshes its own translated document without calling the live cobalt router.
   }else if(!this.isCopper()&&!this.globalPage(location.pathname)){
    if(location.pathname==='/cobalt-metal'&&this.cobaltPage(location.pathname))Router.show();
    else if(this.cobaltPage(location.pathname))CobaltUI.languageChanged().catch(error=>notify(CobaltUI.error(error)));
    else this.placeholder();
   }
  };
 },
 placeholder(){
  Router.page(this.text('氢氧化钴','Cobalt Hydroxide'),'<div class="product-construction" data-no-i18n role="status"><h2>'+this.text('当前产品无此页面','Page unavailable for this product')+'</h2></div>');
 },
 async switchTo(code){
  if(this.switching||code===this.code)return;this.switching=true;
  try{
   if([...API.operations.values()].some(o=>o.user_id===CurrentUser.id&&['SUBMITTING','UNKNOWN'].includes(o.state))){alert(this.text('存在提交中或结果未知的操作，请先确认操作结果再切换产品。','Resolve pending or unknown submissions before switching products.'));return;}
   if(this.dirty||document.querySelector('#dialog[open] form')){
    const accepted=await OperationConfirm.ask({title:this.text('切换产品','Switch Product'),note:this.text('存在未保存的数据，切换将放弃当前修改。是否继续？','Unsaved changes will be discarded. Continue switching products?')});if(!accepted)return;
   }
   // A submission may have started while the confirmation dialog was open.
   if([...API.operations.values()].some(o=>o.user_id===CurrentUser.id&&['SUBMITTING','UNKNOWN'].includes(o.state))){alert(this.text('存在提交中或结果未知的操作，请先确认操作结果再切换产品。','Resolve pending or unknown submissions before switching products.'));return;}
   await API.request('/product-context',{method:'POST',body:{productCode:code}});
   try{localStorage.setItem(this.key,code);}catch{}
   // Full reload destroys records, forms, selected IDs, closures and in-flight callbacks.
   // Keep only the menu section, never a detail ID, filters or query parameters.
   const path=location.pathname,q=new URLSearchParams(location.search),gateView=window.AppConfig?.gatePermits&&path==='/outbounds'&&['departures','printers'].includes(q.get('view'))?'?view='+q.get('view'):'',target=this.globalPage(path)?path:path==='/cobalt-metal'?'/overview':'/'+(path.split('/')[1]||'overview')+gateView;
   document.querySelector('.workspace').setAttribute('inert','');document.querySelector('.workspace').hidden=true;
   location.replace(target);
  }catch(e){alert(e.message);}finally{this.switching=false;}
 }
};
