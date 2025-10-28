"use client";

import { env } from "@/env";
import { getPusherClient, subscribe, unsubscribe } from "@/lib/pusherClient";
import type { RouterOutputs } from "@/trpc/react";
import { api } from "@/trpc/react";
import { useEffect, useRef } from "react";
import type { ChatRoomProps } from "../ChatRoom";

type MessageType = RouterOutputs["chat"]["getMessages"][number];

/**
 * A unified function to add a new message to the infinite query cache.
 * This handles both optimistic updates and incoming Pusher messages.
 */
const addMessageToCache = (
  utils: ReturnType<typeof api.useUtils>,
  payload: MessageType,
  chatRoomId: string,
) => {
  utils.chat.getMessagesInfinite.setInfiniteData(
    { chatRoomId, limit: 50 },
    (data) => {
      if (!data) {
        return {
          pages: [{ items: [payload], nextCursor: undefined }],
          pageParams: [null],
        };
      }

      const pagesCopy = [...data.pages];
      const firstPage = pagesCopy[0];

      if (!firstPage) {
        pagesCopy[0] = { items: [payload], nextCursor: undefined };
        return { ...data, pages: pagesCopy };
      }

      // Remove optimistic message if a real one with its clientId arrives
      const filteredItems = firstPage.items.filter((item) => {
        if ("clientId" in payload && "clientId" in item) {
          return item.clientId !== payload.clientId;
        }
        return true;
      });

      // Append the new message to the end of the first page (items are ASC by time)
      // Ensure no duplicate by id
      const withoutDupById = filteredItems.filter((m) => m.id !== payload.id);
      const newItems = [...withoutDupById, payload];

      pagesCopy[0] = { ...firstPage, items: newItems };
      return { ...data, pages: pagesCopy };
    },
  );
};

export function useChatPusher({
  chatRoomId,
  session,
  onNewMessage,
}: ChatRoomProps & { onNewMessage: () => void }) {
  const utils = api.useUtils();
  const lastEventRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!chatRoomId || !env.NEXT_PUBLIC_PUSHER_KEY || !session) {
      return;
    }

    getPusherClient();
    const channel = subscribe(chatRoomId);

    const handleNewMessage = (payload: MessageType & { clientId?: string }) => {
      lastEventRef.current = Date.now();
      // Don't add our own messages again, they are handled optimistically
      if (payload.userId === session.user.id) {
        // We might still need to replace the temp message with the real one
        // The `addMessageToCache` function can be adapted if needed, but for now, let's keep it simple
        return;
      }

      addMessageToCache(utils, payload, chatRoomId);
      onNewMessage();

      // Invalidate and update chat list to show new last message
      void utils.chat.getChatRooms.invalidate();
    };

    const handleEditMessage = (payload: MessageType) => {
      lastEventRef.current = Date.now();
      utils.chat.getMessagesInfinite.setInfiniteData(
        { chatRoomId, limit: 50 },
        (data) => {
          if (!data) return data;
          return {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.map((m) => (m.id === payload.id ? payload : m)),
            })),
          };
        },
      );
    };

    const handleDeleteMessage = (payload: { messageId: string }) => {
      lastEventRef.current = Date.now();
      utils.chat.getMessagesInfinite.setInfiniteData(
        { chatRoomId, limit: 50 },
        (data) => {
          if (!data) return data;
          return {
            ...data,
            pages: data.pages.map((p) => ({
              ...p,
              items: p.items.filter((m) => m.id !== payload.messageId),
            })),
          };
        },
      );
      void utils.chat.getChatRooms.invalidate();
    };

    channel.bind("new-message", handleNewMessage);
    channel.bind("edit-message", handleEditMessage);
    channel.bind("delete-message", handleDeleteMessage);

    return () => {
      try {
        channel.unbind_all();
      } finally {
        unsubscribe(chatRoomId);
      }
    };
  }, [chatRoomId, utils, session, onNewMessage]);

  // Light fallback: if no events for a while (e.g., socket hiccup), invalidate to refetch
  useEffect(() => {
    if (!chatRoomId) return;
    const POLL_MS = 10000; // 10 seconds is a safe, light interval

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const idleFor = Date.now() - lastEventRef.current;
      if (idleFor >= POLL_MS) {
        void utils.chat.getMessagesInfinite.invalidate({ chatRoomId, limit: 50 });
      }
    };

    const interval = window.setInterval(tick, POLL_MS);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        lastEventRef.current = Date.now();
        void utils.chat.getMessagesInfinite.invalidate({ chatRoomId, limit: 50 });
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [chatRoomId, utils]);

  return { addMessageToCache };
}
