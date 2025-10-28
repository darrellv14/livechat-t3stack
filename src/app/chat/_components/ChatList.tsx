"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";
import { MessageSquare, Plus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { getPusherClient, subscribe, unsubscribe } from "@/lib/pusherClient";
import { env } from "@/env";

interface ChatListProps {
  selectedChatId?: string;
  onSelectChat: (chatId: string) => void;
}

export function ChatList({ selectedChatId, onSelectChat }: ChatListProps) {
  const { data: session } = useSession();
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const { data: chatRooms, isLoading: loadingChats } =
    api.chat.getChatRooms.useQuery(undefined, {
      refetchOnWindowFocus: false,
      refetchInterval: false,
      staleTime: 10000,
    });
  const utils = api.useUtils();
  const { data: users } = api.chat.getUsers.useQuery();
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const createDM = api.chat.getOrCreateDirectMessage.useMutation({
    onSuccess: (chatRoom) => {
      onSelectChat(chatRoom.id);
      setIsNewChatOpen(false);
    },
  });

  const createGroup = api.chat.createGroup.useMutation({
    onSuccess: (group) => {
      // Ensure chat list refreshes and select the new group
      void utils.chat.getChatRooms.invalidate();
      onSelectChat(group.id);
      setIsNewChatOpen(false);
      setCreatingGroup(false);
      setGroupName("");
      setSelectedIds([]);
    },
  });

  const handleStartChat = (userId: string) => {
    createDM.mutate({ userId });
  };

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleCreateGroup = () => {
    if (!groupName.trim() || selectedIds.length === 0) return;
    createGroup.mutate({ name: groupName.trim(), userIds: selectedIds });
  };

  type ChatRoomItem = RouterOutputs["chat"]["getChatRooms"][number];

  type ChatUser = { id: string; name: string | null; image: string | null };
  type ChatLastMsg = {
    id: string;
    text: string;
    createdAt: Date | string;
    isDeleted: boolean;
    user: { id: string; name: string | null };
  };

  type ChatRoomView = ChatRoomItem &
    Partial<{ users: ChatUser[]; messages: ChatLastMsg[] }>;

  // Per-user channel batching types/refs
  type PendingEvent =
    | { type: "upsert"; room: RoomPayload }
    | { type: "remove"; roomId: string }
    | { type: "rename"; roomId: string; name: string }
    | { type: "members"; roomId: string; users: ChatUser[] };
  type RoomPayload = Partial<ChatRoomItem> & {
    id: string;
    updatedAt?: Date | string;
    name?: string | null;
    users?: ChatUser[];
    messages?: ChatLastMsg[];
    isGroup?: boolean;
  };
  const queueRef = useRef<PendingEvent[]>([]);
  const timerRef = useRef<number | null>(null);

  const getChatName = (chat: ChatRoomView): string => {
    if (chat.isGroup) {
      return chat.name ?? "Group Chat";
    }
    // For DM, show the other user's name
    const usersArr: ChatUser[] = Array.isArray(chat.users) ? chat.users : [];
    let otherUser: ChatUser | undefined = undefined;
    for (const u of usersArr) {
      if (u?.id && u.id !== session?.user?.id) {
        otherUser = u;
        break;
      }
    }
    return otherUser?.name ?? "Unknown User";
  };

  const getChatAvatar = (chat: ChatRoomView): string | null => {
    if (chat.isGroup) {
      return null;
    }
    const usersArr: ChatUser[] = Array.isArray(chat.users) ? chat.users : [];
    let otherUser: ChatUser | undefined = undefined;
    for (const u of usersArr) {
      if (u?.id && u.id !== session?.user?.id) {
        otherUser = u;
        break;
      }
    }
    return otherUser?.image ?? null;
  };

  const getLastMessage = (chat: ChatRoomView): string => {
    const msgs: ChatLastMsg[] = Array.isArray(chat.messages)
      ? chat.messages
      : [];
    const lastMsg = msgs[0];
    if (!lastMsg) return "No messages yet";
    if (lastMsg.isDeleted) return "Message deleted";
    return `${lastMsg.text}`;
  };

  // Subscribe to Pusher for each chat room to keep list in sync without polling
  useEffect(() => {
    if (!chatRooms || !env.NEXT_PUBLIC_PUSHER_KEY) return;
    getPusherClient();

    const subscriptions = chatRooms.map((room) => {
      const ch = subscribe(room.id);
      ch.bind(
        "new-message",
        (payload: {
          id: string;
          text: string;
          createdAt: string | Date;
          chatRoomId: string;
          user: { id: string; name: string | null };
        }) => {
          utils.chat.getChatRooms.setData(
            undefined,
            (rooms: RouterOutputs["chat"]["getChatRooms"] | undefined) => {
              if (!rooms) return rooms;

              let roomUpdated = false;
              const updated = rooms.map((r): ChatRoomItem => {
                if (r.id !== payload.chatRoomId) return r;
                roomUpdated = true;
                return {
                  ...r,
                  updatedAt: payload.createdAt as Date,
                  messages: [
                    {
                      id: payload.id,
                      text: payload.text,
                      createdAt: payload.createdAt as Date,
                      isDeleted: false,
                      user: { id: payload.user.id, name: payload.user.name },
                    },
                  ],
                } as ChatRoomItem;
              });

              // If room not found in cache, don't update - let refetch handle it
              if (!roomUpdated) return rooms;

              updated.sort(
                (a, b) =>
                  new Date(b.updatedAt).getTime() -
                  new Date(a.updatedAt).getTime(),
              );
              return updated;
            },
          );
        },
      );

      ch.bind("delete-message", (payload: { messageId: string }) => {
        utils.chat.getChatRooms.setData(
          undefined,
          (rooms: RouterOutputs["chat"]["getChatRooms"] | undefined) => {
            if (!rooms) return rooms;
            return rooms.map((r): ChatRoomItem => {
              if (r.id !== room.id) return r;
              const rWithMsgs = r as Partial<{ messages?: ChatLastMsg[] }>;
              const msgs: ChatLastMsg[] = Array.isArray(rWithMsgs.messages)
                ? rWithMsgs.messages
                : [];
              const last: ChatLastMsg | undefined = msgs[0];
              if (!last || last.id !== payload.messageId) return r;
              return { ...r, messages: [] } as ChatRoomItem;
            });
          },
        );
      });

      return ch;
    });

    return () => {
      subscriptions.forEach((ch) => {
        try {
          ch.unbind_all();
        } finally {
          unsubscribe(ch.name);
        }
      });
    };
  }, [chatRooms, utils]);

  // Subscribe to per-user channel to receive room-added/updated/removed and metadata changes
  useEffect(() => {
    if (!session?.user?.id || !env.NEXT_PUBLIC_PUSHER_KEY) return;
    getPusherClient();

    const userChannelName = `user-${session.user.id}`;
    const ch = subscribe(userChannelName);

    // Debounced queue to avoid flooding cache updates

    const flush = () => {
      const batch = queueRef.current;
      queueRef.current = [];
      timerRef.current = null;
      if (batch.length === 0) return;

      // Apply batched operations to cache in one mutation
      utils.chat.getChatRooms.setData(
        undefined,
        (rooms: RouterOutputs["chat"]["getChatRooms"] | undefined) => {
          let list = Array.isArray(rooms) ? [...rooms] : [];

          for (const ev of batch) {
            if (ev.type === "remove") {
              list = list.filter((r) => r.id !== ev.roomId);
              continue;
            }
            if (ev.type === "rename") {
              list = list.map((r) =>
                r.id === ev.roomId
                  ? ({ ...r, name: ev.name } as ChatRoomItem)
                  : r,
              );
              continue;
            }
            if (ev.type === "members") {
              list = list.map((r) =>
                r.id === ev.roomId
                  ? ({ ...r, users: ev.users } as ChatRoomItem)
                  : r,
              );
              continue;
            }
            if (ev.type === "upsert") {
              const idx = list.findIndex((r) => r.id === ev.room.id);
              if (idx === -1) {
                // Insert new room with minimal fields
                list.unshift({
                  id: ev.room.id,
                  isGroup: !!ev.room.isGroup,
                  name: ev.room.name ?? null,
                  updatedAt: (ev.room.updatedAt as Date | string | undefined) ?? new Date(),
                  users: (ev.room.users as ChatUser[] | undefined) ?? [],
                  messages:
                    (ev.room.messages as ChatLastMsg[] | undefined) ?? [],
                } as unknown as ChatRoomItem);
              } else {
                // Update existing room fields
                const current = list[idx] as ChatRoomView;
                const updated: ChatRoomView = {
                  ...current,
                  ...ev.room,
                } as ChatRoomView;
                list[idx] = updated as ChatRoomItem;
              }
            }
          }

          // Sort by updatedAt desc if any upsert happened
          list.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          return list;
        },
      );
    };

    const enqueue = (e: PendingEvent) => {
      queueRef.current.push(e);
      if (timerRef.current != null) return;
      timerRef.current = window.setTimeout(flush, 100);
    };

    ch.bind("room-added", (payload: RoomPayload) => {
      enqueue({ type: "upsert", room: payload });
    });
    ch.bind(
      "room-updated",
      (payload: RoomPayload) => {
        enqueue({ type: "upsert", room: payload });
      },
    );
    ch.bind("room-removed", (payload: { id: string }) => {
      enqueue({ type: "remove", roomId: payload.id });
    });
    ch.bind("room-renamed", (payload: { id: string; name: string }) => {
      enqueue({ type: "rename", roomId: payload.id, name: payload.name });
    });
    ch.bind(
      "room-members-updated",
      (payload: { id: string; users: ChatUser[] }) => {
        enqueue({ type: "members", roomId: payload.id, users: payload.users });
      },
    );

    return () => {
      try {
        ch.unbind_all();
      } finally {
        unsubscribe(userChannelName);
        if (timerRef.current != null) window.clearTimeout(timerRef.current);
      }
    };
  }, [session?.user?.id, utils]);

  if (loadingChats) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted-foreground">Loading chats...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-4">
        <h2 className="text-lg font-semibold">Messages</h2>
        <Dialog open={isNewChatOpen} onOpenChange={setIsNewChatOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost">
              <Plus className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {creatingGroup ? "New Group" : "New Chat"}
              </DialogTitle>
              <DialogDescription>
                {creatingGroup
                  ? "Select members and set a group name"
                  : "Select a user to start chatting"}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {creatingGroup ? (
                  <>
                    <div className="space-y-2 p-1">
                      <label className="text-sm font-medium">Group name</label>
                      <Input
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        placeholder="e.g. Team Alpha"
                      />
                    </div>
                    <div className="mt-2 text-sm font-medium">Members</div>
                    {users?.map((user) => (
                      <div
                        key={user.id}
                        className="hover:bg-muted flex w-full items-center gap-3 rounded-lg p-3 transition-colors"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={selectedIds.includes(user.id)}
                          onChange={() => toggleId(user.id)}
                        />
                        <Avatar>
                          <AvatarImage
                            src={user.image ?? ""}
                            alt={user.name ?? "User"}
                          />
                          <AvatarFallback>
                            {user.name?.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 text-left">
                          <p className="font-medium">{user.name}</p>
                          <p className="text-muted-foreground text-sm">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  users?.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => handleStartChat(user.id)}
                      disabled={createDM.isPending}
                      className="hover:bg-muted flex w-full items-center gap-3 rounded-lg p-3 transition-colors"
                    >
                      <Avatar>
                        <AvatarImage
                          src={user.image ?? ""}
                          alt={user.name ?? "User"}
                        />
                        <AvatarFallback>
                          {user.name?.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 text-left">
                        <p className="font-medium">{user.name}</p>
                        <p className="text-muted-foreground text-sm">
                          {user.email}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
            <div className="mt-3 flex items-center justify-between">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreatingGroup((v) => !v)}
              >
                {creatingGroup ? "Direct message" : "New group"}
              </Button>
              {creatingGroup ? (
                <Button
                  type="button"
                  onClick={handleCreateGroup}
                  disabled={
                    createGroup.isPending ||
                    !groupName.trim() ||
                    selectedIds.length === 0
                  }
                >
                  {createGroup.isPending ? "Creating..." : "Create group"}
                </Button>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1">
        {chatRooms && chatRooms.length > 0 ? (
          <div className="space-y-1 p-2">
            {chatRooms.map((chat) => (
              <button
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={cn(
                  "hover:bg-muted flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors",
                  selectedChatId === chat.id && "bg-muted",
                )}
              >
                <Avatar>
                  <AvatarImage
                    src={getChatAvatar(chat) ?? ""}
                    alt={getChatName(chat)}
                  />
                  <AvatarFallback>
                    {chat.isGroup ? (
                      <MessageSquare className="h-4 w-4" />
                    ) : (
                      getChatName(chat).charAt(0).toUpperCase()
                    )}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{getChatName(chat)}</p>
                    {chat.isGroup && <Badge variant="secondary">Group</Badge>}
                  </div>
                  <p className="text-muted-foreground line-clamp-3 text-sm wrap-break-word">
                    {getLastMessage(chat)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center p-4 text-center">
            <MessageSquare className="text-muted-foreground mb-4 h-12 w-12" />
            <p className="mb-2 font-medium">No chats yet</p>
            <p className="text-muted-foreground mb-4 text-sm">
              Start a new conversation with someone
            </p>
            <Button onClick={() => setIsNewChatOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Chat
            </Button>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
