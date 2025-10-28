import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { TRPCError } from "@trpc/server";
import { pusher } from "@/server/pusher";

export const chatRouter = createTRPCRouter({
  // Get all users for DM
  getUsers: protectedProcedure.query(async ({ ctx }) => {
    const users = await ctx.db.user.findMany({
      where: {
        NOT: {
          id: ctx.session.user.id,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
      orderBy: {
        name: "asc",
      },
      cacheStrategy: { ttl: 60, swr: 300 }, // Cache for 60s, stale-while-revalidate for 5 minutes
    });
    return users;
  }),

  // Get or create 1-on-1 chat
  getOrCreateDirectMessage: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check if chat already exists
      const existingChat = await ctx.db.chatRoom.findFirst({
        where: {
          isGroup: false,
          users: {
            every: {
              id: {
                in: [ctx.session.user.id, input.userId],
              },
            },
          },
        },
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });

      if (existingChat) {
        return existingChat;
      }

      // Create new chat
      const newChat = await ctx.db.chatRoom.create({
        data: {
          isGroup: false,
          users: {
            connect: [{ id: ctx.session.user.id }, { id: input.userId }],
          },
        },
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
            },
          },
        },
      });
      // Notify both participants they have a new DM room
      await Promise.all(
        newChat.users.map((u) =>
          pusher.trigger(`user-${u.id}`, "room-added", {
            id: newChat.id,
            updatedAt: newChat.updatedAt,
            isGroup: newChat.isGroup,
            name: null as string | null,
            users: newChat.users,
            messages: [],
          }),
        ),
      );
      return newChat;
    }),

  // Create a new group chat with provided members (including the current user)
  createGroup: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        userIds: z.array(z.string()).min(1), // at least one other member
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure the current user is part of the group
      const connectUsers = Array.from(
        new Set([ctx.session.user.id, ...input.userIds]),
      ).map((id) => ({ id }));

      const group = await ctx.db.chatRoom.create({
        data: {
          isGroup: true,
          name: input.name,
          users: {
            connect: connectUsers,
          },
        },
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              lastSeen: true,
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              text: true,
              createdAt: true,
              isDeleted: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      });

      // Notify all members via their user channel about the new room
      await Promise.all(
        group.users.map((u) =>
          pusher.trigger(`user-${u.id}`, "room-added", {
            id: group.id,
            updatedAt: group.updatedAt,
            isGroup: group.isGroup,
            name: group.name,
            users: group.users.map((uu) => ({
              id: uu.id,
              name: uu.name,
              email: uu.email,
              image: uu.image,
              lastSeen: uu.lastSeen,
            })),
            messages: group.messages,
          }),
        ),
      );
      return group;
    }),

  // Get all chat rooms for current user
  getChatRooms: protectedProcedure.query(async ({ ctx }) => {
    const chatRooms = await ctx.db.chatRoom.findMany({
      where: {
        users: {
          some: {
            id: ctx.session.user.id,
          },
        },
      },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            lastSeen: true,
          },
        },
        messages: {
          orderBy: {
            createdAt: "desc",
          },
          take: 1,
          select: {
            id: true,
            text: true,
            createdAt: true,
            isDeleted: true,
            user: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
      cacheStrategy: { ttl: 5, swr: 30 },
    });
    return chatRooms;
  }),

  // Get single chat room by ID for header info
  getChatRoomById: protectedProcedure
    .input(z.object({ chatRoomId: z.string() }))
    .query(async ({ ctx, input }) => {
      const chatRoom = (await ctx.db.chatRoom.findUnique({
        where: { id: input.chatRoomId },
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              lastSeen: true,
            },
          },
        },
        cacheStrategy: { ttl: 5, swr: 30 },
      })) as {
        id: string;
        isGroup: boolean;
        name: string | null;
        users: Array<{
          id: string;
          name: string | null;
          email: string | null;
          image: string | null;
          lastSeen: Date | null;
        }>;
      } | null;

      if (!chatRoom) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chat room not found",
        });
      }

      // Check if user is in this chat room
      const isMember = chatRoom.users.some((u) => u.id === ctx.session.user.id);
      if (!isMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this chat",
        });
      }

      return chatRoom;
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1),
        chatRoomId: z.string(),
        clientId: z.string().optional(),
        replyToId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Trigger Pusher event first for low-latency feel, don't await it
      void pusher.trigger(input.chatRoomId, "new-message", {
        // Temporary event so receivers see something instantly
        id: `server-temp-${Date.now()}`,
        text: input.text,
        createdAt: new Date(),
        updatedAt: new Date(),
        isEdited: false,
        isDeleted: false,
        chatRoomId: input.chatRoomId,
        userId: ctx.session.user.id,
        user: {
          id: ctx.session.user.id,
          name: ctx.session.user.name,
          image: ctx.session.user.image,
        },
        clientId: input.clientId,
        replyTo: undefined,
      });

      // Atomically create message and update room timestamp in the background
      const [message] = await ctx.db.$transaction([
        ctx.db.message.create({
          data: {
            text: input.text,
            chatRoomId: input.chatRoomId,
            userId: ctx.session.user.id,
            replyToId: input.replyToId ?? null,
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
            replyTo: {
              select: {
                id: true,
                text: true,
                user: { select: { id: true, name: true } },
              },
            },
          },
        }),
        ctx.db.chatRoom.update({
          where: { id: input.chatRoomId },
          data: { updatedAt: new Date() },
        }),
      ]);

      // Emit final event with persisted message id to replace temp/client copy
      await pusher.trigger(input.chatRoomId, "new-message", {
        id: message.id,
        text: message.text,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        isEdited: message.isEdited,
        isDeleted: message.isDeleted,
        chatRoomId: message.chatRoomId,
        userId: message.userId,
        user: {
          id: message.user.id,
          name: message.user.name,
          image: message.user.image,
        },
        clientId: input.clientId,
        replyTo: message.replyTo
      });

      // Also notify all participants via their user channel so that devices not subscribed to the room yet can update their chat list instantly
      const roomWithUsers = await ctx.db.chatRoom.findUnique({
        where: { id: input.chatRoomId },
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              lastSeen: true,
            },
          },
        },
      });
      if (roomWithUsers) {
        await Promise.all(
          roomWithUsers.users.map((u) =>
            pusher.trigger(`user-${u.id}`, "room-updated", {
              id: roomWithUsers.id,
              updatedAt: message.createdAt,
              isGroup: roomWithUsers.isGroup,
              name: roomWithUsers.name,
              users: roomWithUsers.users,
              messages: [
                {
                  id: message.id,
                  text: message.text,
                  createdAt: message.createdAt,
                  isDeleted: message.isDeleted,
                  user: { id: message.user.id, name: message.user.name },
                },
              ],
            }),
          ),
        );
      }

      return message;
    }),

  // Add members to a group chat
  addMembers: protectedProcedure
    .input(
      z.object({ chatRoomId: z.string(), userIds: z.array(z.string()).min(1) }),
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure room exists and is a group and caller is a member
      const room = await ctx.db.chatRoom.findUnique({
        where: { id: input.chatRoomId },
        include: { users: { select: { id: true } } },
      });
      if (!room)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chat room not found",
        });
      if (!room.isGroup)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a group chat",
        });
      if (!room.users.some((u) => u.id === ctx.session.user.id))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this group",
        });

      const updated = await ctx.db.chatRoom.update({
        where: { id: input.chatRoomId },
        data: {
          users: {
            connect: Array.from(new Set(input.userIds)).map((id) => ({ id })),
          },
        },
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              lastSeen: true,
            },
          },
        },
      });

      // Notify new members they were added
      await Promise.all(
        input.userIds.map((userId) =>
          pusher.trigger(`user-${userId}`, "room-added", {
            id: updated.id,
            updatedAt: updated.updatedAt,
            isGroup: updated.isGroup,
            name: updated.name,
            users: updated.users,
            messages: [],
          }),
        ),
      );

      // Notify existing members of membership update
      await Promise.all(
        updated.users.map((u) =>
          pusher.trigger(`user-${u.id}`, "room-members-updated", {
            id: updated.id,
            users: updated.users,
          }),
        ),
      );

      return updated;
    }),

  // Remove a member from a group chat
  removeMember: protectedProcedure
    .input(z.object({ chatRoomId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const room = await ctx.db.chatRoom.findUnique({
        where: { id: input.chatRoomId },
        include: { users: { select: { id: true } } },
      });
      if (!room)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chat room not found",
        });
      if (!room.isGroup)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a group chat",
        });
      if (!room.users.some((u) => u.id === ctx.session.user.id))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this group",
        });

      const updated = await ctx.db.chatRoom.update({
        where: { id: input.chatRoomId },
        data: {
          users: { disconnect: { id: input.userId } },
        },
        include: {
          users: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              lastSeen: true,
            },
          },
        },
      });

      // Notify removed user and existing members
      await pusher.trigger(`user-${input.userId}`, "room-removed", {
        id: updated.id,
      });
      await Promise.all(
        updated.users.map((u) =>
          pusher.trigger(`user-${u.id}`, "room-members-updated", {
            id: updated.id,
            users: updated.users,
          }),
        ),
      );
      return { success: true };
    }),

  // Rename a group chat
  renameGroup: protectedProcedure
    .input(z.object({ chatRoomId: z.string(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const room = await ctx.db.chatRoom.findUnique({
        where: { id: input.chatRoomId },
        include: { users: { select: { id: true } } },
      });
      if (!room)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chat room not found",
        });
      if (!room.isGroup)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a group chat",
        });
      if (!room.users.some((u) => u.id === ctx.session.user.id))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this group",
        });

      const updated = await ctx.db.chatRoom.update({
        where: { id: input.chatRoomId },
        data: { name: input.name },
        include: { users: { select: { id: true } } },
      });
      await Promise.all(
        updated.users.map((u) =>
          pusher.trigger(`user-${u.id}`, "room-renamed", {
            id: updated.id,
            name: input.name,
          }),
        ),
      );
      return updated;
    }),

  // Leave a group chat (current user)
  leaveGroup: protectedProcedure
    .input(z.object({ chatRoomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const room = await ctx.db.chatRoom.findUnique({
        where: { id: input.chatRoomId },
        include: { users: { select: { id: true } } },
      });
      if (!room)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chat room not found",
        });
      if (!room.isGroup)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Not a group chat",
        });
      if (!room.users.some((u) => u.id === ctx.session.user.id))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Not a member of this group",
        });

      // Disconnect current user
      const after = await ctx.db.chatRoom.update({
        where: { id: input.chatRoomId },
        data: { users: { disconnect: { id: ctx.session.user.id } } },
        include: { users: { select: { id: true } } },
      });

      // Notify current user and remaining members
      await pusher.trigger(`user-${ctx.session.user.id}`, "room-removed", {
        id: after.id,
      });
      await Promise.all(
        after.users.map((u) =>
          pusher.trigger(`user-${u.id}`, "room-members-updated", {
            id: after.id,
            users: after.users,
          }),
        ),
      );

      // Optionally delete room if empty
      if (after.users.length === 0) {
        await ctx.db.chatRoom.delete({ where: { id: input.chatRoomId } });
      }

      return { success: true };
    }),

  editMessage: protectedProcedure
    .input(z.object({ messageId: z.string(), text: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Check if message belongs to user
      const message = await ctx.db.message.findUnique({
        where: { id: input.messageId },
      });

      if (!message) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      if (message.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only edit your own messages",
        });
      }

      // Check if message is older than 1 minute
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      if (message.createdAt < oneMinuteAgo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot edit messages older than 1 minute",
        });
      }

      const updatedMessage = await ctx.db.message.update({
        where: { id: input.messageId },
        data: {
          text: input.text,
          isEdited: true,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              image: true,
              emailVerified: true,
            },
          },
        },
      });

      // Trigger Pusher event
      await pusher.trigger(
        updatedMessage.chatRoomId,
        "edit-message",
        updatedMessage,
      );

      return updatedMessage;
    }),

  deleteMessage: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Check if message belongs to user
      const message = await ctx.db.message.findUnique({
        where: { id: input.messageId },
      });

      if (!message) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Message not found",
        });
      }

      if (message.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only delete your own messages",
        });
      }

      // Check if message is older than 1 minute
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      if (message.createdAt < oneMinuteAgo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot delete messages older than 1 minute",
        });
      }

      // Trigger Pusher event before deleting
      await pusher.trigger(message.chatRoomId, "delete-message", {
        messageId: input.messageId,
      });

      await ctx.db.message.delete({
        where: { id: input.messageId },
      });

      return { success: true };
    }),

  getMessages: protectedProcedure
    .input(
      z.object({
        chatRoomId: z.string(),
        limit: z.number().optional().default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const messages = await ctx.db.message.findMany({
        where: {
          chatRoomId: input.chatRoomId,
          isDeleted: false,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          replyTo: {
            select: {
              id: true,
              text: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        take: input.limit,
      });
      return messages;
    }),

  // Infinite pagination optimized for chat: returns items ascending by time with a cursor for older messages
  getMessagesInfinite: protectedProcedure
    .input(
      z.object({
        chatRoomId: z.string(),
        limit: z.number().optional().default(50),
        cursor: z.string().optional(), // id of the message to fetch older than
      }),
    )
    .query(async ({ ctx, input }) => {
      const take = input.limit;

      // Fetch newest first (desc), then we'll reverse to asc for rendering
      const messagesDesc = await ctx.db.message.findMany({
        where: {
          chatRoomId: input.chatRoomId,
          isDeleted: false,
        },
        include: {
          user: {
            select: { id: true, name: true, image: true },
          },
          replyTo: {
            select: {
              id: true,
              text: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take,
        ...(input.cursor
          ? { cursor: { id: input.cursor }, skip: 1 } // fetch older than cursor
          : {}),
      });

      // Reverse to ascending for chat UI
      const items = messagesDesc.reverse();
      const nextCursor = items.length === take ? items[0]?.id : undefined; // oldest in this batch

      return { items, nextCursor };
    }),

  getOrCreateDefaultRoom: protectedProcedure.query(async ({ ctx }) => {
    let chatRoom = await ctx.db.chatRoom.findFirst({
      where: {
        name: "General",
        isGroup: true,
      },
      cacheStrategy: { ttl: 30, swr: 120 }, // Cache for 30s, stale-while-revalidate for 2 minutes
    });

    if (!chatRoom) {
      chatRoom = await ctx.db.chatRoom.create({
        data: {
          name: "General",
          isGroup: true,
          users: {
            connect: {
              id: ctx.session.user.id,
            },
          },
        },
      });
    } else {
      const userInRoom = await ctx.db.chatRoom.findFirst({
        where: {
          id: chatRoom.id,
          users: {
            some: {
              id: ctx.session.user.id,
            },
          },
        },
        cacheStrategy: { ttl: 30, swr: 120 },
      });

      if (!userInRoom) {
        chatRoom = await ctx.db.chatRoom.update({
          where: {
            id: chatRoom.id,
          },
          data: {
            users: {
              connect: {
                id: ctx.session.user.id,
              },
            },
          },
        });
      }
    }

    return chatRoom;
  }),
});
