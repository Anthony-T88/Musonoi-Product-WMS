'use strict';
process.env.V22_TEMPLATE_DATABASE='musonoi_v26_regression_test';
const {setup}=require('./v23-helper.cjs'),{Client}=require('pg');
(async()=>{const t=await setup('v26_negative');try{
 const op=await t.actor('operator'),manager=await t.actor('logistics_manager'),m=(await t.request('/masters',t.admin)).json();
 const archive=(await t.c.query("SELECT md5(string_agg(to_jsonb(b)::text,'' ORDER BY id)) AS hash FROM bundles b")).rows[0].hash;
 const customers=m.customers.slice(0,2),plans=[];for(const [i,customer] of customers.entries()){const k=await t.pass('/contracts',t.admin,{project_id:t.pid,customer_id:customer.id,contract_no:'V26-NEG-'+i,effective_date:'2020-01-01',end_date:'2099-12-31',active:true});plans.push(await t.pass('/plans',op,{project_id:t.pid,customer_id:customer.id,contract_id:k.id,target_weight:'100'}));}
 const map=(await t.request('/stock-map',op)).json(),free=map.cells.filter(c=>!m.locations.some(l=>(l.map_cell_code||l.code)===c.code)),locs=[];
 for(let n=0;n<3;n++){let l=await t.pass('/masters/locations',t.admin,{project_id:t.pid,warehouse_id:m.warehouses[0].id,code:'V26-NEG-'+n});const r=await t.request('/stock-map/locations/'+l.id,t.admin,'PATCH',{version:l.version,map_cell_code:free[n].code});t.assert.equal(r.statusCode,200,r.body);locs.push(r.json());}
 const deny=async(path,body,status=409,s=op)=>{const r=await t.request(path,s,'POST',body);t.ok(r.statusCode===status,path+' rejects: '+r.body);};
 const line=n=>({bundle_no:'MUS-2026-000-'+n,production_date:'2026-10-01',inbound_at:'2026-10-28T08:00:00+02:00'});
 await deny('/receipts',{project_id:t.pid,lines:[{...line(1),gross_weight:'2.0350'}]},400);
 await deny('/receipts',{project_id:t.pid,lines:[{...line(1),bundle_no:'BAD-NUMBER'}]},400);
 let r=await t.pass('/receipts',op,{project_id:t.pid,customer_id:customers[0].id,lines:Array.from({length:8},(_,i)=>({...line(i+1),location_id:locs[0].id,batch_id:m.batches[0].id}))});
 t.ok(r.lines.every(l=>l.location_id!==locs[0].id)&&r.customer_id!==customers[0].id,'server ignores forged intake customer and location');
 r=await t.pass('/receipts/'+r.id+'/submit',op,{version:r.version});await t.pass('/receipts/'+r.id+'/confirm',t.reviewer,{version:r.version});
 await deny('/receipts',{project_id:t.pid,lines:[line(1)]});
 const bs=(await t.c.query("SELECT * FROM bundles WHERE bundle_no LIKE 'MUS-2026-000-%' ORDER BY bundle_no")).rows;
 const make=(n,lot='10',plan=plans[0],loc=locs[0])=>({plan_id:plan.id,lot_no:'RMM-CU-2026-'+lot,items:[{bundle_id:bs[n].id,gross_weight:'2.0350',location_id:loc.id,actual_moved:true}]});
 await deny('/v26/allocations',{...make(0),plan_id:null},400);
 for(const lot of ['RMM-CU-26-01','RMM-CU-2026-00','RMM-CU-2026-100','CU-2026-01'])await deny('/v26/allocations',{...make(0),lot_no:lot});
 for(const gross of [undefined,'','0','0.0025','-1','2.03501','1e2']){const x=make(0);x.items[0].gross_weight=gross;await deny('/v26/allocations',x);}
 await deny('/v26/allocations',{...make(0),items:[{...make(0).items[0],actual_moved:false}]});
 t.ok((await t.c.query('SELECT net_weight FROM bundles WHERE id=$1',[bs[0].id])).rows[0].net_weight===null,'invalid request rolls measurement back');
 const race=await Promise.all([t.request('/v26/allocations',op,'POST',make(0,'10')),t.request('/v26/allocations',t.admin,'POST',make(0,'11'))]);
 t.ok(race.filter(r=>r.statusCode===200).length===1&&race.filter(r=>r.statusCode===409).length===1,'two actors race only one reservation succeeds');
 let a=race.find(r=>r.statusCode===200).json(),owner=race[0].statusCode===200?op:t.admin;
 t.ok((await t.c.query('SELECT count(*) FROM reservations WHERE bundle_id=$1 AND released_at IS NULL',[bs[0].id])).rows[0].count==='1','unique active reservation');
 await deny('/v26/allocations',{...make(1),lot_no:a.lot_no});
 t.ok((await t.c.query('SELECT net_weight FROM bundles WHERE id=$1',[bs[1].id])).rows[0].net_weight===null,'duplicate lot leaves other bundle unweighed');
 // Independent reviewers cannot approve their own submissions, even with both permissions.
 let own=await t.pass('/v26/allocations',t.reviewer,make(1,'12',plans[0],locs[1]));
 await deny('/v26/allocations/'+own.id+'/approve',{version:own.version},409,t.reviewer);
 own=await t.pass('/v26/allocations/'+own.id+'/reject',t.supervisor2,{version:own.version,note:'重新确认检斤'});
 const v=(await t.request('/bundles/'+bs[1].bundle_no,op)).json();t.ok(v.current_customer==='Musonoi'&&v.business_status==='可备货'&&v.location==='V26-NEG-1','reject releases assignment without invented movement');
 await deny('/v26/allocations/'+own.id+'/approve',{version:own.version},409,t.reviewer);
 // Failed commit on mixed destination rolls the whole second allocation and weighing back.
 await deny('/v26/allocations',make(2,'13',plans[1],locs[0]));
 t.ok((await t.c.query('SELECT net_weight,location_id FROM bundles WHERE id=$1',[bs[2].id])).rows[0].net_weight===null,'deferred customer check rolls entire transaction back');
 // A real client disconnect before COMMIT rolls back weighing, locks, document and audit.
 const raw=new Client({connectionString:t.cfg.databaseUrl});await raw.connect();await raw.query('BEGIN');const interrupted=make(3,'14',plans[0],locs[0]);await raw.query('SELECT * FROM v26_submit($1,$2,$3,$4)',[op.user.id,interrupted.plan_id,interrupted.lot_no,JSON.stringify(interrupted.items)]);await raw.end();
 t.ok(!(await t.c.query("SELECT 1 FROM allocations WHERE lot_no='RMM-CU-2026-14'")).rowCount&&(await t.c.query('SELECT net_weight FROM bundles WHERE id=$1',[bs[3].id])).rows[0].net_weight===null,'connection interruption rolls uncommitted work back');
 let pendingLoads=(await t.request('/v26/lots',op)).json();t.ok(!pendingLoads.items.some(x=>x.id===a.id),'pending lot absent from loading picker');
 a=await t.pass('/v26/allocations/'+a.id+'/approve',t.reviewer,{version:a.version});
 const loadBody={allocation_id:a.id,vehicle_no:'QA-CONCURRENT-1',load_date:'2026-10-28',bundle_ids:[bs[0].id]};
 const lr=await Promise.all([t.request('/v26/loads',owner,'POST',loadBody),t.request('/v26/loads',t.admin,'POST',{...loadBody,vehicle_no:'QA-CONCURRENT-2'})]);
 t.ok(lr.filter(r=>r.statusCode===200).length===1&&lr.filter(r=>r.statusCode===409).length===1,'two actors race one load allocation');
 let d=lr.find(r=>r.statusCode===200).json(),loadOwner=lr[0].statusCode===200?owner:t.admin;
 await deny('/loads/'+d.id+'/complete',{version:d.version},409,loadOwner);
 d=await t.pass('/v26/loads/'+d.id+'/reject',t.reviewer,{version:d.version,note:'车牌需要更正'});
 t.ok(!(await t.c.query('SELECT 1 FROM loading_items WHERE bundle_id=$1 AND active',[bs[0].id])).rowCount&&(await t.c.query('SELECT 1 FROM reservations WHERE bundle_id=$1 AND released_at IS NULL',[bs[0].id])).rowCount===1,'load reject releases only loading occupancy');
 d=await t.pass('/v26/loads',loadOwner,{...loadBody,vehicle_no:'QA-CORRECTED',replaces_id:d.id});
 t.ok(!!d.replaces_id,'corrected revision linked to rejected history');
 await deny('/v26/loads/'+d.id+'/depart',{version:d.version,actual_departure:true,departed_at:'2026-10-28T12:00:00+02:00'},409,loadOwner);
 d=await t.pass('/v26/loads/'+d.id+'/approve',t.reviewer,{version:d.version});
 await deny('/v26/loads/'+d.id+'/manager-approve',{version:d.version},409,manager);
 d=await t.pass('/v26/loads/'+d.id+'/depart',loadOwner,{version:d.version,actual_departure:true,departed_at:'2026-10-28T12:00:00+02:00'});
 const afterMap=(await t.request('/stock-map',op)).json(),summary=(await t.request('/v26/summary',op)).json(),inventory=(await t.request('/inventory',op)).json(),dashboard=(await t.request('/dashboard',op)).json();
 t.ok(afterMap.summary.bundle_count===summary.onsite_bundles,'map equals onsite bundle count');
 t.ok(Number(afterMap.summary.net_weight)===Number(summary.onsite_known_weight)&&Number(inventory.summary.physical_weight)===Number(summary.onsite_known_weight),'map inventory onsite mass equal');
 t.ok(dashboard.workflow_metrics.onsite_bundles===summary.onsite_bundles&&dashboard.workflow_metrics.departed_pending_bundles===1,'dashboard snapshot equals business states');
 t.ok((await t.request('/stock-map/locate?bundle='+bs[0].bundle_no,op)).json().kind==='NOT_IN_STOCK','departed bundle not located on yard');
 await deny('/v26/allocations',make(0,'15'));
 d=await t.pass('/v26/loads/'+d.id+'/manager-reject',manager,{version:d.version,note:'补充凭证'});
 t.ok((await t.request('/bundles/'+bs[0].bundle_no,op)).json().on_site===false,'manager rejection remains offsite');
 d=await t.pass('/v26/loads/'+d.id+'/correct',loadOwner,{version:d.version,note:'已核对实际离场凭证'});
 const approval={version:d.version};await t.pass('/v26/loads/'+d.id+'/manager-approve',manager,approval,'qa-manager-once');
 await deny('/v26/loads/'+d.id+'/manager-approve',approval,409,manager);
 t.ok((await t.c.query("SELECT count(*) FROM inventory_events WHERE bundle_id=$1 AND event_type='OUTBOUND'",[bs[0].id])).rows[0].count==='1','new key duplicate approval cannot double post');
 const appClient=new Client({connectionString:t.cfg.databaseUrl});await appClient.connect();try{await t.assert.rejects(appClient.query("UPDATE loading_orders SET workflow_state='OUTBOUND' WHERE id=$1",[d.id]));t.ok(true,'direct state field mutation denied');}finally{await appClient.end();}
 t.ok((await t.c.query("SELECT md5(string_agg(to_jsonb(b)::text,'' ORDER BY id)) AS hash FROM bundles b WHERE bundle_no NOT LIKE 'MUS-2026-000-%'")).rows[0].hash===archive,'all historical bundle rows unchanged');
 await t.c.query('UPDATE user_scopes SET warehouse_id=$1 WHERE user_id=$2',[m.warehouses[0].id,op.user.id]);
 const scoped=await t.pass('/v26/allocations',op,make(4,'16',plans[0],locs[2]));t.ok(scoped.workflow_state==='PENDING','warehouse scoped operator can submit within own warehouse');
 const state=(await t.request('/dashboard',op)).json();t.ok(state.workflow_metrics.locked_bundles>=1&&state.workflow_metrics.prepared_bundles>=0,'allocation state changes captured in temporal dashboard');
 t.success();
}finally{await t.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
