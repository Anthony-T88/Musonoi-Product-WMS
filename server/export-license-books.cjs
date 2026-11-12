'use strict';

const B=require('./business-common.cjs');
const kinds={
 clearing_agent:['开证清关公司',160],
 issuing_bank:['开证银行',160],
 issuing_bank_account:['开证银行账户号',160,'issuing_bank'],
 offshore_bank:['离岸银行',160],
 offshore_bank_account:['离岸银行账户号',160,'offshore_bank'],
 destination:['目的地',320],
 note:['备注',1000]
};
const fields=Object.keys(kinds);
const scope=(req,context)=>[req.productCode,context.project_id,context.customer_id];
const predicate='product_code=$1 AND project_id=$2 AND customer_id=$3';
const columns='id,kind,value,bank_id';

async function list(c,req,context){
 const {rows}=await c.query('SELECT '+columns+' FROM export_license_record_books WHERE '+predicate+' ORDER BY kind,value,id',scope(req,context));
 return {items:rows};
}

async function create(c,req,context){
 const {kind,value,bank_id,contract_id,...extra}=req.body||{};
 if(Object.keys(extra).length||!Object.hasOwn(kinds,kind))throw B.error(400,'记录簿参数无效');
 const [label,max,bankKind]=kinds[kind],text=B.text(value,label,max),bank=bankKind?B.uuid(bank_id):null,params=scope(req,context);
 if(bankKind){
  const result=await c.query('SELECT id FROM export_license_record_books WHERE '+predicate+' AND id=$4 AND kind=$5',[...params,bank,bankKind]);
  if(!result.rowCount)throw B.error(400,'请选择当前产品及客户的对应银行');
 }else if(bank_id)throw B.error(400,'此记录簿无需关联银行');
 const args=[...params,kind,text,bank,req.user.id];
 const {rows:[added]}=await c.query('INSERT INTO export_license_record_books(product_code,project_id,customer_id,kind,value,bank_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING '+columns,args);
 if(!added){
  const {rows:[existing]}=await c.query('SELECT '+columns+' FROM export_license_record_books WHERE '+predicate+' AND kind=$4 AND md5(value)=md5($5) AND value=$5 AND bank_id IS NOT DISTINCT FROM $6::uuid',args.slice(0,6));
  if(!existing)throw B.error(409,'记录簿发生冲突，请刷新后重试');
  return existing;
 }
 await B.audit(c,req,'export_license_book_record_created','export_license_record_books',added.id,null,{
  project_id:context.project_id,customer_id:context.customer_id,product_code:req.productCode,kind,bank_id:bank
 });
 return added;
}

async function selections(c,req,context,body,previous={}){
 const changes=body.processing_records;
 if(changes!==undefined&&(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(key=>!Object.hasOwn(kinds,key))))throw B.error(400,'办证资料选择无效');
 const ids={...previous.processing_records},values={};
 const requested=Object.entries(changes||{}).filter(([,id])=>id!==null).map(([,id])=>B.uuid(id));
 const records=requested.length?(await c.query('SELECT '+columns+' FROM export_license_record_books WHERE '+predicate+' AND id=ANY($4::uuid[])',[...scope(req,context),requested])).rows:[];
 const indexed=new Map(records.map(record=>[record.id,record]));
 for(const field of fields){
  if(Object.hasOwn(changes||{},field)){
   const id=changes[field];
   if(id===null){delete ids[field];values[field]='';continue;}
   const item=indexed.get(id.toLowerCase());
   if(!item||item.kind!==field)throw B.error(400,'所选办证资料不属于当前字段、产品或客户');
   ids[field]=item.id;
   values[field]=item.value;
  }else if(Object.hasOwn(body,field)&&!kinds[field][2]&&field!=='offshore_bank'){
   const value=body[field]?B.text(body[field],kinds[field][0],kinds[field][1]):'';
   if(value!==(previous[field]||'')){delete ids[field];values[field]=value;}
  }
 }
 for(const account of ['issuing_bank_account','offshore_bank_account']){
  const parent=kinds[account][2];
  if(Object.hasOwn(changes||{},account)&&changes[account]!==null&&indexed.get(ids[account]).bank_id!==ids[parent])throw B.error(400,'所选账户号与银行不匹配');
  if(Object.hasOwn(values,parent)&&!Object.hasOwn(changes||{},account)&&((previous[parent]||'')!==values[parent]||previous.processing_records?.[parent]!==ids[parent])){
   delete ids[account];
   values[account]='';
  }
 }
 return Object.keys(values).length?{...values,processing_records:ids}:values;
}

function auditSnapshot(values){
 if(!values)return values;
 const {issuing_bank_account,offshore_bank_account,...safe}=values;
 return safe;
}

module.exports={list,create,selections,auditSnapshot};
