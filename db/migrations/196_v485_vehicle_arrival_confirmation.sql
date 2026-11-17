ALTER TABLE vehicle_arrivals ADD COLUMN registration_phase text NOT NULL DEFAULT 'CONFIRMED'
 CHECK (registration_phase IN ('CONFIRMED','DRAFT','CLEARED'));

ALTER TABLE co_vehicle_arrivals ADD COLUMN registration_phase text NOT NULL DEFAULT 'CONFIRMED'
 CHECK (registration_phase IN ('CONFIRMED','DRAFT','CLEARED')),
 ALTER COLUMN arrived_at DROP NOT NULL,
 DROP CONSTRAINT co_vehicle_arrivals_trailer_one_check,
 DROP CONSTRAINT co_vehicle_arrivals_driver_name_check,
 DROP CONSTRAINT co_vehicle_arrivals_passport_no_check,
 DROP CONSTRAINT co_vehicle_arrivals_transporter_check,
 ADD CHECK (length(trim(trailer_one)) <= 80),
 ADD CHECK (length(trim(driver_name)) <= 160),
 ADD CHECK (length(trim(passport_no)) <= 80),
 ADD CHECK (length(trim(transporter)) <= 160),
 ADD CHECK (registration_phase <> 'CONFIRMED' OR (arrived_at IS NOT NULL AND length(trim(trailer_one)) > 0
  AND length(trim(driver_name)) > 0 AND length(trim(passport_no)) > 0 AND length(trim(transporter)) > 0));

CREATE FUNCTION arrival_legacy_draft(product text, vehicle uuid, saved_at timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM document_drafts d WHERE d.product_code=product AND d.closed_at IS NULL
  AND d.form_key IN ('yard-arrival-form','co-arrival-form') AND d.updated_at>coalesce(saved_at,'-infinity')
  AND (regexp_match(d.route,'[?&]vehicle_id=([0-9a-f-]{36})(&|$)','i'))[1] ILIKE vehicle::text)
$$;

DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('co_sales_guard()'::regprocedure) INTO definition;
 IF strpos(definition,'''container_no'',''exception_remark''')=0 THEN RAISE EXCEPTION 'Cobalt arrival field guard changed'; END IF;
 EXECUTE replace(replace(definition,'''container_no'',''exception_remark''','''container_no'',''exception_remark'',''registration_phase'''),
  'WHERE dispatch_vehicle_id=NEW.id)', 'WHERE dispatch_vehicle_id=NEW.id AND registration_phase<>''CLEARED'')');

 SELECT pg_get_functiondef('co_loading_arrival_valid(uuid,uuid)'::regprocedure) INTO definition;
 IF strpos(definition,'WHERE a.id=arrival')=0 THEN RAISE EXCEPTION 'Cobalt loading arrival guard changed'; END IF;
 EXECUTE replace(definition,'WHERE a.id=arrival',
  'WHERE a.id=arrival AND a.registration_phase=''CONFIRMED'' AND NOT arrival_legacy_draft(a.product_code,a.dispatch_vehicle_id,a.updated_at)');

 SELECT pg_get_functiondef('v34_loading_plan_integrity()'::regprocedure) INTO definition;
 IF strpos(definition,'IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM loading_plan_groups')=0 THEN RAISE EXCEPTION 'Copper loading arrival guard changed'; END IF;
 EXECUTE replace(definition,'IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM loading_plan_groups',
  'IF NOT FOUND OR a.registration_phase<>''CONFIRMED'' OR arrival_legacy_draft(''CU_CATHODE'',a.dispatch_vehicle_id,a.updated_at) OR NOT EXISTS(SELECT 1 FROM loading_plan_groups');
END $$;
