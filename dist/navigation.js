'use strict';
// Authoritative product navigation. Layout helpers and older business adapters
// delegate here; they do not decide product menu names or visibility.
window.UnifiedNavigation={
 t:(z,e)=>I18n.language==='en'?e:z,
 taskCounts:new Map(),
 setTasks(items){
  this.taskCounts.clear();
  this.taskCounts.set('overview',items.length);
  for(const task of items){
   const [path,query]=task.href?.split('?')||[];
   let key=path?.split('/')[1];
   if(!key||key==='overview')continue;
   if(key==='outbounds'&&new URLSearchParams(query).get('view')==='departures')key='vehicle-departures';
   if(key==='preparation'&&!ProductContext.isCopper())key='receipts';
   this.taskCounts.set(key,(this.taskCounts.get(key)||0)+1);
  }
  this.refresh();
 },
 entries(){const co=!ProductContext.isCopper();return [
 ['overview','信息总览','Overview','dashboard:read','◫'],['inventory','库存查询','Stock','inventory:read','▦'],['stock-map','库存地图','Stock Map','inventory:read','▧'],['reports','统计报表','Reports','report:read','▤'],...(co&&window.AppConfig?.cobaltMetalV471?[['cobalt-metal','钴金属量管理','Cobalt Metal Management',CurrentUser.permissions.includes('co:read')?'co:read':'outbound:read','◈']]:[]),['customers','客户档案管理','Customers','customer:read','▤'],['sales-plans','销售计划管理','Sales Plans','plan:read','▤'],['export-licenses','出口许可证管理','Export Licenses','loading-plan:read','▤'],
 ['receipts',co?'入库与备货管理':'入库管理',co?'Receipts & Preparation':'Receipts',co?'co:read':'receipt:read','↙'],...(!co?[['preparation','备货管理','Preparation','allocation:read','▣']]:[]),['loading-plans','装车计划管理','Loading Plan Management',co?'vehicle-arrival:read':'loading-plan:read','▣'],['outbounds','装车出库管理','Loading & Outbound','load:read','↗'],['vehicle-departures','车辆出厂管理','Gate Exit Management','gate:read','↗'],['stocktaking','库存盘点','Stocktake','stocktake:read','▤']];},
 refresh(){if(!window.CurrentUser||!window.ProductContext?.ready)return;const entries=this.entries().filter(e=>CurrentUser.permissions.includes(e[3])),expected=entries.map(e=>e[0]).join('|'),current=new URL(location.href),co=!ProductContext.isCopper();
  for(const nav of document.querySelectorAll('.sidebar nav,.mobile-primary')){const actual=[...nav.querySelectorAll('[data-primary-route]')].map(a=>a.dataset.primaryRoute).join('|');if(expected!==actual){for(const a of nav.querySelectorAll('[data-primary-route]'))a.remove();for(const [key,,,permission,icon]of entries){const a=document.createElement('a');a.dataset.primaryRoute=key;a.dataset.permission=permission;a.href=key==='vehicle-departures'?'/outbounds?view=departures':'/'+key;a.innerHTML='<span aria-hidden="true">'+icon+'</span><span class="ux-nav-label" data-no-i18n></span>';nav.append(a);}}
   for(const [key,z,en]of entries){const a=nav.querySelector('[data-primary-route="'+key+'"]'),label=this.t(z,en),gate=current.pathname==='/outbounds'&&['departures','printers'].includes(current.searchParams.get('view')),active=key==='vehicle-departures'?gate:key==='outbounds'?current.pathname.startsWith('/outbounds')&&!gate:co&&key==='receipts'?/^\/(receipts|preparation)(\/|$)/.test(current.pathname):current.pathname==='/'+key||current.pathname.startsWith('/'+key+'/');const display=I18n.language==='en'&&nav.classList.contains('mobile-primary')?key==='receipts'&&co?'Receipt & Prep':key==='loading-plans'?'Loading Plans':label:label;const span=a.querySelector('.ux-nav-label');if(span.textContent!==display)span.textContent=display;if(a.title!==label)a.title=label;const count=this.taskCounts.get(key)||0,accessible=count?label+' · '+count+' '+this.t('项待办','pending tasks'):label;let badge=a.querySelector('.ux-nav-count');if(count){if(!badge){badge=document.createElement('strong');badge.className='ux-nav-count';badge.dataset.noI18n='';badge.setAttribute('aria-hidden','true');a.append(badge);}if(badge.textContent!==String(count))badge.textContent=String(count);}else badge?.remove();if(a.getAttribute('aria-label')!==accessible)a.setAttribute('aria-label',accessible);a.classList.toggle('nav-active',active);if(active){a.setAttribute('aria-current','page');const crumb=document.querySelector('.breadcrumb strong');if(crumb&&crumb.textContent!==label)crumb.textContent=label;}else a.removeAttribute('aria-current');}}
  const mobileTitle=document.querySelector('.mobile-nav-shell > summary');if(mobileTitle)mobileTitle.textContent=this.t('业务导航','Business navigation');
  AdaptiveLayout.refresh();
 },
 title(){const title=$('business-title');if(title&&!$('business-page')?.hidden)document.title=title.textContent+' · 产品仓储管理系统 · V'+AppConfig.version;}
};
window.ProductRoutes={
 managed(path){return !ProductContext.isCopper()&&(path==='/receipts'||/^\/receipts\/[0-9a-f-]{36}\/work$/.test(path)||/^\/stocktaking(?:\/(?:new|[0-9a-f-]{36}))?$/.test(path));},
 async render(path){if(path==='/receipts')return CobaltIntake.list();if(/\/work$/.test(path))return CobaltWorkUI.open(path.split('/')[2]);if(path==='/stocktaking')return CobaltCount.list();if(path==='/stocktaking/new')return CobaltCount.create();return CobaltCount.detail(path.split('/')[2]);}
};
const policyShow=Router.performShow.bind(Router);Router.performShow=async function(...args){let path=location.pathname;if(!ProductContext.isCopper()&&/^\/preparation(?:\/(?:new|[0-9a-f-]{36}(?:\/work)?))?$/.test(path)){path=path.replace('/preparation','/receipts');history.replaceState({},'',path+location.search);}
 if(!ProductContext.isCopper()&&/^\/receipts\/[0-9a-f-]{36}\/work$/.test(path)){path=path.slice(0,-5);history.replaceState({},'',path+location.search+location.hash);}
 if(!ProductRoutes.managed(path)){const result=await policyShow(...args);UnifiedNavigation.refresh();UnifiedNavigation.title();return result;}
 this.current=path;this.rendering=true;try{const permission=path.startsWith('/stocktaking')?(path.endsWith('/new')?'stocktake:write':'stocktake:read'):'co:read';if(!CurrentUser.permissions.includes(permission))throw Error(UnifiedNavigation.t('当前账号没有此页面权限','This account has no permission for this page'));await ProductRoutes.render(path);I18n.apply();BusinessWorkflow.mount();UnifiedNavigation.refresh();UnifiedNavigation.title();}catch(e){this.page(UnifiedNavigation.t('页面暂不可用','Page Unavailable'),'<p class="error" role="alert">'+esc(CobaltCount.error(e))+'</p>');}finally{this.rendering=false;AdaptiveLayout.queue();}
};
const policyPage=ProductContext.cobaltPage.bind(ProductContext);ProductContext.cobaltPage=p=>!ProductContext.isCopper()&&(/\/receipts\/[0-9a-f-]{36}\/work$/.test(p)||/^\/stocktaking(?:\/(?:new|[0-9a-f-]{36}))?$/.test(p))||policyPage(p);
const policyLanguage=CobaltUI.languageChanged.bind(CobaltUI);CobaltUI.languageChanged=()=>ProductRoutes.managed(location.pathname)?/\/work$/.test(location.pathname)?CobaltWorkUI.open(location.pathname.split('/')[2],{preserve:true}):CobaltCount.isEditing()?CobaltCount.language():Router.show():policyLanguage();
for(const object of [ProductPolish,ShippingOverview,CobaltSalesUI,window.GateUI].filter(Boolean))if(typeof object.nav==='function')object.nav=()=>UnifiedNavigation.refresh();
const policyInit=Router.init.bind(Router);Router.init=async function(...args){const r=await policyInit(...args);UnifiedNavigation.refresh();UnifiedNavigation.title();return r;};
