'use strict';

const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const E=require('./environment.cjs'),{CO,CU}=require('./uiux-routes.cjs');

async function seed(){
 const f=E.fixture(),c=new Client(E.options(f.database)),sessions=new Map(),prepared=[],blocked=[];
 let app;
 await c.connect();
 try{
  app=await require('../../server/app.cjs').build({config:E.appConfig(f.database)});
  const request=async(role,product,url,body)=>{
   if(!sessions.has(role)){
    const a=f.accounts.find(x=>x.role===role);
    assert(a,'Missing synthetic role '+role);
    const login=await app.inject({method:'POST',url:'/api/v1/auth/login',remoteAddress:'127.61.0.'+(sessions.size+1),
     headers:{origin:f.appCfg.origin},payload:{username:a.username,password:a.password}});
    assert.equal(login.statusCode,200,'Synthetic login '+role);
    sessions.set(role,{origin:f.appCfg.origin,cookie:login.cookies.map(x=>x.name+'='+x.value).join('; '),'x-csrf-token':login.json().csrfToken});
   }
   const response=await app.inject({url:'/api/v1'+url,method:body?'POST':'GET',
    remoteAddress:'127.62.0.1',headers:{...sessions.get(role),'x-product-code':product,'idempotency-key':randomUUID()},...(body?{payload:body}:{})});
   assert.equal(response.statusCode,200,url+' '+response.body.slice(0,210));
   return response.json();
  };
  const check=async(name,fn)=>{try{await fn();prepared.push(name);}catch(e){blocked.push({name,reason:e.message});}};
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lubumbashi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const unique=Date.now(),coPlan=(await c.query("SELECT * FROM co_sales_plans WHERE remark='Synthetic rc2 flow' ORDER BY created_at DESC LIMIT 1")).rows[0];
  await check('co-draft-receipt',()=>request('logistics_field_operator',CO,'/cobalt/preparations',{project_id:f.project,warehouse_id:f.warehouse,total_bags:2}));
  await check('cu-draft-receipt',async()=>{
   const project=(await c.query("INSERT INTO projects(code,name) VALUES('UIUX-RECEIPT','Synthetic receipt project') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id")).rows[0].id;
   await c.query("INSERT INTO warehouses(project_id,code,name) VALUES($1,'UIUX-WH','Synthetic receipt warehouse') ON CONFLICT(project_id,code) DO NOTHING",[project]);
   for(const a of f.accounts.filter(x=>['admin','production_operator','production_manager'].includes(x.role)))
    await c.query('INSERT INTO user_scopes(user_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[a.id,project]);
   const found=(await c.query("SELECT id FROM receipts WHERE project_id=$1 AND status='DRAFT'",[project])).rowCount;
   if(!found)await request('production_operator',CU,'/receipts',{project_id:project,lines:[
    {bundle_no:'MUS-'+day.slice(0,4)+'-098-'+unique,sheets_per_bundle:48,production_date:day,inbound_at:new Date().toISOString()}
   ]});
  });
  await check('cu-historical-details',async()=>{
   const actor=f.accounts.find(a=>a.role==='admin').id;
   await c.query('BEGIN');
   try{
    await c.query("INSERT INTO yards(project_id,warehouse_id,code,name) VALUES($1,$2,'UIUX-YARD','Synthetic UIUX yard') ON CONFLICT(project_id,code) DO NOTHING",[f.project,f.warehouse]);
    await c.query(`INSERT INTO sampling_batches(code,project_id,customer_id,sample_date,agency,status,created_by)
     VALUES('UIUX-LEGACY-SAMPLE',$1,$2,$3,'Synthetic sample laboratory','REGISTERED',$4) ON CONFLICT(code) DO NOTHING`,
    [f.project,f.customers[CU].id,day,actor]);
    await c.query(`INSERT INTO loading_orders(code,project_id,customer_id,vehicle_no,carrier,loading_point,loaded_at,status,created_by)
     VALUES('UIUX-LEGACY-LOADING',$1,$2,'SYNTHETIC-UIUX','Synthetic carrier','Synthetic dock',clock_timestamp(),'LOADED',$3)
     ON CONFLICT(code) DO NOTHING`,[f.project,f.customers[CU].id,actor]);
    const load=(await c.query("SELECT id,project_id,customer_id,vehicle_no FROM loading_orders WHERE code='UIUX-LEGACY-LOADING'")).rows[0];
    const vals=[load.project_id,load.customer_id,load.id,actor,load.vehicle_no];
    if(!(await c.query("SELECT id FROM weighings WHERE code='UIUX-LEGACY-WEIGH'")).rowCount)
     await c.query(`INSERT INTO weighings(code,project_id,customer_id,loading_id,created_by,vehicle_no,kind,gross_weight,tare_weight,scale_no,weighed_at,status)
      VALUES('UIUX-LEGACY-WEIGH',$1,$2,$3,$4,$5,'VEHICLE',31.1000,6.0000,'Synthetic scale',clock_timestamp(),'RECORDED')`,vals);
    await c.query(`INSERT INTO outbound_orders(code,project_id,customer_id,loading_id,created_by,weighing_id)
     SELECT 'UIUX-LEGACY-OUTBOUND',$1,$2,$3,$4,id FROM weighings WHERE code='UIUX-LEGACY-WEIGH' ON CONFLICT(code) DO NOTHING`,vals.slice(0,4));
    await c.query(`INSERT INTO outbound_corrections(code,loading_id,kind,status,reason,requested_by,original_snapshot,proposed_data,bundle_snapshot)
     SELECT 'UIUX-LEGACY-CORRECTION-POSTED',l.id,'VEHICLE','REJECTED','Synthetic correction fixture',$2,to_jsonb(l),'{}','[]'
     FROM loading_orders l WHERE project_id=$1 AND workflow_state='OUTBOUND' ORDER BY created_at DESC LIMIT 1
     ON CONFLICT(code) DO NOTHING`,[f.project,actor]);
    const exception=(await c.query(`INSERT INTO inventory_exceptions(project_id,warehouse_id,category,source_key,related_kind,description,responsible_id,created_by)
     SELECT $1,$2,'WEIGHT','UIUX-LEGACY-EXCEPTION','weighing','Synthetic discrepancy',$3,$3
     WHERE NOT EXISTS(SELECT 1 FROM inventory_exceptions WHERE source_key='UIUX-LEGACY-EXCEPTION') RETURNING id`,[f.project,f.warehouse,actor])).rows[0];
    if(exception)await c.query("INSERT INTO stock_adjustments(code,project_id,exception_id,reason,created_by) VALUES('UIUX-LEGACY-ADJUSTMENT',$1,$2,'Synthetic draft adjustment',$3)",[f.project,exception.id,actor]);
    await c.query('COMMIT');
   }catch(error){await c.query('ROLLBACK');throw error;}
  });
  await check('cu-legacy-plan-states',async()=>{
   const actor=f.accounts.find(a=>a.role==='admin').id;
   const plan=(await c.query("SELECT id FROM sales_plans WHERE project_id=$1 AND remark='Synthetic rc2 copper' ORDER BY created_at DESC LIMIT 1",[f.project])).rows[0];
   assert(plan,'Synthetic approved copper sales plan is required');
   await c.query('BEGIN');
   try{
    const lot=(await c.query(`SELECT a.id FROM allocations a WHERE a.plan_id=$1 AND a.workflow_state IN('PREPARED','PARTIAL')
     AND NOT EXISTS(SELECT 1 FROM loading_plan_lot_locks l WHERE l.allocation_id=a.id) ORDER BY a.created_at LIMIT 1`,[plan.id])).rows[0];
    if(!lot)await c.query(`INSERT INTO allocations(code,plan_id,status,created_by,origin,lot_no,workflow_state,remark)
     VALUES('UIUX-PLAN-LOT',$1,'LOCKED',$2,'LEGACY','RMM-CU-2097-97','PREPARED','Synthetic UIUX plan lot') ON CONFLICT(code) DO NOTHING`,[plan.id,actor]);
    for(const [kind,count] of [['draft',1],['multi',2]]){
     const name='Synthetic UIUX '+kind;
     let group=(await c.query('SELECT id FROM loading_plan_groups WHERE name=$1 AND sales_plan_id=$2',[name,plan.id])).rows[0];
     if(!group)group=(await c.query('INSERT INTO loading_plan_groups(name,sales_plan_id,created_by,updated_by,invoice_no) VALUES($1,$2,$3,$3,$4) RETURNING id',[name,plan.id,actor,'UIUX-'+kind])).rows[0];
     for(let n=1;n<=count;n++){
      const invoice='UIUX-'+kind+'-'+n;
      if(!(await c.query('SELECT id FROM loading_plan_documents WHERE group_id=$1 AND vehicle_no=$2',[group.id,'UIUX-'+kind+'-truck-'+n])).rowCount)
       await c.query(`INSERT INTO loading_plan_documents(group_id,created_by,planned_load_date,invoice_no,packing_list_no,vehicle_no,arrival_required,cancelled_at,cancelled_by,cancel_reason)
        VALUES($1,$2,$3,$4,$5,$6,false,CASE WHEN $7::boolean THEN clock_timestamp() END,
         CASE WHEN $7 THEN $2::uuid END,CASE WHEN $7 THEN 'Synthetic legacy locked child' END)`,[group.id,actor,day,invoice,invoice+'-PL','UIUX-'+kind+'-truck-'+n,n>1]);
     }
    }
    await c.query('COMMIT');
   }catch(error){await c.query('ROLLBACK');throw error;}
  });
  await check('bilingual-sales-approval',async()=>{
   const copper=(await c.query("SELECT customer_id,contract_id FROM sales_plans WHERE project_id=$1 AND remark='Synthetic rc2 copper' ORDER BY created_at DESC LIMIT 1",[f.project])).rows[0];
   for(const [product,table,endpoint,plan] of [[CU,'sales_plans','/plans',copper],[CO,'co_sales_plans','/cobalt/sales/plans',coPlan]]){
    for(const language of ['zh-CN','en']){
     const remark='Synthetic UIUX approval '+language+' '+unique;
     if((await c.query('SELECT id FROM '+table+' WHERE project_id=$1 AND remark=$2',[f.project,remark])).rowCount)continue;
     await request('sales_operator',product,endpoint,{project_id:f.project,customer_id:plan.customer_id,contract_id:plan.contract_id,
      target_weight:'25',remark,...(product===CU?{quantity_tolerance:'5',preparation_month:day.slice(0,7)}:
       {shipment_month:day.slice(0,7),planned_vehicle_count:1,status:'OPEN'})});
    }
   }
  });
  const coDispatch=truck_no=>request('logistics_manager',CO,'/cobalt/sales/plans/'+coPlan.id+'/dispatch/vehicles',{
   plan_version:coPlan.version,truck_no,capacity_tonnes:'30',trailer_no:truck_no+'-TR',driver_name:'Synthetic UI '+truck_no,
   passport_no:truck_no+'-P',transporter:'Synthetic UI Carrier'
  });
  await check('co-awaiting-arrival',()=>coDispatch('UIUX-CO-A-'+unique));
  await check('co-draft-loading-plan',async()=>{
   const truck='UIUX-CO-P-'+unique,v=await coDispatch(truck);
   const a=await request('logistics_field_operator',CO,'/cobalt/sales/arrivals/'+v.id,{dispatch_version:v.version,
    arrived_at:new Date().toISOString(),trailer_one:truck+'-TR',driver_name:'Synthetic UI '+truck,passport_no:truck+'-P',
    transporter:'Synthetic UI Carrier',container_no:'',exception_remark:''});
   const q=new URLSearchParams({sales_plan_id:coPlan.id,preparation_id:f.preparation,arrival_id:a.id});
   const pv=await request('admin',CO,'/cobalt/loading/preview?'+q);
   await request('logistics_manager',CO,'/cobalt/loading/plans',{...Object.fromEntries(q),...pv.versions,
    planned_load_date:day,destination:'Synthetic UI Destination',invoice_no:'UIUX-'+unique,export_license_no:'SYNTHETIC'});
  });
  await check('cu-awaiting-arrival',async()=>{
   const p=(await c.query("SELECT id FROM sales_plans WHERE remark='Synthetic rc2 copper' ORDER BY created_at DESC LIMIT 1")).rows[0];
   const book=new(require('exceljs').Workbook)(),sheet=book.addWorksheet('Dispatch');
   sheet.addRows([['Horse','Trailer','Capacity'],['UIUX-CU-'+unique,'UIUX-CU-TR',30]]);
   const body={file_name:'synthetic-uiux-dispatch.xlsx',file_base64:Buffer.from(await book.xlsx.writeBuffer()).toString('base64')};
   const endpoint='/plans/'+p.id+'/dispatch',preview=await request('admin',CU,endpoint+'/import-preview',body);
   await request('admin',CU,endpoint,{...body,preview_sha256:preview.file_sha256});
  });
  return {prepared,blocked};
 }finally{await app?.close();await c.end();}
}

if(require.main===module)seed().then(result=>{console.log(JSON.stringify(result));if(result.blocked.length)process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={seed};
