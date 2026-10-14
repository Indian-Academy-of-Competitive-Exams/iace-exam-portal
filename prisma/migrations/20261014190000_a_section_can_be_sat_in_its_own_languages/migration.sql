-- A section can name its own languages: English Language is sat in English, a Hindi paper's Hindi
-- section in Hindi, whatever the paper offers. Empty keeps today's meaning: the paper's languages.
ALTER TABLE "BaseConfigSection" ADD COLUMN "languages" "SupportedLanguage"[] NOT NULL DEFAULT ARRAY[]::"SupportedLanguage"[];

-- A test offered past missing languages records which ones, so candidates are not offered them.
ALTER TABLE "Test" ADD COLUMN "languagesSkipped" "SupportedLanguage"[] NOT NULL DEFAULT ARRAY[]::"SupportedLanguage"[];
