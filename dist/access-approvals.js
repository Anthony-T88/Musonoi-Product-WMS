'use strict';

window.AccessApprovals={
 path:'/workbench/access-approvals',
 canRequest(){return CurrentUser.permissions.some(p=>['users:manage','roles:manage'].includes(p));},
 permission(){return CurrentUser.permissions.find(p=>['access-change:approve','users:manage','roles:manage'].includes(p))||'access-change:approve';},
 pending(result){
  if(!result?.approval_pending)return false;
  notify(System46.t('权限变更已提交，待总经理审批。','Change submitted for General Manager approval.'));
  return true;
 },
 async open(){
  const s=System46,t=s.t,q=new URLSearchParams(location.search);
  const data=await API.request('/security/access-requests?'+q);
  const selected=q.get('state')||'PENDING';
  const states={PENDING:['待审批','Pending'],APPROVED:['已通过','Approved'],REJECTED:['已驳回','Rejected'],
   STALE:['已失效','Stale'],WITHDRAWN:['已撤回','Withdrawn'],ALL:['全部','All']};
  const kinds={USER_CREATE:['开通账号','Create Account'],USER_UPDATE:['修改账户权限','Change Account Access'],
   USER_RESTORE:['恢复账号','Restore Account'],USER_PASSWORD_RESET:['重置账号密码','Reset Account Password'],
   REGISTRATION_GRANT:['批准注册与赋权','Approve Registration & Access'],ROLE_PERMISSIONS:['修改角色权限','Change Role Permissions']};
  const permissions=(before,after)=>{
   const names=CurrentUser.language_code==='en'?data.permission_names_en:data.permission_names;
   const values=list=>list.length?list.map(p=>esc(names?.[p]||p)).join('、'):'—';
   return [[t('新增权限','Granted'),values(after.filter(p=>!before.includes(p)))],[t('移除权限','Revoked'),values(before.filter(p=>!after.includes(p)))]];
  };
  const scopeValues=value=>value?.scopes?.map(scope=>[scope.project_id,scope.warehouse_id,scope.customer_id]
   .filter(Boolean).map(id=>data.scope_names[id]||id).join(' / ')).join(' · ')||'—';
  const role=value=>data.role_names[value?.role_code]||value?.role_code||'—';
  const status=value=>value?.deleted?t('已删除','Deleted'):value?.active===true?t('启用','Active'):value?.active===false?t('停用','Inactive'):'—';
  const displayName=value=>value?.display_name||'—';
  const diff=row=>{
   const before=row.before_data,after=row.after_data;
   const fields=after.permissions?permissions(before?.permissions||[],after.permissions):[
    [t('岗位','Role'),esc(role(before))+' → '+esc(role(after))],
    [t('数据范围','Data Scope'),esc(scopeValues(before))+' → '+esc(scopeValues(after))],
    [t('账号状态','Account Status'),esc(status(before))+' → '+esc(status(after))]
   ];
   if(before?.display_name!==after.display_name&&!after.permissions){
    fields.push([t('显示姓名','Display Name'),esc(displayName(before))+' → '+esc(displayName(after))]);
   }
   return '<dl class="s46-facts">'+fields.map(([name,value])=>'<div><dt>'+esc(name)+'</dt><dd data-no-i18n>'+value+'</dd></div>').join('')+'</dl>';
  };
  const decisionForm=row=>{
   if(row.state!=='PENDING')return '';
   const note='<label>'+s.L('审批备注（驳回时必填）','Review note (required for rejection)')+'<input name="note" maxlength="500"></label>';
   return '<form class="user-form wms-access-decision" data-request-id="'+esc(row.id)+'">'+
    (data.can_review?'<div class="form-grid wms-field-grid"><label>'+s.L('总经理当前密码','General Manager’s current password')+
     '<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label>'+note+'</div>':'')+
    '<div class="wms-access-decision-actions">'+(data.can_review?
     '<button name="decision" value="APPROVED" class="button primary">'+s.L('审批通过','Approve')+'</button>'+
     '<button name="decision" value="REJECTED" class="button danger-outline">'+s.L('驳回申请','Reject')+'</button>':
     '<button name="decision" value="WITHDRAWN" class="button secondary">'+s.L('撤回申请','Withdraw')+'</button>')+
    '</div><p class="error" role="alert"></p></form>';
  };
  const cards=data.items.map(row=>{
   const title=esc(row.target_label)+' · '+esc(t(...kinds[row.kind]));
   return '<details class="s46-card"><summary>'+title+' · '+esc(t(...states[row.state]))+'</summary>'+
    '<p class="s46-muted"><span data-no-i18n>'+esc(EmployeeIdentity.name({display_name:row.requester_name}))+'</span> · '+
    '<time data-no-i18n datetime="'+esc(row.requested_at)+'">'+esc(BusinessTime.display(row.requested_at))+'</time></p>'+
    diff(row)+(row.reviewed_at?'<p class="s46-muted" data-no-i18n>'+esc(EmployeeIdentity.name({display_name:row.reviewer_name})||'—')+
     ' · '+esc(BusinessTime.display(row.reviewed_at))+(row.decision_note?' · '+esc(row.decision_note):'')+'</p>':'')+
    decisionForm(row)+'</details>';
  }).join('');
  const control='<form id="access-approval-filter" class="s46-filter"><div class="s46-actions"><label>'+s.L('申请状态','Request Status')+
   '<select name="state">'+Object.entries(states).map(([key,names])=>'<option value="'+key+'"'+(key===selected?' selected':'')+'>'+esc(t(...names))+'</option>').join('')+
   '</select></label><button class="button primary">'+s.L('查询','Search')+'</button></div></form>';
  const pageLink=(page,zh,en)=>s.link(this.path+'?'+new URLSearchParams({state:selected,page}),zh,en);
  s.page('权限变更审批','Access Change Approvals','SYS-17',
   control+(!data.approver_ready?'<p class="wms-feedback" role="status">'+s.L('总经理账号待维护启用。','The General Manager account is awaiting activation by maintenance.')+'</p>':'')+
   (cards||s.stateHTML('empty'))+
   '<div class="s46-actions">'+(data.page>1?pageLink(data.page-1,'上一页','Previous'):'')+
   (data.has_more?pageLink(data.page+1,'下一页','Next'):'')+'</div>');
  document.getElementById('access-approval-filter').onsubmit=e=>{
   e.preventDefault();
   Router.go(this.path+'?'+new URLSearchParams(new FormData(e.currentTarget)));
  };
  for(const form of document.querySelectorAll('.wms-access-decision')){
   form.onsubmit=async e=>{
    e.preventDefault();
    const decision=e.submitter?.value;
    if(!decision)return;
    const error=form.querySelector('[role="alert"]'),body={decision};
    if(form.elements.note)body.note=form.elements.note.value.trim();
    if(decision==='REJECTED'&&!body.note){
     error.textContent=t('请填写驳回原因。','Enter a reason for rejection.');
     form.elements.note.focus();
     return;
    }
    if(form.elements.password)body.password=form.elements.password.value;
    error.textContent='';
    e.submitter.disabled=true;
    try{
     const result=await API.request('/security/access-requests/'+form.dataset.requestId+'/decision',{method:'POST',body});
     notify(t(...states[result.state]));
     await Router.show();
    }catch(e){error.textContent=I18n.translate(e.message,true);}
    finally{
     if(form.elements.password)form.elements.password.value='';
     if(e.submitter)e.submitter.disabled=false;
    }
   };
  }
 }
};
