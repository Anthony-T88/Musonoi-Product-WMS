'use strict';
const B=require('./business-common.cjs');
const Design=require('../dist/overview-design-model.js');
const Text=require('../dist/page-text-model.js');
const path='/api/v1/page-layout';
const values={
 title:['center','left'],section:['center','left'],table:['center','left'],
 density:['standard','compact','roomy'],charts:['side','stack']
};

async function register({app,pool,auth,permitted,csrf}){
 app.get(path,{preHandler:auth},async()=>({items:(await pool.query(
  'SELECT scope,settings,version FROM page_layout_settings ORDER BY scope'
 )).rows}));
 app.patch(path,{preHandler:[permitted('system:manage'),csrf]},req=>B.mutate(pool,req,async c=>{
  if(req.user.role_code!=='admin')throw B.error(403,'仅系统管理员可发布页面排版');
  const {scope,version,settings}=req.body||{};
  if(typeof scope!=='string'||!(/^(global|(?:cu|co):\/[a-z0-9/:-]{1,140})$/.test(scope))||
     !Number.isSafeInteger(version)||version<0||version>=2147483647||
     !settings||typeof settings!=='object'||Array.isArray(settings)||
     Object.entries(settings).some(([k,v])=>k==='overviewDesign'
       ? !['cu:/overview','co:/overview'].includes(scope)||!Design.isValid(v)
       : k==='blockDesign'?scope==='global'||!Design.isValidPage(v)
       : k==='pageText'?scope==='global'||!Text.isValid(v):!Object.hasOwn(values,k)||!values[k].includes(v))){
   throw B.error(400,'页面排版参数无效');
  }
  await c.query('SELECT pg_advisory_xact_lock(21006,hashtext($1))',[scope]);
  const old=(await c.query('SELECT scope,settings,version FROM page_layout_settings WHERE scope=$1',[scope])).rows[0];
  if((old?.version||0)!==version)throw B.error(409,'页面排版已更新，请重新打开排版编辑器');
  const row=(await c.query(
   'INSERT INTO page_layout_settings(scope,settings,version,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(scope) DO UPDATE SET settings=excluded.settings,version=excluded.version,updated_by=excluded.updated_by,updated_at=clock_timestamp() RETURNING scope,settings,version',
   [scope,settings,version+1,req.user.id]
  )).rows[0];
  await B.audit(c,req,'page_layout_published','settings',scope,old||null,row);
  return row;
 }));
}
module.exports={register};
