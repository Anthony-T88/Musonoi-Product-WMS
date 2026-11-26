-- Older arrival saves discarded the N/A marker. Correct confirmed records and
-- keep the arrival timestamps so newer legacy drafts retain their precedence.
SELECT pg_advisory_xact_lock(21004);
LOCK TABLE vehicle_arrivals IN SHARE ROW EXCLUSIVE MODE;

-- The cobalt guards also cover closed plans and frozen arrivals. Suspend only
-- these arrival triggers under the migration's transaction lock. Record a
-- system audit event instead of attributing this update to the original editor.
ALTER TABLE co_vehicle_arrivals DISABLE TRIGGER co_arrival_guard;
ALTER TABLE co_vehicle_arrivals DISABLE TRIGGER co_loading_freeze_arrival;
ALTER TABLE co_vehicle_arrivals DISABLE TRIGGER co_arrival_audit;

WITH cu AS (
 UPDATE vehicle_arrivals a
 SET trailer_two='N/A', version=a.version+1
 FROM vehicle_arrivals prior
 WHERE a.id=prior.id AND prior.registration_phase='CONFIRMED'
 AND btrim(coalesce(prior.trailer_two,''),U&'\0009\000A\000B\000C\000D\0020\00A0\3000')=''
 AND NOT arrival_legacy_draft('CU_CATHODE',prior.dispatch_vehicle_id,prior.updated_at)
 RETURNING a.id,prior.trailer_two previous_value,prior.version previous_version,a.version new_version
), co AS (
 UPDATE co_vehicle_arrivals a
 SET trailer_two='N/A', version=a.version+1
 FROM co_vehicle_arrivals prior
 WHERE a.id=prior.id AND prior.registration_phase='CONFIRMED'
 AND btrim(coalesce(prior.trailer_two,''),U&'\0009\000A\000B\000C\000D\0020\00A0\3000')=''
 AND NOT arrival_legacy_draft('CO_HYDROXIDE',prior.dispatch_vehicle_id,prior.updated_at)
 RETURNING a.id,prior.trailer_two previous_value,prior.version previous_version,a.version new_version
), corrected AS (
 SELECT 'vehicle_arrivals' entity_type,cu.* FROM cu
 UNION ALL
 SELECT 'co_vehicle_arrivals',co.* FROM co
)
INSERT INTO audit_logs(action,entity_type,entity_id,before_data,after_data)
SELECT 'arrival_trailer_two_backfilled',entity_type,id::text,
 jsonb_build_object('trailer_two',previous_value,'version',previous_version),
 jsonb_build_object('trailer_two','N/A','version',new_version,'migration','211_v489_arrival_trailer_two_backfill.sql')
FROM corrected;

ALTER TABLE co_vehicle_arrivals ENABLE TRIGGER co_arrival_audit;
ALTER TABLE co_vehicle_arrivals ENABLE TRIGGER co_loading_freeze_arrival;
ALTER TABLE co_vehicle_arrivals ENABLE TRIGGER co_arrival_guard;
