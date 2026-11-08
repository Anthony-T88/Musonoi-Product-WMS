'use strict';
const {randomUUID}=require('node:crypto');
const unavailable=new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','EPIPE','57P01','57P02','57P03','53300']);
function status(error){return error.statusCode||(unavailable.has(error.code)||/^08[0-9A-Z]{3}$/.test(error.code||'')||/^Connection (terminated|ended)|^timeout exceeded when trying to connect/.test(error.message||'')?503:500);}
function report(error,req,sink=record=>console.error(JSON.stringify(record))){
 const errorId=randomUUID();
 // Deliberately exclude messages, SQL, detail, bodies, URLs, headers and cookies.
 sink({event:'service_error',errorId,requestId:req?.id||null,method:req?.method||null,route:req?.routeOptions?.url||null,code:/^[A-Z0-9_]{2,40}$/.test(error.code||'')?error.code:null,status:status(error)});
 return errorId;
}
module.exports={status,report};
