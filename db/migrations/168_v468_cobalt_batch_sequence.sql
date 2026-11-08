-- New cobalt preparation batches use an annual server-owned sequence.
-- Historical document numbers, batch numbers, bags and approvals are preserved.
DO $$ DECLARE item record; n integer:=0; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='co_preparations'::regclass
 AND contype='c' AND pg_get_constraintdef(oid) LIKE '%replace(document_no%CO-PREP-%CO-LOT-%' LOOP
  EXECUTE format('ALTER TABLE co_preparations DROP CONSTRAINT %I',item.conname);n:=n+1;
 END LOOP;
 IF n<>1 THEN RAISE EXCEPTION 'CO_BATCH_LEGACY_CONSTRAINT_NOT_FOUND';END IF;
END $$;
ALTER TABLE co_preparations ADD CONSTRAINT co_preparations_batch_number_check CHECK(
 preparation_batch_no=replace(document_no,'CO-PREP-','CO-LOT-')
 OR preparation_batch_no ~ '^RMM-CO-[0-9]{4}-[0-9]{3,}$');
CREATE TABLE co_preparation_year_counters(
 business_year integer PRIMARY KEY CHECK(business_year BETWEEN 2000 AND 9999),
 last_number bigint NOT NULL CHECK(last_number>0));
CREATE FUNCTION co_next_preparation_batch() RETURNS text LANGUAGE plpgsql AS $$
DECLARE y integer:=extract(year FROM clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi');n bigint;
BEGIN
 INSERT INTO co_preparation_year_counters(business_year,last_number)
 SELECT y,coalesce(max(substring(preparation_batch_no FROM '^RMM-CO-[0-9]{4}-([0-9]+)$')::bigint),0)+1
 FROM co_preparations WHERE preparation_batch_no LIKE 'RMM-CO-'||y||'-%'
 ON CONFLICT(business_year) DO UPDATE SET last_number=co_preparation_year_counters.last_number+1
 RETURNING last_number INTO n;
 RETURN 'RMM-CO-'||y||'-'||lpad(n::text,greatest(3,length(n::text)),'0');
END $$;
REVOKE ALL ON FUNCTION co_next_preparation_batch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION co_next_preparation_batch() TO musonoi_app;
GRANT SELECT,INSERT,UPDATE ON co_preparation_year_counters TO musonoi_app;
