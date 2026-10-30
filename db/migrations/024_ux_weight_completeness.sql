-- SQL CHECK treats NULL as unknown; explicitly require a complete frozen measurement basis.
ALTER TABLE bundles ADD CONSTRAINT complete_weight_basis CHECK(num_nonnulls(gross_weight,packaging_weight,weight_rule_version) IN(0,3));
ALTER TABLE receipt_lines ADD CONSTRAINT complete_receipt_weight_basis CHECK(num_nonnulls(gross_weight,packaging_weight,weight_rule_version) IN(0,3));
