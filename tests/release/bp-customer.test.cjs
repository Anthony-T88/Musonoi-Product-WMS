'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {register}=require('../../server/customs-bp.cjs');

for(const [productCode,base] of [['CU_CATHODE','/api/v1/customs/bp'],['CO_HYDROXIDE','/api/v1/cobalt/customs/bp']]){
 test(productCode+' rejects separate customer IDs at BP selection, print preview and save',async()=>{
  const paths=new Map(),app={get(){},patch(){},route(){},post(url,opts,run){paths.set(url,run);}};
  const ids=[randomUUID(),randomUUID()].sort(),customers=[randomUUID(),randomUUID()],audit=[];
  // Identical rendered names do not make these two source customers interchangeable.
  const project_id=randomUUID();
  const rows=ids.map((id,i)=>({id,code:'LOAD-'+i,project_id,customer_id:customers[i],customer:'Synthetic Customer',
   batch:'LOT-'+i,batch_nos:['LOT-'+i],loading_date:'2026-07-0'+(i+1),truck:'TRUCK-'+i,quantity:1,net_mt:'1.1',gross_mt:'1.2'}));
  const pool={connect:async()=>({release(){},async query(sql){
   audit.push(sql);
   if(sql.includes('eligible WHERE id=ANY'))return {rows};
   if(sql.includes('FROM customs_bp_templates'))return {rows:[]};
   if(sql.includes('FROM customs_bp_agencies'))return {rows:[]};
   if(sql.includes('last_number FROM customs_bp_counters'))return {rows:[{last_number:0,used:[]}]};
   if(/^(BEGIN|COMMIT|ROLLBACK|SELECT (v24_revision|pg_advisory_xact_lock|customs_bp_lock_cu)|SELECT \* FROM idempotency_requests)/.test(sql))return {rows:[]};
   throw Error('Unexpected query in customer guard test');
  }})};
  register({app,pool,permitted:()=>()=>{},csrf:()=>{}});
  const user={id:randomUUID()};
  for(const suffix of ['/preview','/print/preview','']){
   const url=base+suffix;
   await assert.rejects(paths.get(url)({url,user,productCode,method:'POST',headers:{'idempotency-key':randomUUID()},body:{ids}}),
    {message:'BP_CUSTOMER_MISMATCH',statusCode:409});
  }
  assert.equal(audit.filter(sql=>sql==='ROLLBACK').length,3);
  rows[1].customer_id=customers[0];
  const draft=await paths.get(base+'/preview')({user,productCode,body:{ids}});
  assert.equal(draft.header.customer,'Synthetic Customer');
  assert.equal(draft.header.loading_date,'2026-07-02');
  assert.equal(draft.header.destination,'CHINA');
  assert.deepEqual(draft.rows.map(row=>row.id),ids);

  rows[0].claimed=true;
  await assert.rejects(paths.get(base+'/preview')({user,productCode,body:{ids}}),{message:'BP_BATCH_LOCKED',statusCode:409});
 });
}
