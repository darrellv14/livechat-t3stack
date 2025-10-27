"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { ArrowLeft, Send } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Message } from "./Message";

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

  const { data: messages, refetch } = api.chat.getMessages.useQuery(
    { chatRoomId },
    {
      enabled: !!chatRoomId && !!session,
      refetchInterval: 500, // Much faster polling - 500ms instead of 2000ms
      refetchIntervalInBackground: true, // Keep refetching even when tab is not focused
    },
  );

  const sendMessage = api.chat.sendMessage.useMutation({
    // Optimistic update - update UI immediately before server responds
    onMutate: async (newMessage) => {
      // Cancel outgoing refetches
      await utils.chat.getMessages.cancel({ chatRoomId });

      // Snapshot previous value
      const previousMessages = utils.chat.getMessages.getData({ chatRoomId });

      // Optimistically update with new message
      if (session?.user) {
        utils.chat.getMessages.setData({ chatRoomId }, (old) => {
          if (!old) return old;
          return [
            ...old,
            {
              id: `temp-${Date.now()}`, // Temporary ID
              text: newMessage.text,
              createdAt: new Date(),
              chatRoomId: newMessage.chatRoomId,
              userId: session.user.id,
              user: {
                id: session.user.id,
                name: session.user.name ?? null,
                email: session.user.email ?? null,
                image: session.user.image ?? null,
                emailVerified: null,
              },
            },
          ] as typeof old;
        });
      }

      return { previousMessages };
    },
    onError: (err, newMessage, context) => {
      // Rollback on error
      if (context?.previousMessages) {
        utils.chat.getMessages.setData(
          { chatRoomId },
          context.previousMessages,
        );
      }
    },
    onSuccess: () => {
      // Refetch to get real message from server
      void refetch();
      setText("");
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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
                onMessageUpdated={() => void refetch()}
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
