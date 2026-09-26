-- A row of a previewed question sheet, as the admin corrected it in the review window before pressing
-- Import. The preview never writes a question; this holds the corrected draft against the run and its
-- line, and the commit lays it over the re-read file before judging every row again. It dies with its
-- run, and nothing reads it once the run is committed.
CREATE TABLE "ImportRowEdit" (
    "importLogId" UUID NOT NULL,
    "line" INTEGER NOT NULL,
    "draft" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRowEdit_pkey" PRIMARY KEY ("importLogId","line")
);

ALTER TABLE "ImportRowEdit" ADD CONSTRAINT "ImportRowEdit_importLogId_fkey" FOREIGN KEY ("importLogId") REFERENCES "ImportLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
