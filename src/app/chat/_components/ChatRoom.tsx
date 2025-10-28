"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { ArrowLeft, Send } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Pusher from "pusher-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Message } from "./Message";
import { env } from "@/env";

type MessageType = RouterOutputs["chat"]["getMessages"][number];

export function ChatRoom({ 
  chatRoomId, 
  onBack 
}: { 
  chatRoomId: string;
  onBack?: () => void;
}) {
  const { data: session, status } = useSession();
  const [text, setText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const utils = api.useUtils();

  const { data: messages } = api.chat.getMessages.useQuery(
    { chatRoomId },
    {
      enabled: !!chatRoomId && !!session,
      // Disable polling now that we have WebSockets
      refetchInterval: false,
      refetchOnWindowFocus: false,
    },
  );

  const sendMessage = api.chat.sendMessage.useMutation({
    onSuccess: () => {
      // Clear input after successful send
      setText("");
      // No need to refetch here, Pusher will handle it
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Setup Pusher
  useEffect(() => {
    if (!chatRoomId || !env.NEXT_PUBLIC_PUSHER_KEY) {
      return;
    }

    const pusher = new Pusher(env.NEXT_PUBLIC_PUSHER_KEY, {
      cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
    });

    const channel = pusher.subscribe(chatRoomId);

    const handleInvalidate = () => {
      utils.chat.getMessages.invalidate({ chatRoomId });
      utils.chat.getChatRooms.invalidate();
    };

    channel.bind("new-message", handleInvalidate);
    channel.bind("edit-message", handleInvalidate);
    channel.bind("delete-message", handleInvalidate);

    return () => {
      pusher.unsubscribe(chatRoomId);
      pusher.disconnect();
    };
  }, [chatRoomId, utils]);

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && chatRoomId) {
      sendMessage.mutate({ text, chatRoomId });
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  if (status === "loading") {
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

  return (
    <div className="flex h-full flex-col">
      {/* Header with optional back button for mobile */}
      <div className="flex items-center gap-3 border-b p-4">
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
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Chat</h2>
          <p className="text-muted-foreground text-sm">
            {messages?.length ?? 0} messages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
          <span className="text-muted-foreground text-xs">Live</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {!messages || messages.length === 0 ? (
            <div className="text-muted-foreground flex h-full items-center justify-center">
              No messages yet. Start the conversation!
            </div>
          ) : (
            messages.map((msg: MessageType) => (
              <Message
                key={msg.id}
                message={msg}
                session={session}
                onMessageUpdated={() => utils.chat.getMessages.invalidate({ chatRoomId })}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
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
