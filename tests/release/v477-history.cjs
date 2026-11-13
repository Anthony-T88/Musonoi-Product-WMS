'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {Client}=require('pg');
const XLSX=require('xlsx');
const E=require('./environment.cjs');
const f=require('../../.runtime/v477-test-config.json');
const origin=f.appCfg.origin;
const CU='CU_CATHODE',CO='CO_HYDROXIDE';
const endpoint='/historical-movements';

async function login(role){
 const user=f.accounts.find(account=>account.role===role);
 const response=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({username:user.username,password:user.password})});
 assert.equal(response.status,200);
 return {cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; '),'x-csrf-token':(await response.json()).csrfToken};
}
async function request(user,product,path,input,status=200,key=randomUUID()){
 const response=await fetch(origin+'/api/v1'+(product===CO?'/cobalt':'')+endpoint+path,{
  headers:{...user,origin,'x-product-code':product,'content-type':'application/json','idempotency-key':key},
  method:input?'POST':'GET',body:input?JSON.stringify(input):undefined
 });
 assert.equal(response.status,status);
 return path.endsWith('/source')&&status===200?Buffer.from(await response.arrayBuffer()):response.json();
}
function fixture(kind,base,unit,serial,{duplicate=false,invalid=false}={}){
 const co=kind===CO,rows=Array.from({length:29},()=>[]);
 rows[0]=['PACKING LIST'];rows[2][3]='Packing List No:';rows[2][4]='SYN-'+serial;
 rows[3][3]='Lot No:';rows[3][4]='SYN-LOT-'+serial;rows[6][3]='Shipping Date:';rows[6][4]=new Date('2020-01-02T00:00:00Z');
 rows[21][0]='Synthetic buyer';rows[21][4]='Synthetic truck';
 rows[28]=['No','Description',co?'Bag No':'Bundle No',co?null:'Sheets Qty','Seal No','Net Weight (KG)','Gross Weight (KG)'];
 rows.push([1,co?'Cobalt Hydroxide':'Copper Cathode',unit,co?null:48,'SEAL-01',invalid?null:647,650]);
 if(duplicate)rows.push([2,'Synthetic',unit,co?null:48,'SEAL-02',647,650]);
 rows.push(['Total',null,null,null,null,duplicate?1294:647,duplicate?1300:650]);
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'PL');
 return {...base,file_name:'synthetic.xlsx',file_base64:XLSX.write(book,{bookType:'xlsx',type:'buffer'}).toString('base64')};
}
async function main(){
 assert.equal(origin,'http://127.0.0.1:4189');assert.equal(f.appCfg.environment,'test');
 assert.match(f.database,/^musonoi_audit_[0-9a-f]{10}_test$/);
 assert.equal(new URL(f.appCfg.databaseUrl).pathname,'/'+f.database);
 const admin=await login('admin'),viewer=await login('limited_viewer'),db=new Client(E.options(f.database));await db.connect();
 const serial=randomUUID(),results=[];
 try{
  const counters=async()=> (await db.query(`SELECT (SELECT count(*)::int FROM bundles) copper,(SELECT count(*)::int FROM co_inventory) cobalt,
    (SELECT count(*)::int FROM export_license_allocations) licenses,(SELECT count(*)::int FROM inventory_revisions) revisions`)).rows[0];
  const before=await counters();
  for(const [product,path,quantity] of [[CU,process.env.WMS_PL_CU,19],[CO,process.env.WMS_PL_CO,52]]){
   assert(path,'Supply the original packing-list path');
   const original=fs.readFileSync(path),source={file_name:path.split(/[\\/]/).at(-1),file_base64:original.toString('base64'),movement_type:'OUTBOUND'};
   const real=await request(admin,product,'/preview',source);
   assert.equal(real.totals.quantity,quantity);assert(real.shipping_date&&real.customer&&real.truck&&real.batch_no);
   assert.deepEqual(real.issues,['DATE_MISSING','EVIDENCE_MISSING']);assert(real.rows.every(row=>!row.flags.length));
   const base={movement_type:'OUTBOUND',business_date:'2020-01-02',date_evidence:'Synthetic signed dispatch evidence only'};
   const body=fixture(product,base,'SYN-UNIT-'+serial,serial);
   const review=await request(admin,product,'/preview',body);assert(review.importable);
   await request(viewer,product,'',undefined,403);
   await request(viewer,product,'/preview',body,403);
   await request(viewer,product,'',body,403);
   await request(admin,product,'',{...body,preview_token:'stale'},409);
   const confirm={...body,preview_token:review.preview_token};
   const failTrigger='v477_history_fixture_'+(product===CO?'co':'cu');
   await db.query(`CREATE FUNCTION ${failTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic insert interruption'; END $$`);
   try{
    await db.query(`CREATE TRIGGER ${failTrigger} BEFORE INSERT ON historical_movement_lines FOR EACH ROW EXECUTE FUNCTION ${failTrigger}()`);
    await request(admin,product,'',confirm,500);
    const rolledBack=await request(admin,product,'/preview',body);assert(rolledBack.importable);
   }finally{
    await db.query(`DROP TRIGGER IF EXISTS ${failTrigger} ON historical_movement_lines`);
    await db.query(`DROP FUNCTION ${failTrigger}()`);
   }
   const retryKey=randomUUID(),concurrent=await Promise.all([request(admin,product,'',confirm,200,retryKey),request(admin,product,'',confirm)]);
   assert.equal(concurrent[0].id,concurrent[1].id);assert.equal(concurrent.filter(item=>!item.replayed).length,1);
   const id=concurrent[0].id;
   const statusPath='/operations/status?'+new URLSearchParams({method:'POST',path:(product===CO?'/cobalt':'')+endpoint,key:retryKey});
   assert.deepEqual(await request(admin,product,statusPath),{committed:true,entity_id:id});
   await request(viewer,product,statusPath,undefined,403);
   const same=await request(admin,product,'/preview',body);assert(same.issues.includes('ALREADY_IMPORTED'));
   const collision=await request(admin,product,'/preview',fixture(product,base,'SYN-CHANGED-'+serial,serial));assert(collision.issues.includes('DOCUMENT_CONFLICT'));
   const duplicate=await request(admin,product,'/preview',fixture(product,base,'SYN-UNIT-'+serial,serial+'-duplicate',{duplicate:true}));
   assert(duplicate.rows.some(row=>row.flags.includes('DUPLICATE_UNIT')));
   const invalid=await request(admin,product,'/preview',fixture(product,base,'SYN-INVALID-'+serial,serial+'-invalid',{invalid:true}));
   assert(invalid.rows[0].flags.includes('INVALID_WEIGHT'));
   const saved=await request(admin,product,'/'+id);assert.equal(saved.rows.length,1);assert.equal(saved.rows[0].source_row,30);
   assert((await request(admin,product,'/'+id+'/source')).equals(Buffer.from(body.file_base64,'base64')));
   await request(viewer,product,'/'+id,undefined,403);await request(viewer,product,'/'+id+'/source',undefined,403);
   await request(viewer,product,'/'+id+'/void',{reason:'Unauthorized'},403);
   await request(admin,product===CO?CU:CO,'/'+id,undefined,404);
   const inbound={...body,movement_type:'INBOUND',business_date:'2020-01-01',date_evidence:'Synthetic receipt ledger evidence only'};
   const inboundPreview=await request(admin,product,'/preview',inbound);assert(inboundPreview.importable);
   const imported=await request(admin,product,'',{...inbound,preview_token:inboundPreview.preview_token});
   assert.notEqual(imported.id,id);
   const ledger=await request(admin,product,'?movement_type=INBOUND&from=2020-01-01&to=2020-01-01');assert(ledger.items.some(row=>row.id===imported.id));
   await request(admin,product,'/'+id+'/void',{reason:'Synthetic verification correction'});
   assert((await request(admin,product,'/'+id)).voided_at);
   assert.equal((await request(admin,product,'',confirm,200,retryKey)).id,id);
   const retry=await request(admin,product,'/preview',body);assert(retry.importable);
   const corrected=await request(admin,product,'',{...body,preview_token:retry.preview_token});assert.notEqual(corrected.id,id);
   results.push({product,originalRows:quantity,template:real.template,sourceDate:'SHIPPING_DATE',originalImportBlockedByMissingActualDate:true,
    syntheticInbound:true,syntheticOutbound:true,failedWriteRolledBack:true,duplicatesAndConflicts:true,sourceRoundTrip:true,concurrent:true,permissions:true,correction:true});
  }
  assert.deepEqual(await counters(),before);
  fs.writeFileSync('docs/v4.7.7/evidence/historical-import.json',JSON.stringify({results,liveLedgerUnchanged:true},null,2)+'\n');
  console.log('PASS original copper and cobalt previews and independent historical ledger acceptance');
 }finally{await db.end();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
