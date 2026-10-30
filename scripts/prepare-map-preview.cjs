// Explicit visual TEST fixture. All new stock goes through existing receipt/lock/load APIs.
// Original historical 128 rows are cloned, never moved or relabelled. No PDF balances imported.
const fs=require('fs'),{Client}=require('pg'),{ownerConfig,migrate}=require('./db.cjs');
(async()=>{
 const file='.runtime/stock-map-preview.json';
 if(fs.existsSync(file)){const {database}=JSON.parse(fs.readFileSync(file));if(!/^musonoi_acceptance_v23_map_visual_\d+$/.test(database))throw Error('Invalid TEST preview');await migrate(database);console.log('Existing isolated visual preview retained.');return;}
 const {setup}=require('../tests/map-helper.cjs'),t=await setup('visual');
 try{const c=t.m.customers[0].id,other=t.m.customers[1].id,loc={};
  for(const code of ['P1-1','P1-2','P2-1','P3-1','P4-1','P5-1'])loc[code]=await t.loc(code);
  for(const [code,customer] of [['P1-1',c],['P1-2',c],['P2-1',c],['P4-1',c],['P5-1',other]]){
   for(let i=1;i<=2;i++)await t.confirm(await t.receipt('MAP-PREVIEW-'+code+'-'+i,loc[code].id,customer));
  }
  for(const code of ['P1-2','P4-1']){const p=await t.plan(c,'MAP-PREVIEW-CONTRACT-'+code);let a=await t.pass('/allocations',t.admin,{plan_id:p.id,bundle_ids:[1,2].map(i=>'MAP-PREVIEW-'+code+'-'+i)});await t.pass('/allocations/'+a.id+'/lock',t.admin,{version:a.version});}
  await t.pass('/samples',t.production,{project_id:t.pid,customer_id:c,sample_date:'2026-10-29',agency:'地图演示测试机构',bundle_ids:[1,2].map(i=>'MAP-PREVIEW-P2-1-'+i)});
  let l=await t.pass('/loads',t.production,{project_id:t.pid,customer_id:c,bundle_ids:[1,2].map(i=>'MAP-PREVIEW-P4-1-'+i),vehicle_no:'MAP-DEMO-TRUCK',carrier:'隔离地图测试运输商',loading_point:'Loading Point 2',loaded_at:new Date().toISOString()});
  await t.pass('/loads/'+l.id+'/complete',t.production,{version:l.version});
  fs.writeFileSync(file,JSON.stringify({database:t.database,environment:'test',fixture:'Explicit synthetic MAP-PREVIEW rows via business APIs; original 128 unchanged'},null,2));
  t.success();console.log('Separate visual TEST preview ready; no existing stock relocated.');
 }finally{await t.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
