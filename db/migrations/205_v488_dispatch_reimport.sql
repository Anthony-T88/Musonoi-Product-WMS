-- PostgreSQL computes stored generated columns after BEFORE triggers run.
-- Compare the source plate (truck_no), keeping the existing permission and version checks.
DO $$
DECLARE
 definition text:=pg_get_functiondef('co_sales_guard()'::regprocedure);
 original text:='ARRAY[''transporter'',''destination'',''version'',''updated_by'',''updated_at'']';
 corrected text:='ARRAY[''transporter'',''destination'',''version'',''updated_by'',''updated_at'',''truck_key'']';
BEGIN
 IF (length(definition)-length(replace(definition,original,'')))/length(original)<>2 THEN
  RAISE EXCEPTION 'Expected cobalt dispatch transport guard';
 END IF;
 EXECUTE replace(definition,original,corrected);
END $$;
