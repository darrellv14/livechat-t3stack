"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/trpc/react";
import type { RouterOutputs } from "@/trpc/react";
import { Check, Edit2, MoreVertical, Trash2, X } from "lucide-react";
import type { Session } from "next-auth";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type ChatMessage = RouterOutputs["chat"]["getMessages"][number];

interface MessageProps {
  message: ChatMessage;
  session: Session;
  onMessageUpdated?: () => void;
  decryptText?: (cipher: string) => Promise<string | null>;
}

export function Message({ message, session, onMessageUpdated, decryptText }: MessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [decrypted, setDecrypted] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const isCurrentUser = message.userId === session.user.id;
  const utils = api.useUtils();

  const editMutation = api.chat.editMessage.useMutation({
    onSuccess: () => {
      toast.success("Message edited");
      setIsEditing(false);
      void utils.chat.getMessages.invalidate();
      onMessageUpdated?.();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = api.chat.deleteMessage.useMutation({
    onSuccess: () => {
      toast.success("Message deleted");
      void utils.chat.getMessages.invalidate();
      onMessageUpdated?.();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleEdit = () => {
    if (editText.trim() && editText !== message.text) {
      editMutation.mutate({ messageId: message.id, text: editText.trim() });
    } else {
      setIsEditing(false);
    }
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this message?")) {
      deleteMutation.mutate({ messageId: message.id });
    }
  };

  const canEditOrDelete = () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const created = new Date(message.createdAt as unknown as string | number | Date);
    return created > oneMinuteAgo;
  };

  // Try to decrypt if encrypted
  const isEncrypted = typeof message.text === "string" && message.text.startsWith("enc:");
  useEffect(() => {
    let active = true;
    if (isEncrypted && decryptText) {
      void decryptText(message.text).then((pt) => {
        if (active) setDecrypted(pt);
      });
    } else {
      setDecrypted(null);
    }
    return () => {
      active = false;
    };
  }, [isEncrypted, decryptText, message.text]);

  const content = useMemo(() => {
    return isEncrypted ? (decrypted ?? "🔒 Encrypted message") : message.text;
  }, [isEncrypted, decrypted, message.text]);

  const showReadMore = useMemo(() => {
    if (!content) return false;
    // Heuristic: long texts likely need expansion
    const longByLength = content.length > 280;
    const longByLines = content.split(/\n/).length > 6;
    return longByLength || longByLines;
  }, [content]);

  return (
    <div
      className={cn(
        "flex items-end gap-2",
        isCurrentUser ? "flex-row-reverse" : "flex-row",
      )}
    >
      {!isCurrentUser && (
        <Avatar className="h-8 w-8">
          <AvatarImage
            src={message.user.image ?? ""}
            alt={message.user.name ?? "User"}
          />
          <AvatarFallback>
            {message.user.name?.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          "group relative max-w-[70%] rounded-lg px-4 py-2",
          isCurrentUser ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {!isCurrentUser && (
          <p className="mb-1 text-xs font-semibold opacity-70">
            {message.user.name}
          </p>
        )}

        {isEditing ? (
          <div className="flex items-center gap-2">
            <Input
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleEdit();
                if (e.key === "Escape") setIsEditing(false);
              }}
              className="h-8 text-sm"
              autoFocus
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleEdit}
              disabled={editMutation.isPending}
              className="h-8 w-8 p-0"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(false)}
              className="h-8 w-8 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <p className={cn(
              "text-sm wrap-break-word whitespace-pre-wrap text-justify",
              !expanded && showReadMore && "line-clamp-6",
            )}>
              {content}
            </p>
            {showReadMore && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className={cn(
                  "mt-1 text-xs underline",
                  isCurrentUser ? "opacity-90" : "opacity-70",
                )}
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
            {message.isEdited && (
              <p className="mt-1 text-xs opacity-50">(edited)</p>
            )}
          </>
        )}

        {isCurrentUser && !isEditing && canEditOrDelete() && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="absolute -top-2 right-0 h-6 w-6 p-0 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setIsEditing(true)}>
                <Edit2 className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDelete} className="text-red-600">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <p className="mt-1 text-xs opacity-50">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>

      {isCurrentUser && (
        <Avatar className="h-8 w-8">
          <AvatarImage
            src={session.user.image ?? ""}
            alt={session.user.name ?? "User"}
          />
          <AvatarFallback>
            {session.user.name?.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}
    </div>
  );
}
