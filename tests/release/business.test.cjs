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
test('dispatch Excel identifies equivalents for truck plate, transporter and unloading place',async()=>{
 for(const [extension,bookType,truck,transporter,destination] of [
  ['xlsx','xlsx','Horse Reg. No.','Transport Company Name','Placeoffloaded'],
  ['xls','biff8','N° d’immatriculation du tracteur','Société de transport','Lieu de déchargement'],
  ['xlsx','xlsx','车头车牌号 / Truck Plate No.','承运商名称','卸货地点'],
  ['xlsx','xlsx','Ｔｒｕｃｋ　Ｒｅｇｉｓｔｒａｔｉｏｎ','Carrier Name','Place of Off-\nLoading']
 ]){
  const wb=X.utils.book_new();
  X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([
   ['Truck Driver ID','Trailer Registration',truck,'Transport Mode',transporter,'Place of Loading',destination,'Truck Payload (kg)'],
   ['DRV1234','TR5678','ACT3434','Road','Test Carrier','Loading Yard','Depot South',36250]
  ]),'Dispatch');
  const result=await D.parse({file_name:'dispatch.'+extension,file_base64:X.write(wb,{type:'base64',bookType})});
  assert.equal(result.mapping.truck_column,3);
  assert.equal(result.mapping.transporter_column,5);
  assert.equal(result.mapping.destination_column,7);
  assert.deepEqual(result.items,[{source_row:2,truck_no:'ACT3434',trailer_no:'',transporter:'Test Carrier',destination:'Depot South',capacity_tonnes:'36.2500'}]);
 }
});
test('merged and split dispatch headings retain load units and prefer explicit vehicle and destination columns',()=>{
 const wb=X.utils.book_new();
 const ws=X.utils.aoa_to_sheet([
  ['Registration No.','Truck','Transport','Place of','Final Destination','Capacity'],
  [null,'Number','Company','Offloading',null,'kg'],
  ['GEN1234','ACT3434','Test Carrier','Border post','Depot South',36250]
 ]);
 ws['!merges']=[{s:{r:0,c:0},e:{r:1,c:0}},{s:{r:0,c:4},e:{r:1,c:4}}];
 X.utils.book_append_sheet(wb,ws,'Dispatch');
 const result=R.read(wb,null,D.capacity);
 assert.equal(result.mapping.header_row,2);
 assert.equal(result.mapping.truck_column,2);
 assert.equal(result.mapping.transporter_column,3);
 assert.equal(result.mapping.destination_column,5);
 assert.equal(result.items[0].destination,'Depot South');
 assert.equal(result.items[0].capacity_tonnes,'36.2500');
 const {sheet,header_row,truck_column}=result.mapping;
 const manual=R.read(wb,{sheet,header_row,truck_column,destination_column:4},D.capacity);
 assert.equal(manual.items[0].destination,'Border post');
 assert.equal(manual.items[0].transporter,'Test Carrier');
});
test('ambiguous dispatch columns remain available for manual selection',()=>{
 const wb=X.utils.book_new();
 X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([
  ['Truck No.','Horse Reg.','Carrier','Transporter','Placeoffloaded','Delivery Address'],
  ['ACT3434','RPL1234','First Carrier','Second Carrier','Border post','Depot South']
 ]),'Dispatch');
 const result=R.read(wb,null,D.capacity);
 assert.equal(result.needs_mapping,true);
 assert.deepEqual(result.candidates.map(candidate=>candidate.truck_column),[1,2]);
 const selected={sheet:'Dispatch',header_row:1,truck_column:1};
 const unguessed=R.read(wb,selected,D.capacity);
 assert.equal(unguessed.mapping.transporter_column,null);
 assert.equal(unguessed.mapping.destination_column,null);
 const manual=R.read(wb,{...selected,transporter_column:4,destination_column:6},D.capacity);
 assert.equal(manual.items[0].transporter,'Second Carrier');
 assert.equal(manual.items[0].destination,'Depot South');
});
test('dispatch imports use the plan month and vehicle edits reject invalid, unauthorized and stale values',()=>{
 const plan={status:'OPEN',preparation_month:'2026-11'},req={user:{role_code:'sales_manager',permissions:['dispatch:month']},
  body:{previous_month:'2026-11',shipment_month:'2026-12',target_plan_id:'adec86f7-26d6-4c24-a1cd-c936b85e643d'}};
 assert.deepEqual(Month.settings(req,plan),{month:'2026-11',can_change:true});
 const transfer=Month.transferInput(req);
 assert.deepEqual(transfer,req.body);
 Month.validate(transfer,'2026-11');
 assert.throws(()=>Month.validate(transfer,'2026-12'),{statusCode:409});
 assert.equal(Month.settings({...req,user:{...req.user,role_code:'logistics_manager'}},plan).can_change,false);
 assert.throws(()=>Month.transferInput({...req,body:{...req.body,target_plan_id:undefined}}),{statusCode:400});
 assert.throws(()=>Month.transferInput({...req,body:{...req.body,shipment_month:'2026-13'}}),{statusCode:400});
 assert.throws(()=>Month.effective(plan,'2026-12'),{statusCode:409});
});
