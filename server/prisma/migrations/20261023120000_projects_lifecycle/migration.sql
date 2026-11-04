-- FR02–FR07: project lifecycle, review, team, progress, media.

-- Tags: comma-separated text -> text[] (FR06 needs exact, all-of tag matching).
ALTER TABLE "Project" ALTER COLUMN "tags" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "tags" TYPE TEXT[]
  USING array_remove(string_to_array(regexp_replace(lower(btrim("tags")), '\s*,\s*', ',', 'g'), ','), '');
ALTER TABLE "Project" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];
-- Prisma models scalar lists as nullable columns; matching that avoids schema drift.
ALTER TABLE "Project" ALTER COLUMN "tags" DROP NOT NULL;

ALTER TABLE "Project" ALTER COLUMN "summary" SET DEFAULT '';
ALTER TABLE "Project" ALTER COLUMN "overview" SET DEFAULT '';
ALTER TABLE "Project" ALTER COLUMN "stage" SET DEFAULT 'IDEA';
ALTER TABLE "Project"
  ADD COLUMN "problem" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "demoUrl" TEXT,
  ADD COLUMN "publicDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "ownershipDeclaredAt" TIMESTAMP(3),
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "hiddenAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Projects that were already live count as published when they were created.
UPDATE "Project" SET "publishedAt" = "createdAt" WHERE "status" IN ('PUBLISHED', 'HIDDEN') AND "publishedAt" IS NULL;

ALTER TABLE "GuestSession" ADD COLUMN "seenProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX "Project_status_publishedAt_idx" ON "Project"("status", "publishedAt");
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");
CREATE INDEX "Project_tags_idx" ON "Project" USING GIN ("tags");

-- CreateTable
CREATE TABLE "ProjectRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "overview" TEXT NOT NULL,
    "tags" TEXT[],
    "demoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "dueDate" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMedia" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectRevision_projectId_status_idx" ON "ProjectRevision"("projectId", "status");
CREATE INDEX "ProjectRevision_status_createdAt_idx" ON "ProjectRevision"("status", "createdAt");
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");
CREATE INDEX "ProjectMember_userId_status_idx" ON "ProjectMember"("userId", "status");
CREATE INDEX "ProgressEntry_projectId_createdAt_idx" ON "ProgressEntry"("projectId", "createdAt");
CREATE INDEX "Milestone_projectId_position_idx" ON "Milestone"("projectId", "position");
CREATE INDEX "ProjectMedia_projectId_position_idx" ON "ProjectMedia"("projectId", "position");

-- AddForeignKey
ALTER TABLE "ProjectRevision" ADD CONSTRAINT "ProjectRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProgressEntry" ADD CONSTRAINT "ProgressEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMedia" ADD CONSTRAINT "ProjectMedia_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same policy as enable_rls: only the Express server (table owner) can read these tables.
ALTER TABLE "ProjectRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProgressEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Milestone" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectMedia" ENABLE ROW LEVEL SECURITY;
