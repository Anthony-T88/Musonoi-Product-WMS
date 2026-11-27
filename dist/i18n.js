'use strict';

const languageNames = Object.freeze({ 'zh-CN': '中文', en: 'English', fr: 'Français' });
const savedLanguage = localStorage.getItem('musonoi-language');
const escapeExpression = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

window.I18n = {
 languageNames,
 languageSelectorLabel: '语言/Language',
 language: Object.hasOwn(languageNames, savedLanguage) ? savedLanguage : 'zh-CN',
 supported: Object.keys(languageNames),
 original: new WeakMap(),
 attributes: new WeakMap(),
 protected: new Set(),
 get usesEnglish() { return this.language !== 'zh-CN'; },
 get locale() { return { 'zh-CN': 'zh-CN', en: 'en-US', fr: 'fr-FR' }[this.language]; },

 protectResponse(data, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 8) return;
  const fields = ['address','email','phone','username','truck_no','trailer_no','file_name','invoice_no','packing_list_no','export_license_no','transporter','destination','vehicle_no','shipment_batch_no','contract_no','name','customer','customer_name','allocated_customer','dispatched_customer','display_name','actor_name','creator_name','inbound_operator','locked_by_name','released_by_name','assigned_customer','remark','reason','result','description','resolution','review_note','note'];
  for (const [key,value] of Object.entries(data)) {
   if (key==='contract_nos' && Array.isArray(value)) {
    for (const number of value) if (typeof number==='string') this.protected.add(number);
   } else if (fields.includes(key) && typeof value==='string' && value.length>1 &&
             (key==='username'||!Object.hasOwn(TRANSLATIONS.en,value))) this.protected.add(value);
   else if (value && typeof value==='object') this.protectResponse(value,depth+1);
  }
 },
 protect(data) {
  for (const key of ['customers','projects','warehouses','yards','batches','locations']) {
   for (const item of data[key]||[]) if (item.name) this.protected.add(item.name);
  }
 },

 french(value, compose = true) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const key = value.trim();
  const exact = TRANSLATIONS.fr?.[key] ?? this.frenchIndex.get(key.toLowerCase());
  if (typeof exact === 'string') {
   const start = value.indexOf(key);
   return value.slice(0,start) + exact + value.slice(start+key.length);
  }
  return compose && this.frenchPattern
   ? value.replace(this.frenchPattern, phrase => this.frenchIndex.get(phrase.toLowerCase()) ?? phrase)
   : value;
 },
 label(chinese,english) {
  if (!this.usesEnglish) return chinese;
  if (this.language!=='fr') return english;
  return Array.isArray(english)?english.map(value=>this.french(value)):this.french(english);
 },
 translate(text, ui = false) {
  text=text?.replace(/(^|[\d\s（(])t(?=$|[\s）)·/])/g,'$1吨');
  if (!text || !text.trim()) return text;
  if (!this.usesEnglish) {
   if (this.protected.has(text.trim())) return text;
   return text.replace(/（Packing\s*List\s*No[.]?）|\(Packing\s*List\s*No[.]?\)/gi,'')
    .replace(/Packing\s*List\s*No[.]?/gi,'装箱单号').replace(/Packing\s*List/gi,'装箱单');
  }
  let value=text;
  const protectedValues=[];
  for (const item of ui&&this.language!=='fr'?[]:this.protected) {
   if (value.includes(item)) {
    const id=protectedValues.push(item)-1;
    value=value.split(item).join('⟦'+id+'⟧');
   }
  }
  const key=value.trim();
  const hasChinese=/\p{Script=Han}/u.test(value);
  if (Object.hasOwn(TRANSLATIONS.en,key)) {
   const start=value.indexOf(key);
   value=value.slice(0,start)+TRANSLATIONS.en[key]+value.slice(start+key.length);
  } else value=value.replace(this.pattern, phrase=>' '+TRANSLATIONS.en[phrase]+' ').replace(/ {2,}/g,' ').trim();
  value=value.replace(/\bt\b/g,'MT').replaceAll('吨','MT');
  if (this.language==='fr') value=this.french(value,ui||hasChinese);
  return value.replace(/⟦(\d+)⟧/g,(_,id)=>protectedValues[Number(id)]);
 },

 apply() {
  if (!document.body) return;
  this.observer?.disconnect();
  window.PageTextDesigner?.beforeTranslation();
  document.querySelectorAll('option:not([value])').forEach(option=>option.setAttribute('value',option.textContent));
  const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const context='[data-i18n],button,label,th,dt,legend,h1,h2,h3,summary,caption,.brand,.login-card,.account-tabs,#account-content,#dashboard-content';
  for (let node=walk.nextNode();node;node=walk.nextNode()) {
   const parent=node.parentElement;
   if (!parent) continue;
   const old=this.original.get(node);
   const source=old&&node.nodeValue===old.rendered?old.source:node.nodeValue;
   let rendered;
   if (window.ProductContext?.isCopper() && source.trim()==='临时堆存区') {
    rendered=this.label('新生产捆包堆存区','New Production Bundles Stock Area');
   } else if (window.ProductContext?.isCopper() && source.trim()==='P3-LEFTOVER') {
    rendered=this.label('剩余捆包堆存区','Left Over Bundles Stock Area');
   } else {
    if (parent.closest('script,style,textarea,pre,[data-no-i18n]')||window.PageTextDesigner?.hasOverride(node)) continue;
    const english=TRANSLATIONS.en[parent.getAttribute('data-i18n-key')];
    rendered=this.usesEnglish&&english?this.label(source,english):this.translate(source,!!parent.closest(context));
   }
   if (rendered!==node.nodeValue) node.nodeValue=rendered;
   this.original.set(node,{source,rendered});
  }
  const attributes=['placeholder','title','aria-label','alt','data-label'];
  for (const element of document.querySelectorAll(attributes.map(key=>'['+key+']').join(','))) {
   if (element.closest('[data-no-i18n]')) continue;
   const previous=this.attributes.get(element)||{};
   for (const key of attributes) if (element.hasAttribute(key)) {
    const value=element.getAttribute(key);
    const source=previous[key]&&value===previous[key].rendered?previous[key].source:value;
    const rendered=this.translate(source,!!element.closest('[data-i18n],.brand,.login-card'));
    if (value!==rendered) element.setAttribute(key,rendered);
    previous[key]={source,rendered};
   }
   this.attributes.set(element,previous);
  }
  const currentTitle=document.title;
  const sourceTitle=this.titleValue&&currentTitle===this.titleValue.rendered?this.titleValue.source:currentTitle;
  const declared=document.querySelector('title')?.dataset;
  const titles={ 'zh-CN':declared?.titleZh, en:declared?.titleEn, fr:declared?.titleFr };
  const title=(Object.values(titles).includes(sourceTitle)&&titles[this.language])||this.translate(sourceTitle,true);
  document.title=title;
  this.titleValue={source:sourceTitle,rendered:title};
  document.documentElement.lang=this.language;
  const copyright=document.querySelector('[data-login-copyright]');
  if (copyright) copyright.textContent=this.label('© 2026 唐雷 · 保留所有权利','© 2026 Tang Lei · All rights reserved.');
  window.PageTextDesigner?.apply();
  this.observer?.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});
 },

 set(language) {
  if (!this.supported.includes(language)) throw Error('Unsupported language');
  this.language=language;
  localStorage.setItem('musonoi-language',language);
  document.querySelectorAll('[data-language]').forEach(select=>select.value=language);
  this.apply();
 },
 async change(language) {
  const old=this.language;
  try {
   if (!this.supported.includes(language)) throw Error('Unsupported language');
   if (window.AppSignedIn) {
    await API.request('/me/language',{method:'POST',body:{language},idempotencyKey:crypto.randomUUID()});
    if (window.CurrentUser) CurrentUser.language_code=language;
   }
   this.set(language);
  } catch (error) {
   this.set(old);
   if (window.notify) notify(error.message);
   else document.getElementById('login-error').textContent=error.message;
  }
 },
 attach() {
  const select=document.createElement('select');
  select.className='language-select';
  select.dataset.language='';
  select.setAttribute('data-no-i18n','');
  select.setAttribute('aria-label',this.languageSelectorLabel);
  for (const [code,name] of Object.entries(languageNames)) {
   const option=document.createElement('option');
   option.value=option.lang=code;
   option.textContent=name;
   select.append(option);
  }
  select.value=this.language;
  select.onchange=()=>this.change(select.value);
  const wrapper=document.createElement('label');
  wrapper.className='system-language';
  const label=document.createElement('span');
  label.textContent=this.languageSelectorLabel;
  label.setAttribute('data-no-i18n','');
  wrapper.append(label,select);
  document.querySelector('.top-actions')?.prepend(wrapper);
  const loginWrapper=wrapper.cloneNode(true),login=loginWrapper.querySelector('select');
  login.value=this.language;
  login.onchange=()=>this.change(login.value);
  document.querySelector('.login-card')?.append(loginWrapper);
 },
 init() {
  this.pattern=new RegExp(Object.keys(TRANSLATIONS.en).filter(Boolean).sort((a,b)=>b.length-a.length).map(escapeExpression).join('|'),'g');
  this.frenchIndex=new Map(Object.entries(TRANSLATIONS.fr||{}).map(([phrase,value])=>[phrase.toLowerCase(),value]));
  const phrases=[...this.frenchIndex.keys()].filter(value=>/\p{L}/u.test(value)).sort((a,b)=>b.length-a.length);
  if (phrases.length) this.frenchPattern=new RegExp('(?<![\\p{L}\\p{N}_])(?:'+phrases.map(escapeExpression).join('|')+')(?![\\p{L}\\p{N}_])','giu');
  this.observer=new MutationObserver(()=>{
   if (this.scheduled) return;
   this.scheduled=true;
   queueMicrotask(()=>{this.scheduled=false;this.apply();});
  });
  this.attach();
  this.apply();
 }
};
I18n.init();
