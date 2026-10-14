-- A subject that is a language (Hindi Comprehension) names it: its questions are written in that
-- language alone, which is then required in place of English. Null for every other subject.
ALTER TABLE "Subject" ADD COLUMN "language" "SupportedLanguage";
