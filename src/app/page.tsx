"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MessageSquare, Shield, Users, Zap } from "lucide-react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";

export default function AboutPage() {
  const { data: session } = useSession();

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      {/* Hero Section */}
      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-8 inline-flex items-center rounded-full border px-4 py-2 text-sm">
            <Zap className="mr-2 h-4 w-4 text-yellow-500" />
            <span>Built with T3 Stack - Lightning Fast</span>
          </div>

          <h1 className="mb-6 text-4xl font-bold tracking-tight sm:text-6xl">
            Real-time Chat Made{" "}
            <span className="from-primary to-primary/60 bg-linear-to-r bg-clip-text text-transparent">
              Simple
            </span>
          </h1>

          <p className="text-muted-foreground mb-8 text-lg sm:text-xl">
            Connect with anyone instantly. Send messages, edit within a minute,
            and enjoy lightning-fast real-time communication.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
            {session ? (
              <Link href="/chat">
                <Button size="lg" className="w-full sm:w-auto">
                  <MessageSquare className="mr-2 h-5 w-5" />
                  Open Chats
                </Button>
              </Link>
            ) : (
              <Button
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => signIn("google")}
              >
                Get Started Free
              </Button>
            )}
            <a
              href="https://github.com/darrellv14/livechat-t3stack"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                View on GitHub
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-muted/50 border-t py-16">
        <div className="container mx-auto px-4">
          <div className="mb-12 text-center">
            <h2 className="mb-4 text-3xl font-bold">Why Choose LiveChat?</h2>
            <p className="text-muted-foreground">
              Modern features for seamless communication
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <Zap className="mb-2 h-8 w-8 text-yellow-500" />
                <CardTitle>Lightning Fast</CardTitle>
                <CardDescription>
                  Messages update every 500ms. Experience real-time chat like
                  never before.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <MessageSquare className="mb-2 h-8 w-8 text-blue-500" />
                <CardTitle>1-on-1 Messaging</CardTitle>
                <CardDescription>
                  Direct messages with any user. Private and secure
                  conversations.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Shield className="mb-2 h-8 w-8 text-green-500" />
                <CardTitle>Edit & Delete</CardTitle>
                <CardDescription>
                  Made a typo? Edit or delete your messages within 1 minute.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <Users className="mb-2 h-8 w-8 text-purple-500" />
                <CardTitle>Group Chats</CardTitle>
                <CardDescription>
                  Create group conversations and chat with multiple people at
                  once.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <svg
                  className="mb-2 h-8 w-8 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <CardTitle>Optimistic Updates</CardTitle>
                <CardDescription>
                  Your messages appear instantly, even before the server
                  responds.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <svg
                  className="mb-2 h-8 w-8 text-indigo-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <CardTitle>Fully Responsive</CardTitle>
                <CardDescription>
                  Perfect experience on desktop, tablet, and mobile devices.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      {!session && (
        <section className="container mx-auto px-4 py-16">
          <Card className="border-primary/20 bg-primary/5 mx-auto max-w-2xl">
            <CardHeader className="text-center">
              <CardTitle className="text-3xl">
                Ready to Start Chatting?
              </CardTitle>
              <CardDescription className="text-lg">
                Join now and connect with friends instantly
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button size="lg" onClick={() => signIn("google")}>
                Sign in with Google
              </Button>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
