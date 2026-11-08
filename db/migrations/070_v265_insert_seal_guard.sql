-- AFTER INSERT permits the registry FK to reference the newly inserted bundle.
-- A conflict still rolls back the entire inserting transaction.
DROP TRIGGER v265_seal_guard ON bundles;
CREATE TRIGGER v265_seal_guard AFTER INSERT OR UPDATE OF seal_no ON bundles FOR EACH ROW EXECUTE FUNCTION v265_seal_guard();
