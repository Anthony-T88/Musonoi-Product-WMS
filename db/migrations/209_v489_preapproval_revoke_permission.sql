-- Reserve the cancellation grant for releases from the checked preapproval
-- operation in the same transaction. Other reservation paths keep their grants.
DO $$
DECLARE
 revoke_def text:=pg_get_functiondef('v262_preapproval_action(uuid,uuid,integer,text,jsonb)'::regprocedure);
 guard_def text:=pg_get_functiondef('reservation_guard()'::regprocedure);
 stamp_needle text:='cancellation_observation=payload,released_at=';
 permission_needle text:='THEN ''lot:reverse-review'' ELSE ''allocation:write'' END,';
BEGIN
 IF strpos(revoke_def,stamp_needle)=0 OR strpos(guard_def,permission_needle)=0 THEN
  RAISE EXCEPTION 'Expected copper preapproval reservation protection';
 END IF;
 EXECUTE replace(revoke_def,stamp_needle,$stamp$
  cancellation_observation=payload||jsonb_build_object('preapproval_revoke_txid',txid_current()),released_at=$stamp$);
 EXECUTE replace(guard_def,permission_needle,$grant$
  THEN 'lot:reverse-review'
  WHEN current_user='musonoi_owner' AND a.cancellation_observation->>'preapproval_revoke_txid'=txid_current()::text
  THEN 'lot:revoke'
  ELSE 'allocation:write' END,$grant$);
END $$;
