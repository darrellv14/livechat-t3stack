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

  const handleBackToList = () => {
    setSelectedChatId(null);
  };

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
      {/* Desktop: Sidebar always visible */}
      <div className="hidden w-80 border-r md:block">
        <ChatList
          selectedChatId={selectedChatId ?? undefined}
          onSelectChat={setSelectedChatId}
        />
      </div>

      {/* Mobile: Sidebar or Chat (WhatsApp style toggle) */}
      <div className="block w-full md:hidden">
        {!selectedChatId ? (
          // Show chat list on mobile when no chat selected
          <ChatList
            selectedChatId={selectedChatId ?? undefined}
            onSelectChat={setSelectedChatId}
          />
        ) : (
          // Show chat room with back button on mobile
          <div className="flex h-full flex-col">
            <ChatRoom 
              chatRoomId={selectedChatId} 
              onBack={handleBackToList}
            />
          </div>
        )}
      </div>

      {/* Desktop: Main Chat Area */}
      <div className="hidden flex-1 md:block">
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
