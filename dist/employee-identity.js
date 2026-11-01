'use strict';
const EmployeeIdentity={
 name(user){return I18n.language==='en'?(user.display_name_en||I18n.translate(user.display_name,true)):user.display_name;},
 role(user){return I18n.translate(Accounts.names[user.role_code]||'历史角色',true);},
 refresh(){if(!window.CurrentUser)return;const full=this.name(CurrentUser)+' / '+this.role(CurrentUser);for(const el of [document.getElementById('signed-user'),document.querySelector('.snapshot')])if(el){el.setAttribute('data-no-i18n','');el.textContent=full;}const footer=document.querySelector('.sidebar-bottom');if(footer){footer.setAttribute('data-no-i18n','');footer.textContent='V3.5 · '+full;}const avatar=document.querySelector('.avatar');if(avatar){avatar.setAttribute('data-no-i18n','');avatar.textContent=this.name(CurrentUser).slice(0,1);}for(const el of document.querySelectorAll('[data-employee-id]')){const user=Accounts.users?.find(u=>u.id===el.dataset.employeeId);if(user)el.textContent=this.name(user);}}
};
const identityLanguage=I18n.set.bind(I18n);I18n.set=function(language){identityLanguage(language);EmployeeIdentity.refresh();};EmployeeIdentity.refresh();
