'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{chromium}=require('playwright'),E=require('./environment.cjs');
const release=require('../../server/release.cjs');
test('online commercial numbers keep the complete invoice or packing list identifier',()=>{
 const {documentNo}=require('../../dist/plan-display.js');
 const invoice='RMM-2609-CU-SYNTH-01',packing=invoice+'-PL';
 assert.equal(documentNo('SP-01-01'+invoice),invoice);
 assert.equal(documentNo('SP-01-01 · '+packing),packing);
 assert.equal(documentNo('SP-01-01'), 'SP-01-01');
 assert.equal(documentNo('SP-01-01-OTHER-01'),'SP-01-01-OTHER-01');
 assert.equal(documentNo('SP-01-01'+packing,true),'SP-01-01'+packing);
});
test('commercial invoice prints on one page and long packing lists paginate',async()=>{
 const fs=require('node:fs/promises'),PL=require('../../server/packing-list.cjs');
 const items=Array.from({length:85},(_,i)=>({bundle_no:'B-'+i,sheets_per_bundle:48,seal_no:'S-'+i,net_weight:'1.000000',gross_weight:'1.050000'}));
 const {buffer}=await PL.render({include_invoice:true,document_no:'PL-123',document_date:'2026-11-18',
  customer_name:'Example buyer',transport:{buyer_information:'Warehouse address and delivery instructions. '.repeat(18),forwarder:'Example International Freight\nForwarding and Consolidated Cargo Services Ltd'},
  loading_plan:{invoice_no:'INV-123'},contracts:['Example contract'],lots:['LOT-1'],items,bundle_count:items.length,
  total_net_weight:'85.123500',total_gross_weight:'89.250000',commercial_invoice:{unit_price_usd:'100.00'},
  invoice_bank_details:{offshore_bank:'Example Offshore Bank',offshore_bank_account:'000123',issuing_bank:'Example Local Bank',issuing_bank_account:'000456'}});
 const assets=['release.js','packing-print.js','v30-ui.js','packing-print.css','uiux-governance.css'];
 const site=require('node:http').createServer(async(req,res)=>{
  const asset=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!asset){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<div id="packing-list-preview"></div>');}
  if(!assets.includes(asset)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type',asset.endsWith('.css')?'text/css':'application/javascript; charset=utf-8');
  res.end(await fs.readFile(path.resolve('dist',asset)));
 });
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const context=await browser.newContext(),page=await context.newPage();
  const origin='http://127.0.0.1:'+site.address().port,output=path.resolve('.runtime/release-tests');
  await fs.mkdir(output,{recursive:true});
  await page.goto(origin);
  await page.evaluate(()=>{
   window.$=id=>document.getElementById(id);window.I18n={language:'en'};
   window.Flow={loads(){},load(){}};window.Business={allocations(){}};window.Router={names:{},permission(){},init(){}};
  });
  for(const script of ['release.js','packing-print.js','v30-ui.js'])await page.addScriptTag({url:origin+'/'+script});
  // The supplied template retains the older scale settings used by archived invoices.
  for(const [name,file,sheet] of [['archived-invoice',await fs.readFile(PL.template),'INV'],['invoice',buffer,'INV'],['packing-list',buffer,'PL']]){
   const layout=await PL.preview(file,sheet);
   assert.equal(layout.print.fitHeight,sheet==='INV');
   await page.evaluate(layout=>Shipping.drawPreview(layout),layout);
   const opened=page.waitForEvent('popup');await page.getByRole('button',{name:'Print Current Document'}).click();
   const popup=await opened;
   await popup.waitForFunction(()=>document.querySelector('#print-current-document')?.disabled===false);
   if(sheet==='INV'){
    const cells=popup.locator('[data-print-single-line]');
    assert.equal(await cells.count(),2);
    assert(await cells.evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).whiteSpace==='nowrap')));
    assert.equal(await cells.last().getAttribute('colspan'),'3');
   }
   if(name==='invoice'){
    assert.equal(layout.rows[29].cells[3].text,'85.124');
    assert.equal(layout.rows[43].cells[0].text,'Account Number: 000123');
    assert.equal(layout.rows[49].cells[0].text,'Account Number: 000456');
    assert.equal(layout.rows[44].cells[0].text,'');
   }
   const pdf=await popup.pdf({path:path.join(output,name+'.pdf'),preferCSSPageSize:true,printBackground:true});
   const count=pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length;
   if(sheet==='INV')assert.equal(count,1,name);else assert(count>1,name);
   await popup.close();
  }
 }finally{await browser?.close();await new Promise(resolve=>site.close(resolve));}
});
test('BP sheets fit ordinary fields on one line and keep full long text on landscape A4',async()=>{
 const fs=require('node:fs/promises'),BP=require('../../server/customs-bp-print.cjs'),http=require('node:http');
 const output=path.join(E.runtime,'bp-print');
 const assets={
  '/customs-bp-print.css':'text/css',
  '/customs-bp-paper.css':'text/css',
  '/customs-bp-print.js':'application/javascript',
  '/customs-bp-logo.png':'image/png'
 };
 const documents=new Map();
 for(const count of [1,2,3,6,10,70]){
  const rows=Array.from({length:count},(_,i)=>({batch:'SYNTHETIC-LOT-'+(i+1),truck:'DEMO-'+i,
   trailer_one:'TRAILER-'+i,trailer_two:'N/A',container:'CONTAINER-'+i,transporter:'Example Logistics Company',driver:'Demo Driver Surname',
   ...(count===6?{transporter:'EXAMPLE ROAD HAULAGE LTD',driver:'EXAMPLE MICHAEL ANDREW DANIEL',passport:'1234567890'}:{}),
   ...(count===6&&i===5?{container:'SYNTHETIC-CONTAINER-1234',transporter:'Synthetic International Transport and Logistics Company',
    driver:'Synthetic Example Driver With Five Given Names',passport:'SYNTHETIC-PASSPORT-2901'}:{}),
   quantity:16,net_mt:'30.123451',gross_mt:'31.123456'}));
  documents.set('/'+count,BP.html({number:'001/2026/CU',header:{issuer:'RUASHI MINING SAS',address:'Musonoi Project site, Kolwezi, Lualaba Province',
   rccm:'Example RCCM',id_nat:'Example identifier',nif:'Example NIF',contact:'Example office contact',
   customer:'Example Warehouse Customer',product:'CATHODE DE CUIVRE',mode:'ROAD',destination:'Port of Lobito, Angola',
   border:'Example crossing',agency:'Example Customs Agent',license:'SYNTH-EB-001',loading_point:'RUASHI MINING MUSONOI PLANT',
   loading_date:'2026-11-23',signature_date:'2026-11-24'},rows,total:require('../../server/customs-bp.cjs').totals(
    rows.map(r=>({...r,quantity:String(r.quantity)})),true)}));
 }
 const site=http.createServer(async(req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(assets[name]){
   res.setHeader('Content-Type',assets[name]);return res.end(await fs.readFile(path.resolve('dist',name.slice(1))));
  }
  if(!documents.has(name)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(documents.get(name));
 });
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  await fs.mkdir(output,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:Math.round(285*96/25.4),height:900}}),origin='http://127.0.0.1:'+site.address().port;
  for(const [pathname]of documents){
   const count=Number(pathname.slice(1));await page.goto(origin+pathname);
   await page.locator('.bp-issuer img').evaluate(image=>image.decode());
   assert.equal(await page.locator('.bp-vehicle').count(),count);
   assert(await page.locator('.bp-table').evaluate(table=>[...table.tBodies].every(body=>body.rows.length)));
   assert.equal(await page.locator('.bp-closing > .bp-vehicle').count(),1);
   assert.equal(await page.locator('.bp-closing > .bp-total').count(),1);
   assert.equal(await page.locator('.bp-closing .bp-signature').count(),1);
   assert.equal(await page.locator('.bp-vehicle').first().locator('td').nth(4).textContent(),'N/A');
   assert.equal(await page.locator('.bp-vehicle').first().locator('td').nth(10).textContent(),'30.123');
   assert.equal(await page.locator('.bp-details dt').filter({hasText:'Loading Date:'}).locator('..').locator('dd').textContent(),'23 November 2026');
   assert.equal(await page.locator('.bp-signature p').last().textContent(),'KOLWEZI, le 24 November 2026');
   await page.emulateMedia({media:'print'});
   await page.evaluate(()=>window.dispatchEvent(new Event('beforeprint')));
   const lines=await page.locator('.bp-line').evaluateAll(cells=>cells.map(cell=>{
    const range=document.createRange();range.selectNodeContents(cell);
    const rects=[...range.getClientRects()].filter(rect=>rect.width>0),bounds=cell.getBoundingClientRect();
    return {text:cell.textContent,lines:new Set(rects.map(rect=>Math.round(rect.top))).size,
     contained:rects.every(rect=>rect.left>=bounds.left-0.75&&rect.right<=bounds.right+0.75)};
   }));
   assert.deepEqual(lines.filter(line=>!line.contained).map(line=>line.text),[],count+' vehicles have unclipped text');
   const longText=lines.filter(line=>line.lines>1).map(line=>line.text);
   if(count===6){
    assert(longText.includes('Synthetic International Transport and Logistics Company'));
    assert(longText.includes('Synthetic Example Driver With Five Given Names'));
    assert(longText.every(value=>value.startsWith('Synthetic ')||value.startsWith('SYNTHETIC-')),JSON.stringify(longText));
   }else assert.deepEqual(longText,[],count+' vehicles use single-line field values');
   const paper=await page.locator('.bp-table').evaluate(table=>{
    const {left,right}=table.getBoundingClientRect();
    return {left,right:document.documentElement.clientWidth-right,fontSize:parseFloat(getComputedStyle(table).fontSize)};
   });
   assert(paper.left>=0&&paper.right>=0&&Math.abs(paper.left-paper.right)<=1,'Centered table for '+count+' vehicles');
   if(count===2)assert(paper.fontSize>=13.5,'Two-vehicle sheet uses the enlarged print font');
   await page.emulateMedia({media:null});
   const pdf=await page.pdf({path:path.join(output,'vehicles-'+count+'.pdf'),preferCSSPageSize:true});
   const bytes=pdf.toString('latin1'),pages=bytes.match(/\/Type\s*\/Page\b/g)?.length;
   const size=bytes.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
   assert(size);assert(Math.abs(Number(size[1])-841.89)<1&&Math.abs(Number(size[2])-595.28)<1);
   if(count<=10)assert.equal(pages,1,count+' vehicles');else assert(pages>1,count+' vehicles');
   if(count===2||count===6){
    const nativeDefault=await page.pdf({format:'Letter',preferCSSPageSize:false});
    assert.equal(nativeDefault.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length,1);
   }
  }
 }finally{await browser?.close();await new Promise(resolve=>site.close(resolve));}
});
test('copper and cobalt gate permits print on one landscape continuous form',async()=>{
 const fs=require('node:fs/promises'),http=require('node:http'),Gate=require('../../server/gate-render.cjs');
 const permits=new Map(),output=path.join(E.runtime,'gate-print');
 const driver='SYNTHETIC DRIVER WITH AN EXTENDED NAME FOR LONG TEXT';
 const packingList='SYNTHETIC-CONTINUOUS-FORM-LONG-PACKING-LIST-1234567890-PL';
 for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
  const draft=await Gate.render({product_code:product,business_date:'2026-11-20',document_no:'TEST-'+product,
   truck_no:'TEST-PLATE',driver_name:driver,packing_list_no:packingList,quantity:15,sheets:784,net_kg:'30895.5',remark:'Synthetic permit'});
  const layout=await Gate.preview(draft.buffer);
  permits.set('/'+product,Gate.html(layout,'Synthetic Gate Permit'));
 }
 const script=await fs.readFile(path.resolve('dist/gate-print.js'));
 const site=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/gate-print.js'){res.setHeader('Content-Type','application/javascript');return res.end(script);}
  const html=permits.get(url.pathname);
  if(!html){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);
 });
 await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  await fs.mkdir(output,{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{window.print=()=>{window.gatePrintRequested=true;};});
  const origin='http://127.0.0.1:'+site.address().port;
  for(const route of permits.keys()){
   await page.goto(origin+route);
   await page.locator('.sheet[data-fit-ready="1"]').waitFor();
   assert.match(await page.locator('.print-tools').innerText(),/241\.3 毫米、走纸 139\.7 毫米/);
   const print=page.getByRole('button',{name:'打印 / Print',exact:true});
   await print.click();
   assert(await page.evaluate(()=>window.gatePrintRequested&&document.getElementById('gate-paper-size').sheet.disabled));
   await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));
   assert(await page.evaluate(()=>!document.getElementById('gate-paper-size').sheet.disabled));
   await page.emulateMedia({media:'print'});
   assert(await page.locator('.print-tools').isHidden());
   assert.match(await page.locator('.sheet table').innerText(),/Security Inspector/i);
   assert.match(await page.locator('.sheet table').innerText(),/SYNTHETIC DRIVER/);
   const fit=await page.locator('.print-area').evaluate(area=>{
    const frame=area.getBoundingClientRect();
    const nodes=[...area.querySelectorAll('table,img')];
    return nodes.map(node=>{
     const bounds=node.getBoundingClientRect();
     return {node:node.tagName,bounds:bounds.toJSON(),frame:frame.toJSON(),fits:bounds.left>=frame.left-1&&bounds.right<=frame.right+1&&bounds.top>=frame.top-1&&bounds.bottom<=frame.bottom+1};
    });
   });
   assert(fit.every(x=>x.fits),route+' table and logo fit into the printable area '+JSON.stringify(fit));
   // A dedicated tractor form supplies its physical width and feed length in that order.
   for(const [mode,options,expectedHeight] of [
    ['document',{preferCSSPageSize:true},396],
    ['tractor-half',{width:'9.5in',height:'5.5in'},396],
    ['tractor-full',{width:'9.5in',height:'11in'},792]
   ]){
    if(mode!=='document'){
     await page.emulateMedia({media:'screen'});
     await print.click();
     await page.emulateMedia({media:'print'});
    }
    assert(await page.locator('.print-tools').isHidden());
    const pdf=await page.pdf({path:path.join(output,route.slice(1)+'-'+mode+'.pdf'),printBackground:true,...options});
    const bytes=pdf.toString('latin1'),size=bytes.match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
    assert.equal(bytes.match(/\/Type\s*\/Page\b/g)?.length,1,route+' '+mode);
    assert(size,route+' '+mode+' media box');
    assert(Math.abs(Number(size[1])-684)<1&&Math.abs(Number(size[2])-expectedHeight)<1,route+' '+mode+' '+size[0]);
    assert.doesNotMatch(bytes,/\/Rotate\s+(90|180|270)\b/,route+' '+mode+' rotated');
   }
   await page.emulateMedia({media:'screen'});
  }
 }finally{await browser?.close();await new Promise(resolve=>site.close(resolve));}
});
test('real browser: current cobalt stock, independent permissions and both languages at desktop/mobile widths',async()=>{
 const f=E.fixture(),origin=f.appCfg.origin,app=await require('../../server/app.cjs').build({config:f.appCfg});let browser;const errors=[],shapes=[];
 try{
 await app.listen({host:'127.0.0.1',port:f.appCfg.port});browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 const open=async(role,base=origin,accounts=f.accounts)=>{const a=accounts.find(a=>a.role===role),context=await browser.newContext({viewport:{width:1440,height:1000}}),login=await context.request.post(base+'/api/v1/auth/login',{headers:{origin:base},data:{username:a.username,password:a.password}});assert(login.ok(),'UI login '+role);const page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/v1/')&&r.status()>=500)errors.push(r.status()+' '+new URL(r.url()).pathname);});await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.evaluate(()=>document.querySelector('#task-notice [data-task-dismiss]')?.click()));return {page,context};};
 const ready=p=>p.waitForFunction(()=>window.AppSignedIn&&window.V469R2?.installed&&typeof Router!=='undefined'&&!Router.rendering&&document.getElementById('session-restore').hidden);
 const go=async(p,url,product='CO_HYDROXIDE',base=origin)=>{await p.goto(base+'/overview');await ready(p);await p.evaluate(code=>localStorage.setItem(ProductContext.key,code),product);await p.goto(base+url);await ready(p);};
 const guest=await browser.newPage({viewport:{width:390,height:860}});guest.on('pageerror',e=>errors.push(e.message));await guest.goto(origin);
 await guest.locator('.login46-brand .login46-title-version').waitFor();
 assert.equal(await guest.locator('.login46-title-version').innerText(),'V'+release.version);
 assert(await guest.locator('.login46-brand h1').evaluate(el=>parseFloat(getComputedStyle(el.querySelector('.login46-title-version')).fontSize)<parseFloat(getComputedStyle(el).fontSize)));
 await guest.locator('[data-login-language="en"]').click();assert.match(await guest.locator('.login46-brand h1').innerText(),/Product Warehouse Management System/);
 assert.equal(await guest.locator('.login46-title-version').innerText(),'V'+release.version);
 await guest.locator('.login46-registration').click();await guest.locator('#registration-modal input[name=username]').waitFor();
 for(const name of ['contact_phone','contact_email'])assert(await guest.locator('#registration-modal input[name='+name+']').isVisible());
 const registration=guest.locator('#registration-modal');
 await registration.locator('button[type=submit]').click();
 for(const name of ['display_name','username','password','confirm','contact_phone'])assert(await registration.locator('#reg-field-'+name).isVisible());
 await registration.locator('input[name=display_name]').fill('Synthetic applicant');
 await registration.locator('input[name=username]').fill('synthetic_applicant');
 await registration.locator('input[name=contact_email]').fill('synthetic@example.invalid');
 await registration.locator('input[name=password]').fill('123456789');
 await registration.locator('input[name=confirm]').fill('123456789');
 assert.equal(await registration.locator('#reg-field-password').innerText(),'Password must contain 10–48 characters');
 const examplePassword='\u{1F512}'.repeat(48);
 await registration.locator('input[name=password]').fill(examplePassword);
 await registration.locator('input[name=confirm]').fill(examplePassword);
 assert.equal(await registration.locator('[aria-invalid=true]').count(),0);
 await guest.route('**/api/v1/auth/registration-token',route=>route.abort('failed'));
 await registration.locator('button[type=submit]').click();
 await guest.getByText('Connection failed. Check your network and retry.',{exact:true}).waitFor();
 await guest.screenshot({path:path.join(E.runtime,'registration-network-en-390.png'),fullPage:true});
 await guest.close();
 const admin=await open('admin'),viewer=await open('production_operator'),page=admin.page;
 for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
  await go(page,'/customs/packing-list',product);
  const language=page.locator('.top-actions select[data-language]');
  await language.selectOption('en');
  await page.getByRole('heading',{name:'Lot List',exact:true}).waitFor();
  await page.locator('[data-customs-nav] a[href="/customs/bp"]').click();
  await page.getByRole('link',{name:/Lots Pending BP Creation/}).waitFor();
  await page.getByRole('link',{name:/Lots on Created BP Sheets/}).click();
  const expand=page.getByRole('button',{name:/Expand Lots/}).first();
  if(await expand.count()){
   await expand.click();
   await page.getByRole('columnheader',{name:'Lot No.',exact:true}).first().waitFor();
   await page.getByRole('button',{name:/Collapse Lots/}).first().click();
  }
  await language.selectOption('zh-CN');
  await page.getByRole('link',{name:/已创建BP表批次/}).waitFor();
 }
 await go(page,'/sales-plans','CU_CATHODE');
 assert.deepEqual(await page.locator('#s468-filter :is(input,select)').evaluateAll(controls=>controls.map(control=>control.name)),
  ['plan_no','contract_no','customer_id','shipment_month','status']);
 await go(page,'/sales-plans','CO_HYDROXIDE');
 await page.locator('#ux10-sales-table').waitFor({state:'visible'});
 const planner=await open('export_supervisor'),reviewer=await open('logistics_manager');
 const workPlanNav='.sidebar [data-primary-route="preparation/work-plans"]';
 const workPlanPath='/preparation/work-plans';
 const P=require('./preparation-fixture.cjs');
 for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
  await go(planner.page,'/overview',product);
  await planner.page.locator(workPlanNav).click();
  await planner.page.waitForURL(origin+workPlanPath);
  const createPlan=planner.page.locator('#preparation-plan-create');
  await createPlan.waitFor().catch(async error=>{
   const pageState=await planner.page.evaluate(()=>({url:location.pathname,title:document.getElementById('business-title')?.textContent,
    message:document.querySelector('#page-content .error')?.textContent,navigating:document.body.classList.contains('wms-navigating')}));
   throw Error(JSON.stringify(pageState),{cause:error});
  });
  await createPlan.click();
  const form=planner.page.locator('#preparation-plan-batch'),sales=form.locator('[name=sales_plan_id]');
  const saveDrafts=form.getByRole('button',{name:/^(保存草稿|Save Drafts)$/});
  await sales.locator('option[value]:not([value=""])').first().waitFor({state:'attached'});
  await sales.selectOption({index:1});
  assert(await form.locator('[name=customer]').inputValue());
  const batch=P.batch(product,48917),batchField=form.locator('[name=batch_no]');
  await saveDrafts.click();
  assert.equal(await batchField.getAttribute('aria-invalid'),'true');
  assert.match(await form.locator('[data-batch-validation]').innerText(),/填写批次号|Enter a lot number/);
  await form.screenshot({path:path.join(E.runtime,'wms-preparation-validation-'+product+'.png')});
  await batchField.fill(batch);
  assert.equal(await batchField.getAttribute('aria-invalid'),null);
  await form.locator('[name=shipment_month]').fill(P.localMonth());
  const saved=planner.page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/preparation-plans/batch'),{timeout:6000});
  await saveDrafts.click();
  const saveResponse=await saved.catch(async error=>{
   const invalid=await form.locator(':invalid').evaluateAll(fields=>fields.map(field=>field.name));
   const validation=await form.locator('[data-batch-validation]').textContent();
   throw Error(product+' plan form did not submit '+JSON.stringify({invalid,validation,errors}),{cause:error});
  });
  assert.equal(saveResponse.status(),200,product+' '+await saveResponse.text());
  const operationKey=saveResponse.request().headers()['idempotency-key'];
  assert(operationKey);
  assert.deepEqual(await planner.page.evaluate(key=>API.check(key),operationKey),{committed:true});
  await planner.page.waitForURL('**/preparation/work-plans?state=DRAFT');
  await planner.page.locator('#preparation-plans-table').getByRole('link',{name:batch,exact:true}).click();
  const detailPattern=/\/preparation\/work-plans\/[0-9a-f-]{36}$/;
  await planner.page.waitForURL(detailPattern);
  const detail=new URL(planner.page.url()).pathname;
  await planner.page.locator('[data-plan-action=submit]').click();
  await planner.page.locator('#operation-confirm-accept').click();
  await planner.page.locator('[data-plan-action=submit]').waitFor({state:'detached'});
  await go(reviewer.page,'/overview',product);
  const task=await reviewer.page.evaluate(async href=>{
   const co=!ProductContext.isCopper(),result=await API.request(co?'/cobalt/ui461/tasks':'/v34/todos');
   return (co?result.pending:result.items).find(item=>item.href===href);
  },detail);
  assert.equal(task.kind,'PREPARATION_PLAN_REVIEW');
  await reviewer.page.locator(workPlanNav+' .ux-nav-count').waitFor();
  await reviewer.page.goto(origin+task.href);
  await ready(reviewer.page);
  await reviewer.page.locator('[data-plan-action=approve]').waitFor();
  const reviewerDoc=await reviewer.page.reload();
  assert.equal(reviewerDoc.status(),200);
  await ready(reviewer.page);
  await reviewer.page.locator('[data-plan-action=reject]').click();
  const comment=reviewer.page.locator('#operation-confirm-comment');
  assert(await comment.evaluate(field=>field.required));
  await reviewer.page.locator('#operation-confirm-accept').click();
  assert(await comment.isVisible());
  await comment.fill('Synthetic browser return reason');
  await reviewer.page.locator('#operation-confirm-accept').click();
  await reviewer.page.getByText(/Synthetic browser return reason/).waitFor();
  await planner.page.reload();await ready(planner.page);
  await planner.page.getByText('Synthetic browser return reason',{exact:false}).first().waitFor();
  const resubmit=planner.page.locator('[data-plan-action=submit]');
  await resubmit.focus();
  await resubmit.press('Enter');
  const confirmResubmit=planner.page.locator('#operation-confirm-accept');
  await confirmResubmit.click().catch(async error=>{
   const state=await planner.page.evaluate(()=>({title:document.title,submit:!!document.querySelector('[data-plan-action=submit]'),
    modal:!!document.querySelector('dialog[open]'),session:AppSignedIn,loading:Router.rendering}));
   throw Error(JSON.stringify({state,errors}),{cause:error});
  });
  await planner.page.locator('[data-plan-action=submit]').waitFor({state:'detached'});
  await reviewer.page.reload();await ready(reviewer.page);
  await reviewer.page.locator('[data-plan-action=approve]').click();
  await reviewer.page.locator('#operation-confirm-accept').click();
  await reviewer.page.locator('[data-plan-action=approve]').waitFor({state:'detached'});
  const createPath=product==='CU_CATHODE'?'/preparation/new':'/receipts/new';
  await go(page,createPath,product);
  await page.waitForURL(origin+createPath);
  const approved=page.locator('#executable-preparation-plans tr').filter({hasText:batch});
  await approved.locator('a[href="'+detail+'"]').waitFor();
  assert.match(await approved.locator('a[href*="preparation_plan="]').getAttribute('href'),new RegExp(detail.split('/').at(-1)+'$'));
  await page.screenshot({path:path.join(E.runtime,'v475-executable-preparation-'+product+'.png'),fullPage:true});
  await approved.locator('a[href*="preparation_plan="]').click();
  await page.waitForURL(url=>url.pathname===createPath&&url.searchParams.get('preparation_plan')===detail.split('/').at(-1));
  await page.getByText(batch,{exact:true}).first().waitFor();
  await go(viewer.page,'/overview',product);
  const denied=await viewer.page.goto(origin+detail);
  assert.equal(denied.status(),403);
  await ready(viewer.page);
  assert.equal(await viewer.page.locator('[data-plan-action]').count(),0);
 }
 await planner.context.close();await reviewer.context.close();
 await go(page,'/inventory/'+f.preparation);await page.locator('.co469r2-stock .co2-bags').waitFor();assert.equal(await page.locator('.co2-bags tbody tr').count(),3);assert((await page.locator('.co2-bags').innerText()).includes('AUDIT-'));
 for(const language of ['zh-CN','en']){await page.evaluate(l=>I18n.set(l),language);await page.waitForFunction(()=>!!document.querySelector('.co469r2-stock .co2-bags'));for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'stock overflow '+language+' '+width);shapes.push({page:'stock',language,width});}await page.screenshot({path:path.join(E.runtime,'stock-'+language+'.png'),fullPage:true});}
 await page.setViewportSize({width:390,height:860});
 const mobile=page.locator('.mobile-nav-shell'),mobileSummary=mobile.locator(':scope > summary');
 assert.equal(await mobile.getAttribute('open'),null);
 await mobileSummary.press('Enter');
 assert(await mobile.locator('[data-product-switch=CU_CATHODE]').isVisible());
 await mobile.locator('[data-product-switch=CU_CATHODE]').click();
 await page.waitForFunction(()=>window.ProductContext?.code==='CU_CATHODE'&&window.AppSignedIn);
 await ready(page);assert.equal(await page.locator('[data-primary-route=cobalt-metal]').count(),0);
 await go(page,'/inventory/'+f.preparation);
 await go(viewer.page,'/inventory/'+f.preparation);assert.equal(await viewer.page.locator('[data-co2-select],#co2-place').count(),0);
 await go(page,'/workbench/permissions');
 await page.locator('[data-role=admin]').press('Enter');
 await page.locator('.s46-r2-matrix').waitFor();
 const permissionMatrix=await page.evaluate(()=>{
  const catalog=Accounts.permissionCatalog.workflow;
  const codes=Accounts.roles.find(role=>role.code==='admin').caps.filter(code=>catalog[code]);
  return {codes:codes.sort(),modules:[...new Set(codes.map(code=>catalog[code].module))].sort()};
 });
 assert.deepEqual(await page.locator('.s46-r2-matrix input[type=checkbox]').evaluateAll(inputs=>inputs.map(input=>input.value).sort()),permissionMatrix.codes);
 assert.deepEqual(await page.locator('.s46-r2-matrix tbody tr[data-permission-module]').evaluateAll(rows=>rows.map(row=>row.dataset.permissionModule).sort()),permissionMatrix.modules);
 assert(await page.locator('.s46-r2-matrix thead').isVisible());
 const cobalt=page.locator('.s46-permission-items').filter({has:page.locator('input[value="co:create"]')});
 assert.equal(await cobalt.count(),1);
 assert.equal(await cobalt.locator('input[value="co:submit"],input[value="co:withdraw"]').count(),2);
 assert(!(await cobalt.locator('input[value="co:create"]').isVisible()));
 await cobalt.locator('summary').click();
 const create=cobalt.locator('input[value="co:create"]'),checked=await create.isChecked();
 await create.setChecked(!checked);
 assert(await cobalt.locator('label').first().evaluate(label=>{const cell=label.closest('td'),head=cell.closest('table').tHead.rows[0].cells[cell.cellIndex],middle=r=>r.x+r.width/2;return Math.abs(middle(head.getBoundingClientRect())-middle(label.getBoundingClientRect()))<2&&getComputedStyle(label).alignItems==='center'&&getComputedStyle(label).textAlign==='center';}));
 await cobalt.locator('summary').click();
 assert.equal(await create.isChecked(),!checked);
 assert(await cobalt.locator('xpath=ancestor::tr/th').isVisible());
 const planGroup=page.locator('.s46-permission-items').filter({has:page.locator('input[value="plan:approve"]')});
 if(await planGroup.count())await planGroup.locator('summary').click();
 const initial=page.locator('.s46-r2-matrix input[value="plan:approve"]'),final=page.locator('.s46-r2-matrix input[value="plan:commerce-approve"]');assert(await initial.isEnabled()&&await final.isEnabled());await initial.uncheck();assert(await final.isChecked());await page.locator('#role-reset').click();assert(await initial.isChecked());for(const code of ['users:manage','roles:manage'])assert(await page.locator('.s46-r2-matrix input[value="'+code+'"]').isDisabled());
 for(const language of ['zh-CN','en']){await page.evaluate(l=>I18n.set(l),language);await page.waitForTimeout(150);for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'permissions overflow '+language+' '+width);shapes.push({page:'permissions',language,width});}await page.screenshot({path:path.join(E.runtime,'permissions-'+language+'.png'),fullPage:true});}
 assert.equal(await page.locator('.s46-access').count(),0);
 assert.equal(await page.evaluate(()=>ClientRelease.revision),release.frontendRevision);
 await page.setViewportSize({width:1440,height:1000});
 const historicalMetalPeriod='from=2020-03-05&to=2020-03-05';
 await go(page,'/reports?section=outbound&view=shipping&'+historicalMetalPeriod);
 await page.waitForFunction(()=>window.Reports463?.current?.data?.kind==='shipping'&&document.querySelector('.r463-stats'));
 const ship=await page.evaluate(()=>Object.fromEntries(Reports463.current.data.metrics.map(m=>[m.key,m.value])));assert.equal(ship.metal,0.24123);assert.equal(ship.metalPending,0);
 assert.match(await page.locator('.r463-stats').innerText(),/0\.24123/);
 await page.locator('#r481-filter details summary').click();assert(await page.locator('input[name=lot]').isVisible());
 await page.goto(origin+'/workbench/accounts');await ready(page);await page.locator('#account-filter').waitFor();assert.equal(await page.locator('#account-registration-requests').count(),1);
 await page.locator('#account-create').click();for(const name of ['username','contact_phone','contact_email'])assert(await page.locator('#account-edit input[name='+name+']').isVisible());await page.locator('#account-cancel').click();
 await page.locator('[data-account-action="edit"]').first().click();for(const name of ['contact_phone','contact_email'])assert(await page.locator('#account-edit input[name='+name+']').isVisible());await page.locator('#account-cancel').click();
 await page.evaluate(()=>I18n.change('zh-CN'));
 await go(page,'/overview?'+historicalMetalPeriod);await page.locator('.oa-kpis-cobalt').waitFor();
 assert.deepEqual(await page.locator('.oa-kpis-cobalt .oa-kpi > span').allTextContents(),['备货作业中吨包','已备货待出库库存','装车中库存','在库库存预估金属量','ARECOMS确认车数与钴金属量','已出库重量']);
 assert.equal(await page.locator('.oa-kpis-confirmation .oa-kpi').count(),0);
 assert.match(await page.locator('.oa-kpis-cobalt .oa-kpi').nth(4).innerText(),/\d+\.\d{5}\s*金属吨/);
 assert.equal(await page.getByText('查看待确认车辆',{exact:true}).count(),0);
 assert.equal(await page.getByRole('heading',{name:'月度发运金属量统计',exact:true}).count(),1);
 const legacyOverview='**/api/v1/cobalt/overview?*';
 await page.route(legacyOverview,async route=>{
  const response=await route.fetch(),data=await response.json();
  delete data.metal.period;delete data.analysis.stock_cards.loaded;
  await route.fulfill({response,json:data});
 });
 await go(page,'/overview');await page.locator('.oa-kpis-cobalt').waitFor();
 assert.equal(await page.locator('.oa-kpis-confirmation .oa-kpi').count(),0);
 await page.unroute(legacyOverview);
 await go(page,'/inventory/'+f.preparation);
 assert.deepEqual(await page.locator('#co-stock-filter > label').evaluateAll(labels=>labels.slice(0,4).map(label=>label.querySelector('select').name)),['location_id','stock_state','phase','zone_id']);
 assert.equal(await page.locator('#co-stock-filter details').count(),0);
 await page.locator('.co2-filter').screenshot({path:path.join(E.runtime,'cobalt-inventory-filters.png')});
 const headers=await page.evaluate(()=>I18n.language)==='en'?['Lot Number','Location','Bags','Net Weight (MT)','Stock Status','Workflow Status','Receipt Date','Sampling Status','Remarks','Actions']:
  ['批次号','货位','吨包数','净重（MT）','库存状态','业务状态','入库日期','取样状态','备注','操作'];
 assert.deepEqual(await page.locator('.co2-batches thead th').allTextContents(),headers);
 assert.match(await page.locator('.co2-batches tbody td:nth-child(4)').first().innerText(),/\d+\.\d{4}\b/);
 assert.equal(await page.locator('.co2-batches tbody td:nth-child(8)').first().evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
 const plan=f.dispatchMonthPlans.CO_HYDROXIDE.id;
 const plannedLoad=await page.evaluate(async({plan,preparation})=>{
  const dispatch='/cobalt/sales/plans/'+plan+'/dispatch';
  const {plan:record}=await API.request(dispatch),plate='UI-CO-'+Date.now(),trailer=plate+'-TR';
  const transport={driver_name:'Synthetic UI driver',passport_no:plate+'-P',transporter:'Synthetic UI carrier'};
  const vehicle=await API.request(dispatch+'/vehicles',{method:'POST',body:{
   plan_version:record.version,truck_no:plate,trailer_no:trailer,capacity_tonnes:'30',destination:'Synthetic UI destination',...transport}});
  const arrival=await API.request('/cobalt/sales/arrivals/'+vehicle.id,{method:'POST',body:{
   dispatch_version:vehicle.version,trailer_one:trailer,arrived_at:new Date().toISOString(),container_no:'',exception_remark:'',...transport}});
  const source={sales_plan_id:plan,preparation_id:preparation,arrival_id:arrival.id};
  const {versions}=await API.request('/cobalt/loading/preview?'+new URLSearchParams(source));
  return API.request('/cobalt/loading/plans',{method:'POST',body:{
   ...source,...versions,planned_load_date:BusinessTime.today(),invoice_no:plate,
   destination:'Synthetic UI destination',export_license_no:'SYNTHETIC'}});
 },{plan,preparation:f.preparation});
 await go(page,'/sales-plans/'+plan+'/dispatch');
 await page.locator('#co-dispatch-table').waitFor();
 assert.equal(await page.locator('input[name=shipment_month]').count(),0);
 await go(page,'/loading-plans?arrival_state=PLANNED');
 await page.locator('#co-arrivals-table a[href="/loading-plans/orders/'+plannedLoad.id+'"]').waitFor();
 await go(page,'/overview?'+historicalMetalPeriod);
 await page.locator('#co-metal-months meter').first().waitFor();
 await go(page,'/cobalt-metal?view=outbound&status=COMPLETED&'+historicalMetalPeriod);await page.locator('#co-metal-list').waitFor();
 assert.match(await page.locator('#co-metal-list').innerText(),/0\.24123/);
 assert.equal(await page.locator('.co-metal-kpis .oa-kpis-confirmation .oa-kpi').count(),3);
 assert.equal(await page.locator('.co-metal-kpis .oa-kpis-cobalt').count(),0);
 assert.equal(await page.locator('.sidebar [data-primary-route=cobalt-metal]').count(),1);
 for(const language of ['zh-CN','en']){
  await page.evaluate(l=>I18n.set(l),language);
  await page.waitForFunction(l=>document.querySelector('#business-title').textContent===(l==='en'?'Cobalt Metal Management':'钴金属量管理'),language);
  for(const width of [1440,768,390,320]){
   await page.setViewportSize({width,height:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'metal overflow '+language+' '+width);
   shapes.push({page:'cobalt-metal',language,width});
  }
  await page.screenshot({path:path.join(E.runtime,'cobalt-metal-'+language+'.png'),fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 const detailLink=page.locator('#co-metal-list a[href="/stock-outbound/historical/'+f.historicalMetalSource.outboundId+'#co-metal-detail"]'),detailUrl=await detailLink.getAttribute('href');
 await detailLink.press('Enter');await page.waitForURL(origin+detailUrl);
 await page.locator('#co-metal-detail').waitFor();
 assert.match(await page.locator('#co-metal-detail').innerText(),/0\.00827/);
 await page.emulateMedia({media:'print'});assert(await page.locator('#co-metal-detail').isVisible());
 assert.match(await page.locator('#co-metal-detail').innerText(),/0\.24123/);
 await page.emulateMedia({media:null});
 await go(page,'/receipts/'+f.preparation+'/work');
 await page.locator('.co469-page .co-metal-section').first().waitFor();
 assert.equal(new URL(page.url()).pathname,'/receipts/'+f.preparation);
 assert.equal(await page.locator('.co469-heading nav').count(),0);
 const worker=await open('logistics_field_operator');
 await go(worker.page,'/receipts/'+f.estimatedPreparation);
 const seal=worker.page.locator('[data-co469-seal]').first();
 const sealResponse=worker.page.waitForResponse(r=>r.url().endsWith('/work/seal-check')&&r.request().method()==='POST');
 await seal.click();
 await seal.press('ControlOrMeta+A');
 await seal.pressSequentially(f.sealConflict.seal.toLowerCase());
 const sealCheck=await sealResponse.catch(async err=>{
  const state=await worker.page.evaluate(()=>({path:location.pathname,product:ProductContext.code,active:CobaltPreparation469.active(),dirty:CobaltPreparation469.dirty.size,sequence:CobaltPreparation469.sealSequence,hasValue:!!document.querySelector('[data-co469-seal]')?.value}));
  throw Error(err.message+' '+JSON.stringify({state,errors}));
 });
 assert.equal(sealCheck.status(),200,await sealCheck.text());
 assert((await sealCheck.json()).conflicts.some(r=>r.conflicting_bag_no===f.sealConflict.bag));
 await worker.page.waitForFunction(bag=>[...document.querySelectorAll('.co-seal-feedback')].some(n=>n.textContent.includes(bag)),f.sealConflict.bag);
 await seal.fill('');
 await worker.page.waitForFunction(()=>![...document.querySelectorAll('.co-seal-feedback')].some(n=>n.textContent));
 await worker.context.close();
 assert.match(await page.locator('[data-co469-net]').first().innerText(),/0\.6470/);
 assert.doesNotMatch(await page.locator('.co469-page').innerText(),/生产批次|Production Batch/);
 await go(page,'/receipts/new?preparation_plan='+f.coUiWorkPlan);await page.locator('input[name=total_bags]').waitFor();
 assert.equal(await page.locator('input[name=production_batch],input[name=production_batch_code],select[name=production_batch_id]').count(),0);
 await go(page,'/overview');
 for(const chart of ['net','vehicles','prepared']){
  await page.locator('[data-oa-plot="'+chart+'"] svg').waitFor();
  for(const mode of ['line','bar']){await page.locator('[data-oa-key="'+chart+'"][data-oa-type="'+mode+'"]').click();assert.equal(await page.locator('[data-oa-plot="'+chart+'"]').getAttribute('data-chart-type'),mode);}
 }
 assert.equal(await page.locator('.oa-charts > section').count(),4);
 assert.equal(await page.locator('.oa-metal-chart .v34-table-tools').count(),0);
 await page.locator('.oa-metal-chart').screenshot({path:path.join(E.runtime,'overview-monthly-metal.png')});
 await go(page,'/overview','CU_CATHODE');
 await page.locator('[data-oa-plot="net"] svg').waitFor();
 for(const key of ['vehicles','receipts','stock']){
  const plot=page.locator('[data-oa-plot="'+key+'"]');
  await plot.locator('svg').waitFor();
  assert.equal(await plot.locator('svg').count(),1);
  const ticks=await plot.locator('.oa-y-left').allTextContents();
  assert(ticks.length>1&&ticks.every(value=>/^\d+$/.test(value)));
  if(key==='stock'){
   assert.equal(await page.locator('.oa-stock-trends svg').count(),1);
   assert.equal(await plot.locator('.oa-y-right').count(),ticks.length);
  }else{
   const unit=key==='vehicles'?'辆|vehicles':'捆|bundles';
   const reading=key==='vehicles'?'vehicles':'inbound_units';
   const mark=plot.locator('.oa-bar[data-oa-period],.oa-dot[data-oa-period]').last();
   await mark.waitFor();
   const index=Number(await mark.getAttribute('data-oa-period'));
   const row=JSON.parse(await plot.getAttribute('data-rows'))[index];
   await mark.hover();
   const tooltip=plot.getByRole('tooltip');
   await tooltip.waitFor();
   const [period,value]=(await tooltip.textContent()).split('\n');
   assert.equal(period,row.period);
   assert.match(value,new RegExp(' · '+row[reading]+' ('+unit+')$'));
  }
 }
 assert.match(await page.locator('.oa-kpis .oa-kpi').nth(1).innerText(),/备货作业中捆包|Bundles in Preparation/);
 assert.equal(await page.locator('.oa-design-intro').count(),0);
 await go(page,'/inventory','CU_CATHODE');
 await page.locator('#filter-form .filter-grid').waitFor();
 assert(await page.locator('#filter-form .filter-grid').evaluate(grid=>{
  const cells=[...grid.querySelectorAll(':scope > label')].filter(label=>label.getClientRects().length).map(label=>label.getBoundingClientRect());
  return cells.length===10&&Math.abs(cells[0].left-cells[5].left)<2&&Math.abs(cells[4].right-cells[9].right)<2;
 }),'copper inventory filters align across both desktop rows');
 await page.locator('#filter-form').screenshot({path:path.join(E.runtime,'copper-inventory-filters.png')});
 await go(page,'/stock-map?project_id='+f.project+'&warehouse_id='+f.warehouse,'CU_CATHODE');
 await page.locator('.stock-map-layout #stock-map-canvas').waitFor();
 assert.equal(await page.locator('.wms-map-advanced,#stock-map-filter').count(),0);
 assert.equal(await page.locator('#stock-map-metrics article').count(),5);
 assert.match(await page.locator('.v27-map-toolbar #v33-map-move').getAttribute('href'),/^\/stock-map\/relocate\?/);
 assert(await page.locator('.stock-map-layout + #v271-map-labels .v47-map-temporary h3').isVisible());
 assert.equal(await page.locator('#stock-map-svg g[data-map-cell="P3"]').count(),1);
 assert.match(await page.locator('#stock-map-svg g[data-map-cell="P5"]').getAttribute('aria-label'),/新生产捆包堆存区|New Production Bundles Stock Area/);
 await page.evaluate(()=>I18n.set('en'));
 await page.locator('#stock-map-svg g[data-map-cell="P5"][aria-label^="New Production Bundles Stock Area"]').waitFor();
 await page.evaluate(()=>I18n.set('zh-CN'));
 await page.locator('#stock-map-canvas [data-map-cell="P1-01"]').press('Enter');
 await page.locator('.stock-map-layout.v27-has-detail #stock-map-detail h2').first().waitFor();
 assert(await page.locator('#stock-map-detail').evaluate(el=>{const map=document.getElementById('stock-map-canvas').getBoundingClientRect(),detail=el.getBoundingClientRect();return detail.right<=map.right&&detail.left>map.left&&getComputedStyle(el).position==='sticky';}));
 assert(await page.locator('#v271-map-labels .v271-label-grid').isVisible());
 await go(page,'/stock-map?project_id='+f.project+'&warehouse_id='+f.warehouse);
 await page.locator('#co-map-canvas').waitFor();
 assert.equal(await page.locator('.wms-map-advanced').count(),0);
 for(const field of ['project_id','warehouse_id','zone_id','location_id','customer_id','batch','bag','unlocated'])assert(await page.locator('#co-stock-filter [name='+field+']').isVisible(),field);
 for(const field of ['status','phase'])assert.equal(await page.locator('#co-stock-filter [name='+field+']').count(),0);
 assert(await page.locator('#co-map-adjust').isDisabled());
 assert(await page.locator('#map465-temporary-list').isVisible());
 await page.locator('#map465-location-list [data-map465-location="'+f.location+'"]').click();
 await page.locator('#co-map-detail').waitFor();
 assert(await page.locator('#co-map-detail').evaluate(el=>getComputedStyle(el).position==='sticky'&&el.getBoundingClientRect().right<=innerWidth));
 assert(await page.locator('#co-map-adjust').isEnabled());
 await page.screenshot({path:path.join(E.runtime,'cobalt-map-floating-detail.png')});
 await page.setViewportSize({width:390,height:844});
 assert(await page.locator('#co-map-detail').evaluate(el=>{const bounds=el.getBoundingClientRect(),canvas=document.getElementById('co-map-canvas').getBoundingClientRect();return bounds.left>=0&&bounds.right<=innerWidth&&bounds.top>=canvas.bottom&&getComputedStyle(el).position==='static';}));
 await page.locator('.map465-close').press('Escape');
 assert(await page.locator('#co-map-detail').isHidden());
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('#map465-location-list [data-map465-location="'+f.location+'"]').click();
 await page.locator('#co-map-adjust').click();await ready(page);
 await page.locator('details.co2-placement[open] #co2-place').waitFor();
 for(const field of ['stock_state','phase'])assert(await page.locator('#co-stock-filter [name='+field+']').isVisible(),field);
 assert.equal(new URL(page.url()).searchParams.get('location_id'),f.location);
 for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
  await go(page,'/export-licenses',product);
  await page.locator('#export-license-table a').first().waitFor();
  const language=page.locator('.top-actions [data-language]');
  await language.selectOption('en');
  await page.getByRole('heading',{name:'Export License Management',exact:true}).waitFor();
  await page.locator('#export-license-table a').first().waitFor();
  await language.selectOption('zh-CN');
  await page.getByRole('heading',{name:'出口许可证管理',exact:true}).waitFor();
  await page.locator('#export-license-table a').first().waitFor();
  for(const width of [1280,1440,1920]){
   await page.setViewportSize({width,height:900});
   const clipped=await page.locator('#export-license-table').evaluate(table=>[...table.querySelectorAll('th,td')].filter(cell=>{
    const bounds=cell.getBoundingClientRect(),range=document.createRange();
    range.selectNodeContents(cell);
    return [...range.getClientRects()].some(rect=>rect.width>0&&(rect.left<bounds.left-1||rect.right>bounds.right+1));
   }).map(cell=>cell.cellIndex));
   assert.deepEqual(clipped,[],product+' license table at '+width);
   const geometry=await page.locator('#export-license-filter').evaluate(form=>{
    const children=[...form.querySelectorAll(':scope > label > input,:scope > label > select,:scope > .wms-filter-actions > .button')];
    const rects=children.map(el=>el.getBoundingClientRect()),range=values=>Math.max(...values)-Math.min(...values);
    return {controls:rects.length,bottoms:range(rects.map(r=>r.bottom)),heights:range(rects.map(r=>r.height)),
     reset:form.querySelectorAll('[data-wms-reset]').length,numberAlignment:[...new Set([...document.querySelectorAll('#export-license-table [data-wms-column=number]')].map(cell=>getComputedStyle(cell).textAlign))]};
   });
   assert.equal(geometry.controls,9);
   assert.equal(geometry.reset,1);
   assert.deepEqual(geometry.numberAlignment,['center']);
   assert(geometry.heights<=2,product+' filter alignment at '+width+' '+JSON.stringify(geometry));
  }
  await page.setViewportSize({width:1440,height:1000});
  assert(await page.locator('.sidebar [data-primary-route=sales-plans] + [data-primary-route=export-licenses]').isVisible());
  const filter=page.locator('#export-license-filter');
  await filter.locator('[name=proforma_no]').fill('SYNTHETIC-UNMATCHED-DESIGN');
  await filter.locator('.wms-filter-actions button').click();
  await page.waitForURL(url=>url.searchParams.get('proforma_no')==='SYNTHETIC-UNMATCHED-DESIGN');
  await page.locator('.s46-state[data-sys-code="SYS-13"]').waitFor();
  await filter.locator('[data-wms-reset]').click();
  await page.waitForURL(origin+'/export-licenses');
  await page.locator('#export-license-table a').first().waitFor();
  const expiring=product==='CU_CATHODE'?'SYNTH-EXPIRED':'LICENSE-AUDIT-CO_HYDROXIDE-NUMBER';
  await page.locator('#export-license-table tbody tr').filter({hasText:expiring}).first().locator('a').first().click();
  await page.locator('[data-permit-action="extend"]').click();
  const extension=page.locator('#permit-extension-form'),expiry=extension.locator('input[name=until]');
  await expiry.fill('2020-01-01');
  await extension.locator('input[name=reason]').fill('Synthetic browser extension check');
  await extension.locator('button.primary').click();
  assert.equal(await expiry.getAttribute('aria-invalid'),'true');
  assert(await page.locator('#permit-extension-date-error').isVisible());
  await page.locator('#permit-extension').screenshot({path:path.join(E.runtime,'license-extension-'+product+'.png')});
  await page.locator('#dialog').evaluate(box=>box.close());
  await go(page,'/export-licenses',product);
  await page.locator('a[href="/export-licenses/new"]').click();
  const form=page.locator('#export-license-application');
  await form.locator('[name=contract_id]').selectOption({index:1});
  const contractValue=await form.locator('[name=contract_id]').inputValue();
  await language.selectOption('en');
  await page.locator('#operation-confirm-cancel').click();
  assert.equal(await language.inputValue(),'zh-CN');
  assert.equal(await form.locator('[name=contract_id]').inputValue(),contractValue);
  assert.equal(await form.locator('[data-book-field]').count(),7);
  const book=page.locator('#permit-book-dialog');
  const runLabel=Date.now().toString(36);
  const label=value=>value+' '+runLabel;
  const addRecord=async(key,value)=>{
   await form.locator('[data-book-open='+key+']').click();
   await book.locator('input[name=value]').fill(value);
   if(key.endsWith('_account')){
    await book.locator('input[name=account_name]').fill('Synthetic account holder');
    await book.locator('input[name=swift_code]').fill(key.startsWith('issuing')?'TST1CD01':'TST2GB2L123');
   }
   const saved=page.waitForResponse(response=>response.url().endsWith('/export-permits/record-books')&&response.request().method()==='POST');
   await book.locator('[data-book-save]').click();
   const response=await saved;
   assert(response.ok(),key+' '+await response.text());
   await book.waitFor({state:'hidden'});
   return form.locator('[data-book-field='+key+']');
  };
  for(const [key,value] of [['clearing_agent',label('Synthetic UI customs')],['issuing_bank',label('Synthetic UI issuing bank A')],['issuing_bank_account','SYNTH-A-001'],['offshore_bank',label('Synthetic UI offshore bank')],['offshore_bank_account','SYNTH-OFF-001'],['destination',label('Synthetic UI license destination')],['note',label('Synthetic UI initial note')]]){
   await (await addRecord(key,value)).selectOption({label:value});
  }
  const issuing=await addRecord('issuing_bank',label('Synthetic UI issuing bank B'));
  await issuing.selectOption({label:label('Synthetic UI issuing bank B')});
  const account=form.locator('[data-book-field=issuing_bank_account]');
  assert.equal(await account.inputValue(),'');
  assert.equal(await account.locator('option').filter({hasText:'SYNTH-A-001'}).count(),0);
  await issuing.selectOption({label:label('Synthetic UI issuing bank A')});
  assert.equal(await account.locator('option:checked').innerText(),'SYNTH-A-001');
  assert.equal(await form.locator('[data-account-holder=issuing_bank_account]').inputValue(),'Synthetic account holder');
  assert.equal(await form.locator('[data-account-swift=issuing_bank_account]').inputValue(),'TST1CD01');
  assert.equal(await form.locator('[data-account-swift=offshore_bank_account]').inputValue(),'TST2GB2L123');
  const reference='SYNTH-UI-'+product+'-'+Date.now();
  await form.locator('[name=proforma_no]').fill(reference);
  await form.locator('[name=quantity]').fill('12.345678');
  await form.locator('[name=unit_price]').fill('10.12');
  assert.equal(await form.locator('[data-permit-amount]').inputValue(),'124.94');
  assert.equal(await form.locator('[name=unit_basis],[name=price_unit],[name=currency]').count(),0);
  await form.locator('button[type=submit],button.primary').click();
  await page.waitForURL(/\/export-licenses\/[0-9a-f-]{36}$/);
  await page.locator('.permit-identity').getByRole('heading',{name:reference,exact:true}).waitFor();
  await page.locator('a[href$="/edit"]').click();
  await form.locator('[data-book-field=issuing_bank_account] option:checked').filter({hasText:'SYNTH-A-001'}).waitFor({state:'attached'});
  await (await addRecord('note',label('Synthetic browser edit'))).selectOption({label:label('Synthetic browser edit')});
  await page.locator('#export-license-application button.primary').click();
  await page.waitForURL(/\/export-licenses\/[0-9a-f-]{36}$/);
  await page.locator('#permit-tab-processing').click();
  await page.locator('#permit-panel-processing').getByText(label('Synthetic browser edit'),{exact:true}).waitFor();
  await page.screenshot({path:path.join(E.runtime,'export-license-'+product+'.png'),fullPage:true});
  await go(page,'/export-licenses/new',product);
  await form.locator('[name=contract_id]').selectOption({index:1});
  await form.locator('[data-book-field=note] option').filter({hasText:label('Synthetic browser edit')}).waitFor({state:'attached'});
  await form.locator('[data-book-field=issuing_bank]').selectOption({label:label('Synthetic UI issuing bank A')});
  assert.equal(await form.locator('[data-book-field=issuing_bank_account] option').filter({hasText:'SYNTH-A-001'}).count(),1);
  await page.screenshot({path:path.join(E.runtime,'license-record-books-'+product+'.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'record books overflow '+product);
  await form.locator('[data-book-open=offshore_bank]').focus();
  await page.keyboard.press('Enter');
  await book.waitFor({state:'visible'});
  assert(await book.locator('[name=value]').evaluate(el=>document.activeElement===el));
  await page.keyboard.press('Escape');
  assert(await form.locator('[data-book-open=offshore_bank]').evaluate(el=>document.activeElement===el));
  await page.screenshot({path:path.join(E.runtime,'license-record-books-390-'+product+'.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
 }
 const invoiceFlow=JSON.parse(require('node:fs').readFileSync(path.join(E.runtime,'rc2-cobalt-browser-fixture.json'),'utf8'));
 const invoicePort=4398,invoiceOrigin='http://127.0.0.1:'+invoicePort;
 const invoiceApp=await require('../../server/app.cjs').build({config:{...E.appConfig(invoiceFlow.database),port:invoicePort,origin:invoiceOrigin}});
 try{
  await invoiceApp.listen({host:'127.0.0.1',port:invoicePort});
  const invoiceSession=await open('admin',invoiceOrigin,[invoiceFlow.account]),invoicePage=invoiceSession.page;
  const invoiceGo=url=>go(invoicePage,url,'CO_HYDROXIDE',invoiceOrigin);
  await invoiceGo('/sales-plans');
  await invoicePage.locator('#ux10-sales-table').waitFor();
  assert.equal(await invoicePage.locator('.sales-execution-metrics .v34-kpi').count(),4);
  await invoicePage.screenshot({path:path.join(E.runtime,'v473-sales-plan-list.png'),fullPage:true});
  await invoiceGo('/sales-plans/'+invoiceFlow.planId);
  await invoicePage.locator('#sales-related-plans').waitFor();
  assert(await invoicePage.locator('.business-toolbar a[href="/sales-plans/'+invoiceFlow.planId+'/dispatch"]').first().isVisible());
  await invoicePage.screenshot({path:path.join(E.runtime,'v473-sales-plan-detail.png'),fullPage:true});
  const invoiceRow=invoicePage.locator('#sales-invoice-table tbody tr').filter({has:invoicePage.getByText(invoiceFlow.batchNo,{exact:true})});
  const fits=()=>invoicePage.locator('#sales-invoice-table').evaluate(table=>table.parentElement.scrollWidth<=table.parentElement.clientWidth+2);
  assert(await fits());
  await invoicePage.setViewportSize({width:390,height:844});
  assert(await fits());
  await invoicePage.setViewportSize({width:1440,height:1000});
  await invoiceRow.locator('[data-confirm-invoice]').click();
  await invoicePage.locator('#operation-confirm-accept').click();
  await invoiceRow.getByText(/^(Confirmed|已确认)$/).waitFor();
  assert.equal(await invoiceRow.locator('[data-confirm-invoice]').count(),0);
  await invoicePage.locator('#sales-invoice-batches').screenshot({path:path.join(E.runtime,'cobalt-confirmed-invoice.png')});
  await invoiceSession.context.close();
 }finally{await invoiceApp.close();}
 await go(page,'/receipts/new','CU_CATHODE');
 await page.locator('.r10-draft-flow').waitFor();
 assert.equal(await page.locator('.ui46-entry-summary').count(),0);
 assert(await page.locator('.r10-draft-flow').evaluate(el=>el.getBoundingClientRect().bottom<=document.querySelector('#v26-receipt').getBoundingClientRect().top));
 const copperRun=JSON.parse(require('node:fs').readFileSync(path.join(E.runtime,'rc2-copper-results.json'),'utf8'));
 assert.equal(copperRun.database,f.database);
 await go(page,'/preparation/new?preparation_plan='+copperRun.uiWorkPlan,'CU_CATHODE');
 const batch=page.locator('#v261-lot-no');await batch.waitFor();
 assert.equal(await page.locator('.ui46-entry-summary').count(),0);
 assert.equal(await page.locator('#v261-create > .v470-lot-section').count(),2);
 await page.waitForFunction(()=>/^RMM-CU-\d{4}-\d{2}$/.test(document.getElementById('v261-lot-no')?.value||''));
 assert.equal(await batch.inputValue(),copperRun.uiBatch);
 assert(await batch.evaluate(el=>el.readOnly));
 assert.equal(await page.locator('#v261-plan').inputValue(),copperRun.plan);
 assert(await page.locator('#v261-plan-context').isVisible());
 assert.equal(await page.locator('#v261-plan-context dd').first().evaluate(el=>getComputedStyle(el).textAlign),'center');
 assert(await page.locator('#v261-plan-context').evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('.r10-draft-flow').getBoundingClientRect().bottom&&el.getBoundingClientRect().bottom<=document.querySelector('.v470-lot-section').getBoundingClientRect().top));
 await page.locator('#v261-planned').selectOption(copperRun.plannedLocation);
 await page.locator('[data-v261-pick="'+copperRun.remainingBundle+'"]').check();
 await page.locator('#v261-create-submit').click();
 await page.waitForURL(/\/preparation\/[0-9a-f-]{36}$/);
 await ready(page);
 await page.locator('.v470-lot-plan .lot-context-grid').waitFor();
 assert(await page.locator('.v470-lot-plan').evaluate(el=>el.previousElementSibling?.classList.contains('r10-workflows')));
 const sales=await open('sales_manager');
 await go(sales.page,'/sales-plans','CU_CATHODE');
 await sales.page.locator('.s468-toolbar a[href="/sales-plans/new"]').click();
 await sales.page.locator('#ux10-plan-form').waitFor();
 assert(!await sales.page.getByText('终审通过后方可派车', {exact:false}).isVisible());
 const overviewPage='/overview';
 await go(page,overviewPage,'CU_CATHODE');
 for(const chart of ['net','vehicles','receipts','stock']){
  const host=page.locator('[data-oa-plot="'+chart+'"]');
  await host.locator('svg').waitFor();
  assert.deepEqual(await host.locator('.oa-date-tick').allTextContents(),JSON.parse(await host.getAttribute('data-rows')).map(row=>row.period));
 }
 assert(await page.locator('.oa-execution :is(th,td)').evaluateAll(cells=>
  cells.length>0&&cells.every(cell=>getComputedStyle(cell).textAlign==='center')));
 await page.setViewportSize({width:390,height:860});
 assert(await page.locator('.oa-plot-scroll').first().evaluate(el=>el.scrollWidth>=el.clientWidth));
 await page.setViewportSize({width:1440,height:1000});
 assert.equal(await page.locator('#dashboard h1').evaluate(el=>getComputedStyle(el).textAlign),'left');
 const period=page.locator('#dashboard .overview-filter-box'),summary=period.locator('summary');
 await summary.click();assert.equal(await period.getAttribute('open'),null);
 await summary.click();assert(await period.locator('#dashboard-form').isVisible());
 const retired='#page-layout-open,#overview-designer-open,#operation-designer-open';
 assert.equal(await page.locator(retired).count(),0);
 const filter=page.locator('#dashboard-form');
 await filter.locator('[name=from]').fill(await filter.locator('[name=to]').inputValue());
 const refreshed=page.waitForResponse(r=>r.url().includes('/api/v1/v34/overview?')&&r.ok());
 await filter.locator('button[type=submit],button.primary').first().click();await refreshed;
 await go(page,'/inventory','CU_CATHODE');assert.equal(await page.locator('#v33-reverse,#inventory h1 .title-chip').count(),0);
 await go(page,'/receipts','CU_CATHODE');assert(await page.locator('#op-filter [name=created_date],#v34-list-filter [name=created_date]').first().isVisible());
 await go(page,'/preparation','CU_CATHODE');assert(await page.locator('#op-filter [name=customer_id],#v34-list-filter [name=customer_id]').first().isVisible());
 for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
  await go(page,'/loading-plans/query',product);
  await page.locator('#v34-list-filter [name=planned_load_date]').waitFor();
  assert(await page.locator('#v34-list-filter [name=search]').isVisible());
  assert(await page.locator('.r9-loading-totals').isVisible());
  assert.equal(await page.locator(retired).count(),0);
 }
 await go(page,'/overview','CO_HYDROXIDE');
 const cobaltFilter=page.locator('#co-overview-filter'),end=await cobaltFilter.locator('[name=to]').inputValue();
 await cobaltFilter.locator('[name=from]').fill(end);
 const cobaltRefresh=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname==='/api/v1/cobalt/overview'&&u.searchParams.get('from')===end&&r.ok();});
 await cobaltFilter.locator('button.primary').click();await cobaltRefresh;
 await go(page,'/sales-plans/new','CO_HYDROXIDE');
 assert.equal(await page.locator('#ux10-plan-form [name=warehouse_id],#ux10-plan-form [name=destination]').count(),0);
 await go(page,'/receipts/new?preparation_plan='+f.coUiWorkPlan,'CO_HYDROXIDE');
 await page.locator('#co-create [name=planned_location_id]').waitFor();
 await go(page,'/receipts/'+f.preparation,'CO_HYDROXIDE');
 await page.locator('.co469-location-panel').waitFor();
 assert.equal(await page.locator('.co469-location-panel .co469-placement-current').count(),2);
 assert(await page.locator('#co469-location').isVisible());
 const limited=await open('limited_account_manager');await limited.page.goto(origin+'/workbench/accounts');await ready(limited.page);await limited.page.locator('#account-filter').waitFor();assert.equal(await limited.page.locator('#account-registration-requests').count(),0);assert.equal(await limited.page.locator('#account-create').count(),1);const options=await limited.context.request.get(origin+'/api/v1/users/options');assert(options.ok());assert(!(await options.json()).roles.some(r=>r.code==='admin'));
 const roleManager=await open('limited_role_manager');await roleManager.page.goto(origin+'/workbench/permissions');await ready(roleManager.page);await roleManager.page.locator('[data-role]').first().waitFor();assert.equal(await roleManager.page.locator('[data-role=admin]').count(),0);const own=await roleManager.page.evaluate(()=>CurrentUser.role_code);assert.equal(await roleManager.page.locator('[data-role="'+own+'"]').count(),0);await roleManager.page.locator('[data-role]').first().click();await roleManager.page.locator('.s46-r2-matrix').waitFor();const prohibited=roleManager.page.locator('.s46-r2-matrix input[value="users:manage"]');assert(await prohibited.count()===0||await prohibited.isDisabled());await limited.page.screenshot({path:path.join(E.runtime,'limited-accounts.png'),fullPage:true});await roleManager.page.screenshot({path:path.join(E.runtime,'limited-roles.png'),fullPage:true});
 assert.deepEqual(errors,[]);E.save('ui-results.json',{status:'PASS',shapes,permissionCheckboxes:permissionMatrix.codes.length,permissionModules:permissionMatrix.modules.length,managementViews:['admin-registration-entry','limited-account-manager','limited-role-manager'],errors,workingDatabaseWrites:0});
 }finally{await browser?.close();await app.close();}
});

test('dispatch and list layouts: both products, responsive filters and one-vehicle month save',async()=>{
 const f=E.fixture(),port=4397,origin='http://127.0.0.1:'+port,app=await require('../../server/app.cjs').build({config:{...f.appCfg,port,origin}});let browser;
 try{
  await app.listen({host:'127.0.0.1',port});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const ctx=await browser.newContext({viewport:{width:1440,height:900}}),account=f.accounts.find(a=>a.role==='admin');
  const login=await ctx.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:account.username,password:account.password}});
  assert(login.ok());
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
  await page.addLocatorHandler(page.locator('#task-notice[open]'),()=>page.evaluate(()=>document.querySelector('#task-notice [data-task-dismiss]')?.click()));
  const ready=()=>page.waitForFunction(()=>window.AppSignedIn&&window.V469R2?.installed&&!Router.rendering&&document.getElementById('session-restore').hidden);
  const go=async(p,url,product)=>{
   await p.goto(origin+'/overview');await ready();
   await p.evaluate(code=>localStorage.setItem(ProductContext.key,code),product);
   await p.goto(origin+url);await ready();
  };
 const assertFilter=async(id,names,width)=>{
  const form=page.locator(id);await form.waitFor();
  const layout=await form.evaluate(el=>[...el.querySelectorAll(':is(input,select),.wms-filter-actions .button')]
   .map(node=>({name:node.name||'',bottom:Math.round(node.getBoundingClientRect().bottom),left:node.getBoundingClientRect().left})));
  assert.deepEqual(layout.slice(0,5).map(row=>row.name),names);
  if(width>=1280)assert(Math.max(...layout.map(x=>x.bottom))-Math.min(...layout.map(x=>x.bottom))<=2,JSON.stringify(layout));
  assert(layout.at(-1).left>layout.at(-2).left,'Keep query and reset in one group');
 };
 for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
  for(const width of [1440,1280,390]){
   await page.setViewportSize({width,height:900});
   await go(page,'/sales-plans',product);
   await assertFilter('#s468-filter',['plan_no','contract_no','customer_id','shipment_month','status'],width);
   await go(page,'/outbounds',product);
   await assertFilter('#op-filter',['search','customer_id','state','document_status','created_date'],width);
   const visibleRowCapacity=await page.locator('.op-table-scroll').evaluate(el=>{
    const header=el.querySelector('thead').getBoundingClientRect().height;
    const row=el.querySelector('tbody tr').getBoundingClientRect().height;
    return (parseFloat(getComputedStyle(el).maxHeight)-header)/row;
   });
   assert(visibleRowCapacity>4,`Visible row capacity ${visibleRowCapacity} at ${width}px`);
   const alignments=await page.locator('#op-table :is(th,td)').evaluateAll(cells=>cells.map(cell=>getComputedStyle(cell).textAlign));
   assert(alignments.length&&alignments.every(value=>value==='center'),alignments.join(','));
   if(width===1440||width===390)await page.screenshot({path:path.join(E.runtime,'v482-outbound-'+product+'-'+width+'.png'),fullPage:true});
  }
 }
 await page.setViewportSize({width:1440,height:1000});
 for(const product of ['CU_CATHODE','CO_HYDROXIDE']){
  const co=product==='CO_HYDROXIDE',fixture=f.dispatchMonthPlans[product];
  const operator=f.accounts.find(a=>a.role===(co?'sales_operator':'sales_manager'));
  const signedIn=await ctx.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:operator.username,password:operator.password}});
  assert(signedIn.ok());
  const sourcePage='/sales-plans/'+fixture.target+'/dispatch';
  const sourceApi=(co?'/cobalt/sales':'')+'/plans/'+fixture.target+'/dispatch';
  await go(page,sourcePage,product);
  const data=await page.evaluate(url=>API.request(url),sourceApi);
  const plate=co?'CO1235':'CU1235',vehicle=data.vehicles.find(row=>row.truck_no===plate&&row.can_transfer);
  const destination=data.dispatch_month.targets.find(plan=>plan.id===fixture.id);
  assert(vehicle&&destination,'A transferable fixture vehicle and its destination sales plan are required');
  const action=page.locator('[data-dispatch-vehicle-month="'+vehicle.id+'"]');
  await action.waitFor({state:'attached'});
  if(!co)await action.locator('xpath=ancestor::details[1]').evaluate(node=>node.open=true);
  await action.click();
  const form=page.locator('#dispatch-vehicle-month-form');await form.waitFor();
  await form.getByText(plate,{exact:true}).waitFor();
  await form.locator('select[name=shipment_month]').selectOption(destination.shipment_month);
  await form.locator('select[name=target_plan_id]').selectOption(destination.id);
  await form.locator('button[type=submit]').click();
  await form.waitFor({state:'hidden'});
  await page.locator('tr').filter({hasText:plate}).waitFor({state:'detached'});
  const after=await page.evaluate(url=>API.request(url),sourceApi);
  assert.deepEqual(after.vehicles.map(row=>row.id).sort(),data.vehicles.filter(row=>row.id!==vehicle.id).map(row=>row.id).sort());
  await go(page,'/sales-plans/'+destination.id+'/dispatch',product);
  const moved=page.locator('tr').filter({hasText:plate});
  await moved.waitFor({state:'attached'});
  if(!co)await moved.locator('xpath=ancestor::details[1]').evaluate(node=>node.open=true);
  await moved.getByText(destination.shipment_month,{exact:true}).waitFor();
 }

  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await app.close();}
});
