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
import { cn } from "@/lib/utils";
import { api, type RouterOutputs } from "@/trpc/react";
import { MessageSquare, Plus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
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
  const createDM = api.chat.getOrCreateDirectMessage.useMutation({
    onSuccess: (chatRoom) => {
      onSelectChat(chatRoom.id);
      setIsNewChatOpen(false);
    },
  });

  const handleStartChat = (userId: string) => {
    createDM.mutate({ userId });
  };

  type ChatRoomItem = RouterOutputs["chat"]["getChatRooms"][number];

  const getChatName = (chat: ChatRoomItem): string => {
    if (chat.isGroup) {
      return chat.name ?? "Group Chat";
    }
    // For DM, show the other user's name
    const otherUser = chat.users.find((u) => u.id !== session?.user?.id);
    return otherUser?.name ?? "Unknown User";
  };

  const getChatAvatar = (chat: ChatRoomItem): string | null => {
    if (chat.isGroup) {
      return null;
    }
    const otherUser = chat.users.find((u) => u.id !== session?.user?.id);
    return otherUser?.image ?? null;
  };

  const getLastMessage = (chat: ChatRoomItem): string => {
    const lastMsg = chat.messages[0];
    if (!lastMsg) return "No messages yet";
    if (lastMsg.isDeleted) return "Message deleted";
    const userName = lastMsg.user.name ?? "User";
    return `${userName}: ${lastMsg.text}`;
  };

  // Subscribe to Pusher for each chat room to keep list in sync without polling
  useEffect(() => {
    if (!chatRooms || !env.NEXT_PUBLIC_PUSHER_KEY) return;
    getPusherClient();

    const subscriptions = chatRooms.map((room) => {
      const ch = subscribe(room.id);
      ch.bind("new-message", (payload: {
        id: string;
        text: string;
        createdAt: string | Date;
        chatRoomId: string;
        user: { id: string; name: string | null };
      }) => {
        utils.chat.getChatRooms.setData(undefined, (rooms: RouterOutputs["chat"]["getChatRooms"] | undefined) => {
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
            } satisfies ChatRoomItem;
          });
          
          // If room not found in cache, don't update - let refetch handle it
          if (!roomUpdated) return rooms;
          
          updated.sort(
            (a, b) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          return updated;
        });
      });

      ch.bind("delete-message", (payload: { messageId: string }) => {
        utils.chat.getChatRooms.setData(undefined, (rooms: RouterOutputs["chat"]["getChatRooms"] | undefined) => {
          if (!rooms) return rooms;
          return rooms.map((r): ChatRoomItem => {
            if (r.id !== room.id) return r;
            const last = r.messages[0];
            if (!last || last.id !== payload.messageId) return r;
            return { ...r, messages: [] } satisfies ChatRoomItem;
          });
        });
      });

      return ch;
    });

    return () => {
      subscriptions.forEach((ch) => unsubscribe(ch.name));
    };
  }, [chatRooms, utils]);

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
              <DialogTitle>New Chat</DialogTitle>
              <DialogDescription>
                Select a user to start chatting
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="h-[300px]">
              <div className="space-y-2">
                {users?.map((user) => (
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
                ))}
              </div>
            </ScrollArea>
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
                  <p className="text-muted-foreground text-sm wrap-break-word line-clamp-3">
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
