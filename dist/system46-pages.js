'use strict';
Object.assign(System46,{
 page(zh,en,code,html){Router.page(this.t(zh,en),'<div hidden data-s46-title-zh="'+esc(zh)+'" data-s46-title-en="'+esc(en)+'" data-sys-code="'+code+'"></div>'+html);},
 block(zh,en,body,cls=''){return '<section class="s46-card '+cls+'"><h2 class="s46-card-title">'+this.L(zh,en)+'</h2>'+body+'</section>';},
 link(href,zh,en,primary=false){return '<a class="button '+(primary?'primary':'secondary')+'" href="'+esc(href)+'">'+this.L(zh,en)+'</a>';},
 badge(ok,zh,en){return '<span class="s46-badge '+(ok?'':'s46-badge-muted')+'">'+this.L(zh,en)+'</span>';},
 hub(){const tiles=[['users:manage','/workbench/accounts','SYS-02','账户管理','Account Management','员工账号、岗位与数据范围','Employee accounts, roles and data scopes'],['roles:manage','/workbench/permissions','SYS-04','角色权限管理','Role Permissions','角色、功能与分配范围集中维护','Maintain roles, permissions and assigned scopes'],['access-approvals',AccessApprovals.path,'SYS-17','权限变更审批','Access Change Approvals','复核岗位、权限和授权范围的变更','Review changes to roles, permissions and data scopes'],['audit:read','/audit','SYS-06','系统日志','System Audit','查询实际操作、执行结果与前后变更','Review operations, results and before/after changes'],['master:write','/customers/master-data','SYS-09','基础资料管理','Master Data','生产批次、仓库、堆场与货位','Production batches, warehouses, yards and locations'],['historical-admin','/workbench/historical-movements','SYS-11','历史出入库导入','Historical Stock Imports','批量导入装箱单并查看记录','Import packing lists in batches and view import records'],['system:manage','/workbench/diagnostics','SYS-10','传输与网络诊断','Transfer & Network Diagnostics','连接检查与原请求结果核实','Check connectivity and original request results']].filter(x=>x[0]==='historical-admin'?HistoricalMovements.canImport():x[0]==='access-approvals'?(this.can('access-change:approve')||AccessApprovals.canRequest()):this.can(x[0]));
  if(this.canManageReportMail())tiles.push(['system:manage','/workbench/report-mail','SYS-18','报表邮件','Report Email','维护定时发送和收件人','Manage delivery schedules and recipients']);
  this.page('系统管理','System Administration','SYS','<div class="s46-hub-grid">'+tiles.map(([,href,code,zh,en,sub,suben])=>'<a class="s46-card s46-hub-card" href="'+esc(href)+'"><h2>'+this.L(zh,en)+'</h2><p>'+this.L(sub,suben)+'</p><span class="s46-hub-arrow" aria-hidden="true">↗</span></a>').join('')+'</div>');
 },


 async reportMail(){
  const setting=await API.request('/system/report-mail');
  const transport=setting.transport,recipients=setting.recipientAccounts,unavailable=setting.unavailableRecipientAccounts||[];
  const reportLabels=[
   ['shipping','发运及单证','Shipments & Documents'],['movement','出入库流水','Inventory Movements'],
   ['balance','库存平衡','Inventory Balance'],['stocktake','盘点','Stock Counts'],['sales','销售统计','Sales']
  ];
  const products=[['CU_CATHODE','阴极铜','Copper Cathodes'],['CO_HYDROXIDE','氢氧化钴','Cobalt Hydroxide']];
  const L=this.L.bind(this),t=this.t.bind(this);
  const option=(value,label,current,english=label)=>'<option value="'+esc(value)+'" data-s46-zh="'+esc(label)+
   '" data-s46-en="'+esc(english)+'" data-no-i18n'+(current===value?' selected':'')+'>'+esc(t(label,english))+'</option>';
  const choose=current=>option('','请选择',current,'Select');
  const field=(zh,en,control)=>'<label class="wms-field">'+L(zh,en)+control+'</label>';
  const accountName=a=>a.displayName||a.username;
  const recipientLabel=a=>a.reason==='MISSING_EMAIL'?L('未登记邮箱','No registered email'):
   a.reason==='NOT_APPROVED'?L('邮箱不符合发送规则','Email outside delivery rules'):esc(a.email);
  const entry=(zh,en,value)=>'<div><dt>'+L(zh,en)+'</dt><dd>'+value+'</dd></div>';
  const panelHead=(zh,en,action='')=>'<header class="report-mail-heading"><h2>'+L(zh,en)+'</h2>'+action+'</header>';
  const badge=(active,zh,en)=>'<span class="report-mail-badge '+(active?'is-active':'is-paused')+'">'+L(zh,en)+'</span>';
  const feedback=(id='')=>'<p class="wms-feedback" role="status"'+(id?' id="'+id+'"':'')+'></p>'+
   '<p class="wms-feedback error" role="alert"></p>';
  const time=s=>String(s.hour).padStart(2,'0')+':00';
  const planName=s=>{
   const labels=[1,2].map(language=>{
    const report=reportLabels.filter(([kind])=>s.reports.some(r=>r.kind===kind)).map(row=>row[language]);
    const product=products.filter(([code])=>s.reports.some(r=>r.product===code));
    const name=product.length>1?(language===1?'铜钴':'Copper & Cobalt'):product[0]?.[language]||'';
    const frequency=s.frequency==='monthly'?(language===1?'月报':'Monthly'):(language===1?'日报':'Daily');
    return [name,...report,frequency].join(' · ');
   });
   return L(...labels);
  };
  const formatSlot=(date,locale)=>new Intl.DateTimeFormat(locale,{
   timeZone:'Africa/Lubumbashi',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(new Date(date));
  const delivery=()=>{
   const next=setting.nextDelivery;
   if(!next)return '<p class="report-mail-empty">'+(setting.enabled?
    L('暂无后续发送计划','No upcoming schedule'):L('定时发送已暂停','Scheduled delivery is paused'))+'</p>';
   const nextPlans=next.scheduleIds.map(id=>setting.schedules.find(s=>s.id===id)).filter(Boolean);
   return '<dl class="report-mail-facts">'+entry('卢本巴希时间','Lubumbashi Time',
    '<strong>'+L(formatSlot(next.at,'zh-CN'),formatSlot(next.at,'en-GB'))+'</strong>')+
    entry('计划','Schedule',nextPlans.map(planName).join('<br>')||'—')+'</dl>';
  };
  const relayInfo=url=>{
   const address=new URL(url);
   return {url,host:address.hostname,connection:(address.protocol==='smtps:'?'TLS':'STARTTLS')+' · '+address.port};
  };
  const relayList=transport.relays.map(relayInfo);
  const mailboxBadge=()=>{
   if(!transport.canConfigure)return badge(false,'由主机维护','Managed on Host');
   return transport.hasPassword?badge(true,'凭据已保存','Credential Saved'):badge(false,'可配置','Ready to Configure');
  };
  const smtpSummary=()=>'<dl class="report-mail-facts">'+
   entry('发件地址','Sender Address','<span data-no-i18n>'+esc(transport.from||'—')+'</span>')+
   entry('连接方式','Connection','<span data-no-i18n>'+esc(transport.url?relayInfo(transport.url).connection:'—')+'</span>')+'</dl>';
  const credentialHint=()=>transport.hasPassword?
   L('凭据已加密保存。邮箱设置相同时可留空。','The credential is encrypted. Leave it blank to keep identical mailbox settings.'):
   L('请输入 SMTP 密码或应用专用密码。','Enter the SMTP password or app password.');
  const smtpFields=()=>{
   const current=relayList.find(relay=>relay.url===transport.url);
   const hostOptions=[...new Set(relayList.map(relay=>relay.host))];
   const hosts='<select name="host" required>'+choose(current?.host)+hostOptions.map(host=>option(host,host,current?.host)).join('')+'</select>';
   const connection='<select name="url" required>'+choose(current?.url)+
    relayList.filter(relay=>relay.host===current?.host).map(relay=>option(relay.url,relay.connection,current?.url)).join('')+'</select>';
   const sender='<select name="from" required>'+choose(transport.from)+
    transport.senders.map(from=>option(from,from,transport.from)).join('')+'</select>';
   return '<div class="form-grid wms-field-grid">'+field('邮件服务器','Mail Server',hosts)+field('连接方式','Connection',connection)+
    field('发件地址','Sender Address',sender)+field('认证账号','SMTP Login',
     '<input name="username" required maxlength="254" autocomplete="off" spellcheck="false" value="'+esc(transport.username)+'">')+
    field('更新凭据','Update Credential','<input name="password" type="password" autocomplete="new-password" maxlength="512" aria-describedby="report-mail-credential-help">')+
    '</div><p class="s46-muted" id="report-mail-credential-help">'+credentialHint()+'</p>'+
    '<div class="report-mail-editor-actions"><button type="submit" class="button primary">'+L('保存邮箱','Save Mailbox')+'</button></div>'+feedback();
  };
  this.page('报表邮件','Report Email','SYS-18',
   '<div class="report-mail-workbench"><div class="report-mail-overview">'+
   (setting.environment==='test'?badge(false,'测试环境 · 仅 .test 邮箱','TEST · .test Addresses Only'):'')+
   '<div id="report-mail-mailbox-overview">'+mailboxBadge()+'</div>'+
   '</div><div class="report-mail-tabs" role="tablist" aria-label="'+esc(t('报表邮件设置','Report Email Settings'))+'">'+
   '<button type="button" id="report-mail-tab-plans" role="tab" aria-controls="report-mail-panel-plans" aria-selected="true">'+L('发送计划','Delivery Schedules')+'</button>'+
   '<button type="button" id="report-mail-tab-smtp" role="tab" aria-controls="report-mail-panel-smtp" aria-selected="false" tabindex="-1">'+L('服务器邮箱','Server Mailbox')+'</button></div>'+
   '<section id="report-mail-panel-plans" role="tabpanel" aria-labelledby="report-mail-tab-plans">'+
    '<div class="report-mail-layout"><section class="s46-card report-mail-panel">'+panelHead('发送计划','Delivery Schedules',
     '<button type="button" id="report-mail-add" class="button primary">'+L('新建计划','New Schedule')+'</button>')+
     '<div id="report-mail-plans"></div>'+
     '<form id="report-mail-delivery-form" class="report-mail-delivery-form"><div class="report-mail-heading">'+
      '<div id="report-mail-delivery-state"></div><button type="submit" id="report-mail-delivery-toggle" class="button secondary"></button></div>'+
      '<p id="report-mail-updated" class="s46-muted"></p>'+feedback('report-mail-status')+'</form></section>'+
     '<aside class="report-mail-stack"><section class="s46-card report-mail-panel">'+panelHead('服务器邮箱','Server Mailbox',
      '<button type="button" id="report-mail-mailbox-edit" class="button secondary">'+L('配置','Configure')+'</button>')+
      '<div id="report-mail-smtp-summary">'+smtpSummary()+'</div></section>'+
      '<section class="s46-card report-mail-panel">'+panelHead('下次计划发送','Next Scheduled Delivery')+
      '<div id="report-mail-next"></div></section></aside></div>'+
    '<form id="report-mail-form" class="s46-card user-form report-mail-panel report-mail-editor" data-wms-validation hidden></form></section>'+
   '<section id="report-mail-panel-smtp" role="tabpanel" aria-labelledby="report-mail-tab-smtp" hidden>'+
    '<div class="report-mail-layout"><section class="s46-card report-mail-panel">'+panelHead('服务器邮箱','Server Mailbox',
     '<div id="report-mail-mailbox-state">'+mailboxBadge()+'</div>')+
     (transport.canConfigure?'<form id="report-mail-transport-form" class="user-form" data-wms-validation>'+smtpFields()+'</form>':
      '<p class="report-mail-empty">'+L('请联系运维配置批准的邮件服务器、发件与收件规则，以及加密密钥。',
       'Ask your server administrator to provision approved mail servers, sender and recipient rules, and the encryption key.')+'</p>')+
    '</section><section class="s46-card report-mail-panel">'+panelHead('收件规则','Recipient Rules')+
     '<p class="report-mail-empty">'+L('选择已登记邮箱的账户。发送时读取账户当前邮箱。','Choose accounts with registered email. Delivery uses the current account address.')+'</p>'+
     [recipients[0],unavailable[0]].filter(Boolean).map(account=>'<div class="report-mail-example"><strong data-no-i18n>'+
      esc(accountName(account))+'</strong><span class="s46-muted" data-no-i18n>'+recipientLabel(account)+'</span></div>').join('')+
    '</section></div></section></div>');
  const root=document.querySelector('.report-mail-workbench');
  const find=selector=>root.querySelector(selector);
  const tabs=[...root.querySelectorAll('[role=tab]')];
  const tab=(active,focus=true)=>{
   for(const button of tabs){
    const selected=button===active;
    button.setAttribute('aria-selected',String(selected));
    button.tabIndex=selected?0:-1;
    document.getElementById(button.getAttribute('aria-controls')).hidden=!selected;
   }
   if(focus)active.focus();
  };
  for(const [index,button] of tabs.entries()){
   button.onclick=()=>tab(button);
   button.onkeydown=event=>{
    const target={ArrowLeft:1-index,ArrowRight:1-index,Home:0,End:tabs.length-1}[event.key];
    if(target===undefined)return;
    event.preventDefault();
    tab(tabs[target]);
   };
  }
  const smtpForm=find('#report-mail-transport-form');
  find('#report-mail-mailbox-edit').onclick=()=>{
   tab(tabs[1]);
   smtpForm?.elements.host.focus();
  };
  if(smtpForm){
   const fields=smtpForm.elements,status=smtpForm.querySelector('[role=status]');
   const reflectPassword=()=>{
    const same=fields.url.value===transport.url&&fields.from.value===transport.from&&fields.username.value===transport.username;
    fields.password.required=!same||!transport.hasPassword;
    find('#report-mail-credential-help').innerHTML=fields.password.required?
     L('请输入 SMTP 密码或应用专用密码。','Enter the SMTP password or app password.'):credentialHint();
   };
   fields.host.onchange=()=>{
    const relays=relayList.filter(relay=>relay.host===fields.host.value),current=relays.length===1?relays[0].url:'';
    fields.url.innerHTML=choose(current)+relays.map(relay=>option(relay.url,relay.connection,current)).join('');
    reflectPassword();
   };
   smtpForm.oninput=reflectPassword;
   reflectPassword();
   smtpForm.onsubmit=event=>UI46Pages.submit(event,async()=>{
    status.textContent='';
    const body={version:transport.version,url:fields.url.value,from:fields.from.value,username:fields.username.value};
    if(fields.password.value)body.password=fields.password.value;
    try{
     Object.assign(transport,await API.request('/system/report-mail/transport',{method:'PUT',body}));
     fields.password.value='';
     reflectPassword();
     find('#report-mail-smtp-summary').innerHTML=smtpSummary();
     find('#report-mail-mailbox-state').innerHTML=mailboxBadge();
     find('#report-mail-mailbox-overview').innerHTML=mailboxBadge();
     status.innerHTML=L('服务器邮箱已保存','Server mailbox saved');
    }catch(error){
     if(error.statusCode===409)throw Error(t('服务器邮箱已更新，请重新打开页面核对。','The mailbox changed. Reopen this page to review it.'));
     if(I18n.language==='en'&&error.statusCode===400)throw Error('Check the login, credential, and approved server and sender.');
     if(I18n.language==='en'&&error.statusCode===503)throw Error('The server mail policy or encryption key is unavailable.');
     throw error;
    }
   });
  }

  const plans=find('#report-mail-plans'),editor=find('#report-mail-form'),globalForm=find('#report-mail-delivery-form');
  const add=find('#report-mail-add'),toggle=find('#report-mail-delivery-toggle'),status=find('#report-mail-status');
  const approved=new Map(recipients.map(account=>[account.id,account]));
  let busy=false,editing=null,draftId=null,lastRequest;
  const refreshButtons=()=>{
   add.disabled=busy||setting.schedules.length>=20;
   toggle.disabled=busy||(!setting.enabled&&!setting.schedules.length);
   for(const button of plans.querySelectorAll('button'))button.disabled=busy;
  };
  const renderSchedules=()=>{
   plans.innerHTML=setting.schedules.length?setting.schedules.map(s=>{
    const names=s.recipients?.join(' · ')||(s.recipientAccounts||[]).map(id=>{
     const account=approved.get(id)||unavailable.find(a=>a.id===id);
     return account?accountName(account):'';
    }).filter(Boolean).join(' · ');
    const active=s.enabled!==false&&setting.enabled;
    return '<article class="report-mail-row"><div><h3>'+planName(s)+'</h3>'+
     '<p class="s46-muted" data-no-i18n>'+esc(names||t('收件账号已不可用','Recipient accounts unavailable'))+'</p></div>'+
     '<div class="report-mail-schedule"><span class="s46-muted">'+(s.frequency==='daily'?L('每天','Daily'):L('每月 1 日','First of Each Month'))+
     ' <time>'+time(s)+'</time></span>'+badge(active,active?'已启用':'已暂停',active?'Enabled':'Paused')+'</div>'+
     '<button type="button" class="button secondary" data-report-mail-edit="'+esc(s.id)+'">'+L('编辑','Edit')+'</button></article>';
   }).join(''):'<p class="report-mail-empty">'+L('尚未设置发送计划。','No delivery schedules yet.')+'</p>';
   find('#report-mail-delivery-state').innerHTML=setting.enabled?
    badge(true,'定时发送已启用','Scheduled Delivery Enabled'):badge(false,'定时发送已暂停','Scheduled Delivery Paused');
   toggle.innerHTML=setting.enabled?L('暂停定时发送','Pause Delivery'):L('启用定时发送','Enable Delivery');
   find('#report-mail-updated').innerHTML=setting.version===0?
    L('首次保存后，页面计划接管主机旧计划。','The first save takes over any existing host schedules.'):
    (setting.updatedAt?L('上次保存','Last Saved')+' <time data-no-i18n>'+esc(BusinessTime.display(setting.updatedAt))+'</time>':'');
   find('#report-mail-next').innerHTML=delivery();
   refreshButtons();
  };
  const persist=async(schedules,enabled)=>{
   const body={version:setting.version,enabled,schedules},signature=JSON.stringify(body);
   if(lastRequest?.signature!==signature)lastRequest={signature,key:crypto.randomUUID()};
   busy=true;
   refreshButtons();
   try{
    const saved=await API.request('/system/report-mail',{method:'PUT',body,idempotencyKey:lastRequest.key});
    Object.assign(setting,{enabled,schedules,nextDelivery:null},saved);
    lastRequest=null;
    renderSchedules();
    status.innerHTML=L('报表邮件设置已保存','Report email settings saved');
   }catch(error){
    if(!error.statusCode)throw Error(t('保存结果待确认。请保留当前内容，核对后可使用原请求重试。','Save result pending. Keep these settings and retry the original request after checking.'));
    if(error.statusCode===409)throw Error(t('设置已更新，请重新打开页面核对。','Settings changed. Reopen this page to review them.'));
    if(I18n.language==='en'&&error.statusCode===400)throw Error('Check the report account, report choices, and recipient settings.');
    throw error;
   }finally{
    busy=false;
    refreshButtons();
   }
  };
  const accountFields=s=>{
   const selected=new Set(s.recipientAccounts||[]);
   const inactive=[...unavailable,...[...selected].filter(id=>!approved.has(id)&&!unavailable.some(a=>a.id===id))
    .map(id=>({id,username:t('原收件账号已不可用','Previous Recipient Unavailable'),reason:'NOT_APPROVED'}))];
   const choices=[...recipients,...inactive].map(account=>{
    const checked=selected.has(account.id);
    return '<label class="report-mail-recipient" data-recipient-choice'+(account.reason?' data-unavailable':'')+'>'+
     '<input type="checkbox" name="recipientAccount" value="'+esc(account.id)+'"'+(checked?' checked':'')+
     (account.reason&&!checked?' disabled':'')+'><span><strong data-no-i18n>'+esc(accountName(account))+'</strong>'+
     '<small data-no-i18n>'+recipientLabel(account)+'</small></span></label>';
   }).join('');
   const legacy=s.recipients?.length?'<p class="report-mail-legacy">'+L('原地址保持有效。选择账号并保存后改用注册邮箱。','The existing addresses still apply. Selecting accounts and saving switches to registered email.')+
    '<br><span data-no-i18n>'+esc(s.recipients.join(' · '))+'</span></p>':'';
   return '<fieldset class="report-mail-choices"><legend>'+L('收件账户（最多 8 个）','Recipient Accounts (up to 8)')+'</legend>'+
    legacy+(choices?(recipients.length+inactive.length>8?field('搜索账户','Search Accounts','<input type="search" name="recipientSearch">'):'')+
    '<div class="report-mail-recipient-list">'+choices+'<p class="report-mail-empty" data-no-recipients hidden>'+L('没有匹配的账户。','No matching accounts.')+'</p></div>':
     '<p class="report-mail-empty">'+L('暂无符合发送规则的注册邮箱。','No registered email meets the delivery rules.')+'</p>')+'</fieldset>';
  };
  const reportFields=s=>'<fieldset class="report-mail-choices"><legend>'+L('报表（最多 6 份）','Reports (up to 6)')+'</legend>'+
   '<div class="report-mail-report-groups">'+products.map(([product,zh,en])=>'<fieldset class="report-mail-reports"><legend>'+L(zh,en)+'</legend>'+
    reportLabels.map(([kind,name,english])=>'<label><input type="checkbox" name="report" value="'+kind+':'+product+'"'+
     (['balance','sales'].includes(kind)?' data-monthly-report':'')+
     (s.reports.some(r=>r.kind===kind&&r.product===product)?' checked':'')+'>'+L(name,english)+'</label>').join('')+'</fieldset>').join('')+'</div>'+
    '<p class="s46-muted">'+L('库存平衡和销售统计按月发送。','Inventory balance and sales are sent monthly.')+'</p></fieldset>';
  const closeEditor=()=>{
   const id=editing;
   editing=null;
   draftId=null;
   editor.hidden=true;
   editor.replaceChildren();
   (plans.querySelector('[data-report-mail-edit="'+(id||'')+'"]')||add).focus();
  };
  const openEditor=s=>{
   const selected=s||{hour:7,frequency:'daily',actor:'',recipientAccounts:[],reports:[],enabled:true};
   editing=s?.id||null;
   draftId=editing||crypto.randomUUID();
   const actorOptions=setting.actors.map(a=>option(a.username,a.displayName?a.displayName+' · '+a.username:a.username,selected.actor)).join('');
   const orphanActor=selected.actor&&!setting.actors.some(a=>a.username===selected.actor)?
    option(selected.actor,selected.actor+' · 已不可用',selected.actor,selected.actor+' · Unavailable'):'';
   editor.innerHTML=panelHead(s?'编辑发送计划':'新建发送计划',s?'Edit Delivery Schedule':'New Delivery Schedule',
    '<button type="button" class="button secondary" data-report-mail-close>'+L('取消','Cancel')+'</button>')+
    '<div class="form-grid wms-field-grid">'+
    field('频率','Frequency','<select name="frequency">'+option('daily','每天',selected.frequency,'Daily')+option('monthly','每月 1 日',selected.frequency,'First Day of Each Month')+'</select>')+
    field('发送时间（卢本巴希）','Time (Lubumbashi)','<input name="hour" type="time" required step="3600" value="'+time(selected)+'">')+
    field('报表执行账号','Report Account','<select name="actor" required>'+choose(selected.actor)+orphanActor+actorOptions+'</select>')+'</div>'+
    reportFields(selected)+accountFields(selected)+
    '<div class="report-mail-editor-footer"><label class="report-mail-check"><input type="checkbox" name="enabled"'+
     (selected.enabled!==false?' checked':'')+'>'+L('启用此计划','Enable This Schedule')+'</label><div class="report-mail-editor-actions">'+
     (s?'<button class="button danger-outline" type="button" data-report-mail-remove>'+L('删除计划','Remove Schedule')+'</button>':'')+
     '<button type="submit" class="button primary">'+L('保存计划','Save Schedule')+'</button></div></div>'+feedback();
   editor.hidden=false;
   editor.elements.frequency.focus();
   editor.querySelector('[data-report-mail-close]').onclick=()=>{if(!busy)closeEditor();};
   editor.querySelector('[data-report-mail-remove]')?.addEventListener('click',async()=>{
    if(busy||!await OperationConfirm.ask({title:t('删除发送计划','Remove Delivery Schedule'),
     note:t('删除后，此计划将停止发送。','Removing this schedule stops its deliveries.')}))return;
    const error=editor.querySelector('[role=alert]'),button=editor.querySelector('[data-report-mail-remove]');
    const remaining=setting.schedules.filter(plan=>plan.id!==editing);
    button.disabled=true;
    try{await persist(remaining,setting.enabled&&remaining.length>0);closeEditor();}
    catch(failure){error.textContent=failure.message;}
    finally{if(button.isConnected)button.disabled=false;}
   });
   const reflect=()=>{
    const daily=editor.elements.frequency.value==='daily';
    const reports=[...editor.querySelectorAll('[name=report]')];
    const choices=[...editor.querySelectorAll('[name=recipientAccount]')];
    const search=editor.elements.recipientSearch?.value.trim().toLocaleLowerCase();
    const full=reports.filter(input=>input.checked&&(!daily||!input.hasAttribute('data-monthly-report'))).length>=6;
    for(const input of reports)input.disabled=(daily&&input.hasAttribute('data-monthly-report'))||(full&&!input.checked);
    const limit=choices.filter(input=>input.checked).length>=8;
    for(const input of choices){
     const row=input.closest('[data-recipient-choice]');
     input.disabled=!input.checked&&(row.hasAttribute('data-unavailable')||limit);
     row.hidden=!!search&&!row.textContent.toLocaleLowerCase().includes(search);
    }
    const empty=editor.querySelector('[data-no-recipients]');
    if(empty)empty.hidden=choices.some(input=>!input.closest('[data-recipient-choice]').hidden);
   };
   editor.oninput=reflect;
   reflect();
   editor.onsubmit=event=>UI46Pages.submit(event,async()=>{
    if(busy)return;
    const data=new FormData(editor),recipientAccounts=data.getAll('recipientAccount');
    if(!recipientAccounts.length&&!selected.recipients?.length)throw Error(t('请至少选择一个收件账户。','Select at least one recipient account.'));
    const reports=data.getAll('report').map(value=>{
     const [kind,product]=value.split(':');
     return {kind,product};
    });
    if(!reports.length)throw Error(t('请至少选择一份报表。','Select at least one report.'));
    const schedule={id:draftId,hour:Number(data.get('hour').slice(0,2)),
     frequency:data.get('frequency'),actor:data.get('actor'),enabled:data.has('enabled'),reports,
     ...(!recipientAccounts.length?{recipients:selected.recipients}:{recipientAccounts})};
    const schedules=editing?setting.schedules.map(plan=>plan.id===editing?schedule:plan):[...setting.schedules,schedule];
    await persist(schedules,setting.enabled);
    closeEditor();
   });
  };
  add.onclick=()=>{if(!busy)openEditor(null);};
  plans.onclick=event=>{
   const button=event.target.closest('[data-report-mail-edit]');
   const current=button&&setting.schedules.find(s=>s.id===button.dataset.reportMailEdit);
   if(current&&!busy)openEditor(current);
  };
  globalForm.onsubmit=event=>UI46Pages.submit(event,async()=>{
   if(!busy)await persist(setting.schedules,!setting.enabled);
  });
  renderSchedules();
 },
 async audit(){const q=new URLSearchParams(location.search),record=q.get('record');if(record)return this.auditDetail(record,q);
  const d=await API.request('/v27/audit?'+q),actions=[['','全部操作','All Actions'],['login','用户登录','User Login'],['role_permissions_changed','修改角色权限','Role Permission Changes'],['user_created','创建账户','Account Creation'],['user_updated','修改账户','Account Updates'],['access_change_submitted','提交权限变更','Access Change Submitted'],['access_change_decided','审批权限变更','Access Change Decision'],['audit_evidence_exported','导出审计证据','Audit Evidence Export'],['operation_failed','操作失败','Failed Operations']],options=actions.map(([v,z,e])=>'<option value="'+v+'" '+(q.get('action')===v?'selected':'')+'>'+esc(this.t(z,e))+'</option>').join('');
  const custom=q.get('action')&&!actions.some(x=>x[0]===q.get('action'))?'<option selected value="'+esc(q.get('action'))+'">'+esc(AuditLabels.label(q.get('action')))+' · '+esc(q.get('action'))+'</option>':'';
  const categories=[['','全部分类','All Categories'],['AUTH','认证','Authentication'],['ACCESS','账户与授权','Accounts & Access'],['AUDIT','审计取证','Audit Evidence'],['FAILURE','操作失败','Failures'],['BUSINESS','业务','Business']];
  const category='<label>'+this.L('日志分类','Category')+'<select name="category">'+categories.map(([value,z,e])=>'<option value="'+value+'" '+((q.get('category')||'')===value?'selected':'')+'>'+esc(this.t(z,e))+'</option>').join('')+'</select></label>';
  const request='<label>'+this.L('请求编号','Request ID')+'<input name="request_id" maxlength="80" value="'+esc(q.get('request_id')||'')+'"></label>';
  const filters='<form id="v27-audit-filter" class="s46-filter"><div class="s46-audit-filters"><label>'+this.L('业务编号 / 操作人','Business Reference / Operator')+'<input name="search" maxlength="160" value="'+esc(q.get('search')||'')+'" placeholder="'+esc(this.t('输入编号或姓名','Reference or name'))+'"></label><label>'+this.L('操作类型','Action')+'<select name="action">'+options+custom+'</select></label><label>'+this.L('开始日期','From Date')+'<input name="from" type="date" value="'+esc(q.get('from')||'')+'"></label><label>'+this.L('结束日期','To Date')+'<input name="to" type="date" value="'+esc(q.get('to')||'')+'"></label><label>'+this.L('执行结果','Result')+'<select name="outcome">'+[['','全部','All'],['SUCCESS','成功','Succeeded'],['FAILED','失败','Failed']].map(([v,z,e])=>'<option value="'+v+'" '+(q.get('outcome')===v?'selected':'')+'>'+esc(this.t(z,e))+'</option>').join('')+'</select></label>'+category+request+'</div><div class="s46-filter-footer"><span class="s46-muted">'+this.L('日期按 Africa/Lubumbashi 项目时间筛选','Dates use project time: Africa/Lubumbashi')+'</span><div class="s46-actions">'+this.link('/audit','重置筛选','Reset Filters')+'<button type="button" id="audit-export" class="button secondary">'+this.L('导出审计证据','Export Audit Evidence')+'</button>'+'<button class="button primary">'+this.L('查询日志','Search Audit')+'</button></div></div></form>';
  const rows=d.items.map(r=>{const next=new URLSearchParams(q);next.set('record',r.id);return '<tr><td data-no-i18n>'+esc(BusinessTime.display(r.occurred_at))+'</td><td><b data-no-i18n>'+esc(EmployeeIdentity.name({display_name:r.actor_name})||'—')+'</b><small>'+esc((I18n.language==='en'?r.actor_role_name_en||'Historical Role Not Recorded':r.actor_role_name||'历史角色未记录'))+'</small></td><td>'+this.module(r.entity_type)+'</td><td>'+esc(AuditLabels.label(r.action))+'</td><td>'+this.badge(r.outcome!=='FAILED',r.outcome==='FAILED'?'失败':'成功',r.outcome==='FAILED'?'Failed':'Succeeded')+'</td><td class="s46-reference" data-no-i18n title="'+esc(r.entity_id||'')+'">'+esc(r.entity_id||'—')+'</td><td>'+this.link('/audit?'+next,'查看记录','View Record')+'</td></tr>';}).join('');
  const list=this.block('操作记录','Audit Records','<div class="s46-table-wrap"><table id="s46-audit-table"><thead><tr>'+[['操作时间','Time'],['操作人 / 角色','Operator / Role'],['业务对象','Business Object'],['操作内容','Action'],['结果','Result'],['关联编号','Reference'],['操作','Actions']].map(([z,e])=>'<th>'+this.L(z,e)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>'+this.pager(d,q,'/audit'),'s46-table-card');
  this.page('系统日志','System Audit','SYS-06',filters+list+(this.can('system:manage')?'<details class="s46-card s46-backups"><summary>'+this.L('数据库备份执行记录','Database Backup Execution Records')+'</summary><div id="s46-backup-records"></div></details>':''));
  document.getElementById('v27-audit-filter').onsubmit=e=>{e.preventDefault();const next=new URLSearchParams(new FormData(e.target));if(q.get('entity'))next.set('entity',q.get('entity'));Router.go('/audit?'+next);};
  $('audit-export').onclick=async event=>{
   const button=event.currentTarget;button.disabled=true;
   try{
    const params=Object.fromEntries(q);delete params.page;delete params.record;
    const result=await API.request('/v27/audit/export',{method:'POST',body:params,binary:true});
    const url=URL.createObjectURL(result.blob),anchor=document.createElement('a');
    anchor.href=url;anchor.download=result.filename||'wms-audit.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
   }catch(error){notify(I18n.translate(error.message,true));}finally{button.disabled=false;}
  };
  this.bindPager(q,'/audit');const backups=document.querySelector('.s46-backups');if(backups)backups.ontoggle=async()=>{if(!backups.open||backups.dataset.loaded)return;const target=document.getElementById('s46-backup-records');try{const b=await API.request('/v27/backups');target.innerHTML=(b.items.length?'<div class="s46-table-wrap"><table><thead><tr>'+[['完成时间','Completed'],['结果','Result'],['文件','File'],['恢复验证','Restore Verification']].map(([z,e])=>'<th>'+this.L(z,e)+'</th>').join('')+'</tr></thead><tbody>'+b.items.map(x=>'<tr><td data-no-i18n>'+esc(BusinessTime.display(x.finished_at))+'</td><td>'+esc(x.status)+'</td><td data-no-i18n>'+esc(x.file_name||'—')+'</td><td>'+this.L(x.restore_verified?'已通过':'未执行',x.restore_verified?'Passed':'Not performed')+'</td></tr>').join('')+'</tbody></table></div>':'<p>'+this.L('暂无备份执行记录','No backup execution records')+'</p>');backups.dataset.loaded='';this.localize();}catch(e){target.textContent=e.message;}};
 },
 pager(d,q,path){const pages=Math.max(1,Math.ceil(d.total/d.page_size));return '<div class="s46-pagination"><span>'+this.L('共 '+d.total+' 条记录',''+d.total+' records')+'</span><div class="s46-actions"><button class="button secondary" data-s46-page="'+(d.page-1)+'" '+(d.page<=1?'disabled':'')+'>'+this.L('上一页','Previous')+'</button><span data-no-i18n>'+d.page+' / '+pages+'</span><button class="button secondary" data-s46-page="'+(d.page+1)+'" '+(d.page>=pages?'disabled':'')+'>'+this.L('下一页','Next')+'</button></div></div>';},
 bindPager(q,path){for(const b of document.querySelectorAll('[data-s46-page]'))b.onclick=()=>{const next=new URLSearchParams(q);next.set('page',b.dataset.s46Page);Router.go(path+'?'+next);};},
 module(code){const m={users:['账户','Accounts'],access_change_requests:['权限变更审批','Access Change Approvals'],audit_logs:['审计取证','Audit Evidence'],roles:['角色权限','Role Permissions'],receipts:['入库单','Receipts'],allocations:['备货单','Preparation'],loading_orders:['装车与出库','Loading & Stock Issue'],co_loading_orders:['钴装车单','Cobalt Loading'],co_preparations:['钴入库与备货','Cobalt Stock Entry & Lot Preparation'],sales_plans:['销售计划','Sales Plans'],plans:['销售计划','Sales Plans'],stocktakes:['库存盘点','Inventory Count'],gate_printers:['打印机','Printers'],gate_permits:['出门证','Gate Permits'],bundles:['捆包','Bundles']};return m[code]?this.L(...m[code]):'<span data-no-i18n>'+esc(code||'—')+'</span>';},
 async auditDetail(id,q){const r=await API.request('/v27/audit/'+encodeURIComponent(id)),back=new URLSearchParams(q);back.delete('record');
  const facts=[['审计编号','Audit ID',r.id],['业务对象','Business Object',r.entity_type||'—'],['关联编号','Reference',r.entity_id||'—'],['操作类型','Action',AuditLabels.label(r.action)],['操作人','Operator',EmployeeIdentity.name({display_name:r.actor_name})||'—'],['操作时间','Time',BusinessTime.display(r.occurred_at)],['请求编号','Request ID',r.request_id||'—']];
  const basic='<dl class="s46-facts">'+facts.map(([z,e,v])=>'<div><dt>'+this.L(z,e)+'</dt><dd data-no-i18n>'+esc(v)+'</dd></div>').join('')+'</dl>';
  const flatten=(value,prefix='',out={})=>{if(value&&typeof value==='object'&&!Array.isArray(value))for(const [k,v]of Object.entries(value))flatten(v,prefix?prefix+'.'+k:k,out);else out[prefix||'value']=value;return out;},before=flatten(r.before_data),after=flatten(r.after_data),keys=[...new Set([...Object.keys(before),...Object.keys(after)])].sort(),format=v=>v===undefined?'—':v===null?'null':typeof v==='object'?JSON.stringify(v):String(v),changed=keys.filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));
  const changes='<div class="s46-table-wrap"><table class="s46-diff-table"><thead><tr><th>'+this.L('字段','Field')+'</th><th>'+this.L('操作前','Before')+'</th><th>'+this.L('操作后','After')+'</th></tr></thead><tbody>'+changed.map(k=>'<tr><th data-no-i18n>'+esc(k)+'</th><td data-no-i18n>'+esc(format(before[k]))+'</td><td data-no-i18n>'+esc(format(after[k]))+'</td></tr>').join('')+'</tbody></table></div>'+(changed.length?'':'<p class="s46-muted">'+this.L('本记录未保存字段差异。可展开脱敏审计数据核对。','No field differences were recorded. Expand the redacted audit data to inspect it.')+'</p>')+'<details class="s46-raw-audit"><summary>'+this.L('脱敏审计数据','Redacted Audit Data')+'</summary><pre data-no-i18n>'+esc(JSON.stringify({before:r.before_data,after:r.after_data},null,2))+'</pre></details>';
  const side=this.block('档案与关联信息','Record & References','<p>'+this.badge(r.outcome!=='FAILED',r.outcome==='FAILED'?'失败':'成功',r.outcome==='FAILED'?'Failed':'Succeeded')+'</p>'+this.link('/audit?'+back,'返回系统日志','Back to System Audit',true))+this.block('办理记录','Event History','<div class="s46-audit-event"><i></i><div><b>'+esc(AuditLabels.label(r.action))+'</b><p data-no-i18n>'+esc(EmployeeIdentity.name({display_name:r.actor_name})||'—')+'</p><small data-no-i18n>'+esc(BusinessTime.display(r.occurred_at))+'</small></div></div>');
  this.page('审计记录详情','Audit Record Details','SYS-07','<div class="s46-document-banner"><div><span class="s46-muted">'+this.L('系统日志 / 记录详情','System Audit / Record Details')+'</span><h2 data-no-i18n>AUDIT-'+esc(r.id)+'</h2></div>'+this.link('/audit?'+back,'返回日志列表','Back to Audit List')+'</div><div class="s46-detail-layout"><div>'+this.block('操作内容','Event Information',basic)+this.block('变更内容','Changes',changes)+'</div><aside>'+side+'</aside></div>');
 },
 async masters(){const cobalt=!ProductContext.isCopper(),d=await (cobalt?API.request('/cobalt/masters'):Business.load()),q=new URLSearchParams(location.search),types={...(cobalt?{}:{customers:['客户','Customers'],batches:['生产批次','Production Batches']}),warehouses:['仓库','Warehouses'],yards:cobalt?['库区','Zones']:['堆场','Yards'],locations:['货位','Locations']},type=Object.hasOwn(types,q.get('type'))?q.get('type'):'warehouses',search=q.get('search')||'',status=q.has('status')?q.get('status'):'active';
  const source=d[type]||[],rows=source.filter(r=>(r.code+' '+(r.name||'')).toLowerCase().includes(search.toLowerCase())&&(!status||status==='active'&&r.active!==false||status==='disabled'&&r.active===false));
  const lookup=(list,id)=>{const row=list?.find(x=>x.id===id);return (I18n.language==='en'&&row?.name_en)||row?.name||'—';},tabs='<nav class="s46-tabs" aria-label="'+esc(this.t('基础资料类型','Master data types'))+'">'+Object.entries(types).map(([key,[z,e]])=>'<a href="/customers/master-data?type='+key+'" '+(key===type?'aria-current="page"':'')+'>'+this.L(z,e)+'</a>').join('')+'</nav>',filters='<form id="s46-master-filter" class="s46-filter"><input name="type" type="hidden" value="'+type+'"><div class="s46-master-filters"><label>'+this.L('编码 / 名称','Code / Name')+'<input name="search" maxlength="120" value="'+esc(search)+'" placeholder="'+esc(this.t('输入关键词','Enter a keyword'))+'"></label><label>'+this.L('状态','Status')+'<select name="status">'+[['active','启用','Active'],['disabled','停用','Inactive'],['','全部','All']].map(([v,z,e])=>'<option value="'+v+'" '+(status===v?'selected':'')+'>'+esc(this.t(z,e))+'</option>').join('')+'</select></label><div class="s46-actions">'+this.link('/customers/master-data?type='+type,'重置','Reset')+'<button class="button primary">'+this.L('查询','Search')+'</button></div></div></form>';
  const cols=[['编码','Code'],[type==='batches'?'生产日期':'名称',type==='batches'?'Production Date':'Name'],['所属项目','Project'],...(type==='warehouses'?[(cobalt?['启用库区数','Active Zones']:['启用堆场数','Active Yards']),['启用货位数','Active Locations']]:type==='yards'?[['所属仓库','Warehouse'],['启用货位数','Active Locations']]:type==='locations'?[['所属仓库','Warehouse'],(cobalt?['所属库区','Zone']:['所属堆场','Yard'])]:[]),['状态','Status'],...(cobalt?[]:[['操作','Actions']])];
  const table='<div class="s46-table-wrap"><table id="s46-master-table"><thead><tr>'+cols.map(([z,e])=>'<th>'+this.L(z,e)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>{const fields=[r.code||'—',(I18n.language==='en'&&r.name_en)||r.name||(cobalt&&type==='locations'?r.code:r.production_date?.slice(0,10))||'—',lookup(d.projects,r.project_id),...(type==='warehouses'?[(d.yards||[]).filter(x=>x.warehouse_id===r.id&&x.active!==false).length,(d.locations||[]).filter(x=>x.warehouse_id===r.id&&x.active!==false).length]:type==='yards'?[lookup(d.warehouses,r.warehouse_id),(d.locations||[]).filter(x=>x.yard_id===r.id&&x.active!==false).length]:type==='locations'?[lookup(d.warehouses,r.warehouse_id),lookup(d.yards,r.yard_id)]:[])];return '<tr>'+fields.map(x=>'<td data-no-i18n>'+esc(x)+'</td>').join('')+'<td>'+this.badge(r.active!==false,r.active===false?'停用':'启用',r.active===false?'Inactive':'Active')+'</td>'+(cobalt?'':'<td>'+this.link('/customers/master-data/'+type+'/'+r.id,'编辑','Edit')+'</td>')+'</tr>';}).join('')+'</tbody></table></div>';
  this.page('基础资料管理','Master Data','SYS-09',tabs+filters+'<section class="s46-card s46-table-card"><div class="s46-card-heading"><div><h2 class="s46-card-title">'+this.L(types[type][0]+'资料',types[type][1])+'</h2><p class="s46-muted">'+this.L('关联数量按当前授权范围内的启用资料统计。','Related counts include active records in your authorized scope.')+'</p></div>'+(cobalt?'':this.link('/customers/master-data/'+type+'/new','新增资料','Add Record',true))+'</div>'+table+'<div class="s46-pagination">'+this.L('共 '+rows.length+' 条记录',rows.length+' records')+'</div></section>');
  document.getElementById('s46-master-filter').onsubmit=e=>{e.preventDefault();Router.go('/customers/master-data?'+new URLSearchParams(new FormData(e.target)));};
 },
 async diagnostics(){this.page('传输与网络诊断','Transfer & Network Diagnostics','SYS-10','<div class="s46-diagnostic-layout"><div>'+this.block('连接与传输','Connection & Transfer','<div id="s46-connection"></div><div class="s46-form-footer"><button id="s46-check-connection" class="button primary">'+this.L('检查连接','Check Connection')+'</button><a class="button secondary" href="#s46-diagnostic-history">'+this.L('查看诊断记录','View Diagnostic History')+'</a></div>')+this.block('待确认操作','Operations Awaiting Confirmation','<p class="s46-muted">'+this.L('核实原请求结果，继续使用原幂等键处理。','Check the original request result and retain its idempotency key.')+'</p><div id="s46-pending-summary"></div><div id="s46-pending-host"></div>')+'</div><aside>'+this.block('当前环境','Current Environment','<dl class="s46-facts"><div><dt>'+this.L('系统版本','System Version')+'</dt><dd data-no-i18n>V'+esc(AppConfig.displayVersion||AppConfig.version)+'</dd></div><div><dt>'+this.L('前端修订','Frontend Revision')+'</dt><dd data-no-i18n>'+esc(AppConfig.frontendRevision)+'</dd></div><div><dt>'+this.L('数据环境','Data Environment')+'</dt><dd data-no-i18n>'+esc(AppConfig.environment)+'</dd></div></dl>')+'</aside></div>'+this.block('本次会话诊断记录','Diagnostics in This Session','<div id="s46-diagnostic-history"></div>'));
  const button=document.getElementById('s46-check-connection');button.onclick=()=>this.checkConnection(button);await this.checkConnection(button);
 },
 async checkConnection(button){if(button)button.disabled=true;const at=new Date().toISOString();try{await API.request('/health',{timeoutMs:10000});this.history.unshift({method:'GET',path:'/health',status:200,message:this.t('连接检查成功','Connection check succeeded'),at});}catch(e){this.connection={ok:false,at,message:e.message};}finally{this.history.length=Math.min(10,this.history.length);this.updateDiagnostics();if(button?.isConnected)button.disabled=false;}},
 updateDiagnostics(){const target=document.getElementById('s46-connection');if(!target)return;const c=this.connection,pending=[...API.operations.values()].filter(o=>o.user_id===CurrentUser.id&&o.product_code===ProductContext.code&&['UNKNOWN','SUBMITTING'].includes(o.state));const signature=JSON.stringify([c,pending.map(o=>[o.key,o.state]),this.history,I18n.language]);if(this.diagnosticsNode===target&&this.diagnosticSignature===signature&&document.getElementById('s46-pending-host')?.contains(document.getElementById('operation-panel')))return;this.diagnosticsNode=target;this.diagnosticSignature=signature;target.innerHTML='<dl class="s46-facts s46-connection-facts"><div><dt>'+this.L('服务连接','Service Connection')+'</dt><dd>'+this.badge(!!c?.ok,c?.ok?'连接正常':c?'连接失败':'尚未检查',c?.ok?'Connected':c?'Connection failed':'Not checked')+'</dd></div><div><dt>'+this.L('数据库状态','Database')+'</dt><dd>'+this.L(c?.database==='ok'?'可用':'未确认',c?.database==='ok'?'Available':'Unconfirmed')+'</dd></div><div><dt>'+this.L('待确认记录','Pending Results')+'</dt><dd>'+pending.length+'</dd></div><div><dt>'+this.L('最近检查','Last Check')+'</dt><dd data-no-i18n>'+esc(c?.at?BusinessTime.display(c.at):'—')+'</dd></div><div><dt>'+this.L('请求耗时','Response Time')+'</dt><dd data-no-i18n>'+(c?.ok?c.ms+' ms':'—')+'</dd></div></dl>'+(c?.message?'<p class="error" role="alert">'+esc(c.message)+'</p>':'');document.getElementById('s46-pending-summary').innerHTML=pending.length?'<p>'+this.L('请核实以下操作的服务器结果。','Verify the server result for these operations.')+'</p>':'<div class="s46-quiet-state">'+this.L('当前没有待确认的传输记录','No operations await confirmation')+'</div>';
  const state=UI46.state,host=document.getElementById('s46-pending-host'),panel=document.getElementById('operation-panel');if(state&&host&&panel&&!host.contains(panel)){UI46.move(panel,host,state);panel.classList.add('s46-inline-operations');state.composition.classes.push({node:panel,name:'s46-inline-operations'});Network.render();}
  document.getElementById('s46-diagnostic-history').innerHTML=this.history.length?'<div class="s46-table-wrap"><table><thead><tr>'+[['时间','Time'],['检查 / 请求','Check / Request'],['结果','Result']].map(([z,e])=>'<th>'+this.L(z,e)+'</th>').join('')+'</tr></thead><tbody>'+this.history.map(x=>'<tr><td data-no-i18n>'+esc(BusinessTime.display(x.at))+'</td><td data-no-i18n>'+esc(x.method+' '+x.path)+'</td><td>'+esc(x.message)+'</td></tr>').join('')+'</tbody></table></div>':'<p class="s46-muted">'+this.L('本次会话暂无诊断记录','No diagnostics in this session')+'</p>';this.localize();
 },

});
