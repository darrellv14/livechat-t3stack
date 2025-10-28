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
    // Re-introduce a minimal optimistic update for instant UX
    onMutate: async (newMessage) => {
      await utils.chat.getMessages.cancel({ chatRoomId });
      const previous = utils.chat.getMessages.getData({ chatRoomId });

      if (session?.user) {
        const tempId = newMessage.clientId ?? `temp-${Date.now()}`;
        utils.chat.getMessages.setData({ chatRoomId }, (old) => {
          if (!old) return old;
          return [
            ...old,
            {
              id: tempId,
              text: newMessage.text,
              createdAt: new Date(),
              updatedAt: new Date(),
              isEdited: false,
              isDeleted: false,
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
          ];
        });
        return { previous, tempId };
      }

      return { previous };
    },
    onError: (_err, _newMessage, ctx) => {
      if (ctx?.previous) {
        utils.chat.getMessages.setData({ chatRoomId }, ctx.previous);
      }
    },
    onSuccess: () => {
      // Clear input after successful send; Pusher event will reconcile/replace temp message
      setText("");
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

    // Apply updates directly to cache for instant UX (no refetch)
    channel.bind("new-message", (payload: MessageType & { clientId?: string }) => {
      utils.chat.getMessages.setData({ chatRoomId }, (old) => {
        if (!old) return [payload];
        const exists = old.some((m) => m.id === payload.id);
        let next = exists
          ? old.map((m) => (m.id === payload.id ? payload : m))
          : [...old, payload];
        // Remove optimistic temp by clientId (preferred), fallback to text/user heuristic
        next = next.filter((m) => {
          if (typeof m.id === "string" && m.id.startsWith("temp-")) {
            if (payload.clientId && m.id === payload.clientId) return false;
            if (m.text === payload.text && m.userId === payload.user.id) return false;
          }
          return true;
        });
        return next;
      });
      // Update chat list cache in-place (no network)
      utils.chat.getChatRooms.setData(undefined, (rooms) => {
        if (!rooms) return rooms;
        const updated = rooms.map((room) => {
          if (room.id !== payload.chatRoomId) return room;
          return {
            ...room,
            updatedAt: payload.createdAt,
            messages: [
              {
                id: payload.id,
                text: payload.text,
                createdAt: payload.createdAt,
                isDeleted: false,
                user: {
                  id: payload.user.id,
                  name: payload.user.name,
                },
              },
            ],
          } as typeof room;
        });
        // Sort by updatedAt desc to mirror server ordering
        updated.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        return updated;
      });
      // Scroll down when new message arrives
      scrollToBottom();
    });

    channel.bind("edit-message", (payload: MessageType) => {
      utils.chat.getMessages.setData({ chatRoomId }, (old) => {
        if (!old) return old;
        return old.map((m) => (m.id === payload.id ? payload : m));
      });
    });

    channel.bind("delete-message", (payload: { messageId: string }) => {
      utils.chat.getMessages.setData({ chatRoomId }, (old) => {
        if (!old) return old;
        return old.filter((m) => m.id !== payload.messageId);
      });
      // Also update chat list cache last message if it was the deleted one
      utils.chat.getChatRooms.setData(undefined, (rooms) => {
        if (!rooms) return rooms;
        return rooms.map((room) => {
          if (room.id !== chatRoomId) return room;
          const last = room.messages[0];
          if (!last || last.id !== payload.messageId) return room;
          return {
            ...room,
            messages: [],
          } as typeof room;
        });
      });
    });

    return () => {
      pusher.unsubscribe(chatRoomId);
      pusher.disconnect();
    };
    // utils is stable for tRPC, but we avoid resubscribing unnecessarily
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRoomId]);

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && chatRoomId) {
      const clientId = `temp-${Date.now()}`;
      sendMessage.mutate({ text, chatRoomId, clientId });
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
                onMessageUpdated={() => void utils.chat.getMessages.invalidate({ chatRoomId })}
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
