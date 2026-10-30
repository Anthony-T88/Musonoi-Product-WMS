'use strict';
const {createHash}=require('node:crypto');
const error=(code,message)=>Object.assign(Error(message),{statusCode:code});
function text(value,label,max=160){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw error(400,label+'无效');return value.trim();}
function uuid(v){if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))throw error(400,'标识格式无效');return v;}
function version(v){if(!Number.isInteger(v)||v<1)throw error(400,'必须提供有效版本号');return v;}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw error(400,'日期无效');return v;}
function weight(v){if(typeof v!=='string'||!/^\d{1,8}(\.\d{1,4})?$/.test(v)||!/[1-9]/.test(v)||BigInt(v.split('.')[0])>=100000000n)throw error(400,'净重须为大于零、最多四位小数的吨数文本');return v;}
const canonical=v=>JSON.stringify(v&&typeof v==='object'?(Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))]))):v??null);
async function audit(c,req,action,type,id,before,after){await c.query('INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[req.user.id,action,type,id,before||null,after||null,req.id]);}
async function scope(c,req,project,warehouse=null,customer=null,full=false){uuid(project);const r=await c.query(`SELECT 1 FROM user_scopes WHERE user_id=$1 AND project_id=$2 AND ${full?'warehouse_id IS NULL AND customer_id IS NULL':'(warehouse_id IS NULL OR warehouse_id=$3) AND (customer_id IS NULL OR customer_id=$4)'}` ,full?[req.user.id,project]:[req.user.id,project,warehouse,customer]);if(!r.rowCount)throw error(403,'对象不在授权项目、仓库或客户范围内');}
async function mutate(pool,req,fn){const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[-a-zA-Z0-9_]{8,128}$/.test(key))throw error(400,'必须提供 Idempotency-Key（8–128字符）');
 const route=req.method+' '+req.url.split('?')[0],hash=createHash('sha256').update(canonical(req.body)).digest('hex');const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT v24_revision()');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.user.id+route+key]);const old=(await c.query('SELECT * FROM idempotency_requests WHERE actor_id=$1 AND route=$2 AND key=$3',[req.user.id,route,key])).rows[0];if(old){if(old.request_hash!==hash)throw error(409,'同一幂等键不能用于不同请求内容');await c.query('COMMIT');return old.response;}
 const result=await fn(c);await c.query('INSERT INTO idempotency_requests VALUES($1,$2,$3,$4,$5,now())',[req.user.id,route,key,hash,result]);await c.query('COMMIT');return result;
 }catch(e){await c.query('ROLLBACK');if(['23505','23503','23514','40001','40P01'].includes(e.code))throw error(409,'数据重复、已占用或状态冲突：'+(e.code==='23514'?e.message:'请刷新后重试'));throw e;}finally{c.release();}}
module.exports={error,text,uuid,version,date,weight,audit,scope,mutate};
