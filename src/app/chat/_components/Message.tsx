"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useMemo, useState } from "react";
import { toast } from "sonner";

type ChatMessage = RouterOutputs["chat"]["getMessages"][number] &
  Partial<{
    replyTo: { id: string; text: string; user: { id: string; name: string | null } } | null;
  }>;

interface MessageProps {
  message: ChatMessage;
  session: Session;
  onMessageUpdated?: () => void;
  onReply?: (message: ChatMessage) => void;
}

export function Message({ message, session, onMessageUpdated, onReply }: MessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [expanded, setExpanded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isCurrentUser = message.userId === session.user.id;
  const utils = api.useUtils();
  const isTemporary =
    typeof message.id === "string" &&
    (message.id.startsWith("temp-") || message.id.startsWith("server-temp-"));

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
    setDeleteOpen(true);
  };

  const canEditOrDelete = () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const created = new Date(message.createdAt as unknown as string | number | Date);
    return created > oneMinuteAgo && !isTemporary;
  };

  const content = useMemo(() => {
    return message.text;
  }, [message.text]);

  const showReadMore = useMemo(() => {
    if (!content) return false;
    const longByLength = content.length > 280;
    const longByLines = content.split(/\n/).length > 6;
    return longByLength || longByLines;
  }, [content]);

  return (
    <div
      className={cn(
        "flex items-start gap-2 mb-1",
        isCurrentUser ? "justify-end" : "justify-start",
      )}
    >
      {/* Avatar untuk sender (kiri) */}
      {!isCurrentUser && (
        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
          <AvatarImage
            src={message.user.image ?? ""}
            alt={message.user.name ?? "User"}
          />
          <AvatarFallback>
            {message.user.name?.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}

      {/* Bubble Chat */}
      <div
        className={cn(
          "group relative max-w-[75%] sm:max-w-[70%] rounded-2xl px-3 py-2 shadow-sm",
          isCurrentUser 
            ? "bg-primary text-primary-foreground rounded-tr-sm" 
            : "bg-muted rounded-tl-sm",
        )}
      >
        {!isCurrentUser && (
          <p className="mb-0.5 text-xs font-semibold opacity-80">
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
              className={cn(
                "h-8 text-sm",
                isCurrentUser && "text-primary-foreground"
              )}
              autoFocus
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleEdit}
              disabled={editMutation.isPending}
              className={cn(
                "h-8 w-8 p-0",
                isCurrentUser && "text-primary-foreground hover:bg-primary/90"
              )}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(false)}
              className={cn(
                "h-8 w-8 p-0",
                isCurrentUser && "text-primary-foreground hover:bg-primary/90"
              )}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            {message.replyTo && (
              <div
                className={cn(
                  "mb-1 max-w-full overflow-hidden rounded-md border px-2 py-1 text-xs",
                  isCurrentUser ? "border-white/30" : "border-foreground/10",
                )}
              >
                <p className="truncate font-semibold opacity-80">
                  {message.replyTo?.user?.name ?? "User"}
                </p>
                <p className="line-clamp-2 wrap-break-word whitespace-pre-wrap opacity-70">
                  {message.replyTo?.text}
                </p>
              </div>
            )}
            <p
              className={cn(
                "text-sm wrap-break-word whitespace-pre-wrap",
                !expanded && showReadMore && "line-clamp-6",
              )}
            >
              {content}
            </p>
            {showReadMore && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className={cn(
                  "mt-1 text-xs underline",
                  isCurrentUser ? "opacity-90 hover:opacity-100" : "opacity-70 hover:opacity-90",
                )}
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
            
            <div className="flex items-center justify-between gap-2 mt-1">
              <p className={cn(
                "text-[10px] leading-none",
                isCurrentUser ? "opacity-70" : "opacity-60"
              )}>
                {new Date(message.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {message.isEdited && " • edited"}
              </p>
            </div>
          </>
        )}

        {!isEditing && (
          <>
            {isCurrentUser && canEditOrDelete() ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "absolute -top-2 -right-2 h-7 w-7 p-0 rounded-full",
                      "opacity-0 transition-opacity group-hover:opacity-100",
                      "bg-background/80 hover:bg-background shadow-md"
                    )}
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onReply?.(message)}>
                    <Edit2 className="mr-2 h-4 w-4 rotate-180" />
                    Reply
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsEditing(true)} disabled={isTemporary}>
                    <Edit2 className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} className="text-red-600" disabled={isTemporary}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              // For messages not authored by current user (or when edit/delete not allowed), still allow Reply
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cn(
                      "absolute -top-2 -right-2 h-7 w-7 p-0 rounded-full",
                      "opacity-0 transition-opacity group-hover:opacity-100",
                      "bg-background/80 hover:bg-background shadow-md"
                    )}
                    aria-label="Message actions"
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onReply?.(message)}>
                    <Edit2 className="mr-2 h-4 w-4 rotate-180" />
                    Reply
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>

      {/* Avatar untuk current user (kanan) */}
      {isCurrentUser && (
        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
          <AvatarImage
            src={session.user.image ?? ""}
            alt={session.user.name ?? "User"}
          />
          <AvatarFallback>
            {session.user.name?.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete message?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The message will be permanently removed for everyone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                deleteMutation.mutate(
                  { messageId: message.id },
                  { onSuccess: () => setDeleteOpen(false) },
                );
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
