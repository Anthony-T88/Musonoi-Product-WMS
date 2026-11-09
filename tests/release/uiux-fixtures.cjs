'use strict';

const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{Client}=require('pg');
const E=require('./environment.cjs'),{CO,CU}=require('./uiux-routes.cjs');

async function seed(){
 const f=E.fixture(),c=new Client(E.options(f.database)),sessions=new Map(),prepared=[],blocked=[];
 let app;
 await c.connect();
 try{
  app=await require('../../server/app.cjs').build({config:f.appCfg});
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
  await check('cu-draft-receipt',()=>request('production_operator',CU,'/receipts',{project_id:f.project,lines:[
   {bundle_no:'MUS-'+day.slice(0,4)+'-098-'+unique,sheets_per_bundle:48,production_date:day,inbound_at:new Date().toISOString()}
  ]}));
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

if(require.main===module)seed().then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={seed};
