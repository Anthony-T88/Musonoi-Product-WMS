'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright'),E=require('./environment.cjs');
const {migrate}=require('../../scripts/production-db.cjs');

test('report email tabs use persisted WMS settings and preserve existing recipients',async()=>{
 const work=await fs.mkdtemp(path.join(os.tmpdir(),'wms-mail-browser-'));
 const policyFile=path.join(work,'reports.json'),keyFile=path.join(work,'mail.key');
 const before={WMS_REPORT_MAIL_CONFIG_FILE:process.env.WMS_REPORT_MAIL_CONFIG_FILE,WMS_REPORT_MAIL_KEY_FILE:process.env.WMS_REPORT_MAIL_KEY_FILE};
 const {client:c,name}=await E.database();let app,browser;
 try{
  await migrate(c,{apply:true,environment:'test',appPassword:process.env.WMS_TEST_APP_PASSWORD});
  const fixture=await E.seed(c,name);
  const admin=fixture.accounts.find(a=>a.role==='admin'),operator=fixture.accounts.find(a=>a.role==='production_operator');
  const missing=fixture.accounts.find(a=>a.role==='logistics_field_operator');
  const registered='registered@musonoi.test',oldAddress='legacy@musonoi.test';
  const original={id:'legacy-dispatch',hour:7,frequency:'daily',actor:admin.username,recipients:[oldAddress],
   reports:[{kind:'shipping',product:'CU_CATHODE'}]};
  const relay='smtps://127.0.0.1:2465',sender='wms@musonoi.test';
  await fs.writeFile(policyFile,JSON.stringify({smtp:{url:relay,from:sender},recipientAllowlist:[oldAddress],
   recipientDomains:['musonoi.test'],schedules:[original]}),{mode:0o600});
  await fs.writeFile(keyFile,crypto.randomBytes(32).toString('hex'),{mode:0o600});
  await c.query('UPDATE users SET contact_email=$1 WHERE id=$2',[registered,operator.id]);
  process.env.WMS_REPORT_MAIL_CONFIG_FILE=policyFile;process.env.WMS_REPORT_MAIL_KEY_FILE=keyFile;
  const port=4495,origin='http://127.0.0.1:'+port,route='/workbench/report-mail',api='/api/v1/system/report-mail';
  app=await require('../../server/app.cjs').build({config:{...fixture.appCfg,port,origin}});
  await app.listen({host:'127.0.0.1',port});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  const errors=[];
  const open=async(account,width,locale,product)=>{
   const session=await app.inject({method:'POST',url:'/api/v1/auth/login',headers:{origin},
    remoteAddress:'127.70.5.'+(fixture.accounts.indexOf(account)+1),
    payload:{username:account.username,password:account.password}});
   assert.equal(session.statusCode,200);
   const context=await browser.newContext({viewport:{width,height:900},locale,colorScheme:width<500?'dark':'light'});
   await context.addCookies(session.cookies.map(cookie=>({name:cookie.name,value:cookie.value,url:origin})));
   const page=await context.newPage();
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(({locale,product,accountId})=>{
    localStorage.setItem('musonoi-language',locale==='en-US'?'en':'zh-CN');
    localStorage.setItem('musonoi-product:'+accountId,product);
   },{locale,product,accountId:account.id});
   const response=await page.goto(origin+route);
   await page.waitForFunction(()=>!document.body.classList.contains('boot-pending')&&!document.querySelector('.workspace')?.inert);
   return {page,context,response};
  };
  const read=async context=>{
   const response=await context.request.get(origin+api);
   assert.equal(response.status(),200);
   return response.json();
  };
  const save=async(page,action,part='')=>{
   const result=page.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname===api+part);
   await action();
   assert.equal((await result).status(),200);
  };
  const fits=page=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1);
  const desktop=await open(admin,1440,'zh-CN','CU_CATHODE'),page=desktop.page;
  assert.equal(desktop.response.status(),200);
  const plans=page.locator('#report-mail-plans'),editor=page.locator('#report-mail-form');
  await plans.getByText(oldAddress,{exact:true}).waitFor();
  assert(await fits(page));
  const loaded=await read(desktop.context);
  assert.equal(loaded.version,0);
  assert.deepEqual(loaded.schedules,[original]);
  assert.deepEqual(loaded.nextDelivery.scheduleIds,[original.id]);

  await page.locator('[data-report-mail-edit="legacy-dispatch"]').click();
  await editor.locator('[name=enabled]').uncheck();
  await save(page,()=>editor.getByRole('button',{name:'保存计划'}).click());
  await editor.waitFor({state:'hidden'});
  const paused=await read(desktop.context);
  assert.deepEqual(paused.schedules,[{...original,enabled:false}]);
  assert.equal(paused.nextDelivery,null);
  assert.match(await plans.innerText(),/已暂停/);

  await page.locator('#report-mail-add').click();
  await editor.getByText(registered,{exact:true}).waitFor();
  const unavailable=editor.locator('[name=recipientAccount][value="'+missing.id+'"]');
  assert.equal(await unavailable.isDisabled(),true);
  await editor.locator('[name=actor]').selectOption(admin.username);
  await editor.locator('[name=frequency]').selectOption('monthly');
  await editor.locator('[name=hour]').fill('09:00');
  await editor.locator('[name=report][value="sales:CO_HYDROXIDE"]').check();
  await editor.getByText(registered,{exact:true}).click();
  await save(page,()=>editor.getByRole('button',{name:'保存计划'}).click());
  await editor.waitFor({state:'hidden'});
  const active=await read(desktop.context),selected=active.schedules[1];
  assert.deepEqual(selected.recipientAccounts,[operator.id]);
  assert.equal(selected.enabled,true);
  assert.equal(selected.hour,9);
  assert.deepEqual(active.nextDelivery.scheduleIds,[selected.id]);
  assert.match(await page.locator('#report-mail-next').innerText(),/09:00/);
  await page.locator('#report-mail-tab-plans').focus();
  await page.keyboard.press('ArrowRight');
  const smtp=page.locator('#report-mail-transport-form');
  await smtp.waitFor();
  assert.equal(await smtp.locator('[name=url]').inputValue(),relay);
  assert.equal(await smtp.locator('[name=from]').inputValue(),sender);
  const credential=crypto.randomBytes(28).toString('hex');
  await smtp.locator('[name=username]').fill('synthetic-operator');
  await smtp.locator('[name=password]').fill(credential);
  await save(page,()=>smtp.getByRole('button',{name:'保存邮箱'}).click(),'/transport');
  await page.waitForFunction(()=>document.querySelector('#report-mail-transport-form [name=password]')?.value==='');
  const refreshed=await read(desktop.context);
  assert.equal(refreshed.transport.hasPassword,true);
  assert(!JSON.stringify(refreshed).includes(credential));
  const {rows:[{sealed_password}]}=await c.query('SELECT sealed_password FROM report_mail_transport WHERE singleton');
  assert(sealed_password&&!sealed_password.includes(credential));
  await desktop.context.close();

  await c.query("UPDATE users SET language_code='en' WHERE id=$1",[admin.id]);
  const mobile=await open(admin,390,'en-US','CO_HYDROXIDE');
  const narrow=mobile.page;
  await narrow.getByRole('tab',{name:'Delivery Schedules'}).waitFor();
  assert.equal(await narrow.evaluate(()=>ProductContext.code),'CO_HYDROXIDE');
  assert(await fits(narrow));
  await narrow.locator('[data-report-mail-edit="'+selected.id+'"]').click();
  const narrowEditor=narrow.locator('#report-mail-form');
  await narrowEditor.waitFor({timeout:6500});
  const existingRecipient=narrowEditor.locator('[name=recipientAccount][value="'+operator.id+'"]');
  assert(await existingRecipient.isChecked());
  assert.match(await existingRecipient.locator('..').innerText(),/registered@musonoi\.test/);
  assert.equal(await existingRecipient.locator('..').evaluate(row=>getComputedStyle(row).flexDirection),'row');
  assert(await fits(narrow));
  await narrow.getByRole('tab',{name:'Server Mailbox'}).click();
  await narrow.locator('#report-mail-transport-form').waitFor();
  assert(await fits(narrow));
  await mobile.context.close();

  const denied=await open(operator,390,'zh-CN','CU_CATHODE');
  assert.equal(denied.response.status(),403);
  assert.equal((await denied.context.request.get(origin+api)).status(),403);
  assert.equal(await denied.page.locator('#report-mail-tab-plans').count(),0);
  assert.deepEqual(errors,[]);
 }finally{
  if(browser)await browser.close();
  if(app)await app.close();
  await c.end();
  for(const [key,value] of Object.entries(before)){
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  await fs.rm(work,{recursive:true,force:true});
 }
});
