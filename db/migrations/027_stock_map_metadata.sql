-- Geometry and configuration only. No inventory balances and no fabricated capacities.
CREATE TABLE stock_map_regions(code text PRIMARY KEY CHECK(code IN('P1','P2','P3','P4','P5')),slot_count int NOT NULL,display_order int NOT NULL);
INSERT INTO stock_map_regions VALUES('P1',46,1),('P2',29,2),('P3',34,3),('P4',22,4),('P5',34,5);
CREATE TABLE stock_map_cells(code text PRIMARY KEY,region_code text NOT NULL REFERENCES stock_map_regions(code),display_order int NOT NULL,x numeric,y numeric,width numeric CHECK(width>0),height numeric CHECK(height>0),CHECK(num_nonnulls(x,y,width,height) IN(0,4)));
INSERT INTO stock_map_cells(code,region_code,display_order) SELECT r.code||'-'||i,r.code,r.display_order*100+i FROM stock_map_regions r CROSS JOIN LATERAL generate_series(1,r.slot_count) i;
CREATE TABLE stock_map_features(code text PRIMARY KEY,kind text NOT NULL CHECK(kind IN('LOADING','CHECKING','CONTAINER','OFFICE','ROAD')),label text NOT NULL,x numeric,y numeric,width numeric CHECK(width>0),height numeric CHECK(height>0),CHECK(num_nonnulls(x,y,width,height) IN(0,4)));
INSERT INTO stock_map_features(code,kind,label) VALUES('LP1','LOADING','Loading Point 1'),('LP2','LOADING','Loading Point 2'),('LP3','LOADING','Loading Point 3'),('LP4','LOADING','Loading Point 4'),('CA1','CHECKING','Checking Area 1'),('CA2','CHECKING','Checking Area 2'),('CTLP','CONTAINER','Container Truck Loading Point'),('OFFICE','OFFICE','Office'),('ROAD','ROAD','Road');
CREATE TABLE stock_map_source(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),status text NOT NULL DEFAULT 'AWAITING_SOURCE' CHECK(status IN('AWAITING_SOURCE','DIGITIZED_PENDING_REVIEW','VERIFIED')),source_name text,source_sha256 text,width numeric,height numeric,notes text NOT NULL DEFAULT '现场地图文件待提供；坐标未推测',version int NOT NULL DEFAULT 1);
INSERT INTO stock_map_source(singleton) VALUES(true);
ALTER TABLE locations ADD COLUMN map_cell_code text REFERENCES stock_map_cells(code),ADD COLUMN max_bundles int CHECK(max_bundles>0),ADD COLUMN max_net_weight numeric(18,6) CHECK(max_net_weight>0),ADD COLUMN map_order int NOT NULL DEFAULT 0,ADD COLUMN map_note text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX one_physical_location_per_cell ON locations(project_id,warehouse_id,map_cell_code) WHERE map_cell_code IS NOT NULL;
-- A transaction mutex/revision is not an inventory copy. It prevents stale repeatable-read writers.
CREATE TABLE storage_location_locks(location_id uuid PRIMARY KEY REFERENCES locations(id),revision bigint NOT NULL DEFAULT 1);
GRANT SELECT ON stock_map_regions,stock_map_cells,stock_map_features,stock_map_source TO musonoi_app;
