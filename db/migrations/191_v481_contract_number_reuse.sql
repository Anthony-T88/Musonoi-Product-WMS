-- Archived contracts retain their IDs and history without reserving their numbers.
CREATE UNIQUE INDEX customer_contracts_live_contract_no_uidx
    ON customer_contracts (contract_no) WHERE deleted_at IS NULL;

ALTER TABLE customer_contracts DROP CONSTRAINT customer_contracts_contract_no_key;
