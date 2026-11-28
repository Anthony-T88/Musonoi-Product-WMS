'use strict';
const C=require('./control-common.cjs');
const can=(req,permission)=>req.user.permissions.includes(permission);

async function read(c,req,doc,recovery){
 if(req.productCode!=='CU_CATHODE'||!recovery) return null;
 const {rows:[scope]}=await c.query('SELECT copper_return_recheck_scope($1,$2) allowed',[req.user.id,doc.id]);
 if(!scope.allowed)return null;
 const {rows:requests}=await c.query(`SELECT r.id,r.evidence,r.measurements,r.requested_at,r.reason,r.requested_by,
  author.display_name requester,v.reviewed_at,v.reason review_reason,reviewer.display_name reviewer,
  coalesce(v.decision,'PENDING') state
  FROM copper_return_prechecks r JOIN users author ON author.id=r.requested_by
  LEFT JOIN copper_return_precheck_reviews v ON v.recheck_id=r.id LEFT JOIN users reviewer ON reviewer.id=v.reviewed_by
  WHERE r.correction_id=$1 ORDER BY r.requested_at DESC,r.id`,[doc.id]);
 const pending=requests.find(row=>row.state==='PENDING');
 let current=null;
 if(recovery.blocker==='RETURNED_STOCK_CHANGED'&&(pending||can(req,'load:review'))){
  const {rows:[row]}=await c.query(`WITH details AS MATERIALIZED (SELECT copper_return_recheck_evidence($1) evidence)
   SELECT evidence,encode(sha256(convert_to(evidence::text,'UTF8')),'hex') token,
    evidence IS NOT NULL AND evidence=$2::jsonb AS matches FROM details`,[doc.id,pending?.evidence||null]);
  current=row;
 }
 const canRequest=!pending&&!!current?.evidence&&can(req,'load:review');
 return {requests,offer:canRequest?{evidence:current.evidence,token:current.token}:null,
  can_review:!!pending&&can(req,'outbound:approve')&&(pending.requested_by!==req.user.id||C.canSelfReview(req)),
  evidence_current:!!current?.matches};
}

function measurements(body){
 const rows=body.measurements;
 if(body.confirmed!==true||!rows||typeof rows!=='object'||Array.isArray(rows)||Object.keys(rows).length>500)
  throw C.error(400,'V27_RETURN_RECHECK_MEASUREMENTS');
 return Object.fromEntries(Object.entries(rows).map(([id,row])=>{
  const weight=row?.net_weight,location=row?.location_code;
  if(typeof weight!=='string'||!/^\d{1,8}(\.\d{1,6})?$/.test(weight)||typeof location!=='string'||!location.trim()||location.length>160)
   throw C.error(400,'V27_RETURN_RECHECK_MEASUREMENTS');
  return [C.uuid(id),{location_code:location.trim(),net_weight:weight}];
 }));
}

function register(app,pool,permitted,csrf,access){
 for(const review of [false,true]){
  const route='/api/v1/v27/corrections/:id/preparation-rechecks'+(review?'/:recheck/review':'');
  app.post(route,{preHandler:[permitted('load:read'),permitted(review?'outbound:approve':'load:review'),csrf]},req=>C.mutate(pool,req,async c=>{
   if(req.productCode!=='CU_CATHODE')throw C.error(409,'V27_CORRECTION_STATE_CONFLICT');
   const doc=await access(c,req,req.params.id),b=req.body||{},reason=C.text(b.reason,'核验或审批依据',2000);
   const params=[req.user.id,doc.id,C.version(b.version)];
   try{
    if(review){
     if(!['APPROVED','REJECTED'].includes(b.decision)||b.decision==='APPROVED'&&b.confirmed!==true)
      throw C.error(400,'V27_RETURN_RECHECK_MEASUREMENTS');
     const {rows:[row]}=await c.query('SELECT copper_return_review_recheck($1,$2,$3,$4,$5,$6,$7) result',
      [...params,C.uuid(req.params.recheck),b.decision,reason,b.confirmed===true]);
     return row.result;
    }
    if(typeof b.token!=='string'||!/^[a-f0-9]{64}$/.test(b.token))throw C.error(400,'V27_RETURN_RECHECK_STALE');
    const {rows:[row]}=await c.query('SELECT copper_return_request_recheck($1,$2,$3,$4,$5,$6,$7) recheck_id',
     [...params,reason,b.token,b.confirmed===true,measurements(b)]);
    return {...row,state:'PENDING'};
   }catch(e){
    if(e.message==='V27_RETURN_RECHECK_SCOPE')throw C.error(403,e.message);
    if(e.message==='V27_INDEPENDENT_CORRECTION_REVIEWER_REQUIRED')throw C.error(403,e.message);
    throw e;
   }
  }));
 }
}

async function pending(c,req){
 if(!can(req,'load:read')||!can(req,'outbound:approve'))return [];
 const {rows}=await c.query(`SELECT r.id,q.id correction_id,q.loading_id,l.project_id,l.customer_id,
  cust.name customer_name,u.display_name initiator_name,r.requested_at created_at,
  (SELECT string_agg(j->>'lot_no',' / ' ORDER BY j->>'lot_no') FROM jsonb_array_elements(r.evidence->'originals') j) document_no
  FROM copper_return_prechecks r JOIN outbound_corrections q ON q.id=r.correction_id JOIN loading_orders l ON l.id=q.loading_id
  JOIN copper_customers cust ON cust.id=l.customer_id JOIN users u ON u.id=r.requested_by
  LEFT JOIN copper_return_precheck_reviews v ON v.recheck_id=r.id
  WHERE v.recheck_id IS NULL AND (r.requested_by<>$1 OR $2) AND copper_return_recheck_scope($1,q.id)
  ORDER BY r.requested_at,r.id`,[req.user.id,C.canSelfReview(req)]);
 return rows.map(row=>({...row,doc_type:'LOAD',kind:'RETURN_PREPARATION_REVIEW',status:'PENDING',
  href:'/outbounds/loads/'+row.loading_id+'?correction='+row.correction_id}));
}

module.exports={read,register,pending};
