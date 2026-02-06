import { authClient } from "@/lib/auth-client";
import Loader from "../loader";
import { SocialAccountButtons } from "./social-account-buttons";

export default function SignUpForm() {
  const { isPending } = authClient.useSession();

  if (isPending) {
    return <Loader />;
  }

  return (
    <section className="space-y-6 rounded-3xl border border-border/60 bg-card/60 p-8 shadow-md">
      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-xs uppercase tracking-[0.35em]">
          Create account
        </p>
        <h2 className="font-serif text-3xl">Create your Kompose workspace</h2>
        <p className="text-muted-foreground text-sm">
          Connect Google or Apple to get calendar sync, tasks, and AI
          orchestration in minutes.
        </p>
      </div>
      <SocialAccountButtons mode="sign-up" />
      <p className="text-center text-muted-foreground text-xs">
        No passwords to manage. You can revoke access anytime from your linked
        provider settings.
      </p>
    </section>
  );
}
