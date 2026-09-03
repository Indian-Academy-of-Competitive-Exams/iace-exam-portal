-- An event gathers the people sitting it.
--
-- A program is an attribute of being a student -- Student.programs already carries it, no
-- table needed. An event is not: an entrance exam or a scholarship round reaches people who
-- are not IACE students yet, so there is no student row to hang a column off until one of
-- them enrols. Event and EventCandidate exist to name that gathering directly -- a candidate
-- is a MEMBERSHIP (rows in the event, full stop) rather than a GRANT (an access exception on
-- top of a rule): nothing else about a student determines whether they sit an event, the
-- event's own roster is the only source of truth, so it earns its own tables instead of
-- overloading StudentGrant, which exists for exceptions to a rule that would otherwise apply.
--
-- TestSeries.eventId is what an EVENT-kind series points at for its roster; TestProgramUnlock
-- is the unrelated per-program stagger on when a PROGRAM-kind series' test opens. Both are
-- pure additions -- no row, column or constraint above moves or narrows, and nothing writes to
-- either new table yet.

-- AlterTable
ALTER TABLE "TestSeries" ADD COLUMN     "eventId" TEXT;

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCandidate" (
    "eventId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventCandidate_pkey" PRIMARY KEY ("eventId","studentId")
);

-- CreateTable
CREATE TABLE "TestProgramUnlock" (
    "testId" TEXT NOT NULL,
    "programCode" TEXT NOT NULL,
    "opensAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestProgramUnlock_pkey" PRIMARY KEY ("testId","programCode")
);

-- CreateIndex
CREATE INDEX "EventCandidate_studentId_idx" ON "EventCandidate"("studentId");

-- CreateIndex
CREATE INDEX "TestProgramUnlock_programCode_idx" ON "TestProgramUnlock"("programCode");

-- CreateIndex
CREATE INDEX "TestSeries_eventId_idx" ON "TestSeries"("eventId");

-- AddForeignKey
ALTER TABLE "TestSeries" ADD CONSTRAINT "TestSeries_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCandidate" ADD CONSTRAINT "EventCandidate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCandidate" ADD CONSTRAINT "EventCandidate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestProgramUnlock" ADD CONSTRAINT "TestProgramUnlock_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestProgramUnlock" ADD CONSTRAINT "TestProgramUnlock_programCode_fkey" FOREIGN KEY ("programCode") REFERENCES "Program"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
