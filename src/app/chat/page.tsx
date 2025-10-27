"use client";

import { ChatList } from "@/app/chat/_components/ChatList";
import { ChatRoom } from "@/app/chat/_components/ChatRoom";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="text-center">
          <MessageSquare className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
          <h2 className="mb-2 text-2xl font-bold">Sign in to start chatting</h2>
          <p className="text-muted-foreground mb-4">
            Connect with friends and colleagues instantly
          </p>
          <Link href="/api/auth/signin">
            <Button>Sign in with Google</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <div className="w-80 border-r">
        <ChatList
          selectedChatId={selectedChatId ?? undefined}
          onSelectChat={setSelectedChatId}
        />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1">
        {selectedChatId ? (
          <ChatRoom chatRoomId={selectedChatId} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <MessageSquare className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
              <h3 className="mb-2 text-xl font-semibold">
                Select a chat to start messaging
              </h3>
              <p className="text-muted-foreground">
                Choose a conversation from the sidebar or start a new one
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
