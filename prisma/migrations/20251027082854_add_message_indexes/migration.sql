-- CreateIndex
CREATE INDEX "Message_chatRoomId_createdAt_idx" ON "Message"("chatRoomId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_userId_idx" ON "Message"("userId");
