"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

export default function SignInPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/room";

  useEffect(() => {
    // Auto redirect to Google OAuth
    void signIn("google", { callbackUrl });
  }, [callbackUrl]);

  return (
    <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
      <div className="text-center">
        <div className="text-muted-foreground mb-4">Redirecting to Google...</div>
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
      </div>
    </div>
  );
}
