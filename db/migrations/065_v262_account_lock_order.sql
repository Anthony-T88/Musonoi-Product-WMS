-- Take the account lifecycle lock before PostgreSQL locks individual user rows.
-- This also covers preference/last-login updates and avoids row/advisory lock inversion.
CREATE FUNCTION account_statement_lock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(21002);
 RETURN NULL;
END $$;
CREATE TRIGGER account_statement_lock BEFORE INSERT OR UPDATE ON users
 FOR EACH STATEMENT EXECUTE FUNCTION account_statement_lock();
