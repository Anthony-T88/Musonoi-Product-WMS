'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),X=require('xlsx'),D=require('../../server/sales-dispatch.cjs'),R=require('../../server/dispatch-reader.cjs'),P=require('../../server/account-policy.cjs');
test('package and vehicle counts display and export whole source values without rounding fractions',()=>{
 const C=require('../../dist/count-values.js');
 for(const [value,label,excel] of [['128.00','128',128],['0.00','0',0],[null,'—',null],['3.25','3.25','3.25']]){
  assert.equal(C.display(value),label);assert.equal(C.spreadsheet(value),excel);
 }
 assert(C.isCount('unconfirmed_bags'));assert(C.isCount('loaded_vehicles'));assert(!C.isCount('target_weight'));
});
test('dispatch weight units, decimal comma and exact four-place tonne precision',()=>{for(const [raw,kg,want]of [['36',false,'36.0000'],['36,25 MT',false,'36.2500'],['36 250 kg',false,'36.2500'],['36,250 kg',false,'36.2500'],[36250,true,'36.2500'],['0.1 kg',false,'0.0001'],['',false,null]])assert.equal(D.capacity(raw,kg),want);for(const raw of ['0','-1','1001','1.00001','=SUM(A1)','1,2.34 MT'])assert.throws(()=>D.capacity(raw));});
test('loading order recognises multilingual weight headings and excludes trailer numbers',()=>{for(const title of ['NOVEMBER LOADING ORDER','TRUCK LOADING ORDER'])for(const weight of ['TON','Weight to load','载重']){const wb=X.utils.book_new(),ws=X.utils.aoa_to_sheet([[title],['HORSE','TRAILER',weight],['ACT3434','TRL5656',36]]);ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:2}}];X.utils.book_append_sheet(wb,ws,'Dispatch');const r=R.read(wb,null,D.capacity);assert.equal(r.items[0].truck_no,'ACT3434');assert.equal(r.items[0].capacity_tonnes,'36.0000');assert.equal(r.mapping.capacity_column,3);}});
test('formula weight cells are rejected rather than treated as dispatch capacity',()=>{const wb=X.utils.book_new(),ws=X.utils.aoa_to_sheet([['HORSE','TON'],['ACT3434',36]]);ws.B2={t:'n',v:36,f:'18+18'};X.utils.book_append_sheet(wb,ws,'Dispatch');assert.throws(()=>R.read(wb,null,D.capacity));});
test('independent review rejects both document creator and submitter regardless of role',async()=>{const c={query:async()=>({rows:[{created_by:'creator',submitted_by:'submitter'}]})},id='00000000-0000-4000-8000-000000000001';for(const actor of ['creator','submitter'])await assert.rejects(()=>P.independent(c,{user:{id:actor,role_code:'admin'}},'receipts',id),e=>e.statusCode===403||e.status===403);await P.independent(c,{user:{id:'another'}},'receipts',id);});
