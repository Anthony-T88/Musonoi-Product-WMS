'use strict';

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('pg'),{chromium}=require('playwright');
const {randomUUID}=require('node:crypto');
const E=require('./environment.cjs'),R=require('./uiux-routes.cjs'),M=require('./uiux-matrix.cjs');

async function run(out){
 fs.mkdirSync(out,{recursive:true});
 const f=E.fixture(),c=new Client(E.options(f.database)),port=Number(process.env.WMS_UIUX_WORKFLOW_PORT||4395),origin='http://127.0.0.1:'+port;
 const app=await require('../../server/app.cjs').build({config:{...E.appConfig(f.database),origin,port,trustedProxyIps:'127.0.0.1'}});
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const rows=[];
 let context,seq=0;
 const ready=page=>page.waitForFunction(()=>window.AppSignedIn&&window.V469R2?.installed&&!Router.rendering&&document.getElementById('session-restore').hidden);
 const go=async(page,url)=>{
  let timer;
  try{await Promise.race([page.evaluate(url=>Router.go(url),url),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Navigation timeout '+url)),9000);})]);}
  finally{clearTimeout(timer);}
  await ready(page);
  await page.evaluate(()=>document.querySelector('#task-notice[open] [data-task-dismiss]')?.click());
 };
 const pathname=page=>new URL(page.url()).pathname;
 const api=(page,url)=>page.evaluate(url=>API.request(url),url);
 const visible=async(page,s)=>page.locator(s).first().waitFor({state:'visible',timeout:5500});
 const start=async(role,product,language,size)=>{
  const a=f.accounts.find(x=>x.role===role);
  assert(a,'Missing role '+role);
  context=await browser.newContext({viewport:size,extraHTTPHeaders:{'X-Forwarded-For':'127.61.9.'+(++seq)}});
  context.setDefaultTimeout(6500);context.setDefaultNavigationTimeout(9000);
  const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:a.username,password:a.password,language}});
  assert.equal(login.status(),200);
  const headers={origin,'x-csrf-token':(await login.json()).csrfToken,'idempotency-key':randomUUID()};
  const selection=await context.request.post(origin+'/api/v1/product-context',{headers,data:{productCode:product}});
  assert.equal(selection.status(),200,'Product selection '+(await selection.text()).slice(0,150));
  await context.addInitScript(({id,product})=>localStorage.setItem('musonoi-product:'+id,product),{id:a.id,product});
  const page=await context.newPage();
  await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.locator('#task-notice [data-task-dismiss]').click());
  await page.goto(origin+'/overview');
  await ready(page);
  assert.deepEqual(await page.evaluate(()=>[ProductContext.code,I18n.language]),[product,language]);
  return page;
 };
 const check=async(key,product,role,language,body,size=M.desktop)=>{
  const row={key,product,role,language,size,outcome:'passed'};
  let page;
  try{
   page=await start(role,product,language,size);
   row.evidence=await body(page);
  }catch(error){
   row.outcome='failed';row.reason=String(error.message).slice(0,600);
   if(page){row.failureScreenshot='failed-'+key+'-'+product+'-'+language+'.png';
    await page.screenshot({path:path.join(out,row.failureScreenshot),animations:'disabled',timeout:5000}).catch(()=>{delete row.failureScreenshot;});}
 }finally{await context?.close();context=null;rows.push(row);process.stdout.write(key+' '+product+' '+language+' '+row.outcome+'\n');
  fs.writeFileSync(path.join(out,'workflows.json'),JSON.stringify({rows},null,2)+'\n');}
 };
 try{
  await c.connect();await app.listen({port,host:'127.0.0.1'});
  const ids=await R.examples(c,f),groups=(await c.query("SELECT g.id,g.name,array_agg(d.id ORDER BY d.cancelled_at NULLS FIRST,d.id) children FROM loading_plan_groups g JOIN loading_plan_documents d ON d.group_id=g.id WHERE g.name IN('Synthetic UIUX draft','Synthetic UIUX multi') GROUP BY g.id")).rows;
  const draft=groups.find(x=>x.name.endsWith('draft')),multi=groups.find(x=>x.name.endsWith('multi'));
  const begin=new Date().toISOString().replace(/\D/g,'').slice(0,14);
  for(const [route,suffix] of [['legacy-edit','/edit'],['legacy-order-new','/orders/new']]){
   await check(route+'-save',R.CU,'admin','zh-CN',async page=>{
    assert(draft,'Legacy draft is required');
    const id=draft.children[0],base='/loading-plans/orders/'+id;
    await go(page,'/loading-plans/'+draft.id+suffix);
    assert.equal(pathname(page),base+'/edit');
    await visible(page,'#single-plan-form input[name=invoice_no]');
    const form=page.locator('#single-plan-form'),version=(await api(page,'/loading-plans/unified/documents/'+id)).version;
    const invoice='UIUX-SAVE-'+begin+suffix.replaceAll('/','-');
    await form.locator('[name=invoice_no]').fill(invoice);
    await form.locator('[data-op4-batch]').click();
    await page.locator('#dialog[open] [data-op4-pick]').first().click();
    const saved=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/loading-plans/unified/documents/'+id));
    await form.locator('button.primary').click();
    const response=await saved;
    const sent=response.request().postDataJSON();
    assert.equal(response.status(),200,JSON.stringify({response:await response.json(),sent}));
    const doc=await response.json();
    assert.equal(doc.id,id);assert.equal(doc.group_id,draft.id);assert.equal(doc.invoice_no,invoice);assert.equal(doc.version,version+1);
    await page.waitForURL(url=>url.pathname===base);
    return {landing:pathname(page),documentId:doc.id,method:'PATCH',status:response.status(),version:doc.version};
   });
   await check(route+'-locked',R.CU,'admin','en',async page=>{
    assert(ids.cuGroupLocked,'Posted original fixture required');
    await go(page,'/loading-plans/'+ids.cuPlanGroup+suffix);
    const base='/loading-plans/orders/'+ids.cuGroupChild;
    assert.equal(pathname(page),base);await visible(page,'.loading-plan-facts');
    assert.equal(await page.locator('#single-plan-form,a[href="'+base+'/edit"]').count(),0);
    const doc=await api(page,'/loading-plans/unified/documents/'+ids.cuGroupChild);
    assert.equal(doc.id,ids.cuGroupChild);assert.equal(doc.status,'OUTBOUND');
    return {landing:pathname(page),documentId:doc.id,status:doc.status};
   });
   await check(route+'-multi',R.CU,'admin','en',async page=>{
    assert(multi&&multi.children.length===2,'Two-child fixture is required');
    const source='/loading-plans/'+multi.id+suffix;
    await go(page,source);assert.equal(pathname(page),source);await visible(page,'#legacy-plan-documents a');
    const hrefs=await page.locator('#legacy-plan-documents a').evaluateAll(nodes=>nodes.map(a=>a.getAttribute('href')).sort());
    const edit='/loading-plans/orders/'+multi.children[0]+'/edit';
    assert.deepEqual(hrefs,[edit,'/loading-plans/orders/'+multi.children[1]].sort());
    await page.locator('#legacy-plan-documents a[href="'+edit+'"]').click();
    await page.waitForURL(url=>url.pathname===edit);
    await visible(page,'#single-plan-form');
    return {landing:pathname(page),children:multi.children};
   });
   await check(route+'-denied',R.CU,'limited_viewer','en',async page=>{
    assert(draft,'Legacy draft is required');
    const source='/loading-plans/'+draft.id+suffix;
    const denied=await context.request.get(origin+source);
    assert.equal(denied.status(),403);
    await page.goto(origin+source);assert.equal(pathname(page),source);
    assert.equal(await page.locator('#single-plan-form').count(),0);
    return {landing:pathname(page),status:403};
   });
  }

  for(const language of M.languages)for(const product of R.BOTH){
   const co=product===R.CO,table=co?'co_sales_plans':'sales_plans',flow=(co?'/cobalt':'')+'/sales-workflow/plans/';
   const pending=(await c.query('SELECT id FROM '+table+' WHERE project_id=$1 AND remark LIKE $2 ORDER BY created_at DESC LIMIT 1',
    [f.project,'Synthetic UIUX approval '+language+' %'])).rows[0];
   for(const [role,before,after] of [['sales_manager','PENDING','COMMERCE_PENDING'],['commerce_manager','COMMERCE_PENDING','APPROVED']]){
    await check('sales-review-'+role,product,role,language,async page=>{
     assert(pending,'Synthetic approval document is required');
     const endpoint=flow+pending.id;
     await go(page,'/sales-plans/'+pending.id);
     const current=await api(page,endpoint);assert.equal(current.approval_state,before);
     const action=page.locator('[data-sales-review="APPROVED"]');await action.click();
     await visible(page,'#operation-confirm[open]');await page.keyboard.press('Escape');
     await page.locator('#operation-confirm').waitFor({state:'detached'});
     assert.equal((await api(page,endpoint)).approval_state,before);
     assert.equal(await action.evaluate(b=>document.activeElement===b),true);
     const saved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(endpoint+'/review'));
     await action.click();await page.locator('#operation-confirm-accept').click();
     const response=await saved;assert.equal(response.status(),200);
     assert.equal((await api(page,endpoint)).approval_state,after);
     return {landing:pathname(page),documentId:pending.id,status:response.status(),before,after,modal:'Escape and confirm',focusReturned:true};
    });
   }
   await check('mobile-filter',product,'logistics_manager',language,async page=>{
    await go(page,'/loading-plans/query');assert.equal(pathname(page),'/loading-plans/query');
    const form=page.locator('.r9-document-filter').first(),input=form.locator('input[name=search]');
    await input.click();await page.keyboard.type('UIUX');
    await input.press('Tab');
    const next=await form.evaluate(f=>{
     const e=document.activeElement;return f.contains(e)&&e.name!=='search'&&(e.name||e.textContent.trim());
    });
    assert(next,'Tab must move to the next filter control');
    const trail=await form.evaluate(form=>{
     const r=form.getBoundingClientRect();
     return [...form.querySelectorAll('input,select,button')].filter(e=>e.type!=='hidden'&&e.getClientRects().length)
      .map(e=>({control:e.name||e.textContent.trim(),inside:e.getBoundingClientRect().left>=r.left-1&&e.getBoundingClientRect().right<=r.right+1}));
    });
    assert(trail.length>=5&&trail.every(x=>x.inside),'Every filter field must fit the form');
    const screenshot='filter-390-'+product+'-'+language+'.png';
    await form.screenshot({path:path.join(out,screenshot),animations:'disabled',caret:'hide'});
    await input.press('Enter');
    await page.waitForURL(url=>url.searchParams.get('search')==='UIUX');await ready(page);
    return {screenshot,keyboard:['type UIUX','Tab → '+next,'Enter'],url:M.comparable(page.url()),controls:trail};
   },M.phone);
   await check('stock-map-control',product,'logistics_manager',language,async page=>{
    await go(page,product===R.CO?'/stock-map?'+new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse}):'/stock-map');
    assert.equal(pathname(page),'/stock-map');
    const canvas=product===R.CU?'#stock-map-canvas':'#co-map-canvas';
    const control=product===R.CU?'#stock-map-canvas [role="button"], #stock-map-regions button, #stock-map-refresh':'#co-map-in';
    await visible(page,canvas);await visible(page,control);
    await page.locator(control).first().focus();await page.keyboard.press('Enter');
    assert.equal(pathname(page),'/stock-map');
    return {landing:pathname(page),keyboard:'Enter',control,canvas};
   });
  }

  await check('permissions-language',R.CU,'admin','en',async page=>{
   await go(page,'/workbench/permissions');await visible(page,'#account-role-form');
   assert.match(await page.locator('#role-risk').innerText(),/Select permissions for the role/);
   assert.equal(await page.locator('#account-create-role.secondary').count(),1);
   assert.equal(await page.locator('#role-save.primary').count(),1);
   await page.locator('#account-create-role').click();
   await visible(page,'dialog[open] #account-new-role');
   await page.keyboard.press('Escape');await page.locator('dialog[open] #account-new-role').waitFor({state:'hidden'});
   return {landing:pathname(page),modal:'open/Escape',controls:['Add Role secondary','Save Permissions primary']};
  });
  await check('metal-precision-export',R.CO,'admin','en',async page=>{
   await go(page,'/cobalt-metal?view=outbound');await visible(page,'#co-metal-export');
   const table=page.locator('#page-content table').first();
   assert.match(await table.innerText(),/\d+\.\d{4}\b/);assert.match(await table.innerText(),/\d+\.\d{5}\b/);
   assert.doesNotMatch(await page.locator('#page-content').innerText(),/production batch|生产批次/i);
   const download=page.waitForEvent('download');await page.locator('#co-metal-export').click();
   const file=await (await download).path();
   const book=new(require('exceljs').Workbook)();await book.xlsx.readFile(file);
   const sheet=book.worksheets[0],head=sheet.getRow(1).values;
   assert(head.includes('Preparation Batch'));
   assert(!head.some(v=>/production batch|生产批次/i.test(String(v))));
   for(const [key,precision] of [['Net Weight (MT)',4],['Estimated Metal (MT)',5],['Confirmed ARECOMS (MT)',5]]){
    const index=head.indexOf(key);
    assert(index>0,key);
    const formats=sheet.getColumn(index).values.slice(2).map((value,i)=>value==null?null:sheet.getCell(i+2,index).numFmt).filter(Boolean);
    assert(formats.length&&formats.every(x=>x==='0.'+'0'.repeat(precision)),key+' must show '+precision+' decimal places');
   }
   const stock=await context.request.get(origin+'/api/v1/cobalt/stock/export?language=en',{headers:{'X-Product-Code':R.CO}});
   assert.equal(stock.status(),200);
   const stockBook=new(require('exceljs').Workbook)();await stockBook.xlsx.load(await stock.body());
   for(const tab of stockBook.worksheets){
    const headers=tab.getRow(1).values;
    assert(headers.includes('Preparation Batch')&&!headers.some(v=>/production batch|生产批次/i.test(String(v))));
    for(const header of ['Expected Net kg','Confirmed Net kg','Confirmed Actual Net kg']){
     const col=headers.indexOf(header);if(col<0)continue;
     const values=tab.getColumn(col).values.slice(2).filter(Boolean);
     assert(values.length&&values.every(v=>/^\d+\.\d{4}$/.test(String(v))),header+' must show four decimal places');
    }
   }
   return {landing:pathname(page),exports:['Metal Excel','Stock Excel'],netPrecision:4,estimatedPrecision:5,actualPrecision:5};
  });
  await check('injected-visual-regression',R.CU,'admin','en',async page=>{
   await go(page,'/loading-plans/query');
   const {inspect}=require('./uiux-audit.cjs');
   await page.evaluate(()=>{
    const form=document.querySelector('.r9-document-filter'),heading=document.createElement('h2'),unnamed=document.createElement('button');
    heading.textContent=document.querySelector('#business-title').textContent;
    heading.style.cssText='color:#ddd;background:#fff';
    unnamed.type='button';unnamed.style.cssText='width:2rem;height:2rem';
    const search=form.querySelector('input[name=search]');
    search.style.position='relative';search.style.left='1500px';
    form.append(heading,unnamed);
   });
   const metrics=await inspect(page);
   for(const metric of ['noName','duplicates','contrastCandidates','filterClips'])assert(metrics[metric].length,'Browser missed '+metric);
   const screenshot='expected-rejection-layout.png';
   await page.screenshot({path:path.join(out,screenshot),animations:'disabled'});
   return {screenshot,detected:['noName','duplicates','contrastCandidates','filterClips']};
  },M.phone);
 }finally{
  await browser.close();await app.close();await c.end();
  fs.writeFileSync(path.join(out,'workflows.json'),JSON.stringify({rows},null,2)+'\n');
 }
 return rows;
}
if(require.main===module)run(path.resolve(process.argv[2]||path.join(E.runtime,'uiux/workflows'))).then(rows=>{
 console.log(JSON.stringify({passed:rows.filter(x=>x.outcome==='passed').length,failed:rows.filter(x=>x.outcome==='failed')},null,2));
 if(rows.some(x=>x.outcome==='failed'))process.exitCode=1;
}).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={run};

