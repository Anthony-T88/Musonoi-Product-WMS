-- Change defaults for new documents only. Historical codes and UUIDs remain valid.
CREATE FUNCTION short_document_serial(n bigint) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path=pg_catalog AS $$
 SELECT lpad(n::text,greatest(2,length(n::text)),'0')
$$;

CREATE SEQUENCE sample_document_numbers;
CREATE SEQUENCE weighing_document_numbers;
CREATE SEQUENCE outbound_document_numbers;
CREATE SEQUENCE stock_move_document_numbers;
CREATE SEQUENCE correction_document_numbers;
GRANT USAGE ON SEQUENCE sample_document_numbers,weighing_document_numbers,outbound_document_numbers,
 stock_move_document_numbers,correction_document_numbers TO musonoi_app;

ALTER TABLE sales_plans ALTER COLUMN code SET DEFAULT 'SP-'||short_document_serial(nextval('sales_plan_numbers'));
ALTER TABLE allocations ALTER COLUMN code SET DEFAULT 'PREP-'||short_document_serial(nextval('allocation_numbers'));
ALTER TABLE receipts ALTER COLUMN code SET DEFAULT 'IN-'||to_char(current_date,'YYYYMMDD')||'-'||short_document_serial(nextval('receipt_numbers'));
ALTER TABLE stocktakes ALTER COLUMN code SET DEFAULT 'CNT-'||short_document_serial(nextval('stocktake_numbers'));
ALTER TABLE inventory_exceptions ALTER COLUMN code SET DEFAULT 'EXC-'||short_document_serial(nextval('exception_numbers'));
ALTER TABLE stock_adjustments ALTER COLUMN code SET DEFAULT 'ADJ-'||short_document_serial(nextval('adjustment_numbers'));
ALTER TABLE loading_plan_groups ALTER COLUMN code SET DEFAULT 'LPG-'||to_char(current_date,'YYYYMMDD')||'-'||short_document_serial(nextval('loading_plan_group_numbers'));
ALTER TABLE loading_plan_documents ALTER COLUMN code SET DEFAULT 'LP-'||to_char(current_date,'YYYYMMDD')||'-'||short_document_serial(nextval('loading_plan_document_numbers'));
ALTER TABLE sampling_batches ALTER COLUMN code SET DEFAULT 'SMP-'||short_document_serial(nextval('sample_document_numbers'));
ALTER TABLE weighings ALTER COLUMN code SET DEFAULT 'WGH-'||short_document_serial(nextval('weighing_document_numbers'));
ALTER TABLE outbound_orders ALTER COLUMN code SET DEFAULT 'OUT-'||short_document_serial(nextval('outbound_document_numbers'));
ALTER TABLE stock_moves ALTER COLUMN code SET DEFAULT 'MOVE-'||short_document_serial(nextval('stock_move_document_numbers'));
ALTER TABLE outbound_corrections ALTER COLUMN code SET DEFAULT 'COR-'||short_document_serial(nextval('correction_document_numbers'));
ALTER TABLE co_sales_plans ALTER COLUMN code SET DEFAULT 'CO-SP-'||short_document_serial(nextval('co_sales_plan_number'));
ALTER TABLE co_loading_plans ALTER COLUMN code SET DEFAULT 'CO-LP-'||short_document_serial(nextval('co_loading_plan_number'));
ALTER TABLE co_outbounds ALTER COLUMN code SET DEFAULT 'CO-OUT-'||short_document_serial(nextval('co_outbound_number'));
ALTER TABLE co_stocktakes ALTER COLUMN code SET DEFAULT 'CO-CNT-'||short_document_serial(nextval('co_stocktake_number'));

-- Skip any existing manually assigned numeric codes in the former UUID series.
DO $$
DECLARE series record; next_number bigint;
BEGIN
 FOR series IN SELECT * FROM (VALUES
  ('sampling_batches','SMP-','sample_document_numbers'),
  ('weighings','WGH-','weighing_document_numbers'),
  ('outbound_orders','OUT-','outbound_document_numbers'),
  ('stock_moves','MOVE-','stock_move_document_numbers'),
  ('outbound_corrections','COR-','correction_document_numbers')
 ) AS codes(table_name,prefix,sequence_name)
 LOOP
  EXECUTE format('SELECT coalesce(max(substring(code FROM %L)::bigint),0)+1 FROM %I',
   '^'||series.prefix||'([0-9]{1,18})$',series.table_name) INTO next_number;
  EXECUTE format('ALTER SEQUENCE %I RESTART WITH %s',series.sequence_name,next_number);
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION next_loading_document_code(product text) RETURNS text
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
  candidate:='LOAD-'||to_char(day_key,'YYYYMMDD')||'-'||public.short_document_serial(serial);
  -- Preserve a pre-existing manual code if one already uses this format.
  EXIT WHEN (product='CU_CATHODE' AND NOT EXISTS(SELECT 1 FROM public.loading_orders WHERE code=candidate))
   OR(product='CO_HYDROXIDE' AND NOT EXISTS(SELECT 1 FROM public.co_loading_orders WHERE code=candidate));
 END LOOP;
 RETURN candidate;
END $$;

