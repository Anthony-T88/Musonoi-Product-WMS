'use strict';
window.PageTextDesigner={
 overrides:new Map(),candidates:new Map(),selected:'',picking:false,
 roots:'#inventory,#dashboard,#field,#business-page,#dialog[open]',
 editable:'h1,h2,h3,h4,button,a.button,label,legend,th,dt,p,summary,caption,[role=tab],.oa-kpi>span',
 protected:'script,style,pre,code,textarea,option,svg,[contenteditable],.packing-sheet,.print-page,.shipping-preview,.oa-design-handle,#overview-designer,#operation-designer-open',
 t:(zh,en)=>I18n.language==='en'?en:zh,
 context(){return PageLayout.scope()+'|'+I18n.language;},
 original(node){
  const edit=this.overrides.get(node);
  return edit&&node.nodeValue===edit.replacement?edit.source:node.nodeValue;
 },
 beforeTranslation(){
  if(OverviewDesigner.dialog?.open&&!OverviewDesigner.editing())OverviewDesigner.dialog.close();
  if(!this.overrides.size)return;
  if(window.AppSignedIn&&this.currentContext===this.context())return;
  for(const [node,edit] of this.overrides)if(node.nodeValue===edit.replacement)node.nodeValue=edit.source;
  this.overrides.clear();
 },
 hasOverride(node){const edit=this.overrides.get(node);return !!edit&&node.nodeValue===edit.replacement;},
 candidate(node){
  const el=node.parentElement,host=el?.closest(this.editable);
  if(!host||el.closest(this.protected)||host.closest('[hidden]')||host.matches('th[scope=row]')||host.closest('tbody')&&!host.matches('button,a.button'))return;
  const literal=el.closest('[data-no-i18n]');
  if(literal&&(literal===el||literal===host||!literal.matches('div,section,article,main,header,form,aside,nav,table')))return;
  const source=this.original(node),label=source.trim().replace(/\s+/g,' ');
  if(!label||I18n.protected.has(label)||label.length>240||!/\p{L}/u.test(label)||
     /\b\d{4}-\d{1,2}(?:-\d{1,2})?\b|\b[A-Z]{2,}(?:-[A-Z0-9]+){1,}\b|\d+[.,]\d+|\d+\s*(?:吨|捆|袋|辆|kg|MT|%)(?:\b|$)/.test(label))return;
  const kind=host.matches('h1')?'title':host.matches('h2,h3,h4')?'heading':
   host.matches('button,a.button')?'button':host.matches('label,legend,dt')?'label':
   host.matches('th')?'column':host.matches('summary,[role=tab]')?'tab':host.matches('p')?'note':'caption';
  const id=/^[A-Za-z][A-Za-z0-9_-]{0,64}$/.test(host.id)&&!/[0-9a-f]{8}-[0-9a-f]{4}/i.test(host.id)?'#'+host.id:'';
  const key=kind+id+'|'+label;
  if(PageTextModel.validKey(key))return {key,host,label,source};
 },
 configured(){
  if(OverviewDesigner.editing())return OverviewDesigner.draft.labels;
  return PageLayout.rows.get(PageLayout.scope())?.settings.pageText?.[I18n.language]||{};
 },
 scan(){
  const result=new Map();
  for(const root of document.querySelectorAll(this.roots)){
   if(root.closest('[hidden],[inert]')||root.parentElement.closest(this.roots))continue;
   const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
   let node;
   while((node=walk.nextNode())){
    const candidate=this.candidate(node);if(!candidate)continue;
    const items=result.get(candidate.key)||[];
    items.push({...candidate,node});result.set(candidate.key,items);
   }
  }
  return result;
 },
 apply(){
  if(!window.AppSignedIn||!window.PageLayout||!window.PageTextModel)return;
  const context=this.context(),labels=this.configured(),editing=OverviewDesigner.editing()&&OverviewDesigner.tab==='text';
  this.currentContext=context;
  if(!editing&&!this.overrides.size&&!Object.keys(labels).length)return;
  const result=this.scan(),current=new Map();
  for(const [key,nodes] of result){
   if(!Object.hasOwn(labels,key))continue;
   for(const {node,source} of nodes){
    const replacement=(source.match(/^\s*/)?.[0]||'')+labels[key]+(source.match(/\s*$/)?.[0]||'');
    if(node.nodeValue!==replacement)node.nodeValue=replacement;
    current.set(node,{source,replacement});
   }
  }
  for(const [node,edit] of this.overrides)if(!current.has(node)&&node.nodeValue===edit.replacement)node.nodeValue=edit.source;
  this.overrides=current;
  if(editing){this.candidates=result;this.updatePicker();}
 },
 schedule(){
  if(this.queued||!OverviewDesigner.editing()&&!this.overrides.size&&(!window.AppSignedIn||!Object.keys(this.configured()).length))return;
  this.queued=true;
  queueMicrotask(()=>{this.queued=false;I18n.apply();});
 },
 updatePicker(){
  const rows=[...this.candidates].map(([key,[item]])=>[key,item.label]);
  const signature=JSON.stringify(rows);
  if(signature!==this.pickerSignature){
   this.pickerSignature=signature;
   this.form.elements.key.replaceChildren(...rows.map(([key,label])=>new Option(label,key)));
   if(!this.candidates.has(this.selected))this.select(rows[0]?.[0]||'');
  }
  this.markSelected();
 },
 markSelected(){
  const targets=new Set(this.picking?(this.candidates.get(this.selected)||[]).map(item=>item.host):[]);
  for(const node of this.highlighted||[])if(!targets.has(node))node.removeAttribute('data-page-text-selected');
  for(const node of targets)node.setAttribute('data-page-text-selected','');
  this.highlighted=targets;
 },
 select(key){
  if(!this.form||!OverviewDesigner.draft)return;
  this.selected=key;
  this.form.elements.key.value=key;
  this.form.elements.value.value=OverviewDesigner.draft.labels[key]??'';
  this.form.querySelector('[data-text-original]').textContent=this.candidates.get(key)?.[0]?.label||'';
  this.markSelected();
 },
 togglePicking(enabled){
  this.picking=enabled;
  document.body.toggleAttribute('data-page-text-picking',enabled);
  this.markSelected();
  const button=this.form.querySelector('[data-text-pick]');
  button.setAttribute('aria-pressed',String(enabled));
  button.textContent=enabled?this.t('结束点选','Stop Picking'):this.t('点选页面文字','Pick Page Text');
 },
 clear(){
  if(!this.form)return;
  this.candidates.clear();this.selected='';this.pickerSignature=null;this.togglePicking(false);
 },
 init(){
  const dialog=OverviewDesigner.dialog;
  if(!dialog)return;
  this.form=OverviewDesigner.form;
  this.form.querySelector('[data-text-pick]').onclick=()=>this.togglePicking(!this.picking);
  this.form.querySelector('[data-text-reset]').onclick=()=>{
   OverviewDesigner.draft.labels={};this.select(this.selected);OverviewDesigner.sync();
  };
  this.form.elements.key.onchange=e=>this.select(e.target.value);
  this.form.elements.value.oninput=e=>{
   if(!this.selected)return;
   const text=e.target.value.trim(),labels=OverviewDesigner.draft.labels;
   if(text&&(!PageTextModel.validText(text)||!Object.hasOwn(labels,this.selected)&&Object.keys(labels).length>=250)){
    OverviewDesigner.validation(true);return;
   }
   if(text)labels[this.selected]=text;else delete labels[this.selected];
   OverviewDesigner.sync();
  };
  document.addEventListener('click',event=>{
   if(!OverviewDesigner.editing()||!this.picking||OverviewDesigner.saving||dialog.contains(event.target))return;
   const host=event.target.closest(this.editable);
   if(!host)return;
   const hit=[...this.candidates].find(([,items])=>items.some(item=>item.host===host));
   if(!hit)return;
   event.preventDefault();event.stopImmediatePropagation();this.select(hit[0]);this.form.elements.value.focus();
  },true);
 }
};
