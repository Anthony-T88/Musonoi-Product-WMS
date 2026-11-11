'use strict';

(function(root){
 const errors={
  NAME_REQUIRED:['请输入姓名','Enter your name'],
  NAME_LENGTH:['姓名最多80个字符','Name must be at most 80 characters'],
  USERNAME_REQUIRED:['请输入登录账号','Enter a username'],
  USERNAME_FORMAT:['账号须为3–40位小写字母、数字或下划线，以字母开头','Use 3–40 lowercase letters, digits or underscores, beginning with a letter'],
  USERNAME_USED:['用户名已被使用','Username is already in use'],
  USERNAME_PENDING:['该账号已有待审批申请','An application for this username is pending'],
  CONTACT_REQUIRED:['请填写联系号码或联系邮箱','Enter a phone number or email address'],
  PHONE_FORMAT:['请输入有效联系号码，含5–20位数字','Enter a valid phone number containing 5–20 digits'],
  EMAIL_FORMAT:['请输入有效联系邮箱','Enter a valid email address'],
  PASSWORD_REQUIRED:['请输入密码','Enter a password'],
  PASSWORD_LENGTH:['密码须为12–128个字符','Password must contain 12–128 characters'],
  CONFIRM_REQUIRED:['请再次输入密码','Confirm the password'],
  PASSWORD_MISMATCH:['两次密码不一致','Passwords do not match']
 };
 const text=value=>typeof value==='string'?value.trim():'';
 function validate(input,{requireConfirmation=true}={}){
  const out={},fail=(field,code)=>{out[field]=code;};
  const username=text(input.username),display_name=text(input.display_name);
  const contact_phone=text(input.contact_phone),contact_email=text(input.contact_email),legacy=text(input.contact);
  const password=typeof input.password==='string'?input.password:'';
  if(!display_name)fail('display_name','NAME_REQUIRED');else if(display_name.length>80)fail('display_name','NAME_LENGTH');
  if(!username)fail('username','USERNAME_REQUIRED');else if(!/^[a-z][a-z0-9_]{2,39}$/.test(username))fail('username','USERNAME_FORMAT');
  if(input.contact_phone!=null&&typeof input.contact_phone!=='string'||contact_phone&&(contact_phone.length>40||!/^\+?[0-9() .-]+$/.test(contact_phone)||!/^\d{5,20}$/.test(contact_phone.replace(/\D/g,''))))fail('contact_phone','PHONE_FORMAT');
  if(input.contact_email!=null&&typeof input.contact_email!=='string'||contact_email&&(contact_email.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)))fail('contact_email','EMAIL_FORMAT');
  const useLegacy=!Object.hasOwn(input,'contact_phone')&&!Object.hasOwn(input,'contact_email')&&legacy.length<=160;
  const contact=contact_phone||contact_email||(useLegacy?legacy:'');
  if(!contact&&!out.contact_phone&&!out.contact_email)fail('contact_phone','CONTACT_REQUIRED');
  if(!password)fail('password','PASSWORD_REQUIRED');else if(password.length<12||password.length>128)fail('password','PASSWORD_LENGTH');
  if(requireConfirmation||Object.hasOwn(input,'confirm')){
   if(typeof input.confirm!=='string'||!input.confirm)fail('confirm','CONFIRM_REQUIRED');
   else if(input.confirm!==password)fail('confirm','PASSWORD_MISMATCH');
  }
  return {errors:out,values:{username,display_name,password,contact,contact_phone:contact_phone||null,contact_email:contact_email||null}};
 }
 const policy={validate,errors};
 if(typeof module==='object'&&module.exports)module.exports=policy;else root.RegistrationPolicy=policy;
})(globalThis);
