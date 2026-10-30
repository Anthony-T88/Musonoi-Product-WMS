ALTER TABLE users ADD COLUMN language_code text NOT NULL DEFAULT 'zh-CN' CHECK(language_code IN('zh-CN','en'));
