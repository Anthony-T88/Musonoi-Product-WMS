'use strict';
window.PageDesignCanvas={
 roots:'#inventory,#dashboard,#field,#business-page,#dialog[open]',
 sections:'section,article,aside,form,.page-heading,.dialog-header,#dialog-content,.panel,.co469-panel,.card,.oa-panel,.table-wrap,.table-scroll,.toolbar,.filters,.map-filters,.map-layout',
 excluded:'table,svg,canvas,select,details,.packing-sheet,.print-page,.shipping-preview,#overview-designer',
 nodes:new Map(),styled:new Set(),ordered:new Set(),
 rootVisible(node){return !node.closest('[hidden],[inert]')&&node.getClientRects().length>0;},
 id(root,node){
  const parts=[];
  for(let el=node;el!==root;el=el.parentElement){
   if(/^[a-z][a-z0-9_-]{0,55}$/i.test(el.id)&&!/[0-9a-f]{8}-[0-9a-f]{4}/i.test(el.id)){
    parts.unshift('#'+el.id);break;
   }
   const token=e=>e.localName+':'+([...e.classList].find(c=>!/^(is-|has-|active$|selected$|open$|page-design-)/.test(c))||'');
   const name=token(el);
   const index=[...el.parentElement.children].filter(sibling=>token(sibling)===name).indexOf(el);
   parts.unshift(name+'-'+index);
  }
  let hash=2166136261;
  for(const char of root.id+'/'+parts.join('/'))hash=Math.imul(hash^char.charCodeAt(0),16777619);
  return 'b-'+(hash>>>0).toString(36);
 },
 scan(modalOnly=false){
  const nodes=new Map();
  for(const root of document.querySelectorAll(this.roots)){
   if((modalOnly&&root.id!=='dialog')||!this.rootVisible(root)||root.parentElement.closest(this.roots))continue;
   for(const node of root.querySelectorAll(this.sections)){
    if(node.closest(this.excluded)||!this.rootVisible(node)||node.matches('#page-content')&&node.children.length>1)continue;
    const id=this.id(root,node);
    nodes.set(id,node);
    if(nodes.size>=250)return nodes;
   }
  }
  return nodes;
 },
 label(id){
  const node=this.nodes.get(id);
  const heading=node?.querySelector('h1,h2,h3,h4,legend,caption');
  return heading?.textContent.trim().slice(0,60)||node?.getAttribute('aria-label')||
   OverviewDesigner.t('区块 ','Block ')+id;
 },
 orderedIds(design,ids){
  const wanted=new Set(ids);
  return [...new Set([...design.order,...ids])].filter(id=>wanted.has(id));
 },
 apply(design,editing,selected,modalOnly){
  const nodes=design?this.scan(modalOnly):new Map(),groups=new Map(),styled=new Set(),ordered=new Set();
  this.nodes=nodes;
  for(const [id,node] of nodes){
   const style=design.blocks[id];
   if(editing||style){
    styled.add(node);node.dataset.pageDesignBlock=id;
    for(const key of ['width','padding','alignment','background']){
     const val=style?.[key],property='--page-design-'+key;
     if(val===undefined)node.style.removeProperty(property);
     else node.style.setProperty(property,key==='width'?val/12*100+'%':key==='padding'?val+'px':val);
    }
    node.toggleAttribute('data-oa-design-selected',editing&&selected===id);
    const handle=node.querySelector(':scope > .page-design-handle');
    if(editing&&!handle)node.prepend(OverviewDesigner.handle(id,'oa-design-handle page-design-handle'));
    if(!editing)handle?.remove();
   }
   const ids=groups.get(node.parentElement)||[];
   ids.push(id);groups.set(node.parentElement,ids);
  }
  for(const [parent,ids] of groups){
   if(ids.length<2)continue;
   const positions=this.orderedIds(design,ids),changed=positions.some((id,i)=>id!==ids[i]);
   if(!changed&&design.gap===null)continue;
   ordered.add(parent);
   const display=getComputedStyle(parent).display;
   if(!/grid|flex/.test(display))parent.classList.add('page-design-column');
   parent.classList.toggle('page-design-spacing',design.gap!==null);
   if(design.gap!==null)parent.style.setProperty('--page-design-gap',design.gap+'px');
   else parent.style.removeProperty('--page-design-gap');
   const slots=new Map(positions.map((id,i)=>[nodes.get(id),nodes.get(ids[i])]));
   const children=[...parent.children];
   for(const child of children){
    if(child.classList.contains('oa-design-handle'))continue;
    ordered.add(child);child.classList.add('page-design-ordered');
    child.style.setProperty('--page-design-order',children.indexOf(slots.get(child)||child));
   }
  }
  for(const node of this.styled)if(!styled.has(node)){
   node.querySelector(':scope > .page-design-handle')?.remove();
   node.removeAttribute('data-page-design-block');node.removeAttribute('data-oa-design-selected');
   for(const key of ['width','padding','alignment','background'])node.style.removeProperty('--page-design-'+key);
  }
  for(const node of this.ordered)if(!ordered.has(node)){
   node.classList.remove('page-design-ordered','page-design-column','page-design-spacing');
   for(const key of ['order','gap'])node.style.removeProperty('--page-design-'+key);
  }
  this.styled=styled;this.ordered=ordered;
 }
};
