process.env.V22_TEMPLATE_DATABASE='musonoi_v26_regression_test';
const {setup}=require('./v23-helper.cjs'),ExcelJS=require('exceljs');
(async()=>{const t=await setup('v26_import');try{
 const op=await t.actor('operator');const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('生产入库');ws.addRow(['捆包编号','生产日期','入库时间（含时区）','备注']);ws.addRow(['MUS-2026-001-1','2026-10-01','2026-10-28T08:00:00+02:00','TEST import']);
 let r=await t.request('/v26/receipts/template',op);t.ok(r.statusCode===200,'download template');
 const counts=async()=>JSON.stringify((await t.c.query("SELECT (SELECT count(*) FROM bundles) bundles,(SELECT count(*) FROM receipts) receipts,(SELECT count(*) FROM batches) batches,(SELECT count(*) FROM customers) customers,(SELECT count(*) FROM locations) locations")).rows[0]);const before=await counts();
 r=await t.request('/v26/receipts/import-preview',op,'POST',{project_id:t.pid,file_base64:Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')});t.assert.equal(r.statusCode,200,r.body);t.ok(r.json().valid&&r.json().lines[0].gross_weight===undefined,'weightless XLSX preview');t.ok(await counts()===before,'preview creates no business or master data');
 let d=await t.pass('/receipts',op,{project_id:t.pid,origin:'EXCEL',lines:r.json().lines});d=await t.pass('/receipts/'+d.id+'/submit',op,{version:d.version});await t.pass('/receipts/'+d.id+'/confirm',t.reviewer,{version:d.version});
 t.ok((await t.c.query("SELECT net_weight FROM bundles WHERE bundle_no='MUS-2026-001-1'")).rows[0].net_weight===null,'imported intake stays unweighed');
 ws.getCell(2,1).value={formula:'1+1'};r=await t.request('/v26/receipts/import-preview',op,'POST',{project_id:t.pid,file_base64:Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')});t.ok(r.statusCode===400,'formulas rejected');
 const key='v26-network-context';await t.pass('/v26/production-context',op,{project_id:t.pid},key);r=await t.request('/operations/status?'+new URLSearchParams({key,path:'/v26/production-context',method:'POST'}),op);t.ok(r.statusCode===200&&r.json().committed,'network receipt supports V26 paths');
 const exportR=await t.request('/inventory/exports',t.admin,'POST',{format:'csv',filters:{search:'MUS-2026-001-1'}});t.ok(exportR.statusCode===200&&exportR.body.includes('未检斤')&&!exportR.body.includes('"null"'),'CSV unknown weights explicit');
 r=await t.request('/v26/summary',op);t.ok(r.json().unweighed_bundles===1,'unknown weight counted separately');t.success();
}finally{await t.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
