ALTER TABLE yards ADD UNIQUE(project_id,warehouse_id,id);
ALTER TABLE locations ADD FOREIGN KEY(project_id,warehouse_id,yard_id) REFERENCES yards(project_id,warehouse_id,id);
ALTER TABLE customers ADD CHECK(code=upper(trim(code)) AND length(code) BETWEEN 1 AND 60 AND length(trim(name))>0);
ALTER TABLE warehouses ADD CHECK(code=upper(trim(code)) AND length(code) BETWEEN 1 AND 60 AND length(trim(name))>0);
ALTER TABLE yards ADD CHECK(code=upper(trim(code)) AND length(code) BETWEEN 1 AND 60 AND length(trim(name))>0);
ALTER TABLE locations ADD CHECK(code=upper(trim(code)) AND length(code) BETWEEN 1 AND 60);
ALTER TABLE batches ADD CHECK(code=upper(trim(code)) AND length(code) BETWEEN 1 AND 60);
