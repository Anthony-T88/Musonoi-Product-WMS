'use strict';

const fs=require('node:fs'),path=require('node:path'),{Client}=require('pg'),{chromium}=require('playwright');
const E=require('./environment.cjs'),R=require('./uiux-routes.cjs');
const baseSize={width:1366,height:768};
const sizes=[baseSize,{width:1440,height:900},{width:1920,height:1080},{width:390,height:844}];
const langs=['zh-CN','en'];
const narrowKeys=new Set(['overview','inventory','map','sales','receipts','loading-search','outbounds','metal','accounts','permissions','reports']);
const slug=(...parts)=>parts.join('_').replace(/[^-a-z0-9_]/gi,'-');
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

async function inspect(page,guest=false){
 return page.evaluate(guest=>{
  const root=guest?document.querySelector('#login-panel'):['#page-content','#dashboard','#inventory','#field'].map(s=>document.querySelector(s)).find(n=>n?.getBoundingClientRect().height);
  const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return !!r.width&&!!r.height&&s.visibility!=='hidden'&&s.display!=='none';};
  const readable=e=>String(e?.innerText||e?.getAttribute('aria-label')||e?.getAttribute('title')||'').trim().replace(/\s+/g,' ');
  const controls=[...root?.querySelectorAll('button,a[href],input,select,textarea')||[]].filter(visible);
  const name=e=>readable(e)||String(e.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>readable(document.getElementById(id))).join(' ').trim()||readable(e.labels?.[0])||e.getAttribute('placeholder')||'';
  const title=readable([...document.querySelectorAll('main h1,#login-panel h1')].find(visible))||document.title;
  const notice=[...root?.querySelectorAll('.error,[role=alert],.product-construction')||[]].filter(visible).map(readable).filter(Boolean);
  const headings=[...root?.querySelectorAll('h2,h3')||[]].filter(visible).map(readable);
  const duplicates=headings.filter((x,i)=>x&&(x===headings[i-1]||x===title));
  const actionable=controls.filter(e=>e.matches('button,a')&&!e.disabled);
  const noName=controls.filter(e=>!name(e)&&e.type!=='hidden').map(e=>e.tagName+':'+(e.id||e.name||e.className)).slice(0,16);
  const actionClips=actionable.filter(e=>e.clientWidth&&e.scrollWidth>e.clientWidth+5&&getComputedStyle(e).overflowX==='hidden').map(name);
  const filterClips=[];
  for(const form of [...root?.querySelectorAll('.r9-document-filter')||[]].filter(visible)){
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
   if(ratio<threshold)contrastCandidates.push({label:label.slice(0,55),ratio:Number(ratio.toFixed(2))});
  }
  return {title,notice,headings:headings.length,duplicates:[...new Set(duplicates)],repeatedLinks:[...new Set(repeatedLinks)],
   noName,actionClips,filterClips,overflow,widest,controls:controls.length,tableCount:[...root?.querySelectorAll('table')||[]].filter(visible).length,
   filters:[...root?.querySelectorAll('form.filters,[role=search]')||[]].filter(visible).length,styles,
   contrastCandidates:contrastCandidates.slice(0,15),empty:!root||(!readable(root)&&!controls.length),hasContent:!!root&&readable(root).length>20};
 },guest);
}

function outcome(metrics,errors,status){
 const message=metrics.notice.join(' · ');
 if(status===403||/没有此页面权限|无权访问|not have permission|no permission|permission denied/i.test(message))return 'denied';
 if(errors.length||status>=500||metrics.empty)return 'failed';
 if(/当前产品无此页面|Page unavailable for this product/i.test(message+' '+metrics.title))return 'other-product';
 if(/页面暂不可用|Page Unavailable|页面不存在/i.test(metrics.title)||
    (!metrics.controls&&/不存在|no longer|not found|not in scope|条件不符|须先|不可编辑|无法编辑|not editable|invalid|unavailable/i.test(message)))return 'unavailable';
 return 'rendered';
}

