"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { ArrowLeft, Send } from "lucide-react";
import type { Session } from "next-auth";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Message } from "./Message";
import { useChatMessages } from "./hooks/useChatMessages";
import { useChatPusher } from "./hooks/useChatPusher";
import { useChatScroll } from "./hooks/useChatScroll";

type MessageType = RouterOutputs["chat"]["getMessages"][number];

export interface ChatRoomProps {
  chatRoomId: string;
  session: Session | null;
  onBack?: () => void;
}

export function ChatRoom({
  chatRoomId,
  onBack,
}: {
  chatRoomId: string;
  onBack?: () => void;
}) {
  const { data: session, status } = useSession();
  const [text, setText] = useState("");
  const utils = api.useUtils();

  const { scrollParentRef, messages, msgStatus, rowVirtualizer } =
    useChatMessages({ chatRoomId, session });

  const { scrollToBottom } = useChatScroll(scrollParentRef, messages.length);

  const { addMessageToCache } = useChatPusher({
    chatRoomId,
    session,
    onNewMessage: () => scrollToBottom("smooth"),
  });

  // Get chat room info for header
  const { data: chatRoom } = api.chat.getChatRoomById.useQuery(
    { chatRoomId },
    {
      enabled: !!chatRoomId,
      refetchOnWindowFocus: false,
    },
  );

  const sendMessage = api.chat.sendMessage.useMutation({
    onMutate: async (newMessage) => {
      await utils.chat.getMessagesInfinite.cancel({ chatRoomId, limit: 50 });

      if (!session?.user || !newMessage.clientId) return;

      const optimisticMessage: MessageType & { clientId: string } = {
        id: newMessage.clientId,
        text: newMessage.text,
        createdAt: new Date(),
        updatedAt: new Date(),
        isEdited: false,
        isDeleted: false,
        chatRoomId: newMessage.chatRoomId,
        userId: session.user.id,
        user: {
          id: session.user.id,
          name: session.user.name ?? "User",
          image: session.user.image ?? null,
        },
        clientId: newMessage.clientId,
      };

      addMessageToCache(utils, optimisticMessage, chatRoomId);
      scrollToBottom("auto");
      setText("");
    },
    onSettled: async () => {
      await utils.chat.getMessagesInfinite.invalidate({
        chatRoomId,
        limit: 50,
      });
      await utils.chat.getChatRooms.invalidate();
    },
  });

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && chatRoomId) {
      sendMessage.mutate({
        text: text.trim(),
        chatRoomId,
        clientId: `temp-${Date.now()}`,
      });
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  if (status === "loading" || msgStatus === "pending") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading session...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold">You must be logged in to chat</p>
          <Link
            href="/api/auth/signin"
            className="text-primary mt-4 inline-block hover:underline"
          >
            Sign in here
          </Link>
        </div>
      </div>
    );
  }

  // Get chat name and avatar for header
  const getChatInfo = (): {
    name: string;
    avatar: string | null;
    lastSeen: Date | null;
  } => {
    if (!chatRoom) return { name: "Chat", avatar: null, lastSeen: null };

    if (chatRoom.isGroup) {
      return {
        name: chatRoom.name ?? "Group Chat",
        avatar: null,
        lastSeen: null,
      };
    }

    // For DM, show the other user's info
    const otherUser = chatRoom.users.find((u) => u.id !== session.user.id);
    if (!otherUser) return { name: "Chat", avatar: null, lastSeen: null };

    return {
      name: otherUser.name ?? "User",
      avatar: otherUser.image ?? null,
      lastSeen: otherUser.lastSeen,
    };
  };

  const chatInfo = getChatInfo();

  const getLastSeenText = (): string => {
    if (!chatInfo.lastSeen) return "Offline";
    const lastSeen = new Date(chatInfo.lastSeen);
    const now = new Date();
    const diffMs = now.getTime() - lastSeen.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Online";
    if (diffMins < 60) return `Active ${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Active ${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `Active ${diffDays}d ago`;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header with profile info */}
      <div className="flex items-center gap-3 border-b p-3">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="shrink-0 md:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}

        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={chatInfo.avatar ?? ""} alt={chatInfo.name} />
          <AvatarFallback>
            {chatInfo.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{chatInfo.name}</h2>
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                getLastSeenText() === "Online"
                  ? "animate-pulse bg-green-500"
                  : "bg-gray-400",
              )}
            />
            <p className="text-muted-foreground text-xs">{getLastSeenText()}</p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-muted-foreground text-xs">
            {messages?.length ?? 0} messages
          </p>
        </div>
      </div>

      <div
        className="bg-muted/20 flex-1 overflow-y-auto p-4"
        ref={scrollParentRef}
      >
        {messages.length === 0 ? (
          <div className="text-muted-foreground flex h-full items-center justify-center">
            No messages yet. Start the conversation!
          </div>
        ) : (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vi) => {
              const msg = messages[vi.index] as MessageType;
              return (
                <div
                  key={msg.id}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                  className="px-2 py-1"
                >
                  <Message
                    message={msg}
                    session={session}
                    onMessageUpdated={() =>
                      void utils.chat.getMessagesInfinite.invalidate({
                        chatRoomId,
                        limit: 50,
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t p-4">
        <form
          onSubmit={handleSendMessage}
          className="flex w-full items-center gap-2"
        >
          <Input
            type="text"
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
            disabled={sendMessage.isPending}
            autoFocus
          />
          <Button
            type="submit"
            size="icon"
            disabled={sendMessage.isPending || !text.trim()}
          >
            <Send className="h-5 w-5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
