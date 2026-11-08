-- Never remove a sequence once a business record uses its new number.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM co_preparations WHERE preparation_batch_no ~ '^RMM-CO-[0-9]{4}-[0-9]{3,}$')
 THEN RAISE EXCEPTION 'CO_BATCH_NUMBER_IN_USE_RETAIN_SEQUENCE';END IF;
END $$;
DROP FUNCTION co_next_preparation_batch();
DROP TABLE co_preparation_year_counters;
ALTER TABLE co_preparations DROP CONSTRAINT co_preparations_batch_number_check;
ALTER TABLE co_preparations ADD CONSTRAINT co_preparations_preparation_batch_no_check
 CHECK(preparation_batch_no=replace(document_no,'CO-PREP-','CO-LOT-'));
