\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT set_config('musonoi.cleanup_receipt_code', :'receipt_code', true) AS cleanup_target \gset

DO $$
DECLARE
 target receipts;
 code_to_remove text := current_setting('musonoi.cleanup_receipt_code');
 snapshot jsonb;
BEGIN
 IF current_database() <> 'musonoi_preproduction_test'
    AND current_database() !~ '^musonoi_audit_[0-9a-f]{10}_test$' THEN
  RAISE EXCEPTION 'TEST database required';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM system_info WHERE singleton AND environment='test')
    OR code_to_remove !~ '^IN-[0-9]{8}-[0-9]+$' THEN
  RAISE EXCEPTION 'TEST database and exact receipt code required';
 END IF;

 -- Keep the named history triggers enabled except during this transaction.
 PERFORM pg_advisory_xact_lock(477189);
 LOCK TABLE receipts, receipt_lines IN ACCESS EXCLUSIVE MODE;
 SELECT * INTO target FROM receipts WHERE code=code_to_remove;
 IF NOT FOUND THEN
  RAISE NOTICE 'TEST_RECEIPT_ALREADY_ABSENT %', code_to_remove;
  RETURN;
 END IF;
 IF target.status NOT IN ('DRAFT','PENDING','REJECTED') OR target.confirmed_at IS NOT NULL
    OR EXISTS (SELECT 1 FROM inventory_events WHERE receipt_id=target.id)
    OR EXISTS (SELECT 1 FROM bundles b WHERE b.receipt_id=target.id OR b.receipt_line_id IN
      (SELECT id FROM receipt_lines WHERE receipt_id=target.id)) THEN
  RAISE EXCEPTION 'TEST_RECEIPT_POSTED_OR_LINKED %', code_to_remove;
 END IF;
 IF EXISTS (SELECT 1 FROM bundle_number_registry WHERE owner_id=target.id AND conflicted) THEN
  RAISE EXCEPTION 'TEST_RECEIPT_IDENTITY_CONFLICT %', code_to_remove;
 END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgenabled='O'
     AND ((tgrelid='receipts'::regclass AND tgname='receipt_history')
       OR (tgrelid='receipt_lines'::regclass AND tgname='receipt_line_history'))) <> 2 THEN
  RAISE EXCEPTION 'TEST_RECEIPT_HISTORY_GUARDS_UNEXPECTED';
 END IF;

 SELECT jsonb_build_object('receipt', to_jsonb(target), 'project_id', target.project_id,
  'lines', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY line_no) FROM receipt_lines l WHERE receipt_id=target.id),'[]'),
  'number_claims', coalesce((SELECT jsonb_agg(to_jsonb(n) ORDER BY number_key) FROM bundle_number_registry n WHERE owner_id=target.id),'[]'))
 INTO snapshot;
 ALTER TABLE receipt_lines DISABLE TRIGGER receipt_line_history;
 ALTER TABLE receipts DISABLE TRIGGER receipt_history;
 DELETE FROM receipt_lines WHERE receipt_id=target.id;
 DELETE FROM receipts WHERE id=target.id;
 DELETE FROM bundle_number_registry WHERE owner_id=target.id;
 ALTER TABLE receipts ENABLE TRIGGER receipt_history;
 ALTER TABLE receipt_lines ENABLE TRIGGER receipt_line_history;
 INSERT INTO audit_logs(action,entity_type,entity_id,before_data,after_data)
 VALUES('test_receipt_removed','receipts',target.id,snapshot,
  jsonb_build_object('code',target.code,'executed_as',current_user));
 RAISE NOTICE 'TEST_RECEIPT_REMOVED %', code_to_remove;
END $$;
COMMIT;
