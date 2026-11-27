'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg'),E=require('./environment.cjs');
test('native copper receipt, preparation, sampling, weighing and formal outbound',async()=>{
 const f=E.fixture(),c=new Client(E.options(f.database));await c.connect();let app;const steps=[];
 try{
 for(const [role,permissions]of [['production_operator',['receipt:write','receipt:read']],['sales_manager',['plan:write']],['logistics_field_operator',['load:write','load:execute','allocation:write','allocation:read']]])for(const p of permissions)await c.query('INSERT INTO role_permissions VALUES($1,$2) ON CONFLICT DO NOTHING',[role,p]);
 app=await require('../../server/app.cjs').build({config:f.appCfg});const sessions={};let ip=1;
 const signIn=async account=>{
  const response=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.95.0.'+(ip++),
   headers:{origin:f.appCfg.origin},payload:{username:account.username,password:account.password}});
  assert.equal(response.statusCode,200,'Sign in as '+account.role);
  sessions[account.role]={origin:f.appCfg.origin,cookie:response.cookies.map(cookie=>cookie.name+'='+cookie.value).join('; '),
   'x-csrf-token':response.json().csrfToken};
 };
 for(const account of f.accounts)await signIn(account);
 const request=(url,role='admin',body,key=crypto.randomUUID())=>app.inject({method:body?'POST':'GET',url:'/api/v1'+url,headers:{...sessions[role],'x-product-code':'CU_CATHODE','idempotency-key':key},...(body?{payload:body}:{})});
 const api=async(url,role='admin',body,expected=200)=>{const r=await request(url,role,body);assert.equal(r.statusCode,expected,url+' '+r.body.slice(0,250));return r.json();};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),seq=String(Date.now()),customer=f.customers.CU_CATHODE;
 const contract=await api('/contracts','admin',{project_id:f.project,customer_id:customer.id,contract_no:'RC3-CU-'+seq,effective_date:today,end_date:'2099-12-31',active:true});
 assert.equal((await api('/contracts/'+contract.id)).validity,'VALID');
 const managerPlan=await api('/plans','sales_manager',{project_id:f.project,customer_id:customer.id,contract_id:contract.id,target_weight:'20',quantity_tolerance:'5',preparation_month:today.slice(0,7),remark:'Synthetic manager submission'});
 const managerApproval=await api('/sales-workflow/plans/'+managerPlan.id);
 const ownSalesReview=await api('/sales-workflow/plans/'+managerPlan.id+'/review','sales_manager',{version:managerApproval.approval_version,decision:'APPROVED'});assert.equal(ownSalesReview.approval_state,'COMMERCE_PENDING');
 await api('/sales-workflow/plans/'+managerPlan.id+'/review','sales_manager',{version:ownSalesReview.approval_version,decision:'APPROVED'},403);
 const plan=await api('/plans','sales_operator',{project_id:f.project,customer_id:customer.id,contract_id:contract.id,target_weight:'100',quantity_tolerance:'5',preparation_month:today.slice(0,7),remark:'Synthetic rc2 copper'});
 for(const role of ['sales_manager','commerce_manager']){const p=await api('/sales-workflow/plans/'+plan.id);await api('/sales-workflow/plans/'+plan.id+'/review',role,{version:p.approval_version,decision:'APPROVED'});}steps.push('sales plan two independent approvals');
 const P=require('./preparation-fixture.cjs'),cu='CU_CATHODE',planApi=(role,product,url,body)=>api(url,role,body);
 const primary=E.receiptBundle(today,seq),secondary=E.receiptBundle(today,seq,1),number=primary.bundle_no,otherNumber=secondary.bundle_no;
 const lines=[primary,secondary].map(bundle=>({...bundle,sheets_per_bundle:48,inbound_at:new Date().toISOString()}));
 let receipt=await api('/receipts','production_operator',{project_id:f.project,lines});
 await api('/receipts','production_operator',{project_id:f.project,lines:[{bundle_no:number,sheets_per_bundle:48,production_date:today,inbound_at:new Date().toISOString()}]},409);
 receipt=await api('/receipts/'+receipt.id+'/submit','production_operator',{version:receipt.version});await api('/receipts/'+receipt.id+'/confirm','production_manager',{version:receipt.version});const {rows:received}=await c.query('SELECT id,bundle_no FROM bundles WHERE receipt_id=$1',[receipt.id]);
 const bundle=received.find(b=>b.bundle_no===number),other=received.find(b=>b.bundle_no===otherNumber);assert(bundle&&other);assert.equal((await api('/bundles/'+encodeURIComponent(number))).physical_status,'IN_STOCK');steps.push('new contract, scoped stock lookup, unique bundle and independent receipt review');
 await c.query("UPDATE stock_map_source SET status='VERIFIED',source_sha256=$1,source_name='Synthetic CI geometry',notes='Synthetic test geometry only'",[crypto.createHash('sha256').update('RC2-SYNTHETIC-MAP').digest('hex')]);await c.query("UPDATE stock_map_cells SET x=0,y=0,width=100,height=100 WHERE code IN('P1-01','P5')");const location=(await c.query("SELECT * FROM locations WHERE project_id=$1 AND code='P1-01'",[f.project])).rows[0]||await api('/masters/locations','admin',{project_id:f.project,warehouse_id:f.warehouse,code:'P1-01',active:true});
 await c.query("UPDATE locations SET map_usage='FORMAL',map_cell_code='P1-01' WHERE id=$1",[location.id]);const suggestion=await api('/v261/lots/suggestion','logistics_field_operator');assert.match(suggestion.lot_no,/^RMM-CU-\d{4}-\d{2,}$/);const serial=Math.max(100,Number(suggestion.lot_no.split('-').at(-1)));const approvedWork=await P.approved(planApi,cu,plan.id,suggestion.lot_no.replace(/-[0-9]+$/,'-'+serial));assert((await api('/v261/lots/suggestion','logistics_field_operator')).lot_no.endsWith('-'+(serial+1)));
 let lot=await api('/v261/lots','logistics_field_operator',{preparation_plan_id:approvedWork.id,planned_location_id:location.id,items:[{bundle_id:bundle.id,sample_required:true},{bundle_id:other.id,sample_required:false}]});
 assert.equal(lot.lot_no,approvedWork.batch_no);
 const blockedWork=await P.approved(planApi,cu,plan.id,P.batch(cu,88));
 const occupied=await request('/v261/lots','logistics_field_operator',{preparation_plan_id:blockedWork.id,planned_location_id:location.id,items:[{bundle_id:other.id,sample_required:false}]});
 assert.equal(occupied.statusCode,409,occupied.body);
 assert.equal((await c.query('SELECT count(*)::int n FROM lot_location_claims WHERE location_id=$1 AND released_at IS NULL',[location.id])).rows[0].n,1);
 lot=await api('/v261/lots/'+lot.id,'logistics_field_operator');
 const samplePath='/v261/lots/'+lot.id+'/items/'+bundle.id+'/sample-stage';
 assert.equal(lot.items.find(item=>item.id===bundle.id).sample_stage,'WAITING');
 for(const stage of ['IN_PROGRESS','RETURNED']){
  await api(samplePath,'logistics_field_operator',{version:lot.version,stage,...(stage==='RETURNED'?{repacked:true}:{})});
  lot=await api('/v261/lots/'+lot.id,'logistics_field_operator');
  assert.equal(lot.items.find(item=>item.id===bundle.id).sample_stage,stage);
 }
 lot=(await api('/v262/lots/'+lot.id+'/weigh','logistics_field_operator',{version:lot.version,items:lot.items.map(b=>({bundle_id:b.id,item_version:b.item_version,gross_weight:'2.0350',seal_no:'RC2-CU-'+seq+'-'+b.id.slice(0,8)}))})).lot;
 assert.equal((await c.query('SELECT (net_weight=2.0325::numeric) v FROM bundles WHERE id=$1',[bundle.id])).rows[0].v,true);
 const inventory=await api('/inventory?'+new URLSearchParams({business_status:'备货作业中',search:number}));
 assert.equal(inventory.items.length,1);assert.equal(inventory.items[0].business_status,'备货作业中');
 const overviewUrl='/v34/overview?'+new URLSearchParams({project_id:f.project,from:today,to:today});
 const earlier=new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
 const prior=await api('/v34/overview?'+new URLSearchParams({project_id:f.project,from:earlier,to:earlier}));
 assert.equal(prior.window.history_unavailable,true);assert.equal(prior.chart_trend.rows[0].period,earlier);
 assert.equal(prior.chart_trend.rows[0].stock_units,null);
 assert.equal(prior.chart_trend.rows[0].stock_unprepared_bundles,null);
 assert.equal(prior.chart_trend.rows[0].stock_prepared_net_mt,null);
 const workingOverview=await api(overviewUrl);
 assert.equal(workingOverview.metrics.preparing.bundles,2);
 assert.equal(workingOverview.metrics.preparing.batches,1);
 assert.equal(workingOverview.chart_trend.rows[0].stock_units,workingOverview.metrics.physical.bundles);
 assert.equal(workingOverview.chart_trend.rows[0].stock_unprepared_bundles,2);
 assert.equal(Number(workingOverview.chart_trend.rows[0].stock_prepared_net_mt),0);
 assert.equal(workingOverview.chart_trend.rows[0].inbound_units,2);
 assert.equal(workingOverview.analysis.states.find(s=>s.key==='preparing').quantity,2);
 assert.equal(workingOverview.chart_trend.rows[0].inbound_bundles,2);
 const mapQuery=new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse,preparation_batch:approvedWork.batch_no,bundle_no:number});
 const choices='/loading-plans/unified/lots?sales_plan_id='+plan.id;
 assert(!(await api(choices)).items.some(x=>x.id===lot.id),'Work in progress cannot be selected');
 const map=await api('/stock-map?'+mapQuery);assert.equal(map.summary.bundle_count,1);
 const productionArea=map.locations.find(x=>x.map_usage==='TEMPORARY');assert(productionArea);
 const productionInventory=await api('/inventory?'+new URLSearchParams({location:'新生产捆包堆存区',search:otherNumber}));
 assert.equal(productionInventory.items[0].id,otherNumber);
 assert.equal(map.summary.net_weight,null);
 assert.equal((await c.query('SELECT weight,gross_weight FROM inventory_view WHERE uuid=$1',[bundle.id])).rows[0].weight,null);
 lot=await api('/v261/lots/'+lot.id+'/submit','logistics_field_operator',{version:lot.version});
 assert(!(await api(choices)).items.some(x=>x.id===lot.id),'Pending completion review cannot be selected');
 const lotTask=(await api('/v34/todos','site_supervisor')).items.find(row=>row.kind==='LOT_REVIEW'&&row.id===lot.id);
 assert.equal(lotTask.business_batch_no,approvedWork.batch_no);
 assert.equal(lotTask.href,'/preparation/'+lot.id);
 assert.equal((await api('/stock-map?'+mapQuery)).summary.net_weight,null);
 await api('/v261/lots/'+lot.id+'/approve','site_supervisor',{version:lot.version,all_weighed_and_stored:true});
 assert.equal((await api(choices)).items.find(x=>x.id===lot.id)?.bundle_count,2);
 assert.equal(Number((await api('/stock-map?'+mapQuery)).summary.net_weight),2.0325);
 const approvedOverview=await api(overviewUrl);
 assert.equal(approvedOverview.metrics.prepared_pending_outbound.batches,1);
 assert.equal(approvedOverview.metrics.prepared_pending_outbound.bundles,2);
 assert.equal(approvedOverview.metrics.preparing.bundles,0);
 assert.equal(approvedOverview.chart_trend.rows[0].stock_unprepared_bundles,0);
 assert.equal(Number(approvedOverview.chart_trend.rows[0].stock_prepared_net_mt),4.065);
 assert.equal(Number(approvedOverview.chart_trend.rows[0].inbound_net_weight),4.065);
 const detail=await api('/stock-map/locations/'+location.id+'?'+mapQuery);assert.equal(detail.items[0].id,number);steps.push('native sampling, repacking, location assignment and gross minus 2.5kg');
 const workbook=new(require('exceljs').Workbook)();
 const dispatchSheet=workbook.addWorksheet('Dispatch'),plate='RC3-CU-'+seq;
 dispatchSheet.addRows([['Horse','Trailer','Capacity','Transporter','Destination'],
  [plate,'RC3-TRAILER',30,'Synthetic Carrier',''],['ALT-'+seq,'RC3-ALT',30,'Synthetic Carrier','Synthetic Depot']]);
 const dispatchPath='/plans/'+plan.id+'/dispatch',shipment_month=today.slice(0,7);
 const dispatchBody={file_name:'synthetic-rc3.xlsx',file_base64:Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64')};
 const wrongMonth=await request(dispatchPath+'/import-preview','admin',{...dispatchBody,shipment_month:'2000-01'});
 assert.equal(wrongMonth.statusCode,409);
 const preview=await api(dispatchPath+'/import-preview','admin',dispatchBody);
 assert.equal(preview.items.length,2);
 const imported=await api(dispatchPath,'admin',{...dispatchBody,preview_sha256:preview.file_sha256});
 assert.equal(imported.added_count,2);
 const {vehicles}=await api(dispatchPath+'?shipment_month='+shipment_month);
 const arrivals=[],arrivalVehicles=[vehicles.find(v=>v.truck_no===plate),vehicles.find(v=>v.truck_no==='ALT-'+seq)];
 const arrivalBody={arrived_at:new Date().toISOString(),trailer_one:'RC3-TRAILER-'+seq,trailer_two:'N/A',driver_name:'Synthetic Driver '+seq,passport_no:'Synthetic Passport '+seq,transporter:'Synthetic Transport'};
 for(const [i,vehicle] of arrivalVehicles.entries()){
  assert.equal(Number(vehicle.capacity_tonnes),30);
  const url='/loading-plans/arrivals/'+vehicle.id;
  if(i){
   const conflict=await api(url,'admin',{...arrivalBody,trailer_one:'RC3-ALT',trailer_two:arrivalBody.trailer_one.toLowerCase().replaceAll('-',' ')},409);
   assert(conflict.error.includes(plate));
   assert(conflict.error.includes('Synthetic CU-AUDIT'));
  }
  const body=i?{...arrivalBody,trailer_one:'RC3-ALT-'+seq,driver_name:'Alternate Driver '+seq,passport_no:'Alternate Passport '+seq}:arrivalBody;
  arrivals.push(await api(url,'admin',body));
 }
 const books='/export-permits/record-books',newBook=(kind,value,fields={})=>api(books,'sales_operator',{contract_id:contract.id,kind,value,...fields});
 const bank=await newBook('issuing_bank','Synthetic issuing bank 1'),otherBank=await newBook('issuing_bank','Synthetic issuing bank 2');
 const account=await newBook('issuing_bank_account','SYNTH-ACCT-001',{bank_id:bank.id,account_name:'Synthetic local holder',swift_code:'tst1cd01'});
 const offshoreBank=await newBook('offshore_bank','Synthetic offshore bank');
 const offshoreAccount=await newBook('offshore_bank_account','SYNTH-OFFSHORE-002',{
  bank_id:offshoreBank.id,account_name:'Synthetic offshore holder',swift_code:'TST2GB2L123'});
 await api(books,'sales_operator',{contract_id:contract.id,kind:'issuing_bank_account',value:'SYNTH-ACCT-001',bank_id:bank.id},409);
 await api(books,'sales_operator',{contract_id:contract.id,kind:'offshore_bank_account',value:'SYNTH-BAD',bank_id:bank.id},400);
 assert((await api(books+'?contract_id='+customer.contract,'sales_operator')).items.some(row=>row.id===account.id&&row.bank_id===bank.id));
 await api(books+'?contract_id='+f.customers.CO_HYDROXIDE.contract,'customer_admin',undefined,404);
 await api(books+'?contract_id='+contract.id,'limited_viewer',undefined,403);
 const emptyOptions=await api('/export-permits/options?sales_plan_id='+plan.id);
 // The integration fixture already has an active copper permit on another contract.
 assert.equal(emptyOptions.unavailable_reason,'CONTRACT_MISMATCH');
 const permit=await api('/export-permits','sales_operator',{contract_id:contract.id,applied_on:today,proforma_no:'RMM-2609-CU-MECR-7500',quantity:'7500',unit_basis:'PHYSICAL_MT',unit:'MT',currency:'USD',unit_price:'1234.567891',price_unit:'USD/MT'});
 const permitPath='/export-permits/'+permit.id,licenseAction=async(action,payload)=>{
  const current=await api(permitPath),pending=await api(permitPath+'/actions','sales_operator',{action,payload,version:current.version,reason:'Synthetic licence acceptance'});
  await api(permitPath+'/actions/'+pending.id,'sales_operator',{decision:'APPROVED',note:'Unauthorized self approval'},403);
  return api(permitPath+'/actions/'+pending.id,'sales_manager',{decision:'APPROVED',note:'Synthetic independent review'});
 };
 await licenseAction('ISSUE',{license_no:'RC3-LICENSE',valid_from:today,valid_until:'2099-12-30'});
 const {version}=await api(permitPath);
 await api(permitPath+'/actions','sales_operator',{action:'AMEND',version,reason:'Synthetic wrong bank',payload:{processing_records:{issuing_bank:otherBank.id,issuing_bank_account:account.id}}},400);
 const amended=await licenseAction('AMEND',{processing_records:{issuing_bank:bank.id,issuing_bank_account:account.id,
  offshore_bank:offshoreBank.id,offshore_bank_account:offshoreAccount.id}});
 assert.equal(amended.issuing_bank_account,'SYNTH-ACCT-001');
 assert.equal(amended.issuing_bank_swift,'TST1CD01');
 assert.equal(amended.offshore_bank_swift,'TST2GB2L123');
 assert.equal(amended.history[0].processing_changes.issuing_bank_account,'SYNTH-ACCT-001');
 const updatedBook=await app.inject({method:'PATCH',url:'/api/v1'+books+'/'+account.id,
  headers:{...sessions.sales_operator,'x-product-code':'CU_CATHODE','idempotency-key':crypto.randomUUID()},
  payload:{project_id:f.project,version:account.version,value:account.value,account_name:'Book changed after approval',swift_code:'TST1CD02'}});
 assert.equal(updatedBook.statusCode,200,updatedBook.body);
 assert.equal((await c.query("SELECT count(*)::int n FROM audit_logs WHERE action LIKE 'export_license%' AND (after_data::text LIKE '%SYNTH-ACCT-001%' OR before_data::text LIKE '%SYNTH-ACCT-001%')")).rows[0].n,0);

 const expired=await api('/export-permits','sales_operator',{contract_id:contract.id,applied_on:'2020-01-01',proforma_no:'SYNTH-EXPIRED-'+seq,quantity:'1',unit_basis:'PHYSICAL_MT',unit:'MT',currency:'USD'});
 const expiredPath='/export-permits/'+expired.id;
 const expiredIssue=await api(expiredPath+'/actions','sales_manager',{action:'ISSUE',payload:{license_no:'SYNTH-EXPIRED-'+seq,valid_from:'2020-01-01',valid_until:'2020-12-31'},version:expired.version,reason:'Synthetic expired licence'});
 assert.equal((await api(expiredPath+'/actions/'+expiredIssue.id,'sales_manager',{decision:'APPROVED',note:'Synthetic historical verification'})).status,'EXPIRED');
 assert((await api('/export-permits?status=EXPIRED')).items.some(x=>x.id===expired.id));
 await api('/export-permits','sales_operator',{contract_id:contract.id,applied_on:today,proforma_no:permit.proforma_no.toLowerCase(),quantity:'1',unit_basis:'PHYSICAL_MT',unit:'MT',currency:'USD'},409);
 await api(permitPath,'production_operator',undefined,403);
 await api('/export-permits','limited_viewer',undefined,403);
 const content=Buffer.from('%PDF-1.7\n% Synthetic archived attachment\n%%EOF\n');
 const digest=crypto.createHash('sha256').update(content).digest('hex');
 const {rows:[archivedAttachment]}=await c.query(
  "INSERT INTO export_license_attachments(license_id,category,filename,mime,content,sha256,created_by) VALUES($1,'PROFORMA','Synthetic proforma.pdf','application/pdf',$2,$3,$4) RETURNING id",
  [permit.id,content,digest,f.accounts.find(a=>a.role==='admin').id]);
 assert.equal((await api(permitPath)).attachments,undefined);
 assert.equal((await request(permitPath+'/attachments','sales_operator',{category:'PROFORMA',filename:'New.pdf',base64:content.toString('base64')})).statusCode,404);
 assert.equal((await request(permitPath+'/attachments/'+archivedAttachment.id,'sales_operator')).statusCode,404);
 assert.deepEqual((await c.query('SELECT content FROM export_license_attachments WHERE id=$1',[archivedAttachment.id])).rows[0].content,content);
 const planBody={sales_plan_id:plan.id,arrival_id:arrivals[0].id,license_id:permit.id,transporter:'Synthetic Transport',destination:'Synthetic Destination',planned_load_date:today,allocation_ids:[lot.id]};
 const blocked=await request('/loading-plans/unified','admin',planBody);
 assert.equal(blocked.statusCode,409,blocked.body);
 assert.match(blocked.body,/派车资料不全/);
 for(const legacy of ['/loading-plans','/loading-plan-documents'])
  await api(legacy,'admin',planBody,409);
 const customerBook='/customers/'+customer.id+'/transport-book';
 for(const field of ['transporter','destination'])
  await api(customerBook,'admin',{field,value:'Retired transport record'},400);
 const legacyBook=await api(customerBook,'admin',{field:'export_license_no',value:'SYNTH-OTHER-LICENSE'});
 assert((await api(customerBook)).items.some(row=>row.id===legacyBook.id));
 const corrected=new(require('exceljs').Workbook)();
 corrected.addWorksheet('Dispatch').addRows([['Horse','Transporter','Destination'],
  [plate.toLowerCase().replaceAll('-',' '),'Do not overwrite saved carrier','Synthetic Depot']]);
 const correctedFile={file_name:'synthetic-updated-dispatch.xlsx',
  file_base64:Buffer.from(await corrected.xlsx.writeBuffer()).toString('base64')};
 const correctedPreview=await api(dispatchPath+'/import-preview','admin',correctedFile);
 assert.deepEqual(correctedPreview.items.map(row=>row.action),['FILL_TRANSPORT']);
 const backfill=await api(dispatchPath,'admin',{...correctedFile,preview_sha256:correctedPreview.file_sha256});
 assert.deepEqual([backfill.added_count,backfill.transport_filled_count],[0,1]);
 const refreshed=(await api(dispatchPath)).vehicles.find(row=>row.id===arrivalVehicles[0].id);
 assert.equal(refreshed.transporter,'Synthetic Carrier');
 assert.equal(refreshed.destination,'Synthetic Depot');
 steps.push('dispatch route verification, standard Excel backfill and licence record book');
 await api('/loading-plans/unified','admin',{...planBody,license_id:expired.id},409);
 const sameDay=await api('/export-permits','sales_operator',{contract_id:contract.id,applied_on:today,proforma_no:'SYNTH-SAME-DAY-'+seq,quantity:'25',unit_basis:'PHYSICAL_MT',unit:'MT',currency:'USD'});
 const dayPath='/export-permits/'+sameDay.id,issue=await api(dayPath+'/actions','sales_operator',{version:sameDay.version,action:'ISSUE',reason:'Synthetic expiry boundary',payload:{license_no:'SYNTH-DAY-'+seq,valid_from:today,valid_until:today}});
 const issuedSameDay=await api(dayPath+'/actions/'+issue.id,'sales_manager',{decision:'APPROVED',note:'Synthetic review'});
 const soon=await api('/export-permits?status=EXPIRING');
 assert(soon.items.some(item=>item.id===sameDay.id));
 const extension={version:issuedSameDay.version,action:'EXTEND',reason:'Synthetic expiry extension',payload:{extension_on:today,extended_until:'2099-12-31',reference:'Synthetic expiry extension'}};
 const chosen='/export-permits/options?'+new URLSearchParams({sales_plan_id:plan.id,planned_load_date:'2099-12-01'});
 assert(!(await api(chosen)).items.some(item=>item.id===sameDay.id));
 await api(dayPath+'/actions','sales_operator',{...extension,payload:{...extension.payload,extended_until:today}},400);
 const pendingExtension=await api(dayPath+'/actions','sales_operator',extension);
 await api(dayPath+'/actions','sales_operator',extension,409);
 assert(!(await api(chosen)).items.some(item=>item.id===sameDay.id));
 const updated=await api(dayPath+'/actions/'+pendingExtension.id,'sales_manager',{decision:'APPROVED',note:'Synthetic extension reviewed'});
 assert.equal(updated.effective_until,'2099-12-31');
 assert.equal(String(updated.valid_until).slice(0,10),today);
 assert.equal(updated.history.find(x=>x.id===pendingExtension.id).result.previous_effective_until,today);
 assert((await api(chosen)).items.some(item=>item.id===sameDay.id));
 assert(!(await api('/export-permits?status=EXPIRING')).items.some(item=>item.id===sameDay.id));

 const {transporter,destination,...autoPlan}=planBody;
 const fallback=(await api('/export-permits/invoice-number?sales_plan_id='+plan.id)).invoice_preview;
 const unlinked={...autoPlan,license_id:undefined,auto_invoice:true};
 const numbered=await api('/loading-plans/unified','admin',unlinked);
 assert.equal(numbered.invoice_no,fallback);
 assert.equal(numbered.packing_list_no,fallback+'-PL');
 await api('/loading-plan-documents/'+numbered.id+'/cancel','admin',{version:numbered.version,reason:'Synthetic automatic invoice check'});
 const replacement='SYNTH-MANUAL-INV-'+seq;
 const manual=await api('/loading-plans/unified','admin',{...unlinked,invoice_no:replacement});
 assert.equal(manual.invoice_no,replacement);
 const invoiceTaken=async invoice_no=>(await api('/export-permits/invoice-number?'+new URLSearchParams({sales_plan_id:plan.id,invoice_no}))).duplicate;
 assert.equal(await invoiceTaken(replacement.toLowerCase()),true);
 await api('/loading-plan-documents/'+manual.id+'/cancel','admin',{version:manual.version,reason:'Synthetic manual invoice check'});
 assert.equal(await invoiceTaken(replacement),false);
 const reentered=await api('/loading-plans/unified','admin',{...unlinked,invoice_no:replacement});
 assert.notEqual(reentered.id,manual.id);
 assert.equal(reentered.invoice_no,replacement);
 const oldManual=await api('/loading-plan-documents/'+manual.id);
 assert.equal(oldManual.document.invoice_no,replacement);
 assert.equal(oldManual.document.status,'CANCELLED');
 await api('/loading-plan-documents/'+reentered.id+'/cancel','admin',{version:reentered.version,reason:'Synthetic reuse check complete'});
 const unlicensedContract=await api('/contracts','admin',{project_id:f.project,customer_id:customer.id,
  contract_no:'RC3-NO-LICENSE-'+seq,effective_date:today,end_date:'2099-12-31',active:true});
 const otherContract=await api('/plans','sales_operator',{project_id:f.project,customer_id:customer.id,contract_id:unlicensedContract.id,
  target_weight:'25',quantity_tolerance:'5',preparation_month:shipment_month,remark:'Synthetic permit contract mismatch'});
 const mismatched=await api('/export-permits/options?sales_plan_id='+otherContract.id);
 assert.equal(mismatched.unavailable_reason,'CONTRACT_MISMATCH');
 assert.deepEqual(mismatched.items,[]);
 const firstDocument=await api('/loading-plans/unified','admin',autoPlan);
 const byPlate=plate.toLowerCase().replaceAll('-',' ');
 const arrivalsByPlate=await api('/loading-plans/arrivals?'+new URLSearchParams({truck_no:byPlate,shipment_month}));
 assert.deepEqual(arrivalsByPlate.items.map(row=>row.arrival_id),[arrivals[0].id]);
 const plansByPlate=await api('/v34/lists/loading?'+new URLSearchParams({truck_no:byPlate}));
 assert.deepEqual(plansByPlate.items.filter(row=>row.state!=='CANCELLED').map(row=>row.id),[firstDocument.id]);
 assert.equal(firstDocument.transporter,'Synthetic Carrier');
 assert.equal(firstDocument.destination,'Synthetic Depot');
 assert.equal(firstDocument.invoice_no,permit.proforma_no+'-01');
 let quota=await api(permitPath);assert.equal(Number(quota.reserved),4.065);assert.equal(Number(quota.used),0);assert.equal(Number(quota.remaining),7500);
 await api(permitPath+'/actions','sales_operator',{action:'CLOSE',payload:{closed_on:today,reference:'Synthetic closure with active reservation'},version:quota.version,reason:'Synthetic guard check'},409);
 await api('/loading-plan-documents/'+firstDocument.id+'/cancel','admin',{version:firstDocument.version,reason:'Synthetic release'});
 quota=await api(permitPath);assert.equal(Number(quota.reserved),0);assert.equal(Number(quota.available),7500);
 assert.equal(quota.allocations.find(a=>a.plan_id===firstDocument.id).state,'RELEASED');
 assert.equal(await invoiceTaken(firstDocument.invoice_no),false);
 const voidInvoice='SYNTH-VOID-INV-'+seq;
 await c.query(`INSERT INTO export_license_allocations(license_id,product_code,cu_plan_id,batch_id,invoice_no,reserved_quantity,state,created_by,closed_at)
  SELECT license_id,product_code,cu_plan_id,batch_id,$2,reserved_quantity,'VOID',created_by,clock_timestamp()
  FROM export_license_allocations WHERE cu_plan_id=$1`,[firstDocument.id,voidInvoice]);
 assert.equal(await invoiceTaken(voidInvoice),true);
 const reused=await api('/loading-plans/unified','admin',{...autoPlan,invoice_no:firstDocument.invoice_no});
 assert.equal(reused.invoice_no,firstDocument.invoice_no);
 assert.equal(await invoiceTaken(reused.invoice_no),true);
 await api('/loading-plan-documents/'+reused.id+'/cancel','admin',{version:reused.version,reason:'Synthetic licensed reuse check'});
 const race=await Promise.all([request('/loading-plans/unified','admin',planBody),request('/loading-plans/unified','logistics_manager',planBody)]);
 assert.deepEqual(race.map(r=>r.statusCode).sort(),[200,409],race.map(r=>r.body).join(' '));
 const document=race.find(r=>r.statusCode===200).json();
 const editResponse=await app.inject({method:'PATCH',url:'/api/v1/loading-plans/unified/documents/'+document.id,headers:{...sessions.admin,'x-product-code':'CU_CATHODE','idempotency-key':crypto.randomUUID()},payload:{...planBody,version:document.version}});
 assert.equal(editResponse.statusCode,200,editResponse.body);
 assert.equal(editResponse.json().id,document.id);
 assert.equal(editResponse.json().invoice_no,document.invoice_no);
 document.version=editResponse.json().version;
 assert.equal(document.invoice_no,permit.proforma_no+'-02');
 assert.equal(document.packing_list_no,document.invoice_no+'-PL');
 const byArrival=await api('/v34/lists/loading?arrival_date='+today);
 assert(byArrival.items.some(r=>r.id===document.id));
 assert(!(await api('/v34/lists/loading?arrival_date=2000-01-01')).items.some(r=>r.id===document.id));
 for(const search of [document.invoice_no,document.packing_list_no,approvedWork.batch_no,contract.contract_no]){
  const filtered=await api('/v34/lists/loading?'+new URLSearchParams({search,planned_load_date:today}));
  assert(filtered.items.some(r=>r.id===document.id),search);
 }
 assert(!(await api('/v34/lists/loading?planned_load_date=2000-01-01')).items.some(r=>r.id===document.id));
 await api('/loading-plans/unified','admin',{...planBody,arrival_id:arrivals[1].id,invoice_no:'RC3-ALT-'+seq},409);
 let load=await api('/v31/loads','admin',{document_id:document.id,document_version:document.version,bundle_ids:[bundle.id]});
 const loadTask=(await api('/v34/todos','site_supervisor')).items.find(row=>row.kind==='LOAD_REVIEW'&&row.id===load.id);
 assert.equal(loadTask.business_batch_no,approvedWork.batch_no);
 assert.equal(loadTask.document_no,load.code);
 assert.equal(loadTask.href,'/outbounds/loads/'+load.id);
 const closePath='/sales-workflow/plans/'+plan.id,closing=await api(closePath,'sales_operator');
 assert.equal(closing.close_eligibility,'AVAILABLE');
 assert.equal(closing.close_readiness.ready,false);
 await api(closePath+'/close','sales_operator',{version:closing.version,reason:'Synthetic in-flight loading check'},409);
 const loadingOverview=await api(overviewUrl);
 assert.equal(loadingOverview.metrics.loading.batches,1);
 assert.equal(loadingOverview.metrics.loading.bundles,1);
 assert.equal(loadingOverview.metrics.prepared_pending_outbound.bundles,1);
 assert.equal(Number(loadingOverview.chart_trend.rows[0].stock_prepared_net_mt),4.065);
 steps.push('Excel dispatch capacity, arrival registration, native loading plan and duplicate batch lock');
 const approvedUrl='/v26/loads/'+load.id+'/approve',approvedBody={version:load.version},approvalKey=crypto.randomUUID();
 const approvals=await Promise.all([request(approvedUrl,'site_supervisor',approvedBody,approvalKey),request(approvedUrl,'site_supervisor',approvedBody,approvalKey)]);
 for(const response of approvals)assert.equal(response.statusCode,200,response.body);
 assert.deepEqual(approvals[0].json(),approvals[1].json());load=approvals[0].json();
 const p3=(await c.query("SELECT b.location_id,b.bundle_no,b.net_weight,b.seal_no,p3.customer_id AS p3_customer_id,l.map_usage FROM bundles b JOIN locations l ON l.id=b.location_id LEFT JOIN copper_leftover_custody p3 ON p3.bundle_id=b.id WHERE b.id=$1",[other.id])).rows[0];
 assert.equal(p3.map_usage,'LEFTOVER');assert.equal(p3.p3_customer_id,customer.id);assert.equal(p3.bundle_no,otherNumber);assert.equal(Number(p3.net_weight),2.0325);assert(p3.seal_no);
 assert.equal((await c.query('SELECT count(*)::int n FROM lot_bundle_releases WHERE loading_id=$1 AND bundle_id=$2',[load.id,other.id])).rows[0].n,1);
 assert.equal((await c.query('SELECT count(*)::int n FROM lot_bundle_releases WHERE loading_id=$1 AND bundle_id=$2',[load.id,bundle.id])).rows[0].n,0);
 const afterRelease=(await api(overviewUrl)).chart_trend.rows[0];
 assert.equal(afterRelease.stock_unprepared_bundles,1);
 assert.equal(Number(afterRelease.stock_prepared_net_mt),2.0325);
 const p3map=await api('/stock-map?'+new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse,region:'P3'}));
 assert.equal(p3map.cells.filter(x=>x.region_code==='P3').length,1);
 assert.equal(p3map.region_summary.find(x=>x.region_code==='P3').bundle_count,1);
 const p3detail=await api('/stock-map/locations/'+p3.location_id+'?'+new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse,customer_id:customer.id,preparation_batch:approvedWork.batch_no}));
 assert.equal(p3detail.items[0].id,otherNumber);assert.equal(p3detail.items[0].preparation_batch,approvedWork.batch_no);
 const stockP3=await api('/inventory?'+new URLSearchParams({location:'P3-LEFTOVER',search:otherNumber}));assert.equal(stockP3.items[0].id,otherNumber);
 const p5=p3map.locations.find(x=>x.map_usage==='TEMPORARY');assert(p5);assert.equal(p5.current.bundle_count,0);
 for(const [action,role,extra]of [['depart','logistics_field_operator',{actual_departure:true,outbound_date:earlier}],['logistics-approve','logistics_manager',{}]])load=await api('/v26/loads/'+load.id+'/'+action,role,{version:load.version,...extra});
 const bpPath='/customs/bp',bpIds=[load.id];
 const initialTemplate=await api(bpPath+'/template');
 const templateFields={...initialTemplate.fields,rccm:'SYNTHETIC-RCCM',id_nat:'SYNTHETIC-ID',nif:'SYNTHETIC-NIF',contact:'Synthetic contact'};
 await api(bpPath+'/template','sales_operator',undefined,403);
 await api(bpPath+'/template','sales_operator',{revision:initialTemplate.revision,fields:templateFields},403);
 assert.equal(initialTemplate.revision,0);
 assert((await api(bpPath)).items.some(row=>row.source_ids.includes(load.id)));
 const bpDraft=await api(bpPath+'/preview','admin',{ids:bpIds});
 assert.equal(bpDraft.template_revision,0);
 const identity=[['RCCM','rccm'],['ID-NAT','id_nat'],['NIF','nif'],['Contact','contact']];
 for(const [,field] of identity)assert(bpDraft.header[field]&&bpDraft.header[field]===initialTemplate.fields[field],field);
 const bpRows=bpDraft.rows;
 assert.equal(bpRows[0].trailer_two,'N/A');
 assert.match(bpDraft.number,/^\d{3,}\/\d{4}\/CU$/);
 const agency=await api(bpPath+'/agencies','admin',{project_id:f.project,name:'Synthetic clearance agency '+seq});
 const sharedAgencies=await app.inject({method:'GET',url:'/api/v1/cobalt'+bpPath+'/agencies',headers:{...sessions.admin,'x-product-code':'CO_HYDROXIDE'}});
 assert.equal(sharedAgencies.statusCode,200);assert(sharedAgencies.json().items.some(item=>item.id===agency.id));
 const revise=(method,url,body,key=crypto.randomUUID())=>app.inject({method,url:'/api/v1'+url,
  headers:{...sessions.admin,'x-product-code':'CU_CATHODE','idempotency-key':key},payload:body});
 const suffix='/'+today.slice(0,4)+'/CU',manualSerial=BigInt(seq)+2147483648n;
 const manualNumber=manualSerial+suffix,correctedSerial=manualSerial+10n;
 const declaration={mode:'ROAD',border:'Sakania',signature_date:today};
 const {rows:[higherBP]}=await c.query(`INSERT INTO customs_bp_documents(product_code,document_no,source_ids,source_context,snapshot,created_by)
  VALUES('CU_CATHODE',$1,$2,$3,$4,$5) RETURNING id`,[manualNumber,[crypto.randomUUID()],
  JSON.stringify([{project_id:f.project,customer_id:customer.id,warehouse_id:f.warehouse}]),
  {number:manualNumber,header:{...bpDraft.header,...declaration,agency:agency.name},rows:bpRows,template_revision:0},f.accounts[0].id]);
 assert.equal((await api(bpPath+'/preview','admin',{ids:bpIds})).number,(manualSerial+1n)+suffix);
 const correctedNumber=correctedSerial+suffix,correction=await revise('PATCH',bpPath+'/'+higherBP.id,
  {revision:1,number:correctedNumber,header:declaration});
 assert.equal(correction.statusCode,200,correction.body);
 assert.equal((await api(bpPath+'/preview','admin',{ids:bpIds})).number,(correctedSerial+1n)+suffix);
 const previousNumber=await revise('PATCH',bpPath+'/'+higherBP.id,
  {revision:2,number:manualNumber,header:declaration});
 assert.equal(previousNumber.statusCode,200,previousNumber.body);
 assert.equal((await api(bpPath+'/preview','admin',{ids:bpIds})).number,(correctedSerial+1n)+suffix);
 const bpBody={ids:bpIds,token:bpDraft.token,header:{mode:'RAILWAY',border:'Sakania',signature_date:today},
  number:'SYNTHETIC-MANUAL-CU-'+seq,agency_id:agency.id,agency_version:agency.version};
 await api(bpPath+'/print/preview','admin',{...bpBody,header:{...bpBody.header,destination:'OVERRIDE'}},400);
 await api(bpPath+'/print/preview','admin',{...bpBody,rows:[{...bpRows[0],net_mt:'999.9'}]},400);
 const bpPreview=await api(bpPath+'/print/preview','admin',bpBody);
 assert.equal(bpPreview.number,bpBody.number);
 assert.match(bpPreview.content,/RAILWAY[\s\S]*CHINA/);
 const issuance=await Promise.all([request(bpPath,'admin',bpBody),request(bpPath,'admin',bpBody)]);
 assert.deepEqual(issuance.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal(issuance.find(r=>r.statusCode===409).json().error,'BP_BATCH_LOCKED');
 const bpDoc=issuance.find(r=>r.statusCode===200).json();
 assert.equal(bpDoc.document_no,bpBody.number);
 const archiveFilters={document_no:bpDoc.document_no.toLowerCase(),batch_no:bpRows[0].batch,customer_id:customer.id,generated_date:today};
 const bpList=await api(bpPath+'?'+new URLSearchParams(archiveFilters));
 assert.equal(bpList.document_total,1);
 assert.deepEqual(bpList.documents.map(row=>row.id),[bpDoc.id]);
 assert.equal(bpList.documents[0].customer,bpDraft.header.customer);
 assert.equal(bpList.documents[0].vehicle_count,bpRows.length);
 assert.equal(Number(bpList.documents[0].net_mt),Number(bpRows[0].net_mt));
 assert.equal(Number(bpList.documents[0].gross_mt),Number(bpRows[0].gross_mt));
 assert(bpList.customer_options.some(row=>row.id===customer.id));
 assert.equal(bpList.documents[0].items,undefined);
 assert.equal((await api(bpPath+'?'+new URLSearchParams({...archiveFilters,batch_no:'UNMATCHED'}))).document_total,0);
 assert.deepEqual((await api(bpPath+'/'+bpDoc.id+'/batches')).items,[{batch:bpRows[0].batch,truck:bpRows[0].truck,code:load.code,
  packing_list_no:bpRows[0].packing_list_no,net_mt:bpRows[0].net_mt,gross_mt:bpRows[0].gross_mt,loading_date:bpRows[0].loading_date}]);
 assert(!(await api(bpPath)).items.some(row=>row.source_ids.includes(load.id)));
 await api(bpPath+'/preview','admin',{ids:bpIds},409);
 await api(bpPath,'admin',{...bpBody,number:bpBody.number.toLowerCase()},409);
 const sheetResponse=await request(bpPath+'/'+bpDoc.id+'/print');
 assert.equal(sheetResponse.statusCode,200);assert(sheetResponse.body.includes(bpPreview.content));
 for(const [label,field] of identity)assert(sheetResponse.body.includes(label+': '+initialTemplate.fields[field]),label);
 const issuedTemplate=await api(bpPath+'/template','admin',{revision:initialTemplate.revision,fields:templateFields});
 const {rows:[templateAudit]}=await c.query(`SELECT id,scope_context,before_data,after_data FROM audit_logs
  WHERE entity_type='customs_bp_templates' AND entity_id=$1 AND action='customs_bp_template_saved'`,[issuedTemplate.id]);
 assert(templateAudit,'Saving a BP template records an audit event');
 assert.equal(templateAudit.scope_context,null);
 assert.equal(templateAudit.before_data.revision,initialTemplate.revision);
 assert.equal(templateAudit.after_data.revision,issuedTemplate.revision);
 const configured=await api(bpPath+'/template');
 assert.equal(configured.revision,1);
 assert.equal(configured.fields.contact,templateFields.contact);
 await api(bpPath+'/template','admin',{revision:issuedTemplate.revision,fields:{...templateFields,title:'Synthetic replacement heading',contact:'Updated future contact'}});
 const legacyNo='SYNTHETIC-LEGACY-'+seq;
 const {rows:[legacyBP]}=await c.query(`INSERT INTO customs_bp_documents(product_code,document_no,source_ids,source_context,snapshot,created_by)
  SELECT product_code,$2,source_ids,source_context,
   (snapshot-'original'-'template_revision'-'template_title')||jsonb_build_object('number',$2::text,
    'header',(snapshot->'header')-'rccm'-'id_nat'-'nif'-'contact','rows',jsonb_build_array((snapshot->'rows'->0)-'loading_date')),
   created_by FROM customs_bp_documents WHERE id=$1 RETURNING id,snapshot`,[bpDoc.id,legacyNo]);
 const legacyPrint=await request(bpPath+'/'+legacyBP.id+'/print');
 assert.equal(legacyPrint.statusCode,200);
 for(const [label,field] of identity)assert(legacyPrint.body.includes(label+': '+templateFields[field]),label);
 assert.equal((await api(bpPath+'/'+legacyBP.id+'/batches')).items[0].loading_date,bpRows[0].loading_date);
 assert.deepEqual((await c.query('SELECT snapshot FROM customs_bp_documents WHERE id=$1',[legacyBP.id])).rows[0].snapshot,legacyBP.snapshot);
 const edit={revision:1,header:{...bpBody.header,border:'Mokambo'}};
 const bpEditKey=crypto.randomUUID(),revision=await revise('PATCH',bpPath+'/'+bpDoc.id,edit,bpEditKey);
 assert.equal(revision.statusCode,200,revision.body);
 assert.deepEqual(revision.json(),{id:bpDoc.id,document_no:bpDoc.document_no,revision:2});
 const committed=await api(bpPath+'/operations/status?'+new URLSearchParams({key:bpEditKey,path:bpPath+'/'+bpDoc.id,method:'PATCH'}));
 assert.equal(committed.committed,true);
 assert.equal((await revise('PATCH',bpPath+'/'+bpDoc.id,edit)).statusCode,409);
 assert.match((await request(bpPath+'/'+bpDoc.id+'/print?revision=1')).body,/Sakania/);
 assert.match((await request(bpPath+'/'+bpDoc.id+'/print')).body,/Mokambo/);
 assert((await request(bpPath+'/'+bpDoc.id+'/print')).body.includes(templateFields.title));
 const bpArchive=await api(bpPath+'/'+bpDoc.id);
 assert.deepEqual(bpArchive.versions.map(row=>row.revision),[2,1]);
 assert.equal(bpArchive.header.agency,agency.name);
 assert.equal(bpArchive.template_revision,0);
 assert(bpArchive.header.contact===initialTemplate.fields.contact,'An existing BP retains its original contact');
 const removed=await revise('DELETE',bpPath+'/agencies/'+agency.id,{version:agency.version});
 assert.equal(removed.statusCode,200,removed.body);
 assert(!(await api(bpPath+'/agencies')).items.some(row=>row.id===agency.id));
 assert((await request(bpPath+'/'+bpDoc.id+'/print')).body.includes(agency.name));
 steps.push('BP source claim race, protected fields, shared agency book and append-only revisions');
 const datedOverview=async(date,asOf)=>{
  const filters={project_id:f.project,contract_no:contract.contract_no,from:date,to:date};
  if(asOf)filters.as_of=asOf;
  return (await api('/v34/overview?'+new URLSearchParams(filters))).chart_trend.rows[0];
 };
 assert.equal((await datedOverview(earlier)).vehicles,0);
 assert.notEqual((await c.query('SELECT physical_status FROM bundles WHERE id=$1',[bundle.id])).rows[0].physical_status,'OUTBOUND');const final='/v26/loads/'+load.id+'/manager-approve',finalBody={version:load.version},key=crypto.randomUUID();
 const results=await Promise.all([request(final,'production_manager',finalBody,key),request(final,'production_manager',finalBody,key)]);
 assert.equal(results[0].statusCode,200,results[0].body);assert.equal(results[1].statusCode,200,results[1].body);
 assert.deepEqual(results[0].json(),results[1].json());
 assert.equal((await api('/bundles/'+encodeURIComponent(number))).physical_status,'OUTBOUND');
 const actualPosting=(await c.query('SELECT manager_at FROM loading_orders WHERE id=$1',[load.id])).rows[0].manager_at;
 const beforeDateCorrection=new Date().toISOString();
 assert.equal((await datedOverview(earlier)).vehicles,1);
 assert.equal((await datedOverview(today)).vehicles,0);
 const correctionPath='/v26/loads/'+load.id+'/outbound-date-corrections';
 assert.equal((await api(correctionPath)).outbound_date,earlier);
 await api(correctionPath,'admin',{expected_date:today,outbound_date:earlier,reason:'Stale date'},409);
 const proposed={expected_date:earlier,outbound_date:today,reason:'Synthetic business date reconciliation'};
 const pending=await api(correctionPath,'admin',proposed);
 assert.equal(pending.state,'PENDING_LOGISTICS');
 await api(correctionPath,'admin',proposed,409);
 const reviewPath=correctionPath+'/'+pending.id+'/review',review={version:pending.version,decision:'APPROVED',note:'Checked source records'};
 await api(reviewPath,'production_manager',review,403);
 assert.equal((await api(correctionPath)).items.find(row=>row.id===pending.id).can_review,true);
 assert((await api('/v34/ui461/tasks')).pending.some(task=>task.id===pending.id&&task.kind==='OUTBOUND_DATE_LOGISTICS_REVIEW'));
 const logistics=await api(reviewPath,'admin',review);
 assert.equal(logistics.state,'PENDING_PRODUCTION');
 assert.equal((await api(correctionPath)).outbound_date,earlier);
 assert.equal((await datedOverview(earlier)).vehicles,1);
 assert((await api('/v34/ui461/tasks')).pending.some(task=>task.id===pending.id&&task.kind==='OUTBOUND_DATE_PRODUCTION_REVIEW'));
 const effective=await api(reviewPath,'admin',{...review,version:logistics.version});
 assert.equal(effective.outbound_date,today);
 const dateEvidence=(await c.query('SELECT requested_by,logistics_by,production_by FROM outbound_date_corrections WHERE id=$1',[pending.id])).rows[0];
 const adminActor=f.accounts.find(actor=>actor.role==='admin').id;
 assert.deepEqual(dateEvidence,{requested_by:adminActor,logistics_by:adminActor,production_by:adminActor});
 assert.deepEqual((await c.query('SELECT action FROM audit_logs WHERE entity_id=$1 ORDER BY id',[pending.id])).rows.map(row=>row.action),
  ['outbound_date_correction_requested','outbound_date_correction_logistics_approved','outbound_date_correction_production_approved']);
 assert.equal((await datedOverview(today)).vehicles,1);
 assert.equal((await datedOverview(earlier)).vehicles,0);
 assert.equal((await datedOverview(earlier,beforeDateCorrection)).vehicles,1);
 assert.deepEqual((await c.query('SELECT manager_at FROM loading_orders WHERE id=$1',[load.id])).rows[0].manager_at,actualPosting);
 assert.equal((await api('/bundles/'+encodeURIComponent(number))).physical_status,'OUTBOUND');
 quota=await api(permitPath);assert.equal(Number(quota.pending),4.065);assert.equal(Number(quota.used),0);
 await licenseAction('SETTLE',{allocation_id:quota.allocations.find(a=>a.plan_id===document.id).id,quantity:'2.0325',reference:'Synthetic customs declaration'});
 quota=await api(permitPath);assert.equal(Number(quota.reserved),0);assert.equal(Number(quota.used),2.0325);
 assert.equal(Number(quota.remaining),7497.9675);
 const usedId=quota.allocations.find(a=>a.plan_id===document.id).id;
 await licenseAction('CORRECT',{allocation_id:usedId,quantity:'2.0319',reference:'Synthetic corrected customs declaration'});
 assert.equal(Number((await api(permitPath)).used),2.0319);
 await licenseAction('EXTEND',{extension_on:today,extended_until:'2099-12-31',reference:'Synthetic extension'});
 assert.match((await api(permitPath)).valid_until,/2099-12-30/);
 const closed=await licenseAction('CLOSE',{closed_on:today,reference:'Synthetic closure'});
 assert.equal(closed.status,'CLOSED');
 const redesigned=await api('/sales-workflow/plans/'+plan.id);
 assert.equal(Number(redesigned.execution.posted),2.0325);
 assert.equal(Number(redesigned.execution.fulfillment),0);
 assert(redesigned.related.loading.some(row=>row.id===document.id&&row.status==='OUTBOUND'));
 assert(redesigned.related.licenses.some(row=>row.id===permit.id));
 const list=await api('/sales-workflow/plans?buyer_contract='+encodeURIComponent(contract.contract_no));
 assert(list.items.some(row=>row.id===plan.id&&Number(row.execution.posted)===2.0325));
 const shipping=await api('/shipping/'+load.id),generate={expected_revision:0,transport_version:shipping.transport.version,source_signature:shipping.source_signature,unit_price_usd:'1234.56'};
 const packingPath='/customs/packing-list',packingFilter={search:approvedWork.batch_no,customer_id:customer.id,created_date:today,page_size:'10'};
 const pendingPacking=await api(packingPath+'?'+new URLSearchParams({...packingFilter,document_status:'MISSING'}));
 const packingRow=pendingPacking.items.find(row=>row.id===load.id);
 assert.equal(pendingPacking.page_size,10);
 assert.equal(packingRow?.loading_plan_id,document.id);
 assert.equal(packingRow?.loading_date,bpRows[0].loading_date);
 assert(pendingPacking.customer_options.some(row=>row.id===customer.id));
 await api('/shipping/'+load.id+'/packing-list','admin',{...generate,unit_price_usd:'-1'},400);
 await api('/shipping/'+load.id+'/packing-list','admin',generate);
 assert.equal(await require('../../server/export-license-plans.cjs').hasInvoice(c,document.invoice_no,document.id),true);
 const generatedPacking=await api(packingPath+'?'+new URLSearchParams({...packingFilter,document_status:'GENERATED'}));
 assert.equal(generatedPacking.items.find(row=>row.id===load.id)?.revision,1);
 assert.equal((await api(packingPath+'/'+load.id+'/revisions')).items[0].revision,1);
 const archive=await request('/shipping/'+load.id+'/packing-list.xlsx');
 assert.equal(archive.statusCode,200);
 const invoiceBook=new(require('exceljs').Workbook)();await invoiceBook.xlsx.load(archive.rawPayload);
 const inv=invoiceBook.getWorksheet('INV');
  for(const sheet of invoiceBook.worksheets)assert.equal(sheet.getCell('E7').value.toISOString().slice(0,10),today);
 assert.equal(inv.pageSetup.fitToPage,true);
 assert.equal(inv.pageSetup.fitToWidth,1);
 assert.equal(inv.pageSetup.fitToHeight,1);
 assert.equal(invoiceBook.getWorksheet('PL').pageSetup.fitToHeight,0);
 assert.equal(invoiceBook.getWorksheet('PL').getCell('E24').value,'N/A');
 assert.equal(inv.getCell('D30').numFmt,'#,##0.000');
 assert.equal(inv.getCell('D30').result,2.0325);
 assert.equal(inv.getCell('E14').alignment.shrinkToFit,true);
 assert.equal(inv.getCell('A42').text,'Bank Name: Synthetic offshore bank');
 assert.equal(inv.getCell('A43').text,'Account Name: Synthetic offshore holder');
 assert.equal(inv.getCell('A44').text,'Account Number: SYNTH-OFFSHORE-002');
 assert.equal(inv.getCell('A45').text,'SWIFT: TST2GB2L123');
 assert.equal(inv.getCell('A48').text,'Bank Name: Synthetic issuing bank 1');
 assert.equal(inv.getCell('A49').text,'Account Name: Synthetic local holder');
 assert.equal(inv.getCell('A50').text,'Account Number: SYNTH-ACCT-001');
 assert.equal(inv.getCell('A51').text,'SWIFT: TST1CD01');
 const invoicePreview=await api('/shipping/'+load.id+'/invoice/preview');
 assert.match(JSON.stringify(invoicePreview.layout),/SWIFT: TST1CD01/);
 assert.match(JSON.stringify(invoicePreview.layout),/SWIFT: TST2GB2L123/);
 assert.equal(inv.getCell('F30').value,1234.56);
 assert.equal(inv.getCell('F31').value,50);
 assert.equal(inv.getCell('G30').result,2509.24);
 assert.equal(inv.getCell('G31').result,101.75);
 assert.equal(inv.getCell('G33').result,2610.99);
 const salesPath='/sales-workflow/plans/'+plan.id,postedBatch=(await api(salesPath)).posted_batches.find(row=>row.loading_id===load.id);
 assert.equal(postedBatch.batch_id,lot.id);
 assert.equal(postedBatch.confirmed_at,null);
 assert.equal(Number((await api(salesPath)).control.invoiced_net_weight),0);
 const invoiceBody={loading_id:load.id,batch_id:lot.id,invoice_no:postedBatch.source_invoice_no||'SYNTHETIC-CU-INVOICE'};
 await api(salesPath+'/confirm-invoice','logistics_field_operator',invoiceBody,403);
 const confirmations=await Promise.all([api(salesPath+'/confirm-invoice','sales_operator',invoiceBody),api(salesPath+'/confirm-invoice','sales_operator',invoiceBody)]);
 assert.equal(confirmations[0].confirmed_at,confirmations[1].confirmed_at);
 assert.equal(Number((await api(salesPath)).control.invoiced_net_weight),2.0325);
 assert.equal((await c.query('SELECT count(*)::int n FROM sales_invoice_confirmations WHERE loading_id=$1',[load.id])).rows[0].n,1);
 assert.equal((await api('/bundles/'+encodeURIComponent(number))).physical_status,'OUTBOUND');
 const fulfilment=await api('/v34/reports?type=fulfilment&from='+today.slice(0,7)+'-01&to='+today+'&contract_id='+contract.id);
 assert.equal(Number(fulfilment.items.find(r=>r.id===plan.id).invoiced_net_weight),2.0325);
 const reuse='/loading-plans/arrivals/'+arrivalVehicles[1].id;
 await api(reuse,'admin',{...arrivalBody,version:arrivals[1].version},409);
 const gate=await api('/gate-permits/from/'+load.id,'admin',{});
 const gatePath='/gate-permits/'+gate.permit_id,issued=await api(gatePath);
 await api(gatePath+'/print','admin',{version:issued.permit.version,business_date:'2026-02-30'},400);
 const usualJob=await api(gatePath+'/print','admin',{version:issued.permit.version});
 assert.equal(usualJob.business_date,today);
 const changedDate='2026-05-12';
 const job=await api(gatePath+'/print','admin',{version:issued.permit.version,business_date:changedDate});
 const view=gatePath+'/revisions/'+job.revision+'/view';
 const printedPage=await request(view+'?job='+job.job_id);
 assert.equal(printedPage.statusCode,200);
 assert.match(printedPage.body,/<td data-cell="D2"[^>]*>12 May 2026<\/td>/);
 assert.doesNotMatch((await request(view)).body,/<td data-cell="D2"[^>]*>12 May 2026<\/td>/);
 assert.equal((await request(view+'?job='+job.job_id,'sales_manager')).statusCode,404);
 const printed=await api(gatePath);
 assert.equal(printed.revisions[0].file_sha256,issued.revisions[0].file_sha256);
 assert.equal(printed.revisions[0].snapshot.business_date,issued.revisions[0].snapshot.business_date);
 assert(printed.history.some(row=>row.after_data?.job_id===job.job_id&&row.after_data.business_date===changedDate));
 await api(gatePath+'/exit','sales_manager',{version:printed.permit.version,actual_exit_at:new Date().toISOString(),actual_exit:true,printed_permit_checked:true});
 await api(reuse,'admin',{...arrivalBody,version:arrivals[1].version});

 const report=await api('/v34/reports?type=outbound&group_by=vehicle_no&from='+today+'&to='+today+'&contract_id='+contract.id);
 const line=report.items.find(item=>item.vehicle_no===plate);assert(line);
 assert.equal(line.bundles,1);assert.equal(Number(line.net_weight),2.0325);
 const chart=(await api(overviewUrl)).chart_trend.rows[0];assert.equal(chart.vehicles,1);assert.equal(Number(chart.net_weight),2.0325);
 assert.equal(chart.stock_unprepared_bundles,1);
 assert.equal(Number(chart.stock_prepared_net_mt),0);
 const exported=await request('/v34/reports/export','admin',{type:'outbound',group_by:'vehicle_no',from:today,to:today,contract_id:contract.id});
 assert.equal(exported.statusCode,200,exported.body.slice(0,200));
 const exportedBook=new(require('exceljs').Workbook)();await exportedBook.xlsx.load(exported.rawPayload);
 const cells=JSON.stringify(exportedBook.worksheets.map(sheet=>sheet.getSheetValues()));
 assert(cells.includes('2.0325'));
  const reviseDate=await api(correctionPath,'logistics_field_operator',{expected_date:today,outbound_date:earlier,reason:'Verify corrected shipment date on issued documents'});
  const reviseDatePath=correctionPath+'/'+reviseDate.id+'/review';
  const firstReview=await api(reviseDatePath,'logistics_manager',{version:reviseDate.version,decision:'APPROVED'});
  await api(reviseDatePath,'production_manager',{version:firstReview.version,decision:'APPROVED'});
  const updatedShipping=await api('/shipping/'+load.id);
  assert.equal(updatedShipping.document_date,earlier);
  assert.equal(updatedShipping.document_date_stale,true);
  const waitingForReissue=await api(packingPath+'?'+new URLSearchParams({...packingFilter,document_status:'MISSING'}));
  assert.equal(waitingForReissue.items.find(row=>row.id===load.id)?.document_date_stale,true);
  await api('/shipping/'+load.id+'/invoice/preview','admin',undefined,409);
  assert.equal((await request('/shipping/'+load.id+'/packing-list.xlsx')).statusCode,409);
  const original=await request('/shipping/'+load.id+'/packing-list.xlsx?revision=1');
  assert.equal(original.statusCode,200);
  assert.deepEqual(original.rawPayload,archive.rawPayload);
  const regeneration={...generate,expected_revision:1,source_signature:updatedShipping.source_signature};
  assert.equal((await api('/shipping/'+load.id+'/packing-list','admin',regeneration)).revision,2);
  const reissued=await request('/shipping/'+load.id+'/packing-list.xlsx');
  assert.equal(reissued.statusCode,200);
  const reissuedBook=new(require('exceljs').Workbook)();await reissuedBook.xlsx.load(reissued.rawPayload);
  const shownDay=new Date(earlier+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  for(const [sheet,path] of [['INV','/invoice/preview'],['PL','/packing-list/preview']]){
   assert.equal(reissuedBook.getWorksheet(sheet).getCell('E7').value.toISOString().slice(0,10),earlier);
   const {layout}=await api('/shipping/'+load.id+path);
   assert.equal(layout.rows.flatMap(row=>row.cells).find(cell=>cell.address==='E7').text,shownDay);
  }
 const customerB=(await c.query("INSERT INTO customers(project_id,code,name,product_code) VALUES($1,$2,$3,'CU_CATHODE') RETURNING id",[f.project,'P3-B-'+seq,'Synthetic customer B'])).rows[0];
 const contractB=await api('/contracts','admin',{project_id:f.project,customer_id:customerB.id,contract_no:'P3-B-'+seq,effective_date:today,end_date:'2099-12-31',active:true});
 const planB=await api('/plans','sales_operator',{project_id:f.project,customer_id:customerB.id,contract_id:contractB.id,target_weight:'20',quantity_tolerance:'5',preparation_month:today.slice(0,7),remark:'Synthetic P3 isolation'});
 for(const role of ['sales_manager','commerce_manager']){const p=await api('/sales-workflow/plans/'+planB.id);await api('/sales-workflow/plans/'+planB.id+'/review',role,{version:p.approval_version,decision:'APPROVED'});}
 const query=plan_id=>'/v261/candidates?'+new URLSearchParams({plan_id,search:otherNumber});
 assert.equal((await api(query(planB.id),'logistics_field_operator')).total,0);
 assert.equal((await api(query(plan.id),'logistics_field_operator')).total,1);
 // A legacy record for customer B shares the physical P3 area with the
 // native remainder from customer A. The application must keep both scopes separate.
 const otherCustomerBundle='P3-LEGACY-B-'+seq;
 await c.query("INSERT INTO bundles(bundle_no,project_id,batch_id,location_id,customer_id,net_weight,physical_status,sample_status,inbound_date,inbound_at,data_kind) SELECT $2,project_id,batch_id,$3,$4,1,'IN_STOCK','NOT_SAMPLED',current_date,now(),'REAL' FROM bundles WHERE id=$1",[other.id,otherCustomerBundle,p3.location_id,customerB.id]);
 const shared=await api('/stock-map/locations/'+p3.location_id+'?'+new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse}));
 assert.equal(shared.summary.bundle_count,2);
 assert.deepEqual(shared.items.map(r=>r.id).sort(),[otherNumber,otherCustomerBundle].sort());
 const scoped=await api('/stock-map/locations/'+p3.location_id+'?'+new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse}),'customer_admin');
 assert.deepEqual(scoped.items.map(r=>r.id),[otherNumber]);
 const bOnly=await api('/stock-map/locations/'+p3.location_id+'?'+new URLSearchParams({project_id:f.project,warehouse_id:f.warehouse,customer_id:customerB.id}));
 assert.deepEqual(bOnly.items.map(r=>r.id),[otherCustomerBundle]);
 const secondLotNo=(await api('/v261/lots/suggestion','logistics_field_operator')).lot_no;
 const validWork=await P.approved(planApi,cu,plan.id,secondLotNo);
 const wrongWork=await P.approved(planApi,cu,planB.id,P.batch(cu,89));
 const selection={planned_location_id:location.id,items:[{bundle_id:other.id,sample_required:false}]};
 const rejected=await request('/v261/lots','logistics_field_operator',{...selection,preparation_plan_id:wrongWork.id});
 assert.equal(rejected.statusCode,409,rejected.body);
 assert.equal((await c.query('SELECT count(*)::int n FROM reservations WHERE bundle_id=$1 AND released_at IS NULL',[other.id])).rows[0].n,0);
 const reprepare=await api('/v261/lots','logistics_field_operator',{...selection,preparation_plan_id:validWork.id});
 assert(reprepare.id!==lot.id);
 assert.equal((await c.query('SELECT count(*)::int n FROM reservations WHERE bundle_id=$1 AND released_at IS NULL',[other.id])).rows[0].n,1);
 const cancelled=await api('/v261/lots/'+reprepare.id+'/cancel','admin',{version:reprepare.version,note:'Synthetic cancellation after P3 reuse',current_state_verified:true,observation:'Bundle remains in P3'});
 assert.equal(cancelled.workflow_state,'CANCELLED');
 assert.equal((await c.query('SELECT location_id FROM bundles WHERE id=$1',[other.id])).rows[0].location_id,p3.location_id);
 assert.equal((await api(query(plan.id),'logistics_field_operator')).total,1);
 steps.push('P3 supervised release, repeat approval, scoped map, cross-customer refusal, same-customer reuse and cancellation');
 steps.push('independent approvals, idempotent final inventory deduction, outbound report and Excel agreement');
 await api('/receipts','production_operator',{project_id:f.project,lines:[{...E.receiptBundle(today,seq,2),sheets_per_bundle:48,inbound_at:new Date().toISOString()}]});
 const uiWorkPlan=await P.approved(planApi,cu,plan.id,P.batch(cu,99));
 const previewInvoice='/export-permits/options?'+new URLSearchParams({sales_plan_id:plan.id,invoice_preview_id:sameDay.id,planned_load_date:today});
 assert.equal((await api(previewInvoice)).invoice_preview,sameDay.proforma_no+'-01');
 // Keep the legacy padded number verbatim and continue from its numeric suffix.
 const historical=sameDay.proforma_no+'-000099';
 await c.query('INSERT INTO loading_plan_groups(sales_plan_id,name,invoice_no,created_by) VALUES($1,$2,$3,$4)',[plan.id,'Synthetic historical numbering',historical,f.accounts.find(a=>a.role==='admin').id]);
 assert.equal((await api(previewInvoice)).invoice_preview,sameDay.proforma_no+'-100');
 const ready=[];
 let pendingForLoading;
 for(const [i,code] of ['P1-02','P1-03'].entries()){
  const {rows:[slot]}=await c.query(`INSERT INTO locations(project_id,warehouse_id,code,map_cell_code,map_usage)
   VALUES($1,$2,$3,$3,'FORMAL') ON CONFLICT(project_id,code) DO UPDATE SET map_cell_code=EXCLUDED.map_cell_code,map_usage='FORMAL' RETURNING id`,[f.project,f.warehouse,code]);
  const fresh=E.receiptBundle(today,seq,3+i),freshNo=fresh.bundle_no;
  const inbound=await api('/receipts','production_operator',{project_id:f.project,lines:[{...lines[0],...fresh}]});
  const sent=await api('/receipts/'+inbound.id+'/submit','production_operator',{version:inbound.version});
  await api('/receipts/'+inbound.id+'/confirm','production_manager',{version:sent.version});
  const {rows:[unit]}=await c.query('SELECT id FROM bundles WHERE bundle_no=$1',[freshNo]);
  const work=await P.approved(planApi,cu,plan.id,P.batch(cu,90+i));
  let batch=await api('/v261/lots','logistics_field_operator',{preparation_plan_id:work.id,planned_location_id:slot.id,items:[{bundle_id:unit.id,sample_required:false}]});
  batch=await api('/v261/lots/'+batch.id,'logistics_field_operator');
  batch=(await api('/v262/lots/'+batch.id+'/weigh','logistics_field_operator',{version:batch.version,items:batch.items.map(b=>({bundle_id:b.id,item_version:b.item_version,gross_weight:'2.0350',seal_no:'V475-CONCURRENT-'+seq+'-'+i}))})).lot;
  batch=await api('/v261/lots/'+batch.id+'/submit','logistics_field_operator',{version:batch.version});
  if(i===0)pendingForLoading=batch;
  else await api('/v261/lots/'+batch.id+'/approve','site_supervisor',{version:batch.version,all_weighed_and_stored:true});
  ready.push(batch.id);
 }
 const trucks=new(require('exceljs').Workbook)(),sheet=trucks.addWorksheet('Dispatch');
 const plates=['V475-A-'+seq,'V475-B-'+seq];sheet.addRows([['Horse','Trailer','Capacity','Transporter','Destination'],
  ...plates.map((plate,i)=>[plate,'V475-T-'+i+'-'+seq,30,'Synthetic Carrier','Synthetic Depot'])]);
 const upload={file_name:'synthetic-v475.xlsx',file_base64:Buffer.from(await trucks.xlsx.writeBuffer()).toString('base64')};
 const validated=await api(dispatchPath+'/import-preview','admin',upload);
 await api(dispatchPath,'admin',{...upload,preview_sha256:validated.file_sha256});
 const candidates=(await api(dispatchPath+'?shipment_month='+shipment_month)).vehicles,readyArrivals=[];
 for(const [i,truck] of plates.entries()){
  const vehicle=candidates.find(item=>item.truck_no===truck);
  readyArrivals.push(await api('/loading-plans/arrivals/'+vehicle.id,'admin',{...arrivalBody,trailer_one:'V475-T-'+i+'-'+seq,driver_name:'Synthetic V475 Driver '+i,passport_no:'Synthetic V475 Passport '+i}));
 }
 const submittedTooSoon=await request('/loading-plans/unified','admin',{...planBody,license_id:sameDay.id,
  arrival_id:readyArrivals[0].id,allocation_ids:[pendingForLoading.id]});
 assert.equal(submittedTooSoon.statusCode,409,submittedTooSoon.body);
 assert.match(submittedTooSoon.json().error,/已审核完成/);
 await c.query('BEGIN');
 try{
  const actor=f.accounts.find(a=>a.role==='admin').id;
  const {rows:[group]}=await c.query('INSERT INTO loading_plan_groups(sales_plan_id,name,created_by,invoice_no) VALUES($1,$2,$3,$4) RETURNING id',
   [plan.id,'Synthetic preparation guard test',actor,'SYNTH-GUARD-'+seq]);
  const {rows:[document]}=await c.query('INSERT INTO loading_plan_documents(group_id,created_by,planned_load_date,arrival_required) VALUES($1,$2,$3,false) RETURNING id',
   [group.id,actor,today]);
  await assert.rejects(c.query('INSERT INTO loading_plan_lots(document_id,allocation_id) VALUES($1,$2)',[document.id,pendingForLoading.id]),
   /只能新增已审核完成的备货批次/);
 }finally{await c.query('ROLLBACK');}
 await api('/v261/lots/'+pendingForLoading.id+'/approve','site_supervisor',{version:pendingForLoading.version,all_weighed_and_stored:true});
 const concurrent=await Promise.all(ready.map((id,i)=>request('/loading-plans/unified','admin',{...planBody,license_id:sameDay.id,arrival_id:readyArrivals[i].id,allocation_ids:[id]})));
 assert.deepEqual(concurrent.map(response=>response.statusCode),[200,200],concurrent.map(response=>response.body).join(' '));
 assert.deepEqual(concurrent.map(response=>response.json().invoice_no).sort(),[sameDay.proforma_no+'-100',sameDay.proforma_no+'-101']);
 assert.equal((await c.query('SELECT count(*)::int n FROM loading_plan_groups WHERE invoice_no=$1',[historical])).rows[0].n,1);
 steps.push('same-prefix invoice preview, legacy padded suffix, concurrent distinct loading plans, sequences above 99');
  const correctionBase='/v27/corrections',postedLoad=await api('/loads/'+load.id);
  const {rows:[returnLocation]}=await c.query("SELECT id FROM locations WHERE project_id=$1 AND map_usage='TEMPORARY' AND active ORDER BY code LIMIT 1",[f.project]);
  const returnRequest={loading_id:load.id,version:postedLoad.version,kind:'RETURN_OUTBOUND',reason:'Synthetic physical return evidence',
   details:{return_location_id:returnLocation.id,physical_return_verified:true,physical_evidence:'Synthetic inspection recorded'}};
  const body=row=>({version:row.version,reason:'Synthetic return approval evidence'});
  const stage=async(row,action,role='admin',status=200)=>api(correctionBase+'/'+row.id+'/'+action,role,body(row),status);
  const supervisor=f.accounts.find(account=>account.role==='site_supervisor');
  const added=(await c.query("INSERT INTO role_permissions VALUES('site_supervisor','load:write') ON CONFLICT DO NOTHING")).rowCount;
  try{
   if(added)await signIn(supervisor);
   const staffRequest=await api(correctionBase,'site_supervisor',returnRequest);
   const approved=await stage(staffRequest,'authorize');
   await stage(approved,'verify-return','site_supervisor',409);
   await stage(approved,'reject');
  }finally{
   if(added){
    await c.query("DELETE FROM role_permissions WHERE role_code='site_supervisor' AND permission_code='load:write'");
    await signIn(supervisor);
   }
  }
  const adminRequest=await api(correctionBase,'admin',returnRequest);
  await stage(adminRequest,'verify-return','admin',409);
  const authorized=await stage(adminRequest,'authorize'),verified=await stage(authorized,'verify-return');
  assert.equal(verified.status,'RETURN_VERIFIED');
  assert.equal(verified.authorized_by,adminRequest.requested_by);
  assert.equal(verified.verified_by,adminRequest.requested_by);
  await stage(verified,'reject');
  assert.equal((await api('/bundles/'+encodeURIComponent(number))).physical_status,'OUTBOUND');
  steps.push('copper return self-verification requires administrator, authorization stage and physical evidence');
 E.save('rc2-copper-results.json',{status:'PASS',steps,syntheticOnly:true,database:f.database,plan:plan.id,plannedLocation:location.id,remainingBundle:other.id,uiWorkPlan:uiWorkPlan.id,uiBatch:uiWorkPlan.batch_no});
 }finally{await app?.close();await c.end();}
});
