'use strict';
// V4.6 presents the existing authorized forms and records. It never submits a
// business request, clones a business form, or substitutes demonstration data.
window.UI46={
 t:(z,e)=>window.I18n?.language==='en'?e:z,state:null,ready:false,queued:false,
 enabled(){return window.UIAppearance?.value==='modern';},
 copperMap(){return window.ProductContext?.isCopper()&&location.pathname==='/stock-map';},
 prepare(){
  const apply=UIAppearance.apply.bind(UIAppearance);UIAppearance.apply=(...args)=>{const r=apply(...args);this.appearance();return r;};
  this.appearance();this.login();
 },
 appearance(){document.documentElement.dataset.releaseUi=this.enabled()?'46':'';window.System46?.appearance();if(!this.enabled()){this.restore();window.UI46Pages?.chrome(false);}else this.queue();},
 login(){if(window.Login46){Login46.mount();return;}const panel=document.getElementById('login-panel');if(!panel||panel.querySelector('.ui46-login-intro'))return;
  const intro=document.createElement('div');intro.className='ui46-login-intro';intro.setAttribute('aria-hidden','true');intro.innerHTML='<img src="/assets/metorex-ruashi-logo.png" alt=""><div><span>RUASHI MINING · MUSONOI PROJECT</span><h2>'+this.t('让每一次流转<br>清晰可见。','Clarity in every<br>movement.')+'</h2><p>'+this.t('产品仓储管理系统','Product Warehouse Management')+'</p><div class="ui46-brand-flow"><b>'+this.t('计划','Plan')+'</b><i></i><b>'+this.t('入库','Receive')+'</b><i></i><b>'+this.t('备货','Prepare')+'</b><i></i><b>'+this.t('出库','Ship')+'</b></div></div><small>METOREX · '+this.t('穆松尼项目','Musonoi Project')+'</small>';panel.prepend(intro);
 },
 init(){if(this.ready)return;this.ready=true;window.UI46Pages?.init();window.System46?.init();window.Copper461?.init();window.Cobalt461?.init();window.Business461?.init();
  const show=Router.performShow.bind(Router);Router.performShow=async(...args)=>{this.restore();document.body.dataset.ui46Page=this.copperMap()?'copper-map':location.pathname.split('/')[1]||'overview';const r=await show(...args);this.enhance();return r;};
  const language=I18n.set.bind(I18n);I18n.set=(...args)=>{const r=language(...args);this.queue();return r;};
  const cobaltLanguage=CobaltUI.languageChanged.bind(CobaltUI);CobaltUI.languageChanged=async(...args)=>{this.restore();const r=await cobaltLanguage(...args);this.enhance();return r;};
  window.addEventListener('ui-appearance-changed',()=>this.appearance());
  window.addEventListener('session-expired',()=>{this.restore();document.body.removeAttribute('data-ui46-page');});
  document.addEventListener('input',e=>{if(this.state?.form?.contains(e.target))this.summary(this.state);});
  document.addEventListener('change',e=>{if(this.state?.form?.contains(e.target))this.summary(this.state);});
  this.observer=new MutationObserver(()=>this.queue());this.observe();this.enhance();
 },
 observe(){for(const id of ['page-content','dashboard-content','dialog-content']){const node=document.getElementById(id);if(node)this.observer?.observe(node,{childList:true,subtree:true});}},
 queue(){if(!this.ready||this.queued)return;this.queued=true;requestAnimationFrame(()=>{this.queued=false;if(!Router.rendering)this.enhance();});},
 signature(){return ProductContext.code+'|'+location.pathname+location.search+'|'+I18n.language;},
 move(node,parent,state=this.state){const marker=document.createComment('v46-original-position');node.before(marker);parent.append(node);state.moves.push({node,marker});},
 generated(tag,className,parent,state=this.state){const n=document.createElement(tag);n.className=className;n.dataset.ui46Generated='';parent.append(n);state.generated.push(n);return n;},
 restore(){const s=this.state;if(!s)return;s.root.querySelector('[data-nextsteps467]')?.remove();for(const n of s.root.querySelectorAll('.has-nextsteps467'))n.classList.remove('has-nextsteps467');window.Copper461?.restore(s);window.Cobalt461?.restore(s);window.Business461?.restore(s);window.System46?.restore(s);window.UI46Pages?.restore(s);this.observer?.disconnect();for(const {node,marker}of [...s.moves].reverse())if(marker.parentNode){if(node.isConnected)marker.replaceWith(node);else marker.remove();}for(const n of [...s.generated].reverse())if(n.isConnected)n.remove();for(const n of s.marked)n.classList.remove('ui46-card','ui46-table-card','ui46-filter','ui46-flow','ui46-summary-data');s.root?.classList.remove('ui46-content','ui46-structured');this.state=null;this.observe();},
 enhance(){if(!this.ready||!this.enabled()||!window.AppSignedIn){if(!this.enabled())this.restore();return;}
  this.observer?.disconnect();try{
   const excluded=this.copperMap();window.UI46Pages?.chrome(true);document.body.dataset.ui46Page=excluded?'copper-map':location.pathname.split('/')[1]||'overview';
   this.releaseLabels();if(excluded){if(this.state)this.restore();return;}
   const dashboard=document.getElementById('dashboard'),copperOverview=ProductContext.isCopper()&&location.pathname==='/overview'&&dashboard&&!dashboard.hidden,copperInventory=ProductContext.isCopper()&&location.pathname==='/inventory',root=document.getElementById(copperOverview?'dashboard-content':copperInventory?'inventory':'page-content');if(!root||root.closest('[hidden]'))return;
   if(root.querySelector('[data-ui468-owned]')){const owned=root.querySelector('[data-ui468-owned]');if(this.state?.anchor!==owned){if(this.state)this.restore();const state={root,signature:this.signature(),moves:[],generated:[],marked:[],anchor:owned,composition:{anchor:owned,family:'ui468',classes:[],hidden:[],watch:[owned]}};this.state=state;root.classList.add('ui46-content');root.dataset.pageFamily='ui468';}this.dialogs();return;}
   if(this.state&&this.state.root===root&&this.state.signature===this.signature()&&this.state.anchor?.isConnected&&(!window.Copper461?.matches(root)||this.state.composition?.family==='copper461')&&(!window.Cobalt461?.matches(root)||this.state.composition?.family==='cobalt461')&&(!window.UI46Pages||UI46Pages.valid(this.state))){if(window.Cobalt461?.matches(root)){Cobalt461.refresh(this.state);this.dialogs();return;}if(window.Copper461?.matches(root)){Copper461.refresh(this.state);this.dialogs();return;}this.summary(this.state);window.UI46Pages?.refresh(this.state);window.System46?.refresh(this.state);window.System46?.empty(root,this.state);this.dialogs();return;}
   if(this.state)this.restore();const s={root,signature:this.signature(),moves:[],generated:[],marked:[],form:null};this.state=s;root.classList.add('ui46-content');
   // The existing master/detail workbench already implements row selection,
   // scope-aware state cards, request sequencing and readonly previews.
   if(window.Cobalt461?.matches(root)){Cobalt461.compose(root,s);this.dialogs();return;}if(window.Copper461?.matches(root)){Copper461.compose(root,s);this.dialogs();return;}if(window.System46?.matches(root)){System46.compose(root,s);this.dialogs();return;}UI46Pages.compose(root,s);window.System46?.empty(root,s);this.dialogs();
  }finally{window.NextSteps467?.render(document.getElementById('page-content'));this.observe();requestAnimationFrame(()=>this.fitNavigation());}
 },
 fitNavigation(){if(!this.enabled()||innerWidth<=900)return;const nav=document.querySelector('.sidebar nav');if(!nav||!nav.clientHeight)return;const links=[...nav.children].filter(n=>n.matches('a')&&!n.hidden&&getComputedStyle(n).display!=='none'),gap=parseFloat(getComputedStyle(nav).rowGap)||0;if(!links.length)return;const row=Math.max(22,Math.min(35,Math.floor((nav.clientHeight-gap*(links.length-1))/links.length)));document.documentElement.style.setProperty('--ux10-nav-row',row+'px');},
 mark(node,cls,state=this.state){if(!node||node.classList.contains(cls))return;node.classList.add(cls);state.marked.push(node);},
 releaseLabels(){const label='V'+(window.AppConfig?.displayVersion||window.ClientRelease?.displayVersion||'4.6.3');for(const el of document.querySelectorAll('.system-version,.login-version [data-no-i18n]')){if(el.textContent.includes('4.6.0'))el.textContent=el.textContent.replaceAll('V4.6.0',label);}if(document.title.includes('V4.6.0'))document.title=document.title.replaceAll('V4.6.0',label);},
 card(parent,title,kind='',state=this.state){const n=this.generated('section','ui46-card '+kind,parent,state);if(title){const h=document.createElement('h2');h.className='ui46-section-title';h.textContent=title;n.append(h);}return n;},
 cards(root,s){for(const n of [...root.children]){if(n.matches('.ux10-workflow'))this.mark(n,'ui46-flow',s);else if(n.matches('form.filters,.filters,.co-stock-filter,.shipping-filters'))this.mark(n,'ui46-filter',s);else if(n.matches('.business-table,.account-table-scroll,.v34-table-wrap'))this.mark(n,'ui46-table-card',s);else if(n.matches('dl,.user-form,fieldset,.co-work-panel,.co-execution-panel,.co-stock-metrics,.co-count-panel'))this.mark(n,n.matches('dl')?'ui46-summary-data':'ui46-card',s);}for(const n of root.querySelectorAll('.co-sales-page,.co-report-page,.co-execution-page,.co-preparation-detail')){for(const child of n.children)if(child.matches('.business-table'))this.mark(child,'ui46-table-card',s);}},
 
 fieldLabel(el){const label=el.closest('label');if(!label)return el.getAttribute('aria-label')||el.name||'';const copy=label.cloneNode(true);copy.querySelectorAll('input,select,textarea,button').forEach(n=>n.remove());return copy.textContent.replace(/\s+/g,' ').trim();},
 summary(s){if(!s.form||!s.summary?.isConnected)return;const rows=[];for(const el of s.form.querySelectorAll('input:not([type=hidden]):not([type=password]):not([type=checkbox]):not([type=radio]),select,textarea')){const label=this.fieldLabel(el);if(!/项目|产品|客户|合同|月份|日期|批次|Lot|数量|净重|吨|重量|实物|仓库|车牌|Project|Product|Customer|Contract|Month|Date|Batch|Quantity|Weight|Warehouse|Truck|MT/i.test(label)&&!/^(target_weight|planned_metal_mt|total_bags)$/.test(el.name))continue;const value=el.tagName==='SELECT'?(el.value?el.selectedOptions[0]?.textContent:''):el.value;if(value?.trim())rows.push([label,value.trim()]);if(rows.length===6)break;}const signature=JSON.stringify(rows);if(s.summarySignature===signature)return;s.summarySignature=signature;s.summary.querySelector('dl,p')?.remove();if(!rows.length){s.summary.hidden=true;return;}s.summary.hidden=false;const dl=document.createElement('dl');dl.className='ui46-summary-list';for(const [label,value]of rows){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dd.dataset.noI18n='';row.append(dt,dd);dl.append(row);}s.summary.append(dl);},
 
 
 customerSections(root,s){const host=root.querySelector('.co-sales-page')||root,heads=[...host.children].filter(n=>n.matches('h2,h3')&&/客户|合同|Customer|Contract/i.test(n.textContent));if(heads.length<2){this.cards(root,s);return;}this.reportSections(host,s);},
 overviewLayout(root,s){const nodes=[...root.children],sections=nodes.filter(n=>n.matches('.v34-overview-section')),charts=nodes.find(n=>n.matches('.ui452-charts')),tasks=nodes.find(n=>n.matches('.v34-overview-split'));if(sections.length<2)return;
  const nav=this.generated('nav','ui46-report-tabs ui46-overview-tabs',root,s);root.prepend(nav);const titles=[this.t('库存概览','Stock Overview'),this.t('出库与装车','Outbound & Loading'),this.t('待办与预警','Tasks & Warnings')],panels=titles.map(()=>this.generated('section','ui46-overview-group',root,s));
  this.move(sections[0],panels[0],s);if(charts)this.move(charts,panels[0],s);for(const n of sections.slice(1))this.move(n,n.querySelector('table')?panels[0]:panels[1],s);if(tasks)this.move(tasks,panels[2],s);
  const choose=i=>{this.overviewSelection=i;panels.forEach((p,n)=>{p.hidden=n!==i;buttons[n].setAttribute('aria-selected',String(n===i));});},buttons=titles.map((title,i)=>{const b=document.createElement('button');b.type='button';b.textContent=title;b.onclick=()=>choose(i);nav.append(b);return b;});nav.setAttribute('role','tablist');buttons.forEach(b=>b.setAttribute('role','tab'));choose(Math.min(this.overviewSelection||0,2));
 },
 dialogs(){for(const d of document.querySelectorAll('dialog[open]'))d.dataset.ui46Dialog='true';window.System46?.dialogs();window.Copper461?.dialogs();window.Cobalt461?.dialogs();}
};
UI46.prepare();
