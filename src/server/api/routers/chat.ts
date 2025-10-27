import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

export const chatRouter = createTRPCRouter({
  sendMessage: protectedProcedure
    .input(z.object({ text: z.string(), chatRoomId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const message = await ctx.db.message.create({
        data: {
          text: input.text,
          chatRoomId: input.chatRoomId,
          userId: ctx.session.user.id,
        },
      });
      return message;
    }),

  getMessages: protectedProcedure
    .input(z.object({ chatRoomId: z.string() }))
    .query(async ({ ctx, input }) => {
      const messages = await ctx.db.message.findMany({
        where: {
          chatRoomId: input.chatRoomId,
        },
        include: {
          user: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      });
      return messages;
    }),

  createChatRoom: protectedProcedure
    .input(z.object({ name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const chatRoom = await ctx.db.chatRoom.create({
        data: {
          name: input.name,
          users: {
            connect: {
              id: ctx.session.user.id,
            },
          },
        },
      });
      return chatRoom;
    }),

  getOrCreateDefaultRoom: protectedProcedure.query(async ({ ctx }) => {
    // Try to find existing default room
    let chatRoom = await ctx.db.chatRoom.findFirst({
      where: {
        name: "General",
      },
    });

    // If no room exists, create one
    if (!chatRoom) {
      chatRoom = await ctx.db.chatRoom.create({
        data: {
          name: "General",
          users: {
            connect: {
              id: ctx.session.user.id,
            },
          },
        },
      });
    } else {
      // Check if user is already in the room
      const userInRoom = await ctx.db.chatRoom.findFirst({
        where: {
          id: chatRoom.id,
          users: {
            some: {
              id: ctx.session.user.id,
            },
          },
        },
      });

      // If not, add them
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
