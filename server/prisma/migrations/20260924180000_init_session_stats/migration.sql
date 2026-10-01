-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" CHAR(24) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "study_sessions" (
    "id" UUID NOT NULL,
    "user_id" CHAR(24) NOT NULL,
    "room_id" CHAR(24) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

-- AddCheckConstraint
-- Hand-added: Prisma's schema language cannot express a CHECK, and a
-- negative duration is meaningless. Zero stays legal (a session shorter
-- than a minute still happened).
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_duration_minutes_check" CHECK ("duration_minutes" >= 0);

-- CreateIndex
CREATE INDEX "study_sessions_user_id_idx" ON "study_sessions"("user_id");

-- CreateIndex
CREATE INDEX "study_sessions_date_idx" ON "study_sessions"("date");

-- CreateIndex
CREATE INDEX "study_sessions_user_id_date_idx" ON "study_sessions"("user_id", "date");

-- AddForeignKey
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

