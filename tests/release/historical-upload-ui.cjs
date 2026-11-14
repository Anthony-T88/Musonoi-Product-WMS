'use strict';
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const test=require('node:test');
const {chromium}=require('playwright');
const XLSX=require('xlsx');
const E=require('./environment.cjs');

function workbook(index,tag){
 const cobalt=index%2===1,number='UPLOAD-TEST-'+tag+'-'+index;
 const rows=Array.from({length:29},()=>[]);
 rows[0]=['PACKING LIST'];
 rows[2]=['','','','Packing List No:',number];
 rows[3]=['','','','Lot No:',number+'-LOT'];
 rows[6]=['','','','Shipping Date:','2020-03-05'];
 rows[28]=['No','Description',cobalt?'Bag No':'Bundle No',cobalt?null:'Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
 rows.push([1,'Synthetic',number+'-UNIT',cobalt?null:48,number+'-SEAL',647,650],['Total',null,null,null,null,647,650]);
 const book=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'PL');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(Array.from({length:29},()=>['X'.repeat(16500)])),'Padding');
 const buffer=XLSX.write(book,{bookType:'xlsx',type:'buffer',compression:false});
 assert(buffer.length<=512*1024);
 return {name:number+'.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer};
}

test('historical import previews and confirms a batch above 3 MiB and explains file or proxy failures',async()=>{
 const fixture=E.fixture(),origin=fixture.appCfg.origin;
 const app=await require('../../server/app.cjs').build({config:fixture.appCfg});
 let browser;
 try{
  await app.listen({host:'127.0.0.1',port:fixture.appCfg.port});
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||undefined});
  const context=await browser.newContext();
  const admin=fixture.accounts.find(a=>a.role==='admin');
  const login=await context.request.post(origin+'/api/v1/auth/login',{headers:{origin},data:{username:admin.username,password:admin.password}});
  assert.equal(login.status(),200);
  const page=await context.newPage();
  const previewUrl='**/api/v1/historical-movements/batch/preview';
  const confirmUrl='**/api/v1/historical-movements/batch/confirm';
  const proxyError=route=>route.fulfill({status:413,contentType:'text/html',body:'<h1>413 Request Entity Too Large</h1>'});
  await page.goto(origin+'/workbench/historical-movements');
  const form=page.locator('#historical-upload');
  await form.locator('select').selectOption(fixture.warehouse);
  const fileInput=form.locator('input[type=file]');
  const previewButton=form.locator('button');
  const notice=page.locator('#historical-upload-error');
  const tag=randomUUID().slice(0,8),files=Array.from({length:5},(_,i)=>workbook(i,tag));
  const extra=[{...files[0],name:'Unreadable.xlsx'},{...files[0],name:'Oversized.xlsx',buffer:Buffer.alloc(512*1024+1)}];
  await page.evaluate(()=>{
   const original=File.prototype.arrayBuffer;
   File.prototype.arrayBuffer=function(){
    return this.name==='Unreadable.xlsx'?Promise.reject(new DOMException('Online-only fixture','NotReadableError')):original.call(this);
   };
  });
  await fileInput.setInputFiles([...files,...extra]);
  await page.route(previewUrl,proxyError,{times:1});
  await previewButton.click();
  await notice.getByText('本次上传总大小超过服务器限制。请减少每次选择的文件数后重试。',{exact:true}).waitFor();
  const previewResponse=page.waitForResponse(r=>r.url().endsWith('/batch/preview')&&r.request().method()==='POST');
  await previewButton.click();
  const reviewed=await previewResponse;
  assert(reviewed.request().postDataBuffer().length>3*1024*1024);
  assert.equal(reviewed.status(),200);
  const {results}=await reviewed.json();
  assert.deepEqual(results.map(r=>r.product_code),['CU_CATHODE','CO_HYDROXIDE','CU_CATHODE','CO_HYDROXIDE','CU_CATHODE']);
  assert(results.every(r=>r.importable),JSON.stringify(results.map(r=>[r.code,r.issues])));
  await page.locator('details[data-history-file="5"] summary').click();
  await page.getByText(/若文件仅存于网盘/).waitFor();
  await page.locator('details[data-history-file="6"] summary').click();
  await page.getByText('单份文件不能超过 512 KB',{exact:true}).waitFor();
  const confirm=async()=>{
   await page.locator('#historical-confirm').click();
   await page.locator('dialog[open] button.primary').click();
  };
  await page.route(confirmUrl,proxyError,{times:1});
  await confirm();
  await notice.getByText(/本次上传总大小超过服务器限制/).waitFor();
  const confirmation=page.waitForResponse(r=>r.url().endsWith('/batch/confirm')&&r.request().method()==='POST');
  await confirm();
  const imported=await confirmation;
  assert(imported.request().postDataBuffer().length>3*1024*1024);
  assert.equal(imported.status(),200);
  const result=await imported.json();
  assert(result.results.every(r=>r.status==='IMPORTED'));
  assert.equal(new Set(result.results.map(r=>r.import_batch_id)).size,1);
  await page.locator('#historical-ledger').getByText('UPLOAD-TEST-'+tag+'-0',{exact:true}).waitFor();
  await page.evaluate(()=>I18n.set('en'));
  await form.getByText('Packing Lists (XLS or XLSX)',{exact:true}).waitFor();
  await fileInput.setInputFiles(files.slice(0,1));
  await page.route(previewUrl,proxyError,{times:1});
  await previewButton.click();
  await notice.getByText(/This upload exceeds the server limit/).waitFor();
 }finally{await browser?.close();await app.close();}
});
