'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const X=require('xlsx'),{chromium}=require('playwright'),E=require('./environment.cjs'),P=require('./preparation-fixture.cjs');
const {migrate}=require('../../scripts/production-db.cjs');
const products=['CU_CATHODE','CO_HYDROXIDE'];
const cobalt=product=>product==='CO_HYDROXIDE';
const prefix=product=>cobalt(product)?'/cobalt':'';
const routes={RECEIPT:'/receipts',LOADING_PLAN:'/loading-plans',LOADING_ORDER:'/outbounds',OUTBOUND:'/stock-outbound'};

async function archive(api,f,product){
 const co=cobalt(product),tag=co?'QA-CO':'QA-CU',lot=P.batch(product,701),document='QA-PL-'+tag;
 const rows=Array.from({length:29},()=>[]);
 rows[0]=['PACKING LIST'];rows[2]=['','','','Packing List No:',document];rows[3]=['','','','Lot No:',lot];
 rows[6]=['','','','Shipping Date:','2020-03-05'];rows[21]=['Synthetic '+(co?'CO-AUDIT':'CU-AUDIT'),'','','','QA-TRUCK-'+tag];
 rows[28]=['No','Description',co?'Bag No':'Bundle No',co?null:'Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
 rows.push([1,'Synthetic',tag+'-001',co?null:48,tag+'-SEAL1',647,650],
  [2,'Synthetic',tag+'-002',co?null:48,tag+'-SEAL2',653,656],['Total',null,null,null,null,1300,1306]);
 const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),'PL');
 const file={file_name:document+'.xlsx',file_base64:X.write(wb,{type:'base64',bookType:'xlsx'}),warehouse_id:f.warehouse};
 const base='/historical-movements/batch',validated=(await api('admin',product,base+'/preview',{files:[file]})).results[0];
 assert(validated.importable,JSON.stringify(validated.issues));
 const loaded=(await api('admin',product,base+'/confirm',{files:[{...file,preview_token:validated.preview_token}]})).results[0];
 assert.equal(loaded.status,'IMPORTED');
 const record=await api('admin',product,'/historical-movements/'+loaded.id);
 return {source:loaded.id,document,idByKind:Object.fromEntries(record.documents.map(doc=>[doc.kind,doc.id])),unitTag:tag};
}

