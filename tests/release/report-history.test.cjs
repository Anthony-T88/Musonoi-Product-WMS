'use strict';

const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const test=require('node:test');
const vm=require('node:vm');
const Excel=require('exceljs');
const Data=require('../../server/report-center-data.cjs');
const Reports=require('../../server/report-center.cjs');

test('historical gaps are explained on screen and in Excel without replacing measured values',async t=>{
 const row={date:'2026-01-02',kind:'INBOUND',document:null,piece:'QA-42',qty:1,net:0,change:0,
  source:'HISTORICAL',pending_fields:{document:'HISTORICAL_NOT_LINKED',net:'HISTORICAL_SOURCE_MISSING'}};
 t.mock.method(Data,'movements',async()=>[row]);
 const client={query:async()=>({rows:[{d:'2026-01-20'}]})};
 for(const en of [false,true]){
  const req={productCode:'CU_CATHODE',user:{language_code:en?'en':'zh-CN',permissions:['inventory:export']}};
  const data=await Reports.report(client,req,{kind:'movement'});
  const saved=data.detail.rows[0];
  assert.equal(saved.document,null);
  assert.equal(saved.pending_fields.document,'HISTORICAL_NOT_LINKED');
  assert.equal(saved.pending_fields.net,undefined);
  assert.equal(saved.net,0);
  assert.equal(data.metrics.find(metric=>metric.key==='inbound_net_mt').value,0);
  const view={window:{},I18n:{language:en?'en':'zh-CN'},esc:value=>String(value)};
  vm.runInNewContext(readFileSync(resolve(__dirname,'../../dist/reports463.js'),'utf8'),view);
  const doc=data.detail.columns.find(col=>col.key==='document');
  const reason=data.pendingLabels.HISTORICAL_NOT_LINKED;
  assert(data.detail.columns.some(col=>col.key==='net'));
  assert(view.window.Reports463.cell(saved,doc,data).includes(reason));
  const workbook=new Excel.Workbook();
  await workbook.xlsx.load(await Reports.workbook(data,req));
  const detail=workbook.getWorksheet(en?'Detail':'明细');
  const column=key=>data.detail.columns.findIndex(col=>col.key===key)+2;
  assert.equal(detail.getRow(7).getCell(column('document')).value,reason);
  assert.equal(detail.getRow(7).getCell(column('net')).value,0);
 }
});
