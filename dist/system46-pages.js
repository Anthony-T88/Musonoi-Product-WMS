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
   const reportLabels=[
    ['shipping','发运及单证','Shipments & Documents'],['movement','出入库流水','Inventory Movements'],
    ['balance','库存平衡','Inventory Balance'],['stocktake','盘点','Stock Counts'],['sales','销售统计','Sales']
   ];
   const productLabels=[['CU_CATHODE','阴极铜','Copper Cathodes'],['CO_HYDROXIDE','氢氧化钴','Cobalt Hydroxide']];
   const inputLabel=(zh,en,input)=>'<label class="wms-field">'+this.L(zh,en)+input+'</label>';
   const updateTime=at=>at?BusinessTime.display(at):this.t('系统管理尚未保存计划','No plan saved in System Administration');
   const option=(value,text,current)=>'<option value="'+esc(value)+'"'+(current===value?' selected':'')+'>'+esc(text)+'</option>';
   const recipientChoices=s=>{
    const selected=new Set(s.recipientAccounts||[]);
    const accounts=[...setting.recipientAccounts,...[...selected]
     .filter(id=>!setting.recipientAccounts.some(account=>account.id===id))
     .map(id=>({id,username:this.t('原收件账号已不可用','Previously selected account unavailable')}))];
    const choices=accounts.map(a=>'<label><input type="checkbox" name="recipientAccount" value="'+esc(a.id)+'"'+
     (selected.has(a.id)?' checked':'')+'><span><b data-no-i18n>'+esc(a.displayName||a.username)+'</b>'+
     (a.email?'<small data-no-i18n>'+esc(a.email)+'</small>':'')+'</span></label>').join('');
    const legacy=s.recipients?.length?'<div data-legacy-recipients="'+esc(JSON.stringify(s.recipients))+'">'+
     '<p class="s46-muted">'+this.L('此计划使用原收件邮箱。选择收件账号并保存后，将改用账号注册邮箱。',
      'This schedule uses saved addresses. Selecting accounts and saving will switch it to registered addresses.')+'</p>'+
     '<p class="report-mail-legacy-addresses" data-no-i18n>'+esc(s.recipients.join(' · '))+'</p></div>':'';
    return '<fieldset class="report-mail-accounts"><legend>'+this.L('收件账号（最多 8 个）','Recipient Accounts (up to 8)')+'</legend>'+
     legacy+(choices?'<div class="report-mail-account-options">'+choices+'</div>':'<p class="s46-muted">'+
      this.L('没有符合发送规则的注册邮箱。','No registered email addresses meet the delivery rules.')+'</p>')+'</fieldset>';
   };
   const transport=setting.transport;
   const transportForm=transport.canConfigure?'<form id="report-mail-transport-form" class="user-form" data-wms-validation>'+
    '<div class="form-grid wms-field-grid">'+
    inputLabel('邮件服务器（SMTP）','Mail Server (SMTP)','<select name="url" required>'+
     option('',this.t('请选择','Select'),transport.url)+transport.relays.map(url=>option(url,url,transport.url)).join('')+'</select>')+
    inputLabel('发件邮箱','Sender Email','<select name="from" required>'+
     option('',this.t('请选择','Select'),transport.from)+transport.senders.map(from=>option(from,from,transport.from)).join('')+'</select>')+
    inputLabel('SMTP 登录账号','SMTP Login','<input name="username" type="text" required maxlength="254" spellcheck="false" autocomplete="off" value="'+esc(transport.username)+'">')+
    inputLabel('邮箱凭据','Email Credential','<input name="password" type="password" maxlength="512" autocomplete="new-password" aria-describedby="report-mail-credential-help">')+
    '</div><p class="s46-muted" id="report-mail-credential-help"></p>'+
    '<div class="s46-form-footer"><button type="submit" class="button primary">'+this.L('保存邮件服务器','Save Mail Server')+'</button></div>'+
    '<p class="wms-feedback" role="status"></p><p class="wms-feedback error" role="alert"></p></form>':
    '<p class="s46-muted">'+this.L('请联系运维配置邮件服务器地址、发件与收件规则，以及加密密钥。',
     'Ask your server administrator to provision the relay, sender and recipient policy, and encryption key.')+'</p>';
   const plan=s=>{
    const actors=setting.actors.map(a=>option(a.username,(a.displayName?a.displayName+' · ':'')+a.username,s.actor)).join('');
    const unavailable=s.actor&&!setting.actors.some(a=>a.username===s.actor)
     ?option(s.actor,s.actor+' · '+this.t('已失效','Unavailable'),s.actor):'';
    const actor='<select name="actor" required>'+option('',this.t('请选择','Select'),s.actor)+unavailable+actors+'</select>';
    const frequency='<select name="frequency">'+option('daily',this.t('每天','Daily'),s.frequency)+option('monthly',this.t('每月 1 日','First day of each month'),s.frequency)+'</select>';
    const products=productLabels.map(([product,zh,en])=>
     '<fieldset class="report-mail-reports"><legend>'+this.L(zh,en)+'</legend>'+reportLabels.map(([kind,label,english])=>
      '<label><input type="checkbox" name="report" value="'+kind+':'+product+'"'+
      (['sales','balance'].includes(kind)?' data-monthly-report':'')+
      (s.reports.some(r=>r.kind===kind&&r.product===product)?' checked':'')+'>'+this.L(label,english)+'</label>'
     ).join('')+'</fieldset>').join('');
    return '<section class="wms-section report-mail-plan" data-plan-id="'+esc(s.id)+'">'+
     '<div class="s46-card-heading"><h3 tabindex="-1">'+this.L('发送计划','Delivery Schedule')+'</h3>'+
     '<button class="button secondary" type="button" data-plan-remove>'+this.L('移除计划','Remove Schedule')+'</button></div>'+
     '<div class="form-grid wms-field-grid">'+
      inputLabel('发送频率','Frequency',frequency)+
      inputLabel('发送整点（卢本巴希）','Hour (Lubumbashi)','<input name="hour" type="number" required min="0" max="23" step="1" value="'+esc(String(s.hour))+'">')+
      inputLabel('报表授权账号','Report Account',actor)+
     '</div>'+recipientChoices(s)+products+'</section>';
   };
   const intro=this.block('发送设置','Delivery Settings',
    '<p class="s46-muted">'+this.L('报表按授权账号的数据范围生成。发送时自动读取收件账号当前的注册邮箱。','Reports use the data scope of the report account. Delivery uses each recipient account’s current registered email.')+'</p>'+
    (setting.environment==='test'?'<p>'+this.L('测试环境仅允许 .test 邮箱。','TEST allows .test addresses only.')+'</p>':''));
   this.page('报表邮件','Report Email','SYS-18',this.block('邮件服务器','Mail Server',transportForm,'report-mail-transport-card')+intro+
    '<form id="report-mail-form" class="user-form s46-card" data-wms-validation>'+
    '<label class="report-mail-switch"><input type="checkbox" name="enabled"'+(setting.enabled?' checked':'')+'>'+this.L('启用定时报表邮件','Enable scheduled report email')+'</label>'+
    '<p class="s46-muted" id="report-mail-updated" data-no-i18n>'+esc(updateTime(setting.updatedAt))+'</p>'+
    (setting.version===0?'<p class="s46-muted" id="report-mail-legacy">'+this.L('首次保存后，由此页面的计划接管服务器上可能存在的旧计划。','The first save takes over any existing server schedules.')+'</p>':'')+
    '<div id="report-mail-plans">'+setting.schedules.map(plan).join('')+'</div>'+
    '<div class="s46-form-footer"><button type="button" id="report-mail-add" class="button secondary">'+this.L('添加发送计划','Add Schedule')+'</button>'+
    '<button type="submit" class="button primary">'+this.L('保存设置','Save Settings')+'</button></div>'+
    '<p class="wms-feedback" id="report-mail-status" role="status"></p><p class="wms-feedback error" role="alert"></p></form>');
   const form=document.getElementById('report-mail-form'),plans=document.getElementById('report-mail-plans');
   const add=document.getElementById('report-mail-add'),status=document.getElementById('report-mail-status');
   const smtpForm=document.getElementById('report-mail-transport-form');
   if(smtpForm){
    const fields=smtpForm.elements,feedback=smtpForm.querySelector('[role=status]');
    const reflectPassword=()=>{
     const needed=!transport.hasPassword||fields.url.value!==transport.url||
      fields.from.value!==transport.from||fields.username.value!==transport.username;
     fields.password.required=needed;
     document.getElementById('report-mail-credential-help').textContent=needed?
      this.t('请输入该 SMTP 账号的密码或应用专用密码。','Enter this SMTP account’s password or app password.'):
      this.t('邮箱凭据已加密保存，留空时沿用。','The saved credential is encrypted. Leave blank to keep it.');
    };
    reflectPassword();
    smtpForm.oninput=reflectPassword;
    smtpForm.onsubmit=event=>UI46Pages.submit(event,async()=>{
     feedback.textContent='';
     const body={version:transport.version,url:fields.url.value,from:fields.from.value,username:fields.username.value};
     if(fields.password.value)body.password=fields.password.value;
     try{
      Object.assign(transport,await API.request('/system/report-mail/transport',{method:'PUT',body}));
      fields.password.value='';
      reflectPassword();
      feedback.textContent=this.t('邮件服务器已保存','Mail server settings saved');
     }catch(error){
      if(error.statusCode===409)throw Error(this.t('邮件服务器设置已更新，请重新打开页面核对。','Mail server settings were updated. Reopen this page to review them.'));
      if(I18n.language==='en'&&error.statusCode===400)throw Error('Check the SMTP login, credential, and approved servers and senders.');
      if(I18n.language==='en'&&error.statusCode===503)throw Error('The server’s mail policy or encryption key is unavailable.');
      throw error;
     }
    });
   }
   const reflect=()=>{
    add.disabled=plans.children.length>=20;
    for(const card of plans.children){
     const daily=card.querySelector('[name=frequency]').value==='daily';
     for(const field of card.querySelectorAll('[data-monthly-report]'))field.disabled=daily;
     const choices=[...card.querySelectorAll('[name=recipientAccount]')];
     const limit=choices.filter(field=>field.checked).length>=8;
     for(const field of choices)field.disabled=limit&&!field.checked;
    }
   };
   add.onclick=()=>{
    if(form.getAttribute('aria-busy')==='true'||plans.children.length>=20)return;
    plans.insertAdjacentHTML('beforeend',plan({id:crypto.randomUUID(),hour:7,frequency:'daily',actor:'',recipientAccounts:[],reports:[]}));
    reflect();
    plans.lastElementChild.querySelector('h3').focus();
   };
   plans.onclick=event=>{
    const button=event.target.closest('[data-plan-remove]');
    if(button&&form.getAttribute('aria-busy')!=='true'){button.closest('[data-plan-id]').remove();reflect();add.focus();}
   };
   form.onchange=reflect;
   let lastRequest;
   form.onsubmit=event=>UI46Pages.submit(event,async()=>{
    status.textContent='';
    const schedules=[...plans.children].map(card=>({
     id:card.dataset.planId,
     hour:Number(card.querySelector('[name=hour]').value),
     frequency:card.querySelector('[name=frequency]').value,
     actor:card.querySelector('[name=actor]').value,
     ...(()=>{
      const recipientAccounts=[...card.querySelectorAll('[name=recipientAccount]:checked')].map(field=>field.value);
      const legacy=card.querySelector('[data-legacy-recipients]');
      return legacy&&!recipientAccounts.length?{recipients:JSON.parse(legacy.dataset.legacyRecipients)}:{recipientAccounts};
     })(),
     reports:[...card.querySelectorAll('[name=report]:checked:not(:disabled)')].map(field=>{
      const [kind,product]=field.value.split(':');
      return {kind,product};
     })
    }));
    const body={version:setting.version,enabled:form.elements.enabled.checked,schedules},signature=JSON.stringify(body);
    if(lastRequest?.signature!==signature)lastRequest={signature,key:crypto.randomUUID()};
    try{
     const saved=await API.request('/system/report-mail',{method:'PUT',body,idempotencyKey:lastRequest.key});
     setting.version=saved.version;lastRequest=null;
     [...plans.children].forEach((card,i)=>{
      if(schedules[i].recipientAccounts)card.querySelector('[data-legacy-recipients]')?.remove();
     });
     document.getElementById('report-mail-legacy')?.remove();
     document.getElementById('report-mail-updated').textContent=updateTime(saved.updatedAt);
     status.textContent=this.t('报表邮件设置已保存','Report email settings saved');
    }catch(error){
     if(!error.statusCode)throw Error(this.t('保存结果待确认。请保留当前内容，核对后可使用原请求重试。','Save result pending. Keep these settings and retry with the original request after checking.'));
     if(error.statusCode===409)throw Error(this.t('设置已更新，请重新打开页面核对。','Settings were updated. Reopen this page to review them.'));
     if(I18n.language==='en'&&error.statusCode===400)throw Error('Check the report account, report choices and recipient settings.');
     throw error;
    }
   });
   reflect();
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
