'use strict';

const {isIP}=require('node:net');

const sink=event=>console.log(JSON.stringify(event));
const safeCode=code=>/^[A-Z0-9_]{2,60}$/.test(code||'')?code:null;
function monitor(req,reply,report=sink){
 const route=req.routeOptions?.url;
 const status=reply.statusCode;
 if(!route?.startsWith('/api/v1/')&&status<400)return;
 const elapsed=Number(reply.elapsedTime);
 const event={event:'wms_http',time:new Date().toISOString(),request_id:req.id,
  route:route?.startsWith('/api/v1/')?route:null,method:req.method,status,
  duration_ms:Number.isFinite(elapsed)?Math.round(elapsed):null,
  actor_id:req.user?.id??null,source_ip:isIP(req.ip)?req.ip:null,code:safeCode(req.auditErrorCode),
  ...(req.serviceErrorId?{error_id:req.serviceErrorId}:{})};
 // Request bodies, URLs, credentials, raw errors and headers never enter this sink.
 try{report(event);}catch{process.stderr.write('WMS_REQUEST_AUDIT_SINK_FAILED\n');}
}
module.exports={monitor,safeCode};
