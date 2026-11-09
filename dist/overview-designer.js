'use strict';
window.OverviewDesigner={
 states:new WeakMap(),draft:null,selected:'intro',dragged:null,saving:false,
 selectors:{
  intro:'.oa-design-intro',metrics:'.oa-kpis',net:'[data-oa-plot="net"]',vehicles:'[data-oa-plot="vehicles"]',
  stock:'.oa-state-list',customers:'.oa-customer,.oa-three .oa-panel:nth-child(2)',
  attention:'.oa-attention-counts',execution:'.oa-execution',flow:'.oa-flow',balance:'.oa-balance-panel'
 },
 t:(zh,en)=>I18n.language==='en'?en:zh,
 active(){return !!window.AppSignedIn;},
 isOverview(){return location.pathname==='/overview'&&!new URLSearchParams(location.search).has('management');},
 editing(){return this.dialog?.open&&this.draft?.scope===PageLayout.scope()&&this.draft.language===I18n.language;},
 page(){return OverviewAnalysis.current?.root?.isConnected?OverviewAnalysis.current.root:null;},
 label(key){return OverviewDesignModel.blocks[key]?this.t(...OverviewDesignModel.blocks[key]):PageDesignCanvas.label(key);},
 handle(id,className='oa-design-handle'){
  const button=document.createElement('button');
  button.type='button';button.className=className;button.draggable=true;button.dataset.noI18n='';
  button.textContent='⋮⋮ '+this.label(id);
  button.onclick=()=>this.select(id);
  button.ondragstart=e=>{this.dragged=id;e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='move';};
  button.ondragend=()=>{this.dragged=null;};
  return button;
 },
 mount(root){
  const entries=Object.entries(this.selectors).map(([key,selector])=>{
   const child=root.querySelector(selector);
   return [key,child?.closest('.oa-panel')||child];
  }).filter(([,node])=>node);
  const original=[...root.children],groups=new Map(entries.map(([,node])=>[node.parentElement,[...node.parentElement.children]]));
  this.states.set(root,{nodes:new Map(entries),original,groups,signature:null});
  root.addEventListener('click',e=>{
   if(!this.editing()||this.draft.kind!=='overviewDesign'||e.target.closest('button,a,select,input,textarea,summary'))return;
   const id=e.target.closest('[data-oa-design-block]')?.dataset.oaDesignBlock;
   if(id)this.select(id);
  });
  this.apply();
 },
 restore(root,state){
  for(const [parent,children] of state.groups)if(parent!==root)parent.append(...children);
  root.append(...state.original);
  root.style.removeProperty('--oa-design-gap');root.classList.remove('oa-designed');
 },
 apply(){
  if(this.trigger)this.trigger.hidden=!this.active();
  const scope=PageLayout.scope(),settings=PageLayout.rows.get(scope)?.settings;
  const editing=this.editing(),editBlocks=editing&&this.draft.kind==='blockDesign';
  PageDesignCanvas.apply(this.active()?(editBlocks?this.draft.design:settings?.blockDesign):null,editBlocks,this.selected,editBlocks&&this.draft.modal);
  if(editBlocks&&this.canvasSignature!==[...PageDesignCanvas.nodes.keys()].join(',')){
   this.canvasSignature=[...PageDesignCanvas.nodes.keys()].join(',');this.updateFields();
  }
  const root=this.page(),state=root&&this.states.get(root);
  if(!this.active()||!this.isOverview()||!state)return;
  const editOverview=editing&&this.draft.kind==='overviewDesign';
  const design=editOverview?this.draft.design:settings?.overviewDesign;
  const signature=JSON.stringify([design||null,!!editOverview,editOverview?this.selected:null]);
  if(state.signature===signature)return;
  state.signature=signature;
  for(const node of state.nodes.values()){
   node.querySelector(':scope > .oa-design-handle')?.remove();
   node.removeAttribute('data-oa-design-block');node.removeAttribute('data-oa-design-selected');
   for(const key of ['width','padding','background','alignment'])node.style.removeProperty('--oa-design-'+key);
  }
  if(!design){this.restore(root,state);return;}
  root.classList.add('oa-designed');root.style.setProperty('--oa-design-gap',design.gap+'px');
  const nodes=design.order.map(id=>state.nodes.get(id)).filter(Boolean);
  if(nodes.some((node,i)=>root.children[i]!==node))root.prepend(...nodes);
  for(const [id,node] of state.nodes){
   const style=design.blocks[id]||{};
   node.dataset.oaDesignBlock=id;
   node.style.setProperty('--oa-design-width',String(style.width??OverviewDesignModel.blocks[id][2]));
   if(style.padding!==undefined)node.style.setProperty('--oa-design-padding',style.padding+'px');
   if(style.alignment)node.style.setProperty('--oa-design-alignment',style.alignment);
   if(style.background)node.style.setProperty('--oa-design-background',style.background);
   if(editOverview){
    node.toggleAttribute('data-oa-design-selected',this.selected===id);
    node.prepend(this.handle(id));
   }
  }
 },
 available(){
  if(this.draft.kind==='blockDesign')return PageDesignCanvas.orderedIds(this.draft.design,[...PageDesignCanvas.nodes.keys()]);
  const state=this.states.get(this.page());
  return this.draft.design.order.filter(id=>state?.nodes.has(id));
 },
 siblings(id){
  const ids=this.available();
  if(this.draft.kind==='overviewDesign')return ids;
  const parent=PageDesignCanvas.nodes.get(id)?.parentElement;
  return ids.filter(key=>PageDesignCanvas.nodes.get(key)?.parentElement===parent);
 },
 move(id,target){
  const siblings=this.siblings(id),from=siblings.indexOf(id),to=siblings.indexOf(target);
  if(from<0||to<0||from===to)return;
  const sameGroup=new Set(siblings);
  siblings.splice(from,1);siblings.splice(to,0,id);
  const fullOrder=[...new Set([...this.draft.design.order,...sameGroup])];
  if(fullOrder.length>250)return;
  let index=0;
  this.draft.design.order=fullOrder.map(key=>sameGroup.has(key)?siblings[index++]:key);
  this.selected=id;this.draft.reset=false;
  this.sync();
 },
 select(id){if(this.saving)return;this.selected=id;this.updateFields();this.apply();},
 updateFields(){
  if(this.saving)return;
  const form=this.form.elements,available=this.available(),options=available.map(id=>[this.label(id),id]);
  const signature=JSON.stringify(options);
  if(signature!==this.optionSignature){
   this.optionSignature=signature;
   form.block.replaceChildren(...options.map(([label,id])=>new Option(label,id)));
  }
  if(!available.includes(this.selected))this.selected=available[0]||'';
  form.block.value=this.selected;
  this.form.querySelector('[data-design-block-id]').textContent=this.selected?'ID · '+this.selected:'';
  const style=this.draft.design.blocks[this.selected]||{};
  for(const key of ['width','padding','alignment','background'])form[key].value=style[key]??'';
  form.gap.value=this.draft.design.gap??'';
  form.gap.options[0].hidden=this.draft.kind==='overviewDesign';
  const siblings=this.siblings(this.selected),index=siblings.indexOf(this.selected);
  this.form.querySelector('[data-design-up]').disabled=index<=0;
  this.form.querySelector('[data-design-down]').disabled=index<0||index===siblings.length-1;
 },
 sync(){
  this.code.value=JSON.stringify({layout:this.draft.design,text:this.draft.labels},null,2);
  this.validation(false);this.updateFields();this.apply();PageTextDesigner.schedule();
 },
 validation(invalid){
  this.invalid=invalid;
  this.form.querySelector('[type=submit]').disabled=invalid;
  this.error.textContent=invalid?this.t('代码无效。请检查区块 ID、样式值和文字内容。','Invalid code. Check block IDs, styles and text.'):'';
 },
 defaults(kind){return kind==='overviewDesign'?OverviewDesignModel.defaults():OverviewDesignModel.pageDefaults();},
 async open(modal=false){
  await PageLayout.refresh();
  if(!this.active()||this.dialog.open||this.saving)return;
  const parent=modal?document.querySelector('#dialog[open]'):document.body;
  if(!parent)return;
  PageLayout.dialog?.close();
  const scope=PageLayout.scope(),row=PageLayout.rows.get(scope),language=I18n.language;
  const kind=!modal&&this.isOverview()&&this.page()?'overviewDesign':'blockDesign';
  this.draft={scope,language,modal,kind,version:row?.version||0,settings:{...row?.settings},
   design:structuredClone(row?.settings[kind]||this.defaults(kind)),labels:{...row?.settings.pageText?.[language]},reset:false};
  if(kind==='blockDesign')this.draft.design.order=[
   ...new Set([...this.draft.design.order,...PageDesignCanvas.scan(modal).keys()])
  ].slice(0,250);
  this.selected='';parent.append(this.dialog);this.dialog.show();this.showTab('layout');this.sync();
  this.form.querySelector('[data-design-scope-hint]').textContent=kind==='overviewDesign'?'':this.t(
   '区块可在同一区域内重新排序。','Blocks can be reordered within the same area.');
 },
 showTab(tab){
  this.tab=tab;
  for(const button of this.dialog.querySelectorAll('[data-design-tab]'))button.setAttribute('aria-pressed',String(button.dataset.designTab===tab));
  for(const panel of this.dialog.querySelectorAll('[data-design-panel]'))panel.hidden=panel.dataset.designPanel!==tab;
  PageTextDesigner.togglePicking(tab==='text');PageTextDesigner.schedule();
 },
 init(){
  const modal=document.querySelector('#dialog');
  const observe=new MutationObserver(records=>{
   if(records.every(record=>record.target.closest('#overview-designer')||
      record.type==='childList'&&[...record.addedNodes,...record.removedNodes].every(node=>node.matches?.('.oa-design-handle,#overview-designer'))))return;
   if(this.frame)return;
   this.frame=requestAnimationFrame(()=>{
    this.frame=0;
    if(this.dialog?.open&&(!this.editing()||this.draft.modal&&!modal.open))this.dialog.close();
    this.apply();
   });
  });
  const watch={childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']};
  observe.observe(document.querySelector('.workspace'),watch);
  observe.observe(modal,watch);
  if(CurrentUser.role_code!=='admin'||!CurrentUser.permissions.includes('system:manage'))return;
  const t=this.t,m=OverviewDesignModel,options=(values,labels)=>values.map((v,i)=>'<option value="'+v+'">'+(labels?.[i]??v)+'</option>').join('');
  this.trigger=document.createElement('button');this.trigger.id='overview-designer-open';this.trigger.className='button primary';this.trigger.type='button';this.trigger.textContent=t('可视化设计','Visual Designer');
  document.querySelector('.top-actions').append(this.trigger);this.trigger.onclick=()=>this.open();
  const modalTrigger=this.trigger.cloneNode(true);modalTrigger.id='operation-designer-open';modalTrigger.dataset.noI18n='';
  modal.querySelector('.dialog-header').insertBefore(modalTrigger,modal.querySelector('#close-dialog'));
  modalTrigger.onclick=()=>{if(this.dialog.open&&!this.draft?.modal)this.dialog.close();this.open(true);};
  const d=document.createElement('dialog');d.id='overview-designer';d.dataset.noI18n='';d.setAttribute('aria-labelledby','overview-designer-title');
  const field=(name,label,items)=>'<label>'+label+'<select name="'+name+'">'+items+'</select></label>',inherit='<option value="">'+t('默认','Default')+'</option>';
  d.innerHTML='<form><header><h2 id="overview-designer-title">'+t('页面可视化设计器','Page Visual Designer')+'</h2><button type="button" data-design-close aria-label="'+t('关闭','Close')+'">×</button></header>'+
   '<nav class="design-actions"><button type="button" data-design-tab="layout">'+t('区块与样式','Blocks & Styles')+'</button><button type="button" data-design-tab="text">'+t('编辑文字','Edit Text')+'</button><button type="button" data-design-tab="code">'+t('代码','Code')+'</button></nav>'+
   '<section data-design-panel="layout"><p>'+t('拖动区块把手，或选择区块后调整样式和顺序。','Drag block handles or select a block to change its style and order.')+'</p>'+
   '<p data-design-scope-hint></p>'+field('block',t('选中区块','Selected Block'),'')+'<p data-design-block-id></p>'+
   '<div class="design-actions"><button type="button" data-design-up>'+t('上移','Move Up')+'</button><button type="button" data-design-down>'+t('下移','Move Down')+'</button></div><div class="design-fields">'+
   field('width',t('区块宽度','Block Width'),inherit+options(m.widths,m.widths.map(n=>n+' / 12')))+
   field('alignment',t('标题对齐','Title Alignment'),inherit+options(m.alignments,[t('靠左','Left'),t('居中','Center'),t('靠右','Right')]))+
   field('padding',t('区块内边距','Block Padding'),inherit+options(m.spacing,m.spacing.map(n=>n+' px')))+
   field('gap',t('区块间距','Block Gap'),inherit+options(m.spacing,m.spacing.map(n=>n+' px')))+
   '<label>'+t('背景颜色','Background Color')+'<input name="background" placeholder="#ffffff" maxlength="7" pattern="#[0-9a-fA-F]{6}"></label></div></section>'+
   '<section data-design-panel="text" hidden><p>'+t('点击画布上的标题、按钮或标签，也可从列表选择。','Click a title, button or label on the canvas, or choose from the list.')+'</p>'+
   '<button type="button" data-text-pick aria-pressed="false"></button>'+field('key',t('可编辑文字','Editable Text'),'')+
   '<div class="text-design-original"><small>'+t('原文','Original')+'</small><div data-text-original></div></div>'+
   '<label>'+t('替换文字（留空恢复原文）','Replacement Text (blank restores the original)')+'<textarea name="value" maxlength="240" rows="2"></textarea></label>'+
   '<button type="button" data-text-reset>'+t('恢复本页原文','Restore Original Text')+'</button></section>'+
   '<section data-design-panel="code" hidden><label>'+t('设计代码 · JSON','Design Code · JSON')+'<textarea name="code" spellcheck="false" aria-describedby="overview-design-hint"></textarea></label>'+
   '<p id="overview-design-hint">'+t('layout 定义区块顺序和样式，text 定义当前语言的文字。代码有效时实时预览。','layout defines block order and styles. text defines wording for the current language. Valid code previews live.')+'</p></section>'+
   '<p class="error" role="alert" data-design-error></p><footer><button type="button" data-design-reset>'+t('恢复默认','Reset Defaults')+'</button><button type="submit" class="button primary">'+t('发布给所有账号','Publish to All Accounts')+'</button></footer></form>';
  document.body.append(d);this.dialog=d;this.form=d.querySelector('form');this.code=this.form.elements.code;this.error=d.querySelector('[data-design-error]');
  d.querySelector('[data-design-close]').onclick=()=>d.close();
  for(const button of d.querySelectorAll('[data-design-tab]'))button.onclick=()=>this.showTab(button.dataset.designTab);
  d.addEventListener('close',()=>{
   if(d.open)return;
   this.draft=null;this.dragged=null;this.canvasSignature=null;
   document.body.append(d);PageTextDesigner.clear();this.apply();PageTextDesigner.schedule();
  });
  d.querySelector('[data-design-reset]').onclick=()=>{
   this.draft.design=this.defaults(this.draft.kind);this.draft.labels={};this.draft.reset=true;
   PageTextDesigner.select(PageTextDesigner.selected);this.sync();
  };
  for(const [selector,delta] of [['[data-design-up]',-1],['[data-design-down]',1]])d.querySelector(selector).onclick=()=>{
   const items=this.siblings(this.selected);
   this.move(this.selected,items[items.indexOf(this.selected)+delta]);
  };
  this.form.onchange=e=>{
   const {name,value}=e.target;
   if(name==='block'){this.select(value);return;}
   if(!['width','alignment','padding','gap','background'].includes(name))return;
   if(name==='background'&&!e.target.checkValidity())return;
   const design=this.draft.design;
   if(name==='gap')design.gap=value?Number(value):null;
   else {
    if(!this.selected)return;
    const style=design.blocks[this.selected]||={};
    if(value)style[name]=['width','padding'].includes(name)?Number(value):value;
    else delete style[name];
    if(!Object.keys(style).length)delete design.blocks[this.selected];
   }
   this.draft.reset=false;this.sync();
  };
  this.code.oninput=()=>{
   try{
    const parsed=JSON.parse(this.code.value);
    const valid=this.draft.kind==='overviewDesign'?m.isValid:m.isValidPage;
    if(!parsed||Object.keys(parsed).length!==2||!valid(parsed.layout)||!PageTextModel.isValidLabels(parsed.text))throw Error();
    this.draft.design=parsed.layout;this.draft.labels=parsed.text;this.draft.reset=false;
    this.validation(false);this.updateFields();this.apply();PageTextDesigner.select(PageTextDesigner.selected);PageTextDesigner.schedule();
   }catch{this.validation(true);}
  };
  this.form.onsubmit=async e=>{
   e.preventDefault();if(this.saving||this.invalid||!this.draft)return;
   const {scope,version,settings,design,kind,reset,language,labels}=this.draft,body={scope,version,settings:{...settings}};
   const pageText={...settings.pageText};
   if(Object.keys(labels).length)pageText[language]=labels;else delete pageText[language];
   if(Object.keys(pageText).length)body.settings.pageText=pageText;else delete body.settings.pageText;
   if(reset||JSON.stringify(design)===JSON.stringify(this.defaults(kind)))delete body.settings[kind];else body.settings[kind]=design;
   const signature=JSON.stringify(body);
   if(signature!==this.saveSignature){this.saveSignature=signature;this.saveKey=crypto.randomUUID();}
   this.saving=true;for(const el of this.form.elements)el.disabled=true;
   try{
    const row=await API.request('/page-layout',{method:'PATCH',body,idempotencyKey:this.saveKey});
    PageLayout.requestId++;PageLayout.rows.set(row.scope,row);this.draft=null;d.close();PageLayout.apply();
   }catch(err){this.error.textContent=err.message;}
   finally{this.saving=false;for(const el of this.form.elements)el.disabled=false;if(this.draft)this.updateFields();}
  };
  const dropTarget=e=>e.target.closest('[data-oa-design-block],[data-page-design-block]');
  document.addEventListener('dragover',e=>{if(this.dragged&&this.editing()&&dropTarget(e))e.preventDefault();});
  document.addEventListener('drop',e=>{
   const block=dropTarget(e),target=block?.dataset.oaDesignBlock||block?.dataset.pageDesignBlock;
   if(this.dragged&&this.editing()&&target){e.preventDefault();this.move(this.dragged,target);this.dragged=null;}
  });
  this.apply();
 }
};
