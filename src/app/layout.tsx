import "@/styles/globals.css";

import { type Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { Geist } from "next/font/google";

import { Navbar } from "@/components/Navbar";
import { Toaster } from "@/components/ui/sonner";
import { TRPCReactProvider } from "@/trpc/react";
import { env } from "@/env";

export const metadata: Metadata = {
  title: "LiveChat - Real-time Messaging",
  description: "Real-time chat application built with T3 Stack",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable}`}>
      <head>
        {/* Preconnect to Pusher WebSocket endpoint to shave off DNS+TLS time */}
        {env.NEXT_PUBLIC_PUSHER_CLUSTER && (
          <link
            rel="preconnect"
            href={`https://ws-${env.NEXT_PUBLIC_PUSHER_CLUSTER}.pusher.com`}
            crossOrigin="anonymous"
          />
        )}
      </head>
      <body>
        <SessionProvider>
          <TRPCReactProvider>
            <div className="flex min-h-screen flex-col">
              <Navbar />
              <main className="flex-1">{children}</main>
            </div>
            <Toaster />
          </TRPCReactProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
