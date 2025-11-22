import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import Loader from "./loader";
import { Button } from "./ui/button";

export default function SignInForm() {
  const { isPending } = authClient.useSession();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Google is the only auth path for now, so short-circuit everything else.
  const handleGoogleSignIn = async () => {
    if (isAuthenticating) {
      return;
    }
    setIsAuthenticating(true);
    try {
      const baseUrl = window.location.origin;
      await authClient.signIn.social(
        {
          provider: "google",
          callbackURL: `${baseUrl}/dashboard`,
          errorCallbackURL: `${baseUrl}/login`,
        },
        {
          onSuccess: () => {
            toast.success("Signed in. Redirecting to your workspace.");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        }
      );
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (isPending) {
    return <Loader />;
  }

  return (
    <section className="space-y-6 rounded-3xl border border-border/60 bg-card/80 p-8 shadow-lg">
      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.35em]">
          Sign in
        </p>
        <h2 className="font-serif text-3xl">Welcome back</h2>
        <p className="text-muted-foreground text-sm">
          Pick up where you left off. Kompose remembers your last plan, focus
          blocks, and AI threads.
        </p>
      </div>
      <Button
        className="w-full"
        disabled={isAuthenticating}
        onClick={handleGoogleSignIn}
        size="lg"
        type="button"
      >
        {isAuthenticating ? "Connecting to Google..." : "Continue with Google"}
      </Button>
      <p className="text-center text-muted-foreground text-xs">
        By continuing you agree to the Kompose Terms and Privacy Policy.
      </p>
    </section>
  );
}
