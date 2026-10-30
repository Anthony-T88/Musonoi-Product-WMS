ALTER FUNCTION loading_item_guard() SECURITY DEFINER;
ALTER FUNCTION loading_item_guard() SET search_path=public,pg_temp;
ALTER FUNCTION weighing_load_guard() SECURITY DEFINER;
ALTER FUNCTION weighing_load_guard() SET search_path=public,pg_temp;
