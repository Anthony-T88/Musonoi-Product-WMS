-- Unknown-weight quantity loss is not a measured zero-weight loss.
DO $$ DECLARE c record;BEGIN
 FOR c IN SELECT conname,pg_get_expr(conbin,conrelid) expression FROM pg_constraint WHERE conrelid='inventory_events'::regclass AND contype='c' AND pg_get_expr(conbin,conrelid) LIKE '%physical_delta%' LOOP
 EXECUTE format('ALTER TABLE inventory_events DROP CONSTRAINT %I',c.conname);
 EXECUTE format('ALTER TABLE inventory_events ADD CONSTRAINT %I CHECK((NOT weight_known AND event_type IN(''ADJUST_LOSS'',''ADJUST_LOCATION'') AND physical_delta=0) OR(%s))',c.conname,c.expression);
 END LOOP;
END $$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION v23_immutable();
