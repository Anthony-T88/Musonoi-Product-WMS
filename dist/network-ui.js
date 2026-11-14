'use strict';
const Network={stale:false,init(){const pill=document.createElement('span');pill.className='network-pill';pill.id='network-status';pill.setAttribute('role','status');pill.setAttribute('aria-live','polite');pill.setAttribute('aria-atomic','true');document.querySelector('.top-actions').append(pill);const warning=document.createElement('section');warning.className='stock-freshness-warning';warning.id='stock-freshness-warning';warning.hidden=true;warning.setAttribute('role','status');warning.innerHTML='<span>连接中断后，页面已显示数据仅供参考，不是实时库存。</span><button id="refresh-live-stock" class="button secondary">重新联网查询库存</button>';document.querySelector('.topbar').after(warning);$('refresh-live-stock').onclick=async e=>{e.target.disabled=true;try{if(window.ProductContext&&!ProductContext.isCopper()){if(ProductContext.dirty){notify(I18n.language==='en'?'Save or cancel unsaved changes before refreshing.':'请先保存或取消未保存的修改，再重新查询。');return;}await API.request('/cobalt/stock/summary');await Router.show();if([...document.querySelectorAll('#page-content .error')].some(n=>n.textContent.trim()&&n.getClientRects().length)){notify(I18n.language==='en'?'Live data could not be refreshed.':'未联网查询到实时库存');return;}this.stale=false;update();return;}if(location.pathname==='/stock-map'){await StockMap.open();this.stale=false;update();return;}await render();await Dashboard.refresh();if(serviceReady&&Dashboard.snapshot){this.stale=false;update();}else notify('未联网查询到实时库存');}catch(e){notify(e.message);}finally{e.target.disabled=false;}};const panel=document.createElement('section');panel.className='operation-panel';panel.hidden=true;panel.id='operation-panel';panel.setAttribute('aria-live','polite');document.body.append(panel);const update=()=>this.update();window.addEventListener('online',update);window.addEventListener('offline',()=>{this.stale=true;update();});window.addEventListener('stock-stale',()=>{this.stale=true;update();});window.addEventListener('server-response',update);window.addEventListener('operation-state',()=>this.render());window.addEventListener('session-expired',()=>{panel.hidden=true;});API.restoreReceipts();update();},update(){const pill=$('network-status'),warning=$('stock-freshness-warning');if(!pill)return;const state=!navigator.onLine?'offline':this.stale?'disconnected':API.lastServerResponse?'online':'connecting',en=I18n.language==='en',labels={online:['在线','Online'],offline:['离线','Offline'],disconnected:['连接中断','Connection Lost'],connecting:['连接中','Connecting']},hints={online:['已连接服务器。','Connected to the server.'],offline:['设备已离线，请恢复网络后重新查询库存。','Device is offline. Reconnect and refresh stock.'],disconnected:['连接中断，已显示库存可能过时，请重新联网查询。','Connection was interrupted. Displayed stock may be stale; refresh after reconnecting.'],connecting:['正在连接服务器。','Connecting to the server.']};pill.dataset.connectionState=state;pill.dataset.noI18n='';pill.textContent=labels[state][en?1:0];pill.title=hints[state][en?1:0];pill.setAttribute('aria-label',pill.textContent+' · '+pill.title);pill.classList.toggle('error',state==='offline'||state==='disconnected');if(warning)warning.hidden=!this.stale;document.body.classList.toggle('stock-stale',this.stale);this.render();},render(){
 const panel=$('operation-panel');if(!panel||!window.AppSignedIn)return;
 const inline=panel.classList.contains('s46-inline-operations'),t=(zh,en)=>I18n.language==='en'?en:zh;
 const rows=[...API.operations.values()].filter(o=>o.user_id===CurrentUser.id&&o.product_code===ProductContext.code&&
  (o.state==='UNKNOWN'||inline&&o.state==='SUBMITTING')&&(inline||!o.dismissed));
 panel.hidden=!rows.length;panel.replaceChildren();
 for(const o of (inline?rows:rows.slice(-3))){
  const row=document.createElement('div'),text=document.createElement('p');
  text.textContent=o.state==='UNKNOWN'?t('提交结果待确认','Submission result pending') : t('正在提交','Submitting');
  row.append(text);
  if(o.state==='UNKNOWN'){
   const actions=document.createElement('div');actions.className='business-toolbar';
   const button=(label,run)=>{const b=document.createElement('button');b.type='button';b.className='button secondary compact';b.textContent=label;
    b.onclick=async()=>{b.disabled=true;try{await run();}catch(e){notify(I18n.translate(e.message,true));}finally{b.disabled=false;}};actions.append(b);};
   button(t('查询结果','Check Result'),async()=>{
    const r=await API.check(o.key);
    notify(r.committed?t('服务器已确认提交','The server confirmed the submission'):t('暂未查到提交记录，请稍后再查','No submission record found yet. Check again later.'));
    if(r.committed)await Router.show();
   });
   if(o.options)button(t('用原请求重试','Retry Original Request'),async()=>{
    await API.retry(o.key);notify(t('服务器已确认提交','The server confirmed the submission'));await Router.show();
   });
   if(!inline)button(t('关闭','Close'),()=>{o.dismissed=true;API.saveReceipts();});
   const hint=document.createElement('small');
   hint.textContent=t('请先核对结果，避免重复提交。关闭提示后仍可在传输与网络诊断中查询。','Check the result to avoid duplicate submissions. Dismissed results remain available in Transfer & Network Diagnostics.');
   row.append(actions,hint);
  }
  panel.append(row);
 }
}};Network.init();
