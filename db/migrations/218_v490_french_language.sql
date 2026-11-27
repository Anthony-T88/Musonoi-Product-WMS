ALTER TABLE users DROP CONSTRAINT users_language_code_check;
ALTER TABLE users ADD CONSTRAINT users_language_code_check CHECK(language_code IN('zh-CN','en','fr'));
