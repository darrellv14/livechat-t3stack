import Pusher, { type Channel } from "pusher-js";
import { env } from "@/env";

// Ensure a single Pusher connection across the app to reduce connection overhead
let _pusher: Pusher | null = null;

export const getPusherClient = () => {
  if (_pusher) return _pusher;
  if (!env.NEXT_PUBLIC_PUSHER_KEY) {
    throw new Error("Pusher key is missing");
  }

  // Configure for lowest-latency websocket transport and disable unused fallbacks/stats
  _pusher = new Pusher(env.NEXT_PUBLIC_PUSHER_KEY, {
    cluster: env.NEXT_PUBLIC_PUSHER_CLUSTER,
    forceTLS: true,
    // Prefer pure websockets only; avoid xhr fallbacks which add overhead
    enabledTransports: ["wss"],
    disabledTransports: ["xhr_streaming", "xhr_polling", "sockjs"],
    // Reduce client-side overhead
    enableStats: false as unknown as undefined, // pusher-js v8 ignores, kept for backward compat
    activityTimeout: 30000,
  });

  return _pusher;
};

export const subscribe = (channelName: string): Channel => {
  const client = getPusherClient();
  return client.subscribe(channelName);
};

export const unsubscribe = (channelName: string) => {
  try {
    const client = getPusherClient();
    client.unsubscribe(channelName);
  } catch {
    // noop
  }
};
