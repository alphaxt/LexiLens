-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADING', 'QUARANTINED', 'REJECTED', 'READY_FOR_EXTRACTION', 'PROCESSING', 'COMPLETED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "RetentionPolicy" AS ENUM ('SESSION', 'SEVEN_DAYS', 'THIRTY_DAYS', 'NINETY_DAYS');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('ACCOUNT_INITIALIZED', 'PRIVACY_UPDATED', 'DATA_EXPORTED', 'ACCOUNT_DELETED');

-- CreateEnum
CREATE TYPE "ActorMode" AS ENUM ('local', 'oidc');

-- CreateTable
CREATE TABLE "Owner" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "ownerId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "retentionPolicy" "RetentionPolicy" NOT NULL DEFAULT 'SESSION',
    "consentAccepted" BOOLEAN NOT NULL DEFAULT false,
    "consentVersion" TEXT,
    "consentedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("ownerId")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "sourceText" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "activeContentHash" CHAR(64),
    "status" "DocumentStatus" NOT NULL,
    "analysis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "sequence" BIGSERIAL NOT NULL,
    "id" UUID NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorMode" "ActorMode" NOT NULL,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("sequence")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_ownerId_activeContentHash_key" ON "Document"("ownerId", "activeContentHash");

-- CreateIndex
CREATE INDEX "Document_ownerId_status_createdAt_idx" ON "Document"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityEvent_id_key" ON "SecurityEvent"("id");

-- CreateIndex
CREATE INDEX "SecurityEvent_ownerId_sequence_idx" ON "SecurityEvent"("ownerId", "sequence");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Account"("ownerId") ON DELETE CASCADE ON UPDATE CASCADE;
