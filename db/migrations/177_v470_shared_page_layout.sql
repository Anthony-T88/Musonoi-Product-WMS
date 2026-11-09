CREATE TABLE page_layout_settings (
 scope text PRIMARY KEY CHECK (scope='global' OR scope ~ '^(cu|co):/[a-z0-9/:-]{1,140}$'),
 settings jsonb NOT NULL CHECK (jsonb_typeof(settings)='object'),
 version integer NOT NULL CHECK (version>0),
 updated_by uuid NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT, INSERT, UPDATE ON page_layout_settings TO musonoi_app;
