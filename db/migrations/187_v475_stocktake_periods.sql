-- Store the explicitly selected business period for newly scheduled counts.
ALTER TABLE stocktakes DROP CONSTRAINT stocktakes_task_type_check;
ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_task_type_check CHECK(task_type IN('MONTHLY','SEMIANNUAL','ANNUAL','SPECIAL'));
ALTER TABLE stocktakes ADD COLUMN period_month text;
ALTER TABLE co_stocktakes ADD COLUMN task_type text CHECK(task_type IN('MONTHLY','SEMIANNUAL','ANNUAL','SPECIAL')),
 ADD COLUMN period_month text;

CREATE FUNCTION stocktake_period_valid(kind text, period text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT period IS NULL OR coalesce(period ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$' AND CASE kind
  WHEN 'MONTHLY' THEN true WHEN 'SEMIANNUAL' THEN right(period,2) IN ('01','07')
  WHEN 'ANNUAL' THEN right(period,2)='01' ELSE false END,false)
$$;
ALTER TABLE stocktakes ADD CHECK(stocktake_period_valid(task_type,period_month));
ALTER TABLE co_stocktakes ADD CHECK(stocktake_period_valid(task_type,period_month));

DO $patch$ DECLARE original text; BEGIN
 SELECT pg_get_functiondef('v27_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text)'::regprocedure) INTO original;
 IF position('kind NOT IN(''MONTHLY'',''ANNUAL'',''SPECIAL'')' IN original)=0 THEN RAISE EXCEPTION 'Unexpected stocktake type check'; END IF;
 EXECUTE replace(original,'kind NOT IN(''MONTHLY'',''ANNUAL'',''SPECIAL'')','kind NOT IN(''MONTHLY'',''ANNUAL'',''SPECIAL'',''SEMIANNUAL'')');
END $patch$;

CREATE FUNCTION v475_cu_stocktake_create(actor uuid,p uuid,w uuid,filters jsonb,assignee uuid,kind text,cutoff timestamptz,note text,period text)
RETURNS stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result stocktakes;
BEGIN
 result:=v33_stocktake_create(actor,p,w,filters,assignee,kind,cutoff,note);
 UPDATE stocktakes SET period_month=period WHERE id=result.id RETURNING * INTO result;
 RETURN result;
END $$;
CREATE FUNCTION v475_co_stocktake_create(actor uuid,body jsonb,kind text,period text)
RETURNS co_stocktakes LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result co_stocktakes;
BEGIN
 result:=v451_co_count_action(actor,NULL,NULL,'create',body);
 UPDATE co_stocktakes SET task_type=kind,period_month=period WHERE id=result.id RETURNING * INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION v475_cu_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text,text),v475_co_stocktake_create(uuid,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION v475_cu_stocktake_create(uuid,uuid,uuid,jsonb,uuid,text,timestamptz,text,text),v475_co_stocktake_create(uuid,jsonb,text,text) TO musonoi_app;
