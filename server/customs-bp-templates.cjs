'use strict';

const B=require('./business-common.cjs');
const defaults=Object.freeze({
 title:'BULLETIN DE PESAGE / WEIGHTING SHEET',issuer:'RUASHI MINING SAS',
 address:'Musonoi Project site, Kolwezi, Lualaba Province, Democratic Republic of Congo',
 rccm:'',id_nat:'',nif:'',contact:'',loading_point:'RUASHI MINING MUSONOI PLANT',destination:'CHINA'
});
const limits={title:180,issuer:180,address:360,rccm:120,id_nat:120,nif:120,contact:360,loading_point:360,destination:1000};

async function active(c,product){
 const {rows:[record]}=await c.query(`SELECT revision,fields,created_at FROM customs_bp_templates
  WHERE product_code=$1 ORDER BY revision DESC LIMIT 1`,[product]);
 return record||{revision:0,fields:defaults};
}

async function fieldsAt(c,product,revision){
 const {rows:[record]}=await c.query('SELECT fields FROM customs_bp_templates WHERE product_code=$1 AND revision=$2',[product,revision]);
 return record?.fields;
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
