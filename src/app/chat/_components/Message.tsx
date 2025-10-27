"use client";

import type { Message as MessageType, User } from "@prisma/client";
import type { Session } from "next-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface MessageProps {
  message: MessageType & { user: User };
  session: Session;
}

export function Message({ message, session }: MessageProps) {
  const isCurrentUser = message.userId === session.user.id;

  return (
    <div
      className={cn(
        "flex items-end space-x-2",
        isCurrentUser ? "justify-end" : "justify-start"
      )}
    >
      {!isCurrentUser && (
        <Avatar className="h-8 w-8">
          <AvatarImage src={message.user.image ?? ""} alt={message.user.name ?? "User"} />
          <AvatarFallback>{message.user.name?.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          "max-w-xs rounded-lg p-3",
          isCurrentUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        <p className="text-sm">{message.text}</p>
      </div>
      {isCurrentUser && (
        <Avatar className="h-8 w-8">
          <AvatarImage src={session.user.image ?? ""} alt={session.user.name ?? "User"} />
          <AvatarFallback>{session.user.name?.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
