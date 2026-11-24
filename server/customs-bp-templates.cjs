'use strict';

const path=require('node:path'),XLSX=require('xlsx'),B=require('./business-common.cjs');
const limits={title:180,issuer:180,address:360,rccm:120,id_nat:120,nif:120,contact:360,loading_point:360,destination:1000};
let defaultFields;

function initialFields(){
 if(defaultFields)return defaultFields;
 // The approved packing workbook carries the same issuer identification as the BP reference.
 const file=path.join(__dirname,'..','templates','packing-list','original.xls');
 const sheet=XLSX.readFile(file,{sheets:'INV'}).Sheets.INV;
 const identification={rccm:['A16','RCCM'],id_nat:['A17','ID-NAT'],nif:['A18','NIF'],contact:['A19','Contact']};
 const official=Object.fromEntries(Object.entries(identification).map(([field,[cell,label]])=>{
  const text=sheet?.[cell]?.v;
  const separator=typeof text==='string'?text.indexOf(':'):-1;
  const value=separator<0?'':text.slice(separator+1).trim();
  if(!value||text.slice(0,separator).trim()!==label||value.length>limits[field])
   throw B.error(500,'BP_TEMPLATE_FIELDS_REQUIRED');
  return [field,value];
 }));
 defaultFields=Object.freeze({
  title:'BULLETIN DE PESAGE / WEIGHTING SHEET',issuer:'RUASHI MINING SAS',
  address:'Musonoi Project site, Kolwezi, Lualaba Province, Democratic Republic of Congo',
  ...official,loading_point:'RUASHI MINING MUSONOI PLANT',destination:'CHINA'
 });
 return defaultFields;
}

function completeFields(fields){
 const missing=Object.keys(limits).filter(key=>typeof fields[key]!=='string'||!fields[key].trim());
 if(!missing.length)return fields;
 const defaults=initialFields();
 return {...fields,...Object.fromEntries(missing.map(key=>[key,defaults[key]]))};
}

async function active(c,product){
 const {rows:[record]}=await c.query(`SELECT revision,fields,created_at FROM customs_bp_templates
  WHERE product_code=$1 ORDER BY revision DESC LIMIT 1`,[product]);
 return record?{...record,fields:completeFields(record.fields)}:{revision:0,fields:initialFields()};
}

async function fieldsAt(c,product,revision){
 if(revision===0)return initialFields();
 const {rows:[record]}=await c.query('SELECT fields FROM customs_bp_templates WHERE product_code=$1 AND revision=$2',[product,revision]);
 return record?completeFields(record.fields):initialFields();
}

async function save(c,req){
 const {revision,fields,...extra}=req.body||{};
 if(Object.keys(extra).length||!Number.isInteger(revision)||revision<0||!fields||typeof fields!=='object'||
   Array.isArray(fields)||Object.keys(fields).some(field=>!Object.hasOwn(limits,field)))throw B.error(400,'BP_INVALID_FIELD');
 const cleaned=Object.fromEntries(Object.entries(limits).map(([field,max])=>{
  const value=fields[field];
  if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\x00-\x1f]/.test(value))throw B.error(400,'BP_TEMPLATE_FIELDS_REQUIRED');
  return [field,value.trim()];
 }));
 await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['customs-bp-template/'+req.productCode]);
 const current=await active(c,req.productCode);
 if(revision!==current.revision)throw B.error(409,'BP_TEMPLATE_CHANGED');
 const {rows:[next]}=await c.query(`INSERT INTO customs_bp_templates(product_code,revision,fields,created_by)
  VALUES($1,$2,$3,$4) RETURNING id,revision,created_at`,[req.productCode,revision+1,cleaned,req.user.id]);
 const audit={product_code:req.productCode};
 await B.audit(c,req,'customs_bp_template_saved','customs_bp_templates',next.id,{...audit,revision},{...audit,revision:next.revision});
 return next;
}

module.exports={active,fieldsAt,save};
