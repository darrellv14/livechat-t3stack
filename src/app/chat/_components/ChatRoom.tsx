"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { ArrowLeft, Send } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { getPusherClient, subscribe, unsubscribe } from "@/lib/pusherClient";
import { useEffect, useRef, useState, type FormEvent, useCallback } from "react";
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
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const isUserScrollingRef = useRef(false);

  // Get chat room info for header
  const { data: chatRoom } = api.chat.getChatRoomById.useQuery(
    { chatRoomId },
    { 
      enabled: !!chatRoomId,
      refetchOnWindowFocus: false,
    }
  );

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
      refetchInterval: false,
      staleTime: 30000,
    },
  );

  const messages = pages?.pages.flatMap((p) => p.items) ?? [];

  const sendMessage = api.chat.sendMessage.useMutation({
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
        
        // Force scroll to bottom after sending
        setShouldAutoScroll(true);
        setTimeout(() => scrollToBottom(), 50);
        
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
      setText("");
    },
  });

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Check if user is at the bottom of the chat
  const checkIfAtBottom = useCallback(() => {
    const el = scrollParentRef.current;
    if (!el) return false;
    const threshold = 100; // pixels from bottom
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    return isAtBottom;
  }, []);

  // Handle user scrolling - detect if user manually scrolls
  useEffect(() => {
    const el = scrollParentRef.current;
    if (!el) return;

    const handleScroll = () => {
      const isAtBottom = checkIfAtBottom();
      setShouldAutoScroll(isAtBottom);
      
      // Detect if user is scrolling up
      if (!isAtBottom) {
        isUserScrollingRef.current = true;
      } else {
        isUserScrollingRef.current = false;
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [checkIfAtBottom]);

  // Only auto-scroll if user is at bottom or just sent a message
  useEffect(() => {
    if (shouldAutoScroll && messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length, shouldAutoScroll, scrollToBottom]);

    // Setup Pusher (singleton client)
  useEffect(() => {
    if (!chatRoomId || !env.NEXT_PUBLIC_PUSHER_KEY) {
      return;
    }

    getPusherClient();
    const channel = subscribe(chatRoomId);

  type EventMessage = Omit<MessageType, "user"> & { user: { id: string; name: string | null; image: string | null } } & { clientId?: string };
  channel.bind("new-message", (payload: EventMessage) => {
      utils.chat.getMessagesInfinite.setInfiniteData({ chatRoomId, limit: 50 }, (data) => {
        if (!data) {
          return {
            pages: [{ items: [payload], nextCursor: undefined }],
            pageParams: [undefined],
          } as unknown as typeof data;
        }
        const pagesCopy = [...data.pages];
        const lastPage = pagesCopy[pagesCopy.length - 1]!;
        const items = lastPage.items ?? [];
        
        // Remove temp message if exists
        const filteredItems = items.filter((m) => {
          if (typeof m.id === "string" && m.id.startsWith("temp-")) {
            if (payload.clientId && m.id === payload.clientId) return false;
            if (m.text === payload.text && m.userId === payload.user.id) return false;
          }
          return true;
        });
        
        // Check if message already exists
        const exists = filteredItems.some((m) => m.id === payload.id);
        const nextItems = exists 
          ? filteredItems.map((m) => (m.id === payload.id ? payload : m)) 
          : [...filteredItems, payload];
        
        pagesCopy[pagesCopy.length - 1] = { ...lastPage, items: nextItems };
        return { ...data, pages: pagesCopy };
      });
      
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
        updated.sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        return updated;
      });
      
      // Only auto-scroll if user is at the bottom or if it's the current user's message
      if (shouldAutoScroll || payload.user.id === session?.user.id) {
        setTimeout(() => scrollToBottom(), 50);
      }
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
  }, [chatRoomId, utils, scrollToBottom, shouldAutoScroll, session?.user.id]);

  // Virtualizer setup for messages
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 80,
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

  const handleSendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && chatRoomId) {
      const clientId = `temp-${Date.now()}`;
      sendMessage.mutate({ text: text.trim(), chatRoomId, clientId });
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

  // Get chat name and avatar for header
  const getChatInfo = () => {
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
      avatar: otherUser.image,
      lastSeen: otherUser.lastSeen,
    };
  };

  const chatInfo = getChatInfo();
  
  const getLastSeenText = () => {
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
        
        {/* Profile Picture */}
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={chatInfo.avatar ?? ""} alt={chatInfo.name} />
          <AvatarFallback>
            {chatInfo.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        
        {/* Name and Status */}
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold truncate">{chatInfo.name}</h2>
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "h-2 w-2 rounded-full",
              getLastSeenText() === "Online" ? "bg-green-500 animate-pulse" : "bg-gray-400"
            )} />
            <p className="text-muted-foreground text-xs">
              {getLastSeenText()}
            </p>
          </div>
        </div>
        
        {/* Message count */}
        <div className="text-right shrink-0">
          <p className="text-muted-foreground text-xs">
            {messages?.length ?? 0} messages
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-muted/20" ref={scrollParentRef}>
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
                    ref={(el) => {
                      if (el) rowVirtualizer.measureElement(el);
                    }}
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
