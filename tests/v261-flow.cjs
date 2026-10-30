process.env.V22_TEMPLATE_DATABASE='musonoi_v261_regression_test';
const {setup}=require('./v23-helper.cjs');
(async()=>{const t=await setup('v261_flow');try{
 const op=await t.actor('operator'),manager=await t.actor('logistics_manager'),m=(await t.request('/masters',op)).json();
 const lines=Array.from({length:21},(_,i)=>({bundle_no:'MUS-2026-299-'+String(i+1).padStart(2,'0'),production_date:'2026-10-01',inbound_at:'2026-10-28T08:00:00+02:00'}));
 let receipt=await t.pass('/receipts',op,{project_id:t.pid,lines});receipt=await t.pass('/receipts/'+receipt.id+'/submit',op,{version:receipt.version});await t.pass('/receipts/'+receipt.id+'/confirm',t.reviewer,{version:receipt.version});
 const bs=(await t.c.query("SELECT * FROM bundles WHERE bundle_no LIKE 'MUS-2026-299-%' ORDER BY bundle_no")).rows; t.ok(bs.length===21&&bs.every(b=>b.net_weight===null),'new intake no mass and preserved leading zeros');
 const k=await t.pass('/contracts',t.admin,{project_id:t.pid,customer_id:m.customers[0].id,contract_no:'V261-FLOW',effective_date:'2020-01-01',end_date:'2099-12-31',active:true});const p=await t.pass('/plans',op,{project_id:t.pid,customer_id:m.customers[0].id,contract_id:k.id,target_weight:'100'});
 const map=(await t.request('/stock-map',op)).json();const loc=map.locations.find(l=>l.cell_code&&l.current.bundle_count===0);
 let a=await t.pass('/v261/lots',op,{plan_id:p.id,lot_no:'RMM-CU-2026-61',planned_location_id:loc.id,items:bs.slice(0,19).map((b,i)=>({bundle_id:b.id,sample_required:i===18}))});
 t.ok(a.workflow_state==='WORKING','create starts work');t.ok((await t.c.query('SELECT count(*) FROM reservations WHERE allocation_id=$1 AND released_at IS NULL',[a.id])).rows[0].count==='19','create locks all unknown-weight bundles');
 t.ok((await t.c.query('SELECT count(*) FROM bundles WHERE id=ANY($1::uuid[]) AND location_id=$2',[bs.slice(0,19).map(b=>b.id),loc.id])).rows[0].count==='0','planned position does not move stock');
 for(const b of bs.slice(0,18))a=await t.pass('/v261/lots/'+a.id+'/items/'+b.id+'/weigh',op,{version:a.version,gross_weight:'2.0350'});
 let d=(await t.request('/v261/lots/'+a.id,op)).json();t.ok(d.summary.weighed===18&&d.summary.unweighed===1&&d.summary.known_net==='36.5850','18 of 19 exact known total');
 let r=await t.request('/v261/lots/'+a.id+'/submit',op,'POST',{version:a.version});t.ok(r.statusCode===409&&r.body.includes(bs[18].bundle_no),'incomplete submission identifies bundle');
 a=await t.pass('/v261/lots/'+a.id+'/items/'+bs[18].id+'/sample-stage',op,{version:a.version,stage:'IN_PROGRESS'});
 r=await t.request('/v261/lots/'+a.id+'/items/'+bs[18].id+'/weigh',op,'POST',{version:a.version,gross_weight:'2.0350'});t.ok(r.statusCode===409,'sampling cannot be finally weighed');
 a=await t.pass('/v261/lots/'+a.id+'/items/'+bs[18].id+'/sample-stage',op,{version:a.version,stage:'RETURNED',repacked:true});a=await t.pass('/v261/lots/'+a.id+'/items/'+bs[18].id+'/weigh',op,{version:a.version,gross_weight:'2.0350'});
 a=await t.pass('/v261/lots/'+a.id+'/submit',op,{version:a.version});a=await t.pass('/v261/lots/'+a.id+'/reject',t.reviewer,{version:a.version,note:'核对重量凭证'});
 t.ok(a.workflow_state==='RECTIFY'&&(await t.c.query('SELECT count(*) FROM reservations WHERE allocation_id=$1 AND released_at IS NULL',[a.id])).rows[0].count==='19','supervisor rejection retains 19 locks');
 a=await t.pass('/v261/lots/'+a.id+'/items/'+bs[0].id+'/weigh',op,{version:a.version,gross_weight:'2.0360',note:'修订重量'});a=await t.pass('/v261/lots/'+a.id+'/submit',op,{version:a.version});
 r=await t.request('/v261/lots/'+a.id+'/approve',t.reviewer,'POST',{version:a.version});t.ok(r.statusCode===409,'supervisor must confirm final weighing and storage');
 a=await t.pass('/v261/lots/'+a.id+'/approve',t.reviewer,{version:a.version,all_weighed_and_stored:true});t.ok((await t.c.query('SELECT count(*) FROM bundles WHERE id=ANY($1::uuid[]) AND location_id=$2',[bs.slice(0,19).map(b=>b.id),loc.id])).rows[0].count==='19','approval confirms unified position');
 t.ok((await t.request('/v26/lots',op)).json().items.some(x=>x.id===a.id),'approved lot in original loading flow');
 for(const [index,part] of [bs.slice(0,16),bs.slice(16,19)].entries()){
 let l=await t.pass('/v26/loads',op,{allocation_id:a.id,vehicle_no:'V261-TRUCK-'+index,load_date:'2026-10-28',bundle_ids:part.map(b=>b.id)});l=await t.pass('/v26/loads/'+l.id+'/approve',t.reviewer,{version:l.version});l=await t.pass('/v26/loads/'+l.id+'/depart',op,{version:l.version,actual_departure:true,departed_at:'2026-10-28T12:00:00+02:00'});const key='v261-out-once-'+index,body={version:l.version};l=await t.pass('/v26/loads/'+l.id+'/manager-approve',manager,body,key);await t.pass('/v26/loads/'+l.id+'/manager-approve',manager,body,key);
 t.ok(l.workflow_state==='OUTBOUND','split truck posted once '+index);}
 t.ok((await t.c.query('SELECT workflow_state FROM allocations WHERE id=$1',[a.id])).rows[0].workflow_state==='FULFILLED','19 bundles all dispatched');
 let c=await t.pass('/v261/lots',op,{plan_id:p.id,lot_no:'RMM-CU-2026-62',planned_location_id:loc.id,items:[{bundle_id:bs[19].id}]});c=await t.pass('/v261/lots/'+c.id+'/items/'+bs[19].id+'/weigh',op,{version:c.version,gross_weight:'2.0350'});
 r=await t.request('/v261/lots/'+c.id+'/cancel',op,'POST',{version:c.version,note:'取消'});t.ok(r.statusCode===409,'measured lot cancellation needs verified observation');
 c=await t.pass('/v261/lots/'+c.id+'/cancel',op,{version:c.version,note:'核实后取消',current_state_verified:true,observation:'捆包在临时堆存区，已核实重量及包装'});t.ok(c.workflow_state==='CANCELLED'&&!(await t.c.query('SELECT 1 FROM reservations WHERE allocation_id=$1 AND released_at IS NULL',[c.id])).rowCount,'verified cancellation releases lock preserving lot');
 const bundle=(await t.request('/bundles/'+bs[19].bundle_no,op)).json();t.ok(bundle.current_customer==='Musonoi','cancel restores owner assignment');
 t.success();
}finally{await t.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
