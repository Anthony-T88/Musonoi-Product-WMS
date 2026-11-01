-- Extend the existing authorized correction path to each selected bundle's own lot.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v31_save_load(uuid,uuid,int,uuid,int,uuid[],text)'::regprocedure) INTO d;
 d:=replace(d,'d.workflow_state IN(''CANCELLED'',''UNLOADED'')','(lp IS NOT NULL AND(d.status=''CANCELLED'' OR d.workflow_state IN(''CANCELLED'',''UNLOADED'')))');EXECUTE d;
 SELECT pg_get_functiondef('v27_correction_create(uuid,uuid,int,text,text,jsonb)'::regprocedure) INTO d;d:=replace(d,'WHERE i.loading_id=loadid','WHERE i.loading_id=loadid AND NOT i.plan_removed');EXECUTE d;
 SELECT pg_get_functiondef('v27_correction_action(uuid,uuid,int,text,text)'::regprocedure) INTO d;
 d:=replace(d,'allocation_id<>l.allocation_id','id<>i.reservation_id');
 d:=replace(d,'WHERE a.id=l.allocation_id AND p.status<>''OPEN''','WHERE (a.id=l.allocation_id OR a.id IN(SELECT allocation_id FROM loading_order_lots WHERE loading_id=l.id)) AND p.status<>''OPEN''');
 d:=replace(d,'PERFORM v262_sync_claims();',$patch$
 IF q.kind='CANCEL_LOAD' THEN
 UPDATE allocations aa SET status=CASE WHEN EXISTS(SELECT 1 FROM loading_items li JOIN reservations rr ON rr.id=li.reservation_id JOIN loading_orders lo ON lo.id=li.loading_id WHERE rr.allocation_id=aa.id AND NOT li.plan_removed AND lo.workflow_state='OUTBOUND') THEN 'FULFILLED' ELSE 'RELEASED' END,workflow_state=CASE WHEN EXISTS(SELECT 1 FROM loading_items li JOIN reservations rr ON rr.id=li.reservation_id JOIN loading_orders lo ON lo.id=li.loading_id WHERE rr.allocation_id=aa.id AND NOT li.plan_removed AND lo.workflow_state='OUTBOUND') THEN 'FULFILLED' ELSE 'CANCELLED' END,version=version+1 WHERE aa.id IN(SELECT allocation_id FROM loading_order_lots WHERE loading_id=l.id AND allocation_id<>l.allocation_id) AND NOT EXISTS(SELECT 1 FROM reservations rr WHERE rr.allocation_id=aa.id AND rr.released_at IS NULL);
 END IF;PERFORM v262_sync_claims();$patch$);EXECUTE d;
END $$;
