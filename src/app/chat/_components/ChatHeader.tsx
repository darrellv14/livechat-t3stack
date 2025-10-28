"use client";

import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/trpc/react";
import { useSession } from "next-auth/react";
import { ArrowLeft, Lock, Unlock } from "lucide-react";

interface ChatHeaderProps {
  chatRoomId: string;
  onBack?: () => void;
  locked: boolean;
  onToggleLock?: () => void;
}

function formatLastSeen(date?: string | Date | null) {
  if (!date) return "last seen unknown";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "last seen just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `last seen ${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `last seen ${hr} hr ago`;
  const day = Math.round(hr / 24);
  return `last seen ${day} day${day > 1 ? "s" : ""} ago`;
}

export function ChatHeader({ chatRoomId, onBack, locked, onToggleLock }: ChatHeaderProps) {
  const { data: session } = useSession();
  const { data: room } = api.chat.getChatRoom.useQuery({ id: chatRoomId }, { enabled: !!chatRoomId });

  const isGroup = room?.isGroup ?? false;
  const other = !isGroup
    ? room?.users.find((u) => u.id !== session?.user?.id)
    : undefined;

  const title = isGroup ? room?.name ?? "Group" : other?.name ?? "Unknown";
  const avatarSrc = isGroup ? undefined : other?.image ?? undefined;
  const avatarFallback = isGroup ? (room?.name?.charAt(0) ?? "G").toUpperCase() : (other?.name?.charAt(0) ?? "U").toUpperCase();

  // Subtitle like WhatsApp: show live dot + e2e status or member count
  const now = Date.now();
  const thresholdMs = 30_000; // 30s for online
  let subtitle = "";
  if (isGroup) {
    const onlineCount = (room?.users ?? []).filter((u) => u.lastSeen && now - new Date(u.lastSeen).getTime() < thresholdMs).length;
    subtitle = `${room?.users.length ?? 0} members • ${onlineCount} online`;
  } else {
    const ls = other?.lastSeen ? new Date(other.lastSeen).getTime() : undefined;
    const isOnline = !!ls && now - ls < thresholdMs;
    subtitle = isOnline ? "online" : formatLastSeen(other?.lastSeen ?? null);
  }

  return (
    <div className="flex items-center gap-3 border-b p-3">
      {onBack && (
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0 md:hidden">
          <ArrowLeft className="h-5 w-5" />
        </Button>
      )}
      <Avatar className="h-10 w-10">
        {avatarSrc ? (
          <AvatarImage src={avatarSrc} alt={title ?? "User"} />
        ) : (
          <AvatarFallback>{avatarFallback}</AvatarFallback>
        )}
      </Avatar>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="font-semibold leading-none">{title}</p>
        </div>
        <p className="text-muted-foreground text-xs mt-1">{subtitle}{!isGroup ? (locked ? " • Not encrypted" : " • End-to-end encrypted") : null}</p>
      </div>
      {onToggleLock && (
        <Button variant="ghost" size="icon" onClick={onToggleLock} aria-label={locked ? "Enable encryption" : "Disable encryption"}>
          {locked ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}
        </Button>
      )}
    </div>
  );
}
