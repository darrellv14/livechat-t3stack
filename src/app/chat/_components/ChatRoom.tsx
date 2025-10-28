"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { ArrowLeft, Send } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { getPusherClient, subscribe, unsubscribe } from "@/lib/pusherClient";
import { deriveKeyFromPassphrase, encryptText, decryptText as decryptTextFn, randomBytes } from "@/lib/crypto";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const utils = api.useUtils();
  const [roomKey, setRoomKey] = useState<CryptoKey | null>(null);
  const [locked, setLocked] = useState(true);

  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status: msgStatus,
  } = api.chat.getMessagesInfinite.useInfiniteQuery(
    { chatRoomId, limit: 50 },
    {
      enabled: !!chatRoomId && !!session,
      getNextPageParam: (last) => last.nextCursor,
      refetchOnWindowFocus: false,
    },
  );

  const messages = pages?.pages.flatMap((p) => p.items) ?? [];

  const sendMessage = api.chat.sendMessage.useMutation({
    // Re-introduce a minimal optimistic update for instant UX
    onMutate: async (newMessage) => {
      await utils.chat.getMessagesInfinite.cancel({ chatRoomId, limit: 50 });
      const previous = utils.chat.getMessagesInfinite.getInfiniteData({ chatRoomId, limit: 50 });

      if (session?.user) {
        const tempId = newMessage.clientId ?? `temp-${Date.now()}`;
        const tempMsg = {
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
            image: session.user.image ?? null,
          },
        } as MessageType;
        utils.chat.getMessagesInfinite.setInfiniteData({ chatRoomId, limit: 50 }, (data) => {
          if (!data || data.pages.length === 0) {
            return { pages: [{ items: [tempMsg], nextCursor: undefined }], pageParams: [undefined] } as unknown as typeof data;
          }
          const pagesCopy = [...data.pages];
          const last = pagesCopy[pagesCopy.length - 1]!;
          pagesCopy[pagesCopy.length - 1] = { ...last, items: [...last.items, tempMsg] };
          return { ...data, pages: pagesCopy };
        });
        return { previous, tempId };
      }

      return { previous };
    },
    onError: (_err, _newMessage, ctx) => {
      if (ctx?.previous) {
        utils.chat.getMessagesInfinite.setInfiniteData({ chatRoomId, limit: 50 }, () => ctx.previous);
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
  }, [messages.length]);

  // Setup Pusher (singleton client)
  useEffect(() => {
    if (!chatRoomId || !env.NEXT_PUBLIC_PUSHER_KEY) {
      return;
    }

    // Ensure client is initialized
    getPusherClient();
    const channel = subscribe(chatRoomId);

    // Apply updates directly to cache for instant UX (no refetch)
  type EventMessage = Omit<MessageType, "user"> & { user: { id: string; name: string | null; image: string | null } } & { clientId?: string };
  channel.bind("new-message", (payload: EventMessage) => {
      // Update infinite cache (append to newest page)
      utils.chat.getMessagesInfinite.setInfiniteData({ chatRoomId, limit: 50 }, (data) => {
        if (!data) {
          return {
            pages: [{ items: [payload], nextCursor: undefined }],
            pageParams: [undefined],
          } as unknown as typeof data;
        }
        // Append to the last page
        const pagesCopy = [...data.pages];
        const lastPage = pagesCopy[pagesCopy.length - 1]!;
        const items = lastPage.items ?? [];
        const exists = items.some((m) => m.id === payload.id);
        const nextItems = exists ? items.map((m) => (m.id === payload.id ? payload : m)) : [...items, payload];
        // Remove optimistic temp
        const deduped = nextItems.filter((m) => {
          if (typeof m.id === "string" && m.id.startsWith("temp-")) {
            if (payload.clientId && m.id === payload.clientId) return false;
            if (m.text === payload.text && m.userId === payload.user.id) return false;
          }
          return true;
        });
        pagesCopy[pagesCopy.length - 1] = { ...lastPage, items: deduped };
        return { ...data, pages: pagesCopy };
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
      utils.chat.getMessagesInfinite.setInfiniteData({ chatRoomId, limit: 50 }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((m) => (m.id === payload.id ? payload : m)),
          })),
        };
      });
    });

    channel.bind("delete-message", (payload: { messageId: string }) => {
      utils.chat.getMessagesInfinite.setInfiniteData({ chatRoomId, limit: 50 }, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.filter((m) => m.id !== payload.messageId),
          })),
        };
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
      unsubscribe(chatRoomId);
    };
    // utils is stable for tRPC, but we avoid resubscribing unnecessarily
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatRoomId]);

  // Virtualizer setup for messages
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  // Infinite scroll upwards when near top
  useEffect(() => {
    const el = scrollParentRef.current;
    if (!el) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (el.scrollTop < 200 && hasNextPage && !isFetchingNextPage) {
          const prevHeight = el.scrollHeight;
          void fetchNextPage().then(() => {
            // maintain scroll position so content doesn't jump
            const newHeight = el.scrollHeight;
            el.scrollTop += newHeight - prevHeight;
          });
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // Decrypt helper passed to Message components
  const decryptHelper = roomKey
    ? async (cipher: string) => decryptTextFn(roomKey, cipher)
    : async () => null;

  // Key management: prompt for passphrase to derive key
  const handleSetKey = async () => {
    const pass = prompt("Enter shared passphrase for this room:");
    if (!pass) return;
    // If salt exists reuse, else create
    const lsKey = `chat-salt:${chatRoomId}`;
    let saltB64 = localStorage.getItem(lsKey);
    if (!saltB64) {
      const salt = randomBytes(16);
      saltB64 = btoa(String.fromCharCode(...salt));
      localStorage.setItem(lsKey, saltB64);
    }
    const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
    const key = await deriveKeyFromPassphrase(pass, salt);
    setRoomKey(key);
    setLocked(false);
  };

  const handleLock = () => {
    setRoomKey(null);
    setLocked(true);
  };

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && chatRoomId) {
      const clientId = `temp-${Date.now()}`;
      const outgoing = roomKey ? await encryptText(roomKey, text.trim()) : text.trim();
      sendMessage.mutate({ text: outgoing, chatRoomId, clientId });
    }
  };

  // Handle keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
  void handleSendMessage(e);
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
          <Button size="sm" variant="ghost" onClick={locked ? handleSetKey : handleLock}>
            {locked ? "Unlock" : "Lock"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4" ref={scrollParentRef}>
        {!messages || messages.length === 0 ? (
            <div className="text-muted-foreground flex h-full items-center justify-center">
              No messages yet. Start the conversation!
            </div>
          ) : (
            <div
              style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}
            >
              
              {rowVirtualizer.getVirtualItems().map((vi) => {
                const msg = messages[vi.index] as MessageType;
                return (
                  <div
                    key={msg.id}
                    ref={rowVirtualizer.measureElement}
                    data-index={vi.index}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vi.start}px)`,
                    }}
                    className="pb-2"
                  >
                    <Message
                      message={msg}
                      session={session}
                      decryptText={decryptHelper}
                      onMessageUpdated={() =>
                        void utils.chat.getMessagesInfinite.invalidate({ chatRoomId, limit: 50 })
                      }
                    />
                  </div>
                );
              })}
              
              <div ref={messagesEndRef} />
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
