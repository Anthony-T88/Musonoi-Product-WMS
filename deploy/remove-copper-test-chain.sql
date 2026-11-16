\set ON_ERROR_STOP on
\if :{?apply}
\else
\set apply false
\endif

BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET CONSTRAINTS ALL IMMEDIATE;
SELECT set_config('musonoi.cleanup_receipt_code', :'receipt_code', true),
       set_config('musonoi.cleanup_receipt_day', :'receipt_day', true),
       set_config('musonoi.cleanup_expected_units', :'expected_units', true),
       set_config('musonoi.cleanup_load_code', :'load_code', true),
       set_config('musonoi.cleanup_expected_loaded', :'expected_loaded', true) \gset

DO $$
DECLARE
 target receipts;
 code_to_remove text := current_setting('musonoi.cleanup_receipt_code');
 receipt_day date := current_setting('musonoi.cleanup_receipt_day')::date;
 expected_units integer := current_setting('musonoi.cleanup_expected_units')::integer;
 target_load_code text := current_setting('musonoi.cleanup_load_code');
 expected_loaded integer := current_setting('musonoi.cleanup_expected_loaded')::integer;
 affected_triggers jsonb;
 trigger_info record;
 snapshot jsonb;
BEGIN
 IF current_database() <> 'musonoi_preproduction_test'
    AND current_database() !~ '^musonoi_audit_[0-9a-f]{10}_test$' THEN
  RAISE EXCEPTION 'TEST database required';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM system_info WHERE singleton AND environment='test')
    OR code_to_remove !~ '^IN-[0-9]{8}-[0-9]+$' OR target_load_code !~ '^LOAD-[0-9]{8}-[0-9]+$'
    OR expected_loaded<1 OR expected_loaded>expected_units THEN
  RAISE EXCEPTION 'TEST database, exact receipt and loading codes, and expected counts required';
 END IF;

 -- Existing stock and historical identity lock order. SQL constraints remain active.
 PERFORM pg_advisory_xact_lock(24000);
 PERFORM pg_advisory_xact_lock(477189);
 LOCK TABLE receipts, receipt_lines, loading_orders, loading_items, allocations, allocation_items,
  reservations, bundles, loading_plan_groups, loading_plan_documents, loading_plan_matches, loading_plan_lots,
  preparation_plans IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO target FROM receipts WHERE code=code_to_remove;
 IF NOT FOUND THEN
  RAISE NOTICE 'TEST_RECEIPT_ALREADY_ABSENT %',code_to_remove;
  RETURN;
 END IF;
 IF target.status<>'CONFIRMED' OR (target.created_at AT TIME ZONE 'Africa/Lubumbashi')::date<>receipt_day
    OR (SELECT count(*) FROM receipt_lines WHERE receipt_id=target.id)<>expected_units THEN
  RAISE EXCEPTION 'TEST_RECEIPT_IDENTITY_CHANGED %',code_to_remove;
 END IF;

 CREATE TEMP TABLE purge_units ON COMMIT DROP AS SELECT id,bundle_no,receipt_line_id FROM bundles WHERE receipt_id=target.id;
 IF (SELECT count(*) FROM purge_units)<>expected_units OR EXISTS (
   SELECT 1 FROM purge_units b LEFT JOIN receipt_lines l ON l.id=b.receipt_line_id AND l.receipt_id=target.id
   WHERE l.id IS NULL OR b.bundle_no<>l.bundle_no) THEN
  RAISE EXCEPTION 'TEST_RECEIPT_UNIT_LINK_CHANGED';
 END IF;
 CREATE TEMP TABLE purge_loads ON COMMIT DROP AS
  SELECT l.id,l.code,l.allocation_id FROM loading_orders l WHERE EXISTS (
   SELECT 1 FROM loading_items i JOIN purge_units b ON b.id=i.bundle_id WHERE i.loading_id=l.id);
 IF (SELECT count(*) FROM purge_loads)<>1 OR NOT EXISTS(SELECT 1 FROM purge_loads WHERE code=target_load_code)
    OR (SELECT count(*) FROM loading_items WHERE loading_id IN (SELECT id FROM purge_loads))<>expected_loaded
    OR EXISTS(SELECT 1 FROM loading_items i JOIN purge_loads l ON i.loading_id=l.id WHERE i.bundle_id NOT IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM loading_orders WHERE replaces_id IN (SELECT id FROM purge_loads)
       OR (id IN (SELECT id FROM purge_loads) AND replaces_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'TEST_RECEIPT_LOADING_CHAIN_CHANGED_OR_SHARED';
 END IF;

 CREATE TEMP TABLE purge_allocations ON COMMIT DROP AS
  SELECT allocation_id AS id FROM allocation_items WHERE bundle_id IN (SELECT id FROM purge_units)
  UNION SELECT allocation_id FROM reservations WHERE bundle_id IN (SELECT id FROM purge_units);
 IF EXISTS(SELECT 1 FROM purge_allocations p JOIN allocation_items i ON i.allocation_id=p.id WHERE i.bundle_id NOT IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM purge_allocations p JOIN reservations i ON i.allocation_id=p.id WHERE i.bundle_id NOT IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM purge_allocations p JOIN lot_bundle_releases i ON i.allocation_id=p.id WHERE i.bundle_id NOT IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM purge_allocations p JOIN lot_work_history i ON i.allocation_id=p.id WHERE i.bundle_id NOT IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM loading_order_lots WHERE allocation_id IN (SELECT id FROM purge_allocations) AND loading_id NOT IN (SELECT id FROM purge_loads))
    OR EXISTS(SELECT 1 FROM loading_orders WHERE allocation_id IN (SELECT id FROM purge_allocations) AND id NOT IN (SELECT id FROM purge_loads))
    OR EXISTS(SELECT 1 FROM loading_order_lots WHERE loading_id IN (SELECT id FROM purge_loads) AND allocation_id NOT IN (SELECT id FROM purge_allocations))
    OR EXISTS(SELECT 1 FROM purge_loads WHERE allocation_id IS NOT NULL AND allocation_id NOT IN (SELECT id FROM purge_allocations)) THEN
  RAISE EXCEPTION 'TEST_RECEIPT_PREPARATION_CHAIN_SHARED';
 END IF;

 CREATE TEMP TABLE purge_plans ON COMMIT DROP AS
  SELECT document_id AS id FROM loading_plan_matches WHERE loading_id IN (SELECT id FROM purge_loads)
  UNION SELECT document_id FROM loading_plan_match_history WHERE document_id IS NOT NULL AND loading_id IN (SELECT id FROM purge_loads)
  UNION SELECT document_id FROM loading_plan_lots WHERE allocation_id IN (SELECT id FROM purge_allocations)
  UNION SELECT document_id FROM loading_plan_lot_locks WHERE allocation_id IN (SELECT id FROM purge_allocations);
 IF EXISTS(SELECT 1 FROM loading_plan_lots WHERE document_id IN (SELECT id FROM purge_plans) AND allocation_id NOT IN (SELECT id FROM purge_allocations))
    OR EXISTS(SELECT 1 FROM loading_plan_lot_locks WHERE document_id IN (SELECT id FROM purge_plans) AND allocation_id NOT IN (SELECT id FROM purge_allocations))
    OR EXISTS(SELECT 1 FROM loading_plan_matches WHERE document_id IN (SELECT id FROM purge_plans) AND loading_id NOT IN (SELECT id FROM purge_loads))
    OR EXISTS(SELECT 1 FROM loading_plan_match_history WHERE document_id IN (SELECT id FROM purge_plans) AND loading_id NOT IN (SELECT id FROM purge_loads)) THEN
  RAISE EXCEPTION 'TEST_RECEIPT_LOADING_PLAN_SHARED';
 END IF;
 CREATE TEMP TABLE purge_plan_groups ON COMMIT DROP AS
  SELECT group_id AS id FROM loading_plan_documents GROUP BY group_id
   HAVING bool_and(id IN (SELECT id FROM purge_plans));

 CREATE TEMP TABLE purge_outbounds ON COMMIT DROP AS SELECT id FROM outbound_orders WHERE loading_id IN (SELECT id FROM purge_loads);
 CREATE TEMP TABLE purge_preparation_plans ON COMMIT DROP AS SELECT id FROM preparation_plans WHERE allocation_id IN (SELECT id FROM purge_allocations);
 CREATE TEMP TABLE purge_corrections ON COMMIT DROP AS SELECT id FROM outbound_corrections WHERE loading_id IN (SELECT id FROM purge_loads);
 CREATE TEMP TABLE purge_permits ON COMMIT DROP AS SELECT id FROM gate_permits WHERE cu_loading_id IN (SELECT id FROM purge_loads);
 CREATE TEMP TABLE purge_weighings ON COMMIT DROP AS
  SELECT id FROM weighings WHERE loading_id IN (SELECT id FROM purge_loads)
  UNION SELECT weighing_id FROM weighing_items WHERE bundle_id IN (SELECT id FROM purge_units);
 IF EXISTS(SELECT 1 FROM weighing_items WHERE weighing_id IN (SELECT id FROM purge_weighings) AND bundle_id NOT IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM weighings WHERE id IN (SELECT id FROM purge_weighings) AND loading_id NOT IN (SELECT id FROM purge_loads))
    OR EXISTS(SELECT 1 FROM outbound_orders WHERE weighing_id IN (SELECT id FROM purge_weighings) AND id NOT IN (SELECT id FROM purge_outbounds))
    OR EXISTS(SELECT 1 FROM copper_leftover_custody WHERE (loading_id IN (SELECT id FROM purge_loads) OR allocation_id IN (SELECT id FROM purge_allocations)) AND bundle_id NOT IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM inventory_events WHERE receipt_id=target.id AND bundle_id NOT IN (SELECT id FROM purge_units)) THEN
  RAISE EXCEPTION 'TEST_RECEIPT_RELATED_DOCUMENT_SHARED';
 END IF;
 IF EXISTS(SELECT 1 FROM stocktake_snapshot WHERE bundle_id IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM stocktake_resolutions WHERE receipt_id=target.id OR correction_id IN (SELECT id FROM purge_corrections)
     OR bundle_no IN (SELECT bundle_no FROM purge_units))
    OR EXISTS(SELECT 1 FROM stocktake_observations WHERE bundle_no IN (SELECT bundle_no FROM purge_units))
    OR EXISTS(SELECT 1 FROM adjustment_lines WHERE bundle_no IN (SELECT bundle_no FROM purge_units))
    OR EXISTS(SELECT 1 FROM stock_move_items WHERE bundle_id IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM sampling_items WHERE bundle_id IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM label_job_items WHERE bundle_id IN (SELECT id FROM purge_units))
    OR EXISTS(SELECT 1 FROM bundle_number_registry WHERE owner_id=target.id AND conflicted) THEN
  RAISE EXCEPTION 'TEST_RECEIPT_STOCKTAKE_MOVE_SAMPLE_LABEL_OR_IDENTITY_DEPENDENCY';
 END IF;

 SELECT jsonb_build_object('receipt',to_jsonb(target),'project_id',target.project_id,'unit_count',expected_units,
  'loading_orders',(SELECT jsonb_agg(to_jsonb(l)) FROM purge_loads l),
  'outbound_ids',(SELECT jsonb_agg(id) FROM purge_outbounds), 'allocation_ids',(SELECT jsonb_agg(id) FROM purge_allocations),
  'loading_plan_ids',(SELECT jsonb_agg(id) FROM purge_plans),'gate_permit_ids',(SELECT jsonb_agg(id) FROM purge_permits)) INTO snapshot;

 -- The selected business rows have a verified database backup. Suspend only
 -- enabled user DELETE triggers on these explicitly listed tables for this transaction.
 SELECT coalesce(jsonb_agg(jsonb_build_object('rel',tgrelid::regclass::text,'name',tgname) ORDER BY tgrelid,tgname),'[]')
 INTO affected_triggers FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgtype & 8=8
  AND tgrelid IN ('receipt_lines'::regclass,'receipts'::regclass,'bundles'::regclass,'inventory_history'::regclass,
   'inventory_events'::regclass,'inventory_origins'::regclass,'bundle_metadata_history'::regclass,'document_history'::regclass,
   'loading_orders'::regclass,'loading_items'::regclass,'loading_plan_groups'::regclass,'loading_plan_documents'::regclass,'loading_plan_lots'::regclass,
   'loading_plan_matches'::regclass,'loading_plan_match_history'::regclass,'loading_plan_lot_locks'::regclass,
   'reservations'::regclass,'allocation_items'::regclass,'allocations'::regclass,'lot_work_items'::regclass,
   'lot_work_history'::regclass,'lot_bundle_releases'::regclass,'lot_location_claims'::regclass,'workflow_reviews'::regclass,
   'preparation_plan_events'::regclass,'preparation_plans'::regclass,'packing_list_revisions'::regclass,'packing_list_documents'::regclass,
   'gate_print_jobs'::regclass,'gate_exits'::regclass,'gate_events'::regclass,'gate_permit_revisions'::regclass,'gate_permits'::regclass,
   'outbound_correction_steps'::regclass,'outbound_corrections'::regclass,'outbound_orders'::regclass,'outbound_steps'::regclass,
   'weighing_items'::regclass,'weighings'::regclass,'copper_leftover_custody'::regclass,'export_license_allocations'::regclass);
 FOR trigger_info IN SELECT * FROM jsonb_to_recordset(affected_triggers) AS t(rel text,name text) LOOP
  EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I',trigger_info.rel,trigger_info.name);
 END LOOP;

 DELETE FROM gate_print_jobs WHERE permit_id IN (SELECT id FROM purge_permits);
 DELETE FROM gate_exits WHERE permit_id IN (SELECT id FROM purge_permits);
 DELETE FROM gate_events WHERE permit_id IN (SELECT id FROM purge_permits);
 DELETE FROM gate_permit_revisions WHERE permit_id IN (SELECT id FROM purge_permits);
 DELETE FROM gate_permits WHERE id IN (SELECT id FROM purge_permits);
 DELETE FROM packing_list_revisions WHERE loading_id IN (SELECT id FROM purge_loads);
 DELETE FROM packing_list_documents WHERE loading_id IN (SELECT id FROM purge_loads);
 DELETE FROM export_transport WHERE loading_id IN (SELECT id FROM purge_loads);
 DELETE FROM outbound_correction_steps WHERE correction_id IN (SELECT id FROM purge_corrections);
 DELETE FROM outbound_corrections WHERE id IN (SELECT id FROM purge_corrections);
 DELETE FROM outbound_steps WHERE outbound_id IN (SELECT id FROM purge_outbounds);
 DELETE FROM outbound_orders WHERE id IN (SELECT id FROM purge_outbounds);
 DELETE FROM weighing_items WHERE weighing_id IN (SELECT id FROM purge_weighings);
 DELETE FROM weighings WHERE id IN (SELECT id FROM purge_weighings);
 DELETE FROM export_license_allocations WHERE cu_plan_id IN (SELECT id FROM purge_plans);
 DELETE FROM loading_plan_lot_locks WHERE document_id IN (SELECT id FROM purge_plans);
 DELETE FROM loading_plan_lots WHERE document_id IN (SELECT id FROM purge_plans);
 DELETE FROM loading_plan_match_history WHERE loading_id IN (SELECT id FROM purge_loads);
 DELETE FROM loading_plan_matches WHERE loading_id IN (SELECT id FROM purge_loads);
 DELETE FROM loading_plan_documents WHERE id IN (SELECT id FROM purge_plans);
 DELETE FROM loading_plan_groups WHERE id IN (SELECT id FROM purge_plan_groups);
 DELETE FROM copper_leftover_custody WHERE bundle_id IN (SELECT id FROM purge_units);
 DELETE FROM lot_bundle_releases WHERE bundle_id IN (SELECT id FROM purge_units);
 DELETE FROM workflow_reviews WHERE loading_id IN (SELECT id FROM purge_loads) OR allocation_id IN (SELECT id FROM purge_allocations);
 DELETE FROM loading_order_lots WHERE loading_id IN (SELECT id FROM purge_loads);
 DELETE FROM loading_items WHERE loading_id IN (SELECT id FROM purge_loads);
 DELETE FROM loading_orders WHERE id IN (SELECT id FROM purge_loads);
 DELETE FROM preparation_plan_events WHERE plan_id IN (SELECT id FROM purge_preparation_plans);
 DELETE FROM preparation_plans WHERE id IN (SELECT id FROM purge_preparation_plans);
 DELETE FROM lot_location_claims WHERE allocation_id IN (SELECT id FROM purge_allocations);
 DELETE FROM lot_work_history WHERE allocation_id IN (SELECT id FROM purge_allocations);
 DELETE FROM lot_work_items WHERE allocation_id IN (SELECT id FROM purge_allocations);
 DELETE FROM reservations WHERE allocation_id IN (SELECT id FROM purge_allocations);
 DELETE FROM allocation_items WHERE allocation_id IN (SELECT id FROM purge_allocations);
 DELETE FROM allocations WHERE id IN (SELECT id FROM purge_allocations);
 DELETE FROM document_history WHERE document_id=target.id OR document_id IN (
  SELECT id FROM purge_loads UNION SELECT id FROM purge_outbounds UNION SELECT id FROM purge_weighings UNION SELECT id FROM purge_allocations);
 DELETE FROM inventory_history WHERE bundle_id IN (SELECT id FROM purge_units);
 DELETE FROM inventory_events WHERE bundle_id IN (SELECT id FROM purge_units);
 DELETE FROM inventory_origins WHERE bundle_id IN (SELECT id FROM purge_units);
 DELETE FROM bundle_metadata_history WHERE bundle_id IN (SELECT id FROM purge_units);
 DELETE FROM seal_number_registry WHERE bundle_id IN (SELECT id FROM purge_units);
 DELETE FROM bundles WHERE id IN (SELECT id FROM purge_units);
 DELETE FROM receipt_lines WHERE receipt_id=target.id;
 DELETE FROM receipts WHERE id=target.id;
 DELETE FROM bundle_number_registry WHERE owner_id=target.id;

 FOR trigger_info IN SELECT * FROM jsonb_to_recordset(affected_triggers) AS t(rel text,name text) LOOP
  EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I',trigger_info.rel,trigger_info.name);
 END LOOP;
 INSERT INTO audit_logs(action,entity_type,entity_id,before_data,after_data) VALUES
  ('test_receipt_chain_removed','receipts',target.id,snapshot,jsonb_build_object('executed_as',current_user));
 RAISE NOTICE 'TEST_RECEIPT_CHAIN_CHECKED % units=% loading=%',code_to_remove,expected_units,target_load_code;
END $$;

\if :apply
COMMIT;
\echo TEST_RECEIPT_CLEANUP_COMMITTED
\else
ROLLBACK;
\echo TEST_RECEIPT_CLEANUP_DRY_RUN_ROLLED_BACK
\endif
