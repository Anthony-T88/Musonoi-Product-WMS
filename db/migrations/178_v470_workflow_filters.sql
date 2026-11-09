-- Keep a draft's proposed location separate from the existing stock placement.
ALTER TABLE co_preparations ADD COLUMN planned_location_id uuid REFERENCES co_locations(id);

-- A destination can be supplied later on the loading plan.
ALTER TABLE co_sales_plans DROP CONSTRAINT co_sales_plans_destination_check;
ALTER TABLE co_sales_plans ADD CONSTRAINT co_sales_plans_destination_check CHECK(length(trim(destination)) <= 1000);
