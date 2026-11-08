-- Additive validation; applied migrations and confirmed documents remain unchanged.
CREATE FUNCTION v24_adjustment_date_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF NEW.kind='GAIN' AND nullif(NEW.after_data->>'production_date','') IS NOT NULL AND (NEW.after_data->>'production_date')::date>(clock_timestamp() AT TIME ZONE 'Africa/Lubumbashi')::date THEN RAISE EXCEPTION 'Gain production date cannot be in future' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER adjustment_date_guard BEFORE INSERT ON adjustment_lines FOR EACH ROW EXECUTE FUNCTION v24_adjustment_date_guard();
REVOKE ALL ON FUNCTION v24_adjustment_date_guard() FROM PUBLIC;
