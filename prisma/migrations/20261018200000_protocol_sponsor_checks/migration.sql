-- AlterTable
ALTER TABLE "ProtocolSponsorship" ADD COLUMN     "channel" TEXT,
ADD COLUMN     "identityHash" TEXT;

-- CreateTable
CREATE TABLE "ProtocolSponsorCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "identityHash" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "ipHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocolSponsorCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProtocolSponsorCheck_userId_createdAt_idx" ON "ProtocolSponsorCheck"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProtocolSponsorCheck_identityHash_createdAt_idx" ON "ProtocolSponsorCheck"("identityHash", "createdAt");

-- CreateIndex
CREATE INDEX "ProtocolSponsorCheck_ipHash_createdAt_idx" ON "ProtocolSponsorCheck"("ipHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolSponsorship_identityHash_key" ON "ProtocolSponsorship"("identityHash");

-- CreateIndex
CREATE INDEX "ProtocolSponsorship_inviterId_createdAt_idx" ON "ProtocolSponsorship"("inviterId", "createdAt");

