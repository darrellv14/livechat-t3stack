"use client";

import { Suspense } from "react";
import { ChatRoom } from "@/app/chat/_components/ChatRoom";
import { api } from "@/trpc/react";

export const dynamic = 'force-dynamic';

export default function ChatPage() {
  const { data: chatRoom, isLoading } = api.chat.getOrCreateDefaultRoom.useQuery();

  if (isLoading) {
    return (
      <div className="container mx-auto flex h-screen items-center justify-center">
        <div>Loading chat room...</div>
      </div>
    );
  }

  if (!chatRoom) {
    return (
      <div className="container mx-auto flex h-screen items-center justify-center">
        <div>Failed to load chat room. Please try again.</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto h-screen py-4">
      <Suspense fallback={<div>Loading chat...</div>}>
        <ChatRoom chatRoomId={chatRoom.id} />
      </Suspense>
    </div>
  );
}
