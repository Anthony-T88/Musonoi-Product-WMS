'use strict';
// The snapshot owns validity at its revision; reservation ownership never changes.
// Do not test today's released_at when answering a historical dashboard query.
async function count(c,states){const ids=[...new Set(states.filter(s=>s.physical_status==='IN_STOCK'&&s.reservation_id&&s.lot_workflow_state!=='CANCELLED').map(s=>s.reservation_id))];if(!ids.length)return 0;return Number((await c.query('SELECT count(DISTINCT allocation_id)::int n FROM reservations WHERE id=ANY($1::uuid[])',[ids])).rows[0].n);}
module.exports={count};
