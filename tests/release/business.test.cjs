'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),X=require('xlsx'),D=require('../../server/sales-dispatch.cjs'),R=require('../../server/dispatch-reader.cjs'),Month=require('../../server/dispatch-month.cjs');
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
test('dispatch month defaults to the plan, respects scope of role and rejects stale input',async()=>{
 const plan={id:'one',status:'OPEN',preparation_month:'2026-11'},req={productCode:'CU_CATHODE',user:{role_code:'sales_manager',permissions:['dispatch:month']}};
 const c={query:async()=>({rows:[]})};assert.deepEqual(await Month.settings(c,req,plan),{scheduled:'2026-11',month:'2026-11',version:0,can_change:true});
 assert.equal((await Month.settings(c,{...req,user:{...req.user,role_code:'logistics_manager'}},plan)).can_change,false);
 await assert.rejects(()=>Month.effective(c,req,plan,'2026-12'),{statusCode:409});
});
