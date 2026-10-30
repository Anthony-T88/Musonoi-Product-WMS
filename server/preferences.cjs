'use strict';
const B=require('./business-common.cjs');
module.exports=async({app,pool,auth,csrf})=>{
 app.post('/api/v1/me/language',{preHandler:[auth,csrf]},req=>B.mutate(pool,req,async c=>{const language=req.body?.language;if(!['zh-CN','en'].includes(language))throw B.error(400,'不支持此语言');await c.query('UPDATE users SET language_code=$1 WHERE id=$2',[language,req.user.id]);await B.audit(c,req,'language_preference','users',req.user.id,null,{language});return {language};}));
};
