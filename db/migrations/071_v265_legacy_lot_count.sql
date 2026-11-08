-- Include legacy Lots without a workflow_state; released legacy drafts do not consume quota.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v265_plan_progress(uuid)'::regprocedure) INTO d;
 IF position('a.workflow_state<>''CANCELLED''' in d)=0 THEN RAISE EXCEPTION 'Unexpected Lot count definition';END IF;
 EXECUTE replace(d,'a.workflow_state<>''CANCELLED''','(a.workflow_state IS DISTINCT FROM ''CANCELLED'' AND(a.workflow_state IS NOT NULL OR a.status<>''RELEASED''))');
END $$;
