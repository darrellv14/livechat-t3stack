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

// Update ChatList cache instantly without refetch for snappy sidebar
const updateChatRoomsCache = (
  utils: ReturnType<typeof api.useUtils>,
  payload: MessageType,
) => {
  utils.chat.getChatRooms.setData(
    undefined,
    (rooms: RouterOutputs["chat"]["getChatRooms"] | undefined) => {
      if (!rooms) return rooms;
      let touched = false;
      const updated = rooms.map((r) => {
        if (r.id !== payload.chatRoomId) return r;
        touched = true;
        return {
          ...r,
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
        } as (typeof rooms)[number];
      });
      if (!touched) return rooms;
      updated.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      return updated;
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
      // Always pass through cache updater. It will replace optimistic by clientId and dedup by id.
      addMessageToCache(utils, payload, chatRoomId);
      updateChatRoomsCache(utils, payload);
      onNewMessage();
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
      // We skip invalidate here; ChatList is updated on its own via Pusher
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

  // Smarter fallback: one-shot idle timer with exponential backoff + refetch on reconnect/visibility
  useEffect(() => {
    if (!chatRoomId) return;

    const BASE_MS = 15000; // 15s base idle window
    const MAX_MS = 60000; // cap backoff at 60s
    let timeoutId: number | null = null;
    let backoff = BASE_MS;

    const schedule = () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") {
          // Don't refetch while hidden; try again later
          backoff = Math.min(backoff * 2, MAX_MS);
          schedule();
          return;
        }
        void utils.chat.getMessagesInfinite.invalidate({ chatRoomId, limit: 50 });
        backoff = Math.min(backoff * 2, MAX_MS);
        schedule();
      }, backoff);
    };

    const reset = () => {
      backoff = BASE_MS;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      schedule();
    };

    // Kick off timer
    reset();

    // Reset on visibility gain
    const onVis = () => {
      if (document.visibilityState === "visible") {
        lastEventRef.current = Date.now();
        void utils.chat.getMessagesInfinite.invalidate({ chatRoomId, limit: 50 });
        reset();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    // Reset on pusher reconnect
    try {
      const client = getPusherClient();
      client.connection.bind("connected", () => {
        lastEventRef.current = Date.now();
        void utils.chat.getMessagesInfinite.invalidate({ chatRoomId, limit: 50 });
        reset();
      });
    } catch {}

    // Also reset after any event (covered by handlers above), but ensure timer is fresh periodically
    const softTick = window.setInterval(() => {
      // If we've received events recently, just keep base backoff
      const idle = Date.now() - lastEventRef.current;
      if (idle < BASE_MS) {
        backoff = BASE_MS;
      }
    }, BASE_MS);

    return () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
      window.clearInterval(softTick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [chatRoomId, utils]);

  return { addMessageToCache };
}
