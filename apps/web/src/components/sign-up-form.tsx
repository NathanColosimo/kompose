import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import Loader from "./loader";
import { Button } from "./ui/button";

export default function SignUpForm() {
  const { isPending } = authClient.useSession();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Same Google entry point handles both sign in + sign up flows.
  const handleGoogleSignUp = async () => {
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
          newUserCallbackURL: `${baseUrl}/dashboard`,
          errorCallbackURL: `${baseUrl}/login`,
        },
        {
          onSuccess: () => {
            toast.success("You're in! Redirecting to your timeline.");
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
    <section className="space-y-6 rounded-3xl border border-border/60 bg-card/60 p-8 shadow-md">
      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.35em]">
          Create account
        </p>
        <h2 className="font-serif text-3xl">Start orchestrating hours</h2>
        <p className="text-muted-foreground text-sm">
          A Google account is all you need. Kompose spins up a workspace with
          calendar sync, tasks, and AI ready to go.
        </p>
      </div>
      <Button
        className="w-full"
        disabled={isAuthenticating}
        onClick={handleGoogleSignUp}
        size="lg"
        type="button"
        variant="outline"
      >
        {isAuthenticating ? "Contacting Google..." : "Create with Google"}
      </Button>
      <p className="text-center text-muted-foreground text-xs">
        No passwords to manage. You can revoke access anytime from your Google
        security dashboard.
      </p>
    </section>
  );
}
