"use client";

import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";

export function useChatScroll(
  scrollParentRef: RefObject<HTMLDivElement | null>,
  messageCount: number,
) {
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(
    (behavior: "smooth" | "auto" = "smooth") => {
      const el = scrollParentRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior });
      }
    },
    [scrollParentRef],
  );

  // Effect to scroll to bottom when a new message arrives and we are already at the bottom
  useEffect(() => {
    if (isAtBottom) {
      // Use rAF to wait for DOM to update before scrolling
      requestAnimationFrame(() => scrollToBottom("auto"));
    }
  }, [messageCount, isAtBottom, scrollToBottom]); // Rerun when message count changes

  // Effect to track user's scroll position
  useEffect(() => {
    const el = scrollParentRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollHeight - scrollTop - clientHeight < 64;
      setIsAtBottom(atBottom);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [scrollParentRef]);

  return { scrollToBottom, isAtBottom };
}
