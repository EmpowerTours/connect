-- CreateIndex
CREATE INDEX "ChannelMember_channelId_idx" ON "ChannelMember"("channelId");

-- CreateIndex
CREATE INDEX "FollowOrg_orgId_idx" ON "FollowOrg"("orgId");

-- CreateIndex
CREATE INDEX "FollowUser_followeeId_idx" ON "FollowUser"("followeeId");

-- CreateIndex
CREATE INDEX "Like_postId_idx" ON "Like"("postId");

-- CreateIndex
CREATE INDEX "Post_authorId_createdAt_idx" ON "Post"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_channelId_createdAt_idx" ON "Post"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_parentId_idx" ON "Post"("parentId");

-- CreateIndex
CREATE INDEX "Post_quoteOfId_idx" ON "Post"("quoteOfId");

-- CreateIndex
CREATE INDEX "PostMention_userId_idx" ON "PostMention"("userId");

-- CreateIndex
CREATE INDEX "PostOrg_orgId_idx" ON "PostOrg"("orgId");

-- CreateIndex
CREATE INDEX "Recast_postId_idx" ON "Recast"("postId");

-- CreateIndex
CREATE INDEX "SignalOrg_orgId_idx" ON "SignalOrg"("orgId");
