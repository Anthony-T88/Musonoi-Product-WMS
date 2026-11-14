
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
const columns='id,kind,value,bank_id,account_name,version';
const predicate='product_code=$1 AND project_id=$2';
const scope=(req,context)=>[req.productCode,context.project_id];
const nameField=account=>account+'_name';

async function project(c,req,id){
 const {rows}=await c.query('SELECT DISTINCT project_id FROM user_scopes WHERE user_id=$1 AND warehouse_id IS NULL AND ($2::uuid IS NULL OR project_id=$2) ORDER BY project_id',[req.user.id,id?B.uuid(id):null]);
 if(!rows.length||!id&&rows.length!==1)throw B.error(400,'请选择有权办理的项目');
 return {project_id:rows[0].project_id};
}

async function list(c,req,context){
 const {rows}=await c.query('SELECT '+columns+' FROM export_license_record_books WHERE '+predicate+' AND archived_at IS NULL ORDER BY kind,value,id',scope(req,context));
 return {items:rows};
}

async function change(c,req,context,id=null){
 const {kind,value,bank_id,account_name,version,project_id,contract_id,...extra}=req.body||{};
 const method=req.method,params=scope(req,context);
 if(Object.keys(extra).length)throw B.error(400,'记录簿参数无效');
 await B.scope(c,req,context.project_id,null,null,true);
 // Serialize bank retirement against edits and registration of its accounts.
 await c.query('SELECT pg_advisory_xact_lock(481192, hashtext($1))',[params.join('/')]);
 let prior;
 if(id){
  prior=(await c.query('SELECT '+columns+' FROM export_license_record_books WHERE '+predicate+' AND id=$3 AND archived_at IS NULL FOR UPDATE',[...params,B.uuid(id)])).rows[0];
  if(!prior)throw B.error(404,'记录簿记录不存在或已删除');
  if(prior.version!==B.version(version))throw B.error(409,'记录簿已更新，请刷新后重试');
 }
 const type=prior?.kind||kind;
 if(!Object.hasOwn(kinds,type))throw B.error(400,'记录簿类型无效');
 const [label,max,bankKind]=kinds[type];
 let next;
 if(method==='DELETE'){
  if(!bankKind&&(await c.query('SELECT 1 FROM export_license_record_books WHERE bank_id=$1 AND archived_at IS NULL LIMIT 1',[id])).rowCount)
   throw B.error(409,'请先删除该银行下的账户记录');
  await c.query('UPDATE export_license_record_books SET archived_at=clock_timestamp(),version=version+1 WHERE id=$1',[id]);
  next={id,kind:type,archived:true};
 }else{
  const text=B.text(value,label,max),name=bankKind&&account_name?B.text(account_name,'账户名',160):'';
  const bank=bankKind?(prior?.bank_id||B.uuid(bank_id)):null;
  if(bankKind){
   const exists=(await c.query('SELECT id FROM export_license_record_books WHERE '+predicate+' AND id=$3 AND kind=$4 AND archived_at IS NULL',[...params,bank,bankKind])).rowCount;
   if(!exists)throw B.error(400,'请选择对应银行');
  }else if(bank_id||account_name)throw B.error(400,'此记录簿无需关联银行账户');
  if(prior){
   next=(await c.query('UPDATE export_license_record_books SET value=$2,account_name=$3,version=version+1 WHERE id=$1 RETURNING '+columns,[id,text,name])).rows[0];
  }else{
   next=(await c.query('INSERT INTO export_license_record_books(product_code,project_id,kind,value,bank_id,account_name,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING '+columns,[...params,type,text,bank,name,req.user.id])).rows[0];
   if(!next)throw B.error(409,'记录簿已存在相同记录');
  }
 }
 const summary=v=>v&&{project_id:context.project_id,product_code:req.productCode,kind:v.kind,bank_id:v.bank_id,version:v.version,archived:v.archived};
 await B.audit(c,req,'export_license_book_record_'+({POST:'created',PATCH:'updated',DELETE:'archived'}[method]),'export_license_record_books',next.id,summary(prior),summary(next));
 return next;
}

async function selections(c,req,context,body,previous={},replay=false){
 const changes=body.processing_records;
 if(changes!==undefined&&(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).some(key=>!Object.hasOwn(kinds,key))))throw B.error(400,'办证资料选择无效');
 const ids={...previous.processing_records},values={};
 const requested=Object.entries(changes||{}).filter(([,id])=>id!==null).map(([,id])=>B.uuid(id));
 const rows=requested.length?(await c.query('SELECT '+columns+' FROM export_license_record_books WHERE '+predicate+' AND id=ANY($3::uuid[])'+(replay?'':' AND archived_at IS NULL')+' FOR SHARE',[...scope(req,context),requested])).rows:[];
 const indexed=new Map(rows.map(record=>[record.id,record]));
 for(const field of fields){
  const bankKind=kinds[field][2];
  if(Object.hasOwn(changes||{},field)){
   const id=changes[field];
   if(id===null){delete ids[field];values[field]='';if(bankKind)values[nameField(field)]='';continue;}
   const item=indexed.get(id.toLowerCase());
   if(!item||item.kind!==field)throw B.error(400,'所选办证资料已删除或不属于当前字段、产品及项目');
   ids[field]=item.id;
   values[field]=item.value;
   if(bankKind)values[nameField(field)]=item.account_name;
  }else if(Object.hasOwn(body,field)&&!bankKind&&field!=='offshore_bank'){
   const value=body[field]?B.text(body[field],kinds[field][0],kinds[field][1]):'';
   if(value!==(previous[field]||'')){delete ids[field];values[field]=value;}
  }
 }
 for(const account of ['issuing_bank_account','offshore_bank_account']){
  const parent=kinds[account][2];
  if(Object.hasOwn(changes||{},account)&&changes[account]!==null&&indexed.get(ids[account]).bank_id!==ids[parent])throw B.error(400,'所选账户与银行不匹配');
  if(Object.hasOwn(values,parent)&&!Object.hasOwn(changes||{},account)&&((previous[parent]||'')!==values[parent]||previous.processing_records?.[parent]!==ids[parent])){
   delete ids[account];
   values[account]='';
   values[nameField(account)]='';
  }
 }
 return Object.keys(values).length?{...values,processing_records:ids}:values;
}

function auditSnapshot(values){
 if(!values)return values;
 const {issuing_bank_account,issuing_bank_account_name,offshore_bank_account,offshore_bank_account_name,...safe}=values;
 return safe;
}

module.exports={project,list,change,selections,auditSnapshot};
