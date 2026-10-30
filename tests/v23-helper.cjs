process.env.V22_TEMPLATE_DATABASE=process.env.V22_TEMPLATE_DATABASE||'musonoi_v23_regression_test';
const {setup:base}=require('./v22-helper.cjs'),{hashPassword}=require('../server/security.cjs'),{randomBytes}=require('node:crypto');
async function setup(stage){const t=await base('v23_'+stage);async function actor(role,name=role){const password=randomBytes(18).toString('hex'),username='v23_'+name;const id=(await t.c.query('INSERT INTO users(username,display_name,password_hash,role_code) VALUES($1,$2,$3,$4) RETURNING id',[username,name,hashPassword(password),role])).rows[0].id;await t.c.query('INSERT INTO user_scopes(user_id,project_id) VALUES($1,$2)',[id,t.pid]);const r=await t.request('/auth/login',null,'POST',{username,password});t.assert.equal(r.statusCode,200,r.body);return {cookie:r.headers['set-cookie'].split(';')[0],csrf:r.json().csrfToken,user:(await t.request('/me',{cookie:r.headers['set-cookie'].split(';')[0],csrf:r.json().csrfToken})).json()};}
 t.production=await actor('production');t.commerce=await actor('commerce');t.security=await actor('security');t.supervisor2=await actor('supervisor','supervisor2');t.actor=actor;
 t.pass=async(url,s=t.admin,body={},key)=>{const r=await t.request(url,s,'POST',body,key);t.assert.equal(r.statusCode,200,r.body);return r.json();};
 t.stock=async()=> (await t.c.query("SELECT coalesce(sum(net_weight),0)::text AS w FROM bundles WHERE physical_status='IN_STOCK'")).rows[0].w;
 const rows=(await t.c.query("SELECT b.*,l.warehouse_id FROM bundles b JOIN locations l ON l.id=b.location_id WHERE physical_status='IN_STOCK' ORDER BY b.bundle_no LIMIT 4")).rows;t.rows=rows;t.customer=rows[0].customer_id;
 return t;}
module.exports={setup};
