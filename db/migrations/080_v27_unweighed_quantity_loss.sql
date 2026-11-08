ALTER TABLE bundles DROP CONSTRAINT v26_unknown_mass;
ALTER TABLE bundles ADD CONSTRAINT v26_unknown_mass CHECK(net_weight IS NOT NULL OR(workflow_version='2.6' AND physical_status IN('IN_STOCK','ADJUSTED_OUT') AND gross_weight IS NULL));
