CREATE TABLE report_mail_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 enabled boolean NOT NULL DEFAULT false,
 schedules jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(schedules)='array'),
 version integer NOT NULL DEFAULT 0 CHECK (version>=0),
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz,
 CHECK ((version=0 AND NOT enabled AND updated_by IS NULL AND updated_at IS NULL) OR
        (version>0 AND updated_by IS NOT NULL AND updated_at IS NOT NULL))
);
INSERT INTO report_mail_settings(singleton) VALUES (true);
REVOKE ALL ON report_mail_settings FROM PUBLIC,musonoi_app;
GRANT SELECT ON report_mail_settings TO musonoi_app;
GRANT UPDATE(enabled,schedules,version,updated_by,updated_at) ON report_mail_settings TO musonoi_app;
