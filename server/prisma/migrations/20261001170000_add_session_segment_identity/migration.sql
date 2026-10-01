-- Stage 4.2: study-segment identity for study_sessions.
--
-- Additive only. One new NOT NULL column (the table is empty, so no default
-- is needed or wanted - every row is written with an explicit segment) and one
-- unique index, which is the database-level guard that recording the same
-- finished segment twice, or from two callers at once, cannot produce a
-- duplicate row for a participant.

-- AlterTable
ALTER TABLE "study_sessions" ADD COLUMN "segment" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "study_sessions_room_segment_user_key" ON "study_sessions"("room_id", "segment", "user_id");
