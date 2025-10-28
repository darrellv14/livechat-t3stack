"use client";

import { api } from "@/trpc/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";
import type { ChatRoomProps } from "../ChatRoom";

export function useChatMessages({ chatRoomId, session }: ChatRoomProps) {
  const scrollParentRef = useRef<HTMLDivElement>(null);

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
      // Disable polling, rely on Pusher for real-time updates
      refetchOnWindowFocus: false,
      refetchInterval: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 60 * 60 * 1000, // keep cached pages for 1 hour to preserve history when toggling
    },
  );

  // Flatten and enforce a stable ascending order across pages
  const messages = (pages?.pages.flatMap((p) => p.items) ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Virtualizer setup for messages
  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 80,
    overscan: 10,
    // Start with the newest message at the bottom
    // This is now managed by the scroll hook
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

  return {
    scrollParentRef,
    messages,
    msgStatus,
    rowVirtualizer,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  };
}
