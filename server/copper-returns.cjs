'use strict';

const applied=loadingId=>`EXISTS(SELECT 1 FROM outbound_corrections cr WHERE cr.loading_id=${loadingId}
 AND cr.kind='RETURN_OUTBOUND' AND cr.status='APPLIED')`;

module.exports={applied};
