-- Existing historical orders remain readable/actionable under their recorded version;
-- new preparation must not select the retired V2.6.0 create-and-submit shortcut.
DO $$ DECLARE d text;BEGIN SELECT pg_get_functiondef('v26_submit(uuid,uuid,text,jsonb)'::regprocedure) INTO d;
 d:=replace(d,'BEGIN', $new$BEGIN RAISE EXCEPTION '新备货请使用V2.6.1创建Lot及分阶段作业接口' USING ERRCODE='23514';$new$);EXECUTE d;END $$;