test('copper and cobalt preparation batches and historical navigation on independent TEST',async t=>{
 const {client:c,name}=await E.database();let app,browser;
 try{
  await migrate(c,{apply:true,appPassword:process.env.WMS_TEST_APP_PASSWORD,environment:'test'});
  const f=await E.seed(c,name),port=4397,origin='http://127.0.0.1:'+port;
  app=await require('../../server/app.cjs').build({config:{...f.appCfg,port,origin}});
  const sessions=new Map();
  async function login(role){
   const account=f.accounts.find(a=>a.role===role),r=await app.inject({method:'POST',url:'/api/v1/auth/login',
    remoteAddress:'127.78.0.'+(f.accounts.indexOf(account)+1),headers:{origin},payload:{username:account.username,password:account.password}});
   assert.equal(r.statusCode,200);
   const headers={origin,cookie:r.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':r.json().csrfToken};
   sessions.set(role,headers);return headers;
  }
  async function request(role,product,url,body,key=crypto.randomUUID()){
   return app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{
    ...(sessions.get(role)||await login(role)),'x-product-code':product,'idempotency-key':key},...(body?{payload:body}:{})});
  }
  async function api(role,product,url,body,expected=200){
   const r=await request(role,product,url,body);assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,350));return r.json();
  }
  const fixtures={};
  for(const product of products)await t.test(product+' scoped lookup, validation, atomic save and replay',async()=>{
   const plan=await P.salesPlan(api,f,product),base=prefix(product)+'/preparation-plans';
   const item=n=>({sales_plan_id:plan,shipment_month:P.localMonth(),batch_no:P.batch(product,n)});
   const occupied=await P.approved(api,product,plan,item(780).batch_no);
   const searched=await api('export_supervisor',product,base+'/occupied?'+new URLSearchParams({search:item(780).batch_no}));
   assert.equal(searched.items.length,1);assert.equal(searched.items[0].state,'APPROVED');
   const customer=searched.items[0].customer_name;
   assert.match(customer,/Synthetic/);
   assert((await api('export_supervisor',product,base+'/occupied?'+new URLSearchParams({search:customer}))).items.some(row=>row.batch_no===item(780).batch_no));
   await api('production_operator',product,base+'/occupied',null,403);
   await api('production_operator',product,base+'/batch',{items:[item(786)]},403);
   const validation=await api('export_supervisor',product,base+'/batch/preview',{items:[item(780),item(781),item(782),item(782)]});
   assert.deepEqual(validation.items.map(r=>r.error),['备货批次号已占用',null,'录入表内重复','录入表内重复']);
   await api('export_supervisor',product,base+'/batch',{items:[item(781),item(780)]},409);
   assert(!(await api('export_supervisor',product,base+'?search='+item(781).batch_no)).total);
   const body={items:[item(783),item(784)]},key=crypto.randomUUID();
   const first=await request('export_supervisor',product,base+'/batch',body,key);
   assert.equal(first.statusCode,200,first.body);
   assert(first.json().items.every(row=>row.state==='DRAFT'));
   const repeated=await request('export_supervisor',product,base+'/batch',body,key);
   assert.deepEqual(repeated.json(),first.json());
   const receipt=await api('export_supervisor',product,base+'/operations/status?'+new URLSearchParams({method:'POST',path:base+'/batch',key}));
   assert.equal(receipt.committed,true);
   const race=await Promise.all([request('export_supervisor',product,base+'/batch',{items:[item(787),item(788)]}),
    request('export_supervisor',product,base+'/batch',{items:[item(787),item(789)]})]);
   assert.deepEqual(race.map(r=>r.statusCode).sort(),[200,409]);
   const failedLot=race[0].statusCode===409?788:789;
   assert.equal((await api('export_supervisor',product,base+'?search='+item(failedLot).batch_no)).total,0);
   fixtures[product]={plan,customer,occupied,item,history:await archive(api,f,product)};
  });
  assert(products.every(product=>fixtures[product]),'Required copper and cobalt fixtures were created');
  await app.listen({port,host:'127.0.0.1'});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  async function open(role,product,width){
   const a=f.accounts.find(x=>x.role===role),ctx=await browser.newContext({viewport:{width,height:900}});
   const r=await ctx.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:a.username,password:a.password}});
   assert.equal(r.status(),200);
   const page=await ctx.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(code=>localStorage.setItem('musonoi-product',code),product);
   await page.goto(origin+'/overview');
   await page.waitForFunction(()=>window.AppSignedIn&&typeof ProductContext!=='undefined'&&!document.querySelector('#session-restore:not([hidden])'));
   if(await page.evaluate(()=>ProductContext.code)!==product)await page.evaluate(code=>ProductContext.switchTo(code),product);
   await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.evaluate(()=>document.querySelector('#task-notice [data-task-dismiss]')?.click()));
   return {ctx,page,errors};
  }
  for(const product of products)await t.test(product+' actual browser entry, save, document links and returns',async()=>{
   const co=cobalt(product),fx=fixtures[product],width=co?390:1440;
   const {ctx,page,errors}=await open('export_supervisor',product,width);
   try{
    await page.goto(origin+'/preparation/work-plans');
    await page.locator('#preparation-plan-create').click();
    await page.waitForURL('**/preparation/work-plans/new');
    const body=page.locator('#preparation-batch-table tbody');
    const saveDrafts=page.locator('#preparation-plan-batch').getByRole('button',{name:/^(保存草稿|Save Drafts)$/});
    const sales=body.locator('select').first();await sales.locator('option[value="'+fx.plan+'"]').waitFor({state:'attached'});await sales.selectOption(fx.plan);
    assert.equal(await body.locator('input[name=customer]').first().inputValue(),fx.customer);
    const lookup=page.locator('#preparation-occupied-filter');await lookup.locator('input').fill(fx.occupied.batch_no);
    await lookup.locator('button[type=submit]').click();
    await page.locator('#preparation-occupied-table').getByText(fx.occupied.batch_no,{exact:true}).waitFor().catch(async e=>{
     throw Error(await page.locator('#preparation-occupied-results').innerText(),{cause:e});});
    assert.match(await page.locator('#preparation-occupied-table').innerText(),new RegExp(fx.customer));
    await page.locator('#preparation-batch-paste').click();
    await page.locator('#preparation-paste-text').fill(fx.occupied.batch_no+'\n'+fx.item(791).batch_no);
    await page.locator('#preparation-paste-insert').click();
    assert.equal(await body.locator('tr').count(),2);
    await saveDrafts.click();
    await body.locator('tr').first().locator('[data-batch-validation]').getByText(/占用|occupied/i).waitFor();
    assert.equal(await body.locator('input[name=batch_no]').nth(1).inputValue(),fx.item(791).batch_no);
    await body.locator('input[name=batch_no]').first().fill(fx.item(790).batch_no);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Batch entry must fit the viewport');
    await page.screenshot({path:path.join(E.runtime,'v483-preparation-'+product+'.png'),fullPage:true});
    await saveDrafts.click();
    await page.waitForURL('**/preparation/work-plans?state=DRAFT');
    await page.locator('#preparation-plans-table').getByText(fx.item(790).batch_no,{exact:true}).waitFor();
    assert.equal(await page.locator('.wms-batch-created').count(),2);
    assert.deepEqual(errors,[]);
   }finally{await ctx.close();}
   const hist=await open('admin',product,width);
   try{
    const h=fx.history,loadPath=routes.LOADING_ORDER+'/historical/'+h.idByKind.LOADING_ORDER,
     outPath=routes.OUTBOUND+'/historical/'+h.idByKind.OUTBOUND,
     receiptPath=routes.RECEIPT+'/historical/'+h.idByKind.RECEIPT,
     planPath=routes.LOADING_PLAN+'/historical/'+h.idByKind.LOADING_PLAN,
     listPath='/outbounds?search='+encodeURIComponent(h.document),sourcePath='/workbench/historical-movements/'+h.source+'?product='+product;
    await hist.page.goto(origin+listPath);
    await hist.page.locator('a[href="'+loadPath+'"]').last().click();
    await hist.page.waitForURL(origin+loadPath);
    const ready=()=>hist.page.waitForFunction(()=>Router.current===location.pathname&&!Router.rendering&&!document.body.classList.contains('wms-navigating'));
    async function link(url){
     await hist.page.locator('.wms-historical-links a[href="'+url+'"]').click();
     await hist.page.waitForURL(origin+url);await ready();
    }
    const back=async()=>{
     await ready();
     await hist.page.locator('[data-historical-back]').click().catch(async e=>{
      throw Error(JSON.stringify(await hist.page.evaluate(()=>({location:location.pathname,state:history.state,title:document.querySelector('#business-title').textContent}))),{cause:e});
     });
    };
    await link(outPath);await link(receiptPath);
    assert.match(await hist.page.locator('.wms-historical-detail').innerText(),/历史补录记账日|Historical Posting Date/);
    await link(planPath);await back();await hist.page.waitForURL(origin+receiptPath);
    await back();await hist.page.waitForURL(origin+outPath);
    const archive=hist.page.locator('.wms-historical-links a[href^="/inventory/historical/"]'),stockPath=await archive.getAttribute('href');
    await archive.click();await hist.page.waitForURL(origin+stockPath);await ready();
    assert.match(await hist.page.locator('.wms-historical-detail').innerText(),co?/0\.46800/:/QA-CU-001/);
    await hist.page.screenshot({path:path.join(E.runtime,'v483-historical-'+product+'.png'),fullPage:true});
    await link(sourcePath);await hist.page.locator('#historical-source').waitFor();
    await back();await hist.page.waitForURL(origin+stockPath);await back();await hist.page.waitForURL(origin+outPath);
    await back();await hist.page.waitForURL(origin+loadPath);await back();await hist.page.waitForURL(origin+listPath);
    assert.deepEqual(hist.errors,[]);
   }finally{await hist.ctx.close();}
  });
 }finally{await browser?.close();await app?.close();await c.end();}
});
