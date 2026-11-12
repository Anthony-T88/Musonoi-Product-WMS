'use strict';
const PackingPrint={
 mount(host,sheet,settings){
  const t=(zh,en)=>I18n.language==='en'?en:zh;
  const bar=document.createElement('div'),button=document.createElement('button');
  bar.className='business-toolbar';button.type='button';button.className='button secondary';
  button.textContent=t('打印当前单证','Print Current Document');
  button.onclick=()=>this.open(sheet,settings,t);
  bar.append(button);host.prepend(bar);
 },
 open(sheet,settings,t){
  const sizes={A3:[297,420],A4:[210,297],A5:[148,210],Letter:[215.9,279.4]};
  const paper=Object.hasOwn(sizes,settings?.paper)?settings.paper:'A4';
  const orientation=settings?.orientation==='landscape'?'landscape':'portrait';
  const [short,long]=sizes[paper],landscape=orientation==='landscape';
  const margins=['top','right','bottom','left'].map(side=>{
   const raw=settings?.margins?.[side];
   return typeof raw==='number'&&Number.isFinite(raw)&&raw>=0&&raw<=2?raw*25.4:12;
  });
  const width=(landscape?long:short)-margins[1]-margins[3],height=(landscape?short:long)-margins[0]-margins[2];
  const contentWidth=Number.parseFloat(sheet.style.width),contentHeight=[...sheet.querySelectorAll('tr')].reduce((total,row)=>total+(Number.parseFloat(row.style.height)||0),0);
  const mmToPx=96/25.4;
  const scale=Math.min(1,width*mmToPx/contentWidth,settings?.fitHeight&&contentHeight>0?height*mmToPx/contentHeight:1);
  const win=window.open('about:blank','_blank');
  if(!win){notify(t('请允许弹出窗口后打印。','Allow pop-ups to print this document.'));return;}
  win.opener=null;
  const doc=win.document;doc.documentElement.lang=I18n.language;doc.title=t('单证打印预览','Document Print Preview');
  const toolbar=doc.createElement('nav'),button=doc.createElement('button'),label=doc.createElement('span');
  button.type='button';button.id='print-current-document';button.textContent=t('打开打印窗口','Open Print Dialog');
  button.disabled=true;button.onclick=()=>win.print();
  const paperLabel=paper+' · '+t(landscape?'横向':'纵向',landscape?'Landscape':'Portrait');
  label.setAttribute('role','status');label.textContent=t('正在加载打印样式…','Loading print styles…');
  toolbar.append(button,label);
  const page=doc.importNode(sheet,true);page.removeAttribute('style');page.style.width=contentWidth+'px';page.style.zoom=String(scale);
  doc.body.append(toolbar,page);
  const stylesheet=doc.createElement('link');stylesheet.rel='stylesheet';
  stylesheet.href=new URL('/packing-print.css?rev='+ClientRelease.revision,location.origin).href;
  stylesheet.onerror=()=>{label.textContent=t('打印样式加载失败，请重新打开预览。','Print styles could not be loaded. Reopen the preview.');};
  stylesheet.onload=()=>{
   const margin=margins.map(mm=>mm.toFixed(3)+'mm').join(' ');
   stylesheet.sheet.insertRule('@page { size: '+paper+' '+orientation+'; margin: '+margin+'; }',stylesheet.sheet.cssRules.length);
   label.textContent=paperLabel;button.disabled=false;button.focus();
  };
  doc.head.append(stylesheet);
 }
};
