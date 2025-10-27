import { SessionProvider } from "next-auth/react";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}
