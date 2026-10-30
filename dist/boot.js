'use strict';
(async()=>{
 const el=id=>document.getElementById(id),load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=location.protocol==='file:'?src:'/'+src;s.onload=resolve;s.onerror=()=>reject(Error('资源加载失败：'+src));document.head.append(s);});
 const demo=location.protocol==='file:'||location.pathname==='/demo';
 window.Connected=!demo;
 if(demo){document.getElementById('users-nav').hidden=true;await load('demo-data.js');await load('core.js');await load('app.js');return;}
 el('login-panel').hidden=false;document.querySelector('.workspace').setAttribute('inert','');document.querySelector('.sidebar').setAttribute('inert','');
 document.querySelector('.demo-label').textContent='正在连接 PostgreSQL';document.querySelector('.demo-banner strong').textContent='正在读取服务端环境';document.querySelector('.demo-banner div>span').textContent='连接失败将显示错误，不会切换至模拟库存。';
 let started=false;
 function signedOut(){window.AppSignedIn=false;el('login-panel').hidden=false;document.querySelector('.workspace').setAttribute('inert','');document.querySelector('.sidebar').setAttribute('inert','');el('login-error').textContent='登录已失效，请重新登录。';document.getElementById('rows').replaceChildren();document.getElementById('metrics').replaceChildren();}
 window.addEventListener('session-expired',signedOut);
 try{
 const cfg=await API.request('/config');window.AppConfig=cfg;
 el('login-safety-note').textContent=cfg.environment==='test'?'本机TEST环境 · 操作数据会持久保存':'业务环境 · 仅访问授权数据';el('login-environment').textContent=cfg.environment==='test'?'隔离测试环境 · PostgreSQL 数据库':'业务环境 · PostgreSQL 数据库';
 el('login-form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;el('login-error').textContent='';try{const r=await API.request('/auth/login',{method:'POST',body:{username:el('login-username').value,password:el('login-password').value}});API.csrfToken=r.csrfToken;el('login-password').value='';await enter();}catch(err){el('login-error').textContent=err.message;}finally{b.disabled=false;}};
 async function enter(){window.CurrentUser=await API.request('/me');if(!API.csrfToken)API.csrfToken=(await API.request('/auth/csrf',{method:'POST',body:{}})).csrfToken;
 if(window.I18n){I18n.protected.add(CurrentUser.display_name);I18n.set(CurrentUser.language_code||'zh-CN');}
 if(started){location.reload();return;}started=true;
 el('allocation-filter').hidden=false;window.AppSignedIn=true;el('login-panel').hidden=true;document.querySelector('.workspace').removeAttribute('inert');document.querySelector('.sidebar').removeAttribute('inert');
 el('role').closest('label').hidden=true;document.body.classList.add('database-mode');el('signed-user').hidden=false;el('signed-user').textContent=CurrentUser.display_name;el('audit-top').hidden=!CurrentUser.permissions.includes('audit:read');el('audit-top').onclick=()=>el('audit-nav').click();document.querySelector('table caption').textContent='数据库捆包明细，点击列标题排序';
 document.querySelector('.demo-label').textContent=cfg.environment==='test'?'TEST 隔离数据库':'业务数据库';
 document.querySelector('.avatar').textContent=CurrentUser.display_name.slice(0,1);
 document.querySelector('.demo-banner strong').textContent=cfg.environment==='test'?'隔离测试数据 · PostgreSQL':'业务数据 · PostgreSQL';
 document.querySelector('.demo-banner div>span').textContent=cfg.environment==='test'?'本机TEST数据库 · 业务记录持久保存，操作及审批均有审计。':'库存来自授权数据库；取样、检斤、装车、审批及离场通过服务端授权执行。';
 document.querySelector('.snapshot').textContent=CurrentUser.display_name;
 document.querySelector('.sidebar-bottom').textContent='数据库模式 · V2.6.2 · '+CurrentUser.display_name;
 document.querySelector('footer').lastElementChild.textContent=cfg.environment==='test'?'Product WMS · 本机TEST数据库':'授权业务数据';
 document.querySelector('#audit-nav span').textContent='操作日志';el('logout').hidden=false;
 el('logout').onclick=async()=>{try{await API.request('/auth/logout',{method:'POST',body:{}});location.reload();}catch(err){el('login-error').textContent=err.message;signedOut();}};
 await load('core.js');await load('app.js');await load('users.js');await load('business.js');await load('receipts-ui.js');await load('import-ui.js');await load('allocations-ui.js');await load('history-ui.js');await load('workflows.js');await load('controls.js');await load('dashboard.js');await load('labels-ui.js');await load('qr-decoder.js');await load('scanning-ui.js');await load('field-ui.js');await load('network-ui.js');await load('customers-ui.js');await load('stock-map.js');if(/^2\.6\./.test(cfg.version))await load('v26-ui.js');if(cfg.lotWorkV261)await load('v261-ui.js');if(cfg.lotWorkV262)await load('v262-ui.js');if(cfg.supplementV262)await load('v262-supplement.js');await load('router.js');await Router.init();if(cfg.supplementV262)await ReceiptAlerts.start();if(!CurrentUser.permissions.includes('users:manage'))document.getElementById('business-menu')?.remove();document.getElementById('users-nav').textContent='系统管理';document.getElementById('audit-nav').hidden=!CurrentUser.permissions.includes('audit:read');if(!CurrentUser.permissions.includes('allocation:read'))document.querySelector('.top-actions a[href="#field"]')?.remove();if('serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
 }
 // An existing HttpOnly session survives reload. The CSRF token is fetched only same-origin.
 try{await enter();}catch(err){if(!err.message.includes('登录')&&!err.message.includes('请先'))el('login-error').textContent=err.message;}
 }catch(err){el('login-environment').textContent='数据库模式连接失败';el('login-error').textContent=err.message;el('login-form').hidden=true;}
})().catch(e=>{document.getElementById('login-error').textContent=e.message;document.getElementById('login-panel').hidden=false;});
