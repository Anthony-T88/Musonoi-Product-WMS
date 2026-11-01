-- Final posting deactivates loading_items; completed records still fulfil their original plan.
DO $$ DECLARE d text;BEGIN
 SELECT pg_get_functiondef('v265_plan_progress(uuid)'::regprocedure) INTO d;
 IF position('AND li.active AND lo.workflow_state' in d)=0 THEN RAISE EXCEPTION 'Unexpected progress definition';END IF;
 EXECUTE replace(d,'AND li.active AND lo.workflow_state','AND lo.workflow_state');
END $$;
