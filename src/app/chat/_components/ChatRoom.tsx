"use client";

import { useState, useEffect, useRef, type FormEvent } from "react";
import { api } from "@/trpc/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Message } from "./Message";
import { useSession } from "next-auth/react";
import type { RouterOutputs } from "@/trpc/react";

type MessageType = RouterOutputs["chat"]["getMessages"][number];

export function ChatRoom({ chatRoomId }: { chatRoomId: string }) {
  const { data: session, status } = useSession();
  const [text, setText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: messages, refetch } = api.chat.getMessages.useQuery(
    { chatRoomId },
    {
      enabled: !!chatRoomId && !!session,
      refetchInterval: 2000, // Using tRPC's built-in refetching
    }
  );

  const sendMessage = api.chat.sendMessage.useMutation({
    onSuccess: () => {
      void refetch();
      setText("");
    },
  });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && chatRoomId) {
      sendMessage.mutate({ text, chatRoomId });
    }
  };

  if (status === "loading") {
    return <div>Loading...</div>;
  }

  if (!session) {
    return <div>You must be logged in to chat.</div>;
  }

  return (
    <Card className="flex h-full max-h-screen flex-col">
      <CardHeader className="border-b">
        <h1 className="text-2xl font-bold">Live Chat - General</h1>
        <p className="text-sm text-muted-foreground">
          Chat in real-time with other users
        </p>
      </CardHeader>
      <CardContent className="grow overflow-y-auto p-4">
        <div className="space-y-4">
          {messages?.map((msg: MessageType) => (
            <Message key={msg.id} message={msg} session={session} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </CardContent>
      <CardFooter className="border-t p-4">
        <form onSubmit={handleSendMessage} className="flex w-full items-center gap-2">
          <Input
            type="text"
            placeholder="Type a message..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="grow"
            disabled={sendMessage.isPending}
          />
          <Button type="submit" disabled={sendMessage.isPending || !text.trim()}>
            {sendMessage.isPending ? "Sending..." : "Send"}
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
