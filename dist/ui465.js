'use strict';
window.UI465={
 ready:false,
 canonical(value){const u=new URL(value,location.origin);if(u.origin!==location.origin)return value;const co=!ProductContext.isCopper(),q=u.searchParams;let p=u.pathname;
  if((p==='/'||p==='/overview')&&!q.has('management')&&!CurrentUser.permissions.includes('dashboard:read')){const entry=UnifiedNavigation.entries().find(e=>CurrentUser.permissions.includes(e[3]));if(entry){p=entry[0]==='vehicle-departures'?'/outbounds':'/'+entry[0];if(entry[0]==='vehicle-departures')q.set('view','departures');}else{p='/overview';q.set('management','todos');}}
  q.delete('ui');if(q.get('view')==='hierarchy')q.delete('view');
  if(p==='/workbench/design')p='/workbench';
  if(/^\/preparation\/plans(?:\/|$)/.test(p))p=p.replace('/preparation/plans','/sales-plans');
  if(co&&/^\/preparation(?:\/|$)/.test(p)&&!/^\/preparation\/work-plans(?:\/|$)/.test(p))p=p.replace('/preparation','/receipts');
  if(co&&/^\/outbounds\/loads\/[0-9a-f-]{36}$/.test(p))p=p.replace('/loads/','/');
  if(co&&/^\/loading-plans\/execution\/[0-9a-f-]{36}$/.test(p))p=p.replace('/loading-plans/execution/','/outbounds/');
  if(co&&/^\/inventory\/[0-9a-f-]{36}\/history$/.test(p)){p=p.replace(/\/history$/,'');u.hash='#co-position-history';}
  if(co&&/^\/sales-plans\/[0-9a-f-]{36}\/shipping$/.test(p))p=p.replace(/\/shipping$/,'');
  if(p==='/export-shipments'){p='/outbounds';q.set('state','OUTBOUND');}
  if(p==='/outbounds/corrections'){p='/outbounds';}
  u.pathname=p;return u.pathname+(q.size?'?'+q:'')+u.hash;
 },
 install(){if(this.ready)return;this.ready=true;const go=Router.go.bind(Router);Router.go=(url,replace=false)=>go(this.canonical(url),replace);const show=Router.performShow.bind(Router);Router.performShow=async(...args)=>{const current=location.pathname+location.search+location.hash,next=this.canonical(current);if(current!==next)history.replaceState(history.state,'',next);const r=await show(...args);if(location.hash)requestAnimationFrame(()=>Router.scrollHash(location.hash));return r;};
  Router.add(/^\/sales-plans\/([0-9a-f-]{36})\/shipping$/,id=>ProductContext.isCopper()?Shipping.plan(id):Router.go('/sales-plans/'+id,true));
  window.CobaltMap465?.install();
 }
};
