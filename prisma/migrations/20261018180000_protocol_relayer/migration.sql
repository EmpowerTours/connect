-- CreateTable
CREATE TABLE "ProtocolSponsorship" (
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "inviterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProtocolSponsorship_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ProtocolRelay" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fn" TEXT NOT NULL,
    "sponsor" TEXT NOT NULL,
    "inviterId" TEXT,
    "ipHash" TEXT,
    "owner" TEXT NOT NULL,
    "connectId" TEXT,
    "keyHash" TEXT,
    "keyBytes" TEXT,
    "gasLimit" DECIMAL(78,0) NOT NULL,
    "costWei" DECIMAL(78,0) NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolRelay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolRelay_txHash_key" ON "ProtocolRelay"("txHash");

-- CreateIndex
CREATE INDEX "ProtocolRelay_chainId_createdAt_idx" ON "ProtocolRelay"("chainId", "createdAt");

-- CreateIndex
CREATE INDEX "ProtocolRelay_userId_createdAt_idx" ON "ProtocolRelay"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProtocolRelay_ipHash_createdAt_idx" ON "ProtocolRelay"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "ProtocolRelay_inviterId_createdAt_idx" ON "ProtocolRelay"("inviterId", "createdAt");

-- CreateIndex
CREATE INDEX "ProtocolRelay_chainId_connectId_idx" ON "ProtocolRelay"("chainId", "connectId");

