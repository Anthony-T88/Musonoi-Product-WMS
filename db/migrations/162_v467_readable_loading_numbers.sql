-- New documents only. Existing codes, UUIDs, references and frozen facts stay intact.
CREATE TABLE loading_document_day_counters(
 product_code text NOT NULL CHECK(product_code IN('CU_CATHODE','CO_HYDROXIDE')),
 business_date date NOT NULL,
 last_number bigint NOT NULL CHECK(last_number>0),
 PRIMARY KEY(product_code,business_date)
);
REVOKE ALL ON loading_document_day_counters FROM PUBLIC,musonoi_app;
CREATE FUNCTION next_loading_document_code(product text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE day_key date;serial bigint;candidate text;
BEGIN
 IF product NOT IN('CU_CATHODE','CO_HYDROXIDE') OR product IS NULL THEN
  RAISE EXCEPTION 'Invalid loading product' USING ERRCODE='23514';
 END IF;
 day_key:=(clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date;
 LOOP
  INSERT INTO public.loading_document_day_counters(product_code,business_date,last_number)
   VALUES(product,day_key,1)
   ON CONFLICT(product_code,business_date) DO UPDATE
    SET last_number=loading_document_day_counters.last_number+1
   RETURNING last_number INTO serial;
  candidate:='LOAD-'||to_char(day_key,'YYYYMMDD')||'-'||repeat('0',greatest(0,3-length(serial::text)))||serial::text;
  -- Preserve a pre-existing manual code if one already uses this format.
  EXIT WHEN (product='CU_CATHODE' AND NOT EXISTS(SELECT 1 FROM public.loading_orders WHERE code=candidate))
   OR(product='CO_HYDROXIDE' AND NOT EXISTS(SELECT 1 FROM public.co_loading_orders WHERE code=candidate));
 END LOOP;
 RETURN candidate;
END $$;
REVOKE ALL ON FUNCTION next_loading_document_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION next_loading_document_code(text) TO musonoi_app;
ALTER TABLE loading_orders ALTER COLUMN code SET DEFAULT next_loading_document_code('CU_CATHODE');
ALTER TABLE co_loading_orders ALTER COLUMN code SET DEFAULT next_loading_document_code('CO_HYDROXIDE');
