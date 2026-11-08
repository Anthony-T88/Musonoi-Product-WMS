-- A closed temporary point remains in the audit ledger, but must no longer
-- reserve map geometry. Retain the installed native guard and all its checks.
DO $$DECLARE installed text;updated text;needle text:='AND a.active AND a.x<NEW.x+NEW.width';BEGIN
 SELECT pg_get_functiondef('co_location_guard()'::regprocedure) INTO installed;
 IF strpos(installed,needle)=0 OR strpos(installed,'CO_LOCATION_OVERLAP')=0 THEN
  RAISE EXCEPTION 'Expected native location overlap guard not found';
 END IF;
 updated:=replace(installed,needle,'AND a.active AND NOT EXISTS(SELECT 1 FROM co_temporary_points t WHERE t.location_id=a.id AND t.status=''CLOSED'') AND a.x<NEW.x+NEW.width');
 EXECUTE updated;
END$$;
