'use strict';

const fs=require('node:fs'),path=require('node:path'),{Client}=require('pg'),{chromium}=require('playwright');
const E=require('./environment.cjs'),R=require('./uiux-routes.cjs'),M=require('./uiux-matrix.cjs');
const {createHash}=require('node:crypto'),{execFileSync}=require('node:child_process');
const baseSize=M.desktop;
async function bounded(promise){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Navigation timeout')),8000);})]);}
 finally{clearTimeout(timer);}
}

function sourceInventory(root){
 const folders=['dist','server'],source=[];
 const rule=/\b(?:Router\.add|this\.add|bind\(|Router\.performShow|cobaltPage\(|managed\(path|pagePermission\(|primaryRoute|\/workbench\/diagnostics|app\.get\(route)/;
 for(const folder of folders)for(const name of fs.readdirSync(path.join(root,folder))){
  if(!/\.(?:js|cjs)$/.test(name))continue;
  fs.readFileSync(path.join(root,folder,name),'utf8').split(/\r?\n/).forEach((line,index)=>{
   if(rule.test(line))source.push({file:folder+'/'+name,line:index+1});
  });
 }
 const css=fs.readdirSync(path.join(root,'dist')).filter(n=>n.endsWith('.css')).map(file=>{
  const css=fs.readFileSync(path.join(root,'dist',file),'utf8');
  return {file,pixelFontSizes:(css.match(/font-size\s*:\s*[\d.]+px\b/g)||[]).length,important:(css.match(/!important/g)||[]).length};
 });
 return {source,css};
}

async function inspect(page,guest=false,checks=[]){
 return page.evaluate(({guest,checks})=>{
  const root=guest?document.querySelector('#login-panel'):['#page-content','#dashboard','#inventory','#field'].map(s=>document.querySelector(s)).find(n=>n?.getBoundingClientRect().height);
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !!r.width&&!!r.height&&s.visibility!=='hidden'&&s.display!=='none';};
  const readable=e=>String(e?.innerText||e?.getAttribute('aria-label')||e?.getAttribute('title')||'').trim().replace(/\s+/g,' ');
  const controls=[...root?.querySelectorAll('button,a[href],input,select,textarea')||[]].filter(visible);
  const textName=e=>[...e.childNodes].map(node=>node.nodeType===3?node.textContent:
   node.nodeType!==1||node.matches('[aria-hidden=true],[hidden],input,select,textarea')?'':node.getAttribute('alt')||node.textContent).join(' ').trim().replace(/\s+/g,' ');
  const name=e=>String(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>readable(document.getElementById(id))).join(' ').trim()
   ||e.getAttribute('aria-label')||Array.from(e.labels||[],textName).join(' ').trim()
   ||(e.matches('input:not([type=button]):not([type=submit]):not([type=reset]),select,textarea')?'':textName(e)||e.value)
   ||e.getAttribute('title')||e.getAttribute('placeholder')||'';
  const signature=e=>{
   const parent=e.closest('form[id],table[id],section[id],article[id],dialog[id]');
   const type=e.getAttribute('type'),named=e.getAttribute('name');
   const classes=[...e.classList].sort().join('.');
   const attrs=[...e.attributes].map(a=>a.name).filter(a=>a.startsWith('data-')&&!a.startsWith('data-v34')).sort();
   const cell=e.closest('td,th'),column=cell?.cellIndex;
   const head=column>=0?cell.closest('table')?.tHead?.rows[0]?.cells[column]?.innerText:'';
   return [parent?'#'+parent.id:'',e.localName+(e.id?'#'+e.id:''),type||'',named||'',classes,attrs.join(','),head||''].join('|');
  };
  const title=readable([...document.querySelectorAll('main h1,#login-panel h1')].find(visible))||document.title;
  const notice=[...root?.querySelectorAll('.error,[role=alert],.product-construction,.s46-state[data-sys-code="SYS-14"] h2')||[]].filter(visible).map(readable).filter(Boolean);
  const languageCandidates=(window.I18n?.language||document.documentElement.lang)==='en'?[...new Set(
   [...root?.querySelectorAll('h1,h2,h3,button,label,th,dt,legend,summary,[role=alert],[placeholder]')||[]]
    .filter(visible).map(node=>{
     const value=node.getAttribute('placeholder')||textName(node)||readable(node);
     if(window.I18n?.protected?.has(value))return '';
     return value.replace(/\s+/g,' ').slice(0,130);
    }).filter(value=>/[\p{Script=Han}]/u.test(value))
  )].slice(0,40):[];
  const headings=[...root?.querySelectorAll('h2,h3')||[]].filter(visible).map(readable);
  const duplicates=headings.filter((x,i)=>x&&(x===headings[i-1]||x===title));
  const actionable=controls.filter(e=>e.matches('button,a')&&!e.disabled);
  const noName=controls.filter(e=>!name(e)&&e.type!=='hidden'&&!e.matches(':disabled')&&!e.closest('[aria-hidden=true]')).map(signature);
  const forbiddenFields=window.ProductContext?.code==='CO_HYDROXIDE'?
   [...root?.querySelectorAll('th,dt,label,input[name],select[name]')||[]].filter(visible).filter(e=>
    /生产批次|production batches?\b/i.test(readable(e))||/^production_batch(?:_|$)/i.test(e.getAttribute('name')||'')).map(signature):[];
  const actionClips=actionable.filter(e=>e.clientWidth&&e.scrollWidth>e.clientWidth+5&&getComputedStyle(e).overflowX==='hidden').map(name);
  const filterClips=[];
  for(const form of [...root?.querySelectorAll('.r9-document-filter,#co-overview-filter')||[]].filter(visible)){
   if(innerWidth>1100)continue;
   const bounds=form.getBoundingClientRect();
   for(const field of [...form.querySelectorAll('input,select,button')].filter(visible)){
    const r=field.getBoundingClientRect();
    if(r.left<bounds.left-2||r.right>bounds.right+2)filterClips.push(name(field));
   }
  }
  const groups=[...root?.querySelectorAll('.business-toolbar,.r9-filter-actions,.loading465-action-row,.yard-tabs')||[]].filter(visible);
  const repeatedLinks=[];
  for(const group of groups){
   const seen=new Set();
   for(const link of [...group.querySelectorAll(':scope > a[href]')].filter(visible)){
    const key=link.getAttribute('href')+' '+readable(link);if(seen.has(key))repeatedLinks.push(readable(link));seen.add(key);
   }
  }
  const layoutRoot=document.documentElement;
  const overflow=Math.max(0,layoutRoot.scrollWidth-innerWidth);
  const widest=overflow>2?[...document.querySelectorAll('main *')].filter(e=>{
   const r=e.getBoundingClientRect();
   return visible(e)&&r.right>innerWidth+2&&![...function*(n){while(n){yield n;n=n.parentElement;}}(e.parentElement)].some(p=>/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX));
  }).slice(0,8).map(e=>e.tagName+'.'+String(e.className).slice(0,100)):[];
  const styles=Object.create(null);
  for(const e of actionable.filter(e=>e.matches('button,.button')).slice(0,100)){
   const s=getComputedStyle(e),key=[s.fontSize,s.fontWeight,s.borderRadius,s.minHeight].join(' ');
   styles[key]=(styles[key]||0)+1;
  }
  const rgb=v=>v.match(/[\d.]+/g)?.map(Number)||[];
  const luminance=color=>color.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
  const contrastCandidates=[];
  for(const e of [...actionable,...root?.querySelectorAll('h2,h3,.muted,.v34-definition')||[]].filter(visible).slice(0,110)){
   const label=name(e),s=getComputedStyle(e),foreground=rgb(s.color);
   if(!label||foreground.length<3||foreground[3]<1)continue;
   let background=null;
   for(let node=e;node;node=node.parentElement){
    const style=getComputedStyle(node),color=rgb(style.backgroundColor);
    if(style.backgroundImage!=='none'||style.opacity!=='1'||color[3]>0&&color[3]<1)break;
    if(color.length>=3&&color[3]!==0){background=color;break;}
   }
   if(!background)continue;
   const a=luminance(foreground),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   const threshold=parseFloat(s.fontSize)>=24||parseFloat(s.fontSize)>=18.67&&parseInt(s.fontWeight,10)>=700?3:4.5;
   if(ratio<threshold)contrastCandidates.push({target:signature(e),label:label.slice(0,55),ratio:Number(ratio.toFixed(2))});
  }
  const componentSelectors={
   page:'.wms-page,.p46-composition,.s46-shell,[data-page-composed]',
   filters:'.wms-filter-row,form.filters,.r463-filter,.s46-filter,#filter-form',
   forms:'.form-grid,.wms-field-grid,.user-form,.p46-field-grid',
   tables:'table',status:'.status-pill,.v34-state,.co-state,.op-badge',
   metrics:'.oa-kpis,.p46-stat-strip,.v34-kpi-grid,.op-stats',
   preview:'.wms-preview,[role="region"]#op-preview',
   dialog:'dialog[open]',feedback:'.s46-state,.wms-feedback,[role="alert"]'
  };
  const components=Object.keys(componentSelectors).filter(key=>
   [...document.querySelectorAll(componentSelectors[key])].some(node=>visible(node)&&(root?.contains(node)||node.closest('dialog[open]'))));
  const design={family:root?.dataset.pageFamily||'',components,theme:getComputedStyle(document.documentElement).getPropertyValue('--uix-control').trim()};
  return {title,notice,design,languageCandidates,headings:headings.length,duplicates:[...new Set(duplicates)],repeatedLinks:[...new Set(repeatedLinks)],
   noName,actionClips,filterClips,overflow,widest,controls:controls.length,tableCount:[...root?.querySelectorAll('table')||[]].filter(visible).length,
   filters:[...root?.querySelectorAll('form.filters,[role=search]')||[]].filter(visible).length,styles,
   contrastCandidates,forbiddenFields,verifiedControls:Object.fromEntries(checks.map(s=>[s,[...document.querySelectorAll(s)].some(visible)])),
   empty:!root||(!readable(root)&&!controls.length),hasContent:!!root&&readable(root).length>20};
 },{guest,checks});
}

function outcome(metrics,errors,status){
 const message=metrics.notice.join(' · ');
 if(status===403||/没有此页面权限|无权访问|not have permission|no permission|permission denied|cannot access this page/i.test(message))return 'denied';
 if(errors.length||status>=400||metrics.empty)return 'failed';
 if(/当前产品无此页面|Page unavailable for this product/i.test(message+' '+metrics.title))return 'other-product';
 if(/页面暂不可用|Page Unavailable|页面不存在/i.test(metrics.title)||
    (!metrics.controls&&/不存在|no longer|not found|not in scope|条件不符|须先|不可编辑|无法编辑|not editable|invalid|unavailable/i.test(message)))return 'unavailable';
 return 'rendered';
}

async function scan({out,phase='current',mode='full'}){
 fs.mkdirSync(out,{recursive:true});
 const f=E.fixture(),client=new Client(E.options(f.database));
 await client.connect();
 let ids;
 try{ids=await R.examples(client,f);}finally{await client.end();}
 const port=Number(process.env.WMS_UIUX_PORT||4394);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local UI audit port');
 const origin='http://127.0.0.1:'+port,config={...E.appConfig(f.database),port,origin,trustedProxyIps:'127.0.0.1'};
 const routes=R.pages(ids),specs=new Map(routes.map(s=>[s.key,s])),required=M.matrix(mode);
 const app=await require('../../server/app.cjs').build({config});
 let browser;
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:E.root,encoding:'utf8'}).trim();
 const evidence={phase,mode,commit,createdAt:new Date().toISOString(),source:sourceInventory(E.root),fixtures:ids,routes,
  registered:[],navigation:[],unmapped:[],cases:[],screenshots:[]};
 const report=()=>fs.writeFileSync(path.join(out,'coverage.json'),JSON.stringify(evidence,null,2)+'\n');
 try{
  await app.listen({host:'127.0.0.1',port});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  evidence.browser=browser.version();
  const ready=p=>p.waitForFunction(()=>window.AppSignedIn&&window.V469R2?.installed&&typeof Router!=='undefined'&&!Router.rendering&&document.getElementById('session-restore').hidden,{},{timeout:16000});
  const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const capture=async(page,row,failed=false)=>{
   const name=failed?'failed-'+M.imageName(row):M.imageName(row);
   const bytes=await page.screenshot({path:path.join(out,name),animations:'disabled',caret:'hide',timeout:12000});
   if(failed)row.failureScreenshot=name;
   else{
    row.screenshot=name;row.sha256=createHash('sha256').update(bytes).digest('hex');
    evidence.screenshots.push(name);
   }
  };
  const record=async(page,spec,entry,httpStatus,errors,failure)=>{
   const {screenshot,...row}=entry;
   const checks=M.selectors(row.key,row.product,M.expectedLanding(spec,row.product,ids));
   row.renderedUrl=M.comparable(page.url());
   row.metrics=failure?{}:await inspect(page,row.role==='guest',checks);
   row.outcome=failure?'failed':outcome(row.metrics,errors,httpStatus);
   row.httpStatus=httpStatus;row.errors=[...errors];
  if(entry.apiDenial){
   row.apiPath=M.protectedEndpoint(row.key,ids);
   row.apiStatus=await page.evaluate(async endpoint=>{
    const response=await fetch('/api/v1'+endpoint,{headers:{'X-Product-Code':'CU_CATHODE'}});return response.status;
   },row.apiPath);
  }
   if(failure)row.reason=failure;
   evidence.cases.push(row);
   const anomalous=row.outcome!==(row.denied?'denied':'rendered')||row.outcome==='rendered'&&(
    row.renderedUrl!==M.expectedLanding(spec,row.product,ids)||Object.values(row.metrics.verifiedControls).some(v=>!v)||
    row.metrics.overflow>2||row.metrics.actionClips.length||row.metrics.filterClips.length||row.metrics.noName.length||
    row.metrics.duplicates.length||row.metrics.contrastCandidates.length||row.metrics.forbiddenFields.length);
   try{
    if(screenshot&&(row.outcome==='rendered'||entry.apiDenial&&row.outcome==='denied'))await capture(page,row);
    if(anomalous&&!row.screenshot)await capture(page,row,true);
   }catch(e){row.screenshotError=e.message;}
  };
  for(const language of M.languages){
   const page=await browser.newPage({viewport:baseSize});
   const response=await page.goto(origin);
   await page.locator('[data-login-language="'+language+'"]').click();
   for(const entry of required.filter(r=>r.role==='guest'&&r.language===language)){
    await page.setViewportSize(entry.size);
    if(entry.key==='register-dialog'){
     await page.locator('.login46-registration').click();
     await page.locator('#registration-modal input[name=username]').waitFor();
    }
    await settle(page);
    await record(page,specs.get(entry.key),entry,response.status(),[]);
    if(entry.key==='register-dialog'){
     await page.keyboard.press('Escape');
     await page.locator('#registration-modal[open]').waitFor({state:'hidden'});
    }
   }
   await page.close();
  }
  const groups=Map.groupBy(required.filter(r=>r.role!=='guest'),r=>r.role+'/'+r.product);
  let contextIndex=0;
  for(const [group,entries] of groups){
   const [role,product]=group.split('/'),account=f.accounts.find(a=>a.role===role);
   if(!account)throw Error('Missing required synthetic role '+role);
   const context=await browser.newContext({viewport:baseSize,extraHTTPHeaders:{'X-Forwarded-For':'127.61.1.'+(++contextIndex)}});
   try{
    const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:account.username,password:account.password}});
    if(!login.ok())throw Error('Synthetic '+role+' login failed: HTTP '+login.status());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('response',r=>{if(r.status()>=500&&r.url().includes('/api/v1/'))errors.push(r.status()+' '+new URL(r.url()).pathname);});
    await page.goto(origin+'/overview');await ready(page);
    await page.evaluate(p=>localStorage.setItem(ProductContext.key,p),product);
    await page.reload();await ready(page);
    if(await page.evaluate(()=>ProductContext.code)!==product)throw Error('Product initialization failed for '+role);
    if(role==='admin'){
     const data=await page.evaluate(()=>({patterns:[...new Set(Router.routes.map(r=>r.pattern.source))],
      nav:[...document.querySelectorAll('.sidebar a[href^="/"],.sidebar-bottom a[href^="/"]')].map(a=>a.getAttribute('href'))}));
     for(const entry of new Set(data.nav))evidence.navigation.push({product,path:entry});
     for(const pattern of data.patterns){
      const rx=new RegExp(pattern),examples=routes.filter(c=>rx.test(new URL(c.url,origin).pathname)).map(c=>c.key);
      evidence.registered.push({product,pattern,examples});
      if(!examples.length)evidence.unmapped.push({product,pattern});
     }
    }
    for(const [language,localized] of Map.groupBy(entries,r=>r.language)){
     await page.evaluate(async l=>{await API.request('/me/language',{method:'POST',body:{language:l}});I18n.set(l);},language);
     await ready(page);
     for(const [key,viewports] of Map.groupBy(localized,r=>r.key)){
      const spec=specs.get(key);
      if(!spec.available){
       for(const entry of viewports)evidence.cases.push({...entry,screenshot:undefined,outcome:'fixture-missing',reason:spec.fixture});
       continue;
      }
      await page.setViewportSize(viewports[0].size);
      errors.length=0;
      let failure='',httpStatus;
      try{
       httpStatus=(await context.request.get(origin+spec.url,{timeout:8000})).status();
       await bounded(page.evaluate(url=>Router.go(url),spec.url));
       await ready(page);
       await page.evaluate(()=>document.querySelector('#task-notice[open] [data-task-dismiss]')?.click());
      }catch(e){failure=String(e.message).split('\n')[0];}
      for(const entry of viewports){
       await page.setViewportSize(entry.size);
       await settle(page);
       await record(page,spec,entry,httpStatus,errors,failure);
      }
      if(failure){await page.goto(origin+'/overview',{timeout:10000});await ready(page);}
      if(evidence.cases.length%10===0||failure)report();
     }
     report();
    }
    process.stdout.write(role+' '+product+' '+evidence.cases.length+'\n');
   }finally{await context.close();}
  }
 }finally{report();await browser?.close();await app.close();}
 return evidence;
}

if(require.main===module){
 const [, , phase='current',target,...flags]=process.argv;
 const out=target||path.join(E.runtime,'uiux',phase);
 if(flags.some(flag=>flag!=='--quick'))throw Error('Usage: uiux-audit.cjs PHASE OUTPUT [--quick]');
 scan({phase,out:path.resolve(out),mode:flags.includes('--quick')?'quick':'full'}).then(e=>{
  console.log(JSON.stringify({phase,mode:e.mode,out,routeCases:e.routes.length,registered:e.registered.length,unmapped:e.unmapped.length,attempts:e.cases.length,screenshots:e.screenshots.length}));
 }).catch(e=>{console.error(e.stack);process.exitCode=1;});
}

module.exports={scan,outcome,inspect,baseSize};
