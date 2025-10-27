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
import { api } from "@/trpc/react";
import { MessageSquare, Plus } from "lucide-react";
import { useSession } from "next-auth/react";
import { useState } from "react";

interface ChatListProps {
  selectedChatId?: string;
  onSelectChat: (chatId: string) => void;
}

export function ChatList({ selectedChatId, onSelectChat }: ChatListProps) {
  const { data: session } = useSession();
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const { data: chatRooms, isLoading: loadingChats } =
    api.chat.getChatRooms.useQuery(undefined, {
      refetchInterval: 2000,
    });
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

  const getChatName = (chat: NonNullable<typeof chatRooms>[number]) => {
    if (chat.isGroup) {
      return chat.name ?? "Group Chat";
    }
    // For DM, show the other user's name
    const otherUser = chat.users.find((u) => u.id !== session?.user?.id);
    return otherUser?.name ?? "Unknown User";
  };

  const getChatAvatar = (chat: NonNullable<typeof chatRooms>[number]) => {
    if (chat.isGroup) {
      return null;
    }
    const otherUser = chat.users.find((u) => u.id !== session?.user?.id);
    return otherUser?.image ?? null;
  };

  const getLastMessage = (chat: NonNullable<typeof chatRooms>[number]) => {
    const lastMsg = chat.messages[0];
    if (!lastMsg) return "No messages yet";
    if (lastMsg.isDeleted) return "Message deleted";
    return `${lastMsg.user.name}: ${lastMsg.text}`;
  };

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
                  <p className="text-muted-foreground truncate text-sm">
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
