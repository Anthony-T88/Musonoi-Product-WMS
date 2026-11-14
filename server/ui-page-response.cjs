'use strict';
// A denied HTML route remains HTTP 403. Only the application shell is sent,
// allowing SYS-14 to render; expired sessions receive the login shell.
// Every business/API permission remains enforced.
const systemPermissions=['users:manage','roles:manage','audit:read','printer:manage','master:write','system:manage'];
async function serve(req,reply,{auth,permitted,permission,systemHub,authenticatedView}){
 try{
  if(req.cookies.musonoi_session){
   if(systemHub){await auth(req);if(!systemPermissions.some(p=>req.user.permissions.includes(p)))throw Object.assign(Error('当前账号没有此页面权限'),{statusCode:403});}
   else if(typeof permission==='function')await permission(req);
   else if(permission)await permitted(permission)(req);
   else if(authenticatedView)await auth(req);
  }
  return reply.sendFile('index.html');
 }catch(e){if([401,403].includes(e.statusCode))return reply.code(e.statusCode).type('text/html; charset=utf-8').sendFile('index.html');throw e;}
}
module.exports={serve,systemPermissions};
