-- New plans cannot bypass the independent closure workflow by starting closed.
-- Existing historical states and approval records are untouched.
CREATE FUNCTION v468_new_plan_open_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'OPEN' THEN
  RAISE EXCEPTION 'SALES_CLOSE_APPROVAL_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER v468_new_sales_plan_open BEFORE INSERT ON sales_plans
 FOR EACH ROW EXECUTE FUNCTION v468_new_plan_open_guard();
CREATE TRIGGER v468_new_co_sales_plan_open BEFORE INSERT ON co_sales_plans
 FOR EACH ROW EXECUTE FUNCTION v468_new_plan_open_guard();
