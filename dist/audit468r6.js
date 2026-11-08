'use strict';
// Presentation-only labels for native controls moved inside language-owned views.
window.Audit468R6={
 refresh(){
  const en=I18n.language==='en';
  for(const b of document.querySelectorAll('form[data-v34-reset] > button[type=button]'))if(/^(清除条件|Clear Filters)$/.test(b.textContent)){const label=en?'Clear Filters':'清除条件';if(b.textContent!==label)b.textContent=label;}
  const b=document.getElementById('account-registration-requests');if(b){const count=b.textContent.match(/ · \d+$/)?.[0]||'',label=(en?'Account Requests':'注册申请审批')+count;if(b.textContent!==label)b.textContent=label;}
 },
 init(){const chrome=UI463.chrome.bind(UI463);UI463.chrome=(...a)=>{const r=chrome(...a);this.refresh();return r;};const set=I18n.set.bind(I18n);I18n.set=(...a)=>{const r=set(...a);requestAnimationFrame(()=>this.refresh());return r;};this.refresh();}
};
Audit468R6.init();
