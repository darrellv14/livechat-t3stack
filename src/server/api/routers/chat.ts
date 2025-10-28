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

      return newChat;
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
      cacheStrategy: { ttl: 10, swr: 60 }, // Cache for 10s, stale-while-revalidate for 1 minute
    });
    return chatRooms;
  }),

  sendMessage: protectedProcedure
    .input(z.object({ text: z.string().min(1), chatRoomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const message = await ctx.db.message.create({
        data: {
          text: input.text,
          chatRoomId: input.chatRoomId,
          userId: ctx.session.user.id,
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

      // Update chatRoom updatedAt
      await ctx.db.chatRoom.update({
        where: { id: input.chatRoomId },
        data: { updatedAt: new Date() },
      });

      // Trigger Pusher event
      await pusher.trigger(input.chatRoomId, "new-message", message);

      return message;
    }),

  editMessage: protectedProcedure
    .input(z.object({ messageId: z.string(), text: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      // Check if message belongs to user
      const message = await ctx.db.message.findUnique({
        where: { id: input.messageId },
      });

      if (!message) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      }

      if (message.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only edit your own messages" });
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
      await pusher.trigger(updatedMessage.chatRoomId, "edit-message", updatedMessage);

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
        throw new TRPCError({ code: "NOT_FOUND", message: "Message not found" });
      }

      if (message.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own messages" });
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
      await pusher.trigger(message.chatRoomId, "delete-message", { messageId: input.messageId });

      await ctx.db.message.delete({
        where: { id: input.messageId },
      });

      return { success: true };
    }),

  getMessages: protectedProcedure
    .input(z.object({ chatRoomId: z.string(), limit: z.number().optional().default(100) }))
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
              email: true,
              image: true,
              emailVerified: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
        take: input.limit,
        cacheStrategy: { ttl: 5, swr: 30 }, // Cache for 5s, stale-while-revalidate for 30s
      });
      return messages;
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
