# LiveChat – T3 Stack

This is a [T3 Stack](https://create.t3.gg/) real-time chat application.

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs.

- [Next.js](https://nextjs.org)
- [NextAuth.js](https://next-auth.js.org)
- [Prisma](https://prisma.io)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Performance notes

This app is tuned for lower-latency real-time messaging:

- Single shared Pusher client to avoid multiple WebSocket connections from different components.
- WebSocket-only transport with TLS to skip xhr fallbacks and reduce overhead.
- Minimal database selects and compact Pusher payloads.
- Optimistic UI with client-generated IDs to render messages instantly while reconciling with the server.

Tips for best results:

- Pick the Pusher cluster nearest to your users and set `NEXT_PUBLIC_PUSHER_CLUSTER` accordingly.
- Ensure your database is in the same region as your app server to minimize DB RTT.
- Use a fast network and avoid VPNs for the lowest perceived latency.

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.
