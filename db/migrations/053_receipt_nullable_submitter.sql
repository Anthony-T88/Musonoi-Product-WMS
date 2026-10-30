-- Historical submitters remain unknown. SQL equality with NULL must not turn
-- the required self-review flag (including its audit snapshot) into NULL.
DO $$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('confirm_receipt(uuid,uuid,integer)'::regprocedure) INTO original;
 patched := replace(original,
   '(actor=r.created_by OR actor=r.submitted_by)',
   '(actor IS NOT DISTINCT FROM r.created_by OR actor IS NOT DISTINCT FROM r.submitted_by)');
 IF patched = original THEN
   RAISE EXCEPTION 'Expected receipt self-review expression missing; migration refused';
 END IF;
 EXECUTE patched;
END $$;
