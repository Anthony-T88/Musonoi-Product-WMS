'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ExcelJS=require('exceljs'),{Client}=require('pg');
const {build}=require('../server/app.cjs'),{root,config}=require('../server/config.cjs'),{ownerConfig}=require('../scripts/db.cjs');
const accounts=JSON.parse(fs.readFileSync((process.env.V22_ACCOUNTS_FILE||path.join(root,'.runtime/test-accounts.json')),'utf8'));
const I=require('../dist/core.js');
let checks=0;const ok=(value,message)=>{assert.ok(value,message);checks++;};
async function main(){let app=await build();const origin=config().origin;
 const call=(url,session,method='GET',body)=>app.inject({url:'/api/v1'+url,method,headers:{origin,...(session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{})},...(body!==undefined?{payload:body}:{})});
 async function login(account){const r=await call('/auth/login',null,'POST',account);assert.equal(r.statusCode,200,r.body);return {cookie:r.headers['set-cookie'].split(';')[0],csrf:r.json().csrfToken};}
 try{
 ok((await call('/inventory')).statusCode===401,'Unauthenticated access denied');
 ok((await app.inject({url:'/api/v1/me',headers:{cookie:'musonoi_session=forged'}})).statusCode===401,'Forged session denied');
 const admin=await login(accounts.find(a=>a.role==='admin')),viewer=await login(accounts.find(a=>a.role==='readonly')),sales=await login(accounts.find(a=>a.role==='sales'));
 const all=(await call('/inventory?sort=id&direction=asc&page_size=10',admin)).json();ok(all.total===128,'Database fixture has 128 rows');ok(all.summary.weight==='263.154000','Exact database sum');
 const me=(await call('/me',admin)).json();ok(!('password_hash' in me)&&!('csrf_hash' in me),'No password or token hash disclosure');
 const v=(await call('/inventory',viewer)).json();ok(v.total>0&&v.total<128,'Readonly customer scope enforced');
 const outside=I.data.find(r=>r.customer!==I.data[0].customer).id;
 ok((await call('/bundles/'+outside,viewer)).statusCode===404,'Out-of-scope detail denied');
 ok((await call('/inventory?search='+outside,viewer)).json().total===0,'Out-of-scope search denied');
 ok((await call('/users',viewer)).statusCode===403,'User management cannot be bypassed');
 ok((await call('/inventory/exports',viewer,'POST',{format:'csv'})).statusCode===403,'Readonly direct export denied');
 const noCsrf=await app.inject({method:'POST',url:'/api/v1/inventory/exports',headers:{cookie:admin.cookie,origin},payload:{format:'csv'}});ok(noCsrf.statusCode===403,'CSRF enforced');
 const badOrigin=await app.inject({method:'POST',url:'/api/v1/inventory/exports',headers:{cookie:admin.cookie,origin:'http://untrusted.invalid','x-csrf-token':admin.csrf},payload:{format:'csv'}});ok(badOrigin.statusCode===403,'Origin enforced');
 ok((await call('/inventory?sort=weight;DROP',admin)).statusCode===400,'Sort injection rejected');
 ok((await call('/inventory?sort=toString',admin)).statusCode===400,'Inherited property is not a sort column');
 ok((await call('/inventory/exports',admin,'POST',{format:'csv',selected_ids:'invalid'})).statusCode===400,'Malformed export selection rejected');
 ok((await call('/inventory?start=2026-10-28&end=2026-10-01',admin)).statusCode===400,'Invalid date range rejected');
 ok((await call('/inventory?start=2026-02-30',admin)).statusCode===400,'Impossible date rejected');
 const combos={location:'A-01-01',status:'在库',sample:'已取样',start:'2026-10-01',end:'2026-10-28'};
 const combo=(await call('/inventory?'+new URLSearchParams(combos),admin)).json();ok(combo.total===I.query(I.data,combos).length,'Combined filters match legacy fixture');
 const one=(await call('/inventory?search=MSN-CU-260001',admin)).json();ok(one.total===1&&one.items[0].id==='MSN-CU-260001','Search preserved');
 const weights=(await call('/inventory?sort=weight&direction=asc&page_size=50',admin)).json();ok(weights.items.every((r,i)=>!i||Number(weights.items[i-1].weight)<=Number(r.weight)),'Numeric weight ordering');
 const pages=[];for(let p=1;p<=3;p++)pages.push(...(await call('/inventory?sort=id&direction=asc&page_size=50&page='+p,admin)).json().items);ok(new Set(pages.map(r=>r.id)).size===128,'Pagination unique and complete');
 const selected=[pages[0].id,pages[55].id];const csv=await call('/inventory/exports',admin,'POST',{format:'csv',filters:{},sort:{sort:'id',direction:'asc'},selected_ids:selected});ok(csv.statusCode===200&&csv.headers['x-export-count']==='2','Cross-page selected export');ok(selected.every(id=>csv.body.includes(id))&&!csv.body.includes(pages[2].id),'Export only selected rows');
 const valid=(await call('/inventory/selection',admin,'POST',{filters:{search:selected[0]},selected_ids:selected})).json();ok(valid.ids.length===1&&valid.ids[0]===selected[0],'Selection pruned by filters');
 const scopeAttack=await call('/inventory/exports',sales,'POST',{format:'csv',selected_ids:[outside]});ok(scopeAttack.statusCode===409,'Selected-ID authorization cannot be bypassed');
 const exportAll=await call('/inventory/exports',admin,'POST',{format:'csv',sort:{sort:'id',direction:'asc'}});ok(exportAll.headers['x-export-count']==='128','Export all matching pages');ok(exportAll.body.split('\r\n').length===129,'CSV count matches list');
 assert.deepEqual(exportAll.body.split('\r\n').slice(1).map(line=>line.split(',')[1].replaceAll('"','')),pages.map(r=>r.id));checks++;
 const x=await call('/inventory/exports',admin,'POST',{format:'xlsx',filters:combos,sort:{sort:'id',direction:'asc'}});assert.equal(x.statusCode,200,x.body);const book=new ExcelJS.Workbook();await book.xlsx.load(x.rawPayload);const sheet=book.worksheets[0];ok(sheet.rowCount===combo.total+1,'XLSX matches filtered count');ok(sheet.getCell('F2').type===ExcelJS.ValueType.Number&&sheet.getCell('F2').numFmt==='0.000000','Numeric full-precision Excel weights');
 const expected=I.query(I.data,combos,'id','asc');assert.deepEqual(expected.map(r=>r.id),sheet.getColumn(2).values.slice(2));assert.deepEqual(expected.map(r=>r.weight),sheet.getColumn(6).values.slice(2));checks++;
 const options=(await call('/users/options',admin)).json();ok(['admin','operator','supervisor','sales','readonly'].every(code=>options.roles.some(r=>r.code===code)),'Original five roles retained with additive workflow roles');
 const username='test_created_'+Date.now();const created=await call('/users',admin,'POST',{username,display_name:'集成测试用户',password:'Integration-Only-Password-7!',role_code:'operator',scopes:[]});ok(created.statusCode===201,'Admin creates user');
 const uid=created.json().id,newSession=await login({username,password:'Integration-Only-Password-7!'});ok((await call('/inventory',newSession)).json().total===0,'No implicit scope grants');
 ok((await call('/users/'+uid,admin,'PATCH',{active:false})).statusCode===200,'Admin disables user');ok((await call('/me',newSession)).statusCode===401,'Disabled user session revoked');
 ok((await call('/users/'+me.id,admin,'PATCH',{active:false})).statusCode===409,'Self-disable rejected');
 ok((await call('/audit',admin)).json().items.some(r=>r.action==='inventory_export'),'Persistent audit recorded');
 ok((await app.inject({url:'/api/v1/bundles',method:'POST',headers:{origin,cookie:admin.cookie},payload:{}})).statusCode===404,'No stock mutation endpoint');
 const owner=new Client(ownerConfig(new URL(config().databaseUrl).pathname.slice(1)));await owner.connect();try{await owner.query('BEGIN');await owner.query('SAVEPOINT unique_test');let rejected=false;try{await owner.query('INSERT INTO bundles SELECT * FROM bundles LIMIT 1');}catch(e){rejected=e.code==='23505';}await owner.query('ROLLBACK TO SAVEPOINT unique_test');ok(rejected,'Database unique constraints');await owner.query("UPDATE system_info SET environment='production'");await owner.query('SAVEPOINT boundary');rejected=false;try{await owner.query('UPDATE bundles SET data_kind=\'DEMO\' WHERE bundle_no=$1',[I.data[0].id]);}catch(e){rejected=e.message.includes('forbidden');}await owner.query('ROLLBACK TO SAVEPOINT boundary');ok(rejected,'Production rejects DEMO data');await owner.query('ROLLBACK');}finally{await owner.end();}
 const appClient=new Client({connectionString:config().databaseUrl});await appClient.connect();try{const permissions=(await appClient.query("SELECT current_user,has_table_privilege(current_user,'bundles','UPDATE') AS can_write,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser")).rows[0];ok(!permissions.can_write&&!permissions.superuser,'App DB role cannot mutate inventory or administer DB');}finally{await appClient.end();}
 await app.close();app=await build();ok((await call('/inventory',admin)).json().total===128,'Rows and authenticated session survive application restart');
 // Real database connection failure, not a mocked HTTP response.
 const cfg={...config(),databaseUrl:'postgresql://invalid:invalid@127.0.0.1:55433/no_db'};const broken=await build({config:cfg});try{const r=await broken.inject({url:'/api/v1/inventory',headers:{cookie:admin.cookie}});ok(r.statusCode===503&&!r.body.includes('MSN-CU-'),'Database failure is explicit with no fixture fallback');}finally{await broken.close();}
 ok((await call('/auth/logout',admin,'POST',{})).statusCode===200,'Logout works');ok((await call('/me',admin)).statusCode===401,'Logged-out cookie cannot be reused');
 ok((await app.inject({url:'/.env'})).statusCode===404,'Environment secrets are not static assets');
 const core=await app.inject({url:'/core.js'});ok(core.statusCode===200&&!core.body.includes('Array.from({length:128}'),'Database page core has no inline fixture generator');
 ok((await app.inject({url:'/demo'})).statusCode===200,'Independent demo entry preserved');
 console.log(JSON.stringify({status:'PASS',checks,database:'PostgreSQL 16 local isolated test',fixtureRows:128,applicationRestart:true,databaseFailureTest:true},null,2));
 }finally{await app.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