async function scan({out,phase='current',quick=false}){
 fs.mkdirSync(out,{recursive:true});
 const f=E.fixture(),client=new Client(E.options(f.database));
 await client.connect();
 let ids;
 try{ids=await R.examples(client,f);}finally{await client.end();}
 const port=Number(process.env.WMS_UIUX_PORT||4394);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local UI audit port');
 const origin='http://127.0.0.1:'+port,config={...f.appCfg,port,origin,trustedProxyIps:'127.0.0.1'};
 const routes=R.pages(ids),app=await require('../../server/app.cjs').build({config});
 let browser;
 const evidence={phase,createdAt:new Date().toISOString(),source:sourceInventory(E.root),routes,
  registered:[],navigation:[],unmapped:[],cases:[],screenshots:[]};
 const report=()=>fs.writeFileSync(path.join(out,'coverage.json'),JSON.stringify(evidence,null,2)+'\n');
 try{
  await app.listen({host:'127.0.0.1',port});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  evidence.browser=browser.version();
  const ready=p=>p.waitForFunction(()=>window.AppSignedIn&&window.V469R2?.installed&&typeof Router!=='undefined'&&!Router.rendering&&document.getElementById('session-restore').hidden,{},{timeout:16000});
  const capture=async(page,row,size)=>{
   const name=slug(row.key,row.product||'public',row.language,row.role,size.width)+'.png';
   await page.screenshot({path:path.join(out,name),animations:'disabled',caret:'hide',timeout:12000});
   row.screenshot=name;evidence.screenshots.push(name);
  };
  for(const language of langs){
   const page=await browser.newPage({viewport:baseSize});
   await page.goto(origin);
   await page.locator('[data-login-language="'+language+'"]').click();
   for(const size of sizes){
    await page.setViewportSize(size);
    const metrics=await inspect(page,true),row={key:'login',product:null,language,role:'guest',size,outcome:'rendered',metrics,errors:[]};
    await capture(page,row,size);evidence.cases.push(row);
   }
   await page.locator('.login46-registration').click();
   await page.locator('#registration-modal input[name=username]').waitFor();
   const dialog=await page.locator('#registration-modal').isVisible();
   evidence.cases.push({key:'register-dialog',product:null,language,role:'guest',size:sizes.at(-1),outcome:dialog?'rendered':'failed'});
   await page.close();
  }
  let contextIndex=0;
  for(const account of f.accounts){
   const admin=account.role==='admin';
   if(!admin&&(quick||!routes.some(c=>c.roles.includes(account.role))))continue;
   for(const product of R.BOTH){
    const selected=routes.filter(c=>c.products.includes(product)&&(admin||c.roles.includes(account.role)));
    if(!selected.length)continue;
    const context=await browser.newContext({viewport:baseSize,extraHTTPHeaders:{'X-Forwarded-For':'127.61.1.'+(++contextIndex)}});
    try{
     const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:account.username,password:account.password}});
     if(!login.ok()){evidence.cases.push({key:'login',role:account.role,product,outcome:'failed',reason:'HTTP '+login.status()});continue;}
     const page=await context.newPage(),errors=[];
     page.on('pageerror',e=>errors.push(e.message));
     page.on('response',r=>{if(r.status()>=500&&r.url().includes('/api/v1/'))errors.push(r.status()+' '+new URL(r.url()).pathname);});
     await page.goto(origin+'/overview');await ready(page);
     await page.evaluate(p=>localStorage.setItem(ProductContext.key,p),product);
     await page.reload();await ready(page);
     const actual=await page.evaluate(()=>ProductContext.code);
     if(actual!==product)throw Error('Product initialization failed for '+account.role);
     if(admin){
      const data=await page.evaluate(()=>({patterns:[...new Set(Router.routes.map(r=>r.pattern.source))],
       nav:[...document.querySelectorAll('.sidebar a[href^="/"],.sidebar-bottom a[href^="/"]')].map(a=>a.getAttribute('href'))}));
      for(const entry of new Set(data.nav))evidence.navigation.push({product,path:entry});
      for(const pattern of data.patterns){
       const rx=new RegExp(pattern),examples=routes.filter(c=>rx.test(new URL(c.url,origin).pathname)).map(c=>c.key);
       evidence.registered.push({product,pattern,examples});
       if(!examples.length)evidence.unmapped.push({product,pattern});
      }
     }
     for(const language of admin?langs:['zh-CN']){
      await page.evaluate(async l=>{await API.request('/me/language',{method:'POST',body:{language:l}});I18n.set(l);},language);await ready(page);
      for(const target of selected){
       if(!target.available){evidence.cases.push({key:target.key,product,language,role:account.role,size:baseSize,outcome:'fixture-missing',reason:target.fixture});continue;}
       if(quick&&!target.screenshot)continue;
       await page.setViewportSize(baseSize);
       errors.length=0;
       let failure='',httpStatus;
       try{
        const html=await context.request.get(origin+target.url,{timeout:8000});
        httpStatus=html.status();
        await bounded(page.evaluate(url=>Router.go(url),target.url));
        await ready(page);
        await page.evaluate(()=>document.querySelector('#task-notice[open] [data-task-dismiss]')?.click());
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
       }catch(e){failure=String(e.message);process.stdout.write('navigation '+target.key+' '+product+' '+language+' '+failure.split('\n')[0]+'\n');}
       let metrics=failure?{}:await inspect(page),state=failure?'failed':outcome(metrics,errors,httpStatus);
       const row={key:target.key,product,language,role:account.role,size:baseSize,outcome:state,metrics,errors:[...errors],httpStatus,...(failure?{reason:failure}:{}),
        renderedPath:new URL(page.url()).pathname};
       evidence.cases.push(row);
       if(evidence.cases.length%10===0||failure)report();
       if(failure){
        await page.goto(origin+'/overview',{timeout:10000});await ready(page);continue;
       }
       if(state==='rendered'&&admin&&target.screenshot){
        try{await capture(page,row,baseSize);}
        catch(e){row.screenshotError=e.message;}
        const viewports=narrowKeys.has(target.key)?sizes.slice(1):sizes.slice(1,3);
        for(const size of viewports){
         await page.setViewportSize(size);
         await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
         metrics=await inspect(page);
         const resized={...row,size,metrics,screenshot:undefined};
         try{await capture(page,resized,size);}catch(e){resized.screenshotError=e.message;}
         evidence.cases.push(resized);
        }
       }
      }
      report();
     }
     process.stdout.write(account.role+' '+product+' '+evidence.cases.length+'\n');
    }finally{await context.close();}
   }
  }
 }finally{report();await browser?.close();await app.close();}
 return evidence;
}

if(require.main===module){
 const phase=process.argv[2]||'current',out=process.argv[3]||path.join(E.runtime,'uiux',phase);
 scan({phase,out:path.resolve(out),quick:process.argv.includes('--quick')}).then(e=>{
  console.log(JSON.stringify({phase,out,routeCases:e.routes.length,registered:e.registered.length,unmapped:e.unmapped.length,attempts:e.cases.length,screenshots:e.screenshots.length}));
 }).catch(e=>{console.error(e.stack);process.exitCode=1;});
}

module.exports={scan,outcome,baseSize};
